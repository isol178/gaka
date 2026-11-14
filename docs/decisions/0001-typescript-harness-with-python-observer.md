---
status: "accepted"
date: 2026-11-15
decision-makers: [Haruki Inaba, Claude]
consulted: []
informed: []
---

# 0001. ハーネス本体を TypeScript、観察を Python で実装する

<!-- 起票シグナル: S4,S5 -->

## Context and Problem Statement

コンセプトシート（`docs/gaka-concept.md` 6章）は、基準レンダラーを JavaScript + Canvas 2D に、観察と数値指標を Python（NumPy、Pillow）に定めている。一方で、ハーネス本体（DSL 検証、反復ループ、モデル接続、Evals）を何で書くかは決まっていなかった。描画の決定性（5章 原則4）を保つには、ハーネス内の描画と配布用 HTML の描画を同じコードにする必要がある。

## Decision Drivers

- ハーネス内の描画と、ブラウザで配る作品の描画を同じコードで行えること（決定性と再現性）
- JSON Schema による検証と型を、言語をまたいで一貫させられること
- 画像解析は NumPy/Pillow の道具立てを使えること（コンセプトの指定）
- 特定ベンダーの SDK に依存しないモデル接続（7章）
- 1人〜少人数で保守できる言語数と CI の複雑さ

## Considered Options

- TypeScript（ハーネス・レンダラー）＋ Python（観察）
- Python 単独（レンダラーはヘッドレスブラウザ経由で呼ぶ）
- TypeScript 単独（観察も JS の画像処理で書く）

## Decision Outcome

Chosen option: "TypeScript（ハーネス・レンダラー）＋ Python（観察）", because 描画コードをブラウザと Node で共有して決定性を保ちつつ、画像解析は NumPy/Pillow を使える唯一の案だから。to achieve 描画の再現性と解析の書きやすさの両立, accepting 2言語分のツールチェーンと CI を保守するコスト。

具体的な構成:

- pnpm ワークスペース（`packages/dsl`, `renderer`, `harness`, `evals`）。実行は tsx、型検査は `tsc --noEmit`、lint/format は Biome、テストは Vitest
- Node 側の描画は `@napi-rs/canvas`（Skia、ビルド済みバイナリで追加のシステム依存なし）。ブラウザでは同じ `render()` を Canvas 2D に適用する
- 観察は `observer/`（uv 管理の Python パッケージ）。CLI が JSON を標準出力に返し、ハーネスはサブプロセスで呼ぶ
- DSL の正典は `packages/dsl/schema/gaka-dsl.schema.json`。TS の型はそこから生成し、CI で生成物の鮮度を検査する
- モデル接続は SDK を使わず HTTP で実装する（OpenAI 互換と Anthropic Messages）。全アダプターを「テキスト（＋画像）→ テキスト」の同じ形に揃えるため

### Consequences

- Good, because 評価で使うレンダラーと配布用 HTML のレンダラーが同一コードになり、「同じ DSL とシードから同じ絵」をテストで保証できる
- Good, because JSON Schema が言語中立の正典になり、Python 側からも同じスキーマで検証できる
- Good, because 観察を CLI＋JSON の境界で切ったので、将来別言語に置き換えてもハーネス側は変わらない
- Bad, because Node と Python の2つのツールチェーン（pnpm と uv）を開発者と CI の両方で揃える必要がある
- Bad, because 観察をサブプロセスで呼ぶため、1回の観察に数十〜数百ミリ秒のオーバーヘッドがある
- Bad, because SDK を使わないので、プロンプトキャッシュや拒否時のフォールバックなどベンダー固有の機能は自前で足す必要がある

### Confirmation

- CI の `ts` ジョブと `python` ジョブが両方とも通ること
- `pnpm gen:check` により、スキーマと生成型のずれを CI で検出する
- `packages/renderer` は DOM にも Node にも依存しない `render()` と、Node 専用の `@gaka/renderer/node` に分かれていること（レビューで確認）

## Pros and Cons of the Options

### TypeScript（ハーネス・レンダラー）＋ Python（観察）

- Good, because 描画コードをブラウザと共有できる
- Good, because 画像解析に NumPy/Pillow を使える
- Bad, because 2言語の CI と依存管理が要る

### Python 単独（レンダラーはヘッドレスブラウザ経由で呼ぶ）

- Good, because 言語が1つで済み、研究用の分析コードとも相性がよい
- Bad, because 描画のたびにブラウザを起動または維持する必要があり、遅くて CI で不安定になりやすい
- Bad, because 描画ロジックは結局 JS で書くため、実質的に2言語になる

### TypeScript 単独（観察も JS の画像処理で書く）

- Good, because 言語とツールチェーンが1つで済む
- Bad, because ヒストグラムやエッジ検出などの数値処理の道具が NumPy ほど揃っておらず、コンセプトの指定とも異なる

## More Information

- **Confidence**: 中
- **Re-evaluation triggers**: 観察のサブプロセス呼び出しが1反復の所要時間の 30% を超えた場合。ブラウザと Node(@napi-rs/canvas) の描画差が評価結果を左右するほど大きいと分かった場合。ベンダー固有機能（キャッシュなど）がないことでコストが許容できなくなった場合。
- **References**:
  - `docs/gaka-concept.md` 5章（設計原則）、6章（技術選定）、7章（モデル非依存）
  - `docs/decisions/0002-three-tier-evals.md`
