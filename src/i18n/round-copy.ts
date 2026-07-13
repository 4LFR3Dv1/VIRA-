import type { Match, PredictionOption, PredictionRound, RoundResolutionResult } from "../domain/types.ts";
import type { TranslateFunction } from "./translate.ts";

function targetTeam(round: PredictionRound, match: Match) {
  return round.resolution.condition?.targetSide === "away" ? match.awayTeam.name : match.homeTeam.name;
}

function durationMinutes(round: PredictionRound) {
  return Math.max(1, Math.round((round.resolution.condition?.durationSec ?? 600) / 60));
}

export function roundQuestion(t: TranslateFunction, round: PredictionRound, match: Match): string {
  const condition = round.resolution.domain === "football" ? round.resolution.condition : null;
  if (condition?.kind === "team_scores") return t("round.question.teamScores", { team: targetTeam(round, match), minutes: durationMinutes(round) });
  if (condition?.kind === "team_shot_on_target") return t("round.question.teamShotOnTarget", { team: targetTeam(round, match), minutes: durationMinutes(round) });
  return t("round.question.marketTarget");
}

export function stableOptionLabel(t: TranslateFunction, optionId: string | null | undefined): string {
  if (optionId === "yes") return t("round.option.yes");
  if (optionId === "no") return t("round.option.no");
  return "--";
}

export function roundOptionCopy(t: TranslateFunction, round: PredictionRound, option: PredictionOption) {
  const condition = round.resolution.domain === "football" ? round.resolution.condition : null;
  if (option.id !== "yes" && option.id !== "no") return { shortLabel: "--", label: t("common.unavailable"), explanation: t("common.unavailable") };
  const yes = option.id === "yes";
  if (condition?.kind === "team_scores") return {
    shortLabel: stableOptionLabel(t, option.id),
    label: t(yes ? "round.option.yesScores" : "round.option.noScores"),
    explanation: t(yes ? "round.explanation.yesScores" : "round.explanation.noScores"),
  };
  if (condition?.kind === "team_shot_on_target") return {
    shortLabel: stableOptionLabel(t, option.id),
    label: t(yes ? "round.option.yesShot" : "round.option.noShot"),
    explanation: t(yes ? "round.explanation.yesShot" : "round.explanation.noShot"),
  };
  return {
    shortLabel: stableOptionLabel(t, option.id),
    label: t(yes ? "round.option.yesMarket" : "round.option.noMarket"),
    explanation: t(yes ? "round.explanation.yesMarket" : "round.explanation.noMarket"),
  };
}

export function resolutionReasonLabel(t: TranslateFunction, result: Pick<RoundResolutionResult, "resolutionReason" | "condition">): string {
  if (result.resolutionReason === "window_expired") return t("result.windowExpired");
  if (result.resolutionReason === "match_finished") return t("result.matchFinished");
  return result.condition?.kind === "team_shot_on_target" ? t("result.shotConfirmed") : t("result.goalConfirmed");
}
