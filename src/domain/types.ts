export type ConnectionState = "connecting" | "live" | "replaying" | "reconnecting" | "offline";

export type MatchState = "scheduled" | "live" | "paused" | "postponed" | "cancelled" | "finished" | "unknown";

export type RoundState = "scheduled" | "open" | "locked" | "awaiting_event" | "resolved" | "expired";

export type UserAnswerState = "not_answered" | "selected" | "submitted" | "correct" | "incorrect" | "late";

export type MatchRoomUiState =
  | "prediction_open"
  | "prediction_locked"
  | "awaiting_resolution"
  | "resolved_success"
  | "resolved_failure"
  | "next_round_transition"
  | "match_finished";

export type NormalizedMatchEventType = "goal" | "card" | "period" | "odds_shift" | "match_end";

export type EventSource = "txline-live" | "txline-snapshot" | "txline-history";

export type ResolutionMode = "first_matching_event" | "window_elapsed" | "match_state";

export interface Team {
  id: string;
  name: string;
  shortName: string;
  flag: string;
  accent: string;
}

export interface Match {
  id: string;
  title: string;
  competitionLabel: string;
  status: MatchState;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number;
  awayScore: number;
  matchClockSec: number;
  startTime?: string | null;
  venueLabel?: string;
}

export interface Participant {
  id: string;
  displayName: string;
  initials: string;
  accent: string;
  isCurrentUser?: boolean;
}

export interface PredictionOption {
  id: string;
  label: string;
  shortLabel?: string;
}

export interface PredictionResolution {
  mode: ResolutionMode;
  eventType?: NormalizedMatchEventType;
  predicate?: Record<string, unknown>;
  windowEndsAtClockSec?: number;
  elapsedOptionId?: string;
}

export interface PredictionRound {
  id: string;
  version: number;
  matchId: string;
  sequence: number;
  title: string;
  contextLabel: string;
  options: PredictionOption[];
  opensAtClockSec: number;
  locksAtClockSec: number;
  openedAt: string;
  locksAt: string;
  lockedAt?: string | null;
  lockReason?: string;
  state: RoundState;
  resolution: PredictionResolution;
}

export interface PredictionAnswer {
  roundId: string;
  participantId: string;
  optionId: string;
  submittedAtMs: number;
  answeredAtClockSec: number;
  state: UserAnswerState;
}

export interface ScoreEntry {
  participantId: string;
  displayName: string;
  points: number;
  rank: number;
  streak: number;
  movement: "up" | "down" | "steady";
  delta: number;
  isCurrentUser?: boolean;
}

export interface TimelineEntry {
  id: string;
  matchClockSec: number;
  title: string;
  description: string;
  tone: "neutral" | "success" | "warning" | "danger" | "info";
}

export interface NormalizedMatchEvent {
  id: string;
  matchId: string;
  sequence: number;
  occurredAt: string;
  matchClockSec: number;
  type: NormalizedMatchEventType;
  teamId?: string;
  playerId?: string;
  payload: Record<string, unknown>;
  source: EventSource;
  providerSequence?: number;
}

export interface RoundResolutionResult {
  roundId: string;
  winningOptionId: string;
  wasCurrentUserCorrect: boolean;
  pointsAwarded: number;
  streakAfterResolve: number;
  movementLabel: string;
  resolvedBy: "event" | "window" | "match_state";
  event?: NormalizedMatchEvent;
  answersEvaluated?: number;
  answersCorrect?: number;
  totalPointsApplied?: number;
  scoreOutputs?: Array<{
    type: "score.updated";
    participantId: string;
    displayName?: string;
    previousScore: number;
    delta: number;
    currentScore: number;
  }>;
}

export type PresentationEvent =
  | {
      id: string;
      kind: "answer_registered";
      eventId: string;
      roundId: string;
      optionId: string;
    }
  | {
      id: string;
      kind: "txline_update";
      eventId: string;
      previousValue: number | null;
      currentValue: number | null;
      providerSequence?: number;
    }
  | {
      id: string;
      kind: "round_resolved";
      eventId: string;
      roundId: string;
      correct: boolean;
      pointsAwarded: number;
      previousRank: number | null;
      currentRank: number | null;
      winningOptionId: string;
      openingValue: number | null;
      resolutionValue: number | null;
    }
  | {
      id: string;
      kind: "verification_completed";
      eventId: string;
      projectionMatches: boolean;
    };

export interface EvidenceChain {
  id: string;
  correlationId: string;
  createdAt: string;
  status: "received" | "normalized" | "matched" | "resolved" | "ignored" | "failed";
  input: {
    requestId: string;
    fixtureId: string;
    provider: "TxLINE";
    endpoint: string;
    httpMethod: "GET";
    httpStatus: number;
    receivedAt: string;
    rawPayloadHash: string;
    excerpt: {
      market?: string;
      percentages?: number[];
      providerSequence?: number;
      line?: string | null;
      period?: string | null;
      priceNames?: string[];
    };
  };
  normalization: {
    eventId: string;
    sourceInputRequestId: string | null;
    type: NormalizedMatchEventType;
    source: EventSource;
    localSequence: number;
    providerSequence?: number;
    matchClockSec: number;
    teamId?: string;
    normalizedValues: {
      homeProbability?: number;
      drawProbability?: number;
      awayProbability?: number;
      marketType?: string;
      line?: string | null;
      period?: string | null;
      priceNames?: string[];
    };
  };
  ruleEvaluation: {
    roundId: string | null;
    roundPrompt: string | null;
    eventId: string;
    ruleMode: string;
    expression: string;
    actualValue: number | null;
    expectedOperator: string | null;
    expectedValue: number | string | null;
    predicateResult: boolean;
    roundStateBefore: string;
    windowValid: boolean;
    ignoredReason?: string;
  };
  resolution?: {
    resolutionId: string;
    roundId: string;
    causedByEventId: string;
    winningOptionId: string;
    resolvedBy: "event" | "window_elapsed" | "match_state";
    answersEvaluated: number;
    answersCorrect: number;
    totalPointsApplied: number;
    idempotencyKey: string;
  };
  outputs: Array<
    | {
        type: "score.updated";
        participantId: string;
        displayName?: string;
        previousScore: number;
        delta: number;
        currentScore: number;
      }
    | {
        type: "leaderboard.updated";
        previousVersion: number;
        currentVersion: number;
      }
    | {
        type: "timeline.created";
        timelineEntryId: string;
      }
    | {
        type: "sse.emitted";
        eventId: string;
        eventName: string;
        clientCount: number;
      }
  >;
}

export interface RoomSnapshot {
  roomId: string;
  roomLabel: string;
  roomPopulation: number;
  match: Match;
  connectionState: ConnectionState;
  currentRound: PredictionRound | null;
  currentParticipant?: Participant | null;
  participants: Participant[];
  answers: Record<string, PredictionAnswer>;
  currentParticipantAnswer?: PredictionAnswer | null;
  answerSummary?: { total: number; byOption?: Record<string, number> };
  fanPulse?: {
    total: number;
    byTeam: { home: number; away: number };
    currentParticipantChoice: "home" | "away" | null;
  };
  leaderboard: ScoreEntry[];
  timeline: TimelineEntry[];
  marketDistribution: Record<string, number>;
  roomDistribution: Record<string, number>;
  version: number;
  lastSequence: number;
  source?: EventSource;
  lastNormalizedEvent?: NormalizedMatchEvent | null;
  lastResolution?: RoundResolutionResult | null;
  latestEvidence?: EvidenceChain | null;
  evidenceHistory: EvidenceChain[];
  ledger?: {
    streamVersion: number;
    headHash: string | null;
  };
}

export interface RoomVerification {
  roomId: string;
  status: "verified" | "diverged" | string;
  eventCount: number;
  streamVersion: number;
  ledgerHeadHash: string | null;
  hashChainValid: boolean;
  replaySucceeded: boolean;
  liveProjectionHash: string;
  replayedProjectionHash: string;
  projectionMatches: boolean;
  rankingMatches: boolean;
  authorityValid?: boolean;
  schemaVersion: number;
}

export interface VerifiedRoundReplayV1 {
  domain: "VIRA:VERIFIED_ROUND_REPLAY:V1";
  schemaVersion: 1;
  replayHash: string;
  roomId: string;
  roundId: string;
  roundVersion: number;
  prompt: { text: string; operator: ">=" | ">"; targetValue: number; priceName: string; marketSignature: string };
  opening: { eventId: string | null; providerSequence: number | null; value: number | null; observedAt: string; acquisitionOrigin: string };
  participation: { confirmedAnswers: number; distributionVisible: boolean; distribution: Record<string, number> };
  lock: { lockedAt: string; reason: "deadline" | "eligible_signal"; causedByEventId: string | null; temporalIntegrityValid: boolean };
  resolution: { eventId: string; providerSequence: number | null; observedValue: number | null; winningOptionId: string; expression: string; predicateResult: boolean; resolvedAt: string; acquisitionOrigin: string };
  scoring: { answersEvaluated: number; answersCorrect: number; totalPointsApplied: number; leaderboardBeforeHash: string; leaderboardAfterHash: string };
  proof: {
    firstStreamVersion: number;
    lastStreamVersion: number;
    roundEventRangeHash: string;
    hashChainValid: boolean;
    projectionMatches: boolean;
    rankingMatches: boolean;
    authorityValid: boolean;
    temporalIntegrityValid: boolean;
    eligibilityValid: boolean;
    determinismValid: boolean;
  };
  technical: {
    openingStreamVersion: number;
    lockStreamVersion: number;
    resolutionStreamVersion: number;
    marketType: string | null;
    line: unknown;
    period: unknown;
    minimumProviderSequence: number | null;
    eligibilityChecks: Record<string, boolean>;
    causationId: string | null;
    correlationId: string | null;
    openingEventHash: string;
    lockEventHash: string;
    resolutionEventHash: string;
  };
}

export interface RoundCommitmentStatus {
  status: "unsupported" | "pending" | "confirming" | "confirmed" | "failed";
  roomId?: string;
  roundId: string;
  network: string;
  commitmentHash?: string;
  replayHash?: string;
  signature?: string;
  slot?: number | null;
  authority?: string;
  confirmedAt?: string;
  explorerUrl?: string;
  onChainCommitmentHash?: string;
  onChainMatches?: boolean;
  failedAt?: string;
  reason?: string;
}

export interface PublicDomainEvent {
  eventId: string;
  streamId: string;
  roomId: string;
  type: string;
  globalPosition: number;
  streamVersion: number;
  idempotencyKey: string;
  causationId?: string;
  correlationId: string;
  createdAt: string;
  schemaVersion: number;
  previousStreamEventHash: string | null;
  eventHash: string;
  payload: Record<string, unknown>;
}

export interface ReplayStepOpenRound {
  atMs: number;
  type: "round.open";
  roundId: string;
}

export interface ReplayStepLockRound {
  atMs: number;
  type: "round.lock";
  roundId: string;
}

export interface ReplayStepParticipantAnswer {
  atMs: number;
  type: "participant.answer";
  roundId: string;
  participantId: string;
  optionId: string;
}

export interface ReplayStepMatchEvent {
  atMs: number;
  type: "match.event";
  event: NormalizedMatchEvent;
}

export interface ReplayStepClockSet {
  atMs: number;
  type: "clock.set";
  matchClockSec: number;
}

export interface ReplayStepMatchState {
  atMs: number;
  type: "match.state";
  state: MatchState;
}

export type ReplayStep =
  | ReplayStepOpenRound
  | ReplayStepLockRound
  | ReplayStepParticipantAnswer
  | ReplayStepMatchEvent
  | ReplayStepClockSet
  | ReplayStepMatchState;

export interface ReplayScript {
  matchId: string;
  title: string;
  durationMs: number;
  rounds: PredictionRound[];
  steps: ReplayStep[];
}

export interface ReplayState {
  matchId: string;
  status: "idle" | "playing" | "paused" | "finished";
  speed: 0.5 | 1 | 2;
  currentStepIndex: number;
  elapsedMs: number;
  snapshot: RoomSnapshot;
  selectedOptionId: string | null;
  currentAnswerState: UserAnswerState;
  currentUiState: MatchRoomUiState;
  currentRoundOpenedAtMs: number | null;
  lastResolution: RoundResolutionResult | null;
}
