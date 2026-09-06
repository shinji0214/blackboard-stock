import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Blackboard } from "../types.js";
import type { AppliedItem } from "../blackboard/apply.js";
import { isSessionComplete, type FiringDecision } from "./firing.js";

/**
 * 1ターン分の実行ログ。
 * 「誰が何点を付けたか」「なぜその専門家が選ばれた/選ばれなかったか」に加え、
 * STEP 4 では選出された専門家が黒板のどこに何を書いたかも記録する。
 */

export interface FiringScoreLog {
  expert: string;
  score: number;
  threshold: number;
  eligible: boolean;
  reason?: string;
  /** スコアラーが返した生テキスト(デバッグ用) */
  raw: string;
}

export interface FiringContributionLog {
  expert: string;
  turn: number;
  added: AppliedItem[];
  /** 生成中に使った組み込みツールの呼び出し回数(例: { WebSearch: 2 }) */
  tool_uses?: Record<string, number>;
  /** ジェネレーターが返した生テキスト(デバッグ用) */
  raw: string;
}

export interface FiringRunLog {
  logged_at: string;
  session_id: string;
  goal: string;
  /** "MockScorer" | "AgentSdkScorer" など */
  scorer: string;
  model?: string;
  /** 本回答生成に使ったジェネレーター("AgentSdkGenerator" など) */
  generator?: string;
  generator_model?: string;
  blackboard_path: string;
  /** 採点に渡した黒板要約 */
  summary: string;
  scores: FiringScoreLog[];
  decision: {
    speaker: string | null;
    quiescent: boolean;
    session_complete: boolean;
  };
  /** STEP 4: 選出された専門家が黒板に追記した内容(quiescence 時は undefined) */
  contribution?: FiringContributionLog;
}

export function buildFiringRunLog(params: {
  blackboard: Blackboard;
  blackboardPath: string;
  decision: FiringDecision;
  scorer: string;
  model?: string;
  generator?: string;
  generatorModel?: string;
  contribution?: FiringContributionLog;
}): FiringRunLog {
  const { blackboard, blackboardPath, decision, scorer, model } = params;
  return {
    logged_at: new Date().toISOString(),
    session_id: blackboard.session_id,
    goal: blackboard.goal,
    scorer,
    ...(model ? { model } : {}),
    ...(params.generator ? { generator: params.generator } : {}),
    ...(params.generatorModel ? { generator_model: params.generatorModel } : {}),
    blackboard_path: blackboardPath,
    summary: decision.summary,
    scores: decision.scores.map((s) => ({
      expert: s.expert.name,
      score: s.result.score,
      threshold: s.expert.min_confidence_to_speak,
      eligible: s.eligible,
      reason: s.result.reason,
      raw: s.result.raw,
    })),
    decision: {
      speaker: decision.speaker?.name ?? null,
      quiescent: decision.quiescent,
      session_complete: isSessionComplete(blackboard, decision),
    },
    ...(params.contribution ? { contribution: params.contribution } : {}),
  };
}

/**
 * JSONL(1行1レコード)形式で追記する。ディレクトリは自動作成。
 * 追記型なので複数回の発火判定がそのまま議論の進行ログになる。
 */
export async function appendFiringLog(logPath: string, entry: FiringRunLog): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}
