import type { Match, NormalizedMatchEvent } from "../../domain/types";
import type { MomentCommand, PressureMoment } from "./match-moment-types";

const MAX_SIGNAL_GAP_SEC = 20;

export interface PressureEpisodeState {
  fixtureId: string | null;
  teamSide: "home" | "away" | null;
  episodeId: string | null;
  lastClockSec: number | null;
  signalCount: number;
  peakIntensity: 0 | 1 | 2 | 3 | 4;
  visible: boolean;
}

export const initialPressureEpisodeState: PressureEpisodeState = {
  fixtureId: null,
  teamSide: null,
  episodeId: null,
  lastClockSec: null,
  signalCount: 0,
  peakIntensity: 0,
  visible: false,
};

function reset(fixtureId: string): PressureEpisodeState {
  return { ...initialPressureEpisodeState, fixtureId };
}

function teamName(match: Match, side: "home" | "away") {
  return side === "home" ? match.homeTeam.name : match.awayTeam.name;
}

export function advancePressureEpisode(
  current: PressureEpisodeState,
  event: NormalizedMatchEvent,
  match: Match,
): { state: PressureEpisodeState; command: MomentCommand | null } {
  if (event.type !== "possession" || !event.possession) return { state: current, command: null };
  const fixtureId = event.matchId;
  const side = event.participantSide;
  const intensity = event.possession.intensity;
  const clock = event.matchClockSec;
  const base = current.fixtureId === fixtureId ? current : reset(fixtureId);

  if (!side || intensity <= 1) {
    return {
      state: reset(fixtureId),
      command: base.visible ? { type: "clear_ambient", fixtureId } : null,
    };
  }

  const continues = base.teamSide === side
    && base.lastClockSec !== null
    && clock >= base.lastClockSec
    && clock - base.lastClockSec <= MAX_SIGNAL_GAP_SEC;
  const state: PressureEpisodeState = continues
    ? {
        ...base,
        lastClockSec: clock,
        signalCount: base.signalCount + 1,
        peakIntensity: Math.max(base.peakIntensity, intensity) as PressureEpisodeState["peakIntensity"],
      }
    : {
        fixtureId,
        teamSide: side,
        episodeId: `pressure:${fixtureId}:${side}:${event.sequence}`,
        lastClockSec: clock,
        signalCount: 1,
        peakIntensity: intensity,
        visible: false,
      };

  state.visible = state.visible || intensity === 4 || state.signalCount >= 2;
  if (!state.visible) {
    return {
      state,
      command: base.visible ? { type: "clear_ambient", fixtureId } : null,
    };
  }

  const level: PressureMoment["level"] = state.peakIntensity >= 4 ? "high" : state.peakIntensity >= 3 ? "danger" : "building";
  const phase: PressureMoment["phase"] = state.peakIntensity >= 4 ? "high_danger" : state.peakIntensity >= 3 ? "danger" : "attack";
  const moment: PressureMoment = {
    id: state.episodeId ?? `pressure:${fixtureId}:${side}:${event.sequence}`,
    sourceActionId: event.sourceActionId ?? event.providerActionId ?? event.id,
    fixtureId,
    kind: "pressure",
    presentation: "ambient",
    teamSide: side,
    teamName: teamName(match, side),
    matchClockSec: clock,
    occurredAt: event.occurredAt,
    priority: 10,
    durationMs: 8_000,
    interruptible: true,
    sourceEvent: event,
    level,
    phase,
    signalCount: state.signalCount,
  };
  return { state, command: { type: "set_ambient", moment } };
}
