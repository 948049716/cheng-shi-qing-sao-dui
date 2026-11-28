// @ts-check
import { DIRS, DV } from './constants.js';

/** @typedef {import('../../../types/domain.d.ts').Dir} Dir */
/** @typedef {import('../../../types/domain.d.ts').DominoCellType} DominoCellType */
/** @typedef {import('../../../types/domain.d.ts').LevelDef} LevelDef */
/** @typedef {import('../../../types/domain.d.ts').CompiledLevel} CompiledLevel */
/** @typedef {import('../../../types/domain.d.ts').CascadeEvent} CascadeEvent */
/** @typedef {import('../../../types/domain.d.ts').SimulateResult} SimulateResult */

/**
 * Rotate direction 90 degrees counter-clockwise.
 * @param {Dir} d
 * @returns {Dir}
 */
export function turnLeft(d) {
  return DIRS[(DIRS.indexOf(d) + 3) % 4];
}

/**
 * Rotate direction 90 degrees clockwise.
 * @param {Dir} d
 * @returns {Dir}
 */
export function turnRight(d) {
  return DIRS[(DIRS.indexOf(d) + 1) % 4];
}

/**
 * Compile a declarative LevelDef JSON into flat typed arrays for fast simulation.
 * @param {LevelDef} def
 * @returns {CompiledLevel}
 */
export function compileLevel(def) {
  const H = def.art.length;
  const W = def.art[0].length;
  const present = new Uint8Array(W * H);
  /** @type {DominoCellType[]} */
  const types = new Array(W * H).fill(null);
  /** @type {(string | null)[]} */
  const colors = new Array(W * H).fill(null);
  let total = 0;

  for (let y = 0; y < H; y++) {
    const aRow = def.art[y];
    const tRow = def.types[y];
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ch = aRow[x];
      if (ch !== '.') {
        present[i] = 1;
        colors[i] = ch;
        const tc = tRow[x];
        types[i] = /** @type {DominoCellType} */ (tc === ' ' ? '.' : tc);
        total++;
      }
    }
  }
  return { def, H, W, present, types, colors, total };
}

/**
 * Shared deterministic BFS domino cascade simulator (used by runtime, generator & verifier).
 * Pure function: does not mutate `fallen`.
 * @param {number} H
 * @param {number} W
 * @param {Uint8Array} present
 * @param {readonly DominoCellType[]} types
 * @param {Uint8Array} fallen
 * @param {number} y0
 * @param {number} x0
 * @param {Dir} d0
 * @returns {SimulateResult}
 */
export function simulatePush(H, W, present, types, fallen, y0, x0, d0) {
  const nextFallen = new Uint8Array(fallen);
  /** @type {CascadeEvent[]} */
  const events = [];
  /** @type {[number, number, Dir, number][]} */
  const queue = [[y0, x0, d0, 0]];
  let maxLayer = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    const [y, x, d, layer] = queue[qi];
    if (y < 0 || x < 0 || y >= H || x >= W) continue;
    const i = y * W + x;
    if (!present[i] || nextFallen[i]) continue;

    nextFallen[i] = 1;
    const tp = types[i];
    /** @type {Dir} */
    const fallDir = (tp === '.' || tp === '+' || tp === null) ? d : tp;
    events.push({ cellIndex: i, y, x, fallDir, layer });
    if (layer > maxLayer) maxLayer = layer;

    /** @type {Dir[]} */
    const emits = tp === '+' ? [d, turnLeft(d), turnRight(d)] : [fallDir];
    for (const e of emits) {
      const [dy, dx] = DV[e];
      queue.push([y + dy, x + dx, e, layer + 1]);
    }
  }
  return { nextFallen, events, maxLayer };
}

/**
 * Count standing dominoes remaining on the board.
 * @param {Uint8Array} present
 * @param {Uint8Array} fallen
 * @returns {number}
 */
export function countStanding(present, fallen) {
  let left = 0;
  for (let i = 0; i < present.length; i++) {
    if (present[i] && !fallen[i]) left++;
  }
  return left;
}

/**
 * Enumerate all legal pushes from a given fallen state.
 * @param {number} H
 * @param {number} W
 * @param {Uint8Array} present
 * @param {readonly DominoCellType[]} types
 * @param {Uint8Array} fallen
 * @returns {[number, number, Dir][]}
 */
export function listLegalPushes(H, W, present, types, fallen) {
  /** @type {[number, number, Dir][]} */
  const out = [];
  for (let i = 0; i < H * W; i++) {
    if (!present[i] || fallen[i]) continue;
    const t = types[i];
    const y = Math.floor(i / W);
    const x = i % W;
    if (t === '.' || t === '+' || t === null) {
      for (const d of DIRS) out.push([y, x, d]);
    } else {
      out.push([y, x, t]);
    }
  }
  return out;
}

/**
 * Exact BFS solvability check within at most `k` pushes from `startFallen`.
 * Returns true if solvable, false if proven unsolvable, or null if state budget exceeded.
 * @param {CompiledLevel} level
 * @param {Uint8Array} startFallen
 * @param {number} k
 * @param {number} [maxStates=400000]
 * @returns {boolean | null}
 */
export function isSolvableWithin(level, startFallen, k, maxStates = 400000) {
  const { H, W, present, types } = level;
  if (countStanding(present, startFallen) === 0) return true;
  if (k <= 0) return false;

  /** @type {Uint8Array[]} */
  let frontier = [startFallen];
  for (let depth = 1; depth <= k; depth++) {
    /** @type {Map<string, Uint8Array>} */
    const next = new Map();
    for (const st of frontier) {
      for (const [y, x, d] of listLegalPushes(H, W, present, types, st)) {
        const { nextFallen } = simulatePush(H, W, present, types, st, y, x, d);
        if (countStanding(present, nextFallen) === 0) return true;
        if (depth < k) {
          const key = nextFallen.join('');
          if (!next.has(key)) next.set(key, nextFallen);
        }
      }
    }
    frontier = Array.from(next.values());
    if (frontier.length > maxStates) return null;
  }
  return false;
}
