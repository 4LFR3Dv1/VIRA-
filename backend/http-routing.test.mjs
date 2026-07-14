import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    try { if ((await fetch(`${origin}/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("backend_health_timeout");
}

test("SPA deep links and canonical catalog route do not collide", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vira-http-routing-"));
  const dataDir = path.join(root, "data");
  const distDir = path.join(root, "dist");
  const catalogPath = path.join(root, "catalog-v3.json");
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "index.html"), '<!doctype html><html><body><main id="root">VIRA SPA SHELL</main></body></html>', "utf8");
  await writeFile(catalogPath, JSON.stringify({ version: 3, source: "txline", cacheSource: "server", generatedAt: "2026-07-13T00:00:00.000Z", featuredFixtureId: null, materialization: { contextsRefreshed: 0, contextsReused: 0, concurrency: 1 }, matches: [] }), "utf8");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["backend/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_DIST_DIR: distDir, VIRA_CATALOG_SNAPSHOT_PATH: catalogPath, VIRA_REQUIRE_TXLINE_CREDENTIALS: "false", TXLINE_JWT: "", TXLINE_API_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(origin, child);
    for (const route of ["/matches", "/match/fixture-direct/preview", "/match/fixture-direct", "/match/fixture-direct/companion"]) {
      const response = await fetch(`${origin}${route}`, { headers: { Accept: "text/html" } });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") || "", /^text\/html/, route);
      assert.match(await response.text(), /VIRA SPA SHELL/, route);
    }
    const catalogResponse = await fetch(`${origin}/matches/catalog`, { headers: { Accept: "application/json" } });
    assert.equal(catalogResponse.status, 200);
    assert.match(catalogResponse.headers.get("content-type") || "", /^application\/json/);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.version, 3);
    assert.equal(catalog.cacheSource, "server");
    assert.deepEqual(catalog.matches, []);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
