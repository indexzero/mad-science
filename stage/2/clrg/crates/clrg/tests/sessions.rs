//! `clrg sessions` and `clrg facets`: named tests from INTENT.md "Done" item 3.
//! Output is piped, so it is 100 columns wide and has no color.

mod fixtures;

use fixtures::{At, Fixture, session_id};
use predicates::prelude::*;
use serde_json::{Value, json};

/// Run `clrg <args>` and return stdout. Asserts exit 0.
fn stdout(f: &Fixture, args: &[&str]) -> String {
    let out = f.clrg().args(args).output().expect("clrg runs");
    assert_eq!(
        out.status.code(),
        Some(0),
        "clrg {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).expect("utf-8")
}

/// Run `clrg <args> --format jsonl` and parse the records. Asserts exit 0.
fn jsonl(f: &Fixture, args: &[&str]) -> Vec<Value> {
    let mut all = args.to_vec();
    all.extend(["--format", "jsonl"]);
    stdout(f, &all)
        .lines()
        .map(|l| serde_json::from_str(l).expect("a JSON record"))
        .collect()
}

/// Three sessions under `HOME`, oldest to newest: seed 40 in `~/old` (exists),
/// seed 41 in `~/gone` (missing), and seed 42 in `~/new` (exists), which
/// moves from `~/new` to `~/new/sub` and from `main` to `dev`. Its folder is
/// the launch folder, `~/new`: the one `claude --resume` needs.
fn three_sessions() -> Fixture {
    let f = Fixture::new();
    let home = f.home();
    std::fs::create_dir_all(home.join("old")).unwrap();
    std::fs::create_dir_all(home.join("new/sub")).unwrap();
    let cwd = |rel: &str| home.join(rel).display().to_string();

    let old = At::new(40, &cwd("old"), "main");
    f.transcript(
        "-old",
        &old,
        &[
            old.prompt(1, 1, "set up the old project"),
            old.assistant(2, 2, json!([{"type": "text", "text": "Done."}])),
        ],
    );
    let gone = At::new(41, &cwd("gone"), "main");
    f.transcript(
        "-gone",
        &gone,
        &[
            gone.prompt(1, 10, "its folder is gone"),
            gone.tool_result(2, 11, "a tool result is not a prompt"),
        ],
    );
    let new = At::new(42, &cwd("new"), "main");
    let moved = At {
        cwd: cwd("new/sub"),
        ..new.branch("dev")
    };
    f.transcript(
        "-new",
        &new,
        &[
            new.prompt(1, 20, "start the new thing"),
            new.assistant(
                2,
                21,
                json!([{"type": "tool_use", "id": "toolu_fake", "name": "Write",
                        "input": {"file_path": "/work/new/a.txt", "content": "x"}}]),
            ),
            moved.prompt(3, 30, "wire the seed data into the onboarding flow"),
        ],
    );
    // Only the newest session has history: the others are unverified.
    f.history(&[
        new.history(20, "start the new thing"),
        moved.history(30, "wire the seed data into the onboarding flow"),
    ]);
    f
}

/// `--sort`, `--limit`, `-0`, tsv, and selectors on [`three_sessions`].
fn sorts_limits_and_selects(f: &Fixture, ids: &[String]) {
    // --sort, --limit, -0, tsv.
    let oldest = jsonl(f, &["sessions", "--sort", "last_ts", "--limit", "2"]);
    let got: Vec<&str> = oldest
        .iter()
        .map(|r| r["session"].as_str().unwrap())
        .collect();
    assert_eq!(got, [ids[2].as_str(), ids[1].as_str()]);
    let tsv = stdout(
        f,
        &[
            "sessions",
            "--format",
            "tsv",
            "--fields",
            "session,branches,messages",
            "-0",
        ],
    );
    assert_eq!(
        tsv,
        format!(
            "session\tbranches\tmessages\0{}\tmain,dev\t3\0{}\tmain\t2\0{}\tmain\t2\0",
            ids[0], ids[1], ids[2]
        )
    );
    f.clrg()
        .args(["sessions", "--sort", "nope"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("unknown field \"nope\""));

    // Selectors pick sessions: a branch, a cwd prefix, a session prefix.
    let on_dev = jsonl(f, &["sessions", "-b", "dev"]);
    assert_eq!(on_dev.len(), 1);
    assert_eq!(on_dev[0]["session"], ids[0].as_str());
    assert_eq!(jsonl(f, &["sessions", "-d", "~/old"]).len(), 1);
    assert_eq!(jsonl(f, &["sessions", "--session", &ids[1][..8]]).len(), 1);
}

#[test]
fn s1_sessions_newest_first_with_cwd() {
    let f = three_sessions();
    let ids: Vec<String> = [42, 41, 40].map(session_id).to_vec();

    // Human: one aligned line per session, newest first, cwd with `~`, the
    // branches, the short id, the message count, and the `last:` text with
    // the same markers as `clrg grep`.
    let out = stdout(&f, &["sessions"]);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 3, "{out}");
    for (line, id) in lines.iter().zip(&ids) {
        assert!(line.contains(&id[..8]), "{id} in {line:?}");
        assert!(line.chars().count() <= 100, "fits the width: {line:?}");
    }
    assert!(lines[0].starts_with("2026-08-02 14:30  ~/new "), "{out}");
    assert!(lines[0].contains("[main, dev]"), "{out}");
    assert!(lines[0].contains(" 3 msg"), "{out}");
    // The last prompt is cut to fit the 100 columns.
    assert_eq!(lines[0].chars().count(), 100, "{out}");
    assert!(
        lines[0].ends_with("\"wire the seed data into the…\""),
        "{out}"
    );
    assert!(lines[2].starts_with("2026-08-02 14:02  ~/old "), "{out}");
    assert!(
        lines[1].contains("\"its folder is") && lines[1].ends_with("…\" (unverified)"),
        "a tool result is not user/text; no history, so unverified: {out}"
    );
    assert!(
        lines[2].ends_with("\"set up the old…\" (unverified)"),
        "{out}"
    );
    // Aligned: the short ids start in the same column.
    let col: Vec<usize> = lines
        .iter()
        .zip(&ids)
        .map(|(l, id)| l.find(&id[..8]).unwrap())
        .collect();
    assert!(col.windows(2).all(|w| w[0] == w[1]), "{out}");
    // `ls` is the same command.
    assert_eq!(stdout(&f, &["ls"]), out);

    // JSONL: the spec's FIELDS, full ids and paths, RFC 3339 times.
    let recs = jsonl(&f, &["sessions"]);
    let got: Vec<&str> = recs
        .iter()
        .map(|r| r["session"].as_str().unwrap())
        .collect();
    assert_eq!(got, ids);
    let r = &recs[0];
    assert_eq!(r["cwd"], f.home().join("new").display().to_string());
    assert_eq!(r["cwd_exists"], true);
    assert_eq!(r["branches"], json!(["main", "dev"]));
    assert_eq!(r["messages"], 3);
    assert_eq!(r["first_ts"], "2026-08-02T14:20:00.000Z");
    assert_eq!(r["last_ts"], "2026-08-02T14:30:00.000Z");
    assert_eq!(r["tools"], json!(["Write"]));
    assert_eq!(r["files_touched"], 1);
    assert_eq!(r["models"], json!(["model-x"]));
    assert_eq!(r["cli_versions"], json!(["1.0.40"]));
    assert_eq!(r["project"], "-new");
    assert_eq!(r["root"], f.root().display().to_string());
    assert_eq!(r["has_file_history"], false);
    assert_eq!(r["subagents"], 0);
    assert_eq!(r["last"], "wire the seed data into the onboarding flow");
    assert_eq!(recs[1]["last"], "its folder is gone");
    let keys: Vec<&str> = r.as_object().unwrap().keys().map(String::as_str).collect();
    assert!(keys.contains(&"cwd_exists") && keys.contains(&"confidence"));
    let json_out: Value =
        serde_json::from_str(&stdout(&f, &["sessions", "--format", "json"])).unwrap();
    assert_eq!(json_out.as_array().unwrap(), &recs);

    // values: `<session id>:<cwd>`, for completion and `cd`.
    let values = stdout(&f, &["sessions", "--format", "values", "-n", "1"]);
    assert_eq!(
        values,
        format!("{}:{}\n", ids[0], f.home().join("new").display())
    );
    sorts_limits_and_selects(&f, &ids);

    // R4: no session matched says what was searched, and exits 1.
    let err = f
        .clrg()
        .args(["sessions", "-b", "no-such-branch"])
        .assert()
        .code(1)
        .stdout(predicate::str::is_empty())
        .get_output()
        .stderr
        .clone();
    let err = String::from_utf8(err).unwrap();
    assert!(err.contains("no session matched"), "{err}");
    assert!(err.contains("searched 3 file(s)"), "{err}");
    assert!(err.contains(&f.root().display().to_string()), "{err}");
    assert!(err.contains("--branch no-such-branch"), "{err}");
}

#[test]
fn s2_missing_cwd_is_flagged() {
    let f = three_sessions();
    let out = stdout(&f, &["sessions"]);
    let flagged: Vec<&str> = out
        .lines()
        .filter(|l| l.contains("(cwd missing)"))
        .collect();
    assert_eq!(flagged.len(), 1, "{out}");
    assert!(flagged[0].contains("~/gone (cwd missing)"), "{out}");
    assert!(flagged[0].contains(&session_id(41)[..8]), "{out}");

    let recs = jsonl(&f, &["sessions"]);
    let exists: Vec<(&str, bool)> = recs
        .iter()
        .map(|r| {
            (
                r["session"].as_str().unwrap(),
                r["cwd_exists"].as_bool().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        exists,
        vec![
            (session_id(42).as_str(), true),
            (session_id(41).as_str(), false),
            (session_id(40).as_str(), true)
        ]
    );
    let tsv = stdout(
        &f,
        &["sessions", "--format", "tsv", "--fields", "cwd_exists"],
    );
    assert_eq!(tsv, "cwd_exists\ntrue\nfalse\ntrue\n");

    // The same session in two roots is two rows, each tagged by its root.
    let copy = Fixture::new();
    let gone = At::new(41, &f.home().join("gone").display().to_string(), "main");
    copy.transcript("-gone", &gone, &[gone.prompt(1, 10, "a backup copy")]);
    let out = f
        .clrg()
        .arg("--root")
        .arg(copy.root())
        .args(["sessions", "--session", &session_id(41)])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let out = String::from_utf8(out.stdout).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 2, "{out}");
    assert!(
        lines
            .iter()
            .all(|l| l.contains("(cwd missing)") && l.contains("(root ")),
        "{out}"
    );
}

/// Branches: seed 50 on `main` (2 messages), seed 51 on `main` then `dev`
/// (1 + 2 messages), seed 52 with no branch (1 message).
fn branches() -> Fixture {
    let f = Fixture::new();
    let a = At::new(50, "/work/app", "main");
    f.transcript(
        "-work-app",
        &a,
        &[
            a.prompt(1, 1, "one"),
            a.assistant(2, 2, json!([{"type": "text", "text": "two"}])),
            json!({"type": "summary", "summary": "not a message", "leafUuid": "x"}),
        ],
    );
    let b = At::new(51, "/work/app", "main");
    let dev = b.branch("dev");
    f.transcript(
        "-work-app",
        &b,
        &[
            b.prompt(1, 10, "three"),
            dev.prompt(2, 11, "four"),
            dev.assistant(3, 12, json!([{"type": "text", "text": "five"}])),
        ],
    );
    let c = At::new(52, "/work/lib", "");
    f.transcript("-work-lib", &c, &[c.prompt(1, 20, "six")]);
    f
}

#[test]
fn f1_facets_counts_branches() {
    let f = branches();
    let recs = jsonl(&f, &["facets", "branch"]);
    let rows: Vec<(String, u64, u64)> = recs
        .iter()
        .map(|r| {
            (
                r["value"].as_str().unwrap().to_string(),
                r["sessions"].as_u64().unwrap(),
                r["messages"].as_u64().unwrap(),
            )
        })
        .collect();
    // Most messages first; messages with no branch under `(none)`.
    assert_eq!(
        rows,
        vec![
            ("main".into(), 2, 3),
            ("dev".into(), 1, 2),
            ("(none)".into(), 1, 1)
        ]
    );
    assert_eq!(recs[0]["first_ts"], "2026-08-02T14:01:00.000Z");
    assert_eq!(recs[0]["last_ts"], "2026-08-02T14:10:00.000Z");

    // Human: a header and one aligned row per value.
    let out = stdout(&f, &["facets", "branch"]);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 4, "{out}");
    assert!(lines[0].starts_with("VALUE "), "{out}");
    assert!(lines[1].starts_with("main "), "{out}");
    assert!(lines[3].starts_with("(none) "), "{out}");
    let col = lines[0].find("MESSAGES").unwrap() + "MESSAGES".len();
    assert_eq!(&lines[1][col - 1..col], "3", "right-aligned counts: {out}");

    // values: completion lines, with no `(none)`.
    assert_eq!(
        stdout(&f, &["facets", "branch", "--format", "values"]),
        "main:2 sessions, last 2026-08-02\ndev:1 session, last 2026-08-02\n"
    );

    // Selectors apply per message by default, per session with --scope.
    let main_only = jsonl(&f, &["facets", "branch", "--branch-glob", "ma*"]);
    assert_eq!(main_only.len(), 1);
    let whole = jsonl(&f, &["facets", "branch", "-b", "dev", "--scope", "session"]);
    let values: Vec<&str> = whole.iter().map(|r| r["value"].as_str().unwrap()).collect();
    assert_eq!(
        values,
        ["dev", "main"],
        "every message of the session counts"
    );
    assert_eq!(whole[1]["messages"], 1);

    // Other fields.
    let cwd = jsonl(&f, &["facets", "cwd"]);
    assert_eq!(cwd[0]["value"], "/work/app");
    assert_eq!(cwd[0]["messages"], 5);
    let models = jsonl(&f, &["facets", "model"]);
    assert_eq!(models[0]["value"], "(none)", "user messages have no model");
    assert_eq!(jsonl(&f, &["facets", "day"])[0]["value"], "2026-08-02");
    assert_eq!(
        stdout(
            &f,
            &["facets", "project", "--format", "tsv", "--sort", "value"]
        ),
        "value\tsessions\tmessages\tfirst_ts\tlast_ts\n\
         -work-app\t2\t5\t2026-08-02T14:01:00.000Z\t2026-08-02T14:12:00.000Z\n\
         -work-lib\t1\t1\t2026-08-02T14:20:00.000Z\t2026-08-02T14:20:00.000Z\n"
    );

    // R4: nothing selected exits 1 and says what was searched.
    f.clrg()
        .args(["facets", "branch", "-b", "nope"])
        .assert()
        .code(1)
        .stdout(predicate::str::is_empty())
        .stderr(
            predicate::str::contains("searched 3 file(s)")
                .and(predicate::str::contains("--branch nope")),
        );
}
