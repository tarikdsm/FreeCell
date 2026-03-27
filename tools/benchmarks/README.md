# Engine Benchmarks

The initial benchmark suite focuses on deterministic engine hot paths that matter for browser responsiveness and AI-scale simulation:

- seeded game initialization
- snapshot generation for renderer and replay systems
- legal action generation for solvers and RL agents

Run the current suite with:

```bash
pnpm bench:engine
```

The first benchmark seed is `11982`, a stable regression case that is reused in docs and future comparisons. Expand this folder with benchmark notes, baselines, and additional seed corpora as profiling matures.
