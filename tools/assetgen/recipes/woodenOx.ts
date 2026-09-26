// 木牛 Wooden Ox — clockwork harvester (after Zhuge Liang's legendary "wooden ox and gliding
// horse"). Walks to jade veins, grinds crystals with its jaw, carries them in panniers.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import type { JointDef, AnimDef } from '../kit/gltf';
import { gear } from './props2';
import { crystal } from './props';
import { quatEuler, DEG, quatAxisAngle, V3 } from '../../../src/core/math';

const SK: JointDef[] = [
  { name: 'root', parent: -1, pos: [0, 0, 0] },
  { name: 'body', parent: 0, pos: [0, 1.05, 0] },
  { name: 'head', parent: 1, pos: [0, 1.35, 1.0] },
  { name: 'legFL', parent: 1, pos: [0.36, 0.9, 0.72] },
  { name: 'shinFL', parent: 3, pos: [0.36, 0.48, 0.72] },
  { name: 'legFR', parent: 1, pos: [-0.36, 0.9, 0.72] },
  { name: 'shinFR', parent: 5, pos: [-0.36, 0.48, 0.72] },
  { name: 'legBL', parent: 1, pos: [0.36, 0.9, -0.72] },
  { name: 'shinBL', parent: 7, pos: [0.36, 0.48, -0.72] },
  { name: 'legBR', parent: 1, pos: [-0.36, 0.9, -0.72] },
  { name: 'shinBR', parent: 9, pos: [-0.36, 0.48, -0.72] },
  { name: 'gear', parent: 1, pos: [0.47, 1.15, 0.05] },
  { name: 'tail', parent: 1, pos: [0, 1.3, -1.02] },
];
const JI = Object.fromEntries(SK.map((j, i) => [j.name, i])) as Record<string, number>;

export const woodenOx: Recipe = {
  id: 'azure_wooden_ox',
  name: 'Wooden Ox',
  hanzi: '木牛',
  category: 'unit',
  build() {
    const mb = new MeshBuilder('azure_wooden_ox');
    // ---- body frame
    mb.with(null, () => {
      mb.with(null, () => mb.box([0.84, 0.62, 2.0], [0, 1.18, 0], 0.08), { mat: PAL.timber });
      // bronze strap bands
      mb.with(null, () => {
        for (const z of [-0.7, 0, 0.7]) mb.box([0.9, 0.66, 0.1], [0, 1.18, z], 0.02);
        mb.box([0.9, 0.08, 2.06], [0, 0.9, 0], 0.02);
      }, { mat: PAL.bronze });
      // rivets
      mb.with(null, () => {
        for (const z of [-0.7, 0, 0.7]) for (const y of [1.0, 1.36]) for (const s of [-1, 1]) mb.at(s * 0.455, y, z, () => mb.sphere(0.025, 5, 4));
      }, { mat: PAL.brass });
      // saddle-top hopper with glowing jade
      mb.with(null, () => mb.lathe([[0.36, 1.49], [0.46, 1.78], [0.48, 1.8]], 4, { smooth: false, phase: Math.PI / 4 }), { mat: PAL.timberDark });
      mb.with(null, () => mb.box([0.56, 0.04, 0.56], [0, 1.72, 0]), { mat: PAL.jadeDeep });
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9;
        mb.at(Math.cos(a) * 0.14, 1.72, Math.sin(a) * 0.14, () => crystal(mb, 0.07 + (i % 2) * 0.03, 0.22 + (i % 3) * 0.06), [8 * Math.cos(a), a * 40, 10 * Math.sin(a)]);
      }
      // panniers on both flanks
      for (const s of [-1, 1]) {
        mb.with(null, () => mb.box([0.2, 0.4, 0.8], [s * 0.54, 1.1, -0.35], 0.04), { mat: PAL.straw });
        mb.with(null, () => mb.box([0.16, 0.05, 0.7], [s * 0.54, 1.3, -0.35]), { mat: PAL.jade });
      }
      // brass steam stack at the rear
      mb.with(null, () => {
        mb.cylinder({ r: 0.07, rTop: 0.06, h: 0.5, y0: 1.45, sides: 8, capTop: false });
        mb.at(0, 1.95, 0, () => mb.lathe([[0.06, 0], [0.11, 0.06], [0.1, 0.1]], 8));
      }, { mat: PAL.brass });
      // hip/shoulder hubs
      for (const [x, z] of [[0.36, 0.72], [-0.36, 0.72], [0.36, -0.72], [-0.36, -0.72]]) mb.with(T(x * 1.2, 0.95, z, [0, 0, 90]), () => mb.cylinder({ r: 0.12, h: 0.1, y0: -0.05, sides: 10 }), { mat: PAL.bronze });
    }, { joint: JI.body });
    // move stack to the rear
    for (const t of mb.tris) if (t.joint === JI.body && mb.materials[t.mat].name === 'brass') for (const p of t.p) if (p[1] > 1.44 && Math.hypot(p[0], p[2]) < 0.15) p[2] -= 0.72;

    // ---- head
    mb.with(null, () => {
      mb.with(null, () => {
        mb.box([0.46, 0.42, 0.52], [0, 1.4, 1.2], 0.06);
        mb.box([0.36, 0.28, 0.3], [0, 1.28, 1.52], 0.05); // muzzle
      }, { mat: PAL.timber });
      mb.with(null, () => {
        mb.box([0.5, 0.06, 0.56], [0, 1.6, 1.2], 0.02);
        mb.box([0.4, 0.06, 0.06], [0, 1.18, 1.66], 0.02); // jaw plate
      }, { mat: PAL.bronze });
      // horns
      for (const s of [-1, 1]) {
        mb.with(null, () => mb.tube([[s * 0.2, 1.56, 1.12], [s * 0.36, 1.66, 1.1], [s * 0.44, 1.8, 1.18], [s * 0.4, 1.92, 1.28]], (t) => 0.05 * (1 - t * 0.7), 6), { mat: PAL.brass });
      }
      // glowing qi eyes
      mb.with(null, () => { for (const s of [-1, 1]) mb.at(s * 0.17, 1.46, 1.46, () => mb.sphere(0.05, 8, 6)); }, { mat: PAL.qi });
      // nose ring
      mb.with(null, () => mb.at(0, 1.22, 1.68, () => {
        const pts: V3[] = [];
        for (let i = 0; i <= 12; i++) pts.push([Math.cos((i / 12) * Math.PI * 2) * 0.06, Math.sin((i / 12) * Math.PI * 2) * 0.06 - 0.04, 0]);
        mb.tube(pts, 0.012, 4, { capStart: false, capEnd: false });
      }), { mat: PAL.gold });
    }, { joint: JI.head });
    // neck (on body)
    mb.with(null, () => mb.box([0.36, 0.34, 0.4], [0, 1.3, 0.95], 0.05), { mat: PAL.timberDark, joint: JI.body });

    // ---- legs
    const leg = (name: string, x: number, z: number) => {
      mb.with(null, () => {
        mb.with(null, () => mb.box([0.16, 0.46, 0.2], [x, 0.7, z], 0.04), { mat: PAL.timber });
        mb.with(null, () => mb.box([0.18, 0.06, 0.22], [x, 0.84, z]), { mat: PAL.bronze });
      }, { joint: JI[name] });
      mb.with(null, () => {
        mb.with(T(x, 0.48, z, [0, 0, 90]), () => mb.cylinder({ r: 0.07, h: 0.2, y0: -0.1, sides: 8 }), { mat: PAL.bronze });
        mb.with(null, () => mb.box([0.13, 0.4, 0.16], [x, 0.27, z], 0.03), { mat: PAL.timberDark });
        mb.with(null, () => mb.box([0.18, 0.08, 0.24], [x, 0.04, z + 0.02], 0.02), { mat: PAL.iron });
      }, { joint: JI['shin' + name.slice(3)] });
    };
    leg('legFL', 0.36, 0.72);
    leg('legFR', -0.36, 0.72);
    leg('legBL', 0.36, -0.72);
    leg('legBR', -0.36, -0.72);

    // ---- side gear (spins) + tail crank
    mb.with(T(0.49, 1.15, 0.05, [0, 0, 90]), () => gear(mb, 0.24, 0.05, 12), { mat: PAL.brass, joint: JI.gear });
    mb.with(null, () => mb.tube([[0, 1.3, -1.02], [0, 1.2, -1.2], [0, 0.95, -1.25]], 0.03, 5), { mat: PAL.iron, joint: JI.tail });
    mb.with(null, () => mb.at(0, 0.92, -1.25, () => mb.sphere(0.05, 6, 4)), { mat: PAL.clothRed, joint: JI.tail });

    const e = (x: number, y = 0, z = 0) => quatEuler(x * DEG, y * DEG, z * DEG);
    const s = (p: number, ph = 0) => Math.sin((p + ph) * Math.PI * 2);
    const legs = (p: number, amp: number) => ({
      legFL: (q: number) => ({ r: e(-s(q) * amp) }),
      legBR: (q: number) => ({ r: e(-s(q) * amp) }),
      legFR: (q: number) => ({ r: e(s(q) * amp) }),
      legBL: (q: number) => ({ r: e(s(q) * amp) }),
      shinFL: (q: number) => ({ r: e(Math.max(0, s(q, 0.25)) * amp * 1.3) }),
      shinBR: (q: number) => ({ r: e(Math.max(0, s(q, 0.25)) * amp * 1.3) }),
      shinFR: (q: number) => ({ r: e(Math.max(0, -s(q, 0.25)) * amp * 1.3) }),
      shinBL: (q: number) => ({ r: e(Math.max(0, -s(q, 0.25)) * amp * 1.3) }),
      _p: p,
    });
    const strip = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== '_p'));
    return {
      mesh: mb,
      skeleton: SK,
      animations: ([
        {
          name: 'idle', duration: 4, fps: 20, tracks: {
            head: (p) => ({ r: e(s(p) * 4, s(p, 0.3) * 10, 0) }),
            body: (p) => ({ r: e(0, 0, s(p) * 1), t: [0, s(p, 0.5) * 0.01, 0] }),
            gear: (p) => ({ r: quatAxisAngle([1, 0, 0], p * Math.PI * 2) }),
            tail: (p) => ({ r: e(0, s(p) * 15, 0) }),
          },
        },
        {
          name: 'walk', duration: 1.0, fps: 30, tracks: {
            ...strip(legs(0, 26)),
            body: (p) => ({ r: e(s(p, 0.25) * 2, 0, s(p) * 2.5), t: [0, Math.abs(s(p * 2)) * 0.04 - 0.02, 0] }),
            head: (p) => ({ r: e(s(p * 2) * 5, s(p) * 4, 0) }),
            gear: (p) => ({ r: quatAxisAngle([1, 0, 0], p * Math.PI * 4) }),
            tail: (p) => ({ r: e(s(p * 2) * 12, s(p) * 20, 0) }),
          },
        },
        {
          name: 'harvest', duration: 1.6, fps: 30, tracks: {
            head: (p) => {
              const peck = Math.max(0, s(p * 2)) ** 0.7;
              return { r: e(peck * 38, 0, 0) };
            },
            body: (p) => ({ r: e(Math.max(0, s(p * 2)) * 6, 0, 0), t: [0, -Math.max(0, s(p * 2)) * 0.05, 0] }),
            legFL: (p) => ({ r: e(-Math.max(0, s(p * 2)) * 10) }),
            legFR: (p) => ({ r: e(-Math.max(0, s(p * 2)) * 10) }),
            shinFL: (p) => ({ r: e(Math.max(0, s(p * 2)) * 18) }),
            shinFR: (p) => ({ r: e(Math.max(0, s(p * 2)) * 18) }),
            gear: (p) => ({ r: quatAxisAngle([1, 0, 0], p * Math.PI * 8) }),
            tail: (p) => ({ r: e(0, s(p * 4) * 25, 0) }),
          },
        },
      ] as AnimDef[]),
      sockets: [{ name: 'mouth', pos: [0, 1.2, 1.7], joint: 'head' }, { name: 'smoke', pos: [0, 2.0, -0.72], joint: 'body' }],
      ao: { maxDist: 0.9 },
    };
  },
};
