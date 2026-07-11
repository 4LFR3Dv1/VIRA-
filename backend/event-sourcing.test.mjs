import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";

function oddsEvent({ roomId, id, seq, homePct }) {
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
    },
  };
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("wait_for_timeout");
}

test("domain ledger restores competitive room and keeps txline idempotency after restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-ledger-"));
  try {
    const roomId = "fixture-test-1";
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    await runtime.rehydrateFromLedger();
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
    const openingRound = runtime.snapshot(roomId, renan.participant.id).currentRound;
    const roundId = openingRound.id;

    await runtime.submitAnswer(roomId, roundId, renan.participant.id, "yes", "answer-renan", openingRound.version, renan.sessionToken);
    await runtime.submitAnswer(roomId, roundId, ana.participant.id, "no", "answer-ana", openingRound.version, ana.sessionToken);
    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-101", seq: 101, homePct: 60 }));

    const beforeRestart = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(beforeRestart.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(beforeRestart.leaderboard.find((entry) => entry.participantId === ana.participant.id).points, 0);
    const liveVerification = await runtime.verifyRoom(roomId);
    assert.equal(liveVerification.hashChainValid, true);
    assert.equal(liveVerification.projectionMatches, true);
    assert.equal(liveVerification.rankingMatches, true);
    const replayBeforeRestart = await runtime.verifiedRoundReplay(roomId, roundId);
    assert.equal(replayBeforeRestart.proof.hashChainValid, true);
    assert.equal(replayBeforeRestart.proof.projectionMatches, true);
    assert.equal(replayBeforeRestart.proof.rankingMatches, true);
    assert.equal(replayBeforeRestart.participation.confirmedAnswers, 2);
    assert.deepEqual(replayBeforeRestart.participation.distribution, { yes: 1, no: 1 });

    const eventStoreAfterRestart = await createFileEventStore({ dataDir });
    const runtimeAfterRestart = createRoomRuntime({ eventStore: eventStoreAfterRestart });
    await runtimeAfterRestart.rehydrateFromLedger();
    const restored = runtimeAfterRestart.snapshot(roomId, renan.participant.id);
    const replayAfterRestart = await runtimeAfterRestart.verifiedRoundReplay(roomId, roundId);

    assert.equal(replayAfterRestart.replayHash, replayBeforeRestart.replayHash);
    assert.deepEqual(replayAfterRestart, replayBeforeRestart);

    assert.equal(restored.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(restored.leaderboard.find((entry) => entry.participantId === ana.participant.id).points, 0);

    await runtimeAfterRestart.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-101", seq: 101, homePct: 60 }));
    const afterDuplicate = runtimeAfterRestart.snapshot(roomId, renan.participant.id);
    assert.equal(afterDuplicate.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(afterDuplicate.latestEvidence.ruleEvaluation.ignoredReason, "duplicate_event_id");

    const nextRoundId = afterDuplicate.currentRound.id;
    await runtimeAfterRestart.submitAnswer(roomId, nextRoundId, renan.participant.id, "yes", "answer-renan-2", afterDuplicate.currentRound.version, renan.sessionToken);
    const afterSessionAnswer = runtimeAfterRestart.snapshot(roomId, renan.participant.id);
    assert.equal(afterSessionAnswer.answers[renan.participant.id].optionId, "yes");

    const verification = await runtimeAfterRestart.verifyRoom(roomId);
    assert.equal(verification.hashChainValid, true);
    assert.equal(verification.projectionMatches, true);
    assert.equal(verification.rankingMatches, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("txline can be the first mutation but room configuration still opens the ledger", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-ledger-first-txline-"));
  try {
    const roomId = "fixture-first-txline";
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore });
    await runtime.rehydrateFromLedger();
    runtime.configureMatch({
      fixtureId: roomId,
      title: "Spain vs Belgium",
      competitionLabel: "World Cup",
      status: "live",
      homeTeam: "Spain",
      awayTeam: "Belgium",
    });

    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-first", seq: 11, homePct: 54 }));

    const publicEvents = await runtime.publicEvents(roomId);
    assert.equal(publicEvents[0].type, "room.configured");
    assert.equal(publicEvents[1].type, "round.opened");
    assert.equal(publicEvents[2].type, "txline.event.received");
    assert.equal(publicEvents[3].type, "txline.event.accepted");

    const verification = await runtime.verifyRoom(roomId);
    assert.equal(verification.hashChainValid, true);
    assert.equal(verification.projectionMatches, true);
    assert.equal(verification.rankingMatches, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("round commitment publishes asynchronously once and survives restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-commitment-"));
  const published = [];
  const publisher = {
    enabled: true,
    network: "devnet",
    async publish(commitment) {
      published.push(commitment.commitmentHash);
      return { network: "devnet", signature: "signature-vector", slot: 424242, authority: "authority-vector", confirmedAt: "2026-07-11T18:02:00.000Z", explorerUrl: "https://explorer.solana.com/tx/signature-vector?cluster=devnet" };
    },
  };
  try {
    const roomId = "fixture-commitment";
    const eventStore = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore, commitmentPublisher: publisher });
    await runtime.rehydrateFromLedger();
    runtime.configureMatch({ fixtureId: roomId, title: "Spain vs Belgium", competitionLabel: "World Cup", status: "live", homeTeam: "Spain", awayTeam: "Belgium" });
    const participant = await runtime.join(roomId, "Renan");
    const round = runtime.snapshot(roomId, participant.participant.id).currentRound;
    await runtime.submitAnswer(roomId, round.id, participant.participant.id, "yes", "answer-commitment", round.version, participant.sessionToken);
    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-commitment", seq: 101, homePct: 60 }));

    const confirmed = await waitFor(async () => {
      const state = await runtime.roundCommitment(roomId, round.id);
      return state.status === "confirmed" ? state : null;
    });
    assert.equal(confirmed.signature, "signature-vector");
    assert.equal(confirmed.network, "devnet");
    assert.equal(published.length, 1);
    const replay = await runtime.verifiedRoundReplay(roomId, round.id);
    assert.equal(confirmed.replayHash, replay.replayHash, JSON.stringify({ confirmed, replayProof: replay.proof }));

    const restartStore = await createFileEventStore({ dataDir });
    const restarted = createRoomRuntime({ eventStore: restartStore, commitmentPublisher: publisher });
    await restarted.rehydrateFromLedger();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(published.length, 1);
    assert.equal((await restarted.roundCommitment(roomId, round.id)).signature, "signature-vector");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
