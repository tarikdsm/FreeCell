# Web

## Stack

- TypeScript
- Vite
- PixiJS v8
- Wasm binding from the Rust engine
- Web Audio for lightweight move feedback

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

### Bridge Layer

`EngineBridge` wraps the generated Wasm module and exposes:

- state reads
- reset
- structured action stepping
- autoplay
- undo/redo
- replay export

## Input Model

The first functional client uses click-to-select:

1. select a movable card or tail run
2. click a destination slot or card target
3. engine validates and returns the authoritative next state

This deliberately avoids copying legacy drag logic before the engine contract is locked.

## Audio

The current `AudioDirector` is intentionally small but well-placed:

- resumes audio context on first user interaction
- plays a light move tone
- differentiates foundation progress
- plays a short win chord

This is the seed of a larger asset-based sound architecture, not the final sound design.

## Responsive And Tablet Notes

The first delivery already accounts for:

- minimum board dimensions for narrow screens
- touch-safe button sizing
- canvas touch action control
- deterministic layout recomputation from live host dimensions

Automated E2E currently exercises both desktop and tablet-sized Chromium viewports. Dedicated WebKit automation remains future work.

## Current UX Surface

- tableau, freecells, foundations
- move counter
- timer
- seed display
- score display
- undo
- redo
- autoplay
- new game
- restart current seed

## Next Web Steps

- direct drag-and-drop stacks
- richer card art and texture pipeline
- refined highlight and invalid-move feedback
- improved accessibility affordances
- animation presets for deal, win, and undo flows
