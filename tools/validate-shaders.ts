// Compiles every shader (GLSL 4.50, Vulkan dialect) to SPIR-V with glslang.
// This is the same front-end the native backends use:
//   GLSL 4.50 ─glslang→ SPIR-V ─SPIRV-Cross→ MSL (Metal) / HLSL (D3D11, SM5) / Vulkan (as-is)
// Passing here means the shader source is valid for Vulkan and cross-compilable for Metal/D3D11.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src', 'render', 'shaders');
const common = readFileSync(join(dir, 'common.glsl'), 'utf8');
const resolve = (src: string) => src.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_m, n) => (n === 'common.glsl' ? common : readFileSync(join(dir, n), 'utf8')));

// pipelines × defines exactly as the renderer builds them
const programs: { name: string; vert: string; frag: string; defines?: Record<string, number> }[] = [
  { name: 'mesh', vert: 'mesh.vert', frag: 'mesh.frag' },
  { name: 'mesh-shadow', vert: 'mesh.vert', frag: 'depth.frag', defines: { SHADOW_PASS: 1 } },
  { name: 'terrain', vert: 'terrain.vert', frag: 'terrain.frag' },
  { name: 'terrain-shadow', vert: 'terrain.vert', frag: 'depthSimple.frag', defines: { SHADOW_PASS: 1 } },
  { name: 'water', vert: 'water.vert', frag: 'water.frag' },
  { name: 'sky', vert: 'sky.vert', frag: 'sky.frag' },
  { name: 'bloom', vert: 'fullscreen.vert', frag: 'bloom.frag' },
  { name: 'composite', vert: 'fullscreen.vert', frag: 'composite.frag' },
  { name: 'overlay', vert: 'overlay.vert', frag: 'overlay.frag' },
  { name: 'particles-alpha', vert: 'particle.vert', frag: 'particle.frag' },
  { name: 'particles-add', vert: 'particle.vert', frag: 'particle.frag', defines: { ADDITIVE: 1 } },
  { name: 'ui', vert: 'ui.vert', frag: 'ui.frag' },
];

const glslangInit = require('@webgpu/glslang');
// The Emscripten module is a self-resolving thenable; `await`ing it directly never settles.
const glslang = glslangInit();
await new Promise<void>((res) => glslang.then(() => { delete glslang.then; res(); }));
const outDir = join(root, 'dist', 'spirv');
mkdirSync(outDir, { recursive: true });
let failed = 0;
for (const p of programs) {
  for (const [stage, file] of [['vertex', p.vert], ['fragment', p.frag]] as const) {
    const defs = { ...(p.defines ?? {}), [stage === 'vertex' ? 'STAGE_VERTEX' : 'STAGE_FRAGMENT']: 1, BACKEND_VULKAN: 1 };
    let src = resolve(readFileSync(join(dir, file), 'utf8'));
    src = src.replace(/^\s*#version\s+450.*$/m, '#version 450\n' + Object.entries(defs).map(([k, v]) => `#define ${k} ${v}`).join('\n'));
    try {
      const spv: Uint32Array = glslang.compileGLSL(src, stage, false);
      writeFileSync(join(outDir, `${p.name}.${stage === 'vertex' ? 'vert' : 'frag'}.spv`), Buffer.from(spv.buffer, spv.byteOffset, spv.byteLength));
      console.log(`  ok   ${p.name.padEnd(16)} ${stage.padEnd(8)} ${spv.byteLength} bytes SPIR-V`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${p.name.padEnd(16)} ${stage}\n${String(e).slice(0, 2000)}`);
    }
  }
}
if (failed) {
  console.error(`${failed} shader stage(s) failed SPIR-V compilation`);
  process.exit(1);
}
console.log('all shaders compile to SPIR-V (Vulkan) — ready for SPIRV-Cross → MSL / HLSL');
