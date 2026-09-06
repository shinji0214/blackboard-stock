# STEP 4: 本回答生成と黒板への書き込み — 設計メモ

## 目的

STEP 3 で選出された専門家が、実際の貢献内容を生成して黒板を更新する。
1ターン = 「採点 → 選出(STEP 3)→ 生成 → 分類 → 黒板追記(STEP 4)」。

## 処理の流れ

```
runTurn(blackboard, experts, scorer, generator)
  │
  ├─ selectSpeaker()  ── quiescence なら生成をスキップして終了(黒板は変更しない)
  │      ▼ speaker
  ├─ makeGenerateRequest(speaker, blackboard)   … 採点時より広めの黒板要約(直近12件)
  │      ▼
  ├─ generator.generate()  ── 専門家の system_prompt + 出力形式指示で本番モデルを1ターン呼び出し
  │      ▼ 構造化 JSON(proposals / facts / open_questions)
  ├─ parseContribution()   ── コードフェンス除去・最初の JSON オブジェクト抽出・型強制・空要素破棄
  │      ▼ Contribution
  └─ applyContribution()   ── 純粋関数。黒板へ追記して新しい黒板を返す
         ├─ proposals[]      → id=p{n}, author=専門家名, confidence クランプ, responds_to 存在検証
         ├─ facts[]          → id=f{n}, source=専門家名
         ├─ open_questions[] → id=q{n}, raised_by=専門家名, resolved=false
         └─ history[]        → 追記1件ごとに {turn, actor, action, ref_id, timestamp}
```

その後 `scripts/run-turn.ts` が黒板 JSON を上書き保存し、実行ログ(JSONL)へ追記する。

## 「どのセクションに書くか」の分類方法

専門家自身に構造化 JSON で出力させる(後段の分類器は置かない)。
`src/generation/generator.ts` の `GENERATION_FORMAT_INSTRUCTIONS` を各専門家の
`system_prompt` の後ろに連結してシステムプロンプトにする。

```json
{
  "proposals": [{ "content": "...", "confidence": 0-10, "responds_to": "p1 | null" }],
  "facts": [{ "content": "データに基づく確定事実のみ" }],
  "open_questions": [{ "content": "次に確認すべき論点" }]
}
```

- 通常は proposals に1件。裏付けのない主張は facts に入れず open_questions へ。
- 反論・応答は `responds_to` に対象提案 id。`applyContribution` が存在しない id を null に落とす。
- パース失敗時、`AgentSdkGenerator` は「JSON のみ再出力」を促して1回だけリトライする。

## 主要モジュール

| ファイル | 役割 |
|---|---|
| `src/generation/generator.ts` | `Generator` インターフェース、`Contribution` 型、生成プロンプト、`parseContribution()` / `normalizeContribution()` |
| `src/generation/mock-generator.ts` | `MockGenerator` — API 不要。`contribution` / `byExpertName` で貢献を指定、既定は proposal 1件 |
| `src/generation/agent-sdk-generator.ts` | `AgentSdkGenerator` — Agent SDK 経由で `claude-sonnet-5`。ツールなし1ターン + JSON リトライ1回 |
| `src/blackboard/apply.ts` | `applyContribution()` — 純粋関数。id 採番・`history` 記録・`updated_at` 更新。入力の黒板は破壊しない |
| `src/controller/turn.ts` | `runTurn()` — 1ターンのオーケストレーション |
| `src/controller/firing-log.ts` | `FiringRunLog` に `contribution`(誰がどのセクションに何を書いたか)を追加 |
| `scripts/run-turn.ts` | 動作確認 CLI。`--loop N` / `--dry-run` / `--json` / `--log` |

## モデル

- 自己採点: `claude-haiku-4-5`(STEP 3)
- 本回答生成: `claude-sonnet-5`(STEP 4)
- いずれも Claude Agent SDK 経由 → Claude Code と同じサブスクリプション認証。追加の API 課金なし。

## 完了基準の対応

- [x] 専門家の発言が正しいセクションに追記される → 専門家が構造化 JSON で分類、`applyContribution` が反映
- [x] 更新のたびに JSON ファイルが上書き保存される → `run-turn.ts` が各ターン後に `saveBlackboard()`
- [x] 更新履歴が残る → `blackboard.history`(誰がいつ何を書いたか)+ `logs/*.jsonl`(採点理由・生成生テキスト込み)

## セッションの終了

`isSessionComplete()`(STEP 3)= quiescence かつ未解決 open_question が0件。
`run-turn.ts --loop` はこの条件で停止し、`status` を `resolved` にして保存する。
未解決の論点が残っている場合は quiescence でも `in_progress` のまま(人間の追加入力待ち → STEP 5)。

## 決定事項 / 割り切り

- 分類は専門家に任せ、別立ての分類 LLM 呼び出しはしない(コスト・往復を抑える)。
- `facts` への書き込みも専門家に許可しているが、プロンプトで「データに基づく確定事実のみ」と制約。
- `open_questions` の `resolved` を立てる処理は STEP 4 では未実装(全員が触れ終わったら quiescence で止まる設計)。必要なら STEP 5 以降で「解決済み判定」を足す。
- 1ターン1貢献。同一ターンで複数専門家は発言しない(黒板方式として逐次更新)。

## 動作確認

```bash
npm test                              # generator / apply / turn ほか
npm run turn:mock -- blackboard-data/session-sample.json --loop 3
cp blackboard-data/session-stock-outlook.json /tmp/x.json
npm run turn -- /tmp/x.json --loop 4   # 実モデル。/tmp のコピーに対して実行する
```
