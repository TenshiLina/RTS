// Humanoid kit: an 18-joint skeleton, the detailed figure (figure.ts), baked animations.
// Proportions are slightly heroic (larger head/hands/weapons) so units read at RTS distance —
// the same trick RA2's voxel infantry used — and the faces hold up in close-ups.
//
// Conventions: +Z forward, +Y up, character's LEFT is +X.
// Rotation about +X by a NEGATIVE angle swings a hanging limb FORWARD.

import { MeshBuilder, T } from '../kit/mesh';
import type { MaterialDef } from '../../../src/core/materialModel';
import type { JointDef, AnimDef, AnimTrackSample } from '../kit/gltf';
import type { BlendZone } from '../kit/skin';
import { V3, quatEuler, DEG } from '../../../src/core/math';
import { buildFigure, FaceStyle, HandPose } from './figure';

export const J = {
  root: 0, pelvis: 1, chest: 2, neck: 3, head: 4,
  armL: 5, foreL: 6, handL: 7, armR: 8, foreR: 9, handR: 10,
  thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16,
} as const;

// parents always precede their children
export const SKELETON: JointDef[] = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'pelvis', parent: 0, pos: [0, 0.92, 0] },
  { name: 'chest', parent: 1, pos: [0, 1.1, 0] },
  { name: 'neck', parent: 2, pos: [0, 1.44, 0.004] },
  { name: 'head', parent: 3, pos: [0, 1.5, 0] },
  { name: 'armL', parent: 2, pos: [0.21, 1.43, 0] },
  { name: 'foreL', parent: 5, pos: [0.25, 1.15, 0] },
  { name: 'handL', parent: 6, pos: [0.27, 0.93, 0.02] },
  { name: 'armR', parent: 2, pos: [-0.21, 1.43, 0] },
  { name: 'foreR', parent: 8, pos: [-0.25, 1.15, 0] },
  { name: 'handR', parent: 9, pos: [-0.27, 0.93, 0.02] },
  { name: 'thighL', parent: 1, pos: [0.1, 0.9, 0] },
  { name: 'shinL', parent: 11, pos: [0.1, 0.5, 0.014] },
  { name: 'footL', parent: 12, pos: [0.098, 0.095, -0.01] },
  { name: 'thighR', parent: 1, pos: [-0.1, 0.9, 0] },
  { name: 'shinR', parent: 14, pos: [-0.1, 0.5, 0.014] },
  { name: 'footR', parent: 15, pos: [-0.098, 0.095, -0.01] },
];

/** Where soft geometry bends (see kit/skin.ts): half-width along the bone, reach around it. */
export const SKIN_ZONES: Record<string, BlendZone> = {
  chest: { r: 0.08, radius: 0.34 },
  neck: { r: 0.035, radius: 0.1 },
  head: { r: 0.03, radius: 0.085 },
  armL: { r: 0.075, radius: 0.105 }, armR: { r: 0.075, radius: 0.105 },
  foreL: { r: 0.055, radius: 0.085 }, foreR: { r: 0.055, radius: 0.085 },
  handL: { r: 0.02, radius: 0.05 }, handR: { r: 0.02, radius: 0.05 },
  thighL: { r: 0.075, radius: 0.13 }, thighR: { r: 0.075, radius: 0.13 },
  shinL: { r: 0.065, radius: 0.1 }, shinR: { r: 0.065, radius: 0.1 },
  footL: { r: 0.04, radius: 0.085 }, footR: { r: 0.04, radius: 0.085 },
};

/** Hand grip points in bind pose (in the palm). */
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
  /** hair on the head (false: none, e.g. under a helmet that covers it all) */
  hair?: boolean;
  sash?: MaterialDef;
  /** crossed-collar trim */
  collar?: MaterialDef;
  face?: FaceStyle;
  handL?: HandPose;
  handR?: HandPose;
}

/** Builds the detailed body: face, hands, feet, soft-skinned limbs and torso. */
export function buildBody(mb: MeshBuilder, st: BodyStyle) {
  const face: FaceStyle = { ...st.face };
  if (st.hair === false && !face.hair) face.hair = 'none';
  buildFigure(mb, {
    pelvis: J.pelvis, chest: J.chest, neck: J.neck, head: J.head,
    arm: [J.armL, J.armR], fore: [J.foreL, J.foreR], hand: [J.handL, J.handR],
    thigh: [J.thighL, J.thighR], shin: [J.shinL, J.shinR], foot: [J.footL, J.footR],
  }, { skin: st.skin, trousers: st.trousers, tunic: st.tunic, sleeves: st.sleeves, boots: st.boots, sash: st.sash, collar: st.collar, robe: st.robe, face, handL: st.handL ?? 'relaxed', handR: st.handR ?? 'fist' });
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
        neck: [-2, s * 1.5, 0],
        head: [-2, s * 2, 0],
        // heel strike → toe off
        footL: [Math.max(0, sin(p, 1, 0.25)) * 18 - Math.max(0, -sin(p, 1, 0.1)) * 12, 0, 0],
        footR: [Math.max(0, -sin(p, 1, 0.25)) * 18 - Math.max(0, sin(p, 1, 0.1)) * 12, 0, 0],
      },
      bob: Math.abs(Math.cos(p * Math.PI * 2)) * 0.035 - 0.02,
    };
  }, base);
}

export function idleCycle(base: Pose, amp = 1): AnimDef {
  return makeAnim('idle', 3.2, (p) => ({
    pose: {
      chest: [sin(p) * 1.5 * amp, 0, 0],
      neck: [sin(p, 1, 0.1) * 1 * amp, sin(p, 0.5) * 2 * amp, 0],
      head: [sin(p, 1, 0.2) * 1.5 * amp, sin(p, 0.5) * 5 * amp, 0],
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
