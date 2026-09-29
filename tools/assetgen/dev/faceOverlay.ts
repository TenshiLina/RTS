// Face check against the concept sheet's front close-up: figure v5's head ray-marched (clay, no
// texture) at the close-up's own scale — pupils aligned (6.34 cm apart = 70 px at x 1274/1344,
// row 282) — beside the reference, and the reference with our silhouette drawn over it.
//   npx tsx tools/assetgen/dev/faceOverlay.ts out.png

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { V3 } from '../../../src/core/math';
import { figure5SDF, head5Block } from '../recipes/figure5';
import { loadJson, refJsonPath } from '../ref/refSheet';
import { renderSDF } from '../sdf/preview';

const SHEET = fileURLToPath(new URL('../../../docs/art/factions/human/human-female-turnaround.webp', import.meta.url));
const out = process.argv[2] ?? 'face.png';
const fig = figure5SDF();
const PX = 0.0634 / 70; // metres per sheet pixel in the close-up
const BOX = [1175, 190, 1448, 470]; // crop of the close-up
const EYE = { x: 1309, y: 282, worldY: 1.561 };
const SC = 2;
const w = (BOX[2] - BOX[0]) * SC, h = (BOX[3] - BOX[1]) * SC;
// orthographic: the crop's centre in world space
const cx = ((BOX[0] + BOX[2]) / 2 - EYE.x) * PX, cy = EYE.worldY - ((BOX[1] + BOX[3]) / 2 - EYE.y) * PX;
const both = (x: number, y: number, z: number) => Math.min(fig.headRegion(x, y, z), fig.hair(x, y, z));
const albedo = (p: V3): V3 => (fig.hair(p[0], p[1], p[2]) < fig.headRegion(p[0], p[1], p[2]) ? [0.075, 0.058, 0.05] : [0.58, 0.4, 0.3]);
const px = renderSDF(both, [-0.14, 1.36, -0.17], [0.14, 1.8, 0.17], { yaw: 0, pitch: 0, dist: ((BOX[3] - BOX[1]) / 2) * PX, target: [cx, cy, 0], fov: 0, w, h }, [], [0.58, 0.4, 0.3], albedo);
const dir = mkdtempSync(join(tmpdir(), 'face-'));
writeFileSync(join(dir, 'ours.rgba'), px);
// jaw outlines, front view: the sheet's (ref/face_front.py) and ours — the lowest point of the head
// in front of the neck at each x — as sheet pixels
const jawRef: [number, number][] = loadJson(refJsonPath('human-female-face')).jaw;
const H = head5Block();
const jawOurs: [number, number][] = [];
for (let x = 0; x <= 0.06; x += 0.0025) {
  for (let y = -0.13; y < -0.03; y += 0.0005) {
    let inside = false;
    for (let z = 0.03; z < 0.13 && !inside; z += 0.002) if (H.head(x, y, z) < 0) inside = true;
    if (inside) {
      jawOurs.push([x, y]);
      break;
    }
  }
}
const toPx = (x: number, y: number) => [(EYE.x + x / PX - BOX[0]) * SC, (EYE.y - y / PX - BOX[1]) * SC];
const lines = { ref: jawRef.flatMap(([x, y]) => [toPx(x, y), toPx(-x, y)]), ours: jawOurs.flatMap(([x, y]) => [toPx(x, y), toPx(-x, y)]) };
writeFileSync(join(dir, 'jaw.json'), JSON.stringify(lines));
const py = `
import numpy as np
from PIL import Image
w,h=${w},${h}
ours=np.frombuffer(open('${dir}/ours.rgba','rb').read(),dtype=np.uint8).reshape(h,w,4)[:,:,:3]
ref=np.asarray(Image.open('${SHEET}').convert('RGB').crop((${BOX.join(',')})).resize((w,h),Image.LANCZOS))
bg=ours[2,2].astype(int)
m=(np.abs(ours.astype(int)-bg).sum(2)>12)
e=np.zeros_like(m); e[1:-1,1:-1]=m[1:-1,1:-1]&~(m[:-2,1:-1]&m[2:,1:-1]&m[1:-1,:-2]&m[1:-1,2:])
rf=ref.astype(int); gray=(np.abs(rf[:,:,0]-rf[:,:,1])<8)&(np.abs(rf[:,:,1]-rf[:,:,2])<8)&(rf.max(2)>85)&(rf.max(2)<125)
rm=~gray
er=np.zeros_like(rm); er[1:-1,1:-1]=rm[1:-1,1:-1]&~(rm[:-2,1:-1]&rm[2:,1:-1]&rm[1:-1,:-2]&rm[1:-1,2:])
ov=(ref.astype(float)*0.6+50).astype(np.uint8); ov[er]=[0,230,255]; ov[e]=[255,40,40]
import json
from PIL import ImageDraw
J=json.load(open('${dir}/jaw.json'))
ovi=Image.fromarray(ov); d=ImageDraw.Draw(ovi)
for x,y in J['ref']: d.ellipse([x-2,y-2,x+2,y+2],fill=(0,230,255))
for x,y in J['ours']: d.ellipse([x-1.5,y-1.5,x+1.5,y+1.5],fill=(255,40,40))
Image.fromarray(np.concatenate([ref,ours,np.asarray(ovi)],1)).save('${out}')
`;
spawnSync('python3', ['-c', py], { stdio: 'inherit' });
console.log(out);
