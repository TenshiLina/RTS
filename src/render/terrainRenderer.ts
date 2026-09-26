// GPU resources for terrain + water, built from world/terrain.ts data.

import type { Device, Buffer, Texture } from './rhi/types';
import type { TerrainData } from '../world/terrain';
import { hexToLinear } from '../core/materialModel';
import { fbm3, smoothstep } from '../core/math';

export interface TerrainGpu {
  vb: Buffer;
  ib: Buffer;
  indexCount: number;
  indexFormat: 'uint16' | 'uint32';
  /** r16f heights (also read by particles for soft edges) */
  heightTex: Texture;
  /** world rect covered by heightTex and the ground-FX map: origin xz, 1/size */
  rect: [number, number, number, number];
  water: { vb: Buffer; vertexCount: number; uniforms: Float32Array } | null;
}

export function destroyTerrainGpu(g: TerrainGpu) {
  g.vb.destroy();
  g.ib.destroy();
  g.heightTex.destroy();
  g.water?.vb.destroy();
}

function toHalf(v: number): number {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >>> 13);
}

/** Rings of the out-of-bounds skirt (metres beyond the map edge). */
const SKIRT_RINGS = [4, 10, 20, 34, 56, 90];

export function buildTerrainGpu(device: Device, t: TerrainData): TerrainGpu {
  const step = t.cellSize / t.res;
  // perimeter walk (closed loop) for the skirt: hills rising around the valley instead of a void
  const perim: [number, number, number, number][] = []; // i, j, outward dx, dz
  const I = t.vx - 1, J = t.vz - 1;
  for (let i = 0; i < I; i++) perim.push([i, 0, i === 0 ? -1 : 0, -1]);
  for (let j = 0; j < J; j++) perim.push([I, j, 1, j === 0 ? -1 : 0]);
  for (let i = I; i > 0; i--) perim.push([i, J, i === I ? 1 : 0, 1]);
  for (let j = J; j > 0; j--) perim.push([0, j, -1, j === J ? 1 : 0]);
  const np = perim.length;
  const n = t.vx * t.vz;
  const total = n + np * SKIRT_RINGS.length;
  const buf = new ArrayBuffer(total * 32);
  const dv = new DataView(buf);
  const H = (i: number, j: number) => t.heights[Math.min(t.vz - 1, Math.max(0, j)) * t.vx + Math.min(t.vx - 1, Math.max(0, i))];
  const put = (k: number, x: number, y: number, z: number, nrm: [number, number, number], splat: ArrayLike<number>, extra: ArrayLike<number>) => {
    const o = k * 32;
    dv.setFloat32(o, x, true);
    dv.setFloat32(o + 4, y, true);
    dv.setFloat32(o + 8, z, true);
    dv.setFloat32(o + 12, nrm[0], true);
    dv.setFloat32(o + 16, nrm[1], true);
    dv.setFloat32(o + 20, nrm[2], true);
    for (let c = 0; c < 4; c++) dv.setUint8(o + 24 + c, splat[c]);
    for (let c = 0; c < 4; c++) dv.setUint8(o + 28 + c, extra[c]);
  };
  for (let j = 0; j < t.vz; j++) {
    for (let i = 0; i < t.vx; i++) {
      const k = j * t.vx + i;
      let nx = H(i - 1, j) - H(i + 1, j), ny = 2 * step, nz = H(i, j - 1) - H(i, j + 1);
      const l = Math.hypot(nx, ny, nz);
      put(k, t.originX + i * step, t.heights[k], t.originZ + j * step, [nx / l, ny / l, nz / l], t.splat.subarray(k * 4, k * 4 + 4), t.extra.subarray(k * 4, k * 4 + 4));
    }
  }
  // skirt vertices: ring r of perimeter vertex p
  const skirtH = (x: number, z: number, d: number, h0: number) => {
    const rise = d * (0.22 + 0.3 * fbm3(x * 0.018, 3, z * 0.018, 3, 77)) + 6 * smoothstep(20, 90, d) * fbm3(x * 0.05, 5, z * 0.05, 2, 78);
    return h0 + rise;
  };
  const sk = (p: number, r: number) => n + r * np + p;
  // border heights smoothed along the perimeter (and kept above water) so streams and ponds that
  // touch the edge do not extrude into trenches: the skirt blends to this within ~12 m
  const hb = perim.map(([i, j]) => H(i, j));
  const hs = hb.map((_, p) => {
    let sum = 0;
    for (let o = -12; o <= 12; o++) sum += Math.max(hb[(p + o + np) % np], t.waterLevel + 0.8);
    return sum / 25;
  });
  const skPos: number[] = [];
  for (let r = 0; r < SKIRT_RINGS.length; r++) {
    for (let p = 0; p < np; p++) {
      const [i, j, dx, dz] = perim[p];
      const d = SKIRT_RINGS[r];
      const x = t.originX + i * step + dx * d, z = t.originZ + j * step + dz * d;
      skPos.push(x, skirtH(x, z, d, hb[p] + (hs[p] - hb[p]) * Math.min(1, d / 12)), z);
    }
  }
  const skY = (p: number, r: number) => (r < 0 ? hb[p] : skPos[(r * np + p) * 3 + 1]);
  for (let r = 0; r < SKIRT_RINGS.length; r++) {
    for (let p = 0; p < np; p++) {
      const [i, j] = perim[p];
      const x = skPos[(r * np + p) * 3], y = skPos[(r * np + p) * 3 + 1], z = skPos[(r * np + p) * 3 + 2];
      // normal from neighbours along the ring and across rings
      const pn = (p + 1) % np, pp = (p + np - 1) % np;
      const ax = skPos[(r * np + pn) * 3] - skPos[(r * np + pp) * 3], ay = skY(pn, r) - skY(pp, r), az = skPos[(r * np + pn) * 3 + 2] - skPos[(r * np + pp) * 3 + 2];
      const rin = r - 1, rout = Math.min(SKIRT_RINGS.length - 1, r + 1);
      const inX = rin < 0 ? t.originX + i * step : skPos[(rin * np + p) * 3], inZ = rin < 0 ? t.originZ + j * step : skPos[(rin * np + p) * 3 + 2];
      const bx = skPos[(rout * np + p) * 3] - inX, by = skY(p, rout) - skY(p, rin), bz = skPos[(rout * np + p) * 3 + 2] - inZ;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const k0 = (j * t.vx + i) * 4;
      const d = SKIRT_RINGS[r];
      const rock = Math.min(200, t.splat[k0 + 2] + d * 2.2);
      const oob = Math.min(255, 90 + d * 2.5);
      put(sk(p, r), x, y, z, [nx / l, ny / l, nz / l], [255, 0, rock, 0], [225, 0, 0, oob]);
    }
  }
  const quads = (t.vx - 1) * (t.vz - 1) + np * SKIRT_RINGS.length;
  const big = total > 65535;
  const idx = big ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let q = 0;
  for (let j = 0; j < t.vz - 1; j++) {
    for (let i = 0; i < t.vx - 1; i++) {
      const a = j * t.vx + i, b = a + 1, c = a + t.vx, d = c + 1;
      // alternate the diagonal for less directional artefacts; CCW seen from +Y
      if ((i + j) & 1) {
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      } else {
        idx[q++] = a; idx[q++] = c; idx[q++] = d;
        idx[q++] = a; idx[q++] = d; idx[q++] = b;
      }
    }
  }
  // skirt quads: inner ring (map border or previous skirt ring) → outer ring; winding fixed up by
  // checking the triangle's facing so the loop direction does not matter
  const vtx = (k: number): [number, number, number] => [dv.getFloat32(k * 32, true), dv.getFloat32(k * 32 + 4, true), dv.getFloat32(k * 32 + 8, true)];
  const tri = (a: number, b: number, c: number) => {
    const A = vtx(a), B = vtx(b), C = vtx(c);
    const ny = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
    if (ny >= 0) { idx[q++] = a; idx[q++] = b; idx[q++] = c; } else { idx[q++] = a; idx[q++] = c; idx[q++] = b; }
  };
  for (let r = 0; r < SKIRT_RINGS.length; r++) {
    for (let p = 0; p < np; p++) {
      const pn = (p + 1) % np;
      const inner = (pp: number) => (r === 0 ? perim[pp][1] * t.vx + perim[pp][0] : sk(pp, r - 1));
      const a = inner(p), b = inner(pn), c = sk(p, r), d = sk(pn, r);
      tri(a, b, d);
      tri(a, d, c);
    }
  }
  const vb = device.createBuffer({ size: buf.byteLength, usage: 'vertex', data: new Uint8Array(buf), label: 'terrain' });
  const ib = device.createBuffer({ size: idx.byteLength, usage: 'index', data: idx, label: 'terrain-idx' });

  const hdata = new Uint16Array(n);
  for (let k = 0; k < n; k++) hdata[k] = toHalf(t.heights[k]);
  const heightTex = device.createTexture({ width: t.vx, height: t.vz, format: 'r16float', data: hdata, label: 'heightmap' });
  const sizeX = (t.vx - 1) * step, sizeZ = (t.vz - 1) * step;
  // half-texel offset so texel centres line up with height samples
  const ox = t.originX - step / 2, oz = t.originZ - step / 2;
  const rect: TerrainGpu['rect'] = [ox, oz, 1 / (sizeX + step), 1 / (sizeZ + step)];

  let water: TerrainGpu['water'] = null;
  if (t.waterRects.length) {
    const y = t.waterLevel;
    const v: number[] = [];
    for (const r of t.waterRects) v.push(r.x0, y, r.z0, r.x0, y, r.z1, r.x1, y, r.z1, r.x0, y, r.z0, r.x1, y, r.z1, r.x1, y, r.z0);
    const verts = new Float32Array(v);
    const wvb = device.createBuffer({ size: verts.byteLength, usage: 'vertex', data: verts, label: 'water' });
    const sh = hexToLinear(0x3aa6a0), dp = hexToLinear(0x1d4f6b);
    const uniforms = new Float32Array([...rect, sh[0], sh[1], sh[2], 0, dp[0], dp[1], dp[2], 0.9]);
    water = { vb: wvb, vertexCount: verts.length / 3, uniforms };
  }
  return { vb, ib, indexCount: q, indexFormat: big ? 'uint32' : 'uint16', heightTex, rect, water };
}
