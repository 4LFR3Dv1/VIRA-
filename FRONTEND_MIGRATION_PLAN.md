# VIRA Frontend Migration Plan

> Historical planning document. The migration it describes has been superseded by the implemented Consumer architecture. External workstation references were never repository artifacts; use the current [architecture](docs/ARCHITECTURE.md) and repository history as the canonical record.

## 1. Purpose

This document defines how to rebuild the VIRA frontend from the current repository state without inheriting the wrong architecture from the existing generated skeleton.

The current repository already contains useful visual primitives, utility UI components, styles, and some viable aesthetic direction. It does **not** contain a viable product architecture.

Therefore the migration strategy is:

- preserve reusable UI primitives and visual assets;
- discard the current page logic and state model;
- rebuild the frontend around the product blueprint and execution plan;
- keep only two routes;
- treat the replay engine and product contracts as the frontend source of truth.

This document originally depended on external product-blueprint and execution-plan files that are not part of the public repository. Those references are intentionally not presented as public evidence.

## 2. Current Repo Assessment

The current frontend is usable only as a visual scaffold. It is not a suitable base for the final VIRA product loop.

### 2.1 What exists now

The repo already includes:

- Vite app structure
- React entrypoint
- global styles
- a large local `ui` component library
- some initial visual exploration for:
  - Lobby
  - Match Room
  - Resolution overlay
  - Inspector concept

### 2.2 Why the current app should not be evolved directly

The current implementation concentrates product flow, routing, and local UI state into a single route file.

That is incompatible with the defined frontend architecture because:

- state is local and implicit;
- replay is simulated through ad hoc timers;
- ranking and room state are embedded in UI components;
- route structure is not aligned with the blueprint;
- product contracts are not formalized;
- the replay is not authoritative or inspectable.

### 2.3 Principle

The existing skeleton is **not** the application. It is a bag of useful materials.

## 3. Migration Goal

Rebuild the frontend so that:

- the UI reflects the product contracts, not ad hoc local state;
- the Lobby and Match Room are driven by a centralized replay and view-state model;
- the interface becomes implementation-ready for later backend integration;
- the replay is deterministic and restartable;
- `?inspect=true` reflects internal replay and room state truthfully;
- the visual quality remains strong and mobile-first.

## 4. Preserve vs Retire

### 4.1 Preserve

The following are candidates for preservation:

- `src/app/components/ui/*`
- `src/app/components/figma/*`
- `src/styles/*`
- `default_shadcn_theme.css`
- generated local assets and images, if they fit the final tone
- fragments of:
  - brand treatment
  - header styling
  - scoreboard styling
  - dialog styling
  - overlay styling

These should be reused **selectively**, not blindly.

### 4.2 Retire as source of truth

The following should not remain authoritative:

- `src/app/routes.tsx`
- inline `useState` product flow
- inline participant and leaderboard data
- inline round logic
- inline timing logic
- inline inspector state

They may be mined for markup and styling, but not behavior.

### 4.3 Delete or replace later

The following will likely be replaced entirely:

- current route composition
- current Match Room flow
- current overlay trigger logic
- current leaderboard derivation
- current pitch interaction as the main room experience

The pitch can survive only if it becomes a secondary visual module, not the primary interaction surface.

## 5. Architectural Reset

The frontend should be reorganized into explicit product modules.

### 5.1 Target structure

```text
src/
  app/
    App.tsx
    routes.tsx
  domain/
    types.ts
    contracts.ts
    selectors.ts
  replay/
    initial-state.ts
    replay-script.ts
    replay-engine.ts
    replay-reducer.ts
    replay-selectors.ts
  features/
    lobby/
      LobbyScreen.tsx
      MatchCard.tsx
      JoinRoomDialog.tsx
      LobbyStates.tsx
    match-room/
      MatchRoomScreen.tsx
      MatchScoreboard.tsx
      ConnectionIndicator.tsx
      PredictionCard.tsx
      PredictionOption.tsx
      Countdown.tsx
      AnswerConfirmation.tsx
      ResolutionOverlay.tsx
      PointsBreakdown.tsx
      MarketVsRoom.tsx
    leaderboard/
      Leaderboard.tsx
      LeaderboardRow.tsx
    timeline/
      Timeline.tsx
      TimelineEntry.tsx
    inspector/
      InspectorPanel.tsx
      ReplayControls.tsx
    shared/
      AppShell.tsx
      EmptyState.tsx
      ErrorState.tsx
  shared/
    ui/
    utils/
```

This structure makes behavior explicit and keeps UI modules separate from replay state.

## 6. Frontend Source of Truth

The frontend must be driven by:

1. product contracts
2. replay state
3. reducer-driven transitions
4. derived selectors

The frontend must **not** be driven by:

- arbitrary local component state for room behavior
- isolated `setTimeout` decisions
- layout-driven business assumptions

### 6.1 Product-first, not mock-first

The frontend should not use scattered mock objects embedded into components.

Instead, it should use:

- typed contracts
- centralized initial snapshot
- centralized replay script
- deterministic event processing

Even before real backend integration, the code should already speak the language of:

- room snapshot
- normalized match event
- round state
- answer state
- resolution result
- leaderboard state
- timeline state

## 7. Contract Layer To Implement First

Before any route rebuild, create the domain model.

### 7.1 Required types

Create TypeScript definitions for:

- `Match`
- `Participant`
- `PredictionRound`
- `PredictionAnswer`
- `ScoreEntry`
- `TimelineEntry`
- `NormalizedMatchEvent`
- `ReplayState`
- `ConnectionState`
- `MatchState`
- `RoundState`
- `UserAnswerState`
- `MatchRoomUiState`
- `RoomSnapshot`
- `PredictionResolution`

### 7.2 Rule

Every UI feature must consume these types.

No UI feature should invent its own parallel shape for:

- rounds
- ranking
- event entries
- room state

## 8. Replay Layer To Implement Second

The replay system is the behavioral center of the frontend build.

### 8.1 Replay artifacts

Create:

- `initial-state.ts`
- `replay-script.ts`
- `replay-engine.ts`
- `replay-reducer.ts`
- `replay-selectors.ts`

### 8.2 Responsibilities

`initial-state.ts`

- base room snapshot
- participants
- initial match score and clock
- initial leaderboard
- initial connection state

`replay-script.ts`

- deterministic three-round demo script
- round openings
- participant answers
- normalized match events
- clock milestones
- final match finish state

`replay-engine.ts`

- play
- pause
- restart
- step dispatch
- speed control
- jump to key moments

`replay-reducer.ts`

- consumes replay actions and events
- derives room state transitions
- drives round lock and resolution
- updates leaderboard
- appends timeline entries

### 8.3 Rule

The replay must not emit `prediction.resolve` as a scripted command.

It may emit:

- round open actions
- participant answer actions
- normalized match events
- clock advances

The reducer and resolution layer must own consequences.

## 9. Routing Migration

The route system must be rebuilt from scratch.

### 9.1 Allowed routes

- `/`
- `/match/:matchId`

### 9.2 Inspector mode

The inspector is activated by:

- `/match/:matchId?inspect=true`

There must not be a third route for inspector or replay controls.

### 9.3 Current route replacement

The current `src/app/routes.tsx` should be replaced after the new modules exist.

It should become a thin route declaration file, not a product logic container.

## 10. Screen Migration Strategy

The best path is not to "clean up" the current page. It is to rebuild both screens with the preserved visuals as raw material.

### 10.1 Lobby

Build the Lobby as a new screen with:

- brand block
- live match card
- simple join CTA
- optional short modal for name
- clear state variants

Use the existing visual material from the current Lobby only where it fits:

- typography
- CTA style
- hero composition ideas
- live card surface treatment

Do not preserve:

- narrative sections if they distract from usability
- overly marketing-style composition

### 10.2 Match Room

Build the Match Room around product hierarchy:

1. scoreboard
2. live/replay state
3. active microprediction
4. answer controls
5. confirmation / awaiting state
6. resolution
7. leaderboard
8. timeline
9. market vs room

Use the existing Match Room only as:

- visual reference for top bar
- card visual treatment
- overlay starting point

Do not preserve:

- the tactical pitch as the core of the screen
- the current one-round-only flow
- current implicit success resolution

## 11. Component Rebuild Order

Build components in the order that matches the product loop.

### 11.1 Base shell

- `AppShell`
- `ConnectionIndicator`
- shared spacing and layout helpers

### 11.2 Lobby set

- `LobbyScreen`
- `MatchCard`
- `JoinRoomDialog`
- `EmptyState`
- `ErrorState`

### 11.3 Match Room set

- `MatchScoreboard`
- `PredictionCard`
- `PredictionOption`
- `Countdown`
- `AnswerConfirmation`

### 11.4 Resolution set

- `ResolutionOverlay`
- `PointsBreakdown`

### 11.5 Social context set

- `Leaderboard`
- `LeaderboardRow`
- `Timeline`
- `TimelineEntry`
- `MarketVsRoom`

### 11.6 Technical support set

- `InspectorPanel`
- `ReplayControls`

## 12. Current Component Reuse Guidance

This section defines what should likely be reused from the existing visual code.

### 12.1 Good reuse candidates

- logo/brand treatment patterns
- modal presentation pattern
- badge styling direction
- score typography direction
- overlay framing
- some icon usage

### 12.2 Partial reuse candidates

- leaderboard markup
- live badge
- top header styling
- generic cards

These likely need structural changes.

### 12.3 Poor reuse candidates

- all route-level composition
- pitch as dominant module
- state wiring
- result timing logic
- current ranking logic

## 13. Blueprint Usage Decision

Blueprint should not be introduced as the primary design system for VIRA.

Reason:

- VIRA is mobile-first;
- Blueprint is optimized for desktop, data-dense interfaces;
- the product must feel like a fan-facing sports experience, not a data tool.

### 13.1 Blueprint may be used for

- internal inspector surfaces
- technical drawers/dialogs
- utility overlays if existing local primitives are insufficient

### 13.2 Blueprint should not be used for

- Lobby
- Match Room
- Scoreboard
- Prediction Card
- Leaderboard
- Timeline
- Market vs Room

Default choice:

- use existing local `ui` primitives first;
- only add Blueprint later if a specific technical panel genuinely benefits.

## 14. State Migration Strategy

### 14.1 What must move out of components

Move all of the following into centralized state:

- participant list
- room population
- current round
- selected answer
- submitted answer
- answer lock state
- resolution outcome
- leaderboard state
- timeline entries
- replay speed
- replay progress
- current sequence
- connection state
- inspector state

### 14.2 What may stay local

Local component state is acceptable only for:

- dialog open/close
- temporary focus UI
- non-authoritative UI affordances
- purely presentational hover/expanded sections

## 15. Data Ownership Rules

The migration should enforce clear ownership boundaries.

### 15.1 Domain owns

- contracts
- room snapshot structure
- event shapes
- round resolution language

### 15.2 Replay owns

- deterministic demo behavior
- transitions across rounds
- timing control
- progression of state

### 15.3 Features own

- rendering
- interaction plumbing
- accessibility
- layout and animations

### 15.4 Features do not own

- authoritative match flow
- ranking mutations
- round resolution decisions

## 16. Animation Migration Rules

Animations should be rebuilt after behavior is correct.

Priority animations:

- new round entry
- answer submitted confirmation
- awaiting event state
- resolution overlay
- leaderboard position shift
- next-round transition

Do not rebuild the app around motion first.

## 17. Accessibility Migration Rules

Accessibility must be incorporated during rebuild, not after.

Required in rebuilt components:

- semantic buttons and headings
- visible focus
- `aria-live` only for meaningful state changes
- dialog focus trapping
- keyboard support for inspector
- reduced-motion handling
- non-color state communication

The current skeleton should not be assumed accessible merely because it renders.

## 18. Test Migration Targets

Once the rebuild exists, tests should validate the new architecture, not the old view.

Minimum targets:

- Lobby renders match card
- Join dialog opens
- user can enter room
- prediction options render in open round
- selection can change before submit
- submitted answer locks the card
- success resolution displays points
- failure resolution displays correct outcome
- leaderboard highlights current participant
- replay restart returns to initial state
- inspector only appears when requested

## 19. Step-by-Step Migration Order

This is the recommended implementation order for this specific repo.

### Step 1

Create the new folders:

- `src/domain`
- `src/replay`
- `src/features/*`
- `src/shared/*`

### Step 2

Implement all product contracts in `src/domain`.

### Step 3

Implement replay state, initial snapshot, and replay script.

### Step 4

Implement replay reducer and selectors.

### Step 5

Replace route definitions with the correct two-route structure.

### Step 6

Build the Lobby from preserved visuals and new structure.

### Step 7

Build the Match Room shell driven by centralized state.

### Step 8

Add resolution overlay, leaderboard, and timeline from reducer-driven state.

### Step 9

Add inspector and replay controls.

### Step 10

Add market vs room and final polish.

## 20. Files Likely To Be Touched First

Recommended first-wave file creation:

- `src/domain/types.ts`
- `src/domain/contracts.ts`
- `src/replay/initial-state.ts`
- `src/replay/replay-script.ts`
- `src/replay/replay-reducer.ts`
- `src/replay/replay-engine.ts`
- `src/app/routes.tsx`
- `src/features/lobby/LobbyScreen.tsx`
- `src/features/match-room/MatchRoomScreen.tsx`
- `src/shared/shell/AppShell.tsx`

Recommended first-wave files to stop relying on:

- `src/app/routes.tsx` current contents
- `src/imports/pasted_text/vira-frontend-interface.tsx`

## 21. Definition of Successful Migration

The migration is successful when:

- the current monolithic route file is no longer the product engine;
- only two routes exist;
- all meaningful state is centralized;
- the replay is deterministic and restartable;
- the Match Room flow is reducer-driven;
- the inspector reflects replay and room state truthfully;
- visuals remain strong and mobile-first;
- the app is ready to receive backend integration later without a conceptual rewrite.

## 22. Final Recommendation

Treat the current repository as a visual donor, not a product base.

The fastest correct path is:

1. preserve primitives and styling;
2. replace architecture completely;
3. rebuild state and routing from the blueprint;
4. migrate only useful markup fragments into the new modules;
5. add polish after the replay-driven flow is correct.

That approach keeps momentum high and prevents the skeleton from dictating the wrong system design.
