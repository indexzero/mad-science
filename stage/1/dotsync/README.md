# dotsync

dotsync mirrors a dot directory into an object store. The default root is `~/.claude`. Every object sits under a prefix for this machine, so two machines never write the same key. The daemon watches the root, batches changes per folder, and uploads whole files. It never deletes a remote object. It never uploads a file that matches the deny list.

## Status

Stage 1 on entry. Stage 2 when `check.sh` passes. Stage 3 when the owner runs the daemon for 24 h and reads the listing from a second machine. The Linux build is untested in this run.

## Install

1. Run `cargo build --release`.
2. Copy `target/release/dotsync` to `/usr/local/bin/dotsync`, or to another path.
3. Copy `launchd/com.indexzero.dotsync.plist` to `~/Library/LaunchAgents/`.
4. In that copy, change the two placeholders: the binary path `/usr/local/bin/dotsync` and the log path `/usr/local/var/log/dotsync.log`.
5. In that copy, set `DOTSYNC_STORE` to your bucket URL.
6. In that copy only, add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` to `EnvironmentVariables`. The repository copy never carries a credential.
7. Run `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.indexzero.dotsync.plist`.

For R2 or MinIO, set `DOTSYNC_ENDPOINT` to the endpoint URL. The tool reads no `~/.aws/credentials` file. Export the variables, for example with `aws configure export-credentials --format env`, and put them into the installed plist copy.

## Run

Every subcommand needs `--store`. The hostname is computed by default. Pass `--host` to pin it.

```sh
dotsync plan --store s3://example-bucket/dotsync --host alpha
dotsync sync --store s3://example-bucket/dotsync --host alpha
dotsync ls --store s3://example-bucket/dotsync --host alpha
dotsync daemon --store s3://example-bucket/dotsync --host alpha
```

`plan` prints the next batch and writes nothing. `sync` runs one upload pass per root and exits. `ls` lists what a host has uploaded. `daemon` watches and uploads until SIGINT or SIGTERM.

The store URL grammar: `memory:` for a test, `file:/absolute/dir` for a local directory, and `s3://bucket` or `s3://bucket/prefix` for S3, R2, or MinIO.

## Bucket layout

With `--store s3://example-bucket/dotsync`, the host `alpha`, the root `claude`, and the path `projects/x/y.jsonl`:

```text
dotsync/alpha/claude/projects/x/y.jsonl                        the file bytes
dotsync/alpha/.dotsync/claude/links/projects/x/y.jsonl         only if y.jsonl is a symlink
dotsync/alpha/.dotsync/claude/tombstones/projects/x/y.jsonl    only after y.jsonl is removed
dotsync/alpha/.dotsync/claude/manifest.json                    after every pass
```

A symlink is stored as a JSON record with its raw target string. The target is never followed. A removed file gets a tombstone record. The file object stays.

## Deny list

A path that matches a pattern never enters the plan, the manifest, or the store. Patterns match the root-relative path, case-insensitive. A pattern that ends in `/**` prunes a whole directory. A name pattern applies to files only.

```text
**/.credentials.json
**/*.pem
**/*token*
**/*secret*
cache/**
paste-cache/**
shell-snapshots/**
debug/**
skills/.trash/**
*-cache.json
**/.DS_Store
**/.credentials.json*
```

The `deny` key in the config file replaces the whole list. The `deny_extra` key appends to it. The pattern `**/*token*` is broad on purpose. A false deny costs one file. A false allow publishes a secret.

## Config file

The default path is `~/.config/dotsync/config.toml`, or `$XDG_CONFIG_HOME/dotsync/config.toml` when that variable is set. `--config` and `DOTSYNC_CONFIG` win over both. A flag wins over its environment variable. The environment variable wins over the file key. The file key wins over the default. An unknown key is an error.

```toml
# Every key is optional. A flag or an environment variable wins over this file.
host = "alpha"                       # Pins the prefix across hostname changes.
store = "s3://example-bucket/dotsync"
endpoint = "https://ACCOUNT_ID.r2.cloudflarestorage.com"  # R2 or MinIO only.
state_dir = "~/.local/state/dotsync" # A leading ~ is expanded.

deny_extra = ["**/*.key"]            # Appended to the default list.
# deny = [...]                       # Replaces the whole default list.

quiet_secs = 2
ceiling_secs = 300
rescan_secs = 1800
debounce_ms = 500

# A [[roots]] table ends the top-level keys, so it comes last.
[[roots]]
path = "~/.claude"                   # The only v1 root. A second root is ask-first.
name = "claude"                      # Optional. Default: the final component without leading dots.
```

Set `host` in the config file to pin the prefix. When the computed hostname changes, the daemon writes under the new prefix with a fresh manifest, and the old prefix stays untouched.

## How it decides what to upload

The manifest records size, mtime in nanoseconds, inode, and a blake3 hash for every path. A path whose size, mtime, or inode moved is hashed again, and a new hash is uploaded. A path modified within the last 2 s is hashed again as well, so a same-size rewrite within one second still uploads. A rescan stats every entry under a folder and never trusts a folder mtime. A folder closes 2 s after its last change, or 5 min after its first change when writes never stop. A full rescan of every root runs at startup and every 30 min.

## Limits of v1

- No remote delete. A removed file gets a tombstone and the object stays.
- A path added to the deny list after its upload keeps its object in the store. dotsync writes no tombstone for it. Remove the object by hand.
- No convergence. Each machine writes under its own prefix.
- One root, `~/.claude`. A second root is an ask-first change.
- One daemon per state directory. Two daemons on one state directory corrupt the manifest.
- Whole-file uploads in memory. A very large file costs its size in memory for one put.
- No profile-file credentials. Only the AWS environment variables are read.
- Linux is untested. The code carries `cfg` gates so it builds there.
- A path that changes from a file to a directory of the same name is logged once and skipped. Move the old file object aside by hand to resolve it.
- A key segment with one of the characters `% # ~ [ ] * ? { } ^ " < > | \`, or a backtick, is percent-encoded. On a `file:` store the encoded name is the file name on disk.
- A manifest from a newer schema is an error at load. Delete the file to start over.

## Owner steps to stage 3

1. Run the daemon under launchd for 24 h.
2. From a second machine, run `dotsync ls --host <name>` against the same store.
3. Make sure that the listing matches the first machine.

## Check

Run `bash check.sh`. It prints one `ok:` line per step and stops at the first failure. Set `DOTSYNC_CHECK_TMP` to keep the scratch directory.

| Line | What it proves |
|---|---|
| `ok: cargo build` | The crate compiles. |
| `ok: cargo test` | Every test passes. |
| `ok: five named tests listed` | The four failure-mode tests and the deny-list test exist. |
| `ok: five named tests ran and passed` | None of them is ignored. |
| `ok: cargo clippy` | No lint warning. |
| `ok: cargo fmt` | The code is formatted. |
| `ok: no unsafe outside forbid(unsafe_code)` | The crate forbids `unsafe`. |
| `ok: synthetic root created` | A temp root with a deny-listed file, a cache, and a symlink exists. |
| `ok: plan lists every file except the deny list` | `plan` prints the three expected lines. |
| `ok: plan wrote nothing to the store or the state dir` | `plan` is read-only. |
| `ok: sync uploads` | `sync` exits 0. |
| `ok: manifest written under the explicit state dir` | The manifest lands under `--state-dir`. |
| `ok: store keys follow the layout` | The four key forms exist. |
| `ok: deny-listed files are absent from the store` | No `.credentials.json` and no `cache/` file was put. |
| `ok: second plan prints nothing` | A restart with no changes uploads nothing. |
| `ok: ls --host alpha lists the uploaded paths` | `ls` reads the manifest snapshot. |
| `ok: no private strings` | No home path, credential prefix, hostname, or username in the tree. |
| `ok: plutil -lint` | The launchd plist parses on macOS. |
