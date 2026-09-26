// Z-fighting detector: finds pairs of triangles that lie in the same plane and overlap in area.
// Such pairs flicker at a distance (the depth buffer can't separate them), so the asset build
// reports them as warnings.

import { V3, sub, cross, dot, normalize } from '../../../src/core/math';
import type { Tri } from './mesh';

type P2 = [number, number];

function clip(subject: P2[], clipPoly: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clipPoly.length && out.length; i++) {
    const a = clipPoly[i], b = clipPoly[(i + 1) % clipPoly.length];
    const inside = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9;
    const inter = (p: P2, q: P2): P2 => {
      const a1 = b[1] - a[1], b1 = a[0] - b[0], c1 = a1 * a[0] + b1 * a[1];
      const a2 = q[1] - p[1], b2 = p[0] - q[0], c2 = a2 * p[0] + b2 * p[1];
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-12) return p;
      return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) out.push(inter(p, q));
        out.push(q);
      } else if (inside(p)) out.push(inter(p, q));
    }
  }
  return out;
}
const area = (poly: P2[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

export interface ZFight {
  at: V3;
  area: number;
  mats: [string, string];
}

/** Returns overlapping coplanar pairs with overlap area above `minArea` (m²). */
export function findZFighting(tris: Tri[], matNames: string[], minArea = 0.004): ZFight[] {
  const buckets = new Map<string, number[]>();
  const planes: { n: V3; d: number; flip: boolean }[] = [];
  const planesRaw: V3[] = [];
  tris.forEach((t, i) => {
    let n = normalize(cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0])));
    planesRaw.push(n);
    // canonical orientation so opposite-facing coplanar faces share a bucket
    const flip = n[0] < -1e-6 || (Math.abs(n[0]) <= 1e-6 && (n[1] < -1e-6 || (Math.abs(n[1]) <= 1e-6 && n[2] < 0)));
    if (flip) n = [-n[0], -n[1], -n[2]];
    const d = dot(n, t.p[0]);
    planes.push({ n, d, flip });
    // same-facing faces only: opposite-facing coplanar pairs are touching surfaces, hidden by back-face culling
    const key = `${flip ? '-' : '+'}${n[0].toFixed(2)},${n[1].toFixed(2)},${n[2].toFixed(2)},${(Math.round(d / 0.002) * 0.002).toFixed(3)}`;
    if (planesRaw[i][1] < -0.9) return; // downward faces are never seen from the RTS camera
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(i);
  });
  const out: ZFight[] = [];
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > 4000) continue;
    const n = planes[ids[0]].n;
    const u = normalize(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]));
    const v = cross(n, u);
    const proj = ids.map((i) => {
      const pts = tris[i].p.map((p) => [dot(p, u), dot(p, v)] as P2);
      if (area(pts) < 0) pts.reverse();
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { i, pts, min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
    });
    for (let a = 0; a < proj.length; a++) {
      for (let b = a + 1; b < proj.length; b++) {
        const A = proj[a], B = proj[b];
        if (A.max[0] <= B.min[0] || B.max[0] <= A.min[0] || A.max[1] <= B.min[1] || B.max[1] <= A.min[1]) continue;
        const ov = area(clip(A.pts, B.pts));
        if (ov > minArea) {
          const t = tris[A.i];
          out.push({
            at: [(t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3, (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3],
            area: ov,
            mats: [matNames[t.mat], matNames[tris[B.i].mat]],
          });
        }
      }
    }
  }
  return out;
}
