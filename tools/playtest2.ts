// Combat/VFX playtest: stages a skirmish next to the base to capture talismans, arrows,
// a building collapse, harvesting and the victory screen.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'screenshots/tmp';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 3000)));
const G = (fn: string) => page.evaluate(`(() => { const g = window.__game.game; ${fn} })()`);
async function frames(n: number) {
  const f0 = (await page.evaluate('window.__game?.frames ?? 0')) as number;
  while (((await page.evaluate('window.__game?.frames ?? 0')) as number) < f0 + n) await page.waitForTimeout(80);
}
async function shot(name: string) {
  await frames(2);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('shot', name);
}
const ff = (s: number) => G(`for (let i = 0; i < ${Math.round(s * 15)}; i++) g.update(1/15);`);

await page.goto('http://localhost:5173/?start=easy&capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.__game?.ready', null, { timeout: 180000 });
// deploy + quick base via direct commands
await G(`const c = g.world.unitsOf(g.me).find(u => u.typeId === 'azure_caravan'); g.issue({ t: 'deploy', id: c.id });`);
await ff(6);
const build = async (id: string, dx: number, dz: number) => {
  await G(`g.player().jade += 3000; g.issue({ t: 'queue', typeId: '${id}' });`);
  for (let i = 0; i < 40; i++) { if (await G(`return !!g.player().queues['${id === 'azure_arrow_tower' ? 'defense' : 'structures'}'].ready;`)) break; await ff(1); }
  await G(`const y = g.world.structuresOf(g.me).find(s => s.typeId === 'azure_command_hall');
    for (let r = 0; r < 9; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = y.cx + ${dx} + dx, cz = y.cz + ${dz} + dz;
      if (g.world.canPlace(g.me, '${id}', cx, cz)) { g.issue({ t: 'place', typeId: '${id}', cx, cz }); return; }
    }`);
  await ff(3);
};
await build('azure_qi_shrine', -3, 0);
await build('azure_barracks', 5, -1);
await build('azure_jade_refinery', 1, 5);
await ff(25);
// harvesting shot: follow the ox
await G(`const o = g.world.unitsOf(g.me).find(u => u.typeId === 'azure_wooden_ox'); if (o) { const [x, z] = g.pos(o); g.cam.target = [x, 0, z - 3]; g.cam.distance = 32; }`);
await shot('11_harvest');
// stage a fight: enemy squad walks into our daoists/archers
await G(`
  const y = g.world.structuresOf(g.me).find(s => s.typeId === 'azure_command_hall');
  const bx = y.x + 256 * 4, bz = y.z - 256 * 7;
  for (let i = 0; i < 6; i++) g.world.spawnUnit(i % 2 ? 'azure_halberdier' : 'azure_archer', 1, bx + (i % 3) * 200, bz - Math.floor(i / 3) * 220);
  const mine = g.world.unitsOf(g.me).filter(u => g.world.utype(u).weapon);
  for (const id of ['azure_daoist', 'azure_daoist', 'azure_archer']) mine.push(g.world.spawnUnit(id, g.me, y.x + 256 * 3, y.z - 256 * 3));
  g.issue({ t: 'move', ids: mine.map(u => u.id), x: bx, z: bz + 256 * 2, attackMove: true });
  g.cam.target = [g.wx(bx), 0, g.wz(bz) + 2]; g.cam.distance = 36;
`);
let got = false;
for (let i = 0; i < 200 && !got; i++) {
  await ff(1 / 15);
  got = (await G(`return [...g.projs.values()].some(p => p.kind === 'talisman') && g.world.events.length >= 0;`)) as boolean;
}
await ff(0.25);
await G(`g.freezeFx = true;`);
await shot('12_talisman_flight');
await G(`g.freezeFx = false;`);
got = false;
for (let i = 0; i < 200 && !got; i++) {
  await ff(1 / 15);
  got = (await G(`return g.world.events.some(e => e.e === 'impact' && e.kind === 'talisman');`)) as boolean;
}
await ff(0.12);
await G(`g.freezeFx = true;`);
await shot('13_talisman_burst');
await G(`g.freezeFx = false;`);
// building destruction: blow up our own barracks for the camera
await G(`const b = g.world.structuresOf(g.me).find(s => s.typeId === 'azure_barracks'); g.cam.target = [g.wx(b.x), 0, g.wz(b.z) - 3]; g.cam.distance = 42; g.world.damage(b, 99999, {}, 1, 0); g.handleEvents(g.world.events);`);
await ff(1 / 15);
await ff(0.3);
await G(`g.freezeFx = true;`);
await shot('14_building_destroyed');
await G(`g.freezeFx = false;`);
// victory: remove the enemy
await G(`for (const e of g.world.entities) if (e.alive && e.owner === 1) g.world.damage(e, 999999, {}, 0, 0);`);
await ff(2);
await frames(6);
await shot('15_victory');
await browser.close();
