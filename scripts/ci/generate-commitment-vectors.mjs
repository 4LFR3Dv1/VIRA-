import fs from "node:fs/promises";
import path from "node:path";

import { deriveRoundCommitment } from "../../backend/round-commitment.mjs";

const replayDir = path.resolve("tests/fixtures/replay");
const outputDir = path.resolve("tests/fixtures/commitment");
const sources = ["round-v1-success.json", "round-v1-no-answers.json"];

await fs.mkdir(outputDir, { recursive: true });
for (const fileName of sources) {
  const replayVector = JSON.parse(await fs.readFile(path.join(replayDir, fileName), "utf8"));
  const expectedCommitment = deriveRoundCommitment(replayVector.events, replayVector.expectedReplay);
  const vector = {
    schemaVersion: 1,
    sourceReplayVector: `../replay/${fileName}`,
    events: replayVector.events,
    replay: replayVector.expectedReplay,
    expectedCommitment,
    expectedCommitmentHash: expectedCommitment.commitmentHash,
  };
  await fs.writeFile(path.join(outputDir, fileName), `${JSON.stringify(vector, null, 2)}\n`, "utf8");
}

console.log(`Generated ${sources.length} commitment vectors in ${outputDir}`);
