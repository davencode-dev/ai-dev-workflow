#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bash -n "$ROOT/scripts/run-tasks.sh"
rg -q 'Compatibility alias' "$ROOT/scripts/run-tasks.sh"
echo 'legacy compatibility alias: PASS'
