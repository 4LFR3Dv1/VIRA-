import type { ComponentType } from "react";
import { matchPath } from "react-router";

import { LobbyScreen } from "../../features/lobby/LobbyScreen";
import { MatchPreviewScreen } from "../../features/match-preview/MatchPreviewScreen";
import { MatchRoomScreen } from "../../features/match-room/MatchRoomScreen";

export type ShellMode = "discovery" | "game" | "immersive";
export type RouteAvailability = "available" | "feature_flag" | "planned";

export interface ViraRouteDefinition {
  id: "home" | "match-preview" | "match-room";
  index?: boolean;
  path?: string;
  pattern: string;
  title: string;
  context?: string;
  shellMode: ShellMode;
  maxWidth: "full" | "editorial" | "content";
  backPath?: string;
  availability: RouteAvailability;
  component: ComponentType;
}

export const viraRoutes = [
  { id: "home", index: true, pattern: "/", title: "Partidas", context: "World Cup", shellMode: "discovery", maxWidth: "full", availability: "available", component: LobbyScreen },
  { id: "match-preview", path: "match/:matchId/preview", pattern: "/match/:matchId/preview", title: "Briefing da partida", shellMode: "game", maxWidth: "full", backPath: "/", availability: "available", component: MatchPreviewScreen },
  { id: "match-room", path: "match/:matchId", pattern: "/match/:matchId", title: "Sala da partida", shellMode: "immersive", maxWidth: "full", availability: "available", component: MatchRoomScreen },
] satisfies ViraRouteDefinition[];

export function matchCurrentRoute(pathname: string) {
  return viraRoutes.find((route) => matchPath({ path: route.pattern, end: true }, pathname)) ?? viraRoutes[0];
}
