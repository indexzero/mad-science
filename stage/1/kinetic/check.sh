#!/usr/bin/env bash
# kinetic: the machine-checkable Done. `bash check.sh` from any directory.
# Steps, in order: a tool check, install, browser install, schema validation, unit tests, the font grep,
# the Playwright suite headless, and a clean tree. Each step prints its command and its exit code.
# The script exits 0 only when every step passes. PORT (default 4173) is the port of the player server.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
export PORT="${PORT:-4173}"
START=$SECONDS

total() {
  local s=$((SECONDS - START))
  printf 'total: %dm %02ds (%d s)\n' $((s / 60)) $((s % 60)) "$s"
}

fail() {
  echo "FAIL: $1"
  total
  exit 1
}

# step <id> <command> [<runner>]: print the command, run it (or the runner that checks its output), print the
# exit code, and stop on a failure.
step() {
  local id="$1" cmd="$2" run="${3:-$2}" rc=0
  echo "==> [$id] $cmd"
  if eval "$run"; then rc=0; else rc=$?; fi
  echo "<== [$id] exit $rc"
  [ "$rc" -eq 0 ] || fail "step $id: $cmd"
}

# a. tool check: a missing tool fails fast with its name
for tool in node pnpm mutool ffmpeg pdftocairo git; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing tool: $tool"
done
step a1 'node --version'
step a2 'pnpm --version'
step a3 'mutool -v'
step a4 'ffmpeg -version | head -1'
step a5 'pdftocairo -v'

# b. dependencies from the lockfile
step b 'pnpm install --frozen-lockfile'

# c. the Playwright browser (a no-op when the build is cached)
step c 'pnpm exec playwright install chromium'

# d. deck.json against the schema, 71 slides, source.path on every element
step d 'pnpm validate'

# e. unit tests, with the media budget test and the font-extension schema tests
step e 'pnpm test'

# f. no font file in the tree outside node_modules and the converter cache
FONT_FIND="find . -type f \\( -iname '*.ttf' -o -iname '*.otf' -o -iname '*.woff' -o -iname '*.woff2' -o -iname '*.cff' \\) -not -path './node_modules/*' -not -path './.cache/*'"
font_grep() {
  local hits
  hits="$(eval "$FONT_FIND")"
  [ -z "$hits" ] || { echo "$hits"; return 1; }
  echo "(no output)"
}
step f "$FONT_FIND" font_grep

# g. the Playwright suite, headless: all 71 captures, the preload under throttling, the fonts spec
step g 'pnpm e2e'

# h. the suite left no tracked file modified and no untracked file outside the ignore rules
clean_tree() {
  local changes
  changes="$(git status --porcelain -- .)"
  [ -z "$changes" ] || { echo "$changes"; return 1; }
  echo "(no output)"
}
step h 'git status --porcelain -- .' clean_tree

echo "PASS: every step exited 0"
total
