// Figure v5 — the base human, fitted to the faction's concept sheet
// (docs/art/factions/human/human-female-turnaround.webp, measured by ref/sheet.py).
//
// Step 1 of the character rework is a block-in: the big masses only, placed and proportioned
// from the sheet, so the whole figure can be judged against the concept before any detail.
// Torso and neck, legs and arms are lofts whose widths and depths are sampled straight from the
// sheet's front and side silhouettes; where the sheet cannot show a form (the torso behind the
// arms, the ribcage behind the bust, the thighs behind the hands, the skull under the hair) the
// profile is filled from anatomy. The head is a block-in of skull, face, jaw, nose wedge, eye
// sockets and ears; the hair a mass over the skull above the hairline, with a bun.
//
// Frame: metres, feet on y = 0, +Y up, +Z forward, +X the figure's left. A-pose as in the sheet.

import type { V3 } from '../../../src/core/math';
import { SDF, ellipsoid, roundCone, blend, mirrorX, rotated, smax, smin, sphere } from '../sdf/sdf';
import { loadRef, sampleProfile, interp, runContaining, Run, Sample } from '../ref/refSheet';

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
const widest = (runs: Run[]): Run => runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

export interface Figure5 {
  f: SDF;
  headRegion: SDF;
  body: SDF;
  head: SDF;
  hair: SDF;
  eyes: { c: V3; R: number }[];
  /** joint positions derived from the fitted forms (for the rig later) */
  joints: Record<string, V3>;
}

export function figure5SDF(refName = 'human-female'): Figure5 {
  const R = loadRef(refName);
  const FV = R.views.front, SV = R.views.side;
  const STEP = 0.005;

  // ================================================================== torso and neck
  // width: the front view's central run; behind the arms (1.20–1.40) the torso's own outline is
  // hidden, so it comes from anatomy: ribcage and lats widening to the armpits, the shoulder
  // girdle out to the acromion, then the sheet again for the trapezius slope into the neck.
  const hiddenW = spline([[1.195, 0.1115], [1.25, 0.121], [1.3, 0.127], [1.345, 0.134], [1.375, 0.145], [1.388, 0.142], [1.397, 0.118], [1.402, 0.096]]);
  const tW = sampleProfile(FV, 0.8, 1.53, STEP, (runs, y) => {
    if (y > 1.465) return null;
    if (y > 1.195 && y < 1.402) {
      const a = hiddenW(y);
      return [-a, a];
    }
    return runContaining(runs, 0);
  }, 3);
  // depth: the side view; the ribcage line runs behind the bust (the breasts are their own
  // masses), the thighs' front behind the hands is interpolated, and the neck is held above the chin
  const ribFront = spline([[1.14, 0.125], [1.2, 0.121], [1.26, 0.113], [1.32, 0.098], [1.36, 0.075]]);
  const tD = sampleProfile(SV, 0.8, 1.53, STEP, (runs, y) => {
    if (y > 1.455) return null;
    const r = widest(runs);
    if (y > 1.14 && y < 1.355) return [-ribFront(y), r[1]];
    if (y < 0.93) return null;
    return r;
  }, 3);
  const torsoRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.8), 1.53);
    const a = (interp(tW, 'r', yy) - interp(tW, 'l', yy)) / 2;
    const zf = -interp(tD, 'l', yy), zb = -interp(tD, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    const n = y > 1.42 ? 2.0 : 2.25;
    let d = sliceDist(x, z - zc, a, c, c, n, n);
    // the pelvis closes in a V between the thighs, down to the crotch; the loft ends in the head
    d = smax(d, 0.85 + 3 * x * x - y, 0.03);
    return smax(d, y - 1.53, 0.01);
  };
  const torso = normalised(torsoRaw);

  // bust under a fitted top: two soft masses bridged by the fabric into one shelf (the buttocks
  // are the tops of the thighs' own lofts)
  const breasts = blend(0.03, mirrorX(rotated(ellipsoid([0.057, 1.228, 0.105], [0.058, 0.056, 0.043]), [0, 14, 0], [0.057, 1.228, 0.105])), ellipsoid([0, 1.226, 0.1], [0.05, 0.045, 0.036]));

  // ================================================================== legs
  const lW = sampleProfile(FV, 0.06, 0.99, STEP, (runs, y) => {
    // above the crotch the thigh's top follows the hip's outline, from the midline outwards
    if (y > 0.835) {
      const t = runContaining(runs, 0);
      return t ? [0.004, t[1]] : null;
    }
    return runs.find((r) => (r[0] + r[1]) / 2 > 0.0 && (r[0] + r[1]) / 2 < 0.22 && r[1] - r[0] > 0.03) ?? null;
  }, 2);
  const lD = sampleProfile(SV, 0.06, 0.99, STEP, (runs, y) => {
    const r = widest(runs);
    if (y > 0.735 && y < 0.93) return [NaN, r[1]] as unknown as Run; // front hidden by the hand
    return r;
  }, 2);
  // (re-fill the front edge where it was hidden)
  {
    const ok = lD.filter((s) => !Number.isNaN(s.l));
    const A = ok.filter((s) => s.y <= 0.735).pop()!, B = ok.find((s) => s.y >= 0.93)!;
    for (const s of lD) if (Number.isNaN(s.l)) s.l = A.l + ((B.l - A.l) * (s.y - A.y)) / (B.y - A.y);
    // light re-smoothing
    const cp: Sample[] = lD.map((s) => ({ ...s }));
    for (let i = 2; i < lD.length - 2; i++) lD[i].l = (cp[i - 2].l + cp[i - 1].l + cp[i].l + cp[i + 1].l + cp[i + 2].l) / 5;
  }
  const legRaw = (x: number, y: number, z: number) => {
    const yy = Math.min(Math.max(y, 0.06), 0.99);
    const l = interp(lW, 'l', yy), r = interp(lW, 'r', yy);
    const xc = (l + r) / 2, a = (r - l) / 2;
    const zf = -interp(lD, 'l', yy), zb = -interp(lD, 'r', yy);
    const zc = (zf + zb) / 2, c = (zf - zb) / 2;
    let d = sliceDist(Math.abs(x) - xc, z - zc, a, c, c, 2.1, 2.1);
    d = smax(d, 0.07 - y, 0.03);
    return smax(d, y - 1.0, 0.03);
  };
  const legs = normalised(legRaw);

  // feet: a loft along the foot from heel to toes, turned out a little
  const footTop = spline([[-0.086, 0.0], [-0.08, 0.035], [-0.065, 0.062], [-0.04, 0.078], [-0.01, 0.083], [0.025, 0.074], [0.06, 0.058], [0.095, 0.042], [0.125, 0.03], [0.15, 0.022], [0.168, 0.012], [0.176, 0.0]]);
  const footW = spline([[-0.086, 0.018], [-0.07, 0.029], [-0.04, 0.031], [0.0, 0.034], [0.05, 0.04], [0.1, 0.046], [0.13, 0.045], [0.16, 0.036], [0.176, 0.02]]);
  const FOOT_X = 0.128, TOE_OUT = (8 * Math.PI) / 180;
  const footRaw = (x: number, y: number, z: number) => {
    // foot-local: u across, v along (heel → toes)
    const dx = Math.abs(x) - FOOT_X;
    const u = dx * Math.cos(TOE_OUT) - z * Math.sin(TOE_OUT), v = dx * Math.sin(TOE_OUT) + z * Math.cos(TOE_OUT);
    const top = footTop(v), w = footW(v);
    const vv = Math.min(Math.max(v, -0.086), 0.176);
    // cross-section: flat sole, rounded top
    const hy = Math.max(top, 0.004) / 2;
    let d = sliceDist(u, y - hy, w, hy, hy, 2.6, 2.6);
    d = Math.max(d, Math.max(-0.086 - v, v - 0.176) * 0.8);
    void vv;
    return smax(d, -y, 0.006);
  };
  const feet = normalised(footRaw);

  // ================================================================== arms (A-pose) and hands
  // the arm's own run on the front view, below the armpit; its axis is extended to the shoulder
  const aW = sampleProfile(FV, 0.905, 1.19, STEP, (runs) => {
    const r = runs.filter((q) => (q[0] + q[1]) / 2 > 0.13);
    return r.length ? r[r.length - 1] : null;
  }, 2);
  // fit the axis x = x0 + k·y through the run centres
  let sy = 0, sx = 0, syy = 0, sxy = 0;
  for (const s of aW) {
    const c = (s.l + s.r) / 2;
    sy += s.y;
    sx += c;
    syy += s.y * s.y;
    sxy += s.y * c;
  }
  const nA = aW.length;
  const kA = (nA * sxy - sy * sx) / (nA * syy - sy * sy), x0A = (sx - kA * sy) / nA;
  const cosA = 1 / Math.hypot(1, kA);
  const armX = (y: number) => x0A + kA * y;
  const armZ = spline([[0.76, 0.03], [0.905, 0.0], [1.1, -0.028], [1.38, -0.01]]);
  const upperR = spline([[1.19, ((aW[nA - 1].r - aW[nA - 1].l) / 2) * cosA], [1.25, 0.036], [1.31, 0.041], [1.35, 0.043], [1.38, 0.037]]);
  const armPts: { p: V3; r: number }[] = [];
  for (let y = 0.905; y <= 1.19 + 1e-9; y += 0.02) {
    const w = (interp(aW, 'r', y) - interp(aW, 'l', y)) / 2;
    armPts.push({ p: [armX(y), y, armZ(y)], r: w * cosA });
  }
  for (let y = 1.21; y <= 1.381; y += 0.02) armPts.push({ p: [armX(y), y, armZ(y)], r: upperR(y) });
  const armSegs: SDF[] = [];
  for (let i = 0; i < armPts.length - 1; i++) armSegs.push(roundCone(armPts[i].p, armPts[i + 1].p, armPts[i].r, armPts[i + 1].r));
  const armOne: SDF = (x, y, z) => {
    let d = Infinity;
    for (const s of armSegs) d = smin(d, s(x, y, z), 0.012);
    return d;
  };
  // hand: palm and fingers as one mitt continuing the forearm, palm facing the thigh
  const wrist: V3 = [armX(0.905), 0.905, armZ(0.905)];
  // down the arm: x grows by −kA per metre of drop; the hand angles slightly forward
  const dl = Math.hypot(kA, 1, 0.2);
  const down: V3 = [-kA / dl, -1 / dl, 0.2 / dl];
  const along = (t: number): V3 => [wrist[0] + down[0] * t, wrist[1] + down[1] * t, wrist[2] + down[2] * t];
  const tilt = (Math.atan(-kA) * 180) / Math.PI;
  const palmC = along(0.045), fingC = along(0.118);
  const handOne = blend(0.02, rotated(ellipsoid(palmC, [0.016, 0.05, 0.038]), [0, 0, tilt], palmC), rotated(ellipsoid(fingC, [0.012, 0.05, 0.032]), [0, 0, tilt], fingC));
  const arms = mirrorX((x, y, z) => smin(armOne(x, y, z), handOne(x, y, z), 0.012));

  // ================================================================== head (block-in)
  const H = head5Block();
  const head: SDF = (x, y, z) => H.head(x, y - H.origin[1], z - H.origin[2]);
  const hair: SDF = (x, y, z) => H.hair(x, y - H.origin[1], z - H.origin[2]);

  const body = blend(0.045, torso, breasts);
  const bodyLegs = blend(0.04, body, legs);
  const withFeet = blend(0.025, bodyLegs, feet);
  const withArms = blend(0.03, withFeet, arms);
  const withHead = blend(0.02, withArms, head);
  // (a hard union: the hair shell thins to the skin at the hairline, so a smooth one would swell there)
  const f: SDF = (x, y, z) => Math.min(withHead(x, y, z), hair(x, y, z));

  const joints: Record<string, V3> = {
    pelvis: [0, 0.93, 0.0],
    neck: [0, 1.43, 0.0],
    head: [0, 1.5, 0.01],
    armL: [armX(1.36), 1.36, armZ(1.36)],
    foreL: [armX(1.1), 1.1, armZ(1.1)],
    handL: wrist,
    thighL: [(interp(lW, 'l', 0.83) + interp(lW, 'r', 0.83)) / 2, 0.88, 0],
    shinL: [(interp(lW, 'l', 0.5) + interp(lW, 'r', 0.5)) / 2, 0.5, 0.01],
    footL: [FOOT_X, 0.075, -0.035],
  };
  // the head and neck alone (cheap to ray-march for close-ups)
  const headNeck = blend(0.02, torso, head);
  const headRegion: SDF = (x, y, z) => Math.min(headNeck(x, y, z), hair(x, y, z));
  return {
    f,
    headRegion,
    body: withArms,
    head: (x, y, z) => H.head(x, y - H.origin[1], z - H.origin[2]),
    hair,
    eyes: H.eyes.map((e) => ({ c: [e.c[0], e.c[1] + H.origin[1], e.c[2] + H.origin[2]] as V3, R: e.R })),
    joints,
  };
}

// ====================================================================== head block-in
/**
 * The head's big masses, in head-local metres (origin at the eye line over the ear, 1.56 m up):
 * skull and face as a loft of two-half super-ellipse slices closing over the crown, the jaw cut
 * along the jawline, a nose wedge, eye sockets with eyeballs, ears, and the hair mass.
 * Measured from the sheet: skull top +0.12, hairline +0.076, glabella +0.019, eyes 0, nose tip
 * −0.036, nose base −0.043, mouth −0.062, chin −0.099; face width 0.138, jaw 0.107, pupils ±0.0317.
 */
export function head5Block() {
  const origin: V3 = [0, 1.56, 0];
  const TOP = 0.12, DOME = 0.04;
  const zfK = spline([[DOME + 0.05, 0.113], [DOME + 0.02, 0.113], [0.04, 0.113], [0.03, 0.1155], [0.019, 0.1168], [0.01, 0.1135], [0.0, 0.1105], [-0.015, 0.1095], [-0.03, 0.1105], [-0.04, 0.1125], [-0.05, 0.1145], [-0.062, 0.1115], [-0.072, 0.108], [-0.081, 0.1062], [-0.09, 0.106], [-0.097, 0.1], [-0.105, 0.088], [-0.12, 0.066], [-0.14, 0.05]]);
  const zbK = spline([[DOME + 0.05, -0.068], [DOME + 0.02, -0.069], [0.04, -0.069], [0.0, -0.068], [-0.02, -0.063], [-0.04, -0.055], [-0.06, -0.047], [-0.08, -0.042], [-0.14, -0.042]]);
  const czK = spline([[DOME + 0.05, -0.004], [0.04, -0.004], [0.0, 0.0], [-0.04, 0.005], [-0.08, 0.012], [-0.14, 0.012]]);
  const aK = spline([[DOME + 0.05, 0.073], [DOME + 0.02, 0.073], [0.04, 0.073], [0.02, 0.0725], [0.0, 0.071], [-0.01, 0.0695], [-0.025, 0.0665], [-0.04, 0.0625], [-0.055, 0.0572], [-0.068, 0.0527], [-0.08, 0.0465], [-0.09, 0.0405], [-0.1, 0.035], [-0.14, 0.031]]);
  const nFK = spline([[0.08, 2.0], [0.035, 2.2], [0.008, 2.4], [-0.02, 2.4], [-0.045, 2.2], [-0.065, 2.05], [-0.1, 2.0]]);
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
  // jawline: from the angle of the jaw forward and down to the chin; the neck joins beneath
  const yG = -0.074, zG = 0.018, yM = -0.1, zM = 0.09;
  const jawS = (yM - yG) / (zM - zG);
  const jawCut = (y: number, z: number) => (yG + (z - zG) * jawS - y) / Math.hypot(1, jawS);
  const skull: SDF = (x, y, z) => smax(loft(x, y, z), jawCut(y, z), 0.012);

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

  // eye sockets with the eyeballs' mass under closed lids (the block-in shows where the eyes sit,
  // not the eyes themselves)
  const eyeR = 0.0115;
  const eyes = [{ c: [0.0317, 0.001, 0.0875] as V3, R: eyeR }, { c: [-0.0317, 0.001, 0.0875] as V3, R: eyeR }];
  const socket = mirrorX(ellipsoid([0.0317, 0.003, 0.1015], [0.0175, 0.0125, 0.0095]));
  const lidBall = mirrorX(sphere([0.0317, 0.001, 0.0875], eyeR + 0.0012));

  // ears: flattened masses standing a little off the skull
  const earC: V3 = [0.066, -0.013, -0.004];
  const ear = mirrorX(rotated(rotated(ellipsoid(earC, [0.0105, 0.028, 0.0155]), [0, -12, 0], earC), [-14, 0, 0], earC));

  let head: SDF = (x, y, z) => {
    let d = skull(x, y, z);
    if (z > 0.05 && y > -0.065 && y < 0.035 && Math.abs(x) < 0.03) d = smin(d, nose(x, y, z), 0.005);
    if (z > 0.06 && Math.abs(y) < 0.03) {
      d = smax(d, -socket(x, y, z), 0.008);
      d = smin(d, lidBall(x, y, z), 0.006);
    }
    return d;
  };
  const withEars = head;
  head = (x, y, z) => smin(withEars(x, y, z), ear(x, y, z), 0.006);

  // ---- hair mass: the skull grown by the hair's thickness above the hairline, and a bun
  // (keys mirrored through θ = 0 and θ = π so the splines are flat there: no crease at the midline)
  const sym = (k: [number, number][]) => spline([...k, ...k.filter(([t]) => t > 0 && t < 0.8).map(([t, v]) => [-t, v] as [number, number]), ...k.filter(([t]) => t > 2.4 && t < Math.PI).map(([t, v]) => [2 * Math.PI - t, v] as [number, number])]);
  const hairlineK = sym([[0, 0.074], [0.45, 0.061], [0.85, 0.041], [1.15, 0.031], [1.45, 0.028], [1.8, 0.02], [2.1, -0.03], [2.5, -0.072], [Math.PI, -0.085]]);
  const thickK = sym([[0, 0.012], [0.4, 0.013], [0.8, 0.015], [1.5, 0.018], [2.3, 0.026], [2.7, 0.028], [Math.PI, 0.029]]);
  const hairShell: SDF = (x, y, z) => {
    const th = Math.atan2(Math.abs(x), z - 0.0);
    const hl = hairlineK(th);
    const edge = sstep(hl - 0.002, hl + 0.045, y);
    const t = thickK(th) * edge * (y > 0.08 ? 1 - 0.25 * sstep(0.08, 0.12, y) : 1);
    return smax(loft(x, y, z) - t, hl - 0.004 - y, 0.01);
  };
  const bun = ellipsoid([0, 0.149, -0.05], [0.05, 0.032, 0.048]);
  const hair = blend(0.012, hairShell, bun);
  return { origin, head, hair, eyes };
}
