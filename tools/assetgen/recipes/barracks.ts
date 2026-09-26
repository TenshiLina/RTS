// 兵营 Garrison Camp — trains infantry. Walled courtyard with gatehouse, drill yard and
// barracks hall. 3×3 cells (9 m).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { roof, colonnade, latticePanel, lantern, bannerPole, platform } from '../kit/roof';
import type { Recipe } from '../recipe';
import { weaponRack, archeryTarget, trainingDummy, barrel, crate } from './props';
import { wallCap } from './props2';

export const barracks: Recipe = {
  id: 'azure_barracks',
  name: 'Garrison Camp',
  hanzi: '兵营',
  category: 'structure',
  footprint: [3, 3],
  build() {
    const mb = new MeshBuilder('azure_barracks');
    const S = 8.6; // compound size
    const wallH = 1.9, wallT = 0.5;
    // packed-earth yard
    mb.with(null, () => mb.box([S, 0.1, S], [0, 0.05, 0], 0.03), { mat: PAL.rammedEarth });
    // perimeter walls (gap at front for the gate)
    const gateW = 2.6;
    mb.with(null, () => {
      mb.box([S, wallH, wallT], [0, wallH / 2, -S / 2 + wallT / 2], 0.04);
      mb.box([wallT, wallH, S], [-S / 2 + wallT / 2, wallH / 2, 0], 0.04);
      mb.box([wallT, wallH, S], [S / 2 - wallT / 2, wallH / 2, 0], 0.04);
      const seg = (S - gateW) / 2;
      mb.box([seg, wallH, wallT], [-S / 2 + seg / 2, wallH / 2, S / 2 - wallT / 2], 0.04);
      mb.box([seg, wallH, wallT], [S / 2 - seg / 2, wallH / 2, S / 2 - wallT / 2], 0.04);
    }, { mat: PAL.plaster });
    mb.with(null, () => {
      mb.box([S + 0.04, 0.45, wallT + 0.04], [0, 0.22, -S / 2 + wallT / 2]);
      mb.box([wallT + 0.04, 0.45, S + 0.04], [-S / 2 + wallT / 2, 0.22, 0]);
      mb.box([wallT + 0.04, 0.45, S + 0.04], [S / 2 - wallT / 2, 0.22, 0]);
      const seg = (S - gateW) / 2;
      mb.box([seg + 0.04, 0.45, wallT + 0.04], [-S / 2 + seg / 2, 0.22, S / 2 - wallT / 2]);
      mb.box([seg + 0.04, 0.45, wallT + 0.04], [S / 2 - seg / 2, 0.22, S / 2 - wallT / 2]);
    }, { mat: PAL.brick });
    // wall caps
    mb.at(0, 0, -S / 2 + wallT / 2, () => wallCap(mb, S, wallH, wallT));
    mb.at(-S / 2 + wallT / 2, 0, 0, () => wallCap(mb, S, wallH, wallT), [0, 90, 0]);
    mb.at(S / 2 - wallT / 2, 0, 0, () => wallCap(mb, S, wallH, wallT), [0, 90, 0]);
    const seg = (S - gateW) / 2;
    mb.at(-S / 2 + seg / 2, 0, S / 2 - wallT / 2, () => wallCap(mb, seg, wallH, wallT));
    mb.at(S / 2 - seg / 2, 0, S / 2 - wallT / 2, () => wallCap(mb, seg, wallH, wallT));

    // gatehouse (门楼)
    mb.at(0, 0, S / 2 - wallT / 2, () => {
      colonnade(mb, gateW + 0.3, 1.2, 0, 2.5, 2, 2, 0.15);
      mb.with(null, () => mb.box([gateW + 0.7, 0.35, 1.5], [0, 2.75, 0], 0.03), { mat: PAL.paintTeal });
      mb.with(null, () => mb.box([gateW + 0.8, 0.06, 1.6], [0, 2.58, 0]), { mat: PAL.gold });
      roof(mb, { w: gateW / 2 + 1.0, d: 1.35, h: 1.1, ridge: gateW / 2 + 0.2, y: 2.95, gableT: 0.45, lift: 0.3, flare: 0.16, ridgeSize: 0.15, segs: [10, 5] });
      // open doors swung inward
      mb.with(null, () => {
        for (const sx of [-1, 1]) mb.with(T(sx * (gateW / 2 - 0.05), 0, -0.1, [0, sx * -80, 0]), () => mb.box([gateW / 2 - 0.1, 2.3, 0.08], [-sx * (gateW / 4 - 0.05), 1.15, 0], 0.02));
      }, { mat: PAL.vermilion });
      mb.with(null, () => mb.box([1.3, 0.4, 0.06], [0, 2.75, 0.78], 0.02), { mat: PAL.plaque });
      lantern(mb, [-gateW / 2 - 0.25, 2.5, 0.75], 0.17);
      lantern(mb, [gateW / 2 + 0.25, 2.5, 0.75], 0.17);
    });

    // barracks hall at the back
    const hw = 6.4, hd = 2.8, hz = -S / 2 + wallT + hd / 2 + 0.25, hh = 2.4;
    mb.at(0, 0, hz, () => {
      platform(mb, hw + 0.5, hd + 0.5, 0.35, { stairs: 'front', stairW: 1.4 });
      colonnade(mb, hw, hd, 0.35, hh, 5, 2, 0.16);
      mb.with(null, () => mb.box([hw - 0.2, hh, hd - 0.4], [0, 0.35 + hh / 2, -0.15]), { mat: PAL.plaster });
      for (let i = 0; i < 4; i++) {
        const x = -hw / 2 + (hw / 4) * (i + 0.5);
        if (i === 1 || i === 2) latticePanel(mb, 1.1, 1.9, [x, 0.35 + 1.0, hd / 2 - 0.3], { cols: 3, rows: 6 });
        else latticePanel(mb, 1.1, 0.9, [x, 0.35 + 1.4, hd / 2 - 0.3], { cols: 4, rows: 3 });
      }
      mb.with(null, () => mb.box([hw + 0.2, 0.32, hd + 0.2], [0, 0.35 + hh + 0.16, 0], 0.03), { mat: PAL.paintTeal });
      mb.with(null, () => mb.box([hw + 0.25, 0.06, hd + 0.25], [0, 0.35 + hh + 0.02, 0]), { mat: PAL.gold });
      roof(mb, { w: hw / 2 + 0.95, d: hd / 2 + 0.95, h: 1.9, ridge: hw / 2 - 0.4, y: 0.35 + hh + 0.32, gableT: 0.4, lift: 0.42, flare: 0.22, ridgeSize: 0.18, segs: [16, 6] });
    });

    // drill yard props
    mb.at(-2.6, 0.1, 0.4, () => weaponRack(mb, 1.8), [0, 90, 0]);
    mb.at(2.9, 0.1, 1.2, () => archeryTarget(mb), [0, -90, 0]);
    mb.at(2.9, 0.1, -0.4, () => archeryTarget(mb), [0, -90, 0]);
    mb.at(-1.2, 0.1, 2.3, () => trainingDummy(mb));
    mb.at(0.2, 0.1, 1.9, () => trainingDummy(mb), [0, 40, 0]);
    mb.at(-3.4, 0.1, 3.3, () => barrel(mb, 0.8));
    mb.at(-3.0, 0.1, 3.5, () => barrel(mb, 0.7));
    mb.at(-3.5, 0.1, 2.6, () => crate(mb, 0.6), [0, 20, 0]);
    // drum on stand in the yard
    mb.with(T(1.6, 0.1, -0.2, [0, 0, 0]), () => {
      mb.with(null, () => {
        for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) mb.tube([[x, 0, z], [x * 0.7, 0.7, z * 0.7]], 0.03, 5);
      }, { mat: PAL.timberDark });
      mb.with(T(0, 0.9, 0), () => {
        mb.with(null, () => mb.lathe([[0.35, -0.2], [0.4, 0], [0.35, 0.2]], 14, { capTop: false, capBottom: false }), { mat: PAL.vermilion });
        mb.with(null, () => mb.cylinder({ r: 0.34, h: 0.01, y0: 0.19, sides: 14, capBottom: false }), { mat: PAL.straw });
      });
    });

    // banners flanking the gate + corner
    bannerPole(mb, [-gateW / 2 - 0.9, 0, S / 2 + 0.2], 4.6, 0.8, 1.9, 0);
    bannerPole(mb, [gateW / 2 + 0.9, 0, S / 2 + 0.2], 4.6, 0.8, 1.9, 180);
    bannerPole(mb, [-S / 2 + 0.3, 0, -S / 2 + 0.3], 5.4, 0.9, 2.1, 0);

    return {
      mesh: mb,
      sockets: [
        { name: 'exit', pos: [0, 0, S / 2 + 0.8] },
        { name: 'rally', pos: [0, 0, S / 2 + 3] },
      ],
      ao: { maxDist: 2.2 },
    };
  },
};
