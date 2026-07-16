import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("judge guide exposes the complete evaluation journey and submission resources", async () => {
  const source = await fs.readFile(new URL("../src/features/help/HelpScreen.tsx", import.meta.url), "utf8");
  for (const marker of ["VIRA Picks", "Match Room", "Certified playback", "sanitized deterministic TxLINE test fixture", "DEMO_URL", "REPO_URL", "PITCH_URL", "TxLINE authority chain"]) assert.match(source, new RegExp(marker, "i"));
  assert.doesNotMatch(source, /A real round preserved/i);
});

test("judge walkthrough is product-facing and operations are separated", async () => {
  const walkthrough = await fs.readFile(new URL("../docs/JUDGE_WALKTHROUGH.md", import.meta.url), "utf8");
  const operations = await fs.readFile(new URL("../docs/OPERATIONS_RUNBOOK.md", import.meta.url), "utf8");
  for (const marker of ["Available now", "During a live fixture", "Anytime", "VIRA Picks", "Certified Playback", "Canonical demo video"]) assert.match(walkthrough, new RegExp(marker, "i"));
  assert.doesNotMatch(walkthrough, /eventLoopLagMs|queueDepth|four-hour wall-clock soak/);
  assert.match(operations, /eventLoopLagMs/);
  assert.match(operations, /single-writer/i);
});
