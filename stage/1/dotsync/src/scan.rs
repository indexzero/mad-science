//! The deny list, the walk, the stat, and the hash of section 8.1.
//!
//! This module never writes to disk and never touches the store. It never
//! follows a symlink. It reads a file body only in `hash_file`.

use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};

use crate::manifest::Kind;

/// The default deny patterns. See Decision 4.2.
pub const DEFAULT_DENY: &[&str] = &[
    "**/.credentials.json",
    "**/*.pem",
    "**/*token*",
    "**/*secret*",
    "cache/**",
    "paste-cache/**",
    "shell-snapshots/**",
    "debug/**",
    "skills/.trash/**",
    "*-cache.json",
    "**/.DS_Store",
    "**/.credentials.json*",
];

/// The size of one read in `hash_file`.
const HASH_CHUNK: usize = 64 * 1024;

/// A compiled set of deny patterns and the source strings behind it.
#[derive(Debug, Clone)]
pub struct DenyList {
    set: GlobSet,
    patterns: Vec<String>,
}

impl DenyList {
    /// Build from patterns. Every pattern uses `literal_separator(true)` and `case_insensitive(true)`.
    pub fn new(patterns: &[&str]) -> Result<Self, ScanError> {
        let mut builder = GlobSetBuilder::new();
        for p in patterns {
            let glob = GlobBuilder::new(p)
                .literal_separator(true)
                .case_insensitive(true)
                .build()?;
            builder.add(glob);
        }
        let set = builder.build()?;
        Ok(Self {
            set,
            patterns: patterns.iter().map(|p| (*p).to_string()).collect(),
        })
    }

    /// The default list.
    pub fn default_list() -> Result<Self, ScanError> {
        Self::new(DEFAULT_DENY)
    }

    /// True when the root-relative path matches any pattern. `scan` passes `<rel>` for a
    /// file and `<rel>/` for a directory, so only a `/**` pattern prunes a directory and
    /// a name pattern such as `**/*token*` applies to files only (Decision 4.2).
    pub fn is_denied(&self, rel: &str) -> bool {
        self.set.is_match(rel)
    }

    /// The source patterns, in the order given to `new`.
    pub fn patterns(&self) -> &[String] {
        &self.patterns
    }
}

/// What part of a root one scan covers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    /// The whole root, recursively.
    Full,
    /// Root-relative folders. Each is rescanned recursively, except "" which names
    /// the root's direct children only, at depth 1, never the whole tree.
    Folders(Vec<String>),
}

/// The stat of one entry on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stat {
    /// File or link.
    pub kind: Kind,
    /// Byte length for a file. Length of the target string for a link.
    pub size: u64,
    /// Nanoseconds since the Unix epoch, 0 before the epoch.
    pub mtime_ns: u64,
    /// The inode on Unix, 0 elsewhere.
    pub inode: u64,
    /// Set for a link only.
    pub target: Option<String>,
}

/// The result of one scan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// The scope the scan covered.
    pub scope: Scope,
    /// Wall-clock nanoseconds since the epoch when the scan started.
    pub started_ns: u64,
    /// Root-relative path with `/` separators, to its stat.
    pub entries: BTreeMap<String, Stat>,
    /// Paths skipped with a reason: not UTF-8, special file, denied.
    pub skipped: Vec<(PathBuf, SkipReason)>,
}

/// Why a path did not enter the snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// The deny list matched.
    Denied,
    /// A path component is not UTF-8.
    NotUtf8,
    /// Not a regular file, a link, or a directory.
    Special,
}

/// Walk `root` within `scope`. Stat every entry. Never follow a symlink.
/// Never read a file body. A denied directory is pruned. It is recorded once in
/// `skipped` as `(<abs dir>, Denied)`. The prune test passes the
/// directory's relative path with a trailing slash to `is_denied`.
/// A folder named in `Scope::Folders` that no longer exists yields no entries for that
/// folder. It is not an error. Its manifest entries then become tombstones in the diff.
pub fn scan(
    root: &Path,
    deny: &DenyList,
    scope: Scope,
    started_ns: u64,
) -> Result<Snapshot, ScanError> {
    let root_md = fs::symlink_metadata(root).map_err(|source| ScanError::Io {
        path: root.to_path_buf(),
        source,
    })?;
    if !root_md.is_dir() {
        return Err(ScanError::NotADirectory(root.to_path_buf()));
    }
    let mut snap = Snapshot {
        scope: scope.clone(),
        started_ns,
        entries: BTreeMap::new(),
        skipped: Vec::new(),
    };
    match scope {
        Scope::Full => walk_dir(root, "", deny, true, &mut snap)?,
        Scope::Folders(folders) => {
            for folder in &folders {
                scan_folder(root, folder, deny, &mut snap)?;
            }
        }
    }
    Ok(snap)
}

/// Scan one folder named by `Scope::Folders`. "" covers depth 1 of the root only.
/// A folder that is denied, missing, or not a directory yields no entries.
fn scan_folder(
    root: &Path,
    folder: &str,
    deny: &DenyList,
    snap: &mut Snapshot,
) -> Result<(), ScanError> {
    let folder = folder.trim_end_matches('/');
    if folder.is_empty() {
        return walk_dir(root, "", deny, false, snap);
    }
    let abs = root.join(folder);
    if deny.is_denied(&format!("{folder}/")) {
        snap.skipped.push((abs, SkipReason::Denied));
        return Ok(());
    }
    match fs::symlink_metadata(&abs) {
        Ok(md) if md.is_dir() => walk_dir(root, folder, deny, true, snap),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(ScanError::Io { path: abs, source }),
    }
}

/// Walk the directory at `root/rel_dir`. `recurse` false stops at depth 1.
fn walk_dir(
    root: &Path,
    rel_dir: &str,
    deny: &DenyList,
    recurse: bool,
    snap: &mut Snapshot,
) -> Result<(), ScanError> {
    let abs_dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };
    let read = fs::read_dir(&abs_dir).map_err(|source| ScanError::Io {
        path: abs_dir.clone(),
        source,
    })?;
    for item in read {
        let entry = item.map_err(|source| ScanError::Io {
            path: abs_dir.clone(),
            source,
        })?;
        let abs = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            snap.skipped.push((abs, SkipReason::NotUtf8));
            continue;
        };
        let rel = if rel_dir.is_empty() {
            name.to_string()
        } else {
            format!("{rel_dir}/{name}")
        };
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(source) => return Err(ScanError::Io { path: abs, source }),
        };
        if ft.is_dir() {
            if deny.is_denied(&format!("{rel}/")) {
                snap.skipped.push((abs, SkipReason::Denied));
            } else if recurse {
                walk_dir(root, &rel, deny, true, snap)?;
            }
            continue;
        }
        if deny.is_denied(&rel) {
            snap.skipped.push((abs, SkipReason::Denied));
            continue;
        }
        match stat_entry(&abs) {
            Ok(Some(stat)) => {
                snap.entries.insert(rel, stat);
            }
            Ok(None) => snap.skipped.push((abs, SkipReason::Special)),
            Err(ScanError::Io { source, .. }) if source.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Stat one path and classify it. Used by `scan` and by tests.
/// `Ok(None)` for a directory, a special file, or a link whose target is not UTF-8.
pub fn stat_entry(abs: &Path) -> Result<Option<Stat>, ScanError> {
    let md = fs::symlink_metadata(abs).map_err(|source| ScanError::Io {
        path: abs.to_path_buf(),
        source,
    })?;
    let ft = md.file_type();
    if ft.is_symlink() {
        let target = fs::read_link(abs).map_err(|source| ScanError::Io {
            path: abs.to_path_buf(),
            source,
        })?;
        let Some(target) = target.to_str().map(str::to_string) else {
            return Ok(None);
        };
        return Ok(Some(Stat {
            kind: Kind::Link,
            size: target.len() as u64,
            mtime_ns: mtime_ns(&md),
            inode: inode(&md),
            target: Some(target),
        }));
    }
    if ft.is_file() {
        return Ok(Some(Stat {
            kind: Kind::File,
            size: md.len(),
            mtime_ns: mtime_ns(&md),
            inode: inode(&md),
            target: None,
        }));
    }
    Ok(None)
}

/// blake3 of the file bytes at `root/rel`, as 64 lowercase hex chars.
/// Reads in 64 KiB chunks through `blake3::Hasher::update`.
pub fn hash_file(root: &Path, rel: &str) -> Result<String, ScanError> {
    let abs = root.join(rel);
    let io = |source: std::io::Error| ScanError::Io {
        path: abs.clone(),
        source,
    };
    let mut file = fs::File::open(&abs).map_err(io)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0u8; HASH_CHUNK];
    loop {
        let n = file.read(&mut buf).map_err(io)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

/// blake3 of a link target string.
pub fn hash_target(target: &str) -> String {
    blake3::hash(target.as_bytes()).to_hex().to_string()
}

/// `Metadata::modified()` as nanoseconds since the epoch, 0 before the epoch.
pub fn mtime_ns(md: &fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// `MetadataExt::ino()` on Unix, 0 elsewhere.
#[cfg(unix)]
pub fn inode(md: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    md.ino()
}

/// `MetadataExt::ino()` on Unix, 0 elsewhere.
#[cfg(not(unix))]
pub fn inode(_md: &fs::Metadata) -> u64 {
    0
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    /// A filesystem call failed at `path`.
    #[error("io at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// A deny pattern did not compile.
    #[error("deny pattern: {0}")]
    Glob(#[from] globset::Error),
    /// The root is not a directory.
    #[error("root is not a directory: {0}")]
    NotADirectory(PathBuf),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn write(root: &Path, rel: &str, body: &[u8]) {
        let abs = root.join(rel);
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(abs, body).unwrap();
    }

    #[test]
    fn scan_symlink_records_target_not_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        symlink("nowhere/dangling", root.join("l")).unwrap();
        let deny = DenyList::default_list().unwrap();
        let snap = scan(root, &deny, Scope::Full, 0).unwrap();
        let stat = snap.entries.get("l").expect("link entry");
        assert_eq!(stat.kind, Kind::Link);
        assert_eq!(stat.target.as_deref(), Some("nowhere/dangling"));
        assert_eq!(stat.size, "nowhere/dangling".len() as u64);
        assert!(snap.skipped.is_empty());
        assert_eq!(snap.entries.len(), 1);
    }

    #[test]
    fn scan_denylist_prunes_and_skips() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        write(root, ".credentials.json", b"{}");
        write(root, "cache/x", b"x");
        write(root, "sub/token.txt", b"t");
        write(root, "SECRET.md", b"s");
        write(root, "ok.txt", b"ok");
        let deny = DenyList::default_list().unwrap();
        let snap = scan(root, &deny, Scope::Full, 0).unwrap();
        let keys: Vec<&String> = snap.entries.keys().collect();
        assert_eq!(keys, vec!["ok.txt"]);
        let denied: Vec<&PathBuf> = snap
            .skipped
            .iter()
            .filter(|(_, r)| *r == SkipReason::Denied)
            .map(|(p, _)| p)
            .collect();
        assert_eq!(denied.len(), 4, "skipped: {:?}", snap.skipped);
        assert_eq!(snap.skipped.len(), 4);
        for rel in [".credentials.json", "sub/token.txt", "SECRET.md", "cache"] {
            assert!(denied.contains(&&root.join(rel)), "missing {rel}");
        }
    }

    #[test]
    fn scan_scope_folders_is_recursive() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a/b/c.txt", b"c");
        write(root, "d/e.txt", b"e");
        let deny = DenyList::default_list().unwrap();
        let snap = scan(root, &deny, Scope::Folders(vec!["a".to_string()]), 0).unwrap();
        assert!(snap.entries.contains_key("a/b/c.txt"));
        assert!(!snap.entries.contains_key("d/e.txt"));
        assert_eq!(snap.entries.len(), 1);
    }

    #[test]
    fn scan_scope_empty_folder_is_depth_one() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        write(root, "top.txt", b"t");
        write(root, "a/b.txt", b"b");
        let deny = DenyList::default_list().unwrap();
        let snap = scan(root, &deny, Scope::Folders(vec![String::new()]), 0).unwrap();
        let keys: Vec<&String> = snap.entries.keys().collect();
        assert_eq!(keys, vec!["top.txt"]);
    }

    #[test]
    fn scan_missing_folder_yields_no_entries() {
        let dir = tempfile::TempDir::new().unwrap();
        let deny = DenyList::default_list().unwrap();
        let snap = scan(
            dir.path(),
            &deny,
            Scope::Folders(vec!["gone".to_string()]),
            0,
        )
        .unwrap();
        assert!(snap.entries.is_empty());
    }

    #[test]
    fn deny_directory_form_matches_only_slash_patterns() {
        let deny = DenyList::default_list().unwrap();
        assert!(deny.is_denied("cache/"));
        assert!(deny.is_denied("skills/.trash/"));
        assert!(!deny.is_denied("tokens/"));
        assert!(!deny.is_denied("tokens/a.txt"));
        assert!(deny.is_denied("tokens/token.txt"));
        assert!(deny.is_denied("TOKEN.pem"));
        assert!(deny.is_denied("x-cache.json"));
        assert!(!deny.is_denied("sub/x-cache.json"));
        assert!(deny.is_denied("a/.credentials.json.bak"));
        assert!(!deny.is_denied("projects/x/y.jsonl"));
        assert_eq!(deny.patterns().len(), DEFAULT_DENY.len());
    }

    #[test]
    fn hash_file_matches_hash_of_bytes() {
        let dir = tempfile::TempDir::new().unwrap();
        let body = vec![7u8; HASH_CHUNK * 3 + 11];
        write(dir.path(), "big.bin", &body);
        let got = hash_file(dir.path(), "big.bin").unwrap();
        assert_eq!(got, blake3::hash(&body).to_hex().to_string());
        assert_eq!(got.len(), 64);
        assert_eq!(
            hash_target("../t"),
            blake3::hash(b"../t").to_hex().to_string()
        );
    }

    #[test]
    fn scan_root_must_be_a_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        write(dir.path(), "f", b"f");
        let deny = DenyList::default_list().unwrap();
        let err = scan(&dir.path().join("f"), &deny, Scope::Full, 0).unwrap_err();
        assert!(matches!(err, ScanError::NotADirectory(_)));
    }
}
