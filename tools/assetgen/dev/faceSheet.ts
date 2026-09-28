// Face review sheet in seconds: sphere-traced clay renders of head v4 (front, 3/4, profile,
// close-up, plus an orthographic profile/front silhouette pair) for the dev_face cases.
//   npx tsx tools/assetgen/dev/faceSheet.ts out.png [case…]
// Views render in parallel worker processes.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { V3 } from '../../../src/core/math';
import { renderSDF, Shot } from '../sdf/preview';
import { headSDF4 } from '../recipes/head4';
import { FACE_CASES } from '../recipes/devFace';

const W = 360, H = 420;
const VIEWS: Record<string, Omit<Shot, 'w' | 'h'>> = {
  front: { yaw: 0, pitch: 2, dist: 0.85, target: [0, -0.015, 0], fov: 22 },
  q34: { yaw: 38, pitch: 4, dist: 0.85, target: [0, -0.015, 0], fov: 22 },
  side: { yaw: 90, pitch: 2, dist: 0.85, target: [0, -0.015, 0], fov: 22 },
  close: { yaw: 18, pitch: 3, dist: 0.42, target: [0, -0.025, 0.04], fov: 22 },
  low: { yaw: 25, pitch: -18, dist: 0.85, target: [0, -0.03, 0], fov: 22 },
  eye: { yaw: 8, pitch: 2, dist: 0.16, target: [0.03, 0.004, 0.08], fov: 22 },
  eyeside: { yaw: 70, pitch: 2, dist: 0.16, target: [0.03, 0.004, 0.08], fov: 22 },
  mouth: { yaw: 20, pitch: 2, dist: 0.2, target: [0.0, -0.05, 0.09], fov: 22 },
  ear: { yaw: 100, pitch: 5, dist: 0.25, target: [0.07, -0.016, -0.018], fov: 22 },
  earback: { yaw: 150, pitch: 5, dist: 0.3, target: [0.07, -0.016, -0.018], fov: 22 },
  earfront: { yaw: 20, pitch: 5, dist: 0.3, target: [0.07, -0.016, -0.018], fov: 22 },
  below: { yaw: 15, pitch: -50, dist: 0.2, target: [0.0, -0.045, 0.09], fov: 22 },
  nose: { yaw: 35, pitch: -12, dist: 0.2, target: [0.0, -0.035, 0.09], fov: 22 },
};

function worker(ci: number, view: string, out: string) {
  const fc = FACE_CASES[ci];
  const hs = headSDF4(fc.shape, fc.age);
  const eyes = hs.eyes.map((e) => ({ c: e.c, R: e.R, look: [-Math.sign(e.c[0]) * 0.05, -0.04, 1] as V3 }));
  const px = renderSDF(hs.f, [-0.11, -0.205, -0.135], [0.11, 0.14, 0.15], { ...VIEWS[view], w: W, h: H }, eyes);
  writeFileSync(out, px);
}

async function main() {
  const [, , a0, a1, a2, a3] = process.argv;
  if (a0 === '--worker') return worker(Number(a1), a2, a3);
  const out = a0 ?? 'face.png';
  const cases = process.argv.slice(3).map(Number);
  if (!cases.length) cases.push(0, 1);
  const views = (process.env.VIEWS ?? 'front q34 side close').split(' ');
  const dir = mkdtempSync(join(tmpdir(), 'face-'));
  const self = fileURLToPath(import.meta.url);
  const jobs: { ci: number; v: string; file: string }[] = [];
  for (const ci of cases) for (const v of views) jobs.push({ ci, v, file: join(dir, `${ci}_${v}.raw`) });
  let next = 0;
  const run = (): Promise<void> => {
    const j = jobs[next++];
    if (!j) return Promise.resolve();
    return new Promise<void>((res, rej) => {
      const p = spawn('npx', ['tsx', self, '--worker', String(j.ci), j.v, j.file], { stdio: 'inherit' });
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`worker ${j.ci}/${j.v} failed`))));
    }).then(run);
  };
  const t = Date.now();
  await Promise.all([run(), run(), run(), run()]);
  const py = `
import sys
from PIL import Image
W,H=${W},${H}
cases=[${cases.join(',')}]; views=${JSON.stringify(views)}
out=Image.new('RGB',(W*len(views),H*len(cases)))
for r,c in enumerate(cases):
  for k,v in enumerate(views):
    out.paste(Image.frombytes('RGBA',(W,H),open(f'${dir}/{c}_{v}.raw','rb').read()).convert('RGB'),(k*W,r*H))
out.save('${out}')`;
  const p = spawn('python3', ['-c', py], { stdio: 'inherit' });
  await new Promise((r) => p.on('exit', r));
  console.log(`${out}: ${jobs.length} views in ${((Date.now() - t) / 1000).toFixed(1)} s`);
  void readFileSync;
}
main();
