//! `clrg grep` rendering and formats: excerpt centering (R1), `-C`, json,
//! tsv, values, `--sort`, `--limit`, and `-0`. Output is piped, so it is
//! 100 columns wide and has no color, whatever the terminal.

mod fixtures;

use fixtures::{At, Fixture, session_id};
use serde_json::{Value, json};

/// Two sessions: seed 30 (older, two hits) and seed 31 (newer, one hit).
fn two_sessions() -> Fixture {
    let f = Fixture::new();
    let a = At::new(30, "/work/one", "main");
    f.transcript(
        "-work-one",
        &a,
        &[
            a.prompt(1, 1, "first marker"),
            a.prompt(2, 2, "second marker"),
        ],
    );
    let b = At::new(31, "/work/two", "dev");
    f.transcript("-work-two", &b, &[b.prompt(1, 30, "third marker")]);
    f
}

#[test]
fn human_excerpt_centers_the_match_on_one_line() {
    let f = Fixture::new();
    let at = At::new(32, "/work/app", "main");
    let text = format!("{}\nNEEDLE\t{}", "a".repeat(300), "b".repeat(300));
    f.transcript("-work-app", &at, &[at.prompt(1, 1, &text)]);
    let out = f.grep_stdout(&["NEEDLE"]);
    let line = out
        .lines()
        .find(|l| l.contains("NEEDLE") && !l.starts_with("  last:"))
        .unwrap();
    assert_eq!(line.chars().count(), 100, "fits the width: {line:?}");
    // `  14:01 user/text            ` then the excerpt.
    let excerpt: String = line.chars().skip(29).collect();
    assert!(
        excerpt.starts_with('…') && excerpt.ends_with('…'),
        "{excerpt}"
    );
    let at = excerpt.find("NEEDLE").unwrap();
    let left = excerpt[..at].chars().count();
    let right = excerpt[at + 6..].chars().count();
    assert!(left.abs_diff(right) <= 1, "centered: {left} vs {right}");
    // Newlines and tabs never break the line.
    assert!(excerpt.contains("a NEEDLE b"), "{excerpt}");

    // The JSONL excerpt is centered too, within the text's bounds.
    let r = &f.grep_jsonl(&["NEEDLE"])[0];
    let ex = r["excerpt"].as_str().unwrap();
    let s = usize::try_from(r["match_start"].as_u64().unwrap()).unwrap();
    let e = usize::try_from(r["match_end"].as_u64().unwrap()).unwrap();
    assert_eq!(s, ex.len() - e, "as much text after as before");
}

#[test]
fn context_shows_messages_around_each_hit() {
    let f = Fixture::new();
    let at = At::new(33, "/work/app", "main");
    let lines: Vec<Value> = (1..=6)
        .map(|n| at.prompt(n, n, &format!("message {n}")))
        .chain([at.assistant(7, 7, json!([{"type": "text", "text": "the needle"}]))])
        .collect();
    let mut lines = lines;
    lines[3] = at.prompt(4, 4, "message 4 has the needle");
    f.transcript("-work-app", &at, &lines);

    // Default records: exactly the 17 fields, no `context`.
    for r in f.grep_jsonl(&["needle"]) {
        assert_eq!(r.as_object().unwrap().len(), 17);
    }
    let recs = f.grep_jsonl(&["needle", "-C", "1"]);
    let got: Vec<(u64, bool)> = recs
        .iter()
        .map(|r| (r["line"].as_u64().unwrap(), r["context"].as_bool().unwrap()))
        .collect();
    assert_eq!(
        got,
        vec![(3, true), (4, false), (5, true), (6, true), (7, false)]
    );
    let ctx = &recs[0];
    assert_eq!(ctx["excerpt"], "message 3");
    assert_eq!(
        (&ctx["type"], &ctx["part"]),
        (&json!("user"), &json!("text"))
    );
    // No history.jsonl: a context user/text line is `unknown` like a hit.
    assert_eq!(ctx["agreement"], "unknown");
    assert_eq!(ctx["last"], false);
    assert_eq!(ctx["match_start"], Value::Null);
    assert_eq!(ctx["session"], session_id(33));

    // Human: context lines are indented past the hits.
    let out = f.grep_stdout(&["needle", "--context", "1"]);
    let body: Vec<&str> = out.lines().skip(2).collect();
    assert_eq!(
        body,
        vec![
            "    14:03 user/text            message 3",
            "  14:04 user/text            message 4 has the needle",
            "    14:05 user/text            message 5",
            "    14:06 user/text            message 6",
            "  14:07 assistant/text       the needle",
        ]
    );
}

#[test]
fn json_is_an_array_of_the_jsonl_records() {
    let f = two_sessions();
    let out = f.grep_stdout(&["marker", "--format", "json"]);
    let arr: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(arr, Value::Array(f.grep_jsonl(&["marker"])));
}

#[test]
fn tsv_has_a_header_and_the_chosen_fields() {
    let f = two_sessions();
    let out = f.grep_stdout(&["marker", "--format", "tsv"]);
    let rows: Vec<&str> = out.lines().collect();
    assert_eq!(rows[0], "ts\tsession\tcwd\tbranch\ttype\tpart\texcerpt");
    // Newest session first (R5).
    assert_eq!(
        rows[1],
        format!(
            "2026-08-02T14:30:00.000Z\t{}\t/work/two\tdev\tuser\ttext\tthird marker",
            session_id(31)
        )
    );
    assert_eq!(rows.len(), 4);
    let out = f.grep_stdout(&["marker", "-f", "tsv", "--fields", "line,excerpt", "-0"]);
    assert_eq!(
        out,
        "line\texcerpt\x001\tthird marker\x001\tfirst marker\x002\tsecond marker\0"
    );
    f.clrg()
        .args(["grep", "marker", "-f", "tsv", "--fields", "nope"])
        .assert()
        .code(2);
    f.clrg()
        .args(["grep", "marker", "-f", "jsonl", "--fields", "ts"])
        .assert()
        .code(2);
}

#[test]
fn values_lists_each_session_and_cwd_once() {
    let f = two_sessions();
    let out = f.grep_stdout(&["marker", "--format", "values"]);
    assert_eq!(
        out,
        format!(
            "{}:/work/two\n{}:/work/one\n",
            session_id(31),
            session_id(30)
        )
    );
    let out = f.grep_stdout(&["marker", "--format", "values", "-0"]);
    assert_eq!(
        out,
        format!(
            "{}:/work/two\0{}:/work/one\0",
            session_id(31),
            session_id(30)
        )
    );
}

#[test]
fn sort_and_limit_apply() {
    let f = two_sessions();
    let excerpts = |args: &[&str]| -> Vec<String> {
        f.grep_jsonl(args)
            .iter()
            .map(|r| r["excerpt"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        excerpts(&["marker", "--sort", "ts"]),
        vec!["first marker", "second marker", "third marker"]
    );
    assert_eq!(
        excerpts(&["marker", "--sort", "-excerpt"]),
        vec!["third marker", "second marker", "first marker"]
    );
    assert_eq!(
        excerpts(&["marker", "--sort", "ts", "-n", "2"]),
        vec!["first marker", "second marker"]
    );
    assert_eq!(excerpts(&["marker", "--limit", "1"]), vec!["third marker"]);
    f.clrg()
        .args(["grep", "marker", "--sort", "nope"])
        .assert()
        .code(2);
}

#[test]
fn hits_without_a_session_get_a_store_header() {
    let f = Fixture::new();
    let plan = f.write("plans/quiet-river.md", "# Plan\n\nthe plan marker\n");
    let out = f.grep_stdout(&["marker"]);
    assert_eq!(
        out,
        format!(
            "plans  {}\n        plans                the plan marker\n",
            plan.display()
        )
    );
}

#[test]
fn records_without_a_cwd_take_their_sessions() {
    let f = Fixture::new();
    let at = At::new(34, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "hello")]);
    f.write(
        &format!("todos/{}-agent-x.json", at.session),
        json!([{"content": "todo marker"}]).to_string(),
    );
    let r = &f.grep_jsonl(&["marker"])[0];
    assert_eq!(r["store"], "todos");
    assert_eq!(r["cwd"], "/work/app");
    assert_eq!(r["cwd_exists"], false);
}
