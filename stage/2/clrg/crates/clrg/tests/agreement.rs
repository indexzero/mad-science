//! Raw labels (R9), `last`, and agreement between `history.jsonl` and
//! transcripts (R10): l1, l2, a1–a6, and c1 from INTENT.md "Done".

mod fixtures;

use std::collections::BTreeSet;

use fixtures::{At, Fixture, ms, session_id};
use serde_json::{Value, json};

/// `type/part` of a record, or whichever it has, or `-`.
fn label(r: &Value) -> String {
    match (r["type"].as_str(), r["part"].as_str()) {
        (Some(t), Some(p)) => format!("{t}/{p}"),
        (Some(one), None) | (None, Some(one)) => one.to_string(),
        (None, None) => "-".to_string(),
    }
}

/// (`excerpt`, `agreement`, `agreement_rule`) of each record.
fn agreements(recs: &[Value]) -> Vec<(String, Value, Value)> {
    recs.iter()
        .map(|r| {
            (
                r["excerpt"].as_str().unwrap().to_string(),
                r["agreement"].clone(),
                r["agreement_rule"].clone(),
            )
        })
        .collect()
}

/// The labels the data holds, and the words clrg used to derive instead.
const DERIVED: [&str; 3] = ["prompt", "other", "assistant "];

#[test]
fn l1_labels_are_raw_type_and_part() {
    let f = Fixture::new();
    let at = At::new(60, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "typed zebra"),
            at.assistant(
                2,
                2,
                json!([
                    {"type": "thinking", "thinking": "thinking zebra"},
                    {"type": "text", "text": "answer zebra"},
                    {"type": "tool_use", "id": "toolu_fake", "name": "Bash", "input": {"command": "echo zebra"}}
                ]),
            ),
            at.tool_result(3, 3, "result zebra"),
            at.user(4, 4, &json!("meta zebra"), &json!({"isMeta": true})),
            json!({"type": "system", "subtype": "x", "content": "system zebra", "timestamp": "2026-08-02T14:05:00.000Z"}),
            json!({"type": "summary", "summary": "summary zebra", "leafUuid": "x"}),
        ],
    );
    f.history(&[at.history(1, "typed zebra")]);
    f.write("plans/calm-lake.md", "plan zebra\n");

    let recs = f.grep_jsonl(&["zebra"]);
    let labels: BTreeSet<String> = recs.iter().map(label).collect();
    let want: BTreeSet<String> = [
        "user/text",
        "assistant/thinking",
        "assistant/text",
        "assistant/tool_use",
        "user/tool_result",
        "system",
        "summary",
        "history/text",
        "-",
    ]
    .iter()
    .map(|s| (*s).to_string())
    .collect();
    assert_eq!(labels, want);
    // The isMeta line is user/text like any other; agreement tells it apart.
    let meta = recs.iter().find(|r| r["excerpt"] == "meta zebra").unwrap();
    assert_eq!(label(meta), "user/text");
    assert_eq!(meta["agreement"], "transcript-only");
    // A plan has no line type and no part.
    let plan = recs.iter().find(|r| r["store"] == "plans").unwrap();
    assert_eq!((&plan["type"], &plan["part"]), (&Value::Null, &Value::Null));

    // No derived label in any format.
    for args in [
        &["zebra"][..],
        &["zebra", "--format", "jsonl"],
        &["zebra", "--format", "json"],
        &["zebra", "--format", "tsv", "--fields", "type,part"],
        &["zebra", "--format", "values"],
        &["zebra", "-C", "1"],
    ] {
        let out = f.grep_stdout(args);
        for word in DERIVED {
            assert!(!out.contains(word), "{args:?} output has {word:?}: {out}");
        }
    }
    let human = f.grep_stdout(&["zebra"]);
    for l in [
        "user/text ",
        "assistant/tool_use ",
        "user/tool_result ",
        "system ",
        "history/text ",
    ] {
        assert!(human.contains(l), "{l:?} in {human}");
    }
    // `--in` takes the raw names; the old derived ones match nothing.
    for old in ["prompt", "other"] {
        f.clrg()
            .args(["grep", "zebra", "--in", old])
            .assert()
            .code(1);
    }
    let only = |sel: &str| -> BTreeSet<String> {
        f.grep_jsonl(&["zebra", "--in", sel])
            .iter()
            .map(label)
            .collect()
    };
    assert_eq!(only("user/text"), BTreeSet::from(["user/text".to_string()]));
    assert_eq!(
        only("history"),
        BTreeSet::from(["history/text".to_string()])
    );
    assert_eq!(
        only("tool_result"),
        BTreeSet::from(["user/tool_result".to_string()])
    );
}

#[test]
fn l2_last_marks_the_sessions_last_user_text() {
    let f = Fixture::new();
    let at = At::new(61, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "first okapi"),
            at.assistant(2, 2, json!([{"type": "text", "text": "reply okapi"}])),
            at.prompt(3, 3, "second okapi"),
            at.tool_result(4, 4, "result okapi"),
            // The last user/text line is inserted text: `last` is about the
            // line, not about agreement.
            at.user(5, 5, &json!("notice okapi"), &json!({"isMeta": true})),
            at.tool_result(6, 6, "later result okapi"),
        ],
    );
    f.jsonl(
        &format!("projects/-work-app/{}/subagents/agent-a1.jsonl", at.session),
        &[at.prompt(1, 7, "subagent okapi")],
    );
    f.history(&[at.history(1, "first okapi"), at.history(3, "second okapi")]);
    let recs = f.grep_jsonl(&["okapi"]);
    let got: BTreeSet<(String, String, String)> = recs
        .iter()
        .map(|r| {
            (
                r["excerpt"].as_str().unwrap().to_string(),
                label(r),
                r["last"].to_string(),
            )
        })
        .collect();
    let row = |e: &str, l: &str, v: &str| (e.to_string(), l.to_string(), v.to_string());
    assert_eq!(
        got,
        BTreeSet::from([
            row("first okapi", "user/text", "false"),
            row("second okapi", "user/text", "false"),
            row("notice okapi", "user/text", "true"),
            row("subagent okapi", "user/text", "false"),
            row("reply okapi", "assistant/text", "null"),
            row("result okapi", "user/tool_result", "null"),
            row("later result okapi", "user/tool_result", "null"),
            row("first okapi", "history/text", "null"),
            row("second okapi", "history/text", "null"),
        ])
    );
    // A search that misses the last line marks no record true.
    let some = f.grep_jsonl(&["second okapi", "--store", "transcripts"]);
    assert_eq!(some.len(), 1);
    assert_eq!(some[0]["last"], false);
}

#[test]
fn a1_agreement_rules_in_order() {
    let f = Fixture::new();
    let at = At::new(62, "/work/app", "main");
    let text = |n: u32, s: &str| at.prompt(n, n, s);
    f.transcript(
        "-work-app",
        &at,
        &[
            // 1. exact
            text(1, "lynx one exactly"),
            // 2. whitespace
            text(2, "lynx   two\n spaced "),
            // 3. paste-expanded
            text(3, "lynx three: line a\nline b end"),
            // 4. placeholder-wildcard (a hashed paste and an image)
            text(4, "lynx four sees the picture and the pasted words here"),
            // 5. slash-command
            text(
                5,
                "<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>lynx five</command-args>",
            ),
            // Rule 1 wins over rule 4: the placeholder is in both.
            text(6, "lynx six [Image #1]"),
            // No rule: transcript-only.
            text(7, "lynx seven never typed"),
        ],
    );
    let h = |minute: u32, display: &str, pastes: Value| {
        let mut v = at.history(minute, display);
        v["pastedContents"] = pastes;
        v
    };
    f.history(&[
        h(1, "lynx one exactly", json!({})),
        h(2, "lynx two spaced", json!({})),
        h(
            3,
            "lynx three: [Pasted text #1 +2 lines] end",
            json!({"1": {"id": 1, "type": "text", "content": "line a\nline b"}}),
        ),
        h(
            4,
            "lynx four sees [Image #1] and [Pasted text #2 +9 lines] here",
            json!({"2": {"id": 2, "type": "text", "contentHash": "0123456789abcdef"}}),
        ),
        h(5, "/review lynx five", json!({})),
        h(6, "lynx six [Image #1]", json!({})),
    ]);
    let recs = f.grep_jsonl(&["lynx", "--store", "transcripts"]);
    let rules: Vec<(Value, Value)> = recs
        .iter()
        .map(|r| (r["agreement"].clone(), r["agreement_rule"].clone()))
        .collect();
    let both = |r: &str| (json!("both"), json!(r));
    assert_eq!(
        rules,
        vec![
            both("exact"),
            both("whitespace"),
            both("paste-expanded"),
            both("placeholder-wildcard"),
            both("slash-command"),
            both("exact"),
            (json!("transcript-only"), Value::Null),
        ]
    );
    // The history side carries the same rule.
    let hist = f.grep_jsonl(&["lynx", "--store", "history"]);
    let hrules: Vec<Value> = hist.iter().map(|r| r["agreement_rule"].clone()).collect();
    assert_eq!(
        hrules,
        [
            "exact",
            "whitespace",
            "paste-expanded",
            "placeholder-wildcard",
            "slash-command",
            "exact"
        ]
        .map(|r| json!(r))
    );
}

#[test]
fn a2_inserted_text_is_transcript_only() {
    let f = Fixture::new();
    let at = At::new(63, "/work/app", "main");
    let none = json!({});
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "please fix the heron build"),
            at.user(
                2,
                2,
                &json!("Caveat: the heron messages below were generated"),
                &json!({"isMeta": true}),
            ),
            at.user(
                3,
                3,
                &json!("Your heron request was stopped by the auto mode classifier."),
                &json!({"isMeta": true}),
            ),
            at.user(
                4,
                4,
                &json!([{"type": "text", "text": "[Request interrupted by user] heron"}]),
                &none,
            ),
            at.user(
                5,
                5,
                &json!("<task-notification><status>completed</status>heron</task-notification>"),
                &none,
            ),
            at.prompt(6, 6, "and the heron tests"),
        ],
    );
    f.history(&[
        at.history(1, "please fix the heron build"),
        at.history(6, "and the heron tests"),
    ]);
    let recs = f.grep_jsonl(&["heron", "--store", "transcripts"]);
    let got: Vec<Value> = recs.iter().map(|r| r["agreement"].clone()).collect();
    assert_eq!(
        got,
        [
            "both",
            "transcript-only",
            "transcript-only",
            "transcript-only",
            "transcript-only",
            "both"
        ]
        .map(|a| json!(a))
    );
    // "Only what I typed": --in user/text --agree both.
    let typed: Vec<String> = f
        .grep_jsonl(&["heron", "--in", "user/text", "--agree", "both"])
        .iter()
        .map(|r| r["excerpt"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(typed, ["please fix the heron build", "and the heron tests"]);
    // Human: the inserted lines are marked.
    let out = f.grep_stdout(&["heron", "--store", "transcripts"]);
    let marked = out
        .lines()
        .filter(|l| l.contains("user/text (not in history)"))
        .count();
    assert_eq!(marked, 4, "{out}");
    // --agree keeps hits that have no agreement value.
    let f2 = Fixture::new();
    let b = At::new(64, "/work/app", "main");
    f2.transcript(
        "-work-app",
        &b,
        &[b.assistant(1, 1, json!([{"type": "text", "text": "heron answer"}]))],
    );
    assert_eq!(f2.grep_jsonl(&["heron", "--agree", "both"]).len(), 1);
}

#[test]
fn a3_history_without_transcript_is_unknown_or_history_only() {
    let f = Fixture::new();
    let has = At::new(65, "/work/app", "main");
    let missing = At::new(66, "/work/app", "main");
    f.transcript(
        "-work-app",
        &has,
        &[has.prompt(1, 1, "the ibis transcript text")],
    );
    f.history(&[
        has.history(1, "the ibis transcript text"),
        // Typed in a session whose transcript exists, but never recorded.
        has.history(2, "an ibis line the transcript lacks"),
        // A session with no transcript in any searched root.
        missing.history(3, "ibis from a lost session"),
    ]);
    let recs = f.grep_jsonl(&["ibis", "--store", "history"]);
    let mut got = agreements(&recs);
    got.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        got,
        vec![
            (
                "an ibis line the transcript lacks".into(),
                json!("history-only"),
                Value::Null
            ),
            (
                "ibis from a lost session".into(),
                json!("unknown"),
                Value::Null
            ),
            (
                "the ibis transcript text".into(),
                json!("both"),
                json!("exact")
            ),
        ]
    );
    // The other way: a transcript with no history anywhere is unknown.
    let g = Fixture::new();
    let lone = At::new(67, "/work/app", "main");
    g.transcript("-work-app", &lone, &[lone.prompt(1, 1, "ibis alone")]);
    let r = &g.grep_jsonl(&["ibis"])[0];
    assert_eq!(
        (&r["agreement"], &r["agreement_rule"]),
        (&json!("unknown"), &Value::Null)
    );
    // Across roots: history in one root, the transcript in another.
    let other = Fixture::new();
    other.transcript(
        "-work-app",
        &missing,
        &[missing.prompt(3, 3, "ibis from a lost session")],
    );
    let out = f
        .clrg()
        .arg("--root")
        .arg(other.root())
        .args(["grep", "lost session", "--format", "jsonl", "-q"])
        .output()
        .unwrap();
    let recs: Vec<Value> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(recs.len(), 2);
    for r in &recs {
        assert_eq!(r["agreement"], "both", "{r}");
    }
}

#[test]
fn a4_history_without_session_id_is_unlinked() {
    let f = Fixture::new();
    f.history(&[
        json!({"display": "an old wombat prompt", "pastedContents": {},
                       "timestamp": ms(1), "project": "/work/app"}),
    ]);
    let recs = f.grep_jsonl(&["wombat"]);
    assert_eq!(recs.len(), 1);
    let r = &recs[0];
    assert_eq!(
        (&r["store"], &r["session"]),
        (&json!("history"), &Value::Null)
    );
    assert_eq!(label(r), "history/text");
    assert_eq!(
        (&r["agreement"], &r["agreement_rule"]),
        (&json!("unlinked"), &Value::Null)
    );
    assert_eq!(r["last"], Value::Null);
    assert_eq!(f.grep_jsonl(&["wombat", "--agree", "unlinked"]).len(), 1);
    f.clrg()
        .args(["grep", "wombat", "--agree", "both"])
        .assert()
        .code(1);
}

#[test]
fn a5_last_line_prefers_agreed_text() {
    let f = Fixture::new();
    // Agreed, then a later inserted line.
    let a = At::new(68, "/work/a", "main");
    f.transcript(
        "-work-a",
        &a,
        &[
            a.prompt(1, 1, "typed tapir request"),
            a.user(
                2,
                2,
                &json!("Your tapir response was stopped by a classifier"),
                &json!({"isMeta": true}),
            ),
        ],
    );
    // No history at all for this session.
    let b = At::new(69, "/work/b", "main");
    f.transcript("-work-b", &b, &[b.prompt(1, 3, "unchecked tapir request")]);
    // History, but nothing agrees.
    let c = At::new(70, "/work/c", "main");
    f.transcript("-work-c", &c, &[c.prompt(1, 4, "drifted tapir request")]);
    f.history(&[
        a.history(1, "typed tapir request"),
        c.history(4, "something else entirely"),
    ]);
    let out = f.grep_stdout(&["tapir", "--store", "transcripts"]);
    let blocks: Vec<&str> = out.split("\n\n").collect();
    let block = |sid: u32| {
        *blocks
            .iter()
            .find(|b| b.lines().next().unwrap().contains(&session_id(sid)[..8]))
            .unwrap()
    };
    let lines = |b: &str| {
        b.lines()
            .skip(1)
            .take(2)
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        lines(block(68)),
        [
            "  last: \"typed tapir request\"",
            "        \"Your tapir response was stopped by a classifier\" (not in history)",
        ]
    );
    assert_eq!(
        lines(block(69))[0],
        "  last: \"unchecked tapir request\" (unverified)"
    );
    assert_eq!(
        lines(block(70))[0],
        "  last: \"drifted tapir request\" (not in history)"
    );
    // `sessions` shows the same text and markers.
    let rows = f.clrg().args(["sessions"]).output().unwrap();
    let rows = String::from_utf8(rows.stdout).unwrap();
    let row = |sid: u32| {
        rows.lines()
            .find(|l| l.contains(&session_id(sid)[..8]))
            .unwrap()
            .to_string()
    };
    // Cut to fit the width; the markers stay.
    assert!(row(68).contains("  \"typed tapir"), "{rows}");
    assert!(row(68).contains("  \"Your tapir"), "{rows}");
    assert!(row(68).ends_with("…\" (not in history)"), "{rows}");
    assert!(row(69).contains("  \"unchecked tapir"), "{rows}");
    assert!(row(69).ends_with("\" (unverified)"), "{rows}");
    assert!(row(70).contains("  \"drifted tapir"), "{rows}");
    assert!(row(70).ends_with("\" (not in history)"), "{rows}");
    let recs: Vec<Value> = String::from_utf8(
        f.clrg()
            .args(["sessions", "--format", "jsonl"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .lines()
    .map(|l| serde_json::from_str(l).unwrap())
    .collect();
    let last = |sid: u32| {
        recs.iter()
            .find(|r| r["session"] == session_id(sid))
            .unwrap()["last"]
            .clone()
    };
    assert_eq!(last(68), "typed tapir request");
    assert_eq!(last(69), "unchecked tapir request");
}

#[test]
fn a6_disagreement_counts_reported() {
    let f = Fixture::new();
    let at = At::new(71, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[
            at.prompt(1, 1, "typed quokka"),
            at.user(2, 2, &json!("inserted quokka"), &json!({"isMeta": true})),
            at.user(
                3,
                3,
                &json!("[Request interrupted by user] quokka"),
                &json!({}),
            ),
        ],
    );
    f.history(&[
        at.history(1, "typed quokka"),
        at.history(4, "a quokka line with no transcript line"),
    ]);
    let (_, err) = f.grep_both(&["quokka"]);
    assert_eq!(
        err,
        "clrg: agreement: 2 transcript-only, 1 history-only (user/text vs history.jsonl; see --agree)\n"
    );
    // The count is of the results shown.
    let (_, err) = f.grep_both(&["quokka", "--store", "history"]);
    assert!(err.contains(" 0 transcript-only, 1 history-only "), "{err}");
    let (_, err) = f.grep_both(&["quokka", "--agree", "both"]);
    assert!(err.contains(" 0 transcript-only, 0 history-only "), "{err}");
    // -q suppresses it.
    let (_, err) = f.grep_both(&["quokka", "-q"]);
    assert_eq!(err, "");
    // `sessions` reports the listed sessions' counts.
    let out = f.clrg().args(["sessions"]).output().unwrap();
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "clrg: agreement: 2 transcript-only, 1 history-only (user/text vs history.jsonl; see --agree)\n"
    );
    let out = f.clrg().args(["sessions", "-q"]).output().unwrap();
    assert!(out.stderr.is_empty());
}

#[test]
#[allow(clippy::too_many_lines)] // Every command's records, then every name.
fn c1_cognetics_lists_every_record_field() {
    let doc = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../COGNETICS.md"),
    )
    .expect("COGNETICS.md at the project root");
    // The field names, read from real records, not from a list here.
    let f = Fixture::new();
    let at = At::new(72, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "a gecko")]);
    let mut fields: BTreeSet<String> = BTreeSet::new();
    for r in f.grep_jsonl(&["gecko"]) {
        fields.extend(r.as_object().unwrap().keys().cloned());
    }
    let out = f
        .clrg()
        .args(["sessions", "--format", "jsonl"])
        .output()
        .unwrap();
    for l in String::from_utf8(out.stdout).unwrap().lines() {
        let r: Value = serde_json::from_str(l).unwrap();
        fields.extend(r.as_object().unwrap().keys().cloned());
    }
    let (rf, _) = fixtures::recovery();
    let out = rf
        .clrg()
        .args(["files", "--format", "jsonl"])
        .output()
        .unwrap();
    for l in String::from_utf8(out.stdout).unwrap().lines() {
        let r: Value = serde_json::from_str(l).unwrap();
        fields.extend(r.as_object().unwrap().keys().cloned());
    }
    // extract's records (the manifest's shape), from a dry run.
    let tmp = tempfile::tempdir().unwrap();
    let out = rf
        .clrg()
        .args([
            "extract",
            "--dry-run",
            "--format",
            "jsonl",
            "--version",
            "all",
            "-o",
        ])
        .arg(tmp.path().join("out"))
        .output()
        .unwrap();
    let mut extract_fields = 0;
    for l in String::from_utf8(out.stdout).unwrap().lines() {
        let r: Value = serde_json::from_str(l).unwrap();
        extract_fields = r.as_object().unwrap().len();
        fields.extend(r.as_object().unwrap().keys().cloned());
    }
    assert_eq!(extract_fields, 15);
    assert!(fields.len() >= 17 + 10 + 6 + 9, "{fields:?}");
    let values = [
        "both",
        "transcript-only",
        "history-only",
        "unlinked",
        "unknown",
        "exact",
        "whitespace",
        "paste-expanded",
        "placeholder-wildcard",
        "slash-command",
        // Build 2: event kinds, outcome, recoverable, the evidence values
        // on states, and extract's options and manifest.
        "backup",
        "write",
        "edit",
        "rejected",
        "returned",
        "read",
        "written",
        "full",
        "diff-only",
        "none",
        "verified",
        "agree",
        "disagree",
        "similarity",
        "journal",
        "workflows",
        "source_event",
        "out_path",
        "sha256",
        "MANIFEST.jsonl",
        "--version",
        "--source",
        "--layout",
        "first",
        "last",
        "all",
        "best",
        "file-history",
        "transcript",
        "cwd",
        "absolute",
        "session",
        "--dry-run",
        "--created-only",
    ];
    let missing: Vec<&str> = fields
        .iter()
        .map(String::as_str)
        .chain(values)
        .filter(|name| !doc.contains(&format!("`{name}`")))
        .collect();
    assert!(missing.is_empty(), "not in COGNETICS.md: {missing:?}");
    for part in [
        "## 1. Extraction",
        "## 2. Added values",
        "## 3. Cross-references",
    ] {
        assert!(doc.contains(part), "COGNETICS.md has {part:?}");
    }
}

/// `clrg grep <args> --format jsonl -q` over `f`'s root and then `more`'s.
fn grep_roots(f: &Fixture, more: &Fixture, args: &[&str]) -> (Vec<Value>, String) {
    let out = f
        .clrg()
        .arg("--root")
        .arg(more.root())
        .arg("grep")
        .args(args)
        .args(["--format", "jsonl"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{out:?}");
    let recs = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    (recs, String::from_utf8(out.stderr).unwrap())
}

#[test]
fn a7_agreement_unions_roots() {
    // Root A holds the whole transcript; root B is an older backup that
    // holds only its first line. Both hold the whole history.
    let a = Fixture::new();
    let b = Fixture::new();
    let at = At::new(70, "/work/app", "main");
    let first = at.prompt(1, 1, "okapi first prompt");
    let second = at.prompt(2, 5, "okapi second prompt");
    a.transcript("-work-app", &at, &[first.clone(), second]);
    b.transcript("-work-app", &at, &[first]);
    let history = [
        at.history(1, "okapi first prompt"),
        at.history(5, "okapi second prompt"),
    ];
    a.history(&history);
    b.history(&history);
    let (recs, err) = grep_roots(&a, &b, &["okapi"]);
    // 2 user/text in A, 1 in B, and 2 history lines in each root.
    assert_eq!(recs.len(), 7, "{recs:?}");
    for r in &recs {
        // One history line has one agreement, whichever root shows it: the
        // second prompt is not history-only in B because B's copy of the
        // transcript lacks it.
        assert_eq!(
            (&r["agreement"], &r["agreement_rule"]),
            (&json!("both"), &json!("exact")),
            "{r}"
        );
    }
    assert!(
        err.contains("clrg: agreement: 0 transcript-only, 0 history-only"),
        "{err}"
    );
    // The same line in both roots is one line (deduplicated by uuid): the
    // session's last user/text is the second prompt, in either root.
    let last: Vec<(&str, &Value)> = recs
        .iter()
        .filter(|r| r["type"] == "user")
        .map(|r| (r["excerpt"].as_str().unwrap(), &r["last"]))
        .collect();
    assert_eq!(
        last,
        vec![
            ("okapi first prompt", &json!(false)),
            ("okapi second prompt", &json!(true)),
            ("okapi first prompt", &json!(false)),
        ]
    );
    // Each root's block shows the same `last:` line.
    let out = a
        .clrg()
        .arg("--root")
        .arg(b.root())
        .args(["grep", "okapi first"])
        .output()
        .unwrap();
    let human = String::from_utf8(out.stdout).unwrap();
    assert_eq!(
        human.matches("last: \"okapi second prompt\"").count(),
        2,
        "{human}"
    );
    // `sessions` pairs the same way: no history-only line in either row.
    let out = a
        .clrg()
        .arg("--root")
        .arg(b.root())
        .args(["sessions", "--format", "jsonl"])
        .output()
        .unwrap();
    let rows: Vec<Value> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(rows.len(), 2);
    for r in &rows {
        assert_eq!(r["last"], "okapi second prompt", "{r}");
    }
}

#[test]
fn a8_placeholder_rule_has_a_time_window() {
    let f = Fixture::new();
    let at = At::new(71, "/work/app", "main");
    f.transcript(
        "-work-app",
        &at,
        &[
            // Far from any placeholder line: nothing pairs with it.
            at.prompt(1, 1, "tapir see some pasted words"),
            // 2 minutes (120 s) after its history line: pairs.
            at.prompt(2, 12, "tapir see other pasted words"),
            // 3 minutes after its history line: does not pair.
            at.prompt(3, 23, "tapir see more pasted words"),
        ],
    );
    let paste = |minute: u32| {
        let mut v = at.history(minute, "tapir see [Pasted text #1 +40 lines]");
        v["pastedContents"] = json!({"1": {"id": 1, "type": "text", "contentHash": "abc"}});
        v
    };
    f.history(&[paste(10), paste(20)]);
    let recs = f.grep_jsonl(&["tapir", "--store", "transcripts"]);
    let got: Vec<(Value, Value)> = recs
        .iter()
        .map(|r| (r["agreement"].clone(), r["agreement_rule"].clone()))
        .collect();
    assert_eq!(
        got,
        vec![
            (json!("transcript-only"), Value::Null),
            (json!("both"), json!("placeholder-wildcard")),
            (json!("transcript-only"), Value::Null),
        ]
    );
    let hist = f.grep_jsonl(&["tapir", "--store", "history"]);
    let got: Vec<&Value> = hist.iter().map(|r| &r["agreement"]).collect();
    assert_eq!(got, vec![&json!("both"), &json!("history-only")]);
    assert_eq!(ms(12) - ms(10), 120_000);
}
