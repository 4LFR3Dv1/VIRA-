import assert from "node:assert/strict";
import test from "node:test";

import { buildGuidedPlaybackTimeline, countdownSeconds, guidedPlaybackStepAt } from "./guided-playback-model.ts";

const eventTypes = ["room.configured", "round.opened", "answer.submitted", "answer.submitted", "txline.event.received", "txline.event.accepted", "round.locked", "round.resolved"];
const events = Object.freeze(eventTypes.map((type, index) => Object.freeze({ type, streamVersion: index + 1 })));
const replay = Object.freeze({ proof: Object.freeze({ hashChainValid: true, projectionMatches: true, rankingMatches: true, authorityValid: true }) });

test("guided playback has a ten-second countdown and deterministic terminal phase", () => {
  const timeline = buildGuidedPlaybackTimeline(events, replay);
  assert.equal(timeline[0].phase, "countdown");
  assert.equal(timeline[1].phase, "kickoff");
  assert.equal(timeline[1].startsAtMs, 10_000);
  assert.equal(guidedPlaybackStepAt(timeline, 9_999).phase, "countdown");
  assert.equal(guidedPlaybackStepAt(timeline, 10_000).phase, "kickoff");
  assert.equal(guidedPlaybackStepAt(timeline, 27_000).phase, "finished");
  assert.equal(countdownSeconds(0), 10);
  assert.equal(countdownSeconds(9_100), 1);
  assert.equal(countdownSeconds(10_000), 0);
});

test("guided playback rejects incomplete or unverified public evidence", () => {
  assert.throws(() => buildGuidedPlaybackTimeline(events.filter((event) => event.type !== "round.locked"), replay), /guided_playback_missing_event:round.locked/);
  assert.throws(() => buildGuidedPlaybackTimeline(events, { proof: { ...replay.proof, hashChainValid: false } }), /guided_playback_unverified_replay/);
});
