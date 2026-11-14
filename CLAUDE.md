# Gaka

LLM が「描く → 見る → 直す」を繰り返して絵を仕上げるためのハーネス。設計の正典は `docs/gaka-concept.md`、技術判断は `docs/decisions/`（ADR）。

## 構成

| パス | 役割 | 言語 |
|---|---|---|
| `packages/dsl` | 筆致 DSL の JSON Schema（正典）、生成型、検証 | TS |
| `packages/renderer` | 決定的な Canvas 2D レンダラー、シード付き PRNG。`@gaka/renderer/node` は Node 専用 | TS |
| `packages/harness` | Painter → Validator → Renderer → Observer → Critic のループ、モデルアダプター、CLI | TS |
| `packages/evals` | 3層の Evals ランナー（deterministic / replay / live） | TS |
| `observer/` | 数値指標・サムネイル・クロップ・差分領域。CLI は JSON を返す | Python (uv) |
| `config/models/` | モデルの能力プロファイル（ファイル名 = id） | JSON |
| `evals/` | スイート定義、カセット（記録した応答）、ベースライン | JSON |

## コマンド

- 初回: `pnpm bootstrap`（pnpm install、uv sync、git フック導入）
- 全検査: `pnpm check`（CI と同じ内容）。速い検査: `pnpm check:fast`
- テスト: `pnpm test`（TS）、`pnpm py:test`（Python）
- DSL のスキーマを変えたら `pnpm gen` で型を再生成する
- オフライン評価: `pnpm eval:offline`。ライブ評価 `pnpm eval:live` と `pnpm gaka paint` は課金が発生するので、必ずユーザーに確認してから実行する
- ADR: `pnpm adr:new <slug> --title "..."`、検証は `pnpm adr:check`

## 守ること

- **モデル非依存**: モデルに求めるのは「テキスト（＋任意の画像）を受け取り、JSON を含むテキストを返す」ことだけ。ベンダー固有のツール呼び出しや構造化出力に依存するコードをハーネスの経路に入れない。ベンダー差はアダプター（`packages/harness/src/model/`）に閉じ込める
- **モデル接続**: 公式 SDK のあるプロバイダー（Anthropic、OpenAI）は SDK を使い（`sdk.ts`）、HTTP は SDK のない OpenAI 互換サーバーに限る（`http.ts`）。SDK の import は `sdk.ts` の外に出さない。拒否時のフォールバックなど、別のモデルが黙って答える機能は有効にしない（ADR 0003）
- **決定性**: 乱数は必ず `createRng` / `deriveSeed` を通す。`Math.random`、時刻、環境依存の値を描画に混ぜない
- **DSL の正典はスキーマ**: `*.gen.ts` を手で編集しない。スキーマで表せない規則は `validate.ts` の意味検査に足す
- **Evals の期待値を動かして通さない**: `evals/baselines/` は手で編集しない（Edit/Write と代表的なシェルの書き込みはフックで拒否されるが、フックをかいくぐる書き方もしない）。既存のカセットを変えるときは理由をユーザーに説明する。挙動を変えたら、期待値ではなく実装かケースの意図を見直す
- **ハーネスの挙動を変えたら replay のケースを足す**: 再試行、予算、観察条件など、ループの振る舞いを変える変更には `evals/suites/replay.json` のケース（必要ならカセット）を伴わせる
- コミットは Conventional Commits（commitlint で検査）。スコープ例: `dsl`, `renderer`, `harness`, `evals`, `observer`, `ci`, `claude`

## スキル（`.claude/skills/`）

- 設計の相談や方針決め → `deliberate`。決まった非自明な判断 → `adr`
- 3ファイル以上の実装に入る前 → `implementation-planning`。新規ファイル → `pattern-anchoring`
- 原因がすぐ分からない不具合 → `systematic-debugging`。既知の罠は `docs/tips/` に書き足す
- サブエージェントに委譲するときは、プロンプトに `delegated-task-protocol` を明記する

## フック（`.claude/settings.json`）

- 編集後に Biome / Ruff で整形し、残った lint エラーを返す
- 生成物・ロックファイル・秘密情報・評価ベースラインの編集を止める（Edit/Write と、リダイレクトや `sed -i` などシェルの代表的な書き込み）。`--no-verify`、強制 push、main への直接 push を止める
- 終了時、ソースに変更があれば `pnpm check:fast` と `pnpm test` を実行し、失敗したら続けて直させる
- フックの変更後は `pnpm hooks:test` を通す
