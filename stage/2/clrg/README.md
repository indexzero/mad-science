# clrg

clrg searches everything in `~/.claude` and its backups, and recovers files
that Claude Code sessions wrote. Each hit shows the folder to resume its
session from, so `claude --resume` works the first time.

It replaces `(cd ~/.claude/projects && rg -l -uu -i 'query')`. That command
prints bare `<uuid>.jsonl` names. It searches only `projects/`. It matches
JSON-escaped bytes, not the text that was typed.

## Status

Stage 2. `check.sh` passes. Stage 3 when the owner uses it daily and
`clrg grep` answers in 250 ms on the real `~/.claude` and its backups.

clrg reads data only. It never runs anything that it reads, and it never
writes inside a root. `extract` writes only into a new or empty folder that
you name.

## Install

1. Install Rust 1.88 or later, for example with `rustup`. Check it with
   `rustc --version`.
2. From `stage/2/clrg/`, run
   `cargo install --locked --path crates/clrg`. This puts `clrg` in
   `~/.cargo/bin`.
3. Run `clrg --version`.

## Search

```sh
clrg grep 'seed data'                    # literal, smart case, every store
clrg grep -s 'Tatsu'                     # case-sensitive
clrg grep -E 'deni(ed|al)'               # regex is opt-in
clrg grep -l 'seed data'                 # bare paths, like rg -l
clrg grep -b onboarding.gonzo 'fixture'  # one branch, per message
clrg grep --session 9e36d02c denied      # one session (an id prefix is enough)
clrg grep --store history 'seed data'    # only what you typed
clrg grep --in user/text --agree transcript-only -E '.'   # text that Claude Code inserted
```

Each session prints one block:

```text
2026-08-02 14:31  ~/src/app  [onboarding.gonzo]  3f2a9c1e  (cwd missing)
  last: "wire the seed data into the onboarding flow and…"
  14:02 user/text            …can you move the seed data into a fixture so the…
  14:09 assistant/tool_use   …Write fixtures/seed.json …
  14:10 user/text (not in history)  …Your response above was stopped by…
```

- The header has the last time, the launch folder, the branches, and the
  short session id. `(cwd missing)` means that the folder is gone.
- `last:` is the last text that you typed, checked against `history.jsonl`.
- Labels are the raw `type/part` from the data.
- `(not in history)` marks text that is in the transcript but not in
  `history.jsonl`, so you did not type it.

Sessions in the current folder come first. Then come other projects, other
stores, and other roots. When nothing matches, clrg names everything that it
searched and every filter that you set.

Add roots with `-r`, or set `CLRG_ROOTS`:

```sh
clrg -r ~/.claude -r ~/backups/2026.08.13.dotclaude.merged grep 'seed data'
```

## Resume a session

```sh
clrg sessions -d ~/src/app               # newest first, with the launch folder
clrg sessions --format values            # <session id>:<folder>, for scripts
clrg facets branch                       # how is that branch spelled?
```

## Recover a file

```sh
clrg files --path '*pressure-test/SUMMARY.md'
clrg extract --path '*pressure-test/SUMMARY.md' -o ~/recovered/summary
clrg extract -b onboarding.gonzo --created-only -o ~/recovered/gonzo
```

`files` shows each path's history:

- `outcome` is `written`, `rejected`, `returned`, or `unknown`.
- `recoverable` is `full`, `diff-only`, or `none`.

`extract` replays writes, edits, and file-history backups into the last
state of each file. A write that Claude Code rejected, whose content a
subagent returned in its output, comes back as `returned`.
`--version all` writes every state. `MANIFEST.jsonl` records where each file
came from. Exit 4 means that some file was not recoverable, and the summary
lists it.

## Output formats

Every listing takes `--format human|json|jsonl|tsv|values`. The JSONL record
shape is stable. `COGNETICS.md` lists every field.

## Commands not built yet

`show`, `artifacts`, `doctor`, `index`, and `completion` print
`not implemented (yet)` and exit 5. So do `grep --raw` and
`--infer-branch`. They stay in the spec as mile markers.

## Files

| File | What it is |
|---|---|
| `INTENT.md` | The contract: what clrg must do, the design rules, and the Done gate |
| `clrg-cli.kdl` | The [usage](https://usage.jdx.dev/) spec for the whole command surface |
| `USAGE.md` | The command reference, generated from the spec |
| `COGNETICS.md` | What clrg reads, what it adds, and every join that it makes inside `~/.claude` |
| `check.sh` | The machine-checkable Done |

## Development

```sh
./check.sh
```

`check.sh` runs these steps:

1. fmt, clippy, the build, and the tests.
2. It lints the spec and checks that `USAGE.md` is fresh.
3. It checks that the spec and clap agree.
4. It checks that every named test in `INTENT.md` exists and runs.
5. It checks that no committed file has a home path or real transcript
   text.
6. It runs the P1 speed gate. `clrg grep` must take at most 1.5 times as
   long as `rg -l -uu -i` on a seeded 1.3 GB synthetic root.

No test uses real data.
