// Face painter: skin tone and its variation, lips, brows, lash lines and cavity shading for a
// head sculpted by head.ts. Everything is evaluated in head-local space against the sculpt's own
// distance field, so the painted features sit exactly on the sculpted ones; the sculpt's fine
// normals (lid rims, nostrils, the lip line) go into the normal map.

import type { V3 } from '../../../src/core/math';
import { fbm3, noise3 } from '../../../src/core/math';
import { normalAt, project, sdfOcclusion } from '../sdf/sdf';
import type { HeadSculpt } from './head';
import { Painter, lin } from '../tex/paint';

export interface SkinTone {
  base: number;
  /** cheeks, nose tip, ears */
  flush: number;
  lips: number;
  /** eyebrows and lash lines */
  brow: number;
  /** beard shadow (0 = none) */
  stubble?: number;
}
export const SKIN_TONES: Record<string, SkinTone> = {
  warm: { base: 0xe2b28c, flush: 0xd68a72, lips: 0xb45f55, brow: 0x241a15 },
  tan: { base: 0xcf9f7c, flush: 0xc07a66, lips: 0xa45a52, brow: 0x1e1612 },
  fair: { base: 0xeec3a2, flush: 0xe29a86, lips: 0xc46e66, brow: 0x2b211b },
  weathered: { base: 0xc3906e, flush: 0xb46e5e, lips: 0x98564e, brow: 0x241d1a },
};

const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (d2: number, r: number) => Math.exp(-d2 / (r * r));

const DBG = process.env.FACE_DEBUG ?? '';

export interface FaceLook {
  tone: SkinTone;
  brows?: 'stern' | 'calm' | 'arched';
  /** 0..1 beard shadow along the jaw and lip */
  stubble?: number;
  /** eyeliner strength (0..1) */
  liner?: number;
}

/** Painter for the head surface. `origin` = head centre in model space. */
export function facePainter(hs: HeadSculpt, origin: V3, look: FaceLook): Painter {
  const base = lin(look.tone.base), flush = lin(look.tone.flush), lipC = lin(look.tone.lips), browC = lin(look.tone.brow);
  const E = hs.eyes[0].c;
  const { up, R, t: lidT } = hs.lids;
  const W = hs.shape.width;
  const brows = look.brows ?? 'calm';
  const stubble = look.stubble ?? 0;
  const liner = look.liner ?? 0.6;
  return (i, o) => {
    // head-local point on the sculpt's true surface
    const q0: V3 = [i.p[0] - origin[0], i.p[1] - origin[1], i.p[2] - origin[2]];
    // (one short step: the reduced mesh lies within a fraction of a millimetre of the sculpt, and
    // longer steps can jump across thin features like the lip line)
    const q = project(hs.f, q0, 1, 0.0012);
    const n = normalAt(hs.f, q[0], q[1], q[2], 0.0003);
    if (!DBG.includes('nonormal')) o.normal = n;
    const [x, y, z] = q;
    const ax = Math.abs(x);

    // ---- skin colour: base with broad warm/cool zones and fine mottling
    let c = base;
    const mott = fbm3(q[0] * 90, q[1] * 90, q[2] * 90, 3, 7) - 0.5;
    const blot = fbm3(q[0] * 22 + 3, q[1] * 22, q[2] * 22, 3, 11) - 0.5;
    // flush: cheeks, nose tip, ears, chin; cooler temples and jaw
    const cheek = gauss((ax - 0.048 * W) ** 2 + (y + 0.02) ** 2 + (z - 0.07) ** 2, 0.024);
    const noseTip = gauss(x * x + (y + 0.03) ** 2 + (z - 0.115) ** 2, 0.014);
    const ear = gauss((ax - 0.085 * W) ** 2 + y * y + (z + 0.01) ** 2, 0.03);
    const chin = gauss(x * x + (y + 0.1) ** 2 + (z - 0.08) ** 2, 0.02);
    c = mix3(c, flush, sat(cheek * 0.42 + noseTip * 0.35 + ear * 0.45 + chin * 0.18 + blot * 0.12));
    // around the eyes: a little darker and cooler
    const orbit = gauss((ax - E[0]) ** 2 + ((y - E[1]) * 1.4) ** 2 + (z - E[2] - 0.01) ** 2, 0.017);
    c = mix3(c, [c[0] * 0.8, c[1] * 0.74, c[2] * 0.78], orbit * 0.55);
    // forehead / nose bridge sheen (lighter)
    const bridge = gauss(x * x * 4 + (y - 0.03) ** 2, 0.03) * sstep(0.08, 0.1, z);
    c = mix3(c, [c[0] * 1.08, c[1] * 1.06, c[2] * 1.02], bridge * 0.5);
    c = [c[0] * (1 + mott * 0.08), c[1] * (1 + mott * 0.07), c[2] * (1 + mott * 0.06)];
    o.rough = 0.52 + mott * 0.1 - bridge * 0.1;

    // ---- beard shadow
    if (stubble > 0) {
      const jaw = sstep(-0.03, -0.075, y) * sstep(0.03, 0.06, z + (ax > 0.05 ? 0.06 : 0)) * (1 - sstep(0.07, 0.09, ax));
      const lipTop = gauss(x * x * 0.3 + (y + 0.052) ** 2, 0.008) * sstep(0.09, 0.1, z);
      const dots = sstep(0.35, 0.8, noise3(q[0] * 1400, q[1] * 1400, q[2] * 1400, 3));
      const s = sat((jaw + lipTop) * stubble) * (0.55 + 0.45 * dots);
      c = mix3(c, [c[0] * 0.62, c[1] * 0.6, c[2] * 0.62], s * 0.7);
    }

    // ---- lips
    const dl = Math.min(hs.parts.upperLip(q[0], q[1], q[2]), hs.parts.lowerLip(q[0], q[1], q[2]));
    const lip = 1 - sstep(-0.0004, 0.0012, dl);
    if (lip > 0) {
      const lc = mix3(lipC, [lipC[0] * 1.12, lipC[1] * 1.05, lipC[2] * 1.05], sstep(0.002, 0.004, Math.abs(y + 0.0664)));
      c = mix3(c, lc, lip * 0.85);
      o.rough = o.rough * (1 - lip) + 0.35 * lip;
      // fine vertical creases on the lips
      o.height += lip * Math.sin(x * 2600 + noise3(q[0] * 300, q[1] * 300, 0, 5) * 3) * 0.00005;
    }

    // ---- brows: strands combed outwards along a curve above the eye
    {
      const t = (ax - 0.012 * W) / (0.05 * W);
      if (t > -0.1 && t < 1.12 && z > 0.06) {
        const tt = sat(t);
        const arch = brows === 'arched' ? Math.sin(tt * Math.PI) * 0.0058 : brows === 'stern' ? -0.004 + tt * 0.0065 : Math.sin(tt * Math.PI) * 0.003;
        const yc = 0.0425 + arch - (brows === 'stern' ? (1 - tt) * 0.0025 : 0) + (1 - tt) * 0.0008;
        const half = (brows === 'stern' ? 0.0064 : 0.0052) * (1 - tt * 0.5);
        // feathered edge (noise breaks the outline into hairs), soft ends
        const feather = (noise3(ax * 1500, y * 1500, 2, 13) - 0.5) * 0.5;
        const dy = (y - yc) / half + feather;
        const ends = sstep(-0.12, 0.1, t) * (1 - sstep(0.85, 1.12, t));
        const strand = 0.6 + 0.4 * Math.sin(ax * 1100 + dy * 2.2 + noise3(ax * 600, y * 600, 1, 9) * 4);
        const aa = Math.max(0.15, i.texel / half);
        const b = sstep(1 + aa, 1 - aa, Math.abs(dy)) * ends;
        if (b > 0) {
          c = mix3(c, browC, sat(sat(b * 1.6) * (0.6 + 0.4 * strand)) * 0.95);
          o.height += b * 0.00025 * strand;
          o.rough = o.rough * (1 - b) + 0.6 * b;
        }
      }
    }

    // ---- lash line along the upper lid edge, fainter on the lower
    {
      const px = ax - E[0], py = y - E[1], pz = z - E[2];
      const r = Math.hypot(px, py, pz);
      if (r < R + lidT + 0.004 && pz > -0.004) {
        const a = px * up[0] + py * up[1] + pz * up[2];
        const w = Math.max(0.0009, i.texel * 1.5);
        const lash = (1 - sstep(0.0002, 0.0002 + w, a)) * sstep(-0.0006, 0.0001, a) * sstep(R + lidT + 0.004, R + lidT, r);
        const outer = 1 + sstep(0.004, 0.012, px) * 0.6; // heavier towards the outer corner
        c = mix3(c, browC, sat(lash * liner * outer));
        // lid crease: a soft shadow a little above the lid edge
        const crease = gauss((a - 0.0042) ** 2, 0.0014) * sstep(R + lidT + 0.006, R + lidT + 0.001, r);
        c = mix3(c, [c[0] * 0.75, c[1] * 0.68, c[2] * 0.7], crease * 0.5);
      }
    }

    // ---- inside the eye opening (the lid's inner rim): moist, pink
    let inner = 0;
    {
      const px = ax - E[0], py = y - E[1], pz = z - E[2];
      const r = Math.hypot(px, py, pz);
      // (the cut faces of the opening lie inside the lid shell; its outer skin is at R + lidT)
      if (r < R + lidT * 0.75) {
        inner = sstep(R + lidT * 0.75, R + lidT * 0.35, r);
        c = mix3(c, [flush[0] * 0.9, flush[1] * 0.62, flush[2] * 0.6], inner);
        o.rough = o.rough * (1 - inner) + 0.25 * inner;
      }
    }

    // ---- cavities: nostrils, mouth line, eye corners, ear folds
    const occ = sdfOcclusion(hs.f, q, n, 0.005, 3);
    o.ao = DBG.includes('noao') ? 1 : 1 - occ * (0.7 - inner * 0.45);
    // pores
    o.height += (noise3(q[0] * 2200, q[1] * 2200, q[2] * 2200, 21) - 0.5) * 0.00003;
    o.albedo = c;
  };
}

/** Eyeball painter: sclera, iris with radial fibres and a dark limbal ring, pupil. */
export function eyePainter(centre: V3, look: V3, irisHex = 0x4a2f1c): Painter {
  const iris = lin(irisHex);
  const sclera = lin(0xefe8e0);
  const ln = Math.hypot(look[0], look[1], look[2]);
  const L: V3 = [look[0] / ln, look[1] / ln, look[2] / ln];
  return (i, o) => {
    const d: V3 = [i.p[0] - centre[0], i.p[1] - centre[1], i.p[2] - centre[2]];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const cosA = (d[0] * L[0] + d[1] * L[1] + d[2] * L[2]) / dl;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const IR = 0.5, PR = 0.2; // radians
    let c = sclera;
    // faint veins and warm corners
    c = mix3(c, [c[0] * 1.02, c[1] * 0.86, c[2] * 0.84], sstep(0.9, 1.5, ang) * 0.5);
    if (ang < IR + 0.04) {
      // radial fibres: angle around the look axis
      const ref: V3 = Math.abs(L[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const tx = L[1] * ref[2] - L[2] * ref[1], ty = L[2] * ref[0] - L[0] * ref[2], tz = L[0] * ref[1] - L[1] * ref[0];
      const bx = L[1] * tz - L[2] * ty, by = L[2] * tx - L[0] * tz, bz = L[0] * ty - L[1] * tx;
      const phi = Math.atan2(d[0] * bx + d[1] * by + d[2] * bz, d[0] * tx + d[1] * ty + d[2] * tz);
      const fib = 0.75 + 0.25 * Math.sin(phi * 38 + Math.sin(phi * 7) * 2) * Math.sin(phi * 17 + 1);
      const rr = ang / IR;
      let ic = [iris[0] * fib, iris[1] * fib, iris[2] * fib] as V3;
      ic = mix3(ic, [ic[0] * 1.7, ic[1] * 1.5, ic[2] * 1.1], sstep(0.35, 0.6, rr) * (1 - sstep(0.6, 0.85, rr)) * 0.6);
      ic = mix3(ic, [0.01, 0.008, 0.007], sstep(0.82, 1.0, rr)); // limbal ring
      const edge = 1 - sstep(IR - 0.01, IR + 0.03, ang);
      c = mix3(c, ic, edge);
      c = mix3(c, [0.004, 0.004, 0.004], 1 - sstep(PR - 0.02, PR + 0.01, ang));
    }
    o.albedo = c;
    o.rough = 0.08;
    o.height = 0;
  };
}
