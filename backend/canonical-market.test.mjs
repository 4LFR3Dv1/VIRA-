import assert from "node:assert/strict";
import test from "node:test";
import { selectCanonicalFixture1X2 } from "./txline-context.mjs";

const option = (priceName, pct) => ({ priceName, pct });
test("canonical 1X2 selects the latest full-match market and ignores first half", () => {
  const markets = [
    { id: "half", signature: "half", marketType: "1X2_PARTICIPANT_RESULT", marketPeriod: "half=1", hasProbabilities: true, capturedAt: "2026-07-12T12:01:00Z", options: [option("part1", 10), option("draw", 20), option("part2", 70)] },
    { id: "old", signature: "old", marketType: "1X2_PARTICIPANT_RESULT", marketPeriod: null, hasProbabilities: true, capturedAt: "2026-07-12T12:00:00Z", options: [option("part1", 40), option("draw", 30), option("part2", 30)] },
    { id: "latest", signature: "latest", marketType: "1X2_PARTICIPANT_RESULT", marketPeriod: null, hasProbabilities: true, capturedAt: "2026-07-12T12:02:00Z", options: [option("part1", 31), option("draw", 44), option("part2", 25)] },
  ];
  const result = selectCanonicalFixture1X2(markets, { fixtureId: "fixture" });
  assert.equal(result.snapshotId, "latest");
  assert.deepEqual(result.selections, { home: 31, draw: 44, away: 25 });
  assert.equal(result.leadingChoice, "draw");
});

test("canonical 1X2 fails closed without a full-match distribution", () => {
  assert.equal(selectCanonicalFixture1X2([{ marketType: "1X2_PARTICIPANT_RESULT", marketPeriod: "half=1", hasProbabilities: true }], { fixtureId: "fixture" }), null);
});
