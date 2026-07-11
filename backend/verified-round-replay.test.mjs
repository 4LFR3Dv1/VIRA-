import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalVerifiedRoundReplay, deriveVerifiedRoundReplay, hashVerifiedRoundReplay } from "./verified-round-replay.mjs";

const fixtureDir = path.resolve("tests/fixtures/replay");
const fixtureNames = [
  "round-v1-success.json",
  "round-v1-no-answers.json",
  "round-v1-deadline-lock.json",
  "round-v1-authority-invalid.json",
  "round-v1-duplicate-signal.json",
  "round-v1-restart.json",
];

for (const fixtureName of fixtureNames) {
  test(`VerifiedRoundReplayV1 matches frozen vector: ${fixtureName}`, async () => {
    const vector = JSON.parse(await fs.readFile(path.join(fixtureDir, fixtureName), "utf8"));
    const actual = deriveVerifiedRoundReplay(vector.events, vector.roundId, vector.verification);
    assert.deepEqual(actual, vector.expectedReplay);
    assert.equal(actual.replayHash, vector.expectedReplayHash);
    assert.equal(hashVerifiedRoundReplay(actual), vector.expectedReplayHash);
    assert.equal(canonicalVerifiedRoundReplay(actual), canonicalVerifiedRoundReplay(vector.expectedReplay));
  });
}

test("public replay never exposes participant identity or individual choices", async () => {
  const vector = JSON.parse(await fs.readFile(path.join(fixtureDir, "round-v1-success.json"), "utf8"));
  const replay = deriveVerifiedRoundReplay(vector.events, vector.roundId, vector.verification);
  const serialized = JSON.stringify(replay);
  assert.equal(serialized.includes("participant-a"), false);
  assert.equal(serialized.includes("displayName"), false);
  assert.deepEqual(replay.participation.distribution, { yes: 1, no: 1 });
});

test("canonical replay remains byte-identical after serialized restart", async () => {
  const vector = JSON.parse(await fs.readFile(path.join(fixtureDir, "round-v1-restart.json"), "utf8"));
  const before = deriveVerifiedRoundReplay(vector.events, vector.roundId, vector.verification);
  const rehydratedEvents = JSON.parse(JSON.stringify(vector.events));
  const after = deriveVerifiedRoundReplay(rehydratedEvents, vector.roundId, vector.verification);
  assert.equal(canonicalVerifiedRoundReplay(before), canonicalVerifiedRoundReplay(after));
  assert.equal(before.replayHash, after.replayHash);
});
