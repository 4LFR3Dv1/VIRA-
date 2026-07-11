# P1-A Operational Evidence

The P1-A gate proves that the production image boots, becomes ready, serves the application, reads a persisted ledger and reconstructs the same projection after a process restart.

## Automated proof

```bash
npm run test:container
```

The script builds an isolated image, creates a temporary Docker volume, seeds a non-TxLINE infrastructure room, starts the server, captures verification, restarts the container using the same volume and asserts:

```text
ledgerHeadHash before == ledgerHeadHash after
streamVersion before == streamVersion after
liveProjectionHash before == liveProjectionHash after
replayedProjectionHash before == replayedProjectionHash after
hashChainValid == true
projectionMatches == true
rankingMatches == true
```

The result is written to `artifacts/p1-a-container-smoke.json` and uploaded by GitHub Actions.

## Public deployment record

Fill this section after provisioning the public host:

```text
CI commit:
Deployment URL:
Container image/digest:
Deployment provider:
Replica count: 1
Persistent volume:
Backend restart timestamp:
Ledger head before:
Ledger head after:
Stream version before:
Stream version after:
Projection matches:
Ranking matches:
Readiness URL: /ready
```

Infrastructure seeding proves persistence only. It does not claim TxLINE authority and does not replace the external real-provider E2E gate.

## Railway volume

The production volume is configured in Railway, not in the Docker image:

```text
Service -> Volumes -> Add Volume
Mount path: /var/lib/vira
VIRA_DATA_DIR: /var/lib/vira
Healthcheck: /ready
```

Do not add a Docker `VOLUME` instruction. Railway rejects it during image validation and provides persistence through the attached service volume.
