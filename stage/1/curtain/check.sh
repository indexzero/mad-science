#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
swift build -c release
swift test
bash scripts/install-agent.test.sh
