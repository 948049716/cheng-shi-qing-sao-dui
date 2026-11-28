// @ts-check
import {
  AD_BONUS_HINTS,
  AD_PROTECT_MAX_LEVEL,
  MAX_EXTRA_HINTS_PER_LEVEL,
  MAX_EXTRA_PUSH_PER_LEVEL,
  MAX_HINTS_PER_LEVEL,
  SKIN_TRIAL_LEVELS,
  SKINS
} from './constants.js';
import { evaluateHint } from './hint.js';
import { SaveManager } from './save.js';
import { compileLevel, countStanding, simulatePush } from './simulator.js';

/** @typedef {import('../../../types/domain.d.ts').Dir} Dir */
/** @typedef {import('../../../types/domain.d.ts').LevelDef} LevelDef */
/** @typedef {import('../../../types/domain.d.ts').CompiledLevel} CompiledLevel */
/** @typedef {import('../../../types/domain.d.ts').HistoryEntry} HistoryEntry */
/** @typedef {import('../../../types/domain.d.ts').EngineSnapshot} EngineSnapshot */
/** @typedef {import('../../../types/domain.d.ts').GameDomainEvent} GameDomainEvent */

export class GameEngine {
  /**
   * @param {LevelDef[]} levelDefs
   * @param {SaveManager} saveManager
   */
  constructor(levelDefs, saveManager) {
    if (!levelDefs.length) throw new Error('GameEngine requires at least 1 level');
    /** @type {CompiledLevel[]} */
    this.levels = levelDefs.map(compileLevel);
    this.save = saveManager;
    /** @type {Set<(ev: GameDomainEvent) => void>} */
    this.listeners = new Set();

    /** @type {number} */
    this.levelIndex = 0;
    /** @type {Uint8Array} */
    this.fallen = new Uint8Array(0);
    /** @type {HistoryEntry[]} */
    this.history = [];
    this.used = 0;
    this.limit = 1;
    this.extraPushesUsed = 0;
    this.extraHintsUsed = 0;
    this.hintsLeft = MAX_HINTS_PER_LEVEL;
    this.busy = false;
    /** @type {'playing' | 'won' | 'failed'} */
    this.ended = 'playing';
    this.bestChainInLevel = 0;
    this.lastChainSize = 0;
    this.usedHelpInRun = false;
    this.showFtueHand = false;
    /** @type {{ y: number; x: number; dir: Dir } | null} */
    this.activeHint = null;
    this.levelStartTs = 0;

    const initialId = Math.min(this.save.data.currentLevelId, this.levels.length);
    this.loadLevelById(Math.max(1, initialId), false);
  }

  /**
   * Subscribe to domain events emitted by the engine.
   * @param {(ev: GameDomainEvent) => void} fn
   * @returns {() => void}
   */
  onEvent(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * @param {GameDomainEvent} ev
   */
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  /**
   * Current compiled level.
   * @returns {CompiledLevel}
   */
  currentLevel() {
    return this.levels[this.levelIndex];
  }

  /**
   * Read-only UI snapshot.
   * @returns {EngineSnapshot}
   */
  getSnapshot() {
    const level = this.currentLevel();
    return {
      level,
      fallen: this.fallen,
      used: this.used,
      limit: this.limit,
      extraPushesUsed: this.extraPushesUsed,
      extraHintsUsed: this.extraHintsUsed,
      hintsLeft: this.hintsLeft,
      canUndo: this.history.length > 0 && !this.busy,
      busy: this.busy,
      ended: this.ended,
      bestChainInLevel: this.bestChainInLevel,
      lastChainSize: this.lastChainSize,
      usedHelpInRun: this.usedHelpInRun,
      remainingStanding: countStanding(level.present, this.fallen),
      showFtueHand: this.showFtueHand,
      activeHint: this.activeHint
    };
  }

  /**
   * Load level by 1-based levelId.
   * @param {number} levelId
   * @param {boolean} [preserveHints=false]
   * @returns {boolean}
   */
  loadLevelById(levelId, preserveHints = false) {
    if (this.busy) return false;
    const idx = this.levels.findIndex(l => l.def.levelId === levelId);
    if (idx < 0) return false;

    const prevHints = preserveHints ? this.hintsLeft : MAX_HINTS_PER_LEVEL;
    const prevExtraHints = preserveHints ? this.extraHintsUsed : 0;

    this.levelIndex = idx;
    const level = this.levels[idx];
    this.fallen = new Uint8Array(level.W * level.H);
    this.history = [];
    this.used = 0;
    this.limit = level.def.limit;
    this.extraPushesUsed = 0;
    this.extraHintsUsed = prevExtraHints;
    this.hintsLeft = prevHints;
    this.busy = false;
    this.ended = 'playing';
    this.bestChainInLevel = 0;
    this.lastChainSize = 0;
    this.usedHelpInRun = false;
    this.activeHint = null;
    this.showFtueHand = level.def.levelId === 1 && !this.save.data.ftueCompleted;
    this.levelStartTs = Date.now();

    if (this.save.data.currentLevelId !== level.def.levelId) {
      this.save.data.currentLevelId = level.def.levelId;
      this.save.save();
    }

    this.emit({ type: 'LEVEL_LOADED', levelId: level.def.levelId });
    return true;
  }

  /**
   * Handle a tap without swipe (E01/E02):
   * - Turn dominoes push immediately in their fixed arrow direction.
   * - Normal/split dominoes shake and emit TAP_NEED_SWIPE without consuming a push.
   * @param {number} cellIndex
   * @returns {boolean}
   */
  tapCell(cellIndex) {
    if (this.busy || this.ended !== 'playing') return false;
    const level = this.currentLevel();
    if (cellIndex < 0 || cellIndex >= level.present.length) return false;
    if (!level.present[cellIndex] || this.fallen[cellIndex]) return false;

    const tp = level.types[cellIndex];
    if (tp && tp !== '.' && tp !== '+') {
      return this.pushCell(cellIndex, tp);
    }
    this.emit({ type: 'TAP_NEED_SWIPE', cellIndex });
    this.emit({ type: 'TOAST', message: '按住骨牌，往要推倒的方向滑一下' });
    return false;
  }

  /**
   * Push a standing domino in `dir`.
   * Strict E02: turn dominoes lock to their own arrow direction regardless of swipe direction.
   * Strict E03: ignored while `busy`.
   * Strict E09: removes FTUE hand immediately upon first push.
   * @param {number} cellIndex
   * @param {Dir} dir
   * @returns {boolean}
   */
  pushCell(cellIndex, dir) {
    if (this.busy || this.ended !== 'playing') return false;
    const level = this.currentLevel();
    if (cellIndex < 0 || cellIndex >= level.present.length) return false;
    if (!level.present[cellIndex] || this.fallen[cellIndex]) return false;
    if (this.used >= this.limit) {
      this.emit({ type: 'TOAST', message: '推力用完了，撤销或重摆吧' });
      return false;
    }

    const tp = level.types[cellIndex];
    /** @type {Dir} */
    const resolvedDir = (tp && tp !== '.' && tp !== '+') ? tp : dir;
    const y = Math.floor(cellIndex / level.W);
    const x = cellIndex % level.W;

    this.showFtueHand = false;
    this.activeHint = null;

    this.history.push({ fallen: new Uint8Array(this.fallen), used: this.used });
    const res = simulatePush(level.H, level.W, level.present, level.types, this.fallen, y, x, resolvedDir);
    this.fallen = res.nextFallen;
    this.used++;
    this.busy = true;
    this.lastChainSize = res.events.length;
    if (res.events.length > this.bestChainInLevel) {
      this.bestChainInLevel = res.events.length;
    }

    this.emit({
      type: 'CASCADE_STARTED',
      pushIndex: this.used,
      events: res.events,
      maxLayer: res.maxLayer
    });
    return true;
  }

  /**
   * Called by presentation layer (or synchronously in headless tests) once cascade animation ends.
   * Strict E06: win check takes priority over fail check even when `used === limit`.
   */
  completeCascade() {
    if (!this.busy) return;
    this.busy = false;

    const level = this.currentLevel();
    const left = countStanding(level.present, this.fallen);
    this.emit({ type: 'CASCADE_FINISHED', chainSize: this.lastChainSize, remainingStanding: left });

    if (left === 0) {
      this.ended = 'won';
      const levelId = level.def.levelId;
      const isPerfect = !this.usedHelpInRun;
      const prev = this.save.data.clearedLevels[levelId];
      this.save.data.clearedLevels[levelId] = {
        bestChain: Math.max(prev ? prev.bestChain : 0, this.bestChainInLevel),
        perfect: Boolean((prev && prev.perfect) || isPerfect),
        bestPushes: prev ? Math.min(prev.bestPushes, this.used) : this.used
      };
      if (this.bestChainInLevel > this.save.data.globalBestChain) {
        this.save.data.globalBestChain = this.bestChainInLevel;
      }
      if (levelId >= this.save.data.highestUnlockedLevel && levelId < this.levels.length) {
        this.save.data.highestUnlockedLevel = levelId + 1;
      }
      if (levelId === 1) {
        this.save.data.ftueCompleted = true;
      }
      // Consume 1 trial level if active
      if (this.save.data.skinTrial && this.save.data.skinTrial.remainingLevels > 0) {
        this.save.data.skinTrial.remainingLevels--;
        if (this.save.data.skinTrial.remainingLevels <= 0) {
          this.save.data.skinTrial = null;
        }
      }
      const newlyUnlockedSkins = this.save.syncSkinUnlocks();
      this.save.save();

      const isAllCleared = this.save.countCleared() >= this.levels.length;
      this.emit({
        type: 'LEVEL_WON',
        levelId,
        pushesUsed: this.used,
        bestChain: this.bestChainInLevel,
        isPerfect,
        newlyUnlockedSkins,
        isAllCleared
      });
      return;
    }

    if (this.used >= this.limit) {
      this.ended = 'failed';
      this.emit({
        type: 'LEVEL_FAILED',
        remainingStanding: left,
        canWatchAd: this.canOfferExtraPush()
      });
    }
  }

  /**
   * Free unlimited undo (E08: restores from fail panel back into playing state).
   * @returns {boolean}
   */
  undo() {
    if (this.busy || !this.history.length) return false;
    const prev = this.history.pop();
    if (!prev) return false;

    /** @type {number[]} */
    const restoredCells = [];
    for (let i = 0; i < this.fallen.length; i++) {
      if (this.fallen[i] && !prev.fallen[i]) restoredCells.push(i);
    }
    this.fallen = prev.fallen;
    this.used = prev.used;
    this.ended = 'playing';
    this.activeHint = null;

    this.emit({ type: 'UNDO_APPLIED', restoredCells });
    return true;
  }

  /**
   * Reset current level: preserves remaining hints (docs/01 §5 & docs/02 §7.1)
   * unless level was already won (replay resets hints to 3).
   * @returns {boolean}
   */
  resetLevel() {
    if (this.busy) return false;
    const preserveHints = this.ended !== 'won';
    return this.loadLevelById(this.currentLevel().def.levelId, preserveHints);
  }

  /**
   * Advance to the next level (or stay on last level if already at the end).
   * @returns {boolean}
   */
  nextLevel() {
    if (this.busy) return false;
    const nextIdx = this.levelIndex + 1;
    if (nextIdx >= this.levels.length) return false;
    return this.loadLevelById(this.levels[nextIdx].def.levelId, false);
  }

  /**
   * Request a hint along the verified standard solution (E07 compliant).
   * @returns {'SHOWN' | 'OFF_PATH' | 'NO_HINTS' | 'IGNORED'}
   */
  requestHint() {
    if (this.busy || this.ended !== 'playing') return 'IGNORED';
    const res = evaluateHint(this.currentLevel(), this.fallen, this.used, this.hintsLeft);
    if (!res.ok) {
      if (res.reason === 'OFF_PATH') {
        this.emit({ type: 'HINT_OFF_PATH' });
        this.emit({ type: 'TOAST', message: '这条路走不通了，先撤销试试 ↶' });
        return 'OFF_PATH';
      }
      this.emit({ type: 'HINT_EMPTY', canWatchAd: this.canOfferExtraHints() });
      return 'NO_HINTS';
    }
    this.hintsLeft--;
    this.usedHelpInRun = true;
    this.activeHint = { y: res.y, x: res.x, dir: res.dir };
    this.emit({ type: 'HINT_SHOWN', y: res.y, x: res.x, dir: res.dir, hintsLeft: this.hintsLeft });
    return 'SHOWN';
  }

  /**
   * Whether the extra-push (+1) rescue option is eligible on this level (docs/02 §7.1 & docs/05 §2.1).
   * @returns {boolean}
   */
  canOfferExtraPush() {
    const levelId = this.currentLevel().def.levelId;
    return levelId > AD_PROTECT_MAX_LEVEL && this.extraPushesUsed < MAX_EXTRA_PUSH_PER_LEVEL;
  }

  /**
   * Whether hint refill (+2) is eligible on this level.
   * @returns {boolean}
   */
  canOfferExtraHints() {
    const levelId = this.currentLevel().def.levelId;
    return levelId > AD_PROTECT_MAX_LEVEL && this.extraHintsUsed < MAX_EXTRA_HINTS_PER_LEVEL;
  }

  /**
   * Grant +1 push (after rewarded ad completion or pre-traffic-master fallback).
   * @returns {boolean}
   */
  grantExtraPush() {
    if (this.busy || this.ended !== 'failed' || !this.canOfferExtraPush()) return false;
    this.extraPushesUsed++;
    this.limit++;
    this.usedHelpInRun = true;
    this.ended = 'playing';
    this.emit({ type: 'EXTRA_PUSH_GRANTED', newLimit: this.limit });
    this.emit({ type: 'TOAST', message: '已获得 +1 推力，继续加油！' });
    return true;
  }

  /**
   * Grant +2 hints (after rewarded ad completion or fallback).
   * @returns {boolean}
   */
  grantExtraHints() {
    if (this.busy || this.ended !== 'playing' || !this.canOfferExtraHints()) return false;
    this.extraHintsUsed++;
    this.hintsLeft += AD_BONUS_HINTS;
    this.emit({ type: 'EXTRA_HINTS_GRANTED', hintsLeft: this.hintsLeft });
    this.emit({ type: 'TOAST', message: `已补充 +${AD_BONUS_HINTS} 次提示！` });
    return true;
  }

  /**
   * Equip an unlocked skin.
   * @param {string} skinId
   * @returns {boolean}
   */
  equipSkin(skinId) {
    if (!this.save.data.unlockedSkins.includes(skinId)) return false;
    this.save.data.equippedSkinId = skinId;
    this.save.data.skinTrial = null;
    this.save.save();
    this.emit({ type: 'SKIN_CHANGED', skinId });
    return true;
  }

  /**
   * Activate a 3-level trial of a locked skin (A3 rewarded ad reward).
   * @param {string} skinId
   * @returns {boolean}
   */
  startSkinTrial(skinId) {
    if (!SKINS.some(s => s.id === skinId)) return false;
    this.save.data.skinTrial = { skinId, remainingLevels: SKIN_TRIAL_LEVELS };
    this.save.save();
    this.emit({ type: 'SKIN_CHANGED', skinId });
    this.emit({ type: 'TOAST', message: `已免费试用新皮肤 ${SKIN_TRIAL_LEVELS} 关！` });
    return true;
  }

  /**
   * Toggle global mute setting and persist.
   * @returns {boolean} new muted flag
   */
  toggleMute() {
    this.save.data.settings.muted = !this.save.data.settings.muted;
    this.save.save();
    return this.save.data.settings.muted;
  }

  /**
   * Check whether a levelId is unlocked for direct selection in the gallery.
   * @param {number} levelId
   * @returns {boolean}
   */
  isLevelUnlocked(levelId) {
    return levelId >= 1 && levelId <= this.save.data.highestUnlockedLevel;
  }
}
