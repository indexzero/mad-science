#!/bin/sh
# vendor.sh: put a pinned brave/go-sync at ./vendor/go-sync, then lay our overlay on it.
#
# go-sync is Brave's sync server. We use it only as a dev server to test our
# custom sync client. We never self-host it for real data.
#
# Pin: master, not the newest tag. The newest tag, v0.1.21, is from 2023-09.
# Brave's production servers track master, and master has two years of
# protocol updates since that tag. Pinned to master as of 2026-10-20.
#
# Behavior:
#   - No checkout yet: clone, then check out the pinned sha.
#   - Checkout exists: never delete or reset it. Warn if HEAD is not the pin.
#   - Always: apply ./go-sync-overlay/go-sync.patch, once. If it reverse-applies
#     cleanly it is already applied, so skip it. If it neither reverse-applies
#     nor applies cleanly, fail loudly and change nothing.
#   - Always: copy ./go-sync-overlay/ over the checkout (no deletes). Copy, not
#     symlink, because docker build contexts do not follow symlinks.
set -eu

GO_SYNC_REPO="https://github.com/brave/go-sync.git"
GO_SYNC_SHA="ca8d4e1e60faec3cbfac295b0c4d81eb463bccdf"

here=$(cd "$(dirname "$0")/.." && pwd)
dest="$here/vendor/go-sync"
overlay="$here/go-sync-overlay"
patch="$overlay/go-sync.patch"

if [ -d "$dest/.git" ]; then
  head=$(git -C "$dest" rev-parse HEAD)
  if [ "$head" != "$GO_SYNC_SHA" ]; then
    echo "vendor.sh: warning: $dest is at $head, not the pin $GO_SYNC_SHA." >&2
    echo "vendor.sh: left as is. Remove the directory to re-vendor at the pin." >&2
  else
    echo "vendor.sh: $dest is already at the pin."
  fi
else
  mkdir -p "$here/vendor"
  git clone --quiet --filter=blob:none "$GO_SYNC_REPO" "$dest"
  git -C "$dest" -c advice.detachedHead=false checkout --quiet "$GO_SYNC_SHA"
  echo "vendor.sh: cloned go-sync at $GO_SYNC_SHA."
fi

if [ -f "$patch" ]; then
  if git -C "$dest" apply --reverse --check "$patch" 2>/dev/null; then
    echo "vendor.sh: go-sync.patch is already applied."
  elif git -C "$dest" apply --check "$patch"; then
    git -C "$dest" apply "$patch"
    echo "vendor.sh: applied go-sync.patch."
  else
    echo "vendor.sh: error: go-sync.patch does not apply cleanly to $dest." >&2
    echo "vendor.sh: the checkout was left as is. Fix the patch or the checkout by hand." >&2
    exit 1
  fi
fi

if [ -d "$overlay" ]; then
  # Copy files only. Keep vendor files the overlay does not name.
  (cd "$overlay" && find . -type f ! -name '.gitkeep' ! -name 'README.md' ! -name 'go-sync.patch' -print) | while read -r f; do
    mkdir -p "$dest/$(dirname "$f")"
    cp "$overlay/$f" "$dest/$f"
    echo "vendor.sh: overlay $f"
  done
fi
