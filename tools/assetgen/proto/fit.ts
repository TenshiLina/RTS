// Prototype: fit the MakeHuman CC0 base mesh to the concept sheet's silhouettes.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { rasterize } from '../../../../../../home/user/RTS/tools/assetgen/sdf/raster';
import { loadRef, refMask } from '../../../../../../home/user/RTS/tools/assetgen/ref/refSheet';
type V3 = [number, number, number];
const D = '/tmp/claude-0/-home-user-RTS/7cbdeb0b-2b06-59a2-89cd-7961a0df60b5/scratchpad/mh/';

// ---- base mesh
const obj = readFileSync(D + 'base.obj', 'utf8').split('\n');
const V0: number[] = [];
const faces: number[][] = [];
const groups = new Map<string, Set<number>>();
let group = '';
for (const l of obj) {
  if (l.startsWith('v ')) {
    const p = l.split(/\s+/);
    V0.push(+p[1], +p[2], +p[3]);
  } else if (l.startsWith('g ')) group = l.slice(2).trim();
  else if (l.startsWith('f ')) {
    const f = l.slice(2).trim().split(/\s+/).map((t) => parseInt(t.split('/')[0]) - 1);
    if (group === 'body') faces.push(f);
    if (!groups.has(group)) groups.set(group, new Set());
    for (const i of f) groups.get(group)!.add(i);
  }
}
const NV = V0.length / 3;
const readTarget = (file: string) => {
  const out: [number, number, number, number][] = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const p = l.trim().split(/\s+/);
    if (p.length >= 4) out.push([+p[0], +p[1], +p[2], +p[3]]);
  }
  return out;
};
// fixed macro targets
const macro: [string, number][] = [['macrodetails_asian-female-young.target', 1], ['macrodetails_proportions_female-young-averagemuscle-averageweight-idealproportions.target', 1]];
const base = Float64Array.from(V0);
for (const [f, w] of macro) for (const [i, x, y, z] of readTarget(D + f)) { base[i * 3] += w * x; base[i * 3 + 1] += w * y; base[i * 3 + 2] += w * z; }

// ---- modifiers: name → [decr target, incr target] (paired l/r applied together)
const T = (n: string) => (existsSync(D + 't/' + n + '.target') ? readTarget(D + 't/' + n + '.target') : null);
const pair = (a: string, b: string) => [T(a), T(b)] as const;
const MODS: Record<string, (readonly [ReturnType<typeof T>, ReturnType<typeof T>])[]> = {};
const add = (name: string, ...pairs: [string, string][]) => (MODS[name] = pairs.map(([a, b]) => pair(a, b)));
add('torso-horiz', ['torso_torso-scale-horiz-decr', 'torso_torso-scale-horiz-incr']);
add('torso-depth', ['torso_torso-scale-depth-decr', 'torso_torso-scale-depth-incr']);
add('torso-vshape', ['torso_torso-vshape-decr', 'torso_torso-vshape-incr']);
add('hip-horiz', ['hip_hip-scale-horiz-decr', 'hip_hip-scale-horiz-incr']);
add('hip-depth', ['hip_hip-scale-depth-decr', 'hip_hip-scale-depth-incr']);
add('hip-waist', ['hip_hip-waist-down', 'hip_hip-waist-up']);
add('buttocks', ['buttocks_buttocks-volume-decr', 'buttocks_buttocks-volume-incr']);
add('breast-size', ['breast_female-young-averagemuscle-averageweight-mincup-averagefirmness', 'breast_female-young-averagemuscle-averageweight-maxcup-averagefirmness']);
add('breast-trans', ['breast_breast-trans-down', 'breast_breast-trans-up']);
add('breast-dist', ['breast_breast-dist-decr', 'breast_breast-dist-incr']);
add('neck-horiz', ['neck_neck-scale-horiz-decr', 'neck_neck-scale-horiz-incr']);
add('neck-depth', ['neck_neck-scale-depth-decr', 'neck_neck-scale-depth-incr']);
add('head-horiz', ['head_head-scale-horiz-decr', 'head_head-scale-horiz-incr']);
add('head-vert', ['head_head-scale-vert-decr', 'head_head-scale-vert-incr']);
add('head-depth', ['head_head-scale-depth-decr', 'head_head-scale-depth-incr']);
for (const [nm, part] of [['upperarm-horiz', 'upperarm-scale-horiz'], ['lowerarm-horiz', 'lowerarm-scale-horiz'], ['upperleg-horiz', 'upperleg-scale-horiz'], ['upperleg-depth', 'upperleg-scale-depth'], ['lowerleg-horiz', 'lowerleg-scale-horiz'], ['lowerleg-depth', 'lowerleg-scale-depth'], ['upperleg-vert', 'upperleg-scale-vert'], ['lowerleg-vert', 'lowerleg-scale-vert'], ['upperarm-vert', 'upperarm-scale-vert']])
  add(nm, [`armslegs_l-${part}-decr`, `armslegs_l-${part}-incr`], [`armslegs_r-${part}-decr`, `armslegs_r-${part}-incr`]);

// ---- skeleton: shoulder pivots and arm-chain weights
const W = JSON.parse(readFileSync(D + 'default_weights.mhw', 'utf8')).weights as Record<string, [number, number][]>;
const armW = { L: new Float64Array(NV), R: new Float64Array(NV) };
const foreW = { L: new Float64Array(NV), R: new Float64Array(NV) };
for (const [bone, list] of Object.entries(W)) {
  const m = bone.match(/^(upperarm|lowerarm|wrist|finger|metacarpal|thumb)[^.]*\.(L|R)$/);
  if (!m) continue;
  const side = m[2] as 'L' | 'R';
  for (const [i, w] of list) {
    armW[side][i] += w;
    if (m[1] !== 'upperarm') foreW[side][i] += w;
  }
}
const legW = { L: new Float64Array(NV), R: new Float64Array(NV) };
for (const [bone, list] of Object.entries(W)) {
  const m = bone.match(/^(upperleg|lowerleg|foot|toe)[^.]*\.(L|R)$/);
  if (!m) continue;
  for (const [i, w] of list) legW[m[2] as 'L' | 'R'][i] += w;
}
const centroid = (g: string, P: Float64Array): V3 => {
  const s = groups.get(g)!;
  let x = 0, y = 0, z = 0;
  for (const i of s) { x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2]; }
  return [x / s.size, y / s.size, z / s.size];
};

// ---- build a posed, scaled mesh from parameters
export function build(p: Record<string, number>) {
  const P = Float64Array.from(base);
  for (const [name, pairs] of Object.entries(MODS)) {
    const v = p[name] ?? 0;
    if (!v) continue;
    for (const [dec, inc] of pairs) {
      const t = v < 0 ? dec : inc;
      if (!t) continue;
      const w = Math.abs(v);
      for (const [i, x, y, z] of t) { P[i * 3] += w * x; P[i * 3 + 1] += w * y; P[i * 3 + 2] += w * z; }
    }
  }
  // arms: rotate in the frontal plane about the shoulder joint, forearms about the elbow
  for (const side of ['L', 'R'] as const) {
    const sh = centroid(side === 'L' ? 'joint-l-shoulder' : 'joint-r-shoulder', P);
    const el = centroid(side === 'L' ? 'joint-l-elbow' : 'joint-r-elbow', P);
    const sgn = sh[0] > 0 ? 1 : -1;
    const a = ((p.armDown ?? 0) * Math.PI) / 180 * -sgn; // positive armDown lowers the arm
    const ca = Math.cos(a), sa = Math.sin(a);
    const b = ((p.elbow ?? 0) * Math.PI) / 180; // forearm bends forward (about x)
    const cb = Math.cos(b), sb = Math.sin(b);
    // elbow after the shoulder rotation
    const ex = sh[0] + (el[0] - sh[0]) * ca - (el[1] - sh[1]) * sa, ey = sh[1] + (el[0] - sh[0]) * sa + (el[1] - sh[1]) * ca;
    const g = ((p.armBack ?? 0) * Math.PI) / 180; // swing the arm back (about x through the shoulder)
    const cg = Math.cos(g), sg = Math.sin(g);
    for (let i = 0; i < NV; i++) {
      const w = Math.min(1, armW[side][i]);
      if (w <= 0) continue;
      let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const rx = sh[0] + (x - sh[0]) * ca - (y - sh[1]) * sa, ry0 = sh[1] + (x - sh[0]) * sa + (y - sh[1]) * ca;
      const ry = sh[1] + (ry0 - sh[1]) * cg + (z - sh[2]) * sg, rz = sh[2] - (ry0 - sh[1]) * sg + (z - sh[2]) * cg;
      let nx = rx, ny = ry, nz = rz;
      const wf = Math.min(1, foreW[side][i]);
      if (wf > 0 && b) {
        const dy = ny - ey, dz = nz - el[2];
        const by = ey + dy * cb - dz * sb, bz = el[2] + dy * sb + dz * cb;
        ny = ny + (by - ny) * wf;
        nz = nz + (bz - nz) * wf;
      }
      P[i * 3] = x + (nx - x) * w;
      P[i * 3 + 1] = y + (ny - y) * w;
      P[i * 3 + 2] = z + (nz - z) * w;
    }
  }
  // legs: rotate in the frontal plane about the hip joint (positive legIn brings the feet together)
  for (const side of ['L', 'R'] as const) {
    const hp = centroid(side === 'L' ? 'joint-l-upper-leg' : 'joint-r-upper-leg', P);
    const sgn = hp[0] > 0 ? 1 : -1;
    const a = ((p.legIn ?? 0) * Math.PI) / 180 * sgn;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < NV; i++) {
      const w = Math.min(1, legW[side][i]);
      if (w <= 0) continue;
      const x = P[i * 3], y = P[i * 3 + 1];
      const rx = hp[0] + (x - hp[0]) * ca - (y - hp[1]) * sa, ry = hp[1] + (x - hp[0]) * sa + (y - hp[1]) * ca;
      P[i * 3] = x + (rx - x) * w;
      P[i * 3 + 1] = y + (ry - y) * w;
    }
  }
  // scale to 1.68 m soles-to-crown, feet on y = 0
  let ymin = Infinity, ymax = -Infinity;
  for (const f of faces) for (const i of f) { ymin = Math.min(ymin, P[i * 3 + 1]); ymax = Math.max(ymax, P[i * 3 + 1]); }
  const s = 1.68 / (ymax - ymin);
  const pos = new Float64Array(NV * 3);
  for (let i = 0; i < NV; i++) { pos[i * 3] = P[i * 3] * s; pos[i * 3 + 1] = (P[i * 3 + 1] - ymin) * s; pos[i * 3 + 2] = P[i * 3 + 2] * s; }
  // centre as the sheet does: the profile's centre is the pelvis's depth midpoint at 0.9 m
  let zlo = Infinity, zhi = -Infinity;
  for (const f of faces) for (const i of f) if (Math.abs(pos[i * 3 + 1] - 0.9) < 0.005 && Math.abs(pos[i * 3]) < 0.16) { zlo = Math.min(zlo, pos[i * 3 + 2]); zhi = Math.max(zhi, pos[i * 3 + 2]); }
  const zc = (zlo + zhi) / 2;
  for (let i = 0; i < NV; i++) pos[i * 3 + 2] -= zc;
  return pos;
}
const idx: number[] = [];
for (const f of faces) for (let k = 1; k < f.length - 1; k++) idx.push(f[0], f[k + 1], f[k]);
export const IDX = Uint32Array.from(idx);

// ---- views and scoring
const ref = loadRef('human-female');
export const VIEWS = [
  { name: 'front' as const, yaw: 0, x0: 0, x1: 368, dx: 0 },
  { name: 'side' as const, yaw: 90, x0: 383, x1: 541, dx: 0 },
  { name: 'back' as const, yaw: 180, x0: 558, x1: 900, dx: 0 },
  { name: 'q34' as const, yaw: 36, x0: 900, x1: 1190, dx: 18 },
];
const HH = 1000, sc = ref.scale;
export const shotFor = (v: (typeof VIEWS)[number], hScale = 1) => {
  const rv = ref.views[v.name];
  const w = v.x1 - v.x0;
  const yaw = (v.yaw * Math.PI) / 180;
  const right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const offR = (w / 2 - (rv.cx + v.dx - v.x0)) * sc;
  return { yaw: v.yaw, pitch: 0, dist: (HH / 2) * sc, target: [right[0] * offR, (rv.sole - HH / 2) * sc, right[2] * offR] as V3, fov: 0, w: Math.round(w * hScale), h: Math.round(HH * hScale) };
};
// (rows above the neck are ignored: the sheet's head is hair, not skull)
const NECK_ROW = (v: (typeof VIEWS)[number]) => Math.round(ref.views[v.name].sole - 1.45 / sc);
const masks = VIEWS.map((v) => {
  const m = refMask(ref.views[v.name], sc, v.x0, v.x1 - v.x0, HH);
  for (let r = ref.views[v.name].sole + 2; r < HH; r++) for (let c = 0; c < v.x1 - v.x0; c++) m[r * (v.x1 - v.x0) + c] = 0;
  for (let r = 0; r < NECK_ROW(v); r++) for (let c = 0; c < v.x1 - v.x0; c++) m[r * (v.x1 - v.x0) + c] = 0;
  return m;
});
export function score(pos: Float64Array, which = [0, 1, 2]) {
  const mesh = { pos, idx: IDX };
  let tot = 0;
  const per: number[] = [];
  for (const k of which) {
    const { mask } = rasterize([{ mesh }], shotFor(VIEWS[k]));
    for (let q = 0; q < NECK_ROW(VIEWS[k]) * (VIEWS[k].x1 - VIEWS[k].x0); q++) mask[q] = 0;
    const rm = masks[k];
    let i = 0, u = 0;
    for (let q = 0; q < mask.length; q++) {
      const a = mask[q] > 0, b = rm[q] > 0;
      if (a && b) i++;
      if (a || b) u++;
    }
    per.push(i / u);
    tot += i / u;
  }
  return { tot: tot / which.length, per };
}

if (process.argv[2] === 'fit') {
  const p: Record<string, number> = { armDown: 25, armBack: 0, elbow: 0, legIn: 0 };
  const EXCLUDE = new Set(['breast-size', 'breast-trans', 'breast-dist', 'head-horiz', 'head-vert', 'head-depth']);
  const names = ['legIn', 'armDown', 'armBack', 'elbow', ...Object.keys(MODS).filter((n) => !EXCLUDE.has(n))];
  let best = score(build(p)).tot;
  console.log('start', best.toFixed(4));
  const t0 = Date.now();
  for (const step of [0.4, 0.2, 0.1]) {
    for (const n of names) {
      const pose = n === 'armDown' || n === 'armBack' || n === 'elbow' || n === 'legIn';
      const st = pose ? step * (n === 'legIn' ? 8 : 20) : step;
      for (const dir of [1, -1]) {
        let improved = true;
        while (improved) {
          improved = false;
          const q = { ...p, [n]: (p[n] ?? 0) + dir * st };
          if (!pose && Math.abs(q[n]) > 0.6) break;
          const sc2 = score(build(q)).tot;
          if (sc2 > best + 1e-4) { best = sc2; Object.assign(p, q); improved = true; }
        }
      }
    }
    console.log('step', step, best.toFixed(4), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  console.log(JSON.stringify(p));
  console.log('per view', score(build(p), [0, 1, 2, 3]).per.map((v) => v.toFixed(3)).join(' '));
  writeFileSync(D + (process.env.FIT_OUT ?? 'fit.json'), JSON.stringify(p));
}

/** eye line (mean of the eye joints) and chin (lowest front-midline head vertex) of a built mesh */
export function headMarks(pos: Float64Array) {
  const eyes = [...groups.get('joint-l-eye')!, ...groups.get('joint-r-eye')!];
  let ey = 0, ez = 0;
  for (const i of eyes) { ey += pos[i * 3 + 1]; ez += pos[i * 3 + 2]; }
  ey /= eyes.length; ez /= eyes.length;
  let chin = Infinity;
  for (const f of faces) for (const i of f) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (Math.abs(x) < 0.004 && y > ey - 0.16 && y < ey - 0.05 && z > ez) chin = Math.min(chin, y);
  }
  // the chin is the lowest point of the face's front midline above the throat: take the front-most
  // midline vertex in each 2 mm band and find where the profile turns back under the jaw
  return { eyeY: ey, eyeZ: ez, chinY: chin };
}
