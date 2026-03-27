import '../../../packages/design_tokens/src/tokens.css';
import './style.css';

import { FreecellShell } from './game';

function queryRequired<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Required element not found: ${selector}`);
  }

  return element;
}

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Application root was not found.');
}

root.innerHTML = `
  <main class="app-shell">
    <section class="hero-panel">
      <div>
        <p class="eyebrow">FreeCell</p>
        <h1>Engine-first FreeCell for web, Wasm, and AI.</h1>
        <p class="hero-copy">
          Deterministic Microsoft-style deals, Rust core logic, premium PixiJS rendering,
          replay-ready state, and bindings prepared for large-scale headless training.
        </p>
      </div>
      <div class="hero-stats" aria-label="Project highlights">
        <span>Rust engine</span>
        <span>Wasm browser runtime</span>
        <span>Python RL hooks</span>
      </div>
    </section>

    <section class="table-shell" aria-label="FreeCell game">
      <header class="hud" aria-label="Game controls and status">
        <div class="hud-group hud-group--metrics">
          <div class="metric-card">
            <span class="metric-label">Moves</span>
            <strong id="moves">0</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">Time</span>
            <strong id="timer">00:00</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">Seed</span>
            <strong id="seed">1</strong>
          </div>
          <div class="metric-card">
            <span class="metric-label">Score</span>
            <strong id="score">0</strong>
          </div>
        </div>

        <div class="hud-group hud-group--actions">
          <button id="undo-button" type="button">Undo</button>
          <button id="redo-button" type="button">Redo</button>
          <button id="auto-play-button" type="button">Auto-play</button>
          <button id="restart-button" type="button">Restart</button>
          <button id="new-game-button" type="button" class="button-accent">New Game</button>
        </div>
      </header>

      <div class="status-bar" role="status" aria-live="polite">
        <span class="status-indicator"></span>
        <span id="status">Loading engine...</span>
      </div>

      <section id="board-stage" class="board-stage" aria-label="Play area"></section>
    </section>
  </main>
`;

const shell = new FreecellShell({
  stageHost: queryRequired<HTMLElement>('#board-stage'),
  moves: queryRequired<HTMLElement>('#moves'),
  timer: queryRequired<HTMLElement>('#timer'),
  seed: queryRequired<HTMLElement>('#seed'),
  score: queryRequired<HTMLElement>('#score'),
  status: queryRequired<HTMLElement>('#status'),
  undoButton: queryRequired<HTMLButtonElement>('#undo-button'),
  redoButton: queryRequired<HTMLButtonElement>('#redo-button'),
  autoPlayButton: queryRequired<HTMLButtonElement>('#auto-play-button'),
  newGameButton: queryRequired<HTMLButtonElement>('#new-game-button'),
  restartButton: queryRequired<HTMLButtonElement>('#restart-button'),
});

void shell.start(1);

window.addEventListener('beforeunload', () => {
  shell.destroy();
});
