# STEP 6: 専門家による Web 調査 — 設計メモ

## 目的

各専門家が本回答生成の前に自分で Web を調べ、裏付け(情報源 URL)付きの意見を出せるようにする。
自己採点(haiku)はツールなしのまま。調査は本回答生成(sonnet)だけに足す。

## 差し込み位置

```
selectSpeaker (haiku, tools: [])                  ← 変更なし
      ▼ 選出された専門家
AgentSdkGenerator.generate()
  tools        = expert.tools ?? []               ← YAML で専門家ごとに指定
  maxTurns     = tools.length > 0 ? 8 : 1         ← 調査ループを許す
  query({ tools, allowedTools: tools, ... })       ← tools が本当の制限
      ▼ WebSearch / WebFetch を回して調査 → JSON で回答
parseContribution() … proposals[].sources / facts[].sources を取り込む
applyContribution() … sources を黒板エントリと AppliedItem に引き継ぐ
```

## ツールの制限方法(重要)

Agent SDK では `allowedTools` は「自動承認リスト」であって**制限ではない**。
実際に使えるツールを絞るのは `tools` オプション:

- `tools: []` … 組み込みツールを一切読み込まない(scorer / summarizer / 調査なしの専門家)
- `tools: ["WebSearch", "WebFetch"]` … この2つだけ存在(調査ありの専門家)
- `allowedTools: tools` を併記 … 承認プロンプトで止まらないよう自動許可

これで Bash / Read / Write / Edit などは専門家から到達不能。`ALLOWED_EXPERT_TOOLS`
(`src/types.ts`)に無い値を YAML の `tools` に書くと loader がエラーにする。

## 専門家ごとの設定

| 専門家 | tools | 理由 |
|---|---|---|
| ファンダメンタルズ / テクニカル / マクロ・センチメント / リスク | `["WebSearch", "WebFetch"]` | 外部データ(決算・指標・金利・規制)を調べて裏付ける |
| 反証専門家 | なし | 外部情報を持ち込む役ではなく、黒板上の議論の論理を疑う役 |

## Discord での承認フロー(STEP 5 の拡張)

調査ありのターンは数十秒〜数分かかるため、1ターンごとにユーザーの承認を挟む。

```
!run
  └─ 「ターン N を実行してよいですか?」を投稿し ✅ / 🛑 を付ける(pendingApprovalId を保持)
       ├─ ✅ リアクション or !next → runOneTurn() → 完了後にまた承認を求める
       └─ 🛑 リアクション or !stop → guided モード終了
!turn  … 承認なしで1ターンだけ(従来どおり)
!auto  … 承認なしで連続(Mock / 短時間確認用)
```

- `guided` フラグと `pendingApprovalId` で状態管理。`busy` ロックで多重実行防止。
- リアクション受信のため intent に `GuildMessageReactions`、partials に `Message` / `Reaction` を追加。
- 承認は「そのターンを回してよいか」の粒度。ターン内の個々の WebSearch 呼び出しは
  `permissionMode: bypassPermissions` + `allowedTools` で自動実行される。

## 進捗表示(「考え中」の可視化)

長い調査ターンで「Bot が生きているか」を分かるようにする。

- `runTurn(..., { onProgress })` が同期イベントを流す:
  `scoring` → `speaker-selected` → `generating` → `tool-use`(検索クエリ / URL 付き)
- `AgentSdkGenerator.generate(req, { onToolUse })` が `query()` ストリームの `tool_use` ブロックを
  見た時に `onToolUse(name, detail)` を呼ぶ(`toolDetail()` が `input.query` / `input.url` を抽出)
- Discord Bot(`runOneTurn`): 3秒以上かかったら進捗メッセージを1本 `send`、
  10秒ごと(+ツール使用時、最短4秒間隔)に `edit` で更新。ターン完了/エラー時に `delete`
  - 採点中: `⏳ 各専門家が自己採点中… (0:08)`
  - 生成中: `⏳ ファンダメンタルズ専門家 が回答を作成中… (1:24)` + 直近3件の `🔎 <クエリ>` / `📄 <URL>`
- CLI(`npm run turn`)も `onProgress` を stderr に出す(`  … WebSearch: ...`)
- 整形は `src/discord/format.ts` の `formatProgressText()` / `formatToolActivity()`(純粋関数)

## 記録

- `blackboard` の `facts[].sources` / `proposals[].sources`(schema.md 参照)
- `logs/*.jsonl` の `contribution.tool_uses`(例: `{ "WebSearch": 3, "WebFetch": 2 }`)と `contribution.raw`
- Discord 投稿の Embed に「情報源」フィールドとフッターの「調査 WebSearch×3」

## 免責の維持

- 各 system_prompt の「『買うべき』『売るべき』と断定しない」は継続。
- `GENERATION_FORMAT_INSTRUCTIONS` / `RESEARCH_INSTRUCTIONS` にも同じ制約を明記。
- セッション要約(summarizer)も断定的助言を禁止。Discord のフッターに「投資助言ではありません」。
- 実在銘柄を扱うようになったが、出力はあくまで「複数視点からの議論の再現」。

## 動作確認

```bash
npm test    # loader(tools) / generator(sources, RESEARCH_INSTRUCTIONS) / apply(sources) / format(情報源・承認) を追加
cp blackboard-data/session-nvda.json /tmp/x.json
npm run turn -- /tmp/x.json          # 実モデル。ファンダ専門家が WebSearch×3〜4 + WebFetch して
                                     # SEC 決算等の URL 付きで proposals / facts を書くのを確認済み
```

## 残課題

- 調査ありターンは数分。Discord では承認フローで体感を緩和しているが、レート制限には当たりうる。
  `AgentSdkGenerator({ researchMaxTurns })` で上限調整。
- 同一専門家の連続発言、`open_questions` の resolved 判定は STEP 6 でも未対応(README 既知の課題)。
