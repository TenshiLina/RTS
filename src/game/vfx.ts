// Effect library: turns simulation events into particles / ribbons. Purely cosmetic (uses
// Math.random freely — never feeds back into the deterministic sim).

import { ParticleSystem, FX } from '../render/particles';
import type { V3 } from '../core/math';

const R = Math.random;
const rr = (a: number, b: number) => a + (b - a) * R();
const rdir = (): V3 => {
  const a = R() * Math.PI * 2, z = rr(-1, 1), s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, z, Math.sin(a) * s];
};

// palette (linear-ish, HDR via intensity)
const GOLD: [number, number, number, number] = [1, 0.78, 0.3, 1];
const FIRE: [number, number, number, number] = [1, 0.55, 0.18, 1];
const EMBER: [number, number, number, number] = [1, 0.3, 0.08, 1];
const SMOKE: [number, number, number, number] = [0.32, 0.3, 0.28, 0.55];
const DUST: [number, number, number, number] = [0.62, 0.52, 0.4, 0.5];
const JADE: [number, number, number, number] = [0.35, 1, 0.65, 1];
const QI: [number, number, number, number] = [0.5, 0.88, 1, 1];
const STORM: [number, number, number, number] = [0.6, 0.75, 1, 1];

export class VFX {
  flash = 0;
  private timers: { t: number; fn: () => void }[] = [];
  constructor(public ps: ParticleSystem) {}

  update(dt: number) {
    this.ps.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if ((this.timers[i].t -= dt) <= 0) {
        this.timers[i].fn();
        this.timers.splice(i, 1);
      }
    }
  }
  private later(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }

  // ---------------------------------------------------------------- combat
  talismanCast(p: V3) {
    this.ps.spawn({ pos: p, life: 0.3, size: [0.2, 0.7], color: GOLD, cell: FX.glow, additive: true, intensity: [1.8, 0.5] });
    for (let i = 0; i < 8; i++) this.ps.spawn({ pos: p, vel: rdir().map((v) => v * rr(1, 3)) as V3, life: rr(0.3, 0.6), size: [0.08, 0.02], color: GOLD, cell: FX.spark, additive: true, stretch: 0.08, drag: 2, intensity: [2, 0.8] });
  }
  /** Flying talisman: glowing paper + trailing embers (called every frame). */
  talismanTrail(p: V3, vel: V3) {
    this.ps.spawn({ pos: p, vel: [0, 0, 0], life: 0.035, size: [0.3, 0.3], color: [1, 1, 1, 1], cell: FX.talisman, intensity: [1.6, 1.6], rot: Math.atan2(vel[0], vel[2]), additive: false });
    this.ps.spawn({ pos: p, life: 0.05, size: [0.5, 0.45], color: [1, 0.7, 0.25, 0.8], cell: FX.glow, additive: true, intensity: [1.1, 0.8] });
    if (R() < 0.8) this.ps.spawn({ pos: p, vel: [rr(-0.3, 0.3), rr(0.2, 0.8), rr(-0.3, 0.3)], life: rr(0.3, 0.6), size: [0.1, 0.02], color: FIRE, color1: [1, 0.3, 0.05, 0], cell: FX.glow, additive: true, intensity: [1.6, 0.6] });
  }
  talismanBurst(p: V3, radius: number) {
    const s = Math.max(1, radius);
    this.ps.spawn({ pos: [p[0], p[1] + 0.6, p[2]], life: 0.22, size: [1 * s, 2.6 * s], color: [1, 0.7, 0.3, 1], cell: FX.glow, additive: true, intensity: [2.4, 0] });
    for (let i = 0; i < 14; i++) {
      const d = rdir();
      this.ps.spawn({ pos: [p[0], p[1] + 0.5, p[2]], vel: [d[0] * rr(1, 4) * s, Math.abs(d[1]) * rr(2, 5), d[2] * rr(1, 4) * s], life: rr(0.35, 0.7), size: [rr(0.5, 0.9) * s, rr(0.1, 0.3)], color: [1, 0.45, 0.12, 1], color1: [0.5, 0.1, 0.03, 0], cell: FX.fire, additive: true, drag: 3, gravity: -1, intensity: [1.7, 0.6], rot: rr(0, 6), vrot: rr(-3, 3) });
    }
    for (let i = 0; i < 18; i++) {
      const d = rdir();
      this.ps.spawn({ pos: [p[0], p[1] + 0.4, p[2]], vel: [d[0] * rr(4, 9), Math.abs(d[1]) * rr(3, 8), d[2] * rr(4, 9)], life: rr(0.4, 0.9), size: [0.07, 0.03], color: GOLD, cell: FX.spark, additive: true, stretch: 0.06, gravity: 9, drag: 1, intensity: [2.2, 1] });
    }
    // burning talisman scraps flutter down
    for (let i = 0; i < 6; i++) this.ps.spawn({ pos: [p[0], p[1] + 1, p[2]], vel: [rr(-2, 2), rr(2, 4), rr(-2, 2)], life: rr(1, 1.6), size: [0.16, 0.1], color: [1, 1, 1, 1], color1: [1, 0.4, 0.1, 0], cell: FX.talisman, gravity: 3, drag: 1.5, rot: rr(0, 6), vrot: rr(-8, 8), intensity: [1.6, 3], additive: false });
    for (let i = 0; i < 5; i++) this.ps.spawn({ pos: [p[0] + rr(-0.5, 0.5), p[1] + 0.3, p[2] + rr(-0.5, 0.5)], vel: [rr(-0.6, 0.6), rr(0.6, 1.4), rr(-0.6, 0.6)], life: rr(1.2, 2), size: [0.6 * s, 1.8 * s], color: SMOKE, cell: FX.smoke, drag: 0.8, rot: rr(0, 6), vrot: rr(-0.5, 0.5) });
    this.ps.spawn({ pos: [p[0], p[1] + 0.12, p[2]], life: 0.45, size: [0.3, 2.4 * s], color: [1, 0.7, 0.35, 1], cell: FX.shock, additive: true, flat: true, intensity: [1.6, 0.3] });
  }
  arrowHit(p: V3) {
    for (let i = 0; i < 3; i++) this.ps.spawn({ pos: p, vel: [rr(-0.8, 0.8), rr(0.4, 1.2), rr(-0.8, 0.8)], life: rr(0.4, 0.7), size: [0.12, 0.35], color: DUST, cell: FX.smoke, drag: 2, rot: rr(0, 6) });
  }
  meleeHit(p: V3) {
    for (let i = 0; i < 6; i++) {
      const d = rdir();
      this.ps.spawn({ pos: [p[0], p[1] + 1.1, p[2]], vel: [d[0] * 3, Math.abs(d[1]) * 3, d[2] * 3], life: rr(0.15, 0.3), size: [0.05, 0.02], color: [1, 0.95, 0.8, 1], cell: FX.spark, additive: true, stretch: 0.08, intensity: [3, 1] });
    }
  }
  unitDeath(p: V3, big = false) {
    const n = big ? 10 : 5;
    for (let i = 0; i < n; i++) this.ps.spawn({ pos: [p[0] + rr(-0.4, 0.4), p[1] + 0.2, p[2] + rr(-0.4, 0.4)], vel: [rr(-1, 1), rr(0.3, 1.2), rr(-1, 1)], life: rr(0.8, 1.4), size: [0.3, big ? 1.8 : 1.0], color: DUST, cell: FX.smoke, drag: 1.5, rot: rr(0, 6), vrot: rr(-1, 1) });
    if (big) this.structureExplosion(p, 1.2);
  }
  structureExplosion(p: V3, size: number) {
    this.flash = Math.max(this.flash, 0.12 * size);
    this.ps.spawn({ pos: [p[0], p[1] + 2 * size, p[2]], life: 0.4, size: [2 * size, 6 * size], color: [1, 0.65, 0.3, 1], cell: FX.glow, additive: true, intensity: [2.5, 0] });
    for (let i = 0; i < 26; i++) {
      const d = rdir();
      this.ps.spawn({ pos: [p[0] + d[0] * size * 2, p[1] + 0.8 + Math.abs(d[1]) * 2 * size, p[2] + d[2] * size * 2], vel: [d[0] * rr(2, 6), Math.abs(d[1]) * rr(3, 8), d[2] * rr(2, 6)], life: rr(0.6, 1.3), size: [rr(1, 2) * size, rr(0.3, 0.8)], color: [1, 0.45, 0.12, 1], color1: [0.45, 0.08, 0.02, 0], cell: FX.fire, additive: true, drag: 2, gravity: -1.5, intensity: [2, 0.6], rot: rr(0, 6), vrot: rr(-2, 2) });
    }
    for (let i = 0; i < 16; i++) this.ps.spawn({ pos: [p[0] + rr(-2, 2) * size, p[1] + rr(0.5, 3) * size, p[2] + rr(-2, 2) * size], vel: [rr(-1, 1), rr(1.5, 3.5), rr(-1, 1)], life: rr(2.5, 4.5), size: [1.5 * size, 4.5 * size], color: [0.18, 0.16, 0.15, 0.7], cell: FX.smoke, drag: 0.6, rot: rr(0, 6), vrot: rr(-0.4, 0.4), delay: rr(0, 0.5) });
    for (let i = 0; i < 18; i++) {
      const d = rdir();
      this.ps.spawn({ pos: [p[0], p[1] + 1.5, p[2]], vel: [d[0] * rr(4, 10), rr(5, 11), d[2] * rr(4, 10)], life: rr(1, 1.8), size: [0.18, 0.12], color: [1, 1, 1, 1], cell: FX.debris, gravity: 14, rot: rr(0, 6), vrot: rr(-10, 10) });
    }
    this.ps.spawn({ pos: [p[0], p[1] + 0.15, p[2]], life: 0.7, size: [1, 9 * size], color: [1, 0.75, 0.45, 1], cell: FX.shock, additive: true, flat: true, intensity: [3, 0.2] });
    this.scorch(p, 3 * size);
  }
  scorch(p: V3, r: number) {
    this.ps.spawn({ pos: [p[0], p[1] + 0.08, p[2]], life: 14, size: [r, r], color: [0.05, 0.04, 0.035, 0.75], color1: [0.05, 0.04, 0.035, 0], cell: FX.smoke, flat: true, rot: rr(0, 6) });
  }

  // ---------------------------------------------------------------- construction / economy
  constructionDust(x0: number, z0: number, x1: number, z1: number, y: number) {
    const per = Math.round((x1 - x0 + z1 - z0) * 0.8);
    for (let i = 0; i < per; i++) {
      const edge = R() * 4 | 0;
      const t = R();
      const x = edge < 2 ? x0 + (x1 - x0) * t : edge === 2 ? x0 : x1;
      const z = edge >= 2 ? z0 + (z1 - z0) * t : edge === 0 ? z0 : z1;
      this.ps.spawn({ pos: [x, y + 0.2, z], vel: [rr(-0.6, 0.6), rr(0.3, 1), rr(-0.6, 0.6)], life: rr(1, 2), size: [0.5, 1.8], color: DUST, cell: FX.smoke, drag: 1.2, rot: rr(0, 6), vrot: rr(-0.5, 0.5), delay: rr(0, 1.2) });
    }
  }
  buildComplete(p: V3, r: number) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.3, p[2] + Math.sin(a) * r], vel: [0, rr(1.5, 3), 0], life: rr(0.8, 1.4), size: [0.2, 0.05], color: GOLD, cell: FX.star, additive: true, intensity: [3, 1], rot: rr(0, 6), vrot: 2 });
    }
  }
  harvestGlint(p: V3) {
    for (let i = 0; i < 3; i++) this.ps.spawn({ pos: [p[0] + rr(-0.4, 0.4), p[1] + 0.3, p[2] + rr(-0.4, 0.4)], vel: [rr(-0.5, 0.5), rr(1, 2.5), rr(-0.5, 0.5)], life: rr(0.5, 0.9), size: [0.14, 0.03], color: JADE, cell: FX.star, additive: true, intensity: [3, 1], rot: rr(0, 6), vrot: 4, gravity: 2 });
    this.ps.spawn({ pos: [p[0], p[1] + 0.2, p[2]], vel: [rr(-0.3, 0.3), 0.4, rr(-0.3, 0.3)], life: 0.8, size: [0.2, 0.7], color: [0.5, 0.6, 0.5, 0.35], cell: FX.smoke, drag: 1 });
  }
  unloadGlint(p: V3) {
    for (let i = 0; i < 4; i++) this.ps.spawn({ pos: [p[0] + rr(-0.6, 0.6), p[1] + rr(1.5, 2.5), p[2] + rr(-0.6, 0.6)], vel: [rr(-0.3, 0.3), rr(0.5, 1.5), rr(-0.3, 0.3)], life: rr(0.6, 1.1), size: [0.16, 0.03], color: JADE, cell: FX.star, additive: true, intensity: [3.5, 1], rot: rr(0, 6), vrot: 3 });
  }
  chimneySmoke(p: V3, dark = false) {
    this.ps.spawn({ pos: [p[0] + rr(-0.1, 0.1), p[1], p[2] + rr(-0.1, 0.1)], vel: [rr(0.2, 0.6), rr(1.2, 2), rr(-0.2, 0.2)], life: rr(3, 4.5), size: [0.35, 2.4], color: dark ? [0.25, 0.24, 0.23, 0.5] : [0.85, 0.85, 0.85, 0.35], cell: FX.smoke, drag: 0.4, rot: rr(0, 6), vrot: rr(-0.3, 0.3) });
  }
  qiMote(p: V3) {
    const a = R() * Math.PI * 2, r = rr(0.3, 1.2);
    this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] - rr(0.5, 1.5), p[2] + Math.sin(a) * r], vel: [-Math.cos(a) * 0.3, rr(0.5, 1), -Math.sin(a) * 0.3], life: rr(1.2, 2), size: [0.12, 0.02], color: QI, cell: FX.glow, additive: true, intensity: [4, 1] });
  }
  jadeGlint(p: V3) {
    this.ps.spawn({ pos: [p[0] + rr(-0.6, 0.6), p[1] + rr(0.3, 1.2), p[2] + rr(-0.6, 0.6)], life: rr(0.5, 0.9), size: [0.02, 0.25], color1: [0.6, 1, 0.8, 0], color: JADE, cell: FX.star, additive: true, intensity: [4, 2], rot: rr(0, 6) });
  }

  // ---------------------------------------------------------------- Heaven's Wrath
  /** Storm gathering over the target during the cast delay. */
  wrathGather(p: V3, radius: number, duration: number) {
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, r = rr(0.5, radius * 1.6);
      this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + rr(12, 16), p[2] + Math.sin(a) * r], vel: [-Math.sin(a) * 3, rr(-0.3, 0.3), Math.cos(a) * 3], life: duration + rr(0.6, 1.4), size: [3, 6], color: [0.12, 0.13, 0.18, 0.8], cell: FX.smoke, drag: 0.2, rot: rr(0, 6), vrot: rr(-1, 1), delay: rr(0, duration * 0.5) });
    }
    // rotating rune circle on the ground
    this.ps.spawn({ pos: [p[0], p[1] + 0.15, p[2]], life: duration + 0.2, size: [radius * 0.3, radius * 1.15], color: STORM, cell: FX.rune, additive: true, flat: true, vrot: 1.5, intensity: [1.5, 4] });
    for (let i = 0; i < 10; i++) this.ps.spawn({ pos: [p[0] + rr(-radius, radius), p[1] + rr(10, 14), p[2] + rr(-radius, radius)], life: 0.12, size: [1.5, 2.5], color: STORM, cell: FX.glow, additive: true, intensity: [3, 0], delay: rr(0.2, duration) });
  }
  wrathStrike(p: V3, radius: number) {
    this.flash = 1;
    const bolts = 4;
    for (let b = 0; b < bolts; b++) {
      const tx = p[0] + (b ? rr(-radius, radius) * 0.7 : 0), tz = p[2] + (b ? rr(-radius, radius) * 0.7 : 0);
      const pts: V3[] = [];
      let x = tx + rr(-3, 3), z = tz + rr(-3, 3);
      const top = p[1] + 26;
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = top + (p[1] - top) * t;
        x += (tx - x) * 0.25 + rr(-0.9, 0.9) * (1 - t);
        z += (tz - z) * 0.25 + rr(-0.9, 0.9) * (1 - t);
        pts.push([i === steps ? tx : x, y, i === steps ? tz : z]);
      }
      const delay = b * 0.07;
      this.later(delay, () => {
        this.ps.ribbon(pts, b ? 0.45 : 0.8, [0.75, 0.85, 1], 7, 0.35);
        this.ps.ribbon(pts, b ? 1.6 : 2.6, [0.4, 0.55, 1], 2.2, 0.45);
        // forks
        for (let f = 0; f < 3; f++) {
          const i0 = 4 + ((R() * 8) | 0);
          const fork: V3[] = [pts[i0]];
          let q = pts[i0];
          for (let k = 0; k < 4; k++) {
            q = [q[0] + rr(-1.5, 1.5), q[1] - rr(0.8, 1.8), q[2] + rr(-1.5, 1.5)];
            fork.push(q);
          }
          this.ps.ribbon(fork, 0.25, [0.7, 0.8, 1], 5, 0.25);
        }
      });
    }
    const g: V3 = [p[0], p[1] + 0.5, p[2]];
    this.ps.spawn({ pos: g, life: 0.45, size: [radius * 1.5, radius * 3.5], color: [0.8, 0.9, 1, 1], cell: FX.glow, additive: true, intensity: [3.5, 0] });
    this.ps.spawn({ pos: [p[0], p[1] + 0.2, p[2]], life: 0.8, size: [0.5, radius * 3.2], color: [0.7, 0.85, 1, 1], cell: FX.shock, additive: true, flat: true, intensity: [5, 0.2] });
    for (let i = 0; i < 40; i++) {
      const d = rdir();
      this.ps.spawn({ pos: g, vel: [d[0] * rr(6, 14), Math.abs(d[1]) * rr(4, 12), d[2] * rr(6, 14)], life: rr(0.4, 1), size: [0.1, 0.03], color: STORM, cell: FX.spark, additive: true, stretch: 0.05, gravity: 10, drag: 1, intensity: [6, 2] });
    }
    for (let i = 0; i < 14; i++) this.ps.spawn({ pos: [p[0] + rr(-radius, radius), p[1] + 0.5, p[2] + rr(-radius, radius)], vel: [rr(-1, 1), rr(1, 3), rr(-1, 1)], life: rr(0.5, 1), size: [0.8, 1.6], color: FIRE, color1: EMBER.map((v, i) => (i === 3 ? 0 : v)) as [number, number, number, number], cell: FX.fire, additive: true, drag: 2, intensity: [4, 1], rot: rr(0, 6) });
    for (let i = 0; i < 10; i++) this.ps.spawn({ pos: [p[0] + rr(-radius, radius), p[1] + 1, p[2] + rr(-radius, radius)], vel: [rr(-0.8, 0.8), rr(1, 2.5), rr(-0.8, 0.8)], life: rr(2.5, 4), size: [1.5, 4], color: [0.2, 0.2, 0.22, 0.6], cell: FX.smoke, drag: 0.7, rot: rr(0, 6), vrot: rr(-0.4, 0.4), delay: rr(0.1, 0.4) });
    this.scorch(p, radius * 1.3);
  }
}
