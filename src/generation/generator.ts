import type { Blackboard, Expert } from "../types.js";
import { summarizeBlackboard, type SummaryOptions } from "../blackboard/summary.js";
import { clampScore } from "../scoring/scorer.js";

/**
 * STEP 4: 選出された専門家が実際の貢献内容(proposals / facts / open_questions)を生成する。
 *
 * 実装は差し替え可能:
 *   - MockGenerator     … API 不要。定型の貢献を返す。テスト用
 *   - AgentSdkGenerator … Claude Agent SDK 経由で claude-sonnet-5 を呼ぶ
 *
 * 生成結果は「どのセクションに何を書くか」まで専門家自身に分類させる(構造化 JSON で受け取る)。
 */

export interface ProposalDraft {
  content: string;
  /** 提案者自身の自信度 0〜10 */
  confidence: number;
  /** 反論対象の提案 id。独立提案なら null */
  responds_to: string | null;
  /** 調査で参照した情報源(URL / 資料名) */
  sources?: string[];
}

export interface FactDraft {
  content: string;
  /** 調査で参照した情報源(URL / 資料名) */
  sources?: string[];
}

export interface QuestionDraft {
  content: string;
}

export interface Contribution {
  proposals: ProposalDraft[];
  facts: FactDraft[];
  open_questions: QuestionDraft[];
}

export interface GenerateRequest {
  expert: Expert;
  /** 生成時に渡す黒板要約 */
  blackboardSummary: string;
}

export interface GenerateResult {
  contribution: Contribution;
  /** モデル/実装が返した生テキスト(デバッグ用) */
  raw: string;
  /** 生成中に使った組み込みツールの呼び出し回数(例: { WebSearch: 2 }) */
  tool_uses?: Record<string, number>;
}

export interface Generator {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/** 生成時は自己採点時より広めに黒板を見せる */
export const GENERATION_SUMMARY_OPTIONS: SummaryOptions = { maxFacts: 12, maxProposals: 12 };

export const GENERATION_FORMAT_INSTRUCTIONS = `## 出力形式(厳守)

黒板に追記する内容を、次の形式の JSON **のみ**で出力してください。
前後に説明文・コードフェンス・挨拶を付けないこと。

{
  "proposals": [
    { "content": "見解・提案の本文(1〜3文)", "confidence": 0〜10の整数, "responds_to": "反論・応答の対象提案id または null", "sources": ["参照した情報源のURL"] }
  ],
  "facts": [
    { "content": "データに基づく客観的で確定した事実。裏付けのない主張は書かない", "sources": ["参照した情報源のURL"] }
  ],
  "open_questions": [
    { "content": "まだ答えが出ていない、次に確認すべき論点" }
  ]
}

ルール:
- 通常は proposals にちょうど1件。自分が責任を持てる主張だけを書く。
- 数字や事実の裏付けがないものは facts に入れず、open_questions として提起する。
- open_questions は「次の1手で解くべき最重要の問い」を最大2件まで。思いついた疑問を全部並べない。
- 他の専門家の提案に反論・補足する場合は responds_to にその提案 id を入れる。
- 該当がないセクションは空配列 [] にする。すべて空にはしない。
- 「買うべき」「売るべき」という断定的な投資助言はしない。`;

export const RESEARCH_INSTRUCTIONS = `## 調査(WebSearch / WebFetch が使える場合)

- proposals / facts を書く前に、必要なら WebSearch で最新の数値・事実を調べ、
  一次情報に近いページを WebFetch で確認してから書くこと。
- 調べて確認できた客観的事実は facts に入れ、sources に参照した URL を必ず入れる。
- proposals の主要な数値・主張にも、根拠にした URL を sources に入れる。
- 検索しても確認できなかった点は憶測で埋めず open_questions に回す。
- 調査は自分の専門領域に関係する範囲に絞り、3〜5 回の検索を目安にする。`;

export function buildGenerationSystemPrompt(expert: Expert): string {
  const parts = [expert.system_prompt.trim(), GENERATION_FORMAT_INSTRUCTIONS];
  if ((expert.tools?.length ?? 0) > 0) {
    parts.push(RESEARCH_INSTRUCTIONS);
  }
  return parts.join("\n\n---\n\n");
}

export function buildGenerationUserPrompt(req: GenerateRequest): string {
  return `## 現在の黒板

${req.blackboardSummary}

## あなたのタスク

上記の黒板の状態を踏まえ、あなた(${req.expert.name})の専門的な貢献を出力形式の JSON で書いてください。`;
}

/** モデル応答から Contribution を取り出す。コードフェンスや前後の地の文があっても最初の JSON オブジェクトを拾う。 */
export function parseContribution(raw: string): Contribution {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error(`生成結果を JSON として解釈できませんでした: ${raw.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`生成結果の JSON パースに失敗しました: ${(err as Error).message}`);
  }
  return normalizeContribution(parsed);
}

/** 部分的な Contribution を欠損補完・型強制して正規化する。空要素は捨てる。 */
export function normalizeContribution(input: unknown): Contribution {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const proposals: ProposalDraft[] = toArray(obj.proposals)
    .map((p) => {
      const rec = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const content = cleanText(rec.content);
      if (!content) return null;
      const respondsTo = cleanText(rec.responds_to);
      const sources = cleanSources(rec.sources);
      return {
        content,
        confidence: clampScore(Number(rec.confidence ?? 5)),
        responds_to: respondsTo && respondsTo.toLowerCase() !== "null" ? respondsTo : null,
        ...(sources.length > 0 ? { sources } : {}),
      } satisfies ProposalDraft;
    })
    .filter((p): p is ProposalDraft => p !== null);

  const facts: FactDraft[] = toArray(obj.facts)
    .map((f) => {
      const rec = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const content = cleanText(rec.content) ?? cleanText(f);
      if (!content) return null;
      const sources = cleanSources(rec.sources);
      return sources.length > 0 ? { content, sources } : { content };
    })
    .filter((f): f is FactDraft => f !== null);

  const open_questions: QuestionDraft[] = toArray(obj.open_questions)
    .map((q) => {
      const rec = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
      const content = cleanText(rec.content) ?? cleanText(q);
      return content ? { content } : null;
    })
    .filter((q): q is QuestionDraft => q !== null);

  return { proposals, facts, open_questions };
}

export function isEmptyContribution(c: Contribution): boolean {
  return c.proposals.length === 0 && c.facts.length === 0 && c.open_questions.length === 0;
}

export function makeGenerateRequest(
  expert: Expert,
  blackboard: Blackboard,
  summaryOpts: SummaryOptions = GENERATION_SUMMARY_OPTIONS,
): GenerateRequest {
  return { expert, blackboardSummary: summarizeBlackboard(blackboard, summaryOpts) };
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanSources(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((s) => cleanText(s)).filter((s): s is string => s !== undefined))];
}

function extractJsonObject(raw: string): string | null {
  const withoutFence = raw.replace(/```(?:json)?/gi, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return withoutFence.slice(start, end + 1);
}
