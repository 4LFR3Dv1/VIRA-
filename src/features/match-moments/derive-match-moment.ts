import type { Match, NormalizedMatchEvent } from "../../domain/types";
import type { MatchMoment, MatchMomentKind, MomentCommand, PressureMoment } from "./match-moment-types";

const direction: Record<Exclude<MatchMomentKind, "pressure">, { presentation: "banner" | "takeover"; priority: number; durationMs: number; interruptible: boolean }> = {
  goal: { presentation: "takeover", priority: 100, durationMs: 6_500, interruptible: false },
  red_card: { presentation: "takeover", priority: 90, durationMs: 5_200, interruptible: false },
  var_confirmed: { presentation: "takeover", priority: 92, durationMs: 4_800, interruptible: false },
  var_overturned: { presentation: "takeover", priority: 94, durationMs: 5_200, interruptible: false },
  full_time: { presentation: "takeover", priority: 110, durationMs: 7_000, interruptible: false },
  penalty: { presentation: "banner", priority: 80, durationMs: 4_200, interruptible: true },
  var_started: { presentation: "banner", priority: 82, durationMs: 4_200, interruptible: true },
  yellow_card: { presentation: "banner", priority: 60, durationMs: 3_200, interruptible: true },
  corner: { presentation: "banner", priority: 40, durationMs: 2_800, interruptible: true },
  shot_on_target: { presentation: "banner", priority: 30, durationMs: 2_400, interruptible: true },
};

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function eventText(event: NormalizedMatchEvent) {
  const data = event.payload?.Data && typeof event.payload.Data === "object" ? event.payload.Data as Record<string, unknown> : {};
  return [event.outcome, event.payload?.Type, event.payload?.Action, event.payload?.EventType, event.payload?.Decision, event.payload?.PossibleEvent, data.Type, data.Action, data.Decision, data.PossibleEvent]
    .map(text).join(" ").toLowerCase();
}

function teamName(match: Match, side?: "home" | "away" | null) {
  return side === "home" ? match.homeTeam.name : side === "away" ? match.awayTeam.name : undefined;
}

function playerName(event: NormalizedMatchEvent) {
  return text(event.payload?.PlayerName) || text(event.payload?.playerName) || undefined;
}

function baseMoment<K extends Exclude<MatchMomentKind, "pressure">>(event: NormalizedMatchEvent, match: Match, kind: K): Omit<MatchMoment, "kind"> & { kind: K } {
  const config = direction[kind];
  const side = event.participantSide ?? undefined;
  return {
    id: `moment:${event.id}:${kind}`,
    sourceActionId: event.sourceActionId ?? event.id,
    fixtureId: event.matchId,
    kind,
    presentation: config.presentation,
    teamSide: side,
    teamName: teamName(match, side),
    playerName: playerName(event),
    matchClockSec: event.matchClockSec,
    occurredAt: event.occurredAt,
    priority: config.priority,
    durationMs: config.durationMs,
    interruptible: config.interruptible,
    sourceEvent: event,
  } as Omit<MatchMoment, "kind"> & { kind: K };
}

export function deriveMatchMoment(event: NormalizedMatchEvent, match: Match): MomentCommand | null {
  if (event.type === "action_discarded") {
    return { type: "revoke", sourceActionId: event.discardedActionId ?? event.sourceActionId ?? event.id };
  }

  if (event.type === "action_amended") {
    const amended = { ...event, type: (event.amendedActionType ?? "period") as NormalizedMatchEvent["type"] };
    const command = deriveMatchMoment(amended, match);
    return command?.type === "enqueue"
      ? { type: "replace", sourceMomentId: event.sourceActionId ?? event.id, moment: command.moment }
      : command;
  }

  if (event.confirmed === false) return null;
  const raw = eventText(event);
  if (event.type === "shot" && /on.?target|on target|saved|goal/.test(raw)) {
    return { type: "enqueue", moment: baseMoment(event, match, "shot_on_target") };
  }
  if (event.type === "goal") {
    const scoreAfter = event.absoluteScore ?? { home: match.homeScore, away: match.awayScore };
    const scoreBefore = {
      home: Math.max(0, scoreAfter.home - (event.participantSide === "home" ? 1 : 0)),
      away: Math.max(0, scoreAfter.away - (event.participantSide === "away" ? 1 : 0)),
    };
    return { type: "enqueue", moment: { ...baseMoment(event, match, "goal"), kind: "goal", presentation: "takeover", scoreBefore, scoreAfter } };
  }
  if (event.type === "corner") return { type: "enqueue", moment: baseMoment(event, match, "corner") };
  if (event.type === "penalty") return { type: "enqueue", moment: baseMoment(event, match, "penalty") };
  if (event.type === "card") return { type: "enqueue", moment: baseMoment(event, match, raw.includes("red") ? "red_card" : "yellow_card") };
  if (event.type === "var") {
    const kind = /overturn|cancel|disallow|revoke/.test(raw) ? "var_overturned" : /confirm|complete|approved/.test(raw) ? "var_confirmed" : "var_started";
    return { type: "enqueue", moment: baseMoment(event, match, kind) };
  }
  if (event.type === "match_end") return { type: "enqueue", moment: baseMoment(event, match, "full_time") };
  if (event.type === "possession" && /danger|attack|pressure/.test(raw)) {
    const side = event.participantSide ?? undefined;
    const moment: PressureMoment = {
      ...baseMoment(event, match, "corner"),
      id: `moment:${event.id}:pressure`,
      kind: "pressure",
      presentation: "ambient",
      teamSide: side,
      priority: 10,
      durationMs: 8_000,
      interruptible: true,
      level: /high|very/.test(raw) ? "high" : "danger",
    };
    return { type: "enqueue", moment };
  }
  return null;
}
