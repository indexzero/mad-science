#!/usr/bin/env bash
set -euo pipefail

PROGRAM=${0##*/}
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TRANSFORM=format
OUTPUT=''
FORCE=0
INPUT=''

usage() {
  cat <<EOF
Usage: $PROGRAM [options] INPUT

Strip embedded metadata, apply one image transform, then run one C2PA check.

Options:
  -t, --transform NAME  format (default), colorspace, recompress, or scale
  -o, --output FILE     output path (default: INPUT.stripped.<extension>)
  -f, --force           overwrite an existing output file
  -h, --help            show this help

Exit status:
  0  no C2PA manifest found
  2  invalid arguments or unavailable prerequisite
  3  a C2PA manifest was still found
  4  verification failed
EOF
}

die() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    -t|--transform)
      [ $# -ge 2 ] || die "$1 requires a value"
      TRANSFORM=$2
      shift 2
      ;;
    -o|--output)
      [ $# -ge 2 ] || die "$1 requires a value"
      OUTPUT=$2
      shift 2
      ;;
    -f|--force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      [ $# -eq 1 ] || die 'exactly one input file is required'
      INPUT=$1
      shift
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      [ -z "$INPUT" ] || die 'exactly one input file is required'
      INPUT=$1
      shift
      ;;
  esac
done

[ -n "$INPUT" ] || die 'an input file is required'
[ -f "$INPUT" ] || die "input is not a regular file: $INPUT"
[ -r "$INPUT" ] || die "input is not readable: $INPUT"

case "$TRANSFORM" in
  format|colorspace|recompress|scale) ;;
  *) die "unknown transform: $TRANSFORM" ;;
esac

command -v exiftool >/dev/null 2>&1 || die 'exiftool is required'
command -v magick >/dev/null 2>&1 || die 'ImageMagick 7 (magick) is required'
command -v node >/dev/null 2>&1 || die 'Node.js is required'

IDENTIFY=$(magick identify -format '%[magick] %[width] %[height]' "$INPUT")
read -r INPUT_FORMAT WIDTH HEIGHT <<< "$IDENTIFY"

case "$INPUT_FORMAT" in
  PNG)
    SOURCE_EXT=png
    FORMAT_EXT=jpg
    ;;
  JPEG)
    SOURCE_EXT=jpg
    FORMAT_EXT=png
    ;;
  *)
    die "unsupported input format: $INPUT_FORMAT (expected PNG or JPEG)"
    ;;
esac

INPUT_DIR=$(cd "$(dirname "$INPUT")" && pwd)
INPUT_NAME=$(basename "$INPUT")
INPUT_STEM=${INPUT_NAME%.*}

if [ -z "$OUTPUT" ]; then
  if [ "$TRANSFORM" = format ]; then
    OUTPUT="$INPUT_DIR/$INPUT_STEM.stripped.$FORMAT_EXT"
  else
    OUTPUT="$INPUT_DIR/$INPUT_STEM.stripped.$SOURCE_EXT"
  fi
fi

OUTPUT_DIR=$(dirname "$OUTPUT")
[ -d "$OUTPUT_DIR" ] || die "output directory does not exist: $OUTPUT_DIR"
[ "$INPUT_DIR/$INPUT_NAME" != "$(cd "$OUTPUT_DIR" && pwd)/$(basename "$OUTPUT")" ] || \
  die 'input and output paths must differ'

if [ -e "$OUTPUT" ] && [ "$FORCE" -ne 1 ]; then
  die "output already exists (use --force): $OUTPUT"
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/c2pa-strip.XXXXXX")
STRIPPED="$TMP_DIR/stripped.$SOURCE_EXT"

cleanup() {
  rm -f -- "$STRIPPED"
  rmdir "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ExifTool rewrites metadata containers without decoding the image payload.
exiftool -all= -o "$STRIPPED" "$INPUT" >/dev/null

case "$TRANSFORM" in
  format)
    if [ "$INPUT_FORMAT" = PNG ]; then
      magick "$STRIPPED" -background white -alpha remove -alpha off -quality 92 "$OUTPUT"
    else
      magick "$STRIPPED" "$OUTPUT"
    fi
    ;;
  colorspace)
    magick "$STRIPPED" -colorspace Lab -colorspace sRGB "$OUTPUT"
    ;;
  recompress)
    if [ "$INPUT_FORMAT" = PNG ]; then
      magick "$STRIPPED" -define png:compression-level=9 "$OUTPUT"
    else
      magick "$STRIPPED" -quality 90 "$OUTPUT"
    fi
    ;;
  scale)
    magick "$STRIPPED" -resize 99% -resize "${WIDTH}x${HEIGHT}!" "$OUTPUT"
    ;;
esac

printf 'output: %s\n' "$OUTPUT"
printf 'transform: %s\n' "$TRANSFORM"

# Exactly one verifier invocation. Its status is the command's final status.
node "$SCRIPT_DIR/verify.mjs" "$OUTPUT"
