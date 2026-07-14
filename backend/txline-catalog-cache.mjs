import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deriveFixtureConsumerProjection, rankFixtureConsumerProjections } from "../shared/fixture-consumer-projection.mjs";

const SNAPSHOT_VERSION = 3;

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function availability(context) {
  const marketCount = context?.availableMarkets?.length ?? context?.endpoints?.odds?.data?.availableMarkets?.length ?? 0;
  return {
    marketCount,
    observedMarketCount: marketCount,
    focusMarketCount: Math.min(5, marketCount),
    canonical1X2Available: Boolean(context?.canonical1X2),
    hasMarket: marketCount > 0,
    hasPlayablePrediction: Boolean(context?.suggestedPrediction),
    contextStatus: context ? "ready" : "unavailable",
  };
}

function projectedAvailability(projection, context, contextStatus = null) {
  const base = availability(context);
  return {
    ...base,
    canonical1X2Available: Boolean(projection.market.canonical1X2),
    hasPlayablePrediction: projection.availability.canPredict,
    canPredict: projection.availability.canPredict,
    canEnterRoom: projection.availability.canEnterRoom,
    canShowMarket: projection.availability.canShowMarket,
    canMakeDirectionalClaim: projection.availability.canMakeDirectionalClaim,
    reason: projection.availability.reason,
    contextStatus: contextStatus ?? base.contextStatus,
  };
}

function contextTtl(match, referenceTime) {
  const status = String(match?.status ?? "").toLowerCase();
  if (status.includes("live") || status.includes("play")) return 10_000;
  if (status.includes("finish") || status.includes("complete") || status.includes("final")) return 10 * 60_000;
  const kickoff = Date.parse(match?.startTime ?? "");
  if (!Number.isFinite(kickoff)) return 5 * 60_000;
  const distance = kickoff - referenceTime;
  if (distance <= 6 * 60 * 60_000) return 30_000;
  if (distance <= 48 * 60 * 60_000) return 2 * 60_000;
  return 10 * 60_000;
}

function canReuseContext(previous, match, referenceTime) {
  if (!previous?.context) return false;
  const generatedAt = Date.parse(previous.context.generatedAt ?? previous.context.cache?.cachedAt ?? "");
  if (!Number.isFinite(generatedAt)) return false;
  return referenceTime - generatedAt < contextTtl(match, referenceTime);
}

function shouldPreservePreviousContext(previous, next) {
  if (!previous?.context || !next) return false;
  if (next.fixtureState?.status === "finished" && previous.context?.fixtureState?.status !== "finished") return false;
  const previousMarkets = availability(previous.context).marketCount;
  const nextMarkets = availability(next).marketCount;
  if (previousMarkets <= 0 || nextMarkets > 0) return false;
  const oddsHealthy = next.endpoints?.odds?.ok === true || next.endpoints?.oddsUpdates?.ok === true;
  return !oddsHealthy;
}

export function reconcileMatchWithTxlineContext(match, context) {
  const state = context?.fixtureState;
  if (state?.status !== "finished") return match;
  return {
    ...match,
    status: "finished",
    reportedStatus: match.status,
    lifecycleResolution: state.authority ?? "txline_game_finalised",
    homeScore: Number.isFinite(Number(state.score?.home)) ? Number(state.score.home) : match.homeScore,
    awayScore: Number.isFinite(Number(state.score?.away)) ? Number(state.score.away) : match.awayScore,
    terminalProviderSequence: state.providerSequence ?? null,
  };
}

export function createTxlineCatalogCache({
  loadMatches,
  loadContext,
  configureMatch = () => {},
  snapshotPath,
  freshMs = 30_000,
  refreshMs = 25_000,
  concurrency = 3,
  now = () => Date.now(),
}) {
  let snapshot = null;
  let refreshPromise = null;
  let interval = null;
  let lastError = null;

  function decorate(status = "hit") {
    if (!snapshot) return null;
    const ageMs = Math.max(0, now() - Date.parse(snapshot.generatedAt));
    return {
      ...snapshot,
      cache: {
        status,
        strategy: "server-warm-swr",
        generatedAt: snapshot.generatedAt,
        ageMs,
        freshMs,
        stale: ageMs >= freshMs,
        refreshing: Boolean(refreshPromise),
        lastError,
      },
    };
  }

  async function persist(value) {
    if (!snapshotPath) return;
    await mkdir(dirname(snapshotPath), { recursive: true });
    const temporary = `${snapshotPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, snapshotPath);
  }

  async function hydrate() {
    if (!snapshotPath) return false;
    try {
      const parsed = JSON.parse(await readFile(snapshotPath, "utf8"));
      if (parsed?.version !== SNAPSHOT_VERSION || !Array.isArray(parsed.matches)) return false;
      snapshot = parsed;
      return true;
    } catch {
      return false;
    }
  }

  async function refresh(reason = "scheduled") {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const result = await loadMatches();
        const matches = Array.isArray(result?.matches) ? result.matches : [];
        let contextsRefreshed = 0;
        let contextsReused = 0;
        const enriched = await mapWithConcurrency(matches, concurrency, async (match) => {
          const previous = snapshot?.matches?.find((item) => String(item.fixtureId) === String(match.fixtureId));
          if (canReuseContext(previous, match, now())) {
            contextsReused += 1;
            const effectiveMatch = reconcileMatchWithTxlineContext(match, previous.context);
            configureMatch(effectiveMatch, previous.context);
            return { ...effectiveMatch, context: previous.context, availability: availability(previous.context) };
          }
          try {
            const context = await loadContext(match);
            if (shouldPreservePreviousContext(previous, context)) {
              contextsReused += 1;
              const effectiveMatch = reconcileMatchWithTxlineContext(match, previous.context);
              configureMatch(effectiveMatch, previous.context);
              return { ...effectiveMatch, context: previous.context, availability: { ...availability(previous.context), contextStatus: "stale" }, contextError: "degraded_refresh_preserved_previous" };
            }
            contextsRefreshed += 1;
            const effectiveMatch = reconcileMatchWithTxlineContext(match, context);
            configureMatch(effectiveMatch, context);
            return { ...effectiveMatch, context, availability: availability(context) };
          } catch (error) {
            if (previous?.context) {
              const effectiveMatch = reconcileMatchWithTxlineContext(match, previous.context);
              configureMatch(effectiveMatch, previous.context);
              return { ...effectiveMatch, context: previous.context, availability: { ...availability(previous.context), contextStatus: "stale" } };
            }
            configureMatch(match);
            return { ...match, context: null, availability: { ...availability(null), contextStatus: "unavailable" }, contextError: error?.message ?? "context_unavailable" };
          }
        });
        const generatedAt = new Date(now()).toISOString();
        const projected = enriched.map((match) => {
          const consumerProjection = deriveFixtureConsumerProjection({ fixture: match, txlineContext: match.context, evaluatedAt: generatedAt });
          return { ...match, consumerProjection, availability: projectedAvailability(consumerProjection, match.context, match.availability?.contextStatus) };
        });
        const ranked = rankFixtureConsumerProjections(projected.map((match) => match.consumerProjection));
        const featuredFixtureId = ranked.find((projection) => Number.isFinite(projection.editorial.priority))?.fixture.fixtureId ?? ranked[0]?.fixture.fixtureId ?? null;
        const next = { version: SNAPSHOT_VERSION, source: "txline", cacheSource: "server", generatedAt, featuredFixtureId, refreshReason: reason, materialization: { contextsRefreshed, contextsReused, concurrency }, matches: projected };
        snapshot = next;
        lastError = null;
        await persist(next).catch((error) => { lastError = `persist:${error.message}`; });
        return decorate("refreshed");
      } catch (error) {
        lastError = error?.message ?? "catalog_refresh_failed";
        if (snapshot) return decorate("stale");
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function get({ allowColdWait = true } = {}) {
    if (!snapshot) {
      if (!allowColdWait) return null;
      return refresh("cold-start");
    }
    const ageMs = now() - Date.parse(snapshot.generatedAt);
    if (ageMs >= freshMs) void refresh("stale-while-revalidate");
    return decorate(ageMs >= freshMs ? "stale" : "hit");
  }

  function start() {
    if (interval) return;
    interval = setInterval(() => {
      void refresh("interval").catch(() => undefined);
    }, refreshMs);
    interval.unref?.();
    void refresh("startup").catch(() => undefined);
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
  }

  function status() {
    return { hydrated: Boolean(snapshot), refreshing: Boolean(refreshPromise), generatedAt: snapshot?.generatedAt ?? null, matchCount: snapshot?.matches?.length ?? 0, lastError, freshMs, refreshMs };
  }

  return { hydrate, refresh, get, start, stop, status };
}
