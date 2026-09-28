// Garments: shells cut from the body (or from the layer beneath), meshed from distance fields.
//
// A garment is the space between two offsets of the surface it wraps (t0..t1 metres out),
// intersected with its region — negative inside, so hems, cuffs and necklines are where the
// region's boundary crosses the shell. `hem(p)` = distance to that boundary, which painters
// use for trims. Hidden inner faces away from any opening are dropped after meshing.

import type { V3 } from '../../../src/core/math';
import type { SDF } from '../sdf/sdf';
import { smax, normalAt } from '../sdf/sdf';
import { meshSDF, MeshedPart } from './head';
import { srcOf } from '../kit/cache';

export const GARMENT_SRC = srcOf(import.meta.url);
export const BODY_SRC = srcOf(new URL('./body.ts', import.meta.url).href);

export interface GarmentSpec {
  /** cache key: everything that changes the shape must be in it */
  key: string;
  deps?: string[];
  /** wrapped surface and the shell's offsets from it */
  inner?: SDF;
  t0?: number;
  t1?: number;
  /** or a full solid (e.g. a flared robe skirt); the region still cuts it */
  solid?: SDF;
  region: SDF;
  /** displacement of the outer surface (m, positive pulls it in) — folds, pleats */
  folds?: (x: number, y: number, z: number) => number;
  bounds: [V3, V3];
  cell?: number;
  tris: number;
  /** keep inner faces within this distance of an opening (m) */
  keepInner?: number;
  weight?: (x: number, y: number, z: number) => number;
}

export interface Garment {
  mesh: MeshedPart;
  f: SDF;
  hem: (p: V3) => number;
}

export function shellSDF(inner: SDF, t0: number, t1: number, folds?: (x: number, y: number, z: number) => number): SDF {
  return (x, y, z) => {
    const d = inner(x, y, z);
    const outer = d - t1 + (folds ? folds(x, y, z) : 0);
    return Math.max(outer, t0 - d);
  };
}

export function garment(g: GarmentSpec): Garment {
  const base = g.solid ?? shellSDF(g.inner!, g.t0 ?? 0.004, g.t1 ?? 0.014, g.folds);
  const f: SDF = (x, y, z) => smax(base(x, y, z), g.region(x, y, z), 0.0015);
  const hem = (p: V3) => Math.max(0, -g.region(p[0], p[1], p[2]));
  const cell = g.cell ?? 0.003;
  let mesh = meshSDF(f, g.bounds[0], g.bounds[1], cell, g.tris, { key: 'garment|' + g.key, deps: [GARMENT_SRC, BODY_SRC, ...(g.deps ?? [])] }, g.weight);
  // drop the inside of the shell except near openings (it is never seen)
  const keep = g.keepInner ?? 0.05;
  const wrap = g.inner;
  if (wrap && keep < Infinity) {
    const idx: number[] = [];
    for (let t = 0; t < mesh.idx.length; t += 3) {
      const a = mesh.idx[t], b = mesh.idx[t + 1], c = mesh.idx[t + 2];
      const p: V3 = [(mesh.pos[a * 3] + mesh.pos[b * 3] + mesh.pos[c * 3]) / 3, (mesh.pos[a * 3 + 1] + mesh.pos[b * 3 + 1] + mesh.pos[c * 3 + 1]) / 3, (mesh.pos[a * 3 + 2] + mesh.pos[b * 3 + 2] + mesh.pos[c * 3 + 2]) / 3];
      const nn: V3 = [mesh.nrm[a * 3] + mesh.nrm[b * 3] + mesh.nrm[c * 3], mesh.nrm[a * 3 + 1] + mesh.nrm[b * 3 + 1] + mesh.nrm[c * 3 + 1], mesh.nrm[a * 3 + 2] + mesh.nrm[b * 3 + 2] + mesh.nrm[c * 3 + 2]];
      const gi = normalAt(wrap, p[0], p[1], p[2], 0.001);
      const inward = nn[0] * gi[0] + nn[1] * gi[1] + nn[2] * gi[2] < 0;
      if (inward && hem(p) > keep) continue;
      idx.push(a, b, c);
    }
    mesh = { ...mesh, idx: new Uint32Array(idx) };
  }
  return { mesh, f, hem };
}

// ------------------------------------------------------------------ fold fields
/** Pleats hanging from a waist: vertical folds that deepen towards the hem. */
export function pleats(n: number, amp: number, top: number, bottom: number, phase = 0) {
  return (x: number, y: number, z: number) => {
    const t = Math.max(0, Math.min(1, (top - y) / (top - bottom)));
    const a = Math.atan2(x, z);
    return Math.sin(a * n + phase + Math.sin(a * 3 + y * 4) * 0.8) * amp * t * t;
  };
}
/** Horizontal bunching (sleeves, trousers gathered at knees and ankles). */
export function bunching(amp: number, freq: number, seed = 0) {
  return (x: number, y: number, z: number) => {
    const w = Math.sin(y * freq + Math.sin(x * 37 + z * 29 + seed) * 1.6 + Math.sin(Math.atan2(x, z) * 3 + seed) * 1.2);
    return w * amp;
  };
}
