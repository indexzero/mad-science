//! Build 2 (recovery): the search gap (w1-w2) and `clrg files` (fl1-fl4).
//! Every fixture is synthetic (see `fixtures::recovery`).

mod fixtures;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use fixtures::{APP_RS, At, BLOCKED, CWD, EDITED_ONLY, Fixture, NEW_MD, README, SUMMARY, recovery};
use serde_json::{Value, json};

/// Run `clrg files <args> --format jsonl`; records by path. Asserts exit 0.
fn files_jsonl(f: &Fixture, args: &[&str]) -> BTreeMap<String, Value> {
    let out = f
        .clrg()
        .arg("files")
        .args(args)
        .args(["--format", "jsonl"])
        .output()
        .expect("clrg runs");
    assert_eq!(
        out.status.code(),
        Some(0),
        "clrg files {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            (v["path"].as_str().unwrap().to_string(), v)
        })
        .collect()
}

fn stdout(f: &Fixture, args: &[&str]) -> String {
    let out = f.clrg().args(args).output().expect("clrg runs");
    assert_eq!(
        out.status.code(),
        Some(0),
        "clrg {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn strs(v: &Value) -> Vec<&str> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect()
}

#[test]
fn w1_workflow_records_are_searched() {
    let f = Fixture::new();
    let at = At::new(0x61, "/work/app", "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "start the workflow")]);
    f.session_file(
        "-work-app",
        &at,
        "workflows/wf-7.json",
        json!({"name": "review", "steps": [{"note": "workflowtoken in a run record"}]}).to_string(),
    );
    let hits = f.grep_jsonl(&["workflowtoken"]);
    assert_eq!(hits.len(), 1, "{hits:?}");
    let h = &hits[0];
    assert_eq!(h["store"], "workflows");
    assert_eq!(
        h["session"],
        at.session.as_str(),
        "attributed from the path"
    );
    assert_eq!(h["type"], Value::Null);
    assert_eq!(h["part"], Value::Null);
    // --store narrows to it, and the R4 message names the store.
    assert_eq!(
        f.grep_jsonl(&["workflowtoken", "--store", "workflows"])
            .len(),
        1
    );
    let out = f
        .clrg()
        .args(["grep", "workflowtoken", "--store", "transcripts"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let out = f.clrg().args(["grep", "zz-nothing"]).output().unwrap();
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains(", workflows, other\n"), "{err}");
    // The human header is the session's.
    let human = f.grep_stdout(&["workflowtoken"]);
    assert!(
        human.contains("[main]") && human.contains("start the workflow"),
        "{human}"
    );
}

/// Every file under `dir`, recursively.
fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            walk(&p, out);
        } else {
            out.push(p);
        }
    }
}

#[test]
fn w2_no_file_under_a_root_is_skipped() {
    let (f, r) = recovery();
    let tok = "gaptoken";
    // One token in each kind of file under projects/.
    let planted = [
        f.session_file(
            r.project,
            &r.at,
            "subagents/agent-a9.meta.json",
            json!({"description": tok}).to_string(),
        ),
        f.session_jsonl(
            r.project,
            &r.at,
            "subagents/workflows/wf-2/journal.jsonl",
            &[json!({"agentId": "a9", "result": tok})],
        ),
        f.session_file(
            r.project,
            &r.at,
            "tool-results/out-1.txt",
            format!("saved {tok}\n"),
        ),
        f.session_file(r.project, &r.at, "odd/blob.bin", format!("raw {tok}\n")),
        f.session_file(
            r.project,
            &r.at,
            "workflows/wf-2.json",
            json!({"x": tok}).to_string(),
        ),
        f.write("projects/-work-app/notes.txt", format!("loose {tok}\n")),
        f.write("projects/README", format!("top {tok}\n")),
    ];
    // Every file under projects/ that holds the token is listed by -l.
    let mut all = Vec::new();
    walk(&f.root().join("projects"), &mut all);
    let want: BTreeSet<String> = all
        .iter()
        .filter(|p| std::fs::read_to_string(p).is_ok_and(|t| t.contains(tok)))
        .map(|p| p.display().to_string())
        .collect();
    assert_eq!(want.len(), planted.len());
    let got: BTreeSet<String> = stdout(&f, &["grep", "-l", tok])
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(got, want);
    // Each is a transcripts record with type null (workflows: its own
    // store), attributed to the session when it is under its folder.
    let sid = r.at.session.as_str();
    for h in f.grep_jsonl(&[tok]) {
        let path = h["path"].as_str().unwrap();
        assert_eq!(h["type"], Value::Null, "{path}");
        let store = if path.contains("/workflows/wf-2.json") {
            "workflows"
        } else {
            "transcripts"
        };
        assert_eq!(h["store"], store, "{path}");
        let session = if path.contains(sid) {
            json!(sid)
        } else {
            Value::Null
        };
        assert_eq!(h["session"], session, "{path}");
    }
    // The subagent's own files are searched too, and none of them is read as
    // a transcript by `sessions`.
    assert!(!stdout(&f, &["grep", "-l", "pressure test summary"]).is_empty());
    let sessions = stdout(&f, &["sessions", "--format", "jsonl"]);
    assert_eq!(sessions.lines().count(), 1, "{sessions}");
    let s: Value = serde_json::from_str(sessions.lines().next().unwrap()).unwrap();
    assert_eq!(
        s["subagents"], 1,
        "journal.jsonl is not a subagent transcript"
    );
}

#[test]
fn fl1_files_lists_paths_with_ops_and_outcome() {
    let (f, r) = recovery();
    let recs = files_jsonl(&f, &[]);
    let paths: BTreeSet<&str> = recs.keys().map(String::as_str).collect();
    assert_eq!(
        paths,
        BTreeSet::from([APP_RS, NEW_MD, EDITED_ONLY, BLOCKED, SUMMARY]),
        "the default --op is write and edit; README.md was only read"
    );
    // The record shape: the spec's FIELDS (the tsv default keeps their order).
    let keys: BTreeSet<&str> = recs[NEW_MD]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        BTreeSet::from([
            "path",
            "cwd",
            "ops",
            "first_ts",
            "last_ts",
            "sessions",
            "branches",
            "versions",
            "outcome",
            "recoverable",
            "root",
            "roots"
        ])
    );
    let header = stdout(&f, &["files", "--format", "tsv"]);
    assert_eq!(
        header.lines().next().unwrap(),
        "path\tcwd\tops\tfirst_ts\tlast_ts\tsessions\tbranches\tversions\toutcome\trecoverable\troot\troots"
    );
    let new_md = &recs[NEW_MD];
    assert_eq!(strs(&new_md["ops"]), ["write", "backup"]);
    assert_eq!(new_md["outcome"], "written");
    assert_eq!(new_md["recoverable"], "full");
    assert_eq!(new_md["versions"], 1);
    assert_eq!(new_md["cwd"], CWD);
    assert_eq!(strs(&new_md["sessions"]), [r.at.session.as_str()]);
    assert_eq!(strs(&new_md["branches"]), ["onboarding.gonzo"]);
    assert_eq!(new_md["first_ts"], "2026-08-02T14:02:00.000Z");
    assert_eq!(new_md["last_ts"], "2026-08-02T14:04:00.000Z");
    assert_eq!(new_md["root"], f.root().display().to_string());
    let edited = &recs[EDITED_ONLY];
    assert_eq!(strs(&edited["ops"]), ["edit"]);
    assert_eq!(edited["outcome"], "written");
    assert_eq!(edited["recoverable"], "diff-only");
    assert_eq!(edited["versions"], 0);

    // --op read lists what was read.
    let reads = files_jsonl(&f, &["--op", "read"]);
    assert_eq!(reads.keys().collect::<Vec<_>>(), [README]);
    assert_eq!(strs(&reads[README]["ops"]), ["read"]);
    assert_eq!(reads[README]["outcome"], "unknown");
    assert_eq!(reads[README]["recoverable"], "none");

    // Human: a header, then one row per path with its outcome and ops.
    let human = stdout(&f, &["files"]);
    let lines: Vec<&str> = human.lines().collect();
    assert_eq!(lines.len(), 6, "{human}");
    assert!(
        lines[0].starts_with("LAST") && lines[0].ends_with("PATH"),
        "{human}"
    );
    let row = lines.iter().find(|l| l.ends_with(SUMMARY)).unwrap();
    assert!(
        row.contains("returned") && row.contains("rejected,returned"),
        "{row}"
    );
    assert!(row.contains("00000051"), "the short session id: {row}");
    // json, tsv, values, --path, and the alias.
    let json: Value = serde_json::from_str(&stdout(&f, &["files", "--format", "json"])).unwrap();
    assert_eq!(json.as_array().unwrap().len(), 5);
    let tsv = stdout(&f, &["f", "--format", "tsv", "--fields", "path,outcome"]);
    assert!(tsv.starts_with("path\toutcome\n"), "{tsv}");
    assert!(tsv.contains(&format!("{BLOCKED}\trejected\n")), "{tsv}");
    let values = stdout(&f, &["files", "--format", "values", "--path", "*/src/*"]);
    assert_eq!(values, format!("{APP_RS}\n{EDITED_ONLY}\n"));
    // A selector that excludes the session's messages excludes its paths.
    let out = f.clrg().args(["files", "-b", "other"]).output().unwrap();
    assert_eq!(out.status.code(), Some(1));

    // No match: exit 1, and stderr says what was searched (R4).
    let out = f
        .clrg()
        .args(["files", "--path", "*nothing*", "--created-only"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.starts_with("clrg files: no path matched\n"), "{err}");
    assert!(
        err.contains("searched 2 file(s) in stores: transcripts, file-history\n"),
        "{err}"
    );
    assert!(
        err.contains("filters: --op write --op edit --path *nothing* --created-only\n"),
        "{err}"
    );
    // --op bash is not built yet.
    let out = f.clrg().args(["files", "--op", "bash"]).output().unwrap();
    assert_eq!(out.status.code(), Some(5));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "clrg files --op bash: not implemented (yet)\n"
    );
}

#[test]
fn fl2_rejected_write_is_marked_rejected() {
    let (f, r) = recovery();
    let recs = files_jsonl(&f, &[]);
    let blocked = &recs[BLOCKED];
    assert_eq!(strs(&blocked["ops"]), ["rejected"]);
    assert_eq!(
        blocked["outcome"], "rejected",
        "never passed off as written"
    );
    assert_eq!(
        blocked["recoverable"], "full",
        "the intended content is kept"
    );
    assert_eq!(blocked["versions"], 1);
    // The SUMMARY.md case: the subagent's Write was rejected, then it
    // returned a revised version as text.
    let summary = &recs[SUMMARY];
    assert_eq!(strs(&summary["ops"]), ["rejected", "returned"]);
    assert_eq!(summary["outcome"], "returned");
    assert_eq!(summary["recoverable"], "full");
    assert_eq!(summary["versions"], 2, "the draft and the returned text");
    assert_eq!(summary["first_ts"], "2026-08-02T14:11:00.000Z");
    assert_eq!(summary["last_ts"], "2026-08-02T14:14:00.000Z");
    assert_ne!(r.draft, r.returned);
    // Without subagents, only the main session's rejected write is left.
    let main_only = files_jsonl(&f, &["--no-subagents"]);
    assert!(!main_only.contains_key(SUMMARY));
    assert!(main_only.contains_key(BLOCKED));
}

#[test]
fn fl3_relative_snapshot_paths_resolve_against_launch_cwd() {
    let (f, _) = recovery();
    let recs = files_jsonl(&f, &[]);
    // The snapshot records "src/app.rs"; a later line ran in /work/app/src,
    // but the launch folder is /work/app.
    let app = &recs[APP_RS];
    assert_eq!(strs(&app["ops"]), ["edit", "backup"]);
    assert_eq!(app["outcome"], "written");
    assert_eq!(app["recoverable"], "full");
    assert_eq!(
        app["versions"], 2,
        "backup v1, the edit replayed on it, and backup v2 (equal to the edit)"
    );
    assert!(recs.keys().all(|p| p.starts_with('/')), "{:?}", recs.keys());
    assert!(!recs.contains_key("/work/app/src/src/app.rs"));
    // --relative prints them relative to the session's cwd again.
    let rel = files_jsonl(&f, &["--relative"]);
    let keys: BTreeSet<&str> = rel.keys().map(String::as_str).collect();
    assert!(
        keys.contains("src/app.rs") && keys.contains("docs/new.md"),
        "{keys:?}"
    );
    let human = stdout(&f, &["files", "--relative", "--path", "*/app.rs"]);
    assert!(
        human.lines().nth(1).unwrap().ends_with("  src/app.rs"),
        "{human}"
    );
}

#[test]
fn fl4_created_only() {
    let (f, _) = recovery();
    let recs = files_jsonl(&f, &["--created-only"]);
    let paths: BTreeSet<&str> = recs.keys().map(String::as_str).collect();
    // new.md: an absent-file backup holds no content, then a Write. The
    // rejected writes count too. app.rs had a backup with content first;
    // edited-only.rs starts with an Edit.
    assert_eq!(paths, BTreeSet::from([NEW_MD, BLOCKED, SUMMARY]));
}

// ─── clrg extract (x1-x8) ────────────────────────────────────────────────────

/// One `clrg extract` run.
struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Run `clrg extract -o <out> <args>`.
fn extract(f: &Fixture, out: &Path, args: &[&str]) -> Run {
    let o = f
        .clrg()
        .arg("extract")
        .arg("-o")
        .arg(out)
        .args(args)
        .output()
        .expect("clrg runs");
    Run {
        code: o.status.code(),
        stdout: String::from_utf8(o.stdout).unwrap(),
        stderr: String::from_utf8(o.stderr).unwrap(),
    }
}

/// Every file under `dir` (symlinks not followed), relative path to bytes.
fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut all = Vec::new();
    if dir.exists() {
        walk(dir, &mut all);
    }
    all.into_iter()
        .map(|p| {
            let rel = p.strip_prefix(dir).unwrap().display().to_string();
            let bytes = std::fs::read(&p).unwrap_or_default();
            (rel, bytes)
        })
        .collect()
}

/// `<out>/MANIFEST.jsonl`, keyed by the record's `out_path` relative to
/// the (canonical) `out`.
fn manifest(out: &Path) -> BTreeMap<String, Value> {
    let out = std::fs::canonicalize(out).unwrap();
    std::fs::read_to_string(out.join("MANIFEST.jsonl"))
        .unwrap()
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            let p = Path::new(v["out_path"].as_str().unwrap());
            let rel = p.strip_prefix(&out).unwrap().display().to_string();
            (rel, v)
        })
        .collect()
}

fn text(t: &BTreeMap<String, Vec<u8>>, rel: &str) -> String {
    String::from_utf8(
        t.get(rel)
            .unwrap_or_else(|| panic!("{rel} in {t:?}"))
            .clone(),
    )
    .unwrap()
}

#[test]
fn x1_extract_refuses_nonempty_or_in_root_out_dir() {
    let (f, _) = recovery();
    let tmp = tempfile::tempdir().unwrap();
    let ok = ["--path", "*/docs/new.md"];
    let before = tree(f.root());
    let refused = |out: &Path, args: &[&str], why: &str| {
        let r = extract(&f, out, args);
        assert_eq!(r.code, Some(2), "{}: {}", out.display(), r.stderr);
        assert!(r.stderr.contains(why), "{}", r.stderr);
        assert!(r.stdout.is_empty(), "{}", r.stdout);
    };
    // Not empty: a file in it. Nothing is added.
    let full = tmp.path().join("full");
    std::fs::create_dir(&full).unwrap();
    std::fs::write(full.join("keep.txt"), "mine\n").unwrap();
    refused(&full, &ok, "is not empty");
    refused(&full, &["--dry-run"], "is not empty");
    assert_eq!(tree(&full).keys().collect::<Vec<_>>(), ["keep.txt"]);
    // A file is not a folder.
    refused(&full.join("keep.txt"), &ok, "is not a folder");
    // Inside the root: relative to the current folder (the root), absolute,
    // the root itself, and through a symlink that leads into it.
    refused(Path::new("out"), &ok, "is inside the root");
    refused(
        &f.root().join("projects/new-out"),
        &ok,
        "is inside the root",
    );
    refused(f.root(), &ok, "inside the root");
    #[cfg(unix)]
    {
        let link = tmp.path().join("link");
        std::os::unix::fs::symlink(f.root(), &link).unwrap();
        refused(&link.join("sneaky"), &ok, "is inside the root");
    }
    assert_eq!(tree(f.root()), before, "nothing was written in the root");
    // A new folder (with new parents), and an empty one, are accepted.
    let fresh = tmp.path().join("fresh/nested");
    let r = extract(&f, &fresh, &ok);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert_eq!(
        tree(&fresh).keys().collect::<Vec<_>>(),
        ["MANIFEST.jsonl", "_work_app/docs/new.md"]
    );
    let empty = tmp.path().join("empty");
    std::fs::create_dir(&empty).unwrap();
    assert_eq!(extract(&f, &empty, &ok).code, Some(0));
    // Run twice into the same folder: now it is not empty.
    refused(&empty, &ok, "is not empty");
}

#[test]
fn x2_extract_last_replays_writes_and_edits() {
    let f = Fixture::new();
    let at = At::new(0x62, "/work/lib", "main");
    let lib = "/work/lib/src/lib.rs";
    f.transcript(
        "-work-lib",
        &at,
        &[
            at.prompt(1, 1, "write then edit"),
            at.tool_use(2, 2, "toolu_w", "Write", json!({"file_path": lib, "content": "a b a\n"})),
            at.result_for(3, 2, "toolu_w", false, "created",
                json!({"type": "create", "filePath": lib, "content": "a b a\n"})),
            at.tool_use(4, 3, "toolu_e", "Edit",
                json!({"file_path": lib, "old_string": "a", "new_string": "x", "replace_all": true})),
            at.result_for(5, 3, "toolu_e", false, "edited",
                json!({"filePath": lib, "oldString": "a", "newString": "x", "replaceAll": true,
                       "originalFile": "a b a\n"})),
            at.tool_use(6, 4, "toolu_m", "MultiEdit", json!({"file_path": lib, "edits": [
                {"old_string": "b", "new_string": "y"},
                {"old_string": "x y", "new_string": "x y z"}]})),
            at.result_for(7, 4, "toolu_m", false, "edited", json!({"filePath": lib})),
        ],
    );
    let tmp = tempfile::tempdir().unwrap();
    for source in ["best", "transcript"] {
        let out = tmp.path().join(source);
        let r = extract(&f, &out, &["--source", source]);
        assert_eq!(r.code, Some(0), "{}", r.stderr);
        let t = tree(&out);
        assert_eq!(
            text(&t, "_work_lib/src/lib.rs"),
            "x y z x\n",
            "the replayed last state"
        );
        let m = manifest(&out);
        let rec = &m["_work_lib/src/lib.rs"];
        assert_eq!(rec["source_event"], "edit");
        assert_eq!(rec["version"], 3);
        assert_eq!(rec["outcome"], "written");
        assert!(
            r.stdout.starts_with("wrote _work_lib/src/lib.rs  <- /work/lib/src/lib.rs  (v3 from edit, outcome written)\n"),
            "{}",
            r.stdout
        );
        assert!(
            r.stdout
                .contains("\n  outcome: 1 written, 0 rejected, 0 returned\n"),
            "{}",
            r.stdout
        );
    }
    // file-history alone has nothing for this path: none, exit 4.
    let out = tmp.path().join("fh");
    let r = extract(&f, &out, &["--source", "file-history"]);
    assert_eq!(r.code, Some(4), "{}", r.stderr);
    assert!(!out.exists(), "nothing to write: the folder is not created");
}

#[test]
fn x3_extract_returned_content_for_rejected_subagent_write() {
    let (f, r) = recovery();
    let tmp = tempfile::tempdir().unwrap();
    let sid = r.at.session.as_str();
    let sel = ["--session", sid, "--path", "*pressure-test/SUMMARY.md"];
    let out = tmp.path().join("last");
    let run = extract(&f, &out, &sel);
    assert_eq!(run.code, Some(0), "{}", run.stderr);
    let rel = "_work_app/pressure-test/SUMMARY.md";
    let t = tree(&out);
    assert_eq!(
        text(&t, rel),
        r.returned,
        "the StructuredOutput.file version"
    );
    assert_ne!(text(&t, rel), r.draft, "not the rejected draft");
    let rec = &manifest(&out)[rel];
    assert_eq!(rec["outcome"], "returned");
    assert_eq!(rec["source_event"], "returned");
    assert_eq!(rec["journal"], "agree");
    assert!(rec["similarity"].as_f64().unwrap() >= 0.8, "{rec}");
    assert_eq!(rec["agent_id"], r.agent);
    assert_eq!(rec["session"], sid);
    assert_eq!(rec["version"], 2);
    assert_eq!(rec["verified"], Value::Null);
    assert!(
        run.stdout
            .contains("outcome: 0 written, 0 rejected, 1 returned"),
        "{}",
        run.stdout
    );
    assert!(run.stdout.contains("journal agree"), "{}", run.stdout);
    // --version all: the rejected draft is an earlier state, labelled so.
    let out = tmp.path().join("all");
    let run = extract(&f, &out, &[&sel[..], &["--version", "all"]].concat());
    assert_eq!(run.code, Some(0), "{}", run.stderr);
    let t = tree(&out);
    assert_eq!(text(&t, &format!("{rel}.v1")), r.draft);
    assert_eq!(text(&t, &format!("{rel}.v2")), r.returned);
    let m = manifest(&out);
    let v1 = &m[&format!("{rel}.v1")];
    assert_eq!(v1["outcome"], "rejected", "never passed off as written");
    assert_eq!(v1["source_event"], "rejected");
    assert_eq!(v1["journal"], Value::Null);
    assert_eq!(m[&format!("{rel}.v2")]["outcome"], "returned");
    assert!(
        run.stdout
            .contains("outcome: 0 written, 1 rejected, 1 returned"),
        "{}",
        run.stdout
    );
}

#[test]
fn x4_unrecoverable_exits_4_and_lists_it() {
    let (f, _) = recovery();
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(4), "{}", r.stderr);
    // Everything recoverable is still written, rejected content included.
    let t = tree(&out);
    let keys: BTreeSet<&str> = t.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        BTreeSet::from([
            "MANIFEST.jsonl",
            "_work_app/blocked.txt",
            "_work_app/docs/new.md",
            "_work_app/pressure-test/SUMMARY.md",
            "_work_app/src/app.rs",
        ])
    );
    assert_eq!(text(&t, "_work_app/blocked.txt"), "never written\n");
    assert_eq!(
        manifest(&out)["_work_app/blocked.txt"]["outcome"],
        "rejected"
    );
    // The summary lists what was not.
    assert!(
        r.stdout.ends_with(&format!(
            "  outcome: 2 written, 1 rejected, 1 returned\n  verified: 0 agree, 0 disagree\n  not recoverable (1):\n    diff-only  {EDITED_ONLY}\n"
        )),
        "{}",
        r.stdout
    );
    // jsonl: the list goes to stderr.
    let r = extract(&f, &tmp.path().join("jsonl"), &["--format", "jsonl"]);
    assert_eq!(r.code, Some(4));
    assert_eq!(r.stdout.lines().count(), 4);
    assert_eq!(
        r.stderr,
        format!("clrg extract: not recoverable: diff-only {EDITED_ONLY}\n")
    );
    // A path with no state from the chosen source is `none`.
    let out = tmp.path().join("none");
    let r = extract(
        &f,
        &out,
        &["--source", "file-history", "--path", "*/blocked.txt"],
    );
    assert_eq!(r.code, Some(4));
    assert!(
        r.stdout.contains(&format!("    none       {BLOCKED}\n")),
        "{}",
        r.stdout
    );
    assert!(!out.exists());
    // No path matched: exit 1, and stderr says what was searched (R4).
    let out = tmp.path().join("nomatch");
    let r = extract(&f, &out, &["--path", "*nothing*", "-b", "onboarding.gonzo"]);
    assert_eq!(r.code, Some(1));
    assert!(
        r.stderr
            .starts_with("clrg extract: no path matched (nothing was written)\n"),
        "{}",
        r.stderr
    );
    assert!(
        r.stderr
            .contains("filters: --path *nothing* --branch onboarding.gonzo\n"),
        "{}",
        r.stderr
    );
    assert!(!out.exists());
}

#[test]
fn x5_manifest_records_provenance() {
    use sha2::{Digest as _, Sha256};
    let (f, r) = recovery();
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let run = extract(&f, &out, &["--path", "*/docs/new.md", "--format", "jsonl"]);
    assert_eq!(run.code, Some(0), "{}", run.stderr);
    let raw = std::fs::read_to_string(out.join("MANIFEST.jsonl")).unwrap();
    assert_eq!(
        run.stdout, raw,
        "--format jsonl prints the manifest's records"
    );
    // The fields, in order.
    let line = raw.lines().next().unwrap();
    let fields = [
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
    let at: Vec<usize> = fields
        .iter()
        .map(|k| line.find(&format!("\"{k}\":")).unwrap())
        .collect();
    assert!(at.windows(2).all(|w| w[0] < w[1]), "{line}");
    let v: Value = serde_json::from_str(line).unwrap();
    assert_eq!(v.as_object().unwrap().len(), fields.len());
    let content = "# New\n\nCreated by a Write.\n";
    let canon = std::fs::canonicalize(&out).unwrap();
    assert_eq!(v["path"], NEW_MD);
    assert_eq!(
        v["out_path"],
        canon.join("_work_app/docs/new.md").display().to_string()
    );
    assert_eq!(v["session"], r.at.session.as_str());
    assert_eq!(v["agent_id"], Value::Null);
    assert_eq!(v["root"], f.root().display().to_string());
    assert_eq!(v["version"], 1);
    assert_eq!(v["ts"], "2026-08-02T14:04:00.000Z");
    assert_eq!(v["source_event"], "write");
    assert_eq!(v["outcome"], "written");
    assert_eq!(v["verified"], Value::Null);
    assert_eq!(v["similarity"], Value::Null);
    assert_eq!(v["journal"], Value::Null);
    assert_eq!(
        v["sha256"],
        format!("{:x}", Sha256::digest(content.as_bytes()))
    );
    assert_eq!(v["bytes"], content.len());
    assert_eq!(text(&tree(&out), "_work_app/docs/new.md"), content);
    // --no-manifest writes only the files; --dry-run writes nothing.
    let bare = tmp.path().join("bare");
    assert_eq!(
        extract(&f, &bare, &["--path", "*/docs/new.md", "--no-manifest"]).code,
        Some(0)
    );
    assert_eq!(
        tree(&bare).keys().collect::<Vec<_>>(),
        ["_work_app/docs/new.md"]
    );
    let dry = tmp.path().join("dry");
    let run = extract(&f, &dry, &["--dry-run"]);
    assert_eq!(run.code, Some(4));
    assert!(!dry.exists(), "a dry run creates nothing");
    assert!(
        run.stdout
            .contains("would write _work_app/docs/new.md  <- "),
        "{}",
        run.stdout
    );
    assert!(
        run.stdout.contains("dry run: would write 4 file(s)"),
        "{}",
        run.stdout
    );
    let dry_jsonl = extract(
        &f,
        &dry,
        &["--dry-run", "--format", "jsonl", "--path", "*/docs/new.md"],
    );
    let canon_dry = std::fs::canonicalize(tmp.path()).unwrap().join("dry");
    assert_eq!(
        dry_jsonl.stdout,
        raw.replace(
            &canon.display().to_string(),
            &canon_dry.display().to_string()
        )
    );
    assert!(!dry.exists());
}

#[test]
fn x6_replay_verified_against_later_backup() {
    let f = Fixture::new();
    let at = At::new(0x63, "/work/v", "main");
    let (same, diff) = ("/work/v/same.txt", "/work/v/diff.txt");
    let write = |n, m, id: &str, path: &str, c: &str| {
        [
            at.tool_use(n, m, id, "Write", json!({"file_path": path, "content": c})),
            at.result_for(
                n + 1,
                m,
                id,
                false,
                "ok",
                json!({"type": "create", "filePath": path, "content": c}),
            ),
        ]
    };
    let mut lines = vec![at.prompt(1, 1, "write two files")];
    lines.extend(write(2, 2, "toolu_a", same, "one\n"));
    lines.extend(write(4, 2, "toolu_b", diff, "two\n"));
    lines.push(at.snapshot(
        6,
        &[
            ("same.txt", Some("1111111111111111@v1"), 1, 3),
            ("diff.txt", Some("2222222222222222@v1"), 1, 3),
        ],
    ));
    f.transcript("-work-v", &at, &lines);
    f.backup(&at, "1111111111111111@v1", "one\n");
    f.backup(&at, "2222222222222222@v1", "TWO\n");
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &["--version", "all"]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    let m = manifest(&out);
    let agree = &m["_work_v/same.txt.v1"];
    assert_eq!(
        (&agree["source_event"], &agree["verified"]),
        (&json!("write"), &json!("agree"))
    );
    assert!(
        !m.contains_key("_work_v/same.txt.v2"),
        "the backup holds the same bytes"
    );
    let disagree = &m["_work_v/diff.txt.v1"];
    assert_eq!(
        (&disagree["source_event"], &disagree["verified"]),
        (&json!("write"), &json!("disagree"))
    );
    let backup = &m["_work_v/diff.txt.v2"];
    assert_eq!(
        (&backup["source_event"], &backup["verified"]),
        (&json!("backup"), &Value::Null)
    );
    let t = tree(&out);
    assert_eq!(text(&t, "_work_v/diff.txt.v1"), "two\n");
    assert_eq!(
        text(&t, "_work_v/diff.txt.v2"),
        "TWO\n",
        "disagreement is shown, never hidden"
    );
    assert!(
        r.stdout.contains("\n  verified: 1 agree, 1 disagree\n"),
        "{}",
        r.stdout
    );
    assert!(
        r.stdout
            .contains("(v1 from write, outcome written, verified disagree)"),
        "{}",
        r.stdout
    );
    // The recovery fixture: an Edit with no originalFile, replayed on the
    // first backup, agrees with the next one.
    let (rf, _) = recovery();
    let out = tmp.path().join("app");
    let r = extract(&rf, &out, &["--version", "all", "--path", "*/app.rs"]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    let v2 = &manifest(&out)["_work_app/src/app.rs.v2"];
    assert_eq!(
        (&v2["source_event"], &v2["verified"]),
        (&json!("edit"), &json!("agree"))
    );
}

#[test]
#[allow(clippy::too_many_lines)] // One fixture, every escape route.
fn x7_extract_never_writes_outside_out() {
    let tmp = tempfile::tempdir().unwrap();
    let base = std::fs::canonicalize(tmp.path()).unwrap();
    let f = Fixture::new();
    let at = At::new(0x64, "/work/app", "main");
    let abs = base.join("target/abs.txt").display().to_string();
    let w = |at: &At, n, id: &str, path: &str| {
        [
            at.tool_use(
                n,
                n,
                id,
                "Write",
                json!({"file_path": path, "content": "x\n"}),
            ),
            at.result_for(
                n + 1,
                n,
                id,
                false,
                "ok",
                json!({"type": "create", "filePath": path, "content": "x\n"}),
            ),
        ]
    };
    let mut lines = vec![at.prompt(1, 1, "write outside")];
    lines.extend(w(&at, 2, "toolu_1", "/work/app/ok.txt"));
    lines.extend(w(&at, 4, "toolu_2", "/work/other/up.txt"));
    lines.extend(w(&at, 6, "toolu_3", &abs));
    f.transcript("-work-app", &at, &lines);
    // A session with no cwd: its relative path stays as recorded.
    let nocwd = At::new(0x65, "", "main");
    let strip = |mut v: Value| {
        v.as_object_mut().unwrap().remove("cwd");
        v
    };
    let lines: Vec<Value> = std::iter::once(nocwd.prompt(1, 1, "escape"))
        .chain(w(&nocwd, 2, "toolu_4", "../../escape.txt"))
        .map(strip)
        .collect();
    f.transcript("-nowhere", &nocwd, &lines);
    let before = tree(&base);
    // An unsafe path is skipped and listed (exit 4); with nothing else to
    // write, nothing is created anywhere.
    let skipped = |name: &str, args: &[&str], why: &str| {
        let out = base.join(name);
        let r = extract(&f, &out, args);
        assert_eq!(r.code, Some(4), "{args:?}: {}", r.stderr);
        assert!(
            r.stdout.contains("  unsafe, skipped (1):\n"),
            "{}",
            r.stdout
        );
        assert!(r.stdout.contains(why), "{}", r.stdout);
        assert!(!out.exists(), "{args:?}: nothing created");
        assert_eq!(tree(&base), before, "{args:?}: nothing written anywhere");
    };
    let s1 = at.session.as_str();
    let s2 = nocwd.session.as_str();
    // `..` in a recorded relative path (no cwd to resolve it against).
    skipped(
        "o3",
        &["--session", s2, "--layout", "session"],
        "../../escape.txt",
    );
    skipped(
        "o4",
        &["--session", s2, "--layout", "absolute"],
        "../../escape.txt",
    );
    skipped("o5", &["--session", s2], "../../escape.txt");
    skipped("o6", &["--session", s2, "--dry-run"], "../../escape.txt");
    // A path outside its cwd lands under -o/_abs/ (x9), never outside -o.
    for (name, layout, prefix) in [("o1", "cwd", "_abs"), ("o2", "session", "")] {
        let out = base.join(name);
        let r = extract(&f, &out, &["--session", s1, "--layout", layout]);
        assert_eq!(r.code, Some(0), "{}", r.stderr);
        let prefix = if prefix.is_empty() {
            format!("{s1}/_abs")
        } else {
            prefix.to_string()
        };
        let t = tree(&out);
        assert_eq!(text(&t, &format!("{prefix}/work/other/up.txt")), "x\n");
        let inside = format!("{prefix}/{}", abs.trim_start_matches('/'));
        assert_eq!(text(&t, &inside), "x\n");
    }
    // An absolute path under --layout absolute lands under -o, not at itself.
    let out = base.join("abs");
    let r = extract(&f, &out, &["--session", s1, "--layout", "absolute"]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    let t = tree(&out);
    let inside = abs.trim_start_matches('/').to_string();
    assert_eq!(text(&t, &inside), "x\n");
    assert_eq!(text(&t, "work/other/up.txt"), "x\n");
    assert_eq!(text(&t, "work/app/ok.txt"), "x\n");
    assert!(
        !base.join("target").exists(),
        "never written at the recorded path"
    );
    // Every written file is under -o.
    let outside: Vec<String> = tree(&base)
        .into_keys()
        .filter(|k| !["abs/", "o1/", "o2/"].iter().any(|o| k.starts_with(o)))
        .collect();
    assert!(outside.is_empty(), "{outside:?}");
    // A pre-created symlink inside an empty -o: -o is no longer empty, so it
    // is refused, and the symlink is never followed.
    #[cfg(unix)]
    {
        let elsewhere = base.join("elsewhere");
        std::fs::create_dir(&elsewhere).unwrap();
        for (name, target) in [
            ("trap", elsewhere.clone()),
            ("dangling", base.join("no-such")),
        ] {
            let out = base.join(name);
            std::fs::create_dir(&out).unwrap();
            std::os::unix::fs::symlink(&target, out.join("_work_app")).unwrap();
            let r = extract(&f, &out, &["--session", s1, "--path", "*/ok.txt"]);
            assert_eq!(r.code, Some(2), "{}", r.stderr);
            assert!(r.stderr.contains("is not empty"), "{}", r.stderr);
            assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0);
            assert!(!target.join("ok.txt").exists());
        }
    }
}

#[test]
fn x8_version_all_and_first() {
    let (f, r) = recovery();
    let tmp = tempfile::tempdir().unwrap();
    let run = |name: &str, args: &[&str]| {
        let out = tmp.path().join(name);
        let res = extract(&f, &out, args);
        assert_eq!(res.code, Some(0), "{args:?}: {}", res.stderr);
        (tree(&out), manifest(&out))
    };
    let (v1, v2) = ("fn main() {}\n", "fn main() { run(); }\n");
    let app = "_work_app/src/app.rs";
    // all: every distinct state as <name>.v<N>, in order.
    let (t, m) = run("all", &["--version", "all", "--path", "*/app.rs"]);
    assert_eq!(t.len(), 3, "{:?}", t.keys());
    assert_eq!(text(&t, &format!("{app}.v1")), v1);
    assert_eq!(text(&t, &format!("{app}.v2")), v2);
    assert_eq!(m[&format!("{app}.v1")]["source_event"], "backup");
    assert_eq!(m[&format!("{app}.v2")]["version"], 2);
    // first: the earliest full state; last: the final one.
    let (t, m) = run("first", &["--version", "first", "--path", "*/app.rs"]);
    assert_eq!(text(&t, app), v1);
    assert_eq!(
        (&m[app]["version"], &m[app]["source_event"]),
        (&json!(1), &json!("backup"))
    );
    let (t, m) = run("last", &["--version", "last", "--path", "*/app.rs"]);
    assert_eq!(text(&t, app), v2);
    assert_eq!(
        (&m[app]["version"], &m[app]["source_event"]),
        (&json!(2), &json!("backup"))
    );
    // --source narrows the events the replay uses.
    let (t, m) = run(
        "fh",
        &[
            "--version",
            "all",
            "--source",
            "file-history",
            "--path",
            "*/app.rs",
        ],
    );
    assert_eq!(t.len(), 3);
    assert!(m.values().all(|v| v["source_event"] == "backup"));
    let summary = "_work_app/pressure-test/SUMMARY.md";
    let (t, _) = run("sfirst", &["--version", "first", "--path", "*/SUMMARY.md"]);
    assert_eq!(text(&t, summary), r.draft, "first is the rejected draft");
    let (t, _) = run(
        "sall",
        &[
            "--version",
            "all",
            "--source",
            "transcript",
            "--path",
            "*/SUMMARY.md",
        ],
    );
    assert_eq!(text(&t, &format!("{summary}.v1")), r.draft);
    assert_eq!(text(&t, &format!("{summary}.v2")), r.returned);
    // --created-only and --layout session.
    let (t, _) = run(
        "created",
        &[
            "--created-only",
            "--layout",
            "session",
            "--path",
            "*/docs/*",
        ],
    );
    assert_eq!(
        t.keys().collect::<Vec<_>>(),
        [&format!("{}/docs/new.md", r.at.session), "MANIFEST.jsonl"]
    );
}

#[test]
fn w3_root_level_files_are_store_other() {
    let f = Fixture::new();
    let at = At::new(7, "/work/app", "main");
    let tok = "rootwidetoken";
    f.transcript("-work-app", &at, &[at.prompt(1, 1, &format!("say {tok}"))]);
    let others = [
        f.write("settings.json", json!({"model": tok}).to_string()),
        f.write("CLAUDE.md", format!("# notes {tok}\n")),
        f.write("history.jsonl.bak", format!("{tok}\n")),
        f.write("commands/c.md", format!("{tok}\n")),
        f.write("skills/s/SKILL.md", format!("{tok}\n")),
        f.write("plugins/p/x.json", json!({"k": tok}).to_string()),
        f.write("agents/a.md", format!("{tok}\n")),
        f.write("paste-cache/abc.txt", format!("{tok}\n")),
        f.write("shell-snapshots/snap.sh", format!("echo {tok}\n")),
        // A loose file directly in file-history/ (not a session backup).
        f.write("file-history/loose.txt", format!("{tok}\n")),
    ];
    let backup = f.backup(&at, "abc@v1", format!("{tok}\n"));
    // Every file under the root that holds the token is listed by -l.
    let mut all = Vec::new();
    walk(f.root(), &mut all);
    let want: BTreeSet<String> = all
        .iter()
        .filter(|p| std::fs::read_to_string(p).is_ok_and(|t| t.contains(tok)))
        .map(|p| p.display().to_string())
        .collect();
    assert_eq!(want.len(), others.len() + 2);
    let got: BTreeSet<String> = stdout(&f, &["grep", "-l", tok])
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(got, want);
    // The unclaimed ones are store `other`, type and part null, no session.
    let other: BTreeSet<String> = others.iter().map(|p| p.display().to_string()).collect();
    for h in f.grep_jsonl(&[tok]) {
        let path = h["path"].as_str().unwrap();
        if other.contains(path) {
            assert_eq!(
                (&h["store"], &h["type"], &h["part"], &h["session"]),
                (&json!("other"), &Value::Null, &Value::Null, &Value::Null),
                "{path}"
            );
        } else if path == backup.display().to_string() {
            assert_eq!(h["store"], "file-history");
        } else {
            assert_eq!(h["store"], "transcripts", "{path}");
        }
    }
    // `--store other` narrows to exactly them; other stores leave them out.
    let only: BTreeSet<String> = stdout(&f, &["grep", "-l", "--store", "other", tok])
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(only, other);
    let transcripts = stdout(&f, &["grep", "-l", "--store", "transcripts", tok]);
    assert_eq!(transcripts.lines().count(), 1, "{transcripts}");
    // R4: a failed search names the store.
    let out = f.clrg().args(["grep", "nosuchtoken"]).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(err.contains("workflows, other"), "{err}");
}

#[cfg(unix)]
#[test]
fn w4_skipped_symlinks_are_reported() {
    use std::os::unix::fs::symlink;
    let f = Fixture::new();
    let at = At::new(8, "/work/app", "main");
    let tok = "linkedtoken";
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "hello")]);
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("target.txt");
    std::fs::write(&target, format!("{tok}\n")).unwrap();
    // A symlinked file under projects/, and one at the root.
    symlink(&target, f.root().join("projects/-work-app/link.jsonl")).unwrap();
    symlink(&target, f.root().join("linked.md")).unwrap();
    // Not followed: the target's text is never found through them.
    let out = f.clrg().args(["grep", tok]).output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8(out.stderr).unwrap();
    // Counted and reported: once as a summary line, once in the R4 message.
    assert_eq!(
        err.matches("skipped 2 symlink(s) (not followed)").count(),
        2,
        "{err}"
    );
    assert!(
        err.contains("\n  skipped 2 symlink(s) (not followed)\n"),
        "{err}"
    );
    // On a match, the summary line is still printed (unless -q).
    let (_, err) = f.grep_both(&["hello"]);
    assert!(
        err.contains("clrg: skipped 2 symlink(s) (not followed)"),
        "{err}"
    );
    let out = f.clrg().args(["-q", "grep", "hello"]).output().unwrap();
    assert!(!String::from_utf8_lossy(&out.stderr).contains("symlink"));
    // Only symlinks in the searched stores count.
    let (_, err) = f.grep_both(&["hello", "--store", "transcripts"]);
    assert!(err.contains("skipped 1 symlink(s)"), "{err}");
}

// ─── Build 2 review: evidence and extract (fl5-fl7, x9-x14) ──────────────────

/// A `Write` of `content` to `path` (`tool_use` then its result): a
/// successful one carries `toolUseResult.content`; a failed one, an error.
fn write_pair(at: &At, n: u32, id: &str, path: &str, content: &str, ok: bool) -> [Value; 2] {
    let result = if ok {
        json!({"type": "create", "filePath": path, "content": content})
    } else {
        json!("Error: The user doesn't want to proceed with this tool use.")
    };
    [
        at.tool_use(
            n,
            n,
            id,
            "Write",
            json!({"file_path": path, "content": content}),
        ),
        at.result_for(n + 1, n, id, !ok, if ok { "ok" } else { "denied" }, result),
    ]
}

/// An `Edit` (`tool_use`, then its result unless `answered` is false), with
/// no `originalFile`, so replay applies it to the previous known content.
fn edit_pair(
    at: &At,
    n: u32,
    id: &str,
    path: &str,
    old: &str,
    new: &str,
    answered: bool,
) -> Vec<Value> {
    let mut v = vec![at.tool_use(
        n,
        n,
        id,
        "Edit",
        json!({"file_path": path, "old_string": old, "new_string": new}),
    )];
    if answered {
        v.push(at.result_for(
            n + 1,
            n,
            id,
            false,
            "edited",
            json!({"filePath": path, "oldString": old, "newString": new,
                   "replaceAll": false, "originalFile": null}),
        ));
    }
    v
}

/// `clrg [--root <more>] files <args> --format jsonl`, records by path.
fn files_roots(f: &Fixture, more: Option<&Fixture>, args: &[&str]) -> BTreeMap<String, Value> {
    let mut cmd = f.clrg();
    if let Some(m) = more {
        cmd.arg("--root").arg(m.root());
    }
    let out = cmd
        .arg("files")
        .args(args)
        .args(["--format", "jsonl"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(0), "{out:?}");
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| {
            let v: Value = serde_json::from_str(l).unwrap();
            (v["path"].as_str().unwrap().to_string(), v)
        })
        .collect()
}

#[test]
fn fl5_failed_read_is_not_a_write() {
    let f = Fixture::new();
    let at = At::new(0x70, CWD, "main");
    let written = "/work/app/notes.md";
    let missing = "/work/app/missing.rs";
    let mut lines = vec![at.prompt(1, 1, "read then write")];
    // A Read of a file that does not exist: its result is an error.
    lines.push(at.tool_use(2, 2, "toolu_r1", "Read", json!({"file_path": missing})));
    lines.push(at.result_for(
        3,
        2,
        "toolu_r1",
        true,
        "File does not exist.",
        json!("Error: File does not exist."),
    ));
    // A successful Write, then a failed Read of the same file.
    lines.extend(write_pair(&at, 4, "toolu_w1", written, "# Notes\n", true));
    lines.push(at.tool_use(6, 6, "toolu_r2", "Read", json!({"file_path": written})));
    lines.push(at.result_for(
        7,
        6,
        "toolu_r2",
        true,
        "too large",
        json!("Error: too large"),
    ));
    // A failed Bash is no file event at all.
    lines.push(at.tool_use(8, 8, "toolu_b1", "Bash", json!({"command": "false"})));
    lines.push(at.result_for(9, 8, "toolu_b1", true, "exit 1", json!("Error: exit 1")));
    f.transcript("-work-app", &at, &lines);

    let recs = files_jsonl(&f, &[]);
    assert_eq!(
        recs.keys().collect::<Vec<_>>(),
        [written],
        "a failed Read is not a write or a rejected write"
    );
    let w = &recs[written];
    assert_eq!(strs(&w["ops"]), ["write", "read"]);
    assert_eq!(
        w["outcome"], "written",
        "the failed Read does not reject it"
    );
    assert_eq!(w["recoverable"], "full");
    // --op read lists both reads, failed ones included, as reads.
    let reads = files_jsonl(&f, &["--op", "read"]);
    assert_eq!(strs(&reads[missing]["ops"]), ["read"]);
    assert_eq!(reads[missing]["outcome"], "unknown");
    assert_eq!(reads[missing]["recoverable"], "none");
    // Extract: the written file, no rejected label anywhere.
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert!(
        r.stdout
            .contains("outcome: 1 written, 0 rejected, 0 returned\n"),
        "{}",
        r.stdout
    );
    assert_eq!(manifest(&out)["_work_app/notes.md"]["outcome"], "written");
}

#[test]
fn fl6_backup_roots_merge_into_one_timeline() {
    let root_a = Fixture::new();
    let root_b = Fixture::new();
    let at = At::new(0x71, CWD, "main");
    let path = "/work/app/notes.txt";
    let mut lines = vec![at.prompt(1, 1, "write then edit")];
    lines.extend(write_pair(&at, 2, "toolu_w", path, "one\ntwo\n", true));
    lines.extend(edit_pair(&at, 4, "toolu_e", path, "two", "TWO", true));
    lines.push(at.snapshot(6, &[(path, Some("0b0b0b0b0b0b0b0b@v2"), 2, 7)]));
    // Root A: the whole transcript, but its backup file is gone.
    root_a.transcript("-work-app", &at, &lines);
    // Root B: an older copy, cut before the Edit's result, that still has
    // the snapshot line and the backup file.
    // Lines: prompt, Write, its result, Edit, its result, snapshot.
    let older: Vec<Value> = lines[..4].iter().chain(&lines[5..]).cloned().collect();
    root_b.transcript("-work-app", &at, &older);
    root_b.backup(&at, "0b0b0b0b0b0b0b0b@v2", "one\nTWO\n");
    let ra = root_a.root().display().to_string();
    let rb = root_b.root().display().to_string();

    // One record, listing both roots; root is the first.
    let recs = files_roots(&root_a, Some(&root_b), &[]);
    assert_eq!(recs.len(), 1, "{recs:?}");
    let rec = &recs[path];
    assert_eq!(rec["root"], ra.as_str());
    assert_eq!(rec["roots"], json!([ra, rb]));
    assert_eq!(strs(&rec["ops"]), ["write", "edit", "backup"]);
    assert_eq!(
        rec["outcome"], "written",
        "the answered copy of the Edit wins"
    );
    assert_eq!(rec["versions"], 2);
    // Roots in the other order: root follows the order given.
    let recs = files_roots(&root_b, Some(&root_a), &[]);
    assert_eq!(recs[path]["root"], rb.as_str());
    assert_eq!(recs[path]["roots"], json!([rb, ra]));

    // Extract never refuses for duplicate copies: one timeline, one file.
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let o = root_a
        .clrg()
        .arg("--root")
        .arg(root_b.root())
        .args(["extract", "--version", "all", "-o"])
        .arg(&out)
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(0), "{o:?}");
    let t = tree(&out);
    assert_eq!(text(&t, "_work_app/notes.txt.v1"), "one\ntwo\n");
    assert_eq!(text(&t, "_work_app/notes.txt.v2"), "one\nTWO\n");
    assert_eq!(t.len(), 3, "{:?}", t.keys());
    let m = manifest(&out);
    let v2 = &m["_work_app/notes.txt.v2"];
    assert_eq!(v2["source_event"], "edit");
    assert_eq!(
        v2["verified"], "agree",
        "A's edit is verified against B's backup: one chain across roots"
    );
    assert_eq!(v2["roots"], json!([ra, rb]));
    assert_eq!(v2["root"], ra.as_str());
}

#[test]
fn fl7_selectors_choose_paths_not_events() {
    let f = Fixture::new();
    let main = At::new(0x72, CWD, "main");
    let feat = main.branch("feat");
    let chained = "/work/app/chained.txt";
    let only_main = "/work/app/main-only.txt";
    let mut lines = vec![main.prompt(1, 1, "write on main")];
    lines.extend(write_pair(&main, 2, "toolu_w1", chained, "a\nb\n", true));
    lines.extend(write_pair(&main, 4, "toolu_w2", only_main, "m\n", true));
    lines.extend(edit_pair(&feat, 6, "toolu_e1", chained, "b", "B", true));
    f.transcript("-work-app", &main, &lines);

    // -b feat chooses the path its Edit touched, and keeps every event on
    // it: the Write on main is the Edit's base.
    for sel in [&["-b", "feat"][..], &["--since", "2026-08-02T14:05:00Z"]] {
        let recs = files_jsonl(&f, sel);
        assert_eq!(recs.keys().collect::<Vec<_>>(), [chained], "{sel:?}");
        let r = &recs[chained];
        assert_eq!(strs(&r["ops"]), ["write", "edit"], "{sel:?}");
        assert_eq!(strs(&r["branches"]), ["main", "feat"]);
        assert_eq!(r["recoverable"], "full", "{sel:?}: the chain is whole");
        assert_eq!(r["versions"], 2);
        let tmp = tempfile::tempdir().unwrap();
        let out = tmp.path().join("out");
        let x = extract(&f, &out, sel);
        assert_eq!(x.code, Some(0), "{sel:?}: {}", x.stderr);
        let t = tree(&out);
        assert_eq!(text(&t, "_work_app/chained.txt"), "a\nB\n");
        assert!(!t.contains_key("_work_app/main-only.txt"), "{sel:?}");
    }
}

#[test]
fn x9_outside_cwd_goes_to_abs_and_never_refuses_the_run() {
    let f = Fixture::new();
    let at = At::new(0x73, CWD, "main");
    let inside = "/work/app/in.txt";
    let outside = "/opt/notes/plan.md";
    let mut lines = vec![at.prompt(1, 1, "write in and out")];
    lines.extend(write_pair(&at, 2, "toolu_w1", inside, "in\n", true));
    lines.extend(write_pair(&at, 4, "toolu_w2", outside, "plan\n", true));
    f.transcript("-work-app", &at, &lines);
    // A session with no cwd whose relative path has `..`: unsafe.
    let nocwd = At::new(0x74, "", "main");
    let strip = |mut v: Value| {
        v.as_object_mut().unwrap().remove("cwd");
        v
    };
    let lines: Vec<Value> = std::iter::once(nocwd.prompt(1, 1, "escape"))
        .chain(write_pair(
            &nocwd,
            2,
            "toolu_x",
            "../escape.txt",
            "x\n",
            true,
        ))
        .map(strip)
        .collect();
    f.transcript("-nowhere", &nocwd, &lines);

    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(4), "the unsafe path makes it 4: {}", r.stderr);
    let t = tree(&out);
    assert_eq!(
        t.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "MANIFEST.jsonl",
            "_abs/opt/notes/plan.md",
            "_work_app/in.txt"
        ],
        "the other paths are still written"
    );
    assert_eq!(text(&t, "_abs/opt/notes/plan.md"), "plan\n");
    let m = manifest(&out);
    assert_eq!(m["_abs/opt/notes/plan.md"]["path"], outside);
    assert!(
        r.stdout.ends_with(
            "  unsafe, skipped (1):\n    ../escape.txt: a relative path, and its session has no cwd\n"
        ),
        "{}",
        r.stdout
    );
    assert!(!tmp.path().join("escape.txt").exists());
    // jsonl: the skipped path goes to stderr.
    let r = extract(&f, &tmp.path().join("jsonl"), &["--format", "jsonl"]);
    assert_eq!(r.code, Some(4));
    assert_eq!(r.stdout.lines().count(), 2);
    assert!(
        r.stderr
            .starts_with("clrg extract: unsafe path skipped: ../escape.txt: "),
        "{}",
        r.stderr
    );
}

#[test]
fn x10_case_collisions_are_suffixed_before_writing() {
    let f = Fixture::new();
    let at = At::new(0x75, CWD, "main");
    let mut lines = vec![at.prompt(1, 1, "three readmes")];
    lines.extend(write_pair(
        &at,
        2,
        "toolu_1",
        "/work/app/Readme.md",
        "title\n",
        true,
    ));
    lines.extend(write_pair(
        &at,
        4,
        "toolu_2",
        "/work/app/README.md",
        "upper\n",
        true,
    ));
    lines.extend(write_pair(
        &at,
        6,
        "toolu_3",
        "/work/app/readme.md",
        "lower\n",
        true,
    ));
    f.transcript("-work-app", &at, &lines);
    let tmp = tempfile::tempdir().unwrap();
    // The plan (a dry run) already has the final names; nothing is written.
    let dry = tmp.path().join("dry");
    let r = extract(&f, &dry, &["--dry-run"]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert!(!dry.exists());
    let planned: Vec<&str> = r
        .stdout
        .lines()
        .filter(|l| l.starts_with("would write "))
        .collect();
    assert_eq!(
        planned,
        [
            "would write _work_app/README.md  <- /work/app/README.md  (v1 from write, outcome written)",
            "would write _work_app/Readme.md~2  <- /work/app/Readme.md  (v1 from write, outcome written)",
            "would write _work_app/readme.md~3  <- /work/app/readme.md  (v1 from write, outcome written)",
        ],
        "suffixes follow path order, decided before any write"
    );
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    let t = tree(&out);
    assert_eq!(text(&t, "_work_app/README.md"), "upper\n");
    assert_eq!(text(&t, "_work_app/Readme.md~2"), "title\n");
    assert_eq!(text(&t, "_work_app/readme.md~3"), "lower\n");
    // The manifest records each final out_path.
    let m = manifest(&out);
    assert_eq!(m["_work_app/Readme.md~2"]["path"], "/work/app/Readme.md");
    assert_eq!(m["_work_app/readme.md~3"]["path"], "/work/app/readme.md");
    assert_eq!(m.len(), 3);
}

#[test]
fn x11_last_skips_newer_rejected_draft() {
    let f = Fixture::new();
    let at = At::new(0x76, CWD, "main");
    let path = "/work/app/c.txt";
    let mut lines = vec![at.prompt(1, 1, "write then a denied write")];
    lines.extend(write_pair(&at, 2, "toolu_1", path, "real\n", true));
    lines.extend(write_pair(&at, 4, "toolu_2", path, "denied draft\n", false));
    f.transcript("-work-app", &at, &lines);
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("last");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert_eq!(
        text(&tree(&out), "_work_app/c.txt"),
        "real\n",
        "the on-disk state"
    );
    let rec = &manifest(&out)["_work_app/c.txt"];
    assert_eq!(rec["source_event"], "write");
    assert_eq!(rec["outcome"], "written");
    assert!(
        r.stdout.contains(
            "  1 newer rejected draft not extracted; use --version all:\n    /work/app/c.txt\n"
        ),
        "{}",
        r.stdout
    );
    // jsonl: the note goes to stderr.
    let r = extract(&f, &tmp.path().join("jsonl"), &["--format", "jsonl"]);
    assert_eq!(r.code, Some(0));
    assert_eq!(
        r.stderr,
        "clrg extract: 1 newer rejected draft(s) not extracted; use --version all: /work/app/c.txt\n"
    );
    // --version all still writes the draft, labelled.
    let out = tmp.path().join("all");
    assert_eq!(extract(&f, &out, &["--version", "all"]).code, Some(0));
    let m = manifest(&out);
    assert_eq!(m["_work_app/c.txt.v2"]["outcome"], "rejected");
    assert_eq!(text(&tree(&out), "_work_app/c.txt.v2"), "denied draft\n");
    // The SUMMARY.md case (rejected, then returned) still yields the
    // returned version.
    let (rf, rr) = recovery();
    let out = tmp.path().join("summary");
    let r = extract(&rf, &out, &["--path", "*pressure-test/SUMMARY.md"]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert_eq!(
        text(&tree(&out), "_work_app/pressure-test/SUMMARY.md"),
        rr.returned
    );
    assert!(!r.stdout.contains("newer rejected"), "{}", r.stdout);
}

/// A subagent transcript `agent-<agent>.jsonl` of `at`'s session.
fn subagent(f: &Fixture, at: &At, agent: &str, lines: &[Value]) {
    let lines: Vec<Value> = lines
        .iter()
        .cloned()
        .map(|l| fixtures::sidechain(l, agent))
        .collect();
    f.session_jsonl(
        "-work-app",
        at,
        &format!("subagents/agent-{agent}.jsonl"),
        &lines,
    );
}

#[test]
fn x12_returned_rule_rejects_unrelated_or_short_candidates() {
    let f = Fixture::new();
    let at = At::new(0x77, CWD, "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "run the agents")]);
    let text_part = |t: &str| json!([{"type": "text", "text": t}]);
    // a) Fewer than 3 non-blank lines: a tiny JSON draft quoted in a report.
    let report = (0..50)
        .map(|i| format!("finding {i}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut case_a = write_pair(&at, 2, "toolu_a", "/work/app/cfg.json", "{\n}\n", false).to_vec();
    case_a.push(at.assistant(4, 4, text_part(&format!("{report}example:\n{{\n}}\n"))));
    subagent(&f, &at, "a1", &case_a);
    // b) Every line found, but the candidate is over 2x as long.
    let draft_b = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
    let mut case_b = write_pair(&at, 2, "toolu_b", "/work/app/long.md", draft_b, false).to_vec();
    case_b.push(at.assistant(4, 4, text_part(&format!("{draft_b}{report}"))));
    subagent(&f, &at, "b1", &case_b);
    // c) Every line found, but the candidate is under half as long.
    let draft_c = "same line\n".repeat(10);
    let mut case_c = write_pair(&at, 2, "toolu_c", "/work/app/short.md", &draft_c, false).to_vec();
    case_c.push(at.assistant(4, 4, text_part("same line\n")));
    subagent(&f, &at, "c1", &case_c);
    // d) One candidate matching two rejected drafts: returned for the one it
    //    matches best only.
    let exact = "one\ntwo\nthree\nfour\nfive\n";
    let near = "one\ntwo\nthree\nfour\nsix\n";
    let mut case_d = write_pair(&at, 2, "toolu_d1", "/work/app/exact.md", exact, false).to_vec();
    case_d.extend(write_pair(
        &at,
        4,
        "toolu_d2",
        "/work/app/near.md",
        near,
        false,
    ));
    case_d.push(at.tool_use(6, 6, "toolu_o", "StructuredOutput", json!({"file": exact})));
    subagent(&f, &at, "d1", &case_d);

    let recs = files_jsonl(&f, &[]);
    for p in [
        "/work/app/cfg.json",
        "/work/app/long.md",
        "/work/app/short.md",
        "/work/app/near.md",
    ] {
        assert_eq!(strs(&recs[p]["ops"]), ["rejected"], "{p}: not returned");
        assert_eq!(recs[p]["outcome"], "rejected", "{p}");
    }
    let e = &recs["/work/app/exact.md"];
    assert_eq!(strs(&e["ops"]), ["rejected", "returned"]);
    assert_eq!(e["outcome"], "returned");
}

#[test]
fn x13_returned_picks_highest_similarity_field() {
    let f = Fixture::new();
    let at = At::new(0x78, CWD, "main");
    f.transcript("-work-app", &at, &[at.prompt(1, 1, "run the agent")]);
    let draft = "# Report\nalpha\nbeta\ngamma\ndelta\n";
    let body = "# Report\nalpha\nbeta\ngamma\ndelta (linted)\nepsilon\n";
    // Longer than body, and unrelated: the old "longest string" rule chose it.
    let notes = (0..40)
        .map(|i| format!("note {i}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut lines = write_pair(&at, 2, "toolu_w", "/work/app/REPORT.md", draft, false).to_vec();
    lines.push(at.assistant(
        4,
        4,
        json!([
            // The last assistant text: 3 of 5 lines (0.6).
            {"type": "text", "text": "# Report\nalpha\nbeta\nsomething else\n"},
            {"type": "tool_use", "id": "toolu_o", "name": "StructuredOutput",
             "input": {"notes": notes, "result": {"files": [{"body": body}]}, "summary": "done"}}
        ]),
    ));
    subagent(&f, &at, "r1", &lines);
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(0), "{}", r.stderr);
    assert_eq!(
        text(&tree(&out), "_work_app/REPORT.md"),
        body,
        "the nested field with the highest similarity"
    );
    let rec = &manifest(&out)["_work_app/REPORT.md"];
    assert_eq!(rec["outcome"], "returned");
    assert!(
        (rec["similarity"].as_f64().unwrap() - 0.8).abs() < 1e-9,
        "{rec}"
    );
    assert_eq!(rec["agent_id"], "r1");
}

#[test]
fn x14_edit_replay_crlf_and_line_deletion() {
    let f = Fixture::new();
    let at = At::new(0x79, CWD, "main");
    let crlf = "/work/app/crlf.txt";
    let del = "/work/app/del.txt";
    let unk = "/work/app/unknown.txt";
    let mut lines = vec![at.prompt(1, 1, "edits")];
    // CRLF file; the Edit's strings use LF, as Claude Code sends them.
    lines.extend(write_pair(
        &at,
        2,
        "toolu_c1",
        crlf,
        "a\r\nb\r\nc\r\n",
        true,
    ));
    lines.extend(edit_pair(&at, 4, "toolu_c2", crlf, "b\nc", "B\nC", true));
    // An empty newString removing a whole line removes its newline too.
    lines.extend(write_pair(
        &at,
        6,
        "toolu_d1",
        del,
        "keep\ndrop me\nkeep too\n",
        true,
    ));
    lines.extend(edit_pair(&at, 8, "toolu_d2", del, "drop me", "", true));
    // An Edit with no result: unknown, and the next Edit does not chain.
    lines.extend(write_pair(&at, 10, "toolu_u1", unk, "x1\n", true));
    lines.extend(edit_pair(&at, 12, "toolu_u2", unk, "x1", "x2", false));
    lines.extend(edit_pair(&at, 13, "toolu_u3", unk, "x2", "x3", true));
    f.transcript("-work-app", &at, &lines);

    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("out");
    let r = extract(&f, &out, &[]);
    assert_eq!(r.code, Some(4), "{}", r.stderr);
    let t = tree(&out);
    assert_eq!(
        text(&t, "_work_app/crlf.txt"),
        "a\r\nB\r\nC\r\n",
        "line endings kept"
    );
    assert_eq!(text(&t, "_work_app/del.txt"), "keep\nkeep too\n");
    assert!(!t.contains_key("_work_app/unknown.txt"), "{:?}", t.keys());
    assert!(
        r.stdout
            .contains(&format!("  not recoverable (1):\n    diff-only  {unk}\n")),
        "{}",
        r.stdout
    );
    // --version all: the unanswered Edit's content is a state labelled
    // unknown; nothing is built on top of it.
    let out = tmp.path().join("all");
    assert_eq!(
        extract(&f, &out, &["--version", "all", "--path", "*/unknown.txt"]).code,
        Some(4)
    );
    let m = manifest(&out);
    assert_eq!(m["_work_app/unknown.txt.v1"]["outcome"], "written");
    assert_eq!(m["_work_app/unknown.txt.v2"]["outcome"], "unknown");
    assert_eq!(text(&tree(&out), "_work_app/unknown.txt.v2"), "x2\n");
    assert_eq!(m.len(), 2, "no x3: the last Edit has no base");
}
