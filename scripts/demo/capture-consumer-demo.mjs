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
if (!["desktop", "mobile-webkit"].includes(CAPTURE_MODE)) throw new Error("--capture-mode must be desktop or mobile-webkit");
const VIEWPORT = CAPTURE_MODE === "mobile-webkit" ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
const copy = LOCALE === "en" ? {
  joinDialog: "Join room", name: "Name in the room", homeName: "Your name", join: "Join room", sharePick: /Share: France/i,
  yes: /YES/i, confirm: /Confirm prediction/i, confirmed: /Prediction confirmed/i, ranking: /Ranking updated/i,
  review: "Open Official Review", reviewTitle: "VIRA Official Review", resultMatches: "Replay produced the same result and ranking.",
  waiting: "Waiting for the invite", invite: /Invite to the room/i, shareDialog: /Share this moment/i,
  alertsReceive: /Receive match alerts/i, alertsEnabled: /Disable alerts/i, audit: /Audit details/i, details: /Technical details/i,
} : {
  joinDialog: "Entrar na sala", name: "Nome na sala", homeName: "Seu nome", join: "Entrar na sala", sharePick: /Compartilhar: France/i,
  yes: /SIM/i, confirm: /Confirmar palpite/i, confirmed: /Palpite confirmado/i, ranking: /Ranking atualizado/i,
  review: "Abrir Revisão Oficial", reviewTitle: "Revisão Oficial VIRA", resultMatches: "O replay produziu o mesmo resultado e ranking.",
  waiting: "Aguardando o convite", invite: /Convidar para a sala/i, shareDialog: /Compartilhe este momento/i,
  alertsReceive: /Receber alertas da partida/i, alertsEnabled: /Desativar alertas/i, audit: /Detalhes da auditoria/i, details: /Detalhes técnicos/i,
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
  const context = { fixtureId: roomId, provider: "TxLINE", generatedAt, fixture: { provider: "TxLINE", source: "txline", fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", status: "scheduled", startTime, homeTeam: "France", awayTeam: "Spain" }, canonical1X2: { marketSignature: `${roomId}|MATCH_RESULT_1X2|full-match`, snapshotId: `captured-${roomId}`, providerSequence: 42, observedAt: new Date(Date.now() - 120_000).toISOString(), selections: { home: 51, draw: 27, away: 22 } }, availableMarkets: [], suggestedPrediction: { priceName: "part1", probability: 51 }, cache: { status: "captured", cachedAt: generatedAt, ttlMs: 30_000 } };
  const fixture = { id: roomId, fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", competition: { providerCompetitionId: 72, canonicalCompetitionId: "world-cup", displayName: "World Cup", kind: "world_cup", authority: "txline", mapped: true }, startTime, status: "scheduled", homeTeam: "France", awayTeam: "Spain", source: "txline", context };
  const projection = deriveFixtureConsumerProjection({ fixture, txlineContext: context, evaluatedAt: generatedAt });
  return { version: 3, source: "txline", cacheSource: "captured", inputAuthority: AUTHORITY, generatedAt, featuredFixtureId: roomId, refreshReason: "captured-demo-fixture", materialization: { contextsRefreshed: 0, contextsReused: 1, concurrency: 1 }, matches: [{ ...fixture, consumerProjection: projection, availability: { marketCount: 1, canonical1X2Available: true, hasMarket: true, hasPlayablePrediction: projection.availability.canPredict, ...projection.availability, contextStatus: "ready" } }] };
}

async function join(page, name) { const dialog = page.getByRole("dialog", { name: copy.joinDialog }); await dialog.getByPlaceholder(copy.name).fill(name); await dialog.getByRole("button", { name: copy.join }).click(); await page.getByText(name, { exact: true }).first().waitFor(); }
async function ensureJoined(page, name) { const dialog = page.getByRole("dialog", { name: copy.joinDialog }); if (await dialog.isVisible().catch(() => false)) await join(page, name); else await page.getByText(name, { exact: true }).first().waitFor(); }
async function selectYes(page) { await page.getByRole("button", { name: copy.yes }).first().click(); }
async function confirm(page) { await page.getByRole("button", { name: copy.confirm }).click(); await page.getByText(copy.confirmed).first().waitFor(); }
async function clip(input, output, start, end) { await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", input, "-t", seconds(end - start), "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output], true); }
async function master(input, output) { await run(ffmpegPath, ["-y", "-i", input, "-vf", "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output], true); }
async function split(a, b, output, start, duration) { const filter = "[0:v]scale=940:528:force_original_aspect_ratio=decrease,pad=940:528:(ow-iw)/2:(oh-ih)/2:#050A12[a];[1:v]scale=940:528:force_original_aspect_ratio=decrease,pad=940:528:(ow-iw)/2:(oh-ih)/2:#050A12[b];color=c=#050A12:s=1920x1080:r=30[bg];[bg][a]overlay=20:276[left];[left][b]overlay=960:276,format=yuv420p[v]"; await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", a, "-ss", seconds(start), "-i", b, "-t", seconds(duration), "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", output], true); }

async function main() {
  const runId = `demo-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const roomId = `e2e-${runId}`;
  const output = path.resolve(ROOT, "artifacts", "demo", LOCALE, CAPTURE_MODE, runId);
  const raw = path.join(output, "raw"); const clips = path.join(output, "clips"); const masters = path.join(output, "masters");
  const data = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-demo-"));
  const token = crypto.randomBytes(32).toString("hex");
  const vapid = webPush.generateVAPIDKeys();
  let alertsCapture = { controlCaptured: false, enabledCaptured: false, permission: "unavailable" };
  let backend, browser, contextA, contextB;
  const consoleErrors = []; const serverErrors = [];
  await Promise.all([mkdir(raw, { recursive: true }), mkdir(clips, { recursive: true }), mkdir(masters, { recursive: true })]);
  await writeFile(path.join(data, "txline-catalog.json"), JSON.stringify(catalog(roomId)), "utf8");
  try {
    const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
    backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: data, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "30", VIRA_WEB_PUSH_ENABLED: "true", VIRA_VAPID_PUBLIC_KEY: vapid.publicKey, VIRA_VAPID_PRIVATE_KEY: vapid.privateKey, VIRA_VAPID_SUBJECT: "mailto:demo@vira.invalid", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: "ignore" });
    await waitFor(async () => (await fetch(`${origin}/health`)).ok, "backend health");
    browser = await (CAPTURE_MODE === "mobile-webkit" ? webkit : chromium).launch({ headless: true });
    const options = { baseURL: origin, viewport: VIEWPORT, screen: VIEWPORT, deviceScaleFactor: 1, recordVideo: { dir: raw, size: VIEWPORT }, reducedMotion: "reduce", locale: LOCALE === "en" ? "en-US" : "pt-BR", timezoneId: TIME_ZONE };
    [contextA, contextB] = await Promise.all([browser.newContext(options), browser.newContext(options)]);
    if (CAPTURE_MODE === "desktop") await Promise.all([
      contextA.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin }),
      contextB.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin }),
    ]);
    const videoStart = Date.now(); const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]); const videoA = pageA.video(); const videoB = pageB.video();
    for (const page of [pageA, pageB]) {
      page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 500)); });
      page.on("response", (response) => { if (response.status() >= 500) serverErrors.push({ status: response.status(), path: new URL(response.url()).pathname }); });
    }
    await pageB.setContent(`<main style='height:100vh;display:grid;place-items:center;background:#050A12;color:#C8FF00;font:700 20px sans-serif'>PLAYER B · ${copy.waiting}</main>`); epoch = Date.now(); const preroll = epoch - videoStart;
    let shareUrl = "";
    await pageA.goto(`/?lang=${encodeURIComponent(LOCALE)}`); await ensureStable(pageA);
    await scene("home", "Home", ["A"], [pageA], async () => {}, 1800);
    await scene("home-pick", "Pre-match pick", ["A"], [pageA], async () => { await pageA.getByRole("textbox", { name: copy.homeName }).fill("Ana"); await pageA.getByRole("button", { name: /France/i }).click(); await pageA.getByRole("button", { name: copy.sharePick }).waitFor(); }, 2200, "no-preference");
    await scene("prediction-share", "Prediction share", ["A"], [pageA], async () => { const response = pageA.waitForResponse((item) => item.url().includes(`/predictions/${roomId}/share`) && item.status() === 201); await pageA.getByRole("button", { name: copy.sharePick }).click(); shareUrl = (await (await response).json()).url; }, 2300);
    await scene("player-b-opens-share", "Player B opens the invite", ["B"], [pageB], async () => { await pageB.goto(new URL(new URL(shareUrl).pathname, origin).toString()); await ensureStable(pageB); await pageB.locator("[data-share-cta]").waitFor(); }, 2200);
    const started = await fetch(`${origin}/__e2e/scenario/${runId}/start`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!started.ok || (await started.json()).inputAuthority !== AUTHORITY) throw new Error("Scenario start failed");
    await pageA.goto(`/match/${roomId}?lang=${encodeURIComponent(LOCALE)}`); await ensureJoined(pageA, "Ana");
    await scene("guest-join", "Guest-first join", ["B"], [pageB], async () => { await pageB.locator("[data-share-cta]").click(); await pageB.getByRole("button", { name: copy.join }).first().click(); await ensureJoined(pageB, "Bruno"); }, 2200, "no-preference");
    await Promise.all([pageA.getByText("Bruno", { exact: true }).first().waitFor(), pageB.getByText("Ana", { exact: true }).first().waitFor()]);
    await scene("shared-room", "Two participants in the same room", ["A", "B"], [pageA, pageB], async () => {}, 2200);
    await scene("room-share-sheet", "Room invite share sheet", ["A"], [pageA], async () => { const response = pageA.waitForResponse((item) => new URL(item.url()).pathname === "/shares" && item.status() === 201); await pageA.getByRole("button", { name: copy.invite }).click(); await response; await pageA.getByRole("dialog", { name: copy.shareDialog }).waitFor(); }, 2200);
    await pageA.getByRole("dialog", { name: copy.shareDialog }).getByRole("button", { name: /Close share sheet|Fechar compartilhamento/i }).click();
    await scene("match-room", "Match Room without visual Companion", ["A"], [pageA], async () => { await pageA.locator("[data-companion-state]").waitFor({ state: "detached" }).catch(() => {}); }, 1900);
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
    await Promise.all([pageA.getByRole("button", { name: copy.yes }).first().waitFor(), pageB.getByRole("button", { name: copy.yes }).first().waitFor()]);
    await scene("round-open", "Round open", ["A", "B"], [pageA, pageB], async () => {}, 1800, "no-preference");
    await scene("player-a-selects", "Player A selects", ["A"], [pageA], async () => selectYes(pageA), 1300, "no-preference");
    await scene("player-b-selects", "Player B selects", ["B"], [pageB], async () => selectYes(pageB), 1300, "no-preference");
    await scene("private-answers", "Private answers confirmed", ["A", "B"], [pageA, pageB], async () => Promise.all([confirm(pageA), confirm(pageB)]), 2200, "no-preference");
    await scene("normal-deadline", "Authoritative deadline", ["A", "B"], [pageA, pageB], async () => waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "locked", "locked state", 40_000), 1000);
    await scene("locked", "Server-owned lock", ["A", "B"], [pageA, pageB], async () => {}, 1800, "no-preference");
    await scene("resolution-both", "Synchronized resolution", ["A", "B"], [pageA, pageB], async () => { const response = await fetch(`${origin}/__e2e/scenario/${runId}/resolve`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!response.ok) throw new Error("Scenario resolve failed"); await waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "resolved", "resolved state"); await Promise.all([pageA.getByText(copy.ranking).first().waitFor({ timeout: 10_000 }), pageB.getByText(copy.ranking).first().waitFor({ timeout: 10_000 })]); }, 3600, "no-preference");
    await scene("ranking", "Synchronized ranking", ["A", "B"], [pageA, pageB], async () => {}, 2400, "no-preference");
    const verification = await (await fetch(`${origin}/public/rooms/${roomId}/verification`)).json();
    await scene("official-review", "Official Review", ["B"], [pageB], async () => { await pageB.goto(`/matches?lang=${encodeURIComponent(LOCALE)}`); await pageB.getByRole("button", { name: copy.review, exact: true }).click(); const review = pageB.getByRole("dialog").filter({ hasText: copy.reviewTitle }); await review.waitFor(); await review.getByText(copy.resultMatches, { exact: true }).waitFor(); }, 2600);
    await scene("replay-proof", "Replay and hashes", ["B"], [pageB], async () => { const review = pageB.getByRole("dialog").filter({ hasText: copy.reviewTitle }); await review.locator("summary").filter({ hasText: copy.audit }).click(); await review.locator("summary").filter({ hasText: copy.details }).click(); await review.getByText(/Round ID|ID da rodada/i).scrollIntoViewIfNeeded(); }, 3000);
    if (consoleErrors.length || serverErrors.length) throw new Error(`Capture health failed: ${JSON.stringify({ consoleErrors, serverErrors })}`);
    const aRaw = path.join(raw, "player-a.webm"), bRaw = path.join(raw, "player-b.webm");
    await Promise.all([contextA.close(), contextB.close()]); contextA = contextB = null; await Promise.all([videoA.saveAs(aRaw), videoB.saveAs(bRaw)]);
    await Promise.all((await readdir(raw)).filter((name) => name.endsWith(".webm") && !["player-a.webm", "player-b.webm"].includes(name)).map((name) => rm(path.join(raw, name), { force: true })));
    const aMaster = path.join(masters, "player-a-master-1080p30.mp4"), bMaster = path.join(masters, "player-b-master-1080p30.mp4");
    if (!CLIP_ONLY) await Promise.all([master(aRaw, aMaster), master(bRaw, bMaster)]);
    const files = [];
    const exportedScenes = CLIP_ONLY ? scenes.filter((item) => CLIP_ONLY_IDS.has(item.id)) : scenes;
    if (CLIP_ONLY && exportedScenes.length !== CLIP_ONLY_IDS.size) throw new Error(`Unknown --clip-only scene list: ${CLIP_ONLY}`);
    for (const item of exportedScenes) for (const player of item.players) { const target = path.join(clips, `${item.id}-player-${player.toLowerCase()}.mp4`); await clip(player === "A" ? aRaw : bRaw, target, preroll + item.startedAtMs, preroll + item.endedAtMs); files.push(path.relative(output, target).replaceAll("\\", "/")); }
    if (!CLIP_ONLY) { const multiplayer = scenes.filter((item) => item.players.length === 2), splitStart = multiplayer[0].startedAtMs, splitEnd = multiplayer.at(-1).endedAtMs; await split(aRaw, bRaw, path.join(output, "multiplayer-split-screen.mp4"), preroll + splitStart, splitEnd - splitStart); }
    if (CLIP_ONLY) await Promise.all([rm(raw, { recursive: true, force: true }), rm(masters, { recursive: true, force: true })]);
    const manifest = {
      schemaVersion: 3, kind: "VIRA_CONSUMER_DEMO_CAPTURE", runId, commitSha: gitSha(), buildId: await buildId(), deployment: DEPLOYMENT,
      capturedAtUtc: new Date().toISOString(), locale: LOCALE, timeZone: TIME_ZONE, captureMode: CAPTURE_MODE, inputAuthority: AUTHORITY,
      disclosure: "Recorded from a captured TxLINE test fixture; not represented as live delivery during recording.",
      video: { width: VIEWPORT.width, height: VIEWPORT.height, fps: 30, deviceScaleFactor: 1, sourceCodec: "vp8", editorialCodec: "h264" },
      runtime: { node: process.version, browser: CAPTURE_MODE === "mobile-webkit" ? "webkit" : "chromium", browserVersion: browser.version() },
      players: { A: "Ana", B: "Bruno" },
      scenes: scenes.map((item) => ({ ...item, startedAtSeconds: Number(seconds(item.startedAtMs)), endedAtSeconds: Number(seconds(item.endedAtMs)), durationSeconds: Number(seconds(item.endedAtMs - item.startedAtMs)) })),
      outputs: CLIP_ONLY ? { clipPatchFor: [...CLIP_ONLY_IDS], clips: files } : { playerA: "masters/player-a-master-1080p30.mp4", playerB: "masters/player-b-master-1080p30.mp4", rawPlayerA: "raw/player-a.webm", rawPlayerB: "raw/player-b.webm", splitScreen: "multiplayer-split-screen.mp4", clips: files },
      authority: { deadline: "authoritative_room_runtime", resolution: AUTHORITY, liveProjectionHash: verification.liveProjectionHash, replayedProjectionHash: verification.replayedProjectionHash, liveReplayEquivalent: verification.projectionMatches === true, rankingReplayEquivalent: verification.rankingMatches === true },
      alerts: { ...alertsCapture, nativeNotificationCaptured: false, nativeNotificationSource: "external_capture_required" },
      health: { consoleErrors: 0, serverErrors: 0 },
      privacy: { administrativeRoutesVisible: false, tokensArchived: false, logsArchived: false, harnessControlsVisible: false, technicalOverlayVisible: false },
    };
    await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); process.stdout.write(`${output}\n`);
  } finally { await contextA?.close().catch(() => {}); await contextB?.close().catch(() => {}); await browser?.close().catch(() => {}); if (backend) { backend.kill("SIGTERM"); await Promise.race([new Promise((resolve) => backend.once("exit", resolve)), delay(3000)]); } await rm(data, { recursive: true, force: true }); }
}

await main();
