import { existsSync } from "node:fs";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type EmbedBuilder,
  type Message,
  type SendableChannels,
} from "discord.js";
import { applyHumanFact } from "../blackboard/apply.js";
import { loadBlackboard, newBlackboard, saveBlackboard } from "../blackboard/store.js";
import { loadExperts } from "../experts/loader.js";
import { appendFiringLog, buildFiringRunLog } from "../controller/firing-log.js";
import { runTurn } from "../controller/turn.js";
import type { Scorer } from "../scoring/scorer.js";
import type { Generator } from "../generation/generator.js";
import {
  AgentSdkSummarizer,
  MockSummarizer,
  type Summarizer,
} from "../generation/summarizer.js";
import { MockScorer } from "../scoring/mock-scorer.js";
import { AgentSdkScorer } from "../scoring/agent-sdk-scorer.js";
import { MockGenerator } from "../generation/mock-generator.js";
import { AgentSdkGenerator } from "../generation/agent-sdk-generator.js";
import {
  formatApprovalRequest,
  formatContribution,
  formatGoal,
  formatHumanFact,
  formatQuiescence,
  formatSessionSummary,
  formatStatus,
} from "./format.js";

const HAIKU_MODEL = "claude-haiku-4-5";
const SONNET_MODEL = "claude-sonnet-5";
const APPROVE_EMOJI = "✅";
const STOP_EMOJI = "🛑";

export interface BotConfig {
  token: string;
  channelId: string;
  blackboardPath: string;
  logPath: string;
  expertsDir: string;
  /** true なら Mock 実装で動く(API 不要) */
  useMock: boolean;
  /** !auto / !run の最大ターン数 */
  autoCap: number;
}

const HELP = [
  "**黒板方式ディスカッション Bot**",
  "`!goal <お題>` — 新しいセッションを開始(黒板をリセット)",
  "`!run` — 承認しながら1ターンずつ進行(各ターン前に確認を出す)",
  "`!next` — 承認待ちのターンを実行(✅ リアクションでも可)",
  "`!turn` — 承認なしで1ターンだけ進行",
  "`!auto [n]` — 承認なしで quiescence まで自動進行(最大 n)",
  "`!status` — 黒板の現状を表示",
  "`!stop` — 進行を止める(🛑 リアクションでも可)",
  "`!help` — このヘルプ",
  "接頭辞なしの発言はそのまま黒板の事実として追加され、次の採点に反映されます。",
].join("\n");

export function createClients(config: BotConfig): {
  scorer: Scorer;
  generator: Generator;
  summarizer: Summarizer;
} {
  if (config.useMock) {
    return { scorer: new MockScorer(), generator: new MockGenerator(), summarizer: new MockSummarizer() };
  }
  return {
    scorer: new AgentSdkScorer({ model: HAIKU_MODEL }),
    generator: new AgentSdkGenerator({ model: SONNET_MODEL }),
    summarizer: new AgentSdkSummarizer({ model: SONNET_MODEL }),
  };
}

export async function startBot(config: BotConfig): Promise<Client> {
  const experts = await loadExperts(config.expertsDir);
  const { scorer, generator, summarizer } = createClients(config);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
  });

  let busy = false;
  /** 承認しながら進行するモード(!run で開始、!stop / 🛑 / quiescence で終了) */
  let guided = false;
  /** 承認待ちの「次のターン確認」メッセージ id */
  let pendingApprovalId: string | null = null;

  const getChannel = async (): Promise<SendableChannels> => {
    const channel = await client.channels.fetch(config.channelId);
    if (!channel || !channel.isSendable()) {
      throw new Error(`チャンネル ${config.channelId} が見つからない、または送信できません`);
    }
    return channel;
  };

  const post = async (embed: EmbedBuilder): Promise<void> => {
    const channel = await getChannel();
    await channel.send({ embeds: [embed] });
  };

  const hasSession = (): boolean => existsSync(config.blackboardPath);

  const runOneTurn = async (): Promise<{ quiescent: boolean }> => {
    const blackboard = await loadBlackboard(config.blackboardPath);
    const result = await runTurn(blackboard, experts, scorer, generator);

    const runLog = buildFiringRunLog({
      blackboard,
      blackboardPath: config.blackboardPath,
      decision: result.decision,
      scorer: config.useMock ? "MockScorer" : "AgentSdkScorer",
      model: config.useMock ? undefined : HAIKU_MODEL,
      generator: result.contribution ? (config.useMock ? "MockGenerator" : "AgentSdkGenerator") : undefined,
      generatorModel: result.contribution && !config.useMock ? SONNET_MODEL : undefined,
      contribution: result.contribution
        ? {
            expert: result.contribution.expert.name,
            turn: result.contribution.applied.turn,
            added: result.contribution.applied.added,
            ...(result.contribution.result.tool_uses
              ? { tool_uses: result.contribution.result.tool_uses }
              : {}),
            raw: result.contribution.result.raw,
          }
        : undefined,
    });
    await appendFiringLog(config.logPath, runLog);

    if (result.quiescent || !result.contribution) {
      await post(formatQuiescence(result.sessionComplete));
      if (result.sessionComplete) {
        const summaryText = await summarizer.summarize(blackboard);
        await post(formatSessionSummary(summaryText, blackboard));
        await saveBlackboard(config.blackboardPath, {
          ...blackboard,
          status: "resolved",
          updated_at: new Date().toISOString(),
        });
      }
      return { quiescent: true };
    }

    await saveBlackboard(config.blackboardPath, result.blackboard);
    await post(
      formatContribution(
        result.contribution,
        result.decision.scores[0]?.result.score ?? 0,
        result.blackboard,
      ),
    );
    return { quiescent: false };
  };

  const promptNextTurn = async (): Promise<void> => {
    const blackboard = await loadBlackboard(config.blackboardPath);
    const nextTurn = blackboard.history.reduce((max, h) => Math.max(max, h.turn), 0) + 1;
    const channel = await getChannel();
    const msg = await channel.send({ embeds: [formatApprovalRequest(nextTurn, blackboard)] });
    pendingApprovalId = msg.id;
    await msg.react(APPROVE_EMOJI).catch(() => {});
    await msg.react(STOP_EMOJI).catch(() => {});
  };

  /** 承認された1ターンを実行し、guided なら次の確認を出す */
  const advance = async (): Promise<void> => {
    pendingApprovalId = null;
    const { quiescent } = await runOneTurn();
    if (quiescent || !guided) {
      guided = false;
      return;
    }
    await promptNextTurn();
  };

  const endGuided = async (): Promise<void> => {
    guided = false;
    pendingApprovalId = null;
    const channel = await getChannel().catch(() => null);
    await channel?.send("進行を停止しました。`!run` か `!turn` で再開できます。").catch(() => {});
  };

  const withLock = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error(err);
      const channel = await getChannel().catch(() => null);
      await channel?.send(`⚠️ エラー: ${(err as Error).message}`).catch(() => {});
    } finally {
      busy = false;
    }
  };

  const requireSession = async (message: Message): Promise<boolean> => {
    if (hasSession()) return true;
    await message.reply("まだセッションがありません。`!goal <お題>` で開始してください。");
    return false;
  };

  const handleCommand = async (message: Message, raw: string): Promise<void> => {
    const [command, ...rest] = raw.slice(1).trim().split(/\s+/);
    const arg = rest.join(" ");

    switch (command) {
      case "help":
        await message.reply(HELP);
        return;

      case "goal": {
        if (!arg) {
          await message.reply("お題を指定してください: `!goal <お題>`");
          return;
        }
        await withLock(async () => {
          guided = false;
          pendingApprovalId = null;
          const blackboard = newBlackboard(arg);
          await saveBlackboard(config.blackboardPath, blackboard);
          await post(formatGoal(blackboard));
        });
        return;
      }

      case "status":
        await withLock(async () => {
          if (!(await requireSession(message))) return;
          await post(formatStatus(await loadBlackboard(config.blackboardPath)));
        });
        return;

      case "stop":
        if (guided || pendingApprovalId) {
          await endGuided();
        } else {
          await message.reply("進行中のセッションはありません。");
        }
        return;

      case "run":
        await withLock(async () => {
          if (!(await requireSession(message))) return;
          guided = true;
          await promptNextTurn();
        });
        return;

      case "next":
        await withLock(async () => {
          if (!pendingApprovalId) {
            await message.reply("承認待ちのターンがありません。`!run` で開始してください。");
            return;
          }
          guided = true;
          await advance();
        });
        return;

      case "turn":
        await withLock(async () => {
          if (!(await requireSession(message))) return;
          await runOneTurn();
        });
        return;

      case "auto": {
        const cap = Math.min(config.autoCap, Math.max(1, Number(arg) || config.autoCap));
        await withLock(async () => {
          if (!(await requireSession(message))) return;
          for (let i = 0; i < cap; i += 1) {
            const { quiescent } = await runOneTurn();
            if (quiescent) break;
          }
        });
        return;
      }

      default:
        await message.reply(`不明なコマンド: \`${command}\`。\`!help\` を参照。`);
    }
  };

  const handleHumanFact = async (message: Message): Promise<void> => {
    await withLock(async () => {
      if (!(await requireSession(message))) return;
      const blackboard = await loadBlackboard(config.blackboardPath);
      const applied = applyHumanFact(blackboard, message.content);
      await saveBlackboard(config.blackboardPath, applied.blackboard);
      await message.react("📝").catch(() => {});
      await post(formatHumanFact(applied.added[0]!.id, applied.added[0]!.content));
    });
  };

  client.once(Events.ClientReady, async (c) => {
    console.log(
      `ログイン: ${c.user.tag}  ${config.useMock ? "[Mock]" : "[AgentSdk]"}`,
    );
    console.log(`参加サーバー: ${[...c.guilds.cache.values()].map((g) => g.name).join(", ") || "(なし)"}`);
    try {
      const channel = await c.channels.fetch(config.channelId);
      if (!channel) {
        console.error(`⚠️ チャンネル ${config.channelId} が見つかりません。DISCORD_CHANNEL_ID を確認してください。`);
      } else if (!channel.isSendable()) {
        console.error(`⚠️ チャンネル ${config.channelId} に送信できません(権限を確認してください)。`);
      } else {
        const name = "name" in channel ? channel.name : channel.id;
        console.log(`投稿先チャンネル: #${name} (${config.channelId})  待機中。Discord で !goal <お題> を送ってください。`);
      }
    } catch (err) {
      console.error(`⚠️ チャンネル取得に失敗: ${(err as Error).message}`);
    }
  });

  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;

    if (message.channelId !== config.channelId) {
      console.log(`[別チャンネル ${message.channelId} のメッセージを無視] 想定は ${config.channelId}`);
      return;
    }

    const content = message.content.trim();
    console.log(`[受信] ${message.author.tag}: ${JSON.stringify(message.content)} (${message.content.length}文字)`);

    if (message.content.length === 0) {
      console.error(
        "⚠️ メッセージ本文が空です。Discord Developer Portal の Bot 設定で " +
          "MESSAGE CONTENT INTENT を ON にして Bot を再起動してください。",
      );
      return;
    }
    if (!content) return;

    if (content.startsWith("!")) {
      void handleCommand(message, content);
    } else {
      void handleHumanFact(message);
    }
  });

  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void (async () => {
      if (user.bot) return;
      try {
        if (reaction.partial) await reaction.fetch();
      } catch {
        return;
      }
      if (!pendingApprovalId || reaction.message.id !== pendingApprovalId) return;
      if (reaction.message.channelId !== config.channelId) return;

      if (reaction.emoji.name === APPROVE_EMOJI) {
        await withLock(async () => {
          if (!pendingApprovalId) return;
          guided = true;
          await advance();
        });
      } else if (reaction.emoji.name === STOP_EMOJI) {
        await endGuided();
      }
    })();
  });

  client.on(Events.Error, (err) => console.error(`Discord クライアントエラー: ${err.message}`));
  client.on(Events.Warn, (msg) => console.warn(`Discord 警告: ${msg}`));

  console.log("Discord に接続中...");
  await client.login(config.token);
  return client;
}
