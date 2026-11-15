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
# --force, any short-flag cluster containing f (-f, -uf), or a +refspec. --force-with-lease is allowed.
if grep -Eq 'git[[:space:]]+push[^|;&]*[[:space:]](--force([[:space:]=]|$)|-[a-zA-Z]*f[a-zA-Z]*([[:space:]]|$)|\+[^[:space:]])' <<<"$cmd"; then
  pre_tool_decision deny "Force push is not allowed. Use --force-with-lease on your own branch after asking the user."
  exit 0
fi
# main as a destination: `origin main`, `HEAD:main`, `refs/heads/main`.
if grep -Eq 'git[[:space:]]+push[^|;&]*[[:space:]:/](main|master)([[:space:]]|$)' <<<"$cmd"; then
  pre_tool_decision deny "Do not push to main directly; open a pull request."
  exit 0
fi
# A push without a refspec (`git push`, `git push -u origin`) pushes the current branch.
push_args=$(grep -Eo 'git[[:space:]]+push([[:space:]]+[^|;&[:space:]]+)*' <<<"$cmd" | head -n1 || true)
if [ -n "$push_args" ]; then
  positional=$(tr -s '[:space:]' '\n' <<<"$push_args" | tail -n +3 | grep -cv '^-' || true)
  branch=$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  if [ "$positional" -le 1 ] && { [ "$branch" = main ] || [ "$branch" = master ]; }; then
    pre_tool_decision deny "You are on $branch: this push would update it directly. Create a branch and open a pull request."
    exit 0
  fi
fi
# Shell writes to protected paths (the Edit/Write variant is handled by protect-paths.sh).
# The write operator must target the path directly, so mentioning a path in a commit message or
# redirecting stderr elsewhere does not trip it. A guard rail, not a sandbox.
writes_to() { # $1 = path regex, $2 = command text (default: $cmd)
  local verb='(^|[[:space:];&|(])'
  grep -Eq "(>>?[[:space:]]*|${verb}tee[[:space:]]+(-a[[:space:]]+)?|${verb}(sed|perl)[[:space:]]+-[a-zA-Z]*i[^|;&]*|${verb}(cp|mv|rm|truncate)[[:space:]][^|;&]*)[^[:space:]|;&<>]*$1" <<<"${2:-$cmd}"
}
# No exception for --update-baseline: the eval CLI writes baselines from Node, never via the shell.
if writes_to 'evals/baselines'; then
  pre_tool_decision deny "Eval baselines are only written by \`pnpm eval:live --update-baseline\` after a human accepts the run."
  exit 0
fi
# Same scope as protect-paths.sh: .env and every .env.*, except the committed .env.example.
if writes_to '\.env(\.[A-Za-z0-9_-]+)*([[:space:];&|)<>]|$)' "${cmd//.env.example/__env_example__}"; then
  pre_tool_decision deny "Secrets files are off limits. Ask the user to edit .env."
  exit 0
fi
# shellcheck disable=SC2016 # literal \$HOME in the pattern is intended
if grep -Eq 'rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f?[[:space:]]+(/|~|\$HOME|\.|\*)([[:space:]]|$)' <<<"$cmd"; then
  pre_tool_decision deny "Refusing a recursive delete of a root, home or whole working directory."
  exit 0
fi
exit 0
