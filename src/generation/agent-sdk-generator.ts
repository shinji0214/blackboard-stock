import {
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  isEmptyContribution,
  parseContribution,
  type GenerateOptions,
  type GenerateRequest,
  type GenerateResult,
  type Generator,
} from "./generator.js";

/**
 * Claude Agent SDK(@anthropic-ai/claude-agent-sdk)経由で本回答生成を行う。
 * 自己採点(claude-haiku-4-5)より上位のモデルを使う。既定は claude-sonnet-5。
 * Claude Code と同じサブスクリプション認証を利用するため追加の API 従量課金は発生しない。
 *
 * 専門家の YAML に tools(WebSearch / WebFetch)が指定されていれば、そのツールを許可し
 * 複数ターン回して「調査 → 裏付け付きの回答」をさせる(STEP 6)。指定がなければ従来どおり
 * ツールなし・1ターンで生成する。
 *
 * JSON パースに失敗した場合は1回だけ「JSON のみ再出力」を促してリトライする。
 */

export interface AgentSdkGeneratorOptions {
  model?: string;
  /** ツールありの専門家に許す最大ターン数(調査ループ用)。既定 8 */
  researchMaxTurns?: number;
}

interface RunOutcome {
  text: string;
  toolUses: Record<string, number>;
}

export class AgentSdkGenerator implements Generator {
  private readonly model: string;
  private readonly researchMaxTurns: number;

  constructor(opts: AgentSdkGeneratorOptions = {}) {
    this.model = opts.model ?? "claude-sonnet-5";
    this.researchMaxTurns = opts.researchMaxTurns ?? 8;
  }

  async generate(req: GenerateRequest, options: GenerateOptions = {}): Promise<GenerateResult> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const systemPrompt = buildGenerationSystemPrompt(req.expert);
    const tools = req.expert.tools ?? [];
    const maxTurns = tools.length > 0 ? this.researchMaxTurns : 1;

    const runOnce = async (userPrompt: string): Promise<RunOutcome> => {
      let text = "";
      const toolUses: Record<string, number> = {};
      for await (const message of query({
        prompt: userPrompt,
        options: {
          model: this.model,
          systemPrompt,
          maxTurns,
          // tools が本当の制限。allowedTools で承認プロンプトを挟まず自動許可する
          tools,
          allowedTools: tools,
          settingSources: [],
          permissionMode: "bypassPermissions",
        },
      })) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "text") {
              text += block.text;
            } else if (block.type === "tool_use") {
              toolUses[block.name] = (toolUses[block.name] ?? 0) + 1;
              options.onToolUse?.(block.name, toolDetail(block.name, block.input));
            }
          }
        } else if (message.type === "result" && message.subtype === "success") {
          text = message.result;
        }
      }
      return { text: text.trim(), toolUses };
    };

    const firstPrompt = buildGenerationUserPrompt(req);
    const first = await runOnce(firstPrompt);
    try {
      const contribution = parseContribution(first.text);
      if (isEmptyContribution(contribution)) {
        throw new Error("すべてのセクションが空でした");
      }
      return withToolUses({ contribution, raw: first.text }, first.toolUses);
    } catch {
      const retry = await runOnce(`${firstPrompt}

直前の出力は出力形式に合いませんでした。説明文やコードフェンスを付けず、
proposals / facts / open_questions を持つ JSON オブジェクトだけを出力してください。`);
      const contribution = parseContribution(retry.text);
      return withToolUses(
        { contribution, raw: retry.text },
        mergeToolUses(first.toolUses, retry.toolUses),
      );
    }
  }
}

/** tool_use ブロックの input から進捗表示用の一言(検索クエリ / URL)を取り出す */
function toolDetail(name: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const rec = input as Record<string, unknown>;
  if (name === "WebSearch" && typeof rec.query === "string") return rec.query;
  if (name === "WebFetch" && typeof rec.url === "string") return rec.url;
  if (name === "WebFetch" && typeof rec.prompt === "string") return rec.prompt;
  return undefined;
}

function withToolUses(result: GenerateResult, toolUses: Record<string, number>): GenerateResult {
  return Object.keys(toolUses).length > 0 ? { ...result, tool_uses: toolUses } : result;
}

function mergeToolUses(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const merged = { ...a };
  for (const [key, value] of Object.entries(b)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}
