#!/usr/bin/env bash
# check.sh: the machine-checkable Done for dotsync.
# Runs from its own directory. Never touches ~/.claude or a real bucket.
# The end-to-end exercise uses DOTSYNC_CHECK_TMP, or a fresh mktemp -d.
# The binary runs with HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, the ten
# DOTSYNC_* variables, and the seven AWS_* variables that AmazonS3Builder::from_env
# and this design name, all controlled by the wrapper.
set -euo pipefail
cd "$(dirname "$0")"
# Cargo builds into CARGO_TARGET_DIR when it is set. A relative value resolves
# from this directory, the same way cargo resolves it after the cd above.
TARGET_DIR="${CARGO_TARGET_DIR:-target}"

step() { printf 'ok: %s\n' "$1"; }

cargo build
step "cargo build"

cargo test 2>&1 | tee "$TARGET_DIR/check-cargo-test.log"
step "cargo test"

n="$(cargo test -- --list 2>/dev/null | grep -cE '(^|::)(fm_1|fm_2|fm_3|fm_4|dl_1)_' || true)"
if [ "$n" != "5" ]; then
  echo "fail: expected 5 named tests listed, found $n" >&2
  exit 1
fi
step "five named tests listed"

passed="$(grep -cE '^test ([a-z0-9_]+::)*(fm_1|fm_2|fm_3|fm_4|dl_1)_[a-z0-9_]+ \.\.\. ok$' "$TARGET_DIR/check-cargo-test.log" || true)"
if [ "$passed" != "5" ]; then
  echo "fail: expected 5 named tests to run and pass, found $passed" >&2
  exit 1
fi
step "five named tests ran and passed"

cargo clippy --all-targets -- -D warnings
step "cargo clippy"

cargo fmt --check
step "cargo fmt"

if grep -rn unsafe src/ | grep -v 'forbid(unsafe_code)'; then
  echo "fail: unsafe outside forbid(unsafe_code)" >&2
  exit 1
fi
step "no unsafe outside forbid(unsafe_code)"

TMP="${DOTSYNC_CHECK_TMP:-$(mktemp -d)}"
mkdir -p "$TMP/home" "$TMP/root/projects/p1" "$TMP/root/cache" "$TMP/root/skills" "$TMP/store"
printf 'user instructions\n' > "$TMP/root/CLAUDE.md"
printf '{"type":"user"}\n' > "$TMP/root/projects/p1/session.jsonl"
printf '{"token":"not-real"}\n' > "$TMP/root/.credentials.json"
printf 'blob\n' > "$TMP/root/cache/blob.bin"
ln -s ../CLAUDE.md "$TMP/root/skills/link.md"
step "synthetic root created"

BIN="$TARGET_DIR/debug/dotsync"
# run <subcommand> [flags]: the subcommand comes first, because --config and
# --state-dir are subcommand flags (section 9), not global flags.
run() {
  sub="$1"
  shift
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
      -u AWS_PROFILE -u AWS_DEFAULT_REGION -u AWS_ENDPOINT -u AWS_ALLOW_HTTP \
      -u XDG_CONFIG_HOME -u XDG_STATE_HOME \
      -u DOTSYNC_ROOT -u DOTSYNC_STORE -u DOTSYNC_HOST -u DOTSYNC_STATE_DIR \
      -u DOTSYNC_CONFIG -u DOTSYNC_ENDPOINT \
      -u DOTSYNC_QUIET_SECS -u DOTSYNC_CEILING_SECS -u DOTSYNC_RESCAN_SECS -u DOTSYNC_DEBOUNCE_MS \
      HOME="$TMP/home" "$BIN" "$sub" --config "$TMP/absent.toml" --state-dir "$TMP/state" "$@"
}

cat > "$TMP/expected.plan" <<'EOF'
upload root/CLAUDE.md
upload root/projects/p1/session.jsonl
link root/skills/link.md -> ../CLAUDE.md
EOF
run plan --root "$TMP/root" --store "file://$TMP/store" --host alpha > "$TMP/actual.plan"
diff "$TMP/expected.plan" "$TMP/actual.plan"
step "plan lists every file except the deny list"

test -z "$(ls -A "$TMP/store")"
test ! -e "$TMP/state/alpha/root.manifest.json"
step "plan wrote nothing to the store or the state dir"

run sync --root "$TMP/root" --store "file://$TMP/store" --host alpha
step "sync uploads"

test -f "$TMP/state/alpha/root.manifest.json"
step "manifest written under the explicit state dir"

test -f "$TMP/store/alpha/root/CLAUDE.md"
test -f "$TMP/store/alpha/root/projects/p1/session.jsonl"
test -f "$TMP/store/alpha/.dotsync/root/links/skills/link.md"
test -f "$TMP/store/alpha/.dotsync/root/manifest.json"
step "store keys follow the layout"

if find "$TMP/store" -name '.credentials.json' | grep -q .; then
  echo "fail: .credentials.json reached the store" >&2
  exit 1
fi
if find "$TMP/store" -path '*/cache/*' | grep -q .; then
  echo "fail: a cache/ file reached the store" >&2
  exit 1
fi
step "deny-listed files are absent from the store"

run plan --root "$TMP/root" --store "file://$TMP/store" --host alpha > "$TMP/second.plan"
test ! -s "$TMP/second.plan"
step "second plan prints nothing"

sed 's/^[a-z]* //' "$TMP/expected.plan" > "$TMP/expected.ls"
run ls --store "file://$TMP/store" --host alpha > "$TMP/actual.ls"
diff "$TMP/expected.ls" "$TMP/actual.ls"
step "ls --host alpha lists the uploaded paths"

if grep -rn --exclude-dir=target -e '/Use''rs/' -e 'AK''IA' . \
   || grep -rnwF --exclude-dir=target -e "$(hostname)" -e "$(hostname -s)" -e "$(whoami)" .; then
  echo "fail: private string found" >&2
  exit 1
fi
step "no private strings"

if [ "$(uname -s)" = "Darwin" ]; then
  plutil -lint launchd/com.indexzero.dotsync.plist
  step "plutil -lint"
else
  step "skipped plutil -lint, not macOS"
fi
