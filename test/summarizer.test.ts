import { describe, expect, it } from "vitest";
import { MockSummarizer, buildSummaryUserPrompt } from "../src/generation/summarizer.js";
import { makeBlackboard } from "./fixtures.js";

describe("buildSummaryUserPrompt", () => {
  it("goal・提案・未解決の論点を含み、resolved 済みは除外する", () => {
    const bb = makeBlackboard({
      proposals: [
        { id: "p1", author: "テクニカル専門家", content: "強気", confidence: 7, added_at: "t", responds_to: null },
      ],
      open_questions: [
        { id: "q1", content: "金利は?", raised_by: "A", resolved: false },
        { id: "q2", content: "済んだ論点", raised_by: "B", resolved: true },
      ],
    });
    const prompt = buildSummaryUserPrompt(bb);
    expect(prompt).toContain(bb.goal);
    expect(prompt).toContain("[p1] テクニカル専門家");
    expect(prompt).toContain("金利は?");
    expect(prompt).not.toContain("済んだ論点");
  });
});

describe("MockSummarizer", () => {
  it("指定テキストをそのまま返す", async () => {
    const s = new MockSummarizer({ text: "決められた要約" });
    expect(await s.summarize(makeBlackboard())).toBe("決められた要約");
  });

  it("既定では黒板の件数に触れ、免責を含む", async () => {
    const bb = makeBlackboard({
      proposals: [
        { id: "p1", author: "A", content: "x", confidence: 5, added_at: "t", responds_to: null },
      ],
      open_questions: [{ id: "q1", content: "y", raised_by: "A", resolved: false }],
    });
    const text = await new MockSummarizer().summarize(bb);
    expect(text).toContain("1");
    expect(text).toContain("投資助言");
  });
});
