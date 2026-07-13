import type {
  MatchSummary,
  MatchTxlineContext,
} from "../../runtime/api";

export type FeaturedSignal = {
  source: "suggested_prediction" | "available_market" | "match_result_draw";
  marketId: string;
  label: string;
  value: number;
  updatedAt: string | null;
  previousValue?: number;
  delta?: number;
  playable: boolean;
  prompt?: string;
  distribution: Array<{ id: string; label: string; value: number }>;
};

export type FeaturedMatchModel = {
  fixture: MatchSummary;
  signal:
    | { kind: "loading" }
    | { kind: "unavailable" }
    | { kind: "available"; value: FeaturedSignal };
  signalCount: number;
};

export function createFeaturedMatchModel(
  fixture: MatchSummary,
  context: MatchTxlineContext | null,
  contextState: "idle" | "loading" | "ready" | "error",
): FeaturedMatchModel {
  const signalCount = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  if (contextState === "loading" || contextState === "idle") return { fixture, signal: { kind: "loading" }, signalCount };
  const projection = fixture.consumerProjection;
  const canonical = projection?.availability.canShowMarket ? projection.market.canonical1X2 : null;
  const labels = { home: fixture.homeTeam, draw: "Empate", away: fixture.awayTeam };
  const signal = canonical ? {
    source: "available_market" as const,
    marketId: canonical.snapshotId ?? canonical.signature,
    label: labels[canonical.leadingChoice],
    value: canonical.selections[canonical.leadingChoice],
    updatedAt: canonical.observedAt,
    playable: projection?.availability.canPredict === true,
    prompt: projection?.availability.canMakeDirectionalClaim ? `${labels[canonical.leadingChoice]} lidera o mercado atual.` : undefined,
    distribution: (["home", "draw", "away"] as const).map((choice) => ({ id: choice, label: labels[choice], value: canonical.selections[choice] })),
  } : null;
  return { fixture, signal: signal ? { kind: "available", value: signal } : { kind: "unavailable" }, signalCount };
}
