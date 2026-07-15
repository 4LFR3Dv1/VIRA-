import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { canonicalHash } from "./vira-picks-market.mjs";
import { cloneFrozen, publicPicksCard, validateSelections } from "./vira-picks-contracts.mjs";
import { resolveSelectionV1 } from "./vira-picks-resolvers.mjs";
import { verifyRegularTimeScoreAuthorityV1 } from "./vira-picks-regular-time-authority.mjs";

const nowIso = () => new Date().toISOString();
const code = () => crypto.randomBytes(9).toString("base64url");
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export class ViraPicksStore {
  constructor({ dataDir = process.env.VIRA_DATA_DIR || path.join(process.cwd(), "data", "vira"), clock = () => Date.now() } = {}) {
    this.filePath = path.join(dataDir, "picks-v1.json"); this.tempPath = `${this.filePath}.tmp`; this.clock = clock;
    this.state = { schemaVersion: 1, cards: {}, cardsByCode: {}, snapshots: {}, resolutionSnapshots: {}, idempotency: {}, attributions: {}, events: [], metrics: {} };
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const raw = await fs.readFile(this.filePath, "utf8").catch((cause) => cause.code === "ENOENT" ? "" : Promise.reject(cause));
    if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    return this;
  }
  async mutate(operation) {
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.state); const result = await operation(draft);
      await fs.writeFile(this.tempPath, JSON.stringify(draft), "utf8"); await fs.rename(this.tempPath, this.filePath); this.state = draft;
      return cloneFrozen(result);
    });
    this.queue = run.catch(() => undefined); return run;
  }
  emit(state, type, card, extra = {}) {
    state.events.push({ schemaVersion: 1, id: `event_${crypto.randomUUID()}`, type, cardId: card.id, fixtureId: card.fixtureId, at: nowIso(), ...extra });
    state.events = state.events.slice(-20_000); state.metrics[type] = Number(state.metrics[type] ?? 0) + 1;
  }
  async confirm({ fixture, identity, selectionIds, idempotencyKey, locale, timeZone, snapshots }) {
    const parsed = validateSelections(selectionIds); const locksAt = String(fixture.startTime ?? "");
    if (!locksAt || !Number.isFinite(Date.parse(locksAt))) throw error("fixture_lock_authority_required", 409);
    if (fixture.status !== "scheduled") throw error("fixture_not_open_for_picks", 409);
    if (this.clock() >= Date.parse(locksAt)) throw error("picks_deadline_passed", 409);
    if (!identity?.publicId || !identity?.displayName) throw error("public_identity_required", 401);
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) throw error("invalid_idempotency_key");
    if (!Array.isArray(snapshots) || snapshots.length !== parsed.length || snapshots.some((item) => item?.freshness !== "fresh")) throw error("eligible_market_snapshot_required", 409);
    const requestHash = canonicalHash({ fixtureId: String(fixture.fixtureId), publicId: identity.publicId, selections: parsed });
    const key = `${identity.publicId}:${fixture.fixtureId}:${idempotencyKey}`;
    return this.mutate((state) => {
      const duplicate = state.idempotency[key];
      if (duplicate) {
        if (duplicate.requestHash !== requestHash) throw error("idempotency_conflict", 409);
        return state.cards[duplicate.cardId];
      }
      const confirmedAt = new Date(this.clock()).toISOString(); const id = `picks_${crypto.randomUUID()}`; const publicCode = code();
      for (const snapshot of snapshots) {
        if (snapshot.fixtureId !== String(fixture.fixtureId) || canonicalHash(Object.fromEntries(Object.entries(snapshot).filter(([name]) => !["id", "canonicalHash"].includes(name)))) !== snapshot.canonicalHash) throw error("invalid_market_snapshot", 409);
        state.snapshots[snapshot.canonicalHash] ??= snapshot;
      }
      const attribution = state.attributions[identity.publicId];
      const card = { schemaVersion: 1, id, publicCode, fixtureId: String(fixture.fixtureId), publicId: identity.publicId, displayName: String(identity.displayName).slice(0, 40), selections: parsed, status: "confirmed", confirmedAt, locksAt, locale: locale === "pt-BR" ? "pt-BR" : "en", timeZone: String(timeZone || "UTC"), marketSnapshotRefs: snapshots.map((item) => item.canonicalHash), resolutionPolicyVersion: 1, results: parsed.map((selection) => ({ selection, status: "pending" })), socialGroupId: attribution?.socialGroupId ?? publicCode };
      state.cards[id] = card; state.cardsByCode[publicCode] = id; state.idempotency[key] = { requestHash, cardId: id }; this.emit(state, "picks.confirmed", card);
      if (attribution) { state.metrics.friendsCreatedPicks = Number(state.metrics.friendsCreatedPicks ?? 0) + 1; delete state.attributions[identity.publicId]; }
      return card;
    });
  }
  owner(publicId, fixtureId) { const card = Object.values(this.state.cards).find((item) => item.publicId === publicId && item.fixtureId === String(fixtureId)); return card ? cloneFrozen(card) : null; }
  public(publicCode) {
    const card = this.state.cards[this.state.cardsByCode[String(publicCode)]]; if (!card) return null;
    const reveal = Boolean(card.shareConsentAt) || card.status !== "confirmed" || this.clock() >= Date.parse(card.locksAt);
    return publicPicksCard(card, { revealSelections: reveal });
  }
  async markShared(cardId, publicId) { return this.mutate((state) => { const card = state.cards[cardId]; if (!card || card.publicId !== publicId) throw error("picks_owner_required", 403); if (!card.shareConsentAt) { card.shareConsentAt = nowIso(); this.emit(state, "picks.shared", card); } return card; }); }
  async markOpened(publicCode, attribution = {}) { return this.mutate((state) => { const card = state.cards[state.cardsByCode[String(publicCode)]]; if (!card) throw error("picks_card_not_found", 404); if (attribution.publicId && attribution.publicId !== card.publicId) state.attributions[attribution.publicId] = { sourceCardId: card.id, socialGroupId: card.socialGroupId ?? card.publicCode, openedAt: nowIso() }; this.emit(state, "picks.opened", card, { attribution: { sourceCode: card.publicCode } }); return { accepted: true }; }); }
  async lockFixture(fixtureId, at = new Date(this.clock()).toISOString()) { return this.mutate((state) => { let count = 0; for (const card of Object.values(state.cards)) if (card.fixtureId === String(fixtureId) && card.status === "confirmed" && Date.parse(at) >= Date.parse(card.locksAt)) { card.status = "locked"; this.emit(state, "picks.locked", card); count++; } return { locked: count }; }); }
  async lockDueCards(at = new Date(this.clock()).toISOString()) {
    if (!Object.values(this.state.cards).some((card) => card.status === "confirmed" && Date.parse(at) >= Date.parse(card.locksAt))) return cloneFrozen({ locked: 0 });
    return this.mutate((state) => { let count = 0; for (const card of Object.values(state.cards)) if (card.status === "confirmed" && Date.parse(at) >= Date.parse(card.locksAt)) { card.status = "locked"; this.emit(state, "picks.locked", card); count++; } return { locked: count }; });
  }
  async voidFixture(fixtureId, reason, at = nowIso()) { return this.mutate((state) => { let count = 0; for (const card of Object.values(state.cards)) if (card.fixtureId === String(fixtureId) && !["resolved", "void"].includes(card.status)) { card.status = "void"; card.resolvedAt = at; card.results = card.selections.map((selection) => ({ selection, status: "void", resolvedAt: at, reason })); this.emit(state, "picks.voided", card, { reason }); count++; } return { voided: count }; }); }
  async resolveFixture(fixtureId, authority) {
    if (!verifyRegularTimeScoreAuthorityV1(authority, fixtureId, { now: this.clock() })) return { awaitingAuthority: true, resolved: 0 };
    const body = Object.fromEntries(Object.entries(authority).filter(([name]) => !["id", "canonicalHash"].includes(name)));
    const hash = authority.canonicalHash; const snapshot = authority;
    return this.mutate((state) => { state.resolutionSnapshots[hash] ??= snapshot; let count = 0; for (const card of Object.values(state.cards)) {
      if (card.fixtureId !== String(fixtureId) || ["resolved", "void"].includes(card.status)) continue;
      const resolvedAt = authority.observedAt; card.results = card.selections.map((selection) => { const result = resolveSelectionV1(selection, { homeScore: body.regularTimeScore.home, awayScore: body.regularTimeScore.away }); const item = { selection, status: result.status, resolvedAt, resolutionSnapshotRef: hash }; this.emit(state, "picks.selection_resolved", card, { kind: selection.kind, status: result.status, resolutionSnapshotRef: hash }); return item; });
      card.status = "resolved"; card.resolvedAt = resolvedAt; card.finalScore = { home: body.regularTimeScore.home, away: body.regularTimeScore.away }; this.emit(state, "picks.resolved", card, { resolutionSnapshotRef: hash }); count++;
    } return { resolved: count, resolutionSnapshotRef: hash }; });
  }
  metrics() { return cloneFrozen({ cardsConfirmed: this.state.metrics["picks.confirmed"] ?? 0, cardsShared: this.state.metrics["picks.shared"] ?? 0, sharesOpened: this.state.metrics["picks.opened"] ?? 0, friendsCreatedPicks: this.state.metrics.friendsCreatedPicks ?? 0, cardsLocked: this.state.metrics["picks.locked"] ?? 0, cardsResolved: this.state.metrics["picks.resolved"] ?? 0, cardsVoid: this.state.metrics["picks.voided"] ?? 0 }); }
}
export async function createViraPicksStore(options) { return new ViraPicksStore(options).init(); }
