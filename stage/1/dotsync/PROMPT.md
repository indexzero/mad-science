---
stage: 1
importance: "medium: the owner's agent state survives a machine loss."
chats: [7a4c75e8]
design: "orckits#17"
design_source:
  - "https://github.com/indexzero/orckits/issues/17"
  - "indexzero/mad-science/2026-10-dotsync/"
designed_on: "2026-10-20"
---

# dotsync: the build prompt

## Objective

Build one Rust binary that mirrors a dot directory into an object store under a per-machine prefix. It watches the directory, batches changes per folder, and uploads whole files with a stat-and-hash manifest. It never deletes a remote object and never uploads a deny-listed file.

## Modules

- `src/main.rs`: the only module that reads `HOME`, the hostname, and the `XDG_*` variables. It builds `Defaults` and calls `cli::run`.
- `src/cli.rs`: the clap types, the `plan`, `sync`, `ls`, and `daemon` runners, and the daemon loop.
- `src/config.rs`: the TOML file schema and the merge of flag, then environment, then file, then default.
- `src/scan.rs`: the deny list, the walk, the stat, and the blake3 hash. It never follows a symlink.
- `src/manifest.rs`: the manifest schema, the diff into a plan, the apply, and the atomic write.
- `src/batch.rs`: the per-folder quiet window and ceiling as a pure state machine with an injected clock.
- `src/watch.rs`: the `notify` stream mapped to folder hints.
- `src/store.rs`: the store URL grammar, the key layout, the upload pass, the snapshot put, and the host listing.

## Rules

- Rust edition 2024. `#![forbid(unsafe_code)]`. Small modules. `thiserror` errors. No globals.
- Library code takes every root, config path, hostname, and store as an argument. No test reads `HOME` or calls a hostname function. Tests use `tempfile::TempDir` roots only.
- `cfg` gates for platform code, so Linux still builds.
- Never upload a deny-listed file.
- Never delete a remote object in v1. Write a tombstone.
- Never run a test against a real bucket. Use `memory:` and `file:` stores only.
- Keep `plan` read-only. Write the manifest atomically.
- No absolute path, hostname, credential, or bucket name other than `example-bucket` in any committed file.

## The five named tests

- `fm_1_same_size_rewrite_within_one_second_uploads` in `src/manifest.rs`.
- `fm_2_in_place_edit_without_folder_mtime_change_uploads` in `src/manifest.rs`.
- `fm_3_restart_with_no_changes_uploads_nothing` in `src/manifest.rs`.
- `fm_4_batch_closes_at_ceiling_while_file_keeps_appending` in `src/batch.rs`.
- `dl_1_credentials_json_never_reaches_store` in `src/store.rs`.

## The `check.sh` steps

1. `cargo build`, `cargo test`, and a count of the five named tests, listed and passed.
2. `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`.
3. No `unsafe` outside the `forbid` line.
4. A synthetic root with a deny-listed file, a cache directory, and a symlink.
5. `plan` prints the three expected lines and writes nothing.
6. `sync` uploads, the manifest lands under `--state-dir`, and the four key forms exist.
7. No deny-listed file reached the store.
8. A second `plan` prints nothing.
9. `ls --host alpha` lists the uploaded paths.
10. No private string in the tree, and the plist lints on macOS.

## Done

Every step of `check.sh` prints `ok:`. Every test passes. The tree holds no private string.
