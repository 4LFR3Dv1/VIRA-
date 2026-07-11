# VIRA Server Cache

## Objective

The Home must render one coherent TxLINE projection. Browsers do not fan out requests or trigger cache population.

```text
TxLINE
  -> server warmup
  -> bounded context materialization
  -> atomic disk snapshot
  -> in-memory snapshot
  -> GET /matches/catalog
  -> Home render
```

## Guarantees

- Warmup starts when the backend starts.
- A single-flight lock prevents duplicate refreshes.
- Context requests use bounded concurrency.
- The last confirmed snapshot survives process restarts.
- Stale content is served while refresh runs in the background.
- A failed fixture context does not invalidate other fixtures.
- A failed refresh preserves the previous confirmed context.
- The frontend consumes one aggregate response.
- Missing markets remain missing.

## Refresh Policy

The catalog is checked on a server interval. Context TTL depends on the fixture:

| Fixture state | Context TTL |
| --- | ---: |
| Live | 10 seconds |
| Starts within 6 hours | 30 seconds |
| Starts within 48 hours | 2 minutes |
| Distant scheduled | 10 minutes |
| Finished | 10 minutes |

This keeps live data responsive without repeatedly rebuilding distant fixtures.

## Persistence

The server writes `backend/.cache/txline-catalog.json` atomically using a temporary file and rename. The directory is ignored by Git.

On restart:

1. hydrate the persisted snapshot;
2. start the HTTP server with data already available;
3. refresh from TxLINE in the background;
4. replace the snapshot only after materialization completes.

On the first boot, when no snapshot exists, the backend completes one initial materialization before opening the HTTP listener. Deployment readiness absorbs the cold start instead of transferring it to the first Home visitor.

## Response Metadata

`GET /matches/catalog` includes:

```json
{
  "cache": {
    "status": "hit",
    "strategy": "server-warm-swr",
    "ageMs": 24,
    "stale": false,
    "refreshing": false
  },
  "materialization": {
    "contextsRefreshed": 1,
    "contextsReused": 5,
    "concurrency": 3
  }
}
```

The `/health` response exposes catalog readiness, refresh state, match count and the last refresh error.

## Failure Behavior

```text
TxLINE healthy
-> fresh snapshot

TxLINE slow
-> current snapshot returned immediately
-> refresh continues once

One fixture fails
-> previous context retained as stale
-> remaining fixtures refresh normally

Provider unavailable after restart
-> persisted snapshot remains available

No persisted snapshot and provider unavailable
-> endpoint returns a real service error
```

## Verification

```powershell
npm run test:cache
npm run build
```
