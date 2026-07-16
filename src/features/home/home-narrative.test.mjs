import assert from "node:assert/strict";
import test from "node:test";
import { countdownParts, deriveExperienceMode, selectHomeNarrativeFixture, selectedTeamFromPicks } from "./home-narrative.ts";

function projection(fixtureId, status, kickoffAt, home = "France", away = "Spain") { return { fixture: { fixtureId, status, kickoffAt, homeTeam: { name: home }, awayTeam: { name: away } } }; }
function journeyFixture(fixtureId, stage, status, kickoffAt) { return { fixtureId, stage, slot: 1, fixture: projection(fixtureId, status, kickoffAt) }; }
function home({ journey, editorialFixture = null }) { return { journey, editorial: { fixture: editorialFixture } }; }

test("World Cup Now prioritizes active play, then the nearest scheduled fixture", () => {
  const scheduled = journeyFixture("final", "final", "scheduled", "2026-07-19T19:00:00.000Z");
  const live = journeyFixture("third", "third_place", "live", "2026-07-18T21:00:00.000Z");
  assert.equal(selectHomeNarrativeFixture(home({ journey: { status: "active", fixtures: [scheduled, live] } })).fixtureId, "third");
  live.fixture.fixture.status = "finished";
  assert.equal(selectHomeNarrativeFixture(home({ journey: { status: "active", fixtures: [scheduled, live] } })).fixtureId, "final");
});

test("exceptional states remain distinct and a completed tournament selects the official final", () => {
  const postponed = journeyFixture("final", "final", "postponed", "2026-07-19T19:00:00.000Z");
  assert.equal(selectHomeNarrativeFixture(home({ journey: { status: "active", fixtures: [postponed] } })).projection.fixture.status, "postponed");
  postponed.fixture.fixture.status = "finished";
  const semi = journeyFixture("semi", "semi_final", "finished", "2026-07-14T19:00:00.000Z");
  assert.equal(selectHomeNarrativeFixture(home({ journey: { status: "complete", fixtures: [semi, postponed], champion: { name: "Spain" } } })).fixtureId, "final");
});

test("personal path only derives from an explicit match-result selection", () => {
  const fixture = { projection: projection("final", "scheduled", "2026-07-19T19:00:00.000Z", "Spain", "Argentina") };
  const card = { selections: [{ kind: "match_result", period: "regular_time", selection: "away", resolverVersion: 1 }] };
  assert.equal(selectedTeamFromPicks(card, fixture), "Argentina");
  assert.equal(selectedTeamFromPicks({ selections: [{ kind: "total_goals", period: "regular_time", line: 2.5, selection: "over", resolverVersion: 1 }] }, fixture), null);
});

test("countdown and final experience mode are deterministic", () => {
  assert.deepEqual(countdownParts("2026-07-19T19:00:00.000Z", Date.parse("2026-07-18T17:58:59.000Z")), { days: 1, hours: 1, minutes: 1, seconds: 1 });
  assert.equal(deriveExperienceMode({ status: "live", publicRoomAvailable: true, playbackAvailable: true }), "live_room");
  assert.equal(deriveExperienceMode({ status: "finished", publicRoomAvailable: false, playbackAvailable: true }), "guided_playback");
  assert.equal(deriveExperienceMode({ status: "scheduled", publicRoomAvailable: false, playbackAvailable: false }), "match_catalog");
});
