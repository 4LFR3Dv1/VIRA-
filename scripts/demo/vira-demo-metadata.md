# VIRA submission demo metadata

- Title: VIRA — Live Multiplayer Football Experience Powered by TxLINE
- Editorial baseline: `2766f3db5c76c81c13178bf2e375b2583e7754e9`
- Primary capture: `demo-20260714143041-08a86c`
- Corrected answer-state patch: `demo-20260714154232-f0041c`
- Cross-device patch: `demo-20260714185002-f4d562`
- Cross-device build: `D-p5ETSL`
- Deployment: <https://vira.snelabs.space>
- Duration: 3:40 (220 seconds)
- Master: 1920×1080, 30 fps CFR, H.264 High Profile, yuv420p
- Mezzanine: scene sources encoded at CRF 15, then concatenated without recompressing the previous release candidate
- Audio: AAC, 48 kHz mono; measured −16.08 LUFS-I and −1.43 dBTP
- Captions: external English SRT plus a captioned master; captions are repositioned away from answers, confirmation, Mini League, TxLINE evidence and Official Review
- Locale: English
- Editorial timezone: `America/Sao_Paulo`
- Competitive input authority: `captured_txline_test_fixture`

## Cross-device evidence

The multiplayer sequence is one correlated execution, not two independent runs edited to appear simultaneous. Player A uses Chromium desktop and Player B uses emulated Mobile WebKit. They have distinct identities and sessions while sharing:

- room: `e2e-demo-20260714185002-f4d562`
- round: `round-1`
- authoritative deadline: `2026-07-14T18:50:43.038Z`
- two participants; zero duplicates
- private confirmed answers before lock
- authoritative locked and resolved states
- equivalent replay and ranking hashes

Observed projection convergence was 2 ms for open, 10 ms for confirmed, 8 ms for locked and 3076 ms for resolved. These measurements are QA evidence only; the video does not claim frame-perfect simultaneity or a native iOS device.

## TxLINE and Web Push disclosure

The competitive walkthrough explicitly labels its input as a captured TxLINE test fixture so it remains reproducible after live activity ends. The separate TxLINE segment shows the real integration path without exposing credentials.

The eight-second Web Push segment is an editorial explanation built around the real product alert control. It does not simulate or claim a native operating-system notification capture. Production Web Push was reported as operational by the operator, but native delivery is not independently evidenced by this video.

## TxLINE endpoints used

- `GET /txline/fixtures`
- `GET /txline/scores`
- `GET /txline/scores/updates`
- `GET /txline/scores/historical`
- `GET /txline/odds`

## Publication outputs

Generated outputs are intentionally ignored by Git and live under `artifacts/submission/final/`. The reproducible compositor, source timeline, narration map, SRT/ASS and certification manifest are versioned under `scripts/demo/`.

Known limitations:

- Mobile WebKit is emulated, not Safari on a physical iPhone.
- The competitive demo fixture is captured rather than represented as live delivery during recording.
- Native Web Push notification footage is not included.
- The PWA intentionally does not cache or serve stale competitive room state.
