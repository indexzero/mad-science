//! Machine formats for `clrg grep`: jsonl, json, tsv, and values.
//!
//! The JSONL record shape is a contract (INTENT.md): the 17 fields below, in
//! this order. `-C` adds context records, and only then a `context` field.
//! `type` and `part` are raw (R9); `last`, `agreement`, and `agreement_rule`
//! are clrg's (R10, see COGNETICS.md).

use std::collections::{HashMap, HashSet};
use std::io::{self, Write};
use std::path::PathBuf;

use clrg_core::Group;
use serde::Serialize;

use crate::grep::{Item, Row};

/// The record fields, in order. `--fields` and `--sort` name these.
pub const FIELDS: [&str; 17] = [
    "root",
    "store",
    "path",
    "session",
    "cwd",
    "cwd_exists",
    "branch",
    "ts",
    "type",
    "part",
    "line",
    "excerpt",
    "match_start",
    "match_end",
    "last",
    "agreement",
    "agreement_rule",
];

/// The default `--fields` for tsv.
pub const TSV_DEFAULT: &str = "ts,session,cwd,branch,type,part,excerpt";

/// One JSONL record. The field order is the contract (INTENT.md).
#[derive(Serialize)]
pub struct Record<'a> {
    root: String,
    store: &'static str,
    path: String,
    session: Option<&'a str>,
    cwd: Option<&'a str>,
    cwd_exists: Option<bool>,
    branch: Option<&'a str>,
    ts: Option<String>,
    #[serde(rename = "type")]
    kind: Option<&'a str>,
    part: Option<&'a str>,
    line: Option<u64>,
    excerpt: &'a str,
    match_start: Option<usize>,
    match_end: Option<usize>,
    last: Option<bool>,
    agreement: Option<&'static str>,
    agreement_rule: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<bool>,
}

/// Builds records, remembering which folders exist.
pub struct Records<'a> {
    pub roots: &'a [PathBuf],
    pub groups: &'a [Group],
    /// `-C` was given: every record carries `context`.
    pub with_context: bool,
    stat: HashMap<String, bool>,
}

impl<'a> Records<'a> {
    pub fn new(roots: &'a [PathBuf], groups: &'a [Group], with_context: bool) -> Self {
        Records {
            roots,
            groups,
            with_context,
            stat: HashMap::new(),
        }
    }

    /// The record for one row. A hit with no `cwd` of its own (a todo, a
    /// task, ...) takes its session's.
    pub fn record<'r>(&mut self, row: &'r Row<'r>) -> Record<'r>
    where
        'a: 'r,
    {
        let g = &self.groups[row.group];
        let (path, store, meta) = match &row.item {
            Item::Hit(h) => (h.path.as_path(), h.store, &h.meta),
            Item::Context { path, msg } => (*path, clrg_core::StoreKind::Transcripts, &msg.meta),
        };
        let cwd = meta.cwd.as_deref().or(g.cwd.as_deref());
        let cwd_exists = cwd.map(|c| {
            if Some(c) == g.cwd.as_deref()
                && let Some(e) = g.cwd_exists
            {
                return e;
            }
            *self
                .stat
                .entry(c.to_string())
                .or_insert_with(|| clrg_core::session::cwd_exists(c))
        });
        let base = Record {
            root: self.roots[g.root].to_string_lossy().into_owned(),
            store: store.as_str(),
            path: path.to_string_lossy().into_owned(),
            session: meta.session.as_deref().or(g.session.as_deref()),
            cwd,
            cwd_exists,
            branch: meta.branch.as_deref(),
            ts: meta.ts.and_then(clrg_core::format_ts),
            kind: None,
            part: None,
            line: None,
            excerpt: "",
            match_start: None,
            match_end: None,
            last: None,
            agreement: None,
            agreement_rule: None,
            context: None,
        };
        match &row.item {
            Item::Hit(h) => Record {
                kind: h.kind.as_deref(),
                part: h.part.as_deref(),
                line: h.line,
                excerpt: &h.excerpt,
                match_start: Some(h.match_start),
                match_end: Some(h.match_end),
                last: h.last,
                agreement: h.agreement.map(clrg_core::Agreement::as_str),
                agreement_rule: h.agreement_rule.map(clrg_core::Rule::as_str),
                context: self.with_context.then_some(false),
                ..base
            },
            Item::Context { path, msg } => {
                let mark = context_mark(g, path, msg);
                Record {
                    kind: msg.kind.as_deref(),
                    part: msg.part.as_deref(),
                    line: Some(msg.line),
                    excerpt: &msg.text,
                    last: mark.map(|m| m.2),
                    agreement: mark.map(|m| m.0.as_str()),
                    agreement_rule: mark.and_then(|m| m.1.map(clrg_core::Rule::as_str)),
                    context: Some(true),
                    ..base
                }
            }
        }
    }
}

/// The agreement, rule, and `last` of a context message that is a
/// `user/text` line, as a hit on that line would have them.
pub fn context_mark(
    g: &Group,
    path: &std::path::Path,
    msg: &clrg_core::ContextMessage,
) -> Option<(clrg_core::Agreement, Option<clrg_core::Rule>, bool)> {
    if msg.kind.as_deref() != Some("user") || msg.part.as_deref() != Some("text") {
        return None;
    }
    let sa = g.agreement.as_ref()?;
    Some(match sa.mark(path, msg.line) {
        Some(m) => (m.agreement, m.rule, m.last),
        None => (sa.unpaired_text(), None, false),
    })
}

/// One JSON object per line.
pub fn jsonl(out: &mut impl Write, recs: &mut Records<'_>, rows: &[Row<'_>]) -> io::Result<()> {
    for row in rows {
        serde_json::to_writer(&mut *out, &recs.record(row))?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

/// One JSON array of the JSONL records.
pub fn json(out: &mut impl Write, recs: &mut Records<'_>, rows: &[Row<'_>]) -> io::Result<()> {
    let all: Vec<Record<'_>> = rows.iter().map(|r| recs.record(r)).collect();
    serde_json::to_writer(&mut *out, &all)?;
    out.write_all(b"\n")
}

/// A header row, then one row per hit. Context rows are left out.
pub fn tsv(
    out: &mut impl Write,
    recs: &mut Records<'_>,
    rows: &[Row<'_>],
    fields: &[&str],
    end: u8,
) -> io::Result<()> {
    out.write_all(fields.join("\t").as_bytes())?;
    out.write_all(&[end])?;
    for row in rows.iter().filter(|r| matches!(r.item, Item::Hit(_))) {
        let v = serde_json::to_value(recs.record(row))?;
        let cells: Vec<String> = fields
            .iter()
            .map(|f| crate::common::cell(v.get(*f)))
            .collect();
        out.write_all(cells.join("\t").as_bytes())?;
        out.write_all(&[end])?;
    }
    Ok(())
}

/// `<session>:<cwd>` for each matched session, once, in result order.
pub fn values(out: &mut impl Write, groups: &[Group], rows: &[Row<'_>], end: u8) -> io::Result<()> {
    let mut seen = HashSet::new();
    for row in rows {
        let g = &groups[row.group];
        let Some(sid) = &g.session else { continue };
        let line = crate::common::scrub(&format!("{sid}:{}", g.cwd.as_deref().unwrap_or("")));
        if seen.insert(line.clone()) {
            out.write_all(line.as_bytes())?;
            out.write_all(&[end])?;
        }
    }
    Ok(())
}
