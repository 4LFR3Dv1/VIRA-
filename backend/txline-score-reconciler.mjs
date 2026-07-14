import { normalizeTxlineScore } from "./txline-client.mjs";

function records(payload) {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object");
  if (!payload || typeof payload !== "object") return [];
  const nested = Object.values(payload).find(Array.isArray);
  return (nested ?? [payload]).filter((item) => item && typeof item === "object");
}

function sequenceOf(record) {
  const value = Number(record?.Seq ?? record?.seq ?? record?.Sequence ?? record?.sequence);
  return Number.isFinite(value) ? value : null;
}

export function planScoreUpdateReconciliation(payload, { fixtureId, cursor = null, initialized = false } = {}) {
  const ordered = records(payload)
    .map((record, index) => ({ record, sequence: sequenceOf(record), index }))
    .sort((left, right) => (left.sequence ?? left.index) - (right.sequence ?? right.index));
  const maxSequence = ordered.reduce((maximum, item) => item.sequence === null ? maximum : Math.max(maximum ?? item.sequence, item.sequence), cursor);

  if (!initialized) {
    const baseline = [...ordered].reverse().find(({ record, index }) => {
      const event = normalizeTxlineScore(record, { matchId: fixtureId, sequenceFallback: index, source: "txline-snapshot" });
      return event.type === "match_end" || event.scoreAuthority !== "none";
    })?.record ?? null;
    return { initialized: true, cursor: maxSequence, baseline, updates: [] };
  }

  const updates = ordered
    .filter((item) => item.sequence === null || cursor === null || item.sequence > cursor)
    .map((item) => item.record);
  return { initialized: true, cursor: maxSequence, baseline: null, updates };
}

export const scoreReconcilerInternals = { records, sequenceOf };
