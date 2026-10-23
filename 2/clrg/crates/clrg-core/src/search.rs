//! The search: walk the roots in parallel, pre-filter raw bytes with
//! `grep-searcher`, decode only the lines that pass, match the decoded text,
//! then apply the selectors.
//!
//! Hits come back in a stable order: root (as given), store, path, line,
//! then position in the line. Domain ordering (R5) and session headers are
//! the renderer's job; every hit carries the root index, store, session id,
//! timestamp, and cwd it needs for that.

use std::collections::HashSet;
use std::io::{self, BufRead as _, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, mpsc};

use grep_matcher::Matcher as _;
use grep_regex::RegexMatcher;
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch, sinks};
use ignore::WalkState;
use serde_json::Value;

use crate::agree::{Agreement, Rule};
use crate::decode::{self, MessageMeta};
use crate::discover::{self, FileFormat, StoreFile};
use crate::pattern::{CompiledPattern, Query};
use crate::select::{Filter, Scope, Selectors};
pub(crate) use crate::session::trim_eol;
use crate::session::{self, SessionInfo};
use crate::{Error, StoreKind};

/// Bytes of decoded text kept on each side of a match in an excerpt.
pub const EXCERPT_CONTEXT: usize = 80;

/// What to search, besides the pattern.
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// The roots, in the order given (R5 orders results by it).
    pub roots: Vec<PathBuf>,
    /// The stores to search. Empty means every store.
    pub stores: Vec<StoreKind>,
    /// `--in`: the raw labels to search. Empty means everything. A hit with
    /// no label (a plan, a todo, ...) only passes when this is empty.
    pub ins: Vec<InSelector>,
    /// The selectors.
    pub selectors: Selectors,
    /// Parse every JSON line, not only those that pass the pre-filter, so
    /// every unparsable line is counted (`--strict`).
    pub parse_all: bool,
    /// Also read the header ([`crate::session::read_session`]) of each main
    /// transcript with a hit, on the walker thread right after it is
    /// searched, so the work overlaps the walk (R8). Human and record output
    /// need it ([`crate::order::group`]); `-l` does not.
    pub headers: bool,
}

/// One `--in` selector over raw labels (R9).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InSelector {
    /// A line type (`user`) or a part type (`tool_result`).
    Name(String),
    /// A line type and a part type (`user/text`).
    Pair(String, String),
}

impl InSelector {
    /// Parse `name` or `type/part`. `None` when a side is empty.
    #[must_use]
    pub fn parse(s: &str) -> Option<InSelector> {
        match s.split_once('/') {
            Some((t, p)) if !t.is_empty() && !p.is_empty() => {
                Some(InSelector::Pair(t.into(), p.into()))
            }
            Some(_) => None,
            None if s.is_empty() => None,
            None => Some(InSelector::Name(s.into())),
        }
    }

    /// Whether a unit with these raw labels passes.
    #[must_use]
    pub fn matches(&self, kind: Option<&str>, part: Option<&str>) -> bool {
        match self {
            InSelector::Name(n) => kind == Some(n.as_str()) || part == Some(n.as_str()),
            InSelector::Pair(t, p) => kind == Some(t.as_str()) && part == Some(p.as_str()),
        }
    }
}

/// One match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    /// Index into [`SearchOptions::roots`].
    pub root: usize,
    /// The store the file belongs to.
    pub store: StoreKind,
    /// The file.
    pub path: PathBuf,
    /// 1-based line number; `None` for a hit inside a whole JSON document.
    pub line: Option<u64>,
    /// The line's raw `type` (`user`, `assistant`, `system`, ...); `history`
    /// for a `history.jsonl` line; `None` in other stores.
    pub kind: Option<String>,
    /// The raw content-part type that matched (`text`, `tool_use`, ...);
    /// `None` outside message content.
    pub part: Option<String>,
    /// The message (or line) metadata: session, cwd, branch, ts, ...
    pub meta: MessageMeta,
    /// Decoded text around the match; newlines and tabs become spaces.
    pub excerpt: String,
    /// Byte offset of the match start in `excerpt`.
    pub match_start: usize,
    /// Byte offset of the match end in `excerpt`.
    pub match_end: usize,
    /// The text goes on before the excerpt.
    pub cut_left: bool,
    /// The text goes on after the excerpt.
    pub cut_right: bool,
    /// The line failed to parse; the hit is from its raw text.
    pub unparsed: bool,
    /// Ordinal of the matched text unit within its line, for stable order.
    pub unit: u32,
    /// clrg's: `user/text` and `history` hits only (see [`crate::agree`]).
    pub agreement: Option<Agreement>,
    /// clrg's: the rule that made `agreement` `both`.
    pub agreement_rule: Option<Rule>,
    /// clrg's: on `user/text` hits, whether it is the session's last.
    pub last: Option<bool>,
}

/// The result of a search.
#[derive(Debug, Clone, Default)]
pub struct Outcome {
    /// Matches that passed every selector, in stable order.
    pub hits: Vec<Hit>,
    /// Files searched (in the selected stores, before the pre-filter). A
    /// file that failed to read is not counted.
    pub files_searched: u64,
    /// Files that failed to read (each is also in `errors`).
    pub unreadable: u64,
    /// Lines (or JSON documents) that were parsed and failed to parse.
    pub bad_lines: u64,
    /// Files with at least one bad line, sorted.
    pub bad_files: Vec<PathBuf>,
    /// Unreadable files or directories, as messages.
    pub errors: Vec<String>,
    /// Indexes of roots that do not exist.
    pub missing_roots: Vec<usize>,
    /// Symlinks in the selected stores that were not followed (R3: counted
    /// and reported, never dropped silently).
    pub skipped_symlinks: u64,
    /// With [`SearchOptions::headers`]: the headers of the main transcripts
    /// with hits.
    pub infos: Vec<SessionInfo>,
}

struct Ctx<'a> {
    pattern: &'a CompiledPattern,
    ins: &'a [InSelector],
    subagents: bool,
    parse_all: bool,
    headers: bool,
}

#[derive(Default)]
struct FileResult {
    searched: bool,
    hits: Vec<Hit>,
    info: Option<SessionInfo>,
    bad_lines: u64,
    path: PathBuf,
    error: Option<String>,
}

/// Search `opts.roots` for `query`.
///
/// # Errors
/// [`Error`] when the pattern or a selector does not compile. Unreadable
/// files are reported in [`Outcome::errors`], not as an error.
pub fn search(query: &Query, opts: &SearchOptions) -> Result<Outcome, Error> {
    let pattern = CompiledPattern::new(query)?;
    let filter = Filter::new(&opts.selectors)?;
    let stores: Vec<StoreKind> = if opts.stores.is_empty() {
        StoreKind::ALL.to_vec()
    } else {
        opts.stores.clone()
    };
    let ctx = Ctx {
        pattern: &pattern,
        ins: &opts.ins,
        subagents: opts.selectors.subagents,
        parse_all: opts.parse_all,
        headers: opts.headers,
    };

    let mut out = Outcome {
        missing_roots: (0..opts.roots.len())
            .filter(|&i| opts.roots[i].metadata().is_err())
            .collect(),
        ..Outcome::default()
    };

    let (results, symlinks) = walk_files_counting(
        &opts.roots,
        &stores,
        opts.selectors.subagents,
        |sf, path| search_file(&ctx, sf, path),
        |error| FileResult {
            error: Some(error),
            ..FileResult::default()
        },
    );
    out.skipped_symlinks = symlinks;
    let mut bad_files = Vec::new();
    for r in results {
        out.files_searched += u64::from(r.searched);
        out.unreadable += u64::from(r.error.is_some() && !r.path.as_os_str().is_empty());
        out.bad_lines += r.bad_lines;
        if r.bad_lines > 0 {
            bad_files.push(r.path);
        }
        out.errors.extend(r.error);
        out.hits.extend(r.hits);
        out.infos.extend(r.info);
    }
    bad_files.sort();
    out.bad_files = bad_files;
    out.errors.sort();

    apply_selectors(&mut out.hits, &filter, &opts.roots);
    out.hits.sort_by(|a, b| {
        (a.root, a.store, &a.path, a.line, a.unit).cmp(&(b.root, b.store, &b.path, b.line, b.unit))
    });
    Ok(out)
}

/// Walk the stores of every root in parallel, calling `visit` for each store
/// file and `error` for each walk error. Returns one result per call.
pub(crate) fn walk_files<R, F, E>(
    roots: &[PathBuf],
    stores: &[StoreKind],
    subagents: bool,
    visit: F,
    error: E,
) -> Vec<R>
where
    R: Send,
    F: Fn(&StoreFile, &Path) -> R + Sync,
    E: Fn(String) -> R + Sync,
{
    walk_files_counting(roots, stores, subagents, visit, error).0
}

/// [`walk_files`], and the number of symlinks in the selected stores that
/// were not followed.
pub(crate) fn walk_files_counting<R, F, E>(
    roots: &[PathBuf],
    stores: &[StoreKind],
    subagents: bool,
    visit: F,
    error: E,
) -> (Vec<R>, u64)
where
    R: Send,
    F: Fn(&StoreFile, &Path) -> R + Sync,
    E: Fn(String) -> R + Sync,
{
    let paths: Vec<PathBuf> = roots
        .iter()
        .flat_map(|r| discover::store_paths(r, stores))
        .collect();
    let root_links: u64 = roots
        .iter()
        .map(|r| discover::skipped_root_symlinks(r, stores))
        .sum();
    let Some(walker) = discover::walker(&paths) else {
        return (Vec::new(), root_links);
    };
    let symlinks = AtomicU64::new(root_links);
    let (tx, rx) = mpsc::channel();
    walker.run(|| {
        let tx = tx.clone();
        let visit = &visit;
        let error = &error;
        let symlinks = &symlinks;
        Box::new(move |entry| {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    let _ = tx.send(error(e.to_string()));
                    return WalkState::Continue;
                }
            };
            let symlink = entry.file_type().is_some_and(|t| t.is_symlink());
            if !symlink && !entry.file_type().is_some_and(|t| t.is_file()) {
                return WalkState::Continue;
            }
            let path = entry.path();
            let found = roots
                .iter()
                .enumerate()
                .find_map(|(i, r)| discover::classify(i, r, path));
            let Some(sf) = found else {
                return WalkState::Continue;
            };
            if !stores.contains(&sf.store) || (sf.subagent && !subagents) {
                return WalkState::Continue;
            }
            if symlink {
                // Not followed (like `rg -uu`), but counted (R3).
                symlinks.fetch_add(1, Ordering::Relaxed);
                return WalkState::Continue;
            }
            let _ = tx.send(visit(&sf, path));
            WalkState::Continue
        })
    });
    drop(tx);
    (rx.into_iter().collect(), symlinks.into_inner())
}

/// Call `f(line_number, line)` for each line `matcher` matches, or for every
/// line when there is no matcher.
pub(crate) fn scan_lines(
    matcher: Option<&RegexMatcher>,
    path: &Path,
    mut f: impl FnMut(u64, &[u8]),
) -> io::Result<()> {
    if let Some(m) = matcher {
        let mut builder = SearcherBuilder::new();
        if let Some(lt) = m.line_terminator() {
            builder.line_terminator(lt);
        }
        let mut searcher = builder.line_number(true).build();
        return searcher.search_path(
            m,
            path,
            sinks::Bytes(|n, line| {
                f(n, line);
                Ok(true)
            }),
        );
    }
    let mut reader = BufReader::new(std::fs::File::open(path)?);
    let mut buf = Vec::new();
    let mut n = 0;
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            return Ok(());
        }
        n += 1;
        f(n, &buf);
    }
}

/// A sink that stops at the first match and remembers that it saw one.
struct AnyMatch(bool);

impl Sink for AnyMatch {
    type Error = io::Error;
    fn matched(&mut self, _: &Searcher, _: &SinkMatch<'_>) -> Result<bool, io::Error> {
        self.0 = true;
        Ok(false)
    }
}

/// The excerpt around `start..end` in `text`, and the match offsets in it.
#[must_use]
pub fn excerpt(text: &str, start: usize, end: usize) -> (String, usize, usize) {
    let mut a = start.saturating_sub(EXCERPT_CONTEXT);
    while !text.is_char_boundary(a) {
        a -= 1;
    }
    let mut b = end.saturating_add(EXCERPT_CONTEXT).min(text.len());
    while !text.is_char_boundary(b) {
        b += 1;
    }
    // Single-byte replacements keep the offsets valid.
    let s = text[a..b].replace(['\n', '\r', '\t'], " ");
    (s, start - a, end - a)
}

/// Collects the hits of one line or document.
struct LineHits<'a, 'c> {
    ctx: &'a Ctx<'c>,
    sf: &'a StoreFile,
    path: &'a Path,
    line: Option<u64>,
    meta: &'a MessageMeta,
    /// The line's raw `type`.
    kind: Option<&'a str>,
    unparsed: bool,
    unit: u32,
    out: &'a mut Vec<Hit>,
}

impl LineHits<'_, '_> {
    fn unit(&mut self, part: Option<&str>, text: &str) {
        self.unit += 1;
        if !self.ctx.ins.is_empty() && !self.ctx.ins.iter().any(|i| i.matches(self.kind, part)) {
            return;
        }
        let Some((start, end)) = self.ctx.pattern.find(text) else {
            return;
        };
        let (excerpt, match_start, match_end) = excerpt(text, start, end);
        let first = start - match_start;
        let (cut_left, cut_right) = (first > 0, first + excerpt.len() < text.len());
        self.out.push(Hit {
            root: self.sf.root,
            store: self.sf.store,
            path: self.path.to_path_buf(),
            line: self.line,
            kind: self.kind.map(str::to_string),
            part: part.map(str::to_string),
            meta: self.meta.clone(),
            excerpt,
            match_start,
            match_end,
            cut_left,
            cut_right,
            unparsed: self.unparsed,
            unit: self.unit,
            agreement: None,
            agreement_rule: None,
            last: None,
        });
    }
}

fn path_meta(sf: &StoreFile) -> MessageMeta {
    MessageMeta {
        session: sf.session.clone(),
        project: sf.project.clone(),
        sidechain: sf.subagent,
        ..MessageMeta::default()
    }
}

fn search_file(ctx: &Ctx<'_>, sf: &StoreFile, path: &Path) -> FileResult {
    let mut res = FileResult {
        searched: true,
        path: path.to_path_buf(),
        ..FileResult::default()
    };
    let read = match sf.format {
        FileFormat::Jsonl => {
            let pre = if ctx.parse_all {
                None
            } else {
                ctx.pattern.prefilter()
            };
            scan_lines(pre, path, |n, line| {
                jsonl_line(ctx, sf, path, n, line, &mut res);
            })
        }
        FileFormat::Json => json_document(ctx, sf, path, &mut res),
        FileFormat::Text => text_lines(ctx, sf, path, &mut res.hits),
    };
    if let Err(e) = read {
        res.searched = false;
        res.error = Some(format!("{}: {e}", path.display()));
    } else if ctx.headers && sf.transcript && !sf.subagent && !res.hits.is_empty() {
        res.info = session::read_session(path).ok();
    }
    res
}

fn text_lines(ctx: &Ctx<'_>, sf: &StoreFile, path: &Path, hits: &mut Vec<Hit>) -> io::Result<()> {
    let meta = path_meta(sf);
    scan_lines(ctx.pattern.text_matcher(), path, |n, line| {
        let text = String::from_utf8_lossy(trim_eol(line));
        LineHits {
            ctx,
            sf,
            path,
            line: Some(n),
            meta: &meta,
            kind: None,
            unparsed: false,
            unit: 0,
            out: hits,
        }
        .unit(sf.part, &text);
    })
}

fn jsonl_line(
    ctx: &Ctx<'_>,
    sf: &StoreFile,
    path: &Path,
    n: u64,
    raw: &[u8],
    res: &mut FileResult,
) {
    let raw = trim_eol(raw);
    if raw.iter().all(u8::is_ascii_whitespace) {
        return;
    }
    let Ok(v) = serde_json::from_slice::<Value>(raw) else {
        res.bad_lines += 1;
        // Still search the raw text, so a truncated line is not hidden (R3).
        let meta = path_meta(sf);
        let text = String::from_utf8_lossy(raw);
        LineHits {
            ctx,
            sf,
            path,
            line: Some(n),
            meta: &meta,
            kind: None,
            unparsed: true,
            unit: 0,
            out: &mut res.hits,
        }
        .unit(None, &text);
        return;
    };
    let mut meta = match sf.store {
        StoreKind::Transcripts if sf.transcript => decode::transcript_meta(&v),
        StoreKind::History => decode::history_meta(&v),
        _ => MessageMeta::default(),
    };
    if meta.session.is_none() {
        meta.session.clone_from(&sf.session);
    }
    meta.project.clone_from(&sf.project);
    meta.sidechain |= sf.subagent;
    if sf.store == StoreKind::Transcripts && meta.sidechain && !ctx.subagents {
        return;
    }
    let kind = match sf.store {
        StoreKind::Transcripts if sf.transcript => decode::line_type(&v),
        StoreKind::History => Some("history"),
        _ => None,
    };
    let mut lh = LineHits {
        ctx,
        sf,
        path,
        line: Some(n),
        meta: &meta,
        kind,
        unparsed: false,
        unit: 0,
        out: &mut res.hits,
    };
    match sf.store {
        StoreKind::Transcripts if sf.transcript => {
            decode::transcript_units(&v, &mut |p, s| lh.unit(p, s));
        }
        StoreKind::History => decode::history_units(&v, &mut |s| lh.unit(Some("text"), s)),
        _ => decode::for_each_string(&v, &mut |s| lh.unit(None, s)),
    }
}

fn json_document(
    ctx: &Ctx<'_>,
    sf: &StoreFile,
    path: &Path,
    res: &mut FileResult,
) -> io::Result<()> {
    if let (Some(pre), false) = (ctx.pattern.prefilter(), ctx.parse_all) {
        let mut any = AnyMatch(false);
        SearcherBuilder::new()
            .build()
            .search_path(pre, path, &mut any)?;
        if !any.0 {
            return Ok(());
        }
    }
    let bytes = std::fs::read(path)?;
    let Ok(v) = serde_json::from_slice::<Value>(&bytes) else {
        res.bad_lines += 1;
        // Not valid JSON after all: search it as text, so nothing is hidden.
        return text_lines(ctx, sf, path, &mut res.hits);
    };
    let mut meta = path_meta(sf);
    if meta.session.is_none() {
        meta.session = v
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    let mut lh = LineHits {
        ctx,
        sf,
        path,
        line: None,
        meta: &meta,
        kind: None,
        unparsed: false,
        unit: 0,
        out: &mut res.hits,
    };
    decode::for_each_string(&v, &mut |s| lh.unit(None, s));
    Ok(())
}

/// Drop hits that fail the selectors (see `select` for the rules).
fn apply_selectors(hits: &mut Vec<Hit>, filter: &Filter, roots: &[PathBuf]) {
    let sel = filter.selectors();
    // A transcript line is a message; any other hit (a saved tool output, a
    // workflow record, a journal line, an unparsed line) joins by session.
    let by_message = |h: &Hit| {
        sel.scope == Scope::Message && h.store == StoreKind::Transcripts && h.kind.is_some()
    };
    let msg = filter.has_message_selectors();
    let needed: HashSet<String> = if msg {
        hits.iter()
            .filter(|h| !by_message(h))
            .filter_map(|h| h.meta.session.clone())
            .collect()
    } else {
        HashSet::new()
    };
    let joined = if needed.is_empty() {
        HashSet::new()
    } else {
        sessions_with_matching_message(roots, &needed, filter)
    };
    hits.retain(|h| {
        filter.session_ok(h.meta.session.as_deref())
            && (!msg
                || if by_message(h) {
                    filter.message_ok(&h.meta)
                } else {
                    h.meta.session.as_ref().is_some_and(|s| joined.contains(s))
                })
    });
}

/// The sessions in `needed` that have at least one transcript message that
/// passes `filter`. Reads only the transcripts of those sessions.
fn sessions_with_matching_message(
    roots: &[PathBuf],
    needed: &HashSet<String>,
    filter: &Filter,
) -> HashSet<String> {
    let subagents = filter.selectors().subagents;
    let found = Mutex::new(HashSet::new());
    walk_files(
        roots,
        &[StoreKind::Transcripts],
        subagents,
        |sf, path| {
            let Some(sid) = sf.session.as_ref().filter(|s| needed.contains(*s)) else {
                return;
            };
            if !sf.transcript {
                return;
            }
            if found.lock().is_ok_and(|f| f.contains(sid)) {
                return;
            }
            let Ok(file) = std::fs::File::open(path) else {
                return;
            };
            for line in BufReader::new(file).split(b'\n') {
                let Ok(line) = line else { break };
                let Ok(v) = serde_json::from_slice::<Value>(trim_eol(&line)) else {
                    continue;
                };
                let mut meta = decode::transcript_meta(&v);
                meta.project.clone_from(&sf.project);
                meta.sidechain |= sf.subagent;
                if (meta.sidechain && !subagents) || !filter.message_ok(&meta) {
                    continue;
                }
                if let Ok(mut f) = found.lock() {
                    f.insert(sid.clone());
                    if let Some(s) = meta.session {
                        f.insert(s);
                    }
                }
                break;
            }
        },
        |_| (),
    );
    found.into_inner().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excerpt_keeps_offsets_and_flattens_newlines() {
        let text = format!("{}\nneedle\n{}", "a".repeat(100), "é".repeat(100));
        let start = text.find("needle").unwrap();
        let (ex, s, e) = excerpt(&text, start, start + 6);
        assert_eq!(&ex[s..e], "needle");
        assert!(!ex.contains('\n'));
        assert!(ex.len() <= 6 + 2 * EXCERPT_CONTEXT + 2);
    }

    #[test]
    fn searches_a_tiny_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("projects/-w/s1")).unwrap();
        std::fs::write(
            root.join("projects/-w/s1.jsonl"),
            concat!(
                r#"{"type":"user","sessionId":"s1","cwd":"/w","gitBranch":"a","message":{"content":"say \"hi\""}}"#,
                "\n{broken\n",
                r#"{"type":"user","sessionId":"s1","cwd":"/w","gitBranch":"b","message":{"content":"say \"hi\" again"}}"#,
                "\n"
            ),
        )
        .unwrap();
        std::fs::create_dir_all(root.join("todos")).unwrap();
        std::fs::write(
            root.join("todos/s1-agent-s1.json"),
            r#"[{"content":"say \"hi\""}]"#,
        )
        .unwrap();
        let query = Query {
            pattern: r#"say "hi""#.into(),
            ..Query::default()
        };
        let opts = SearchOptions {
            roots: vec![root.to_path_buf()],
            ..SearchOptions::default()
        };
        let out = search(&query, &opts).unwrap();
        assert_eq!(out.hits.len(), 3);
        assert_eq!(out.files_searched, 2);
        assert_eq!(out.bad_lines, 0, "the broken line fails the pre-filter");

        let all = search(
            &query,
            &SearchOptions {
                parse_all: true,
                ..opts.clone()
            },
        )
        .unwrap();
        assert_eq!(all.bad_lines, 1);

        let branch_a = SearchOptions {
            selectors: Selectors {
                branch: vec!["a".into()],
                ..Selectors::default()
            },
            ..opts
        };
        let out = search(&query, &branch_a).unwrap();
        let lines: Vec<_> = out.hits.iter().map(|h| (h.store, h.line)).collect();
        // The transcript hit on branch b is dropped; the todo joins by session.
        assert_eq!(
            lines,
            vec![(StoreKind::Transcripts, Some(1)), (StoreKind::Todos, None)]
        );
    }
}
