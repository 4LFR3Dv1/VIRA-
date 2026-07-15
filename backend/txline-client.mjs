import { spawnSync } from "node:child_process";

import { classifyCompetition } from "./competition-registry.mjs";

const MAINNET_ORIGIN = "https://txline.txodds.com";
const DEVNET_ORIGIN = "https://txline-dev.txodds.com";

export function txlineConfigFromEnv(env = process.env) {
  const network = env.TXLINE_NETWORK === "devnet" ? "devnet" : "mainnet";
  return {
    network,
    origin: network === "devnet" ? DEVNET_ORIGIN : MAINNET_ORIGIN,
    jwt: env.TXLINE_JWT || "",
    apiToken: env.TXLINE_API_TOKEN || "",
    fixtureId: env.TXLINE_FIXTURE_ID || "",
  };
}

export function hasTxlineCredentials(config) {
  return Boolean(config.jwt && config.apiToken);
}

export async function txlineFetch(config, path) {
  if (!hasTxlineCredentials(config)) {
    const error = new Error("missing_txline_credentials");
    error.status = 503;
    throw error;
  }

  let response;
  try {
    response = await fetch(`${config.origin}${path}`, {
      headers: {
        Authorization: `Bearer ${config.jwt}`,
        "X-Api-Token": config.apiToken,
        Accept: "application/json",
        "User-Agent": "VIRA-Hackathon/1.0",
      },
    });
  } catch (cause) {
    return txlineFetchWithCurl(config, path, cause);
  }

  if (!response.ok) {
    const error = new Error(`txline_request_failed:${response.status}`);
    error.status = response.status;
    error.body = await response.text().catch(() => "");
    throw error;
  }

  const text = await response.text();
  return parseTxlineBody(text);
}

function parseCurlJson({ stdout, statusCode, url, cause }) {
  let body = stdout;
  try {
    body = parseTxlineBody(stdout);
  } catch {
    body = stdout;
  }

  if (statusCode < 200 || statusCode >= 300) {
    const error = new Error(`txline_request_failed:${statusCode}`);
    error.status = statusCode || 502;
    error.body = body;
    error.cause = cause;
    throw error;
  }
  return body;
}

function parseTxlineBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const records = parseEventStreamBody(text);
    if (records) return records;
    throw error;
  }
}

function parseEventStreamBody(text) {
  const dataLines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  if (!dataLines.length) return null;

  const records = [];
  for (const line of dataLines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !("heartbeat" in parsed)) records.push(parsed);
    } catch {
      records.push(line);
    }
  }
  return records;
}

function runCurlJson(url, args, cause) {
  const result = spawnSync("curl.exe", [...args, "-w", "\n%{http_code}", url], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const error = new Error("txline_request_unreachable");
    error.status = 502;
    error.body = result.stderr || result.error?.message || cause?.message || "";
    error.cause = cause;
    throw error;
  }

  const output = result.stdout.trimEnd();
  const statusMatch = output.match(/\n(\d{3})$/);
  const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
  const stdout = statusMatch ? output.slice(0, statusMatch.index) : output;
  return parseCurlJson({ stdout, statusCode, url, cause });
}

function txlineFetchWithCurl(config, path, cause) {
  return runCurlJson(`${config.origin}${path}`, [
    "-sS",
    "--http1.1",
    "--retry",
    "3",
    "--retry-delay",
    "1",
    "--retry-all-errors",
    "-H",
    "User-Agent: VIRA-Hackathon/1.0",
    "-H",
    "Accept: application/json",
    "-H",
    `Authorization: Bearer ${config.jwt}`,
    "-H",
    `X-Api-Token: ${config.apiToken}`,
  ], cause);
}

export async function startGuestSession(config) {
  let response;
  try {
    response = await fetch(`${config.origin}/auth/guest/start`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": "VIRA-Hackathon/1.0",
      },
    });
  } catch (cause) {
    return runCurlJson(`${config.origin}/auth/guest/start`, [
      "-sS",
      "--http1.1",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "--retry-all-errors",
      "-X",
      "POST",
      "-H",
      "User-Agent: VIRA-Hackathon/1.0",
      "-H",
      "Accept: application/json",
    ], cause);
  }

  if (!response.ok) {
    const error = new Error(`txline_guest_session_failed:${response.status}`);
    error.status = response.status;
    error.body = await response.text().catch(() => "");
    throw error;
  }

  return response.json();
}

export async function fetchFixturesSnapshot(config) {
  return txlineFetch(config, "/api/fixtures/snapshot");
}

export async function fetchFixtureUpdates(config, epochDay, hourOfDay) {
  if (epochDay === undefined || hourOfDay === undefined) {
    const error = new Error("missing_fixture_update_interval");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/fixtures/updates/${epochDay}/${hourOfDay}`);
}

export async function fetchScoresSnapshot(config, fixtureId = config.fixtureId) {
  if (!fixtureId) {
    const error = new Error("missing_fixture_id");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/scores/snapshot/${fixtureId}`);
}

export async function fetchOddsSnapshot(config, fixtureId = config.fixtureId) {
  if (!fixtureId) {
    const error = new Error("missing_fixture_id");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/odds/snapshot/${fixtureId}`);
}

export async function fetchOddsUpdates(config, fixtureId = config.fixtureId) {
  if (!fixtureId) {
    const error = new Error("missing_fixture_id");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/odds/updates/${fixtureId}`);
}

export async function fetchOddsUpdatesInterval(config, epochDay, hourOfDay, interval) {
  if (epochDay === undefined || hourOfDay === undefined || interval === undefined) {
    const error = new Error("missing_odds_update_interval");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/odds/updates/${epochDay}/${hourOfDay}/${interval}`);
}

export async function fetchScoresUpdates(config, fixtureId = config.fixtureId) {
  if (!fixtureId) {
    const error = new Error("missing_fixture_id");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/scores/updates/${fixtureId}`);
}

export async function fetchScoresUpdatesInterval(config, epochDay, hourOfDay, interval) {
  if (epochDay === undefined || hourOfDay === undefined || interval === undefined) {
    const error = new Error("missing_score_update_interval");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/scores/updates/${epochDay}/${hourOfDay}/${interval}`);
}

export async function fetchHistoricalScores(config, fixtureId = config.fixtureId) {
  if (!fixtureId) {
    const error = new Error("missing_fixture_id");
    error.status = 400;
    throw error;
  }
  return txlineFetch(config, `/api/scores/historical/${fixtureId}`);
}

export async function fetchFixtureValidation(config, query = {}) {
  return txlineFetch(config, `/api/fixtures/validation${queryString(query)}`);
}

export async function fetchFixtureBatchValidation(config, query = {}) {
  return txlineFetch(config, `/api/fixtures/batch-validation${queryString(query)}`);
}

export async function fetchOddsValidation(config, query = {}) {
  return txlineFetch(config, `/api/odds/validation${queryString(query)}`);
}

export async function fetchScoresStatValidation(config, query = {}) {
  return txlineFetch(config, `/api/scores/stat-validation${queryString(query)}`);
}

function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function normalizeTxlineFixture(raw) {
  const fixtureId = String(raw?.FixtureId ?? raw?.fixtureId ?? raw?.id ?? "unknown-fixture");
  const participant1 = String(raw?.Participant1 ?? raw?.participant1 ?? raw?.homeTeam ?? "Team A");
  const participant2 = String(raw?.Participant2 ?? raw?.participant2 ?? raw?.awayTeam ?? "Team B");
  const participant1IsHome = raw?.Participant1IsHome ?? raw?.participant1IsHome ?? true;
  const homeTeam = participant1IsHome ? participant1 : participant2;
  const awayTeam = participant1IsHome ? participant2 : participant1;
  const rawStartTime = raw?.StartTime ?? raw?.startTime ?? null;
  const startTime = typeof rawStartTime === "number"
    ? new Date(rawStartTime).toISOString()
    : rawStartTime;
  const rawStatus = raw?.Status ?? raw?.status ?? raw?.GameState ?? raw?.gameState ?? "scheduled";
  const normalizedStatus = normalizeFixtureStatus(rawStatus);
  const startTimeMs = startTime ? new Date(startTime).getTime() : Number.NaN;
  const status = Number.isFinite(startTimeMs) && startTimeMs > Date.now() + 60_000
    ? "scheduled"
    : normalizedStatus;
  const competition = classifyCompetition(raw);
  return {
    id: fixtureId,
    fixtureId,
    title: `${homeTeam} vs ${awayTeam}`,
    competitionLabel: competition.displayName,
    competition,
    startTime,
    status,
    homeTeam,
    awayTeam,
    source: "txline",
    raw,
  };
}

export function applyFixtureLifecycleTimeout(fixture, { nowMs = Date.now(), maxLiveMs = 3 * 60 * 60 * 1_000 } = {}) {
  if (fixture?.status !== "live") return fixture;
  const kickoffMs = Date.parse(fixture.startTime ?? "");
  if (!Number.isFinite(kickoffMs) || nowMs < kickoffMs + maxLiveMs) return fixture;
  return {
    ...fixture,
    status: "finished",
    reportedStatus: "live",
    lifecycleResolution: "maximum_live_window_elapsed",
  };
}

function normalizeFixtureStatus(rawStatus) {
  const value = String(rawStatus ?? "scheduled").trim().toLowerCase().replace(/\s+/g, "_");
  if (["1", "live", "in_play", "inplay", "running", "started", "active"].includes(value)) return "live";
  if (["2", "3", "finished", "complete", "completed", "final", "ended", "closed", "ft", "full_time", "match_end", "game_finalised", "game_finalized"].includes(value)) return "finished";
  if (["0", "scheduled", "not_started", "pre_match", "prematch", "upcoming"].includes(value)) return "scheduled";
  if (["postponed", "delayed"].includes(value)) return "postponed";
  if (["cancelled", "canceled", "abandoned"].includes(value)) return "cancelled";
  return "unknown";
}

const MATCH_END_ACTIONS = new Set(["end", "match_end", "full_time", "fulltime", "game_finalised", "game_finalized"]);
const POSSESSION_ACTIONS = new Map([
  ["possession", { phase: "neutral", intensity: 0 }],
  ["safe_possession", { phase: "safe", intensity: 1 }],
  ["attack_possession", { phase: "attack", intensity: 2 }],
  ["danger_possession", { phase: "danger", intensity: 3 }],
  ["high_danger_possession", { phase: "high_danger", intensity: 4 }],
]);

export function classifyTxlineScoreAction(value, data = {}) {
  const action = String(value ?? "period").toLowerCase().replaceAll("-", "_");
  if (action === "action_discarded") return "action_discarded";
  if (action === "action_amend" || action.startsWith("amend_") || action.startsWith("amended_")) return "action_amended";
  if (MATCH_END_ACTIONS.has(action)) return "match_end";
  if (action === "goal") return "goal";
  if (action === "penalty" || action.startsWith("penalty_")) return "penalty";
  if (action === "corner" || action.startsWith("corner_")) return "corner";
  if (action === "shot" || action.startsWith("shot_")) return "shot";
  if (POSSESSION_ACTIONS.has(action)) return "possession";
  if (action === "var" || action === "var_end" || action.startsWith("video_assistant")) return "var";
  if (action === "yellow_card" || action === "red_card" || action === "card" || action.endsWith("_card")) return "card";
  if (action === "score_adjustment") return "score_adjustment";
  if (action.startsWith("unreliable_")) return "reliability";
  return "period";
}

function scoreAuthorityFor({ type, action, confirmed, outcome, hasAbsoluteScore }) {
  if (type === "goal" && confirmed === true) return "confirmed_action";
  if (type === "penalty" && confirmed === true && String(outcome ?? "").toLowerCase() === "scored") return "confirmed_action";
  if (!hasAbsoluteScore) return "none";
  if (type === "match_end") return "final";
  if (type === "action_discarded" || type === "score_adjustment") return "correction";
  if (type === "period" && ["period", "score", "score_snapshot", "snapshot"].includes(action)) return "snapshot";
  return "none";
}

export function normalizeTxlineScore(raw, { matchId, sequenceFallback = 0, source = "txline-live" } = {}) {
  const sequence = Number(raw?.seq ?? raw?.Seq ?? raw?.sequence ?? sequenceFallback);
  const fixtureId = String(raw?.fixtureId ?? raw?.FixtureId ?? matchId ?? "unknown-fixture");
  const eventType = String(raw?.type ?? raw?.eventType ?? raw?.EventType ?? raw?.Action ?? raw?.action ?? raw?.gameState ?? raw?.GameState ?? "period").toLowerCase();
  const action = eventType.replaceAll("-", "_");
  const type = classifyTxlineScoreAction(action, raw?.Data);
  const possession = type === "possession" ? POSSESSION_ACTIONS.get(action) : undefined;
  const isAmendment = type === "action_amended";
  const amendedRawAction = isAmendment
    ? raw?.Data?.Action ?? action.replace(/^amend(?:ed)?_/, "")
    : null;
  const amendedActionType = amendedRawAction ? classifyTxlineScoreAction(amendedRawAction) : null;
  const matchClockSec = Number(
    raw?.matchClockSec
      ?? raw?.MatchClockSec
      ?? raw?.clockSeconds
      ?? raw?.ClockSeconds
      ?? raw?.Clock?.Seconds
      ?? raw?.clock?.seconds
      ?? (isAmendment ? raw?.Data?.New?.Clock?.Seconds : undefined)
      ?? 0,
  );
  const participant1Total = raw?.Score?.Participant1?.Total;
  const participant2Total = raw?.Score?.Participant2?.Total;
  const hasScoreEnvelope = participant1Total && typeof participant1Total === "object" && participant2Total && typeof participant2Total === "object";
  const participant1Goals = Number(hasScoreEnvelope ? participant1Total.Goals ?? 0 : raw?.Stats?.["1"]);
  const participant2Goals = Number(hasScoreEnvelope ? participant2Total.Goals ?? 0 : raw?.Stats?.["2"]);
  const participant1IsHome = raw?.Participant1IsHome ?? true;
  const hasAbsoluteScore = Number.isFinite(participant1Goals) && Number.isFinite(participant2Goals);
  const absoluteScore = hasAbsoluteScore
    ? {
        home: participant1IsHome ? participant1Goals : participant2Goals,
        away: participant1IsHome ? participant2Goals : participant1Goals,
      }
    : null;
  const participant = Number(raw?.Participant ?? raw?.participant);
  const statValue = (side, field) => Number(raw?.Stats?.[side]?.[field] ?? raw?.Stats?.[side]?.Total?.[field] ?? raw?.Score?.[side]?.Total?.[field]);
  const statsFor = (side) => {
    const values = { shots: statValue(side, "Shots"), shotsOnTarget: statValue(side, "ShotsOnTarget"), corners: statValue(side, "Corners"), yellowCards: statValue(side, "YellowCards"), redCards: statValue(side, "RedCards") };
    const filtered = Object.fromEntries(Object.entries(values).filter(([, value]) => Number.isFinite(value)));
    return Object.keys(filtered).length ? filtered : null;
  };
  const participant1Stats = statsFor("Participant1");
  const participant2Stats = statsFor("Participant2");
  const cumulativeStats = participant1Stats || participant2Stats ? {
    home: participant1IsHome ? participant1Stats : participant2Stats,
    away: participant1IsHome ? participant2Stats : participant1Stats,
  } : null;

  const providerActionId = String(raw?.Id ?? raw?.id ?? raw?.ActionId ?? `${fixtureId}-${sequence}`);
  const eventRevisionId = `${fixtureId}:${providerActionId}:${sequence}:${action}`;
  const explicitConfirmation = raw?.Confirmed ?? raw?.confirmed;
  const requiresConfirmation = type === "goal" || type === "penalty" || type === "var";
  const confirmed = typeof explicitConfirmation === "boolean" ? explicitConfirmation : !requiresConfirmation;
  const outcome = raw?.Data?.New?.Outcome ?? raw?.Data?.Outcome ?? raw?.Outcome ?? null;

  return {
    id: eventRevisionId,
    eventRevisionId,
    providerActionId,
    matchId: fixtureId,
    sequence,
    occurredAt: String(raw?.ts ?? raw?.Ts ?? raw?.timestamp ?? raw?.Timestamp ?? new Date().toISOString()),
    matchClockSec,
    type,
    teamId: raw?.teamId ?? raw?.TeamId ?? raw?.participantId ?? raw?.ParticipantId,
    participantSide: participant === 1
      ? (participant1IsHome ? "home" : "away")
      : participant === 2
        ? (participant1IsHome ? "away" : "home")
        : null,
    possession: possession ? { ...possession } : undefined,
    absoluteScore,
    confirmed,
    confirmationState: explicitConfirmation === false ? "candidate" : explicitConfirmation === true ? "confirmed" : "not_required",
    sourceActionId: String(raw?.SourceActionId ?? raw?.ActionId ?? providerActionId),
    amendedActionType,
    discardedActionId: raw?.DiscardedActionId ?? raw?.Data?.ActionId ?? (type === "action_discarded" ? raw?.Id : null),
    outcome,
    scoreAuthority: scoreAuthorityFor({ type, action, confirmed, outcome, hasAbsoluteScore }),
    cumulativeStats,
    playerId: raw?.playerId ?? raw?.PlayerId ?? raw?.Data?.PlayerId ?? raw?.Data?.New?.PlayerId,
    payload: raw,
    source,
  };
}

export function normalizeTxlineOdds(raw, { matchId, sequenceFallback = 0, source = "txline-snapshot" } = {}) {
  const fixtureId = String(raw?.fixtureId ?? raw?.FixtureId ?? matchId ?? "unknown-fixture");
  const sequence = Number(raw?.Seq ?? raw?.seq ?? raw?.Sequence ?? raw?.sequence ?? sequenceFallback);
  const marketId = String(raw?.MessageId ?? raw?.messageId ?? raw?.Id ?? `${fixtureId}-odds`);
  const timestamp = raw?.Ts ?? raw?.ts ?? raw?.Timestamp ?? raw?.timestamp ?? "";
  const pctSignature = Array.isArray(raw?.Pct) ? raw.Pct.map(String).join(",") : "";
  const revision = Number.isFinite(sequence) && sequence > 0 ? sequence : timestamp || pctSignature || "snapshot";
  return {
    id: `${marketId}:${revision}`,
    matchId: fixtureId,
    sequence,
    occurredAt: normalizeOccurredAt(raw?.Ts ?? raw?.ts ?? raw?.Timestamp ?? raw?.timestamp),
    matchClockSec: Number(raw?.matchClockSec ?? raw?.MatchClockSec ?? raw?.clockSeconds ?? raw?.ClockSeconds ?? 0),
    type: "odds_shift",
    payload: raw,
    source,
  };
}

function normalizeOccurredAt(value) {
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (value) return String(value);
  return new Date().toISOString();
}
