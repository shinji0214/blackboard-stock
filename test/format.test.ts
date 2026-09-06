import { describe, expect, it } from "vitest";
import {
  formatApprovalRequest,
  formatContribution,
  formatHumanFact,
  formatQuiescence,
  formatSessionSummary,
  formatStatus,
} from "../src/discord/format.js";
import { applyContribution } from "../src/blackboard/apply.js";
import { normalizeContribution } from "../src/generation/generator.js";
import { makeBlackboard, makeExpert } from "./fixtures.js";
import type { TurnContribution } from "../src/controller/turn.js";

const NOW = () => "2026-09-07T00:00:00.000Z";

function buildContribution(): { turn: TurnContribution; blackboard: ReturnType<typeof makeBlackboard> } {
  const expert = makeExpert({ name: "リスク専門家" });
  const bb = makeBlackboard({
    proposals: [
      {
        id: "p1",
        author: "テクニカル専門家",
        content: "強気",
        confidence: 7,
        added_at: NOW(),
        responds_to: null,
      },
    ],
  });
  const contribution = normalizeContribution({
    proposals: [{ content: "下振れリスクを軽視している", confidence: 6, responds_to: "p1" }],
    facts: [{ content: "有利子負債が増加中" }],
    open_questions: [{ content: "格付けの見通しは?" }],
  });
  const applied = applyContribution(bb, expert, contribution, NOW);
  return {
    turn: { expert, result: { contribution, raw: "raw" }, applied },
    blackboard: applied.blackboard,
  };
}

describe("formatContribution", () => {
  it("専門家名・提案本文・追加事実/論点・フッターを含む", () => {
    const { turn, blackboard } = buildContribution();
    const data = formatContribution(turn, 8, blackboard).toJSON();

    expect(data.author?.name).toContain("リスク専門家");
    expect(data.author?.name).toContain("⚠️");
    expect(data.description).toContain("下振れリスク");
    expect(data.description).toContain("↩ p1 への応答");
    const fieldNames = (data.fields ?? []).map((f) => f.name);
    expect(fieldNames).toContain("確定事実に追加");
    expect(fieldNames).toContain("新たな論点");
    expect(data.footer?.text).toContain("ターン 1");
    expect(data.footer?.text).toContain("自己採点 8/10");
  });

  it("調査ツールの使用回数と情報源を表示する", () => {
    const expert = makeExpert({ name: "マクロ・センチメント専門家", tools: ["WebSearch"] });
    const bb = makeBlackboard();
    const contribution = normalizeContribution({
      proposals: [{ content: "金利は追い風", confidence: 6, sources: ["https://fed.example/rate"] }],
      facts: [{ content: "政策金利は据え置き", sources: ["https://fed.example/rate"] }],
    });
    const applied = applyContribution(bb, expert, contribution, NOW);
    const data = formatContribution(
      { expert, result: { contribution, raw: "", tool_uses: { WebSearch: 3 } }, applied },
      8,
      applied.blackboard,
    ).toJSON();

    expect(data.footer?.text).toContain("調査 WebSearch×3");
    const sourceField = (data.fields ?? []).find((f) => f.name === "情報源");
    expect(sourceField?.value).toContain("https://fed.example/rate");
    // 重複した URL は1回だけ
    expect(sourceField?.value.match(/fed\.example/g)).toHaveLength(1);
  });

  it("提案なし(事実のみ)でも壊れない", () => {
    const expert = makeExpert({ name: "ファンダメンタルズ専門家" });
    const bb = makeBlackboard();
    const contribution = normalizeContribution({ facts: [{ content: "PERは12倍" }] });
    const applied = applyContribution(bb, expert, contribution, NOW);
    const data = formatContribution(
      { expert, result: { contribution, raw: "" }, applied },
      7,
      applied.blackboard,
    ).toJSON();
    expect(data.description).toContain("提案なし");
  });
});

describe("その他の整形", () => {
  it("formatQuiescence はセッション終了かどうかで文面が変わる", () => {
    expect(formatQuiescence(true).toJSON().description).toContain("セッションを終了");
    expect(formatQuiescence(false).toJSON().description).toContain("新しい情報");
  });

  it("formatHumanFact は事実 id を添える", () => {
    const data = formatHumanFact("f3", "決算説明会で通期見通しを上方修正").toJSON();
    expect(data.author?.name).toContain("人間の入力");
    expect(data.footer?.text).toContain("f3");
  });

  it("formatStatus は未解決の論点を並べる", () => {
    const bb = makeBlackboard({
      open_questions: [
        { id: "q1", content: "金利の方向は?", raised_by: "A", resolved: false },
        { id: "q2", content: "解決済み", raised_by: "B", resolved: true },
      ],
    });
    const data = formatStatus(bb).toJSON();
    const field = (data.fields ?? []).find((f) => f.name === "未解決の論点");
    expect(field?.value).toContain("金利の方向");
    expect(field?.value).not.toContain("解決済み");
  });

  it("formatSessionSummary は免責を含む", () => {
    const data = formatSessionSummary("まとめ本文", makeBlackboard()).toJSON();
    expect(data.description).toBe("まとめ本文");
    expect(data.footer?.text).toContain("投資助言ではありません");
  });

  it("formatApprovalRequest は実行対象ターンと操作方法を示す", () => {
    const bb = makeBlackboard({
      history: [{ turn: 2, actor: "A", action: "proposal_added", ref_id: "p1", timestamp: NOW() }],
    });
    const nextTurn = bb.history.reduce((m, h) => Math.max(m, h.turn), 0) + 1;
    const data = formatApprovalRequest(nextTurn, bb).toJSON();
    expect(data.description).toContain("ターン 3 を実行してよいですか");
    expect(data.description).toContain("!next");
    expect(data.description).toContain("!stop");
  });
});
