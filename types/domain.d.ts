export type Dir = '^' | '>' | 'v' | '<';

export type DominoCellType = '.' | '^' | '>' | 'v' | '<' | '+' | null;

export type LevelTier = '易' | '中' | '难' | '爽';

export interface LevelDef {
  schemaVersion: number;
  levelId: number;
  tier: LevelTier;
  name: string;
  theme: string;
  emoji: string;
  limit: number;
  art: string[];
  types: string[];
  sol: [number, number, Dir][];
}

export interface CompiledLevel {
  def: LevelDef;
  H: number;
  W: number;
  present: Uint8Array;
  types: DominoCellType[];
  colors: (string | null)[];
  total: number;
}

export interface CascadeEvent {
  cellIndex: number;
  y: number;
  x: number;
  fallDir: Dir;
  layer: number;
}

export interface SimulateResult {
  nextFallen: Uint8Array;
  events: CascadeEvent[];
  maxLayer: number;
}

export interface HistoryEntry {
  fallen: Uint8Array;
  used: number;
}

export interface LevelProgressRecord {
  bestChain: number;
  perfect: boolean;
  bestPushes: number;
}

export interface PlayerSaveV1 {
  version: 1;
  updatedAt: number;
  highestUnlockedLevel: number;
  currentLevelId: number;
  clearedLevels: Record<number, LevelProgressRecord>;
  globalBestChain: number;
  unlockedSkins: string[];
  equippedSkinId: string;
  skinTrial: { skinId: string; remainingLevels: number } | null;
  settings: { muted: boolean; haptics: boolean };
  ftueCompleted: boolean;
}

export interface SkinDef {
  id: string;
  name: string;
  soundName: string;
  unlockGoldFrames: number;
  bgTop: string;
  bgBottom: string;
  frameOuter: string;
  frameShadow: string;
  feltBg: string;
  feltDot: string;
  normalTop: string;
  normalBot: string;
  normalEdge: string;
  pipColor: string;
  turnTop: string;
  turnBot: string;
  turnEdge: string;
  turnIcon: string;
  splitTop: string;
  splitBot: string;
  splitEdge: string;
  splitIcon: string;
  soundStyle: 'wood' | 'marimba' | 'musicbox' | 'bamboo';
}

export interface EngineSnapshot {
  level: CompiledLevel;
  fallen: Uint8Array;
  used: number;
  limit: number;
  extraPushesUsed: number;
  extraHintsUsed: number;
  hintsLeft: number;
  canUndo: boolean;
  busy: boolean;
  ended: 'playing' | 'won' | 'failed';
  bestChainInLevel: number;
  lastChainSize: number;
  usedHelpInRun: boolean;
  remainingStanding: number;
  showFtueHand: boolean;
  activeHint: { y: number; x: number; dir: Dir } | null;
}

export type GameDomainEvent =
  | { type: 'LEVEL_LOADED'; levelId: number }
  | { type: 'CASCADE_STARTED'; pushIndex: number; events: CascadeEvent[]; maxLayer: number }
  | { type: 'CASCADE_FINISHED'; chainSize: number; remainingStanding: number }
  | { type: 'TAP_NEED_SWIPE'; cellIndex: number }
  | { type: 'UNDO_APPLIED'; restoredCells: number[] }
  | { type: 'HINT_SHOWN'; y: number; x: number; dir: Dir; hintsLeft: number }
  | { type: 'HINT_OFF_PATH' }
  | { type: 'HINT_EMPTY'; canWatchAd: boolean }
  | { type: 'EXTRA_PUSH_GRANTED'; newLimit: number }
  | { type: 'EXTRA_HINTS_GRANTED'; hintsLeft: number }
  | { type: 'LEVEL_WON'; levelId: number; pushesUsed: number; bestChain: number; isPerfect: boolean; newlyUnlockedSkins: string[]; isAllCleared: boolean }
  | { type: 'LEVEL_FAILED'; remainingStanding: number; canWatchAd: boolean }
  | { type: 'SKIN_CHANGED'; skinId: string }
  | { type: 'TOAST'; message: string };
