import { resolveBrowserTimeZone } from "../i18n/formatters.ts";
import { resolveBrowserLocale, type SupportedLocale } from "../i18n/locale.ts";
import type { FixtureConsumerProjection } from "../runtime/api.ts";

const API_ORIGIN = import.meta.env.VITE_VIRA_API_ORIGIN ?? (import.meta.env.PROD ? window.location.origin : "http://127.0.0.1:8787");

export type EditorialRequestContext = { locale: SupportedLocale; timeZone: string };

export function getPublicToken() {
  const key = "vira:publicToken";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
  return created;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`social_request_failed:${response.status}`);
  return response.json() as Promise<T>;
}

export type ShareResponse = { share: { publicCode: string; miniLeagueId?: string; metadata: { title: string; description: string } }; url: string };

export function createRoomShare(input: { roomId: string; participantId: string; sessionToken: string; displayName: string; kind: "room" | "result" }, context?: EditorialRequestContext) {
  return fetch(`${API_ORIGIN}/shares`, { method: "POST", headers: editorialHeaders(context), body: JSON.stringify(input) }).then((response) => json<ShareResponse>(response));
}

export function createGuidedPlaybackShare(roomId: string, context?: EditorialRequestContext) {
  return fetch(`${API_ORIGIN}/public/playback/share`, { method: "POST", headers: editorialHeaders(context), body: JSON.stringify({ roomId }) }).then((response) => json<ShareResponse>(response));
}

export function createPredictionShare(input: { fixtureId: string; displayName: string; choice: "home" | "draw" | "away"; inviteCode?: string | null }, context?: EditorialRequestContext) {
  return fetch(`${API_ORIGIN}/predictions`, { method: "POST", headers: editorialHeaders(context), body: JSON.stringify(input) }).then((response) => json<ShareResponse & { prediction: { id: string; choice: string } }>(response));
}

export function savePrediction(input: { fixtureId: string; displayName: string; choice: "home" | "draw" | "away"; inviteCode?: string | null }) {
  return fetch(`${API_ORIGIN}/predictions`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vira-Public-Token": getPublicToken() }, body: JSON.stringify({ ...input, createShare: false }) }).then((response) => json<{ prediction: { id: string; choice: "home" | "draw" | "away"; status: "open" } }>(response));
}

export function shareSavedPrediction(fixtureId: string, context?: EditorialRequestContext) {
  return fetch(`${API_ORIGIN}/predictions/${encodeURIComponent(fixtureId)}/share`, { method: "POST", headers: editorialHeaders(context), body: "{}" }).then((response) => json<ShareResponse>(response));
}

function editorialHeaders(context?: EditorialRequestContext) {
  const resolved = context ?? { locale: resolveBrowserLocale().locale, timeZone: resolveBrowserTimeZone() };
  return { "Content-Type": "application/json", "X-Vira-Public-Token": getPublicToken(), "X-Vira-Locale": resolved.locale, "X-Vira-Time-Zone": resolved.timeZone };
}

export type HomeProjection = {
  version: 2;
  localeContext: { locale: string; timeZone: string; source: string };
  tournament: { id: string; name: string; status: string; generatedAt: string; outrightMarket: null; primaryFixture: HomeFixture | null };
  player: null | { publicId: string; displayName: string; points: number; streak: number; fixturePrediction: PredictionProjection | null; miniLeagues: Array<{ id: string; status: string; members: Array<{ publicId: string; displayName: string; points: number; rank: number }> }> };
  editorial: { kind: "join_live_room" | "predict_fixture" | "result_available" | "open_calendar"; authority: "txline_fixture_market" | "official_match_state"; fixture: HomeFixture | null; prediction: PredictionProjection | null; sourceSnapshotIds: string[]; generatedAt: string; expiresAt: string | null; copy?: { headline: string; scheduleLabel: string; marketStatement: string }; evidence?: { eligibility: unknown; rankScore: number; rankReasons: string[] } };
};

export type PredictionProjection = { choice: "home" | "draw" | "away"; status: "open" | "resolved"; correct?: boolean; winningChoice?: string; finalScore?: { home: number; away: number } };
export type HomeFixture = { fixtureId: string; competitionLabel: string; homeTeam: string; awayTeam: string; startTime: string | null; status: "scheduled" | "live" | "finished"; roomAvailable: boolean; temporal: { relation: "live" | "today" | "tomorrow" | "later_this_week" | "future" | "finished" | "unknown"; localKickoffDate: string | null; localKickoffTime: string | null; evaluatedAt: string; timeZone: string }; market: null | { authority: "txline_fixture_market"; type: "MATCH_RESULT_1X2"; selections: { home: number; draw: number; away: number }; leadingChoice: "home" | "draw" | "away"; freshness: { observedAt: string | null; staleAfter: string | null; usableForPrediction: boolean; currentForDisplay: boolean; currentForDirectionalClaim: boolean; reason: string } }; consumerProjection: FixtureConsumerProjection };

export function fetchHome(context?: EditorialRequestContext) {
  return fetch(`${API_ORIGIN}/home`, { headers: editorialHeaders(context) }).then((response) => json<HomeProjection>(response));
}

export function trackHome(type: "home.editorial_viewed" | "home.primary_action_clicked", editorialKind: string, fixtureId?: string) {
  return fetch(`${API_ORIGIN}/home/analytics`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vira-Public-Token": getPublicToken() }, body: JSON.stringify({ type, editorialKind, fixtureId }) }).then((response) => json<{ accepted: true }>(response));
}

export function fetchMyPrediction(fixtureId: string) {
  return fetch(`${API_ORIGIN}/predictions/${encodeURIComponent(fixtureId)}/me`, { headers: { "X-Vira-Public-Token": getPublicToken() } }).then((response) => json<{ prediction: { choice: "home" | "draw" | "away"; status: "open" | "resolved"; correct?: boolean; winningChoice?: string; finalScore?: { home: number; away: number } } | null }>(response));
}

export function fetchShare(publicCode: string) { return fetch(`${API_ORIGIN}/shares/${encodeURIComponent(publicCode)}`).then((response) => json<any>(response)); }
export function fetchMiniLeague(leagueId: string) { return fetch(`${API_ORIGIN}/mini-leagues/${encodeURIComponent(leagueId)}`).then((response) => json<{ id: string; members: Array<{ publicId: string; displayName: string; points: number; rank: number }> }>(response)); }

export async function presentShare(share: ShareResponse) {
  if (navigator.share) {
    await navigator.share({ title: share.share.metadata.title, text: share.share.metadata.description, url: share.url });
    return "shared";
  }
  await navigator.clipboard.writeText(share.url);
  return "copied";
}
