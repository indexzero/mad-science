//! `clrg facets <field>`: the distinct values of one field across the
//! selected messages, with how many sessions and messages carry each, most
//! messages first. Messages with no value count under `(none)`.
//!
//! ```text
//! VALUE             SESSIONS  MESSAGES  FIRST             LAST
//! main                     2        14  2026-08-01 10:00  2026-08-02 14:31
//! ```

use std::io::{self, Write};

use clrg_core::{CatalogOptions, Facet, FacetField, Outcome};
use serde::Serialize;
use serde_json::Value;

use crate::cli::{FacetsArgs, Field, Format, GlobalArgs};
use crate::commands::{NotImplemented, UsageError};
use crate::common::{self, Env};
use crate::exit;
use crate::render::{self, Look};

/// The record fields, in order: the spec's FIELDS for `facets`.
pub const FIELDS: [&str; 5] = ["value", "sessions", "messages", "first_ts", "last_ts"];

/// How a message with no value for the field is shown.
pub const NONE: &str = "(none)";

#[derive(Serialize)]
struct Record<'a> {
    value: &'a str,
    sessions: u64,
    messages: u64,
    first_ts: Option<String>,
    last_ts: Option<String>,
}

fn field(f: Field) -> (FacetField, &'static str) {
    match f {
        Field::Branch => (FacetField::Branch, "branch"),
        Field::Cwd => (FacetField::Cwd, "cwd"),
        Field::Project => (FacetField::Project, "project"),
        Field::Model => (FacetField::Model, "model"),
        Field::CliVersion => (FacetField::CliVersion, "cli-version"),
        Field::Tool => (FacetField::Tool, "tool"),
        Field::Root => (FacetField::Root, "root"),
        Field::Day => (FacetField::Day, "day"),
    }
}

pub fn run(global: &GlobalArgs, args: &FacetsArgs) -> anyhow::Result<u8> {
    if args.select.infer_branch {
        return Err(NotImplemented("facets --infer-branch").into());
    }
    let fields = match (&args.output.fields, args.format) {
        (Some(_), Format::Human) => {
            return Err(NotImplemented("facets --fields with --format human").into());
        }
        (Some(f), Format::Tsv) => common::parse_fields(f, &FIELDS)?,
        (None, Format::Tsv) => FIELDS.to_vec(),
        (Some(_), _) => return Err(UsageError("--fields applies to --format tsv".into()).into()),
        (None, _) => Vec::new(),
    };
    let sort = common::parse_sort(args.output.sort.as_deref(), &FIELDS)?;
    let (facet_field, name) = field(args.field);
    let env = Env::new(global);
    let opts = CatalogOptions {
        roots: env.roots.clone(),
        selectors: common::selectors(&args.select, &env)?,
    };
    let (mut rows, outcome) = clrg_core::catalog::facets(&opts, facet_field, env.offset)
        .map_err(|e| UsageError(e.to_string()))?;

    // Most messages first, then by value, with `(none)` after the values.
    rows.sort_by(|a, b| {
        b.messages
            .cmp(&a.messages)
            .then_with(|| a.value.is_none().cmp(&b.value.is_none()))
            .then_with(|| a.value.cmp(&b.value))
    });
    let mut records: Vec<(Value, Facet)> = rows
        .into_iter()
        .map(|f| {
            let r = Record {
                value: f.value.as_deref().unwrap_or(NONE),
                sessions: f.sessions,
                messages: f.messages,
                first_ts: f.first_ts.and_then(clrg_core::format_ts),
                last_ts: f.last_ts.and_then(clrg_core::format_ts),
            };
            (serde_json::to_value(r).unwrap_or(Value::Null), f)
        })
        .collect();
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
    let cwd_like = matches!(args.field, Field::Cwd | Field::Root);
    let printed = common::write_stdout(|mut out| {
        let values: Vec<Value> = records.iter().map(|r| r.0.clone()).collect();
        match args.format {
            Format::Human => human(&mut out, &records, &look, cwd_like),
            Format::Json => common::json(&mut out, &values, false),
            Format::Jsonl => common::json(&mut out, &values, true),
            Format::Tsv => common::tsv(&mut out, &values, &fields, end),
            Format::Values => values_lines(&mut out, &records, &look, end),
        }
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
    eprint!("{}", no_match_message(name, args, &env, &outcome));
    Ok(exit::NO_MATCH)
}

/// `value:description` lines for shell completion, e.g.
/// `main:12 sessions, last 2026-08-02`. A `:` in the value is escaped as
/// `\:`. Messages with no value are left out.
fn values_lines(
    out: &mut impl Write,
    records: &[(Value, Facet)],
    look: &Look<'_>,
    end: u8,
) -> io::Result<()> {
    for (_, f) in records {
        let Some(v) = &f.value else { continue };
        let value = render::clean(v).replace(':', "\\:");
        let plural = if f.sessions == 1 { "" } else { "s" };
        let last = f
            .last_ts
            .and_then(|ms| look.date(ms))
            .map_or_else(String::new, |d| format!(", last {d}"));
        out.write_all(format!("{value}:{} session{plural}{last}", f.sessions).as_bytes())?;
        out.write_all(&[end])?;
    }
    Ok(())
}

/// An aligned table under a header row.
fn human(
    out: &mut impl Write,
    records: &[(Value, Facet)],
    look: &Look<'_>,
    cwd_like: bool,
) -> io::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let when = |ms: Option<i64>| ms.and_then(|ms| look.date_time(ms)).unwrap_or_default();
    let rows: Vec<[String; 5]> = records
        .iter()
        .map(|(_, f)| {
            let value = match &f.value {
                None => NONE.to_string(),
                Some(v) if cwd_like => look.tilde(v),
                Some(v) => render::clean(v),
            };
            [
                value,
                f.sessions.to_string(),
                f.messages.to_string(),
                when(f.first_ts),
                when(f.last_ts),
            ]
        })
        .collect();
    let head = ["VALUE", "SESSIONS", "MESSAGES", "FIRST", "LAST"].map(str::to_string);
    let mut w = [0usize; 5];
    for r in std::iter::once(&head).chain(&rows) {
        for (i, c) in r.iter().enumerate() {
            w[i] = w[i].max(c.chars().count());
        }
    }
    for r in std::iter::once(&head).chain(&rows) {
        let pad = |i: usize| w[i].saturating_sub(r[i].chars().count());
        let line = format!(
            "{}{}  {}{}  {}{}  {}{}  {}",
            r[0],
            " ".repeat(pad(0)),
            " ".repeat(pad(1)),
            r[1],
            " ".repeat(pad(2)),
            r[2],
            r[3],
            " ".repeat(pad(3)),
            r[4],
        );
        writeln!(out, "{}", line.trim_end())?;
    }
    Ok(())
}

/// R4: say what was searched.
fn no_match_message(name: &str, args: &FacetsArgs, env: &Env, o: &Outcome) -> String {
    let mut filters = common::select_filters(&args.select);
    if let Some(n) = args.output.limit {
        filters.push(format!("--limit {n}"));
    }
    format!(
        "clrg facets: no message selected to count {name} values\n  searched {} file(s) in stores: transcripts\n{}  roots: {}\n  filters: {}\n",
        o.files_searched,
        common::unreadable_text(o),
        common::roots_text(&env.roots, o),
        common::filters_text(&filters),
    )
}
