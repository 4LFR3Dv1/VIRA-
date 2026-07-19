import type { FixtureConsumerProjection } from "../../runtime/api.ts";
import type { HomeFixture, HomeProjection, TournamentJourneyFixture } from "../../social/share.ts";
import type { ViraPicksCardV1 } from "../picks/contracts.ts";

export type HomeNarrativeFixture = {
  fixtureId: string;
  projection: FixtureConsumerProjection;
  homeFixture: HomeFixture | null;
  journeyFixture: TournamentJourneyFixture | null;
};

export type HomeFixturePresentationState =
  | "live"
  | "paused"
  | "upcoming"
  | "awaiting_official_state"
  | "finished"
  | "postponed"
  | "cancelled"
  | "unknown";

const ACTIVE = new Set(["live", "paused"]);
const EXCEPTIONAL = new Set(["postponed", "cancelled", "unknown"]);

function kickoff(value: HomeNarrativeFixture) {
  return Date.parse(value.projection.fixture.kickoffAt ?? "") || Number.POSITIVE_INFINITY;
}

function stageWeight(value: HomeNarrativeFixture) {
  if (value.journeyFixture?.stage === "final") return 3;
  if (value.journeyFixture?.stage === "third_place") return 2;
  if (value.journeyFixture?.stage === "semi_final") return 1;
  return 0;
}

export function deriveHomeFixturePresentationState(input: {
  status: string;
  kickoffAt: string | null;
  officialResultAvailable?: boolean;
  nowMs: number;
}): HomeFixturePresentationState {
  if (input.officialResultAvailable) return "finished";
  if (input.status === "live") return "live";
  if (input.status === "paused") return "paused";
  if (input.status === "finished") return "finished";
  if (input.status === "postponed") return "postponed";
  if (input.status === "cancelled") return "cancelled";
  if (input.status !== "scheduled") return "unknown";
  const kickoffMs = Date.parse(input.kickoffAt ?? "");
  return Number.isFinite(kickoffMs) && kickoffMs > input.nowMs ? "upcoming" : "awaiting_official_state";
}

export function presentationStateForNarrative(value: HomeNarrativeFixture, nowMs: number) {
  return deriveHomeFixturePresentationState({
    status: value.projection.fixture.status,
    kickoffAt: value.projection.fixture.kickoffAt,
    officialResultAvailable: value.journeyFixture?.result?.authority === "txline_terminal_history",
    nowMs,
  });
}

function rank(value: HomeNarrativeFixture, tournamentComplete: boolean, nowMs: number) {
  const status = value.projection.fixture.status;
  if (tournamentComplete && value.journeyFixture?.stage === "final") return 1_000;
  if (ACTIVE.has(status)) return 900;
  if (status === "scheduled" && presentationStateForNarrative(value, nowMs) === "upcoming") return 800;
  if (status === "scheduled") return 750;
  if (EXCEPTIONAL.has(status)) return 700 + stageWeight(value);
  if (status === "finished") return 600 + stageWeight(value);
  return 0;
}

export function selectHomeNarrativeFixture(home: HomeProjection, nowMs = Date.now()): HomeNarrativeFixture | null {
  const byId = new Map<string, HomeNarrativeFixture>();
  for (const item of home.journey?.fixtures ?? []) {
    if (!item.fixture) continue;
    byId.set(item.fixtureId, { fixtureId: item.fixtureId, projection: item.fixture, homeFixture: null, journeyFixture: item });
  }
  const featured = home.editorial.fixture;
  if (featured) {
    const existing = byId.get(featured.fixtureId);
    byId.set(featured.fixtureId, { fixtureId: featured.fixtureId, projection: featured.consumerProjection, homeFixture: featured, journeyFixture: existing?.journeyFixture ?? null });
  }
  const complete = home.journey?.status === "complete";
  if (complete) {
    const final = [...byId.values()].find((item) => item.journeyFixture?.stage === "final" && item.journeyFixture.result?.authority === "txline_terminal_history");
    if (final) return final;
  }
  if (featured) return byId.get(featured.fixtureId) ?? null;
  return [...byId.values()].sort((left, right) => {
    const tier = rank(right, complete, nowMs) - rank(left, complete, nowMs);
    if (tier) return tier;
    const status = left.projection.fixture.status;
    if (status === "scheduled") return kickoff(left) - kickoff(right);
    if (status === "finished") return kickoff(right) - kickoff(left);
    return stageWeight(right) - stageWeight(left) || left.fixtureId.localeCompare(right.fixtureId);
  })[0] ?? null;
}

export function selectedTeamFromPicks(card: ViraPicksCardV1 | null, fixture: HomeNarrativeFixture | null) {
  const result = card?.selections.find((selection) => selection.kind === "match_result");
  if (!result || result.kind !== "match_result" || !fixture) return null;
  if (result.selection === "home") return fixture.projection.fixture.homeTeam.name;
  if (result.selection === "away") return fixture.projection.fixture.awayTeam.name;
  return null;
}

export function countdownParts(kickoffAt: string | null, nowMs: number) {
  const remaining = Math.max(0, Date.parse(kickoffAt ?? "") - nowMs);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const totalSeconds = Math.floor(remaining / 1_000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
  };
}

export function deriveExperienceMode(input: { status: string; publicRoomAvailable: boolean; playbackAvailable: boolean | null }) {
  if (["live", "paused"].includes(input.status) && input.publicRoomAvailable) return "live_room" as const;
  if (input.playbackAvailable === null) return "loading" as const;
  if (input.playbackAvailable) return "guided_playback" as const;
  return "match_catalog" as const;
}
