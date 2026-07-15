import type { NormalizedMatchEvent } from "../../domain/types";

export type MomentPresentation = "ambient" | "banner" | "takeover";
export type MotionPreference = "full" | "reduced" | "off";
export type MatchMomentKind =
  | "goal"
  | "shot_on_target"
  | "corner"
  | "yellow_card"
  | "red_card"
  | "penalty"
  | "var_started"
  | "var_confirmed"
  | "var_overturned"
  | "full_time"
  | "pressure";

export interface MatchMomentBase {
  id: string;
  sourceActionId: string;
  fixtureId: string;
  kind: MatchMomentKind;
  presentation: MomentPresentation;
  teamSide?: "home" | "away";
  teamName?: string;
  playerName?: string;
  matchClockSec: number;
  occurredAt: string;
  priority: number;
  durationMs: number;
  interruptible: boolean;
  sourceEvent: NormalizedMatchEvent;
}

export interface GoalMoment extends MatchMomentBase {
  kind: "goal";
  presentation: "takeover";
  scoreBefore: { home: number; away: number };
  scoreAfter: { home: number; away: number };
}

export interface PressureMoment extends MatchMomentBase {
  kind: "pressure";
  presentation: "ambient";
  level: "building" | "danger" | "high";
  phase: "attack" | "danger" | "high_danger";
  signalCount: number;
}

export interface StandardMatchMoment extends MatchMomentBase {
  kind: Exclude<MatchMomentKind, "goal" | "pressure">;
}

export type MatchMoment = GoalMoment | PressureMoment | StandardMatchMoment;

export type MomentCommand =
  | { type: "enqueue"; moment: MatchMoment }
  | { type: "replace"; sourceMomentId: string; moment: MatchMoment }
  | { type: "set_ambient"; moment: PressureMoment }
  | { type: "clear_ambient"; fixtureId: string }
  | { type: "revoke"; sourceActionId: string }
  | { type: "dismiss"; momentId?: string }
  | { type: "expire_ambient"; momentId: string };

export interface MatchMomentDirectorState {
  active: MatchMoment | null;
  queue: MatchMoment[];
  ambient: PressureMoment | null;
  seenIds: string[];
  revokedActionIds: string[];
}

export const initialMatchMomentDirectorState: MatchMomentDirectorState = {
  active: null,
  queue: [],
  ambient: null,
  seenIds: [],
  revokedActionIds: [],
};
