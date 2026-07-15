import type { PresentationEvent, ReplayState, RoomVerification } from "../../domain/types";
import { roundOptionCopy, roundQuestion } from "../../i18n/round-copy.ts";
import type { TranslateFunction } from "../../i18n/translate.ts";
import { deriveRoomExperience, type MatchExperienceState } from "./derive-room-experience";

export type ExperienceScene = MatchExperienceState | "signal_received" | "round_resolved" | "verified_final";

export interface ViraExperienceModel {
  scene: ExperienceScene;
  competition: { name: string; stageLabel: string };
  fixture: { id: string; status: string; kickoffAt: string | null; clockSec: number };
  teams: {
    home: { id: string; name: string; shortName: string; score: number; accent: string };
    away: { id: string; name: string; shortName: string; score: number; accent: string };
  };
  room: { participantCount: number; connected: boolean };
  market: null | {
    label: string;
    openingValue: number | null;
    currentValue: number | null;
    targetValue: number | null;
    direction: "up" | "down" | "unchanged" | null;
  };
  round: null | {
    id: string;
    number: number;
    question: string;
    status: string;
    options: Array<{ id: string; shortLabel: string; label: string; explanation: string }>;
  };
  leaderboard: ReplayState["snapshot"]["leaderboard"];
  journey: Array<{ id: string; number: number; correct: boolean; points: number }>;
  verification: { status: "pending" | "verified" | "failed" };
}

export function createExperienceModel(state: ReplayState, event: PresentationEvent | null, verification: RoomVerification | null, t: TranslateFunction): ViraExperienceModel {
  const snapshot = state.snapshot;
  const round = snapshot.currentRound;
  const predicate = round?.resolution.predicate ?? {};
  const football = round?.resolution.domain === "football" ? round.resolution.condition : null;
  const openingValue = typeof predicate.openingValue === "number" ? predicate.openingValue : null;
  const targetValue = typeof predicate.pctGte === "number" ? predicate.pctGte : null;
  const eventValue = event?.kind === "round_resolved" ? event.resolutionValue : null;
  const currentValue = eventValue ?? openingValue;
  const baseScene = deriveRoomExperience(state);
  const nonCompetitiveScene = baseScene === "connecting" || baseScene === "scheduled_without_market" || baseScene === "scheduled_with_market" || baseScene === "no_live_fixture" || baseScene === "provider_unavailable";
  const verified = Boolean(verification?.hashChainValid && verification.projectionMatches && verification.rankingMatches);
  const scene: ExperienceScene = nonCompetitiveScene
    ? baseScene
    : verified && snapshot.match.status === "finished"
    ? "verified_final"
    : event?.kind === "round_resolved"
      ? "round_resolved"
      : event?.kind === "txline_update" && Boolean(round) && round?.resolution.domain !== "football"
        ? "signal_received"
        : baseScene;
  const resolvedEvidence = snapshot.evidenceHistory.filter((item) => item.status === "resolved" && item.resolution);

  return {
    scene,
    competition: { name: snapshot.match.competitionLabel, stageLabel: snapshot.match.competitionLabel },
    fixture: { id: snapshot.match.id, status: snapshot.match.status, kickoffAt: snapshot.match.startTime ?? null, clockSec: snapshot.match.matchClockSec },
    teams: {
      home: { ...snapshot.match.homeTeam, score: snapshot.match.homeScore },
      away: { ...snapshot.match.awayTeam, score: snapshot.match.awayScore },
    },
    room: { participantCount: snapshot.roomPopulation, connected: snapshot.connectionState === "live" },
    market: !football && (openingValue !== null || currentValue !== null || targetValue !== null) ? {
      label: t("round.monitoredMarket"),
      openingValue,
      currentValue,
      targetValue,
      direction: openingValue === null || currentValue === null ? null : currentValue > openingValue ? "up" : currentValue < openingValue ? "down" : "unchanged",
    } : null,
    round: round ? {
      id: round.id,
      number: round.sequence,
      question: roundQuestion(t, round, snapshot.match),
      status: round.state,
      options: round.options.map((option) => ({ id: option.id, ...roundOptionCopy(t, round, option) })),
    } : null,
    leaderboard: snapshot.leaderboard,
    journey: resolvedEvidence.map((item, index) => ({ id: item.id, number: index + 1, correct: Boolean(item.resolution?.answersCorrect), points: item.resolution?.totalPointsApplied ?? 0 })),
    verification: { status: verified ? "verified" : verification ? "failed" : "pending" },
  };
}
