/**
 * STEP 4 の動作確認用 CLI。
 * 黒板を読み込み、1ターン(自己採点 → 発言者選出 → 本回答生成 → 黒板へ追記)を実行して保存する。
 *
 *   npm run turn:mock                                   … Mock スコアラー + Mock ジェネレーター(API不要)
 *   npm run turn                                        … AgentSdk(haiku 採点 + sonnet 生成)
 *   npm run turn -- blackboard-data/xxx.json            … 黒板ファイルを指定
 *   npm run turn -- --loop 5                            … quiescence になるまで最大5ターン回す
 *   npm run turn -- --dry-run                           … 黒板を保存せず結果だけ表示
 *   npm run turn -- --json                              … 各ターンの実行ログを JSON で標準出力にも出す
 *   npm run turn -- --log logs/custom.jsonl / --no-log
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBlackboard, saveBlackboard } from "../src/blackboard/store.js";
import { loadExperts } from "../src/experts/loader.js";
import { appendFiringLog, buildFiringRunLog } from "../src/controller/firing-log.js";
import { runTurn } from "../src/controller/turn.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { AgentSdkScorer } from "../src/scoring/agent-sdk-scorer.js";
import { MockGenerator } from "../src/generation/mock-generator.js";
import { AgentSdkGenerator } from "../src/generation/agent-sdk-generator.js";

const HAIKU_MODEL = "claude-haiku-4-5";
const SONNET_MODEL = "claude-sonnet-5";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock") || process.env.SCORER === "mock";
  const emitJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const noLog = args.includes("--no-log") || dryRun;
  const logOverride = readOption(args, "--log");
  const maxTurns = Math.max(1, Number(readOption(args, "--loop") ?? "1") || 1);

  const consumed = new Set([logOverride, String(maxTurns), "--loop", "--log"]);
  const fileArg = args.find((a) => !a.startsWith("--") && !consumed.has(a));
  const bbPath = fileArg
    ? path.resolve(fileArg)
    : path.join(root, "blackboard-data", "session-sample.json");

  let blackboard = await loadBlackboard(bbPath);
  const experts = await loadExperts(path.join(root, "experts"));
  const scorer = useMock ? new MockScorer() : new AgentSdkScorer();
  const generator = useMock ? new MockGenerator() : new AgentSdkGenerator();
  const logPath = logOverride
    ? path.resolve(logOverride)
    : path.join(root, "logs", `firing-${blackboard.session_id}.jsonl`);

  if (!emitJson) {
    console.log(`黒板       : ${bbPath}`);
    console.log(`お題       : ${blackboard.goal}`);
    console.log(
      `構成       : ${useMock ? "MockScorer + MockGenerator" : `AgentSdkScorer(${HAIKU_MODEL}) + AgentSdkGenerator(${SONNET_MODEL})`}`,
    );
    console.log(`最大ターン : ${maxTurns}${dryRun ? "  (dry-run: 保存なし)" : ""}`);
  }

  for (let i = 1; i <= maxTurns; i += 1) {
    const result = await runTurn(blackboard, experts, scorer, generator);

    const runLog = buildFiringRunLog({
      blackboard,
      blackboardPath: bbPath,
      decision: result.decision,
      scorer: useMock ? "MockScorer" : "AgentSdkScorer",
      model: useMock ? undefined : HAIKU_MODEL,
      generator: result.contribution ? (useMock ? "MockGenerator" : "AgentSdkGenerator") : undefined,
      generatorModel: result.contribution && !useMock ? SONNET_MODEL : undefined,
      contribution: result.contribution
        ? {
            expert: result.contribution.expert.name,
            turn: result.contribution.applied.turn,
            added: result.contribution.applied.added,
            ...(result.contribution.result.tool_uses
              ? { tool_uses: result.contribution.result.tool_uses }
              : {}),
            raw: result.contribution.result.raw,
          }
        : undefined,
    });
    if (!noLog) await appendFiringLog(logPath, runLog);
    if (emitJson) console.log(JSON.stringify(runLog, null, 2));

    if (result.quiescent) {
      if (!emitJson) {
        console.log(`\n[ターン ${i}] 発言者なし(quiescence)。`);
        console.log(
          result.sessionComplete
            ? "→ 未解決の論点もなし。セッション終了(status = resolved)。"
            : "→ 未解決の論点が残っている。人間の追加入力を待つ。",
        );
      }
      if (result.sessionComplete && blackboard.status !== "resolved") {
        blackboard = { ...blackboard, status: "resolved", updated_at: new Date().toISOString() };
        if (!dryRun) await saveBlackboard(bbPath, blackboard);
      }
      break;
    }

    blackboard = result.blackboard;
    if (!dryRun) await saveBlackboard(bbPath, blackboard);

    if (!emitJson) {
      const c = result.contribution!;
      console.log(`\n[ターン ${c.applied.turn}] ${c.expert.name}(採点 ${result.decision.scores[0]?.result.score})`);
      const toolUses = c.result.tool_uses;
      if (toolUses) {
        console.log(
          `  調査: ${Object.entries(toolUses).map(([t, n]) => `${t}×${n}`).join(" ")}`,
        );
      }
      for (const item of c.applied.added) {
        console.log(`  + ${item.section.padEnd(14)} [${item.id}] ${item.content}`);
        if (item.sources && item.sources.length > 0) {
          console.log(`      ↳ 情報源: ${item.sources.join(" / ")}`);
        }
      }
      if (c.applied.added.length === 0) console.log("  (追記なし)");
    }
  }

  if (!emitJson) {
    console.log("");
    console.log(
      `黒板状態   : facts ${blackboard.facts.length} / proposals ${blackboard.proposals.length} / open_questions ${blackboard.open_questions.filter((q) => !q.resolved).length}未解決  status=${blackboard.status}`,
    );
    if (!dryRun) console.log(`保存       : ${bbPath}`);
    if (!noLog) console.log(`ログ追記   : ${logPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
