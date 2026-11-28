import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CELL_GAP_PX,
  MAX_CELL_PX,
  MIN_CELL_PX,
  SAVE_KEY_BAK,
  SAVE_KEY_MAIN
} from '../minigame/src/core/constants.js';
import { GameEngine } from '../minigame/src/core/engine.js';
import { buildCloudKVData, buildLeaderboard, computeProgressScore } from '../minigame/src/core/leaderboard.js';
import { SaveManager } from '../minigame/src/core/save.js';
import { compileLevel, countStanding, simulatePush } from '../minigame/src/core/simulator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'minigame/levels/levels_001_020.json'), 'utf8'));

function memStorage() {
  const map = new Map();
  return {
    map,
    readStorage(k) { return map.has(k) ? map.get(k) : null; },
    writeStorage(k, v) { map.set(k, v); }
  };
}

function makeEngine() {
  const st = memStorage();
  const sm = new SaveManager(st);
  sm.load();
  return { engine: new GameEngine(LEVELS, sm), save: sm, storage: st };
}

test('E01: tapping normal/split domino does not push or spend push budget', () => {
  const { engine } = makeEngine();
  const lv = engine.currentLevel();
  const normalIdx = lv.types.findIndex((t, i) => lv.present[i] && t === '.');
  assert.ok(normalIdx >= 0);

  let wiggled = false;
  engine.onEvent(e => { if (e.type === 'TAP_NEED_SWIPE') wiggled = true; });

  const pushed = engine.tapCell(normalIdx);
  assert.equal(pushed, false);
  assert.equal(wiggled, true);
  assert.equal(engine.used, 0);
  assert.equal(engine.busy, false);
});

test('E02: turn domino locks direction to its own arrow regardless of swipe direction', () => {
  const { engine } = makeEngine();
  const lv = engine.currentLevel();
  const turnIdx = lv.types.findIndex((t, i) => lv.present[i] && t && t !== '.' && t !== '+');
  assert.ok(turnIdx >= 0);
  const turnDir = lv.types[turnIdx];
  const wrongDir = turnDir === '>' ? '<' : '>';

  let recordedDir = null;
  engine.onEvent(e => {
    if (e.type === 'CASCADE_STARTED') recordedDir = e.events[0].fallDir;
  });

  assert.equal(engine.pushCell(turnIdx, wrongDir), true);
  assert.equal(recordedDir, turnDir);
  assert.equal(engine.used, 1);
});

test('E03: inputs, undo, hint and reset are strictly ignored while busy in cascade', () => {
  const { engine } = makeEngine();
  const [y, x, d] = engine.currentLevel().def.sol[0];
  const idx = y * engine.currentLevel().W + x;

  assert.equal(engine.pushCell(idx, d), true);
  assert.equal(engine.busy, true);

  assert.equal(engine.undo(), false);
  assert.equal(engine.requestHint(), 'IGNORED');
  assert.equal(engine.resetLevel(), false);
  assert.equal(engine.pushCell(idx, d), false);

  engine.completeCascade();
  assert.equal(engine.busy, false);
});

test('E04 & E05: split domino handles boundary voids safely and simultaneous hits resolve deterministically', () => {
  // Synthetic 3x3 cross with 2 paths colliding on center (1,1)
  const def = {
    schemaVersion: 1, levelId: 99, tier: '易', name: '测试', theme: '符号', emoji: '🧪', limit: 1,
    art: ['RRR', 'RRR', 'RRR'],
    types: ['+.>', '...', '...'],
    sol: [[0, 0, '>']]
  };
  const lv = compileLevel(def);
  const r1 = simulatePush(lv.H, lv.W, lv.present, lv.types, new Uint8Array(9), 0, 0, '>');
  const r2 = simulatePush(lv.H, lv.W, lv.present, lv.types, new Uint8Array(9), 0, 0, '>');
  assert.deepEqual(r1.events, r2.events);
  // Splitter at (0,0) emits '>', '^' (out of bounds), 'v' cleanly without error
  assert.equal(r1.events[0].cellIndex, 0);
  assert.ok(r1.events.length >= 4);
});

test('E06: clearing last domino on final push (used === limit) wins instead of failing', () => {
  const { engine } = makeEngine();
  const lv = engine.currentLevel();
  const [y, x, d] = lv.def.sol[0];
  let won = false;
  let failed = false;
  engine.onEvent(e => {
    if (e.type === 'LEVEL_WON') won = true;
    if (e.type === 'LEVEL_FAILED') failed = true;
  });

  engine.pushCell(y * lv.W + x, d);
  engine.completeCascade();
  assert.equal(engine.used, engine.limit);
  assert.equal(won, true);
  assert.equal(failed, false);
  assert.equal(engine.ended, 'won');
});

test('E07: hint on diverged path returns OFF_PATH without deducting hint count; reset preserves remaining hints', () => {
  const { engine } = makeEngine();
  engine.loadLevelById(2);
  // Valid hint at start deducts 1 (3 -> 2)
  assert.equal(engine.requestHint(), 'SHOWN');
  assert.equal(engine.hintsLeft, 2);

  // Make a deliberately bad move (push bottom tip (6,3) downward -> falls only 1 tile)
  const lv = engine.currentLevel();
  engine.pushCell(6 * lv.W + 3, 'v');
  engine.completeCascade();

  assert.equal(engine.requestHint(), 'OFF_PATH');
  assert.equal(engine.hintsLeft, 2); // NOT deducted!

  // Undo back onto standard path -> hint works again
  assert.equal(engine.undo(), true);
  assert.equal(engine.requestHint(), 'SHOWN');
  assert.equal(engine.hintsLeft, 1);

  // Reset level preserves remaining hint count (1), preventing hint farming
  assert.equal(engine.resetLevel(), true);
  assert.equal(engine.hintsLeft, 1);
});

test('E08: undo from fail panel restores state, returns push, and resumes playing', () => {
  const { engine } = makeEngine();
  engine.loadLevelById(2); // limit = 2
  const lv = engine.currentLevel();

  // Spend both pushes on tiny dead-end moves so level fails
  engine.pushCell(6 * lv.W + 3, 'v');
  engine.completeCascade();
  engine.pushCell(0 * lv.W + 1, '^');
  engine.completeCascade();
  assert.equal(engine.ended, 'failed');

  assert.equal(engine.undo(), true);
  assert.equal(engine.ended, 'playing');
  assert.equal(engine.used, 1);
});

test('E09: FTUE guide hand disappears immediately after first push on Level 1', () => {
  const { engine } = makeEngine();
  assert.equal(engine.showFtueHand, true);
  const lv = engine.currentLevel();
  const [y, x, d] = lv.def.sol[0];
  engine.pushCell(y * lv.W + x, d);
  assert.equal(engine.showFtueHand, false);
});

test('E10: 12x12 grid fits 360px logical width with cellSize >= 24px and no horizontal overflow', () => {
  const tableInnerWidth = 360 - (6 + 6 + 6) * 2; // 324px (docs/04 §3.1)
  const cellSize = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.floor((tableInnerWidth - 11 * CELL_GAP_PX) / 12)));
  assert.ok(cellSize >= 24);
  assert.ok(12 * cellSize + 11 * CELL_GAP_PX <= tableInnerWidth);
});

test('SaveManager: dual-backup CRC32 recovers seamlessly when main save is corrupted', () => {
  const st = memStorage();
  const sm1 = new SaveManager(st);
  sm1.load();
  sm1.data.highestUnlockedLevel = 7;
  sm1.save(); // writes main
  sm1.data.highestUnlockedLevel = 9;
  sm1.save(); // copies v7 to bak, writes v9 to main

  // Corrupt main storage
  st.writeStorage(SAVE_KEY_MAIN, '{broken_json');
  const sm2 = new SaveManager(st);
  sm2.load();
  assert.equal(sm2.recoveredFromBackup, true);
  assert.equal(sm2.data.highestUnlockedLevel, 7);
  assert.ok(st.readStorage(SAVE_KEY_BAK));
});

test('Full 20-level playthrough unlocks all 3 skins (5/12/18 gold frames), collage flag & respects ad protection', () => {
  const { engine, save } = makeEngine();
  // Ad rescue strictly blocked on Lv.1-3
  assert.equal(engine.canOfferExtraPush(), false);

  let allClearedFired = false;
  engine.onEvent(e => { if (e.type === 'LEVEL_WON' && e.isAllCleared) allClearedFired = true; });

  for (let id = 1; id <= 20; id++) {
    assert.equal(engine.loadLevelById(id), true);
    assert.equal(engine.canOfferExtraPush(), id > 3);
    const lv = engine.currentLevel();
    for (const [y, x, d] of lv.def.sol) {
      assert.equal(engine.pushCell(y * lv.W + x, d), true);
      engine.completeCascade();
    }
    assert.equal(engine.ended, 'won');
    assert.equal(countStanding(lv.present, engine.fallen), 0);
  }

  assert.equal(save.countCleared(), 20);
  assert.equal(save.countGoldFrames(), 20);
  assert.equal(save.data.unlockedSkins.length, 4); // default + 3 unlockable skins
  assert.equal(allClearedFired, true);
});

test('Leaderboard: climbs rank live on level clears and sorts both progress and chain tabs deterministically', () => {
  const { engine, save } = makeEngine();
  const initialProg = buildLeaderboard(save, 'progress');
  assert.equal(initialProg.myEntry.rank, 11);
  assert.equal(initialProg.entries.length, 11);
  assert.match(initialProg.nextTargetHint, /再通关 1 关/);

  // Clear Level 1 (22 chain, 1 gold frame) -> overtakes bottom benchmark (1 cleared, 0 gold, 18 chain)
  const lv1 = engine.currentLevel();
  const [y1, x1, d1] = lv1.def.sol[0];
  engine.pushCell(y1 * lv1.W + x1, d1);
  engine.completeCascade();

  const afterLv1Prog = buildLeaderboard(save, 'progress');
  assert.equal(afterLv1Prog.myEntry.clearedCount, 1);
  assert.equal(afterLv1Prog.myEntry.goldFrames, 1);
  assert.equal(afterLv1Prog.myEntry.rank, 10);

  const afterLv1Chain = buildLeaderboard(save, 'chain');
  assert.equal(afterLv1Chain.myEntry.bestChain, 22);
  assert.equal(afterLv1Chain.myEntry.rank, 10);

  // Clear all 20 levels perfectly -> reaches #1 on both tabs
  for (let id = 2; id <= 20; id++) {
    engine.loadLevelById(id);
    const lv = engine.currentLevel();
    for (const [y, x, d] of lv.def.sol) {
      engine.pushCell(y * lv.W + x, d);
      engine.completeCascade();
    }
  }
  const topProg = buildLeaderboard(save, 'progress');
  assert.equal(topProg.myEntry.rank, 1);
  assert.match(topProg.nextTargetHint, /登顶/);

  const topChain = buildLeaderboard(save, 'chain');
  assert.equal(topChain.myEntry.rank, 1);
  assert.equal(topChain.myEntry.bestChain, 74);
});

test('Leaderboard: buildCloudKVData outputs valid WeChat setUserCloudStorage KVDataList', () => {
  const { engine, save } = makeEngine();
  const lv1 = engine.currentLevel();
  const [y1, x1, d1] = lv1.def.sol[0];
  engine.pushCell(y1 * lv1.W + x1, d1);
  engine.completeCascade();

  const kv = buildCloudKVData(save);
  const byKey = Object.fromEntries(kv.map(item => [item.key, item.value]));
  assert.equal(byKey.cleared_count, '1');
  assert.equal(byKey.gold_frames, '1');
  assert.equal(byKey.best_chain, '22');

  const wxPayload = JSON.parse(byKey.wxgame_score);
  assert.equal(wxPayload.wxgame.score, computeProgressScore(1, 1, 22));
  assert.equal(typeof wxPayload.wxgame.update_time, 'number');
});

