//! Catalogs over transcript metadata, with no pattern: the sessions that the
//! selectors match (`clrg sessions`) and the distinct values of one field
//! across the selected messages (`clrg facets`).
//!
//! Both read every transcript once (in parallel) and parse every line. A
//! message is a `user` or `assistant` line, as in [`crate::SessionInfo`].
//! Selection follows [`crate::select`]: with `--scope message` only messages
//! that pass count; with `--scope session` a session passes when any of its
//! messages passes, and then all its messages count.
//!
//! Sessions are keyed by root and the session id in the transcript's path
//! (`projects/<dir>/<id>.jsonl`, or `<id>/subagents/` for a subagent). The
//! same session in two roots is two entries (`--dedupe none`).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::{BufRead as _, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;
use time::{OffsetDateTime, UtcOffset};

use crate::agree::{self, HistoryIndex, LastText};
use crate::decode::{self, MessageMeta};
use crate::discover::StoreFile;
use crate::search::{Outcome, trim_eol, walk_files};
use crate::select::{Filter, Scope, Selectors};
use crate::session::{self, LaunchCwd, UserText};
use crate::{Error, StoreKind};

/// What to read.
#[derive(Debug, Clone, Default)]
pub struct CatalogOptions {
    /// The roots, in the order given.
    pub roots: Vec<PathBuf>,
    /// The selectors.
    pub selectors: Selectors,
}

/// One session in one root.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionSummary {
    /// Index into the roots.
    pub root: usize,
    /// The session id.
    pub session: String,
    /// The encoded `projects/<dir>` name of the main transcript.
    pub project: Option<String>,
    /// The main transcript, when there is one (else only subagents exist).
    pub transcript: Option<PathBuf>,
    /// The folder the session was launched from (see [`LaunchCwd`]).
    pub cwd: Option<String>,
    /// Whether `cwd` exists (a `stat`).
    pub cwd_exists: Option<bool>,
    /// Every `gitBranch`, in order of first appearance.
    pub branches: Vec<String>,
    /// The earliest line time, unix ms.
    pub first_ts: Option<i64>,
    /// The latest line time, unix ms.
    pub last_ts: Option<i64>,
    /// `user` and `assistant` lines of the main transcript.
    pub messages: u64,
    /// The `last:` line: the last `user/text` that agrees with history (R10).
    pub last: Option<LastText>,
    /// The main transcript's `user/text` lines that are `transcript-only`.
    pub transcript_only: u64,
    /// The session's history lines that are `history-only`.
    pub history_only: u64,
    /// Tools called, sorted (main and subagent transcripts).
    pub tools: Vec<String>,
    /// Distinct paths named by tool inputs (main and subagent transcripts).
    pub files_touched: u64,
    /// Assistant models, sorted.
    pub models: Vec<String>,
    /// Claude Code versions that wrote lines, sorted.
    pub cli_versions: Vec<String>,
    /// `file-history/<session>/` exists in the root.
    pub has_file_history: bool,
    /// Subagent transcripts.
    pub subagents: u64,
}

/// A field `clrg facets` counts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FacetField {
    /// `gitBranch`.
    Branch,
    /// `cwd`.
    Cwd,
    /// The encoded `projects/<dir>` name.
    Project,
    /// `message.model` (assistant messages).
    Model,
    /// `version`.
    CliVersion,
    /// Each tool a message calls; a message counts once per distinct tool.
    Tool,
    /// The root, as given.
    Root,
    /// The message's date in the given offset, `YYYY-MM-DD`.
    Day,
}

/// One distinct value and its counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Facet {
    /// The value; `None` for messages with no value.
    pub value: Option<String>,
    /// Sessions (per root) with at least one counted message.
    pub sessions: u64,
    /// Counted messages.
    pub messages: u64,
    /// The earliest counted message time, unix ms.
    pub first_ts: Option<i64>,
    /// The latest counted message time, unix ms.
    pub last_ts: Option<i64>,
}

/// One transcript file's fold.
struct FileScan<A> {
    root: usize,
    session: Option<String>,
    project: Option<String>,
    subagent: bool,
    path: PathBuf,
    searched: bool,
    /// Folded over every line (when asked for).
    all: A,
    /// Folded over the messages that pass the selectors (when asked for).
    passed: A,
    /// Some message passes the selectors.
    any_pass: bool,
    bad_lines: u64,
    error: Option<String>,
}

/// Which folds to keep.
#[derive(Clone, Copy)]
struct Want {
    all: bool,
    passed: bool,
}

type Key = (usize, String);

/// Read every transcript in the roots, folding each file's lines.
fn scan<A, M, F>(
    opts: &CatalogOptions,
    want: Want,
    make: M,
    fold: F,
) -> Result<(Vec<FileScan<A>>, Outcome, Filter), Error>
where
    A: Send,
    M: Fn() -> A + Sync,
    F: Fn(&mut A, &StoreFile, u64, &Value, &MessageMeta, bool) + Sync,
{
    let filter = Filter::new(&opts.selectors)?;
    let subagents = opts.selectors.subagents;
    let empty = |sf: Option<&StoreFile>, path: PathBuf| FileScan {
        root: sf.map_or(0, |s| s.root),
        session: sf.and_then(|s| s.session.clone()),
        project: sf.and_then(|s| s.project.clone()),
        subagent: sf.is_some_and(|s| s.subagent),
        path,
        searched: false,
        all: make(),
        passed: make(),
        any_pass: false,
        bad_lines: 0,
        error: None,
    };
    let files = walk_files(
        &opts.roots,
        &[StoreKind::Transcripts],
        subagents,
        |sf, path| {
            let mut fs = empty(Some(sf), path.to_path_buf());
            // Only transcripts proper; not saved tool outputs or other files.
            if !sf.transcript || !filter.session_ok(sf.session.as_deref()) {
                return fs;
            }
            fs.searched = true;
            read_file(&filter, want, &fold, sf, path, &mut fs);
            fs
        },
        |error| FileScan {
            error: Some(error),
            ..empty(None, PathBuf::new())
        },
    );
    let mut out = Outcome {
        missing_roots: (0..opts.roots.len())
            .filter(|&i| opts.roots[i].metadata().is_err())
            .collect(),
        ..Outcome::default()
    };
    let mut kept = Vec::with_capacity(files.len());
    for mut f in files {
        if f.searched && f.error.is_some() {
            // Failed to read: not searched (R4), and its partial fold is dropped.
            f.searched = false;
            out.unreadable += 1;
        }
        out.files_searched += u64::from(f.searched);
        out.bad_lines += f.bad_lines;
        if f.bad_lines > 0 {
            out.bad_files.push(f.path.clone());
        }
        out.errors.extend(f.error.take());
        if f.searched {
            kept.push(f);
        }
    }
    out.bad_files.sort();
    out.errors.sort();
    // A stable order, whatever order the threads finished in.
    kept.sort_by(|a, b| (a.root, &a.path).cmp(&(b.root, &b.path)));
    Ok((kept, out, filter))
}

/// Fold the lines of one transcript into `fs`.
fn read_file<A, F>(
    filter: &Filter,
    want: Want,
    fold: &F,
    sf: &StoreFile,
    path: &Path,
    fs: &mut FileScan<A>,
) where
    F: Fn(&mut A, &StoreFile, u64, &Value, &MessageMeta, bool),
{
    let subagents = filter.selectors().subagents;
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            fs.error = Some(format!("{}: {e}", path.display()));
            return;
        }
    };
    let mut reader = BufReader::new(file);
    let mut buf = Vec::new();
    let mut n = 0;
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => n += 1,
            Err(e) => {
                fs.error = Some(format!("{}: {e}", path.display()));
                break;
            }
        }
        let raw = trim_eol(&buf);
        if raw.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(raw) else {
            fs.bad_lines += 1;
            continue;
        };
        let mut meta = decode::transcript_meta(&v);
        if meta.session.is_none() {
            meta.session.clone_from(&sf.session);
        }
        meta.project.clone_from(&sf.project);
        meta.sidechain |= sf.subagent;
        if meta.sidechain && !subagents {
            continue;
        }
        let message = matches!(
            v.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        );
        if want.all {
            fold(&mut fs.all, sf, n, &v, &meta, message);
        }
        if message && filter.message_ok(&meta) {
            fs.any_pass = true;
            if want.passed {
                fold(&mut fs.passed, sf, n, &v, &meta, message);
            }
        }
    }
}

/// The header fields of one or more transcripts.
#[derive(Default)]
struct SessionFold {
    first_ts: Option<i64>,
    last_ts: Option<i64>,
    cwd: LaunchCwd,
    branches: Vec<String>,
    messages: u64,
    /// `user/text` lines (one file's; see `summarize`).
    texts: Vec<UserText>,
    tools: BTreeSet<String>,
    touched: HashSet<String>,
    models: BTreeSet<String>,
    versions: BTreeSet<String>,
}

impl SessionFold {
    fn line(&mut self, n: u64, v: &Value, meta: &MessageMeta, message: bool) {
        if let Some(c) = &meta.cwd {
            self.cwd.see(c, meta.project.as_deref());
        }
        if let Some(ts) = meta.ts {
            self.first_ts = Some(self.first_ts.map_or(ts, |t| t.min(ts)));
            self.last_ts = Some(self.last_ts.map_or(ts, |t| t.max(ts)));
        }
        if let Some(b) = &meta.branch
            && !self.branches.contains(b)
        {
            self.branches.push(b.clone());
        }
        if !message {
            return;
        }
        self.messages += 1;
        self.tools.extend(meta.tools.iter().cloned());
        self.touched.extend(meta.touched.iter().cloned());
        self.models.extend(meta.model.iter().cloned());
        self.versions.extend(meta.version.iter().cloned());
        if let Some(text) = decode::user_text(v) {
            self.texts.push(UserText {
                line: n,
                ts: meta.ts,
                uuid: v.get("uuid").and_then(Value::as_str).map(str::to_string),
                text,
            });
        }
    }

    /// Fold `later` in after `self` (its "last" values win).
    fn merge(&mut self, later: SessionFold) {
        self.first_ts = min_opt(self.first_ts, later.first_ts);
        self.last_ts = self.last_ts.max(later.last_ts);
        self.cwd.merge(&later.cwd);
        for b in later.branches {
            if !self.branches.contains(&b) {
                self.branches.push(b);
            }
        }
        self.messages += later.messages;
        self.tools.extend(later.tools);
        self.touched.extend(later.touched);
        self.models.extend(later.models);
        self.versions.extend(later.versions);
    }
}

fn min_opt(a: Option<i64>, b: Option<i64>) -> Option<i64> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

/// The sessions that the selectors match, in no particular order (the
/// caller sorts). Also returns what was read, for warnings and R4.
///
/// # Errors
/// [`Error::Selector`] when a selector does not compile.
pub fn sessions(opts: &CatalogOptions) -> Result<(Vec<SessionSummary>, Outcome), Error> {
    let want = Want {
        all: true,
        passed: false,
    };
    let (files, out, filter) = scan(opts, want, SessionFold::default, |a, _, n, v, m, msg| {
        a.line(n, v, m, msg);
    })?;
    let restricting = filter.has_message_selectors();
    // Per session: its main transcripts, then its subagent transcripts, in
    // path order.
    let mut by: HashMap<Key, Vec<FileScan<SessionFold>>> = HashMap::new();
    let mut order: Vec<Key> = Vec::new();
    for f in files {
        let Some(sid) = f.session.clone() else {
            continue;
        };
        let key = (f.root, sid);
        by.entry(key.clone())
            .or_insert_with(|| {
                order.push(key);
                Vec::new()
            })
            .push(f);
    }
    let mut rows = Vec::new();
    for key in order {
        let Some(mut files) = by.remove(&key) else {
            continue;
        };
        if restricting && !files.iter().any(|f| f.any_pass) {
            continue;
        }
        files.sort_by_key(|f| f.subagent);
        rows.push(summarize(key, files, &opts.roots));
    }
    // R10: check each listed session's user/text lines against history.
    let ids: HashSet<String> = rows.iter().map(|(s, _)| s.session.clone()).collect();
    // A session's lines are paired once, against its transcripts in every
    // root (see `agree::session_agreements`).
    let index = HistoryIndex::load(&opts.roots, Some(&ids));
    let mut by_session: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, (s, _)) in rows.iter().enumerate() {
        by_session.entry(s.session.as_str()).or_default().push(i);
    }
    let mut found: Vec<Option<agree::SessionAgreement>> = vec![None; rows.len()];
    for (sid, members) in &by_session {
        let with: Vec<usize> = members
            .iter()
            .copied()
            .filter(|&i| rows[i].0.transcript.is_some())
            .collect();
        let sources: Vec<(&Path, &[UserText])> = with
            .iter()
            .filter_map(|&i| Some((rows[i].0.transcript.as_deref()?, rows[i].1.as_slice())))
            .collect();
        let (shared, each) = agree::session_agreements(&index, sid, &sources);
        for &i in members {
            found[i] = Some(shared.clone());
        }
        for (i, sa) in with.into_iter().zip(each) {
            found[i] = Some(sa);
        }
    }
    let rows = rows
        .into_iter()
        .zip(found)
        .map(|((mut s, _), sa)| {
            let sa = sa.unwrap_or_default();
            s.transcript_only = sa.transcript_only();
            s.history_only = sa.history_only();
            s.last = sa.last;
            s
        })
        .collect();
    Ok((rows, out))
}

/// One session's summary, and its main transcript's `user/text` lines.
fn summarize(
    key: Key,
    mut files: Vec<FileScan<SessionFold>>,
    roots: &[PathBuf],
) -> (SessionSummary, Vec<UserText>) {
    let (root, session) = key;
    let main = files.iter().find(|f| !f.subagent);
    let project = main.and_then(|f| f.project.clone());
    let transcript = main.map(|f| f.path.clone());
    let subagents = files.iter().filter(|f| f.subagent).count() as u64;
    let has_main = main.is_some();
    // Only the first main transcript's lines: line numbers are per file.
    let texts = files
        .iter_mut()
        .find(|f| !f.subagent)
        .map(|f| std::mem::take(&mut f.all.texts))
        .unwrap_or_default();
    let mut head = SessionFold::default();
    let mut extra = SessionFold::default();
    for f in files {
        if f.subagent && has_main {
            extra.merge(f.all);
        } else {
            head.merge(f.all);
        }
    }
    let tools = head.tools.union(&extra.tools).cloned().collect();
    let models = head.models.union(&extra.models).cloned().collect();
    let cli_versions = head.versions.union(&extra.versions).cloned().collect();
    let files_touched = head.touched.union(&extra.touched).count() as u64;
    let has_file_history = roots
        .get(root)
        .is_some_and(|r| r.join("file-history").join(&session).is_dir());
    let summary = SessionSummary {
        root,
        project,
        transcript,
        cwd_exists: head.cwd.get().map(session::cwd_exists),
        cwd: head.cwd.get().map(str::to_string),
        branches: head.branches,
        first_ts: head.first_ts,
        last_ts: head.last_ts,
        messages: head.messages,
        last: None,
        transcript_only: 0,
        history_only: 0,
        tools,
        files_touched,
        models,
        cli_versions,
        has_file_history,
        subagents,
        session,
    };
    (summary, texts)
}

/// Per value: messages, first and last time.
type FacetFold = HashMap<Option<String>, (u64, Option<i64>, Option<i64>)>;

/// The values of `field` for one message.
fn facet_values(
    field: FacetField,
    root: &Path,
    meta: &MessageMeta,
    offset: UtcOffset,
) -> Vec<Option<String>> {
    let one = |v: Option<&String>| vec![v.cloned()];
    match field {
        FacetField::Branch => one(meta.branch.as_ref()),
        FacetField::Cwd => one(meta.cwd.as_ref()),
        FacetField::Project => one(meta.project.as_ref()),
        FacetField::Model => one(meta.model.as_ref()),
        FacetField::CliVersion => one(meta.version.as_ref()),
        FacetField::Root => vec![Some(root.to_string_lossy().into_owned())],
        FacetField::Day => vec![meta.ts.and_then(|ms| day(ms, offset))],
        FacetField::Tool => {
            let tools: BTreeSet<&String> = meta.tools.iter().collect();
            if tools.is_empty() {
                vec![None]
            } else {
                tools.into_iter().map(|t| Some(t.clone())).collect()
            }
        }
    }
}

/// `YYYY-MM-DD` of `ms` in `offset`.
fn day(ms: i64, offset: UtcOffset) -> Option<String> {
    let t = OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .ok()?
        .to_offset(offset);
    Some(format!(
        "{:04}-{:02}-{:02}",
        t.year(),
        u8::from(t.month()),
        t.day()
    ))
}

/// The distinct values of `field` across the selected messages, in no
/// particular order (the caller sorts). `offset` sets the `day` boundary.
/// An empty result means no message was selected. Also returns what was
/// read, for warnings and R4.
///
/// # Errors
/// [`Error::Selector`] when a selector does not compile.
pub fn facets(
    opts: &CatalogOptions,
    field: FacetField,
    offset: UtcOffset,
) -> Result<(Vec<Facet>, Outcome), Error> {
    let filter = Filter::new(&opts.selectors)?;
    let restricting = filter.has_message_selectors();
    let by_session = opts.selectors.scope == Scope::Session;
    // Message scope with selectors: fold only passing messages. Otherwise
    // fold every message, and pick whole sessions below.
    let want = Want {
        all: !restricting || by_session,
        passed: restricting && !by_session,
    };
    let roots = &opts.roots;
    let (files, out, _) = scan(
        opts,
        want,
        FacetFold::new,
        |acc, sf, _, _, meta, message| {
            if !message {
                return;
            }
            let root = roots.get(sf.root).map_or(Path::new(""), PathBuf::as_path);
            for value in facet_values(field, root, meta, offset) {
                let e = acc.entry(value).or_insert((0, None, None));
                e.0 += 1;
                if let Some(ts) = meta.ts {
                    e.1 = min_opt(e.1, Some(ts));
                    e.2 = e.2.max(Some(ts));
                }
            }
        },
    )?;
    let passing: HashSet<Key> = files
        .iter()
        .filter(|f| f.any_pass)
        .filter_map(|f| f.session.clone().map(|s| (f.root, s)))
        .collect();
    let mut merged: HashMap<Option<String>, (HashSet<Key>, Facet)> = HashMap::new();
    for f in files {
        let key: Key = (f.root, f.session.clone().unwrap_or_default());
        let acc = if !restricting {
            f.all
        } else if by_session {
            if !passing.contains(&key) {
                continue;
            }
            f.all
        } else {
            f.passed
        };
        for (value, (n, first, last)) in acc {
            let (sessions, facet) = merged.entry(value.clone()).or_insert_with(|| {
                (
                    HashSet::new(),
                    Facet {
                        value,
                        sessions: 0,
                        messages: 0,
                        first_ts: None,
                        last_ts: None,
                    },
                )
            });
            sessions.insert(key.clone());
            facet.messages += n;
            facet.first_ts = min_opt(facet.first_ts, first);
            facet.last_ts = facet.last_ts.max(last);
        }
    }
    let rows = merged
        .into_values()
        .map(|(sessions, mut facet)| {
            facet.sessions = sessions.len() as u64;
            facet
        })
        .collect();
    Ok((rows, out))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("projects/-w");
        std::fs::create_dir_all(p.join("s1/subagents")).unwrap();
        std::fs::write(
            p.join("s1.jsonl"),
            concat!(
                r#"{"type":"user","cwd":"/w","gitBranch":"a","version":"1.0.1","timestamp":"2026-08-02T14:01:00Z","message":{"content":"first"}}"#,
                "\n",
                r#"{"type":"assistant","cwd":"/w","gitBranch":"b","timestamp":"2026-08-02T14:02:00Z","message":{"model":"m","content":[{"type":"tool_use","name":"Write","input":{"file_path":"/w/x"}}]}}"#,
                "\n{broken\n",
                r#"{"type":"user","cwd":"/w2","gitBranch":"b","timestamp":"2026-08-02T14:03:00Z","message":{"content":"second"}}"#,
                "\n",
            ),
        )
        .unwrap();
        std::fs::write(
            p.join("s1/subagents/agent-1.jsonl"),
            r#"{"type":"user","isSidechain":true,"cwd":"/w","gitBranch":"a","timestamp":"2026-08-02T15:00:00Z","message":{"content":"agent task"}}"#,
        )
        .unwrap();
        std::fs::write(
            p.join("s2.jsonl"),
            r#"{"type":"user","cwd":"/v","timestamp":"2026-08-01T10:00:00Z","message":{"content":"other"}}"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn sessions_fold_main_and_subagent_transcripts() {
        let dir = root();
        let opts = CatalogOptions {
            roots: vec![dir.path().to_path_buf()],
            ..CatalogOptions::default()
        };
        let (mut rows, out) = sessions(&opts).unwrap();
        rows.sort_by(|a, b| a.session.cmp(&b.session));
        assert_eq!(out.bad_lines, 1);
        assert_eq!(rows.len(), 2);
        let s1 = &rows[0];
        assert_eq!(s1.cwd.as_deref(), Some("/w"), "the launch folder");
        assert_eq!(s1.branches, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(s1.messages, 3, "the main transcript's messages");
        let last = s1.last.as_ref().unwrap();
        assert_eq!(
            (last.text.as_str(), last.status),
            ("second", agree::LastStatus::Unverified),
            "no history.jsonl: the last user/text, unverified"
        );
        assert_eq!(s1.subagents, 1);
        assert_eq!(s1.tools, vec!["Write".to_string()]);
        assert_eq!(s1.files_touched, 1);
        assert_eq!(s1.models, vec!["m".to_string()]);
        assert_eq!(s1.cwd_exists, Some(false));

        let only_b = CatalogOptions {
            selectors: Selectors {
                branch: vec!["b".into()],
                ..Selectors::default()
            },
            ..opts
        };
        let (rows, _) = sessions(&only_b).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn facets_count_messages_and_sessions_per_value() {
        let dir = root();
        let opts = CatalogOptions {
            roots: vec![dir.path().to_path_buf()],
            ..CatalogOptions::default()
        };
        let (rows, _) = facets(&opts, FacetField::Branch, UtcOffset::UTC).unwrap();
        let get = |v: Option<&str>| {
            rows.iter()
                .find(|r| r.value.as_deref() == v)
                .map(|r| (r.sessions, r.messages))
        };
        assert_eq!(get(Some("a")), Some((1, 2)));
        assert_eq!(get(Some("b")), Some((1, 2)));
        assert_eq!(get(None), Some((1, 1)));

        let a_session = CatalogOptions {
            selectors: Selectors {
                branch: vec!["a".into()],
                scope: Scope::Session,
                ..Selectors::default()
            },
            ..opts.clone()
        };
        let (rows, _) = facets(&a_session, FacetField::Branch, UtcOffset::UTC).unwrap();
        assert_eq!(rows.len(), 2, "every message of the session counts");
        let (rows, _) = facets(&opts, FacetField::Day, UtcOffset::UTC).unwrap();
        assert_eq!(rows.len(), 2);
    }
}
