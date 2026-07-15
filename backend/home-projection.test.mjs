import assert from "node:assert/strict";
import test from "node:test";
import { deriveHomeProjection } from "./home-projection.mjs";

const now = new Date("2026-07-12T12:00:00.000Z");
const market = (observedAt = "2026-07-12T11:59:00.000Z") => ({ authority: "txline_fixture_market", selections: { home: 48, draw: 27, away: 25 }, observedAt, snapshotId: "odds-1", providerSequence: 1, marketSignature: "fixture|1x2" });
const fixture = (overrides = {}) => ({ fixtureId: "fx-1", competitionLabel: "Copa do Mundo", competition: { kind: "world_cup" }, homeTeam: "England", awayTeam: "Argentina", startTime: "2026-07-12T14:00:00.000Z", status: "scheduled", context: { generatedAt: "2026-07-12T11:59:00.000Z", canonical1X2: market() }, ...overrides });

test("publishes a fresh fixture market with explicit authority", () => {
  const projection = deriveHomeProjection({ catalog: { generatedAt: now.toISOString(), matches: [fixture()] }, now });
  assert.equal(projection.editorial.kind, "predict_fixture");
  assert.equal(projection.editorial.authority, "txline_fixture_market");
  assert.equal(projection.editorial.fixture.market.type, "MATCH_RESULT_1X2");
  assert.equal(projection.editorial.fixture.consumerProjection.fixture.fixtureId, "fx-1");
  assert.deepEqual(projection.editorial.fixture.consumerProjection.market.canonical1X2.selections, projection.editorial.fixture.market.selections);
  assert.equal(projection.editorial.fixture.consumerProjection.temporal.relation, projection.editorial.fixture.temporal.relation);
  assert.equal(projection.tournament.outrightMarket, null);
});

test("keeps an older confirmed pre-match market usable without making a current directional claim", () => {
  const stable = fixture({ context: { generatedAt: "2026-07-12T10:00:00.000Z", canonical1X2: market("2026-07-12T10:00:00.000Z") } });
  const projection = deriveHomeProjection({ catalog: { matches: [stable] }, now });
  assert.equal(projection.editorial.kind, "predict_fixture");
  assert.equal(projection.editorial.fixture.market.freshness.usableForPrediction, true);
  assert.equal(projection.editorial.fixture.market.freshness.currentForDisplay, true);
  assert.equal(projection.editorial.fixture.market.freshness.currentForDirectionalClaim, false);
  assert.equal(projection.editorial.fixture.market.freshness.staleAfter, stable.startTime);
});

test("stops market authority on explicit context loss", () => {
  const unavailable = fixture({ availability: { contextStatus: "unavailable" } });
  const projection = deriveHomeProjection({ catalog: { matches: [unavailable] }, now });
  assert.equal(projection.editorial.kind, "open_calendar");
  assert.equal(projection.editorial.fixture.market.freshness.usableForPrediction, false);
});

test("a fixture outside the promotion window cannot win through competition weight", () => {
  const projection = deriveHomeProjection({ catalog: { matches: [fixture({ startTime: "2026-07-20T14:00:00.000Z" })] }, now });
  assert.equal(projection.editorial.kind, "open_calendar");
});

test("open calendar still points at the next World Cup fixture outside the prediction window", () => {
  const friendly = fixture({ fixtureId: "friendly", competition: { kind: "friendly" }, startTime: "2026-07-18T12:00:00.000Z" });
  const worldCup = fixture({ fixtureId: "third-place", startTime: "2026-07-18T21:00:00.000Z" });
  const projection = deriveHomeProjection({ catalog: { matches: [friendly, worldCup] }, now });

  assert.equal(projection.editorial.kind, "open_calendar");
  assert.equal(projection.editorial.fixture.fixtureId, "third-place");
  assert.equal(projection.editorial.fixture.consumerProjection.availability.canFeature, true);
  assert.equal(projection.editorial.fixture.consumerProjection.availability.canPredict, false);
});

test("home projection freezes evaluation time and uses civil temporal copy", () => {
  const projection = deriveHomeProjection({ catalog: { matches: [fixture({ startTime: "2026-07-14T10:00:00.000Z" })] }, now, localeContext: { locale: "pt-BR", timeZone: "America/Sao_Paulo", source: "viewer" } });
  assert.equal(projection.version, 2);
  assert.equal(projection.editorial.fixture.temporal.evaluatedAt, now.toISOString());
  assert.equal(projection.editorial.fixture.temporal.relation, "later_this_week");
  assert.equal(projection.editorial.copy.headline, "Quem vence England x Argentina?");
});

test("home refuses to reinterpret raw markets without canonical projection", () => {
  const rawOnly = fixture({ context: { availableMarkets: [{ marketType: "1X2_PARTICIPANT_RESULT" }] } });
  const projection = deriveHomeProjection({ catalog: { matches: [rawOnly] }, now });
  assert.equal(projection.editorial.kind, "open_calendar");
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
