//! Evidence: what clrg knows about a file's content (INTENT "Build 2").
//!
//! Each piece of evidence is an [`Event`] on a path, read from the
//! transcripts of the selected sessions:
//!
//! - `backup`: a `file-history-snapshot` line's `snapshot.trackedFileBackups`
//!   entry. Its content is `file-history/<sid>/<backupFileName>` (raw bytes),
//!   read at replay; a `null` `backupFileName` means the file was absent.
//! - `write`: a `Write`/`NotebookEdit` `tool_use` whose `tool_result` is not an
//!   error. Content: `toolUseResult.content`, else `input.content`.
//! - `edit`: an `Edit`/`MultiEdit` `tool_use` whose result is not an error:
//!   `old_string` replaced by `new_string` (honouring `replace_all`) in
//!   `toolUseResult.originalFile`, or in the previous known content.
//! - `rejected`: a [`WRITE_TOOLS`] `tool_use` whose `tool_result` has
//!   `is_error: true`. Nothing reached disk; the intended content is kept. A
//!   failed `Read` (or any other tool) is never a write event.
//! - `returned`: after a rejected write in a subagent transcript, the string
//!   with the highest [`similarity`] among that agent's last
//!   `StructuredOutput` input strings (nested fields included) and its last
//!   assistant text, when it [`qualifies`]. Each string is returned for at
//!   most one path. The workflow's `journal.jsonl` is checked for the same
//!   string ([`Journal`]).
//! - `read`: a `Read` `tool_use` (no content; `clrg files --op read`).
//!
//! A `tool_use` is paired with its `tool_result` by `tool_use_id`: the result
//! is a content part of a later `type: "user"` line, and that line's
//! `toolUseResult` belongs to it when the line holds exactly one result.
//! A relative path resolves against the session's launch `cwd` (R2).
//! Events are merged across roots into one timeline per path, copies
//! counted once (see `assemble`), and selectors choose paths, not events.
//!
//! [`PathEvidence::replay`] turns a path's events, in time order, into
//! [`State`]s: the content after each event, `diff-only` where an edit has no
//! base, and `verified` where a later backup can be compared. `clrg files`
//! summarises the states; `clrg extract` writes them.

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::io::{BufRead as _, BufReader};
use std::path::{Component, Path, PathBuf};

use globset::GlobSet;
use serde_json::Value;

use crate::decode;
use crate::discover::{JOURNAL, StoreFile};
use crate::search::{Outcome, trim_eol, walk_files};
use crate::select::{Filter, Scope, Selectors, globs};
use crate::session::LaunchCwd;
use crate::{Error, StoreKind, parse_ts};

/// The share of a rejected write's non-blank lines that a later string must
/// hold to be `returned`.
pub const RETURNED_SHARE: f64 = 0.8;

/// The fewest non-blank lines a rejected write must have for a later string
/// to be `returned` for it.
pub const RETURNED_MIN_LINES: usize = 3;

/// A `returned` candidate's length must be at least this share, and at most
/// [`RETURNED_MAX_LEN`] times, the rejected content's length (in chars).
pub const RETURNED_MIN_LEN: f64 = 0.5;

/// See [`RETURNED_MIN_LEN`].
pub const RETURNED_MAX_LEN: f64 = 2.0;

/// The tools whose results can be `rejected`: only these write files.
pub const WRITE_TOOLS: [&str; 4] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/// The kind of an event. The order is the order `ops` lists them in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum EventKind {
    /// A successful `Write`/`NotebookEdit`.
    Write,
    /// A successful `Edit`/`MultiEdit`.
    Edit,
    /// A file-history backup.
    Backup,
    /// A write or edit whose result was an error.
    Rejected,
    /// A subagent's returned text that matches its rejected write.
    Returned,
    /// A `Read`.
    Read,
}

impl EventKind {
    /// The name in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Write => "write",
            EventKind::Edit => "edit",
            EventKind::Backup => "backup",
            EventKind::Rejected => "rejected",
            EventKind::Returned => "returned",
            EventKind::Read => "read",
        }
    }
}

/// clrg's: whether the workflow journal holds the `returned` string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Journal {
    /// A `result` for the same `agentId` contains the string.
    Agree,
    /// A `result` for the same `agentId` exists and does not contain it.
    Disagree,
    /// No journal, or no `result` for the agent.
    None,
}

impl Journal {
    /// The name in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Journal::Agree => "agree",
            Journal::Disagree => "disagree",
            Journal::None => "none",
        }
    }
}

/// clrg's: a replayed state compared with the next backup of the same path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verified {
    /// The bytes are equal.
    Agree,
    /// They differ (shown, never hidden).
    Disagree,
}

impl Verified {
    /// The name in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Verified::Agree => "agree",
            Verified::Disagree => "disagree",
        }
    }
}

/// clrg's: how much of a state's content is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recoverable {
    /// The full bytes.
    Full,
    /// Only a diff: an edit with no base, or after a break in the chain.
    DiffOnly,
    /// Nothing: no state, or the file was absent.
    None,
}

impl Recoverable {
    /// The name in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Recoverable::Full => "full",
            Recoverable::DiffOnly => "diff-only",
            Recoverable::None => "none",
        }
    }
}

/// clrg's: what the last write-family event of a path says happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileOutcome {
    /// A write or edit whose result was not an error.
    Written,
    /// A write or edit whose result was an error.
    Rejected,
    /// A subagent returned the rejected content as text.
    Returned,
    /// No write-family event, or the last one has no result.
    Unknown,
}

impl FileOutcome {
    /// The name in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            FileOutcome::Written => "written",
            FileOutcome::Rejected => "rejected",
            FileOutcome::Returned => "returned",
            FileOutcome::Unknown => "unknown",
        }
    }
}

/// One `old_string` → `new_string` replacement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Replace {
    /// `old_string` (`oldString`).
    pub old: String,
    /// `new_string` (`newString`).
    pub new: String,
    /// `replace_all` (`replaceAll`).
    pub all: bool,
}

/// What an event says about the content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    /// The full content after the event.
    Full(Vec<u8>),
    /// A file-history backup file, read at replay; `None` when
    /// `backupFileName` is `null` (the file was absent).
    Backup(Option<PathBuf>),
    /// Replacements on `original` (`toolUseResult.originalFile`), or on the
    /// previous known content when it is `None`.
    Edits {
        original: Option<String>,
        edits: Vec<Replace>,
    },
    /// No content: a `Read`, or a write with no content field.
    Nothing,
}

/// One piece of evidence on a path.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// The kind.
    pub kind: EventKind,
    /// The path, absolute after resolution (as recorded when it is relative
    /// and the session has no launch `cwd`).
    pub path: String,
    /// The path as the transcript records it.
    pub recorded_path: String,
    /// When: the line's `timestamp`; a backup's `backupTime`.
    pub ts: Option<i64>,
    /// Index into the roots.
    pub root: usize,
    /// The session.
    pub session: Option<String>,
    /// The subagent, from `agent-<id>.jsonl`.
    pub agent_id: Option<String>,
    /// The session's launch `cwd`.
    pub cwd: Option<String>,
    /// The line's `gitBranch`.
    pub branch: Option<String>,
    /// The transcript the event was read from.
    pub transcript: PathBuf,
    /// 1-based line in `transcript`.
    pub line: u64,
    /// The tool (`Write`, `Edit`, ..., `StructuredOutput`), if any.
    pub tool: Option<String>,
    /// The `tool_use` id, if any.
    pub tool_use_id: Option<String>,
    /// A `tool_result` was found (always true for `backup` and `returned`).
    pub answered: bool,
    /// What the event says about the content.
    pub change: Change,
    /// `backup`: the snapshot `version`.
    pub version: Option<u64>,
    /// `returned`: the share of the rejected content's non-blank lines found.
    pub similarity: Option<f64>,
    /// `returned`: the journal cross-check.
    pub journal: Option<Journal>,
}

impl Event {
    /// The event is a write or a rejected write (not an edit).
    #[must_use]
    pub fn is_write(&self) -> bool {
        match self.kind {
            EventKind::Write => true,
            EventKind::Rejected => !matches!(self.change, Change::Edits { .. }),
            _ => false,
        }
    }
}

/// Every event on one path, merged across roots, in time order: one
/// timeline per path.
#[derive(Debug, Clone, PartialEq)]
pub struct PathEvidence {
    /// Indexes into the roots: every root an event (or a copy of one) came
    /// from, ascending (the order given). Never empty.
    pub roots: Vec<usize>,
    /// The resolved path.
    pub path: String,
    /// The events, ordered by time (a backup first on a tie).
    pub events: Vec<Event>,
}

/// Which events a replay uses (`extract --source`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Sources {
    /// Every event.
    #[default]
    Best,
    /// Only `backup` events.
    FileHistory,
    /// Only `write`, `edit`, `rejected`, and `returned` events.
    Transcript,
}

impl Sources {
    fn uses(self, kind: EventKind) -> bool {
        match (self, kind) {
            (_, EventKind::Read) => false,
            (Sources::Best, _) => true,
            (Sources::FileHistory, k) => k == EventKind::Backup,
            (Sources::Transcript, k) => k != EventKind::Backup,
        }
    }
}

/// The content of a path after one event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct State {
    /// Index into [`PathEvidence::events`].
    pub event: usize,
    /// The event's kind (`source_event`).
    pub kind: EventKind,
    /// The bytes, when known.
    pub content: Option<Vec<u8>>,
    /// `full` with content; `diff-only` for an edit off a broken chain;
    /// `none` for an absent file.
    pub recoverable: Recoverable,
    /// A `write`/`edit` state compared with the very next event, when that is
    /// a readable backup.
    pub verified: Option<Verified>,
}

/// The content known before an event.
#[derive(Debug, Clone)]
enum Known {
    Unknown,
    Absent,
    Content(Vec<u8>),
}

/// Apply `edits` to `base` in order, as Claude Code does. `None` when an
/// `old` is not found. An empty `old` creates the file from an empty or
/// absent base.
///
/// - Matching normalises CRLF to LF (in `base`, `old`, and `new`). When
///   `base` has a CRLF, the result has CRLF line endings throughout.
/// - An empty `new` whose `old` does not end in a newline, where `old`
///   followed by a newline is in the file, also removes that newline (the
///   whole line goes, not just its text).
#[must_use]
pub fn apply_edits(base: Option<&[u8]>, edits: &[Replace]) -> Option<Vec<u8>> {
    let crlf = base.is_some_and(|b| find(b, b"\r\n", 0).is_some());
    let mut cur = base.map(|b| if crlf { to_lf(b) } else { b.to_vec() });
    for e in edits {
        let mut old = to_lf(e.old.as_bytes());
        let new = if crlf {
            to_lf(e.new.as_bytes())
        } else {
            e.new.as_bytes().to_vec()
        };
        match cur.as_mut() {
            _ if old.is_empty() => {
                if cur.as_ref().is_some_and(|c| !c.is_empty()) {
                    return None;
                }
                cur = Some(new);
            }
            None => return None,
            Some(c) => {
                if new.is_empty() && !old.ends_with(b"\n") {
                    let mut line = old.clone();
                    line.push(b'\n');
                    if find(c, &line, 0).is_some() {
                        old = line;
                    }
                }
                *c = replace_bytes(c, &old, &new, e.all)?;
            }
        }
    }
    if crlf {
        cur.map(|c| {
            c.split(|&b| b == b'\n')
                .collect::<Vec<_>>()
                .join(&b"\r\n"[..])
        })
    } else {
        cur
    }
}

/// `b` with every CRLF replaced by LF.
fn to_lf(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\r' && b.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    hay.get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| i + from)
}

fn replace_bytes(hay: &[u8], old: &[u8], new: &[u8], all: bool) -> Option<Vec<u8>> {
    let first = find(hay, old, 0)?;
    let mut out = hay[..first].to_vec();
    out.extend_from_slice(new);
    let mut at = first + old.len();
    while all && let Some(i) = find(hay, old, at) {
        out.extend_from_slice(&hay[at..i]);
        out.extend_from_slice(new);
        at = i + old.len();
    }
    out.extend_from_slice(&hay[at..]);
    Some(out)
}

/// The share of `rejected`'s non-blank lines (trimmed) that are lines of
/// `candidate` (trimmed). `None` when `rejected` has no non-blank line.
#[must_use]
pub fn similarity(rejected: &str, candidate: &str) -> Option<f64> {
    let have: HashSet<&str> = candidate.lines().map(str::trim).collect();
    let lines: Vec<&str> = rejected
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return None;
    }
    let found = lines.iter().filter(|l| have.contains(*l)).count();
    #[allow(clippy::cast_precision_loss)]
    Some(found as f64 / lines.len() as f64)
}

/// The `returned` rule's test of one candidate (clrg's): `rejected` has at
/// least [`RETURNED_MIN_LINES`] non-blank lines, at least [`RETURNED_SHARE`]
/// of them are in `candidate` ([`similarity`] = `share`), and `candidate`'s
/// length is between [`RETURNED_MIN_LEN`] and [`RETURNED_MAX_LEN`] times
/// `rejected`'s.
#[must_use]
pub fn qualifies(rejected: &str, candidate: &str, share: f64) -> bool {
    let lines = rejected.lines().filter(|l| !l.trim().is_empty()).count();
    #[allow(clippy::cast_precision_loss)]
    let (r, c) = (
        rejected.chars().count() as f64,
        candidate.chars().count() as f64,
    );
    lines >= RETURNED_MIN_LINES
        && share >= RETURNED_SHARE
        && c >= RETURNED_MIN_LEN * r
        && c <= RETURNED_MAX_LEN * r
}

impl PathEvidence {
    /// Replay the events that `sources` uses, in order. Each event that says
    /// something about content gives one state:
    ///
    /// - a readable backup: its bytes (or `none` when absent); it resets the
    ///   chain. An unreadable backup file gives no state.
    /// - a write: its content; a write with no content is `diff-only`.
    /// - an edit: applied to `originalFile`, else to the previous known
    ///   content ([`apply_edits`]). No base, or an `old_string` not found:
    ///   `diff-only`, and the chain is broken until the next full-content
    ///   event.
    /// - a write or edit with no result (`unknown`): its state is kept, but
    ///   the chain is broken after it (later edits do not chain from it),
    ///   and it is never `verified`.
    /// - rejected and returned: their content, labelled; the chain (what is
    ///   on disk) does not change.
    ///
    /// A `write`/`edit` state with content is `verified` against the very
    /// next event when that is a readable backup.
    #[must_use]
    pub fn replay(&self, sources: Sources) -> Vec<State> {
        let mut states: Vec<State> = Vec::new();
        let mut chain = Known::Unknown;
        // The state index of the last disk write waiting for a backup.
        let mut pending: Option<usize> = None;
        for (i, e) in self.events.iter().enumerate() {
            if !sources.uses(e.kind) {
                continue;
            }
            let waiting = pending.take();
            let state = |content: Option<Vec<u8>>, recoverable| State {
                event: i,
                kind: e.kind,
                content,
                recoverable,
                verified: None,
            };
            match (&e.kind, &e.change) {
                (EventKind::Backup, Change::Backup(file)) => {
                    let known = match file {
                        None => Known::Absent,
                        Some(f) => match std::fs::read(f) {
                            Ok(b) => Known::Content(b),
                            Err(_) => continue,
                        },
                    };
                    if let Some(w) = waiting {
                        let same = match &known {
                            Known::Content(b) => states[w].content.as_ref() == Some(b),
                            _ => false,
                        };
                        states[w].verified = Some(if same {
                            Verified::Agree
                        } else {
                            Verified::Disagree
                        });
                    }
                    states.push(match &known {
                        Known::Content(b) => state(Some(b.clone()), Recoverable::Full),
                        _ => state(None, Recoverable::None),
                    });
                    chain = known;
                }
                (EventKind::Write | EventKind::Edit, change) => {
                    let after = content_after(change, &chain);
                    let rec = if after.is_some() {
                        Recoverable::Full
                    } else {
                        Recoverable::DiffOnly
                    };
                    // With no result, whether it reached disk is unknown:
                    // later edits do not chain from it.
                    chain = match &after {
                        Some(c) if e.answered => Known::Content(c.clone()),
                        _ => Known::Unknown,
                    };
                    if after.is_some() && e.answered {
                        pending = Some(states.len());
                    }
                    states.push(state(after, rec));
                }
                (EventKind::Rejected | EventKind::Returned, change) => {
                    let intended = content_after(change, &chain);
                    let rec = if intended.is_some() {
                        Recoverable::Full
                    } else {
                        Recoverable::DiffOnly
                    };
                    states.push(state(intended, rec));
                }
                _ => {}
            }
        }
        states
    }

    /// The first root (`root` in records, kept for compatibility).
    #[must_use]
    pub fn root(&self) -> usize {
        self.roots.first().copied().unwrap_or(0)
    }

    /// The distinct kinds of event, in [`EventKind`] order.
    #[must_use]
    pub fn ops(&self) -> Vec<EventKind> {
        let mut ops: Vec<EventKind> = self.events.iter().map(|e| e.kind).collect();
        ops.sort_unstable();
        ops.dedup();
        ops
    }

    /// What the last `write`, `edit`, `rejected`, or `returned` event says.
    #[must_use]
    pub fn outcome(&self) -> FileOutcome {
        let last = self.events.iter().rev().find(|e| {
            matches!(
                e.kind,
                EventKind::Write | EventKind::Edit | EventKind::Rejected | EventKind::Returned
            )
        });
        match last.map(|e| (e.kind, e.answered)) {
            Some((EventKind::Write | EventKind::Edit, true)) => FileOutcome::Written,
            Some((EventKind::Rejected, _)) => FileOutcome::Rejected,
            Some((EventKind::Returned, _)) => FileOutcome::Returned,
            _ => FileOutcome::Unknown,
        }
    }

    /// The first event that is not a `read` or an absent-file backup is a
    /// write (or a rejected write): no earlier backup held content.
    #[must_use]
    pub fn created(&self) -> bool {
        self.events
            .iter()
            .find(|e| {
                e.kind != EventKind::Read
                    && !(e.kind == EventKind::Backup && e.change == Change::Backup(None))
            })
            .is_some_and(Event::is_write)
    }

    /// The sessions, in order of first event.
    #[must_use]
    pub fn sessions(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for s in self.events.iter().filter_map(|e| e.session.as_deref()) {
            if !out.contains(&s) {
                out.push(s);
            }
        }
        out
    }

    /// The branches of the events' lines, in order of first appearance.
    #[must_use]
    pub fn branches(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        for b in self.events.iter().filter_map(|e| e.branch.as_deref()) {
            if !out.contains(&b) {
                out.push(b);
            }
        }
        out
    }

    /// The launch `cwd` of the first event's session that has one.
    #[must_use]
    pub fn cwd(&self) -> Option<&str> {
        self.events.iter().find_map(|e| e.cwd.as_deref())
    }

    /// The earliest and latest event times.
    #[must_use]
    pub fn span(&self) -> (Option<i64>, Option<i64>) {
        let ts = self.events.iter().filter_map(|e| e.ts);
        (ts.clone().min(), ts.max())
    }
}

/// The content after `change` given what was known before it.
fn content_after(change: &Change, before: &Known) -> Option<Vec<u8>> {
    match change {
        Change::Full(b) => Some(b.clone()),
        Change::Edits { original, edits } => {
            // With no base, only an edit that creates the file applies.
            let base = match (original, before) {
                (Some(o), _) => Some(o.as_bytes()),
                (None, Known::Content(c)) => Some(c.as_slice()),
                (None, Known::Absent | Known::Unknown) => None,
            };
            apply_edits(base, edits)
        }
        Change::Backup(_) | Change::Nothing => None,
    }
}

/// The number of distinct contents among `states`.
#[must_use]
pub fn versions(states: &[State]) -> usize {
    let mut seen: Vec<&[u8]> = Vec::new();
    for c in states.iter().filter_map(|s| s.content.as_deref()) {
        if !seen.contains(&c) {
            seen.push(c);
        }
    }
    seen.len()
}

/// How recoverable the last state is (`none` when there is no state).
#[must_use]
pub fn recoverable(states: &[State]) -> Recoverable {
    states.last().map_or(Recoverable::None, |s| s.recoverable)
}

/// What to read.
#[derive(Debug, Clone, Default)]
pub struct EvidenceOptions {
    /// The roots, in the order given.
    pub roots: Vec<PathBuf>,
    /// The selectors.
    pub selectors: Selectors,
    /// `--path`: globs over the resolved path. Empty keeps every path.
    pub paths: Vec<String>,
}

/// An event before its path is resolved and its session is selected.
struct Raw {
    event: Event,
    /// The line's message passes the message selectors.
    passes: bool,
    /// Backups belong to the session, not to a message.
    session_level: bool,
}

/// One transcript's evidence.
struct FileEvidence {
    root: usize,
    session: Option<String>,
    subagent: bool,
    launch: LaunchCwd,
    raws: Vec<Raw>,
    any_pass: bool,
    bad_lines: u64,
    path: PathBuf,
    error: Option<String>,
}

/// Read every transcript in every root, and return the evidence on each
/// chosen path, sorted by path, with what was read (for R4 and warnings).
///
/// Selectors choose paths, not events: a path is chosen when one of its
/// events is selected, and then every event on it (from every session and
/// root) is kept, so a selector never breaks a replay chain. An event is
/// selected when its session passes `--session`, it is not a subagent's
/// under `--no-subagents`, and: with no message selectors, always; with
/// `--scope message`, when its own message passes (a backup or a `returned`
/// string: when its session has a passing message); with `--scope session`,
/// when its session has a passing message.
///
/// # Errors
/// [`Error::Selector`] for a bad selector or `--path` glob.
pub fn collect(opts: &EvidenceOptions) -> Result<(Vec<PathEvidence>, Outcome), Error> {
    let filter = Filter::new(&opts.selectors)?;
    let path_globs = globs("--path", &opts.paths)?;
    let files = walk_files(
        &opts.roots,
        &[StoreKind::Transcripts],
        true,
        |sf, path| {
            if !sf.transcript {
                return None;
            }
            Some(read_file(&filter, &opts.roots, sf, path))
        },
        |error| {
            Some(FileEvidence {
                error: Some(error),
                ..FileEvidence::empty(None, PathBuf::new())
            })
        },
    );
    let mut out = Outcome {
        missing_roots: (0..opts.roots.len())
            .filter(|&i| opts.roots[i].metadata().is_err())
            .collect(),
        ..Outcome::default()
    };
    let mut kept: Vec<FileEvidence> = Vec::new();
    for f in files.into_iter().flatten() {
        let read = f.error.is_none();
        if !f.path.as_os_str().is_empty() {
            out.files_searched += u64::from(read);
            out.unreadable += u64::from(!read);
        }
        out.bad_lines += f.bad_lines;
        if f.bad_lines > 0 {
            out.bad_files.push(f.path.clone());
        }
        if let Some(e) = &f.error {
            out.errors.push(e.clone());
        } else {
            kept.push(f);
        }
    }
    out.bad_files.sort();
    out.errors.sort();
    kept.sort_by(|a, b| (a.root, a.subagent, &a.path).cmp(&(b.root, b.subagent, &b.path)));
    let paths = assemble(kept, &filter, path_globs.as_ref());
    Ok((paths, out))
}

impl FileEvidence {
    fn empty(sf: Option<&StoreFile>, path: PathBuf) -> FileEvidence {
        FileEvidence {
            root: sf.map_or(0, |s| s.root),
            session: sf.and_then(|s| s.session.clone()),
            subagent: sf.is_some_and(|s| s.subagent),
            launch: LaunchCwd::default(),
            raws: Vec::new(),
            any_pass: false,
            bad_lines: 0,
            path,
            error: None,
        }
    }
}

/// Who a file's session is, for the launch `cwd` and the selection: the
/// session id across roots, else the root (a transcript with no session).
type SessionKey = (Option<usize>, Option<String>);

fn session_key(root: usize, session: Option<&String>) -> SessionKey {
    match session {
        Some(s) => (None, Some(s.clone())),
        None => (Some(root), None),
    }
}

/// What makes two events copies of one (clrg's dedupe across roots and
/// repeated snapshots).
#[derive(Clone, Hash, PartialEq, Eq)]
enum DedupeKey {
    /// A `tool_use`: (session, `tool_use_id`).
    Tool(Option<String>, String),
    /// A snapshot entry: (session, recorded path, backup file name,
    /// version). The same entry repeated in later snapshots, or in another
    /// root's copy of the transcript, counts once.
    Backup(Option<String>, String, String, Option<u64>),
    /// A `returned` string: (session, agent, recorded path, content).
    Returned(Option<String>, Option<String>, String, Vec<u8>),
}

fn dedupe_key(e: &Event) -> Option<DedupeKey> {
    match (&e.kind, &e.change) {
        (EventKind::Backup, Change::Backup(file)) => Some(DedupeKey::Backup(
            e.session.clone(),
            e.recorded_path.clone(),
            file.as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            e.version,
        )),
        (EventKind::Returned, Change::Full(c)) => Some(DedupeKey::Returned(
            e.session.clone(),
            e.agent_id.clone(),
            e.recorded_path.clone(),
            c.clone(),
        )),
        _ => e
            .tool_use_id
            .as_ref()
            .map(|id| DedupeKey::Tool(e.session.clone(), id.clone())),
    }
}

/// A later copy is better than the kept one when it has a result and the
/// kept one does not, or its backup file is readable and the kept one's is
/// not.
fn better(new: &Event, kept: &Event) -> bool {
    let readable = |e: &Event| match &e.change {
        Change::Backup(Some(f)) => f.is_file(),
        _ => false,
    };
    (new.answered && !kept.answered) || (readable(new) && !readable(kept))
}

/// Group files by session, resolve paths, merge each path's events across
/// roots (one timeline per path, copies counted once), and keep the paths
/// the selection chooses.
fn assemble(
    files: Vec<FileEvidence>,
    filter: &Filter,
    path_globs: Option<&GlobSet>,
) -> Vec<PathEvidence> {
    let restricting = filter.has_message_selectors();
    let sel = filter.selectors();
    // Per session (across roots): launch cwd (main transcripts first) and
    // whether a message passed.
    let mut sessions: HashMap<SessionKey, (LaunchCwd, bool)> = HashMap::new();
    for f in &files {
        let s = sessions
            .entry(session_key(f.root, f.session.as_ref()))
            .or_insert_with(|| (LaunchCwd::default(), false));
        s.0.merge(&f.launch);
        s.1 |= f.any_pass;
    }
    let mut by_path: HashMap<String, (Vec<Event>, HashSet<usize>, bool)> = HashMap::new();
    // (path, copy key) → index into that path's events.
    let mut seen: HashMap<(String, DedupeKey), usize> = HashMap::new();
    for f in files {
        let (launch, session_pass) = &sessions[&session_key(f.root, f.session.as_ref())];
        let cwd = launch.get().map(str::to_string);
        let session_ok = filter.session_ok(f.session.as_deref()) && (sel.subagents || !f.subagent);
        for raw in f.raws {
            let chooses = session_ok
                && (!restricting
                    || match sel.scope {
                        Scope::Session => *session_pass,
                        Scope::Message if raw.session_level => *session_pass,
                        Scope::Message => raw.passes,
                    });
            let mut e = raw.event;
            e.path = resolve(&e.recorded_path, cwd.as_deref());
            e.cwd.clone_from(&cwd);
            if path_globs.is_some_and(|g| !g.is_match(&e.path)) {
                continue;
            }
            let entry = by_path.entry(e.path.clone()).or_default();
            entry.1.insert(e.root);
            entry.2 |= chooses;
            let Some(k) = dedupe_key(&e) else {
                entry.0.push(e);
                continue;
            };
            if let Some(&i) = seen.get(&(e.path.clone(), k.clone())) {
                if better(&e, &entry.0[i]) {
                    entry.0[i] = e;
                }
            } else {
                seen.insert((e.path.clone(), k), entry.0.len());
                entry.0.push(e);
            }
        }
    }
    let mut out: Vec<PathEvidence> = by_path
        .into_iter()
        .filter(|(_, (_, _, chosen))| *chosen)
        .map(|(path, (mut events, roots, _))| {
            events.sort_by(|a, b| {
                let key = |e: &Event| {
                    (
                        e.ts.is_none(),
                        e.ts,
                        e.kind != EventKind::Backup,
                        e.root,
                        e.transcript.clone(),
                        e.line,
                    )
                };
                key(a).cmp(&key(b))
            });
            let mut roots: Vec<usize> = roots.into_iter().collect();
            roots.sort_unstable();
            PathEvidence {
                roots,
                path,
                events,
            }
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// `recorded` made absolute against `cwd` when it is relative, with `.` and
/// `..` removed lexically (nothing is read from disk).
#[must_use]
pub fn resolve(recorded: &str, cwd: Option<&str>) -> String {
    let p = Path::new(recorded);
    let joined = match cwd {
        Some(c) if p.is_relative() => Path::new(c).join(p),
        _ => p.to_path_buf(),
    };
    if joined.is_relative() {
        return recorded.to_string();
    }
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out.to_string_lossy().into_owned()
}

/// The subagent id in `agent-<id>.jsonl`.
fn agent_id(path: &Path) -> Option<String> {
    let name = path.file_name().and_then(OsStr::to_str)?;
    name.strip_suffix(".jsonl")?
        .strip_prefix("agent-")
        .map(str::to_string)
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// The edits a successful `Edit`/`MultiEdit` made: `toolUseResult`'s
/// `oldString`/`newString`/`replaceAll` for an `Edit` when present, else the
/// input's `old_string`/`new_string`/`replace_all` (`edits[]` for a
/// `MultiEdit`).
fn edits_of(tool: &str, input: &Value, result: Option<&Value>) -> Vec<Replace> {
    let one = |v: &Value, old: &str, new: &str, all: &str| -> Option<Replace> {
        Some(Replace {
            old: str_at(v, old)?.to_string(),
            new: str_at(v, new)?.to_string(),
            all: v.get(all).and_then(Value::as_bool).unwrap_or(false),
        })
    };
    if tool == "MultiEdit" {
        return input
            .get("edits")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|e| one(e, "old_string", "new_string", "replace_all"))
                    .collect()
            })
            .unwrap_or_default();
    }
    result
        .and_then(|r| one(r, "oldString", "newString", "replaceAll"))
        .or_else(|| one(input, "old_string", "new_string", "replace_all"))
        .into_iter()
        .collect()
}

/// A `tool_use` waiting for its result.
struct Pending {
    raw: usize,
    tool: String,
    input: Value,
}

/// A string a subagent returned: (line, ts, text).
type Said = (u64, Option<i64>, String);

/// The strings of a subagent's last `StructuredOutput` input (nested fields
/// included, in document order): (line, ts, strings).
type Structured = (u64, Option<i64>, Vec<String>);

/// Reads one transcript's events.
struct Reader<'a> {
    sf: &'a StoreFile,
    roots: &'a [PathBuf],
    fe: FileEvidence,
    agent: Option<String>,
    pending: HashMap<String, Pending>,
    structured: Option<Structured>,
    assistant_text: Option<Said>,
}

/// Read one transcript's events.
fn read_file(filter: &Filter, roots: &[PathBuf], sf: &StoreFile, path: &Path) -> FileEvidence {
    let mut r = Reader {
        sf,
        roots,
        fe: FileEvidence::empty(Some(sf), path.to_path_buf()),
        agent: if sf.subagent { agent_id(path) } else { None },
        pending: HashMap::new(),
        structured: None,
        assistant_text: None,
    };
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            r.fe.error = Some(format!("{}: {e}", path.display()));
            return r.fe;
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
                r.fe.error = Some(format!("{}: {e}", path.display()));
                break;
            }
        }
        let raw = trim_eol(&buf);
        if raw.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        match serde_json::from_slice::<Value>(raw) {
            Ok(v) => r.line(filter, n, &v),
            Err(_) => r.fe.bad_lines += 1,
        }
    }
    if sf.subagent {
        let (structured, text) = (r.structured.take(), r.assistant_text.take());
        returned(&mut r.fe, path, r.agent.as_deref(), structured, text);
    }
    r.fe
}

impl Reader<'_> {
    fn line(&mut self, filter: &Filter, n: u64, v: &Value) {
        let sf = self.sf;
        let mut meta = decode::transcript_meta(v);
        if meta.session.is_none() {
            meta.session.clone_from(&sf.session);
        }
        meta.project.clone_from(&sf.project);
        meta.sidechain |= sf.subagent;
        if let Some(c) = &meta.cwd {
            self.fe.launch.see(c, meta.project.as_deref());
        }
        let kind = decode::line_type(v);
        let passes = matches!(kind, Some("user" | "assistant")) && filter.message_ok(&meta);
        self.fe.any_pass |= passes;
        let base = Event {
            kind: EventKind::Read,
            path: String::new(),
            recorded_path: String::new(),
            ts: meta.ts,
            root: sf.root,
            session: sf.session.clone().or(meta.session),
            agent_id: self.agent.clone(),
            cwd: None,
            branch: meta.branch,
            transcript: self.fe.path.clone(),
            line: n,
            tool: None,
            tool_use_id: None,
            answered: false,
            change: Change::Nothing,
            version: None,
            similarity: None,
            journal: None,
        };
        let parts = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array);
        match kind {
            Some("assistant") => {
                for part in parts.into_iter().flatten() {
                    self.assistant_part(&base, part, passes);
                }
            }
            Some("user") => {
                let results: Vec<&Value> = parts
                    .into_iter()
                    .flatten()
                    .filter(|p| str_at(p, "type") == Some("tool_result"))
                    .collect();
                let tur = v.get("toolUseResult").filter(|_| results.len() == 1);
                for r in results {
                    let Some(p) = str_at(r, "tool_use_id").and_then(|id| self.pending.remove(id))
                    else {
                        continue;
                    };
                    let error = r.get("is_error").and_then(Value::as_bool) == Some(true);
                    answer(&mut self.fe.raws[p.raw].event, &p, error, tur);
                }
            }
            Some("file-history-snapshot") => self.snapshot(&base, v),
            _ => {}
        }
    }

    /// One content part of an assistant line: text, a write-family or
    /// `Read` `tool_use`, or a `StructuredOutput` `tool_use`.
    fn assistant_part(&mut self, base: &Event, part: &Value, passes: bool) {
        match str_at(part, "type") {
            Some("text") => {
                if let Some(t) = str_at(part, "text") {
                    self.assistant_text = Some((base.line, base.ts, t.to_string()));
                }
            }
            Some("tool_use") => {
                let (Some(name), Some(input)) = (str_at(part, "name"), part.get("input")) else {
                    return;
                };
                if name == "StructuredOutput" {
                    let mut strings = Vec::new();
                    decode::for_each_string(input, &mut |s| strings.push(s.to_string()));
                    self.structured = Some((base.line, base.ts, strings));
                    return;
                }
                let (kind, change) = match name {
                    "Write" | "NotebookEdit" => (
                        EventKind::Write,
                        str_at(input, "content")
                            .map_or(Change::Nothing, |c| Change::Full(c.as_bytes().to_vec())),
                    ),
                    "Edit" | "MultiEdit" => (
                        EventKind::Edit,
                        Change::Edits {
                            original: None,
                            edits: edits_of(name, input, None),
                        },
                    ),
                    "Read" => (EventKind::Read, Change::Nothing),
                    _ => return,
                };
                let Some(file_path) =
                    str_at(input, "file_path").or_else(|| str_at(input, "notebook_path"))
                else {
                    return;
                };
                let e = Event {
                    kind,
                    recorded_path: file_path.to_string(),
                    tool: Some(name.to_string()),
                    tool_use_id: str_at(part, "id").map(str::to_string),
                    change,
                    ..base.clone()
                };
                if let Some(id) = &e.tool_use_id {
                    self.pending.insert(
                        id.clone(),
                        Pending {
                            raw: self.fe.raws.len(),
                            tool: name.to_string(),
                            input: input.clone(),
                        },
                    );
                }
                self.fe.raws.push(Raw {
                    event: e,
                    passes,
                    session_level: false,
                });
            }
            _ => {}
        }
    }

    /// A `file-history-snapshot` line: one `backup` event per
    /// `snapshot.trackedFileBackups` entry.
    fn snapshot(&mut self, base: &Event, v: &Value) {
        let Some(sid) = base.session.clone() else {
            return;
        };
        let Some(dir) = self
            .roots
            .get(self.sf.root)
            .map(|r| r.join("file-history").join(&sid))
        else {
            return;
        };
        let Some(map) = v
            .get("snapshot")
            .and_then(|s| s.get("trackedFileBackups"))
            .and_then(Value::as_object)
        else {
            return;
        };
        for (p, b) in map {
            let file = match b.get("backupFileName") {
                Some(Value::String(name)) => Some(dir.join(name)),
                _ => None,
            };
            let e = Event {
                kind: EventKind::Backup,
                recorded_path: p.clone(),
                ts: b
                    .get("backupTime")
                    .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(parse_ts))),
                version: b.get("version").and_then(Value::as_u64),
                answered: true,
                branch: None,
                change: Change::Backup(file),
                ..base.clone()
            };
            self.fe.raws.push(Raw {
                event: e,
                passes: false,
                session_level: true,
            });
        }
    }
}

/// Record a `tool_result` on its `tool_use` event.
fn answer(e: &mut Event, p: &Pending, error: bool, tur: Option<&Value>) {
    e.answered = true;
    if error {
        // Only a write tool's failure is a rejected write. A failed `Read`
        // stays a `read`.
        if WRITE_TOOLS.contains(&p.tool.as_str()) {
            e.kind = EventKind::Rejected;
        }
        return;
    }
    let tur = tur.filter(|t| t.is_object());
    match e.kind {
        EventKind::Write => {
            if let Some(c) = tur.and_then(|t| str_at(t, "content")) {
                e.change = Change::Full(c.as_bytes().to_vec());
            }
        }
        EventKind::Edit => {
            e.change = Change::Edits {
                original: tur
                    .and_then(|t| str_at(t, "originalFile"))
                    .map(str::to_string),
                edits: edits_of(&p.tool, &p.input, tur),
            };
        }
        _ => {}
    }
}

/// The `returned` rule (clrg's), for one subagent transcript.
///
/// The candidates are the strings of the agent's last `StructuredOutput`
/// input (nested fields included) and its last assistant text. For each path
/// with a rejected full-content write, the last such write before a
/// candidate is compared with every candidate after it, and its candidate
/// is the one with the highest [`similarity`] (the first on a tie). That
/// candidate is `returned` only when it [`qualifies`]. Each candidate string
/// is returned for at most one path: the one it matches with the highest
/// similarity (the first rejected write on a tie).
fn returned(
    fe: &mut FileEvidence,
    path: &Path,
    agent: Option<&str>,
    structured: Option<Structured>,
    text: Option<Said>,
) {
    let mut cands: Vec<Said> = structured
        .into_iter()
        .flat_map(|(line, ts, strings)| strings.into_iter().map(move |s| (line, ts, s)))
        .collect();
    cands.extend(text);
    let Some(latest) = cands.iter().map(|c| c.0).max() else {
        return;
    };
    // The last rejected full-content write per path, before a candidate.
    let mut last: HashMap<&str, usize> = HashMap::new();
    for (i, r) in fe.raws.iter().enumerate() {
        if r.event.kind == EventKind::Rejected
            && r.event.line < latest
            && matches!(r.event.change, Change::Full(_))
        {
            last.insert(r.event.recorded_path.as_str(), i);
        }
    }
    let mut picks: Vec<usize> = last.into_values().collect();
    picks.sort_unstable();
    // Per rejected write: its best candidate (index, share), when it
    // qualifies.
    let mut best: Vec<(usize, usize, f64)> = Vec::new();
    for &i in &picks {
        let r = &fe.raws[i];
        let Change::Full(content) = &r.event.change else {
            continue;
        };
        let rejected = String::from_utf8_lossy(content);
        let mut top: Option<(usize, f64)> = None;
        for (j, (line, _, cand)) in cands.iter().enumerate() {
            if *line <= r.event.line {
                continue;
            }
            if let Some(share) = similarity(&rejected, cand)
                && top.is_none_or(|(_, s)| share > s)
            {
                top = Some((j, share));
            }
        }
        if let Some((j, share)) = top
            && qualifies(&rejected, &cands[j].2, share)
        {
            best.push((i, j, share));
        }
    }
    let mut journal: HashMap<usize, Journal> = HashMap::new();
    let mut add = Vec::new();
    for &(i, j, share) in &best {
        // Another path matches this candidate better (or as well, earlier).
        if best
            .iter()
            .any(|&(i2, j2, s2)| j2 == j && s2.total_cmp(&share).then(i.cmp(&i2)).is_gt())
        {
            continue;
        }
        let (line, ts, cand) = &cands[j];
        let r = &fe.raws[i];
        let jr = *journal
            .entry(j)
            .or_insert_with(|| journal_check(path, agent, cand));
        let mut e = r.event.clone();
        e.kind = EventKind::Returned;
        e.ts = *ts;
        e.line = *line;
        e.tool = None;
        e.tool_use_id = None;
        e.answered = true;
        e.change = Change::Full(cand.as_bytes().to_vec());
        e.similarity = Some(share);
        e.journal = Some(jr);
        add.push(Raw {
            event: e,
            passes: r.passes,
            session_level: false,
        });
    }
    fe.raws.extend(add);
}

/// The journal cross-check: `journal.jsonl` beside the agent's transcript
/// holds lines with `agentId` and `result`. `agree` when a `result` for this
/// agent has a string that contains `text`, `disagree` when results exist
/// and none does, `none` when there is no journal or no result.
fn journal_check(transcript: &Path, agent: Option<&str>, text: &str) -> Journal {
    let (Some(agent), Some(dir)) = (agent, transcript.parent()) else {
        return Journal::None;
    };
    let Ok(file) = std::fs::File::open(dir.join(JOURNAL)) else {
        return Journal::None;
    };
    let mut found = false;
    for line in BufReader::new(file).split(b'\n') {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_slice::<Value>(trim_eol(&line)) else {
            continue;
        };
        if str_at(&v, "agentId") != Some(agent) {
            continue;
        }
        let Some(result) = v.get("result") else {
            continue;
        };
        found = true;
        let mut has = false;
        decode::for_each_string(result, &mut |s| has |= s.contains(text));
        if has {
            return Journal::Agree;
        }
    }
    if found {
        Journal::Disagree
    } else {
        Journal::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: EventKind, ts: i64, change: Change) -> Event {
        Event {
            kind,
            path: "/w/a.txt".into(),
            recorded_path: "/w/a.txt".into(),
            ts: Some(ts),
            root: 0,
            session: Some("s1".into()),
            agent_id: None,
            cwd: Some("/w".into()),
            branch: None,
            transcript: PathBuf::from("/r/projects/-w/s1.jsonl"),
            line: u64::try_from(ts).unwrap(),
            tool: None,
            tool_use_id: None,
            answered: true,
            change,
            version: None,
            similarity: None,
            journal: None,
        }
    }

    fn full(s: &str) -> Change {
        Change::Full(s.as_bytes().to_vec())
    }

    fn edit(original: Option<&str>, old: &str, new: &str, all: bool) -> Change {
        Change::Edits {
            original: original.map(str::to_string),
            edits: vec![Replace {
                old: old.into(),
                new: new.into(),
                all,
            }],
        }
    }

    fn contents(states: &[State]) -> Vec<(EventKind, Option<String>, Recoverable)> {
        states
            .iter()
            .map(|s| {
                (
                    s.kind,
                    s.content
                        .as_ref()
                        .map(|c| String::from_utf8_lossy(c).into_owned()),
                    s.recoverable,
                )
            })
            .collect()
    }

    fn path(events: Vec<Event>) -> PathEvidence {
        PathEvidence {
            roots: vec![0],
            path: "/w/a.txt".into(),
            events,
        }
    }

    #[test]
    fn replay_applies_writes_and_edits_in_order() {
        let p = path(vec![
            ev(EventKind::Write, 1, full("a b a\n")),
            ev(EventKind::Edit, 2, edit(None, "a", "x", true)),
            ev(EventKind::Edit, 3, edit(None, "b", "y", false)),
        ]);
        let s = p.replay(Sources::Best);
        assert_eq!(
            contents(&s),
            vec![
                (EventKind::Write, Some("a b a\n".into()), Recoverable::Full),
                (EventKind::Edit, Some("x b x\n".into()), Recoverable::Full),
                (EventKind::Edit, Some("x y x\n".into()), Recoverable::Full),
            ]
        );
        assert_eq!(versions(&s), 3);
        assert_eq!(recoverable(&s), Recoverable::Full);
        assert_eq!(p.outcome(), FileOutcome::Written);
        assert!(p.created());
    }

    #[test]
    fn edit_without_base_is_diff_only_until_full_content() {
        let p = path(vec![
            ev(EventKind::Edit, 1, edit(None, "a", "b", false)),
            ev(EventKind::Edit, 2, edit(None, "b", "c", false)),
            ev(EventKind::Write, 3, full("w")),
            ev(EventKind::Edit, 4, edit(None, "nope", "z", false)),
            ev(EventKind::Edit, 5, edit(Some("orig"), "orig", "o2", false)),
        ]);
        let s = p.replay(Sources::Best);
        let rec: Vec<Recoverable> = s.iter().map(|s| s.recoverable).collect();
        assert_eq!(
            rec,
            vec![
                Recoverable::DiffOnly,
                Recoverable::DiffOnly,
                Recoverable::Full,
                Recoverable::DiffOnly,
                Recoverable::Full,
            ]
        );
        assert_eq!(s[4].content.as_deref(), Some(b"o2".as_slice()));
        assert!(!p.created(), "the first event is an edit");
    }

    #[test]
    fn rejected_and_returned_do_not_change_disk() {
        let p = path(vec![
            ev(EventKind::Write, 1, full("one\n")),
            ev(EventKind::Rejected, 2, full("draft\n")),
            ev(EventKind::Edit, 3, edit(None, "one", "two", false)),
            ev(EventKind::Returned, 4, full("final\n")),
        ]);
        let s = p.replay(Sources::Best);
        assert_eq!(
            contents(&s)
                .into_iter()
                .map(|c| c.1.unwrap())
                .collect::<Vec<_>>(),
            vec!["one\n", "draft\n", "two\n", "final\n"]
        );
        assert_eq!(p.outcome(), FileOutcome::Returned);
        let t = p.replay(Sources::FileHistory);
        assert!(t.is_empty());
    }

    #[test]
    fn replay_is_verified_against_the_next_backup() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("h@v2");
        let bad = dir.path().join("h@v3");
        std::fs::write(&good, "x\n").unwrap();
        std::fs::write(&bad, "something else\n").unwrap();
        let p = path(vec![
            ev(EventKind::Backup, 1, Change::Backup(None)),
            ev(EventKind::Write, 2, full("x\n")),
            ev(EventKind::Backup, 3, Change::Backup(Some(good))),
            ev(EventKind::Edit, 4, edit(None, "x", "y", false)),
            ev(EventKind::Read, 5, Change::Nothing),
            ev(EventKind::Backup, 6, Change::Backup(Some(bad))),
            ev(EventKind::Edit, 7, edit(None, "something", "some", false)),
            ev(EventKind::Rejected, 8, full("z")),
            ev(
                EventKind::Backup,
                9,
                Change::Backup(Some(dir.path().join("missing"))),
            ),
        ]);
        let s = p.replay(Sources::Best);
        let v: Vec<(EventKind, Option<Verified>)> =
            s.iter().map(|s| (s.kind, s.verified)).collect();
        assert_eq!(
            v,
            vec![
                (EventKind::Backup, None),
                (EventKind::Write, Some(Verified::Agree)),
                (EventKind::Backup, None),
                // A read is not content evidence: the backup is still next.
                (EventKind::Edit, Some(Verified::Disagree)),
                (EventKind::Backup, None),
                // A rejected event in between: no verification.
                (EventKind::Edit, None),
                (EventKind::Rejected, None),
            ]
        );
        assert_eq!(s[0].recoverable, Recoverable::None, "absent");
        // The backup is the observed truth: the next edit applies to it.
        assert_eq!(s[5].content.as_deref(), Some(b"some else\n".as_slice()));
        assert!(p.created(), "an absent backup holds no content");
        let fh = p.replay(Sources::FileHistory);
        assert_eq!(fh.len(), 3);
        assert_eq!(versions(&s), 5);
    }

    #[test]
    fn similarity_counts_non_blank_lines() {
        let draft = "# Title\n\nline one\nline two\n  line three  \nold line\n";
        let fin = "# Title\nline one\nline two\nline three\nnew line\nmore\n";
        let s = similarity(draft, fin).unwrap();
        assert!((s - 0.8).abs() < 1e-9, "{s}");
        assert_eq!(similarity("\n \n", fin), None);
        assert!(similarity("a\nb\n", "a\n").unwrap() < RETURNED_SHARE);
    }

    #[test]
    fn edits_replace_exactly() {
        let r = |old: &str, new: &str, all| Replace {
            old: old.into(),
            new: new.into(),
            all,
        };
        assert_eq!(
            apply_edits(Some(b"aXbXc"), &[r("X", "--", true)]).as_deref(),
            Some(b"a--b--c".as_slice())
        );
        assert_eq!(
            apply_edits(Some(b"aXbXc"), &[r("X", "-", false)]).as_deref(),
            Some(b"a-bXc".as_slice())
        );
        assert_eq!(apply_edits(Some(b"abc"), &[r("z", "-", false)]), None);
        assert_eq!(
            apply_edits(None, &[r("", "new", false)]).as_deref(),
            Some(b"new".as_slice())
        );
        assert_eq!(apply_edits(Some(b"x"), &[r("", "new", false)]), None);
        // CRLF: matched as LF, written back as CRLF.
        assert_eq!(
            apply_edits(Some(b"a\r\nb\r\nc\r\n"), &[r("b\nc", "B\nC", false)]).as_deref(),
            Some(b"a\r\nB\r\nC\r\n".as_slice())
        );
        assert_eq!(
            apply_edits(Some(b"a\r\nb\r\n"), &[r("b\r\n", "", false)]).as_deref(),
            Some(b"a\r\n".as_slice())
        );
        // An empty new string removes the whole line, newline included.
        assert_eq!(
            apply_edits(Some(b"keep\ndrop\nkeep\n"), &[r("drop", "", false)]).as_deref(),
            Some(b"keep\nkeep\n".as_slice())
        );
        // At the end with no newline after it: only the text goes.
        assert_eq!(
            apply_edits(Some(b"keep\ndrop"), &[r("drop", "", false)]).as_deref(),
            Some(b"keep\n".as_slice())
        );
    }

    #[test]
    fn returned_rule_qualification() {
        let draft = "a\nb\nc\nd\ne\n";
        assert!(qualifies(draft, draft, 1.0));
        assert!(!qualifies(draft, draft, 0.79), "below the share");
        assert!(
            !qualifies("{\n}\n", "{\n}\n", 1.0),
            "under 3 non-blank lines"
        );
        assert!(!qualifies(draft, &draft.repeat(3), 1.0), "over 2x as long");
        assert!(
            !qualifies(&"x\n".repeat(10), "x\n", 1.0),
            "under half as long"
        );
        assert!(qualifies(draft, &draft.repeat(2), 1.0), "2x is allowed");
    }

    #[test]
    fn relative_paths_resolve_lexically() {
        assert_eq!(resolve("src/a.rs", Some("/w/app")), "/w/app/src/a.rs");
        assert_eq!(resolve("../b/./c.rs", Some("/w/app")), "/w/b/c.rs");
        assert_eq!(resolve("/abs/x", Some("/w")), "/abs/x");
        assert_eq!(resolve("rel/x", None), "rel/x");
    }

    fn write_lines(path: &Path, lines: &[Value]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let text: String = lines.iter().map(|l| l.to_string() + "\n").collect();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn returned_rule_and_journal() {
        use serde_json::json;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let wf = root.join("projects/-w/s1/subagents/workflows/wf1");
        let draft = "# Report\nalpha\nbeta\ngamma\ndelta\n";
        let fin = "# Report\nalpha\nbeta\ngamma\ndelta (linted)\nepsilon\n";
        let ts = |m: u32| format!("2026-08-02T14:{m:02}:00.000Z");
        let line = |kind: &str, m: u32, content: Value| {
            json!({"type": kind, "sessionId": "s1", "cwd": "/w", "timestamp": ts(m),
                   "isSidechain": true, "message": {"content": content}})
        };
        write_lines(
            &wf.join("agent-a1.jsonl"),
            &[
                line(
                    "assistant",
                    1,
                    json!([{"type": "tool_use", "id": "t1", "name": "Write",
                    "input": {"file_path": "out/REPORT.md", "content": draft}}]),
                ),
                line(
                    "user",
                    2,
                    json!([{"type": "tool_result", "tool_use_id": "t1", "is_error": true,
                    "content": "Subagents should return findings as text"}]),
                ),
                line(
                    "assistant",
                    3,
                    json!([{"type": "text", "text": "short"},
                    {"type": "tool_use", "id": "t2", "name": "StructuredOutput",
                     "input": {"file": fin, "summary": "done"}}]),
                ),
            ],
        );
        write_lines(
            &wf.join(JOURNAL),
            &[json!({"type": "result", "agentId": "a1", "result": {"file": fin}})],
        );
        write_lines(
            &root.join("projects/-w/s1.jsonl"),
            &[line("user", 0, json!("go"))],
        );
        let opts = EvidenceOptions {
            roots: vec![root.to_path_buf()],
            selectors: Selectors {
                subagents: true,
                ..Selectors::default()
            },
            paths: Vec::new(),
        };
        let (paths, out) = collect(&opts).unwrap();
        assert_eq!(out.files_searched, 2);
        assert_eq!(paths.len(), 1);
        let p = &paths[0];
        assert_eq!(p.path, "/w/out/REPORT.md");
        let kinds: Vec<EventKind> = p.events.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec![EventKind::Rejected, EventKind::Returned]);
        let r = &p.events[1];
        assert_eq!(r.agent_id.as_deref(), Some("a1"));
        assert_eq!(r.journal, Some(Journal::Agree));
        assert!((r.similarity.unwrap() - 0.8).abs() < 1e-9);
        assert_eq!(p.outcome(), FileOutcome::Returned);
        let s = p.replay(Sources::Best);
        assert_eq!(s.last().unwrap().content.as_deref(), Some(fin.as_bytes()));
        assert!(p.created());

        // A journal result that differs: disagree. No journal: none.
        write_lines(
            &wf.join(JOURNAL),
            &[json!({"agentId": "a1", "result": "something else"})],
        );
        let (paths, _) = collect(&opts).unwrap();
        assert_eq!(paths[0].events[1].journal, Some(Journal::Disagree));
        std::fs::remove_file(wf.join(JOURNAL)).unwrap();
        let (paths, _) = collect(&opts).unwrap();
        assert_eq!(paths[0].events[1].journal, Some(Journal::None));
    }
}
