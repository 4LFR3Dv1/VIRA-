import type { FixtureConsumerProjection } from "../../runtime/api.ts";
import type { HomeProjection, TournamentJourneyFixture } from "../../social/share.ts";
import { deriveHomeFixturePresentationState, selectHomeNarrativeFixture } from "../../features/home/home-narrative.ts";
import type { ActiveRoomPresenceState, OfficialReviewAvailability, ShellConnectionPresentation } from "./shell-experience.ts";

export type MatchdayPulseKind = "round_open" | "live" | "upcoming" | "final" | "exceptional" | "tournament" | "captured_playback";

export type MatchdayPulseV1 = {
  kind: MatchdayPulseKind;
  fixtureId: string | null;
  destination: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  homeScore: number | null;
  awayScore: number | null;
  matchClockSec: number | null;
  roomPopulation: number | null;
  kickoffAt: string | null;
  fixtureStatus: string | null;
  stage: "semi_final" | "third_place" | "final" | null;
  roundOpenedAt: string | null;
  roundLocksAt: string | null;
  providerObservedAt: string | null;
  providerUpdatedAt: string | null;
  providerState: "live" | "updated" | "captured" | "unavailable";
  verified: boolean;
  champion: string | null;
};

type Candidate = { fixtureId: string; fixture: FixtureConsumerProjection; result: TournamentJourneyFixture["result"]; stage: TournamentJourneyFixture["stage"] | null };

function fixtureIdFromPath(pathname: string) {
  return pathname.match(/^\/(?:picks|match)\/([^/]+)/)?.[1] ?? null;
}

function routeCandidate(home: HomeProjection | null, pathname: string, nowMs: number): Candidate | null {
  if (!home) return null;
  const requestedId = fixtureIdFromPath(pathname);
  const journey = requestedId ? home.journey?.fixtures.find((item) => item.fixtureId === requestedId) : null;
  if (journey?.fixture) return { fixtureId: journey.fixtureId, fixture: journey.fixture, result: journey.result, stage: journey.stage };
  const editorial = home.editorial.fixture;
  if (requestedId && editorial?.fixtureId === requestedId) return { fixtureId: requestedId, fixture: editorial.consumerProjection, result: null, stage: null };
  const narrative = selectHomeNarrativeFixture(home, nowMs);
  return narrative ? { fixtureId: narrative.fixtureId, fixture: narrative.projection, result: narrative.journeyFixture?.result ?? null, stage: narrative.journeyFixture?.stage ?? null } : null;
}

function providerObservedAt(candidate: Candidate) {
  return candidate.fixture.market.canonical1X2?.receivedAt ?? candidate.fixture.market.canonical1X2?.observedAt ?? candidate.result?.receivedAt ?? candidate.fixture.generatedAt ?? null;
}

export function deriveMatchdayPulseV1(input: {
  routeId: string;
  pathname: string;
  home: HomeProjection | null;
  homeAvailable: boolean;
  matchdayUpdatedAt: string | null;
  activeRoom: ActiveRoomPresenceState;
  review: OfficialReviewAvailability;
  connection: ShellConnectionPresentation;
  nowMs: number;
}): MatchdayPulseV1 {
  const room = input.activeRoom.kind === "confirmed" ? input.activeRoom.room : null;
  if (room?.phase === "action_required" && room.roundLocksAt) return {
    kind: "round_open", fixtureId: room.fixtureId, destination: `/match/${room.roomId}`, homeTeam: room.homeTeam, awayTeam: room.awayTeam,
    homeScore: room.homeScore, awayScore: room.awayScore, matchClockSec: room.matchClockSec, roomPopulation: room.roomPopulation, kickoffAt: null,
    fixtureStatus: room.matchStatus, stage: null, roundOpenedAt: room.roundOpenedAt, roundLocksAt: room.roundLocksAt, providerObservedAt: room.updatedAt,
    providerUpdatedAt: room.updatedAt, providerState: input.connection.kind === "healthy" ? "live" : "unavailable", verified: false, champion: null,
  };
  if (input.routeId === "judge-playback") return {
    kind: "captured_playback", fixtureId: "judge-playback-france-spain-v2", destination: "/match/judge-playback-france-spain-v2", homeTeam: "France", awayTeam: "Spain",
    homeScore: null, awayScore: null, matchClockSec: null, roomPopulation: null, kickoffAt: null, fixtureStatus: "finished", stage: null,
    roundOpenedAt: null, roundLocksAt: null, providerObservedAt: null, providerUpdatedAt: null, providerState: "captured", verified: true, champion: null,
  };
  if (room && input.routeId === "match-room") return {
    kind: room.matchStatus === "finished" ? "final" : room.matchStatus === "live" || room.matchStatus === "paused" ? "live" : room.matchStatus === "scheduled" ? "upcoming" : "exceptional",
    fixtureId: room.fixtureId, destination: `/match/${room.roomId}`, homeTeam: room.homeTeam, awayTeam: room.awayTeam, homeScore: room.homeScore, awayScore: room.awayScore,
    matchClockSec: room.matchClockSec, roomPopulation: room.roomPopulation, kickoffAt: null, fixtureStatus: room.matchStatus, stage: null, roundOpenedAt: null, roundLocksAt: null,
    providerObservedAt: room.updatedAt, providerUpdatedAt: room.updatedAt, providerState: input.connection.kind === "healthy" ? "live" : "unavailable", verified: room.matchStatus === "finished" && input.review.kind === "available", champion: null,
  };
  const candidate = routeCandidate(input.home, input.pathname, input.nowMs);
  if (candidate) {
    const status = candidate.fixture.fixture.status;
    const presentation = deriveHomeFixturePresentationState({ status, kickoffAt: candidate.fixture.fixture.kickoffAt, officialResultAvailable: candidate.result?.authority === "txline_terminal_history", nowMs: input.nowMs });
    return {
      kind: presentation === "live" || presentation === "paused" ? "live" : presentation === "upcoming" ? "upcoming" : presentation === "finished" ? "final" : "exceptional",
      fixtureId: candidate.fixtureId, destination: status === "live" || status === "paused" ? `/match/${candidate.fixtureId}` : `/match/${candidate.fixtureId}/preview`,
      homeTeam: candidate.fixture.fixture.homeTeam.name, awayTeam: candidate.fixture.fixture.awayTeam.name,
      homeScore: candidate.result?.homeScore ?? null, awayScore: candidate.result?.awayScore ?? null, matchClockSec: null, roomPopulation: null,
      kickoffAt: candidate.fixture.fixture.kickoffAt, fixtureStatus: status, stage: candidate.stage, roundOpenedAt: null, roundLocksAt: null,
      providerObservedAt: providerObservedAt(candidate), providerUpdatedAt: input.matchdayUpdatedAt, providerState: input.homeAvailable ? "updated" : "unavailable", verified: candidate.result?.authority === "txline_terminal_history",
      champion: input.home?.journey?.champion?.name ?? null,
    };
  }
  return {
    kind: "tournament", fixtureId: null, destination: "/", homeTeam: null, awayTeam: null, homeScore: null, awayScore: null, matchClockSec: null, roomPopulation: null,
    kickoffAt: null, fixtureStatus: null, stage: null, roundOpenedAt: null, roundLocksAt: null, providerObservedAt: null,
    providerUpdatedAt: input.matchdayUpdatedAt, providerState: input.homeAvailable ? "updated" : "unavailable", verified: false, champion: input.home?.journey?.champion?.name ?? null,
  };
}

export function roundProgress(pulse: MatchdayPulseV1, nowMs: number) {
  if (pulse.kind !== "round_open" || !pulse.roundOpenedAt || !pulse.roundLocksAt) return null;
  const opened = Date.parse(pulse.roundOpenedAt); const locks = Date.parse(pulse.roundLocksAt);
  if (!Number.isFinite(opened) || !Number.isFinite(locks) || locks <= opened) return null;
  return Math.max(0, Math.min(1, (locks - nowMs) / (locks - opened)));
}
