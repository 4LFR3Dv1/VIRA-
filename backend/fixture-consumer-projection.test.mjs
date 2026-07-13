import assert from "node:assert/strict";
import test from "node:test";
import { deriveFixtureConsumerProjection, rankFixtureConsumerProjections } from "../shared/fixture-consumer-projection.mjs";

const evaluatedAt = "2026-07-12T12:00:00.000Z";
const localeContext = { locale: "pt-BR", timeZone: "America/Sao_Paulo", source: "viewer" };
const fixture = (overrides = {}) => ({ fixtureId: "fx-1", homeTeam: "Franca", awayTeam: "Espanha", competitionLabel: "Copa do Mundo", competition: { kind: "world_cup", mapped: true, authority: "registry" }, startTime: "2026-07-14T19:00:00.000Z", status: "scheduled", ...overrides });
const context = (overrides = {}) => ({ generatedAt: evaluatedAt, canonical1X2: { marketSignature: "fx-1|full|1x2", snapshotId: "snap-1", providerSequence: 9, observedAt: "2026-07-12T10:00:00.000Z", selections: { home: 48, draw: 27, away: 25 } }, availableMarkets: [{ marketType: "FIRST_HALF_RESULT" }], ...overrides });

test("consumer projection separates kickoff, observation and materialization time", () => {
  const projection = deriveFixtureConsumerProjection({ fixture: fixture(), txlineContext: context(), evaluatedAt, localeContext });
  assert.equal(projection.temporal.relation, "later_this_week");
  assert.equal(projection.market.canonical1X2.observedAt, "2026-07-12T10:00:00.000Z");
  assert.equal(projection.market.canonical1X2.receivedAt, evaluatedAt);
  assert.notEqual(projection.market.canonical1X2.observedAt, projection.generatedAt);
  assert.equal(projection.market.freshness.currentForDisplay, true);
  assert.equal(projection.market.freshness.currentForDirectionalClaim, false);
  assert.equal(projection.availability.canShowMarket, true);
  assert.equal(projection.availability.canMakeDirectionalClaim, false);
  assert.equal(projection.editorial.marketStatementIntent, "last_observed");
});

test("generatedAt never substitutes a missing market observation", () => {
  const projection = deriveFixtureConsumerProjection({ fixture: fixture(), txlineContext: context({ canonical1X2: { marketSignature: "sig", selections: { home: 40, draw: 30, away: 30 } } }), evaluatedAt, localeContext });
  assert.equal(projection.market.canonical1X2.observedAt, null);
  assert.equal(projection.market.freshness.reason, "missing_timestamp");
  assert.equal(projection.availability.canPredict, false);
  assert.equal(projection.availability.canShowMarket, false);
});

for (const status of ["paused", "postponed", "cancelled", "unknown"]) {
  test(`${status} remains distinct and cannot become a playable scheduled fixture`, () => {
    const projection = deriveFixtureConsumerProjection({ fixture: fixture({ status }), txlineContext: context(), evaluatedAt, localeContext });
    assert.equal(projection.fixture.status, status);
    assert.equal(projection.availability.canPredict, false);
    assert.equal(projection.availability.canMakeDirectionalClaim, false);
    assert.equal(projection.editorial.headlineIntent, "fixture_unavailable");
  });
}

test("raw non-1X2 markets never make the Consumer 1X2 projection playable", () => {
  const projection = deriveFixtureConsumerProjection({ fixture: fixture(), txlineContext: { generatedAt: evaluatedAt, availableMarkets: [{ marketType: "FIRST_HALF_RESULT" }] }, evaluatedAt, localeContext });
  assert.equal(projection.market.canonical1X2, null);
  assert.equal(projection.availability.canPredict, false);
  assert.equal(projection.availability.canShowMarket, false);
  assert.equal(projection.availability.reason, "market_missing");
});

test("priority ordering is deterministic", () => {
  const first = deriveFixtureConsumerProjection({ fixture: fixture({ fixtureId: "b" }), txlineContext: context(), evaluatedAt, localeContext });
  const second = deriveFixtureConsumerProjection({ fixture: fixture({ fixtureId: "a" }), txlineContext: context(), evaluatedAt, localeContext });
  assert.deepEqual(rankFixtureConsumerProjections([first, second]).map((item) => item.fixture.fixtureId), ["a", "b"]);
});
