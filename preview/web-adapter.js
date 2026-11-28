// @ts-check
/** @typedef {import('../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */
/** @typedef {import('../types/platform.d.ts').ViewportMetrics} ViewportMetrics */
/** @typedef {import('../types/platform.d.ts').PointerPayload} PointerPayload */
/** @typedef {import('../types/platform.d.ts').AdResult} AdResult */
/** @typedef {import('../types/platform.d.ts').CanvasLike} CanvasLike */

/**
 * Browser / Desktop preview implementation of IPlatformAdapter loading the exact same
 * `minigame/src/` ESM codebase.
 * @implements {IPlatformAdapter}
 */
export class WebPreviewAdapter {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string} [baseUrl='../minigame/']
   */
  constructor(canvas, baseUrl = '../minigame/') {
    /** @type {'web'} */
    this.name = 'web';
    this.canvas = canvas;
    this.baseUrl = baseUrl;
    /** @type {((p: PointerPayload) => void)[]} */
    this.downCbs = [];
    /** @type {((p: PointerPayload) => void)[]} */
    this.moveCbs = [];
    /** @type {((p: PointerPayload) => void)[]} */
    this.upCbs = [];
    /** @type {((m: ViewportMetrics) => void)[]} */
    this.resizeCbs = [];
    /** @type {((s: 'hide' | 'show') => void)[]} */
    this.lifeCbs = [];
    this.dragging = false;

    this.bindDOM();
  }

  bindDOM() {
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    /** @param {PointerEvent} e */
    const toPayload = e => {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
    };

    this.canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.dragging = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      const p = toPayload(e);
      for (const cb of this.downCbs) cb(p);
    });

    this.canvas.addEventListener('pointermove', e => {
      if (!this.dragging) return;
      const p = toPayload(e);
      for (const cb of this.moveCbs) cb(p);
    });

    /** @param {PointerEvent} e */
    const end = e => {
      if (!this.dragging) return;
      this.dragging = false;
      const p = toPayload(e);
      for (const cb of this.upCbs) cb(p);
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);

    window.addEventListener('resize', () => {
      const m = this.getViewportMetrics();
      for (const cb of this.resizeCbs) cb(m);
    });

    document.addEventListener('visibilitychange', () => {
      const state = document.hidden ? 'hide' : 'show';
      for (const cb of this.lifeCbs) cb(state);
    });
  }

  /** @returns {CanvasLike} */
  createMainCanvas() {
    return this.canvas;
  }

  /**
   * @param {number} w
   * @param {number} h
   * @returns {CanvasLike}
   */
  createOffscreenCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /** @returns {ViewportMetrics} */
  getViewportMetrics() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    return {
      width: w,
      height: h,
      dpr: Math.min(3, window.devicePixelRatio || 1),
      safeTop: 8,
      safeBottom: 6,
      capsuleRect: null
    };
  }

  /**
   * @param {(ts: number) => void} cb
   * @returns {number}
   */
  requestAnimationFrame(cb) {
    return window.requestAnimationFrame(cb);
  }

  /**
   * @template T
   * @param {string} relPath
   * @returns {Promise<T>}
   */
  async loadJson(relPath) {
    const res = await fetch(this.baseUrl + relPath);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${relPath}`);
    return res.json();
  }

  /** @param {(p: PointerPayload) => void} cb */
  onPointerDown(cb) { this.downCbs.push(cb); }
  /** @param {(p: PointerPayload) => void} cb */
  onPointerMove(cb) { this.moveCbs.push(cb); }
  /** @param {(p: PointerPayload) => void} cb */
  onPointerUp(cb) { this.upCbs.push(cb); }
  /** @param {(m: ViewportMetrics) => void} cb */
  onResize(cb) { this.resizeCbs.push(cb); }
  /** @param {(s: 'hide' | 'show') => void} cb */
  onLifecycle(cb) { this.lifeCbs.push(cb); }

  /** @returns {AudioContext | null} */
  createAudioContext() {
    const Ctor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  }

  /** @param {'light' | 'medium' | 'heavy'} [type='light'] */
  vibrateShort(type = 'light') {
    const ms = type === 'heavy' ? 28 : (type === 'medium' ? 18 : 8);
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch {
      // ignore
    }
  }

  /**
   * @param {string} key
   * @returns {string | null}
   */
  readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {string} value
   */
  writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  /**
   * @param {'A1' | 'A2' | 'A3'} _slotId
   * @returns {Promise<AdResult>}
   */
  async showRewardedAd(_slotId) {
    return { completed: true, fallback: true };
  }

  /** @param {{ title: string; query?: string; imageUrl?: string }} opts */
  shareMessage(opts) {
    console.info('[Preview Share]', opts.title);
  }

  /**
   * @param {string} _eventId
   * @param {Record<string, string | number | boolean>} [_data]
   */
  reportEvent(_eventId, _data) {
    // no-op in preview
  }

  /** @param {{ key: string; value: string }[]} _kvList */
  submitLeaderboardScore(_kvList) {
    // no-op in browser preview (local/benchmark leaderboard reads SaveManager live)
  }

  /** @returns {CanvasLike | null} */
  getOpenDataCanvas() {
    return null;
  }

  /** @param {Record<string, unknown>} _msg */
  postOpenDataMessage(_msg) {
    // no-op in browser preview
  }
}
