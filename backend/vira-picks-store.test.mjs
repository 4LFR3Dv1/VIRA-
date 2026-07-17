import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildMarketSnapshotForSelection } from "./vira-picks-market.mjs";
import { createViraPicksStore } from "./vira-picks-store.mjs";
import { deriveRegularTimeScoreAuthorityV1 } from "./vira-picks-regular-time-authority.mjs";
import { REGULAR_TIME_AUTHORITY_VECTORS } from "./test-fixtures/txline/regular-time-authority-vectors.mjs";

const fixture = Object.freeze({ fixtureId: "fixture-picks", homeTeam: "Brazil", awayTeam: "France", status: "scheduled", startTime: "2026-07-19T20:00:00.000Z" });
const identity = Object.freeze({ publicId: "player_public_only", displayName: "Ana" });
const observedAt = "2026-07-19T19:50:00.000Z";
const market = (marketType, priceNames, marketParameters = null, suffix = marketType, marketPeriod = null) => ({ id: suffix, messageId: suffix, fixtureId: fixture.fixtureId, signature: `${fixture.fixtureId}|${marketType}|${marketParameters ?? "default"}`, marketType, marketParameters, marketPeriod, inRunning: false, capturedAt: observedAt, sourceEndpoint: `/api/odds/snapshot/${fixture.fixtureId}`, sequence: 11, options: priceNames.map((priceName, index) => ({ priceName, pct: [51, 25, 24][index] ?? 49, price: 1.8 + index })) });
const context = (markets, receivedAt = "2026-07-19T19:50:01.000Z") => ({ generatedAt: observedAt, availableMarkets: markets, endpoints: { odds: { endpoint: `/api/odds/snapshot/${fixture.fixtureId}`, receivedAt, ok: true } } });
const selections = Object.freeze([
  Object.freeze({ kind: "match_result", period: "regular_time", selection: "home", resolverVersion: 1 }),
  Object.freeze({ kind: "total_goals", period: "regular_time", line: 2.5, selection: "over", resolverVersion: 1 }),
]);

function snapshots(markets = [market("1X2_PARTICIPANT_RESULT", ["part1", "draw", "part2"]), market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5")]) {
  return selections.map((selection) => {
    const result = buildMarketSnapshotForSelection({ fixture, context: context(markets), selection, now: Date.parse("2026-07-19T19:51:00.000Z") });
    assert.equal(result.available, true); return result.snapshot;
  });
}

async function withStore(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vira-picks-"));
  try { await run(dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test("market snapshots reject stale, missing options, wrong line and ambiguity", () => {
  const base = { fixture, selection: selections[1], now: Date.parse("2026-07-19T19:51:00.000Z") };
  assert.equal(buildMarketSnapshotForSelection({ ...base, context: context([]) }).reason, "market_missing");
  assert.equal(buildMarketSnapshotForSelection({ ...base, context: context([market("OVERUNDER_PARTICIPANT_GOALS", ["over"], "line=2.5")]) }).reason, "market_options_invalid");
  assert.equal(buildMarketSnapshotForSelection({ ...base, context: context([market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=3.5")]) }).reason, "market_missing");
  assert.equal(buildMarketSnapshotForSelection({ ...base, context: context([market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5", "a"), market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5", "b")]) }).reason, "market_ambiguous");
  const oldNow = Date.parse("2026-07-23T19:51:01.000Z");
  assert.equal(buildMarketSnapshotForSelection({ ...base, now: oldNow, context: context([market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5")], new Date(oldNow).toISOString()) }).reason, "market_stale");
});

test("confirmation is immutable, idempotent, server-locked and private until shared", () => withStore(async (dataDir) => {
  let now = Date.parse("2026-07-19T19:52:00.000Z"); const store = await createViraPicksStore({ dataDir, clock: () => now });
  const input = { fixture, identity, selectionIds: ["match_result:home", "total_goals:2.5:over"], idempotencyKey: "confirm-ana-001", locale: "en", timeZone: "UTC", snapshots: snapshots() };
  const first = await store.confirm(input); const duplicate = await store.confirm(input);
  assert.equal(first.id, duplicate.id); assert.equal(Object.keys(store.state.cards).length, 1); assert.ok(Object.isFrozen(first.selections));
  assert.deepEqual(store.public(first.publicCode).selections, []);
  await store.markShared(first.id, identity.publicId); assert.equal(store.public(first.publicCode).selections.length, 2);
  await assert.rejects(store.confirm({ ...input, selectionIds: ["match_result:away"], snapshots: [snapshots()[0]] }), /idempotency_conflict/);
  now = Date.parse(fixture.startTime); await store.lockDueCards(); assert.equal(store.owner(identity.publicId, fixture.fixtureId).status, "locked");
  await assert.rejects(store.confirm({ ...input, idempotencyKey: "confirm-too-late" }), /picks_deadline_passed/);
}));

test("atomic restart preserves cards and deterministic resolution hash", () => withStore(async (dataDir) => {
  let now = Date.parse("2026-07-19T19:52:00.000Z"); const clock = () => now; let store = await createViraPicksStore({ dataDir, clock });
  const card = await store.confirm({ fixture, identity, selectionIds: ["match_result:home", "total_goals:2.5:over"], idempotencyKey: "restart-001", locale: "pt-BR", timeZone: "America/Sao_Paulo", snapshots: snapshots() });
  const authority = deriveRegularTimeScoreAuthorityV1({ fixtureId: fixture.fixtureId, records: REGULAR_TIME_AUTHORITY_VECTORS.finishedIn90, historyComplete: true, freshness: "fresh", receivedAt: "2026-07-19T22:00:01.000Z" });
  now = Date.parse("2026-07-19T22:00:02.000Z");
  const first = await store.resolveFixture(fixture.fixtureId, authority); store = await createViraPicksStore({ dataDir, clock });
  const restored = store.owner(identity.publicId, fixture.fixtureId); assert.equal(restored.id, card.id); assert.equal(restored.status, "resolved"); assert.deepEqual(restored.results.map((item) => item.status), ["correct", "correct"]);
  const second = await store.resolveFixture(fixture.fixtureId, authority); assert.equal(second.resolutionSnapshotRef, first.resolutionSnapshotRef); assert.equal(Object.keys(store.state.resolutionSnapshots).length, 1);
}));

test("cancelled, postponed and abandoned void cards while unknown and stale remain pending", () => withStore(async (dataDir) => {
  const store = await createViraPicksStore({ dataDir, clock: () => Date.parse("2026-07-19T19:52:00.000Z") });
  await store.confirm({ fixture, identity, selectionIds: ["match_result:home"], idempotencyKey: "void-001", locale: "en", timeZone: "UTC", snapshots: [snapshots()[0]] });
  assert.equal((await store.resolveFixture(fixture.fixtureId, { status: "unknown", freshness: "fresh" })).awaitingAuthority, true);
  assert.equal((await store.resolveFixture(fixture.fixtureId, { status: "final", freshness: "stale" })).awaitingAuthority, true);
  for (const reason of ["cancelled", "postponed", "abandoned"]) assert.equal((await store.voidFixture(fixture.fixtureId, reason)).voided >= 0, true);
  assert.equal(store.owner(identity.publicId, fixture.fixtureId).status, "void");
}));
