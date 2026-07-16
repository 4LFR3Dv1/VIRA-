import type { PublicDomainEvent, VerifiedRoundReplayV1 } from "../../domain/types.ts";

export type GuidedPlaybackPhase =
  | "countdown"
  | "kickoff"
  | "round_open"
  | "answers_locked"
  | "txline_signal"
  | "resolved"
  | "finished";

export interface GuidedPlaybackStep {
  phase: GuidedPlaybackPhase;
  startsAtMs: number;
  sourceEventTypes: readonly string[];
  sourceStreamVersions: readonly number[];
}

const REQUIRED_EVENTS = Object.freeze([
  "room.configured",
  "round.opened",
  "answer.submitted",
  "round.locked",
  "txline.event.accepted",
  "round.resolved",
]);

function versionsFor(events: readonly PublicDomainEvent[], types: readonly string[]) {
  return events
    .filter((event) => types.includes(event.type))
    .map((event) => event.streamVersion)
    .sort((left, right) => left - right);
}

export function buildGuidedPlaybackTimeline(events: readonly PublicDomainEvent[], replay: VerifiedRoundReplayV1): readonly GuidedPlaybackStep[] {
  const observedTypes = new Set(events.map((event) => event.type));
  for (const type of REQUIRED_EVENTS) {
    if (!observedTypes.has(type)) throw new Error(`guided_playback_missing_event:${type}`);
  }
  if (!replay.proof.hashChainValid || !replay.proof.projectionMatches || !replay.proof.rankingMatches || !replay.proof.authorityValid) {
    throw new Error("guided_playback_unverified_replay");
  }

  const step = (phase: GuidedPlaybackPhase, startsAtMs: number, sourceEventTypes: readonly string[]): GuidedPlaybackStep => ({
    phase,
    startsAtMs,
    sourceEventTypes,
    sourceStreamVersions: versionsFor(events, sourceEventTypes),
  });

  return Object.freeze([
    step("countdown", 0, ["room.configured"]),
    step("kickoff", 10_000, ["room.configured"]),
    step("round_open", 12_000, ["round.opened", "answer.submitted"]),
    step("answers_locked", 17_000, ["answer.submitted", "round.locked"]),
    step("txline_signal", 20_000, ["txline.event.received", "txline.event.accepted"]),
    step("resolved", 23_000, ["round.resolved"]),
    step("finished", 27_000, ["round.resolved", "room.configured"]),
  ]);
}

export function guidedPlaybackStepAt(timeline: readonly GuidedPlaybackStep[], elapsedMs: number) {
  return [...timeline].reverse().find((step) => elapsedMs >= step.startsAtMs) ?? timeline[0];
}

export function countdownSeconds(elapsedMs: number) {
  return Math.max(0, Math.ceil((10_000 - elapsedMs) / 1000));
}

