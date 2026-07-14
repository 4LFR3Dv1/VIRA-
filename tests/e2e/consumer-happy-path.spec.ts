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
let e2eVapidPublicKey = "";
let e2eVapidPrivateKey = "";

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
  const webPush = await import("web-push");
  const vapid = webPush.default.generateVAPIDKeys();
  e2eVapidPublicKey = vapid.publicKey;
  e2eVapidPrivateKey = vapid.privateKey;
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-browser-e2e-"));
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: dataDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: e2eToken, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "30", VIRA_WEB_PUSH_ENABLED: "true", VIRA_VAPID_PUBLIC_KEY: e2eVapidPublicKey, VIRA_VAPID_PRIVATE_KEY: e2eVapidPrivateKey, VIRA_VAPID_SUBJECT: "mailto:e2e@vira.invalid", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForHealth();
});
test.afterAll(async () => { backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve)); await rm(dataDir, { recursive: true, force: true }); });

test("two isolated guests share, answer, resolve and receive the same ranking", async ({ browser }, testInfo) => {
  const performanceProfile = process.env.VIRA_COMPANION_PROFILE ?? null;
  const visualCompanionEnabled = Boolean(performanceProfile);
  const runId = `run-${testInfo.repeatEachIndex}-${crypto.randomUUID().slice(0, 8)}`;
  const started = await scenario(runId, "start"); expect(started.status).toBe(200);
  const { roomId, inputAuthority } = await started.json() as { roomId: string; inputAuthority: string };
  expect(inputAuthority).toBe("captured_txline_test_fixture");
  const { defaultBrowserType: _defaultBrowserType, ...mobileDevice } = devices["iPhone 13"];
  const reducedMotion = performanceProfile ? "no-preference" as const : "reduce" as const;
  const contextOptions = testInfo.project.name === "mobile-webkit" ? { ...mobileDevice, baseURL: origin, reducedMotion } : { baseURL: origin, reducedMotion };
  const playerA = await browser.newContext(contextOptions);
  const playerB = await browser.newContext(contextOptions);
  if (performanceProfile && testInfo.project.name === "chromium-desktop") await playerB.addInitScript(() => {
    const counters = { renders: { in_app: 0, compact: 0, pip: 0 }, intervalsCreated: [] as number[], intervalsCleared: 0, activeIntervals: new Map<number, number>(), longTasks: [] as number[], lifecycle: {} as Record<string, number> };
    const nativeSetInterval = window.setInterval.bind(window); const nativeClearInterval = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => { const id = nativeSetInterval(handler, timeout, ...args); const delay = Number(timeout ?? 0); counters.intervalsCreated.push(delay); counters.activeIntervals.set(id, delay); return id; }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { if (typeof id === "number" && counters.activeIntervals.delete(id)) counters.intervalsCleared += 1; return nativeClearInterval(id); }) as typeof window.clearInterval;
    (window as any).__VIRA_COMPANION_RENDER_PROBE__ = (mode: "in_app" | "compact" | "pip") => { counters.renders[mode] += 1; };
    (window as any).__VIRA_COMPANION_LIFECYCLE_PROBE__ = (event: string) => { counters.lifecycle[event] = (counters.lifecycle[event] ?? 0) + 1; };
    try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) counters.longTasks.push(entry.duration); }).observe({ type: "longtask", buffered: true }); } catch {}
    (window as any).__VIRA_COMPANION_PERF__ = counters;
  });
  let nativePipEvidence: "opened" | "unsupported" = "unsupported";
  let companionPerformance: Record<string, unknown> | null = null;
  try {
    await playerA.addInitScript(() => { Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined }); });
    const pageA = await playerA.newPage();
    const remoteFontRequests: string[] = [];
    pageA.on("request", (request) => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) remoteFontRequests.push(request.url()); });
    await pageA.goto(`/match/${roomId}?lang=en`); await join(pageA, "Ana");
    await expect.poll(() => pageA.evaluate(() => ({ chakra: document.fonts.check('700 16px "Chakra Petch"'), sans: document.fonts.check('400 16px "DM Sans"'), mono: document.fonts.check('400 16px "DM Mono"') }))).toEqual({ chakra: true, sans: true, mono: true });
    expect(remoteFontRequests).toEqual([]);
    await expect.poll(() => pageA.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? ""), { timeout: 15_000 }).toMatch(/\/sw\.js$/);
    const manifestResponse = await pageA.request.get("/site.webmanifest");
    expect(manifestResponse.status()).toBe(200);
    expect((await manifestResponse.json()).display).toBe("standalone");
    const aAfterJoin = await session(pageA, roomId);
    const pushCapabilities = await pageA.evaluate(() => "Notification" in window && "serviceWorker" in navigator && "PushManager" in window);
    if (pushCapabilities) await expect(pageA.locator("[data-match-alerts-control]")).toBeVisible();
    else await expect(pageA.locator("[data-match-alerts-control]")).toHaveCount(0);
    const versionBeforeFollow = (await authenticatedState(roomId, aAfterJoin)).ledger.streamVersion;
    const companionA = pageA.locator('[data-companion-state]');
    if (visualCompanionEnabled) {
      await pageA.getByRole("button", { name: /Follow match|Seguir partida/i }).click();
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
    } else {
      await expect(companionA).toHaveCount(0);
      await expect(pageA.getByRole("button", { name: /Open floating|Abrir flutuante|Open compact view|Abrir visão compacta/i })).toHaveCount(0);
      expect((await authenticatedState(roomId, aAfterJoin)).ledger.streamVersion).toBe(versionBeforeFollow);
      await captureVisual(pageA, testInfo, "match-room-clean-after-en");
    }
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
    if (visualCompanionEnabled && nativePipSupported) {
      const bBeforePip = await session(pageB, roomId);
      const versionBeforePip = (await authenticatedState(roomId, bBeforePip)).ledger.streamVersion;
      await pageB.getByRole("button", { name: /Follow match|Seguir partida/i }).click();
      const pipPagePromise = playerB.waitForEvent("page");
      await pageB.getByRole("button", { name: /Open floating|Abrir flutuante/i }).click();
      const pipPage = await pipPagePromise;
      await pipPage.setViewportSize({ width: 420, height: 560 });
      await expect(pipPage.getByText("VIRA Companion", { exact: true })).toBeVisible();
      await expect(pipPage.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "round_open");
      const pagesWithPip = playerB.pages().length;
      await pageB.getByRole("button", { name: /Open floating|Abrir flutuante/i }).click();
      await expect.poll(() => playerB.pages().length).toBe(pagesWithPip);
      expect((await authenticatedState(roomId, bBeforePip)).ledger.streamVersion).toBe(versionBeforePip);
      if (performanceProfile) {
        const before = await pageB.evaluate(() => { const value = (window as any).__VIRA_COMPANION_PERF__; return { renders: { ...value.renders }, activeIntervals: [...value.activeIntervals.values()], intervalsCreated: [...value.intervalsCreated], intervalsCleared: value.intervalsCleared, longTasks: [...value.longTasks] }; });
        await pipPage.evaluate(() => { const value = { mutations: 0 }; const root = document.getElementById("vira-companion-pip-root"); const observer = new MutationObserver((records) => { value.mutations += records.length; }); if (root) observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true }); (window as any).__VIRA_PIP_DOM_PERF__ = { value, observer }; });
        const cdp = await playerB.newCDPSession(pipPage);
        const traceEvents: unknown[] = [];
        cdp.on("Tracing.dataCollected", ({ value }) => traceEvents.push(...value));
        const tracingComplete = new Promise<void>((resolve) => cdp.once("Tracing.tracingComplete", () => resolve()));
        await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.frame", transferMode: "ReportEvents" });
        await pipPage.waitForTimeout(5_000);
        await cdp.send("Tracing.end"); await tracingComplete;
        const during = await pageB.evaluate(() => { const value = (window as any).__VIRA_COMPANION_PERF__; return { renders: { ...value.renders }, activeIntervals: [...value.activeIntervals.values()], intervalsCreated: [...value.intervalsCreated], intervalsCleared: value.intervalsCleared, longTasks: [...value.longTasks] }; });
        const pip = await pipPage.evaluate(() => ({ mutations: (window as any).__VIRA_PIP_DOM_PERF__.value.mutations, styleSheets: document.styleSheets.length, linkedStyleSheets: document.querySelectorAll('link[rel="stylesheet"]').length, infiniteAnimations: document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations === Infinity).length, animations: document.getAnimations().length }));
        const performanceDirectory = path.resolve("artifacts", "performance"); await mkdir(performanceDirectory, { recursive: true });
        await writeFile(path.join(performanceDirectory, `companion-pip-${performanceProfile}-trace.json`), JSON.stringify({ traceEvents }), "utf8");
        companionPerformance = { label: performanceProfile, sampleMs: 5_000, before, during, pip, rendersDuringSample: { inApp: during.renders.in_app - before.renders.in_app, pip: during.renders.pip - before.renders.pip }, longTasksDuringSample: during.longTasks.length - before.longTasks.length };
      }
      await captureVisual(pipPage, testInfo, "companion-document-pip-en");
      await pipPage.getByRole("button", { name: /Return to room|Voltar à sala/i }).click();
      await expect.poll(() => pipPage.isClosed()).toBe(true);
      if (performanceProfile && companionPerformance) {
        const closedAt = await pageB.evaluate(() => { const value = (window as any).__VIRA_COMPANION_PERF__; return { renders: { ...value.renders }, activeIntervals: [...value.activeIntervals.values()], intervalsCleared: value.intervalsCleared }; });
        await pageB.waitForTimeout(2_000);
        const afterClose = await pageB.evaluate(() => { const value = (window as any).__VIRA_COMPANION_PERF__; return { renders: { ...value.renders }, activeIntervals: [...value.activeIntervals.values()], intervalsCleared: value.intervalsCleared }; });
        companionPerformance = { ...companionPerformance, closedAt, afterClose, pipRendersAfterClose: afterClose.renders.pip - closedAt.renders.pip };
        const performanceDirectory = path.resolve("artifacts", "performance"); await writeFile(path.join(performanceDirectory, `companion-pip-${performanceProfile}.json`), `${JSON.stringify(companionPerformance, null, 2)}\n`, "utf8");
      }
      expect(await session(pageB, roomId)).toEqual(bBeforePip);
      await pageB.getByRole("button", { name: "Portuguese" }).click();
      const portuguesePipPromise = playerB.waitForEvent("page");
      await pageB.getByRole("button", { name: /Abrir flutuante/i }).click();
      const portuguesePip = await portuguesePipPromise; await portuguesePip.setViewportSize({ width: 420, height: 560 });
      await expect(portuguesePip.locator('[data-companion-state]')).toContainText(/Responda agora/i);
      await captureVisual(portuguesePip, testInfo, "companion-document-pip-pt-BR");
      await portuguesePip.getByRole("button", { name: /Fechar/i }).click();
      await expect.poll(() => portuguesePip.isClosed()).toBe(true);
      await pageB.getByRole("button", { name: "Inglês" }).click();
      nativePipEvidence = "opened";
    }
    await captureVisual(pageA, testInfo, "shared-room-en");
    await answerYes(pageA);
    await expect(pageA.getByText("Your answer is private until the server locks the round.").first()).toBeVisible();
    await expect(pageA.getByText(/^You answered:/).first()).toBeHidden();
    if (visualCompanionEnabled) {
      await expect(companionA).toHaveAttribute("data-companion-state", "answer_confirmed");
      await expect(companionA).toContainText(/Answer confirmed/i);
      await captureVisual(pageA, testInfo, "companion-answer-confirmed-en");
    }
    const aBeforeRefresh = await session(pageA, roomId);
    const stateBeforeRefresh = await authenticatedState(roomId, aBeforeRefresh);
    const versionBeforeRefresh = stateBeforeRefresh.ledger.streamVersion;
    await pageA.getByRole("button", { name: "Portuguese" }).click();
    await expect(pageA.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(pageA.getByText(/Palpite confirmado|Seu palpite está em jogo/i).first()).toBeVisible();
    if (visualCompanionEnabled) await expect(pageA.locator('[data-companion-state]')).toContainText(/Resposta confirmada/i);
    await captureVisual(pageA, testInfo, "answer-preserved-pt-BR");
    expect(await session(pageA, roomId)).toEqual(aBeforeRefresh);
    await pageA.getByRole("button", { name: "Inglês" }).click();
    await expect(pageA.locator("html")).toHaveAttribute("lang", "en");
    await expect(pageA.getByText(/Prediction confirmed|Your prediction is in play/i).first()).toBeVisible();
    if (visualCompanionEnabled) await expect(pageA.locator('[data-companion-state]')).toContainText(/Answer confirmed/i);
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
    if (visualCompanionEnabled) await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "answer_confirmed");
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
    await expect(pageA.getByText("You answered: Yes").first()).toBeVisible();
    await expect(pageA.getByText("You answered: --")).toHaveCount(0);
    if (visualCompanionEnabled) {
      await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "locked");
      await captureVisual(pageA, testInfo, "companion-locked-en");
      await captureCompanionVisual(pageA, testInfo, "companion-card-locked-en");
    }
    const lockedState = await authenticatedState(roomId, aAfterRefresh);
    const lateResponse = await fetch(`${origin}/rooms/${roomId}/rounds/${lockedState.currentRound.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${aAfterRefresh.sessionToken}` }, body: JSON.stringify({ participantId: aAfterRefresh.participantId, optionId: "yes", clientAnswerId: crypto.randomUUID(), roundVersion: lockedState.currentRound.version, sessionToken: aAfterRefresh.sessionToken }) });
    expect(lateResponse.ok).toBe(false);
    const resolved = await scenario(runId, "resolve"); expect(resolved.status).toBe(200);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 10_000 }).toBe("resolved");
    await expect(pageA.getByText(/Ranking (atualizado|updated)/i).first()).toBeVisible();
    if (visualCompanionEnabled) {
      await expect(pageA.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "resolved");
      await expect(pageA.locator('[data-companion-state]')).toContainText(/\+100/);
      await expect(pageA.locator('[data-companion-state]')).toContainText(/#1/);
    }
    const backToRoom = pageA.getByRole("button", { name: /Back to room|Voltar à sala/i });
    if (await backToRoom.isVisible()) await backToRoom.click();
    if (visualCompanionEnabled) {
      await captureVisual(pageA, testInfo, "companion-resolved-en");
      await captureCompanionVisual(pageA, testInfo, "companion-card-resolved-en");
    }
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
    if (performanceProfile && testInfo.project.name === "chromium-desktop") {
      const dismissResolution = pageB.getByRole("button", { name: /Back to room|Voltar à sala/i });
      if (await dismissResolution.isVisible()) await dismissResolution.click();
      const sourceCdp = await playerB.newCDPSession(pageB); await sourceCdp.send("Performance.enable");
      const cycles: Array<Record<string, unknown>> = [];
      for (let cycle = 1; cycle <= 5; cycle += 1) {
        const pipPromise = playerB.waitForEvent("page");
        await pageB.getByRole("button", { name: /Open floating|Abrir flutuante/i }).click();
        const lifecyclePip = await pipPromise; await lifecyclePip.setViewportSize({ width: 420, height: 560 });
        await expect(lifecyclePip.locator('[data-companion-state]')).toHaveAttribute("data-companion-state", "resolved");
        await lifecyclePip.waitForTimeout(500);
        const parkedBefore = await pageB.evaluate(() => ({ ...(window as any).__VIRA_COMPANION_PERF__.renders }));
        await lifecyclePip.waitForTimeout(2_000);
        const parkedAfter = await pageB.evaluate(() => ({ ...(window as any).__VIRA_COMPANION_PERF__.renders }));
        await lifecyclePip.getByRole("button", { name: /Close|Fechar/i }).click();
        await expect.poll(() => lifecyclePip.isClosed()).toBe(true);
        await sourceCdp.send("HeapProfiler.collectGarbage").catch(() => undefined);
        const metricsAfterClose = await sourceCdp.send("Performance.getMetrics");
        const heapUsed = metricsAfterClose.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? null;
        const runtimeCounters = await pageB.evaluate(() => { const value = (window as any).__VIRA_COMPANION_PERF__; return { activeIntervals: [...value.activeIntervals.values()], intervalsCleared: value.intervalsCleared, lifecycle: { ...value.lifecycle } }; });
        cycles.push({ cycle, pipRendersWhileParked: parkedAfter.pip - parkedBefore.pip, openPagesAfterClose: playerB.pages().length, heapUsed, ...runtimeCounters });
      }
      companionPerformance = { ...companionPerformance, lifecycle: { cycles, heapGrowthBytes: Number(cycles.at(-1)?.heapUsed ?? 0) - Number(cycles[0]?.heapUsed ?? 0) } };
      const performanceDirectory = path.resolve("artifacts", "performance"); await writeFile(path.join(performanceDirectory, `companion-pip-${performanceProfile}.json`), `${JSON.stringify(companionPerformance, null, 2)}\n`, "utf8");
    }
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
      companion: { visualSurface: visualCompanionEnabled ? "feature_flag_enabled" : "disabled_by_default", nativeDocumentPip: nativePipEvidence, compactFallback: visualCompanionEnabled, streamVersionUnchangedByAttentionUi: true, performance: companionPerformance },
      hashes: { liveProjectionHash: verification.liveProjectionHash, replayedProjectionHash: verification.replayedProjectionHash, projectionMatches: verification.projectionMatches, rankingMatches: verification.rankingMatches, leaderboardAfterHash: replay.scoring.leaderboardAfterHash },
      security: { tokensArchived: false, participantIdsArchived: false, requestHeadersArchived: false, traceDisabled: true },
    });
  } finally { await Promise.all([close(playerA), close(playerB)]); }
});
