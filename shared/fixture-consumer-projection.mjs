import {
  deriveFixtureEditorialEligibility,
  deriveFixtureTemporalContext,
  deriveMarketFreshness,
  rankEligibleFixture,
  resolveEditorialLocaleContext,
} from "./editorial-domain.mjs";

const KNOWN_STATUSES = new Set(["scheduled", "live", "paused", "postponed", "cancelled", "finished", "unknown"]);

export function canonicalFixtureStatus(value) {
  const status = String(value ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
  if (["live", "in_play", "inplay", "playing", "running", "started", "active"].includes(status)) return "live";
  if (["finished", "final", "ended", "completed", "complete", "closed", "ft", "full_time", "match_end"].includes(status)) return "finished";
  if (["scheduled", "not_started", "pre_match", "prematch", "upcoming"].includes(status)) return "scheduled";
  if (["paused", "half_time", "halftime"].includes(status)) return "paused";
  if (["postponed", "delayed", "suspended"].includes(status)) return "postponed";
  if (["cancelled", "canceled", "abandoned"].includes(status)) return "cancelled";
  return KNOWN_STATUSES.has(status) ? status : "unknown";
}

function competitionProjection(competition = {}, fallbackLabel = "Competicao") {
  return {
    providerCompetitionId: competition.providerCompetitionId ?? null,
    canonicalCompetitionId: competition.canonicalCompetitionId ?? null,
    displayName: competition.displayName ?? fallbackLabel,
    kind: competition.kind ?? "unknown",
    authority: competition.authority ?? "unmapped",
    mapped: competition.mapped === true,
  };
}

function teamProjection(name, providerId = null, shortName = null) {
  return { providerId, name: String(name ?? ""), shortName: shortName ? String(shortName) : null };
}

function unavailableFreshness(evaluatedAt, reason = "unavailable") {
  return { evaluatedAt, ageSeconds: null, usableForPrediction: false, currentForDisplay: false, currentForDirectionalClaim: false, reason };
}

function marketProjection(fixture, context, evaluatedAt) {
  const canonical = context?.canonical1X2;
  if (!canonical) return { canonical1X2: null, freshness: unavailableFreshness(evaluatedAt, "unavailable") };
  const selections = {
    home: Number(canonical.selections?.home),
    draw: Number(canonical.selections?.draw),
    away: Number(canonical.selections?.away),
  };
  const valid = Object.values(selections).every((value) => Number.isFinite(value) && value >= 0);
  const observedAt = canonical.observedAt ?? null;
  const receivedAt = context?.generatedAt ?? context?.cache?.cachedAt ?? null;
  const freshness = deriveMarketFreshness({
    observedAt,
    receivedAt,
    evaluatedAt,
    kickoffAt: fixture.startTime ?? null,
    contextAvailable: Boolean(context) && fixture?.availability?.contextStatus !== "unavailable",
    distributionValid: valid,
  });
  if (!valid) return { canonical1X2: null, freshness: { ...freshness, usableForPrediction: false, currentForDisplay: false, currentForDirectionalClaim: false, reason: "unavailable" } };
  const values = [selections.home, selections.draw, selections.away];
  const leadingChoice = ["home", "draw", "away"][values.indexOf(Math.max(...values))];
  return {
    canonical1X2: {
      authority: "txline_fixture_market",
      signature: String(canonical.marketSignature ?? ""),
      snapshotId: canonical.snapshotId ?? null,
      providerSequence: Number.isFinite(Number(canonical.providerSequence)) ? Number(canonical.providerSequence) : null,
      observedAt: freshness.observedAt,
      receivedAt: freshness.receivedAt,
      selections,
      leadingChoice,
    },
    freshness: {
      evaluatedAt: freshness.evaluatedAt,
      ageSeconds: freshness.ageSeconds,
      usableForPrediction: freshness.usableForPrediction,
      currentForDisplay: freshness.currentForDisplay,
      currentForDirectionalClaim: freshness.currentForDirectionalClaim,
      reason: freshness.reason,
    },
  };
}

function availabilityFor(status, temporal, market, competition) {
  const eligibility = deriveFixtureEditorialEligibility({ fixture: { status, competition }, market, temporal });
  const competitionCanFeature = !["unknown", "unidentified"].includes(String(competition?.kind ?? "unknown"));
  const futureFixtureCanFeature = status === "scheduled"
    && Boolean(temporal?.kickoffAt)
    && Number(temporal?.minutesUntilKickoff) > 0
    && competitionCanFeature;
  const canFeature = status === "live" || status === "paused" || futureFixtureCanFeature;
  const roomMode = status === "finished" ? "read_only" : status === "live" || status === "paused" ? "live" : status === "scheduled" ? "pre_match" : "unavailable";
  const canEnterRoom = roomMode !== "unavailable";
  const canShowMarket = market.canonical1X2 !== null && market.freshness.currentForDisplay;
  const canMakeDirectionalClaim = canShowMarket && market.freshness.currentForDirectionalClaim;
  const canPredict = status === "scheduled" && eligibility.eligible;
  let reason = "available";
  if (status === "live") reason = "fixture_live";
  else if (status === "finished") reason = "fixture_finished";
  else if (status === "paused") reason = "fixture_paused";
  else if (status === "postponed") reason = "fixture_postponed";
  else if (status === "cancelled") reason = "fixture_cancelled";
  else if (status === "unknown") reason = "fixture_unknown";
  else if (!market.canonical1X2) reason = "market_missing";
  else if (!market.freshness.usableForPrediction) reason = "market_stale";
  else if (!eligibility.insidePromotionWindow) reason = "outside_prediction_window";
  const featureReason = status === "live" || status === "paused" ? "fixture_active"
    : futureFixtureCanFeature ? (canPredict ? "prediction_open" : "upcoming_fixture")
      : status === "finished" ? "fixture_finished" : "fixture_not_featureable";
  return { canFeature, featureReason, canPredict, canEnterRoom, roomMode, canShowMarket, canMakeDirectionalClaim, reason, eligibility };
}

function editorialFor(status, temporal, market, availability, fixture, prediction = null) {
  const rank = availability.eligibility.eligible
    ? rankEligibleFixture({ fixture: { ...fixture, status }, market, temporal, prediction })
    : { score: status === "live" ? 10_000 : status === "finished" ? -100 : -Infinity, reasons: status === "live" ? ["fixture_live"] : [] };
  const headlineIntent = status === "live" ? "match_live"
    : status === "finished" ? "match_finished"
      : status !== "scheduled" ? "fixture_unavailable"
        : temporal.relation === "today" ? "who_wins_today"
          : temporal.relation === "tomorrow" ? "who_wins_tomorrow"
            : "who_wins_fixture";
  const scheduleIntent = temporal.relation === "live" ? "live"
    : temporal.relation === "today" ? "today"
      : temporal.relation === "tomorrow" ? "tomorrow"
        : temporal.relation === "finished" ? "finished"
          : temporal.relation === "unknown" ? "to_be_confirmed"
            : "scheduled_date";
  const marketStatementIntent = availability.canMakeDirectionalClaim ? "directional_current"
    : availability.canShowMarket ? "last_observed"
      : "market_unavailable";
  return { priority: rank.score, priorityReasons: rank.reasons, headlineIntent, scheduleIntent, marketStatementIntent };
}

export function deriveFixtureConsumerProjection({ fixture, txlineContext = fixture?.context ?? null, evaluatedAt = new Date().toISOString(), localeContext: requestedLocaleContext = null, prediction = null } = {}) {
  const generatedAt = new Date(evaluatedAt).toISOString();
  const localeContext = resolveEditorialLocaleContext(requestedLocaleContext ?? {});
  const status = canonicalFixtureStatus(fixture?.status);
  const normalizedFixture = { ...fixture, status };
  const temporal = deriveFixtureTemporalContext(normalizedFixture, { evaluatedAt: generatedAt, localeContext });
  const competition = competitionProjection(fixture?.competition, fixture?.competitionLabel);
  const market = marketProjection(normalizedFixture, txlineContext, generatedAt);
  const availability = availabilityFor(status, temporal, market, competition);
  const projectedFixture = {
    fixtureId: String(fixture?.fixtureId ?? fixture?.id ?? "unknown-fixture"),
    homeTeam: teamProjection(fixture?.homeTeam, fixture?.homeTeamId, fixture?.homeTeamShortName),
    awayTeam: teamProjection(fixture?.awayTeam, fixture?.awayTeamId, fixture?.awayTeamShortName),
    competition,
    status,
    kickoffAt: temporal.kickoffAt,
  };
  const editorial = editorialFor(status, temporal, market, availability, { ...normalizedFixture, competition }, prediction);
  const { eligibility: _eligibility, ...publicAvailability } = availability;
  return {
    schemaVersion: 1,
    generatedAt,
    fixture: projectedFixture,
    temporal: {
      evaluatedAt: temporal.evaluatedAt,
      timeZone: temporal.timeZone,
      relation: temporal.relation,
      localKickoffDate: temporal.localKickoffDate,
      localKickoffTime: temporal.localKickoffTime,
    },
    market,
    availability: publicAvailability,
    editorial,
  };
}

export function rankFixtureConsumerProjections(projections) {
  return [...projections].sort((left, right) => {
    const tier = (projection) => {
      const status = projection.fixture.status;
      if (status === "live") return 6;
      if (status === "paused") return 5;
      if (status === "scheduled" && projection.availability.canPredict) return 4;
      if (status === "scheduled" && projection.availability.canFeature) return 3;
      if (status === "finished") return 2;
      return 1;
    };
    const tierDifference = tier(right) - tier(left);
    if (tierDifference) return tierDifference;
    const priority = Number(right.editorial.priority) - Number(left.editorial.priority);
    if (Number.isFinite(priority) && priority) return priority;
    const worldCup = Number(right.fixture.competition?.kind === "world_cup") - Number(left.fixture.competition?.kind === "world_cup");
    if (worldCup) return worldCup;
    const leftKickoff = Date.parse(left.fixture.kickoffAt ?? "") || Number.POSITIVE_INFINITY;
    const rightKickoff = Date.parse(right.fixture.kickoffAt ?? "") || Number.POSITIVE_INFINITY;
    return leftKickoff - rightKickoff || left.fixture.fixtureId.localeCompare(right.fixture.fixtureId);
  });
}
