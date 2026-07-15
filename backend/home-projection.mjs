import { fixturePredictionCopy, resolveEditorialLocaleContext } from "../shared/editorial-domain.mjs";
import { deriveFixtureConsumerProjection, rankFixtureConsumerProjections } from "../shared/fixture-consumer-projection.mjs";

function normalizedStatus(value) { return deriveFixtureConsumerProjection({ fixture: { status: value } }).fixture.status; }

function fixtureMarket(fixture, evaluatedAt) {
  const projection = deriveFixtureConsumerProjection({ fixture, txlineContext: fixture?.context, evaluatedAt });
  const canonical = projection.market.canonical1X2;
  if (!canonical) return null;
  return { scope: "fixture", type: "MATCH_RESULT_1X2", authority: canonical.authority, fixtureId: String(fixture.fixtureId), selections: canonical.selections, leadingChoice: canonical.leadingChoice, snapshotId: canonical.snapshotId, marketSignature: canonical.signature, providerSequence: canonical.providerSequence, freshness: { ...projection.market.freshness, observedAt: canonical.observedAt, receivedAt: canonical.receivedAt, staleAfter: fixture.startTime ?? null } };
}

function fixtureSummary(fixture, market, temporal, consumerProjection) { return { fixtureId: String(fixture.fixtureId), competitionLabel: fixture.competitionLabel, competition: fixture.competition, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, startTime: fixture.startTime ?? null, status: consumerProjection.fixture.status, roomAvailable: consumerProjection.availability.canEnterRoom, temporal, market, consumerProjection }; }

export function deriveHomeProjection({ catalog, player = null, predictions = {}, miniLeagues = [], now = new Date(), localeContext: requestedLocaleContext = null }) {
  const evaluatedAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const localeContext = resolveEditorialLocaleContext(requestedLocaleContext ?? {});
  const candidates = (catalog?.matches ?? []).map((fixture) => {
    const prediction = predictions[String(fixture.fixtureId)] ?? null;
    const consumerProjection = deriveFixtureConsumerProjection({ fixture, txlineContext: fixture.context, evaluatedAt, localeContext, prediction });
    const normalizedFixture = { ...fixture, status: consumerProjection.fixture.status };
    const temporal = consumerProjection.temporal;
    const market = fixtureMarket(normalizedFixture, evaluatedAt);
    const eligibility = { eligible: consumerProjection.availability.canPredict, reasons: consumerProjection.availability.canPredict ? [] : [consumerProjection.availability.reason] };
    const rank = { score: consumerProjection.editorial.priority, reasons: consumerProjection.editorial.priorityReasons };
    return { fixture: normalizedFixture, prediction, temporal, market, eligibility, rank, consumerProjection };
  });
  const resolved = candidates.find((item) => item.prediction?.status === "resolved");
  const live = candidates.find((item) => item.fixture.status === "live");
  const predictable = candidates.filter((item) => item.eligibility.eligible).sort((a, b) => b.rank.score - a.rank.score || a.temporal.minutesUntilKickoff - b.temporal.minutesUntilKickoff)[0] ?? null;
  const rankedForFeature = rankFixtureConsumerProjections(candidates.map((item) => item.consumerProjection));
  const featuredProjection = rankedForFeature.find((item) => item.availability.canFeature) ?? rankedForFeature[0] ?? null;
  const featured = featuredProjection ? candidates.find((item) => item.fixture.fixtureId === featuredProjection.fixture.fixtureId) ?? null : null;
  const selected = resolved ?? live ?? predictable ?? featured ?? candidates[0] ?? null;
  let editorial;
  if (resolved) editorial = { kind: "result_available", authority: "official_match_state", fixture: fixtureSummary(resolved.fixture, resolved.market, resolved.temporal, resolved.consumerProjection), prediction: resolved.prediction, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  else if (live) editorial = { kind: "join_live_room", authority: "official_match_state", fixture: fixtureSummary(live.fixture, live.market, live.temporal, live.consumerProjection), prediction: live.prediction, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  else if (predictable) {
    const labels = { home: predictable.fixture.homeTeam, draw: "Empate", away: predictable.fixture.awayTeam };
    const copy = fixturePredictionCopy({ temporalRelation: predictable.temporal.relation, homeTeam: predictable.fixture.homeTeam, awayTeam: predictable.fixture.awayTeam, market: predictable.market ? { ...predictable.market, leadingLabel: labels[predictable.market.leadingChoice] } : null });
    editorial = { kind: "predict_fixture", authority: "txline_fixture_market", fixture: fixtureSummary(predictable.fixture, predictable.market, predictable.temporal, predictable.consumerProjection), prediction: predictable.prediction, sourceSnapshotIds: [predictable.market.snapshotId], generatedAt: evaluatedAt, expiresAt: predictable.fixture.startTime, copy, evidence: { eligibility: predictable.eligibility, rankScore: predictable.rank.score, rankReasons: predictable.rank.reasons } };
  } else editorial = { kind: "open_calendar", authority: "official_match_state", fixture: selected ? fixtureSummary(selected.fixture, selected.market, selected.temporal, selected.consumerProjection) : null, prediction: selected?.prediction ?? null, sourceSnapshotIds: [], generatedAt: evaluatedAt, expiresAt: null };
  return { version: 2, localeContext, tournament: { id: selected?.fixture?.competition?.canonicalCompetitionId || "unidentified-competition", name: selected?.fixture?.competitionLabel || "Competicao", status: live ? "active" : candidates.every((item) => item.fixture.status === "finished") ? "finished" : "active", generatedAt: catalog?.generatedAt ?? evaluatedAt, primaryFixture: selected ? fixtureSummary(selected.fixture, selected.market, selected.temporal, selected.consumerProjection) : null, outrightMarket: null }, player: player ? { ...player, fixturePrediction: selected?.prediction ?? null, miniLeagues } : null, editorial };
}

export const homeProjectionInternals = { fixtureMarket, normalizedStatus };
