//! Agreement between `history.jsonl` and transcripts (R10).
//!
//! What the owner typed is recorded twice: as `user/text` lines in the
//! session's main transcript and as lines in each root's `history.jsonl`. A
//! history line and a `user/text` line *agree* when they have the same
//! session id and one of these rules, tried in order, says they match:
//!
//! 1. `exact`: `display` equals the text.
//! 2. `whitespace`: equal after collapsing whitespace runs and trimming.
//! 3. `paste-expanded`: `display` with each `[Pasted text #N …]` replaced by
//!    `pastedContents[N].content` equals the text (whitespace collapsed).
//! 4. `placeholder-wildcard`: each placeholder rule 3 could not expand (a
//!    paste stored only as a `contentHash`, an `[Image …]`) matches any text
//!    in its position. Only within [`WILDCARD_WINDOW_MS`] (120 s) of each
//!    other, because a wildcard can fit almost any text.
//! 5. `slash-command`: `display` (`/name args`) equals the transcript's
//!    `<command-name>` plus `<command-args>`.
//!
//! Pairing is one-to-one: the rules run as passes in that order, and in each
//! pass every unpaired history line (oldest first) takes the unpaired
//! `user/text` line nearest to it in time that the rule matches. So a pair is
//! always recorded with the first rule that matches it.
//!
//! A session's history lines are paired against the union of its main
//! transcripts' `user/text` lines in every searched root (backups hold copies
//! of the same lines), deduplicated by line `uuid` (or, for a line with no
//! `uuid`, by timestamp and text). So one history line has one agreement,
//! whichever root's copy of the transcript shows it.
//!
//! There is no skip list: text Claude Code inserted (`isMeta` notes, task
//! notifications, interrupts, command output, compaction summaries,
//! classifier notices) has no history line, so it comes out
//! `transcript-only`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use grep_regex::RegexMatcherBuilder;
use serde_json::Value;

use crate::order::Group;
use crate::search::{Hit, scan_lines};
use crate::session::{self, SessionInfo, UserText, trim_eol};
use crate::{StoreKind, parse_ts};

/// How a `user/text` or `history` record relates to the other source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Agreement {
    /// The pair agreed.
    Both,
    /// A `user/text` line with no agreeing history line, in a session that
    /// has history.
    TranscriptOnly,
    /// A history line with no agreeing `user/text` line, in a session whose
    /// transcript was found.
    HistoryOnly,
    /// A history line with no `sessionId`.
    Unlinked,
    /// The other source for the session is not in any searched root.
    Unknown,
}

impl Agreement {
    /// Every value, in the order INTENT.md lists them.
    pub const ALL: [Agreement; 5] = [
        Agreement::Both,
        Agreement::TranscriptOnly,
        Agreement::HistoryOnly,
        Agreement::Unlinked,
        Agreement::Unknown,
    ];

    /// The name used on the command line and in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Agreement::Both => "both",
            Agreement::TranscriptOnly => "transcript-only",
            Agreement::HistoryOnly => "history-only",
            Agreement::Unlinked => "unlinked",
            Agreement::Unknown => "unknown",
        }
    }
}

/// The rule that made a pair agree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Rule {
    /// 1. `display` equals the text.
    Exact,
    /// 2. Equal after collapsing whitespace.
    Whitespace,
    /// 3. Equal after expanding `[Pasted text #N …]` placeholders.
    PasteExpanded,
    /// 4. Unexpandable placeholders match any text.
    PlaceholderWildcard,
    /// 5. `/name args` equals `<command-name>` plus `<command-args>`.
    SlashCommand,
}

impl Rule {
    /// Every rule, in the order they are tried.
    pub const ALL: [Rule; 5] = [
        Rule::Exact,
        Rule::Whitespace,
        Rule::PasteExpanded,
        Rule::PlaceholderWildcard,
        Rule::SlashCommand,
    ];

    /// The name used in records.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Rule::Exact => "exact",
            Rule::Whitespace => "whitespace",
            Rule::PasteExpanded => "paste-expanded",
            Rule::PlaceholderWildcard => "placeholder-wildcard",
            Rule::SlashCommand => "slash-command",
        }
    }
}

/// One distinct `history.jsonl` line of a session. The same line in several
/// roots (backups) is one entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    /// `timestamp`, unix ms.
    pub ts: Option<i64>,
    /// `display`.
    pub display: String,
    /// `pastedContents`: `N` to its `content` (`None` for a `contentHash`).
    pub pastes: HashMap<u64, Option<String>>,
    /// Where the line was read: (root index, 1-based line).
    pub at: Vec<(usize, u64)>,
}

/// The history lines of the sessions asked for, from every root's
/// `history.jsonl`, each file read once.
#[derive(Debug, Default)]
pub struct HistoryIndex {
    sessions: HashMap<String, Vec<HistoryEntry>>,
    at: HashMap<(usize, u64), (String, usize)>,
}

impl HistoryIndex {
    /// Read `history.jsonl` in each root. With `only`, keep the lines of
    /// those sessions (a raw-byte pre-filter on the ids skips the rest).
    #[must_use]
    pub fn load(roots: &[PathBuf], only: Option<&HashSet<String>>) -> HistoryIndex {
        let mut index = HistoryIndex::default();
        if only.is_some_and(HashSet::is_empty) {
            return index;
        }
        let matcher = only.and_then(|ids| {
            let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
            RegexMatcherBuilder::new()
                .fixed_strings(true)
                .line_terminator(Some(b'\n'))
                .build_literals(&ids)
                .ok()
        });
        let mut seen: HashMap<(String, Option<i64>, String), usize> = HashMap::new();
        for (ri, root) in roots.iter().enumerate() {
            let path = root.join(StoreKind::History.entry());
            if !path.is_file() {
                continue;
            }
            let _ = scan_lines(matcher.as_ref(), &path, |n, raw| {
                let Ok(v) = serde_json::from_slice::<Value>(trim_eol(raw)) else {
                    return;
                };
                let Some(sid) = v.get("sessionId").and_then(Value::as_str) else {
                    return;
                };
                if only.is_some_and(|ids| !ids.contains(sid)) {
                    return;
                }
                let entry = parse_entry(&v);
                let key = (sid.to_string(), entry.ts, entry.display.clone());
                let list = index.sessions.entry(sid.to_string()).or_default();
                if let Some(&i) = seen.get(&key) {
                    list[i].at.push((ri, n));
                } else {
                    seen.insert(key, list.len());
                    list.push(HistoryEntry {
                        at: vec![(ri, n)],
                        ..entry
                    });
                }
            });
        }
        for (sid, list) in &mut index.sessions {
            list.sort_by_key(|e| (e.ts.is_none(), e.ts));
            for (i, e) in list.iter().enumerate() {
                for &at in &e.at {
                    index.at.insert(at, (sid.clone(), i));
                }
            }
        }
        index
    }

    /// Whether any searched root has history for `session`.
    #[must_use]
    pub fn has(&self, session: &str) -> bool {
        self.sessions.contains_key(session)
    }

    /// The session's history lines, oldest first.
    #[must_use]
    pub fn entries(&self, session: &str) -> &[HistoryEntry] {
        self.sessions.get(session).map_or(&[], Vec::as_slice)
    }

    /// The session and entry index of the history line at `line` in root
    /// number `root`.
    #[must_use]
    pub fn locate(&self, root: usize, line: u64) -> Option<(&str, usize)> {
        self.at.get(&(root, line)).map(|(s, i)| (s.as_str(), *i))
    }
}

fn parse_entry(v: &Value) -> HistoryEntry {
    let ts = v
        .get("timestamp")
        .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(parse_ts)));
    let display = v
        .get("display")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut pastes = HashMap::new();
    if let Some(map) = v.get("pastedContents").and_then(Value::as_object) {
        for (k, p) in map {
            if let Ok(n) = k.parse::<u64>() {
                let content = p.get("content").and_then(Value::as_str).map(str::to_string);
                pastes.insert(n, content);
            }
        }
    }
    HistoryEntry {
        ts,
        display,
        pastes,
        at: Vec::new(),
    }
}

/// Runs of whitespace become one space; the ends are trimmed.
#[must_use]
pub fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for w in s.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(w);
    }
    out
}

/// A piece of a `display`.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Tok<'a> {
    Lit(&'a str),
    /// `[Pasted text #N]` or `[Pasted text #N +M lines]`.
    Paste(u64),
    /// `[Image #N]`, `[Image]`, or `[Image is no longer available]`.
    Image,
}

/// The digits at the start of `s`, parsed, and the rest.
fn digits(s: &str) -> Option<(u64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    Some((s[..end].parse().ok()?, &s[end..]))
}

/// The placeholder at the start of `s`, and its length in bytes.
fn placeholder(s: &str) -> Option<(Tok<'static>, usize)> {
    for fixed in ["[Image]", "[Image is no longer available]"] {
        if s.starts_with(fixed) {
            return Some((Tok::Image, fixed.len()));
        }
    }
    if let Some(rest) = s.strip_prefix("[Image #") {
        let (_, rest) = digits(rest)?;
        rest.starts_with(']')
            .then(|| (Tok::Image, s.len() - rest.len() + 1))
    } else if let Some(rest) = s.strip_prefix("[Pasted text #") {
        let (n, mut rest) = digits(rest)?;
        if let Some(r) = rest.strip_prefix(" +") {
            let (_, r) = digits(r)?;
            rest = r
                .strip_prefix(" lines")
                .or_else(|| r.strip_prefix(" line"))?;
        }
        rest.starts_with(']')
            .then(|| (Tok::Paste(n), s.len() - rest.len() + 1))
    } else {
        None
    }
}

fn tokens(display: &str) -> Vec<Tok<'_>> {
    let mut out = Vec::new();
    let mut lit = 0;
    let mut i = 0;
    while let Some(off) = display[i..].find('[') {
        let at = i + off;
        if let Some((tok, len)) = placeholder(&display[at..]) {
            if lit < at {
                out.push(Tok::Lit(&display[lit..at]));
            }
            out.push(tok);
            i = at + len;
            lit = i;
        } else {
            i = at + 1;
        }
    }
    if lit < display.len() {
        out.push(Tok::Lit(&display[lit..]));
    }
    out
}

/// A history line, prepared for the rules.
struct Prepared<'a> {
    display: &'a str,
    collapsed: String,
    /// Rule 3: the display with every paste expanded (collapsed), when it
    /// has pastes and every placeholder could be expanded.
    expanded: Option<String>,
    /// Rule 4: the literal segments between unexpandable placeholders.
    wild: Option<Vec<String>>,
    slash: bool,
}

impl<'a> Prepared<'a> {
    fn new(e: &'a HistoryEntry) -> Prepared<'a> {
        let toks = tokens(&e.display);
        let content = |n: &u64| e.pastes.get(n).and_then(Option::as_deref);
        let has_paste = toks.iter().any(|t| matches!(t, Tok::Paste(_)));
        let wildcards = toks.iter().any(|t| match t {
            Tok::Paste(n) => content(n).is_none(),
            Tok::Image => true,
            Tok::Lit(_) => false,
        });
        // Literal text, with every expandable paste expanded, split at the
        // placeholders that cannot be expanded.
        let mut segs = vec![String::new()];
        for t in &toks {
            let piece = match t {
                Tok::Lit(s) => Some(*s),
                Tok::Paste(n) => content(n),
                Tok::Image => None,
            };
            match (piece, segs.last_mut()) {
                (Some(p), Some(last)) => last.push_str(p),
                _ => segs.push(String::new()),
            }
        }
        let collapsed = collapse(&e.display);
        Prepared {
            display: &e.display,
            slash: collapsed.starts_with('/'),
            collapsed,
            expanded: (has_paste && !wildcards).then(|| collapse(&segs.concat())),
            wild: wildcards.then(|| segs.iter().map(|s| collapse(s)).collect()),
        }
    }
}

/// Whether `text` fits the literal segments, with any text between them.
fn wild_match(segs: &[String], text: &str) -> bool {
    let (Some(first), Some(last)) = (segs.first(), segs.last()) else {
        return false;
    };
    if !text.starts_with(first.as_str()) {
        return false;
    }
    let mut pos = first.len();
    for s in &segs[1..segs.len() - 1] {
        match text[pos..].find(s.as_str()) {
            Some(i) => pos += i + s.len(),
            None => return false,
        }
    }
    text.len() >= pos + last.len() && text.ends_with(last.as_str())
}

/// The text between `open` and `close`, trimmed.
fn tag<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let end = start + text[start..].find(close)?;
    Some(text[start..end].trim())
}

/// A `user/text` line, prepared for the rules.
struct Typed<'a> {
    text: &'a str,
    collapsed: String,
    /// Rule 5: `<command-name>` plus `<command-args>`, collapsed.
    command: Option<String>,
}

impl<'a> Typed<'a> {
    fn new(t: &'a UserText) -> Typed<'a> {
        let command = tag(&t.text, "<command-name>", "</command-name>").map(|name| {
            let name = if name.starts_with('/') {
                name.to_string()
            } else {
                format!("/{name}")
            };
            match tag(&t.text, "<command-args>", "</command-args>").filter(|a| !a.is_empty()) {
                Some(args) => collapse(&format!("{name} {args}")),
                None => collapse(&name),
            }
        });
        Typed {
            text: &t.text,
            collapsed: collapse(&t.text),
            command,
        }
    }
}

/// Rule 4: the literal segments fit the text.
fn wild_matches(h: &Prepared<'_>, t: &Typed<'_>) -> bool {
    h.wild.as_ref().is_some_and(|w| wild_match(w, &t.collapsed))
}

/// Rule 4 pairs a history line and a `user/text` line only when their
/// timestamps are at most this far apart (ms). A line with no timestamp
/// never pairs by rule 4.
pub const WILDCARD_WINDOW_MS: u64 = 120_000;

/// The key a rule compares on each side, for the rules that test equality
/// (all but rule 4). `None` when the rule cannot apply to that line.
fn history_key<'p>(rule: Rule, h: &'p Prepared<'_>) -> Option<&'p str> {
    match rule {
        Rule::Exact => Some(h.display),
        Rule::Whitespace => Some(&h.collapsed),
        Rule::PasteExpanded => h.expanded.as_deref(),
        Rule::SlashCommand => h.slash.then_some(h.collapsed.as_str()),
        Rule::PlaceholderWildcard => None,
    }
}

fn text_key<'p>(rule: Rule, t: &'p Typed<'_>) -> Option<&'p str> {
    match rule {
        Rule::Exact => Some(t.text),
        Rule::Whitespace | Rule::PasteExpanded => Some(&t.collapsed),
        Rule::SlashCommand => t.command.as_deref(),
        Rule::PlaceholderWildcard => None,
    }
}

/// The agreeing pairs of one session: for each history entry and each
/// `user/text` line, the other side and rule of its pair, if it has one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Pairing {
    /// Parallel to the history entries.
    pub history: Vec<Option<(usize, Rule)>>,
    /// Parallel to the `user/text` lines.
    pub texts: Vec<Option<(usize, Rule)>>,
}

/// Pair `entries` (oldest first) with `texts` (in file order), one to one.
#[must_use]
pub fn pair(entries: &[HistoryEntry], texts: &[UserText]) -> Pairing {
    let hs: Vec<Prepared<'_>> = entries.iter().map(Prepared::new).collect();
    let ts: Vec<Typed<'_>> = texts.iter().map(Typed::new).collect();
    let mut out = Pairing {
        history: vec![None; hs.len()],
        texts: vec![None; ts.len()],
    };
    let distance = |hi: usize, ti: usize| match (entries[hi].ts, texts[ti].ts) {
        (Some(a), Some(b)) => a.abs_diff(b),
        _ => u64::MAX,
    };
    for rule in Rule::ALL {
        let applies = |hi: usize| {
            out.history[hi].is_none()
                && match rule {
                    Rule::PlaceholderWildcard => hs[hi].wild.is_some(),
                    _ => history_key(rule, &hs[hi]).is_some(),
                }
        };
        if !(0..hs.len()).any(applies) {
            continue;
        }
        // The equality rules look candidates up by key; rule 4 scans.
        let mut by_key: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        if rule != Rule::PlaceholderWildcard {
            for (ti, t) in ts.iter().enumerate() {
                if let (None, Some(k)) = (out.texts[ti], text_key(rule, t)) {
                    by_key.entry(k).or_default().push(ti);
                }
            }
        }
        for (hi, h) in hs.iter().enumerate() {
            if out.history[hi].is_some() {
                continue;
            }
            let free = |ti: &usize| out.texts[*ti].is_none();
            let best = if rule == Rule::PlaceholderWildcard {
                (0..ts.len())
                    .filter(|&ti| distance(hi, ti) <= WILDCARD_WINDOW_MS)
                    .filter(|ti| free(ti) && wild_matches(h, &ts[*ti]))
                    .min_by_key(|&ti| (distance(hi, ti), ti))
            } else {
                history_key(rule, h)
                    .and_then(|k| by_key.get(k))
                    .and_then(|c| {
                        c.iter()
                            .copied()
                            .filter(free)
                            .min_by_key(|&ti| (distance(hi, ti), ti))
                    })
            };
            if let Some(ti) = best {
                out.history[hi] = Some((ti, rule));
                out.texts[ti] = Some((hi, rule));
            }
        }
    }
    out
}

/// The agreement of one `user/text` line of a main transcript.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextMark {
    /// 1-based line in the transcript.
    pub line: u64,
    /// Its agreement.
    pub agreement: Agreement,
    /// The rule, when `agreement` is `both`.
    pub rule: Option<Rule>,
    /// It is the session's last `user/text` line.
    pub last: bool,
}

/// What the `last:` line shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LastStatus {
    /// The last `user/text` whose agreement is `both`.
    Agreed,
    /// The session has no history: the last `user/text`, unchecked.
    Unverified,
    /// The session has history but no `user/text` agreed: the last one.
    NotInHistory,
}

/// The `last:` line of a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastText {
    /// The text.
    pub text: String,
    /// How it was chosen.
    pub status: LastStatus,
    /// A later `user/text` that is `transcript-only`, shown under `last:`
    /// marked `(not in history)`.
    pub later: Option<String>,
}

/// One session's agreement: its main transcript's `user/text` lines and its
/// history lines.
#[derive(Debug, Clone, Default)]
pub struct SessionAgreement {
    /// The main transcript the marks are for.
    pub transcript: Option<PathBuf>,
    /// One per `user/text` line, in file order.
    pub marks: Vec<TextMark>,
    /// One per history entry ([`HistoryIndex::entries`] order).
    pub history: Vec<(Agreement, Option<Rule>)>,
    /// The `last:` line.
    pub last: Option<LastText>,
    /// Whether the session has history in any searched root.
    pub has_history: bool,
}

impl SessionAgreement {
    /// The mark of the `user/text` line at `line` of `path`, when `path` is
    /// the main transcript.
    #[must_use]
    pub fn mark(&self, path: &Path, line: u64) -> Option<&TextMark> {
        if self.transcript.as_deref() != Some(path) {
            return None;
        }
        self.marks
            .binary_search_by_key(&line, |m| m.line)
            .ok()
            .map(|i| &self.marks[i])
    }

    /// The agreement of a `user/text` line outside the main transcript (a
    /// subagent's): it takes part in no pair.
    #[must_use]
    pub fn unpaired_text(&self) -> Agreement {
        if self.has_history {
            Agreement::TranscriptOnly
        } else {
            Agreement::Unknown
        }
    }

    /// `user/text` lines that are `transcript-only`.
    #[must_use]
    pub fn transcript_only(&self) -> u64 {
        self.marks
            .iter()
            .filter(|m| m.agreement == Agreement::TranscriptOnly)
            .count() as u64
    }

    /// History lines that are `history-only`.
    #[must_use]
    pub fn history_only(&self) -> u64 {
        self.history
            .iter()
            .filter(|h| h.0 == Agreement::HistoryOnly)
            .count() as u64
    }
}

/// The agreement of session `session`, given its main transcript (path and
/// `user/text` lines) when one was found in a searched root.
#[must_use]
pub fn session_agreement(
    index: &HistoryIndex,
    session: &str,
    transcript: Option<(&Path, &[UserText])>,
) -> SessionAgreement {
    let sources: Vec<(&Path, &[UserText])> = transcript.into_iter().collect();
    let (shared, mut each) = session_agreements(index, session, &sources);
    each.pop().unwrap_or(shared)
}

/// A key for one `user/text` line that is the same for its copies in other
/// roots: its `uuid`, or its timestamp and text when it has none.
#[derive(Hash, PartialEq, Eq)]
enum LineKey<'a> {
    Uuid(&'a str),
    Content(Option<i64>, &'a str),
}

fn line_key(t: &UserText) -> LineKey<'_> {
    match &t.uuid {
        Some(u) => LineKey::Uuid(u),
        None => LineKey::Content(t.ts, &t.text),
    }
}

/// The agreement of session `session` across roots. `sources` holds its main
/// transcript (path and `user/text` lines) in each searched root that has
/// one, in root order. The history lines are paired once, against the union
/// of the sources' lines deduplicated by [`LineKey`].
///
/// Returns the session-wide agreement with no marks (for a block with no
/// main transcript of its own), and one [`SessionAgreement`] per source with
/// that source's marks. All share the same history outcomes and `last:`.
#[must_use]
pub fn session_agreements(
    index: &HistoryIndex,
    session: &str,
    sources: &[(&Path, &[UserText])],
) -> (SessionAgreement, Vec<SessionAgreement>) {
    let entries = index.entries(session);
    let has_history = !entries.is_empty();
    if sources.is_empty() {
        let shared = SessionAgreement {
            history: vec![(Agreement::Unknown, None); entries.len()],
            has_history,
            ..SessionAgreement::default()
        };
        return (shared, Vec::new());
    }
    // The union, and where each source's lines are in it.
    let mut union: Vec<&UserText> = Vec::new();
    let mut at: HashMap<LineKey<'_>, usize> = HashMap::new();
    let mut places: Vec<Vec<usize>> = Vec::with_capacity(sources.len());
    for (_, texts) in sources {
        places.push(
            texts
                .iter()
                .map(|t| {
                    *at.entry(line_key(t)).or_insert_with(|| {
                        union.push(t);
                        union.len() - 1
                    })
                })
                .collect(),
        );
    }
    // With more than one source, the union is in time order (a stable sort,
    // so one source keeps its file order).
    let mut order: Vec<usize> = (0..union.len()).collect();
    if sources.len() > 1 {
        order.sort_by_key(|&i| union[i].ts);
    }
    let mut rank = vec![0; union.len()];
    for (r, &i) in order.iter().enumerate() {
        rank[i] = r;
    }
    let texts: Vec<UserText> = order.iter().map(|&i| union[i].clone()).collect();
    let pairing = pair(entries, &texts);
    let agreement = |p: Option<(usize, Rule)>| match (p, has_history) {
        (Some(_), _) => Agreement::Both,
        (None, true) => Agreement::TranscriptOnly,
        (None, false) => Agreement::Unknown,
    };
    let union_marks: Vec<TextMark> = texts
        .iter()
        .zip(&pairing.texts)
        .enumerate()
        .map(|(i, (t, p))| TextMark {
            line: t.line,
            agreement: agreement(*p),
            rule: p.map(|(_, r)| r),
            last: i + 1 == texts.len(),
        })
        .collect();
    let history: Vec<(Agreement, Option<Rule>)> = pairing
        .history
        .iter()
        .map(|p| match p {
            Some((_, r)) => (Agreement::Both, Some(*r)),
            None => (Agreement::HistoryOnly, None),
        })
        .collect();
    let last = last_text(&texts, &union_marks, has_history);
    let each = sources
        .iter()
        .zip(&places)
        .map(|((path, own), place)| SessionAgreement {
            transcript: Some(path.to_path_buf()),
            marks: own
                .iter()
                .zip(place)
                .map(|(t, &u)| TextMark {
                    line: t.line,
                    ..union_marks[rank[u]]
                })
                .collect(),
            history: history.clone(),
            last: last.clone(),
            has_history,
        })
        .collect();
    let shared = SessionAgreement {
        history,
        last,
        has_history,
        ..SessionAgreement::default()
    };
    (shared, each)
}

/// The `last:` line: the last `user/text` that agreed, and a later one that
/// is not in history; or the last one, unverified, when there is no history.
fn last_text(texts: &[UserText], marks: &[TextMark], has_history: bool) -> Option<LastText> {
    let newest = texts.last()?;
    if !has_history {
        return Some(LastText {
            text: newest.text.clone(),
            status: LastStatus::Unverified,
            later: None,
        });
    }
    match marks.iter().rposition(|m| m.agreement == Agreement::Both) {
        Some(i) => Some(LastText {
            text: texts[i].text.clone(),
            status: LastStatus::Agreed,
            later: (i + 1 < texts.len()).then(|| newest.text.clone()),
        }),
        None => Some(LastText {
            text: newest.text.clone(),
            status: LastStatus::NotInHistory,
            later: None,
        }),
    }
}

/// Whether a hit is a `user/text` unit of a transcript line.
fn is_user_text(h: &Hit) -> bool {
    h.store == StoreKind::Transcripts
        && h.kind.as_deref() == Some("user")
        && h.part.as_deref() == Some("text")
}

/// Whether a hit is a parsed `history.jsonl` line.
fn is_history(h: &Hit) -> bool {
    h.store == StoreKind::History && h.kind.as_deref() == Some("history")
}

/// Set `agreement`, `agreement_rule`, and `last` on every `user/text` and
/// `history` hit, and each session group's [`SessionAgreement`]. `index`
/// holds the history of the groups' sessions. Each session's agreement is
/// computed once, from its main transcript in every root (see
/// [`session_agreements`]): a group's own header when it has one, else the
/// root's transcript read here.
pub fn annotate(groups: &mut [Group], roots: &[PathBuf], index: &HistoryIndex) {
    // Per session: the agreement of each root's transcript.
    let mut by_session: HashMap<String, (SessionAgreement, HashMap<usize, SessionAgreement>)> =
        HashMap::new();
    for sid in groups.iter().filter_map(|g| g.session.as_deref()) {
        if by_session.contains_key(sid) {
            continue;
        }
        let own: HashMap<usize, &SessionInfo> = groups
            .iter()
            .filter(|g| g.session.as_deref() == Some(sid))
            .filter_map(|g| g.info.as_ref().map(|i| (g.root, i)))
            .collect();
        let read: Vec<(usize, SessionInfo)> = (0..roots.len())
            .filter(|ri| !own.contains_key(ri))
            .filter_map(|ri| {
                let p = session::find_transcript(&roots[ri], sid)?;
                Some((ri, session::read_session(&p).ok()?))
            })
            .collect();
        let mut infos: Vec<(usize, &SessionInfo)> = own.into_iter().collect();
        infos.extend(read.iter().map(|(ri, i)| (*ri, i)));
        infos.sort_by_key(|(ri, _)| *ri);
        let sources: Vec<(&Path, &[UserText])> = infos
            .iter()
            .map(|(_, i)| (i.transcript.as_path(), i.user_texts.as_slice()))
            .collect();
        let (shared, each) = session_agreements(index, sid, &sources);
        let per_root = infos.iter().map(|(ri, _)| *ri).zip(each).collect();
        by_session.insert(sid.to_string(), (shared, per_root));
    }
    for g in groups.iter_mut() {
        let Some(sid) = g.session.clone() else {
            for h in g.hits.iter_mut().filter(|h| is_history(h)) {
                h.agreement = Some(Agreement::Unlinked);
            }
            continue;
        };
        let Some((shared, per_root)) = by_session.get(&sid) else {
            continue;
        };
        let sa = per_root.get(&g.root).unwrap_or(shared).clone();
        for h in &mut g.hits {
            if h.unparsed {
                continue;
            }
            if is_user_text(h) {
                let mark = h.line.and_then(|l| sa.mark(&h.path, l));
                h.agreement = Some(mark.map_or_else(|| sa.unpaired_text(), |m| m.agreement));
                h.agreement_rule = mark.and_then(|m| m.rule);
                h.last = Some(mark.is_some_and(|m| m.last));
            } else if is_history(h) {
                let at = h.line.and_then(|l| index.locate(h.root, l));
                let (a, r) = at
                    .filter(|(s, _)| *s == sid)
                    .and_then(|(_, i)| sa.history.get(i).copied())
                    .unwrap_or((Agreement::Unknown, None));
                h.agreement = Some(a);
                h.agreement_rule = r;
            }
        }
        g.agreement = Some(sa);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(ts: i64, display: &str, pastes: &[(u64, Option<&str>)]) -> HistoryEntry {
        HistoryEntry {
            ts: Some(ts),
            display: display.into(),
            pastes: pastes
                .iter()
                .map(|(n, c)| (*n, c.map(str::to_string)))
                .collect(),
            at: Vec::new(),
        }
    }

    fn text(line: u64, ts: i64, t: &str) -> UserText {
        UserText {
            line,
            ts: Some(ts),
            uuid: None,
            text: t.into(),
        }
    }

    fn rules(entries: &[HistoryEntry], texts: &[UserText]) -> Vec<Option<&'static str>> {
        pair(entries, texts)
            .texts
            .iter()
            .map(|p| p.map(|(_, r)| r.as_str()))
            .collect()
    }

    #[test]
    fn placeholders_are_parsed() {
        assert_eq!(
            tokens("a [Pasted text #2 +12 lines] b [Image #1][Image][x]"),
            vec![
                Tok::Lit("a "),
                Tok::Paste(2),
                Tok::Lit(" b "),
                Tok::Image,
                Tok::Image,
                Tok::Lit("[x]")
            ]
        );
        assert_eq!(tokens("[Pasted text #3]"), vec![Tok::Paste(3)]);
        assert_eq!(
            tokens("[Image is no longer available] ok"),
            vec![Tok::Image, Tok::Lit(" ok")]
        );
        assert_eq!(tokens("[Pasted text #]"), vec![Tok::Lit("[Pasted text #]")]);
    }

    #[test]
    fn each_rule_matches_its_case() {
        let entries = [
            entry(1, "exact text", &[]),
            entry(2, "spaced   text\n", &[]),
            entry(3, "see [Pasted text #1 +2 lines] now", &[(1, Some("a\nb"))]),
            entry(4, "look [Image #1] and [Pasted text #2]", &[(2, None)]),
            entry(5, "/model opus", &[]),
        ];
        let texts = [
            text(1, 1, "exact text"),
            text(2, 2, "spaced text"),
            text(3, 3, "see a\nb now"),
            text(4, 4, "look here and some pasted words"),
            text(
                5,
                5,
                "<command-message>model</command-message>\n<command-name>/model</command-name>\n<command-args>opus</command-args>",
            ),
            text(6, 6, "<task-notification>done</task-notification>"),
        ];
        assert_eq!(
            rules(&entries, &texts),
            vec![
                Some("exact"),
                Some("whitespace"),
                Some("paste-expanded"),
                Some("placeholder-wildcard"),
                Some("slash-command"),
                None
            ]
        );
    }

    #[test]
    fn pairing_is_one_to_one_and_nearest_in_time() {
        let entries = [entry(100, "yes", &[]), entry(500, "yes", &[])];
        let texts = [text(1, 90, "yes"), text(2, 300, "no"), text(3, 510, "yes")];
        let p = pair(&entries, &texts);
        assert_eq!(
            p.history,
            vec![Some((0, Rule::Exact)), Some((2, Rule::Exact))]
        );
        // A stronger rule wins over a nearer weak one.
        let entries = [entry(100, "[Image #1]", &[]), entry(200, "real", &[])];
        let texts = [text(1, 101, "real"), text(2, 300, "inserted")];
        let p = pair(&entries, &texts);
        assert_eq!(p.history[1], Some((0, Rule::Exact)));
        assert_eq!(p.history[0], Some((1, Rule::PlaceholderWildcard)));
    }

    #[test]
    fn last_prefers_agreed_text() {
        let index = HistoryIndex {
            sessions: HashMap::from([("s".to_string(), vec![entry(1, "typed", &[])])]),
            at: HashMap::new(),
        };
        let texts = [text(1, 1, "typed"), text(2, 2, "inserted")];
        let sa = session_agreement(&index, "s", Some((Path::new("/t"), &texts)));
        let last = sa.last.clone().unwrap();
        assert_eq!(
            (last.text.as_str(), last.status, last.later.as_deref()),
            ("typed", LastStatus::Agreed, Some("inserted"))
        );
        assert_eq!(sa.transcript_only(), 1);
        assert!(sa.marks[1].last && !sa.marks[0].last);
        let none = session_agreement(&index, "t", Some((Path::new("/t"), &texts)));
        assert_eq!(none.last.unwrap().status, LastStatus::Unverified);
        assert_eq!(none.marks[0].agreement, Agreement::Unknown);
        let gone = session_agreement(&index, "s", None);
        assert_eq!(gone.history, vec![(Agreement::Unknown, None)]);
    }
}
