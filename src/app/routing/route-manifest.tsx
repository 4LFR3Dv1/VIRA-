import type { ComponentType } from "react";
import { matchPath } from "react-router";

import { LobbyScreen } from "../../features/lobby/LobbyScreen";
import { HomeScreen } from "../../features/home/HomeScreen";
import { HelpScreen } from "../../features/help/HelpScreen";
import { MatchPreviewScreen } from "../../features/match-preview/MatchPreviewScreen";
import { MatchRoomScreen } from "../../features/match-room/MatchRoomScreen";
import { CompanionRouteScreen } from "../../features/companion/CompanionRouteScreen.tsx";
import { VIRA_VISUAL_COMPANION_ENABLED } from "../../features/companion/feature-flags.ts";
import { ViraPicksScreen } from "../../features/picks/ViraPicksScreen.tsx";
import { VIRA_PICKS_ENABLED } from "../../features/picks/feature-flags.ts";
import type { StaticTranslationKey } from "../../i18n/translate.ts";

export type ShellMode = "discovery" | "game" | "immersive";
export type RouteAvailability = "available" | "feature_flag" | "planned";

export interface ViraRouteDefinition {
  id: "home" | "help" | "matches" | "match-preview" | "match-room" | "match-companion" | "match-picks";
  index?: boolean;
  path?: string;
  pattern: string;
  titleKey: StaticTranslationKey;
  contextKey?: StaticTranslationKey;
  shellMode: ShellMode;
  maxWidth: "full" | "editorial" | "content";
  backPath?: string;
  availability: RouteAvailability;
  component: ComponentType;
}

export const viraRoutes = [
  { id: "home", index: true, pattern: "/", titleKey: "route.home.title", contextKey: "route.home.context", shellMode: "discovery", maxWidth: "full", availability: "available", component: HomeScreen },
  { id: "help", path: "help", pattern: "/help", titleKey: "route.help.title", contextKey: "route.help.context", shellMode: "discovery", maxWidth: "full", availability: "available", component: HelpScreen },
  { id: "matches", path: "matches", pattern: "/matches", titleKey: "route.matches.title", contextKey: "route.matches.context", shellMode: "discovery", maxWidth: "full", availability: "available", component: LobbyScreen },
  { id: "match-preview", path: "match/:matchId/preview", pattern: "/match/:matchId/preview", titleKey: "route.matchPreview.title", shellMode: "game", maxWidth: "full", backPath: "/matches", availability: "available", component: MatchPreviewScreen },
  ...(VIRA_PICKS_ENABLED ? [{ id: "match-picks" as const, path: "picks/:fixtureId", pattern: "/picks/:fixtureId", titleKey: "route.matchPreview.title" as const, shellMode: "game" as const, maxWidth: "full" as const, backPath: "/matches", availability: "feature_flag" as const, component: ViraPicksScreen }] : []),
  ...(VIRA_VISUAL_COMPANION_ENABLED ? [{ id: "match-companion" as const, path: "match/:matchId/companion", pattern: "/match/:matchId/companion", titleKey: "route.matchCompanion.title" as const, shellMode: "immersive" as const, maxWidth: "full" as const, backPath: "/matches", availability: "feature_flag" as const, component: CompanionRouteScreen }] : []),
  { id: "match-room", path: "match/:matchId", pattern: "/match/:matchId", titleKey: "route.matchRoom.title", shellMode: "immersive", maxWidth: "full", availability: "available", component: MatchRoomScreen },
] satisfies ViraRouteDefinition[];

export function matchCurrentRoute(pathname: string) {
  return viraRoutes.find((route) => matchPath({ path: route.pattern, end: true }, pathname)) ?? viraRoutes[0];
}
