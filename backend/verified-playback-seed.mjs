const ROOM_ID = "judge-playback-france-spain";
const ROUND_ID = "judge-playback-round-1";
const CORRELATION_ID = "judge-playback-capture-v1";

function capturedEvent(type, sequence, payload, causationId = null) {
  return { eventId: `judge-playback-event-${sequence}`, roomId: ROOM_ID, type, idempotencyKey: `judge-playback-v1:${sequence}`, causationId, correlationId: CORRELATION_ID, createdAt: `2026-07-11T18:0${Math.min(sequence, 9)}:00.000Z`, payload };
}

function playbackEvents() {
  const observation = { id: "judge-playback-odds-resolution", type: "odds_shift", source: "verified-playback", acquisitionOrigin: "verified_playback", providerSequence: 102, receivedAt: "2026-07-11T18:01:31.000Z", payload: { SuperOddsType: "1X2_PARTICIPANT_RESULT", MarketParameters: null, MarketPeriod: null, PriceNames: ["part1", "draw", "part2"], Pct: [21.3, 43.4, 35.3], Seq: 102 } };
  return [
    capturedEvent("room.configured", 1, { match: { id: "judge-playback-fixture", fixtureId: "judge-playback-fixture", homeTeam: { id: "france", name: "Franca", shortName: "FRA" }, awayTeam: { id: "spain", name: "Espanha", shortName: "ESP" }, competition: "Copa do Mundo", status: "finished", homeScore: 2, awayScore: 1 } }),
    capturedEvent("round.opened", 2, { round: { id: ROUND_ID, version: 1, sequence: 1, title: "O empate chega a 43% ou mais nesta observacao?", openedAt: "2026-07-11T18:00:02.000Z", locksAt: "2026-07-11T18:01:30.000Z", options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Nao" }], resolution: { mode: "first_matching_event", eventType: "odds_shift", predicate: { market: "1X2_PARTICIPANT_RESULT", marketSignature: "1X2_PARTICIPANT_RESULT|null|null|judge-capture-v1", priceName: "draw", side: "draw", openingValue: 42.2, pctGte: 43, openedFromEventId: "judge-playback-odds-opening", openingProviderSequence: 101, openingObservedAt: "2026-07-11T18:00:02.000Z", openingAcquisitionOrigin: "verified_playback", minimumProviderSequence: 102 } } } }),
    capturedEvent("participant.joined", 3, { participant: { id: "judge-a", displayName: "Ana" } }),
    capturedEvent("participant.joined", 4, { participant: { id: "judge-b", displayName: "Bruno" } }),
    capturedEvent("answer.submitted", 5, { answer: { roundId: ROUND_ID, participantId: "judge-a", optionId: "yes" } }),
    capturedEvent("answer.submitted", 6, { answer: { roundId: ROUND_ID, participantId: "judge-b", optionId: "no" } }),
    capturedEvent("txline.event.received", 7, { providerEventId: observation.id, providerSequence: 102, normalizedObservation: observation, acquisitionOrigin: "verified_playback" }),
    capturedEvent("txline.event.accepted", 8, { providerEventId: observation.id, providerSequence: 102, event: observation, acquisitionOrigin: "verified_playback" }),
    capturedEvent("round.locked", 9, { roundId: ROUND_ID, roundVersion: 2, lockedAt: "2026-07-11T18:01:30.000Z", reason: "resolution_signal_received" }, observation.id),
    capturedEvent("round.resolved", 10, { roundId: ROUND_ID, causedByTxlineEventId: observation.id, winningOptionId: "yes", answersEvaluated: 2, answersCorrect: 1, totalPointsApplied: 100, awards: [{ participantId: "judge-a", displayName: "Ana", points: 100, previousScore: 0, currentScore: 100, correct: true }], event: observation }, observation.id),
  ];
}

export async function ensureVerifiedPlayback({ eventStore, runtime }) {
  if (!eventStore || !runtime) throw new Error("verified_playback_dependencies_required");
  const metadata = await eventStore.getStreamMetadata(ROOM_ID);
  let seeded = false;
  if (metadata.version === 0) {
    await eventStore.append({ streamId: ROOM_ID, expectedStreamVersion: 0, events: playbackEvents() });
    seeded = true;
  }
  await runtime.projectRoomFromLedger(ROOM_ID);
  const verification = await runtime.verifyRoom(ROOM_ID);
  const replay = await runtime.verifiedRoundReplay(ROOM_ID, ROUND_ID);
  if (verification.status !== "verified" || replay?.proof?.authorityValid !== true) throw new Error("verified_playback_integrity_failure");
  return { seeded, roomId: ROOM_ID, roundId: ROUND_ID, replayHash: replay.replayHash, ledgerHeadHash: verification.ledgerHeadHash };
}

export const verifiedPlaybackIds = Object.freeze({ roomId: ROOM_ID, roundId: ROUND_ID });
