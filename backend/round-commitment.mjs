import { canonicalJson, sha256Hex } from "./event-codec.mjs";

export const ROUND_COMMITMENT_DOMAIN = "VIRA:ROUND_COMMITMENT:V1";
export const ROUND_COMMITMENT_SCHEMA_VERSION = 1;
const EMPTY_ROOT = sha256Hex("VIRA:MERKLE_EMPTY:V1");

function hashId(domain, value) {
  return sha256Hex(`${domain}|${String(value)}`);
}

function unixMs(value) {
  const result = Date.parse(String(value ?? ""));
  if (!Number.isFinite(result)) throw new Error("round_commitment_invalid_timestamp");
  return result;
}

function merkleRoot(leaves) {
  if (!leaves.length) return EMPTY_ROOT;
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(sha256Hex(`VIRA:MERKLE_NODE:V1|${left}|${right}`));
    }
    level = next;
  }
  return level[0];
}

function answersRoot(events, roundId, lockStreamVersion, roomIdHash, roundIdHash) {
  const leaves = events
    .filter((event) => event.type === "answer.submitted" && event.streamVersion < lockStreamVersion && String(event.payload?.answer?.roundId) === String(roundId))
    .map((event) => {
      const answer = event.payload.answer;
      const participantIdHash = hashId("VIRA:PARTICIPANT:V1", answer.participantId);
      const canonical = ["VIRA:ANSWER:V1", roomIdHash, roundIdHash, participantIdHash, String(answer.optionId), String(unixMs(answer.answeredAt ?? event.createdAt)), String(event.eventHash)].join("|");
      return { participantIdHash, leaf: sha256Hex(canonical) };
    })
    .sort((left, right) => left.participantIdHash.localeCompare(right.participantIdHash))
    .map((entry) => entry.leaf);
  return merkleRoot(leaves);
}

export function canonicalRoundCommitmentPayload(payload) {
  return [
    payload.domain,
    payload.schemaVersion,
    payload.roomIdHash,
    payload.fixtureIdHash,
    payload.roundIdHash,
    payload.roundVersion,
    payload.answersRoot,
    payload.resultRoot,
    payload.replayHash,
    payload.ledgerHeadHash,
    payload.openedAtUnixMs,
    payload.lockedAtUnixMs,
    payload.resolvedAtUnixMs,
  ].join("|");
}

export function hashRoundCommitmentPayload(payload) {
  return sha256Hex(canonicalRoundCommitmentPayload(payload));
}

export function deriveRoundCommitment(events, replay) {
  if (replay?.domain !== "VIRA:VERIFIED_ROUND_REPLAY:V1") throw new Error("round_commitment_replay_v1_required");
  const ordered = [...events].sort((left, right) => Number(left.streamVersion) - Number(right.streamVersion));
  const configured = ordered.find((event) => event.type === "room.configured");
  const resolved = ordered.find((event) => event.type === "round.resolved" && String(event.payload?.roundId) === replay.roundId);
  if (!resolved) throw new Error("round_commitment_resolution_not_found");
  const roomIdHash = hashId("VIRA:ROOM:V1", replay.roomId);
  const fixtureId = configured?.payload?.match?.fixtureId ?? configured?.payload?.match?.id ?? replay.roomId;
  const fixtureIdHash = hashId("VIRA:FIXTURE:V1", fixtureId);
  const roundIdHash = hashId("VIRA:ROUND:V1", replay.roundId);
  const answerRoot = answersRoot(ordered, replay.roundId, replay.technical.lockStreamVersion, roomIdHash, roundIdHash);
  const resultRoot = sha256Hex([
    "VIRA:RESULT:V1",
    roundIdHash,
    replay.resolution.winningOptionId,
    replay.technical.resolutionEventHash,
    replay.scoring.answersEvaluated,
    replay.scoring.answersCorrect,
    replay.scoring.totalPointsApplied,
    replay.scoring.leaderboardAfterHash,
  ].join("|"));
  const payload = {
    domain: ROUND_COMMITMENT_DOMAIN,
    schemaVersion: ROUND_COMMITMENT_SCHEMA_VERSION,
    roomIdHash,
    fixtureIdHash,
    roundIdHash,
    roundVersion: replay.roundVersion,
    answersRoot: answerRoot,
    resultRoot,
    replayHash: replay.replayHash,
    ledgerHeadHash: replay.proof.roundEventRangeHash,
    openedAtUnixMs: unixMs(replay.opening.observedAt),
    lockedAtUnixMs: unixMs(replay.lock.lockedAt),
    resolvedAtUnixMs: unixMs(replay.resolution.resolvedAt),
  };
  const canonical = canonicalRoundCommitmentPayload(payload);
  return {
    payload,
    canonical,
    canonicalHex: Buffer.from(canonical, "utf8").toString("hex"),
    commitmentHash: hashRoundCommitmentPayload(payload),
    metadata: {
      answerCount: replay.participation.confirmedAnswers,
      resultEventId: resolved.eventId,
      generatedFromReplaySchema: replay.schemaVersion,
      payloadJson: canonicalJson(payload),
    },
  };
}
