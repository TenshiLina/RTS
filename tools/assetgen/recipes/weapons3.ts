// Weapons and shields v3 — sculpted, painted props held in the v3 fists.
// Local frame: the grip centre at the origin, the shaft along +Y.

import type { V3 } from '../../../src/core/math';
import { PAL } from '../kit/palette';
import { SDF, capsule, roundCone, ellipsoid, blend, sphere, torus, intersect, plane, carve } from '../sdf/sdf';
import { meshSDF } from './head';
import { Ctx, mat } from './char3';
import { wood, metal, hair, straw, sstep, mix3 } from '../tex/painters';
import { lin, Painter } from '../tex/paint';
import { PaintedShading } from '../../../src/core/materialModel';

const union = (...s: SDF[]): SDF => (x, y, z) => { let d = Infinity; for (const f of s) d = Math.min(d, f(x, y, z)); return d; };

/** 戟 ji: spear point, crescent side blade, bronze socket, red tassel, butt spike. */
export function jiParts(c: Ctx) {
  const shaft = capsule([0, -0.74, 0], [0, 1.72, 0], 0.02);
  const socket = blend(0.006, roundCone([0, 1.66, 0], [0, 1.82, 0], 0.03, 0.024), torus([0, 1.68, 0], 0.03, 0.006));
  const butt = roundCone([0, -0.72, 0], [0, -0.84, 0], 0.022, 0.004);
  // leaf-shaped spear point with a central ridge
  const leaf: SDF = (x, y, z) => {
    const t = (y - 1.82) / 0.36;
    const w = 0.05 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) ** 0.7 * (1 - t * 0.3) + 0.002;
    const th = 0.0035 + Math.max(0, w - Math.abs(x)) * 0.12;
    return Math.max(Math.max(Math.abs(x) - w, Math.abs(z) - th), Math.max(1.82 - y, y - 2.18));
  };
  // crescent side blade (月牙) on +X
  const cx = 0.03, cy = 1.72;
  const crescent: SDF = (x, y, z) => {
    const r = Math.hypot(x - cx, y - cy);
    const a = Math.atan2(y - cy, x - cx);
    const outer = r - 0.2, inner = 0.12 + Math.abs(a) * 0.03 - r;
    const ang = Math.abs(a) - 1.05;
    const edge = Math.max(0, r - 0.15) / 0.05;
    const th = 0.006 * (1 - edge * 0.7) + 0.0015;
    return Math.max(Math.max(outer, inner), Math.max(ang * 0.1, Math.abs(z) - th));
  };
  const bladeF = union(leaf, crescent);
  return { shaft, socket, butt, bladeF };
}

export function buildJi(c: Ctx, joint: number, place: (fn: () => void) => void) {
  const p = jiParts(c);
  const sm = meshSDF(p.shaft, [-0.03, -0.77, -0.03], [0.03, 1.75, 0.03], 0.003, 420, { key: 'ji_shaft', deps: c.deps });
  const km = meshSDF(union(p.socket, p.butt), [-0.04, -0.86, -0.04], [0.04, 1.84, 0.04], 0.002, 700, { key: 'ji_socket', deps: c.deps });
  const bm = meshSDF(p.bladeF, [-0.08, 1.5, -0.02], [0.25, 2.2, 0.02], 0.0018, 1100, { key: 'ji_blade', deps: c.deps });
  // tassel of red horsehair below the socket
  const tassel: SDF = (x, y, z) => {
    const t = Math.max(0, Math.min(1, (1.66 - y) / 0.16));
    const r = 0.022 + t * 0.04;
    const a = Math.atan2(x, z);
    return Math.max(Math.hypot(x, z) - r + Math.sin(a * 16) * 0.003 * t, Math.max(y - 1.67, 1.5 - y));
  };
  const tm = meshSDF(tassel, [-0.08, 1.48, -0.08], [0.08, 1.69, 0.08], 0.002, 600, { key: 'ji_tassel', deps: c.deps });
  place(() => {
    c.mb.with(null, () => c.mb.mesh(sm.pos, sm.idx, sm.nrm), { mat: mat(c, PAL.timberDark, 'ji_shaft', wood({ color: 0x5a2a1a, axis: [0, 1, 0], lacquer: true }), { density: 0.6 }), joint });
    c.mb.with(null, () => c.mb.mesh(km.pos, km.idx, km.nrm), { mat: mat(c, PAL.bronze, 'ji_socket', metal({ color: 0x9a6532, wear: 0.6 })), joint });
    c.mb.with(null, () => c.mb.mesh(bm.pos, bm.idx, bm.nrm), { mat: mat(c, PAL.steel, 'ji_blade', metal({ color: 0xb9bcc2, wear: 0.35, rough: 0.22 }), { density: 1.2 }), joint });
    c.mb.with(null, () => c.mb.mesh(tm.pos, tm.idx, tm.nrm), { mat: mat(c, PAL.clothRed, 'ji_tassel', hair({ color: 0xb3261e, flow: () => [0, -1, 0] }), { shading: PaintedShading.Hair }), joint });
  });
}

/** Round rattan shield (藤牌): a shallow woven dome, a team-coloured band, a bronze boss. Front = +Z. */
export function buildRattanShield(c: Ctx, joint: number, at: { c: V3; n: V3 }, place: (fn: () => void) => void) {
  const R = 0.26;
  const dome: SDF = (x, y, z) => {
    const r = Math.hypot(x, y);
    const zf = 0.06 * (1 - (r / R) ** 2);
    return Math.max(Math.max(z - zf - 0.008, zf - 0.012 - z), r - R);
  };
  const rim = torus([0, 0, 0], R - 0.004, 0.013);
  const shieldF = blend(0.006, dome, (x, y, z) => rim(x, z, -y));
  const boss = ellipsoid([0, 0, 0.07], [0.055, 0.055, 0.03]);
  const sm = meshSDF(shieldF, [-0.3, -0.3, -0.05], [0.3, 0.3, 0.1], 0.003, 1400, { key: 'rattan', deps: c.deps });
  const bm = meshSDF(boss, [-0.07, -0.07, 0.03], [0.07, 0.07, 0.11], 0.002, 400, { key: 'rattan_boss', deps: c.deps });
  // painters see model space: pass the shield's placed centre and facing
  const weave = straw({ color: 0xc9a466, pattern: 'spiral', centre: at.c, axis: at.n });
  const band = lin(0xe8e0cc);
  const fn: Painter = (i, o) => {
    weave(i, o);
    const d: V3 = [i.p[0] - at.c[0], i.p[1] - at.c[1], i.p[2] - at.c[2]];
    const h = d[0] * at.n[0] + d[1] * at.n[1] + d[2] * at.n[2];
    const r = Math.hypot(d[0] - at.n[0] * h, d[1] - at.n[1] * h, d[2] - at.n[2] * h);
    const ring = sstep(0.15, 0.155, r) * (1 - sstep(0.2, 0.205, r));
    if (ring > 0) {
      o.albedo = mix3(o.albedo, band, ring * 0.9);
      o.team = ring;
      o.rough = 0.5;
    }
  };
  place(() => {
    c.mb.with(null, () => c.mb.mesh(sm.pos, sm.idx, sm.nrm), { mat: mat(c, PAL.straw, 'shield', fn, { density: 0.8 }), joint });
    c.mb.with(null, () => c.mb.mesh(bm.pos, bm.idx, bm.nrm), { mat: mat(c, PAL.bronze, 'shield_boss', metal({ color: 0xa87a3a, wear: 0.5 })), joint });
  });
}
export { sstep, mix3, lin, sphere, intersect, plane, carve, ellipsoid };
export type { V3 };
