// @ts-check
import { SoundEngine } from './audio/sound-engine.js';
import {
  CASCADE_TAIL_MS,
  FeatureFlags,
  SWIPE_THRESHOLD_PX,
  getSkinById,
  stepDelayMs
} from './core/constants.js';
import { GameEngine } from './core/engine.js';
import { SaveManager } from './core/save.js';
import { CanvasRenderer } from './renderer/canvas-renderer.js';

/** @typedef {import('../../types/domain.d.ts').Dir} Dir */
/** @typedef {import('../../types/domain.d.ts').LevelDef} LevelDef */
/** @typedef {import('../../types/domain.d.ts').CascadeEvent} CascadeEvent */
/** @typedef {import('../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */

/**
 * Host-agnostic engine bootstrap shared by WeChat Mini-Game (`minigame/game.js`)
 * and Web Preview (`preview/index.html`).
 * @param {IPlatformAdapter} platform
 */
export async function bootstrap(platform) {
  /** @type {LevelDef[]} */
  const levelDefs = await platform.loadJson('levels/levels_001_020.json');

  const save = new SaveManager(platform);
  save.load();

  const engine = new GameEngine(levelDefs, save);
  const sound = new SoundEngine(platform);
  sound.muted = save.data.settings.muted;
  sound.haptics = save.data.settings.haptics;
  sound.soundStyle = getSkinById(save.getActiveSkinId()).soundStyle;

  const renderer = new CanvasRenderer(platform, engine);

  // Active cascade playback queue driven strictly by rAF timestamps (pause-safe, zero setTimeout drift)
  /** @type {{ triggerMs: number; ev: CascadeEvent; comboN: number; voiceInLayer: number }[]} */
  let pendingSteps = [];
  let cascadeEndAtMs = 0;
  let lastFrameMs = 0;
  let currentNowMs = 0;

  // Bind engine domain events → audio + renderer + analytics
  engine.onEvent(ev => {
    const now = currentNowMs;
    if (ev.type === 'LEVEL_LOADED') {
      pendingSteps = [];
      cascadeEndAtMs = 0;
      renderer.syncLevelVisuals();
      platform.reportEvent('level_start', {
        level_id: ev.levelId,
        is_replay: Boolean(save.data.clearedLevels[ev.levelId])
      });
    } else if (ev.type === 'CASCADE_STARTED') {
      // Precompute accelerated layer timestamps (docs/01 §6.1)
      /** @type {number[]} */
      const layerTimes = [0];
      for (let t = 1; t <= ev.maxLayer + 1; t++) {
        layerTimes[t] = layerTimes[t - 1] + stepDelayMs(t - 1);
      }
      /** @type {Record<number, number>} */
      const perLayer = {};
      pendingSteps = ev.events.map((step, idx) => {
        perLayer[step.layer] = (perLayer[step.layer] || 0) + 1;
        return {
          triggerMs: now + layerTimes[step.layer],
          ev: step,
          comboN: idx + 1,
          voiceInLayer: perLayer[step.layer]
        };
      });
      cascadeEndAtMs = now + layerTimes[ev.maxLayer] + CASCADE_TAIL_MS;
      platform.reportEvent('push_executed', {
        level_id: engine.currentLevel().def.levelId,
        push_idx: ev.pushIndex,
        chain_size: ev.events.length
      });
    } else if (ev.type === 'CASCADE_FINISHED') {
      renderer.onCascadeFinishedVisual(ev.chainSize, now);
    } else if (ev.type === 'TAP_NEED_SWIPE') {
      renderer.triggerWiggle(ev.cellIndex, now);
    } else if (ev.type === 'UNDO_APPLIED') {
      renderer.triggerUndoVisual(ev.restoredCells, now);
      sound.playUndo();
      platform.reportEvent('level_action', {
        level_id: engine.currentLevel().def.levelId,
        action_type: 'undo',
        hints_left: engine.hintsLeft
      });
    } else if (ev.type === 'HINT_SHOWN') {
      sound.playUndo();
      renderer.showToast('💡 照着黄色滑标推这一块', now);
      platform.reportEvent('level_action', {
        level_id: engine.currentLevel().def.levelId,
        action_type: 'hint',
        hints_left: ev.hintsLeft
      });
    } else if (ev.type === 'LEVEL_WON') {
      renderer.triggerWinCelebration(now);
      sound.playWin();
      if (ev.newlyUnlockedSkins.length) {
        const s = getSkinById(ev.newlyUnlockedSkins[0]);
        renderer.showToast(`🎉 解锁新皮肤：${s.name}！`, now);
      }
      platform.reportEvent('level_win', {
        level_id: ev.levelId,
        pushes_used: ev.pushesUsed,
        best_chain: ev.bestChain,
        is_perfect: ev.isPerfect,
        duration_sec: Math.round((Date.now() - engine.levelStartTs) / 1000)
      });
    } else if (ev.type === 'LEVEL_FAILED') {
      sound.playFail();
      platform.reportEvent('level_fail', {
        level_id: engine.currentLevel().def.levelId,
        remaining_tiles: ev.remainingStanding,
        extra_used: engine.extraPushesUsed
      });
    } else if (ev.type === 'SKIN_CHANGED') {
      sound.soundStyle = getSkinById(ev.skinId).soundStyle;
      renderer.tableCacheKey = '';
      sound.playClack(3, 1);
      platform.reportEvent('skin_equip', { skin_id: ev.skinId });
    } else if (ev.type === 'TOAST') {
      renderer.showToast(ev.message, now);
    }
  });

  // Helper for rewarded ad + graceful fallback (docs/05 §2.3)
  let adBusy = false;
  /**
   * @param {'A1' | 'A2' | 'A3'} slotId
   * @param {() => void} onReward
   */
  async function triggerRewardedAction(slotId, onReward) {
    if (adBusy) return;
    if (!FeatureFlags.adEnabled || FeatureFlags.isPremiumDesktop) {
      onReward();
      return;
    }
    adBusy = true;
    const levelId = engine.currentLevel().def.levelId;
    platform.reportEvent('ad_event', { slot_id: slotId, stage: 'request', level_id: levelId });
    try {
      const res = await platform.showRewardedAd(slotId);
      if (res.completed) {
        platform.reportEvent('ad_event', { slot_id: slotId, stage: 'complete', level_id: levelId });
        onReward();
      } else if (res.error) {
        platform.reportEvent('ad_event', { slot_id: slotId, stage: 'error', level_id: levelId });
        renderer.showToast('暂无可播放视频，请稍后再试', currentNowMs);
      } else {
        renderer.showToast('完整观看视频后即可领取奖励', currentNowMs);
      }
    } finally {
      adBusy = false;
    }
  }

  // Gesture state machine (docs/04 §3.2)
  /** @type {{ cellIndex: number; x0: number; y0: number; dir: Dir | null } | null} */
  let boardDrag = null;

  /**
   * @param {string} id
   * @param {any} payload
   */
  function handleUIButton(id, payload) {
    if (id === 'close_overlay') {
      renderer.overlay = 'none';
      sound.playUndo();
    } else if (id === 'open_gallery') {
      renderer.overlay = 'gallery';
      sound.playUndo();
    } else if (id === 'open_skins') {
      renderer.overlay = 'skins';
      sound.playUndo();
    } else if (id === 'open_collage') {
      renderer.overlay = 'collage';
      sound.playUndo();
    } else if (id === 'open_info') {
      renderer.overlay = 'info';
      sound.playUndo();
    } else if (id === 'toggle_mute') {
      sound.muted = engine.toggleMute();
      if (!sound.muted) sound.playClack(2, 1);
    } else if (id === 'undo') {
      engine.undo();
    } else if (id === 'reset') {
      if (engine.resetLevel()) {
        sound.playUndo();
        platform.reportEvent('level_action', {
          level_id: engine.currentLevel().def.levelId,
          action_type: 'reset',
          hints_left: engine.hintsLeft
        });
      }
    } else if (id === 'replay') {
      engine.resetLevel();
      sound.playUndo();
    } else if (id === 'next_level') {
      if (!engine.nextLevel()) {
        renderer.overlay = 'gallery';
      }
      sound.playUndo();
    } else if (id === 'hint') {
      const snap = engine.getSnapshot();
      if (snap.hintsLeft <= 0 && engine.canOfferExtraHints()) {
        void triggerRewardedAction('A2', () => {
          engine.grantExtraHints();
          engine.requestHint();
        });
      } else {
        engine.requestHint();
      }
    } else if (id === 'extra_push') {
      if (engine.canOfferExtraPush()) {
        void triggerRewardedAction('A1', () => {
          engine.grantExtraPush();
        });
      }
    } else if (id === 'select_level' && typeof payload === 'number') {
      renderer.overlay = 'none';
      engine.loadLevelById(payload, false);
      sound.playUndo();
    } else if (id === 'equip_skin' && typeof payload === 'string') {
      engine.equipSkin(payload);
    } else if (id === 'trial_skin' && typeof payload === 'string') {
      void triggerRewardedAction('A3', () => {
        engine.startSkinTrial(payload);
      });
    } else if (id === 'share_collage') {
      const gold = save.countGoldFrames();
      platform.shareMessage({
        title: `我已推倒全部 20 幅像素画！最高连锁 ×${save.data.globalBestChain}，收集 ${gold} 枚完美金框！`
      });
      platform.reportEvent('share_event', { scene: 'collage', level_id: 20 });
      renderer.showToast('已呼出分享面板', currentNowMs);
    }
  }

  platform.onPointerDown(p => {
    sound.ensureReady();
    const pt = renderer.screenToLogical(p.x, p.y);
    const hit = renderer.hitTestUI(pt.x, pt.y);
    if (hit) {
      handleUIButton(hit.id, hit.payload);
      return;
    }
    if (renderer.overlay !== 'none') return;

    const snap = engine.getSnapshot();
    if (snap.busy || snap.ended !== 'playing') return;

    const cellIndex = renderer.hitTestCell(pt.x, pt.y);
    if (cellIndex < 0) return;
    if (!snap.level.present[cellIndex] || snap.fallen[cellIndex]) return;

    boardDrag = { cellIndex, x0: pt.x, y0: pt.y, dir: null };
    renderer.dragVisual = { cellIndex, dir: null };
  });

  platform.onPointerMove(p => {
    if (!boardDrag) return;
    const pt = renderer.screenToLogical(p.x, p.y);
    const dx = pt.x - boardDrag.x0;
    const dy = pt.y - boardDrag.y0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return;

    const tp = engine.currentLevel().types[boardDrag.cellIndex];
    /** @type {Dir} */
    const dir = (tp && tp !== '.' && tp !== '+')
      ? tp
      : (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '>' : '<') : (dy > 0 ? 'v' : '^'));
    boardDrag.dir = dir;
    renderer.dragVisual = { cellIndex: boardDrag.cellIndex, dir };
  });

  platform.onPointerUp(() => {
    if (!boardDrag) return;
    const d = boardDrag;
    boardDrag = null;
    renderer.dragVisual = null;
    if (d.dir) {
      engine.pushCell(d.cellIndex, d.dir);
    } else {
      engine.tapCell(d.cellIndex);
    }
  });

  platform.onResize(vp => renderer.resize(vp));
  platform.onLifecycle(state => sound.onLifecycle(state));

  // Main render & cascade playback loop
  /** @param {number} ts */
  function frame(ts) {
    currentNowMs = ts;
    const dtSec = lastFrameMs ? Math.min(0.05, Math.max(0.001, (ts - lastFrameMs) / 1000)) : 1 / 60;
    lastFrameMs = ts;

    // Drain cascade steps scheduled up to current timestamp
    while (pendingSteps.length > 0 && pendingSteps[0].triggerMs <= ts) {
      const item = pendingSteps.shift();
      if (!item) break;
      renderer.triggerFall(item.ev.cellIndex, item.ev.fallDir, item.comboN, ts);
      sound.playClack(item.ev.layer, item.voiceInLayer);
      sound.pulseCascadeHaptic(ts);
    }

    if (engine.busy && pendingSteps.length === 0 && cascadeEndAtMs > 0 && ts >= cascadeEndAtMs) {
      cascadeEndAtMs = 0;
      engine.completeCascade();
    }

    renderer.render(ts, dtSec);
    platform.requestAnimationFrame(frame);
  }

  platform.requestAnimationFrame(frame);
  return { engine, save, sound, renderer };
}
