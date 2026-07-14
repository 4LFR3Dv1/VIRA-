# VIRA PWA cache policy

The VIRA Service Worker provides install lifecycle, visible Web Push presentation, and a safe `notificationclick` entry point. Push is optional and only enabled when VAPID is explicitly configured; the Companion itself does not depend on it.

It deliberately has no `fetch` handler and does not use Cache Storage. It cannot cache or synthesize responses for APIs, SSE, room snapshots, competitive projections, Match Room documents, or frontend bundles. A network or backend failure remains visible to the product's existing offline and reconnect states.

Notification destinations are restricted to the same origin and sensitive query keys are removed before a window is focused, navigated, or opened. Participant and session credentials remain in the existing browser session storage and are never placed in install metadata or deep links.

`/sw.js` is served with `Cache-Control: no-cache` and registered with `updateViaCache: "none"`, while fingerprinted static assets keep their normal immutable caching policy. Push events without a valid, visible VIRA payload are ignored; no silent push is used.
