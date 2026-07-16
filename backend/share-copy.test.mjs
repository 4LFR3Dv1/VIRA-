import assert from "node:assert/strict";
import test from "node:test";

import { predictionShareCopy, resolveShareLocaleContext, roomShareCopy, shareChoiceLabel } from "../shared/share-copy.mjs";

const fixture = { homeTeam: "France", awayTeam: "Spain" };

test("legacy shares use the explicit compatible PT-BR context", () => {
  assert.deepEqual(resolveShareLocaleContext({}), { locale: "pt-BR", timeZone: "America/Sao_Paulo", source: "legacy_default" });
});

test("prediction share copy is materialized in the creator locale", () => {
  const editorialContext = { locale: "en", timeZone: "America/Sao_Paulo", temporalRelationAtCreation: "tomorrow", localKickoffDate: "Jul 14, 2026", localKickoffTime: "4:00 PM" };
  const copy = predictionShareCopy({ fixture, displayName: "Ana", choiceLabel: shareChoiceLabel("draw", fixture, "en"), editorialContext });
  assert.equal(copy.metadata.title, "Ana is backing Draw. Who are you with?");
  assert.match(copy.metadata.description, /Who wins tomorrow\?/);
  assert.equal(copy.ctaLabel, "Make my pick");
});

test("room share copy localizes VIRA copy without changing participant or team names", () => {
  const snapshot = { match: { status: "live", homeTeam: { name: "France" }, awayTeam: { name: "Spain" } }, roomPopulation: 2 };
  const copy = roomShareCopy({ snapshot, participant: { displayName: "João" }, locale: "en", kind: "room" });
  assert.equal(copy.metadata.title, "João opened France x Spain. Are you in?");
  assert.match(copy.metadata.description, /Live match · 2 in the room/);
  assert.equal(copy.ctaLabel, "Join the room");
});
