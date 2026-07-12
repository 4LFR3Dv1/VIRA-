import type { ReplayState } from "../../domain/types";
import { deriveCanonicalExperienceState } from "../match-experience/state-model";

export type MatchExperienceState =
  | "no_live_fixture"
  | "scheduled_without_market"
  | "scheduled_with_market"
  | "live_waiting_for_market"
  | "live_waiting_for_round"
  | "round_open"
  | "answer_locked"
  | "resolving"
  | "finished"
  | "provider_unavailable";

function hasMarketSignal(state: ReplayState) {
  if (state.snapshot.currentRound?.resolution.domain === "football") return true;
  const distributionHasValue = Object.values(state.snapshot.marketDistribution).some((value) => Number.isFinite(value) && value > 0);
  const predicate = state.snapshot.currentRound?.resolution.predicate;
  return distributionHasValue
    || typeof predicate?.openingValue === "number"
    || typeof predicate?.pctGte === "number"
    || state.snapshot.lastNormalizedEvent?.type === "odds_shift"
    || state.snapshot.latestEvidence?.normalization.type === "odds_shift";
}

export function deriveRoomExperience(state: ReplayState): MatchExperienceState {
  const { snapshot } = state;
  const hasMarket = hasMarketSignal(state);
  const canonical = deriveCanonicalExperienceState({ matchStatus: snapshot.match.status, roomExists: true, roundState: snapshot.currentRound?.state, answerState: state.currentAnswerState, hasResolution: Boolean(state.lastResolution), hasSignal: hasMarket, signalReceived: snapshot.lastNormalizedEvent?.type === "odds_shift", connectionState: snapshot.connectionState });
  if (canonical.connection !== "healthy") return "provider_unavailable";
  if (canonical.match === "finished") return "finished";
  if (canonical.match === "scheduled") return hasMarket ? "scheduled_with_market" : "scheduled_without_market";
  if (canonical.match === "unavailable") return "no_live_fixture";
  if (canonical.signal === "unavailable") return "live_waiting_for_market";
  if (canonical.round === "preparing" || canonical.round === "none") return "live_waiting_for_round";
  if (state.currentUiState === "awaiting_resolution") return "resolving";
  if (canonical.round === "locked") return "answer_locked";
  return canonical.round === "open" ? "round_open" : "live_waiting_for_round";
}
