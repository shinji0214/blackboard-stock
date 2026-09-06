import { describe, expect, it } from "vitest";
import { HUMAN_STYLE, styleForExpert } from "../src/discord/expert-style.js";

describe("styleForExpert", () => {
  it("既知の5体は固定の絵文字・色を返す", () => {
    expect(styleForExpert("ファンダメンタルズ専門家").emoji).toBe("📊");
    expect(styleForExpert("反証専門家").color).toBe(0xc0392b);
  });

  it("未知の専門家でも決定論的(同名 → 同スタイル)", () => {
    const a = styleForExpert("新設・行動経済学専門家");
    const b = styleForExpert("新設・行動経済学専門家");
    expect(a).toEqual(b);
    expect(a.emoji.length).toBeGreaterThan(0);
    expect(Number.isInteger(a.color)).toBe(true);
  });

  it("人間用スタイルは専門家と別枠", () => {
    expect(HUMAN_STYLE.emoji).toBe("🧑");
  });
});
