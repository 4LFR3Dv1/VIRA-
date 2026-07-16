export function selectPublicPlaybackRoom({ rooms, requestedRoomId, canonicalRoomId, canonicalRoundId }) {
  const summaries = Array.isArray(rooms) ? rooms : [];
  const canonical = summaries.find((room) => room.roomId === canonicalRoomId) ?? null;

  if (!requestedRoomId) {
    return canonical ? { room: canonical, roundId: canonicalRoundId, kind: "canonical_certified_fixture" } : null;
  }

  if (requestedRoomId === canonicalRoomId) {
    return canonical ? { room: canonical, roundId: canonicalRoundId, kind: "canonical_certified_fixture" } : null;
  }

  const requested = summaries.find((room) => room.roomId === requestedRoomId && room.lastResolution?.roundId) ?? null;
  return requested ? { room: requested, roundId: requested.lastResolution.roundId, kind: "requested_public_room" } : null;
}

export function publicPlaybackSource(kind) {
  if (kind === "canonical_certified_fixture") {
    return Object.freeze({
      kind,
      provider: "TxLINE",
      fixtureType: "sanitized_txline_test_fixture",
      liveDuringReview: false,
      disclosure: "A sanitized deterministic TxLINE test fixture persisted in the append-only ledger and replayed by the production runtime.",
    });
  }
  return Object.freeze({
    kind: "requested_public_room",
    provider: "TxLINE",
    fixtureType: "resolved_public_room",
    liveDuringReview: false,
    disclosure: "An explicitly requested resolved public room replayed from its append-only ledger.",
  });
}
