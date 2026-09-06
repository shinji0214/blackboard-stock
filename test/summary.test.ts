import { describe, expect, it } from "vitest";
import { summarizeBlackboard } from "../src/blackboard/summary.js";
import { makeBlackboard } from "./fixtures.js";
import type { Fact, Proposal } from "../src/types.js";

const fact = (i: number): Fact => ({
  id: `f${i}`,
  content: `事実${i}`,
  source: "human",
  added_at: "2026-09-06T10:00:00+09:00",
});

const proposal = (i: number): Proposal => ({
  id: `p${i}`,
  author: `著者${i}`,
  content: `提案${i}`,
  confidence: 7,
  added_at: "2026-09-06T10:00:00+09:00",
  responds_to: null,
});

describe("summarizeBlackboard", () => {
  it("空の黒板でもプレースホルダ付きで整形される", () => {
    const out = summarizeBlackboard(makeBlackboard());
    expect(out).toContain("お題: 架空の銘柄X");
    expect(out).toContain("(まだ確定した事実はない)");
    expect(out).toContain("(まだ提案はない)");
    expect(out).toContain("(未解決の論点はない)");
  });

  it("facts / proposals は直近5件だけを含める", () => {
    const bb = makeBlackboard({
      facts: Array.from({ length: 8 }, (_, i) => fact(i + 1)),
      proposals: Array.from({ length: 8 }, (_, i) => proposal(i + 1)),
    });
    const out = summarizeBlackboard(bb);
    expect(out).not.toContain("事実3");
    expect(out).toContain("事実4");
    expect(out).toContain("事実8");
    expect(out).not.toContain("提案3");
    expect(out).toContain("提案8");
  });

  it("maxFacts / maxProposals で件数を変えられる", () => {
    const bb = makeBlackboard({
      facts: Array.from({ length: 8 }, (_, i) => fact(i + 1)),
    });
    const out = summarizeBlackboard(bb, { maxFacts: 2 });
    expect(out).toContain("事実7");
    expect(out).toContain("事実8");
    expect(out).not.toContain("事実6");
  });

  it("resolved 済みの open_question は除外する", () => {
    const bb = makeBlackboard({
      open_questions: [
        { id: "q1", content: "未解決の論点", raised_by: "A", resolved: false },
        { id: "q2", content: "解決済みの論点", raised_by: "B", resolved: true },
      ],
    });
    const out = summarizeBlackboard(bb);
    expect(out).toContain("未解決の論点");
    expect(out).not.toContain("解決済みの論点");
  });

  it("responds_to を持つ提案には応答先を併記する", () => {
    const bb = makeBlackboard({
      proposals: [{ ...proposal(2), responds_to: "p1" }],
    });
    expect(summarizeBlackboard(bb)).toContain("(p1 への応答)");
  });
});
