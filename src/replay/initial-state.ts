import type { Match, PredictionRound, ReplayState, RoomSnapshot, Team } from "../domain/types";
import { DEFAULT_MATCH_ID } from "../domain/contracts";

const pendingHome: Team = {
  id: "home",
  name: "TxLINE Home",
  shortName: "HOME",
  flag: "",
  accent: "#caff28",
};

const pendingAway: Team = {
  id: "away",
  name: "TxLINE Away",
  shortName: "AWAY",
  flag: "",
  accent: "#71b9e8",
};

export const replayMatch: Match = {
  id: DEFAULT_MATCH_ID,
  title: "Carregando fixture TxLINE",
  competitionLabel: "TxLINE",
  status: "live",
  homeTeam: pendingHome,
  awayTeam: pendingAway,
  homeScore: 0,
  awayScore: 0,
  matchClockSec: 0,
};

export const replayRounds: PredictionRound[] = [
  {
    id: "round-1",
    matchId: DEFAULT_MATCH_ID,
    sequence: 1,
    title: "Aguardando regra da sala",
    contextLabel: "TxLINE",
    options: [
      { id: "yes", label: "Sim" },
      { id: "no", label: "Nao" },
    ],
    opensAtClockSec: 0,
    locksAtClockSec: 0,
    state: "scheduled",
    resolution: {
      mode: "first_matching_event",
      eventType: "odds_shift",
    },
  },
];

export function createInitialRoomSnapshot(matchId = DEFAULT_MATCH_ID): RoomSnapshot {
  return {
    roomId: matchId,
    roomLabel: "Carregando sala VIRA",
    roomPopulation: 0,
    match: { ...replayMatch, id: matchId },
    connectionState: "connecting",
    currentRound: null,
    participants: [],
    answers: {},
    leaderboard: [],
    timeline: [],
    marketDistribution: {},
    roomDistribution: {},
    version: 0,
    lastSequence: 0,
    latestEvidence: null,
    evidenceHistory: [],
  };
}

export function createInitialReplayState(matchId = DEFAULT_MATCH_ID): ReplayState {
  return {
    matchId,
    status: "paused",
    speed: 1,
    currentStepIndex: 0,
    elapsedMs: 0,
    snapshot: createInitialRoomSnapshot(matchId),
    selectedOptionId: null,
    currentAnswerState: "not_answered",
    currentUiState: "prediction_open",
    currentRoundOpenedAtMs: 0,
    lastResolution: null,
  };
}
