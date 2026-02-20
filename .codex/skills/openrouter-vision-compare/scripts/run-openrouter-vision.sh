#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [[ -z "${UI_VISION_MODEL:-}" ]]; then
  export UI_VISION_MODEL="google/gemini-3-flash-preview"
fi

cd "$ROOT_DIR"
node "$ROOT_DIR/.codex/skills/openrouter-vision-compare/scripts/ui-vision-openrouter.mjs" "$@"
