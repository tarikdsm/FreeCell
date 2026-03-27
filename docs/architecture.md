# Architecture

## Goals

- Keep every rule in Rust and nowhere else
- Make the same seed and action stream reproduce the same result in browser, tests, and Python
- Let UI, solver, and AI layers evolve independently
- Favor compact state and explicit contracts over implicit UI state

## Monorepo Structure

### Runtime Layers

- `crates/freecell_engine`
  - domain model, deal generation, move validation, replay, serialization, AI stepping
- `crates/freecell_wasm`
  - Wasm adapter for browser consumers
- `crates/freecell_py`
  - Python adapter for headless experimentation
- `apps/web`
  - PixiJS renderer, HTML HUD, input, motion, and audio shell

### Shared Packages

- `packages/contracts`
  - TypeScript contract mirrors for snapshots, actions, turns, and replays
- `packages/design_tokens`
  - design primitives for color, spacing, radius, motion, and card proportions

### Quality And Tooling

- `tests/engine`
  - Python smoke tests
- `tests/e2e`
  - Playwright browser flows
- `tools/audits`
  - reference-repository notes and audit artifacts
- `tools/benchmarks`
  - performance notes and benchmark entry points

## Boundary Rules

### Engine

- Owns all move legality
- Owns replay, history, and state hashes
- Owns autoplay behavior
- Owns action enumeration and legal action masks

### UI

- Receives snapshots
- Emits `EngineAction` intents
- Never infers rules locally
- Never mutates state outside the engine

### AI And Solver Layers

- Consume stable serialized state
- Use explicit action indices or serialized actions
- Can run headless without any browser or renderer dependency

## Data Flow

1. The UI emits an action request.
2. The Wasm adapter forwards the action to the Rust engine.
3. The engine validates the move, applies it, records replay/history, and returns a snapshot.
4. The UI re-renders from the snapshot.
5. Optional autoplay appends additional executed actions into the same turn record.

## Determinism Strategy

- Microsoft-style seeded shuffle implemented in Rust
- Stable `stateHash` emitted on every snapshot
- Replay export stores ordered `TurnRecord` entries
- Undo/redo works from engine-managed reversible history
- Python and Wasm both use the same Rust types and semantics

## Why Rust + Wasm + Python

- Rust provides a clean place for strict rule ownership, compact data, and future solver work.
- Wasm makes the browser consume the exact same logic as tests and headless tools.
- Python bindings unblock RL training, dataset generation, and notebook exploration without building a second engine.

## Web Architecture

The first browser app uses a split shell:

- DOM for HUD, buttons, and status
- PixiJS scene graph for cards, slots, shadows, and motion
- `EngineBridge` for Wasm session control
- `AudioDirector` for discreet Web Audio feedback and future sound layering

This keeps the browser app lightweight while preserving a renderer path that can become much richer without touching gameplay logic.

## Extension Points

- solver crate or service consuming replay/snapshot/action APIs
- drag-and-drop or gesture layer replacing click-to-select
- richer themes and audio assets
- batched environment wrappers for AI
- persistent save slots and statistics

## Non-Goals Of This First Delivery

- full solver implementation
- final art production pipeline
- ranked progression, analytics, or cloud persistence
- multiplayer or server-side gameplay
