import type { RoomSnapshot } from "../../domain/types.ts";
import type { ConsumerAttentionEventV1, ProjectedConsumerAttentionEventV1 } from "./contracts.ts";

function version(snapshot: RoomSnapshot) {
  return snapshot.ledger?.streamVersion ?? snapshot.version;
}

function eventId(snapshot: RoomSnapshot, type: ConsumerAttentionEventV1["type"], roundId?: string) {
  return ["attention-v1", snapshot.roomId, type, roundId ?? "match", version(snapshot)].join(":");
}

function publicEvent(event: ConsumerAttentionEventV1): ProjectedConsumerAttentionEventV1 {
  return { event, audience: { kind: "public" } };
}

function privateEvent(event: ConsumerAttentionEventV1, participantId: string): ProjectedConsumerAttentionEventV1 {
  return { event, audience: { kind: "participant", participantId } };
}

export function projectConsumerAttentionEvents(snapshot: RoomSnapshot, participantId: string | null): ProjectedConsumerAttentionEventV1[] {
  const occurredAt = snapshot.serverTime ?? new Date(0).toISOString();
  const events: ProjectedConsumerAttentionEventV1[] = [];
  const round = snapshot.currentRound;
  const currentParticipant = participantId && snapshot.currentParticipant?.id === participantId ? snapshot.currentParticipant : null;
  const currentAnswer = currentParticipant ? snapshot.currentParticipantAnswer ?? snapshot.answers[participantId] ?? null : null;
  const currentRank = currentParticipant ? snapshot.leaderboard.find((entry) => entry.participantId === participantId) ?? null : null;

  if (snapshot.match.status === "scheduled") {
    events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "match_starting"), type: "match_starting", fixtureId: snapshot.match.id, roomId: snapshot.roomId, occurredAt, visibility: "public", payload: { kickoffAt: snapshot.match.startTime ?? null, matchStatus: snapshot.match.status } }));
  }
  if (snapshot.match.status === "live") {
    events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "match_live"), type: "match_live", fixtureId: snapshot.match.id, roomId: snapshot.roomId, occurredAt, visibility: "public", payload: { homeScore: snapshot.match.homeScore, awayScore: snapshot.match.awayScore, matchClockSec: snapshot.match.matchClockSec } }));
  }
  if (round?.state === "open") {
    events.push(publicEvent({ version: 1, eventId: eventId(snapshot, "round_open", round.id), type: "round_open", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: round.id, occurredAt: round.openedAt, expiresAt: round.locksAt, visibility: "public", payload: { locksAt: round.locksAt, roundVersion: round.version, sequence: round.sequence } }));
  }
  if (round && (round.state === "locked" || round.state === "awaiting_event") && currentParticipant) {
    events.push(privateEvent({ version: 1, eventId: eventId(snapshot, "round_locked", round.id), type: "round_locked", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: round.id, occurredAt: round.lockedAt ?? occurredAt, visibility: "participant_private", payload: { answerConfirmed: currentAnswer?.state === "submitted", lockReason: round.lockReason ?? null } }, participantId));
  }
  if (snapshot.lastResolution && currentParticipant && snapshot.lastResolution.roundId === round?.id) {
    events.push(privateEvent({ version: 1, eventId: eventId(snapshot, "round_resolved", snapshot.lastResolution.roundId), type: "round_resolved", fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: snapshot.lastResolution.roundId, occurredAt: snapshot.lastResolution.event?.occurredAt ?? occurredAt, visibility: "participant_private", payload: { correct: snapshot.lastResolution.wasCurrentUserCorrect, pointsAwarded: snapshot.lastResolution.pointsAwarded, rank: currentRank?.rank ?? null, winningOptionId: snapshot.lastResolution.winningOptionId } }, participantId));
  }
  return events;
}

export function projectRankChange(previous: RoomSnapshot, current: RoomSnapshot, participantId: string | null): ProjectedConsumerAttentionEventV1 | null {
  if (!participantId || current.currentParticipant?.id !== participantId) return null;
  const before = previous.leaderboard.find((entry) => entry.participantId === participantId);
  const after = current.leaderboard.find((entry) => entry.participantId === participantId);
  if (!before || !after || before.rank === after.rank) return null;
  const occurredAt = current.serverTime ?? new Date(0).toISOString();
  return privateEvent({ version: 1, eventId: eventId(current, "rank_changed", current.lastResolution?.roundId), type: "rank_changed", fixtureId: current.match.id, roomId: current.roomId, roundId: current.lastResolution?.roundId, occurredAt, visibility: "participant_private", payload: { previousRank: before.rank, currentRank: after.rank, points: after.points } }, participantId);
}

export function selectAttentionForParticipant(events: ProjectedConsumerAttentionEventV1[], participantId: string | null): ConsumerAttentionEventV1[] {
  return events
    .filter(({ audience }) => audience.kind === "public" || (participantId !== null && audience.participantId === participantId))
    .map(({ event }) => event);
}
