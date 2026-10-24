//! A synthetic `~/.claude`-shaped root in a temp folder, for tests.
//!
//! Content is deterministic. Ids are UUID-shaped but generated from small
//! seeds at run time (`00000001-5e55-4000-8000-000000000001`), so no real id
//! appears in the source. Paths are fake (`/work/...`).

#![allow(dead_code)] // Each test binary uses a different subset.

use std::path::{Path, PathBuf};

use assert_cmd::Command;
use serde_json::{Value, json};
use tempfile::TempDir;

/// A UUID-shaped session id from a seed.
pub fn session_id(seed: u32) -> String {
    format!("{seed:08x}-5e55-4000-8000-{seed:012x}")
}

/// A UUID-shaped message id from a session seed and a message number.
pub fn message_id(seed: u32, n: u32) -> String {
    format!("{seed:08x}-0000-4000-8000-{n:012x}")
}

/// Unix ms of `2026-08-02T14:<minute>:00Z`, the time [`At`] gives message
/// `minute`, as `history.jsonl` writes it.
pub fn ms(minute: u32) -> i64 {
    1_785_679_200_000 + i64::from(minute) * 60_000
}

/// Where a message happened.
#[derive(Debug, Clone)]
pub struct At {
    pub session: String,
    pub cwd: String,
    pub branch: String,
    pub version: String,
}

impl At {
    pub fn new(seed: u32, cwd: &str, branch: &str) -> At {
        At {
            session: session_id(seed),
            cwd: cwd.into(),
            branch: branch.into(),
            version: "1.0.40".into(),
        }
    }

    pub fn branch(&self, branch: &str) -> At {
        At {
            branch: branch.into(),
            ..self.clone()
        }
    }

    fn line(&self, kind: &str, n: u32, minute: u32, message: Value) -> Value {
        let seed = u32::from_str_radix(&self.session[..8], 16).unwrap_or(0);
        let mut line = json!({
            "type": kind,
            "uuid": message_id(seed, n),
            "parentUuid": if n > 1 { Value::String(message_id(seed, n - 1)) } else { Value::Null },
            "sessionId": self.session,
            "timestamp": format!("2026-08-02T14:{minute:02}:00.000Z"),
            "cwd": self.cwd,
            "gitBranch": self.branch,
            "version": self.version,
            "isSidechain": false,
            "userType": "external",
        });
        line["message"] = message;
        line
    }

    /// A typed prompt (message `n`, at 14:`minute`).
    pub fn prompt(&self, n: u32, minute: u32, text: &str) -> Value {
        self.line("user", n, minute, json!({"role": "user", "content": text}))
    }

    /// A user line with the given `message.content` and extra top-level
    /// fields (`isMeta`, `isCompactSummary`, ...).
    pub fn user(&self, n: u32, minute: u32, content: &Value, extra: &Value) -> Value {
        let mut line = self.line("user", n, minute, json!({"role": "user"}));
        line["message"]["content"] = content.clone();
        if let Some(extra) = extra.as_object() {
            for (k, v) in extra {
                line[k] = v.clone();
            }
        }
        line
    }

    /// The `history.jsonl` line Claude Code writes when the owner types
    /// `display` at 14:`minute` in this session.
    pub fn history(&self, minute: u32, display: &str) -> Value {
        json!({"display": display, "pastedContents": {}, "timestamp": ms(minute),
               "project": self.cwd, "sessionId": self.session})
    }

    /// An assistant message with the given content parts.
    pub fn assistant(&self, n: u32, minute: u32, parts: Value) -> Value {
        let mut message = json!({"role": "assistant", "model": "model-x"});
        message["content"] = parts;
        self.line("assistant", n, minute, message)
    }

    /// A tool result returned in a user line.
    pub fn tool_result(&self, n: u32, minute: u32, text: &str) -> Value {
        self.line(
            "user",
            n,
            minute,
            json!({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "toolu_fake", "content": [{"type": "text", "text": text}]}
            ]}),
        )
    }
}

/// A synthetic root.
pub struct Fixture {
    dir: TempDir,
}

impl Fixture {
    pub fn new() -> Fixture {
        Fixture {
            dir: tempfile::tempdir().expect("a temp dir"),
        }
    }

    pub fn root(&self) -> &Path {
        self.dir.path()
    }

    /// Write `contents` at `rel` under the root, creating folders.
    pub fn write(&self, rel: &str, contents: impl AsRef<[u8]>) -> PathBuf {
        let path = self.root().join(rel);
        std::fs::create_dir_all(path.parent().expect("a parent")).expect("mkdir");
        std::fs::write(&path, contents).expect("write");
        path
    }

    /// Write JSONL lines at `rel`.
    pub fn jsonl(&self, rel: &str, lines: &[Value]) -> PathBuf {
        let mut text = String::new();
        for l in lines {
            text.push_str(&l.to_string());
            text.push('\n');
        }
        self.write(rel, text)
    }

    /// Write `history.jsonl` at the root.
    pub fn history(&self, lines: &[Value]) -> PathBuf {
        self.jsonl("history.jsonl", lines)
    }

    /// Write a transcript for `at.session` under `projects/<project>/`.
    pub fn transcript(&self, project: &str, at: &At, lines: &[Value]) -> PathBuf {
        self.jsonl(&format!("projects/{project}/{}.jsonl", at.session), lines)
    }

    /// `<root>/home`: the `HOME` that [`Fixture::clrg`] sets.
    pub fn home(&self) -> PathBuf {
        self.root().join("home")
    }

    /// `clrg` with this root, no `CLRG_*` environment, run from the root,
    /// with `HOME` at [`Fixture::home`] and times in UTC. Output is piped, so
    /// it has no color and is 100 columns wide.
    pub fn clrg(&self) -> Command {
        let mut cmd = Command::cargo_bin("clrg").expect("the clrg binary is built");
        for var in [
            "CLRG_ROOTS",
            "CLRG_INDEX",
            "CLRG_COLOR",
            "CLRG_PAGER",
            "PWD",
        ] {
            cmd.env_remove(var);
        }
        cmd.env("TZ", "UTC").env("HOME", self.home());
        cmd.current_dir(self.root());
        cmd.arg("--root").arg(self.root());
        cmd
    }

    /// Run `clrg grep <args>` and return stdout. Asserts exit 0.
    pub fn grep_stdout(&self, args: &[&str]) -> String {
        let out = self
            .clrg()
            .arg("grep")
            .args(args)
            .output()
            .expect("clrg runs");
        assert_eq!(
            out.status.code(),
            Some(0),
            "clrg grep {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).expect("utf-8")
    }

    /// Run `clrg grep <args>` and return (stdout, stderr). Asserts exit 0.
    pub fn grep_both(&self, args: &[&str]) -> (String, String) {
        let out = self
            .clrg()
            .arg("grep")
            .args(args)
            .output()
            .expect("clrg runs");
        let err = String::from_utf8(out.stderr).expect("utf-8");
        assert_eq!(
            out.status.code(),
            Some(0),
            "clrg grep {args:?} failed: {err}"
        );
        (String::from_utf8(out.stdout).expect("utf-8"), err)
    }

    /// Run `clrg grep <args> --format jsonl` and parse the records. Asserts
    /// exit 0.
    pub fn grep_jsonl(&self, args: &[&str]) -> Vec<Value> {
        let out = self
            .clrg()
            .arg("grep")
            .args(args)
            .args(["--format", "jsonl"])
            .output()
            .expect("clrg runs");
        assert_eq!(
            out.status.code(),
            Some(0),
            "clrg grep {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout)
            .expect("utf-8")
            .lines()
            .map(|l| serde_json::from_str(l).expect("a JSON record"))
            .collect()
    }
}

/// The token planted once in every store by [`every_store`].
pub const TOKEN: &str = "omnitoken";

/// A root with [`TOKEN`] once in each of the seven stores and in one `other` file. Returns the fixture and the files that contain the token.
pub fn every_store() -> (Fixture, Vec<PathBuf>) {
    let f = Fixture::new();
    let at = At::new(1, "/work/app", "main");
    let sid = at.session.clone();
    let files = vec![
        f.transcript(
            "-work-app",
            &at,
            &[
                at.prompt(1, 1, &format!("find the {TOKEN} please")),
                at.assistant(2, 2, json!([{"type": "text", "text": "Looking."}])),
            ],
        ),
        f.jsonl(
            "history.jsonl",
            &[json!({"display": format!("{TOKEN} from history"), "timestamp": 1_785_000_000_000_i64,
                     "project": "/work/app", "sessionId": sid})],
        ),
        f.write("plans/quiet-river.md", format!("# Plan\n\nUse the {TOKEN} here.\n")),
        f.write(
            &format!("todos/{sid}-agent-{sid}.json"),
            json!([{"content": format!("{TOKEN} todo"), "status": "pending", "id": "1"}]).to_string(),
        ),
        f.write(&format!("tasks/{sid}/1.json"), json!({"subject": format!("{TOKEN} task")}).to_string()),
        f.write(&format!("file-history/{sid}/0a1b2c3d@v1"), format!("fn main() {{\n    // {TOKEN}\n}}\n")),
        f.write("sessions/101.json", json!({"sessionId": sid, "note": TOKEN}).to_string()),
        // Claimed by no other store: store `other` (R3, whole root).
        f.write("settings.json", json!({"note": TOKEN}).to_string()),
    ];
    (f, files)
}

// ─── Recovery (Build 2): evidence about file contents ────────────────────────

impl At {
    /// An assistant line with one `tool_use` part (`id`, `name`, `input`).
    pub fn tool_use(&self, n: u32, minute: u32, id: &str, name: &str, input: Value) -> Value {
        let mut part = json!({"type": "tool_use", "id": id, "name": name});
        part["input"] = input;
        self.assistant(n, minute, Value::Array(vec![part]))
    }

    /// The user line that answers `tool_use` `id`: a `tool_result` part
    /// (`is_error` when `error`), and the line's `toolUseResult`.
    pub fn result_for(
        &self,
        n: u32,
        minute: u32,
        id: &str,
        error: bool,
        text: &str,
        tool_use_result: Value,
    ) -> Value {
        let mut line = self.line(
            "user",
            n,
            minute,
            json!({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": id, "is_error": error, "content": text}
            ]}),
        );
        line["toolUseResult"] = tool_use_result;
        line
    }

    /// A `file-history-snapshot` line. Each backup is (path as recorded,
    /// `backupFileName` or `None`, version, minute of `backupTime`). Like
    /// the real lines, it has no `sessionId`, `cwd`, or `timestamp`.
    pub fn snapshot(&self, n: u32, backups: &[(&str, Option<&str>, u32, u32)]) -> Value {
        let seed = u32::from_str_radix(&self.session[..8], 16).unwrap_or(0);
        let mut tracked = serde_json::Map::new();
        for (path, name, version, minute) in backups {
            tracked.insert(
                (*path).to_string(),
                json!({"backupFileName": name, "version": version,
                       "backupTime": format!("2026-08-02T14:{minute:02}:00.000Z")}),
            );
        }
        json!({"type": "file-history-snapshot", "messageId": message_id(seed, n),
               "snapshot": {"messageId": message_id(seed, n), "trackedFileBackups": tracked},
               "isSnapshotUpdate": false})
    }
}

/// `line` as a subagent's: `isSidechain` and its `agentId`.
pub fn sidechain(mut line: Value, agent: &str) -> Value {
    line["isSidechain"] = json!(true);
    line["agentId"] = json!(agent);
    line
}

impl Fixture {
    /// A file-history backup: `file-history/<session>/<name>`.
    pub fn backup(&self, at: &At, name: &str, bytes: impl AsRef<[u8]>) -> PathBuf {
        self.write(&format!("file-history/{}/{name}", at.session), bytes)
    }

    /// A file under the session folder: `projects/<project>/<sid>/<rel>`.
    pub fn session_file(
        &self,
        project: &str,
        at: &At,
        rel: &str,
        contents: impl AsRef<[u8]>,
    ) -> PathBuf {
        self.write(
            &format!("projects/{project}/{}/{rel}", at.session),
            contents,
        )
    }

    /// JSONL lines under the session folder.
    pub fn session_jsonl(&self, project: &str, at: &At, rel: &str, lines: &[Value]) -> PathBuf {
        self.jsonl(&format!("projects/{project}/{}/{rel}", at.session), lines)
    }
}

/// The paths and texts of [`recovery`].
pub struct Recovery {
    pub at: At,
    pub project: &'static str,
    /// The workflow subagent's id (`agent-<id>.jsonl`).
    pub agent: &'static str,
    /// The rejected first draft of `SUMMARY.md`.
    pub draft: String,
    /// The linted version the subagent returned in `StructuredOutput.file`.
    pub returned: String,
    /// The subagent transcript.
    pub subagent: PathBuf,
}

pub const CWD: &str = "/work/app";
pub const SUMMARY: &str = "/work/app/pressure-test/SUMMARY.md";
pub const APP_RS: &str = "/work/app/src/app.rs";
pub const NEW_MD: &str = "/work/app/docs/new.md";
pub const EDITED_ONLY: &str = "/work/app/src/edited-only.rs";
pub const BLOCKED: &str = "/work/app/blocked.txt";
pub const README: &str = "/work/app/README.md";

/// The first draft: ten non-blank lines of synthetic markdown.
fn summary_draft() -> String {
    [
        "# Pressure test summary",
        "",
        "## Findings",
        "",
        "- The queue drains in under a second at 100 rps.",
        "- The cache warms after the third request.",
        "- Two retries hide one transient failure.",
        "",
        "## Risks",
        "",
        "- the retry budget is shared across tenants",
        "- Logs omit the request id on timeouts.",
        "",
        "## Next steps",
        "Raise the queue depth alarm.",
    ]
    .join("\n")
        + "\n"
}

/// The returned version: the draft, linted (one line fixed) and extended.
fn summary_returned() -> String {
    summary_draft().replace(
        "- the retry budget is shared across tenants",
        "- The retry budget is shared across tenants.",
    ) + "\n## Appendix\n\nRaw timings are in the run record.\n"
}

/// A session on `onboarding.gonzo` in `/work/app` with every kind of
/// evidence:
///
/// - `src/app.rs`: a relative snapshot path; a backup, an `Edit` with no
///   `originalFile`, then a later backup that agrees.
/// - `docs/new.md`: an absent-file backup, then a successful `Write`.
/// - `src/edited-only.rs`: an `Edit` with no base (diff-only).
/// - `blocked.txt`: a `Write` whose result is an error (rejected).
/// - `README.md`: a `Read`.
/// - `pressure-test/SUMMARY.md` (the SUMMARY.md case): a workflow subagent's
///   `Write` is rejected ("Subagents should return findings as text, not
///   write report files"), it runs two lint `Bash` calls, then returns a
///   revised version in `StructuredOutput.file`; the workflow journal holds
///   the same text as the agent's `result`.
///
/// Also: the workflow run record (`workflows/*.json`) and the subagent's
/// `*.meta.json`.
pub fn recovery() -> (Fixture, Recovery) {
    let f = Fixture::new();
    let project = "-work-app";
    let at = At::new(0x51, CWD, "onboarding.gonzo");
    recovery_main(&f, project, &at);
    let agent = "a5f00d";
    let draft = summary_draft();
    let returned = summary_returned();
    let subagent = recovery_subagent(&f, project, &at, agent, &draft, &returned);
    (
        f,
        Recovery {
            at,
            project,
            agent,
            draft,
            returned,
            subagent,
        },
    )
}

/// The main transcript of [`recovery`] and its backups.
fn recovery_main(f: &Fixture, project: &str, at: &At) {
    // A later line runs in a subfolder: relative paths still resolve against
    // the launch folder.
    let in_src = At {
        cwd: format!("{CWD}/src"),
        ..at.clone()
    };
    let v1 = "fn main() {}\n";
    let v2 = "fn main() { run(); }\n";
    f.backup(at, "0a0a0a0a0a0a0a0a@v1", v1);
    f.backup(at, "0a0a0a0a0a0a0a0a@v2", v2);
    let new_md = "# New\n\nCreated by a Write.\n";
    let edit = |file: &str, old: &str, new: &str| json!({"file_path": file, "old_string": old, "new_string": new});
    f.transcript(
        project,
        at,
        &[
            at.prompt(1, 1, "run the pressure test workflow"),
            in_src.assistant(2, 1, json!([{"type": "text", "text": "Starting."}])),
            at.snapshot(3, &[("src/app.rs", Some("0a0a0a0a0a0a0a0a@v1"), 1, 2), ("docs/new.md", None, 1, 2)]),
            at.tool_use(4, 3, "toolu_e1", "Edit", edit(APP_RS, "fn main() {}", "fn main() { run(); }")),
            at.result_for(4, 3, "toolu_e1", false, "edited",
                json!({"filePath": APP_RS, "oldString": "fn main() {}", "newString": "fn main() { run(); }",
                       "replaceAll": false, "originalFile": null, "structuredPatch": [], "userModified": false})),
            at.tool_use(5, 4, "toolu_w1", "Write", json!({"file_path": NEW_MD, "content": new_md})),
            at.result_for(6, 4, "toolu_w1", false, "created",
                json!({"type": "create", "filePath": NEW_MD, "content": new_md, "originalFile": null,
                       "structuredPatch": [], "userModified": false})),
            at.snapshot(7, &[("src/app.rs", Some("0a0a0a0a0a0a0a0a@v2"), 2, 5), ("docs/new.md", None, 1, 2)]),
            at.tool_use(8, 6, "toolu_e2", "Edit", edit(EDITED_ONLY, "old()", "new()")),
            at.result_for(9, 6, "toolu_e2", false, "edited",
                json!({"filePath": EDITED_ONLY, "oldString": "old()", "newString": "new()",
                       "replaceAll": false, "originalFile": null, "structuredPatch": [], "userModified": false})),
            at.tool_use(10, 7, "toolu_w2", "Write", json!({"file_path": BLOCKED, "content": "never written\n"})),
            at.result_for(11, 7, "toolu_w2", true, "Permission denied", json!("Error: Permission denied")),
            at.tool_use(12, 8, "toolu_r1", "Read", json!({"file_path": README})),
            at.result_for(13, 8, "toolu_r1", false, "# App", json!({"type": "text"})),
        ],
    );
}

/// The workflow subagent of [`recovery`]: its transcript (returned), its
/// journal, its `*.meta.json`, and the workflow run record.
fn recovery_subagent(
    f: &Fixture,
    project: &str,
    at: &At,
    agent: &str,
    draft: &str,
    returned: &str,
) -> PathBuf {
    let side = |v: Value| sidechain(v, agent);
    let bash = |cmd: &str| json!({"command": cmd, "description": "lint"});
    let subagent = f.session_jsonl(
        project,
        at,
        &format!("subagents/workflows/wf-pressure/agent-{agent}.jsonl"),
        &[
            side(at.prompt(1, 10, "write the pressure test summary")),
            side(at.tool_use(
                2,
                11,
                "toolu_s1",
                "Write",
                json!({"file_path": SUMMARY, "content": draft}),
            )),
            side(at.result_for(
                3,
                11,
                "toolu_s1",
                true,
                "Subagents should return findings as text, not write report files",
                json!("Error: Subagents should return findings as text, not write report files"),
            )),
            side(at.tool_use(
                4,
                12,
                "toolu_b1",
                "Bash",
                bash("markdownlint pressure-test/SUMMARY.md"),
            )),
            side(at.result_for(
                5,
                12,
                "toolu_b1",
                false,
                "MD004 list style",
                json!({"stdout": "MD004"}),
            )),
            side(at.tool_use(
                6,
                13,
                "toolu_b2",
                "Bash",
                bash("markdownlint --fix pressure-test/SUMMARY.md"),
            )),
            side(at.result_for(7, 13, "toolu_b2", false, "", json!({"stdout": ""}))),
            side(at.assistant(
                8,
                14,
                json!([
                    {"type": "text", "text": "Returning the summary as text."},
                    {"type": "tool_use", "id": "toolu_o1", "name": "StructuredOutput",
                     "input": {"file": returned, "summary": "Pressure test summary, linted"}}
                ]),
            )),
            side(at.result_for(9, 14, "toolu_o1", false, "ok", json!({"ok": true}))),
        ],
    );
    f.session_jsonl(
        project,
        at,
        "subagents/workflows/wf-pressure/journal.jsonl",
        &[
            json!({"type": "started", "agentId": agent, "ts": "2026-08-02T14:10:00.000Z"}),
            json!({"type": "result", "agentId": agent, "result": {"file": returned}}),
        ],
    );
    f.session_file(
        project,
        at,
        &format!("subagents/workflows/wf-pressure/agent-{agent}.meta.json"),
        json!({"agentType": "workflow", "description": "pressure test summary"}).to_string(),
    );
    f.session_file(
        project,
        at,
        "workflows/wf-pressure.json",
        json!({"name": "pressure-test", "status": "done", "agents": [agent]}).to_string(),
    );
    subagent
}
