# Research Audit

## Goal Of The Audit

The five reference repositories were studied to recover:

- Microsoft-compatible deal logic
- move and autoplay semantics
- browser interaction lessons
- animation and card-presentation patterns
- engine architecture tradeoffs

The result is not a port. It is a modern re-architecture informed by those references.

## Repositories Reviewed

- `macroxue/freecell`
- `gitbrent/FreecellJS`
- `einaregilsson/cards.js`
- `adrianeyre/free-cell`
- `GnikDroy/freecell`

Reference clones live under `tools/audits/repos/`.

## 1. `macroxue/freecell`

### Key Files Reviewed

- `game/deck.js`
- `game/freecell.js`
- `solver/node.h`
- `solver/tableau.h`
- `solver/deals.cc`

### What Was Taken Conceptually

- Microsoft-style deterministic deal generation
- safe autoplay gating based on opposite-color foundation progress
- solver-friendly treatment of movable tableau tails
- clear distinction between requested move and autoplay follow-up moves

### What Was Discarded

- DOM-driven gameplay state
- tight coupling between UI behavior and game logic
- legacy C++ solver object model as the application center

### How It Was Translated

- deal generation became `microsoft_deal_deck` in Rust
- autoplay behavior became `Game::run_auto_play`
- movable-tail logic became part of Rust validation and snapshot metadata
- replay turns now serialize as explicit `TurnRecord` data rather than UI-side reconstruction

### Important Audit Finding

The executable deal logic in `game/deck.js` and `solver/node.h` agrees with the current engine. The sample text in `solver/deals.cc` did not match that executable logic during verification. The new engine follows the executable logic, not the conflicting sample text.

## 2. `GnikDroy/freecell`

### Key Files Reviewed

- `src/game/freecell.c`
- `include/game/card.h`
- `include/game/freecell.h`

### What Was Taken Conceptually

- explicit Microsoft shuffle intent in a non-browser engine
- clear split between validation and application
- move-capacity logic based on empty freecells and empty cascades
- respect for headless engine behavior independent of rendering

### What Was Discarded

- C-era memory and module style
- renderer/platform coupling in the project structure
- direct translation of the C engine and UI stack

### How It Was Translated

- the move-capacity rule informed the Rust engine validation model
- headless execution informed `FreecellEnvironment`
- engine-first layering influenced the monorepo boundary decisions

## 3. `gitbrent/FreecellJS`

### Key Files Reviewed

- `FreecellJS.html`
- `css/FreecellJS.css`
- audio-loading and iOS audio unlock code paths
- drag/drop handler flow for tableau, freecells, and foundations

### What Was Taken Conceptually

- browser-first UX pragmatism
- top-row layout that clearly separates freecells and foundations
- explicit audio bootstrap for touch-constrained browsers
- responsive thinking for tablet-class devices

### What Was Discarded

- jQuery UI drag/drop stack
- DOM-owned rule validation
- legacy asset and dialog architecture

### How It Was Translated

- the new app keeps an HTML HUD over a renderer-owned board
- audio unlock behavior informed the `AudioDirector`
- responsiveness informed the board layout and tablet E2E coverage

## 4. `einaregilsson/cards.js`

### Key Files Reviewed

- `cards.js`
- `example.js`

### What Was Taken Conceptually

- card/container separation
- explicit render passes from container state to visual positions
- z-index promotion for active cards
- animation as a first-class concern rather than an afterthought

### What Was Discarded

- jQuery animation primitives
- sprite-sheet dependency and API style
- library-level ownership of game semantics

### How It Was Translated

- `CardVisual` and `BoardRenderer` now play the role of the view layer
- per-frame motion updates replace jQuery animation queues
- card visuals remain replaceable without touching engine rules

## 5. `adrianeyre/free-cell`

### Key Files Reviewed

- `src/index.ts`
- `src/game.ts`
- `src/card.ts`
- `tests/*.ts`

### What Was Taken Conceptually

- lightweight TypeScript decomposition
- readable file boundaries
- value of small tests around card/deck primitives

### What Was Discarded

- simple canvas-era project scale
- any temptation to make TypeScript the source of truth for rules

### How It Was Translated

- the modern repo keeps small focused TypeScript modules on the web side
- TypeScript contracts mirror Rust outputs rather than reimplement them

## Cross-Repository Synthesis

### Kept

- Microsoft-compatible deterministic deals
- conservative autoplay
- movable-run awareness
- browser-first usability lessons
- renderer abstractions that keep motion separate from rules

### Rejected

- DOM or renderer ownership of rule semantics
- legacy UI frameworks
- direct ports of C/C++/jQuery code
- solver entanglement with renderer concerns

## Final Architectural Decision

The new project uses:

- Rust for the engine
- Wasm for browser delivery
- Python for headless experimentation
- TypeScript + PixiJS for the first modern client

This preserves the important functional behavior recovered from the references while replacing their aging application architecture.

## Current Risks

- a full solver has not yet been ported, so hints remain a prepared API rather than a finished feature
- WebKit automation is not yet in CI, even though tablet-responsive behavior is already covered in Chromium
- the current web client uses click-to-select rather than final drag-stack interaction

## Audit Artifacts

- `tools/audits/repos/`
- `tools/audits/reference-summary.md`
