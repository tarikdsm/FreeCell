use criterion::{BatchSize, Criterion, black_box, criterion_group, criterion_main};
use freecell_engine::Game;

fn benchmark_seeded_initialization(c: &mut Criterion) {
    c.bench_function("engine/new_seed_11982", |b| {
        b.iter(|| black_box(Game::new(black_box(11_982))))
    });
}

fn benchmark_initial_snapshot(c: &mut Criterion) {
    c.bench_function("engine/snapshot_seed_11982", |b| {
        b.iter_batched(
            || Game::new(11_982),
            |game| black_box(game.snapshot()),
            BatchSize::SmallInput,
        )
    });
}

fn benchmark_legal_actions(c: &mut Criterion) {
    c.bench_function("engine/legal_actions_seed_11982", |b| {
        b.iter_batched(
            || Game::new(11_982),
            |game| black_box(game.legal_actions()),
            BatchSize::SmallInput,
        )
    });
}

criterion_group!(
    benches,
    benchmark_seeded_initialization,
    benchmark_initial_snapshot,
    benchmark_legal_actions
);
criterion_main!(benches);
