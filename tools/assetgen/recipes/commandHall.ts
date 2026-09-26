// 衙门 Governor's Yamen — Azure Dynasty construction yard (C&C "Construction Yard" role).
// Double-eave hip roof (重檐庑殿), the most prestigious roof form, on a raised marble terrace.
// 4×4 cells (12 m). Deployed from the Imperial Caravan.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, platform, colonnade, bracketBand, latticePanel, lantern, bannerPole } from '../kit/roof';
import type { Recipe } from '../recipe';
import { stoneLion, incenseBurner, petitionDrum, balustrade } from './props2';

export const commandHall: Recipe = {
  id: 'azure_command_hall',
  name: 'Governor’s Yamen',
  hanzi: '衙门',
  category: 'structure',
  footprint: [4, 4],
  build() {
    const mb = new MeshBuilder('azure_command_hall');
    const ph = 0.95;
    const zc = -1.3; // hall centre (leaves room for the front court)
    const W = 8.4, D = 4.8, colH = 3.1;
    const bay = W / 5;

    // forecourt paving
    mb.with(null, () => mb.box([11.7, 0.1, 11.7], [0, 0.05, 0], 0.03), { mat: PAL.stoneDark });
    mb.with(null, () => mb.box([3.4, 0.03, 3.6], [0, 0.11, 4.0]), { mat: PAL.stone });

    mb.at(0, 0, zc, () => {
      mb.at(0, 0.1, 0, () => platform(mb, 10.4, 7.2, ph - 0.1, { stairs: 'front', stairW: 3.2 }));
      balustrade(mb, 10.2, 7.0, ph, 3.4);

      // ---- lower storey: 5 × 3 bays
      colonnade(mb, W, D, ph, colH, 6, 4, 0.22);
      for (let i = 0; i < 5; i++) {
        const x = -W / 2 + bay * (i + 0.5);
        if (i >= 1 && i <= 3) {
          latticePanel(mb, bay - 0.4, colH - 0.5, [x, ph + (colH - 0.5) / 2 + 0.1, D / 2 - 0.25], { cols: 4, rows: 7 });
        } else {
          mb.with(null, () => mb.box([bay - 0.35, 1.0, 0.3], [x, ph + 0.5, D / 2 - 0.25]), { mat: PAL.brick });
          latticePanel(mb, bay - 0.4, colH - 1.5, [x, ph + 1.0 + (colH - 1.5) / 2 + 0.05, D / 2 - 0.25], { cols: 4, rows: 4 });
        }
      }
      mb.with(null, () => {
        mb.box([W - 0.3, colH - 0.9, 0.3], [0, ph + 0.9 + (colH - 0.9) / 2, -D / 2 + 0.05]);
        for (const sx of [-1, 1]) mb.box([0.3, colH - 0.9, D - 0.3], [sx * (W / 2 - 0.05), ph + 0.9 + (colH - 0.9) / 2, 0]);
      }, { mat: PAL.plasterOchre });
      mb.with(null, () => {
        mb.box([W - 0.2, 0.9, 0.36], [0, ph + 0.45, -D / 2 + 0.05]);
        for (const sx of [-1, 1]) mb.box([0.36, 0.9, D - 0.2], [sx * (W / 2 - 0.05), ph + 0.45, 0]);
      }, { mat: PAL.brick });
      for (const sx of [-1, 1]) mb.with(T(sx * (W / 2 + 0.12), ph + 2.1, 0, [0, sx * 90, 0]), () => latticePanel(mb, 1.6, 1.0, [0, 0, 0], { cols: 5, rows: 3 }));
      // plaque (匾额) above the central door
      mb.with(null, () => mb.box([2.0, 0.7, 0.08], [0, ph + colH - 0.1, D / 2 + 0.08], 0.02), { mat: PAL.plaque });
      mb.with(null, () => {
        mb.box([2.2, 0.08, 0.1], [0, ph + colH + 0.28, D / 2 + 0.09]);
        mb.box([2.2, 0.08, 0.1], [0, ph + colH - 0.48, D / 2 + 0.09]);
        mb.box([0.08, 0.84, 0.1], [-1.06, ph + colH - 0.1, D / 2 + 0.09]);
        mb.box([0.08, 0.84, 0.1], [1.06, ph + colH - 0.1, D / 2 + 0.09]);
        for (let i = 0; i < 3; i++) mb.box([0.3, 0.38, 0.02], [-0.55 + i * 0.55, ph + colH - 0.1, D / 2 + 0.13]);
      }, { mat: PAL.gold });

      const y1 = ph + colH + 0.14;
      bracketBand(mb, W + 0.3, D + 0.3, y1, 0.5, 10);

      // ---- lower skirt roof (下檐)
      const yEave1 = y1 + 0.46;
      roof(mb, { w: W / 2 + 1.35, d: D / 2 + 1.3, h: 2.5, ridge: 2.4, y: yEave1, tStart: 0.52, lift: 0.5, flare: 0.3, ridgeSize: 0.2, segs: [18, 5] });

      // ---- upper storey (clerestory)
      const W2 = W - 1.9, D2 = D - 1.5;
      const yU0 = yEave1 + 0.6, uH = 1.4;
      mb.with(null, () => mb.box([W2, uH, D2], [0, yU0 + uH / 2, 0]), { mat: PAL.plasterOchre });
      colonnade(mb, W2 + 0.1, D2 + 0.1, yU0 - 0.14, uH, 4, 2, 0.17);
      for (let i = 0; i < 3; i++) latticePanel(mb, 1.3, 0.8, [-W2 / 3 + (i * W2) / 3, yU0 + uH / 2, D2 / 2 + 0.04], { cols: 5, rows: 3 });
      const y2 = yU0 + uH;
      bracketBand(mb, W2 + 0.25, D2 + 0.25, y2, 0.42, 7);
      roof(mb, { w: W2 / 2 + 1.3, d: D2 / 2 + 1.25, h: 2.7, ridge: 2.0, y: y2 + 0.4, lift: 0.55, flare: 0.32, ridgeSize: 0.24, segs: [16, 8] });

      // lanterns under the lower eave
      for (const x of [-W / 2 + bay, W / 2 - bay]) lantern(mb, [x, ph + colH - 0.05, D / 2 + 0.45], 0.2);
    });

    // ---- forecourt props
    mb.at(-1.9, 0.1, 4.6, () => stoneLion(mb, 0.75), [0, 180 + 12, 0]);
    mb.at(1.9, 0.1, 4.6, () => stoneLion(mb, 0.75), [0, 180 - 12, 0]);
    mb.at(0, 0.1, 4.2, () => incenseBurner(mb, 0.55));
    mb.at(-4.6, 0.1, 3.8, () => petitionDrum(mb, 0.7), [0, 30, 0]);
    bannerPole(mb, [4.9, 0.1, 5.0], 5.2, 1.0, 2.2, 180);
    bannerPole(mb, [-4.9, 0.1, -5.2], 5.2, 1.0, 2.2, 0);
    bannerPole(mb, [4.9, 0.1, -5.2], 5.2, 1.0, 2.2, 180);

    return {
      mesh: mb,
      sockets: [
        { name: 'rally', pos: [0, 0, 6.2] },
        { name: 'build_origin', pos: [0, 0.2, 4.5] },
      ],
      ao: { maxDist: 2.6 },
    };
  },
};
