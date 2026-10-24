//! clrg only reads: the fixture tree hashes the same after every command.

mod fixtures;

use std::collections::BTreeMap;
use std::path::Path;
use std::time::SystemTime;

use fixtures::{At, Fixture, TOKEN, every_store};
use serde_json::json;

/// What is recorded for each entry under the root: its kind, size, mtime,
/// and (for a file) its bytes. A directory's listing is the set of keys.
#[derive(Debug, PartialEq, Eq)]
struct Entry {
    kind: &'static str,
    len: u64,
    mtime: Option<SystemTime>,
    bytes: Vec<u8>,
}

fn snapshot(root: &Path) -> BTreeMap<String, Entry> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, Entry>) {
        let mut names: Vec<_> = std::fs::read_dir(dir)
            .expect("read_dir")
            .map(|e| e.expect("entry").path())
            .collect();
        names.sort();
        for path in names {
            let meta = std::fs::symlink_metadata(&path).expect("metadata");
            let rel = path.strip_prefix(root).unwrap().display().to_string();
            let kind = if meta.is_dir() {
                "dir"
            } else if meta.is_symlink() {
                "symlink"
            } else {
                "file"
            };
            let bytes = if meta.is_file() {
                std::fs::read(&path).expect("read")
            } else {
                Vec::new()
            };
            out.insert(
                rel,
                Entry {
                    kind,
                    len: meta.len(),
                    mtime: meta.modified().ok(),
                    bytes,
                },
            );
            if meta.is_dir() {
                walk(root, &path, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    let meta = std::fs::metadata(root).expect("root metadata");
    out.insert(
        ".".into(),
        Entry {
            kind: "dir",
            len: meta.len(),
            mtime: meta.modified().ok(),
            bytes: Vec::new(),
        },
    );
    walk(root, root, &mut out);
    out
}

/// Every built command with representative flags, every stub, and the
/// rest of the surface.
fn runs() -> Vec<Vec<&'static str>> {
    let mut runs: Vec<Vec<&'static str>> = vec![
        vec!["grep", TOKEN],
        vec!["grep", TOKEN, "--format", "jsonl"],
        vec!["grep", TOKEN, "--format", "json"],
        vec!["grep", TOKEN, "--format", "tsv"],
        vec!["grep", TOKEN, "--format", "values"],
        vec!["grep", "-l", TOKEN],
        vec!["grep", "-l", "-0", TOKEN],
        vec!["grep", "-C", "2", TOKEN],
        vec!["grep", "-E", "omni.oken", "-i", "--in", "prompt"],
        vec!["grep", TOKEN, "-b", "dev", "--scope", "session"],
        vec!["grep", TOKEN, "--store", "plans", "--store", "todos"],
        vec!["grep", "-uu", TOKEN, "--sort", "-ts", "--limit", "2"],
        vec!["--strict", "grep", TOKEN],
        vec!["grep", "zz-not-there"],
        vec!["m", TOKEN],
        vec!["sessions"],
        vec!["ls", "--format", "jsonl"],
        vec!["sessions", "--format", "json"],
        vec!["sessions", "--format", "tsv", "-0"],
        vec!["sessions", "--format", "values"],
        vec!["sessions", "-b", "main", "--sort", "messages"],
        vec!["sessions", "-b", "zz-no-branch"],
        vec!["--strict", "sessions"],
        vec!["facets", "branch", "-b", "zz-no-branch"],
        vec!["--strict", "facets", "branch"],
        vec!["--dedupe", "none", "-v", "-q", "sessions"],
        vec!["files"],
        vec!["f", "--format", "jsonl"],
        vec!["files", "--format", "json"],
        vec!["files", "--format", "tsv", "-0"],
        vec!["files", "--format", "values"],
        vec!["files", "--op", "read", "--op", "write", "--op", "edit"],
        vec!["files", "--relative", "--created-only"],
        vec!["files", "--path", "*nothing*"],
        vec![
            "files", "-b", "dev", "--scope", "session", "--sort", "-last_ts",
        ],
        vec!["--strict", "files"],
        // extract with -o inside the root (the current folder): refused.
        vec!["extract", "-o", "out", "--dry-run"],
        vec!["extract", "-o", "out"],
        vec!["x", "-o", "out"],
        vec!["extract", "-o", "projects/new", "--layout", "absolute"],
        vec!["extract", "-o", "."],
        // Every command (or flag) that is not built yet.
        vec!["files", "--op", "bash"],
        vec!["artifacts"],
        vec!["a"],
        vec!["show", "0000"],
        vec!["doctor"],
        vec!["index", "build"],
        vec!["index", "status"],
        vec!["index", "clear"],
        vec!["completion", "zsh"],
        // And the rest of the surface.
        vec!["--usage-spec"],
        vec!["--version"],
        vec!["--help"],
        vec![],
    ];
    let fields = [
        "branch",
        "cwd",
        "project",
        "model",
        "cli-version",
        "tool",
        "root",
        "day",
    ];
    for field in fields {
        runs.push(vec!["facets", field]);
        runs.push(vec!["facets", field, "--format", "json"]);
        runs.push(vec!["facets", field, "--format", "values"]);
    }
    runs
}

/// Every `extract` form; each runs with a new `-o` outside the root.
fn extract_runs() -> Vec<Vec<&'static str>> {
    let mut runs: Vec<Vec<&'static str>> = vec![
        vec!["extract"],
        vec!["x"],
        vec!["extract", "--dry-run"],
        vec!["extract", "--format", "jsonl"],
        vec!["extract", "--dry-run", "--format", "jsonl"],
        vec!["extract", "--no-manifest"],
        vec!["extract", "--manifest"],
        vec!["extract", "--created-only"],
        vec!["extract", "--path", "*/b.txt"],
        vec!["extract", "--path", "*nothing*"],
        vec!["extract", "-b", "dev", "--scope", "session"],
        vec!["extract", "-b", "zz-no-branch"],
        vec!["--strict", "extract"],
        vec!["extract", "--infer-branch"],
    ];
    for version in ["first", "last", "all"] {
        for source in ["best", "file-history", "transcript"] {
            for layout in ["cwd", "absolute", "session"] {
                runs.push(vec![
                    "extract",
                    "--version",
                    version,
                    "--source",
                    source,
                    "--layout",
                    layout,
                ]);
            }
        }
    }
    runs
}

#[test]
fn r1_never_writes_inside_a_root() {
    let (f, _) = every_store();
    // More shapes: a second session with a subagent, a branch change, a bad
    // line, a cwd under HOME that exists, and one that does not.
    let home = f.home();
    std::fs::create_dir_all(home.join("app")).unwrap();
    let at = At::new(9, &home.join("app").display().to_string(), "dev");
    let gone = At {
        cwd: home.join("gone").display().to_string(),
        ..at.branch("main")
    };
    let c_txt = home.join("app/c.txt").display().to_string();
    let path = f.transcript(
        "-home-app",
        &at,
        &[
            at.prompt(1, 1, &format!("{TOKEN} again")),
            at.assistant(
                2,
                2,
                json!([{"type": "tool_use", "id": "toolu_fake", "name": "Edit",
                        "input": {"file_path": "/work/app/b.txt", "old_string": "a", "new_string": TOKEN}}]),
            ),
            gone.prompt(3, 3, "later"),
            // File evidence: a snapshot with a relative path and its backup,
            // read by `files`.
            at.snapshot(4, &[("b.txt", Some("0b0b0b0b0b0b0b0b@v1"), 1, 1)]),
            // A Write that extract can recover.
            at.tool_use(5, 5, "toolu_w9", "Write", json!({"file_path": &c_txt, "content": "c\n"})),
            at.result_for(6, 5, "toolu_w9", false, "ok",
                json!({"type": "create", "filePath": &c_txt, "content": "c\n"})),
        ],
    );
    f.backup(&at, "0b0b0b0b0b0b0b0b@v1", "a\n");
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str("{broken\n");
    std::fs::write(&path, text).unwrap();
    f.jsonl(
        &format!("projects/-home-app/{}/subagents/agent-a1.jsonl", at.session),
        &[at.prompt(1, 4, &format!("subagent {TOKEN}"))],
    );

    let before = snapshot(f.root());
    assert!(before.len() > 20, "a real tree: {}", before.len());

    for args in &runs() {
        let out = f.clrg().args(args).output().expect("clrg runs");
        let code = out.status.code();
        assert!(
            matches!(code, Some(0 | 1 | 2 | 3 | 5)),
            "clrg {args:?} exited {code:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        // Checked after every command, so a failure names the one that wrote.
        let after = snapshot(f.root());
        if after != before {
            let changed: Vec<&String> = before
                .keys()
                .chain(after.keys())
                .filter(|k| before.get(*k) != after.get(*k))
                .collect();
            panic!("clrg {args:?} changed the root: {changed:?}");
        }
    }

    // Every extract form, writing -o outside the root.
    let outside = tempfile::tempdir().unwrap();
    let mut wrote = 0;
    for (i, args) in extract_runs().iter().enumerate() {
        let out = outside.path().join(format!("out-{i}"));
        let o = f
            .clrg()
            .args(args)
            .arg("-o")
            .arg(&out)
            .output()
            .expect("clrg runs");
        let code = o.status.code();
        assert!(
            matches!(code, Some(0..=5)),
            "clrg {args:?} exited {code:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        wrote += usize::from(out.exists());
        let after = snapshot(f.root());
        assert!(
            after == before,
            "clrg {args:?} -o <outside> changed the root"
        );
    }
    assert!(
        wrote > 10,
        "the extract forms wrote outside the root: {wrote}"
    );

    two_roots_leave_both_unchanged(&f, &at, &before, outside.path());
}

/// Two roots (a backup copy of the same session, merged into one timeline
/// per path): `files` and every extract version leave both roots unchanged.
fn two_roots_leave_both_unchanged(
    f: &Fixture,
    at: &At,
    before: &BTreeMap<String, Entry>,
    outside: &Path,
) {
    let (g, _) = every_store();
    g.transcript(
        "-home-app",
        at,
        &[at.prompt(1, 1, &format!("{TOKEN} again"))],
    );
    let before_g = snapshot(g.root());
    let mut two: Vec<Vec<&str>> = vec![vec!["files"], vec!["files", "--format", "jsonl"]];
    for version in ["first", "last", "all"] {
        two.push(vec!["extract", "--version", version]);
    }
    for (i, args) in two.iter().enumerate() {
        let mut cmd = f.clrg();
        cmd.arg("--root").arg(g.root()).args(args);
        if args[0] == "extract" {
            cmd.arg("-o").arg(outside.join(format!("two-{i}")));
        }
        let code = cmd.output().expect("clrg runs").status.code();
        assert!(matches!(code, Some(0..=5)), "two roots {args:?}: {code:?}");
        assert!(
            snapshot(f.root()) == *before,
            "{args:?} changed the first root"
        );
        assert!(
            snapshot(g.root()) == before_g,
            "{args:?} changed the second root"
        );
    }
}
