import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketSnapshotForSelection, parseTxlineLineParameterV1 } from "./vira-picks-market.mjs";
import { OVERUNDER_2_5_OBSERVED_SANITIZED as vector } from "./test-fixtures/txline/overunder-2-5-observed-sanitized.mjs";

const selection = Object.freeze({ kind: "total_goals", period: "regular_time", line: 2.5, selection: "over", resolverVersion: 1 });
const fixture = Object.freeze({ fixtureId: "18241006" });
const contextFor = (market, receivedAt = vector.receivedAt, ok = true) => ({ availableMarkets: [market], endpoints: { odds: { endpoint: vector.capturedFrom, receivedAt, ok } } });

test("observed Over/Under 2.5 vector is deeply frozen and produces stable signature and SHA-256", () => {
  assert.equal(Object.isFrozen(vector), true);
  assert.equal(Object.isFrozen(vector.market.options), true);
  assert.equal(Object.isFrozen(vector.market.options[0]), true);
  const result = buildMarketSnapshotForSelection({ fixture, context: contextFor(vector.market), selection, now: Date.parse("2026-07-15T17:03:00.000Z") });
  assert.equal(result.available, true);
  assert.equal(result.snapshot.marketSignature, "18241006|OVERUNDER_PARTICIPANT_GOALS|line=2.5|match|over/under|10021");
  assert.equal(result.snapshot.canonicalHash, "b9f905c6068567df392fbeddb92aea6c4bc0862a4bb259f7813ec7b4f2ec792c");
  assert.deepEqual(result.snapshot.options.map(({ canonicalSelection }) => canonicalSelection), ["over", "under"]);
});

test("line parser consumes the entire value and mapping rejects approximate, duplicate, unknown, and non-regular markets", () => {
  assert.equal(parseTxlineLineParameterV1("line=2.5"), 2.5);
  for (const value of [2.5, "2.5", " line=2.5", "line=2.5 ", "line=2.5&foo=1", "line=2,5", "foo=2.5", null]) assert.equal(parseTxlineLineParameterV1(value), null);
  const mutate = (changes) => ({ ...vector.market, ...changes });
  for (const candidate of [
    mutate({ marketParameters: "line=2.50" }),
    mutate({ marketParameters: "line=2.5000001" }),
    mutate({ marketPeriod: "regular_time" }),
    mutate({ marketPeriod: undefined }),
  ]) assert.equal(buildMarketSnapshotForSelection({ fixture, context: contextFor(candidate), selection, now: Date.parse("2026-07-15T17:03:00.000Z") }).available, false);
  for (const options of [
    [vector.market.options[0], vector.market.options[0]],
    [vector.market.options[0], { priceName: "push", pct: 1 }],
    [...vector.market.options, { priceName: "push", pct: 1 }],
  ]) assert.equal(buildMarketSnapshotForSelection({ fixture, context: contextFor(mutate({ options })), selection, now: Date.parse("2026-07-15T17:03:00.000Z") }).reason, "market_options_invalid");
});

test("fresh acquisition keeps a stable pre-match observation available while stale acquisition and old observation fail closed", () => {
  const stableNow = Date.parse("2026-07-15T17:12:00.000Z");
  const stable = buildMarketSnapshotForSelection({ fixture, context: contextFor(vector.market, "2026-07-15T17:11:58.000Z"), selection, now: stableNow });
  assert.equal(stable.available, true);
  assert.equal(stable.snapshot.observedAt, vector.market.capturedAt);
  assert.equal(stable.snapshot.receivedAt, "2026-07-15T17:11:58.000Z");

  assert.equal(buildMarketSnapshotForSelection({ fixture, context: contextFor(vector.market, "2026-07-15T17:03:03.840Z"), selection, now: stableNow }).reason, "market_acquisition_stale");
  assert.equal(buildMarketSnapshotForSelection({ fixture, context: contextFor(vector.market, "2026-07-15T17:11:58.000Z", false), selection, now: stableNow }).reason, "market_endpoint_unavailable");
  assert.equal(buildMarketSnapshotForSelection({ fixture, context: contextFor(vector.market, "2026-07-16T00:00:00.000Z"), selection, now: Date.parse("2026-07-16T00:00:00.000Z") }).reason, "market_stale");
});
