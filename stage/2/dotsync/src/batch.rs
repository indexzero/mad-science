//! The batching state machine of section 7 and the interface of section 8.4.
//!
//! This module is pure. It never sleeps, spawns, or reads the clock. Every
//! `now` is a parameter. Every function is total, so there is no error enum.

use std::collections::BTreeMap;
use std::time::Duration;

use tokio::time::Instant;

/// The three durations of section 7.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// A folder closes this long after its last hint.
    pub quiet: Duration,
    /// A folder closes this long after its first hint, even under constant hints.
    pub ceiling: Duration,
    /// A full rescan of every root is due this long after the last one.
    pub rescan: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            quiet: Duration::from_secs(2),
            ceiling: Duration::from_secs(5 * 60),
            rescan: Duration::from_secs(30 * 60),
        }
    }
}

/// The timers of one dirty folder or one `Full` root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dirty {
    /// The first hint since Idle.
    pub t0: Instant,
    /// The last hint.
    pub t1: Instant,
}

impl Dirty {
    /// Start both timers at `now`.
    fn start(now: Instant) -> Self {
        Self { t0: now, t1: now }
    }

    /// True when a close rule of section 7 holds.
    fn ready(&self, policy: &Policy, now: Instant) -> bool {
        now.saturating_duration_since(self.t1) >= policy.quiet
            || now.saturating_duration_since(self.t0) >= policy.ceiling
    }

    /// The instant at which the first close rule holds.
    fn deadline(&self, policy: &Policy) -> Instant {
        (self.t1 + policy.quiet).min(self.t0 + policy.ceiling)
    }
}

/// The per-folder and per-root state of section 7.
#[derive(Debug)]
pub struct Batcher {
    policy: Policy,
    /// (root index, folder) -> timers.
    dirty: BTreeMap<(usize, String), Dirty>,
    /// root index -> timers, for a root marked by a full hint (section 7).
    full: BTreeMap<usize, Dirty>,
    last_full: Instant,
}

/// One batch for one root. `full` is true for a root closed from `Full`.
/// `folders` is then empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Closed {
    pub root: usize,
    pub full: bool,
    pub folders: Vec<String>,
}

impl Batcher {
    /// An idle batcher whose last full rescan is `now`.
    pub fn new(policy: Policy, now: Instant) -> Self {
        Self {
            policy,
            dirty: BTreeMap::new(),
            full: BTreeMap::new(),
            last_full: now,
        }
    }

    /// Section 7, `hint`. A full hint drops every folder of the root and marks
    /// the root `Full`. A folder hint on a `Full` root only moves its `t1`.
    pub fn hint(&mut self, root: usize, folder: &str, full: bool, now: Instant) {
        if full {
            self.dirty.retain(|(r, _), _| *r != root);
            self.full
                .entry(root)
                .and_modify(|d| d.t1 = now)
                .or_insert_with(|| Dirty::start(now));
            return;
        }
        if let Some(d) = self.full.get_mut(&root) {
            d.t1 = now;
            return;
        }
        self.dirty
            .entry((root, folder.trim_end_matches('/').to_string()))
            .and_modify(|d| d.t1 = now)
            .or_insert_with(|| Dirty::start(now));
    }

    /// Section 7, `take_closed`. Every folder and every `Full` root that satisfies
    /// a close rule leaves the map. The result is sorted by root. The folders of
    /// one root are sorted and collapsed.
    pub fn take_closed(&mut self, now: Instant) -> Vec<Closed> {
        let policy = self.policy;
        let mut by_root: BTreeMap<usize, Closed> = BTreeMap::new();
        let full_roots: Vec<usize> = self
            .full
            .iter()
            .filter(|(_, d)| d.ready(&policy, now))
            .map(|(r, _)| *r)
            .collect();
        for root in full_roots {
            self.full.remove(&root);
            by_root.insert(
                root,
                Closed {
                    root,
                    full: true,
                    folders: Vec::new(),
                },
            );
        }
        let ready: Vec<(usize, String)> = self
            .dirty
            .iter()
            .filter(|(_, d)| d.ready(&policy, now))
            .map(|(k, _)| k.clone())
            .collect();
        let mut folders: BTreeMap<usize, Vec<String>> = BTreeMap::new();
        for key in ready {
            self.dirty.remove(&key);
            folders.entry(key.0).or_default().push(key.1);
        }
        for (root, list) in folders {
            by_root.entry(root).or_insert_with(|| Closed {
                root,
                full: false,
                folders: collapse(list),
            });
        }
        by_root.into_values().collect()
    }

    /// True when `now - last_full >= policy.rescan`. Resets `last_full` to `now` when true.
    pub fn full_due(&mut self, now: Instant) -> bool {
        if now.saturating_duration_since(self.last_full) >= self.policy.rescan {
            self.last_full = now;
            true
        } else {
            false
        }
    }

    /// The earliest close or full-rescan instant, never before `now`.
    pub fn next_deadline(&self, now: Instant) -> Instant {
        let policy = &self.policy;
        self.dirty
            .values()
            .chain(self.full.values())
            .map(|d| d.deadline(policy))
            .fold(self.last_full + policy.rescan, Instant::min)
            .max(now)
    }

    /// The number of dirty folders plus the number of `Full` roots.
    pub fn dirty_count(&self) -> usize {
        self.dirty.len() + self.full.len()
    }
}

/// Pure. Sort, dedupe, and drop every folder that has a proper ancestor in the
/// same list. "" is an ancestor of nothing, because it covers depth 1 of the
/// root only.
pub fn collapse(mut folders: Vec<String>) -> Vec<String> {
    folders.sort();
    folders.dedup();
    let covered = |f: &String| {
        folders.iter().any(|g| {
            !g.is_empty()
                && g != f
                && f.strip_prefix(g.as_str())
                    .is_some_and(|rest| rest.starts_with('/'))
        })
    };
    folders.iter().filter(|f| !covered(f)).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::Manifest;
    use crate::scan::{self, DenyList, Scope};
    use crate::store::{self, Layout};
    use object_store::ObjectStoreExt;
    use object_store::memory::InMemory;
    use object_store::path::Path;
    use std::fs;
    use std::io::Write;
    use tokio::time::advance;

    const S: Duration = Duration::from_secs(1);
    const MS: Duration = Duration::from_millis(1);

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    fn folders(closed: &[Closed]) -> Vec<(usize, bool, Vec<String>)> {
        closed
            .iter()
            .map(|c| (c.root, c.full, c.folders.clone()))
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn fm_4_batch_closes_at_ceiling_while_file_keeps_appending() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("projects/x")).unwrap();
        let file = root.join("projects/x/log.jsonl");
        let mut b = Batcher::new(Policy::default(), Instant::now());
        let mut closed = Vec::new();
        for i in 0..=300u64 {
            let now = Instant::now();
            let mut f = fs::File::options()
                .create(true)
                .append(true)
                .open(&file)
                .unwrap();
            writeln!(f, "line {i}").unwrap();
            b.hint(0, "projects/x", false, now);
            let got = b.take_closed(now);
            if i < 300 {
                assert!(got.is_empty(), "closed early at {i} s: {got:?}");
                advance(S).await;
            } else {
                closed = got;
            }
        }
        assert_eq!(
            folders(&closed),
            vec![(0, false, vec!["projects/x".to_string()])]
        );
        assert_eq!(b.dirty_count(), 0);

        let deny = DenyList::default_list().unwrap();
        let expected = fs::read(&file).unwrap();
        let mtime = scan::mtime_ns(&fs::metadata(&file).unwrap());
        let snap = scan::scan(
            root,
            &deny,
            Scope::Folders(closed[0].folders.clone()),
            mtime + 10_000_000_000,
        )
        .unwrap();
        let m = Manifest::new("alpha", "root");
        let plan = m.diff(root, &snap).unwrap();
        assert_eq!(plan.summary().uploads, 1);
        let store = InMemory::new();
        let layout = Layout::new(Path::default(), "alpha");
        let report = store::upload(&store, &layout, "root", root, &deny, &plan, 1, mtime)
            .await
            .unwrap();
        assert_eq!(report.done, vec![0]);
        let body = store
            .get(&Path::from("alpha/root/projects/x/log.jsonl"))
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(body.as_ref(), expected.as_slice());
        assert!(expected.ends_with(b"line 300\n"));
    }

    #[tokio::test(start_paused = true)]
    async fn batch_closes_after_two_seconds_quiet() {
        let t = Instant::now();
        let mut b = Batcher::new(Policy::default(), t);
        b.hint(0, "a", false, t);
        b.hint(0, "a", false, t + Duration::from_millis(500));
        b.hint(0, "a", false, t + S);
        assert!(b.take_closed(t + Duration::from_millis(2900)).is_empty());
        assert_eq!(b.dirty_count(), 1);
        assert_eq!(
            folders(&b.take_closed(t + secs(3))),
            vec![(0, false, vec!["a".to_string()])]
        );
        assert_eq!(b.dirty_count(), 0);
        assert!(b.take_closed(t + secs(10)).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn batch_collapses_nested_dirty_folders() {
        let t = Instant::now();
        let mut b = Batcher::new(Policy::default(), t);
        for f in ["", "a", "a/b", "c"] {
            b.hint(0, f, false, t);
        }
        assert_eq!(b.dirty_count(), 4);
        let got = b.take_closed(t + secs(2));
        assert_eq!(
            folders(&got),
            vec![(
                0,
                false,
                vec!["".to_string(), "a".to_string(), "c".to_string()]
            )]
        );
        assert_eq!(b.dirty_count(), 0);

        b.hint(1, "x", false, t);
        b.hint(1, "y/z", false, t);
        b.hint(1, "", true, t + S);
        assert_eq!(b.dirty_count(), 1);
        b.hint(1, "x", false, t + secs(2));
        assert!(b.take_closed(t + secs(3)).is_empty());
        let got = b.take_closed(t + secs(4));
        assert_eq!(folders(&got), vec![(1, true, vec![])]);
        assert_eq!(b.dirty_count(), 0);

        assert_eq!(
            collapse(vec![
                "a/b/c".into(),
                "a".into(),
                "ab".into(),
                "".into(),
                "a".into()
            ]),
            vec!["".to_string(), "a".to_string(), "ab".to_string()]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn batch_next_deadline_is_earliest_rule() {
        let t0 = Instant::now();
        let policy = Policy::default();
        let mut b = Batcher::new(policy, t0);
        assert_eq!(b.next_deadline(t0), t0 + policy.rescan);

        b.hint(0, "a", false, t0);
        assert_eq!(b.next_deadline(t0), t0 + policy.quiet);
        let t1 = t0 + Duration::from_millis(700);
        b.hint(0, "a", false, t1);
        assert_eq!(b.next_deadline(t1), t1 + policy.quiet);

        let mut now = t1;
        while now < t0 + secs(299) {
            now += S;
            b.hint(0, "a", false, now);
        }
        assert_eq!(b.next_deadline(now), t0 + policy.ceiling);
        assert!(b.next_deadline(now) < now + policy.quiet);

        let got = b.take_closed(t0 + policy.ceiling);
        assert_eq!(folders(&got), vec![(0, false, vec!["a".to_string()])]);

        let t = t0 + secs(400);
        b.hint(1, "", true, t);
        assert_eq!(b.next_deadline(t), t + policy.quiet);
        assert_eq!(b.next_deadline(t + secs(5)), t + secs(5));

        assert!(!b.full_due(t));
        let late = t0 + policy.rescan + MS;
        assert!(b.full_due(late));
        assert!(!b.full_due(late));
        assert_eq!(b.next_deadline(late), late);
    }
}
