import { devices, expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
async function installTakeoverCounter(page: Page) { await page.evaluate(() => { (window as any).__viraResolutionTakeovers = 0; const observer = new MutationObserver(() => { const dialog = [...document.querySelectorAll('[role="dialog"]')].find((node) => node.textContent?.match(/Ranking (atualizado|updated)/i)); if (dialog && !(dialog as HTMLElement).dataset.e2eCounted) { (dialog as HTMLElement).dataset.e2eCounted = "true"; (window as any).__viraResolutionTakeovers += 1; } }); observer.observe(document.body, { childList: true, subtree: true }); (window as any).__viraTakeoverObserver = observer; }); }
async function join(page: Page, name: string) {
  const dialog = page.getByRole("dialog", { name: /Entrar na sala|Join room/i });
  await dialog.getByPlaceholder(/Nome na sala|Name in the room/i).fill(name);
  await dialog.getByRole("button", { name: /Entrar na sala|Join room/i }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}
async function answerYes(page: Page) {
  await page.getByRole("button", { name: /SIM|YES/i }).first().click();
  await page.getByRole("button", { name: /Confirmar palpite|Confirm prediction/i }).click();
  await expect(page.getByText(/Palpite confirmado|Prediction confirmed/i).first()).toBeVisible();
}
async function close(context: BrowserContext) { await context.close().catch(() => undefined); }
async function writeEvidence(testInfo: TestInfo, evidence: object) {
  const output = path.resolve("artifacts", `consumer-browser-e2e-${testInfo.project.name}.json`);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, serialized, "utf8");
  await testInfo.attach(path.basename(output), { body: Buffer.from(serialized), contentType: "application/json" });
}
async function captureVisual(page: Page, testInfo: TestInfo, name: string) {
  if (testInfo.repeatEachIndex !== 0) return;
  const directory = path.resolve("artifacts", "release-visual", testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: false });
}
async function captureCompanionVisual(page: Page, testInfo: TestInfo, name: string) {
  if (testInfo.repeatEachIndex !== 0) return;
  const directory = path.resolve("artifacts", "release-visual", testInfo.project.name);
  await mkdir(directory, { recursive: true });
  await page.locator('[data-companion-state]').screenshot({ path: path.join(directory, `${name}.png`) });
}

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-browser-e2e-"));
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: dataDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: e2eToken, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "30", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForHealth();
});
test.afterAll(async () => { backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve)); await rm(dataDir, { recursive: true, force: true }); });

test("two isolated guests share, answer, resolve and receive the same ranking", async ({ browser }, testInfo) => {
  const runId = `run-${testInfo.repeatEachIndex}-${crypto.randomUUID().slice(0, 8)}`;
  const started = await scenario(runId, "start"); expect(started.status).toBe(200);
  const { roomId, inputAuthority } = await started.json() as { roomId: string; inputAuthority: string };
  expect(inputAuthority).toBe("captured_txline_test_fixture");
  const { defaultBrowserType: _defaultBrowserType, ...mobileDevice } = devices["iPhone 13"];
  const contextOptions = testInfo.project.name === "mobile-webkit" ? { ...mobileDevice, baseURL: origin, reducedMotion: "reduce" as const } : { baseURL: origin, reducedMotion: "reduce" as const };
  const playerA = await browser.newContext(contextOptions);
  const playerB = await browser.newContext(contextOptions);
  let nativePipEvidence: "opened" | "unsupported" = "unsupported";
  try {
    await playerA.addInitScript(() => { Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined }); });
    const pageA = await playerA.newPage(); await pageA.goto(`/match/${roomId}?lang=en`); await join(pageA, "Ana");
    const aAfterJoin = await session(pageA, roomId);
    const versionBeforeFollow = (await authenticatedState(roomId, aAfterJoin)).ledger.streamVersion;
    await pageA.getByRole("button", { name: /Follow match|Seguir partida/i }).click();
    const companionA = pageA.locator('[data-companion-state]');
    await expect(companionA).toHaveAttribute("data-companion-state", "round_open");
    expect((await authenticatedState(roomId, aAfterJoin)).ledger.streamVersion).toBe(versionBeforeFollow);
    await captureVisual(pageA, testInfo, "companion-round-open-en");
    await captureCompanionVisual(pageA, testInfo, "companion-card-round-open-en");
    const identityBeforeCompact = await session(pageA, roomId);
    await pageA.getByRole("button", { name: /Open compact view|Abrir visão compacta/i }).click();
    await expect(pageA).toHaveURL(new RegExp(`/match/${roomId}/companion\\?lang=en`));
    await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "round_open");
    expect(await session(pageA, roomId)).toEqual(identityBeforeCompact);
    expect((await authenticatedState(roomId, identityBeforeCompact)).ledger.streamVersion).toBe(versionBeforeFollow);
    await captureVisual(pageA, testInfo, "companion-compact-fallback-en");
    await pageA.getByRole("button", { name: /Return to room|Voltar à sala/i }).click();
    await expect(pageA).toHaveURL(new RegExp(`/match/${roomId}\\?lang=en`));
    await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "round_open");
    const shareResponse = pageA.waitForResponse((response) => response.url() === `${origin}/shares` && response.request().method() === "POST" && response.status() === 201);
    await pageA.getByRole("button", { name: /Convidar para a sala|Invite to the room/i }).click();
    const share = await (await shareResponse).json() as { url: string };
    await expect(pageA.getByRole("dialog", { name: /Compartilhe este momento|Share this moment/i })).toBeVisible();
    await expect.poll(() => pageA.getByAltText(/Prévia do card|Preview of the VIRA share card/i).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200);
    await captureVisual(pageA, testInfo, "share-sheet-en");
    await pageA.getByRole("button", { name: /Fechar compartilhamento|Close share sheet/i }).click();
    const pageB = await playerB.newPage(); await pageB.goto(new URL(new URL(share.url).pathname, origin).toString());
    await pageB.locator("[data-share-cta]").click(); await join(pageB, "Bruno");
    await expect(pageA.getByText("Bruno", { exact: true }).first()).toBeVisible();
    await expect(pageB.getByText("Ana", { exact: true }).first()).toBeVisible();
    const nativePipSupported = testInfo.project.name === "chromium-desktop" && await pageB.evaluate(() => typeof (window as Window & { documentPictureInPicture?: unknown }).documentPictureInPicture !== "undefined");
    if (nativePipSupported) {
      const bBeforePip = await session(pageB, roomId);
      const versionBeforePip = (await authenticatedState(roomId, bBeforePip)).ledger.streamVersion;
      await pageB.getByRole("button", { name: /Follow match|Seguir partida/i }).click();
      const pipPagePromise = playerB.waitForEvent("page");
      await pageB.getByRole("button", { name: /Open floating|Abrir flutuante/i }).click();
      const pipPage = await pipPagePromise;
      await pipPage.setViewportSize({ width: 420, height: 560 });
      await expect(pipPage.getByText("VIRA Companion", { exact: true })).toBeVisible();
      await expect(pipPage.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "round_open");
      expect((await authenticatedState(roomId, bBeforePip)).ledger.streamVersion).toBe(versionBeforePip);
      await captureVisual(pipPage, testInfo, "companion-document-pip-en");
      await pipPage.getByRole("button", { name: /Return to room|Voltar à sala/i }).click();
      await expect.poll(() => pipPage.isClosed()).toBe(true);
      expect(await session(pageB, roomId)).toEqual(bBeforePip);
      nativePipEvidence = "opened";
    }
    await captureVisual(pageA, testInfo, "shared-room-en");
    await answerYes(pageA);
    await expect(companionA).toHaveAttribute("data-companion-state", "answer_confirmed");
    await expect(companionA).toContainText(/Answer confirmed/i);
    await captureVisual(pageA, testInfo, "companion-answer-confirmed-en");
    const aBeforeRefresh = await session(pageA, roomId);
    const stateBeforeRefresh = await authenticatedState(roomId, aBeforeRefresh);
    const versionBeforeRefresh = stateBeforeRefresh.ledger.streamVersion;
    await pageA.getByRole("button", { name: "Portuguese" }).click();
    await expect(pageA.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(pageA.getByText(/Palpite confirmado|Seu palpite está em jogo/i).first()).toBeVisible();
    await expect(pageA.locator('[data-companion-state]')).toContainText(/Resposta confirmada/i);
    await captureVisual(pageA, testInfo, "answer-preserved-pt-BR");
    expect(await session(pageA, roomId)).toEqual(aBeforeRefresh);
    await pageA.getByRole("button", { name: "Inglês" }).click();
    await expect(pageA.locator("html")).toHaveAttribute("lang", "en");
    await expect(pageA.getByText(/Prediction confirmed|Your prediction is in play/i).first()).toBeVisible();
    await expect(pageA.locator('[data-companion-state]')).toContainText(/Answer confirmed/i);
    const aAfterLocaleSwitch = await session(pageA, roomId);
    expect(aAfterLocaleSwitch).toEqual(aBeforeRefresh);
    const stateAfterLocaleSwitch = await authenticatedState(roomId, aAfterLocaleSwitch);
    expect(stateAfterLocaleSwitch.roomId).toBe(roomId);
    expect(stateAfterLocaleSwitch.currentParticipantAnswer?.state).toBe("submitted");
    expect(stateAfterLocaleSwitch.ledger.streamVersion).toBe(versionBeforeRefresh);
    expect(stateAfterLocaleSwitch.participants.filter((participant: { id: string }) => participant.id === aAfterLocaleSwitch.participantId)).toHaveLength(1);
    await pageA.reload();
    await expect(pageA.locator("html")).toHaveAttribute("lang", "en");
    await expect(pageA.getByText(/Prediction confirmed|Your prediction is in play/i).first()).toBeVisible();
    await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "answer_confirmed");
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
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 40_000 }).toBe("locked");
    await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "locked");
    await captureVisual(pageA, testInfo, "companion-locked-en");
    await captureCompanionVisual(pageA, testInfo, "companion-card-locked-en");
    const lockedState = await authenticatedState(roomId, aAfterRefresh);
    const lateResponse = await fetch(`${origin}/rooms/${roomId}/rounds/${lockedState.currentRound.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${aAfterRefresh.sessionToken}` }, body: JSON.stringify({ participantId: aAfterRefresh.participantId, optionId: "yes", clientAnswerId: crypto.randomUUID(), roundVersion: lockedState.currentRound.version, sessionToken: aAfterRefresh.sessionToken }) });
    expect(lateResponse.ok).toBe(false);
    const resolved = await scenario(runId, "resolve"); expect(resolved.status).toBe(200);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 10_000 }).toBe("resolved");
    await expect(pageA.getByText(/Ranking (atualizado|updated)/i).first()).toBeVisible();
    await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "resolved");
    await expect(pageA.locator('[data-companion-state]')).toContainText(/\+100/);
    await expect(pageA.locator('[data-companion-state]')).toContainText(/#1/);
    const backToRoom = pageA.getByRole("button", { name: /Back to room|Voltar à sala/i });
    if (await backToRoom.isVisible()) await backToRoom.click();
    await captureVisual(pageA, testInfo, "companion-resolved-en");
    await captureCompanionVisual(pageA, testInfo, "companion-card-resolved-en");
    await playerB.setOffline(false);
    await pageB.goto(`/match/${roomId}`);
    await expect(pageB.getByText(/2 (na sala|in the room)/i).first()).toBeVisible();
    await expect(pageB.getByText(/conectado|connected/i).first()).toBeVisible();
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
    const reviewButton = testInfo.project.name === "mobile-webkit"
      ? pageB.getByRole("button", { name: /Revisão|Review/i })
      : pageB.getByRole("button", { name: /Abrir Revisão Oficial|Open Official Review/i });
    await reviewButton.click();
    const review = pageB.getByRole("dialog").filter({ hasText: /Revisão Oficial VIRA|VIRA Official Review/i });
    await expect(review.getByText(/Reprodutibilidade válida|Reproducibility valid/i, { exact: true })).toBeVisible();
    await expect(review.getByText(/Fixture de teste TxLINE capturada|Captured TxLINE test fixture/i)).toBeVisible();
    await expect(review.getByText(/O replay produziu o mesmo resultado e ranking|Replay produced the same result and ranking/i)).toBeVisible();
    await expect(review.getByText(/Janela autoritativa, regra e cadeia do ledger são válidas|authoritative window, rule and ledger chain are valid/i)).toBeVisible();
    await expect.poll(async () => (await review.boundingBox())?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(800);
    await captureVisual(pageB, testInfo, "official-review");
    await pageB.goto(`/match/${roomId}`);
    await expect(pageB.getByText(/conectado|connected/i).first()).toBeVisible();
    expect(await pageA.evaluate(() => (window as any).__viraResolutionTakeovers)).toBe(1);
    const bPresentedResolutionIds = await pageB.evaluate((id) => { try { return (JSON.parse(localStorage.getItem(`vira:${id}:presentedEvents`) || "[]") as string[]).filter((value) => value.startsWith("round-resolved:")); } catch { return []; } }, roomId);
    expect(new Set(bPresentedResolutionIds).size).toBe(bPresentedResolutionIds.length);
    expect(bPresentedResolutionIds.length).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await metrics()).sseClients).toBe(2);
    await Promise.all([close(playerA), close(playerB)]);
    await expect.poll(async () => (await metrics()).sseClients, { timeout: 10_000 }).toBe(0);
    await writeEvidence(testInfo, {
      schemaVersion: 1,
      kind: "VIRA_CONSUMER_BROWSER_E2E",
      runId,
      project: testInfo.project.name,
      emulation: testInfo.project.name === "mobile-webkit" ? "Playwright WebKit with iPhone 13 emulation; not real-device Safari evidence" : "Chromium desktop",
      passed: true,
      inputAuthority,
      configurationTransition: "harness_materialization_not_scheduled_to_live",
      lock: { authority: "authoritative_room_runtime", state: lockedState.currentRound.state, reason: lockedState.currentRound.lockReason, persisted: true },
      identities: { playerAPreservedAfterRefresh: JSON.stringify(aAfterRefresh) === JSON.stringify(aBeforeRefresh), roomPreserved: stateAfterRefresh.roomId === roomId, participantCount: publicState.participants.length, uniqueParticipants: new Set(publicState.participants.map((participant: { id: string }) => participant.id)).size, confirmedAnswers: publicState.answerSummary.total },
      versions: { beforeRefresh: versionBeforeRefresh, afterRefresh: stateAfterRefresh.ledger.streamVersion, finalA: aFinal.ledger.streamVersion, finalB: bFinal.ledger.streamVersion },
      sse: { beforeOffline: 2, whileDisconnected: 1, afterReconnect: 2, afterClose: 0, orphanListeners: 0 },
      companion: { nativeDocumentPip: nativePipEvidence, compactFallback: true, streamVersionUnchangedByFollow: true },
      hashes: { liveProjectionHash: verification.liveProjectionHash, replayedProjectionHash: verification.replayedProjectionHash, projectionMatches: verification.projectionMatches, rankingMatches: verification.rankingMatches, leaderboardAfterHash: replay.scoring.leaderboardAfterHash },
      security: { tokensArchived: false, participantIdsArchived: false, requestHeadersArchived: false, traceDisabled: true },
    });
  } finally { await Promise.all([close(playerA), close(playerB)]); }
});
