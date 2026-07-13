import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

let backend: ChildProcess;
let origin = "";
let dataDir = "";
const e2eToken = crypto.randomBytes(32).toString("hex");

function freePort(): Promise<number> { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : 0)); }); }); }
async function waitForHealth() { await expect.poll(async () => { try { return (await fetch(`${origin}/health`)).status; } catch { return 0; } }, { timeout: 15_000 }).toBe(200); }
async function scenario(runId: string, action: "start" | "resolve") { return fetch(`${origin}/__e2e/scenario/${runId}/${action}`, { method: "POST", headers: { "X-Vira-E2E-Token": e2eToken } }); }
async function metrics() { return (await (await fetch(`${origin}/operational/metrics`)).json()).runtime as { sseClients: number; roundTimers: number } ; }
async function session(page: Page, roomId: string) { return page.evaluate((id) => ({ participantId: sessionStorage.getItem(`vira:${id}:participantId`), sessionToken: sessionStorage.getItem(`vira:${id}:sessionToken`) }), roomId); }
async function authenticatedState(roomId: string, identity: { participantId: string | null; sessionToken: string | null }) {
  const response = await fetch(`${origin}/rooms/${roomId}/state?participantId=${encodeURIComponent(identity.participantId ?? "")}`, { headers: { Authorization: `Bearer ${identity.sessionToken ?? ""}` } });
  expect(response.status).toBe(200); return response.json();
}
async function installTakeoverCounter(page: Page) { await page.evaluate(() => { (window as any).__viraResolutionTakeovers = 0; const observer = new MutationObserver(() => { const dialog = [...document.querySelectorAll('[role="dialog"]')].find((node) => node.textContent?.match(/Ranking atualizado/i)); if (dialog && !(dialog as HTMLElement).dataset.e2eCounted) { (dialog as HTMLElement).dataset.e2eCounted = "true"; (window as any).__viraResolutionTakeovers += 1; } }); observer.observe(document.body, { childList: true, subtree: true }); (window as any).__viraTakeoverObserver = observer; }); }
async function join(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: "Entrar na sala" });
  await dialog.getByPlaceholder("Nome na sala").fill(name);
  await dialog.getByRole("button", { name: "Entrar na sala" }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}
async function answerYes(page: Page) {
  await page.getByRole("button", { name: /SIM/i }).first().click();
  await page.getByRole("button", { name: /Confirmar palpite/i }).click();
  await expect(page.getByText(/Palpite confirmado/i).first()).toBeVisible();
}
async function close(context: BrowserContext) { await context.close().catch(() => undefined); }

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-browser-e2e-"));
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: dataDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: e2eToken, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "10", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForHealth();
});
test.afterAll(async () => { backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve)); await rm(dataDir, { recursive: true, force: true }); });

test("two isolated guests share, answer, resolve and receive the same ranking", async ({ browser }, testInfo) => {
  const runId = `run-${testInfo.repeatEachIndex}-${crypto.randomUUID().slice(0, 8)}`;
  const started = await scenario(runId, "start"); expect(started.status).toBe(200);
  const { roomId, inputAuthority } = await started.json() as { roomId: string; inputAuthority: string };
  expect(inputAuthority).toBe("captured_txline_test_fixture");
  const playerA = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const playerB = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  try {
    const pageA = await playerA.newPage(); await pageA.goto(`/match/${roomId}`); await join(pageA, "Ana");
    const shareResponse = pageA.waitForResponse((response) => response.url() === `${origin}/shares` && response.request().method() === "POST" && response.status() === 201);
    await pageA.getByRole("button", { name: /Convidar para a sala/i }).click();
    const share = await (await shareResponse).json() as { url: string };
    const pageB = await playerB.newPage(); await pageB.goto(new URL(new URL(share.url).pathname, origin).toString());
    await pageB.locator("[data-share-cta]").click(); await join(pageB, "Bruno");
    await expect(pageA.getByText("Bruno", { exact: true }).first()).toBeVisible();
    await expect(pageB.getByText("Ana", { exact: true }).first()).toBeVisible();
    await answerYes(pageA);
    const aBeforeRefresh = await session(pageA, roomId);
    const stateBeforeRefresh = await authenticatedState(roomId, aBeforeRefresh);
    const versionBeforeRefresh = stateBeforeRefresh.ledger.streamVersion;
    await pageA.reload();
    await expect(pageA.getByText(/Palpite confirmado/i).first()).toBeVisible();
    const aAfterRefresh = await session(pageA, roomId);
    expect(aAfterRefresh).toEqual(aBeforeRefresh);
    const stateAfterRefresh = await authenticatedState(roomId, aAfterRefresh);
    expect(stateAfterRefresh.roomId).toBe(roomId);
    expect(stateAfterRefresh.currentParticipantAnswer?.state).toBe("submitted");
    expect(stateAfterRefresh.ledger.streamVersion).toBe(versionBeforeRefresh);
    expect(stateAfterRefresh.participants.filter((participant: { id: string }) => participant.id === aAfterRefresh.participantId)).toHaveLength(1);
    await answerYes(pageB);
    await installTakeoverCounter(pageA); await installTakeoverCounter(pageB);
    const bIdentity = await session(pageB, roomId);
    await expect.poll(async () => (await metrics()).sseClients).toBe(2);
    await playerB.setOffline(true);
    await pageB.goto("about:blank");
    await expect.poll(async () => (await metrics()).sseClients, { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 20_000 }).toBe("locked");
    const lockedState = await authenticatedState(roomId, aAfterRefresh);
    const lateResponse = await fetch(`${origin}/rooms/${roomId}/rounds/${lockedState.currentRound.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${aAfterRefresh.sessionToken}` }, body: JSON.stringify({ participantId: aAfterRefresh.participantId, optionId: "yes", clientAnswerId: crypto.randomUUID(), roundVersion: lockedState.currentRound.version, sessionToken: aAfterRefresh.sessionToken }) });
    expect(lateResponse.ok).toBe(false);
    const resolved = await scenario(runId, "resolve"); expect(resolved.status).toBe(200);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 10_000 }).toBe("resolved");
    await expect(pageA.getByText(/Ranking atualizado/i).first()).toBeVisible();
    await playerB.setOffline(false);
    await pageB.goto(`/match/${roomId}`);
    await expect(pageB.getByText(/2 na sala/i).first()).toBeVisible();
    await expect(pageB.getByText(/conectado/i).first()).toBeVisible();
    const publicState = await (await fetch(`${origin}/public/rooms/${roomId}`)).json();
    expect(publicState.leaderboard).toHaveLength(2);
    expect(publicState.leaderboard.map((entry: { points: number }) => entry.points)).toEqual([100, 100]);
    expect(new Set(publicState.participants.map((participant: { id: string }) => participant.id)).size).toBe(2);
    expect(publicState.answerSummary.total).toBe(2);
    const [aFinal, bFinal] = await Promise.all([authenticatedState(roomId, aAfterRefresh), authenticatedState(roomId, bIdentity)]);
    expect(bFinal.ledger.streamVersion).toBe(aFinal.ledger.streamVersion);
    const canonicalResolution = (resolution: Record<string, any>) => ({ roundId: resolution.roundId, winningOptionId: resolution.winningOptionId, resolutionDomain: resolution.resolutionDomain, resolutionReason: resolution.resolutionReason, eventId: resolution.event?.id });
    expect(canonicalResolution(bFinal.lastResolution)).toEqual(canonicalResolution(aFinal.lastResolution));
    const neutralRanking = (entries: Array<Record<string, unknown>>) => entries.map(({ isCurrentUser: _isCurrentUser, ...entry }) => entry);
    expect(neutralRanking(bFinal.leaderboard)).toEqual(neutralRanking(aFinal.leaderboard));
    const verification = await (await fetch(`${origin}/public/rooms/${roomId}/verification`)).json();
    const replay = await (await fetch(`${origin}/public/rooms/${roomId}/rounds/${aFinal.lastResolution.roundId}/replay`)).json();
    expect(verification.status).toBe("verified");
    expect(verification.liveProjectionHash).toBe(verification.replayedProjectionHash);
    expect(verification.projectionMatches).toBe(true);
    expect(verification.rankingMatches).toBe(true);
    expect(replay.proof.hashChainValid).toBe(true);
    expect(replay.proof.projectionMatches).toBe(true);
    expect(replay.proof.rankingMatches).toBe(true);
    expect(replay.scoring.leaderboardAfterHash).toMatch(/^sha256:/);
    await pageB.goto("/matches");
    await pageB.getByRole("button", { name: "Abrir Revisao Oficial", exact: true }).click();
    const review = pageB.getByRole("dialog").filter({ hasText: "Revisão Oficial VIRA" });
    await expect(review.getByText("Verificação pendente", { exact: true })).toBeVisible();
    await expect(review.getByText("O resultado foi o mesmo", { exact: true })).toBeVisible();
    await expect(review.getByText("A classificação foi a mesma", { exact: true })).toBeVisible();
    await expect(review.locator("article").filter({ hasText: "Autoridade" }).getByText("PENDING", { exact: true })).toBeVisible();
    await expect(review.locator("article").filter({ hasText: "Reprodutibilidade" }).getByText("VALID", { exact: true })).toBeVisible();
    await pageB.goto(`/match/${roomId}`);
    await expect(pageB.getByText(/conectado/i).first()).toBeVisible();
    expect(await pageA.evaluate(() => (window as any).__viraResolutionTakeovers)).toBe(1);
    const bPresentedResolutionIds = await pageB.evaluate((id) => { try { return (JSON.parse(localStorage.getItem(`vira:${id}:presentedEvents`) || "[]") as string[]).filter((value) => value.startsWith("round-resolved:")); } catch { return []; } }, roomId);
    expect(new Set(bPresentedResolutionIds).size).toBe(bPresentedResolutionIds.length);
    expect(bPresentedResolutionIds.length).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await metrics()).sseClients).toBe(2);
    await Promise.all([close(playerA), close(playerB)]);
    await expect.poll(async () => (await metrics()).sseClients, { timeout: 10_000 }).toBe(0);
  } finally { await Promise.all([close(playerA), close(playerB)]); }
});
