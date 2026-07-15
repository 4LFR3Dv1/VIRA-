import { getPublicToken, type ShareResponse } from "../../social/share";
import { resolveBrowserTimeZone } from "../../i18n/formatters";
import type { SupportedLocale } from "../../i18n/locale";
import type { ViraPicksCardV1, ViraPicksCatalogV1 } from "./contracts";

const API_ORIGIN = import.meta.env.VITE_VIRA_API_ORIGIN ?? (import.meta.env.PROD ? window.location.origin : "http://127.0.0.1:8787");
const headers = (locale: SupportedLocale, json = false) => ({ ...(json ? { "Content-Type": "application/json" } : {}), "X-Vira-Public-Token": getPublicToken(), "X-Vira-Locale": locale, "X-Vira-Time-Zone": resolveBrowserTimeZone() });
async function read<T>(response: Response): Promise<T> { if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? `picks_request_failed:${response.status}`); } return response.json() as Promise<T>; }

export function fetchPicksCatalog(fixtureId: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/fixtures/${encodeURIComponent(fixtureId)}/catalog`, { headers: headers(locale) }).then(read<ViraPicksCatalogV1>); }
export function ensurePicksIdentity(displayName: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/public/identity`, { method: "POST", headers: headers(locale, true), body: JSON.stringify({ displayName }) }).then(read<{ publicId: string; displayName: string }>); }
export function fetchOwnerPicks(fixtureId: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/fixtures/${encodeURIComponent(fixtureId)}/me`, { headers: headers(locale) }).then(read<{ card: ViraPicksCardV1 | null }>); }
export function confirmPicks(fixtureId: string, selectionIds: readonly string[], idempotencyKey: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/cards`, { method: "POST", headers: headers(locale, true), body: JSON.stringify({ fixtureId, selectionIds, idempotencyKey }) }).then(read<{ card: ViraPicksCardV1 }>); }
export function fetchPublicPicks(publicCode: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/cards/public/${encodeURIComponent(publicCode)}`, { headers: headers(locale) }).then(read<{ card: ViraPicksCardV1; fixture: { homeTeam: string; awayTeam: string; kickoffAt: string; status: string } | null }>); }
export function trackPicksOpen(publicCode: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/cards/public/${encodeURIComponent(publicCode)}/open`, { method: "POST", headers: headers(locale, true), body: "{}" }).catch(() => undefined); }
export function sharePicks(cardId: string, locale: SupportedLocale) { return fetch(`${API_ORIGIN}/picks/cards/${encodeURIComponent(cardId)}/share`, { method: "POST", headers: headers(locale, true), body: "{}" }).then(read<ShareResponse>); }
