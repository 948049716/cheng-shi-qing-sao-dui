// @ts-check
/** @typedef {import('../../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */
/** @typedef {import('../../../types/platform.d.ts').ViewportMetrics} ViewportMetrics */
/** @typedef {import('../../../types/platform.d.ts').PointerPayload} PointerPayload */
/** @typedef {import('../../../types/platform.d.ts').AdResult} AdResult */
/** @typedef {import('../../../types/platform.d.ts').CanvasLike} CanvasLike */

/** Optional WeChat ad unit IDs configured after opening Traffic Master (1000 UV). */
const AD_UNIT_IDS = {
  A1: '',
  A2: '',
  A3: ''
};

/**
 * WeChat Mini-Game native IPlatformAdapter implementation (zero DOM/window references).
 * @implements {IPlatformAdapter}
 */
export class WxMiniGameAdapter {
  constructor() {
    /** @type {'wx'} */
    this.name = 'wx';
    if (wx.showShareMenu) {
      wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    }
  }

  /** @returns {CanvasLike} */
  createMainCanvas() {
    return wx.createCanvas();
  }

  /**
   * @param {number} w
   * @param {number} h
   * @returns {CanvasLike}
   */
  createOffscreenCanvas(w, h) {
    return wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
  }

  /** @returns {ViewportMetrics} */
  getViewportMetrics() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const safeTop = capsule ? capsule.top : (info.safeArea ? info.safeArea.top : 20);
    const safeBottom = info.safeArea ? Math.max(0, info.windowHeight - info.safeArea.bottom) : 0;
    return {
      width: info.windowWidth,
      height: info.windowHeight,
      dpr: info.pixelRatio || 2,
      safeTop,
      safeBottom,
      capsuleRect: capsule
    };
  }

  /**
   * @param {(ts: number) => void} cb
   * @returns {number}
   */
  requestAnimationFrame(cb) {
    return requestAnimationFrame(cb);
  }

  /**
   * @template T
   * @param {string} relPath
   * @returns {Promise<T>}
   */
  async loadJson(relPath) {
    const fs = wx.getFileSystemManager();
    const txt = fs.readFileSync(relPath, 'utf8');
    return JSON.parse(txt);
  }

  /** @param {(p: PointerPayload) => void} cb */
  onPointerDown(cb) {
    wx.onTouchStart(e => {
      const t = e.changedTouches[0];
      if (t) cb({ x: t.clientX, y: t.clientY, id: t.identifier });
    });
  }

  /** @param {(p: PointerPayload) => void} cb */
  onPointerMove(cb) {
    wx.onTouchMove(e => {
      const t = e.changedTouches[0];
      if (t) cb({ x: t.clientX, y: t.clientY, id: t.identifier });
    });
  }

  /** @param {(p: PointerPayload) => void} cb */
  onPointerUp(cb) {
    /** @param {WechatMinigame.TouchEvent} e */
    const end = e => {
      const t = e.changedTouches[0];
      if (t) cb({ x: t.clientX, y: t.clientY, id: t.identifier });
    };
    wx.onTouchEnd(end);
    wx.onTouchCancel(end);
  }

  /** @param {(m: ViewportMetrics) => void} cb */
  onResize(cb) {
    if (wx.onWindowResize) {
      wx.onWindowResize(() => cb(this.getViewportMetrics()));
    }
  }

  /** @param {(state: 'hide' | 'show') => void} cb */
  onLifecycle(cb) {
    wx.onHide(() => cb('hide'));
    wx.onShow(() => cb('show'));
    if (wx.onAudioInterruptionBegin) wx.onAudioInterruptionBegin(() => cb('hide'));
    if (wx.onAudioInterruptionEnd) wx.onAudioInterruptionEnd(() => cb('show'));
  }

  /** @returns {AudioContext | null} */
  createAudioContext() {
    return wx.createWebAudioContext ? wx.createWebAudioContext() : null;
  }

  /** @param {'light' | 'medium' | 'heavy'} [type='light'] */
  vibrateShort(type = 'light') {
    if (wx.vibrateShort) {
      try {
        wx.vibrateShort({ type });
      } catch {
        // ignore unsupported devices
      }
    }
  }

  /**
   * @param {string} key
   * @returns {string | null}
   */
  readStorage(key) {
    try {
      const v = wx.getStorageSync(key);
      return typeof v === 'string' && v.length ? v : null;
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
      wx.setStorageSync(key, value);
    } catch {
      // ignore quota failures
    }
  }

  /**
   * @param {'A1' | 'A2' | 'A3'} slotId
   * @returns {Promise<AdResult>}
   */
  async showRewardedAd(slotId) {
    const adUnitId = AD_UNIT_IDS[slotId];
    if (!wx.createRewardedVideoAd || !adUnitId) {
      return { completed: true, fallback: true };
    }
    return new Promise(resolve => {
      if (!wx.createRewardedVideoAd) return resolve({ completed: false, error: 'unsupported' });
      const ad = wx.createRewardedVideoAd({ adUnitId });
      /** @param {{ isEnded?: boolean } | undefined} res */
      const onClose = res => {
        ad.offClose(onClose);
        ad.offError(onErr);
        resolve({ completed: Boolean(res && res.isEnded) });
      };
      /** @param {unknown} err */
      const onErr = err => {
        ad.offClose(onClose);
        ad.offError(onErr);
        resolve({ completed: false, error: String(err) });
      };
      ad.onClose(onClose);
      ad.onError(onErr);
      ad.show().catch(() => ad.load().then(() => ad.show()).catch(onErr));
    });
  }

  /** @param {{ title: string; query?: string; imageUrl?: string }} opts */
  shareMessage(opts) {
    if (wx.shareAppMessage) {
      wx.shareAppMessage(opts);
    }
  }

  /**
   * @param {string} eventId
   * @param {Record<string, string | number | boolean>} [data]
   */
  reportEvent(eventId, data) {
    if (wx.reportEvent) {
      try {
        wx.reportEvent(eventId, data || {});
      } catch {
        // ignore analytics failures
      }
    }
  }
}
