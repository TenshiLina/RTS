// Humanoid kit: a 12-joint rigid skeleton + body builder + baked animations.
// Proportions are slightly heroic (larger head/hands/weapons) so units read at RTS distance —
// the same trick RA2's voxel infantry used.
//
// Conventions: +Z forward, +Y up, character's LEFT is +X.
// Rotation about +X by a NEGATIVE angle swings a hanging limb FORWARD.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { MaterialDef } from '../../../src/core/materialModel';
import type { JointDef, AnimDef, AnimTrackSample } from '../kit/gltf';
import { V3, quatEuler, DEG } from '../../../src/core/math';

export const J = {
  root: 0, pelvis: 1, chest: 2, head: 3, armL: 4, foreL: 5, armR: 6, foreR: 7, thighL: 8, shinL: 9, thighR: 10, shinR: 11,
} as const;

export const SKELETON: JointDef[] = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 0, pos: [0, 0.92, 0] },
  { name: 'chest', parent: 1, pos: [0, 1.1, 0] },
  { name: 'head', parent: 2, pos: [0, 1.5, 0] },
  { name: 'armL', parent: 2, pos: [0.21, 1.43, 0] },
  { name: 'foreL', parent: 4, pos: [0.25, 1.15, 0] },
  { name: 'armR', parent: 2, pos: [-0.21, 1.43, 0] },
  { name: 'foreR', parent: 6, pos: [-0.25, 1.15, 0] },
  { name: 'thighL', parent: 1, pos: [0.1, 0.9, 0] },
  { name: 'shinL', parent: 8, pos: [0.1, 0.5, 0] },
  { name: 'thighR', parent: 1, pos: [-0.1, 0.9, 0] },
  { name: 'shinR', parent: 10, pos: [-0.1, 0.5, 0] },
];

/** Hand grip points in bind pose (end of forearm). */
export const HAND_R: V3 = [-0.27, 0.86, 0.02];
export const HAND_L: V3 = [0.27, 0.86, 0.02];

export interface BodyStyle {
  skin?: MaterialDef;
  trousers: MaterialDef;
  tunic: MaterialDef;
  boots?: MaterialDef;
  sleeves?: MaterialDef;
  /** long robe instead of trousers (daoist) */
  robe?: MaterialDef;
  /** black hair shell over the scalp (skip when a helmet covers it) */
  hair?: boolean;
  sash?: MaterialDef;
}

/** Builds the base body, each part bound to its joint. */
export function buildBody(mb: MeshBuilder, st: BodyStyle) {
  const skin = st.skin ?? PAL.skin;
  const boots = st.boots ?? PAL.leather;
  const sleeves = st.sleeves ?? st.tunic;
  // legs
  for (const side of [1, -1]) {
    const x = 0.1 * side;
    const thigh = side > 0 ? J.thighL : J.thighR;
    const shin = side > 0 ? J.shinL : J.shinR;
    mb.with(null, () => mb.tube([[x, 0.93, 0], [x, 0.7, 0.005], [x, 0.5, 0.01]], (t) => 0.088 - t * 0.022, 8), { mat: st.robe ?? st.trousers, joint: thigh });
    mb.with(null, () => {
      mb.with(null, () => mb.tube([[x, 0.52, 0.01], [x, 0.3, 0.0]], (t) => 0.066 - t * 0.008, 8), { mat: st.robe ?? st.trousers });
      mb.with(null, () => {
        mb.tube([[x, 0.33, 0.0], [x, 0.08, -0.005]], (t) => 0.06 - t * 0.008, 8);
        mb.box([0.11, 0.08, 0.24], [x, 0.04, 0.05], 0.03);
      }, { mat: boots });
    }, { joint: shin });
  }
  // pelvis / hips
  mb.with(null, () => mb.lathe([[0.15, 0.82], [0.17, 0.9], [0.155, 1.0], [0.14, 1.06]], 10, { capBottom: true }), { mat: st.robe ?? st.trousers, joint: J.pelvis });
  // torso
  mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.78]), () => {
    mb.lathe([[0.145, 1.0], [0.16, 1.12], [0.19, 1.3], [0.19, 1.38], [0.15, 1.45], [0.06, 1.48]], 12, { capTop: true });
  }, { mat: st.tunic, joint: J.chest });
  if (st.sash) mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.8]), () => mb.lathe([[0.168, 1.02], [0.175, 1.06], [0.175, 1.1], [0.165, 1.13]], 12), { mat: st.sash, joint: J.chest });
  // neck + head
  mb.with(null, () => {
    mb.cylinder({ r: 0.05, h: 0.1, y0: 1.44, sides: 8 });
    mb.at(0, 1.6, 0.01, () => mb.sphere(0.125, 12, 9, { squash: [0.92, 1.04, 0.98] }));
    // ears + nose hint
    for (const s of [-1, 1]) mb.at(s * 0.115, 1.59, 0.0, () => mb.sphere(0.028, 6, 4, { squash: [0.6, 1, 1] }));
    mb.at(0, 1.585, 0.125, () => mb.sphere(0.02, 6, 4));
  }, { mat: skin, joint: J.head });
  if (st.hair) {
    mb.with(null, () => {
      mb.at(0, 1.605, -0.005, () => mb.sphere(0.132, 12, 8, { squash: [0.95, 1.02, 1.0], jitter: (n) => (n[2] > 0.35 && n[1] < 0.55 ? -0.5 : 0) }));
    }, { mat: PAL.hair, joint: J.head });
  }
  // eyes (dark), brows — tiny but they give the face a direction at close zoom
  mb.with(null, () => {
    for (const s of [-1, 1]) mb.at(s * 0.042, 1.615, 0.11, () => mb.sphere(0.014, 6, 4, { squash: [1, 1, 0.5] }));
  }, { mat: PAL.hair, joint: J.head });
  // arms
  for (const side of [1, -1]) {
    const arm = side > 0 ? J.armL : J.armR;
    const fore = side > 0 ? J.foreL : J.foreR;
    const x0 = 0.21 * side, x1 = 0.25 * side, x2 = 0.27 * side;
    mb.with(null, () => {
      mb.at(x0, 1.42, 0, () => mb.sphere(0.07, 8, 6));
      mb.tube([[x0, 1.43, 0], [x1, 1.15, 0]], (t) => 0.058 - t * 0.01, 8);
    }, { mat: sleeves, joint: arm });
    mb.with(null, () => {
      mb.with(null, () => mb.tube([[x1, 1.16, 0], [x2, 0.93, 0.02]], (t) => 0.05 - t * 0.01, 8), { mat: sleeves });
      mb.with(null, () => mb.at(x2, 0.87, 0.02, () => mb.sphere(0.05, 8, 6, { squash: [0.85, 1.1, 1] })), { mat: skin });
    }, { joint: fore });
  }
}

/** Pleated armour skirt (tassets) — four panels on the pelvis joint. */
export function armourSkirt(mb: MeshBuilder, mat: MaterialDef, len = 0.34) {
  mb.with(null, () => {
    for (let i = 0; i < 4; i++) {
      mb.with(T(0, 0, 0, [0, i * 90 + 45, 0]), () => {
        mb.surface((u, v) => {
          const a = (u - 0.5) * 1.35;
          const r = 0.175 + v * 0.07;
          return [Math.sin(a) * r, 1.02 - v * len, Math.cos(a) * r];
        }, 4, 3, { uvFn: (u, v) => [u * 0.3, v * len] });
      });
    }
  }, { mat, joint: J.pelvis });
}

// ------------------------------------------------------------------ animation helpers
type Pose = Partial<Record<keyof typeof J, [number, number, number]>>; // euler degrees
type PoseFn = (p: number) => { pose: Pose; bob?: number; lean?: number };

const q = (e?: [number, number, number]) => (e ? quatEuler(e[0] * DEG, e[1] * DEG, e[2] * DEG) : quatEuler(0, 0, 0));
const sin = (p: number, k = 1, ph = 0) => Math.sin((p * k + ph) * Math.PI * 2);

export function makeAnim(name: string, duration: number, fn: PoseFn, base: Pose = {}): AnimDef {
  const tracks: Record<string, (p: number) => AnimTrackSample> = {};
  const names = Object.keys(J) as (keyof typeof J)[];
  for (const n of names) {
    if (n === 'root') continue;
    tracks[n] = (p) => {
      const r = fn(p);
      const a = r.pose[n] ?? [0, 0, 0];
      const b = base[n] ?? [0, 0, 0];
      const out: AnimTrackSample = { r: q([a[0] + b[0], a[1] + b[1], a[2] + b[2]]) };
      if (n === 'pelvis') out.t = [0, r.bob ?? 0, 0];
      return out;
    };
  }
  return { name, duration, fps: 30, tracks };
}

/** Standard walk; `hold` keeps arms from swinging (weapon carried). */
export function walkCycle(base: Pose, opts: { armSwing?: number; holdR?: boolean; holdL?: boolean; stride?: number } = {}): AnimDef {
  const sw = opts.armSwing ?? 22, st = opts.stride ?? 30;
  return makeAnim('walk', 0.9, (p) => {
    const s = sin(p);
    const kneeL = Math.max(0, -sin(p, 1, 0.1)) * 45 + 5;
    const kneeR = Math.max(0, sin(p, 1, 0.1)) * 45 + 5;
    return {
      pose: {
        thighL: [-s * st, 0, 0],
        thighR: [s * st, 0, 0],
        shinL: [kneeL, 0, 0],
        shinR: [kneeR, 0, 0],
        armL: opts.holdL ? [0, 0, 0] : [s * sw, 0, 0],
        armR: opts.holdR ? [0, 0, 0] : [-s * sw, 0, 0],
        foreL: opts.holdL ? [0, 0, 0] : [-12 + s * 8, 0, 0],
        foreR: opts.holdR ? [0, 0, 0] : [-12 - s * 8, 0, 0],
        chest: [4, -s * 5, 0],
        pelvis: [0, s * 6, 0],
        head: [-3, s * 3, 0],
      },
      bob: Math.abs(Math.cos(p * Math.PI * 2)) * 0.035 - 0.02,
    };
  }, base);
}

export function idleCycle(base: Pose, amp = 1): AnimDef {
  return makeAnim('idle', 3.2, (p) => ({
    pose: {
      chest: [sin(p) * 1.5 * amp, 0, 0],
      head: [sin(p, 1, 0.2) * 2 * amp, sin(p, 0.5) * 6 * amp, 0],
      armL: [sin(p, 1, 0.1) * 2 * amp, 0, sin(p) * 1.5 * amp],
      armR: [sin(p, 1, 0.15) * 2 * amp, 0, -sin(p) * 1.5 * amp],
      thighL: [0, 0, 1.5],
      thighR: [0, 0, -1.5],
    },
    bob: sin(p) * 0.006,
  }), base);
}

export type { Pose };
export { sin as wave };
