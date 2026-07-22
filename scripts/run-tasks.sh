#!/usr/bin/env bash
set -euo pipefail

# Compatibility alias. Common TypeScript runner owns all task lifecycle behavior.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec npm --prefix "$ROOT" run tasks -- --agent codex "$@"
