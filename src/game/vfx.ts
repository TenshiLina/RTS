// Effect library: turns simulation events into particles / ribbons. Purely cosmetic (uses
// Math.random freely — never feeds back into the deterministic sim).

import { ParticleSystem, FX } from '../render/particles';
import type { FxMeshRenderer, FxMeshInstance } from '../render/fxMeshes';
import type { GroundFx } from '../render/groundFx';
import type { PointLight, Gust } from '../render/renderer';
import type { V3, M4 } from '../core/math';

const R = Math.random;
const rr = (a: number, b: number) => a + (b - a) * R();
const rdir = (): V3 => {
  const a = R() * Math.PI * 2, z = rr(-1, 1), s = Math.sqrt(1 - z * z);
  return [Math.cos(a) * s, z, Math.sin(a) * s];
};

// palette (linear-ish, HDR via intensity)
const GOLD: [number, number, number, number] = [1, 0.78, 0.3, 1];
const SMOKE: [number, number, number, number] = [0.32, 0.3, 0.28, 0.55];
const DUST: [number, number, number, number] = [0.62, 0.52, 0.4, 0.5];
const JADE: [number, number, number, number] = [0.35, 1, 0.65, 1];
const QI: [number, number, number, number] = [0.5, 0.88, 1, 1];
const STORM: [number, number, number, number] = [0.6, 0.75, 1, 1];

/** A dynamic light owned by an effect. */
export interface LightFx {
  pos: V3;
  color: [number, number, number];
  intensity: number;
  radius: number;
  life: number;
  age: number;
  /** 0 = steady, 1 = strong fire flicker */
  flicker: number;
  /** seconds to reach full intensity */
  attack: number;
  follow?: () => V3 | null;
}
export interface GustFx {
  x: number;
  z: number;
  radius: number;
  strength: number;
  life: number;
  age: number;
  follow?: () => [number, number] | null;
}
/** A 3D effect mesh driven by a per-frame callback that sets its transform and fade. */
export interface MeshFx {
  mesh: number;
  mat: number;
  color: [number, number, number, number];
  life: number;
  age: number;
  seed: number;
  matrix: M4;
  fade: number;
  update: (m: MeshFx, dt: number) => void;
}

export class VFX {
  flash = 0;
  lights: LightFx[] = [];
  gusts: GustFx[] = [];
  meshes: MeshFx[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private scripts: { age: number; life: number; fn: (k: number, dt: number, age: number) => boolean | void }[] = [];
  constructor(public ps: ParticleSystem, public fxm: FxMeshRenderer, public ground: GroundFx) {}

  update(dt: number) {
    this.ps.update(dt);
    this.ground.update(dt);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if ((this.timers[i].t -= dt) <= 0) {
        this.timers[i].fn();
        this.timers.splice(i, 1);
      }
    }
    this.scripts = this.scripts.filter((s) => {
      s.age += dt;
      const k = Math.min(1, s.age / s.life);
      return s.fn(k, dt, s.age) !== false && s.age < s.life;
    });
    this.lights = this.lights.filter((l) => {
      l.age += dt;
      if (l.follow) {
        const p = l.follow();
        if (!p) return false;
        l.pos = p;
      }
      return l.age < l.life;
    });
    this.gusts = this.gusts.filter((g) => {
      g.age += dt;
      if (g.follow) {
        const p = g.follow();
        if (!p) return false;
        [g.x, g.z] = p;
      }
      return g.age < g.life;
    });
    this.meshes = this.meshes.filter((m) => {
      m.age += dt;
      if (m.age >= m.life) return false;
      m.update(m, dt);
      return true;
    });
  }
  later(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }
  /** Run fn every frame for `life` seconds with k = normalised time (0..1). Return false to stop. */
  run(life: number, fn: (k: number, dt: number, age: number) => boolean | void) {
    this.scripts.push({ age: 0, life, fn });
  }
  light(pos: V3, color: [number, number, number], intensity: number, radius: number, life: number, opts: { flicker?: number; attack?: number; follow?: () => V3 | null } = {}) {
    const l: LightFx = { pos, color, intensity, radius, life, age: 0, flicker: opts.flicker ?? 0, attack: opts.attack ?? 0.05, follow: opts.follow };
    this.lights.push(l);
    return l;
  }
  gust(x: number, z: number, radius: number, strength: number, life: number, follow?: () => [number, number] | null) {
    const g: GustFx = { x, z, radius, strength, life, age: 0, follow };
    this.gusts.push(g);
    return g;
  }
  mesh(mesh: number, mat: number, color: [number, number, number, number], life: number, update: (m: MeshFx, dt: number) => void) {
    const m: MeshFx = { mesh, mat, color, life, age: 0, seed: R(), matrix: new Float32Array(16) as unknown as M4, fade: 1, update };
    update(m, 0);
    this.meshes.push(m);
    return m;
  }

  /** Scene inputs for the renderer this frame. */
  sceneLights(time: number): PointLight[] {
    return this.lights.map((l) => {
      const k = l.age / l.life;
      const env = Math.min(1, l.age / Math.max(0.001, l.attack)) * (k > 0.7 ? (1 - k) / 0.3 : 1);
      const fl = l.flicker ? 1 - l.flicker * 0.45 * (0.5 + 0.5 * Math.sin(time * 23 + l.pos[0] * 3) * Math.sin(time * 17.3 + l.pos[2])) : 1;
      return { pos: l.pos, radius: l.radius, color: l.color, intensity: l.intensity * env * fl };
    });
  }
  sceneGusts(): Gust[] {
    return this.gusts.map((g) => {
      const k = g.age / g.life;
      const env = Math.min(1, g.age / 0.15) * (k > 0.6 ? (1 - k) / 0.4 : 1);
      return { x: g.x, z: g.z, radius: g.radius, strength: g.strength * env };
    });
  }
  meshInstances(): FxMeshInstance[] {
    return this.meshes.map((m) => ({ mesh: m.mesh, mat: m.mat, matrix: m.matrix, color: m.color, age: m.age, fade: m.fade, seed: m.seed }));
  }

  // ---------------------------------------------------------------- combat
  // ---- Qi talisman: gold, not fire — spinning paper, a trail of script, a ring of burning glyphs
  talismanCast(p: V3) {
    this.ps.spawn({ pos: p, life: 0.28, size: [0.2, 0.8], color: GOLD, cell: FX.glow, additive: true, intensity: [1.6, 0.3] });
    for (let i = 0; i < 8; i++) this.ps.spawn({ pos: p, vel: rdir().map((v) => v * rr(1, 3)) as V3, life: rr(0.3, 0.6), size: [0.1, 0.03], color: GOLD, cell: FX.star, additive: true, drag: 2, intensity: [2.5, 1], rot: R() * 6 });
  }
  /** Flying talisman: spinning paper + a stream of golden script (called every frame). */
  talismanTrail(p: V3, vel: V3) {
    this.ps.spawn({ pos: p, life: 0.035, size: [0.34, 0.34], color: [1, 1, 1, 1], cell: FX.talisman, intensity: [1.7, 1.7], rot: Math.atan2(vel[0], vel[2]) + this.ps.time * 14, additive: false, soft: false });
    this.ps.spawn({ pos: p, life: 0.05, size: [0.7, 0.7], color: [1, 0.78, 0.32, 0.8], cell: FX.glow, additive: true, intensity: [1.2, 1] });
    if (R() < 0.9) this.ps.spawn({ pos: [p[0] + rr(-0.1, 0.1), p[1] + rr(-0.1, 0.1), p[2] + rr(-0.1, 0.1)], vel: [rr(-0.2, 0.2), rr(0.1, 0.5), rr(-0.2, 0.2)], life: rr(0.4, 0.7), size: [0.12, 0.04], color: GOLD, cell: FX.star, additive: true, mode: 3, intensity: [2.6, 1], rot: R() * 6 });
  }
  talismanBurst(p: V3, radius: number) {
    const s = Math.max(1, radius);
    const c: V3 = [p[0], p[1] + 0.7, p[2]];
    this.ps.spawn({ pos: c, life: 0.2, size: [0.8 * s, 1.8 * s], color: [1, 0.8, 0.4, 1], cell: FX.glow, additive: true, intensity: [2, 0] });
    // a ring of glowing glyphs spins outward on the ground, and a second one stands upright
    this.ps.spawn({ pos: [p[0], p[1] + 0.1, p[2]], life: 0.7, size: [0.5, 2.4 * s], color: GOLD, cell: FX.glyphring, additive: true, flat: true, vrot: 3, rot: R() * 6, intensity: [2.4, 0.4], fadeIn: 0.02 });
    this.ps.spawn({ pos: c, life: 0.45, size: [0.4, 1.6 * s], color: GOLD, cell: FX.glyphring, additive: true, vrot: -4, intensity: [2, 0], fadeIn: 0.02, soft: false });
    this.light(c, [1, 0.72, 0.3], 14, 6, 0.35, { attack: 0.01 });
    for (let i = 0; i < 16; i++) {
      const d = rdir();
      this.ps.spawn({ pos: c, vel: [d[0] * rr(3, 7), Math.abs(d[1]) * rr(2, 6), d[2] * rr(3, 7)], life: rr(0.4, 0.8), size: [0.12, 0.04], color: GOLD, cell: FX.star, additive: true, drag: 2.5, intensity: [3, 1], rot: R() * 6 });
    }
    // burning talisman scraps flutter down, glowing at the edges
    for (let i = 0; i < 7; i++) this.ps.spawn({ pos: [p[0], p[1] + 1, p[2]], vel: [rr(-2, 2), rr(2, 4), rr(-2, 2)], life: rr(1, 1.6), size: [0.16, 0.1], color: [1, 1, 1, 1], color1: [1, 0.4, 0.1, 0], cell: FX.talisman, gravity: 3, drag: 1.5, rot: rr(0, 6), vrot: rr(-8, 8), intensity: [1.6, 3], additive: false, mode: 2 });
    for (let i = 0; i < 3; i++) this.ps.spawn({ pos: [p[0] + rr(-0.4, 0.4), p[1] + 0.3, p[2] + rr(-0.4, 0.4)], vel: [rr(-0.5, 0.5), rr(0.6, 1.3), rr(-0.5, 0.5)], life: rr(1.2, 1.8), size: [0.5 * s, 1.5 * s], color: SMOKE, cell: FX.smoke, mode: 2, drag: 0.8, rot: rr(0, 6), vrot: rr(-0.5, 0.5) });
    this.ground.stamp(0, p[0], p[2], 0.8 * s, 0.35);
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
  /** The storm gathers: a spiralling cloud disk with lightning inside, wind pushing out, the rune charging. */
  wrathGather(p: V3, radius: number, duration: number) {
    const anchor = { pos: [p[0], p[1], p[2]] as V3 };
    for (let i = 0; i < 34; i++) {
      this.ps.spawn({
        pos: p, orbit: { anchor, r: rr(radius * 2.2, radius * 3.6), a: R() * 6.28, w: rr(0.9, 1.4), dr: -rr(1.5, 3), h: rr(15, 19), lift: rr(-0.3, 0.3) },
        life: duration + rr(1, 1.6), size: [rr(3.5, 5), rr(5, 7.5)], color: [0.16, 0.17, 0.23, 0.82], color1: [0.16, 0.17, 0.23, 0], cell: FX.cloud, rot: R() * 6, vrot: rr(-0.4, 0.4), delay: rr(0, duration * 0.35), fadeIn: 0.25,
      });
    }
    // lightning flickering inside the clouds
    for (let i = 0; i < 9; i++) {
      this.later(rr(0.15, duration), () => {
        const a = R() * 6.28, r = rr(0, radius * 1.8);
        const q: V3 = [p[0] + Math.cos(a) * r, p[1] + rr(15, 18), p[2] + Math.sin(a) * r];
        this.light(q, [0.6, 0.72, 1], 24, 24, 0.09, { attack: 0.005 });
        this.ps.spawn({ pos: q, life: 0.12, size: [rr(2, 3.5), 3], color: [0.75, 0.85, 1, 1], cell: FX.arc, additive: true, mode: 4, rot: R() * 6, intensity: [5, 3] });
        this.ps.spawn({ pos: q, life: 0.1, size: [4, 5], color: [0.55, 0.65, 1, 0.6], cell: FX.glow, additive: true, intensity: [1.5, 0] });
      });
    }
    // wind pushing out from under the storm; dust racing away at the rim
    this.gust(p[0], p[2], radius * 5, 1.1, duration + 0.6);
    this.run(duration, (k) => {
      if (R() < 0.6) {
        const a = R() * 6.28, r = radius * rr(0.9, 1.4);
        this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.3, p[2] + Math.sin(a) * r], vel: [Math.cos(a) * rr(3, 6), rr(0.2, 0.8), Math.sin(a) * rr(3, 6)], life: rr(0.7, 1.1), size: [0.6, 1.8], color: DUST, cell: FX.dust, drag: 1.5, rot: R() * 6 });
      }
      // static crawling on the ground as the charge builds
      if (k > 0.55 && R() < 0.5) {
        const a = R() * 6.28, r = Math.sqrt(R()) * radius;
        this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.12, p[2] + Math.sin(a) * r], life: rr(0.06, 0.14), size: [rr(0.4, 0.8), 0.4], color: [0.7, 0.85, 1, 1], cell: FX.arc, additive: true, flat: true, mode: 4, rot: R() * 6, intensity: [4, 3] });
      }
    });
    // the rune circle charges up
    this.ps.spawn({ pos: [p[0], p[1] + 0.15, p[2]], life: duration + 0.25, size: [radius * 0.6, radius * 1.15], color: STORM, cell: FX.rune, additive: true, flat: true, vrot: 1.5, intensity: [1, 4.5] });
    this.light([p[0], p[1] + 1, p[2]], [0.55, 0.7, 1], 8, radius * 2.5, duration + 0.1, { attack: duration });
  }
  wrathStrike(p: V3, radius: number) {
    this.flash = Math.max(this.flash, 0.75);
    const bolt = (tx: number, tz: number, core: number, glow: number, top: number) => {
      const pts: V3[] = [];
      let x = tx + rr(-2.5, 2.5), z = tz + rr(-2.5, 2.5);
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        x += (tx - x) * 0.25 + rr(-1, 1) * (1 - t);
        z += (tz - z) * 0.25 + rr(-1, 1) * (1 - t);
        pts.push([i === steps ? tx : x, top + (p[1] - top) * t, i === steps ? tz : z]);
      }
      const draw = () => {
        this.ps.ribbon(pts, core, [0.85, 0.92, 1], 7, 0.12);
        this.ps.ribbon(pts, glow, [0.45, 0.6, 1], 2, 0.2);
        for (let f = 0; f < 3; f++) {
          const i0 = 3 + ((R() * 9) | 0);
          const fork: V3[] = [pts[i0]];
          let q = pts[i0];
          for (let k = 0; k < 5; k++) {
            q = [q[0] + rr(-1.6, 1.6), q[1] - rr(0.8, 2), q[2] + rr(-1.6, 1.6)];
            fork.push(q);
          }
          this.ps.ribbon(fork, core * 0.45, [0.75, 0.85, 1], 5, 0.12);
        }
      };
      draw();
      // the bolt flickers: re-strike along the same channel
      this.later(0.07, draw);
      this.later(0.16, draw);
    };
    bolt(p[0], p[2], 0.7, 2.6, p[1] + 30);
    for (let b = 0; b < 3; b++) this.later(rr(0.03, 0.2), () => bolt(p[0] + rr(-radius, radius) * 0.7, p[2] + rr(-radius, radius) * 0.7, 0.4, 1.4, p[1] + 26));
    this.light([p[0], p[1] + 3, p[2]], [0.75, 0.85, 1], 70, 28, 0.32, { attack: 0.005 });
    this.later(0.07, () => this.light([p[0], p[1] + 3, p[2]], [0.75, 0.85, 1], 45, 22, 0.12, { attack: 0.005 }));
    const g: V3 = [p[0], p[1] + 0.5, p[2]];
    this.ps.spawn({ pos: g, life: 0.35, size: [radius * 1.2, radius * 2.4], color: [0.8, 0.88, 1, 1], cell: FX.glow, additive: true, intensity: [2.2, 0] });
    this.ps.spawn({ pos: [p[0], p[1] + 0.2, p[2]], life: 0.8, size: [0.5, radius * 3.4], color: [0.7, 0.85, 1, 1], cell: FX.shock, additive: true, flat: true, intensity: [3, 0.2] });
    this.ps.spawn({ pos: [p[0], p[1] + 1.5, p[2]], life: 0.6, size: [radius, radius * 4], color: [1, 1, 1, 1], cell: FX.shock, distort: true, intensity: [3, 0] });
    for (let i = 0; i < 40; i++) {
      const d = rdir();
      this.ps.spawn({ pos: g, vel: [d[0] * rr(6, 14), Math.abs(d[1]) * rr(4, 12), d[2] * rr(6, 14)], life: rr(0.4, 1), size: [0.1, 0.03], color: STORM, cell: FX.spark, additive: true, stretch: 0.05, gravity: 10, drag: 1, intensity: [6, 2] });
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * 6.28;
      this.ps.spawn({ pos: [p[0], p[1] + 0.3, p[2]], vel: [Math.cos(a) * rr(5, 9), rr(0.5, 1.5), Math.sin(a) * rr(5, 9)], life: rr(0.7, 1.2), size: [0.8, 2.4], color: DUST, cell: FX.dust, drag: 2.5, rot: R() * 6 });
    }
    for (let i = 0; i < 16; i++) this.ps.spawn({ pos: [p[0], p[1] + 1, p[2]], vel: [rr(-5, 5), rr(5, 10), rr(-5, 5)], life: rr(1, 1.6), size: [0.18, 0.12], color: [1, 1, 1, 1], cell: FX.debris, gravity: 14, rot: R() * 6, vrot: rr(-10, 10), ground: 'bounce' });
    for (let i = 0; i < 10; i++) this.ps.spawn({ pos: [p[0] + rr(-radius, radius) * 0.6, p[1] + 1, p[2] + rr(-radius, radius) * 0.6], vel: [rr(-0.8, 0.8), rr(1, 2.5), rr(-0.8, 0.8)], life: rr(2.5, 4), size: [1.4, 4], color: [0.18, 0.18, 0.2, 0.6], cell: FX.smoke, mode: 2, drag: 0.7, rot: R() * 6, vrot: rr(-0.4, 0.4), delay: rr(0.1, 0.4) });
    // fused ground: glowing where the bolt hit, scorched around
    this.ground.stamp(3, p[0], p[2], radius * 0.7, 1, { rough: 0.5 });
    this.ground.stamp(0, p[0], p[2], radius * 1.35, 0.95, { rough: 0.5 });
    // electricity crawls over the ground — and races across anything wet
    this.run(1.2, (k) => {
      if (R() < 0.7 * (1 - k)) {
        const a = R() * 6.28, r = Math.sqrt(R()) * radius * 1.2;
        this.ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.12, p[2] + Math.sin(a) * r], life: rr(0.05, 0.14), size: [rr(0.5, 1.1), 0.4], color: [0.75, 0.88, 1, 1], cell: FX.arc, additive: true, flat: true, mode: 4, rot: R() * 6, intensity: [5, 3] });
      }
    });
    const wetSpots: V3[] = [];
    for (let dz = -radius * 2.5; dz <= radius * 2.5; dz += 1.2) for (let dx = -radius * 2.5; dx <= radius * 2.5; dx += 1.2) {
      const x = p[0] + dx, z = p[2] + dz;
      if (this.ground.sample(2, x, z) > 0.25) wetSpots.push([x, this.ps.heightAt(x, z) + 0.1, z]);
    }
    if (wetSpots.length) {
      this.run(1.4, (k) => {
        for (let i = 0; i < 3; i++) {
          const q = wetSpots[(R() * wetSpots.length) | 0];
          this.ps.spawn({ pos: [q[0] + rr(-0.5, 0.5), q[1] + rr(0, 0.6), q[2] + rr(-0.5, 0.5)], life: rr(0.06, 0.16), size: [rr(0.6, 1.2), 0.4], color: [0.7, 0.9, 1, 1], cell: FX.arc, additive: true, flat: R() < 0.6, mode: 4, rot: R() * 6, intensity: [6, 3] });
        }
        if (R() < 0.3 * (1 - k)) {
          const q = wetSpots[(R() * wetSpots.length) | 0];
          this.light([q[0], q[1] + 0.6, q[2]], [0.6, 0.8, 1], 10, 6, 0.08, { attack: 0.005 });
        }
      });
    }
  }
}
