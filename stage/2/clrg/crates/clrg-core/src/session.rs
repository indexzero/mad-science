//! Session header data and context messages, read from a matched session's
//! transcript after the search.
//!
//! The search reads only the lines that pass the pre-filter. For each session
//! with hits, clrg reads that session's transcript once more for its header:
//! the last timestamp, the folder the session was launched from (see
//! [`LaunchCwd`]), the branches, and its `user/text` lines, which
//! [`crate::agree`] checks against `history.jsonl` to pick the `last:` line
//! (R2, R10). The same pass collects them all.

use std::borrow::Cow;
use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::decode::{self, MessageMeta};
use crate::{parse_ts, rawjson};

/// What a session's header shows.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionInfo {
    /// The main transcript the fields were read from.
    pub transcript: PathBuf,
    /// The latest message time, unix ms.
    pub last_ts: Option<i64>,
    /// The folder the session was launched from (see [`LaunchCwd`]).
    pub cwd: Option<String>,
    /// Every `gitBranch`, in order of first appearance.
    pub branches: Vec<String>,
    /// Every `user/text` line, in file order (see [`decode::user_text`]).
    pub user_texts: Vec<UserText>,
    /// `user` and `assistant` lines.
    pub messages: u64,
}

/// A `user/text` line of a transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserText {
    /// 1-based line in the transcript.
    pub line: u64,
    /// `timestamp`, unix ms.
    pub ts: Option<i64>,
    /// The line's `uuid`: the same line in several roots (backups) is one
    /// line to [`crate::agree`].
    pub uuid: Option<String>,
    /// The text, as [`decode::user_text`] reads it.
    pub text: String,
}

/// Claude Code's `projects/<dir>` name for a folder: every `/` and `.`
/// becomes `-`.
#[must_use]
pub fn encode_project(cwd: &str) -> String {
    cwd.replace(['/', '.'], "-")
}

/// Picks the folder a session was launched from, which is the folder
/// `claude --resume` must run in: the `projects/<dir>` it is filed under
/// encodes that folder. The `cwd` of later lines can drift (a `cd` in a
/// shell tool), so the pick is the first non-empty `cwd` whose encoding
/// equals the project name, else the first non-empty `cwd`.
#[derive(Debug, Clone, Default)]
pub struct LaunchCwd {
    first: Option<String>,
    matching: Option<String>,
}

impl LaunchCwd {
    /// See one line's `cwd`, in file order. `project` is the encoded
    /// `projects/<dir>` name of the transcript, when known.
    pub fn see(&mut self, cwd: &str, project: Option<&str>) {
        if cwd.is_empty() {
            return;
        }
        if self.first.is_none() {
            self.first = Some(cwd.to_string());
        }
        if self.matching.is_none() && project.is_some_and(|p| encode_project(cwd) == p) {
            self.matching = Some(cwd.to_string());
        }
    }

    /// Fold in the picks of a later run of lines.
    pub fn merge(&mut self, later: &LaunchCwd) {
        if self.first.is_none() {
            self.first.clone_from(&later.first);
        }
        if self.matching.is_none() {
            self.matching.clone_from(&later.matching);
        }
    }

    /// The launch folder.
    #[must_use]
    pub fn get(&self) -> Option<&str> {
        self.matching.as_deref().or(self.first.as_deref())
    }
}

/// A UTF-8 byte order mark, which some editors put before the first line.
const BOM: &[u8] = b"\xEF\xBB\xBF";

/// The main transcript of `session` in `root`: `projects/<dir>/<session>.jsonl`.
#[must_use]
pub fn find_transcript(root: &Path, session: &str) -> Option<PathBuf> {
    let name = format!("{session}.jsonl");
    std::fs::read_dir(root.join("projects"))
        .ok()?
        .filter_map(Result::ok)
        .map(|d| d.path().join(&name))
        .find(|p| p.is_file())
}

/// Whether `cwd` exists: a plain `stat`, nothing else.
#[must_use]
pub fn cwd_exists(cwd: &str) -> bool {
    std::fs::metadata(cwd).is_ok()
}

/// `line` without its line terminator (`\n` or `\r\n`) or a leading BOM.
pub(crate) fn trim_eol(line: &[u8]) -> &[u8] {
    let line = line.strip_prefix(BOM).unwrap_or(line);
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    line.strip_suffix(b"\r").unwrap_or(line)
}

/// Bytes of transcript per parallel chunk when reading a header. A smaller
/// transcript is read on one thread.
const CHUNK: usize = 4 << 20;

/// The header fields of one run of whole lines.
#[derive(Default)]
struct Partial {
    last_ts: Option<i64>,
    cwd: LaunchCwd,
    branches: Vec<String>,
    messages: u64,
    /// `user/text` lines, numbered within the run.
    user_texts: Vec<UserText>,
    /// Line terminators in the run.
    lines: u64,
}

/// The top-level fields of one transcript line that a header needs, as raw
/// JSON values (see [`rawjson`]).
#[derive(Default)]
struct RawLine<'a> {
    kind: Option<&'a [u8]>,
    timestamp: Option<&'a [u8]>,
    cwd: Option<&'a [u8]>,
    branch: Option<&'a [u8]>,
    uuid: Option<&'a [u8]>,
    message: Option<&'a [u8]>,
}

impl<'a> RawLine<'a> {
    /// The fields of `raw`, or `None` when it is not a JSON object.
    fn read(raw: &'a [u8]) -> Option<RawLine<'a>> {
        let mut l = RawLine::default();
        rawjson::members(raw, |k, v| match k {
            b"type" => l.kind = Some(v),
            b"timestamp" => l.timestamp = Some(v),
            b"cwd" => l.cwd = Some(v),
            b"gitBranch" => l.branch = Some(v),
            b"uuid" => l.uuid = Some(v),
            b"message" => l.message = Some(v),
            _ => {}
        })?;
        Some(l)
    }
}

/// The lines of `bytes` split at `\n` (found with `memchr`), like
/// `bytes.split(|&b| b == b'\n')`.
fn lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(bytes);
    std::iter::from_fn(move || {
        let r = rest?;
        if let Some(n) = memchr::memchr(b'\n', r) {
            rest = Some(&r[n + 1..]);
            Some(&r[..n])
        } else {
            rest = None;
            Some(r)
        }
    })
}

/// The decoded string of a raw field, if it is one.
fn s(v: Option<&[u8]>) -> Option<Cow<'_, str>> {
    v.and_then(rawjson::string)
}

/// The header fields of one run of lines. Every line's top-level fields are
/// read from raw bytes; only a `user` line's `message` is decoded, for its
/// `user/text` (R10). Everything else in a line is skipped unread.
fn scan_header(bytes: &[u8], project: Option<&str>) -> Partial {
    let mut p = Partial::default();
    let mut seen = HashSet::new();
    for (i, raw) in (0..).zip(lines(bytes)) {
        p.lines = i;
        let raw = trim_eol(raw);
        if raw.is_empty() {
            continue;
        }
        let Some(line) = RawLine::read(raw) else {
            continue;
        };
        let ts = s(line.timestamp).and_then(|t| parse_ts(&t));
        if let Some(ts) = ts {
            p.last_ts = Some(p.last_ts.map_or(ts, |t| t.max(ts)));
        }
        if let Some(c) = s(line.cwd) {
            p.cwd.see(&c, project);
        }
        if let Some(b) = s(line.branch).filter(|b| !b.is_empty())
            && !seen.contains(b.as_ref())
        {
            seen.insert(b.to_string());
            p.branches.push(b.into_owned());
        }
        match s(line.kind).as_deref() {
            Some("user") => {
                p.messages += 1;
                if let Some(text) = line.message.and_then(rawjson::user_text) {
                    p.user_texts.push(UserText {
                        line: i + 1,
                        ts,
                        uuid: s(line.uuid).map(Cow::into_owned),
                        text,
                    });
                }
            }
            Some("assistant") => p.messages += 1,
            _ => {}
        }
    }
    p
}

/// Split `bytes` into about `n` runs of whole lines.
fn line_chunks(bytes: &[u8], n: usize) -> Vec<&[u8]> {
    let mut out = Vec::with_capacity(n);
    let mut rest = bytes;
    let size = bytes.len().div_ceil(n.max(1));
    while rest.len() > size {
        let cut = rest[size..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(rest.len(), |i| size + i + 1);
        let (head, tail) = rest.split_at(cut);
        out.push(head);
        rest = tail;
    }
    if !rest.is_empty() {
        out.push(rest);
    }
    out
}

/// Read the header fields of the transcript at `path`. A large transcript is
/// parsed in line-aligned chunks on several threads, then merged in order.
///
/// # Errors
/// When the file cannot be read.
pub fn read_session(path: &Path) -> io::Result<SessionInfo> {
    let bytes = std::fs::read(path)?;
    let project = path
        .parent()
        .and_then(Path::file_name)
        .and_then(std::ffi::OsStr::to_str);
    let threads = std::thread::available_parallelism().map_or(1, std::num::NonZero::get);
    let chunks = line_chunks(&bytes, (bytes.len() / CHUNK).clamp(1, threads));
    let parts: Vec<Partial> = if chunks.len() == 1 {
        vec![scan_header(&bytes, project)]
    } else {
        std::thread::scope(|s| {
            let handles: Vec<_> = chunks
                .iter()
                .map(|c| s.spawn(move || scan_header(c, project)))
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap_or_default())
                .collect()
        })
    };
    let mut info = SessionInfo {
        transcript: path.to_path_buf(),
        ..SessionInfo::default()
    };
    let mut seen = HashSet::new();
    let mut cwd = LaunchCwd::default();
    let mut offset = 0;
    for p in parts {
        info.last_ts = info.last_ts.max(p.last_ts);
        cwd.merge(&p.cwd);
        for b in p.branches {
            if seen.insert(b.clone()) {
                info.branches.push(b);
            }
        }
        info.messages += p.messages;
        info.user_texts
            .extend(p.user_texts.into_iter().map(|t| UserText {
                line: t.line + offset,
                ..t
            }));
        offset += p.lines;
    }
    info.cwd = cwd.get().map(str::to_string);
    Ok(info)
}

/// A message shown around a hit by `-C`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextMessage {
    /// 1-based line number in the transcript.
    pub line: u64,
    /// The line's raw `type`.
    pub kind: Option<String>,
    /// The raw content-part type of the message's first text unit.
    pub part: Option<String>,
    /// The message metadata.
    pub meta: MessageMeta,
    /// The start of the message's text, on one line.
    pub text: String,
}

/// Bytes of a context message's text that are kept.
pub const CONTEXT_TEXT: usize = 2 * crate::search::EXCERPT_CONTEXT;

/// The `n` messages (`user` and `assistant` lines) before and after each of
/// `hit_lines` in the transcript at `path`. Lines that are hits themselves
/// are left out. Sorted by line.
///
/// # Errors
/// When the file cannot be read.
pub fn context_messages(
    path: &Path,
    hit_lines: &[u64],
    n: usize,
) -> io::Result<Vec<ContextMessage>> {
    if n == 0 || hit_lines.is_empty() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path)?;
    // (line number, parsed value) of each message line.
    let mut messages: Vec<(u64, Value)> = Vec::new();
    for (i, raw) in (1..).zip(bytes.split(|&b| b == b'\n')) {
        let raw = trim_eol(raw);
        if raw.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_slice::<Value>(raw) else {
            continue;
        };
        if matches!(
            v.get("type").and_then(Value::as_str),
            Some("user" | "assistant")
        ) {
            messages.push((i, v));
        }
    }
    let hits: HashSet<u64> = hit_lines.iter().copied().collect();
    let mut wanted: Vec<usize> = Vec::new();
    for &h in hit_lines {
        let at = messages.partition_point(|(l, _)| *l < h);
        let after = if messages.get(at).is_some_and(|(l, _)| *l == h) {
            at + 1
        } else {
            at
        };
        wanted.extend(at.saturating_sub(n)..at);
        wanted.extend(after..(after + n).min(messages.len()));
    }
    wanted.sort_unstable();
    wanted.dedup();
    Ok(wanted
        .into_iter()
        .filter(|&i| !hits.contains(&messages[i].0))
        .map(|i| {
            let (line, v) = &messages[i];
            let mut part: Option<Option<&str>> = None;
            let mut text = String::new();
            decode::transcript_units(v, &mut |p, s| {
                if text.len() >= CONTEXT_TEXT {
                    return;
                }
                part.get_or_insert(p);
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(s);
            });
            let mut end = text.len().min(CONTEXT_TEXT);
            while !text.is_char_boundary(end) {
                end += 1;
            }
            text.truncate(end);
            ContextMessage {
                line: *line,
                kind: decode::line_type(v).map(str::to_string),
                part: part.flatten().map(str::to_string),
                meta: decode::transcript_meta(v),
                text: text.replace(['\n', '\r', '\t'], " "),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, lines: &[&str]) -> PathBuf {
        let p = dir.join("s1.jsonl");
        std::fs::write(&p, lines.join("\n") + "\n").unwrap();
        p
    }

    #[test]
    fn header_fields_and_user_texts() {
        let dir = tempfile::tempdir().unwrap();
        let p = write(
            dir.path(),
            &[
                r#"{"type":"user","cwd":"/a","gitBranch":"x","timestamp":"2026-08-02T14:01:00Z","message":{"content":"first"}}"#,
                r#"{"type":"assistant","cwd":"/b","gitBranch":"y","timestamp":"2026-08-02T14:03:00Z","message":{"content":[{"type":"text","text":"ok"}]}}"#,
                r#"{"type":"user","cwd":"/b","gitBranch":"x","timestamp":"2026-08-02T14:02:00Z","message":{"content":[{"type":"text","text":"second"}]}}"#,
                r#"{"type":"user","isMeta":true,"message":{"content":"meta"}}"#,
                r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"out"}]}}"#,
                "{broken",
            ],
        );
        let info = read_session(&p).unwrap();
        assert_eq!(info.cwd.as_deref(), Some("/a"), "the launch folder");
        assert_eq!(info.branches, vec!["x".to_string(), "y".to_string()]);
        let texts: Vec<(u64, &str)> = info
            .user_texts
            .iter()
            .map(|t| (t.line, t.text.as_str()))
            .collect();
        // Every user/text line, the isMeta one too; not the tool result.
        assert_eq!(texts, vec![(1, "first"), (3, "second"), (4, "meta")]);
        assert_eq!(info.user_texts[0].ts, parse_ts("2026-08-02T14:01:00Z"));
        assert_eq!(info.last_ts, parse_ts("2026-08-02T14:03:00Z"));
        assert_eq!(info.messages, 5);
    }

    #[test]
    fn launch_folder_prefers_the_one_the_project_name_encodes() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("-w-my-app");
        std::fs::create_dir_all(&proj).unwrap();
        let line =
            |c: &str| format!(r#"{{"type":"user","cwd":"{c}","message":{{"content":"x"}}}}"#);
        let lines = [line("/w/my.app/sub"), line("/w/my.app"), line("/elsewhere")];
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let p = write(&proj, &refs);
        assert_eq!(read_session(&p).unwrap().cwd.as_deref(), Some("/w/my.app"));
        let mut l = LaunchCwd::default();
        l.see("", Some("-x"));
        l.see("/a", Some("-x"));
        l.see("/b", Some("-x"));
        assert_eq!(l.get(), Some("/a"));
    }

    #[test]
    fn user_texts_read_like_decode_and_number_lines_across_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let lines = [
            r#"{"type":"user","message":{"content":"plain"}}"#,
            r#"{"type":"user","message":{"content":[{"type":"text","text":"a"},{"type":"image","source":{"data":"x"}},"b"]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"no"}]}]}}"#,
            r#"{"type":"user","message":"odd"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"no"}]}}"#,
        ];
        let p = write(dir.path(), &lines);
        let info = read_session(&p).unwrap();
        let got: Vec<(u64, String)> = info
            .user_texts
            .iter()
            .map(|t| (t.line, t.text.clone()))
            .collect();
        assert_eq!(got, vec![(1, "plain".into()), (2, "a\nb".into())]);
        for (i, l) in lines.iter().enumerate() {
            let v: Value = serde_json::from_str(l).unwrap();
            let want = got
                .iter()
                .find(|g| g.0 == i as u64 + 1)
                .map(|g| g.1.clone());
            assert_eq!(decode::user_text(&v), want, "line {}", i + 1);
        }
        // Chunked: line numbers keep counting across runs.
        let text = lines.join("\n") + "\n";
        let chunks = line_chunks(text.as_bytes(), 3);
        assert!(chunks.len() > 1);
        let mut offset = 0;
        let mut seen = Vec::new();
        for c in chunks {
            let part = scan_header(c, None);
            seen.extend(part.user_texts.iter().map(|t| t.line + offset));
            offset += part.lines;
        }
        assert_eq!(seen, vec![1, 2]);
    }

    #[test]
    fn context_takes_n_messages_around_each_hit() {
        let dir = tempfile::tempdir().unwrap();
        let line = |t: &str| format!(r#"{{"type":"user","message":{{"content":"{t}"}}}}"#);
        let lines: Vec<String> = ["m1", "m2", "m3", "m4", "m5", "m6"]
            .iter()
            .map(|t| line(t))
            .collect();
        let mut refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        refs.insert(3, r#"{"type":"summary","summary":"not a message"}"#);
        // Lines: 1 m1, 2 m2, 3 m3, 4 summary, 5 m4, 6 m5, 7 m6
        let p = write(dir.path(), &refs);
        let ctx = context_messages(&p, &[5], 2).unwrap();
        let texts: Vec<_> = ctx.iter().map(|c| (c.line, c.text.as_str())).collect();
        assert_eq!(texts, vec![(2, "m2"), (3, "m3"), (6, "m5"), (7, "m6")]);
        // Overlapping windows merge, and hit lines are not repeated.
        let ctx = context_messages(&p, &[2, 3], 1).unwrap();
        let lines: Vec<_> = ctx.iter().map(|c| c.line).collect();
        assert_eq!(lines, vec![1, 5]);
        assert_eq!(
            (ctx[0].kind.as_deref(), ctx[0].part.as_deref()),
            (Some("user"), Some("text"))
        );
    }
}
