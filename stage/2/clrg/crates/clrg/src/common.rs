//! What every built command shares: the process environment the library may
//! not read (home, current folder, local offset), the `select` flagset
//! turned into [`Selectors`], `--fields`/`--sort` parsing, warnings, the
//! R4 summary of what was searched, and writing to stdout.

use std::cmp::Ordering;
use std::io::{self, IsTerminal as _, Write as _};
use std::path::{Path, PathBuf};

use clrg_core::select::parse_when;
use clrg_core::{Outcome, Selectors};
use serde_json::Value;
use time::UtcOffset;

use crate::cli::{GlobalArgs, Scope, SelectArgs};
use crate::commands::UsageError;
use crate::exit;
use crate::render::Look;

/// Columns when stdout is not a terminal.
const FALLBACK_WIDTH: usize = 100;

/// The process environment, read once by the bin and passed down.
pub struct Env {
    /// The local time offset.
    pub offset: UtcOffset,
    /// `HOME`, for `~`.
    pub home: Option<PathBuf>,
    /// The current folder.
    pub cwd: Option<PathBuf>,
    /// The roots, with `~` expanded.
    pub roots: Vec<PathBuf>,
}

impl Env {
    pub fn new(global: &GlobalArgs) -> Env {
        // Read the local offset first, while the process has one thread:
        // `time` refuses to read it once others are running.
        let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let cwd = std::env::current_dir().ok();
        let roots = global
            .root
            .iter()
            .map(|r| expand(r, home.as_deref(), None))
            .collect();
        Env {
            offset,
            home,
            cwd,
            roots,
        }
    }

    /// How to draw human output on stdout.
    pub fn look(&self, global: &GlobalArgs) -> Look<'_> {
        let tty = io::stdout().is_terminal();
        Look {
            color: global.color && !global.no_color && tty,
            width: if tty {
                terminal_size::terminal_size().map_or(FALLBACK_WIDTH, |(w, _)| usize::from(w.0))
            } else {
                FALLBACK_WIDTH
            },
            home: self.home.as_deref(),
            offset: self.offset,
            roots: &self.roots,
        }
    }
}

/// Expand a leading `~`, then make a relative path absolute against `cwd`.
pub fn expand(p: &Path, home: Option<&Path>, cwd: Option<&Path>) -> PathBuf {
    let expanded = match (p.strip_prefix("~"), home) {
        (Ok(rest), Some(h)) => h.join(rest),
        _ => p.to_path_buf(),
    };
    match cwd {
        Some(c) if expanded.is_relative() => c.join(expanded),
        _ => expanded,
    }
}

/// The `select` flagset as library selectors.
pub fn selectors(s: &SelectArgs, env: &Env) -> Result<Selectors, UsageError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
    let when = |flag, v: &Option<String>| {
        v.as_deref()
            .map(|v| parse_when(flag, v, now))
            .transpose()
            .map_err(|e| UsageError(e.to_string()))
    };
    Ok(Selectors {
        branch: s.branch.clone(),
        branch_glob: s.branch_glob.clone(),
        cwd: s
            .cwd
            .iter()
            .map(|p| expand(p, env.home.as_deref(), env.cwd.as_deref()))
            .collect(),
        project: s.project.clone(),
        session: s.session.clone(),
        since: when("--since", &s.since)?,
        until: when("--until", &s.until)?,
        model: s.model.clone(),
        cli_version: s.cli_version.clone(),
        tool: s.tool.clone(),
        touched: s.touched.clone(),
        subagents: !s.no_subagents,
        scope: match s.scope {
            Scope::Message => clrg_core::Scope::Message,
            Scope::Session => clrg_core::Scope::Session,
        },
    })
}

/// Every `select` restriction on the command line, spelled as flags.
pub fn select_filters(s: &SelectArgs) -> Vec<String> {
    let mut out = Vec::new();
    let mut many = |flag: &str, vals: &[String]| {
        out.extend(vals.iter().map(|v| format!("{flag} {v}")));
    };
    many("--branch", &s.branch);
    many("--branch-glob", &s.branch_glob);
    many(
        "--cwd",
        &s.cwd
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>(),
    );
    many("--project", &s.project);
    many("--session", &s.session);
    many("--since", s.since.as_slice());
    many("--until", s.until.as_slice());
    many("--model", &s.model);
    many("--cli-version", s.cli_version.as_slice());
    many("--tool", &s.tool);
    many("--touched", &s.touched);
    if s.no_subagents {
        out.push("--no-subagents".into());
    }
    if s.scope == Scope::Session {
        out.push("--scope session".into());
    }
    out
}

/// `filters` as one R4 line value.
pub fn filters_text(filters: &[String]) -> String {
    if filters.is_empty() {
        "none".to_string()
    } else {
        filters.join(" ")
    }
}

/// The roots as one R4 line value, each missing one marked.
pub fn roots_text(roots: &[PathBuf], o: &Outcome) -> String {
    roots
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let missing = if o.missing_roots.contains(&i) {
                " (missing)"
            } else {
                ""
            };
            format!("{}{missing}", r.display())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// Parse `--fields` against `valid`. Unknown names are an error naming the
/// valid ones.
pub fn parse_fields<'a>(list: &'a str, valid: &[&str]) -> Result<Vec<&'a str>, UsageError> {
    let fields: Vec<&str> = list.split(',').map(str::trim).collect();
    match fields.iter().find(|f| !valid.contains(f)) {
        Some(bad) => Err(UsageError(format!(
            "unknown field {bad:?} for --fields (valid: {})",
            valid.join(", ")
        ))),
        None => Ok(fields),
    }
}

/// Parse `--sort` against `valid`: the field and whether it descends.
pub fn parse_sort<'a>(
    sort: Option<&'a str>,
    valid: &[&str],
) -> Result<Option<(&'a str, bool)>, UsageError> {
    let Some(s) = sort else { return Ok(None) };
    let (name, desc) = s.strip_prefix('-').map_or((s, false), |n| (n, true));
    if valid.contains(&name) {
        Ok(Some((name, desc)))
    } else {
        Err(UsageError(format!(
            "unknown field {name:?} for --sort (valid: {})",
            valid.join(", ")
        )))
    }
}

/// Order two record values for `--sort`: null first, then booleans,
/// numbers, and strings (lists compare by their joined text).
pub fn cmp_values(a: &Value, b: &Value) -> Ordering {
    fn rank(v: &Value) -> u8 {
        match v {
            Value::Null => 0,
            Value::Bool(_) => 1,
            Value::Number(_) => 2,
            _ => 3,
        }
    }
    match (a, b) {
        (Value::Bool(x), Value::Bool(y)) => x.cmp(y),
        (Value::Number(x), Value::Number(y)) => x
            .as_f64()
            .partial_cmp(&y.as_f64())
            .unwrap_or(Ordering::Equal),
        (Value::Null, Value::Null) => Ordering::Equal,
        _ if rank(a) != rank(b) => rank(a).cmp(&rank(b)),
        _ => cell(Some(a)).cmp(&cell(Some(b))),
    }
}

/// `s` with every control character (C0, DEL, and C1: tab, newline, NUL,
/// escape, ...) replaced by a space, so data can never break a line-based
/// format or send a terminal escape. For tsv cells and `values` lines.
pub fn scrub(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

/// The R4 lines for files that failed to read and for symlinks that were
/// not followed (R3), or nothing when there were none.
pub fn unreadable_text(o: &Outcome) -> String {
    let mut lines = Vec::new();
    if o.unreadable > 0 {
        lines.push(format!("  unreadable: {} file(s)\n", o.unreadable));
    }
    if o.skipped_symlinks > 0 {
        lines.push(format!("  {}\n", symlinks_text(o.skipped_symlinks)));
    }
    lines.concat()
}

/// What clrg says about the symlinks it did not follow (R3).
pub fn symlinks_text(n: u64) -> String {
    format!("skipped {n} symlink(s) (not followed)")
}

/// A record value as one tsv cell: no control characters (see [`scrub`]);
/// lists joined with commas; null empty.
pub fn cell(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => scrub(s),
        Some(Value::Array(items)) => items
            .iter()
            .map(|i| cell(Some(i)).replace(',', " "))
            .collect::<Vec<_>>()
            .join(","),
        Some(other) => other.to_string(),
    }
}

/// A header row, then one row per record, with the chosen fields.
pub fn tsv(
    out: &mut impl io::Write,
    records: &[Value],
    fields: &[&str],
    end: u8,
) -> io::Result<()> {
    out.write_all(fields.join("\t").as_bytes())?;
    out.write_all(&[end])?;
    for v in records {
        let cells: Vec<String> = fields.iter().map(|f| cell(v.get(*f))).collect();
        out.write_all(cells.join("\t").as_bytes())?;
        out.write_all(&[end])?;
    }
    Ok(())
}

/// One JSON object per line, or one JSON array.
pub fn json(out: &mut impl io::Write, records: &[Value], lines: bool) -> io::Result<()> {
    if lines {
        for v in records {
            serde_json::to_writer(&mut *out, v)?;
            out.write_all(b"\n")?;
        }
        Ok(())
    } else {
        serde_json::to_writer(&mut *out, records)?;
        out.write_all(b"\n")
    }
}

/// Write to a buffered stdout. A closed pipe is not an error: it returns
/// `Ok(false)`, and the command exits 0.
pub fn write_stdout(f: impl FnOnce(&mut dyn io::Write) -> io::Result<()>) -> io::Result<bool> {
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    match f(&mut out).and_then(|()| out.flush()) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::BrokenPipe => Ok(false),
        Err(e) => Err(e),
    }
}

/// Print warnings, then the exit code that the outcome forces, if any:
/// `--strict` with trouble exits 3.
pub fn settle(global: &GlobalArgs, roots: &[PathBuf], o: &Outcome) -> Option<u8> {
    warn(global, roots, o);
    let trouble = o.bad_lines > 0 || !o.errors.is_empty() || !o.missing_roots.is_empty();
    (global.strict && trouble).then_some(exit::UNREADABLE)
}

fn warn(global: &GlobalArgs, roots: &[PathBuf], o: &Outcome) {
    if global.quiet {
        return;
    }
    for &i in &o.missing_roots {
        eprintln!("clrg: root not found: {}", roots[i].display());
    }
    for e in &o.errors {
        eprintln!("clrg: {e}");
    }
    if o.skipped_symlinks > 0 {
        eprintln!("clrg: {}", symlinks_text(o.skipped_symlinks));
    }
    if o.bad_lines > 0 {
        eprintln!(
            "clrg: skipped {} unparsable line(s) in {} file(s){}",
            o.bad_lines,
            o.bad_files.len(),
            if global.strict {
                ""
            } else {
                " (--strict makes this exit 3)"
            }
        );
        if global.verbose > 0 {
            for f in &o.bad_files {
                eprintln!("clrg:   {}", f.display());
            }
        }
    }
}

/// The stderr line (R10) with the disagreements among the results: the
/// `user/text` records with no agreeing history line, and the history
/// records with no agreeing `user/text` line.
pub fn agreement_line(transcript_only: u64, history_only: u64) -> String {
    format!(
        "clrg: agreement: {transcript_only} transcript-only, {history_only} history-only (user/text vs history.jsonl; see --agree)"
    )
}
