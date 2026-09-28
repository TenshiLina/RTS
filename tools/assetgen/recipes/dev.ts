// Viewer-only preview sheets for the character pipeline (category 'dev': never loaded by the game).

import { MeshBuilder } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import { headSDF, meshSDF, FaceShape, HEAD_SRC, headWeight } from './head';
import { facePainter, eyePainter, SKIN_TONES, FaceLook } from './facePaint';
import { painted } from '../tex/paint';
import { PaintedShading } from '../../../src/core/materialModel';
import type { V3 } from '../../../src/core/math';

const HEADS: { shape: Partial<FaceShape>; age: number; look: FaceLook }[] = [
  { shape: { width: 1.06, jaw: 1.2, nose: 1.08, brow: 1.3 }, age: 0.35, look: { tone: SKIN_TONES.weathered, brows: 'stern', stubble: 0.8, liner: 0.5 } }, // halberdier
  { shape: { width: 0.96, jaw: 0.92, eyes: 1.04 }, age: 0.15, look: { tone: SKIN_TONES.tan, brows: 'calm', stubble: 0.3 } }, // archer
  { shape: { width: 0.94, jaw: 0.78, nose: 0.84, eyes: 1.1, lips: 1.2, brow: 0.3, tilt: 8 }, age: 0.05, look: { tone: SKIN_TONES.fair, brows: 'arched', liner: 1 } }, // water adept
  { shape: { width: 0.95, jaw: 0.9, nose: 1.06 }, age: 0.55, look: { tone: SKIN_TONES.warm, brows: 'calm', stubble: 0.4 } }, // daoist
];

export const devHeads: Recipe = {
  id: 'dev_heads',
  name: 'Head sculpts',
  category: 'dev',
  build() {
    const mb = new MeshBuilder('dev_heads');
    HEADS.forEach((h, i) => {
      const hs = headSDF(h.shape, h.age);
      const t = Date.now();
      const m = meshSDF(hs.f, [-0.12, -0.205, -0.135], [0.12, 0.145, 0.15], 0.0013, 4200, { key: `head|${JSON.stringify(h.shape)}|${h.age}`, deps: [HEAD_SRC] }, headWeight(hs));
      console.log(`    head ${i}: ${m.idx.length / 3} tris, ${Date.now() - t} ms`);
      const x = (i - (HEADS.length - 1) / 2) * 0.34;
      const origin: V3 = [x, 1.6, 0];
      const skin = painted(PAL.skin, facePainter(hs, origin, h.look), { density: 3, shading: PaintedShading.Skin, name: `skin_head${i}` });
      mb.with(null, () => mb.at(x, 1.6, 0, () => mb.mesh(m.pos, m.idx, m.nrm)), { mat: skin });
      for (const e of hs.eyes) {
        const c: V3 = [x + e.c[0], 1.6 + e.c[1], e.c[2]];
        const look: V3 = [-Math.sign(e.c[0]) * 0.06, -0.04, 1];
        const eye = painted(PAL.skin, eyePainter(c, look), { density: 5, shading: PaintedShading.Eye, name: `eye_head${i}_${e.c[0] > 0 ? 'l' : 'r'}` });
        mb.with(null, () => mb.at(c[0], c[1], c[2], () => mb.sphere(e.R, 24, 16)), { mat: eye });
      }
    });
    return { mesh: mb, ao: false };
  },
};
