import {
  SCORING_SYSTEM_PROMPT,
  buildScoringUserPrompt,
  clampScore,
  parseScoreResponse,
  type ScoreRequest,
  type ScoreResult,
  type Scorer,
} from "./scorer.js";

/**
 * Claude Agent SDK(@anthropic-ai/claude-agent-sdk)経由で自己採点を行う。
 * Claude Code と同じサブスクリプション認証(ログイン済みの Pro/Max アカウント)を利用するため、
 * 追加の API 従量課金は発生しない。ANTHROPIC_API_KEY が設定されている場合はそちらが優先される。
 *
 * 採点はツールを一切使わない 1 ターンのやり取りで完結する。
 */

export interface AgentSdkScorerOptions {
  /** 採点に使う軽量モデル(既定 claude-haiku-4-5) */
  model?: string;
  /** モデルが空応答だった場合のフォールバックスコア(既定 0) */
  fallbackScore?: number;
}

export class AgentSdkScorer implements Scorer {
  private readonly model: string;
  private readonly fallbackScore: number;

  constructor(opts: AgentSdkScorerOptions = {}) {
    this.model = opts.model ?? "claude-haiku-4-5";
    this.fallbackScore = opts.fallbackScore ?? 0;
  }

  async score(req: ScoreRequest): Promise<ScoreResult> {
    // 依存を遅延読み込みし、MockScorer だけ使う場合は SDK 未インストールでも動くようにする
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    let text = "";
    for await (const message of query({
      prompt: buildScoringUserPrompt(req),
      options: {
        model: this.model,
        systemPrompt: SCORING_SYSTEM_PROMPT,
        maxTurns: 1,
        // 採点はツールなし。tools: [] で組み込みツールを一切読み込まない
        tools: [],
        allowedTools: [],
        // プロジェクトの CLAUDE.md / settings を読み込まず、採点を再現可能に保つ
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
    if (!trimmed) {
      return {
        score: clampScore(this.fallbackScore),
        raw: "",
        reason: "モデルが応答しなかったためフォールバックスコアを使用",
      };
    }
    const { score, reason } = parseScoreResponse(trimmed);
    return { score, raw: trimmed, reason };
  }
}
