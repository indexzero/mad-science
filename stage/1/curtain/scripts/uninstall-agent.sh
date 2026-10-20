#!/usr/bin/env bash
# Remove the curtain LaunchAgent. Design section 11.
#
# Usage: scripts/uninstall-agent.sh
#
# Unloads the agent, removes the plist, removes the binary directory.
# Leaves the logs and the defaults in place and prints how to remove
# them. Safe to run twice.
set -euo pipefail

label="family.curtain"
support_dir="$HOME/Library/Application Support/family.curtain"
bin_dir="$support_dir/bin"
log_dir="$HOME/Library/Logs/family.curtain"
plist="$HOME/Library/LaunchAgents/family.curtain.plist"

uid="$(id -u)"
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
rm -f "$plist"
rm -rf "$bin_dir"
rmdir "$support_dir" 2>/dev/null || true

cat <<NOTE
removed: $plist
removed: $bin_dir

Kept in place:
  logs:     $log_dir
  defaults: ~/Library/Preferences/family.curtain.plist
To remove them run:
  rm -rf "$log_dir"
  defaults delete family.curtain
The pmset wake schedule is separate: sudo pmset repeat cancel
NOTE
