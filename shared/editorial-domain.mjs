export const DEFAULT_EDITORIAL_LOCALE = "pt-BR";
export const DEFAULT_EDITORIAL_TIME_ZONE = "America/Sao_Paulo";
export const DEFAULT_PROMOTION_WINDOW_HOURS = 48;

export function validTimeZone(value) {
  try { new Intl.DateTimeFormat("en", { timeZone: String(value) }).format(); return true; } catch { return false; }
}

export function resolveEditorialLocaleContext(input = {}) {
  const requestedTimeZone = String(input.timeZone ?? "");
  const requestedLocale = String(input.locale ?? "").trim();
  return {
    locale: requestedLocale || DEFAULT_EDITORIAL_LOCALE,
    timeZone: validTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_EDITORIAL_TIME_ZONE,
    source: ["campaign", "room", "share_creator", "viewer"].includes(input.source) ? input.source : "default",
  };
}

function civilParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function civilDayNumber(parts) { return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86_400_000); }

export function deriveFixtureTemporalContext(fixture, { evaluatedAt = new Date().toISOString(), localeContext = resolveEditorialLocaleContext() } = {}) {
  const kickoffAt = fixture?.startTime ?? fixture?.kickoffAt ?? null;
  const status = String(fixture?.status ?? "scheduled").toLowerCase();
  const base = { kickoffAt, evaluatedAt: new Date(evaluatedAt).toISOString(), timeZone: localeContext.timeZone, locale: localeContext.locale, localeSource: localeContext.source };
  if (!kickoffAt || !Number.isFinite(Date.parse(kickoffAt))) return { ...base, relation: status === "live" ? "live" : status === "finished" ? "finished" : "unknown", localKickoffDate: null, localKickoffTime: null, calendarDaysUntilKickoff: null, minutesUntilKickoff: null };
  const kickoff = civilParts(kickoffAt, localeContext.timeZone);
  const evaluated = civilParts(evaluatedAt, localeContext.timeZone);
  const calendarDaysUntilKickoff = civilDayNumber(kickoff) - civilDayNumber(evaluated);
  const minutesUntilKickoff = Math.floor((Date.parse(kickoffAt) - Date.parse(evaluatedAt)) / 60_000);
  const relation = status === "live" ? "live" : status === "finished" ? "finished" : calendarDaysUntilKickoff === 0 ? "today" : calendarDaysUntilKickoff === 1 ? "tomorrow" : calendarDaysUntilKickoff > 1 && calendarDaysUntilKickoff <= 6 ? "later_this_week" : "future";
  return { ...base, relation, localKickoffDate: `${kickoff.day}/${kickoff.month}/${kickoff.year}`, localKickoffTime: `${kickoff.hour}:${kickoff.minute}`, calendarDaysUntilKickoff, minutesUntilKickoff };
}

export function deriveMarketFreshness({ observedAt, receivedAt = observedAt, evaluatedAt = new Date().toISOString(), kickoffAt = null, contextAvailable = true, distributionValid = true }) {
  const observedMs = Date.parse(String(observedAt ?? ""));
  const evaluatedMs = Date.parse(evaluatedAt);
  const kickoffMs = Date.parse(String(kickoffAt ?? ""));
  const ageSeconds = Number.isFinite(observedMs) ? Math.max(0, Math.floor((evaluatedMs - observedMs) / 1000)) : null;
  const beforeKickoff = !Number.isFinite(kickoffMs) || kickoffMs > evaluatedMs;
  const usableForPrediction = Boolean(contextAvailable && distributionValid && Number.isFinite(observedMs) && observedMs <= evaluatedMs && beforeKickoff);
  const currentForDisplay = usableForPrediction && ageSeconds <= 6 * 60 * 60;
  const currentForDirectionalClaim = currentForDisplay && ageSeconds <= 15 * 60;
  const reason = !Number.isFinite(observedMs) ? "missing_timestamp" : currentForDirectionalClaim ? "fresh" : currentForDisplay ? "display_only" : usableForPrediction ? "prediction_only" : "stale";
  return { observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null, receivedAt: Number.isFinite(Date.parse(String(receivedAt ?? ""))) ? new Date(receivedAt).toISOString() : null, evaluatedAt: new Date(evaluatedAt).toISOString(), usableForPrediction, currentForDisplay, currentForDirectionalClaim, ageSeconds, reason, staleAfter: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null };
}

export function deriveFixtureEditorialEligibility({ fixture, market, temporal, promotionWindowHours = DEFAULT_PROMOTION_WINDOW_HOURS }) {
  const predictionOpen = String(fixture?.status ?? "scheduled").toLowerCase() === "scheduled" && Number(temporal?.minutesUntilKickoff) > 0;
  const kickoffKnown = Boolean(temporal?.kickoffAt && temporal.relation !== "unknown");
  const insidePromotionWindow = kickoffKnown && temporal.minutesUntilKickoff <= promotionWindowHours * 60;
  const competitionEligible = fixture?.competition?.kind !== "unidentified";
  const marketUsable = market?.freshness?.usableForPrediction === true;
  const reasons = [];
  if (!predictionOpen) reasons.push("prediction_closed");
  if (!competitionEligible) reasons.push("competition_ineligible");
  if (!marketUsable) reasons.push("market_unusable");
  if (!kickoffKnown) reasons.push("kickoff_unknown");
  if (!insidePromotionWindow) reasons.push("outside_promotion_window");
  return { eligible: reasons.length === 0, predictionOpen, competitionEligible, marketUsable, kickoffKnown, insidePromotionWindow, reasons };
}

export function rankEligibleFixture({ fixture, market, temporal, prediction = null }) {
  let score = 0; const reasons = [];
  if (fixture?.competition?.kind === "world_cup") { score += 500; reasons.push("world_cup"); }
  const temporalWeight = temporal.relation === "today" ? 400 : temporal.relation === "tomorrow" ? 220 : temporal.relation === "later_this_week" ? 80 : 20;
  score += temporalWeight; reasons.push(`temporal:${temporal.relation}`);
  if (market?.freshness?.currentForDirectionalClaim) { score += 180; reasons.push("directional_market_fresh"); }
  else if (market?.freshness?.currentForDisplay) { score += 80; reasons.push("market_display_fresh"); }
  if (prediction?.status === "open") { score += 140; reasons.push("player_prediction_open"); }
  score -= Math.min(Math.max(Number(temporal.minutesUntilKickoff) || 0, 0) / 10, 200);
  return { score, reasons };
}

export function fixturePredictionCopy({ temporalRelation, homeTeam, awayTeam, market = null }) {
  const headline = temporalRelation === "today" ? "Quem vence hoje?" : temporalRelation === "tomorrow" ? "Quem vence amanhã?" : temporalRelation === "live" ? "Quem vence esta partida?" : `Quem vence ${homeTeam} x ${awayTeam}?`;
  const scheduleLabel = temporalRelation === "today" ? "Hoje" : temporalRelation === "tomorrow" ? "Amanhã" : "Próxima partida";
  let marketStatement = "O placar oficial decide.";
  if (market?.freshness?.currentForDirectionalClaim) marketStatement = market.leadingChoice === "draw" ? "O empate lidera o mercado atual desta partida. O placar oficial decide." : `O mercado atual favorece ${market.leadingLabel}. O placar oficial decide.`;
  else if (market?.freshness?.currentForDisplay) marketStatement = "Último mercado TxLINE observado. O placar oficial decide.";
  return { copyIntent: "fixture_prediction", headline, scheduleLabel, marketStatement };
}
