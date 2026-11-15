#!/usr/bin/env bash
# PreToolUse(Edit|Write|NotebookEdit): keep generated files, lockfiles, secrets and eval
# expectations out of hand edits. Eval baselines in particular must never be edited to make a
# regression "pass"; they are rewritten only by `pnpm eval:live --update-baseline`.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

input=$(cat)
file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
[ -z "$file" ] && exit 0
rel=$(rel_path "$file")
[ -z "$rel" ] && exit 0

case "$rel" in
  *.gen.ts)
    pre_tool_decision deny "$rel is generated from packages/dsl/schema/*.json. Edit the schema and run \`pnpm gen\`." ;;
  pnpm-lock.yaml | observer/uv.lock)
    pre_tool_decision deny "$rel is managed by the package manager. Use \`pnpm add\` / \`uv add --project observer\`." ;;
  .env.example) exit 0 ;;
  .env | .env.*)
    pre_tool_decision deny "Secrets files are off limits. Ask the user to edit $rel." ;;
  evals/baselines/*)
    pre_tool_decision deny "Eval baselines are only written by \`pnpm eval:live --update-baseline\` after a human accepts the run." ;;
  evals/cassettes/*)
    # New cassettes are fine; changing a recorded one can silently make a replay eval pass.
    if [ -e "$REPO_ROOT/$rel" ]; then
      pre_tool_decision ask "Modifying the recorded cassette $rel changes what the replay evals verify. Confirm this is intended."
    fi ;;
esac
exit 0
