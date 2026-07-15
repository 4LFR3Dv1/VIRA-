import crypto from "node:crypto";
import { canonicalSelectionId, cloneFrozen } from "./vira-picks-contracts.mjs";

const DEFAULT_OBSERVATION_FRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ACQUISITION_FRESH_MS = 2 * 60 * 1000;
export const PROVEN_MARKET_TYPES = Object.freeze({
  match_result: Object.freeze(["1X2_PARTICIPANT_RESULT"]),
  total_goals: Object.freeze(["OVERUNDER_PARTICIPANT_GOALS"]),
  both_teams_score: Object.freeze([]),
});
const EXPECTED_OPTIONS = Object.freeze({ match_result: ["home", "draw", "away"], total_goals: ["over", "under"], both_teams_score: ["yes", "no"] });

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function canonicalHash(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }

function configuredTypes(kind) { return PROVEN_MARKET_TYPES[kind] ?? Object.freeze([]); }

function regularTime(market) { return market.marketPeriod === null; }
function canonicalOption(kind, option) {
  const raw = String(option.priceName ?? "").toLowerCase();
  if (kind === "match_result") return raw === "part1" ? "home" : raw === "draw" ? "draw" : raw === "part2" ? "away" : null;
  if (kind === "total_goals") return raw === "over" || raw === "under" ? raw : null;
  if (kind === "both_teams_score") return raw === "yes" || raw === "no" ? raw : null;
  return null;
}
export function parseTxlineLineParameterV1(value) {
  if (typeof value !== "string") return null;
  const match = /^line=(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const parsed = Number(`${match[1]}${match[2] ? `.${match[2]}` : ""}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasExactOptions(kind, market) {
  const raw = Array.isArray(market.options) ? market.options : [];
  const expected = EXPECTED_OPTIONS[kind];
  if (raw.length !== expected.length) return false;
  const canonical = raw.map((option) => canonicalOption(kind, option));
  return canonical.every(Boolean) && new Set(canonical).size === expected.length && expected.every((name) => canonical.includes(name));
}
function endpointFor(context, market) {
  return Object.values(context?.endpoints ?? {}).find((item) => item?.endpoint === market.sourceEndpoint || String(item?.endpoint ?? "").includes(market.sourceEndpoint?.split("/").at(-2) ?? "__none__")) ?? null;
}

export function buildMarketSnapshotForSelection({ fixture, context, selection, now = Date.now(), freshMs = Number(process.env.VIRA_PICKS_MARKET_OBSERVATION_FRESH_MS || process.env.VIRA_PICKS_MARKET_FRESH_MS || DEFAULT_OBSERVATION_FRESH_MS), receivedFreshMs = Number(process.env.VIRA_PICKS_MARKET_ACQUISITION_FRESH_MS || DEFAULT_ACQUISITION_FRESH_MS) }) {
  const markets = Array.isArray(context?.availableMarkets) ? context.availableMarkets : [];
  const allowedTypes = configuredTypes(selection.kind);
  if (!allowedTypes.length) return { available: false, reason: "provider_market_type_unverified" };
  let candidates = markets.filter((market) => String(market.fixtureId) === String(fixture.fixtureId) && allowedTypes.includes(market.marketType) && regularTime(market) && !market.inRunning);
  if (selection.kind === "total_goals") candidates = candidates.filter((market) => market.marketParameters === "line=2.5" && parseTxlineLineParameterV1(market.marketParameters) === 2.5);
  if (!candidates.length) return { available: false, reason: "market_missing" };
  if (candidates.length !== 1) return { available: false, reason: "market_ambiguous" };
  const market = candidates[0];
  const endpoint = endpointFor(context, market);
  const observedAt = market.capturedAt; const receivedAt = endpoint?.receivedAt ?? null;
  if (!observedAt || !receivedAt) return { available: false, reason: "market_authority_insufficient" };
  if (endpoint.ok !== true) return { available: false, reason: "market_endpoint_unavailable" };
  const acquisitionAge = now - Date.parse(receivedAt);
  if (!Number.isFinite(acquisitionAge)) return { available: false, reason: "market_freshness_unknown" };
  if (acquisitionAge > receivedFreshMs || acquisitionAge < -60_000) return { available: false, reason: "market_acquisition_stale" };
  const observationAge = now - Date.parse(observedAt);
  if (!Number.isFinite(observationAge)) return { available: false, reason: "market_freshness_unknown" };
  if (observationAge > freshMs || observationAge < -60_000) return { available: false, reason: "market_stale" };
  if (!hasExactOptions(selection.kind, market)) return { available: false, reason: "market_options_invalid" };
  const options = EXPECTED_OPTIONS[selection.kind].map((canonical) => ({ canonical, option: market.options.find((item) => canonicalOption(selection.kind, item) === canonical) }));
  const expected = EXPECTED_OPTIONS[selection.kind];
  if (options.length !== expected.length) return { available: false, reason: "market_options_incomplete" };
  const body = {
    schemaVersion: 1, fixtureId: String(fixture.fixtureId), providerMarketId: String(market.messageId ?? market.id), marketSignature: String(market.signature), marketType: market.marketType,
    period: "regular_time", ...(selection.kind === "total_goals" ? { line: 2.5 } : {}),
    options: options.map(({ option, canonical }) => ({ optionId: String(option.priceName), canonicalSelection: canonical, ...(Number.isFinite(option.price) ? { price: Number(option.price) } : {}), ...(Number.isFinite(option.pct) ? { normalizedProbability: Number(option.pct) > 1 ? Number(option.pct) / 100 : Number(option.pct) } : {}) })),
    observedAt, receivedAt, ...(market.sequence !== null && market.sequence !== undefined ? { providerSequence: market.sequence } : {}), acquisitionOrigin: `txline:${market.sourceEndpoint ?? "odds"}`, freshness: "fresh",
  };
  const hash = canonicalHash(body);
  return { available: true, snapshot: cloneFrozen({ ...body, id: `market_${hash.slice(0, 24)}`, canonicalHash: hash }), selectionId: canonicalSelectionId(selection) };
}

export function buildPicksCatalog({ fixture, context, now = Date.now() }) {
  const templates = [
    { kind: "match_result", ids: ["match_result:home", "match_result:draw", "match_result:away"] },
    { kind: "total_goals", ids: ["total_goals:2.5:over", "total_goals:2.5:under"] },
  ];
  return templates.map((template) => {
    const selection = template.kind === "total_goals" ? { kind: template.kind, period: "regular_time", line: 2.5, selection: "over", resolverVersion: 1 } : { kind: template.kind, period: "regular_time", selection: template.kind === "match_result" ? "home" : "yes", resolverVersion: 1 };
    const result = buildMarketSnapshotForSelection({ fixture, context, selection, now });
    const options = template.ids.map((id) => ({ id, ...(result.available ? { consensus: result.snapshot.options.find((option) => id.endsWith(`:${option.canonicalSelection}`))?.normalizedProbability } : {}) }));
    return { kind: template.kind, available: result.available, ...(!result.available ? { unavailableReason: result.reason } : { observedAt: result.snapshot.observedAt }), options };
  });
}
