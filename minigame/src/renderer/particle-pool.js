// @ts-check

/**
 * Fixed-capacity 256-slot zero-GC particle pool (swap-remove) for dust puffs and victory confetti.
 */
export class ParticlePool {
  constructor(capacity = 256) {
    this.capacity = capacity;
    this.count = 0;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.sizeW = new Float32Array(capacity);
    this.sizeH = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.vrot = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    /** @type {string[]} */
    this.color = new Array(capacity).fill('#fff');
  }

  clear() {
    this.count = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {number} gravity
   * @param {number} w
   * @param {number} h
   * @param {number} lifeSec
   * @param {string} color
   * @param {number} vrot
   */
  spawn(x, y, vx, vy, gravity, w, h, lifeSec, color, vrot = 0) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.gravity[i] = gravity;
    this.sizeW[i] = w;
    this.sizeH[i] = h;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.vrot[i] = vrot;
    this.age[i] = 0;
    this.life[i] = lifeSec;
    this.color[i] = color;
  }

  /**
   * Emit 3 dust puffs on domino impact (docs/06 §4.1).
   * @param {number} cx
   * @param {number} cy
   * @param {number} dx
   * @param {number} dy
   */
  spawnDust(cx, cy, dx, dy) {
    for (let k = 0; k < 3; k++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 25 + Math.random() * 45;
      this.spawn(
        cx,
        cy,
        Math.cos(ang) * spd + dx * 28,
        Math.sin(ang) * spd + dy * 28,
        0,
        5,
        5,
        0.32,
        'rgba(255,250,235,0.92)',
        0
      );
    }
  }

  /**
   * Emit 40 colorful victory confetti pieces from the bottom of the board (docs/06 §4.2).
   * @param {number} left
   * @param {number} bottom
   * @param {number} width
   * @param {number} height
   * @param {string[]} palette
   */
  spawnConfetti(left, bottom, width, height, palette) {
    for (let k = 0; k < 40; k++) {
      const x = left + Math.random() * width;
      const y = bottom + Math.random() * 12;
      const vx = (Math.random() - 0.5) * 90;
      const vy = -(height * (0.9 + Math.random() * 0.7));
      this.spawn(
        x,
        y,
        vx,
        vy,
        height * 0.75,
        7,
        10,
        1.1 + Math.random() * 0.65,
        palette[k % palette.length],
        (Math.random() - 0.5) * 10
      );
    }
  }

  /**
   * Advance all active particles by `dtSec`.
   * @param {number} dtSec
   */
  update(dtSec) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dtSec;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        const last = --this.count;
        if (i < last) {
          this.x[i] = this.x[last];
          this.y[i] = this.y[last];
          this.vx[i] = this.vx[last];
          this.vy[i] = this.vy[last];
          this.gravity[i] = this.gravity[last];
          this.sizeW[i] = this.sizeW[last];
          this.sizeH[i] = this.sizeH[last];
          this.rot[i] = this.rot[last];
          this.vrot[i] = this.vrot[last];
          this.age[i] = this.age[last];
          this.life[i] = this.life[last];
          this.color[i] = this.color[last];
        }
        continue;
      }
      this.vy[i] += this.gravity[i] * dtSec;
      this.x[i] += this.vx[i] * dtSec;
      this.y[i] += this.vy[i] * dtSec;
      this.rot[i] += this.vrot[i] * dtSec;
      i++;
    }
  }

  /**
   * Draw all live particles onto the 2D context.
   * @param {CanvasRenderingContext2D} ctx
   */
  draw(ctx) {
    if (this.count === 0) return;
    ctx.save();
    for (let i = 0; i < this.count; i++) {
      const p = this.age[i] / this.life[i];
      const alpha = Math.max(0, 1 - p);
      const scale = this.gravity[i] === 0 ? (1 - p * 0.65) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(this.x[i], this.y[i]);
      if (this.rot[i] !== 0) ctx.rotate(this.rot[i]);
      ctx.fillStyle = this.color[i];
      const w = this.sizeW[i] * scale;
      const h = this.sizeH[i] * scale;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
  }
}
