// Head comparison: v2 (published) | v5 SDF block-in | MakeHuman base (fitted), untextured clay,
// same framing (each scaled to the same eye-to-chin height), front / ¾ / profile, beside the sheet.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { MeshBuilder } from '../../../../../../home/user/RTS/tools/assetgen/kit/mesh';
import { buildHead } from '../../../../../../home/user/RTS/tools/assetgen/recipes/figure';
import { rasterize, RasterMesh } from '../../../../../../home/user/RTS/tools/assetgen/sdf/raster';
import { figureMeshes } from '../../../../../../home/user/RTS/tools/assetgen/dev/figureMesh';
type V3 = [number, number, number];
const D = '/tmp/claude-0/-home-user-RTS/7cbdeb0b-2b06-59a2-89cd-7961a0df60b5/scratchpad/mh/';

// v2: the published head (clay), soup of triangles with its own normals
const mb = new MeshBuilder('v2');
buildHead(mb, 0, { brows: 'calm', hair: 'none', age: 0.15, shape: { width: 0.96, jaw: 0.92, eyes: 1.04 } });
const v2pos: number[] = [], v2nrm: number[] = [], v2idx: number[] = [];
for (const t of mb.tris) for (let k = 0; k < 3; k++) { v2pos.push(...t.p[k]); v2nrm.push(...t.n[k]); v2idx.push(v2idx.length); }
const v2: RasterMesh = { pos: v2pos, idx: v2idx, nrm: v2nrm };
// v5 SDF: body + hands mesh (the hair layer left out — every head bald for a fair read of form)
const { layers } = figureMeshes();
const v5 = layers[0].mesh;
// MakeHuman fitted
const mh = JSON.parse(readFileSync(D + 'mesh_fit.json', 'utf8'));
const mhm: RasterMesh = { pos: mh.pos, idx: mh.idx };

// framing: eye line and chin per head (head-local numbers measured once)
const heads: { name: string; mesh: RasterMesh; eyeY: number; chinY: number; cz: number }[] = [
  { name: 'v2', mesh: v2, eyeY: 1.619, chinY: 1.479, cz: 0.012 },
  { name: 'v5', mesh: v5, eyeY: 1.561, chinY: 1.561 - 0.107, cz: 0.0 },
  { name: 'mh', mesh: mhm, eyeY: Number(process.env.MH_EYE ?? 1.561), chinY: Number(process.env.MH_CHIN ?? 1.455), cz: Number(process.env.MH_CZ ?? 0.0) },
];
const W = 260, H = 320;
const files: string[] = [];
for (const h of heads) {
  const span = h.eyeY - h.chinY; // → 0.3 of the frame height
  const half = span / 0.3 / 2;
  for (const [n, yaw] of [['f', 0], ['q', 38], ['s', 90]] as const) {
    const { rgba } = rasterize([{ mesh: h.mesh }], { yaw, pitch: 0, dist: half, target: [0, h.eyeY - span * 0.35, h.cz], fov: 0, w: W, h: H });
    const f = `${D}hd_${h.name}_${n}.rgba`;
    writeFileSync(f, rgba);
    files.push(f);
  }
}
spawnSync('python3', ['-c', `
import numpy as np
from PIL import Image, ImageDraw
W,H=${W},${H}
sheet=Image.open('/home/user/RTS/docs/art/factions/human/human-female-turnaround.webp').convert('RGB')
# reference crops scaled so eye-to-chin = 0.3 H: front close-up eye row 282, chin row ~399 (117 px)
def refcrop(ey, chin, cx):
    span=chin-ey; half=span/0.3/2; top=ey-(0.5-0.35)*2*half - half + half  # centre at ey+0.35*span
    c=ey+0.35*span
    box=(int(cx-half*W/H), int(c-half), int(cx+half*W/H), int(c+half))
    return np.asarray(sheet.crop(box).resize((W,H),Image.LANCZOS))
rf=refcrop(282,399,1309)
rs=refcrop(${Number(process.env.RQ_EYE ?? 700)},${Number(process.env.RQ_CHIN ?? 812)},${Number(process.env.RQ_CX ?? 1300)})
rows=[]
for name in ['v2','v5','mh']:
    ims=[np.frombuffer(open('${D}hd_'+name+'_'+n+'.rgba','rb').read(),dtype=np.uint8).reshape(H,W,4)[:,:,:3] for n in ['f','q','s']]
    rows.append(np.concatenate(ims,1))
ref=np.concatenate([rf,np.full((H,W,3),40,np.uint8),rs],1)
out=np.concatenate([ref]+rows,0)
img=Image.fromarray(out); d=ImageDraw.Draw(img)
for i,t in enumerate(['concept (front, profile close-up)','v2 published (clay)','v5 SDF block-in (current)','MakeHuman CC0 base mesh (face not yet fitted)']):
    d.text((6,i*H+6),t,fill=(255,230,120))
img.save('${D}heads.png')
`], { stdio: 'inherit' });
