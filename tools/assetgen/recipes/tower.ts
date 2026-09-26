// 箭楼 Arrow Tower — base defence. Brick keep with a timber fighting gallery and a small hip
// roof. Garrisoned archers fire from the gallery. 1×1 cell (3 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, lantern, bannerPole } from '../kit/roof';
import type { Recipe } from '../recipe';
import { wallCap } from './props2';

export const arrowTower: Recipe = {
  id: 'azure_arrow_tower',
  name: 'Arrow Tower',
  hanzi: '箭楼',
  category: 'structure',
  footprint: [1, 1],
  build() {
    const mb = new MeshBuilder('azure_arrow_tower');
    // tapered brick keep
    mb.with(null, () => mb.lathe([[1.62, 0], [1.55, 0.3], [1.3, 3.6], [1.32, 3.75]], 4, { smooth: false, phase: Math.PI / 4, capTop: true, capBottom: true }), { mat: PAL.brick });
    mb.with(null, () => mb.lathe([[1.66, 0], [1.66, 0.45], [1.58, 0.5]], 4, { smooth: false, phase: Math.PI / 4 }), { mat: PAL.stone });
    // door + arrow slits
    mb.with(null, () => {
      mb.box([0.8, 1.5, 0.08], [0, 0.75 + 0.1, 1.14]);
      for (const y of [2.3]) for (const [x, z, r] of [[0, 1.0, 0], [1.0, 0, 90], [-1.0, 0, 90], [0, -1.0, 0]] as [number, number, number][]) {
        mb.with(T(x * 1.02, y, z * 1.02, [0, r, 0]), () => mb.box([0.14, 0.6, 0.06], [0, 0, 0]));
      }
    }, { mat: PAL.lacquerDark });
    mb.with(null, () => {
      mb.box([1.0, 0.12, 0.14], [0, 1.72, 1.14]);
      mb.box([0.12, 1.7, 0.14], [-0.46, 0.85, 1.14]);
      mb.box([0.12, 1.7, 0.14], [0.46, 0.85, 1.14]);
    }, { mat: PAL.stone });
    // timber gallery floor
    const gy = 3.75;
    mb.with(null, () => {
      mb.box([3.3, 0.22, 3.3], [0, gy + 0.11, 0], 0.04);
      // corbel brackets
      for (const [x, z, r] of [[0, 1.3, 0], [0, -1.3, 180], [1.3, 0, 90], [-1.3, 0, -90]] as [number, number, number][]) {
        for (const o of [-0.8, 0, 0.8]) mb.with(T(x + (r % 180 === 0 ? o : 0), gy - 0.3, z + (r % 180 !== 0 ? o : 0), [0, r, 0]), () => mb.box([0.14, 0.4, 0.5], [0, 0, 0.1], 0.02));
      }
    }, { mat: PAL.timberDark });
    // gallery posts + railing with shields
    const gp = 1.5;
    mb.with(null, () => {
      for (const [x, z] of [[gp, gp], [-gp, gp], [gp, -gp], [-gp, -gp]]) mb.box([0.18, 1.9, 0.18], [x, gy + 1.17, z], 0.02);
      for (const [a, b] of [[[-gp, gp], [gp, gp]], [[-gp, -gp], [gp, -gp]], [[gp, -gp], [gp, gp]], [[-gp, -gp], [-gp, gp]]] as [number[], number[]][]) {
        const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        const along = a[0] === b[0] ? 'z' : 'x';
        mb.box(along === 'x' ? [2 * gp, 0.1, 0.1] : [0.1, 0.1, 2 * gp], [cx, gy + 1.1, cz]);
      }
    }, { mat: PAL.vermilion });
    // wooden shield parapet (team-painted)
    mb.with(null, () => {
      for (const side of [0, 1, 2, 3]) {
        mb.with(T(0, 0, 0, [0, side * 90, 0]), () => {
          for (let i = -1; i <= 1; i++) mb.box([0.8, 0.75, 0.07], [i * 0.95, gy + 0.6, gp + 0.02], 0.02);
        });
      }
    }, { mat: { ...PAL.clothTeam, name: 'shield_team', pattern: 1, roughness: 0.7, doubleSided: false } });
    mb.with(null, () => {
      for (const side of [0, 1, 2, 3]) {
        mb.with(T(0, 0, 0, [0, side * 90, 0]), () => {
          for (let i = -1; i <= 1; i++) mb.box([0.3, 0.3, 0.02], [i * 0.95, gy + 0.62, gp + 0.07]);
        });
      }
    }, { mat: PAL.gold });
    // bracket beam + roof
    mb.with(null, () => mb.box([3.4, 0.26, 3.4], [0, gy + 2.2, 0], 0.03), { mat: PAL.paintTeal });
    mb.with(null, () => mb.box([3.45, 0.06, 3.45], [0, gy + 2.07, 0]), { mat: PAL.gold });
    roof(mb, { w: 2.35, d: 2.35, h: 1.55, ridge: 0.45, y: gy + 2.33, lift: 0.45, flare: 0.25, ridgeSize: 0.14, segs: [10, 6] });
    lantern(mb, [1.55, gy + 2.05, 1.55], 0.15);
    lantern(mb, [-1.55, gy + 2.05, 1.55], 0.15);
    bannerPole(mb, [-1.5, gy + 0.22, -1.5], 3.9, 0.6, 1.3, 0);
    return {
      mesh: mb,
      sockets: [
        { name: 'muzzle', pos: [0, gy + 1.3, 1.4] },
        { name: 'garrison', pos: [0, gy + 0.25, 0] },
      ],
      ao: { maxDist: 1.8 },
    };
  },
};

// 夯土城墙 rammed-earth wall segment along X, 1 cell long.
export const wall: Recipe = {
  id: 'azure_wall',
  name: 'Rammed-Earth Wall',
  hanzi: '城墙',
  category: 'structure',
  footprint: [1, 1],
  build() {
    const mb = new MeshBuilder('azure_wall');
    const L = 3.02, H = 2.6, Tk = 1.1;
    mb.with(null, () => mb.lathe([[Tk * 0.62, 0], [Tk * 0.5, H]], 4, { smooth: false, phase: Math.PI / 4 }), { mat: PAL.rammedEarth });
    // rammed body: slightly battered prism along X
    mb.with(null, () => {
      mb.quad([-L / 2, 0.5, Tk / 2 + 0.06], [L / 2, 0.5, Tk / 2 + 0.06], [L / 2, H, Tk / 2 - 0.1], [-L / 2, H, Tk / 2 - 0.1]);
      mb.quad([L / 2, 0.5, -Tk / 2 - 0.06], [-L / 2, 0.5, -Tk / 2 - 0.06], [-L / 2, H, -Tk / 2 + 0.1], [L / 2, H, -Tk / 2 + 0.1]);
      mb.box([L, 0.05, Tk - 0.2], [0, H, 0]);
      // ramming layer lines
      for (let y = 0.9; y < H; y += 0.42) {
        const t = (y - 0.5) / (H - 0.5);
        const z = Tk / 2 + 0.06 - t * 0.16;
        mb.box([L, 0.03, 0.02], [0, y, z + 0.005]);
        mb.box([L, 0.03, 0.02], [0, y, -z - 0.005]);
      }
    }, { mat: PAL.rammedEarth });
    mb.with(null, () => mb.box([L, 0.5, Tk + 0.2], [0, 0.25, 0], 0.03), { mat: PAL.stoneDark });
    wallCap(mb, L, H, Tk - 0.2);
    // crenellations (垛口)
    mb.with(null, () => {
      for (const x of [-0.75, 0.75]) mb.box([0.9, 0.55, 0.28], [x, H + 0.58, Tk / 2 - 0.18], 0.03);
    }, { mat: PAL.brick });
    return { mesh: mb, ao: { maxDist: 1.5 } };
  },
};
