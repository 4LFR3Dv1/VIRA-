import {
  fetchHistoricalScores,
  fetchOddsSnapshot,
  fetchOddsUpdates,
  fetchScoresSnapshot,
  fetchScoresUpdates,
} from "./txline-client.mjs";

function asRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object") return [];
  const arrayValue = Object.values(payload).find((value) => Array.isArray(value));
  return arrayValue ?? [payload];
}

function firstDefined(record, keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
  }
  return null;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function eventTypeOf(record) {
  const value = firstDefined(record, [
    "Action",
    "action",
    "SuperOddsType",
    "superOddsType",
    "EventType",
    "eventType",
    "type",
    "Type",
    "GameState",
    "gameState",
    "MarketType",
    "marketType",
    "Status",
    "status",
  ]);
  return value === null ? "unknown" : String(value).toLowerCase();
}

function summarizePayload(payload) {
  const records = asRecords(payload);
  const timestamps = records
    .map((record) => firstDefined(record, ["Ts", "ts", "Timestamp", "timestamp", "OccurredAt", "occurredAt", "StartTime", "startTime"]))
    .map(normalizeTimestamp)
    .filter(Boolean)
    .sort();
  const sequences = records
    .map((record) => Number(firstDefined(record, ["Seq", "seq", "Sequence", "sequence"])))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const eventTypes = new Map();
  for (const record of records) {
    const type = eventTypeOf(record);
    eventTypes.set(type, (eventTypes.get(type) ?? 0) + 1);
  }

  return {
    count: records.length,
    firstTimestamp: timestamps[0] ?? null,
    lastTimestamp: timestamps[timestamps.length - 1] ?? null,
    firstSequence: sequences[0] ?? null,
    lastSequence: sequences[sequences.length - 1] ?? null,
    eventTypes: Object.fromEntries([...eventTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function numberFromPercent(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function marketLabel(record) {
  const type = String(record?.SuperOddsType ?? "UNKNOWN_MARKET");
  const line = record?.MarketParameters ? ` ${record.MarketParameters}` : "";
  const period = record?.MarketPeriod ? ` · ${record.MarketPeriod}` : "";
  return `${type}${line}${period}`;
}

function optionLabel(priceName, match) {
  const value = String(priceName);
  if (value === "part1") return match?.homeTeam ?? "Home";
  if (value === "part2") return match?.awayTeam ?? "Away";
  if (value === "draw") return "Empate";
  if (value === "over") return "Over";
  if (value === "under") return "Under";
  return value;
}

function extractAvailableMarkets(payload, match, sourceEndpoint) {
  const markets = asRecords(payload)
    .map((record) => {
      const priceNames = Array.isArray(record?.PriceNames) ? record.PriceNames.map(String) : [];
      const pct = Array.isArray(record?.Pct) ? record.Pct.map(numberFromPercent) : [];
      const prices = Array.isArray(record?.Prices) ? record.Prices.map((value) => Number(value)).map((value) => Number.isFinite(value) ? value : null) : [];
      const options = priceNames.map((priceName, index) => ({
        priceName,
        label: optionLabel(priceName, match),
        pct: pct[index],
        price: prices[index],
      }));
      const numericOptions = options.filter((option) => typeof option.pct === "number");
      if (!record?.SuperOddsType || !options.length) return null;
      return {
        id: String(record.MessageId ?? `${record.FixtureId}-${record.SuperOddsType}-${record.MarketParameters ?? "default"}-${record.MarketPeriod ?? "match"}`),
        signature: [
          record.FixtureId ?? match?.fixtureId ?? "",
          record.SuperOddsType ?? "UNKNOWN_MARKET",
          record.MarketParameters ?? "default",
          record.MarketPeriod ?? "match",
          priceNames.join("/"),
          record.BookmakerId ?? record.Bookmaker ?? "TxLINE",
        ].join("|"),
        fixtureId: String(record.FixtureId ?? match?.fixtureId ?? ""),
        messageId: record.MessageId ? String(record.MessageId) : null,
        sequence: Number(firstDefined(record, ["Seq", "seq", "Sequence", "sequence"])) || null,
        marketType: String(record.SuperOddsType),
        label: marketLabel(record),
        bookmaker: String(record.Bookmaker ?? "TxLINE"),
        bookmakerId: record.BookmakerId ?? null,
        marketParameters: record.MarketParameters ?? null,
        marketPeriod: record.MarketPeriod ?? null,
        inRunning: Boolean(record.InRunning),
        capturedAt: normalizeTimestamp(record.Ts ?? record.ts) ?? null,
        sourceEndpoint,
        priceNames,
        options,
        hasProbabilities: numericOptions.length > 0,
        leadingOption: numericOptions.sort((left, right) => Number(right.pct) - Number(left.pct))[0] ?? null,
      };
    })
    .filter(Boolean);
  return dedupeMarkets(markets);
}

function dedupeMarkets(markets, limit = 24) {
  const sorted = [...markets]
    .sort((left, right) => {
      if (left.marketType === "1X2_PARTICIPANT_RESULT" && right.marketType !== "1X2_PARTICIPANT_RESULT") return -1;
      if (right.marketType === "1X2_PARTICIPANT_RESULT" && left.marketType !== "1X2_PARTICIPANT_RESULT") return 1;
      const probabilityDiff = Number(Boolean(right.hasProbabilities)) - Number(Boolean(left.hasProbabilities));
      if (probabilityDiff) return probabilityDiff;
      return Date.parse(right.capturedAt ?? "") - Date.parse(left.capturedAt ?? "");
    });
  const unique = new Map();
  for (const market of sorted) {
    if (!unique.has(market.signature)) unique.set(market.signature, market);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

export function selectCanonicalFixture1X2(markets, fixture) {
  const candidates = (markets ?? []).filter((market) => market.marketType === "1X2_PARTICIPANT_RESULT" && !market.marketPeriod && market.hasProbabilities);
  const market = [...candidates].sort((left, right) => Date.parse(right.capturedAt ?? "") - Date.parse(left.capturedAt ?? ""))[0] ?? null;
  if (!market) return null;
  const value = (priceName, fallbackIndex) => market.options.find((option) => option.priceName === priceName)?.pct ?? market.options[fallbackIndex]?.pct;
  const home = Number(value("part1", 0));
  const draw = Number(value("draw", 1));
  const away = Number(value("part2", 2));
  if (![home, draw, away].every(Number.isFinite)) return null;
  const values = { home, draw, away };
  const leadingChoice = Object.entries(values).sort((left, right) => right[1] - left[1])[0][0];
  return {
    authority: "txline_fixture_market",
    scope: "fixture",
    type: "MATCH_RESULT_1X2",
    fixtureId: String(fixture.fixtureId),
    marketSignature: market.signature,
    snapshotId: market.messageId ?? market.id,
    observedAt: market.capturedAt,
    providerSequence: market.sequence,
    bookmakerId: market.bookmakerId,
    selections: values,
    leadingChoice,
  };
}

function bestPredictionFromMarkets(markets) {
  const withProbabilities = markets.filter((market) => market.hasProbabilities && market.leadingOption);
  const oneXTwo = withProbabilities.find((market) => market.marketType === "1X2_PARTICIPANT_RESULT");
  const selected = oneXTwo ?? withProbabilities[0] ?? markets[0] ?? null;
  if (!selected?.leadingOption || typeof selected.leadingOption.pct !== "number") return null;
  const threshold = Math.ceil(selected.leadingOption.pct);
  return {
    marketId: selected.id,
    openingEventId: selected.messageId ?? selected.id,
    providerSequence: selected.sequence,
    marketSignature: selected.signature,
    marketType: selected.marketType,
    marketLabel: selected.label,
    bookmakerId: selected.bookmakerId,
    line: selected.marketParameters,
    period: selected.marketPeriod,
    priceName: selected.leadingOption.priceName,
    priceLabel: selected.leadingOption.label,
    pct: selected.leadingOption.pct,
    operator: ">=",
    threshold,
    prompt: `${selected.leadingOption.label} chega a ${threshold}% ou mais no proximo sinal?`,
    winningOption: selected.leadingOption.pct >= threshold ? "yes" : "no",
  };
}

function extractWinProbability(payload) {
  const records = asRecords(payload);
  const market = records.find((record) => record?.SuperOddsType === "1X2_PARTICIPANT_RESULT");
  const pct = Array.isArray(market?.Pct) ? market.Pct : null;
  if (!market || !pct || pct.length < 3) return null;

  const home = numberFromPercent(pct[0]);
  const draw = numberFromPercent(pct[1]);
  const away = numberFromPercent(pct[2]);
  if (home === null || draw === null || away === null) return null;

  return {
    marketType: String(market.SuperOddsType),
    bookmaker: String(market.Bookmaker ?? "TxLINE"),
    messageId: market.MessageId ? String(market.MessageId) : null,
    capturedAt: normalizeTimestamp(market.Ts ?? market.ts) ?? null,
    home,
    draw,
    away,
    priceNames: Array.isArray(market.PriceNames) ? market.PriceNames.map(String) : ["part1", "draw", "part2"],
  };
}

function latestRecords(payload, limit = 5) {
  return asRecords(payload)
    .slice(-limit)
    .map((record, index) => ({
      id: String(firstDefined(record, ["MessageId", "Id", "id", "Seq", "seq"]) ?? `record-${index}`),
      type: eventTypeOf(record),
      timestamp: normalizeTimestamp(firstDefined(record, ["Ts", "ts", "Timestamp", "timestamp", "OccurredAt", "occurredAt"])),
      sequence: Number(firstDefined(record, ["Seq", "seq", "Sequence", "sequence"])) || null,
    }));
}

async function readEndpoint({ name, endpoint, fetcher, config, fixtureId, projector }) {
  const requestedAt = new Date().toISOString();
  try {
    const payload = await fetcher(config, fixtureId);
    return {
      name,
      provider: "TxLINE",
      source: "txline",
      ok: true,
      endpoint,
      requestedAt,
      receivedAt: new Date().toISOString(),
      summary: summarizePayload(payload),
      data: projector ? projector(payload) : null,
    };
  } catch (error) {
    return {
      name,
      provider: "TxLINE",
      source: "txline",
      ok: false,
      endpoint,
      requestedAt,
      receivedAt: new Date().toISOString(),
      status: error.status ?? 500,
      error: error.message ?? "txline_error",
      summary: {
        count: 0,
        firstTimestamp: null,
        lastTimestamp: null,
        firstSequence: null,
        lastSequence: null,
        eventTypes: {},
      },
      data: null,
    };
  }
}

export async function buildTxlineContext(config, match) {
  const fixtureId = String(match.fixtureId);
  const [scores, updates, historical, odds, oddsUpdates] = await Promise.all([
    readEndpoint({
      name: "scores",
      endpoint: `/api/scores/snapshot/${fixtureId}`,
      fetcher: fetchScoresSnapshot,
      config,
      fixtureId,
      projector: (payload) => ({ latest: latestRecords(payload) }),
    }),
    readEndpoint({
      name: "score_updates",
      endpoint: `/api/scores/updates/${fixtureId}`,
      fetcher: fetchScoresUpdates,
      config,
      fixtureId,
      projector: (payload) => ({ latest: latestRecords(payload) }),
    }),
    readEndpoint({
      name: "historical_scores",
      endpoint: `/api/scores/historical/${fixtureId}`,
      fetcher: fetchHistoricalScores,
      config,
      fixtureId,
      projector: (payload) => ({ latest: latestRecords(payload) }),
    }),
    readEndpoint({
      name: "odds",
      endpoint: `/api/odds/snapshot/${fixtureId}`,
      fetcher: fetchOddsSnapshot,
      config,
      fixtureId,
      projector: (payload) => ({
        winProbability: extractWinProbability(payload),
        availableMarkets: extractAvailableMarkets(payload, match, `/api/odds/snapshot/${fixtureId}`),
        latest: latestRecords(payload),
      }),
    }),
    readEndpoint({
      name: "odds_updates",
      endpoint: `/api/odds/updates/${fixtureId}`,
      fetcher: fetchOddsUpdates,
      config,
      fixtureId,
      projector: (payload) => ({
        availableMarkets: extractAvailableMarkets(payload, match, `/api/odds/updates/${fixtureId}`),
        latest: latestRecords(payload),
      }),
    }),
  ]);
  const availableMarkets = [
    ...(oddsUpdates.data?.availableMarkets ?? []),
    ...(odds.data?.availableMarkets ?? []),
  ];
  const uniqueMarkets = dedupeMarkets(availableMarkets, 24);
  const canonical1X2 = selectCanonicalFixture1X2(uniqueMarkets, match);

  return {
    fixtureId,
    provider: "TxLINE",
    generatedAt: new Date().toISOString(),
    fixture: {
      provider: "TxLINE",
      source: match.source,
      fixtureId,
      title: match.title,
      competitionLabel: match.competitionLabel,
      competition: match.competition,
      status: match.status,
      startTime: match.startTime,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    },
    endpoints: {
      scores,
      updates,
      historical,
      odds,
      oddsUpdates,
    },
    availableMarkets: uniqueMarkets,
    canonical1X2,
    marketTaxonomy: {
      observed: uniqueMarkets.length,
      inFocus: Math.min(5, uniqueMarkets.length),
      canonical: canonical1X2 ? 1 : 0,
    },
    suggestedPrediction: bestPredictionFromMarkets(uniqueMarkets),
  };
}
