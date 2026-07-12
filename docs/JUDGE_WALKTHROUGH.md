# VIRA Judge Walkthrough

## Fast Path

1. Open <https://vira.snelabs.space/> and make the featured 1X2 pick.
2. Share the link and open it in an anonymous or mobile window.
3. Submit the second prediction and enter the same room.
4. Open <https://vira.snelabs.space/help> to inspect a resolved ledger replay without login.

No wallet, OAuth, payment, extension or local setup is required.

## Authority

```text
TxLINE fixture market -> pre-match context
Official score/events -> competitive resolution
VIRA runtime          -> lock, predicate, scoring and ranking
Append-only ledger    -> restart and independent replay
Solana commitment     -> asynchronous replay-hash anchor
```

`/help` never calls internal ingest routes. It selects a resolved public room, reruns verification and exposes only redacted aggregate participation.

## Two-Device Gate

```text
A and B enter the same room
both submit private answers
the server locks the round
an authorized fact resolves everyone
both rankings match
restart rehydrates the same state
replay hash remains byte-identical
```

```powershell
npm run test:e2e:two-device
npm run test:judge-playback
```

## Runbook

Before: check `/ready` and `/operational/metrics`, confirm one replica, mounted volume and TxLINE health, then freeze deploys.

During: watch `eventLoopLagMs`, `queueDepth`, `sseClients`, disk space, catalog errors and degraded feeds. Stop opening rounds when authority is degraded; never inject a substitute result.

After: confirm full time, open `/help`, compare projection/ranking, run `certify:match` and archive `artifacts/certify-match.json`.

## Operational Boundary

The event store is single-writer. Production must remain one backend replica with one persistent volume. Accelerated certification repeats the restart/replay contract, but a four-hour wall-clock soak must still be executed and archived before claiming long-duration production certification.
