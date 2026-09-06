import { clampScore, type ScoreRequest, type ScoreResult, type Scorer } from "./scorer.js";

/**
 * API キー・課金なしで動く決定論的スコアラー。
 * ユニットテストとオフラインでの発火判定ロジック確認に使う。
 *
 * 優先順位:
 *   1. byExpertName に一致すればその値
 *   2. fixedScore が指定されていればその値
 *   3. 役割説明の文字バイグラムが黒板要約にどれだけ現れるか(カバレッジ率)から擬似スコアを生成
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
    const s = coverageScore(req.expert.role_description, req.blackboardSummary);
    return { score: s, raw: `mock:coverage=${s}`, reason: "mock(役割語の黒板カバレッジ)" };
  }
}

function bigrams(s: string): Set<string> {
  const clean = s.replace(/\s+/g, "");
  const out = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) {
    out.add(clean.slice(i, i + 2));
  }
  return out;
}

function coverageScore(role: string, summary: string): number {
  const roleGrams = bigrams(role);
  const summaryGrams = bigrams(summary);
  if (roleGrams.size === 0 || summaryGrams.size === 0) return 0;
  let covered = 0;
  for (const g of roleGrams) {
    if (summaryGrams.has(g)) covered += 1;
  }
  // 役割説明のバイグラムのうち黒板に登場する割合。実測で概ね 0〜0.5 に収まるため 20 倍して展開する。
  const ratio = covered / roleGrams.size;
  return clampScore(ratio * 20);
}
