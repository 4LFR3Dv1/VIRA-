import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFileEventStore } from "./event-store.mjs";
import { createRoomRuntime } from "./runtime.mjs";
import { ensureVerifiedPlayback } from "./verified-playback-seed.mjs";

test("verified playback is authoritative, persistent and idempotent", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vira-playback-"));
  try {
    const store = await createFileEventStore({ dataDir });
    const runtime = createRoomRuntime({ eventStore: store });
    await runtime.rehydrateFromLedger();
    const first = await ensureVerifiedPlayback({ eventStore: store, runtime });
    assert.equal(first.seeded, true);
    const restartedStore = await createFileEventStore({ dataDir });
    const restartedRuntime = createRoomRuntime({ eventStore: restartedStore });
    await restartedRuntime.rehydrateFromLedger();
    const second = await ensureVerifiedPlayback({ eventStore: restartedStore, runtime: restartedRuntime });
    assert.equal(second.seeded, false);
    assert.equal(second.replayHash, first.replayHash);
    assert.equal(second.ledgerHeadHash, first.ledgerHeadHash);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
