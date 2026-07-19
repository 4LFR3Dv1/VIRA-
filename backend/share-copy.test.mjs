import assert from "node:assert/strict";
import test from "node:test";

import { predictionShareCopy, resolveShareLocaleContext, roomShareCopy } from "../shared/share-copy.mjs";
import { canonicalMarketSelectionLabel, canonicalOutcomeSelection } from "../shared/canonical-market-copy.mjs";
import { renderShareSvg } from "./share-image-svg.mjs";
import { txlineContextInternals } from "./txline-context.mjs";

const fixture = { homeTeam: "France", awayTeam: "Spain" };

test("legacy shares use the explicit compatible PT-BR context", () => {
  assert.deepEqual(resolveShareLocaleContext({}), { locale: "pt-BR", timeZone: "America/Sao_Paulo", source: "legacy_default" });
});

test("prediction share copy is materialized in the creator locale", () => {
  const editorialContext = { locale: "en", timeZone: "America/Sao_Paulo", temporalRelationAtCreation: "tomorrow", localKickoffDate: "Jul 14, 2026", localKickoffTime: "4:00 PM" };
  const copy = predictionShareCopy({ fixture, displayName: "Ana", choice: "draw", choiceLabel: "Empate", editorialContext });
  assert.equal(copy.metadata.title, "Ana is backing Draw. Who are you with?");
  assert.match(copy.metadata.description, /Who wins tomorrow\?/);
  assert.equal(copy.ctaLabel, "Make my pick");
});

test("room share copy localizes VIRA copy without changing participant or team names", () => {
  const snapshot = { match: { status: "live", homeTeam: { name: "France" }, awayTeam: { name: "Spain" } }, roomPopulation: 2 };
  const copy = roomShareCopy({ snapshot, participant: { displayName: "João" }, locale: "en", kind: "room" });
  assert.equal(copy.metadata.title, "João opened France x Spain. Are you in?");
  assert.match(copy.metadata.description, /Live match · 2 in the room/);
  assert.equal(copy.ctaLabel, "Join the room");
});

test("Home, Preview and Room derive labels from canonical selections instead of provider copy", () => {
  const poisonedProviderOption = { priceName: "draw", label: "Empate" };
  for (const surface of ["Home", "Preview", "Room"]) {
    assert.equal(canonicalMarketSelectionLabel(poisonedProviderOption.priceName, { locale: "en", homeTeam: fixture.homeTeam, awayTeam: fixture.awayTeam }), "Draw", surface);
    assert.equal(canonicalMarketSelectionLabel(poisonedProviderOption.priceName, { locale: "pt-BR", homeTeam: "França", awayTeam: "Espanha" }), "Empate", surface);
  }
  assert.equal(canonicalMarketSelectionLabel(canonicalOutcomeSelection("home"), { locale: "pt-BR", homeTeam: "França" }), "França");
  assert.equal(canonicalMarketSelectionLabel("over", { locale: "pt-BR" }), "Mais");
  assert.equal(canonicalMarketSelectionLabel("under", { locale: "en" }), "Under");
  assert.equal(canonicalMarketSelectionLabel("empate", { locale: "en" }), null);
});

test("TxLINE consumer context transports canonical option values without localized labels", () => {
  const payload = [{ FixtureId: "fixture-1", MessageId: "m1", SuperOddsType: "1X2_PARTICIPANT_RESULT", PriceNames: ["part1", "draw", "part2"], Pct: [25, 50, 25], Prices: [4, 2, 4], ProviderLabel: "Empate", Ts: "2026-07-19T12:00:00.000Z" }];
  const markets = txlineContextInternals.extractAvailableMarkets(payload, { fixtureId: "fixture-1", ...fixture }, "/api/odds/snapshot/fixture-1");
  const prediction = txlineContextInternals.bestPredictionFromMarkets(markets);
  assert.deepEqual(markets[0].options.map((option) => option.priceName), ["part1", "draw", "part2"]);
  assert.equal(markets[0].options.some((option) => "label" in option), false);
  assert.equal("priceLabel" in prediction, false);
  assert.equal("prompt" in prediction, false);
  assert.equal(prediction.priceName, "draw");
});

test("share copy and SVG ignore a poisoned choiceLabel", () => {
  const editorialContext = { locale: "en", timeZone: "UTC", temporalRelationAtCreation: "today" };
  const copy = predictionShareCopy({ fixture, displayName: "Ana", choice: "draw", choiceLabel: "Empate", editorialContext });
  assert.match(copy.metadata.title, /Draw/);
  assert.doesNotMatch(copy.metadata.title, /Empate/);
  const svg = renderShareSvg({ kind: "prediction", editorialContext, destination: { ctaLabel: "Make my pick" }, payload: { ...fixture, displayName: "Ana", choice: "draw", choiceLabel: "Empate" } });
  assert.match(svg, /DRAW/);
  assert.doesNotMatch(svg, /EMPATE/);
});
