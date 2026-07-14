const VIRA_SW_VERSION = "vira-companion-sw-v1";
const SENSITIVE_QUERY_KEYS = new Set(["token", "sessionToken", "participantToken", "authorization", "secret"]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeDestination(rawDestination) {
  try {
    const destination = new URL(rawDestination || "/", self.location.origin);
    if (destination.origin !== self.location.origin) return "/";
    for (const key of [...destination.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key)) destination.searchParams.delete(key);
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeDestination(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(destination);
      return existing.focus();
    }
    return self.clients.openWindow(destination);
  })());
});

// Deliberately no fetch handler and no Cache Storage usage. Competitive state,
// APIs, SSE, projections and bundles always use the network/browser lifecycle.
self.__VIRA_SW_VERSION__ = VIRA_SW_VERSION;
