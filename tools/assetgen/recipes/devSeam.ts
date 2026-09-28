// Viewer-only: texture-pipeline test — an auto-unwrapped sphere whose painted normal is the exact
// sphere normal plus 3D stripes. Any seam or lighting jump means the bake is wrong.

import { MeshBuilder } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import { sphere } from '../sdf/sdf';
import { meshSDF } from './head';
import { painted, lin } from '../tex/paint';
import { srcOf } from '../kit/cache';
import type { V3 } from '../../../src/core/math';

export const devSeam: Recipe = {
  id: 'dev_seam',
  name: 'Bake test',
  category: 'dev',
  build() {
    const mb = new MeshBuilder('dev_seam');
    const C: V3 = [0, 1.2, 0];
    const f = sphere([0, 0, 0], 0.3);
    const m = meshSDF(f, [-0.32, -0.32, -0.32], [0.32, 0.32, 0.32], 0.008, 900, { key: 'seam_sphere', deps: [srcOf(import.meta.url)] });
    const mat = painted({ ...PAL.skin, name: 'seam' }, (i, o) => {
      const d: V3 = [i.p[0] - C[0], i.p[1] - C[1], i.p[2] - C[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      o.normal = [d[0] / l, d[1] / l, d[2] / l];
      o.albedo = lin(0xb8b0a8);
      o.rough = 0.5;
      // stripes as height: continuous in 3D
      o.height = Math.sin(d[1] * 60) * 0.0015;
    }, { name: 'seam_p' });
    mb.with(null, () => mb.at(C[0], C[1], C[2], () => mb.mesh(m.pos, m.idx, m.nrm)), { mat });
    return { mesh: mb, ao: false };
  },
};
