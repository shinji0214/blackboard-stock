import type { Blackboard, Expert } from "../src/types.js";

export function makeExpert(overrides: Partial<Expert> = {}): Expert {
  return {
    name: "テスト専門家",
    role_description: "テスト用の役割説明",
    min_confidence_to_speak: 6,
    system_prompt: "テスト",
    ...overrides,
  };
}

export function makeBlackboard(overrides: Partial<Blackboard> = {}): Blackboard {
  return {
    session_id: "test-001",
    goal: "架空の銘柄Xについて買い時かどうかを議論する",
    created_at: "2026-09-06T10:00:00+09:00",
    updated_at: "2026-09-06T10:00:00+09:00",
    status: "in_progress",
    facts: [],
    proposals: [],
    open_questions: [],
    history: [],
    ...overrides,
  };
}
