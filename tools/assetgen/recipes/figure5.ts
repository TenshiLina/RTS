// Figure v5 — the base human, fitted to the faction's concept sheet
// (docs/art/factions/human/human-female-turnaround.webp, measured by ref/sheet.py).
//
// Step 1 of the character rework is a block-in: the big masses only, placed and proportioned
// from the sheet, so the whole figure can be judged against the concept before any detail.
// Every form is a loft of horizontal slices whose widths and depths are sampled from the sheet:
// the silhouette where it shows the form, and where it doesn't, the edge between skin and the
// fitted clothes (the torso behind the arms is the tank top's edge; the arm in profile is its skin
// against the top). What no view shows (the skull under the hair) comes from anatomy.
// The head is skull, face, jaw, nose wedge, closed-lid eyes and ears; the hair is a separate
// layer (its own mesh and material) over the skull, so hairstyles and helmets swap freely.
//
// Frame: metres, feet on y = 0, +Y up, +Z forward, +X the figure's left. A-pose as in the sheet.

import type { V3 } from '../../../src/core/math';
import { SDF, ellipsoid, blend, mirrorX, rotated, smax, smin, sphere, capsule, roundCone } from '../sdf/sdf';
import { handSDF } from './hands';
import { loadRef, sampleProfile, interp, runContaining, runsAt, Run, Sample, RefView, loadJson, refJsonPath } from '../ref/refSheet';

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Natural cubic spline through (x, value) keys (any order), clamped outside the keys. */
export function spline(keys: [number, number][]) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const X = k.map((q) => q[0]), Y = k.map((q) => q[1]);
  const h = X.slice(1).map((x, i) => x - X[i]);
  const al = new Float64Array(n), l = new Float64Array(n).fill(1), mu = new Float64Array(n), zz = new Float64Array(n), c = new Float64Array(n), b = new Float64Array(n), d = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) al[i] = (3 / h[i]) * (Y[i + 1] - Y[i]) - (3 / h[i - 1]) * (Y[i] - Y[i - 1]);
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (X[i + 1] - X[i - 1]) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    zz[i] = (al[i] - h[i - 1] * zz[i - 1]) / l[i];
  }
  for (let j = n - 2; j >= 0; j--) {
    c[j] = zz[j] - mu[j] * c[j + 1];
    b[j] = (Y[j + 1] - Y[j]) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  return (x: number) => {
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let i = 0;
    while (i < n - 2 && x > X[i + 1]) i++;
    const t = x - X[i];
    return Y[i] + b[i] * t + c[i] * t * t + d[i] * t * t * t;
  };
}

/** Smooth minimum of positive scales (a hard min kinks where two cross; anything offset from the
 *  field — hair, bust — would crease along that line). */
export const softMin3 = (a: number, b: number, c: number) => Math.pow(Math.pow(a, -6) + Math.pow(b, -6) + Math.pow(c, -6), -1 / 6);
/** Super-ellipse slice distance, scaled to an in-slice distance (continuous across the halves). */
function sliceDist(dx: number, dz: number, a: number, cf: number, cb: number, nf: number, nb: number) {
  const front = dz > 0;
  const c = front ? cf : cb, n = front ? nf : nb;
  const u = Math.abs(dx) / a, v = Math.abs(dz) / c;
  return (Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n) - 1) * softMin3(a, cf, cb);
}
/** A field divided by its numerical gradient: a usable distance from a loft's raw field. */
function normalised(raw: (x: number, y: number, z: number) => number, h = 0.0006): SDF {
  return (x, y, z) => {
    const f0 = raw(x, y, z);
    const gx = (raw(x + h, y, z) - raw(x - h, y, z)) / (2 * h);
    const gy = (raw(x, y + h, z) - raw(x, y - h, z)) / (2 * h);
    const gz = (raw(x, y, z + h) - raw(x, y, z - h)) / (2 * h);
    return f0 / Math.max(0.25, Math.hypot(gx, gy, gz));
  };
}
/** Skip a part far from its box (returns the distance to the box beyond `margin`). */
function boxed(f: SDF, lo: V3, hi: V3, margin = 0.03): SDF {
  return (x, y, z) => {
    const dx = Math.max(lo[0] - x, 0, x - hi[0]), dy = Math.max(lo[1] - y, 0, y - hi[1]), dz = Math.max(lo[2] - z, 0, z - hi[2]);
    const d = Math.hypot(dx, dy, dz);
    return d > margin ? d : f(x, y, z);
  };
}
const widest = (runs: Run[]): Run => runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

/** The sheet's ¾ view: its turn and the offset of the figure's axis from the measured centre
 *  line (found by silhouette search in dev/figureSheet.ts). */
export const Q34 = { yaw: 36, dxPx: 18 };

/**
 * The ¾-view edge of one half of a slice: the extreme of u = x·cosψ − z·sinψ over the front half
 * (its minimum: the front of the figure's right side) or the back half (its maximum: the back of
 * the left side). Front and side views fix a slice's width and depth; this edge fixes how full it
 * is on the diagonal, i.e. its squareness — which two views alone cannot.
 */
function sliceExtreme(a: number, zc: number, c: number, n: number, half: 'front' | 'back', cp: number, sp: number) {
  let best = half === 'front' ? Infinity : -Infinity;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * (Math.PI / 2);
    const px = a * Math.pow(Math.cos(t), 2 / n), pz = c * Math.pow(Math.sin(t), 2 / n);
    if (half === 'front') best = Math.min(best, -px * cp - (zc + pz) * sp);
    else best = Math.max(best, px * cp - (zc - pz) * sp);
  }
  return best;
}
/**
 * The squareness that gives a slice the ¾-view width `target` (clamped to [lo, hi]). Fitting the
 * width, not the edges, makes the fit immune to small shifts of the figure between the sheet's
 * views (its ¾ pose is not exactly the front pose turned).
 */
function fitWidth(a: number, zc: number, c: number, target: number, cp: number, sp: number, lo = 1.6, hi = 3.2) {
  const g = (n: number) => sliceExtreme(a, zc, c, n, 'back', cp, sp) - sliceExtreme(a, zc, c, n, 'front', cp, sp);
  const gl = g(lo), gh = g(hi);
  if ((target - gl) * (target - gh) > 0) return Math.abs(target - gl) < Math.abs(target - gh) ? lo : hi;
  let a0 = lo, b0 = hi;
  for (let i = 0; i < 30; i++) {
    const m = (a0 + b0) / 2;
    if ((g(m) - target) * (gl - target) > 0) a0 = m;
    else b0 = m;
  }
  return (a0 + b0) / 2;
}
/** As fitWidth, but only the front half's squareness varies (the back half keeps `nb`). */
function fitWidthFront(a: number, zc: number, c: number, target: number, nb: number, cp: number, sp: number, lo = 1.2, hi = 2.4) {
  const back = sliceExtreme(a, zc, c, nb, 'back', cp, sp);
  const g = (n: number) => back - sliceExtreme(a, zc, c, n, 'front', cp, sp);
  const gl = g(lo), gh = g(hi);
  if ((target - gl) * (target - gh) > 0) return Math.abs(target - gl) < Math.abs(target - gh) ? lo : hi;
  let a0 = lo, b0 = hi;
  for (let i = 0; i < 30; i++) {
    const m = (a0 + b0) / 2;
    if ((g(m) - target) * (gl - target) > 0) a0 = m;
    else b0 = m;
  }
  return (a0 + b0) / 2;
}
/** The squareness that puts a slice's ¾-view edge on `target` (clamped to [lo, hi]). */
export function fitSquareness(a: number, zc: number, c: number, target: number, half: 'front' | 'back', cp: number, sp: number, lo = 1.6, hi = 4.0) {
  const g = (n: number) => sliceExtreme(a, zc, c, n, half, cp, sp);
  const gl = g(lo), gh = g(hi);
  if ((target - gl) * (target - gh) > 0) return Math.abs(target - gl) < Math.abs(target - gh) ? lo : hi;
  let a0 = lo, b0 = hi;
  for (let i = 0; i < 30; i++) {
    const m = (a0 + b0) / 2;
    if ((g(m) - target) * (gl - target) > 0) a0 = m;
    else b0 = m;
  }
  return (a0 + b0) / 2;
}
/** Evenly sampled values → Gaussian-smoothed linear lookup. */
function smoothTable(y0: number, step: number, vals: number[], sigma: number) {
  const n = vals.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, w = 0;
    for (let j = -Math.ceil(sigma * 2.5); j <= Math.ceil(sigma * 2.5); j++) {
      const k = Math.max(0, Math.min(n - 1, i + j)), q = Math.exp(-(j * j) / (2 * sigma * sigma));
      s += vals[k] * q;
      w += q;
    }
    out[i] = s / w;
  }
  return (y: number) => {
    const f = Math.min(n - 1.000001, Math.max(0, (y - y0) / step));
    const i = Math.floor(f), t = f - i;
    return out[i] + (out[i + 1] - out[i]) * t;
  };
}
/** Evaluate a sampled edge profile as (centre, half-extent). */
const span = (s: Sample[], y: number): [number, number] => {
  const l = interp(s, 'l', y), r = interp(s, 'r', y);
  return [(l + r) / 2, (r - l) / 2];
};

export interface Figure5 {
  /** skin: body and head (no hair) */
  f: SDF;
  /** the hair layer (its own mesh) */
  hair: SDF;
  /** head and neck only, cheap to ray-march for close-ups */
  headRegion: SDF;
  eyes: { c: V3; R: number }[];
  /** joint positions derived from the fitted forms (for the rig later) */
  joints: Record<string, V3>;
}

export function figure5SDF(refName = 'human-female'): Figure5 {
  const R = loadRef(refName);
  const FV = R.views.front, SV = R.views.side;
  const STEP = 0.005;

  // ================================================================== torso and neck
  // half-width: the silhouette below the arms' reach; behind the arms the tank top's edge;
  // under the shoulder caps (hidden by skin on skin) the shoulder girdle from anatomy; then the
  // silhouette again for the trapezius, and the neck as measured on the face close-up.
  // (below the crotch no run crosses the midline: the pelvis's width is the two thighs' extent)
  const silW = sampleProfile(FV, 0.8, 1.5, STEP, (runs) => {
    const mid = runContaining(runs, 0);
    if (mid && mid[0] < 0 && mid[1] > 0) return mid;
    const c = runs.filter((r) => Math.abs((r[0] + r[1]) / 2) < 0.2 && r[1] - r[0] > 0.05);
    return c.length ? [Math.min(...c.map((r) => r[0])), Math.max(...c.map((r) => r[1]))] : null;
  }, 3);
  // (only the run that spans the midline: above ~1.30 m the top is two straps and a bare neckline)
  const clothW = sampleProfile(FV, 1.08, 1.3, STEP, (runs) => runs.find((r) => r[0] < -0.03 && r[1] > 0.03) ?? null, 3, 'cloth');
  // the torso's own top: chest and lats under the arms, then the trapezius's slope into the neck
  // (acromion, deltoid and clavicle are shoulder forms of their own, below)
  const girdle = spline([[1.3, interp(clothW, 'r', 1.3)], [1.33, 0.121], [1.36, 0.12], [1.38, 0.113], [1.395, 0.1], [1.405, 0.086], [1.415, 0.07], [1.425, 0.057], [1.435, 0.049], [1.445, 0.0435]]);
  const neckW = spline([[1.428, 0.049], [1.44, 0.0435], [1.46, 0.0415], [1.5, 0.041]]);
  const halfW = (y: number) => {
    const sil = () => (interp(silW, 'r', y) - interp(silW, 'l', y)) / 2;
    const cloth = () => (interp(clothW, 'r', y) - interp(clothW, 'l', y)) / 2;
    if (y < 1.08) return sil();
    if (y < 1.12) return sil() + (cloth() - sil()) * sstep(1.08, 1.12, y);
    if (y < 1.3) return cloth();
    if (y < 1.44) return girdle(y);
    return girdle(y) + (neckW(y) - girdle(y)) * sstep(1.44, 1.45, y);
  };
  // depth: the side silhouette; the ribcage line runs behind the bust (the bust is its own mass)
  const ribFront = spline([[1.14, 0.125], [1.2, 0.121], [1.26, 0.113], [1.32, 0.098], [1.36, 0.075]]);
  const tFront = sampleProfile(SV, 0.8, 1.53, STEP, (runs, y) => {
    if (y > 1.455) return null;
    if (y > 1.14 && y < 1.355) return [-ribFront(y), 0];
    if (y < 0.93) return null;
    return widest(runs);
  }, 3);
  const tBack = sampleProfile(SV, 0.8, 1.53, STEP, (runs, y) => (y > 1.455 ? null : widest(runs)), 2);
  // the side silhouette's front, including the bust (for the bust's depth)
  const tDsil = sampleProfile(SV, 1.1, 1.38, STEP, (runs) => widest(runs), 2);
  // squareness of the front and back halves, fitted per height to the ¾ view: the torso's run in
  // that view is the top/shorts (clothing) between the arms; the bust's heights are left to the
  // bust, the arms' overlap above ~1.22 m to the default
  const QV = R.views.q34, ps = (Q34.yaw * Math.PI) / 180, cp = Math.cos(ps), sp = Math.sin(ps), qOff = Q34.dxPx * R.scale;
  const tSec = (y: number) => {
    const a = halfW(y), zf = -interp(tFront, 'l', y), zb = -interp(tBack, 'r', y);
    return { a, zc: (zf + zb) / 2, c: (zf - zb) / 2 };
  };
  const TN0 = 0.8, TNS = 0.005, tnf: number[] = [], tnb: number[] = [];
  for (let y = TN0; y <= 1.53 + 1e-9; y += TNS) {
    const { a, zc, c } = tSec(y);
    const run = runsAt(QV, y, 'cloth').filter((r) => r[1] - r[0] > 0.12).map((r) => [r[0] - qOff, r[1] - qOff] as Run)[0];
    const fit = run && y > 0.9 && y < 1.17 ? fitWidth(a, zc, c, run[1] - run[0], cp, sp) : NaN;
    tnf.push(fit);
    tnb.push(fit);
  }
  const fillNaN = (v: number[], def: number) => {
    const out = v.slice();
    for (let i = 0; i < out.length; i++) {
      if (!Number.isNaN(out[i])) continue;
      let a = i - 1, b = i + 1;
      while (a >= 0 && Number.isNaN(v[a])) a--;
      while (b < v.length && Number.isNaN(v[b])) b++;
      // outside the fitted range, ease back to the default over ~5 cm
      const va = a >= 0 ? v[a] : def, vb = b < v.length ? v[b] : def;
      const ta = a >= 0 ? Math.exp(-(i - a) / 10) : 0, tb = b < v.length ? Math.exp(-(b - i) / 10) : 0;
      out[i] = (va * ta + vb * tb + def * Math.max(0, 1 - ta - tb)) / Math.max(1, ta + tb + Math.max(0, 1 - ta - tb));
    }
    return out;
  };
  const torsoNF = smoothTable(TN0, TNS, fillNaN(tnf, 2.1), 3), torsoNB = smoothTable(TN0, TNS, fillNaN(tnb, 2.1), 3);
  // bust: two distinct forms on the chest wall, from anthropometry, calibrated by the sheet where it
  // is reliable. The sheet's fitted top compresses and lifts the bust and bridges the gap between
  // the breasts, so its envelope is not the body's shape; what it does fix is the apex height and
  // how far the bust stands out in profile. The natural form is taken as slightly lower (~6 mm)
  // than under the top, with the same projection. Proportions (slim 1.68 m woman, set close as in
  // the concept): bust points ~12.6 cm apart; each base ~11 cm across, its inner edge ~1 cm off the midline, its outer
  // edge at the front of the armpit (inside the chest's outline from the front); a rounded lower
  // pole that folds under, a long upper slope easing into the chest; no cleavage crease (the
  // forms do not meet) — clothing adds its own.
  // Mirrored, so always symmetric. Applied as an offset along the chest's normal, so the outer
  // side wraps round the ribcage.
  const silBust = (y: number) => Math.max(0, -interp(tDsil, 'l', y) - ribFront(y));
  let sheetApexY = 1.2, sheetApexD = 0;
  for (let y = 1.16; y <= 1.32; y += 0.0025) if (silBust(y) > sheetApexD) [sheetApexY, sheetApexD] = [y, silBust(y)];
  const apexY = sheetApexY - 0.006, apexD = sheetApexD;
  if (process.env.FIG_DEBUG) {
    console.log('bust apex', apexY.toFixed(4), apexD.toFixed(4));
    for (const y of [1.1, 1.11, 1.115, 1.12, 1.125, 1.13, 1.14, 1.3, 1.32, 1.33, 1.34, 1.35]) console.log('  y', y, 'zf', (-interp(tFront, 'l', y)).toFixed(4), 'zb', (-interp(tBack, 'r', y)).toFixed(4), 'a', halfW(y).toFixed(4));
  }
  // Under the fitted top: each side a teardrop — narrow above, full and round below — its upper
  // pole a gentle slope starting ~5 cm above the apex, its lower pole folding under; the top's
  // fabric spans the valley between them near the apex's height (so there is no deep sternal gap and
  // no cleavage line running down the chest) and softens the fold beneath. Mirrored: symmetric.
  const BX = 0.058, R_IN = 0.056, R_OUT = 0.064, R_UP = 0.078, R_DN = 0.05;
  const teardrop = (x: number, y: number) => {
    const u = Math.abs(x) - BX, v = y - apexY;
    const vv = v / (v > 0 ? R_UP : R_DN * (1 - 0.25 * sstep(0, -R_IN, u)));
    const narrow = 1 - 0.42 * sstep(0, 1, vv);
    const uu = u / ((u < 0 ? R_IN : R_OUT) * narrow);
    const q = 1 - uu * uu - vv * vv;
    if (q <= 0) return 0;
    const r = Math.hypot(uu, vv) + 1e-9;
    // round underneath (0.85, softened by the top), easing into the chest at the sides (1.25), a
    // long concave slope above (2.3) — the teardrop
    const pw = 1.25 + 1.05 * sstep(0.0, 0.8, vv / r) - 0.4 * sstep(0.3, 0.95, -vv / r);
    const e = 0.09, lo = Math.pow(e, pw);
    return (Math.pow(q + e, pw) - lo) / (Math.pow(1 + e, pw) - lo);
  };
  // the fabric's bridge: across the midline, ~55% of the apex's depth at the apex's height, fading
  // above and below and out to the domes
  const bridge = (x: number, y: number) => {
    const v = (y - apexY) / (y > apexY ? 0.05 : 0.034);
    const qv = 1 - v * v;
    const ax = Math.abs(x) / BX;
    // (a shallow valley at the midline, rising towards each side)
    return qv > 0 && ax < 1.2 ? (0.5 + 0.12 * Math.min(1, ax) ** 2) * Math.pow(qv, 1.3) * sstep(1.2, 0.6, ax) : 0;
  };
  // (a p-norm union: smooth where the forms meet, and exactly zero where neither is present)
  const bustH = (x: number, y: number) => {
    const a = teardrop(x, y), b = bridge(x, y);
    return apexD * Math.pow(a * a * a + b * b * b, 1 / 3);
  };

  const torsoRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.8), 1.53);
    const a = halfW(yy);
    const zf = -interp(tFront, 'l', yy), zb = -interp(tBack, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    const nn = y > 1.42 ? 2.0 : 0;
    let d = sliceDist(x, z - zc, a, c, c, nn || torsoNF(yy), nn || torsoNB(yy));
    if (y > 1.12 && y < 1.36 && z > zc - 0.1 * c) {
      const h = bustH(x, y);
      if (h > 0) d -= h * sstep(zc - 0.1 * c, zc + 0.45 * c, z);
    }
    return smax(d, y - 1.53, 0.01);
  };
  const torso = normalised((x, y, z) => smax(torsoRaw(x, y, z), 0.8 - y, 0.02));

  // bust under a fitted top: each side a fuller lower pole under a flatter upper slope that rises
  // into the chest, turned slightly outwards; the fabric bridges a shallow valley between them


  // ================================================================== legs
  const lW = sampleProfile(FV, 0.06, 0.99, STEP, (runs, y) => {
    // above the crotch the thigh's top stays just inside the hip's outline (the torso draws the
    // hip; a thigh on the same line would swell it where they blend)
    const inset = 0;
    if (y > 0.835) {
      const t = runContaining(runs, 0);
      return t ? [0.004, t[1] - inset] : null;
    }
    const r = runs.find((q) => (q[0] + q[1]) / 2 > 0.0 && (q[0] + q[1]) / 2 < 0.22 && q[1] - q[0] > 0.03);
    return r ? [r[0], r[1] - inset] : null;
  }, 2);
  // profile: the thighs' front is hidden by the hands between 0.74 and 0.93 m
  const lDraw = sampleProfile(SV, 0.06, 0.99, STEP, (runs) => widest(runs), 2);
  const lD: Sample[] = lDraw.map((s) => ({ ...s }));
  {
    const A = lDraw.filter((s) => s.y <= 0.735).pop()!, B = lDraw.find((s) => s.y >= 0.93)!;
    for (const s of lD) if (s.y > 0.735 && s.y < 0.93) s.l = A.l + ((B.l - A.l) * (s.y - A.y)) / (B.y - A.y);
    // above the groin the thigh's front turns back into the hip crease (the belly is the torso's)
    for (const s of lD) if (s.y > 0.86) s.l = s.l + (-0.055 - s.l) * sstep(0.86, 1.0, s.y);
    // the ankle: in profile the sheet shows the instep in front and the Achilles and heel behind;
    // the leg's own column is the slim lower shin between them (the foot adds the rest)
    for (const s of lD) {
      const w = 1 - sstep(0.16, 0.24, s.y);
      if (w > 0) {
        s.l = s.l + (Math.max(s.l, -0.024) - s.l) * w;
        s.r = s.r + (Math.min(s.r, 0.052) - s.r) * w;
      }
    }
  }
  // squareness fitted on the ¾ view: its left leg-run's left edge is the front-outer side of the
  // right leg, its right leg-run's right edge the back-outer side of the left leg (mirror images)
  const lnf: number[] = [], lnb: number[] = [];
  const LN0 = 0.06;
  for (let y = LN0; y <= 0.99 + 1e-9; y += TNS) {
    const a = span(lW, y)[1];
    const zf = -interp(lD, 'l', y), zb = -interp(lD, 'r', y);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    const legs = runsAt(QV, y, 'skin').filter((r) => r[1] - r[0] > 0.04).map((r) => [r[0] - qOff, r[1] - qOff] as Run);
    const ok = y > 0.12 && y < 0.7 && legs.length >= 2;
    // both legs' ¾ widths (mirror images: average them). The back of the leg (calf, hamstrings)
    // stays elliptical; the front's sharpness is fitted — keen along the shin, round on the thigh
    const wAvg = ok ? (legs[0][1] - legs[0][0] + legs[legs.length - 1][1] - legs[legs.length - 1][0]) / 2 : 0;
    // (bounded near the ellipse: the ¾ render is a perspective shot, and a keen front reads as a
    // ridge down the leg)
    lnf.push(ok ? fitWidthFront(a, zc, c, wAvg, 2.0, cp, sp, 1.8, 2.3) : NaN);
    lnb.push(2.0);
  }
  const legNF = smoothTable(LN0, TNS, fillNaN(lnf, 2.0), 3), legNB = smoothTable(LN0, TNS, fillNaN(lnb, 2.0), 3);
  const legRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.06), 0.99);
    const [xc, a] = span(lW, yy);
    const zf = -interp(lD, 'l', yy), zb = -interp(lD, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    let d = sliceDist(Math.abs(x) - xc, z - zc, a, c, c, legNF(yy), legNB(yy));
    d = smax(d, 0.07 - y, 0.03);
    return smax(d, y - 1.0, 0.03);
  };
  // pelvis ↔ thighs: between 0.81 and 0.9 m the two sections are morphed (their fields
  // interpolated), not unioned — the two legs' slices become the pelvis's single slice, so the
  // crotch closes naturally and nothing swells where the outlines coincide
  const lowerRaw = (x: number, y: number, z: number) => {
    if (y < 0.81) return legRaw(x, y, z);
    if (y > 0.9) return torsoRaw(x, y, z);
    const t = sstep(0.81, 0.9, y);
    return legRaw(x, y, z) * (1 - t) + torsoRaw(x, y, z) * t;
  };
  const trunk = normalised(lowerRaw);

  // feet (block-in, fitted to the sheet's profile and front views): a heel pad, the foot's body
  // lofted from heel to toes with a raised inner arch, a hint of the big toe, the ankle bones
  // (inner higher and further forward than outer), and the Achilles tendon rising from the heel
  // Foot frame: origin under the ankle at (FOOT_X, 0, 0), v along the foot (turned out), u across.
  const FOOT_X = 0.123, TOE_OUT = (8 * Math.PI) / 180, co = Math.cos(TOE_OUT), si = Math.sin(TOE_OUT);
  const footTop = spline([[-0.05, 0.072], [-0.02, 0.078], [0.01, 0.073], [0.04, 0.061], [0.07, 0.049], [0.1, 0.039], [0.12, 0.033], [0.14, 0.028], [0.158, 0.024], [0.17, 0.019], [0.178, 0.011]]);
  const footW = spline([[-0.05, 0.028], [-0.02, 0.031], [0.02, 0.034], [0.06, 0.039], [0.1, 0.045], [0.125, 0.046], [0.15, 0.042], [0.168, 0.034], [0.178, 0.022]]);
  const toFoot = (x: number, z: number): [number, number] => {
    const dx = Math.abs(x) - FOOT_X;
    return [dx * co - z * si, dx * si + z * co];
  };
  const footBodyRaw = (x: number, y: number, z: number) => {
    const [u, v] = toFoot(x, z);
    const vv = Math.min(Math.max(v, -0.05), 0.178);
    const top = footTop(vv), w = footW(vv);
    // inner arch: the sole lifts on the inner side between heel and ball
    const arch = 0.009 * sstep(0.0, -0.03, u) * sstep(-0.035, 0.0, v) * sstep(0.1, 0.06, v);
    const bot = arch, hy = Math.max(0.003, (top - bot) / 2);
    let d = sliceDist(u, y - (bot + hy), w, hy, hy, 2.6, 2.6);
    d = smax(d, Math.max(-0.05 - v, v - 0.16), 0.02);
    return smax(d, -y, 0.004);
  };
  const footLocal = (u: number, y: number, v: number): V3 => [FOOT_X + u * co + v * si, y, -u * si + v * co];
  const heel = ellipsoid(footLocal(0.002, 0.026, -0.042), [0.021, 0.026, 0.028]);
  // toes: the big toe, and the four small toes as one row, each ending in a rounded tip
  const bigToe = capsule(footLocal(-0.023, 0.013, 0.126), footLocal(-0.022, 0.012, 0.172), 0.0125);
  const smallToes = blend(0.008, capsule(footLocal(-0.004, 0.01, 0.12), footLocal(-0.002, 0.009, 0.158), 0.0095), capsule(footLocal(0.012, 0.009, 0.112), footLocal(0.016, 0.008, 0.146), 0.0088), capsule(footLocal(0.027, 0.008, 0.1), footLocal(0.031, 0.007, 0.128), 0.0078));
  const malleoli = blend(0.004, sphere(footLocal(-0.02, 0.078, -0.01), 0.0085), sphere(footLocal(0.022, 0.066, -0.019), 0.0085));
  const achilles = roundCone(footLocal(0, 0.045, -0.06), footLocal(0, 0.21, -0.06), 0.0098, 0.0125);
  const footOne = blend(0.01, normalised(footBodyRaw), heel, bigToe, smallToes);
  const feetRaw = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    let d = footOne(ax, y, z);
    d = smin(d, achilles(ax, y, z), 0.012);
    return smin(d, malleoli(ax, y, z), 0.008);
  };
  const feet = boxed(feetRaw, [-0.2, -0.01, -0.12], [0.2, 0.26, 0.2]);

  // ================================================================== arms and hands (A-pose)
  // front: the arm's own skin run (outermost); profile: its skin against the top
  const outerSkin = (runs: Run[], minC: number): Run | null => {
    const r = runs.filter((q) => (q[0] + q[1]) / 2 > minC);
    return r.length ? [Math.min(...r.map((q) => q[0])), Math.max(...r.map((q) => q[1]))] : null;
  };
  const aW = sampleProfile(FV, 0.9, 1.4, STEP, (runs, y) => {
    const r = outerSkin(runs.filter((q) => q[1] > 0.1), 0.11);
    if (!r) return null;
    // over the shoulder the skin run starts at the top's strap: the arm is at most ~7.5 cm across
    return y > 1.29 ? [Math.max(r[0], r[1] - 0.075), r[1]] : r;
  }, 2, 'skin');
  const aD = sampleProfile(SV, 0.9, 1.4, STEP, (runs, y) => (y > 1.22 || y < 0.925 ? null : widest(runs)), 2, 'skin');
  // the arm's loft ends under the deltoid; the shoulder is built from its own forms
  const armRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.9), 1.33);
    const [xc, a] = span(aW, yy);
    const [zm, c] = span(aD, yy);
    let d = sliceDist(Math.abs(x) - xc, z + zm, a, c, c, 2.0, 2.0);
    d = smax(d, y - 1.335, 0.03);
    // the forearm rounds off inside the hand's wrist (a flat cap shows as a ring)
    return smax(d, 0.895 - y, 0.03);
  };
  // shoulder: the acromion's bar at the top of the shoulder, the deltoid cap wrapping the joint
  // and following the arm's slope (its outer curve is the sheet's shoulder outline), the clavicle
  // as a low ridge from the sternum out to the acromion
  const acromion = capsule([0.1, 1.389, -0.014], [0.14, 1.376, -0.01], 0.0125);
  const dC: V3 = [0.151, 1.34, -0.009];
  const deltoid = rotated(ellipsoid(dC, [0.029, 0.052, 0.039]), [0, 0, 20], dC);
  // the clavicle rides the chest's surface (its centre 4 mm under the skin): an S from the
  // sternal notch out and back to the acromion
  const surfZ = (x: number, y: number) => {
    let lo = -0.1, hi = 0.25;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (torso(x, y, m) < 0) lo = m;
      else hi = m;
    }
    return lo;
  };
  // (its outer end runs back to meet the acromion)
  const clavPts: V3[] = [...[[0.016, 1.39], [0.045, 1.393], [0.075, 1.396]].map(([x, y]) => [x, y, surfZ(x, y) - 0.0042] as V3), [0.1, 1.394, 0.0]];
  const clavicle: SDF = (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < clavPts.length - 1; i++) d = smin(d, capsule(clavPts[i], clavPts[i + 1], 0.0055)(x, y, z), 0.006);
    return d;
  };
  const shoulderOne = blend(0.02, acromion, deltoid);
  // hands: the kit's sculpted hand, hanging (fingers long and together, a slight curl, thumb
  // forward, palm to the thigh), slender, scaled to the sheet's hand length (wrist to fingertip
  // 0.905 → 0.765 m) and hung from the wrist along the forearm, fingers a touch forward
  const HS = 0.93;
  const wristP: V3 = [span(aW, 0.905)[0], 0.905, -span(aD, 0.93)[0]];
  const armTilt = (Math.atan2(span(aW, 0.93)[0] - span(aW, 1.03)[0], 0.1) * 180) / Math.PI;
  const handCanon = handSDF('hang', { slim: 0.78 });
  const handPlaced: SDF = (x, y, z) => handCanon((x - wristP[0]) / HS, (y - wristP[1]) / HS, (z - wristP[2]) / HS) * HS;
  const handOne = rotated(handPlaced, [-14, 0, armTilt], wristP);
  const armsRaw = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    let d = armRaw(ax, y, z);
    d = smin(d, shoulderOne(ax, y, z), 0.02);
    return smin(d, handOne(ax, y, z), 0.02);
  };
  const arms = boxed(normalised(armsRaw), [-0.36, 0.72, -0.12], [0.36, 1.43, 0.14]);
  const clavicles = mirrorX(clavicle);

  // ================================================================== head (block-in) and hair
  const H = head5Block(refName);
  const head: SDF = (x, y, z) => H.head(x, y - H.origin[1], z - H.origin[2]);
  const hair: SDF = (x, y, z) => H.hair(x, y - H.origin[1], z - H.origin[2]);

  const bodyLegs = trunk;
  const withFeet = blend(0.025, bodyLegs, feet);
  const withArms = blend(0.022, blend(0.008, withFeet, clavicles), arms);
  const f = blend(0.026, withArms, boxed(head, [-0.12, 1.4, -0.13], [0.12, 1.72, 0.16]));
  const headNeck = blend(0.026, torso, head);

  const armC = (y: number): V3 => {
    const [xc] = span(aW, y), [zm] = span(aD, Math.min(1.22, y));
    return [xc, y, -zm];
  };
  const joints: Record<string, V3> = {
    pelvis: [0, 0.93, 0.0],
    neck: [0, 1.43, 0.0],
    head: [0, 1.5, 0.01],
    armL: armC(1.36),
    foreL: armC(1.1),
    handL: wristP,
    thighL: [span(lW, 0.83)[0], 0.88, 0],
    shinL: [span(lW, 0.5)[0], 0.5, 0.01],
    footL: [FOOT_X, 0.075, -0.02],
  };
  if (process.env.FIG_DEBUG) {
    const row = (name: string, fn: (y: number) => number, y0: number, y1: number) => {
      let r = name.padEnd(8);
      for (let y = y0; y <= y1 + 1e-9; y += 0.04) r += ` ${y.toFixed(2)}:${fn(y).toFixed(2)}`;
      console.log(r);
    };
    row('torsoNF', torsoNF, 0.84, 1.44);
    row('torsoNB', torsoNB, 0.84, 1.44);
    row('legNF', legNF, 0.08, 0.96);
    row('legNB', legNB, 0.08, 0.96);
  }
  return {
    f,
    hair,
    headRegion: headNeck,
    eyes: H.eyes.map((e) => ({ c: [e.c[0], e.c[1] + H.origin[1], e.c[2] + H.origin[2]] as V3, R: e.R })),
    joints,
  };
}
void (null as unknown as RefView);

// ====================================================================== head block-in
/**
 * The head's big masses, in head-local metres (origin on the eye line above the ear, 1.56 m up):
 * skull and face as a loft of two-half super-ellipse slices closing over the crown, the jaw cut
 * along the jawline, a nose wedge, eye sockets with the eyeballs under closed lids, and ears.
 * The hair is a separate layer: the skull grown by the hair's thickness above the hairline, with
 * a bun, as a shell whose inside sits just under the scalp.
 *
 * Measured on the sheet: heights from the full figure (skull top +0.12, hairline +0.076, glabella
 * +0.019, eyes 0, nose base −0.044, chin −0.105); the face's outline from the front close-up,
 * scaled by the pupils' spacing (6.34 cm), where the cheeks and jaw stand against the grey
 * background — true silhouette, not shading: half-width 0.066 across the cheekbones (−0.025),
 * 0.063 at the nose base, 0.057 at the mouth, 0.053 at the jaw's angle (−0.07). Below that the jaw
 * is seen against the neck (the silhouette there is the neck's), so its line is read where the
 * lit jaw meets the neck: 0.047 at −0.08, 0.039 at −0.089, 0.028 at −0.098, 0.013 at −0.107 — a
 * smooth sweep to a small chin. Full cheeks, a high soft jaw angle, a tapered chin: an oval face.
 * Below the mouth the slices are as wide as the jaw's U; the mandible's lower border (a cut)
 * shapes the jawline and chin, as the bone does.
 */
export function head5Block(refName = 'human-female') {
  const origin: V3 = [0, 1.56, 0];
  const TOP = 0.12, DOME = 0.04;
  // the face's profile at the midline (the sheet's side view)…
  const zfProf = spline([[DOME + 0.05, 0.113], [DOME + 0.02, 0.113], [0.04, 0.113], [0.03, 0.1155], [0.019, 0.1168], [0.01, 0.1135], [0.0, 0.1105], [-0.015, 0.1095], [-0.03, 0.1105], [-0.04, 0.1125], [-0.05, 0.1145], [-0.063, 0.1115], [-0.073, 0.108], [-0.082, 0.1063], [-0.09, 0.1058], [-0.097, 0.1], [-0.105, 0.088], [-0.12, 0.066], [-0.14, 0.05]]);
  // …and the face mass's front, which is smooth below the nose: the lips over the teeth's arch and
  // the chin stand out from it only near the midline (as local forms, below), so they do not drag
  // the whole slice — cheeks and all — forward and back with them
  const zfK = spline([[DOME + 0.05, 0.113], [DOME + 0.02, 0.113], [0.04, 0.113], [0.03, 0.1155], [0.019, 0.1168], [0.01, 0.1135], [0.0, 0.1105], [-0.015, 0.1092], [-0.03, 0.1075], [-0.045, 0.1055], [-0.06, 0.1035], [-0.075, 0.1018], [-0.085, 0.1015], [-0.093, 0.1005], [-0.1, 0.0965], [-0.106, 0.088], [-0.12, 0.066], [-0.14, 0.05]]);
  // midline forms: how far the profile stands in front of the mass, and how wide (half-width)
  const muzzleW = spline([[-0.035, 0.03], [-0.06, 0.029], [-0.075, 0.027], [-0.09, 0.025], [-0.1, 0.024]]);
  const zbK = spline([[DOME + 0.05, -0.066], [DOME + 0.02, -0.067], [0.04, -0.067], [0.0, -0.066], [-0.02, -0.062], [-0.04, -0.055], [-0.06, -0.047], [-0.08, -0.042], [-0.14, -0.042]]);
  const czK = spline([[DOME + 0.05, -0.004], [0.04, -0.004], [0.0, 0.0], [-0.04, 0.006], [-0.07, 0.014], [-0.1, 0.02], [-0.14, 0.02]]);
  // the cranium (widest above the ears) narrows over the temples into the face outline below
  const aK = spline([[DOME + 0.05, 0.071], [DOME + 0.02, 0.071], [0.04, 0.071], [0.02, 0.069], [0.0, 0.0655], [-0.012, 0.0652], [-0.025, 0.066], [-0.035, 0.065], [-0.045, 0.0625], [-0.055, 0.0597], [-0.062, 0.0573], [-0.068, 0.055], [-0.075, 0.0524], [-0.082, 0.0496], [-0.09, 0.0464], [-0.1, 0.0424], [-0.11, 0.0392], [-0.14, 0.037]]);
  const nFK = spline([[0.08, 2.0], [0.035, 2.2], [0.008, 2.35], [-0.02, 2.3], [-0.045, 2.15], [-0.065, 2.0], [-0.1, 1.9]]);
  const PD = 2.2;
  const loftRaw = (x: number, y: number, z: number) => loftBase(x, y, z) - midline(x, y, z);
  const midline = (x: number, y: number, z: number) => {
    if (y > -0.005 || y < -0.115) return 0;
    const d = (zfProf(y) - zfK(y)) * sstep(-0.005, -0.03, y);
    if (d <= 0) return 0;
    const w = muzzleW(y);
    const cz = Math.min(czK(y), zfK(y) - 0.014);
    return d * Math.exp(-((x / w) ** 2)) * sstep(cz + 0.3 * (zfK(y) - cz), zfK(y) - 0.004, z);
  };
  const loftBase = (x: number, y: number, z: number) => {
    const zf = zfK(y), zb = zbK(y), a = aK(y), nf = nFK(y);
    // (the centre stays well behind the front: below the chin the border's sweep would pass it)
    const cz = Math.min(czK(y), zf - 0.014);
    const cf = zf - cz, cb = cz - zb;
    const dz = z - cz;
    const c = dz > 0 ? cf : cb, n = dz > 0 ? nf : 2.1;
    const rho = Math.pow(Math.pow(Math.abs(x) / a, n) + Math.pow(Math.abs(dz) / c, n), 1 / n);
    const r = softMin3(a, cf, cb);
    if (y <= DOME) return (rho - 1) * r;
    const t = (y - DOME) / (TOP - DOME);
    return (Math.pow(Math.pow(rho, PD) + Math.pow(Math.max(0, t), PD), 1 / PD) - 1) * r;
  };
  const loft = normalised(loftRaw);
  // jawline: from a soft, high angle of the jaw forward and down to the chin; the neck joins beneath
  // the mandible's lower border, from the chin (menton) round to the angle of the jaw (gonion): in
  // front view it follows the edge where the lit jaw meets the neck on the sheet's close-up; in plan
  // it curves back from the chin to the angle. Below the border the head is cut away; behind it the
  // jaw's underside rises towards the throat, where the neck joins.
  // The border in front view is the sheet's jaw outline (ref/face_front.py → human-female-face.json),
  // set lower by the amount the border's rounding lifts the visible edge (measured: most under the
  // flat of the chin, least along the sloping jaw).
  const JAW: [number, number][] = loadJson(refJsonPath(`${refName}-face`)).jaw;
  const lift = spline([[0, 0.0097], [0.0125, 0.0076], [0.02, 0.0057], [0.03, 0.0052], [0.035, 0.0061], [0.045, 0.0061], [0.05, 0.0077], [0.055, 0.0125], [0.0575, 0.0173]]);
  // (beyond the angle the border does not continue: the face above the angle is not cut)
  const borderY = spline([...JAW.map(([x, y]) => [x, y - lift(x)] as [number, number]), [0.062, -0.068], [0.075, -0.072]]);
  const borderZ = spline([[0, 0.09], [0.013, 0.086], [0.028, 0.073], [0.039, 0.059], [0.047, 0.045], [0.053, 0.031], [0.058, 0.018], [0.064, 0.004], [0.075, -0.01]]);
  const UNDER = 0.55; // slope of the underside behind the border
  // (the underside rises behind the border only medially, towards the throat; laterally, under the
  // jaw's angle, there is only air below the border — a slope there would cut into the cheek)
  const jawCut = (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const w = 1 - sstep(0.034, 0.05, ax);
    const ys = borderY(ax) + UNDER * w * Math.min(0.05, Math.max(0, borderZ(ax) - z));
    return (ys - y) / Math.hypot(1, UNDER * w);
  };
  // behind the jaw's rising back edge (the ramus, from the angle up to just in front of the ear)
  // and below the skull's base, the head gives way to the neck
  const rA = [-0.062, 0.018], rB = [-0.03, 0.009];
  const rLen = Math.hypot(rB[0] - rA[0], rB[1] - rA[1]);
  const ramus = (y: number, z: number) => ((rB[0] - rA[0]) * (z - rA[1]) - (rB[1] - rA[1]) * (y - rA[0])) / rLen;
  const skullBase = (y: number) => -0.036 - y;
  const skull: SDF = (x, y, z) => smax(loft(x, y, z), smax(jawCut(x, y, z), smin(-ramus(y, z), skullBase(y), 0.02), 0.012), 0.017);

  // nose wedge: slices whose apex follows the nose's profile
  const ridge = spline([[0.024, 0.104], [0.012, 0.1152], [0.0, 0.1178], [-0.015, 0.1212], [-0.027, 0.1258], [-0.034, 0.128], [-0.038, 0.1272], [-0.041, 0.1225], [-0.043, 0.1165], [-0.046, 0.111]]);
  const noseA = spline([[0.02, 0.005], [0.01, 0.0058], [0.0, 0.0066], [-0.02, 0.0076], [-0.03, 0.009], [-0.037, 0.0106], [-0.041, 0.0113], [-0.046, 0.0095]]);
  const NZC = 0.103;
  const noseRaw = (x: number, y: number, z: number) => {
    const c = Math.max(0.003, ridge(y) - NZC), a = noseA(y);
    const d = sliceDist(x, Math.max(0, z - NZC), a, c, c, 1.7, 1.7);
    return smax(smax(d, -0.0445 - y, 0.004), y - 0.02, 0.006);
  };
  const nose = normalised(noseRaw);

  // eye sockets with the eyeballs' mass under closed lids (the block-in places the eyes; the eyes
  // themselves are step 2)
  const eyeR = 0.0115;
  const eyes = [{ c: [0.0317, 0.001, 0.0875] as V3, R: eyeR }, { c: [-0.0317, 0.001, 0.0875] as V3, R: eyeR }];
  const socket = mirrorX(ellipsoid([0.0317, 0.003, 0.1015], [0.0175, 0.0125, 0.0095]));
  const lidBall = mirrorX(sphere([0.0317, 0.001, 0.0875], eyeR + 0.0012));

  // ears: a little behind the jaw's angle, standing off the skull (their lobes level with the
  // nose's base, their tops with the brows)
  // (the sheet's ears span 0.072–0.087 from the midline, from the eye line down to −0.048)
  const earC: V3 = [0.071, -0.023, -0.008];
  const ear = mirrorX(rotated(rotated(ellipsoid(earC, [0.0085, 0.026, 0.0145]), [0, -24, 0], earC), [-14, 0, 0], earC));

  const faceAndSkull: SDF = (x, y, z) => {
    let d = skull(x, y, z);
    if (z > 0.05 && y > -0.065 && y < 0.035 && Math.abs(x) < 0.03) d = smin(d, nose(x, y, z), 0.005);
    if (z > 0.06 && Math.abs(y) < 0.03) {
      d = smax(d, -socket(x, y, z), 0.008);
      d = smin(d, lidBall(x, y, z), 0.006);
    }
    return d;
  };
  const head: SDF = (x, y, z) => smin(faceAndSkull(x, y, z), ear(x, y, z), 0.006);

  // ---- hair layer: the skull grown by the hair's thickness above the hairline, and a bun
  // (keys mirrored through θ = 0 and θ = π so the splines are flat there: no crease at the midline)
  const sym = (k: [number, number][]) => spline([...k, ...k.filter(([t]) => t > 0 && t < 0.8).map(([t, v]) => [-t, v] as [number, number]), ...k.filter(([t]) => t > 2.4 && t < Math.PI).map(([t, v]) => [2 * Math.PI - t, v] as [number, number])]);
  const hairlineK = sym([[0, 0.074], [0.45, 0.061], [0.85, 0.041], [1.15, 0.031], [1.45, 0.028], [1.8, 0.02], [2.1, -0.03], [2.5, -0.072], [Math.PI, -0.085]]);
  const thickK = sym([[0, 0.012], [0.4, 0.013], [0.8, 0.016], [1.5, 0.02], [2.3, 0.027], [2.7, 0.029], [Math.PI, 0.03]]);
  const hairOuter: SDF = (x, y, z) => {
    const th = Math.atan2(Math.abs(x), z);
    const hl = hairlineK(th);
    const edge = sstep(hl - 0.002, hl + 0.045, y);
    // near the head's vertical axis the angle is undefined: fade to the mean thickness there
    const axisW = sstep(0.0, 0.035, Math.hypot(x, z + 0.004));
    const tTh = 0.021 + (thickK(th) - 0.021) * axisW;
    const t = tTh * edge * (y > 0.08 ? 1 - 0.25 * sstep(0.08, 0.12, y) : 1);
    return smax(loft(x, y, z) - t, hl - 0.004 - y, 0.01);
  };
  const bun = ellipsoid([0, 0.149, -0.05], [0.05, 0.032, 0.048]);
  const hairAll = blend(0.012, hairOuter, bun);
  // a shell: its inner face 3 mm under the scalp, so it never shows through the skin
  const hair: SDF = (x, y, z) => smax(hairAll(x, y, z), -(loft(x, y, z) + 0.003), 0.002);
  return { origin, head, hair, eyes };
}
