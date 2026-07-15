import assert from "node:assert/strict";
import test from "node:test";

import { deriveRoomExperience } from "./derive-room-experience.ts";
import { deriveCanonicalExperienceState, participantAwaitsCurrentRoundResolution, resolutionBelongsToCurrentRound } from "../match-experience/state-model.ts";


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

test("round.state remains authoritative when an older resolution exists", () => {
  const canonical = deriveCanonicalExperienceState({ matchStatus: "live", roomExists: true, roundState: "open", currentRoundHasResolution: false, hasSignal: true, connectionState: "live" });
  assert.equal(canonical.round, "open");
  assert.equal(resolutionBelongsToCurrentRound("round-2", "round-1"), false);
  assert.equal(resolutionBelongsToCurrentRound("round-2", "round-2"), true);
});

test("global round phase and participant answer phase remain separate", () => {
  assert.equal(deriveCanonicalExperienceState({ matchStatus: "live", roundState: "locked", connectionState: "live" }).round, "locked");
  assert.equal(deriveCanonicalExperienceState({ matchStatus: "live", roundState: "resolved", connectionState: "live" }).round, "resolved");
  assert.equal(deriveCanonicalExperienceState({ matchStatus: "finished", roundState: "expired", connectionState: "live" }).round, "expired");
  assert.equal(participantAwaitsCurrentRoundResolution("open", "submitted"), true);
  assert.equal(participantAwaitsCurrentRoundResolution("locked", "submitted"), true);
  assert.equal(participantAwaitsCurrentRoundResolution("resolved", "submitted"), false);
  assert.equal(participantAwaitsCurrentRoundResolution("expired", "submitted"), false);
});

test("a resolved or expired round returns the room to preparation instead of stale tracking", () => {
  const resolved = roomState("live");
  resolved.snapshot.currentRound = { id: "round-1", state: "resolved", resolution: { domain: "football", condition: { kind: "team_scores", state: "tracking" } } };
  resolved.lastResolution = { roundId: "round-1" };
  resolved.currentAnswerState = "submitted";
  assert.equal(deriveRoomExperience(resolved), "live_waiting_for_round");

  resolved.snapshot.currentRound.state = "expired";
  resolved.lastResolution = null;
  assert.equal(deriveRoomExperience(resolved), "live_waiting_for_round");
});

test("a finished match overrides stale round and transport states", () => {
  const finished = roomState("reconnecting");
  finished.snapshot.match.status = "finished";
  finished.snapshot.currentRound = { id: "round-stale", state: "open", resolution: { domain: "football" } };
  finished.lastResolution = { roundId: "round-previous" };
  finished.currentUiState = "prediction_open";

  assert.equal(deriveRoomExperience(finished), "finished");

  finished.snapshot.connectionState = "connecting";
  assert.equal(deriveRoomExperience(finished), "finished");
});
