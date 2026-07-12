import assert from "node:assert/strict";
import test from "node:test";
import { deriveFixtureEditorialEligibility, deriveFixtureTemporalContext, deriveMarketFreshness, fixturePredictionCopy, resolveEditorialLocaleContext } from "../shared/editorial-domain.mjs";

const localeContext = resolveEditorialLocaleContext({ locale: "pt-BR", timeZone: "America/Sao_Paulo", source: "viewer" });
const temporal = (evaluatedAt, kickoffAt, status = "scheduled") => deriveFixtureTemporalContext({ startTime: kickoffAt, status }, { evaluatedAt, localeContext });

test("temporal policy compares civil dates in the editorial timezone", () => {
  assert.equal(temporal("2026-07-12T13:00:00Z", "2026-07-12T23:00:00Z").relation, "today");
  assert.equal(temporal("2026-07-13T02:30:00Z", "2026-07-13T04:00:00Z").relation, "tomorrow");
  assert.equal(temporal("2026-07-12T04:00:00Z", "2026-07-14T02:00:00Z").relation, "tomorrow");
  assert.equal(temporal("2026-07-12T13:00:00Z", "2026-07-14T19:00:00Z").relation, "later_this_week");
});
test("official status overrides the original kickoff date", () => { assert.equal(temporal("2026-07-12T13:00:00Z", "2026-07-11T19:00:00Z", "live").relation, "live"); assert.equal(temporal("2026-07-12T13:00:00Z", "2026-07-14T19:00:00Z", "finished").relation, "finished"); });
test("invalid viewer timezone fails closed to the deployment default", () => { assert.equal(resolveEditorialLocaleContext({ timeZone: "Mars/Olympus", source: "viewer" }).timeZone, "America/Sao_Paulo"); });
test("market freshness separates prediction, display and directional authority", () => {
  const fresh = deriveMarketFreshness({ observedAt: "2026-07-12T11:55:00Z", evaluatedAt: "2026-07-12T12:00:00Z", kickoffAt: "2026-07-12T14:00:00Z" });
  assert.deepEqual([fresh.usableForPrediction, fresh.currentForDisplay, fresh.currentForDirectionalClaim], [true, true, true]);
  const display = deriveMarketFreshness({ observedAt: "2026-07-12T10:00:00Z", evaluatedAt: "2026-07-12T12:00:00Z", kickoffAt: "2026-07-12T14:00:00Z" });
  assert.deepEqual([display.usableForPrediction, display.currentForDisplay, display.currentForDirectionalClaim], [true, true, false]);
  const prediction = deriveMarketFreshness({ observedAt: "2026-07-11T12:00:00Z", evaluatedAt: "2026-07-12T12:00:00Z", kickoffAt: "2026-07-13T14:00:00Z" });
  assert.deepEqual([prediction.usableForPrediction, prediction.currentForDisplay, prediction.currentForDirectionalClaim], [true, false, false]);
});
test("ranking cannot bypass editorial promotion eligibility", () => { const eligibility = deriveFixtureEditorialEligibility({ fixture: { status: "scheduled", competition: { kind: "world_cup" } }, temporal: temporal("2026-07-12T12:00:00Z", "2026-07-20T14:00:00Z"), market: { freshness: { usableForPrediction: true } } }); assert.equal(eligibility.eligible, false); assert.ok(eligibility.reasons.includes("outside_promotion_window")); });
test("shared copy only uses relative language for strong temporal states", () => { assert.equal(fixturePredictionCopy({ temporalRelation: "today", homeTeam: "Franca", awayTeam: "Espanha" }).headline, "Quem vence hoje?"); assert.equal(fixturePredictionCopy({ temporalRelation: "tomorrow", homeTeam: "Franca", awayTeam: "Espanha" }).headline, "Quem vence amanhã?"); assert.equal(fixturePredictionCopy({ temporalRelation: "future", homeTeam: "Franca", awayTeam: "Espanha" }).headline, "Quem vence Franca x Espanha?"); });
test("rescheduling produces a new factual context without mutating the previous evaluation", () => { const before = temporal("2026-07-12T12:00:00Z", "2026-07-13T14:00:00Z"); const after = temporal("2026-07-12T12:00:00Z", "2026-07-14T14:00:00Z"); assert.equal(before.relation, "tomorrow"); assert.equal(after.relation, "later_this_week"); assert.equal(before.kickoffAt, "2026-07-13T14:00:00Z"); });
