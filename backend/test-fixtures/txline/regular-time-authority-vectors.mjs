const event = (RevId, Ts, StatusId, home, away) => Object.freeze({
  RevId, Ts, Action: "status", Data: Object.freeze({ StatusId, Score: Object.freeze({ AbsoluteScore: Object.freeze({ Participant1: home, Participant2: away }) }) }),
});

export const REGULAR_TIME_AUTHORITY_VECTORS = Object.freeze({
  finishedIn90: Object.freeze([
    event(10, "2026-07-19T20:00:00.000Z", 2, 0, 0),
    event(90, "2026-07-19T21:55:00.000Z", 5, 2, 1),
  ]),
  extraTimeReconnectHistory: Object.freeze([
    event(10, "2026-07-19T20:00:00.000Z", 2, 0, 0),
    event(90, "2026-07-19T21:55:00.000Z", 6, 1, 1),
    event(105, "2026-07-19T22:15:00.000Z", 8, 2, 1),
    event(120, "2026-07-19T22:40:00.000Z", 10, 2, 1),
  ]),
  penaltiesReconnectHistory: Object.freeze([
    event(10, "2026-07-19T20:00:00.000Z", 2, 0, 0),
    event(90, "2026-07-19T21:55:00.000Z", 6, 1, 1),
    event(120, "2026-07-19T22:40:00.000Z", 11, 2, 2),
    event(130, "2026-07-19T22:55:00.000Z", 13, 5, 4),
  ]),
  unrecoverableExtraTime: Object.freeze([
    Object.freeze({ RevId: 90, Ts: "2026-07-19T21:55:00.000Z", Action: "status", Data: Object.freeze({ StatusId: 6 }) }),
    event(120, "2026-07-19T22:40:00.000Z", 10, 2, 1),
  ]),
  terminalOnlyExtraTime: Object.freeze([
    event(120, "2026-07-19T22:40:00.000Z", 10, 2, 1),
  ]),
});
