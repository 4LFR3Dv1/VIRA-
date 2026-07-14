import assert from "node:assert/strict";
import test from "node:test";

import { createTxlineStreamManager } from "./txline-stream.mjs";

function sseResponse(text) {
  const chunks = [new TextEncoder().encode(text)];
  return {
    ok: true,
    body: {
      getReader() {
        return {
          async read() { return chunks.length ? { value: chunks.shift(), done: false } : { value: undefined, done: true }; },
          releaseLock() {},
        };
      },
    },
  };
}

test("failed TxLINE stream reconnects and resumes normalized delivery", async () => {
  let fetchCalls = 0;
  let resolveApplied;
  const applied = new Promise((resolve) => { resolveApplied = resolve; });
  const emitted = [];
  const runtime = {
    emit: (_roomId, eventName, payload) => { emitted.push({ eventName, payload }); return { eventId: String(emitted.length), clientCount: 0 }; },
    applyNormalizedEvent: async (_roomId, event) => { resolveApplied(event); },
  };
  const manager = createTxlineStreamManager({
    config: { origin: "https://txline.example", jwt: "jwt", apiToken: "token", fixtureId: "fixture" },
    runtime,
    reconnectDelay: () => 0,
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) throw new Error("connection_reset");
      return sseResponse('id: 82\ndata: {"FixtureId":"fixture","Id":87,"Seq":82,"Action":"goal_kick","Participant":2}\n\n');
    },
  });

  await manager.startScores("room", { fixtureId: "fixture" });
  const event = await Promise.race([applied, new Promise((_, reject) => setTimeout(() => reject(new Error("reconnect_timeout")), 1_000))]);
  manager.stop("room");
  assert.ok(fetchCalls >= 2);
  assert.equal(event.type, "period");
  assert.equal(event.providerActionId, "87");
  assert.ok(emitted.some((item) => item.eventName === "txline.stream_failed"));
  assert.equal(manager.status("room").scores.status, "idle");
});
