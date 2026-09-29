// Fit the concept sheet's ¾ face close-up (nearly a profile; its jaw and chin are true silhouette
// against the background): renders figure v5's skin silhouette over a range of turns, then finds the
// turn, scale and offset that best match the close-up's skin mask, and writes an overlay.
//   npx tsx tools/assetgen/dev/faceProfileFit.ts out.png

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figureMeshes } from './figureMesh';
import { rasterize } from '../sdf/raster';

const SHEET = fileURLToPath(new URL('../../../docs/art/factions/human/human-female-turnaround.webp', import.meta.url));
const out = process.argv[2] ?? 'profile.png';
const { layers } = figureMeshes();
// skin = drawn pixels that are not hair (the hair layer covers the scalp, as in the reference)
const dir = mkdtempSync(join(tmpdir(), 'pf-'));
const W = 400, H = 400, HALF = 0.16; // ortho half-height (m) around the head
const yaws: number[] = [];
for (let yaw = 50; yaw <= 90; yaw += 2.5) {
  const { rgba, mask } = rasterize(layers, { yaw, pitch: 0, dist: HALF, target: [0, 1.53, 0], fov: 0, w: W, h: H });
  for (let k = 0; k < W * H; k++) if (rgba[k * 4] < 130) mask[k] = 0;
  writeFileSync(join(dir, `${yaw}.mask`), mask);
  writeFileSync(join(dir, `${yaw}.rgba`), rgba);
  yaws.push(yaw);
}
const py = `
import numpy as np
from PIL import Image
W,H,HALF=${W},${H},${HALF}
sheet=Image.open('${SHEET}').convert('RGB')
box=(1175,520,1448,900)
ref=np.asarray(sheet.crop(box)).astype(int)
R,G,B=ref[:,:,0],ref[:,:,1],ref[:,:,2]
rm=(R-B>28)&(R>110)
rm[330:,:]=False   # (below the neck: the top's neckline)
rh,rw=rm.shape
best=(-1,)
for yaw in ${JSON.stringify(yaws)}:
    print('yaw',yaw,best[:1],flush=True) if False else None
    m=np.frombuffer(open('${dir}/'+str(yaw)+'.mask','rb').read(),dtype=np.uint8).reshape(H,W)>0
    for pxm in range(700,1250,25):        # sheet px per metre
        s=pxm*2*HALF/H                    # sheet px per render px
        sw,sh=int(W*s),int(H*s)
        mm=np.asarray(Image.fromarray((m*255).astype(np.uint8)).resize((sw,sh),Image.BILINEAR))>127
        for dy in range(-120,121,6):
            for dx in range(-90,91,6):
                # place the render centre at the crop's (rw/2+dx, rh/2+dy)
                ox=int(rw/2+dx-sw/2); oy=int(rh/2+dy-sh/2)
                canvas=np.zeros((rh,rw),bool)
                x0,y0=max(0,ox),max(0,oy); x1,y1=min(rw,ox+sw),min(rh,oy+sh)
                if x1<=x0 or y1<=y0: continue
                canvas[y0:y1,x0:x1]=mm[y0-oy:y1-oy,x0-ox:x1-ox]
                canvas[330:,:]=False
                i=(canvas&rm).sum(); u=(canvas|rm).sum()
                if i/u>best[0]: best=(i/u,yaw,pxm,dx,dy)
print('best IoU %.3f yaw %s px/m %d dx %d dy %d'%best)
iou,yaw,pxm,dx,dy=best
m=np.frombuffer(open('${dir}/'+str(yaw)+'.mask','rb').read(),dtype=np.uint8).reshape(H,W)>0
rgb=np.frombuffer(open('${dir}/'+str(yaw)+'.rgba','rb').read(),dtype=np.uint8).reshape(H,W,4)[:,:,:3]
s=pxm*2*HALF/H; sw,sh=int(W*s),int(H*s)
ox=int(rw/2+dx-sw/2); oy=int(rh/2+dy-sh/2)
SC=2
big=lambda a,res=Image.LANCZOS: Image.fromarray(a).resize((rw*SC,rh*SC),res)
mm=np.asarray(Image.fromarray((m*255).astype(np.uint8)).resize((sw,sh),Image.BILINEAR))>127
im=np.asarray(Image.fromarray(rgb).resize((sw,sh),Image.LANCZOS))
canvas=np.zeros((rh,rw),bool); ours=np.full((rh,rw,3),[135,138,143],np.uint8)
x0,y0=max(0,ox),max(0,oy); x1,y1=min(rw,ox+sw),min(rh,oy+sh)
canvas[y0:y1,x0:x1]=mm[y0-oy:y1-oy,x0-ox:x1-ox]; ours[y0:y1,x0:x1]=im[y0-oy:y1-oy,x0-ox:x1-ox]
def edge(k):
    e=np.zeros_like(k); e[1:-1,1:-1]=k[1:-1,1:-1]&~(k[:-2,1:-1]&k[2:,1:-1]&k[1:-1,:-2]&k[1:-1,2:]); return e
ov=(ref*0.6+50).astype(np.uint8); ov[edge(rm)]=[0,230,255]; ov[edge(canvas)]=[255,40,40]
res=np.concatenate([np.asarray(big(ref.astype(np.uint8))),np.asarray(big(ours)),np.asarray(big(ov,Image.NEAREST))],1)
Image.fromarray(res).save('${out}')
`;
spawnSync('python3', ['-c', py], { stdio: 'inherit' });
