//! The clap types, the four runners, and the daemon loop of section 8.7.
//!
//! This module never reads `HOME`, the hostname, or `XDG_*` by itself. clap
//! reads the `DOTSYNC_*` variables through the `env` attribute on each flag.
//! `main.rs` resolves everything else into `Defaults`. `run_plan` opens no
//! store and writes no manifest.

use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::io::Write;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::{Args, Parser, Subcommand};
use object_store::ObjectStore;
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::batch::{Batcher, Closed};
use crate::config::{self, FileConfig, Settings};
use crate::manifest::{Action, Kind, Manifest, Plan};
use crate::scan::{self, DenyList, Scope};
use crate::store::{self, Layout, StoreUrl, UploadReport};
use crate::watch::{Hint, Watcher};

#[derive(Debug, Parser)]
#[command(
    name = "dotsync",
    version,
    about = "Mirror a dot directory into an object store under a per-machine prefix."
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Debug, Subcommand)]
pub enum Cmd {
    /// Print the next batch. Reads only.
    Plan(Common),
    /// One scan, one batch, one upload pass, exit.
    Sync(Common),
    /// List what a host has uploaded.
    Ls(Common),
    /// Watch and upload until SIGINT or SIGTERM.
    Daemon(DaemonArgs),
}

/// The flags every subcommand takes (section 9).
#[derive(Debug, Clone, Args, Default, PartialEq, Eq)]
pub struct Common {
    #[arg(long, env = "DOTSYNC_ROOT")]
    pub root: Vec<PathBuf>,
    #[arg(long, env = "DOTSYNC_STORE")]
    pub store: Option<String>,
    #[arg(long, env = "DOTSYNC_HOST")]
    pub host: Option<String>,
    #[arg(long, env = "DOTSYNC_STATE_DIR")]
    pub state_dir: Option<PathBuf>,
    #[arg(long, env = "DOTSYNC_CONFIG")]
    pub config: Option<PathBuf>,
    #[arg(long, env = "DOTSYNC_ENDPOINT")]
    pub endpoint: Option<String>,
}

/// The daemon policy flags. `daemon` parses them. `plan`, `sync`, and `ls` pass
/// `PolicyArgs::default()` to `config::resolve`.
#[derive(Debug, Clone, Args, Default, PartialEq, Eq)]
pub struct PolicyArgs {
    #[arg(long, env = "DOTSYNC_QUIET_SECS")]
    pub quiet_secs: Option<u64>,
    #[arg(long, env = "DOTSYNC_CEILING_SECS")]
    pub ceiling_secs: Option<u64>,
    #[arg(long, env = "DOTSYNC_RESCAN_SECS")]
    pub rescan_secs: Option<u64>,
    #[arg(long, env = "DOTSYNC_DEBOUNCE_MS")]
    pub debounce_ms: Option<u64>,
}

#[derive(Debug, Clone, Args, Default, PartialEq, Eq)]
pub struct DaemonArgs {
    #[command(flatten)]
    pub common: Common,
    #[command(flatten)]
    pub policy: PolicyArgs,
}

/// What `main.rs` resolved from the process environment. Nothing else reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Defaults {
    pub home: PathBuf,
    pub host: String,
    pub config_path: PathBuf,
    /// `default_state_dir` of section 8.8.
    pub state_dir: PathBuf,
}

/// Dispatch on `cli.cmd`. Returns `Ok(())` on success. `main` maps the result to the
/// process exit code (section 8.8). Loads the config file, resolves the settings,
/// and creates the state directory before the subcommand runs.
pub async fn run(cli: Cli, defaults: Defaults, out: &mut dyn Write) -> Result<(), CliError> {
    let (common, policy) = match &cli.cmd {
        Cmd::Plan(c) | Cmd::Sync(c) | Cmd::Ls(c) => (c, PolicyArgs::default()),
        Cmd::Daemon(d) => (&d.common, d.policy.clone()),
    };
    let file = load_file(common, &defaults)?;
    let settings = config::resolve(common, &policy, file.as_ref(), &defaults)?;
    std::fs::create_dir_all(&settings.state_dir)?;
    match &cli.cmd {
        Cmd::Plan(_) => run_plan(&settings, out).await,
        Cmd::Sync(_) => run_sync(&settings, out).await,
        Cmd::Ls(_) => run_ls(&settings, out).await,
        Cmd::Daemon(_) => run_daemon(&settings, out).await,
    }
}

/// The config file at `--config`, else at the default path. An absent explicit
/// file is an empty config and one stderr line (section 8.8). A leading `~` in
/// the file is expanded with `defaults.home`.
fn load_file(common: &Common, defaults: &Defaults) -> Result<Option<FileConfig>, CliError> {
    let (path, explicit) = match &common.config {
        Some(p) => (p.clone(), true),
        None => (defaults.config_path.clone(), false),
    };
    let mut file = FileConfig::load(&path)?;
    if file.is_none() && explicit {
        eprintln!("config: {} is absent, using defaults", path.display());
    }
    if let Some(f) = &mut file {
        f.expand_home(&defaults.home);
    }
    Ok(file)
}

/// Scan every root, diff, print `display_line` for each action in order. No store, no write.
pub async fn run_plan(settings: &Settings, out: &mut dyn Write) -> Result<(), CliError> {
    let deny = deny_list(settings)?;
    let mut lines: Vec<(String, String)> = Vec::new();
    for (name, path) in &settings.roots {
        let manifest = load_manifest(settings, name)?;
        let snap = scan::scan(path, &deny, Scope::Full, now_ns())?;
        let mut plan = manifest.diff(path, &snap)?;
        drop_denied(&mut plan, &deny);
        for action in &plan.actions {
            if let Some(line) = action.display_line(name) {
                lines.push((format!("{name}/{}", action.rel()), line));
            }
        }
    }
    lines.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    for (_, line) in lines {
        writeln!(out, "{line}")?;
    }
    Ok(())
}

/// One cycle per root (section 7, last paragraph). Exits 1 on the first store
/// error after the manifest for the successful actions is written.
pub async fn run_sync(settings: &Settings, out: &mut dyn Write) -> Result<(), CliError> {
    let mut engine = Engine::open(settings)?;
    for root in 0..engine.roots.len() {
        let name = engine.roots[root].name.clone();
        let cycle = engine.cycle(root, Scope::Full).await?;
        writeln!(
            out,
            "synced {name} uploads={} links={} tombstones={} touches={} bytes={} generation={}",
            cycle.uploads,
            cycle.links,
            cycle.tombstones,
            cycle.touches,
            cycle.bytes,
            cycle.generation
        )?;
        if let Some((rel, text)) = cycle.failed {
            return Err(CliError::Pass(format!("{name}/{rel}: {text}")));
        }
    }
    Ok(())
}

/// `store::list_host`, one line per entry (section 9).
pub async fn run_ls(settings: &Settings, out: &mut dyn Write) -> Result<(), CliError> {
    let opened = store::open(
        &StoreUrl::parse(&settings.store)?,
        settings.endpoint.as_deref(),
    )?;
    let layout = Layout::new(opened.prefix, &settings.host);
    for item in store::list_host(opened.store.as_ref(), &layout).await? {
        match item.kind {
            Kind::File => writeln!(out, "{}/{}", item.root, item.rel)?,
            Kind::Link => writeln!(
                out,
                "{}/{} -> {}",
                item.root,
                item.rel,
                item.target.unwrap_or_default()
            )?,
        }
    }
    Ok(())
}

/// Section 7 loop until a signal. A startup full scan reconciles first (section 16).
/// Prints nothing to `out`. Logs to stderr.
pub async fn run_daemon(settings: &Settings, _out: &mut dyn Write) -> Result<(), CliError> {
    let mut engine = Engine::open(settings)?;
    let roots: Vec<PathBuf> = engine.roots.iter().map(|r| r.path.clone()).collect();
    let (tx, mut rx) = mpsc::unbounded_channel::<Hint>();
    let watcher = Watcher::start(&roots, settings.debounce, tx)?;
    let mut shutdown = shutdown_signal()?;
    let mut batcher = Batcher::new(settings.policy, Instant::now());
    log(
        "info",
        &format!(
            "daemon start roots={} deny={}",
            roots.len(),
            engine.deny.patterns().len()
        ),
    );

    for root in 0..roots.len() {
        engine
            .run_closed(full(root), &mut batcher, Instant::now())
            .await;
    }

    loop {
        let now = Instant::now();
        let deadline = match engine.deferred_deadline() {
            Some(d) => batcher.next_deadline(now).min(d),
            None => batcher.next_deadline(now),
        };
        tokio::select! {
            hint = rx.recv() => match hint {
                Some(h) => batcher.hint(h.root, &h.folder, h.full, Instant::now()),
                None => break,
            },
            _ = tokio::time::sleep_until(deadline) => {},
            _ = &mut shutdown => break,
        }
        let now = Instant::now();
        for closed in batcher.take_closed(now) {
            engine.run_closed(closed, &mut batcher, now).await;
        }
        for closed in engine.take_deferred(now) {
            engine.run_closed(closed, &mut batcher, now).await;
        }
        if batcher.full_due(now) {
            for root in 0..roots.len() {
                engine.run_closed(full(root), &mut batcher, now).await;
            }
        }
    }

    log(
        "info",
        &format!("daemon stop dirty={}", batcher.dirty_count()),
    );
    let now = Instant::now();
    for closed in batcher.take_closed(now + settings.policy.ceiling) {
        engine.run_closed(closed, &mut batcher, now).await;
    }
    watcher.stop();
    Ok(())
}

/// A future that completes on SIGINT or SIGTERM. On other targets, SIGINT alone.
/// This is the one `cfg` gate of this module.
fn shutdown_signal() -> Result<Pin<Box<dyn Future<Output = ()>>>, CliError> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate())?;
        Ok(Box::pin(async move {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = term.recv() => {},
            }
        }))
    }
    #[cfg(not(unix))]
    {
        Ok(Box::pin(async {
            let _ = tokio::signal::ctrl_c().await;
        }))
    }
}

/// A `Closed` for a full rescan of one root.
fn full(root: usize) -> Closed {
    Closed {
        root,
        full: true,
        folders: Vec::new(),
    }
}

/// The deny list from the resolved patterns.
fn deny_list(settings: &Settings) -> Result<DenyList, CliError> {
    let patterns: Vec<&str> = settings.deny.iter().map(String::as_str).collect();
    Ok(DenyList::new(&patterns)?)
}

/// The manifest file of one root, or a fresh one when absent.
fn load_manifest(settings: &Settings, name: &str) -> Result<Manifest, CliError> {
    let path = Manifest::path_for(&settings.state_dir, &settings.host, name);
    Ok(Manifest::load(&path)?.unwrap_or_else(|| Manifest::new(&settings.host, name)))
}

/// Nanoseconds since the Unix epoch, 0 before it.
fn now_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// One stderr line: `<RFC 3339 UTC> <level> <message>`.
fn log(level: &str, message: &str) {
    eprintln!("{} {level} {message}", rfc3339_now());
}

/// The current UTC time as `YYYY-MM-DDTHH:MM:SSZ`, without a date crate.
fn rfc3339_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// One root inside the engine.
struct RootState {
    name: String,
    path: PathBuf,
    manifest_path: PathBuf,
    manifest: Manifest,
}

/// What `sync` and `daemon` share: the open store, the layout, the deny list,
/// every root with its manifest, and the daemon state across passes.
struct Engine {
    store: Arc<dyn ObjectStore>,
    layout: Layout,
    deny: DenyList,
    roots: Vec<RootState>,
    policy: crate::batch::Policy,
    /// File-to-directory conflicts detected from the plan (section 6). Kept for
    /// the life of the process.
    skipped_prefixes: BTreeSet<String>,
    /// Consecutive failures per `(root, full, folders)` batch (section 7).
    failures: BTreeMap<(usize, bool, Vec<String>), u32>,
    /// Batches held back to the ceiling rate after three failures.
    deferred: Vec<(Instant, Closed)>,
}

/// The counts of one pass, from the actions the report lists as done.
struct Cycle {
    uploads: usize,
    links: usize,
    tombstones: usize,
    touches: usize,
    bytes: u64,
    generation: u64,
    /// The first failure as `(rel, text)`, when the pass stopped early.
    failed: Option<(String, String)>,
}

impl Engine {
    /// Open the store once and load every manifest.
    fn open(settings: &Settings) -> Result<Self, CliError> {
        let opened = store::open(
            &StoreUrl::parse(&settings.store)?,
            settings.endpoint.as_deref(),
        )?;
        let layout = Layout::new(opened.prefix, &settings.host);
        let deny = deny_list(settings)?;
        let mut roots = Vec::new();
        for (name, path) in &settings.roots {
            let manifest_path = Manifest::path_for(&settings.state_dir, &settings.host, name);
            roots.push(RootState {
                name: name.clone(),
                path: path.clone(),
                manifest_path,
                manifest: load_manifest(settings, name)?,
            });
        }
        Ok(Self {
            store: opened.store,
            layout,
            deny,
            roots,
            policy: settings.policy,
            skipped_prefixes: BTreeSet::new(),
            failures: BTreeMap::new(),
            deferred: Vec::new(),
        })
    }

    /// Section 7: scan, diff, upload, apply, write the manifest, put the snapshot.
    /// `Err` means nothing was applied. `Ok` with `failed` set means the manifest
    /// holds the actions that succeeded.
    async fn cycle(&mut self, root: usize, scope: Scope) -> Result<Cycle, CliError> {
        let now_ns = now_ns();
        let state = &mut self.roots[root];
        let snap = scan::scan(&state.path, &self.deny, scope, now_ns)?;
        let mut plan = state.manifest.diff(&state.path, &snap)?;
        drop_denied(&mut plan, &self.deny);
        drop_conflicts(
            &state.manifest,
            &mut plan,
            &mut self.skipped_prefixes,
            &state.name,
        );
        if plan.is_empty() {
            return Ok(counts(
                &plan,
                &UploadReport::default(),
                state.manifest.generation,
            ));
        }
        let generation = state.manifest.generation + 1;
        let report = store::upload(
            self.store.as_ref(),
            &self.layout,
            &state.name,
            &state.path,
            &self.deny,
            &plan,
            generation,
            now_ns,
        )
        .await?;
        state.manifest.apply(&plan, &report);
        state.manifest.write_atomic(&state.manifest_path)?;
        store::put_manifest(self.store.as_ref(), &self.layout, &state.manifest).await?;
        Ok(counts(&plan, &report, state.manifest.generation))
    }

    /// One batch of the daemon: run the cycle, log one line, and schedule the retry
    /// on failure (section 7).
    async fn run_closed(&mut self, closed: Closed, batcher: &mut Batcher, now: Instant) {
        let started = Instant::now();
        let name = self.roots[closed.root].name.clone();
        let scope = if closed.full {
            Scope::Full
        } else {
            Scope::Folders(closed.folders.clone())
        };
        let scope_text = if closed.full {
            "full".to_string()
        } else {
            format!("folders:{}", closed.folders.len())
        };
        let key = (closed.root, closed.full, closed.folders.clone());
        match self.cycle(closed.root, scope).await {
            Ok(c) => {
                log(
                    "info",
                    &format!(
                        "cycle root={name} scope={scope_text} uploads={} links={} tombstones={} touches={} bytes={} ms={}",
                        c.uploads,
                        c.links,
                        c.tombstones,
                        c.touches,
                        c.bytes,
                        started.elapsed().as_millis()
                    ),
                );
                match c.failed {
                    Some((rel, text)) => {
                        log("error", &format!("upload root={name} rel={rel}: {text}"));
                        self.retry(key, closed, batcher, now);
                    }
                    None => {
                        self.failures.remove(&key);
                    }
                }
            }
            Err(e) => {
                log(
                    "error",
                    &format!("cycle root={name} scope={scope_text}: {e}"),
                );
                self.retry(key, closed, batcher, now);
            }
        }
    }

    /// Re-mark the folders so they retry after one quiet window. From the third
    /// consecutive failure on, log a warning and hold the batch to the ceiling rate.
    fn retry(
        &mut self,
        key: (usize, bool, Vec<String>),
        closed: Closed,
        batcher: &mut Batcher,
        now: Instant,
    ) {
        let count = self.failures.entry(key).or_insert(0);
        *count += 1;
        if *count >= 3 {
            if *count == 3 {
                log(
                    "warn",
                    &format!(
                        "root={} failed {} times in a row, retrying at the ceiling rate",
                        self.roots[closed.root].name, *count
                    ),
                );
            }
            self.deferred.push((now + self.policy.ceiling, closed));
            return;
        }
        if closed.full {
            batcher.hint(closed.root, "", true, now);
        } else {
            for folder in &closed.folders {
                batcher.hint(closed.root, folder, false, now);
            }
        }
    }

    /// The earliest deferred retry, if any.
    fn deferred_deadline(&self) -> Option<Instant> {
        self.deferred.iter().map(|(at, _)| *at).min()
    }

    /// The deferred batches whose retry time has come.
    fn take_deferred(&mut self, now: Instant) -> Vec<Closed> {
        let (due, later): (Vec<_>, Vec<_>) =
            self.deferred.drain(..).partition(|(at, _)| *at <= now);
        self.deferred = later;
        due.into_iter().map(|(_, c)| c).collect()
    }
}

/// Decision 4.2: a denied path never enters the plan. A live manifest entry that a
/// later deny pattern matches is absent from the scan, so `diff` plans a tombstone
/// for it. Drop that action. The object and the manifest entry stay as they are.
fn drop_denied(plan: &mut Plan, deny: &DenyList) {
    plan.actions.retain(|a| !deny.is_denied(a.rel()));
}

/// Section 6: an `Upload` whose `rel` has a proper prefix that is a live `File`
/// entry marks a file-to-directory conflict. Log each new prefix once. Drop every
/// action under a skipped prefix before `store::upload`.
fn drop_conflicts(
    manifest: &Manifest,
    plan: &mut Plan,
    skipped: &mut BTreeSet<String>,
    root_name: &str,
) {
    for action in &plan.actions {
        let Action::Upload { rel, .. } = action else {
            continue;
        };
        for (i, byte) in rel.bytes().enumerate() {
            if byte != b'/' {
                continue;
            }
            let prefix = &rel[..i];
            let live_file = manifest
                .entries
                .get(prefix)
                .is_some_and(|e| !e.deleted && e.kind == Kind::File);
            if live_file && skipped.insert(prefix.to_string()) {
                log(
                    "warn",
                    &format!(
                        "conflict root={root_name} path={prefix}: a file became a directory, skipped until resolved by hand"
                    ),
                );
            }
        }
    }
    if skipped.is_empty() {
        return;
    }
    plan.actions.retain(|a| {
        !skipped.iter().any(|p| {
            a.rel()
                .strip_prefix(p.as_str())
                .is_some_and(|r| r.starts_with('/'))
        })
    });
}

/// The planned counts from `Plan::summary`, the bytes the report put, and the
/// first failure when the pass stopped early.
fn counts(plan: &Plan, report: &UploadReport, generation: u64) -> Cycle {
    let s = plan.summary();
    let mut c = Cycle {
        uploads: s.uploads,
        links: s.links,
        tombstones: s.tombstones,
        touches: s.touches,
        bytes: report.bytes,
        generation,
        failed: None,
    };
    if let Some((i, text)) = &report.failed {
        let rel = plan
            .actions
            .get(*i)
            .map(|a| a.rel().to_string())
            .unwrap_or_default();
        c.failed = Some((rel, text.clone()));
    }
    c
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error(transparent)]
    Config(#[from] config::ConfigError),
    #[error(transparent)]
    Scan(#[from] scan::ScanError),
    #[error(transparent)]
    Manifest(#[from] crate::manifest::ManifestError),
    #[error(transparent)]
    Watch(#[from] crate::watch::WatchError),
    #[error(transparent)]
    Store(#[from] store::StoreError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A process environment value that `main.rs` could not resolve.
    #[error("environment: {0}")]
    Env(String),
    /// An upload pass that stopped early. The manifest holds what succeeded.
    #[error("upload pass stopped at {0}")]
    Pass(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::DEFAULT_DENY;
    use std::fs;
    use std::path::Path;
    use std::time::Duration;

    /// A root, a state dir, and a `file:` store, all under one `TempDir`.
    fn settings(dir: &Path) -> Settings {
        let root = dir.join("root");
        let store_dir = dir.join("store");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&store_dir).unwrap();
        Settings {
            host: "alpha".to_string(),
            store: format!("file:{}", store_dir.display()),
            endpoint: None,
            state_dir: dir.join("state"),
            roots: vec![("root".to_string(), root)],
            deny: DEFAULT_DENY.iter().map(|p| (*p).to_string()).collect(),
            policy: crate::batch::Policy::default(),
            debounce: Duration::from_millis(500),
        }
    }

    /// A sorted recursive listing of `dir` as relative paths.
    fn walk(dir: &Path) -> Vec<String> {
        fn go(base: &Path, dir: &Path, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                out.push(
                    path.strip_prefix(base)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                );
                if path.is_dir() {
                    go(base, &path, out);
                }
            }
        }
        let mut out = Vec::new();
        go(dir, dir, &mut out);
        out.sort();
        out
    }

    fn manifest_bytes(s: &Settings) -> Vec<u8> {
        fs::read(Manifest::path_for(&s.state_dir, &s.host, "root")).unwrap()
    }

    #[tokio::test]
    async fn plan_is_read_only_zero_puts_and_manifest_bytes_identical() {
        let dir = tempfile::TempDir::new().unwrap();
        let s = settings(dir.path());
        let root = &s.roots[0].1;
        fs::write(root.join("a.txt"), b"one").unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();
        let before_store = walk(&dir.path().join("store"));
        let before_manifest = manifest_bytes(&s);
        let before_state = walk(&s.state_dir);
        assert!(before_store.iter().any(|p| p.ends_with("a.txt")));

        fs::write(root.join("a.txt"), b"two").unwrap();
        fs::write(root.join("b.txt"), b"new").unwrap();
        let mut out = Vec::new();
        run_plan(&s, &mut out).await.unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(text, "upload root/a.txt\nupload root/b.txt\n");

        assert_eq!(walk(&dir.path().join("store")), before_store);
        assert_eq!(manifest_bytes(&s), before_manifest);
        assert_eq!(walk(&s.state_dir), before_state);
    }

    #[tokio::test]
    async fn sync_then_plan_prints_nothing() {
        let dir = tempfile::TempDir::new().unwrap();
        let s = settings(dir.path());
        let root = &s.roots[0].1;
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.txt"), b"one").unwrap();
        fs::write(root.join(".credentials.json"), b"{}").unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();
        let text = String::from_utf8(out).unwrap();
        assert_eq!(
            text,
            "synced root uploads=1 links=0 tombstones=0 touches=0 bytes=3 generation=1\n"
        );
        let mut out = Vec::new();
        run_plan(&s, &mut out).await.unwrap();
        assert!(out.is_empty(), "{}", String::from_utf8_lossy(&out));
    }

    #[tokio::test]
    async fn ls_reads_manifest_snapshot_for_host() {
        let dir = tempfile::TempDir::new().unwrap();
        let s = settings(dir.path());
        let root = &s.roots[0].1;
        fs::write(root.join("a.txt"), b"one").unwrap();
        std::os::unix::fs::symlink("a.txt", root.join("l")).unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();

        let mut out = Vec::new();
        run_ls(&s, &mut out).await.unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "root/a.txt\nroot/l -> a.txt\n"
        );

        let beta = Settings {
            host: "beta".to_string(),
            ..s.clone()
        };
        let mut out = Vec::new();
        run_ls(&beta, &mut out).await.unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn sync_tombstones_a_removed_file_and_keeps_the_object() {
        let dir = tempfile::TempDir::new().unwrap();
        let s = settings(dir.path());
        let root = &s.roots[0].1;
        fs::write(root.join("a.txt"), b"one").unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();
        fs::remove_file(root.join("a.txt")).unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            format!(
                "synced root uploads=0 links=0 tombstones=1 touches=0 bytes={} generation=2\n",
                fs::metadata(
                    dir.path()
                        .join("store/alpha/.dotsync/root/tombstones/a.txt")
                )
                .unwrap()
                .len()
            )
        );
        assert!(dir.path().join("store/alpha/root/a.txt").is_file());
        let mut out = Vec::new();
        run_ls(&s, &mut out).await.unwrap();
        assert!(out.is_empty());
    }

    #[tokio::test]
    async fn sync_drops_a_path_denied_after_its_upload() {
        let dir = tempfile::TempDir::new().unwrap();
        let s = settings(dir.path());
        let root = &s.roots[0].1;
        fs::write(root.join("notes.key"), b"k").unwrap();
        fs::write(root.join("ok.txt"), b"one").unwrap();
        let mut out = Vec::new();
        run_sync(&s, &mut out).await.unwrap();

        let mut denied = s.clone();
        denied.deny.push("**/*.key".to_string());
        fs::write(root.join("ok.txt"), b"two").unwrap();
        let mut out = Vec::new();
        run_plan(&denied, &mut out).await.unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "upload root/ok.txt\n");
        let mut out = Vec::new();
        run_sync(&denied, &mut out).await.unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains(" tombstones=0 "), "{text}");
        assert!(text.contains(" uploads=1 "), "{text}");
        assert_eq!(
            fs::read(dir.path().join("store/alpha/root/ok.txt")).unwrap(),
            b"two"
        );
        assert!(dir.path().join("store/alpha/root/notes.key").is_file());
        assert!(
            !dir.path()
                .join("store/alpha/.dotsync/root/tombstones/notes.key")
                .exists()
        );
    }

    #[test]
    fn drop_conflicts_skips_uploads_under_a_live_file() {
        let mut m = Manifest::new("alpha", "root");
        m.entries.insert(
            "f".to_string(),
            crate::manifest::Entry {
                kind: Kind::File,
                size: 1,
                mtime_ns: 1,
                inode: 1,
                hash: "h".to_string(),
                target: None,
                uploaded_version: 1,
                deleted: false,
            },
        );
        let entry = m.entries["f"].clone();
        let mut plan = Plan {
            actions: vec![
                Action::Tombstone {
                    rel: "f".to_string(),
                    kind: Kind::File,
                },
                Action::Upload {
                    rel: "f/child".to_string(),
                    entry: entry.clone(),
                },
                Action::Upload {
                    rel: "g".to_string(),
                    entry,
                },
            ],
        };
        let mut skipped = BTreeSet::new();
        drop_conflicts(&m, &mut plan, &mut skipped, "root");
        assert_eq!(skipped, BTreeSet::from(["f".to_string()]));
        let rels: Vec<&str> = plan.actions.iter().map(Action::rel).collect();
        assert_eq!(rels, vec!["f", "g"]);
    }

    #[test]
    fn civil_from_days_matches_known_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_000), (2022, 1, 8));
        assert_eq!(civil_from_days(20_746), (2026, 10, 20));
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }
}
