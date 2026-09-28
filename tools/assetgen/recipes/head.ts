// Head v3 — one sculpted surface.
//
// The skull, face masses, nose, lips, eyelids and ears are signed distance fields blended into
// a single surface (sdf/sdf.ts), meshed at ~1.4 mm and reduced to a few thousand triangles
// (sdf/mesher.ts, sdf/simplify.ts). Nothing is stuck on: the nose grows out of the face with
// its bridge, tip and wings as one form; lids wrap the eyeballs; lips roll into the muzzle.
//
// Head-local frame: origin at the head centre (HC in model space), metres, +Y up, +Z forward,
// +X = the character's left. Landmarks (heroic scale, head ≈ 0.25 m chin to crown):
//   crown +0.128 · hairline +0.085 · brow +0.04 · eye line +0.013 · nose base −0.04 ·
//   mouth −0.066 · chin −0.122

import type { V3 } from '../../../src/core/math';
import {
  SDF, sphere, ellipsoid, capsule, roundCone, blend, carve, mirrorX, rotated, sweep, smin, smax, intersect, plane, normalAt, project, bounded, boundedX,
} from '../sdf/sdf';
import { surfaceNets } from '../sdf/mesher';
import { simplify } from '../sdf/simplify';
import { cachedArrays, srcOf } from '../kit/cache';

export interface FaceShape {
  /** overall face width */
  width: number;
  /** >1 broad square jaw and strong chin, <1 narrow and soft */
  jaw: number;
  /** nose size (length and projection) */
  nose: number;
  /** eye size */
  eyes: number;
  /** lip fullness */
  lips: number;
  /** brow-ridge strength */
  brow: number;
  /** cheekbone prominence */
  cheek: number;
  /** outer-corner lift of the eyes, degrees */
  tilt: number;
}
export const DEFAULT_SHAPE: FaceShape = { width: 1, jaw: 1, nose: 1, eyes: 1, lips: 1, brow: 1, cheek: 1, tilt: 5 };

export interface HeadSculpt {
  f: SDF;
  /** eyeball centres (head-local) and radius */
  eyes: { c: V3; R: number }[];
  /** landmarks painters use (head-local) */
  marks: Record<string, V3>;
  /** parts painters measure against */
  parts: { upperLip: SDF; lowerLip: SDF; nose: SDF };
  /** eyelid opening planes (normals in the +X eye's frame, through its centre) */
  lids: { up: V3; lo: V3; R: number; t: number };
  shape: FaceShape;
  age: number;
}

/** Build the head's distance field. `age` 0 young … 1 old. */
export function headSDF(shape: Partial<FaceShape> = {}, age = 0.2): HeadSculpt {
  const S: FaceShape = { ...DEFAULT_SHAPE, ...shape };
  const W = S.width, J = S.jaw, N = S.nose;

  // ---- big masses: cranium, face, forehead, cheeks, jaw, chin, neck
  const cranium = ellipsoid([0, 0.03, -0.018], [0.082 * W, 0.098, 0.1]);
  const face = ellipsoid([0, -0.02, 0.028], [0.071 * W, 0.09, 0.07]);
  const forehead = ellipsoid([0, 0.056, 0.046], [0.07 * W, 0.056, 0.058]);
  const occiput = ellipsoid([0, 0.0, -0.075], [0.07 * W, 0.075, 0.05]);
  const jawLine = mirrorX(roundCone([0.06 * W * (0.92 + 0.08 * J), -0.05, -0.02], [0.024 * W * J, -0.103, 0.068], 0.018 * (0.85 + 0.15 * J), 0.016));
  const chin = ellipsoid([0, -0.104, 0.08], [0.024 * W * J, 0.02, 0.02]);
  const cheeks = mirrorX(ellipsoid([0.042 * W, -0.03, 0.066], [0.03, 0.03, 0.028]));
  const cheekbones = mirrorX(ellipsoid([0.054 * W, -0.002, 0.058], [0.026 * W, 0.016, 0.024].map((v) => v * (0.85 + 0.15 * S.cheek)) as V3));
  const muzzle = ellipsoid([0, -0.058, 0.074], [0.034 * W, 0.029, 0.027]);
  const neck = capsule([0, -0.075, -0.03], [0, -0.21, -0.018], 0.05);

  let head: SDF = blend(0.03, cranium, face, forehead, occiput);
  head = blend(0.022, head, jawLine, chin, muzzle, cheeks);
  head = blend(0.016, head, cheekbones);
  head = blend(0.03, head, neck);

  // brow ridge and glabella
  const browK = 0.75 + 0.35 * S.brow;
  const browRidge = mirrorX(capsule([0.012, 0.036, 0.092], [0.046 * W, 0.039, 0.082], 0.0105 * browK));
  const glabella = sphere([0, 0.03, 0.092], 0.011);
  head = blend(0.016, head, browRidge, glabella);

  // eye sockets and temples (hollows)
  const R = 0.0128 * S.eyes;
  const E: V3 = [0.0345 * W, 0.013, 0.08];
  head = carve(head, boundedX(mirrorX(ellipsoid([E[0], E[1] + 0.001, E[2] + 0.013], [0.02, 0.0135, 0.015])), E, 0.03), 0.012 + age * 0.004);
  head = carve(head, mirrorX(sphere([0.09 * W, 0.045, 0.04], 0.016)), 0.022);
  // cheek hollow under the cheekbone (only with age)
  if (age > 0.3) head = carve(head, mirrorX(ellipsoid([0.052 * W, -0.05, 0.062], [0.016, 0.018, 0.01])), 0.02 + (age - 0.3) * 0.02);

  // ---- nose: bridge, tip and wings as one form, nostrils carved in
  const nasion: V3 = [0, 0.022, 0.093];
  const tipC: V3 = [0, -0.03, 0.093 + 0.025 * N];
  const bridge = roundCone(nasion, [0, -0.024, tipC[2] - 0.003], 0.0074 * N, 0.0098 * N);
  const tip = ellipsoid(tipC, [0.0118 * N, 0.0108 * N, 0.0104 * N]);
  const alae = mirrorX(ellipsoid([0.0132 * N, -0.0368, tipC[2] - 0.0145 * N], [0.0086 * N, 0.0074 * N, 0.0092 * N]));
  let nose: SDF = blend(0.0085 * N, bridge, tip, alae);
  nose = carve(nose, mirrorX(rotated(ellipsoid([0.0066 * N, -0.0418, tipC[2] - 0.009 * N], [0.0041 * N, 0.0025 * N, 0.0056 * N]), [0, 20, 0], [0.0066 * N, -0.0418, tipC[2] - 0.009 * N])), 0.0022);
  head = blend(0.0105, head, bounded(nose, [0, -0.012, tipC[2] - 0.012], 0.042));
  // a soft crease from the nose wing towards the mouth corner
  if (age > 0.25) head = carve(head, boundedX(mirrorX(capsule([0.0215 * N, -0.035, 0.094], [0.032, -0.068, 0.088], (age - 0.25) * 0.004)), [0.027, -0.052, 0.092], 0.024), 0.008 + age * 0.004);

  // ---- mouth: lips rolled into the muzzle, a parting line, philtrum, chin groove
  const L = S.lips;
  const arch = (x: number, z0: number) => z0 - 17 * x * x;
  const upper: V3[] = [];
  const lower: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, x = (t - 0.5) * 0.05;
    // cupid's bow: the centre dips, the two peaks either side of it
    const bow = -0.0011 * Math.exp(-Math.pow(x / 0.004, 2)) + 0.0005 * Math.exp(-Math.pow((Math.abs(x) - 0.0065) / 0.004, 2));
    upper.push([x, -0.0612 + bow - Math.pow(Math.abs(x) / 0.025, 2) * 0.0035, arch(x, 0.1015 + 0.002 * L)]);
    lower.push([x * 0.9, -0.0712 + Math.pow(Math.abs(x) / 0.025, 2) * 0.0038, arch(x * 0.9, 0.0992 + 0.0022 * L)]);
  }
  const upperLip = sweep(upper, (t) => (0.0019 + Math.sin(t * Math.PI) * 0.0034) * L);
  const lowerLip = sweep(lower, (t) => (0.0019 + Math.pow(Math.sin(t * Math.PI), 0.8) * 0.0049) * L);
  const MC: V3 = [0, -0.066, 0.1];
  head = blend(0.0045, head, bounded(upperLip, MC, 0.034), bounded(lowerLip, MC, 0.034));
  head = carve(head, bounded(ellipsoid([0, -0.0664, 0.1055], [0.021, 0.0009, 0.0085]), MC, 0.03), 0.0016);
  head = blend(0.005, head, bounded(mirrorX(capsule([0.0042, -0.047, 0.104], [0.0055, -0.0585, 0.1035], 0.0011)), [0, -0.052, 0.105], 0.012));
  head = carve(head, bounded(capsule([-0.014, -0.081, 0.1], [0.014, -0.081, 0.1], 0.0028), [0, -0.081, 0.1], 0.02), 0.009);

  // ---- eyelids: a shell around each eyeball, opened by an almond-shaped wedge
  const lidT = 0.0013;
  const lidShell = boundedX(mirrorX(sphere(E, R + lidT)), E, R + lidT);
  head = blend(0.005, head, lidShell);
  const tilt = (S.tilt * Math.PI) / 180;
  const up = -21 * (Math.PI / 180), lo = -22 * (Math.PI / 180);
  // plane normals in the eye's frame, tilted about Z so the outer corner lifts
  const rotZ = (v: V3): V3 => [v[0] * Math.cos(tilt) - v[1] * Math.sin(tilt), v[0] * Math.sin(tilt) + v[1] * Math.cos(tilt), v[2]];
  const nUp = rotZ([0, Math.cos(up), Math.sin(up)]);
  const nLo = rotZ([0, -Math.cos(lo), Math.sin(lo)]);
  const opening: SDF = (x, y, z) => {
    const px = Math.abs(x) - E[0], py = y - E[1], pz = z - E[2];
    const a = px * nUp[0] + py * nUp[1] + pz * nUp[2];
    const b = px * nLo[0] + py * nLo[1] + pz * nLo[2];
    const ball = Math.hypot(px, py, pz) - (R + 0.006);
    const front = -(pz + 0.003);
    return Math.max(a, b, ball, front);
  };
  head = carve(head, boundedX(opening, E, R + 0.007), 0.001);

  // ---- ears: a cupped shell with a rim and a lobe, flared back
  const earC: V3 = [0.081 * W, 0.002, -0.012];
  let ear: SDF = carve(ellipsoid(earC, [0.011, 0.03, 0.019]), ellipsoid([earC[0] + 0.0105, earC[1] - 0.001, earC[2] + 0.002], [0.0065, 0.02, 0.012]), 0.003);
  ear = blend(0.004, ear, ellipsoid([earC[0] + 0.001, earC[1] - 0.026, earC[2] + 0.004], [0.0065, 0.0082, 0.0068]));
  ear = rotated(ear, [0, -9, 0], earC);
  head = blend(0.011, head, boundedX(mirrorX(ear), earC, 0.036));

  // cut the neck off below (the body's neck takes over)
  head = intersect(head, plane([0, -0.2, 0], [0, -1, 0]));

  return {
    f: head,
    eyes: [{ c: E, R }, { c: [-E[0], E[1], E[2]], R }],
    marks: { E, nasion, tip: tipC, mouth: [0, -0.0664, 0.106], chin: [0, -0.107, 0.1], ear: earC },
    parts: { upperLip, lowerLip, nose },
    lids: { up: nUp, lo: nLo, R, t: lidT },
    shape: S,
    age,
  };
}

export interface MeshedPart {
  pos: Float64Array;
  nrm: Float32Array;
  idx: Uint32Array;
  [k: string]: Float64Array | Float32Array | Uint32Array;
}

export const HEAD_SRC = srcOf(import.meta.url);

/** Where a head's triangles should go: eyes and lids most, then lips, nose and ears. */
export function headWeight(hs: HeadSculpt) {
  const E = hs.eyes[0].c;
  return (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const eye = Math.exp(-((ax - E[0]) ** 2 + (y - E[1]) ** 2 + (z - E[2]) ** 2) / (0.016 * 0.016));
    const mouth = Math.exp(-(x * x * 0.5 + (y + 0.066) ** 2 + (z - 0.1) ** 2) / (0.018 * 0.018));
    const nose = Math.exp(-(x * x + (y + 0.03) ** 2 + (z - 0.11) ** 2) / (0.02 * 0.02));
    const front = z > 0.02 ? 1 : 0.5;
    return front * (1 + eye * 40 + mouth * 12 + nose * 8);
  };
}

const SDF_DEPS = ['../sdf/sdf.ts', '../sdf/mesher.ts', '../sdf/simplify.ts'].map((p) => srcOf(new URL(p, import.meta.url).href));

/**
 * Mesh a distance field inside a box and reduce it; normals come from the field. With `cache`,
 * the result is stored on disk under that key + the contents of `cache.deps` (source files).
 */
export function meshSDF(f: SDF, min: V3, max: V3, cell: number, targetTris: number, cache?: { key: string; deps: string[] }, weight?: (x: number, y: number, z: number) => number): MeshedPart {
  if (cache) {
    return cachedArrays(`meshSDF|${cache.key}|${min}|${max}|${cell}|${targetTris}|${!!weight}`, [...SDF_DEPS, ...cache.deps], () => ({ ...meshSDF(f, min, max, cell, targetTris, undefined, weight) }));
  }
  const hi = surfaceNets(f, min, max, cell);
  const lo = simplify(hi, targetTris, { weight });
  const nv = lo.pos.length / 3;
  const pos = new Float64Array(nv * 3), nrm = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const p = project(f, [lo.pos[v * 3], lo.pos[v * 3 + 1], lo.pos[v * 3 + 2]], 3, cell);
    pos.set(p, v * 3);
    nrm.set(normalAt(f, p[0], p[1], p[2], cell * 0.35), v * 3);
  }
  return { pos, nrm, idx: lo.idx };
}

export { smin, smax };
