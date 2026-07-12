const MATCH_RESULT_MARKET = "MATCH_RESULT_1X2";

function asTime(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : null;
}

function normalizedStatus(value) {
  const status = String(value ?? "").toLowerCase();
  if (["live", "in_play", "inplay", "playing"].includes(status)) return "live";
  if (["finished", "final", "ended", "completed"].includes(status)) return "finished";
  return "scheduled";
}

function fixtureMarket(fixture, nowMs) {
  const canonical = fixture?.context?.canonical1X2 ?? null;
  if (!canonical) return null;
  const probability = {
    home: canonical.selections.home,
    draw: canonical.selections.draw,
    away: canonical.selections.away,
    capturedAt: canonical.observedAt,
    messageId: canonical.snapshotId,
    providerSequence: canonical.providerSequence,
    marketSignature: canonical.marketSignature,
  };
  const home = Number(probability.home);
  const draw = Number(probability.draw);
  const away = Number(probability.away);
  if (![home, draw, away].every((value) => Number.isFinite(value) && value >= 0)) return null;
  const observedAt = probability.capturedAt ?? fixture.context?.generatedAt ?? null;
  const observedMs = asTime(observedAt);
  const kickoffMs = asTime(fixture.startTime);
  const contextUnavailable = fixture?.availability?.contextStatus === "unavailable";
  const fresh = observedMs !== null
    && observedMs <= nowMs
    && normalizedStatus(fixture.status) !== "finished"
    && !contextUnavailable
    && (kickoffMs === null || kickoffMs > nowMs);
  const values = [home, draw, away];
  const leadingIndex = values.indexOf(Math.max(...values));
  return {
    scope: "fixture",
    type: MATCH_RESULT_MARKET,
    authority: "txline_fixture_market",
    fixtureId: String(fixture.fixtureId),
    selections: { home, draw, away },
    leadingChoice: ["home", "draw", "away"][leadingIndex],
    snapshotId: probability.messageId ?? `${fixture.fixtureId}:${observedAt ?? "unknown"}`,
    marketSignature: probability.marketSignature ?? null,
    freshness: {
      providerSequence: probability.providerSequence ?? null,
      observedAt,
      staleAfter: kickoffMs === null ? null : new Date(kickoffMs).toISOString(),
      fresh,
    },
  };
}

function fixtureSummary(fixture, market) {
  return {
    fixtureId: String(fixture.fixtureId),
    competitionLabel: fixture.competitionLabel,
    competition: fixture.competition,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    startTime: fixture.startTime ?? null,
    status: normalizedStatus(fixture.status),
    roomAvailable: true,
    market,
  };
}

function relevanceScore(fixture, market, prediction, nowMs) {
  const status = normalizedStatus(fixture.status);
  let score = status === "live" ? 1_000 : status === "scheduled" ? 100 : 0;
  if (fixture?.competition?.kind === "world_cup") score += 500;
  if (status === "scheduled" && (!fixture.startTime || asTime(fixture.startTime) > nowMs)) score += 300;
  if (market?.freshness.fresh) score += 180;
  if (prediction?.status === "open") score += 140;
  if (prediction?.status === "resolved") score += 900;
  const kickoff = asTime(fixture.startTime);
  if (kickoff !== null && kickoff > nowMs) score -= Math.min((kickoff - nowMs) / 600_000, 200);
  return score;
}

export function deriveHomeProjection({ catalog, player = null, predictions = {}, miniLeagues = [], now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const candidates = (catalog?.matches ?? []).map((fixture) => {
    const market = fixtureMarket(fixture, nowMs);
    const prediction = predictions[String(fixture.fixtureId)] ?? null;
    return { fixture, market, prediction, score: relevanceScore(fixture, market, prediction, nowMs) };
  }).sort((left, right) => right.score - left.score || String(left.fixture.startTime ?? "").localeCompare(String(right.fixture.startTime ?? "")));

  const resolved = candidates.find((candidate) => candidate.prediction?.status === "resolved");
  const live = candidates.find((candidate) => normalizedStatus(candidate.fixture.status) === "live");
  const predictable = candidates.find((candidate) => normalizedStatus(candidate.fixture.status) === "scheduled"
    && (!candidate.fixture.startTime || asTime(candidate.fixture.startTime) > nowMs)
    && candidate.market?.freshness.fresh);
  const selected = resolved ?? live ?? predictable ?? candidates.find((candidate) => normalizedStatus(candidate.fixture.status) !== "finished") ?? candidates[0] ?? null;

  let editorial;
  if (resolved) {
    editorial = { kind: "result_available", authority: "official_match_state", fixture: fixtureSummary(resolved.fixture, resolved.market), prediction: resolved.prediction, sourceSnapshotIds: [], generatedAt: now.toISOString(), expiresAt: null };
  } else if (live) {
    editorial = { kind: "join_live_room", authority: "official_match_state", fixture: fixtureSummary(live.fixture, live.market), prediction: live.prediction, sourceSnapshotIds: [], generatedAt: now.toISOString(), expiresAt: null };
  } else if (predictable) {
    editorial = { kind: "predict_fixture", authority: "txline_fixture_market", fixture: fixtureSummary(predictable.fixture, predictable.market), prediction: predictable.prediction, sourceSnapshotIds: [predictable.market.snapshotId], generatedAt: now.toISOString(), expiresAt: predictable.fixture.startTime ?? predictable.market.freshness.staleAfter };
  } else {
    editorial = { kind: "open_calendar", authority: "official_match_state", fixture: selected ? fixtureSummary(selected.fixture, selected.market) : null, prediction: selected?.prediction ?? null, sourceSnapshotIds: [], generatedAt: now.toISOString(), expiresAt: null };
  }

  return {
    version: 1,
    tournament: {
      id: selected?.fixture?.competition?.canonicalCompetitionId || "unidentified-competition",
      name: selected?.fixture?.competitionLabel || "World Cup",
      status: live ? "active" : candidates.every((item) => normalizedStatus(item.fixture.status) === "finished") ? "finished" : "active",
      generatedAt: catalog?.generatedAt ?? now.toISOString(),
      primaryFixture: selected ? fixtureSummary(selected.fixture, selected.market) : null,
      outrightMarket: null,
    },
    player: player ? { ...player, fixturePrediction: selected?.prediction ?? null, miniLeagues } : null,
    editorial,
  };
}

export const homeProjectionInternals = { fixtureMarket, normalizedStatus, relevanceScore };
