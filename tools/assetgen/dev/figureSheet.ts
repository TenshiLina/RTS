// Figure review against the concept sheet: meshes figure v5 once (cached), draws it in the
// sheet's front / side / back / ¾ views at the sheet's own pixel scale, and writes a sheet of
// [reference | clay | outlines] per view (reference outline cyan, ours red) with the silhouette
// overlap (IoU) of each view, plus ray-marched face close-ups.
//   npx tsx tools/assetgen/dev/figureSheet.ts out.png

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { V3 } from '../../../src/core/math';
import { Q34 } from '../recipes/figure5';
import { figureMeshes, HAIR_ALBEDO } from './figureMesh';
import { rasterize } from '../sdf/raster';
import { renderSDF } from '../sdf/preview';
import { loadRef, refMask } from '../ref/refSheet';

const REF = 'human-female';
const SHEET = fileURLToPath(new URL('../../../docs/art/factions/human/human-female-turnaround.webp', import.meta.url));
const VIEWS: { name: 'front' | 'side' | 'back' | 'q34'; yaw: number; x0: number; x1: number }[] = [
  { name: 'front', yaw: 0, x0: 0, x1: 368 },
  { name: 'side', yaw: 90, x0: 383, x1: 541 },
  { name: 'back', yaw: 180, x0: 558, x1: 900 },
  { name: 'q34', yaw: Number(process.env.Q34_YAW ?? 40), x0: 900, x1: 1190 },
];

const out = process.argv[2] ?? 'figure.png';
const ref = loadRef(REF);
const t0 = Date.now();
const { fig, layers } = figureMeshes(REF);
console.log(`meshes: ${layers.map((l) => l.mesh.idx.length / 3).join(' + ')} tris (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
const HAIR = HAIR_ALBEDO;

const dir = mkdtempSync(join(tmpdir(), 'fig-'));
const H = 1000;
const s = ref.scale;
const shotFor = (v: (typeof VIEWS)[number], yawDeg: number) => {
  const rv = ref.views[v.name];
  const w = v.x1 - v.x0;
  // column c of the crop ↔ sheet column v.x0 + c ↔ figure coordinate (v.x0 + c − cx)·s along the
  // view's right vector; row r ↔ height (sole − r)·s
  const yaw = (yawDeg * Math.PI) / 180;
  const right: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const offR = (w / 2 - (rv.cx - v.x0)) * s;
  const target: V3 = [right[0] * offR, (rv.sole - H / 2) * s, right[2] * offR];
  return { yaw: yawDeg, pitch: 0, dist: (H / 2) * s, target, fov: 0, w, h: H };
};
const iou = (a: Uint8Array, b: Uint8Array) => {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) {
    const p = a[k] > 0, q = b[k] > 0;
    if (p && q) i++;
    if (p || q) u++;
  }
  return i / u;
};
// the ¾ view's turn and centre line are not known: search both
const q34Shift = { dx: 0 };
{
  const v = VIEWS[3];
  const rv = ref.views[v.name];
  const rm = refMask(rv, s, v.x0, v.x1 - v.x0, H);
  const cx0 = rv.cx;
  let best = { yaw: v.yaw, dx: 0, score: -1 };
  const tryAt = (yaw: number, dx: number) => {
    rv.cx = cx0 + dx;
    const sc = iou(rasterize(layers, shotFor(v, yaw)).mask, rm);
    if (sc > best.score) best = { yaw, dx, score: sc };
  };
  if (!process.env.SEARCH) {
    const [yaw, dx] = (process.env.Q34 ?? `${Q34.yaw},${Q34.dxPx}`).split(',').map(Number);
    tryAt(yaw, dx);
  } else {
    for (let yaw = 20; yaw <= 65; yaw += 5) for (let dx = -30; dx <= 30; dx += 6) tryAt(yaw, dx);
    const c = { ...best };
    for (let yaw = c.yaw - 4; yaw <= c.yaw + 4; yaw += 1) for (let dx = c.dx - 5; dx <= c.dx + 5; dx += 1) tryAt(yaw, dx);
  }
  rv.cx = cx0 + best.dx;
  q34Shift.dx = best.dx;
  v.yaw = best.yaw;
  console.log(`¾ view: turn ${best.yaw}°, centre ${best.dx >= 0 ? '+' : ''}${best.dx} px (IoU ${best.score.toFixed(3)})`);
}
const meta: { name: string; file: string; w: number; h: number; x0: number }[] = [];
for (const v of VIEWS) {
  const w = v.x1 - v.x0;
  const { rgba, mask } = rasterize(layers, shotFor(v, v.yaw));
  const file = join(dir, `${v.name}`);
  writeFileSync(file + '.rgba', rgba);
  writeFileSync(file + '.mask', mask);
  meta.push({ name: v.name, file, w, h: H, x0: v.x0 });
}
// face close-ups (ray-marched): front and ¾
const eyes: { c: V3; R: number; look: V3 }[] = []; // (block-in: the lids are closed)
// framed like the sheet's portrait crops (head and neck, the ¾ one turned most of the way)
for (const [name, yaw] of [['face_front', 0], ['face_q34', 68]] as const) {
  const both: typeof fig.f = (x, y, z) => Math.min(fig.headRegion(x, y, z), fig.hair(x, y, z));
  const albedo = (p: V3): V3 => (fig.hair(p[0], p[1], p[2]) < fig.headRegion(p[0], p[1], p[2]) ? HAIR : [0.58, 0.4, 0.3]);
  const px = renderSDF(both, [-0.13, 1.36, -0.17], [0.13, 1.78, 0.17], { yaw, pitch: 0, dist: 1.84, target: [0, 1.57, 0.0], fov: 10, w: 300, h: 380 }, eyes, [0.58, 0.4, 0.3], albedo);
  writeFileSync(join(dir, name + '.rgba'), px);
}
const py = `
import json, numpy as np
from PIL import Image, ImageDraw
meta=json.loads('''${JSON.stringify(meta)}''')
sheet=Image.open('${SHEET}').convert('RGB')
H=${H}
cols=[]; scores=[]
def edge(m):
    e=np.zeros_like(m)
    e[1:-1,1:-1]=m[1:-1,1:-1] & ~(m[:-2,1:-1] & m[2:,1:-1] & m[1:-1,:-2] & m[1:-1,2:])
    return e
gap=[372,376,380,548,552,556]
im=np.asarray(sheet).astype(float)
bg=np.median(im[:,gap,:],axis=1)
d=np.sqrt(((im-bg[:,None,:])**2).sum(2)); ch=im.max(2)-im.min(2); bgc=bg.max(1)-bg.min(1)
refm=(d>14)|(np.abs(ch-bgc[:,None])>6)
for m in meta:
    w=m['w']; x0=m['x0']
    ours=np.frombuffer(open(m['file']+'.rgba','rb').read(),dtype=np.uint8).reshape(H,w,4)[:,:,:3]
    om=np.frombuffer(open(m['file']+'.mask','rb').read(),dtype=np.uint8).reshape(H,w)>0
    refcrop=np.zeros((H,w,3),np.uint8); rm=np.zeros((H,w),bool)
    hh=min(H,sheet.height)
    refcrop[:hh]=np.asarray(sheet)[:hh,x0:x0+w]
    rm[:hh]=refm[:hh,x0:x0+w]
    sole=[${VIEWS.map((v) => ref.views[v.name].sole).join(',')}][[${VIEWS.map((v) => `'${v.name}'`).join(',')}].index(m['name'])]
    rm[sole+2:]=False
    inter=(rm&om).sum(); uni=(rm|om).sum(); scores.append((m['name'], inter/uni))
    ov=(refcrop.astype(float)*0.55+60).astype(np.uint8)
    ov[edge(rm)]=[0,230,255]; ov[edge(om)]=[255,40,40]
    cols.append(np.concatenate([refcrop, ours, ov],1))
    cols.append(np.full((H,8,3),30,np.uint8))
row=np.concatenate(cols,1)
faces=[np.frombuffer(open('${dir}/'+n+'.rgba','rb').read(),dtype=np.uint8).reshape(380,300,4)[:,:,:3] for n in ['face_front','face_q34']]
refface=np.asarray(sheet.crop((1175,40,1448,500)).resize((300,int(460*300/273))))[:380]
refface2=np.asarray(sheet.crop((1175,520,1448,900)).resize((300,int(380*300/273))))[:380]
fr=np.concatenate([refface, faces[0], refface2, faces[1]],1)
canvas=np.full((H+40+380, max(row.shape[1], fr.shape[1]),3),30,np.uint8)
canvas[40:40+H,:row.shape[1]]=row
canvas[40+H:40+H+380,:fr.shape[1]]=fr
img=Image.fromarray(canvas); dr=ImageDraw.Draw(img)
x=0
for (n,sc),m in zip(scores,meta):
    dr.text((x+6,10), f"{n}: reference | clay | outlines (cyan ref, red ours)  IoU {sc:.3f}", fill=(255,230,180)); x+=m['w']*3+8
img.save('${out}')
print(' '.join(f'{n}={sc:.3f}' for n,sc in scores))
`;
const r = spawnSync('python3', ['-c', py], { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
console.log(`${out} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
