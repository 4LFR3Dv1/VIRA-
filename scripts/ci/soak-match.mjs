import fs from "node:fs/promises";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const target = String(arg("target", "http://127.0.0.1:8787")).replace(/\/$/, "");
const durationSec = Math.max(30, Number(arg("duration-sec", 14_400)));
const intervalSec = Math.max(5, Number(arg("interval-sec", 30)));
const output = path.resolve(arg("output", "artifacts/soak-match.json"));
const startedAt = new Date().toISOString();
const deadline = Date.now() + durationSec * 1_000;
const samples = [];
const failures = [];
let baselineReplayHash = null;

async function json(route) {
  const response = await fetch(`${target}${route}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${route}:${response.status}`);
  return response.json();
}

while (Date.now() < deadline || samples.length === 0) {
  try {
    const [ready, metrics, playback] = await Promise.all([json("/ready"), json("/operational/metrics"), json("/public/playback")]);
    const replayHash = playback?.replay?.replayHash ?? null;
    baselineReplayHash ??= replayHash;
    const sample = {
      measuredAt: new Date().toISOString(),
      ready: ready?.ok === true,
      rssBytes: metrics?.process?.rssBytes ?? null,
      heapUsedBytes: metrics?.process?.heapUsedBytes ?? null,
      eventLoopLagMs: metrics?.process?.eventLoopLagMs ?? null,
      queueDepth: metrics?.runtime?.queueDepth ?? null,
      sseClients: metrics?.runtime?.sseClients ?? null,
      feedDegraded: metrics?.txline?.feeds?.degraded ?? null,
      ledgerPosition: metrics?.ledger?.globalPosition ?? null,
      replayHash,
      replayPreserved: Boolean(replayHash && replayHash === baselineReplayHash),
      projectionMatches: playback?.verification?.projectionMatches === true,
      rankingMatches: playback?.verification?.rankingMatches === true,
    };
    samples.push(sample);
    if (!sample.ready || !sample.replayPreserved || !sample.projectionMatches || !sample.rankingMatches || Number(sample.queueDepth) > 0) failures.push(sample);
  } catch (error) {
    failures.push({ measuredAt: new Date().toISOString(), error: error.message });
  }
  if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, intervalSec * 1_000));
}

const rss = samples.map((sample) => Number(sample.rssBytes)).filter(Number.isFinite);
const report = {
  schemaVersion: 1,
  kind: "VIRA_MATCH_SOAK",
  target,
  startedAt,
  finishedAt: new Date().toISOString(),
  requestedDurationSec: durationSec,
  intervalSec,
  samples: samples.length,
  passed: failures.length === 0,
  invariants: {
    readinessContinuous: samples.every((sample) => sample.ready),
    queueDrained: samples.every((sample) => Number(sample.queueDepth) === 0),
    replayPreserved: samples.every((sample) => sample.replayPreserved),
    projectionPreserved: samples.every((sample) => sample.projectionMatches),
    rankingPreserved: samples.every((sample) => sample.rankingMatches),
  },
  bounds: {
    maxEventLoopLagMs: Math.max(...samples.map((sample) => Number(sample.eventLoopLagMs) || 0)),
    maxQueueDepth: Math.max(...samples.map((sample) => Number(sample.queueDepth) || 0)),
    rssStartBytes: rss[0] ?? null,
    rssEndBytes: rss.at(-1) ?? null,
    rssDeltaBytes: rss.length ? rss.at(-1) - rss[0] : null,
  },
  failures,
  observations: samples,
};
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
