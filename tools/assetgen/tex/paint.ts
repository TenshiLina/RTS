// Painters: the functions that decide what every texel of a character looks like.
//
// A painted material carries `paint: PaintSpec`. When the asset is built, its triangles are
// unwrapped into a texture atlas (unwrap.ts, pack.ts) and every texel is handed to the painter
// with the surface point it covers (bind-pose position, normal, the primitive's own parameters,
// distance to the piece's open edges). The painter writes colour, roughness, metalness, a team
// mask, a height (turned into a normal map) and cavity shading. Everything is procedural and
// evaluated in 3D, so seams between charts don't show.

import type { V2, V3 } from '../../../src/core/math';
import type { MaterialDef } from '../../../src/core/materialModel';
import { hexToLinear } from '../../../src/core/materialModel';

export interface PaintIn {
  /** model-space position (bind pose) */
  p: V3;
  /** interpolated surface normal (unit) */
  n: V3;
  /** primitive parameters (0..1) — around/along a tube, u/v of a surface — when available */
  pp?: V2;
  /** primitive id (texels of one piece share it) */
  piece: number;
  /** distance (m) to the nearest open edge of this piece (hem, cuff, cut); Infinity if closed */
  readonly edge: number;
  mat: MaterialDef;
  /** size of one texel in metres (for anti-aliasing thin lines) */
  texel: number;
}

export interface PaintOut {
  /** linear RGB */
  albedo: V3;
  rough: number;
  metal: number;
  /** 0..1: how much the team colour replaces the albedo */
  team: number;
  /** relative height in metres (normal-map detail) */
  height: number;
  /** object-space normal override (e.g. from a high-resolution sculpt); unset = surface normal */
  normal?: V3;
  /** cavity occlusion multiplier (1 = open) */
  ao: number;
  /** extra emissive (0..1) — not used yet */
  glow?: number;
}

export type Painter = (i: PaintIn, o: PaintOut) => void;

export interface PaintSpec {
  fn: Painter;
  /** texel density relative to the rest of the atlas (faces 3, eyes 4, boots 0.8…) */
  density?: number;
  /** shading model (materialModel.PaintedShading) */
  shading?: number;
}

export const lin = (hex: number): V3 => hexToLinear(hex);

/** A painted variant of a material. */
export function painted(base: MaterialDef, fn: Painter, o: { density?: number; shading?: number; name?: string } = {}): MaterialDef {
  return { ...base, name: o.name ?? base.name + '_p', paint: { fn, density: o.density, shading: o.shading } satisfies PaintSpec };
}

export function specOf(m: MaterialDef): PaintSpec | null {
  return (m.paint as PaintSpec | undefined) ?? null;
}
