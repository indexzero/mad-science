//! `clrg files`: one row per path that the selected messages wrote, edited,
//! or read, with what clrg knows about its content (see
//! `clrg_core::evidence`).
//!
//! ```text
//! LAST              OUTCOME   RECOVERABLE  VERSIONS  OPS                SESSIONS  PATH
//! 2026-08-02 14:09  returned  full                2  rejected,returned  00000051  /work/app/SUMMARY.md
//! ```

use std::io::{self, Write};
use std::path::Path;

use clrg_core::Outcome;
use clrg_core::evidence::{self, Event, EventKind, EvidenceOptions, PathEvidence, Sources};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{FilesArgs, Format, GlobalArgs, Op};
use crate::commands::{NotImplemented, UsageError};
use crate::common::{self, Env};
use crate::exit;
use crate::render::{self, Look};

/// The record fields, in order: the spec's FIELDS for `files`.
pub const FIELDS: [&str; 12] = [
    "path",
    "cwd",
    "ops",
    "first_ts",
    "last_ts",
    "sessions",
    "branches",
    "versions",
    "outcome",
    "recoverable",
    "root",
    "roots",
];

/// One path record. The field order is [`FIELDS`].
#[derive(Serialize)]
struct Record<'a> {
    path: String,
    cwd: Option<&'a str>,
    ops: Vec<&'static str>,
    first_ts: Option<String>,
    last_ts: Option<String>,
    sessions: Vec<&'a str>,
    branches: Vec<&'a str>,
    versions: usize,
    outcome: &'static str,
    recoverable: &'static str,
    /// The first of `roots` (kept for compatibility).
    root: String,
    /// Every root the path's events came from (one timeline across roots).
    roots: Vec<String>,
}

/// Whether `e` is one of the operations `--op` counts. `write` includes
/// rejected writes and returned text; `edit` includes rejected edits.
fn counted(e: &Event, ops: &[Op]) -> bool {
    ops.iter().any(|op| match op {
        Op::Write => e.is_write() || e.kind == EventKind::Returned,
        Op::Edit => e.kind == EventKind::Edit || (e.kind == EventKind::Rejected && !e.is_write()),
        Op::Read => e.kind == EventKind::Read,
        Op::Bash => false,
    })
}

/// `path` relative to `cwd` when it is inside it.
fn relative(path: &str, cwd: Option<&str>) -> String {
    cwd.and_then(|c| Path::new(path).strip_prefix(c).ok())
        .filter(|r| !r.as_os_str().is_empty())
        .map_or_else(|| path.to_string(), |r| r.display().to_string())
}

fn record(env: &Env, p: &PathEvidence, relative_paths: bool) -> Value {
    let states = p.replay(Sources::Best);
    let (first, last) = p.span();
    let r = Record {
        path: if relative_paths {
            relative(&p.path, p.cwd())
        } else {
            p.path.clone()
        },
        cwd: p.cwd(),
        ops: p.ops().into_iter().map(EventKind::as_str).collect(),
        first_ts: first.and_then(clrg_core::format_ts),
        last_ts: last.and_then(clrg_core::format_ts),
        sessions: p.sessions(),
        branches: p.branches(),
        versions: evidence::versions(&states),
        outcome: p.outcome().as_str(),
        recoverable: evidence::recoverable(&states).as_str(),
        root: env.roots[p.root()].to_string_lossy().into_owned(),
        roots: p
            .roots
            .iter()
            .map(|&i| env.roots[i].to_string_lossy().into_owned())
            .collect(),
    };
    serde_json::to_value(r).unwrap_or(Value::Null)
}

pub fn run(global: &GlobalArgs, args: &FilesArgs) -> anyhow::Result<u8> {
    if args.select.infer_branch {
        return Err(NotImplemented("files --infer-branch").into());
    }
    if args.op.contains(&Op::Bash) {
        return Err(NotImplemented("files --op bash").into());
    }
    let fields = match (&args.output.fields, args.format) {
        (Some(_), Format::Human) => {
            return Err(NotImplemented("files --fields with --format human").into());
        }
        (Some(f), Format::Tsv) => common::parse_fields(f, &FIELDS)?,
        (None, Format::Tsv) => FIELDS.to_vec(),
        (Some(_), _) => return Err(UsageError("--fields applies to --format tsv".into()).into()),
        (None, _) => Vec::new(),
    };
    let sort = common::parse_sort(args.output.sort.as_deref(), &FIELDS)?;
    let counted_ops: Vec<Op> = if args.op.is_empty() {
        vec![Op::Write, Op::Edit]
    } else {
        args.op.clone()
    };
    let env = Env::new(global);
    let opts = EvidenceOptions {
        roots: env.roots.clone(),
        selectors: common::selectors(&args.select, &env)?,
        paths: args.path.clone(),
    };
    let (paths, outcome) = evidence::collect(&opts).map_err(|e| UsageError(e.to_string()))?;

    let mut records: Vec<Value> = paths
        .iter()
        .filter(|p| p.events.iter().any(|e| counted(e, &counted_ops)))
        .filter(|p| !args.created_only || p.created())
        .map(|p| record(&env, p, args.relative))
        .collect();
    if let Some((field, desc)) = sort {
        records.sort_by(|a, b| {
            let o = common::cmp_values(&a[field], &b[field]);
            if desc { o.reverse() } else { o }
        });
    }
    records.truncate(args.output.limit.unwrap_or(usize::MAX));
    let found = !records.is_empty();

    let look = env.look(global);
    let end = if args.output.null { b'\0' } else { b'\n' };
    let printed = common::write_stdout(|mut out| match args.format {
        Format::Human => human(&mut out, &records, &look, args.relative),
        Format::Json => common::json(&mut out, &records, false),
        Format::Jsonl => common::json(&mut out, &records, true),
        Format::Tsv => common::tsv(&mut out, &records, &fields, end),
        Format::Values => values_lines(&mut out, &records, end),
    })?;
    if !printed {
        return Ok(exit::MATCHED);
    }
    if let Some(code) = common::settle(global, &env.roots, &outcome) {
        return Ok(code);
    }
    if found {
        return Ok(exit::MATCHED);
    }
    eprint!("{}", no_match_message(args, &counted_ops, &env, &outcome));
    Ok(exit::NO_MATCH)
}

/// Bare paths, one per record.
fn values_lines(out: &mut impl Write, records: &[Value], end: u8) -> io::Result<()> {
    for r in records {
        out.write_all(common::scrub(r["path"].as_str().unwrap_or("")).as_bytes())?;
        out.write_all(&[end])?;
    }
    Ok(())
}

/// An aligned table under a header row; the path is last.
fn human(
    out: &mut impl Write,
    records: &[Value],
    look: &Look<'_>,
    relative: bool,
) -> io::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let text = |v: &Value| v.as_str().unwrap_or("").to_string();
    let list = |v: &Value, f: fn(&str) -> String| {
        v.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(f)
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .unwrap_or_default()
    };
    let rows: Vec<[String; 7]> = records
        .iter()
        .map(|r| {
            let path = text(&r["path"]);
            [
                r["last_ts"]
                    .as_str()
                    .and_then(clrg_core::parse_ts)
                    .and_then(|ms| look.date_time(ms))
                    .unwrap_or_default(),
                text(&r["outcome"]),
                text(&r["recoverable"]),
                r["versions"].to_string(),
                list(&r["ops"], str::to_string),
                list(&r["sessions"], render::short_id),
                if relative {
                    render::clean(&path)
                } else {
                    look.tilde(&path)
                },
            ]
        })
        .collect();
    let head = [
        "LAST",
        "OUTCOME",
        "RECOVERABLE",
        "VERSIONS",
        "OPS",
        "SESSIONS",
        "PATH",
    ]
    .map(str::to_string);
    let mut w = [0usize; 7];
    for r in std::iter::once(&head).chain(&rows) {
        for (i, c) in r.iter().enumerate() {
            w[i] = w[i].max(c.chars().count());
        }
    }
    for r in std::iter::once(&head).chain(&rows) {
        let mut line = String::new();
        for (i, c) in r.iter().enumerate() {
            let pad = " ".repeat(w[i].saturating_sub(c.chars().count()));
            if i == 3 {
                // VERSIONS is a number: right-aligned.
                line.push_str(&pad);
                line.push_str(c);
            } else {
                line.push_str(c);
                line.push_str(&pad);
            }
            line.push_str("  ");
        }
        writeln!(out, "{}", line.trim_end())?;
    }
    Ok(())
}

/// R4: say what was searched.
fn no_match_message(args: &FilesArgs, ops: &[Op], env: &Env, o: &Outcome) -> String {
    let mut filters: Vec<String> = ops
        .iter()
        .map(|op| {
            format!(
                "--op {}",
                match op {
                    Op::Write => "write",
                    Op::Edit => "edit",
                    Op::Read => "read",
                    Op::Bash => "bash",
                }
            )
        })
        .collect();
    filters.extend(args.path.iter().map(|p| format!("--path {p}")));
    if args.created_only {
        filters.push("--created-only".into());
    }
    filters.extend(common::select_filters(&args.select));
    if let Some(n) = args.output.limit {
        filters.push(format!("--limit {n}"));
    }
    format!(
        "clrg files: no path matched\n  searched {} file(s) in stores: transcripts, file-history\n{}  roots: {}\n  filters: {}\n",
        o.files_searched,
        common::unreadable_text(o),
        common::roots_text(&env.roots, o),
        common::filters_text(&filters),
    )
}
