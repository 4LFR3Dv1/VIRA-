import assert from "node:assert/strict";
import test from "node:test";
import { deriveRegularTimeScoreAuthorityV1, verifyRegularTimeScoreAuthorityV1 } from "./vira-picks-regular-time-authority.mjs";
import { REGULAR_TIME_AUTHORITY_VECTORS as vectors } from "./test-fixtures/txline/regular-time-authority-vectors.mjs";
import { txlineContextInternals } from "./txline-context.mjs";
import { FRANCE_SPAIN_REGULAR_TIME_AUTHORITY_OBSERVED as observedRegularTime } from "./test-fixtures/txline/france-spain-regular-time-authority-observed.mjs";

const derive = (records, overrides = {}) => deriveRegularTimeScoreAuthorityV1({ fixtureId: "fixture-authority", records, historyComplete: true, freshness: "fresh", receivedAt: "2026-07-19T23:00:00.000Z", acquisitionOrigin: "txline:scores?Ts=0", ...overrides });

test("regular-time authority resolves a match finished in 90 minutes", () => {
  const authority = derive(vectors.finishedIn90);
  assert.equal(authority.path, "finished_in_regular_time");
  assert.deepEqual(authority.regularTimeScore, { home: 2, away: 1 });
  assert.equal(authority.terminalStatusId, 5);
  assert.equal(verifyRegularTimeScoreAuthorityV1(authority, "fixture-authority", { now: Date.parse("2026-07-19T23:00:01.000Z") }), true);
});

test("observed TxLINE status 5 plus game_finalised 100 supplies the real regular-time authority", () => {
  assert.equal(Object.isFrozen(observedRegularTime), true);
  assert.equal(Object.isFrozen(observedRegularTime.records), true);
  const authority = deriveRegularTimeScoreAuthorityV1({ fixtureId: observedRegularTime.fixtureId, records: observedRegularTime.records, historyComplete: true, freshness: "fresh", receivedAt: "2026-07-15T17:30:00.000Z", acquisitionOrigin: "/api/scores/historical/18237038" });
  assert.equal(authority.path, "finished_in_regular_time");
  assert.equal(authority.terminalStatusId, 5);
  assert.equal(authority.boundaryEventSequence, 1022);
  assert.equal(authority.scoreEventSequence, 1026);
  assert.equal(authority.providerSequence, 1026);
  assert.deepEqual(authority.regularTimeScore, { home: 0, away: 2 });
  assert.equal(authority.canonicalHash, "8af553e18a73b949d4eca3a6dd475cb61e28be59445ed52a7cb68e6012624fae");
});

test("reconnect in extra time recovers the structured score at the 90-minute boundary", () => {
  const authority = derive(vectors.extraTimeReconnectHistory);
  assert.equal(authority.path, "historical_before_extra_time");
  assert.deepEqual(authority.regularTimeScore, { home: 1, away: 1 });
  assert.equal(authority.terminalStatusId, 10);
});

test("penalty result never replaces the structured regular-time score", () => {
  const authority = derive(vectors.penaltiesReconnectHistory);
  assert.equal(authority.path, "historical_before_penalties");
  assert.deepEqual(authority.regularTimeScore, { home: 1, away: 1 });
  assert.equal(authority.terminalStatusId, 13);
});

test("missing boundary score, incomplete history, stale data and forged hash remain unresolved", () => {
  assert.equal(derive(vectors.unrecoverableExtraTime), null);
  assert.equal(derive(vectors.terminalOnlyExtraTime), null);
  assert.equal(derive(vectors.extraTimeReconnectHistory, { historyComplete: false }), null);
  assert.equal(derive(vectors.extraTimeReconnectHistory, { freshness: "stale" }), null);
  const authority = derive(vectors.finishedIn90);
  assert.equal(verifyRegularTimeScoreAuthorityV1({ ...authority, regularTimeScore: { home: 9, away: 0 } }, "fixture-authority", { now: Date.parse("2026-07-19T23:00:01.000Z") }), false);
  assert.equal(verifyRegularTimeScoreAuthorityV1(authority, "fixture-authority", { now: Date.parse("2026-07-19T23:10:01.000Z") }), false);
});

test("historical TxLINE context materializes reconnect authority without changing Match Room runtime", () => {
  const projected = txlineContextInternals.projectHistoricalScoreState(vectors.extraTimeReconnectHistory, "fixture-authority", "2026-07-19T23:00:00.000Z");
  assert.equal(projected.regularTimeAuthority.path, "historical_before_extra_time");
  assert.deepEqual(projected.regularTimeAuthority.regularTimeScore, { home: 1, away: 1 });
  assert.equal(projected.terminal?.score?.home ?? null, null);
});
