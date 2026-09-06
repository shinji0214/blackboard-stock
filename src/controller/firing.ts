import type { Blackboard, Expert } from "../types.js";
import { summarizeBlackboard, type SummaryOptions } from "../blackboard/summary.js";
import type { ScoreResult, Scorer } from "../scoring/scorer.js";

/**
 * STEP 3: 自己採点(発火判定)ロジック。
 *
 * GroupChat 方式(司会役が指名)とは異なり、誰も指名しない。
 * 全専門家が黒板の状態に対して自己採点し、min_confidence_to_speak を満たす中で
 * 最高スコアの専門家が自発的に発言する。全員が閾値未満なら発言者なし(quiescence)。
 */

export interface ExpertScore {
  expert: Expert;
  result: ScoreResult;
  /** min_confidence_to_speak を満たしているか */
  eligible: boolean;
}

export interface FiringDecision {
  /** 選出された専門家。全員が閾値未満なら null */
  speaker: Expert | null;
  /** quiescence: 発言権を持つ専門家が一人もいない状態 */
  quiescent: boolean;
  /** 全専門家のスコア(スコア降順、同点は tieBreak 順にソート済み) */
  scores: ExpertScore[];
  /** 採点に使った黒板要約 */
  summary: string;
}

export interface SelectSpeakerOptions {
  /** 黒板要約の生成オプション(直近何件を渡すか等) */
  summary?: SummaryOptions;
  /**
   * 同点時の順序を決める比較関数。
   * 既定は専門家の定義順(experts 配列の並び = YAML ファイル名順)。
   */
  tieBreak?: (a: ExpertScore, b: ExpertScore) => number;
}

export async function selectSpeaker(
  experts: Expert[],
  blackboard: Blackboard,
  scorer: Scorer,
  options: SelectSpeakerOptions = {},
): Promise<FiringDecision> {
  if (experts.length === 0) {
    throw new Error("専門家が0体です");
  }

  const summary = summarizeBlackboard(blackboard, options.summary);
  const definitionOrder = new Map(experts.map((e, i) => [e.name, i]));

  const scores: ExpertScore[] = await Promise.all(
    experts.map(async (expert) => {
      const result = await scorer.score({ expert, blackboardSummary: summary });
      return {
        expert,
        result,
        eligible: result.score >= expert.min_confidence_to_speak,
      };
    }),
  );

  const tieBreak =
    options.tieBreak ??
    ((a, b) =>
      (definitionOrder.get(a.expert.name) ?? 0) - (definitionOrder.get(b.expert.name) ?? 0));

  scores.sort((a, b) => b.result.score - a.result.score || tieBreak(a, b));

  const eligible = scores.filter((s) => s.eligible);
  const quiescent = eligible.length === 0;

  return {
    speaker: quiescent ? null : eligible[0]!.expert,
    quiescent,
    scores,
    summary,
  };
}

/**
 * セッション全体の終了条件。
 * blackboard/schema.md より: 「open_questions が0件かつ全専門家が低スコアになったら終了」。
 */
export function isSessionComplete(blackboard: Blackboard, decision: FiringDecision): boolean {
  const hasUnresolved = blackboard.open_questions.some((q) => !q.resolved);
  return decision.quiescent && !hasUnresolved;
}
