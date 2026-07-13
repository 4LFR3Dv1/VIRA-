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
async function scenario(runId: string, action: "start" | "lock" | "resolve") { return fetch(`${origin}/__e2e/scenario/${runId}/${action}`, { method: "POST", headers: { "X-Vira-E2E-Token": e2eToken } }); }
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
    await Promise.all([answerYes(pageA), answerYes(pageB)]);
    const locked = await scenario(runId, "lock"); expect(locked.status).toBe(200);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 20_000 }).toBe("locked");
    const resolved = await scenario(runId, "resolve"); expect(resolved.status).toBe(200);
    await expect.poll(async () => (await (await fetch(`${origin}/public/rooms/${roomId}`)).json()).currentRound?.state, { timeout: 10_000 }).toBe("resolved");
    await expect(pageA.getByText(/Ranking atualizado/i).first()).toBeVisible();
    await expect(pageB.getByText(/Ranking atualizado/i).first()).toBeVisible();
    const publicState = await (await fetch(`${origin}/public/rooms/${roomId}`)).json();
    expect(publicState.leaderboard).toHaveLength(2);
    expect(publicState.leaderboard.map((entry: { points: number }) => entry.points)).toEqual([100, 100]);
  } finally { await Promise.all([close(playerA), close(playerB)]); }
});
