import { cloneFrozen } from "./vira-picks-contracts.mjs";

function score(input) {
  const home = Number(input?.homeScore); const away = Number(input?.awayScore);
  if (!Number.isInteger(home) || home < 0 || !Number.isInteger(away) || away < 0) throw new Error("invalid_regular_time_score");
  return { home, away };
}
export function resolveMatchResultV1(input) { const { home, away } = score(input); return home > away ? "home" : home < away ? "away" : "draw"; }
export function resolveTotalGoalsV1(input) { const { home, away } = score(input); return home + away >= 3 ? "over" : "under"; }
export function resolveBothTeamsScoreV1(input) { const { home, away } = score(input); return home >= 1 && away >= 1 ? "yes" : "no"; }
export function resolveSelectionV1(selection, input) {
  const resolved = selection.kind === "match_result" ? resolveMatchResultV1(input) : selection.kind === "total_goals" ? resolveTotalGoalsV1(input) : selection.kind === "both_teams_score" ? resolveBothTeamsScoreV1(input) : null;
  if (!resolved) throw new Error("unsupported_pick_resolver");
  return cloneFrozen({ selection, resolvedSelection: resolved, status: selection.selection === resolved ? "correct" : "missed" });
}
