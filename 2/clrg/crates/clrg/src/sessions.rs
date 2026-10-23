//! `clrg sessions`: one row per session that the selectors match, newest
//! first. Answers "which folder do I resume from?" (R2).
//!
//! ```text
//! 2026-08-02 14:31  ~/src/app                  [onboarding.gonzo]  3f2a9c1e  12 msg  "wire the seed…"
//! 2026-08-01 09:12  ~/src/gone (cwd missing)   [main]              7b01d2aa   3 msg  "why does the…" (unverified)
//! ```
//!
//! The last column is the `last:` text of `clrg grep`, with its markers.

use std::collections::HashSet;
use std::io::{self, Write};

use clrg_core::agree::LastStatus;
use clrg_core::{CatalogOptions, LastText, Outcome, SessionSummary};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{Format, GlobalArgs, SessionsArgs};
use crate::commands::{NotImplemented, UsageError};
use crate::common::{self, Env};
use crate::exit;
use crate::render::{self, CWD, Look, MISSING};

/// The record fields, in order: the spec's FIELDS for `sessions`.
pub const FIELDS: [&str; 17] = [
    "root",
    "session",
    "project",
    "cwd",
    "cwd_exists",
    "branches",
    "first_ts",
    "last_ts",
    "messages",
    "tools",
    "files_touched",
    "models",
    "cli_versions",
    "has_file_history",
    "subagents",
    "confidence",
    "last",
];

/// The default `--fields` for tsv.
const TSV_DEFAULT: &str = "last_ts,session,cwd,cwd_exists,branches,messages,last";

/// The widest the cwd column is padded to; a longer cwd overflows it.
const CWD_COLUMN: usize = 48;
/// The narrowest last prompt, however narrow the terminal.
const MIN_PROMPT: usize = 12;

/// One session record. The field order is [`FIELDS`].
#[derive(Serialize)]
struct Record<'a> {
    root: String,
    session: &'a str,
    project: Option<&'a str>,
    cwd: Option<&'a str>,
    cwd_exists: Option<bool>,
    branches: &'a [String],
    first_ts: Option<String>,
    last_ts: Option<String>,
    messages: u64,
    tools: &'a [String],
    files_touched: u64,
    models: &'a [String],
    cli_versions: &'a [String],
    has_file_history: bool,
    subagents: u64,
    /// Only `--infer-branch` (not built yet) makes a match less than exact.
    confidence: Option<&'a str>,
    /// The `last:` text (R10): the last `user/text` that agrees with history.
    last: Option<&'a str>,
}

fn record(env: &Env, s: &SessionSummary) -> Value {
    let r = Record {
        root: env.roots[s.root].to_string_lossy().into_owned(),
        session: &s.session,
        project: s.project.as_deref(),
        cwd: s.cwd.as_deref(),
        cwd_exists: s.cwd_exists,
        branches: &s.branches,
        first_ts: s.first_ts.and_then(clrg_core::format_ts),
        last_ts: s.last_ts.and_then(clrg_core::format_ts),
        messages: s.messages,
        tools: &s.tools,
        files_touched: s.files_touched,
        models: &s.models,
        cli_versions: &s.cli_versions,
        has_file_history: s.has_file_history,
        subagents: s.subagents,
        confidence: None,
        last: s.last.as_ref().map(|l| l.text.as_str()),
    };
    serde_json::to_value(r).unwrap_or(Value::Null)
}

pub fn run(global: &GlobalArgs, args: &SessionsArgs) -> anyhow::Result<u8> {
    if args.select.infer_branch {
        return Err(NotImplemented("sessions --infer-branch").into());
    }
    let fields = match (&args.output.fields, args.format) {
        (Some(_), Format::Human) => {
            return Err(NotImplemented("sessions --fields with --format human").into());
        }
        (Some(f), Format::Tsv) => common::parse_fields(f, &FIELDS)?,
        (None, Format::Tsv) => common::parse_fields(TSV_DEFAULT, &FIELDS)?,
        (Some(_), _) => return Err(UsageError("--fields applies to --format tsv".into()).into()),
        (None, _) => Vec::new(),
    };
    let sort = common::parse_sort(args.output.sort.as_deref(), &FIELDS)?;
    let env = Env::new(global);
    let opts = CatalogOptions {
        roots: env.roots.clone(),
        selectors: common::selectors(&args.select, &env)?,
    };
    let (mut rows, outcome) =
        clrg_core::catalog::sessions(&opts).map_err(|e| UsageError(e.to_string()))?;

    // Newest first, then by root and id, so the order is stable.
    rows.sort_by(|a, b| {
        b.last_ts
            .cmp(&a.last_ts)
            .then_with(|| a.root.cmp(&b.root))
            .then_with(|| a.session.cmp(&b.session))
    });
    let mut records: Vec<(Value, SessionSummary)> =
        rows.into_iter().map(|s| (record(&env, &s), s)).collect();
    if let Some((field, desc)) = sort {
        records.sort_by(|a, b| {
            let o = common::cmp_values(&a.0[field], &b.0[field]);
            if desc { o.reverse() } else { o }
        });
    }
    records.truncate(args.output.limit.unwrap_or(usize::MAX));
    let found = !records.is_empty();

    let look = env.look(global);
    let end = if args.output.null { b'\0' } else { b'\n' };
    let printed = common::write_stdout(|mut out| {
        let values: Vec<Value> = records.iter().map(|r| r.0.clone()).collect();
        match args.format {
            Format::Human => human(&mut out, &records, &look),
            Format::Json => common::json(&mut out, &values, false),
            Format::Jsonl => common::json(&mut out, &values, true),
            Format::Tsv => common::tsv(&mut out, &values, &fields, end),
            Format::Values => values_lines(&mut out, &records, end),
        }
    })?;
    if !printed {
        return Ok(exit::MATCHED);
    }
    if found && !global.quiet {
        let (t, h) = records.iter().fold((0, 0), |(t, h), (_, s)| {
            (t + s.transcript_only, h + s.history_only)
        });
        eprintln!("{}", common::agreement_line(t, h));
    }
    if let Some(code) = common::settle(global, &env.roots, &outcome) {
        return Ok(code);
    }
    if found {
        return Ok(exit::MATCHED);
    }
    eprint!("{}", no_match_message(args, &env, &outcome));
    Ok(exit::NO_MATCH)
}

/// `<session id>:<cwd>`, once per distinct line.
fn values_lines(
    out: &mut impl Write,
    records: &[(Value, SessionSummary)],
    end: u8,
) -> io::Result<()> {
    let mut seen = HashSet::new();
    for (_, s) in records {
        let line = common::scrub(&format!("{}:{}", s.session, s.cwd.as_deref().unwrap_or("")));
        if seen.insert(line.clone()) {
            out.write_all(line.as_bytes())?;
            out.write_all(&[end])?;
        }
    }
    Ok(())
}

/// One aligned line per session; the `last:` text fills what is left.
fn human(
    out: &mut impl Write,
    records: &[(Value, SessionSummary)],
    look: &Look<'_>,
) -> io::Result<()> {
    struct Cells {
        when: String,
        cwd: String,
        missing: bool,
        branches: String,
        id: String,
        messages: String,
        root: String,
    }
    let cells: Vec<Cells> = records
        .iter()
        .map(|(_, s)| Cells {
            when: s
                .last_ts
                .and_then(|ms| look.date_time(ms))
                .unwrap_or_default(),
            cwd: s
                .cwd
                .as_deref()
                .map_or_else(|| "(no cwd)".into(), |c| look.tilde(c)),
            missing: s.cwd_exists == Some(false),
            branches: if s.branches.is_empty() {
                String::new()
            } else {
                format!("[{}]", render::clean(&s.branches.join(", ")))
            },
            id: render::short_id(&s.session),
            messages: s.messages.to_string(),
            root: if look.roots.len() > 1 {
                format!(
                    "(root {})",
                    look.tilde(&look.roots[s.root].to_string_lossy())
                )
            } else {
                String::new()
            },
        })
        .collect();
    let width = |f: fn(&Cells) -> usize| cells.iter().map(f).max().unwrap_or(0);
    let w_when = width(|c| len(&c.when));
    let w_cwd = width(|c| len(&c.cwd) + if c.missing { 14 } else { 0 }).min(CWD_COLUMN);
    let w_branches = width(|c| len(&c.branches));
    let w_id = width(|c| len(&c.id));
    let w_msgs = width(|c| len(&c.messages));
    let w_root = width(|c| len(&c.root));
    for ((_, s), c) in records.iter().zip(&cells) {
        let mut line = String::new();
        let mut used = 0;
        let mut col = |line: &mut String, painted: &str, shown: usize, w: usize| {
            if w == 0 {
                return;
            }
            if !line.is_empty() {
                line.push_str("  ");
                used += 2;
            }
            line.push_str(painted);
            line.push_str(&" ".repeat(w.saturating_sub(shown)));
            used += w.max(shown);
        };
        col(&mut line, &c.when, len(&c.when), w_when);
        let mut cwd = look.paint(CWD, &c.cwd);
        let mut shown = len(&c.cwd);
        if c.missing {
            cwd.push(' ');
            cwd.push_str(&look.paint(MISSING, "(cwd missing)"));
            shown += 14;
        }
        col(&mut line, &cwd, shown, w_cwd);
        col(&mut line, &c.branches, len(&c.branches), w_branches);
        col(&mut line, &c.id, len(&c.id), w_id);
        let msgs = format!("{:>w_msgs$} msg", c.messages);
        col(&mut line, &msgs, len(&msgs), w_msgs + 4);
        col(&mut line, &c.root, len(&c.root), w_root);
        if let Some(last) = &s.last {
            line.push_str(&last_cell(last, look.width.saturating_sub(used + 2), look));
        }
        writeln!(out, "{}", line.trim_end())?;
    }
    Ok(())
}

/// `  "text"` with the `last:` markers, fitted to `room` columns: a later
/// `transcript-only` text shares the room, marked `(not in history)`.
fn last_cell(last: &LastText, room: usize, look: &Look<'_>) -> String {
    const NOT_IN_HISTORY: &str = " (not in history)";
    let marker = match last.status {
        LastStatus::Agreed => "",
        LastStatus::Unverified => " (unverified)",
        LastStatus::NotInHistory => NOT_IN_HISTORY,
    };
    let quote = |text: &str, marker: &str, room: usize| {
        let width = room.saturating_sub(2 + marker.len()).max(MIN_PROMPT);
        format!(
            "\"{}\"{}",
            render::shorten(render::clean(text).trim(), width),
            look.paint(MISSING, marker)
        )
    };
    match &last.later {
        None => format!("  {}", quote(&last.text, marker, room)),
        Some(later) => {
            let half = room.saturating_sub(4) / 2;
            format!(
                "  {}  {}",
                quote(&last.text, marker, half),
                quote(later, NOT_IN_HISTORY, half)
            )
        }
    }
}

/// Columns `s` takes.
fn len(s: &str) -> usize {
    s.chars().count()
}

/// R4: say what was searched.
fn no_match_message(args: &SessionsArgs, env: &Env, o: &Outcome) -> String {
    let mut filters = common::select_filters(&args.select);
    if let Some(n) = args.output.limit {
        filters.push(format!("--limit {n}"));
    }
    format!(
        "clrg sessions: no session matched\n  searched {} file(s) in stores: transcripts\n{}  roots: {}\n  filters: {}\n",
        o.files_searched,
        common::unreadable_text(o),
        common::roots_text(&env.roots, o),
        common::filters_text(&filters),
    )
}
