function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export const ENGLAND_ARGENTINA_POSSESSION_OBSERVED = deepFreeze({
  fixtureId: "18241006",
  observedVia: "vira_public_txline_proxy",
  records: [
    { FixtureId: 18241006, Id: 39, Seq: 34, Action: "possession", Participant: 2, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 108 }, Data: null },
    { FixtureId: 18241006, Id: 25, Seq: 18, Action: "safe_possession", Participant: 2, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 3 }, Data: null },
    { FixtureId: 18241006, Id: 30, Seq: 24, Action: "attack_possession", Participant: 1, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 31 }, Data: null },
    { FixtureId: 18241006, Id: 32, Seq: 26, Action: "attack_possession", Participant: 1, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 44 }, Data: null },
    { FixtureId: 18241006, Id: 56, Seq: 53, Action: "danger_possession", Participant: 1, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 267 }, Data: null },
    { FixtureId: 18241006, Id: 57, Seq: 54, Action: "high_danger_possession", Participant: 1, Participant1IsHome: true, Confirmed: null, Clock: { Running: true, Seconds: 270 }, Data: null },
  ],
});
