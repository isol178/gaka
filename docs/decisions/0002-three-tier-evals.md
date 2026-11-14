---
status: "accepted"
date: 2026-11-15
decision-makers: [Haruki Inaba, Claude]
consulted: []
informed: []
---

# 0002. Evals を決定的・リプレイ・ライブの3層に分ける

<!-- 起票シグナル: S3,S4,S5 -->

## Context and Problem Statement

Gaka はエージェントハーネスなので、変更のたびに「ハーネスが壊れていないか」と「絵の質とトークン効率が良くなったか」の両方を確かめる必要がある（`docs/gaka-concept.md` 12章、13章）。しかし実モデルを呼ぶ評価は、費用がかかる・結果が揺れる・API キーが要るという理由で、すべての PR で回してゲートにすることはできない。リポジトリは公開されているため、フォークからの PR に秘密情報を渡すこともできない。

## Decision Drivers

- PR ごとに速く、無料で、揺れずに回ること（CI のゲートとして使える）
- ハーネスのループ（再試行、レイヤー置換、画像トークン予算）をモデルなしで検証できること
- モデル × 観察条件の比較（コンセプト 13章）を、予算を決めて実行できること
- 秘密情報をフォークの PR に晒さないこと
- 評価の期待値を、エージェントが都合よく書き換えられないこと

## Considered Options

- 3層構成: deterministic / replay（PR でゲート）＋ live（手動・定期、ゲートしない）
- live のみ（PR ごとに小さいモデルで実行）
- deterministic のみ（live は場当たりに手で実行）

## Decision Outcome

Chosen option: "3層構成", because ハーネスの退行はモデル抜きで確実に止め、モデルの質の比較は費用を管理しながら別枠で測れるから。to achieve 速く信頼できる CI と比較可能なベンチマークの両立, accepting リプレイ用カセットが実モデルの出力から古びていく保守コスト。

| 層 | 中身 | 実行 | ゲート |
|---|---|---|---|
| deterministic | スキーマ、描画の決定性、観察指標の範囲 | すべての PR | する |
| replay | 記録した応答（`evals/cassettes/`）でループ全体を通す | すべての PR | する |
| live | 実モデルで「描き手 × 批評役 × 観察条件 A/B/C」の行列を回し、独立した審査役が最終画像を採点する | `workflow_dispatch` と週1回の定期実行 | しない（ベースラインとの差を報告） |

### Consequences

- Good, because PR の CI はネットワークも秘密情報も使わず、数秒で終わる
- Good, because 観察条件ごとの画像トークン消費のように、効率面の性質はリプレイでも確定的に検証できる
- Good, because ライブ評価は費用ガード（`--max-cost-usd`）と、鍵がないときのスキップを備え、結果は JSONL とレポートとして残る
- Bad, because カセットは手で作るか記録する必要があり、プロンプトや DSL を変えると更新が要る
- Bad, because ライブ評価はゲートしないため、品質の退行は人がレポートを読んで判断する必要がある

### Confirmation

- `ci.yml` の `evals` ジョブが `pnpm eval:offline` を実行し、失敗で PR を止める
- `evals-live.yml` は `pull_request` では起動しない（`workflow_dispatch` と `schedule` のみ）
- Claude Code の PreToolUse フックで、`evals/baselines/**` の手作業の編集を拒否し、既存の `evals/cassettes/**` の変更には人の確認を求める。ベースラインは `pnpm eval:live --update-baseline` でのみ更新する

## Pros and Cons of the Options

### 3層構成

- Good, because 速さ・費用・揺れの性質が違うものを分けて扱える
- Bad, because 仕組みが増え、カセットの保守が要る

### live のみ（PR ごとに小さいモデルで実行）

- Good, because 常に実モデルでの振る舞いを見られる
- Bad, because 結果が揺れるためゲートにできず、フォークの PR では秘密情報が使えない
- Bad, because PR ごとに費用がかかる

### deterministic のみ

- Good, because 最も単純で速い
- Bad, because 再試行や予算配分などループの振る舞いを検証できない
- Bad, because コンセプトの主要な問い（何回で頭打ちか、観察戦略で質とトークンの関係がどう変わるか）に答えられない

## More Information

- **Confidence**: 中
- **Re-evaluation triggers**: カセットの更新が PR の作業量の大部分を占めるようになった場合（実応答の自動記録を検討する）。ライブ評価の結果の揺れが大きく、反復回数を増やさないと差が読めない場合。人による一対比較（Elo）を導入する段階になった場合。
- **References**:
  - `docs/gaka-concept.md` 12章（評価）、13章（MVP スコープ）、14章（リスクと論点）
  - `docs/evals.md`
