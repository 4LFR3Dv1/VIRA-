import { deriveFixtureConsumerProjection } from "../shared/fixture-consumer-projection.mjs";
import { normalizeTxlineFixture } from "./txline-client.mjs";
import { validateTournamentJourneyManifestV1 } from "./tournament-journey-manifest.mjs";

function scoreValue(goals, fallback) {
  const explicit = goals === undefined || goals === null ? Number.NaN : Number(goals);
  const observed = fallback === undefined || fallback === null ? Number.NaN : Number(fallback);
  const value = Number.isFinite(explicit) ? explicit : observed;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function terminalResultFromTxlineHistory(fixtureId, records, { receivedAt = new Date().toISOString(), origin = `/api/scores/historical/${fixtureId}` } = {}) {
  if (!Array.isArray(records)) return null;
  const terminal = [...records].reverse().find((record) => String(record?.FixtureId ?? record?.fixtureId) === String(fixtureId)
    && ["game_finalised", "game_finalized"].includes(String(record?.Action ?? record?.action ?? "").toLowerCase())
    && Number(record?.StatusId ?? record?.statusId) === 100);
  if (!terminal) return null;
  const participant1IsHome = terminal.Participant1IsHome ?? true;
  if (!terminal?.Score?.Participant1?.Total || !terminal?.Score?.Participant2?.Total) return null;
  const participant1 = scoreValue(terminal.Score.Participant1.Total.Goals, terminal?.Stats?.["1"]);
  const participant2 = scoreValue(terminal.Score.Participant2.Total.Goals, terminal?.Stats?.["2"]);
  if (participant1 === null || participant2 === null) return null;
  return {
    authority: "txline_terminal_history",
    homeScore: participant1IsHome ? participant1 : participant2,
    awayScore: participant1IsHome ? participant2 : participant1,
    providerSequence: terminal.Seq ?? terminal.seq ?? null,
    observedAt: terminal.Ts ? new Date(Number(terminal.Ts)).toISOString() : null,
    receivedAt,
    origin,
    freshness: "terminal",
    terminalPayload: terminal,
  };
}

export function buildTournamentJourneyProjection({ manifest, archive, evaluatedAt = new Date().toISOString(), localeContext = {} }) {
  validateTournamentJourneyManifestV1(manifest);
  const fixtures = manifest.fixtures.map((position) => {
    const stored = archive[String(position.fixtureId)] ?? null;
    return {
      fixtureId: String(position.fixtureId), stage: position.stage, slot: position.slot,
      structureAuthority: "editorial_manifest", resultAuthority: "txline", manifestVersion: manifest.manifestVersion,
      fixture: stored?.projection ?? null,
      result: stored?.result ? { ...stored.result, terminalPayload: undefined } : null,
      availability: stored?.projection ? "available" : "unavailable",
    };
  });
  const final = fixtures.find((item) => item.stage === "final");
  const finalStatus = final?.fixture?.fixture?.status;
  const terminal = finalStatus === "finished" && final?.result?.authority === "txline_terminal_history" ? final.result : null;
  const championSide = terminal ? (terminal.homeScore > terminal.awayScore ? "home" : terminal.awayScore > terminal.homeScore ? "away" : null) : null;
  const championTeam = championSide ? final.fixture.fixture[`${championSide}Team`].name : null;
  return {
    schemaVersion: 1, tournamentId: manifest.tournamentId, manifestVersion: manifest.manifestVersion,
    generatedAt: evaluatedAt, status: championTeam ? "complete" : "active", fixtures,
    champion: championTeam ? { name: championTeam, fixtureId: final.fixtureId, authority: "txline_terminal_history" } : null,
  };
}

export function projectionFromProviderFixture(raw, { evaluatedAt = new Date().toISOString(), localeContext = {} } = {}) {
  const fixture = normalizeTxlineFixture(raw);
  return deriveFixtureConsumerProjection({ fixture, evaluatedAt, localeContext });
}
