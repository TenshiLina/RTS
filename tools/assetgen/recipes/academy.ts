// 五行书院 Five Elements Academy — where adepts of Fire, Ice, Water and Air are trained.
// A round hall under three conical tiers of glazed tiles (after the Hall of Prayer at the
// Temple of Heaven): the only round silhouette in the base, readable at a glance. Each element
// has an altar on the terrace. 4×4 cells (12 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { platform, bannerPole, lantern } from '../kit/roof';
import { quatEuler, V2, V3 } from '../../../src/core/math';
import type { Recipe } from '../recipe';
import { taiji } from './props';

const ICE = { ...PAL.jade, name: 'ice_crystal', color: 0x9ad8ff, emissive: 0.7 };
const WATER = { ...PAL.jade, name: 'basin_water', color: 0x2e8c96, emissive: 0.25, roughness: 0.05 };

/** Round conical roof tier with flared, lifted eaves. */
function roundRoof(mb: MeshBuilder, r0: number, y0: number, rise: number, rTop: number, sides = 24) {
  const prof: V2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // concave sweep: steep at the top, flattening and kicking up at the eave
    const r = r0 + (rTop - r0) * t;
    const y = y0 + rise * (1 - Math.pow(1 - t, 1.8)) - (1 - t) * (1 - t) * 0.0;
    prof.push([r, y]);
  }
  prof[0][1] += 0.12; // lifted eave lip
  mb.with(null, () => mb.lathe(prof, sides), { mat: PAL.roofTeam });
  // underside (soffit) + gilded eave trim
  mb.with(null, () => mb.lathe([[rTop, y0 + rise - 0.25], [r0 - 0.05, y0 - 0.05]], sides), { mat: PAL.roofUnder });
  mb.with(null, () => mb.lathe([[r0 + 0.02, y0 + 0.06], [r0 + 0.05, y0 + 0.16], [r0, y0 + 0.2]], sides), { mat: PAL.gold });
}

export const academy: Recipe = {
  id: 'azure_academy',
  name: 'Five Elements Academy',
  hanzi: '五行书院',
  category: 'structure',
  footprint: [4, 4],
  build() {
    const mb = new MeshBuilder('azure_academy');
    // square outer terrace (fits the cell grid) with a round marble dais on it
    const ph = 0.4;
    platform(mb, 11.4, 11.4, ph, { stairs: 'front', stairW: 2.6 });
    mb.with(null, () => mb.lathe([[5.0, ph], [5.0, ph + 0.35], [4.75, ph + 0.4], [4.75, ph + 0.45]], 32, { capTop: true }), { mat: PAL.stone });
    mb.with(null, () => mb.lathe([[5.02, ph + 0.3], [5.06, ph + 0.38], [4.98, ph + 0.4]], 32), { mat: PAL.plaster });
    const dy = ph + 0.45;
    // dais steps in front
    for (let i = 0; i < 2; i++) mb.with(null, () => mb.box([2.2, 0.2, 0.4], [0, ph + 0.1 + i * 0.2, 5.15 - i * 0.35]), { mat: PAL.stone });
    // taiji mosaic in front of the hall
    mb.at(0, dy + 0.005, 3.7, () => taiji(mb, 0.8));

    // ---- round hall: 12 vermilion columns, lattice walls, gilded beam band
    const R1 = 2.9, colH = 2.6;
    mb.with(null, () => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        mb.at(Math.sin(a) * R1, dy, Math.cos(a) * R1, () => mb.cylinder({ r: 0.16, h: colH, sides: 8 }));
      }
    }, { mat: PAL.vermilion });
    // lattice drum wall (slightly inside the columns), open doorway at the front
    mb.with(null, () => mb.lathe([[R1 - 0.12, dy], [R1 - 0.12, dy + colH - 0.3]], 24, { arc: Math.PI * 2 * (21 / 24), phase: Math.PI * (1 + 1 / 24) + Math.PI * 2 * (1.5 / 24) }), { mat: PAL.lattice });
    mb.with(null, () => mb.lathe([[R1 - 0.1, dy + 0.9], [R1 - 0.1, dy + colH - 0.45]], 24, { arc: Math.PI * 2 * (21 / 24), phase: Math.PI * (1 + 1 / 24) + Math.PI * 2 * (1.5 / 24) }), { mat: PAL.paperWindow });
    mb.with(null, () => mb.lathe([[R1 + 0.2, dy + colH - 0.3], [R1 + 0.22, dy + colH + 0.05], [R1 - 0.2, dy + colH + 0.1]], 24), { mat: PAL.paintBlue });
    mb.with(null, () => mb.lathe([[R1 + 0.23, dy + colH - 0.05], [R1 + 0.23, dy + colH + 0.02]], 24), { mat: PAL.gold });

    // ---- three conical tiers (Temple-of-Heaven silhouette)
    const y1 = dy + colH + 0.1;
    roundRoof(mb, 4.3, y1, 1.2, 2.5);
    // second drum
    mb.with(null, () => mb.lathe([[2.35, y1 + 0.9], [2.35, y1 + 1.9]], 24), { mat: PAL.lattice });
    mb.with(null, () => mb.lathe([[2.38, y1 + 1.6], [2.4, y1 + 1.95]], 24), { mat: PAL.paintBlue });
    const y2 = y1 + 1.95;
    roundRoof(mb, 3.25, y2, 1.0, 1.7);
    mb.with(null, () => mb.lathe([[1.6, y2 + 0.8], [1.6, y2 + 1.55]], 24), { mat: PAL.vermilion });
    const y3 = y2 + 1.55;
    roundRoof(mb, 2.3, y3, 1.5, 0.12);
    // gilded finial
    mb.with(T(0, y3 + 1.45, 0), () => {
      mb.lathe([[0.22, 0], [0.26, 0.12], [0.14, 0.24], [0.2, 0.42], [0.001, 0.8]], 12, { capBottom: true });
    }, { mat: PAL.gold });

    // ---- the four element altars on the terrace diagonals
    const d = 4.0;
    // FIRE (front-left): bronze tripod brazier with a live fire
    mb.with(T(d, ph, d), () => {
      mb.with(null, () => {
        mb.lathe([[0.55, 0.95], [0.62, 1.15], [0.5, 1.3], [0.42, 1.28]], 12, { capBottom: true });
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          mb.tube([[Math.sin(a) * 0.3, 1.0, Math.cos(a) * 0.3], [Math.sin(a) * 0.5, 0.4, Math.cos(a) * 0.5], [Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55]], 0.05, 5);
        }
      }, { mat: PAL.bronze });
      mb.with(null, () => mb.at(0, 1.35, 0, () => mb.blob(0.36, 1, { squash: [1, 1.5, 1], displace: (dd) => Math.max(0, dd[1]) * 0.35 })), { mat: PAL.fire });
    });
    // WATER (back-left): round basin with water and a jade spout
    mb.with(T(d, ph, -d), () => {
      mb.with(null, () => mb.lathe([[0.8, 0], [0.85, 0.5], [0.95, 0.62], [0.88, 0.65], [0.75, 0.58], [0.75, 0.2]], 20, { capBottom: true }), { mat: PAL.stone });
      mb.with(null, () => mb.cylinder({ r: 0.76, h: 0.02, y0: 0.52, sides: 20 }), { mat: WATER });
      mb.with(null, () => mb.at(0, 0.5, 0, () => mb.cylinder({ r: 0.08, rTop: 0.05, h: 0.6, sides: 6 })), { mat: PAL.jadeDeep });
    });
    // ICE (back-right): crystal cluster obelisk
    mb.with(T(-d, ph, -d), () => {
      mb.with(null, () => mb.cylinder({ r: 0.6, h: 0.3, sides: 6 }), { mat: PAL.stoneDark });
      mb.with(null, () => {
        const shards: [number, number, number, number, number][] = [[0, 0, 0.26, 1.9, 0], [0.28, 0.12, 0.16, 1.1, 18], [-0.24, 0.16, 0.15, 1.25, -20], [0.08, -0.27, 0.14, 0.95, 14], [-0.12, -0.2, 0.12, 0.8, -12]];
        for (const [x, z, r, h, tilt] of shards) {
          mb.with(T(x, 0.3, z, [tilt * 0.6, 0, tilt]), () => mb.lathe([[r, 0], [r * 1.05, h * 0.7], [0.001, h]], 6, { smooth: false, capBottom: true }));
        }
      }, { mat: ICE });
    });
    // AIR (front-right): pole with a spinning ring of streamers + wind chimes (joint 1)
    const poleH = 4.2;
    mb.with(T(-d, ph, d), () => {
      mb.with(null, () => mb.cylinder({ r: 0.07, h: poleH, sides: 6 }), { mat: PAL.timberDark });
      mb.with(null, () => mb.cylinder({ r: 0.35, h: 0.25, sides: 8 }), { mat: PAL.stoneDark });
    });
    mb.with(T(-d, ph + poleH - 0.3, d), () => {
      mb.with(null, () => mb.lathe([[0.55, 0], [0.58, 0.04], [0.55, 0.08]], 12), { mat: PAL.brass });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        mb.with(T(Math.sin(a) * 0.56, 0, Math.cos(a) * 0.56, [0, (a * 180) / Math.PI, 0]), () => {
          mb.with(null, () => mb.box([0.12, 1.1, 0.01], [0, -0.55, 0]), { mat: i % 2 ? PAL.clothWhite : PAL.clothTeam });
        });
        mb.with(T(Math.sin(a + 0.5) * 0.4, 0, Math.cos(a + 0.5) * 0.4), () => mb.cylinder({ r: 0.025, h: 0.35, y0: -0.4, sides: 5 }), { mat: PAL.bronze });
      }
    }, { joint: 1 });

    // lanterns + banners at the back corners
    for (const [x, z] of [[2.2, -5.1], [-2.2, -5.1]]) mb.at(x, ph, z, () => lantern(mb, [0, 1.3, 0], 0.2));
    bannerPole(mb, [5.2, ph, -5.2], 4.8, 0.8, 1.8, 0);
    bannerPole(mb, [-5.2, ph, -5.2], 4.8, 0.8, 1.8, 180);
    // name plaque over the doorway
    mb.with(null, () => mb.box([1.3, 0.5, 0.06], [0, dy + colH - 0.15, R1 + 0.25]), { mat: PAL.plaque });
    mb.with(null, () => mb.box([1.4, 0.58, 0.04], [0, dy + colH - 0.15, R1 + 0.22]), { mat: PAL.gold });

    const chimeY = ph + poleH - 0.3;
    return {
      mesh: mb,
      skeleton: [
        { name: 'root', parent: -1, pos: [0, 0, 0] },
        { name: 'wind', parent: 0, pos: [-d, chimeY, d] as V3 },
      ],
      animations: [{ name: 'idle', duration: 5, fps: 20, tracks: { wind: (p) => ({ r: quatEuler(0, p * Math.PI * 2, 0) }) } }],
      sockets: [
        { name: 'fire', pos: [d, ph + 1.4, d] },
        { name: 'water', pos: [d, ph + 0.6, -d] },
        { name: 'ice', pos: [-d, ph + 1.5, -d] },
        { name: 'air', pos: [-d, chimeY, d] },
        { name: 'finial', pos: [0, y3 + 2.2, 0] },
      ],
      ao: { maxDist: 2.5 },
    };
  },
};

