// @ts-check
import { SAVE_KEY_BAK, SAVE_KEY_MAIN, SAVE_VERSION, SKINS } from './constants.js';

/** @typedef {import('../../../types/domain.d.ts').PlayerSaveV1} PlayerSaveV1 */
/** @typedef {import('../../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */

/** Precomputed CRC32 lookup table for save integrity verification. */
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

/**
 * Compute unsigned 32-bit CRC32 hex digest of a UTF-8 string.
 * @param {string} str
 * @returns {string}
 */
export function crc32Hex(str) {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = CRC_TABLE[(crc ^ (code & 0xff)) & 0xff] ^ (crc >>> 8);
    if (code > 0xff) {
      crc = CRC_TABLE[(crc ^ ((code >>> 8) & 0xff)) & 0xff] ^ (crc >>> 8);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/**
 * Create a clean default v1 save state.
 * @returns {PlayerSaveV1}
 */
export function createDefaultSave() {
  return {
    version: 1,
    updatedAt: Date.now(),
    highestUnlockedLevel: 1,
    currentLevelId: 1,
    clearedLevels: {},
    globalBestChain: 0,
    unlockedSkins: ['warm_wood'],
    equippedSkinId: 'warm_wood',
    skinTrial: null,
    settings: { muted: false, haptics: true },
    ftueCompleted: false
  };
}

/**
 * Parse and validate an enveloped JSON save string (`{ crc, payload }`).
 * @param {string | null} raw
 * @returns {PlayerSaveV1 | null}
 */
function parseEnvelope(raw) {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw);
    if (!env || typeof env !== 'object' || typeof env.crc !== 'string' || typeof env.payload !== 'string') {
      return null;
    }
    if (crc32Hex(env.payload) !== env.crc) return null;
    const data = JSON.parse(env.payload);
    if (!data || typeof data !== 'object' || typeof data.version !== 'number') return null;
    if (data.version > SAVE_VERSION) return null;
    return migrateSave(data);
  } catch {
    return null;
  }
}

/**
 * Pure migration chain ensuring all required fields exist.
 * @param {any} data
 * @returns {PlayerSaveV1}
 */
function migrateSave(data) {
  const base = createDefaultSave();
  return {
    version: 1,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : base.updatedAt,
    highestUnlockedLevel: typeof data.highestUnlockedLevel === 'number' ? Math.max(1, data.highestUnlockedLevel) : 1,
    currentLevelId: typeof data.currentLevelId === 'number' ? Math.max(1, data.currentLevelId) : 1,
    clearedLevels: (data.clearedLevels && typeof data.clearedLevels === 'object') ? data.clearedLevels : {},
    globalBestChain: typeof data.globalBestChain === 'number' ? data.globalBestChain : 0,
    unlockedSkins: Array.isArray(data.unlockedSkins) && data.unlockedSkins.length ? data.unlockedSkins : ['warm_wood'],
    equippedSkinId: typeof data.equippedSkinId === 'string' ? data.equippedSkinId : 'warm_wood',
    skinTrial: data.skinTrial && typeof data.skinTrial.skinId === 'string' && typeof data.skinTrial.remainingLevels === 'number'
      ? data.skinTrial : null,
    settings: {
      muted: Boolean(data.settings?.muted),
      haptics: data.settings?.haptics !== false
    },
    ftueCompleted: Boolean(data.ftueCompleted)
  };
}

/**
 * Serialize a save object into its CRC32-protected envelope.
 * @param {PlayerSaveV1} data
 * @returns {string}
 */
function encodeEnvelope(data) {
  const payload = JSON.stringify(data);
  return JSON.stringify({ crc: crc32Hex(payload), payload });
}

export class SaveManager {
  /**
   * @param {{ readStorage(k: string): string | null; writeStorage(k: string, v: string): void }} storage
   */
  constructor(storage) {
    this.storage = storage;
    /** @type {PlayerSaveV1} */
    this.data = createDefaultSave();
    this.recoveredFromBackup = false;
  }

  /**
   * Load main save; if corrupted or missing, transparently fall back to backup.
   * @returns {PlayerSaveV1}
   */
  load() {
    const mainRaw = this.storage.readStorage(SAVE_KEY_MAIN);
    const parsedMain = parseEnvelope(mainRaw);
    if (parsedMain) {
      this.data = parsedMain;
      this.recoveredFromBackup = false;
      return this.data;
    }
    const bakRaw = this.storage.readStorage(SAVE_KEY_BAK);
    const parsedBak = parseEnvelope(bakRaw);
    if (parsedBak) {
      this.data = parsedBak;
      this.recoveredFromBackup = true;
      this.storage.writeStorage(SAVE_KEY_MAIN, encodeEnvelope(this.data));
      return this.data;
    }
    this.data = createDefaultSave();
    this.recoveredFromBackup = false;
    return this.data;
  }

  /**
   * Dual-backup write: back up current valid main before overwriting main with new CRC envelope.
   */
  save() {
    const prevMain = this.storage.readStorage(SAVE_KEY_MAIN);
    if (prevMain && parseEnvelope(prevMain)) {
      this.storage.writeStorage(SAVE_KEY_BAK, prevMain);
    }
    this.data.updatedAt = Date.now();
    this.storage.writeStorage(SAVE_KEY_MAIN, encodeEnvelope(this.data));
  }

  /**
   * Count total perfect gold-frame levels earned.
   * @returns {number}
   */
  countGoldFrames() {
    let n = 0;
    for (const rec of Object.values(this.data.clearedLevels)) {
      if (rec && rec.perfect) n++;
    }
    return n;
  }

  /**
   * Count total distinct levels cleared.
   * @returns {number}
   */
  countCleared() {
    return Object.keys(this.data.clearedLevels).length;
  }

  /**
   * Unlock any skins whose gold-frame milestone has been reached.
   * @returns {string[]} newly unlocked skin ids
   */
  syncSkinUnlocks() {
    const gold = this.countGoldFrames();
    /** @type {string[]} */
    const newly = [];
    for (const skin of SKINS) {
      if (gold >= skin.unlockGoldFrames && !this.data.unlockedSkins.includes(skin.id)) {
        this.data.unlockedSkins.push(skin.id);
        newly.push(skin.id);
      }
    }
    return newly;
  }

  /**
   * Active visual/audio skin ID (trial overrides equipped until trial levels expire).
   * @returns {string}
   */
  getActiveSkinId() {
    if (this.data.skinTrial && this.data.skinTrial.remainingLevels > 0) {
      return this.data.skinTrial.skinId;
    }
    return this.data.equippedSkinId;
  }
}
