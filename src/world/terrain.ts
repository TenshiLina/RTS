// Terrain data — platform-agnostic, deterministic (shared by sim, renderer and tools).
// Heights are authored on a regular grid; gameplay uses cells of CELL_SIZE metres.

import { V3, clamp, fbm3, smoothstep, normalize, lerp } from '../core/math';

export const CELL_SIZE = 3;

export interface TerrainData {
  cellsX: number;
  cellsZ: number;
  cellSize: number;
  /** height samples per cell edge */
  res: number;
  /** vertices per row/column */
  vx: number;
  vz: number;
  /** world-space origin (min corner) */
  originX: number;
  originZ: number;
  heights: Float32Array;
  /** per-vertex RGBA: lush grass, dirt, rock, jade-soil */
  splat: Uint8Array;
  /** per-vertex RGBA: ao, flowers, sand, cliff */
  extra: Uint8Array;
  waterLevel: number;
  /** water body bounds (world xz) for the water mesh, or null */
  waterRect: { x0: number; z0: number; x1: number; z1: number } | null;
}

export function heightAt(t: TerrainData, x: number, z: number): number {
  const step = t.cellSize / t.res;
  const fx = clamp((x - t.originX) / step, 0, t.vx - 1.001);
  const fz = clamp((z - t.originZ) / step, 0, t.vz - 1.001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const ux = fx - ix, uz = fz - iz;
  const h = (i: number, j: number) => t.heights[j * t.vx + i];
  return lerp(lerp(h(ix, iz), h(ix + 1, iz), ux), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), ux), uz);
}

export function normalAt(t: TerrainData, x: number, z: number): V3 {
  const e = t.cellSize / t.res;
  return normalize([heightAt(t, x - e, z) - heightAt(t, x + e, z), 2 * e, heightAt(t, x, z - e) - heightAt(t, x, z + e)]);
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function distToPolyline(px: number, pz: number, pts: [number, number][]) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}

/**
 * "Peach Garden Valley" — the prototype biome: lush spring meadows, pine & bamboo groves,
 * a stream-fed pond and a jade vein. Central area is flat and buildable.
 */
export function generatePeachValley(cells = 40, seed = 7): TerrainData {
  const res = 3;
  const cellSize = CELL_SIZE;
  const vx = cells * res + 1, vz = cells * res + 1;
  const size = cells * cellSize;
  const originX = -size / 2, originZ = -size / 2;
  const heights = new Float32Array(vx * vz);
  const splat = new Uint8Array(vx * vz * 4);
  const extra = new Uint8Array(vx * vz * 4);
  const waterLevel = -1.1;
  const pond = { x: -34, z: 30, r: 13 };
  const stream: [number, number][] = [[-60, -8], [-50, 2], [-44, 12], [-38, 22], [-34, 30]];
  const paths: [number, number][][] = [
    [[0, 4], [6, 16], [10, 30], [18, 44], [22, 60]],
    [[0, 4], [-10, -4], [-22, -10], [-40, -14], [-60, -20]],
    [[0, 4], [14, -6], [26, -20]],
  ];
  const jade = { x: 28, z: -24, r: 10 };

  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const x = originX + (i * cellSize) / res;
      const z = originZ + (j * cellSize) / res;
      const k = j * vx + i;
      // edge hills: rise toward the map border (keeps the centre buildable)
      const edge = Math.max(Math.abs(x), Math.abs(z)) / (size / 2);
      const hillMask = smoothstep(0.55, 0.98, edge + (fbm3(x * 0.02, 0, z * 0.02, 3, seed) - 0.5) * 0.35);
      let h = hillMask * (4 + 10 * fbm3(x * 0.03, 1, z * 0.03, 4, seed + 1));
      // gentle rolling undulation everywhere
      h += (fbm3(x * 0.05, 2, z * 0.05, 3, seed + 2) - 0.5) * 1.2 * (1 - smoothstep(0, 22, Math.hypot(x, z - 2)) * 0.8);
      // rocky knoll NE
      const knoll = Math.max(0, 1 - Math.hypot(x - 38, z + 40) / 14);
      h += knoll * knoll * 7;
      // pond + stream carve
      const dp = Math.hypot(x - pond.x, (z - pond.z) * 1.15);
      const pondCarve = smoothstep(pond.r + 6, pond.r * 0.35, dp);
      const ds = distToPolyline(x, z, stream);
      const streamCarve = smoothstep(4.5, 1.2, ds);
      const carve = Math.max(pondCarve, streamCarve * 0.8);
      h = lerp(h, waterLevel - 1.4 - (pondCarve > 0.8 ? 0.8 : 0), carve);
      heights[k] = h;

      // splat
      const dPath = Math.min(...paths.map((p) => distToPolyline(x, z, p)));
      const pathW = smoothstep(1.7, 0.5, dPath + (fbm3(x * 0.3, 3, z * 0.3, 2, seed) - 0.5) * 1.2);
      const dirtPatch = smoothstep(0.74, 0.84, fbm3(x * 0.05, 4, z * 0.05, 3, seed + 5)) * 0.6;
      const baseYard = smoothstep(12, 6, Math.hypot(x, z - 2)) * 0.3; // trodden ground at the base centre
      const dj = Math.hypot(x - jade.x, z - jade.z);
      const jadeW = smoothstep(jade.r, jade.r * 0.4, dj + (fbm3(x * 0.2, 5, z * 0.2, 2, seed) - 0.5) * 4);
      const rockW = Math.max(knoll > 0.35 ? smoothstep(0.35, 0.7, knoll) : 0, hillMask > 0.7 ? smoothstep(0.7, 1, hillMask) * smoothstep(0.45, 0.7, fbm3(x * 0.08, 6, z * 0.08, 2, seed)) : 0);
      const sand = smoothstep(waterLevel + 0.9, waterLevel + 0.25, h) * smoothstep(0.05, 0.4, carve);
      const flowers = smoothstep(0.45, 0.7, fbm3(x * 0.025, 7, z * 0.025, 3, seed + 9)) * (1 - pathW) * (1 - sand);
      splat[k * 4 + 0] = 255;
      splat[k * 4 + 1] = Math.round(clamp(Math.max(pathW, dirtPatch, baseYard), 0, 1) * 255);
      splat[k * 4 + 2] = Math.round(clamp(rockW, 0, 1) * 255);
      splat[k * 4 + 3] = Math.round(jadeW * 255);
      extra[k * 4 + 1] = Math.round(flowers * 255);
      extra[k * 4 + 2] = Math.round(sand * 255);
    }
  }
  // AO from local concavity
  for (let j = 0; j < vz; j++) {
    for (let i = 0; i < vx; i++) {
      const k = j * vx + i;
      let sum = 0, n = 0;
      for (let dj = -4; dj <= 4; dj += 2) for (let di = -4; di <= 4; di += 2) {
        const ii = clamp(i + di, 0, vx - 1), jj = clamp(j + dj, 0, vz - 1);
        sum += heights[jj * vx + ii];
        n++;
      }
      const concav = sum / n - heights[k];
      extra[k * 4 + 0] = Math.round(clamp(1 - Math.max(0, concav) * 0.35, 0.45, 1) * 255);
    }
  }
  return {
    cellsX: cells, cellsZ: cells, cellSize, res, vx, vz, originX, originZ, heights, splat, extra, waterLevel,
    waterRect: { x0: -60, z0: -20, x1: -14, z1: 50 },
  };
}

/** Flatten terrain under a structure footprint (called when placing buildings). */
export function flattenRect(t: TerrainData, cx: number, cz: number, w: number, d: number, blend = 2) {
  const step = t.cellSize / t.res;
  let sum = 0, n = 0;
  for (let j = 0; j < t.vz; j++) for (let i = 0; i < t.vx; i++) {
    const x = t.originX + i * step, z = t.originZ + j * step;
    if (Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= d / 2) {
      sum += t.heights[j * t.vx + i];
      n++;
    }
  }
  const target = n ? sum / n : 0;
  for (let j = 0; j < t.vz; j++) for (let i = 0; i < t.vx; i++) {
    const x = t.originX + i * step, z = t.originZ + j * step;
    const dx = Math.max(0, Math.abs(x - cx) - w / 2), dz = Math.max(0, Math.abs(z - cz) - d / 2);
    const dd = Math.hypot(dx, dz);
    if (dd >= blend) continue;
    const k = j * t.vx + i;
    t.heights[k] = lerp(target, t.heights[k], smoothstep(0, blend, dd));
  }
  return target;
}
