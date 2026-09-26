// GPU resources for terrain + water, built from world/terrain.ts data.

import type { Device, Buffer, Texture } from './rhi/types';
import type { TerrainData } from '../world/terrain';
import { hexToLinear } from '../core/materialModel';

export interface TerrainGpu {
  vb: Buffer;
  ib: Buffer;
  indexCount: number;
  indexFormat: 'uint16' | 'uint32';
  water: { vb: Buffer; vertexCount: number; heightTex: Texture; uniforms: Float32Array } | null;
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

export function buildTerrainGpu(device: Device, t: TerrainData): TerrainGpu {
  const step = t.cellSize / t.res;
  const n = t.vx * t.vz;
  const buf = new ArrayBuffer(n * 32);
  const dv = new DataView(buf);
  const H = (i: number, j: number) => t.heights[Math.min(t.vz - 1, Math.max(0, j)) * t.vx + Math.min(t.vx - 1, Math.max(0, i))];
  for (let j = 0; j < t.vz; j++) {
    for (let i = 0; i < t.vx; i++) {
      const k = j * t.vx + i;
      const o = k * 32;
      const x = t.originX + i * step, z = t.originZ + j * step;
      dv.setFloat32(o, x, true);
      dv.setFloat32(o + 4, t.heights[k], true);
      dv.setFloat32(o + 8, z, true);
      let nx = H(i - 1, j) - H(i + 1, j), ny = 2 * step, nz = H(i, j - 1) - H(i, j + 1);
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o + 12, nx, true);
      dv.setFloat32(o + 16, ny, true);
      dv.setFloat32(o + 20, nz, true);
      for (let c = 0; c < 4; c++) dv.setUint8(o + 24 + c, t.splat[k * 4 + c]);
      for (let c = 0; c < 4; c++) dv.setUint8(o + 28 + c, t.extra[k * 4 + c]);
    }
  }
  const quads = (t.vx - 1) * (t.vz - 1);
  const big = n > 65535;
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
  const vb = device.createBuffer({ size: buf.byteLength, usage: 'vertex', data: new Uint8Array(buf), label: 'terrain' });
  const ib = device.createBuffer({ size: idx.byteLength, usage: 'index', data: idx, label: 'terrain-idx' });

  let water: TerrainGpu['water'] = null;
  if (t.waterRect) {
    const r = t.waterRect;
    const y = t.waterLevel;
    const verts = new Float32Array([r.x0, y, r.z0, r.x0, y, r.z1, r.x1, y, r.z1, r.x0, y, r.z0, r.x1, y, r.z1, r.x1, y, r.z0]);
    const wvb = device.createBuffer({ size: verts.byteLength, usage: 'vertex', data: verts, label: 'water' });
    const hdata = new Uint16Array(n);
    for (let k = 0; k < n; k++) hdata[k] = toHalf(t.heights[k]);
    const heightTex = device.createTexture({ width: t.vx, height: t.vz, format: 'r16float', data: hdata, label: 'heightmap' });
    const sizeX = (t.vx - 1) * step, sizeZ = (t.vz - 1) * step;
    const sh = hexToLinear(0x3aa6a0), dp = hexToLinear(0x1d4f6b);
    // half-texel offset so texel centres line up with height samples
    const ox = t.originX - step / 2, oz = t.originZ - step / 2;
    const uniforms = new Float32Array([ox, oz, 1 / (sizeX + step), 1 / (sizeZ + step), sh[0], sh[1], sh[2], 0, dp[0], dp[1], dp[2], 0.9]);
    water = { vb: wvb, vertexCount: 6, heightTex, uniforms };
  }
  return { vb, ib, indexCount: idx.length, indexFormat: big ? 'uint32' : 'uint16', water };
}
