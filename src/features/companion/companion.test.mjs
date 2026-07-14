import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectConsumerAttentionEvents, selectAttentionForParticipant } from "./attention-projector.ts";
import { readCompanionPreferences, writeCompanionPreferences } from "./preferences.ts";
import { deriveViraCompanionViewModel, sameViraCompanionViewModel } from "./view-model.ts";
import { documentPictureInPictureController, installCompanionStyles } from "./document-pip.ts";
import { canRegisterServiceWorker } from "../../pwa/register-service-worker.ts";

function roomState() {
  const snapshot = {
    serverTime: "2026-07-14T18:00:05.000Z",
    roomId: "fixture-companion",
    roomLabel: "France × Spain",
    roomPopulation: 1,
    version: 12,
    lastSequence: 12,
    ledger: { streamVersion: 12, headHash: "sha256:public" },
    connectionState: "live",
    match: {
      id: "fixture-companion", title: "France × Spain", competitionLabel: "World Cup", status: "live", homeScore: 1, awayScore: 0, matchClockSec: 3600,
      homeTeam: { id: "france", name: "France", shortName: "FRA", flag: "", accent: "#C8FF00" },
      awayTeam: { id: "spain", name: "Spain", shortName: "ESP", flag: "", accent: "#F5F7F2" },
    },
    currentParticipant: { id: "player-a", displayName: "Ana", initials: "AN", accent: "lime", isCurrentUser: true },
    participants: [{ id: "player-a", displayName: "Ana", initials: "AN", accent: "lime", isCurrentUser: true }],
    leaderboard: [{ participantId: "player-a", displayName: "Ana", points: 100, rank: 1, streak: 1, movement: "up", delta: 100, isCurrentUser: true }],
    answers: {},
    currentParticipantAnswer: null,
    currentRound: null,
    timeline: [], marketDistribution: {}, roomDistribution: {}, evidenceHistory: [], lastResolution: null,
  };
  return { matchId: "fixture-companion", status: "playing", speed: 1, currentStepIndex: 0, elapsedMs: 0, selectedOptionId: null, currentAnswerState: "not_answered", currentUiState: "prediction_open", currentRoundOpenedAtMs: null, lastResolution: null, snapshot };
}

function openRound(state) {
  state.snapshot.currentRound = {
    id: "round-1", version: 1, matchId: state.snapshot.match.id, sequence: 1,
    title: "copy must not be authoritative", contextLabel: "legacy copy", options: [{ id: "yes", label: "Sim" }, { id: "no", label: "Não" }],
    opensAtClockSec: 3600, locksAtClockSec: 3660, answerWindowSec: 60,
    openedAt: "2026-07-14T18:00:00.000Z", locksAt: "2026-07-14T18:01:00.000Z", state: "open",
    resolution: { domain: "football", mode: "football_condition", condition: { kind: "team_scores", targetSide: "home", durationSec: 600, state: "awaiting_lock" } },
  };
  return state;
}

test("attention projection is allowlisted, audience-safe and presentation-neutral", () => {
  const state = openRound(roomState());
  const before = structuredClone(state.snapshot);
  const projected = projectConsumerAttentionEvents(state.snapshot, "player-a");
  const selected = selectAttentionForParticipant(projected, "player-a");
  assert.deepEqual(state.snapshot, before);
  assert.deepEqual(selected.map((event) => event.type), ["match_live", "round_open"]);
  assert.equal(JSON.stringify(selected).includes("copy must not be authoritative"), false);
  assert.equal(JSON.stringify(selected).match(/token|session/gi), null);

  state.snapshot.currentRound.state = "locked";
  state.snapshot.currentRound.lockedAt = "2026-07-14T18:01:00.000Z";
  state.snapshot.currentParticipantAnswer = { roundId: "round-1", participantId: "player-a", optionId: "yes", submittedAtMs: 1, answeredAtClockSec: 3650, state: "submitted" };
  const locked = projectConsumerAttentionEvents(state.snapshot, "player-a");
  assert.equal(selectAttentionForParticipant(locked, "player-b").some((event) => event.type === "round_locked"), false);
  assert.equal(selectAttentionForParticipant(locked, "player-a").find((event) => event.type === "round_locked")?.payload.answerConfirmed, true);
});

test("view model follows authoritative state without changing streamVersion", () => {
  const state = roomState();
  assert.equal(deriveViraCompanionViewModel(state, "player-a").state, "live");
  openRound(state);
  assert.equal(deriveViraCompanionViewModel(state, "player-a").state, "round_open");
  state.snapshot.currentParticipantAnswer = { roundId: "round-1", participantId: "player-a", optionId: "yes", submittedAtMs: 1, answeredAtClockSec: 3650, state: "submitted" };
  assert.equal(deriveViraCompanionViewModel(state, "player-a").state, "answer_confirmed");
  state.snapshot.currentRound.state = "locked";
  assert.equal(deriveViraCompanionViewModel(state, "player-a").state, "locked");
  state.snapshot.lastResolution = { roundId: "round-1", winningOptionId: "yes", wasCurrentUserCorrect: true, pointsAwarded: 100, streakAfterResolve: 2, movementLabel: "up", resolvedBy: "event" };
  const resolved = deriveViraCompanionViewModel(state, "player-a");
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.pointsAwarded, 100);
  assert.equal(resolved.rank, 1);
  assert.equal(resolved.streamVersion, 12);
  assert.equal(state.snapshot.ledger.streamVersion, 12);
  state.snapshot.connectionState = "offline";
  assert.equal(deriveViraCompanionViewModel(state, "player-a").state, "offline");
});

test("Companion presentation ignores irrelevant stream events but preserves semantic updates", () => {
  const model = deriveViraCompanionViewModel(openRound(roomState()), "player-a");
  const irrelevant = structuredClone(model); irrelevant.streamVersion += 1; irrelevant.attentionEvents = [];
  assert.equal(sameViraCompanionViewModel(model, irrelevant), true);
  const relevant = structuredClone(model); relevant.homeScore += 1;
  assert.equal(sameViraCompanionViewModel(model, relevant), false);
});

test("Follow preference is local, idempotent and contains no competitive credential", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readCompanionPreferences(storage, "fixture-companion").enabled, false);
  writeCompanionPreferences(storage, "fixture-companion", true, new Date("2026-07-14T18:00:00.000Z"));
  writeCompanionPreferences(storage, "fixture-companion", true, new Date("2026-07-14T18:00:00.000Z"));
  const stored = readCompanionPreferences(storage, "fixture-companion");
  assert.equal(stored.enabled, true);
  assert.equal(JSON.stringify(stored).match(/participant|session|token/gi), null);
});

test("Document PiP is capability-detected without browser sniffing", () => {
  assert.equal(documentPictureInPictureController({}), null);
  const requestWindow = async () => ({});
  assert.equal(documentPictureInPictureController({ documentPictureInPicture: { requestWindow } }).requestWindow, requestWindow);
  assert.equal(documentPictureInPictureController({ documentPictureInPicture: {} }), null);
});

test("Document PiP installs one dedicated stylesheet without copying the application", () => {
  const appended = [];
  const target = { createElement: () => ({ dataset: {}, textContent: "" }), head: { append: (node) => appended.push(node) } };
  installCompanionStyles(target, "#vira-companion-pip-root{contain:layout paint style}");
  assert.equal(appended.length, 1);
  assert.equal(appended[0].dataset.viraCompanionPip, "true");
  assert.match(appended[0].textContent, /contain:layout paint style/);
});

test("performance guardrails keep PiP static and clocks at one hertz or less", async () => {
  const clockSource = await readFile(new URL("../../runtime/use-server-clock.ts", import.meta.url), "utf8");
  const pipSource = await readFile(new URL("./ViraCompanion.tsx", import.meta.url), "utf8");
  const documentPipSource = await readFile(new URL("./document-pip.ts", import.meta.url), "utf8");
  const pipCss = await readFile(new URL("./companion-pip.css", import.meta.url), "utf8");
  assert.match(clockSource, /intervalMs = 1_000/);
  assert.match(clockSource, /if \(!hasTarget\) return/);
  assert.match(clockSource, /Math\.max\(1_000, intervalMs\)/);
  assert.match(pipSource, /mode === "pip"\) return <PipCompanion/);
  assert.doesNotMatch(pipSource.slice(pipSource.indexOf("function PipCompanion")), /<motion\./);
  assert.doesNotMatch(documentPipSource, /styleSheets|cssRules|rel = "stylesheet"/);
  assert.match(pipCss, /contain:\s*layout paint style/);
  assert.doesNotMatch(pipCss, /infinite|animation-iteration-count:\s*infinite/);
});

test("Service Worker registration requires capability and a secure context", () => {
  const serviceWorker = {};
  assert.equal(canRegisterServiceWorker({ protocol: "https:", hostname: "vira.example" }, { serviceWorker }), true);
  assert.equal(canRegisterServiceWorker({ protocol: "http:", hostname: "127.0.0.1" }, { serviceWorker }), true);
  assert.equal(canRegisterServiceWorker({ protocol: "http:", hostname: "vira.example" }, { serviceWorker }), false);
  assert.equal(canRegisterServiceWorker({ protocol: "https:", hostname: "vira.example" }, { serviceWorker: undefined }), false);
});
