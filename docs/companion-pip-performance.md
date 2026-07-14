# VIRA Floating Companion performance certification

Baseline commit: `87cea42`. Profile command: `npm run profile:companion:pip -- --label after`.

The profile uses the certified Consumer E2E harness, a real Chromium Document Picture-in-Picture window, a captured TxLINE test fixture, no network trace categories, and a five-second `round_open` sample. Generated traces and screenshots remain under ignored `artifacts/` paths.

## Root cause

The baseline created a separate `useServerClock` interval for every Companion instance. Each interval ran every 500 ms even without checking whether a consumer-visible deadline was active. With in-app and PiP instances mounted, both rendered ten or more times in five seconds without a semantic event. The PiP also imported the full application stylesheet and mounted the Framer Motion tree, including a repeating decoration.

## Before and after

| Metric (5 s `round_open`) | Before | After |
| --- | ---: | ---: |
| PiP renders | 10 | 5 |
| In-app Companion renders | 11 | 5 |
| Extra timer created by opening PiP | 1 × 500 ms | 0 |
| PiP stylesheets | 4 (1 global link) | 1 dedicated inline sheet |
| Infinite PiP animations | 0 observable WAAPI; repeating Motion code present | 0; no Motion tree in PiP |
| Long tasks during sample | 0 | 0 |
| Trace `TimerFire` | 70 | 30 |
| Trace `FunctionCall` | 218 | 84 |
| Trace `UpdateLayoutTree` | 83 | 33 |
| Trace `PrePaint` | 64 | 38 |
| Renders after close | 0 | 0 |

The remaining five PiP renders are the authoritative countdown at one update per second. In `resolved`, five open/close cycles produced zero parked renders. Each cycle returned to one source page, created and removed exactly one PiP root, and added and removed exactly one PiP `pagehide` listener. Active timers returned to the same non-Companion baseline.

After forced garbage collection, the first cycle incurred the Chromium window warm-up allocation. Cycles two through five varied by approximately 17 KB in total and included a decrease between cycles two and three; no per-window page, root, listener, timer, or render remained active.

## Implementation constraints

- The countdown continues to use the offset derived from authoritative `serverTime` and `locksAt`.
- A single one-hertz clock value is shared by the in-app and PiP renderers.
- No clock interval exists for upcoming, live without a round, locked, resolved, offline or error states.
- The PiP renderer is static and uses `contain: layout paint style` plus a dedicated stylesheet.
- React memoization compares only fields displayed by the Companion. Score, state, deadline, prompt, answer confirmation, result, points, rank and locale changes still render immediately.
- Follow, open, close and display updates do not mutate `streamVersion`.

Raw local evidence:

- `artifacts/performance/companion-pip-before.json`
- `artifacts/performance/companion-pip-before-trace.json`
- `artifacts/performance/companion-pip-after.json`
- `artifacts/performance/companion-pip-after-trace.json`
- `artifacts/release-visual/chromium-desktop/companion-document-pip-en.png`
