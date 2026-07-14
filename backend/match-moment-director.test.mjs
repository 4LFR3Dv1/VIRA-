import assert from "node:assert/strict";
import test from "node:test";

import { matchMomentDirectorReducer } from "../src/features/match-moments/match-moment-reducer.ts";
import { deriveMatchMoment } from "../src/features/match-moments/derive-match-moment.ts";
import { initialMatchMomentDirectorState } from "../src/features/match-moments/match-moment-types.ts";
import { normalizeTxlineScore } from "./txline-client.mjs";

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
