# VIRA Operations Runbook

This runbook is for the team operating the single-writer deployment. Judges should use the [Judge Walkthrough](JUDGE_WALKTHROUGH.md).

## Before a live fixture

- Check `/ready` and `/operational/metrics`.
- Confirm one backend replica and one mounted persistent volume.
- Confirm TxLINE catalog and feed health.
- Verify disk headroom and freeze deployments before the live window.
- Confirm the canonical `/public/playback` remains verified.

## During a live fixture

- Watch `eventLoopLagMs`, `queueDepth`, `sseClients`, disk space, catalog errors and degraded feeds.
- Stop opening rounds when authority is degraded.
- Never inject a substitute result or extend a deadline from the browser.
- Keep Match Room and VIRA Picks persistence single-writer.

## After full time

- Confirm the authoritative terminal fixture state and regular-time score policy.
- Open `/help` and compare projection and ranking replay.
- Run `certify:match` and archive `artifacts/certify-match.json`.
- Inspect unresolved or void Picks cards without mutating competitive ranking.

## Stability certification

```powershell
npm run certify:match -- --cycles 3 --target https://vira.snelabs.space
npm run soak:match -- --target https://vira.snelabs.space --duration-sec 14400 --interval-sec 30
```

Archive `artifacts/soak-match.json`. The report fails on readiness loss, queued work, replay drift, projection divergence or ranking divergence.

Accelerated certification repeats the restart and replay contract. It must not be described as a four-hour wall-clock soak.

## Operational boundary

The event stores are single-writer. Production must remain one backend replica with one persistent volume. Horizontal replicas require transactional shared persistence and distributed serialization before activation.
