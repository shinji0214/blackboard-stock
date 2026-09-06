/**
 * STEP 5: Discord Bot エントリポイント(ローカル PC ホスティング)。
 *
 *   1. Discord Developer Portal で Bot を作成し、Privileged Gateway Intents の
 *      "MESSAGE CONTENT INTENT" を ON にする
 *   2. .env を用意(.env.example をコピー)して DISCORD_TOKEN と DISCORD_CHANNEL_ID を設定
 *   3. npm run bot         … AgentSdk(haiku 採点 + sonnet 生成/要約)
 *      npm run bot:mock    … Mock(API 不要、投稿の見た目確認用)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { startBot } from "../src/discord/bot.js";

loadEnv({ quiet: true });

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`環境変数 ${name} が未設定です。.env を確認してください(.env.example 参照)。`);
    process.exit(1);
  }
  return value;
}

const useMock = process.argv.includes("--mock") || process.env.USE_MOCK === "1";
const blackboardPath = path.resolve(
  process.env.BLACKBOARD_PATH ?? path.join(root, "blackboard-data", "session-live.json"),
);

const client = await startBot({
  token: required("DISCORD_TOKEN"),
  channelId: required("DISCORD_CHANNEL_ID"),
  blackboardPath,
  logPath: path.join(root, "logs", "discord-session.jsonl"),
  expertsDir: path.join(root, "experts"),
  useMock,
  autoCap: Math.max(1, Number(process.env.AUTO_CAP) || 8),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n${signal} 受信。切断します。`);
    void client.destroy().then(() => process.exit(0));
  });
}
