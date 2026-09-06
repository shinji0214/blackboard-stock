import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExperts } from "../src/experts/loader.js";

const expertsDir = path.resolve(
  fileURLToPath(new URL("../experts", import.meta.url)),
);

describe("loadExperts (実際の experts/)", () => {
  it("5体の専門家を読み込み、必須フィールドが揃っている", async () => {
    const experts = await loadExperts(expertsDir);
    expect(experts).toHaveLength(5);
    for (const e of experts) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.role_description.length).toBeGreaterThan(0);
      expect(e.system_prompt.length).toBeGreaterThan(0);
      expect(e.min_confidence_to_speak).toBeGreaterThanOrEqual(0);
      expect(e.min_confidence_to_speak).toBeLessThanOrEqual(10);
    }
    expect(experts.map((e) => e.name)).toContain("反証専門家");
  });
});

describe("loadExperts (バリデーション)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "experts-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("必須フィールド欠落でエラー", async () => {
    await writeFile(
      path.join(dir, "bad.yaml"),
      'name: "x"\nrole_description: "y"\nsystem_prompt: "z"\n',
    );
    await expect(loadExperts(dir)).rejects.toThrow(/min_confidence_to_speak/);
  });

  it("min_confidence_to_speak が範囲外でエラー", async () => {
    await writeFile(
      path.join(dir, "bad.yaml"),
      'name: "x"\nrole_description: "y"\nsystem_prompt: "z"\nmin_confidence_to_speak: 42\n',
    );
    await expect(loadExperts(dir)).rejects.toThrow(/0〜10/);
  });

  it("YAML が0件でエラー", async () => {
    await expect(loadExperts(dir)).rejects.toThrow(/見つかりません/);
  });

  it("専門家名の重複でエラー", async () => {
    const body =
      'name: "同名"\nrole_description: "y"\nsystem_prompt: "z"\nmin_confidence_to_speak: 5\n';
    await writeFile(path.join(dir, "a.yaml"), body);
    await writeFile(path.join(dir, "b.yaml"), body);
    await expect(loadExperts(dir)).rejects.toThrow(/重複/);
  });

  const base = 'name: "x"\nrole_description: "y"\nsystem_prompt: "z"\nmin_confidence_to_speak: 5\n';

  it("tools を読み込む", async () => {
    await writeFile(path.join(dir, "a.yaml"), `${base}tools: ["WebSearch", "WebFetch"]\n`);
    const [expert] = await loadExperts(dir);
    expect(expert?.tools).toEqual(["WebSearch", "WebFetch"]);
  });

  it("tools 未指定なら undefined", async () => {
    await writeFile(path.join(dir, "a.yaml"), base);
    const [expert] = await loadExperts(dir);
    expect(expert?.tools).toBeUndefined();
  });

  it("許可されていない tool 名でエラー", async () => {
    await writeFile(path.join(dir, "a.yaml"), `${base}tools: ["Bash"]\n`);
    await expect(loadExperts(dir)).rejects.toThrow(/許可されていない/);
  });

  it("tools が配列でなければエラー", async () => {
    await writeFile(path.join(dir, "a.yaml"), `${base}tools: "WebSearch"\n`);
    await expect(loadExperts(dir)).rejects.toThrow(/配列/);
  });
});
