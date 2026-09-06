/**
 * Discord 上で「誰の発言か一目でわかる」ようにするための、専門家ごとの見た目(絵文字 + 埋め込み色)。
 * 既知の5体は固定。未知の専門家(YAML を足した場合)は名前ハッシュから決定論的に割り当てる。
 */

export interface ExpertStyle {
  emoji: string;
  /** Discord 埋め込みの色(整数) */
  color: number;
}

const KNOWN: Record<string, ExpertStyle> = {
  ファンダメンタルズ専門家: { emoji: "📊", color: 0x2e86de },
  テクニカル専門家: { emoji: "📈", color: 0x27ae60 },
  "マクロ・センチメント専門家": { emoji: "🌐", color: 0x8e44ad },
  リスク専門家: { emoji: "⚠️", color: 0xe67e22 },
  反証専門家: { emoji: "🔍", color: 0xc0392b },
};

const PALETTE = [0x1abc9c, 0x3498db, 0x9b59b6, 0xe91e63, 0xf39c12, 0xd35400, 0x2c3e50, 0x16a085];
const EMOJIS = ["🗣️", "💬", "🧠", "📌", "🔎", "🧩", "📎", "🔔"];

export function styleForExpert(name: string): ExpertStyle {
  const known = KNOWN[name];
  if (known) return known;

  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return {
    emoji: EMOJIS[hash % EMOJIS.length]!,
    color: PALETTE[hash % PALETTE.length]!,
  };
}

export const HUMAN_STYLE: ExpertStyle = { emoji: "🧑", color: 0x95a5a6 };
export const SYSTEM_STYLE: ExpertStyle = { emoji: "🧭", color: 0x34495e };
