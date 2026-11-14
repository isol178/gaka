#!/usr/bin/env bash
# Stop: if source files changed, run fast checks and unit tests before Claude ends its turn.
# A failure exits 2, which sends the output back to Claude to fix. stop_hook_active prevents
# an endless loop when the failure cannot be fixed in this turn.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0
cd "$REPO_ROOT" || exit 0

changed=$(git status --porcelain -- packages observer evals config scripts '*.json' '*.ts' 2>/dev/null | wc -l | tr -d ' ')
[ "$changed" = "0" ] && exit 0

if ! out=$(pnpm -s check:fast 2>&1 && pnpm -s test 2>&1); then
  printf 'Checks failed after your changes (pnpm check:fast && pnpm test):\n%s\n' "$(tail -n 60 <<<"$out")" >&2
  exit 2
fi
exit 0
