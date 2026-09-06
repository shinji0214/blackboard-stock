import { readFile, writeFile } from "node:fs/promises";
import type { Blackboard } from "../types.js";

/**
 * 黒板の永続化。blackboard/schema.md「永続化方式」に従い、
 * 小規模 JSON のため差分更新はせずファイル全体を上書きする。
 * 排他制御はコントローラー1プロセス前提のため省略(将来複数プロセス化する場合はここに追加)。
 *
 * updated_at は applyContribution が管理するため、saveBlackboard は渡された内容をそのまま書く。
 */

export async function loadBlackboard(path: string): Promise<Blackboard> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Blackboard;
}

/** 新しいセッションの空の黒板を作る。session_id は日付ベース。 */
export function newBlackboard(goal: string, sessionId?: string): Blackboard {
  const now = new Date().toISOString();
  return {
    session_id: sessionId ?? `${now.slice(0, 10)}_session`,
    goal,
    created_at: now,
    updated_at: now,
    status: "in_progress",
    facts: [],
    proposals: [],
    open_questions: [],
    history: [],
  };
}

export async function saveBlackboard(path: string, blackboard: Blackboard): Promise<void> {
  await writeFile(path, `${JSON.stringify(blackboard, null, 2)}\n`, "utf8");
}
