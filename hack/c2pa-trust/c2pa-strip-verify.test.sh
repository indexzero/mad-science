#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$ROOT/c2pa-strip-verify.sh"
PASS=0

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail "expected file: $1"
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "expected '$2' in: $1" ;;
  esac
}

run_case() {
  local name=$1
  shift
  "$@" || fail "$name"
  PASS=$((PASS + 1))
  printf 'ok %d - %s\n' "$PASS" "$name"
}

setup_case() {
  CASE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/c2pa-strip-test.XXXXXX")
  BIN_DIR="$CASE_DIR/bin"
  LOG="$CASE_DIR/calls.log"
  mkdir "$BIN_DIR"
  : > "$LOG"

  printf 'signed pixels' > "$CASE_DIR/input.png"

  cat > "$BIN_DIR/exiftool" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'exiftool %s\n' "$*" >> "$CALL_LOG"
out=''
input=''
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2 ;;
    -*) shift ;;
    *) input=$1; shift ;;
  esac
done
cp "$input" "$out"
EOF

  cat > "$BIN_DIR/magick" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'magick %s\n' "$*" >> "$CALL_LOG"
if [ "${1:-}" = identify ]; then
  input=${!#}
  case "$input" in
    *.png) printf 'PNG 120 80' ;;
    *.jpg|*.jpeg) printf 'JPEG 120 80' ;;
    *) printf 'UNKNOWN 120 80' ;;
  esac
  exit 0
fi
input=$1
output=${!#}
cp "$input" "$output"
EOF

  cat > "$BIN_DIR/node" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'node %s\n' "$*" >> "$CALL_LOG"
printf '%s\n' "${VERIFY_RESULT:-{\"status\":\"no-manifest\"}}"
exit "${VERIFY_EXIT:-0}"
EOF

  chmod +x "$BIN_DIR/exiftool" "$BIN_DIR/magick" "$BIN_DIR/node"
}

teardown_case() {
  rm -f "$CASE_DIR"/input.png "$CASE_DIR"/input.stripped.jpg "$CASE_DIR"/input.stripped.png
  rm -f "$BIN_DIR"/exiftool "$BIN_DIR"/magick "$BIN_DIR"/node "$LOG"
  rmdir "$BIN_DIR" "$CASE_DIR"
}

test_default_format_conversion() {
  setup_case
  PATH="$BIN_DIR:$PATH" CALL_LOG="$LOG" "$SCRIPT" "$CASE_DIR/input.png" >/dev/null

  assert_file "$CASE_DIR/input.stripped.jpg"
  calls=$(<"$LOG")
  assert_contains "$calls" 'exiftool -all= -o'
  assert_contains "$calls" 'magick identify -format %[magick] %[width] %[height]'
  assert_contains "$calls" '-background white -alpha remove -alpha off'
  [ "$(grep -c '^node ' "$LOG")" -eq 1 ] || fail 'verifier must run exactly once'
  teardown_case
}

test_selected_colorspace_transform() {
  setup_case
  PATH="$BIN_DIR:$PATH" CALL_LOG="$LOG" "$SCRIPT" \
    --transform colorspace "$CASE_DIR/input.png" >/dev/null

  assert_file "$CASE_DIR/input.stripped.png"
  calls=$(<"$LOG")
  assert_contains "$calls" '-colorspace Lab -colorspace sRGB'
  [ "$(grep -c '^node ' "$LOG")" -eq 1 ] || fail 'verifier must run exactly once'
  teardown_case
}

test_stops_after_recognition() {
  setup_case
  set +e
  PATH="$BIN_DIR:$PATH" CALL_LOG="$LOG" VERIFY_RESULT='{"status":"manifest-found"}' VERIFY_EXIT=3 \
    "$SCRIPT" "$CASE_DIR/input.png" >/dev/null 2>&1
  status=$?
  set -e

  [ "$status" -eq 3 ] || fail "expected recognized exit 3, got $status"
  [ "$(grep -c '^magick ' "$LOG")" -eq 2 ] || fail 'must not try another transform'
  [ "$(grep -c '^node ' "$LOG")" -eq 1 ] || fail 'must verify exactly once'
  teardown_case
}

test_rejects_unknown_transform() {
  setup_case
  set +e
  PATH="$BIN_DIR:$PATH" CALL_LOG="$LOG" "$SCRIPT" --transform nope "$CASE_DIR/input.png" >/dev/null 2>&1
  status=$?
  set -e

  [ "$status" -eq 2 ] || fail "expected usage exit 2, got $status"
  [ ! -s "$LOG" ] || fail 'invalid input must fail before invoking tools'
  teardown_case
}

run_case 'defaults PNG to one JPEG conversion' test_default_format_conversion
run_case 'supports one selected colorspace transform' test_selected_colorspace_transform
run_case 'stops after one recognized result' test_stops_after_recognition
run_case 'rejects an unknown transform' test_rejects_unknown_transform

printf '1..%d\n' "$PASS"
