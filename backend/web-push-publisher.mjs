import webPush from "web-push";

export function createWebPushPublisherFromEnv(env = process.env) {
  const publicKey = String(env.VIRA_VAPID_PUBLIC_KEY || "");
  const privateKey = String(env.VIRA_VAPID_PRIVATE_KEY || "");
  const subject = String(env.VIRA_VAPID_SUBJECT || "mailto:hello@snelabs.space");
  const enabled = String(env.VIRA_WEB_PUSH_ENABLED || "false").toLowerCase() === "true" && Boolean(publicKey && privateKey && subject);
  if (enabled) webPush.setVapidDetails(subject, publicKey, privateKey);
  return {
    enabled,
    publicKey: enabled ? publicKey : null,
    async send(subscription, payload, { ttl = 120 } = {}) {
      if (!enabled) return { delivered: false, reason: "web_push_disabled" };
      try {
        await webPush.sendNotification(subscription, JSON.stringify(payload), { TTL: ttl, urgency: payload.type === "round_open" ? "high" : "normal", topic: String(payload.tag).slice(0, 32) });
        return { delivered: true };
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) return { delivered: false, expired: true, statusCode: error.statusCode };
        return { delivered: false, retryable: true, statusCode: error?.statusCode ?? null };
      }
    },
  };
}
