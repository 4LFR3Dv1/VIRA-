import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright";
import { deriveFixtureConsumerProjection } from "../../shared/fixture-consumer-projection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VIEWPORT = { width: 1280, height: 720 };
const AUTHORITY = "captured_txline_test_fixture";
const scenes = [];
let epoch = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => Math.max(0, ms / 1000).toFixed(3);
function run(command, args, silent = false) { return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd: ROOT, stdio: silent ? "ignore" : "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`))); }); }
function freePort() { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); }); }
async function waitFor(fn, label, timeout = 20_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn().catch(() => false)) return; await delay(150); } throw new Error(`Timed out: ${label}`); }
async function scene(id, title, players, action, hold = 1800) { const startedAtMs = Date.now() - epoch; await action(); await delay(hold); scenes.push({ id, title, players, startedAtMs, endedAtMs: Date.now() - epoch }); }

function catalog(roomId) {
  const generatedAt = new Date().toISOString();
  const startTime = new Date(Date.now() + 86_400_000).toISOString();
  const context = { fixtureId: roomId, provider: "TxLINE", generatedAt, fixture: { provider: "TxLINE", source: "txline", fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", status: "scheduled", startTime, homeTeam: "France", awayTeam: "Spain" }, canonical1X2: { marketSignature: `${roomId}|MATCH_RESULT_1X2|full-match`, snapshotId: `captured-${roomId}`, providerSequence: 42, observedAt: new Date(Date.now() - 120_000).toISOString(), selections: { home: 51, draw: 27, away: 22 } }, availableMarkets: [], suggestedPrediction: { priceName: "part1", probability: 51 }, cache: { status: "captured", cachedAt: generatedAt, ttlMs: 30_000 } };
  const fixture = { id: roomId, fixtureId: roomId, title: "France vs Spain", competitionLabel: "World Cup", competition: { providerCompetitionId: 72, canonicalCompetitionId: "world-cup", displayName: "World Cup", kind: "world_cup", authority: "txline", mapped: true }, startTime, status: "scheduled", homeTeam: "France", awayTeam: "Spain", source: "txline", context };
  const projection = deriveFixtureConsumerProjection({ fixture, txlineContext: context, evaluatedAt: generatedAt });
  return { version: 3, source: "txline", cacheSource: "captured", inputAuthority: AUTHORITY, generatedAt, featuredFixtureId: roomId, refreshReason: "captured-demo-fixture", materialization: { contextsRefreshed: 0, contextsReused: 1, concurrency: 1 }, matches: [{ ...fixture, consumerProjection: projection, availability: { marketCount: 1, canonical1X2Available: true, hasMarket: true, hasPlayablePrediction: projection.availability.canPredict, ...projection.availability, contextStatus: "ready" } }] };
}

async function addBadge(context, player) {
  await context.addInitScript(({ player, authority }) => {
    const mount = () => { if (document.querySelector("[data-vira-demo-badge]")) return; const node = document.createElement("div"); node.dataset.viraDemoBadge = "true"; node.textContent = `${player} · DEMO INPUT: ${authority} · FIXTURE CAPTURADA`; Object.assign(node.style, { position: "fixed", right: "14px", bottom: "14px", zIndex: "2147483647", padding: "7px 10px", color: "#b7ff29", background: "rgba(5,8,20,.92)", border: "1px solid rgba(183,255,41,.45)", font: "700 9px monospace", letterSpacing: ".08em", pointerEvents: "none" }); document.body.appendChild(node); }; document.addEventListener("DOMContentLoaded", mount); if (document.body) mount();
  }, { player, authority: AUTHORITY });
}

async function join(page, name) { const dialog = page.getByRole("dialog", { name: "Entrar na sala" }); await dialog.getByPlaceholder("Nome na sala").fill(name); await dialog.getByRole("button", { name: "Entrar na sala" }).click(); await page.getByText(name, { exact: true }).first().waitFor(); }
async function ensureJoined(page, name) { const dialog = page.getByRole("dialog", { name: "Entrar na sala" }); if (await dialog.isVisible().catch(() => false)) await join(page, name); else await page.getByText(name, { exact: true }).first().waitFor(); }
async function answer(page) { await page.getByRole("button", { name: /SIM/i }).first().click(); await page.getByRole("button", { name: /Confirmar palpite/i }).click(); await page.getByText(/Palpite confirmado/i).first().waitFor(); }
async function clip(input, output, start, end) { await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", input, "-t", seconds(end - start), "-vf", "fps=30,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", output], true); }
async function split(a, b, output, start, duration) { const filter = "[0:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:#050814[a];[1:v]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:#050814[b];[a][b]hstack=inputs=2,format=yuv420p[v]"; await run(ffmpegPath, ["-y", "-ss", seconds(start), "-i", a, "-ss", seconds(start), "-i", b, "-t", seconds(duration), "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", output], true); }

async function main() {
  const runId = `demo-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const roomId = `e2e-${runId}`;
  const output = path.resolve(ROOT, "artifacts", "demo", runId);
  const raw = path.join(output, "raw"); const clips = path.join(output, "clips");
  const data = await mkdtemp(path.join(os.tmpdir(), "vira-consumer-demo-"));
  const token = crypto.randomBytes(32).toString("hex");
  let backend, browser, contextA, contextB;
  await mkdir(raw, { recursive: true }); await mkdir(clips, { recursive: true });
  await writeFile(path.join(data, "txline-catalog.json"), JSON.stringify(catalog(roomId)), "utf8");
  try {
    const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
    backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: data, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", VIRA_MARKET_ROUNDS_ENABLED: "false", VIRA_ROUND_ANSWER_WINDOW_SEC: "30", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: "ignore" });
    await waitFor(async () => (await fetch(`${origin}/health`)).ok, "backend health");
    browser = await chromium.launch({ headless: true });
    const options = { baseURL: origin, viewport: VIEWPORT, recordVideo: { dir: raw, size: VIEWPORT }, reducedMotion: "reduce" };
    [contextA, contextB] = await Promise.all([browser.newContext(options), browser.newContext(options)]);
    await Promise.all([contextA.grantPermissions(["clipboard-read", "clipboard-write"], { origin }), contextB.grantPermissions(["clipboard-read", "clipboard-write"], { origin }), addBadge(contextA, "PLAYER A"), addBadge(contextB, "PLAYER B")]);
    const videoStart = Date.now(); const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]); const videoA = pageA.video(); const videoB = pageB.video();
    await pageB.setContent("<main style='height:100vh;display:grid;place-items:center;background:#050814;color:#b7ff29;font:700 20px monospace'>PLAYER B · AGUARDANDO O LINK</main>"); epoch = Date.now(); const preroll = epoch - videoStart;
    let shareUrl = "";
    await scene("home-pick", "Home e palpite", ["A"], async () => { await pageA.goto("/"); await pageA.getByRole("textbox", { name: "Seu nome" }).fill("Ana"); await pageA.getByRole("button", { name: /France/i }).click(); await pageA.getByRole("button", { name: /Compartilhar: France/i }).waitFor(); }, 2600);
    await scene("prediction-share", "Criação do share pela interface", ["A"], async () => { const response = pageA.waitForResponse((item) => item.url().includes(`/predictions/${roomId}/share`) && item.status() === 201); await pageA.getByRole("button", { name: /Compartilhar: France/i }).click(); shareUrl = (await (await response).json()).url; }, 2200);
    await scene("player-b-opens-share", "Segundo participante abrindo o link", ["B"], async () => { await pageB.goto(new URL(new URL(shareUrl).pathname, origin).toString()); await pageB.locator("[data-share-cta]").waitFor(); }, 2400);
    const started = await fetch(`${origin}/__e2e/scenario/${runId}/start`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!started.ok || (await started.json()).inputAuthority !== AUTHORITY) throw new Error("Scenario start failed");
    await pageA.goto(`/match/${roomId}`); await ensureJoined(pageA, "Ana"); await pageB.locator("[data-share-cta]").click(); await pageB.getByRole("button", { name: /Entrar na sala/i }).first().click(); await ensureJoined(pageB, "Bruno"); await Promise.all([pageA.getByText("Bruno", { exact: true }).first().waitFor(), pageB.getByText("Ana", { exact: true }).first().waitFor()]);
    await scene("shared-room", "Dois participantes na mesma sala", ["A", "B"], async () => {}, 2600);
    await Promise.all([pageA.getByRole("button", { name: /SIM/i }).first().waitFor(), pageB.getByRole("button", { name: /SIM/i }).first().waitFor()]);
    await scene("round-answers", "Rodada e respostas", ["A", "B"], async () => Promise.all([answer(pageA), answer(pageB)]), 2100);
    await scene("normal-deadline", "Deadline normal", ["A", "B"], async () => waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "locked", "locked state", 40_000), 1600);
    await scene("resolution-both", "Resolução nos dois browsers", ["A", "B"], async () => { const response = await fetch(`${origin}/__e2e/scenario/${runId}/resolve`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!response.ok) throw new Error("Scenario resolve failed"); await waitFor(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state === "resolved", "resolved state"); const takeover = await Promise.all([pageA.getByText(/Ranking atualizado/i).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false), pageB.getByText(/Ranking atualizado/i).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false)]); if (!takeover.every(Boolean)) { await Promise.all([pageA.reload(), pageB.reload()]); await Promise.all([pageA.locator("#match-ranking").waitFor(), pageB.locator("#match-ranking").waitFor()]); } }, 3000);
    await scene("ranking", "Ranking sincronizado", ["A", "B"], async () => { const [rankingA, rankingB] = [pageA.getByText(/Ranking atualizado/i).first(), pageB.getByText(/Ranking atualizado/i).first()]; await Promise.all([rankingA.waitFor(), rankingB.waitFor()]); await Promise.all([rankingA.scrollIntoViewIfNeeded(), rankingB.scrollIntoViewIfNeeded()]); }, 2600);
    const verification = await (await fetch(`${origin}/public/rooms/${roomId}/verification`)).json();
    await scene("official-review", "Official Review e equivalência live/replay", ["B"], async () => { await pageB.goto("/matches"); await pageB.getByRole("button", { name: "Abrir Revisao Oficial", exact: true }).click(); const review = pageB.getByRole("dialog").filter({ hasText: "Revisão Oficial VIRA" }); await review.waitFor(); await review.getByText("O resultado foi o mesmo", { exact: true }).waitFor(); await review.getByText("A classificação foi a mesma", { exact: true }).waitFor(); }, 3600);
    const aPath = path.join(raw, "player-a.webm"), bPath = path.join(raw, "player-b.webm");
    await Promise.all([contextA.close(), contextB.close()]); contextA = contextB = null; await Promise.all([videoA.saveAs(aPath), videoB.saveAs(bPath)]);
    await Promise.all((await readdir(raw)).filter((name) => name.endsWith(".webm") && !["player-a.webm", "player-b.webm"].includes(name)).map((name) => rm(path.join(raw, name), { force: true })));
    const files = [];
    for (const item of scenes) for (const player of item.players) { const target = path.join(clips, `${item.id}-player-${player.toLowerCase()}.mp4`); await clip(player === "A" ? aPath : bPath, target, preroll + item.startedAtMs, preroll + item.endedAtMs); files.push(path.relative(output, target).replaceAll("\\", "/")); }
    const multiplayer = scenes.filter((item) => item.players.length === 2), splitStart = multiplayer[0].startedAtMs, splitEnd = multiplayer.at(-1).endedAtMs;
    await split(aPath, bPath, path.join(output, "multiplayer-split-screen.mp4"), preroll + splitStart, splitEnd - splitStart);
    const manifest = { schemaVersion: 1, kind: "VIRA_CONSUMER_DEMO_CAPTURE", runId, createdAt: new Date().toISOString(), inputAuthority: AUTHORITY, disclosure: "Recorded from a captured TxLINE test fixture; not represented as live delivery during recording.", viewport: VIEWPORT, players: { A: "Ana", B: "Bruno" }, scenes: scenes.map((item) => ({ ...item, startedAtSeconds: Number(seconds(item.startedAtMs)), endedAtSeconds: Number(seconds(item.endedAtMs)), durationSeconds: Number(seconds(item.endedAtMs - item.startedAtMs)) })), outputs: { playerA: "raw/player-a.webm", playerB: "raw/player-b.webm", splitScreen: "multiplayer-split-screen.mp4", clips: files }, authority: { deadline: "authoritative_room_runtime", resolution: AUTHORITY, liveReplayEquivalent: verification.projectionMatches === true, rankingReplayEquivalent: verification.rankingMatches === true }, privacy: { administrativeRoutesVisible: false, tokensArchived: false, logsArchived: false, harnessControlsVisible: false } };
    await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); process.stdout.write(`${output}\n`);
  } finally { await contextA?.close().catch(() => {}); await contextB?.close().catch(() => {}); await browser?.close().catch(() => {}); if (backend) { backend.kill("SIGTERM"); await Promise.race([new Promise((resolve) => backend.once("exit", resolve)), delay(3000)]); } await rm(data, { recursive: true, force: true }); }
}

await main();
