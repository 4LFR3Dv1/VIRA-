import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { loadLocalEnv } from "./env.mjs";
import { createFileEventStore } from "./event-store.mjs";
import { deriveHomeProjection } from "./home-projection.mjs";
import { createRoomRuntime } from "./runtime.mjs";
import { createSolanaCommitmentPublisherFromEnv } from "./solana-commitment-publisher.mjs";
import { createShareStore } from "./share-store.mjs";
import { createViraPicksStore } from "./vira-picks-store.mjs";
import { buildMarketSnapshotForSelection, buildPicksCatalog } from "./vira-picks-market.mjs";
import { selectionFromCanonicalId } from "./vira-picks-contracts.mjs";
import { createCompanionSubscriptionStore } from "./companion-subscription-store.mjs";
import { createWebPushPublisherFromEnv } from "./web-push-publisher.mjs";
import { createAttentionOrchestrator } from "./attention-orchestrator.mjs";
import { renderSharePng } from "./share-image-png.mjs";
import { renderShareSvg } from "./share-image-svg.mjs";
import { renderSharePage } from "./share-page.mjs";
import { txlineCapabilities } from "./txline-endpoints.mjs";
import { buildTxlineContext } from "./txline-context.mjs";
import { discoverTxlineFixtures } from "./txline-discovery.mjs";
import {
  applyFixtureLifecycleTimeout,
  fetchFixturesSnapshot,
  fetchHistoricalScores,
  fetchOddsSnapshot,
  fetchScoresSnapshot,
  fetchScoresUpdates,
  hasTxlineCredentials,
  normalizeTxlineFixture,
  normalizeTxlineOdds,
  normalizeTxlineScore,
  startGuestSession,
  txlineConfigFromEnv,
} from "./txline-client.mjs";
import { createTxlineStreamManager } from "./txline-stream.mjs";
import { planScoreUpdateReconciliation } from "./txline-score-reconciler.mjs";
import { createTxlineCatalogCache } from "./txline-catalog-cache.mjs";
import { ensureVerifiedPlayback, verifiedPlaybackIds } from "./verified-playback-seed.mjs";
import { deriveFixtureTemporalContext, resolveEditorialLocaleContext } from "../shared/editorial-domain.mjs";
import { predictionShareCopy, roomShareCopy, shareChoiceLabel } from "../shared/share-copy.mjs";
import { authorizeE2eRequest, e2eModeFromEnv } from "./e2e-mode.mjs";

loadLocalEnv();
const e2eMode = e2eModeFromEnv();

const eventStore = await createFileEventStore();
const shareStore = await createShareStore();
const picksStore = await createViraPicksStore();
const companionSubscriptionStore = await createCompanionSubscriptionStore();
const commitmentPublisher = createSolanaCommitmentPublisherFromEnv();
const runtime = createRoomRuntime({ eventStore, commitmentPublisher });
const webPushPublisher = createWebPushPublisherFromEnv();
const attentionOrchestrator = createAttentionOrchestrator({ runtime, store: companionSubscriptionStore, publisher: webPushPublisher });
const runtimeBoot = {
  liveness: true,
  readiness: false,
  mode: "booting",
  rehydratedAt: null,
  rehydrateError: null,
};
try {
  const rehydration = await runtime.rehydrateFromLedger();
  const playback = String(process.env.VIRA_VERIFIED_PLAYBACK_ENABLED ?? "true").toLowerCase() === "true"
    ? await ensureVerifiedPlayback({ eventStore, runtime })
    : { disabled: true };
  runtimeBoot.readiness = true;
  runtimeBoot.mode = "ready";
  runtimeBoot.rehydratedAt = new Date().toISOString();
  runtimeBoot.rehydration = rehydration;
  runtimeBoot.playback = playback;
} catch (error) {
  runtimeBoot.readiness = false;
  runtimeBoot.mode = "integrity_failure";
  runtimeBoot.rehydrateError = error.message || "rehydration_failed";
  console.error("VIRA runtime failed to rehydrate ledger", error);
}
const txlineConfig = txlineConfigFromEnv();
const txlineStreams = createTxlineStreamManager({ config: txlineConfig, runtime });
const port = Number(process.env.PORT || 8787);
const configuredRoomIds = new Set();
const scoreHydratedRoomIds = new Set();
const txlineContextCache = new Map();
const TXLINE_CONTEXT_CACHE_TTL_MS = 30_000;
const TXLINE_ROOM_POLL_MS = Number(process.env.TXLINE_ROOM_POLL_MS || 10_000);
const liveRoomFeeds = new Map();
const internalIngestEnabled = String(process.env.VIRA_INTERNAL_INGEST_ENABLED || "false").toLowerCase() === "true";
const requireTxlineCredentials = String(process.env.VIRA_REQUIRE_TXLINE_CREDENTIALS || "false").toLowerCase() === "true";
const adminToken = String(process.env.VIRA_ADMIN_TOKEN || "");
const picksEnabled = String(process.env.VIRA_PICKS_ENABLED || "false").toLowerCase() === "true";
const picksRejections = { marketUnavailable: 0, deadline: 0 };
const allowedOrigins = new Set(String(process.env.VIRA_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean));
const distDirectory = path.resolve(process.env.VIRA_DIST_DIR || fileURLToPath(new URL("../dist/", import.meta.url)));
const staticMimeTypes = new Map([[".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"], [".woff2", "font/woff2"]]);
let eventLoopLagMs = 0;
let lagProbeAt = Date.now();
const lagProbe = setInterval(() => { const now = Date.now(); eventLoopLagMs = Math.max(0, now - lagProbeAt - 1_000); lagProbeAt = now; }, 1_000);
lagProbe.unref?.();
const picksLockProbe = picksEnabled ? setInterval(() => { void picksStore.lockDueCards().catch(() => undefined); }, 1_000) : null;
picksLockProbe?.unref?.();

function cryptoRandomId() {
  return randomUUID().slice(0, 8);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": response.viraCorsOrigin || "http://localhost:5173",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Last-Event-ID, X-Vira-Public-Token, X-Vira-Locale, X-Vira-Time-Zone",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, body, cacheControl = "no-cache") {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheControl });
  response.end(body);
}

function sendSvg(response, body) {
  response.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300, stale-while-revalidate=86400" });
  response.end(body);
}

function sendPng(response, body) {
  response.writeHead(200, { "Content-Type": "image/png", "Content-Length": body.length, "Cache-Control": "public, max-age=31536000, immutable" });
  response.end(body);
}

function publicToken(request, body = {}) {
  return String(request.headers["x-vira-public-token"] ?? body.publicToken ?? "");
}

function publicBaseUrl(request) {
  const host = String(request.headers.host ?? "");
  const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
  const protocol = String(request.headers["x-forwarded-proto"] || (loopback ? "http" : "https")).split(",")[0];
  return `${protocol}://${host}`;
}

function requestEditorialLocale(request, source = "viewer") {
  return resolveEditorialLocaleContext({ locale: request.headers["x-vira-locale"], timeZone: request.headers["x-vira-time-zone"], source });
}

function predictionEditorialContext(fixture, request) {
  const localeContext = requestEditorialLocale(request, "share_creator");
  const temporal = deriveFixtureTemporalContext(fixture, { evaluatedAt: new Date().toISOString(), localeContext });
  return {
    locale: localeContext.locale,
    timeZone: localeContext.timeZone,
    source: localeContext.source,
    kickoffAt: fixture.startTime ?? null,
    temporalRelationAtCreation: temporal.relation,
    localKickoffDate: temporal.localKickoffDate,
    localKickoffTime: temporal.localKickoffTime,
    evaluatedAt: temporal.evaluatedAt,
  };
}


function safeTokenEqual(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

async function serveFrontend(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(distDirectory, requested);
  const relativeCandidate = path.relative(distDirectory, candidate);
  const insideDist = relativeCandidate === "" || (!relativeCandidate.startsWith("..") && !path.isAbsolute(relativeCandidate));
  if (!insideDist) return false;
  let filePath = candidate;
  try {
    if (!(await stat(filePath)).isFile()) throw new Error("static_file_not_found");
  } catch {
    if (path.extname(requested)) return false;
    filePath = path.join(distDirectory, "index.html");
  }
  try {
    const body = await readFile(filePath);
    const isServiceWorker = path.basename(filePath) === "sw.js";
    response.writeHead(200, {
      "Content-Type": staticMimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": path.basename(filePath) === "index.html" || isServiceWorker ? "no-cache" : "public, max-age=31536000, immutable",
      ...(isServiceWorker ? { "Service-Worker-Allowed": "/" } : {}),
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

function requireInternalAdmin(request) {
  if (!internalIngestEnabled) {
    const error = new Error("internal_ingest_disabled");
    error.status = 403;
    throw error;
  }
  const token = request.headers["x-vira-admin-token"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!adminToken || !safeTokenEqual(token, adminToken)) {
    const error = new Error("admin_auth_required");
    error.status = 401;
    throw error;
  }
}

function ensureReady() {
  if (runtimeBoot.readiness) return;
  const error = new Error("runtime_not_ready");
  error.status = 503;
  error.body = {
    mode: runtimeBoot.mode,
    rehydrateError: runtimeBoot.rehydrateError,
  };
  throw error;
}

async function readJson(request, maxBytes = Number.POSITIVE_INFINITY) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error("payload_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function roomRoute(pathname) {
  const match = pathname.match(/^\/rooms\/([^/]+)(?:\/(.+))?$/);
  if (!match) return null;
  return {
    roomId: decodeURIComponent(match[1]),
    rest: match[2] || "",
  };
}

function latestTxlineRecord(records) {
  if (!Array.isArray(records) || !records.length) return null;
  return [...records]
    .filter((record) => record && typeof record === "object")
    .sort((left, right) => {
      const leftSeq = Number(left.Seq ?? left.seq ?? left.Sequence ?? left.sequence ?? -1);
      const rightSeq = Number(right.Seq ?? right.seq ?? right.Sequence ?? right.sequence ?? -1);
      if (Number.isFinite(leftSeq) && Number.isFinite(rightSeq) && leftSeq !== rightSeq) return rightSeq - leftSeq;
      return Number(right.Ts ?? right.ts ?? 0) - Number(left.Ts ?? left.ts ?? 0);
    })[0] ?? null;
}

function txlineMarketSignature(record) {
  const priceNames = Array.isArray(record?.PriceNames) ? record.PriceNames.map(String).join("/") : "";
  return [
    record?.FixtureId ?? "",
    record?.SuperOddsType ?? "UNKNOWN_MARKET",
    record?.MarketParameters ?? "default",
    record?.MarketPeriod ?? "match",
    priceNames,
    record?.BookmakerId ?? record?.Bookmaker ?? "TxLINE",
  ].join("|");
}

function selectOddsRecordForRoom(roomId, oddsRecords) {
  const room = runtime.getRoom(roomId);
  const predicate = room.currentRound?.resolution?.predicate ?? {};
  return oddsRecords.find((record) => {
    if (predicate.marketSignature) return txlineMarketSignature(record) === predicate.marketSignature;
    if (predicate.market && record?.SuperOddsType !== predicate.market) return false;
    if (predicate.line !== undefined && predicate.line !== null && record?.MarketParameters !== predicate.line) return false;
    if (predicate.period !== undefined && predicate.period !== null && record?.MarketPeriod !== predicate.period) return false;
    return true;
  }) ?? oddsRecords.find((record) => record?.SuperOddsType === "1X2_PARTICIPANT_RESULT") ?? oddsRecords[0];
}

async function applyLatestScoreSnapshot(roomId, reason = "room-live-feed") {
  const scoresPayload = await fetchScoresSnapshot(txlineConfig, roomId);
  const latestScore = latestTxlineRecord(scoresPayload);
  if (!latestScore) return null;
  return runtime.applyNormalizedEvent(
    roomId,
    normalizeTxlineScore(latestScore, {
      matchId: roomId,
      source: "txline-snapshot",
    }),
    {
      endpoint: `/api/scores/snapshot/${roomId}`,
      httpMethod: "GET",
      httpStatus: 200,
      receivedAt: new Date().toISOString(),
      rawPayload: latestScore,
      requestId: `${reason}_${cryptoRandomId()}`,
      acquisitionOrigin: "txline_snapshot",
    },
  );
}

async function synchronizePicksFixtureLifecycle(fixture) {
  const status = String(fixture?.status ?? "unknown").toLowerCase();
  if (["cancelled", "canceled", "postponed", "abandoned"].includes(status)) return picksStore.voidFixture(fixture.fixtureId, status === "canceled" ? "cancelled" : status);
  if (["live", "finished", "final"].includes(status) || (fixture?.startTime && Date.now() >= Date.parse(fixture.startTime))) return picksStore.lockFixture(fixture.fixtureId, new Date().toISOString());
  return { synchronized: false };
}

async function applyScoreUpdates(roomId, feed, reason = "room-live-feed") {
  const scoresPayload = await fetchScoresUpdates(txlineConfig, roomId);
  const plan = planScoreUpdateReconciliation(scoresPayload, {
    fixtureId: roomId,
    cursor: feed.scoreCursor,
    initialized: feed.scoreInitialized,
  });
  if (plan.baseline) {
    await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(plan.baseline, { matchId: roomId, source: "txline-snapshot" }), {
      endpoint: `/api/scores/updates/${roomId}`,
      httpMethod: "GET",
      httpStatus: 200,
      receivedAt: new Date().toISOString(),
      rawPayload: plan.baseline,
      requestId: `${reason}_baseline_${cryptoRandomId()}`,
      acquisitionOrigin: "txline_snapshot",
      reconciliationOnly: true,
      suppressConsumerPresentation: true,
    });
  }
  for (const rawEvent of plan.updates) {
    await runtime.applyNormalizedEvent(roomId, normalizeTxlineScore(rawEvent, { matchId: roomId, source: "txline-snapshot" }), {
      endpoint: `/api/scores/updates/${roomId}`,
      httpMethod: "GET",
      httpStatus: 200,
      receivedAt: new Date().toISOString(),
      rawPayload: rawEvent,
      requestId: `${reason}_${cryptoRandomId()}`,
      acquisitionOrigin: "txline_snapshot",
    });
  }
  feed.scoreCursor = plan.cursor;
  feed.scoreInitialized = plan.initialized;
  return { cursor: feed.scoreCursor, applied: plan.updates.length, baseline: Boolean(plan.baseline) };
}

async function applyLatestOddsSnapshot(roomId, reason = "room-live-feed") {
  const oddsPayload = await fetchOddsSnapshot(txlineConfig, roomId);
  const oddsRecords = Array.isArray(oddsPayload) ? oddsPayload : [];
  const selected = selectOddsRecordForRoom(roomId, oddsRecords);
  if (!selected) return null;
  const receivedAt = new Date().toISOString();
  return runtime.applyNormalizedEvent(
    roomId,
    normalizeTxlineOdds({
      ...selected,
      txlineRequestId: `${reason}_${cryptoRandomId()}`,
      txlineEndpoint: `/api/odds/snapshot/${roomId}`,
      capturedAt: receivedAt,
    }, {
      matchId: roomId,
      source: "txline-snapshot",
    }),
    {
      requestId: `${reason}_${cryptoRandomId()}`,
      endpoint: `/api/odds/snapshot/${roomId}`,
      httpMethod: "GET",
      httpStatus: 200,
      receivedAt,
      rawPayload: selected,
      acquisitionOrigin: "txline_snapshot",
    },
  );
}

function liveRoomFeedStatus(roomId) {
  const feed = liveRoomFeeds.get(String(roomId));
  if (!feed) return { status: "idle", fixtureId: String(roomId), pollMs: TXLINE_ROOM_POLL_MS };
  return {
    status: feed.status,
    fixtureId: feed.fixtureId,
    pollMs: TXLINE_ROOM_POLL_MS,
    startedAt: feed.startedAt,
    lastPollAt: feed.lastPollAt,
    lastError: feed.lastError,
    pollCount: feed.pollCount,
    scoreCursor: feed.scoreCursor,
    scoreInitialized: feed.scoreInitialized,
  };
}

function startRoomLiveFeed(roomId) {
  const key = String(roomId);
  if (liveRoomFeeds.has(key)) return liveRoomFeedStatus(key);
  if (!hasTxlineCredentials(txlineConfig)) return { status: "unavailable", reason: "missing_txline_credentials", fixtureId: key };

  const feed = {
    status: "running",
    fixtureId: key,
    startedAt: new Date().toISOString(),
    lastPollAt: null,
    lastError: null,
    pollCount: 0,
    scoreCursor: null,
    scoreInitialized: false,
    interval: null,
  };
  liveRoomFeeds.set(key, feed);
  runtime.emit(key, "txline.room_feed_started", liveRoomFeedStatus(key));

  const pollOnce = async () => {
    try {
      feed.pollCount += 1;
      feed.lastPollAt = new Date().toISOString();
      const results = await Promise.allSettled([
        applyScoreUpdates(key, feed, "room-score-poll"),
        applyLatestOddsSnapshot(key, "room-odds-poll"),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      feed.status = failures.length ? "degraded" : "running";
      feed.lastError = failures.length ? failures.map((result) => result.reason?.message ?? "feed_poll_failed").join(";") : null;
    } catch (error) {
      feed.status = "degraded";
      feed.lastError = error.message || "room_feed_poll_failed";
    }
  };

  feed.interval = setInterval(() => {
    void pollOnce();
  }, TXLINE_ROOM_POLL_MS);
  void (async () => {
    await pollOnce();
    await Promise.allSettled([
      txlineStreams.startScores(key, { fixtureId: key }),
      txlineStreams.startOdds(key, { fixtureId: key }),
    ]);
    await pollOnce();
  })();
  return liveRoomFeedStatus(key);
}

async function loadMatchSummaries(query = "") {
  if (!hasTxlineCredentials(txlineConfig)) {
    const error = new Error("missing_txline_credentials");
    error.status = 503;
    throw error;
  }

  const fixtures = await fetchFixturesSnapshot(txlineConfig);
  const normalizedQuery = query.toLowerCase();
  const matches = (Array.isArray(fixtures) ? fixtures : [])
    .map(normalizeTxlineFixture)
    .map((fixture) => applyFixtureLifecycleTimeout(fixture, {
      maxLiveMs: Number(process.env.VIRA_FIXTURE_MAX_LIVE_MS || 3 * 60 * 60 * 1_000),
    }))
    .filter((fixture) => !normalizedQuery || fixture.title.toLowerCase().includes(normalizedQuery));

  return {
    source: "txline",
    matches,
  };
}

async function ensureRoomConfiguredFromTxline(roomId) {
  let match = null;
  if (!configuredRoomIds.has(String(roomId))) {
    const result = await loadMatchSummaries("");
    match = result.matches.find((fixture) => String(fixture.fixtureId) === String(roomId));
    if (!match) {
      const error = new Error("fixture_not_found");
      error.status = 404;
      error.body = { fixtureId: roomId };
      throw error;
    }
    runtime.configureMatch(match);
    configuredRoomIds.add(String(roomId));
  }

  if (!scoreHydratedRoomIds.has(String(roomId))) {
    try {
      const snapshot = await applyLatestScoreSnapshot(roomId, "room-score-hydrate");
      if (snapshot) scoreHydratedRoomIds.add(String(roomId));
    } catch {
      // Room entry should still work when a fixture exists but a score snapshot is temporarily unavailable.
    }
  }
  return match;
}

async function loadMatchTxlineContext(match) {
  const fixtureId = String(match.fixtureId);
  const cached = txlineContextCache.get(fixtureId);
  const now = Date.now();
  if (cached && now - cached.cachedAtMs < TXLINE_CONTEXT_CACHE_TTL_MS) {
    return {
      ...cached.context,
      cache: {
        status: "hit",
        cachedAt: new Date(cached.cachedAtMs).toISOString(),
        ttlMs: TXLINE_CONTEXT_CACHE_TTL_MS,
      },
    };
  }

  const context = await buildTxlineContext(txlineConfig, match);
  txlineContextCache.set(fixtureId, {
    cachedAtMs: now,
    context,
  });
  return {
    ...context,
    cache: {
      status: cached ? "refreshed" : "miss",
      cachedAt: new Date(now).toISOString(),
      ttlMs: TXLINE_CONTEXT_CACHE_TTL_MS,
    },
  };
}

const TXLINE_CATALOG_FRESH_MS = Number(process.env.TXLINE_CATALOG_FRESH_MS || 30_000);
const TXLINE_CATALOG_REFRESH_MS = Number(process.env.TXLINE_CATALOG_REFRESH_MS || 25_000);
const txlineCatalogCache = createTxlineCatalogCache({
  loadMatches: () => loadMatchSummaries(""),
  loadContext: (match) => loadMatchTxlineContext(match),
  configureMatch: (match, context) => {
    runtime.configureMatch(match, context);
    configuredRoomIds.add(String(match.fixtureId));
  },
  snapshotPath: e2eMode.enabled ? e2eMode.catalogSnapshotPath : path.resolve(process.env.VIRA_CATALOG_SNAPSHOT_PATH || fileURLToPath(new URL("./.cache/txline-catalog.json", import.meta.url))),
  freshMs: TXLINE_CATALOG_FRESH_MS,
  refreshMs: TXLINE_CATALOG_REFRESH_MS,
  concurrency: Number(process.env.TXLINE_CATALOG_CONCURRENCY || 3),
});

function filterCatalog(catalog, query = "") {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return catalog;
  return {
    ...catalog,
    matches: catalog.matches.filter((match) => `${match.title} ${match.competitionLabel} ${match.homeTeam} ${match.awayTeam}`.toLowerCase().includes(normalized)),
  };
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestOrigin = String(request.headers.origin || "");
  response.viraCorsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : [...allowedOrigins][0];

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  try {
    if (url.pathname.startsWith("/__e2e/")) {
      const authorization = authorizeE2eRequest(e2eMode, request);
      if (!authorization.ok) { sendJson(response, authorization.status, { error: authorization.error }); return; }
      if (request.method !== "POST" || Number(request.headers["content-length"] ?? 0) > 0) { sendJson(response, 405, { error: "fixed_scenario_actions_only" }); return; }
      const picksScenarioRoute = url.pathname.match(/^\/__e2e\/picks\/([a-z0-9-]{8,64})\/(lock|resolve)$/);
      if (picksScenarioRoute) {
        if (!picksEnabled) { sendJson(response, 404, { error: "picks_feature_disabled" }); return; }
        const fixtureId = picksScenarioRoute[1];
        if (picksScenarioRoute[2] === "lock") { sendJson(response, 200, await picksStore.lockFixture(fixtureId, new Date(Date.now() + 24 * 60 * 60_000).toISOString())); return; }
        sendJson(response, 200, await picksStore.resolveFixture(fixtureId, { status: "final", freshness: "fresh", authority: "txline_game_finalised", regularTimeScore: { home: 2, away: 1 }, providerSequence: 9001, observedAt: new Date().toISOString(), receivedAt: new Date().toISOString(), acquisitionOrigin: "captured_txline_test_fixture" })); return;
      }
      const scenarioRoute = url.pathname.match(/^\/__e2e\/scenario\/([a-z0-9-]{8,64})\/(start|resolve)$/);
      if (!scenarioRoute) { sendJson(response, 404, { error: "not_found" }); return; }
      const roomId = `e2e-${scenarioRoute[1]}`;
      if (scenarioRoute[2] === "start") {
        // Both configurations are live. This is not a scheduled -> live domain
        // transition: the first registers the dynamic seed, snapshot materializes
        // the room, and the second uses the existing-room path to schedule the
        // normal authoritative deadline.
        runtime.configureMatch({ fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", status: "live", homeTeam: "France", awayTeam: "Spain" }, { suggestedPrediction: { priceName: "part1", probability: 51 } });
        runtime.snapshot(roomId, null);
        runtime.configureMatch({ fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", status: "live", homeTeam: "France", awayTeam: "Spain" }, { suggestedPrediction: { priceName: "part1", probability: 51 } });
        configuredRoomIds.add(roomId);
        const snapshot = await runtime.applyNormalizedEvent(roomId, { id: `captured-e2e-period-${scenarioRoute[1]}`, matchId: roomId, sequence: 1, occurredAt: new Date().toISOString(), matchClockSec: 300, type: "period", source: "verified-playback", payload: { FixtureId: roomId, Seq: 1, StatusId: 2, Clock: { Running: true } } }, { acquisitionOrigin: "captured_txline_test_fixture" });
        sendJson(response, 200, { inputAuthority: e2eMode.inputAuthority, roomId, state: snapshot.currentRound?.state, roundId: snapshot.currentRound?.id, streamVersion: snapshot.ledger.streamVersion });
        return;
      }
      if (scenarioRoute[2] === "resolve") {
        const before = runtime.snapshot(roomId, null);
        if (before.currentRound?.state !== "locked") { sendJson(response, 409, { error: "round_not_locked", state: before.currentRound?.state ?? null }); return; }
        const sequence = Number(before.ledger.streamVersion) + 100;
        const scoreEvent = (suffix, seq, clock) => ({ id: `captured-e2e-score-${suffix}-${seq}`, matchId: roomId, sequence: seq, occurredAt: new Date().toISOString(), matchClockSec: clock, type: "period", source: "verified-playback", absoluteScore: { home: 1, away: 0 }, payload: { FixtureId: roomId, Seq: seq, Action: "score_adjustment", Clock: { Running: true, Seconds: clock }, Score: { Participant1: { Total: { Goals: 1 } }, Participant2: { Total: { Goals: 0 } } } } });
        await runtime.applyNormalizedEvent(roomId, scoreEvent("candidate", sequence, 600), { acquisitionOrigin: "captured_txline_test_fixture" });
        const snapshot = await runtime.applyNormalizedEvent(roomId, scoreEvent("confirmed", sequence + 1, 601), { acquisitionOrigin: "captured_txline_test_fixture" });
        sendJson(response, 200, { inputAuthority: e2eMode.inputAuthority, roomId, state: snapshot.currentRound?.state, streamVersion: snapshot.ledger.streamVersion });
        return;
      }
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "vira-runtime",
        pid: process.pid,
        cwd: process.cwd(),
        runtime: runtimeBoot,
        eventStore: eventStore.info(),
        txline: {
          network: txlineConfig.network,
          origin: txlineConfig.origin,
          hasCredentials: hasTxlineCredentials(txlineConfig),
          fixtureId: txlineConfig.fixtureId || null,
          catalog: txlineCatalogCache.status(),
        },
        companion: { webPushConfigured: webPushPublisher.enabled, activeSubscriptions: companionSubscriptionStore.activeSubscriptions().length },
        picks: { enabled: picksEnabled, persistence: "single_writer_atomic_file" },
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/companion/vapid-public-key") {
      sendJson(response, 200, { enabled: webPushPublisher.enabled, publicKey: webPushPublisher.publicKey });
      return;
    }

    if (request.method === "POST" && url.pathname === "/companion/subscriptions") {
      if (!webPushPublisher.enabled) { sendJson(response, 503, { error: "web_push_not_configured" }); return; }
      if (Number(request.headers["content-length"] ?? 0) > 16_384) { sendJson(response, 413, { error: "payload_too_large" }); return; }
      const body = await readJson(request, 16_384);
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const validation = runtime.hasPublicRoom(String(body.roomId)) ? runtime.validateSession(String(body.roomId), String(body.participantId), token) : { valid: false };
      if (!validation.valid) { sendJson(response, 401, { error: "valid_room_session_required" }); return; }
      const subscription = await companionSubscriptionStore.register({ ...body, fixtureId: body.fixtureId || body.roomId });
      sendJson(response, 201, { subscription });
      return;
    }

    const companionSubscriptionRoute = url.pathname.match(/^\/companion\/subscriptions\/([^/]+)(?:\/(preferences|follow|unfollow))?$/);
    if (companionSubscriptionRoute) {
      const subscriptionId = decodeURIComponent(companionSubscriptionRoute[1]);
      const action = companionSubscriptionRoute[2] ?? null;
      const body = request.method === "GET" ? {} : await readJson(request, 16_384);
      const roomId = String(body.roomId ?? url.searchParams.get("roomId") ?? "");
      const participantId = String(body.participantId ?? url.searchParams.get("participantId") ?? "");
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const validation = runtime.hasPublicRoom(roomId) ? runtime.validateSession(roomId, participantId, token) : { valid: false };
      if (!validation.valid) { sendJson(response, 401, { error: "valid_room_session_required" }); return; }
      if (request.method === "GET" && !action) {
        const subscription = companionSubscriptionStore.get(subscriptionId, participantId);
        sendJson(response, subscription ? 200 : 404, { subscription }); return;
      }
      if (request.method === "DELETE" && !action) {
        sendJson(response, 200, await companionSubscriptionStore.remove(subscriptionId, participantId)); return;
      }
      if (request.method === "POST" && action === "preferences") {
        sendJson(response, 200, { subscription: await companionSubscriptionStore.update(subscriptionId, participantId, { enabledTypes: body.enabledTypes, locale: body.locale, timeZone: body.timeZone }) }); return;
      }
      if (request.method === "POST" && (action === "follow" || action === "unfollow")) {
        sendJson(response, 200, { subscription: await companionSubscriptionStore.update(subscriptionId, participantId, { followed: action === "follow" }) }); return;
      }
      sendJson(response, 405, { error: "method_not_allowed" }); return;
    }

    if (request.method === "GET" && url.pathname === "/ready") {
      const eventStoreWritable = await eventStore.checkWritable();
      const txlineConfigured = hasTxlineCredentials(txlineConfig);
      const checks = {
        rehydration: { ok: runtimeBoot.readiness, mode: runtimeBoot.mode, error: runtimeBoot.rehydrateError },
        eventStore: eventStoreWritable,
        txline: {
          ok: !requireTxlineCredentials || txlineConfigured,
          required: requireTxlineCredentials,
          configured: txlineConfigured,
          network: txlineConfig.network,
        },
      };
      const ready = Object.values(checks).every((check) => check.ok);
      sendJson(response, ready ? 200 : 503, {
        ok: ready,
        service: "vira-runtime",
        checkedAt: new Date().toISOString(),
        checks,
        eventStore: eventStore.info(),
        rehydration: runtimeBoot.rehydration ?? null,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/operational/metrics") {
      const store = eventStore.info();
      const disk = await statfs(store.dataDir).catch(() => null);
      const feeds = [...liveRoomFeeds.values()];
      sendJson(response, 200, {
        measuredAt: new Date().toISOString(),
        process: { uptimeSec: Math.floor(process.uptime()), rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, eventLoopLagMs },
        runtime: runtime.operationalMetrics(),
        ledger: { globalPosition: store.globalPosition, streamCount: store.streamCount },
        txline: { catalog: txlineCatalogCache.status(), feeds: { total: feeds.length, degraded: feeds.filter((feed) => feed.status !== "running").length, lastEventAt: feeds.map((feed) => feed.lastPollAt).filter(Boolean).sort().at(-1) ?? null } },
        picks: { ...picksStore.metrics(), marketUnavailableFailures: picksRejections.marketUnavailable, deadlineRejections: picksRejections.deadline },
        disk: disk ? { freeBytes: Number(disk.bavail) * Number(disk.bsize), totalBytes: Number(disk.blocks) * Number(disk.bsize) } : null,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/public/playback") {
      ensureReady();
      const requestedRoomId = url.searchParams.get("roomId");
      const candidates = runtime.publicRoomSummaries().filter((room) => room.lastResolution?.roundId && (!requestedRoomId || room.roomId === requestedRoomId));
      const selected = candidates.sort((left, right) => Number(right.match.status === "finished") - Number(left.match.status === "finished"))[0] ?? null;
      const fallbackAllowed = !requestedRoomId || requestedRoomId === verifiedPlaybackIds.roomId;
      const fallbackRoom = fallbackAllowed
        ? runtime.publicRoomSummaries().find((room) => room.roomId === verifiedPlaybackIds.roomId) ?? null
        : null;
      const playbackRoom = selected ?? fallbackRoom;
      const roundId = selected?.lastResolution?.roundId ?? (fallbackRoom ? verifiedPlaybackIds.roundId : null);
      if (!playbackRoom || !roundId) {
        sendJson(response, 200, { available: false, reason: "verified_round_not_available", destination: "/matches" });
        return;
      }
      sendJson(response, 200, { available: true, room: playbackRoom, verification: await runtime.verifyRoom(playbackRoom.roomId), replay: await runtime.verifiedRoundReplay(playbackRoom.roomId, roundId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/public/identity") {
      const body = await readJson(request);
      sendJson(response, 200, await shareStore.ensureIdentity(publicToken(request, body), body.displayName));
      return;
    }

    const picksCatalogRoute = url.pathname.match(/^\/picks\/fixtures\/([^/]+)\/catalog$/);
    if (request.method === "GET" && picksCatalogRoute) {
      if (!picksEnabled) { sendJson(response, 200, { schemaVersion: 1, enabled: false }); return; }
      const fixtureId = decodeURIComponent(picksCatalogRoute[1]); const catalog = await txlineCatalogCache.get();
      const fixture = catalog.matches.find((item) => String(item.fixtureId) === fixtureId);
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      await synchronizePicksFixtureLifecycle(fixture);
      const questions = buildPicksCatalog({ fixture, context: fixture.context, now: Date.now() });
      sendJson(response, 200, { schemaVersion: 1, enabled: true, fixture: { fixtureId, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, kickoffAt: fixture.startTime, status: fixture.status }, questions });
      return;
    }

    if (request.method === "POST" && url.pathname === "/picks/cards") {
      if (!picksEnabled) throw Object.assign(new Error("picks_feature_disabled"), { status: 404 });
      const body = await readJson(request, 16_384); const token = publicToken(request, body); const identity = shareStore.homePlayer(token);
      if (!identity) throw Object.assign(new Error("public_identity_required"), { status: 401 });
      const catalog = await txlineCatalogCache.get(); const fixture = catalog.matches.find((item) => String(item.fixtureId) === String(body.fixtureId));
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      const selections = (body.selectionIds ?? []).map(selectionFromCanonicalId);
      const snapshots = selections.map((selection) => {
        const result = buildMarketSnapshotForSelection({ fixture, context: fixture.context, selection, now: Date.now() });
        if (!result.available) { picksRejections.marketUnavailable += 1; throw Object.assign(new Error(`picks_market_unavailable:${result.reason}`), { status: 409 }); }
        return result.snapshot;
      });
      const editorialContext = requestEditorialLocale(request, "picks_owner");
      let card;
      try { card = await picksStore.confirm({ fixture, identity, selectionIds: body.selectionIds, idempotencyKey: body.idempotencyKey, locale: editorialContext.locale, timeZone: editorialContext.timeZone, snapshots }); }
      catch (cause) { if (["picks_deadline_passed", "fixture_not_open_for_picks"].includes(cause.message)) picksRejections.deadline += 1; throw cause; }
      sendJson(response, 201, { card }); return;
    }

    const picksOwnerRoute = url.pathname.match(/^\/picks\/fixtures\/([^/]+)\/me$/);
    if (request.method === "GET" && picksOwnerRoute) {
      if (!picksEnabled) throw Object.assign(new Error("picks_feature_disabled"), { status: 404 });
      const identity = shareStore.homePlayer(publicToken(request)); if (!identity) throw Object.assign(new Error("public_identity_required"), { status: 401 });
      const catalog = await txlineCatalogCache.get(); const fixture = catalog.matches.find((item) => String(item.fixtureId) === decodeURIComponent(picksOwnerRoute[1])); if (fixture) await synchronizePicksFixtureLifecycle(fixture);
      sendJson(response, 200, { card: picksStore.owner(identity.publicId, decodeURIComponent(picksOwnerRoute[1])) }); return;
    }

    const picksPublicRoute = url.pathname.match(/^\/picks\/cards\/public\/([^/]+)$/);
    if (request.method === "GET" && picksPublicRoute) {
      if (!picksEnabled) throw Object.assign(new Error("picks_feature_disabled"), { status: 404 });
      const card = picksStore.public(decodeURIComponent(picksPublicRoute[1])); if (!card) throw Object.assign(new Error("picks_card_not_found"), { status: 404 });
      const catalog = await txlineCatalogCache.get(); const fixture = catalog.matches.find((item) => String(item.fixtureId) === card.fixtureId);
      sendJson(response, 200, { card, fixture: fixture ? { homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, kickoffAt: fixture.startTime, status: fixture.status } : null }); return;
    }

    const picksShareRoute = url.pathname.match(/^\/picks\/cards\/([^/]+)\/share$/);
    if (request.method === "POST" && picksShareRoute) {
      if (!picksEnabled) throw Object.assign(new Error("picks_feature_disabled"), { status: 404 });
      const identity = shareStore.homePlayer(publicToken(request)); if (!identity) throw Object.assign(new Error("public_identity_required"), { status: 401 });
      const card = await picksStore.markShared(decodeURIComponent(picksShareRoute[1]), identity.publicId);
      const catalog = await txlineCatalogCache.get(); const fixture = catalog.matches.find((item) => String(item.fixtureId) === card.fixtureId);
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      const resultCount = card.results?.filter((item) => item.status === "correct").length ?? 0; const isResult = card.status === "resolved" || card.status === "void";
      const share = await shareStore.createShare({
        kind: isResult ? "picks_result" : "picks", createdByPublicId: identity.publicId, expiresAt: isResult ? null : card.locksAt,
        metadata: { title: isResult ? `${identity.displayName} · ${resultCount}/${card.selections.length}` : `${identity.displayName} · VIRA Picks`, description: card.locale === "pt-BR" ? "Previsões sociais. Sem dinheiro envolvido." : "Social predictions. No money involved." },
        destination: { path: `/picks/${encodeURIComponent(card.fixtureId)}?card=${encodeURIComponent(card.publicCode)}`, ctaLabel: card.locale === "pt-BR" ? "Faça suas previsões" : "Make your picks" },
        attribution: { source: "picks", campaign: isResult ? "picks_result" : "picks_card" },
        payload: { fixtureId: card.fixtureId, picksCardId: card.id, picksPublicCode: card.publicCode, displayName: card.displayName, selections: card.selections, results: card.results, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, kickoffAt: fixture.startTime, homeScore: card.finalScore?.home, awayScore: card.finalScore?.away },
        editorialContext: { locale: card.locale, timeZone: card.timeZone, source: "picks_owner", kickoffAt: card.locksAt },
      });
      sendJson(response, 201, { share, url: `${publicBaseUrl(request)}/s/${share.publicCode}` }); return;
    }

    const picksOpenRoute = url.pathname.match(/^\/picks\/cards\/public\/([^/]+)\/open$/);
    if (request.method === "POST" && picksOpenRoute) {
      if (!picksEnabled) throw Object.assign(new Error("picks_feature_disabled"), { status: 404 });
      const player = shareStore.homePlayer(publicToken(request));
      sendJson(response, 202, await picksStore.markOpened(decodeURIComponent(picksOpenRoute[1]), { publicId: player?.publicId })); return;
    }

    if (request.method === "POST" && url.pathname === "/shares") {
      ensureReady();
      const body = await readJson(request);
      const token = publicToken(request, body);
      const identity = await shareStore.ensureIdentity(token, body.displayName);
      if (body.kind === "room" || body.kind === "result") {
        const editorialContext = requestEditorialLocale(request, "share_creator");
        const validation = runtime.validateSession(String(body.roomId), body.participantId, body.sessionToken ?? request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        if (!validation.valid) throw Object.assign(new Error("share_session_required"), { status: 401 });
        const snapshot = runtime.authenticatedSnapshot(String(body.roomId), body.participantId, body.sessionToken ?? request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        const participant = validation.participant;
        await shareStore.linkParticipant({ publicToken: token, displayName: participant.displayName, roomId: String(body.roomId), participantId: body.participantId, inviteCode: null });
        if (body.kind === "room") {
          const copy = roomShareCopy({ snapshot, participant, locale: editorialContext.locale, kind: "room" });
          const share = await shareStore.createShare({
            kind: "room", createdByPublicId: identity.publicId, expiresAt: snapshot.match.status === "finished" ? null : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            metadata: copy.metadata,
            destination: { path: `/match/${encodeURIComponent(snapshot.match.id)}`, ctaLabel: copy.ctaLabel },
            attribution: { source: "room", campaign: "room_invite" },
            payload: { fixtureId: snapshot.match.id, roomId: snapshot.roomId, homeTeam: snapshot.match.homeTeam.name, awayTeam: snapshot.match.awayTeam.name, fixtureStatus: snapshot.match.status, participantCount: snapshot.roomPopulation }, editorialContext,
          });
          sendJson(response, 201, { share, url: `${publicBaseUrl(request)}/s/${share.publicCode}` });
          return;
        }
        const result = snapshot.lastResolution;
        if (!result) throw Object.assign(new Error("resolved_result_required"), { status: 409 });
        const correct = result.wasCurrentUserCorrect;
        const copy = roomShareCopy({ snapshot, participant, locale: editorialContext.locale, kind: "result" });
        const share = await shareStore.createShare({
          kind: "result", createdByPublicId: identity.publicId,
          metadata: copy.metadata,
          destination: { path: `/match/${encodeURIComponent(snapshot.match.id)}`, ctaLabel: copy.ctaLabel },
          attribution: { source: "result", campaign: "round_result" },
          payload: { fixtureId: snapshot.match.id, roomId: snapshot.roomId, roundId: result.roundId, correct, points: result.pointsAwarded, rank: snapshot.leaderboard.find((entry) => entry.participantId === body.participantId)?.rank ?? null, winningOptionId: result.winningOptionId, verified: Boolean(snapshot.ledger?.headHash), homeTeam: snapshot.match.homeTeam.name, awayTeam: snapshot.match.awayTeam.name, homeScore: snapshot.match.homeScore, awayScore: snapshot.match.awayScore }, editorialContext,
        });
        sendJson(response, 201, { share, url: `${publicBaseUrl(request)}/s/${share.publicCode}` });
        return;
      }
      throw Object.assign(new Error("unsupported_share_kind"), { status: 400 });
    }

    if (request.method === "POST" && url.pathname === "/predictions") {
      ensureReady();
      const body = await readJson(request);
      const catalog = await txlineCatalogCache.get();
      const fixture = catalog.matches.find((item) => String(item.fixtureId) === String(body.fixtureId));
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      const token = publicToken(request, body);
      const prediction = await shareStore.createPrediction({ publicToken: token, displayName: body.displayName, fixture, choice: body.choice });
      await shareStore.attributePredictionInvite({ publicToken: token, displayName: body.displayName, inviteCode: body.inviteCode });
      if (body.createShare === false) {
        sendJson(response, 201, { prediction, share: null, url: null });
        return;
      }
      const identity = shareStore.identity(token, body.displayName);
      const editorialContext = predictionEditorialContext(fixture, request);
      const choiceLabel = shareChoiceLabel(body.choice, fixture, editorialContext.locale);
      const copy = predictionShareCopy({ fixture, displayName: prediction.displayName, choiceLabel, editorialContext });
      const share = await shareStore.createShare({
        kind: "prediction", createdByPublicId: identity.publicId, expiresAt: fixture.startTime,
        metadata: copy.metadata,
        destination: { path: `/match/${encodeURIComponent(fixture.fixtureId)}/preview`, ctaLabel: copy.ctaLabel },
        attribution: { source: "prediction", campaign: "pre_match_1x2" },
        payload: { fixtureId: fixture.fixtureId, predictionId: prediction.id, choice: body.choice, choiceLabel, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, kickoffAt: fixture.startTime }, editorialContext,
      });
      sendJson(response, 201, { prediction, share, url: `${publicBaseUrl(request)}/s/${share.publicCode}` });
      return;
    }

    if (request.method === "GET" && url.pathname === "/home") {
      ensureReady();
      const catalog = await txlineCatalogCache.get();
      const token = publicToken(request);
      const playerState = token ? shareStore.homePlayer(token) : null;
      for (const fixture of catalog.matches) {
        if (String(fixture.status).toLowerCase() !== "finished") continue;
        try {
          const snapshot = runtime.snapshot(String(fixture.fixtureId), null);
          if (snapshot.match.status === "finished") {
            await shareStore.resolvePredictionsForFixture(String(fixture.fixtureId), { homeScore: snapshot.match.homeScore, awayScore: snapshot.match.awayScore });
          }
        } catch {
          // A Home remains available even if a legacy finished fixture has no room projection.
        }
      }
      const refreshedPlayer = token ? shareStore.homePlayer(token) : null;
      const playerScores = (refreshedPlayer?.roomLinks ?? []).map((link) => {
        try {
          const snapshot = runtime.snapshot(String(link.roomId), null);
          return snapshot.leaderboard?.find((entry) => entry.participantId === link.participantId) ?? null;
        } catch { return null; }
      }).filter(Boolean);
      const totalPoints = playerScores.reduce((total, entry) => total + Number(entry.points ?? 0), 0);
      const bestStreak = playerScores.reduce((best, entry) => Math.max(best, Number(entry.streak ?? 0)), 0);
      const miniLeagues = (refreshedPlayer?.miniLeagueIds ?? []).map((leagueId) => {
        const league = shareStore.state.leagues[leagueId];
        if (!league) return null;
        let snapshot = null;
        try { snapshot = runtime.snapshot(String(league.roomId), null); } catch { snapshot = null; }
        return shareStore.league(leagueId, snapshot);
      }).filter(Boolean);
      sendJson(response, 200, deriveHomeProjection({
        catalog,
        predictions: refreshedPlayer?.predictions ?? playerState?.predictions ?? {},
        miniLeagues,
        player: refreshedPlayer ? {
          publicId: refreshedPlayer.publicId,
          displayName: refreshedPlayer.displayName,
          points: totalPoints,
          streak: bestStreak,
        } : null,
        localeContext: requestEditorialLocale(request),
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/home/analytics") {
      const body = await readJson(request);
      sendJson(response, 202, await shareStore.trackHome(body.type, publicToken(request, body), {
        editorialKind: String(body.editorialKind ?? "").slice(0, 40),
        fixtureId: body.fixtureId ? String(body.fixtureId).slice(0, 120) : null,
      }));
      return;
    }

    const myPredictionRoute = url.pathname.match(/^\/predictions\/([^/]+)\/me$/);
    if (request.method === "GET" && myPredictionRoute) {
      const fixtureId = decodeURIComponent(myPredictionRoute[1]);
      const token = publicToken(request);
      const identity = shareStore.identity(token);
      const catalog = await txlineCatalogCache.get();
      const fixture = catalog.matches.find((item) => String(item.fixtureId) === String(fixtureId));
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      const snapshot = runtime.snapshot(fixtureId, null);
      if (fixture.status === "finished" || snapshot.match.status === "finished") {
        await shareStore.resolvePredictionsForFixture(fixtureId, { homeScore: snapshot.match.homeScore, awayScore: snapshot.match.awayScore });
      }
      sendJson(response, 200, { prediction: shareStore.prediction(fixtureId, identity.publicId), fixture: { status: fixture.status, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam } });
      return;
    }

    const predictionShareRoute = url.pathname.match(/^\/predictions\/([^/]+)\/share$/);
    if (request.method === "POST" && predictionShareRoute) {
      const fixtureId = decodeURIComponent(predictionShareRoute[1]);
      const body = await readJson(request);
      const token = publicToken(request, body);
      const identity = shareStore.identity(token);
      const prediction = shareStore.prediction(fixtureId, identity.publicId);
      if (!prediction) throw Object.assign(new Error("prediction_not_found"), { status: 404 });
      const catalog = await txlineCatalogCache.get();
      const fixture = catalog.matches.find((item) => String(item.fixtureId) === String(fixtureId));
      if (!fixture) throw Object.assign(new Error("fixture_not_found"), { status: 404 });
      const resolved = prediction.status === "resolved";
      const editorialContext = predictionEditorialContext(fixture, request);
      const label = shareChoiceLabel(prediction.choice, fixture, editorialContext.locale);
      const copy = predictionShareCopy({ fixture, displayName: prediction.displayName, choiceLabel: label, editorialContext, resolvedPrediction: resolved ? prediction : null });
      const share = await shareStore.createShare({
        kind: resolved ? "result" : "prediction",
        createdByPublicId: identity.publicId,
        expiresAt: resolved ? null : fixture.startTime,
        metadata: copy.metadata,
        destination: { path: `/match/${encodeURIComponent(fixtureId)}/preview`, ctaLabel: copy.ctaLabel },
        attribution: { source: resolved ? "result" : "prediction", campaign: resolved ? "fixture_prediction_result" : "pre_match_1x2" },
        payload: { fixtureId, predictionId: prediction.id, choice: prediction.choice, choiceLabel: label, correct: prediction.correct ?? null, finalScore: prediction.finalScore ?? null, homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam, kickoffAt: fixture.startTime }, editorialContext,
      });
      sendJson(response, 201, { prediction, share, url: `${publicBaseUrl(request)}/s/${share.publicCode}` });
      return;
    }

    const shareJsonRoute = url.pathname.match(/^\/shares\/([^/]+)$/);
    if (request.method === "GET" && shareJsonRoute) {
      const share = shareStore.getShare(decodeURIComponent(shareJsonRoute[1]));
      if (!share) throw Object.assign(new Error("share_not_found"), { status: 404 });
      sendJson(response, 200, share);
      return;
    }

    const shareClickRoute = url.pathname.match(/^\/shares\/([^/]+)\/click$/);
    if (request.method === "POST" && shareClickRoute) {
      sendJson(response, 202, await shareStore.track("share_cta_clicked", decodeURIComponent(shareClickRoute[1])));
      return;
    }

    const sharePageRoute = url.pathname.match(/^\/s\/([^/]+)$/);
    if (request.method === "GET" && sharePageRoute) {
      const publicCode = decodeURIComponent(sharePageRoute[1]);
      const share = shareStore.getShare(publicCode);
      if (!share) { sendHtml(response, 404, "<!doctype html><title>Convite indisponível | VIRA</title><body style='background:#050814;color:white;font-family:Arial;padding:40px'><h1>Convite indisponível</h1><a href='/' style='color:#c7ff18'>Abrir VIRA</a></body>"); return; }
      await shareStore.track("share_opened", publicCode, { userAgent: String(request.headers["user-agent"] ?? "").slice(0, 160) });
      sendHtml(response, 200, renderSharePage({ share, base: publicBaseUrl(request) }), "public, max-age=30, stale-while-revalidate=300");
      return;
    }

    const shareImageRoute = url.pathname.match(/^\/share-images\/([^/.]+)\.svg$/);
    if (request.method === "GET" && shareImageRoute) {
      const share = shareStore.getShare(decodeURIComponent(shareImageRoute[1]));
      if (!share) throw Object.assign(new Error("share_not_found"), { status: 404 });
      sendSvg(response, renderShareSvg(share));
      return;
    }

    const sharePngRoute = url.pathname.match(/^\/share-images\/([^/.]+)\.png$/);
    if (request.method === "GET" && sharePngRoute) {
      const share = shareStore.getShare(decodeURIComponent(sharePngRoute[1]));
      if (!share) throw Object.assign(new Error("share_not_found"), { status: 404 });
      sendPng(response, renderSharePng(share));
      return;
    }

    const leagueRoute = url.pathname.match(/^\/mini-leagues\/([^/]+)$/);
    if (request.method === "GET" && leagueRoute) {
      const leagueId = decodeURIComponent(leagueRoute[1]);
      const leagueSeed = shareStore.state.leagues[leagueId];
      if (!leagueSeed) throw Object.assign(new Error("mini_league_not_found"), { status: 404 });
      const snapshot = runtime.snapshot(leagueSeed.roomId, null);
      sendJson(response, 200, shareStore.league(leagueId, snapshot));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/fixtures") {
      sendJson(response, 200, await fetchFixturesSnapshot(txlineConfig));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/discovery") {
      sendJson(response, 200, await discoverTxlineFixtures(txlineConfig, {
        limit: url.searchParams.get("limit") ?? 20,
        fixtureId: url.searchParams.get("fixtureId"),
        savePayloads: url.searchParams.get("save") === "1",
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/capabilities") {
      sendJson(response, 200, txlineCapabilities());
      return;
    }

    if (request.method === "POST" && url.pathname === "/txline/auth/guest/start") {
      sendJson(response, 200, await startGuestSession(txlineConfig));
      return;
    }

    if (request.method === "GET" && url.pathname === "/matches/catalog") {
      ensureReady();
      const catalog = filterCatalog(await txlineCatalogCache.get(), url.searchParams.get("q") || "");
      sendJson(response, 200, catalog);
      return;
    }

    const lineupsRoute = url.pathname.match(/^\/matches\/([^/]+)\/lineups$/);
    if (request.method === "GET" && lineupsRoute) {
      const fixtureId = decodeURIComponent(lineupsRoute[1]);
      sendJson(response, 501, {
        error: "txline_lineups_unavailable",
        fixtureId,
        provider: "TxLINE",
        message: "No official TxLINE lineup endpoint is configured for this product build.",
      });
      return;
    }

    const txlineContextRoute = url.pathname.match(/^\/matches\/([^/]+)\/txline-context$/);
    if (request.method === "GET" && txlineContextRoute) {
      ensureReady();
      const fixtureId = decodeURIComponent(txlineContextRoute[1]);
      const catalog = await txlineCatalogCache.get();
      const entry = catalog.matches.find((fixture) => String(fixture.fixtureId) === fixtureId) ?? null;
      if (!entry) {
        sendJson(response, 404, { error: "fixture_not_found", fixtureId });
        return;
      }
      if (!entry.context) {
        sendJson(response, 503, { error: "txline_context_unavailable", fixtureId, availability: entry.availability });
        return;
      }
      sendJson(response, 200, { ...entry.context, consumerProjection: entry.consumerProjection });
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/scores") {
      sendJson(response, 200, await fetchScoresSnapshot(txlineConfig, url.searchParams.get("fixtureId") || undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/scores/updates") {
      sendJson(response, 200, await fetchScoresUpdates(txlineConfig, url.searchParams.get("fixtureId") || undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/scores/historical") {
      sendJson(response, 200, await fetchHistoricalScores(txlineConfig, url.searchParams.get("fixtureId") || undefined));
      return;
    }

    if (request.method === "GET" && url.pathname === "/txline/odds") {
      sendJson(response, 200, await fetchOddsSnapshot(txlineConfig, url.searchParams.get("fixtureId") || undefined));
      return;
    }

    const publicRoundReplayRoute = url.pathname.match(/^\/public\/rooms\/([^/]+)\/rounds\/([^/]+)\/replay$/);
    if (request.method === "GET" && publicRoundReplayRoute) {
      ensureReady();
      const roomId = decodeURIComponent(publicRoundReplayRoute[1]);
      const roundId = decodeURIComponent(publicRoundReplayRoute[2]);
      if (!(await runtime.hasPublicRoom(roomId))) {
        sendJson(response, 404, { error: "room_not_found", roomId });
        return;
      }
      sendJson(response, 200, await runtime.verifiedRoundReplay(roomId, roundId));
      return;
    }

    const publicRoundCommitmentRoute = url.pathname.match(/^\/public\/rooms\/([^/]+)\/rounds\/([^/]+)\/commitment$/);
    if (request.method === "GET" && publicRoundCommitmentRoute) {
      ensureReady();
      const roomId = decodeURIComponent(publicRoundCommitmentRoute[1]);
      const roundId = decodeURIComponent(publicRoundCommitmentRoute[2]);
      if (!(await runtime.hasPublicRoom(roomId))) {
        sendJson(response, 404, { error: "room_not_found", roomId });
        return;
      }
      sendJson(response, 200, await runtime.roundCommitment(roomId, roundId));
      return;
    }

    const publicRoomRoute = url.pathname.match(/^\/public\/rooms\/([^/]+)(?:\/([^/]+))?$/);
    if (request.method === "GET" && publicRoomRoute) {
      ensureReady();
      const roomId = decodeURIComponent(publicRoomRoute[1]);
      const publicResource = publicRoomRoute[2] || "";
      if (!(await runtime.hasPublicRoom(roomId))) {
        sendJson(response, 404, { error: "room_not_found", roomId });
        return;
      }
      if (publicResource === "") {
        sendJson(response, 200, runtime.snapshot(roomId, null));
        return;
      }
      if (publicResource === "events") {
        sendJson(response, 200, {
          roomId,
          events: await runtime.publicEvents(roomId),
        });
        return;
      }
      if (publicResource === "evidence") {
        sendJson(response, 200, runtime.evidence(roomId, Number(url.searchParams.get("limit") || 25)));
        return;
      }
      if (publicResource === "projection") {
        sendJson(response, 200, runtime.snapshot(roomId, null));
        return;
      }
      if (publicResource === "verification") {
        sendJson(response, 200, await runtime.verifyRoom(roomId));
        return;
      }
    }

    const route = roomRoute(url.pathname);
    if (route) {
      ensureReady();
      const { roomId, rest } = route;
      const internalMutation = request.method === "POST" && ["txline-event", "txline/ingest-odds", "txline/connect", "txline/connect-odds", "txline/connect-scores", "txline/disconnect"].includes(rest);
      if (internalMutation) requireInternalAdmin(request);
      const isolatedE2eRoom = e2eMode.enabled && roomId.startsWith("e2e-");
      if (!isolatedE2eRoom) {
        await ensureRoomConfiguredFromTxline(roomId);
        startRoomLiveFeed(roomId);
      }

      if (request.method === "POST" && rest === "join") {
        const body = await readJson(request);
        const joined = await runtime.join(roomId, body.displayName, body.admissionToken);
        if (body.publicToken) await shareStore.linkParticipant({ publicToken: body.publicToken, displayName: joined.participant.displayName, roomId, participantId: joined.participant.id, inviteCode: body.inviteCode });
        sendJson(response, 200, joined);
        return;
      }

      if (request.method === "GET" && rest === "state") {
        const participantId = url.searchParams.get("participantId");
        const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (!participantId || !token) {
          sendJson(response, 401, { error: "authenticated_state_required" });
          return;
        }
        sendJson(response, 200, runtime.authenticatedSnapshot(roomId, participantId, token));
        return;
      }

      if (request.method === "POST" && rest === "session/validate") {
        const body = await readJson(request);
        const result = runtime.validateSession(roomId, body.participantId, body.sessionToken ?? request.headers.authorization?.replace(/^Bearer\s+/i, ""));
        sendJson(response, result.valid ? 200 : 401, result);
        return;
      }

      if (request.method === "POST" && rest === "fan-pulse") {
        const body = await readJson(request);
        sendJson(response, 200, await runtime.castFanPulse(
          roomId,
          body.participantId,
          body.side,
          body.sessionToken ?? request.headers.authorization?.replace(/^Bearer\s+/i, ""),
        ));
        return;
      }

      if (request.method === "GET" && rest === "evidence") {
        sendJson(response, 200, runtime.evidence(roomId, Number(url.searchParams.get("limit") || 10)));
        return;
      }

      const evidenceMatch = rest.match(/^evidence\/([^/]+)$/);
      if (request.method === "GET" && evidenceMatch) {
        const evidence = runtime.evidenceById(roomId, decodeURIComponent(evidenceMatch[1]));
        sendJson(response, evidence ? 200 : 404, evidence ?? { error: "evidence_not_found" });
        return;
      }

      if (request.method === "GET" && rest === "events") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        runtime.attachClient(roomId, response, null);
        return;
      }

      const answerMatch = rest.match(/^rounds\/([^/]+)\/answer$/);
      if (request.method === "POST" && answerMatch) {
        const body = await readJson(request);
        sendJson(
          response,
          200,
          await runtime.submitAnswer(
            roomId,
            decodeURIComponent(answerMatch[1]),
            body.participantId,
            body.optionId,
            body.clientAnswerId,
            body.roundVersion,
            body.sessionToken ?? request.headers.authorization?.replace(/^Bearer\s+/i, ""),
          ),
        );
        return;
      }

      if (request.method === "POST" && rest === "txline-event") {
        requireInternalAdmin(request);
        const body = await readJson(request);
        const normalized = body.normalizedEvent ?? normalizeTxlineScore(body.rawEvent ?? body, { matchId: roomId });
        sendJson(response, 200, await runtime.applyNormalizedEvent(roomId, normalized, { acquisitionOrigin: "internal_test" }));
        return;
      }

      if (request.method === "POST" && rest === "txline/ingest-odds") {
        requireInternalAdmin(request);
        const body = await readJson(request);
        const fixtureId = body.fixtureId || url.searchParams.get("fixtureId") || roomId;
        const requestId = `txreq_${cryptoRandomId()}`;
        const endpoint = `/api/odds/snapshot/${fixtureId}`;
        const receivedAt = new Date().toISOString();
        const oddsPayload = await fetchOddsSnapshot(txlineConfig, fixtureId);
        const oddsRecords = Array.isArray(oddsPayload) ? oddsPayload : [];
        const selected = selectOddsRecordForRoom(roomId, oddsRecords);
        if (!selected) {
          const error = new Error("no_odds_payload_available");
          error.status = 404;
          throw error;
        }
        const normalized = normalizeTxlineOdds({
          ...selected,
          txlineRequestId: requestId,
          txlineEndpoint: endpoint,
          capturedAt: receivedAt,
        }, {
          matchId: roomId,
          source: "txline-snapshot",
        });
        const snapshot = await runtime.applyNormalizedEvent(roomId, normalized, {
          requestId,
          endpoint,
          httpMethod: "GET",
          httpStatus: 200,
          receivedAt,
          rawPayload: selected,
          acquisitionOrigin: "internal_test",
        });
        sendJson(response, 202, {
          accepted: true,
          requestId,
          evidenceId: snapshot.latestEvidence?.id,
        });
        return;
      }

      if (request.method === "POST" && rest === "txline/connect") {
        requireInternalAdmin(request);
        const body = await readJson(request);
        const kind = body.kind || url.searchParams.get("kind") || "scores";
        const starter = kind === "odds" ? txlineStreams.startOdds : txlineStreams.startScores;
        sendJson(response, 200, await starter(roomId, {
          fixtureId: body.fixtureId || url.searchParams.get("fixtureId") || txlineConfig.fixtureId || roomId,
        }));
        return;
      }

      if (request.method === "POST" && rest === "txline/connect-odds") {
        requireInternalAdmin(request);
        const body = await readJson(request);
        sendJson(response, 200, await txlineStreams.startOdds(roomId, {
          fixtureId: body.fixtureId || url.searchParams.get("fixtureId") || txlineConfig.fixtureId || roomId,
        }));
        return;
      }

      if (request.method === "POST" && rest === "txline/connect-scores") {
        requireInternalAdmin(request);
        const body = await readJson(request);
        sendJson(response, 200, await txlineStreams.startScores(roomId, {
          fixtureId: body.fixtureId || url.searchParams.get("fixtureId") || txlineConfig.fixtureId || roomId,
        }));
        return;
      }

      if (request.method === "POST" && rest === "txline/disconnect") {
        requireInternalAdmin(request);
        const body = await readJson(request).catch(() => ({}));
        sendJson(response, 200, txlineStreams.stop(roomId, body.kind || url.searchParams.get("kind")));
        return;
      }

      if (request.method === "GET" && rest === "txline/status") {
        sendJson(response, 200, {
          ...txlineStreams.status(roomId),
          roomFeed: liveRoomFeedStatus(roomId),
        });
        return;
      }
    }

    if (await serveFrontend(request, response, url.pathname)) return;
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "internal_error",
      details: error.body || undefined,
    });
  }
}

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

const catalogHydrated = await txlineCatalogCache.hydrate();
if (hasTxlineCredentials(txlineConfig)) {
  if (!catalogHydrated) {
    try {
      await txlineCatalogCache.refresh("startup-warm");
    } catch (error) {
      console.error("VIRA TxLINE catalog failed initial warmup", error);
    }
  }
  txlineCatalogCache.start();
} else {
  console.warn("VIRA TxLINE catalog refresh disabled: missing credentials");
}

server.listen(port, () => {
  attentionOrchestrator.start();
  console.log(`VIRA runtime listening on http://127.0.0.1:${port}`);
});
