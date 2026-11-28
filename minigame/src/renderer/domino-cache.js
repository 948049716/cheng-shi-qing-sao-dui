// @ts-check
import { DIR_RAD } from '../core/constants.js';

/** @typedef {import('../../../types/domain.d.ts').DominoCellType} DominoCellType */
/** @typedef {import('../../../types/domain.d.ts').SkinDef} SkinDef */
/** @typedef {import('../../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */
/** @typedef {import('../../../types/platform.d.ts').CanvasLike} CanvasLike */

/**
 * Draw a rounded rectangle path compatible with all Canvas 2D environments (including older WeChat runtimes).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Slot indices inside dominoCacheCanvas (docs/06 §3). */
const SLOT_MAP = {
  '.': 0,
  '^': 1,
  '>': 2,
  'v': 3,
  '<': 4,
  '+': 5
};

/**
 * Offscreen sprite pre-baker for standing dominoes (eliminates per-frame shadow & gradient cost).
 */
export class DominoCache {
  /**
   * @param {IPlatformAdapter} platform
   */
  constructor(platform) {
    this.platform = platform;
    /** @type {CanvasLike | null} */
    this.canvas = null;
    this.cellSize = 0;
    this.dpr = 1;
    this.stride = 0;
    this.skinId = '';
  }

  /**
   * Re-bake only when cellSize, dpr, or skinId changes.
   * @param {number} cellSize
   * @param {number} dpr
   * @param {SkinDef} skin
   */
  ensure(cellSize, dpr, skin) {
    if (this.canvas && this.cellSize === cellSize && this.dpr === dpr && this.skinId === skin.id) {
      return;
    }
    this.cellSize = cellSize;
    this.dpr = dpr;
    this.skinId = skin.id;
    this.stride = cellSize + 10;

    const slots = 6;
    const physW = Math.ceil(this.stride * slots * dpr);
    const physH = Math.ceil(this.stride * dpr);
    this.canvas = this.platform.createOffscreenCanvas(physW, physH);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, this.stride * slots, this.stride);

    /** @type {('.' | '^' | '>' | 'v' | '<' | '+')[]} */
    const keys = ['.', '^', '>', 'v', '<', '+'];
    for (let idx = 0; idx < keys.length; idx++) {
      this.bakeSingle(ctx, idx * this.stride, 0, cellSize, keys[idx], skin);
    }
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} ox
   * @param {number} oy
   * @param {number} cs
   * @param {'.' | '^' | '>' | 'v' | '<' | '+'} tp
   * @param {SkinDef} skin
   */
  bakeSingle(ctx, ox, oy, cs, tp, skin) {
    const pad = 5;
    const inset = Math.max(2, cs * 0.08);
    const x = ox + pad + inset;
    const y = oy + pad + inset - 1;
    const w = cs - inset * 2;
    const h = cs - inset * 2;
    const r = Math.max(4, w * 0.24);
    const depth = Math.max(3, Math.round(cs * 0.095));

    const isSplit = tp === '+';
    const isTurn = tp !== '.' && tp !== '+';
    const topCol = isSplit ? skin.splitTop : (isTurn ? skin.turnTop : skin.normalTop);
    const botCol = isSplit ? skin.splitBot : (isTurn ? skin.turnBot : skin.normalBot);
    const edgeCol = isSplit ? skin.splitEdge : (isTurn ? skin.turnEdge : skin.normalEdge);

    // Soft cast shadow
    ctx.save();
    ctx.fillStyle = 'rgba(40,30,15,0.22)';
    roundRectPath(ctx, x, y + depth + 2, w, h, r);
    ctx.fill();

    // 3D bottom bevel thickness
    ctx.fillStyle = edgeCol;
    roundRectPath(ctx, x, y + depth, w, h, r);
    ctx.fill();

    // Main standing face gradient
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    ctx.fillStyle = grad;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();

    // Crisp top specular rim
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    roundRectPath(ctx, x + 0.6, y + 0.6, w - 1.2, h - 1.2, r);
    ctx.stroke();

    // Center symbol
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (tp === '.') {
      const pr = Math.max(2, cs * 0.072);
      const gap = Math.max(3.5, cs * 0.13);
      ctx.fillStyle = skin.pipColor;
      ctx.beginPath();
      ctx.arc(cx, cy - gap, pr, 0, Math.PI * 2);
      ctx.arc(cx, cy + gap, pr, 0, Math.PI * 2);
      ctx.fill();
    } else if (tp === '+') {
      // Crisp 4-way cross-arrow symbol with open separated arrowheads
      const arm = w * 0.30;
      const head = w * 0.088;
      ctx.strokeStyle = skin.splitIcon;
      ctx.lineWidth = Math.max(2, cs * 0.068);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy + arm);
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx + arm, cy);
      // 4 separated arrowheads
      ctx.moveTo(cx - head, cy - arm + head); ctx.lineTo(cx, cy - arm); ctx.lineTo(cx + head, cy - arm + head);
      ctx.moveTo(cx - head, cy + arm - head); ctx.lineTo(cx, cy + arm); ctx.lineTo(cx + head, cy + arm - head);
      ctx.moveTo(cx - arm + head, cy - head); ctx.lineTo(cx - arm, cy); ctx.lineTo(cx - arm + head, cy + head);
      ctx.moveTo(cx + arm - head, cy - head); ctx.lineTo(cx + arm, cy); ctx.lineTo(cx + arm - head, cy + head);
      ctx.stroke();
    } else {
      // Single bold directional arrow
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(DIR_RAD[tp]);
      const arm = w * 0.24;
      const head = w * 0.17;
      ctx.strokeStyle = skin.turnIcon;
      ctx.lineWidth = Math.max(2.2, cs * 0.085);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-arm, 0);
      ctx.lineTo(arm, 0);
      ctx.moveTo(arm - head, -head);
      ctx.lineTo(arm, 0);
      ctx.lineTo(arm - head, head);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Blit a pre-baked domino sprite centered over logical cell `(cellX, cellY)`.
   * @param {CanvasRenderingContext2D} ctx
   * @param {DominoCellType} tp
   * @param {number} cellX
   * @param {number} cellY
   * @param {number} [scaleX=1]
   * @param {number} [scaleY=1]
   * @param {number} [offsetX=0]
   * @param {number} [offsetY=0]
   * @param {number} [alpha=1]
   */
  draw(ctx, tp, cellX, cellY, scaleX = 1, scaleY = 1, offsetX = 0, offsetY = 0, alpha = 1) {
    if (!this.canvas || !tp) return;
    const slot = SLOT_MAP[tp];
    if (slot === undefined) return;
    const sx = slot * this.stride * this.dpr;
    const sw = this.stride * this.dpr;
    const sh = this.stride * this.dpr;
    const cx = cellX + this.cellSize / 2 + offsetX;
    const cy = cellY + this.cellSize / 2 + offsetY;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.drawImage(
      /** @type {CanvasImageSource} */ (/** @type {unknown} */ (this.canvas)),
      sx, 0, sw, sh,
      -this.stride / 2, -this.stride / 2, this.stride, this.stride
    );
    ctx.restore();
  }
}
