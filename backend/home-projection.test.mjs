import assert from "node:assert/strict";
import test from "node:test";
import { deriveHomeProjection } from "./home-projection.mjs";

const now = new Date("2026-07-12T12:00:00.000Z");
const fixture = (overrides = {}) => ({ fixtureId: "fx-1", competitionLabel: "World Cup", homeTeam: "England", awayTeam: "Argentina", startTime: "2026-07-12T14:00:00.000Z", status: "scheduled", context: { generatedAt: "2026-07-12T11:59:00.000Z", endpoints: { odds: { data: { winProbability: { home: 48, draw: 27, away: 25, capturedAt: "2026-07-12T11:59:00.000Z", messageId: "odds-1" } } } } }, ...overrides });

test("publishes a fresh fixture market with explicit authority", () => {
  const projection = deriveHomeProjection({ catalog: { generatedAt: now.toISOString(), matches: [fixture()] }, now });
  assert.equal(projection.editorial.kind, "predict_fixture");
  assert.equal(projection.editorial.authority, "txline_fixture_market");
  assert.equal(projection.editorial.fixture.market.type, "MATCH_RESULT_1X2");
  assert.equal(projection.tournament.outrightMarket, null);
});

test("never publishes stale fixture market copy", () => {
  const stale = fixture({ context: { generatedAt: "2026-07-12T10:00:00.000Z", endpoints: { odds: { data: { winProbability: { home: 48, draw: 27, away: 25, capturedAt: "2026-07-12T10:00:00.000Z" } } } } } });
  const projection = deriveHomeProjection({ catalog: { matches: [stale] }, now });
  assert.equal(projection.editorial.kind, "open_calendar");
  assert.equal(projection.editorial.fixture.market.freshness.fresh, false);
});

test("live match outranks a scheduled prediction", () => {
  const live = fixture({ fixtureId: "live", status: "live", startTime: "2026-07-12T11:00:00.000Z" });
  const projection = deriveHomeProjection({ catalog: { matches: [fixture(), live] }, now });
  assert.equal(projection.editorial.kind, "join_live_room");
  assert.equal(projection.editorial.fixture.fixtureId, "live");
});

test("resolved personal result becomes the primary return action", () => {
  const projection = deriveHomeProjection({ catalog: { matches: [fixture({ status: "finished" })] }, predictions: { "fx-1": { status: "resolved", correct: true, choice: "home" } }, player: { publicId: "p1", displayName: "Ana", points: 100, streak: 1 }, now });
  assert.equal(projection.editorial.kind, "result_available");
  assert.equal(projection.editorial.prediction.correct, true);
});
