import assert from "node:assert/strict";
import test from "node:test";

import { createTxlineCatalogCache } from "./txline-catalog-cache.mjs";
import { deriveHomeProjection } from "./home-projection.mjs";

const match = { fixtureId: "1", title: "A vs B", competitionLabel: "Cup", homeTeam: "A", awayTeam: "B" };
const context = { availableMarkets: [{ id: "m1" }], suggestedPrediction: { marketId: "m1" }, endpoints: { odds: { data: { availableMarkets: [] } } } };

test("catalog materializes contexts once and serves a warm hit", async () => {
  let matchLoads = 0;
  let contextLoads = 0;
  let clock = Date.parse("2026-07-11T12:00:00.000Z");
  const cache = createTxlineCatalogCache({
    loadMatches: async () => { matchLoads += 1; return { source: "txline", matches: [match] }; },
    loadContext: async () => { contextLoads += 1; return context; },
    now: () => clock,
    freshMs: 30_000,
  });
  const cold = await cache.get();
  const warm = await cache.get();
  assert.equal(cold.matches[0].availability.marketCount, 1);
  assert.equal(cold.matches[0].consumerProjection.schemaVersion, 1);
  assert.equal(cold.matches[0].consumerProjection.market.canonical1X2, null);
  assert.equal(cold.matches[0].availability.hasPlayablePrediction, false);
  assert.equal(cold.featuredFixtureId, "1");
  assert.equal(warm.cache.status, "hit");
  assert.equal(matchLoads, 1);
  assert.equal(contextLoads, 1);
});

test("stale snapshot is returned while a single refresh runs", async () => {
  let clock = Date.parse("2026-07-11T12:00:00.000Z");
  let release;
  let block = false;
  let loads = 0;
  const cache = createTxlineCatalogCache({
    loadMatches: async () => {
      loads += 1;
      if (block) await new Promise((resolve) => { release = resolve; });
      return { source: "txline", matches: [match] };
    },
    loadContext: async () => context,
    now: () => clock,
    freshMs: 100,
  });
  await cache.get();
  clock += 101;
  block = true;
  const stale = await cache.get();
  const staleAgain = await cache.get();
  assert.equal(stale.cache.status, "stale");
  assert.equal(staleAgain.matches.length, 1);
  assert.equal(loads, 2);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("failed context refresh preserves the previous confirmed context", async () => {
  let fail = false;
  let clock = Date.parse("2026-07-11T12:00:00.000Z");
  const cache = createTxlineCatalogCache({
    loadMatches: async () => ({ source: "txline", matches: [match] }),
    loadContext: async () => { if (fail) throw new Error("provider_down"); return context; },
    now: () => clock,
    freshMs: 10,
  });
  await cache.get();
  fail = true;
  clock += 11;
  const refreshed = await cache.refresh("test");
  assert.equal(refreshed.matches[0].availability.contextStatus, "stale");
  assert.equal(refreshed.matches[0].context.availableMarkets.length, 1);
});

test("degraded empty odds response cannot replace a rich confirmed context", async () => {
  let degraded = false;
  let clock = Date.parse("2026-07-11T12:00:00.000Z");
  const rich = { ...context, generatedAt: "2026-07-11T11:00:00.000Z", endpoints: { odds: { ok: true, data: { availableMarkets: [] } }, oddsUpdates: { ok: true } } };
  const empty = { availableMarkets: [], suggestedPrediction: null, generatedAt: "2026-07-11T12:01:00.000Z", endpoints: { odds: { ok: false, data: null }, oddsUpdates: { ok: false, data: null } } };
  const cache = createTxlineCatalogCache({
    loadMatches: async () => ({ source: "txline", matches: [match] }),
    loadContext: async () => degraded ? empty : rich,
    now: () => clock,
    freshMs: 10,
  });
  await cache.get();
  degraded = true;
  clock += 11;
  const refreshed = await cache.refresh("degraded-test");
  assert.equal(refreshed.matches[0].availability.marketCount, 1);
  assert.equal(refreshed.matches[0].availability.contextStatus, "stale");
  assert.equal(refreshed.matches[0].contextError, "degraded_refresh_preserved_previous");
});

test("background startup refresh contains provider failures", async () => {
  const cache = createTxlineCatalogCache({
    loadMatches: async () => { throw new Error("missing_txline_credentials"); },
    loadContext: async () => null,
    refreshMs: 60_000,
  });
  cache.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cache.status().lastError, "missing_txline_credentials");
  cache.stop();
});

test("game_finalised context closes a stale live fixture and promotes the next eligible match", async () => {
  const evaluatedAt = "2026-07-14T12:00:00.000Z";
  const competition = { kind: "world_cup", mapped: true, authority: "registry" };
  const closed = { ...match, fixtureId: "closed", status: "live", startTime: "2026-07-14T09:00:00.000Z", competition };
  const upcoming = { ...match, fixtureId: "next", title: "C vs D", homeTeam: "C", awayTeam: "D", status: "scheduled", startTime: "2026-07-14T14:00:00.000Z", competition };
  const configured = [];
  const cache = createTxlineCatalogCache({
    loadMatches: async () => ({ source: "txline", matches: [closed, upcoming] }),
    loadContext: async (fixture) => fixture.fixtureId === "closed"
      ? { generatedAt: evaluatedAt, availableMarkets: [], fixtureState: { authority: "txline_game_finalised", status: "finished", providerSequence: 1026, score: { home: 0, away: 2 } } }
      : { generatedAt: evaluatedAt, availableMarkets: [{ id: "market" }], canonical1X2: { marketSignature: "next|1x2", snapshotId: "next-market", providerSequence: 1, observedAt: evaluatedAt, selections: { home: 45, draw: 30, away: 25 } } },
    configureMatch: (fixture) => configured.push(fixture),
    now: () => Date.parse(evaluatedAt),
  });
  const catalog = await cache.get();
  const reconciled = catalog.matches.find((fixture) => fixture.fixtureId === "closed");
  assert.equal(reconciled.status, "finished");
  assert.equal(reconciled.consumerProjection.fixture.status, "finished");
  assert.deepEqual([reconciled.homeScore, reconciled.awayScore], [0, 2]);
  assert.equal(catalog.featuredFixtureId, "next");
  assert.equal(configured.find((fixture) => fixture.fixtureId === "closed").lifecycleResolution, "txline_game_finalised");
  const home = deriveHomeProjection({ catalog, now: new Date(evaluatedAt) });
  assert.equal(home.editorial.fixture.fixtureId, "next");
  assert.notEqual(home.editorial.kind, "join_live_room");
});

test("finished fixture rotates to the next World Cup fixture before predictions open", async () => {
  const evaluatedAt = "2026-07-15T22:24:00.000Z";
  const closed = { ...match, fixtureId: "semi-final", status: "finished", startTime: "2026-07-15T19:00:00.000Z", competition: { kind: "world_cup", mapped: true } };
  const friendly = { ...match, fixtureId: "friendly", status: "scheduled", startTime: "2026-07-18T12:00:00.000Z", competition: { kind: "friendly", mapped: true } };
  const thirdPlace = { ...match, fixtureId: "third-place", status: "scheduled", startTime: "2026-07-18T21:00:00.000Z", competition: { kind: "world_cup", mapped: true } };
  const marketContext = { generatedAt: evaluatedAt, availableMarkets: [{ id: "market" }], canonical1X2: { marketSignature: "fixture|1x2", snapshotId: "market", providerSequence: 1, observedAt: evaluatedAt, selections: { home: 45, draw: 30, away: 25 } } };
  const cache = createTxlineCatalogCache({
    loadMatches: async () => ({ source: "txline", matches: [closed, friendly, thirdPlace] }),
    loadContext: async () => marketContext,
    now: () => Date.parse(evaluatedAt),
  });

  const catalog = await cache.get();
  const selected = catalog.matches.find((fixture) => fixture.fixtureId === catalog.featuredFixtureId);
  assert.equal(catalog.featuredFixtureId, "third-place");
  assert.equal(selected.consumerProjection.availability.canFeature, true);
  assert.equal(selected.consumerProjection.availability.canPredict, false);
});
