# Engine

## Scope

`crates/freecell_engine` owns:

- deterministic deal generation by seed
- complete FreeCell state transitions
- move validation
- legal action generation
- legal action masks
- undo/redo history
- replay export
- autoplay policies
- bounded hint search with principal variation output
- stable JSON and compact binary serialization
- headless stepping for AI workflows

## Core State

The engine models:

- 8 tableau columns
- 4 free cells
- 4 suit-locked foundations
- deterministic seed metadata
- history and replay metadata

Snapshots are serialized with camelCase field names and exposed through both Wasm and Python.

## Card Encoding

Internally, cards follow the compatibility-friendly encoding:

```text
card_id = ((rank - 1) << 2) | suit_index
```

Suit order:

- `spades = 0`
- `hearts = 1`
- `diamonds = 2`
- `clubs = 3`

This matches the logic observed in the audited Microsoft-compatible references.

## Deal Generation

The current engine implements the classic Microsoft-style linear congruential shuffle:

```text
seed = seed * 214013 + 2531011
rand = (seed >> 16) & 0x7fff
```

Deck shuffling follows the executable logic audited from:

- `macroxue/freecell/game/deck.js`
- `macroxue/freecell/solver/node.h`

## Move Rules

The engine validates:

- tableau to tableau
- tableau to freecell
- tableau to foundation
- freecell to tableau
- freecell to foundation
- foundation to tableau
- foundation to freecell

Multi-card tableau moves are allowed only when:

- the source tail is a proper alternating descending run
- the destination accepts the lead card
- the requested count fits the legal transport capacity

Current legal transport capacity:

```text
(empty_freecells + 1) * 2^(empty_tableaus_not_used_as_destination)
```

## History, Undo, Redo, Replay

Every applied turn stores:

- the requested action
- the actually executed actions
- whether autoplay participated
- foundation delta

This supports:

- unlimited undo/redo over the current session
- replay export with deterministic restoration
- exact state-hash regression checks

## Autoplay Policies

- `off`
- `safe`
- `max`

`safe` currently follows the classic conservative rule: higher cards only move automatically when opposite-color foundations have caught up enough to avoid trapping play.

## Snapshot Surface

The engine emits `GameSnapshot` with:

- `seed`
- `dealMode`
- `status`
- `autoPlayPolicy`
- `moveCount`
- `turnIndex`
- `score`
- `legalMoveCapacity`
- `stateHash`
- `foundations`
- `freecells`
- `tableau`

Replay export is exposed as `ReplayExport`.

## Hint Search

The engine now exposes a solver-facing `HintAnalysis` surface with:

- `kind`
- `suggested`
- `principalVariation`
- `exploredNodes`
- `solved`
- `score`
- `message`

The current implementation uses bounded best-first search over legal turns:

- safe autoplay is checked first for immediate foundation progress
- forced single-move positions are surfaced directly
- remaining positions are explored with heuristic ordering, state hashing, and depth/node limits

This is intentionally pragmatic: it is strong enough to power real in-product hints today while still leaving room for a dedicated exhaustive solver crate later.

## Action Space

The engine exposes two equivalent action surfaces:

- structured actions with source, destination, and count
- encoded action indices

Current action-space size:

```text
16 slots * 15 destinations-per-source * 13 card counts = 3120
```

The action mask has length `3120` and marks legal indices with `1`.

## Serialization

- JSON snapshot and replay export are stable and human-readable
- postcard binary support exists for compact engine-side persistence

## Tests Already In Place

- seed 1 regression against the audited Microsoft-style deck
- multi-move capacity regression
- undo/redo state-hash round trip
- safe autoplay regression
- replay export restoration
- legal action mask validation
- hint legality and winning-move detection
- property test: undoing an arbitrary legal sequence returns to the initial hash

## Solver Readiness

The engine is now past pure solver-readiness and already ships a bounded search layer. It still keeps the right seams for a deeper solver port:

- deterministic seed reproduction
- headless stepping
- legal action enumeration
- state hashing
- replay export
- autoplay hooks
- serializable hint analysis
