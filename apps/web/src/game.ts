import type {
  EngineAction,
  GameSnapshot,
  SlotRef,
  StepResult,
  TurnRecord,
} from '@freecell/contracts';
import { tokens } from '@freecell/design-tokens';
import { Application, Container, type FederatedPointerEvent, Graphics, Text } from 'pixi.js';
import initFreecellWasm, { WasmGame } from './wasm/freecell_wasm/freecell_wasm';

type UiElements = {
  stageHost: HTMLElement;
  moves: HTMLElement;
  timer: HTMLElement;
  seed: HTMLElement;
  score: HTMLElement;
  status: HTMLElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  autoPlayButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
};

type TableauSelection = {
  source: SlotRef;
  count: number;
  cardIds: Set<number>;
};

type CardDescriptor = {
  cardId: number;
  shortLabel: string;
  color: 'black' | 'red';
  slot: SlotRef;
  row: number;
  x: number;
  y: number;
  zIndex: number;
};

type SlotDescriptor = {
  slot: SlotRef;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  occupied: boolean;
};

type SlotVisual = {
  container: Container;
  background: Graphics;
  label: Text;
};

type BoardLayout = {
  width: number;
  height: number;
  padding: number;
  gap: number;
  cardWidth: number;
  cardHeight: number;
  fanOffset: number;
  topRowY: number;
  tableauY: number;
};

type WasmGameApi = InstanceType<typeof WasmGame>;

class AudioDirector {
  private context: AudioContext | null = null;

  unlock(): void {
    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
    }

    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  playMove(turn: TurnRecord | null, terminal: boolean): void {
    if (!this.context) {
      return;
    }

    if (terminal) {
      this.playChord([523.25, 659.25, 783.99], 0.18);
      return;
    }

    if (turn && turn.foundationDelta > 0) {
      this.playTone(493.88, 0.08, 0.018);
      return;
    }

    this.playTone(392.0, 0.055, 0.012);
  }

  private playTone(frequency: number, duration: number, gainValue: number): void {
    if (!this.context) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  private playChord(frequencies: number[], duration: number): void {
    frequencies.forEach((frequency, index) => {
      window.setTimeout(() => {
        this.playTone(frequency, duration, 0.02);
      }, index * 48);
    });
  }
}

class CardVisual {
  public readonly container = new Container();

  private readonly shadow = new Graphics();
  private readonly body = new Container();
  private readonly bodyBase = new Graphics();
  private readonly bodySheen = new Graphics();
  private readonly labelTop = new Text();
  private readonly labelBottom = new Text();
  private readonly suitCenter = new Text();
  private readonly highlight = new Graphics();

  private targetX = 0;
  private targetY = 0;
  private currentScale = 1;
  private targetScale = 1;
  private width = 0;
  private height = 0;
  private onTap: () => void;

  constructor(onTap: () => void) {
    this.onTap = onTap;
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.onTap();
    });

    this.body.addChild(this.bodyBase, this.bodySheen);
    this.container.addChild(
      this.shadow,
      this.body,
      this.highlight,
      this.labelTop,
      this.labelBottom,
      this.suitCenter,
    );
  }

  setTapHandler(onTap: () => void): void {
    this.onTap = onTap;
  }

  setCard(label: string, isRed: boolean, width: number, height: number): void {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.redrawBase();
    }

    const cardColor = isRed ? tokens.color.red : tokens.color.black;
    const fontSize = Math.max(16, Math.round(width * 0.17));
    const centerSize = Math.max(28, Math.round(width * 0.33));

    this.labelTop.text = label;
    this.labelTop.style = {
      fill: cardColor,
      fontFamily: 'Aptos, "Segoe UI Variable Text", "Trebuchet MS", sans-serif',
      fontSize,
      fontWeight: '700',
    };
    this.labelTop.position.set(18, 16);

    this.labelBottom.text = label;
    this.labelBottom.style = this.labelTop.style;
    this.labelBottom.anchor.set(1, 1);
    this.labelBottom.position.set(width - 18, height - 16);

    this.suitCenter.text = label.slice(-1);
    this.suitCenter.style = {
      fill: cardColor,
      fontFamily: 'Iowan Old Style, "Palatino Linotype", serif',
      fontSize: centerSize,
      fontWeight: '700',
    };
    this.suitCenter.anchor.set(0.5);
    this.suitCenter.position.set(width * 0.5, height * 0.56);
  }

  setSelected(selected: boolean): void {
    this.targetScale = selected ? 1.03 : 1;
    this.highlight.clear();

    if (!selected) {
      return;
    }

    this.highlight
      .roundRect(0, 0, this.width, this.height, 20)
      .stroke({ width: 3, color: 0xf0de90, alpha: 0.95 });
  }

  setPose(x: number, y: number, zIndex: number): void {
    this.targetX = x;
    this.targetY = y;
    this.container.zIndex = zIndex;
  }

  snapToPose(): void {
    this.container.position.set(this.targetX, this.targetY);
    this.currentScale = this.targetScale;
    this.container.scale.set(this.currentScale);
  }

  tick(): void {
    this.container.x += (this.targetX - this.container.x) * 0.24;
    this.container.y += (this.targetY - this.container.y) * 0.24;
    this.currentScale += (this.targetScale - this.currentScale) * 0.18;
    this.container.scale.set(this.currentScale);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private redrawBase(): void {
    this.shadow.clear();
    this.shadow
      .roundRect(6, 10, this.width, this.height, 20)
      .fill({ color: 0x07120d, alpha: 0.16 });

    this.bodyBase.clear();
    this.bodyBase
      .roundRect(0, 0, this.width, this.height, 20)
      .fill({ color: 0xfaf7ef })
      .stroke({ width: 2, color: 0xd8cdb6, alpha: 1 });

    this.bodySheen.clear();
    this.bodySheen
      .roundRect(0, 0, this.width, this.height * 0.44, 20)
      .fill({ color: 0xffffff, alpha: 0.28 });
  }
}

class BoardRenderer {
  private readonly pixi = new Application();
  private readonly board = new Container();
  private readonly slotsLayer = new Container();
  private readonly cardsLayer = new Container();
  private readonly cardViews = new Map<number, CardVisual>();
  private readonly slotViews = new Map<string, SlotVisual>();

  private selection: TableauSelection | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onCardTap: (slot: SlotRef, row: number, cardId: number) => void,
    private readonly onSlotTap: (slot: SlotRef) => void,
  ) {}

  async init(): Promise<void> {
    await this.pixi.init({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resizeTo: this.host,
    });

    const canvas = this.pixi.canvas as HTMLCanvasElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.host.replaceChildren(canvas);

    this.board.sortableChildren = true;
    this.cardsLayer.sortableChildren = true;
    this.board.addChild(this.slotsLayer, this.cardsLayer);
    this.pixi.stage.addChild(this.board);
    this.pixi.ticker.add(() => this.tick());
  }

  render(snapshot: GameSnapshot, selection: TableauSelection | null): void {
    this.selection = selection;
    const layout = this.computeLayout(snapshot);

    this.drawSlots(snapshot, layout);
    this.drawCards(snapshot, layout);

    const totalCards =
      snapshot.tableau.reduce((sum, column) => sum + column.cards.length, 0) +
      snapshot.freecells.filter((slot) => slot.card).length +
      snapshot.foundations.filter((slot) => slot.topCard).length;
    this.host.dataset.cardCount = totalCards.toString();
    this.host.dataset.stateHash = snapshot.stateHash;
    this.host.dataset.engineStatus = snapshot.status;
    this.host.dataset.engineReady = 'true';
  }

  private computeLayout(snapshot: GameSnapshot): BoardLayout {
    const width = Math.max(this.host.clientWidth, 360);
    const height = Math.max(this.host.clientHeight, 720);
    const padding = Math.max(20, Math.round(width * 0.024));
    const gap = Math.max(12, Math.round(width * 0.014));
    const cardWidth = Math.min(132, Math.max(74, (width - padding * 2 - gap * 7) / 8));
    const cardHeight = Math.round(cardWidth * 1.42);
    const topRowY = padding;
    const tableauY = topRowY + cardHeight + 54;
    const tallestColumn = Math.max(...snapshot.tableau.map((column) => column.cards.length), 1);
    const availableTableHeight = height - tableauY - padding - cardHeight;
    const fanOffset = Math.max(18, Math.min(38, Math.floor(availableTableHeight / tallestColumn)));

    return {
      width,
      height,
      padding,
      gap,
      cardWidth,
      cardHeight,
      fanOffset,
      topRowY,
      tableauY,
    };
  }

  private drawSlots(snapshot: GameSnapshot, layout: BoardLayout): void {
    const descriptors: SlotDescriptor[] = [];

    snapshot.freecells.forEach((slot, index) => {
      descriptors.push({
        slot: { kind: 'freecell', index },
        x: layout.padding + index * (layout.cardWidth + layout.gap),
        y: layout.topRowY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        label: ['FREE 1', 'FREE 2', 'FREE 3', 'FREE 4'][index] ?? `FREE ${index + 1}`,
        occupied: Boolean(slot.card),
      });
    });

    snapshot.foundations.forEach((slot, index) => {
      const foundationStart =
        layout.width - layout.padding - (layout.cardWidth + layout.gap) * 4 + layout.gap;
      descriptors.push({
        slot: { kind: 'foundation', index },
        x: foundationStart + index * (layout.cardWidth + layout.gap),
        y: layout.topRowY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        label: slot.suit.toUpperCase(),
        occupied: Boolean(slot.topCard),
      });
    });

    snapshot.tableau.forEach((column, index) => {
      descriptors.push({
        slot: { kind: 'tableau', index },
        x: layout.padding + index * (layout.cardWidth + layout.gap),
        y: layout.tableauY,
        width: layout.cardWidth,
        height: layout.cardHeight,
        label: `COLUMN ${index + 1}`,
        occupied: column.cards.length > 0,
      });
    });

    const seen = new Set<string>();

    for (const descriptor of descriptors) {
      const key = this.slotKey(descriptor.slot);
      seen.add(key);
      const slotVisual = this.slotViews.get(key) ?? this.createSlotVisual(descriptor.slot);

      if (!this.slotViews.has(key)) {
        this.slotViews.set(key, slotVisual);
        this.slotsLayer.addChild(slotVisual.container);
      }

      slotVisual.container.position.set(descriptor.x, descriptor.y);
      slotVisual.background.clear();
      slotVisual.background
        .roundRect(0, 0, descriptor.width, descriptor.height, 20)
        .fill({
          color: descriptor.occupied ? 0x1a5e46 : 0x0d4232,
          alpha: descriptor.occupied ? 0.18 : 0.14,
        })
        .stroke({ width: 2, color: 0xf0de90, alpha: descriptor.occupied ? 0.28 : 0.16 });

      slotVisual.label.text = descriptor.label;
      slotVisual.label.style = {
        fill: 0xf5f1e8,
        fontFamily: 'Aptos, "Segoe UI Variable Text", "Trebuchet MS", sans-serif',
        fontSize: Math.max(13, Math.round(descriptor.width * 0.12)),
        fontWeight: '600',
      };
      slotVisual.label.position.set(14, descriptor.height - 28);
    }

    for (const [key, slotVisual] of this.slotViews) {
      if (!seen.has(key)) {
        slotVisual.container.destroy({ children: true });
        this.slotViews.delete(key);
      }
    }
  }

  private drawCards(snapshot: GameSnapshot, layout: BoardLayout): void {
    const descriptors = new Map<number, CardDescriptor>();
    let zIndex = 1;

    snapshot.freecells.forEach((slot, index) => {
      if (!slot.card) {
        return;
      }
      descriptors.set(slot.card.id, {
        cardId: slot.card.id,
        shortLabel: slot.card.shortLabel,
        color: slot.card.color,
        slot: { kind: 'freecell', index },
        row: 0,
        x: layout.padding + index * (layout.cardWidth + layout.gap),
        y: layout.topRowY,
        zIndex: zIndex++,
      });
    });

    snapshot.foundations.forEach((slot, index) => {
      if (!slot.topCard) {
        return;
      }
      const foundationStart =
        layout.width - layout.padding - (layout.cardWidth + layout.gap) * 4 + layout.gap;
      descriptors.set(slot.topCard.id, {
        cardId: slot.topCard.id,
        shortLabel: slot.topCard.shortLabel,
        color: slot.topCard.color,
        slot: { kind: 'foundation', index },
        row: 0,
        x: foundationStart + index * (layout.cardWidth + layout.gap),
        y: layout.topRowY,
        zIndex: zIndex++,
      });
    });

    snapshot.tableau.forEach((column, columnIndex) => {
      column.cards.forEach((card, row) => {
        descriptors.set(card.id, {
          cardId: card.id,
          shortLabel: card.shortLabel,
          color: card.color,
          slot: { kind: 'tableau', index: columnIndex },
          row,
          x: layout.padding + columnIndex * (layout.cardWidth + layout.gap),
          y: layout.tableauY + row * layout.fanOffset,
          zIndex: zIndex++,
        });
      });
    });

    const selectedIds = this.selection?.cardIds ?? new Set<number>();

    for (const descriptor of descriptors.values()) {
      const view =
        this.cardViews.get(descriptor.cardId) ??
        new CardVisual(() => this.onCardTap(descriptor.slot, descriptor.row, descriptor.cardId));

      if (!this.cardViews.has(descriptor.cardId)) {
        this.cardViews.set(descriptor.cardId, view);
        this.cardsLayer.addChild(view.container);
      }

      view.setTapHandler(() => this.onCardTap(descriptor.slot, descriptor.row, descriptor.cardId));
      view.setCard(
        descriptor.shortLabel,
        descriptor.color === 'red',
        layout.cardWidth,
        layout.cardHeight,
      );
      view.setSelected(selectedIds.has(descriptor.cardId));
      view.setPose(descriptor.x, descriptor.y, descriptor.zIndex);

      if (view.container.x === 0 && view.container.y === 0) {
        view.snapToPose();
      }
    }

    for (const [cardId, view] of this.cardViews) {
      if (descriptors.has(cardId)) {
        continue;
      }

      view.destroy();
      this.cardViews.delete(cardId);
    }
  }

  private tick(): void {
    for (const view of this.cardViews.values()) {
      view.tick();
    }
  }

  private slotKey(slot: SlotRef): string {
    return `${slot.kind}:${slot.index}`;
  }

  private createSlotVisual(slot: SlotRef): SlotVisual {
    const container = new Container();
    const background = new Graphics();
    const label = new Text();

    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.onSlotTap(slot);
    });
    container.addChild(background, label);

    return { container, background, label };
  }
}

class EngineBridge {
  private ready = false;
  private wasmGame!: WasmGameApi;

  async initialize(seed: number): Promise<GameSnapshot> {
    if (!this.ready) {
      await initFreecellWasm();
      this.ready = true;
    }

    this.wasmGame = WasmGame.withPolicy(seed, 'safe');
    return this.getState();
  }

  getState(): GameSnapshot {
    return this.wasmGame.getState() as GameSnapshot;
  }

  reset(seed: number): GameSnapshot {
    return this.wasmGame.reset(seed) as GameSnapshot;
  }

  legalActions(): EngineAction[] {
    return this.wasmGame.legalActions() as EngineAction[];
  }

  stepAction(action: EngineAction): StepResult {
    return this.wasmGame.stepAction(action) as StepResult;
  }

  runAutoPlay(): TurnRecord | null {
    return this.wasmGame.runAutoPlay() as TurnRecord | null;
  }

  undo(): GameSnapshot {
    return this.wasmGame.undo() as GameSnapshot;
  }

  redo(): GameSnapshot {
    return this.wasmGame.redo() as GameSnapshot;
  }

  exportReplay(): unknown {
    return this.wasmGame.exportReplay();
  }

  canUndo(): boolean {
    return this.wasmGame.canUndo();
  }

  canRedo(): boolean {
    return this.wasmGame.canRedo();
  }
}

export class FreecellShell {
  private readonly engine = new EngineBridge();
  private readonly audio = new AudioDirector();
  private readonly renderer: BoardRenderer;
  private snapshot!: GameSnapshot;
  private selection: TableauSelection | null = null;
  private startedAt = performance.now();
  private timerHandle: number | null = null;
  private currentSeed = 1;
  private isReady = false;

  constructor(private readonly elements: UiElements) {
    this.renderer = new BoardRenderer(
      elements.stageHost,
      (slot, row, cardId) => this.handleCardTap(slot, row, cardId),
      (slot) => this.handleSlotTap(slot),
    );

    this.elements.stageHost.dataset.engineReady = 'false';
    this.elements.stageHost.dataset.cardCount = '0';
    this.elements.stageHost.dataset.engineStatus = 'loading';
    this.setControlsDisabled(true);

    elements.undoButton.addEventListener('click', () => this.undo());
    elements.redoButton.addEventListener('click', () => this.redo());
    elements.autoPlayButton.addEventListener('click', () => this.runAutoPlay());
    elements.newGameButton.addEventListener('click', () => this.newGame());
    elements.restartButton.addEventListener('click', () => this.restart());
  }

  async start(seed = 1): Promise<void> {
    this.isReady = false;
    this.elements.status.textContent = 'Loading engine…';
    this.elements.stageHost.dataset.engineReady = 'false';
    this.setControlsDisabled(true);
    await this.renderer.init();
    this.currentSeed = seed;
    this.snapshot = await this.engine.initialize(seed);
    this.startedAt = performance.now();
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
    }
    this.timerHandle = window.setInterval(() => this.updateHud(), 1000);
    this.isReady = true;
    this.elements.status.textContent =
      'Safe auto-play is enabled. Tap a card or run, then tap a destination.';
    this.render();
  }

  private handleCardTap(slot: SlotRef, row: number, cardId: number): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();

    if (this.selection) {
      if (this.sameSlot(this.selection.source, slot)) {
        this.selection = this.buildSelection(slot, row, cardId) ?? null;
        this.render();
        return;
      }

      this.tryMove(slot, row, cardId);
      return;
    }

    this.selection = this.buildSelection(slot, row, cardId);
    this.render();
  }

  private handleSlotTap(slot: SlotRef): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();

    if (!this.selection) {
      return;
    }

    this.tryMove(slot);
  }

  private buildSelection(slot: SlotRef, row: number, cardId: number): TableauSelection | null {
    if (slot.kind === 'tableau') {
      const column = this.snapshot.tableau[slot.index];
      if (!column) {
        return null;
      }

      const firstMovableRow = column.cards.length - column.movableRunLength;
      if (row < firstMovableRow) {
        this.elements.status.textContent =
          'Only the movable run at the end of a column can be selected.';
        return null;
      }

      const selectedCards = column.cards.slice(row).map((card) => card.id);
      return {
        source: slot,
        count: column.cards.length - row,
        cardIds: new Set(selectedCards),
      };
    }

    if (slot.kind === 'freecell') {
      const cell = this.snapshot.freecells[slot.index];
      if (!cell) {
        return null;
      }

      if (!cell.card || cell.card.id !== cardId) {
        return null;
      }

      return {
        source: slot,
        count: 1,
        cardIds: new Set([cardId]),
      };
    }

    const foundation = this.snapshot.foundations[slot.index];
    if (!foundation) {
      return null;
    }

    if (!foundation.topCard || foundation.topCard.id !== cardId) {
      return null;
    }

    return {
      source: slot,
      count: 1,
      cardIds: new Set([cardId]),
    };
  }

  private tryMove(destination: SlotRef, row?: number, cardId?: number): void {
    if (!this.selection) {
      return;
    }

    const action: EngineAction = {
      actionIndex: null,
      source: this.selection.source,
      destination,
      count: this.selection.count,
    };

    const result = this.engine.stepAction(action);
    if (!result.applied) {
      if (row !== undefined && cardId !== undefined) {
        this.selection = this.buildSelection(destination, row, cardId);
      }
      this.elements.status.textContent = result.illegalReason ?? 'That move is not legal.';
      this.render();
      return;
    }

    this.selection = null;
    this.snapshot = result.state;
    this.audio.playMove(result.turn, result.terminal);
    this.elements.status.textContent = result.terminal
      ? 'Game won. Replay export is ready from the live engine state.'
      : result.turn?.foundationDelta
        ? 'Foundation progress.'
        : 'Move applied.';
    this.render();
  }

  private undo(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.selection = null;
    this.snapshot = this.engine.undo();
    this.elements.status.textContent = 'Undid the last turn.';
    this.render();
  }

  private redo(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.selection = null;
    this.snapshot = this.engine.redo();
    this.elements.status.textContent = 'Replayed the next turn.';
    this.render();
  }

  private runAutoPlay(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    const turn = this.engine.runAutoPlay();
    if (!turn) {
      this.elements.status.textContent = 'No safe auto-play move is available right now.';
      return;
    }

    this.selection = null;
    this.snapshot = this.engine.getState();
    this.audio.playMove(turn, this.snapshot.status === 'won');
    this.elements.status.textContent = 'Auto-play sent safe cards to the foundations.';
    this.render();
  }

  private async newGame(): Promise<void> {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    const randomSeedBuffer = new Uint32Array(1);
    crypto.getRandomValues(randomSeedBuffer);
    const randomValue = (randomSeedBuffer[0] ?? 1) % 1_000_000_000;
    this.currentSeed = Math.max(1, randomValue);
    this.snapshot = this.engine.reset(this.currentSeed);
    this.startedAt = performance.now();
    this.selection = null;
    this.elements.status.textContent = 'New deal generated from a deterministic seed.';
    this.render();
  }

  private restart(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.snapshot = this.engine.reset(this.currentSeed);
    this.startedAt = performance.now();
    this.selection = null;
    this.elements.status.textContent = 'Current seed restarted.';
    this.render();
  }

  private render(): void {
    this.renderer.render(this.snapshot, this.selection);
    this.updateHud();
  }

  private updateHud(): void {
    if (!this.snapshot) {
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((performance.now() - this.startedAt) / 1000));
    this.elements.moves.textContent = this.snapshot.moveCount.toString();
    this.elements.timer.textContent = formatDuration(elapsedSeconds);
    this.elements.seed.textContent = this.currentSeed.toString();
    this.elements.score.textContent = this.snapshot.score.toString();
    this.elements.undoButton.disabled = !this.isReady || !this.engine.canUndo();
    this.elements.redoButton.disabled = !this.isReady || !this.engine.canRedo();
    this.elements.autoPlayButton.disabled = !this.isReady || this.snapshot.status === 'won';
    this.elements.restartButton.disabled = !this.isReady;
    this.elements.newGameButton.disabled = !this.isReady;
  }

  private sameSlot(left: SlotRef, right: SlotRef): boolean {
    return left.kind === right.kind && left.index === right.index;
  }

  destroy(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
    }
  }

  private setControlsDisabled(disabled: boolean): void {
    this.elements.undoButton.disabled = disabled;
    this.elements.redoButton.disabled = disabled;
    this.elements.autoPlayButton.disabled = disabled;
    this.elements.restartButton.disabled = disabled;
    this.elements.newGameButton.disabled = disabled;
  }
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${seconds}`;
}
