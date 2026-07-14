import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const suffix = `${process.pid}-${Date.now()}`;
const image = process.env.VIRA_SMOKE_IMAGE || `vira-ci:${suffix}`;
const container = `vira-ci-${suffix}`;
const volume = `vira-ci-data-${suffix}`;
const roomId = "p1a-smoke-room";
const port = Number(process.env.VIRA_SMOKE_PORT || 18787);
const origin = `http://127.0.0.1:${port}`;
const keep = process.env.VIRA_KEEP_SMOKE_RESOURCES === "true";
const startedAt = new Date().toISOString();

function docker(args, options = {}) {
  const output = execFileSync("docker", args, { encoding: "utf8", stdio: options.capture ? "pipe" : "inherit" });
  return options.capture ? String(output ?? "").trim() : "";
}

async function waitForReady() {
  const deadline = Date.now() + 45_000;
  let lastBody = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/ready`);
      lastBody = await response.json();
      if (response.ok && lastBody.ok) return lastBody;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`container_readiness_timeout:${JSON.stringify(lastBody)}`);
}

async function readProof() {
  const [readyResponse, verificationResponse] = await Promise.all([
    fetch(`${origin}/ready`),
    fetch(`${origin}/public/rooms/${roomId}/verification`),
  ]);
  assert.equal(readyResponse.status, 200);
  assert.equal(verificationResponse.status, 200);
  return {
    ready: await readyResponse.json(),
    verification: await verificationResponse.json(),
  };
}

let evidence;
try {
  docker(["build", "-t", image, "."]);
  docker(["volume", "create", volume]);
  docker(["run", "--rm", "-e", `VIRA_SMOKE_ROOM_ID=${roomId}`, "-e", "VIRA_DATA_DIR=/var/lib/vira", "-v", `${volume}:/var/lib/vira`, image, "node", "scripts/ci/seed-persistence.mjs"]);
  docker(["run", "-d", "--name", container, "-p", `${port}:8787`, "-e", "VIRA_DATA_DIR=/var/lib/vira", "-e", "VIRA_REQUIRE_TXLINE_CREDENTIALS=false", "-e", "VIRA_INTERNAL_INGEST_ENABLED=false", "-v", `${volume}:/var/lib/vira`, image], { capture: true });
  await waitForReady();
  const before = await readProof();

  docker(["restart", container], { capture: true });
  await waitForReady();
  const after = await readProof();

  assert.equal(before.verification.ledgerHeadHash, after.verification.ledgerHeadHash);
  assert.equal(before.verification.streamVersion, after.verification.streamVersion);
  assert.equal(before.verification.liveProjectionHash, after.verification.liveProjectionHash);
  assert.equal(before.verification.replayedProjectionHash, after.verification.replayedProjectionHash);
  assert.equal(after.verification.projectionMatches, true);
  assert.equal(after.verification.rankingMatches, true);
  assert.equal(after.verification.hashChainValid, true);

  evidence = {
    gate: "P1-A",
    startedAt,
    completedAt: new Date().toISOString(),
    image,
    roomId,
    restartVerified: true,
    ledgerHeadBefore: before.verification.ledgerHeadHash,
    ledgerHeadAfter: after.verification.ledgerHeadHash,
    streamVersionBefore: before.verification.streamVersion,
    streamVersionAfter: after.verification.streamVersion,
    projectionMatches: after.verification.projectionMatches,
    rankingMatches: after.verification.rankingMatches,
    hashChainValid: after.verification.hashChainValid,
    authorityValid: after.verification.authorityValid,
    readiness: after.ready.checks,
  };
  await mkdir(path.resolve("artifacts"), { recursive: true });
  await writeFile(path.resolve("artifacts/p1-a-container-smoke.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  if (!keep) {
    try { docker(["rm", "-f", container], { capture: true }); } catch {}
    try { docker(["volume", "rm", "-f", volume], { capture: true }); } catch {}
    try { docker(["image", "rm", "-f", image], { capture: true }); } catch {}
  }
}
