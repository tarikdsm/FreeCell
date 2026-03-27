# FreeCell

Modern FreeCell for browser, Wasm, and AI workflows.

This repository starts from a clean slate: a deterministic Rust engine owns every game rule, the browser consumes that engine through WebAssembly, and Python bindings expose the same semantics for headless simulation and future RL training.

## What Ships In The First Delivery

- Rust engine with full FreeCell state, move validation, multi-move capacity checks, undo/redo, replay export, autoplay policies, and deterministic state hashes
- Microsoft-style seeded deal generation validated against the reference logic studied from legacy repositories
- Wasm binding used by the real browser app
- Python binding exposing `reset`, `get_state`, `legal_actions`, `legal_action_mask`, `step`, `is_terminal`, `score_helper`, and `export_replay`
- PixiJS v8 web client with premium table shell, HUD, basic audio, and deterministic engine-backed play
- Playwright E2E coverage, Python smoke tests, property tests, and benchmark scaffolding
- Research audit and architecture docs for immediate continuation

## Workspace Layout

```text
/
  apps/
    web/
  crates/
    freecell_engine/
    freecell_wasm/
    freecell_py/
  packages/
    contracts/
    design_tokens/
  tests/
    e2e/
    engine/
  tools/
    audits/
    benchmarks/
    scripts/
  docs/
```

## Architecture Summary

- `crates/freecell_engine`: single source of truth for deals, rules, history, replay, serialization, and AI-facing stepping
- `crates/freecell_wasm`: browser adapter for the Rust engine
- `crates/freecell_py`: Python adapter for experimentation and training loops
- `apps/web`: TypeScript + PixiJS shell that renders snapshots and emits engine actions
- `packages/contracts`: shared snapshot and action contracts for TypeScript consumers
- `packages/design_tokens`: colors, spacing, radius, and motion primitives for the web shell

## Prerequisites

- Node.js 22+
- `pnpm` 10+
- Python 3.11+
- Rust stable
- `wasm32-unknown-unknown` target installed
- `wasm-pack`
- `maturin`
- Playwright Chromium for local E2E runs

The repo includes small wrappers under `tools/scripts/` so root scripts can still find `cargo` and `wasm-pack` from `~/.cargo/bin` on machines where PATH is incomplete.

## Quick Start

```bash
pnpm install
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
python -m pip install maturin pytest
pnpm --filter @freecell/e2e exec playwright install chromium
pnpm dev
```

Open `http://127.0.0.1:4173`.

## Common Commands

```bash
pnpm build
pnpm build:web
pnpm lint
pnpm test
pnpm test:engine
pnpm test:e2e
pnpm bench:engine
```

## Validation Performed

The initial delivery has already been validated with:

- `pnpm --filter @freecell/web build`
- `python -m pytest tests/engine -q`
- `pnpm --filter @freecell/e2e test`
- `cargo bench -p freecell_engine --no-run`

## Compatibility Note

The current deal generator matches the Microsoft-style shuffle logic observed in:

- `tools/audits/repos/macroxue-freecell/game/deck.js`
- `tools/audits/repos/macroxue-freecell/solver/node.h`

During the audit, the hard-coded sample strings in `tools/audits/repos/macroxue-freecell/solver/deals.cc` did not align with that executable logic. The engine follows the executable logic and documents the mismatch in the research audit.

## Documentation

- [Architecture](./docs/architecture.md)
- [Engine](./docs/engine.md)
- [Web](./docs/web.md)
- [AI](./docs/ai.md)
- [Testing](./docs/testing.md)
- [Research Audit](./docs/research-audit.md)
- [Roadmap](./docs/roadmap.md)
- [Initial Delivery Report](./docs/initial-delivery-report.md)

## Current Gaps

- A full solver port is not in this first delivery, but the engine surface is already shaped for hints and solver integration.
- The web client currently uses click-to-select interaction instead of the final drag stack UX.
- Dedicated WebKit automation is still pending even though the layout and input model already target tablet use.
