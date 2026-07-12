import type {
  MatchSummary,
  MatchTxlineContext,
  TxlineAvailableMarket,
  TxlineSuggestedPrediction,
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

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function distributionFromMarket(market: TxlineAvailableMarket) {
  return market.options
    .filter((option) => finite(option.pct))
    .map((option) => ({ id: option.priceName, label: option.label, value: option.pct as number }));
}

function movementForMarket(
  context: MatchTxlineContext,
  market: TxlineAvailableMarket | undefined,
  priceName: string,
  currentValue: number,
) {
  if (!market) return {};
  const previous = context.availableMarkets
    .filter((candidate) => candidate.signature === market.signature && candidate.id !== market.id)
    .sort((a, b) => (b.sequence ?? -1) - (a.sequence ?? -1))
    .map((candidate) => candidate.options.find((option) => option.priceName === priceName)?.pct)
    .find(finite);
  return previous === undefined ? {} : { previousValue: previous, delta: currentValue - previous };
}

function fromPrediction(prediction: TxlineSuggestedPrediction, context: MatchTxlineContext): FeaturedSignal | null {
  if (!finite(prediction.pct)) return null;
  const market = context.availableMarkets.find((candidate) => candidate.id === prediction.marketId);
  return {
    source: "suggested_prediction",
    marketId: prediction.marketId,
    label: prediction.priceLabel,
    value: prediction.pct,
    updatedAt: market?.capturedAt ?? context.generatedAt,
    playable: true,
    prompt: `${prediction.priceLabel} lidera a leitura atual do mercado.`,
    distribution: market ? distributionFromMarket(market) : [],
    ...movementForMarket(context, market, prediction.priceName, prediction.pct),
  };
}

function marketScore(market: TxlineAvailableMarket) {
  const label = `${market.marketType} ${market.label}`.toLowerCase();
  let score = market.hasProbabilities ? 30 : 0;
  if (market.inRunning) score += 12;
  if (label.includes("result") || label.includes("1x2") || label.includes("winner")) score += 28;
  if (label.includes("total") || label.includes("goal")) score += 14;
  if (market.capturedAt) score += 6;
  return score;
}

function fromAvailableMarket(context: MatchTxlineContext): FeaturedSignal | null {
  const market = [...context.availableMarkets]
    .filter((candidate) => candidate.hasProbabilities && finite(candidate.leadingOption?.pct))
    .sort((a, b) => marketScore(b) - marketScore(a))[0];
  if (!market?.leadingOption || !finite(market.leadingOption.pct)) return null;
  return {
    source: "available_market",
    marketId: market.id,
    label: market.leadingOption.label,
    value: market.leadingOption.pct,
    updatedAt: market.capturedAt,
    playable: false,
    distribution: distributionFromMarket(market),
    ...movementForMarket(context, market, market.leadingOption.priceName, market.leadingOption.pct),
  };
}

function drawSignal(context: MatchTxlineContext): FeaturedSignal | null {
  const market = context.endpoints.odds.data?.winProbability;
  if (!market || !finite(market.draw)) return null;
  return {
    source: "match_result_draw",
    marketId: market.messageId ?? "match-result",
    label: "Empate",
    value: market.draw,
    updatedAt: market.capturedAt,
    playable: false,
    distribution: [
      { id: "home", label: context.fixture.homeTeam, value: market.home },
      { id: "draw", label: "Empate", value: market.draw },
      { id: "away", label: context.fixture.awayTeam, value: market.away },
    ].filter((option) => finite(option.value)),
  };
}

export function selectFeaturedSignal(context: MatchTxlineContext): FeaturedSignal | null {
  if (context.canonical1X2) {
    const market = context.canonical1X2;
    const labels = { home: context.fixture.homeTeam, draw: "Empate", away: context.fixture.awayTeam };
    return { source: "available_market", marketId: market.snapshotId, label: labels[market.leadingChoice], value: market.selections[market.leadingChoice], updatedAt: market.observedAt, playable: false, distribution: (["home", "draw", "away"] as const).map((choice) => ({ id: choice, label: labels[choice], value: market.selections[choice] })) };
  }
  const prediction = context.suggestedPrediction ? fromPrediction(context.suggestedPrediction, context) : null;
  return prediction ?? fromAvailableMarket(context) ?? drawSignal(context);
}

export function createFeaturedMatchModel(
  fixture: MatchSummary,
  context: MatchTxlineContext | null,
  contextState: "idle" | "loading" | "ready" | "error",
): FeaturedMatchModel {
  const signalCount = context?.marketTaxonomy?.observed ?? context?.availableMarkets.length ?? 0;
  if (contextState === "loading" || contextState === "idle") return { fixture, signal: { kind: "loading" }, signalCount };
  const signal = context ? selectFeaturedSignal(context) : null;
  return { fixture, signal: signal ? { kind: "available", value: signal } : { kind: "unavailable" }, signalCount };
}
