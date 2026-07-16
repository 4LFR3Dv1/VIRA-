import assert from "node:assert/strict";
import test from "node:test";

import { publicPlaybackSource, selectPublicPlaybackRoom } from "./public-playback.mjs";

const canonical = { roomId: "judge-room", match: { status: "finished" }, lastResolution: { roundId: "judge-round" } };
const recent = { roomId: "recent-room", match: { status: "finished" }, lastResolution: { roundId: "recent-round" } };

test("default judge playback remains pinned to the certified canonical fixture", () => {
  const selection = selectPublicPlaybackRoom({ rooms: [recent, canonical], requestedRoomId: null, canonicalRoomId: "judge-room", canonicalRoundId: "judge-round" });
  assert.equal(selection.room.roomId, "judge-room");
  assert.equal(selection.roundId, "judge-round");
  assert.equal(selection.kind, "canonical_certified_fixture");
});

test("a resolved dynamic room is available only when explicitly requested", () => {
  const selection = selectPublicPlaybackRoom({ rooms: [recent, canonical], requestedRoomId: "recent-room", canonicalRoomId: "judge-room", canonicalRoundId: "judge-round" });
  assert.equal(selection.room.roomId, "recent-room");
  assert.equal(selection.roundId, "recent-round");
  assert.equal(selection.kind, "requested_public_room");
  assert.equal(selectPublicPlaybackRoom({ rooms: [canonical], requestedRoomId: "missing", canonicalRoomId: "judge-room", canonicalRoundId: "judge-round" }), null);
});

test("canonical disclosure is explicit, public and never claims current live delivery", () => {
  const source = publicPlaybackSource("canonical_certified_fixture");
  assert.equal(source.fixtureType, "sanitized_txline_test_fixture");
  assert.equal(source.liveDuringReview, false);
  assert.match(source.disclosure, /sanitized deterministic TxLINE test fixture/i);
  assert.doesNotMatch(JSON.stringify(source), /token|credential|authorization/i);
});
