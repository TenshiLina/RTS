// Cosmetic particle system (not part of the deterministic sim). CPU-simulated quads and trails:
//   * billboards (camera-facing, velocity-stretched or ground-flat) sampling a procedural atlas
//   * shader modes: living flame, dissolve, twinkle, electric flicker
//   * trails: textured ribbons (lightning, water tendrils, flame tails, wind streaks, frost mist)
//   * soft edges where quads cut into the terrain, ground collision (droplets splash, fragments
//     bounce), orbiting motion around a moving anchor (whirlwinds)
//   * a distortion batch drawn into a screen-space offset buffer (heat haze, air blades, shocks)
// Three pipelines: alpha (premultiplied), additive, distortion.

import type { Device, Pipeline, Buffer, RenderPass, BindGroup, Texture, Sampler } from './rhi/types';
import { SHADERS } from './shaders';
import type { Renderer, FxEnv } from './renderer';
import { V3, M4, hash2, fbm3 } from '../core/math';

export const FX = {
  glow: 0, spark: 1, smoke: 2, ring: 3, star: 4, talisman: 5, beam: 6, fire: 7, petal: 8, debris: 9, shock: 10, arrow: 11, rune: 12,
  flame: 13, ember: 14, snowflake: 15, crystal: 16, droplet: 17, splash: 18, foam: 19, ripple: 20, leaf: 21, streak: 22,
  crescent: 23, wisp: 24, swirl: 25, steam: 26, shard: 27, frostburst: 28, glyphring: 29, dust: 30, cloud: 31, arc: 32,
} as const;
export type FxCell = (typeof FX)[keyof typeof FX];

/** fragment shader behaviour per particle */
export const MODE = { plain: 0, flame: 1, dissolve: 2, twinkle: 3, electric: 4 } as const;
/** procedural ribbon materials */
export const TRAIL = { beam: 8, water: 9, flame: 10, wind: 11, frost: 12 } as const;

export type RGBA = [number, number, number, number];

export interface Orbit {
  anchor: { pos: V3 };
  /** radius, angle, angular velocity (rad/s), radial velocity, height above anchor, lift (m/s) */
  r: number;
  a: number;
  w: number;
  dr?: number;
  h: number;
  lift?: number;
}

export interface ParticleSpec {
  pos: V3;
  vel?: V3;
  life: number;
  size: [number, number];
  color: RGBA;
  color1?: RGBA;
  intensity?: [number, number];
  cell: FxCell;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  rot?: number;
  vrot?: number;
  /** stretch along velocity (screen-space streaks) */
  stretch?: number;
  /** lie flat on the ground (rings, marks) */
  flat?: boolean;
  delay?: number;
  mode?: number;
  /** width / height of the quad (flames are taller than wide) */
  aspect?: number;
  /** fade out where the quad cuts into the terrain (default: on for upright quads) */
  soft?: boolean;
  /** what happens on touching the terrain */
  ground?: 'die' | 'bounce' | 'stick';
  onGround?: (p: Particle) => void;
  orbit?: Orbit;
  /** draw into the distortion buffer instead (strength = alpha × intensity) */
  distort?: boolean;
  /** 0 = radial push (shock rings), 1 = animated heat shimmer */
  distortKind?: number;
  /** fraction of life spent fading in (default 0.08; additive particles start at 60%) */
  fadeIn?: number;
}

export interface Particle {
  pos: V3;
  vel: V3;
  life: number;
  size: [number, number];
  color: RGBA;
  color1: RGBA;
  intensity: [number, number];
  cell: number;
  additive: boolean;
  gravity: number;
  drag: number;
  rot: number;
  vrot: number;
  stretch: number;
  flat: boolean;
  mode: number;
  aspect: number;
  soft: boolean;
  ground?: 'die' | 'bounce' | 'stick';
  onGround?: (p: Particle) => void;
  orbit?: Orbit;
  distort: boolean;
  distortKind: number;
  fadeIn: number;
  seed: number;
  age: number;
  landed: boolean;
}

export interface TrailSpec {
  /** head first; update() may rewrite them every frame */
  pts: V3[];
  /** width at head, tail */
  width: [number, number];
  color: RGBA;
  /** tail colour (defaults to color with alpha 0) */
  color1?: RGBA;
  intensity: number;
  life: number;
  additive?: boolean;
  material: number;
  /** texture scroll along the trail (m/s) */
  scroll?: number;
  /** fraction of life spent fading out at the end (default 1 = linear) */
  fadeOut?: number;
  distort?: boolean;
  update?: (t: Trail, dt: number) => boolean | void;
}
export interface Trail extends Required<Omit<TrailSpec, 'update' | 'color1' | 'distort'>> {
  color1: RGBA;
  distort: boolean;
  update?: (t: Trail, dt: number) => boolean | void;
  age: number;
  seed: number;
}

const STRIDE = 32; // pos 3f, uv 2f, color 4u8, intensity 1f, params 4u8
const CELLS = 8;
const ATLAS = 1024;

// ------------------------------------------------------------------ procedural sprite atlas
function buildAtlas(size = ATLAS): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const cs = size / CELLS;
  // u, v in [-1, 1]; v = -1 is the TOP of the sprite as it appears in the world
  const put = (cell: number, fn: (u: number, v: number) => [number, number, number, number]) => {
    const ox = (cell % CELLS) * cs, oy = Math.floor(cell / CELLS) * cs;
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const u = ((x + 0.5) / cs) * 2 - 1, v = ((y + 0.5) / cs) * 2 - 1;
      const [r, g, b, a] = fn(u, v);
      const i = ((oy + y) * size + ox + x) * 4;
      px[i] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      px[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      px[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      px[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  };
  const sat = (x: number) => Math.max(0, Math.min(1, x));
  const sstep = (a: number, b: number, x: number) => {
    const t = sat((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const inCell = (u: number, v: number) => (Math.max(Math.abs(u), Math.abs(v)) < 0.985 ? 1 : 0);
  const W: [number, number, number] = [1, 1, 1];
  const A = (a: number, c: [number, number, number] = W): [number, number, number, number] => [c[0], c[1], c[2], a];

  put(FX.glow, (u, v) => { const d = Math.hypot(u, v); return A(Math.exp(-d * d * 4.5) * (d < 1 ? 1 - d * d * d : 0)); });
  put(FX.spark, (u, v) => A(Math.exp(-u * u * 30) * Math.max(0, 1 - Math.abs(v)) ** 1.5));
  put(FX.smoke, (u, v) => {
    const d = Math.hypot(u, v);
    const n = fbm3(u * 2.2 + 3, v * 2.2, 0.5, 4, 2);
    const a = Math.max(0, 1 - d * (1.05 - n * 0.5)) ** 1.6 * (0.55 + n * 0.6);
    return [0.9 + n * 0.1, 0.9 + n * 0.1, 0.9 + n * 0.1, a * inCell(u, v)];
  });
  put(FX.ring, (u, v) => { const d = Math.hypot(u, v); return A(Math.exp(-((d - 0.82) ** 2) * 400)); });
  put(FX.star, (u, v) => {
    const d = Math.hypot(u, v);
    const cross = Math.exp(-Math.abs(u) * 18) * Math.max(0, 1 - Math.abs(v)) + Math.exp(-Math.abs(v) * 18) * Math.max(0, 1 - Math.abs(u));
    return A(Math.min(1, cross * 0.9 + Math.exp(-d * d * 12)));
  });
  put(FX.talisman, (u, v) => {
    const inside = Math.abs(u) < 0.42 && Math.abs(v) < 0.92;
    if (!inside) return [0, 0, 0, 0];
    const border = Math.abs(u) > 0.34 || Math.abs(v) > 0.84;
    const stroke = (Math.abs(u) < 0.06 && Math.abs(v) < 0.6) || (Math.abs(v + 0.3) < 0.05 && Math.abs(u) < 0.25) || (Math.abs(v - 0.2) < 0.05 && Math.abs(u) < 0.2) || Math.abs(Math.hypot(u, v - 0.55) - 0.14) < 0.035;
    if (stroke) return [0.85, 0.12, 0.08, 1];
    return border ? [0.95, 0.72, 0.2, 1] : [1, 0.9, 0.45, 1];
  });
  put(FX.beam, (u) => A(Math.min(1, Math.exp(-u * u * 10) + Math.exp(-u * u * 90) * 0.8)));
  put(FX.fire, (u, v) => {
    const n = fbm3(u * 3, v * 3 + 7, 1.3, 4, 5);
    const d = Math.hypot(u, v * 0.85 + 0.15);
    const a = Math.max(0, 1 - d * (1.2 - n * 0.7)) ** 1.3;
    return [1, 0.75 + n * 0.25, 0.4 + n * 0.3, a];
  });
  put(FX.petal, (u, v) => { const d = Math.hypot(u * 1.8, v); return [1, 0.72, 0.82, d < 0.8 ? 1 - d * 0.3 : 0]; });
  put(FX.debris, (u, v) => { const r = hash2(Math.floor((u + 1) * 3), Math.floor((v + 1) * 3), 4); return [0.35 + r * 0.2, 0.28 + r * 0.15, 0.2, Math.hypot(u, v) < 0.7 ? 1 : 0]; });
  put(FX.shock, (u, v) => { const d = Math.hypot(u, v); return A(Math.exp(-((d - 0.75) ** 2) * 60) * (d < 1 ? 1 : 0)); });
  put(FX.arrow, (u, v) => {
    const shaft = Math.abs(u) < 0.05 && v > -0.9 && v < 0.6;
    const head = v >= 0.6 && v < 0.95 && Math.abs(u) < (0.95 - v) * 0.5;
    const flet = v < -0.6 && v > -0.95 && Math.abs(u) < 0.18;
    if (head) return [0.8, 0.82, 0.85, 1];
    if (flet) return [0.95, 0.95, 0.9, 1];
    return shaft ? [0.5, 0.36, 0.22, 1] : [0, 0, 0, 0];
  });
  put(FX.rune, (u, v) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const ring = Math.exp(-((d - 0.85) ** 2) * 500) + Math.exp(-((d - 0.62) ** 2) * 700);
    const spokes = d > 0.62 && d < 0.85 ? Math.exp(-(Math.sin(ang * 4) ** 2) * 60) * 0.9 : 0;
    const tri = Math.abs(Math.cos(ang * 1.5) * d * 1.6 - 0.45) < 0.03 && d < 0.62 ? 1 : 0;
    return A(Math.min(1, ring + spokes + tri));
  });
  // flame tongue: base at the bottom, licking tip at the top; alpha = density (the shader ramps it)
  put(FX.flame, (u, v) => {
    const y = (1 - v) / 2; // 0 bottom → 1 top
    const n = fbm3(u * 2.5, y * 3.2, 4.1, 3, 11);
    const w = 0.62 * Math.pow(Math.max(0, 1 - y), 0.75) * (1 - Math.exp(-(y + 0.05) * 10)) * (0.85 + 0.3 * n);
    if (w <= 0.001) return [1, 1, 1, 0];
    const x = Math.abs(u + (n - 0.5) * 0.25 * y) / w;
    const dens = sat(1 - x) ** 0.7 * Math.pow(1 - y, 0.35) * sstep(0, 0.12, y + 0.02);
    return A(sat(dens * 1.25));
  });
  put(FX.ember, (u, v) => { const d = Math.hypot(u, v); return A(Math.min(1, Math.exp(-d * d * 60) * 1.2 + Math.exp(-d * d * 7) * 0.35)); });
  put(FX.snowflake, (u, v) => {
    const d = Math.hypot(u, v);
    if (d > 0.97) return [1, 1, 1, 0];
    const a = Math.atan2(v, u);
    const seg = Math.PI / 3;
    let f = ((a % seg) + seg) % seg;
    f = Math.abs(f - seg / 2);
    f = seg / 2 - f; // 0 at an arm
    const x = d * Math.cos(f), y = d * Math.sin(f);
    const t = 0.045;
    let s = x < 0.92 && y < t ? 1 - y / t : 0;
    for (const bx of [0.36, 0.6]) {
      const dx = x - bx;
      if (dx > 0 && dx < 0.24 * (1.1 - bx)) {
        const dist = Math.abs(y - dx * 1.732) / 2;
        if (dist < t * 0.8) s = Math.max(s, 1 - dist / (t * 0.8));
      }
    }
    const hub = Math.exp(-d * d * 60);
    return A(Math.min(1, s * 0.95 + hub));
  });
  // faceted diamond crystal: brightness varies per facet so it reads as cut ice
  put(FX.crystal, (u, v) => {
    const k = Math.abs(u) / 0.42 + Math.abs(v) / 0.95;
    if (k > 1) return [1, 1, 1, 0];
    const facet = (u > 0 ? 1 : 0) + (v > 0 ? 2 : 0);
    const shade = [1, 0.62, 0.8, 0.45][facet] + (1 - k) * 0.35;
    const edge = sstep(1, 0.88, k);
    return [shade, shade, shade, edge];
  });
  put(FX.droplet, (u, v) => {
    const y = v + 0.15;
    const r = y < 0 ? 0.55 * Math.sqrt(Math.max(0, 1 - (y / 0.85) ** 2)) * Math.max(0, 1 + y / 0.85) ** 0.2 : 0.55 * Math.sqrt(Math.max(0, 1 - (y / 0.62) ** 2));
    const x = Math.abs(u);
    if (x > r) return [1, 1, 1, 0];
    const rim = sstep(0.55, 1, x / Math.max(r, 1e-3));
    const hl = Math.exp(-((u + 0.18) ** 2 + (v - 0.05) ** 2) * 60);
    const c = 0.72 + rim * 0.2 + hl * 0.9;
    return [c, c, c, 0.82 + rim * 0.18];
  });
  // splash crown: thin jets fanning up from a base, droplets at the tips
  put(FX.splash, (u, v) => {
    const px = u, py = 0.92 - v; // from base, pointing up
    const r = Math.hypot(px, py);
    const ang = Math.atan2(px, py);
    if (Math.abs(ang) > 1.35) return [1, 1, 1, 0];
    const reach = 1.55 * (1 - Math.abs(ang) / 1.6);
    const jets = Math.pow(Math.cos(ang * 6.5) * 0.5 + 0.5, 14) * sstep(reach, reach * 0.7, r) * sstep(0.05, 0.25, r);
    const tip = Math.exp(-((r - reach * 0.93) ** 2) * 220) * Math.pow(Math.cos(ang * 6.5) * 0.5 + 0.5, 6);
    const base = Math.exp(-(px * px * 2.2 + (py - 0.08) ** 2 * 30));
    return A(sat(jets * 0.9 + tip * 1.1 + base * 0.8));
  });
  put(FX.foam, (u, v) => {
    let a = 0;
    for (let i = 0; i < 9; i++) {
      const cx = (hash2(i, 1, 3) - 0.5) * 1.1, cy = (hash2(i, 2, 3) - 0.5) * 1.1, rr = 0.16 + hash2(i, 3, 3) * 0.2;
      const d = Math.hypot(u - cx, v - cy) / rr;
      if (d < 1) a = Math.max(a, 0.55 + 0.45 * sstep(0.6, 0.95, d));
    }
    return A(a * sstep(1, 0.75, Math.hypot(u, v)));
  });
  put(FX.ripple, (u, v) => { const d = Math.hypot(u, v); return A(Math.exp(-((d - 0.86) ** 2) * 900) + 0.55 * Math.exp(-((d - 0.62) ** 2) * 1100)); });
  put(FX.leaf, (u, v) => {
    const y = (v + 1) / 2;
    const w = 0.4 * Math.sin(Math.PI * Math.min(1, y * 1.05)) ** 0.8;
    const x = Math.abs(u);
    if (x > w || y > 0.97) return [1, 1, 1, 0];
    const rib = Math.exp(-u * u * 900) * 0.35;
    const vein = Math.exp(-((x - (y - 0.3) * 0.6) ** 2) * 700) * 0.15 * (y > 0.3 ? 1 : 0);
    const c = 0.92 - rib - vein + (1 - x / w) * 0.08;
    return [c, c, c, sstep(w, w * 0.8, x)];
  });
  put(FX.streak, (u, v) => A(Math.exp(-v * v * 260) * sstep(1, 0.2, Math.abs(u)) * (0.6 + 0.4 * (1 - Math.abs(u)))));
  // air blade: a crescent, thick in the middle and tapering to sharp horns
  put(FX.crescent, (u, v) => {
    const px = u, py = v + 0.45;
    const d = Math.hypot(px, py);
    const ang = Math.atan2(px, -py); // 0 = straight up
    if (Math.abs(ang) > 1.35) return [1, 1, 1, 0];
    const thick = 0.17 * Math.cos((ang / 1.35) * (Math.PI / 2)) ** 0.8;
    const edge = Math.abs(d - 0.95);
    const a = sstep(thick, thick * 0.35, edge);
    const bright = 0.6 + 0.4 * sstep(0.95 + thick, 0.95, d); // leading edge brighter
    return [bright, bright, bright, a];
  });
  put(FX.wisp, (u, v) => {
    const cx = 0.33 * Math.sin(v * 3.2) * (1 - Math.abs(v) * 0.3);
    const d = Math.abs(u - cx);
    const w = 0.12 + 0.12 * (1 - Math.abs(v));
    return A(sstep(w, 0, d) * sstep(1, 0.6, Math.abs(v)) * 0.9);
  });
  put(FX.swirl, (u, v) => {
    const d = Math.hypot(u, v);
    if (d > 0.98) return [1, 1, 1, 0];
    const a = Math.atan2(v, u);
    const arms = Math.pow(Math.cos(3 * (a - Math.log(d + 0.05) * 2.2)) * 0.5 + 0.5, 5);
    return A(arms * sstep(0.98, 0.5, d) * sstep(0.02, 0.2, d));
  });
  put(FX.steam, (u, v) => {
    const d = Math.hypot(u, v);
    const n = fbm3(u * 1.6 + 9, v * 1.6, 2.2, 3, 8);
    return A(Math.max(0, 1 - d * (1.1 - n * 0.4)) ** 2 * (0.5 + 0.5 * n) * inCell(u, v));
  });
  // ice fragment: an irregular sharp quad with bright and dark facets
  put(FX.shard, (u, v) => {
    const P: [number, number][] = [[0.05, -0.95], [0.55, -0.1], [0.12, 0.9], [-0.42, 0.25]];
    let inside = true;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = P[i], [bx, by] = P[(i + 1) % 4];
      if ((bx - ax) * (v - ay) - (by - ay) * (u - ax) < 0) inside = false;
    }
    if (!inside) return [1, 1, 1, 0];
    const facet = u * 0.8 - v * 0.3 > 0 ? 1 : 0.55;
    return [facet, facet, facet, 0.95];
  });
  put(FX.frostburst, (u, v) => {
    const d = Math.hypot(u, v);
    if (d > 0.99) return [1, 1, 1, 0];
    const a = Math.atan2(v, u);
    let s = 0;
    for (let i = 0; i < 14; i++) {
      const ra = (i / 14) * Math.PI * 2 + hash2(i, 5, 2) * 0.3;
      const len = 0.45 + hash2(i, 7, 2) * 0.5;
      let da = Math.abs(a - ra);
      da = Math.min(da, Math.PI * 2 - da);
      const w = 0.07 * (1 - d / len);
      if (d < len && da * d < w) s = Math.max(s, 1 - (da * d) / w);
    }
    return A(Math.min(1, s + Math.exp(-d * d * 18) * 0.6));
  });
  // Qi talisman burst: a ring of glyph strokes
  put(FX.glyphring, (u, v) => {
    const d = Math.hypot(u, v);
    const a = Math.atan2(v, u);
    const ring = Math.exp(-((d - 0.92) ** 2) * 1500);
    const k = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12);
    const la = ((a + Math.PI) / (Math.PI * 2)) * 12 - k - 0.5;
    const r = d - 0.72;
    let g = 0;
    if (Math.abs(r) < 0.1 && Math.abs(la) < 0.32) {
      const h = hash2(k, 1, 9);
      const lx = la / 0.32, ly = r / 0.1;
      g = Math.abs(lx) < 0.14 || Math.abs(ly - (h - 0.5)) < 0.18 || (h > 0.5 && Math.abs(lx + ly) < 0.16) ? 1 : 0;
    }
    return A(Math.min(1, ring + g));
  });
  put(FX.dust, (u, v) => {
    const d = Math.hypot(u, v);
    const n = fbm3(u * 3 + 1, v * 3, 7.7, 4, 3);
    return A(Math.max(0, 1 - d * (1.25 - n * 0.8)) ** 1.4 * (0.6 + 0.4 * n) * inCell(u, v));
  });
  put(FX.cloud, (u, v) => {
    let a = 0;
    for (let i = 0; i < 7; i++) {
      const cx = (hash2(i, 11, 5) - 0.5) * 1.1, cy = (hash2(i, 12, 5) - 0.5) * 0.6 + 0.1, rr = 0.28 + hash2(i, 13, 5) * 0.25;
      a = Math.max(a, Math.exp(-((u - cx) ** 2 + (v - cy) ** 2) / (rr * rr) * 2.2));
    }
    const n = fbm3(u * 3, v * 3, 3.3, 3, 6);
    const shade = 0.7 + 0.3 * sat(-v + 0.4) + n * 0.15; // lit from above
    return [shade, shade, shade, sat(a * (0.7 + n * 0.5)) * inCell(u, v)];
  });
  put(FX.arc, (u, v) => {
    let y = 0, s = 0;
    for (let i = 1; i <= 5; i++) y += (hash2(Math.floor((u + 1) * 3 * i), i, 17) - 0.5) * (0.5 / i);
    const d = Math.abs(v - y * sstep(1, 0.6, Math.abs(u)));
    s = Math.exp(-d * d * 600) + Math.exp(-d * d * 40) * 0.3;
    return A(Math.min(1, s) * sstep(1, 0.8, Math.abs(u)));
  });
  return px;
}

// ------------------------------------------------------------------ system
export class ParticleSystem {
  particles: Particle[] = [];
  trails: Trail[] = [];
  private pending: (ParticleSpec & { delay: number })[] = [];
  private atlas: Texture;
  private sampler: Sampler;
  private pAlpha: Pipeline;
  private pAdd: Pipeline;
  private pDistort: Pipeline;
  private buf: Buffer;
  private dbuf: Buffer;
  private cap = 8192 * 6;
  private data = new ArrayBuffer(this.cap * STRIDE);
  private f32 = new Float32Array(this.data);
  private u8 = new Uint8Array(this.data);
  private dcap = 2048 * 6;
  private ddata = new ArrayBuffer(this.dcap * STRIDE);
  private nAlpha = 0;
  private nAdd = 0;
  private nDist = 0;
  maxParticles = 9000;
  time = 0;
  /** terrain height for ground collision (set by the game) */
  heightAt: (x: number, z: number) => number = () => -1e9;

  constructor(private device: Device, renderer: Renderer) {
    this.atlas = device.createTexture({ width: ATLAS, height: ATLAS, format: 'rgba8unorm', data: buildAtlas(ATLAS), mipmaps: true, label: 'fx-atlas' });
    this.sampler = device.createSampler({ filter: 'linear', mipmaps: true, wrap: 'clamp' });
    const layout = {
      arrayStride: STRIDE,
      attributes: [
        { location: 0, format: 'float32x3' as const, offset: 0 },
        { location: 1, format: 'float32x2' as const, offset: 12 },
        { location: 2, format: 'unorm8x4' as const, offset: 20 },
        { location: 3, format: 'float32' as const, offset: 24 },
        { location: 4, format: 'unorm8x4' as const, offset: 28 },
      ],
    };
    const groups = [
      { entries: [{ binding: 0, kind: 'uniform' as const, name: 'FrameUniforms' }] },
      { entries: [{ binding: 0, kind: 'texture' as const, name: 'uAtlas' }, { binding: 1, kind: 'texture' as const, name: 'uHeight' }] },
    ];
    const desc = (additive: boolean) => ({
      label: additive ? 'particles-add' : 'particles-alpha',
      shader: { label: 'particles', vertex: SHADERS.particleVert, fragment: SHADERS.particleFrag, defines: { ADDITIVE: additive } as Record<string, boolean> },
      vertexBuffers: [layout],
      bindGroups: groups,
      colorFormats: [renderer.hdrColorFormat],
      depthFormat: 'depth24' as const,
      sampleCount: renderer.sampleCount,
      blend: 'premultiplied' as const,
      depthWrite: false,
      depthCompare: 'lequal' as const,
      cullMode: 'none' as const,
    });
    this.pAlpha = device.createPipeline(desc(false));
    this.pAdd = device.createPipeline(desc(true));
    this.pDistort = device.createPipeline({
      label: 'particles-distort',
      shader: { label: 'particles-distort', vertex: SHADERS.particleVert, fragment: SHADERS.particleFrag, defines: { DISTORT: true } as Record<string, boolean> },
      vertexBuffers: [layout],
      bindGroups: groups,
      colorFormats: [renderer.hdrColorFormat],
      blend: 'additive',
      depthTest: false,
      depthWrite: false,
      cullMode: 'none',
    });
    this.buf = device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'particles' });
    this.dbuf = device.createBuffer({ size: this.ddata.byteLength, usage: 'vertex', dynamic: true, label: 'particles-distort' });
  }

  spawn(s: ParticleSpec): Particle | null {
    if (s.delay && s.delay > 0) {
      this.pending.push({ ...s, delay: s.delay });
      return null;
    }
    if (this.particles.length >= this.maxParticles) return null;
    const p: Particle = {
      pos: [...s.pos] as V3,
      vel: s.vel ? ([...s.vel] as V3) : [0, 0, 0],
      life: s.life,
      size: s.size,
      color: s.color,
      color1: s.color1 ?? [s.color[0], s.color[1], s.color[2], 0],
      intensity: s.intensity ?? [1, 1],
      cell: s.cell,
      additive: s.additive ?? false,
      gravity: s.gravity ?? 0,
      drag: s.drag ?? 0,
      rot: s.rot ?? 0,
      vrot: s.vrot ?? 0,
      stretch: s.stretch ?? 0,
      flat: s.flat ?? false,
      mode: s.mode ?? 0,
      aspect: s.aspect ?? 1,
      soft: s.soft ?? !s.flat,
      ground: s.ground,
      onGround: s.onGround,
      orbit: s.orbit ? { ...s.orbit } : undefined,
      distort: s.distort ?? false,
      distortKind: s.distortKind ?? 0,
      fadeIn: s.fadeIn ?? 0.08,
      seed: Math.random(),
      age: 0,
      landed: false,
    };
    if (p.orbit) this.placeOrbit(p, 0);
    this.particles.push(p);
    return p;
  }
  /** Legacy straight ribbon (lightning). */
  ribbon(pts: V3[], width: number, color: [number, number, number], intensity: number, life: number, additive = true) {
    this.trail({ pts, width: [width, width], color: [color[0], color[1], color[2], 1], color1: [color[0], color[1], color[2], 1], intensity, life, additive, material: TRAIL.beam });
  }
  trail(s: TrailSpec): Trail {
    const t: Trail = {
      pts: s.pts,
      width: s.width,
      color: s.color,
      color1: s.color1 ?? [s.color[0], s.color[1], s.color[2], 0],
      intensity: s.intensity,
      life: s.life,
      additive: s.additive ?? true,
      material: s.material,
      scroll: s.scroll ?? 0,
      fadeOut: s.fadeOut ?? 1,
      distort: s.distort ?? false,
      update: s.update,
      age: 0,
      seed: Math.random(),
    };
    this.trails.push(t);
    return t;
  }
  get count() {
    return this.particles.length;
  }

  private placeOrbit(p: Particle, dt: number) {
    const o = p.orbit!;
    o.a += o.w * dt;
    o.r = Math.max(0, o.r + (o.dr ?? 0) * dt);
    o.h += (o.lift ?? 0) * dt;
    const nx = o.anchor.pos[0] + Math.cos(o.a) * o.r, ny = o.anchor.pos[1] + o.h, nz = o.anchor.pos[2] + Math.sin(o.a) * o.r;
    if (dt > 0) p.vel = [(nx - p.pos[0]) / dt, (ny - p.pos[1]) / dt, (nz - p.pos[2]) / dt];
    p.pos = [nx, ny, nz];
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.pending.splice(i, 1);
        this.spawn({ ...p, delay: 0 });
      }
    }
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.orbit) {
        this.placeOrbit(p, dt);
      } else if (!p.landed) {
        const damp = Math.max(0, 1 - p.drag * dt);
        p.vel[0] *= damp;
        p.vel[1] = p.vel[1] * damp - p.gravity * dt;
        p.vel[2] *= damp;
        p.pos[0] += p.vel[0] * dt;
        p.pos[1] += p.vel[1] * dt;
        p.pos[2] += p.vel[2] * dt;
        if (p.ground && p.vel[1] < 0) {
          const gy = this.heightAt(p.pos[0], p.pos[2]) + p.size[0] * 0.3;
          if (p.pos[1] <= gy) {
            p.pos[1] = gy;
            p.onGround?.(p);
            if (p.ground === 'die') continue;
            if (p.ground === 'bounce' && -p.vel[1] > 1.2) {
              p.vel[1] = -p.vel[1] * 0.35;
              p.vel[0] *= 0.55;
              p.vel[2] *= 0.55;
              p.vrot *= 0.5;
            } else {
              p.landed = true;
              p.vel = [0, 0, 0];
              p.vrot = 0;
            }
          }
        }
      }
      p.rot += p.vrot * dt;
      ps[w++] = p;
    }
    ps.length = w;
    this.trails = this.trails.filter((t) => {
      t.age += dt;
      if (t.age >= t.life) return false;
      if (t.update && t.update(t, dt) === false) return false;
      return true;
    });
  }

  /** Build vertex data for this frame from the camera's view matrix. */
  build(view: M4) {
    const rx = view[0], ry = view[4], rz = view[8];
    const ux = view[1], uy = view[5], uz = view[9];
    const fx = -view[2], fy = -view[6], fz = -view[10];
    const alpha: Particle[] = [], add: Particle[] = [], dist: Particle[] = [];
    for (const p of this.particles) (p.distort ? dist : p.additive ? add : alpha).push(p);
    let trailVerts = 0;
    for (const t of this.trails) trailVerts += Math.max(0, t.pts.length - 1) * 6;
    const need = (alpha.length + add.length) * 6 + trailVerts;
    if (need > this.cap) this.grow(need);
    const dneed = dist.length * 6 + trailVerts;
    if (dneed > this.dcap) {
      while (this.dcap < dneed) this.dcap *= 2;
      this.ddata = new ArrayBuffer(this.dcap * STRIDE);
      this.dbuf.destroy();
      this.dbuf = this.device.createBuffer({ size: this.ddata.byteLength, usage: 'vertex', dynamic: true, label: 'particles-distort' });
    }
    let f32 = this.f32, u8 = this.u8;
    let n = 0;
    const put = (c: V3, uu: number, vv: number, col: RGBA, inten: number, p0: number, p1: number, p2: number) => {
      const o = n * 8;
      f32[o] = c[0];
      f32[o + 1] = c[1];
      f32[o + 2] = c[2];
      f32[o + 3] = uu;
      f32[o + 4] = vv;
      const b = n * STRIDE + 20;
      u8[b] = Math.round(Math.max(0, Math.min(1, col[0])) * 255);
      u8[b + 1] = Math.round(Math.max(0, Math.min(1, col[1])) * 255);
      u8[b + 2] = Math.round(Math.max(0, Math.min(1, col[2])) * 255);
      u8[b + 3] = Math.round(Math.max(0, Math.min(1, col[3])) * 255);
      f32[o + 6] = inten;
      const q = n * STRIDE + 28;
      u8[q] = p0;
      u8[q + 1] = p1;
      u8[q + 2] = p2;
      u8[q + 3] = 0;
      n++;
    };
    const cellUV = (cell: number) => {
      const s = 1 / CELLS, u0 = (cell % CELLS) * s, v0 = Math.floor(cell / CELLS) * s, pad = 0.5 / ATLAS;
      return [u0 + pad, v0 + pad, u0 + s - pad, v0 + s - pad];
    };
    // params byte 0: mode (4 bits) | soft (bit 4) | local u (bit 5) | local v (bit 6)
    const LU = [0, 1, 1, 0], LV = [0, 0, 1, 1];
    const emitParticle = (p: Particle) => {
      const t = p.age / p.life;
      const size = p.size[0] + (p.size[1] - p.size[0]) * t;
      const c0 = p.color, c1 = p.color1;
      const col: RGBA = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t];
      col[3] *= Math.min(1, t / Math.max(1e-3, p.fadeIn) + (p.additive ? 0.6 : 0));
      const inten = p.intensity[0] + (p.intensity[1] - p.intensity[0]) * t;
      const [u0, v0, u1, v1] = cellUV(p.cell);
      const uv = [u0, v1, u1, v1, u1, v0, u0, v0];
      const P = p.pos;
      let ax: V3, ay: V3;
      const wide = size * p.aspect;
      if (p.flat) {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        ax = [c * wide, 0, s * wide];
        ay = [-s * size, 0, c * size];
      } else if (p.stretch > 0) {
        const v = p.vel;
        const vd = v[0] * fx + v[1] * fy + v[2] * fz;
        let sx = v[0] - fx * vd, sy = v[1] - fy * vd, sz = v[2] - fz * vd;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const speed = Math.hypot(v[0], v[1], v[2]);
        sx /= sl; sy /= sl; sz /= sl;
        const len = size * (1 + speed * p.stretch);
        const wx = sy * fz - sz * fy, wy = sz * fx - sx * fz, wz = sx * fy - sy * fx;
        ay = [sx * len, sy * len, sz * len];
        ax = [wx * wide * 0.35, wy * wide * 0.35, wz * wide * 0.35];
      } else {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        ax = [(rx * c + ux * s) * wide, (ry * c + uy * s) * wide, (rz * c + uz * s) * wide];
        ay = [(-rx * s + ux * c) * size, (-ry * s + uy * c) * size, (-rz * s + uz * c) * size];
      }
      const corners: V3[] = [
        [P[0] - ax[0] - ay[0], P[1] - ax[1] - ay[1], P[2] - ax[2] - ay[2]],
        [P[0] + ax[0] - ay[0], P[1] + ax[1] - ay[1], P[2] + ax[2] - ay[2]],
        [P[0] + ax[0] + ay[0], P[1] + ax[1] + ay[1], P[2] + ax[2] + ay[2]],
        [P[0] - ax[0] + ay[0], P[1] - ax[1] + ay[1], P[2] - ax[2] + ay[2]],
      ];
      const mode = (p.distort ? p.distortKind : p.mode) & 15;
      const age = Math.round(t * 255), seed = Math.round(p.seed * 255);
      for (const k of [0, 1, 2, 0, 2, 3]) put(corners[k], uv[k * 2], uv[k * 2 + 1], col, inten, mode | (p.soft ? 16 : 0) | (LU[k] << 5) | (LV[k] << 6), age, seed);
    };
    const emitTrail = (tr: Trail) => {
      const pts = tr.pts;
      if (pts.length < 2) return;
      const lifeT = tr.age / tr.life;
      const fo = tr.fadeOut;
      const fade = lifeT < 1 - fo ? 1 : Math.max(0, (1 - lifeT) / fo);
      // cumulative length for the along-coordinate
      const along = [0];
      for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      const total = along[pts.length - 1] || 1;
      const sides: V3[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        let sx = dy * fz - dz * fy, sy = dz * fx - dx * fz, sz = dx * fy - dy * fx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const f = along[i] / total;
        const w = (tr.width[0] + (tr.width[1] - tr.width[0]) * f) * 0.5;
        sides.push([(sx / sl) * w, (sy / sl) * w, (sz / sl) * w]);
      }
      const scroll = tr.age * tr.scroll;
      const seed = Math.round(tr.seed * 255);
      const colAt = (i: number): RGBA => {
        const f = along[i] / total;
        const c0 = tr.color, c1 = tr.color1;
        return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f, (c0[3] + (c1[3] - c0[3]) * f) * fade];
      };
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], sa = sides[i], sb = sides[i + 1];
        const ca = colAt(i), cb = colAt(i + 1);
        const va = along[i] - scroll, vb = along[i + 1] - scroll;
        // along-fraction in the age byte so materials can taper toward the tail
        const fa = Math.round((along[i] / total) * 255), fb = Math.round((along[i + 1] / total) * 255);
        const q: [V3, number, number, RGBA, number][] = [
          [[a[0] - sa[0], a[1] - sa[1], a[2] - sa[2]], 0, va, ca, fa],
          [[a[0] + sa[0], a[1] + sa[1], a[2] + sa[2]], 1, va, ca, fa],
          [[b[0] + sb[0], b[1] + sb[1], b[2] + sb[2]], 1, vb, cb, fb],
          [[b[0] - sb[0], b[1] - sb[1], b[2] - sb[2]], 0, vb, cb, fb],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) put(q[k][0], q[k][1], q[k][2], q[k][3], tr.intensity, tr.material, q[k][4], seed);
      }
    };
    for (const p of alpha) emitParticle(p);
    for (const t of this.trails) if (!t.additive && !t.distort) emitTrail(t);
    this.nAlpha = n;
    for (const p of add) emitParticle(p);
    for (const t of this.trails) if (t.additive && !t.distort) emitTrail(t);
    this.nAdd = n - this.nAlpha;
    // distortion batch in its own buffer
    const keep = n;
    f32 = new Float32Array(this.ddata);
    u8 = new Uint8Array(this.ddata);
    n = 0;
    for (const p of dist) emitParticle(p);
    for (const t of this.trails) if (t.distort) emitTrail(t);
    this.nDist = n;
    n = keep;
  }
  private grow(need: number) {
    while (this.cap < need) this.cap *= 2;
    this.data = new ArrayBuffer(this.cap * STRIDE);
    this.f32 = new Float32Array(this.data);
    this.u8 = new Uint8Array(this.data);
    this.buf.destroy();
    this.buf = this.device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'particles' });
  }

  private group(p: Pipeline, env: FxEnv): BindGroup {
    return this.device.createBindGroup(p, 1, [
      { binding: 0, texture: this.atlas, sampler: this.sampler },
      { binding: 1, texture: env.height, sampler: this.sampler },
    ]);
  }

  draw(pass: RenderPass, frameGroup: BindGroup, env: FxEnv) {
    const total = this.nAlpha + this.nAdd;
    if (!total) return;
    this.device.writeBuffer(this.buf, 0, new Uint8Array(this.data, 0, total * STRIDE));
    pass.setVertexBuffer(0, this.buf);
    if (this.nAlpha) {
      pass.setPipeline(this.pAlpha);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, this.group(this.pAlpha, env));
      pass.draw(this.nAlpha, 1, 0);
    }
    if (this.nAdd) {
      pass.setPipeline(this.pAdd);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, this.group(this.pAdd, env));
      pass.draw(this.nAdd, 1, this.nAlpha);
    }
  }
  drawDistortion(pass: RenderPass, frameGroup: BindGroup, env: FxEnv): boolean {
    if (!this.nDist) return false;
    this.device.writeBuffer(this.dbuf, 0, new Uint8Array(this.ddata, 0, this.nDist * STRIDE));
    pass.setVertexBuffer(0, this.dbuf);
    pass.setPipeline(this.pDistort);
    pass.setBindGroup(0, frameGroup);
    pass.setBindGroup(1, this.group(this.pDistort, env));
    pass.draw(this.nDist, 1, 0);
    return true;
  }
}
