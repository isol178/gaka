# Evals

Gaka の評価は3層に分かれる（理由は [ADR 0002](decisions/0002-three-tier-evals.md)）。

| 層 | 確かめること | モデル | 実行 | CI のゲート |
|---|---|---|---|---|
| deterministic | スキーマ、描画の決定性、観察指標 | 使わない | 毎 PR | する |
| replay | ループ全体（再試行、レイヤー置換、観察条件、画像トークン予算） | 記録した応答 | 毎 PR | する |
| live | 絵の質と効率（モデル × 観察条件） | 実モデル | 手動・毎週 | しない |

```bash
pnpm eval:offline                                    # deterministic + replay
pnpm eval run --suite evals/suites/replay.json       # スイートを指定
pnpm eval run --tier replay --case retry-then-done-C # ケースを指定
pnpm eval:live --max-cost-usd 5                      # ライブ評価（料金が発生する）
```

結果は `evals/results/<runId>/` に出る（git の管理外）。

- `results.jsonl`: 1ケース（ライブでは1回の実行）につき1行
- `summary.json`: 合否の集計と、ライブ評価のセルごとの平均
- `report.md`: 人が読むための表。CI ではジョブサマリーに貼られる

## スイートの書き方

スイートは `evals/suites/*.json`。スキーマは `evals/schema/suite.schema.json`（エディタで補完が効く）。

| kind | 層 | 中身 |
|---|---|---|
| `schema` | deterministic | ディレクトリ内の DSL がすべて有効（または無効）か |
| `render-determinism` | deterministic | 同じ DSL を2回描いてピクセルが一致するか |
| `metrics` | deterministic | 観察指標（明度・彩度・エッジ密度など）が範囲内か |
| `replay-session` | replay | カセットでループを回し、状態・反復回数・再試行・最終スコア・画像トークン・見せた画像を検査 |
| `live-session` | live | 描き手と批評役の組 × 観察条件 × 繰り返しの行列を回す |

### カセット（replay）

`evals/cassettes/*.json` は Painter と Critic の応答を順に並べたもの。`usage` を書くとトークン数をその値で記録する（省略時は文字数から見積もる）。

```json
{
  "description": "何を検証するためのカセットか",
  "painter": [{ "text": "<モデルの応答そのまま>", "usage": { "inputTokens": 3000, "outputTokens": 700 } }],
  "critic": [{ "text": "{\"score\": 7, \"done\": true, \"fixes\": []}" }]
}
```

ループの振る舞いを変える変更には、それを確かめるカセットとケースを足す。既存のカセットを変えるとリプレイ評価の意味が変わるので、Claude Code のフックは Edit/Write の前に確認を求める。

## ライブ評価

- 各セル（描き手 / 批評役 / 観察条件）で、ループの最終スコアとは別に、`judge` に指定したモデルが最終画像を同じ基準で採点する（`judgeScore`）。ループ内の Critic に自分の結果を採点させると甘くなるため
- 効率の指標: 反復回数、再試行回数、入出力トークン、画像トークン、費用（`config/models` の単価から計算）
- `--max-cost-usd` を超えると、それ以降の実行は始めずにスキップとして記録する。API キーがない組もスキップになる
- ライブ評価はゲートしない。`evals/baselines/<suite>.json` との差をレポートに出し、人が判断する
- 結果を基準として受け入れるときは `pnpm eval:live --update-baseline` を実行し、ベースラインの変更を PR にする。ベースラインを手で編集してはいけない（Claude Code のフックが Edit/Write と代表的なシェルの書き込みを拒否する。レビューでも確認する）

## コンセプトの主要な問いとの対応

| 問い（コンセプト 12章） | 見る指標 |
|---|---|
| 何回見て直せば質が頭打ちになるか | `maxIterations` を変えたときの `judgeScore` |
| 観察戦略で質とトークンの関係はどう変わるか | 条件 A/B/C ごとの `judgeScore` と `imageTokens` |
| その傾向はモデルが変わっても成り立つか | `pairs` ごとの上記の比較 |

## これから足すもの

- 人による一対比較（Elo）の記録
- お題との類似度スコア
- ライブ実行の応答を記録してカセットにする仕組み
- 文字組み（第2段階）のレイアウト検査ケース
