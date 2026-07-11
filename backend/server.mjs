import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";

import { loadLocalEnv } from "./env.mjs";
import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";
import { txlineCapabilities } from "./txline-endpoints.mjs";
import { buildTxlineContext } from "./txline-context.mjs";
import { discoverTxlineFixtures } from "./txline-discovery.mjs";
import {
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
import { createTxlineCatalogCache } from "./txline-catalog-cache.mjs";

loadLocalEnv();

const eventStore = await createFileEventStore();
const runtime = createRoomRuntime({ eventStore });
const runtimeBoot = {
  liveness: true,
  readiness: false,
  mode: "booting",
  rehydratedAt: null,
  rehydrateError: null,
};
try {
  const rehydration = await runtime.rehydrateFromLedger();
  runtimeBoot.readiness = true;
  runtimeBoot.mode = "ready";
  runtimeBoot.rehydratedAt = new Date().toISOString();
  runtimeBoot.rehydration = rehydration;
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
const allowedOrigins = new Set(String(process.env.VIRA_ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map((value) => value.trim()).filter(Boolean));
const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const staticMimeTypes = new Map([[".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"], [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"], [".svg", "image/svg+xml"], [".webp", "image/webp"], [".woff2", "font/woff2"]]);

function cryptoRandomId() {
  return randomUUID().slice(0, 8);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": response.viraCorsOrigin || "http://localhost:5173",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Last-Event-ID",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(body));
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
    response.writeHead(200, {
      "Content-Type": staticMimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "Cache-Control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
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
    interval: null,
  };
  liveRoomFeeds.set(key, feed);
  runtime.emit(key, "txline.room_feed_started", liveRoomFeedStatus(key));

  void txlineStreams.startScores(key, { fixtureId: key }).catch((error) => {
    feed.lastError = error.message || "scores_stream_start_failed";
  });
  void txlineStreams.startOdds(key, { fixtureId: key }).catch((error) => {
    feed.lastError = error.message || "odds_stream_start_failed";
  });

  const pollOnce = async () => {
    try {
      feed.pollCount += 1;
      feed.lastPollAt = new Date().toISOString();
      await Promise.allSettled([
        applyLatestScoreSnapshot(key, "room-score-poll"),
        applyLatestOddsSnapshot(key, "room-odds-poll"),
      ]);
      feed.status = "running";
    } catch (error) {
      feed.status = "degraded";
      feed.lastError = error.message || "room_feed_poll_failed";
    }
  };

  feed.interval = setInterval(() => {
    void pollOnce();
  }, TXLINE_ROOM_POLL_MS);
  void pollOnce();
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
  snapshotPath: fileURLToPath(new URL("./.cache/txline-catalog.json", import.meta.url)),
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
      });
      return;
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

    if (request.method === "GET" && url.pathname === "/matches") {
      ensureReady();
      const catalog = filterCatalog(await txlineCatalogCache.get(), url.searchParams.get("q") || "");
      sendJson(response, 200, {
        source: catalog.source,
        cache: catalog.cache,
        generatedAt: catalog.generatedAt,
        matches: catalog.matches.map(({ context, availability, contextError, ...match }) => ({ ...match, availability })),
      });
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
      sendJson(response, 200, entry.context);
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
      await ensureRoomConfiguredFromTxline(roomId);
      startRoomLiveFeed(roomId);

      if (request.method === "POST" && rest === "join") {
        const body = await readJson(request);
        sendJson(response, 200, await runtime.join(roomId, body.displayName));
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
  console.log(`VIRA runtime listening on http://127.0.0.1:${port}`);
});
