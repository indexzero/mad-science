//! `clrg grep`: named tests from INTENT.md "Done" item 3.
//! Slice 2 builds the engine; slice 3 the rendering and formats.

mod fixtures;

use std::collections::BTreeSet;

use fixtures::{At, Fixture, TOKEN, every_store};
use predicates::prelude::*;
use serde_json::{Value, json};

/// The matched text of each record, from its excerpt and offsets.
fn matched(records: &[Value]) -> Vec<String> {
    records
        .iter()
        .map(|r| {
            let ex = r["excerpt"].as_str().unwrap();
            let s = usize::try_from(r["match_start"].as_u64().unwrap()).unwrap();
            let e = usize::try_from(r["match_end"].as_u64().unwrap()).unwrap();
            ex[s..e].to_string()
        })
        .collect()
}

/// A root with one transcript holding `texts` as prompts, one per message.
fn prompts(texts: &[&str]) -> Fixture {
    let f = Fixture::new();
    let at = At::new(7, "/work/app", "main");
    let lines: Vec<Value> = (1..).zip(texts).map(|(n, t)| at.prompt(n, n, t)).collect();
    f.transcript("-work-app", &at, &lines);
    f
}

#[test]
fn g1_pattern_is_literal_by_default() {
    let f = prompts(&["the a.b value", "the axb value", "x+y and xxy"]);
    let hits = f.grep_jsonl(&["a.b"]);
    assert_eq!(matched(&hits), vec!["a.b"]);
    let hits = f.grep_jsonl(&["x+y"]);
    assert_eq!(matched(&hits), vec!["x+y"]);
    f.clrg().args(["grep", "a[xy]b"]).assert().code(1);
}

#[test]
fn g2_smart_case() {
    let f = prompts(&["Needle one", "needle two", "NEEDLE three"]);
    assert_eq!(
        f.grep_jsonl(&["needle"]).len(),
        3,
        "lowercase matches any case"
    );
    assert_eq!(
        matched(&f.grep_jsonl(&["Needle"])),
        vec!["Needle"],
        "uppercase is exact"
    );
    assert_eq!(matched(&f.grep_jsonl(&["-s", "needle"])), vec!["needle"]);
    assert_eq!(f.grep_jsonl(&["-i", "Needle"]).len(), 3);
    // The last of -i / -s wins.
    assert_eq!(f.grep_jsonl(&["-i", "-s", "needle"]).len(), 1);
}

#[test]
fn g3_regex_is_opt_in() {
    let f = prompts(&["a neeedle here", "a ndle there"]);
    f.clrg().args(["grep", "ne+dle"]).assert().code(1);
    assert_eq!(matched(&f.grep_jsonl(&["-E", "ne+dle"])), vec!["neeedle"]);
    assert_eq!(f.grep_jsonl(&["--regex", "ne+e?dle"]).len(), 1);
    assert_eq!(f.grep_jsonl(&["-E", "ne*dle"]).len(), 2);
    assert_eq!(f.grep_jsonl(&["-E", "NE+DLE", "-i"]).len(), 1);
    f.clrg()
        .args(["grep", "-E", "("])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("invalid pattern"));
}

#[test]
fn g4_matches_decoded_text_not_json_escapes() {
    let f = prompts(&[
        r#"then say "hi" to them"#,
        r"the file is C:\temp",
        "line one\nline two",
    ]);
    // A `"` or `\` in the pattern is the typed character...
    assert_eq!(
        matched(&f.grep_jsonl(&[r#"say "hi""#])),
        vec![r#"say "hi""#]
    );
    assert_eq!(matched(&f.grep_jsonl(&[r"C:\temp"])), vec![r"C:\temp"]);
    // ...and a pattern made only of such characters still works.
    assert_eq!(matched(&f.grep_jsonl(&[r#"""#])).len(), 1);
    // The JSON-escaped bytes are not the text.
    f.clrg().args(["grep", r#"\"hi"#]).assert().code(1);
    f.clrg().args(["grep", r"C:\\temp"]).assert().code(1);
    f.clrg().args(["grep", r"one\nline"]).assert().code(1);
    // A real newline is matched as text, and shown as a space in the excerpt.
    let hits = f.grep_jsonl(&["one\nline"]);
    assert_eq!(hits.len(), 1);
    assert!(
        hits[0]["excerpt"]
            .as_str()
            .unwrap()
            .contains("line one line two")
    );
}

#[test]
fn g5_branch_filter_applies_per_message() {
    let f = Fixture::new();
    let a = At::new(5, "/work/app", "feature/a");
    let b = a.branch("feature/b");
    f.transcript(
        "-work-app",
        &a,
        &[
            a.prompt(1, 1, "needle on a"),
            b.prompt(2, 2, "needle on b"),
            a.prompt(3, 3, "needle on a again"),
        ],
    );
    let texts = |args: &[&str]| -> Vec<String> {
        f.grep_jsonl(args)
            .iter()
            .map(|r| r["excerpt"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        texts(&["needle", "-b", "feature/a"]),
        vec!["needle on a", "needle on a again"]
    );
    assert_eq!(texts(&["needle", "-b", "feature/b"]), vec!["needle on b"]);
    for r in f.grep_jsonl(&["needle", "-b", "feature/b"]) {
        assert_eq!(r["branch"], "feature/b");
    }
    // Repeated -b is OR'd; the glob matches both.
    assert_eq!(
        texts(&["needle", "-b", "feature/a", "-b", "feature/b"]).len(),
        3
    );
    assert_eq!(texts(&["needle", "--branch-glob", "feature/*"]).len(), 3);
    // --scope session: one message on the branch selects the whole session.
    assert_eq!(
        texts(&["needle", "-b", "feature/b", "--scope", "session"]).len(),
        3
    );
    f.clrg()
        .args(["grep", "needle", "-b", "feature/c"])
        .assert()
        .code(1);
}

#[test]
fn g6_no_match_reports_what_was_searched() {
    let (f, files) = every_store();
    let root = f.root().display().to_string();
    let out = f
        .clrg()
        .args([
            "grep",
            "zz-not-there",
            "-b",
            "main",
            "--in",
            "user/text",
            "--agree",
            "both",
        ])
        .assert()
        .code(1)
        .stdout(predicate::str::is_empty())
        .get_output()
        .stderr
        .clone();
    let err = String::from_utf8(out).unwrap();
    assert!(err.contains("\"zz-not-there\""), "names the pattern: {err}");
    assert!(err.contains("literal, smart case"), "names the mode: {err}");
    assert!(
        err.contains(&format!("searched {} file(s)", files.len())),
        "names the file count: {err}"
    );
    for store in [
        "transcripts",
        "history",
        "plans",
        "todos",
        "tasks",
        "file-history",
        "sessions",
        "workflows",
        "other",
    ] {
        assert!(err.contains(store), "names store {store}: {err}");
    }
    assert!(err.contains(&root), "names the root: {err}");
    assert!(
        err.contains("--branch main"),
        "names the branch filter: {err}"
    );
    assert!(
        err.contains("--in user/text"),
        "names the label filter: {err}"
    );
    assert!(
        err.contains("--agree both"),
        "names the agreement filter: {err}"
    );

    // Narrowed stores are named as such, and a missing root says so.
    let err = f
        .clrg()
        .args(["--root", "no-such-root", "grep", "zz", "--store", "plans"])
        .assert()
        .code(1)
        .get_output()
        .stderr
        .clone();
    let err = String::from_utf8(err).unwrap();
    assert!(err.contains("stores: plans\n"), "{err}");
    assert!(err.contains("no-such-root (missing)"), "{err}");
    assert!(err.contains("filters: none"), "{err}");
}

#[test]
fn g9_all_stores_searched_by_default() {
    let (f, files) = every_store();
    let hits = f.grep_jsonl(&[TOKEN]);
    let stores: BTreeSet<&str> = hits.iter().map(|r| r["store"].as_str().unwrap()).collect();
    assert_eq!(
        stores,
        BTreeSet::from([
            "file-history",
            "history",
            "other",
            "plans",
            "sessions",
            "tasks",
            "todos",
            "transcripts"
        ])
    );
    let paths: BTreeSet<String> = hits
        .iter()
        .map(|r| r["path"].as_str().unwrap().into())
        .collect();
    let expected: BTreeSet<String> = files.iter().map(|p| p.display().to_string()).collect();
    assert_eq!(paths, expected, "settings.json is store other");
    // Hits outside transcripts are attributed to the session by path or field.
    for r in &hits {
        if r["store"] == "other" {
            assert_eq!((&r["session"], &r["type"]), (&Value::Null, &Value::Null));
        } else if r["store"] != "plans" {
            assert_eq!(r["session"], fixtures::session_id(1), "{r}");
        }
    }
    // --store narrows for this command line only.
    let hits = f.grep_jsonl(&[TOKEN, "--store", "plans", "--store", "todos"]);
    let stores: BTreeSet<&str> = hits.iter().map(|r| r["store"].as_str().unwrap()).collect();
    assert_eq!(stores, BTreeSet::from(["plans", "todos"]));
}

#[test]
fn g10_files_with_matches_prints_paths() {
    let (f, files) = every_store();
    let at = At::new(2, "/work/other", "main");
    f.transcript("-work-other", &at, &[at.prompt(1, 1, "nothing to see")]);
    let out = f.clrg().args(["grep", "-l", TOKEN]).output().unwrap();
    assert_eq!(out.status.code(), Some(0));
    let printed: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect();
    let mut unique = printed.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), printed.len(), "each path once: {printed:?}");
    let expected: BTreeSet<String> = files.iter().map(|p| p.display().to_string()).collect();
    assert_eq!(printed.into_iter().collect::<BTreeSet<_>>(), expected);

    // -l -0 terminates with NUL; -u/-uu are accepted and ignored.
    f.clrg()
        .args(["grep", "-uu", "-l", "-0", TOKEN, "--store", "plans"])
        .assert()
        .success()
        .stdout(format!("{}\0", files[2].display()));
}

#[test]
fn grep_aliases_run_grep() {
    let f = prompts(&["alias needle"]);
    for alias in ["messages", "m"] {
        f.clrg().args([alias, "needle"]).assert().success();
    }
}

#[test]
fn labels_are_raw_and_filtered_by_in() {
    let f = Fixture::new();
    let at = At::new(3, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "user/text marker"),
            at.assistant(
                2,
                2,
                json!([
                    {"type": "thinking", "thinking": "assistant/thinking marker"},
                    {"type": "text", "text": "assistant/text marker"},
                    {"type": "tool_use", "id": "toolu_fake", "name": "Write",
                     "input": {"file_path": "/work/app/a.txt", "content": "assistant/tool_use marker"}}
                ]),
            ),
            at.tool_result(3, 3, "user/tool_result marker"),
            json!({"type": "summary", "summary": "summary marker", "leafUuid": "x"}),
        ],
    );
    let label = |r: &Value| match (r["type"].as_str(), r["part"].as_str()) {
        (Some(t), Some(p)) => format!("{t}/{p}"),
        (Some(t), None) => t.to_string(),
        _ => panic!("{r}"),
    };
    let hits = f.grep_jsonl(&["marker"]);
    assert_eq!(hits.len(), 6);
    for r in &hits {
        assert_eq!(r["excerpt"], format!("{} marker", label(r)));
    }
    let only =
        |args: &[&str]| -> BTreeSet<String> { f.grep_jsonl(args).iter().map(label).collect() };
    let set = |xs: &[&str]| xs.iter().map(|x| (*x).to_string()).collect::<BTreeSet<_>>();
    assert_eq!(only(&["marker", "--in", "user/text"]), set(&["user/text"]));
    assert_eq!(
        only(&["marker", "--in", "text"]),
        set(&["user/text", "assistant/text"]),
        "a bare name matches a line type or a part type"
    );
    assert_eq!(
        only(&["marker", "--in", "user"]),
        set(&["user/text", "user/tool_result"])
    );
    assert_eq!(
        only(&["marker", "--in", "thinking", "--in", "tool_use"]),
        set(&["assistant/thinking", "assistant/tool_use"])
    );
    assert_eq!(only(&["marker", "--in", "summary"]), set(&["summary"]));
    // No derived names: `prompt` is not a label in the data.
    f.clrg()
        .args(["grep", "marker", "--in", "prompt"])
        .assert()
        .code(1);
    f.clrg()
        .args(["grep", "marker", "--in", "user/"])
        .assert()
        .code(2);
    // Tool selectors read the message's tool calls.
    assert_eq!(f.grep_jsonl(&["marker", "--tool", "Write"]).len(), 3);
    assert_eq!(
        f.grep_jsonl(&["marker", "--touched", "/work/app/*.txt"])
            .len(),
        3
    );
}

#[test]
fn records_carry_session_cwd_and_time() {
    let f = Fixture::new();
    let cwd = f.root().join("repo");
    std::fs::create_dir_all(&cwd).unwrap();
    let at = At::new(4, cwd.to_str().unwrap(), "main");
    let gone = At::new(6, "/work/gone-for-good", "");
    f.transcript("-repo", &at, &[at.prompt(1, 31, "record needle")]);
    f.transcript("-gone", &gone, &[gone.prompt(1, 32, "record needle")]);
    let hits = f.grep_jsonl(&["record needle"]);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].as_object().unwrap().len(), 17);
    let by_cwd = |c: &str| hits.iter().find(|r| r["cwd"] == c).unwrap().clone();
    let here = by_cwd(cwd.to_str().unwrap());
    assert_eq!(here["cwd_exists"], true);
    assert_eq!(here["session"], fixtures::session_id(4));
    assert_eq!(here["branch"], "main");
    assert_eq!(here["ts"], "2026-08-02T14:31:00.000Z");
    assert_eq!(
        (&here["type"], &here["part"]),
        (&json!("user"), &json!("text"))
    );
    assert_eq!(here["line"], 1);
    let gone = by_cwd("/work/gone-for-good");
    assert_eq!(gone["cwd_exists"], false);
    assert_eq!(
        gone["branch"],
        Value::Null,
        "an empty gitBranch is no branch"
    );
}

#[test]
fn unparsable_lines_are_counted_and_strict_exits_3() {
    let f = Fixture::new();
    let at = At::new(8, "/work/app", "main");
    let path = f.transcript("-work-app", &at, &[at.prompt(1, 1, "good needle")]);
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str("{\"type\":\"user\",\"message\":{\"content\":\"cut needle\n");
    std::fs::write(&path, text).unwrap();
    // The truncated line still matches on its raw text, and is reported.
    f.clrg()
        .args(["grep", "needle"])
        .assert()
        .success()
        .stdout(predicate::str::contains("good needle").and(predicate::str::contains("cut needle")))
        .stderr(predicate::str::contains(
            "1 unparsable line(s) in 1 file(s)",
        ));
    f.clrg()
        .args(["-q", "grep", "needle"])
        .assert()
        .success()
        .stderr("");
    f.clrg()
        .args(["--strict", "grep", "needle"])
        .assert()
        .code(3);
    // --strict parses every line, even ones the pre-filter would skip.
    f.clrg().args(["--strict", "grep", "good"]).assert().code(3);
}

#[test]
fn subagents_are_searched_unless_excluded() {
    let f = Fixture::new();
    let at = At::new(9, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "main needle")]);
    f.jsonl(
        &format!("projects/-work-app/{}/subagents/agent-a1.jsonl", at.session),
        &[at.prompt(1, 2, "sub needle")],
    );
    let hits = f.grep_jsonl(&["needle"]);
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().all(|r| r["session"] == at.session.as_str()));
    assert_eq!(f.grep_jsonl(&["needle", "--no-subagents"]).len(), 1);
}

#[test]
fn other_stores_join_selectors_by_session() {
    let (f, _) = every_store();
    // Session 1 is on main, so its todos, tasks, ... pass -b main.
    let hits = f.grep_jsonl(&[TOKEN, "-b", "main"]);
    let stores: BTreeSet<&str> = hits.iter().map(|r| r["store"].as_str().unwrap()).collect();
    assert!(
        stores.contains("todos") && stores.contains("file-history"),
        "{stores:?}"
    );
    assert!(!stores.contains("plans"), "a plan has no session to join");
    f.clrg()
        .args(["grep", TOKEN, "-b", "other"])
        .assert()
        .code(1);
    let hits = f.grep_jsonl(&[TOKEN, "--session", &fixtures::session_id(1)[..8]]);
    assert_eq!(hits.len(), 6);
}

#[test]
fn unbuilt_grep_options_say_not_implemented() {
    let f = prompts(&["x"]);
    for (args, name) in [
        (&["grep", "x", "--raw"][..], "grep --raw"),
        (&["grep", "x", "--infer-branch"][..], "grep --infer-branch"),
        (
            &["grep", "x", "--fields", "ts"][..],
            "grep --fields with --format human",
        ),
        (&["grep"][..], "grep without a pattern"),
    ] {
        f.clrg()
            .args(args)
            .assert()
            .code(5)
            .stderr(format!("clrg {name}: not implemented (yet)\n"));
    }
}

#[test]
fn g7_hit_shows_cwd_branch_session_and_last_prompt() {
    let f = Fixture::new();
    let live = f.home().join("src/app");
    std::fs::create_dir_all(&live).unwrap();
    let a = At::new(10, live.to_str().unwrap(), "main");
    let b = a.branch("feature/x");
    f.transcript(
        "-home-src-app",
        &a,
        &[
            a.prompt(1, 1, "set up the fixture loader"),
            a.assistant(
                2,
                2,
                json!([{"type": "text", "text": "The loader is ready."}]),
            ),
            b.prompt(3, 3, "wire the seed data into the onboarding flow"),
            // The last user line is a tool result: not the last prompt.
            b.tool_result(4, 9, "loader output"),
        ],
    );
    // What the owner typed in session a, as history.jsonl records it.
    f.history(&[
        a.history(1, "set up the fixture loader"),
        b.history(3, "wire the seed data into the onboarding flow"),
    ]);
    let gone = At::new(11, "/work/gone", "main");
    f.transcript(
        "-work-gone",
        &gone,
        &[gone.prompt(1, 5, "where did the loader go")],
    );
    let out = f.grep_stdout(&["loader"]);
    assert_eq!(
        out,
        [
            "2026-08-02 14:09  ~/src/app  [main, feature/x]  0000000a",
            "  last: \"wire the seed data into the onboarding flow\"",
            "  14:01 user/text            set up the fixture loader",
            "  14:02 assistant/text       The loader is ready.",
            "  14:09 user/tool_result     loader output",
            "  14:01 history/text         set up the fixture loader",
            "",
            // No history for this session: the last user/text, unverified.
            "2026-08-02 14:05  /work/gone  [main]  0000000b  (cwd missing)",
            "  last: \"where did the loader go\" (unverified)",
            "  14:05 user/text            where did the loader go",
            "",
        ]
        .join("\n")
    );
    // --no-color and CLRG_COLOR are accepted; piped output never has color.
    let plain = f.grep_stdout(&["loader", "--color"]);
    assert!(!plain.contains('\x1b'), "{plain}");
    f.clrg()
        .env("CLRG_COLOR", "false")
        .args(["grep", "loader", "--no-color"])
        .assert()
        .success()
        .stdout(out);
}

#[test]
fn g8_current_folder_sessions_rank_first() {
    let f = Fixture::new();
    let base = f.root().canonicalize().unwrap();
    let here = base.join("work/app");
    std::fs::create_dir_all(&here).unwrap();
    let p = |rel: &str| base.join(rel).to_str().unwrap().to_string();
    // (seed, cwd, minute): near ones are old, far ones are new.
    let sessions = [
        (20, p("work/far"), 50),
        (21, p("work/app/sub"), 10), // inside here
        (22, p("work"), 20),         // contains here
        (23, p("work/app-old"), 40), // a name prefix is not a folder prefix
        (24, p("work/app"), 15),     // here
    ];
    for (seed, cwd, minute) in &sessions {
        let at = At::new(*seed, cwd, "main");
        f.transcript(
            &format!("p{seed}"),
            &at,
            &[at.prompt(1, *minute, "rank needle")],
        );
    }
    f.write("plans/plain-plan.md", "a rank needle in a plan\n");
    let other = Fixture::new();
    let at = At::new(25, "/work/elsewhere", "main");
    other.transcript("p25", &at, &[at.prompt(1, 59, "rank needle")]);

    let short = |seed: u32| fixtures::session_id(seed)[..8].to_string();
    let run = |format: &str| {
        f.clrg()
            .current_dir(&here)
            .arg("--root")
            .arg(other.root())
            .args(["grep", "rank needle", "--format", format])
            .output()
            .unwrap()
    };
    let out = run("jsonl");
    assert_eq!(out.status.code(), Some(0));
    let order: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| {
            let r: Value = serde_json::from_str(l).unwrap();
            r["session"].as_str().map_or_else(
                || r["store"].as_str().unwrap().to_string(),
                |s| s[..8].to_string(),
            )
        })
        .collect();
    assert_eq!(
        order,
        vec![
            short(24), // here or inside it: newest first
            short(21),
            short(22), // contains here: after those inside it
            short(20), // the rest of this root's transcripts, newest first
            short(23),
            "plans".to_string(), // this root's other stores
            short(25),           // the next root
        ]
    );
    // The human blocks come in the same order.
    let human = String::from_utf8(run("human").stdout).unwrap();
    let headers: Vec<&str> = human
        .lines()
        .filter(|l| !l.starts_with(' ') && !l.is_empty())
        .collect();
    assert_eq!(headers.len(), 7, "{human}");
    for (h, want) in headers.iter().zip(&order) {
        assert!(h.contains(want.as_str()), "{h} should name {want}");
    }
    assert!(headers[5].starts_with("plans  "), "{human}");
}

#[test]
fn g12_header_cwd_is_launch_folder() {
    let f = Fixture::new();
    let launch = f.home().join("src/my.app");
    std::fs::create_dir_all(&launch).unwrap();
    let launch = launch.to_str().unwrap().to_string();
    let project = launch.replace(['/', '.'], "-");
    // The session starts in the launch folder, then a tool `cd`s into a
    // folder that is gone now.
    let a = At::new(13, &launch, "main");
    let moved = At {
        cwd: format!("{launch}/gone-sub"),
        ..a.clone()
    };
    f.transcript(
        &project,
        &a,
        &[
            a.prompt(1, 1, "start the launch needle"),
            moved.prompt(2, 2, "later launch needle"),
        ],
    );
    // A session whose first cwd is not the one its project name encodes:
    // the encoded one wins.
    let b = At::new(14, "/work/side", "main");
    let home_b = At {
        cwd: launch.clone(),
        ..b.clone()
    };
    f.transcript(
        &project,
        &b,
        &[
            b.prompt(1, 3, "side launch needle"),
            home_b.prompt(2, 4, "x"),
        ],
    );
    let sid = fixtures::session_id(13);
    let out = f.grep_stdout(&["launch needle", "--session", &sid]);
    let header = out.lines().next().unwrap();
    assert!(header.contains("~/src/my.app  [main]"), "{out}");
    assert!(!header.contains("(cwd missing)"), "{out}");
    assert!(!header.contains("gone-sub"), "{out}");
    // Per-hit records keep the cwd of their own line.
    let cwds: Vec<String> = f
        .grep_jsonl(&["launch needle", "--session", &sid])
        .iter()
        .map(|r| r["cwd"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(cwds, vec![launch.clone(), format!("{launch}/gone-sub")]);
    let values = f.grep_stdout(&["launch needle", "--format", "values"]);
    let mut lines: Vec<&str> = values.lines().collect();
    lines.sort_unstable();
    let want_b = format!("{}:{launch}", fixtures::session_id(14));
    let want_a = format!("{sid}:{launch}");
    assert_eq!(lines, vec![want_a.as_str(), want_b.as_str()]);
    // `sessions` reports the same folder.
    let out = f
        .clrg()
        .args(["sessions", "--format", "values"])
        .output()
        .unwrap();
    let mut lines: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect();
    lines.sort_unstable();
    assert_eq!(lines, vec![want_a, want_b]);
}

#[test]
fn g11_jsonl_record_shape_is_stable() {
    let f = Fixture::new();
    let at = At::new(12, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[at.prompt(1, 5, "the stable record needle here")],
    );
    f.history(&[at.history(5, "the stable record needle here")]);
    let out = f
        .clrg()
        .args(["grep", "needle", "--format", "jsonl"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let root = f.root().to_str().unwrap();
    let sid = fixtures::session_id(12);
    let text = String::from_utf8(out.stdout)
        .unwrap()
        .replace(root, "<root>")
        .replace(&sid, "<sid>");
    let expected = concat!(
        r#"{"root":"<root>","store":"transcripts","#,
        r#""path":"<root>/projects/-work-app/<sid>.jsonl","#,
        r#""session":"<sid>","cwd":"/work/app","#,
        r#""cwd_exists":false,"branch":"main","ts":"2026-08-02T14:05:00.000Z","#,
        r#""type":"user","part":"text","line":1,"excerpt":"the stable record needle here","#,
        r#""match_start":18,"match_end":24,"#,
        r#""last":true,"agreement":"both","agreement_rule":"exact"}"#,
        "\n",
        r#"{"root":"<root>","store":"history","#,
        r#""path":"<root>/history.jsonl","#,
        r#""session":"<sid>","cwd":"/work/app","#,
        r#""cwd_exists":false,"branch":null,"ts":"2026-08-02T14:05:00.000Z","#,
        r#""type":"history","part":"text","line":1,"excerpt":"the stable record needle here","#,
        r#""match_start":18,"match_end":24,"#,
        r#""last":null,"agreement":"both","agreement_rule":"exact"}"#,
        "\n"
    );
    assert_eq!(text, expected);
    // The field names, in order: the contract in INTENT.md.
    let first = expected.lines().next().unwrap();
    let names: Vec<&str> = first
        .trim_start_matches('{')
        .trim_end_matches('}')
        .split(',')
        .filter_map(|kv| {
            kv.strip_prefix('"')
                .and_then(|k| k.split_once("\":"))
                .map(|(k, _)| k)
        })
        .collect();
    assert_eq!(
        names,
        vec![
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
            "agreement_rule"
        ]
    );
}
