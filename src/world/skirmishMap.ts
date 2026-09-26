// Skirmish map generation: terrain + gameplay grid + objects, point-symmetric for fair 1v1.
// Output is consumed by the simulation (grid, starts, jade nodes) and the renderer (terrain,
// object placements). For lockstep multiplayer the result will be serialised as a map file so
// every client loads identical data (see docs/ARCHITECTURE.md).

import { generateTerrain, heightAt, TerrainData, TerrainLayout, CELL_SIZE } from './terrain';
import { fbm3, hash2 } from '../core/math';

export const CELL = {
  WATER: 1,
  CLIFF: 2,
  OBSTACLE: 4,
  JADE: 8,
  NOBUILD: 16,
} as const;
// jade crystals are walkable (like RA2 ore) — only unbuildable
export const BLOCKS_MOVE = CELL.WATER | CELL.CLIFF | CELL.OBSTACLE;

export type ObjectKind = 'env_pine' | 'env_bamboo' | 'env_peach_tree' | 'env_rock' | 'env_scholar_rock';
export interface MapObject {
  kind: ObjectKind;
  cx: number;
  cz: number;
  /** visual jitter within the cell (metres) + rotation + scale */
  ox: number;
  oz: number;
  rot: number;
  scale: number;
}
export interface JadeNode {
  cx: number;
  cz: number;
  large: boolean;
}
export interface SkirmishMap {
  name: string;
  cells: number;
  terrain: TerrainData;
  flags: Uint8Array;
  starts: { cx: number; cz: number }[];
  objects: MapObject[];
  jade: JadeNode[];
}

export function cellCenter(map: { terrain: TerrainData }, cx: number, cz: number): [number, number] {
  const t = map.terrain;
  return [t.originX + (cx + 0.5) * t.cellSize, t.originZ + (cz + 0.5) * t.cellSize];
}
export function worldToCell(map: { terrain: TerrainData }, x: number, z: number): [number, number] {
  const t = map.terrain;
  return [Math.floor((x - t.originX) / t.cellSize), Math.floor((z - t.originZ) / t.cellSize)];
}

function distSeg(px: number, pz: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}
function distPoly(px: number, pz: number, pts: [number, number][]) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, pz, pts[i], pts[i + 1]));
  return d;
}

/** Mirror helpers for point symmetry about the map centre. */
const mirrorPt = (p: [number, number]): [number, number] => [-p[0], -p[1]];
const sym = <T extends { x: number; z: number }>(a: T[]) => [...a, ...a.map((o) => ({ ...o, x: -o.x, z: -o.z }))];

/** "Peach Garden Pass" — 64×64 cells, two players. */
export function generateSkirmishMap(seed = 11): SkirmishMap {
  const cells = 64;
  const start0: [number, number] = [-60, 56];
  const flank0: [number, number][] = [[-60, 56], [-72, 20], [-60, -20], [-30, -64], [10, -78], [60, -56]];
  const mid0: [number, number][] = [[-60, 56], [-34, 34], [0, 0]];
  const layout: TerrainLayout = {
    cells,
    seed,
    waterLevel: -1.1,
    ponds: sym([{ x: -24, z: -40, r: 11 }]),
    streams: [
      [[-24, -40], [-18, -60], [-8, -82], [-4, -100]],
      [[24, 40], [18, 60], [8, 82], [4, 100]],
    ],
    paths: [mid0, mid0.map(mirrorPt), flank0, flank0.map(mirrorPt).reverse()],
    jadeFields: sym([
      { x: -34, z: 78, r: 11 },
      { x: -80, z: 32, r: 9 },
      { x: -42, z: 6, r: 8 },
    ]).concat([{ x: 0, z: 0, r: 13 }]),
    knolls: sym([
      { x: -76, z: -70, r: 18, h: 9 },
      { x: -16, z: 20, r: 7, h: 3 },
    ]),
    flatZones: sym([{ x: start0[0], z: start0[1], r: 26 }]),
    yards: sym([{ x: start0[0], z: start0[1], r: 12 }]),
    waterRects: [
      { x0: -44, z0: -100, x1: 0, z1: -24 },
      { x0: 0, z0: 24, x1: 44, z1: 100 },
    ],
    edgeHills: 0.72,
  };
  const terrain = generateTerrain(layout);
  const flags = new Uint8Array(cells * cells);
  const step = terrain.cellSize / terrain.res;

  // ---- classify cells from terrain
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j <= terrain.res; j++) for (let i = 0; i <= terrain.res; i++) {
        const h = terrain.heights[(cz * terrain.res + j) * terrain.vx + cx * terrain.res + i];
        mn = Math.min(mn, h);
        mx = Math.max(mx, h);
      }
      let f = 0;
      if (mn < terrain.waterLevel + 0.2) f |= CELL.WATER;
      if (mx - mn > 1.9) f |= CELL.CLIFF;
      if (mx - mn > 1.0 || mn < terrain.waterLevel + 0.6) f |= CELL.NOBUILD;
      if (cx < 2 || cz < 2 || cx >= cells - 2 || cz >= cells - 2) f |= CELL.CLIFF;
      flags[cz * cells + cx] = f;
    }
  }
  void step;

  // ---- jade nodes (generated on one half, mirrored)
  const jade: JadeNode[] = [];
  const addMirrored = <T extends { cx: number; cz: number }>(arr: T[], item: T) => {
    arr.push(item);
    const m = { ...item, cx: cells - 1 - item.cx, cz: cells - 1 - item.cz };
    if (m.cx !== item.cx || m.cz !== item.cz) arr.push(m);
  };
  const inHalf = (cx: number, cz: number) => cx + cz < cells - 1 || (cx + cz === cells - 1 && cx < cz);
  const center = (cx: number, cz: number) => [terrain.originX + (cx + 0.5) * CELL_SIZE, terrain.originZ + (cz + 0.5) * CELL_SIZE];
  for (let cz = 0; cz < cells; cz++) for (let cx = 0; cx < cells; cx++) {
    if (!inHalf(cx, cz)) continue;
    const [x, z] = center(cx, cz);
    for (const jf of layout.jadeFields) {
      const d = Math.hypot(x - jf.x, z - jf.z);
      if (d > jf.r - 1) continue;
      if ((cx + cz) % 2 !== 0) continue; // checkerboard keeps lanes for harvesters
      if (hash2(cx, cz, seed) > 0.9) continue;
      if (flags[cz * cells + cx] & (CELL.WATER | CELL.CLIFF)) continue;
      addMirrored(jade, { cx, cz, large: d < jf.r * 0.45 });
      break;
    }
  }
  for (const n of jade) flags[n.cz * cells + n.cx] |= CELL.JADE | CELL.NOBUILD;
  // jade fields are not buildable (cell ring around nodes)
  for (const n of jade) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const x = n.cx + dx, z = n.cz + dz;
    if (x >= 0 && z >= 0 && x < cells && z < cells) flags[z * cells + x] |= CELL.NOBUILD;
  }

  // ---- obstacles: trees & rocks, keeping bases, fields, paths and water margins clear
  const objects: MapObject[] = [];
  const pathsAll = layout.paths;
  for (let cz = 2; cz < cells - 2; cz++) for (let cx = 2; cx < cells - 2; cx++) {
    if (!inHalf(cx, cz)) continue;
    const k = cz * cells + cx;
    if (flags[k] & (CELL.WATER | CELL.JADE)) continue;
    const [x, z] = center(cx, cz);
    const dStart = Math.min(Math.hypot(x - start0[0], z - start0[1]), Math.hypot(x + start0[0], z + start0[1]));
    if (dStart < 30) continue;
    if (layout.jadeFields.some((jf) => Math.hypot(x - jf.x, z - jf.z) < jf.r + 3)) continue;
    if (pathsAll.some((p) => distPoly(x, z, p) < 4.5)) continue;
    const h = heightAt(terrain, x, z);
    if (h < terrain.waterLevel + 0.7) continue;
    const grove = fbm3(x * 0.045, 11, z * 0.045, 3, seed);
    const edge = Math.max(Math.abs(x), Math.abs(z)) / 96;
    const onKnoll = layout.knolls.some((kn) => Math.hypot(x - kn.x, z - kn.z) < kn.r * 0.8);
    const nearWater = h < terrain.waterLevel + 1.8;
    const density = onKnoll ? 0.22 : Math.max(0, (grove - 0.52) * 2.6) + (edge > 0.8 ? 0.35 : 0) + 0.015;
    const r = hash2(cx, cz, seed + 3);
    if (r > density) continue;
    const pick = hash2(cx, cz, seed + 7);
    let kind: ObjectKind;
    if (onKnoll || (flags[k] & CELL.CLIFF)) kind = pick < 0.85 ? 'env_rock' : 'env_pine';
    else if (nearWater) kind = pick < 0.7 ? 'env_bamboo' : 'env_peach_tree';
    else if (grove > 0.62) kind = pick < 0.75 ? 'env_pine' : 'env_bamboo';
    else kind = pick < 0.45 ? 'env_peach_tree' : pick < 0.8 ? 'env_pine' : pick < 0.95 ? 'env_rock' : 'env_scholar_rock';
    const o: MapObject = {
      kind, cx, cz,
      ox: (hash2(cx, cz, seed + 13) - 0.5) * 1.2,
      oz: (hash2(cx, cz, seed + 17) - 0.5) * 1.2,
      rot: hash2(cx, cz, seed + 19) * Math.PI * 2,
      scale: 0.8 + hash2(cx, cz, seed + 23) * 0.45,
    };
    objects.push(o);
    const m = { ...o, cx: cells - 1 - cx, cz: cells - 1 - cz, ox: -o.ox, oz: -o.oz, rot: o.rot + Math.PI };
    if (m.cx !== cx || m.cz !== cz) objects.push(m);
  }
  for (const o of objects) flags[o.cz * cells + o.cx] |= CELL.OBSTACLE | CELL.NOBUILD;

  const s0 = [Math.floor((start0[0] - terrain.originX) / CELL_SIZE), Math.floor((start0[1] - terrain.originZ) / CELL_SIZE)];
  return {
    name: 'Peach Garden Pass',
    cells,
    terrain,
    flags,
    starts: [{ cx: s0[0], cz: s0[1] }, { cx: cells - 1 - s0[0], cz: cells - 1 - s0[1] }],
    objects,
    jade,
  };
}
