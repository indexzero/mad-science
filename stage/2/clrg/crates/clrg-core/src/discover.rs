//! Root and store discovery: which files a root holds, which store each file
//! belongs to, how to read it, and which session it belongs to by path.
//!
//! The walk uses the `ignore` crate's parallel walker configured like
//! `rg -uu`: hidden files are searched, ignore files are not read, and
//! symlinks are not followed.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use ignore::{WalkBuilder, WalkParallel};

use crate::StoreKind;

/// How a file's bytes are read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFormat {
    /// One JSON value per line.
    Jsonl,
    /// One JSON document.
    Json,
    /// Plain text, matched line by line.
    Text,
}

/// A file found under a root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreFile {
    /// Index into the roots, in the order given.
    pub root: usize,
    /// The store the file belongs to.
    pub store: StoreKind,
    /// How to read it.
    pub format: FileFormat,
    /// The session the path names, if any.
    pub session: Option<String>,
    /// The encoded `projects/<dir>` name (transcripts only).
    pub project: Option<String>,
    /// The file is under a session's `subagents/` folder.
    pub subagent: bool,
    /// The file is a transcript (main or subagent): its lines carry a raw
    /// `type`. Other files under `projects/` (`tool-results/`, `*.meta.json`,
    /// `journal.jsonl`, anything unclaimed) are searched with `type: null`.
    pub transcript: bool,
    /// The part label every hit in the file has. Always `None` today: a
    /// saved tool output (`projects/<dir>/<sid>/tool-results/*`) is
    /// `part: null`, because a folder name is not a label (R9).
    pub part: Option<&'static str>,
}

fn normal_components(rel: &Path) -> Vec<&OsStr> {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s),
            _ => None,
        })
        .collect()
}

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension().and_then(OsStr::to_str) == Some(ext)
}

fn stem(path: &Path) -> Option<String> {
    path.file_stem().and_then(OsStr::to_str).map(str::to_string)
}

/// Classify `path`, a file under root number `root` at `root_path`. Every
/// file under the root is claimed: a file no other store claims is store
/// `other` (R3). `None` only when `path` is not under `root_path`.
#[must_use]
pub fn classify(root: usize, root_path: &Path, path: &Path) -> Option<StoreFile> {
    let rel = path.strip_prefix(root_path).ok()?;
    let comps = normal_components(rel);
    let first = comps.first()?.to_str()?;
    let second = comps.get(1).and_then(|c| c.to_str()).map(str::to_string);
    let nested = comps.len() > 2;
    let json_or = |fallback: FileFormat| {
        if has_ext(path, "jsonl") {
            FileFormat::Jsonl
        } else if has_ext(path, "json") {
            FileFormat::Json
        } else {
            fallback
        }
    };
    let file = |store, format, session| StoreFile {
        root,
        store,
        format,
        session,
        project: None,
        subagent: false,
        transcript: false,
        part: None,
    };
    match first {
        "projects" => Some(project_file(
            &comps,
            path,
            file(StoreKind::Transcripts, json_or(FileFormat::Text), None),
        )),
        "history.jsonl" if comps.len() == 1 => {
            Some(file(StoreKind::History, FileFormat::Jsonl, None))
        }
        "plans" if comps.len() >= 2 => Some(file(StoreKind::Plans, FileFormat::Text, None)),
        "todos" if comps.len() >= 2 => {
            // todos/<sid>-agent-<id>.json
            let session = stem(path).map(|s| match s.split_once("-agent-") {
                Some((sid, _)) => sid.to_string(),
                None => s,
            });
            Some(file(StoreKind::Todos, json_or(FileFormat::Text), session))
        }
        "tasks" if comps.len() >= 2 => {
            let session = if nested { second } else { stem(path) };
            Some(file(StoreKind::Tasks, json_or(FileFormat::Text), session))
        }
        "file-history" if nested => {
            // Raw backups of any file: always text, even when named .json.
            Some(file(StoreKind::FileHistory, FileFormat::Text, second))
        }
        "sessions" if comps.len() >= 2 => {
            // The session id comes from the document's `sessionId`, if any.
            Some(file(StoreKind::Sessions, json_or(FileFormat::Text), None))
        }
        // Everything else (root-level files, unknown folders, loose files
        // directly in `file-history/`): read by its extension, no session.
        _ => Some(file(StoreKind::Other, json_or(FileFormat::Text), None)),
    }
}

/// Classify a file under `projects/`. `base` is an unclaimed file: store
/// `transcripts`, read by its extension, no session. Every file under
/// `projects/` is claimed by something (R3):
///
/// - `projects/<dir>/<sid>.jsonl`: a main transcript.
/// - `projects/<dir>/<sid>/subagents/**/*.jsonl` (not `journal.jsonl`): a
///   subagent transcript. Other files under `subagents/` (`*.meta.json`,
///   `journal.jsonl`) are subagent files with `type: null`.
/// - `projects/<dir>/<sid>/tool-results/<file>`: a saved tool output, text,
///   `type: null`, `part: null` (R9: the folder name is not a label).
/// - `projects/<dir>/<sid>/workflows/**`: store `workflows`.
/// - anything else: `base`, attributed to `<sid>` when it is under a
///   session folder.
fn project_file(comps: &[&OsStr], path: &Path, base: StoreFile) -> StoreFile {
    let name = |i: usize| comps.get(i).and_then(|c| c.to_str()).map(str::to_string);
    if comps.len() < 3 {
        // projects/<file>: no project folder, no session.
        return base;
    }
    let base = StoreFile {
        project: name(1),
        ..base
    };
    if comps.len() == 3 {
        return if has_ext(path, "jsonl") {
            StoreFile {
                session: stem(path),
                transcript: true,
                format: FileFormat::Jsonl,
                ..base
            }
        } else {
            base
        };
    }
    let base = StoreFile {
        session: name(2),
        ..base
    };
    match comps[3].to_str() {
        Some("tool-results") if comps.len() >= 5 => StoreFile {
            format: FileFormat::Text,
            ..base
        },
        Some("workflows") => StoreFile {
            store: StoreKind::Workflows,
            ..base
        },
        Some("subagents") => StoreFile {
            subagent: true,
            transcript: has_ext(path, "jsonl")
                && path.file_name().and_then(OsStr::to_str) != Some(JOURNAL),
            ..base
        },
        _ => base,
    }
}

/// The workflow journal beside a workflow's subagent transcripts:
/// `projects/<dir>/<sid>/subagents/workflows/<wf>/journal.jsonl`.
pub const JOURNAL: &str = "journal.jsonl";

/// Whether `name`, directly under a root, is a store's own entry
/// (`projects`, `history.jsonl`, `plans`, ...).
fn is_store_entry(name: &OsStr) -> bool {
    StoreKind::ALL
        .iter()
        .any(|s| !s.entry().is_empty() && name == s.entry())
}

/// The entries directly under `root` (sorted), split into those to walk and
/// the symlinks that are not followed. A store's own entry is walked even
/// when it is a symlink, as it always was: the walker follows the paths it
/// is given. Any other symlink is skipped.
fn root_entries(root: &Path) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut all: Vec<PathBuf> = std::fs::read_dir(root)
        .map(|d| d.filter_map(Result::ok).map(|e| e.path()).collect())
        .unwrap_or_default();
    all.sort();
    all.into_iter().partition(|p| {
        let link = p
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink());
        !link || p.file_name().is_some_and(is_store_entry)
    })
}

/// The symlinks directly under `root` that a walk for `stores` does not
/// follow (only `other` walks the whole root). Symlinks deeper down are
/// counted by the walker.
#[must_use]
pub fn skipped_root_symlinks(root: &Path, stores: &[StoreKind]) -> u64 {
    if stores.contains(&StoreKind::Other) {
        root_entries(root).1.len() as u64
    } else {
        0
    }
}

/// The paths to walk in `root` for `stores`, keeping only those that exist.
/// Stores that share an entry (`transcripts` and `workflows` both live under
/// `projects/`) walk it once. With `other`, every entry of the root is walked
/// (each one a walk path, so a symlinked root is still read), except
/// symlinks that are not a store's entry (see [`skipped_root_symlinks`]).
#[must_use]
pub fn store_paths(root: &Path, stores: &[StoreKind]) -> Vec<PathBuf> {
    if stores.contains(&StoreKind::Other) {
        return root_entries(root).0;
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for s in stores {
        let p = root.join(s.entry());
        if !out.contains(&p) && p.symlink_metadata().is_ok() {
            out.push(p);
        }
    }
    out
}

/// A parallel walker over `paths`, configured like `rg -uu`.
#[must_use]
pub fn walker(paths: &[PathBuf]) -> Option<WalkParallel> {
    let (first, rest) = paths.split_first()?;
    let mut b = WalkBuilder::new(first);
    for p in rest {
        b.add(p);
    }
    b.standard_filters(false)
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .require_git(false)
        .follow_links(false)
        .threads(0);
    Some(b.build_parallel())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(rel: &str) -> Option<StoreFile> {
        classify(0, Path::new("/r"), &Path::new("/r").join(rel))
    }

    #[test]
    fn transcripts_and_subagents() {
        let t = c("projects/-w-app/s1.jsonl").unwrap();
        assert_eq!(t.store, StoreKind::Transcripts);
        assert_eq!(t.session.as_deref(), Some("s1"));
        assert_eq!(t.project.as_deref(), Some("-w-app"));
        assert!(!t.subagent);
        let s = c("projects/-w-app/s1/subagents/agent-a1.jsonl").unwrap();
        assert_eq!(s.session.as_deref(), Some("s1"));
        assert!(s.subagent);
        for name in ["x.txt", "y.jsonl"] {
            let tr = c(&format!("projects/-w-app/s1/tool-results/{name}")).unwrap();
            assert_eq!(
                (tr.store, tr.format, tr.part, tr.transcript),
                (StoreKind::Transcripts, FileFormat::Text, None, false)
            );
            assert_eq!(tr.session.as_deref(), Some("s1"));
            assert_eq!(tr.project.as_deref(), Some("-w-app"));
            assert!(!tr.subagent);
        }
    }

    #[test]
    fn every_file_under_projects_is_claimed() {
        let wf = c("projects/-w-app/s1/workflows/run-1.json").unwrap();
        assert_eq!(
            (wf.store, wf.format, wf.session.as_deref(), wf.transcript),
            (StoreKind::Workflows, FileFormat::Json, Some("s1"), false)
        );
        let agent = c("projects/-w-app/s1/subagents/workflows/wf1/agent-a1.jsonl").unwrap();
        assert!(agent.transcript && agent.subagent);
        assert_eq!(agent.session.as_deref(), Some("s1"));
        for (rel, format) in [
            (
                "projects/-w-app/s1/subagents/agent-a1.meta.json",
                FileFormat::Json,
            ),
            (
                "projects/-w-app/s1/subagents/workflows/wf1/journal.jsonl",
                FileFormat::Jsonl,
            ),
        ] {
            let f = c(rel).unwrap();
            assert_eq!(
                (
                    f.store,
                    f.format,
                    f.transcript,
                    f.subagent,
                    f.session.as_deref()
                ),
                (StoreKind::Transcripts, format, false, true, Some("s1")),
                "{rel}"
            );
        }
        let odd = c("projects/-w-app/s1/odd/x.bin").unwrap();
        assert_eq!(
            (
                odd.store,
                odd.format,
                odd.transcript,
                odd.session.as_deref()
            ),
            (StoreKind::Transcripts, FileFormat::Text, false, Some("s1"))
        );
        let loose = c("projects/-w-app/notes.txt").unwrap();
        assert_eq!((loose.session, loose.transcript), (None, false));
        assert_eq!(loose.project.as_deref(), Some("-w-app"));
        let top = c("projects/README").unwrap();
        assert_eq!(
            (top.store, top.project, top.session),
            (StoreKind::Transcripts, None, None)
        );
        assert!(c("projects/-w-app/s1.jsonl").unwrap().transcript);
    }

    #[test]
    fn shared_entries_are_walked_once() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("projects")).unwrap();
        let paths = store_paths(dir.path(), &StoreKind::ALL[..8]);
        assert_eq!(paths, vec![dir.path().join("projects")]);
        std::fs::write(dir.path().join("settings.json"), "{}").unwrap();
        let paths = store_paths(dir.path(), &StoreKind::ALL);
        assert_eq!(
            paths,
            vec![
                dir.path().join("projects"),
                dir.path().join("settings.json")
            ]
        );
    }

    #[test]
    fn other_stores_attribute_sessions_by_path() {
        assert_eq!(c("history.jsonl").unwrap().store, StoreKind::History);
        let todo = c("todos/s1-agent-a1.json").unwrap();
        assert_eq!(
            (todo.store, todo.format),
            (StoreKind::Todos, FileFormat::Json)
        );
        assert_eq!(todo.session.as_deref(), Some("s1"));
        assert_eq!(c("tasks/s1/1.json").unwrap().session.as_deref(), Some("s1"));
        let fh = c("file-history/s1/abc@v2").unwrap();
        assert_eq!(
            (fh.store, fh.format),
            (StoreKind::FileHistory, FileFormat::Text)
        );
        assert_eq!(fh.session.as_deref(), Some("s1"));
        let plan = c("plans/brave-otter.md").unwrap();
        assert_eq!((plan.store, plan.session), (StoreKind::Plans, None));
        assert_eq!(c("sessions/x.json").unwrap().format, FileFormat::Json);
        for rel in [
            "settings.json",
            "CLAUDE.md",
            "commands/c.md",
            "file-history/loose.txt",
            "history.jsonl.bak",
            "plans",
        ] {
            let o = c(rel).unwrap();
            assert_eq!((o.store, o.session, o.part), (StoreKind::Other, None, None));
        }
        assert_eq!(c("settings.json").unwrap().format, FileFormat::Json);
        assert!(classify(0, Path::new("/r"), Path::new("/elsewhere/x")).is_none());
    }
}
