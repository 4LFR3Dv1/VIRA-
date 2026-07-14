function stablePart(value) { return encodeURIComponent(String(value ?? "unknown")); }
function eventId(snapshot, type, entityId, marker) { return ["attention-v1", stablePart(snapshot.roomId), type, stablePart(entityId ?? "match"), stablePart(marker ?? "once")].join(":"); }
function publicEvent(event) { return { event, audience: { kind: "public" } }; }
function privateEvent(event, participantId) { return { event, audience: { kind: "participant", participantId } }; }

export function projectConsumerAttentionEvents(snapshot, participantId) {
  const occurredAt = snapshot.serverTime ?? new Date(0).toISOString();
  const events = [];
  const round = snapshot.currentRound;
  const currentParticipant = participantId && snapshot.currentParticipant?.id === participantId ? snapshot.currentParticipant : null;
  const currentAnswer = currentParticipant ? snapshot.currentParticipantAnswer ?? snapshot.answers?.[participantId] ?? null : null;
  const currentRank = currentParticipant ? snapshot.leaderboard?.find((entry) => entry.participantId === participantId) ?? null : null;
  if (snapshot.match.status === "scheduled") events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "match_starting", snapshot.match.id, snapshot.match.startTime), type: "match_starting", fixtureId: snapshot.match.id, roomId: snapshot.roomId, occurredAt, visibility: "public", payload: { kickoffAt: snapshot.match.startTime ?? null, matchStatus: snapshot.match.status } }));
  if (snapshot.match.status === "live") events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "match_live", snapshot.match.id, "live"), type: "match_live", fixtureId: snapshot.match.id, roomId: snapshot.roomId, occurredAt, visibility: "public", payload: { homeScore: snapshot.match.homeScore, awayScore: snapshot.match.awayScore, matchClockSec: snapshot.match.matchClockSec } }));
  if (round?.state === "open") events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "round_open", round.id, round.openedAt), type: "round_open", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: round.id, occurredAt: round.openedAt, expiresAt: round.locksAt, visibility: "public", payload: { locksAt: round.locksAt, roundVersion: round.version, sequence: round.sequence } }));
  if (round && (round.state === "locked" || round.state === "awaiting_event") && currentParticipant) events.push(privateEvent({ version: 1, eventId: eventId(snapshot, "round_locked", round.id, round.lockedAt ?? round.locksAt), type: "round_locked", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: round.id, occurredAt: round.lockedAt ?? occurredAt, visibility: "participant_private", payload: { answerConfirmed: currentAnswer?.state === "submitted", lockReason: round.lockReason ?? null } }, participantId));
  if (snapshot.lastResolution && currentParticipant) events.push(privateEvent({ version: 1, eventId: eventId(snapshot, "round_resolved", snapshot.lastResolution.roundId, snapshot.lastResolution.event?.id ?? snapshot.lastResolution.event?.occurredAt ?? snapshot.lastResolution.winningOptionId), type: "round_resolved", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: snapshot.lastResolution.roundId, occurredAt: snapshot.lastResolution.event?.occurredAt ?? occurredAt, visibility: "participant_private", payload: { correct: snapshot.lastResolution.wasCurrentUserCorrect, pointsAwarded: snapshot.lastResolution.pointsAwarded, rank: currentRank?.rank ?? null, winningOptionId: snapshot.lastResolution.winningOptionId } }, participantId));
  return events;
}

export function projectRankChangedEvent(snapshot, participantId, previousRank) {
  if (!participantId || !Number.isFinite(previousRank)) return null;
  const current = snapshot.leaderboard?.find((entry) => entry.participantId === participantId);
  if (!current || current.rank === previousRank) return null;
  const occurredAt = snapshot.serverTime ?? new Date(0).toISOString();
  return privateEvent({ version: 1, eventId: eventId(snapshot, "rank_changed", "participant", `${previousRank}-${current.rank}-${current.points}`), type: "rank_changed", fixtureId: snapshot.match.id, roomId: snapshot.roomId, occurredAt, visibility: "participant_private", payload: { previousRank, currentRank: current.rank, points: current.points } }, participantId);
}

export function selectAttentionForParticipant(events, participantId) {
  return events.filter(({ audience }) => audience.kind === "public" || (participantId !== null && audience.participantId === participantId)).map(({ event }) => event);
}
