// Tier-1 Azure Dynasty infantry: Halberdier (戟兵), Archer (弓手), Daoist Initiate (道士).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import { J, SKELETON, SKIN_ZONES, HAND_R, HAND_L, buildBody, armourSkirt, makeAnim, walkCycle, idleCycle, wave, Pose } from './humanoid';
import { V3, quatAxisAngle } from '../../../src/core/math';
import type { JointDef } from '../kit/gltf';

/** Build geometry in a frame at `grip`, rotated so it points up (+Y) when the limb is at `holdDeg` (X). */
function held(mb: MeshBuilder, joint: number, grip: V3, holdDeg: number, fn: () => void) {
  mb.with(T(grip[0], grip[1], grip[2], [-holdDeg, 0, 0]), fn, { joint });
}

function helmet(mb: MeshBuilder) {
  mb.with(null, () => {
    mb.at(0, 1.672, -0.006, () => {
      mb.lathe([[0.155, -0.04], [0.15, 0.02], [0.14, 0.08], [0.1, 0.15], [0.03, 0.19], [0.001, 0.2]], 28, { capBottom: false });
      // brim
      mb.lathe([[0.14, 0.0], [0.17, -0.02], [0.165, -0.035], [0.14, -0.02]], 28);
      // spike
      mb.cylinder({ r: 0.02, rTop: 0.005, h: 0.14, y0: 0.19, sides: 6 });
    });
  }, { mat: PAL.steel, joint: J.head });
  // neck guard (aventail) — back half only
  mb.with(null, () => {
    mb.at(0, 1.652, -0.006, () => mb.lathe([[0.19, -0.14], [0.15, 0]], 10, { arc: Math.PI * 1.1, phase: Math.PI * 0.45, smooth: false }));
  }, { mat: PAL.lamellarTeam, joint: J.head });
  // red horsehair tassel
  mb.with(null, () => mb.at(0, 1.88, -0.006, () => mb.blob(0.055, 1, { squash: [1, 0.9, 1], displace: (d) => Math.max(0, -d[1]) * 0.5 })), { mat: PAL.clothRed, joint: J.head });
}

function lamellarCuirass(mb: MeshBuilder) {
  mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.8]), () => {
    mb.lathe([[0.165, 1.0], [0.18, 1.12], [0.205, 1.3], [0.2, 1.39], [0.14, 1.44]], 12);
  }, { mat: PAL.lamellarTeam, joint: J.chest });
  // shoulder guards (披膊)
  for (const s of [1, -1]) {
    mb.with(null, () => mb.at(0.24 * s, 1.41, 0, () => mb.sphere(0.095, 10, 6, { squash: [1, 0.8, 1.1] })), { mat: PAL.lamellarTeam, joint: s > 0 ? J.armL : J.armR });
  }
  // belt with bronze buckle
  mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.82]), () => mb.lathe([[0.19, 1.0], [0.195, 1.04], [0.19, 1.08]], 12), { mat: PAL.leather, joint: J.chest });
  mb.with(null, () => mb.box([0.08, 0.06, 0.03], [0, 1.04, 0.16], 0.01), { mat: PAL.bronze, joint: J.chest });
  // chest mirror (护心镜)
  mb.with(null, () => mb.at(0, 1.25, 0.158, () => mb.cylinder({ r: 0.06, h: 0.012, sides: 12 }), [90, 0, 0]), { mat: PAL.brass, joint: J.chest });
}

// ================================================================== Halberdier
const HALB_HOLD = -68;
const halberdBase: Pose = { armR: [-8, 0, -4], foreR: [HALB_HOLD + 8, 0, 0], armL: [-20, 0, 12], foreL: [-55, 0, 0] };

export const halberdier: Recipe = {
  id: 'azure_halberdier',
  name: 'Halberdier',
  hanzi: '戟兵',
  category: 'unit',
  build() {
    const mb = new MeshBuilder('azure_halberdier');
    buildBody(mb, { trousers: PAL.clothIndigo, tunic: PAL.clothRed, sleeves: PAL.clothRed, collar: PAL.clothBlack, face: { brows: 'stern', beard: 'moustache', hair: 'cropped', age: 0.35, shape: { width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 } }, handL: 'fist', handR: 'fist' });
    lamellarCuirass(mb);
    armourSkirt(mb, PAL.lamellarTeam, 0.36);
    helmet(mb);
    // 戟 ji halberd: shaft, spear tip, crescent blade, tassel
    held(mb, J.foreR, HAND_R, HALB_HOLD, () => {
      mb.with(null, () => mb.cylinder({ r: 0.022, h: 2.55, y0: -0.75, sides: 6 }), { mat: PAL.timberDark });
      mb.with(null, () => {
        mb.cone(0.05, 0.36, 4, 1.8, false);
        mb.with(T(0, 1.72, 0), () => mb.cylinder({ r: 0.035, h: 0.1, sides: 6 }));
        // crescent (月牙) blade on one side
        mb.with(T(0, 1.72, 0, [0, 90, 0]), () => {
          const pts: [number, number][] = [];
          for (let i = 0; i <= 8; i++) {
            const a = -1.1 + (i / 8) * 2.2;
            pts.push([0.04 + Math.cos(a) * 0.2, Math.sin(a) * 0.22]);
          }
          for (let i = 8; i >= 0; i--) {
            const a = -0.9 + (i / 8) * 1.8;
            pts.push([0.04 + Math.cos(a) * 0.1, Math.sin(a) * 0.12]);
          }
          mb.with(T(0, 0, 0, [90, 0, 0]), () => mb.extrude(pts.map(([x, y]) => [x, y] as [number, number]), -0.008, 0.008));
        });
        // butt spike
        mb.with(T(0, -0.75, 0, [180, 0, 0]), () => mb.cone(0.025, 0.12, 5));
      }, { mat: PAL.steel });
      mb.with(null, () => mb.at(0, 1.64, 0, () => mb.blob(0.06, 1, { squash: [1, 1.4, 1], displace: (d) => Math.max(0, -d[1]) * 0.6 })), { mat: PAL.clothRed });
    });
    // round rattan shield on the left forearm
    mb.with(T(0.33, 0.98, 0.1, [0, 70, 0]), () => {
      mb.with(null, () => mb.lathe([[0.001, 0.07], [0.12, 0.06], [0.24, 0.02], [0.26, 0.0], [0.25, -0.02], [0.001, -0.01]], 16, { smooth: true }), { mat: PAL.straw });
      mb.with(null, () => mb.lathe([[0.001, 0.078], [0.07, 0.07], [0.09, 0.062]], 12), { mat: PAL.clothTeam });
    }, { joint: J.foreL });

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
    return { mesh: mb, skeleton: SKELETON, skin: SKIN_ZONES, animations: anims, sockets: [{ name: 'weapon_tip', pos: [HAND_R[0], HAND_R[1] + 1.9, HAND_R[2]], joint: 'foreR' }], ao: { maxDist: 0.6, ground: true } };
  },
};

// ================================================================== Archer
const BOW_HOLD = -80;
const archerBase: Pose = { armL: [-40, 0, 8], foreL: [-40, 0, 0], armR: [0, 0, -4] };

export const archer: Recipe = {
  id: 'azure_archer',
  name: 'Archer',
  hanzi: '弓手',
  category: 'unit',
  build() {
    const mb = new MeshBuilder('azure_archer');
    buildBody(mb, { trousers: PAL.clothBrown, tunic: PAL.clothOlive, sleeves: PAL.clothOlive, sash: PAL.clothTeam, collar: PAL.clothBrown, face: { brows: 'calm', hair: 'low', age: 0.15, shape: { width: 0.96, jaw: 0.92, eyes: 1.04 } }, handL: 'fist', handR: 'relaxed' });
    // padded vest in team colour
    mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.8]), () => mb.lathe([[0.17, 1.06], [0.2, 1.3], [0.195, 1.38], [0.13, 1.44]], 12), { mat: { ...PAL.clothTeam, name: 'vest_team', team: 0.85, doubleSided: false }, joint: J.chest });
    armourSkirt(mb, PAL.clothOlive, 0.3);
    // 斗笠 conical straw hat + hair bun
    mb.with(null, () => {
      mb.at(0, 1.68, 0, () => mb.lathe([[0.36, 0], [0.3, 0.03], [0.12, 0.12], [0.001, 0.19]], 16, { capBottom: true, smooth: false }));
    }, { mat: PAL.straw, joint: J.head });
    mb.with(null, () => mb.at(0, 1.705, 0, () => mb.cylinder({ r: 0.305, rTop: 0.29, h: 0.035, sides: 16, capTop: false, capBottom: false })), { mat: { ...PAL.clothTeam, name: 'hat_band', doubleSided: false }, joint: J.head });
    // chin strap
    mb.with(null, () => mb.tube([[0.108, 1.69, -0.01], [0.1, 1.58, -0.005], [0.075, 1.505, 0.025], [0, 1.47, 0.06], [-0.075, 1.505, 0.025], [-0.1, 1.58, -0.005], [-0.108, 1.69, -0.01]], 0.006, 5), { mat: PAL.leather, joint: J.head });
    // quiver on the back
    mb.with(T(0.08, 1.2, -0.17, [0, 0, -18]), () => {
      mb.with(null, () => mb.cylinder({ r: 0.07, h: 0.5, y0: -0.2, sides: 8 }), { mat: PAL.leather });
      mb.with(null, () => { for (let i = 0; i < 5; i++) mb.at(Math.cos(i * 1.3) * 0.035, 0.3, Math.sin(i * 1.3) * 0.035, () => mb.cylinder({ r: 0.006, h: 0.14, sides: 4 })); }, { mat: PAL.timber });
      mb.with(null, () => { for (let i = 0; i < 5; i++) mb.at(Math.cos(i * 1.3) * 0.035, 0.42, Math.sin(i * 1.3) * 0.035, () => mb.cone(0.02, 0.07, 3)); }, { mat: PAL.clothWhite });
    }, { joint: J.chest });
    // recurve bow in the left hand (in the vertical plane of the arm)
    held(mb, J.foreL, HAND_L, BOW_HOLD, () => {
      const pts: V3[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14 - 0.5;
        const y = t * 1.25;
        const z = 0.12 * Math.cos(t * Math.PI) - 0.06 - (Math.abs(t) > 0.42 ? (Math.abs(t) - 0.42) * 1.4 : 0);
        pts.push([0, y, z]);
      }
      mb.with(null, () => mb.tube(pts, (t) => 0.018 - Math.abs(t - 0.5) * 0.012, 5), { mat: PAL.lacquerDark });
      mb.with(null, () => mb.tube([pts[0], [0, 0, -0.14], pts[14]], 0.004, 3, { smooth: false }), { mat: PAL.clothWhite });
      mb.with(null, () => mb.cylinder({ r: 0.024, h: 0.14, y0: -0.07, sides: 6 }), { mat: PAL.leather });
    });

    const anims = [
      idleCycle(archerBase),
      walkCycle(archerBase, { holdL: true, armSwing: 18 }),
      makeAnim('attack', 1.3, (p) => {
        // raise → draw → hold → release
        const raise = Math.min(1, p / 0.25);
        const draw = p < 0.25 ? 0 : p < 0.6 ? (p - 0.25) / 0.35 : p < 0.7 ? 1 : Math.max(0, 1 - (p - 0.7) / 0.08);
        const rel = p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 0;
        const lower = p > 0.85 ? (p - 0.85) / 0.15 : 0;
        const r = raise * (1 - lower);
        return {
          pose: {
            armL: [-45 * r, 0, 0],
            foreL: [40 * r, 0, 0],
            armR: [-80 * r + rel * 10, 0, -10 * draw],
            foreR: [-30 * r - 90 * draw, 0, 0],
            chest: [0, 30 * r, 0],
            head: [0, -25 * r, 0],
            pelvis: [0, 15 * r, 0],
          },
        };
      }, archerBase),
    ];
    return { mesh: mb, skeleton: SKELETON, skin: SKIN_ZONES, animations: anims, sockets: [{ name: 'muzzle', pos: [HAND_L[0], 1.35, 0.4], joint: 'foreL' }], ao: { maxDist: 0.6 } };
  },
};

// ================================================================== Daoist Initiate
const daoistSkeleton: JointDef[] = [...SKELETON, { name: 'orbit', parent: 0, pos: [0, 1.15, 0] }];
const daoistBase: Pose = { armL: [-35, 0, -18], foreL: [-80, 0, 0], armR: [-6, 0, -8], foreR: [-20, 0, 0] };

export const daoist: Recipe = {
  id: 'azure_daoist',
  name: 'Daoist Initiate',
  hanzi: '道士',
  category: 'unit',
  build() {
    const mb = new MeshBuilder('azure_daoist');
    const robe = { ...PAL.clothWhite, name: 'robe_daoist', color: 0x6f86a8, doubleSided: false };
    const robeEdge = PAL.clothBlack;
    buildBody(mb, { trousers: robe, tunic: robe, sleeves: robe, sash: PAL.clothTeam, face: { brows: 'calm', beard: 'long', hair: 'cropped', age: 0.55, shape: { width: 0.95, jaw: 0.9, nose: 1.06 } }, handL: 'relaxed', handR: 'fist' });
    // long flowing robe skirt (on pelvis)
    mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.9]), () => {
      mb.lathe([[0.29, 0.06], [0.3, 0.08], [0.26, 0.4], [0.215, 0.8], [0.182, 1.02]], 24);
    }, { mat: robe, joint: J.pelvis });
    mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.9]), () => mb.lathe([[0.29, 0.05], [0.305, 0.06], [0.302, 0.1]], 24), { mat: robeEdge, joint: J.pelvis });
    // crossed collar (交领)
    mb.with(null, () => {
      mb.tube([[0.07, 1.46, 0.07], [0.0, 1.3, 0.15], [-0.1, 1.12, 0.14]], 0.022, 4);
      mb.tube([[-0.07, 1.46, 0.07], [-0.02, 1.36, 0.13]], 0.02, 4);
    }, { mat: robeEdge, joint: J.chest });
    // wide bell sleeves
    for (const s of [1, -1]) {
      mb.with(null, () => mb.lathe([[0.13, 0.84], [0.14, 0.86], [0.1, 1.0], [0.065, 1.15]], 16, { smooth: true }), { mat: robe, joint: s > 0 ? J.foreL : J.foreR });
    }
    // shift sleeves onto the forearm axis
    for (const t of mb.tris) {
      if ((t.joint === J.foreL || t.joint === J.foreR) && mb.materials[t.mat].name === 'robe_daoist') {
        for (const p of t.p) if (p[1] < 1.16 && Math.abs(p[0]) < 0.16) p[0] += t.joint === J.foreL ? 0.26 : -0.26;
      }
    }
    // Daoist crown + topknot with jade pin
    // 道冠: black gauze crown with a jade hairpin, plus a tall 'scholar' cap back plate
    mb.with(null, () => {
      mb.at(0, 1.73, -0.01, () => mb.sphere(0.075, 8, 6, { squash: [1, 0.85, 1] }));
      mb.box([0.15, 0.12, 0.13], [0, 1.8, -0.01], 0.02);
      mb.box([0.2, 0.05, 0.16], [0, 1.865, -0.01], 0.015);
    }, { mat: PAL.clothBlack, joint: J.head });
    mb.with(null, () => mb.at(0, 1.8, -0.01, () => mb.cylinder({ r: 0.011, h: 0.3, y0: -0.15, sides: 5 }), [0, 0, 90]), { mat: PAL.jade, joint: J.head });
    // peach-wood sword on the back
    mb.with(T(-0.05, 1.2, -0.2, [0, 0, 35]), () => {
      mb.with(null, () => mb.box([0.05, 0.62, 0.015], [0, 0.2, 0], 0.005), { mat: { ...PAL.timber, name: 'peachwood', color: 0xa0603a } });
      mb.with(null, () => mb.box([0.12, 0.03, 0.03], [0, -0.12, 0], 0.005), { mat: PAL.brass });
      mb.with(null, () => mb.cylinder({ r: 0.015, h: 0.16, y0: -0.28, sides: 5 }), { mat: PAL.clothRed });
    }, { joint: J.chest });
    // talisman in the right hand
    mb.with(T(HAND_R[0], HAND_R[1] - 0.05, HAND_R[2] + 0.04), () => mb.box([0.07, 0.16, 0.004], [0, -0.06, 0]), { mat: PAL.talisman, joint: J.foreR });
    // three talismans orbiting the initiate (joint 12)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      mb.with(T(Math.sin(a) * 0.55, 1.15 + (i - 1) * 0.12, Math.cos(a) * 0.55, [0, (a * 180) / Math.PI + 90, 8]), () => {
        mb.with(null, () => mb.box([0.09, 0.2, 0.004], [0, 0, 0]), { mat: PAL.talisman });
        mb.with(null, () => mb.box([0.02, 0.12, 0.006], [0, 0, 0]), { mat: PAL.clothRed });
      }, { joint: SKELETON.length });
    }

    const orbit = (p: number) => ({ r: quatAxisAngle([0, 1, 0], p * Math.PI * 2), t: [0, Math.sin(p * Math.PI * 4) * 0.05, 0] as V3 });
    const withOrbit = (a: ReturnType<typeof makeAnim>, turns = 1) => ({ ...a, tracks: { ...a.tracks, orbit: (p: number) => orbit(p * turns) } });
    const anims = [
      withOrbit(idleCycle(daoistBase, 0.8), 1),
      withOrbit(walkCycle(daoistBase, { holdL: true, armSwing: 14, stride: 24 }), 0.25),
      withOrbit(makeAnim('attack', 1.2, (p) => {
        const up = p < 0.35 ? p / 0.35 : p < 0.5 ? 1 : 0;
        const fl = p >= 0.35 && p < 0.55 ? (p - 0.35) / 0.2 : p >= 0.55 ? Math.max(0, 1 - (p - 0.55) / 0.45) : 0;
        return {
          pose: {
            armR: [-40 * up - 95 * fl, 0, 0],
            foreR: [-70 * up + 50 * fl, 0, 0],
            chest: [-6 * up + 6 * fl, 15 * up - 20 * fl, 0],
            head: [-5 * up, 0, 0],
            armL: [wave(p, 2) * 4, 0, 0],
          },
          bob: -0.02 * fl,
        };
      }, daoistBase), 1.5),
    ];
    return { mesh: mb, skeleton: daoistSkeleton, skin: SKIN_ZONES, animations: anims, sockets: [{ name: 'cast', pos: [HAND_R[0], 1.3, 0.35], joint: 'foreR' }], ao: { maxDist: 0.6 } };
  },
};
