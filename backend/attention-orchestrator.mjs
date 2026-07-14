import { projectConsumerAttentionEvents, projectRankChangedEvent, selectAttentionForParticipant } from "../shared/consumer-attention.mjs";
import { attentionDeliveryPayload, deliveryTtlSeconds } from "./attention-delivery.mjs";

export function createAttentionOrchestrator({ runtime, store, publisher, intervalMs = 1_000 }) {
  let timer = null; let running = false;
  const lastRanks = new Map();
  async function tick() {
    if (running || !publisher.enabled) return;
    running = true;
    try {
      for (const subscription of store.activeSubscriptions()) {
        if (!runtime.hasPublicRoom(subscription.roomId)) continue;
        const snapshot = runtime.snapshot(subscription.roomId, subscription.participantId);
        const projected = projectConsumerAttentionEvents(snapshot, subscription.participantId);
        const rank = snapshot.leaderboard?.find((entry) => entry.participantId === subscription.participantId)?.rank;
        const rankChange = projectRankChangedEvent(snapshot, subscription.participantId, lastRanks.get(subscription.id));
        if (rankChange) projected.push(rankChange);
        if (Number.isFinite(rank)) lastRanks.set(subscription.id, rank);
        const events = selectAttentionForParticipant(projected, subscription.participantId);
        for (const event of events) {
          const enabled = subscription.enabledTypes.includes(event.type) || (event.type === "round_locked" && subscription.enabledTypes.includes("round_open"));
          if (!enabled || (event.expiresAt && Date.parse(event.expiresAt) <= Date.now())) continue;
          const ttl = deliveryTtlSeconds(event);
          const reservation = await store.reserveDelivery(subscription.id, event.eventId, ttl);
          if (!reservation.accepted) continue;
          const payload = attentionDeliveryPayload(event, subscription);
          const result = await publisher.send(subscription.pushSubscription, payload, { ttl });
          if (result.delivered) await store.completeDelivery(reservation.key);
          else if (result.expired) { await store.releaseDelivery(reservation.key); await store.expire(subscription.id, `push_${result.statusCode}`); }
          else await store.releaseDelivery(reservation.key);
        }
      }
    } finally { running = false; }
  }
  return {
    async tick() { return tick(); },
    start() { if (!timer) { timer = setInterval(() => void tick(), intervalMs); timer.unref?.(); } },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}
