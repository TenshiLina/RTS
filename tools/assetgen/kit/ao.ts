// Offline per-vertex ambient occlusion. Baking AO into the asset gives the "remastered" soft
// contact shading for free on every backend (no SSAO pass needed on mobile / DX11-class HW).

import { V3, add, sub, scale, cross, dot, normalize, rng } from '../../../src/core/math';
import type { Tri } from './mesh';

interface Node {
  min: V3;
  max: V3;
  left?: Node;
  right?: Node;
  tris?: number[];
}

export class TriBVH {
  root: Node;
  constructor(private v0: V3[], private e1: V3[], private e2: V3[], tris: number[]) {
    this.root = this.build(tris, 0);
  }
  static fromTris(ts: { p: [V3, V3, V3] }[]) {
    const v0: V3[] = [], e1: V3[] = [], e2: V3[] = [];
    for (const t of ts) {
      v0.push(t.p[0]);
      e1.push(sub(t.p[1], t.p[0]));
      e2.push(sub(t.p[2], t.p[0]));
    }
    return new TriBVH(v0, e1, e2, ts.map((_, i) => i));
  }
  private triBounds(i: number) {
    const a = this.v0[i], b = add(a, this.e1[i]), c = add(a, this.e2[i]);
    return {
      min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])] as V3,
      max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])] as V3,
    };
  }
  private build(tris: number[], depth: number): Node {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    const cents: V3[] = [];
    for (const i of tris) {
      const b = this.triBounds(i);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], b.min[k]);
        max[k] = Math.max(max[k], b.max[k]);
      }
      cents.push(scale(add(b.min, b.max), 0.5));
    }
    if (tris.length <= 6 || depth > 32) return { min, max, tris };
    const ext = sub(max, min);
    const axis = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : ext[1] > ext[2] ? 1 : 2;
    const order = tris.map((t, i) => [t, cents[i][axis]] as [number, number]).sort((a, b) => a[1] - b[1]);
    const mid = order.length >> 1;
    return {
      min,
      max,
      left: this.build(order.slice(0, mid).map((o) => o[0]), depth + 1),
      right: this.build(order.slice(mid).map((o) => o[0]), depth + 1),
    };
  }
  /** Any hit within (tMin, tMax)? Returns hit distance or -1. */
  occluded(o: V3, d: V3, tMax: number): number {
    const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
    let best = -1;
    let limit = tMax;
    const stack: Node[] = [this.root];
    while (stack.length) {
      const n = stack.pop()!;
      // slab test
      let t0 = 0, t1 = limit;
      for (let k = 0; k < 3; k++) {
        let a = (n.min[k] - o[k]) * inv[k], b = (n.max[k] - o[k]) * inv[k];
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) break;
      }
      if (t0 > t1) continue;
      if (n.tris) {
        for (const i of n.tris) {
          const t = this.rayTri(o, d, i);
          if (t > 1e-4 && t < limit) {
            limit = t;
            best = t;
          }
        }
      } else {
        stack.push(n.left!, n.right!);
      }
    }
    return best;
  }
  private rayTri(o: V3, d: V3, i: number): number {
    const e1 = this.e1[i], e2 = this.e2[i];
    const p = cross(d, e2);
    const det = dot(e1, p);
    // det < 0 → the ray hits the triangle's back face, i.e. the origin is inside a closed
    // volume (a vertex buried in overlapping geometry). Ignore those so they don't read as 100% occluded.
    if (det < 1e-12) return -1;
    const inv = 1 / det;
    const s = sub(o, this.v0[i]);
    const u = dot(s, p) * inv;
    if (u < 0 || u > 1) return -1;
    const q = cross(s, e1);
    const v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) return -1;
    return dot(e2, q) * inv;
  }
}

export interface AOOptions {
  rays?: number;
  maxDist?: number;
  /** treat y=groundY as an infinite occluding plane (objects standing on terrain) */
  ground?: boolean;
  groundY?: number;
  strength?: number;
}

/** Returns an AO value per triangle-vertex (tris.length * 3), 1 = unoccluded. */
export function bakeAO(tris: Tri[], opts: AOOptions = {}): Float32Array {
  const { rays = 48, maxDist = 2.5, ground = true, groundY = 0, strength = 1 } = opts;
  const bvh = TriBVH.fromTris(tris);
  const out = new Float32Array(tris.length * 3);
  const cache = new Map<string, number>();
  const R = rng(1234);
  // fixed cosine-weighted hemisphere sample set (around +Z), rotated per-vertex
  const samples: V3[] = [];
  for (let i = 0; i < rays; i++) {
    const u1 = (i + R.next()) / rays, u2 = R.next();
    const r = Math.sqrt(u1), th = 2 * Math.PI * u2;
    samples.push([r * Math.cos(th), r * Math.sin(th), Math.sqrt(Math.max(0, 1 - u1))]);
  }
  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti];
    for (let k = 0; k < 3; k++) {
      const p = t.p[k], n = t.n[k];
      const key = `${p[0].toFixed(3)},${p[1].toFixed(3)},${p[2].toFixed(3)}|${n[0].toFixed(2)},${n[1].toFixed(2)},${n[2].toFixed(2)}`;
      let ao = cache.get(key);
      if (ao === undefined) {
        const tan = normalize(Math.abs(n[1]) < 0.99 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]));
        const bit = cross(n, tan);
        const o = add(p, scale(n, 0.004));
        let occ = 0;
        for (const s of samples) {
          const d: V3 = normalize(add(add(scale(tan, s[0]), scale(bit, s[1])), scale(n, s[2])));
          let hit = bvh.occluded(o, d, maxDist);
          if (ground && d[1] < -1e-4 && o[1] >= groundY - 1e-3) {
            const tg = (groundY - o[1]) / d[1];
            if (tg < maxDist && (hit < 0 || tg < hit)) hit = tg;
          }
          if (hit >= 0) occ += 1 - (hit / maxDist) * (hit / maxDist);
        }
        ao = Math.max(0, 1 - (occ / rays) * strength);
        cache.set(key, ao);
      }
      out[ti * 3 + k] = ao;
    }
  }
  return out;
}
