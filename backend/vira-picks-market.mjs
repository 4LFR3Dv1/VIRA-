import crypto from "node:crypto";
import { canonicalSelectionId, cloneFrozen } from "./vira-picks-contracts.mjs";

const DEFAULT_FRESH_MS = 5 * 60 * 1000;
const PROVEN_MARKET_TYPES = Object.freeze({ match_result: ["1X2_PARTICIPANT_RESULT"], total_goals: [], both_teams_score: [] });
const EXPECTED_OPTIONS = Object.freeze({ match_result: ["home", "draw", "away"], total_goals: ["over", "under"], both_teams_score: ["yes", "no"] });

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function canonicalHash(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }

function configuredTypes(kind, env = process.env) {
  const key = kind === "total_goals" ? "VIRA_PICKS_TOTAL_GOALS_MARKET_TYPES" : kind === "both_teams_score" ? "VIRA_PICKS_BTTS_MARKET_TYPES" : null;
  if (!key) return PROVEN_MARKET_TYPES[kind];
  return String(env[key] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function regularTime(market) { return market.marketPeriod === null || market.marketPeriod === undefined || market.marketPeriod === "" || market.marketPeriod === "regular_time"; }
function canonicalOption(kind, option) {
  const raw = String(option.priceName ?? "").toLowerCase();
  if (kind === "match_result") return raw === "part1" ? "home" : raw === "draw" ? "draw" : raw === "part2" ? "away" : null;
  if (kind === "total_goals") return raw === "over" || raw === "under" ? raw : null;
  if (kind === "both_teams_score") return raw === "yes" || raw === "no" ? raw : null;
  return null;
}
function lineOf(market) { const value = Number(market.marketParameters); return Number.isFinite(value) ? value : null; }
function receivedAtFor(context, market) {
  const endpoint = Object.values(context?.endpoints ?? {}).find((item) => item?.endpoint === market.sourceEndpoint || String(item?.endpoint ?? "").includes(market.sourceEndpoint?.split("/").at(-2) ?? "__none__"));
  return endpoint?.receivedAt ?? context?.generatedAt ?? null;
}

export function buildMarketSnapshotForSelection({ fixture, context, selection, now = Date.now(), freshMs = Number(process.env.VIRA_PICKS_MARKET_FRESH_MS || DEFAULT_FRESH_MS), env = process.env }) {
  const markets = Array.isArray(context?.availableMarkets) ? context.availableMarkets : [];
  const allowedTypes = configuredTypes(selection.kind, env);
  if (!allowedTypes.length) return { available: false, reason: "provider_market_type_unverified" };
  let candidates = markets.filter((market) => String(market.fixtureId) === String(fixture.fixtureId) && allowedTypes.includes(market.marketType) && regularTime(market) && !market.inRunning);
  if (selection.kind === "total_goals") candidates = candidates.filter((market) => lineOf(market) === 2.5);
  if (!candidates.length) return { available: false, reason: "market_missing" };
  if (candidates.length !== 1) return { available: false, reason: "market_ambiguous" };
  const market = candidates[0];
  const observedAt = market.capturedAt; const receivedAt = receivedAtFor(context, market);
  if (!observedAt || !receivedAt) return { available: false, reason: "market_authority_insufficient" };
  const age = now - Date.parse(observedAt);
  if (!Number.isFinite(age)) return { available: false, reason: "market_freshness_unknown" };
  if (age > freshMs || age < -60_000) return { available: false, reason: "market_stale" };
  const options = (market.options ?? []).map((option) => ({ option, canonical: canonicalOption(selection.kind, option) })).filter((item) => item.canonical);
  const expected = EXPECTED_OPTIONS[selection.kind];
  if (options.length !== expected.length || !expected.every((name) => options.some((item) => item.canonical === name))) return { available: false, reason: "market_options_incomplete" };
  const body = {
    schemaVersion: 1, fixtureId: String(fixture.fixtureId), providerMarketId: String(market.messageId ?? market.id), marketSignature: String(market.signature), marketType: market.marketType,
    period: "regular_time", ...(selection.kind === "total_goals" ? { line: 2.5 } : {}),
    options: options.map(({ option, canonical }) => ({ optionId: String(option.priceName), canonicalSelection: canonical, ...(Number.isFinite(option.price) ? { price: Number(option.price) } : {}), ...(Number.isFinite(option.pct) ? { normalizedProbability: Number(option.pct) > 1 ? Number(option.pct) / 100 : Number(option.pct) } : {}) })),
    observedAt, receivedAt, ...(market.sequence !== null && market.sequence !== undefined ? { providerSequence: market.sequence } : {}), acquisitionOrigin: `txline:${market.sourceEndpoint ?? "odds"}`, freshness: "fresh",
  };
  const hash = canonicalHash(body);
  return { available: true, snapshot: cloneFrozen({ ...body, id: `market_${hash.slice(0, 24)}`, canonicalHash: hash }), selectionId: canonicalSelectionId(selection) };
}

export function buildPicksCatalog({ fixture, context, now = Date.now(), env = process.env }) {
  const templates = [
    { kind: "match_result", ids: ["match_result:home", "match_result:draw", "match_result:away"] },
    { kind: "total_goals", ids: ["total_goals:2.5:over", "total_goals:2.5:under"] },
    { kind: "both_teams_score", ids: ["both_teams_score:yes", "both_teams_score:no"] },
  ];
  return templates.map((template) => {
    const selection = template.kind === "total_goals" ? { kind: template.kind, period: "regular_time", line: 2.5, selection: "over", resolverVersion: 1 } : { kind: template.kind, period: "regular_time", selection: template.kind === "match_result" ? "home" : "yes", resolverVersion: 1 };
    const result = buildMarketSnapshotForSelection({ fixture, context, selection, now, env });
    const options = template.ids.map((id) => ({ id, ...(result.available ? { consensus: result.snapshot.options.find((option) => id.endsWith(`:${option.canonicalSelection}`))?.normalizedProbability } : {}) }));
    return { kind: template.kind, available: result.available, ...(!result.available ? { unavailableReason: result.reason } : { observedAt: result.snapshot.observedAt }), options };
  });
}
