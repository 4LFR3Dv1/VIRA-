import assert from "node:assert/strict";
import test from "node:test";
import { renderSharePng } from "./share-image-png.mjs";
import { renderShareSvg } from "./share-image-svg.mjs";
import { renderSharePage } from "./share-page.mjs";

test("share renderer produces a real 1200x630 PNG", () => {
  const png = renderSharePng({ kind: "prediction", metadata: { title: "Bob escolheu France" }, destination: { ctaLabel: "Fazer meu palpite" }, payload: { homeTeam: "France", awayTeam: "Spain" } });
  assert.deepEqual([...png.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length > 5_000);
});

test("prediction, invite and result cards have distinct consumer compositions", () => {
  const base = { publicCode: "share01", metadata: { title: "Ana picked France", description: "France x Spain" }, destination: { path: "/match/fixture", ctaLabel: "Open" }, editorialContext: { locale: "en", timeZone: "America/Sao_Paulo" } };
  const prediction = renderShareSvg({ ...base, kind: "prediction", payload: { homeTeam: "France", awayTeam: "Spain", choiceLabel: "France" } });
  const room = renderShareSvg({ ...base, kind: "room", payload: { homeTeam: "France", awayTeam: "Spain", participantCount: 2, fixtureStatus: "live" } });
  const result = renderShareSvg({ ...base, kind: "result", payload: { homeTeam: "France", awayTeam: "Spain", homeScore: 2, awayScore: 1, points: 100, rank: 1, correct: true, verified: true } });
  assert.match(prediction, /MATCH PICK/); assert.match(prediction, /KICKOFF/);
  assert.match(room, /LIVE ROOM/); assert.match(room, /NO ACCOUNT · NO X · NO WALLET/);
  assert.match(result, /MATCH RESULT/); assert.match(result, /REPRODUCIBLE RESULT/);
  assert.notEqual(prediction, room); assert.notEqual(room, result);
});

test("share landing preserves locale and invite while exposing official reassurance", () => {
  const share = { publicCode: "share01", kind: "room", metadata: { title: "Join Ana", description: "France x Spain" }, destination: { path: "/match/fixture?source=friend#room", ctaLabel: "Join room" }, editorialContext: { locale: "en", timeZone: "America/Sao_Paulo" } };
  const html = renderSharePage({ share, base: "https://vira.example" });
  assert.match(html, /<html lang="en">/);
  assert.match(html, /invite=share01&amp;lang=en#room/);
  assert.match(html, /no account, X, wallet or installation/i);
  assert.match(html, /Sports data and match authority powered by TxLINE/);
  assert.match(html, /\/vira-icon\.png/);
});
