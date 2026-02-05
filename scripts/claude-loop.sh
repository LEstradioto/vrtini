#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <iterations> [prompt_file]"
  echo "Example: $0 50 ./claude-prompt.txt"
  exit 1
fi

ITERATIONS="$1"
PROMPT_FILE="${2:-}"

if [ -n "$PROMPT_FILE" ] && [ ! -f "$PROMPT_FILE" ]; then
  echo "Prompt file not found: $PROMPT_FILE"
  exit 1
fi

# Default: dangerously skip permissions for full autonomy.
# Override with CLAUDE_ARGS if needed.
# Example:
#   CLAUDE_ARGS="--allowedTools Edit,Write,Bash --model sonnet"
CLAUDE_ARGS="${CLAUDE_ARGS:---dangerously-skip-permissions}"

LOG_FILE="${CLAUDE_LOG_FILE:-claude-loop.log}"

for ((i=1; i<=ITERATIONS; i++)); do
  echo "=== Iteration $i/$ITERATIONS ===" | tee -a "$LOG_FILE"

  if [ -n "$PROMPT_FILE" ]; then
    PROMPT="$(cat "$PROMPT_FILE")"
  else
    PROMPT='Read PRD.md and progress.txt, then:
1. Find the highest-priority unchecked task and implement it.
2. Run tests/typecheck if relevant.
3. Mark the task done in progress.txt ([ ] -> [x]).
4. If a task is partially done, mark it [~] and note what remains.
ONLY WORK ON A SINGLE TASK.
If all tasks are complete, output EXACTLY this line and nothing else: <promise>COMPLETE</promise>'
  fi

  RESULT=$(claude -p "$PROMPT" --verbose $CLAUDE_ARGS 2>&1 || echo "__CLAUDE_ERROR__")

  echo "$RESULT" | tee -a "$LOG_FILE"

  if [[ "$RESULT" == *"__CLAUDE_ERROR__"* ]]; then
    echo "Claude error in iteration $i; see log for details." | tee -a "$LOG_FILE"
  elif command -v rg >/dev/null 2>&1; then
    if printf '%s\n' "$RESULT" | rg -q "<promise>COMPLETE</promise>"; then
      echo "PRD complete after $i iterations." | tee -a "$LOG_FILE"
      exit 0
    fi
  elif printf '%s\n' "$RESULT" | grep -q "<promise>COMPLETE</promise>"; then
    echo "PRD complete after $i iterations." | tee -a "$LOG_FILE"
    exit 0
  fi

done

exit 0
