// Material painters: cloth, leather, metal, lamellar, wood, straw, hair, skin, fur, lacquer.
//
// Each returns a Painter (paint.ts). Styling follows the "remastered RTS" brief: readable at a
// distance first (clear value structure, strong team colour, bright edges on metal, dark
// cavities), fine detail second (weave, grain, stitching, scratches) for close-ups.

import type { V3 } from '../../../src/core/math';
import { fbm3, noise3 } from '../../../src/core/math';
import { Painter, PaintIn, PaintOut, lin } from './paint';

export const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const lum = (c: V3) => c[0] * 0.3 + c[1] * 0.55 + c[2] * 0.15;
const desat = (c: V3, k: number): V3 => mix3(c, [lum(c), lum(c), lum(c)], k);

/** Distance (m) to a garment's hem/cuff/neckline; defaults to the piece's open edges. */
export type HemFn = (p: V3, i: PaintIn) => number;
const defaultHem: HemFn = (_p, i) => i.edge;

/** Coordinate along a band (m), for repeating trim patterns. Default: around the vertical axis. */
export type AlongFn = (p: V3) => number;
const aroundY: AlongFn = (p) => Math.atan2(p[0], p[2]) * 0.16;

export interface Band {
  /** distance from the hem where the band starts / ends (m) */
  from: number;
  to: number;
  color: number;
  team?: number;
  /** repeating motif inside the band */
  motif?: 'plain' | 'meander' | 'cloud' | 'dots' | 'wave' | 'stitch';
  motifColor?: number;
  /** motif scale (m per repeat) */
  scale?: number;
}

/** Repeating Chinese border motifs in band space (u along, v 0..1 across). Returns 0..1 ink. */
export function motifInk(motif: Band['motif'], u: number, v: number, aa: number): number {
  const fr = (x: number) => x - Math.floor(x);
  const line = (d: number, w: number) => 1 - sstep(w - aa, w + aa, Math.abs(d));
  switch (motif) {
    case 'meander': {
      // 回纹: a square spiral key pattern
      const x = fr(u), y = v;
      const cx = Math.abs(x - 0.5), cy = Math.abs(y - 0.5);
      const ring = Math.max(cx, cy);
      const s = line(ring - 0.36, 0.05) + line(ring - 0.18, 0.05) * (x < 0.5 || y > 0.4 ? 1 : 0);
      const bar = line(y - 0.08, 0.04) + line(y - 0.92, 0.04);
      return sat(s + bar);
    }
    case 'cloud': {
      // 云纹: rows of curls
      const x = fr(u) - 0.5, y = v - 0.5;
      const r = Math.hypot(x, y * 0.9);
      const ang = Math.atan2(y, x);
      const spiral = line(fr(r * 3.2 - ang / (Math.PI * 2)) - 0.5, 0.12) * (1 - sstep(0.42, 0.5, r));
      return sat(spiral + line(v - 0.06, 0.04) + line(v - 0.94, 0.04));
    }
    case 'dots':
      return 1 - sstep(0.18 - aa, 0.18 + aa, Math.hypot(fr(u) - 0.5, v - 0.5));
    case 'wave': {
      const y = v - 0.5 - Math.sin(u * Math.PI * 2) * 0.25;
      return line(y, 0.1);
    }
    case 'stitch': {
      const dash = fr(u * 1) < 0.6 ? 1 : 0;
      return line(v - 0.5, 0.12) * dash;
    }
    default:
      return 0;
  }
}

function applyBands(bands: Band[] | undefined, hem: number, along: number, i: PaintIn, o: PaintOut, base: V3) {
  if (!bands) return base;
  let c = base;
  for (const b of bands) {
    const aa = i.texel * 1.2;
    const inside = sstep(b.from - aa, b.from + aa, hem) * (1 - sstep(b.to - aa, b.to + aa, hem));
    if (inside <= 0) continue;
    let bc = lin(b.color);
    if (b.motif && b.motif !== 'plain') {
      const sc = b.scale ?? (b.to - b.from);
      const v = (hem - b.from) / (b.to - b.from);
      const ink = motifInk(b.motif, along / sc, v, (aa / (b.to - b.from)) * 1.5);
      bc = mix3(bc, lin(b.motifColor ?? 0xd8b25a), ink);
      o.height += ink * 0.0003;
    }
    c = mix3(c, bc, inside);
    o.team = Math.max(o.team * (1 - inside), (b.team ?? 0) * inside);
    // a slight ridge where a band is sewn on
    o.height += inside * 0.0004;
  }
  return c;
}

// ------------------------------------------------------------------ cloth
export interface ClothOpts {
  color: number;
  team?: number;
  bands?: Band[];
  hem?: HemFn;
  along?: AlongFn;
  /** darker, dustier towards the ground (m above which it fades out) */
  dirt?: number;
  /** thread scale (m); 0 = no visible weave */
  weave?: number;
  rough?: number;
  /** silk sheen: lower roughness, stronger value contrast */
  silk?: boolean;
}
export function cloth(op: ClothOpts): Painter {
  const base = lin(op.color);
  const hemFn = op.hem ?? defaultHem;
  const along = op.along ?? aroundY;
  const weave = op.weave ?? 0.0016;
  const dirtH = op.dirt ?? 0.45;
  return (i, o) => {
    const [x, y, z] = i.p;
    let c = base;
    // broad dye variation and sun fading on up-facing folds
    const big = fbm3(x * 6, y * 6, z * 6, 3, 31) - 0.5;
    c = mul3(c, 1 + big * 0.16);
    c = mix3(c, desat(mul3(c, 1.18), 0.25), sat(i.n[1]) * 0.18);
    // weave: fine crossing threads (height + value)
    if (weave > 0) {
      const k = (Math.PI * 2) / weave;
      const wv = Math.sin(x * k + z * k * 0.7) * Math.sin(y * k * 1.1);
      o.height += wv * 0.00006;
      c = mul3(c, 1 + wv * 0.035);
    }
    // slubs / thread irregularity
    const slub = noise3(x * 420, y * 60, z * 420, 33) - 0.5;
    c = mul3(c, 1 + slub * 0.05);
    // dirt near the ground
    if (dirtH > 0) {
      // dust: greys and warms the dye a little, most at the very bottom
      const d = (1 - sstep(0.02, dirtH, y)) * (0.6 + 0.4 * (noise3(x * 40, y * 40, z * 40, 35)));
      const dust = mix3(desat(c, 0.6), mix3(c, lin(0x8a7358), 0.5), 0.5);
      c = mix3(c, dust, d * 0.35);
    }
    o.team = op.team ?? 0;
    const hem = hemFn(i.p, i);
    c = applyBands(op.bands, hem, along(i.p), i, o, c);
    // edges wear lighter
    c = mix3(c, mul3(desat(c, 0.3), 1.15), (1 - sstep(0, 0.006, hem)) * 0.25);
    o.albedo = c;
    o.rough = (op.rough ?? (op.silk ? 0.45 : 0.85)) + big * 0.08;
    o.metal = 0;
  };
}

// ------------------------------------------------------------------ leather
export interface LeatherOpts {
  color: number;
  /** stitching this far in from the edges (m); 0 = none */
  stitch?: number;
  stitchColor?: number;
  hem?: HemFn;
  along?: AlongFn;
  team?: number;
}
export function leather(op: LeatherOpts): Painter {
  const base = lin(op.color);
  const hemFn = op.hem ?? defaultHem;
  const along = op.along ?? aroundY;
  const sc = lin(op.stitchColor ?? 0xd2c29a);
  return (i, o) => {
    const [x, y, z] = i.p;
    const grain = fbm3(x * 900, y * 900, z * 900, 2, 41);
    const blot = fbm3(x * 25, y * 25, z * 25, 3, 43) - 0.5;
    let c = mul3(base, 1 + blot * 0.3 + (grain - 0.5) * 0.08);
    o.height += (grain - 0.5) * 0.00012;
    const hem = hemFn(i.p, i);
    // worn, lighter edges
    c = mix3(c, mul3(desat(c, 0.2), 1.45), (1 - sstep(0.0, 0.01, hem)) * 0.5);
    if (op.stitch) {
      const u = along(i.p) / 0.006;
      const ink = motifInk('stitch', u, (hem - op.stitch + 0.0015) / 0.003, i.texel / 0.003);
      c = mix3(c, sc, ink * 0.9);
      o.height += ink * 0.0002 - (1 - sstep(0, 0.002, Math.abs(hem - op.stitch))) * 0.0002;
    }
    o.albedo = c;
    o.rough = 0.55 + blot * 0.2;
    o.metal = 0;
    o.team = op.team ?? 0;
  };
}

// ------------------------------------------------------------------ metal
export interface MetalOpts {
  color: number;
  /** 0 clean … 1 battered */
  wear?: number;
  hem?: HemFn;
  /** brushed direction: 'y' (vertical strokes) or 'around' */
  brush?: 'y' | 'around';
  team?: number;
  rough?: number;
  /** rivets: points (model space) and radius */
  rivets?: { at: V3[]; r: number };
}
export function metal(op: MetalOpts): Painter {
  const base = lin(op.color);
  const wear = op.wear ?? 0.4;
  const hemFn = op.hem ?? defaultHem;
  return (i, o) => {
    const [x, y, z] = i.p;
    const brush = op.brush === 'around' ? noise3(y * 3000, Math.atan2(x, z) * 20, 0, 51) : noise3(x * 3000, y * 40, z * 3000, 51);
    const blot = fbm3(x * 18, y * 18, z * 18, 3, 53) - 0.5;
    let c = mul3(base, 1 + blot * 0.25 * wear + (brush - 0.5) * 0.06);
    let rough = (op.rough ?? 0.32) + (brush - 0.5) * 0.08 + blot * 0.15 * wear;
    // scratches: thin random strokes
    const s = noise3(x * 300 + y * 900, y * 300 - z * 900, z * 300, 57);
    const scratch = sstep(0.93, 0.97, s) * wear;
    c = mix3(c, mul3(c, 1.45), scratch * 0.5);
    rough -= scratch * 0.1;
    // bright worn edges, grime in low areas
    const hem = hemFn(i.p, i);
    const edge = 1 - sstep(0, 0.006, hem);
    c = mix3(c, mul3(c, 1.5), edge * (0.3 + 0.4 * wear));
    const grime = sstep(0.1, 0.35, blot) * wear;
    c = mix3(c, mul3(desat(c, 0.6), 0.55), grime * 0.4);
    rough += grime * 0.25;
    if (op.rivets) {
      for (const r of op.rivets.at) {
        const d = Math.hypot(x - r[0], y - r[1], z - r[2]);
        if (d < op.rivets.r * 1.6) {
          const k = 1 - sstep(op.rivets.r * 0.8, op.rivets.r, d);
          o.height += Math.sqrt(Math.max(0, 1 - (d / op.rivets.r) ** 2)) * op.rivets.r * 0.5 * k;
          c = mix3(c, mul3(c, 1.3), k * 0.5);
          const ring = (1 - sstep(op.rivets.r, op.rivets.r * 1.5, d)) * sstep(op.rivets.r * 0.9, op.rivets.r, d);
          c = mul3(c, 1 - ring * 0.5);
        }
      }
    }
    o.albedo = c;
    o.rough = sat(rough);
    o.metal = 1;
    o.team = op.team ?? 0;
  };
}

// ------------------------------------------------------------------ lamellar armour
export interface LamellarOpts {
  /** plate colour (lacquer / steel) */
  plate: number;
  /** lacing cord colour */
  lace: number;
  /** team-colour on the plates (lacquer) and on the lacing */
  plateTeam?: number;
  laceTeam?: number;
  plateMetal?: number;
  rowH?: number;
  plateW?: number;
  /** leather binding along the edges */
  trim?: { width: number; color: number };
  hem?: HemFn;
  along?: AlongFn;
}
export function lamellar(op: LamellarOpts): Painter {
  const plate = lin(op.plate), lace = lin(op.lace);
  const rowH = op.rowH ?? 0.04, plateW = op.plateW ?? 0.026;
  const hemFn = op.hem ?? defaultHem;
  const along = op.along ?? ((p: V3) => Math.atan2(p[0], p[2]) * 0.2);
  const trimC = op.trim ? lin(op.trim.color) : plate;
  return (i, o) => {
    const [x, y, z] = i.p;
    const u = along(i.p) / plateW, v = y / rowH;
    const row = Math.floor(v);
    const uu = u + (row % 2 ? 0.5 : 0);
    const fu = uu - Math.floor(uu), fv = v - row;
    // each plate: rounded top, overlapping the one below; lacing holes along its middle
    const edgeU = Math.min(fu, 1 - fu) * plateW, edgeV = fv * rowH;
    const bevel = sstep(0, 0.003, edgeU) * sstep(0, 0.004, edgeV);
    const top = 1 - sstep(rowH - 0.004, rowH, edgeV);
    const h = bevel * (0.6 + 0.4 * top) + (1 - fv) * 0.4;
    o.height += h * 0.0022;
    const id = noise3(row * 13.1, Math.floor(uu) * 7.7, 0, 61);
    let c = mul3(plate, 0.85 + id * 0.3);
    // bright bevel where the lacquer is worn off the plate edges
    c = mix3(c, mul3(c, 1.5), (1 - bevel) * 0.35);
    // lacing: a cord along the lower third of each row, crossing between plates
    const laceV = Math.abs(fv - 0.28) * rowH;
    const cross = Math.abs(((fu * 2) % 1) - 0.5);
    const cord = (1 - sstep(0.0018, 0.0028, laceV)) * sstep(0.08, 0.2, cross);
    const cord2 = (1 - sstep(0.0012, 0.002, Math.abs(fu - 0.5) * plateW)) * (1 - sstep(0.004, 0.012, laceV));
    const L = sat(cord + cord2);
    c = mix3(c, lace, L);
    o.height += L * 0.0008;
    // gaps between plates read dark
    const gap = 1 - sstep(0.0004, 0.0015, edgeU);
    c = mul3(c, 1 - gap * 0.6);
    o.team = sat((op.plateTeam ?? 0) * (1 - L) * bevel + (op.laceTeam ?? 0) * L);
    o.rough = 0.35 + (1 - bevel) * 0.1 + L * 0.5;
    o.metal = (op.plateMetal ?? 0.6) * (1 - L);
    if (op.trim) {
      const hem = hemFn(i.p, i);
      const tb = 1 - sstep(op.trim.width - i.texel, op.trim.width + i.texel, hem);
      if (tb > 0) {
        const g = fbm3(x * 700, y * 700, z * 700, 2, 63);
        c = mix3(c, mul3(trimC, 0.8 + g * 0.4), tb);
        o.height = o.height * (1 - tb) + tb * 0.0015;
        o.team *= 1 - tb;
        o.metal *= 1 - tb;
        o.rough = o.rough * (1 - tb) + 0.6 * tb;
        // stitches on the binding
        const st = motifInk('stitch', along(i.p) / 0.007, (hem - op.trim.width * 0.5 + 0.0012) / 0.0024, 0.2);
        c = mix3(c, lin(0xcdb98e), st * tb * 0.8);
      }
    }
    o.albedo = c;
    void z;
  };
}

// ------------------------------------------------------------------ wood
export function wood(op: { color: number; axis?: V3; lacquer?: boolean }): Painter {
  const base = lin(op.color);
  const ax = op.axis ?? [0, 1, 0];
  return (i, o) => {
    const [x, y, z] = i.p;
    const along = x * ax[0] + y * ax[1] + z * ax[2];
    const across: V3 = [x - ax[0] * along, y - ax[1] * along, z - ax[2] * along];
    const g = fbm3(across[0] * 400, along * 18, across[2] * 400 + across[1] * 400, 3, 71);
    const rings = Math.sin(g * 40) * 0.5 + 0.5;
    const c = mul3(base, 0.8 + rings * 0.25 + (g - 0.5) * 0.2);
    o.height += (rings - 0.5) * 0.0001;
    o.albedo = c;
    o.rough = op.lacquer ? 0.35 : 0.7;
    o.metal = 0;
  };
}

// ------------------------------------------------------------------ straw / rattan
export function straw(op: { color: number; pattern: 'radial' | 'spiral' | 'weave'; centre?: V3; axis?: V3; team?: number }): Painter {
  const base = lin(op.color);
  const C = op.centre ?? [0, 0, 0];
  // frame around the axis (default: vertical, for hats)
  const A = op.axis ?? [0, 1, 0];
  const ref: V3 = Math.abs(A[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const e1: V3 = [A[1] * ref[2] - A[2] * ref[1], A[2] * ref[0] - A[0] * ref[2], A[0] * ref[1] - A[1] * ref[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]);
  const U: V3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const Vv: V3 = [A[1] * U[2] - A[2] * U[1], A[2] * U[0] - A[0] * U[2], A[0] * U[1] - A[1] * U[0]];
  return (i, o) => {
    const d: V3 = [i.p[0] - C[0], i.p[1] - C[1], i.p[2] - C[2]];
    const x = d[0] * U[0] + d[1] * U[1] + d[2] * U[2], z = d[0] * Vv[0] + d[1] * Vv[1] + d[2] * Vv[2], y = d[0] * A[0] + d[1] * A[1] + d[2] * A[2];
    let u: number, v: number;
    if (op.pattern === 'weave') {
      u = x * 160; v = (y + z) * 160;
    } else {
      const r = Math.hypot(x, z), a = Math.atan2(x, z);
      u = a * (op.pattern === 'spiral' ? 30 : 60);
      v = (op.pattern === 'spiral' ? r * 110 + a * 1.2 : r * 120) + y * 60;
    }
    const s1 = Math.sin(u) * 0.5 + 0.5, s2 = Math.sin(v * 3.1) * 0.5 + 0.5;
    const over = Math.floor(u / Math.PI) % 2 === Math.floor((v * 3.1) / Math.PI) % 2 ? s1 : s2;
    const n = noise3(x * 500, y * 500, z * 500, 81);
    o.albedo = mul3(base, 0.72 + over * 0.35 + (n - 0.5) * 0.15);
    o.height += over * 0.0006;
    o.rough = 0.8;
    o.metal = 0;
    o.team = op.team ?? 0;
  };
}

// ------------------------------------------------------------------ hair
/** Strands flowing along `flow(p)` (unit tangent); roots darker, tips and crowns catch light. */
export function hair(op: { color: number; flow: (p: V3) => V3; grey?: number }): Painter {
  const base = lin(op.color);
  return (i, o) => {
    const [x, y, z] = i.p;
    const f = op.flow(i.p);
    // coordinate across the strands: project onto a plane ⟂ flow
    const a = x * f[1] - y * f[0], b = y * f[2] - z * f[1], c2 = z * f[0] - x * f[2];
    const across = a * 1.7 + b * 1.3 + c2 * 1.1;
    const along = x * f[0] + y * f[1] + z * f[2];
    const strand = noise3(across * 2600, along * 90, 0, 91);
    const clump = noise3(across * 380, along * 12, 3, 93);
    let c = mul3(base, 0.6 + strand * 0.55 + (clump - 0.5) * 0.3);
    if (op.grey) c = mix3(c, lin(0xb8b4ae), op.grey * (0.5 + 0.5 * noise3(across * 900, along * 40, 7, 95)));
    o.height += (strand - 0.5) * 0.0005 + (clump - 0.5) * 0.001;
    o.albedo = c;
    o.rough = 0.45 + (1 - strand) * 0.2;
    o.metal = 0;
  };
}

// ------------------------------------------------------------------ skin (hands, necks, arms)
export function skinPaint(op: { color: number; flush: number }): Painter {
  const base = lin(op.color), flush = lin(op.flush);
  return (i, o) => {
    const [x, y, z] = i.p;
    const b = fbm3(x * 30, y * 30, z * 30, 3, 101);
    const m = noise3(x * 1500, y * 1500, z * 1500, 103);
    let c = mix3(base, flush, sat((b - 0.4) * 1.2));
    c = mul3(c, 1 + (m - 0.5) * 0.06);
    o.height += (m - 0.5) * 0.00003;
    o.albedo = c;
    o.rough = 0.55;
    o.metal = 0;
  };
}

// ------------------------------------------------------------------ fur
export function fur(op: { color: number; tip?: number }): Painter {
  const base = lin(op.color), tip = lin(op.tip ?? op.color);
  return (i, o) => {
    const [x, y, z] = i.p;
    const clump = fbm3(x * 160, y * 160, z * 160, 3, 111);
    const strand = noise3(x * 1600, y * 400, z * 1600, 113);
    o.albedo = mul3(mix3(base, tip, clump), 0.75 + strand * 0.35);
    o.height += clump * 0.003 + strand * 0.0006;
    o.rough = 0.95;
    o.metal = 0;
  };
}

// ------------------------------------------------------------------ lacquer / gloss paint
export function lacquer(op: { color: number; team?: number; wear?: number }): Painter {
  const base = lin(op.color);
  return (i, o) => {
    const [x, y, z] = i.p;
    const b = fbm3(x * 12, y * 12, z * 12, 3, 121) - 0.5;
    const craq = sstep(0.9, 0.95, noise3(x * 600, y * 600, z * 600, 123)) * (op.wear ?? 0.3);
    o.albedo = mul3(base, 1 + b * 0.12 - craq * 0.3);
    o.rough = 0.28 + b * 0.1 + craq * 0.3;
    o.metal = 0;
    o.team = op.team ?? 0;
  };
}

/** Wrap a painter: multiply in cavity occlusion from a distance field (sculpted parts). */
export function withCavities(p: Painter, occ: (q: V3, n: V3) => number, strength = 0.7): Painter {
  return (i, o) => {
    p(i, o);
    o.ao *= 1 - occ(i.p, i.n) * strength;
  };
}
