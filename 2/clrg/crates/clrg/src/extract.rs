//! `clrg extract`: write recovered file contents into `-o <dir>`, with
//! `MANIFEST.jsonl` recording where each file came from. The planning and
//! the safe writes are `clrg_core::extract`; this module resolves `-o`,
//! builds the records, and renders.
//!
//! ```text
//! wrote _work_app/pressure-test/SUMMARY.md  <- /work/app/pressure-test/SUMMARY.md  (v2 from returned, outcome returned, journal agree, similarity 1.00)
//! clrg extract: 4 file(s) in /tmp/out, with MANIFEST.jsonl
//!   outcome: 2 written, 1 rejected, 1 returned
//!   verified: 0 agree, 0 disagree
//!   1 newer rejected draft not extracted; use --version all:
//!     /work/app/notes.md
//!   not recoverable (1):
//!     diff-only  /work/app/src/edited-only.rs
//!   unsafe, skipped (1):
//!     ../x: its output path _work_app/../x would leave the output directory
//! ```

use std::io::{self, Write};
use std::path::PathBuf;

use clrg_core::Outcome;
use clrg_core::evidence::{
    self, EventKind, EvidenceOptions, FileOutcome, PathEvidence, Recoverable, Sources, Verified,
};
use clrg_core::extract::{self as plan, Layout, MANIFEST, OutDir, Which};
use serde::Serialize;
use sha2::{Digest as _, Sha256};

use crate::cli::{self, ExtractArgs, ExtractFormat, GlobalArgs};
use crate::commands::{NotImplemented, UsageError};
use crate::common::{self, Env, scrub};
use crate::exit;

/// The manifest fields, in order (INTENT "clrg extract").
#[cfg(test)]
const FIELDS: [&str; 15] = [
    "path",
    "out_path",
    "session",
    "agent_id",
    "root",
    "roots",
    "version",
    "ts",
    "source_event",
    "outcome",
    "verified",
    "similarity",
    "journal",
    "sha256",
    "bytes",
];

/// One written file. The field order is [`FIELDS`].
#[derive(Serialize)]
struct Record<'a> {
    path: &'a str,
    out_path: String,
    session: Option<&'a str>,
    agent_id: Option<&'a str>,
    /// The first of `roots` (kept for compatibility).
    root: String,
    /// Every root the path's events came from.
    roots: Vec<String>,
    version: usize,
    ts: Option<String>,
    source_event: &'static str,
    outcome: &'static str,
    verified: Option<&'static str>,
    similarity: Option<f64>,
    journal: Option<&'static str>,
    sha256: String,
    bytes: usize,
}

/// What was requested and cannot be written: (`diff-only` or `none`, path).
type Missing = Vec<(Recoverable, String)>;

/// What the plan left out besides [`Missing`].
#[derive(Default)]
struct Skipped {
    /// Paths with no safe output path: why (exit 4).
    unsafe_paths: Vec<String>,
    /// `--version last`: (newer rejected drafts not written, path).
    drafts: Vec<(usize, String)>,
}

/// A planned file: the record, its path under `<dir>`, and its bytes.
struct Planned<'a> {
    record: Record<'a>,
    rel: PathBuf,
    content: Vec<u8>,
}

pub fn run(global: &GlobalArgs, args: &ExtractArgs) -> anyhow::Result<u8> {
    if args.select.infer_branch {
        return Err(NotImplemented("extract --infer-branch").into());
    }
    let env = Env::new(global);
    // -o first: a refused destination is refused whatever the selection.
    let out_abs = common::expand(&args.out, env.home.as_deref(), env.cwd.as_deref());
    let out = plan::check_out(&out_abs, &env.roots).map_err(UsageError)?;
    let opts = EvidenceOptions {
        roots: env.roots.clone(),
        selectors: common::selectors(&args.select, &env)?,
        paths: args.path.clone(),
    };
    let (paths, outcome) = evidence::collect(&opts).map_err(|e| UsageError(e.to_string()))?;
    // The paths `clrg files` lists by default: a write-family event.
    let selected: Vec<&PathEvidence> = paths
        .iter()
        .filter(|p| {
            p.events
                .iter()
                .any(|e| e.kind != EventKind::Read && e.kind != EventKind::Backup)
        })
        .filter(|p| !args.created_only || p.created())
        .collect();
    if let Some(code) = common::settle(global, &env.roots, &outcome) {
        return Ok(code);
    }
    if selected.is_empty() {
        eprint!("{}", no_match_message(args, &env, &outcome));
        return Ok(exit::NO_MATCH);
    }

    let (mut planned, missing, skipped) = build_plan(args, &env, &selected);
    // Every final path (collisions suffixed) is decided before any write.
    let rels: Vec<PathBuf> = planned.iter().map(|p| p.rel.clone()).collect();
    for (p, rel) in planned.iter_mut().zip(plan::plan_paths(&rels)) {
        p.record.out_path = out.path.join(&rel).to_string_lossy().into_owned();
        p.rel = rel;
    }

    let manifest = args.manifest && !args.no_manifest;
    if !args.dry_run && !planned.is_empty() {
        plan::create_out(&out)?;
        for p in &planned {
            plan::write_new(&out.path, &p.rel, &p.content)?;
        }
        if manifest {
            let mut lines = Vec::new();
            for p in &planned {
                serde_json::to_writer(&mut lines, &p.record)?;
                lines.push(b'\n');
            }
            plan::write_new(&out.path, std::path::Path::new(MANIFEST), &lines)?;
        }
    }

    let printed = common::write_stdout(|out_w| match args.format {
        ExtractFormat::Human => human(out_w, args, &out, &planned, &missing, &skipped, manifest),
        ExtractFormat::Jsonl => {
            for p in &planned {
                serde_json::to_writer(&mut *out_w, &p.record)?;
                out_w.write_all(b"\n")?;
            }
            Ok(())
        }
    })?;
    if args.format == ExtractFormat::Jsonl || !printed {
        for (rec, path) in &missing {
            eprintln!(
                "clrg extract: not recoverable: {} {}",
                rec.as_str(),
                scrub(path)
            );
        }
        for why in &skipped.unsafe_paths {
            eprintln!("clrg extract: unsafe path skipped: {}", scrub(why));
        }
        for (n, path) in &skipped.drafts {
            eprintln!(
                "clrg extract: {n} newer rejected draft(s) not extracted; use --version all: {}",
                scrub(path)
            );
        }
    }
    Ok(if missing.is_empty() && skipped.unsafe_paths.is_empty() {
        exit::MATCHED
    } else {
        exit::UNRECOVERABLE
    })
}

/// Choose each path's states and compute where they go. Returns the planned
/// files, what was requested but cannot be written, and what was skipped. A
/// path with no safe output path is skipped and listed; the rest are
/// planned. `out_path` is filled in once the final paths are decided.
fn build_plan<'a>(
    args: &ExtractArgs,
    env: &Env,
    selected: &[&'a PathEvidence],
) -> (Vec<Planned<'a>>, Missing, Skipped) {
    let sources = match args.source {
        cli::Source::Best => Sources::Best,
        cli::Source::FileHistory => Sources::FileHistory,
        cli::Source::Transcript => Sources::Transcript,
    };
    let which = match args.version {
        cli::Which::First => Which::First,
        cli::Which::Last => Which::Last,
        cli::Which::All => Which::All,
    };
    let layout = match args.layout {
        cli::Layout::Cwd => Layout::Cwd,
        cli::Layout::Absolute => Layout::Absolute,
        cli::Layout::Session => Layout::Session,
    };
    let mut planned = Vec::new();
    let mut missing: Missing = Vec::new();
    let mut skipped = Skipped::default();
    let root = |i: usize| env.roots[i].to_string_lossy().into_owned();
    for p in selected {
        let states = p.replay(sources);
        let choice = plan::choose(&states, which);
        if choice.newer_rejected > 0 {
            skipped.drafts.push((choice.newer_rejected, p.path.clone()));
        }
        for m in choice.missing {
            if !missing.iter().any(|(r, path)| *r == m && *path == p.path) {
                missing.push((m, p.path.clone()));
            }
        }
        for (i, n) in choice.write {
            let s = &states[i];
            let e = &p.events[s.event];
            let rel = match plan::out_rel(layout, &p.path, e.cwd.as_deref(), e.session.as_deref()) {
                Ok(r) if which == Which::All => plan::with_version(&r, n),
                Ok(r) => r,
                Err(why) => {
                    if !skipped.unsafe_paths.contains(&why) {
                        skipped.unsafe_paths.push(why);
                    }
                    continue;
                }
            };
            let content = s.content.clone().unwrap_or_default();
            let record = Record {
                path: &p.path,
                out_path: String::new(),
                session: e.session.as_deref(),
                agent_id: e.agent_id.as_deref(),
                root: root(p.root()),
                roots: p.roots.iter().map(|&i| root(i)).collect(),
                version: n,
                ts: e.ts.and_then(clrg_core::format_ts),
                source_event: s.kind.as_str(),
                outcome: plan::state_outcome(e).as_str(),
                verified: s.verified.map(Verified::as_str),
                similarity: e.similarity,
                journal: e.journal.map(evidence::Journal::as_str),
                sha256: format!("{:x}", Sha256::digest(&content)),
                bytes: content.len(),
            };
            planned.push(Planned {
                record,
                rel,
                content,
            });
        }
    }
    (planned, missing, skipped)
}

/// One line per file, then the counts and what was not recoverable.
fn human(
    w: &mut dyn Write,
    args: &ExtractArgs,
    out: &OutDir,
    planned: &[Planned],
    missing: &[(Recoverable, String)],
    skipped: &Skipped,
    manifest: bool,
) -> io::Result<()> {
    let verb = if args.dry_run { "would write" } else { "wrote" };
    for p in planned {
        let r = &p.record;
        let mut labels = vec![
            format!("v{} from {}", r.version, r.source_event),
            format!("outcome {}", r.outcome),
        ];
        labels.extend(r.verified.map(|v| format!("verified {v}")));
        labels.extend(r.journal.map(|j| format!("journal {j}")));
        labels.extend(r.similarity.map(|s| format!("similarity {s:.2}")));
        writeln!(
            w,
            "{verb} {}  <- {}  ({})",
            scrub(&p.rel.to_string_lossy()),
            scrub(r.path),
            labels.join(", ")
        )?;
    }
    let count = |o: FileOutcome| {
        planned
            .iter()
            .filter(|p| p.record.outcome == o.as_str())
            .count()
    };
    let verified = |v: Verified| {
        planned
            .iter()
            .filter(|p| p.record.verified == Some(v.as_str()))
            .count()
    };
    let dir = scrub(&out.path.to_string_lossy());
    let n = planned.len();
    if args.dry_run {
        writeln!(
            w,
            "clrg extract: dry run: would write {n} file(s) in {dir}; nothing was written"
        )?;
    } else if n == 0 {
        writeln!(w, "clrg extract: 0 files; {dir} was not created")?;
    } else if manifest {
        writeln!(w, "clrg extract: {n} file(s) in {dir}, with {MANIFEST}")?;
    } else {
        writeln!(w, "clrg extract: {n} file(s) in {dir}")?;
    }
    let unknown = match count(FileOutcome::Unknown) {
        0 => String::new(),
        n => format!(", {n} unknown"),
    };
    writeln!(
        w,
        "  outcome: {} written, {} rejected, {} returned{unknown}",
        count(FileOutcome::Written),
        count(FileOutcome::Rejected),
        count(FileOutcome::Returned)
    )?;
    writeln!(
        w,
        "  verified: {} agree, {} disagree",
        verified(Verified::Agree),
        verified(Verified::Disagree)
    )?;
    let drafts: usize = skipped.drafts.iter().map(|(n, _)| n).sum();
    if drafts > 0 {
        let s = if drafts == 1 { "" } else { "s" };
        writeln!(
            w,
            "  {drafts} newer rejected draft{s} not extracted; use --version all:"
        )?;
        for (_, path) in &skipped.drafts {
            writeln!(w, "    {}", scrub(path))?;
        }
    }
    if !missing.is_empty() {
        writeln!(w, "  not recoverable ({}):", missing.len())?;
        for (rec, path) in missing {
            writeln!(w, "    {:<9}  {}", rec.as_str(), scrub(path))?;
        }
    }
    if !skipped.unsafe_paths.is_empty() {
        writeln!(w, "  unsafe, skipped ({}):", skipped.unsafe_paths.len())?;
        for why in &skipped.unsafe_paths {
            writeln!(w, "    {}", scrub(why))?;
        }
    }
    Ok(())
}

/// R4: say what was searched.
fn no_match_message(args: &ExtractArgs, env: &Env, o: &Outcome) -> String {
    let mut filters: Vec<String> = args.path.iter().map(|p| format!("--path {p}")).collect();
    if args.created_only {
        filters.push("--created-only".into());
    }
    filters.extend(common::select_filters(&args.select));
    format!(
        "clrg extract: no path matched (nothing was written)\n  searched {} file(s) in stores: transcripts, file-history\n{}  roots: {}\n  filters: {}\n",
        o.files_searched,
        common::unreadable_text(o),
        common::roots_text(&env.roots, o),
        common::filters_text(&filters),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_fields_are_in_manifest_order() {
        let r = Record {
            path: "/w/a",
            out_path: "/o/w/a".into(),
            session: None,
            agent_id: None,
            root: "/r".into(),
            roots: vec!["/r".into()],
            version: 1,
            ts: None,
            source_event: "write",
            outcome: "written",
            verified: None,
            similarity: None,
            journal: None,
            sha256: String::new(),
            bytes: 0,
        };
        let text = serde_json::to_string(&r).unwrap();
        let at: Vec<usize> = FIELDS
            .iter()
            .map(|f| text.find(&format!("\"{f}\":")).unwrap())
            .collect();
        assert!(at.windows(2).all(|w| w[0] < w[1]), "{text}");
    }
}
