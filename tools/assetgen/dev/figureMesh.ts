// Review meshes of figure v5, cached: the body at 4 mm, the hands (whose fingers are ~12 mm
// across) at 1.5 mm, cut apart at a plane through the wrists, and the hair layer at 2 mm.

import type { V3 } from '../../../src/core/math';
import type { SDF } from '../sdf/sdf';
import { figure5SDF } from '../recipes/figure5';
import { surfaceNets } from '../sdf/mesher';
import { cachedArrays, srcOf } from '../kit/cache';
import { refPath } from '../ref/refSheet';
import { vertexNormals, type RasterMesh } from '../sdf/raster';

export const HAIR_ALBEDO: V3 = [0.075, 0.058, 0.05];

export function figureMeshes(ref = 'human-female') {
  const fig = figure5SDF(ref);
  const deps = ['../recipes/figure5.ts', '../recipes/hands.ts', '../ref/refSheet.ts', '../sdf/sdf.ts', '../sdf/mesher.ts', './figureMesh.ts'].map((p) => srcOf(new URL(p, import.meta.url).href)).concat([refPath(ref)]);
  const CELL = Number(process.env.CELL ?? 0.004);
  // hands: |x| ≥ 0.2 and below the wrist plane
  const WRIST_Y = 0.915;
  const handBox = (x: number, y: number) => Math.max(0.2 - Math.abs(x), y - WRIST_Y);
  const bodyF: SDF = (x, y, z) => Math.max(fig.f(x, y, z), -handBox(x, y));
  // (the hands' mesh reaches 3 mm above the cut, and both meshes drop their caps on the cut, so
  // the join shows no seam)
  const handF: SDF = (x, y, z) => Math.max(fig.f(x, y, z), handBox(x, y) - 0.003);
  const dropCaps = (m: { pos: Float64Array; idx: Uint32Array }, planeY: number, tol: number) => {
    const P = m.pos, I = m.idx, keep: number[] = [];
    for (let t = 0; t < I.length; t += 3) {
      let onCap = true;
      for (let k = 0; k < 3; k++) {
        const v = I[t + k] * 3;
        if (Math.abs(P[v + 1] - planeY) > tol || Math.abs(P[v]) < 0.2) onCap = false;
      }
      if (!onCap) keep.push(I[t], I[t + 1], I[t + 2]);
    }
    return { pos: P, idx: Uint32Array.from(keep) };
  };
  const mesh = (key: string, f: SDF, lo: V3, hi: V3, cell: number) =>
    cachedArrays(`${key}|${ref}|${cell}`, deps, () => {
      const m = surfaceNets(f, lo, hi, cell, 1.6);
      return { pos: Float64Array.from(m.pos), idx: Uint32Array.from(m.idx) };
    });
  const body = dropCaps(mesh('figure5-body', bodyF, [-0.38, -0.01, -0.21], [0.38, 1.77, 0.22], CELL), WRIST_Y, CELL * 0.6);
  const hands = dropCaps(mesh('figure5-hands', handF, [-0.37, 0.72, -0.1], [0.37, WRIST_Y + 0.006, 0.12], 0.0015), WRIST_Y + 0.003, 0.0012);
  const hair = mesh('figure5-hair', fig.hair, [-0.12, 1.45, -0.14], [0.12, 1.76, 0.15], 0.002);
  // normals from the field (not the faces) near the cut, so the two meshes shade alike across it
  const withNormals = (m: { pos: Float64Array; idx: Uint32Array }, near: (x: number, y: number) => boolean) => {
    const nrm = vertexNormals(m.pos, m.idx);
    const P = m.pos, e = 0.0004;
    for (let v = 0; v < P.length / 3; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      if (!near(x, y)) continue;
      const g = [fig.f(x + e, y, z) - fig.f(x - e, y, z), fig.f(x, y + e, z) - fig.f(x, y - e, z), fig.f(x, y, z + e) - fig.f(x, y, z - e)];
      const l = Math.hypot(g[0], g[1], g[2]) || 1;
      nrm[v * 3] = g[0] / l;
      nrm[v * 3 + 1] = g[1] / l;
      nrm[v * 3 + 2] = g[2] / l;
    }
    return { ...m, nrm };
  };
  const nearWrist = (x: number, y: number) => Math.abs(x) > 0.19 && Math.abs(y - WRIST_Y) < 0.02;
  const layers: { mesh: RasterMesh; albedo?: V3 }[] = [{ mesh: withNormals(body, nearWrist) }, { mesh: withNormals(hands, nearWrist) }, { mesh: hair, albedo: HAIR_ALBEDO }];
  return { fig, layers };
}
