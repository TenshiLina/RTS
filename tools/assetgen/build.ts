// Asset build: runs every recipe, bakes AO, writes .glb + a manifest the runtime reads.
//   npm run assets            → all assets
//   npm run assets -- qi      → only recipes whose id contains "qi"

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportGLB } from './kit/gltf';
import { bakeAO } from './kit/ao';
import { findZFighting } from './kit/zfight';
import { RECIPES } from './recipes';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'public', 'assets', 'models');
mkdirSync(outDir, { recursive: true });

const filter = process.argv[2];
const manifest: any[] = [];
const t0 = Date.now();
let zfTotal = 0;
for (const r of RECIPES) {
  const t = Date.now();
  const res = r.build();
  const selected = !filter || r.id.includes(filter);
  const b = res.mesh.bounds();
  const entry = {
    id: r.id,
    name: r.name,
    hanzi: r.hanzi,
    category: r.category,
    footprint: r.footprint,
    file: `${r.id}.glb`,
    triangles: res.mesh.tris.length,
    bounds: b,
    animations: (res.animations ?? []).map((a) => a.name),
  };
  manifest.push(entry);
  if (!selected) continue;
  const zf = findZFighting(res.mesh.tris, res.mesh.materials.map((m) => m.name));
  if (zf.length) {
    zfTotal += zf.length;
    const worst = zf.sort((a, b) => b.area - a.area).slice(0, 4);
    console.warn(`  ⚠ ${r.id}: ${zf.length} coplanar overlaps (z-fighting), e.g. ` + worst.map((z) => `${z.mats.join('/')} @ ${z.at.map((v) => v.toFixed(2)).join(',')} (${z.area.toFixed(3)} m²)`).join('; '));
  }
  const ao = res.ao === false ? undefined : bakeAO(res.mesh.tris, res.ao ?? {});
  const glb = exportGLB(res.mesh, { ao, skeleton: res.skeleton, animations: res.animations, sockets: res.sockets, extras: { ...res.extras, footprint: r.footprint, category: r.category } });
  writeFileSync(join(outDir, entry.file), glb);
  console.log(`  ${r.id.padEnd(28)} ${String(entry.triangles).padStart(6)} tris  ${(glb.byteLength / 1024).toFixed(0).padStart(5)} KB  ${Date.now() - t} ms`);
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), assets: manifest }, null, 1));
if (zfTotal) console.warn(`assetgen: ${zfTotal} z-fighting overlaps found (see warnings above)`);
console.log(`assetgen: ${manifest.length} assets in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${outDir}`);
