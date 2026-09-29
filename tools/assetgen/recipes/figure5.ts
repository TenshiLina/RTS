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
import { SDF, ellipsoid, blend, mirrorX, rotated, smax, smin, sphere } from '../sdf/sdf';
import { loadRef, sampleProfile, interp, runContaining, Run, Sample, RefView } from '../ref/refSheet';

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

/** Super-ellipse slice distance, scaled to an in-slice distance (continuous across the halves). */
function sliceDist(dx: number, dz: number, a: number, cf: number, cb: number, nf: number, nb: number) {
  const front = dz > 0;
  const c = front ? cf : cb, n = front ? nf : nb;
  const u = Math.abs(dx) / a, v = Math.abs(dz) / c;
  return (Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n) - 1) * Math.min(a, cf, cb);
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
  const silW = sampleProfile(FV, 0.8, 1.5, STEP, (runs) => runContaining(runs, 0), 3);
  // (only the run that spans the midline: above ~1.30 m the top is two straps and a bare neckline)
  const clothW = sampleProfile(FV, 1.08, 1.3, STEP, (runs) => runs.find((r) => r[0] < -0.03 && r[1] > 0.03) ?? null, 3, 'cloth');
  const girdle = spline([[1.3, interp(clothW, 'r', 1.3)], [1.34, 0.121], [1.37, 0.127], [1.388, 0.13], [1.397, 0.121], [1.402, 0.097]]);
  const neckW = spline([[1.428, 0.049], [1.44, 0.0435], [1.46, 0.0415], [1.5, 0.041]]);
  const halfW = (y: number) => {
    const sil = () => (interp(silW, 'r', y) - interp(silW, 'l', y)) / 2;
    const cloth = () => (interp(clothW, 'r', y) - interp(clothW, 'l', y)) / 2;
    if (y < 1.08) return sil();
    if (y < 1.12) return sil() + (cloth() - sil()) * sstep(1.08, 1.12, y);
    if (y < 1.3) return cloth();
    if (y < 1.402) return girdle(y);
    if (y < 1.425) return sil();
    if (y < 1.44) return sil() + (neckW(y) - sil()) * sstep(1.425, 1.44, y);
    return neckW(y);
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
  const torsoRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.8), 1.53);
    const a = halfW(yy);
    const zf = -interp(tFront, 'l', yy), zb = -interp(tBack, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    const n = y > 1.42 ? 2.0 : 2.25;
    let d = sliceDist(x, z - zc, a, c, c, n, n);
    // the pelvis closes between the thighs, down to the crotch; the loft ends inside the head
    d = smax(d, 0.85 + 3 * x * x - y, 0.03);
    return smax(d, y - 1.53, 0.01);
  };
  const torso = normalised(torsoRaw);

  // bust under a fitted top: each side a fuller lower pole under a flatter upper slope that rises
  // into the chest, turned slightly outwards; the fabric bridges a shallow valley between them
  const bC: V3 = [0.059, 1.228, 0.1035], uC: V3 = [0.056, 1.264, 0.09];
  const oneSide = blend(0.03, rotated(ellipsoid(bC, [0.05, 0.047, 0.049]), [0, 16, 0], bC), rotated(ellipsoid(uC, [0.05, 0.05, 0.034]), [18, 14, 0], uC));
  const bust = blend(0.02, mirrorX(oneSide), ellipsoid([0, 1.232, 0.1], [0.028, 0.034, 0.033]));

  // ================================================================== legs
  const lW = sampleProfile(FV, 0.06, 0.99, STEP, (runs, y) => {
    // above the crotch the thigh's top stays just inside the hip's outline (the torso draws the
    // hip; a thigh on the same line would swell it where they blend)
    if (y > 0.835) {
      const t = runContaining(runs, 0);
      return t ? [0.004, t[1] - 0.012 * sstep(0.835, 0.9, y)] : null;
    }
    return runs.find((r) => (r[0] + r[1]) / 2 > 0.0 && (r[0] + r[1]) / 2 < 0.22 && r[1] - r[0] > 0.03) ?? null;
  }, 2);
  // profile: the thighs' front is hidden by the hands between 0.74 and 0.93 m
  const lDraw = sampleProfile(SV, 0.06, 0.99, STEP, (runs) => widest(runs), 2);
  const lD: Sample[] = lDraw.map((s) => ({ ...s }));
  {
    const A = lDraw.filter((s) => s.y <= 0.735).pop()!, B = lDraw.find((s) => s.y >= 0.93)!;
    for (const s of lD) if (s.y > 0.735 && s.y < 0.93) s.l = A.l + ((B.l - A.l) * (s.y - A.y)) / (B.y - A.y);
    // above the groin the thigh's front turns back into the hip crease (the belly is the torso's)
    for (const s of lD) if (s.y > 0.86) s.l = s.l + (-0.055 - s.l) * sstep(0.86, 1.0, s.y);
  }
  const legRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.06), 0.99);
    const [xc, a] = span(lW, yy);
    const zf = -interp(lD, 'l', yy), zb = -interp(lD, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    let d = sliceDist(Math.abs(x) - xc, z - zc, a, c, c, 2.1, 2.1);
    d = smax(d, 0.07 - y, 0.03);
    return smax(d, y - 1.0, 0.03);
  };
  const legs = boxed(normalised(legRaw), [-0.2, 0.0, -0.13], [0.2, 1.02, 0.13]);

  // feet: a loft along the foot from heel to toes, turned out a little
  const footTop = spline([[-0.086, 0.0], [-0.08, 0.035], [-0.065, 0.062], [-0.04, 0.078], [-0.01, 0.083], [0.025, 0.074], [0.06, 0.058], [0.095, 0.042], [0.125, 0.03], [0.15, 0.022], [0.168, 0.012], [0.176, 0.0]]);
  const footW = spline([[-0.086, 0.018], [-0.07, 0.029], [-0.04, 0.031], [0.0, 0.034], [0.05, 0.04], [0.1, 0.046], [0.13, 0.045], [0.16, 0.036], [0.176, 0.02]]);
  const FOOT_X = 0.128, TOE_OUT = (8 * Math.PI) / 180;
  const footRaw = (x: number, y: number, z: number) => {
    const dx = Math.abs(x) - FOOT_X;
    const u = dx * Math.cos(TOE_OUT) - z * Math.sin(TOE_OUT), v = dx * Math.sin(TOE_OUT) + z * Math.cos(TOE_OUT);
    const top = footTop(v), w = footW(v);
    const hy = Math.max(top, 0.004) / 2;
    let d = sliceDist(u, y - hy, w, hy, hy, 2.6, 2.6);
    d = Math.max(d, Math.max(-0.086 - v, v - 0.176) * 0.8);
    return smax(d, -y, 0.006);
  };
  const feet = boxed(normalised(footRaw), [-0.2, -0.01, -0.12], [0.2, 0.12, 0.2]);

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
  // the shoulder cap: above CAP the arm's slices close like a dome, their outer edge held on the
  // sheet's deltoid outline, so the shoulder rounds over into the trapezius
  const CAP = 1.31, CAP_TOP = 1.397;
  const armRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.9), 1.4);
    let [xc, a] = span(aW, yy);
    let [zm, c] = span(aD, yy);
    if (y > CAP) {
      const t = Math.min(1, (y - CAP) / (CAP_TOP - CAP));
      const k = Math.sqrt(Math.max(0.0004, 1 - t * t));
      const outer = xc + a;
      a = Math.max(0.004, a * Math.pow(k, 0.9));
      xc = outer - a;
      c = Math.max(0.004, c * k);
    }
    let d = sliceDist(Math.abs(x) - xc, z + zm, a, c, c, 2.0, 2.0);
    d = smax(d, y - CAP_TOP, 0.008);
    // the wrist continues into the hand
    return smax(d, 0.905 - y, 0.01);
  };
  const hW = sampleProfile(FV, 0.76, 0.93, STEP, (runs) => outerSkin(runs, 0.2), 1, 'skin');
  const hD = sampleProfile(SV, 0.76, 0.93, STEP, (runs, y) => (y < 0.84 ? null : widest(runs)), 1, 'skin');
  const handRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.76), 0.93);
    const [xc, a] = span(hW, yy);
    const [zm, c] = span(hD, yy);
    // fingers taper to their tips
    const tip = sstep(0.765, 0.8, yy);
    let d = sliceDist(Math.abs(x) - xc, z + zm, Math.max(0.006, a * (0.6 + 0.4 * tip)), c * (0.75 + 0.25 * tip), c * (0.75 + 0.25 * tip), 2.2, 2.2);
    d = smax(d, 0.768 - y, 0.01);
    return smax(d, y - 0.93, 0.01);
  };
  const arms = boxed(normalised((x, y, z) => smin(armRaw(x, y, z), handRaw(x, y, z), 0.012)), [-0.36, 0.74, -0.12], [0.36, 1.42, 0.14]);

  // ================================================================== head (block-in) and hair
  const H = head5Block();
  const head: SDF = (x, y, z) => H.head(x, y - H.origin[1], z - H.origin[2]);
  const hair: SDF = (x, y, z) => H.hair(x, y - H.origin[1], z - H.origin[2]);

  const body = blend(0.04, torso, bust);
  const bodyLegs = blend(0.025, body, legs);
  const withFeet = blend(0.025, bodyLegs, feet);
  const withArms = blend(0.022, withFeet, arms);
  const f = blend(0.018, withArms, boxed(head, [-0.12, 1.4, -0.13], [0.12, 1.72, 0.16]));
  const headNeck = blend(0.018, torso, head);

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
    handL: armC(0.905),
    thighL: [span(lW, 0.83)[0], 0.88, 0],
    shinL: [span(lW, 0.5)[0], 0.5, 0.01],
    footL: [FOOT_X, 0.075, -0.035],
  };
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
 * Measured on the sheet (heights from the full figure, widths from the face close-up normalised
 * to the same eye-to-chin): skull top +0.12, hairline +0.076, glabella +0.019, eyes 0, nose tip
 * −0.036, nose base −0.043, mouth −0.063, chin −0.100; half-widths of the face outline 0.059 at
 * the eyes, 0.055 at the nose base, 0.048 at the mouth, 0.038 and 0.027 down the jaw, 0.016 at
 * the chin — a narrow, V-shaped lower face.
 */
export function head5Block() {
  const origin: V3 = [0, 1.56, 0];
  const TOP = 0.12, DOME = 0.04;
  const zfK = spline([[DOME + 0.05, 0.113], [DOME + 0.02, 0.113], [0.04, 0.113], [0.03, 0.1155], [0.019, 0.1168], [0.01, 0.1135], [0.0, 0.1105], [-0.015, 0.1095], [-0.03, 0.1105], [-0.04, 0.1125], [-0.05, 0.1145], [-0.063, 0.1115], [-0.073, 0.108], [-0.082, 0.1063], [-0.09, 0.1058], [-0.097, 0.1], [-0.105, 0.088], [-0.12, 0.066], [-0.14, 0.05]]);
  const zbK = spline([[DOME + 0.05, -0.066], [DOME + 0.02, -0.067], [0.04, -0.067], [0.0, -0.066], [-0.02, -0.062], [-0.04, -0.055], [-0.06, -0.047], [-0.08, -0.042], [-0.14, -0.042]]);
  const czK = spline([[DOME + 0.05, -0.004], [0.04, -0.004], [0.0, 0.0], [-0.04, 0.006], [-0.07, 0.014], [-0.1, 0.02], [-0.14, 0.02]]);
  // the cranium (widest above the ears) narrows over the temples into the face outline below
  const aK = spline([[DOME + 0.05, 0.07], [DOME + 0.02, 0.07], [0.04, 0.07], [0.02, 0.0668], [0.0, 0.0605], [-0.016, 0.059], [-0.03, 0.0575], [-0.041, 0.0555], [-0.052, 0.0522], [-0.063, 0.0485], [-0.071, 0.0455], [-0.078, 0.0425], [-0.085, 0.039], [-0.09, 0.0362], [-0.095, 0.0345], [-0.1, 0.0345], [-0.11, 0.033], [-0.14, 0.031]]);
  const nFK = spline([[0.08, 2.0], [0.035, 2.2], [0.008, 2.35], [-0.02, 2.3], [-0.045, 2.15], [-0.065, 2.0], [-0.1, 1.9]]);
  const PD = 2.2;
  const loftRaw = (x: number, y: number, z: number) => {
    const cz = czK(y), zf = zfK(y), zb = zbK(y), a = aK(y), nf = nFK(y);
    const cf = zf - cz, cb = cz - zb;
    const dz = z - cz;
    const c = dz > 0 ? cf : cb, n = dz > 0 ? nf : 2.1;
    const rho = Math.pow(Math.pow(Math.abs(x) / a, n) + Math.pow(Math.abs(dz) / c, n), 1 / n);
    const r = Math.min(a, cf, cb);
    if (y <= DOME) return (rho - 1) * r;
    const t = (y - DOME) / (TOP - DOME);
    return (Math.pow(Math.pow(rho, PD) + Math.pow(Math.max(0, t), PD), 1 / PD) - 1) * r;
  };
  const loft = normalised(loftRaw);
  // jawline: from a soft, high angle of the jaw forward and down to the chin; the neck joins beneath
  const yG = -0.07, zG = 0.026, yM = -0.1045, zM = 0.088;
  const jawS = (yM - yG) / (zM - zG);
  const jawCut = (y: number, z: number) => (yG + (z - zG) * jawS - y) / Math.hypot(1, jawS);
  const skull: SDF = (x, y, z) => smax(loft(x, y, z), jawCut(y, z), 0.007);

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
  const earC: V3 = [0.061, -0.016, -0.006];
  const ear = mirrorX(rotated(rotated(ellipsoid(earC, [0.0095, 0.026, 0.0145]), [0, -24, 0], earC), [-14, 0, 0], earC));

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
