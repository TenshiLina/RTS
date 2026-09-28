// Face painter for head v4: skin tone, brows on the brow ridge, lash lines on the lid edges, lip
// colour on the sculpted lips, light cavity shading. Restrained: the sculpt carries the form,
// the paint only adds colour and the few details that are colour, not shape.

import type { V3 } from '../../../src/core/math';
import { fbm3, noise3 } from '../../../src/core/math';
import { normalAt, project, sdfOcclusion } from '../sdf/sdf';
import type { HeadSculpt4 } from './head4';
import { Painter, lin } from '../tex/paint';
import type { SkinTone } from './facePaint';

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const g2 = (dx: number, dy: number, rx: number, ry: number) => Math.exp(-(dx * dx) / (rx * rx) - (dy * dy) / (ry * ry));

export interface FaceLook4 {
  tone: SkinTone;
  brows?: 'stern' | 'calm' | 'arched';
  /** 0..1 beard shadow */
  stubble?: number;
  /** 0..1 lash-line strength */
  liner?: number;
  /** cavity shading strength (default 0.35: gentle) */
  cavity?: number;
  /** unpainted clay for sculpt reviews */
  clay?: boolean;
}

export function facePainter4(hs: HeadSculpt4, origin: V3, look: FaceLook4): Painter {
  const base = lin(look.tone.base), flush = lin(look.tone.flush), lipC = lin(look.tone.lips), browC = lin(look.tone.brow);
  const F = hs.feat;
  const E = F.E;
  const W = hs.shape.width;
  const brows = look.brows ?? 'calm';
  const liner = look.liner ?? 0.7;
  const cav = look.cavity ?? 0.35;
  return (i, o) => {
    const q0: V3 = [i.p[0] - origin[0], i.p[1] - origin[1], i.p[2] - origin[2]];
    const q = project(hs.f, q0, 1, 0.001);
    const n = normalAt(hs.f, q[0], q[1], q[2], 0.0003);
    o.normal = n;
    const [x, y, z] = q;
    const ax = Math.abs(x);
    const front = sstep(0.02, 0.06, z);
    if (look.clay) {
      o.albedo = lin(0xc9a58c);
      o.rough = 0.6;
      return;
    }

    // ---- skin: warm centre of the face, cooler temples and jaw, very fine mottling
    let c = base;
    const blot = fbm3(x * 24 + 3, y * 24, z * 24, 3, 11) - 0.5;
    const mott = noise3(x * 700, y * 700, z * 700, 7) - 0.5;
    const cheek = g2(ax - 0.044 * W, y + 0.022, 0.02, 0.018) * front;
    const nose = g2(x, y + 0.03, 0.009, 0.012) * front;
    const ear = g2(ax - 0.074 * W, y + 0.016, 0.014, 0.03) * sstep(0.02, 0.0, z + 0.03);
    c = mix3(c, flush, sat(cheek * 0.3 + nose * 0.28 + ear * 0.35 + blot * 0.1));
    // under-eye: a touch cooler and darker
    const under = g2(ax - E[0], y - E[1] + 0.009, 0.013, 0.005) * front;
    c = mix3(c, [c[0] * 0.9, c[1] * 0.86, c[2] * 0.9], under * 0.45);
    c = [c[0] * (1 + mott * 0.035), c[1] * (1 + mott * 0.03), c[2] * (1 + mott * 0.03)];
    o.rough = 0.5 + blot * 0.08;

    // ---- beard shadow
    const stub = look.stubble ?? 0;
    if (stub > 0) {
      const L = F.lipLines(x);
      const lipUp = sstep(-0.047, -0.052, y) * sstep(L.top - 0.001, L.top + 0.0015, y) * sstep(0.03, 0.02, ax);
      const jaw = sstep(L.bottom + 0.001, L.bottom - 0.003, y) * sstep(0.07, 0.05, ax + Math.max(0, y + 0.06) * 0) * front;
      const cheeks = sstep(-0.045, -0.06, y) * sstep(0.03, 0.05, ax) * sstep(0.075, 0.06, ax);
      const dots = 0.6 + 0.4 * sstep(0.3, 0.8, noise3(x * 1600, y * 1600, z * 1600, 3));
      const s = sat((lipUp + jaw + cheeks * 0.7) * stub) * dots;
      c = mix3(c, [c[0] * 0.7, c[1] * 0.68, c[2] * 0.72], s * 0.55);
    }

    // ---- lips
    const lm = F.lips(x, y);
    if (lm.m > 0) {
      const lc = lm.upper ? [lipC[0] * 0.94, lipC[1] * 0.92, lipC[2] * 0.94] as V3 : lipC;
      c = mix3(c, lc, lm.m * 0.8);
      o.rough = o.rough * (1 - lm.m) + 0.38 * lm.m;
      // fine vertical lines on the lips
      o.height += lm.m * Math.sin(x * 2400 + noise3(x * 300, y * 300, 0, 5) * 3) * 0.00003;
    }
    // the parting: darker line
    const L = F.lipLines(x);
    if (L.t > 0) c = mix3(c, [c[0] * 0.45, c[1] * 0.3, c[2] * 0.3], g2(0, y - L.mid, 1, 0.00045) * Math.pow(L.t, 0.4) * 0.8);

    // ---- brows: a soft-edged mass on the brow ridge, made of fine angled hairs — steep at the
    // inner end, lying almost flat towards the tail
    const B = F.brow(ax);
    if (B && z > 0.06) {
      const t = sat((ax - 0.009) / 0.057);
      const lift = brows === 'arched' ? Math.sin(Math.PI * t) * 0.0022 : brows === 'stern' ? -0.0018 * (1 - t) : 0;
      const half = B.half * (brows === 'stern' ? 1.12 : 1);
      const cy = B.y + lift;
      const across = (y - cy) / half;
      // density: full in the body, thinning at the tail and feathered at the edges
      const edgeN = (noise3(ax * 900, y * 900, 2, 13) - 0.5) * 0.22;
      const body = sstep(1.05, 0.55, Math.abs(across) + edgeN) * sstep(0.0, 0.08, t) * (1 - sstep(0.8, 1.0, t)) * (1 - 0.35 * t);
      if (body > 0) {
        const ang = (1 - t) * 1.1 + 0.18; // hair direction from the brow line
        const s2 = Math.sin(ang), c2 = Math.cos(ang);
        const u = (ax * c2 + (y - cy) * s2) * 5200, v = (-ax * s2 + (y - cy) * c2) * 380;
        const hairs = 0.5 + 0.5 * Math.sin(u + noise3(ax * 600, y * 600, 5, 9) * 5 + v * 0.2);
        const aa = sat(i.texel * 2200);
        const k = sat(body * (0.72 + 0.28 * (hairs * (1 - aa) + 0.5 * aa)));
        c = mix3(c, browC, k * 0.96);
        o.height += body * 0.00012;
        o.rough = o.rough * (1 - body) + 0.62 * body;
      }
    }

    // ---- lash lines along the lid edges (heavier at the outer corner), a soft shadow in the crease
    {
      const dxE = ax - E[0];
      if (Math.abs(dxE) < 0.022 && Math.abs(y - E[1]) < 0.014 && z > 0.06) {
        const ap = F.apertureAt(ax, y, z);
        const up = F.lidUp(Math.min(Math.max(ax, E[0] - 0.015), E[0] + 0.016));
        const aboveUp = y - up;
        const w = Math.max(0.0007, i.texel * 1.4);
        const onUpper = y > E[1] - 0.001 ? 1 : 0;
        const outer = 1 + sstep(0.0, 0.012, dxE) * 0.8;
        const lash = (1 - sstep(0.0001, w, aboveUp)) * sstep(-0.0006, 0.0, aboveUp) * onUpper * sstep(0.004, 0.0, ap + 0.0035);
        c = mix3(c, browC, sat(lash * liner * outer));
        const lower = (1 - sstep(0.0, 0.0012, Math.abs(ap))) * (1 - onUpper) * 0.35 * liner;
        c = mix3(c, [c[0] * 0.7, c[1] * 0.6, c[2] * 0.62], lower);
        // inner rim of the lids (waterline): moist pink
        if (ap < 0.0008 && ap > -0.0012) c = mix3(c, [flush[0], flush[1] * 0.7, flush[2] * 0.7], 0.4);
        // lid crease shadow
        const crease = g2(0, aboveUp - 0.0045, 1, 0.0016) * sstep(0.02, 0.0, Math.abs(dxE));
        c = mix3(c, [c[0] * 0.82, c[1] * 0.74, c[2] * 0.76], crease * 0.35);
      }
    }

    // ---- light cavity shading: nostrils, mouth corners, eye corners, ear folds
    const occ = sdfOcclusion(hs.f, q, n, 0.005, 3);
    o.ao = 1 - occ * cav;
    o.albedo = c;
  };
}
