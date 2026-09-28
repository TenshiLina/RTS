// Texture charts for painted triangles.
//
// Primitives that know their own parametrisation (tubes, lathes, surfaces, spheres) bring a
// natural chart (Tri.ct, in metres). Everything else — SDF sculpts, boxes, blobs — is unwrapped
// automatically: triangles are grown into regions whose normals stay within a cone, and each
// region is projected onto the plane facing its average normal.

import type { Tri } from '../kit/mesh';
import type { MaterialDef } from '../../../src/core/materialModel';
import { specOf } from './paint';

export interface Chart {
  /** indices into the mesh's triangle list */
  tris: number[];
  /** chart-local coordinates in metres, 6 per triangle (same order as `tris`) */
  uv: Float64Array;
  /** texel density multiplier */
  density: number;
}

const CONE = Math.cos((58 * Math.PI) / 180);
const CREASE = Math.cos((75 * Math.PI) / 180);

export function unwrap(tris: Tri[], mats: MaterialDef[]): Chart[] {
  const byPiece = new Map<number, number[]>();
  tris.forEach((t, i) => {
    if (!specOf(mats[t.mat])) return;
    // pieces never mix materials (a primitive emits one material) but guard anyway
    const key = (t.piece ?? 0) * 4096 + t.mat;
    let l = byPiece.get(key);
    if (!l) byPiece.set(key, (l = []));
    l.push(i);
  });
  const charts: Chart[] = [];
  for (const list of byPiece.values()) {
    const density = specOf(mats[tris[list[0]].mat])!.density ?? 1;
    if (list.every((i) => tris[i].ct)) {
      const uv = new Float64Array(list.length * 6);
      list.forEach((ti, k) => {
        const ct = tris[ti].ct!;
        for (let v = 0; v < 3; v++) {
          uv[k * 6 + v * 2] = ct[v][0];
          uv[k * 6 + v * 2 + 1] = ct[v][1];
        }
      });
      charts.push({ tris: list, uv, density });
      continue;
    }
    for (const c of autoCharts(tris, list)) charts.push({ ...c, density });
  }
  return charts;
}

function autoCharts(tris: Tri[], list: number[]): { tris: number[]; uv: Float64Array }[] {
  // weld by position to find neighbours
  const vid = new Map<string, number>();
  const key = (p: number[]) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
  const tv: number[][] = list.map((ti) => tris[ti].p.map((p) => {
    const k = key(p);
    let id = vid.get(k);
    if (id === undefined) vid.set(k, (id = vid.size));
    return id;
  }));
  const edges = new Map<string, number[]>();
  tv.forEach((v, li) => {
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let l = edges.get(k);
      if (!l) edges.set(k, (l = []));
      l.push(li);
    }
  });
  const nb: number[][] = list.map(() => []);
  for (const l of edges.values()) {
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
      nb[l[i]].push(l[j]);
      nb[l[j]].push(l[i]);
    }
  }
  const fn = list.map((ti) => {
    const [a, b, c] = tris[ti].p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(n[0], n[1], n[2]) || 1e-20;
    return { n: [n[0] / l, n[1] / l, n[2] / l], area: l / 2 };
  });
  const order = list.map((_, i) => i).sort((a, b) => fn[b].area - fn[a].area);
  const chartOf = new Int32Array(list.length).fill(-1);
  const out: { tris: number[]; uv: Float64Array }[] = [];
  for (const seed of order) {
    if (chartOf[seed] >= 0) continue;
    const id = out.length;
    const members = [seed];
    chartOf[seed] = id;
    const sum = fn[seed].n.map((x) => x * fn[seed].area);
    const queue = [seed];
    while (queue.length) {
      const t = queue.shift()!;
      const sl = Math.hypot(sum[0], sum[1], sum[2]) || 1;
      for (const u of nb[t]) {
        if (chartOf[u] >= 0) continue;
        const nu = fn[u].n;
        if ((nu[0] * sum[0] + nu[1] * sum[1] + nu[2] * sum[2]) / sl < CONE) continue;
        const nt = fn[t].n;
        if (nu[0] * nt[0] + nu[1] * nt[1] + nu[2] * nt[2] < CREASE) continue;
        chartOf[u] = id;
        members.push(u);
        queue.push(u);
        for (let k = 0; k < 3; k++) sum[k] += nu[k] * fn[u].area;
      }
    }
    // project onto the plane facing the chart's mean normal
    const l = Math.hypot(sum[0], sum[1], sum[2]) || 1;
    const N = [sum[0] / l, sum[1] / l, sum[2] / l];
    const ref = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let t = [N[1] * ref[2] - N[2] * ref[1], N[2] * ref[0] - N[0] * ref[2], N[0] * ref[1] - N[1] * ref[0]];
    const tl = Math.hypot(t[0], t[1], t[2]);
    t = t.map((x) => x / tl);
    const b = [N[1] * t[2] - N[2] * t[1], N[2] * t[0] - N[0] * t[2], N[0] * t[1] - N[1] * t[0]];
    const uv = new Float64Array(members.length * 6);
    members.forEach((m, k) => {
      const tri = tris[list[m]];
      for (let v = 0; v < 3; v++) {
        const p = tri.p[v];
        uv[k * 6 + v * 2] = p[0] * t[0] + p[1] * t[1] + p[2] * t[2];
        uv[k * 6 + v * 2 + 1] = p[0] * b[0] + p[1] * b[1] + p[2] * b[2];
      }
    });
    out.push({ tris: members.map((m) => list[m]), uv });
  }
  return out;
}
