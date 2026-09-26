// Scripted playtest of the real game UI in headless Chromium: deploys the caravan with real
// clicks/keys, builds through the sidebar, fast-forwards the sim, and screenshots each step.
//   npx tsx tools/playtest.ts <outDir>
import { chromium, Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/tmp';
mkdirSync(out, { recursive: true });
const W = parseInt(process.env.W ?? '1280'), H = parseInt(process.env.H ?? '800');
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 3000)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT')) console.log('[console]', m.text().slice(0, 2000)); });

const G = (fn: string) => page.evaluate(`(() => { const g = window.__game.game; ${fn} })()`);
async function frames(n: number) {
  const f0 = (await page.evaluate('window.__game?.frames ?? 0')) as number;
  const t = Date.now();
  while (Date.now() - t < 120000) {
    const f = (await page.evaluate('window.__game?.frames ?? 0')) as number;
    if (f >= f0 + n) return;
    await page.waitForTimeout(100);
  }
}
async function shot(name: string) {
  await frames(3);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name, JSON.stringify(await G('const p = g.player(); return { tick: g.world.tick, jade: p.jade, mandate: g.world.mandate(g.me), msgs: g.messages.slice(-3).map(m => m.text) };')));
}
/** fast-forward the sim without rendering (seconds of game time) */
async function ff(seconds: number) {
  await G(`for (let i = 0; i < ${Math.round(seconds * 15)}; i++) g.update(1/15);`);
}
async function clickWorld(wx: number, wz: number, button: 'left' | 'right' = 'left') {
  const p = (await G(`const p = g.project([${wx}, g.h(${wx}, ${wz}) + 0.8, ${wz}]); return p;`)) as number[];
  await page.mouse.click(p[0], p[1], { button });
}
async function clickCameo(page: Page, typeId: string, button: 'left' | 'right' = 'left') {
  const r = (await G(`const c = g.hud.L.cells.find(c => c.type.id === '${typeId}'); return c ? c.rect : null;`)) as number[] | null;
  if (!r) throw new Error('no cameo ' + typeId);
  await page.mouse.click(r[0] + r[2] / 2, r[1] + r[3] / 2, { button });
  await frames(2); // input is consumed on the next frame
}

await page.goto('http://localhost:5173/?start=easy&capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.__game?.ready', null, { timeout: 180000 });
await shot('01_start');

// select the caravan with a real click, then deploy with D
const car = (await G(`const c = g.world.unitsOf(g.me).find(u => u.typeId === 'azure_caravan'); const [x, z] = g.pos(c); return [x, z];`)) as number[];
await clickWorld(car[0], car[1]);
await frames(2);
await page.keyboard.press('KeyD');
await frames(4);
await ff(3);
await shot('02_deployed');

// wait for the Yamen to finish rising, then build a Qi Shrine through the sidebar
for (let i = 0; i < 20 && !(await G(`return g.world.canBuild(g.me, 'azure_qi_shrine');`)); i++) await ff(0.5);
await clickCameo(page, 'azure_qi_shrine');
await ff(11);
await frames(2);
await clickCameo(page, 'azure_qi_shrine'); // READY → placement mode
const yamen = (await G(`const y = g.world.structuresOf(g.me)[0]; return [g.wx(y.x), g.wz(y.z)];`)) as number[];
await page.mouse.move(0, 0);
const target = (await G(`const p = g.project([${yamen[0] - 10.5}, g.h(${yamen[0] - 10.5}, ${yamen[1]}), ${yamen[1]}]); return p;`)) as number[];
await page.mouse.move(target[0], target[1]);
await frames(3);
await shot('03_placing');
await page.mouse.click(target[0], target[1]);
await frames(3);
console.log('after place click', JSON.stringify(await G(`return { ready: g.player().queues.structures.ready, n: g.world.structuresOf(g.me).length, msgs: g.messages.slice(-2).map(m => m.text) };`)));
await ff(3);
await shot('04_placed');

// barracks + refinery via script (same commands the sidebar issues), then infantry
const place = async (id: string, dx: number, dz: number) => {
  await G(`g.issue({ t: 'queue', typeId: '${id}' });`);
  const tab = id === 'azure_arrow_tower' ? 'defense' : 'structures';
  for (let i = 0; i < 60; i++) {
    if (await G(`return g.player().queues['${tab}'].ready === '${id}';`)) break;
    await ff(1);
  }
  // spiral search from the preferred offset for a legal spot
  await G(`const y = g.world.structuresOf(g.me).find(s => s.typeId === 'azure_command_hall');
    for (let r = 0; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = y.cx + ${dx} + dx, cz = y.cz + ${dz} + dz;
      if (g.world.canPlace(g.me, '${id}', cx, cz)) { g.issue({ t: 'place', typeId: '${id}', cx, cz }); return; }
    }`);
  await ff(3);
};
await place('azure_barracks', 6, -1);
await place('azure_jade_refinery', 1, 5);
await G(`for (const id of ['azure_halberdier','azure_halberdier','azure_archer','azure_daoist','azure_archer']) g.issue({ t: 'queue', typeId: id });`);
await ff(40);
await G(`g.jumpHome(); g.cam.distance = 50;`);
await shot('05_base');
// select all combat units and send them toward the enemy with attack-move
await G(`g.selection = new Set(g.world.unitsOf(g.me).filter(u => g.world.utype(u).weapon).map(u => u.id));`);
await shot('06_selected');
// Heaven's Wrath: grant mandate for the test and cast on enemy base
await G(`g.player().mandateMilli = 200000; g.player().powerCharge['heavens_wrath'] = 0;`);
const enemy = (await G(`const e = g.world.structuresOf(1)[0] ?? g.world.unitsOf(1)[0]; return [g.wx(e.x), g.wz(e.z)];`)) as number[];
await G(`g.cam.target = [${enemy[0]}, 0, ${enemy[1]} - 4]; g.cam.distance = 50;`);
await frames(2);
await G(`g.issue({ t: 'power', power: 'heavens_wrath', x: g.lx(${enemy[0]}), z: g.lz(${enemy[1]}) });`);
await ff(0.3);
await shot('07_wrath_gather');
for (let i = 0; i < 40; i++) {
  await ff(1 / 15);
  if (await G(`return g.vfx.flash > 0.5;`)) break;
}
await G(`g.freezeFx = true;`);
await shot('08_wrath_strike');
await G(`g.freezeFx = false;`);
await ff(0.6);
await shot('09_wrath_after');
// battle: send army at the enemy and fast-forward
await G(`g.issue({ t: 'move', ids: [...g.selection], x: g.lx(${enemy[0]}), z: g.lz(${enemy[1]}), attackMove: true });`);
for (let i = 0; i < 8; i++) {
  await ff(8);
  const fighting = await G(`return g.world.unitsOf(g.me).some(u => u.targetId);`);
  if (fighting) break;
}
await G(`const us = g.world.unitsOf(g.me).filter(u => u.targetId); if (us.length) { const [x, z] = g.pos(us[0]); g.cam.target = [x, 0, z - 3]; g.cam.distance = 34; }`);
await shot('10_battle');
await browser.close();
