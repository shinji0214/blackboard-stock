import type { Blackboard } from "../types.js";

/**
 * 黒板の生データをそのまま渡すとトークン消費が大きいため、自己採点の問い合わせ時には
 * blackboard/schema.md「専門家に渡す『要約』フォーマット」の形式に変換して渡す。
 */

export interface SummaryOptions {
  /** facts の直近何件を渡すか(既定 5) */
  maxFacts?: number;
  /** proposals の直近何件を渡すか(既定 5) */
  maxProposals?: number;
}

const DEFAULT_MAX_FACTS = 5;
const DEFAULT_MAX_PROPOSALS = 5;

export function summarizeBlackboard(bb: Blackboard, opts: SummaryOptions = {}): string {
  const maxFacts = opts.maxFacts ?? DEFAULT_MAX_FACTS;
  const maxProposals = opts.maxProposals ?? DEFAULT_MAX_PROPOSALS;

  const recentFacts = bb.facts.slice(-maxFacts);
  const recentProposals = bb.proposals.slice(-maxProposals);
  const unresolved = bb.open_questions.filter((q) => !q.resolved);

  const factLines = recentFacts.length
    ? recentFacts.map((f) => `- ${f.content}(出典: ${f.source})`).join("\n")
    : "- (まだ確定した事実はない)";

  const proposalLines = recentProposals.length
    ? recentProposals
        .map((p) => {
          const ref = p.responds_to ? `(${p.responds_to} への応答)` : "";
          return `- [${p.id}] ${p.author} 自信度${p.confidence}: ${p.content}${ref}`;
        })
        .join("\n")
    : "- (まだ提案はない)";

  const questionLines = unresolved.length
    ? unresolved.map((q) => `- [${q.id}] ${q.content}(提起: ${q.raised_by})`).join("\n")
    : "- (未解決の論点はない)";

  return [
    `お題: ${bb.goal}`,
    "",
    `確定している事実(直近${maxFacts}件):`,
    factLines,
    "",
    `これまでの提案(直近${maxProposals}件、著者名付き):`,
    proposalLines,
    "",
    "未解決の論点:",
    questionLines,
  ].join("\n");
}
