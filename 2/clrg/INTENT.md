---
stage: 2
importance: "high: the owner searches ~/.claude and its backups daily to find text and the folder to resume a session from"
designed_on: "2026-10-22"
status: "confirmed intent; build in slices; check.sh decides Done"
sources:
  - "clrg-cli.kdl: the usage spec, the north star for the whole command surface"
  - "USAGE.md: generated from clrg-cli.kdl"
  - "../../research/why-rg-crates.md: grep-searcher as a raw-byte pre-filter, serde_json on matched lines only"
  - "rust-cli-aspects *-v2.md, MEDIUM SKU (one-shot CLI), with the deferrals listed below"
  - "Raskin, The Humane Interface (2000): 5-4, 5-5, 5-6, 2-3-6"
on_conflict: "INTENT.md wins over clrg-cli.kdl. clrg-cli.kdl wins over USAGE.md. The deferrals here win over rust-cli-aspects."
---

# clrg: intent

## Restated intent

- **Outcome:** One command that searches the text of everything in `~/.claude`
  and its backups, and shows each hit with enough context to act on it. The
  most important context is the folder to resume the session from.
- **User:** The owner, alone. They jump between sessions and projects often
  and lose track of where a useful session started.
- **Why now:** Today the owner runs `(cd ~/.claude/projects && rg -l -uu -i 'query')`.
  It returns bare `<uuid>.jsonl` paths that say nothing about the project, the
  branch, the date, or why the file matched. It searches only `projects/`. It
  searches JSON-escaped bytes, not the text that was typed. The merged backups
  (2.7 GB) make this worse.
- **Success:** `clrg grep <words>` replaces that command. Each hit shows the
  session's folder, branch, date, id, last prompt, and the matched text in
  context. `check.sh` passes.
- **Constraint:** Stage 2. An agent builds it unattended, and `check.sh`
  decides Done. clrg only reads data. It never runs, launches, or resumes
  anything it reads, and it never writes inside a root.
- **Out of scope:** Launching or resuming `claude`. A full-screen or
  interactive interface. The metadata index. Release machinery. See
  "Deferred".

## The two jobs, in order

1. **Search and re-find (this build).** Find text anywhere in `~/.claude` and
   its backups, and find the folder a session must be resumed from.
2. **Recovery (next build).** List the files that sessions created on a
   branch (`files`) and restore their contents (`extract`). The first use is
   the `onboarding.gonzo` branch.

The north star is the full surface in `clrg-cli.kdl`. Ship the simple thing
first (Gall's law). Every command in the spec stays in the CLI. A command
that this build does not implement prints `clrg <command>: not implemented
(yet)` to stderr and exits 5. It stays as a mile marker.

## Design rules

These rules come from Raskin. Each one is a test (see Done).

- **R1. Results in context, not file names.** The default output shows the
  matched text with the text around it. The match is in the middle of the
  excerpt, not at an edge (5-4). Bare paths are an opt-in (`-l`), for pipes.
- **R2. A result is a cue to resume work.** Each session in the results shows
  the last text the owner typed in it, its launch folder, and whether that
  folder still exists (2-3-6). The launch folder is the first `cwd` recorded in
  the transcript (preferring the one whose encoding equals the
  `projects/<dir>` name), not the lossy `projects/<dir>` name itself.
- **R3. No hidden restricting modes.** By default clrg searches every store,
  every message part, every root, and hidden files. A restriction applies
  only to the command line that states it. No config file and no environment
  variable narrows a search. ("Local Leap", 5-6.) `CLRG_ROOTS` names
  *which* roots exist. It does not filter.
- **R4. A failed search says what it searched.** On no match, stderr names the
  pattern, the number of files, the stores, the roots, and every active filter.
  The exit code is 1 (5-4).
- **R5. Expanding domains.** Results are grouped from near to far: sessions
  whose `cwd` is the current folder (or contains it, or is inside it), then
  the other transcripts in the same root, then the other stores in that root,
  then the other roots in the order given. Within a group, newest first (5-4).
- **R6. Full text and no special characters.** The pattern is literal by
  default. `-E`/`--regex` turns on regex. A `"`, `\`, or `.` in the pattern
  matches that character in the decoded text, not in the JSON-escaped
  bytes (5-4-1, Landauer).
- **R7. Smart case by default.** A lowercase letter matches either case. An
  uppercase letter matches only uppercase. `-i` forces case-insensitive, and
  `-s` forces case-sensitive (5-4).
- **R9. Raw labels, not interpretations.** Every hit is labelled with the
  facts in the data: the line's own `type` (`user`, `assistant`, `system`, …)
  and the content part's own type (`text`, `tool_use`, `tool_result`,
  `thinking`, …), shown as `type/part`, e.g. `user/text`. clrg has no derived
  labels such as `prompt`. The one normalisation: string content is part
  `text`. Every value clrg adds is named as clrg's, says how it was derived,
  and is listed in `COGNETICS.md`.
- **R10. Two sources must agree.** What the owner typed is recorded twice:
  as `user/text` lines in the transcript and as lines in `history.jsonl`.
  clrg cross-checks them and shows the result on every `user/text` and
  `history` record (`agreement`). Disagreement is shown, never filtered out.
  This is how clrg tells typed text from text Claude Code inserted
  (`isMeta` notes, task notifications, interrupts, command output, compaction
  summaries, classifier notices) without a hand-kept skip list.
- **R8. Speed is part of the design.** The fzf reload loop calls clrg once per
  keystroke, so a cold-process search must stay close to plain `rg` on the
  same files (see Done, P1).

## This build

Implemented: `grep` (aliases `messages`, `m`), `sessions` (alias `ls`),
`facets`, and the hidden `--usage-spec`.

Not implemented (yet): `files`, `extract`, `artifacts`, `show`, `doctor`,
`index build|status|clear`, and `completion`. Global flags that only these
commands use (`--index`, `--no-index`, `--dedupe` modes other than `none`)
parse and are accepted. They have no effect, and `--help` says so.

### `clrg grep [pattern]`

- **Stores.** Searched by default: transcripts (`projects/**/*.jsonl`,
  including `subagents/`), `history.jsonl`, `plans/`, `todos/`, `tasks/`,
  `file-history/`, and `sessions/`. `--store <kind>` (repeatable) narrows the
  stores for one command line.
- **What matches.** For JSON and JSONL, the pattern matches decoded string
  values, not raw bytes. For other files (plans, file-history backups), it
  matches the file text. `--in <sel>` (repeatable, default `all`) narrows a
  match by raw labels: a line type (`user`), a part type (`tool_result`), or
  both (`user/text`). "Only what I typed" is `--store history`, or
  `--in user/text` together with `--agree both`.
- **Agreement.** `--agree <value>` (repeatable) narrows `user/text` and
  `history` hits by their `agreement` value. Other hits have no agreement
  value and are unaffected.
- **Attribution.** Each hit is attributed to a session when the store allows
  it: the transcript's own fields, `file-history/<sessionId>/`,
  `todos/<sessionId>*`, `tasks/<sessionId>/`, the `sessionId` in
  `history.jsonl` lines, and a plan's slug. A hit with no session is still
  shown, under its store.
- **Selectors.** The `select` flagset from the spec applies (branch, cwd,
  project, session, since/until, model, cli-version, tool, touched, scope).
  `--branch` filters each message by default (`--scope message`), because the
  branch can change in the middle of a session.
- **Human output (default).** One block per session:

  ```
  2026-08-02 14:31  ~/src/app  [onboarding.gonzo]  3f2a9c1e  (cwd missing)
    last: "wire the seed data into the onboarding flow and…"
    14:02 user/text            …can you move the seed data into a fixture so the…
    14:09 assistant/tool_use   …Write fixtures/seed.json …
    14:10 user/text (not in history)  …Your response above was stopped by…
  ```

  The header has the last timestamp, the launch `cwd` abbreviated with `~`,
  the branches, the short session id, and `(cwd missing)` when the folder
  does not exist. clrg checks this with a `stat` and nothing else.
  The `last:` line is the session's last `user/text` whose agreement is
  `both`. When no history exists for the session, it is the last `user/text`,
  marked `(unverified)`. If a later `user/text` is `transcript-only`, it is
  shown on its own line under `last:`, marked `(not in history)`.
  A `user/text` hit line is marked `(not in history)` when its agreement is
  `transcript-only`.
- **`-l` / `--files-with-matches`.** Prints bare file paths, like `rg -l`.
- **`--format jsonl|json|tsv|values`.** The JSONL record shape is stable and
  covered by a snapshot test. Its fields: root, store, path, session, cwd,
  cwd_exists, branch, ts, type, part, line, excerpt, match_start, match_end,
  last, agreement, agreement_rule.
  - `type` and `part` are raw (R9). Non-transcript stores use `type: null`,
    except `history`, whose records are `type: "history"`, `part: "text"`.
  - `last` (clrg's) is `true` on the session's last `user/text` record and
    `false` on other `user/text` records. It is `null` elsewhere.
  - `agreement` (clrg's) is one of `both`, `transcript-only`, `history-only`,
    `unlinked`, or `unknown`. `unknown` means the session's other source is
    not in any searched root. It is `null` for records that are neither
    `user/text` nor `history`.
  - `agreement_rule` (clrg's) names the matching rule that produced `both`:
    `exact`, `whitespace`, `paste-expanded`, `placeholder-wildcard`, or
    `slash-command`. Otherwise it is `null`.
- **`-C`/`--context <n>`.** Shows n messages before and after each hit. This
  matches rg's muscle memory (see decision D1).
- **`-u`, `-uu`, `-uuu`.** Accepted and ignored, for `rg` muscle memory. clrg
  always searches hidden files and ignores `.gitignore`.
- **Bad lines.** An unparsable line is counted and reported once at the end on
  stderr (unless `-q`). `--strict` makes it exit 3.

### `clrg sessions`

One row per session, newest first: the last timestamp, the launch `cwd` (and
whether it exists), the branches, the session id, the message count, and the
`last:` text chosen as in `grep`, with the same markers.
This answers "which folder do I resume from?" `--format values` prints
`<session id>:<cwd>` for completion and pipes.

### `clrg facets <field>`

Counts the distinct values of a field (branch, cwd, project, model,
cli-version, tool, root, day) across the selection. Use it to find the exact
spelling of a branch before you search for it.

## Agreement between history and transcripts (R10)

A `history.jsonl` line and a transcript `user/text` line *agree* when both
have the same session id and the first rule below that succeeds says they
match. Rules are tried in this order, and the rule that matched is recorded
in `agreement_rule`:

1. `exact`: the history `display` equals the transcript text.
2. `whitespace`: they are equal after collapsing runs of whitespace and
   trimming.
3. `paste-expanded`: `display` equals the text after each
   `[Pasted text #N …]` placeholder is replaced with `pastedContents[N].content`.
4. `placeholder-wildcard`: any `[Pasted text #N …]` or `[Image …]`
   placeholder that rule 3 could not expand matches any text in its
   position. Pastes stored only as a `contentHash` reach this rule, because
   `paste-cache/` keeps few of them.
5. `slash-command`: `display` (`/name args`) equals the transcript's
   `<command-name>` plus `<command-args>`.

Each history line and each transcript line takes part in at most one
agreeing pair, matched in time order. Outcomes:

- `both`: the pair agreed.
- `transcript-only`: a `user/text` line with no agreeing history line, in a
  session that has history.
- `history-only`: a history line with no agreeing `user/text` line, in a
  session whose transcript was searched.
- `unlinked`: a history line with no `sessionId`.
- `unknown`: the other source for the session is not in any searched root.

A measured profile of the owner's `~/.claude` (counts only, 2026-10-23):
rules 1–5 matched 1,335 history lines and 113 did not. 926 `user/text` lines
were `transcript-only`, and almost all of them had a recognisable inserted
form (579 `isMeta`, 164 `<task-notification>`, 52 interrupts, 29
`<local-command-stdout>`, 26 `<local-command-caveat>`, 8 compaction summaries,
5 classifier notices). 57 had no flag and no tag. They stay
`transcript-only`. No rule is added for them until the owner decides.

`clrg grep` and `clrg sessions` print one stderr line with the counts of
`transcript-only` and `history-only` records among the results, unless `-q`.

## COGNETICS.md

`COGNETICS.md` is the map of everything clrg reads, adds, and joins. It is
written from the code, kept in the repo, and has three parts:

1. **Extraction.** For every displayed value and every record field, the
   exact source: the file, the JSON path, and how it is decoded. Example:
   `user/text` comes from a line with `type == "user"` whose
   `message.content` is a string, or the `text` field of each content part
   with `type == "text"`.
2. **Added values.** Every value clrg adds (`last`, `agreement`,
   `agreement_rule`, `cwd_exists`, launch `cwd`, `last:`, `(not in history)`,
   `(unverified)`, domain order, session attribution of non-transcript files,
   excerpt centering), each with its derivation and the test that covers it.
3. **Cross-references.** Every join clrg makes inside a `~/.claude` root, and
   across roots: transcript ↔ `history.jsonl`, transcript ↔ `subagents/` and
   `tool-results/`, session id ↔ `file-history/`, `todos/`, `tasks/`, and
   transcript `cwd` ↔ the `projects/<dir>` name. Each lists its key, how it
   fails, and what clrg shows when it fails.

## Engine

- **Workspace.** A lib/bin workspace. `crates/clrg-core` (lib) holds root and
  store discovery, the record model, selectors, search, and domain ordering.
  `crates/clrg` (bin) holds clap, rendering, and exit codes. `main.rs` is
  under 200 lines. The library never reads `HOME`, the current folder, or the
  environment. The bin passes them in.
- **Walk.** The `ignore` crate's parallel walker, with hidden files and ignore
  files turned off (the same as `rg -uu`). Symlinks are not followed.
- **Search.** `grep-searcher` and `grep-regex` run a raw-byte pre-filter. For a
  literal pattern, the pre-filter is the longest run of the pattern that JSON
  does not escape. `serde_json` parses only the lines that pass, and the real
  match runs on the decoded text (R6). For a matched session, clrg reads that
  session's transcript once more for the header fields (cwd, branch, last
  prompt). It reads the tail for the last prompt.
- **No async.** No tokio. Threads come from the walker.
- **Small dependency set:** clap (derive, env, wrap_help), clap_usage, serde,
  serde_json, ignore, grep-searcher, grep-regex, grep-matcher, globset,
  thiserror, anyhow, a time crate, and a terminal-color crate. Add others
  only with a stated reason.
- **Errors.** The library uses `thiserror`. The bin uses `anyhow` and prints
  `{err:#}`. `#![forbid(unsafe_code)]`. Clippy pedantic. Declare an MSRV.
  Edition 2024.
- **Release profile.** `panic = "abort"`. This is a one-shot CLI with no
  full-screen mode.

## The usage spec

- `clrg-cli.kdl` is written by hand and is the north star. It holds what clap
  cannot express: outputs, exit codes, flagsets, and dynamic completions.
- The binary emits its own spec with a hidden `--usage-spec` flag via
  `clap_usage`. Check that the crate and its API exist before you depend on
  it. If they do not, write a test that compares the clap command tree with
  `usage generate json --file clrg-cli.kdl`.
- **Parity rule:** every command, alias, flag, and argument in `clrg-cli.kdl`
  exists in clap, and every one in clap exists in the spec.
- This intent requires these edits to the spec:
  - `grep`: replace `-F --fixed-strings` with `-E --regex`.
  - Add `-s --case-sensitive` and make smart case the default.
  - Add `-l --files-with-matches`.
  - Add `--store <kind>` (repeatable).
  - Change the default of `--in` to `all`.
  - Make `--context` `-C --context`, and move `--cwd` to `-d --cwd`.
  - Add hidden `-u` (count).
  - Add `exit_code 5 "not implemented (yet)"`.
  - Add `cwd_exists` to the `sessions` fields.

  Regenerate `USAGE.md` after the edits.

## Done: `check.sh` exits 0

1. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
   `cargo build`, and `cargo test`.
2. `usage lint clrg-cli.kdl` passes. `USAGE.md` matches
   `usage generate md` byte for byte. The spec/clap parity test passes.
3. These named tests exist, are listed by `cargo test -- --list`, and pass:
   - `g1_pattern_is_literal_by_default`
   - `g2_smart_case`
   - `g3_regex_is_opt_in`
   - `g4_matches_decoded_text_not_json_escapes`
   - `g5_branch_filter_applies_per_message`
   - `g6_no_match_reports_what_was_searched`
   - `g7_hit_shows_cwd_branch_session_and_last_prompt`
   - `g8_current_folder_sessions_rank_first`
   - `g9_all_stores_searched_by_default`
   - `g10_files_with_matches_prints_paths`
   - `g11_jsonl_record_shape_is_stable`
   - `s1_sessions_newest_first_with_cwd`
   - `s2_missing_cwd_is_flagged`
   - `f1_facets_counts_branches`
   - `n1_unimplemented_commands_say_not_implemented_yet` (every one, exit 5)
   - `r1_never_writes_inside_a_root` (the hashes of the fixture tree are
     unchanged after every command)
   - `l1_labels_are_raw_type_and_part` (no derived label appears in any
     format)
   - `l2_last_marks_the_sessions_last_user_text`
   - `a1_agreement_rules_in_order` (one case per rule, 1–5)
   - `a2_inserted_text_is_transcript_only` (an `isMeta` note, a classifier
     notice, an interrupt, a `<task-notification>`)
   - `a3_history_without_transcript_is_unknown_or_history_only`
   - `a4_history_without_session_id_is_unlinked`
   - `a5_last_line_prefers_agreed_text` (the `last:` header, `(not in
     history)`, and `(unverified)`)
   - `a6_disagreement_counts_reported`
   - `c1_cognetics_lists_every_record_field` (every JSONL field name and
     every `agreement`/`agreement_rule` value appears in `COGNETICS.md`)
4. **P1 (speed).** A deterministic, seeded generator builds a synthetic
   `~/.claude` of at least 1 GB, cached under `target/`. On a warm cache,
   `clrg grep` with a rare literal pattern takes at most 1.5 times as long as
   `rg -l -uu -i` with the same pattern on the same tree (best of 5 runs).
   check.sh prints both times.
5. No committed file contains an absolute home path, a real session id, or
   real transcript text. Every test uses fixtures under `tests/fixtures/` or
   the generator.

The 250 ms target from R8 is measured by hand against real data. It is not
in check.sh. A miss of that target is the trigger to build the index.

## Build 2: recovery (`files`, `extract`)

Approved by the owner on 2026-10-23. The first case is
`pressure-test/SUMMARY.md`. A workflow subagent's `Write` of that file was
rejected (`is_error: true`: "Subagents should return findings as text, not
write report files"), so the file never reached disk. The subagent then
returned a later, linted version in its final `StructuredOutput.file`. An
extract that took the `Write` input would produce a stale draft, and one that
trusted disk would produce nothing.

### Search gap fixed first (R3)

`<session>/workflows/*.json` (workflow run records) is searched as store
`workflows`. Every other file under a session folder is also searched:
`subagents/**` (including `*.meta.json` and `journal.jsonl`) and
`tool-results/**`. A file under `projects/` that no store claims is searched
as store `transcripts`, `type: null`, so nothing under a root is silently
skipped. `COGNETICS.md` lists every path form and its store.

### Evidence: what clrg knows about a file's content

Measured shapes in the owner's `~/.claude` (counts only, 2026-10-23):

- `file-history-snapshot` lines: `snapshot.trackedFileBackups` maps a path
  (11,308 absolute and 15,271 relative to the session's `cwd`) to
  `{backupFileName, backupTime, version, realParentDir?}`.
  `backupFileName` is `<16-hex>@v<N>`, or `null` (5,049 entries) when the
  file did not exist at that point.
- A successful `Write` has `toolUseResult` with `{type: create|update,
  filePath, content, originalFile, structuredPatch, userModified}`.
- A successful `Edit` has `toolUseResult` with `{filePath, oldString,
  newString, replaceAll, originalFile (often null), structuredPatch,
  userModified}`.
- Tool results with `is_error: true` are common (1,175).

Each piece of evidence is an *event* on a path:

| Event | Source | Content after the event |
|---|---|---|
| `backup` | `file-history/<sid>/<backupFileName>`, at `backupTime` | the file bytes (`null` backup means the file was absent) |
| `write` | a `Write`/`NotebookEdit` `tool_use` whose `tool_result` is not an error | `toolUseResult.content`, else `input.content` |
| `edit` | an `Edit`/`MultiEdit` `tool_use` whose result is not an error | `oldString` replaced by `newString` (honouring `replaceAll`) in `toolUseResult.originalFile`, or in the previous known content |
| `rejected` | any write/edit `tool_use` whose `tool_result` has `is_error: true` | none on disk; the intended content is kept and labelled `rejected` |
| `returned` | after a `rejected` write in a subagent transcript: a string in that agent's last `StructuredOutput` input, or its last assistant text, that matches the rejected content (rule below) | that string, labelled `returned` |

**`returned` rule (clrg's).** The candidate is the longest string among
those fields. It is `returned` when at least 80% of the rejected content's
non-blank lines appear in it, and the record stores that share as
`similarity`. When the workflow's `journal.jsonl` holds a `result` for the
same `agentId` and that result contains the same string, the record says
`journal: agree`, otherwise `journal: disagree` or `journal: none` (R10
applied to recovery).

A relative snapshot path resolves against the session's launch `cwd` (R2).
A path's events are ordered by time.

**State and verification (clrg's).** Replaying a path's events gives its
content after each event. An `edit` with no `originalFile` and no previous
known content, or whose `oldString` is not found exactly, is `diff-only`. The
chain is broken from there until the next full-content event. Wherever a
replayed state can be compared with a later `backup` of the same path (before
any further event), the record says `verified: agree` or
`verified: disagree`. Disagreement is shown, never hidden.

### `clrg files`

One row per path across the selected messages: path (absolute after
resolution), cwd, ops (`write`, `edit`, `backup`, `rejected`, `returned`,
`read`), first_ts, last_ts, sessions, branches, versions (count of distinct
content states), `outcome` (`written`, `rejected`, `returned`, or `unknown` for
the last event), `recoverable` (`full`, `diff-only`, `none`), and root. The
default `--op` is write and edit (they include `rejected`/`returned`). `read`
comes from `Read` inputs. `--op bash` stays `not implemented (yet)`, exit 5.
`--created-only` keeps paths whose first event is a `write` (or `rejected`
write) with no earlier `backup` holding content. `--path <glob>` matches the
resolved absolute path.

### `clrg extract`

Writes recovered content into `-o <dir>`. The directory must not exist or must
be empty. It must not be inside any root (exit 2 if so). No written path may
leave `<dir>`: `..` components and absolute-path tricks are refused.

- `--version last` (default) is the final replayed state. `first` is the
  earliest full state. `all` writes every distinct state as `<name>.v<N>`.
- `--source best` (default) uses every event. `file-history` uses only
  `backup` events. `transcript` uses only `write`/`edit`/`rejected`/`returned`
  events.
- `--layout cwd|absolute|session` as in the spec.
- Rejected and returned content is extracted like any other state, and its
  label shows in the human summary and the manifest. clrg does not drop it
  silently, and it does not pass it off as `written`.
- `MANIFEST.jsonl`, one line per written file: path, out_path, session,
  agent_id, root, version, ts, `source_event` (the event kind), `outcome`,
  `verified`, `similarity`, `journal`, sha256, bytes.
- `--dry-run` prints the plan and writes nothing.
- Exit 4 when any selected path's requested state is `diff-only` or `none`.
  Everything recoverable is still written, and the summary lists what was not.

### Build 2 Done (added to check.sh)

Named tests (synthetic fixtures only):

- `w1_workflow_records_are_searched`
- `w2_no_file_under_a_root_is_skipped`
- `fl1_files_lists_paths_with_ops_and_outcome`
- `fl2_rejected_write_is_marked_rejected`
- `fl3_relative_snapshot_paths_resolve_against_launch_cwd`
- `fl4_created_only`
- `x1_extract_refuses_nonempty_or_in_root_out_dir`
- `x2_extract_last_replays_writes_and_edits`
- `x3_extract_returned_content_for_rejected_subagent_write`. The fixture
  mirrors the SUMMARY.md case: a rejected `Write`, two lint `Bash` calls, and
  a final `StructuredOutput.file` with a revised version, plus a journal
  `result`.
- `x4_unrecoverable_exits_4_and_lists_it`
- `x5_manifest_records_provenance`
- `x6_replay_verified_against_later_backup` (agree and disagree)
- `x7_extract_never_writes_outside_out`
- `x8_version_all_and_first`

Also:

- `n1` no longer lists `files` and `extract`.
- `r1` covers `files` and every `extract` form, writing `-o` outside the
  fixture root, and asserts the root is unchanged.
- `c1` also requires every new field and value (`outcome`, `recoverable`,
  `verified`, `similarity`, `journal`, `source_event`, and the event kinds) in
  `COGNETICS.md`.

Owner acceptance, run by hand: `clrg extract --session 9e36d02c --path
'*pressure-test/SUMMARY.md' -o <new dir>` writes the 20,920-character
`StructuredOutput.file` version with `outcome: returned`, and the manifest
shows the rejected first draft as an earlier state.

### Revision 2026-10-23: build 2 review

A read-only review confirmed defects that the tests missed. These rules
replace the matching text above wherever they conflict.

**Search and display**

- **R3, whole root.** Every file under a root is searched. A file that no
  store claims (`settings.json`, `CLAUDE.md`, `commands/`, `skills/`,
  `plugins/`, `agents/`, `paste-cache/`, `shell-snapshots/`, loose files in
  `file-history/`, …) is store `other`, `type: null`, `part: null`.
  `--store other` exists. Symlinked files are not followed. They are counted
  and reported as skipped, so nothing is dropped without notice.
- **R9.** A saved `tool-results/` file is `part: null`, not `tool_result`.
  The folder name is not a label.

**Agreement**

- **Pairing across roots.** Agreement pairs each session's history lines
  against the union of that session's `user/text` lines from every searched
  root, deduplicated by line `uuid`.
- **Time window.** Rule 4 (`placeholder-wildcard`) pairs only within 120
  seconds.

**Evidence**

- **Only writes can be rejected.** Only `Write`, `Edit`, `MultiEdit`, and
  `NotebookEdit` results can be `rejected`. A failed `Read` or other tool is
  not a write event.
- **One timeline per path.** Events for a path are merged across roots and
  deduplicated by (session, `tool_use_id`) or (session, backup file). A path
  has one timeline, and each record lists every root it came from.
- **Selectors choose paths, not events.** Replay always uses every event on
  a chosen path, so a `--branch` or `--since` filter never breaks a chain.
- **Edit replay.** Matching normalises CRLF to LF. An empty `newString`
  that removes a whole line also removes that line's newline, as Claude Code
  does. A `tool_use` with no result is `unknown`, and later edits do not
  chain from it.
- **`returned` rule.**
  - The candidate is the string with the highest similarity among the
    agent's last `StructuredOutput` strings (nested fields included) and its
    last assistant text. It is not the longest string.
  - It is `returned` only when the rejected content has at least 3
    non-blank lines, at least 80% of them appear in the candidate, and the
    candidate's length is between 0.5× and 2× the rejected content's.
  - Each candidate string can be returned for at most one path, the one with
    the highest similarity.

**`extract`**

- **`--layout cwd`.** A path outside its session's `cwd` goes to
  `<dir>/_abs/<absolute path minus leading />`. clrg refuses only a path that
  is unsafe, and never the whole run: an unsafe path is skipped, listed, and
  makes the exit code 4.
- **Case collisions.** Planned output paths are also checked
  case-insensitively. Paths that would collide get the suffix `~2`, `~3`,
  and so on, decided before the first write.
- **`--version last`.** This is the last state that was on disk (`write`,
  `edit`, `backup`) or `returned`. A newer `rejected` draft is not chosen.
  The summary lists it ("1 newer rejected draft not extracted; use
  `--version all`"). `--version all` still writes rejected drafts, labelled
  in the manifest.

**Speed**

- Human-mode grep pre-filters transcript lines on raw bytes (e.g.
  `"type":"user"`) before it parses them for agreement and `last:`.

**New named tests (fixtures only)**

- `w3_root_level_files_are_store_other`
- `w4_skipped_symlinks_are_reported`
- `fl5_failed_read_is_not_a_write`
- `fl6_backup_roots_merge_into_one_timeline`
- `fl7_selectors_choose_paths_not_events`
- `x9_outside_cwd_goes_to_abs_and_never_refuses_the_run`
- `x10_case_collisions_are_suffixed_before_writing`
- `x11_last_skips_newer_rejected_draft`
- `x12_returned_rule_rejects_unrelated_or_short_candidates`
- `x13_returned_picks_highest_similarity_field`
- `x14_edit_replay_crlf_and_line_deletion`
- `a7_agreement_unions_roots`
- `a8_placeholder_rule_has_a_time_window`

## Deferred (stage 3 or later)

These items wait until the owner relies on clrg:

- `dist`, Homebrew, winget, cargo-binstall metadata, and attestations
- static musl builds and the cross-platform CI matrix
- `cargo deny` and `cargo audit`
- hk hooks
- napi-rs
- the metadata index
- the full-screen interface, built on top of the one-shot CLI
- `--op bash` in `files` (paths that appear in shell commands; heuristic)
- reading `paste-cache/` to expand hashed pastes

## Revision 2026-10-23: raw labels and agreement

Approved by the owner. It replaces the derived part labels (`prompt`,
`assistant`, `other`) with raw `type/part` labels (R9). It adds `last`,
`agreement`, and `agreement_rule` (R10), the `--agree` flag, and
`COGNETICS.md`. It changes `--in` to take raw names. Tests g7 and g11 change
to the new labels and record shape, and l1–l2, a1–a6, and c1 are added.
Spec edits:

- `--in` choices become free-form raw selectors.
- Add `--agree <value>` (repeatable).
- Add the new record fields to the FIELDS notes.
- Rename the sessions field `last_prompt` to `last`.
- Regenerate `USAGE.md`.

## Decisions made without asking (veto any)

- **D1.** `-C` means `--context`, as in `rg`. `--cwd` moves to `-d`. This
  changes the spec.
- **D2.** "Not implemented (yet)" exits 5. This adds a new exit code to the
  spec.
- **D3.** The default of `--in` changes from `text` to `all` (R3).
- **D4.** No index in this build. Measure first.
- **D5.** The project stays at `2/clrg` (like `2/3coin-bank`). The spec keeps
  the name `clrg-cli.kdl`.
- **D6.** The build runs as slices, each by a fresh agent, and each ends with
  check.sh green for the work done so far:
  1. scaffold, spec edits, stubs, and check.sh
  2. the grep engine
  3. the result rendering and formats
  4. sessions and facets
  5. the speed gate
  6. review
