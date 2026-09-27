// Detailed figure kit (humanoid v2): a sculpted head with a real face, a shaped torso, muscled
// limbs with cloth folds, jointed hands and Chinese boots. Deformable pieces are marked `soft` and
// get blended skin weights (kit/skin.ts), so shoulders, elbows, wrists, hips, knees, ankles and
// the neck bend smoothly.
//
// Conventions as in humanoid.ts: metres, +Y up, +Z forward, the character's LEFT is +X.
// Proportions stay slightly heroic (head ≈ 1/7 of the height) so faces still read in close-ups
// and the silhouette reads from the RTS camera.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { MaterialDef, MaterialPattern as P } from '../../../src/core/materialModel';
import { V3, add, sub, scale, normalize, cross, dot, len } from '../../../src/core/math';

const mat = (name: string, color: number, o: Partial<MaterialDef> = {}): MaterialDef => ({ name, color, roughness: 0.8, ...o });
export const FACE = {
  lips: mat('lips', 0xc07565, { roughness: 0.5, pattern: P.Skin }),
  eyeWhite: mat('eye_white', 0xf0ebe2, { roughness: 0.2 }),
  iris: mat('iris', 0x3b2415, { roughness: 0.15 }),
  pupil: mat('pupil', 0x0b0807, { roughness: 0.1 }),
  lash: mat('lash', 0x141110, { roughness: 0.7 }),
  hairSheen: mat('hair', 0x1c1816, { roughness: 0.45 }),
  sole: mat('sole', 0x201a16, { roughness: 0.9 }),
};

export type HandPose = 'relaxed' | 'fist' | 'open';
export interface FaceStyle {
  /** brow shape: soldiers look stern, scholars calm */
  brows?: 'stern' | 'calm' | 'arched';
  beard?: 'none' | 'moustache' | 'goatee' | 'long';
  /** hair on the head: a topknot (髻), a low bun, two loops, or cropped under a helmet */
  hair?: 'topknot' | 'low' | 'loops' | 'cropped' | 'none';
  /** 0 young … 1 old: deeper sockets and cheeks, grey hair */
  age?: number;
  skin?: MaterialDef;
  /** proportions of the face (1 = the default) */
  shape?: Partial<FaceShape>;
}
export interface FaceShape {
  width: number;
  /** >1 broad square jaw and strong chin, <1 narrow and soft */
  jaw: number;
  nose: number;
  eyes: number;
  lips: number;
  /** brow-ridge strength */
  brow: number;
}
// the head being built (build is synchronous; set by buildHead)
let SHAPE: FaceShape = { width: 1, jaw: 1, nose: 1, eyes: 1, lips: 1, brow: 1 };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Surface whose winding is chosen so its faces point away from `inside`. */
function surfaceOut(mb: MeshBuilder, f: (u: number, v: number) => V3, nu: number, nv: number, inside: V3, opts: { uvFn?: (u: number, v: number) => [number, number]; keep?: (centroid: V3) => boolean } = {}) {
  // probe the orientation on a well-behaved quad in the middle of the patch
  const u0 = 0.5, v0 = 0.5, du = 1 / nu, dv = 1 / nv;
  const a = f(u0, v0), b = f(u0 + du, v0), c = f(u0, v0 + dv);
  const n = cross(sub(b, a), sub(c, a));
  const flip = dot(n, sub(a, inside)) < 0;
  if (!opts.keep) {
    mb.surface(f, nu, nv, { flip, uvFn: opts.uvFn });
    return;
  }
  // masked surface: emit only the kept quads (with smooth normals from the full grid)
  const tmp = new MeshBuilder('tmp');
  tmp.mat(mb.currentMaterial);
  tmp.joint = mb.joint;
  tmp.soft = mb.soft;
  tmp.surface(f, nu, nv, { flip, uvFn: opts.uvFn });
  const keepTris = tmp.tris.filter((t) => opts.keep!(scale(add(add(t.p[0], t.p[1]), t.p[2]), 1 / 3)));
  tmp.tris = keepTris;
  mb.append(tmp);
}

// ================================================================== head
const HC: V3 = [0, 1.6, 0.012]; // head centre (bind pose)
const SX = 0.1, SY = 0.126, SZ = 0.115;

interface Bump {
  c: V3;
  r: [number, number];
  a: number;
}
/** anisotropic gaussian on the unit sphere of directions */
const bump = (d: V3, b: Bump) => {
  const dx = (d[0] - b.c[0]) / b.r[0], dy = (d[1] - b.c[1]) / b.r[1], dz = (d[2] - b.c[2]) / ((b.r[0] + b.r[1]) / 2);
  return b.a * Math.exp(-(dx * dx + dy * dy + dz * dz));
};
const sym = (c: V3, r: [number, number], a: number): Bump[] => [{ c, r, a }, { c: [-c[0], c[1], c[2]], r, a }];

function headBumps(age: number): Bump[] {
  return [
    ...sym(normalize([0.36, 0.12, 0.92]), [0.16, 0.1], -0.07 - age * 0.02), // eye sockets
    ...sym(normalize([0.34, 0.3, 0.9]), [0.24, 0.08], 0.028 * SHAPE.brow), // brow ridge
    ...sym(normalize([0.62, -0.08, 0.78]), [0.2, 0.16], 0.045), // cheekbones
    ...sym(normalize([0.55, -0.42, 0.72]), [0.18, 0.18], -0.025 - age * 0.025), // cheek hollows
    ...sym(normalize([0.88, 0.3, 0.35]), [0.2, 0.22], -0.03), // temples
    { c: normalize([0, -0.45, 0.9]), r: [0.3, 0.2], a: 0.035 }, // muzzle (mouth area)
    { c: normalize([0, -0.82, 0.58]), r: [0.2 * SHAPE.jaw, 0.16], a: 0.09 * (0.6 + 0.4 * SHAPE.jaw) }, // chin
    { c: normalize([0, 0.08, 1]), r: [0.08, 0.2], a: 0.022 }, // nose bridge root
    { c: normalize([0, 0.35, -0.9]), r: [0.5, 0.4], a: 0.04 }, // occiput
  ];
}

/** point on the sculpted head surface for a unit direction (relative to the head centre) */
function headPoint(n: V3, bumps: Bump[]): V3 {
  const low = smooth(0, -1, n[1]);
  let x = n[0] * SX * SHAPE.width, y = n[1] * SY, z = n[2] * SZ;
  // the jaw narrows; the lower back tucks in towards the neck
  x *= 1 - (0.3 / SHAPE.jaw) * Math.pow(low, 1.3);
  if (n[2] < 0) z *= 1 - 0.38 * low;
  let k = 1;
  for (const b of bumps) k += bump(n, b);
  return [x * k, y * k, z * k];
}
/** surface point in front of the face at local (x, y) (m, relative to the head centre) */
function facePoint(x: number, y: number, bumps: Bump[]): V3 {
  let n = normalize([x / SX, y / SY, 1]);
  for (let it = 0; it < 6; it++) {
    const p = headPoint(n, bumps);
    n = normalize([n[0] + (x - p[0]) / SX, n[1] + (y - p[1]) / SY, n[2]]);
  }
  return headPoint(n, bumps);
}

function sphereDir(u: number, v: number): V3 {
  // u: longitude with the seam at the back; v: 0 top → 1 bottom
  const ph = (u - 0.5) * Math.PI * 2, th = v * Math.PI;
  return [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
}

export function buildHead(mb: MeshBuilder, joint: number, st: FaceStyle = {}) {
  const age = st.age ?? 0.2;
  const skin = st.skin ?? PAL.skin;
  SHAPE = { width: 1, jaw: 1, nose: 1, eyes: 1, lips: 1, brow: 1, ...st.shape };
  const bumps = headBumps(age);
  const at = (p: V3): V3 => add(HC, p);
  const fp = (x: number, y: number, out = 0): V3 => {
    const p = facePoint(x, y, bumps);
    return at(add(p, scale(normalize(p), out)));
  };

  // ---- skull and face
  mb.with(null, () => surfaceOut(mb, (u, v) => at(headPoint(sphereDir(u, v), bumps)), 40, 30, HC), { mat: skin, joint });

  // ---- nose: a ridge from between the eyes to the tip, with nostril wings
  mb.with(null, () => {
    const top = facePoint(0, 0.018, bumps), tip = facePoint(0, -0.034, bumps);
    const fwd = normalize([0, 0.15, 1]);
    const f = (t: number, s: number): V3 => {
      const c = add(add(scale(top, 1 - t), scale(tip, t)), [0, 0, -0.004]);
      const w = (0.006 + t * 0.012 - Math.max(0, t - 0.85) * 0.03) * SHAPE.nose;
      const h = (0.003 + Math.pow(t, 1.4) * 0.019) * SHAPE.nose;
      const x = (s - 0.5) * 2;
      return at(add(add(c, [x * w, 0, 0]), scale(fwd, h * Math.pow(Math.max(0, 1 - x * x), 0.55))));
    };
    surfaceOut(mb, f, 8, 6, at(add(top, [0, 0, -0.04])));
    const k = SHAPE.nose;
    mb.at(HC[0] + tip[0], HC[1] + tip[1] + 0.001, HC[2] + tip[2] + 0.0135 * k, () => mb.sphere(0.0082 * k, 12, 8, { squash: [1.05, 0.8, 0.95] }));
    for (const s of [-1, 1]) mb.at(HC[0] + s * 0.0112 * k, HC[1] + tip[1] - 0.0015, HC[2] + tip[2] + 0.0055 * k, () => mb.sphere(0.006 * k, 10, 6, { squash: [0.8, 0.7, 1.15] }));
  }, { mat: skin, joint });

  // ---- eyes: eyeball, iris, pupil; almond upper lid with a lash line; brows
  for (const s of [-1, 1]) {
    const ex = s * 0.037, ey = 0.02;
    const surf = facePoint(ex, ey, bumps);
    const c = at([ex, ey, surf[2] - 0.0045]);
    const R = 0.0125 * SHAPE.eyes;
    mb.with(null, () => mb.at(c[0], c[1], c[2], () => mb.sphere(R, 12, 10)), { mat: FACE.eyeWhite, joint });
    // look slightly inward and down, like someone watching the field ahead
    const look = normalize([-s * 0.08, -0.06, 1]);
    const irisC = add(c, scale(look, R * 0.93));
    mb.with(null, () => mb.at(irisC[0], irisC[1], irisC[2], () => mb.sphere(0.0066 * SHAPE.eyes, 10, 6, { squash: [1, 1, 0.35] })), { mat: FACE.iris, joint });
    const pupC = add(c, scale(look, R * 0.985));
    mb.with(null, () => mb.at(pupC[0], pupC[1], pupC[2], () => mb.sphere(0.003, 8, 4, { squash: [1, 1, 0.4] })), { mat: FACE.pupil, joint });
    // upper lid: a cap over the top of the eyeball, tilted so the outer corner rises
    const tilt = s * 6;
    mb.with(T(c[0], c[1], c[2], [0, 0, tilt]), () => {
      const lid = (u: number, v: number): V3 => {
        const ph = (u - 0.5) * Math.PI * 1.25, th = v * 1.3;
        const r = R * 1.1;
        return [Math.sin(th) * Math.sin(ph) * r * 1.05, Math.cos(th) * r, Math.sin(th) * Math.cos(ph) * r];
      };
      surfaceOut(mb, lid, 10, 5, [0, 0, 0]);
    }, { mat: skin, joint });
    mb.with(T(c[0], c[1], c[2], [0, 0, tilt]), () => {
      const pts: V3[] = [];
      for (let i = 0; i <= 8; i++) {
        const ph = (i / 8 - 0.5) * Math.PI * 1.2, th = 1.3;
        const r = R * 1.12;
        pts.push([Math.sin(th) * Math.sin(ph) * r * 1.05, Math.cos(th) * r - 0.0006, Math.sin(th) * Math.cos(ph) * r]);
      }
      mb.tube(pts, (t) => 0.0011 + Math.sin(t * Math.PI) * 0.0006, 4);
    }, { mat: FACE.lash, joint });
    // lower lid: a soft ledge
    mb.with(T(c[0], c[1], c[2], [0, 0, tilt * 0.5]), () => {
      const pts: V3[] = [];
      for (let i = 0; i <= 6; i++) {
        const ph = (i / 6 - 0.5) * Math.PI * 1.0, th = Math.PI - 1.05;
        const r = R * 1.02;
        pts.push([Math.sin(th) * Math.sin(ph) * r, Math.cos(th) * r, Math.sin(th) * Math.cos(ph) * r]);
      }
      mb.tube(pts, 0.0016, 4);
    }, { mat: skin, joint });
    // brow
    const shape = st.brows ?? 'calm';
    const bp: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = s * (0.013 + t * 0.047);
      const arch = shape === 'arched' ? Math.sin(t * Math.PI) * 0.006 : shape === 'stern' ? -0.004 + t * 0.006 : Math.sin(t * Math.PI) * 0.003;
      bp.push(fp(x, 0.043 + arch - (shape === 'stern' ? (1 - t) * 0.003 : 0), 0.0015));
    }
    mb.with(null, () => mb.tube(bp, (t) => 0.0042 - t * 0.0025, 5, { squash: [1.6, 0.6] }), { mat: FACE.lash, joint });
  }

  // ---- mouth: upper lip with a cupid's bow, fuller lower lip
  mb.with(null, () => {
    const up: V3[] = [], lo: V3[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, x = (t - 0.5) * 0.046;
      const bow = Math.exp(-Math.pow((t - 0.5) / 0.12, 2)) * 0.0015;
      up.push(fp(x, -0.058 + bow - Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.002, -0.001));
      lo.push(fp(x * 0.92, -0.067 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.004, -0.0015));
    }
    mb.tube(up, (t) => (0.0016 + Math.sin(t * Math.PI) * 0.0028) * SHAPE.lips, 6, { squash: [1, 0.65] });
    mb.tube(lo, (t) => (0.0016 + Math.sin(t * Math.PI) * 0.0038) * SHAPE.lips, 6, { squash: [1, 0.7] });
  }, { mat: FACE.lips, joint });

  // ---- ears
  for (const s of [-1, 1]) {
    mb.with(null, () => {
      mb.at(HC[0] + s * 0.098, HC[1] - 0.006, HC[2] - 0.012, () => {
        mb.blob(0.03, 2, { squash: [0.3, 1.05, 0.66], displace: (d) => (d[0] * s > 0.3 ? -0.25 * Math.max(0, 1 - Math.hypot(d[1], d[2]) * 1.6) : 0) });
        mb.at(0, -0.024, 0.004, () => mb.sphere(0.011, 8, 6, { squash: [0.6, 1, 0.9] })); // lobe
      }, [0, s * -8, 0]);
    }, { mat: skin, joint });
  }

  // ---- hair
  const hairMat = age > 0.6 ? { ...FACE.hairSheen, name: 'hair_grey', color: 0x8e8a86 } : FACE.hairSheen;
  const style = st.hair ?? 'topknot';
  if (style !== 'none') {
    // hairline: high on the forehead, above the ears, down to the nape
    // how far above the hairline a direction is (≤ 0: bare skin)
    const hairline = (d: V3) => {
      const front = smooth(0.2, 0.9, d[2]);
      const side = smooth(0.6, 0.95, Math.abs(d[0]));
      const line = 0.5 * front * (1 - side) + (0.02 + 0.08 * (1 - side)) * (1 - front) + side * 0.05;
      const back = d[2] < -0.2 ? Math.min(line, -0.45) : line;
      return d[1] - back - (style === 'cropped' ? 0.1 : 0);
    };
    const thick = (d: V3) => smooth(-0.02, 0.08, hairline(d));
    mb.with(null, () => {
      surfaceOut(mb, (u, v) => {
        const d = sphereDir(u, v);
        const p = headPoint(d, bumps);
        // combed strands: fine ridges running back from the hairline; the hair thins to a
        // sheet at the hairline so its edge doesn't step
        const k = thick(d);
        const strands = 0.0012 * Math.sin((u - 0.5) * Math.PI * 2 * 44) * smooth(0.95, 0.2, v) * k;
        return at(add(p, scale(normalize(p), 0.0009 + (0.0042 + strands + 0.004 * smooth(0.5, 0, v)) * k)));
      }, 60, 40, HC, { keep: (c) => hairline(normalize(sub(c, HC))) > -0.03 });
    }, { mat: hairMat, joint });
    if (style === 'topknot') {
      // 髻: a bun on the crown, bound with a ribbon and a jade pin
      mb.with(null, () => mb.at(HC[0], HC[1] + 0.128, HC[2] - 0.012, () => mb.sphere(0.034, 12, 9, { squash: [1, 1.05, 1] })), { mat: hairMat, joint });
      mb.with(null, () => mb.at(HC[0], HC[1] + 0.112, HC[2] - 0.012, () => mb.cylinder({ r: 0.028, rTop: 0.03, h: 0.014, sides: 12 })), { mat: PAL.clothRed, joint });
      mb.with(null, () => mb.at(HC[0], HC[1] + 0.14, HC[2] - 0.012, () => mb.cylinder({ r: 0.0035, h: 0.11, y0: -0.055, sides: 5 }), [0, 0, 90]), { mat: PAL.jade, joint });
    } else if (style === 'low') {
      mb.with(null, () => mb.at(HC[0], HC[1] - 0.02, HC[2] - 0.115, () => mb.sphere(0.036, 10, 8, { squash: [1, 0.9, 0.85] })), { mat: hairMat, joint });
    } else if (style === 'loops') {
      for (const s of [-1, 1]) mb.with(null, () => mb.at(HC[0] + s * 0.07, HC[1] + 0.115, HC[2] - 0.03, () => mb.blob(0.036, 2, { squash: [0.65, 1, 1] })), { mat: hairMat, joint });
    }
  }
  // ---- facial hair
  const beard = st.beard ?? 'none';
  if (beard !== 'none') {
    mb.with(null, () => {
      // drooping moustache from under the nose past the mouth corners
      for (const s of [-1, 1]) {
        const pts = [fp(s * 0.004, -0.045, 0.004), fp(s * 0.016, -0.05, 0.005), fp(s * 0.027, -0.062, 0.004), fp(s * 0.031, -0.082, 0.002)];
        mb.tube(pts, (t) => 0.003 - t * 0.0018, 5, { squash: [1.4, 0.8] });
      }
      if (beard === 'goatee' || beard === 'long') {
        const L = beard === 'long' ? 0.13 : 0.05;
        const chin = fp(0, -0.098, 0.002);
        const pts: V3[] = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          pts.push(add(chin, [0, -t * L, 0.006 + Math.sin(t * 1.4) * 0.018]));
        }
        mb.tube(pts, (t) => (beard === 'long' ? 0.02 : 0.013) * (1 - t * 0.85), 7, { squash: [1.3, 0.8] });
      }
    }, { mat: hairMat, joint });
  }
}

// ================================================================== hands
/**
 * A hand at `wrist` hanging along -Y with the palm facing the body. side +1 = left hand.
 * Four three-segment fingers and a thumb, curled per pose.
 */
export function buildHand(mb: MeshBuilder, joint: number, side: 1 | -1, wrist: V3, pose: HandPose, skin: MaterialDef = PAL.skin) {
  const curl = pose === 'fist' ? [72, 95, 70] : pose === 'open' ? [6, 8, 6] : [22, 30, 22];
  const inward: V3 = [-side, 0, 0]; // palm normal
  mb.with(null, () => {
    // palm: a flattened, slightly cupped block
    const pc = add(wrist, [0, -0.036, 0.004]);
    mb.at(pc[0], pc[1], pc[2], () => mb.sphere(0.03, 12, 8, { squash: [0.55, 1.15, 1] }));
    mb.at(wrist[0], wrist[1] - 0.004, wrist[2], () => mb.sphere(0.024, 10, 6, { squash: [0.75, 0.7, 1] }));
    // fingers: index at the front (+Z) … little finger at the back
    const fz = [0.017, 0.006, -0.005, -0.015], fl = [0.021, 0.024, 0.022, 0.017], fr = [0.0072, 0.0075, 0.0071, 0.0064];
    for (let f = 0; f < 4; f++) {
      let p: V3 = add(wrist, [side * -0.002, -0.066 + Math.abs(f - 1.3) * 0.003, fz[f]]);
      const pts: V3[] = [p];
      // each knuckle bends the finger further towards the palm (about the knuckle line, Z)
      let A = 0;
      for (let k = 0; k < 3; k++) {
        A += (curl[k] * Math.PI) / 180;
        const dir = normalize(add(add(scale(inward, Math.sin(A)), [0, -Math.cos(A), 0]), [0, 0, -0.04 * (f - 1.5)]));
        p = add(p, scale(dir, fl[f] * (k === 0 ? 0.45 : k === 1 ? 0.32 : 0.26) * 1.9));
        pts.push(p);
      }
      mb.tube(pts, (t) => fr[f] * (1 - t * 0.28), 6);
      mb.at(p[0], p[1], p[2], () => mb.sphere(fr[f] * 0.72, 6, 4));
    }
    // thumb: from the front of the palm, across towards the fingers
    const t0 = add(wrist, [side * -0.012, -0.022, 0.024]);
    const tc = pose === 'fist' ? 1 : pose === 'open' ? 0.1 : 0.5;
    const t1 = add(t0, [side * -0.012 * (1 + tc), -0.016, 0.012 - tc * 0.004]);
    const t2 = add(t1, [side * -0.01 * tc, -0.014 + tc * 0.004, 0.004 - tc * 0.01]);
    mb.tube([t0, t1, t2], (t) => 0.0088 - t * 0.0022, 6);
    mb.at(t2[0], t2[1], t2[2], () => mb.sphere(0.0064, 6, 4));
  }, { mat: skin, joint });
}

// ================================================================== limbs and torso
/** Tube with an arbitrary radius profile along a path, soft-skinned. Radial `folds` wrinkle cloth. */
function limb(mb: MeshBuilder, path: V3[], r: (t: number) => number, sides = 14, folds = 0) {
  if (!folds) {
    mb.tube(path, r, sides, { capStart: false, capEnd: false });
    return;
  }
  // folds: sample the path and add a gentle ripple around the circumference
  const n = path.length;
  const seg = (t: number): V3 => {
    const x = t * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    return add(scale(path[i], 1 - f), scale(path[i + 1], f));
  };
  const f = (u: number, v: number): V3 => {
    const c = seg(v);
    const d = normalize(sub(seg(Math.min(1, v + 0.02)), seg(Math.max(0, v - 0.02))));
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    const a = normalize(cross(d, ref)), b = normalize(cross(d, a));
    const ang = u * Math.PI * 2;
    const rr = r(v) * (1 + folds * Math.sin(ang * 5 + v * 9) * Math.sin(v * Math.PI));
    return add(c, add(scale(a, Math.cos(ang) * rr), scale(b, Math.sin(ang) * rr)));
  };
  surfaceOut(mb, f, sides, Math.max(4, (n - 1) * 3), seg(0.5));
}

export interface FigureStyle {
  skin?: MaterialDef;
  trousers: MaterialDef;
  tunic: MaterialDef;
  sleeves?: MaterialDef;
  boots?: MaterialDef;
  sash?: MaterialDef;
  /** crossed-collar trim (交领) */
  collar?: MaterialDef;
  /** long robe skirt instead of trousers below the tunic (the legs stay underneath) */
  robe?: MaterialDef;
  face?: FaceStyle;
  handL?: HandPose;
  handR?: HandPose;
}

export interface FigureJoints {
  pelvis: number;
  chest: number;
  neck: number;
  head: number;
  arm: [number, number];
  fore: [number, number];
  hand: [number, number];
  thigh: [number, number];
  shin: [number, number];
  foot: [number, number];
}

export function buildFigure(mb: MeshBuilder, J: FigureJoints, st: FigureStyle) {
  const skin = st.skin ?? st.face?.skin ?? PAL.skin;
  const boots = st.boots ?? PAL.leather;
  const sleeves = st.sleeves ?? st.tunic;
  const legMat = st.robe ?? st.trousers;

  // ---- legs: baggy trousers with folds, boots with an upturned toe
  for (const side of [1, -1] as const) {
    const i = side > 0 ? 0 : 1;
    const x = 0.1 * side;
    mb.with(null, () => limb(mb, [[x, 0.96, 0.0], [x * 1.02, 0.74, 0.008], [x, 0.5, 0.014]], (t) => 0.094 - t * 0.026, 14, 0.035), { mat: legMat, joint: J.thigh[i], soft: true });
    mb.with(null, () => limb(mb, [[x, 0.5, 0.014], [x * 0.98, 0.42, 0.01], [x * 0.96, 0.31, -0.002]], (t) => 0.068 + Math.sin(t * Math.PI) * 0.006 - t * 0.004, 14, 0.03), { mat: legMat, joint: J.shin[i], soft: true });
    // boot shaft
    mb.with(null, () => mb.tube([[x * 0.96, 0.34, -0.002], [x * 0.97, 0.2, -0.006], [x * 0.98, 0.1, -0.01]], (t) => 0.06 - t * 0.008, 14, { capStart: false, capEnd: false }), { mat: boots, joint: J.shin[i], soft: true });
    mb.with(null, () => mb.tube([[x * 0.96, 0.345, -0.002], [x * 0.96, 0.325, -0.002]], 0.066, 14), { mat: boots, joint: J.shin[i] });
    // foot: vamp lofted from the heel to an upturned toe, on a thick sole
    mb.with(null, () => {
      const f = (u: number, v: number): V3 => {
        const z = -0.06 + v * 0.23;
        const toe = smooth(0.75, 1, v);
        const w = 0.047 * (1 - Math.pow(Math.max(0, v - 0.55) / 0.45, 1.6) * 0.72) * (0.85 + 0.15 * Math.sin(v * Math.PI));
        const h = 0.105 * (1 - smooth(0.25, 0.95, v) * 0.7) + toe * 0.02;
        const a = u * Math.PI; // top half-ellipse from the outer to the inner side
        return [x * 0.99 + Math.cos(a) * w, 0.03 + Math.sin(a) * h + toe * toe * 0.025, z];
      };
      surfaceOut(mb, f, 10, 12, [x, 0.045, 0.04]);
      // heel back and toe caps
      mb.at(x * 0.99, 0.065, -0.058, () => mb.sphere(0.046, 10, 6, { squash: [1, 0.85, 0.5] }));
    }, { mat: boots, joint: J.foot[i], soft: true });
    mb.with(null, () => mb.box([0.1, 0.03, 0.235], [x * 0.99, 0.015, 0.055], 0.012), { mat: FACE.sole, joint: J.foot[i] });
  }

  // ---- hips
  mb.with(null, () => {
    const f = (u: number, v: number): V3 => {
      const y = 0.84 + v * 0.26;
      const a = u * Math.PI * 2;
      const w = 0.158 + Math.sin(v * Math.PI) * 0.018, d = 0.118 + Math.sin(v * Math.PI) * 0.01;
      return [Math.sin(a) * w, y, Math.cos(a) * d - (Math.cos(a) < 0 ? 0.008 : 0)];
    };
    surfaceOut(mb, f, 24, 5, [0, 0.95, 0]);
    // crotch
    mb.at(0, 0.86, 0.005, () => mb.sphere(0.1, 14, 8, { squash: [1.35, 0.55, 1.05] }));
  }, { mat: legMat, joint: J.pelvis, soft: true });

  // ---- torso: waist, chest, shoulder blades, sloping shoulders up to the neck
  const torsoAt = (u: number, v: number): V3 => {
    const y = 1.02 + v * 0.45;
    const a = u * Math.PI * 2; // 0 = front
    const front = Math.cos(a) > 0 ? 1 : 0;
    const w = 0.152 + smooth(0.1, 0.62, v) * 0.042 - smooth(0.8, 1, v) * 0.13;
    const dp = 0.108 + Math.sin(v * Math.PI) * 0.02 - smooth(0.85, 1, v) * 0.055;
    // pectorals and shoulder blades shape the front and back
    const pec = front * Math.exp(-Math.pow((v - 0.6) / 0.15, 2)) * Math.pow(Math.max(0, Math.cos(a)), 2) * 0.012 * (1 + Math.cos(2 * a) * 0.5);
    const blade = (1 - front) * Math.exp(-Math.pow((v - 0.66) / 0.18, 2)) * Math.abs(Math.sin(2 * a)) * 0.01;
    const x = Math.sin(a) * w, z = Math.cos(a) * (dp + pec + blade);
    return [x, y, z + 0.004];
  };
  mb.with(null, () => surfaceOut(mb, torsoAt, 32, 14, [0, 1.25, 0]), { mat: st.tunic, joint: J.chest, soft: true });
  // neck
  mb.with(null, () => mb.tube([[0, 1.42, 0.0], [0, 1.49, 0.006], [0, 1.55, 0.01]], (t) => 0.05 - t * 0.004, 12, { capStart: false, capEnd: false }), { mat: skin, joint: J.neck, soft: true });
  if (st.collar) {
    // 交领: the left panel crosses over the right, trimmed
    mb.with(null, () => {
      const band = (pts: V3[]) => mb.tube(pts, 0.013, 5, { squash: [1.8, 0.6] });
      band([[0.055, 1.47, 0.045], [0.02, 1.38, 0.118], [-0.04, 1.26, 0.13], [-0.1, 1.14, 0.118]]);
      band([[-0.055, 1.47, 0.045], [-0.03, 1.4, 0.1], [0.0, 1.36, 0.118]]);
      mb.tube([[0.06, 1.46, 0.04], [0.07, 1.47, -0.02], [0, 1.47, -0.06], [-0.07, 1.47, -0.02], [-0.06, 1.46, 0.04]], 0.012, 5);
    }, { mat: st.collar, joint: J.chest });
  }
  if (st.sash) {
    mb.with(null, () => {
      mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.78]), () => mb.lathe([[0.166, 1.03], [0.172, 1.06], [0.172, 1.1], [0.164, 1.13]], 24));
      // knot and hanging tails at the front
      mb.at(0.03, 1.07, 0.132, () => mb.sphere(0.022, 8, 6, { squash: [1.2, 1, 0.7] }));
      mb.tube([[0.03, 1.06, 0.14], [0.04, 0.96, 0.15], [0.035, 0.86, 0.14]], 0.011, 4, { squash: [2, 0.5] });
      mb.tube([[0.02, 1.06, 0.14], [0.005, 0.97, 0.148], [0.01, 0.9, 0.14]], 0.01, 4, { squash: [2, 0.5] });
    }, { mat: st.sash, joint: J.chest });
  }

  // ---- arms: deltoid, upper arm and forearm in the sleeve, a cuff, and the hand
  for (const side of [1, -1] as const) {
    const i = side > 0 ? 0 : 1;
    const x0 = 0.21 * side, x1 = 0.25 * side, x2 = 0.27 * side;
    mb.with(null, () => {
      mb.at(x0 - side * 0.02, 1.4, 0, () => mb.sphere(0.056, 14, 10, { squash: [0.95, 0.82, 1.05] }));
      limb(mb, [[x0, 1.43, 0], [x0 + (x1 - x0) * 0.5, 1.3, 0.002], [x1, 1.15, 0]], (t) => 0.064 - t * 0.012 + Math.sin(t * Math.PI) * 0.004, 14, 0.03);
    }, { mat: sleeves, joint: J.arm[i], soft: true });
    mb.with(null, () => {
      limb(mb, [[x1, 1.15, 0], [x1 + (x2 - x1) * 0.5, 1.04, 0.012], [x2, 0.935, 0.02]], (t) => 0.052 - t * 0.012 + Math.sin(t * Math.PI * 0.7) * 0.004, 14, 0.04);
    }, { mat: sleeves, joint: J.fore[i], soft: true });
    mb.with(null, () => mb.tube([[x2, 0.95, 0.02], [x2, 0.925, 0.02]], 0.044, 12), { mat: st.collar ?? sleeves, joint: J.fore[i] });
    buildHand(mb, J.hand[i], side, [x2, 0.912, 0.02], (side > 0 ? st.handL : st.handR) ?? 'relaxed', skin);
  }

  // ---- head
  buildHead(mb, J.head, { ...st.face, skin });
  void len;
}
