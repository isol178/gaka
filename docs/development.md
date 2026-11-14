# 開発ガイド

## セットアップ

| ツール | バージョン | 備考 |
|---|---|---|
| Node.js | 22（`.node-version`） | |
| pnpm | 10.33.2（`packageManager`） | `corepack enable` で自動的に揃う。pnpm 12 は Node 22 同梱の corepack で起動しない（`docs/tips/`） |
| uv | 最新 | Python 3.13 は uv が取得する（`observer/.python-version`） |

```bash
corepack enable
pnpm bootstrap
```

`pnpm bootstrap` は `pnpm install`、`uv sync --project observer`、`lefthook install` を順に実行する。

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm check` | CI と同じ検査一式（型の鮮度、Biome、tsc、Vitest、Ruff、mypy、pytest、ADR、フック、ワークフロー） |
| `pnpm check:fast` | Biome、tsc、Ruff だけ |
| `pnpm test` / `pnpm test:watch` / `pnpm test:coverage` | TypeScript のテスト |
| `pnpm py:test` / `pnpm py:lint` / `pnpm py:typecheck` | Python（observer）の検査 |
| `pnpm gen` | DSL スキーマから TS の型を再生成 |
| `pnpm eval:offline` | 決定的・リプレイ評価 |
| `pnpm eval:live --max-cost-usd 5` | 実モデルでのライブ評価（料金が発生する） |
| `pnpm gaka paint ...` | 実モデルで1枚描く |
| `pnpm site:build` | ブラウザ用ギャラリーを `dist/site` に生成 |
| `pnpm adr:new <slug> --title "..."` | ADR の雛形を採番して作る |

## Git の運用

- `main` へ直接 push しない。ブランチを切って PR を出す
- コミットメッセージは Conventional Commits（`feat(harness): ...`）。commit-msg フックで commitlint が検査する
- pre-commit: 変更ファイルに Biome と Ruff、スキーマを変えたら型の鮮度、ADR を変えたら ADR の検証
- pre-push: `pnpm check`

## CI/CD

| ワークフロー | 起動 | 内容 |
|---|---|---|
| `ci.yml` | PR、main への push、merge queue | TypeScript（型の鮮度、Biome、tsc、カバレッジ付きテスト、ブラウザ用バンドル）、Python、オフライン評価（結果をジョブサマリーに出す）、リポジトリ衛生（actionlint、shellcheck、フックのテスト、ADR、コミットメッセージ） |
| `evals-live.yml` | 手動、毎週月曜 | 実モデルでのライブ評価。`live-evals` 環境の秘密情報を使い、結果を成果物として 90 日保存する |
| `codeql.yml` | PR、main、毎週 | JS/TS、Python、Actions の静的解析 |
| `release.yml` | main への push | release-please がリリース PR を作り、マージでタグと CHANGELOG を作る |
| `pages.yml` | main への push | ブラウザ用ギャラリーを GitHub Pages に公開する（オプトイン） |

Dependabot が npm・uv・GitHub Actions の更新を週1回まとめて PR にする。Actions はコミット SHA で固定している。

### 初回にリポジトリ側で設定すること

1. **ブランチ保護**: `main` で、ステータスチェック `TypeScript (lint, types, tests)`、`Python observer (ruff, mypy, pytest)`、`Evals (deterministic + replay)`、`Repo hygiene (workflows, hooks, ADRs, commits)` を必須にする
2. **ライブ評価**: Settings → Environments で `live-evals` を作り、`ANTHROPIC_API_KEY`（必要なら `OPENAI_API_KEY`）を登録する。必要なら実行前の承認者を設定する。週1回の定期実行は、リポジトリ変数 `LIVE_EVALS_SCHEDULED=true` を設定したときだけ動く（1回あたり既定で最大 5 USD）
3. **Pages（任意）**: Settings → Pages の Source を「GitHub Actions」にし、リポジトリ変数 `PAGES_ENABLED=true` を設定する
4. **release-please**: Settings → Actions → General で「Allow GitHub Actions to create and approve pull requests」を有効にする。さらに、contents と pull-requests の書き込み権限を持つ fine-grained PAT（または GitHub App のトークン）を `RELEASE_PLEASE_TOKEN` として登録する。既定の `GITHUB_TOKEN` で作られた PR では他のワークフローが起動しないため、1. の必須チェックが永遠に揃わずリリース PR をマージできない

## Claude Code

`CLAUDE.md` がプロジェクトの指示、`.claude/settings.json` が権限とフック、`.claude/skills/` が開発スキル。フックの内容は `CLAUDE.md` の「フック」節を参照。フックを変えたら `pnpm hooks:test` を通す。

個人用の上書きは `.claude/settings.local.json` に書く（git の管理外）。

## 新しいモデルを追加する

1. `config/models/<id>.json` に能力プロファイルを書く（スキーマは `packages/harness/schema/capability-profile.schema.json`）
   - `adapter` は、Anthropic なら `anthropic`、OpenAI なら `openai`（どちらも公式 SDK）。自前の SDK を持たない OpenAI 互換サーバー（Ollama、vLLM、llama.cpp など）は `openai-compatible` と `baseUrl`（HTTP で接続）
   - 公式 SDK のある別のプロバイダーを足すときは、`packages/harness/src/model/sdk.ts` にアダプターを足し、スキーマの `adapter` に値を追加する（ADR 0003）
   - `pricing` は提供元の料金表の値を書く（費用の集計と、ライブ評価の費用ガードに使う）
   - 画像を読めないモデルは `vision: false`。Critic に使うと数値だけの観察に切り替わる
2. `pnpm test` でプロファイルの検証が通ることを確かめる
3. `evals/suites/live-mvp.json` の `pairs` に足す
