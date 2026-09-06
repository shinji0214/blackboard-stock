import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ALLOWED_EXPERT_TOOLS, type Expert } from "../types.js";

/**
 * experts/*.yaml を読み込んで Expert[] を返す。
 * YAML ファイルを追加・削除するだけで専門家の増減ができる(コントローラーのコード変更は不要)。
 */

const REQUIRED_FIELDS = [
  "name",
  "role_description",
  "system_prompt",
  "min_confidence_to_speak",
] as const;

export async function loadExperts(dir: string): Promise<Expert[]> {
  const entries = await readdir(dir);
  const yamlFiles = entries
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  const experts: Expert[] = [];
  for (const file of yamlFiles) {
    const full = path.join(dir, file);
    const parsed = parse(await readFile(full, "utf8")) as Record<string, unknown> | null;

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`専門家YAMLの形式が不正です: ${file}`);
    }
    for (const field of REQUIRED_FIELDS) {
      const value = parsed[field];
      if (value === undefined || value === null || value === "") {
        throw new Error(`専門家YAML ${file} に必須フィールド "${field}" がありません`);
      }
    }

    const minConfidence = Number(parsed.min_confidence_to_speak);
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 10) {
      throw new Error(
        `専門家YAML ${file} の min_confidence_to_speak は 0〜10 の数値である必要があります`,
      );
    }

    const tools = parseTools(parsed.tools, file);

    experts.push({
      name: String(parsed.name).trim(),
      role_description: String(parsed.role_description).trim(),
      system_prompt: String(parsed.system_prompt),
      min_confidence_to_speak: minConfidence,
      ...(tools.length > 0 ? { tools } : {}),
      source_file: full,
    });
  }

  if (experts.length === 0) {
    throw new Error(`専門家YAMLが1件も見つかりません: ${dir}`);
  }

  const names = new Set<string>();
  for (const e of experts) {
    if (names.has(e.name)) {
      throw new Error(`専門家名が重複しています: "${e.name}"`);
    }
    names.add(e.name);
  }

  return experts;
}

function parseTools(value: unknown, file: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((t) => typeof t !== "string")) {
    throw new Error(`専門家YAML ${file} の tools は文字列の配列である必要があります`);
  }
  const tools = [...new Set(value.map((t) => (t as string).trim()).filter(Boolean))];
  const invalid = tools.filter((t) => !ALLOWED_EXPERT_TOOLS.includes(t as (typeof ALLOWED_EXPERT_TOOLS)[number]));
  if (invalid.length > 0) {
    throw new Error(
      `専門家YAML ${file} の tools に許可されていない値: ${invalid.join(", ")}(許可: ${ALLOWED_EXPERT_TOOLS.join(", ")})`,
    );
  }
  return tools;
}
