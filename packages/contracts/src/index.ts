export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Color = 'black' | 'red';
export type DealMode = 'microsoft';
export type AutoPlayPolicy = 'off' | 'safe' | 'max';
export type EngineStatus = 'playing' | 'won';

export interface CardView {
  id: number;
  suit: Suit;
  rank: number;
  rankLabel: string;
  shortLabel: string;
  color: Color;
}

export interface FoundationView {
  index: number;
  suit: Suit;
  count: number;
  nextRank: number;
  topCard: CardView | null;
}

export interface FreeCellView {
  index: number;
  card: CardView | null;
}

export interface ColumnView {
  index: number;
  cards: CardView[];
  movableRunLength: number;
  sortedRunLength: number;
}

export type SlotRef =
  | { kind: 'tableau'; index: number }
  | { kind: 'freecell'; index: number }
  | { kind: 'foundation'; index: number };

export interface EngineAction {
  actionIndex: number | null;
  source: SlotRef;
  destination: SlotRef;
  count: number;
}

export interface TurnRecord {
  turnIndex: number;
  requested: EngineAction | null;
  executed: EngineAction[];
  autoPlayed: boolean;
  foundationDelta: number;
}

export interface GameSnapshot {
  version: 1;
  seed: number;
  dealMode: DealMode;
  status: EngineStatus;
  autoPlayPolicy: AutoPlayPolicy;
  moveCount: number;
  turnIndex: number;
  score: number;
  legalMoveCapacity: number;
  stateHash: string;
  foundations: FoundationView[];
  freecells: FreeCellView[];
  tableau: ColumnView[];
}

export interface ReplayExport {
  version: 1;
  seed: number;
  dealMode: DealMode;
  autoPlayPolicy: AutoPlayPolicy;
  turns: TurnRecord[];
  finalStateHash: string;
}

export interface StepResult {
  applied: boolean;
  reward: number;
  terminal: boolean;
  turn: TurnRecord | null;
  state: GameSnapshot;
  illegalReason: string | null;
}
