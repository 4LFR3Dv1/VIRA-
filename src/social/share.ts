const API_ORIGIN = import.meta.env.VITE_VIRA_API_ORIGIN ?? (import.meta.env.PROD ? window.location.origin : "http://127.0.0.1:8787");

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

export function createRoomShare(input: { roomId: string; participantId: string; sessionToken: string; displayName: string; kind: "room" | "result" }) {
  return fetch(`${API_ORIGIN}/shares`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vira-Public-Token": getPublicToken() }, body: JSON.stringify(input) }).then((response) => json<ShareResponse>(response));
}

export function createPredictionShare(input: { fixtureId: string; displayName: string; choice: "home" | "draw" | "away" }) {
  return fetch(`${API_ORIGIN}/predictions`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vira-Public-Token": getPublicToken() }, body: JSON.stringify(input) }).then((response) => json<ShareResponse & { prediction: { id: string; choice: string } }>(response));
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
