// Boots v3 — Chinese boots (靴) as one sculpted form: a tall shaft with a padded cuff, a soft
// vamp, a thick layered sole and a slightly upturned toe.

import type { V3 } from '../../../src/core/math';
import { SDF, roundCone, ellipsoid, blend, torus, intersect, plane } from '../sdf/sdf';

/** Left boot around the ankle `a` (model space); mirror X for the right. */
export function bootSDF(a: V3, height = 0.34): SDF {
  const x = a[0];
  const shaft = roundCone([x, 0.1, a[2] - 0.004], [x, height, a[2] + 0.004], 0.05, 0.058);
  const cuff = torus([x, height - 0.004, a[2] + 0.004], 0.058, 0.009);
  const heel = ellipsoid([x, 0.058, -0.04], [0.045, 0.058, 0.045]);
  const foot = ellipsoid([x, 0.052, 0.045], [0.049, 0.052, 0.092]);
  const toe = ellipsoid([x, 0.042, 0.135], [0.037, 0.034, 0.052]);
  const tip = roundCone([x, 0.045, 0.17], [x, 0.074, 0.203], 0.017, 0.007);
  let f = blend(0.03, shaft, heel, foot);
  f = blend(0.024, f, toe);
  f = blend(0.012, f, tip);
  f = blend(0.006, f, cuff);
  return intersect(f, plane([0, 0.0, 0], [0, -1, 0]));
}
