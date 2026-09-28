// Ear for head v4: a sculpted plate hinged to the side of the head at its front edge (so the
// front flows into the skin in front of it) and standing off the skull towards the back, as real
// ears do. Its relief is laid out over the ear's own outline: the helix rolls round the top and
// back edge and turns into the concha as the crus; inside it runs the scapha, then the antihelix,
// which forks at the top round the triangular fossa; the concha is a deep bowl with the tragus in
// front and the antitragus below; the lobe is soft and has no cartilage relief.
//
// Ear-local frame: u backwards from the hinge, v up, w out from the ear's back plane (metres).

import type { V3 } from '../../../src/core/math';
import type { SDF } from '../sdf/sdf';
import { smax, smin } from '../sdf/sdf';

const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a: number, b: number, x: number) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const ell2 = (u: number, v: number, cu: number, cv: number, ru: number, rv: number) => {
  // approximate distance to an ellipse (scaled by the smaller radius)
  const q = Math.hypot((u - cu) / ru, (v - cv) / rv);
  return (q - 1) * Math.min(ru, rv);
};
/** rounded ridge profile: 1 on the crest, 0 at ±hw */
const ridge = (d: number, hw: number) => {
  const t = 1 - (d / hw) ** 2;
  return t > 0 ? Math.sqrt(t) : 0;
};
/** distance from (u, v) to the polyline through pts */
function polyDist(u: number, v: number, pts: [number, number][]) {
  let best = Infinity, along = 0, acc = 0, total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    const t = sat(((u - ax) * dx + (v - ay) * dy) / (L * L));
    const d = Math.hypot(u - ax - dx * t, v - ay - dy * t);
    if (d < best) {
      best = d;
      along = (acc + t * L) / total;
    }
    acc += L;
  }
  return { d: best, t: along };
}

export interface EarPlacement {
  /** hinge point on the head (the +X ear) */
  origin: V3;
  /** degrees the ear stands off the skull (cranio-auricular angle) */
  standOff: number;
  /** degrees the ear's long axis leans back */
  lean: number;
  scale: number;
}

/** Outline of the ear (negative inside): the upper ear, the lobe, and the attachment in front. */
function outline(u: number, v: number) {
  const upper = ell2(u, v, 0.0175, 0.0055, 0.0165, 0.026);
  const lobe = ell2(u, v, 0.0135, -0.021, 0.0098, 0.0115);
  const attach = ell2(u, v, 0.002, -0.004, 0.009, 0.019);
  return smin(smin(upper, lobe, 0.012), attach, 0.006);
}

const ANTIHELIX: [number, number][] = [[0.0165, -0.0145], [0.022, -0.006], [0.0235, 0.004], [0.0215, 0.0145], [0.0165, 0.0215]];
const SUP_CRUS: [number, number][] = [[0.0165, 0.0215], [0.0105, 0.0265]];
const INF_CRUS: [number, number][] = [[0.0175, 0.018], [0.0085, 0.0145], [0.0035, 0.0125]];
const CRUS: [number, number][] = [[0.0035, 0.024], [0.0045, 0.0115], [0.0085, 0.0055]];

/** Relief height above the ear's back plane at (u, v) (the ear's thickness), 0 outside. */
function relief(u: number, v: number) {
  const e = -outline(u, v); // depth inside the outline
  if (e <= 0) return 0;
  // the helix rolls round the top and back, fading at the lobe and into the crus in front
  const ang = Math.atan2(v - 0.0055, u - 0.0175);
  const helixOn = sstep(-1.35, -0.85, ang) * sstep(2.75, 2.2, ang);
  const helix = helixOn * ridge(e - 0.0027, 0.0029);
  const scapha = helixOn * sstep(0.004, 0.0062, e);
  const ah = polyDist(u, v, ANTIHELIX), sc = polyDist(u, v, SUP_CRUS), ic = polyDist(u, v, INF_CRUS), cr = polyDist(u, v, CRUS);
  const antihelix = Math.max(ridge(ah.d, 0.0034) * (0.75 + 0.25 * sstep(0.0, 0.3, ah.t)), ridge(sc.d, 0.003) * 0.6 * sstep(1, 0.4, sc.t), ridge(ic.d, 0.0028) * 0.55 * sstep(1, 0.5, ic.t));
  const crus = ridge(cr.d, 0.0022) * sstep(0.0, 0.2, cr.t);
  // the lobe: soft, thicker, no relief
  const lobeW = sstep(-0.012, -0.018, v);
  let h = 0.0021 + 0.0022 * helix - 0.0006 * scapha * (1 - lobeW) + 0.0019 * antihelix * (1 - lobeW) + 0.0012 * crus;
  h = h * (1 - lobeW) + (0.0026 + 0.0014 * sat(e / 0.004)) * lobeW;
  // tragus and antitragus: small flaps round the concha's opening
  h += 0.0016 * Math.pow(ridge(Math.hypot((u - 0.0008) / 0.0027, (v + 0.0045) / 0.005), 1), 0.9);
  h += 0.0011 * Math.pow(ridge(Math.hypot((u - 0.0125) / 0.0045, (v + 0.0142) / 0.0028), 1), 0.9);
  // rounded edge all round
  return h * Math.sqrt(sat(e / 0.0016));
}

/** Ear SDF in head space (mirrored to both sides) and the concha to carve after joining the head. */
export function earSDF(p: EarPlacement): { ear: SDF; concha: SDF; bound: { c: V3; r: number } } {
  const s = p.scale;
  const tau = (p.lean * Math.PI) / 180, al = (p.standOff * Math.PI) / 180;
  // axes: U0 = back (−z), V0 = up, W0 = out (+x)
  const U1: V3 = [0, -Math.sin(tau), -Math.cos(tau)];
  const V1: V3 = [0, Math.cos(tau), -Math.sin(tau)];
  const W0: V3 = [1, 0, 0];
  const U2: V3 = [U1[0] * Math.cos(al) + W0[0] * Math.sin(al), U1[1] * Math.cos(al), U1[2] * Math.cos(al)];
  const W2: V3 = [-U1[0] * Math.sin(al) + W0[0] * Math.cos(al), -U1[1] * Math.sin(al), -U1[2] * Math.sin(al)];
  const [ox, oy, oz] = p.origin;
  const local = (x: number, y: number, z: number): V3 => {
    const dx = Math.abs(x) - ox, dy = y - oy, dz = z - oz;
    return [(dx * U2[0] + dy * U2[1] + dz * U2[2]) / s, (dx * V1[0] + dy * V1[1] + dz * V1[2]) / s, (dx * W2[0] + dy * W2[1] + dz * W2[2]) / s];
  };
  const ear: SDF = (x, y, z) => {
    const [u, v, w] = local(x, y, z);
    const o = outline(u, v);
    // the back plane sinks into the head towards the hinge, so the front is attached
    const back = 0.0012 + 0.022 * sstep(0.019, 0.004, u) * sstep(-0.028, -0.012, v) * sstep(0.022, 0.01, v);
    let d = smax(o, w - relief(u, v), 0.0012);
    d = smax(d, -w - back, 0.0015);
    return d * s;
  };
  const concha: SDF = (x, y, z) => {
    const [u, v, w] = local(x, y, z);
    // the bowl, deepest over the ear canal
    const q = Math.hypot((u - 0.0085) / 0.0072, (v + 0.0035) / 0.0092, (w - 0.0015) / 0.0055);
    const canal = Math.hypot((u - 0.0036) / 0.0017, (v + 0.0042) / 0.0024, (w + 0.004) / 0.007);
    return smin((q - 1) * 0.0055, (canal - 1) * 0.0017, 0.002) * s;
  };
  const c: V3 = [ox + 0.015 * s, oy, oz - 0.012 * s];
  return { ear, concha, bound: { c, r: 0.045 * s } };
}
