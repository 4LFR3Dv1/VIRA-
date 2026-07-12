import assert from "node:assert/strict";
import test from "node:test";
import { classifyCompetition } from "./competition-registry.mjs";

test("registry classifies World Cup and Friendlies by provider id", () => {
  assert.equal(classifyCompetition({ CompetitionId: 72, Competition: "World Cup" }).kind, "world_cup");
  assert.equal(classifyCompetition({ CompetitionId: 430, Competition: "Friendlies" }).displayName, "Amistosos internacionais");
});

test("provider competition wins over an unrelated fixture group", () => {
  const result = classifyCompetition({ CompetitionId: 999, Competition: "Regional Qualifiers", FixtureGroup: "World Cup" });
  assert.equal(result.name, "Regional Qualifiers");
  assert.equal(result.kind, "qualifier");
  assert.equal(result.authority, "provider");
});

test("missing competition fails closed", () => {
  const result = classifyCompetition({});
  assert.equal(result.kind, "unknown");
  assert.equal(result.authority, "unmapped");
});
