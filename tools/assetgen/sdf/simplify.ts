// Quadric-error-metric mesh simplification (Garland & Heckbert) by edge collapse.
//
// Triangles gather where the surface curves — around the nose, lips, eyelids, knuckles — and
// thin out over flat areas, so a sculpt with ~100k triangles keeps its shape at a few thousand.
// Collapses that would flip a face, pinch the surface (link condition) or create slivers are
// refused; open boundaries are held in place by extra constraint planes.

import type { IndexedMesh } from './mesher';

class Heap {
  cost: number[] = [];
  a: number[] = [];
  b: number[] = [];
  va: number[] = [];
  vb: number[] = [];
  x: number[] = [];
  y: number[] = [];
  z: number[] = [];
  size = 0;
  push(c: number, a: number, b: number, va: number, vb: number, x: number, y: number, z: number) {
    let i = this.size++;
    this.cost[i] = c; this.a[i] = a; this.b[i] = b; this.va[i] = va; this.vb[i] = vb; this.x[i] = x; this.y[i] = y; this.z[i] = z;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] <= this.cost[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  private swap(i: number, j: number) {
    for (const arr of [this.cost, this.a, this.b, this.va, this.vb, this.x, this.y, this.z]) {
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }
  /** Moves the minimum to slot `size` (read it there), shrinking the heap. */
  pop() {
    const last = --this.size;
    this.swap(0, last);
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < last && this.cost[l] < this.cost[m]) m = l;
      if (r < last && this.cost[r] < this.cost[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return last;
  }
}

export interface SimplifyOptions {
  /** weight of the planes that hold open boundaries (relative to area-weighted face planes) */
  boundaryWeight?: number;
  /** refuse collapses that turn a face by more than this (cosine) */
  minNormalDot?: number;
  /** importance at a point (default 1): regions weighted higher keep more triangles */
  weight?: (x: number, y: number, z: number) => number;
}

export function simplify(mesh: IndexedMesh, targetTris: number, opts: SimplifyOptions = {}): IndexedMesh {
  const { boundaryWeight = 100, minNormalDot = 0.25, weight } = opts;
  const P = Float64Array.from(mesh.pos);
  const T = Int32Array.from(mesh.idx);
  const nv = P.length / 3, nt = T.length / 3;
  if (nt <= targetTris) return mesh;
  const Q = new Float64Array(nv * 10);
  const alive = new Uint8Array(nt).fill(1);
  const vAlive = new Uint8Array(nv).fill(1);
  const ver = new Int32Array(nv);
  const vt: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);

  const addPlane = (v: number, a: number, b: number, c: number, d: number, w: number) => {
    const q = v * 10;
    Q[q] += w * a * a; Q[q + 1] += w * a * b; Q[q + 2] += w * a * c; Q[q + 3] += w * a * d;
    Q[q + 4] += w * b * b; Q[q + 5] += w * b * c; Q[q + 6] += w * b * d;
    Q[q + 7] += w * c * c; Q[q + 8] += w * c * d; Q[q + 9] += w * d * d;
  };
  const faceNormal = (t: number, out: number[]) => {
    const i0 = T[t * 3] * 3, i1 = T[t * 3 + 1] * 3, i2 = T[t * 3 + 2] * 3;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
  };
  const n3 = [0, 0, 0];
  let meanArea = 0;
  for (let t = 0; t < nt; t++) {
    faceNormal(t, n3);
    const l = Math.hypot(n3[0], n3[1], n3[2]);
    meanArea += l / 2;
    if (l < 1e-18) continue;
    const a = n3[0] / l, b = n3[1] / l, c = n3[2] / l;
    const i0 = T[t * 3] * 3;
    const d = -(a * P[i0] + b * P[i0 + 1] + c * P[i0 + 2]);
    let w = l / 2;
    if (weight) {
      const i1 = T[t * 3 + 1] * 3, i2 = T[t * 3 + 2] * 3;
      w *= weight((P[i0] + P[i1] + P[i2]) / 3, (P[i0 + 1] + P[i1 + 1] + P[i2 + 1]) / 3, (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3);
    }
    for (let k = 0; k < 3; k++) addPlane(T[t * 3 + k], a, b, c, d, w);
  }
  meanArea /= nt;
  // boundary edges: planes through the edge, perpendicular to its face
  const edgeCount = new Map<number, number>();
  const ekey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const key = ekey(T[t * 3 + k], T[t * 3 + ((k + 1) % 3)]);
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  }
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a0 = T[t * 3 + k], b0 = T[t * 3 + ((k + 1) % 3)];
    if (edgeCount.get(ekey(a0, b0)) !== 1) continue;
    faceNormal(t, n3);
    const ex = P[b0 * 3] - P[a0 * 3], ey = P[b0 * 3 + 1] - P[a0 * 3 + 1], ez = P[b0 * 3 + 2] - P[a0 * 3 + 2];
    let px = ey * n3[2] - ez * n3[1], py = ez * n3[0] - ex * n3[2], pz = ex * n3[1] - ey * n3[0];
    const l = Math.hypot(px, py, pz);
    if (l < 1e-18) continue;
    px /= l; py /= l; pz /= l;
    const d = -(px * P[a0 * 3] + py * P[a0 * 3 + 1] + pz * P[a0 * 3 + 2]);
    const w = boundaryWeight * meanArea;
    addPlane(a0, px, py, pz, d, w);
    addPlane(b0, px, py, pz, d, w);
  }

  const qs = new Float64Array(10);
  const heap = new Heap();
  const qerrSum = (x: number, y: number, z: number) =>
    qs[0] * x * x + 2 * qs[1] * x * y + 2 * qs[2] * x * z + 2 * qs[3] * x +
    qs[4] * y * y + 2 * qs[5] * y * z + 2 * qs[6] * y +
    qs[7] * z * z + 2 * qs[8] * z + qs[9];

  const seen = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = T[t * 3 + k], b = T[t * 3 + ((k + 1) % 3)];
    const key = ekey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    pushEdgeSum(a, b);
  }

  function pushEdgeSum(a: number, b: number) {
    for (let k = 0; k < 10; k++) qs[k] = Q[a * 10 + k] + Q[b * 10 + k];
    const A = qs[0], Bq = qs[1], C = qs[2], D = qs[4], E = qs[5], F = qs[7];
    const det = A * (D * F - E * E) - Bq * (Bq * F - E * C) + C * (Bq * E - D * C);
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
    const el = Math.hypot(ax - bx, ay - by, az - bz);
    const scaleRef = Math.abs(A) + Math.abs(D) + Math.abs(F);
    let x = mx, y = my, z = mz, cost = Infinity;
    if (scaleRef > 0 && Math.abs(det) > 1e-12 * scaleRef * scaleRef * scaleRef) {
      const r0 = -qs[3], r1 = -qs[6], r2 = -qs[8];
      const ox = (r0 * (D * F - E * E) - Bq * (r1 * F - E * r2) + C * (r1 * E - D * r2)) / det;
      const oy = (A * (r1 * F - E * r2) - r0 * (Bq * F - E * C) + C * (Bq * r2 - r1 * C)) / det;
      const oz = (A * (D * r2 - r1 * E) - Bq * (Bq * r2 - r1 * C) + r0 * (Bq * E - D * C)) / det;
      if (Math.hypot(ox - mx, oy - my, oz - mz) < el * 1.5) {
        x = ox; y = oy; z = oz;
        cost = qerrSum(x, y, z);
      }
    }
    if (cost === Infinity) {
      const ea = qerrSum(ax, ay, az), eb = qerrSum(bx, by, bz), em = qerrSum(mx, my, mz);
      if (ea <= eb && ea <= em) { x = ax; y = ay; z = az; cost = ea; }
      else if (eb <= em) { x = bx; y = by; z = bz; cost = eb; }
      else { cost = em; }
    }
    // a little length penalty keeps triangles from growing into needles on flat areas
    heap.push(Math.max(0, cost) + el * el * meanArea * 1e-3, a, b, ver[a], ver[b], x, y, z);
  }

  // ---- collapse loop
  let liveTris = nt;
  const nOld = [0, 0, 0], nNew = [0, 0, 0];
  const nbA = new Set<number>(), nbB = new Set<number>();
  while (liveTris > targetTris && heap.size > 0) {
    const s = heap.pop();
    const a = heap.a[s], b = heap.b[s];
    if (!vAlive[a] || !vAlive[b] || heap.va[s] !== ver[a] || heap.vb[s] !== ver[b]) continue;
    const x = heap.x[s], y = heap.y[s], z = heap.z[s];
    // link condition: common neighbours must be exactly the apexes of the shared triangles
    nbA.clear(); nbB.clear();
    let shared = 0;
    for (const t of vt[a]) for (let k = 0; k < 3; k++) nbA.add(T[t * 3 + k]);
    for (const t of vt[b]) {
      let hasA = false;
      for (let k = 0; k < 3; k++) {
        nbB.add(T[t * 3 + k]);
        if (T[t * 3 + k] === a) hasA = true;
      }
      if (hasA) shared++;
    }
    if (shared === 0) continue;
    let common = 0;
    for (const v of nbA) if (v !== a && v !== b && nbB.has(v)) common++;
    if (common !== shared) continue;
    // flips / slivers
    let bad = false;
    for (const [v, other] of [[a, b], [b, a]]) {
      for (const t of vt[v]) {
        const i0 = T[t * 3], i1 = T[t * 3 + 1], i2 = T[t * 3 + 2];
        if (i0 === other || i1 === other || i2 === other) continue;
        faceNormal(t, nOld);
        const px = [P[i0 * 3], P[i1 * 3], P[i2 * 3]], py = [P[i0 * 3 + 1], P[i1 * 3 + 1], P[i2 * 3 + 1]], pz = [P[i0 * 3 + 2], P[i1 * 3 + 2], P[i2 * 3 + 2]];
        const kk = i0 === v ? 0 : i1 === v ? 1 : 2;
        px[kk] = x; py[kk] = y; pz[kk] = z;
        const ux = px[1] - px[0], uy = py[1] - py[0], uz = pz[1] - pz[0];
        const wx = px[2] - px[0], wy = py[2] - py[0], wz = pz[2] - pz[0];
        nNew[0] = uy * wz - uz * wy; nNew[1] = uz * wx - ux * wz; nNew[2] = ux * wy - uy * wx;
        const lo = Math.hypot(nOld[0], nOld[1], nOld[2]), ln = Math.hypot(nNew[0], nNew[1], nNew[2]);
        if (ln < 1e-16 || (nOld[0] * nNew[0] + nOld[1] * nNew[1] + nOld[2] * nNew[2]) < minNormalDot * lo * ln) {
          bad = true;
          break;
        }
        // sliver check: area vs longest edge²
        const e0 = ux * ux + uy * uy + uz * uz, e1 = wx * wx + wy * wy + wz * wz;
        const e2 = (px[2] - px[1]) ** 2 + (py[2] - py[1]) ** 2 + (pz[2] - pz[1]) ** 2;
        if (ln / Math.max(e0, e1, e2) < 0.02) {
          bad = true;
          break;
        }
      }
      if (bad) break;
    }
    if (bad) continue;
    // apply: b → a at (x, y, z)
    for (const t of vt[b]) {
      if (!alive[t]) continue;
      let hasA = false;
      for (let k = 0; k < 3; k++) if (T[t * 3 + k] === a) hasA = true;
      if (hasA) {
        alive[t] = 0;
        liveTris--;
        for (let k = 0; k < 3; k++) {
          const v = T[t * 3 + k];
          if (v !== b) {
            const list = vt[v];
            const i = list.indexOf(t);
            if (i >= 0) list.splice(i, 1);
          }
        }
      } else {
        for (let k = 0; k < 3; k++) if (T[t * 3 + k] === b) T[t * 3 + k] = a;
        vt[a].push(t);
      }
    }
    vt[b] = [];
    vAlive[b] = 0;
    P[a * 3] = x; P[a * 3 + 1] = y; P[a * 3 + 2] = z;
    for (let k = 0; k < 10; k++) Q[a * 10 + k] += Q[b * 10 + k];
    ver[a]++;
    ver[b]++;
    const nb = new Set<number>();
    for (const t of vt[a]) for (let k = 0; k < 3; k++) nb.add(T[t * 3 + k]);
    nb.delete(a);
    for (const v of nb) pushEdgeSum(a, v);
  }

  // ---- compact
  const remap = new Int32Array(nv).fill(-1);
  const outP: number[] = [];
  const outI: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (!alive[t]) continue;
    for (let k = 0; k < 3; k++) {
      const v = T[t * 3 + k];
      if (remap[v] < 0) {
        remap[v] = outP.length / 3;
        outP.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      }
      outI.push(remap[v]);
    }
  }
  return { pos: new Float64Array(outP), idx: new Uint32Array(outI) };
}
