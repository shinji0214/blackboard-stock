import type { Blackboard } from "../types.js";

/**
 * STEP 5: セッション終了時に、黒板に積み上がった議論を人間が読める形にまとめる。
 * 投資助言ではなく「複数視点からの議論の再現」の要約に留める。
 */

export interface Summarizer {
  summarize(blackboard: Blackboard): Promise<string>;
}

export const SESSION_SUMMARY_SYSTEM_PROMPT = `あなたはマルチエージェント議論のまとめ役です。
黒板(goal / facts / proposals / open_questions)の全体を渡されます。
議論の到達点を、次の構成の日本語 Markdown で簡潔にまとめてください。

## 論点の分かれ目
（強気寄り / 慎重寄りで見解がどう割れたか。誰がどちらの立場か)

## 主要な提案
（proposals の要点を3〜6個の箇条書きで。著者名を添える)

## 未解決の論点
（open_questions のうち重要なものを箇条書きで)

## 総括
（1〜2文。どの情報が揃えば結論に近づくか)

制約:
- 「買うべき」「売るべき」という断定的な投資助言はしない。
- 黒板にない事実を創作しない。
- 全体で600字程度に収める。`;

export function buildSummaryUserPrompt(blackboard: Blackboard): string {
  const facts = blackboard.facts.map((f) => `- ${f.content}(出典: ${f.source})`).join("\n") || "- (なし)";
  const proposals =
    blackboard.proposals
      .map((p) => {
        const ref = p.responds_to ? `(${p.responds_to} への応答)` : "";
        return `- [${p.id}] ${p.author} 自信度${p.confidence}: ${p.content}${ref}`;
      })
      .join("\n") || "- (なし)";
  const questions =
    blackboard.open_questions
      .filter((q) => !q.resolved)
      .map((q) => `- [${q.id}] ${q.content}(提起: ${q.raised_by})`)
      .join("\n") || "- (なし)";

  return `# お題
${blackboard.goal}

# 確定している事実
${facts}

# これまでの提案
${proposals}

# 未解決の論点
${questions}

上記の黒板をまとめてください。`;
}

export interface MockSummarizerOptions {
  text?: string;
}

export class MockSummarizer implements Summarizer {
  constructor(private readonly opts: MockSummarizerOptions = {}) {}

  async summarize(blackboard: Blackboard): Promise<string> {
    if (this.opts.text) return this.opts.text;
    const unresolved = blackboard.open_questions.filter((q) => !q.resolved).length;
    return [
      "## 論点の分かれ目",
      `提案 ${blackboard.proposals.length} 件で議論(mock 要約)。`,
      "",
      "## 未解決の論点",
      `${unresolved} 件が未解決。`,
      "",
      "## 総括",
      "これは mock 要約です。断定的な投資助言はしません。",
    ].join("\n");
  }
}

export interface AgentSdkSummarizerOptions {
  model?: string;
}

export class AgentSdkSummarizer implements Summarizer {
  private readonly model: string;

  constructor(opts: AgentSdkSummarizerOptions = {}) {
    this.model = opts.model ?? "claude-sonnet-5";
  }

  async summarize(blackboard: Blackboard): Promise<string> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    let text = "";
    for await (const message of query({
      prompt: buildSummaryUserPrompt(blackboard),
      options: {
        model: this.model,
        systemPrompt: SESSION_SUMMARY_SYSTEM_PROMPT,
        maxTurns: 1,
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: "bypassPermissions",
      },
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") text += block.text;
        }
      } else if (message.type === "result" && message.subtype === "success") {
        text = message.result;
      }
    }
    const trimmed = text.trim();
    return trimmed || "(要約の生成に失敗しました)";
  }
}
