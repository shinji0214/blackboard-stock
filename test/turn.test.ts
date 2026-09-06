import { describe, expect, it } from "vitest";
import { runTurn, type TurnProgressEvent } from "../src/controller/turn.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { MockGenerator } from "../src/generation/mock-generator.js";
import { normalizeContribution, type Generator } from "../src/generation/generator.js";
import { makeBlackboard, makeExpert } from "./fixtures.js";
import type { Expert } from "../src/types.js";

const experts: Expert[] = [
  makeExpert({ name: "ファンダメンタルズ", min_confidence_to_speak: 6 }),
  makeExpert({ name: "テクニカル", min_confidence_to_speak: 6 }),
  makeExpert({ name: "リスク", min_confidence_to_speak: 5 }),
];

const NOW = () => "2026-09-07T00:00:00.000Z";

describe("runTurn", () => {
  it("選出された専門家の貢献を黒板へ追記する", async () => {
    const scorer = new MockScorer({ byExpertName: { ファンダメンタルズ: 9, テクニカル: 4, リスク: 3 } });
    const generator = new MockGenerator({
      byExpertName: { ファンダメンタルズ: { proposals: [{ content: "利益率が横ばい", confidence: 6, responds_to: null }] } },
    });

    const result = await runTurn(makeBlackboard(), experts, scorer, generator, { now: NOW });

    expect(result.quiescent).toBe(false);
    expect(result.contribution?.expert.name).toBe("ファンダメンタルズ");
    expect(result.blackboard.proposals[0]).toMatchObject({ author: "ファンダメンタルズ", content: "利益率が横ばい" });
    expect(result.blackboard.history[0]).toMatchObject({ turn: 1, action: "proposal_added" });
    expect(result.contribution?.applied.added).toEqual([
      { section: "proposals", id: "p1", content: "利益率が横ばい" },
    ]);
  });

  it("quiescence 時は生成をスキップし黒板を変えない", async () => {
    const bb = makeBlackboard();
    const result = await runTurn(bb, experts, new MockScorer({ fixedScore: 2 }), new MockGenerator(), { now: NOW });
    expect(result.quiescent).toBe(true);
    expect(result.contribution).toBeUndefined();
    expect(result.blackboard).toBe(bb);
    expect(result.sessionComplete).toBe(true);
  });

  it("quiescence でも未解決の論点が残っていれば sessionComplete は false", async () => {
    const bb = makeBlackboard({
      open_questions: [{ id: "q1", content: "未解決", raised_by: "A", resolved: false }],
    });
    const result = await runTurn(bb, experts, new MockScorer({ fixedScore: 1 }), new MockGenerator(), { now: NOW });
    expect(result.quiescent).toBe(true);
    expect(result.sessionComplete).toBe(false);
  });

  it("onProgress が 採点 → 発言者決定 → 生成 → ツール使用 の順で発火する", async () => {
    const events: TurnProgressEvent[] = [];
    const researchGen: Generator = {
      async generate(_req, options) {
        options?.onToolUse?.("WebSearch", "NVDA Q2");
        options?.onToolUse?.("WebFetch", "https://sec.gov/x");
        return {
          contribution: normalizeContribution({ proposals: [{ content: "調査結果", confidence: 6 }] }),
          raw: "",
        };
      },
    };

    await runTurn(
      makeBlackboard(),
      experts,
      new MockScorer({ byExpertName: { ファンダメンタルズ: 9, テクニカル: 3, リスク: 2 } }),
      researchGen,
      { now: NOW, onProgress: (e) => events.push(e) },
    );

    expect(events[0]).toEqual({ phase: "scoring" });
    expect(events[1]).toMatchObject({ phase: "speaker-selected", expert: "ファンダメンタルズ", score: 9 });
    expect(events[2]).toEqual({ phase: "generating", expert: "ファンダメンタルズ" });
    expect(events[3]).toEqual({ phase: "tool-use", expert: "ファンダメンタルズ", tool: "WebSearch", detail: "NVDA Q2" });
    expect(events[4]).toMatchObject({ phase: "tool-use", tool: "WebFetch", detail: "https://sec.gov/x" });
  });

  it("quiescence 時は onProgress が scoring のみ", async () => {
    const events: TurnProgressEvent[] = [];
    await runTurn(makeBlackboard(), experts, new MockScorer({ fixedScore: 2 }), new MockGenerator(), {
      now: NOW,
      onProgress: (e) => events.push(e),
    });
    expect(events).toEqual([{ phase: "scoring" }]);
  });

  it("複数ターンを回すと黒板が育ち、turn 番号が増える", async () => {
    let bb = makeBlackboard();
    const scorer = new MockScorer({ fixedScore: 8 });
    const generator = new MockGenerator();

    for (let i = 0; i < 3; i += 1) {
      const result = await runTurn(bb, experts, scorer, generator, { now: NOW });
      bb = result.blackboard;
    }

    expect(bb.proposals).toHaveLength(3);
    expect(bb.history.map((h) => h.turn)).toEqual([1, 2, 3]);
  });
});
