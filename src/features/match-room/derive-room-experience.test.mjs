import assert from "node:assert/strict";
import test from "node:test";

import { deriveRoomExperience } from "./derive-room-experience.ts";


function roomState(connectionState) {
  return {
    currentAnswerState: "not_answered",
    currentUiState: "prediction_open",
    lastResolution: null,
    snapshot: {
      connectionState,
      match: { status: "live" },
      currentRound: null,
      marketDistribution: {},
      lastNormalizedEvent: null,
      latestEvidence: null,
    },
  };
}

test("initial room hydration is neutral instead of a provider interruption", () => {
  const state = roomState("connecting");

  assert.equal(state.snapshot.connectionState, "connecting");
  assert.equal(deriveRoomExperience(state), "connecting");
});

test("actual reconnecting and offline states remain provider interruptions", () => {
  const state = roomState("reconnecting");

  assert.equal(deriveRoomExperience(state), "provider_unavailable");

  state.snapshot.connectionState = "offline";
  assert.equal(deriveRoomExperience(state), "provider_unavailable");
});

test("a live snapshot leaves hydration for the normal room experience", () => {
  const state = roomState("live");

  assert.equal(deriveRoomExperience(state), "live_waiting_for_market");
});
