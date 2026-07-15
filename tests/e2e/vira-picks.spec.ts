import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

let backend: ChildProcess; let origin = ""; let dataDir = ""; const fixtureId = "picks-e2e-2026"; const e2eToken = crypto.randomBytes(32).toString("hex");
function freePort(): Promise<number> { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : 0)); }); }); }
function run(command: string, args: string[], env: NodeJS.ProcessEnv) { return new Promise<void>((resolve, reject) => { const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "ignore", shell: process.platform === "win32" }); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command}_exit_${code}`))); }); }
async function waitForHealth() { await expect.poll(async () => { try { return (await fetch(`${origin}/health`)).status; } catch { return 0; } }, { timeout: 20_000 }).toBe(200); }
async function scenario(action: "lock" | "resolve") { return fetch(`${origin}/__e2e/picks/${fixtureId}/${action}`, { method: "POST", headers: { "X-Vira-E2E-Token": e2eToken } }); }
function snapshot(now = Date.now()) {
  const kickoff = new Date(now + 60 * 60_000).toISOString(); const observedAt = new Date(now - 5_000).toISOString(); const endpoint = `/api/odds/snapshot/${fixtureId}`;
  const market = (marketType: string, priceNames: string[], marketParameters: number | null = null) => ({ id: marketType, messageId: `message-${marketType}`, fixtureId, signature: `${fixtureId}|${marketType}|${marketParameters ?? "default"}`, marketType, marketParameters, marketPeriod: null, inRunning: false, capturedAt: observedAt, sourceEndpoint: endpoint, sequence: 7, options: priceNames.map((priceName, index) => ({ priceName, label: priceName, pct: [52, 26, 22][index] ?? 48, price: 1.5 + index })) });
  const context = { fixtureId, generatedAt: new Date(now).toISOString(), endpoints: { odds: { endpoint, receivedAt: new Date(now).toISOString(), ok: true } }, availableMarkets: [market("1X2_PARTICIPANT_RESULT", ["part1", "draw", "part2"]), market("TOTAL_GOALS", ["over", "under"], 2.5), market("BOTH_TEAMS_TO_SCORE", ["yes", "no"])] };
  return { version: 3, source: "txline", cacheSource: "server", generatedAt: new Date(now).toISOString(), featuredFixtureId: fixtureId, materialization: { contextsRefreshed: 0, contextsReused: 1, concurrency: 1 }, matches: [{ id: fixtureId, fixtureId, title: "Brazil vs France", competitionLabel: "World Cup", startTime: kickoff, status: "scheduled", homeTeam: "Brazil", awayTeam: "France", context }] };
}
async function createThree(page: Page, name: string, locale: "en" | "pt-BR") {
  await page.getByLabel(locale === "en" ? "Your name" : "Seu nome").fill(name);
  await page.getByRole("button", { name: locale === "en" ? /^Home/ : /^Casa/ }).click();
  await page.getByRole("button", { name: locale === "en" ? /^Over 2\.5/ : /^Mais de 2,5/ }).click();
  await page.getByRole("button", { name: locale === "en" ? /^Yes/ : /^Sim/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: locale === "en" ? "Confirm immutable card" : "Confirmar card imutável" }).first().click();
  await expect(page.getByText(locale === "en" ? "Immutable card" : "Card imutável", { exact: true })).toBeVisible();
}
async function capture(page: Page, testInfo: TestInfo, name: string) { const directory = path.resolve("artifacts", "picks-visual", testInfo.project.name); await mkdir(directory, { recursive: true }); await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: false }); }

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-picks-browser-")); await writeFile(path.join(dataDir, "txline-catalog.json"), JSON.stringify(snapshot()), "utf8");
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { ...process.env, VITE_VIRA_PICKS_ENABLED: "true" });
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: e2eToken, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1", VIRA_PICKS_ENABLED: "true", VIRA_PICKS_TOTAL_GOALS_MARKET_TYPES: "TOTAL_GOALS", VIRA_PICKS_BTTS_MARKET_TYPES: "BOTH_TEAMS_TO_SCORE", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] }); await waitForHealth();
});
test.afterAll(async () => { backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve)); await rm(dataDir, { recursive: true, force: true }); });

test("bilingual two-fan immutable journey remains separate from competitive state", async ({ browser }, testInfo) => {
  const before = await (await fetch(`${origin}/operational/metrics`)).json();
  const contextA = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" }); const contextB = await browser.newContext({ baseURL: origin, reducedMotion: "reduce" });
  const pageA = await contextA.newPage(); await pageA.goto(`/picks/${fixtureId}?lang=en`); await expect(pageA.getByRole("heading", { name: /Make your match picks/ })).toBeVisible();
  await pageA.keyboard.press("Tab"); expect(await pageA.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY"); await createThree(pageA, "Ana", "en");
  await pageA.getByRole("button", { name: "Confirm immutable card" }).click(); await expect(pageA.getByRole("alert")).toHaveText("Confirmed picks cannot be edited.");
  const shareResponse = pageA.waitForResponse((response) => response.url().endsWith("/share") && response.request().method() === "POST"); await pageA.getByRole("button", { name: "Share" }).click(); const share = await (await shareResponse).json() as { url: string };
  await expect.poll(() => pageA.getByAltText(/Preview of the VIRA share card/i).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200); await capture(pageA, testInfo, "picks-share-en");
  const pageB = await contextB.newPage(); await pageB.goto(new URL(share.url).pathname); await expect(pageB.locator("[data-share-cta]")).toBeVisible(); await pageB.locator("[data-share-cta]").click(); await expect(pageB.getByText("Ana · VIRA Picks")).toBeVisible(); await createThree(pageB, "Bruno", "en");
  expect((await scenario("lock")).status).toBe(200); expect((await scenario("resolve")).status).toBe(200); await pageA.reload(); await pageB.reload();
  await expect(pageA.getByText("3/3 — Perfect read")).toBeVisible(); await expect(pageB.getByText("3/3 — Perfect read")).toBeVisible(); await capture(pageA, testInfo, "picks-result-en");
  await pageA.getByRole("button", { name: "Share" }).click(); await expect.poll(() => pageA.getByAltText(/Preview of the VIRA share card/i).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1200); await capture(pageA, testInfo, "picks-result-share-en");
  await pageA.keyboard.press("Escape"); await pageA.goto(`/picks/${fixtureId}?lang=pt-BR`); await expect(pageA.getByText("3/3 — Leitura perfeita")).toBeVisible(); await expect(pageA.getByText("Ana")).toBeVisible();
  const after = await (await fetch(`${origin}/operational/metrics`)).json(); expect(after.ledger.globalPosition).toBe(before.ledger.globalPosition); expect(after.picks.cardsConfirmed).toBe(2); expect(after.picks.friendsCreatedPicks).toBe(1); expect(after.picks.cardsResolved).toBe(2);
  await contextA.close(); await contextB.close();
});
