// Viewer-only: the Halberdier re-authored on the char3 character kit (sculpted hands and boots,
// fitted tunic, trousers, lamellar cuirass, pauldrons, armour skirt and helmet, sculpted 戟 and
// rattan shield). Kept out of the game: its head is the v3 face, which was rejected, and the
// character system is not yet approved for unit content. The game's Halberdier stays on v2.

import { MeshBuilder, T } from '../kit/mesh';
import type { Recipe } from '../recipe';
import { J, SKELETON, SKIN_ZONES, makeAnim, walkCycle, idleCycle, Pose } from './humanoid';
import { ctx3, head3, hands3, boots3, trousers3, tunic3, cuirass3, armourSkirt3, pauldrons3, belt3, helmet3, GRIP_RP, SKIN_TONES } from './char3';
import { buildJi, buildRattanShield } from './weapons3';
import { ownerJoint } from './body';
import { srcOf } from '../kit/cache';

const SELF_SRC = srcOf(import.meta.url);
const WEAPONS_SRC = srcOf(new URL('./weapons3.ts', import.meta.url).href);

const HALB_HOLD = -90;
const halberdBase: Pose = { armR: [-6, 0, -6], foreR: [HALB_HOLD + 10, 0, 0], armL: [-20, 0, 12], foreL: [-55, 0, 0] };

export const devHalberd3: Recipe = {
  id: 'dev_halberd3',
  name: 'Halberdier (char3 kit, review only)',
  category: 'dev',
  build() {
    const mb = new MeshBuilder('dev_halberd3');
    const c = ctx3(mb, 'halb', SKIN_TONES.weathered, [SELF_SRC, WEAPONS_SRC]);
    const hs = head3(c, { shape: { width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 }, age: 0.35, look: { brows: 'stern', stubble: 0.85, liner: 0.5 } });
    hands3(c, { L: 'grip', R: 'grip' });
    boots3(c, { color: 0x1f1b1c });
    trousers3(c, { color: 0x2d3558, band: 0x1c2036 });
    tunic3(c, { color: 0xb52d24, trim: [{ from: 0, to: 0.03, color: 0x1f1c22, motif: 'meander', motifColor: 0xc9a24e, scale: 0.03 }] });
    const lam = { plate: 0x8a8f96, lace: 0x2a1a14, plateTeam: 0.75 };
    cuirass3(c, lam);
    armourSkirt3(c, lam);
    pauldrons3(c, lam);
    belt3(c);
    helmet3(c, hs, { aventail: lam });
    // 戟 in the right fist, pointing up when the forearm is raised to HALB_HOLD
    buildJi(c, J.handR, (fn) => mb.with(T(GRIP_RP[0], GRIP_RP[1], GRIP_RP[2], [-HALB_HOLD, 0, 0]), fn));
    // round rattan shield on the left forearm
    const shieldAt = T(0.34, 0.98, 0.1, [0, 70, 0]);
    buildRattanShield(c, J.foreL, { c: [0.34, 0.98, 0.1], n: [Math.sin((70 * Math.PI) / 180), 0, Math.cos((70 * Math.PI) / 180)] }, (fn) => mb.with(shieldAt, fn));

    const anims = [
      idleCycle(halberdBase),
      walkCycle(halberdBase, { holdR: true, holdL: true }),
      makeAnim('attack', 1.1, (p) => {
        // wind-up → overhead chop → recover
        const k = p < 0.3 ? p / 0.3 : p < 0.5 ? 1 - (p - 0.3) / 0.2 * 2 : p < 0.75 ? -1 : -1 + (p - 0.75) / 0.25;
        const wind = Math.max(0, k), strike = Math.max(0, -k);
        return {
          pose: {
            armR: [wind * 25 - strike * 85, 0, -strike * 6],
            foreR: [-wind * 5 + strike * 25, 0, 0],
            chest: [strike * 12 - wind * 4, wind * 25 - strike * 30, 0],
            pelvis: [0, wind * 8 - strike * 10, 0],
            thighL: [-strike * 25, 0, 0],
            shinL: [strike * 15, 0, 0],
            thighR: [strike * 15, 0, 0],
            head: [-strike * 8, -wind * 10 + strike * 12, 0],
          },
          bob: -strike * 0.06,
        };
      }, halberdBase),
    ];
    return {
      mesh: mb, skeleton: SKELETON, skin: SKIN_ZONES, skinOwner: ownerJoint, animations: anims,
      sockets: [{ name: 'weapon_tip', pos: [GRIP_RP[0], GRIP_RP[1], GRIP_RP[2] + 2.0], joint: 'handR' }], ao: { maxDist: 0.5, ground: true },
    };
  },
};
