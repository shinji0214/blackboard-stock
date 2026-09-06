import { describe, expect, it } from "vitest";
import { isSessionComplete, selectSpeaker } from "../src/controller/firing.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { makeBlackboard, makeExpert } from "./fixtures.js";
import type { Expert } from "../src/types.js";

const experts: Expert[] = [
  makeExpert({ name: "ファンダメンタルズ", min_confidence_to_speak: 6 }),
  makeExpert({ name: "テクニカル", min_confidence_to_speak: 6 }),
  makeExpert({ name: "リスク", min_confidence_to_speak: 5 }),
];

describe("selectSpeaker", () => {
  it("閾値を満たす中で最高スコアの専門家を選ぶ", async () => {
    const scorer = new MockScorer({
      byExpertName: { ファンダメンタルズ: 7, テクニカル: 9, リスク: 4 },
    });
    const decision = await selectSpeaker(experts, makeBlackboard(), scorer);
    expect(decision.speaker?.name).toBe("テクニカル");
    expect(decision.quiescent).toBe(false);
    expect(decision.scores[0]?.expert.name).toBe("テクニカル");
  });

  it("最高スコアでも閾値未満なら選ばれない", async () => {
    // リスクは閾値5でスコア5 → eligible。テクニカルはスコア5で閾値6 → 対象外
    const scorer = new MockScorer({
      byExpertName: { ファンダメンタルズ: 3, テクニカル: 5, リスク: 5 },
    });
    const decision = await selectSpeaker(experts, makeBlackboard(), scorer);
    expect(decision.speaker?.name).toBe("リスク");
  });

  it("全員が閾値未満なら quiescent かつ speaker は null", async () => {
    const scorer = new MockScorer({ fixedScore: 2 });
    const decision = await selectSpeaker(experts, makeBlackboard(), scorer);
    expect(decision.quiescent).toBe(true);
    expect(decision.speaker).toBeNull();
  });

  it("同点は専門家の定義順で決着する", async () => {
    const scorer = new MockScorer({
      byExpertName: { ファンダメンタルズ: 8, テクニカル: 8, リスク: 8 },
    });
    const decision = await selectSpeaker(experts, makeBlackboard(), scorer);
    expect(decision.speaker?.name).toBe("ファンダメンタルズ");
  });

  it("tieBreak を差し替えられる", async () => {
    const scorer = new MockScorer({ fixedScore: 8 });
    const decision = await selectSpeaker(experts, makeBlackboard(), scorer, {
      tieBreak: (a, b) => a.expert.name.localeCompare(b.expert.name, "ja"),
    });
    expect(["テクニカル", "ファンダメンタルズ", "リスク"]).toContain(decision.speaker?.name);
    // localeCompare 順の先頭が選ばれる(定義順とは限らない)
    const names = decision.scores.map((s) => s.expert.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "ja")));
  });

  it("scores は全専門家分を返し、スコア降順に並ぶ", async () => {
    const scorer = new MockScorer({
      byExpertName: { ファンダメンタルズ: 7, テクニカル: 9, リスク: 4 },
    });
    const { scores } = await selectSpeaker(experts, makeBlackboard(), scorer);
    expect(scores.map((s) => s.result.score)).toEqual([9, 7, 4]);
  });

  it("専門家0体はエラー", async () => {
    await expect(selectSpeaker([], makeBlackboard(), new MockScorer())).rejects.toThrow();
  });
});

describe("isSessionComplete", () => {
  it("quiescent かつ未解決の論点なしなら true", async () => {
    const decision = await selectSpeaker(experts, makeBlackboard(), new MockScorer({ fixedScore: 1 }));
    expect(isSessionComplete(makeBlackboard(), decision)).toBe(true);
  });

  it("quiescent でも未解決の論点が残っていれば false", async () => {
    const bb = makeBlackboard({
      open_questions: [{ id: "q1", content: "未解決", raised_by: "A", resolved: false }],
    });
    const decision = await selectSpeaker(experts, bb, new MockScorer({ fixedScore: 1 }));
    expect(isSessionComplete(bb, decision)).toBe(false);
  });

  it("発言者がいる場合は false", async () => {
    const decision = await selectSpeaker(experts, makeBlackboard(), new MockScorer({ fixedScore: 8 }));
    expect(isSessionComplete(makeBlackboard(), decision)).toBe(false);
  });
});
