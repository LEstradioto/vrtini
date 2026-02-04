#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <iterations> [prompt_file]"
  echo "Example: $0 50 ./codex-prompt.txt"
  exit 1
fi

ITERATIONS="$1"
PROMPT_FILE="${2:-}"

if [ -n "$PROMPT_FILE" ] && [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

# Default: full-auto (workspace-write + on-request approvals).
# Override with CODEX_ARGS if needed.
# Example:
#   CODEX_ARGS="--sandbox workspace-write --add-dir $HOME/dev/project"
CODEX_ARGS="${CODEX_ARGS:---full-auto}"

LOG_FILE="${CODEX_LOG_FILE:-codex-loop.log}"

for ((i=1; i<=ITERATIONS; i++)); do
  echo "=== Iteration $i/$ITERATIONS ===" | tee -a "$LOG_FILE"

  if [ -n "$PROMPT_FILE" ]; then
    PROMPT="$(cat "$PROMPT_FILE")"
  else
    PROMPT='@PRD.md @progress.txt
1. Find the highest-priority task and implement it.
2. Run tests/typecheck if relevant.
3. Update PRD.md with what was done.
4. Append progress to progress.txt.
ONLY WORK ON A SINGLE TASK.
If PRD is complete, output <promise>COMPLETE</promise>.'
  fi

  RESULT=$(printf '%s' "$PROMPT" | codex exec $CODEX_ARGS - 2>&1 || echo "__CODEX_ERROR__")

  echo "$RESULT" | tee -a "$LOG_FILE"

  if [[ "$RESULT" == *"__CODEX_ERROR__"* ]]; then
    echo "Codex error in iteration $i; see log for details." | tee -a "$LOG_FILE"
  elif command -v rg >/dev/null 2>&1; then
    if printf '%s\n' "$RESULT" | rg -xq "<promise>COMPLETE</promise>"; then
      echo "PRD complete after $i iterations." | tee -a "$LOG_FILE"
      exit 0
    fi
  elif printf '%s\n' "$RESULT" | grep -xq "<promise>COMPLETE</promise>"; then
    echo "PRD complete after $i iterations." | tee -a "$LOG_FILE"
    exit 0
  fi

done

exit 0
