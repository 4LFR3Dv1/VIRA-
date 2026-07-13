# Consumer demo capture

Run from the repository root:

```bash
npm run demo:capture
```

The command builds the production UI, starts the approved isolated Consumer harness, records two fixed 1280x720 Chromium contexts and writes an ignored artifact directory under `artifacts/demo/<run-id>/`.

Outputs include the Player A and Player B masters, one MP4 per editorial scene, a synchronized split-screen MP4 for the multiplayer sequence, and `manifest.json` with scene timings and authority metadata.

The visible disclosure and manifest identify the input as `captured_txline_test_fixture`. The capture must not be described as TxLINE data received live during recording. Harness routes and credentials are invoked only from the Node runner and are never archived.
