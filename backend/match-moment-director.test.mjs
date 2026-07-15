import assert from "node:assert/strict";
import test from "node:test";

import { matchMomentDirectorReducer } from "../src/features/match-moments/match-moment-reducer.ts";
import { deriveMatchMoment } from "../src/features/match-moments/derive-match-moment.ts";
import { advancePressureEpisode, initialPressureEpisodeState } from "../src/features/match-moments/derive-pressure-episode.ts";
import { initialMatchMomentDirectorState } from "../src/features/match-moments/match-moment-types.ts";
import { normalizeTxlineScore } from "./txline-client.mjs";
import { createRoomRuntime } from "./runtime.mjs";
import { ENGLAND_ARGENTINA_POSSESSION_OBSERVED } from "./test-fixtures/txline/england-argentina-possession-observed.mjs";

function moment(id, kind, presentation, priority, sourceActionId = id) {
  return {
    id,
    sourceActionId,
    fixtureId: "fixture",
    kind,
    presentation,
    matchClockSec: 100,
    occurredAt: "2026-07-12T00:00:00.000Z",
    priority,
    durationMs: 1_000,
    interruptible: presentation !== "takeover",
    sourceEvent: {},
  };
}

test("confirmed goal preempts and discards an active shot banner", () => {
  const shot = moment("shot", "shot_on_target", "banner", 30, "action-1");
  const goal = { ...moment("goal", "goal", "takeover", 100, "action-2"), scoreBefore: { home: 0, away: 0 }, scoreAfter: { home: 1, away: 0 } };
  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "enqueue", moment: shot });
  state = matchMomentDirectorReducer(state, { type: "enqueue", moment: goal });
  assert.equal(state.active?.id, "goal");
  assert.deepEqual(state.queue, []);
});

test("reconnect duplicate cannot replay a seen scene", () => {
  const shot = moment("shot", "shot_on_target", "banner", 30);
  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "enqueue", moment: shot });
  state = matchMomentDirectorReducer(state, { type: "dismiss" });
  state = matchMomentDirectorReducer(state, { type: "enqueue", moment: shot });
  assert.equal(state.active, null);
  assert.deepEqual(state.queue, []);
});

test("goal kick creates no goal scene and enriched goal revisions share one presentation id", () => {
  const match = { homeTeam: { name: "France" }, awayTeam: { name: "Spain" }, homeScore: 0, awayScore: 2 };
  const goalKick = normalizeTxlineScore({ FixtureId: 1, Id: 10, Seq: 10, Action: "goal_kick", Participant: 1, Clock: { Seconds: 100 } });
  assert.equal(deriveMatchMoment(goalKick, match), null);

  const first = normalizeTxlineScore({ FixtureId: 1, Id: 11, Seq: 11, Action: "goal", Participant: 2, Confirmed: true, Score: { Participant1: { Total: {} }, Participant2: { Total: { Goals: 2 } } } });
  const enriched = normalizeTxlineScore({ FixtureId: 1, Id: 11, Seq: 12, Action: "goal", Participant: 2, Confirmed: true, Score: { Participant1: { Total: {} }, Participant2: { Total: { Goals: 2 } } }, Data: { PlayerId: 907005 } });
  const firstCommand = deriveMatchMoment(first, match);
  const enrichedCommand = deriveMatchMoment(enriched, match);
  assert.equal(firstCommand?.type, "enqueue");
  assert.equal(firstCommand?.moment.id, enrichedCommand?.moment.id);

  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, firstCommand);
  state = matchMomentDirectorReducer(state, enrichedCommand);
  assert.equal(state.queue.length, 0);
  assert.equal(state.seenIds.length, 1);
});

test("discard revokes an active or queued correlated scene", () => {
  const corner = moment("corner", "corner", "banner", 40, "action-corner");
  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "enqueue", moment: corner });
  state = matchMomentDirectorReducer(state, { type: "revoke", sourceActionId: "action-corner" });
  assert.equal(state.active, null);
  assert.ok(state.revokedActionIds.includes("action-corner"));
});

test("amendment replaces a correlated scene", () => {
  const shot = moment("shot", "shot_on_target", "banner", 30, "action-1");
  const card = moment("card", "yellow_card", "banner", 60, "action-2");
  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "enqueue", moment: shot });
  state = matchMomentDirectorReducer(state, { type: "replace", sourceMomentId: "action-1", moment: card });
  assert.equal(state.active?.id, "card");
  assert.equal(state.active?.kind, "yellow_card");
});

test("dismiss promotes the highest priority queued scene", () => {
  const shot = moment("shot", "shot_on_target", "banner", 30);
  const corner = moment("corner", "corner", "banner", 40);
  const card = moment("card", "yellow_card", "banner", 60);
  let state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "enqueue", moment: shot });
  state = matchMomentDirectorReducer(state, { type: "enqueue", moment: corner });
  state = matchMomentDirectorReducer(state, { type: "enqueue", moment: card });
  state = matchMomentDirectorReducer(state, { type: "dismiss" });
  assert.equal(state.active?.id, "card");
});

test("observed TxLINE possession actions map to exact canonical phases", () => {
  assert.equal(Object.isFrozen(ENGLAND_ARGENTINA_POSSESSION_OBSERVED), true);
  assert.equal(Object.isFrozen(ENGLAND_ARGENTINA_POSSESSION_OBSERVED.records), true);
  const normalized = ENGLAND_ARGENTINA_POSSESSION_OBSERVED.records.map((record) => normalizeTxlineScore(record));
  assert.deepEqual(normalized.map((event) => event.type), normalized.map(() => "possession"));
  assert.deepEqual(normalized.map((event) => event.possession), [
    { phase: "neutral", intensity: 0 },
    { phase: "safe", intensity: 1 },
    { phase: "attack", intensity: 2 },
    { phase: "attack", intensity: 2 },
    { phase: "danger", intensity: 3 },
    { phase: "high_danger", intensity: 4 },
  ]);
  assert.equal(normalized[0].participantSide, "away");
  assert.equal(normalized[2].participantSide, "home");

  for (const Action of ["defense_possession", "possession_attack", "very_high_danger_possession"]) {
    const unknown = normalizeTxlineScore({ FixtureId: 18241006, Id: Action, Seq: 999, Action, Participant: 1, Clock: { Seconds: 500 } });
    assert.equal(unknown.type, "period");
    assert.equal(unknown.possession, undefined);
  }
});

test("pressure episodes coalesce sustained attacks, promote danger and clear on safe possession", () => {
  const match = { homeTeam: { name: "England" }, awayTeam: { name: "Argentina" } };
  const events = ENGLAND_ARGENTINA_POSSESSION_OBSERVED.records.map((record) => normalizeTxlineScore(record));
  let tracker = initialPressureEpisodeState;

  let derived = advancePressureEpisode(tracker, events[2], match);
  tracker = derived.state;
  assert.equal(derived.command, null);

  derived = advancePressureEpisode(tracker, events[3], match);
  tracker = derived.state;
  assert.equal(derived.command?.type, "set_ambient");
  assert.equal(derived.command?.moment.level, "building");
  assert.equal(derived.command?.moment.signalCount, 2);
  const episodeId = derived.command?.moment.id;

  derived = advancePressureEpisode(tracker, { ...events[3], id: "attack-third", sequence: 27, matchClockSec: 50 }, match);
  tracker = derived.state;
  assert.equal(derived.command?.type, "set_ambient");
  assert.equal(derived.command?.moment.id, episodeId);

  derived = advancePressureEpisode(tracker, events[4], match);
  tracker = derived.state;
  assert.equal(derived.command?.type, "clear_ambient");

  derived = advancePressureEpisode(tracker, events[5], match);
  tracker = derived.state;
  assert.equal(derived.command?.type, "set_ambient");
  assert.equal(derived.command?.moment.level, "high");

  derived = advancePressureEpisode(tracker, events[1], match);
  assert.equal(derived.command?.type, "clear_ambient");
  assert.equal(derived.state.visible, false);
});

test("ambient pressure never enters the competitive banner queue", () => {
  const pressure = {
    ...moment("pressure-1", "pressure", "ambient", 10),
    level: "danger",
    phase: "danger",
    signalCount: 2,
  };
  const state = matchMomentDirectorReducer(initialMatchMomentDirectorState, { type: "set_ambient", moment: pressure });
  assert.equal(state.ambient?.id, "pressure-1");
  assert.equal(state.active, null);
  assert.deepEqual(state.queue, []);
});

test("runtime emits possession to match moments without adding a competitive timeline item", async () => {
  const runtime = createRoomRuntime();
  const roomId = ENGLAND_ARGENTINA_POSSESSION_OBSERVED.fixtureId;
  runtime.configureMatch({ fixtureId: roomId, title: "England vs Argentina", status: "live", homeTeam: "England", awayTeam: "Argentina" });
  const roundBefore = structuredClone(runtime.getRoom(roomId).currentRound);
  const statsBefore = structuredClone(runtime.getRoom(roomId).matchStats);
  const writes = [];
  let close = () => {};
  runtime.attachClient(roomId, {
    write(value) { writes.push(String(value)); },
    on(event, handler) { if (event === "close") close = handler; },
  });
  try {
    const attack = normalizeTxlineScore(ENGLAND_ARGENTINA_POSSESSION_OBSERVED.records[2]);
    await runtime.applyNormalizedEvent(roomId, attack);
    const output = writes.join("");
    assert.match(output, /event: match\.event_received/);
    assert.match(output, /"phase":"attack","intensity":2/);
    assert.deepEqual(runtime.getRoom(roomId).currentRound, roundBefore);
    assert.deepEqual(runtime.getRoom(roomId).matchStats, statsBefore);
    assert.equal(runtime.getRoom(roomId).timeline.some((entry) => /possession/i.test(entry.description)), false);
  } finally {
    close();
  }
});
