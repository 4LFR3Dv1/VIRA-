import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WORLD_CUP_JOURNEY_MANIFEST_V1, validateTournamentJourneyManifestV1 } from "./tournament-journey-manifest.mjs";
import { TournamentJourneyStore } from "./tournament-journey-store.mjs";
import { buildTournamentJourneyProjection, terminalResultFromTxlineHistory } from "./tournament-journey.mjs";

function fixture(fixtureId, home, away, status, kickoffAt = "2026-07-19T19:00:00.000Z") {
  return { schemaVersion: 1, generatedAt: "2026-07-16T12:00:00.000Z", fixture: { fixtureId, homeTeam: { providerId: null, name: home, shortName: null }, awayTeam: { providerId: null, name: away, shortName: null }, competition: { providerCompetitionId: "72", canonicalCompetitionId: "world-cup", displayName: "World Cup", kind: "world_cup", authority: "registry", mapped: true }, status, kickoffAt }, temporal: { evaluatedAt: "2026-07-16T12:00:00.000Z", timeZone: "UTC", relation: status === "finished" ? "finished" : "future", localKickoffDate: "2026-07-19", localKickoffTime: "19:00" }, market: { canonical1X2: null, freshness: { evaluatedAt: "2026-07-16T12:00:00.000Z", ageSeconds: null, usableForPrediction: false, currentForDisplay: false, currentForDirectionalClaim: false, reason: "unavailable" } }, availability: { canFeature: status === "scheduled" || status === "live", featureReason: "test", canPredict: false, canEnterRoom: !["postponed", "cancelled", "unknown"].includes(status), roomMode: status === "finished" ? "read_only" : status === "live" ? "live" : status === "scheduled" ? "pre_match" : "unavailable", canShowMarket: false, canMakeDirectionalClaim: false, reason: `fixture_${status}` }, editorial: { priority: 0, priorityReasons: [], headlineIntent: "test", scheduleIntent: "test", marketStatementIntent: "market_unavailable" } };
}

function archiveWithFinal(status, result = null) {
  return {
    "18237038": { projection: fixture("18237038", "France", "Spain", "finished"), result: { authority: "txline_terminal_history", homeScore: 0, awayScore: 2 } },
    "18241006": { projection: fixture("18241006", "England", "Argentina", "finished"), result: { authority: "txline_terminal_history", homeScore: 1, awayScore: 2 } },
    "18257865": { projection: fixture("18257865", "France", "England", "scheduled"), result: null },
    "18257739": { projection: fixture("18257739", "Spain", "Argentina", status), result },
  };
}

test("manifest owns exactly the four structural positions and contains no sports data", () => {
  assert.equal(validateTournamentJourneyManifestV1(WORLD_CUP_JOURNEY_MANIFEST_V1), WORLD_CUP_JOURNEY_MANIFEST_V1);
  assert.deepEqual(WORLD_CUP_JOURNEY_MANIFEST_V1.fixtures.map(({ stage, slot }) => `${stage}:${slot}`), ["semi_final:1", "semi_final:2", "third_place:1", "final:1"]);
  assert.throws(() => validateTournamentJourneyManifestV1({ ...WORLD_CUP_JOURNEY_MANIFEST_V1, fixtures: WORLD_CUP_JOURNEY_MANIFEST_V1.fixtures.map((item, index) => index ? item : { ...item, homeTeam: "France" }) }), /manifest_contains_result_data/);
});

test("terminal result requires exact fixture, final action and status 100", () => {
  const valid = terminalResultFromTxlineHistory("18257739", [{ FixtureId: 18257739, Action: "game_finalised", StatusId: 100, Seq: 99, Participant1IsHome: true, Ts: 1784491200000, Score: { Participant1: { Total: { Goals: 2 } }, Participant2: { Total: { Goals: 1 } } } }]);
  assert.deepEqual({ home: valid.homeScore, away: valid.awayScore, sequence: valid.providerSequence }, { home: 2, away: 1, sequence: 99 });
  assert.equal(terminalResultFromTxlineHistory("18257739", [{ FixtureId: 18257739, Action: "game_finalised", StatusId: 5 }]), null);
  assert.equal(terminalResultFromTxlineHistory("18257739", [{ FixtureId: 999, Action: "game_finalised", StatusId: 100 }]), null);
  assert.equal(terminalResultFromTxlineHistory("18257739", [{ FixtureId: 18257739, Action: "game_finalised", StatusId: 100, Score: { Participant1: { Total: {} }, Participant2: { Total: {} } } }]), null);
});

test("scheduled, live, postponed and unavailable states never produce a champion", () => {
  for (const status of ["scheduled", "live", "postponed", "cancelled", "unknown"]) {
    const projection = buildTournamentJourneyProjection({ manifest: WORLD_CUP_JOURNEY_MANIFEST_V1, archive: archiveWithFinal(status) });
    assert.equal(projection.status, "active", status); assert.equal(projection.champion, null, status);
  }
  const missing = buildTournamentJourneyProjection({ manifest: WORLD_CUP_JOURNEY_MANIFEST_V1, archive: {} });
  assert.equal(missing.fixtures.every((item) => item.availability === "unavailable"), true);
});

test("finished final without terminal authority does not produce a premature champion", () => {
  const unresolved = buildTournamentJourneyProjection({ manifest: WORLD_CUP_JOURNEY_MANIFEST_V1, archive: archiveWithFinal("finished") });
  assert.equal(unresolved.status, "active"); assert.equal(unresolved.champion, null);
  const resolved = buildTournamentJourneyProjection({ manifest: WORLD_CUP_JOURNEY_MANIFEST_V1, archive: archiveWithFinal("finished", { authority: "txline_terminal_history", homeScore: 2, awayScore: 1 }) });
  assert.equal(resolved.status, "complete"); assert.equal(resolved.champion.name, "Spain");
});

test("archive is atomic, idempotent and preserves payload provenance across restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-journey-"));
  try {
    const store = await new TournamentJourneyStore({ dataDir }).init();
    const input = { fixtureId: "18237038", payload: { FixtureId: 18237038, Seq: 1026 }, origin: "/api/scores/historical/18237038", observedAt: "2026-07-14T21:04:14.751Z", receivedAt: "2026-07-16T12:00:00.000Z", providerSequence: 1026, freshness: "terminal", projection: fixture("18237038", "France", "Spain", "finished"), result: { authority: "txline_terminal_history", homeScore: 0, awayScore: 2 } };
    await store.record(input); await store.record(input);
    assert.equal(store.get("18237038").observations.length, 1);
    const restarted = await new TournamentJourneyStore({ dataDir }).init();
    const restored = restarted.get("18237038");
    assert.equal(restored.result.awayScore, 2); assert.equal(restored.observations[0].providerSequence, 1026); assert.match(restored.observations[0].canonicalHash, /^[a-f0-9]{64}$/);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
