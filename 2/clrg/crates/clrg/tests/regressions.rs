//! Regression tests for review findings: inserted user text found by
//! agreement (not by a skip list), short
//! and non-ASCII session ids, CRLF line anchors, saved tool results, control
//! characters in machine output, `-l --limit`, unreadable files (R4), and
//! near ordering (R5).

mod fixtures;

use fixtures::{At, Fixture, session_id};
use serde_json::{Value, json};

/// A user line with the given extra top-level fields and content.
fn user(at: &At, n: u32, minute: u32, content: &Value, extra: &Value) -> Value {
    at.user(n, minute, content, extra)
}

#[test]
fn commands_interrupts_and_summaries_are_found_by_agreement() {
    let f = Fixture::new();
    let at = At::new(40, "/work/app", "main");
    let none = json!({});
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "find the needle please"),
            user(
                &at,
                2,
                2,
                &json!("<command-name>/exit</command-name>\n<command-message>exit needle</command-message>"),
                &none,
            ),
            user(
                &at,
                3,
                3,
                &json!("<local-command-stdout>Bye needle</local-command-stdout>"),
                &none,
            ),
            user(
                &at,
                4,
                4,
                &json!([{"type": "text", "text": "[Request interrupted by user for tool use] needle"}]),
                &none,
            ),
            user(
                &at,
                5,
                5,
                &json!("This session is being continued from a previous conversation needle"),
                &json!({"isCompactSummary": true}),
            ),
            user(&at, 6, 6, &json!("caveat needle"), &json!({"isMeta": true})),
        ],
    );
    f.history(&[
        at.history(1, "find the needle please"),
        at.history(2, "/exit"),
    ]);
    let recs = f.grep_jsonl(&["needle", "--store", "transcripts"]);
    let got: Vec<(String, String, Value)> = recs
        .iter()
        .map(|r| {
            (
                format!(
                    "{}/{}",
                    r["type"].as_str().unwrap(),
                    r["part"].as_str().unwrap()
                ),
                r["agreement"].as_str().unwrap().to_string(),
                r["agreement_rule"].clone(),
            )
        })
        .collect();
    let want = |a: &str, r: Value| ("user/text".to_string(), a.to_string(), r);
    assert_eq!(
        got,
        vec![
            want("both", json!("exact")),
            want("both", json!("slash-command")),
            want("transcript-only", Value::Null),
            want("transcript-only", Value::Null),
            want("transcript-only", Value::Null),
            want("transcript-only", Value::Null),
        ]
    );
    assert_eq!(
        f.grep_jsonl(&["needle", "--in", "user/text", "--agree", "both"])
            .len(),
        2
    );
    // The last line that agreed is the /exit command; the isMeta caveat
    // after it is shown as not in history.
    let out = f.grep_stdout(&["needle"]);
    let lines: Vec<&str> = out.lines().collect();
    assert!(
        lines[1].starts_with("  last: \"<command-name>/exit</command-name>"),
        "{out}"
    );
    assert_eq!(
        lines[2], "        \"caveat needle\" (not in history)",
        "{out}"
    );
    let rows = f
        .clrg()
        .args(["sessions", "--format", "jsonl"])
        .output()
        .unwrap();
    let row: Value = serde_json::from_slice(&rows.stdout).unwrap();
    assert!(row["last"].as_str().unwrap().contains("/exit"), "{row}");
}

#[test]
fn short_non_ascii_session_ids_do_not_panic() {
    let f = Fixture::new();
    f.jsonl(
        "history.jsonl",
        &[json!({"display": "needle", "project": "/work", "sessionId": "a\u{e9}\u{e9}\u{e9}\u{e9}"})],
    );
    let out = f.grep_stdout(&["needle"]);
    assert!(out.starts_with("/work  a\u{e9}\u{e9}\u{e9}\u{e9}"), "{out}");
}

#[test]
fn regex_line_anchors_work_on_crlf_files() {
    let f = Fixture::new();
    f.write("plans/p.md", "a line with needle\r\nother\r\n");
    let at = At::new(41, "/work/app", "main");
    let mut bytes = b"\xEF\xBB\xBF".to_vec();
    bytes.extend(at.prompt(1, 1, "needle bom").to_string().as_bytes());
    bytes.extend(b"\r\n");
    f.write(&format!("projects/-work-app/{}.jsonl", at.session), bytes);
    let stores: Vec<String> = f
        .grep_jsonl(&["-E", "needle$|bom$"])
        .iter()
        .map(|r| r["store"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(stores, vec!["transcripts", "plans"]);
    assert_eq!(f.grep_jsonl(&["-E", "^other$"]).len(), 1);
}

#[test]
fn saved_tool_results_are_searched_as_their_sessions() {
    let f = Fixture::new();
    let at = At::new(42, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "hello")]);
    let saved = f.write(
        &format!("projects/-work-app/{}/tool-results/toolu_1.txt", at.session),
        "big output\nwith the needle inside\n",
    );
    let hits = f.grep_jsonl(&["needle"]);
    assert_eq!(hits.len(), 1);
    let h = &hits[0];
    assert_eq!(h["store"], "transcripts");
    // The file has no line type, and its folder name is not a label (R9).
    assert_eq!((&h["type"], &h["part"]), (&Value::Null, &Value::Null));
    assert_eq!(h["session"], at.session.as_str());
    assert_eq!(h["path"], saved.to_str().unwrap());
    assert_eq!(h["line"], 2);
    // Narrowed by --in and --store like any transcript hit.
    f.clrg()
        .args(["grep", "needle", "--in", "user/text"])
        .assert()
        .code(1);
    f.clrg()
        .args(["grep", "needle", "--in", "tool_result"])
        .assert()
        .code(1);
    assert_eq!(f.grep_jsonl(&["needle", "--store", "transcripts"]).len(), 1);
    f.clrg()
        .args(["grep", "needle", "--store", "plans"])
        .assert()
        .code(1);
    // The human block is the session's, with its header.
    let out = f.grep_stdout(&["needle"]);
    assert!(
        out.starts_with("2026-08-02 14:01  /work/app  [main]"),
        "{out}"
    );
    // Saved outputs are not transcripts for `sessions`.
    let rows = f
        .clrg()
        .args(["sessions", "--format", "jsonl"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8(rows.stdout).unwrap().lines().count(), 1);
}

#[test]
fn machine_formats_strip_control_characters() {
    let f = Fixture::new();
    let at = At::new(43, "/tmp/\u{1b}]0;pwned\u{7}x", "main");
    f.transcript(
        "-tmp",
        &at,
        &[at.prompt(1, 1, "needle \u{1b}[2J and \u{9b}31m")],
    );
    for format in ["tsv", "values"] {
        let out = f.grep_stdout(&["needle", "--format", format]);
        assert!(
            !out.chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t'),
            "{format}: {out:?}"
        );
        assert!(out.contains("/tmp/ ]0;pwned x"), "{format}: {out:?}");
    }
    let out = f
        .clrg()
        .args(["sessions", "--format", "values"])
        .output()
        .unwrap();
    let out = String::from_utf8(out.stdout).unwrap();
    assert!(!out.contains('\u{1b}') && !out.contains('\u{7}'), "{out:?}");
}

#[test]
fn files_with_matches_limit_counts_files() {
    let f = Fixture::new();
    for seed in 44..47 {
        let at = At::new(seed, "/work/app", "main");
        f.transcript(
            "-work-app",
            &at,
            &[at.prompt(1, 1, "needle a"), at.prompt(2, 2, "needle b")],
        );
    }
    let out = f.grep_stdout(&["-l", "-n", "2", "needle"]);
    assert_eq!(out.lines().count(), 2, "{out}");
    let out = f.grep_stdout(&["-l", "needle"]);
    assert_eq!(out.lines().count(), 3, "{out}");
}

#[cfg(unix)]
#[test]
fn unreadable_files_are_not_counted_as_searched() {
    use std::os::unix::fs::PermissionsExt as _;
    let f = Fixture::new();
    let at = At::new(47, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "hello")]);
    let locked = At::new(48, "/work/app", "main");
    let path = f.transcript("-work-app", &locked, &[locked.prompt(1, 1, "hello")]);
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::read(&path).is_ok() {
        // Running as root: permissions do not stop reads; nothing to test.
        return;
    }
    let out = f.clrg().args(["grep", "zzz"]).output().unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("searched 1 file(s)"), "{err}");
    assert!(err.contains("unreadable: 1 file(s)"), "{err}");
    // None unreadable: no such line.
    let out = f.clrg().args(["grep", "zzz"]).output().unwrap();
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("searched 2 file(s)"), "{err}");
    assert!(!err.contains("unreadable"), "{err}");
}

#[test]
fn root_and_home_are_not_near_by_containment() {
    let f = Fixture::new();
    let base = f.root().canonicalize().unwrap();
    let home = base.join("home");
    let here = home.join("src/app");
    std::fs::create_dir_all(&here).unwrap();
    let s = |p: &std::path::Path| p.to_str().unwrap().to_string();
    // (seed, cwd, minute)
    let sessions = [
        (50, s(&home), 50),
        (51, "/".to_string(), 40),
        (52, s(&here), 10),
        (53, "/work/far".to_string(), 30),
        (54, s(&home.join("src")), 5),
    ];
    for (seed, cwd, minute) in &sessions {
        let at = At::new(*seed, cwd, "main");
        f.transcript(
            &format!("p{seed}"),
            &at,
            &[at.prompt(1, *minute, "near needle")],
        );
    }
    let out = f
        .clrg()
        .env("HOME", &home)
        .current_dir(&here)
        .args(["grep", "near needle", "--format", "jsonl"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0));
    let order: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| {
            let r: Value = serde_json::from_str(l).unwrap();
            r["session"].as_str().unwrap().to_string()
        })
        .collect();
    let id = session_id;
    assert_eq!(order, vec![id(52), id(54), id(50), id(51), id(53)]);
}
