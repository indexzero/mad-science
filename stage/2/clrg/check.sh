#!/usr/bin/env bash
# check.sh: the machine-checkable Done for clrg (INTENT.md "Done").
# Runs from any cwd; works in its own directory. Never reads ~/.claude.
#
# CLRG_STRICT=1 (the default) fails on a named test that is still #[ignore]d.
# CLRG_STRICT=0 only prints PENDING lines for them.
#
# P1 needs `rg` and `perl` (a portable timer). Its synthetic tree (~1.3 GB) is
# built once by crates/clrg-benchgen and cached under target/clrg-bench/.
set -euo pipefail
cd "$(dirname "$0")"

CLRG_STRICT="${CLRG_STRICT:-1}"
TARGET_DIR="${CARGO_TARGET_DIR:-target}"
LOG_DIR="$TARGET_DIR/check"
mkdir -p "$LOG_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

passed=0
failed=0
failures=()

# Step bodies run inside `if`, where set -e is off, so each one checks its own
# commands with `|| return 1`.
# step <name> <command...>: run quietly, print one PASS/FAIL line. On failure,
# show the tail of the step's log. Never stops early, so every step reports.
step() {
  local name="$1"
  shift
  local log="$LOG_DIR/$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '_').log"
  if "$@" >"$log" 2>&1; then
    printf 'PASS  %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'FAIL  %s  (log: %s)\n' "$name" "$log"
    tail -n 40 "$log" | sed 's/^/      /'
    failed=$((failed + 1))
    failures+=("$name")
  fi
}

have_usage() {
  if ! command -v usage >/dev/null 2>&1; then
    echo "the 'usage' CLI is not on PATH (https://usage.jdx.dev); it is required"
    return 1
  fi
}

# The named tests, read from INTENT.md "Done" item 3 so the list has one home,
# plus the regression tests below that are held to the same bar.
EXTRA_NAMED_TESTS="g12_header_cwd_is_launch_folder"
# Done item 3 lists this many (g1-g11, s1-s2, f1, n1, r1, l1-l2, a1-a6, c1).
INTENT_NAMED_TESTS=25

intent_named_tests() {
  awk '/^3\. These named tests/{on=1; next} /^4\. /{on=0} on' INTENT.md \
    | sed -nE 's/^ +- `([a-z0-9_]+)`.*/\1/p'
}

# INTENT.md "Build 2 Done (added to check.sh)" lists this many (w1-w2,
# fl1-fl4, x1-x8).
BUILD2_NAMED_TESTS=14
# INTENT.md "Revision 2026-10-23: build 2 review" lists this many new names
# (w3-w4, fl5-fl7, x9-x14, a7-a8).
REVIEW_NAMED_TESTS=13
# Slice 8 built the search gap and `files`; slice 9 built `extract`. Slice
# 10a fixed search and agreement (w3-w4, a7-a8); slice 10b fixed evidence and
# extract (fl5-fl7, x9-x14). Every name is required: nothing is deferred.

build2_named_tests() {
  awk '/^### Build 2 Done/{on=1; next} /^(Also:|## )/{on=0} on' INTENT.md \
    | sed -nE 's/^- `([a-z0-9_]+)`.*/\1/p'
}

review_named_tests() {
  awk '/^\*\*New named tests/{on=1; next} /^## /{on=0} on' INTENT.md \
    | sed -nE 's/^- `([a-z0-9_]+)`.*/\1/p'
}

named_tests() {
  intent_named_tests
  build2_named_tests
  review_named_tests
  printf '%s\n' $EXTRA_NAMED_TESTS
}

usage_md_fresh() {
  have_usage || return 1
  usage generate md -f clrg-cli.kdl --out-file "$TMP/USAGE.md" >/dev/null || return 1
  diff -u USAGE.md "$TMP/USAGE.md"
}

# The parity test skips (and passes) without `usage`; this step makes the
# missing tool a failure and runs the test by name so it shows up here.
parity() {
  have_usage || return 1
  cargo test -q -p clrg --bin clrg parity_tests:: -- --nocapture 2>&1 | tee "$TMP/parity.log" || return 1
  ! grep -q 'SKIP spec/clap parity' "$TMP/parity.log"
}

named_listed() {
  cargo test -q -- --list 2>/dev/null >"$TMP/list.txt" || return 1
  local missing=0 n
  n="$(intent_named_tests | wc -l | tr -d ' ')"
  if [ "$n" -ne "$INTENT_NAMED_TESTS" ]; then
    echo "expected $INTENT_NAMED_TESTS named tests in INTENT.md, parsed $n"
    return 1
  fi
  n="$(build2_named_tests | wc -l | tr -d ' ')"
  if [ "$n" -ne "$BUILD2_NAMED_TESTS" ]; then
    echo "expected $BUILD2_NAMED_TESTS Build 2 named tests in INTENT.md, parsed $n"
    return 1
  fi
  n="$(review_named_tests | wc -l | tr -d ' ')"
  if [ "$n" -ne "$REVIEW_NAMED_TESTS" ]; then
    echo "expected $REVIEW_NAMED_TESTS build 2 review named tests in INTENT.md, parsed $n"
    return 1
  fi
  for t in $(named_tests); do
    if ! grep -qE "(^|::)$t: test\$" "$TMP/list.txt"; then
      echo "missing named test: $t"
      missing=1
    fi
  done
  return "$missing"
}

named_not_ignored() {
  cargo test -q -- --list --ignored 2>/dev/null >"$TMP/ignored.txt" || return 1
  local pending=0
  for t in $(named_tests); do
    if grep -qE "(^|::)$t: test\$" "$TMP/ignored.txt"; then
      echo "PENDING: $t"
      pending=$((pending + 1))
    fi
  done
  echo "$pending named test(s) still ignored (CLRG_STRICT=$CLRG_STRICT)"
  if [ "$CLRG_STRICT" = "1" ] && [ "$pending" -gt 0 ]; then return 1; fi
}

# Files that are or will be committed: git's view when available, else a walk.
project_files() {
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git ls-files --cached --others --exclude-standard -- .
  else
    find . -type f -not -path './target/*' -not -path './.git/*' | sed 's|^\./||'
  fi
}

no_private_data() {
  local bad=0 me host uuid
  me="$(whoami)"
  host="$(hostname -s)"
  uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  project_files | grep -v '^target/' >"$TMP/files.txt" || return 1
  # Absolute home paths (split so this file does not match itself).
  if xargs grep -nE -e '/Use''rs/' -e '/ho''me/[a-z]' <"$TMP/files.txt"; then bad=1; fi
  # This machine's user and host names.
  if xargs grep -nwF -e "$me" -e "$host" <"$TMP/files.txt"; then bad=1; fi
  # Session ids: no UUID outside the synthetic fixtures.
  if grep -v '^crates/[^/]*/tests/fixtures/' "$TMP/files.txt" | grep -v '^Cargo.lock$' \
    | xargs grep -nE "$uuid"; then bad=1; fi
  return "$bad"
}

# best_of <n> <cmd...>: the best wall time in seconds of n runs, with the
# command's stdout and stderr (clrg's agreement count line) to /dev/null. A run
# must exit 0. The time goes to stdout through a saved handle.
best_of() {
  perl -MTime::HiRes=time -e '
    my $n = shift; my $best = 9e9;
    open(my $report, ">&", \*STDOUT) or die "dup: $!";
    open(STDOUT, ">", "/dev/null") or die "stdout: $!";
    open(my $err, ">&", \*STDERR) or die "dup: $!";
    open(STDERR, ">", "/dev/null") or die "stderr: $!";
    for (1 .. $n) {
      my $t = time;
      if (system(@ARGV) != 0) { print $err "failed ($?): @ARGV\n"; exit 1 }
      my $d = time - $t; $best = $d if $d < $best;
    }
    printf $report "%.4f\n", $best;' "$@"
}

# INTENT.md Done 4: on a warm cache, `clrg grep <rare literal>` (default human
# output) takes at most 1.5x `rg -l -uu -i` on the same synthetic tree, best
# of 5. The -l ratio is printed too.
p1_speed() {
  local tool
  for tool in rg perl; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "P1: FAIL: '$tool' is not on PATH; the speed gate needs it"
      return 1
    fi
  done
  cargo build --release -q -p clrg -p clrg-benchgen || return 1
  local gen root needle planted found clrg t_rg t_l t_human
  gen="$("$TARGET_DIR/release/clrg-benchgen" "$TARGET_DIR/clrg-bench")" || return 1
  root="$(printf '%s\n' "$gen" | sed -n 's/^root=//p')"
  needle="$(printf '%s\n' "$gen" | sed -n 's/^needle=//p')"
  planted="$(printf '%s\n' "$gen" | sed -n 's/^planted=//p')"
  echo "tree: $root ($(du -sk "$root" | cut -f1) KiB), needle: $needle"
  # Sanity: rg sees exactly the planted lines, and clrg -l the same files.
  found="$(rg -c -uu -i --no-filename -- "$needle" "$root" | awk '{s += $1} END {print s + 0}')"
  if [ "$found" != "$planted" ]; then
    echo "P1: FAIL: expected $planted planted lines, rg found $found"
    return 1
  fi
  clrg="$TARGET_DIR/release/clrg"
  # Warm the cache: one untimed run of each.
  rg -l -uu -i -- "$needle" "$root" | sort >"$TMP/p1-rg.txt"
  "$clrg" -r "$root" grep -l -- "$needle" | sort >"$TMP/p1-clrg.txt" || return 1
  "$clrg" -r "$root" grep -- "$needle" >/dev/null || return 1
  diff -u "$TMP/p1-rg.txt" "$TMP/p1-clrg.txt" || return 1
  t_rg="$(best_of 5 rg -l -uu -i -- "$needle" "$root")" || return 1
  t_l="$(best_of 5 "$clrg" -r "$root" grep -l -- "$needle")" || return 1
  t_human="$(best_of 5 "$clrg" -r "$root" grep -- "$needle")" || return 1
  awk -v rg="$t_rg" -v l="$t_l" -v h="$t_human" 'BEGIN {
    printf "P1: rg -l -uu -i %.3fs; clrg grep -l %.3fs (%.2fx); clrg grep %.3fs (%.2fx, limit 1.50x)\n",
      rg, l, l / rg, h, h / rg
    exit !(h <= 1.5 * rg)
  }'
}

step "cargo fmt --check" cargo fmt --all --check
step "cargo clippy -D warnings" cargo clippy --all-targets -- -D warnings
step "cargo build" cargo build
step "cargo test" cargo test
usage_lint() {
  have_usage || return 1
  usage lint clrg-cli.kdl
}

step "usage lint clrg-cli.kdl" usage_lint
step "USAGE.md is fresh" usage_md_fresh
step "spec/clap parity" parity
step "named tests listed" named_listed
step "named tests not ignored" named_not_ignored
grep '^PENDING: ' "$LOG_DIR/named_tests_not_ignored.log" || true
step "no home paths or real data" no_private_data
step "P1 speed" p1_speed
grep '^P1: ' "$LOG_DIR/P1_speed.log" || true

echo
if [ "$failed" -eq 0 ]; then
  echo "check.sh: PASS ($passed steps)"
else
  echo "check.sh: FAIL ($failed of $((passed + failed)) steps: ${failures[*]})"
  exit 1
fi
