// Skin weights for deformable ("soft") geometry. Pieces are authored rigidly bound to one joint;
// this pass blends every soft vertex near a joint between the bone it belongs to and its
// neighbour across that joint, so elbows, knees, shoulders, hips, necks and wrists bend smoothly
// instead of hinging pieces. Rigid gear (weapons, helmets, armour plates) keeps its single joint.
//
// For a joint J with pivot P and bone direction d (towards its first child, or away from its
// parent for a leaf), a vertex within `radius` of the bone axis and within ±`r` of P along d is
// shared between J and its parent by a smoothstep across the pivot.

import type { Tri, Skin } from './mesh';
import type { JointDef } from './gltf';
import { V3, sub, dot, normalize, len, scale, add } from '../../../src/core/math';

export interface BlendZone {
  /** half-width of the blend along the bone (m) */
  r: number;
  /** only vertices this close to the bone axis blend (m) */
  radius: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function applySkinWeights(tris: Tri[], skeleton: JointDef[], zones: Record<string, BlendZone>) {
  const n = skeleton.length;
  const children: number[][] = skeleton.map(() => []);
  skeleton.forEach((j, i) => {
    if (j.parent >= 0) children[j.parent].push(i);
  });
  const pivot: V3[] = skeleton.map((j) => j.pos);
  const dir: V3[] = skeleton.map((j, i) => {
    const c = children[i][0];
    if (c !== undefined && len(sub(pivot[c], pivot[i])) > 1e-4) return normalize(sub(pivot[c], pivot[i]));
    if (j.parent >= 0) return normalize(sub(pivot[i], pivot[j.parent]));
    return [0, 1, 0];
  });
  const zone = (i: number) => zones[skeleton[i].name];
  /** signed distance along the bone of joint i from its pivot, and distance from its axis */
  const measure = (i: number, p: V3) => {
    const rel = sub(p, pivot[i]);
    const s = dot(rel, dir[i]);
    const radial = len(sub(rel, scale(dir[i], s)));
    return { s, radial };
  };

  const cache = new Map<string, Skin>();
  const weigh = (p: V3, joint: number): Skin => {
    const key = `${joint}|${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const w = new Float64Array(n);
    w[joint] = 1;
    // across this joint's own pivot, towards its parent
    const par = skeleton[joint].parent, zj = zone(joint);
    if (par >= 0 && zj) {
      const { s, radial } = measure(joint, p);
      if (radial < zj.radius && s < zj.r) {
        const f = smooth(-zj.r, zj.r, s);
        w[par] += w[joint] * (1 - f);
        w[joint] *= f;
      }
    }
    // across each child's pivot
    for (const c of children[joint]) {
      const zc = zone(c);
      if (!zc) continue;
      const { s, radial } = measure(c, p);
      if (radial < zc.radius && s > -zc.r) {
        const f = smooth(-zc.r, zc.r, s);
        w[c] += w[joint] * f;
        w[joint] *= 1 - f;
      }
    }
    // keep the four largest, renormalised
    const idx = Array.from({ length: n }, (_, i) => i).filter((i) => w[i] > 1e-3).sort((a, b) => w[b] - w[a]).slice(0, 4);
    const tot = idx.reduce((a, i) => a + w[i], 0) || 1;
    const skin: Skin = { j: [0, 0, 0, 0], w: [0, 0, 0, 0] };
    idx.forEach((i, k) => {
      skin.j[k] = i;
      skin.w[k] = w[i] / tot;
    });
    cache.set(key, skin);
    return skin;
  };

  for (const t of tris) {
    if (!t.soft) continue;
    t.skin = [weigh(t.p[0], t.joint), weigh(t.p[1], t.joint), weigh(t.p[2], t.joint)];
  }
  void add;
}
