import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalRoundCommitmentPayload, deriveRoundCommitment, hashRoundCommitmentPayload } from "./round-commitment.mjs";
import { createSolanaCommitmentPublisherFromEnv } from "./solana-commitment-publisher.mjs";

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

test("missing production keypair degrades commitment without crashing the runtime", () => {
  const previous = {
    enabled: process.env.VIRA_SOLANA_COMMITMENT_ENABLED,
    inline: process.env.VIRA_SOLANA_KEYPAIR_JSON,
    path: process.env.VIRA_SOLANA_KEYPAIR_PATH,
  };
  try {
    process.env.VIRA_SOLANA_COMMITMENT_ENABLED = "true";
    delete process.env.VIRA_SOLANA_KEYPAIR_JSON;
    process.env.VIRA_SOLANA_KEYPAIR_PATH = path.resolve("missing-wallet-for-test.json");
    const publisher = createSolanaCommitmentPublisherFromEnv();
    assert.equal(publisher.enabled, false);
    assert.equal(publisher.network, "unsupported");
    assert.equal(publisher.reason, "solana_commitment_keypair_missing");
  } finally {
    if (previous.enabled === undefined) delete process.env.VIRA_SOLANA_COMMITMENT_ENABLED;
    else process.env.VIRA_SOLANA_COMMITMENT_ENABLED = previous.enabled;
    if (previous.inline === undefined) delete process.env.VIRA_SOLANA_KEYPAIR_JSON;
    else process.env.VIRA_SOLANA_KEYPAIR_JSON = previous.inline;
    if (previous.path === undefined) delete process.env.VIRA_SOLANA_KEYPAIR_PATH;
    else process.env.VIRA_SOLANA_KEYPAIR_PATH = previous.path;
  }
});
