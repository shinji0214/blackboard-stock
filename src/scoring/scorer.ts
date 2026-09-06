import type { Blackboard, Expert } from "../types.js";
import { summarizeBlackboard, type SummaryOptions } from "../blackboard/summary.js";

/**
 * 自己採点(発火判定)の共通インターフェース。
 * 各専門家が「自分の出番かどうか」を 0〜10 の自信度スコアで自己判定する。
 * 実装は差し替え可能:
 *   - MockScorer      … API キー・課金不要。ユニットテスト / オフライン確認用
 *   - AgentSdkScorer  … Claude Agent SDK 経由で claude-haiku-4-5 を呼ぶ
 */

export interface ScoreRequest {
  expert: Expert;
  /** summarizeBlackboard() で生成した黒板要約 */
  blackboardSummary: string;
}

export interface ScoreResult {
  /** 0〜10 に丸めた自信度スコア */
  score: number;
  /** モデル/実装が返した生テキスト(デバッグ用) */
  raw: string;
  /** モデルが返した一言理由(任意) */
  reason?: string;
}

export interface Scorer {
  score(req: ScoreRequest): Promise<ScoreResult>;
}

export const SCORING_SYSTEM_PROMPT = `あなたはマルチエージェント議論システムの「発火判定器」です。
一人の専門家の役割説明と、現在の黒板(議論の状態)の要約が与えられます。
その専門家がいま発言することで議論にどれだけ価値を加えられるかを、0〜10 の整数スコアで評価してください。

判定の目安:
- 8〜10: その専門家の専門領域にまさに関わる論点・提案・未解決の質問が黒板にあり、まだ十分に語られていない
- 4〜7 : 関連はあるが、既に他の専門家が触れている、または判断材料が不足している
- 0〜3 : その専門家の出番ではない。専門外、または既に議論し尽くされている

出力は次の2行だけ。それ以外は一切出力しないこと:
SCORE: <0〜10の整数>
REASON: <1文の理由>`;

export function buildScoringUserPrompt(req: ScoreRequest): string {
  return `## 専門家の役割
${req.expert.role_description}

## 現在の黒板の要約
${req.blackboardSummary}

この専門家がいま発言する価値を 0〜10 で採点してください。`;
}

const SCORE_LINE = /SCORE:\s*(-?\d+(?:\.\d+)?)/i;
const REASON_LINE = /REASON:\s*(.+)/i;

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** モデル応答テキストからスコアと理由を取り出す。想定形式を外れても可能な限り数値を拾う。 */
export function parseScoreResponse(raw: string): { score: number; reason?: string } {
  const scoreMatch = raw.match(SCORE_LINE);
  let score: number;
  if (scoreMatch) {
    score = Number(scoreMatch[1]);
  } else {
    const loose = raw.match(/\d{1,2}/);
    score = loose ? Number(loose[0]) : 0;
  }
  const reasonMatch = raw.match(REASON_LINE);
  return { score: clampScore(score), reason: reasonMatch?.[1]?.trim() };
}

export function makeScoreRequest(
  expert: Expert,
  blackboard: Blackboard,
  summaryOpts?: SummaryOptions,
): ScoreRequest {
  return { expert, blackboardSummary: summarizeBlackboard(blackboard, summaryOpts) };
}
