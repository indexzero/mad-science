#!/usr/bin/env bash
# Install curtain as a per-user LaunchAgent. Design section 11.
#
# Usage: scripts/install-agent.sh [--print] [SOURCE_BINARY]
#
#   --print         Render the plist to stdout with the paths this script
#                   would use. Write nothing. Run no launchctl. Exit 0.
#   SOURCE_BINARY   The binary to copy. Default: .build/release/curtain
#                   in the package directory.
#
# Without --print the script makes three directories, copies the binary
# to a stable path, renders the plist, loads the agent, and prints the
# escape hatch reminder. Run it again after a rebuild. It is idempotent.
#
# Read README.md, section "Escape hatch", before you run this. Never run
# it on a Mac you cannot reach over SSH.
set -euo pipefail

package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$package_dir/scripts/family.curtain.plist.template"

print=0
source_binary="$package_dir/.build/release/curtain"
for arg in "$@"; do
  case "$arg" in
    --print) print=1 ;;
    -h|--help)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "install-agent.sh: unknown option $arg" >&2
      exit 2
      ;;
    *) source_binary="$arg" ;;
  esac
done

# The destination paths. @BINARY@ and @HOME@ render to these.
support_dir="$HOME/Library/Application Support/family.curtain"
bin_dir="$support_dir/bin"
binary="$bin_dir/curtain"
log_dir="$HOME/Library/Logs/family.curtain"
agents_dir="$HOME/Library/LaunchAgents"
plist="$agents_dir/family.curtain.plist"
label="family.curtain"

# Substitute the two placeholders line by line. patsub_replacement is
# turned off (bash 5.2 and newer) so that an ampersand in a path stays
# literal. bash 3.2 has no such option and never expands it.
shopt -u patsub_replacement 2>/dev/null || true
render() {
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//@BINARY@/$binary}"
    line="${line//@HOME@/$HOME}"
    printf '%s\n' "$line"
  done < "$template"
}

if [[ "$print" -eq 1 ]]; then
  render
  exit 0
fi

if [[ ! -f "$source_binary" ]]; then
  echo "install-agent.sh: no binary at $source_binary" >&2
  echo "install-agent.sh: run 'swift build -c release' first, or pass the path" >&2
  exit 1
fi

mkdir -p "$bin_dir" "$log_dir" "$agents_dir"
cp -f "$source_binary" "$binary"
chmod 755 "$binary"
render > "$plist"

uid="$(id -u)"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
launchctl bootstrap "gui/$uid" "$plist"

cat <<REMINDER
installed: $plist
binary:    $binary
logs:      $log_dir/curtain.out.log
           $log_dir/curtain.err.log

Escape hatch. From another machine over SSH run: pkill curtain
The agent restarts curtain. To stop that first run:
  launchctl bootout gui/$uid/$label
A debug build drops the input tap 60 seconds after install.

Grant Accessibility to $binary
in System Settings, Privacy & Security. Also Input Monitoring if the log
still says "tap unavailable". See README.md.
REMINDER
