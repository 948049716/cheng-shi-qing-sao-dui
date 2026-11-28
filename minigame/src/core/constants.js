// @ts-check
/** @typedef {import('../../../types/domain.d.ts').Dir} Dir */
/** @typedef {import('../../../types/domain.d.ts').SkinDef} SkinDef */

export const GAME_TITLE = '推倒一幅画';
export const GAME_VERSION = '1.0.0';
export const SAVE_VERSION = 1;
export const SAVE_KEY_MAIN = 'tdyfh_save_v1_main';
export const SAVE_KEY_BAK = 'tdyfh_save_v1_bak';

/** @type {readonly Dir[]} */
export const DIRS = ['^', '>', 'v', '<'];

/** @type {Record<Dir, readonly [number, number]>} */
export const DV = {
  '^': [-1, 0],
  '>': [0, 1],
  'v': [1, 0],
  '<': [0, -1]
};

/** @type {Record<Dir, number>} */
export const DIR_RAD = {
  '>': 0,
  'v': Math.PI / 2,
  '<': Math.PI,
  '^': -Math.PI / 2
};

/** 11-color Master Art Palette (docs/06 §2.2) */
/** @type {Record<string, string>} */
export const ART_PALETTE = {
  R: '#ef5a5f',
  O: '#f59d45',
  Y: '#ffd23f',
  G: '#5bbf6e',
  S: '#4ea3f5',
  P: '#ff8fb0',
  C: '#f6dfb3',
  T: '#e8c48a',
  B: '#9a6440',
  K: '#3d3530',
  W: '#ffffff'
};

/** Gameplay feel & rhythm constants (docs/01 §6.4 & docs/02 §7.1) */
export const SWIPE_THRESHOLD_PX = 12;
export const MAX_HINTS_PER_LEVEL = 3;
export const AD_BONUS_HINTS = 2;
export const MAX_EXTRA_HINTS_PER_LEVEL = 2;
export const MAX_EXTRA_PUSH_PER_LEVEL = 2;
export const AD_PROTECT_MAX_LEVEL = 3;
export const SKIN_TRIAL_LEVELS = 3;
export const CELL_GAP_PX = 3;
export const MIN_CELL_PX = 24;
export const MAX_CELL_PX = 58;
export const FALL_DOMINO_MS = 150;
export const FALL_TILE_MS = 230;
export const CASCADE_TAIL_MS = 380;
export const VIBRATE_THROTTLE_MS = 45;
export const SAME_LAYER_MAX_VOICES = 2;

/**
 * Cascade layer interval in milliseconds (docs/01 §6.1).
 * @param {number} layer
 * @returns {number}
 */
export function stepDelayMs(layer) {
  return Math.max(42, 130 * Math.pow(0.9, layer));
}

/**
 * Feature flags (docs/05 §2.3): adEnabled defaults to false pre-traffic-master
 * so review builds run with zero dead buttons or ad errors.
 */
export const FeatureFlags = {
  adEnabled: false,
  isPremiumDesktop: false,
  showBanner: false
};

/**
 * 4 v1.0.0 skins & sound packs (default + 5/12/18 gold-frame unlockables, docs/02 §7.2).
 * @type {readonly SkinDef[]}
 */
export const SKINS = [
  {
    id: 'warm_wood',
    name: '暖木绿呢',
    soundName: '清脆木牌',
    unlockGoldFrames: 0,
    bgTop: '#fff9f0',
    bgBottom: '#f3e6d0',
    frameOuter: '#b58456',
    frameShadow: '#8e623a',
    feltBg: '#8fc7a5',
    feltDot: 'rgba(255,255,255,0.14)',
    normalTop: '#fffdf8',
    normalBot: '#efe4cf',
    normalEdge: '#c8b38c',
    pipColor: '#6b5644',
    turnTop: '#f4fbff',
    turnBot: '#d9ecf8',
    turnEdge: '#8fb6d1',
    turnIcon: '#2d7fc1',
    splitTop: '#fff6ea',
    splitBot: '#ffe0b8',
    splitEdge: '#e0a35a',
    splitIcon: '#ea7a12',
    soundStyle: 'wood'
  },
  {
    id: 'oak_marimba',
    name: '原木马林巴',
    soundName: '温润木琴',
    unlockGoldFrames: 5,
    bgTop: '#fdf5e6',
    bgBottom: '#ecd9bc',
    frameOuter: '#8d5b34',
    frameShadow: '#643c1f',
    feltBg: '#c9a67a',
    feltDot: 'rgba(255,248,230,0.16)',
    normalTop: '#fff8ec',
    normalBot: '#ead2ad',
    normalEdge: '#b89462',
    pipColor: '#5c3c22',
    turnTop: '#e8f7ff',
    turnBot: '#c6e6f9',
    turnEdge: '#7aa9cc',
    turnIcon: '#1f70b8',
    splitTop: '#fff1df',
    splitBot: '#ffd29d',
    splitEdge: '#d48d44',
    splitIcon: '#d96908',
    soundStyle: 'marimba'
  },
  {
    id: 'crystal_box',
    name: '八音盒水晶',
    soundName: '清澈八音盒',
    unlockGoldFrames: 12,
    bgTop: '#f2f8ff',
    bgBottom: '#dfecfa',
    frameOuter: '#6b8eb8',
    frameShadow: '#496a91',
    feltBg: '#9dc0e6',
    feltDot: 'rgba(255,255,255,0.2)',
    normalTop: '#ffffff',
    normalBot: '#e8f1fb',
    normalEdge: '#afc6e2',
    pipColor: '#48668a',
    turnTop: '#dff3ff',
    turnBot: '#b6dfff',
    turnEdge: '#68a6df',
    turnIcon: '#1567bd',
    splitTop: '#fff0f5',
    splitBot: '#ffd1e1',
    splitEdge: '#df8aa8',
    splitIcon: '#d6457a',
    soundStyle: 'musicbox'
  },
  {
    id: 'bamboo_chime',
    name: '竹筒风铃',
    soundName: '空灵竹韵',
    unlockGoldFrames: 18,
    bgTop: '#f5faee',
    bgBottom: '#e1ecd5',
    frameOuter: '#6e8c54',
    frameShadow: '#4c6638',
    feltBg: '#a6c98e',
    feltDot: 'rgba(255,255,255,0.16)',
    normalTop: '#fcfff5',
    normalBot: '#e5f0d4',
    normalEdge: '#adc28f',
    pipColor: '#465e32',
    turnTop: '#e6f9ff',
    turnBot: '#c2ecfa',
    turnEdge: '#73b3c9',
    turnIcon: '#1b7a99',
    splitTop: '#fff7e0',
    splitBot: '#ffe29e',
    splitEdge: '#d6aa4e',
    splitIcon: '#cf7c0a',
    soundStyle: 'bamboo'
  }
];

/**
 * Look up a skin definition by id, falling back to default warm_wood.
 * @param {string} id
 * @returns {SkinDef}
 */
export function getSkinById(id) {
  return SKINS.find(s => s.id === id) || SKINS[0];
}
