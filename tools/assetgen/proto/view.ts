import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build, IDX, VIEWS, shotFor } from './fit.ts';
import { rasterize } from '../../../../../../home/user/RTS/tools/assetgen/sdf/raster';
const D = '/tmp/claude-0/-home-user-RTS/7cbdeb0b-2b06-59a2-89cd-7961a0df60b5/scratchpad/mh/';
const p = process.env.P ? JSON.parse(process.env.P) : existsSync(D + 'fit.json') ? JSON.parse(readFileSync(D + 'fit.json', 'utf8')) : {};
const pos = build(p);
const meta: any[] = [];
for (const v of VIEWS) {
  const { rgba, mask } = rasterize([{ mesh: { pos, idx: IDX } }], shotFor(v));
  writeFileSync(D + 'v_' + v.name + '.rgba', rgba); writeFileSync(D + 'v_' + v.name + '.mask', mask);
  meta.push({ n: v.name, w: v.x1 - v.x0, x0: v.x0 });
}
for (const [n, yaw] of [['ff', 0], ['fq', 40], ['fs', 90]] as const) {
  const { rgba } = rasterize([{ mesh: { pos, idx: IDX } }], { yaw, pitch: 0, dist: 0.15, target: [0, 1.53, 0.02], fov: 0, w: 300, h: 380 });
  writeFileSync(D + 'v_' + n + '.rgba', rgba);
}
writeFileSync(D + 'mesh_fit.json', JSON.stringify({ pos: Array.from(pos), idx: Array.from(IDX) }));
spawnSync('python3', ['-c', `
import numpy as np, json
from PIL import Image
D='${D}'; meta=json.loads('''${JSON.stringify(meta)}''')
sheet=Image.open('/home/user/RTS/docs/art/factions/human/human-female-turnaround.webp').convert('RGB')
im=np.asarray(sheet).astype(int)
gap=[372,376,380,548,552,556]; bg=np.median(im[:,gap,:],axis=1)
d=np.sqrt(((im-bg[:,None,:])**2).sum(2)); ch=im.max(2)-im.min(2); bgc=bg.max(1)-bg.min(1)
refm=(d>14)|(np.abs(ch-bgc[:,None])>6)
def edge(m):
    e=np.zeros_like(m); e[1:-1,1:-1]=m[1:-1,1:-1]&~(m[:-2,1:-1]&m[2:,1:-1]&m[1:-1,:-2]&m[1:-1,2:]); return e
cols=[]
for m in meta:
    w=m['w']; ours=np.frombuffer(open(D+'v_'+m['n']+'.rgba','rb').read(),dtype=np.uint8).reshape(1000,w,4)[:,:,:3]
    om=np.frombuffer(open(D+'v_'+m['n']+'.mask','rb').read(),dtype=np.uint8).reshape(1000,w)>0
    r=np.zeros((1000,w,3),np.uint8); r[:sheet.height]=np.asarray(sheet)[:1000,m['x0']:m['x0']+w]
    rm=np.zeros((1000,w),bool); rm[:sheet.height]=refm[:1000,m['x0']:m['x0']+w]
    ov=(r*0.55+60).astype(np.uint8); ov[edge(rm)]=[0,230,255]; ov[edge(om)]=[255,40,40]
    cols += [r, ours, ov, np.full((1000,6,3),30,np.uint8)]
row=np.concatenate(cols,1)
f=[np.frombuffer(open(D+'v_'+n+'.rgba','rb').read(),dtype=np.uint8).reshape(380,300,4)[:,:,:3] for n in ['ff','fq','fs']]
rf=np.asarray(sheet.crop((1175,40,1448,500)).resize((300,int(460*300/273))))[:380]
rq=np.asarray(sheet.crop((1175,520,1448,900)).resize((300,int(380*300/273))))[:380]
fr=np.concatenate([rf,f[0],rq,f[1],f[2]],1)
c=np.full((1000+380,max(row.shape[1],fr.shape[1]),3),30,np.uint8); c[:1000,:row.shape[1]]=row; c[1000:,:fr.shape[1]]=fr
Image.fromarray(c).save(D+'${process.env.OUT ?? 'fitview.png'}')
`], { stdio: 'inherit' });
