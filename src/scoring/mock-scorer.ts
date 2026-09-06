import { clampScore, type ScoreRequest, type ScoreResult, type Scorer } from "./scorer.js";

/**
 * API キー・課金なしで動く決定論的スコアラー。
 * ユニットテストとオフライン(Mock)での発火判定・進行の確認に使う。
 *
 * 優先順位:
 *   1. byExpertName に一致すればその値
 *   2. fixedScore が指定されていればその値
 *   3. 既定: 黒板要約に含まれる提案数で逓減するスコア
 *      提案 0件→9 / 1件→7 / 2件→5 / 3件以上→3
 *      これにより Mock でも「数ターン発言 → 全員が閾値割れで quiescence → 要約」まで一通り再現できる。
 */

export interface MockScorerOptions {
  fixedScore?: number;
  byExpertName?: Record<string, number>;
}

export class MockScorer implements Scorer {
  constructor(private readonly opts: MockScorerOptions = {}) {}

  async score(req: ScoreRequest): Promise<ScoreResult> {
    const mapped = this.opts.byExpertName?.[req.expert.name];
    if (typeof mapped === "number") {
      const s = clampScore(mapped);
      return { score: s, raw: `mock:byExpertName=${s}`, reason: "mock(名前指定)" };
    }
    if (typeof this.opts.fixedScore === "number") {
      const s = clampScore(this.opts.fixedScore);
      return { score: s, raw: `mock:fixed=${s}`, reason: "mock(固定値)" };
    }
    const proposals = countProposals(req.blackboardSummary);
    const s = clampScore(9 - proposals * 2);
    return {
      score: s,
      raw: `mock:decay(proposals=${proposals})=${s}`,
      reason: `mock(提案${proposals}件で逓減)`,
    };
  }
}

/** 黒板要約に含まれる提案の件数を数える(summarizeBlackboard の "自信度N" 表記を利用) */
function countProposals(summary: string): number {
  return (summary.match(/自信度\d/g) ?? []).length;
}
