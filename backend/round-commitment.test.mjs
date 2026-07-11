import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalRoundCommitmentPayload, deriveRoundCommitment, hashRoundCommitmentPayload } from "./round-commitment.mjs";

const fixtureDir = path.resolve("tests/fixtures/commitment");

for (const fixtureName of ["round-v1-success.json", "round-v1-no-answers.json"]) {
  test(`RoundCommitmentPayloadV1 matches frozen vector: ${fixtureName}`, async () => {
    const vector = JSON.parse(await fs.readFile(path.join(fixtureDir, fixtureName), "utf8"));
    const actual = deriveRoundCommitment(vector.events, vector.replay);
    assert.deepEqual(actual, vector.expectedCommitment);
    assert.equal(actual.commitmentHash, vector.expectedCommitmentHash);
    assert.equal(hashRoundCommitmentPayload(actual.payload), vector.expectedCommitmentHash);
    assert.equal(Buffer.from(canonicalRoundCommitmentPayload(actual.payload), "utf8").toString("hex"), actual.canonicalHex);
  });
}

test("commitment anchors the exact replay hash and contains no participant identity", async () => {
  const vector = JSON.parse(await fs.readFile(path.join(fixtureDir, "round-v1-success.json"), "utf8"));
  const commitment = deriveRoundCommitment(vector.events, vector.replay);
  assert.equal(commitment.payload.replayHash, vector.replay.replayHash);
  assert.equal(commitment.payload.ledgerHeadHash, vector.replay.proof.roundEventRangeHash);
  assert.equal(JSON.stringify(commitment).includes("participant-a"), false);
  assert.equal(JSON.stringify(commitment).includes("displayName"), false);
});
