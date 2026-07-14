# Consumer demo capture

Run from the repository root:

```bash
npm run demo:capture
```

The command builds the production UI, starts the approved isolated Consumer harness, records two fixed native 1920x1080 Chromium contexts and writes an ignored artifact directory under `artifacts/demo/<locale>/<capture-mode>/<run-id>/`.

Outputs include the Player A and Player B masters, one MP4 per editorial scene, a synchronized split-screen MP4 for the multiplayer sequence, and `manifest.json` with scene timings and authority metadata.

The default English desktop capture is equivalent to:

```bash
npm run demo:capture -- --locale en --time-zone America/Sao_Paulo --capture-mode desktop
```

The manifest records the commit, bundle ID, deployment, runtime versions, per-scene motion mode and replay/ranking equivalence. Product motion is enabled only for scenes where it clarifies state transitions; reading and evidence scenes keep reduced motion.

The visible disclosure and manifest identify the input as `captured_txline_test_fixture`. The capture must not be described as TxLINE data received live during recording. Harness routes and credentials are invoked only from the Node runner and are never archived.

The final compositor refuses to replace external evidence with placeholders:

```bash
npm run demo:compose -- --capture artifacts/demo/en/desktop/<run-id> --cross-device artifacts/demo/en/hybrid-cross-device/<run-id>/multiplayer-split-screen.mp4 --txline artifacts/submission-inputs/txline-real.mp4 --voice artifacts/submission/audio/vira-demo-narration-aligned-48k-mono.wav
```

The submission compositor also requires the split-screen file from one certified `hybrid-cross-device` run through `--cross-device`. That run uses Chromium desktop and emulated Mobile WebKit with distinct identities against the same room, round and authoritative server deadline. Its manifest records correlation and observed convergence intervals; it does not claim native iOS or frame-perfect simultaneity.

The final composition uses the real in-product alerts control plus a labeled editorial Web Push flow. It never substitutes an HTML toast for a native operating-system notification. A native capture may be supplied in a future revision, but is not required for this submission cut.

Without `--voice`, it emits the clean master and rough cut but deliberately withholds `vira-demo-final-en-1080p.mp4`.

The publication contract and final QA evidence are versioned in
`vira-demo-metadata.md` and `vira-demo-certification.json`. Generated videos,
screenshots, contact sheets and transcodes remain under ignored `artifacts/`
directories and must be published as external release assets rather than added
to Git history.
