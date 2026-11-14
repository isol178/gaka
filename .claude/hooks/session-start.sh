#!/usr/bin/env bash
# SessionStart: give Claude a short snapshot of the workspace (stdout becomes context).
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 0

branch=$(git branch --show-current 2>/dev/null || echo "?")
dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "Gaka workspace: branch=$branch, uncommitted files=$dirty."
[ "$branch" = "main" ] && echo "You are on main: create a branch before committing."

missing=()
[ -d node_modules ] || missing+=("node_modules")
[ -d observer/.venv ] || missing+=("observer/.venv")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Dependencies missing (${missing[*]}): run \`pnpm bootstrap\` before tests or evals."
fi
echo "Verify with \`pnpm check\` (full) or \`pnpm check:fast\`; offline evals: \`pnpm eval:offline\`. Live evals and \`pnpm gaka paint\` cost money: ask first."
exit 0
