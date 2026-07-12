import type { PublicDomainEvent, RoundCommitmentStatus, RoomSnapshot, RoomVerification, VerifiedRoundReplayV1 } from "../domain/types";

const API_ORIGIN = import.meta.env.VITE_VIRA_API_ORIGIN
  ?? (import.meta.env.PROD ? window.location.origin : "http://127.0.0.1:8787");

export async function fetchBackendHealth(): Promise<boolean> {
  const response = await fetch(`${API_ORIGIN}/health`);
  return response.ok;
}

export interface MatchSummary {
  id: string;
  fixtureId: string;
  title: string;
  competitionLabel: string;
  competition?: CompetitionClassification;
  startTime: string | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  source: string;
}

export interface CompetitionClassification { providerCompetitionId: string | null; canonicalCompetitionId: string | null; name: string; displayName: string; kind: "world_cup" | "continental_cup" | "domestic_league" | "domestic_cup" | "friendly" | "qualifier" | "youth" | "other" | "unknown"; authority: "provider" | "registry" | "unmapped"; mapped: boolean; }
export interface CanonicalFixture1X2 { authority: "txline_fixture_market"; scope: "fixture"; type: "MATCH_RESULT_1X2"; fixtureId: string; marketSignature: string; snapshotId: string; observedAt: string | null; providerSequence: number | null; bookmakerId: string | number | null; selections: { home: number; draw: number; away: number }; leadingChoice: "home" | "draw" | "away"; }

export interface MatchesResponse {
  source: "txline";
  reason?: string;
  matches: MatchSummary[];
}

export interface MatchCatalogEntry extends MatchSummary {
  context: MatchTxlineContext | null;
  availability: {
    marketCount: number;
    observedMarketCount: number;
    focusMarketCount: number;
    canonical1X2Available: boolean;
    hasMarket: boolean;
    hasPlayablePrediction: boolean;
    contextStatus: "ready" | "stale" | "unavailable";
  };
  contextError?: string;
}

export interface MatchCatalogResponse {
  version: number;
  source: "txline";
  cacheSource: "server";
  generatedAt: string;
  materialization?: {
    contextsRefreshed: number;
    contextsReused: number;
    concurrency: number;
  };
  matches: MatchCatalogEntry[];
  cache: {
    status: "hit" | "refreshed" | "stale";
    strategy: "server-warm-swr";
    generatedAt: string;
    ageMs: number;
    freshMs: number;
    stale: boolean;
    refreshing: boolean;
    lastError: string | null;
  };
}

export interface TxlineEndpointSummary {
  count: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  firstSequence: number | null;
  lastSequence: number | null;
  eventTypes: Record<string, number>;
}

export interface TxlineEndpointContext<TData = unknown> {
  name: string;
  provider: "TxLINE";
  source: "txline";
  ok: boolean;
  endpoint: string;
  requestedAt: string;
  receivedAt: string;
  status?: number;
  error?: string;
  summary: TxlineEndpointSummary;
  data: TData | null;
}

export interface TxlineWinProbability {
  marketType: string;
  bookmaker: string;
  messageId: string | null;
  capturedAt: string | null;
  home: number;
  draw: number;
  away: number;
  priceNames: string[];
}

export interface TxlineMarketOption {
  priceName: string;
  label: string;
  pct: number | null;
  price: number | null;
}

export interface TxlineAvailableMarket {
  id: string;
  signature: string;
  sequence: number | null;
  fixtureId: string;
  messageId: string | null;
  marketType: string;
  label: string;
  bookmaker: string;
  bookmakerId: number | string | null;
  marketParameters: string | null;
  marketPeriod: string | null;
  inRunning: boolean;
  capturedAt: string | null;
  sourceEndpoint: string;
  priceNames: string[];
  options: TxlineMarketOption[];
  hasProbabilities: boolean;
  leadingOption: TxlineMarketOption | null;
}

export interface TxlineSuggestedPrediction {
  marketId: string;
  openingEventId: string;
  providerSequence: number | null;
  marketSignature: string;
  marketType: string;
  marketLabel: string;
  line: string | null;
  period: string | null;
  priceName: string;
  priceLabel: string;
  pct: number;
  operator: ">=";
  threshold: number;
  prompt: string;
  winningOption: "yes" | "no";
}

export interface TxlineLatestRecord {
  id: string;
  type: string;
  timestamp: string | null;
  sequence: number | null;
}

export interface MatchTxlineContext {
  fixtureId: string;
  provider: "TxLINE";
  generatedAt: string;
  cache?: {
    status: "hit" | "miss" | "refreshed";
    cachedAt: string;
    ttlMs: number;
  };
  fixture: {
    provider: "TxLINE";
    source: string;
    fixtureId: string;
    title: string;
    competitionLabel: string;
    status: string;
    startTime: string | null;
    homeTeam: string;
    awayTeam: string;
  };
  endpoints: {
    scores: TxlineEndpointContext<{ latest: TxlineLatestRecord[] }>;
    updates: TxlineEndpointContext<{ latest: TxlineLatestRecord[] }>;
    historical: TxlineEndpointContext<{ latest: TxlineLatestRecord[] }>;
    odds: TxlineEndpointContext<{ winProbability: TxlineWinProbability | null; availableMarkets: TxlineAvailableMarket[]; latest: TxlineLatestRecord[] }>;
    oddsUpdates: TxlineEndpointContext<{ availableMarkets: TxlineAvailableMarket[]; latest: TxlineLatestRecord[] }>;
  };
  availableMarkets: TxlineAvailableMarket[];
  canonical1X2: CanonicalFixture1X2 | null;
  marketTaxonomy: { observed: number; inFocus: number; canonical: number };
  suggestedPrediction: TxlineSuggestedPrediction | null;
}

export type TxlineProbeKind = "scores" | "updates" | "historical" | "odds";

export interface TxlineProbeResult {
  ok: boolean;
  status: number;
  endpoint: string;
  payload: unknown;
}

export interface JoinRoomResponse {
  participant: {
    id: string;
    displayName: string;
    initials: string;
  };
  sessionToken: string;
  roomVersion: number;
  reused?: boolean;
}

export async function joinRoom(roomId: string, displayName: string, admissionToken: string, publicToken?: string, inviteCode?: string | null): Promise<JoinRoomResponse> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, admissionToken, publicToken, inviteCode }),
  });
  if (!response.ok) throw new Error(`join_failed:${response.status}`);
  return response.json();
}

export async function fetchRoomState(roomId: string, participantId: string, sessionToken: string): Promise<RoomSnapshot> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/state?participantId=${encodeURIComponent(participantId)}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) throw new Error(`state_failed:${response.status}`);
  return response.json();
}

export async function validateRoomSession(roomId: string, participantId: string, sessionToken: string): Promise<{ valid: boolean; participant: { id: string; displayName: string } | null; roomVersion: number }> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/session/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participantId, sessionToken }),
  });
  if (!response.ok) throw new Error(`session_validation_failed:${response.status}`);
  return response.json();
}

export async function castRoomFanPulse(input: { roomId: string; participantId: string; sessionToken: string; side: "home" | "away" }): Promise<{ accepted: boolean; side: "home" | "away"; eventId: string; roomVersion: number }> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(input.roomId)}/fan-pulse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.sessionToken}` },
    body: JSON.stringify({ participantId: input.participantId, side: input.side }),
  });
  if (!response.ok) throw new Error(`fan_pulse_failed:${response.status}`);
  return response.json();
}

export async function fetchRoomVerification(roomId: string): Promise<RoomVerification> {
  const response = await fetch(`${API_ORIGIN}/public/rooms/${encodeURIComponent(roomId)}/verification`);
  if (!response.ok) throw new Error(`verification_failed:${response.status}`);
  return response.json();
}

export async function fetchVerifiedRoundReplay(roomId: string, roundId: string): Promise<VerifiedRoundReplayV1> {
  const response = await fetch(`${API_ORIGIN}/public/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/replay`);
  if (!response.ok) throw new Error(`round_replay_failed:${response.status}`);
  return response.json();
}

export async function fetchRoundCommitment(roomId: string, roundId: string): Promise<RoundCommitmentStatus> {
  const response = await fetch(`${API_ORIGIN}/public/rooms/${encodeURIComponent(roomId)}/rounds/${encodeURIComponent(roundId)}/commitment`);
  if (!response.ok) throw new Error(`round_commitment_failed:${response.status}`);
  return response.json();
}

export async function fetchPublicRoomProjection(roomId: string): Promise<RoomSnapshot> {
  const response = await fetch(`${API_ORIGIN}/public/rooms/${encodeURIComponent(roomId)}/projection`);
  if (!response.ok) throw new Error(`public_projection_failed:${response.status}`);
  return response.json();
}

export async function fetchPublicRoomEvents(roomId: string): Promise<{
  roomId: string;
  events: PublicDomainEvent[];
}> {
  const response = await fetch(`${API_ORIGIN}/public/rooms/${encodeURIComponent(roomId)}/events`);
  if (!response.ok) throw new Error(`public_events_failed:${response.status}`);
  return response.json();
}

export async function submitRoomAnswer(input: {
  roomId: string;
  roundId: string;
  participantId: string;
  sessionToken: string;
  optionId: string;
  roundVersion: number;
}): Promise<{
  accepted: boolean;
  eventId?: string;
  roundId: string;
  optionId: string;
  answeredAt: string;
  answerState: string;
}> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(input.roomId)}/rounds/${encodeURIComponent(input.roundId)}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participantId: input.participantId,
      sessionToken: input.sessionToken,
      optionId: input.optionId,
      clientAnswerId: crypto.randomUUID(),
      roundVersion: input.roundVersion,
    }),
  });
  if (!response.ok) throw new Error(`answer_failed:${response.status}`);
  return response.json();
}

export function roomEventsUrl(roomId: string, participantId?: string | null) {
  const suffix = participantId ? `?participantId=${encodeURIComponent(participantId)}` : "";
  return `${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/events${suffix}`;
}

export async function fetchMatches(): Promise<MatchesResponse> {
  const response = await fetch(`${API_ORIGIN}/matches`);
  if (!response.ok) throw new Error(`matches_failed:${response.status}`);
  return response.json();
}

export async function fetchMatchCatalog(): Promise<MatchCatalogResponse> {
  const response = await fetch(`${API_ORIGIN}/matches/catalog`);
  if (!response.ok) throw new Error(`match_catalog_failed:${response.status}`);
  return response.json();
}

export async function fetchMatchTxlineContext(fixtureId: string): Promise<MatchTxlineContext> {
  const response = await fetch(`${API_ORIGIN}/matches/${encodeURIComponent(fixtureId)}/txline-context`);
  if (!response.ok) throw new Error(`txline_context_failed:${response.status}`);
  return response.json();
}

export async function fetchTxlineProbe(kind: TxlineProbeKind, fixtureId: string): Promise<TxlineProbeResult> {
  const endpointByKind: Record<TxlineProbeKind, string> = {
    scores: "/txline/scores",
    updates: "/txline/scores/updates",
    historical: "/txline/scores/historical",
    odds: "/txline/odds",
  };
  const endpoint = `${endpointByKind[kind]}?fixtureId=${encodeURIComponent(fixtureId)}`;
  const response = await fetch(`${API_ORIGIN}${endpoint}`);
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    endpoint,
    payload,
  };
}

export async function fetchLatestTxlineOdds(roomId: string, fixtureId = roomId): Promise<{
  accepted: boolean;
  requestId: string;
  evidenceId?: string;
}> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/txline/ingest-odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fixtureId }),
  });
  if (!response.ok) throw new Error(`txline_odds_ingest_failed:${response.status}`);
  return response.json();
}

export interface TxlineStreamSingleStatus {
  connected: boolean;
  status: "idle" | "running" | "failed" | "stopped";
  kind?: "scores" | "odds";
  fixtureId?: string | null;
  endpoint?: string;
  acceptedMessages?: number;
  ignoredMessages?: number;
  lastMessageAt?: string | null;
  lastError?: string | null;
  startedAt?: string;
}

export interface TxlineStreamStatus {
  scores: TxlineStreamSingleStatus;
  odds: TxlineStreamSingleStatus;
}

export async function connectTxlineOddsStream(roomId: string, fixtureId = roomId): Promise<TxlineStreamSingleStatus> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/txline/connect-odds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fixtureId }),
  });
  if (!response.ok) throw new Error(`txline_odds_stream_connect_failed:${response.status}`);
  return response.json();
}

export async function disconnectTxlineStream(roomId: string, kind?: "scores" | "odds"): Promise<TxlineStreamStatus | TxlineStreamSingleStatus> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/txline/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  if (!response.ok) throw new Error(`txline_stream_disconnect_failed:${response.status}`);
  return response.json();
}

export async function fetchTxlineStreamStatus(roomId: string): Promise<TxlineStreamStatus> {
  const response = await fetch(`${API_ORIGIN}/rooms/${encodeURIComponent(roomId)}/txline/status`);
  if (!response.ok) throw new Error(`txline_stream_status_failed:${response.status}`);
  return response.json();
}
