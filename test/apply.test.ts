import { describe, expect, it } from "vitest";
import { applyContribution, applyHumanFact } from "../src/blackboard/apply.js";
import { normalizeContribution } from "../src/generation/generator.js";
import { makeBlackboard, makeExpert } from "./fixtures.js";
import type { Proposal } from "../src/types.js";

const NOW = () => "2026-09-07T00:00:00.000Z";
const expert = makeExpert({ name: "ファンダメンタルズ専門家" });

const existingProposal = (id: string): Proposal => ({
  id,
  author: "テクニカル専門家",
  content: "既存の提案",
  confidence: 7,
  added_at: "2026-09-06T10:00:00+09:00",
  responds_to: null,
});

describe("applyContribution", () => {
  it("proposal を追記し、author・id・timestamp・history を埋める", () => {
    const bb = makeBlackboard();
    const result = applyContribution(
      bb,
      expert,
      normalizeContribution({ proposals: [{ content: "利益率が課題", confidence: 6 }] }),
      NOW,
    );

    expect(result.blackboard.proposals).toHaveLength(1);
    expect(result.blackboard.proposals[0]).toMatchObject({
      id: "p1",
      author: "ファンダメンタルズ専門家",
      content: "利益率が課題",
      confidence: 6,
      added_at: NOW(),
      responds_to: null,
    });
    expect(result.blackboard.history).toEqual([
      { turn: 1, actor: "ファンダメンタルズ専門家", action: "proposal_added", ref_id: "p1", timestamp: NOW() },
    ]);
    expect(result.added).toEqual([{ section: "proposals", id: "p1", content: "利益率が課題" }]);
    expect(result.turn).toBe(1);
    expect(result.blackboard.updated_at).toBe(NOW());
  });

  it("id は既存の連番の続きから振る", () => {
    const bb = makeBlackboard({ proposals: [existingProposal("p1"), existingProposal("p2")] });
    const result = applyContribution(
      bb,
      expert,
      normalizeContribution({ proposals: [{ content: "3件目", confidence: 5 }] }),
      NOW,
    );
    expect(result.blackboard.proposals[2]?.id).toBe("p3");
  });

  it("turn は history の最大 turn + 1", () => {
    const bb = makeBlackboard({
      history: [
        { turn: 1, actor: "A", action: "proposal_added", ref_id: "p1", timestamp: NOW() },
        { turn: 2, actor: "B", action: "proposal_added", ref_id: "p2", timestamp: NOW() },
      ],
    });
    const result = applyContribution(bb, expert, normalizeContribution({ facts: [{ content: "新事実" }] }), NOW);
    expect(result.turn).toBe(3);
    expect(result.blackboard.history.at(-1)).toMatchObject({ turn: 3, action: "fact_added" });
  });

  it("存在しない responds_to は null に落とす / 存在すれば保持する", () => {
    const bb = makeBlackboard({ proposals: [existingProposal("p1")] });
    const result = applyContribution(
      bb,
      expert,
      normalizeContribution({
        proposals: [
          { content: "p1への反論", confidence: 6, responds_to: "p1" },
          { content: "存在しない参照", confidence: 6, responds_to: "p99" },
        ],
      }),
      NOW,
    );
    expect(result.blackboard.proposals[1]?.responds_to).toBe("p1");
    expect(result.blackboard.proposals[2]?.responds_to).toBeNull();
  });

  it("facts / open_questions も同時に追記できる", () => {
    const bb = makeBlackboard();
    const result = applyContribution(
      bb,
      expert,
      normalizeContribution({
        proposals: [{ content: "見解", confidence: 5 }],
        facts: [{ content: "PERは業界平均より低い" }],
        open_questions: [{ content: "来期のガイダンスは?" }],
      }),
      NOW,
    );
    expect(result.blackboard.facts[0]).toMatchObject({ id: "f1", source: "ファンダメンタルズ専門家" });
    expect(result.blackboard.open_questions[0]).toMatchObject({ id: "q1", raised_by: "ファンダメンタルズ専門家", resolved: false });
    expect(result.added.map((a) => a.section)).toEqual(["proposals", "facts", "open_questions"]);
    expect(result.blackboard.history.every((h) => h.turn === 1)).toBe(true);
  });

  it("proposal / fact の sources を黒板と added に引き継ぐ", () => {
    const bb = makeBlackboard();
    const result = applyContribution(
      bb,
      expert,
      normalizeContribution({
        proposals: [{ content: "見解", confidence: 6, sources: ["https://x.com"] }],
        facts: [{ content: "事実", sources: ["https://y.com"] }],
      }),
      NOW,
    );
    expect(result.blackboard.proposals[0]?.sources).toEqual(["https://x.com"]);
    expect(result.blackboard.facts[0]?.sources).toEqual(["https://y.com"]);
    expect(result.added.find((a) => a.section === "proposals")?.sources).toEqual(["https://x.com"]);
  });

  it("sources がなければ黒板エントリにキーを付けない", () => {
    const result = applyContribution(
      makeBlackboard(),
      expert,
      normalizeContribution({ proposals: [{ content: "見解", confidence: 6 }] }),
      NOW,
    );
    expect(result.blackboard.proposals[0]).not.toHaveProperty("sources");
  });

  it("入力の blackboard を破壊しない", () => {
    const bb = makeBlackboard();
    applyContribution(bb, expert, normalizeContribution({ proposals: [{ content: "x", confidence: 5 }] }), NOW);
    expect(bb.proposals).toHaveLength(0);
    expect(bb.history).toHaveLength(0);
  });
});

describe("applyHumanFact", () => {
  it("source=human の事実を追加し history に actor=human を記録する", () => {
    const bb = makeBlackboard({
      facts: [{ id: "f1", content: "既存", source: "human", added_at: NOW() }],
    });
    const result = applyHumanFact(bb, "  決算説明会で通期見通しを上方修正  ", NOW);

    expect(result.blackboard.facts[1]).toEqual({
      id: "f2",
      content: "決算説明会で通期見通しを上方修正",
      source: "human",
      added_at: NOW(),
    });
    expect(result.blackboard.history.at(-1)).toEqual({
      turn: 1,
      actor: "human",
      action: "fact_added",
      ref_id: "f2",
      timestamp: NOW(),
    });
    expect(result.added).toEqual([{ section: "facts", id: "f2", content: "決算説明会で通期見通しを上方修正" }]);
  });

  it("空文字列は拒否する", () => {
    expect(() => applyHumanFact(makeBlackboard(), "   ", NOW)).toThrow();
  });
});
