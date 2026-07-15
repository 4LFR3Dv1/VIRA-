import type { MatchSummary } from "../../runtime/api";

function kickoff(match: MatchSummary) {
  const value = Date.parse(match.consumerProjection?.fixture.kickoffAt ?? "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function selectSuggestedMatch(matches: MatchSummary[]) {
  const featureable = matches.filter((match) => match.consumerProjection?.availability.canFeature);
  return [...(featureable.length ? featureable : matches)].sort((left, right) => {
    const leftProjection = left.consumerProjection;
    const rightProjection = right.consumerProjection;
    const active = Number(["live", "paused"].includes(rightProjection?.fixture.status ?? "")) - Number(["live", "paused"].includes(leftProjection?.fixture.status ?? ""));
    if (active) return active;
    const prediction = Number(rightProjection?.availability.canPredict === true) - Number(leftProjection?.availability.canPredict === true);
    if (prediction) return prediction;
    const worldCup = Number(rightProjection?.fixture.competition.kind === "world_cup") - Number(leftProjection?.fixture.competition.kind === "world_cup");
    if (worldCup) return worldCup;
    return kickoff(left) - kickoff(right) || left.fixtureId.localeCompare(right.fixtureId);
  })[0] ?? null;
}

export function selectCatalogMatch(matches: MatchSummary[], currentId: string | null, featuredFixtureId: string | null, manuallySelectedId: string | null) {
  const current = matches.find((match) => match.fixtureId === currentId);
  if (current && manuallySelectedId === currentId) return currentId;
  if (current && current.consumerProjection?.fixture.status !== "finished") return currentId;
  return matches.find((match) => match.fixtureId === featuredFixtureId)?.fixtureId ?? selectSuggestedMatch(matches)?.fixtureId ?? null;
}
