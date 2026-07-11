import type { ViraRouteDefinition } from "./route-manifest";

export type NavigationTransitionKind = "route" | "poster-to-preview" | "capsule-to-room" | "none";

export function resolveNavigationTransition(from: ViraRouteDefinition, to: ViraRouteDefinition): NavigationTransitionKind {
  if (from.id === "home" && to.id === "match-preview") return "poster-to-preview";
  if (from.id !== "match-room" && to.id === "match-room") return "capsule-to-room";
  if (to.shellMode === "immersive") return "none";
  return "route";
}
