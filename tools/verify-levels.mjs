import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ART_PALETTE, DIRS, DV } from '../minigame/src/core/constants.js';
import { compileLevel, countStanding, isSolvableWithin, simulatePush } from '../minigame/src/core/simulator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVEL_FILE = path.join(ROOT, 'minigame/levels/levels_001_020.json');

const levels = JSON.parse(fs.readFileSync(LEVEL_FILE, 'utf8'));
if (!Array.isArray(levels) || levels.length !== 20) {
  throw new Error(`Expected 20 levels in v1.0.0 pack, found ${levels?.length}`);
}

for (let idx = 0; idx < levels.length; idx++) {
  const def = levels[idx];
  const expectedId = idx + 1;
  if (def.levelId !== expectedId) {
    throw new Error(`Level ID sequence broken at index ${idx}: got ${def.levelId}, expected ${expectedId}`);
  }
  const lv = compileLevel(def);
  if (lv.W > 12 || lv.H > 12 || lv.W < 4 || lv.H < 4) {
    throw new Error(`Lv.${def.levelId} dimensions out of bounds: ${lv.W}x${lv.H}`);
  }

  // Validate palette colors, special tile bounds & zero 1-cell islands
  const seen = new Uint8Array(lv.W * lv.H);
  let spec = 0;
  let turns = 0;
  let splits = 0;
  for (let i = 0; i < lv.W * lv.H; i++) {
    if (!lv.present[i]) continue;
    const ch = lv.colors[i];
    if (!ch || !ART_PALETTE[ch]) {
      throw new Error(`Lv.${def.levelId} invalid palette color "${ch}"`);
    }
    const tp = lv.types[i];
    if (tp && tp !== '.') {
      spec++;
      if (tp === '+') splits++;
      else turns++;
    }
    if (!seen[i]) {
      const q = [i];
      seen[i] = 1;
      for (let qi = 0; qi < q.length; qi++) {
        const u = q[qi];
        const y = Math.floor(u / lv.W);
        const x = u % lv.W;
        for (const d of DIRS) {
          const ny = y + DV[d][0];
          const nx = x + DV[d][1];
          if (ny < 0 || nx < 0 || ny >= lv.H || nx >= lv.W) continue;
          const ni = ny * lv.W + nx;
          if (lv.present[ni] && !seen[ni]) {
            seen[ni] = 1;
            q.push(ni);
          }
        }
      }
      if (q.length === 1) {
        throw new Error(`Lv.${def.levelId} contains isolated 1-cell island`);
      }
    }
  }

  const pSpec = spec / lv.total;
  if (pSpec < 0.08 || pSpec > 0.30 || turns < 1 || splits < 1) {
    throw new Error(`Lv.${def.levelId} special ratio violation: ${(pSpec * 100).toFixed(1)}% (T${turns}/S${splits})`);
  }

  // Replay sol & assert 100% clear + min coverage
  if (def.sol.length !== def.limit) {
    throw new Error(`Lv.${def.levelId} sol.length (${def.sol.length}) !== limit (${def.limit})`);
  }
  let fallen = new Uint8Array(lv.W * lv.H);
  const sizes = [];
  for (const [y, x, dir] of def.sol) {
    const r = simulatePush(lv.H, lv.W, lv.present, lv.types, fallen, y, x, dir);
    fallen = r.nextFallen;
    sizes.push(r.events.length);
  }
  if (countStanding(lv.present, fallen) !== 0) {
    throw new Error(`Lv.${def.levelId} standard sol does not clear all dominoes`);
  }
  const minSz = Math.min(...sizes);
  if (minSz < Math.max(3, Math.floor(lv.total * 0.10))) {
    throw new Error(`Lv.${def.levelId} min push coverage too small: ${minSz}/${lv.total}`);
  }
  if (def.tier === '爽' && Math.max(...sizes) / lv.total < 0.60) {
    throw new Error(`Lv.${def.levelId} reward level max push < 60%`);
  }

  // Exact BFS tightness proof: limit - 1 must be strictly unsolvable
  if (def.limit > 1) {
    const tight = isSolvableWithin(lv, new Uint8Array(lv.W * lv.H), def.limit - 1);
    if (tight !== false) {
      throw new Error(`Lv.${def.levelId} failed tightness proof: solvable in ${def.limit - 1} pushes!`);
    }
  }
  console.log(`  OK Lv.${String(def.levelId).padStart(2, '0')} [${def.tier}] ${def.name} (${lv.W}x${lv.H}, n=${lv.total}, L=${def.limit}, ${sizes.join('+')}, L-1 proven unsolvable)`);
}

console.log(`ALL ${levels.length} LEVELS VERIFIED (L3 GATE PASSED)`);
