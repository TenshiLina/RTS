import { describe, it, expect } from 'vitest';
import { MeshBuilder } from '../tools/assetgen/kit/mesh';
import { dot, cross, sub, V3 } from '../src/core/math';

// Signed volume of a closed mesh is positive when all faces wind CCW-outward.
function signedVolume(mb: MeshBuilder) {
  let v = 0;
  for (const t of mb.tris) v += dot(t.p[0], cross(t.p[1], t.p[2])) / 6;
  return v;
}
// Stored normals must agree with geometric winding.
function normalsAgree(mb: MeshBuilder) {
  let bad = 0;
  for (const t of mb.tris) {
    const g = cross(sub(t.p[1], t.p[0]), sub(t.p[2], t.p[0]));
    const n: V3 = [t.n[0][0] + t.n[1][0] + t.n[2][0], t.n[0][1] + t.n[1][1] + t.n[2][1], t.n[0][2] + t.n[1][2] + t.n[2][2]];
    if (dot(g, n) < 0) bad++;
  }
  return bad;
}
const M = { name: 'm', color: 0xffffff };
const cases: [string, (m: MeshBuilder) => void][] = [
  ['box', (m) => m.box([1, 2, 3])],
  ['bevel box', (m) => m.box([1, 2, 3], [0, 0, 0], 0.1)],
  ['cylinder', (m) => m.cylinder({ r: 1, h: 2 })],
  ['cone', (m) => m.cone(1, 2)],
  ['sphere', (m) => m.sphere(1)],
  ['blob', (m) => m.blob(1, 2)],
  ['extrude', (m) => m.extrude([[0, 0], [0, 1], [1, 1], [1, 0]].map(([x, z]) => [x, -z] as [number, number]).reverse(), 0, 1)],
  ['tube', (m) => m.tube([[0, 0, 0], [0, 0, 1], [0.3, 0.2, 2]], 0.2)],
  ['mirrored box', (m) => m.with(null, () => m.at(0, 0, 0, () => m.box([1, 1, 1]), [0, 0, 0], [-1, 1, 1]))],
];
describe('mesh kit winding', () => {
  for (const [name, fn] of cases) {
    it(name, () => {
      const m = new MeshBuilder();
      m.mat(M);
      fn(m);
      expect(signedVolume(m)).toBeGreaterThan(0);
      expect(normalsAgree(m)).toBe(0);
    });
  }
});
