const freeze = (value) => {
  if (value && typeof value === "object") for (const item of Object.values(value)) freeze(item);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

// Sanitized from GET /api/scores/historical/18237038 on 2026-07-15.
// This projection retains every status transition and game_finalised from the
// 1,027-record response, while removing players and unrelated match actions.
export const FRANCE_SPAIN_REGULAR_TIME_AUTHORITY_OBSERVED = freeze({
  fixtureId: "18237038",
  sourceRecordCount: 1027,
  projection: "all_status_transitions_and_game_finalised",
  records: [
    { Id: 26, Seq: 17, FixtureId: 18237038, Ts: 1784055608958, Action: "status", StatusId: 2, Data: { StatusId: 2 } },
    { Id: 424, Seq: 475, FixtureId: 18237038, Ts: 1784058691035, Action: "status", StatusId: 3, Data: { StatusId: 3 } },
    { Id: 428, Seq: 479, FixtureId: 18237038, Ts: 1784059596632, Action: "status", StatusId: 4, Data: { StatusId: 4 } },
    { Id: 899, Seq: 1022, FixtureId: 18237038, Ts: 1784062742471, Action: "status", StatusId: 5, Data: { StatusId: 5 } },
    { Id: 905, Seq: 1026, FixtureId: 18237038, Ts: 1784063054751, Action: "game_finalised", StatusId: 100, Score: { Participant1: { Total: {} }, Participant2: { Total: { Goals: 2 } } } },
  ],
});
