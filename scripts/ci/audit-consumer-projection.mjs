import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const target = String(value("--target", "https://vira.snelabs.space")).replace(/\/$/, "");
const output = path.resolve(value("--output", "artifacts/deployment-consumer-projection-audit.json"));
const expectedCommit = String(value("--commit", (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } })()));
const runId = `projection-audit-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
const startedAt = new Date().toISOString();
const violations = [];
const limitations = [];

function fail(scope, message, details = null) { violations.push({ scope, message, details }); }
function finiteNonNegative(value) { return Number.isFinite(Number(value)) && Number(value) >= 0; }
function iso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

async function request(route, options = {}) {
  const response = await fetch(`${target}${route}`, { ...options, signal: AbortSignal.timeout(40_000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`${route}:${response.status}:${typeof body === "string" ? body.slice(0, 160) : body?.error ?? "request_failed"}`);
  return { body, headers: Object.fromEntries(response.headers.entries()), status: response.status };
}

const publicHeaders = { "X-Vira-Locale": "pt-BR", "X-Vira-Time-Zone": "America/Sao_Paulo" };
const [rootResponse, readyResponse, catalogResponse, homeResponse] = await Promise.all([
  request("/"), request("/ready"), request("/matches/catalog"), request("/home", { headers: publicHeaders }),
]);
const ready = readyResponse.body;
const catalog = catalogResponse.body;
const home = homeResponse.body;
const bundleMatch = String(rootResponse.body).match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
const buildId = bundleMatch?.[1] ?? rootResponse.headers["x-build-id"] ?? `catalog:${catalog.generatedAt ?? "unknown"}`;

if (ready?.ok !== true) fail("ready", "deployment_not_ready");
if (catalog?.version !== 3) fail("catalog", "catalog_schema_mismatch", { expected: 3, actual: catalog?.version });
if (!Array.isArray(catalog?.matches) || catalog.matches.length === 0) fail("catalog", "catalog_empty");
if (!catalog?.featuredFixtureId || !catalog.matches?.some((entry) => String(entry.fixtureId) === String(catalog.featuredFixtureId))) fail("catalog", "featured_fixture_missing_or_foreign", { featuredFixtureId: catalog?.featuredFixtureId });
if (catalog?.cacheSource !== "server") fail("cache", "cache_source_not_server", { cacheSource: catalog?.cacheSource });
if (!iso(catalog?.generatedAt) || !iso(catalog?.cache?.generatedAt)) fail("cache", "cache_timestamp_invalid");
if (!finiteNonNegative(catalog?.cache?.ageMs)) fail("cache", "cache_age_invalid", { ageMs: catalog?.cache?.ageMs });

const exceptionalStatuses = new Set(["paused", "postponed", "cancelled", "unknown"]);
const observedExceptionalStatuses = new Set();
const fixtureResults = [];

for (const entry of catalog.matches ?? []) {
  const projection = entry.consumerProjection;
  const scope = `fixture:${entry.fixtureId}`;
  if (projection?.schemaVersion !== 1) { fail(scope, "projection_schema_mismatch", { actual: projection?.schemaVersion }); continue; }
  if (String(entry.fixtureId) !== String(projection.fixture?.fixtureId)) fail(scope, "fixture_id_diverged");
  if (String(entry.status) !== String(projection.fixture?.status)) fail(scope, "fixture_status_diverged", { entry: entry.status, projection: projection.fixture?.status });
  if ((entry.startTime ?? null) !== (projection.fixture?.kickoffAt ?? null)) fail(scope, "kickoff_diverged", { entry: entry.startTime, projection: projection.fixture?.kickoffAt });
  if (!iso(projection.temporal?.evaluatedAt) || !projection.temporal?.timeZone) fail(scope, "temporal_context_invalid");
  if (exceptionalStatuses.has(projection.fixture?.status)) {
    observedExceptionalStatuses.add(projection.fixture.status);
    if (projection.availability?.canPredict) fail(scope, "exceptional_status_can_predict");
    if (projection.availability?.canMakeDirectionalClaim) fail(scope, "exceptional_status_can_claim");
  }
  const market = projection.market?.canonical1X2;
  const freshness = projection.market?.freshness;
  if (market) {
    if (!market.signature) fail(scope, "canonical_signature_missing");
    if (![market.selections?.home, market.selections?.draw, market.selections?.away].every(finiteNonNegative)) fail(scope, "canonical_distribution_invalid");
    if (!market.observedAt || !iso(market.observedAt)) fail(scope, "canonical_observed_at_missing");
    if (market.observedAt && market.observedAt === projection.generatedAt) fail(scope, "observed_at_equals_projection_generated_at");
    if (market.observedAt && market.observedAt === projection.fixture?.kickoffAt) fail(scope, "observed_at_equals_kickoff_at");
  } else {
    if (projection.availability?.canPredict) fail(scope, "prediction_without_canonical_market");
    if (projection.availability?.canShowMarket) fail(scope, "display_without_canonical_market");
  }
  if (projection.availability?.canPredict && freshness?.usableForPrediction !== true) fail(scope, "prediction_without_freshness_authority");
  if (projection.availability?.canShowMarket && freshness?.currentForDisplay !== true) fail(scope, "display_without_freshness_authority");
  if (projection.availability?.canMakeDirectionalClaim && freshness?.currentForDirectionalClaim !== true) fail(scope, "claim_without_freshness_authority");
  if (entry.availability?.canPredict !== projection.availability?.canPredict || entry.availability?.canEnterRoom !== projection.availability?.canEnterRoom || entry.availability?.canShowMarket !== projection.availability?.canShowMarket || entry.availability?.canMakeDirectionalClaim !== projection.availability?.canMakeDirectionalClaim) fail(scope, "catalog_availability_diverged");

  let previewProjection = null;
  if (entry.context && entry.availability?.contextStatus !== "unavailable") {
    try {
      const context = (await request(`/matches/${encodeURIComponent(entry.fixtureId)}/txline-context`)).body;
      previewProjection = context.consumerProjection ?? null;
      if (JSON.stringify(previewProjection) !== JSON.stringify(projection)) fail(scope, "preview_projection_diverged");
    } catch (error) { fail(scope, "preview_context_request_failed", { error: error.message }); }
  }
  fixtureResults.push({ fixtureId: String(entry.fixtureId), status: projection.fixture.status, contextStatus: entry.availability?.contextStatus ?? null, projectionSchema: projection.schemaVersion, canonical1X2: Boolean(market), observedAt: market?.observedAt ?? null, kickoffAt: projection.fixture?.kickoffAt ?? null, freshnessReason: freshness?.reason ?? null, permissions: projection.availability, previewProjectionMatches: previewProjection ? JSON.stringify(previewProjection) === JSON.stringify(projection) : null });
}

for (const status of exceptionalStatuses) if (!observedExceptionalStatuses.has(status)) limitations.push(`No ${status} fixture was observable in the deployment catalog during this run; behavior remains covered by local contract tests only.`);
limitations.push("This read-only audit validates API contracts, not rendered browser output.");
limitations.push("Rejection of a persisted catalog schema v2 is covered locally and is not externally observable through the public API.");

const homeFixture = home?.editorial?.fixture ?? null;
const catalogHomeEntry = homeFixture ? catalog.matches?.find((entry) => String(entry.fixtureId) === String(homeFixture.fixtureId)) ?? null : null;
if (homeFixture && !catalogHomeEntry) fail("home", "home_fixture_missing_from_catalog", { fixtureId: homeFixture.fixtureId });
if (homeFixture && catalogHomeEntry) {
  const homeProjection = homeFixture.consumerProjection;
  const catalogProjection = catalogHomeEntry.consumerProjection;
  for (const [field, left, right] of [
    ["fixtureId", homeProjection?.fixture?.fixtureId, catalogProjection?.fixture?.fixtureId],
    ["status", homeProjection?.fixture?.status, catalogProjection?.fixture?.status],
    ["kickoffAt", homeProjection?.fixture?.kickoffAt, catalogProjection?.fixture?.kickoffAt],
    ["timeZone", homeProjection?.temporal?.timeZone, "America/Sao_Paulo"],
    ["relation", homeProjection?.temporal?.relation, catalogProjection?.temporal?.relation],
    ["observedAt", homeProjection?.market?.canonical1X2?.observedAt ?? null, catalogProjection?.market?.canonical1X2?.observedAt ?? null],
    ["selections", JSON.stringify(homeProjection?.market?.canonical1X2?.selections ?? null), JSON.stringify(catalogProjection?.market?.canonical1X2?.selections ?? null)],
    ["canPredict", homeProjection?.availability?.canPredict, catalogProjection?.availability?.canPredict],
    ["canEnterRoom", homeProjection?.availability?.canEnterRoom, catalogProjection?.availability?.canEnterRoom],
    ["canShowMarket", homeProjection?.availability?.canShowMarket, catalogProjection?.availability?.canShowMarket],
    ["canMakeDirectionalClaim", homeProjection?.availability?.canMakeDirectionalClaim, catalogProjection?.availability?.canMakeDirectionalClaim],
  ]) if (left !== right) fail("home", `home_catalog_${field}_diverged`, { home: left, catalog: right });
}

const report = {
  schemaVersion: 1,
  kind: "VIRA_DEPLOYMENT_CONSUMER_PROJECTION_AUDIT",
  runId,
  target,
  commit: expectedCommit,
  buildId,
  startedAt,
  finishedAt: new Date().toISOString(),
  readOnly: true,
  passed: violations.length === 0,
  summary: { catalogSchema: catalog?.version ?? null, projectionSchema: 1, fixturesChecked: fixtureResults.length, homeFixtureId: homeFixture?.fixtureId ?? null, featuredFixtureId: catalog?.featuredFixtureId ?? null, exceptionalStatusesObserved: [...observedExceptionalStatuses] },
  invariants: { schemaValid: catalog?.version === 3 && fixtureResults.every((item) => item.projectionSchema === 1), cacheCompatible: catalog?.version === 3 && catalog?.cacheSource === "server", statusesPreserved: !violations.some((item) => item.message.includes("status")), canonicalMarketValid: !violations.some((item) => item.message.includes("canonical") || item.message.includes("distribution")), freshnessValid: !violations.some((item) => item.message.includes("freshness")), timestampsSeparated: !violations.some((item) => item.message.includes("observed_at") || item.message.includes("kickoff")), surfacesAgree: !violations.some((item) => item.scope === "home" || item.message.includes("preview_projection")) },
  fixtures: fixtureResults,
  violations,
  limitations,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
