// Close-up comparisons of figure v5 against the concept sheet for one body region: the sheet's
// four views cropped to the region, beside the cached clay mesh drawn at the same scale (x3).
//   npx tsx tools/assetgen/dev/figureZoom.ts out.png <y0> <y1>      (heights in metres)

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { V3 } from '../../../src/core/math';
import { figureMeshes } from './figureMesh';
import { rasterize } from '../sdf/raster';
import { loadRef } from '../ref/refSheet';

const REF = 'human-female';
const SHEET = fileURLToPath(new URL('../../../docs/art/factions/human/human-female-turnaround.webp', import.meta.url));
const [out, a0, a1] = process.argv.slice(2);
const Y0 = Number(a0), Y1 = Number(a1);
const Q34 = (process.env.Q34 ?? '36,18').split(',').map(Number);
const VIEWS = [
  { name: 'front' as const, yaw: 0, x0: 0, x1: 368, dx: 0 },
  { name: 'side' as const, yaw: 90, x0: 383, x1: 541, dx: 0 },
  { name: 'back' as const, yaw: 180, x0: 558, x1: 900, dx: 0 },
  { name: 'q34' as const, yaw: Q34[0], x0: 900, x1: 1190, dx: Q34[1] },
];
const ref = loadRef(REF);
const { layers } = figureMeshes(REF);
const s = ref.scale, SC = Number(process.env.SC ?? 3);
const dir = mkdtempSync(join(tmpdir(), 'zoom-'));
const meta: { file: string; w: number; h: number; box: number[] }[] = [];
for (const v of VIEWS) {
  const rv = ref.views[v.name];
  const r0 = Math.floor(rv.sole - Y1 / s), r1 = Math.ceil(rv.sole - Y0 / s);
  const w = (v.x1 - v.x0) * SC, h = (r1 - r0) * SC;
  const yaw = (v.yaw * Math.PI) / 180;
  const right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const cx = rv.cx + v.dx;
  const offR = ((v.x1 - v.x0) / 2 - (cx - v.x0)) * s;
  const ty = (rv.sole - (r0 + r1) / 2) * s;
  const { rgba } = rasterize(layers, { yaw: v.yaw, pitch: 0, dist: ((r1 - r0) / 2) * s, target: [right[0] * offR, ty, right[2] * offR], fov: 0, w, h });
  const file = join(dir, v.name + '.rgba');
  writeFileSync(file, rgba);
  meta.push({ file, w, h, box: [v.x0, r0, v.x1, r1] });
}
const py = `
import json, numpy as np
from PIL import Image
meta=json.loads('''${JSON.stringify(meta)}''')
sheet=Image.open('${SHEET}').convert('RGB')
cols=[]
for m in meta:
    w,h=m['w'],m['h']
    ref=np.asarray(sheet.crop(tuple(m['box'])).resize((w,h),Image.LANCZOS))
    ours=np.frombuffer(open(m['file'],'rb').read(),dtype=np.uint8).reshape(h,w,4)[:,:,:3]
    cols.append(np.concatenate([ref,ours],1)); cols.append(np.full((h,6,3),30,np.uint8))
Image.fromarray(np.concatenate(cols,1)).save('${out}')
`;
spawnSync('python3', ['-c', py], { stdio: 'inherit' });
console.log(out);
