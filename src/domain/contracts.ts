import type { ReplayScript } from "./types";

export const DEFAULT_MATCH_ID = "bra-arg-demo";

export const REPLAY_SPEEDS = [0.5, 1, 2] as const;

export function formatMatchClock(matchClockSec: number): string {
  const minutes = Math.floor(matchClockSec / 60);
  const seconds = matchClockSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function percentageFromDistribution(distribution: Record<string, number>, optionId: string): number {
  const total = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  if (!total) {
    return 0;
  }
  return Math.round(((distribution[optionId] ?? 0) / total) * 100);
}

export function isReplayScript(value: unknown): value is ReplayScript {
  return Boolean(
    value
      && typeof value === "object"
      && "matchId" in value
      && "steps" in value,
  );
}

