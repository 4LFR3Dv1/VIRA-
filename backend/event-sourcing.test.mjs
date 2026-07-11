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
    const roundId = runtime.snapshot(roomId, renan.participant.id).currentRound.id;

    await runtime.submitAnswer(roomId, roundId, renan.participant.id, "yes", "answer-renan", 1, renan.sessionToken);
    await runtime.submitAnswer(roomId, roundId, ana.participant.id, "no", "answer-ana", 1, ana.sessionToken);
    await runtime.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-101", seq: 101, homePct: 60 }));

    const beforeRestart = runtime.snapshot(roomId, renan.participant.id);
    assert.equal(beforeRestart.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(beforeRestart.leaderboard.find((entry) => entry.participantId === ana.participant.id).points, 0);
    const liveVerification = await runtime.verifyRoom(roomId);
    assert.equal(liveVerification.hashChainValid, true);
    assert.equal(liveVerification.projectionMatches, true);
    assert.equal(liveVerification.rankingMatches, true);

    const eventStoreAfterRestart = await createFileEventStore({ dataDir });
    const runtimeAfterRestart = createRoomRuntime({ eventStore: eventStoreAfterRestart });
    await runtimeAfterRestart.rehydrateFromLedger();
    const restored = runtimeAfterRestart.snapshot(roomId, renan.participant.id);

    assert.equal(restored.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(restored.leaderboard.find((entry) => entry.participantId === ana.participant.id).points, 0);

    await runtimeAfterRestart.applyNormalizedEvent(roomId, oddsEvent({ roomId, id: "odds-101", seq: 101, homePct: 60 }));
    const afterDuplicate = runtimeAfterRestart.snapshot(roomId, renan.participant.id);
    assert.equal(afterDuplicate.leaderboard.find((entry) => entry.participantId === renan.participant.id).points, 100);
    assert.equal(afterDuplicate.latestEvidence.ruleEvaluation.ignoredReason, "duplicate_event_id");

    const nextRoundId = afterDuplicate.currentRound.id;
    await runtimeAfterRestart.submitAnswer(roomId, nextRoundId, renan.participant.id, "yes", "answer-renan-2", afterDuplicate.version, renan.sessionToken);
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
