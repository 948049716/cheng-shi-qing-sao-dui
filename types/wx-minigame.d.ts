declare namespace WechatMinigame {
  interface WindowInfo {
    windowWidth: number;
    windowHeight: number;
    pixelRatio: number;
    safeArea?: { top: number; bottom: number; left: number; right: number; width: number; height: number };
  }
  interface MenuButtonRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }
  interface Touch {
    identifier: number;
    clientX: number;
    clientY: number;
  }
  interface TouchEvent {
    changedTouches: Touch[];
    touches: Touch[];
  }
  interface Canvas {
    width: number;
    height: number;
    getContext(type: '2d'): CanvasRenderingContext2D | null;
    toTempFilePathSync?(opts: Record<string, unknown>): string;
  }
  interface FileSystemManager {
    readFileSync(filePath: string, encoding: 'utf8'): string;
  }
  interface RewardedVideoAd {
    load(): Promise<void>;
    show(): Promise<void>;
    onClose(cb: (res?: { isEnded?: boolean }) => void): void;
    offClose(cb: (res?: { isEnded?: boolean }) => void): void;
    onError(cb: (err: unknown) => void): void;
    offError(cb: (err: unknown) => void): void;
  }
  interface Wx {
    createCanvas(): Canvas;
    createOffscreenCanvas(opts: { type: '2d'; width: number; height: number }): Canvas;
    getWindowInfo?(): WindowInfo;
    getSystemInfoSync(): WindowInfo;
    getMenuButtonBoundingClientRect?(): MenuButtonRect;
    onTouchStart(cb: (e: TouchEvent) => void): void;
    onTouchMove(cb: (e: TouchEvent) => void): void;
    onTouchEnd(cb: (e: TouchEvent) => void): void;
    onTouchCancel(cb: (e: TouchEvent) => void): void;
    onWindowResize?(cb: () => void): void;
    onHide(cb: () => void): void;
    onShow(cb: () => void): void;
    onAudioInterruptionBegin?(cb: () => void): void;
    onAudioInterruptionEnd?(cb: () => void): void;
    createWebAudioContext?(): AudioContext;
    vibrateShort?(opts: { type: 'light' | 'medium' | 'heavy' }): void;
    getFileSystemManager(): FileSystemManager;
    getStorageSync(key: string): string;
    setStorageSync(key: string, data: string): void;
    createRewardedVideoAd?(opts: { adUnitId: string }): RewardedVideoAd;
    shareAppMessage?(opts: { title: string; query?: string; imageUrl?: string }): void;
    showShareMenu?(opts: { withShareTicket?: boolean; menus?: string[] }): void;
    reportEvent?(eventId: string, data?: Record<string, string | number | boolean>): void;
  }
}

declare const wx: WechatMinigame.Wx;
