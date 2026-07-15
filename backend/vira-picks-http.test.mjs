import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function freePort() { return new Promise((resolve, reject) => { const server = http.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); }); }
async function wait(origin, child) { const limit = Date.now() + 15_000; while (Date.now() < limit) { if (child.exitCode !== null) throw new Error(`backend_exited_${child.exitCode}`); try { if ((await fetch(`${origin}/health`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 80)); } throw new Error("backend_timeout"); }
const headers = (token, json = false) => ({ ...(json ? { "Content-Type": "application/json" } : {}), "X-Vira-Public-Token": token, "X-Vira-Locale": "en", "X-Vira-Time-Zone": "UTC" });
const defaultPicksEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "VIRA_PICKS_ENABLED"));

function catalog(now) {
  const fixtureId = "picks-http-fixture"; const kickoff = new Date(now + 60 * 60_000).toISOString(); const observedAt = new Date(now - 10_000).toISOString(); const endpoint = `/api/odds/snapshot/${fixtureId}`;
  const market = (marketType, priceNames, marketParameters = null) => ({ id: marketType, messageId: `message-${marketType}`, fixtureId, signature: `${fixtureId}|${marketType}|${marketParameters ?? "default"}`, marketType, marketParameters, marketPeriod: null, inRunning: false, capturedAt: observedAt, sourceEndpoint: endpoint, sequence: 7, options: priceNames.map((priceName, index) => ({ priceName, label: priceName, pct: [52, 26, 22][index] ?? 48, price: 1.5 + index })) });
  const context = { fixtureId, generatedAt: new Date(now).toISOString(), endpoints: { odds: { endpoint, receivedAt: new Date(now).toISOString(), ok: true } }, availableMarkets: [market("1X2_PARTICIPANT_RESULT", ["part1", "draw", "part2"]), market("OVERUNDER_PARTICIPANT_GOALS", ["over", "under"], "line=2.5")] };
  return { version: 3, source: "txline", cacheSource: "server", generatedAt: new Date(now).toISOString(), featuredFixtureId: fixtureId, materialization: { contextsRefreshed: 0, contextsReused: 1, concurrency: 1 }, matches: [{ id: fixtureId, fixtureId, title: "Brazil vs France", competitionLabel: "World Cup", startTime: kickoff, status: "scheduled", homeTeam: "Brazil", awayTeam: "France", context }] };
}

test("HTTP projections enforce server snapshots, identity isolation, attribution and no competitive mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vira-picks-http-")); const dataDir = path.join(root, "data"); const catalogPath = path.join(root, "catalog.json"); await writeFile(catalogPath, JSON.stringify(catalog(Date.now())), "utf8");
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`; const child = spawn(process.execPath, ["backend/server.mjs"], { cwd: process.cwd(), env: { ...defaultPicksEnv, PORT: String(port), VIRA_DATA_DIR: dataDir, VIRA_CATALOG_SNAPSHOT_PATH: catalogPath, VIRA_VERIFIED_PLAYBACK_ENABLED: "false", TXLINE_JWT: "", TXLINE_API_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const tokenA = crypto.randomBytes(32).toString("hex"); const tokenB = crypto.randomBytes(32).toString("hex");
  try {
    await wait(origin, child); const before = await (await fetch(`${origin}/operational/metrics`)).json();
    const picksCatalog = await (await fetch(`${origin}/picks/fixtures/picks-http-fixture/catalog`, { headers: headers(tokenA) })).json(); assert.equal(picksCatalog.questions.every((item) => item.available), true); assert.deepEqual(picksCatalog.questions.map((item) => item.kind), ["match_result", "total_goals"]); assert.doesNotMatch(JSON.stringify(picksCatalog), /both_teams_score|btts/i);
    for (const [token, name] of [[tokenA, "Ana"], [tokenB, "Bruno"]]) { const response = await fetch(`${origin}/public/identity`, { method: "POST", headers: headers(token, true), body: JSON.stringify({ displayName: name }) }); assert.equal(response.status, 200); }
    const confirmation = { fixtureId: "picks-http-fixture", selectionIds: ["match_result:home", "total_goals:2.5:over"], idempotencyKey: "http-confirm-a", price: 999, marketType: "INJECTED", probability: 1 };
    const bttsResponse = await fetch(`${origin}/picks/cards`, { method: "POST", headers: headers(tokenA, true), body: JSON.stringify({ ...confirmation, selectionIds: ["both_teams_score:yes"], idempotencyKey: "http-btts-rejected" }) }); assert.equal(bttsResponse.status, 409);
    const firstResponse = await fetch(`${origin}/picks/cards`, { method: "POST", headers: headers(tokenA, true), body: JSON.stringify(confirmation) }); assert.equal(firstResponse.status, 201); const first = (await firstResponse.json()).card;
    const duplicate = (await (await fetch(`${origin}/picks/cards`, { method: "POST", headers: headers(tokenA, true), body: JSON.stringify(confirmation) })).json()).card; assert.equal(first.id, duplicate.id);
    const hidden = await (await fetch(`${origin}/picks/cards/public/${first.publicCode}`, { headers: headers(tokenB) })).json(); assert.deepEqual(hidden.card.selections, []); assert.doesNotMatch(JSON.stringify(hidden), new RegExp(tokenA, "i"));
    const sharedResponse = await fetch(`${origin}/picks/cards/${first.id}/share`, { method: "POST", headers: headers(tokenA, true), body: "{}" }); assert.equal(sharedResponse.status, 201); const shared = await sharedResponse.json(); assert.equal(shared.share.kind, "picks"); assert.doesNotMatch(JSON.stringify(shared), /token|credential|participantId/i);
    await fetch(`${origin}/picks/cards/public/${first.publicCode}/open`, { method: "POST", headers: headers(tokenB, true), body: "{}" });
    const secondResponse = await fetch(`${origin}/picks/cards`, { method: "POST", headers: headers(tokenB, true), body: JSON.stringify({ ...confirmation, idempotencyKey: "http-confirm-b", selectionIds: ["match_result:away"] }) }); assert.equal(secondResponse.status, 201); const second = (await secondResponse.json()).card; assert.notEqual(first.publicId, second.publicId);
    const persisted = JSON.parse(await readFile(path.join(dataDir, "picks-v1.json"), "utf8")); assert.equal(persisted.cards[first.id].socialGroupId, persisted.cards[second.id].socialGroupId); assert.doesNotMatch(JSON.stringify(persisted.snapshots), /999|INJECTED/);
    const after = await (await fetch(`${origin}/operational/metrics`)).json(); assert.equal(after.ledger.globalPosition, before.ledger.globalPosition); assert.equal(after.picks.cardsConfirmed, 2); assert.equal(after.picks.friendsCreatedPicks, 1);
  } finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); await rm(root, { recursive: true, force: true }); }
});
