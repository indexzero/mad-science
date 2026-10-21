//! The `notify` stream and the folder hints of section 8.3.
//!
//! This module never reads a file body, never uploads, and holds no timer.
//! There is no `cfg` gate here. `RecommendedWatcher` picks FSEvents on macOS
//! and inotify on Linux inside `notify`. The handler runs on the debouncer
//! thread and only maps events to hints and sends them.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache, new_debouncer,
};
use tokio::sync::mpsc::UnboundedSender;

/// One folder of one root that needs a rescan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hint {
    /// Index into the roots slice given to `start`.
    pub root: usize,
    /// Root-relative folder with `/` separators, "" for the root.
    pub folder: String,
    /// True when the backend reported dropped events. `folder` is then "".
    pub full: bool,
}

/// The running debouncer. Dropping it stops the stream.
pub struct Watcher {
    debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

impl Watcher {
    /// Create the debouncer with `new_debouncer(debounce, None, handler)` and watch
    /// every root with `RecursiveMode::Recursive`. The handler sends hints on `tx`.
    ///
    /// Each root is canonicalized for matching, because FSEvents reports the
    /// canonical path. The hint index still refers to the slice as given. A send
    /// error means the receiver is gone, so it is ignored. A backend error batch
    /// sends one full hint per root, so nothing is lost.
    pub fn start(
        roots: &[PathBuf],
        debounce: Duration,
        tx: UnboundedSender<Hint>,
    ) -> Result<Self, WatchError> {
        let canonical: Vec<PathBuf> = roots
            .iter()
            .map(|r| r.canonicalize().unwrap_or_else(|_| r.clone()))
            .collect();
        let handler = move |result: DebounceEventResult| match result {
            Ok(events) => {
                for event in &events {
                    for hint in hints_from_event(&canonical, event) {
                        let _ = tx.send(hint);
                    }
                }
            }
            Err(_) => {
                for root in 0..canonical.len() {
                    let _ = tx.send(full_hint(root));
                }
            }
        };
        let mut debouncer = new_debouncer(debounce, None, handler)?;
        for root in roots {
            debouncer.watch(root, RecursiveMode::Recursive)?;
        }
        Ok(Self { debouncer })
    }

    /// `Debouncer::stop`. Blocks until the debouncer thread has joined.
    pub fn stop(self) {
        self.debouncer.stop();
    }
}

/// A full hint for one root.
fn full_hint(root: usize) -> Hint {
    Hint {
        root,
        folder: String::new(),
        full: true,
    }
}

/// Pure. Map one event to hints.
///
/// `need_rescan()` gives one full hint per root. Otherwise, for each event path,
/// find the root it is under. When the path exists and is a directory, hint that
/// folder. When the path exists and is a file or a link, hint its parent. When
/// the path no longer exists, hint both its parent and the path itself as a
/// folder. The batcher's `collapse` drops the second when the first covers it,
/// and a vanished folder scans as empty, which tombstones its entries. Event
/// kinds are ignored. Duplicates are dropped.
pub fn hints_from_event(roots: &[PathBuf], event: &DebouncedEvent) -> Vec<Hint> {
    if event.need_rescan() {
        return (0..roots.len()).map(full_hint).collect();
    }
    let mut out: Vec<Hint> = Vec::new();
    let mut push = |root: usize, folder: String| {
        let hint = Hint {
            root,
            folder,
            full: false,
        };
        if !out.contains(&hint) {
            out.push(hint);
        }
    };
    for abs in &event.paths {
        let Some((root, rel)) = locate(roots, abs) else {
            continue;
        };
        let parent = abs
            .parent()
            .and_then(|p| relative_folder(&roots[root], p))
            .unwrap_or_default();
        match std::fs::symlink_metadata(abs) {
            Ok(md) if md.is_dir() => push(root, rel),
            Ok(_) => push(root, parent),
            Err(_) => {
                push(root, parent);
                push(root, rel);
            }
        }
    }
    out
}

/// The root index and the root-relative form of `abs`, or `None` when under no root.
fn locate(roots: &[PathBuf], abs: &Path) -> Option<(usize, String)> {
    roots
        .iter()
        .enumerate()
        .find_map(|(i, root)| relative_folder(root, abs).map(|rel| (i, rel)))
}

/// Pure. `abs` relative to `root` with `/` separators, or `None` when not under it
/// or when a component is not UTF-8. The root itself is "".
pub fn relative_folder(root: &Path, abs: &Path) -> Option<String> {
    let rest = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rest.components() {
        parts.push(c.as_os_str().to_str()?);
    }
    Some(parts.join("/"))
}

/// The one error type of this module.
#[derive(Debug, thiserror::Error)]
pub enum WatchError {
    #[error("notify: {0}")]
    Notify(#[from] notify::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{Event, EventKind, Flag};
    use std::fs;
    use std::time::Instant;

    fn event(paths: &[PathBuf]) -> DebouncedEvent {
        let mut ev = Event::new(EventKind::Any);
        for p in paths {
            ev = ev.add_path(p.clone());
        }
        DebouncedEvent::new(ev, Instant::now())
    }

    fn hint(root: usize, folder: &str) -> Hint {
        Hint {
            root,
            folder: folder.to_string(),
            full: false,
        }
    }

    #[test]
    fn watch_hints_from_event_maps_file_to_parent_folder() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("projects/x")).unwrap();
        fs::write(root.join("projects/x/y.jsonl"), b"{}").unwrap();
        let roots = vec![root.clone()];

        let got = hints_from_event(&roots, &event(&[root.join("projects/x/y.jsonl")]));
        assert_eq!(got, vec![hint(0, "projects/x")]);

        let outside = tempfile::TempDir::new().unwrap();
        let got = hints_from_event(&roots, &event(&[outside.path().join("y.jsonl")]));
        assert!(got.is_empty());

        let got = hints_from_event(&roots, &event(&[root.join("projects/x")]));
        assert_eq!(got, vec![hint(0, "projects/x")]);

        let got = hints_from_event(&roots, &event(std::slice::from_ref(&root)));
        assert_eq!(got, vec![hint(0, "")]);

        let got = hints_from_event(&roots, &event(&[root.join("projects/gone")]));
        assert_eq!(got, vec![hint(0, "projects"), hint(0, "projects/gone")]);

        fs::write(root.join("top.txt"), b"x").unwrap();
        let got = hints_from_event(&roots, &event(&[root.join("top.txt")]));
        assert_eq!(got, vec![hint(0, "")]);

        let mut ev = Event::new(EventKind::Any);
        ev = ev.set_flag(Flag::Rescan);
        let got = hints_from_event(&roots, &DebouncedEvent::new(ev, Instant::now()));
        assert_eq!(
            got,
            vec![Hint {
                root: 0,
                folder: String::new(),
                full: true
            }]
        );

        assert_eq!(relative_folder(&root, &root), Some(String::new()));
        assert_eq!(
            relative_folder(&root, &root.join("a/b")),
            Some("a/b".to_string())
        );
        assert_eq!(relative_folder(&root, outside.path()), None);
    }

    /// Real `notify`. The bound is 10 s of wall-clock time, with a 200 ms debounce.
    #[tokio::test]
    async fn watch_emits_hint_for_write_in_temp_root() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("sub")).unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let watcher =
            Watcher::start(std::slice::from_ref(&root), Duration::from_millis(200), tx).unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        fs::write(root.join("sub/new.txt"), b"hello").unwrap();

        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let mut seen = Vec::new();
        let found = loop {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(h)) => {
                    let hit = h.root == 0 && (h.full || h.folder == "sub");
                    seen.push(h);
                    if hit {
                        break true;
                    }
                }
                Ok(None) | Err(_) => break false,
            }
        };
        watcher.stop();
        assert!(found, "no hint for sub within 10 s, got {seen:?}");
    }
}
