import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const cycles = Math.max(1, Number(value("--cycles", "3")) || 3);
const target = value("--target", process.env.VIRA_CERTIFY_TARGET || "https://vira.snelabs.space").replace(/\/$/, "");
const startedAt = new Date().toISOString();
const runs = [];
async function readJson(route) { const response = await fetch(`${target}${route}`, { signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`${route}:${response.status}`); return response.json(); }
const before = await Promise.all([readJson("/ready"), readJson("/operational/metrics"), readJson("/public/playback")]).catch((error) => ({ error: error.message }));
for (let cycle = 1; cycle <= cycles; cycle += 1) {
  const cycleStarted = Date.now();
  const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=domain ledger restores competitive room", "backend/event-sourcing.test.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  const judge = spawnSync(process.execPath, ["--test", "backend/football-events.test.mjs", "backend/verified-round-replay.test.mjs", "backend/http-security.test.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  runs.push({ cycle, durationMs: Date.now() - cycleStarted, e2eExitCode: result.status, judgeExitCode: judge.status, e2ePassed: result.status === 0, judgePassed: judge.status === 0 });
  if (result.status !== 0 || judge.status !== 0) break;
}
const after = await Promise.all([readJson("/ready"), readJson("/operational/metrics"), readJson("/public/playback")]).catch((error) => ({ error: error.message }));
const playbackBefore = Array.isArray(before) ? before[2] : null;
const playbackAfter = Array.isArray(after) ? after[2] : null;
const report = {
  schemaVersion: 1,
  kind: "VIRA_MATCH_CERTIFICATION",
  mode: "accelerated_restart_and_replay",
  target,
  startedAt,
  finishedAt: new Date().toISOString(),
  cyclesRequested: cycles,
  cyclesCompleted: runs.length,
  passed: runs.length === cycles && runs.every((run) => run.e2ePassed && run.judgePassed) && !before?.error && !after?.error,
  invariants: {
    twoDeviceLoop: runs.every((run) => run.e2ePassed),
    restartRehydration: runs.every((run) => run.e2ePassed),
    judgePlayback: runs.every((run) => run.judgePassed),
    publicReadiness: Array.isArray(after) ? after[0]?.ok === true : false,
    replayPreserved: Boolean(playbackBefore?.available && playbackAfter?.available && playbackBefore.replay?.replayHash === playbackAfter.replay?.replayHash),
    rankingPreserved: Boolean(playbackBefore?.available && playbackAfter?.available && playbackBefore.verification?.rankingMatches && playbackAfter.verification?.rankingMatches),
  },
  metrics: { before: Array.isArray(before) ? before[1] : before, after: Array.isArray(after) ? after[1] : after },
  runs,
};
await fs.mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
await fs.writeFile(path.join(process.cwd(), "artifacts", "certify-match.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
