// Texture baking: rasterise every painted triangle into the atlas, ask its painter for each
// texel, then derive a tangent-space normal map from the painted height (and any sculpt normal)
// in exactly the frame the renderer rebuilds from UV derivatives (mesh.frag: cotangentFrame).
//
// Output (two RGBA8 images, see docs/CHARACTERS.md):
//   albedo : sRGB colour, alpha = team-colour mask
//   surface: R roughness, G normal.y, B metalness, A normal.x   (normal in G/A like DXT5nm, so
//            lossy WebP keeps it at full resolution in luma and alpha)

import type { Tri } from '../kit/mesh';
import type { MaterialDef } from '../../../src/core/materialModel';
import { hexToLinear } from '../../../src/core/materialModel';
import type { V2, V3 } from '../../../src/core/math';
import { unwrap } from './unwrap';
import { pack } from './pack';
import { specOf, PaintIn, PaintOut } from './paint';

export interface BakeResult {
  size: number;
  albedo: Uint8Array;
  surface: Uint8Array;
  /** atlas UV per painted triangle (index into the mesh's tri list) */
  uv: Map<number, [V2, V2, V2]>;
  /** texels per metre at density 1 */
  density: number;
}

export function bakeAtlas(tris: Tri[], mats: MaterialDef[], S = 1024): BakeResult | null {
  const charts = unwrap(tris, mats);
  if (!charts.length) return null;
  const pk = pack(charts, S);

  // ---- per-triangle atlas coordinates (pixels) and chart ids
  const triIds: number[] = [];
  const triChart: number[] = [];
  const triPx: number[] = []; // 6 per entry
  const uvMap = new Map<number, [V2, V2, V2]>();
  charts.forEach((c, ci) => {
    const u = pk.uvs[ci];
    c.tris.forEach((ti, k) => {
      triIds.push(ti);
      triChart.push(ci);
      for (let v = 0; v < 6; v++) triPx.push(u[k * 6 + v] * S);
      uvMap.set(ti, [[u[k * 6], u[k * 6 + 1]], [u[k * 6 + 2], u[k * 6 + 3]], [u[k * 6 + 4], u[k * 6 + 5]]]);
    });
  });
  const NT = triIds.length;

  // ---- coverage: which triangle owns each texel, and where in it
  const N = S * S;
  const owner = new Int32Array(N).fill(-1);
  const bw = new Float32Array(N * 3);
  const gdist = new Float32Array(N).fill(Infinity);
  const raster = (e: number, gutter: number) => {
    const x0 = triPx[e * 6], y0 = triPx[e * 6 + 1], x1 = triPx[e * 6 + 2], y1 = triPx[e * 6 + 3], x2 = triPx[e * 6 + 4], y2 = triPx[e * 6 + 5];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - gutter)), maxX = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2) + gutter));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - gutter)), maxY = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2) + gutter));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      let w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      let w2 = 1 - w0 - w1;
      const o = y * S + x;
      if (gutter === 0) {
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        owner[o] = e;
        gdist[o] = 0;
      } else {
        if (gdist[o] === 0) continue;
        // distance outside the triangle (px), approximated through the barycentrics
        const d = Math.max(-Math.min(w0, w1, w2), 0) * Math.sqrt(Math.abs(area));
        if (d > gutter || d >= gdist[o]) continue;
        w0 = Math.max(w0, 0); w1 = Math.max(w1, 0); w2 = Math.max(w2, 0);
        const s = w0 + w1 + w2;
        w0 /= s; w1 /= s; w2 /= s;
        owner[o] = e;
        gdist[o] = d;
      }
      bw[o * 3] = w0; bw[o * 3 + 1] = w1; bw[o * 3 + 2] = w2;
    }
  };
  for (let e = 0; e < NT; e++) raster(e, 0);
  for (let e = 0; e < NT; e++) raster(e, 2.5);

  // ---- surface gradients of the atlas coordinates (∇u, ∇v per metre) per triangle — the
  // "cotangent frame" the renderer rebuilds from screen derivatives
  const TB = new Float64Array(NT * 6);
  for (let e = 0; e < NT; e++) {
    const t = tris[triIds[e]];
    const u0 = triPx[e * 6] / S, v0 = triPx[e * 6 + 1] / S, u1 = triPx[e * 6 + 2] / S, v1 = triPx[e * 6 + 3] / S, u2 = triPx[e * 6 + 4] / S, v2 = triPx[e * 6 + 5] / S;
    const e1: V3 = [t.p[1][0] - t.p[0][0], t.p[1][1] - t.p[0][1], t.p[1][2] - t.p[0][2]];
    const e2: V3 = [t.p[2][0] - t.p[0][0], t.p[2][1] - t.p[0][1], t.p[2][2] - t.p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const a2 = Math.hypot(cx, cy, cz) || 1e-20;
    const nx = cx / a2, ny = cy / a2, nz = cz / a2;
    // dual vectors: c1·e1 = 1, c1·e2 = 0 and c2·e1 = 0, c2·e2 = 1
    const c1: V3 = [(e2[1] * nz - e2[2] * ny) / a2, (e2[2] * nx - e2[0] * nz) / a2, (e2[0] * ny - e2[1] * nx) / a2];
    const c2: V3 = [(ny * e1[2] - nz * e1[1]) / a2, (nz * e1[0] - nx * e1[2]) / a2, (nx * e1[1] - ny * e1[0]) / a2];
    const du1 = u1 - u0, du2 = u2 - u0, dv1 = v1 - v0, dv2 = v2 - v0;
    for (let k = 0; k < 3; k++) {
      TB[e * 6 + k] = du1 * c1[k] + du2 * c2[k];
      TB[e * 6 + 3 + k] = dv1 * c1[k] + dv2 * c2[k];
    }
  }

  // ---- open edges per piece (for trims along hems and cuffs)
  const edgeCache = new Map<number, Float64Array>();
  const boundaryOf = (piece: number): Float64Array => {
    let b = edgeCache.get(piece);
    if (b) return b;
    const key = (p: V3) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`;
    const count = new Map<string, { n: number; a: V3; b: V3 }>();
    for (const t of tris) {
      if ((t.piece ?? 0) !== piece) continue;
      for (let k = 0; k < 3; k++) {
        const a = t.p[k], c = t.p[(k + 1) % 3];
        const ka = key(a), kc = key(c);
        const kk = ka < kc ? ka + '|' + kc : kc + '|' + ka;
        const hit = count.get(kk);
        if (hit) hit.n++;
        else count.set(kk, { n: 1, a, b: c });
      }
    }
    const segs: number[] = [];
    for (const v of count.values()) if (v.n === 1) segs.push(...v.a, ...v.b);
    b = new Float64Array(segs);
    edgeCache.set(piece, b);
    return b;
  };
  const edgeDist = (piece: number, p: V3) => {
    const s = boundaryOf(piece);
    let best = Infinity;
    for (let i = 0; i < s.length; i += 6) {
      const ax = s[i], ay = s[i + 1], az = s[i + 2];
      const bx = s[i + 3] - ax, by = s[i + 4] - ay, bz = s[i + 5] - az;
      const l2 = bx * bx + by * by + bz * bz || 1e-18;
      let h = ((p[0] - ax) * bx + (p[1] - ay) * by + (p[2] - az) * bz) / l2;
      h = h < 0 ? 0 : h > 1 ? 1 : h;
      const d = (p[0] - ax - bx * h) ** 2 + (p[1] - ay - by * h) ** 2 + (p[2] - az - bz * h) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  // ---- paint
  const albedo = new Float32Array(N * 3);
  const rough = new Float32Array(N), metal = new Float32Array(N), team = new Float32Array(N), height = new Float32Array(N);
  const nrmOver = new Float32Array(N * 3).fill(NaN);
  const vn = new Float32Array(N * 3);
  const texelM = new Float32Array(NT);
  for (let e = 0; e < NT; e++) {
    const k = specOf(mats[tris[triIds[e]].mat])!;
    void k;
    // |∇u| is uv units per metre; a texel is 1/S uv units
    texelM[e] = 1 / (S * Math.max(1e-9, Math.min(Math.hypot(TB[e * 6], TB[e * 6 + 1], TB[e * 6 + 2]), Math.hypot(TB[e * 6 + 3], TB[e * 6 + 4], TB[e * 6 + 5]))));
  }
  const out: PaintOut = { albedo: [0, 0, 0], rough: 0, metal: 0, team: 0, height: 0, ao: 1 };
  const nanWarned = new Set<string>();
  let curPiece = 0;
  let curP: V3 = [0, 0, 0];
  let edgeMemo = NaN;
  const inp = {
    p: curP, n: [0, 0, 1] as V3, pp: undefined as V2 | undefined, piece: 0, mat: mats[0], texel: 0,
    get edge() {
      if (edgeMemo !== edgeMemo) edgeMemo = edgeDist(curPiece, curP);
      return edgeMemo;
    },
  };
  for (let o = 0; o < N; o++) {
    const e = owner[o];
    if (e < 0) continue;
    const t = tris[triIds[e]];
    const w0 = bw[o * 3], w1 = bw[o * 3 + 1], w2 = bw[o * 3 + 2];
    curP = [
      t.p[0][0] * w0 + t.p[1][0] * w1 + t.p[2][0] * w2,
      t.p[0][1] * w0 + t.p[1][1] * w1 + t.p[2][1] * w2,
      t.p[0][2] * w0 + t.p[1][2] * w1 + t.p[2][2] * w2,
    ];
    let nx = t.n[0][0] * w0 + t.n[1][0] * w1 + t.n[2][0] * w2, ny = t.n[0][1] * w0 + t.n[1][1] * w1 + t.n[2][1] * w2, nz = t.n[0][2] * w0 + t.n[1][2] * w1 + t.n[2][2] * w2;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    vn[o * 3] = nx; vn[o * 3 + 1] = ny; vn[o * 3 + 2] = nz;
    const mat = mats[t.mat];
    curPiece = t.piece ?? 0;
    edgeMemo = NaN;
    inp.p = curP;
    inp.n = [nx, ny, nz];
    inp.pp = t.pp ? [t.pp[0][0] * w0 + t.pp[1][0] * w1 + t.pp[2][0] * w2, t.pp[0][1] * w0 + t.pp[1][1] * w1 + t.pp[2][1] * w2] : undefined;
    inp.piece = curPiece;
    inp.mat = mat;
    inp.texel = texelM[e];
    const base = hexToLinear(mat.color);
    out.albedo = [base[0], base[1], base[2]];
    out.rough = mat.roughness ?? 0.8;
    out.metal = mat.metallic ?? 0;
    out.team = mat.team ?? 0;
    out.height = 0;
    out.ao = 1;
    out.normal = undefined;
    specOf(mat)!.fn(inp as PaintIn, out);
    if (!(out.albedo[0] + out.albedo[1] + out.albedo[2] + out.ao + out.height + out.rough >= -1e9)) {
      if (!nanWarned.has(mat.name)) {
        nanWarned.add(mat.name);
        console.warn(`  ⚠ painter for ${mat.name} returned NaN at ${curP.map((v) => v.toFixed(4))}`);
      }
      out.albedo = [1, 0, 1];
      out.ao = 1;
      out.height = 0;
    }
    albedo[o * 3] = out.albedo[0] * out.ao;
    albedo[o * 3 + 1] = out.albedo[1] * out.ao;
    albedo[o * 3 + 2] = out.albedo[2] * out.ao;
    rough[o] = out.rough;
    metal[o] = out.metal;
    team[o] = out.team;
    height[o] = out.height;
    if (out.normal) {
      nrmOver[o * 3] = out.normal[0];
      nrmOver[o * 3 + 1] = out.normal[1];
      nrmOver[o * 3 + 2] = out.normal[2];
    }
  }

  // ---- normal map
  const nmx = new Float32Array(N), nmy = new Float32Array(N);
  const chartAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return -1;
    const e = owner[y * S + x];
    return e < 0 ? -1 : triChart[e];
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const o = y * S + x;
    const e = owner[o];
    if (e < 0) continue;
    const c = triChart[e];
    const slope = (dx: number, dy: number) => {
      const a = chartAt(x + dx, y + dy) === c, b = chartAt(x - dx, y - dy) === c;
      if (a && b) return (height[o + dy * S + dx] - height[o - dy * S - dx]) / 2;
      if (a) return height[o + dy * S + dx] - height[o];
      if (b) return height[o] - height[o - dy * S - dx];
      return 0;
    };
    const Gux = TB[e * 6], Guy = TB[e * 6 + 1], Guz = TB[e * 6 + 2], Gvx = TB[e * 6 + 3], Gvy = TB[e * 6 + 4], Gvz = TB[e * 6 + 5];
    // surface gradient of the height: ∇h = h_u ∇u + h_v ∇v (h_u per uv unit = per-texel slope × S)
    const hu = slope(1, 0) * S, hv = slope(0, 1) * S;
    const vx = vn[o * 3], vy = vn[o * 3 + 1], vz = vn[o * 3 + 2];
    let bx = vx, by = vy, bz = vz;
    if (nrmOver[o * 3] === nrmOver[o * 3]) {
      bx = nrmOver[o * 3]; by = nrmOver[o * 3 + 1]; bz = nrmOver[o * 3 + 2];
    }
    let gx = hu * Gux + hv * Gvx, gy = hu * Guy + hv * Gvy, gz = hu * Guz + hv * Gvz;
    const gd = gx * bx + gy * by + gz * bz;
    gx -= bx * gd; gy -= by * gd; gz -= bz * gd;
    let fx = bx - gx, fy = by - gy, fz = bz - gz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // the renderer's frame: ∇u, ∇v projected onto the vertex normal's plane, scaled by 1/max length
    const pu = Gux * vx + Guy * vy + Guz * vz, pv = Gvx * vx + Gvy * vy + Gvz * vz;
    const tx = Gux - vx * pu, ty = Guy - vy * pu, tz = Guz - vz * pu;
    const qx = Gvx - vx * pv, qy = Gvy - vy * pv, qz = Gvz - vz * pv;
    const m = Math.sqrt(Math.max(tx * tx + ty * ty + tz * tz, qx * qx + qy * qy + qz * qz)) || 1e-12;
    const a11 = tx / m, a21 = ty / m, a31 = tz / m, a12 = qx / m, a22 = qy / m, a32 = qz / m, a13 = vx, a23 = vy, a33 = vz;
    const det = a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
    let sx = 0, sy = 0, sz = 1;
    if (Math.abs(det) > 1e-9) {
      sx = (fx * (a22 * a33 - a23 * a32) - a12 * (fy * a33 - a23 * fz) + a13 * (fy * a32 - a22 * fz)) / det;
      sy = (a11 * (fy * a33 - a23 * fz) - fx * (a21 * a33 - a23 * a31) + a13 * (a21 * fz - fy * a31)) / det;
      sz = (a11 * (a22 * fz - fy * a32) - a12 * (a21 * fz - fy * a31) + fx * (a21 * a32 - a22 * a31)) / det;
    }
    if (sz < 0.05) sz = 0.05;
    const sl = Math.hypot(sx, sy, sz);
    nmx[o] = sx / sl;
    nmy[o] = sy / sl;
  }

  // ---- fill every empty texel from its nearest painted one (breadth-first from the charts), so
  // no filtering or mip level ever pulls in background
  const filled = new Uint8Array(N);
  const src = new Int32Array(N).fill(-1);
  let queue = new Int32Array(N);
  let qn = 0;
  for (let o = 0; o < N; o++) if (owner[o] >= 0) {
    filled[o] = 1;
    src[o] = o;
    queue[qn++] = o;
  }
  for (let head = 0; head < qn; head++) {
    const o = queue[head];
    const x = o % S, y = (o - x) / S;
    const visit = (q: number) => {
      if (src[q] >= 0) return;
      src[q] = src[o];
      queue[qn++] = q;
    };
    if (x > 0) visit(o - 1);
    if (x < S - 1) visit(o + 1);
    if (y > 0) visit(o - S);
    if (y < S - 1) visit(o + S);
  }
  queue = new Int32Array(0);
  const chans: Float32Array[] = [rough, metal, team, nmx, nmy];
  for (let o = 0; o < N; o++) {
    const q = src[o];
    if (q < 0 || q === o) continue;
    albedo[o * 3] = albedo[q * 3]; albedo[o * 3 + 1] = albedo[q * 3 + 1]; albedo[o * 3 + 2] = albedo[q * 3 + 2];
    for (const c of chans) c[o] = c[q];
    filled[o] = 1;
  }

  // ---- encode
  const srgb = (v: number) => {
    const c = v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(c * 255);
  };
  const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  const A = new Uint8Array(N * 4), SF = new Uint8Array(N * 4);
  for (let o = 0; o < N; o++) {
    A[o * 4] = srgb(albedo[o * 3]);
    A[o * 4 + 1] = srgb(albedo[o * 3 + 1]);
    A[o * 4 + 2] = srgb(albedo[o * 3 + 2]);
    A[o * 4 + 3] = u8(team[o]);
    SF[o * 4] = u8(filled[o] ? rough[o] : 0.8);
    SF[o * 4 + 1] = u8(filled[o] ? nmy[o] * 0.5 + 0.5 : 0.5);
    SF[o * 4 + 2] = u8(metal[o]);
    SF[o * 4 + 3] = u8(filled[o] ? nmx[o] * 0.5 + 0.5 : 0.5);
  }
  return { size: S, albedo: A, surface: SF, uv: uvMap, density: pk.density };
}
