// @ts-check
import { SAME_LAYER_MAX_VOICES, VIBRATE_THROTTLE_MS } from '../core/constants.js';

/** @typedef {import('../../../types/domain.d.ts').SkinDef} SkinDef */
/** @typedef {import('../../../types/platform.d.ts').IPlatformAdapter} IPlatformAdapter */

const PENTA = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3];

/**
 * Compute G-major pentatonic frequency starting at G4 (392 Hz), cycling in high register after layer 12.
 * @param {number} layer
 * @returns {number}
 */
export function pentatonicFreq(layer) {
  const n = layer < 12 ? layer : 10 + ((layer - 10) % 5);
  return 392 * PENTA[n % 5] * Math.pow(2, Math.floor(n / 5));
}

export class SoundEngine {
  /**
   * @param {IPlatformAdapter} platform
   */
  constructor(platform) {
    this.platform = platform;
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {AudioBuffer | null} */
    this.noiseBuf = null;
    this.muted = false;
    this.haptics = true;
    /** @type {SkinDef['soundStyle']} */
    this.soundStyle = 'wood';
    this.lastVibrateTs = 0;
  }

  /**
   * Lazily initialize or resume AudioContext on first user gesture.
   */
  ensureReady() {
    if (!this.ctx) {
      this.ctx = this.platform.createAudioContext();
      if (this.ctx) {
        const len = Math.max(1, Math.floor(this.ctx.sampleRate * 0.03));
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
        }
        this.noiseBuf = buf;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        this.ctx.resume();
      } catch {
        // ignore gesture race
      }
    }
  }

  /**
   * Handle platform hide/show lifecycle safely.
   * @param {'hide' | 'show'} state
   */
  onLifecycle(state) {
    if (!this.ctx) return;
    try {
      if (state === 'hide' && this.ctx.state === 'running') this.ctx.suspend();
      if (state === 'show' && this.ctx.state === 'suspended') this.ctx.resume();
    } catch {
      // ignore
    }
  }

  /**
   * Play domino clack + pentatonic note for a given cascade layer and voice index within that layer.
   * Caps same-layer voices at 2 (1.0, 0.6) to prevent clipping.
   * @param {number} layer
   * @param {number} voiceInLayer 1-based count in current layer
   */
  playClack(layer, voiceInLayer) {
    if (voiceInLayer > SAME_LAYER_MAX_VOICES) return;
    const vol = voiceInLayer === 1 ? 1.0 : 0.6;
    if (!this.ctx || this.muted) return;

    const t = this.ctx.currentTime;
    const f = pentatonicFreq(layer);

    // Percussive clack transient (3200Hz bandpass noise, 30ms)
    if (this.noiseBuf) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = this.soundStyle === 'bamboo' ? 2400 : 3200;
      bp.Q.value = this.soundStyle === 'musicbox' ? 2.2 : 1.4;
      const g = this.ctx.createGain();
      const noiseGain = this.soundStyle === 'musicbox' ? 0.28 : 0.52;
      g.gain.setValueAtTime(noiseGain * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      n.connect(bp).connect(g).connect(this.ctx.destination);
      n.start(t);
    }

    // Melodic tone tailored by active sound pack
    /** @type {[number, OscillatorType, number, number][]} */
    let partials;
    if (this.soundStyle === 'marimba') {
      partials = [[f, 'sine', 0.22, 0.24], [f * 4, 'sine', 0.06, 0.08]];
    } else if (this.soundStyle === 'musicbox') {
      partials = [[f * 2, 'sine', 0.16, 0.34], [f * 4, 'triangle', 0.05, 0.18]];
    } else if (this.soundStyle === 'bamboo') {
      partials = [[f, 'triangle', 0.19, 0.16], [f * 2.75, 'sine', 0.05, 0.09]];
    } else {
      partials = [[f, 'sine', 0.2, 0.18], [f * 4, 'sine', 0.035, 0.14]];
    }

    for (const [freq, type, amp, dur] of partials) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(amp * vol, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g2).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  /**
   * Throttled light haptic pulse during cascade (>= 45ms spacing).
   * @param {number} nowMs
   */
  pulseCascadeHaptic(nowMs) {
    if (!this.haptics) return;
    if (nowMs - this.lastVibrateTs >= VIBRATE_THROTTLE_MS) {
      this.lastVibrateTs = nowMs;
      this.platform.vibrateShort('light');
    }
  }

  /**
   * Soft click for undo / UI controls.
   */
  playUndo() {
    this.playTone(700, 0.08, 0.08, 0, 'sine');
    if (this.haptics) this.platform.vibrateShort('light');
  }

  /**
   * Low triangle bonk for fail / out of pushes.
   */
  playFail() {
    this.playTone(160, 0.16, 0.24, 0, 'triangle');
    if (this.haptics) this.platform.vibrateShort('medium');
  }

  /**
   * Ascending 6-note arpeggio (C5-G6) on victory.
   */
  playWin() {
    const notes = [523, 659, 784, 1047, 1319, 1568];
    notes.forEach((f, idx) => this.playTone(f, 0.48, 0.14, idx * 0.08, 'sine'));
    if (this.haptics) this.platform.vibrateShort('heavy');
  }

  /**
   * @param {number} freq
   * @param {number} dur
   * @param {number} vol
   * @param {number} delay
   * @param {OscillatorType} type
   */
  playTone(freq, dur, vol, delay, type) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
