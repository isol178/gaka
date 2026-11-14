#!/usr/bin/env bash
# PostToolUse(Edit|Write): format the touched file and feed remaining lint errors back to Claude
# (exit 2 shows stderr to the model; the edit itself has already happened).
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

file=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -z "$file" ] || [ ! -f "$file" ] && exit 0
rel=$(rel_path "$file")
[ -z "$rel" ] && exit 0

case "$rel" in
  .claude/skills/* | *.gen.ts | docs/* | *.md) exit 0 ;;
  *.ts | *.js | *.mjs | *.json | *.jsonc)
    cd "$REPO_ROOT" || exit 0
    if ! out=$(pnpm exec biome check --write --no-errors-on-unmatched --files-ignore-unknown=true "$rel" 2>&1); then
      printf 'Biome reported problems in %s:\n%s\n' "$rel" "$(tail -n 40 <<<"$out")" >&2
      exit 2
    fi ;;
  observer/*.py)
    cd "$REPO_ROOT/observer" || exit 0
    sub="${rel#observer/}"
    uv run --quiet ruff format "$sub" >/dev/null 2>&1 || true
    if ! out=$(uv run --quiet ruff check --fix "$sub" 2>&1); then
      printf 'Ruff reported problems in %s:\n%s\n' "$rel" "$(tail -n 40 <<<"$out")" >&2
      exit 2
    fi ;;
esac
exit 0
