import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

type ConsumerProjection = {
  schemaVersion: number;
  fixture: { fixtureId: string; status: string; kickoffAt: string | null; homeTeam: { name: string }; awayTeam: { name: string } };
  temporal: { relation: string; timeZone: string; localKickoffDate: string | null; localKickoffTime: string | null };
  market: { canonical1X2: null | { observedAt: string | null; selections: { home: number; draw: number; away: number }; leadingChoice: "home" | "draw" | "away" }; freshness: { reason: string; usableForPrediction: boolean; currentForDisplay: boolean; currentForDirectionalClaim: boolean } };
  availability: { canPredict: boolean; canEnterRoom: boolean; canShowMarket: boolean; canMakeDirectionalClaim: boolean; reason: string };
};

type CatalogEntry = { fixtureId: string; consumerProjection: ConsumerProjection };
type Catalog = { version: number; featuredFixtureId: string; generatedAt: string; matches: CatalogEntry[] };

function commitId() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function percentage(value: number) {
  return `${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function safeMessage(value: string) {
  return value
    .replace(/(authorization|bearer|token|cookie|session|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function publicUrl(value: string) {
  try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return value.split("?")[0].slice(0, 300); }
}

async function bodyText(page: Page) {
  await expect(page.locator("body")).toBeVisible();
  return page.locator("body").innerText();
}

function assertProjectionContract(projection: ConsumerProjection) {
  expect(projection.schemaVersion).toBe(1);
  expect(projection.temporal.timeZone).toBeTruthy();
  expect(projection.fixture.kickoffAt).not.toBe(projection.market.canonical1X2?.observedAt ?? null);
  if (!projection.market.canonical1X2) {
    expect(projection.availability.canPredict).toBe(false);
    expect(projection.availability.canShowMarket).toBe(false);
  }
  if (projection.availability.canPredict) expect(projection.market.freshness.usableForPrediction).toBe(true);
  if (projection.availability.canShowMarket) expect(projection.market.freshness.currentForDisplay).toBe(true);
  if (projection.availability.canMakeDirectionalClaim) expect(projection.market.freshness.currentForDirectionalClaim).toBe(true);
}

async function assertFixtureFacts(page: Page, projection: ConsumerProjection, options: { homeSurface?: boolean; nowMs?: number } = {}) {
  await expect(page.locator("body")).toContainText(projection.fixture.homeTeam.name);
  await expect(page.locator("body")).toContainText(projection.fixture.awayTeam.name);
  const text = await bodyText(page);
  const relationCopy: Partial<Record<ConsumerProjection["temporal"]["relation"], RegExp>> = {
    live: /\blive\b|ao vivo/i,
    today: /\btoday\b|\bhoje\b/i,
    tomorrow: /\btomorrow\b|\bamanhã\b/i,
    finished: /\bfinished\b|encerrad[ao]/i,
  };
  const kickoffMs = Date.parse(projection.fixture.kickoffAt ?? "");
  const scheduledPastKickoff = projection.fixture.status === "scheduled" && Number.isFinite(kickoffMs) && kickoffMs <= (options.nowMs ?? Date.now());
  if (options.homeSurface && scheduledPastKickoff) expect(text).toMatch(/awaiting official update|aguardando atualização oficial/i);
  else {
    const expectedRelation = relationCopy[projection.temporal.relation];
    if (expectedRelation) expect(text).toMatch(expectedRelation);
  }
  if (projection.availability.canShowMarket && projection.market.canonical1X2) {
    expect(text).toMatch(/TxLINE market observed|Market score|1X2 distribution|Mercado TxLINE observado|Placar de mercado|Distribuicao 1X2|Distribuição 1X2/i);
    expect(text).toMatch(/draw|empate/i);
  }
}

async function writeEvidence(testInfo: TestInfo, evidence: object) {
  const fileName = `browser-smoke-${testInfo.project.name}.json`;
  const output = path.resolve("artifacts", fileName);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, serialized, "utf8");
  await testInfo.attach(fileName, { body: Buffer.from(serialized), contentType: "application/json" });
}

test("Home, Lobby and Preview preserve the deployed Consumer projection", async ({ page, request, baseURL }, testInfo) => {
  const runId = `browser-smoke-${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: Array<{ status: number; url: string }> = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(safeMessage(message.text())); });
  page.on("pageerror", (error) => pageErrors.push(safeMessage(error.message)));
  page.on("response", (response) => { if (response.status() >= 500) serverErrors.push({ status: response.status(), url: publicUrl(response.url()) }); });

  let passed = false;
  let buildId = "unknown";
  let catalog!: Catalog;
  let featured!: CatalogEntry;
  let previewEntry!: CatalogEntry;
  const checkedRoutes: string[] = [];
  try {
    const [rootResponse, catalogResponse, homeResponse] = await Promise.all([
      request.get("/"), request.get("/matches/catalog"), request.get("/home", { headers: { "X-Vira-Locale": "pt-BR", "X-Vira-Time-Zone": "America/Sao_Paulo" } }),
    ]);
    expect(rootResponse.ok()).toBe(true);
    expect(catalogResponse.ok()).toBe(true);
    expect(homeResponse.ok()).toBe(true);
    buildId = (await rootResponse.text()).match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? "unknown";
    catalog = await catalogResponse.json() as Catalog;
    const home = await homeResponse.json() as { editorial: { fixture: null | { fixtureId: string; consumerProjection: ConsumerProjection } } };
    expect(catalog.version).toBe(3);
    featured = catalog.matches.find((entry) => entry.fixtureId === catalog.featuredFixtureId)!;
    expect(featured).toBeTruthy();
    previewEntry = catalog.matches.find((entry) => entry.consumerProjection.availability.canShowMarket && !entry.consumerProjection.availability.canMakeDirectionalClaim)
      ?? catalog.matches.find((entry) => !entry.consumerProjection.availability.canShowMarket)
      ?? featured;
    for (const entry of catalog.matches) assertProjectionContract(entry.consumerProjection);
    if (home.editorial.fixture) {
      expect(home.editorial.fixture.fixtureId).toBe(featured.fixtureId);
      expect(home.editorial.fixture.consumerProjection.fixture.status).toBe(featured.consumerProjection.fixture.status);
      expect(home.editorial.fixture.consumerProjection.fixture.kickoffAt).toBe(featured.consumerProjection.fixture.kickoffAt);
      expect(home.editorial.fixture.consumerProjection.market.canonical1X2?.observedAt ?? null).toBe(featured.consumerProjection.market.canonical1X2?.observedAt ?? null);
    }

    const homeUiResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/home" && response.status() === 200);
    await page.goto("/?lang=en"); checkedRoutes.push("/?lang=en");
    const homeUi = await (await homeUiResponsePromise).json() as { editorial: { fixture: { consumerProjection: ConsumerProjection } | null } };
    const homeUiProjection = homeUi.editorial.fixture?.consumerProjection ?? featured.consumerProjection;
    await assertFixtureFacts(page, homeUiProjection, { homeSurface: true });
    const homeText = await bodyText(page);
    if (!homeUiProjection.availability.canMakeDirectionalClaim) expect(homeText).not.toMatch(/mercado atual\b|mercado agora\b|lidera o mercado|favorece/i);

    const lobbyCatalogPromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/matches/catalog" && response.status() === 200);
    await page.goto("/matches?lang=en"); checkedRoutes.push("/matches?lang=en");
    const lobbyCatalog = await (await lobbyCatalogPromise).json() as Catalog;
    featured = lobbyCatalog.matches.find((entry) => entry.fixtureId === lobbyCatalog.featuredFixtureId)!;
    await assertFixtureFacts(page, featured.consumerProjection);
    const lobbyText = await bodyText(page);
    if (!featured.consumerProjection.availability.canMakeDirectionalClaim) expect(lobbyText).not.toMatch(/mercado atual\b|mercado agora\b|lidera o mercado|favorece/i);

    previewEntry = lobbyCatalog.matches.find((entry) => entry.consumerProjection.availability.canShowMarket && !entry.consumerProjection.availability.canMakeDirectionalClaim)
      ?? lobbyCatalog.matches.find((entry) => !entry.consumerProjection.availability.canShowMarket)
      ?? featured;
    const previewCatalogPromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/matches/catalog" && response.status() === 200);
    await page.goto(`/match/${encodeURIComponent(previewEntry.fixtureId)}/preview?lang=en`); checkedRoutes.push(`/match/${previewEntry.fixtureId}/preview?lang=en`);
    const previewCatalog = await (await previewCatalogPromise).json() as Catalog;
    previewEntry = previewCatalog.matches.find((entry) => entry.fixtureId === previewEntry.fixtureId) ?? previewEntry;
    await assertFixtureFacts(page, previewEntry.consumerProjection);
    const previewText = await bodyText(page);
    if (!previewEntry.consumerProjection.availability.canMakeDirectionalClaim) {
      expect(previewText).not.toMatch(/líder atual do mercado|lider atual do mercado|mercado agora|lidera o mercado atual|favorece/i);
      if (previewEntry.consumerProjection.availability.canShowMarket) expect(previewText).toMatch(/last observed market|último mercado observado/i);
    }
    const roomButton = page.getByRole("button", { name: /Join room|Enter room|Entrar na sala/i });
    const roomButtonCount = await roomButton.count();
    expect(roomButtonCount).toBeGreaterThan(0);
    for (let index = 0; index < roomButtonCount; index += 1) {
      if (previewEntry.consumerProjection.availability.canEnterRoom) await expect(roomButton.nth(index)).toBeEnabled();
      else await expect(roomButton.nth(index)).toBeDisabled();
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
    passed = true;
  } finally {
    await writeEvidence(testInfo, {
      schemaVersion: 1,
      kind: "VIRA_DEPLOYMENT_BROWSER_READONLY_SMOKE",
      runId,
      target: baseURL,
      commit: process.env.VIRA_SMOKE_COMMIT ?? commitId(),
      buildId,
      project: testInfo.project.name,
      emulation: testInfo.project.name === "chromium-mobile-viewport" ? "Chromium mobile viewport emulation; not Safari or real-device evidence" : "Chromium desktop",
      readOnly: true,
      passed,
      checkedRoutes,
      catalogSchema: catalog?.version ?? null,
      projectionSchema: 1,
      featuredFixtureId: featured?.fixtureId ?? null,
      previewFixtureId: previewEntry?.fixtureId ?? null,
      consoleErrors,
      pageErrors,
      serverErrors,
      security: { requestHeadersArchived: false, tokensArchived: false, traceDisabledToAvoidHeaderCapture: true },
    });
  }
});
