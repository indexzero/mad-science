---
written_from: "the code in crates/, after slice 10b (build 2 review: evidence and extract; slice 10a: whole-root search, raw labels, agreement across roots, speed)"
written_on: "2026-10-23"
on_conflict: "the code wins; fix this file when they differ (c1_cognetics_lists_every_record_field checks the names)"
---

# COGNETICS: what clrg reads, adds, and joins

This is the map behind every value clrg prints. Part 1 lists where each
displayed value and record field comes from. Part 2 lists every value clrg
adds itself, with its derivation and its test. Part 3 lists every join, how
it can fail, and what clrg shows when it does. Code locations are
`crates/<crate>/src/<file>:<line>`.

Terms: a *root* is a `~/.claude`-shaped folder (`-r`). A *transcript* is
`projects/<dir>/<sessionId>.jsonl`, the *main* transcript of its session;
`projects/<dir>/<sessionId>/subagents/**/*.jsonl` (except `journal.jsonl`)
are *subagent* transcripts. The *session folder* is
`projects/<dir>/<sessionId>/`. A *unit* is one searched string of a line; a
*hit* is a unit that matched. An *event* is one piece of evidence about a
file's content (Part 1e).

### Path forms and their stores (R3)

Every file under a root is searched; nothing is skipped
(`crates/clrg-core/src/discover.rs:72`, `crates/clrg-core/src/discover.rs:146`, tests
`w2_no_file_under_a_root_is_skipped`, `w3_root_level_files_are_store_other`).
A file that no other store claims is store `other`. `transcripts` and
`workflows` share the `projects/` walk, which runs once. With `other`
selected (the default), every entry directly under the root is walked
instead (`crates/clrg-core/src/discover.rs:238`).

Symlinks are not followed, like `rg -uu`. Each symlink in a selected store
is counted and reported: one stderr line `clrg: skipped N symlink(s) (not
followed)` (not with `-q`), and the same line in the no-match message (R4)
(`crates/clrg-core/src/search.rs:310`, `crates/clrg-core/src/discover.rs:224`,
`crates/clrg/src/common.rs:241`, test
`w4_skipped_symlinks_are_reported`). One exception keeps the old behaviour: a
store's own entry directly under the root (`projects`, `history.jsonl`,
`plans`, ...) that is itself a symlink is walked, because the walker follows
the paths it is given.

| Path form | Store | Read as | Line `type` | Session |
|---|---|---|---|---|
| `projects/<dir>/<sid>.jsonl` | `transcripts` | JSONL transcript | raw | the line's `sessionId`, else `<sid>` |
| `projects/<dir>/<sid>/subagents/**/*.jsonl` (not `journal.jsonl`) | `transcripts` | JSONL transcript (subagent) | raw | as above |
| `projects/<dir>/<sid>/subagents/**/*.meta.json`, `.../journal.jsonl`, any other file under `subagents/` | `transcripts` | by extension: JSON, JSONL, else text | `null` | `<sid>` |
| `projects/<dir>/<sid>/tool-results/<file>` | `transcripts` | text, part `null` (R9: the folder name is not a label) | `null` | `<sid>` |
| `projects/<dir>/<sid>/workflows/**` (workflow run records, `*.json`) | `workflows` | by extension | `null` | `<sid>` |
| any other file under `projects/<dir>/<sid>/` | `transcripts` | by extension | `null` | `<sid>` |
| `projects/<dir>/<file>` (not `.jsonl`), `projects/<file>` | `transcripts` | by extension | `null` | none |
| `history.jsonl`, `plans/`, `todos/`, `tasks/`, `file-history/<sid>/**`, `sessions/` | as named | see 1a | see 1a | Part 3 |
| any other file under the root (`settings.json`, `CLAUDE.md`, `commands/`, `skills/`, `plugins/`, `agents/`, `paste-cache/`, `shell-snapshots/`, loose files directly in `file-history/`, `history.jsonl.bak`, ...) | `other` | by extension: JSON, JSONL, else text | `null` | none |

A file that is not a transcript is never read as one: `sessions`, `facets`,
the selector join, and `files` read only transcripts
(`crates/clrg-core/src/catalog.rs:179`, `crates/clrg-core/src/search.rs:635`).
A hit in a non-transcript file (`type: null`) passes message selectors by
joining on its session, like other stores (`crates/clrg-core/src/search.rs:605`).

## 1. Extraction

### 1a. Which strings are searched, and their raw labels (R9)

Every hit is labelled with the line's own `type` and the content part's own
`type`. clrg derives no label of its own. The one normalisation: string
content is part `text`. Human output prints `type/part`, or whichever of the
two exists, or else the store name (`crates/clrg/src/render.rs:208`).

| Source | Line `type` (record `type`) | Unit and record `part` | Searched strings | Code |
|---|---|---|---|---|
| Transcript line, `type` is `user` or `assistant`, `message.content` is a string | raw `type` | `text` | the string | `crates/clrg-core/src/decode.rs:176` |
| same, content is an array: part with `type == "text"` | raw `type` | `text` | its `text` | `crates/clrg-core/src/decode.rs:193` |
| part `thinking` | raw `type` | `thinking` | its `thinking` | `crates/clrg-core/src/decode.rs:193` |
| part `tool_use` or `server_tool_use` | raw `type` | raw part `type` | `name`, then every string in `input` | `crates/clrg-core/src/decode.rs:193` |
| part `tool_result` or `*_tool_result` | raw `type` | raw part `type` | every string in `content`, except `image`/`document` items and item `type` keys | `crates/clrg-core/src/decode.rs:193` |
| part `image`, `document`, `redacted_thinking` | | | not searched (base64 or redacted) | `crates/clrg-core/src/decode.rs:193` |
| any other part type | raw `type` | raw part `type` | every string except the part's `type` and `id` | `crates/clrg-core/src/decode.rs:193` |
| a bare string in a content array | raw `type` | `text` | the string | `crates/clrg-core/src/decode.rs:193` |
| content that is neither string nor array | raw `type` | `null` | every string in it | `crates/clrg-core/src/decode.rs:176` |
| any other transcript line (`system`, `summary`, `file-history-snapshot`, ...), or a user/assistant line with no `message.content` | raw `type` (or `null`) | `null` | every string except the top-level metadata keys (`type`, `uuid`, `parentUuid`, `logicalParentUuid`, `leafUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, `isMeta`, `userType`, `requestId`, `messageId`, `toolUseID`, `slug`, `agentId`, `level`, `subtype`) | `crates/clrg-core/src/decode.rs:27` |
| `projects/<dir>/<sid>/tool-results/<file>` (a saved tool output) | `null` (the file has no line type) | `null` (the folder name is not a label, R9; test `saved_tool_results_are_searched_as_their_sessions`) | each text line | `crates/clrg-core/src/discover.rs:146` |
| other files under `projects/` (`*.meta.json`, `journal.jsonl`, unclaimed files) and `workflows` records | `null` | `null` | JSON and JSONL: every string; else each text line | `crates/clrg-core/src/search.rs:520`, `crates/clrg-core/src/search.rs:557` |
| `history.jsonl` line | `history` | `text` | every string except `project`, `sessionId`, `timestamp` (so `display` and `pastedContents[N].content`) | `crates/clrg-core/src/decode.rs:267`, `crates/clrg-core/src/search.rs:552` |
| `todos/`, `tasks/`, `sessions/`, `other` JSON documents | `null` | `null` | every string | `crates/clrg-core/src/search.rs:557` |
| `plans/*`, `file-history/<sid>/*`, non-JSON files in other stores (`other` included) | `null` | `null` | each text line | `crates/clrg-core/src/search.rs:469` |
| a JSONL line that does not parse | `null` | `null` | the raw line text (counted as a bad line) | `crates/clrg-core/src/search.rs:488` |

`--in <sel>` keeps a unit when a bare name equals its line `type` or its part
`type`, or when `type/part` equals both (`crates/clrg-core/src/search.rs:81`).
A unit with neither label passes only `--in all` (the default).

A `user/text` line is a line with `type == "user"` whose `message.content` is
a string, or which has at least one content part with `type == "text"` (or a
bare string). Its text, for agreement and `last:`, is the string, or those
parts' texts joined with a newline (`crates/clrg-core/src/decode.rs:243`). The
header pass reads the same text without building a `Value`
(`crates/clrg-core/src/rawjson.rs:150`); unit tests check the two agree.
That pass reads each transcript line's top-level `type`, `timestamp`,
`cwd`, `gitBranch`, and `uuid` from raw bytes (quotes and brackets are
matched; skipped values are never decoded), and decodes `message` only on
`type: "user"` lines (`crates/clrg-core/src/session.rs:199`,
`crates/clrg-core/src/rawjson.rs:83`). For human and record output the search
reads the header of each main transcript with a hit on the walker thread,
right after searching it (`crates/clrg-core/src/search.rs:464`).
`isMeta`, `isCompactSummary`, and tags such as `<task-notification>` do not
change the label.

### 1b. `clrg grep` record fields (`--format jsonl|json|tsv`)

Records are built in `crates/clrg/src/records.rs:87`. The order below is the
contract (g11).

| Field | Source file | JSON path | Decoding |
|---|---|---|---|
| `root` | the root folder | | as given to `-r`, `~` expanded (`crates/clrg/src/common.rs:73`) |
| `store` | the file's place in the root | | `projects/<dir>/<sid>/workflows/` is `workflows`, the rest of `projects/` is `transcripts`, `history.jsonl` is `history`, `plans/`, `todos/`, `tasks/`, `file-history/<sid>/`, `sessions/` by their folder name, everything else `other` (`crates/clrg-core/src/discover.rs:72`; path forms above) |
| `path` | the file | | the walked path |
| `session` | transcript line; history line; `sessions/` document | `sessionId` | string; else from the path (Part 3); else the block's session |
| `cwd` | transcript line; history line | `cwd`; `project` | string, empty is none; else the block's launch `cwd` (`crates/clrg/src/records.rs:96`) |
| `cwd_exists` | | | clrg's: a `stat` of `cwd` (Part 2) |
| `branch` | transcript line | `gitBranch` | string, empty is `null` (`crates/clrg-core/src/decode.rs:92`) |
| `ts` | transcript line; history line | `timestamp` | transcript: RFC 3339 string; history: unix ms number (or RFC 3339 string). Printed as RFC 3339 UTC with ms (`crates/clrg-core/src/decode.rs:133`) |
| `type` | the line | `type` | raw; `history` for `history.jsonl`; `null` elsewhere (1a) |
| `part` | the content part | `message.content[i].type` | raw; `text` for string content (1a) |
| `line` | | | 1-based line number in the file; `null` for a whole JSON document |
| `excerpt` | the matched unit | | decoded text around the match; newlines, CR, and tabs become spaces (`crates/clrg-core/src/search.rs:369`) |
| `match_start`, `match_end` | | | byte offsets of the match in `excerpt` |
| `last` | | | clrg's (Part 2) |
| `agreement` | | | clrg's (Part 2) |
| `agreement_rule` | | | clrg's (Part 2) |
| `context` | | | only with `-C`: `true` on a message shown around a hit, `false` on a hit |

Human output (`crates/clrg/src/render.rs`): the block header shows the last
`timestamp` of the session, the launch `cwd` with `~` for `HOME`
(`crates/clrg/src/render.rs:105`), the session's `gitBranch` values in order
of first appearance, the first 8 characters of the session id
(`crates/clrg/src/render.rs:137`), `(cwd missing)`, and `(root <dir>)` when
there is more than one root. Each hit line shows the local `HH:MM` of `ts`,
the label, and the excerpt fitted to the terminal. A hit with no session gets
a header with its store and path. `--format values` prints
`<session>:<launch cwd>` once per block (`crates/clrg/src/records.rs:216`).

### 1c. `clrg sessions` record fields

Built from every line of every transcript (`crates/clrg-core/src/catalog.rs`),
printed by `crates/clrg/src/sessions.rs:78`.

| Field | Source | Decoding |
|---|---|---|
| `root` | the root | as given |
| `session` | the transcript's path | `projects/<dir>/<id>.jsonl`, or `<id>/subagents/` |
| `project` | the transcript's path | the encoded `projects/<dir>` name of the main transcript |
| `cwd` | transcript lines, `cwd` | clrg's launch `cwd` (Part 2) |
| `cwd_exists` | | clrg's: a `stat` (Part 2) |
| `branches` | `gitBranch` | every non-empty value, in order of first appearance |
| `first_ts`, `last_ts` | `timestamp` | earliest and latest line time |
| `messages` | `type` | `user` and `assistant` lines of the main transcript |
| `tools` | `message.content[i].name` where part `type == "tool_use"` | sorted, main and subagent transcripts |
| `files_touched` | `tool_use` `input.file_path`, `input.path`, `input.notebook_path` | distinct count (`crates/clrg-core/src/decode.rs:54`) |
| `models` | `message.model` | sorted |
| `cli_versions` | `version` | sorted |
| `has_file_history` | `file-history/<session>/` | is a folder in the same root (`crates/clrg-core/src/catalog.rs:473`) |
| `subagents` | `projects/<dir>/<session>/subagents/*.jsonl` | count |
| `confidence` | | always `null`: only `--infer-branch` (not built) would set it |
| `last` | | clrg's: the `last:` text (Part 2) |

`clrg facets` records: `value` (the field's raw value, `(none)` in human
output), `sessions`, `messages`, `first_ts`, `last_ts`, counted over the
selected messages (`crates/clrg-core/src/catalog.rs`).

### 1d. `history.jsonl`, as agreement reads it

`crates/clrg-core/src/agree.rs:224`: `display` (string, empty when missing),
`timestamp` (unix ms number, or RFC 3339 string), `sessionId` (string),
`pastedContents` (object: key `"N"` parsed as a number, value `content` when
it is a string; a value with only `contentHash` is an unexpandable paste).
`project` is the record `cwd`. `paste-cache/` is not read.

### 1e. Evidence: events on a file (`crates/clrg-core/src/evidence.rs`)

`clrg files` and `clrg extract` read every transcript in every root, every
line parsed (`crates/clrg-core/src/evidence.rs:723`, `crates/clrg-core/src/evidence.rs:1030`). Selectors then choose paths, not events
(Part 2, "path selection"). Each event is on one path, as recorded, then
resolved, and a path's events from every root form one timeline (Part 2,
"one timeline per path"). Event kinds:

| Event | Source | JSON path | Content after the event | Code |
|---|---|---|---|---|
| `backup` | a line with `type == "file-history-snapshot"` | `snapshot.trackedFileBackups.<path>`: `backupFileName`, `backupTime` (RFC 3339 or unix ms; the event time), `version` | the bytes of `file-history/<sid>/<backupFileName>`, read raw at replay; `backupFileName: null` means the file was absent. The same entry repeated in later snapshots, or in another root's copy, counts once (Part 2, "one timeline per path") | `crates/clrg-core/src/evidence.rs:1212`, `crates/clrg-core/src/evidence.rs:814` |
| `write` | an assistant `tool_use` part, `name` `Write` or `NotebookEdit`, whose `tool_result` is not an error | `input.file_path` (or `input.notebook_path`) | `toolUseResult.content`, else `input.content`; neither (a `NotebookEdit`) is `diff-only` | `crates/clrg-core/src/evidence.rs:1144`, `crates/clrg-core/src/evidence.rs:1257` |
| `edit` | a `tool_use` named `Edit` or `MultiEdit` whose result is not an error | `input.file_path` | `oldString` → `newString` (`replaceAll`) from `toolUseResult`, else `input.old_string`/`new_string`/`replace_all`; `MultiEdit`: each of `input.edits[]` in order; applied to `toolUseResult.originalFile` (a string), else to the previous known content, as Claude Code applies it: matching normalises CRLF to LF (a CRLF file keeps CRLF endings), and an empty `newString` whose `oldString` is followed by a newline also removes that newline (the whole line) | `crates/clrg-core/src/evidence.rs:978`, `crates/clrg-core/src/evidence.rs:348` |
| `rejected` | a `tool_use` named `Write`, `Edit`, `MultiEdit`, or `NotebookEdit` (`WRITE_TOOLS`, only these) whose `tool_result` has `is_error: true` | as above | none on disk; the intended content (`input.content`, or the edit applied to the known content) is kept, labelled `rejected` | `crates/clrg-core/src/evidence.rs:1257`, `crates/clrg-core/src/evidence.rs:68` |
| `returned` | in a subagent transcript, after a rejected write: the agent's last `StructuredOutput` `tool_use` input, or its last assistant `text` part | every string in `input`, nested fields included; `message.content[i].text` | the string with the highest `similarity`, when the `returned` rule (Part 2) holds | `crates/clrg-core/src/evidence.rs:1296` |
| `read` | a `tool_use` named `Read`, whatever its result: a failed `Read` (`is_error: true`) stays a `read` and is never a write event | `input.file_path` | no content (`clrg files --op read` only) | `crates/clrg-core/src/evidence.rs:1144`, `crates/clrg-core/src/evidence.rs:1257` |

Other tool calls (`Bash`, `Glob`, `Grep`, ...) are not events, failed or not
(test `fl5_failed_read_is_not_a_write`). A `tool_use` with no `tool_result`
keeps its kind (`write`/`edit`) but is unanswered: its `outcome` is
`unknown`, and later edits do not chain from it (Part 2, "state (replay)").

`clrg files` record fields (`--format jsonl|json|tsv`; built in
`crates/clrg/src/files.rs:77`):

| Field | Source |
|---|---|
| `path` | the resolved path (Part 2); with `--relative`, relative to `cwd` when inside it |
| `cwd` | the launch `cwd` of the first event's session |
| `ops` | the distinct event kinds on the path, in the order `write`, `edit`, `backup`, `rejected`, `returned`, `read` |
| `first_ts`, `last_ts` | the earliest and latest event time |
| `sessions` | the events' sessions, in order of first event |
| `branches` | the `gitBranch` of the tool-use lines, in order of first appearance (snapshot lines have none) |
| `versions` | clrg's (Part 2) |
| `outcome` | clrg's (Part 2) |
| `recoverable` | clrg's (Part 2) |
| `root` | the first of `roots` (kept for compatibility with records from before the merge) |
| `roots` | every root the path's events (or copies of them) came from, in the order given to `-r` (Part 2, "one timeline per path") |

Human output: a header row, then one row per path: `LAST` (local time of
`last_ts`), `OUTCOME`, `RECOVERABLE`, `VERSIONS`, `OPS`, `SESSIONS` (short
ids), and `PATH` (`~` for `HOME`). `--format values` prints the paths.

### 1f. `clrg extract`: which state, where it goes, and its manifest

`clrg extract` writes recovered content into `-o <dir>`
(`crates/clrg/src/extract.rs:96`). It reads the same evidence as `clrg files`
(1e) and replays each path (Part 2, "state (replay)").

**Which paths.** The paths `clrg files` lists by default: those with a
`write`, `edit`, `rejected`, or `returned` event, among the paths the
selection chooses (`crates/clrg/src/extract.rs:111`). A path with only `backup` or `read` events
is not extracted. `--path <glob>` matches the resolved absolute path;
`--created-only` keeps paths that `clrg files --created-only` keeps (Part 2).
The `select` flagset applies as in `files`.

**Which events (`--source`).** `best` (default) replays every event;
`file-history` only `backup` events; `transcript` only `write`, `edit`,
`rejected`, and `returned` events (`crates/clrg-core/src/evidence.rs:303`).
A `verified` value needs a `backup` in the replay, so it appears only with
`best`.

**Which state (`--version`)** (`crates/clrg-core/src/extract.rs:103`, tests
`x8_version_all_and_first`, `x2_extract_last_replays_writes_and_edits`,
`x11_last_skips_newer_rejected_draft`):

| `--version` | Written | Not recoverable (exit 4) |
|---|---|---|
| `last` (default) | the last state that was on disk (`write`, `edit`, `backup`) or `returned`. A newer `rejected` draft is not chosen: the summary says `<n> newer rejected draft(s) not extracted; use --version all` and lists the path. With only rejected drafts, the last of them, labelled `rejected` | that state has no content (`diff-only`, or `none` for an absent file), or the path has no state (`none`) |
| `first` | the earliest state with full content | no state has content: `diff-only` when some state is, else `none` |
| `all` | the first state of each distinct content, as `<name>.v<N>` | every `diff-only` state (content that existed and is lost); no content at all as in `first`. An absent-file state is not a version and is not listed |

`<N>` (the manifest `version`) is the 1-based index of the state's content
among the path's distinct contents, in order of first appearance, with every
`--version` (`crates/clrg-core/src/extract.rs:74`). Rejected and returned
states are written like any other, and keep their labels.

**Where it goes (`--layout`)** (`crates/clrg-core/src/extract.rs:201`, unit
test `layouts_and_refusals`, test
`x9_outside_cwd_goes_to_abs_and_never_refuses_the_run`). The `cwd` and
session are those of the chosen state's own event:

| `--layout` | Output path under `<dir>` |
|---|---|
| `cwd` (default) | the session's launch `cwd` with every `/` replaced by `_` (`/work/app` → `_work_app`), then the path relative to that `cwd`. An absolute path outside its `cwd`, or whose session has no `cwd`, goes to `_abs/<absolute path minus leading />` (`ABS`) |
| `absolute` | the resolved absolute path without its leading `/` |
| `session` | the session id, then the path relative to the `cwd` (a relative path whose session has no `cwd` is taken as already relative to it); an absolute path outside its `cwd` goes to `<session>/_abs/...` |

With `--version all`, `.v<N>` is appended to the file name
(`crates/clrg-core/src/extract.rs:290`). Then every final path is decided, before the first write
(`crates/clrg-core/src/extract.rs:311`, `crates/clrg/src/extract.rs:131`): output paths are compared case-insensitively, and a
file that collides with an earlier file, with a folder of any file, or with
`MANIFEST.jsonl` gets `~2`, `~3`, ... appended to its file name (the first
free one), in path order (test
`x10_case_collisions_are_suffixed_before_writing`, unit test
`plan_paths_suffix_case_collisions`). The manifest's `out_path` is the final
path.

**Safety.** Every check runs before the first write. Only a refused `-o`
refuses the run (exit 2, nothing written). A path with no safe output path is
skipped and listed, the other paths are still written, and the exit code is 4
(`crates/clrg/src/extract.rs:191`):

| Check | Refused or skipped when | Code | Test |
|---|---|---|---|
| `-o` | it exists and is not a folder, or is a folder with any entry (a symlink counts); its new part (the components that do not exist) has a `..`; its canonical path (the canonical nearest existing ancestor plus the new part) is inside the canonical path of any root, or it is lexically inside a root as given. Checked before any evidence is read, so a dry run is refused too. Refuses the run | `crates/clrg-core/src/extract.rs:353` | `x1_extract_refuses_nonempty_or_in_root_out_dir`, `out_dir_checks` |
| output path | any component of the computed path is not a plain name: `..` (a recorded relative path with `..`), a root, a prefix, `.`; a relative path under `--layout absolute`, or under `--layout cwd` with no `cwd`; the `cwd` itself; a `session` layout with no session id. The path is skipped and listed (`unsafe, skipped`), never the run | `crates/clrg-core/src/extract.rs:201` | `x7_extract_never_writes_outside_out`, `x9_outside_cwd_goes_to_abs_and_never_refuses_the_run`, `layouts_and_refusals` |
| plan | two output paths equal case-insensitively, a file that is another file's folder, or a file named like the manifest: suffixed `~<n>`, never refused | `crates/clrg-core/src/extract.rs:311` | `x10_case_collisions_are_suffixed_before_writing`, `plan_paths_suffix_case_collisions` |
| write | each folder is created one component at a time and must be a real folder, never a symlink; each file is created with `create_new`, which fails on any existing entry, a symlink included, and so never follows or replaces one | `crates/clrg-core/src/extract.rs:419` | `write_new_never_follows_a_symlink`, `x7_extract_never_writes_outside_out` |

`<dir>` is created (with its new parents) only after every check passes, and
only when there is a file to write (`crates/clrg-core/src/extract.rs:405`).
`--dry-run` runs every check, prints the plan, and creates nothing.

**Manifest.** `MANIFEST.jsonl` (`--manifest`, the default; `--no-manifest`
omits it) has one line per written file, in the order below
(`crates/clrg/src/extract.rs:142`). `--format jsonl` prints the same records
on stdout (`crates/clrg/src/extract.rs:154`); with `--dry-run`, the records
of the plan. Test `x5_manifest_records_provenance`.

| Field | Source |
|---|---|
| `path` | the resolved path (Part 2) |
| `out_path` | the file written: the canonical `<dir>` joined with the final output path (after any `~<n>` suffix) |
| `session` | the chosen state's event's session |
| `agent_id` | that event's subagent, from `agent-<id>.jsonl`; `null` in a main transcript |
| `root` | the first of `roots` (kept for compatibility) |
| `roots` | every root the path's events came from, in the order given (as in `clrg files`) |
| `version` | `<N>`, above |
| `ts` | the event's time (`backupTime` for a backup; the candidate's line for `returned`), RFC 3339 UTC |
| `source_event` | the event kind that produced the state: `write`, `edit`, `backup`, `rejected`, or `returned` |
| `outcome` | clrg's, per state (Part 2, "extract `outcome`") |
| `verified` | the state's `verified` (Part 2): `agree`, `disagree`, or `null` |
| `similarity` | a `returned` event's share (Part 2); else `null` |
| `journal` | a `returned` event's journal check (Part 2); else `null` |
| `sha256` | the SHA-256 of the written bytes, lowercase hex (the `sha2` crate, `crates/clrg/src/extract.rs:254`) |
| `bytes` | the number of bytes written |

**Human output** (`crates/clrg/src/extract.rs:268`). One line per file:
`wrote <output path>  <- <path>  (v<N> from <source_event>, outcome <outcome>[, verified ...][, journal ...][, similarity ...])`
(`would write` with `--dry-run`), then the counts: files and `<dir>`; the
written files by `outcome` (`written`, `rejected`, `returned`, and `unknown`
when any); `verified` `agree` and `disagree`; then, for `--version last`,
`<n> newer rejected draft(s) not extracted; use --version all:` with one
path per line; then `not recoverable (<n>):` with one `<recoverable>  <path>`
line per path and value; then `unsafe, skipped (<n>):` with one reason per
line. With `--format jsonl` these go to stderr as
`clrg extract: not recoverable: <recoverable> <path>`,
`clrg extract: unsafe path skipped: <reason>`, and
`clrg extract: <n> newer rejected draft(s) not extracted; use --version all: <path>`.

**Exit codes.** 2: a refused `-o` or a bad selector. 3: `--strict` with
unparsable lines or an unreadable root, checked before any write. 1: no path
matched, with an R4 message on stderr (files searched, stores, roots,
filters). 4: some requested state is `diff-only` or `none`, or a path was
skipped as unsafe; everything else is still written
(`x4_unrecoverable_exits_4_and_lists_it`,
`x9_outside_cwd_goes_to_abs_and_never_refuses_the_run`). A newer rejected
draft not chosen by `--version last` does not change the exit code. 0:
otherwise.

## 2. Added values

| Value | Derivation | Code | Test |
|---|---|---|---|
| launch `cwd` | the first non-empty `cwd` in the main transcript whose encoding (`/` and `.` become `-`) equals the `projects/<dir>` name; else the first non-empty `cwd` | `crates/clrg-core/src/session.rs:65` | `g12_header_cwd_is_launch_folder` |
| `cwd_exists` | `std::fs::metadata(cwd).is_ok()`: one `stat`, nothing else | `crates/clrg-core/src/session.rs:118` | `s2_missing_cwd_is_flagged` |
| `(cwd missing)` | shown when `cwd_exists` is false | `crates/clrg/src/render.rs:316` | `s2_missing_cwd_is_flagged`, `g7_hit_shows_cwd_branch_session_and_last_prompt` |
| `type/part` label | 1a; `(not in history)` appended on a `user/text` hit whose `agreement` is `transcript-only` | `crates/clrg/src/render.rs:208` | `l1_labels_are_raw_type_and_part`, `a2_inserted_text_is_transcript_only` |
| `agreement` | R10, below. `null` unless the record is `user/text` or `history` | `crates/clrg-core/src/agree.rs:804` | `a1_agreement_rules_in_order` to `a4_history_without_session_id_is_unlinked` |
| `agreement_rule` | the rule that made the pair agree; `null` unless `agreement` is `both` | `crates/clrg-core/src/agree.rs:472` | `a1_agreement_rules_in_order` |
| `last` | `true` on the record of the session's last `user/text` line, `false` on its other `user/text` records and on subagent `user/text` records, `null` elsewhere. With the session's main transcript in several roots, "last" is the last line of their union in time order (R10 below), so a backup's copy of an earlier line is `false` in every root. It is about the line, not its agreement | `crates/clrg-core/src/agree.rs:665` | `l2_last_marks_the_sessions_last_user_text`, `a7_agreement_unions_roots` |
| `last:` line | the session's last `user/text` whose `agreement` is `both`, over the union of its main transcripts in every searched root; every root's block shows the same line | `crates/clrg-core/src/agree.rs:763`, `crates/clrg/src/render.rs:336` | `a5_last_line_prefers_agreed_text`, `g7_hit_shows_cwd_branch_session_and_last_prompt` |
| `(not in history)` under `last:` | when the last `user/text` comes after the agreed one (it is then `transcript-only`), it is shown on its own line. When the session has history but no line agreed, `last:` is the last `user/text`, marked `(not in history)` | `crates/clrg-core/src/agree.rs:763` | `a5_last_line_prefers_agreed_text` |
| `(unverified)` | the session has no history line in any searched root: `last:` is the last `user/text`, unchecked | `crates/clrg-core/src/agree.rs:763` | `a5_last_line_prefers_agreed_text`, `g7_hit_shows_cwd_branch_session_and_last_prompt` |
| sessions `last` column | the same text and markers; a later `transcript-only` text shares the room. The JSON `last` field carries the text only | `crates/clrg/src/sessions.rs:279` | `a5_last_line_prefers_agreed_text`, `s1_sessions_newest_first_with_cwd` |
| disagreement count line | stderr, after the results: the number of printed `transcript-only` and `history-only` records (`sessions`: summed over the listed sessions). Not printed with `-q`, with no results, or with `-l` | `crates/clrg/src/common.rs:358`, `crates/clrg/src/grep.rs:254` | `a6_disagreement_counts_reported` |
| domain order (R5) | blocks whose launch `cwd` is the current folder or inside it, then those that contain it (not `/` or `HOME`), then each root's other transcript blocks, then its other stores; newest first within a domain | `crates/clrg-core/src/order.rs:58`, `crates/clrg-core/src/order.rs:188` | `g8_current_folder_sessions_rank_first` |
| session attribution of non-transcript files | from the path or the document (Part 3) | `crates/clrg-core/src/discover.rs:72` | `g9_all_stores_searched_by_default`, `other_stores_join_selectors_by_session` |
| skipped symlinks | the number of symlinks met in the selected stores (not followed); stderr line and R4 line | `crates/clrg-core/src/search.rs:310`, `crates/clrg/src/common.rs:253` | `w4_skipped_symlinks_are_reported` |
| excerpt centering | 80 bytes of decoded text kept on each side of the match, then fitted to the terminal with the match in the middle and `…` where text was cut | `crates/clrg-core/src/search.rs:369`, `crates/clrg/src/render.rs:163` | `human_excerpt_centers_the_match_on_one_line` |
| short session id | the first 8 characters | `crates/clrg/src/render.rs:137` | `g7_hit_shows_cwd_branch_session_and_last_prompt` |

| resolved path | an absolute recorded path, `.` and `..` removed lexically; a relative one (15,271 snapshot paths in the owner's profile) joined to the session's launch `cwd` first (R2), the same launch `cwd` for the main transcript and its subagents. With no launch `cwd` the path stays as recorded. Nothing is read from disk. The launch `cwd` is per session across roots | `crates/clrg-core/src/evidence.rs:940`, `crates/clrg-core/src/evidence.rs:852` | `fl3_relative_snapshot_paths_resolve_against_launch_cwd`, `relative_paths_resolve_lexically` |
| one timeline per path | a path's events from every root and session are merged into one timeline. Copies count once: a `tool_use` by (session, `tool_use_id`); a snapshot entry by (session, recorded path, backup file name, version), which also folds the same entry repeated in later snapshots; a `returned` string by (session, agent, recorded path, text). Of two copies the first root's is kept, unless the later one has a `tool_result` and the kept one does not, or its backup file is readable and the kept one's is not. `roots` lists every root a copy came from; `root` is the first | `crates/clrg-core/src/evidence.rs:852`, `crates/clrg-core/src/evidence.rs:814`, `crates/clrg-core/src/evidence.rs:841` | `fl6_backup_roots_merge_into_one_timeline` |
| event order | a path's events by time (`backupTime` for a backup); a backup first on a tie; then root, transcript, and line | `crates/clrg-core/src/evidence.rs:852` | `replay_is_verified_against_the_next_backup` |
| path selection | selectors choose paths, not events: a path is chosen when one of its events is selected, and then every event on it (every session, root, branch, and time) is replayed, so a `--branch` or `--since` never breaks a chain. An event is selected when its session passes `--session`, it is not a subagent's under `--no-subagents`, and: with no message selector, always; `--scope message`: a tool event when its own message passes, a `backup` when its session has a passing message, a `returned` when its rejected write passed; `--scope session`: when its session has a passing message | `crates/clrg-core/src/evidence.rs:723`, `crates/clrg-core/src/evidence.rs:852` | `fl7_selectors_choose_paths_not_events`, `fl1_files_lists_paths_with_ops_and_outcome` |
| state (replay) | replaying a path's events in order gives the content after each: a readable backup's bytes (an absent backup: no content, `none`), and it resets the chain; a write's content; an edit applied to `originalFile`, else to the previous known content (CRLF matched as LF and kept on output; an empty `newString` removes the whole line). An edit with no base, or whose `old_string` is not found, is `diff-only`, and the chain stays broken until the next full-content event. A write or edit with no `tool_result` gives its state (`outcome` `unknown`) but breaks the chain: later edits do not chain from it. `rejected` and `returned` states carry their content and leave the chain (what is on disk) as it was. An unreadable backup file gives no state | `crates/clrg-core/src/evidence.rs:482`, `crates/clrg-core/src/evidence.rs:348` | `replay_applies_writes_and_edits_in_order`, `edit_without_base_is_diff_only_until_full_content`, `rejected_and_returned_do_not_change_disk`, `edits_replace_exactly`, `x14_edit_replay_crlf_and_line_deletion` |
| `verified` | on a `write`/`edit` state with content: `agree` when the very next event of the path (reads aside) is a readable `backup` with the same bytes, `disagree` when its bytes differ or it records the file absent. Any other event in between, or a write/edit with no result: no `verified`. Disagreement is kept, never hidden | `crates/clrg-core/src/evidence.rs:482` | `replay_is_verified_against_the_next_backup` |
| `returned` rule | in a subagent transcript, the candidates are every string of the agent's last `StructuredOutput` `input` (nested fields included) and its last assistant `text`. For each path, the last rejected full-content write before a candidate is compared with each later candidate; its candidate is the one with the highest `similarity` (the first on a tie), not the longest. It is `returned` only when the rejected content has at least 3 non-blank lines (`RETURNED_MIN_LINES`), the share is at least 80% (`RETURNED_SHARE`), and the candidate's length in chars is between 0.5× and 2× the rejected content's (`RETURNED_MIN_LEN`, `RETURNED_MAX_LEN`). Each candidate string is returned for at most one path: the one it matches with the highest similarity (the earliest rejected write on a tie); a path whose best candidate went elsewhere gets none. The `returned` event holds the candidate, at the candidate's time | `crates/clrg-core/src/evidence.rs:1296`, `crates/clrg-core/src/evidence.rs:449`, `crates/clrg-core/src/evidence.rs:428` | `returned_rule_and_journal`, `returned_rule_qualification`, `x12_returned_rule_rejects_unrelated_or_short_candidates`, `x13_returned_picks_highest_similarity_field`, `fl2_rejected_write_is_marked_rejected` |
| `similarity` | on a `returned` event: the share of the rejected content's non-blank lines, trimmed, that are lines of the candidate, trimmed; 0 to 1 | `crates/clrg-core/src/evidence.rs:428` | `similarity_counts_non_blank_lines` |
| `journal` | on a `returned` event, R10 applied to recovery: `journal.jsonl` beside the agent's transcript (`subagents/workflows/<wf>/`). `agree` when a line with the same `agentId` (from the file name `agent-<id>.jsonl`) has a `result` holding a string that contains the candidate; `disagree` when such results exist and none does; `none` when there is no journal or no result for the agent | `crates/clrg-core/src/evidence.rs:1387` | `returned_rule_and_journal` |
| `versions` | the number of distinct contents among a path's states (`--source best`), rejected and returned ones included | `crates/clrg-core/src/evidence.rs:660` | `fl2_rejected_write_is_marked_rejected`, `fl3_relative_snapshot_paths_resolve_against_launch_cwd` |
| `recoverable` | of the last state: `full` (content known), `diff-only` (an edit off a broken chain), `none` (no state, or the file was absent) | `crates/clrg-core/src/evidence.rs:672` | `fl1_files_lists_paths_with_ops_and_outcome` |
| `outcome` | from the last `write`, `edit`, `rejected`, or `returned` event: `written` (a write or edit with a non-error result), `rejected`, `returned`, else `unknown` (no such event, or the last one has no result). A failed `Read` is not such an event | `crates/clrg-core/src/evidence.rs:575` | `fl1_files_lists_paths_with_ops_and_outcome`, `fl2_rejected_write_is_marked_rejected`, `fl5_failed_read_is_not_a_write` |
| `--created-only` | the first event that is not a `read` or an absent-file backup is a write or a rejected write (so no earlier backup held content) | `crates/clrg-core/src/evidence.rs:593` | `fl4_created_only` |
| `--op` | `write` counts writes, rejected writes, and returned text; `edit` counts edits and rejected edits; `read` counts reads. A path is listed when it has a counted event; its row shows every event | `crates/clrg/src/files.rs:61` | `fl1_files_lists_paths_with_ops_and_outcome` |
| extract `outcome` | per written state, from its own event: a `write` or `edit` with a result is `written`, without one `unknown`; a `backup` is `written` (its bytes were on disk); `rejected` and `returned` are themselves. So a rejected draft is never passed off as `written`, and a returned version says `returned` | `crates/clrg-core/src/extract.rs:168` | `x3_extract_returned_content_for_rejected_subagent_write`, `x4_unrecoverable_exits_4_and_lists_it` |
| extract state choice, `version` | 1f: `--version` and `--source`; `last` never chooses a newer `rejected` draft | `crates/clrg-core/src/extract.rs:103`, `crates/clrg-core/src/extract.rs:74` | `x8_version_all_and_first`, `x11_last_skips_newer_rejected_draft`, `choose_per_version` |
| extract output path | 1f: `--layout` (`_abs/` outside the `cwd`), the case-insensitive collision suffixes, then the safety checks | `crates/clrg-core/src/extract.rs:201`, `crates/clrg-core/src/extract.rs:311` | `x7_extract_never_writes_outside_out`, `x9_outside_cwd_goes_to_abs_and_never_refuses_the_run`, `x10_case_collisions_are_suffixed_before_writing`, `layouts_and_refusals` |

### R10: agreement between `history.jsonl` and transcripts

A history line and a main-transcript `user/text` line agree when they have
the same `sessionId` and one rule matches. The rules run as passes in this
order; in each pass, every unpaired history line (oldest first) takes the
unpaired `user/text` line nearest to it in time that the rule matches (ties:
the earlier line). Each line takes part in at most one pair, and a pair is
always recorded with the first rule that matches it
(`crates/clrg-core/src/agree.rs:472`).

**Across roots.** A session's history lines (from every root's
`history.jsonl`, deduplicated) are paired once, against the union of the
session's main-transcript `user/text` lines in every searched root. A line
in several roots (a backup holds copies) is one line: the key is the line's
`uuid`, or, for a line with no `uuid`, its timestamp and text. With more
than one root the union is in time order. So a history line has one
`agreement`, whichever root shows it, and every root's copy of a `user/text`
line has the same agreement (`crates/clrg-core/src/agree.rs:665`, `crates/clrg-core/src/agree.rs:804`,
`crates/clrg-core/src/catalog.rs:403`; test `a7_agreement_unions_roots`).

| `agreement_rule` | Matches when | Code |
|---|---|---|
| `exact` | `display` equals the text | `crates/clrg-core/src/agree.rs:441` |
| `whitespace` | equal after collapsing whitespace runs to one space and trimming | `crates/clrg-core/src/agree.rs:252` |
| `paste-expanded` | `display` has at least one `[Pasted text #N]` / `[Pasted text #N +M lines]` placeholder, every placeholder has `pastedContents[N].content`, and the expanded display equals the text (whitespace collapsed) | `crates/clrg-core/src/agree.rs:341` |
| `placeholder-wildcard` | `display` has a placeholder that cannot be expanded (`contentHash` only, or `[Image #N]`, `[Image]`, `[Image is no longer available]`); each such placeholder matches any text in its position. Expandable pastes are expanded first. The literal pieces (whitespace collapsed, trimmed) must appear in order, the first at the start and the last at the end. Only within 120 s (`WILDCARD_WINDOW_MS`): the two timestamps differ by at most 120,000 ms, and a line with no timestamp never pairs by this rule (test `a8_placeholder_rule_has_a_time_window`) | `crates/clrg-core/src/agree.rs:437`, `crates/clrg-core/src/agree.rs:376` |
| `slash-command` | `display` starts with `/` and equals `<command-name>` (with a leading `/`) plus a space and `<command-args>` when the args are not empty, whitespace collapsed | `crates/clrg-core/src/agree.rs:409` |

| `agreement` | Record | When |
|---|---|---|
| `both` | `user/text`, `history` | the line is in an agreeing pair |
| `transcript-only` | `user/text` | no agreeing history line, and the session has history in a searched root. A subagent `user/text` line takes part in no pair, so it is `transcript-only` when the session has history |
| `history-only` | `history` | no agreeing `user/text` line, and the session's main transcript was found in a searched root |
| `unlinked` | `history` | the line has no `sessionId` |
| `unknown` | `user/text`, `history` | the other source for the session is not in any searched root |

There is no skip list. Inserted text (`isMeta` notes, `<task-notification>`,
`[Request interrupted…`, `<local-command-stdout>`, `<local-command-caveat>`,
`isCompactSummary` summaries, classifier notices) has no history line, so it
is `transcript-only`.

`--agree <value>` (repeatable) keeps `user/text` and `history` hits with a
listed value. Hits with no agreement value are kept
(`crates/clrg/src/grep.rs:179`).

## 3. Cross-references

| Join | Key | Code | How it fails | What clrg shows |
|---|---|---|---|---|
| transcript line ↔ session | the line's `sessionId`; else the file name `<id>.jsonl`; for `subagents/`, the folder above it | `crates/clrg-core/src/discover.rs:146`, `crates/clrg-core/src/search.rs:525` | a file named unlike its `sessionId` | the line's own `sessionId` wins; the block is that session's |
| transcript ↔ `subagents/` | `projects/<dir>/<sid>/subagents/*.jsonl`: the folder name | `crates/clrg-core/src/discover.rs:146` | a subagent folder with no main transcript | hits still go to session `<sid>`; the header has no transcript fields; `sessions` lists it from the subagents alone |
| transcript ↔ `tool-results/` | `projects/<dir>/<sid>/tool-results/<file>`: the folder name | `crates/clrg-core/src/discover.rs:146` | the main transcript is missing | hits keep session `<sid>`; type `null`, part `null` |
| block ↔ main transcript (header) | session id, in the block's root: a hit's own main transcript, else `projects/*/<sid>.jsonl` | `crates/clrg-core/src/order.rs:173`, `crates/clrg-core/src/session.rs:107` | no main transcript in that root | header uses the hits' own `cwd`, time, and branches; no `last:` line |
| transcript `cwd` ↔ `projects/<dir>` name | `cwd` with `/` and `.` replaced by `-` equals `<dir>` | `crates/clrg-core/src/session.rs:55` | the encoding is lossy (`-` in names); no `cwd` encodes the name | the first non-empty `cwd`; `(no cwd)` when there is none |
| launch `cwd` ↔ the file system | `stat(cwd)` | `crates/clrg-core/src/session.rs:118` | the folder is gone or unreadable | `(cwd missing)`, `cwd_exists: false` |
| transcript ↔ `history.jsonl` (R10) | `sessionId`, then the rules above; history from every root's `history.jsonl`, read once per run with a raw-byte pre-filter on the wanted session ids, the same line in several roots counted once (key: session, `timestamp`, `display`) | `crates/clrg-core/src/agree.rs:150`, `crates/clrg-core/src/order.rs:118` | no history for the session; no `sessionId` on old lines; text that differs past every rule | `unknown` / `(unverified)`; `unlinked`; `transcript-only` / `history-only` and `(not in history)` |
| history line ↔ transcript, across roots | `sessionId`: the session's main transcript `projects/*/<sid>.jsonl` in every searched root, their `user/text` lines united | `crates/clrg-core/src/agree.rs:804` | the transcript is in no searched root | `unknown` |
| `user/text` line ↔ its copies in other roots | the line's `uuid`; with no `uuid`, its `timestamp` and text | `crates/clrg-core/src/agree.rs:649` | two copies differ in `uuid`; a line with no `uuid` whose text or time changed | counted as two lines: one can pair, the other is `transcript-only` |
| file ↔ `other` | no session: the file is claimed by no other store | `crates/clrg-core/src/discover.rs:129` | always (nothing to join) | a block per file, under `other` |
| session id ↔ `file-history/` | `file-history/<sid>/<hash>@vN`: the folder name | `crates/clrg-core/src/discover.rs:119` | an orphan folder (no transcript) | hits under session `<sid>` with no header fields; message selectors drop them |
| session id ↔ `todos/` | `todos/<sid>-agent-<id>.json`: the name before `-agent-`, else the stem | `crates/clrg-core/src/discover.rs:107` | a name in another shape | the stem is taken as the session id |
| session id ↔ `tasks/` | `tasks/<sid>/...`, or `tasks/<sid>.json` | `crates/clrg-core/src/discover.rs:115` | as above | as above |
| session id ↔ `sessions/` | the document's top-level `sessionId` | `crates/clrg-core/src/search.rs:580` | no `sessionId`, or not JSON | a block per file, under the store |
| non-transcript hit ↔ message selectors | the hit's session has a transcript message that passes (`-b`, `-d`, `--since`, ...) | `crates/clrg-core/src/search.rs:601`, `crates/clrg-core/src/search.rs:635` | no session, or no passing message | the hit is dropped |
| plan ↔ session | the transcript's `slug` would name `plans/<slug>.md` | not joined | always | plan hits have no session: a block per file, under `plans` |
| session folder files ↔ session | `projects/<dir>/<sid>/<anything>`: the folder name (`workflows/`, `subagents/**`, `tool-results/`, others) | `crates/clrg-core/src/discover.rs:146` | the file is directly under `projects/<dir>/` or `projects/` | no session: a block per file, under its store |
| `tool_use` ↔ `tool_result` | the result part's `tool_use_id` equals the `tool_use` part's `id`, in a later `type: "user"` line of the same transcript; that line's `toolUseResult` belongs to the result when the line has exactly one `tool_result` part | `crates/clrg-core/src/evidence.rs:1077`, `crates/clrg-core/src/evidence.rs:1257` | no result (the session ended); several results on one line | the event stays unanswered (`outcome: unknown`, and later edits do not chain from it); `toolUseResult` is not used, so a write takes `input.content` and an edit has no `originalFile`. Another root's copy with the result is preferred |
| snapshot entry ↔ backup file | `file-history/<sid>/<backupFileName>` in the transcript's own root, where `<sid>` is the transcript's session | `crates/clrg-core/src/evidence.rs:1212`, `crates/clrg-core/src/evidence.rs:841` | the file is missing or unreadable | another root's copy of the entry with a readable file is used; else the `backup` event is listed in `ops` but gives no state |
| path ↔ its events in other roots | the resolved path; copies by (session, `tool_use_id`) or (session, path, backup file name, version) | `crates/clrg-core/src/evidence.rs:852`, `crates/clrg-core/src/evidence.rs:814` | a copy whose session id or `tool_use_id` differs | counted as two events on one timeline |
| relative snapshot path ↔ launch `cwd` | the session's launch `cwd` (Part 2) | `crates/clrg-core/src/evidence.rs:940` | no `cwd` in the session | the path stays relative, as recorded |
| subagent ↔ `agentId` | the file name `agent-<id>.jsonl` | `crates/clrg-core/src/evidence.rs:963` | another name | no agent id; `journal: none` |
| `returned` ↔ workflow journal | `journal.jsonl` in the subagent transcript's folder; lines with `agentId` and `result` | `crates/clrg-core/src/evidence.rs:1387` | no journal, no result for the agent, or a result without the string | `journal: none` or `journal: disagree` (shown, never hidden) |
| `-o` ↔ roots | canonical paths: `-o` (its nearest existing ancestor, canonicalized, plus the new part) against each root (canonicalized; as given when it does not exist) | `crates/clrg-core/src/extract.rs:353` | a symlink that leads into a root; a relative `-o` resolved in a root | refused, exit 2, nothing written |
| extract output path ↔ session `cwd` | the chosen state's session's launch `cwd` | `crates/clrg-core/src/extract.rs:201` | no `cwd`; the path is outside the `cwd` | an absolute path goes to `_abs/...`; a relative one with no `cwd` (or with `..`) is skipped and listed, exit 4, the rest written |

## Known gaps

- Plan slug → session is not joined. Plan hits stand alone.
- `paste-cache/` is not read. A paste stored only as a `contentHash` can only
  agree through `placeholder-wildcard`.
- A `display` made only of placeholders (`[Pasted text #1 +40 lines]`,
  `[Image #1]`) matches any text. In pass 4 it takes the nearest `user/text`
  left unpaired within 120 s, which could be inserted text.
- Regex mode (`-E`) has no raw-byte pre-filter, so every JSON line is parsed.
- The owner's profile (2026-10-23, counts only) had 57 `transcript-only`
  lines with no flag and no tag. They stay `transcript-only`. No rule is added
  for them until the owner decides.
- Subagent `user/text` lines never pair with history.
- The sessions JSON `last` field carries the text only. The markers are in
  the human output.
- `-l` computes no agreement unless `--agree` is given, and prints no count
  line.
- Unparsable `history.jsonl` lines are skipped by agreement. The search counts
  them only when it parses them.
- `--dedupe` modes are not implemented. The same session in two roots is two
  blocks. Agreement is computed once for the session, over the union of its
  roots' main transcripts (R10, across roots), so both blocks agree.
- `sessions` unites only the roots whose rows its selectors keep; `grep`
  unites every searched root.
- `grep` does not join file-history snapshot entries to their backup files,
  and does not search `toolUseResult`. `files` does both (1e).
- A symlinked store entry directly under a root (`projects`,
  `history.jsonl`, ...) is still walked; every other symlink is skipped and
  counted.
- The `journal.jsonl` line shape is assumed: a line with `agentId` and
  `result`. A journal in another shape gives `journal: none`.
- An `Edit` whose `old_string` occurs more than once (without `replace_all`)
  replaces the first occurrence in replay.
- `NotebookEdit` input has no full content; with no `toolUseResult.content`
  its state is `diff-only`.
- Edit replay on a file with mixed line endings writes CRLF throughout once
  any CRLF is present.
- `--version last`, with only rejected drafts on a path, writes the last
  draft, labelled `rejected` (nothing on disk is known to choose instead).
- An event copy whose session id or `tool_use_id` differs between roots is
  not recognised as a copy: it is two events on the path's one timeline.
- A `_abs` folder inside a cwd named `/abs` and the `_abs` folder for paths
  outside their cwd share one output folder; colliding files get `~<n>`.
- A path with only `backup` events (no write-family event in the selection)
  is not extracted, as `clrg files` does not list it by default.
