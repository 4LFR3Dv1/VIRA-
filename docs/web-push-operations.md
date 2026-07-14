# VIRA Companion Web Push

Web Push is an optional delivery adapter for the VIRA Companion. Gates A–C remain fully functional when Push is disabled.

## Configuration

Set all four variables to enable the adapter:

- `VIRA_WEB_PUSH_ENABLED=true`
- `VIRA_VAPID_PUBLIC_KEY`
- `VIRA_VAPID_PRIVATE_KEY`
- `VIRA_VAPID_SUBJECT` (a `mailto:` or HTTPS contact URI)

If any value is missing, `/companion/vapid-public-key` returns `{ enabled: false, publicKey: null }` and the notification offer is not shown. Capability discovery itself does not create a noisy 5xx response. VAPID private keys must remain deployment secrets.

## Security and delivery policy

- Registration requires the participant's current room session in the `Authorization` header. Credentials are not accepted in the JSON body, persisted in a subscription, logged, placed in a push payload, or added to a deep link.
- Private attention events are projected separately for the exact participant. A room-wide broadcast is never used for lock, result, points, or rank data.
- Visible payloads use an explicit allowlist. They contain localized title/body, a same-origin credential-free destination, event identity and expiry metadata only. The selected answer is never disclosed.
- Delivery is idempotent by `subscriptionId + eventId`, TTL-bound and rate-limited. HTTP 404/410 responses revoke the endpoint.
- Locale and timezone are delivery preferences. They do not change the authoritative event or competitive state.
- The Service Worker has no `fetch` handler and no Cache Storage access.

## Evidence status

The repository tests prove the discriminated contract, audience selection, subscription persistence, redaction, deduplication, TTL handling, localized payload generation, disabled-by-default behavior and publisher handling. A subscription created by a real browser and a notification received by a browser/device are separate operational evidence and must only be claimed after a configured deployment has demonstrated them.
