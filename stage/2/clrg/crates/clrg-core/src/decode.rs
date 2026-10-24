//! Decoding parsed JSON into searchable text units and message metadata.
//!
//! The pattern matches decoded string values (R6), but not every string in a
//! transcript line: matching `uuid`, `cwd`, or `gitBranch` would make every
//! line of a project hit a search for the project's name. So:
//!
//! - `user` and `assistant` lines search `message.content` only. Each unit
//!   is labelled with the raw content-part `type` (R9): `text`, `thinking`,
//!   `tool_use` (name and every string in `input`), `tool_result` (every
//!   string in `content`), and so on. String content is part `text`, the one
//!   normalisation. Images and documents (base64) and redacted thinking are
//!   not text and are skipped.
//! - Every other line (`system`, `summary`, `file-history-snapshot`, ...)
//!   searches every string except the top-level metadata keys, with no part.
//! - `history.jsonl` lines search every string except `project`,
//!   `sessionId`, and `timestamp`.
//! - Other JSON stores (todos, tasks, sessions) search every string, with no
//!   part.
//!
//! clrg derives no labels of its own here: no "prompt", no "other".

use serde_json::Value;

use crate::parse_ts;

/// Top-level keys of a transcript line that are metadata, not text.
const TRANSCRIPT_META_KEYS: &[&str] = &[
    "type",
    "uuid",
    "parentUuid",
    "logicalParentUuid",
    "leafUuid",
    "sessionId",
    "timestamp",
    "cwd",
    "gitBranch",
    "version",
    "isSidechain",
    "isMeta",
    "userType",
    "requestId",
    "messageId",
    "toolUseID",
    "slug",
    "agentId",
    "level",
    "subtype",
];

/// Keys of a `history.jsonl` line that are metadata, not text.
const HISTORY_META_KEYS: &[&str] = &["project", "sessionId", "timestamp"];

/// Tool input keys that name a file the tool touched.
const TOUCH_KEYS: &[&str] = &["file_path", "path", "notebook_path"];

/// Per-message metadata: what selectors filter on and what a hit carries.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessageMeta {
    /// The message `uuid`.
    pub uuid: Option<String>,
    /// The session id: the line's `sessionId`, else derived from the path.
    pub session: Option<String>,
    /// The recorded working folder (`cwd`; `project` in `history.jsonl`).
    pub cwd: Option<String>,
    /// `gitBranch`, when present and not empty.
    pub branch: Option<String>,
    /// The message time in unix milliseconds.
    pub ts: Option<i64>,
    /// `message.model` (assistant lines).
    pub model: Option<String>,
    /// `version`: the Claude Code version that wrote the line.
    pub version: Option<String>,
    /// Names of the tools this message calls.
    pub tools: Vec<String>,
    /// Paths named by this message's tool inputs.
    pub touched: Vec<String>,
    /// The encoded `projects/<dir>` name (transcripts only).
    pub project: Option<String>,
    /// `isSidechain`, or the transcript lives under `subagents/`.
    pub sidechain: bool,
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Read the metadata of one transcript line.
#[must_use]
pub fn transcript_meta(v: &Value) -> MessageMeta {
    let message = v.get("message");
    let mut meta = MessageMeta {
        uuid: str_field(v, "uuid"),
        session: str_field(v, "sessionId"),
        cwd: str_field(v, "cwd"),
        branch: str_field(v, "gitBranch"),
        ts: v
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_ts),
        model: message.and_then(|m| str_field(m, "model")),
        version: str_field(v, "version"),
        sidechain: v.get("isSidechain").and_then(Value::as_bool) == Some(true),
        ..MessageMeta::default()
    };
    if let Some(parts) = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    {
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            if let Some(name) = str_field(part, "name") {
                meta.tools.push(name);
            }
            if let Some(input) = part.get("input") {
                for key in TOUCH_KEYS {
                    if let Some(p) = str_field(input, key) {
                        meta.touched.push(p);
                    }
                }
            }
        }
    }
    meta
}

/// Read the metadata of one `history.jsonl` line.
#[must_use]
pub fn history_meta(v: &Value) -> MessageMeta {
    MessageMeta {
        session: str_field(v, "sessionId"),
        cwd: str_field(v, "project"),
        ts: v
            .get("timestamp")
            .and_then(|t| t.as_i64().or_else(|| t.as_str().and_then(parse_ts))),
        ..MessageMeta::default()
    }
}

/// Call `f` with every string value in `v`, depth first (object keys in
/// sorted order, array items in order).
pub fn for_each_string<'a>(v: &'a Value, f: &mut impl FnMut(&'a str)) {
    match v {
        Value::String(s) => f(s),
        Value::Array(items) => items.iter().for_each(|i| for_each_string(i, f)),
        Value::Object(map) => map.values().for_each(|i| for_each_string(i, f)),
        _ => {}
    }
}

/// Every string in an object except the given top-level keys.
fn for_each_string_except<'a>(v: &'a Value, skip: &[&str], f: &mut impl FnMut(&'a str)) {
    if let Value::Object(map) = v {
        for (k, val) in map {
            if !skip.contains(&k.as_str()) {
                for_each_string(val, f);
            }
        }
    } else {
        for_each_string(v, f);
    }
}

/// The line's own `type` (`user`, `assistant`, `system`, ...).
#[must_use]
pub fn line_type(v: &Value) -> Option<&str> {
    v.get("type").and_then(Value::as_str)
}

/// Call `f(part, text)` with each searchable text unit of a transcript line.
/// `part` is the raw content-part `type` (`None` outside `message.content`).
pub fn transcript_units<'a>(v: &'a Value, f: &mut impl FnMut(Option<&'a str>, &'a str)) {
    let content = v.get("message").and_then(|m| m.get("content"));
    let (Some("user" | "assistant"), Some(content)) = (line_type(v), content) else {
        for_each_string_except(v, TRANSCRIPT_META_KEYS, &mut |s| f(None, s));
        return;
    };
    match content {
        Value::String(s) => f(Some("text"), s),
        Value::Array(parts) => {
            for part in parts {
                content_part_units(part, f);
            }
        }
        other => for_each_string(other, &mut |s| f(None, s)),
    }
}

fn content_part_units<'a>(part: &'a Value, f: &mut impl FnMut(Option<&'a str>, &'a str)) {
    let Some(kind) = part.get("type").and_then(Value::as_str) else {
        // A bare string in a content array is text (the one normalisation).
        if let Some(s) = part.as_str() {
            f(Some("text"), s);
        }
        return;
    };
    let label = Some(kind);
    match kind {
        "text" => {
            if let Some(s) = part.get("text").and_then(Value::as_str) {
                f(label, s);
            }
        }
        "thinking" => {
            if let Some(s) = part.get("thinking").and_then(Value::as_str) {
                f(label, s);
            }
        }
        "tool_use" | "server_tool_use" => {
            if let Some(s) = part.get("name").and_then(Value::as_str) {
                f(label, s);
            }
            if let Some(input) = part.get("input") {
                for_each_string(input, &mut |s| f(label, s));
            }
        }
        k if k == "tool_result" || k.ends_with("_tool_result") => match part.get("content") {
            Some(Value::Array(items)) => {
                for item in items {
                    match item.get("type").and_then(Value::as_str) {
                        Some("image" | "document") => {}
                        _ => for_each_string_except(item, &["type"], &mut |s| f(label, s)),
                    }
                }
            }
            Some(c) => for_each_string(c, &mut |s| f(label, s)),
            None => {}
        },
        "image" | "document" | "redacted_thinking" => {}
        _ => for_each_string_except(part, &["type", "id"], &mut |s| f(label, s)),
    }
}

/// The text of a `user/text` line: a line with `type == "user"` whose
/// `message.content` is a string, or the `text` of each content part with
/// `type == "text"` (and each bare string), joined with newlines. `None` when
/// the line is not `user` or has no text part (a tool result, an image).
#[must_use]
pub fn user_text(v: &Value) -> Option<String> {
    if line_type(v) != Some("user") {
        return None;
    }
    match v.get("message")?.get("content")? {
        Value::String(s) => Some(s.clone()),
        Value::Array(parts) => {
            let texts: Vec<&str> = parts
                .iter()
                .filter_map(|p| match p {
                    Value::String(s) => Some(s.as_str()),
                    _ if p.get("type").and_then(Value::as_str) == Some("text") => {
                        p.get("text").and_then(Value::as_str)
                    }
                    _ => None,
                })
                .collect();
            (!texts.is_empty()).then(|| texts.join("\n"))
        }
        _ => None,
    }
}

/// Call `f(text)` with each searchable string of a `history.jsonl` line.
pub fn history_units<'a>(v: &'a Value, f: &mut impl FnMut(&'a str)) {
    for_each_string_except(v, HISTORY_META_KEYS, f);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn units(v: &Value) -> Vec<(Option<String>, String)> {
        let mut out = Vec::new();
        transcript_units(v, &mut |p, s| {
            out.push((p.map(str::to_string), s.to_string()));
        });
        out
    }

    fn u(p: Option<&str>, s: &str) -> (Option<String>, String) {
        (p.map(str::to_string), s.to_string())
    }

    #[test]
    fn string_content_is_part_text_and_parts_keep_their_type() {
        let typed = json!({"type":"user","cwd":"/w","message":{"role":"user","content":"find it"}});
        assert_eq!(units(&typed), vec![u(Some("text"), "find it")]);
        let result = json!({"type":"user","message":{"role":"user","content":[
            {"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"done"}]}
        ]}});
        assert_eq!(units(&result), vec![u(Some("tool_result"), "done")]);
        assert_eq!(user_text(&result), None);
        assert_eq!(user_text(&typed).as_deref(), Some("find it"));
    }

    #[test]
    fn assistant_parts_keep_their_raw_type() {
        let v = json!({"type":"assistant","message":{"role":"assistant","model":"m-1","content":[
            {"type":"thinking","thinking":"hmm"},
            {"type":"text","text":"ok"},
            {"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"/w/a.txt","content":"x"}}
        ]}});
        assert_eq!(
            units(&v),
            vec![
                u(Some("thinking"), "hmm"),
                u(Some("text"), "ok"),
                u(Some("tool_use"), "Write"),
                u(Some("tool_use"), "x"),
                u(Some("tool_use"), "/w/a.txt"),
            ]
        );
        let meta = transcript_meta(&v);
        assert_eq!(meta.tools, vec!["Write".to_string()]);
        assert_eq!(meta.touched, vec!["/w/a.txt".to_string()]);
        assert_eq!(meta.model.as_deref(), Some("m-1"));
        assert_eq!(user_text(&v), None, "assistant text is not user/text");
    }

    #[test]
    fn other_lines_have_no_part_and_skip_metadata_keys() {
        let v = json!({"type":"summary","summary":"the plan","leafUuid":"x","cwd":"/w"});
        assert_eq!(units(&v), vec![u(None, "the plan")]);
        assert_eq!(line_type(&v), Some("summary"));
    }

    #[test]
    fn inserted_user_text_is_still_user_text() {
        // No skip list: these are user/text; agreement tells them apart.
        let v = json!({"type":"user","isMeta":true,"message":{"content":[
            {"type":"text","text":"a"},{"type":"image","source":{}},"b"
        ]}});
        assert_eq!(units(&v), vec![u(Some("text"), "a"), u(Some("text"), "b")]);
        assert_eq!(user_text(&v).as_deref(), Some("a\nb"));
    }

    #[test]
    fn empty_branch_is_none() {
        let v = json!({"type":"user","gitBranch":"","message":{"content":"x"}});
        assert_eq!(transcript_meta(&v).branch, None);
    }
}
