import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);

async function initialRound(env = {}) {
  const source = `import { createRoomRuntime } from './backend/runtime.mjs'; const runtime = createRoomRuntime(); console.log(JSON.stringify(runtime.snapshot('cadence-fixture').currentRound));`;
  const { stdout } = await execute(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", VIRA_MARKET_ROUNDS_ENABLED: "false", ...env },
  });
  return JSON.parse(stdout.trim());
}

test("Consumer production starts in observing instead of a market round", async () => {
  assert.equal(await initialRound(), null);
});

test("market rounds require an explicit experimental flag", async () => {
  const round = await initialRound({ VIRA_MARKET_ROUNDS_ENABLED: "true" });
  assert.equal(round.resolution.domain ?? "market", "market");
  assert.equal(round.state, "open");
});
