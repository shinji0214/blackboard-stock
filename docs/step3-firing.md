# STEP 3: 自己採点(発火判定)ロジック — 設計メモ

## 目的

各専門家が「自分の出番かどうか」を安価に自己判定する仕組み。
司会役が指名する GroupChat 方式とは異なり、**誰も指名しない**。
全専門家が黒板の状態に対して 0〜10 で自己採点し、閾値を満たす中で最高スコアの
専門家が自発的に発言する。全員が閾値未満なら発言者なし(quiescence)。

## 処理の流れ

```
黒板 JSON ──▶ summarizeBlackboard() ──▶ 黒板要約(1つ)
                                            │
              experts/*.yaml ──────────────┤
                                            ▼
                      各専門家 × 黒板要約 ──▶ Scorer.score() ──▶ { score, reason }
                                            │  (5体並列)
                                            ▼
                              selectSpeaker() が集約
                              ・score >= min_confidence_to_speak → eligible
                              ・eligible の最高スコアを speaker に
                              ・eligible が 0 → quiescent = true, speaker = null
                              ・同点は専門家の定義順(YAMLファイル名順)で決着
```

## 主要モジュール

| ファイル | 役割 |
|---|---|
| `src/blackboard/summary.ts` | 黒板 → 要約テキスト。生ログではなく `schema.md` の要約フォーマットに変換。facts/proposals は直近5件、resolved 済みの open_question は除外 |
| `src/scoring/scorer.ts` | `Scorer` インターフェース、採点用システムプロンプト、`buildScoringUserPrompt()`、`parseScoreResponse()`(`SCORE:` / `REASON:` の2行を抽出、形式を外れても数値を拾う) |
| `src/scoring/mock-scorer.ts` | `MockScorer` — API 不要の決定論的スコアラー。`fixedScore` / `byExpertName` / 文字バイグラムのカバレッジ率。ユニットテストとオフライン確認用 |
| `src/scoring/agent-sdk-scorer.ts` | `AgentSdkScorer` — `@anthropic-ai/claude-agent-sdk` の `query()` で `claude-haiku-4-5` を1ターン・ツールなしで呼ぶ。Claude Code と同じサブスクリプション認証 |
| `src/controller/firing.ts` | `selectSpeaker()`(採点の集約と選出)、`isSessionComplete()`(quiescent かつ未解決の論点なし = セッション終了) |
| `src/controller/firing-log.ts` | `buildFiringRunLog()` / `appendFiringLog()` — 発火判定1回分(全スコア・理由・生応答・選出結果)を JSONL に追記 |

## 実行ログ(JSONL)

`scripts/run-firing.ts` は実行のたびに `logs/firing-<session_id>.jsonl` へ1行追記する。
1レコード = 発火判定1回分:

```jsonc
{
  "logged_at": "2026-09-06T14:56:31.078Z",
  "session_id": "2026-09-06_stock-outlook-001",
  "goal": "...",
  "scorer": "AgentSdkScorer",
  "model": "claude-haiku-4-5",
  "blackboard_path": "...",
  "summary": "採点に渡した黒板要約(全文)",
  "scores": [
    { "expert": "マクロ・センチメント専門家", "score": 9, "threshold": 6,
      "eligible": true, "reason": "...", "raw": "SCORE: 9\nREASON: ..." }
    // ... 全専門家分(スコア降順)
  ],
  "decision": { "speaker": "マクロ・センチメント専門家", "quiescent": false, "session_complete": false }
}
```

追記型なので、黒板を更新しながら複数回実行するとそのまま議論の進行ログになる。
`--json` で同じ内容を標準出力にも出せる。`--log <path>` で出力先変更、`--no-log` で無効化。
STEP 4 で本回答生成を繋いだら、生成された貢献内容(どのセクションに何を書いたか)もこのレコードに足していく。

## 閾値と停止条件

- 閾値は専門家ごとに `min_confidence_to_speak`(`experts/*.yaml`)。現状: ファンダメンタルズ/テクニカル/マクロ = 6、リスク/反証 = 5。
- **quiescence**(`selectSpeaker` が返す `quiescent`): 発言権を持つ専門家が一人もいない状態。
- **セッション終了**(`isSessionComplete`): `schema.md` に従い「open_questions が0件かつ全専門家が低スコア」。
  未解決の論点が残っている場合は quiescent でも終了せず、人間の追加入力を待つ。

## 完了基準の対応

- [x] 専門家ごとに自信度スコアが取得できる → `selectSpeaker().scores[]`(全員分、`ScoreResult` に生応答と理由も保持)
- [x] 最高スコアの専門家のみが選出される → `selectSpeaker().speaker`
- [x] 全員低スコア時に自動停止する → `quiescent` / `isSessionComplete()`

## 決定事項 / 割り切り

- 実装言語は **TypeScript / Node.js**(STEP 5 の Discord bot まで一貫、`discord.js` を想定)。
- LLM 呼び出しは **Claude Agent SDK** に寄せ、Pro サブスクリプションの範囲で動くようにした。
  生の `@anthropic-ai/sdk`(別途 API 従量課金)を使う `ApiScorer` は必要になったら追加する。
- 採点は 5 体を **並列**(`Promise.all`)で実行。黒板要約は 1 回だけ生成して使い回す。
- 同点時の決着はデフォルトで定義順。`selectSpeaker` の `tieBreak` オプションで差し替え可能。
- MockScorer のカバレッジ率スコアはあくまで擬似シグナル。実際の判定品質は `AgentSdkScorer` が担う。

## 動作確認

```bash
npm test                      # summary / scorer / firing / firing-log / loader ほか
npm run firing:mock -- blackboard-data/session-stock-outlook.json
npm run firing    -- blackboard-data/session-stock-outlook.json   # 実モデル
```

`session-stock-outlook.json`(テクニカル専門家が発言済み、セクター資金流入の未解決論点あり)での
`AgentSdkScorer` 実行例では、マクロ・センチメント専門家が最高スコアで選出され、
既に発言済みのテクニカル専門家は閾値未満に落ちる、という妥当な挙動を確認済み。
