# Web

## Stack

- TypeScript
- Vite
- PixiJS v8
- Wasm binding from the Rust engine
- Web Audio with a structured cue bank and renderer-aware feedback

## Design Direction

The first UI aims for a modern table feel rather than a legacy DOM clone:

- layered felt-style background
- warm HUD surfaces over the table
- restrained premium motion
- simple readable controls
- renderer-first card presentation with room for richer art later

## Runtime Composition

### DOM Shell

- hero copy and product framing
- HUD metrics
- action buttons
- live status text

### Pixi Scene

- slot silhouettes
- cards
- highlights
- shadows
- spring-like positional motion
- drag previews for movable runs
- hint-target emphasis

### Bridge Layer

`EngineBridge` wraps the generated Wasm module and exposes:

- state reads
- reset
- solver-backed hint reads
- structured action stepping
- autoplay
- undo/redo
- replay export

## Input Model

The current client uses direct drag-and-drop:

1. press a movable card or tail run
2. drag over a legal destination
3. drop into a free cell, foundation, or tableau column
4. let the Rust engine validate and return the authoritative next state

Hover feedback now distinguishes legal and illegal targets, and hint requests highlight both the source stack and the suggested destination.

## Audio

`AudioDirector` is now organized as a cue bank rather than a single move tone:

- resumes audio context on first user interaction
- differentiates pickup, drop, invalid, hint, restart, shuffle, foundation, and win events
- keeps the cue layer data-driven so authored assets can replace synthesis later
- stays discrete enough for long sessions while still exposing premium feedback

This is still not final sound design, but the architecture is now ready for richer authored assets without rewriting the interaction layer.

## Renderer Fallbacks

Safari and WebKit automation exposed an environment-specific GL crash path, so the board renderer now retries with Pixi's canvas renderer when GL initialization fails. That keeps the game playable in constrained WebKit environments without changing game logic or UI contracts.

## Responsive And Tablet Notes

The current delivery accounts for:

- minimum board dimensions for narrow screens
- touch-safe button sizing
- canvas touch action control
- deterministic layout recomputation from live host dimensions
- WebKit-safe renderer fallback

Automated E2E now exercises desktop and tablet viewports in both Chromium and WebKit.

## Current UX Surface

- tableau, freecells, foundations
- move counter
- timer
- seed display
- score display
- hint
- undo
- redo
- autoplay
- new game
- restart current seed

## Next Web Steps

- richer card art and texture pipeline
- authored audio assets and theme packs
- refined accessibility affordances around drag interaction
- animation presets for deal, win, and undo flows
