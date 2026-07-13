import type {
  MatchSummary,
  MatchTxlineContext,
} from "../../runtime/api";

export type FeaturedSignal = {
  source: "suggested_prediction" | "available_market" | "match_result_draw";
  marketId: string;
  leadingChoice: "home" | "draw" | "away";
  value: number;
  updatedAt: string | null;
  previousValue?: number;
  delta?: number;
  playable: boolean;
  directionalClaimAllowed: boolean;
  ageSeconds: number | null;
  distribution: Array<{ id: "home" | "draw" | "away"; value: number }>;
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
  const signal = canonical ? {
    source: "available_market" as const,
    marketId: canonical.snapshotId ?? canonical.signature,
    leadingChoice: canonical.leadingChoice,
    value: canonical.selections[canonical.leadingChoice],
    updatedAt: canonical.observedAt,
    playable: projection?.availability.canPredict === true,
    directionalClaimAllowed: projection?.availability.canMakeDirectionalClaim === true,
    ageSeconds: projection?.market.freshness.ageSeconds ?? null,
    distribution: (["home", "draw", "away"] as const).map((choice) => ({ id: choice, value: canonical.selections[choice] })),
  } : null;
  return { fixture, signal: signal ? { kind: "available", value: signal } : { kind: "unavailable" }, signalCount };
}
