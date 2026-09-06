import { describe, expect, it } from "vitest";
import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  isEmptyContribution,
  normalizeContribution,
  parseContribution,
  RESEARCH_INSTRUCTIONS,
} from "../src/generation/generator.js";
import { MockGenerator } from "../src/generation/mock-generator.js";
import { makeExpert } from "./fixtures.js";

describe("parseContribution", () => {
  it("素の JSON を解釈する", () => {
    const c = parseContribution(
      '{"proposals":[{"content":"強気","confidence":7,"responds_to":"p1"}],"facts":[],"open_questions":[]}',
    );
    expect(c.proposals).toEqual([{ content: "強気", confidence: 7, responds_to: "p1" }]);
  });

  it("コードフェンスや前後の地の文があっても最初のオブジェクトを拾う", () => {
    const raw = 'はい、以下です:\n```json\n{"proposals":[{"content":"x","confidence":5}],"facts":[],"open_questions":[]}\n```\n以上';
    const c = parseContribution(raw);
    expect(c.proposals[0]?.content).toBe("x");
    expect(c.proposals[0]?.responds_to).toBeNull();
  });

  it("confidence を 0〜10 に丸め、responds_to の 'null' 文字列を null にする", () => {
    const c = parseContribution(
      '{"proposals":[{"content":"y","confidence":99,"responds_to":"null"}]}',
    );
    expect(c.proposals[0]?.confidence).toBe(10);
    expect(c.proposals[0]?.responds_to).toBeNull();
  });

  it("空 content の要素は捨てる", () => {
    const c = parseContribution(
      '{"proposals":[{"content":"  ","confidence":5}],"facts":[{"content":"有効な事実"}],"open_questions":[]}',
    );
    expect(c.proposals).toHaveLength(0);
    expect(c.facts).toEqual([{ content: "有効な事実" }]);
  });

  it("sources を配列で取り込み、重複と空を除く", () => {
    const c = parseContribution(
      '{"proposals":[{"content":"p","confidence":6,"sources":["https://a.com","https://a.com"," "]}],' +
        '"facts":[{"content":"f","sources":["https://b.com"]}],"open_questions":[]}',
    );
    expect(c.proposals[0]?.sources).toEqual(["https://a.com"]);
    expect(c.facts[0]?.sources).toEqual(["https://b.com"]);
  });

  it("sources がなければキー自体を持たない", () => {
    const c = parseContribution('{"proposals":[{"content":"p","confidence":5}],"facts":[],"open_questions":[]}');
    expect(c.proposals[0]).not.toHaveProperty("sources");
  });

  it("JSON でなければ throw する", () => {
    expect(() => parseContribution("JSON はありません")).toThrow();
  });
});

describe("normalizeContribution", () => {
  it("欠損セクションを空配列で補う", () => {
    expect(normalizeContribution({ proposals: [{ content: "a", confidence: 3 }] })).toEqual({
      proposals: [{ content: "a", confidence: 3, responds_to: null }],
      facts: [],
      open_questions: [],
    });
  });

  it("非オブジェクト入力でも空の Contribution を返す", () => {
    expect(isEmptyContribution(normalizeContribution(null))).toBe(true);
  });
});

describe("プロンプト生成", () => {
  it("システムプロンプトは専門家の system_prompt と出力形式指示を含む", () => {
    const sys = buildGenerationSystemPrompt(makeExpert({ system_prompt: "あなたは財務の専門家" }));
    expect(sys).toContain("あなたは財務の専門家");
    expect(sys).toContain('"proposals"');
  });

  it("tools がある専門家だけ調査手順を含める", () => {
    expect(buildGenerationSystemPrompt(makeExpert())).not.toContain(RESEARCH_INSTRUCTIONS);
    const withTools = buildGenerationSystemPrompt(makeExpert({ tools: ["WebSearch"] }));
    expect(withTools).toContain(RESEARCH_INSTRUCTIONS);
  });

  it("ユーザープロンプトは黒板要約と専門家名を含む", () => {
    const user = buildGenerationUserPrompt({
      expert: makeExpert({ name: "リスク専門家" }),
      blackboardSummary: "お題: X",
    });
    expect(user).toContain("お題: X");
    expect(user).toContain("リスク専門家");
  });
});

describe("MockGenerator", () => {
  it("既定では proposal を1件返す", async () => {
    const r = await new MockGenerator().generate({
      expert: makeExpert({ name: "テクニカル専門家" }),
      blackboardSummary: "x",
    });
    expect(r.contribution.proposals).toHaveLength(1);
    expect(r.contribution.proposals[0]?.content).toContain("テクニカル専門家");
  });

  it("byExpertName で専門家ごとの貢献を差し込める", async () => {
    const gen = new MockGenerator({
      byExpertName: {
        A: { open_questions: [{ content: "セクター資金流入は?" }] },
      },
    });
    const r = await gen.generate({ expert: makeExpert({ name: "A" }), blackboardSummary: "x" });
    expect(r.contribution.open_questions).toEqual([{ content: "セクター資金流入は?" }]);
    expect(r.contribution.proposals).toHaveLength(0);
  });
});
