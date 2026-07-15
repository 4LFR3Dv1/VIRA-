const option = (value) => Object.freeze(value);

// Sanitized from the public VIRA TxLINE projection on 2026-07-15. No token,
// request header, participant identity, or provider credential is retained.
export const OVERUNDER_2_5_OBSERVED_SANITIZED = Object.freeze({
  capturedFrom: "/api/odds/snapshot/18241006",
  receivedAt: "2026-07-15T17:03:03.840Z",
  market: Object.freeze({
    id: "1837909556:00003:000588-10021-stab",
    signature: "18241006|OVERUNDER_PARTICIPANT_GOALS|line=2.5|match|over/under|10021",
    fixtureId: "18241006",
    messageId: "1837909556:00003:000588-10021-stab",
    sequence: null,
    marketType: "OVERUNDER_PARTICIPANT_GOALS",
    marketParameters: "line=2.5",
    marketPeriod: null,
    inRunning: false,
    capturedAt: "2026-07-15T17:02:54.597Z",
    sourceEndpoint: "/api/odds/snapshot/18241006",
    priceNames: Object.freeze(["over", "under"]),
    options: Object.freeze([
      option({ priceName: "over", label: "Over", pct: 38.285, price: 2612 }),
      option({ priceName: "under", label: "Under", pct: 61.728, price: 1620 }),
    ]),
  }),
});
