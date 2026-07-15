import assert from "node:assert/strict";
import test from "node:test";
import { renderSharePng } from "./share-image-png.mjs";
import { renderShareSvg } from "./share-image-svg.mjs";
import { renderSharePage } from "./share-page.mjs";

const share = (kind, locale = "en") => ({ publicCode: `code-${kind}`, kind, editorialContext: { locale, timeZone: "America/Sao_Paulo" }, metadata: { title: "Ana · VIRA Picks", description: locale === "en" ? "Social predictions. No money involved." : "Previsões sociais. Sem dinheiro envolvido." }, destination: { path: "/picks/fixture-1?card=card-1", ctaLabel: locale === "en" ? "Make your picks" : "Faça suas previsões" }, payload: { displayName: "Ana", homeTeam: "France", awayTeam: "Spain", homeScore: 2, awayScore: 1, selections: [{ kind: "match_result", selection: "home" }, { kind: "total_goals", selection: "over" }], results: [{ status: "correct" }, { status: "correct" }] } });

test("picks and picks_result render bilingual 1200x630 SVG and PNG without secrets", () => {
  for (const kind of ["picks", "picks_result"]) for (const locale of ["en", "pt-BR"]) {
    const input = share(kind, locale); const svg = renderShareSvg(input); const png = renderSharePng(input);
    assert.match(svg, /width="1200" height="630"/); assert.match(svg, locale === "en" ? /NO MONEY INVOLVED/ : /SEM DINHEIRO ENVOLVIDO/);
    assert.equal(png.subarray(1, 4).toString(), "PNG"); assert.ok(png.length > 10_000);
    assert.doesNotMatch(svg, /token|authorization|credential|participantId/i);
  }
});

test("picks landing preserves locale, attribution destination and dedicated social copy", () => {
  const html = renderSharePage({ share: share("picks", "pt-BR"), base: "https://vira.test" });
  assert.match(html, /Previsões sociais\. Sem dinheiro envolvido\./); assert.match(html, /\/picks\/fixture-1\?card=card-1&amp;invite=code-picks&amp;lang=pt-BR/);
  assert.doesNotMatch(html, /ranking juntos|wallet or installation/);
});
