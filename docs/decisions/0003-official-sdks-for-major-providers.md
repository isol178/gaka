---
status: "accepted"
date: 2026-11-15
decision-makers: [Haruki Inaba, Claude]
consulted: []
informed: []
---

# 0003. 主要プロバイダーは公式 SDK で接続し、SDK のないものだけ HTTP にする

<!-- 起票シグナル: S4,S6 -->

## Context and Problem Statement

ADR 0001 では、すべてのモデル接続を SDK を使わない HTTP で実装するとした。アダプターの形を揃えるためだったが、当面の試行は主要プロバイダー（Anthropic、OpenAI、Google）で行う。いずれも公式 SDK を出しており、再試行・タイムアウト・型付きのエラー・API バージョンの追従を SDK が担う。HTTP の自前実装でこれらを保守し続ける利点は小さい。この ADR は 0001 のうち「モデル接続は SDK を使わず HTTP で実装する」の項だけを改める。

## Decision Drivers

- 主要プロバイダーの API 変更（認証方式、API バージョン、停止理由の追加など）に追従する手間を減らす
- 再試行、タイムアウト、エラーの分類を自前で書かない
- ハーネスのモデル非依存性（「テキスト（＋画像）→ JSON を含むテキスト」だけに依存する）を崩さない
- SDK のない接続先（ローカルの OpenAI 互換サーバーなど）も同じように扱える

## Considered Options

- SDK のあるプロバイダーは公式 SDK、ないものは HTTP（アダプターの内側で使い分ける）
- すべて HTTP（ADR 0001 のまま）
- OpenAI の SDK を OpenAI 互換サーバーにも使い回す

## Decision Outcome

Chosen option: "SDK のあるプロバイダーは公式 SDK、ないものは HTTP", because 追従と再試行を SDK に任せつつ、SDK はアダプターの内側に閉じ込めるのでハーネスの形は変わらないから。to achieve 主要プロバイダーでの保守の手間の削減, accepting 依存パッケージが2つ増え、SDK の更新で振る舞いが変わる可能性があること。

| `adapter` | 実装 | 対象 |
|---|---|---|
| `anthropic` | `@anthropic-ai/sdk` | Anthropic |
| `openai` | `openai` | OpenAI |
| `google` | `@google/genai` | Google（Gemini API） |
| `openai-compatible` | HTTP（fetch） | Ollama、vLLM、llama.cpp server など、自前の SDK を持たない OpenAI 互換サーバー |
| `scripted` | 記録した応答 | テストとリプレイ評価 |

SDK にしかない機能（サーバー側の拒否時フォールバック、構造化出力、ツール呼び出しなど）は、ハーネスの経路では使わない。特に拒否時のフォールバックは、ベンチマークの最中に別のモデルが黙って答えることになり、結果のラベルが狂うので有効にしない。

### Consequences

- Good, because 認証ヘッダーや API バージョンの変更に SDK の更新で追従できる（例: Anthropic SDK 1.x は `Authorization: Bearer` と API バージョン `2026-10-21` を送る）
- Good, because 再試行（既定2回）とタイムアウトが SDK に入っている
- Good, because SDK はアダプターの内側だけで使うので、モデルの差し替えや比較の仕組みは変わらない
- Bad, because 依存が増え、Dependabot による SDK の更新でも振る舞いが変わりうる
- Bad, because アダプターごとに実装方式が違い、テストの書き方も2通りになる（SDK には `fetch` を注入し、HTTP では global の `fetch` を差し替える）

### Confirmation

- `packages/harness/test/adapters.test.ts` が、各アダプターの送信内容（URL、認証、本文の形）と、usage・停止理由の対応づけを検査する
- SDK の import は `packages/harness/src/model/sdk.ts` だけにある（レビューで確認）

## Pros and Cons of the Options

### SDK のあるプロバイダーは公式 SDK、ないものは HTTP

- Good, because 主要プロバイダーの保守を SDK に任せられる
- Good, because SDK のない接続先も扱える
- Bad, because 実装方式が2通りになる

### すべて HTTP（ADR 0001 のまま）

- Good, because 依存がなく、全アダプターが同じ書き方になる
- Bad, because 認証方式や API バージョンの変更、再試行を自前で追う必要がある

### OpenAI の SDK を OpenAI 互換サーバーにも使い回す

- Good, because HTTP の実装が不要になる
- Bad, because 互換サーバーは OpenAI の SDK が前提とするヘッダーや応答の細部まで揃っているとは限らず、問題が起きたときに切り分けにくい

## More Information

- **Confidence**: 高
- **Re-evaluation triggers**: SDK の更新で、ハーネスが前提とする「テキストを返す」振る舞いが変わった場合。他の主要プロバイダーを足す場合（同じ方針で SDK アダプターを足す）。OpenAI 互換サーバーで HTTP アダプターでは足りない差が出た場合。
- **References**:
  - `docs/decisions/0001-typescript-harness-with-python-observer.md`（この ADR で一部を改訂）
  - `packages/harness/src/model/sdk.ts`、`packages/harness/src/model/http.ts`
