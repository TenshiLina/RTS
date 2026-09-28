// Hands v3 — one sculpted surface per hand: palm with its pads, knuckles, three-segment fingers
// and a thumb, blended so the fingers grow out of the palm. Poses: relaxed, open, fist, and
// grip (fingers wrapped round a shaft through GRIP, so held weapons sit in the hand).
//
// Canonical frame (the LEFT hand): wrist at the origin, fingers down (−Y), palm facing the body
// (−X), thumb forward (+Z). The right hand is the mirror image.

import type { V3 } from '../../../src/core/math';
import { SDF, capsule, ellipsoid, box, blend, sphere, bounded } from '../sdf/sdf';

export type HandPose = 'relaxed' | 'open' | 'fist' | 'grip';

/** Shaft centre of the grip pose, relative to the wrist (canonical frame); shaft runs along Z. */
export const GRIP: V3 = [-0.031, -0.094, 0];
export const GRIP_R = 0.021; // shaft radius the grip closes on

const FINGERS = [
  // z at the knuckle, knuckle drop, phalanx lengths, radius
  { z: 0.026, y: 0, L: [0.041, 0.025, 0.02], r: 0.0092 },
  { z: 0.008, y: -0.004, L: [0.045, 0.028, 0.021], r: 0.0095 },
  { z: -0.01, y: -0.002, L: [0.042, 0.026, 0.02], r: 0.009 },
  { z: -0.027, y: 0.005, L: [0.033, 0.021, 0.018], r: 0.008 },
];
const MCP_Y = -0.086;

function fingerJoints(f: (typeof FINGERS)[number], pose: HandPose, i: number): V3[] {
  const mcp: V3 = [0.002, MCP_Y + f.y, f.z];
  if (pose === 'grip' || pose === 'fist') {
    // around a circle about the shaft (fist: a tighter circle, no shaft)
    const R = pose === 'grip' ? GRIP_R + f.r + 0.002 : 0.022;
    const C: V3 = pose === 'grip' ? [GRIP[0], GRIP[1], f.z] : [-0.024, MCP_Y - 0.004, f.z];
    let a = Math.atan2(mcp[1] - C[1], mcp[0] - C[0]);
    const r0 = Math.hypot(mcp[0] - C[0], mcp[1] - C[1]);
    const pts: V3[] = [mcp];
    let r = r0;
    for (let k = 0; k < 3; k++) {
      r += (R - r) * 0.7;
      a -= f.L[k] / r;
      pts.push([C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r, f.z * (1 - k * 0.08)]);
    }
    return pts;
  }
  const curl = pose === 'open' ? [4, 6, 4] : [16 + i * 4, 26 + i * 3, 18];
  const splay = pose === 'open' ? (i - 1.5) * 5 : (i - 1.5) * 2.5;
  const pts: V3[] = [mcp];
  let A = 0;
  let p = mcp;
  for (let k = 0; k < 3; k++) {
    A += (curl[k] * Math.PI) / 180;
    const sp = (splay * Math.PI) / 180;
    // bend towards the palm (−X), fan out along Z
    const d: V3 = [-Math.sin(A), -Math.cos(A) * Math.cos(sp), Math.cos(A) * Math.sin(sp)];
    p = [p[0] + d[0] * f.L[k], p[1] + d[1] * f.L[k], p[2] + d[2] * f.L[k]];
    pts.push(p);
  }
  return pts;
}

export function handSDF(pose: HandPose): SDF {
  const parts: SDF[] = [];
  // palm and wrist
  const palm = box([0.0, -0.048, 0.0], [0.0125, 0.036, 0.033], 0.011);
  const back = ellipsoid([0.005, -0.05, 0], [0.012, 0.04, 0.034]);
  const wrist = ellipsoid([0.001, 0.008, 0.0], [0.021, 0.045, 0.027]);
  const thenar = ellipsoid([-0.009, -0.042, 0.02], [0.011, 0.026, 0.016]);
  const hypothenar = ellipsoid([-0.008, -0.055, -0.021], [0.008, 0.027, 0.012]);
  let hand: SDF = blend(0.012, palm, back, wrist, thenar, hypothenar);
  FINGERS.forEach((f, i) => {
    const j = fingerJoints(f, pose, i);
    const knuckle = sphere([j[0][0] + 0.005, j[0][1] + 0.002, j[0][2]], f.r * 1.05);
    const segs: SDF[] = [];
    for (let k = 0; k < 3; k++) segs.push(capsule(j[k], j[k + 1], f.r * (1 - k * 0.1)));
    parts.push(bounded(blend(0.004, knuckle, ...segs), j[0], 0.12, 0.02));
  });
  // thumb: metacarpal from the heel of the palm, two phalanges
  const cmc: V3 = [-0.006, -0.022, 0.024];
  let t1: V3, t2: V3, t3: V3;
  if (pose === 'grip') {
    t1 = [-0.022, -0.045, 0.034];
    t2 = [GRIP[0] - 0.012, GRIP[1] + 0.008, 0.03];
    t3 = [GRIP[0] - 0.024, GRIP[1] - 0.004, 0.012];
  } else if (pose === 'fist') {
    t1 = [-0.02, -0.048, 0.034];
    t2 = [-0.032, -0.076, 0.026];
    t3 = [-0.036, -0.094, 0.008];
  } else if (pose === 'open') {
    t1 = [-0.016, -0.05, 0.046];
    t2 = [-0.02, -0.078, 0.058];
    t3 = [-0.022, -0.1, 0.064];
  } else {
    t1 = [-0.018, -0.05, 0.04];
    t2 = [-0.026, -0.076, 0.044];
    t3 = [-0.03, -0.096, 0.04];
  }
  const thumb = blend(0.005, capsule(cmc, t1, 0.0125), capsule(t1, t2, 0.0105), capsule(t2, t3, 0.0092));
  hand = blend(0.009, hand, ...parts);
  hand = blend(0.01, hand, thumb);
  return hand;
}

/** Fingertip positions (canonical frame) — painters put the nails there. */
export function fingertips(pose: HandPose): { tip: V3; dir: V3 }[] {
  return FINGERS.map((f, i) => {
    const j = fingerJoints(f, pose, i);
    const d: V3 = [j[3][0] - j[2][0], j[3][1] - j[2][1], j[3][2] - j[2][2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    return { tip: j[3], dir: [d[0] / l, d[1] / l, d[2] / l] as V3 };
  });
}
