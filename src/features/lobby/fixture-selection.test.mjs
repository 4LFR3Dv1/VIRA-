import assert from "node:assert/strict";
import test from "node:test";

import { selectCatalogMatch, selectSuggestedMatch } from "./fixture-selection.ts";

function fixture({ id, status = "scheduled", kickoff, competition = "world_cup", canFeature = true, canPredict = false }) {
  return {
    fixtureId: id,
    consumerProjection: {
      fixture: { fixtureId: id, status, kickoffAt: kickoff, competition: { kind: competition } },
      availability: { canFeature, canPredict },
    },
  };
}

test("live to finished rotates the automatic hero to the next World Cup fixture", () => {
  const next = fixture({ id: "third-place", kickoff: "2026-07-18T21:00:00Z" });
  const finished = fixture({ id: "semi-final", status: "finished", kickoff: "2026-07-15T19:00:00Z", canFeature: false });

  assert.equal(selectCatalogMatch([finished, next], "semi-final", "third-place", null), "third-place");
});

test("an explicitly selected archived fixture remains inspectable", () => {
  const next = fixture({ id: "final", kickoff: "2026-07-19T19:00:00Z" });
  const finished = fixture({ id: "semi-final", status: "finished", kickoff: "2026-07-15T19:00:00Z", canFeature: false });

  assert.equal(selectCatalogMatch([finished, next], "semi-final", "final", "semi-final"), "semi-final");
});

test("World Cup upcoming outranks an earlier friendly without opening predictions", () => {
  const friendly = fixture({ id: "friendly", kickoff: "2026-07-18T12:00:00Z", competition: "friendly" });
  const worldCup = fixture({ id: "third-place", kickoff: "2026-07-18T21:00:00Z" });

  assert.equal(selectSuggestedMatch([friendly, worldCup])?.fixtureId, "third-place");
  assert.equal(worldCup.consumerProjection.availability.canPredict, false);
});
