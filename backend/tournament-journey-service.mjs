import { fetchHistoricalScores } from "./txline-client.mjs";
import { OBSERVED_TOURNAMENT_FIXTURES_V1 } from "./tournament-journey-observed.mjs";
import { buildTournamentJourneyProjection, projectionFromProviderFixture, terminalResultFromTxlineHistory } from "./tournament-journey.mjs";

const REGULAR_MATCH_TERMINAL_CHECK_MS = 90 * 60_000;

export function shouldRecoverTerminalHistory({ stage, status, kickoffAt, result, nowMs }) {
  if (result?.authority === "txline_terminal_history") return false;
  if (["postponed", "cancelled"].includes(status)) return false;
  if (stage === "semi_final" || status === "finished") return true;
  const kickoffMs = Date.parse(String(kickoffAt ?? ""));
  return Number.isFinite(kickoffMs) && nowMs >= kickoffMs + REGULAR_MATCH_TERMINAL_CHECK_MS;
}

export function shouldPreserveTerminalProjection(previous, incomingProjection) {
  return previous?.result?.authority === "txline_terminal_history" && incomingProjection?.fixture?.status !== "finished";
}

export function createTournamentJourneyService({ store, manifest, txlineConfig, fetchHistory = fetchHistoricalScores, now = () => new Date(), refreshMs = 30_000, historyRetryMs = 5 * 60_000 }) {
  let refreshPromise = null;
  let lastRefreshAt = 0;
  const historyCheckedAt = new Map();

  async function seedObserved(localeContext = {}) {
    for (const payload of OBSERVED_TOURNAMENT_FIXTURES_V1) {
      if (!manifest.fixtures.some((item) => String(item.fixtureId) === String(payload.FixtureId))) continue;
      if (store.get(payload.FixtureId)?.projection) continue;
      await store.record({
        fixtureId: payload.FixtureId, payload, origin: "/api/fixtures/snapshot", observedAt: new Date(payload.Ts).toISOString(),
        receivedAt: "2026-07-14T04:41:00.000Z", freshness: "archived", projection: projectionFromProviderFixture(payload, { localeContext }),
      });
    }
  }

  async function refresh(catalog, { force = false, localeContext = {} } = {}) {
    if (refreshPromise) return refreshPromise;
    if (!force && Date.now() - lastRefreshAt < refreshMs) return projection(localeContext);
    refreshPromise = (async () => {
      await seedObserved(localeContext);
      const current = new Map((catalog?.matches ?? []).map((item) => [String(item.fixtureId), item]));
      for (const position of manifest.fixtures) {
        const id = String(position.fixtureId);
        const match = current.get(id);
        const previous = store.get(id);
        if (match) {
          const payload = match.raw ?? match;
          const incomingProjection = match.consumerProjection ?? projectionFromProviderFixture(payload, { localeContext });
          const preserveTerminalProjection = shouldPreserveTerminalProjection(previous, incomingProjection);
          await store.record({ fixtureId: id, payload, origin: "/api/fixtures/snapshot", observedAt: payload.Ts ? new Date(Number(payload.Ts)).toISOString() : catalog?.generatedAt ?? null, receivedAt: catalog?.generatedAt ?? now().toISOString(), providerSequence: payload.Seq ?? null, freshness: catalog?.cache?.stale ? "stale" : "fresh", projection: preserveTerminalProjection ? null : incomingProjection });
        }
        const archived = store.get(id);
        const status = match?.consumerProjection?.fixture?.status ?? archived?.projection?.fixture?.status;
        const checkedAt = historyCheckedAt.get(id) ?? 0;
        const nowMs = now().getTime();
        const shouldResolve = shouldRecoverTerminalHistory({ stage: position.stage, status, kickoffAt: match?.consumerProjection?.fixture?.kickoffAt ?? archived?.projection?.fixture?.kickoffAt ?? null, result: archived?.result, nowMs })
          && nowMs - checkedAt >= historyRetryMs;
        if (!shouldResolve) continue;
        historyCheckedAt.set(id, nowMs);
        try {
          const receivedAt = now().toISOString();
          const records = await fetchHistory(txlineConfig, id);
          const result = terminalResultFromTxlineHistory(id, records, { receivedAt });
          if (!result) continue;
          const identityPayload = match?.raw ?? archived?.observations?.find((item) => item.origin === "/api/fixtures/snapshot")?.payload;
          const terminalProjection = identityPayload ? projectionFromProviderFixture({ ...identityPayload, GameState: "game_finalised" }, { evaluatedAt: receivedAt, localeContext }) : archived?.projection;
          await store.record({ fixtureId: id, payload: result.terminalPayload, origin: result.origin, observedAt: result.observedAt, receivedAt, providerSequence: result.providerSequence, freshness: "terminal", projection: terminalProjection, result });
        } catch {
          // Fail closed. The public projection keeps Result unavailable until TxLINE terminal authority is recovered.
        }
      }
      lastRefreshAt = Date.now();
      return projection(localeContext);
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function projection(localeContext = {}) {
    return buildTournamentJourneyProjection({ manifest, archive: store.all(), evaluatedAt: now().toISOString(), localeContext });
  }

  return { seedObserved, refresh, projection };
}
