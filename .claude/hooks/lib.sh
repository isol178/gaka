#!/usr/bin/env bash
# Shared helpers for Claude Code hooks. Hooks receive the event as JSON on stdin.
set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

# Path relative to the repo root ("" when outside it).
rel_path() {
  local p="$1"
  case "$p" in
    "$REPO_ROOT"/*) printf '%s' "${p#"$REPO_ROOT"/}" ;;
    /*) printf '' ;;
    *) printf '%s' "$p" ;;
  esac
}

pre_tool_decision() { # $1=allow|deny|ask $2=reason
  jq -n --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}}'
}
