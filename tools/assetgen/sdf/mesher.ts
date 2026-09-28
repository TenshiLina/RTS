// Narrow-band surface nets: SDF → indexed triangle mesh.
//
// The grid is only evaluated near the surface: blocks of 4³ cells are tested at their centres
// and skipped when the surface can't pass through them, so a millimetre-resolution head costs a
// fraction of a dense grid. Every sign-changing cell gets one vertex (the average of its edge
// crossings); every sign-changing edge becomes a quad joining the four cells around it.

import type { V3 } from '../../../src/core/math';
import type { SDF } from './sdf';

export interface IndexedMesh {
  pos: Float64Array; // xyz per vertex
  idx: Uint32Array; // three per triangle, CCW = outward
}

export function surfaceNets(f: SDF, min: V3, max: V3, h: number): IndexedMesh {
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / h));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / h));
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / h));
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const S = new Float32Array(sx * sy * sz).fill(NaN);
  const [ox, oy, oz] = min;
  const get = (i: number, j: number, k: number) => {
    const s = i + sx * (j + sy * k);
    let v = S[s];
    if (v !== v) {
      v = f(ox + i * h, oy + j * h, oz + k * h);
      S[s] = v;
    }
    return v;
  };

  // ---- which blocks can contain surface
  const B = 4;
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), bz = Math.ceil(nz / B);
  const half = (h * B * Math.sqrt(3)) / 2;
  const active: number[] = [];
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    const cx = ox + (i + 0.5) * B * h, cy = oy + (j + 0.5) * B * h, cz = oz + (k + 0.5) * B * h;
    if (Math.abs(f(cx, cy, cz)) < half * 1.35 + h) active.push(i, j, k);
  }

  // ---- one vertex per sign-changing cell
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const P: number[] = [];
  const cells: number[] = [];
  const cornerD = new Float64Array(8);
  const E: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let a = 0; a < active.length; a += 3) {
    const i0 = active[a] * B, j0 = active[a + 1] * B, k0 = active[a + 2] * B;
    for (let k = k0; k < Math.min(nz, k0 + B); k++) for (let j = j0; j < Math.min(ny, j0 + B); j++) for (let i = i0; i < Math.min(nx, i0 + B); i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const d = get(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
        cornerD[c] = d;
        if (d < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let px = 0, py = 0, pz = 0, n = 0;
      for (const [c0, c1] of E) {
        const d0 = cornerD[c0], d1 = cornerD[c1];
        if (d0 < 0 === d1 < 0) continue;
        const t = d0 / (d0 - d1);
        px += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
        py += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
        pz += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
        n++;
      }
      cellVert[i + nx * (j + ny * k)] = P.length / 3;
      P.push(ox + (i + px / n) * h, oy + (j + py / n) * h, oz + (k + pz / n) * h);
      cells.push(i, j, k);
    }
  }

  // ---- a quad for every sign-changing edge
  const I: number[] = [];
  const cv = (i: number, j: number, k: number) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : cellVert[i + nx * (j + ny * k)]);
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac <= dbd) I.push(a, b, c, a, c, d);
    else I.push(a, b, d, b, c, d);
  };
  for (let q = 0; q < cells.length; q += 3) {
    const i = cells[q], j = cells[q + 1], k = cells[q + 2];
    const d0 = get(i, j, k);
    // edges from the cell's min corner along +x, +y, +z; the four cells around each edge
    // (viewed from +axis: right = next axis, up = the one after) wind CCW when the start is inside
    const dx = get(i + 1, j, k), dy = get(i, j + 1, k), dz = get(i, j, k + 1);
    if (d0 < 0 !== dx < 0) {
      const c00 = cv(i, j - 1, k - 1), c10 = cv(i, j, k - 1), c11 = cv(i, j, k), c01 = cv(i, j - 1, k);
      if (d0 < 0) quad(c00, c10, c11, c01);
      else quad(c00, c01, c11, c10);
    }
    if (d0 < 0 !== dy < 0) {
      // axis y: right = z, up = x
      const c00 = cv(i - 1, j, k - 1), c10 = cv(i - 1, j, k), c11 = cv(i, j, k), c01 = cv(i, j, k - 1);
      if (d0 < 0) quad(c00, c10, c11, c01);
      else quad(c00, c01, c11, c10);
    }
    if (d0 < 0 !== dz < 0) {
      // axis z: right = x, up = y
      const c00 = cv(i - 1, j - 1, k), c10 = cv(i, j - 1, k), c11 = cv(i, j, k), c01 = cv(i - 1, j, k);
      if (d0 < 0) quad(c00, c10, c11, c01);
      else quad(c00, c01, c11, c10);
    }
  }
  return { pos: new Float64Array(P), idx: new Uint32Array(I) };
}
