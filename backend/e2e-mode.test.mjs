import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import { authorizeE2eRequest, e2eModeFromEnv } from "./e2e-mode.mjs";

const token = "ephemeral-token-only-for-this-run-123456";
const temp = path.join(os.tmpdir(), "vira-e2e-policy-run");

test("E2E mode is absent by default", () => {
  const mode = e2eModeFromEnv({});
  assert.deepEqual(authorizeE2eRequest(mode, { headers: { host: "127.0.0.1" } }), { ok: false, status: 404, error: "not_found" });
});
test("E2E mode blocks production nominally and requires an ephemeral token", () => {
  assert.throws(() => e2eModeFromEnv({ VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_DATA_DIR: temp, VIRA_E2E_ALLOWED_HOSTS: "vira.snelabs.space" }), /e2e_host_blocked/);
  assert.throws(() => e2eModeFromEnv({ VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: "short", VIRA_DATA_DIR: temp }), /e2e_ephemeral_token_required/);
  const mode = e2eModeFromEnv({ VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_DATA_DIR: temp });
  assert.equal(authorizeE2eRequest(mode, { headers: { host: "127.0.0.1" } }).status, 401);
  assert.equal(authorizeE2eRequest(mode, { headers: { host: "vira.snelabs.space", "x-vira-e2e-token": token } }).status, 403);
});
test("E2E persistence is confined to the OS temporary directory", () => {
  assert.throws(() => e2eModeFromEnv({ VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_DATA_DIR: path.resolve("data/e2e") }), /e2e_data_dir_must_be_temporary/);
  const mode = e2eModeFromEnv({ VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_DATA_DIR: temp });
  assert.equal(mode.dataDir, path.resolve(temp));
  assert.equal(path.dirname(mode.catalogSnapshotPath), path.resolve(temp));
});

function freePort() { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); }); }
async function waitForHealth(origin, child) { const deadline = Date.now() + 15_000; while (Date.now() < deadline) { if (child.exitCode !== null) throw new Error(`backend_exited_${child.exitCode}`); try { if ((await fetch(`${origin}/health`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error("backend_health_timeout"); }
async function withServer(env, operation) {
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), TXLINE_JWT: "", TXLINE_API_TOKEN: "", VIRA_VERIFIED_PLAYBACK_ENABLED: "false", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  try { await waitForHealth(origin, child); await operation(origin); } finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
}

test("administrative E2E routes are absent when disabled and fixed when enabled", async () => {
  const disabledDir = await mkdtemp(path.join(os.tmpdir(), "vira-e2e-disabled-"));
  const enabledDir = await mkdtemp(path.join(os.tmpdir(), "vira-e2e-enabled-"));
  try {
    await withServer({ VIRA_DATA_DIR: disabledDir, VIRA_E2E_ENABLED: "false" }, async (origin) => {
      assert.equal((await fetch(`${origin}/__e2e/scenario/policy-run/start`, { method: "POST" })).status, 404);
    });
    await withServer({ VIRA_DATA_DIR: enabledDir, VIRA_E2E_ENABLED: "true", VIRA_E2E_TOKEN: token, VIRA_E2E_ALLOWED_HOSTS: "127.0.0.1" }, async (origin) => {
      assert.equal((await fetch(`${origin}/__e2e/scenario/policy-run/start`, { method: "POST" })).status, 401);
      const headers = { "X-Vira-E2E-Token": token };
      const started = await fetch(`${origin}/__e2e/scenario/policy-run/start`, { method: "POST", headers });
      assert.equal(started.status, 200); assert.equal((await started.json()).inputAuthority, "captured_txline_test_fixture");
      const pressure = await fetch(`${origin}/__e2e/scenario/policy-run/pressure`, { method: "POST", headers });
      assert.equal(pressure.status, 200); assert.equal((await pressure.json()).state, "open");
      assert.equal((await fetch(`${origin}/__e2e/scenario/policy-run/start`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })).status, 405);
      assert.equal((await fetch(`${origin}/__e2e/ingest`, { method: "POST", headers })).status, 404);
      const ready = await (await fetch(`${origin}/ready`)).json(); assert.equal(path.resolve(ready.eventStore.dataDir), path.resolve(enabledDir));
    });
    const files = await readdir(enabledDir); assert.ok(files.every((file) => ["events.jsonl", "metadata.json", "social.json", "snapshots", "quarantine"].includes(file)), `unexpected persistence entry: ${files.join(",")}`);
  } finally { await rm(disabledDir, { recursive: true, force: true }); await rm(enabledDir, { recursive: true, force: true }); }
});
