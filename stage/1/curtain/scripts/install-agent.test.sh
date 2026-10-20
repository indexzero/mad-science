#!/usr/bin/env bash
# Test install-agent.sh --print. Design section 11.
#
# Sets HOME to CURTAIN_TEST_HOME if set, else to a mktemp directory. Runs
# install-agent.sh --print and compares the output with the template
# rendered here. Asserts the key fields. Asserts that --print created
# nothing under the test HOME. Never calls launchctl: a shim on PATH
# fails the test if the script calls it.
#
# Exit 0 on pass. Exit 1 on fail, with the diff.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
install="$script_dir/install-agent.sh"
template="$script_dir/family.curtain.plist.template"

made_home=0
if [[ -n "${CURTAIN_TEST_HOME:-}" ]]; then
  test_home="$CURTAIN_TEST_HOME"
  mkdir -p "$test_home"
else
  test_home="$(mktemp -d)"
  made_home=1
fi

# A launchctl shim. Any call records a marker and fails.
shim_dir="$(mktemp -d)"
marker="$shim_dir/launchctl.called"
cat > "$shim_dir/launchctl" <<SHIM
#!/bin/sh
echo "launchctl \$*" >> "$marker"
exit 1
SHIM
chmod 755 "$shim_dir/launchctl"

# shellcheck disable=SC2329  # invoked by the trap below
cleanup() {
  rm -rf "$shim_dir"
  if [[ "$made_home" -eq 1 ]]; then rm -rf "$test_home"; fi
}
trap cleanup EXIT

failures=0
fail() {
  echo "FAIL: $1" >&2
  failures=$((failures + 1))
}
pass_count=0
ok() {
  pass_count=$((pass_count + 1))
}

expected_binary="$test_home/Library/Application Support/family.curtain/bin/curtain"
expected_out="$test_home/Library/Logs/family.curtain/curtain.out.log"
expected_err="$test_home/Library/Logs/family.curtain/curtain.err.log"

# Render the expected text from the template with the same two
# substitutions the script documents. See install-agent.sh for the shopt.
shopt -u patsub_replacement 2>/dev/null || true
expected=""
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line//@BINARY@/$expected_binary}"
  line="${line//@HOME@/$test_home}"
  expected+="$line"$'\n'
done < "$template"

before="$(cd "$test_home" && find . | LC_ALL=C sort)"

set +e
rendered="$(HOME="$test_home" PATH="$shim_dir:$PATH" bash "$install" --print)"
status=$?
set -e
rendered+=$'\n'

after="$(cd "$test_home" && find . | LC_ALL=C sort)"

# 1. Exit status.
if [[ "$status" -eq 0 ]]; then ok; else fail "--print exited $status, expected 0"; fi

# 2. Whole-text comparison with the diff on failure.
if [[ "$rendered" == "$expected" ]]; then
  ok
else
  fail "rendered plist differs from the template with placeholders substituted"
  diff <(printf '%s' "$expected") <(printf '%s' "$rendered") >&2 || true
fi

# 3. ProgramArguments: starts with the test HOME, ends with /bin/curtain.
program="$(printf '%s' "$rendered" | /usr/bin/sed -n 's|^ *<array><string>\(.*\)</string></array>$|\1|p')"
if [[ -n "$program" && "$program" == "$test_home"/* && "$program" == */bin/curtain ]]; then
  ok
else
  fail "ProgramArguments is '$program', expected '$test_home/.../bin/curtain'"
fi

# 4. Label.
if printf '%s' "$rendered" | /usr/bin/grep -q '^ *<key>Label</key><string>family.curtain</string>$'; then
  ok
else
  fail "Label is not family.curtain"
fi

# 5. RunAtLoad and KeepAlive are true.
if printf '%s' "$rendered" | /usr/bin/grep -q '^ *<key>RunAtLoad</key><true/>$'; then ok; else fail "RunAtLoad is not true"; fi
if printf '%s' "$rendered" | /usr/bin/grep -q '^ *<key>KeepAlive</key><true/>$'; then ok; else fail "KeepAlive is not true"; fi

# 6. Log paths start with the test HOME.
if printf '%s' "$rendered" | /usr/bin/grep -q -F "<key>StandardOutPath</key><string>$expected_out</string>"; then
  ok
else
  fail "StandardOutPath does not start with the test HOME"
fi
if printf '%s' "$rendered" | /usr/bin/grep -q -F "<key>StandardErrorPath</key><string>$expected_err</string>"; then
  ok
else
  fail "StandardErrorPath does not start with the test HOME"
fi

# 7. No placeholder survives.
if printf '%s' "$rendered" | /usr/bin/grep -q '@BINARY@\|@HOME@'; then
  fail "a placeholder survived in the rendered plist"
else
  ok
fi

# 8. Nothing was created under the test HOME.
if [[ "$before" == "$after" ]]; then
  ok
else
  fail "--print changed the test HOME"
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
fi

# 9. launchctl was never called.
if [[ -e "$marker" ]]; then
  fail "--print called launchctl: $(/bin/cat "$marker")"
else
  ok
fi

if [[ "$failures" -eq 0 ]]; then
  echo "install-agent.test.sh: PASS ($pass_count assertions, HOME=$test_home)"
  exit 0
fi
echo "install-agent.test.sh: FAIL ($failures of $((pass_count + failures)) assertions)" >&2
exit 1
