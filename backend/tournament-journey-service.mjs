import { fetchHistoricalScores } from "./txline-client.mjs";
import { OBSERVED_TOURNAMENT_FIXTURES_V1 } from "./tournament-journey-observed.mjs";
import { buildTournamentJourneyProjection, projectionFromProviderFixture, terminalResultFromTxlineHistory } from "./tournament-journey.mjs";

export function createTournamentJourneyService({ store, manifest, txlineConfig, fetchHistory = fetchHistoricalScores, now = () => new Date(), refreshMs = 30_000 }) {
  let refreshPromise = null;
  let lastRefreshAt = 0;

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
        if (match) {
          const payload = match.raw ?? match;
          await store.record({ fixtureId: id, payload, origin: "/api/fixtures/snapshot", observedAt: payload.Ts ? new Date(Number(payload.Ts)).toISOString() : catalog?.generatedAt ?? null, receivedAt: catalog?.generatedAt ?? now().toISOString(), providerSequence: payload.Seq ?? null, freshness: catalog?.cache?.stale ? "stale" : "fresh", projection: match.consumerProjection ?? projectionFromProviderFixture(payload, { localeContext }) });
        }
        const archived = store.get(id);
        const status = match?.consumerProjection?.fixture?.status ?? archived?.projection?.fixture?.status;
        const shouldResolve = !archived?.result && (position.stage === "semi_final" || status === "finished");
        if (!shouldResolve) continue;
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
