import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";
import { applyFixtureLifecycleTimeout, normalizeTxlineScore } from "./txline-client.mjs";

function rawAction(fixtureId, { action, id, seq, clock, participant = 1, confirmed = true, outcome = null, score = { home: 0, away: 0 } }) {
  return { FixtureId: fixtureId, Action: action, Id: id, Seq: seq, Participant: participant, Participant1IsHome: true, Confirmed: confirmed, Data: outcome ? { Outcome: outcome } : {}, Clock: { Running: true, Seconds: clock }, Score: { Participant1: { Total: { Goals: score.home } }, Participant2: { Total: { Goals: score.away } } } };
}

function scoreEvent(roomId, id, seq, clock, home, away) {
  return normalizeTxlineScore(rawAction(roomId, { action: "period", id, seq, clock, score: { home, away } }), { matchId: roomId, source: "txline-snapshot" });
}

test("normalizer preserves shot authority, amendments and discarded action identity", () => {
  const shot = normalizeTxlineScore(rawAction("fixture", { action: "shot", id: "shot-1", seq: 1, clock: 300, confirmed: false, outcome: "OnTarget" }));
  const amendment = normalizeTxlineScore(rawAction("fixture", { action: "amend_shot", id: "shot-1", seq: 2, clock: 301, confirmed: true, outcome: "OnTarget" }));
  const discarded = normalizeTxlineScore(rawAction("fixture", { action: "action_discarded", id: "shot-1", seq: 3, clock: 302 }));
  assert.deepEqual({ type: shot.type, side: shot.participantSide, confirmed: shot.confirmed, outcome: shot.outcome }, { type: "shot", side: "home", confirmed: false, outcome: "OnTarget" });
  assert.equal(amendment.type, "action_amended");
  assert.equal(amendment.amendedActionType, "shot");
  assert.equal(amendment.sourceActionId, "shot-1");
  assert.notEqual(amendment.id, shot.id);
  assert.equal(discarded.type, "action_discarded");
  assert.equal(discarded.discardedActionId, "shot-1");
});

test("stale live fixtures close only after the configured lifecycle window", () => {
  const kickoff = "2026-07-12T01:00:00.000Z";
  const fixture = { fixtureId: "stale-live", status: "live", startTime: kickoff };
  assert.equal(applyFixtureLifecycleTimeout(fixture, { nowMs: Date.parse(kickoff) + 2 * 60 * 60 * 1_000 }).status, "live");
  const finished = applyFixtureLifecycleTimeout(fixture, { nowMs: Date.parse(kickoff) + 3 * 60 * 60 * 1_000 });
  assert.equal(finished.status, "finished");
  assert.equal(finished.reportedStatus, "live");
  assert.equal(finished.lifecycleResolution, "maximum_live_window_elapsed");
});

test("authoritative stats reconcile amendment and discard", async () => {
  const runtime = createRoomRuntime();
  const roomId = "stats-reconciliation";
  await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "shot", id: "shot-1", seq: 1, clock: 300, confirmed: false, outcome: "OnTarget" })));
  assert.equal(runtime.snapshot(roomId).matchStats.home.shotsOnTarget, 0);
  await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "amend_shot", id: "shot-1", seq: 2, clock: 301, confirmed: true, outcome: "OnTarget" })));
  assert.equal(runtime.snapshot(roomId).matchStats.home.shotsOnTarget, 1);
  await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "action_discarded", id: "shot-1", seq: 3, clock: 302 })));
  assert.equal(runtime.snapshot(roomId).matchStats.home.shotsOnTarget, 0);
  await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "shot", id: "shot-away", seq: 4, clock: 303, participant: 2, confirmed: true, outcome: "OnTarget" })));
  assert.equal(runtime.snapshot(roomId).matchStats.away.shotsOnTarget, 1);
});

test("RoundDirector opens team_shot_on_target and replay V2 survives restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-shot-condition-"));
  try {
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    const roomId = "shot-condition";
    runtime.configureMatch({ fixtureId: roomId, title: "Argentina vs England", status: "live", homeTeam: "Argentina", awayTeam: "England" }, { suggestedPrediction: { priceName: "part1" } });
    const player = await runtime.join(roomId, "Ana", "admission-shot-condition");
    let room = runtime.getRoom(roomId);
    await runtime.submitAnswer(roomId, room.currentRound.id, player.participant.id, "yes", "goal-answer", room.currentRound.version, player.sessionToken);
    room.currentRound = { ...room.currentRound, locksAt: new Date(Date.now() - 1).toISOString() };
    await runtime.applyNormalizedEvent(roomId, scoreEvent(roomId, "opening", 10, 600, 0, 0));
    await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "shot", id: "coverage-shot", seq: 11, clock: 610, confirmed: true, outcome: "OnTarget" })));
    await runtime.applyNormalizedEvent(roomId, scoreEvent(roomId, "goal-candidate", 12, 650, 1, 0));
    await runtime.applyNormalizedEvent(roomId, scoreEvent(roomId, "goal-confirmed", 13, 651, 1, 0));
    assert.equal(runtime.getRoom(roomId).currentRound.resolution.condition.kind, "team_scores");
    assert.equal(runtime.getRoom(roomId).roundHistory.filter((item) => item.family === "team_shot_on_target").length, 0);
    assert.equal(runtime.getRoom(roomId).matchStats.reliability.shots, "reliable");
    await runtime.applyNormalizedEvent(roomId, scoreEvent(roomId, "director", 14, 891, 1, 0));
    room = runtime.getRoom(roomId);
    assert.equal(room.matchStats.reliability.shots, "reliable");
    assert.equal(room.currentRound.state, "open");
    assert.equal(room.currentRound.resolution.condition.kind, "team_shot_on_target");
    assert.match(room.currentRound.title, /finaliza no alvo/i);
    const shotRoundId = room.currentRound.id;
    await runtime.submitAnswer(roomId, shotRoundId, player.participant.id, "yes", "shot-answer", room.currentRound.version, player.sessionToken);
    room.currentRound = { ...room.currentRound, locksAt: new Date(Date.now() - 1).toISOString() };
    await runtime.applyNormalizedEvent(roomId, scoreEvent(roomId, "shot-window-open", 15, 900, 1, 0));
    await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawAction(roomId, { action: "shot", id: "winning-shot", seq: 16, clock: 930, participant: 2, confirmed: true, outcome: "OnTarget", score: { home: 1, away: 0 } })));
    const resolved = runtime.authenticatedSnapshot(roomId, player.participant.id, player.sessionToken);
    assert.equal(resolved.matchStats.away.shotsOnTarget, 1);
    assert.equal(resolved.lastResolution.winningOptionId, "yes");
    assert.equal(resolved.lastResolution.condition.kind, "team_shot_on_target");
    const replay = await runtime.verifiedRoundReplay(roomId, shotRoundId);
    assert.equal(replay.schemaVersion, 2);
    assert.equal(replay.prompt.marketSignature, "football:team_shot_on_target");
    assert.equal(replay.proof.determinismValid, true, JSON.stringify({ condition: replay.condition, resolution: replay.resolution }));
    const restartedStore = await createFileEventStore({ dataDir });
    const restarted = createRoomRuntime({ eventStore: restartedStore });
    await restarted.rehydrateFromLedger();
    assert.equal((await restarted.verifiedRoundReplay(roomId, shotRoundId)).replayHash, replay.replayHash);
    assert.equal((await restarted.verifyRoom(roomId)).projectionMatches, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("match_end locks and resolves an open football round before finalizing the room", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-match-end-"));
  try {
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    const roomId = "terminal-football-round";
    runtime.configureMatch({ fixtureId: roomId, title: "Argentina vs England", status: "live", homeTeam: "Argentina", awayTeam: "England" }, { suggestedPrediction: { priceName: "part1" } });
    const player = await runtime.join(roomId, "Ana", "terminal-admission");
    const round = runtime.getRoom(roomId).currentRound;
    await runtime.submitAnswer(roomId, round.id, player.participant.id, "no", "terminal-answer", round.version, player.sessionToken);
    const finalEvent = normalizeTxlineScore(rawAction(roomId, { action: "end", id: "full-time", seq: 99, clock: 0, score: { home: 3, away: 1 } }), { matchId: roomId, source: "txline-live" });
    await runtime.applyNormalizedEvent(roomId, finalEvent);
    const final = runtime.authenticatedSnapshot(roomId, player.participant.id, player.sessionToken);
    assert.equal(final.match.status, "finished");
    assert.equal(final.match.matchClockSec, 90 * 60);
    assert.equal(final.currentRound.state, "resolved");
    assert.equal(final.lastResolution.winningOptionId, "no");
    assert.equal(final.lastResolution.resolutionReason, "match_finished");
    assert.equal(final.lastResolution.wasCurrentUserCorrect, true);
    assert.equal(final.lastResolution.pointsAwarded, 100);

    const restartedStore = await createFileEventStore({ dataDir });
    const restarted = createRoomRuntime({ eventStore: restartedStore });
    await restarted.rehydrateFromLedger();
    const restored = restarted.authenticatedSnapshot(roomId, player.participant.id, player.sessionToken);
    assert.equal(restored.match.status, "finished");
    assert.equal(restored.currentRound.state, "resolved");
    assert.equal(restored.lastResolution.resolutionReason, "match_finished");
    assert.equal((await restarted.verifyRoom(roomId)).projectionMatches, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("catalog final status uses the same terminal ledger transition", async () => {
  const runtime = createRoomRuntime();
  const roomId = "catalog-terminal-round";
  runtime.configureMatch({ fixtureId: roomId, title: "Argentina vs England", status: "live", homeTeam: "Argentina", awayTeam: "England" }, { suggestedPrediction: { priceName: "part1" } });
  const player = await runtime.join(roomId, "Bob", "catalog-terminal-admission");
  runtime.configureMatch({ fixtureId: roomId, title: "Argentina vs England", status: "finished", reportedStatus: "live", lifecycleResolution: "maximum_live_window_elapsed", homeTeam: "Argentina", awayTeam: "England" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const final = runtime.authenticatedSnapshot(roomId, player.participant.id, player.sessionToken);
  assert.equal(final.match.status, "finished");
  assert.equal(final.currentRound.state, "resolved");
  assert.equal(final.lastResolution.resolutionReason, "match_finished");
  assert.equal(final.lastResolution.event.acquisitionOrigin, "verified_playback");
});

test("startup reconciles legacy finished rooms with an unresolved football round", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-terminal-repair-"));
  try {
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    const roomId = "legacy-terminal-round";
    runtime.configureMatch({ fixtureId: roomId, title: "Argentina vs England", status: "live", homeTeam: "Argentina", awayTeam: "England" }, { suggestedPrediction: { priceName: "part1" } });
    const player = await runtime.join(roomId, "Ana", "legacy-terminal-admission");
    const round = runtime.getRoom(roomId).currentRound;
    await runtime.submitAnswer(roomId, round.id, player.participant.id, "no", "legacy-terminal-answer", round.version, player.sessionToken);
    const metadata = await eventStore.getStreamMetadata(roomId);
    await eventStore.append({
      streamId: roomId,
      expectedStreamVersion: metadata.version,
      events: [{
        type: "match.finished",
        roomId,
        idempotencyKey: `legacy-match-finished:${roomId}`,
        payload: {
          fixtureId: roomId,
          reason: "legacy_txline_game_finalised",
          event: { id: "legacy-full-time", matchId: roomId, type: "match_end", matchClockSec: 0, absoluteScore: { home: 3, away: 1 }, occurredAt: new Date().toISOString(), source: "txline-live", payload: {} },
        },
      }],
    });

    const restartedStore = await createFileEventStore({ dataDir });
    const restarted = createRoomRuntime({ eventStore: restartedStore });
    await restarted.rehydrateFromLedger();
    const repaired = restarted.authenticatedSnapshot(roomId, player.participant.id, player.sessionToken);
    assert.equal(repaired.match.status, "finished");
    assert.equal(repaired.currentRound.state, "resolved");
    assert.equal(repaired.lastResolution.winningOptionId, "no");
    assert.equal(repaired.lastResolution.resolutionReason, "match_finished");
    assert.equal(repaired.lastResolution.wasCurrentUserCorrect, true);
    assert.equal((await restarted.verifyRoom(roomId)).projectionMatches, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
