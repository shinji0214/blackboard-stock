# STEP 5: Discord への投稿 — 設計メモ

## 目的

黒板の更新を人間が読める形で Discord チャンネルに流し、人間も議論に参加できるようにする。
ローカル PC でホスティングする常駐 Bot(discord.js v14)。

## 構成

```
scripts/run-bot.ts        … .env 読み込み → startBot()。SIGINT/SIGTERM で切断
  └─ src/discord/bot.ts    … Client 生成、コマンド処理、ターン進行、投稿
        ├─ src/controller/turn.ts        … runTurn(STEP 3 + 4)をそのまま利用
        ├─ src/blackboard/apply.ts       … applyHumanFact(人間の発言 → facts)
        ├─ src/blackboard/store.ts       … loadBlackboard / saveBlackboard / newBlackboard
        ├─ src/controller/firing-log.ts  … 各ターンを logs/discord-session.jsonl に追記
        ├─ src/generation/summarizer.ts  … セッション終了時のまとめ生成
        └─ src/discord/format.ts         … 黒板の更新 → EmbedBuilder(純粋関数)
              └─ src/discord/expert-style.ts … 専門家ごとの絵文字 + 埋め込み色
```

`bot.ts` は薄いオーケストレーション層。議論ロジックは STEP 3/4 のモジュールを一切変更せずに再利用する。

## 完了基準の対応

### 誰の発言か一目でわかる

`src/discord/expert-style.ts` が専門家名 → `{ emoji, color }` を返す。
既知の5体は固定(📊 ファンダメンタルズ / 📈 テクニカル / 🌐 マクロ / ⚠️ リスク / 🔍 反証)。
未知の専門家(YAML 追加時)は名前ハッシュから決定論的に割り当てる。
`format.ts` が各発言を Embed の `author`(絵文字 + 名前)と `color` で色分けし、
フッターに「ターン数 / 自己採点 / 提案・事実・未解決の件数」を出す。
人間の入力・コントローラー通知は別スタイル(🧑 / 🧭)。

### 人間の発言が次回の自己採点に反映される

チャンネルの **接頭辞なしの発言** を `applyHumanFact()` で `facts`(`source: "human"`)に追加し、
`history` に `actor: "human"` を記録して保存、📝 リアクションと確認 Embed を返す。
次の `!turn` / `!auto` は毎回ファイルから `loadBlackboard()` するため、
追加された事実は `summarizeBlackboard()` 経由で全専門家の自己採点に渡る。

### セッション終了時に要約が投稿される

`runTurn` が `quiescent && 未解決 open_question 0件`(= `isSessionComplete`)を返したら、
`Summarizer.summarize()` で「論点の分かれ目 / 主要な提案 / 未解決の論点 / 総括」形式の
まとめを生成して投稿し、黒板の `status` を `resolved` にして保存する。
未解決の論点が残っている quiescence では終了せず、人間の追加入力を促す。

## コマンド

| コマンド | 動作 |
|---|---|
| `!goal <お題>` | `newBlackboard()` で黒板をリセットして開始 |
| `!run` | 承認しながら進行(STEP 6)。各ターン前に確認 → ✅/🛑 か `!next`/`!stop` |
| `!next` | 承認待ちのターンを実行 |
| `!turn` | 承認なしで1ターンだけ |
| `!auto [n]` | 承認なしで quiescence まで最大 n ターン(上限 `AUTO_CAP`) |
| `!status` | `formatStatus()` を投稿 |
| `!stop` | guided モード終了 / 承認待ちキャンセル |
| `!help` | ヘルプ |
| 接頭辞なし | `applyHumanFact()` |

- `busy` フラグで多重実行を防止(1ターンずつ逐次処理)。
- `guided` フラグ + `pendingApprovalId` で承認フローの状態を管理。
- コマンド処理中の例外はチャンネルに `⚠️ エラー: ...` として出す。
- 承認フローの詳細は `docs/step6-research.md`。

## モデル / 認証 / 課金

- 採点 `claude-haiku-4-5`、生成・要約 `claude-sonnet-5`、いずれも Claude Agent SDK 経由。
- `USE_MOCK=1`(または `npm run bot:mock`)で `MockScorer` / `MockGenerator` / `MockSummarizer`。
  Discord への投稿の見た目確認を Claude 呼び出しなしでできる。
- Discord Bot トークンは `.env`(gitignore 済み)。`.env.example` 参照。
- 必要 Intent: `Guilds` / `GuildMessages` / `MessageContent`(Portal で MESSAGE CONTENT INTENT を ON)。

## 割り切り / 未対応

- 単一チャンネル・単一セッション(`BLACKBOARD_PATH` 1本)。複数並行は未対応。
- Embed の色分けは Bot 名義のまま。専門家ごとにアイコン・表示名を変えるなら Webhook 方式が必要。
- スラッシュコマンドではなく接頭辞コマンド(ローカル常駐の簡易 Bot のため)。
- `!stop` は協調的キャンセル(進行中の LLM 呼び出しは中断しない)。

## 動作確認

```bash
npm test                 # expert-style / format / summarizer / apply(human fact)含む
npm run bot:mock         # .env に DISCORD_TOKEN / DISCORD_CHANNEL_ID を入れて起動
# チャンネルで:  !goal 架空の銘柄Xは買い時か  →  !auto 5  →  途中で情報を投稿  →  !status
```
