# Gaka（画架）

LLM が「描く → 見る → 直す」を繰り返して絵を仕上げるためのハーネス。モデルは筆致 DSL（JSON）で描き、ハーネスが検証・描画・観察し、別のモデルが講評する。特定のモデルやベンダーに依存せず、画像トークンを節約しながら少ない反復で質を上げることを目指す。

- コンセプト: [docs/gaka-concept.md](docs/gaka-concept.md)
- 技術判断（ADR）: [docs/decisions/](docs/decisions/)
- 開発ガイド: [docs/development.md](docs/development.md)
- Evals: [docs/evals.md](docs/evals.md)

## クイックスタート

必要なもの: Node.js 22（`.node-version`）、[uv](https://docs.astral.sh/uv/)、corepack（pnpm は `packageManager` で固定）

```bash
corepack enable
pnpm bootstrap      # 依存のインストールと git フックの導入
pnpm check          # CI と同じ検査一式
pnpm eval:offline   # モデルを呼ばない評価（決定的・リプレイ）
```

実モデルで1枚描く（API の料金が発生する）:

```bash
cp .env.example .env   # ANTHROPIC_API_KEY などを設定
set -a; source .env; set +a
pnpm gaka paint --brief "夜明けの静かな山の湖" \
  --painter claude-opus-5-5 --critic claude-opus-5-5 --condition C
```

各反復の DSL・画像・講評は `runs/<時刻>/` に保存される。

## 構成

```
packages/dsl        筆致 DSL の JSON Schema と検証
packages/renderer   決定的な Canvas 2D レンダラー（ブラウザと Node で共通）
packages/harness    Painter → Validator → Renderer → Observer → Critic のループ、モデル接続
packages/evals      3層の Evals ランナー
observer/           数値指標・サムネイル・クロップ（Python）
config/models/      モデルの能力プロファイル
evals/              評価スイート、記録した応答、ベースライン
```

## ライセンス

[MIT](LICENSE)
