// Skeletal animation sampling (rigid or smooth skinning — the data path is identical).

import { M4, m4FromTRS, m4Mul, quatSlerp, lerp, V3, Quat } from '../core/math';
import type { ModelData, AnimationData } from '../assets/gltf';

export const MAX_JOINTS = 64;
export const JOINT_TEXELS = 3; // affine 3x4 rows

function sampleChannel(times: Float32Array, values: Float32Array, n: number, t: number, out: number[]) {
  const last = times.length - 1;
  if (t <= times[0]) {
    for (let k = 0; k < n; k++) out[k] = values[k];
    return;
  }
  if (t >= times[last]) {
    for (let k = 0; k < n; k++) out[k] = values[last * n + k];
    return;
  }
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - times[lo]) / (times[hi] - times[lo]);
  if (n === 4) {
    const a: Quat = [values[lo * 4], values[lo * 4 + 1], values[lo * 4 + 2], values[lo * 4 + 3]];
    const b: Quat = [values[hi * 4], values[hi * 4 + 1], values[hi * 4 + 2], values[hi * 4 + 3]];
    const q = quatSlerp(a, b, f);
    out[0] = q[0]; out[1] = q[1]; out[2] = q[2]; out[3] = q[3];
  } else {
    for (let k = 0; k < n; k++) out[k] = lerp(values[lo * n + k], values[hi * n + k], f);
  }
}

const tmpWorld: M4[] = Array.from({ length: MAX_JOINTS }, () => new Float32Array(16));
const tmpLocal = new Float32Array(16);
const tmpSkin = new Float32Array(16);

/**
 * Writes JOINT_TEXELS * 4 floats per joint into `out` at `offset` (row-major affine rows).
 * `time` is in seconds and loops over the animation duration.
 */
export function poseJoints(model: ModelData, anim: AnimationData | null, time: number, out: Float32Array, offset: number, loop = true) {
  const J = model.joints;
  const t = anim ? (loop ? ((time % anim.duration) + anim.duration) % anim.duration : Math.min(time, anim.duration)) : 0;
  const T: V3[] = J.map((j) => [...j.t] as V3);
  const R: Quat[] = J.map((j) => [...j.r] as Quat);
  const S: V3[] = J.map((j) => [...j.s] as V3);
  if (anim) {
    const tmp = [0, 0, 0, 0];
    for (const ch of anim.channels) {
      const n = ch.path === 'rotation' ? 4 : 3;
      sampleChannel(ch.times, ch.values, n, t, tmp);
      if (ch.path === 'rotation') R[ch.joint] = [tmp[0], tmp[1], tmp[2], tmp[3]];
      else if (ch.path === 'translation') T[ch.joint] = [tmp[0], tmp[1], tmp[2]];
      else S[ch.joint] = [tmp[0], tmp[1], tmp[2]];
    }
  }
  for (let i = 0; i < J.length; i++) {
    m4FromTRS(T[i], R[i], S[i], tmpLocal);
    if (J[i].parent >= 0) m4Mul(tmpWorld[J[i].parent], tmpLocal, tmpWorld[i]);
    else tmpWorld[i].set(tmpLocal);
    m4Mul(tmpWorld[i], J[i].inverseBind, tmpSkin);
    const o = offset + i * JOINT_TEXELS * 4;
    out[o] = tmpSkin[0]; out[o + 1] = tmpSkin[4]; out[o + 2] = tmpSkin[8]; out[o + 3] = tmpSkin[12];
    out[o + 4] = tmpSkin[1]; out[o + 5] = tmpSkin[5]; out[o + 6] = tmpSkin[9]; out[o + 7] = tmpSkin[13];
    out[o + 8] = tmpSkin[2]; out[o + 9] = tmpSkin[6]; out[o + 10] = tmpSkin[10]; out[o + 11] = tmpSkin[14];
  }
}

/** World-space position of a socket for a given pose (for projectile spawn points etc.). */
export function jointWorld(jointIndex: number): M4 {
  return tmpWorld[jointIndex];
}
