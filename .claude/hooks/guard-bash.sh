#!/usr/bin/env bash
# PreToolUse(Bash): block commands that bypass the repo's safety nets.
source "$(dirname "$0")/lib.sh"

cmd=$(jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0

if grep -Eq 'git[[:space:]]+(commit|push|merge|rebase)[^|;&]*--no-verify' <<<"$cmd" ||
  grep -Eq '(^|[[:space:];&|])LEFTHOOK=0' <<<"$cmd"; then
  pre_tool_decision deny "Git hooks (lint, commitlint, pnpm check) must not be skipped. Fix the failure instead."
  exit 0
fi
if grep -Eq 'git[[:space:]]+push[^|;&]*(--force([[:space:]]|$)|[[:space:]]-f([[:space:]]|$))' <<<"$cmd"; then
  pre_tool_decision deny "Force push is not allowed. Use --force-with-lease on your own branch after asking the user."
  exit 0
fi
if grep -Eq 'git[[:space:]]+push[^|;&]*[[:space:]](origin[[:space:]]+)?(main|master)([[:space:]]|$)' <<<"$cmd"; then
  pre_tool_decision deny "Do not push to main directly; open a pull request."
  exit 0
fi
if grep -Eq 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f?[[:space:]]+(/|~|\$HOME|\.|\*)([[:space:]]|$)' <<<"$cmd"; then
  pre_tool_decision deny "Refusing a recursive delete of a root, home or whole working directory."
  exit 0
fi
exit 0
