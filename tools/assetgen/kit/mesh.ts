// MeshBuilder — a tiny procedural modelling kit.
// Everything is authored in metres, Y-up, +Z forward (glTF conventions), CCW front faces.
// Primitives emit UVs in metres so procedural shader patterns keep a consistent scale.

import {
  V2, V3, M4, m4, m4Mul, m4FromTRS, m4Invert, m4TransformPoint, m4TransformDir,
  add, sub, scale, cross, dot, normalize, len, quatEuler, DEG, lerp3,
} from '../../../src/core/math';
import type { MaterialDef } from '../../../src/core/materialModel';

export interface Tri {
  p: [V3, V3, V3];
  n: [V3, V3, V3];
  uv: [V2, V2, V2];
  mat: number;
  joint: number;
  sway: [number, number, number];
  tint: V3;
  /** deformable surface (skin, cloth): gets blended joint weights from the skinning pass */
  soft?: boolean;
  /** per-vertex joints/weights (set by kit/skin.ts); absent = rigidly bound to `joint` */
  skin?: [Skin, Skin, Skin];
  /** the primitive this triangle came from (one call to box/tube/surface/mesh/…) */
  piece?: number;
  /** the primitive's own parameters (0..1), e.g. around/along a tube — painters place trims with them */
  pp?: [V2, V2, V2];
  /** a natural unwrap of the primitive in metres (texture charts); absent = unwrap automatically */
  ct?: [V2, V2, V2];
}
/** Per-vertex extras a primitive can attach (see Tri.pp / Tri.ct). */
export interface VX {
  pp: V2[];
  ct: V2[];
}
export interface Skin {
  j: [number, number, number, number];
  w: [number, number, number, number];
}

export const T = (x: number, y: number, z: number, rotDeg: V3 = [0, 0, 0], s: V3 | number = 1): M4 =>
  m4FromTRS([x, y, z], quatEuler(rotDeg[0] * DEG, rotDeg[1] * DEG, rotDeg[2] * DEG), typeof s === 'number' ? [s, s, s] : s);

function normalMatrix(m: M4): M4 {
  // inverse-transpose of the upper 3x3, stored in a mat4
  const inv = m4Invert(m);
  const n = m4();
  n[0] = inv[0]; n[1] = inv[4]; n[2] = inv[8];
  n[4] = inv[1]; n[5] = inv[5]; n[6] = inv[9];
  n[8] = inv[2]; n[9] = inv[6]; n[10] = inv[10];
  return n;
}
function det3(m: M4) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}
function axisScale(m: M4): V3 {
  return [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
}

export interface CylOpts {
  r: number;
  rTop?: number;
  h: number;
  sides?: number;
  y0?: number;
  capTop?: boolean;
  capBottom?: boolean;
  smooth?: boolean;
  phase?: number;
}

export class MeshBuilder {
  tris: Tri[] = [];
  materials: MaterialDef[] = [];
  private matIndex = new Map<string, number>();
  private stack: { m: M4; nm: M4; flip: boolean; s: V3 }[] = [];
  private cur = { m: m4(), nm: m4(), flip: false, s: [1, 1, 1] as V3 };
  private curMat = -1;
  joint = 0;
  sway = 0;
  tint: V3 = [1, 1, 1];
  soft = false;
  /** current primitive id (see Tri.piece) */
  piece = 0;
  private pieces = 0;

  constructor(public name = 'mesh') {}

  // ---------------------------------------------------------------- state
  mat(def: MaterialDef | string): this {
    const name = typeof def === 'string' ? def : def.name;
    let idx = this.matIndex.get(name);
    if (idx === undefined) {
      if (typeof def === 'string') throw new Error(`Unknown material ${def}`);
      idx = this.materials.length;
      this.materials.push(def);
      this.matIndex.set(name, idx);
    }
    this.curMat = idx;
    return this;
  }
  get currentMaterial() {
    return this.materials[this.curMat];
  }

  push(m: M4) {
    this.stack.push(this.cur);
    const nm = m4Mul(this.cur.m, m);
    const s = axisScale(nm);
    this.cur = { m: nm, nm: normalMatrix(nm), flip: det3(nm) < 0, s };
  }
  pop() {
    this.cur = this.stack.pop()!;
  }
  /** Run `fn` with an extra local transform (and optionally a material / joint). */
  with(m: M4 | null, fn: () => void, opts: { mat?: MaterialDef | string; joint?: number; sway?: number; tint?: V3; soft?: boolean } = {}) {
    const saved = { mat: this.curMat, joint: this.joint, sway: this.sway, tint: this.tint, soft: this.soft };
    if (m) this.push(m);
    if (opts.mat) this.mat(opts.mat);
    if (opts.joint !== undefined) this.joint = opts.joint;
    if (opts.sway !== undefined) this.sway = opts.sway;
    if (opts.tint) this.tint = opts.tint;
    if (opts.soft !== undefined) this.soft = opts.soft;
    fn();
    if (m) this.pop();
    this.curMat = saved.mat;
    this.joint = saved.joint;
    this.sway = saved.sway;
    this.tint = saved.tint;
    this.soft = saved.soft;
  }
  at(x: number, y: number, z: number, fn: () => void, rotDeg: V3 = [0, 0, 0], s: V3 | number = 1) {
    this.with(T(x, y, z, rotDeg, s), fn);
  }
  /** Mirror across X (for symmetric pieces). Winding is fixed automatically. */
  mirrorX(fn: () => void) {
    fn();
    this.with(T(0, 0, 0, [0, 0, 0], [-1, 1, 1]), fn);
  }
  mirrorZ(fn: () => void) {
    fn();
    this.with(T(0, 0, 0, [0, 0, 0], [1, 1, -1]), fn);
  }
  get scaleFactors() {
    return this.cur.s;
  }

  /** Start a new primitive (texture chart / painter piece). */
  beginPiece() {
    return (this.piece = ++this.pieces);
  }

  // ---------------------------------------------------------------- raw emit
  /** Emit a triangle in local space. Normals are optional (flat if omitted). CCW = front. */
  tri(p0: V3, p1: V3, p2: V3, uv?: [V2, V2, V2], n?: [V3, V3, V3], sway?: [number, number, number], ex?: VX) {
    if (this.curMat < 0) throw new Error('No material set');
    const m = this.cur.m;
    let a = m4TransformPoint(m, p0), b = m4TransformPoint(m, p1), c = m4TransformPoint(m, p2);
    let ns: [V3, V3, V3];
    if (n) {
      ns = [normalize(m4TransformDir(this.cur.nm, n[0])), normalize(m4TransformDir(this.cur.nm, n[1])), normalize(m4TransformDir(this.cur.nm, n[2]))];
    } else {
      const fn = normalize(cross(sub(b, a), sub(c, a)));
      const f = this.cur.flip ? scale(fn, -1) : fn;
      ns = [f, f, f];
    }
    let uvs: [V2, V2, V2] = uv ?? autoUV(a, b, c, ns[0]);
    let sw: [number, number, number] = sway ?? [this.sway, this.sway, this.sway];
    let pp: [V2, V2, V2] | undefined, ct: [V2, V2, V2] | undefined;
    if (ex) {
      const k = (this.cur.s[0] + this.cur.s[1] + this.cur.s[2]) / 3;
      pp = [ex.pp[0], ex.pp[1], ex.pp[2]];
      ct = [[ex.ct[0][0] * k, ex.ct[0][1] * k], [ex.ct[1][0] * k, ex.ct[1][1] * k], [ex.ct[2][0] * k, ex.ct[2][1] * k]];
    }
    if (this.cur.flip) {
      [b, c] = [c, b];
      ns = [ns[0], ns[2], ns[1]];
      uvs = [uvs[0], uvs[2], uvs[1]];
      sw = [sw[0], sw[2], sw[1]];
      if (pp && ct) {
        pp = [pp[0], pp[2], pp[1]];
        // mirrored: flip the chart too so it keeps the same winding as the triangle
        ct = [[-ct[0][0], ct[0][1]], [-ct[2][0], ct[2][1]], [-ct[1][0], ct[1][1]]];
      }
    }
    // guard degenerate triangles
    if (len(cross(sub(b, a), sub(c, a))) < 1e-10) return;
    this.tris.push({ p: [a, b, c], n: ns, uv: uvs, mat: this.curMat, joint: this.joint, sway: sw, tint: this.tint, soft: this.soft || undefined, piece: this.piece || undefined, pp, ct });
  }
  quad(p0: V3, p1: V3, p2: V3, p3: V3, uv?: [V2, V2, V2, V2], n?: [V3, V3, V3, V3], ex?: VX) {
    const e = (i: number, j: number, k: number): VX | undefined => ex && { pp: [ex.pp[i], ex.pp[j], ex.pp[k]], ct: [ex.ct[i], ex.ct[j], ex.ct[k]] };
    this.tri(p0, p1, p2, uv && [uv[0], uv[1], uv[2]], n && [n[0], n[1], n[2]], undefined, e(0, 1, 2));
    this.tri(p0, p2, p3, uv && [uv[0], uv[2], uv[3]], n && [n[0], n[2], n[3]], undefined, e(0, 2, 3));
  }
  /** Triangle whose winding is chosen so the face points away from `inside`. */
  triOut(p0: V3, p1: V3, p2: V3, inside: V3, uv?: [V2, V2, V2]) {
    const nrm = cross(sub(p1, p0), sub(p2, p0));
    const c = scale(add(add(p0, p1), p2), 1 / 3);
    if (dot(nrm, sub(c, inside)) < 0) this.tri(p0, p2, p1, uv && [uv[0], uv[2], uv[1]]);
    else this.tri(p0, p1, p2, uv);
  }

  // ---------------------------------------------------------------- primitives
  /** Axis-aligned box, optionally bevelled. `c` is the centre. */
  box(size: V3, c: V3 = [0, 0, 0], bevel = 0) {
    this.beginPiece();
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const b = Math.min(bevel, hx * 0.49, hy * 0.49, hz * 0.49);
    const s = this.cur.s;
    const P = (x: number, y: number, z: number): V3 => [c[0] + x, c[1] + y, c[2] + z];
    const h = [hx, hy, hz];
    // main faces
    for (let a = 0; a < 3; a++) {
      for (const sg of [-1, 1]) {
        const u = (a + 1) % 3, v = (a + 2) % 3;
        const corner = (su: number, sv: number): V3 => {
          const p: number[] = [0, 0, 0];
          p[a] = sg * h[a];
          p[u] = su * (h[u] - b);
          p[v] = sv * (h[v] - b);
          return P(p[0], p[1], p[2]);
        };
        // subdivide large faces so baked AO can form smooth gradients
        const nu = Math.max(1, Math.min(8, Math.ceil(((h[u] - b) * 2 * s[u]) / 1.25)));
        const nv = Math.max(1, Math.min(8, Math.ceil(((h[v] - b) * 2 * s[v]) / 1.25)));
        const inside: V3 = [...c] as V3;
        for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++) {
          const u0 = -1 + (2 * iu) / nu, u1 = -1 + (2 * (iu + 1)) / nu;
          const v0 = -1 + (2 * iv) / nv, v1 = -1 + (2 * (iv + 1)) / nv;
          const q = [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)];
          const uvq = q.map((p) => boxUV(p, a, s, c)) as [V2, V2, V2, V2];
          this.triOut(q[0], q[1], q[2], inside, [uvq[0], uvq[1], uvq[2]]);
          this.triOut(q[0], q[2], q[3], inside, [uvq[0], uvq[2], uvq[3]]);
        }
      }
    }
    if (b <= 0) return;
    // edge chamfers
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3; // edge runs along axis a, lies between faces u and v
      for (const su of [-1, 1]) for (const sv of [-1, 1]) {
        const mk = (sa: number, onU: boolean): V3 => {
          const p: number[] = [0, 0, 0];
          p[a] = sa * (h[a] - b);
          p[u] = su * (onU ? h[u] : h[u] - b);
          p[v] = sv * (onU ? h[v] - b : h[v]);
          return P(p[0], p[1], p[2]);
        };
        const q = [mk(-1, true), mk(1, true), mk(1, false), mk(-1, false)];
        const inside: V3 = [...c] as V3;
        const ax = Math.abs(su) > 0 ? u : v;
        this.triOut(q[0], q[1], q[2], inside, q.slice(0, 3).map((p) => boxUV(p, ax, s, c)) as [V2, V2, V2]);
        this.triOut(q[0], q[2], q[3], inside, [q[0], q[2], q[3]].map((p) => boxUV(p, ax, s, c)) as [V2, V2, V2]);
      }
    }
    // corners
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const p0 = P(sx * hx, sy * (hy - b), sz * (hz - b));
      const p1 = P(sx * (hx - b), sy * hy, sz * (hz - b));
      const p2 = P(sx * (hx - b), sy * (hy - b), sz * hz);
      this.triOut(p0, p1, p2, [...c] as V3);
    }
  }
  /** Box given by min/max corners. */
  boxMM(min: V3, max: V3, bevel = 0) {
    this.box([max[0] - min[0], max[1] - min[1], max[2] - min[2]], [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], bevel);
  }

  /** Surface of revolution around +Y. profile = [radius, y][] from bottom to top. */
  lathe(profile: V2[], sides = 12, opts: { smooth?: boolean; capTop?: boolean; capBottom?: boolean; phase?: number; arc?: number } = {}) {
    const { smooth = true, capTop = false, capBottom = false, phase = 0, arc = Math.PI * 2 } = opts;
    this.beginPiece();
    const full = arc >= Math.PI * 2 - 1e-6;
    const ringCount = full ? sides : sides + 1;
    const ang = (i: number) => phase + (arc * i) / sides;
    // arc-length along profile for v coordinate
    const vlen: number[] = [0];
    for (let i = 1; i < profile.length; i++) vlen.push(vlen[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    // profile normals (2D) per vertex for smooth shading
    const pn: V2[] = profile.map((_, i) => {
      const a = profile[Math.max(0, i - 1)], b = profile[Math.min(profile.length - 1, i + 1)];
      const dr = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    const rMax = Math.max(...profile.map((p) => p[0]));
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
      for (let j = 0; j < sides; j++) {
        const a0 = ang(j), a1 = ang((j + 1) % ringCount === 0 && full ? 0 : j + 1);
        const p00: V3 = [Math.sin(a0) * r0, y0, Math.cos(a0) * r0];
        const p01: V3 = [Math.sin(a1) * r0, y0, Math.cos(a1) * r0];
        const p10: V3 = [Math.sin(a0) * r1, y1, Math.cos(a0) * r1];
        const p11: V3 = [Math.sin(a1) * r1, y1, Math.cos(a1) * r1];
        const u0 = (arc * j / sides) * rMax, u1 = (arc * (j + 1) / sides) * rMax;
        const uv: [V2, V2, V2, V2] = [[u0, vlen[i]], [u1, vlen[i]], [u1, vlen[i + 1]], [u0, vlen[i + 1]]];
        const tot = vlen[vlen.length - 1] || 1;
        const f0 = j / sides, f1 = (j + 1) / sides;
        const ex: VX = {
          pp: [[f0, vlen[i] / tot], [f1, vlen[i] / tot], [f1, vlen[i + 1] / tot], [f0, vlen[i + 1] / tot]],
          ct: [[(f0 - 0.5) * arc * r0, vlen[i]], [(f1 - 0.5) * arc * r0, vlen[i]], [(f1 - 0.5) * arc * r1, vlen[i + 1]], [(f0 - 0.5) * arc * r1, vlen[i + 1]]],
        };
        if (smooth) {
          const n = (a: number, k: number): V3 => [Math.sin(a) * pn[k][0], pn[k][1], Math.cos(a) * pn[k][0]];
          const amid0 = a0, amid1 = a1;
          this.quad(p00, p01, p11, p10, uv, [n(amid0, i), n(amid1, i), n(amid1, i + 1), n(amid0, i + 1)], ex);
        } else {
          this.quad(p00, p01, p11, p10, uv, undefined, ex);
        }
      }
    }
    const cap = (k: number, up: boolean) => {
      const [r, y] = profile[k];
      if (r < 1e-6) return;
      this.beginPiece();
      const c: V3 = [0, y, 0];
      for (let j = 0; j < sides; j++) {
        const a0 = ang(j), a1 = ang(j + 1);
        const p0: V3 = [Math.sin(a0) * r, y, Math.cos(a0) * r];
        const p1: V3 = [Math.sin(a1) * r, y, Math.cos(a1) * r];
        const uvf = (p: V3): V2 => [p[0], p[2]];
        if (up) this.tri(c, p0, p1, [uvf(c), uvf(p0), uvf(p1)]);
        else this.tri(c, p1, p0, [uvf(c), uvf(p1), uvf(p0)]);
      }
    };
    if (capBottom) cap(0, false);
    if (capTop) cap(profile.length - 1, true);
  }

  cylinder(o: CylOpts) {
    const { r, rTop = o.r, h, sides = 12, y0 = 0, capTop = true, capBottom = true, smooth = true, phase = 0 } = o;
    this.lathe([[r, y0], [rTop, y0 + h]], sides, { smooth, capTop, capBottom, phase });
  }

  cone(r: number, h: number, sides = 12, y0 = 0, smooth = true) {
    this.lathe([[r, y0], [0.0001, y0 + h]], sides, { smooth, capBottom: true });
  }

  /** UV-sphere. */
  sphere(r: number, seg = 12, rings = 8, opts: { smooth?: boolean; squash?: V3; jitter?: (p: V3) => number } = {}) {
    const { smooth = true, squash = [1, 1, 1], jitter } = opts;
    this.beginPiece();
    const sq = (squash[0] + squash[2]) / 2;
    const exq = (ii: number[], jj: number[]): VX => ({
      pp: ii.map((i, k) => [jj[k] / seg, i / rings] as V2),
      ct: ii.map((i, k) => [(jj[k] / seg - 0.5) * Math.PI * 2 * r * sq * Math.max(0.15, Math.sin((Math.PI * i) / rings)), (i / rings) * Math.PI * r * squash[1]] as V2),
    });
    const pt = (i: number, j: number): { p: V3; n: V3 } => {
      const th = (Math.PI * i) / rings, ph = (Math.PI * 2 * j) / seg;
      const n: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      const k = jitter ? 1 + jitter(n) : 1;
      return { p: [n[0] * r * squash[0] * k, n[1] * r * squash[1] * k, n[2] * r * squash[2] * k], n: normalize([n[0] / squash[0], n[1] / squash[1], n[2] / squash[2]]) };
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
      const uv = (ii: number, jj: number): V2 => [(jj / seg) * Math.PI * 2 * r, (1 - ii / rings) * Math.PI * r];
      const uvs: [V2, V2, V2, V2] = [uv(i, j), uv(i, j + 1), uv(i + 1, j + 1), uv(i + 1, j)];
      if (i === 0) this.tri(a.p, d.p, c.p, [uvs[0], uvs[3], uvs[2]], smooth && !jitter ? [a.n, d.n, c.n] : undefined, undefined, exq([i, i + 1, i + 1], [j + 0.5, j, j + 1]));
      else if (i === rings - 1) this.tri(a.p, d.p, b.p, [uvs[0], uvs[3], uvs[1]], smooth && !jitter ? [a.n, d.n, b.n] : undefined, undefined, exq([i, i + 1, i], [j, j + 0.5, j + 1]));
      else this.quad(a.p, d.p, c.p, b.p, [uvs[0], uvs[3], uvs[2], uvs[1]], smooth && !jitter ? [a.n, d.n, c.n, b.n] : undefined, exq([i, i + 1, i + 1, i], [j, j, j + 1, j + 1]));
    }
  }

  /** Icosphere blob with optional per-vertex displacement; smooth normals recomputed. */
  blob(r: number, detail = 1, opts: { squash?: V3; displace?: (dir: V3) => number; smooth?: boolean } = {}) {
    const { squash = [1, 1, 1], displace, smooth = true } = opts;
    this.beginPiece();
    const { verts, faces } = icosphere(detail);
    const pos = verts.map((v) => {
      const k = displace ? 1 + displace(v) : 1;
      return [v[0] * r * squash[0] * k, v[1] * r * squash[1] * k, v[2] * r * squash[2] * k] as V3;
    });
    const nrm: V3[] = verts.map(() => [0, 0, 0]);
    if (smooth) {
      for (const [a, b, c] of faces) {
        const fn = cross(sub(pos[b], pos[a]), sub(pos[c], pos[a]));
        for (const k of [a, b, c]) nrm[k] = add(nrm[k], fn);
      }
    }
    for (const [a, b, c] of faces) {
      const uv = (k: number): V2 => [Math.atan2(verts[k][0], verts[k][2]) * r, verts[k][1] * r];
      this.tri(pos[a], pos[b], pos[c], [uv(a), uv(b), uv(c)], smooth ? [normalize(nrm[a]), normalize(nrm[b]), normalize(nrm[c])] : undefined);
    }
  }

  /** Prism from a polygon in the XZ plane (as [x,z]), CCW when viewed from above (+Y). Caps use a fan (convex polygons). */
  extrude(poly: V2[], y0: number, y1: number, opts: { capTop?: boolean; capBottom?: boolean } = {}) {
    const { capTop = true, capBottom = true } = opts;
    this.beginPiece();
    // auto-orient: accept either winding
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area > 0) poly = [...poly].reverse();
    let u = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [[u, y0], [u + l, y0], [u + l, y1], [u, y1]]);
      u += l;
    }
    const c: V3 = [poly.reduce((s, p) => s + p[0], 0) / poly.length, 0, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (capTop) this.tri([c[0], y1, c[2]], [a[0], y1, a[1]], [b[0], y1, b[1]]);
      if (capBottom) this.tri([c[0], y0, c[2]], [b[0], y0, b[1]], [a[0], y0, a[1]]);
    }
  }

  /** Sweep a circle (or n-gon) along a polyline using parallel-transport frames. */
  tube(path: V3[], radius: number | ((t: number) => number), sides = 8, opts: { capStart?: boolean; capEnd?: boolean; smooth?: boolean; phase?: number; squash?: V2 } = {}) {
    const { capStart = true, capEnd = true, smooth = true, phase = 0, squash = [1, 1] } = opts;
    this.beginPiece();
    const n = path.length;
    const rad = (i: number) => (typeof radius === 'number' ? radius : radius(i / (n - 1)));
    const tangents: V3[] = path.map((_, i) => normalize(sub(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)])));
    let ref: V3 = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let nor = normalize(cross(cross(tangents[0], ref), tangents[0]));
    const frames: { n: V3; b: V3 }[] = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        // parallel transport
        const t0 = tangents[i - 1], t1 = tangents[i];
        const ax = cross(t0, t1);
        if (len(ax) > 1e-6) {
          const angle = Math.acos(Math.max(-1, Math.min(1, dot(t0, t1))));
          nor = rotateAround(nor, normalize(ax), angle);
        }
      }
      frames.push({ n: nor, b: normalize(cross(tangents[i], nor)) });
    }
    const along: number[] = [0];
    for (let i = 1; i < n; i++) along.push(along[i - 1] + len(sub(path[i], path[i - 1])));
    const ring = (i: number) => {
      const out: { p: V3; nn: V3 }[] = [];
      for (let j = 0; j <= sides; j++) {
        const a = phase + (Math.PI * 2 * j) / sides;
        const dir = add(scale(frames[i].n, Math.cos(a) * squash[0]), scale(frames[i].b, Math.sin(a) * squash[1]));
        out.push({ p: add(path[i], scale(dir, rad(i))), nn: normalize(add(scale(frames[i].n, Math.cos(a) / squash[0]), scale(frames[i].b, Math.sin(a) / squash[1]))) });
      }
      return out;
    };
    const rings = path.map((_, i) => ring(i));
    const circ = Math.PI * 2 * Math.max(rad(0), 0.01);
    const L = along[n - 1] || 1;
    const sq = (squash[0] + squash[1]) / 2;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
      const a = rings[i][j], b = rings[i][j + 1], c = rings[i + 1][j + 1], d = rings[i + 1][j];
      const uv: [V2, V2, V2, V2] = [[(j / sides) * circ, along[i]], [((j + 1) / sides) * circ, along[i]], [((j + 1) / sides) * circ, along[i + 1]], [(j / sides) * circ, along[i + 1]]];
      const f0 = j / sides, f1 = (j + 1) / sides, c0 = Math.PI * 2 * rad(i) * sq, c1 = Math.PI * 2 * rad(i + 1) * sq;
      const ex: VX = {
        pp: [[f0, along[i] / L], [f1, along[i] / L], [f1, along[i + 1] / L], [f0, along[i + 1] / L]],
        ct: [[(f0 - 0.5) * c0, along[i]], [(f1 - 0.5) * c0, along[i]], [(f1 - 0.5) * c1, along[i + 1]], [(f0 - 0.5) * c1, along[i + 1]]],
      };
      this.quad(a.p, b.p, c.p, d.p, uv, smooth ? [a.nn, b.nn, c.nn, d.nn] : undefined, ex);
    }
    const cap = (i: number, dirSign: number) => {
      const r = rings[i];
      if (rad(i) < 1e-5) return;
      this.beginPiece();
      for (let j = 0; j < sides; j++) {
        if (dirSign > 0) this.tri(path[i], r[j + 1].p, r[j].p);
        else this.tri(path[i], r[j].p, r[j + 1].p);
      }
    };
    if (capStart) cap(0, 1);
    if (capEnd) cap(n - 1, -1);
  }

  /** Grid surface from a parametric function (u,v in [0,1]). Normals are averaged (smooth). */
  surface(f: (u: number, v: number) => V3, nu: number, nv: number, opts: { uvScale?: V2; smooth?: boolean; flip?: boolean; sway?: (u: number, v: number) => number; uvFn?: (u: number, v: number) => V2 } = {}) {
    const { uvScale = [1, 1], smooth = true, flip = false, sway, uvFn } = opts;
    this.beginPiece();
    const P: V3[][] = [];
    for (let i = 0; i <= nu; i++) {
      P.push([]);
      for (let j = 0; j <= nv; j++) P[i].push(f(i / nu, j / nv));
    }
    // natural unwrap: arc length along u (each row centred) and along v
    const CU: number[][] = P.map(() => []), CV: number[][] = P.map(() => []);
    for (let j = 0; j <= nv; j++) {
      let acc = 0;
      CU[0][j] = 0;
      for (let i = 1; i <= nu; i++) CU[i][j] = acc += len(sub(P[i][j], P[i - 1][j]));
      for (let i = 0; i <= nu; i++) CU[i][j] -= acc / 2;
    }
    for (let i = 0; i <= nu; i++) {
      let acc = 0;
      CV[i][0] = 0;
      for (let j = 1; j <= nv; j++) CV[i][j] = acc += len(sub(P[i][j], P[i][j - 1]));
    }
    const N: V3[][] = P.map((row) => row.map(() => [0, 0, 0] as V3));
    if (smooth) {
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const fn = cross(sub(P[i + 1][j], P[i][j]), sub(P[i][j + 1], P[i][j]));
        const fn2 = cross(sub(P[i + 1][j + 1], P[i + 1][j]), sub(P[i][j + 1], P[i + 1][j]));
        for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1]]) N[a][b] = add(N[a][b], fn);
        for (const [a, b] of [[i + 1, j + 1], [i + 1, j], [i, j + 1]]) N[a][b] = add(N[a][b], fn2);
      }
    }
    const nn = (i: number, j: number): V3 => {
      const v = normalize(N[i][j]);
      return flip ? scale(v, -1) : v;
    };
    const uv = (i: number, j: number): V2 => (uvFn ? uvFn(i / nu, j / nv) : [(i / nu) * uvScale[0], (j / nv) * uvScale[1]]);
    const sw = (i: number, j: number) => (sway ? sway(i / nu, j / nv) : this.sway);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a: [number, number] = [i, j], b: [number, number] = [i + 1, j], c: [number, number] = [i + 1, j + 1], d: [number, number] = [i, j + 1];
      const order = flip ? [a, d, c, b] : [a, b, c, d];
      const [q0, q1, q2, q3] = order;
      const pts = [q0, q1, q2, q3].map(([x, y]) => P[x][y]);
      const uvs = [q0, q1, q2, q3].map(([x, y]) => uv(x, y));
      const ns = [q0, q1, q2, q3].map(([x, y]) => nn(x, y));
      const sws = [q0, q1, q2, q3].map(([x, y]) => sw(x, y));
      const pps = [q0, q1, q2, q3].map(([x, y]) => [x / nu, y / nv] as V2);
      // (a flipped surface mirrors its chart so the chart keeps the triangles' winding)
      const cts = [q0, q1, q2, q3].map(([x, y]) => [flip ? -CU[x][y] : CU[x][y], CV[x][y]] as V2);
      this.tri(pts[0], pts[1], pts[2], [uvs[0], uvs[1], uvs[2]], smooth ? [ns[0], ns[1], ns[2]] : undefined, [sws[0], sws[1], sws[2]], { pp: [pps[0], pps[1], pps[2]], ct: [cts[0], cts[1], cts[2]] });
      this.tri(pts[0], pts[2], pts[3], [uvs[0], uvs[2], uvs[3]], smooth ? [ns[0], ns[2], ns[3]] : undefined, [sws[0], sws[2], sws[3]], { pp: [pps[0], pps[2], pps[3]], ct: [cts[0], cts[2], cts[3]] });
    }
  }

  /** A thin double-sided panel (cloth/banner) in the XY plane hanging from its top edge. */
  banner(w: number, h: number, opts: { nu?: number; nv?: number; tails?: number; thickness?: number } = {}) {
    const { nu = 4, nv = 6, tails = 0, thickness = 0.01 } = opts;
    const f = (u: number, v: number): V3 => {
      let y = -v * h;
      if (tails > 0 && v > 0.999) {
        const k = (u * tails) % 1;
        y -= (0.5 - Math.abs(k - 0.5)) * h * 0.18;
      }
      return [u * w, y, 0];
    };
    const sway = (_u: number, v: number) => v * v;
    void thickness;
    // single sheet — cloth materials are double-sided, the exporter emits the back face
    this.surface(f, nu, nv, { uvFn: (u, v) => [u * w, v * h], sway, smooth: false, flip: true });
  }

  /**
   * Append an indexed triangle mesh (e.g. from the SDF mesher) in local space. Normals per vertex
   * are optional (flat if omitted); `uv` gives per-vertex texture coordinates.
   */
  mesh(pos: ArrayLike<number>, idx: ArrayLike<number>, nrm?: ArrayLike<number>, uv?: ArrayLike<number>) {
    const P = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    const N = (v: number): V3 => [nrm![v * 3], nrm![v * 3 + 1], nrm![v * 3 + 2]];
    const U = (v: number): V2 => [uv![v * 2], uv![v * 2 + 1]];
    this.beginPiece();
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      this.tri(P(a), P(b), P(c), uv ? [U(a), U(b), U(c)] : undefined, nrm ? [N(a), N(b), N(c)] : undefined);
    }
  }

  /** Merge another builder's triangles (already in its model space) under the current transform. */
  append(other: MeshBuilder) {
    const remap = other.materials.map((m) => {
      this.mat(m);
      return this.curMat;
    });
    const pieceMap = new Map<number, number>();
    const savedPiece = this.piece;
    for (const t of other.tris) {
      this.curMat = remap[t.mat];
      const saved = this.joint, savedSoft = this.soft;
      this.joint = t.joint;
      this.soft = !!t.soft;
      if (t.piece) {
        let pc = pieceMap.get(t.piece);
        if (pc === undefined) pieceMap.set(t.piece, (pc = this.beginPiece()));
        this.piece = pc;
      }
      this.tri(t.p[0], t.p[1], t.p[2], t.uv, t.n, t.sway, t.pp && t.ct ? { pp: t.pp, ct: t.ct } : undefined);
      this.joint = saved;
      this.soft = savedSoft;
    }
    this.piece = savedPiece;
  }

  bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const t of this.tris) for (const p of t.p) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
    return { min, max };
  }
}

// ---------------------------------------------------------------- helpers
function autoUV(a: V3, b: V3, c: V3, n: V3): [V2, V2, V2] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: V3): V2 => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], p[1]] : [p[0], p[1]]);
  return [f(a), f(b), f(c)];
}
function boxUV(p: V3, axis: number, s: V3, c: V3): V2 {
  // UV in metres; for side faces v runs up (Y), for top/bottom the longer horizontal axis.
  const q: V3 = [(p[0] - c[0]) * s[0], (p[1] - c[1]) * s[1], (p[2] - c[2]) * s[2]];
  if (axis === 0) return [q[2], q[1]];
  if (axis === 2) return [q[0], q[1]];
  return [q[0], q[2]];
}
function rotateAround(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

let icoCache = new Map<number, { verts: V3[]; faces: [number, number, number][] }>();
export function icosphere(detail: number) {
  const hit = icoCache.get(detail);
  if (hit) return hit;
  const t = (1 + Math.sqrt(5)) / 2;
  let verts: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => normalize(v as V3));
  let faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number) => {
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(k);
      if (i === undefined) {
        i = verts.length;
        verts.push(normalize(lerp3(verts[a], verts[b], 0.5)));
        mid.set(k, i);
      }
      return i;
    };
    const nf: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const res = { verts, faces };
  icoCache.set(detail, res);
  return res;
}
