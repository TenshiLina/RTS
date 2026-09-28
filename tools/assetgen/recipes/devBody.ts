// Viewer-only: the body + garment kit on a static figure (review sheet).

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import type { V3 } from '../../../src/core/math';
import { SDF, ellipsoid, capsule, torus, box, mirrorX, carve, union, rotated } from '../sdf/sdf';
import { bodySDF } from './body';
import { garment, bunching, pleats } from './garments';
import { cloth, leather, lamellar, metal } from '../tex/painters';
import { painted } from '../tex/paint';
import { srcOf } from '../kit/cache';
import { headSDF, meshSDF, HEAD_SRC, headWeight } from './head';
import { facePainter, eyePainter, SKIN_TONES } from './facePaint';
import { handSDF, fingertips } from './hands';
import { bootSDF } from './boots';
import { SKELETON } from './humanoid';
import { skinPaint, sstep, mix3 } from '../tex/painters';
import { sdfOcclusion, normalAt } from '../sdf/sdf';
import { lin } from '../tex/paint';
import { PaintedShading } from '../../../src/core/materialModel';

const SRC = srcOf(import.meta.url);
const hy = (y0: number, y1: number): SDF => (_x, y) => Math.max(y - y1, y0 - y);
/** Place canonical left-side geometry at `at`, mirrored for the right side. */
const T3 = (at: V3, side: 1 | -1) => T(at[0], at[1], at[2], [0, 0, 0], [side, 1, 1]);

export const devBody: Recipe = {
  id: 'dev_body',
  name: 'Body + garments',
  category: 'dev',
  build() {
    const mb = new MeshBuilder('dev_body');
    const body = bodySDF({ build: 1 });
    const g = (name: string, spec: Parameters<typeof garment>[0]) => {
      const t = Date.now();
      const r = garment({ ...spec, deps: [SRC] });
      console.log(`    ${name}: ${r.mesh.idx.length / 3} tris ${Date.now() - t} ms`);
      return r;
    };

    // ---- trousers: baggy, gathered into the boots
    const trousers = g('trousers', {
      key: 'trousers2', inner: body.legs, t0: 0.004, t1: 0.02, region: hy(0.3, 1.02),
      folds: (x, y, z) => bunching(0.004, 60, 1)(x, y, z) * (1 - Math.min(1, Math.abs(y - 0.5) / 0.3)) + bunching(0.003, 90, 2)(x, y, z) * (y < 0.42 ? 1 : 0),
      bounds: [[-0.24, 0.26, -0.18], [0.24, 1.06, 0.2]], tris: 3000,
    });
    mb.with(null, () => mb.mesh(trousers.mesh.pos, trousers.mesh.idx, trousers.mesh.nrm), {
      mat: painted({ ...PAL.clothIndigo, name: 'trousers' }, cloth({ color: 0x2d3558, hem: trousers.hem, dirt: 0.5, bands: [{ from: 0, to: 0.025, color: 0x1c2036 }] })),
      skinMode: 'auto',
    });

    // ---- tunic: torso and sleeves to the wrist, crossed collar
    const tunicIn = body.clothTop;
    const tunicRegion: SDF = (x, y, z) => {
      const neckHole = Math.max(Math.hypot(x, z) - 0.068, 1.36 - y);
      const vNeck = Math.max(0.02 - z, Math.abs(x) - (0.04 + (1.47 - y) * 0.35), 1.28 - y);
      return Math.max(0.948 - y, -neckHole, -vNeck);
    };
    const tunic = g('tunic', {
      key: 'tunic3', inner: tunicIn, t0: 0.004, t1: 0.012, region: tunicRegion,
      folds: (x, y, z) => (Math.abs(x) > 0.2 ? bunching(0.003, 70, 3)(x, y, z) : 0),
      bounds: [[-0.36, 0.9, -0.2], [0.36, 1.56, 0.2]], tris: 3200, keepInner: 0.06,
    });
    mb.with(null, () => mb.mesh(tunic.mesh.pos, tunic.mesh.idx, tunic.mesh.nrm), {
      mat: painted({ ...PAL.clothRed, name: 'tunic', doubleSided: false }, cloth({ color: 0xb52d24, hem: tunic.hem, bands: [{ from: 0, to: 0.03, color: 0x1f1c22, motif: 'meander', motifColor: 0xc9a24e, scale: 0.03 }] })),
      skinMode: 'auto',
    });

    // ---- lamellar cuirass over the chest and belly
    const cuirassRegion: SDF = (x, y, z) => {
      const arm = Math.min(Math.hypot(x - 0.215, y - 1.40, z) - 0.095, Math.hypot(x + 0.215, y - 1.40, z) - 0.095);
      const neck = 0.085 - Math.hypot(x, z) - Math.max(0, y - 1.38) * 0;
      return Math.max(Math.max(y - 1.43, 1.0 - y), Math.max(-arm, y > 1.36 ? neck : -1));
    };
    const cuirass = g('cuirass', {
      key: 'cuirass2', inner: body.torso, t0: 0.018, t1: 0.034, region: cuirassRegion,
      bounds: [[-0.3, 0.95, -0.2], [0.3, 1.5, 0.22]], tris: 2600, cell: 0.0035,
    });
    mb.with(null, () => mb.mesh(cuirass.mesh.pos, cuirass.mesh.idx, cuirass.mesh.nrm), {
      mat: painted({ ...PAL.lamellarTeam, name: 'cuirass' }, lamellar({ plate: 0x8a8f96, lace: 0x2a1a14, plateTeam: 0.75, laceTeam: 0, plateMetal: 0.5, hem: cuirass.hem, trim: { width: 0.018, color: 0x5a3a24 } })),
      joint: 2, soft: true,
    });

    // ---- armour skirt: four panels hanging from the belt
    const skirtSolid: SDF = (x, y, z) => {
      const t = Math.max(0, Math.min(1, (1.03 - y) / 0.42));
      const rx = 0.176 + t * 0.07, rz = 0.14 + t * 0.06;
      const d = (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
      return Math.abs(d) - 0.006;
    };
    const skirtRegion: SDF = (x, y, z) => {
      const a = Math.atan2(x, z);
      const slit = 0.012 - Math.min(...[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((c) => Math.abs(Math.atan2(Math.sin(a - c - Math.PI / 4), Math.cos(a - c - Math.PI / 4))))) * 0.2;
      return Math.max(Math.max(y - 1.03, 0.62 - y), y < 1.0 ? slit : -1);
    };
    const skirt = g('skirt', { key: 'skirt2', solid: skirtSolid, region: skirtRegion, bounds: [[-0.28, 0.58, -0.24], [0.28, 1.06, 0.24]], tris: 1800 });
    mb.with(null, () => mb.mesh(skirt.mesh.pos, skirt.mesh.idx, skirt.mesh.nrm), {
      mat: painted({ ...PAL.lamellarTeam, name: 'skirt' }, lamellar({ plate: 0x8a8f96, lace: 0x2a1a14, plateTeam: 0.75, plateMetal: 0.5, hem: skirt.hem, trim: { width: 0.016, color: 0x5a3a24 } })),
      skinMode: 'skirt',
    });

    // ---- belt with a bronze buckle
    const beltSolid: SDF = (x, y, z) => {
      const d = (Math.hypot(x / 0.192, z / 0.158) - 1) * 0.158;
      return Math.max(Math.abs(d) - 0.01, Math.abs(y - 1.025) - 0.025);
    };
    const belt = g('belt', { key: 'belt2', solid: beltSolid, region: () => -1, bounds: [[-0.22, 0.98, -0.19], [0.22, 1.07, 0.19]], tris: 700, cell: 0.0025 });
    mb.with(null, () => mb.mesh(belt.mesh.pos, belt.mesh.idx, belt.mesh.nrm), {
      mat: painted({ ...PAL.leather, name: 'belt' }, leather({ color: 0x6d4527, stitch: 0.005, hem: (p) => 0.025 - Math.abs(p[1] - 1.025) })),
      joint: 2,
    });
    const buckleF = union(box([0, 1.025, 0.162], [0.042, 0.034, 0.008], 0.006));
    const buckle = meshSDF(buckleF, [-0.06, 0.98, 0.14], [0.06, 1.07, 0.18], 0.0015, 300, { key: 'buckle1', deps: [SRC] });
    mb.with(null, () => mb.mesh(buckle.pos, buckle.idx, buckle.nrm), { mat: painted({ ...PAL.bronze, name: 'buckle' }, metal({ color: 0x9a6532, wear: 0.6 })), joint: 2 });

    // ---- head (v3)
    const hs = headSDF({ width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 }, 0.35);
    const HC: V3 = [0, 1.6, 0.012];
    const head = meshSDF(hs.f, [-0.12, -0.205, -0.135], [0.12, 0.145, 0.15], 0.0013, 4200, { key: `head|${JSON.stringify({ width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 })}|0.35`, deps: [HEAD_SRC] }, headWeight(hs));
    mb.with(null, () => mb.at(HC[0], HC[1], HC[2], () => mb.mesh(head.pos, head.idx, head.nrm)), {
      mat: painted(PAL.skin, facePainter(hs, HC, { tone: SKIN_TONES.weathered, brows: 'stern', stubble: 0.8, liner: 0.5 }), { density: 3, shading: PaintedShading.Skin, name: 'skin_head' }),
      joint: 4,
    });
    for (const e of hs.eyes) {
      const c: V3 = [HC[0] + e.c[0], HC[1] + e.c[1], HC[2] + e.c[2]];
      mb.with(null, () => mb.at(c[0], c[1], c[2], () => mb.sphere(e.R, 24, 16)), { mat: painted(PAL.skin, eyePainter(c, [-Math.sign(e.c[0]) * 0.06, -0.04, 1]), { density: 5, shading: PaintedShading.Eye, name: `eye_${e.c[0] > 0 ? 'l' : 'r'}` }), joint: 4 });
    }
    // ---- hands
    const tone = SKIN_TONES.weathered;
    for (const side of [1, -1] as const) {
      const wrist = SKELETON.find((j) => j.name === (side > 0 ? 'handL' : 'handR'))!.pos;
      const pose = 'grip' as const;
      const hf = handSDF(pose);
      const hm = meshSDF(hf, [-0.07, -0.16, -0.06], [0.05, 0.035, 0.08], 0.0011, 1400, { key: `hand|${pose}`, deps: [srcOf(new URL('./hands.ts', import.meta.url).href)] });
      const tips = fingertips(pose);
      const skinP = skinPaint({ color: tone.base, flush: tone.flush });
      const handPaint = (i: any, o: any) => {
        skinP(i, o);
        // back to the canonical frame
        const q: V3 = [(i.p[0] - wrist[0]) * side, i.p[1] - wrist[1], i.p[2] - wrist[2]];
        const n = normalAt(hf, q[0], q[1], q[2], 0.0004);
        o.normal = [n[0] * side, n[1], n[2]];
        o.ao = 1 - sdfOcclusion(hf, q, n, 0.006, 3) * 0.8;
        // nails on the back of each fingertip
        for (const t of tips) {
          const d = Math.hypot(q[0] - (t.tip[0] + 0.004), q[1] - t.tip[1], q[2] - t.tip[2]);
          const back = n[0] > 0.2 ? 1 : 0;
          const nail = (1 - sstep(0.006, 0.0075, d)) * back;
          if (nail > 0) {
            o.albedo = mix3(o.albedo, lin(0xe9c6b4), nail * 0.8);
            o.rough = 0.3;
          }
        }
        // knuckle creases
        o.albedo = mix3(o.albedo, [o.albedo[0] * 0.8, o.albedo[1] * 0.7, o.albedo[2] * 0.7], (1 - o.ao) * 0.4);
      };
      mb.with(T3(wrist, side), () => mb.mesh(hm.pos, hm.idx, hm.nrm), {
        mat: painted({ ...PAL.skin, name: side > 0 ? 'hand_l' : 'hand_r' }, handPaint, { density: 2, shading: PaintedShading.Skin }),
        joint: side > 0 ? 7 : 10,
      });
    }

    // ---- boots
    for (const side of [1, -1] as const) {
      const ank = SKELETON.find((j) => j.name === (side > 0 ? 'footL' : 'footR'))!.pos;
      const bf = bootSDF([Math.abs(ank[0]), ank[1], ank[2]]);
      const bm = meshSDF(bf, [0.02, -0.01, -0.12], [0.18, 0.37, 0.23], 0.002, 1300, { key: 'boot1', deps: [srcOf(new URL('./boots.ts', import.meta.url).href)] });
      const bootP = cloth({ color: 0x1f1b1c, dirt: 0.25, hem: (p) => Math.abs(p[1] - 0.335), bands: [{ from: 0, to: 0.018, color: 0x2e2a2a }] });
      const bootPaint = (i: any, o: any) => {
        bootP(i, o);
        // thick layered white sole
        const sole = 1 - sstep(0.022, 0.026, i.p[1]);
        if (sole > 0) {
          const layers = Math.sin(i.p[1] * 900) * 0.5 + 0.5;
          o.albedo = mix3(o.albedo, mix3(lin(0xd9d1bf), lin(0xb9ae98), layers * 0.4 + (1 - sstep(0, 0.2, i.p[1])) * 0.3), sole);
          o.height += layers * 0.0002 * sole;
          o.rough = 0.9;
        }
      };
      mb.with(T3([0, 0, 0], side), () => mb.mesh(bm.pos, bm.idx, bm.nrm), { mat: painted({ ...PAL.leather, name: side > 0 ? 'boot_l' : 'boot_r' }, bootPaint), skinMode: 'auto' });
    }

    void ellipsoid; void capsule; void torus; void mirrorX; void carve; void rotated; void pleats;
    return { mesh: mb, ao: { maxDist: 0.3, ground: true } };
  },
};
