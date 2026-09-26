// 工坊 Artificer Workshop — the Azure Dynasty "war factory". A tall timber assembly hall with
// a stepped clerestory roof, a steam annex (boiler, chimney, spinning flywheel) and a gantry
// crane over the yard. Machines roll out through the great front bay. 4×4 cells (12 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, colonnade, latticePanel, lantern, bannerPole, platform } from '../kit/roof';
import type { Recipe } from '../recipe';
import type { AnimDef } from '../kit/gltf';
import { crate, barrel } from './props';
import { gear } from './props2';
import { quatAxisAngle, V3 } from '../../../src/core/math';

export const workshop: Recipe = {
  id: 'azure_workshop',
  name: 'Artificer Workshop',
  hanzi: '工坊',
  category: 'structure',
  footprint: [4, 4],
  build() {
    const mb = new MeshBuilder('azure_workshop');
    mb.with(null, () => mb.box([11.7, 0.1, 11.7], [0, 0.05, 0], 0.03), { mat: PAL.stoneDark });
    // cart ruts / apron in front of the bay
    mb.with(null, () => mb.box([4.4, 0.04, 3.4], [-0.6, 0.12, 4.1]), { mat: PAL.rammedEarth });

    // ---- assembly hall (tall, timber-framed)
    const hx = -0.6, hz = -0.9, hw = 7.6, hd = 6.4, hh = 4.4;
    mb.at(hx, 0, hz, () => {
      platform(mb, hw + 0.4, hd + 0.4, 0.3, { stairs: false });
      colonnade(mb, hw, hd, 0.3, hh, 5, 4, 0.2, { mat: PAL.timberDark });
      // timber-planked walls with a brick plinth
      mb.with(null, () => {
        mb.box([hw - 0.25, hh - 0.8, 0.22], [0, 0.3 + 0.8 + (hh - 0.8) / 2, -hd / 2 + 0.05]);
        for (const sx of [-1, 1]) mb.box([0.22, hh - 0.8, hd - 0.3], [sx * (hw / 2 - 0.05), 0.3 + 0.8 + (hh - 0.8) / 2, 0]);
      }, { mat: PAL.timber });
      mb.with(null, () => {
        mb.box([hw - 0.15, 0.8, 0.3], [0, 0.3 + 0.4, -hd / 2 + 0.05]);
        for (const sx of [-1, 1]) mb.box([0.3, 0.8, hd - 0.2], [sx * (hw / 2 - 0.05), 0.3 + 0.4, 0]);
      }, { mat: PAL.brick });
      // cross-bracing on the side walls (reads as "workshop", not "palace")
      mb.with(null, () => {
        for (const sx of [-1, 1]) for (const zc of [-1.5, 1.5]) {
          mb.with(T(sx * (hw / 2 + 0.08), 0.3 + 2.6, zc, [45, 0, 0]), () => mb.box([0.08, 2.4, 0.14], [0, 0, 0]));
          mb.with(T(sx * (hw / 2 + 0.08), 0.3 + 2.6, zc, [-45, 0, 0]), () => mb.box([0.08, 2.4, 0.14], [0, 0, 0]));
        }
      }, { mat: PAL.timberDark });
      // front: the great bay door (open) flanked by planked piers
      const bayW = 4.2;
      mb.with(null, () => {
        const pierW = (hw - bayW) / 2;
        for (const sx of [-1, 1]) mb.box([pierW - 0.2, hh - 0.2, 0.3], [sx * (bayW / 2 + pierW / 2), 0.3 + (hh - 0.2) / 2, hd / 2 - 0.1]);
        mb.box([bayW + 0.2, 0.9, 0.3], [0, 0.3 + hh - 0.45, hd / 2 - 0.1]);
      }, { mat: PAL.timber });
      // dark interior + half-built Wooden Ox on the assembly floor
      mb.with(null, () => mb.box([bayW, hh - 1.0, 0.04], [0, 0.3 + (hh - 1.0) / 2, -hd / 2 + 0.2]), { mat: { ...PAL.timberDark, name: 'interior_dark', color: 0x2a1c14 } });
      mb.with(T(0, 0.3, 0.2), () => {
        mb.with(null, () => mb.box([0.8, 0.6, 1.9], [0, 1.2, 0], 0.06), { mat: PAL.timber });
        mb.with(null, () => { for (const z of [-0.7, 0, 0.7]) mb.box([0.86, 0.64, 0.08], [0, 1.2, z], 0.02); }, { mat: PAL.bronze });
        mb.with(null, () => { for (const [x, z] of [[0.3, 0.7], [-0.3, 0.7], [0.3, -0.7]]) mb.box([0.14, 0.9, 0.18], [x, 0.45, z], 0.03); }, { mat: PAL.timberDark });
        // scaffold trestles
        mb.with(null, () => { for (const z of [-1.2, 1.2]) { mb.box([1.6, 0.08, 0.1], [0, 0.95, z]); for (const x of [-0.75, 0.75]) mb.box([0.08, 0.95, 0.08], [x, 0.475, z]); } }, { mat: PAL.timberDark });
      });
      // hanging lamps inside the bay glow warmly
      mb.with(null, () => { for (const x of [-1.2, 1.2]) mb.at(x, 0.3 + hh - 1.3, 0.6, () => mb.sphere(0.14, 8, 6)); }, { mat: { ...PAL.lanternRed, name: 'lamp_amber', color: 0xffb04a, emissive: 2.2 } });
      // upper clerestory windows
      for (let i = 0; i < 3; i++) latticePanel(mb, 1.4, 0.7, [-2.4 + i * 2.4, 0.3 + hh - 0.45, hd / 2 + 0.07], { cols: 6, rows: 2 });
      // gear emblem over the bay (spins, joint 1)
      mb.with(null, () => mb.box([hw + 0.25, 0.3, hd + 0.25], [0, 0.3 + hh + 0.15, 0], 0.03), { mat: PAL.paintTeal });
      mb.with(null, () => mb.box([hw + 0.3, 0.06, hd + 0.3], [0, 0.3 + hh + 0.01, 0]), { mat: PAL.gold });
      // stepped roof: lower hip-gable + raised clerestory ridge roof (气楼)
      roof(mb, { w: hw / 2 + 0.9, d: hd / 2 + 0.9, h: 2.4, ridge: hw / 2 - 0.3, y: 0.3 + hh + 0.3, gableT: 0.35, lift: 0.4, flare: 0.22, ridgeSize: 0.18, segs: [16, 7], tStart: 0.35 });
      const cy = 0.3 + hh + 0.3 + 2.4 * ((1 - 0.5) * 0.65 + 0.5 * 0.65 * 0.65) - 0.05;
      mb.with(null, () => mb.box([hw - 2.4, 0.9, 1.6], [0, cy + 0.45, 0], 0.03), { mat: PAL.timberDark });
      mb.with(null, () => { for (let i = 0; i < 5; i++) mb.box([0.6, 0.5, 1.62], [-(hw - 3.2) / 2 + i * ((hw - 3.2) / 4), cy + 0.45, 0]); }, { mat: { ...PAL.paperWindow, name: 'clerestory_glow', emissive: 0.4 } });
      roof(mb, { w: (hw - 2.4) / 2 + 0.6, d: 1.5, h: 1.0, ridge: (hw - 2.4) / 2, y: cy + 0.9, gableT: 1, lift: 0.1, flare: 0.05, ridgeSize: 0.14, segs: [10, 4], ornaments: false });
    });
    // gear emblem (spins)
    mb.with(T(hx, 0.3 + 4.4 - 0.35 + 0.02, hz + 6.4 / 2 + 0.12, [90, 0, 0]), () => gear(mb, 0.42, 0.08, 12), { mat: PAL.brass, joint: 1 });

    // ---- steam annex (east): boiler, chimney, flywheel
    const ax = 4.6, az = -2.6;
    mb.at(ax, 0.1, az, () => {
      mb.with(null, () => mb.box([2.4, 2.2, 3.2], [0, 1.1, 0], 0.05), { mat: PAL.brick });
      mb.with(null, () => mb.box([2.6, 0.2, 3.4], [0, 2.3, 0], 0.03), { mat: PAL.stone });
      // horizontal boiler drum on top
      mb.with(T(0, 3.05, 0, [90, 0, 0]), () => {
        mb.with(null, () => mb.cylinder({ r: 0.75, h: 2.9, y0: -1.45, sides: 16 }), { mat: PAL.brass });
        mb.with(null, () => { for (const y of [-1.2, 0, 1.2]) mb.lathe([[0.76, y - 0.07], [0.79, y], [0.76, y + 0.07]], 16); }, { mat: PAL.iron });
      });
      // tall chimney
      mb.with(null, () => {
        mb.at(0.5, 2.4, -1.0, () => {
          mb.lathe([[0.45, 0], [0.4, 0.4], [0.34, 4.6], [0.42, 4.75], [0.42, 5.0], [0.3, 5.05]], 12, { capBottom: false });
        });
      }, { mat: PAL.brick });
      mb.with(null, () => mb.at(0.5, 7.2, -1.0, () => mb.lathe([[0.43, 0], [0.47, 0.05], [0.44, 0.12]], 12)), { mat: PAL.iron });
      // firebox glow
      mb.with(null, () => mb.box([0.8, 0.55, 0.05], [0, 0.55, 1.63]), { mat: PAL.fire });
      // pipes to the hall
      mb.with(null, () => mb.tube([[-0.8, 3.4, 0.6], [-1.4, 3.8, 0.8], [-1.95, 3.9, 1.2]], 0.1, 8), { mat: PAL.brass });
    });
    // flywheel on the annex's south face (joint 2) + drive belt post
    const fw: V3 = [ax + 1.35, 1.7, az + 0.4];
    mb.with(T(fw[0], fw[1], fw[2], [0, 0, 90]), () => {
      mb.with(null, () => {
        mb.lathe([[1.15, -0.1], [1.2, -0.08], [1.2, 0.08], [1.15, 0.1], [1.0, 0.1], [1.0, -0.1]].map(([r, y]) => [r, y] as [number, number]), 22, { smooth: false });
        for (let k = 0; k < 6; k++) mb.with(T(0, 0, 0, [0, k * 30, 0]), () => mb.box([2.0, 0.05, 0.12], [0, 0, 0]));
      }, { mat: PAL.iron });
      mb.with(null, () => mb.cylinder({ r: 0.2, h: 0.36, y0: -0.18, sides: 10 }), { mat: PAL.bronze });
    }, { joint: 2 });
    mb.with(null, () => mb.box([0.3, 1.75, 0.3], [fw[0] + 0.3, 0.95, fw[2]], 0.03), { mat: PAL.timberDark });

    // ---- gantry crane over the side yard (west)
    const gx = -5.1;
    mb.with(null, () => {
      for (const z of [-3.2, 2.6]) {
        mb.box([0.28, 5.4, 0.28], [gx, 2.7, z], 0.03);
        mb.tube([[gx, 0.1, z - 0.9], [gx, 3.6, z]], 0.08, 6);
      }
      mb.box([0.4, 0.4, 6.4], [gx, 5.5, -0.3], 0.04);
    }, { mat: PAL.timberDark });
    mb.with(null, () => {
      mb.box([0.7, 0.3, 0.6], [gx, 5.2, 0.9], 0.03);
      mb.tube([[gx, 5.05, 0.9], [gx, 3.2, 0.9]], 0.02, 4);
    }, { mat: PAL.iron });
    mb.with(null, () => {
      mb.box([0.9, 0.7, 0.9], [gx, 2.8, 0.9], 0.04);
      mb.box([0.96, 0.08, 0.96], [gx, 3.1, 0.9]);
    }, { mat: PAL.bronze });
    // parts stacked in the yard
    mb.at(gx + 0.1, 0.1, -2.0, () => crate(mb, 0.8));
    mb.at(gx + 0.2, 0.9, -2.0, () => crate(mb, 0.6), [0, 20, 0]);
    mb.at(gx - 0.1, 0.1, -1.0, () => barrel(mb, 0.8));
    mb.with(null, () => { for (let i = 0; i < 4; i++) mb.box([0.2, 0.2, 2.6], [gx + 0.35 + (i % 2) * 0.22, 0.2 + Math.floor(i / 2) * 0.2, 2.3]); }, { mat: PAL.timber });
    mb.at(gx + 0.4, 0.1, 4.6, () => mb.with(T(0, 0.5, 0, [90, 0, 0]), () => gear(mb, 0.5, 0.12, 12), { mat: PAL.bronze }), [0, 30, 0]);
    lantern(mb, [hx - 2.3, 4.2, hz + 3.45], 0.18);
    lantern(mb, [hx + 2.3, 4.2, hz + 3.45], 0.18);
    bannerPole(mb, [5.4, 0.1, 5.2], 4.6, 0.8, 1.9, 180);
    bannerPole(mb, [-5.5, 0.1, 5.2], 4.6, 0.8, 1.9, 0);

    const spin = (axis: V3, rev: number) => (p: number) => ({ r: quatAxisAngle(axis, p * Math.PI * 2 * rev) });
    const anims: AnimDef[] = [{ name: 'idle', duration: 4, fps: 20, tracks: { gearEmblem: spin([0, 1, 0], 1), flywheel: spin([0, 1, 0], 3) } }];
    return {
      mesh: mb,
      skeleton: [
        { name: 'root', parent: -1, pos: [0, 0, 0] },
        { name: 'gearEmblem', parent: 0, pos: [hx, 0.3 + 4.4 - 0.35 + 0.02, hz + 6.4 / 2 + 0.12] },
        { name: 'flywheel', parent: 0, pos: fw },
      ],
      animations: anims,
      sockets: [
        { name: 'exit', pos: [hx, 0, 6.2] },
        { name: 'rally', pos: [hx, 0, 8.5] },
        { name: 'smoke', pos: [ax + 0.5, 7.5, az - 1.0] },
      ],
      ao: { maxDist: 2.4 },
    };
  },
};
