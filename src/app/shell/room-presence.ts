import type { ReplayState } from "../../domain/types";
import type { PersistedRoomReference, ShellActiveRoom, ShellRoomPhase } from "./shell-experience";
import { deriveCanonicalExperienceState, experienceCopy, resolutionBelongsToCurrentRound } from "../../features/match-experience/state-model";

export const SHELL_ROOM_PRESENCE_EVENT = "vira:shell-room-presence";
export const SHELL_ROOM_REFERENCE_KEY = "vira:shell:active-room";

function mapPhase(state: ReplayState): { phase: ShellRoomPhase; label: string } {
  const currentRoundHasResolution = resolutionBelongsToCurrentRound(state.snapshot.currentRound?.id, state.lastResolution?.roundId);
  const canonical = deriveCanonicalExperienceState({ matchStatus: state.snapshot.match.status, roomExists: true, roundState: state.snapshot.currentRound?.state, currentRoundHasResolution, hasSignal: Object.values(state.snapshot.marketDistribution).some((value) => Number.isFinite(value) && value > 0), connectionState: state.snapshot.connectionState });
  if (canonical.match === "finished") return { phase: "finished", label: experienceCopy.room.finished };
  if (canonical.round === "resolved") return { phase: "result_available", label: experienceCopy.round.resolved };
  if (canonical.round === "locked") return state.currentAnswerState === "submitted" ? { phase: "answer_confirmed", label: experienceCopy.round.locked } : { phase: "waiting", label: experienceCopy.signal.waiting };
  if (canonical.round === "open") return state.currentAnswerState === "submitted" ? { phase: "answer_confirmed", label: experienceCopy.round.locked } : { phase: "action_required", label: experienceCopy.round.open };
  return { phase: "waiting", label: canonical.match === "scheduled" ? `${experienceCopy.room.open} · ${experienceCopy.match.scheduled}` : experienceCopy.signal.waiting };
}

export function createConfirmedRoomPresence(state: ReplayState, participantId: string, participantName: string): ShellActiveRoom {
  const mapped = mapPhase(state);
  return {
    roomId: state.snapshot.roomId,
    fixtureId: state.snapshot.match.id,
    homeTeam: state.snapshot.match.homeTeam.name,
    awayTeam: state.snapshot.match.awayTeam.name,
    phase: mapped.phase,
    phaseLabel: mapped.label,
    participantId,
    participantName,
    answerConfirmed: state.currentAnswerState === "submitted" || state.currentAnswerState === "correct" || state.currentAnswerState === "incorrect",
    lastConfirmedVersion: state.snapshot.version,
    updatedAt: new Date().toISOString(),
    connectionState: state.snapshot.connectionState,
  };
}

export function publishConfirmedRoomPresence(room: ShellActiveRoom) {
  const reference: PersistedRoomReference = {
    roomId: room.roomId,
    participantId: room.participantId,
    participantName: room.participantName,
    lastConfirmedVersion: room.lastConfirmedVersion,
    updatedAt: room.updatedAt,
  };
  window.sessionStorage.setItem(SHELL_ROOM_REFERENCE_KEY, JSON.stringify(reference));
  window.dispatchEvent(new CustomEvent<ShellActiveRoom>(SHELL_ROOM_PRESENCE_EVENT, { detail: room }));
}
