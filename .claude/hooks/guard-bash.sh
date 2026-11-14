#!/usr/bin/env bash
# PreToolUse(Bash): block commands that bypass the repo's safety nets.
# shellcheck source=lib.sh
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
# Shell writes to protected paths (the Edit/Write variant is handled by protect-paths.sh).
# The write operator must target the path directly, so mentioning a path in a commit message or
# redirecting stderr elsewhere does not trip it. A guard rail, not a sandbox.
writes_to() { # $1 = path regex
  local verb='(^|[[:space:];&|(])'
  grep -Eq "(>>?[[:space:]]*|${verb}tee[[:space:]]+(-a[[:space:]]+)?|${verb}(sed|perl)[[:space:]]+-[a-zA-Z]*i[^|;&]*|${verb}(cp|mv|rm|truncate)[[:space:]][^|;&]*)[^[:space:]|;&<>]*$1" <<<"$cmd"
}
if writes_to 'evals/baselines' && ! grep -Eq -- '--update-baseline' <<<"$cmd"; then
  pre_tool_decision deny "Eval baselines are only written by \`pnpm eval:live --update-baseline\` after a human accepts the run."
  exit 0
fi
if writes_to '\.env(\.local|\.[a-z]+\.local)?([[:space:]]|$)'; then
  pre_tool_decision deny "Secrets files are off limits. Ask the user to edit .env."
  exit 0
fi
# shellcheck disable=SC2016 # literal \$HOME in the pattern is intended
if grep -Eq 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f?[[:space:]]+(/|~|\$HOME|\.|\*)([[:space:]]|$)' <<<"$cmd"; then
  pre_tool_decision deny "Refusing a recursive delete of a root, home or whole working directory."
  exit 0
fi
exit 0
