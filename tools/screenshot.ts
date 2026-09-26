// Headless screenshots of the viewer (used for art review + docs).
//   npx tsx tools/screenshot.ts <outDir> "<query>" [name] ["<query>" name ...]
// Requires the dev server (npm run dev) or preview server on :5173.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, ...rest] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const shots: [string, string][] = [];
for (let i = 0; i < rest.length; i += 2) shots.push([rest[i], rest[i + 1] ?? `shot${i / 2}`]);
const base = process.env.VIEWER_URL ?? 'http://localhost:5173/';
const w = parseInt(process.env.W ?? '1280'), h = parseInt(process.env.H ?? '800');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 2000)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 4000)));
for (const [q, name] of shots) {
  const url = `${base}?${q}&capture=1`;
  await page.goto(url, { waitUntil: 'load' });
  const t = Date.now();
  let state: any = null;
  while (Date.now() - t < 120000) {
    state = await page.evaluate(() => (window as any).__viewer ?? null);
    if (state?.error || (state?.ready && state.frames > 6)) break;
    await page.waitForTimeout(250);
  }
  if (state?.error) console.log('ERROR', name, state.error.slice(0, 3000));
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('saved', name, state?.frames);
}
await browser.close();
