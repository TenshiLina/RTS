// Body v3 — a heroic mannequin as one distance field, fitted to the humanoid skeleton.
//
// The mannequin itself is rarely meshed (clothes cover it); it is the form every garment is
// cut from. A tunic is the torso and arms grown by a centimetre and cut at the hem, the
// cuffs and the neckline; armour is grown further; trousers wrap the legs. Because every layer
// is derived from the same body they fit it and each other without clipping.
//
// Proportions are WC3-style heroic: broad shoulders and chest, strong forearms and calves,
// large hands and feet, on the existing skeleton (animations are unchanged).

import type { V3 } from '../../../src/core/math';
import { SDF, ellipsoid, capsule, roundCone, blend, mirrorX, plane, intersect, carve, smin, smax } from '../sdf/sdf';
import { SKELETON } from './humanoid';

export interface BodyParams {
  /** muscle mass (1 = soldier, 0.8 = scholar) */
  build: number;
  /** extra girth at the waist (0..1) */
  belly: number;
}
export const DEFAULT_BODY: BodyParams = { build: 1, belly: 0 };

export interface Body {
  f: SDF;
  /** a smoothed torso + arms without muscle definition: what loose clothes drape over */
  clothTop: SDF;
  torso: SDF;
  /** shoulder to wrist, both sides */
  arms: SDF;
  upperArms: SDF;
  forearms: SDF;
  /** hips and legs to the ankles */
  legs: SDF;
  hips: SDF;
  thighs: SDF;
  shins: SDF;
  neck: SDF;
}

export function bodySDF(bp: Partial<BodyParams> = {}): Body {
  const P = { ...DEFAULT_BODY, ...bp };
  const m = P.build;
  // ---- torso
  const hips = ellipsoid([0, 0.93, -0.006], [0.156, 0.115, 0.115]);
  const glutes = mirrorX(ellipsoid([0.068, 0.9, -0.05], [0.074, 0.085, 0.068]));
  const waist = ellipsoid([0, 1.07, 0.002 + P.belly * 0.02], [0.14 + P.belly * 0.02, 0.13, 0.104 + P.belly * 0.03]);
  const ribs = ellipsoid([0, 1.27, -0.006], [0.162 * (0.9 + 0.1 * m), 0.17, 0.118]);
  const pecs = mirrorX(ellipsoid([0.068, 1.312, 0.074], [0.074 * m, 0.056, 0.042 * m]));
  const lats = ellipsoid([0, 1.3, -0.036], [0.183 * (0.9 + 0.1 * m), 0.13, 0.093]);
  const traps = blend(0.03, capsule([-0.15, 1.405, -0.022], [0, 1.44, -0.02], 0.044 * (0.85 + 0.15 * m)), capsule([0, 1.44, -0.02], [0.15, 1.405, -0.022], 0.044 * (0.85 + 0.15 * m)));
  const torso = blend(0.045, blend(0.04, hips, waist, ribs, lats), glutes, pecs, traps);
  const neck = capsule([0, 1.39, -0.006], [0, 1.57, 0.01], 0.052);

  // ---- arms (in the bind pose: slightly abducted, elbows a little bent)
  const S = SKELETON;
  const J = (name: string): V3 => S.find((j) => j.name === name)!.pos;
  const sh = J('armL'), el = J('foreL'), wr = J('handL');
  const deltoid = ellipsoid([sh[0] + 0.004, sh[1] - 0.036, 0], [0.058 * m, 0.072, 0.062 * m]);
  const upperArm = roundCone([sh[0] + 0.004, sh[1] - 0.03, 0], el, 0.049 * m, 0.041);
  const biceps = ellipsoid([el[0] - 0.012, el[1] + 0.13, 0.016], [0.04 * m, 0.068, 0.04 * m]);
  const forearm = roundCone(el, [wr[0], wr[1] + 0.01, wr[2]], 0.042, 0.031);
  const forearmBulge = ellipsoid([el[0] + 0.004, el[1] - 0.06, 0.006], [0.041 * m, 0.062, 0.038 * m]);
  const upperArms = mirrorX(blend(0.03, deltoid, upperArm, biceps));
  const forearms = mirrorX(blend(0.025, forearm, forearmBulge));
  const arms = blend(0.03, upperArms, forearms);

  // ---- legs
  const hp = J('thighL'), kn = J('shinL'), an = J('footL');
  const thigh = roundCone([hp[0], hp[1] + 0.02, 0], kn, 0.09 * (0.9 + 0.1 * m), 0.061);
  const quads = ellipsoid([hp[0] + 0.004, 0.72, 0.028], [0.071 * m, 0.14, 0.06]);
  const knee = ellipsoid([kn[0], kn[1] + 0.005, kn[2] + 0.02], [0.05, 0.05, 0.045]);
  const shin = roundCone(kn, [an[0], an[1] + 0.03, an[2] + 0.005], 0.055, 0.04);
  const calf = ellipsoid([kn[0] + 0.002, kn[1] - 0.13, kn[2] - 0.028], [0.052 * m, 0.088, 0.05 * m]);
  const thighs = mirrorX(blend(0.03, thigh, quads));
  const shins = mirrorX(blend(0.025, shin, calf, knee));
  const legs = blend(0.035, hips, glutes, thighs, shins);

  const f = blend(0.03, torso, neck, arms, legs);
  // loose cloth doesn't show muscles: simple tapered limbs, generous blends
  const sleeveUpper = mirrorX(roundCone([sh[0] + 0.004, sh[1] - 0.03, 0], el, 0.056, 0.047));
  const sleeveFore = mirrorX(roundCone(el, [wr[0], wr[1] + 0.01, wr[2]], 0.047, 0.037));
  const clothTop = blend(0.05, blend(0.06, hips, waist, ribs, lats), traps, blend(0.04, sleeveUpper, sleeveFore));
  return { f, clothTop, torso, arms, upperArms, forearms, legs, hips: blend(0.04, hips, glutes), thighs, shins, neck };
}

// ------------------------------------------------------------------ skin ownership
/** Bone segments for choosing which joint owns a vertex of a sculpted part (nearest by reach). */
const BONES: { joint: string; a: V3; b: V3; r: number }[] = (() => {
  const J = (n: string): V3 => SKELETON.find((j) => j.name === n)!.pos;
  const out: { joint: string; a: V3; b: V3; r: number }[] = [];
  const seg = (joint: string, a: V3, b: V3, r: number) => out.push({ joint, a, b, r });
  seg('pelvis', [0, 0.84, 0], [0, 1.02, 0], 0.16);
  seg('chest', [0, 1.02, 0], [0, 1.42, 0], 0.17);
  seg('neck', J('neck'), J('head'), 0.06);
  seg('head', J('head'), [0, 1.75, 0], 0.12);
  for (const s of ['L', 'R']) {
    seg('arm' + s, J('arm' + s), J('fore' + s), 0.06);
    seg('fore' + s, J('fore' + s), J('hand' + s), 0.05);
    seg('hand' + s, J('hand' + s), [J('hand' + s)[0], J('hand' + s)[1] - 0.12, J('hand' + s)[2]], 0.045);
    seg('thigh' + s, J('thigh' + s), J('shin' + s), 0.09);
    seg('shin' + s, J('shin' + s), J('foot' + s), 0.06);
    seg('foot' + s, J('foot' + s), [J('foot' + s)[0], 0.03, J('foot' + s)[2] + 0.15], 0.05);
  }
  return out;
})();

/** Joint index that should own a point of a deformable part (normalised distance to bones). */
export function ownerJoint(p: V3): number {
  let best = 0, bd = Infinity;
  for (const b of BONES) {
    const bx = b.b[0] - b.a[0], by = b.b[1] - b.a[1], bz = b.b[2] - b.a[2];
    const l2 = bx * bx + by * by + bz * bz || 1e-12;
    let h = ((p[0] - b.a[0]) * bx + (p[1] - b.a[1]) * by + (p[2] - b.a[2]) * bz) / l2;
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const d = Math.hypot(p[0] - b.a[0] - bx * h, p[1] - b.a[1] - by * h, p[2] - b.a[2] - bz * h) / b.r;
    if (d < bd) {
      bd = d;
      best = SKELETON.findIndex((j) => j.name === b.joint);
    }
  }
  return best;
}

export { plane, intersect, carve, smin, smax };
