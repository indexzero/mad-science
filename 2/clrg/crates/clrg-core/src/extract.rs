//! `clrg extract`: which replayed state of each path to write, where it goes
//! under `-o <dir>`, and how to write it without leaving `<dir>`.
//!
//! The library plans and writes; the binary resolves `-o` against the
//! current folder and `HOME`, renders, and builds the manifest.
//!
//! Safety (INTENT "clrg extract"):
//!
//! - [`check_out`]: `-o` must not exist or must be an empty directory, and
//!   its canonical path must not be inside any root's canonical path.
//! - [`out_rel`]: every output path is relative and made only of normal
//!   components, so `..`, a root, or a prefix can never appear.
//! - [`plan_paths`]: final output paths are decided before the first
//!   write; paths that collide case-insensitively (with another file, a
//!   folder, or the manifest) get `~2`, `~3`, ...
//! - [`write_new`]: folders are created one component at a time and must be
//!   real folders (never a symlink), and files are created with
//!   `create_new`, which fails on any existing entry, symlinks included.
//!
//! Every check runs before the first write. A path with no safe output
//! path is skipped and listed; only a refused `-o` refuses the run.

use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write as _};
use std::path::{Component, Path, PathBuf};

use crate::evidence::{Event, EventKind, FileOutcome, Recoverable, State};

/// The manifest's file name, at the top of `-o <dir>`.
pub const MANIFEST: &str = "MANIFEST.jsonl";

/// `--version`: which state of each path to write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Which {
    /// The earliest state with full content.
    First,
    /// The final replayed state.
    #[default]
    Last,
    /// Every distinct content, as `<name>.v<N>`.
    All,
}

/// `--layout`: how output paths are arranged under `<dir>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Layout {
    /// `<dir>/<cwd with / → _>/<path relative to cwd>`.
    #[default]
    Cwd,
    /// `<dir>/<absolute path minus leading />`.
    Absolute,
    /// `<dir>/<sessionId>/<path relative to cwd>`.
    Session,
}

/// The states chosen for one path.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Choice {
    /// (index into the states, version `N`): each state to write.
    pub write: Vec<(usize, usize)>,
    /// What was requested and cannot be written (`diff-only` or `none`).
    pub missing: Vec<Recoverable>,
    /// `last`: the `rejected` states newer than the chosen one (not
    /// written; `--version all` writes them).
    pub newer_rejected: usize,
}

/// The version number of each state with content: the 1-based index of its
/// content among the path's distinct contents, in order of first
/// appearance (the same count as [`crate::evidence::versions`]).
#[must_use]
pub fn version_numbers(states: &[State]) -> Vec<Option<usize>> {
    let mut seen: Vec<&[u8]> = Vec::new();
    states
        .iter()
        .map(|s| {
            let c = s.content.as_deref()?;
            if let Some(i) = seen.iter().position(|x| *x == c) {
                return Some(i + 1);
            }
            seen.push(c);
            Some(seen.len())
        })
        .collect()
}

/// Choose the states `which` asks for.
///
/// - `last`: the last state that was on disk (`write`, `edit`, `backup`) or
///   `returned`; a newer `rejected` draft is not chosen, and is counted in
///   [`Choice::newer_rejected`]. With no such state (only rejected drafts),
///   the last rejected draft, labelled `rejected`. Without content it is
///   missing (`diff-only`, or `none` for an absent file); no state at all is
///   `none`.
/// - `first`: the earliest state with content. With none, it is missing:
///   `diff-only` when a state is diff-only, else `none`.
/// - `all`: the first state of each distinct content. Every `diff-only`
///   state is missing too (content existed and is lost); an absent-file
///   state is not a version. No content at all is missing as in `first`.
#[must_use]
pub fn choose(states: &[State], which: Which) -> Choice {
    let numbers = version_numbers(states);
    let none_or_diff = || {
        if states
            .iter()
            .any(|s| s.recoverable == Recoverable::DiffOnly)
        {
            Recoverable::DiffOnly
        } else {
            Recoverable::None
        }
    };
    let mut c = Choice::default();
    match which {
        Which::Last => {
            let at = states
                .iter()
                .rposition(|s| s.kind != EventKind::Rejected)
                .or_else(|| states.len().checked_sub(1));
            match at.map(|i| (i, &states[i])) {
                Some((i, s)) => {
                    c.newer_rejected = states[i + 1..]
                        .iter()
                        .filter(|s| s.kind == EventKind::Rejected)
                        .count();
                    if s.content.is_some() {
                        c.write.push((i, numbers[i].unwrap_or(1)));
                    } else {
                        c.missing.push(s.recoverable);
                    }
                }
                None => c.missing.push(Recoverable::None),
            }
        }
        Which::First => match numbers.iter().position(Option::is_some) {
            Some(i) => c.write.push((i, numbers[i].unwrap_or(1))),
            None => c.missing.push(none_or_diff()),
        },
        Which::All => {
            let mut done: HashSet<usize> = HashSet::new();
            for (i, n) in numbers.iter().enumerate() {
                if let Some(n) = n
                    && done.insert(*n)
                {
                    c.write.push((i, *n));
                }
            }
            c.missing.extend(
                states
                    .iter()
                    .filter(|s| s.recoverable == Recoverable::DiffOnly)
                    .map(|s| s.recoverable),
            );
            if c.write.is_empty() && c.missing.is_empty() {
                c.missing.push(Recoverable::None);
            }
        }
    }
    c
}

/// The manifest `outcome` of one state, from its own event: a write or edit
/// with a result is `written`, without one `unknown`; a backup is `written`
/// (its bytes were on disk); `rejected` and `returned` are themselves.
#[must_use]
pub fn state_outcome(e: &Event) -> FileOutcome {
    match e.kind {
        EventKind::Write | EventKind::Edit if e.answered => FileOutcome::Written,
        EventKind::Backup => FileOutcome::Written,
        EventKind::Rejected => FileOutcome::Rejected,
        EventKind::Returned => FileOutcome::Returned,
        _ => FileOutcome::Unknown,
    }
}

/// The folder, under `<dir>` (or under the session's folder for `--layout
/// session`), for absolute paths outside their session's `cwd`.
pub const ABS: &str = "_abs";

/// The output path of `path`, relative to `<dir>`, per `layout`:
///
/// - `cwd`: the session's launch `cwd` with every `/` replaced by `_`, then
///   the path relative to that `cwd`. An absolute path outside its `cwd` (or
///   whose session has no `cwd`) goes to `_abs/<absolute path minus
///   leading />`.
/// - `absolute`: the absolute path without its leading `/`.
/// - `session`: the session id, then the path relative to the `cwd` (a
///   relative path with no `cwd` is taken as already relative to it); an
///   absolute path outside its `cwd` goes to `<session>/_abs/...`.
///
/// A result is unsafe unless every component is a normal name: a `..` in a
/// recorded relative path, a relative path under `absolute` (or under `cwd`
/// with no `cwd`), the `cwd` itself, or a session id that is not a plain
/// name never yields an output path. The caller skips that path, lists it,
/// and writes the rest.
///
/// # Errors
/// Why the path has no safe output path.
pub fn out_rel(
    layout: Layout,
    path: &str,
    cwd: Option<&str>,
    session: Option<&str>,
) -> Result<PathBuf, String> {
    let p = Path::new(path);
    let abs = || -> PathBuf {
        Path::new(ABS).join(
            p.components()
                .filter(|c| !matches!(c, Component::RootDir))
                .collect::<PathBuf>(),
        )
    };
    // Some(relative to the cwd) inside it; None for an absolute path
    // outside it or with no cwd.
    let in_cwd = || -> Result<Option<PathBuf>, String> {
        if !p.has_root() {
            return Ok(Some(p.to_path_buf()));
        }
        let Some(c) = cwd else { return Ok(None) };
        let rel = relative_to(p, Path::new(c));
        if rel.as_os_str().is_empty() {
            return Err(format!("{path}: is its session's cwd, not a file in it"));
        }
        Ok((rel.components().next() != Some(Component::ParentDir)).then_some(rel))
    };
    let rel = match layout {
        Layout::Absolute => {
            if !p.has_root() {
                return Err(format!(
                    "{path}: not an absolute path (--layout absolute needs one)"
                ));
            }
            p.components()
                .filter(|c| !matches!(c, Component::RootDir))
                .collect()
        }
        Layout::Cwd => match (in_cwd()?, cwd) {
            (Some(rel), Some(c)) => Path::new(&c.replace('/', "_")).join(rel),
            (Some(_), None) => {
                return Err(format!(
                    "{path}: a relative path, and its session has no cwd"
                ));
            }
            (None, _) => abs(),
        },
        Layout::Session => {
            let Some(s) = session else {
                return Err(format!("{path}: no session id"));
            };
            Path::new(s).join(in_cwd()?.unwrap_or_else(abs))
        }
    };
    let ok = rel.components().count() > 0
        && rel.components().all(|c| match c {
            Component::Normal(n) => !n.is_empty(),
            _ => false,
        });
    // `Path::join` replaces the path when the right side is absolute; the
    // component check above also catches that.
    if ok {
        Ok(rel)
    } else {
        Err(format!(
            "{path}: its output path {} would leave the output directory",
            rel.display()
        ))
    }
}

/// `path` relative to `base`, lexically: `..` for each component of `base`
/// past the shared prefix.
fn relative_to(path: &Path, base: &Path) -> PathBuf {
    let a: Vec<Component> = path.components().collect();
    let b: Vec<Component> = base.components().collect();
    let shared = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut out = PathBuf::new();
    for _ in shared..b.len() {
        out.push("..");
    }
    for c in &a[shared..] {
        out.push(c);
    }
    out
}

/// `rel` with `.v<n>` appended to its file name.
#[must_use]
pub fn with_version(rel: &Path, n: usize) -> PathBuf {
    let mut name = rel.file_name().map(OsString::from).unwrap_or_default();
    name.push(format!(".v{n}"));
    rel.with_file_name(name)
}

/// `rel` with `~<n>` appended to its file name.
#[must_use]
pub fn with_suffix(rel: &Path, n: usize) -> PathBuf {
    let mut name = rel.file_name().map(OsString::from).unwrap_or_default();
    name.push(format!("~{n}"));
    rel.with_file_name(name)
}

/// Decide every final output path before the first write. Paths are
/// compared case-insensitively (as a case-insensitive file system would):
/// a file that collides with an earlier file, with the folder of any file,
/// or with the manifest gets the suffix `~2`, `~3`, ... (the first free
/// one), in the order given. So the result is deterministic, and no two
/// files share a path on any file system.
#[must_use]
pub fn plan_paths(rels: &[PathBuf]) -> Vec<PathBuf> {
    let fold = |p: &Path| p.to_string_lossy().to_lowercase();
    let dirs: HashSet<String> = rels
        .iter()
        .flat_map(|r| r.ancestors().skip(1))
        .filter(|a| !a.as_os_str().is_empty())
        .map(fold)
        .collect();
    let mut taken: HashSet<String> = HashSet::from([MANIFEST.to_lowercase()]);
    let mut out = Vec::with_capacity(rels.len());
    for rel in rels {
        let mut cand = rel.clone();
        let mut n = 1;
        while taken.contains(&fold(&cand)) || dirs.contains(&fold(&cand)) {
            n += 1;
            cand = with_suffix(rel, n);
        }
        taken.insert(fold(&cand));
        out.push(cand);
    }
    out
}

/// `-o <dir>`, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutDir {
    /// The canonical path: the canonical nearest existing ancestor joined
    /// with the new components.
    pub path: PathBuf,
    /// It exists (and is an empty folder).
    pub exists: bool,
}

/// Check `-o` (absolute) against the roots, and say where it really is.
///
/// It must be an empty folder, or not exist (the components that do not
/// exist must be plain names). Its canonical path must not be inside the
/// canonical path of any root (or the root as given, when that does not
/// exist). Nothing is created.
///
/// # Errors
/// Why `-o` is refused.
pub fn check_out(out: &Path, roots: &[PathBuf]) -> Result<OutDir, String> {
    let shown = out.display();
    let mut tail: Vec<OsString> = Vec::new();
    let mut cur = out.to_path_buf();
    let exists = loop {
        match fs::symlink_metadata(&cur) {
            Ok(_) => break tail.is_empty(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let Some(Component::Normal(name)) = cur.components().next_back() else {
                    return Err(format!("-o {shown}: its new part must be plain names"));
                };
                tail.push(name.to_os_string());
                if !cur.pop() {
                    return Err(format!("-o {shown}: no existing ancestor"));
                }
            }
            Err(e) => return Err(format!("-o {shown}: {e}")),
        }
    };
    let mut path = fs::canonicalize(&cur).map_err(|e| format!("-o {shown}: {e}"))?;
    for name in tail.iter().rev() {
        path.push(name);
    }
    for root in roots {
        let r = fs::canonicalize(root).unwrap_or_else(|_| root.clone());
        if path.starts_with(&r) || out.starts_with(root) {
            return Err(format!(
                "-o {shown}: is inside the root {} (clrg never writes inside a root)",
                root.display()
            ));
        }
    }
    if exists {
        if !path.is_dir() {
            return Err(format!("-o {shown}: exists and is not a folder"));
        }
        let mut entries = fs::read_dir(&path).map_err(|e| format!("-o {shown}: {e}"))?;
        if entries.next().is_some() {
            return Err(format!(
                "-o {shown}: is not empty (it must not exist, or be an empty folder)"
            ));
        }
    } else if !fs::metadata(&cur).is_ok_and(|m| m.is_dir()) {
        return Err(format!("-o {shown}: {} is not a folder", cur.display()));
    }
    Ok(OutDir { path, exists })
}

/// Create `out` (checked by [`check_out`]) when it does not exist.
///
/// # Errors
/// The I/O error.
pub fn create_out(out: &OutDir) -> io::Result<()> {
    if out.exists {
        return Ok(());
    }
    fs::create_dir_all(&out.path)
}

/// Write `bytes` at `out/rel` (`rel` from [`out_rel`]). Each folder is
/// created one component at a time and must be a real folder, never a
/// symlink; the file is created with `create_new`, so an existing entry
/// (a symlink included) is an error and is never followed or replaced.
///
/// # Errors
/// The I/O error, or `rel` is not made of plain names.
pub fn write_new(out: &Path, rel: &Path, bytes: &[u8]) -> io::Result<()> {
    let bad = || io::Error::new(io::ErrorKind::InvalidInput, "not a plain relative path");
    let names: Vec<&std::ffi::OsStr> = rel
        .components()
        .map(|c| match c {
            Component::Normal(n) => Ok(n),
            _ => Err(bad()),
        })
        .collect::<io::Result<_>>()?;
    let Some((file, dirs)) = names.split_last() else {
        return Err(bad());
    };
    let mut cur = out.to_path_buf();
    for d in dirs {
        cur.push(d);
        match fs::create_dir(&cur) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                let m = fs::symlink_metadata(&cur)?;
                if !m.is_dir() || m.file_type().is_symlink() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        format!("{}: exists and is not a folder", cur.display()),
                    ));
                }
            }
            Err(e) => return Err(e),
        }
    }
    cur.push(file);
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&cur)
        .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", cur.display())))?;
    f.write_all(bytes)?;
    f.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(content: Option<&str>, rec: Recoverable) -> State {
        State {
            event: 0,
            kind: EventKind::Write,
            content: content.map(|c| c.as_bytes().to_vec()),
            recoverable: rec,
            verified: None,
        }
    }

    #[test]
    fn layouts_and_refusals() {
        let cwd = Some("/work/app");
        let sid = Some("s1");
        let ok = |l, p, c, s| out_rel(l, p, c, s).map(|r| r.display().to_string());
        assert_eq!(
            ok(Layout::Cwd, "/work/app/src/a.rs", cwd, sid).unwrap(),
            "_work_app/src/a.rs"
        );
        assert_eq!(
            ok(Layout::Absolute, "/work/app/src/a.rs", cwd, sid).unwrap(),
            "work/app/src/a.rs"
        );
        assert_eq!(
            ok(Layout::Session, "/work/app/src/a.rs", cwd, sid).unwrap(),
            "s1/src/a.rs"
        );
        // Outside the cwd (or no cwd): under `_abs/`, never refused.
        assert_eq!(
            ok(Layout::Cwd, "/work/other/a.rs", cwd, sid).unwrap(),
            "_abs/work/other/a.rs"
        );
        assert_eq!(
            ok(Layout::Session, "/etc/hosts", cwd, sid).unwrap(),
            "s1/_abs/etc/hosts"
        );
        assert_eq!(
            ok(Layout::Cwd, "/work/app/a", None, sid).unwrap(),
            "_abs/work/app/a"
        );
        // Inside the cwd, a folder named `_abs` stays under the cwd's folder.
        assert_eq!(
            ok(Layout::Cwd, "/work/app/_abs/x", cwd, sid).unwrap(),
            "_work_app/_abs/x"
        );
        // The cwd itself is not a file.
        assert!(ok(Layout::Cwd, "/work/app", cwd, sid).is_err());
        // `..` in a relative path; relative under absolute or with no cwd.
        assert!(ok(Layout::Session, "../../x", None, sid).is_err());
        assert!(ok(Layout::Cwd, "../x", cwd, sid).is_err());
        assert!(ok(Layout::Absolute, "x/y", None, sid).is_err());
        assert!(ok(Layout::Cwd, "x/y", None, sid).is_err());
        // A session id that is not a plain name.
        assert!(ok(Layout::Session, "/work/app/a", cwd, Some("..")).is_err());
        assert!(ok(Layout::Session, "/work/app/a", cwd, Some("/etc")).is_err());
        assert_eq!(with_version(Path::new("a/b.md"), 2), Path::new("a/b.md.v2"));
    }

    #[test]
    fn choose_per_version() {
        let s = vec![
            st(None, Recoverable::None),
            st(Some("a"), Recoverable::Full),
            st(None, Recoverable::DiffOnly),
            st(Some("b"), Recoverable::Full),
            st(Some("a"), Recoverable::Full),
        ];
        assert_eq!(choose(&s, Which::Last).write, vec![(4, 1)]);
        assert_eq!(choose(&s, Which::First).write, vec![(1, 1)]);
        let all = choose(&s, Which::All);
        assert_eq!(all.write, vec![(1, 1), (3, 2)]);
        assert_eq!(all.missing, vec![Recoverable::DiffOnly]);
        let broken = vec![
            st(Some("a"), Recoverable::Full),
            st(None, Recoverable::DiffOnly),
        ];
        assert_eq!(
            choose(&broken, Which::Last).missing,
            vec![Recoverable::DiffOnly]
        );
        assert_eq!(choose(&[], Which::Last).missing, vec![Recoverable::None]);
        assert_eq!(choose(&[], Which::All).missing, vec![Recoverable::None]);
        let absent = vec![st(None, Recoverable::None)];
        assert_eq!(
            choose(&absent, Which::First).missing,
            vec![Recoverable::None]
        );
    }

    #[test]
    fn plan_paths_suffix_case_collisions() {
        let p = |s: &str| PathBuf::from(s);
        let planned = plan_paths(&[
            p("x/README.md"),
            p("x/Readme.md"),
            p("x/readme.md"),
            p("x/A"),
            p("x/a/b"),
            p("manifest.JSONL"),
            p("x/Readme.md~2"),
        ]);
        assert_eq!(
            planned,
            vec![
                p("x/README.md"),
                p("x/Readme.md~2"),
                p("x/readme.md~3"),
                // A file that is (case-insensitively) another file's folder.
                p("x/A~2"),
                p("x/a/b"),
                // The manifest's name is taken.
                p("manifest.JSONL~2"),
                // A suffixed name is taken too: the next free one.
                p("x/Readme.md~2~2"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn write_new_never_follows_a_symlink() {
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("out");
        let elsewhere = tmp.path().join("elsewhere");
        fs::create_dir_all(&out).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        // A folder symlink and a file symlink inside the output folder.
        std::os::unix::fs::symlink(&elsewhere, out.join("d")).unwrap();
        std::os::unix::fs::symlink(elsewhere.join("f"), out.join("f")).unwrap();
        assert!(write_new(&out, Path::new("d/x"), b"1").is_err());
        assert!(write_new(&out, Path::new("f"), b"1").is_err());
        assert!(write_new(&out, Path::new("../x"), b"1").is_err());
        assert_eq!(fs::read_dir(&elsewhere).unwrap().count(), 0);
        assert!(!tmp.path().join("x").exists());
        write_new(&out, Path::new("n/m/k"), b"ok").unwrap();
        assert_eq!(fs::read(out.join("n/m/k")).unwrap(), b"ok");
        assert!(write_new(&out, Path::new("n/m/k"), b"again").is_err());
    }

    #[test]
    fn out_dir_checks() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        fs::create_dir_all(root.join("projects")).unwrap();
        let roots = vec![root.clone()];
        assert!(check_out(&root.join("out"), &roots).is_err());
        assert!(check_out(&root, &roots).is_err());
        let fresh = check_out(&tmp.path().join("new/deeper"), &roots).unwrap();
        assert!(!fresh.exists);
        let empty = tmp.path().join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(check_out(&empty, &roots).unwrap().exists);
        fs::write(empty.join("x"), "1").unwrap();
        assert!(check_out(&empty, &roots).is_err());
        let file = tmp.path().join("file");
        fs::write(&file, "1").unwrap();
        assert!(check_out(&file, &roots).is_err());
        assert!(check_out(&file.join("under"), &roots).is_err());
        assert!(check_out(&tmp.path().join("nope/../x"), &roots).is_err());
    }
}
