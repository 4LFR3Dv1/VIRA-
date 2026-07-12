import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createShareStore } from "./share-store.mjs";

const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
const fixture = { fixtureId: "fixture-1", status: "scheduled", startTime: "2099-07-11T18:00:00.000Z", homeTeam: "Norway", awayTeam: "England" };

async function withStore(run) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "vira-social-"));
  try { await run(await createShareStore({ dataDir }), dataDir); } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
}

test("room invite creates an actionable card and implicit mini league", () => withStore(async (store) => {
  const identity = await store.ensureIdentity(tokenA, "Renan");
  const share = await store.createShare({ kind: "room", createdByPublicId: identity.publicId, metadata: { title: "Sala", description: "Entre", imagePath: "dynamic" }, destination: { path: "/match/fixture-1", ctaLabel: "Entrar" }, attribution: { source: "room" }, payload: { fixtureId: "fixture-1", roomId: "fixture-1" } });
  assert.ok(share.publicCode.length >= 8);
  assert.ok(share.miniLeagueId);
  assert.equal(store.league(share.miniLeagueId, { match: { status: "scheduled" }, leaderboard: [] }).members.length, 1);
  await assert.rejects(store.createShare({ kind: "room", metadata: {}, destination: { path: "https://evil.test", ctaLabel: "Sair" }, payload: {} }), /invalid_share_destination/);
}));

test("invite attribution and mini league membership are idempotent", () => withStore(async (store) => {
  const creator = await store.ensureIdentity(tokenA, "Renan");
  const share = await store.createShare({ kind: "room", createdByPublicId: creator.publicId, metadata: { title: "Sala", description: "Entre" }, destination: { path: "/match/fixture-1", ctaLabel: "Entrar" }, payload: { fixtureId: "fixture-1", roomId: "fixture-1" } });
  await store.linkParticipant({ publicToken: tokenB, displayName: "Ana", roomId: "fixture-1", participantId: "participant-ana", inviteCode: share.publicCode });
  await store.linkParticipant({ publicToken: tokenB, displayName: "Ana", roomId: "fixture-1", participantId: "participant-ana", inviteCode: share.publicCode });
  const league = store.league(share.miniLeagueId, { match: { status: "live" }, leaderboard: [{ participantId: "participant-ana", displayName: "Ana", points: 120, rank: 1 }] });
  assert.equal(league.status, "locked");
  assert.equal(league.members.length, 2);
  assert.equal(league.members[0].displayName, "Ana");
  assert.equal(league.members[0].points, 120);
}));

test("1X2 prediction locks by fixture and resolves from official score", () => withStore(async (store) => {
  const first = await store.createPrediction({ publicToken: tokenA, displayName: "Renan", fixture, choice: "home" });
  const changed = await store.createPrediction({ publicToken: tokenA, displayName: "Renan", fixture, choice: "away" });
  assert.equal(first.id, changed.id);
  assert.equal(changed.choice, "away");
  const result = await store.resolvePredictionsForFixture("fixture-1", { homeScore: 1, awayScore: 2 });
  assert.equal(result.winningChoice, "away");
  const identity = store.identity(tokenA);
  assert.equal(store.prediction("fixture-1", identity.publicId).correct, true);
  await assert.rejects(store.createPrediction({ publicToken: tokenB, displayName: "Ana", fixture: { ...fixture, status: "live" }, choice: "home" }), /prediction_locked/);
}));

test("prediction invite creates an idempotent group cohort and ranking", () => withStore(async (store) => {
  const creator = await store.ensureIdentity(tokenA, "Renan");
  await store.createPrediction({ publicToken: tokenA, displayName: "Renan", fixture, choice: "away" });
  const share = await store.createShare({ kind: "prediction", createdByPublicId: creator.publicId, metadata: { title: "Palpite", description: "Entre" }, destination: { path: "/match/fixture-1/preview", ctaLabel: "Palpitar" }, payload: { fixtureId: "fixture-1" } });
  await store.createPrediction({ publicToken: tokenB, displayName: "Ana", fixture, choice: "home" });
  await store.attributePredictionInvite({ publicToken: tokenB, displayName: "Ana", inviteCode: share.publicCode });
  await store.attributePredictionInvite({ publicToken: tokenB, displayName: "Ana", inviteCode: share.publicCode });
  await store.resolvePredictionsForFixture("fixture-1", { homeScore: 1, awayScore: 2 });
  const league = store.league(share.miniLeagueId, { match: { status: "finished" }, leaderboard: [] });
  assert.equal(league.status, "resolved");
  assert.equal(league.members.length, 2);
  assert.equal(league.members[0].displayName, "Renan");
  assert.equal(league.members[0].points, 100);
}));

test("prediction share and mini league preserve creation-time editorial context", () => withStore(async (store) => {
  const identity = await store.ensureIdentity(tokenA, "Bob");
  const editorialContext = { locale: "pt-BR", timeZone: "America/Sao_Paulo", kickoffAt: "2026-07-14T19:00:00Z", temporalRelationAtCreation: "later_this_week", evaluatedAt: "2026-07-12T12:00:00Z" };
  const share = await store.createShare({ kind: "prediction", createdByPublicId: identity.publicId, metadata: { title: "Bob escolheu Franca", description: "Quem vence Franca x Espanha?" }, destination: { path: "/match/fx/preview", ctaLabel: "Palpitar" }, payload: { fixtureId: "fx" }, editorialContext });
  assert.deepEqual(store.getShare(share.publicCode).editorialContext, editorialContext);
  assert.deepEqual(store.league(share.miniLeagueId, { match: { status: "scheduled" }, leaderboard: [] }).editorialContext, editorialContext);
}));

test("social state survives store restart without exposing public tokens", () => withStore(async (store, dataDir) => {
  const identity = await store.ensureIdentity(tokenA, "Renan");
  const share = await store.createShare({ kind: "result", createdByPublicId: identity.publicId, metadata: { title: "Acertou", description: "+100" }, destination: { path: "/match/fixture-1", ctaLabel: "Jogar" }, payload: { fixtureId: "fixture-1" } });
  const restarted = await createShareStore({ dataDir });
  assert.equal(restarted.getShare(share.publicCode).metadata.title, "Acertou");
  assert.equal(JSON.stringify(restarted.getShare(share.publicCode)).includes(tokenA), false);
}));
