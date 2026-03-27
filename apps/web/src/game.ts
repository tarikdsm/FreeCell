import type {
  EngineAction,
  GameSnapshot,
  HintAnalysis,
  SlotRef,
  TurnRecord,
} from '@freecell/contracts';
import { tokens } from '@freecell/design-tokens';
import { Application, Container, type FederatedPointerEvent, Graphics, Text } from 'pixi.js';
import { AudioDirector } from './audio';
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
  hintButton: HTMLButtonElement;
  autoPlayButton: HTMLButtonElement;
  newGameButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
};

type DragSelection = {
  source: SlotRef;
  count: number;
  cardIds: Set<number>;
  anchorCardId: number;
};

type PointerPoint = {
  x: number;
  y: number;
  pointerId: number;
};

type DragSession = {
  selection: DragSelection;
  anchorCardId: number;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  dragDistance: number;
  pickupPlayed: boolean;
  hoverSlot: SlotRef | null;
  hoverLegal: boolean;
};

type HintOverlayState = {
  analysis: HintAnalysis;
  cardIds: Set<number>;
  destination: SlotRef | null;
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
  hitHeight: number;
  label: string;
  occupied: boolean;
};

type SlotEmphasis = {
  slot: SlotRef;
  tone: 'drag' | 'hint';
  legal: boolean;
};

type DragPreview = {
  cardIds: Set<number>;
  anchorCardId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  engaged: boolean;
};

type BoardOverlay = {
  highlightedCardIds: Set<number>;
  slotEmphasis: SlotEmphasis | null;
  dragPreview: DragPreview | null;
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

const DRAG_THRESHOLD = 12;

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
  private targetScale = 1;
  private currentScale = 1;
  private targetRotation = 0;
  private currentRotation = 0;
  private dragging = false;
  private width = 0;
  private height = 0;
  private onPress: (event: FederatedPointerEvent) => void;

  constructor(onPress: (event: FederatedPointerEvent) => void) {
    this.onPress = onPress;
    this.container.eventMode = 'static';
    this.container.cursor = 'grab';
    this.container.on('pointerdown', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.onPress(event);
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

  setPressHandler(onPress: (event: FederatedPointerEvent) => void): void {
    this.onPress = onPress;
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

  setFocusState(highlighted: boolean, dragging: boolean): void {
    this.dragging = dragging;
    this.targetScale = dragging ? 1.045 : highlighted ? 1.018 : 1;
    this.shadow.alpha = dragging ? 1.3 : highlighted ? 1.1 : 1;
    this.container.cursor = dragging ? 'grabbing' : 'grab';
    this.highlight.clear();

    if (dragging) {
      this.highlight
        .roundRect(-2, -2, this.width + 4, this.height + 4, 22)
        .stroke({ width: 3, color: 0x8ce0b3, alpha: 0.98 });
      return;
    }

    if (highlighted) {
      this.highlight
        .roundRect(-1, -1, this.width + 2, this.height + 2, 21)
        .stroke({ width: 3, color: 0xf0de90, alpha: 0.92 });
    }
  }

  setPose(x: number, y: number, zIndex: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetRotation = this.dragging
      ? Math.max(-0.03, Math.min(0.03, (x - this.container.x) * 0.0012))
      : 0;
    this.container.zIndex = zIndex;
  }

  snapToPose(): void {
    this.container.position.set(this.targetX, this.targetY);
    this.currentScale = this.targetScale;
    this.currentRotation = this.targetRotation;
    this.container.scale.set(this.currentScale);
    this.container.rotation = this.currentRotation;
  }

  tick(): void {
    const positionEase = this.dragging ? 0.42 : 0.24;
    const scaleEase = this.dragging ? 0.24 : 0.18;

    this.container.x += (this.targetX - this.container.x) * positionEase;
    this.container.y += (this.targetY - this.container.y) * positionEase;
    this.currentScale += (this.targetScale - this.currentScale) * scaleEase;
    this.currentRotation += (this.targetRotation - this.currentRotation) * 0.2;
    this.container.scale.set(this.currentScale);
    this.container.rotation = this.currentRotation;
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
  private pixi = new Application();
  private readonly board = new Container();
  private readonly slotsLayer = new Container();
  private readonly cardsLayer = new Container();
  private readonly cardViews = new Map<number, CardVisual>();
  private readonly slotViews = new Map<string, SlotVisual>();
  private readonly slotBounds = new Map<string, SlotDescriptor>();
  private readonly cardDescriptors = new Map<number, CardDescriptor>();

  private initialized = false;
  private overlay: BoardOverlay = {
    highlightedCardIds: new Set<number>(),
    slotEmphasis: null,
    dragPreview: null,
  };
  private activePointerId: number | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onCardPress: (
      slot: SlotRef,
      row: number,
      cardId: number,
      point: PointerPoint,
    ) => void,
    private readonly onPointerMove: (point: PointerPoint) => void,
    private readonly onPointerRelease: (point: PointerPoint, canceled: boolean) => void,
  ) {}

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initOptions = {
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resizeTo: this.host,
    } as const;

    try {
      await this.pixi.init(initOptions);
    } catch (error) {
      console.warn('Falling back to the Pixi canvas renderer for this environment.', error);
      this.pixi = new Application();
      await this.pixi.init({
        ...initOptions,
        preference: 'canvas',
      });
    }

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
    this.initialized = true;
  }

  render(snapshot: GameSnapshot, overlay: BoardOverlay): void {
    this.overlay = overlay;
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

  getCardPose(cardId: number): { x: number; y: number } | null {
    const descriptor = this.cardDescriptors.get(cardId);

    if (!descriptor) {
      return null;
    }

    return { x: descriptor.x, y: descriptor.y };
  }

  slotAtPoint(x: number, y: number): SlotRef | null {
    for (const descriptor of this.slotBounds.values()) {
      const withinX = x >= descriptor.x && x <= descriptor.x + descriptor.width;
      const withinY = y >= descriptor.y && y <= descriptor.y + descriptor.hitHeight;

      if (withinX && withinY) {
        return descriptor.slot;
      }
    }

    return null;
  }

  getDebugState(): {
    cards: Record<string, { x: number; y: number; row: number; slot: SlotRef }>;
    slots: Record<
      string,
      { x: number; y: number; width: number; height: number; hitHeight: number }
    >;
  } {
    return {
      cards: Object.fromEntries(
        Array.from(this.cardDescriptors.entries(), ([cardId, descriptor]) => [
          cardId.toString(),
          {
            x: descriptor.x,
            y: descriptor.y,
            row: descriptor.row,
            slot: descriptor.slot,
          },
        ]),
      ),
      slots: Object.fromEntries(
        Array.from(this.slotBounds.entries(), ([key, descriptor]) => [
          key,
          {
            x: descriptor.x,
            y: descriptor.y,
            width: descriptor.width,
            height: descriptor.height,
            hitHeight: descriptor.hitHeight,
          },
        ]),
      ),
    };
  }

  destroy(): void {
    this.releasePointerCapture();
    if (this.initialized) {
      this.pixi.destroy(true, { children: true });
      this.initialized = false;
    }
  }

  private computeLayout(snapshot: GameSnapshot): BoardLayout {
    const width = Math.max(this.host.clientWidth, 360);
    const height = Math.max(this.host.clientHeight, 460);
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
        hitHeight: layout.cardHeight,
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
        hitHeight: layout.cardHeight,
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
        hitHeight: layout.height - layout.tableauY - layout.padding,
        label: `COLUMN ${index + 1}`,
        occupied: column.cards.length > 0,
      });
    });

    this.slotBounds.clear();
    const seen = new Set<string>();

    for (const descriptor of descriptors) {
      const key = slotKey(descriptor.slot);
      seen.add(key);
      this.slotBounds.set(key, descriptor);
      const slotVisual = this.slotViews.get(key) ?? this.createSlotVisual();

      if (!this.slotViews.has(key)) {
        this.slotViews.set(key, slotVisual);
        this.slotsLayer.addChild(slotVisual.container);
      }

      const emphasized =
        this.overlay.slotEmphasis && sameSlot(this.overlay.slotEmphasis.slot, descriptor.slot)
          ? this.overlay.slotEmphasis
          : null;

      slotVisual.container.position.set(descriptor.x, descriptor.y);
      slotVisual.background.clear();

      let fillColor = descriptor.occupied ? 0x1a5e46 : 0x0d4232;
      let fillAlpha = descriptor.occupied ? 0.18 : 0.14;
      let strokeColor = 0xf0de90;
      let strokeAlpha = descriptor.occupied ? 0.28 : 0.16;
      let strokeWidth = 2;

      if (emphasized) {
        if (emphasized.tone === 'hint') {
          fillColor = 0x4a6342;
          fillAlpha = 0.26;
          strokeColor = 0xf0de90;
          strokeAlpha = 0.92;
          strokeWidth = 3;
        } else if (emphasized.legal) {
          fillColor = 0x1f6e57;
          fillAlpha = 0.26;
          strokeColor = 0x8ce0b3;
          strokeAlpha = 0.96;
          strokeWidth = 3;
        } else {
          fillColor = 0x6a2833;
          fillAlpha = 0.22;
          strokeColor = 0xf48686;
          strokeAlpha = 0.9;
          strokeWidth = 3;
        }
      }

      slotVisual.background
        .roundRect(0, 0, descriptor.width, descriptor.height, 20)
        .fill({ color: fillColor, alpha: fillAlpha })
        .stroke({ width: strokeWidth, color: strokeColor, alpha: strokeAlpha });

      slotVisual.label.text = descriptor.label;
      slotVisual.label.style = {
        fill: emphasized && emphasized.tone === 'drag' && emphasized.legal ? 0xe9fff4 : 0xf5f1e8,
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

    this.cardDescriptors.clear();
    descriptors.forEach((descriptor, cardId) => {
      this.cardDescriptors.set(cardId, descriptor);
    });

    const highlightedIds = this.overlay.highlightedCardIds;
    const dragPreview = this.overlay.dragPreview;
    const dragAnchor = dragPreview ? descriptors.get(dragPreview.anchorCardId) : null;

    for (const descriptor of descriptors.values()) {
      const view =
        this.cardViews.get(descriptor.cardId) ??
        new CardVisual((event) => this.handleCardPointerDown(event, descriptor));

      if (!this.cardViews.has(descriptor.cardId)) {
        this.cardViews.set(descriptor.cardId, view);
        this.cardsLayer.addChild(view.container);
      }

      view.setPressHandler((event) => this.handleCardPointerDown(event, descriptor));
      view.setCard(
        descriptor.shortLabel,
        descriptor.color === 'red',
        layout.cardWidth,
        layout.cardHeight,
      );

      const isDragged = dragPreview?.cardIds.has(descriptor.cardId) ?? false;
      view.setFocusState(
        highlightedIds.has(descriptor.cardId),
        isDragged && !!dragPreview?.engaged,
      );

      if (isDragged && dragPreview && dragAnchor) {
        const deltaX = descriptor.x - dragAnchor.x;
        const deltaY = descriptor.y - dragAnchor.y;
        view.setPose(
          dragPreview.x - dragPreview.offsetX + deltaX,
          dragPreview.y - dragPreview.offsetY + deltaY,
          10_000 + descriptor.row,
        );
      } else {
        view.setPose(descriptor.x, descriptor.y, descriptor.zIndex);
      }

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

  private createSlotVisual(): SlotVisual {
    const container = new Container();
    const background = new Graphics();
    const label = new Text();

    container.addChild(background, label);

    return { container, background, label };
  }

  private handleCardPointerDown(event: FederatedPointerEvent, descriptor: CardDescriptor): void {
    this.capturePointer(event.pointerId);
    this.onCardPress(descriptor.slot, descriptor.row, descriptor.cardId, {
      x: event.global.x,
      y: event.global.y,
      pointerId: event.pointerId,
    });
  }

  private capturePointer(pointerId: number): void {
    this.releasePointerCapture();
    this.activePointerId = pointerId;
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerCancel);
  }

  private releasePointerCapture(): void {
    if (this.activePointerId === null) {
      return;
    }

    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerCancel);
    this.activePointerId = null;
  }

  private readonly handleWindowPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    this.onPointerMove(this.toLocalPoint(event));
  };

  private readonly handleWindowPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    const point = this.toLocalPoint(event);
    this.releasePointerCapture();
    this.onPointerRelease(point, false);
  };

  private readonly handleWindowPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    const point = this.toLocalPoint(event);
    this.releasePointerCapture();
    this.onPointerRelease(point, true);
  };

  private toLocalPoint(event: PointerEvent): PointerPoint {
    const rect = this.host.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pointerId: event.pointerId,
    };
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

  hint(): HintAnalysis {
    return this.wasmGame.hint() as HintAnalysis;
  }

  stepAction(action: EngineAction) {
    return this.wasmGame.stepAction(action);
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
  private startedAt = performance.now();
  private timerHandle: number | null = null;
  private currentSeed = 1;
  private isReady = false;
  private dragSession: DragSession | null = null;
  private hintOverlay: HintOverlayState | null = null;
  private legalActionKeys = new Set<string>();

  constructor(private readonly elements: UiElements) {
    this.renderer = new BoardRenderer(
      elements.stageHost,
      (slot, row, cardId, point) => this.handleCardPress(slot, row, cardId, point),
      (point) => this.handlePointerMove(point),
      (point, canceled) => this.handlePointerRelease(point, canceled),
    );

    this.elements.stageHost.dataset.engineReady = 'false';
    this.elements.stageHost.dataset.cardCount = '0';
    this.elements.stageHost.dataset.engineStatus = 'loading';
    this.elements.stageHost.dataset.dragMode = 'stack';
    this.elements.stageHost.dataset.dragActive = 'false';
    this.elements.stageHost.dataset.hoverSlot = 'none';
    this.elements.stageHost.dataset.hintKind = 'none';
    this.setControlsDisabled(true);

    elements.undoButton.addEventListener('click', () => this.undo());
    elements.redoButton.addEventListener('click', () => this.redo());
    elements.hintButton.addEventListener('click', () => this.showHint());
    elements.autoPlayButton.addEventListener('click', () => this.runAutoPlay());
    elements.newGameButton.addEventListener('click', () => this.newGame());
    elements.restartButton.addEventListener('click', () => this.restart());
  }

  async start(seed = 1): Promise<void> {
    this.isReady = false;
    this.elements.status.textContent = 'Loading engine...';
    this.elements.stageHost.dataset.engineReady = 'false';
    this.setControlsDisabled(true);
    await this.renderer.init();
    this.currentSeed = seed;
    this.snapshot = await this.engine.initialize(seed);
    this.refreshLegalActions();
    this.startedAt = performance.now();
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
    }
    this.timerHandle = window.setInterval(() => this.updateHud(), 1000);
    this.isReady = true;
    this.elements.status.textContent =
      'Drag cards or runs onto a legal destination. Hint search and safe auto-play are live.';
    this.render();
  }

  destroy(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
    }
    this.renderer.destroy();
  }

  private handleCardPress(slot: SlotRef, row: number, cardId: number, point: PointerPoint): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.clearHintOverlay();

    const selection = this.buildSelection(slot, row, cardId);
    if (!selection) {
      this.render();
      return;
    }

    const anchorPose = this.renderer.getCardPose(cardId);
    if (!anchorPose) {
      return;
    }

    this.dragSession = {
      selection,
      anchorCardId: cardId,
      startX: point.x,
      startY: point.y,
      pointerX: point.x,
      pointerY: point.y,
      offsetX: point.x - anchorPose.x,
      offsetY: point.y - anchorPose.y,
      dragDistance: 0,
      pickupPlayed: false,
      hoverSlot: null,
      hoverLegal: false,
    };

    this.elements.status.textContent =
      selection.count > 1
        ? 'Drag the run to a legal column, free cell, or foundation.'
        : 'Drag the card to a legal destination.';
    this.render();
  }

  private handlePointerMove(point: PointerPoint): void {
    if (!this.dragSession) {
      return;
    }

    this.dragSession.pointerX = point.x;
    this.dragSession.pointerY = point.y;
    this.dragSession.dragDistance = Math.hypot(
      point.x - this.dragSession.startX,
      point.y - this.dragSession.startY,
    );

    if (this.dragSession.dragDistance >= DRAG_THRESHOLD && !this.dragSession.pickupPlayed) {
      this.audio.playPickup();
      this.dragSession.pickupPlayed = true;
    }

    if (this.dragSession.dragDistance < DRAG_THRESHOLD) {
      this.dragSession.hoverSlot = null;
      this.dragSession.hoverLegal = false;
      this.render();
      return;
    }

    const hoverSlot = this.renderer.slotAtPoint(point.x, point.y);
    const legal =
      hoverSlot !== null &&
      !sameSlot(hoverSlot, this.dragSession.selection.source) &&
      this.isLegalMove(this.dragSession.selection, hoverSlot);

    this.dragSession.hoverSlot =
      hoverSlot && !sameSlot(hoverSlot, this.dragSession.selection.source) ? hoverSlot : null;
    this.dragSession.hoverLegal = legal;
    this.render();
  }

  private handlePointerRelease(point: PointerPoint, canceled: boolean): void {
    if (!this.dragSession) {
      return;
    }

    const session = this.dragSession;
    this.dragSession = null;

    if (canceled || session.dragDistance < DRAG_THRESHOLD) {
      this.elements.status.textContent =
        'Drag a card or a movable run onto a highlighted destination to play.';
      this.render();
      return;
    }

    const destination =
      session.hoverSlot && !sameSlot(session.hoverSlot, session.selection.source)
        ? session.hoverSlot
        : this.renderer.slotAtPoint(point.x, point.y);

    if (!destination || sameSlot(destination, session.selection.source)) {
      this.audio.playInvalid();
      this.elements.status.textContent =
        'That drop zone does not accept the current stack. Try a free cell, foundation, or legal column.';
      this.render();
      return;
    }

    this.tryMove(session.selection, destination);
  }

  private buildSelection(slot: SlotRef, row: number, cardId: number): DragSelection | null {
    if (slot.kind === 'tableau') {
      const column = this.snapshot.tableau[slot.index];
      if (!column) {
        return null;
      }

      const firstMovableRow = column.cards.length - column.movableRunLength;
      if (row < firstMovableRow) {
        this.elements.status.textContent =
          'Only the movable run at the end of a column can be dragged.';
        return null;
      }

      const selectedCards = column.cards.slice(row).map((card) => card.id);
      return {
        source: slot,
        count: column.cards.length - row,
        cardIds: new Set(selectedCards),
        anchorCardId: cardId,
      };
    }

    if (slot.kind === 'freecell') {
      const cell = this.snapshot.freecells[slot.index];
      if (!cell?.card || cell.card.id !== cardId) {
        return null;
      }

      return {
        source: slot,
        count: 1,
        cardIds: new Set([cardId]),
        anchorCardId: cardId,
      };
    }

    const foundation = this.snapshot.foundations[slot.index];
    if (!foundation?.topCard || foundation.topCard.id !== cardId) {
      return null;
    }

    return {
      source: slot,
      count: 1,
      cardIds: new Set([cardId]),
      anchorCardId: cardId,
    };
  }

  private tryMove(selection: DragSelection, destination: SlotRef): void {
    const action: EngineAction = {
      actionIndex: null,
      source: selection.source,
      destination,
      count: selection.count,
    };

    const result = this.engine.stepAction(action) as {
      applied: boolean;
      terminal: boolean;
      turn: TurnRecord | null;
      state: GameSnapshot;
      illegalReason: string | null;
    };

    if (!result.applied) {
      this.audio.playInvalid();
      this.elements.status.textContent = result.illegalReason ?? 'That move is not legal.';
      this.render();
      return;
    }

    this.snapshot = result.state;
    this.refreshLegalActions();
    this.audio.playMove(result.turn, result.terminal);
    this.elements.status.textContent = result.terminal
      ? 'Game won. Replay export is ready from the live engine state.'
      : result.turn?.foundationDelta
        ? 'Foundation progress secured.'
        : 'Move applied.';
    this.render();
  }

  private undo(): void {
    if (!this.isReady || !this.engine.canUndo()) {
      return;
    }

    this.audio.unlock();
    this.clearInteractions();
    this.snapshot = this.engine.undo();
    this.refreshLegalActions();
    this.elements.status.textContent = 'Undid the last turn.';
    this.render();
  }

  private redo(): void {
    if (!this.isReady || !this.engine.canRedo()) {
      return;
    }

    this.audio.unlock();
    this.clearInteractions();
    this.snapshot = this.engine.redo();
    this.refreshLegalActions();
    this.elements.status.textContent = 'Replayed the next turn.';
    this.render();
  }

  private showHint(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.dragSession = null;
    const analysis = this.engine.hint();

    if (analysis.suggested) {
      this.hintOverlay = {
        analysis,
        cardIds: this.cardIdsForAction(analysis.suggested),
        destination: analysis.suggested.destination,
      };
    } else {
      this.hintOverlay = null;
    }

    this.audio.playHint();
    this.elements.status.textContent = analysis.message;
    this.render();
  }

  private runAutoPlay(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.clearInteractions();
    const turn = this.engine.runAutoPlay();
    if (!turn) {
      this.elements.status.textContent = 'No safe auto-play move is available right now.';
      this.render();
      return;
    }

    this.snapshot = this.engine.getState();
    this.refreshLegalActions();
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
    this.clearInteractions();
    this.snapshot = this.engine.reset(this.currentSeed);
    this.refreshLegalActions();
    this.startedAt = performance.now();
    this.audio.playShuffle();
    this.elements.status.textContent = 'New deterministic deal generated from the current seed.';
    this.render();
  }

  private restart(): void {
    if (!this.isReady) {
      return;
    }

    this.audio.unlock();
    this.clearInteractions();
    this.snapshot = this.engine.reset(this.currentSeed);
    this.refreshLegalActions();
    this.startedAt = performance.now();
    this.audio.playRestart();
    this.elements.status.textContent = 'Current seed restarted.';
    this.render();
  }

  private render(): void {
    if (!this.snapshot) {
      return;
    }

    const overlay = this.buildBoardOverlay();
    this.renderer.render(this.snapshot, overlay);
    this.elements.stageHost.dataset.dragActive = this.dragSession ? 'true' : 'false';
    this.elements.stageHost.dataset.hoverSlot = this.dragSession?.hoverSlot
      ? slotKey(this.dragSession.hoverSlot)
      : 'none';
    this.elements.stageHost.dataset.hintKind = this.hintOverlay?.analysis.kind ?? 'none';
    this.syncDebugState();
    this.updateHud();
  }

  private buildBoardOverlay(): BoardOverlay {
    if (this.dragSession) {
      return {
        highlightedCardIds: this.dragSession.selection.cardIds,
        slotEmphasis: this.dragSession.hoverSlot
          ? {
              slot: this.dragSession.hoverSlot,
              tone: 'drag',
              legal: this.dragSession.hoverLegal,
            }
          : null,
        dragPreview: {
          cardIds: this.dragSession.selection.cardIds,
          anchorCardId: this.dragSession.anchorCardId,
          x: this.dragSession.pointerX,
          y: this.dragSession.pointerY,
          offsetX: this.dragSession.offsetX,
          offsetY: this.dragSession.offsetY,
          engaged: this.dragSession.dragDistance >= DRAG_THRESHOLD,
        },
      };
    }

    if (this.hintOverlay) {
      return {
        highlightedCardIds: this.hintOverlay.cardIds,
        slotEmphasis: this.hintOverlay.destination
          ? {
              slot: this.hintOverlay.destination,
              tone: 'hint',
              legal: true,
            }
          : null,
        dragPreview: null,
      };
    }

    return {
      highlightedCardIds: new Set<number>(),
      slotEmphasis: null,
      dragPreview: null,
    };
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
    this.elements.hintButton.disabled = !this.isReady || this.snapshot.status === 'won';
    this.elements.autoPlayButton.disabled = !this.isReady || this.snapshot.status === 'won';
    this.elements.restartButton.disabled = !this.isReady;
    this.elements.newGameButton.disabled = !this.isReady;
  }

  private isLegalMove(selection: DragSelection, destination: SlotRef): boolean {
    return this.legalActionKeys.has(
      actionKey({
        source: selection.source,
        destination,
        count: selection.count,
      }),
    );
  }

  private refreshLegalActions(): void {
    this.legalActionKeys = new Set(
      this.engine.legalActions().map((action) =>
        actionKey({
          source: action.source,
          destination: action.destination,
          count: action.count,
        }),
      ),
    );
  }

  private clearInteractions(): void {
    this.dragSession = null;
    this.clearHintOverlay();
  }

  private clearHintOverlay(): void {
    this.hintOverlay = null;
  }

  private setControlsDisabled(disabled: boolean): void {
    this.elements.undoButton.disabled = disabled;
    this.elements.redoButton.disabled = disabled;
    this.elements.hintButton.disabled = disabled;
    this.elements.autoPlayButton.disabled = disabled;
    this.elements.restartButton.disabled = disabled;
    this.elements.newGameButton.disabled = disabled;
  }

  private syncDebugState(): void {
    if (import.meta.env.PROD) {
      return;
    }

    (
      window as typeof window & {
        __FREECELL_DEBUG__?: unknown;
      }
    ).__FREECELL_DEBUG__ = {
      seed: this.currentSeed,
      snapshot: this.snapshot,
      overlay: {
        dragActive: Boolean(this.dragSession),
        hintKind: this.hintOverlay?.analysis.kind ?? 'none',
      },
      renderer: this.renderer.getDebugState(),
    };
  }

  private cardIdsForAction(action: EngineAction): Set<number> {
    if (action.source.kind === 'tableau') {
      const column = this.snapshot.tableau[action.source.index];
      if (!column) {
        return new Set<number>();
      }

      return new Set(column.cards.slice(-action.count).map((card) => card.id));
    }

    if (action.source.kind === 'freecell') {
      const card = this.snapshot.freecells[action.source.index]?.card;
      return card ? new Set([card.id]) : new Set<number>();
    }

    const card = this.snapshot.foundations[action.source.index]?.topCard;
    return card ? new Set([card.id]) : new Set<number>();
  }
}

function slotKey(slot: SlotRef): string {
  return `${slot.kind}:${slot.index}`;
}

function sameSlot(left: SlotRef, right: SlotRef): boolean {
  return left.kind === right.kind && left.index === right.index;
}

function actionKey(action: Pick<EngineAction, 'source' | 'destination' | 'count'>): string {
  return `${slotKey(action.source)}>${slotKey(action.destination)}#${action.count}`;
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
