// Art-direction palette. Colours are sRGB; the exporter converts to linear.
// Direction: "Red Alert 2, remastered" — saturated, readable from the RTS camera, with team colour
// on roof glaze and banners so ownership reads instantly from above.

import { MaterialDef, MaterialPattern as P } from '../../../src/core/materialModel';

const m = (name: string, color: number, o: Partial<MaterialDef> = {}): MaterialDef => ({ name, color, roughness: 0.8, ...o });

export const PAL = {
  // architecture
  vermilion: m('vermilion', 0xb02a1c, { roughness: 0.42, pattern: P.Lacquer }),
  lacquerDark: m('lacquer_dark', 0x5b1d14, { roughness: 0.5, pattern: P.Lacquer }),
  timber: m('timber', 0x8f6a44, { roughness: 0.8, pattern: P.Wood }),
  timberDark: m('timber_dark', 0x4d3524, { roughness: 0.85, pattern: P.Wood }),
  plaster: m('plaster', 0xe9e2d0, { roughness: 0.95, pattern: P.Plaster }),
  plasterOchre: m('plaster_ochre', 0xd9b77e, { roughness: 0.95, pattern: P.Plaster }),
  brick: m('brick_grey', 0x76746f, { roughness: 0.9, pattern: P.Brick }),
  stone: m('stone', 0xb3ad9f, { roughness: 0.9, pattern: P.Stone }),
  stoneDark: m('stone_dark', 0x77716a, { roughness: 0.9, pattern: P.Stone }),
  rammedEarth: m('rammed_earth', 0xa3845c, { roughness: 1, pattern: P.Plaster }),
  roofTeam: m('roof_team', 0x4a5058, { roughness: 0.6, pattern: P.RoofTile, team: 0.62 }),
  roofGrey: m('roof_grey', 0x4c5257, { roughness: 0.6, pattern: P.RoofTile }),
  roofUnder: m('roof_under', 0x6b2a1d, { roughness: 0.8, pattern: P.Wood }),
  ridge: m('ridge', 0x3b3f44, { roughness: 0.5 }),
  gold: m('gold', 0xe0b04a, { roughness: 0.3, metallic: 1 }),
  goldDull: m('gold_dull', 0xb8913f, { roughness: 0.55, metallic: 0.8 }),
  bronze: m('bronze', 0x9a6532, { roughness: 0.42, metallic: 1, pattern: P.Metal }),
  brass: m('brass', 0xc39a45, { roughness: 0.35, metallic: 1, pattern: P.Metal }),
  iron: m('iron', 0x45464a, { roughness: 0.55, metallic: 1, pattern: P.Metal }),
  paintTeal: m('paint_teal', 0x2a8a80, { roughness: 0.6 }),
  paintBlue: m('paint_blue', 0x284e96, { roughness: 0.6 }),
  paintGreen: m('paint_green', 0x3a8048, { roughness: 0.6 }),
  plaque: m('plaque', 0x1f2f5c, { roughness: 0.5 }),
  lattice: m('lattice', 0x7a2418, { roughness: 0.6, pattern: P.Lacquer }),
  paperWindow: m('paper_window', 0xf1e3bf, { roughness: 1, pattern: P.Paper, emissive: 0.08 }),
  // cloth & props
  clothTeam: m('cloth_team', 0xe8e0cc, { roughness: 0.9, pattern: P.Cloth, team: 1, doubleSided: true }),
  clothRed: m('cloth_red', 0xb52d24, { roughness: 0.9, pattern: P.Cloth, doubleSided: true }),
  clothGold: m('cloth_gold', 0xd9a441, { roughness: 0.85, pattern: P.Cloth, doubleSided: true }),
  clothWhite: m('cloth_white', 0xe8e2d4, { roughness: 0.9, pattern: P.Cloth, doubleSided: true }),
  clothBlack: m('cloth_black', 0x26242a, { roughness: 0.9, pattern: P.Cloth }),
  clothIndigo: m('cloth_indigo', 0x2d3558, { roughness: 0.9, pattern: P.Cloth }),
  clothTan: m('cloth_tan', 0xa8895e, { roughness: 0.95, pattern: P.Cloth }),
  clothOlive: m('cloth_olive', 0x5f5a3c, { roughness: 0.95, pattern: P.Cloth }),
  clothBrown: m('cloth_brown', 0x6b4a32, { roughness: 0.95, pattern: P.Cloth }),
  lanternRed: m('lantern_red', 0xd23a26, { roughness: 0.7, pattern: P.Paper, emissive: 1.6 }),
  straw: m('straw', 0xcfae6b, { roughness: 1, pattern: P.Straw }),
  rope: m('rope', 0xa88a5a, { roughness: 1, pattern: P.Straw }),
  leather: m('leather', 0x6d4527, { roughness: 0.7 }),
  // characters
  skin: m('skin', 0xe6b58e, { roughness: 0.7, pattern: P.Skin }),
  hair: m('hair', 0x1c1816, { roughness: 0.6 }),
  lamellarTeam: m('lamellar_team', 0x8a8f96, { roughness: 0.45, metallic: 0.6, pattern: P.Lamellar, team: 0.55 }),
  lamellarSteel: m('lamellar_steel', 0x8c9096, { roughness: 0.4, metallic: 0.85, pattern: P.Lamellar }),
  steel: m('steel', 0xb9bcc2, { roughness: 0.28, metallic: 1 }),
  // magic
  jade: m('jade', 0x2fb57a, { roughness: 0.15, pattern: P.Crystal, emissive: 0.55 }),
  jadeDeep: m('jade_deep', 0x1f8a5c, { roughness: 0.25, pattern: P.Crystal, emissive: 0.35 }),
  qi: m('qi_glow', 0x7fe0ff, { roughness: 0.1, emissive: 4.0 }),
  fire: m('fire_glow', 0xff8a2a, { roughness: 0.1, emissive: 5.0 }),
  talisman: m('talisman', 0xf2d34e, { roughness: 0.9, pattern: P.Paper, emissive: 0.6, doubleSided: true }),
  // nature
  bark: m('bark', 0x4d3a2c, { roughness: 1, pattern: P.Bark }),
  barkPine: m('bark_pine', 0x5a3f2e, { roughness: 1, pattern: P.Bark }),
  pineNeedles: m('pine_needles', 0x2c5534, { roughness: 0.9, pattern: P.Foliage, sway: 0.3 }),
  bambooStalk: m('bamboo_stalk', 0x86ad4f, { roughness: 0.55, pattern: P.Bamboo, sway: 1 }),
  bambooLeaf: m('bamboo_leaf', 0x5d9a3a, { roughness: 0.8, pattern: P.Foliage, sway: 1, doubleSided: true }),
  peachBlossom: m('peach_blossom', 0xef98b8, { roughness: 0.85, pattern: P.Foliage, sway: 0.4 }),
  leafGreen: m('leaf_green', 0x4f8a3c, { roughness: 0.85, pattern: P.Foliage, sway: 0.4 }),
  rock: m('rock', 0x928d82, { roughness: 0.95, pattern: P.Rock }),
  rockMossy: m('rock_mossy', 0x7d8466, { roughness: 0.95, pattern: P.Rock }),
  dirt: m('dirt', 0x7a5c3e, { roughness: 1, pattern: P.Rock }),
};
