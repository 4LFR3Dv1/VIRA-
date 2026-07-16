import { devices, expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

let backend: ChildProcess; let origin = ""; let dataDir = "";
function freePort(): Promise<number> { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(typeof address === "object" && address ? address.port : 0)); }); }); }
function run(command: string, args: string[]) { return new Promise<void>((resolve, reject) => { const child = spawn(command, args, { cwd: process.cwd(), stdio: "ignore", shell: process.platform === "win32" }); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command}_exit_${code}`))); }); }

test.beforeAll(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-judge-guide-")); await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: "production", VIRA_DATA_DIR: dataDir, VIRA_VERIFIED_PLAYBACK_ENABLED: "true", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: "ignore" });
  await expect.poll(async () => { try { return (await fetch(`${origin}/health`)).status; } catch { return 0; } }, { timeout: 20_000 }).toBe(200);
});
test.afterAll(async () => { backend?.kill("SIGTERM"); if (backend) await new Promise((resolve) => backend.once("exit", resolve)); await rm(dataDir, { recursive: true, force: true }); });

test("judge guide stays bilingual, responsive and pinned to certified evidence", async ({ browser }, testInfo) => {
  const { defaultBrowserType: _defaultBrowserType, ...iphone } = devices["iPhone 13"];
  const context = await browser.newContext(testInfo.project.name === "mobile-webkit" ? { ...iphone, baseURL: origin, reducedMotion: "reduce" } : { baseURL: origin, reducedMotion: "reduce" });
  const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/help?lang=en");
  await expect(page.getByRole("heading", { name: "Evaluate the complete VIRA journey." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "VIRA Picks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Match Room" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Certified playback" })).toBeVisible();
  await expect(page.getByText(/sanitized deterministic TxLINE test fixture/i).first()).toBeVisible();
  await expect(page.getByText(/From TxLINE observation to reproducible result/i)).toBeVisible();
  await expect(page.getByText(/Replay completed/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Watch 3:40 demo/i }).first()).toHaveAttribute("href", /youtube\.com/);
  await expect(page.getByRole("link", { name: /Public repository/i }).first()).toHaveAttribute("href", /github\.com\/4LFR3Dv1\/VIRA-/);
  await expect(page.getByRole("link", { name: /Commercial pitch/i })).toHaveAttribute("href", /VIRA_Synchronized_Football_Engagement\.pdf/);
  const playback = await (await fetch(`${origin}/public/playback`)).json();
  expect(playback.source.kind).toBe("canonical_certified_fixture"); expect(playback.source.liveDuringReview).toBe(false); expect(playback.verification.status).toBe("verified");
  await page.goto("/help?lang=pt-BR");
  await expect(page.getByRole("heading", { name: "Avalie a jornada completa do VIRA." })).toBeVisible();
  await expect(page.getByText(/fixture de teste TxLINE sanitizada e determinística/i).first()).toBeVisible();
  await expect(page.getByText("Inicializando VIRA", { exact: true })).toBeHidden();
  const directory = path.resolve("artifacts", "judge-guide", testInfo.project.name); await mkdir(directory, { recursive: true }); await page.screenshot({ path: path.join(directory, "judge-guide-pt-BR.png"), fullPage: true });
  expect(errors).toEqual([]); await context.close();
});
