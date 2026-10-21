#!/bin/sh
# check.sh: the machine-checkable Done for stage/1/save-it.
set -eu
cd "$(dirname "$0")"
pnpm install --frozen-lockfile
echo "ok: install"
pnpm test
echo "ok: test"
pnpm wrangler deploy --dry-run --outdir dist/worker
echo "ok: dry-run"
pnpm skill:pack example.invalid
echo "ok: skill:pack"
first="$(unzip -Z1 dist/save-it.zip | head -1)"
if [ "$first" != "save-it/" ]; then
  echo "zip root is '$first', expected 'save-it/'"
  exit 1
fi
if unzip -Z1 dist/save-it.zip | grep -v '^save-it/'; then
  echo "zip has entries outside 'save-it/'"
  exit 1
fi
echo "ok: zip-root"
