# Testing

## Current Test Pyramid

- Rust unit tests for rule correctness and replay/history behavior
- Rust property tests for invariants
- Python smoke tests for the binding surface
- Playwright E2E tests for the browser shell
- Criterion benchmark scaffolding for engine hot paths

## Commands

```bash
pnpm test:engine
pnpm test:e2e
pnpm test
pnpm bench:engine
```

## Engine Invariants Covered

- same seed produces the same initial deck ordering
- legal action masks match actual legal actions
- undo and redo round-trip exact state hashes
- replay export reproduces the final state hash
- safe autoplay respects the conservative progression rule
- undoing arbitrary legal sequences returns to the initial hash

## Python Binding Coverage

The smoke suite verifies:

- module install and import
- state shape after reset
- legal action mask alignment with serialized actions
- stepping and replay export
- invalid action rejection

## Browser Coverage

Playwright currently verifies:

- the engine-backed HUD loads
- deterministic seed boot for the initial deal
- new game changes the seed
- restart preserves the seed and resets move count
- autoplay button produces deterministic status feedback
- desktop and tablet-sized layouts both boot successfully

## Benchmark Scope

The initial Criterion suite measures:

- seeded engine construction
- snapshot generation
- legal action generation

See `tools/benchmarks/README.md`.

## Known Limits

- no dedicated WebKit automation yet
- no solver regression corpus yet
- browser E2E focuses on HUD and engine integration, not final drag UX
