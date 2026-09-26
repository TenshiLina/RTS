// 御辇 Imperial Caravan — the Azure Dynasty MCV. A six-wheeled steam carriage carrying a
// folded pavilion of the Governor's court; it deploys into a Governor's Yamen.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, lantern, bannerPole } from '../kit/roof';
import type { Recipe } from '../recipe';
import type { JointDef, AnimDef } from '../kit/gltf';
import { quatAxisAngle, quatEuler, DEG, V3 } from '../../../src/core/math';
import { gear } from './props2';

const WHEELS: V3[] = [
  [1.55, 0.78, 2.3], [-1.55, 0.78, 2.3],
  [1.55, 0.78, 0.0], [-1.55, 0.78, 0.0],
  [1.55, 0.78, -2.3], [-1.55, 0.78, -2.3],
];

const SK: JointDef[] = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'body', parent: 0, pos: [0, 1.2, 0] },
  ...WHEELS.map((p, i) => ({ name: `wheel${i}`, parent: 0, pos: p })),
  { name: 'canopy', parent: 1, pos: [0, 3.0, -0.4] },
  { name: 'panelL', parent: 1, pos: [1.35, 1.55, -0.4] },
  { name: 'panelR', parent: 1, pos: [-1.35, 1.55, -0.4] },
  { name: 'flywheel', parent: 1, pos: [0, 2.2, -3.05] },
];
const JI = Object.fromEntries(SK.map((j, i) => [j.name, i])) as Record<string, number>;

export const caravan: Recipe = {
  id: 'azure_caravan',
  name: 'Imperial Caravan',
  hanzi: '御辇',
  category: 'unit',
  build() {
    const mb = new MeshBuilder('azure_caravan');
    // ---- chassis
    mb.with(null, () => {
      mb.with(null, () => {
        mb.box([2.7, 0.35, 7.0], [0, 1.1, 0], 0.06);
        mb.box([2.9, 0.12, 7.2], [0, 1.32, 0], 0.03);
        // bow and stern beams
        mb.box([3.1, 0.2, 0.3], [0, 1.05, 3.55], 0.04);
        mb.box([3.1, 0.2, 0.3], [0, 1.05, -3.55], 0.04);
      }, { mat: PAL.timberDark });
      mb.with(null, () => {
        for (const z of [-2.3, 0, 2.3]) mb.box([3.3, 0.14, 0.14], [0, 0.8, z], 0.03); // axles
        mb.box([2.95, 0.05, 7.25], [0, 1.4, 0]);
      }, { mat: PAL.bronze });
      // lower cabin: lacquered hull with gold studs
      mb.with(null, () => mb.box([2.6, 1.0, 4.6], [0, 1.9, -0.4], 0.05), { mat: PAL.vermilion });
      mb.with(null, () => {
        for (const s of [-1, 1]) for (let i = 0; i < 6; i++) for (const y of [1.6, 2.2]) mb.at(s * 1.31, y, -2.4 + i * 0.8, () => mb.sphere(0.035, 5, 4));
      }, { mat: PAL.gold });
      // front deck with driver's bench and crank pillar
      mb.with(null, () => {
        mb.box([2.4, 0.5, 0.9], [0, 1.65, 2.55], 0.04);
        mb.box([1.8, 0.12, 0.5], [0, 1.95, 2.35], 0.02);
      }, { mat: PAL.timber });
      mb.with(null, () => {
        mb.cylinder({ r: 0.07, h: 1.0, y0: 1.4, sides: 8 });
        mb.at(0, 2.45, 3.0, () => mb.sphere(0.12, 8, 6));
      }, { mat: PAL.brass });
      // ox-head prow (a nod to the Wooden Ox)
      mb.with(null, () => {
        mb.box([0.9, 0.7, 0.6], [0, 1.55, 3.55], 0.08);
        for (const s of [-1, 1]) mb.tube([[s * 0.3, 1.85, 3.6], [s * 0.6, 2.05, 3.7], [s * 0.66, 2.3, 3.85]], (t) => 0.06 * (1 - t * 0.6), 6);
      }, { mat: PAL.bronze });
      mb.with(null, () => { for (const s of [-1, 1]) mb.at(s * 0.25, 1.62, 3.86, () => mb.sphere(0.07, 8, 6)); }, { mat: PAL.qi });
      // steam boiler + chimney at the stern
      mb.with(T(0, 1.4, -3.0), () => {
        mb.with(null, () => mb.with(T(0, 0.75, 0, [90, 0, 0]), () => mb.cylinder({ r: 0.7, h: 1.2, y0: -0.6, sides: 14 })), { mat: PAL.brass });
        mb.with(null, () => {
          mb.with(T(0, 0.75, 0, [90, 0, 0]), () => {
            mb.lathe([[0.72, -0.62], [0.74, -0.55], [0.72, -0.5]], 14);
            mb.lathe([[0.72, 0.5], [0.74, 0.55], [0.72, 0.62]], 14);
          });
          mb.cylinder({ r: 0.16, rTop: 0.14, h: 1.9, y0: 1.2, sides: 10, capTop: false });
          mb.at(0, 3.1, 0, () => mb.lathe([[0.14, 0], [0.26, 0.1], [0.28, 0.22], [0.2, 0.25]], 10));
        }, { mat: PAL.iron });
      });
      // lanterns and banners
      lantern(mb, [1.4, 2.4, 2.1], 0.16);
      lantern(mb, [-1.4, 2.4, 2.1], 0.16);
      bannerPole(mb, [1.2, 1.4, -2.7], 3.4, 0.7, 1.4, 0);
      bannerPole(mb, [-1.2, 1.4, -2.7], 3.4, 0.7, 1.4, 180);
    }, { joint: JI.body });

    // ---- wheels (spoked)
    WHEELS.forEach((w, i) => {
      mb.with(T(w[0], w[1], w[2], [0, 0, 90]), () => {
        mb.with(null, () => {
          mb.lathe([[0.78, -0.13], [0.8, -0.1], [0.8, 0.1], [0.78, 0.13], [0.66, 0.13], [0.66, -0.13]].map(([r, y]) => [r, y] as [number, number]), 18, { smooth: false });
          for (let k = 0; k < 8; k++) mb.with(T(0, 0, 0, [0, k * 22.5, 0]), () => mb.box([1.36, 0.06, 0.07], [0, 0, 0]));
        }, { mat: PAL.timberDark });
        mb.with(null, () => {
          mb.cylinder({ r: 0.2, h: 0.34, y0: -0.17, sides: 10 });
          mb.lathe([[0.81, -0.08], [0.83, 0], [0.81, 0.08]], 18);
        }, { mat: PAL.iron });
      }, { joint: JI[`wheel${i}`] });
    });

    // ---- folding pavilion side panels (drop open on deploy)
    for (const s of [1, -1]) {
      mb.with(null, () => {
        mb.with(null, () => mb.box([0.1, 1.0, 4.2], [s * 1.36, 2.0, -0.4], 0.02), { mat: PAL.lattice });
        mb.with(null, () => {
          for (let i = 0; i < 5; i++) mb.box([0.06, 0.7, 0.62], [s * 1.42, 2.02, -2.1 + i * 0.85]);
        }, { mat: PAL.paperWindow });
      }, { joint: s > 0 ? JI.panelL : JI.panelR });
    }

    // ---- canopy: the folded Yamen roof, with team tiles (rises on deploy)
    mb.with(null, () => {
      for (const [x, z] of [[1.15, 1.2], [-1.15, 1.2], [1.15, -2.0], [-1.15, -2.0]]) {
        mb.with(T(x, 0, z), () => mb.cylinder({ r: 0.09, h: 0.75, y0: 2.4, sides: 8 }), { mat: PAL.vermilion });
      }
      mb.with(null, () => mb.box([2.7, 0.22, 4.7], [0, 3.05, -0.4], 0.03), { mat: PAL.paintTeal });
      mb.with(null, () => mb.box([2.75, 0.05, 4.75], [0, 2.93, -0.4]), { mat: PAL.gold });
      mb.at(0, 0, -0.4, () => roof(mb, { w: 1.9, d: 2.85, h: 1.1, ridge: 0.9, y: 3.16, lift: 0.32, flare: 0.16, ridgeSize: 0.13, segs: [8, 5], gableT: 0 }));
    }, { joint: JI.canopy });
    // ---- flywheel on the boiler (spins while moving)
    mb.with(T(0, 2.2, -3.05, [90, 0, 0]), () => gear(mb, 0.45, 0.08, 14), { mat: PAL.bronze, joint: JI.flywheel });

    const e = (x: number, y = 0, z = 0) => quatEuler(x * DEG, y * DEG, z * DEG);
    const s = (p: number, k2 = 1) => Math.sin(p * Math.PI * 2 * k2);
    const spinWheels = (revs: number) => Object.fromEntries(WHEELS.map((_, i) => [`wheel${i}`, (p: number) => ({ r: quatAxisAngle([1, 0, 0], p * Math.PI * 2 * revs) })]));
    const anims: AnimDef[] = [
      {
        name: 'idle', duration: 3, fps: 20, tracks: {
          body: (p) => ({ r: e(s(p) * 0.4, 0, 0), t: [0, s(p, 2) * 0.01, 0] }),
          flywheel: (p) => ({ r: quatAxisAngle([0, 1, 0], p * Math.PI * 2) }),
        },
      },
      {
        name: 'walk', duration: 2.1, fps: 30, tracks: {
          ...spinWheels(1),
          body: (p) => ({ r: e(s(p, 2) * 0.8, 0, s(p) * 1.2), t: [0, Math.abs(s(p, 3)) * 0.03, 0] }),
          flywheel: (p) => ({ r: quatAxisAngle([0, 1, 0], p * Math.PI * 6) }),
        },
      },
      {
        name: 'deploy', duration: 1.6, fps: 30, tracks: {
          panelL: (p) => ({ r: e(0, 0, -Math.min(1, p * 1.6) * 95) }),
          panelR: (p) => ({ r: e(0, 0, Math.min(1, p * 1.6) * 95) }),
          canopy: (p) => ({ t: [0, Math.max(0, p - 0.3) / 0.7 * 1.6, 0] }),
          flywheel: (p) => ({ r: quatAxisAngle([0, 1, 0], p * Math.PI * 8) }),
          body: (p) => ({ t: [0, -Math.min(1, p * 2) * 0.12, 0] }),
        },
      },
    ];
    return { mesh: mb, skeleton: SK, animations: anims, sockets: [{ name: 'smoke', pos: [0, 4.6, -3.0], joint: 'body' }], ao: { maxDist: 1.4 } };
  },
};
