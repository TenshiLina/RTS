// Head v4 — anatomy first, restrained stylisation.
//
// Built like a portrait sculpt is blocked in, not from blobs:
//   1. the head's mass is a loft of horizontal cross-sections (super-ellipses whose front depth,
//      back depth and width follow measured profiles from crown to chin) — this fixes the
//      front outline, the profile and the big planes directly;
//   2. the jaw is its own form (a U in plan view, cut underneath by the jawline running from
//      the jaw angle to the chin) and the neck a column, joined with narrow blends so the
//      jawline reads;
//   3. facial features are shallow *displacements* of the front of that mass — nose, lips and
//      philtrum, brow ridge, eye sockets, cheekbones — never added volumes, so nothing swells;
//   4. eyelids follow the eyeball's own curvature around an almond opening drawn from upper
//      and lower lid curves; the eyeball (a separate mesh) shows through it.
//
// Landmarks follow classic proportions (facial thirds, eyes at mid-height, one eye-width
// between the eyes, mouth corners under the pupils) on a 0.25 m heroic head.
// Head-local frame: origin at the head centre, metres, +Y up, +Z forward, +X = the character's left.

import type { V3 } from '../../../src/core/math';
import { SDF, ellipsoid, blend, mirrorX, rotated, smax, smin, boundedX } from '../sdf/sdf';
import { tps, gridded, TpsPoint } from '../sdf/tps';
import { earSDF } from './ear4';

export interface FaceShape {
  width: number;
  /** >1 broad square jaw and strong chin, <1 narrow and soft */
  jaw: number;
  /** nose size (length, projection, width) */
  nose: number;
  /** eye size */
  eyes: number;
  /** lip fullness */
  lips: number;
  /** brow-ridge strength */
  brow: number;
  /** cheekbone prominence */
  cheek: number;
  /** outer-corner lift of the eyes (degrees) */
  tilt: number;
  /** 0..1 upper-lid fold covering the inner corner (epicanthic fold) */
  fold: number;
}
export const DEFAULT_SHAPE: FaceShape = { width: 1, jaw: 1, nose: 1, eyes: 1, lips: 1, brow: 1, cheek: 1, tilt: 4, fold: 0.5 };

// ------------------------------------------------------------------ profiles
/** Natural cubic spline through (y, value) keys (descending y), C2-smooth, clamped at the ends. */
function curve(keys: [number, number][]) {
  const n = keys.length;
  const X = keys.map((k) => -k[0]), Y = keys.map((k) => k[1]); // ascending in −y
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
  return (y: number) => {
    const x = -y;
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let i = 0;
    while (i < n - 2 && x > X[i + 1]) i++;
    const t = x - X[i];
    return Y[i] + b[i] * t + c[i] * t * t + d[i] * t * t * t;
  };
}
/** Catmull-Rom through (y, value) keys, clamped at the ends. */
export function curveCR(keys: [number, number][]) {
  const ys = keys.map((k) => k[0]);
  return (y: number) => {
    if (y >= ys[0]) return keys[0][1];
    const n = keys.length;
    if (y <= ys[n - 1]) return keys[n - 1][1];
    let i = 0;
    while (i < n - 2 && y < ys[i + 1]) i++;
    const t = (y - ys[i]) / (ys[i + 1] - ys[i]);
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(n - 1, i + 2)][1];
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  };
}

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const g2 = (dx: number, dy: number, rx: number, ry: number) => Math.exp(-(dx * dx) / (rx * rx) - (dy * dy) / (ry * ry));
const g1 = (d: number, r: number) => Math.exp(-(d * d) / (r * r));

export interface HeadSculpt4 {
  f: SDF;
  eyes: { c: V3; R: number }[];
  shape: FaceShape;
  age: number;
  /** analytic feature maps in front projection (x, y), for painters */
  feat: {
    /** signed distance to the eye opening (negative inside), for the +X eye (use |x|) */
    aperture: (ax: number, y: number) => number;
    /** the same, for a point on the surface (measured over the eyeball, as the lids are cut) */
    apertureAt: (ax: number, y: number, z: number) => number;
    /** upper-lid curve y(x) (for lash lines and creases) */
    lidUp: (ax: number) => number;
    lidLo: (ax: number) => number;
    /** brow curve: centre y and half-thickness at |x| (null outside the brow) */
    brow: (ax: number) => { y: number; half: number } | null;
    /** 0..1 lip mask and which lip (+1 upper, −1 lower) */
    lips: (x: number, y: number) => { m: number; upper: boolean };
    /** upper border, parting and lower edge of the lips at x */
    lipLines: (x: number) => { top: number; mid: number; bottom: number; t: number };
    mouthY: (x: number) => number;
    E: V3;
    R: number;
  };
}

export function headSDF4(shape: Partial<FaceShape> = {}, age = 0.2): HeadSculpt4 {
  const S: FaceShape = { ...DEFAULT_SHAPE, ...shape };
  const W = S.width, J = S.jaw, N = S.nose;

  // ---- 1. the head's mass: a loft of horizontal slices, each two half super-ellipses (front and
  // back) joined at the slice's widest point. Proportions follow adult anthropometry scaled to a
  // 0.24 m heroic head (length ~0.195, breadth ~0.156, cheekbone breadth ~0.15, jaw ~0.116).
  // Above DOME the slices close over the crown; below the mouth they run on under the chin and
  // the jawline cuts them (step 3).
  const TOP = 0.121, DOME = 0.03;
  const JW = 0.9 + 0.1 * J;
  const zfK = curve([[DOME + 0.05, 0.096], [DOME + 0.02, 0.096], [DOME, 0.096], [0.015, 0.0945], [0.0, 0.094], [-0.015, 0.0945], [-0.03, 0.0955], [-0.05, 0.0965], [-0.064, 0.0965], [-0.076, 0.0945], [-0.086, 0.0925], [-0.094, 0.0935 + 0.002 * (J - 1)], [-0.101, 0.095 + 0.003 * (J - 1)], [-0.108, 0.0925 + 0.003 * (J - 1)], [-0.114, 0.087 + 0.002 * (J - 1)], [-0.12, 0.078], [-0.13, 0.064], [-0.15, 0.045]]);
  const zbK = curve([[DOME + 0.05, -0.1], [DOME + 0.02, -0.1], [DOME, -0.1], [0.0, -0.098], [-0.02, -0.094], [-0.04, -0.086], [-0.055, -0.078], [-0.07, -0.073], [-0.09, -0.071], [-0.15, -0.071]]);
  const czK = curve([[DOME + 0.05, -0.013], [DOME + 0.02, -0.013], [DOME, -0.012], [0.0, -0.006], [-0.02, -0.002], [-0.04, -0.006], [-0.06, -0.014], [-0.08, -0.02], [-0.1, -0.02], [-0.15, -0.02]]);
  const aK = curve([[DOME + 0.05, 0.078], [DOME + 0.02, 0.078], [DOME, 0.078], [0.01, 0.0765], [-0.01, 0.0745], [-0.025, 0.0725], [-0.04, 0.0697], [-0.055, 0.0668], [-0.07, 0.0632 * (0.95 + 0.05 * J)], [-0.084, 0.058 * JW], [-0.1, 0.05 * JW], [-0.11, 0.043 * JW], [-0.12, 0.038 * JW], [-0.15, 0.036 * JW]]);
  // squareness of the front (the face is flat between the orbits and turns at the cheekbones;
  // the muzzle is round) and of the back
  const nFK = curve([[0.07, 2.0], [0.035, 2.2], [0.01, 2.5], [-0.02, 2.5], [-0.045, 2.25], [-0.065, 2.05], [-0.1, 2.0]]);
  const nBK = curve([[0.06, 2.1], [0.0, 2.2], [-0.05, 2.1], [-0.1, 2.0]]);
  const PD = 2.2;
  const slice = (y: number) => {
    const cz = czK(y);
    return { cz, cf: zfK(y) - cz, cb: cz - zbK(y), a: aK(y) * W, nf: nFK(y), nb: nBK(y) };
  };
  // above DOME the DOME slice closes over the crown as a super-ellipsoid: the surface is where
  // (ρ^PD + t^PD) = 1, ρ the slice's own normalised radius and t the height through the dome
  const loftF = (x: number, y: number, z: number) => {
    const s = slice(y);
    const zz = z - s.cz;
    const c = zz > 0 ? s.cf : s.cb, n = zz > 0 ? s.nf : s.nb;
    const u = Math.abs(x) / s.a, v = Math.abs(zz) / c;
    const rho = Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);
    // scaled to an in-slice distance, so the field stays well conditioned where slices shrink
    const r = Math.min(s.a, s.cf, s.cb); // (one scale for both halves: continuous where they meet)
    if (y <= DOME) return (rho - 1) * r;
    const t = (y - DOME) / (TOP - DOME);
    return (Math.pow(Math.pow(rho, PD) + Math.pow(t, PD), 1 / PD) - 1) * r;
  };
  /** front surface depth of the loft at (x, y) (for displacement targets) */
  const loftFront = (x: number, y: number) => {
    const s = slice(y);
    const k = y <= DOME ? 1 : Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, (y - DOME) / (TOP - DOME)), PD)), 1 / PD);
    if (k <= 0) return s.cz;
    const u = Math.min(1, Math.abs(x) / (s.a * k));
    return s.cz + s.cf * k * Math.pow(Math.max(0, 1 - Math.pow(u, s.nf)), 1 / s.nf);
  };
  // the jawline in profile: from the jaw angle (gonion) forward and down to the chin (menton);
  // everything below it is cut away and the neck joins underneath
  const yG = -0.084 - 0.004 * (J - 1), zG = -0.024, yM = -0.117 - 0.002 * (J - 1), zM = 0.064;
  const jawS = (yM - yG) / (zM - zG);
  const jawCut = (y: number, z: number) => (yG + (z - zG) * jawS - y) / Math.hypot(1, jawS);
  const CHIN_BOTTOM = yM;

  // ---- 2. features as displacements of the front (metres, + = forward)
  const R = 0.0126 * S.eyes;
  const E: V3 = [0.032 * W, 0.005, 0.0745];
  // eye opening: an almond between upper and lower lid curves, outer corner lifted
  const xin = E[0] - 0.0158 * S.eyes, xout = E[0] + 0.0164 * S.eyes;
  const tilt = Math.tan((S.tilt * Math.PI) / 180);
  const tOf = (ax: number) => (ax - xin) / (xout - xin);
  const cornerY = (t: number) => E[1] - 0.0008 + (t - 0.5) * (xout - xin) * tilt;
  const lidUp = (ax: number) => {
    const t = sat(tOf(ax));
    // highest a little inside of centre
    return cornerY(t) + 0.0045 * S.eyes * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.95);
  };
  const lidLo = (ax: number) => {
    const t = sat(tOf(ax));
    // lowest a little outside of centre
    return cornerY(t) - 0.0043 * S.eyes * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 1.05);
  };
  const aperture = (ax: number, y: number) => Math.max(y - lidUp(ax), lidLo(ax) - y, xin - ax, ax - xout);
  /** a point's position measured over the eyeball's surface (arc lengths from the eye's axis), so
   *  the opening wraps round the globe at the corners as real lids do */
  const eyeArc = (ax: number, y: number, z: number): [number, number, number] => {
    const dx = ax - E[0], dy = y - E[1], dz = z - E[2];
    return [E[0] + R * Math.atan2(dx, dz), E[1] + R * Math.atan2(dy, Math.hypot(dx, dz)), Math.hypot(dx, dy, dz)];
  };
  /** signed distance to the eye opening (negative inside), with the epicanthic fold over the inner corner */
  const apertureAt = (ax: number, y: number, z: number) => {
    const [qx, qy] = eyeArc(ax, y, z);
    return aperture(qx, qy) + S.fold * 0.0016 * g2(qx - xin, qy - E[1], 0.0035, 0.004);
  };


  // brow ridge along the upper orbital rim
  const browLine = (ax: number) => 0.021 + 0.0045 * Math.sin(Math.PI * sat((ax - 0.008) / 0.052)) - (ax > 0.058 ? (ax - 0.058) * 0.2 : 0);
  // nose: profile height above the face and half-width, along y
  const noseH = curve([[0.015, 0], [0.006, 0.0028], [-0.008, 0.0075], [-0.02, 0.0135], [-0.028, 0.0178], [-0.034, 0.018], [-0.04, 0.0142], [-0.045, 0.0085], [-0.049, 0.0032], [-0.052, 0]]);
  const noseW = curve([[0.015, 0.0088], [0.004, 0.0068], [-0.01, 0.0078], [-0.024, 0.0105], [-0.033, 0.012], [-0.041, 0.0108], [-0.051, 0.009]]);
  // nose: one lofted form. Horizontal slices, each the front half of a super-ellipse: its apex
  // follows the nose's profile (nasion → bridge → tip → columella), its half-width the front-view
  // outline (narrow bridge, widening to the wings), its squareness keeps a crisp crest along the
  // bridge and rounds the tip. The slices end in the nasal base underneath; the nostrils are cut
  // into it and a shallow groove sets the wings off the tip, so the nose reads as one form.
  const nr = (z: number) => 0.0965 + (z - 0.0965) * N;
  const noseRidge = curve([[0.022, 0.09], [0.011, 0.0962], [0.0, nr(0.1003)], [-0.012, nr(0.1046)], [-0.022, nr(0.1093)], [-0.028, nr(0.1138)], [-0.032, nr(0.1166)], [-0.0355, nr(0.1174)], [-0.0385, nr(0.1163)], [-0.0415, nr(0.1138)], [-0.0445, nr(0.1098)], [-0.047, nr(0.1052)], [-0.049, 0.1015], [-0.052, 0.097]]);
  const noseA = curve([[0.018, 0.005], [0.01, 0.0068], [0.0, 0.0078], [-0.012, 0.0088], [-0.022, 0.0103], [-0.03, 0.0125], [-0.036, 0.0148], [-0.041, 0.0167], [-0.045, 0.0174], [-0.048, 0.0166], [-0.052, 0.013]]);
  const noseN = curve([[0.018, 1.55], [-0.015, 1.6], [-0.028, 1.7], [-0.036, 1.7], [-0.045, 1.55], [-0.052, 1.5]]);
  // each slice is widest at zc: inside the face along the bridge, in front of it at the wings, so
  // the wings curve back into the cheek
  const noseZC = curve([[0.02, 0.089], [-0.02, 0.09], [-0.03, 0.091], [-0.05, 0.092]]);
  const noseCB = curve([[0.02, 0.02], [-0.05, 0.02]]);
  const NOSE_BOT = -0.0502;
  const noseRaw = (x: number, y: number, z: number) => {
    const zc = noseZC(y);
    const front = z > zc;
    const cf = Math.max(0.003, noseRidge(y) - zc), cb = noseCB(y), a = noseA(y) * N;
    const c = front ? cf : cb, n = front ? noseN(y) : 2;
    const u = Math.abs(x) / a, v = Math.abs(z - zc) / c;
    // (one scale for both halves, so the field is continuous where they meet)
    const d = (Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n) - 1) * Math.min(a, cf, cb);
    // the nasal base: tilted up towards the tip, with a rounded rim
    return smax(smax(d, NOSE_BOT + (z - 0.1) * 0.3 - y, 0.0035), y - 0.024, 0.004);
  };
  const nosC: V3 = [0.0063 * N, NOSE_BOT + 0.0012, 0.1015 + 0.004 * (N - 1)];
  const nostril = rotated(ellipsoid(nosC, [0.0026 * N, 0.0022, 0.0044 * N]), [-10, -22, 0], nosC);
  const noseWithNostrils = (x: number, y: number, z: number) => smax(noseRaw(x, y, z), -nostril(Math.abs(x), y, z), 0.0008);
  const noseF: SDF = (x, y, z) => {
    if (y > 0.03 || y < -0.065 || z < 0.07 || Math.abs(x) > 0.04) return 0.01;
    const f0 = noseWithNostrils(x, y, z);
    const h = 0.0003;
    const gx = (noseRaw(x + h, y, z) - noseRaw(x - h, y, z)) / (2 * h);
    const gy = (noseRaw(x, y + h, z) - noseRaw(x, y - h, z)) / (2 * h);
    const gz = (noseRaw(x, y, z + h) - noseRaw(x, y, z - h)) / (2 * h);
    // (the gradient of the uncarved nose: the nostrils' own field is already a distance)
    return f0 / Math.max(0.2, Math.hypot(gx, gy, gz));
  };

  // mouth
  const mouthY = (x: number) => -0.0675 + (x / 0.025) ** 2 * 0.0003;
  const MW = 0.0255 * (0.94 + 0.06 * S.lips);
  /** the lips at x: parting line, upper and lower vermilion heights, and the taper to the corners */
  const lipGeom = (x: number) => {
    const au = Math.abs(x) / MW;
    const taper = sstep(1.0, 0.42, au);
    const L = S.lips;
    // cupid's bow: the upper border dips at the centre and peaks over the philtral columns
    const bow = 1 - 0.15 * g1(au / 0.12, 1) + 0.05 * g1((au - 0.2) / 0.08, 1);
    const hUp = 0.0068 * L * bow * (0.14 + 0.86 * Math.pow(taper, 0.7));
    const hLo = 0.0084 * L * (0.12 + 0.88 * Math.pow(taper, 0.6));
    return { my: mouthY(x), hUp, hLo, taper, au };
  };

  // ---- the face surface through anatomical landmarks (absolute depth z; head-local metres)
  // Midline first, then the character's left side (mirrored). Nose points scale with N about the
  // face beneath the nose; lips with S.lips; chin and jaw with J; everything lateral with W.
  const mid: [number, number][] = [
    [0.05, 0.0935], [0.034, 0.0975], [0.022, 0.1 + 0.0025 * (S.brow - 1)], [0.013, 0.0975],
    // (under the nose: the nose itself is its own form, below)
    [0.0, 0.0965], [-0.015, 0.0958], [-0.03, 0.0962], [-0.042, 0.097],
    [-0.049, 0.0995], [-0.055, 0.1], [-0.061, 0.0996], [-0.0675, 0.099], [-0.074, 0.0976], [-0.08, 0.0955],
    [-0.0855, 0.092], [-0.092, 0.0935 + 0.002 * (J - 1)], [-0.099, 0.096 + 0.003 * (J - 1)],
  ];
  const side: [number, number, number][] = [
    // forehead and brow ridge (follows the upper orbital rim)
    [0.03, 0.05, 0.0885], [0.05, 0.05, 0.075], [0.028, 0.068, 0.082],
    [0.019, 0.024, 0.0985 + 0.0015 * (S.brow - 1)], [0.033, 0.026, 0.094 + 0.002 * (S.brow - 1)], [0.047, 0.024, 0.085 + 0.0015 * (S.brow - 1)], [0.059, 0.019, 0.073],
    // just above the brow ridge (keeps the forehead's curve from overshooting the ridge)
    [0.018, 0.037, 0.0955], [0.033, 0.037, 0.0915], [0.047, 0.035, 0.0835],
    // the eye's surroundings: under the brow, the inner corner, the lower rim (the lids sit on this)
    [0.032, 0.016, 0.087], [0.021, 0.015, 0.091], [0.044, 0.015, 0.081],
    [0.011, 0.007, 0.0955], [0.016, 0.003, 0.088],
    [0.021, -0.006, 0.089], [0.032, -0.008, 0.087], [0.044, -0.005, 0.08], [0.051, 0.005, 0.077], [0.032, 0.005, 0.08],
    // cheekbones, cheeks
    [0.033, -0.017, 0.087], [0.046, -0.017, 0.0845 + 0.002 * (S.cheek - 1)], [0.057, -0.011, 0.0755 + 0.002 * (S.cheek - 1)], [0.064, -0.01, 0.067],
    [0.036, -0.033, 0.0865 - age * 0.003], [0.05, -0.036, 0.0765 - age * 0.004], [0.06, -0.036, 0.065],
    // under the nose
    [0.009, -0.01, 0.0945], [0.011, -0.03, 0.094], [0.012, -0.045, 0.0965],
    // cheek beside the nose
    [0.017, -0.02, 0.095], [0.022, -0.032, 0.093], [0.0245 * Math.max(1, N), -0.042, 0.0915], [0.022, -0.05, 0.095],
    // muzzle around the mouth (the lips are cut on top of it)
    [0.012, -0.056, 0.0992], [0.012, -0.0625, 0.0985], [0.02, -0.063, 0.0955], [0.0245, -0.0675, 0.092], [0.012, -0.074, 0.097], [0.02, -0.0725, 0.094],
    // around the mouth
    [0.03, -0.058, 0.0885], [0.032, -0.069, 0.0845],
    // the chin's centre (the loft carries the jaw)
    [0.013, -0.086, 0.091], [0.012, -0.097, 0.094 + 0.003 * (J - 1)],
  ];
  // Offsets act radially around a vertical axis through the head (angle θ, height y), so the
  // face turns smoothly into the sides and the offsets taper to nothing towards the ears.
  const ZC = -0.012, ARC = 0.09;
  const theta = (x: number, z: number) => Math.atan2(x, z - ZC);
  /** distance from the axis to the loft surface along θ at height y */
  const loftR = (th: number, y: number) => {
    let lo = 0.0, hi = 0.2;
    for (let it = 0; it < 30; it++) {
      const r = (lo + hi) / 2;
      if (loftF(Math.sin(th) * r, y, ZC + Math.cos(th) * r) < 0) lo = r;
      else hi = r;
    }
    return (lo + hi) / 2;
  };
  const pts: TpsPoint[] = [];
  const add = (x: number, y: number, z: number) => {
    const th = theta(x, z);
    pts.push({ x: th * ARC, y, v: Math.hypot(x, z - ZC) - loftR(th, y) });
    if (process.env.HEAD_DEBUG && x >= 0) console.log(`landmark ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)} → ${(pts[pts.length - 1].v * 1000).toFixed(1)} mm`);
  };
  for (const [y, z] of mid) add(0, y, z);
  for (const [x, y, z] of side) {
    add(x * W, y, z);
    add(-x * W, y, z);
  }
  // no offset towards the ears, over the crown, and along the sides of the jaw
  for (let y = -0.1; y <= 0.075; y += 0.0125) for (const sg of [-1, 1]) pts.push({ x: sg * 1.25 * ARC, y, v: 0 });
  for (const y of [-0.078, -0.09, -0.102]) for (const t of [0.5, 0.75, 1.0]) for (const sg of [-1, 1]) pts.push({ x: sg * t * ARC, y, v: 0 });
  for (let k = -6; k <= 6; k++) pts.push({ x: (k / 6) * 1.25 * ARC, y: 0.085, v: 0 });
  const faceR = gridded(tps(pts, 1e-9), -0.14, 0.14, -0.135, 0.1, 0.0006);
  const radialMask = (th: number, y: number) => sstep(1.4, 1.15, Math.abs(th)) * sstep(0.095, 0.08, y);
  const faceD = (x: number, y: number) => {
    // (legacy z-offset view of the radial field, for the frontal feature code below)
    void x; void y;
    return 0;
  };
  const faceMask = (_x: number, _y: number) => 1;
  const displacement = (x: number, y: number) => {
    const ax = Math.abs(x);
    // (fades out at the chin line so nothing extends below the jaw)
    let d = faceD(x, y) * faceMask(x, y);
    // lips, from their profile: s runs from the parting (0) to each lip's border (1); both lips
    // are forward-most just off the parting, roll into it, and close smoothly at the corners
    const G = lipGeom(x);
    const my = G.my;
    if (G.au < 2.4) {
      const L = S.lips;
      const t = y - my;
      const dep = Math.pow(G.taper, 0.8) * L;
      if (t >= 0) {
        const sU = t / G.hUp;
        // upper lip, with a fine ridge along its border (the white roll)
        d += dep * (0.0034 * g1((sU - 0.4) / 0.52, 1) * sstep(1.25, 0.95, sU) + 0.0004 * g1((sU - 1) / 0.1, 1));
      } else {
        const sL = -t / G.hLo;
        // lower lip: fuller, rolling under into the soft hollow above the chin
        d += dep * (0.0037 * g1((sL - 0.45) / 0.5, 1) * sstep(1.3, 0.9, sL) - 0.0011 * g1((sL - 1.45) / 0.4, 1));
      }
      // the parting: the lips press together
      d -= 0.0012 * Math.pow(G.taper, 0.5) * g1(t / 0.0007, 1);
      // a small pit at each corner, and the soft mound just outside it
      d -= 0.0009 * g2((G.au - 1) * MW, t, 0.0028, 0.0024);
      d += 0.0005 * g2((G.au - 1.25) * MW, t + 0.001, 0.004, 0.006);
    }
    // philtrum: a shallow groove between two soft columns
    const ph = sstep(-0.049, -0.052, y) * sstep(my + 0.0052, my + 0.0072, y);
    d += ph * (0.00035 * g2(ax - 0.0048, 0, 0.0028, 1) - 0.0003 * g2(ax, 0, 0.0026, 1));
    return d;
  };
  void browLine; void noseH; void noseW;

  /** depth of the landmark surface (loft + radial offset) seen from the front */
  const frontZ = (x: number, y: number) => {
    const z0 = loftFront(x, y);
    const th = theta(x, z0);
    const m = radialMask(th, y) * sstep(CHIN_BOTTOM - 0.012, CHIN_BOTTOM + 0.002, y);
    return z0 + faceR(th * ARC, y) * m * Math.cos(th);
  };
  const faceTarget = (x: number, y: number) => {
    const z0 = frontZ(x, y);
    const z1 = z0 + displacement(x, y);
    return z1;
  };

  // head SDF: the loft, its front displaced towards the face target (one continuous field)
  const loftSDF: SDF = (x, y, z) => {
    const f0 = loftF(x, y, z);
    const h = 0.0005;
    const gx = (loftF(x + h, y, z) - loftF(x - h, y, z)) / (2 * h);
    const gy = (loftF(x, y + h, z) - loftF(x, y - h, z)) / (2 * h);
    const gz = (loftF(x, y, z + h) - loftF(x, y, z - h)) / (2 * h);
    return f0 / Math.max(1e-6, Math.hypot(gx, gy, gz));
  };
  const headMass: SDF = (x, y, z) => {
    let base = loftSDF(x, y, z);
    if (base > 0.04) return base;
    // the landmark surface: radial offset
    const th = theta(x, z);
    const m = radialMask(th, y) * sstep(CHIN_BOTTOM - 0.012, CHIN_BOTTOM + 0.002, y);
    if (m > 0) base -= faceR(th * ARC, y) * m;
    // frontal features (lips, lids, philtrum): offsets in z, on the front only
    const w = sstep(0.03, 0.06, z);
    if (w <= 0) return base;
    const disp = faceTarget(x, y) - frontZ(x, y);
    return base - disp * w;
  };

  // ---- 3. jawline and neck: the jaw's underside is cut along the jawline (a narrow rounding keeps
  // it crisp), and the neck — a column leaning forward, thick for a heroic build — joins it
  // underneath with a wide blend, so the throat and the jaw's underside read as one surface
  const jawed: SDF = (x, y, z) => smax(headMass(x, y, z), jawCut(y, z), 0.009);
  const neck: SDF = (x, y, z) => {
    const zc = -0.022 + (y + 0.12) * 0.15;
    const rx = 0.055, rz = 0.05;
    return Math.max((Math.hypot(x / rx, (z - zc) / rz) - 1) * Math.min(rx, rz), y + 0.035);
  };
  let head: SDF = blend(0.022, jawed, neck);
  // the nose rises out of the face: a soft junction along the bridge, a tighter crease at the wings
  const withNose = head;
  head = (x, y, z) => {
    const a = withNose(x, y, z);
    if (y > 0.03 || y < -0.065 || z < 0.07 || Math.abs(x) > 0.04) return a;
    return smin(a, noseF(x, y, z), 0.0045 - 0.0025 * sstep(-0.03, -0.042, y));
  };
  // alar groove: a shallow furrow curving over each wing, from its front round to the cheek
  const beforeGroove = head;
  head = (x, y, z) => {
    const a = beforeGroove(x, y, z);
    if (y > -0.03 || y < -0.056 || z < 0.088 || Math.abs(x) > 0.03 || a > 0.004) return a;
    const ax = Math.abs(x) - 0.0122 * N, dy = y + 0.0436;
    const r = Math.hypot(ax, dy), ang = Math.atan2(dy, ax);
    const along = sstep(-0.5, 0.2, ang) * sstep(2.9, 2.2, ang);
    return a + 0.00055 * along * g1((r - 0.0068 * N) / 0.0011, 1);
  };

  // ---- eyes: the socket is cleared round each eyeball, then the lids are laid over it — a shell
  // on the globe (upper lid thicker than the lower) with the opening cut along the globe's
  // surface, so the margins have real thickness and the corners wrap round the eye. The crease
  // forms where the upper lid slides under the brow, the lower lid runs out into the cheek.
  const lidTu = 0.0021, lidTl = 0.0014;
  const eyeHole: SDF = (x, y, z) => Math.hypot(Math.abs(x) - E[0], y - E[1], z - E[2]) - (R + 0.0002);
  const lids: SDF = (x, y, z) => {
    const ax = Math.abs(x);
    const [qx, qy, r] = eyeArc(ax, y, z);
    if (r > R + 0.012) return r - R - 0.006;
    const T = lidTl + (lidTu - lidTl) * sstep(-0.004, 0.002, qy - E[1]);
    const shell = Math.max(r - (R + T), R - 0.0008 - r);
    const ap = aperture(qx, qy) + S.fold * 0.0016 * g2(qx - xin, qy - E[1], 0.0035, 0.004);
    return smax(shell, -ap * (r / R), 0.0007);
  };
  const beforeEyes = head;
  head = (x, y, z) => {
    const a = beforeEyes(x, y, z);
    const ax = Math.abs(x);
    if (Math.abs(ax - E[0]) > 0.03 || Math.abs(y - E[1]) > 0.03 || z < 0.05) return a;
    return smin(smax(a, -eyeHole(x, y, z), 0.0006), lids(x, y, z), 0.0012 + 0.0022 * sstep(E[1], E[1] - 0.008, y));
  };

  // ---- ears (ear4.ts): hinged at the front just behind the jaw joint, standing off the skull
  // behind; top level with the brow, lobe level with the base of the nose
  const earY = -0.012, earZ = -0.004;
  const earX = loftR(theta(0.074, earZ), earY) * Math.sin(theta(0.074, earZ)) - 0.0015;
  const E4 = earSDF({ origin: [earX, earY, earZ], standOff: 36, lean: 14, scale: 1.0 });
  const withEars = blend(0.0035, head, boundedX(mirrorX(E4.ear), E4.bound.c, E4.bound.r));
  head = (x, y, z) => {
    const a = withEars(x, y, z);
    if (Math.hypot(Math.abs(x) - E4.bound.c[0], y - E4.bound.c[1], z - E4.bound.c[2]) > E4.bound.r + 0.01) return a;
    return smax(a, -E4.concha(x, y, z), 0.0018);
  };

  // cut the neck off below (the body's neck takes over)
  const cut: SDF = (x, y, z) => Math.max(head(x, y, z), -0.205 - y);

  const lipLines = (x: number) => {
    const G = lipGeom(x);
    return { top: G.my + G.hUp * 1.02, mid: G.my, bottom: G.my - G.hLo * 1.02, t: G.au < 1 ? G.taper : 0 };
  };
  const lipsMask = (x: number, y: number) => {
    const L = lipLines(x);
    if (L.t <= 0) return { m: 0, upper: true };
    const up = sstep(L.top + 0.0004, L.top - 0.0004, y) * sstep(L.mid - 0.0003, L.mid + 0.0002, y);
    const lo = sstep(L.bottom - 0.0009, L.bottom + 0.0009, y) * sstep(L.mid + 0.0003, L.mid - 0.0002, y);
    return { m: Math.pow(L.t, 0.15) * Math.max(up, lo), upper: up >= lo };
  };
  return {
    f: cut,
    eyes: [{ c: E, R }, { c: [-E[0], E[1], E[2]], R }],
    shape: S,
    age,
    feat: {
      aperture, apertureAt, lidUp, lidLo,
      brow: (ax) => (ax > 0.009 && ax < 0.066 ? { y: 0.0215 + 0.0038 * Math.sin(Math.PI * sat((ax - 0.009) / 0.052)) - (ax > 0.054 ? (ax - 0.054) * 0.35 : 0), half: 0.0046 * (1 - sat((ax - 0.012) / 0.055) * 0.55) } : null),
      lips: lipsMask,
      lipLines,
      mouthY,
      E, R,
    },
  };
}

export { smin };

/** Where a head's triangles should go: lids and the eye opening most, then lips, nose, ears. */
export function headWeight4(hs: HeadSculpt4) {
  const E = hs.feat.E;
  return (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const eye = Math.exp(-((ax - E[0]) ** 2 + (y - E[1]) ** 2) / (0.014 * 0.014)) * (z > 0.05 ? 1 : 0);
    const mouth = Math.exp(-(x * x * 0.4 + (y + 0.068) ** 2) / (0.016 * 0.016)) * (z > 0.06 ? 1 : 0);
    const nose = Math.exp(-(x * x + (y + 0.035) ** 2) / (0.022 * 0.022)) * (z > 0.07 ? 1 : 0);
    const ear = Math.exp(-((ax - 0.074) ** 2 + (y + 0.016) ** 2 + (z + 0.018) ** 2) / (0.03 * 0.03));
    return 1 + eye * 50 + mouth * 12 + nose * 8 + ear * 6;
  };
}
