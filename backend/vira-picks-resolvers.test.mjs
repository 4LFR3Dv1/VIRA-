import assert from "node:assert/strict";
import test from "node:test";
import { resolveBothTeamsScoreV1, resolveMatchResultV1, resolveSelectionV1, resolveTotalGoalsV1 } from "./vira-picks-resolvers.mjs";
import { selectionFromCanonicalId, validateSelections } from "./vira-picks-contracts.mjs";

const vectors = Object.freeze([
  Object.freeze({ score: Object.freeze({ homeScore: 0, awayScore: 0 }), result: "draw", total: "under", btts: "no" }),
  Object.freeze({ score: Object.freeze({ homeScore: 1, awayScore: 0 }), result: "home", total: "under", btts: "no" }),
  Object.freeze({ score: Object.freeze({ homeScore: 1, awayScore: 1 }), result: "draw", total: "under", btts: "yes" }),
  Object.freeze({ score: Object.freeze({ homeScore: 2, awayScore: 1 }), result: "home", total: "over", btts: "yes" }),
  Object.freeze({ score: Object.freeze({ homeScore: 3, awayScore: 0 }), result: "home", total: "over", btts: "no" }),
  Object.freeze({ score: Object.freeze({ homeScore: 0, awayScore: 2 }), result: "away", total: "under", btts: "no" }),
]);

test("versioned resolvers cover frozen regular-time score vectors", () => {
  for (const vector of vectors) {
    assert.equal(resolveMatchResultV1(vector.score), vector.result);
    assert.equal(resolveTotalGoalsV1(vector.score), vector.total);
    assert.equal(resolveBothTeamsScoreV1(vector.score), vector.btts);
  }
});

test("extra time and penalties cannot influence regular-time resolvers", () => {
  const authority = { homeScore: 1, awayScore: 1, extraTime: { home: 2, away: 1 }, penalties: { home: 5, away: 4 } };
  assert.equal(resolveMatchResultV1(authority), "draw");
  assert.equal(resolveTotalGoalsV1(authority), "under");
  assert.equal(resolveBothTeamsScoreV1(authority), "yes");
});

test("contracts reject unknown, duplicate, conflicting and out-of-range input", () => {
  assert.throws(() => validateSelections([]), /picks_count_out_of_range/);
  assert.throws(() => validateSelections(["match_result:home", "match_result:away"]), /duplicate_pick_kind/);
  assert.throws(() => selectionFromCanonicalId("total_goals:3.5:over"), /unknown_pick_selection/);
  assert.throws(() => selectionFromCanonicalId("corners:over"), /unknown_pick_selection/);
  const picks = validateSelections(["match_result:home", "total_goals:2.5:over", "both_teams_score:yes"]);
  assert.ok(Object.isFrozen(picks)); assert.ok(Object.isFrozen(picks[0]));
  assert.equal(resolveSelectionV1(picks[0], { homeScore: 2, awayScore: 1 }).status, "correct");
});
