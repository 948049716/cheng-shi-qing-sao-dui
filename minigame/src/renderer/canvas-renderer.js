// @ts-check
import {
  ART_PALETTE,
  CELL_GAP_PX,
  DIR_RAD,
  DV,
  FALL_DOMINO_MS,
  FALL_TILE_MS,
  FeatureFlags,
  GAME_TITLE,
  GAME_VERSION,
  MAX_CELL_PX,
  MIN_CELL_PX,
  SKINS,
  getSkinById
} from '../core/constants.js';
import { DominoCache, roundRectPath } from './domino-cache.js';
import { ParticlePool } from './particle-pool.js';

/** @typedef {import('../../../types/domain.d.ts').Dir} Dir */
/** @typedef {import('../../../types/domain.d.ts').CompiledLevel} CompiledLevel */
/** @typedef {import('../../../types/domain.d.ts').EngineSnapshot} EngineSnapshot */
/** @typedef {import('../../../types/domain.d.ts').SkinDef} SkinDef */
/** @typedef {import('../../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */
/** @typedef {import('../../../types/platform.d.ts').ViewportMetrics} ViewportMetrics */
/** @typedef {import('../../../types/platform.d.ts').CanvasLike} CanvasLike */
/** @typedef {import('../core/engine.js').GameEngine} GameEngine */

/**
 * @typedef {{ id: string; x: number; y: number; w: number; h: number; payload?: any; disabled?: boolean }} HitBox
 */
/**
 * @typedef {{ cellIndex: number; dir: Dir; startMs: number; color: string; tp: any }} FallAnim
 */
/**
 * @typedef {{ cellIndex: number; startMs: number; delayMs: number }} UndoAnim
 */

const FONT_STACK = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

export class CanvasRenderer {
  /**
   * @param {IPlatformAdapter} platform
   * @param {GameEngine} engine
   */
  constructor(platform, engine) {
    this.platform = platform;
    this.engine = engine;
    this.canvas = platform.createMainCanvas();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D rendering context');
    /** @type {CanvasRenderingContext2D} */
    this.ctx = ctx;

    this.dominoCache = new DominoCache(platform);
    this.particles = new ParticlePool(256);

    /** @type {ViewportMetrics} */
    this.vp = platform.getViewportMetrics();
    this.logicalW = 360;
    this.logicalH = 640;
    this.offsetX = 0; // horizontal centering on desktop wide screens
    this.scale = 1;

    // Board layout metrics in logical coords
    this.board = {
      frameX: 12,
      frameY: 112,
      frameW: 336,
      frameH: 336,
      gridX: 24,
      gridY: 124,
      cellSize: 32,
      gap: CELL_GAP_PX
    };

    // Offscreen caches (Layer 0 table + Layer 1 settled tiles)
    /** @type {CanvasLike | null} */
    this.tableCache = null;
    this.tableCacheKey = '';
    /** @type {CanvasLike | null} */
    this.settledCache = null;
    /** @type {CanvasRenderingContext2D | null} */
    this.settledCtx = null;

    // Visual state decoupled from instant logical fallen array during cascade playback
    /** @type {Uint8Array} */
    this.visualDown = new Uint8Array(0);
    /** @type {FallAnim[]} */
    this.fallAnims = [];
    /** @type {UndoAnim[]} */
    this.undoAnims = [];
    /** @type {{ cellIndex: number; startMs: number } | null} */
    this.wiggleAnim = null;
    this.winWaveStartMs = 0;
    this.shakeEndMs = 0;

    // Combo & Toast overlays
    this.comboCount = 0;
    this.comboLabel = '';
    this.comboHideAtMs = 0;
    this.comboBumpMs = 0;
    this.toastMsg = '';
    this.toastHideAtMs = 0;

    // Active drag visual
    /** @type {{ cellIndex: number; dir: Dir | null } | null} */
    this.dragVisual = null;

    // Modal overlays: 'none' | 'gallery' | 'skins' | 'collage' | 'info'
    /** @type {'none' | 'gallery' | 'skins' | 'collage' | 'info'} */
    this.overlay = 'none';

    /** @type {HitBox[]} */
    this.hitBoxes = [];

    this.resize(this.vp);
    this.syncLevelVisuals();
  }

  /**
   * Current active skin definition.
   * @returns {SkinDef}
   */
  getSkin() {
    return getSkinById(this.engine.save.getActiveSkinId());
  }

  /**
   * Recompute viewport scaling & board cellSize (E10 compliant: >= 24px on 360px 12x12).
   * @param {ViewportMetrics} vp
   */
  resize(vp) {
    this.vp = vp;
    const physW = Math.max(1, Math.floor(vp.width * vp.dpr));
    const physH = Math.max(1, Math.floor(vp.height * vp.dpr));
    this.canvas.width = physW;
    this.canvas.height = physH;

    // Mobile portrait: lock logicalW = 360; wide desktop: fit 9:16 column centered
    if (vp.width / vp.height > 0.72) {
      this.logicalH = 680;
      this.logicalW = 382;
      this.scale = Math.min(vp.width / this.logicalW, vp.height / this.logicalH);
      this.offsetX = Math.floor((vp.width - this.logicalW * this.scale) / 2);
    } else {
      this.logicalW = 360;
      this.scale = vp.width / this.logicalW;
      this.logicalH = Math.max(600, Math.round(vp.height / this.scale));
      this.offsetX = 0;
    }
    this.recomputeBoardMetrics();
  }

  /**
   * Convert screen pointer coordinate to logical coordinate.
   * @param {number} sx
   * @param {number} sy
   * @returns {{ x: number; y: number }}
   */
  screenToLogical(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: sy / this.scale
    };
  }

  /**
   * Compute exact board position & cell size for current level (docs/04 §3.1).
   */
  recomputeBoardMetrics() {
    const snap = this.engine.getSnapshot();
    const { W, H } = snap.level;
    const safeTopLogical = Math.max(8, Math.round(this.vp.safeTop / this.scale));
    const safeBotLogical = Math.max(8, Math.round(this.vp.safeBottom / this.scale));

    const headerBottom = safeTopLogical + 44;
    const infoBottom = headerBottom + 32;
    const bottomReserve = 166 + safeBotLogical; // room for toolbar OR win/fail inline panel + footer

    const frameMarginX = 6;
    const frameBorder = 6;
    const innerPad = 6;
    const availW = this.logicalW - (frameMarginX + frameBorder + innerPad) * 2;
    const maxBoardH = Math.max(240, this.logicalH - infoBottom - bottomReserve - (frameBorder + innerPad) * 2);

    const csW = Math.floor((availW - (W - 1) * CELL_GAP_PX) / W);
    const csH = Math.floor((maxBoardH - (H - 1) * CELL_GAP_PX) / H);
    const cellSize = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.min(csW, csH)));

    const gridW = W * cellSize + (W - 1) * CELL_GAP_PX;
    const gridH = H * cellSize + (H - 1) * CELL_GAP_PX;
    const frameW = Math.max(gridW + (frameBorder + innerPad) * 2, this.logicalW - frameMarginX * 2);
    const frameH = Math.max(gridH + (frameBorder + innerPad) * 2, Math.min(frameW, maxBoardH + (frameBorder + innerPad) * 2));

    const frameX = Math.round((this.logicalW - frameW) / 2);
    const frameY = Math.round(infoBottom + 8);
    const gridX = Math.round(frameX + (frameW - gridW) / 2);
    const gridY = Math.round(frameY + (frameH - gridH) / 2);

    this.board = {
      frameX,
      frameY,
      frameW,
      frameH,
      gridX,
      gridY,
      cellSize,
      gap: CELL_GAP_PX
    };

    this.tableCacheKey = '';
    this.rebuildSettledCache();
  }

  /**
   * Hit-test logical point against current board cells.
   * @param {number} lx
   * @param {number} ly
   * @returns {number} cellIndex or -1
   */
  hitTestCell(lx, ly) {
    const { W, H } = this.engine.currentLevel();
    const { gridX, gridY, cellSize, gap } = this.board;
    const step = cellSize + gap;
    const rx = lx - gridX;
    const ry = ly - gridY;
    if (rx < 0 || ry < 0) return -1;
    const x = Math.floor(rx / step);
    const y = Math.floor(ry / step);
    if (x < 0 || x >= W || y < 0 || y >= H) return -1;
    // Allow slight touch forgiveness into the 3px gap
    return y * W + x;
  }

  /**
   * Hit-test logical point against registered UI buttons (reverse z-order).
   * @param {number} lx
   * @param {number} ly
   * @returns {HitBox | null}
   */
  hitTestUI(lx, ly) {
    for (let i = this.hitBoxes.length - 1; i >= 0; i--) {
      const b = this.hitBoxes[i];
      if (!b.disabled && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) {
        return b;
      }
    }
    return null;
  }

  /**
   * Reset visual state to match current level's engine state (e.g. on level load).
   */
  syncLevelVisuals() {
    const snap = this.engine.getSnapshot();
    this.visualDown = new Uint8Array(snap.fallen);
    this.fallAnims = [];
    this.undoAnims = [];
    this.wiggleAnim = null;
    this.winWaveStartMs = 0;
    this.comboCount = 0;
    this.comboLabel = '';
    this.comboHideAtMs = 0;
    this.dragVisual = null;
    this.particles.clear();
    this.recomputeBoardMetrics();
  }

  /**
   * Rebuild Layer 1 offscreen settled pixel-art tile cache from `visualDown`.
   */
  rebuildSettledCache() {
    const { W, H, present, colors } = this.engine.currentLevel();
    const { cellSize, gap } = this.board;
    const gridW = W * cellSize + (W - 1) * gap;
    const gridH = H * cellSize + (H - 1) * gap;
    const dpr = this.vp.dpr * this.scale;
    this.settledCache = this.platform.createOffscreenCanvas(
      Math.max(1, Math.ceil(gridW * dpr)),
      Math.max(1, Math.ceil(gridH * dpr))
    );
    this.settledCtx = this.settledCache.getContext('2d');
    if (!this.settledCtx) return;
    this.settledCtx.save();
    this.settledCtx.scale(dpr, dpr);
    this.settledCtx.clearRect(0, 0, gridW, gridH);
    for (let i = 0; i < W * H; i++) {
      if (present[i] && this.visualDown[i]) {
        const x = (i % W) * (cellSize + gap);
        const y = Math.floor(i / W) * (cellSize + gap);
        this.drawPixelTile(this.settledCtx, x, y, cellSize, colors[i]);
      }
    }
    this.settledCtx.restore();
  }

  /**
   * Paint a single newly settled pixel tile onto Layer 1 cache.
   * @param {number} cellIndex
   */
  stampSettledTile(cellIndex) {
    if (!this.settledCtx) return;
    const { W, colors } = this.engine.currentLevel();
    const { cellSize, gap } = this.board;
    const dpr = this.vp.dpr * this.scale;
    const x = (cellIndex % W) * (cellSize + gap);
    const y = Math.floor(cellIndex / W) * (cellSize + gap);
    this.settledCtx.save();
    this.settledCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawPixelTile(this.settledCtx, x, y, cellSize, colors[cellIndex]);
    this.settledCtx.restore();
  }

  /**
   * Draw one glossy beveled 1x1 colored pixel tile.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} cs
   * @param {string | null} code
   */
  drawPixelTile(ctx, x, y, cs, code) {
    if (!code) return;
    const col = ART_PALETTE[code] || '#f59d45';
    const pad = Math.max(0.5, cs * 0.02);
    const w = cs - pad * 2;
    const h = cs - pad * 2;
    const r = Math.max(3, w * 0.18);

    ctx.save();
    ctx.fillStyle = col;
    roundRectPath(ctx, x + pad, y + pad, w, h, r);
    ctx.fill();

    // Bottom inner bevel
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    roundRectPath(ctx, x + pad, y + pad + h - Math.max(2, h * 0.11), w, Math.max(2, h * 0.11), r * 0.5);
    ctx.fill();

    // Top inner highlight
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    roundRectPath(ctx, x + pad + 2, y + pad + 1.5, w - 4, Math.max(2, h * 0.12), r * 0.4);
    ctx.fill();

    if (code === 'W') {
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, x + pad + 0.5, y + pad + 0.5, w - 1, h - 1, r);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Trigger visual falling animation for a single domino in a cascade.
   * @param {number} cellIndex
   * @param {Dir} dir
   * @param {number} comboN
   * @param {number} nowMs
   */
  triggerFall(cellIndex, dir, comboN, nowMs) {
    const level = this.engine.currentLevel();
    this.visualDown[cellIndex] = 1;
    const col = level.colors[cellIndex] || 'O';
    const tp = level.types[cellIndex];
    this.fallAnims.push({ cellIndex, dir, startMs: nowMs, color: col, tp });

    const { W } = level;
    const { gridX, gridY, cellSize, gap } = this.board;
    const [dy, dx] = DV[dir];
    const cx = gridX + (cellIndex % W) * (cellSize + gap) + cellSize / 2 + dx * cellSize * 0.45;
    const cy = gridY + Math.floor(cellIndex / W) * (cellSize + gap) + cellSize / 2 + dy * cellSize * 0.45;
    this.particles.spawnDust(cx, cy, dx, dy);

    this.comboCount = comboN;
    this.comboLabel = `×${comboN}`;
    this.comboBumpMs = nowMs;
    this.comboHideAtMs = nowMs + 99999;
  }

  /**
   * Trigger end-of-cascade celebration banner & table shake for big chains (docs/01 §6.1).
   * @param {number} chainSize
   * @param {number} nowMs
   */
  onCascadeFinishedVisual(chainSize, nowMs) {
    if (chainSize >= 12) {
      const praise = chainSize >= 40 ? '超级连锁！' : (chainSize >= 25 ? '太爽了！' : '漂亮！');
      this.comboLabel = `×${chainSize} ${praise}`;
      this.comboBumpMs = nowMs;
      this.comboHideAtMs = nowMs + 1350;
      this.shakeEndMs = nowMs + 220;
    } else {
      this.comboHideAtMs = nowMs + 550;
    }
  }

  /**
   * Trigger victory diagonal wave ripple & 40-piece confetti burst.
   * @param {number} nowMs
   */
  triggerWinCelebration(nowMs) {
    this.winWaveStartMs = nowMs + 150;
    this.particles.spawnConfetti(
      this.board.frameX,
      this.board.frameY + this.board.frameH,
      this.board.frameW,
      this.board.frameH,
      Object.values(ART_PALETTE)
    );
  }

  /**
   * Trigger undo spring-back animation for restored dominoes.
   * @param {number[]} restoredCells
   * @param {number} nowMs
   */
  triggerUndoVisual(restoredCells, nowMs) {
    for (const i of restoredCells) {
      this.visualDown[i] = 0;
      this.undoAnims.push({ cellIndex: i, startMs: nowMs, delayMs: Math.random() * 110 });
    }
    this.fallAnims = [];
    this.winWaveStartMs = 0;
    this.rebuildSettledCache();
  }

  /**
   * Trigger gentle wiggle on tapped normal/split domino (E01).
   * @param {number} cellIndex
   * @param {number} nowMs
   */
  triggerWiggle(cellIndex, nowMs) {
    this.wiggleAnim = { cellIndex, startMs: nowMs };
  }

  /**
   * Show floating toast message on top/bottom of board.
   * @param {string} msg
   * @param {number} nowMs
   */
  showToast(msg, nowMs) {
    this.toastMsg = msg;
    this.toastHideAtMs = nowMs + 1600;
  }

  /**
   * Ensure Layer 0 static wood-frame + felt table offscreen cache is ready.
   * @param {SkinDef} skin
   */
  ensureTableCache(skin) {
    const { frameW, frameH } = this.board;
    const dpr = this.vp.dpr * this.scale;
    const key = `${skin.id}_${frameW}_${frameH}_${dpr.toFixed(2)}`;
    if (this.tableCache && this.tableCacheKey === key) return;
    this.tableCacheKey = key;

    const extraH = 8;
    this.tableCache = this.platform.createOffscreenCanvas(
      Math.max(1, Math.ceil(frameW * dpr)),
      Math.max(1, Math.ceil((frameH + extraH) * dpr))
    );
    const tctx = this.tableCache.getContext('2d');
    if (!tctx) return;

    tctx.save();
    tctx.scale(dpr, dpr);

    // Outer wooden 3D bottom lip
    tctx.fillStyle = skin.frameShadow;
    roundRectPath(tctx, 0, 5, frameW, frameH, 20);
    tctx.fill();

    // Outer wooden rim
    tctx.fillStyle = skin.frameOuter;
    roundRectPath(tctx, 0, 0, frameW, frameH, 20);
    tctx.fill();

    // Inner felt surface
    const b = 6;
    tctx.fillStyle = skin.feltBg;
    roundRectPath(tctx, b, b, frameW - b * 2, frameH - b * 2, 15);
    tctx.fill();

    // Subtle polka dot felt texture
    tctx.save();
    roundRectPath(tctx, b, b, frameW - b * 2, frameH - b * 2, 15);
    tctx.clip();
    tctx.fillStyle = skin.feltDot;
    for (let py = b + 4; py < frameH - b; py += 7) {
      for (let px = b + 4; px < frameW - b; px += 7) {
        tctx.fillRect(px, py, 1.5, 1.5);
      }
    }
    // Inner top shadow along wood edge
    tctx.strokeStyle = 'rgba(20,55,35,0.22)';
    tctx.lineWidth = 4;
    roundRectPath(tctx, b, b, frameW - b * 2, frameH - b * 2, 15);
    tctx.stroke();
    tctx.restore();

    tctx.restore();
  }

  /**
   * Master per-frame render entry (5 layers + active overlay).
   * @param {number} nowMs
   * @param {number} dtSec
   */
  render(nowMs, dtSec) {
    this.particles.update(dtSec);
    this.hitBoxes = [];

    const ctx = this.ctx;
    const skin = this.getSkin();
    const snap = this.engine.getSnapshot();
    const dpr = this.vp.dpr;

    // Reset physical background (handles desktop wide margins cleanly)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = skin.bgBottom;
    ctx.fillRect(0, 0, this.vp.width, this.vp.height);

    // Apply logical transform
    ctx.save();
    ctx.translate(this.offsetX, 0);
    ctx.scale(this.scale, this.scale);

    // Full warm background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, this.logicalH);
    bg.addColorStop(0, skin.bgTop);
    bg.addColorStop(1, skin.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.logicalW, this.logicalH);

    // Pre-bake standing dominoes & table caches
    this.dominoCache.ensure(this.board.cellSize, dpr * this.scale, skin);
    this.ensureTableCache(skin);

    // Shake transform for big chains
    let shakeX = 0;
    let shakeY = 0;
    if (nowMs < this.shakeEndMs) {
      const p = (this.shakeEndMs - nowMs) / 220;
      shakeX = Math.sin(nowMs * 0.08) * 3 * p;
      shakeY = Math.cos(nowMs * 0.11) * 2 * p;
    }

    // ===== LAYER 0: STATIC WOOD & FELT TABLE =====
    ctx.save();
    ctx.translate(shakeX, shakeY);
    if (this.tableCache) {
      ctx.drawImage(
        /** @type {CanvasImageSource} */ (/** @type {unknown} */ (this.tableCache)),
        this.board.frameX,
        this.board.frameY,
        this.board.frameW,
        this.board.frameH + 8
      );
    }

    // ===== LAYER 1: SETTLED PIXEL-ART TILES =====
    if (this.winWaveStartMs > 0 && nowMs >= this.winWaveStartMs) {
      this.drawWinRippleTiles(ctx, snap, nowMs);
    } else if (this.settledCache) {
      const { W, H } = snap.level;
      const { gridX, gridY, cellSize, gap } = this.board;
      ctx.drawImage(
        /** @type {CanvasImageSource} */ (/** @type {unknown} */ (this.settledCache)),
        gridX,
        gridY,
        W * cellSize + (W - 1) * gap,
        H * cellSize + (H - 1) * gap
      );
    }

    // ===== LAYER 2: STANDING PRE-BAKED DOMINOES =====
    this.drawStandingDominoes(ctx, snap, nowMs);

    // ===== LAYER 3: ACTIVE FALLING ANIMS + SWIPE PREVIEW + PARTICLES =====
    this.drawFallingAnims(ctx, nowMs);
    this.drawSwipePreview(ctx, snap);
    this.drawGuideHand(ctx, snap, nowMs);
    this.particles.draw(ctx);

    ctx.restore(); // end board shake

    // ===== LAYER 4: HUD, INLINE PANELS, COMBO & OVERLAYS =====
    this.drawTopHud(ctx, snap, skin);
    this.drawComboAndToast(ctx, nowMs);

    if (snap.ended === 'playing') {
      this.drawBottomToolbar(ctx, snap, skin);
    } else if (snap.ended === 'won') {
      this.drawWinPanel(ctx, snap, skin);
    } else {
      this.drawFailPanel(ctx, snap, skin);
    }

    this.drawComplianceFooter(ctx);

    // Active full-canvas overlay modals
    if (this.overlay === 'gallery') this.drawGalleryOverlay(ctx, skin);
    else if (this.overlay === 'skins') this.drawSkinsOverlay(ctx, skin);
    else if (this.overlay === 'collage') this.drawCollageOverlay(ctx, skin);
    else if (this.overlay === 'info') this.drawInfoOverlay(ctx, skin);

    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {number} nowMs
   */
  drawStandingDominoes(ctx, snap, nowMs) {
    const { W, H, present, types } = snap.level;
    const { gridX, gridY, cellSize, gap } = this.board;
    const step = cellSize + gap;

    // Build lookup of active undo spring animations
    /** @type {Map<number, number>} */
    const undoScale = new Map();
    this.undoAnims = this.undoAnims.filter(u => {
      const elapsed = nowMs - u.startMs - u.delayMs;
      if (elapsed < 0) {
        undoScale.set(u.cellIndex, 0.01);
        return true;
      }
      if (elapsed >= 260) return false;
      const t = elapsed / 260;
      const sc = t < 0.65 ? (0.4 + (t / 0.65) * 0.72) : (1.12 - ((t - 0.65) / 0.35) * 0.12);
      undoScale.set(u.cellIndex, sc);
      return true;
    });

    for (let i = 0; i < W * H; i++) {
      if (!present[i] || this.visualDown[i]) continue;
      const x = gridX + (i % W) * step;
      const y = gridY + Math.floor(i / W) * step;

      let sx = 1;
      let sy = 1;
      let ox = 0;
      let oy = 0;

      if (undoScale.has(i)) {
        const sc = undoScale.get(i) || 1;
        sx = sc;
        sy = sc;
      }
      if (this.dragVisual && this.dragVisual.cellIndex === i) {
        sx *= 0.94;
        sy *= 0.94;
        oy += 2;
      }
      if (this.wiggleAnim && this.wiggleAnim.cellIndex === i) {
        const el = nowMs - this.wiggleAnim.startMs;
        if (el < 300) {
          ox += Math.sin((el / 300) * Math.PI * 4) * 3;
        } else {
          this.wiggleAnim = null;
        }
      }

      // Hint highlight glow ring
      if (snap.activeHint && snap.activeHint.y * W + snap.activeHint.x === i) {
        const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.008);
        ctx.save();
        ctx.strokeStyle = `rgba(255,210,63,${0.55 + pulse * 0.45})`;
        ctx.lineWidth = 3;
        roundRectPath(ctx, x, y, cellSize, cellSize, 8);
        ctx.stroke();
        ctx.restore();
      }

      this.dominoCache.draw(ctx, types[i], x, y, sx, sy, ox, oy, 1);
    }
  }

  /**
   * Draw active 230ms squash/stretch falling animations and stamp finished tiles to Layer 1.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} nowMs
   */
  drawFallingAnims(ctx, nowMs) {
    if (!this.fallAnims.length) return;
    const { W } = this.engine.currentLevel();
    const { gridX, gridY, cellSize, gap } = this.board;
    const step = cellSize + gap;

    this.fallAnims = this.fallAnims.filter(a => {
      const el = nowMs - a.startMs;
      const x = gridX + (a.cellIndex % W) * step;
      const y = gridY + Math.floor(a.cellIndex / W) * step;
      const [dy, dx] = DV[a.dir];

      // 1) Color tile popping in (0..230ms)
      const pt = Math.min(1, el / FALL_TILE_MS);
      const easeOut = 1 - Math.pow(1 - pt, 2);
      const tileScaleX = dx ? (1.3 - 0.3 * easeOut) : (0.78 + 0.22 * easeOut);
      const tileScaleY = dy ? (1.3 - 0.3 * easeOut) : (0.78 + 0.22 * easeOut);
      const overshoot = pt > 0.45 && pt < 0.85 ? 1 + Math.sin(((pt - 0.45) / 0.4) * Math.PI) * 0.08 : 1;
      const tOx = dx * cellSize * 0.35 * (1 - easeOut);
      const tOy = dy * cellSize * 0.35 * (1 - easeOut);

      ctx.save();
      ctx.globalAlpha = 0.3 + 0.7 * easeOut;
      ctx.translate(x + cellSize / 2 + tOx, y + cellSize / 2 + tOy);
      ctx.scale(tileScaleX * overshoot, tileScaleY * overshoot);
      this.drawPixelTile(ctx, -cellSize / 2, -cellSize / 2, cellSize, a.color);
      ctx.restore();

      // 2) Standing domino ghost squashing & sliding out (0..150ms)
      if (el < FALL_DOMINO_MS) {
        const pd = el / FALL_DOMINO_MS;
        const easeIn = pd * pd;
        const dSx = dx ? (1 - 0.65 * easeIn) : (1 + 0.14 * easeIn);
        const dSy = dy ? (1 - 0.65 * easeIn) : (1 + 0.14 * easeIn);
        this.dominoCache.draw(
          ctx,
          a.tp,
          x,
          y,
          dSx,
          dSy,
          dx * cellSize * 0.45 * easeIn,
          dy * cellSize * 0.45 * easeIn,
          1 - easeIn
        );
      }

      if (el >= FALL_TILE_MS) {
        this.stampSettledTile(a.cellIndex);
        return false;
      }
      return true;
    });
  }

  /**
   * Diagonal wave celebration ripple across all revealed pixel tiles on win.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {number} nowMs
   */
  drawWinRippleTiles(ctx, snap, nowMs) {
    const { W, H, present, colors } = snap.level;
    const { gridX, gridY, cellSize, gap } = this.board;
    const step = cellSize + gap;
    let stillAnimating = false;

    for (let i = 0; i < W * H; i++) {
      if (!present[i]) continue;
      const gx = i % W;
      const gy = Math.floor(i / W);
      const delay = (gx + gy) * 42;
      const el = nowMs - this.winWaveStartMs - delay;
      const x = gridX + gx * step;
      const y = gridY + gy * step;

      if (el > 0 && el < 380) {
        stillAnimating = true;
        const wave = Math.sin((el / 380) * Math.PI);
        const sc = 1 + wave * 0.16;
        ctx.save();
        ctx.translate(x + cellSize / 2, y + cellSize / 2 - wave * cellSize * 0.08);
        ctx.scale(sc, sc);
        this.drawPixelTile(ctx, -cellSize / 2, -cellSize / 2, cellSize, colors[i]);
        ctx.restore();
      } else {
        if (el <= 0) stillAnimating = true;
        this.drawPixelTile(ctx, x, y, cellSize, colors[i]);
      }
    }
    if (!stillAnimating) {
      this.winWaveStartMs = 0;
      this.rebuildSettledCache();
    }
  }

  /**
   * Draw direction arrow preview above the dragged domino.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   */
  drawSwipePreview(ctx, snap) {
    if (!this.dragVisual || !this.dragVisual.dir) return;
    const { W } = snap.level;
    const { gridX, gridY, cellSize, gap } = this.board;
    const i = this.dragVisual.cellIndex;
    const cx = gridX + (i % W) * (cellSize + gap) + cellSize / 2;
    const cy = gridY + Math.floor(i / W) * (cellSize + gap) + cellSize / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(DIR_RAD[this.dragVisual.dir]);
    const arm = cellSize * 0.36;
    const head = cellSize * 0.24;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(5, cellSize * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-arm * 0.4, 2); ctx.lineTo(arm, 2);
    ctx.moveTo(arm - head, -head + 2); ctx.lineTo(arm, 2); ctx.lineTo(arm - head, head + 2);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(3, cellSize * 0.1);
    ctx.beginPath();
    ctx.moveTo(-arm * 0.4, 0); ctx.lineTo(arm, 0);
    ctx.moveTo(arm - head, -head); ctx.lineTo(arm, 0); ctx.lineTo(arm - head, head);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Animated finger swipe cue for Level 1 FTUE or active hint.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {number} nowMs
   */
  drawGuideHand(ctx, snap, nowMs) {
    const target = snap.activeHint || (snap.showFtueHand && snap.used === 0 ? {
      y: snap.level.def.sol[0][0],
      x: snap.level.def.sol[0][1],
      dir: snap.level.def.sol[0][2]
    } : null);
    if (!target || snap.ended !== 'playing' || snap.busy) return;

    const { gridX, gridY, cellSize, gap } = this.board;
    const cx = gridX + target.x * (cellSize + gap) + cellSize / 2;
    const cy = gridY + target.y * (cellSize + gap) + cellSize / 2;
    const [dy, dx] = DV[target.dir];
    const dist = cellSize * 1.15;

    const cycle = (nowMs % 1300) / 1300;
    const alpha = cycle < 0.18 ? cycle / 0.18 : (cycle > 0.78 ? (1 - cycle) / 0.22 : 1);
    const moveT = cycle < 0.22 ? 0 : Math.min(1, (cycle - 0.22) / 0.48);

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    // Faint swipe trail arrow
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx * dist * moveT, cy + dy * dist * moveT);
    ctx.stroke();

    // Pointer disc
    const hx = cx + dx * dist * moveT;
    const hy = cy + dy * dist * moveT;
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#4a3f35';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a3f35';
    ctx.font = `bold 11px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('滑', hx, hy + 0.5);
    ctx.restore();
  }

  /**
   * Zone 1 + Zone 2: Top status bar (capsule-safe) and Level/Push info row.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {SkinDef} skin
   */
  drawTopHud(ctx, snap, skin) {
    const safeTop = Math.max(8, Math.round(this.vp.safeTop / this.scale));
    const y0 = safeTop + 4;

    // Right clearance for WeChat native capsule (~96 logical px)
    const rightBound = this.vp.capsuleRect
      ? Math.min(this.logicalW - 12, Math.floor((this.vp.capsuleRect.left - this.offsetX) / this.scale) - 8)
      : this.logicalW - 12;

    // Mini domino logo + Game Title
    ctx.save();
    ctx.fillStyle = skin.normalEdge;
    roundRectPath(ctx, 12, y0 + 5, 13, 21, 3.5);
    ctx.fill();
    ctx.fillStyle = skin.normalTop;
    roundRectPath(ctx, 12, y0 + 3, 13, 20, 3.5);
    ctx.fill();
    ctx.fillStyle = skin.pipColor;
    ctx.beginPath();
    ctx.arc(18.5, y0 + 9, 1.8, 0, Math.PI * 2);
    ctx.arc(18.5, y0 + 16.5, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4a3f35';
    ctx.font = `900 16px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(GAME_TITLE, 31, y0 + 14);

    // Compact action pills aligned left of WeChat capsule: [画廊] [皮肤] [🔊]
    const btnH = 28;
    const muteW = 32;
    const pillW = 46;
    const gap = 6;
    const muteX = rightBound - muteW;
    const skinX = muteX - gap - pillW;
    const galX = skinX - gap - pillW;

    this.drawChipBtn(ctx, galX, y0, pillW, btnH, '画廊', 'open_gallery', false);
    this.drawChipBtn(ctx, skinX, y0, pillW, btnH, '皮肤', 'open_skins', false);
    this.drawChipBtn(ctx, muteX, y0, muteW, btnH, this.engine.save.data.settings.muted ? '静' : '音', 'toggle_mute', false);

    // Info row: "第 N 关 · ??" (reveals name on win) + Push domino slots
    const infoY = y0 + 42;
    const def = snap.level.def;
    const cleared = Boolean(this.engine.save.data.clearedLevels[def.levelId]);
    const nameShown = (snap.ended === 'won' || cleared) ? def.name : '??';
    const goldMark = this.engine.save.data.clearedLevels[def.levelId]?.perfect ? ' ★' : '';

    ctx.fillStyle = '#6f5c49';
    ctx.font = `bold 13px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第 ${def.levelId}/${this.engine.levels.length} 关 · ${nameShown}${goldMark}`, 12, infoY);

    // Push counter tokens on the right
    const tokW = 11;
    const tokH = 16;
    const tokGap = 4;
    const totalTokW = snap.limit * tokW + Math.max(0, snap.limit - 1) * tokGap;
    const startX = this.logicalW - 12 - totalTokW;
    ctx.textAlign = 'right';
    ctx.fillText('推力', startX - 6, infoY);

    for (let k = 0; k < snap.limit; k++) {
      const tx = startX + k * (tokW + tokGap);
      const ty = infoY - tokH / 2;
      const isUsed = k < snap.used;
      if (isUsed) {
        ctx.fillStyle = '#d4c6ae';
        roundRectPath(ctx, tx, ty + 1, tokW, tokH, 3);
        ctx.fill();
      } else {
        ctx.fillStyle = skin.normalEdge;
        roundRectPath(ctx, tx, ty + 2, tokW, tokH, 3);
        ctx.fill();
        ctx.fillStyle = skin.normalTop;
        roundRectPath(ctx, tx, ty, tokW, tokH, 3);
        ctx.fill();
        ctx.fillStyle = skin.pipColor;
        ctx.beginPath();
        ctx.arc(tx + tokW / 2, ty + 5, 1.3, 0, Math.PI * 2);
        ctx.arc(tx + tokW / 2, ty + 11, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} label
   * @param {string} id
   * @param {boolean} active
   */
  drawChipBtn(ctx, x, y, w, h, label, id, active) {
    ctx.save();
    ctx.fillStyle = active ? '#4a3f35' : '#efe2cc';
    roundRectPath(ctx, x, y, w, h, 999);
    ctx.fill();
    ctx.fillStyle = active ? '#fff9f0' : '#6e5a46';
    ctx.font = `bold 12px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
    this.hitBoxes.push({ id, x, y, w, h });
  }

  /**
   * Floating combo counter & toast inside board top/bottom.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} nowMs
   */
  drawComboAndToast(ctx, nowMs) {
    // Combo burst at top center of board
    if (this.comboLabel && nowMs < this.comboHideAtMs) {
      const rem = this.comboHideAtMs - nowMs;
      const alpha = rem < 300 ? rem / 300 : 1;
      const bump = Math.max(0, 1 - (nowMs - this.comboBumpMs) / 140);
      const sc = 1 + bump * 0.28;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.logicalW / 2, this.board.frameY + 18);
      ctx.scale(sc, sc);
      ctx.font = `900 24px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#d97312';
      ctx.lineJoin = 'round';
      ctx.strokeText(this.comboLabel, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.comboLabel, 0, 0);
      ctx.restore();
    }

    // Toast pill near bottom of board
    if (this.toastMsg && nowMs < this.toastHideAtMs) {
      const rem = this.toastHideAtMs - nowMs;
      const alpha = rem < 250 ? rem / 250 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold 12px ${FONT_STACK}`;
      const tw = ctx.measureText(this.toastMsg).width + 26;
      const tx = (this.logicalW - tw) / 2;
      const ty = this.board.frameY + this.board.frameH - 36;
      ctx.fillStyle = 'rgba(74,63,53,0.92)';
      roundRectPath(ctx, tx, ty, tw, 26, 999);
      ctx.fill();
      ctx.fillStyle = '#fff9f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.toastMsg, this.logicalW / 2, ty + 13.5);
      ctx.restore();
    }
  }

  /**
   * Zone 4: Bottom action toolbar (Undo / Hint / Reset) + compact helper hint line.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {SkinDef} _skin
   */
  drawBottomToolbar(ctx, snap, _skin) {
    const y = this.board.frameY + this.board.frameH + 18;
    const padX = 12;
    const gap = 8;
    const bw = (this.logicalW - padX * 2 - gap * 2) / 3;
    const bh = 42;

    const undoDisabled = !snap.canUndo || snap.busy;
    const hintCanRefill = snap.hintsLeft <= 0 && this.engine.canOfferExtraHints();
    const hintLabel = snap.hintsLeft > 0
      ? `提示 ${snap.hintsLeft}`
      : (hintCanRefill ? (FeatureFlags.adEnabled ? '视频+2' : '补提示') : '提示 0');
    const hintDisabled = snap.busy || (snap.hintsLeft <= 0 && !hintCanRefill);

    this.drawActionBtn(ctx, padX, y, bw, bh, '↶ 撤销', 'undo', false, undoDisabled);
    this.drawActionBtn(ctx, padX + bw + gap, y, bw, bh, `💡 ${hintLabel}`, 'hint', false, hintDisabled);
    this.drawActionBtn(ctx, padX + (bw + gap) * 2, y, bw, bh, '↺ 重摆', 'reset', false, snap.busy);

    // One-line subtle gameplay reminder under toolbar (especially helpful on Lv.1-2)
    ctx.save();
    ctx.fillStyle = '#8a7660';
    ctx.font = `12px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tipText = snap.level.def.levelId === 1
      ? '按住一块骨牌朝方向滑动推倒 · 蓝箭头转向 · 橙十字三路分岔'
      : '已倒骨牌会挡住后续连锁 · 撤销永久免费';
    ctx.fillText(tipText, this.logicalW / 2, y + bh + 12);
    ctx.restore();
  }

  /**
   * Inline non-occluding Victory panel directly below the board.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {SkinDef} _skin
   */
  drawWinPanel(ctx, snap, _skin) {
    const x = 12;
    const y = this.board.frameY + this.board.frameH + 14;
    const w = this.logicalW - 24;
    const h = 118;
    const def = snap.level.def;
    const isLast = def.levelId >= this.engine.levels.length;
    const allCleared = this.engine.save.countCleared() >= this.engine.levels.length;
    const perfectTag = !snap.usedHelpInRun ? ' · ★ 完美金框' : '';

    ctx.save();
    ctx.fillStyle = '#fffaf2';
    ctx.shadowColor = 'rgba(80,60,30,0.16)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#8a7660';
    ctx.font = `bold 12px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText(allCleared && isLast ? '首版 20 关全部推倒！' : '全部推倒！', this.logicalW / 2, y + 18);

    ctx.fillStyle = '#3d3530';
    ctx.font = `900 20px ${FONT_STACK}`;
    ctx.fillText(`${def.emoji} ${def.name}`, this.logicalW / 2, y + 43);

    ctx.fillStyle = '#8a7660';
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText(`${snap.used} 推推倒 ${snap.level.total} 块 · 最长连锁 ×${snap.bestChainInLevel}${perfectTag}`, this.logicalW / 2, y + 63);
    ctx.restore();

    const by = y + 74;
    const bh = 36;
    const gap = 8;
    const bw = (w - 24 - gap) / 2;
    this.drawActionBtn(ctx, x + 12, by, bw, bh, '再推一次', 'replay', false, false);
    if (isLast) {
      this.drawActionBtn(ctx, x + 12 + bw + gap, by, bw, bh, allCleared ? '查看20画海报' : '打开画廊', allCleared ? 'open_collage' : 'open_gallery', true, false);
    } else {
      this.drawActionBtn(ctx, x + 12 + bw + gap, by, bw, bh, '下一关 →', 'next_level', true, false);
    }
  }

  /**
   * Inline non-occluding Fail / Rescue panel directly below the board.
   * @param {CanvasRenderingContext2D} ctx
   * @param {EngineSnapshot} snap
   * @param {SkinDef} _skin
   */
  drawFailPanel(ctx, snap, _skin) {
    const x = 12;
    const y = this.board.frameY + this.board.frameH + 14;
    const w = this.logicalW - 24;
    const canExtra = this.engine.canOfferExtraPush();
    const h = 114;

    ctx.save();
    ctx.fillStyle = '#fffaf2';
    ctx.shadowColor = 'rgba(80,60,30,0.16)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#3d3530';
    ctx.font = `900 17px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.fillText('推力用完啦', this.logicalW / 2, y + 24);

    ctx.fillStyle = '#8a7660';
    ctx.font = `12px ${FONT_STACK}`;
    ctx.fillText(`还有 ${snap.remainingStanding} 块骨牌站着，换个顺序试试？`, this.logicalW / 2, y + 46);
    ctx.restore();

    const by = y + 64;
    const bh = 38;
    const gap = 8;
    if (canExtra) {
      const bw = (w - 24 - gap * 2) / 3;
      this.drawActionBtn(ctx, x + 12, by, bw, bh, '↶ 撤销', 'undo', false, false);
      const extraLabel = FeatureFlags.adEnabled ? '▶ +1推力' : '+1 推力';
      this.drawActionBtn(ctx, x + 12 + bw + gap, by, bw, bh, extraLabel, 'extra_push', true, false);
      this.drawActionBtn(ctx, x + 12 + (bw + gap) * 2, by, bw, bh, '↺ 重摆', 'reset', false, false);
    } else {
      const bw = (w - 24 - gap) / 2;
      this.drawActionBtn(ctx, x + 12, by, bw, bh, '↶ 撤销一步', 'undo', false, false);
      this.drawActionBtn(ctx, x + 12 + bw + gap, by, bw, bh, '↺ 重新摆好', 'reset', true, false);
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} label
   * @param {string} id
   * @param {boolean} primary
   * @param {boolean} disabled
   */
  drawActionBtn(ctx, x, y, w, h, label, id, primary, disabled) {
    ctx.save();
    ctx.globalAlpha = disabled ? 0.42 : 1;
    ctx.fillStyle = primary ? '#4a3f35' : '#efe2cc';
    roundRectPath(ctx, x, y, w, h, 13);
    ctx.fill();
    ctx.fillStyle = primary ? '#fff9f0' : '#6f5c49';
    ctx.font = `bold 13px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
    this.hitBoxes.push({ id, x, y, w, h, disabled });
  }

  /**
   * Subtle compliance footer (CADPA 8+ badge & info tap, docs/05 §6.2 C01).
   * @param {CanvasRenderingContext2D} ctx
   */
  drawComplianceFooter(ctx) {
    const safeBot = Math.max(6, Math.round(this.vp.safeBottom / this.scale));
    const fy = this.logicalH - safeBot - 16;
    ctx.save();
    ctx.fillStyle = '#5bbf6e';
    roundRectPath(ctx, 12, fy, 26, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `900 10px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('8+', 25, fy + 8);

    ctx.fillStyle = '#9a8772';
    ctx.font = `10px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(`v${GAME_VERSION} · 健康游戏忠告`, 44, fy + 8);
    ctx.restore();
    this.hitBoxes.push({ id: 'open_info', x: 10, y: fy - 4, w: 150, h: 24 });
  }

  /**
   * Full in-canvas 20-Level Gallery Overlay (live mini pixel-art cards + perfect gold frames).
   * @param {CanvasRenderingContext2D} ctx
   * @param {SkinDef} skin
   */
  drawGalleryOverlay(ctx, skin) {
    this.hitBoxes = []; // modal blocks underlying board hits
    this.drawModalBackdrop(ctx, '画廊图鉴', `${this.engine.save.countCleared()}/20 幅已点亮 · ★ ${this.engine.save.countGoldFrames()} 金框`, skin);

    const mx = 14;
    const my = 76;
    const mw = this.logicalW - 28;
    const cols = 4;
    const rows = 5;
    const gap = 8;
    const cw = (mw - 24 - (cols - 1) * gap) / cols;
    const ch = Math.min(82, (this.logicalH - 200) / rows);

    for (let idx = 0; idx < this.engine.levels.length; idx++) {
      const lv = this.engine.levels[idx];
      const def = lv.def;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = mx + 12 + col * (cw + gap);
      const y = my + 56 + row * (ch + gap);

      const rec = this.engine.save.data.clearedLevels[def.levelId];
      const unlocked = this.engine.isLevelUnlocked(def.levelId);
      const isCur = def.levelId === this.engine.currentLevel().def.levelId;

      ctx.save();
      ctx.fillStyle = rec ? '#fffdf8' : (unlocked ? '#f4ead8' : '#e6dccb');
      roundRectPath(ctx, x, y, cw, ch, 12);
      ctx.fill();

      if (rec && rec.perfect) {
        ctx.strokeStyle = '#f2b705';
        ctx.lineWidth = 2.5;
        roundRectPath(ctx, x + 1, y + 1, cw - 2, ch - 2, 11);
        ctx.stroke();
      } else if (isCur) {
        ctx.strokeStyle = '#ff9d2e';
        ctx.lineWidth = 2;
        roundRectPath(ctx, x + 1, y + 1, cw - 2, ch - 2, 11);
        ctx.stroke();
      }

      if (rec) {
        ctx.fillStyle = skin.feltBg;
        roundRectPath(ctx, x + 5, y + 5, cw - 10, ch - 23, 7);
        ctx.fill();
        this.drawMiniArt(ctx, lv, x + 8, y + 8, cw - 16, ch - 29);
      } else {
        ctx.fillStyle = unlocked ? '#8a7660' : '#b2a38d';
        ctx.font = `900 18px ${FONT_STACK}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(unlocked ? `${def.levelId}` : '🔒', x + cw / 2, y + ch / 2 - 6);
      }

      ctx.fillStyle = rec ? '#4a3f35' : '#8a7660';
      ctx.font = `bold 11px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(rec ? def.name : `第${def.levelId}关`, x + cw / 2, y + ch - 4);
      ctx.restore();

      if (unlocked) {
        this.hitBoxes.push({ id: 'select_level', x, y, w: cw, h: ch, payload: def.levelId });
      }
    }

    // Bottom button: 20-art collage poster (unlocked when all 20 cleared)
    const allCleared = this.engine.save.countCleared() >= this.engine.levels.length;
    const by = my + 56 + rows * (ch + gap) + 6;
    this.drawActionBtn(
      ctx,
      mx + 12,
      by,
      mw - 24,
      38,
      allCleared ? '★ 查看 20 画全家福拼贴海报' : `通关全部 20 关解锁全家福海报（${this.engine.save.countCleared()}/20）`,
      'open_collage',
      allCleared,
      !allCleared
    );
  }

  /**
   * 20-Art Graduation Collage Poster Overlay.
   * @param {CanvasRenderingContext2D} ctx
   * @param {SkinDef} skin
   */
  drawCollageOverlay(ctx, skin) {
    this.hitBoxes = [];
    this.drawModalBackdrop(ctx, '首版 20 画全家福', `最高连锁 ×${this.engine.save.data.globalBestChain} · ★ ${this.engine.save.countGoldFrames()}/20 金框`, skin);

    const mx = 14;
    const my = 76;
    const mw = this.logicalW - 28;
    const padX = 16;
    const cols = 4;
    const rows = 5;
    const gap = 6;
    const cw = (mw - padX * 2 - (cols - 1) * gap) / cols;
    const ch = Math.min(76, (this.logicalH - 220) / rows);

    // Golden collage frame
    ctx.save();
    ctx.fillStyle = '#8fc7a5';
    ctx.strokeStyle = '#e5a922';
    ctx.lineWidth = 4;
    roundRectPath(ctx, mx + 10, my + 54, mw - 20, rows * ch + (rows - 1) * gap + 20, 14);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    for (let idx = 0; idx < this.engine.levels.length; idx++) {
      const lv = this.engine.levels[idx];
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = mx + padX + col * (cw + gap);
      const y = my + 64 + row * (ch + gap);
      this.drawMiniArt(ctx, lv, x + 2, y + 2, cw - 4, ch - 4);
    }

    const by = my + 82 + rows * ch + (rows - 1) * gap;
    this.drawActionBtn(ctx, mx + 12, by, mw - 24, 38, '分享全家福战绩', 'share_collage', true, false);
  }

  /**
   * Skins & Sound Packs Overlay (default + 5/12/18 gold-frame unlockables + 3-level trial).
   * @param {CanvasRenderingContext2D} ctx
   * @param {SkinDef} skin
   */
  drawSkinsOverlay(ctx, skin) {
    this.hitBoxes = [];
    const gold = this.engine.save.countGoldFrames();
    const activeId = this.engine.save.getActiveSkinId();
    this.drawModalBackdrop(ctx, '骨牌皮肤与音色', `当前完美金框 ★ ${gold}（0提示0额外推力通关可得）`, skin);

    const mx = 14;
    const my = 76;
    const mw = this.logicalW - 28;
    let cy = my + 62;

    for (const s of SKINS) {
      const unlocked = this.engine.save.data.unlockedSkins.includes(s.id);
      const isActive = activeId === s.id;
      const cardH = 74;

      ctx.save();
      ctx.fillStyle = isActive ? '#fff7e6' : '#f8f0e2';
      roundRectPath(ctx, mx + 12, cy, mw - 24, cardH, 14);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#f2a422';
        ctx.lineWidth = 2.5;
        roundRectPath(ctx, mx + 13, cy + 1, mw - 26, cardH - 2, 13);
        ctx.stroke();
      }

      // Preview swatch
      ctx.fillStyle = s.feltBg;
      roundRectPath(ctx, mx + 22, cy + 13, 48, 48, 10);
      ctx.fill();
      ctx.fillStyle = s.normalEdge;
      roundRectPath(ctx, mx + 32, cy + 25, 28, 28, 6);
      ctx.fill();
      ctx.fillStyle = s.normalTop;
      roundRectPath(ctx, mx + 32, cy + 22, 28, 28, 6);
      ctx.fill();
      ctx.fillStyle = s.pipColor;
      ctx.beginPath();
      ctx.arc(mx + 46, cy + 31, 2.2, 0, Math.PI * 2);
      ctx.arc(mx + 46, cy + 40, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Title + sound name
      ctx.fillStyle = '#3d3530';
      ctx.font = `900 15px ${FONT_STACK}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.name, mx + 80, cy + 26);

      ctx.fillStyle = '#8a7660';
      ctx.font = `12px ${FONT_STACK}`;
      const desc = unlocked
        ? `音色：${s.soundName}`
        : `★ ${gold}/${s.unlockGoldFrames} 金框解锁 · ${s.soundName}`;
      ctx.fillText(desc, mx + 80, cy + 48);
      ctx.restore();

      const bw = 72;
      const bx = mx + mw - 22 - bw;
      const by = cy + 20;
      if (unlocked) {
        this.drawActionBtn(ctx, bx, by, bw, 34, isActive ? '使用中' : '使用', 'equip_skin', !isActive, isActive);
        this.hitBoxes[this.hitBoxes.length - 1].payload = s.id;
      } else {
        this.drawActionBtn(ctx, bx, by, bw, 34, isActive ? '试用中' : '试用3关', 'trial_skin', !isActive, isActive);
        this.hitBoxes[this.hitBoxes.length - 1].payload = s.id;
      }

      cy += cardH + 10;
    }
  }

  /**
   * Compliance & Healthy Game Advice overlay (docs/05 §6.2 C01).
   * @param {CanvasRenderingContext2D} ctx
   * @param {SkinDef} skin
   */
  drawInfoOverlay(ctx, skin) {
    this.hitBoxes = [];
    this.drawModalBackdrop(ctx, '关于与适龄提示', `${GAME_TITLE} v${GAME_VERSION}`, skin);

    const mx = 28;
    const my = 150;
    const lines = [
      '【适龄提示：CADPA 8+】',
      '本游戏为单机休闲连锁解谜小游戏，',
      '不含暴力、恐怖内容，无任何内购付费。',
      '',
      '【健康游戏忠告】',
      '抵制不良游戏，拒绝盗版游戏。',
      '注意自我保护，谨防受骗上当。',
      '适度游戏益脑，沉迷游戏伤身。',
      '合理安排时间，享受健康生活。'
    ];
    ctx.save();
    ctx.fillStyle = '#5c4d3e';
    ctx.font = `13px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    lines.forEach((line, idx) => {
      ctx.fillText(line, this.logicalW / 2, my + idx * 24);
    });
    ctx.restore();
    void mx;
  }

  /**
   * Shared modal card shell + close button.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} title
   * @param {string} subtitle
   * @param {SkinDef} _skin
   */
  drawModalBackdrop(ctx, title, subtitle, _skin) {
    ctx.save();
    ctx.fillStyle = 'rgba(40,32,22,0.52)';
    ctx.fillRect(0, 0, this.logicalW, this.logicalH);

    const mx = 14;
    const my = 76;
    const mw = this.logicalW - 28;
    const mh = this.logicalH - 116;
    ctx.fillStyle = '#fffaf2';
    roundRectPath(ctx, mx, my, mw, mh, 22);
    ctx.fill();

    ctx.fillStyle = '#3d3530';
    ctx.font = `900 18px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, mx + 18, my + 24);

    ctx.fillStyle = '#8a7660';
    ctx.font = `11px ${FONT_STACK}`;
    ctx.fillText(subtitle, mx + 18, my + 44);
    ctx.restore();

    this.drawChipBtn(ctx, mx + mw - 42, my + 12, 30, 30, '✕', 'close_overlay', false);
  }

  /**
   * Render a crisp miniature pixel artwork centered inside `(x, y, w, h)`.
   * @param {CanvasRenderingContext2D} ctx
   * @param {CompiledLevel} lv
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  drawMiniArt(ctx, lv, x, y, w, h) {
    const cs = Math.floor(Math.min(w / lv.W, h / lv.H));
    if (cs < 2) return;
    const ox = x + (w - cs * lv.W) / 2;
    const oy = y + (h - cs * lv.H) / 2;
    for (let gy = 0; gy < lv.H; gy++) {
      for (let gx = 0; gx < lv.W; gx++) {
        const ch = lv.colors[gy * lv.W + gx];
        if (!ch) continue;
        ctx.fillStyle = ART_PALETTE[ch] || '#f59d45';
        ctx.fillRect(ox + gx * cs, oy + gy * cs, Math.max(1, cs - 0.5), Math.max(1, cs - 0.5));
      }
    }
  }
}
