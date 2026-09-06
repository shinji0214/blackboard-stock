/**
 * ドメイン型定義。
 * 黒板スキーマは blackboard/schema.md、専門家プラグイン形式は README.md「専門家を増やす/入れ替えるには」を参照。
 */

export type BlackboardStatus = "in_progress" | "resolved" | "stalled";

export interface Fact {
  id: string;
  content: string;
  /** "human" または専門家名 */
  source: string;
  added_at: string;
  /** 調査で参照した情報源(URL / 資料名)。STEP 6 の Web 調査で埋まる */
  sources?: string[];
}

export interface Proposal {
  id: string;
  author: string;
  content: string;
  /** 提案者自身の自信度 0〜10 */
  confidence: number;
  added_at: string;
  /** 他提案への応答なら、その提案 id。独立提案なら null */
  responds_to: string | null;
  /** 調査で参照した情報源(URL / 資料名)。STEP 6 の Web 調査で埋まる */
  sources?: string[];
}

export interface OpenQuestion {
  id: string;
  content: string;
  raised_by: string;
  resolved: boolean;
}

export interface HistoryEntry {
  turn: number;
  actor: string;
  action: string;
  ref_id: string | null;
  timestamp: string;
}

export interface Blackboard {
  session_id: string;
  goal: string;
  created_at: string;
  updated_at: string;
  status: BlackboardStatus;
  facts: Fact[];
  proposals: Proposal[];
  open_questions: OpenQuestion[];
  history: HistoryEntry[];
}

export interface Expert {
  /** 表示名 */
  name: string;
  /** コントローラーが自己採点を依頼する際に使う、役割の一行説明 */
  role_description: string;
  /** このスコア未満なら発言権なし(0〜10) */
  min_confidence_to_speak: number;
  /** 本回答生成時に LLM へ渡すシステムプロンプト(STEP 4 で使用) */
  system_prompt: string;
  /**
   * 本回答生成時にこの専門家へ許可する Claude Agent SDK の組み込みツール。
   * 現状の許可対象は "WebSearch" / "WebFetch" のみ(STEP 6)。
   * 空 or 未指定なら調査なし・1ターンで生成する。
   */
  tools?: string[];
  /** 読み込み元ファイルパス(デバッグ用) */
  source_file?: string;
}

/** 本回答生成で専門家に許可できる組み込みツール */
export const ALLOWED_EXPERT_TOOLS = ["WebSearch", "WebFetch"] as const;
