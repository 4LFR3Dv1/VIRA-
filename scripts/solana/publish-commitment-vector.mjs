import fs from "node:fs/promises";
import path from "node:path";

import { createSolanaCommitmentPublisherFromEnv } from "../../backend/solana-commitment-publisher.mjs";

const vectorPath = path.resolve(process.argv[2] ?? "tests/fixtures/commitment/round-v1-success.json");
const artifactPath = path.resolve("artifacts/p1-c-devnet-commitment.json");
process.env.VIRA_SOLANA_COMMITMENT_ENABLED = "true";
process.env.VIRA_SOLANA_NETWORK = "devnet";
process.env.VIRA_SOLANA_KEYPAIR_PATH ??= path.resolve(".txline/wallet-devnet.json");

const vector = JSON.parse(await fs.readFile(vectorPath, "utf8"));
const publisher = createSolanaCommitmentPublisherFromEnv();
const receipt = await publisher.publish(vector.expectedCommitment);
const artifact = {
  schemaVersion: 1,
  gate: "P1-C",
  testedAt: new Date().toISOString(),
  vector: path.relative(process.cwd(), vectorPath).replaceAll("\\", "/"),
  replayHash: vector.expectedCommitment.payload.replayHash,
  commitmentHash: vector.expectedCommitment.commitmentHash,
  answersRoot: vector.expectedCommitment.payload.answersRoot,
  resultRoot: vector.expectedCommitment.payload.resultRoot,
  ...receipt,
};
await fs.mkdir(path.dirname(artifactPath), { recursive: true });
await fs.writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify(artifact, null, 2));
