import assert from "node:assert/strict";
import test from "node:test";

import { createTxlineCatalogCache } from "./txline-catalog-cache.mjs";

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
