import assert from "node:assert/strict";
import test from "node:test";

import { formatDateTime, formatNumber, formatPercent } from "./formatters.ts";
import {
  LOCALE_STORAGE_KEY,
  applyDocumentLocale,
  localeFromSearch,
  normalizeLocale,
  persistLocale,
  readPersistedLocale,
  resolveLocale,
  withLocaleInUrl,
} from "./locale.ts";
import { catalogs, translate } from "./translate.ts";

test("catalogs expose the same complete key set without raw-key fallbacks", () => {
  const enKeys = Object.keys(catalogs.en).sort();
  const ptKeys = Object.keys(catalogs["pt-BR"]).sort();
  assert.deepEqual(enKeys, ptKeys);
  assert.ok(enKeys.length >= 100);

  const params = { language: "English", count: 2, name: "Ana", selection: "France", homeTeam: "France", awayTeam: "Spain", dateTime: "14 Jul · 16:00" };
  for (const locale of ["en", "pt-BR"]) {
    for (const key of enKeys) {
      const message = catalogs[locale][key];
      const rendered = typeof message === "function" ? message(params) : message;
      assert.notEqual(rendered, key);
      assert.ok(rendered.length > 0);
    }
  }
});

test("locale aliases normalize conservatively", () => {
  for (const alias of ["pt", "pt-br", "pt_BR", "PT-BR"]) assert.equal(normalizeLocale(alias), "pt-BR");
  for (const alias of ["en", "en-US", "en-GB", "EN_us"]) assert.equal(normalizeLocale(alias), "en");
  assert.equal(normalizeLocale("es"), null);
  assert.equal(localeFromSearch("?room=abc&lang=pt_BR"), "pt-BR");
});

test("locale resolution follows URL, storage, browser, then English fallback", () => {
  assert.deepEqual(resolveLocale({ search: "?lang=en", storedLocale: "pt-BR", browserLocales: ["pt-BR"] }), { locale: "en", source: "url" });
  assert.deepEqual(resolveLocale({ search: "?lang=invalid", storedLocale: "pt-BR", browserLocales: ["en-US"] }), { locale: "pt-BR", source: "storage" });
  assert.deepEqual(resolveLocale({ storedLocale: "invalid", browserLocales: ["es", "pt"] }), { locale: "pt-BR", source: "browser" });
  assert.deepEqual(resolveLocale({ browserLocales: ["es"] }), { locale: "en", source: "fallback" });
});

test("locale persistence degrades safely when storage is unavailable", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(persistLocale(storage, "pt-BR"), true);
  assert.equal(values.get(LOCALE_STORAGE_KEY), "pt-BR");
  assert.equal(readPersistedLocale(storage), "pt-BR");

  const unavailable = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readPersistedLocale(unavailable), null);
  assert.equal(persistLocale(unavailable, "en"), false);
});

test("locale URL updates preserve route, room parameters and hash", () => {
  assert.equal(
    withLocaleInUrl("https://vira.test/match/room-7?invite=abc&lang=pt-BR#ranking", "en"),
    "/match/room-7?invite=abc&lang=en#ranking",
  );
});

test("document language and translated interpolation/plurals are deterministic", () => {
  const documentLike = { documentElement: { lang: "" } };
  applyDocumentLocale(documentLike, "pt-BR");
  assert.equal(documentLike.documentElement.lang, "pt-BR");

  assert.equal(translate("en")("room.playersWaiting", { count: 1 }), "1 player waiting");
  assert.equal(translate("en")("room.playersWaiting", { count: 2 }), "2 players waiting");
  assert.equal(translate("pt-BR")("room.playersWaiting", { count: 1 }), "1 jogador aguardando");
  assert.equal(translate("pt-BR")("room.playersWaiting", { count: 2 }), "2 jogadores aguardando");
  assert.equal(translate("en")("share.userPicked", { name: "Ana", selection: "France" }), "Ana picked France");
  assert.equal(translate("pt-BR")("share.userPicked", { name: "Ana", selection: "France" }), "Ana escolheu France");
});

test("formatters localize presentation while requiring an independent timezone", () => {
  assert.equal(formatNumber("en", 1234.5), "1,234.5");
  assert.equal(formatNumber("pt-BR", 1234.5), "1.234,5");
  assert.equal(formatPercent("en", 0.51), "51%");
  assert.equal(formatPercent("pt-BR", 0.51), "51%");

  const instant = "2026-07-14T19:00:00.000Z";
  const options = { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false };
  assert.match(formatDateTime("en", instant, options), /16:00/);
  assert.match(formatDateTime("pt-BR", instant, options), /16:00/);
  assert.doesNotMatch(formatDateTime("en", instant, { ...options, timeZone: "Asia/Tokyo" }), /16:00/);
});
