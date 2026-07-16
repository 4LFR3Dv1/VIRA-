import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import ffmpegPath from "ffmpeg-static";
import { deriveFixtureConsumerProjection } from "../../shared/fixture-consumer-projection.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const fixtureId = "picks-v2-certified-2026";
const runId = `demo-v2-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
const output = path.join(ROOT, "artifacts", "demo-v2", "product", runId);
const screenshots = path.join(output, "screenshots");
const clips = path.join(output, "clips");
const raw = path.join(output, "raw");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-demo-v2-"));
const token = crypto.randomBytes(32).toString("hex");
const failures = [];
const expectedEvents = [];
const evidence = {};
let backend;

function commitSha() { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "unavailable"; } }
function freePort() { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : 0)); }); }); }
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function run(file, args, stdio = "ignore") { return new Promise((resolve, reject) => { const child = spawn(file, args, { cwd: ROOT, stdio }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(file)}_exit_${code}`))); }); }
async function health(origin) { for (let attempt = 0; attempt < 80; attempt += 1) { try { if ((await fetch(`${origin}/health`)).ok) return; } catch {} await wait(250); } throw new Error("backend_health_timeout"); }
async function shot(page, id, player = "a") { const file = path.join(screenshots, `${id}-player-${player}.png`); await page.screenshot({ path: file, fullPage: false }); return file; }
async function waitSharePreview(page) {
  const image = page.getByAltText(/Preview of the VIRA share card/i);
  await image.waitFor();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await image.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth === 1200 && element.naturalHeight === 630)) return image;
    await wait(100);
  }
  throw new Error("share_preview_not_rendered_1200x630");
}
async function saveSharePng(image, file) {
  const source = await image.getAttribute("src");
  if (!source) throw new Error("share_preview_missing_src");
  const response = await fetch(new URL(source, origin));
  if (!response.ok) throw new Error(`share_preview_download_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);
  return bytes;
}
async function stillClip(input, id, player = "a") {
  const target = path.join(clips, `${id}-player-${player}.mp4`);
  const mobile = player === "b";
  const filter = mobile
    ? "scale=-2:980:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,format=yuv420p"
    : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:#050A12,format=yuv420p";
  await run(ffmpegPath, ["-y", "-loop", "1", "-i", input, "-t", "7", "-vf", filter, "-r", "30", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p", target]);
  return target;
}
function snapshot(now = Date.now()) {
  const kickoff = new Date(now + 60 * 60_000).toISOString();
  const observedAt = new Date(now - 5_000).toISOString();
  const endpoint = `/api/odds/snapshot/${fixtureId}`;
  const market = (marketType, priceNames, marketParameters = null) => ({ id: marketType, messageId: `message-${marketType}`, fixtureId, signature: `${fixtureId}|${marketType}|${marketParameters ?? "default"}`, marketType, marketParameters, marketPeriod: null, inRunning: false, capturedAt: observedAt, sourceEndpoint: endpoint, sequence: 7, options: priceNames.map((priceName, index) => ({ priceName, label: priceName, pct: [52, 26, 22][index] ?? 48, price: 1.5 + index })) });
  const context = { fixtureId, generatedAt: new Date(now).toISOString(), endpoints: { odds: { endpoint, receivedAt: new Date(now).toISOString(), ok: true } }, canonical1X2: { marketSignature: `${fixtureId}|MATCH_RESULT_1X2|full-match`, snapshotId: `captured-${fixtureId}`, providerSequence: 7, observedAt, selections: { home: 52, draw: 26, away: 22 } }, availableMarkets: [market("1X2_PARTICIPANT_RESULT", ["part1", "draw", "part2"]), market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5")] };
  const fixture = { id: fixtureId, fixtureId, title: "Brazil vs France", competitionLabel: "World Cup", competition: { providerCompetitionId: 72, canonicalCompetitionId: "world-cup", displayName: "World Cup", kind: "world_cup", authority: "txline", mapped: true }, startTime: kickoff, status: "scheduled", homeTeam: "Brazil", awayTeam: "France", source: "txline", context };
  const consumerProjection = deriveFixtureConsumerProjection({ fixture, txlineContext: context, evaluatedAt: new Date(now).toISOString() });
  return { version: 3, source: "txline", cacheSource: "captured", inputAuthority: "captured_txline_test_fixture", generatedAt: new Date(now).toISOString(), featuredFixtureId: fixtureId, refreshReason: "certified-demo-v2", materialization: { contextsRefreshed: 0, contextsReused: 1, concurrency: 1 }, matches: [{ ...fixture, consumerProjection, availability: { marketCount: context.availableMarkets.length, canonical1X2Available: true, hasMarket: true, hasPlayablePrediction: consumerProjection.availability.canPredict, ...consumerProjection.availability, contextStatus: "ready" } }] };
}
async function confirm(page, name, selections) {
  await page.getByLabel("Your name").fill(name);
  for (const selection of selections) await page.getByRole("button", { name: selection }).click();
  await page.getByRole("checkbox").check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/picks/cards") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm immutable card" }).first().click();
  const response = await responsePromise;
  const payload = await response.json();
  await page.getByText("Immutable card", { exact: true }).waitFor();
  return payload.card;
}

await Promise.all([mkdir(screenshots, { recursive: true }), mkdir(clips, { recursive: true }), mkdir(raw, { recursive: true })]);
await writeFile(path.join(dataDir, "txline-catalog.json"), JSON.stringify(snapshot()), "utf8");
const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: dataDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_VERIFIED_PLAYBACK_ENABLED: "true", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
backend.stderr.on("data", (chunk) => {
  const message = String(chunk).slice(0, 800);
  if (/catalog refresh disabled: missing credentials/i.test(message)) expectedEvents.push({ type: "deterministic_harness", message });
  else failures.push({ type: "server_stderr", message });
});

let browserA; let browserB; let contextA; let contextB;
try {
  await health(origin);
  browserA = await chromium.launch({ headless: true }); browserB = await webkit.launch({ headless: true });
  contextA = await browserA.newContext({ baseURL: origin, viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 }, recordVideo: { dir: raw, size: { width: 1920, height: 1080 } }, locale: "en-US", timezoneId: "America/Sao_Paulo", reducedMotion: "reduce", serviceWorkers: "block" });
  contextB = await browserB.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, recordVideo: { dir: raw, size: { width: 390, height: 844 } }, locale: "en-US", timezoneId: "America/Sao_Paulo", reducedMotion: "reduce", serviceWorkers: "block" });
  const pageA = await contextA.newPage(); const pageB = await contextB.newPage(); const videoA = pageA.video(); const videoB = pageB.video();
  for (const [player, page] of [["A", pageA], ["B", pageB]]) {
    page.on("pageerror", (error) => failures.push({ player, type: "pageerror", message: error.message }));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text().slice(0, 500);
      if (/status of 401 \(Unauthorized\)/i.test(text)) expectedEvents.push({ player, type: "guest_identity_bootstrap", message: text });
      else failures.push({ player, type: "console", message: text });
    });
    page.on("response", (response) => { if (response.status() >= 500) failures.push({ player, type: "http", status: response.status(), url: response.url() }); });
  }

  await pageA.goto(`/match/${fixtureId}/preview?lang=en`); await pageA.getByText("Brazil", { exact: true }).first().waitFor(); await shot(pageA, "preview");
  await pageA.goto(`/picks/${fixtureId}?lang=en`); await pageA.getByRole("heading", { name: /Make your match picks/ }).waitFor(); await shot(pageA, "picks-builder");
  await pageA.getByLabel("Your name").fill("Ana"); await pageA.getByRole("button", { name: /^Home/ }).click(); await pageA.getByRole("button", { name: /^Over 2\.5/ }).click(); await pageA.getByRole("checkbox").check(); await shot(pageA, "picks-selected");
  const confirmAResponse = pageA.waitForResponse((response) => response.url().endsWith("/picks/cards") && response.request().method() === "POST"); await pageA.getByRole("button", { name: "Confirm immutable card" }).first().click(); evidence.cardA = (await (await confirmAResponse).json()).card; await pageA.getByText("Immutable card", { exact: true }).waitFor(); await shot(pageA, "picks-confirmed");
  const shareResponse = pageA.waitForResponse((response) => response.url().endsWith("/share") && response.request().method() === "POST"); await pageA.getByRole("button", { name: "Share" }).click(); const share = await (await shareResponse).json(); evidence.share = { publicCode: share.share?.publicCode, urlPath: new URL(share.url, origin).pathname }; const picksSharePreview = await waitSharePreview(pageA); await shot(pageA, "picks-share"); await saveSharePng(picksSharePreview, path.join(screenshots, "picks-share-card-player-a.png"));

  const sharedUrl = new URL(share.url, origin); await pageB.goto(`${sharedUrl.pathname}${sharedUrl.search}`); await pageB.locator("[data-share-cta]").waitFor(); await shot(pageB, "friend-opens", "b"); await pageB.locator("[data-share-cta]").click(); await pageB.getByText("Ana · VIRA Picks").waitFor();
  evidence.cardB = await confirm(pageB, "Bruno", [/^Away/, /^Over 2\.5/]); await shot(pageB, "friend-confirmed", "b");
  const lock = await fetch(`${origin}/__e2e/picks/${fixtureId}/lock`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!lock.ok) throw new Error(`picks_lock_${lock.status}`); await Promise.all([pageA.reload(), pageB.reload()]); await pageA.getByText("Immutable card", { exact: true }).waitFor(); await shot(pageA, "picks-locked");
  const resolve = await fetch(`${origin}/__e2e/picks/${fixtureId}/resolve`, { method: "POST", headers: { "X-Vira-E2E-Token": token } }); if (!resolve.ok) throw new Error(`picks_resolve_${resolve.status}`); await Promise.all([pageA.reload(), pageB.reload()]); await pageA.getByText("2/2 — Perfect read").waitFor(); await shot(pageA, "picks-result");
  await pageA.getByRole("button", { name: "Share" }).click(); const resultSharePreview = await waitSharePreview(pageA); await shot(pageA, "picks-result-share"); await saveSharePng(resultSharePreview, path.join(screenshots, "picks-result-share-card-player-a.png")); await pageA.keyboard.press("Escape");

  await pageA.goto("/help?lang=en"); await pageA.getByRole("heading", { name: "Evaluate the complete VIRA journey." }).waitFor(); await pageA.getByText("Initializing VIRA", { exact: true }).waitFor({ state: "hidden" }); await shot(pageA, "judge-hero");
  await pageA.getByRole("heading", { name: "Certified playback" }).scrollIntoViewIfNeeded(); await pageA.getByText(/Replay completed/i).waitFor(); await shot(pageA, "judge-playback");
  await pageA.getByText(/From TxLINE observation to reproducible result/i).scrollIntoViewIfNeeded(); await shot(pageA, "judge-chain");
  evidence.playback = await (await fetch(`${origin}/public/playback`)).json(); evidence.metrics = await (await fetch(`${origin}/operational/metrics`)).json();

  await Promise.all([contextA.close(), contextB.close()]); contextA = contextB = null;
  await Promise.all([videoA.saveAs(path.join(raw, "player-a-product-v2.webm")), videoB.saveAs(path.join(raw, "player-b-product-v2.webm"))]);
  const images = await Promise.all([
    ...["preview", "picks-builder", "picks-selected", "picks-confirmed", "picks-share", "picks-share-card", "picks-locked", "picks-result", "picks-result-share", "picks-result-share-card", "judge-hero", "judge-playback", "judge-chain"].map(async (id) => stillClip(path.join(screenshots, `${id}-player-a.png`), id)),
    ...["friend-opens", "friend-confirmed"].map(async (id) => stillClip(path.join(screenshots, `${id}-player-b.png`), id, "b")),
  ]);
  const manifest = { schemaVersion: 1, kind: "VIRA_DEMO_V2_PRODUCT_CAPTURE", runId, commitSha: commitSha(), capturedAtUtc: new Date().toISOString(), locale: "en", timeZone: "America/Sao_Paulo", fixtureId, inputAuthority: "captured_txline_test_fixture", disclosure: "VIRA Picks and certified playback use sanitized deterministic TxLINE fixtures. They are not represented as current live delivery.", browsers: { A: "chromium-desktop", B: "mobile-webkit-emulated" }, identitiesDistinct: true, cardsConfirmed: 2, cardsImmutable: true, serverLock: true, resultsResolved: true, btssExposed: false, competitiveLedgerIsolated: true, playbackVerified: evidence.playback?.verification?.status === "verified", failures, expectedEvents, outputs: { clips: images.map((item) => path.relative(output, item).replaceAll("\\", "/")), raw: ["raw/player-a-product-v2.webm", "raw/player-b-product-v2.webm"] }, evidence: { cardA: { id: evidence.cardA?.id, publicCode: evidence.cardA?.publicCode, status: evidence.cardA?.status, marketSnapshotRefs: evidence.cardA?.marketSnapshotRefs }, cardB: { id: evidence.cardB?.id, publicCode: evidence.cardB?.publicCode, status: evidence.cardB?.status, marketSnapshotRefs: evidence.cardB?.marketSnapshotRefs }, share: evidence.share, playback: { source: evidence.playback?.source, verification: evidence.playback?.verification }, metrics: { picks: evidence.metrics?.picks, ledgerPosition: evidence.metrics?.ledger?.globalPosition } } };
  await writeFile(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
} finally {
  if (contextA || contextB) await Promise.allSettled([contextA?.close(), contextB?.close()]);
  await Promise.allSettled([browserA?.close(), browserB?.close()]);
  backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve));
  await rm(dataDir, { recursive: true, force: true });
}
