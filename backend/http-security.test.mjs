import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`backend_exited_${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend_health_timeout");
}

test("internal ingestion is disabled by default and rejected requests do not append events", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-http-security-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_INTERNAL_INGEST_ENABLED: "false", VIRA_ADMIN_TOKEN: "test-admin-secret", VIRA_ALLOWED_ORIGINS: origin, TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(origin, child);
    const ready = await fetch(`${origin}/ready`);
    assert.equal(ready.status, 200);
    const readiness = await ready.json();
    assert.equal(readiness.ok, true);
    assert.equal(readiness.checks.rehydration.ok, true);
    assert.equal(readiness.checks.eventStore.ok, true);
    assert.equal(readiness.checks.txline.required, false);
    const frontend = await fetch(`${origin}/`);
    assert.equal(frontend.status, 200);
    assert.match(frontend.headers.get("content-type") || "", /^text\/html/);
    const html = await frontend.text();
    const modulePath = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
    assert.ok(modulePath, "built frontend module should be present");
    const moduleResponse = await fetch(new URL(modulePath, origin));
    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get("content-type") || "", /^text\/javascript/);
    assert.doesNotMatch(await moduleResponse.text(), /<html/i);
    const response = await fetch(`${origin}/rooms/security-room/txline-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Vira-Admin-Token": "test-admin-secret" },
      body: JSON.stringify({ type: "period", payload: {} }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "internal_ingest_disabled");
    const ledger = await readFile(path.join(dataDir, "events.jsonl"), "utf8").catch(() => "");
    assert.equal(ledger.includes("security-room"), false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("readiness fails when production requires missing TxLINE credentials", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-ready-txline-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_REQUIRE_TXLINE_CREDENTIALS: "true", TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(origin, child);
    const response = await fetch(`${origin}/ready`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.checks.txline.required, true);
    assert.equal(body.checks.txline.configured, false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
