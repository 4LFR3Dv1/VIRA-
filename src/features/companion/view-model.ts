import type { ReplayState } from "../../domain/types.ts";
import { projectConsumerAttentionEvents, selectAttentionForParticipant } from "./attention-projector.ts";
import type { ConsumerAttentionEventV1 } from "./contracts.ts";

export type ViraCompanionState = "upcoming" | "live" | "round_open" | "answer_confirmed" | "locked" | "resolved" | "offline" | "reconnecting" | "error";

export interface ViraCompanionViewModel {
  version: 1;
  state: ViraCompanionState;
  fixtureId: string;
  roomId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  matchClockSec: number;
  kickoffAt: string | null;
  roundId: string | null;
  locksAt: string | null;
  serverTime: string | null;
  roundKind: "team_scores" | "team_shot_on_target" | "market" | null;
  targetTeam: string | null;
  durationMinutes: number | null;
  answerConfirmed: boolean;
  correct: boolean | null;
  pointsAwarded: number | null;
  rank: number | null;
  streamVersion: number;
  attentionEvents: ConsumerAttentionEventV1[];
}

export function sameViraCompanionViewModel(left: ViraCompanionViewModel, right: ViraCompanionViewModel) {
  return left.state === right.state && left.homeTeam === right.homeTeam && left.awayTeam === right.awayTeam && left.homeScore === right.homeScore && left.awayScore === right.awayScore && left.locksAt === right.locksAt && left.roundKind === right.roundKind && left.targetTeam === right.targetTeam && left.durationMinutes === right.durationMinutes && left.answerConfirmed === right.answerConfirmed && left.correct === right.correct && left.pointsAwarded === right.pointsAwarded && left.rank === right.rank;
}

export function deriveViraCompanionViewModel(state: ReplayState, participantId: string | null): ViraCompanionViewModel {
  const snapshot = state.snapshot;
  const round = snapshot.currentRound;
  const answer = participantId && snapshot.currentParticipant?.id === participantId
    ? snapshot.currentParticipantAnswer ?? snapshot.answers[participantId] ?? null
    : null;
  const ranking = participantId && snapshot.currentParticipant?.id === participantId
    ? snapshot.leaderboard.find((entry) => entry.participantId === participantId) ?? null
    : null;
  const resolution = participantId && snapshot.currentParticipant?.id === participantId && snapshot.lastResolution?.roundId === round?.id
    ? snapshot.lastResolution
    : null;
  const answerConfirmed = Boolean(participantId && snapshot.currentParticipant?.id === participantId && (answer?.state === "submitted" || state.currentAnswerState === "submitted"));

  let companionState: ViraCompanionState;
  if (snapshot.connectionState === "offline") companionState = "offline";
  else if (snapshot.connectionState === "reconnecting" || snapshot.connectionState === "connecting") companionState = "reconnecting";
  else if (resolution) companionState = "resolved";
  else if (round?.state === "locked" || round?.state === "awaiting_event") companionState = "locked";
  else if (round?.state === "open" && answerConfirmed) companionState = "answer_confirmed";
  else if (round?.state === "open") companionState = "round_open";
  else if (snapshot.match.status === "scheduled") companionState = "upcoming";
  else if (snapshot.match.status === "live" || snapshot.match.status === "paused") companionState = "live";
  else companionState = "error";

  return {
    version: 1,
    state: companionState,
    fixtureId: snapshot.match.id,
    roomId: snapshot.roomId,
    homeTeam: snapshot.match.homeTeam.name,
    awayTeam: snapshot.match.awayTeam.name,
    homeScore: snapshot.match.homeScore,
    awayScore: snapshot.match.awayScore,
    matchClockSec: snapshot.match.matchClockSec,
    kickoffAt: snapshot.match.startTime ?? null,
    roundId: round?.id ?? null,
    locksAt: round?.locksAt ?? null,
    serverTime: snapshot.serverTime ?? null,
    roundKind: round?.resolution.domain === "football" ? round.resolution.condition?.kind ?? null : round ? "market" : null,
    targetTeam: round?.resolution.condition?.targetSide === "away" ? snapshot.match.awayTeam.name : round?.resolution.condition ? snapshot.match.homeTeam.name : null,
    durationMinutes: round?.resolution.condition ? Math.max(1, Math.round(round.resolution.condition.durationSec / 60)) : null,
    answerConfirmed,
    correct: resolution?.wasCurrentUserCorrect ?? null,
    pointsAwarded: resolution?.pointsAwarded ?? null,
    rank: ranking?.rank ?? null,
    streamVersion: snapshot.ledger?.streamVersion ?? snapshot.version,
    attentionEvents: selectAttentionForParticipant(projectConsumerAttentionEvents(snapshot, participantId), participantId),
  };
}
