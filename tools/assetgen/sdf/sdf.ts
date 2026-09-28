// Signed distance functions for sculpting organic forms (faces, hands, bodies, garments).
//
// Shapes are plain closures (x, y, z) → distance, negative inside. Primitives follow Inigo
// Quilez's formulas; the smooth operators blend forms into one continuous surface, which is the
// point: a nose, a brow or a knuckle grows out of the surface instead of being a separate piece
// stuck onto it. `mesher.ts` turns a shape into triangles and `simplify.ts` reduces them.
//
// Conventions as in the rest of the asset kit: metres, +Y up, +Z forward.

import type { V3 } from '../../../src/core/math';

export type SDF = (x: number, y: number, z: number) => number;

// ------------------------------------------------------------------ primitives
export const sphere = (c: V3, r: number): SDF => {
  const [cx, cy, cz] = c;
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
};

/** Ellipsoid (a tight bound near the surface, which is all the mesher needs). */
export const ellipsoid = (c: V3, r: V3): SDF => {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / rx, py / ry, pz / rz);
    return k1 > 1e-12 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  };
};

/** Capsule between a and b. */
export const capsule = (a: V3, b: V3, r: number): SDF => roundCone(a, b, r, r);

/** Cone with rounded ends: radius ra at a, rb at b (exact, iq). */
export const roundCone = (a: V3, b: V3, ra: number, rb: number): SDF => {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yv = pax * bax + pay * bay + paz * baz;
    const zv = yv - l2;
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = yv * yv * l2;
    const z2 = zv * zv * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
  };
};

/** Box with centre c, half-extents h, corner rounding r. */
export const box = (c: V3, h: V3, r = 0): SDF => {
  const [cx, cy, cz] = c;
  const hx = h[0] - r, hy = h[1] - r, hz = h[2] - r;
  return (x, y, z) => {
    const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
};

/** Torus around the Y axis through c: ring radius R, tube radius r. */
export const torus = (c: V3, R: number, r: number): SDF => {
  const [cx, cy, cz] = c;
  return (x, y, z) => Math.hypot(Math.hypot(x - cx, z - cz) - R, y - cy) - r;
};

/** Half-space: negative on the side opposite the normal n (unit), boundary through p. */
export const plane = (p: V3, n: V3): SDF => {
  const d = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
  return (x, y, z) => x * n[0] + y * n[1] + z * n[2] - d;
};

/** A smooth tube along a polyline, radius varying along its length (t 0..1). */
export const sweep = (pts: V3[], radius: (t: number) => number): SDF => {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = cum[n - 1] || 1;
  return (x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
      const l2 = bx * bx + by * by + bz * bz || 1e-12;
      let h = ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / l2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const d = Math.hypot(x - a[0] - bx * h, y - a[1] - by * h, z - a[2] - bz * h) - radius((cum[i] + h * (cum[i + 1] - cum[i])) / L);
      if (d < best) best = d;
    }
    return best;
  };
};

/**
 * Skip evaluating a small feature far from where it lives: outside its bounding sphere (centre c,
 * radius r) the distance to that sphere is returned instead — a lower bound of the true
 * distance, which leaves blends and carves unchanged as long as the margin exceeds their width.
 */
export const bounded = (f: SDF, c: V3, r: number, margin = 0.02): SDF => {
  const [cx, cy, cz] = c;
  return (x, y, z) => {
    const d = Math.hypot(x - cx, y - cy, z - cz) - r;
    return d > margin ? d : f(x, y, z);
  };
};
/** As `bounded`, for features authored on +X and mirrored with `mirrorX`. */
export const boundedX = (f: SDF, c: V3, r: number, margin = 0.02): SDF => {
  const [cx, cy, cz] = c;
  return (x, y, z) => {
    const d = Math.hypot(Math.abs(x) - cx, y - cy, z - cz) - r;
    return d > margin ? d : f(x, y, z);
  };
};

// ------------------------------------------------------------------ operators
/** Polynomial smooth minimum (k = blend width in metres). */
export function smin(a: number, b: number, k: number) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number) {
  return -smin(-a, -b, k);
}

export const union = (...s: SDF[]): SDF => (x, y, z) => {
  let d = Infinity;
  for (const f of s) {
    const v = f(x, y, z);
    if (v < d) d = v;
  }
  return d;
};
/** Blend shapes into one surface. */
export const blend = (k: number, ...s: SDF[]): SDF => (x, y, z) => {
  let d = s[0](x, y, z);
  for (let i = 1; i < s.length; i++) d = smin(d, s[i](x, y, z), k);
  return d;
};
/** Carve `b` out of `a` with a rounded edge of width k. */
export const carve = (a: SDF, b: SDF, k = 0): SDF => (x, y, z) => smax(a(x, y, z), -b(x, y, z), k);
export const intersect = (a: SDF, b: SDF, k = 0): SDF => (x, y, z) => smax(a(x, y, z), b(x, y, z), k);
/** Grow (+) or shrink (−) a shape. */
export const offset = (a: SDF, r: number): SDF => (x, y, z) => a(x, y, z) - r;
/** Hollow shell of thickness t centred on the surface. */
export const shell = (a: SDF, t: number): SDF => (x, y, z) => Math.abs(a(x, y, z)) - t * 0.5;
/** Add a displacement field (positive pushes the surface inwards). Keep it small. */
export const displace = (a: SDF, f: (x: number, y: number, z: number) => number): SDF => (x, y, z) => a(x, y, z) + f(x, y, z);
/** Mirror the shape across the YZ plane (features authored on the +X side appear on both). */
export const mirrorX = (a: SDF): SDF => (x, y, z) => a(Math.abs(x), y, z);
export const translate = (a: SDF, t: V3): SDF => (x, y, z) => a(x - t[0], y - t[1], z - t[2]);
/** Uniform scale about the origin. */
export const scaled = (a: SDF, s: number): SDF => (x, y, z) => a(x / s, y / s, z / s) * s;

/**
 * Rotate a shape (Euler degrees, applied X then Y then Z like the mesh kit) about a pivot.
 * Evaluates the shape at the inverse-rotated point.
 */
export const rotated = (a: SDF, deg: V3, pivot: V3 = [0, 0, 0]): SDF => {
  const m = rotMatrix(deg);
  // inverse = transpose
  const [px, py, pz] = pivot;
  return (x, y, z) => {
    const lx = x - px, ly = y - py, lz = z - pz;
    return a(
      m[0] * lx + m[1] * ly + m[2] * lz + px,
      m[3] * lx + m[4] * ly + m[5] * lz + py,
      m[6] * lx + m[7] * ly + m[8] * lz + pz,
    );
  };
};

/** Column-major 3x3 rotation for Euler degrees (X, then Y, then Z) — matches quatEuler. */
export function rotMatrix(deg: V3): number[] {
  const [ax, ay, az] = deg.map((d) => (d * Math.PI) / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  // R = Rz * Ry * Rx (rotate about X first)
  const rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  return mul3x3(rz, mul3x3(ry, rx));
}
function mul3x3(a: number[], b: number[]) {
  const o = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) o[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return o;
}

/** Numerical gradient (unnormalised) by central differences. */
export function gradient(f: SDF, x: number, y: number, z: number, e = 1e-4): V3 {
  return [
    (f(x + e, y, z) - f(x - e, y, z)) / (2 * e),
    (f(x, y + e, z) - f(x, y - e, z)) / (2 * e),
    (f(x, y, z + e) - f(x, y, z - e)) / (2 * e),
  ];
}
/** Unit normal from a 4-sample tetrahedral gradient. */
export function normalAt(f: SDF, x: number, y: number, z: number, e = 1e-4): V3 {
  const a = f(x + e, y - e, z - e), b = f(x - e, y - e, z + e), c = f(x - e, y + e, z - e), d = f(x + e, y + e, z + e);
  const gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
/** Move a point onto the zero set along the gradient (a few Newton steps). */
export function project(f: SDF, p: V3, iters = 4, maxStep = Infinity): V3 {
  let [x, y, z] = p;
  for (let i = 0; i < iters; i++) {
    const d = f(x, y, z);
    if (Math.abs(d) < 1e-7) break;
    const g = gradient(f, x, y, z);
    const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (g2 < 1e-12) break;
    let sx = (d * g[0]) / g2, sy = (d * g[1]) / g2, sz = (d * g[2]) / g2;
    const sl = Math.hypot(sx, sy, sz);
    if (sl > maxStep) {
      const k = maxStep / sl;
      sx *= k; sy *= k; sz *= k;
    }
    x -= sx; y -= sy; z -= sz;
  }
  return [x, y, z];
}

/**
 * Ambient occlusion from the distance field: how much the space above a surface point is
 * crowded by nearby surfaces (0 = open, 1 = deep crevice). Used to bake cavity shading.
 */
export function sdfOcclusion(f: SDF, p: V3, n: V3, reach = 0.012, steps = 5): number {
  let occ = 0, w = 1, tot = 0;
  for (let i = 1; i <= steps; i++) {
    const h = (reach * i) / steps;
    const d = f(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h);
    occ += w * Math.max(0, h - d) / h;
    tot += w;
    w *= 0.75;
  }
  return Math.min(1, occ / tot);
}
