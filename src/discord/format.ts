import { EmbedBuilder } from "discord.js";
import type { Blackboard } from "../types.js";
import type { TurnContribution } from "../controller/turn.js";
import { HUMAN_STYLE, SYSTEM_STYLE, styleForExpert } from "./expert-style.js";

/**
 * 黒板の更新を Discord の埋め込みメッセージに整形する。
 * discord.js の EmbedBuilder を返すだけの純粋関数群(Client には依存しない)。
 */

const DESC_LIMIT = 4096;
const FIELD_LIMIT = 1024;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function bullets(items: string[]): string {
  return items.map((t) => `• ${t}`).join("\n");
}

function unresolvedCount(bb: Blackboard): number {
  return bb.open_questions.filter((q) => !q.resolved).length;
}

/** 1ターン分の専門家の貢献 */
export function formatContribution(
  contribution: TurnContribution,
  score: number,
  blackboard: Blackboard,
): EmbedBuilder {
  const style = styleForExpert(contribution.expert.name);
  const added = contribution.applied.added;

  const proposalTexts = added
    .filter((a) => a.section === "proposals")
    .map((a) => {
      const proposal = blackboard.proposals.find((p) => p.id === a.id);
      const prefix = proposal?.responds_to ? `↩ ${proposal.responds_to} への応答: ` : "";
      return `${prefix}${a.content}`;
    });
  const factTexts = added.filter((a) => a.section === "facts").map((a) => a.content);
  const questionTexts = added.filter((a) => a.section === "open_questions").map((a) => a.content);
  const sources = [...new Set(added.flatMap((a) => a.sources ?? []))];
  const toolUses = contribution.result.tool_uses;
  const researchNote = toolUses
    ? ` · 調査 ${Object.entries(toolUses).map(([t, n]) => `${t}×${n}`).join(" ")}`
    : "";

  const embed = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor({ name: `${style.emoji} ${contribution.expert.name}` })
    .setDescription(
      truncate(proposalTexts.join("\n\n") || "(提案なし — 事実・論点のみ追加)", DESC_LIMIT),
    )
    .setFooter({
      text:
        `ターン ${contribution.applied.turn} · 自己採点 ${score}/10${researchNote} · ` +
        `提案 ${blackboard.proposals.length} / 事実 ${blackboard.facts.length} / 未解決 ${unresolvedCount(blackboard)}`,
    });

  if (factTexts.length > 0) {
    embed.addFields({ name: "確定事実に追加", value: truncate(bullets(factTexts), FIELD_LIMIT) });
  }
  if (questionTexts.length > 0) {
    embed.addFields({ name: "新たな論点", value: truncate(bullets(questionTexts), FIELD_LIMIT) });
  }
  if (sources.length > 0) {
    embed.addFields({ name: "情報源", value: truncate(bullets(sources), FIELD_LIMIT) });
  }
  return embed;
}

/** 発言者なし(quiescence) */
export function formatQuiescence(sessionComplete: boolean): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SYSTEM_STYLE.color)
    .setAuthor({ name: `${SYSTEM_STYLE.emoji} コントローラー` })
    .setDescription(
      sessionComplete
        ? "全専門家が発言基準に達せず、未解決の論点もありません。**セッションを終了します。**"
        : "全専門家が発言基準に達しませんでした。新しい情報や論点があれば投稿してください(この発言は黒板に追加されます)。",
    );
}

/** 人間が追加した事実 */
export function formatHumanFact(id: string, content: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(HUMAN_STYLE.color)
    .setAuthor({ name: `${HUMAN_STYLE.emoji} 人間の入力 → 黒板に追加` })
    .setDescription(truncate(content, DESC_LIMIT))
    .setFooter({ text: `事実 ${id} として記録。次のターンの自己採点に反映されます。` });
}

/** セッション開始 */
export function formatGoal(blackboard: Blackboard): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SYSTEM_STYLE.color)
    .setAuthor({ name: `${SYSTEM_STYLE.emoji} セッション開始` })
    .setTitle(truncate(blackboard.goal, 256))
    .setDescription(
      "`!run` で承認しながら進行、`!turn` で1ターンだけ、`!status` で現状表示。\n" +
        "接頭辞なしの発言は黒板の事実として追加されます。",
    )
    .setFooter({ text: `session: ${blackboard.session_id} · 免責: 投資助言ではありません` });
}

/** 次のターンを実行してよいかの確認(👍 / ⏹️ のリアクション、または !next / !stop) */
export function formatApprovalRequest(nextTurn: number, blackboard: Blackboard): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: `${SYSTEM_STYLE.emoji} 次のターンの承認` })
    .setDescription(
      `**ターン ${nextTurn} を実行してよいですか?**\n` +
        "👍 このメッセージにリアクション、または `!next` で実行 / ⏹️ か `!stop` で終了。\n" +
        "実行を承認すると、選ばれた専門家は必要に応じて Web 調査を行います(数十秒〜数分)。",
    )
    .setFooter({
      text:
        `未解決 ${unresolvedCount(blackboard)} · ` +
        `提案 ${blackboard.proposals.length} / 事実 ${blackboard.facts.length}`,
    });
}

/** 現在の黒板の状態 */
export function formatStatus(blackboard: Blackboard): EmbedBuilder {
  const recentProposals = blackboard.proposals
    .slice(-5)
    .map((p) => `[${p.id}] ${styleForExpert(p.author).emoji} ${truncate(p.content, 160)}`);
  const unresolved = blackboard.open_questions
    .filter((q) => !q.resolved)
    .map((q) => `[${q.id}] ${truncate(q.content, 160)}`);

  const embed = new EmbedBuilder()
    .setColor(SYSTEM_STYLE.color)
    .setAuthor({ name: `${SYSTEM_STYLE.emoji} 黒板の現状` })
    .setTitle(truncate(blackboard.goal, 256))
    .setFooter({
      text:
        `status=${blackboard.status} · 提案 ${blackboard.proposals.length} / ` +
        `事実 ${blackboard.facts.length} / 未解決 ${unresolvedCount(blackboard)}`,
    });

  if (recentProposals.length > 0) {
    embed.addFields({ name: "直近の提案", value: truncate(recentProposals.join("\n"), FIELD_LIMIT) });
  }
  if (unresolved.length > 0) {
    embed.addFields({ name: "未解決の論点", value: truncate(unresolved.join("\n"), FIELD_LIMIT) });
  }
  return embed;
}

/** セッション終了時のまとめ */
export function formatSessionSummary(summaryText: string, blackboard: Blackboard): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(SYSTEM_STYLE.color)
    .setAuthor({ name: `${SYSTEM_STYLE.emoji} セッションのまとめ` })
    .setTitle(truncate(blackboard.goal, 256))
    .setDescription(truncate(summaryText, DESC_LIMIT))
    .setFooter({
      text:
        `session: ${blackboard.session_id} · ` +
        `提案 ${blackboard.proposals.length} / 事実 ${blackboard.facts.length} / ` +
        `未解決 ${unresolvedCount(blackboard)} · 免責: 投資助言ではありません`,
    });
}
