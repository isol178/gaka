#!/usr/bin/env bash
# Pipe-tests for the Claude Code hooks. Run with `pnpm hooks:test` (also runs in CI).
set -uo pipefail
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HOOKS/../.." && pwd)"
export CLAUDE_PROJECT_DIR="$ROOT"
fail=0

decision() { # hook, json -> permissionDecision or "none"
  local out
  out=$(printf '%s' "$2" | "$HOOKS/$1")
  if [ -z "$out" ]; then echo none; return; fi
  jq -r '.hookSpecificOutput.permissionDecision // "none"' <<<"$out"
}

expect() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi
}

edit() { jq -n --arg p "$1" '{tool_name: "Edit", tool_input: {file_path: $p}}'; }
bash_cmd() { jq -n --arg c "$1" '{tool_name: "Bash", tool_input: {command: $c}}'; }

# protect-paths
expect "deny generated types" "$(decision protect-paths.sh "$(edit "$ROOT/packages/dsl/src/types.gen.ts")")" deny
expect "deny lockfile" "$(decision protect-paths.sh "$(edit "$ROOT/pnpm-lock.yaml")")" deny
expect "deny .env" "$(decision protect-paths.sh "$(edit "$ROOT/.env")")" deny
expect "allow .env.example" "$(decision protect-paths.sh "$(edit "$ROOT/.env.example")")" none
expect "deny baselines" "$(decision protect-paths.sh "$(edit "$ROOT/evals/baselines/live-mvp.json")")" deny
expect "ask on existing cassette" "$(decision protect-paths.sh "$(edit "$ROOT/evals/cassettes/landscape-retry.json")")" ask
expect "allow new cassette" "$(decision protect-paths.sh "$(edit "$ROOT/evals/cassettes/new-one.json")")" none
expect "allow source" "$(decision protect-paths.sh "$(edit "$ROOT/packages/harness/src/session.ts")")" none
expect "relative paths" "$(decision protect-paths.sh "$(edit "packages/dsl/src/types.gen.ts")")" deny

# guard-bash
expect "deny --no-verify" "$(decision guard-bash.sh "$(bash_cmd 'git commit -m x --no-verify')")" deny
expect "deny LEFTHOOK=0" "$(decision guard-bash.sh "$(bash_cmd 'LEFTHOOK=0 git commit -m x')")" deny
expect "deny force push" "$(decision guard-bash.sh "$(bash_cmd 'git push --force origin feat')")" deny
expect "deny -f push" "$(decision guard-bash.sh "$(bash_cmd 'git push -f')")" deny
expect "deny push main" "$(decision guard-bash.sh "$(bash_cmd 'git push origin main')")" deny
expect "allow lease push" "$(decision guard-bash.sh "$(bash_cmd 'git push --force-with-lease origin feat')")" none
expect "allow branch push" "$(decision guard-bash.sh "$(bash_cmd 'git push -u origin chore/dev-environment')")" none
expect "deny rm -rf /" "$(decision guard-bash.sh "$(bash_cmd 'rm -rf /')")" deny
expect "allow rm -rf dist" "$(decision guard-bash.sh "$(bash_cmd 'rm -rf dist')")" none
expect "deny shell write to baselines" "$(decision guard-bash.sh "$(bash_cmd 'echo {} > evals/baselines/live-mvp.json')")" deny
expect "deny sed -i on baselines" "$(decision guard-bash.sh "$(bash_cmd 'sed -i s/1/2/ evals/baselines/live-mvp.json')")" deny
expect "allow reading baselines" "$(decision guard-bash.sh "$(bash_cmd 'cat evals/baselines/live-mvp.json')")" none
expect "allow --update-baseline" "$(decision guard-bash.sh "$(bash_cmd 'pnpm eval:live --update-baseline > /tmp/log')")" none
expect "deny shell write to .env" "$(decision guard-bash.sh "$(bash_cmd 'echo KEY=1 >> .env')")" deny
expect "allow reading .env.example" "$(decision guard-bash.sh "$(bash_cmd 'cat .env.example')")" none
expect "deny cp into baselines" "$(decision guard-bash.sh "$(bash_cmd 'cp /tmp/x.json evals/baselines/live-mvp.json')")" deny
expect "deny tee .env.local" "$(decision guard-bash.sh "$(bash_cmd 'echo A=1 | tee -a .env.local')")" deny
expect "allow commit message mentioning baselines" "$(decision guard-bash.sh "$(bash_cmd 'git commit -m "create evals/baselines on clone" 2>&1 | grep x')")" none
expect "allow redirect elsewhere mentioning .env" "$(decision guard-bash.sh "$(bash_cmd 'grep -r "\.env" docs > /tmp/out.txt')")" none
expect "allow normal commit" "$(decision guard-bash.sh "$(bash_cmd 'git commit -m "feat: x"')")" none
expect "deny push HEAD:main" "$(decision guard-bash.sh "$(bash_cmd 'git push origin HEAD:main')")" deny
expect "deny push refs/heads/main" "$(decision guard-bash.sh "$(bash_cmd 'git push origin feat:refs/heads/main')")" deny
expect "deny +refspec force push" "$(decision guard-bash.sh "$(bash_cmd 'git push origin +feat')")" deny
expect "deny -uf force push" "$(decision guard-bash.sh "$(bash_cmd 'git push -uf origin feat')")" deny
expect "allow --follow-tags push" "$(decision guard-bash.sh "$(bash_cmd 'git push --follow-tags origin feat')")" none
expect "deny baselines with --update-baseline in a comment" "$(decision guard-bash.sh "$(bash_cmd 'echo {} > evals/baselines/live-mvp.json # --update-baseline')")" deny
expect "deny .env write followed by ;" "$(decision guard-bash.sh "$(bash_cmd 'echo A=1 > .env;')")" deny
expect "deny .env write followed by &&" "$(decision guard-bash.sh "$(bash_cmd 'echo KEY=1 >> .env&&ls')")" deny
expect "deny .env.production" "$(decision guard-bash.sh "$(bash_cmd 'echo A=1 > .env.production')")" deny
expect "allow writing .env.example" "$(decision guard-bash.sh "$(bash_cmd 'echo A= >> .env.example')")" none

# guard-bash: a push without a refspec while on main updates main.
tmp_repo=$(mktemp -d)
git -C "$tmp_repo" init -q -b main
on_main() { (export CLAUDE_PROJECT_DIR="$tmp_repo"; decision guard-bash.sh "$(bash_cmd "$1")"); }
expect "deny bare push on main" "$(on_main 'git push')" deny
expect "deny push -u origin on main" "$(on_main 'git push -u origin')" deny
expect "allow pushing another branch from main" "$(on_main 'git push origin feat')" none
git -C "$tmp_repo" checkout -q -b feat
expect "allow bare push on a branch" "$(on_main 'git push')" none
rm -rf "${tmp_repo:?}"

# format-file: a file outside the repo and a markdown file are ignored (exit 0)
printf '%s' "$(edit /tmp/outside.ts)" | "$HOOKS/format-file.sh"; expect "format ignores outside" "$?" 0
printf '%s' "$(edit "$ROOT/README.md")" | "$HOOKS/format-file.sh"; expect "format ignores markdown" "$?" 0

# stop-verify: never loops
printf '{"stop_hook_active": true}' | "$HOOKS/stop-verify.sh"; expect "stop hook respects stop_hook_active" "$?" 0

# session-start prints context
out=$(printf '{}' | "$HOOKS/session-start.sh"); expect "session-start prints workspace" "$(grep -c 'Gaka workspace' <<<"$out")" 1

exit $fail
