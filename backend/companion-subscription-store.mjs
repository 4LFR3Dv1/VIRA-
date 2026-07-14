import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ATTENTION_TYPES = ["match_starting", "match_live", "round_open", "round_locked", "round_resolved", "rank_changed"];
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const nowIso = () => new Date().toISOString();

function normalizeTypes(values) {
  const requested = Array.isArray(values) ? values : [];
  return [...new Set(requested.filter((value) => ATTENTION_TYPES.includes(value)))];
}

function normalizeSubscription(input) {
  const endpoint = String(input?.endpoint ?? "");
  const p256dh = String(input?.keys?.p256dh ?? "");
  const auth = String(input?.keys?.auth ?? "");
  if (!endpoint.startsWith("https://") || !p256dh || !auth) throw Object.assign(new Error("invalid_push_subscription"), { status: 400 });
  return { endpoint, expirationTime: Number.isFinite(input.expirationTime) ? input.expirationTime : null, keys: { p256dh, auth } };
}

function publicState(subscription) {
  if (!subscription) return null;
  const { pushSubscription: _pushSubscription, participantId: _participantId, ...safe } = clone(subscription);
  return safe;
}

export class CompanionSubscriptionStore {
  constructor({ dataDir = process.env.VIRA_DATA_DIR || path.join(process.cwd(), "data", "vira") } = {}) {
    this.filePath = path.join(dataDir, "companion-subscriptions.json");
    this.tempPath = `${this.filePath}.tmp`;
    this.state = { version: 1, subscriptions: {}, deliveries: {} };
    this.queue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const raw = await fs.readFile(this.filePath, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    return this;
  }
  async mutate(operation) {
    const run = this.queue.then(async () => {
      const result = await operation(this.state);
      await fs.writeFile(this.tempPath, JSON.stringify(this.state), "utf8");
      await fs.rename(this.tempPath, this.filePath);
      return clone(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  async register(input) {
    const pushSubscription = normalizeSubscription(input.pushSubscription);
    const endpointHash = hash(`VIRA:PUSH:ENDPOINT:${pushSubscription.endpoint}`);
    const locale = input.locale === "pt-BR" ? "pt-BR" : "en";
    const enabledTypes = normalizeTypes(input.enabledTypes);
    return this.mutate((state) => {
      let subscription = Object.values(state.subscriptions).find((entry) => entry.endpointHash === endpointHash && entry.participantId === input.participantId);
      const now = nowIso();
      if (!subscription) {
        subscription = { id: `companion_${crypto.randomUUID()}`, version: 1, createdAt: now };
        state.subscriptions[subscription.id] = subscription;
      }
      Object.assign(subscription, { pushSubscription, endpointHash, fixtureId: String(input.fixtureId), roomId: String(input.roomId), participantId: String(input.participantId), locale, timeZone: String(input.timeZone || "UTC"), inviteCode: /^[A-Za-z0-9_-]{4,80}$/.test(String(input.inviteCode ?? "")) ? String(input.inviteCode) : null, enabledTypes, active: true, followed: true, updatedAt: now, lastUsedAt: now, revokedAt: null });
      return publicState(subscription);
    });
  }
  get(id, participantId) {
    const subscription = this.state.subscriptions[String(id)];
    return subscription?.participantId === participantId ? publicState(subscription) : null;
  }
  async update(id, participantId, patch) {
    return this.mutate((state) => {
      const subscription = state.subscriptions[String(id)];
      if (!subscription || subscription.participantId !== participantId) throw Object.assign(new Error("subscription_not_found"), { status: 404 });
      if (patch.enabledTypes) subscription.enabledTypes = normalizeTypes(patch.enabledTypes);
      if (patch.locale) subscription.locale = patch.locale === "pt-BR" ? "pt-BR" : "en";
      if (patch.timeZone) subscription.timeZone = String(patch.timeZone).slice(0, 80);
      if (typeof patch.followed === "boolean") subscription.followed = patch.followed;
      subscription.updatedAt = nowIso(); subscription.lastUsedAt = subscription.updatedAt;
      return publicState(subscription);
    });
  }
  async remove(id, participantId) {
    return this.mutate((state) => {
      const subscription = state.subscriptions[String(id)];
      if (!subscription || subscription.participantId !== participantId) return { removed: false };
      subscription.active = false; subscription.followed = false; subscription.revokedAt = nowIso(); subscription.updatedAt = subscription.revokedAt;
      delete subscription.pushSubscription;
      return { removed: true };
    });
  }
  activeSubscriptions() {
    const now = Date.now();
    return Object.values(this.state.subscriptions).filter((entry) => entry.active && entry.followed && entry.pushSubscription && (!entry.pushSubscription.expirationTime || entry.pushSubscription.expirationTime > now)).map(clone);
  }
  async reserveDelivery(subscriptionId, eventId, ttlSeconds) {
    return this.mutate((state) => {
      for (const [deliveryKey, delivery] of Object.entries(state.deliveries)) {
        if (Date.parse(delivery.expiresAt) <= Date.now()) delete state.deliveries[deliveryKey];
      }
      const key = hash(`${subscriptionId}:${eventId}`);
      if (state.deliveries[key]) return { accepted: false, reason: "duplicate" };
      const recent = Object.values(state.deliveries).filter((entry) => entry.subscriptionId === subscriptionId && entry.status === "delivered" && Date.now() - Date.parse(entry.updatedAt) < 600_000);
      if (recent.length >= 8) return { accepted: false, reason: "rate_limited" };
      state.deliveries[key] = { key, subscriptionId, eventId, status: "pending", createdAt: nowIso(), updatedAt: nowIso(), expiresAt: new Date(Date.now() + Math.max(1, ttlSeconds) * 1_000).toISOString() };
      return { accepted: true, key };
    });
  }
  async completeDelivery(key) { return this.mutate((state) => { if (state.deliveries[key]) { state.deliveries[key].status = "delivered"; state.deliveries[key].updatedAt = nowIso(); } return { completed: Boolean(state.deliveries[key]) }; }); }
  async releaseDelivery(key) { return this.mutate((state) => { delete state.deliveries[key]; return { released: true }; }); }
  async expire(id, reason) { return this.mutate((state) => { const item = state.subscriptions[id]; if (item) { item.active = false; item.followed = false; item.expiredReason = String(reason); item.revokedAt = nowIso(); delete item.pushSubscription; } return { expired: Boolean(item) }; }); }
}

export async function createCompanionSubscriptionStore(options) { return new CompanionSubscriptionStore(options).init(); }
