// Adepts of the Five Elements Academy. One robed body, four silhouettes that read at RTS zoom:
//   Fire 火术士  crimson robe, gilded flame crown, a live fireball in the palm
//   Ice  冰术士  pale hooded robe, white fur mantle, tall staff crowned with ice crystals
//   Water 水术士 teal robe with long trailing "water sleeves" (水袖), gourd at the hip
//   Air  风术士  off-white robe, scholar's kerchief (纶巾) and a white feather fan (羽扇)
// Each has idle / walk / attack (school-specific gesture) / cast (spell channel).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import type { MaterialDef } from '../../../src/core/materialModel';
import { J, SKELETON, SKIN_ZONES, HAND_R, HAND_L, buildBody, makeAnim, walkCycle, idleCycle, wave, Pose, BodyStyle } from './humanoid';
import type { V2, V3 } from '../../../src/core/math';

type School = 'fire' | 'ice' | 'water' | 'air';
const smooth01 = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

const cloth = (name: string, color: number, extra: Partial<MaterialDef> = {}): MaterialDef => ({ ...PAL.clothWhite, name, color, doubleSided: false, ...extra });
const ICE = { ...PAL.jade, name: 'ice_crystal', color: 0x9ad8ff, emissive: 0.9 };
const FUR = { ...PAL.clothWhite, name: 'fur', color: 0xf1efe8, roughness: 1 };
const FEATHER = { ...PAL.clothWhite, name: 'feather', color: 0xf4f2ea, doubleSided: true };

function held(mb: MeshBuilder, joint: number, grip: V3, holdDeg: number, fn: () => void) {
  mb.with(T(grip[0], grip[1], grip[2], [-holdDeg, 0, 0]), fn, { joint });
}

/** Robe body shared by all adepts (skirt, bell sleeves, crossed collar). */
function robeBody(mb: MeshBuilder, robe: MaterialDef, trim: MaterialDef, sleeveLen = 0.3, look: Partial<BodyStyle> = {}) {
  buildBody(mb, { trousers: robe, tunic: robe, sleeves: robe, sash: PAL.clothTeam, ...look });
  // (lathe profiles run bottom → top; the old top → bottom order turned the skirt inside out)
  mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.9]), () => mb.lathe([[0.3, 0.06], [0.31, 0.08], [0.27, 0.4], [0.215, 0.8], [0.182, 1.02]], 24), { mat: robe, joint: J.pelvis });
  mb.with(T(0, 0, 0, [0, 0, 0], [1, 1, 0.9]), () => mb.lathe([[0.3, 0.05], [0.315, 0.06], [0.312, 0.12]], 24), { mat: trim, joint: J.pelvis });
  mb.with(null, () => {
    mb.tube([[0.07, 1.46, 0.07], [0.0, 1.3, 0.15], [-0.1, 1.12, 0.14]], 0.024, 4);
    mb.tube([[-0.07, 1.46, 0.07], [-0.02, 1.36, 0.13]], 0.022, 4);
  }, { mat: trim, joint: J.chest });
  // wide bell sleeves on the forearms
  for (const s of [1, -1]) {
    const x = 0.26 * s;
    mb.with(null, () => mb.at(x, 0, 0.01, () => mb.lathe([[0.14, 1.13 - sleeveLen], [0.15, 1.15 - sleeveLen], [0.1, 1.0], [0.065, 1.15]], 16)), { mat: robe, joint: s > 0 ? J.foreL : J.foreR });
    mb.with(null, () => mb.at(x, 0, 0.01, () => mb.lathe([[0.138, 1.13 - sleeveLen], [0.15, 1.13 - sleeveLen], [0.152, 1.16 - sleeveLen]], 16)), { mat: trim, joint: s > 0 ? J.foreL : J.foreR });
  }
}

/** A flame outline (for the fire crown), pointing up. */
function flameShape(h: number, w: number): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push([-w * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.7 * (1 - t * 0.3) + Math.sin(t * 5) * 0.01, t * h]);
  }
  for (let i = 10; i >= 0; i--) {
    const t = i / 10;
    pts.push([w * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.7 * (1 - t * 0.5) + Math.sin(t * 5) * 0.01, t * h * 0.96]);
  }
  return pts;
}

function build(school: School) {
  const mb = new MeshBuilder(`azure_${school}_adept`);
  const styles: Record<School, { robe: MaterialDef; trim: MaterialDef }> = {
    fire: { robe: cloth('robe_fire', 0xa3311f), trim: cloth('trim_fire', 0x1d1512) },
    ice: { robe: cloth('robe_ice', 0xd3e1ec), trim: cloth('trim_ice', 0x2b5d8c) },
    water: { robe: cloth('robe_water', 0x2a7c84), trim: cloth('trim_water', 0xe6f0ec) },
    air: { robe: cloth('robe_air', 0xe4e6da), trim: cloth('trim_air', 0x5f7f6a) },
  };
  const { robe, trim } = styles[school];
  // faces: a fierce young fire adept, a cool ice adept under the hood, a water adept with hair
  // loops, and an air adept with Zhuge Liang's goatee
  const looks: Record<School, Partial<BodyStyle>> = {
    fire: { face: { brows: 'stern', hair: 'topknot', age: 0.1, shape: { jaw: 1.08, brow: 1.2 } }, handR: 'open', handL: 'relaxed' },
    ice: { face: { brows: 'calm', hair: 'none', age: 0.4, shape: { width: 0.97, nose: 1.04 } }, handL: 'fist', handR: 'relaxed' },
    water: { face: { brows: 'arched', hair: 'cropped', age: 0.05, shape: { width: 0.94, jaw: 0.78, nose: 0.84, eyes: 1.1, lips: 1.2, brow: 0.3 } }, handL: 'open', handR: 'open' },
    air: { face: { brows: 'calm', beard: 'goatee', hair: 'cropped', age: 0.35 }, handR: 'fist', handL: 'relaxed' },
  };
  robeBody(mb, robe, trim, school === 'water' ? 0.24 : 0.3, looks[school]);

  if (school === 'fire') {
    // gilded flame crown: three flames on a head band
    mb.with(null, () => {
      mb.at(0, 1.7, 0, () => mb.lathe([[0.128, 0], [0.13, 0.05], [0.125, 0.06]], 12));
      for (const [a, s] of [[0, 1], [-38, 0.72], [38, 0.72]] as [number, number][]) {
        const r = (a * Math.PI) / 180;
        mb.with(T(Math.sin(r) * 0.12, 1.72, Math.cos(r) * 0.12, [-12, a, 0]), () => mb.with(T(0, 0, 0, [-90, 0, 0]), () => mb.extrude(flameShape(0.26 * s, 0.07 * s), -0.012, 0.012)));
      }
    }, { mat: PAL.gold, joint: J.head });
    mb.with(null, () => mb.at(0, 1.77, 0.135, () => mb.sphere(0.028, 6, 4)), { mat: PAL.fire, joint: J.head });
    // long red scarf streaming behind
    mb.with(null, () => mb.tube([[0.06, 1.45, -0.1], [0.1, 1.2, -0.25], [0.05, 0.95, -0.34], [0.09, 0.7, -0.4]], (t) => 0.035 - t * 0.012, 5, { squash: [1.8, 0.5] }), { mat: PAL.clothRed, joint: J.chest });
    // fireball held in the right palm
    mb.with(null, () => mb.at(HAND_R[0] - 0.01, HAND_R[1] - 0.12, HAND_R[2] + 0.04, () => mb.blob(0.11, 1, { squash: [1, 1.25, 1], displace: (d) => Math.max(0, d[1]) * 0.35 })), { mat: PAL.fire, joint: J.foreR });
  } else if (school === 'ice') {
    // hood + fur mantle
    mb.with(null, () => mb.at(0, 1.6, -0.01, () => mb.blob(0.155, 3, { squash: [1, 1.08, 1.05], displace: (n) => (n[2] > 0.4 && n[1] < 0.6 ? -0.55 * smooth01((n[2] - 0.4) / 0.2) : 0) })), { mat: robe, joint: J.head });
    mb.with(null, () => {
      const pts: V3[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push([Math.sin(a) * 0.095, 1.605 + Math.cos(a) * 0.135, 0.085 - Math.pow(Math.cos(a) * 0.5 + 0.5, 2) * 0.03]);
      }
      mb.tube(pts, 0.017, 8, { capStart: false, capEnd: false });
    }, { mat: trim, joint: J.head });
    mb.with(T(0, 0, 0, [0, 0, 0], [1, 0.6, 0.85]), () => mb.at(0, 2.3, 0, () => mb.lathe([[0.14, 0], [0.26, 0.05], [0.28, 0.12], [0.18, 0.2], [0.1, 0.19]], 12)), { mat: FUR, joint: J.chest });
    // tall staff with an ice-crystal crown, carried in the left hand
    held(mb, J.foreL, HAND_L, -30, () => {
      mb.with(null, () => mb.cylinder({ r: 0.025, rTop: 0.02, h: 2.05, y0: -0.75, sides: 6 }), { mat: PAL.timberDark });
      mb.with(null, () => mb.lathe([[0.04, 1.26], [0.06, 1.32], [0.03, 1.36]], 6), { mat: PAL.steel });
      mb.with(null, () => {
        for (const [x, z, r, h, tz, tx] of [[0, 0, 0.07, 0.42, 0, 0], [0.06, 0.02, 0.045, 0.28, -25, 6], [-0.06, 0.01, 0.045, 0.3, 25, -4], [0.01, -0.06, 0.04, 0.24, 6, 22]] as number[][]) {
          mb.with(T(x, 1.33, z, [tx, 0, tz]), () => mb.lathe([[r, 0], [r * 1.1, h * 0.65], [0.001, h]], 6, { smooth: false, capBottom: true }));
        }
      }, { mat: ICE });
    });
  } else if (school === 'water') {
    // double hair loops with a pearl, blue ribbons
    mb.with(null, () => {
      for (const s of [1, -1]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          pts.push([0.075 * s + Math.sin(a) * 0.012 * s, 1.765 + Math.cos(a) * 0.05, -0.035 + Math.sin(a) * 0.03]);
        }
        mb.tube(pts, 0.016, 8, { capStart: false, capEnd: false });
      }
    }, { mat: PAL.hair, joint: J.head });
    mb.with(null, () => mb.at(0, 1.74, -0.06, () => mb.sphere(0.03, 6, 4)), { mat: { ...PAL.clothWhite, name: 'pearl', color: 0xf5f3ee, roughness: 0.15 }, joint: J.head });
    mb.with(null, () => {
      for (const s of [1, -1]) mb.tube([[0.08 * s, 1.72, -0.06], [0.1 * s, 1.55, -0.12], [0.08 * s, 1.35, -0.14]], 0.012, 4, { squash: [2, 0.5] });
    }, { mat: trim, joint: J.head });
    // water sleeves: long flowing cloth from each wrist (they whip out when casting)
    for (const s of [1, -1]) {
      const x = 0.27 * s;
      mb.with(null, () => {
        mb.surface((u, v) => {
          const w = 0.07 + v * 0.05;
          return [x + (u - 0.5) * 2 * w, 0.96 - v * 0.72, 0.03 + Math.sin(v * 2.4) * 0.05];
        }, 3, 8, { uvFn: (u, v) => [u * 0.2, v * 0.7] });
      }, { mat: { ...trim, name: 'water_sleeve', doubleSided: true }, joint: s > 0 ? J.foreL : J.foreR });
    }
    // water gourd at the hip
    mb.with(null, () => {
      mb.at(-0.2, 0.86, 0.08, () => {
        mb.sphere(0.075, 8, 6);
        mb.at(0, 0.1, 0, () => mb.sphere(0.05, 8, 6));
      });
    }, { mat: { ...PAL.timber, name: 'gourd', color: 0xc8a458 }, joint: J.pelvis });
  } else {
    // scholar's kerchief (纶巾) with two tails
    mb.with(null, () => {
      // (blob, not a jittered sphere: jitter turns off smooth normals and the cloth looked faceted)
      mb.at(0, 1.64, -0.01, () => mb.blob(0.14, 3, { squash: [1, 1.05, 1.02], displace: (n) => (n[2] > 0.45 && n[1] < 0.5 ? -0.5 * smooth01((n[2] - 0.45) / 0.2) : 0) }));
      mb.box([0.2, 0.12, 0.17], [0, 1.78, -0.01], 0.03);
      for (const s of [1, -1]) mb.tube([[0.05 * s, 1.72, -0.12], [0.08 * s, 1.55, -0.2], [0.06 * s, 1.38, -0.22]], 0.014, 4, { squash: [2.4, 0.5] });
    }, { mat: trim, joint: J.head });
    // white feather fan held before the chest (the Zhuge Liang silhouette)
    held(mb, J.foreR, HAND_R, -70, () => {
      mb.with(null, () => mb.cylinder({ r: 0.015, h: 0.24, y0: -0.12, sides: 5 }), { mat: PAL.lacquerDark });
      mb.with(null, () => {
        const pts: V2[] = [];
        for (let i = 0; i <= 14; i++) {
          const a = -1.15 + (i / 14) * 2.3;
          const r = 0.28 * (0.92 + 0.08 * Math.cos(i * 1.7));
          pts.push([Math.sin(a) * r, 0.1 + Math.cos(a) * r]);
        }
        pts.push([0.03, 0.1], [-0.03, 0.1]);
        mb.with(T(0, 0, 0, [90, 0, 0]), () => mb.extrude(pts, -0.006, 0.006));
      }, { mat: FEATHER });
      mb.with(null, () => mb.box([0.07, 0.04, 0.02], [0, 0.12, 0], 0.01), { mat: PAL.gold });
    });
    // flowing sage sash ends
    mb.with(null, () => mb.tube([[0.1, 1.05, 0.14], [0.14, 0.8, 0.18], [0.12, 0.55, 0.16]], 0.018, 4, { squash: [2.4, 0.5] }), { mat: trim, joint: J.pelvis });
  }

  // ---------------------------------------------------------------- animation
  const base: Record<School, Pose> = {
    fire: { armR: [-18, 0, -10], foreR: [-55, 0, 0], armL: [-5, 0, 6], foreL: [-20, 0, 0] },
    ice: { armL: [-10, 0, 8], foreL: [-30, 0, 0], armR: [-6, 0, -6], foreR: [-25, 0, 0] },
    water: { armL: [-8, 0, 10], foreL: [-15, 0, 0], armR: [-8, 0, -10], foreR: [-15, 0, 0] },
    air: { armR: [-10, 0, -6], foreR: [-70, 0, 0], armL: [-4, 0, 6], foreL: [-15, 0, 0] },
  };
  const b = base[school];
  const attack = {
    // fire: draw the fireball back, then hurl it forward
    fire: (p: number) => {
      const back = p < 0.4 ? p / 0.4 : Math.max(0, 1 - (p - 0.4) / 0.12);
      const thr = p >= 0.4 ? Math.min(1, (p - 0.4) / 0.12) * (1 - Math.max(0, (p - 0.7) / 0.3)) : 0;
      return { pose: { armR: [50 * back - 95 * thr, 0, -10 * back], foreR: [-40 * back + 45 * thr, 0, 0], chest: [4 * back - 8 * thr, 20 * back - 25 * thr, 0], armL: [-30 * thr, 0, 10 * thr] }, bob: -0.02 * thr };
    },
    // ice: raise the staff, then thrust its crystal at the target
    ice: (p: number) => {
      const up = p < 0.35 ? p / 0.35 : 1 - Math.min(1, (p - 0.35) / 0.1);
      const th = p >= 0.35 ? Math.min(1, (p - 0.35) / 0.1) * (1 - Math.max(0, (p - 0.65) / 0.35)) : 0;
      return { pose: { armL: [-60 * up - 70 * th, 0, 12 * up], foreL: [-30 * up + 10 * th, 0, 0], chest: [-5 * up + 6 * th, -12 * th, 0], armR: [-20 * th, 0, -20 * up] } };
    },
    // water: a sweeping whip from high-left to low-right
    water: (p: number) => {
      const wind = p < 0.35 ? p / 0.35 : 0;
      const whip = p >= 0.35 && p < 0.6 ? (p - 0.35) / 0.25 : p >= 0.6 ? 1 - (p - 0.6) / 0.4 : 0;
      return { pose: { armR: [-110 * wind - 60 * whip, 0, -40 * wind + 30 * whip], foreR: [-30 * wind + 10 * whip, 0, 0], chest: [0, 25 * wind - 30 * whip, 0], armL: [-20 * whip, 0, 30 * whip] } };
    },
    // air: a flat horizontal sweep of the fan
    air: (p: number) => {
      const wind = p < 0.3 ? p / 0.3 : 0;
      const sw = p >= 0.3 && p < 0.5 ? (p - 0.3) / 0.2 : p >= 0.5 ? 1 - (p - 0.5) / 0.5 : 0;
      return { pose: { armR: [-20 * wind - 30 * sw, 40 * wind - 60 * sw, 30 * wind - 50 * sw], foreR: [10 * wind, 0, 0], chest: [0, 25 * wind - 30 * sw, 0] } };
    },
  }[school];
  // spell channel: arms rise and gather power; the fire and water adepts spread wide, the ice
  // adept raises the staff high, the air adept circles the fan overhead
  const cast = (p: number) => {
    const rise = Math.min(1, p / 0.35);
    const pulse = wave(p, 2) * 0.5 + 0.5;
    const s = school === 'ice' ? { armL: [-165 * rise, 0, 10], foreL: [-10, 0, 0], armR: [-40 * rise, 0, -30 * rise] } :
      school === 'air' ? { armR: [-160 * rise, 30 * Math.sin(p * Math.PI * 4), -10], foreR: [-20, 0, 0], armL: [-60 * rise, 0, 40 * rise] } :
        { armL: [-120 * rise, 0, 45 * rise + 6 * pulse], armR: [-120 * rise, 0, -45 * rise - 6 * pulse], foreL: [-30 * rise, 0, 0], foreR: [-30 * rise, 0, 0] };
    return { pose: { ...(s as Pose), chest: [-8 * rise, 0, 0] as [number, number, number], head: [-10 * rise, 0, 0] as [number, number, number] }, bob: 0.03 * rise * pulse };
  };
  const anims = [
    idleCycle(b, 0.9),
    walkCycle(b, { holdL: school === 'ice', holdR: school === 'air' || school === 'fire', armSwing: 16, stride: 26 }),
    makeAnim('attack', 1.1, attack as (p: number) => { pose: Pose; bob?: number }, b),
    makeAnim('cast', 0.9, cast, b),
  ];
  const hand = school === 'ice' ? HAND_L : HAND_R;
  return { mesh: mb, skeleton: SKELETON, skin: SKIN_ZONES, animations: anims, sockets: [{ name: 'cast', pos: [hand[0], 1.3, 0.35] as V3, joint: school === 'ice' ? 'foreL' : 'foreR' }], ao: { maxDist: 0.6 } };
}

const recipe = (school: School, name: string, hanzi: string): Recipe => ({ id: `azure_${school}_adept`, name, hanzi, category: 'unit', build: () => build(school) });
export const fireAdept = recipe('fire', 'Fire Adept', '火术士');
export const iceAdept = recipe('ice', 'Ice Adept', '冰术士');
export const waterAdept = recipe('water', 'Water Adept', '水术士');
export const airAdept = recipe('air', 'Air Adept', '风术士');
