import { describe, expect, it } from "vitest";
import {
  buildScoringUserPrompt,
  clampScore,
  parseScoreResponse,
} from "../src/scoring/scorer.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { makeExpert } from "./fixtures.js";

describe("clampScore", () => {
  it("0〜10 に丸める", () => {
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(12)).toBe(10);
    expect(clampScore(6.6)).toBe(7);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe("parseScoreResponse", () => {
  it("想定どおりの2行形式を解釈する", () => {
    const { score, reason } = parseScoreResponse("SCORE: 8\nREASON: 財務の論点が未解決");
    expect(score).toBe(8);
    expect(reason).toBe("財務の論点が未解決");
  });

  it("範囲外のスコアは丸める", () => {
    expect(parseScoreResponse("SCORE: 99").score).toBe(10);
  });

  it("形式を外れても最初の数値を拾う", () => {
    expect(parseScoreResponse("スコアはだいたい7くらいです").score).toBe(7);
  });

  it("数値がなければ0", () => {
    expect(parseScoreResponse("わかりません").score).toBe(0);
  });
});

describe("buildScoringUserPrompt", () => {
  it("役割説明と黒板要約を両方含む", () => {
    const prompt = buildScoringUserPrompt({
      expert: makeExpert({ role_description: "財務分析の専門家" }),
      blackboardSummary: "お題: テスト",
    });
    expect(prompt).toContain("財務分析の専門家");
    expect(prompt).toContain("お題: テスト");
  });
});

describe("MockScorer", () => {
  it("fixedScore を返す", async () => {
    const scorer = new MockScorer({ fixedScore: 4 });
    const r = await scorer.score({ expert: makeExpert(), blackboardSummary: "x" });
    expect(r.score).toBe(4);
  });

  it("byExpertName が fixedScore より優先される", async () => {
    const scorer = new MockScorer({ fixedScore: 4, byExpertName: { A: 9 } });
    expect((await scorer.score({ expert: makeExpert({ name: "A" }), blackboardSummary: "x" })).score).toBe(9);
    expect((await scorer.score({ expert: makeExpert({ name: "B" }), blackboardSummary: "x" })).score).toBe(4);
  });

  it("指定なしでは黒板の提案数で逓減する(0件→9, 2件→5)", async () => {
    const scorer = new MockScorer();
    const empty = await scorer.score({ expert: makeExpert(), blackboardSummary: "お題: X\n未解決の論点: なし" });
    expect(empty.score).toBe(9);

    const withTwo = await scorer.score({
      expert: makeExpert(),
      blackboardSummary: "- [p1] A 自信度7: ...\n- [p2] B 自信度6: ...",
    });
    expect(withTwo.score).toBe(5);
  });
});
