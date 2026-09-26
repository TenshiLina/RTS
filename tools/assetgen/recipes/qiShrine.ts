// 风水坛 Qi Shrine — the Azure Dynasty's "power plant". Geomancers channel ley-line Qi into a
// floating orb above a bronze ding cauldron. 2×2 cells (6 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, platform, colonnade, bracketBand, lantern, bannerPole } from '../kit/roof';
import { quatEuler, V3 } from '../../../src/core/math';
import type { Recipe } from '../recipe';
import { ding, taiji, talismanStrip, stoneLantern } from './props';

export const qiShrine: Recipe = {
  id: 'azure_qi_shrine',
  name: 'Qi Shrine',
  hanzi: '风水坛',
  category: 'structure',
  footprint: [2, 2],
  build() {
    const mb = new MeshBuilder('azure_qi_shrine');
    const ph = 0.55;
    platform(mb, 5.4, 5.4, ph, { stairs: 'front', stairW: 1.6 });
    // inlaid taiji on the floor
    mb.at(0, ph + 0.005, 0, () => taiji(mb, 1.25));
    // pavilion
    const colH = 2.5, span = 3.2;
    colonnade(mb, span, span, ph, colH, 2, 2, 0.17);
    // low railings between the back/side columns
    mb.with(null, () => {
      for (const [x, z, rot] of [[0, -span / 2, 0], [span / 2, 0, 90], [-span / 2, 0, 90]] as [number, number, number][]) {
        mb.with(T(x, ph, z, [0, rot, 0]), () => {
          mb.box([span - 0.3, 0.08, 0.1], [0, 0.75, 0]);
          mb.box([span - 0.3, 0.06, 0.08], [0, 0.35, 0]);
          for (let i = 0; i < 5; i++) mb.box([0.05, 0.75, 0.05], [-span / 2 + 0.35 + i * ((span - 0.7) / 4), 0.375, 0]);
        });
      }
    }, { mat: PAL.vermilion });
    const beamY = ph + colH + 0.14;
    bracketBand(mb, span + 0.2, span + 0.2, beamY, 0.45, 4);
    const r = roof(mb, { w: 2.55, d: 2.55, h: 1.65, ridge: 0, y: beamY + 0.42, lift: 0.5, flare: 0.3, ridgeSize: 0.16, segs: [12, 8], finial: false });
    // bronze Qi-gathering spire on the apex, cradling the orb
    mb.with(T(0, r.topY - 0.05, 0), () => {
      mb.lathe([[0.3, 0], [0.28, 0.12], [0.12, 0.22], [0.16, 0.4], [0.07, 0.55], [0.05, 1.0], [0.1, 1.08], [0.001, 1.12]], 10, { capBottom: true });
      // four curling cradle arms
      for (let i = 0; i < 4; i++) {
        mb.with(T(0, 0, 0, [0, i * 90 + 45, 0]), () => {
          const pts: V3[] = [];
          for (let k = 0; k <= 8; k++) {
            const q = k / 8;
            pts.push([0, 0.75 + q * 0.85, 0.05 + Math.sin(q * Math.PI * 0.9) * 0.42]);
          }
          mb.tube(pts, (t) => 0.035 * (1 - t * 0.6), 5);
          mb.at(0, 1.6, 0.05 + Math.sin(Math.PI * 0.9) * 0.42, () => mb.sphere(0.05, 6, 4));
        });
      }
    }, { mat: PAL.bronze });
    // talisman strips hanging from the eave corners
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const p = r.front(sx, 0.93);
      mb.at(p[0] * 0.92, p[1] - 0.2, sz * Math.abs(p[2]) * 0.92, () => lantern(mb, [0, 0, 0], 0.16));
    }
    for (let i = -1; i <= 1; i++) mb.at(i * 0.9, beamY - 0.02, span / 2 + 0.12, () => talismanStrip(mb, 0.14, 0.62));

    // bronze ding + stand
    mb.at(0, ph, 0, () => ding(mb, 0.55));

    // four stone lanterns at platform corners, banners at back
    for (const [x, z] of [[2.25, 2.25], [-2.25, 2.25]]) mb.at(x, ph, z, () => stoneLantern(mb, 0.9));
    bannerPole(mb, [2.3, ph, -2.3], 4.2, 0.7, 1.5, 0);
    bannerPole(mb, [-2.3, ph, -2.3], 4.2, 0.7, 1.5, 180);

    // floating Qi orb (joint 1, animated)
    const orbY = r.topY + 1.55;
    mb.with(T(0, orbY, 0), () => {
      mb.with(null, () => mb.blob(0.28, 2), { mat: PAL.qi });
      // orbiting rings of gold
      mb.with(T(0, 0, 0, [70, 0, 20]), () => ringTorus(mb, 0.48, 0.025), { mat: PAL.gold });
      mb.with(T(0, 0, 0, [-60, 40, 0]), () => ringTorus(mb, 0.42, 0.02), { mat: PAL.gold });
    }, { joint: 1 });

    return {
      mesh: mb,
      skeleton: [
        { name: 'root', parent: -1, pos: [0, 0, 0] },
        { name: 'orb', parent: 0, pos: [0, orbY, 0] as V3 },
      ],
      animations: [
        {
          name: 'idle',
          duration: 4,
          fps: 20,
          tracks: {
            orb: (p) => ({ r: quatEuler(0, p * Math.PI * 2, 0), t: [0, Math.sin(p * Math.PI * 2) * 0.12, 0] }),
          },
        },
      ],
      sockets: [{ name: 'orb', pos: [0, orbY, 0], joint: 'orb' }],
      ao: { maxDist: 2.2 },
    };
  },
};

function ringTorus(mb: MeshBuilder, R: number, r: number) {
  const pts: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  mb.tube(pts, r, 5, { capStart: false, capEnd: false });
}
