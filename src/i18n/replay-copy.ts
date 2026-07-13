import type { Match, VerifiedRoundReplayV1 } from "../domain/types.ts";
import type { TranslateFunction } from "./translate.ts";

export function replayQuestion(t: TranslateFunction, replay: VerifiedRoundReplayV1, room: { match: Match } | null): string {
  if (replay.resolutionDomain === "football" && replay.condition && room) {
    const team = replay.condition.targetSide === "away" ? room.match.awayTeam.name : room.match.homeTeam.name;
    const minutes = Math.max(1, Math.round(replay.condition.durationSec / 60));
    return t("round.question.teamScores", { team, minutes });
  }
  return t("review.roundQuestion");
}

export function replayResolutionLabel(t: TranslateFunction, replay: VerifiedRoundReplayV1, formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string): string {
  if (replay.resolutionDomain === "football") {
    return t("review.scoreAtMinute", {
      home: replay.resolution.score?.home ?? 0,
      away: replay.resolution.score?.away ?? 0,
      minute: Math.floor((replay.resolution.matchClockSec ?? 0) / 60),
    });
  }
  return t("review.marketValue", { value: replay.resolution.observedValue === null ? "--" : formatPercent(replay.resolution.observedValue, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
}
