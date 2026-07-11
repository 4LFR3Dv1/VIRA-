import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";

function pending(type, idempotencyKey, payload = {}) {
  return {
    roomId: "room-a",
    type,
    idempotencyKey,
    correlationId: `corr-${idempotencyKey}`,
    payload,
  };
}

function oddsEvent({ roomId, id, seq, homePct, extraPayload = {} }) {
  return {
    id,
    matchId: roomId,
    sequence: seq,
    occurredAt: new Date(1_800_000_000_000 + seq).toISOString(),
    matchClockSec: 5400 + seq,
    type: "odds_shift",
    source: "txline-live",
    payload: {
      FixtureId: roomId,
      MessageId: id,
      Seq: seq,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketParameters: null,
      MarketPeriod: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: [homePct, 100 - homePct, 0],
      ...extraPayload,
    },
  };
}

function matchEndEvent(roomId) {
  return {
    id: "match-end-1",
    matchId: roomId,
    sequence: 900,
    occurredAt: new Date(1_800_000_001_000).toISOString(),
    matchClockSec: 6000,
    type: "match_end",
    source: "txline-live",
    payload: {
      FixtureId: roomId,
      Seq: 900,
      Action: "match_end",
    },
  };
}

async function appendDirectEvents(dataDir, streamId = "room-a", count = 3) {
  const store = await createFileEventStore({ dataDir });
  for (let index = 0; index < count; index += 1) {
    await store.append({
      streamId,
      expectedStreamVersion: index,
      events: [pending("test.event", `test:${streamId}:${index}`, { index })],
    });
  }
  return store;
}

async function setupRuntimeRoom(dataDir, roomId = "fixture-live") {
  const eventStore = await createFileEventStore({ dataDir });
  const runtime = createRoomRuntime({ eventStore });
  runtime.configureMatch({
    fixtureId: roomId,
    title: "Spain vs Belgium",
    competitionLabel: "World Cup",
    status: "live",
    homeTeam: "Spain",
    awayTeam: "Belgium",
  });
  const renan = await runtime.join(roomId, "Renan");
  const ana = await runtime.join(roomId, "Ana");
  return { eventStore, runtime, renan, ana, roomId };
}

test("pre-match Fan Pulse is authenticated, aggregated and restored from the ledger", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-fan-pulse-"));
  try {
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    const roomId = "fixture-scheduled";
    runtime.configureMatch({ fixtureId: roomId, title: "Norway vs England", competitionLabel: "World Cup", status: "scheduled", homeTeam: "Norway", awayTeam: "England" });
    const renan = await runtime.join(roomId, "Renan");
    const ana = await runtime.join(roomId, "Ana");

    await runtime.castFanPulse(roomId, renan.participant.id, "home", renan.sessionToken);
    await runtime.castFanPulse(roomId, ana.participant.id, "away", ana.sessionToken);
    const publicSnapshot = runtime.snapshot(roomId, null);
    assert.deepEqual(publicSnapshot.fanPulse, { total: 2, byTeam: { home: 1, away: 1 }, currentParticipantChoice: null });
    assert.equal(runtime.authenticatedSnapshot(roomId, renan.participant.id, renan.sessionToken).fanPulse.currentParticipantChoice, "home");
    await assert.rejects(() => runtime.castFanPulse(roomId, renan.participant.id, "away", renan.sessionToken), /fan_pulse_already_cast/);
    await assert.rejects(() => runtime.castFanPulse(roomId, ana.participant.id, "home", renan.sessionToken), /invalid_session/);

    const restoredStore = await createFileEventStore({ dataDir });
    const restored = createRoomRuntime({ eventStore: restoredStore });
    await restored.rehydrateFromLedger();
    assert.deepEqual(restored.snapshot(roomId, null).fanPulse.byTeam, { home: 1, away: 1 });
    assert.equal((await restored.publicEvents(roomId)).filter((event) => event.type === "fan_pulse.cast").length, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("optimistic concurrency rejects stale append and succeeds after reload/redecision", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-concurrency-"));
  try {
    const store = await createFileEventStore({ dataDir });
    const first = store.append({
      streamId: "room-a",
      expectedStreamVersion: 0,
      events: [pending("test.event", "same-version:a", { value: "a" })],
    });
    const second = store.append({
      streamId: "room-a",
      expectedStreamVersion: 0,
      events: [pending("test.event", "same-version:b", { value: "b" })],
    });
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);

    const metadata = await store.getStreamMetadata("room-a");
    await store.append({
      streamId: "room-a",
      expectedStreamVersion: metadata.version,
      events: [pending("test.event", "same-version:b", { value: "b" })],
    });
    assert.equal((await store.getStreamMetadata("room-a")).version, 2);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("file store quarantines a partial last line when metadata is still behind", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-truncated-"));
  try {
    await appendDirectEvents(dataDir, "room-a", 1);
    const eventsPath = path.join(dataDir, "events.jsonl");
    const partialBatch = JSON.stringify({ batchId: "partial", streamId: "room-a", events: [{ type: "broken" }] }).slice(0, 30);
    await writeFile(eventsPath, `${await readFile(eventsPath, "utf8")}${partialBatch}`, "utf8");

    const recovered = await createFileEventStore({ dataDir });
    assert.equal((await recovered.getStreamMetadata("room-a")).version, 1);
    const quarantineFiles = await readdir(path.join(dataDir, "quarantine"));
    assert.equal(quarantineFiles.length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("file store fails closed on tamper, removed batch, swapped order and intermediate corruption", async () => {
  for (const scenario of ["tamper", "remove", "swap", "corrupt-middle"]) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), `vira-${scenario}-`));
    try {
      await appendDirectEvents(dataDir, "room-a", 3);
      const eventsPath = path.join(dataDir, "events.jsonl");
      const lines = (await readFile(eventsPath, "utf8")).trim().split(/\r?\n/);
      if (scenario === "tamper") {
        const batch = JSON.parse(lines[0]);
        batch.events[0].payload.index = 999;
        lines[0] = JSON.stringify(batch);
      }
      if (scenario === "remove") {
        lines.splice(2, 1);
      }
      if (scenario === "swap") {
        [lines[0], lines[1]] = [lines[1], lines[0]];
      }
      if (scenario === "corrupt-middle") {
        lines[1] = "{";
      }
      await writeFile(eventsPath, `${lines.join("\n")}\n`, "utf8");
      await assert.rejects(() => createFileEventStore({ dataDir }));
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  }
});

test("public event stream never exposes session or provider secrets", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-sanitize-"));
  try {
    const { runtime, renan, ana, roomId } = await setupRuntimeRoom(dataDir);
    const roundId = runtime.snapshot(roomId, renan.participant.id).currentRound.id;
    await runtime.submitAnswer(roomId, roundId, renan.participant.id, "yes", "answer-secret", 1, renan.sessionToken);
    await runtime.applyNormalizedEvent(roomId, oddsEvent({
      roomId,
      id: "odds-secret",
      seq: 101,
      homePct: 60,
      extraPayload: {
        Authorization: "Bearer TXLINE_JWT",
        "X-Api-Token": "TXLINE_API_TOKEN",
        headers: { Authorization: "Bearer nested" },
      },
    }));

    const publicEvents = await runtime.publicEvents(roomId);
    const serialized = JSON.stringify(publicEvents).toLowerCase();
    for (const forbidden of ["sessiontoken", "sessiontokenhash", "txline_jwt", "txline_api_token", "authorization", "x-api-token"]) {
      assert.equal(serialized.includes(forbidden.toLowerCase()), false, forbidden);
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("match.finished makes the competitive projection read-only", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-finished-"));
  try {
    const { runtime, renan, roomId } = await setupRuntimeRoom(dataDir);
    await runtime.applyNormalizedEvent(roomId, matchEndEvent(roomId));
    const finished = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(finished.match.status, "finished");
    assert.equal(finished.currentRound.state, "expired");

    await assert.rejects(
      () => runtime.submitAnswer(roomId, finished.currentRound.id, renan.participant.id, "yes", "late-answer", finished.version, renan.sessionToken),
      /round_not_open/,
    );

    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-after-end", seq: 901, homePct: 70 }));
    const afterOdds = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(afterOdds.match.status, "finished");
    assert.equal(afterOdds.currentRound.state, "expired");
    assert.equal(afterOdds.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 0);
    assert.equal(afterOdds.latestEvidence.ruleEvaluation.ignoredReason, "match_already_finished");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("streams isolate rooms, hash chains and idempotency keys", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-isolation-"));
  try {
    const store = await createFileEventStore({ dataDir });
    await store.append({
      streamId: "room-a",
      expectedStreamVersion: 0,
      events: [{ ...pending("test.event", "shared-key", { room: "a" }), roomId: "room-a" }],
    });
    await store.append({
      streamId: "room-b",
      expectedStreamVersion: 0,
      events: [{ ...pending("test.event", "shared-key", { room: "b" }), roomId: "room-b" }],
    });

    assert.equal((await store.getStreamMetadata("room-a")).version, 1);
    assert.equal((await store.getStreamMetadata("room-b")).version, 1);
    assert.notEqual((await store.getStreamMetadata("room-a")).headHash, (await store.getStreamMetadata("room-b")).headHash);

    const roomAEvents = [];
    for await (const event of store.readStream("room-a")) roomAEvents.push(event);
    const roomBEvents = [];
    for await (const event of store.readStream("room-b")) roomBEvents.push(event);
    assert.equal(roomAEvents.length, 1);
    assert.equal(roomBEvents.length, 1);
    assert.equal(roomAEvents[0].payload.room, "a");
    assert.equal(roomBEvents[0].payload.room, "b");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("round authority rejects stale version and foreign token without mutating ledger", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-round-authority-"));
  try {
    const { eventStore, runtime, renan, ana, roomId } = await setupRuntimeRoom(dataDir);
    const round = runtime.snapshot(roomId, renan.participant.id).currentRound;
    const before = await eventStore.getStreamMetadata(roomId);
    await assert.rejects(() => runtime.submitAnswer(roomId, round.id, renan.participant.id, "yes", "stale", round.version - 1, renan.sessionToken), /stale_round_version/);
    await assert.rejects(() => runtime.submitAnswer(roomId, round.id, renan.participant.id, "yes", "foreign", round.version, ana.sessionToken), /invalid_session/);
    const after = await eventStore.getStreamMetadata(roomId);
    assert.equal(after.version, before.version);
    assert.equal(after.headHash, before.headHash);
    assert.equal(runtime.snapshot(roomId, renan.participant.id).leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("deadline persists round.locked and rejects the late answer", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-round-deadline-"));
  try {
    const { runtime, renan, roomId } = await setupRuntimeRoom(dataDir);
    const room = runtime.getRoom(roomId);
    room.currentRound = { ...room.currentRound, locksAt: new Date(Date.now() - 1).toISOString() };
    await assert.rejects(() => runtime.submitAnswer(roomId, room.currentRound.id, renan.participant.id, "yes", "late", room.currentRound.version, renan.sessionToken), /round_locked/);
    const authenticated = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(authenticated.currentRound.state, "locked");
    assert.equal(authenticated.currentParticipantAnswer, null);
    const events = await runtime.publicEvents(roomId);
    assert.equal(events.filter((event) => event.type === "round.locked").length, 1);
    assert.equal(events.some((event) => event.type === "answer.submitted"), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("public projection hides individual answers and option split until lock", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-public-answers-"));
  try {
    const { runtime, renan, ana, roomId } = await setupRuntimeRoom(dataDir);
    const round = runtime.snapshot(roomId, renan.participant.id).currentRound;
    await runtime.submitAnswer(roomId, round.id, renan.participant.id, "yes", "answer-private", round.version, renan.sessionToken);
    const publicBeforeLock = runtime.snapshot(roomId, null);
    assert.deepEqual(publicBeforeLock.answers, {});
    assert.equal(publicBeforeLock.currentParticipantAnswer, null);
    assert.equal(publicBeforeLock.answerSummary.total, 1);
    assert.equal(publicBeforeLock.answerSummary.byOption, undefined);
    assert.deepEqual(publicBeforeLock.roomDistribution, {});
    const room = runtime.getRoom(roomId);
    room.currentRound = { ...room.currentRound, locksAt: new Date(Date.now() - 1).toISOString() };
    await assert.rejects(
      () => runtime.submitAnswer(roomId, round.id, ana.participant.id, "no", "answer-after-deadline", round.version, ana.sessionToken),
      /round_locked/,
    );
    const publicAfterLock = runtime.snapshot(roomId, null);
    assert.equal(publicAfterLock.answers[renan.participant.id], undefined);
    assert.equal(publicAfterLock.answerSummary.byOption.yes, 1);
    const events = await runtime.publicEvents(roomId);
    const lockedIndex = events.findIndex((event) => event.type === "round.locked");
    assert.ok(lockedIndex > -1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("concurrent matching observations resolve a round only once", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-resolution-race-"));
  try {
    const { runtime, renan, roomId } = await setupRuntimeRoom(dataDir);
    const round = runtime.snapshot(roomId, renan.participant.id).currentRound;
    await runtime.submitAnswer(roomId, round.id, renan.participant.id, "yes", "race-answer", round.version, renan.sessionToken);
    runtime.getRoom(roomId).currentRound.locksAt = new Date(Date.now() - 1).toISOString();
    await Promise.all([
      runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "race-1", seq: 301, homePct: 60 }), { acquisitionOrigin: "txline_live_stream" }),
      runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "race-2", seq: 302, homePct: 61 }), { acquisitionOrigin: "txline_live_stream" }),
    ]);
    const events = await runtime.publicEvents(roomId);
    assert.equal(events.filter((event) => event.type === "round.locked" && event.payload.roundId === round.id).length, 1);
    assert.equal(events.filter((event) => event.type === "round.resolved" && event.payload.roundId === round.id).length, 1);
    assert.equal(runtime.snapshot(roomId, renan.participant.id).leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("signals received during the answer window cannot close or mutate the round contract", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-fixed-answer-window-"));
  try {
    const { runtime, renan, roomId } = await setupRuntimeRoom(dataDir);
    const room = runtime.getRoom(roomId);
    room.currentRound = {
      ...room.currentRound,
      title: "Spain chega a 53% ou mais no proximo sinal?",
      locksAt: new Date(Date.now() + 30_000).toISOString(),
      answerWindowSec: 30,
      resolution: {
        ...room.currentRound.resolution,
        predicate: {
          ...room.currentRound.resolution.predicate,
          openingValue: 52,
          pctGte: 53,
          openedFromEventId: "opening-100",
          minimumProviderSequence: 101,
        },
      },
    };
    const frozen = { title: room.currentRound.title, openingValue: room.currentRound.resolution.predicate.openingValue, target: room.currentRound.resolution.predicate.pctGte };
    await runtime.submitAnswer(roomId, room.currentRound.id, renan.participant.id, "yes", "window-answer", room.currentRound.version, renan.sessionToken);
    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "window-signal-1", seq: 101, homePct: 54 }), { acquisitionOrigin: "txline_live_stream" });

    const duringWindow = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(duringWindow.currentRound.state, "open");
    assert.equal(duringWindow.leaderboard[0].points, 0);
    assert.deepEqual({ title: duringWindow.currentRound.title, openingValue: duringWindow.currentRound.resolution.predicate.openingValue, target: duringWindow.currentRound.resolution.predicate.pctGte }, frozen);
    const eventsBeforeLock = await runtime.publicEvents(roomId);
    assert.equal(eventsBeforeLock.some((event) => event.type === "round.locked"), false);
    assert.equal(eventsBeforeLock.some((event) => event.type === "round.resolved"), false);

    runtime.getRoom(roomId).currentRound.locksAt = new Date(Date.now() - 1).toISOString();
    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "window-signal-2", seq: 102, homePct: 54 }), { acquisitionOrigin: "txline_live_stream" });
    const resolved = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(resolved.leaderboard[0].points, 100);
    const finalEvents = await runtime.publicEvents(roomId);
    assert.equal(finalEvents.filter((event) => event.type === "round.locked").length, 1);
    assert.equal(finalEvents.filter((event) => event.type === "round.resolved").length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
