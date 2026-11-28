export interface ViewportMetrics {
  width: number;
  height: number;
  dpr: number;
  safeTop: number;
  safeBottom: number;
  capsuleRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
}

export interface PointerPayload {
  x: number;
  y: number;
  id: number;
}

export interface AdResult {
  completed: boolean;
  fallback?: boolean;
  error?: string;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

export interface CloudKVItem {
  key: string;
  value: string;
}

export interface IPlatformAdapter {
  readonly name: 'wx' | 'web' | 'xhs' | 'tt' | 'desktop';
  createMainCanvas(): CanvasLike;
  createOffscreenCanvas(w: number, h: number): CanvasLike;
  getViewportMetrics(): ViewportMetrics;
  requestAnimationFrame(cb: (ts: number) => void): number;
  loadJson<T = unknown>(relPath: string): Promise<T>;
  onPointerDown(cb: (p: PointerPayload) => void): void;
  onPointerMove(cb: (p: PointerPayload) => void): void;
  onPointerUp(cb: (p: PointerPayload) => void): void;
  onResize(cb: (m: ViewportMetrics) => void): void;
  onLifecycle(cb: (state: 'hide' | 'show') => void): void;
  createAudioContext(): AudioContext | null;
  vibrateShort(type?: 'light' | 'medium' | 'heavy'): void;
  readStorage(key: string): string | null;
  writeStorage(key: string, value: string): void;
  showRewardedAd(slotId: 'A1' | 'A2' | 'A3'): Promise<AdResult>;
  shareMessage(opts: { title: string; query?: string; imageUrl?: string }): void;
  reportEvent(eventId: string, data?: Record<string, string | number | boolean>): void;
  submitLeaderboardScore?(kvList: CloudKVItem[]): void;
  getOpenDataCanvas?(): CanvasLike | null;
  postOpenDataMessage?(msg: Record<string, unknown>): void;
}

