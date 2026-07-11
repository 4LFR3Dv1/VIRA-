import type { ShellMode } from "../routing/route-manifest";

export type ShellConnectivity = {
  browser: "online" | "offline";
  backend: "unknown" | "healthy" | "unavailable";
  roomStream: "not_applicable" | "connecting" | "healthy" | "reconnecting" | "unavailable";
  txline: "not_applicable" | "healthy" | "reconnecting" | "unavailable";
  lastConfirmedAt?: string;
};

export type ShellConnectionPresentation =
  | { kind: "healthy" }
  | { kind: "offline" }
  | { kind: "backend_unavailable" }
  | { kind: "room_reconnecting" }
  | { kind: "txline_reconnecting" }
  | { kind: "txline_unavailable" };

export type ShellReadiness =
  | { kind: "ready" }
  | { kind: "booting"; scope: "global" }
  | { kind: "hydrating_room"; scope: "route" | "background"; roomId: string }
  | { kind: "replaying_ledger"; scope: "route"; roomId: string }
  | { kind: "verifying_projection"; scope: "overlay" | "background"; roomId: string }
  | { kind: "integrity_failed"; scope: "global" | "room"; roomId: string };

export type ShellRoomPhase = "waiting" | "action_required" | "answer_confirmed" | "result_available" | "finished";

export type ShellActiveRoom = {
  roomId: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  phase: ShellRoomPhase;
  phaseLabel: string;
  participantId: string;
  participantName: string;
  answerConfirmed: boolean;
  lastConfirmedVersion: number;
  updatedAt: string;
  connectionState: string;
};

export type PersistedRoomReference = Pick<ShellActiveRoom, "roomId" | "participantId" | "participantName" | "lastConfirmedVersion" | "updatedAt">;

export type ActiveRoomPresenceState =
  | { kind: "none" }
  | { kind: "revalidating"; reference: PersistedRoomReference }
  | { kind: "confirmed"; room: ShellActiveRoom }
  | { kind: "expired"; roomId: string };

export type OfficialReviewAvailability =
  | { kind: "unavailable" }
  | { kind: "checking"; roomId: string }
  | { kind: "available"; roomId: string }
  | { kind: "failed"; roomId: string; reason: string };

export type ShellExperience = {
  mode: ShellMode;
  route: { id: string; title: string; context?: string; backPath?: string };
  connectivity: ShellConnectivity;
  connection: ShellConnectionPresentation;
  readiness: ShellReadiness;
  activeRoom: ActiveRoomPresenceState;
  review: OfficialReviewAvailability;
};

export function deriveConnectionPresentation(value: ShellConnectivity): ShellConnectionPresentation {
  if (value.browser === "offline") return { kind: "offline" };
  if (value.backend === "unavailable") return { kind: "backend_unavailable" };
  if (value.roomStream === "reconnecting" || value.roomStream === "unavailable") return { kind: "room_reconnecting" };
  if (value.txline === "reconnecting") return { kind: "txline_reconnecting" };
  if (value.txline === "unavailable") return { kind: "txline_unavailable" };
  return { kind: "healthy" };
}
