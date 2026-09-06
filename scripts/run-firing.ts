/**
 * STEP 3 の動作確認用 CLI。
 * 黒板と専門家セットを読み込み、自己採点 → 発言者選出までを実行して結果を表示する。
 * 実行するたびに結果を JSONL ログ(logs/firing-<session_id>.jsonl)へ追記する。
 *
 *   npm run firing:mock                                 … MockScorer(API不要)
 *   npm run firing                                      … AgentSdkScorer(claude-haiku-4-5)
 *   npm run firing -- blackboard-data/xxx.json          … 黒板ファイルを指定
 *   npm run firing -- --json                            … 実行結果を JSON で標準出力にも出す
 *   npm run firing -- --log logs/custom.jsonl           … ログ出力先を指定
 *   npm run firing -- --no-log                          … ログを書かない
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBlackboard } from "../src/blackboard/store.js";
import { loadExperts } from "../src/experts/loader.js";
import { isSessionComplete, selectSpeaker } from "../src/controller/firing.js";
import { appendFiringLog, buildFiringRunLog } from "../src/controller/firing-log.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { AgentSdkScorer } from "../src/scoring/agent-sdk-scorer.js";

const HAIKU_MODEL = "claude-haiku-4-5";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock") || process.env.SCORER === "mock";
  const emitJson = args.includes("--json");
  const noLog = args.includes("--no-log");
  const logOverride = readOption(args, "--log");

  const flagValues = new Set([logOverride]);
  const fileArg = args.find(
    (a) => !a.startsWith("--") && !flagValues.has(a),
  );
  const bbPath = fileArg
    ? path.resolve(fileArg)
    : path.join(root, "blackboard-data", "session-sample.json");

  const blackboard = await loadBlackboard(bbPath);
  const experts = await loadExperts(path.join(root, "experts"));
  const scorer = useMock ? new MockScorer() : new AgentSdkScorer();
  const scorerName = useMock ? "MockScorer" : "AgentSdkScorer";

  const decision = await selectSpeaker(experts, blackboard, scorer);

  const runLog = buildFiringRunLog({
    blackboard,
    blackboardPath: bbPath,
    decision,
    scorer: scorerName,
    model: useMock ? undefined : HAIKU_MODEL,
  });

  if (emitJson) {
    console.log(JSON.stringify(runLog, null, 2));
  } else {
    console.log(`黒板       : ${bbPath}`);
    console.log(`お題       : ${blackboard.goal}`);
    console.log(`専門家     : ${experts.length}体`);
    console.log(`スコアラー : ${useMock ? "MockScorer" : `AgentSdkScorer (${HAIKU_MODEL})`}`);
    console.log("");
    console.log("=== 自己採点結果(スコア降順)===");
    for (const s of decision.scores) {
      const mark = s.eligible ? "✓" : " ";
      const line = `[${mark}] score ${String(s.result.score).padStart(2)} / 閾値 ${s.expert.min_confidence_to_speak}  ${s.expert.name}`;
      console.log(s.result.reason ? `${line}\n        └ ${s.result.reason}` : line);
    }
    console.log("");
    if (decision.quiescent) {
      console.log("→ 全専門家が閾値未満。発言者なし(quiescence)。");
      console.log(
        isSessionComplete(blackboard, decision)
          ? "→ 未解決の論点もなし。セッション終了条件を満たす。"
          : "→ 未解決の論点が残っている。人間の追加入力を待つ。",
      );
    } else {
      console.log(`→ 選出: ${decision.speaker?.name}(score ${decision.scores[0]?.result.score})`);
    }
  }

  if (!noLog) {
    const logPath = logOverride
      ? path.resolve(logOverride)
      : path.join(root, "logs", `firing-${blackboard.session_id}.jsonl`);
    await appendFiringLog(logPath, runLog);
    if (!emitJson) console.log(`\nログ追記   : ${logPath}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
