import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`backend_exited_${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend_health_timeout");
}

test("internal ingestion is disabled by default and rejected requests do not append events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-http-security-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_INTERNAL_INGEST_ENABLED: "false", VIRA_ADMIN_TOKEN: "test-admin-secret", VIRA_ALLOWED_ORIGINS: origin, TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(origin, child);
    const ready = await fetch(`${origin}/ready`);
    assert.equal(ready.status, 200);
    const readiness = await ready.json();
    assert.equal(readiness.ok, true);
    assert.equal(readiness.checks.rehydration.ok, true);
    assert.equal(readiness.checks.eventStore.ok, true);
    assert.equal(readiness.checks.txline.required, false);
    const frontend = await fetch(`${origin}/`);
    assert.equal(frontend.status, 200);
    assert.match(frontend.headers.get("content-type") || "", /^text\/html/);
    const html = await frontend.text();
    const modulePath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(modulePath, "built frontend module should be present");
    const moduleResponse = await fetch(new URL(modulePath, origin));
    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get("content-type") || "", /^text\/javascript/);
    assert.doesNotMatch(await moduleResponse.text(), /<html/i);
    const vapid = await fetch(`${origin}/companion/vapid-public-key`);
    assert.equal(vapid.status, 200);
    assert.deepEqual(await vapid.json(), { enabled: false, publicKey: null });
    const disabledSubscription = await fetch(`${origin}/companion/subscriptions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionToken: "must-not-be-accepted" }) });
    assert.equal(disabledSubscription.status, 503);
    const serviceWorker = await fetch(`${origin}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    assert.equal(serviceWorker.headers.get("cache-control"), "no-cache");
    assert.equal(serviceWorker.headers.get("service-worker-allowed"), "/");
    const response = await fetch(`${origin}/rooms/security-room/txline-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vira-Admin-Token": "test-admin-secret" },
      body: JSON.stringify({ type: "period", payload: {} }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "internal_ingest_disabled");
    const ledger = await readFile(path.join(dataDir, "events.jsonl"), "utf8").catch(() => "");
    assert.equal(ledger.includes("security-room"), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("readiness fails when production requires missing TxLINE credentials", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-ready-txline-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_REQUIRE_TXLINE_CREDENTIALS: "true", TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(origin, child);
    const response = await fetch(`${origin}/ready`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.checks.txline.required, true);
    assert.equal(body.checks.txline.configured, false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("public round replay endpoint is canonical and public answers stay private", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-http-replay-"));
  const roomId = "fixture-http-replay";
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let child;
  try {
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    await runtime.rehydrateFromLedger();
    runtime.configureMatch({ fixtureId: roomId, title: "Norway vs England", competitionLabel: "World Cup", status: "live", homeTeam: "Norway", awayTeam: "England" });
    const participant = await runtime.join(roomId, "Private Player");
    const round = runtime.snapshot(roomId, participant.participant.id).currentRound;
    await runtime.submitAnswer(roomId, round.id, participant.participant.id, "yes", "answer-http-replay", round.version, participant.sessionToken);
    runtime.getRoom(roomId).currentRound.locksAt = new Date(Date.now() - 1).toISOString();
    await runtime.applyNormalizedEvent(roomId, {
      id: "odds-http-replay",
      matchId: roomId,
      sequence: 101,
      occurredAt: "2026-07-11T18:01:31.000Z",
      matchClockSec: 90,
      type: "odds_shift",
      source: "txline-live",
      payload: { FixtureId: roomId, MessageId: "odds-http-replay", Seq: 101, SuperOddsType: "1X2_PARTICIPANT_RESULT", MarketParameters: null, MarketPeriod: null, PriceNames: ["part1", "draw", "part2"], Pct: [60, 30, 10] },
    });

    child = spawn(process.execPath, ["backend/server.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_INTERNAL_INGEST_ENABLED: "false", TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth(origin, child);
    const replayResponse = await fetch(`${origin}/public/rooms/${roomId}/rounds/${round.id}/replay`);
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.domain, "VIRA:VERIFIED_ROUND_REPLAY:V1");
    assert.equal(replay.roundId, round.id);
    assert.equal(replay.participation.confirmedAnswers, 1);
    assert.equal(JSON.stringify(replay).includes(participant.participant.id), false);

    const commitmentResponse = await fetch(`${origin}/public/rooms/${roomId}/rounds/${round.id}/commitment`);
    assert.equal(commitmentResponse.status, 200);
    assert.deepEqual(await commitmentResponse.json(), { status: "unsupported", roomId, roundId: round.id, network: "unsupported" });

    const eventsResponse = await fetch(`${origin}/public/rooms/${roomId}/events`);
    assert.equal(eventsResponse.status, 200);
    const publicEvents = (await eventsResponse.json()).events;
    const publicAnswer = publicEvents.find((event) => event.type === "answer.submitted");
    assert.deepEqual(publicAnswer.payload, { roundId: round.id, state: "confirmed_private" });
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
