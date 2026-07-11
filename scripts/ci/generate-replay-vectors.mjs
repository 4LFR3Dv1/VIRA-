import fs from "node:fs/promises";
import path from "node:path";

import { deriveVerifiedRoundReplay } from "../../backend/verified-round-replay.mjs";

const outputDir = path.resolve("tests/fixtures/replay");
const verification = { hashChainValid: true, projectionMatches: true, rankingMatches: true, authorityValid: true };

function stored(streamVersion, type, payload, extra = {}) {
  return {
    eventId: extra.eventId ?? `evt-${streamVersion}`,
    streamId: "room-vector",
    roomId: "room-vector",
    type,
    globalPosition: streamVersion,
    streamVersion,
    idempotencyKey: `${type}:${streamVersion}`,
    causationId: extra.causationId ?? null,
    correlationId: "corr-vector",
    createdAt: extra.createdAt ?? new Date(Date.UTC(2026, 6, 11, 18, 0, streamVersion)).toISOString(),
    schemaVersion: 1,
    previousStreamEventHash: streamVersion === 1 ? null : `sha256:event-${streamVersion - 1}`,
    eventHash: `sha256:event-${streamVersion}`,
    payload,
  };
}

function round() {
  return {
    id: "round-vector-1",
    version: 1,
    sequence: 1,
    title: "Empate chega a 43% ou mais no proximo sinal?",
    openedAt: "2026-07-11T18:00:02.000Z",
    locksAt: "2026-07-11T18:01:30.000Z",
    options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }],
    resolution: {
      mode: "first_matching_event",
      eventType: "odds_shift",
      predicate: {
        market: "1X2_PARTICIPANT_RESULT",
        marketSignature: "1X2_PARTICIPANT_RESULT|null|null|book-1",
        priceName: "draw",
        side: "draw",
        openingValue: 42.2,
        pctGte: 43,
        openedFromEventId: "odds-opening",
        minimumProviderSequence: 102,
      },
    },
  };
}

function resolutionObservation(origin = "txline_live_stream", value = 43.4) {
  return {
    id: "odds-resolution",
    type: "odds_shift",
    source: "txline-live",
    acquisitionOrigin: origin,
    providerSequence: 102,
    receivedAt: "2026-07-11T18:01:31.000Z",
    payload: {
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      MarketParameters: null,
      MarketPeriod: null,
      PriceNames: ["part1", "draw", "part2"],
      Pct: [21.3, value, 35.3],
      Seq: 102,
    },
  };
}

function events({ answers = ["yes", "no"], lockReason = "resolution_signal_received", origin = "txline_live_stream", duplicate = false } = {}) {
  const result = [
    stored(1, "room.configured", { match: { id: "fixture-vector" } }),
    stored(2, "round.opened", { round: round() }),
    stored(3, "participant.joined", { participant: { id: "participant-a", displayName: "A" } }),
    stored(4, "participant.joined", { participant: { id: "participant-b", displayName: "B" } }),
  ];
  for (const [index, optionId] of answers.entries()) {
    result.push(stored(result.length + 1, "answer.submitted", { answer: { roundId: "round-vector-1", participantId: index === 0 ? "participant-a" : "participant-b", optionId } }, { createdAt: `2026-07-11T18:00:${10 + index}.000Z` }));
  }
  if (duplicate) result.push(stored(result.length + 1, "txline.event.ignored", { providerEventId: "odds-resolution", reason: "duplicate_event_id" }));
  const observation = resolutionObservation(origin);
  result.push(stored(result.length + 1, "txline.event.received", { providerEventId: observation.id, providerSequence: 102, normalizedObservation: observation, acquisitionOrigin: origin }));
  result.push(stored(result.length + 1, "txline.event.accepted", { providerEventId: observation.id, providerSequence: 102, event: observation, acquisitionOrigin: origin }));
  result.push(stored(result.length + 1, "round.locked", { roundId: "round-vector-1", roundVersion: 2, lockedAt: "2026-07-11T18:01:30.000Z", reason: lockReason }, { causationId: observation.id, createdAt: "2026-07-11T18:01:30.000Z" }));
  result.push(stored(result.length + 1, "round.resolved", {
    roundId: "round-vector-1",
    causedByTxlineEventId: observation.id,
    winningOptionId: "yes",
    answersEvaluated: answers.length,
    answersCorrect: answers.filter((option) => option === "yes").length,
    totalPointsApplied: answers.includes("yes") ? 100 : 0,
    awards: answers.includes("yes") ? [{ participantId: "participant-a", displayName: "A", points: 100, previousScore: 0, currentScore: 100, correct: true }] : [],
    event: observation,
  }, { causationId: observation.id, createdAt: "2026-07-11T18:01:31.000Z" }));
  return result;
}

const definitions = [
  ["round-v1-success.json", events(), verification],
  ["round-v1-no-answers.json", events({ answers: [] }), verification],
  ["round-v1-deadline-lock.json", events({ lockReason: "deadline_elapsed" }), verification],
  ["round-v1-authority-invalid.json", events({ origin: "internal_test" }), { ...verification, authorityValid: false }],
  ["round-v1-duplicate-signal.json", events({ duplicate: true }), verification],
  ["round-v1-restart.json", JSON.parse(JSON.stringify(events())), verification],
];

await fs.mkdir(outputDir, { recursive: true });
for (const [fileName, inputEvents, context] of definitions) {
  const expectedReplay = deriveVerifiedRoundReplay(inputEvents, "round-vector-1", context);
  const vector = { schemaVersion: 1, roundId: "round-vector-1", verification: context, events: inputEvents, expectedReplay, expectedReplayHash: expectedReplay.replayHash };
  await fs.writeFile(path.join(outputDir, fileName), `${JSON.stringify(vector, null, 2)}\n`, "utf8");
}

console.log(`Generated ${definitions.length} replay vectors in ${outputDir}`);
