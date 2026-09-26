// More shared props: guardian lions, incense burner, drum, balustrades, walls.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { V3 } from '../../../src/core/math';

/** 石狮 guardian lion on a plinth, facing +Z. `s` ≈ total height. */
export function stoneLion(mb: MeshBuilder, s: number) {
  const k = s / 1.0;
  mb.with(null, () => {
    // plinth
    mb.box([0.5 * k, 0.28 * k, 0.62 * k], [0, 0.14 * k, 0], 0.03);
    mb.box([0.56 * k, 0.05 * k, 0.68 * k], [0, 0.3 * k, 0], 0.01);
    // seated body
    mb.at(0, 0.33 * k, -0.06 * k, () => {
      mb.blob(0.2 * k, 1, { squash: [1, 1.25, 1.15] });
      // front legs
      for (const sx of [-1, 1]) mb.tube([[sx * 0.1 * k, 0.28 * k, 0.12 * k], [sx * 0.11 * k, 0.0, 0.17 * k]], 0.055 * k, 6);
      // head with curly mane
      mb.at(0, 0.44 * k, 0.1 * k, () => {
        mb.blob(0.17 * k, 1, { squash: [1.1, 1, 1] });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          mb.at(Math.cos(a) * 0.14 * k, Math.sin(a) * 0.12 * k + 0.02 * k, -0.06 * k, () => mb.sphere(0.06 * k, 6, 4));
        }
        mb.at(0, -0.03 * k, 0.14 * k, () => mb.blob(0.08 * k, 1, { squash: [1.3, 0.8, 0.9] })); // muzzle
      });
      // paw on ball
      mb.at(0.13 * k, 0.05 * k, 0.26 * k, () => mb.sphere(0.07 * k, 8, 6));
    });
  }, { mat: PAL.stone });
}

/** Bronze incense burner (香炉) on legs. */
export function incenseBurner(mb: MeshBuilder, s: number) {
  mb.with(null, () => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      mb.tube([[Math.sin(a) * 0.32 * s, 0, Math.cos(a) * 0.32 * s], [Math.sin(a) * 0.26 * s, 0.35 * s, Math.cos(a) * 0.26 * s]], 0.05 * s, 5);
    }
    mb.at(0, 0.3 * s, 0, () => {
      mb.lathe([[0.001, 0], [0.35 * s, 0.05 * s], [0.45 * s, 0.25 * s], [0.42 * s, 0.45 * s], [0.47 * s, 0.5 * s], [0.4 * s, 0.52 * s]], 12);
      // pagoda lid
      mb.lathe([[0.4 * s, 0.52 * s], [0.3 * s, 0.7 * s], [0.12 * s, 0.8 * s], [0.14 * s, 0.9 * s], [0.001, 1.05 * s]], 6, { smooth: false });
    });
  }, { mat: PAL.bronze });
  mb.with(null, () => mb.cylinder({ r: 0.3 * s, h: 0.01, y0: 0.81 * s, sides: 10 }), { mat: PAL.fire });
}

/** 鸣冤鼓 petition drum on a timber frame. */
export function petitionDrum(mb: MeshBuilder, s: number) {
  mb.with(null, () => {
    for (const sx of [-1, 1]) {
      mb.box([0.12 * s, 1.9 * s, 0.12 * s], [sx * 0.7 * s, 0.95 * s, 0], 0.02);
      mb.box([0.4 * s, 0.1 * s, 0.4 * s], [sx * 0.7 * s, 0.05 * s, 0], 0.02);
    }
    mb.box([1.6 * s, 0.12 * s, 0.14 * s], [0, 1.9 * s, 0], 0.02);
  }, { mat: PAL.vermilion });
  mb.with(T(0, 1.2 * s, 0, [90, 0, 0]), () => {
    mb.with(null, () => mb.lathe([[0.48 * s, -0.3 * s], [0.56 * s, 0], [0.48 * s, 0.3 * s]], 16, { capTop: false, capBottom: false }), { mat: PAL.vermilion });
    mb.with(null, () => {
      mb.cylinder({ r: 0.47 * s, h: 0.01, y0: 0.29 * s, sides: 16, capBottom: false });
      mb.with(T(0, 0, 0, [180, 0, 0]), () => mb.cylinder({ r: 0.47 * s, h: 0.01, y0: 0.29 * s, sides: 16, capBottom: false }));
    }, { mat: PAL.straw });
  });
  mb.with(null, () => {
    mb.box([0.08 * s, 0.9 * s, 0.08 * s], [0.9 * s, 0.45 * s, 0.35 * s]);
  }, { mat: PAL.timberDark });
}

/** Marble balustrade around a w×d terrace at height y, gap of `gap` at the front centre. */
export function balustrade(mb: MeshBuilder, w: number, d: number, y: number, gap: number) {
  mb.with(null, () => {
    const post = (x: number, z: number) => {
      mb.box([0.14, 0.62, 0.14], [x, y + 0.31, z], 0.02);
      mb.at(x, y + 0.62, z, () => mb.sphere(0.08, 6, 4));
    };
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) post(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const ang = Math.atan2(x1 - x0, z1 - z0) * (180 / Math.PI);
      mb.with(T(cx, y, cz, [0, ang, 0]), () => {
        mb.box([0.08, 0.1, len], [0, 0.5, 0]);
        mb.box([0.1, 0.12, len], [0, 0.06, 0]);
        mb.box([0.05, 0.3, len], [0, 0.27, 0]);
      });
    };
    const hw = w / 2, hd = d / 2;
    run(-hw, -hd, hw, -hd);
    run(-hw, -hd, -hw, hd);
    run(hw, -hd, hw, hd);
    run(-hw, hd, -gap / 2, hd);
    run(gap / 2, hd, hw, hd);
  }, { mat: PAL.stone });
}

/** Tiled coping (wall cap) along X of length `len` at height y, width `w`. */
export function wallCap(mb: MeshBuilder, len: number, y: number, w: number, tile = PAL.roofTeam) {
  const hw = w / 2 + 0.18;
  mb.with(null, () => {
    // two slopes
    const rise = 0.28;
    mb.quad([-len / 2, y, hw], [len / 2, y, hw], [len / 2, y + rise, 0], [-len / 2, y + rise, 0], [[-len / 2, 0.45], [len / 2, 0.45], [len / 2, 0], [-len / 2, 0]]);
    mb.quad([len / 2, y, -hw], [-len / 2, y, -hw], [-len / 2, y + rise, 0], [len / 2, y + rise, 0], [[len / 2, 0.45], [-len / 2, 0.45], [-len / 2, 0], [len / 2, 0]]);
    // eave boards
    mb.box([len, 0.08, 0.06], [0, y - 0.04, hw]);
    mb.box([len, 0.08, 0.06], [0, y - 0.04, -hw]);
  }, { mat: tile });
  mb.with(null, () => mb.box([len + 0.02, 0.12, 0.16], [0, y + 0.3, 0], 0.03), { mat: PAL.ridge });
  mb.with(null, () => {
    mb.quad([-len / 2, y, hw], [-len / 2, y + 0.28, 0], [len / 2, y + 0.28, 0], [len / 2, y, hw]);
    mb.quad([len / 2, y, -hw], [len / 2, y + 0.28, 0], [-len / 2, y + 0.28, 0], [-len / 2, y, -hw]);
  }, { mat: PAL.roofUnder });
}

export function gear(mb: MeshBuilder, r: number, thick: number, teeth = 12) {
  const pts: [number, number][] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2;
    const rr = i % 4 < 2 ? r : r * 0.84;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  mb.extrude(pts, -thick / 2, thick / 2);
  mb.cylinder({ r: r * 0.25, h: thick * 1.6, y0: -thick * 0.8, sides: 8 });
}

export type { V3 };
