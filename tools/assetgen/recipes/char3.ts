// Character kit v3 — the parts every humanoid unit is assembled from.
//
//   head3 / hands3 / boots3        sculpted skin and footwear
//   trousers3 / tunic3 / robe3     cloth layers cut from the body (garments.ts)
//   cuirass3 / armourSkirt3 / pauldrons3 / belt3   armour and leather
//   helmet3 / hair3 / beard3       headgear and hair, fitted to the head sculpt
//
// All parts are distance fields meshed and reduced at build time (cached), painted into the
// unit's texture atlas, and skinned automatically (nearest bone + blend zones; skirts blend the
// pelvis into both thighs). A unit recipe is a short list of these calls — see infantry.ts.

import type { V3 } from '../../../src/core/math';
import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { PaintedShading, MaterialDef } from '../../../src/core/materialModel';
import {
  SDF, ellipsoid, capsule, roundCone, blend, carve, mirrorX, box, torus, sphere, intersect, plane, smax, smin, bounded, normalAt, sdfOcclusion, rotated,
} from '../sdf/sdf';
import { bodySDF, Body, BodyParams } from './body';
import { garment, bunching, pleats } from './garments';
import { headSDF, meshSDF, headWeight, HEAD_SRC, FaceShape, HeadSculpt } from './head';
import { facePainter, eyePainter, SKIN_TONES, FaceLook, SkinTone } from './facePaint';
import { handSDF, fingertips, HandPose, GRIP } from './hands';
import { bootSDF } from './boots';
import { SKELETON } from './humanoid';
import { cloth, leather, lamellar, metal, skinPaint, hair, straw, wood, Band, sstep, mix3, mul3 } from '../tex/painters';
import { painted, lin, Painter } from '../tex/paint';
import { srcOf } from '../kit/cache';

export const CHAR3_SRC = srcOf(import.meta.url);
const HANDS_SRC = srcOf(new URL('./hands.ts', import.meta.url).href);
const BOOTS_SRC = srcOf(new URL('./boots.ts', import.meta.url).href);

export const JOINT = Object.fromEntries(SKELETON.map((j, i) => [j.name, i])) as Record<string, number>;
const jpos = (n: string): V3 => SKELETON.find((j) => j.name === n)!.pos;
/** Head centre (model space, bind pose) — head.ts works relative to it. */
export const HC: V3 = [0, 1.6, 0.012];
/** Canonical left-side geometry placed at `at`, mirrored for the right. */
export const side3 = (at: V3, side: 1 | -1) => T(at[0], at[1], at[2], [0, 0, 0], [side, 1, 1]);
/** Grip centres (model space): where held weapons pass through the fists. */
export const GRIP_L: V3 = [jpos('handL')[0] + GRIP[0], jpos('handL')[1] + GRIP[1], jpos('handL')[2] + GRIP[2]];
export const GRIP_RP: V3 = [jpos('handR')[0] - GRIP[0], jpos('handR')[1] + GRIP[1], jpos('handR')[2] + GRIP[2]];

export interface Ctx {
  mb: MeshBuilder;
  /** unit id, prefixes material names and cache keys */
  id: string;
  body: Body;
  tone: SkinTone;
  /** extra source files the unit's shapes depend on (for the mesh cache) */
  deps: string[];
}

export function ctx3(mb: MeshBuilder, id: string, tone: SkinTone, deps: string[], bp: Partial<BodyParams> = {}): Ctx {
  return { mb, id, body: bodySDF(bp), tone, deps: [CHAR3_SRC, ...deps] };
}
const mat = (c: Ctx, base: MaterialDef, name: string, fn: Painter, o: { density?: number; shading?: number } = {}) => painted({ ...base, doubleSided: false }, fn, { ...o, name: `${c.id}_${name}` });

// ================================================================== head
export interface HeadSpec {
  shape: Partial<FaceShape>;
  age: number;
  look: Omit<FaceLook, 'tone'>;
  iris?: number;
}
export function head3(c: Ctx, h: HeadSpec): HeadSculpt {
  const hs = headSDF(h.shape, h.age);
  const m = meshSDF(hs.f, [-0.12, -0.205, -0.135], [0.12, 0.145, 0.15], 0.0013, 4200, { key: `head|${JSON.stringify(h.shape)}|${h.age}`, deps: [HEAD_SRC] }, headWeight(hs));
  c.mb.with(null, () => c.mb.at(HC[0], HC[1], HC[2], () => c.mb.mesh(m.pos, m.idx, m.nrm)), {
    mat: mat(c, PAL.skin, 'face', facePainter(hs, HC, { ...h.look, tone: c.tone }), { density: 3, shading: PaintedShading.Skin }),
    skinMode: 'auto',
  });
  for (const e of hs.eyes) {
    const p: V3 = [HC[0] + e.c[0], HC[1] + e.c[1], HC[2] + e.c[2]];
    c.mb.with(null, () => c.mb.at(p[0], p[1], p[2], () => c.mb.sphere(e.R, 20, 14)), {
      mat: mat(c, PAL.skin, `eye_${e.c[0] > 0 ? 'l' : 'r'}`, eyePainter(p, [-Math.sign(e.c[0]) * 0.06, -0.05, 1], h.iris), { density: 5, shading: PaintedShading.Eye }),
      joint: JOINT.head,
    });
  }
  return hs;
}

// ================================================================== hands
export function hands3(c: Ctx, poses: { L: HandPose; R: HandPose }) {
  for (const side of [1, -1] as const) {
    const wrist = jpos(side > 0 ? 'handL' : 'handR');
    const pose = side > 0 ? poses.L : poses.R;
    const hf = handSDF(pose);
    const hm = meshSDF(hf, [-0.07, -0.16, -0.06], [0.05, 0.06, 0.08], 0.0011, 1300, { key: `hand|${pose}`, deps: [HANDS_SRC] });
    const tips = fingertips(pose);
    const base = skinPaint({ color: c.tone.base, flush: c.tone.flush });
    const fn: Painter = (i, o) => {
      base(i, o);
      const q: V3 = [(i.p[0] - wrist[0]) * side, i.p[1] - wrist[1], i.p[2] - wrist[2]];
      const n = normalAt(hf, q[0], q[1], q[2], 0.0004);
      o.normal = [n[0] * side, n[1], n[2]];
      const occ = sdfOcclusion(hf, q, n, 0.006, 3);
      o.ao = 1 - occ * 0.8;
      for (const t of tips) {
        const d = Math.hypot(q[0] - (t.tip[0] + 0.004), q[1] - t.tip[1], q[2] - t.tip[2]);
        const nail = (1 - sstep(0.0058, 0.0072, d)) * (n[0] > 0.2 ? 1 : 0);
        if (nail > 0) {
          o.albedo = mix3(o.albedo, lin(0xe8c8b8), nail * 0.8);
          o.rough = 0.3;
        }
      }
      o.albedo = mix3(o.albedo, mul3(o.albedo, 0.72), occ * 0.5);
    };
    c.mb.with(side3(wrist, side), () => c.mb.mesh(hm.pos, hm.idx, hm.nrm), {
      mat: mat(c, PAL.skin, side > 0 ? 'hand_l' : 'hand_r', fn, { density: 2, shading: PaintedShading.Skin }),
      skinMode: 'auto',
    });
  }
}

// ================================================================== boots
export function boots3(c: Ctx, o: { color: number; band?: number; height?: number } = { color: 0x1f1b1c }) {
  const H = o.height ?? 0.34;
  for (const side of [1, -1] as const) {
    const ank = jpos(side > 0 ? 'footL' : 'footR');
    const bf = bootSDF([Math.abs(ank[0]), ank[1], ank[2]], H);
    const bm = meshSDF(bf, [0.02, -0.01, -0.12], [0.18, H + 0.03, 0.23], 0.002, 1200, { key: `boot|${H}`, deps: [BOOTS_SRC] });
    const cl = cloth({ color: o.color, dirt: 0.2, hem: (p) => Math.abs(p[1] - (H - 0.005)), bands: [{ from: 0, to: 0.018, color: o.band ?? 0x2e2a2a }] });
    const fn: Painter = (i, out) => {
      cl(i, out);
      const sole = 1 - sstep(0.022, 0.026, i.p[1]);
      if (sole > 0) {
        const layers = Math.sin(i.p[1] * 900) * 0.5 + 0.5;
        out.albedo = mix3(out.albedo, mix3(lin(0xd9d1bf), lin(0xb0a48e), layers * 0.4 + (1 - sstep(0, 0.015, i.p[1])) * 0.4), sole);
        out.height += layers * 0.0002 * sole;
        out.rough = 0.9;
      }
    };
    c.mb.with(side3([0, 0, 0], side), () => c.mb.mesh(bm.pos, bm.idx, bm.nrm), { mat: mat(c, PAL.leather, side > 0 ? 'boot_l' : 'boot_r', fn, { density: 0.8 }), skinMode: 'auto' });
  }
}

// ================================================================== cloth layers
const hy = (y0: number, y1: number): SDF => (_x, y) => Math.max(y - y1, y0 - y);

export function trousers3(c: Ctx, o: { color: number; key?: string; band?: number; top?: number; bottom?: number }) {
  const g = garment({
    key: `${o.key ?? 'trousers'}|${o.top ?? 1.02}|${o.bottom ?? 0.3}`, deps: c.deps, inner: c.body.legs, t0: 0.004, t1: 0.02, region: hy(o.bottom ?? 0.3, o.top ?? 1.02),
    folds: (x, y, z) => bunching(0.004, 60, 1)(x, y, z) * (1 - Math.min(1, Math.abs(y - 0.5) / 0.3)) + bunching(0.003, 90, 2)(x, y, z) * (y < 0.42 ? 1 : 0),
    bounds: [[-0.24, 0.26, -0.18], [0.24, 1.06, 0.2]], tris: 2600,
  });
  c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), {
    mat: mat(c, PAL.clothIndigo, 'trousers', cloth({ color: o.color, hem: g.hem, dirt: 0.5, bands: o.band ? [{ from: 0, to: 0.022, color: o.band }] : undefined })),
    skinMode: 'auto',
  });
  return g;
}

export interface TunicOpts {
  color: number;
  key?: string;
  /** trim along the neckline, hem and cuffs */
  trim?: Band[];
  /** bottom hem height (m) — below the belt it hangs over the hips */
  hem?: number;
  team?: number;
}
export function tunic3(c: Ctx, o: TunicOpts) {
  const hemY = o.hem ?? 0.948;
  const region: SDF = (x, y, z) => {
    const neckHole = Math.max(Math.hypot(x, z) - 0.068, 1.36 - y);
    const vNeck = Math.max(0.02 - z, Math.abs(x) - (0.04 + (1.47 - y) * 0.35), 1.28 - y);
    // sleeves end at the wrists; the body hangs down to the hem
    const cuffs = Math.max(Math.abs(x) - 0.2, 0.948 - y);
    return Math.max(hemY - y, -cuffs, -neckHole, -vNeck);
  };
  const g = garment({
    key: `${o.key ?? 'tunic'}|${hemY}`, deps: c.deps, inner: c.body.clothTop, t0: 0.004, t1: 0.012, region,
    folds: (x, y, z) => (Math.abs(x) > 0.19 ? bunching(0.0035, 55, 3)(x, y, z) * (0.4 + 0.6 * sstep(1.2, 1.05, y)) : 0),
    bounds: [[-0.36, Math.min(0.9, hemY - 0.03), -0.2], [0.36, 1.56, 0.2]], tris: 3000, keepInner: 0.06,
  });
  c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), {
    mat: mat(c, PAL.clothRed, 'tunic', cloth({ color: o.color, hem: g.hem, team: o.team, bands: o.trim })),
    skinMode: 'auto',
  });
  return g;
}

// ================================================================== armour
export interface LamellarLook {
  plate: number;
  lace: number;
  plateTeam?: number;
  laceTeam?: number;
  metal?: number;
  trim?: number;
}
const lamP = (l: LamellarLook, hem: (p: V3) => number, trimW = 0.018) =>
  lamellar({ plate: l.plate, lace: l.lace, plateTeam: l.plateTeam ?? 0.75, laceTeam: l.laceTeam ?? 0, plateMetal: l.metal ?? 0.5, hem, trim: { width: trimW, color: l.trim ?? 0x5a3a24 } });

export function cuirass3(c: Ctx, l: LamellarLook, key = 'cuirass') {
  const region: SDF = (x, y, z) => {
    const arm = Math.min(Math.hypot(x - 0.215, y - 1.40, z) - 0.095, Math.hypot(x + 0.215, y - 1.40, z) - 0.095);
    const neck = 0.085 - Math.hypot(x, z);
    return Math.max(Math.max(y - 1.43, 1.0 - y), Math.max(-arm, y > 1.36 ? neck : -1));
  };
  const g = garment({ key, deps: c.deps, inner: c.body.torso, t0: 0.02, t1: 0.036, region, bounds: [[-0.3, 0.95, -0.2], [0.3, 1.5, 0.22]], tris: 2400, cell: 0.0035 });
  c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), { mat: mat(c, PAL.lamellarTeam, key, lamP(l, g.hem)), joint: JOINT.chest });
  // leather shoulder straps joining front and back plates
  for (const s of [1, -1]) {
    const strap: SDF = (x, y, z) => {
      const d = c.body.torso(x, y, z);
      const band = Math.abs(x * s - 0.12) - 0.022;
      return Math.max(Math.max(d - 0.04, 0.028 - d), Math.max(band, 1.4 - y));
    };
    const sg = garment({ key: `${key}_strap${s}`, deps: c.deps, solid: strap, region: () => -1, bounds: [[s > 0 ? 0.06 : -0.18, 1.36, -0.16], [s > 0 ? 0.18 : -0.06, 1.52, 0.16]], tris: 300, cell: 0.0025 });
    c.mb.with(null, () => c.mb.mesh(sg.mesh.pos, sg.mesh.idx, sg.mesh.nrm), {
      mat: mat(c, PAL.leather, `${key}_strap`, leather({ color: 0x5a3a24, stitch: 0.005, hem: (p) => 0.022 - Math.abs(p[0] * s - 0.12) })),
      joint: JOINT.chest,
    });
  }
  return g;
}

export function armourSkirt3(c: Ctx, l: LamellarLook, o: { top?: number; bottom?: number; key?: string } = {}) {
  const top = o.top ?? 1.03, bottom = o.bottom ?? 0.62;
  const solid: SDF = (x, y, z) => {
    const t = Math.max(0, Math.min(1, (top - y) / (top - bottom)));
    const rx = 0.176 + t * 0.07, rz = 0.14 + t * 0.06;
    const d = (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
    return Math.abs(d) - 0.006;
  };
  const region: SDF = (x, y, z) => {
    const a = Math.atan2(x, z);
    const slit = 0.012 - Math.min(...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((q) => Math.abs(Math.atan2(Math.sin(a - q - Math.PI / 4), Math.cos(a - q - Math.PI / 4))))) * 0.2;
    return Math.max(Math.max(y - top, bottom - y), y < top - 0.03 ? slit : -1);
  };
  const key = o.key ?? 'askirt';
  const g = garment({ key: `${key}|${top}|${bottom}`, deps: c.deps, solid, region, bounds: [[-0.28, bottom - 0.04, -0.24], [0.28, top + 0.03, 0.24]], tris: 1800 });
  c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), { mat: mat(c, PAL.lamellarTeam, key, lamP(l, g.hem, 0.016)), skinMode: 'skirt' });
  return g;
}

export function belt3(c: Ctx, o: { color?: number; y?: number; buckle?: number } = {}) {
  const Y = o.y ?? 1.025;
  const solid: SDF = (x, y, z) => {
    const d = (Math.hypot(x / 0.192, z / 0.158) - 1) * 0.158;
    return Math.max(Math.abs(d) - 0.01, Math.abs(y - Y) - 0.025);
  };
  const g = garment({ key: `belt|${Y}`, deps: c.deps, solid, region: () => -1, bounds: [[-0.22, Y - 0.045, -0.19], [0.22, Y + 0.045, 0.19]], tris: 700, cell: 0.0025 });
  c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), { mat: mat(c, PAL.leather, 'belt', leather({ color: o.color ?? 0x6d4527, stitch: 0.005, hem: (p) => 0.025 - Math.abs(p[1] - Y) })), joint: JOINT.chest });
  const bf = box([0, Y, 0.162], [0.042, 0.034, 0.008], 0.006);
  const bm = meshSDF(bf, [-0.06, Y - 0.045, 0.14], [0.06, Y + 0.045, 0.18], 0.0015, 300, { key: `buckle|${Y}`, deps: c.deps });
  c.mb.with(null, () => c.mb.mesh(bm.pos, bm.idx, bm.nrm), { mat: mat(c, PAL.bronze, 'buckle', metal({ color: o.buckle ?? 0x9a6532, wear: 0.6 })), joint: JOINT.chest });
}

export function pauldrons3(c: Ctx, l: LamellarLook) {
  for (const s of [1, -1] as const) {
    const sh = jpos(s > 0 ? 'armL' : 'armR');
    const C: V3 = [sh[0] + s * 0.012, sh[1] - 0.02, sh[2]];
    const solid: SDF = (x, y, z) => {
      const d = Math.hypot((x - C[0]) / 1.0, (y - C[1]) / 1.12, (z - C[2]) / 1.05) - 0.095;
      return Math.abs(d) - 0.006;
    };
    const region: SDF = (x, y, z) => Math.max(C[1] - 0.12 - y + (x * s - C[0] * s) * 0.3, (C[0] - 0.02) * s - x * s, -(y - C[1] + 0.2));
    const g = garment({ key: `pauldron${s}`, deps: c.deps, solid, region, bounds: [[C[0] - 0.13, C[1] - 0.16, -0.13], [C[0] + 0.13, C[1] + 0.12, 0.13]], tris: 900, cell: 0.0025 });
    c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), { mat: mat(c, PAL.lamellarTeam, `pauldron`, lamP(l, g.hem, 0.014)), joint: s > 0 ? JOINT.armL : JOINT.armR });
  }
}

// ================================================================== helmet
export interface HelmetOpts {
  color?: number;
  plume?: number;
  aventail?: LamellarLook;
}
export function helmet3(c: Ctx, hs: HeadSculpt, o: HelmetOpts = {}) {
  const W = hs.shape.width;
  const cr: V3 = [HC[0], HC[1] + 0.032, HC[2] - 0.016];
  const R: V3 = [0.088 * W + 0.012, 0.104 + 0.012, 0.104 + 0.012];
  const skull = ellipsoid(cr, R);
  // bowl: from the brow at the front to the nape at the back; riveted ribs; a raised brim band
  const rim = (x: number, y: number, z: number) => y - (HC[1] + 0.052 - (0.02 - (z - HC[2])) * 0.35);
  const ribs = (x: number, y: number, z: number) => {
    const a = Math.atan2(x - cr[0], z - cr[2]);
    const k = Math.abs(Math.sin(a * 3)) * Math.hypot(x - cr[0], z - cr[2]);
    return k - 0.006;
  };
  const bowl: SDF = (x, y, z) => {
    const d = skull(x, y, z);
    let s = Math.max(d - 0.004, -d - 0.004);
    s = smin(s, Math.max(Math.max(d - 0.008, -d), ribs(x, y, z)), 0.002);
    const band = Math.max(Math.max(d - 0.011, -d), rim(x, y, z) - 0.018);
    s = smin(s, band, 0.002);
    return smax(s, -rim(x, y, z), 0.001);
  };
  const top: V3 = [cr[0], cr[1] + R[1] - 0.004, cr[2]];
  const spike = blend(0.006, roundCone(top, [top[0], top[1] + 0.07, top[2]], 0.018, 0.006), sphere([top[0], top[1] + 0.035, top[2]], 0.017));
  const helm = union2(bowl, spike);
  const hm = meshSDF(helm, [cr[0] - 0.13, HC[1] - 0.04, cr[2] - 0.14], [cr[0] + 0.13, top[1] + 0.09, cr[2] + 0.14], 0.0022, 2200, { key: `helmet|${W}`, deps: c.deps });
  const rivets: V3[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const z = cr[2] + Math.cos(a) * (R[2] + 0.011), x = cr[0] + Math.sin(a) * (R[0] + 0.011);
    rivets.push([x, HC[1] + 0.052 - (0.02 - (z - HC[2])) * 0.35 + 0.009, z]);
  }
  c.mb.with(null, () => c.mb.mesh(hm.pos, hm.idx, hm.nrm), {
    mat: mat(c, PAL.steel, 'helmet', metal({ color: o.color ?? 0xa9adb3, wear: 0.5, rivets: { at: rivets, r: 0.0042 }, hem: (p) => Math.abs(rim(p[0], p[1], p[2])) })),
    joint: JOINT.head,
  });
  // horsehair plume falling from the spike
  const plumeTop: V3 = [top[0], top[1] + 0.062, top[2]];
  const plume: SDF = (x, y, z) => {
    const t = Math.max(0, Math.min(1, (plumeTop[1] - y) / 0.12));
    const r = 0.012 + t * 0.045;
    const a = Math.atan2(x - plumeTop[0], z - plumeTop[2]);
    const strands = Math.sin(a * 14) * 0.003 * t;
    return Math.max(Math.hypot(x - plumeTop[0], z - plumeTop[2] + t * 0.01) - r + strands, Math.max(y - plumeTop[1] - 0.01, plumeTop[1] - 0.13 - y));
  };
  const pm = meshSDF(plume, [plumeTop[0] - 0.07, plumeTop[1] - 0.14, plumeTop[2] - 0.08], [plumeTop[0] + 0.07, plumeTop[1] + 0.02, plumeTop[2] + 0.07], 0.002, 700, { key: 'plume', deps: c.deps });
  c.mb.with(null, () => c.mb.mesh(pm.pos, pm.idx, pm.nrm), {
    mat: mat(c, PAL.clothRed, 'plume', hair({ color: o.plume ?? 0xb3261e, flow: (p) => { const d: V3 = [p[0] - plumeTop[0], p[1] - plumeTop[1] - 0.05, p[2] - plumeTop[2]]; const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; } }), { shading: PaintedShading.Hair }),
    joint: JOINT.head,
  });
  // lamellar aventail: back and sides of the neck, flaring onto the shoulders
  if (o.aventail) {
    const av: SDF = (x, y, z) => {
      const t = Math.max(0, Math.min(1, (HC[1] + 0.03 - y) / 0.2));
      const rx = 0.106 * W + t * 0.05, rz = 0.1 + t * 0.045;
      const d = (Math.hypot(x / rx, (z - HC[2] + 0.02) / rz) - 1) * Math.min(rx, rz);
      return Math.abs(d) - 0.005;
    };
    const region: SDF = (x, y, z) => Math.max(Math.max(y - (HC[1] + 0.035), HC[1] - 0.2 - y), (z - HC[2]) - 0.02 + Math.abs(x) * 0.25);
    const g = garment({ key: `aventail|${W}`, deps: c.deps, solid: av, region, bounds: [[-0.2, HC[1] - 0.22, -0.2], [0.2, HC[1] + 0.06, 0.14]], tris: 1000, cell: 0.0025 });
    c.mb.with(null, () => c.mb.mesh(g.mesh.pos, g.mesh.idx, g.mesh.nrm), { mat: mat(c, PAL.lamellarTeam, 'aventail', lamP(o.aventail, g.hem, 0.012)), joint: JOINT.head });
  }
}
const union2 = (a: SDF, b: SDF): SDF => (x, y, z) => Math.min(a(x, y, z), b(x, y, z));

export { SKIN_TONES, bunching, pleats, carve, mirrorX, capsule, ellipsoid, roundCone, blend, box, torus, sphere, intersect, plane, bounded, rotated, straw, wood, leather, metal, cloth, lamellar, hair, painted, mat, jpos };
