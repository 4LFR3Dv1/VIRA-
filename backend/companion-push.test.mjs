import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { projectConsumerAttentionEvents, projectRankChangedEvent, selectAttentionForParticipant } from "../shared/consumer-attention.mjs";
import { attentionDeliveryPayload } from "./attention-delivery.mjs";
import { createAttentionOrchestrator } from "./attention-orchestrator.mjs";
import { createCompanionSubscriptionStore } from "./companion-subscription-store.mjs";
import { createWebPushPublisherFromEnv } from "./web-push-publisher.mjs";

function snapshot(overrides = {}) {
  return {
    roomId: "room-1", version: 12, serverTime: "2026-07-14T18:00:05.000Z", ledger: { streamVersion: 12 },
    match: { id: "fixture-1", status: "live", startTime: "2026-07-14T18:00:00.000Z", homeScore: 1, awayScore: 0, matchClockSec: 600 },
    currentRound: { id: "round-1", state: "open", version: 1, sequence: 1, openedAt: "2026-07-14T18:00:00.000Z", locksAt: "2026-07-14T18:00:30.000Z" },
    currentParticipant: { id: "player-a" }, currentParticipantAnswer: null,
    leaderboard: [{ participantId: "player-a", rank: 2, points: 10 }],
    lastResolution: null, ...overrides,
  };
}

function registrationInput(overrides = {}) {
  return { fixtureId: "fixture-1", roomId: "room-1", participantId: "player-a", locale: "en", timeZone: "America/Sao_Paulo", enabledTypes: ["round_open", "round_resolved", "rank_changed"], inviteCode: "invite-safe", pushSubscription: { endpoint: "https://push.example/subscription-a", expirationTime: null, keys: { p256dh: "public-key", auth: "auth-key" } }, ...overrides };
}

test("attention events are discriminated, stable across stream changes and privately selected", () => {
  const first = projectConsumerAttentionEvents(snapshot(), "player-a");
  const changedStream = projectConsumerAttentionEvents(snapshot({ version: 99, ledger: { streamVersion: 99 } }), "player-a");
  const roundOpen = first.find(({ event }) => event.type === "round_open");
  assert.equal(roundOpen.event.eventId, changedStream.find(({ event }) => event.type === "round_open").event.eventId);
  const lockedSnapshot = snapshot({ currentRound: { ...snapshot().currentRound, state: "locked", lockedAt: "2026-07-14T18:00:30.000Z", lockReason: "deadline" }, currentParticipantAnswer: { state: "submitted", optionId: "secret-option" } });
  const projected = projectConsumerAttentionEvents(lockedSnapshot, "player-a");
  assert.equal(selectAttentionForParticipant(projected, "player-b").some((event) => event.type === "round_locked"), false);
  const locked = selectAttentionForParticipant(projected, "player-a").find((event) => event.type === "round_locked");
  assert.deepEqual(Object.keys(locked.payload).sort(), ["answerConfirmed", "lockReason"]);
  assert.equal(JSON.stringify(locked).includes("secret-option"), false);
});

test("match_starting uses authoritative serverTime and only emits inside the 15-minute window", () => {
  const scheduled = (startTime, serverTime = "2026-07-14T18:00:00.000Z", overrides = {}) => snapshot({
    serverTime,
    match: { ...snapshot().match, status: "scheduled", startTime, ...overrides },
    currentRound: null,
  });
  const starting = (value) => projectConsumerAttentionEvents(value, "player-a").find(({ event }) => event.type === "match_starting")?.event ?? null;

  assert.equal(starting(scheduled("2026-07-15T00:00:00.000Z")), null, "six hours away is not starting");
  const boundary = starting(scheduled("2026-07-14T18:15:00.000Z"));
  assert.ok(boundary, "the exact 15-minute boundary is eligible");
  assert.equal(boundary.occurredAt, "2026-07-14T18:00:00.000Z");
  assert.equal(starting(scheduled("2026-07-14T17:59:59.999Z")), null, "past kickoff is not starting");
  assert.equal(starting(scheduled("not-a-date")), null, "invalid kickoff is rejected");
  assert.equal(starting(scheduled(undefined)), null, "missing kickoff is rejected");
  assert.equal(starting(scheduled("2026-07-14T18:15:00.000Z", "invalid-server-time")), null, "invalid authoritative time fails closed");

  const changedStream = scheduled("2026-07-14T18:15:00.000Z");
  changedStream.version = 99;
  changedStream.ledger = { streamVersion: 99 };
  assert.equal(starting(changedStream).eventId, boundary.eventId, "streamVersion does not change event identity");
});

test("rank changes are derived from authoritative leaderboard fields only", () => {
  const change = projectRankChangedEvent(snapshot(), "player-a", 4);
  assert.equal(change.event.type, "rank_changed");
  assert.deepEqual(change.event.payload, { previousRank: 4, currentRank: 2, points: 10 });
  assert.equal(change.event.eventId.includes("player-a"), false);
  assert.equal(projectRankChangedEvent(snapshot(), "player-a", 2), null);
  assert.equal(projectRankChangedEvent(snapshot(), "player-b", 4), null);
});

test("delivery payload is localized, allowlisted and token-free", () => {
  const event = selectAttentionForParticipant(projectConsumerAttentionEvents(snapshot({ currentRound: { ...snapshot().currentRound, state: "locked", lockedAt: "2026-07-14T18:00:30.000Z" }, currentParticipantAnswer: { state: "submitted", optionId: "private-home" } }), "player-a"), "player-a").find((candidate) => candidate.type === "round_locked");
  const payload = attentionDeliveryPayload(event, { locale: "pt-BR", timeZone: "UTC", roomId: "room-1", inviteCode: "invite-safe" });
  assert.deepEqual(Object.keys(payload).sort(), ["body", "eventId", "expiresAt", "occurredAt", "tag", "title", "type", "url", "version"]);
  assert.match(payload.title, /palpite/i);
  assert.match(payload.url, /^\/match\/room-1\?lang=pt-BR&invite=invite-safe$/);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /private-home|sessionToken|participantToken|Bearer/i);
});

test("subscription store is idempotent, redacted, deduplicated and expires endpoints", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-push-"));
  const store = await createCompanionSubscriptionStore({ dataDir });
  const first = await store.register(registrationInput());
  const second = await store.register(registrationInput({ locale: "pt-BR" }));
  assert.equal(first.id, second.id);
  assert.equal(second.locale, "pt-BR");
  assert.equal("pushSubscription" in second, false);
  assert.equal("participantId" in second, false);
  const persisted = JSON.parse(await readFile(path.join(dataDir, "companion-subscriptions.json"), "utf8"));
  assert.equal(JSON.stringify(persisted).includes("session-token"), false);
  const reserved = await store.reserveDelivery(first.id, "event-1", 30);
  assert.equal(reserved.accepted, true);
  assert.equal((await store.reserveDelivery(first.id, "event-1", 30)).reason, "duplicate");
  await store.completeDelivery(reserved.key);
  await store.expire(first.id, "push_410");
  assert.equal(store.activeSubscriptions().length, 0);
});

test("orchestrator delivers only enabled participant projection and deduplicates", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-orchestrator-"));
  const store = await createCompanionSubscriptionStore({ dataDir });
  await store.register(registrationInput({ enabledTypes: ["rank_changed"] }));
  let current = snapshot();
  const sent = [];
  const runtime = { hasPublicRoom: () => true, snapshot: () => current };
  const publisher = { enabled: true, async send(_subscription, payload) { sent.push(payload); return { delivered: true }; } };
  const orchestrator = createAttentionOrchestrator({ runtime, store, publisher });
  await orchestrator.tick();
  current = snapshot({ leaderboard: [{ participantId: "player-a", rank: 1, points: 20 }] });
  await orchestrator.tick();
  await orchestrator.tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "rank_changed");
  assert.equal(JSON.stringify(sent[0]).includes("participantId"), false);
});

test("delivered match_starting is not resent on later stream versions", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vira-match-starting-"));
  const store = await createCompanionSubscriptionStore({ dataDir });
  await store.register(registrationInput({ enabledTypes: ["match_starting"] }));
  const baseMatch = { ...snapshot().match, status: "scheduled", startTime: "2026-07-14T18:15:00.000Z" };
  let current = snapshot({ serverTime: "2026-07-14T18:00:00.000Z", match: baseMatch, currentRound: null });
  const sent = [];
  const runtime = { hasPublicRoom: () => true, snapshot: () => current };
  const publisher = { enabled: true, async send(_subscription, payload) { sent.push(payload); return { delivered: true }; } };
  const orchestrator = createAttentionOrchestrator({ runtime, store, publisher });

  await orchestrator.tick();
  current = snapshot({ serverTime: "2026-07-14T18:01:00.000Z", version: 99, ledger: { streamVersion: 99 }, match: baseMatch, currentRound: null });
  await orchestrator.tick();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "match_starting");
});

test("web push remains disabled without explicit VAPID configuration", async () => {
  const publisher = createWebPushPublisherFromEnv({});
  assert.equal(publisher.enabled, false);
  assert.equal(publisher.publicKey, null);
  assert.equal((await publisher.send({}, {})).reason, "web_push_disabled");
});
