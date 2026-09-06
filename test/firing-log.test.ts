import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectSpeaker } from "../src/controller/firing.js";
import { appendFiringLog, buildFiringRunLog, type FiringRunLog } from "../src/controller/firing-log.js";
import { MockScorer } from "../src/scoring/mock-scorer.js";
import { makeBlackboard, makeExpert } from "./fixtures.js";
import type { Expert } from "../src/types.js";

const experts: Expert[] = [
  makeExpert({ name: "ファンダメンタルズ", min_confidence_to_speak: 6 }),
  makeExpert({ name: "テクニカル", min_confidence_to_speak: 6 }),
];

describe("buildFiringRunLog", () => {
  it("全専門家のスコアと選出結果を記録する", async () => {
    const bb = makeBlackboard();
    const decision = await selectSpeaker(
      experts,
      bb,
      new MockScorer({ byExpertName: { ファンダメンタルズ: 8, テクニカル: 3 } }),
    );
    const log = buildFiringRunLog({
      blackboard: bb,
      blackboardPath: "/tmp/bb.json",
      decision,
      scorer: "MockScorer",
    });

    expect(log.session_id).toBe(bb.session_id);
    expect(log.scores).toHaveLength(2);
    expect(log.scores[0]).toMatchObject({ expert: "ファンダメンタルズ", score: 8, threshold: 6, eligible: true });
    expect(log.decision).toEqual({ speaker: "ファンダメンタルズ", quiescent: false, session_complete: false });
    expect(log.model).toBeUndefined();
    expect(() => new Date(log.logged_at).toISOString()).not.toThrow();
  });

  it("model を渡すと記録される", async () => {
    const bb = makeBlackboard();
    const decision = await selectSpeaker(experts, bb, new MockScorer({ fixedScore: 1 }));
    const log = buildFiringRunLog({
      blackboard: bb,
      blackboardPath: "x",
      decision,
      scorer: "AgentSdkScorer",
      model: "claude-haiku-4-5",
    });
    expect(log.model).toBe("claude-haiku-4-5");
    expect(log.decision.quiescent).toBe(true);
    expect(log.decision.session_complete).toBe(true);
  });
});

describe("appendFiringLog", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "firing-log-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("JSONL として1行ずつ追記し、存在しないディレクトリも作る", async () => {
    const logPath = path.join(dir, "nested", "firing.jsonl");
    const bb = makeBlackboard();
    const decision = await selectSpeaker(experts, bb, new MockScorer({ fixedScore: 8 }));
    const entry = buildFiringRunLog({ blackboard: bb, blackboardPath: "x", decision, scorer: "MockScorer" });

    await appendFiringLog(logPath, entry);
    await appendFiringLog(logPath, entry);

    const lines = (await readFile(logPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!) as FiringRunLog;
    expect(parsed.decision.speaker).toBe("ファンダメンタルズ");
  });
});
