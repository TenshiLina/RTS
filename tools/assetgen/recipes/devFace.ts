// Viewer-only: face comparison sheet — the published v2 head beside the v4 sculpt (clay and
// painted), for neutral-lit reviews (viewer ?studio=1).

import { MeshBuilder } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import type { V3 } from '../../../src/core/math';
import { buildHead } from './figure';
import { headSDF4, FaceShape, headWeight4 } from './head4';
import { facePainter4, FaceLook4 } from './facePaint4';
import { eyePainter, SKIN_TONES } from './facePaint';
import { meshSDF } from './head';
import { srcOf } from '../kit/cache';
import { painted } from '../tex/paint';
import { PaintedShading, MaterialDef } from '../../../src/core/materialModel';

const SRC4 = srcOf(new URL('./head4.ts', import.meta.url).href);
const SRC_EAR = srcOf(new URL('./ear4.ts', import.meta.url).href);
const CLAY: MaterialDef = { ...PAL.skin, name: 'clay', color: 0xc9a58c, roughness: 0.6, pattern: 0 };

export interface FaceCase {
  shape: Partial<FaceShape>;
  age: number;
  look: Omit<FaceLook4, 'clay'>;
  v2: Parameters<typeof buildHead>[2];
}
export const FACE_CASES: FaceCase[] = [
  { shape: { width: 0.97, jaw: 0.95, eyes: 1.06 }, age: 0.15, look: { tone: SKIN_TONES.tan, brows: 'calm', stubble: 0.25 }, v2: { brows: 'calm', hair: 'none', age: 0.15, shape: { width: 0.96, jaw: 0.92, eyes: 1.04 } } },
  { shape: { width: 1.05, jaw: 1.2, nose: 1.06, brow: 1.3 }, age: 0.35, look: { tone: SKIN_TONES.weathered, brows: 'stern', stubble: 0.7 }, v2: { brows: 'stern', hair: 'none', age: 0.35, shape: { width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 } } },
];

/** Head centre for case i, column c (0 = v2, 1 = v4 clay). */
export const faceAt = (i: number, c: number): V3 => [c * 1.5 + i * 5, 1.6, 0];

export const devFace: Recipe = {
  id: 'dev_face',
  name: 'Face review',
  category: 'dev',
  build() {
    const mb = new MeshBuilder('dev_face');
    FACE_CASES.forEach((fc, i) => {
      // v2 (published): pieced features on a displaced sphere
      const o2 = faceAt(i, 0);
      mb.with(null, () => mb.at(o2[0], 0, 0, () => buildHead(mb, 0, { ...fc.v2, skin: CLAY })), {});
      // v4: one sculpt, clay
      const hs = headSDF4(fc.shape, fc.age);
      const t = Date.now();
      const m = meshSDF(hs.f, [-0.11, -0.21, -0.135], [0.11, 0.14, 0.15], 0.001, 7000, { key: `head4|${JSON.stringify(fc.shape)}|${fc.age}`, deps: [SRC4, SRC_EAR] }, headWeight4(hs), 3);
      console.log(`    head4 ${i}: ${m.idx.length / 3} tris ${Date.now() - t} ms`);
      // v4 twice: clay (form only) and painted
      for (const col of [1, 2]) {
        const o4 = faceAt(i, col);
        const skin = painted(CLAY, facePainter4(hs, o4, { ...fc.look, clay: col === 1 }), { density: 3, shading: col === 2 ? PaintedShading.Skin : undefined, name: `face4_${i}_${col}` });
        mb.with(null, () => mb.at(o4[0], o4[1], o4[2], () => mb.mesh(m.pos, m.idx, m.nrm)), { mat: skin });
        for (const e of hs.eyes) {
          const c: V3 = [o4[0] + e.c[0], o4[1] + e.c[1], o4[2] + e.c[2]];
          mb.with(null, () => mb.at(c[0], c[1], c[2], () => mb.sphere(e.R, 24, 16)), { mat: painted(PAL.skin, eyePainter(c, [-Math.sign(e.c[0]) * 0.05, -0.04, 1]), { density: 5, shading: PaintedShading.Eye, name: `eye4_${i}_${col}_${e.c[0] > 0 ? 'l' : 'r'}` }) });
        }
      }
    });
    return { mesh: mb, ao: false };
  },
};
void PaintedShading;
