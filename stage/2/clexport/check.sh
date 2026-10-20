#!/usr/bin/env bash
# check.sh: the machine-checkable Done for clexport. Exits nonzero on the first failure.
set -euo pipefail
cd "$(dirname "$0")"
node --check clexport.js
echo "ok: node --check clexport.js"
if ! out="$(node --test "./test/*.test.mjs" 2>&1)"; then printf '%s\n' "$out"; exit 1; fi
echo "ok: node --test ./test/*.test.mjs"
for heading in '## Purpose' '## DevTools steps' '## Outputs' '## Hidden thinking fallback' '## Archived chats'; do
  grep -qx -- "$heading" README.md
  echo "ok: README.md has '$heading'"
done
