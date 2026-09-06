# Blackboard Stock Advisor

黒板方式(Blackboard Architecture)を模倣したマルチエージェント議論プロトタイプ。
初回のお題は「株購入予想」。

> **免責事項**: これは黒板方式というマルチエージェント設計パターンを学習・検証するための
> プロトタイプであり、実際の投資判断の根拠として使うことは意図していません。
> 各専門家の system_prompt にも「断定的な投資助言はしない」旨を明記しています。

設計の全体像・完了基準は [STEPS.md](./STEPS.md) を参照。
黒板のデータ構造は [blackboard/schema.md](./blackboard/schema.md) を参照。

## 設計の基本方針

- **黒板構造・コントローラーはドメイン非依存で汎用のまま固定する**
- **専門家(知識源)だけを `experts/*.yaml` として差し替え可能にする**
- 発火判定(自分の出番かどうか)は、軽量モデルによる0〜10の自己採点方式
- GroupChat方式(司会役が指名)とは異なり、誰も指名しない。最高スコアの専門家が自発的に発言する

## 現在の実装状況

- [x] STEP 1: 黒板の構造設計(`blackboard/schema.md`, JSONスキーマ検証済み)
- [x] STEP 2: 専門家プラグイン形式の確定(`experts/*.yaml` 5体、必須フィールド検証済み)
- [x] STEP 3: 自己採点(発火判定)ロジックの実装(`src/scoring/`, `src/controller/firing.ts`)
- [x] STEP 4: 本回答生成と黒板への書き込み(`src/generation/`, `src/blackboard/apply.ts`, `src/controller/turn.ts`)
- [x] STEP 5: Discordへの投稿(`src/discord/`, `scripts/run-bot.ts`)
- [x] STEP 6(拡張): 専門家による Web 調査(`experts/*.yaml` の `tools`、Discord は1ターンごとに承認)

## ディレクトリ構成

```
blackboard-stock-advisor/
├── STEPS.md                        # 全体ロードマップ・完了基準
├── README.md                       # このファイル
├── .env.example                   # STEP 5: Discord Bot の設定サンプル
├── docs/
│   ├── step3-firing.md             # STEP 3(自己採点)の設計メモ
│   ├── step4-generation.md         # STEP 4(本回答生成・黒板書き込み)の設計メモ
│   ├── step5-discord.md            # STEP 5(Discord 連携)の設計メモ
│   └── step6-research.md           # STEP 6(専門家の Web 調査)の設計メモ
├── blackboard/
│   └── schema.md                   # 黒板のデータ構造定義
├── blackboard-data/
│   ├── session-sample.json         # 黒板の初期状態サンプル(空)
│   ├── session-stock-outlook.json  # 架空の銘柄Xのサンプル(Mock/オフライン確認用)
│   └── session-nvda.json           # 実在銘柄(NVDA)のサンプル(Web調査あり)
├── experts/                        # 専門家プラグイン(差し替え可能)
│   ├── fundamentals.yaml           # ファンダメンタルズ専門家(tools: WebSearch/WebFetch)
│   ├── technical.yaml              # テクニカル専門家(tools: WebSearch/WebFetch)
│   ├── macro-sentiment.yaml        # マクロ・センチメント専門家(tools: WebSearch/WebFetch)
│   ├── risk.yaml                   # リスク専門家(tools: WebSearch/WebFetch)
│   └── devils-advocate.yaml        # 反証専門家(同調バイアス対策、調査ツールなし)
├── src/
│   ├── types.ts                    # ドメイン型(Blackboard / Expert)
│   ├── blackboard/
│   │   ├── store.ts                # 黒板 JSON の読み書き
│   │   └── summary.ts              # 自己採点用の黒板要約フォーマット
│   ├── experts/loader.ts           # experts/*.yaml のロード + バリデーション
│   ├── scoring/                    # STEP 3: 自己採点
│   │   ├── scorer.ts               # Scorer インターフェース・採点プロンプト・応答パーサ
│   │   ├── mock-scorer.ts          # 決定論的スコアラー(API不要、テスト用)
│   │   └── agent-sdk-scorer.ts     # Claude Agent SDK 経由(claude-haiku-4-5)
│   ├── generation/                 # STEP 4: 本回答生成
│   │   ├── generator.ts            # Generator インターフェース・生成プロンプト・JSON パーサ
│   │   ├── mock-generator.ts       # 決定論的ジェネレーター(API不要、テスト用)
│   │   └── agent-sdk-generator.ts  # Claude Agent SDK 経由(claude-sonnet-5、tools 指定で Web 調査)
│   ├── generation/summarizer.ts    # STEP 5: セッション終了時のまとめ生成(Mock / claude-sonnet-5)
│   ├── blackboard/apply.ts         # Contribution / 人間の事実を黒板へ追記する純粋関数
│   ├── discord/                    # STEP 5: Discord 連携
│   │   ├── expert-style.ts         # 専門家ごとの絵文字 + 埋め込み色(既知5体は固定)
│   │   ├── format.ts               # 黒板の更新 → Discord 埋め込みメッセージ(純粋関数)
│   │   └── bot.ts                  # Bot 本体(コマンド処理・ターン進行・投稿)
│   └── controller/
│       ├── firing.ts               # 発火判定: 採点 → 閾値 → 最高スコア選出 / quiescence
│       ├── firing-log.ts           # 1ターン分(採点 + 貢献)を JSONL ログに追記
│       └── turn.ts                 # 1ターン: 採点 → 選出 → 生成 → 黒板追記
├── scripts/
│   ├── run-firing.ts               # STEP 3 の動作確認 CLI(採点まで)
│   ├── run-turn.ts                 # STEP 4 の動作確認 CLI(黒板書き込みまで、--loop 対応)
│   └── run-bot.ts                  # STEP 5 の Discord Bot エントリポイント
├── logs/                           # 実行ログ(*.jsonl、gitignore)
└── test/                           # vitest(78 ケース)
```

## セットアップ

```bash
npm install
npm test                 # ロジックのユニットテスト(API不要)
npm run firing:mock      # MockScorer で発火判定を実行(API不要)
npm run firing           # AgentSdkScorer で実行(Claude Code と同じログイン認証を使用)
npm run firing -- blackboard-data/session-stock-outlook.json   # 黒板ファイルを指定
npm run firing -- --json          # 実行結果を JSON で標準出力にも出す
npm run firing -- --log logs/x.jsonl   # ログ出力先を指定  / --no-log で無効化

npm run turn:mock        # 1ターン(採点→選出→生成→黒板追記)を Mock で実行(API不要)
npm run turn -- blackboard-data/session-nvda.json     # 実在銘柄。tools 付き専門家は Web 調査する(1ターン数分)
npm run turn -- blackboard-data/session-stock-outlook.json --loop 5   # quiescence まで最大5ターン
npm run turn -- blackboard-data/xxx.json --dry-run   # 黒板を保存せず結果だけ表示

cp .env.example .env     # DISCORD_TOKEN と DISCORD_CHANNEL_ID を設定
npm run bot:mock         # Discord Bot を Mock で起動(投稿の見た目確認、Claude 呼び出しなし)
npm run bot              # Discord Bot を起動(haiku 採点 + sonnet 生成/要約)
```

### Discord Bot(STEP 5)

1. Discord Developer Portal で Bot を作成し、**MESSAGE CONTENT INTENT** を ON にする
   (`!run` の承認リアクションを使うので **SERVER MEMBERS INTENT** は不要だが、リアクション受信のため
   Bot の招待時に「リアクションの追加」「メッセージ履歴を読む」権限を付けること)
2. Bot をサーバーに招待(権限: メッセージ送信・埋め込みリンク・リアクション追加・メッセージ履歴)
3. `.env` に `DISCORD_TOKEN` と投稿先の `DISCORD_CHANNEL_ID` を設定して `npm run bot`
   (`.env` は gitignore 済み。`.env.example` には実トークンを書かないこと)

チャンネルでのコマンド:

| コマンド | 動作 |
|---|---|
| `!goal <お題>` | 新しいセッションを開始(黒板をリセット) |
| `!run` | **1ターンごとに承認を取りながら進行**。各ターン前に確認メッセージを出す(推奨) |
| `!next` | 承認待ちのターンを実行(確認メッセージへの ✅ リアクションでも可) |
| `!turn` | 承認なしで1ターンだけ進行 |
| `!auto [n]` | 承認なしで quiescence まで自動進行(最大 n、既定 `AUTO_CAP`) |
| `!status` | 黒板の現状を投稿 |
| `!stop` | 進行を止める(確認メッセージへの 🛑 リアクションでも可) |
| 接頭辞なしの発言 | そのまま黒板の `facts` に追加され、次のターンの自己採点に反映される |

`tools` を持つ専門家が選ばれたターンでは、承認後に Web 調査(WebSearch / WebFetch)を行うため
完了まで数十秒〜数分かかる。取得した情報源の URL は proposals / facts に添えて黒板と投稿に残る。

セッション終了条件(全専門家が発言基準未満 かつ 未解決の論点0件)を満たすと、
議論のまとめを生成して投稿し、黒板の `status` を `resolved` にする。

`turn` は選出された専門家に本回答を生成させ、`facts` / `proposals` / `open_questions` の
該当セクションへ追記し、`history` に記録して黒板 JSON を上書き保存する。
`firing` / `turn` は実行のたびに全専門家のスコア・理由・選出結果(+ turn の場合は追記内容)を
`logs/firing-<session_id>.jsonl`(1行1レコードの JSONL)へ追記する。
追記型なので、複数回実行するとそのまま議論の進行ログになる。

`firing` / `turn` / `bot` は `@anthropic-ai/claude-agent-sdk` 経由で
自己採点に `claude-haiku-4-5`、本回答生成・要約に `claude-sonnet-5` を呼ぶ。
Claude Code にログイン済みであれば Pro/Max サブスクリプションの範囲で動作し、追加の API 課金は不要
(`ANTHROPIC_API_KEY` が設定されている場合はそちらが優先される)。
`--mock` / `bot:mock` / `USE_MOCK=1` なら Claude 呼び出しなしで動く。

## 専門家を増やす/入れ替えるには

`experts/` に新しいYAMLファイルを追加するだけです。コントローラー側のコード変更は不要な設計です。
必須フィールドは4つ:

```yaml
name: "専門家の表示名"
role_description: "コントローラーが自己採点を依頼する際に使う、役割の一行説明"
min_confidence_to_speak: 6   # このスコア未満なら発言権なし
tools: ["WebSearch", "WebFetch"]   # 任意。付けると本回答生成時に Web 調査できる(許可値はこの2つのみ)
system_prompt: |
  実際にLLMに渡すシステムプロンプト
```

`tools` を省略すると従来どおり調査なし・1ターンで生成。コントローラー側のコード変更は不要です。

## 既知の課題(チューニング対象)

- 同じ専門家が連続で発言できる(連続発言の抑制ルールがない)
- `open_questions` の `resolved` を立てる処理が未実装(現状は quiescence でのみ停止)
- Discord Bot は単一チャンネル・単一セッション前提(`BLACKBOARD_PATH` 1本)
- Web 調査ありのターンは数分かかりレート制限にも当たりやすい。`researchMaxTurns`(既定8)で調整
