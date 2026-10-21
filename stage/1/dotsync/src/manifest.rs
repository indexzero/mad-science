//! The manifest schema of section 6, load, diff, apply, and the atomic write.
//!
//! This module never touches the store and never reads `HOME`. It writes a
//! file only in `write_atomic`.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::scan::{self, Snapshot, Stat};
use crate::store::UploadReport;

/// The manifest schema version this build reads and writes.
pub const SCHEMA_VERSION: u32 = 1;

/// The rehash window of section 6: a file modified within 2 s of the scan start is hashed.
const REHASH_WINDOW_NS: u64 = 2_000_000_000;

/// Serialized as `file` or `link`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    File,
    Link,
}

/// One manifest entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub kind: Kind,
    /// Byte length for a file. Length of the target string for a link.
    pub size: u64,
    /// Nanoseconds since the Unix epoch, from `Metadata::modified()`.
    /// A time before the epoch is stored as 0.
    pub mtime_ns: u64,
    /// `MetadataExt::ino()` on Unix. 0 on other targets.
    pub inode: u64,
    /// blake3 of the file bytes, or of the link target string. 64 lowercase hex chars.
    pub hash: String,
    /// The link target string. `None` for a file.
    pub target: Option<String>,
    /// The generation of the pass that last put this entry's content.
    pub uploaded_version: u64,
    /// True after a tombstone was written for this path.
    pub deleted: bool,
}

/// The manifest of one root on one host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: u32,
    pub host: String,
    pub root: String,
    pub generation: u64,
    /// Key: the root-relative path with `/` separators.
    pub entries: BTreeMap<String, Entry>,
}

/// One planned action for one root-relative path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Upload { rel: String, entry: Entry },
    Link { rel: String, entry: Entry },
    Tombstone { rel: String, kind: Kind },
    Touch { rel: String, stat: Stat },
}

impl Action {
    /// The root-relative path of the action.
    pub fn rel(&self) -> &str {
        match self {
            Action::Upload { rel, .. }
            | Action::Link { rel, .. }
            | Action::Tombstone { rel, .. }
            | Action::Touch { rel, .. } => rel,
        }
    }

    /// The `plan` output line, or `None` for `Touch`.
    pub fn display_line(&self, root_name: &str) -> Option<String> {
        match self {
            Action::Upload { rel, .. } => Some(format!("upload {root_name}/{rel}")),
            Action::Link { rel, entry } => {
                let target = entry.target.as_deref().unwrap_or("");
                Some(format!("link {root_name}/{rel} -> {target}"))
            }
            Action::Tombstone { rel, .. } => Some(format!("tombstone {root_name}/{rel}")),
            Action::Touch { .. } => None,
        }
    }
}

/// The actions for one root, from one diff.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Plan {
    /// Sorted by `rel`, ascending, bytewise.
    pub actions: Vec<Action>,
}

impl Plan {
    /// True when the plan holds no action.
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }

    /// Counts of upload, link, tombstone, touch, and upload bytes.
    pub fn summary(&self) -> PlanSummary {
        let mut s = PlanSummary::default();
        for a in &self.actions {
            match a {
                Action::Upload { entry, .. } => {
                    s.uploads += 1;
                    s.bytes += entry.size;
                }
                Action::Link { .. } => s.links += 1,
                Action::Tombstone { .. } => s.tombstones += 1,
                Action::Touch { .. } => s.touches += 1,
            }
        }
        s
    }
}

/// The counts of a `Plan`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PlanSummary {
    pub uploads: usize,
    pub links: usize,
    pub tombstones: usize,
    pub touches: usize,
    pub bytes: u64,
}

/// The one field read before the whole file is parsed.
#[derive(Deserialize)]
struct SchemaProbe {
    schema: u32,
}

impl Manifest {
    /// An empty manifest at generation 0 for `host` and `root`.
    pub fn new(host: &str, root: &str) -> Self {
        Self {
            schema: SCHEMA_VERSION,
            host: host.to_string(),
            root: root.to_string(),
            generation: 0,
            entries: BTreeMap::new(),
        }
    }

    /// `Ok(None)` when the file does not exist. An error for any other failure, including a schema mismatch.
    pub fn load(path: &Path) -> Result<Option<Self>, ManifestError> {
        match fs::read(path) {
            Ok(bytes) => Ok(Some(Self::from_json(&bytes)?)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(source) => Err(ManifestError::Io {
                path: path.to_path_buf(),
                source,
            }),
        }
    }

    /// Section 6, "Atomic write". Creates the parent directory when it is absent.
    pub fn write_atomic(&self, path: &Path) -> Result<(), ManifestError> {
        let bytes = self.to_json()?;
        let dir = match path.parent() {
            Some(d) if !d.as_os_str().is_empty() => d.to_path_buf(),
            _ => PathBuf::from("."),
        };
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let tmp = dir.join(format!(".{name}.tmp"));
        let io_at = |p: &Path| {
            let p = p.to_path_buf();
            move |source: std::io::Error| ManifestError::Io { path: p, source }
        };
        fs::create_dir_all(&dir).map_err(io_at(&dir))?;
        {
            let mut file = fs::File::create(&tmp).map_err(io_at(&tmp))?;
            file.write_all(&bytes).map_err(io_at(&tmp))?;
            file.sync_all().map_err(io_at(&tmp))?;
        }
        fs::rename(&tmp, path).map_err(io_at(&tmp))?;
        #[cfg(unix)]
        {
            let d = fs::File::open(&dir).map_err(io_at(&dir))?;
            d.sync_all().map_err(io_at(&dir))?;
        }
        Ok(())
    }

    /// The pretty JSON bytes of this manifest.
    pub fn to_json(&self) -> Result<Vec<u8>, ManifestError> {
        Ok(serde_json::to_vec_pretty(self)?)
    }

    /// Parse manifest bytes. A `schema` other than `SCHEMA_VERSION` is an error.
    pub fn from_json(bytes: &[u8]) -> Result<Self, ManifestError> {
        let probe: SchemaProbe = serde_json::from_slice(bytes)?;
        if probe.schema != SCHEMA_VERSION {
            return Err(ManifestError::Schema {
                found: probe.schema,
                expected: SCHEMA_VERSION,
            });
        }
        Ok(serde_json::from_slice(bytes)?)
    }

    /// Section 6, "The diff algorithm". Hashes candidates through `scan::hash_file`.
    pub fn diff(&self, root: &Path, snap: &Snapshot) -> Result<Plan, ManifestError> {
        let mut actions = Vec::new();
        for (rel, stat) in &snap.entries {
            let old = self.entries.get(rel).filter(|e| !e.deleted);
            let Some(old) = old else {
                actions.push(new_content(root, rel, stat)?);
                continue;
            };
            if old.kind != stat.kind {
                actions.push(new_content(root, rel, stat)?);
                continue;
            }
            let changed =
                old.size != stat.size || old.mtime_ns != stat.mtime_ns || old.inode != stat.inode;
            let recent = snap.started_ns.saturating_sub(stat.mtime_ns) < REHASH_WINDOW_NS;
            if !changed && !recent {
                continue;
            }
            let hash = hash_of(root, rel, stat)?;
            if hash != old.hash {
                actions.push(content_action(rel, stat, hash));
            } else {
                actions.push(Action::Touch {
                    rel: rel.clone(),
                    stat: stat.clone(),
                });
            }
        }
        for (rel, entry) in &self.entries {
            if entry.deleted || snap.entries.contains_key(rel) || !in_scope(&snap.scope, rel) {
                continue;
            }
            actions.push(Action::Tombstone {
                rel: rel.clone(),
                kind: entry.kind,
            });
        }
        actions.sort_by(|a, b| a.rel().as_bytes().cmp(b.rel().as_bytes()));
        Ok(Plan { actions })
    }

    /// Section 6, "Apply".
    pub fn apply(&mut self, plan: &Plan, report: &UploadReport) {
        let g = self.generation + 1;
        for &i in &report.done {
            let Some(action) = plan.actions.get(i) else {
                continue;
            };
            match action {
                Action::Upload { rel, entry } | Action::Link { rel, entry } => {
                    let mut entry = entry.clone();
                    if let Some((_, hash, size)) = report.rehashed.iter().find(|(j, _, _)| *j == i)
                    {
                        entry.hash = hash.clone();
                        entry.size = *size;
                    }
                    entry.uploaded_version = g;
                    entry.deleted = false;
                    self.entries.insert(rel.clone(), entry);
                }
                Action::Tombstone { rel, .. } => {
                    if let Some(e) = self.entries.get_mut(rel) {
                        e.deleted = true;
                        e.uploaded_version = g;
                    }
                }
                Action::Touch { rel, stat } => {
                    if let Some(e) = self.entries.get_mut(rel) {
                        e.size = stat.size;
                        e.mtime_ns = stat.mtime_ns;
                        e.inode = stat.inode;
                    }
                }
            }
        }
        self.generation = g;
    }

    /// The manifest file name for a root: `<root>.manifest.json` under `<state_dir>/<host>/`.
    pub fn path_for(state_dir: &Path, host: &str, root: &str) -> PathBuf {
        state_dir.join(host).join(format!("{root}.manifest.json"))
    }
}

/// True when `rel` is inside `scope`. "" covers the root's direct children only.
fn in_scope(scope: &scan::Scope, rel: &str) -> bool {
    match scope {
        scan::Scope::Full => true,
        scan::Scope::Folders(folders) => folders.iter().any(|f| {
            let f = f.trim_end_matches('/');
            if f.is_empty() {
                !rel.contains('/')
            } else {
                rel.strip_prefix(f)
                    .is_some_and(|rest| rest.starts_with('/'))
            }
        }),
    }
}

/// The hash of the content behind `stat`: the file bytes, or the link target.
fn hash_of(root: &Path, rel: &str, stat: &Stat) -> Result<String, ManifestError> {
    match stat.kind {
        Kind::File => Ok(scan::hash_file(root, rel, stat.inode)?),
        Kind::Link => Ok(scan::hash_target(stat.target.as_deref().unwrap_or(""))),
    }
}

/// The `Upload` or `Link` action for a path that is new or has new content.
fn new_content(root: &Path, rel: &str, stat: &Stat) -> Result<Action, ManifestError> {
    let hash = hash_of(root, rel, stat)?;
    Ok(content_action(rel, stat, hash))
}

/// Build `Upload` or `Link` from a stat and the hash already computed.
fn content_action(rel: &str, stat: &Stat, hash: String) -> Action {
    let entry = Entry {
        kind: stat.kind,
        size: stat.size,
        mtime_ns: stat.mtime_ns,
        inode: stat.inode,
        hash,
        target: stat.target.clone(),
        uploaded_version: 0,
        deleted: false,
    };
    let rel = rel.to_string();
    match stat.kind {
        Kind::File => Action::Upload { rel, entry },
        Kind::Link => Action::Link { rel, entry },
    }
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    /// A filesystem call failed at `path`.
    #[error("io at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// The manifest bytes did not parse.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The file carries another schema version.
    #[error("schema {found}, expected {expected}")]
    Schema { found: u32, expected: u32 },
    /// A hash of a candidate failed.
    #[error(transparent)]
    Scan(#[from] scan::ScanError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::{DenyList, Scope};
    use std::time::{Duration, SystemTime};

    const TEN_S: u64 = 10_000_000_000;

    struct Fx {
        dir: tempfile::TempDir,
        deny: DenyList,
    }

    impl Fx {
        fn new() -> Self {
            Self {
                dir: tempfile::TempDir::new().unwrap(),
                deny: DenyList::default_list().unwrap(),
            }
        }

        fn root(&self) -> &Path {
            self.dir.path()
        }

        fn write(&self, rel: &str, body: &[u8]) {
            fs::write(self.root().join(rel), body).unwrap();
        }

        fn mtime_ns(&self, rel: &str) -> u64 {
            scan::mtime_ns(&fs::metadata(self.root().join(rel)).unwrap())
        }

        fn set_mtime(&self, rel: &str, t: SystemTime) {
            let f = fs::File::options()
                .write(true)
                .open(self.root().join(rel))
                .unwrap();
            f.set_modified(t).unwrap();
        }

        fn modified(&self, rel: &str) -> SystemTime {
            fs::metadata(self.root().join(rel))
                .unwrap()
                .modified()
                .unwrap()
        }

        fn scan(&self, started_ns: u64) -> Snapshot {
            scan::scan(self.root(), &self.deny, Scope::Full, started_ns).unwrap()
        }

        /// Scan with `started_ns` 10 s after the mtime of `rel`, diff, and return the plan.
        fn plan_for(&self, m: &Manifest, rel: &str) -> Plan {
            let snap = self.scan(self.mtime_ns(rel) + TEN_S);
            m.diff(self.root(), &snap).unwrap()
        }

        /// Scan, diff, and apply with every action done.
        fn sync(&self, m: &mut Manifest, rel: &str) -> Plan {
            let plan = self.plan_for(m, rel);
            m.apply(&plan, &all_done(&plan));
            plan
        }
    }

    fn all_done(plan: &Plan) -> UploadReport {
        UploadReport {
            done: (0..plan.actions.len()).collect(),
            ..UploadReport::default()
        }
    }

    fn uploads(plan: &Plan) -> Vec<&str> {
        plan.actions
            .iter()
            .filter_map(|a| match a {
                Action::Upload { rel, .. } => Some(rel.as_str()),
                _ => None,
            })
            .collect()
    }

    fn entry(n: u64) -> Entry {
        Entry {
            kind: Kind::File,
            size: n,
            mtime_ns: n,
            inode: n,
            hash: "0".repeat(64),
            target: None,
            uploaded_version: 1,
            deleted: false,
        }
    }

    #[test]
    fn fm_1_same_size_rewrite_within_one_second_uploads() {
        let fx = Fx::new();
        fx.write("f.txt", b"aaaa");
        let mut m = Manifest::new("alpha", "root");
        let first = fx.sync(&mut m, "f.txt");
        assert_eq!(uploads(&first), vec!["f.txt"]);
        assert_eq!(m.generation, 1);
        let old = fx.modified("f.txt");

        fx.write("f.txt", b"bbbb");
        fx.set_mtime("f.txt", old + Duration::from_millis(1));
        let started = fx.mtime_ns("f.txt") + TEN_S;
        let snap = fx.scan(started);
        let plan = m.diff(fx.root(), &snap).unwrap();
        assert_eq!(uploads(&plan), vec!["f.txt"]);
        assert_eq!(plan.actions.len(), 1);

        fx.set_mtime("f.txt", old);
        assert_eq!(fx.modified("f.txt"), old);
        let snap = fx.scan(started);
        let plan = m.diff(fx.root(), &snap).unwrap();
        assert!(plan.is_empty(), "plan: {:?}", plan.actions);
    }

    #[test]
    fn fm_2_in_place_edit_without_folder_mtime_change_uploads() {
        let fx = Fx::new();
        fx.write("f.txt", b"hello");
        let mut m = Manifest::new("alpha", "root");
        fx.sync(&mut m, "f.txt");
        let folder_mtime = fx.modified(".");
        std::thread::sleep(Duration::from_millis(20));

        let mut f = fs::File::options()
            .write(true)
            .open(fx.root().join("f.txt"))
            .unwrap();
        f.write_all(b"HE").unwrap();
        f.sync_all().unwrap();
        drop(f);
        assert_eq!(fs::read(fx.root().join("f.txt")).unwrap(), b"HEllo");
        assert_eq!(fx.modified("."), folder_mtime);

        let plan = fx.plan_for(&m, "f.txt");
        assert_eq!(uploads(&plan), vec!["f.txt"]);
        assert_eq!(plan.actions.len(), 1);
    }

    #[test]
    fn fm_3_restart_with_no_changes_uploads_nothing() {
        let fx = Fx::new();
        fx.write("f.txt", b"hello");
        fx.write("g.txt", b"world");
        let state = tempfile::TempDir::new().unwrap();
        let path = Manifest::path_for(state.path(), "alpha", "root");
        {
            let mut m = Manifest::new("alpha", "root");
            let plan = fx.sync(&mut m, "f.txt");
            assert_eq!(plan.actions.len(), 2);
            m.write_atomic(&path).unwrap();
        }
        let m = Manifest::load(&path).unwrap().expect("manifest exists");
        assert_eq!(m.entries.len(), 2);
        let plan = fx.plan_for(&m, "f.txt");
        assert!(plan.is_empty(), "plan: {:?}", plan.actions);
    }

    #[test]
    fn manifest_write_atomic_roundtrips_and_leaves_no_temp() {
        let state = tempfile::TempDir::new().unwrap();
        let path = state.path().join("m.json");
        let mut m = Manifest::new("alpha", "root");
        m.entries.insert("a".to_string(), entry(1));
        m.entries.insert(
            "l".to_string(),
            Entry {
                kind: Kind::Link,
                target: Some("../t".to_string()),
                ..entry(2)
            },
        );
        m.generation = 3;
        m.write_atomic(&path).unwrap();
        let names: Vec<_> = fs::read_dir(state.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec!["m.json"]);
        assert_eq!(Manifest::load(&path).unwrap(), Some(m));
    }

    #[test]
    fn manifest_write_atomic_replaces_whole_file() {
        let state = tempfile::TempDir::new().unwrap();
        let path = state.path().join("m.json");
        let mut m3 = Manifest::new("alpha", "root");
        for k in ["a", "b", "c"] {
            m3.entries.insert(k.to_string(), entry(1));
        }
        m3.write_atomic(&path).unwrap();
        assert_eq!(Manifest::load(&path).unwrap().unwrap().entries.len(), 3);
        fs::write(state.path().join(".m.json.tmp"), b"stale garbage").unwrap();

        let mut m1 = Manifest::new("alpha", "root");
        m1.entries.insert("z".to_string(), entry(9));
        m1.write_atomic(&path).unwrap();
        let loaded = Manifest::load(&path).unwrap().unwrap();
        assert_eq!(loaded.entries.len(), 1);
        assert_eq!(loaded, m1);
        let names: Vec<_> = fs::read_dir(state.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec!["m.json"]);
    }

    #[test]
    fn diff_marks_missing_entry_as_tombstone() {
        let fx = Fx::new();
        fx.write("f.txt", b"hello");
        fx.write("keep.txt", b"keep");
        let mut m = Manifest::new("alpha", "root");
        fx.sync(&mut m, "f.txt");
        fs::remove_file(fx.root().join("f.txt")).unwrap();
        let plan = fx.plan_for(&m, "keep.txt");
        assert_eq!(
            plan.actions,
            vec![Action::Tombstone {
                rel: "f.txt".to_string(),
                kind: Kind::File
            }]
        );
    }

    #[test]
    fn diff_recent_mtime_forces_rehash() {
        let fx = Fx::new();
        fx.write("f.txt", b"aaaa");
        let mut m = Manifest::new("alpha", "root");
        fx.sync(&mut m, "f.txt");
        let old = fx.modified("f.txt");
        let old_ns = fx.mtime_ns("f.txt");

        fx.write("f.txt", b"bbbb");
        fx.set_mtime("f.txt", old);
        assert_eq!(fx.mtime_ns("f.txt"), old_ns);

        let snap = fx.scan(old_ns + 1_000_000_000);
        let plan = m.diff(fx.root(), &snap).unwrap();
        assert_eq!(uploads(&plan), vec!["f.txt"]);

        let snap = fx.scan(old_ns + TEN_S);
        let plan = m.diff(fx.root(), &snap).unwrap();
        assert!(plan.is_empty(), "plan: {:?}", plan.actions);
    }

    #[test]
    fn diff_metadata_only_change_is_touch() {
        let fx = Fx::new();
        fx.write("f.txt", b"hello");
        let mut m = Manifest::new("alpha", "root");
        fx.sync(&mut m, "f.txt");
        let old = fx.modified("f.txt");
        fx.set_mtime("f.txt", old + Duration::from_secs(1));
        let plan = fx.plan_for(&m, "f.txt");
        assert!(uploads(&plan).is_empty());
        assert_eq!(plan.actions.len(), 1);
        let Action::Touch { rel, stat } = &plan.actions[0] else {
            panic!("expected Touch, got {:?}", plan.actions[0]);
        };
        assert_eq!(rel, "f.txt");
        assert_eq!(stat.mtime_ns, fx.mtime_ns("f.txt"));
        assert!(plan.actions[0].display_line("root").is_none());
        m.apply(&plan, &all_done(&plan));
        assert_eq!(m.entries["f.txt"].mtime_ns, fx.mtime_ns("f.txt"));
        assert_eq!(m.entries["f.txt"].uploaded_version, 1);
        assert_eq!(m.generation, 2);
    }

    #[test]
    fn diff_scope_folders_tombstones_only_inside_scope() {
        let fx = Fx::new();
        fs::create_dir_all(fx.root().join("a/b")).unwrap();
        fs::create_dir_all(fx.root().join("c")).unwrap();
        fx.write("top.txt", b"t");
        fx.write("a/b/x.txt", b"x");
        fx.write("c/y.txt", b"y");
        let mut m = Manifest::new("alpha", "root");
        fx.sync(&mut m, "top.txt");
        assert_eq!(m.entries.len(), 3);
        fs::remove_file(fx.root().join("a/b/x.txt")).unwrap();
        fs::remove_file(fx.root().join("c/y.txt")).unwrap();
        fs::remove_file(fx.root().join("top.txt")).unwrap();

        let started = m.entries["a/b/x.txt"].mtime_ns + TEN_S;
        let snap = scan::scan(
            fx.root(),
            &fx.deny,
            Scope::Folders(vec!["a".to_string()]),
            started,
        )
        .unwrap();
        let plan = m.diff(fx.root(), &snap).unwrap();
        let rels: Vec<&str> = plan.actions.iter().map(Action::rel).collect();
        assert_eq!(rels, vec!["a/b/x.txt"]);

        let snap = scan::scan(
            fx.root(),
            &fx.deny,
            Scope::Folders(vec![String::new()]),
            started,
        )
        .unwrap();
        let plan = m.diff(fx.root(), &snap).unwrap();
        let rels: Vec<&str> = plan.actions.iter().map(Action::rel).collect();
        assert_eq!(rels, vec!["top.txt"]);
    }

    #[test]
    fn diff_link_retarget_and_display_lines() {
        let fx = Fx::new();
        std::os::unix::fs::symlink("../t", fx.root().join("l")).unwrap();
        fx.write("f.txt", b"f");
        let mut m = Manifest::new("alpha", "root");
        let plan = fx.sync(&mut m, "f.txt");
        let lines: Vec<String> = plan
            .actions
            .iter()
            .filter_map(|a| a.display_line("claude"))
            .collect();
        assert_eq!(lines, vec!["upload claude/f.txt", "link claude/l -> ../t"]);
        assert_eq!(m.entries["l"].hash, scan::hash_target("../t"));

        fs::remove_file(fx.root().join("l")).unwrap();
        std::os::unix::fs::symlink("../u", fx.root().join("l")).unwrap();
        let plan = fx.plan_for(&m, "f.txt");
        assert_eq!(plan.actions.len(), 1);
        assert!(
            matches!(&plan.actions[0], Action::Link { rel, entry } if rel == "l" && entry.target.as_deref() == Some("../u"))
        );
        let s = plan.summary();
        assert_eq!((s.uploads, s.links, s.tombstones, s.touches), (0, 1, 0, 0));
    }

    #[test]
    fn apply_records_only_done_and_rehashed() {
        let fx = Fx::new();
        fx.write("a.txt", b"aa");
        fx.write("b.txt", b"bbb");
        let mut m = Manifest::new("alpha", "root");
        let plan = fx.plan_for(&m, "a.txt");
        assert_eq!(uploads(&plan), vec!["a.txt", "b.txt"]);
        assert_eq!(plan.summary().bytes, 5);
        let report = UploadReport {
            done: vec![0],
            bytes: 2,
            failed: Some((1, "boom".to_string())),
            rehashed: vec![(0, "f".repeat(64), 7)],
        };
        m.apply(&plan, &report);
        assert_eq!(m.generation, 1);
        assert_eq!(m.entries.len(), 1);
        assert_eq!(m.entries["a.txt"].hash, "f".repeat(64));
        assert_eq!(m.entries["a.txt"].size, 7);
        assert_eq!(m.entries["a.txt"].uploaded_version, 1);

        fs::remove_file(fx.root().join("a.txt")).unwrap();
        let plan = fx.plan_for(&m, "b.txt");
        let rels: Vec<&str> = plan.actions.iter().map(Action::rel).collect();
        assert_eq!(rels, vec!["a.txt", "b.txt"]);
        m.apply(&plan, &all_done(&plan));
        assert!(m.entries["a.txt"].deleted);
        assert_eq!(m.entries["a.txt"].uploaded_version, 2);
        assert_eq!(m.entries["b.txt"].uploaded_version, 2);
        let plan = fx.plan_for(&m, "b.txt");
        assert!(plan.is_empty());
    }

    #[test]
    fn diff_never_hashes_a_file_swapped_for_a_symlink_after_scan() {
        let base = tempfile::TempDir::new().unwrap();
        let root = base.path().join("root");
        let outside = base.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(root.join("notes.txt"), b"harmless").unwrap();
        fs::write(outside.join("secret.txt"), b"OUTSIDE SECRET BYTES").unwrap();
        let secret = blake3::hash(b"OUTSIDE SECRET BYTES").to_hex().to_string();
        let deny = DenyList::default_list().unwrap();
        let snap = scan::scan(&root, &deny, Scope::Full, 0).unwrap();
        assert!(snap.entries.contains_key("notes.txt"));

        // Swap the scanned file for a symlink to the secret between scan and diff.
        fs::remove_file(root.join("notes.txt")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.txt"), root.join("notes.txt")).unwrap();

        let mut m = Manifest::new("alpha", "root");
        let got = m.diff(&root, &snap);
        if let Ok(plan) = &got {
            m.apply(plan, &all_done(plan));
            let leaked = plan.actions.iter().any(|a| match a {
                Action::Upload { entry, .. } | Action::Link { entry, .. } => entry.hash == secret,
                _ => false,
            });
            assert!(!leaked, "the secret hash entered the plan: {plan:?}");
        }
        assert!(
            m.entries.values().all(|e| e.hash != secret),
            "the secret hash entered the manifest"
        );
        assert!(got.is_err(), "{got:?}");
    }

    #[test]
    fn load_rejects_other_schema_and_missing_is_none() {
        let state = tempfile::TempDir::new().unwrap();
        let path = state.path().join("m.json");
        assert_eq!(Manifest::load(&path).unwrap(), None);
        fs::write(&path, br#"{"schema": 2, "host": "alpha"}"#).unwrap();
        let err = Manifest::load(&path).unwrap_err();
        assert!(matches!(
            err,
            ManifestError::Schema {
                found: 2,
                expected: 1
            }
        ));
        let json = Manifest::new("alpha", "root").to_json().unwrap();
        let text = String::from_utf8(json).unwrap();
        assert!(text.contains("\"schema\": 1"));
        assert_eq!(
            Manifest::path_for(Path::new("s"), "alpha", "claude"),
            Path::new("s/alpha/claude.manifest.json")
        );
    }
}
