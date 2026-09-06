import {
  normalizeContribution,
  type Contribution,
  type GenerateRequest,
  type GenerateResult,
  type Generator,
} from "./generator.js";

/**
 * API 不要の決定論的ジェネレーター。テストとオフライン確認用。
 *
 * 優先順位:
 *   1. byExpertName に一致すればその貢献
 *   2. contribution が指定されていればそれ
 *   3. 「専門家名の見解」1件の proposal を返す既定動作
 */
export interface MockGeneratorOptions {
  contribution?: Partial<Contribution>;
  byExpertName?: Record<string, Partial<Contribution>>;
}

export class MockGenerator implements Generator {
  constructor(private readonly opts: MockGeneratorOptions = {}) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const template =
      this.opts.byExpertName?.[req.expert.name] ??
      this.opts.contribution ?? {
        proposals: [
          {
            content: `${req.expert.name}の暫定的な見解(mock)。黒板の状態を踏まえた擬似的な貢献。`,
            confidence: 6,
            responds_to: null,
          },
        ],
        facts: [],
        open_questions: [],
      };

    return {
      contribution: normalizeContribution(template),
      raw: `mock:${JSON.stringify(template)}`,
    };
  }
}
