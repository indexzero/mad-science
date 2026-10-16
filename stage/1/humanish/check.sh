#!/bin/sh
set -eu

cd "$(dirname "$0")"

swift test
node --test web/test/*.test.js

echo "humanish checks passed"
