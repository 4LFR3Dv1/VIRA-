import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium, webkit } from "playwright";
import webPush from "web-push";
import { deriveFixtureConsumerProjection } from "../../shared/fixture-consumer-projection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const AUTHORITY = "captured_txline_test_fixture";
const DEFAULT_DEPLOYMENT = "https://vira.snelabs.space";
function argument(name, fallback) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : fallback; }
const LOCALE = argument("locale", "en");
const TIME_ZONE = argument("time-zone", "America/Sao_Paulo");
const INPUT = argument("input", AUTHORITY);
const CAPTURE_MODE = argument("capture-mode", "desktop");
const CLIP_ONLY = argument("clip-only", null);
const CLIP_ONLY_IDS = new Set(String(CLIP_ONLY ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const DEPLOYMENT = argument("deployment", DEFAULT_DEPLOYMENT);
if (!["en", "pt-BR"].includes(LOCALE)) throw new Error("--locale must be en or pt-BR");
if (INPUT !== AUTHORITY) throw new Error(`Unsupported deterministic demo input: ${INPUT}`);
if (!["desktop", "mobile-webkit", "hybrid-cross-device"].includes(CAPTURE_MODE)) throw new Error("--capture-mode must be desktop, mobile-webkit or hybrid-cross-device");
const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const VIEWPORT_A = CAPTURE_MODE === "mobile-webkit" ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
const VIEWPORT_B = CAPTURE_MODE === "desktop" ? DESKTOP_VIEWPORT : MOBILE_VIEWPORT;
const copy = LOCALE === "en" ? {
  joinDialog: "Join room", name: "Name in the room", homeName: "Your name", join: "Join room", sharePick: /Share: France/i,
  yes: /YES/i, confirm: /Confirm prediction/i, confirmed: /Prediction confirmed/i, ranking: /Ranking updated/i,
  review: "Open Official Review", reviewTitle: "VIRA Official Review", resultMatches: "Replay produced the same result and ranking.",
  waiting: "Waiting for the invite", invite: /Invite to the room/i, shareDialog: /Share this moment/i,
  alertsReceive: /Receive match alerts/i, alertsEnabled: /Disable alerts/i, audit: /Audit details/i, details: /Technical details/i,
  pressure: /Building pressure/i,
  corner: /^Corner$/i, yellowCard: /^Yellow card$/i, goal: /^Goal$/i,
  connected: /^Connected$/i,
} : {
  joinDialog: "Entrar na sala", name: "Nome na sala", homeName: "Seu nome", join: "Entrar na sala", sharePick: /Compartilhar: France/i,
  yes: /SIM/i, confirm: /Confirmar palpite/i, confirmed: /Palpite confirmado/i, ranking: /Ranking atualizado/i,
  review: "Abrir Revisão Oficial", reviewTitle: "Revisão Oficial VIRA", resultMatches: "O replay produziu o mesmo resultado e ranking.",
  waiting: "Aguardando o convite", invite: /Convidar para a sala/i, shareDialog: /Compartilhe este momento/i,
  alertsReceive: /Receber alertas da partida/i, alertsEnabled: /Desativar alertas/i, audit: /Detalhes da auditoria/i, details: /Detalhes técnicos/i,
  pressure: /Construindo pressão/i,
  corner: /^Escanteio$/i, yellowCard: /^Cartão amarelo$/i, goal: /^Gol$/i,
  connected: /^Conectado$/i,
};
const scenes = [];
let epoch = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => Math.max(0, ms / 1000).toFixed(3);
function run(command, args, silent = false) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: ROOT, stdio: silent ? "ignore" : "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`))); }); }
function freePort() { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); }); }
async function waitFor(fn, label, timeout = 20_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn().catch(() => false)) return; await delay(150); } throw new Error(`Timed out: ${label}`); }
async function scene(id, title, players, pages, action, hold = 1800, motion = "reduce") {
  await Promise.all(pages.map((page) => page.emulateMedia({ reducedMotion: motion })));
  const startedAtMs = Date.now() - epoch;
  await action();
  await delay(hold);
  scenes.push({ id, title, players, startedAtMs, endedAtMs: Date.now() - epoch, motion });
}
async function ensureStable(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => document.fonts.ready);
  await page.locator("body").waitFor({ state: "visible" });
  await waitFor(() => page.evaluate(() => !document.querySelector('[aria-busy="true"]')), "stable layout");
}
async function waitSharePreview(page) {
  const image = page.getByAltText(/Preview of the VIRA share card|Prévia do card compartilhável VIRA|VIRA share card|Card compartilhável VIRA/i);
  await image.waitFor();
  await waitFor(
    () => image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth === 1200 && element.naturalHeight === 630),
    "share preview 1200x630",
  );
}
function gitSha() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unknown"; } }
async function buildId() {
  try {
    const html = await readFile(path.join(ROOT, "dist", "index.html"), "utf8");
    return html.match(/assets\/index-([^"']+)\.js/)?.[1] ?? "unknown";
  } catch { return "unknown"; }
}

function catalog(roomId) {
  const generatedAt = new Date().toISOString();
  const startTime = new Date(Date.now() + 86_400_000).toISOString();
  const makeMatch = (fixtureId, status) => {
    const context = { fixtureId, provider: "TxLINE", generatedAt, fixture: { provider: "TxLINE", source: "txline", fixtureId, title: "France vs Spain", competitionLabel: "World Cup", status, startTime, homeTeam: "France", awayTeam: "Spain" }, canonical1X2: { marketSignature: `${fixtureId}|MATCH_RESULT_1X2|full-match`, snapshotId: `captured-${fixtureId}`, providerSequence: 42, observedAt: new Date(Date.now() - 120_000).toISOString(), selections: { home: 51, draw: 27, away: 22 } }, availableMarkets: [], suggestedPrediction: { priceName: "part1", probability: 51 }, cache: { status: "captured", cachedAt: generatedAt, ttlMs: 30_000 } };
    const fixture = { id: fixtureId, fixtureId, title: "France vs Spain", competitionLabel: "World Cup", competition: { providerCompetitionId: 72, canonicalCompetitionId: "world-cup", displayName: "World Cup", kind: "world_cup", authority: "txline", mapped: true }, startTime, status, homeTeam: "France", awayTeam: "Spain", source: "txline", context };
    const projection = deriveFixtureConsumerProjection({ fixture, txlineContext: context, evaluatedAt: generatedAt });
    return { ...fixture, consumerProjection: projection, availability: { marketCount: 1, canonical1X2Available: true, hasMarket: true, hasPlayablePrediction: projection.availability.canPredict, ...projection.availability, contextStatus: "ready" } };
  };
  return { version: 3, source: "txline", cacheSource: "captured", inputAuthority: AUTHORITY, generatedAt, featuredFixtureId: roomId, refreshReason: "captured-demo-fixture", materialization: { contextsRefreshed: 0, contextsReused: 2, concurrency: 1 }, matches: [makeMatch(roomId, "scheduled"), makeMatch(`${roomId}-moments`, "unknown")] };
}

async function join(page, name) { const dialog = page.getByRole("dialog", { name: copy.joinDialog }); await dialog.getByPlaceholder(copy.name).fill(name); await dialog.getByRole("button", { name: copy.join }).click(); await page.getByText(name, { exact: true }).first().waitFor(); }
async function ensureJoined(page, name) { const dialog = page.getByRole("dialog", { name: copy.joinDialog }); if (await dialog.isVisible().catch(() => false)) await join(page, name); else await page.getByText(name, { exact: true }).first().waitFor(); }
async function selectYes(page) { await page.getByRole("button", { name: copy.yes }).first().click(); }
async function confirm(page) { await page.getByRole("button", { name: copy.confirm }).click(); await page.getByText(copy.confirmed).first().waitFor(); }
async function clip(input, output, start, end) { await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", input, "-t", seconds(end - start), "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output], true); }
async function master(input, output) { await run(ffmpegPath, ["-y", "-i", input, "-vf", "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output], true); }
async function split(a, b, output, start, duration, crossDevice = false) {
  const filter = crossDevice
    ? "[0:v]scale=1220:686:force_original_aspect_ratio=decrease,pad=1220:686:(ow-iw)/2:(oh-ih)/2:#050A12[a];[1:v]scale=390:844:force_original_aspect_ratio=decrease,pad=390:844:(ow-iw)/2:(oh-ih)/2:#050A12[b];color=c=#050A12:s=1920x1080:r=30[bg];[bg][a]overlay=48:224[left];[left][b]overlay=1435:154[feeds];[feeds]drawbox=x=25:y=195:w=1266:h=744:color=#C8FF00:t=3,drawbox=x=1412:y=125:w=436:h=902:color=#C8FF00:t=3,drawbox=x=1308:y=178:w=78:h=4:color=#C8FF00:t=fill,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='PLAYER A · CHROMIUM DESKTOP':fontcolor=white:fontsize=24:x=48:y=166,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='PLAYER B · MOBILE WEBKIT':fontcolor=white:fontsize=24:x=1435:y=96,drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='TWO SCREENS · ONE ROOM · ONE SERVER CLOCK':fontcolor=#C8FF00:fontsize=34:x=48:y=55,format=yuv420p[v]"
    : "[0:v]scale=940:528:force_original_aspect_ratio=decrease,pad=940:528:(ow-iw)/2:(oh-ih)/2:#050A12[a];[1:v]scale=940:528:force_original_aspect_ratio=decrease,pad=940:528:(ow-iw)/2:(oh-ih)/2:#050A12[b];color=c=#050A12:s=1920x1080:r=30[bg];[bg][a]overlay=20:276[left];[left][b]overlay=960:276,format=yuv420p[v]";
  await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", a, "-ss", seconds(start), "-i", b, "-t", seconds(duration), "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", output], true);
}

async function main() {
  const runId = `demo-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const roomId = `e2e-${runId}`;
  const output = path.resolve(ROOT, "artifacts", "demo", LOCALE, CAPTURE_MODE, runId);
  const raw = path.join(output, "raw"); const clips = path.join(output, "clips"); const masters = path.join(output, "masters"); const screenshots = path.join(output, "screenshots");
  const data = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-demo-"));
  const token = crypto.randomBytes(32).toString("hex");
  const vapid = webPush.generateVAPIDKeys();
  let alertsCapture = { controlCaptured: false, enabledCaptured: false, permission: "unavailable" };
  let backend, browserA, browserB, contextA, contextB;
  const consoleErrors = []; const serverErrors = []; const failedRequests = [];
  const correlatedStates = {};
  const updateIntervalsMs = {};
  await Promise.all([mkdir(raw, { recursive: true }), mkdir(clips, { recursive: true }), mkdir(masters, { recursive: true }), mkdir(screenshots, { recursive: true })]);
  await writeFile(path.join(data, "txline-catalog.json"), JSON.stringify(catalog(roomId)), "utf8");
  try {
    const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
    backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: data, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "30", VIRA_WEB_PUSH_ENABLED: "true", VIRA_VAPID_PUBLIC_KEY: vapid.publicKey, VIRA_VAPID_PRIVATE_KEY: vapid.privateKey, VIRA_VAPID_SUBJECT: "mailto:demo@vira.invalid", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: "ignore" });
    await waitFor(async () => (await fetch(`${origin}/health`)).ok, "backend health");
    browserA = await (CAPTURE_MODE === "mobile-webkit" ? webkit : chromium).launch({ headless: true });
    browserB = CAPTURE_MODE === "hybrid-cross-device" ? await webkit.launch({ headless: true }) : browserA;
    const commonOptions = { baseURL: origin, deviceScaleFactor: 1, reducedMotion: "reduce", locale: LOCALE === "en" ? "en-US" : "pt-BR", timezoneId: TIME_ZONE, serviceWorkers: CAPTURE_MODE === "hybrid-cross-device" ? "block" : "allow" };
    const optionsA = { ...commonOptions, viewport: VIEWPORT_A, screen: VIEWPORT_A, recordVideo: { dir: raw, size: VIEWPORT_A } };
    const optionsB = { ...commonOptions, viewport: VIEWPORT_B, screen: VIEWPORT_B, recordVideo: { dir: raw, size: VIEWPORT_B } };
    [contextA, contextB] = await Promise.all([browserA.newContext(optionsA), browserB.newContext(optionsB)]);
    const flagSvg = (country) => country === "fr"
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><path fill="#002395" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#ED2939" d="M2 0h1v2H2z"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><path fill="#AA151B" d="M0 0h3v2H0z"/><path fill="#F1BF00" d="M0 .5h3v1H0z"/></svg>`;
    await Promise.all([contextA, contextB].map((context) => context.route("https://flagcdn.com/**", async (route) => {
      const country = path.basename(new URL(route.request().url()).pathname, ".svg");
      await route.fulfill({ status: 200, contentType: "image/svg+xml", body: flagSvg(country) });
    })));
    if (CAPTURE_MODE !== "mobile-webkit") await Promise.all([
      contextA.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin }),
      CAPTURE_MODE === "desktop" ? contextB.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin }) : Promise.resolve(),
    ]);
    const videoStart = Date.now(); const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]); const videoA = pageA.video(); const videoB = pageB.video();
    const browserVersions = {
      A: { engine: CAPTURE_MODE === "mobile-webkit" ? "webkit" : "chromium", version: browserA.version(), viewport: VIEWPORT_A },
      B: { engine: CAPTURE_MODE === "desktop" ? "chromium" : "webkit", version: browserB.version(), viewport: VIEWPORT_B },
    };
    async function recordCorrelatedState(label) {
      const snapshot = await (await fetch(`${origin}/public/rooms/${roomId}`)).json();
      correlatedStates[label] = {
        observedAt: new Date().toISOString(),
        roomId,
        roundId: snapshot.currentRound?.id ?? null,
        roundState: snapshot.currentRound?.state ?? null,
        locksAt: snapshot.currentRound?.locksAt ?? null,
        streamVersion: snapshot.ledger?.streamVersion ?? snapshot.version ?? null,
        participantCount: snapshot.participants?.length ?? snapshot.presence?.length ?? null,
        confirmedAnswerCount: snapshot.answerSummary?.confirmedCount ?? snapshot.answerSummary?.submitted ?? null,
        ranking: Array.isArray(snapshot.leaderboard) ? snapshot.leaderboard.map((entry) => ({ participantId: entry.participantId, rank: entry.rank, points: entry.points })) : [],
      };
      await Promise.all([
        pageA.screenshot({ path: path.join(screenshots, `${label}-player-a.png`) }),
        pageB.screenshot({ path: path.join(screenshots, `${label}-player-b.png`) }),
      ]);
    }
    for (const page of [pageA, pageB]) {
      page.on("console", (message) => { if (message.type() === "error") { const location = message.location(); let source = "unknown"; try { const url = new URL(location.url); source = `${url.origin}${url.pathname}`; } catch {} consoleErrors.push({ message: message.text().slice(0, 500), source }); } });
      page.on("response", (response) => { if (response.status() >= 500) serverErrors.push({ status: response.status(), path: new URL(response.url()).pathname }); });
      page.on("requestfailed", (request) => { const url = new URL(request.url()); failedRequests.push({ origin: url.origin, path: url.pathname, method: request.method(), reason: request.failure()?.errorText ?? "unknown" }); });
    }
    await pageB.setContent(`<main style='height:100vh;display:grid;place-items:center;background:#050A12;color:#C8FF00;font:700 20px sans-serif'>PLAYER B · ${copy.waiting}</main>`); epoch = Date.now(); const preroll = epoch - videoStart;
    let shareUrl = "";
    await pageA.goto(`/?lang=${encodeURIComponent(LOCALE)}`); await ensureStable(pageA);
    await scene("home", "Home", ["A"], [pageA], async () => {}, 1800);
    await scene("home-pick", "Pre-match pick", ["A"], [pageA], async () => { await pageA.getByRole("textbox", { name: copy.homeName }).fill("Ana"); await pageA.getByRole("button", { name: /France/i }).click(); await pageA.getByRole("button", { name: copy.sharePick }).waitFor(); }, 2200, "no-preference");
    await scene("prediction-share", "Prediction share", ["A"], [pageA], async () => { const response = pageA.waitForResponse((item) => item.url().includes(`/predictions/${roomId}/share`) && item.status() === 201); await pageA.getByRole("button", { name: copy.sharePick }).click(); shareUrl = (await (await response).json()).url; await pageA.goto(new URL(new URL(shareUrl).pathname, origin).toString()); await ensureStable(pageA); await waitSharePreview(pageA); }, 2300);
    await scene("player-b-opens-share", "Player B opens the invite", ["B"], [pageB], async () => { await pageB.goto(new URL(new URL(shareUrl).pathname, origin).toString()); await ensureStable(pageB); await pageB.locator("[data-share-cta]").waitFor(); }, 2200);
    const started = await fetch(`${origin}/__e2e/scenario/${runId}/start`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!started.ok || (await started.json()).inputAuthority !== AUTHORITY) throw new Error("Scenario start failed");
    await pageA.goto(`/match/${roomId}?lang=${encodeURIComponent(LOCALE)}`); await ensureJoined(pageA, "Ana");
    await scene("guest-join", "Guest-first join", ["B"], [pageB], async () => { await pageB.locator("[data-share-cta]").click(); await pageB.getByRole("button", { name: copy.join }).first().click(); await ensureJoined(pageB, "Bruno"); }, 2200, "no-preference");
    await Promise.all([pageA.getByText("Bruno", { exact: true }).first().waitFor(), pageB.getByText("Ana", { exact: true }).first().waitFor()]);
    await scene("shared-room", "Two participants in the same room", ["A", "B"], [pageA, pageB], async () => {}, 2200);
    await scene("room-share-sheet", "Room invite share sheet", ["A"], [pageA], async () => { const response = pageA.waitForResponse((item) => new URL(item.url()).pathname === "/shares" && item.status() === 201); await pageA.getByRole("button", { name: copy.invite }).click(); await response; await pageA.getByRole("dialog", { name: copy.shareDialog }).waitFor(); await waitSharePreview(pageA); }, 2200);
    await pageA.getByRole("dialog", { name: copy.shareDialog }).getByRole("button", { name: /Close share sheet|Fechar compartilhamento/i }).click();
    await scene("match-room", "Match Room without visual Companion", ["A"], [pageA], async () => { await pageA.locator("[data-companion-state]").waitFor({ state: "detached" }).catch(() => {}); }, 1900);
    await scene("live-pressure", "TxLINE attacking pressure reaches both screens", ["A", "B"], [pageA, pageB], async () => {
      const response = await fetch(`${origin}/__e2e/scenario/${runId}/pressure`, { method: "POST", headers: { "X-Vira-E2E-Token": token } });
      if (!response.ok) throw new Error(`Pressure scenario failed: ${response.status}`);
      await Promise.all([pageA, pageB].map((page) => page.getByText(copy.pressure).waitFor({ timeout: 10_000 })));
    }, 3200, "no-preference");
    await recordCorrelatedState("pressure");
    if (CAPTURE_MODE === "desktop") {
      await pageA.locator("[data-match-alerts-control]").waitFor({ timeout: 15_000 });
      const control = pageA.locator("[data-match-alerts-control]");
      alertsCapture = { controlCaptured: true, enabledCaptured: false, permission: await pageA.evaluate(() => Notification.permission) };
      if (await control.isEnabled()) {
        await scene("alerts-available", "Match alerts available", ["A"], [pageA], async () => { await control.scrollIntoViewIfNeeded(); }, 1500);
        await scene("alerts-enabled", "Match alerts enabled", ["A"], [pageA], async () => { await pageA.getByRole("button", { name: copy.alertsReceive }).click(); await pageA.getByRole("button", { name: copy.alertsEnabled }).waitFor({ timeout: 20_000 }); }, 2200);
        alertsCapture.enabledCaptured = true;
      }
    }
    const openMarks = await Promise.all([pageA, pageB].map(async (page) => { await page.getByRole("button", { name: copy.yes }).first().waitFor(); return Date.now(); }));
    updateIntervalsMs.open = Math.abs(openMarks[0] - openMarks[1]);
    await scene("round-open", "Round open", ["A", "B"], [pageA, pageB], async () => {}, 1800, "no-preference");
    await recordCorrelatedState("open");
    await scene("player-a-selects", "Player A selects", ["A"], [pageA], async () => selectYes(pageA), 1300, "no-preference");
    await scene("player-b-selects", "Player B selects", ["B"], [pageB], async () => selectYes(pageB), 1300, "no-preference");
    await scene("private-answers", "Private answers confirmed", ["A", "B"], [pageA, pageB], async () => { const marks = await Promise.all([pageA, pageB].map(async (page) => { await confirm(page); return Date.now(); })); updateIntervalsMs.confirmed = Math.abs(marks[0] - marks[1]); }, 2200, "no-preference");
    await recordCorrelatedState("confirmed");
    await scene("normal-deadline", "Authoritative deadline", ["A", "B"], [pageA, pageB], async () => { await waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "locked", "locked state", 40_000); const marks = await Promise.all([pageA, pageB].map(async (page) => { await page.getByText(/Answers closed|Respostas encerradas/i).first().waitFor({ timeout: 10_000 }); return Date.now(); })); updateIntervalsMs.locked = Math.abs(marks[0] - marks[1]); }, 1000);
    await scene("locked", "Server-owned lock", ["A", "B"], [pageA, pageB], async () => {}, 1800, "no-preference");
    await recordCorrelatedState("locked");
    await scene("resolution-both", "Synchronized resolution", ["A", "B"], [pageA, pageB], async () => { const response = await fetch(`${origin}/__e2e/scenario/${runId}/resolve`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!response.ok) throw new Error("Scenario resolve failed"); await waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "resolved", "resolved state"); const marks = await Promise.all([pageA, pageB].map(async (page) => { await page.getByText(copy.ranking).first().waitFor({ timeout: 10_000 }); return Date.now(); })); updateIntervalsMs.resolved = Math.abs(marks[0] - marks[1]); }, 3600, "no-preference");
    await recordCorrelatedState("resolved");
    await scene("ranking", "Synchronized ranking", ["A", "B"], [pageA, pageB], async () => {}, 2400, "no-preference");
    const verification = await (await fetch(`${origin}/public/rooms/${roomId}/verification`)).json();
    const roundIds = new Set(Object.values(correlatedStates).map((state) => state.roundId).filter(Boolean));
    const deadlines = new Set(Object.values(correlatedStates).map((state) => state.locksAt).filter(Boolean));
    if (roundIds.size !== 1 || deadlines.size !== 1) throw new Error(`Cross-device correlation failed: ${JSON.stringify({ roundIds: [...roundIds], deadlines: [...deadlines] })}`);
    if (Object.values(correlatedStates).some((state) => state.participantCount !== null && state.participantCount !== 2)) throw new Error(`Participant duplication detected: ${JSON.stringify(correlatedStates)}`);
    const reviewPage = CAPTURE_MODE === "hybrid-cross-device" ? pageA : pageB;
    const reviewPlayer = CAPTURE_MODE === "hybrid-cross-device" ? "A" : "B";
    await scene("official-review", "Official Review", [reviewPlayer], [reviewPage], async () => { await reviewPage.goto(`/matches?lang=${encodeURIComponent(LOCALE)}`); await reviewPage.getByRole("button", { name: copy.review, exact: true }).click(); const review = reviewPage.getByRole("dialog").filter({ hasText: copy.reviewTitle }); await review.waitFor(); await review.getByText(copy.resultMatches, { exact: true }).waitFor(); }, 2600);
    await scene("replay-proof", "Replay and hashes", [reviewPlayer], [reviewPage], async () => { const review = reviewPage.getByRole("dialog").filter({ hasText: copy.reviewTitle }); await review.locator("summary").filter({ hasText: copy.audit }).click(); await review.locator("summary").filter({ hasText: copy.details }).click(); await review.getByText(/Round ID|ID da rodada/i).scrollIntoViewIfNeeded(); }, 3000);
    const momentsRunId = `${runId}-moments`;
    const momentsRoomId = `e2e-${momentsRunId}`;
    const momentsStarted = await fetch(`${origin}/__e2e/scenario/${momentsRunId}/start`, { method: "POST", headers: { "X-Vira-E2E-Token": token } });
    if (!momentsStarted.ok) throw new Error(`Live moments scenario failed to start: ${momentsStarted.status}`);
    await Promise.all([pageA.goto(`/match/${momentsRoomId}?lang=${encodeURIComponent(LOCALE)}`), pageB.goto(`/match/${momentsRoomId}?lang=${encodeURIComponent(LOCALE)}`)]);
    await Promise.all([ensureJoined(pageA, "Ana"), ensureJoined(pageB, "Bruno")]);
    await Promise.all([pageA, pageB].map((page) => page.getByText(copy.connected).first().waitFor({ timeout: 15_000 })));
    async function liveMoment(id, title, endpoint, matcher, hold) {
      await scene(id, title, ["A", "B"], [pageA, pageB], async () => {
        const response = await fetch(`${origin}/__e2e/scenario/${momentsRunId}/${endpoint}`, { method: "POST", headers: { "X-Vira-E2E-Token": token } });
        if (!response.ok) throw new Error(`${title} scenario failed: ${response.status}`);
        await Promise.all([pageA, pageB].map((page) => page.getByText(matcher).first().waitFor({ timeout: 10_000 })));
      }, hold, "no-preference");
    }
    await liveMoment("live-corner", "Live corner notification", "corner", copy.corner, 3000);
    await liveMoment("live-card", "Live yellow-card notification", "card", copy.yellowCard, 3400);
    await liveMoment("live-goal", "Live goal takeover", "goal", copy.goal, 4600);
    const unexpectedFailedRequests = failedRequests.filter((request) => !/ERR_ABORTED|cancelled/i.test(request.reason));
    if (consoleErrors.length || serverErrors.length || unexpectedFailedRequests.length) throw new Error(`Capture health failed: ${JSON.stringify({ consoleErrors, serverErrors, unexpectedFailedRequests, expectedNavigationCancellations: failedRequests.length - unexpectedFailedRequests.length })}`);
    const aRaw = path.join(raw, "player-a.webm"), bRaw = path.join(raw, "player-b.webm");
    await Promise.all([contextA.close(), contextB.close()]); contextA = contextB = null; await Promise.all([videoA.saveAs(aRaw), videoB.saveAs(bRaw)]);
    await Promise.all((await readdir(raw)).filter((name) => name.endsWith(".webm") && !["player-a.webm", "player-b.webm"].includes(name)).map((name) => rm(path.join(raw, name), { force: true })));
    const aMaster = path.join(masters, "player-a-master-1080p30.mp4"), bMaster = path.join(masters, "player-b-master-1080p30.mp4");
    if (!CLIP_ONLY) await Promise.all([master(aRaw, aMaster), master(bRaw, bMaster)]);
    const files = [];
    const exportedScenes = CLIP_ONLY ? scenes.filter((item) => CLIP_ONLY_IDS.has(item.id)) : scenes;
    if (CLIP_ONLY && exportedScenes.length !== CLIP_ONLY_IDS.size) throw new Error(`Unknown --clip-only scene list: ${CLIP_ONLY}`);
    for (const item of exportedScenes) for (const player of item.players) { const target = path.join(clips, `${item.id}-player-${player.toLowerCase()}.mp4`); await clip(player === "A" ? aRaw : bRaw, target, preroll + item.startedAtMs, preroll + item.endedAtMs); files.push(path.relative(output, target).replaceAll("\\", "/")); }
    if (!CLIP_ONLY) { const multiplayer = scenes.filter((item) => item.players.length === 2), splitStart = multiplayer[0].startedAtMs, splitEnd = multiplayer.at(-1).endedAtMs; await split(aRaw, bRaw, path.join(output, "multiplayer-split-screen.mp4"), preroll + splitStart, splitEnd - splitStart, CAPTURE_MODE === "hybrid-cross-device"); }
    if (CLIP_ONLY) await Promise.all([rm(raw, { recursive: true, force: true }), rm(masters, { recursive: true, force: true })]);
    const manifest = {
      schemaVersion: 3, kind: "VIRA_CONSUMER_DEMO_CAPTURE", runId, commitSha: gitSha(), buildId: await buildId(), deployment: DEPLOYMENT,
      capturedAtUtc: new Date().toISOString(), locale: LOCALE, timeZone: TIME_ZONE, captureMode: CAPTURE_MODE, inputAuthority: AUTHORITY,
      disclosure: "Recorded from a captured TxLINE test fixture; not represented as live delivery during recording.",
      video: { width: 1920, height: 1080, fps: 30, deviceScaleFactor: 1, sourceCodec: "vp8", editorialCodec: "h264", sources: { A: VIEWPORT_A, B: VIEWPORT_B } },
      runtime: { node: process.version, browsers: browserVersions },
      players: { A: "Ana", B: "Bruno" },
      correlation: { roomId, roundId: [...roundIds][0], locksAt: [...deadlines][0], contextsIsolated: true, identitiesDistinct: true, participantCount: 2, duplicateParticipants: 0, states: correlatedStates, observedUpdateIntervalsMs: updateIntervalsMs, framePerfectSimultaneityClaimed: false },
      scenes: scenes.map((item) => ({ ...item, startedAtSeconds: Number(seconds(item.startedAtMs)), endedAtSeconds: Number(seconds(item.endedAtMs)), durationSeconds: Number(seconds(item.endedAtMs - item.startedAtMs)) })),
      outputs: CLIP_ONLY ? { clipPatchFor: [...CLIP_ONLY_IDS], clips: files } : { playerA: "masters/player-a-master-1080p30.mp4", playerB: "masters/player-b-master-1080p30.mp4", rawPlayerA: "raw/player-a.webm", rawPlayerB: "raw/player-b.webm", splitScreen: "multiplayer-split-screen.mp4", screenshots: ["open-player-a.png", "open-player-b.png", "confirmed-player-a.png", "confirmed-player-b.png", "locked-player-a.png", "locked-player-b.png", "resolved-player-a.png", "resolved-player-b.png"].map((name) => `screenshots/${name}`), clips: files },
      authority: { deadline: "authoritative_room_runtime", resolution: AUTHORITY, liveProjectionHash: verification.liveProjectionHash, replayedProjectionHash: verification.replayedProjectionHash, liveReplayEquivalent: verification.projectionMatches === true, rankingReplayEquivalent: verification.rankingMatches === true },
      alerts: { ...alertsCapture, nativeNotificationCaptured: false, nativeNotificationSource: "external_capture_required" },
      health: { consoleErrors: 0, serverErrors: 0, unexpectedFailedRequests: 0, expectedNavigationCancellations: failedRequests.length },
      privacy: { administrativeRoutesVisible: false, tokensArchived: false, logsArchived: false, harnessControlsVisible: false, technicalOverlayVisible: false },
    };
    await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); process.stdout.write(`${output}\n`);
  } finally { await contextA?.close().catch(() => {}); await contextB?.close().catch(() => {}); await browserB?.close().catch(() => {}); if (browserA && browserA !== browserB) await browserA.close().catch(() => {}); if (backend) { backend.kill("SIGTERM"); await Promise.race([new Promise((resolve) => backend.once("exit", resolve)), delay(3000)]); } await rm(data, { recursive: true, force: true }); }
}

await main();
