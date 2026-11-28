// @ts-check
import { simulatePush } from './simulator.js';

/** @typedef {import('../../../types/domain.d.ts').CompiledLevel} CompiledLevel */
/** @typedef {import('../../../types/domain.d.ts').Dir} Dir */

/**
 * Check whether two Uint8Arrays have identical contents.
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Evaluate a hint request against the level's verified standard solution `sol`.
 * Strict E07 compliance: if player diverged from `sol[0..used-1]`, return OFF_PATH
 * without consuming a hint.
 * @param {CompiledLevel} level
 * @param {Uint8Array} currentFallen
 * @param {number} usedPushes
 * @param {number} hintsLeft
 * @returns {{ ok: true; y: number; x: number; dir: Dir } | { ok: false; reason: 'NO_HINTS' | 'OFF_PATH' }}
 */
export function evaluateHint(level, currentFallen, usedPushes, hintsLeft) {
  if (hintsLeft <= 0) {
    return { ok: false, reason: 'NO_HINTS' };
  }
  const sol = level.def.sol;
  if (usedPushes >= sol.length) {
    return { ok: false, reason: 'OFF_PATH' };
  }

  /** @type {Uint8Array} */
  let expected = new Uint8Array(level.W * level.H);
  for (let k = 0; k < usedPushes; k++) {
    const [y, x, dir] = sol[k];
    expected = simulatePush(level.H, level.W, level.present, level.types, expected, y, x, dir).nextFallen;
  }

  if (!sameBytes(expected, currentFallen)) {
    return { ok: false, reason: 'OFF_PATH' };
  }
  const [y, x, dir] = sol[usedPushes];
  return { ok: true, y, x, dir };
}
