//! `clrg grep`: resolve the command line into a query, run the engine,
//! group the hits by session in R5 order (which also checks `user/text` and
//! `history` hits against each other, R10), narrow them by `--agree`, then
//! print them as human blocks (`render.rs`), records (`records.rs`), or bare
//! paths (`-l`).

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use clrg_core::{
    Agreement, CaseMode, ContextMessage, Group, Hit, InSelector, Outcome, Query, SearchOptions,
    StoreKind,
};

use crate::cli::{Agree, Format, GlobalArgs, GrepArgs, Store};
use crate::commands::{NotImplemented, UsageError};
use crate::common::{self, Env};
use crate::exit;
use crate::records::{self, Records};
use crate::render::{self, Look};

/// One thing to print: a hit, or (with `-C`) a message around one.
pub enum Item<'a> {
    Hit(&'a Hit),
    Context {
        path: &'a Path,
        msg: &'a ContextMessage,
    },
}

/// An [`Item`] and the index of its block in the groups.
pub struct Row<'a> {
    pub group: usize,
    pub item: Item<'a>,
}

/// What the output options resolved to, checked before the search runs.
struct Plan<'a> {
    fields: Vec<&'a str>,
    sort: Option<(&'a str, bool)>,
}

pub fn run(global: &GlobalArgs, args: &GrepArgs) -> anyhow::Result<u8> {
    let pattern = check_supported(args)?;
    let plan = plan(args)?;
    let env = Env::new(global);
    let query = Query {
        pattern: pattern.to_string(),
        regex: args.regex,
        case: if args.ignore_case {
            CaseMode::Insensitive
        } else if args.case_sensitive {
            CaseMode::Sensitive
        } else {
            CaseMode::Smart
        },
    };
    let opts = SearchOptions {
        roots: env.roots.clone(),
        stores: args.store.iter().map(|s| store_kind(*s)).collect(),
        ins: in_selectors(&args.ins)?,
        selectors: common::selectors(&args.select, &env)?,
        parse_all: global.strict,
        // `-l` needs no session context unless `--agree` narrows the hits.
        headers: !(args.files_with_matches && args.agree.is_empty()),
    };
    let mut outcome = clrg_core::search(&query, &opts).map_err(|e| UsageError(e.to_string()))?;
    let hits = std::mem::take(&mut outcome.hits);
    let known = std::mem::take(&mut outcome.infos);

    let look = env.look(global);
    let here = here(env.cwd.as_deref());
    let bare_paths = !opts.headers;
    let found = if bare_paths {
        let found = !hits.is_empty();
        if !common::write_stdout(|mut out| paths(&mut out, args, &hits))? {
            return Ok(exit::MATCHED);
        }
        found
    } else {
        let mut groups = clrg_core::order::group(hits, known, look.roots, &here, look.home);
        narrow_by_agreement(&mut groups, &args.agree);
        let found = !groups.is_empty();
        let mut counts = (0, 0);
        let printed = common::write_stdout(|mut out| {
            counts = print(&mut out, args, &plan, &look, &groups)?;
            Ok(())
        })?;
        if !printed {
            return Ok(exit::MATCHED);
        }
        if found && !global.quiet && !args.files_with_matches {
            eprintln!("{}", common::agreement_line(counts.0, counts.1));
        }
        found
    };
    if let Some(code) = common::settle(global, &env.roots, &outcome) {
        return Ok(code);
    }
    if found {
        return Ok(exit::MATCHED);
    }
    eprint!("{}", no_match_message(&query, args, &env.roots, &outcome));
    Ok(exit::NO_MATCH)
}

/// Refuse what this build does not do yet. Returns the pattern.
fn check_supported(args: &GrepArgs) -> Result<&str, NotImplemented> {
    let ni = |what| Err(NotImplemented(what));
    if args.select.infer_branch {
        return ni("grep --infer-branch");
    }
    if args.raw {
        return ni("grep --raw");
    }
    if args.output.fields.is_some() && args.format == Format::Human && !args.files_with_matches {
        return ni("grep --fields with --format human");
    }
    args.pattern
        .as_deref()
        .map_or_else(|| ni("grep without a pattern"), Ok)
}

/// Check `--fields` and `--sort` before searching.
fn plan(args: &GrepArgs) -> Result<Plan<'_>, UsageError> {
    let fields = match (&args.output.fields, args.format) {
        (Some(f), Format::Tsv) => common::parse_fields(f, &records::FIELDS)?,
        (None, Format::Tsv) => common::parse_fields(records::TSV_DEFAULT, &records::FIELDS)?,
        (Some(_), _) if !args.files_with_matches => {
            return Err(UsageError("--fields applies to --format tsv".into()));
        }
        _ => Vec::new(),
    };
    let sort = common::parse_sort(args.output.sort.as_deref(), &records::FIELDS)?;
    Ok(Plan { fields, sort })
}

/// The folders that count as "here" for R5: the current folder, and `$PWD`
/// when it names the same folder by another path (a symlink).
fn here(cwd: Option<&Path>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = cwd.map(Path::to_path_buf).into_iter().collect();
    if let (Some(pwd), Some(c)) = (std::env::var_os("PWD").map(PathBuf::from), cwd)
        && pwd != c
        && pwd.canonicalize().ok() == c.canonicalize().ok()
    {
        out.push(pwd);
    }
    out
}

/// A `--sort` key for one hit.
fn sort_key(field: &str, g: &Group, h: &Hit) -> (Option<i64>, Option<String>) {
    let n = |v: Option<u64>| (v.map(|v| i64::try_from(v).unwrap_or(i64::MAX)), None);
    let s = |v: Option<&str>| (None, v.map(str::to_string));
    match field {
        "ts" => (h.meta.ts, None),
        "line" => n(h.line),
        "root" => n(Some(h.root as u64)),
        "match_start" => n(Some(h.match_start as u64)),
        "match_end" => n(Some(h.match_end as u64)),
        "cwd_exists" => n(g.cwd_exists.map(u64::from)),
        "store" => s(Some(h.store.as_str())),
        "path" => s(h.path.to_str()),
        "session" => s(h.meta.session.as_deref().or(g.session.as_deref())),
        "cwd" => s(h.meta.cwd.as_deref().or(g.cwd.as_deref())),
        "branch" => s(h.meta.branch.as_deref()),
        "type" => s(h.kind.as_deref()),
        "part" => s(h.part.as_deref()),
        "last" => n(h.last.map(u64::from)),
        "agreement" => s(h.agreement.map(Agreement::as_str)),
        "agreement_rule" => s(h.agreement_rule.map(clrg_core::Rule::as_str)),
        _ => s(Some(&h.excerpt)),
    }
}

/// `--agree`: keep `user/text` and `history` hits whose agreement is listed;
/// every other hit stays. Blocks left with no hits are dropped.
fn narrow_by_agreement(groups: &mut Vec<Group>, agree: &[Agree]) {
    if agree.is_empty() {
        return;
    }
    let wanted: Vec<Agreement> = agree.iter().map(|a| agreement(*a)).collect();
    for g in groups.iter_mut() {
        g.hits
            .retain(|h| h.agreement.is_none_or(|a| wanted.contains(&a)));
    }
    groups.retain(|g| !g.hits.is_empty());
}

fn agreement(a: Agree) -> Agreement {
    match a {
        Agree::Both => Agreement::Both,
        Agree::TranscriptOnly => Agreement::TranscriptOnly,
        Agree::HistoryOnly => Agreement::HistoryOnly,
        Agree::Unlinked => Agreement::Unlinked,
        Agree::Unknown => Agreement::Unknown,
    }
}

/// `-l`: each matching file once, in search order. `--limit` counts files.
fn paths<'a>(
    out: &mut impl io::Write,
    args: &GrepArgs,
    hits: impl IntoIterator<Item = &'a Hit>,
) -> io::Result<()> {
    let end = if args.output.null { b'\0' } else { b'\n' };
    let limit = args.output.limit.unwrap_or(usize::MAX);
    let mut seen: std::collections::HashSet<&Path> = std::collections::HashSet::new();
    for h in hits {
        if seen.len() == limit {
            break;
        }
        if seen.insert(&h.path) {
            out.write_all(h.path.to_string_lossy().as_bytes())?;
            out.write_all(&[end])?;
        }
    }
    Ok(())
}

/// Print the grouped hits in the chosen format. Returns the number of
/// `transcript-only` and `history-only` hits printed.
fn print(
    out: &mut impl io::Write,
    args: &GrepArgs,
    plan: &Plan<'_>,
    look: &Look<'_>,
    groups: &[Group],
) -> io::Result<(u64, u64)> {
    if args.files_with_matches {
        // Back in search order, so the paths come out as without --agree.
        let mut hits: Vec<&Hit> = groups.iter().flat_map(|g| &g.hits).collect();
        hits.sort_by(|a, b| {
            (a.root, a.store, &a.path, a.line, a.unit)
                .cmp(&(b.root, b.store, &b.path, b.line, b.unit))
        });
        paths(out, args, hits)?;
        return Ok((0, 0));
    }
    let end = if args.output.null { b'\0' } else { b'\n' };
    let mut flat: Vec<(usize, &Hit)> = groups
        .iter()
        .enumerate()
        .flat_map(|(gi, g)| g.hits.iter().map(move |h| (gi, h)))
        .collect();
    if let Some((field, desc)) = plan.sort {
        flat.sort_by(|a, b| {
            let o = sort_key(field, &groups[a.0], a.1).cmp(&sort_key(field, &groups[b.0], b.1));
            if desc { o.reverse() } else { o }
        });
    }
    flat.truncate(args.output.limit.unwrap_or(usize::MAX));
    let count = |a: Agreement| flat.iter().filter(|(_, h)| h.agreement == Some(a)).count() as u64;
    let counts = (
        count(Agreement::TranscriptOnly),
        count(Agreement::HistoryOnly),
    );
    let context = context(&flat, args.context);
    let rows = rows(&flat, &context);
    let mut recs = Records::new(look.roots, groups, args.context > 0);
    match args.format {
        Format::Human => render::human(out, groups, &rows, look),
        Format::Jsonl => records::jsonl(out, &mut recs, &rows),
        Format::Json => records::json(out, &mut recs, &rows),
        Format::Tsv => records::tsv(out, &mut recs, &rows, &plan.fields, end),
        Format::Values => records::values(out, groups, &rows, end),
    }?;
    Ok(counts)
}

/// `-C n`: the messages around the transcript hits, per block and file.
fn context<'a>(flat: &[(usize, &'a Hit)], n: usize) -> Vec<(usize, &'a Path, ContextMessage)> {
    if n == 0 {
        return Vec::new();
    }
    let mut lines: HashMap<(usize, &Path), Vec<u64>> = HashMap::new();
    let mut order = Vec::new();
    for (gi, h) in flat {
        if let (StoreKind::Transcripts, Some(l), false) = (h.store, h.line, h.unparsed) {
            let key = (*gi, h.path.as_path());
            let v = lines.entry(key).or_insert_with(|| {
                order.push(key);
                Vec::new()
            });
            v.push(l);
        }
    }
    let mut out = Vec::new();
    for key in order {
        let mut ls = lines.remove(&key).unwrap_or_default();
        ls.sort_unstable();
        ls.dedup();
        for msg in clrg_core::session::context_messages(key.1, &ls, n).unwrap_or_default() {
            out.push((key.0, key.1, msg));
        }
    }
    out
}

/// The rows to print. Without context, the hits in order. With context,
/// block by block (in order of first appearance), each in file order.
fn rows<'a>(
    flat: &[(usize, &'a Hit)],
    context: &'a [(usize, &'a Path, ContextMessage)],
) -> Vec<Row<'a>> {
    let hit_rows = flat.iter().map(|&(group, h)| Row {
        group,
        item: Item::Hit(h),
    });
    if context.is_empty() {
        return hit_rows.collect();
    }
    let mut first: HashMap<usize, usize> = HashMap::new();
    for (i, (gi, _)) in flat.iter().enumerate() {
        first.entry(*gi).or_insert(i);
    }
    let mut rows: Vec<Row<'a>> = hit_rows
        .chain(context.iter().map(|(group, path, msg)| Row {
            group: *group,
            item: Item::Context { path, msg },
        }))
        .collect();
    rows.sort_by_cached_key(|r| {
        let (store, path, line) = match &r.item {
            Item::Hit(h) => (h.store, h.path.as_path(), h.line.unwrap_or(0)),
            Item::Context { path, msg } => (StoreKind::Transcripts, *path, msg.line),
        };
        (
            first.get(&r.group).copied(),
            store,
            path.to_path_buf(),
            line,
        )
    });
    rows
}

fn store_kind(s: Store) -> StoreKind {
    match s {
        Store::Transcripts => StoreKind::Transcripts,
        Store::History => StoreKind::History,
        Store::Plans => StoreKind::Plans,
        Store::Todos => StoreKind::Todos,
        Store::Tasks => StoreKind::Tasks,
        Store::FileHistory => StoreKind::FileHistory,
        Store::Sessions => StoreKind::Sessions,
        Store::Workflows => StoreKind::Workflows,
        Store::Other => StoreKind::Other,
    }
}

/// `--in` values as raw-label selectors. `all` (the default) means every
/// hit, so it clears the list.
fn in_selectors(ins: &[String]) -> Result<Vec<InSelector>, UsageError> {
    if ins.iter().any(|i| i == "all") {
        return Ok(Vec::new());
    }
    ins.iter()
        .map(|i| {
            InSelector::parse(i).ok_or_else(|| {
                UsageError(format!(
                    "invalid --in value {i:?}: expected a line type (user), a part type (tool_result), or type/part (user/text)"
                ))
            })
        })
        .collect()
}

/// R4: on no match, say what was searched.
fn no_match_message(q: &Query, args: &GrepArgs, roots: &[PathBuf], o: &Outcome) -> String {
    let kind = if q.regex { "regex" } else { "literal" };
    let case = match q.case {
        CaseMode::Smart => "smart case",
        CaseMode::Insensitive => "ignore case",
        CaseMode::Sensitive => "case-sensitive",
    };
    let stores: Vec<&str> = if args.store.is_empty() {
        StoreKind::ALL.iter().map(|s| s.as_str()).collect()
    } else {
        args.store.iter().map(|s| store_kind(*s).as_str()).collect()
    };
    let roots = common::roots_text(roots, o);
    let filters = active_filters(args);
    format!(
        "clrg grep: no match for {:?} ({kind}, {case})\n  searched {} file(s) in stores: {}\n{}  roots: {}\n  filters: {}\n",
        q.pattern,
        o.files_searched,
        stores.join(", "),
        common::unreadable_text(o),
        roots,
        common::filters_text(&filters),
    )
}

/// Every restriction on the command line, spelled as flags.
fn active_filters(args: &GrepArgs) -> Vec<String> {
    let mut out = common::select_filters(&args.select);
    if !args.ins.iter().any(|i| i == "all") {
        out.extend(args.ins.iter().map(|i| format!("--in {i}")));
    }
    out.extend(
        args.agree
            .iter()
            .map(|a| format!("--agree {}", agreement(*a).as_str())),
    );
    if let Some(n) = args.output.limit {
        out.push(format!("--limit {n}"));
    }
    out
}
