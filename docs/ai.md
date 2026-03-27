# AI

## Design Goal

The project is being prepared from day one for headless simulation and learning workflows. The engine is not a browser game with AI retrofitted later; it already exposes an environment-style API.

## Current Surfaces

### Rust

`FreecellEnvironment` exposes:

- `reset(seed)`
- `get_state()`
- `legal_actions()`
- `legal_action_mask()`
- `hint(options)`
- `step(action)`
- `is_terminal()`
- `score_helper()`
- `export_replay()`

### Python

`freecell_py.FreecellEnv` exposes the same core surface:

- `FreecellEnv(seed=1, auto_play_policy="off")`
- `reset(seed)`
- `get_state()`
- `legal_actions()`
- `legal_action_mask()`
- `hint(max_depth=12, max_nodes=2500)`
- `step(action_index)`
- `is_terminal()`
- `score_helper()`
- `export_replay()`
- `set_auto_play_policy(policy)`

## State Representation

The environment returns a stable serialized snapshot containing:

- current seed and deal mode
- full tableau, freecell, and foundation views
- legal move capacity
- score
- terminal status
- deterministic state hash

This is suitable for:

- tabular feature extraction
- replay datasets
- imitation learning
- curriculum generation by seed

## Action Representation

Two action styles exist:

- structured actions with slot references and count
- encoded action indices over a fixed action space of 3120 elements

The current Python `step` method consumes the encoded index. `legal_actions()` returns the structured actions, each carrying its `actionIndex` when encodable.

## Legal Action Mask

The legal mask is emitted as a fixed-length vector aligned to the global action space. This is the core primitive needed for policy masking in RL pipelines.

## Reward Helper

The current environment keeps rules and reward shaping separate.

Default shaping behavior:

- illegal move penalty: `0.0`
- foundation gain reward: `1.0` per foundation advancement
- win bonus: `52.0`

This is intentionally conservative and can evolve without changing rule semantics.

## Dataset Readiness

Already supported:

- deterministic reset by seed
- stable snapshot serialization
- solver-backed hint serialization
- replay export
- state-hash based regression validation

Suggested near-term additions:

- tensor-friendly observation encoder
- batched rollout helper
- Gymnasium wrapper
- seed corpora tagged by difficulty

## Important Separation

- AI code must not depend on PixiJS or browser APIs
- UI code must not define reward or rule semantics
- solver logic must remain separate from rendering concerns
