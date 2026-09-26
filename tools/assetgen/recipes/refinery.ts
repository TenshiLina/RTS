// 玉坊 Jade Refinery — Wooden Oxen unload raw spirit-jade into the hopper; a steam-driven
// grinding mill and alchemical kiln refine it into currency. 4×3 cells (12 × 9 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, colonnade, latticePanel, lantern, bannerPole, platform } from '../kit/roof';
import type { Recipe } from '../recipe';
import { barrel, crate, orePile } from './props';
import { gear } from './props2';
import { quatAxisAngle, V3 } from '../../../src/core/math';

export const refinery: Recipe = {
  id: 'azure_jade_refinery',
  name: 'Jade Refinery',
  hanzi: '玉坊',
  category: 'structure',
  footprint: [4, 3],
  build() {
    const mb = new MeshBuilder('azure_jade_refinery');
    const Wt = 11.6, Dt = 8.6;
    mb.with(null, () => mb.box([Wt, 0.12, Dt], [0, 0.06, 0], 0.03), { mat: PAL.stoneDark });

    // ---- main workshop hall (left)
    const hx = -2.2, hz = -1.2, hw = 6.2, hd = 4.6, hh = 2.8;
    mb.at(hx, 0, hz, () => {
      platform(mb, hw + 0.4, hd + 0.4, 0.4, { stairs: false });
      colonnade(mb, hw, hd, 0.4, hh, 4, 3, 0.18);
      mb.with(null, () => mb.box([hw - 0.25, hh, hd - 0.25], [0, 0.4 + hh / 2, 0]), { mat: PAL.plaster });
      mb.with(null, () => mb.box([hw - 0.15, 0.7, hd - 0.15], [0, 0.4 + 0.35, 0]), { mat: PAL.brick });
      // big front doors (open, glowing interior)
      mb.with(null, () => mb.box([2.0, 2.2, 0.05], [0, 0.4 + 1.1, hd / 2 - 0.1]), { mat: { ...PAL.jade, name: 'interior_glow', emissive: 0.5, color: 0x6fd6a0 } });
      mb.with(null, () => {
        mb.box([0.12, 2.3, 0.14], [-1.06, 0.4 + 1.15, hd / 2 - 0.08]);
        mb.box([0.12, 2.3, 0.14], [1.06, 0.4 + 1.15, hd / 2 - 0.08]);
        mb.box([2.24, 0.14, 0.14], [0, 0.4 + 2.3, hd / 2 - 0.08]);
      }, { mat: PAL.timberDark });
      latticePanel(mb, 1.2, 1.0, [-2.1, 0.4 + 1.7, hd / 2 - 0.1], { cols: 4, rows: 3 });
      latticePanel(mb, 1.2, 1.0, [2.1, 0.4 + 1.7, hd / 2 - 0.1], { cols: 4, rows: 3 });
      mb.with(null, () => mb.box([hw + 0.2, 0.3, hd + 0.2], [0, 0.4 + hh + 0.15, 0], 0.03), { mat: PAL.paintTeal });
      roof(mb, { w: hw / 2 + 0.95, d: hd / 2 + 0.9, h: 2.1, ridge: hw / 2 - 0.6, y: 0.4 + hh + 0.3, gableT: 0.42, lift: 0.4, flare: 0.22, ridgeSize: 0.18, segs: [14, 6] });
      mb.with(null, () => mb.box([1.6, 0.5, 0.06], [0, 0.4 + hh - 0.1, hd / 2 + 0.03], 0.02), { mat: PAL.plaque });
    });

    // ---- alchemical kiln / furnace tower (right-back)
    const kx = 3.6, kz = -2.2;
    mb.at(kx, 0.12, kz, () => {
      mb.with(null, () => {
        mb.lathe([[1.55, 0], [1.5, 0.6], [1.35, 2.6], [1.1, 3.4], [0.55, 4.1], [0.42, 4.2]], 14, { capBottom: true });
        mb.cylinder({ r: 0.42, rTop: 0.36, h: 1.8, y0: 4.2, sides: 10, capTop: false });
      }, { mat: PAL.brick });
      mb.with(null, () => {
        mb.lathe([[1.58, 0.55], [1.6, 0.65], [1.6, 0.8], [1.52, 0.85]], 14);
        mb.lathe([[1.4, 2.4], [1.44, 2.5], [1.42, 2.65], [1.34, 2.7]], 14);
        mb.lathe([[0.4, 5.9], [0.5, 6.0], [0.48, 6.15], [0.38, 6.2]], 10);
      }, { mat: PAL.bronze });
      // glowing firebox mouth
      mb.with(null, () => mb.box([0.9, 0.7, 0.2], [0, 0.65, 1.45]), { mat: PAL.fire });
      mb.with(null, () => {
        mb.box([1.2, 0.12, 0.3], [0, 1.06, 1.45]);
        mb.box([0.14, 0.9, 0.3], [-0.52, 0.65, 1.45]);
        mb.box([0.14, 0.9, 0.3], [0.52, 0.65, 1.45]);
      }, { mat: PAL.iron });
      // copper pipes to the hall
      mb.with(null, () => {
        mb.tube([[-1.2, 2.0, 0.6], [-2.2, 2.2, 0.8], [-3.0, 2.6, 0.9]], 0.12, 8);
        mb.tube([[-1.3, 1.1, -0.3], [-2.4, 1.1, -0.5], [-3.0, 1.4, -0.5]], 0.1, 8);
      }, { mat: PAL.brass });
    });

    // ---- grinding mill (animated joint 1) with bronze gearing, front-right
    const mx = 3.4, mz = 2.3;
    mb.at(mx, 0.12, mz, () => {
      // basin
      mb.with(null, () => mb.lathe([[1.3, 0], [1.35, 0.5], [1.2, 0.55], [1.15, 0.3], [0.001, 0.3]], 16), { mat: PAL.stone });
      mb.with(null, () => mb.cylinder({ r: 1.15, h: 0.04, y0: 0.3, sides: 16 }), { mat: PAL.jadeDeep });
      // gear housing post
      mb.with(null, () => {
        mb.box([0.4, 2.2, 0.4], [0, 1.1, 0], 0.04);
        mb.box([2.6, 0.24, 0.3], [0, 2.1, 0], 0.03);
      }, { mat: PAL.timberDark });
    });
    // rotating parts
    mb.with(T(mx, 0.12, mz), () => {
      // edge-runner millstone rolling around the basin (axis radial)
      mb.with(T(0.7, 0.8, 0, [0, 0, 90]), () => mb.cylinder({ r: 0.5, h: 0.32, y0: -0.16, sides: 18 }), { mat: PAL.stone });
      mb.with(null, () => mb.box([1.6, 0.1, 0.1], [0.4, 0.8, 0]), { mat: PAL.iron });
      mb.with(T(0, 1.75, 0), () => gear(mb, 0.55, 0.12, 14), { mat: PAL.bronze });
    }, { joint: 1 });
    // fixed secondary gear meshing with the main one (driven)
    mb.with(T(mx + 1.02, 0.12 + 1.75, mz, [0, 0, 0]), () => gear(mb, 0.42, 0.12, 11), { mat: PAL.brass, joint: 2 });

    // ---- unloading hopper & ramp where Wooden Oxen dock (front-left)
    const dx = -3.6, dz = 2.6;
    mb.at(dx, 0.12, dz, () => {
      mb.with(null, () => {
        for (const [x, z] of [[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]]) mb.box([0.16, 1.5, 0.16], [x, 0.75, z]);
        mb.box([1.9, 0.12, 1.5], [0, 1.5, 0]);
      }, { mat: PAL.timberDark });
      // funnel
      mb.with(null, () => mb.lathe([[0.25, 1.5], [0.3, 1.6], [1.05, 2.4], [1.1, 2.5]], 4, { smooth: false, phase: Math.PI / 4 }), { mat: PAL.timber });
      mb.with(null, () => mb.lathe([[1.0, 2.35], [0.001, 2.25]], 4, { smooth: false, phase: Math.PI / 4 }), { mat: PAL.jade });
      mb.at(0, 0, 0, () => orePile(mb, 0.7, 3));
    });
    // ramp
    mb.with(null, () => mb.quad([dx - 1, 0.13, dz + 2.9], [dx + 1, 0.13, dz + 2.9], [dx + 1, 0.55, dz + 1.3], [dx - 1, 0.55, dz + 1.3]), { mat: PAL.timber });

    // storage clutter
    mb.at(0.6, 0.12, 3.0, () => crate(mb, 0.7));
    mb.at(1.1, 0.12, 3.6, () => crate(mb, 0.55), [0, 25, 0]);
    mb.at(0.7, 0.82, 3.0, () => crate(mb, 0.5), [0, 10, 0]);
    mb.at(-0.6, 0.12, 3.6, () => barrel(mb, 0.8));
    mb.at(1.3, 0.12, -4.0 + 0.6, () => barrel(mb, 0.75));
    lantern(mb, [dx + 0.9, 1.5, dz + 0.7], 0.16);
    bannerPole(mb, [5.4, 0.12, 3.9], 4.4, 0.8, 1.8, 180);
    bannerPole(mb, [-5.4, 0.12, -3.9], 4.4, 0.8, 1.8, 0);

    const spin = (speed: number, axisY = true) => (p: number) => ({ r: quatAxisAngle(axisY ? [0, 1, 0] : [0, 0, 1], p * Math.PI * 2 * speed) });
    return {
      mesh: mb,
      skeleton: [
        { name: 'root', parent: -1, pos: [0, 0, 0] },
        { name: 'mill', parent: 0, pos: [mx, 0.12, mz] as V3 },
        { name: 'gear2', parent: 0, pos: [mx + 1.02, 0.12 + 1.75, mz] as V3 },
      ],
      animations: [{ name: 'idle', duration: 6, fps: 20, tracks: { mill: spin(1), gear2: spin(-14 / 11) } }],
      sockets: [
        { name: 'dock', pos: [dx, 0, dz + 3.4] },
        { name: 'smoke', pos: [kx, 6.4, kz] },
      ],
      ao: { maxDist: 2.2 },
    };
  },
};
