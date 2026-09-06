import type { Blackboard, Expert } from "../types.js";
import { clampScore } from "../scoring/scorer.js";
import type { Contribution } from "../generation/generator.js";

/**
 * 生成された貢献内容(Contribution)を黒板へ追記する純粋関数。
 * - proposals / facts / open_questions の該当セクションに追加
 * - id は各セクションで連番(p1, p2 ... / f1 ... / q1 ...)
 * - history に「誰がいつ何を書いたか」を1件ずつ記録
 * - turn は「その貢献 = 1ターン」で共通の番号を振る
 * 元の blackboard は変更せず、更新済みの新しいオブジェクトを返す。
 */

export type BlackboardSection = "facts" | "proposals" | "open_questions";

export interface AppliedItem {
  section: BlackboardSection;
  id: string;
  content: string;
  sources?: string[];
}

export interface ApplyResult {
  blackboard: Blackboard;
  added: AppliedItem[];
  turn: number;
}

export function applyContribution(
  blackboard: Blackboard,
  expert: Expert,
  contribution: Contribution,
  now: () => string = () => new Date().toISOString(),
): ApplyResult {
  const timestamp = now();
  const turn = blackboard.history.reduce((max, h) => Math.max(max, h.turn), 0) + 1;

  const facts = [...blackboard.facts];
  const proposals = [...blackboard.proposals];
  const openQuestions = [...blackboard.open_questions];
  const history = [...blackboard.history];
  const added: AppliedItem[] = [];

  let proposalSeq = maxSeq(proposals, "p");
  const existingProposalIds = new Set(proposals.map((p) => p.id));
  for (const draft of contribution.proposals) {
    const id = `p${(proposalSeq += 1)}`;
    const respondsTo =
      draft.responds_to && existingProposalIds.has(draft.responds_to) ? draft.responds_to : null;
    const sources = draft.sources && draft.sources.length > 0 ? draft.sources : undefined;
    proposals.push({
      id,
      author: expert.name,
      content: draft.content,
      confidence: clampScore(draft.confidence),
      added_at: timestamp,
      responds_to: respondsTo,
      ...(sources ? { sources } : {}),
    });
    history.push({ turn, actor: expert.name, action: "proposal_added", ref_id: id, timestamp });
    added.push({ section: "proposals", id, content: draft.content, ...(sources ? { sources } : {}) });
  }

  let factSeq = maxSeq(facts, "f");
  for (const draft of contribution.facts) {
    const id = `f${(factSeq += 1)}`;
    const sources = draft.sources && draft.sources.length > 0 ? draft.sources : undefined;
    facts.push({
      id,
      content: draft.content,
      source: expert.name,
      added_at: timestamp,
      ...(sources ? { sources } : {}),
    });
    history.push({ turn, actor: expert.name, action: "fact_added", ref_id: id, timestamp });
    added.push({ section: "facts", id, content: draft.content, ...(sources ? { sources } : {}) });
  }

  let questionSeq = maxSeq(openQuestions, "q");
  for (const draft of contribution.open_questions) {
    const id = `q${(questionSeq += 1)}`;
    openQuestions.push({ id, content: draft.content, raised_by: expert.name, resolved: false });
    history.push({ turn, actor: expert.name, action: "question_added", ref_id: id, timestamp });
    added.push({ section: "open_questions", id, content: draft.content });
  }

  return {
    blackboard: {
      ...blackboard,
      facts,
      proposals,
      open_questions: openQuestions,
      history,
      updated_at: timestamp,
    },
    added,
    turn,
  };
}

/**
 * 人間が黒板に事実を追加する経路(STEP 5)。
 * source は "human"、history の actor も "human" で記録する。
 * 次回の自己採点は黒板要約からこの事実を読むため、追加するだけで発火判定に反映される。
 */
export function applyHumanFact(
  blackboard: Blackboard,
  content: string,
  now: () => string = () => new Date().toISOString(),
): ApplyResult {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("空の事実は追加できません");
  }
  const timestamp = now();
  const turn = blackboard.history.reduce((max, h) => Math.max(max, h.turn), 0) + 1;
  const id = `f${maxSeq(blackboard.facts, "f") + 1}`;

  return {
    blackboard: {
      ...blackboard,
      facts: [...blackboard.facts, { id, content: trimmed, source: "human", added_at: timestamp }],
      history: [
        ...blackboard.history,
        { turn, actor: "human", action: "fact_added", ref_id: id, timestamp },
      ],
      updated_at: timestamp,
    },
    added: [{ section: "facts", id, content: trimmed }],
    turn,
  };
}

/** 既存 id("p3" など)から prefix に一致するものの連番の最大値を返す。なければ 0。 */
function maxSeq(items: { id: string }[], prefix: string): number {
  let max = 0;
  for (const item of items) {
    if (!item.id.startsWith(prefix)) continue;
    const n = Number(item.id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
