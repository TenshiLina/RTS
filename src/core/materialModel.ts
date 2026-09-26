// Material model shared by the offline asset generator and every renderer backend.
//
// Assets are standard glTF 2.0 (PBR metallic-roughness). Our engine-specific extras live in
// `material.extras` so the files still open correctly in any glTF viewer / DCC tool:
//   extras.pattern : MaterialPattern  — procedural surface detail evaluated in the shader
//   extras.team    : 0..1             — how strongly the faction/team colour replaces base colour
//   extras.sway    : 0..1             — wind sway (foliage, banners); scaled per-vertex
//
// At load time the engine flattens materials into per-vertex attributes so any model draws in a
// single call regardless of material count (important for instancing on every backend).

export const MaterialPattern = {
  None: 0,
  Wood: 1,
  Brick: 2,
  Stone: 3,
  Plaster: 4,
  RoofTile: 5,
  Cloth: 6,
  Metal: 7,
  Foliage: 8,
  Crystal: 9,
  Lacquer: 10,
  Bark: 11,
  Straw: 12,
  Paper: 13,
  Skin: 14,
  Lamellar: 15,
  Rock: 16,
  Bamboo: 17,
} as const;
export type MaterialPattern = (typeof MaterialPattern)[keyof typeof MaterialPattern];

export interface MaterialDef {
  name: string;
  /** sRGB hex colour, e.g. 0xb3261e */
  color: number;
  roughness?: number;
  metallic?: number;
  /** emissive strength, multiplied with base colour (HDR, >1 blooms) */
  emissive?: number;
  pattern?: MaterialPattern;
  team?: number;
  sway?: number;
  doubleSided?: boolean;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function hexToLinear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

/** Default team colours (sRGB) — RA2-style remap palette. */
export const TEAM_COLORS: Record<string, number> = {
  azure: 0x2f6fd0,
  crimson: 0xc8322b,
  jade: 0x2e9e5b,
  gold: 0xe0a82e,
  violet: 0x7a4bc2,
  ivory: 0xd9d2c0,
};
