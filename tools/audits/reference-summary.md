# Reference Summary

## Studied Repositories

- `macroxue/freecell`
- `gitbrent/FreecellJS`
- `einaregilsson/cards.js`
- `adrianeyre/free-cell`
- `GnikDroy/freecell`

## Most Important File-Level Learnings

- `macroxue-freecell/game/deck.js`
  - confirms the Microsoft-style LCG deal shuffle and card encoding
- `macroxue-freecell/solver/node.h`
  - confirms the same executable deal logic and conservative autoplay policy
- `macroxue-freecell/solver/tableau.h`
  - useful reference for movable tail reasoning
- `GnikDroy-freecell/src/game/freecell.c`
  - validates move-capacity logic and clean validate/apply separation
- `gitbrent-FreecellJS/FreecellJS.html`
  - browser-first layout, iOS audio unlock, and practical HUD ideas
- `einaregilsson-cards.js/cards.js`
  - renderer abstraction, container layout, and animation ownership
- `adrianeyre-free-cell/src/index.ts`
  - small TypeScript app decomposition reference

## Translation Outcome

- rules were centralized in Rust
- browser lessons informed the UI shell, not the engine
- animation ideas informed Pixi abstractions, not the public API
- compatibility details informed the deal generator and autoplay logic
