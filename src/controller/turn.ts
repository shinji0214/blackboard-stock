import type { Blackboard, Expert } from "../types.js";
import type { SummaryOptions } from "../blackboard/summary.js";
import { applyContribution, type ApplyResult } from "../blackboard/apply.js";
import {
  GENERATION_SUMMARY_OPTIONS,
  makeGenerateRequest,
  type GenerateResult,
  type Generator,
} from "../generation/generator.js";
import type { Scorer } from "../scoring/scorer.js";
import {
  isSessionComplete,
  selectSpeaker,
  type FiringDecision,
  type SelectSpeakerOptions,
} from "./firing.js";

/**
 * 議論の1ターン:
 *   1. 全専門家が自己採点し、発言者を1人選ぶ(STEP 3)
 *   2. 発言者が本回答を生成し、どのセクションに書くか分類する(STEP 4)
 *   3. 黒板へ追記し、history に記録する(STEP 4)
 *
 * quiescence(発言者なし)の場合は生成をスキップし、黒板は変更しない。
 * 黒板の保存(JSON 上書き)は呼び出し側の責務。
 */

export interface RunTurnOptions {
  /** 自己採点時の黒板要約オプション */
  scoringSummary?: SummaryOptions;
  /** 本回答生成時の黒板要約オプション(既定は採点時より広め) */
  generationSummary?: SummaryOptions;
  /** 同点時の tie-break */
  tieBreak?: SelectSpeakerOptions["tieBreak"];
  /** applyContribution に渡すタイムスタンプ生成関数(テスト用) */
  now?: () => string;
}

export interface TurnContribution {
  expert: Expert;
  result: GenerateResult;
  applied: ApplyResult;
}

export interface TurnResult {
  decision: FiringDecision;
  /** quiescence 時は undefined */
  contribution?: TurnContribution;
  /** 更新後の黒板(quiescence 時は入力と同一) */
  blackboard: Blackboard;
  quiescent: boolean;
  /** open_questions が0件かつ quiescence = セッション終了条件を満たす */
  sessionComplete: boolean;
}

export async function runTurn(
  blackboard: Blackboard,
  experts: Expert[],
  scorer: Scorer,
  generator: Generator,
  options: RunTurnOptions = {},
): Promise<TurnResult> {
  const decision = await selectSpeaker(experts, blackboard, scorer, {
    summary: options.scoringSummary,
    tieBreak: options.tieBreak,
  });

  if (decision.quiescent || !decision.speaker) {
    return {
      decision,
      blackboard,
      quiescent: true,
      sessionComplete: isSessionComplete(blackboard, decision),
    };
  }

  const request = makeGenerateRequest(
    decision.speaker,
    blackboard,
    options.generationSummary ?? GENERATION_SUMMARY_OPTIONS,
  );
  const result = await generator.generate(request);
  const applied = applyContribution(blackboard, decision.speaker, result.contribution, options.now);

  return {
    decision,
    contribution: { expert: decision.speaker, result, applied },
    blackboard: applied.blackboard,
    quiescent: false,
    sessionComplete: false,
  };
}
