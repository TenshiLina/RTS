// profile update vs render at a busy moment of a scenario (dev server)
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const scen = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173/?manual=1&capture=1&start=easy&msaa=1');
await page.waitForFunction('window.__game?.ready', null, { timeout: 180000 });
let script = readFileSync(scen, 'utf8');
if (script.startsWith('//STAGE')) script = readFileSync('tools/scenarios/_stage.js', 'utf8') + '\n' + script;
await page.evaluate(`(async () => { const g = window.__game.game; const step = window.__step; ${script} })()`);
const r = await page.evaluate(`(() => {
  const g = window.__game.game; const out = [];
  const gl = document.getElementById('view').getContext('webgl2'); const px = new Uint8Array(4);
  for (let i = 0; i < 24; i++) {
    const t0 = performance.now(); g.update(1/15); const t1 = performance.now();
    g.render(1); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px); const t2 = performance.now();
    if (i % 4 === 3) out.push({ i, update: Math.round(t1-t0), render: Math.round(t2-t1), particles: g.particles.count, trails: g.particles.trails.length, meshes: g.vfx.meshes.length, lights: g.vfx.lights.length });
  }
  return out;
})()`);
console.log(JSON.stringify(r, null, 0));
await browser.close();
