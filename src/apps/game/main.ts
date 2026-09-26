// Game entry (web). Boots the platform, device and renderer, loads models + glyphs, then runs
// an attract-mode title screen (AI vs AI on the skirmish map) until the player starts a match.
// URL params for automation: ?start=easy|normal (skip title) &time=<s> fast-forward
//   &capture=1 (preserve drawing buffer for screenshots)
//   &manual=1 (no rAF loop: tools drive frames with window.__step(dt) for frame-exact video capture)

import { WebPlatform } from '../../platform/web/webPlatform';
import { WebGL2Device } from '../../render/rhi/webgl2/device';
import { Renderer } from '../../render/renderer';
import { loadModels } from '../../game/assets';
import { Game } from '../../game/game';
import { HUD_HANZI } from '../../game/hud';
import { buildSoundLibrary, SAMPLE_RATE } from '../../audio/synth';
import type { Difficulty } from '../../sim/ai';
import type { UIRenderer } from '../../render/ui';
import type { GlyphAtlasData, GlyphFaceRequest } from '../../platform/platform';
import factionJson from '../../../content/factions/azure_dynasty.json';
import rulesJson from '../../../content/rules.json';

const params = new URLSearchParams(location.search);
const errorEl = document.getElementById('error')!;
const showError = (e: unknown) => {
  errorEl.style.display = 'block';
  errorEl.textContent = String((e as Error)?.stack ?? e);
  (window as any).__game = { ...(window as any).__game, error: String(e) };
};
window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));
const bootMsg = (t: string) => {
  const el = document.getElementById('bootMsg');
  if (el) el.textContent = t;
};

function glyphFaces(scale: number): GlyphFaceRequest[] {
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '·—’…✓×–';
  const hz = new Set<string>([...HUD_HANZI]);
  for (const e of [...factionJson.structures, ...factionJson.units]) for (const ch of e.hanzi ?? '') hz.add(ch);
  for (const e of factionJson.units as { spell?: { hanzi?: string } }[]) for (const ch of e.spell?.hanzi ?? '') hz.add(ch);
  for (const p of rulesJson.powers) for (const ch of p.hanzi) hz.add(ch);
  for (const ch of '天命苍朝胜败暂停小战略简单普通难五行火冰水风') hz.add(ch);
  const han = [...hz].join('');
  const sz = (n: number) => Math.round(n * scale);
  // Latin faces also carry the hanzi (rendered via the CJK fallback in the font stack)
  const ui = (name: string, n: number, w = 500) => ({ name, family: 'Alegreya Sans', weight: w, size: sz(n), chars: ascii + han });
  const disp = (name: string, n: number, withHan = false) => ({ name, family: 'Cinzel', weight: 700, size: sz(n), chars: withHan ? ascii + han : ascii });
  const cjk = (name: string, n: number) => ({ name, family: 'Noto Serif SC', weight: 700, size: sz(n), chars: han });
  return [ui('ui11', 11), ui('ui12', 12), ui('ui13', 13), ui('ui14', 14, 700), ui('ui16', 16, 700), disp('disp16', 16), disp('disp22', 22, true), disp('disp28', 28), disp('disp48', 48), cjk('cjk14', 14), cjk('cjk20', 20), cjk('cjk80', 80)];
}

async function main() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const platform = new WebPlatform(canvas);
  const device = new WebGL2Device(canvas, { preserveDrawingBuffer: params.has('capture') });
  platform.surface.onResize((w, h) => device.resize(w, h));
  device.resize(platform.surface.width, platform.surface.height);
  // ?msaa=1 speeds up software-rendered captures; players always get 4× MSAA
  const renderer = new Renderer(device, { samples: parseInt(params.get('msaa') ?? '4') || 4 });
  const uiScale = () => Math.max(0.75, Math.min(2, platform.surface.dpr * Math.min(1, platform.surface.height / platform.surface.dpr / 860)));

  bootMsg('Carving the models…');
  const lib = await loadModels(platform, renderer, (d, n) => bootMsg(`Carving the models… ${d}/${n}`));
  bootMsg('Tuning the instruments…');
  await new Promise((r) => setTimeout(r, 0));
  const t0 = platform.now();
  for (const [name, pcm] of buildSoundLibrary()) platform.audio.register(name, pcm, SAMPLE_RATE);
  (window as any).__soundSynthMs = Math.round((platform.now() - t0) * 1000);
  bootMsg('Inking the characters…');
  let glyphScale = uiScale();
  let atlas: GlyphAtlasData = await platform.rasterizeGlyphs(glyphFaces(glyphScale));

  let game: Game;
  let title = !params.has('start');
  const newGame = (difficulty: Difficulty, demo: boolean, gallery = false) => {
    const g = new Game(platform, renderer, lib, { difficulty, demo, gallery, seed: demo ? 3 : 7 + Math.floor(Math.random() * 1000) });
    g.ui.setGlyphs(atlas);
    if (!demo) g.buildCameos(glyphScale);
    g.hud.onRestart = () => {
      title = true;
      game = newGame('normal', true);
      game.drawOverlay = drawTitle;
    };
    return g;
  };

  let hoverBtn = -1;
  const drawTitle = (ui: UIRenderer, s: number) => {
    const W = ui.width, H = ui.height;
    ui.gradient(0, 0, W, H * 0.55, 0x000000, 0x000000, 0.55, 0.05);
    ui.gradient(0, H * 0.6, W, H * 0.4, 0x000000, 0x000000, 0, 0.6);
    const cx = W / 2;
    const top = H * 0.16;
    ui.text('天命', cx, top, 'cjk80', 0xd9ad52, 1, { align: 'center' });
    ui.text('MANDATE OF HEAVEN', cx, top + 104 * s, 'disp48', 0xefe4c9, 1, { align: 'center' });
    ui.text('An East Asian fantasy RTS · Prototype M1 — Tier 1 skirmish', cx, top + 166 * s, 'ui16', 0xd8ccb0, 1, { align: 'center' });
    const btns = ['Skirmish · Easy', 'Skirmish · Normal', 'Magic Gallery'];
    const bw = 260 * s, bh = 46 * s;
    const p = platform.input.pointer;
    hoverBtn = -1;
    btns.forEach((label, i) => {
      const x = cx - bw / 2, y = top + 220 * s + i * (bh + 14 * s);
      const hov = p.x >= x && p.x < x + bw && p.y >= y && p.y < y + bh;
      if (hov) hoverBtn = i;
      const gal = i === 2;
      ui.gradient(x, y, bw, bh, hov ? (gal ? 0x2f5f9a : 0xc0382a) : gal ? 0x1f3350 : 0x5a2a1e, hov ? (gal ? 0x173050 : 0x7d1f14) : gal ? 0x121c2c : 0x2e1612, 0.95);
      ui.outline(x, y, bw, bh, 2 * s, hov ? 0xffe6a0 : 0xd9ad52, 1);
      ui.text(label, cx, y + 11 * s, 'disp22', 0xfff2d8, 1, { align: 'center' });
    });
    const help = [
      'Deploy your Imperial Caravan (select it, press D or click it again), then build from the sidebar.',
      'Left-click select · drag to box-select · right-click to move / attack / harvest · A = attack-move',
      'S stop · X sell · H home · Space last alert · Ctrl+1–9 groups · wheel zoom · arrows / edge scroll · P pause · M sound',
      'Mandate (天命) grows from standing buildings × Harmony; spend it on Heaven’s Wrath.',
    ];
    help.forEach((l, i) => ui.text(l, cx, H - (110 - i * 22) * s, 'ui14', 0xcfc2a4, 0.95, { align: 'center' }));
  };
  // gallery caption band + way back
  const drawGallery = (ui: UIRenderer, s: number) => {
    const gal = game.gallery;
    if (!gal) return;
    const W = ui.width;
    ui.gradient(0, 0, W, 96 * s, 0x000000, 0x000000, 0.7, 0);
    ui.text(gal.caption, W / 2, 14 * s, 'disp22', 0xf3e2b8, 1, { align: 'center' });
    ui.text(gal.sub, W / 2, 48 * s, 'ui14', 0xd8ccb0, 0.95, { align: 'center' });
    ui.text('Esc — back to the title  ·  wheel — zoom  ·  M — sound', W / 2, ui.height - 28 * s, 'ui13', 0xcfc2a4, 0.85, { align: 'center' });
  };

  game = newGame('normal', true);
  game.drawOverlay = drawTitle;
  if (params.has('gallery')) {
    title = false;
    game = newGame('normal', false, true);
    game.drawOverlay = drawGallery;
  } else if (!title) {
    const diff = params.get('start') === 'easy' ? 'easy' : 'normal';
    game = newGame(diff as Difficulty, false);
  }
  // headless automation: fast-forward the simulation
  const ff = parseFloat(params.get('time') ?? '0');
  if (ff > 0) for (let i = 0; i < ff * 15; i++) game.update(1 / 15);

  document.getElementById('boot')!.remove();
  let last = platform.now();
  let frames = 0;
  // A bug in one frame must never freeze the game: schedule the next frame first, catch, report
  // once (non-blocking banner + console) and keep running.
  const seenErrors = new Set<string>();
  const frameError = (e: unknown) => {
    const msg = String((e as Error)?.message ?? e);
    if (seenErrors.has(msg)) return;
    seenErrors.add(msg);
    console.error(e);
    const el = document.getElementById('warn');
    if (el) {
      el.textContent = `Something went wrong (${msg}). The game keeps running — details are in the browser console.`;
      el.style.display = 'block';
      setTimeout(() => (el.style.display = 'none'), 8000);
    }
    (window as any).__game = { ...(window as any).__game, frameErrors: [...seenErrors] };
  };
  const loop = () => {
    platform.requestFrame(loop);
    try {
      step();
    } catch (e) {
      platform.input.endFrame(); // don't replay the click that triggered it
      frameError(e);
    }
  };
  const step = (fixedDt?: number) => {
    const now = platform.now();
    const dt = fixedDt ?? Math.min(0.1, now - last);
    last = now;
    const s = uiScale();
    if (Math.abs(s - glyphScale) > 0.2) {
      // DPR changed (window moved to another monitor): re-rasterise glyphs + cameos
      glyphScale = s;
      platform.rasterizeGlyphs(glyphFaces(s)).then((a) => {
        atlas = a;
        game.ui.setGlyphs(a);
      });
    }
    if (title && platform.input.clicked & 1 && hoverBtn >= 0) {
      title = false;
      if (hoverBtn === 2) {
        game = newGame('normal', false, true);
        game.drawOverlay = drawGallery;
      } else game = newGame(hoverBtn === 0 ? 'easy' : 'normal', false);
      platform.input.endFrame();
    }
    if (game.gallery && platform.input.pressed.has('Escape')) {
      title = true;
      game = newGame('normal', true);
      game.drawOverlay = drawTitle;
      platform.input.endFrame();
    }
    game.frame(dt, s);
    platform.input.endFrame();
    frames++;
    (window as any).__game = { ready: frames > 3, frames, error: null, frameErrors: [...seenErrors], game };
  };
  if (params.has('manual')) {
    (window as any).__step = (dt: number, n = 1) => {
      for (let i = 0; i < n; i++) step(dt);
    };
    for (let i = 0; i < 5; i++) step(1 / 30);
  } else platform.requestFrame(loop);
}

main().catch(showError);
