import { deriveFixtureEditorialEligibility, deriveFixtureTemporalContext, deriveMarketFreshness, fixturePredictionCopy, rankEligibleFixture, resolveEditorialLocaleContext } from "../shared/editorial-domain.mjs";

function normalizedStatus(value) { const status = String(value ?? "").toLowerCase(); return ["live", "in_play", "inplay", "playing"].includes(status) ? "live" : ["finished", "final", "ended", "completed"].includes(status) ? "finished" : "scheduled"; }

function fixtureMarket(fixture, evaluatedAt) {
  const canonical = fixture?.context?.canonical1X2;
  if (!canonical) return null;
  const selections = { home: Number(canonical.selections.home), draw: Number(canonical.selections.draw), away: Number(canonical.selections.away) };
  const distributionValid = Object.values(selections).every((value) => Number.isFinite(value) && value >= 0);
  const values = Object.values(selections); const leadingChoice = ["home", "draw", "away"][values.indexOf(Math.max(...values))];
  return { scope: "fixture", type: "MATCH_RESULT_1X2", authority: "txline_fixture_market", fixtureId: String(fixture.fixtureId), selections, leadingChoice, snapshotId: canonical.snapshotId, marketSignature: canonical.marketSignature ?? null, providerSequence: canonical.providerSequence ?? null, freshness: deriveMarketFreshness({ observedAt: canonical.observedAt ?? fixture.context?.generatedAt, receivedAt: fixture.context?.generatedAt, evaluatedAt, kickoffAt: fixture.startTime, contextAvailable: fixture?.availability?.contextStatus !== "unavailable", distributionValid }) };
}

function fixtureSummary(fixture, market, temporal) { return { fixtureId: String(fixture.fixtureId), competitionLabel: fixture.competitionLabel, competition: fixture.competition, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, startTime: fixture.startTime ?? null, status: normalizedStatus(fixture.status), roomAvailable: true, temporal, market }; }

export function deriveHomeProjection({ catalog, player = null, predictions = {}, miniLeagues = [], now = new Date(), localeContext: requestedLocaleContext = null }) {
  const evaluatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const localeContext = resolveEditorialLocaleContext(requestedLocaleContext ?? {});
  const candidates = (catalog?.matches ?? []).map((fixture) => {
    const prediction = predictions[String(fixture.fixtureId)] ?? null;
    const normalizedFixture = { ...fixture, status: normalizedStatus(fixture.status) };
    const temporal = deriveFixtureTemporalContext(normalizedFixture, { evaluatedAt, localeContext });
    const market = fixtureMarket(normalizedFixture, evaluatedAt);
    const eligibility = deriveFixtureEditorialEligibility({ fixture: normalizedFixture, market, temporal });
    const rank = eligibility.eligible ? rankEligibleFixture({ fixture: normalizedFixture, market, temporal, prediction }) : { score: -Infinity, reasons: [] };
    return { fixture: normalizedFixture, prediction, temporal, market, eligibility, rank };
  });
  const resolved = candidates.find((item) => item.prediction?.status === "resolved");
  const live = candidates.find((item) => item.fixture.status === "live");
  const predictable = candidates.filter((item) => item.eligibility.eligible).sort((a, b) => b.rank.score - a.rank.score || a.temporal.minutesUntilKickoff - b.temporal.minutesUntilKickoff)[0] ?? null;
  const selected = resolved ?? live ?? predictable ?? candidates.find((item) => item.fixture.status !== "finished") ?? candidates[0] ?? null;
  let editorial;
  if (resolved) editorial = { kind: "result_available", authority: "official_match_state", fixture: fixtureSummary(resolved.fixture, resolved.market, resolved.temporal), prediction: resolved.prediction, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  else if (live) editorial = { kind: "join_live_room", authority: "official_match_state", fixture: fixtureSummary(live.fixture, live.market, live.temporal), prediction: live.prediction, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  else if (predictable) {
    const labels = { home: predictable.fixture.homeTeam, draw: "Empate", away: predictable.fixture.awayTeam };
    const copy = fixturePredictionCopy({ temporalRelation: predictable.temporal.relation, homeTeam: predictable.fixture.homeTeam, awayTeam: predictable.fixture.awayTeam, market: predictable.market ? { ...predictable.market, leadingLabel: labels[predictable.market.leadingChoice] } : null });
    editorial = { kind: "predict_fixture", authority: "txline_fixture_market", fixture: fixtureSummary(predictable.fixture, predictable.market, predictable.temporal), prediction: predictable.prediction, sourceSnapshotIds: [predictable.market.snapshotId], generatedAt: evaluatedAt, expiresAt: predictable.fixture.startTime, copy, evidence: { eligibility: predictable.eligibility, rankScore: predictable.rank.score, rankReasons: predictable.rank.reasons } };
  } else editorial = { kind: "open_calendar", authority: "official_match_state", fixture: selected ? fixtureSummary(selected.fixture, selected.market, selected.temporal) : null, prediction: selected?.prediction ?? null, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  return { version: 2, localeContext, tournament: { id: selected?.fixture?.competition?.canonicalCompetitionId || "unidentified-competition", name: selected?.fixture?.competitionLabel || "Competicao", status: live ? "active" : candidates.every((item) => item.fixture.status === "finished") ? "finished" : "active", generatedAt: catalog?.generatedAt ?? evaluatedAt, primaryFixture: selected ? fixtureSummary(selected.fixture, selected.market, selected.temporal) : null, outrightMarket: null }, player: player ? { ...player, fixturePrediction: selected?.prediction ?? null, miniLeagues } : null, editorial };
}

export const homeProjectionInternals = { fixtureMarket, normalizedStatus };
