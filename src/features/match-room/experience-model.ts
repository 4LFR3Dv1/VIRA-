import type { PresentationEvent, ReplayState, RoomVerification } from "../../domain/types";
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

function marketLabel(title?: string) {
  if (!title) return "Mercado";
  const index = title.toLowerCase().indexOf(" ultrapassa");
  return index > 0 ? title.slice(0, index) : "Mercado";
}

export function createExperienceModel(state: ReplayState, event: PresentationEvent | null, verification: RoomVerification | null): ViraExperienceModel {
  const snapshot = state.snapshot;
  const round = snapshot.currentRound;
  const predicate = round?.resolution.predicate ?? {};
  const openingValue = typeof predicate.openingValue === "number" ? predicate.openingValue : null;
  const targetValue = typeof predicate.pctGte === "number" ? predicate.pctGte : null;
  const eventValue = event?.kind === "txline_update" ? event.currentValue : null;
  const currentValue = eventValue ?? (typeof snapshot.marketDistribution.yes === "number" ? snapshot.marketDistribution.yes : openingValue);
  const baseScene = deriveRoomExperience(state);
  const verified = Boolean(verification?.hashChainValid && verification.projectionMatches && verification.rankingMatches);
  const scene: ExperienceScene = verified && snapshot.match.status === "finished"
    ? "verified_final"
    : event?.kind === "round_resolved" || state.currentUiState === "resolved_success" || state.currentUiState === "resolved_failure"
      ? "round_resolved"
      : event?.kind === "txline_update" && Boolean(round)
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
    market: openingValue !== null || currentValue !== null || targetValue !== null ? {
      label: marketLabel(round?.title),
      openingValue,
      currentValue,
      targetValue,
      direction: openingValue === null || currentValue === null ? null : currentValue > openingValue ? "up" : currentValue < openingValue ? "down" : "unchanged",
    } : null,
    round: round ? {
      id: round.id,
      number: round.sequence,
      question: round.title,
      status: round.state,
      options: round.options.map((option) => ({
        id: option.id,
        shortLabel: option.shortLabel ?? option.label,
        label: option.id === "yes" ? "Sim, ultrapassa" : option.id === "no" ? "Nao, fica abaixo" : option.label,
        explanation: option.id === "yes" ? "O valor cruza o alvo no proximo sinal." : "O valor permanece abaixo do alvo.",
      })),
    } : null,
    leaderboard: snapshot.leaderboard,
    journey: resolvedEvidence.map((item, index) => ({ id: item.id, number: index + 1, correct: Boolean(item.resolution?.answersCorrect), points: item.resolution?.totalPointsApplied ?? 0 })),
    verification: { status: verified ? "verified" : verification ? "failed" : "pending" },
  };
}
