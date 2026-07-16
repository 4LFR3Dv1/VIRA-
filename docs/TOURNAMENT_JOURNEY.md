# Tournament Journey authority

The Home “Road to the final” module is a read-only consumer projection. It does not mutate Match Room runtime, the competitive ledger, replay, ranking, or VIRA Picks.

## Authority split

- `backend/tournament-journey-manifest.mjs` owns only the four bracket positions and their fixture IDs. It contains no participant, kickoff, score, status, or competition result.
- TxLINE fixture observations own participants, kickoff, and lifecycle status.
- An exact TxLINE `game_finalised` record with `StatusId: 100`, a matching fixture ID, both score envelopes, and both structured score values owns a terminal result.
- `backend/tournament-journey-store.mjs` archives the sanitized provider payload, acquisition origin, observation and receipt timestamps, provider sequence, freshness, and canonical SHA-256.

The archived file is an atomic, serialized, single-writer store. This is appropriate for the current single-instance deployment; a multi-instance deployment must replace it with transactional shared storage.

## Fail-closed behavior

The tournament remains `active` until the final has both a `finished` fixture projection and an authoritative terminal TxLINE result. Scheduled, live, paused, postponed, cancelled, unknown, missing, and terminal-without-score states never produce a champion. A missing archived fixture appears as `Result unavailable`; no participant or score is inferred.

The certified France–Spain Judge Playback is deliberately outside the official bracket. Its CTA and disclosure describe it as a guided playback built from a sanitized captured TxLINE fixture.

## Public contract

`GET /tournaments/world-cup/journey` exposes allowlisted public data only. Each position contains:

```ts
interface TournamentJourneyFixtureV1 {
  fixtureId: string;
  stage: "semi_final" | "third_place" | "final";
  slot: number;
  structureAuthority: "editorial_manifest";
  resultAuthority: "txline";
  manifestVersion: string;
  fixture: FixtureConsumerProjectionV1 | null;
}
```

`GET /home` includes the same projection as `journey`, allowing the existing visibility refresh and 15-second polling loop to update the bracket automatically.
