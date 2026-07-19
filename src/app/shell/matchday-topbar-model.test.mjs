import assert from "node:assert/strict";
import test from "node:test";

import { deriveMatchdayPulseV1, roundProgress } from "./matchday-topbar-model.ts";

const connection = { kind: "healthy" };
const review = { kind: "unavailable" };
const noRoom = { kind: "none" };

function fixture(fixtureId, status, kickoffAt, home = "France", away = "England") {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-16T18:00:00.000Z",
    fixture: {
      fixtureId,
      homeTeam: { providerId: null, name: home, shortName: null },
      awayTeam: { providerId: null, name: away, shortName: null },
      competition: { kind: "world_cup" },
      status,
      kickoffAt,
    },
    temporal: {},
    market: { canonical1X2: { observedAt: "2026-07-16T17:59:00.000Z", receivedAt: "2026-07-16T18:00:00.000Z" }, freshness: {} },
    availability: {},
    editorial: {},
  };
}

function homeWith(item, champion = null) {
  return {
    editorial: { fixture: null },
    journey: { status: champion ? "complete" : "active", champion, fixtures: [item] },
  };
}

function input(overrides = {}) {
  return { routeId: "home", pathname: "/", home: null, homeAvailable: true, matchdayUpdatedAt: "2026-07-16T18:00:10.000Z", nowMs: Date.parse("2026-07-16T18:00:10.000Z"), activeRoom: noRoom, review, connection, ...overrides };
}

test("an open round has priority over every public matchday state", () => {
  const pulse = deriveMatchdayPulseV1(input({
    home: homeWith({ fixtureId: "final", stage: "final", fixture: fixture("final", "scheduled", "2026-07-19T19:00:00.000Z"), result: null }),
    activeRoom: { kind: "confirmed", room: { roomId: "room-live", fixtureId: "live", homeTeam: "Spain", awayTeam: "Argentina", phase: "action_required", matchStatus: "live", homeScore: 1, awayScore: 0, matchClockSec: 4_020, roomPopulation: 8, roundOpenedAt: "2026-07-16T18:00:00.000Z", roundLocksAt: "2026-07-16T18:00:20.000Z", updatedAt: "2026-07-16T18:00:05.000Z" } },
  }));
  assert.equal(pulse.kind, "round_open");
  assert.equal(pulse.destination, "/match/room-live");
  assert.equal(pulse.roundLocksAt, "2026-07-16T18:00:20.000Z");
});

test("the current Match Room reports live score, clock, population and connection authority", () => {
  const pulse = deriveMatchdayPulseV1(input({ routeId: "match-room", pathname: "/match/room-live", activeRoom: { kind: "confirmed", room: { roomId: "room-live", fixtureId: "live", homeTeam: "France", awayTeam: "England", phase: "waiting", matchStatus: "live", homeScore: 1, awayScore: 0, matchClockSec: 4_020, roomPopulation: 12, roundOpenedAt: null, roundLocksAt: null, updatedAt: "2026-07-16T18:00:05.000Z" } } }));
  assert.equal(pulse.kind, "live");
  assert.deepEqual([pulse.homeScore, pulse.awayScore, pulse.matchClockSec, pulse.roomPopulation], [1, 0, 4_020, 12]);
  assert.equal(pulse.providerState, "live");
});

test("public projections keep upcoming, exceptional and verified terminal states distinct", () => {
  const item = { fixtureId: "third", stage: "third_place", fixture: fixture("third", "scheduled", "2026-07-18T21:00:00.000Z"), result: null };
  assert.equal(deriveMatchdayPulseV1(input({ home: homeWith(item) })).kind, "upcoming");
  item.fixture.fixture.status = "postponed";
  assert.equal(deriveMatchdayPulseV1(input({ home: homeWith(item) })).kind, "exceptional");
  item.fixture.fixture.status = "finished";
  item.result = { authority: "txline_terminal_history", homeScore: 2, awayScore: 1, receivedAt: "2026-07-18T23:00:00.000Z" };
  const final = deriveMatchdayPulseV1(input({ home: homeWith(item) }));
  assert.equal(final.kind, "final");
  assert.equal(final.verified, true);
  assert.deepEqual([final.homeScore, final.awayScore], [2, 1]);
});

test("a scheduled fixture whose kickoff passed is awaiting authority, never upcoming", () => {
  const item = { fixtureId: "third", stage: "third_place", fixture: fixture("third", "scheduled", "2026-07-18T21:00:00.000Z"), result: null };
  const pulse = deriveMatchdayPulseV1(input({ home: homeWith(item), nowMs: Date.parse("2026-07-19T04:50:00.000Z") }));
  assert.equal(pulse.kind, "exceptional");
  assert.equal(pulse.fixtureStatus, "scheduled");
  assert.equal(pulse.homeScore, null);
});

test("certified playback is disclosed independently of the official tournament", () => {
  const pulse = deriveMatchdayPulseV1(input({ routeId: "judge-playback", pathname: "/match/judge-playback-france-spain-v2" }));
  assert.equal(pulse.kind, "captured_playback");
  assert.equal(pulse.providerState, "captured");
  assert.equal(pulse.stage, null);
});

test("round rail progress uses the authoritative open and lock boundaries", () => {
  const pulse = { kind: "round_open", roundOpenedAt: "2026-07-16T18:00:00.000Z", roundLocksAt: "2026-07-16T18:00:20.000Z" };
  assert.equal(roundProgress(pulse, Date.parse("2026-07-16T18:00:05.000Z")), 0.75);
  assert.equal(roundProgress(pulse, Date.parse("2026-07-16T18:00:30.000Z")), 0);
});
