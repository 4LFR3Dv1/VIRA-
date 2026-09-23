# Operations

The canonical operational procedure remains the [Operations Runbook](OPERATIONS_RUNBOOK.md). This page is the stable entry point for deploy and verification.

## Required deployment invariants

```text
replicas = 1
VIRA_DATA_DIR = persistent mounted volume
VIRA_INTERNAL_INGEST_ENABLED = false
VIRA_ALLOWED_ORIGINS = deployed public origin
```

## Public probes

- [`/health`](https://vira.snelabs.space/health) — liveness and runtime summary.
- [`/ready`](https://vira.snelabs.space/ready) — rehydration, storage and configured authority checks.
- [`/operational/metrics`](https://vira.snelabs.space/operational/metrics) — process, runtime, ledger, provider and disk signals.
- [`/public/playback`](https://vira.snelabs.space/public/playback) — permanent disclosed verification path.

## Local gate

```bash
npm ci
npm run verify
npm run test:container
```

Optional deployment certification is documented in the runbook. An accelerated certification must not be described as the four-hour wall-clock soak.

