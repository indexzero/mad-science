//! Domain ordering (R5): group hits into one block per session (or per file,
//! for hits with no session) and order the blocks from near to far.
//!
//! Domains, near to far:
//!
//! 0. blocks whose `cwd` is a "here" folder or is inside it (by whole path
//!    components), in any root;
//! 1. blocks whose `cwd` contains a "here" folder, in any root. `/` and the
//!    home folder contain nearly everything, so they never count as near;
//! 2. the other transcript blocks of the first root;
//! 3. the other store blocks of the first root;
//! 4. and on: the same two domains for each later root, in the order given.
//!
//! Within a domain, newest first. The caller passes "here" (the current
//! folder, possibly spelled more than one way) and the home folder; the
//! library does not read them.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::agree::{self, HistoryIndex, SessionAgreement};
use crate::session::{self, SessionInfo};
use crate::{Hit, StoreKind};

/// One block of results: a session in a root, or a file with no session.
#[derive(Debug, Clone)]
pub struct Group {
    /// Index into the roots.
    pub root: usize,
    /// The session, when the hits have one.
    pub session: Option<String>,
    /// For a block with no session: its store and file.
    pub store: StoreKind,
    /// For a block with no session: the file.
    pub path: Option<PathBuf>,
    /// Header fields from the session's transcript, when it was found.
    pub info: Option<SessionInfo>,
    /// The session's `cwd` (from the transcript, else from the hits).
    pub cwd: Option<String>,
    /// Whether `cwd` exists (a `stat`).
    pub cwd_exists: Option<bool>,
    /// The newest time in the session (or in the hits).
    pub last_ts: Option<i64>,
    /// The session's branches (from the transcript, else from the hits).
    pub branches: Vec<String>,
    /// The R5 domain; lower is nearer.
    pub domain: usize,
    /// The hits, in search order.
    pub hits: Vec<Hit>,
    /// The session's agreement with `history.jsonl` (R10), and its `last:`.
    pub agreement: Option<SessionAgreement>,
}

/// How near `cwd` is to `here`, by whole path components: `Some(0)` when it
/// is `here` or inside it, `Some(1)` when it contains `here` (unless it is
/// `/` or `home`), else `None`.
#[must_use]
pub fn nearness(cwd: &Path, here: &Path, home: Option<&Path>) -> Option<usize> {
    if cwd.starts_with(here) {
        Some(0)
    } else if here.starts_with(cwd) && cwd.parent().is_some() && Some(cwd) != home {
        Some(1)
    } else {
        None
    }
}

/// The number of near domains (see [`nearness`]).
const NEAR_DOMAINS: usize = 2;

#[derive(Hash, PartialEq, Eq)]
enum Key {
    Session(usize, String),
    File(usize, StoreKind, PathBuf),
}

/// Group `hits` into blocks and order them by domain, then newest first.
/// Takes each matched session's header from `known` (read during the search,
/// see [`crate::SearchOptions::headers`]) or reads its transcript once (in
/// parallel), then sets every hit's agreement (see [`agree::annotate`]).
#[must_use]
pub fn group(
    hits: Vec<Hit>,
    known: Vec<SessionInfo>,
    roots: &[PathBuf],
    here: &[PathBuf],
    home: Option<&Path>,
) -> Vec<Group> {
    let mut index: HashMap<Key, usize> = HashMap::new();
    let mut groups: Vec<Group> = Vec::new();
    for h in hits {
        let key = match &h.meta.session {
            Some(s) => Key::Session(h.root, s.clone()),
            None => Key::File(h.root, h.store, h.path.clone()),
        };
        let i = *index.entry(key).or_insert_with(|| {
            groups.push(Group {
                root: h.root,
                session: h.meta.session.clone(),
                store: h.store,
                path: h.meta.session.is_none().then(|| h.path.clone()),
                info: None,
                cwd: None,
                cwd_exists: None,
                last_ts: None,
                branches: Vec::new(),
                domain: 0,
                hits: Vec::new(),
                agreement: None,
            });
            groups.len() - 1
        });
        groups[i].hits.push(h);
    }
    // `history.jsonl` is read while the transcripts are (R10).
    let needed: HashSet<String> = groups.iter().filter_map(|g| g.session.clone()).collect();
    let index = std::thread::scope(|s| {
        let history = s.spawn(|| HistoryIndex::load(roots, Some(&needed)));
        load_infos(&mut groups, known, roots);
        history.join().unwrap_or_default()
    });
    agree::annotate(&mut groups, roots, &index);
    for g in &mut groups {
        finish(g, here, home);
    }
    groups.sort_by(|a, b| {
        a.domain
            .cmp(&b.domain)
            .then_with(|| b.last_ts.is_some().cmp(&a.last_ts.is_some()))
            .then_with(|| b.last_ts.cmp(&a.last_ts))
            .then_with(|| a.root.cmp(&b.root))
            .then_with(|| a.session.cmp(&b.session))
            .then_with(|| a.path.cmp(&b.path))
    });
    groups
}

/// Set the header of every session group: from `known` when its transcript
/// was read during the search, else read now, spread over a few threads.
fn load_infos(groups: &mut [Group], known: Vec<SessionInfo>, roots: &[PathBuf]) {
    let mut known: HashMap<PathBuf, SessionInfo> = known
        .into_iter()
        .map(|i| (i.transcript.clone(), i))
        .collect();
    let mut todo: Vec<(&mut Group, Option<PathBuf>)> = Vec::new();
    for g in groups.iter_mut().filter(|g| g.session.is_some()) {
        let path = transcript_for(g, roots);
        match path.as_ref().and_then(|p| known.remove(p)) {
            Some(info) => g.info = Some(info),
            None => todo.push((g, path)),
        }
    }
    if todo.is_empty() {
        return;
    }
    let threads = std::thread::available_parallelism()
        .map_or(1, std::num::NonZero::get)
        .min(todo.len());
    let chunk = todo.len().div_ceil(threads);
    std::thread::scope(|s| {
        for part in todo.chunks_mut(chunk) {
            s.spawn(move || {
                for (g, path) in part {
                    g.info = path.as_deref().and_then(|p| session::read_session(p).ok());
                }
            });
        }
    });
}

/// The main transcript of a session group: a hit's own file when it is
/// one, else `projects/*/<session>.jsonl` in the group's root.
fn transcript_for(g: &Group, roots: &[PathBuf]) -> Option<PathBuf> {
    let sid = g.session.as_deref()?;
    let projects = roots.get(g.root)?.join("projects");
    g.hits
        .iter()
        .filter(|h| h.store == StoreKind::Transcripts)
        .map(|h| &h.path)
        .find(|p| {
            p.file_stem().is_some_and(|s| s == sid)
                && p.parent().and_then(Path::parent) == Some(projects.as_path())
        })
        .cloned()
        .or_else(|| session::find_transcript(&roots[g.root], sid))
}

fn finish(g: &mut Group, here: &[PathBuf], home: Option<&Path>) {
    let hit_ts = g.hits.iter().filter_map(|h| h.meta.ts).max();
    let hit_cwd = g.hits.iter().find_map(|h| h.meta.cwd.clone());
    if let Some(info) = &g.info {
        g.cwd = info.cwd.clone().or(hit_cwd);
        g.last_ts = info.last_ts.max(hit_ts);
        g.branches.clone_from(&info.branches);
    } else {
        g.cwd = hit_cwd;
        g.last_ts = hit_ts;
        for h in &g.hits {
            if let Some(b) = &h.meta.branch
                && !g.branches.contains(b)
            {
                g.branches.push(b.clone());
            }
        }
    }
    g.cwd_exists = g.cwd.as_deref().map(session::cwd_exists);
    let near = g.cwd.as_deref().and_then(|c| {
        here.iter()
            .filter_map(|h| nearness(Path::new(c), h, home))
            .min()
    });
    let transcript = g.hits.iter().any(|h| h.store == StoreKind::Transcripts);
    g.domain = near.unwrap_or(NEAR_DOMAINS + 2 * g.root + usize::from(!transcript));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_is_component_aware() {
        let here = Path::new("/w/app");
        let near = |c: &str| nearness(Path::new(c), here, Some(Path::new("/h")));
        assert_eq!(near("/w/app"), Some(0));
        assert_eq!(near("/w/app/sub"), Some(0));
        assert_eq!(
            near("/w"),
            Some(1),
            "contains: nearer than far, below inside"
        );
        assert_eq!(near("/w/application"), None);
        assert_eq!(near("/w/other"), None);
    }

    #[test]
    fn root_and_home_are_never_near_by_containment() {
        let home = Some(Path::new("/h"));
        let here = Path::new("/h/src/app");
        assert_eq!(nearness(Path::new("/"), here, home), None);
        assert_eq!(nearness(Path::new("/h"), here, home), None);
        assert_eq!(nearness(Path::new("/h/src"), here, home), Some(1));
        // At home itself, home is "here", not a container.
        assert_eq!(nearness(Path::new("/h"), Path::new("/h"), home), Some(0));
    }
}
