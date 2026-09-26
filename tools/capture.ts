// Frame-exact gameplay capture for reviewing effects at real RTS zoom.
// Drives the game in ?manual=1 mode (no rAF loop), runs a scenario script inside the page, then
// steps a fixed dt per frame and screenshots every frame → JPEG sequence, contact sheet, WebM.
//
//   npx tsx tools/capture.ts <outDir> <scenario.js> [frames=90] [dt=1/30] [query]
//
// The scenario file is evaluated in the page with `g` (the Game) and `step(dt, n)` in scope; it
// may return { frames, dt, sheetEvery } to override defaults. See tools/scenarios/.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const [outDir, scenarioPath, framesArg, dtArg, queryArg] = process.argv.slice(2);
if (!outDir || !scenarioPath) {
  console.log('usage: npx tsx tools/capture.ts <outDir> <scenario.js> [frames] [dt] [query]');
  process.exit(1);
}
const name = basename(scenarioPath).replace(/\.[jt]s$/, '');
const dir = join(outDir, name);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'frames'), { recursive: true });
const W = parseInt(process.env.W ?? '1280'), H = parseInt(process.env.H ?? '800');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 2000)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_CERT') && !m.text().includes('404')) console.log('[console]', m.text().slice(0, 1000)); });
await page.goto(`${process.env.GAME_URL ?? 'http://localhost:5173/'}?manual=1&capture=1&${queryArg ?? 'start=easy'}`, { waitUntil: 'load' });
await page.waitForFunction('window.__game?.ready', null, { timeout: 180000 });

let script = readFileSync(scenarioPath, 'utf8');
// '//STAGE' pulls in the shared staging helpers (tools/scenarios/_stage.js)
if (script.startsWith('//STAGE')) script = readFileSync(join(scenarioPath, '..', '_stage.js'), 'utf8') + '\n' + script;
const cfg = (await page.evaluate(`(async () => { const g = window.__game.game; const step = window.__step; ${script} })()`)) as { frames?: number; dt?: number; sheetEvery?: number; label?: string } | undefined;
const frames = parseInt(framesArg ?? '') || cfg?.frames || 90;
const dt = dtArg ? eval(dtArg) : cfg?.dt ?? 1 / 30;
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  // read the canvas directly (preserveDrawingBuffer via capture=1): page.screenshot waits for a
  // compositor frame, which never comes while the rAF loop is off
  const url = (await page.evaluate(`(() => { window.__step(${dt}); return document.getElementById('view').toDataURL('image/jpeg', 0.9); })()`)) as string;
  writeFileSync(join(dir, 'frames', `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}
const errs = await page.evaluate('window.__game.frameErrors');
console.log(`captured ${frames} frames of ${name} in ${((Date.now() - t0) / 1000).toFixed(0)}s`, errs && (errs as string[]).length ? `frameErrors: ${JSON.stringify(errs)}` : '');
await browser.close();

// contact sheet (every Nth frame) + webm
const every = cfg?.sheetEvery ?? Math.max(1, Math.round(frames / 12));
const picks = readdirSync(join(dir, 'frames')).sort().filter((_, i) => i % every === 0).slice(0, 16);
writeFileSync(join(dir, 'sheet.txt'), picks.join('\n'));
spawnSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
d = sys.argv[1]; picks = open(d + '/sheet.txt').read().split()
ims = [Image.open(d + '/frames/' + p) for p in picks]
w, h = ims[0].size; cw, ch = w // 2, h // 2; cols = 4; rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cw * cols, ch * rows), (0, 0, 0))
for i, im in enumerate(ims):
    t = im.resize((cw, ch))
    ImageDraw.Draw(t).text((8, 8), picks[i] + '  t=%.2fs' % (int(picks[i][1:5]) * float(sys.argv[2])), fill=(255, 255, 0))
    sheet.paste(t, ((i % cols) * cw, (i // cols) * ch))
sheet.save(d + '/sheet.jpg', quality=85)
`, dir, String(dt)], { stdio: 'inherit' });
const ff = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const fps = Math.round(1 / dt);
const r = spawnSync('sh', ['-c', `cat ${join(dir, 'frames')}/*.jpg | ${ff} -y -loglevel error -f image2pipe -framerate ${fps} -c:v mjpeg -i pipe:0 -c:v libvpx -b:v 3M -crf 8 -qmin 2 -qmax 20 ${join(dir, name + '.webm')}`], { stdio: 'inherit' });
console.log(r.status === 0 ? `wrote ${join(dir, name + '.webm')} and sheet.jpg` : 'webm encode failed');
