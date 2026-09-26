// Positional sound for the game: pans by screen position, fades with distance from the camera
// focus and off-screen, varies pitch a little, and throttles repeats so a volley of 30 arrows
// doesn't stack into noise.

import type { AudioOutput } from '../platform/platform';
import type { V3 } from '../core/math';

export interface SfxView {
  /** screen position (px) of a world point, w = clip w */
  project(p: V3): [number, number, number];
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly focus: V3;
}

const MAX_SAME = 3; // per name within WINDOW
const WINDOW = 0.09;

export class Sfx {
  private recent = new Map<string, number[]>();
  private t = 0;
  muted = false;
  constructor(private audio: AudioOutput, private view: SfxView) {}
  tick(dt: number) {
    this.t += dt;
  }
  play(name: string, p: V3 | null, volume = 1) {
    if (this.muted || !this.audio.ready) return;
    const hits = (this.recent.get(name) ?? []).filter((x) => this.t - x < WINDOW);
    if (hits.length >= MAX_SAME) return;
    hits.push(this.t);
    this.recent.set(name, hits);
    let pan = 0, att = 1;
    if (p) {
      const [sx, sy, w] = this.view.project(p);
      const W = this.view.screenWidth, H = this.view.screenHeight;
      pan = w > 0 ? Math.max(-1, Math.min(1, (sx / W) * 2 - 1)) * 0.7 : 0;
      const off = w <= 0 || sx < -W * 0.2 || sx > W * 1.2 || sy < -H * 0.2 || sy > H * 1.2;
      const f = this.view.focus;
      const d = Math.hypot(p[0] - f[0], p[2] - f[2]);
      att = Math.max(0, 1 - Math.max(0, d - 30) / 70) * (off ? 0.35 : 1);
    }
    const v = volume * att * (1 - hits.length * 0.2);
    if (v < 0.03) return;
    this.audio.play(name, { volume: v, pan, rate: 0.94 + Math.random() * 0.12 });
  }
}
