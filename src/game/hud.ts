// Engine-drawn HUD in the Command & Conquer tradition: right-hand sidebar with radar, Qi bar,
// jade counter, Mandate gauge + power, four build tabs with cameo frames (clock-wipe progress,
// READY, queue counts), plus tooltips, selection panel, health bars and messages.
// Everything is laid out in logical pixels × scale and drawn through UIRenderer.

import type { Game } from './game';
import { TEAM_PALETTE } from './game';
import type { Tab, EntityType } from '../sim/content';
import type { Entity } from '../sim/world';
import { audioPrefs, nextTrack } from './audioPrefs';
import { LEPTONS, TICK_HZ } from '../sim/intmath';
import { CELL } from '../world/skirmishMap';
import type { Texture } from '../render/rhi/types';
import { clamp, V3 } from '../core/math';

type Rect = [number, number, number, number];
const inside = (r: Rect, x: number, y: number) => x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3];

// palette
const LACQUER = 0x1f1411, LACQUER2 = 0x35211a, GOLD = 0xd9ad52, GOLD_DIM = 0x8d6b2f, INK = 0xefe4c9, MUTED = 0xb3a585, VERM = 0xb0301f, JADE = 0x4fd08c, QI = 0x7fd4ff, RED = 0xe0503a;

const TABS: { tab: Tab; hz: string; name: string }[] = [
  { tab: 'structures', hz: '营', name: 'Structures' },
  { tab: 'defense', hz: '防', name: 'Defence' },
  { tab: 'infantry', hz: '兵', name: 'Infantry' },
  { tab: 'machines', hz: '机', name: 'Machines' },
];

export const HUD_HANZI = '苍朝天命灵玉气营防兵机胜败罚暂停主' + TABS.map((t) => t.hz).join('');

export class Hud {
  tab: Tab = 'structures';
  private minimapTex: Texture | null = null;
  private L = {
    side: [0, 0, 0, 0] as Rect,
    mini: [0, 0, 0, 0] as Rect,
    qi: [0, 0, 0, 0] as Rect,
    jade: [0, 0, 0, 0] as Rect,
    mandate: [0, 0, 0, 0] as Rect,
    power: [0, 0, 0, 0] as Rect,
    tabs: [] as Rect[],
    cells: [] as { rect: Rect; type: EntityType }[],
    buttons: [] as { rect: Rect; label: string; key: string; on?: boolean }[],
    /** the part of the screen that shows the map (not covered by the command panel) */
    view: [0, 0, 0, 0] as Rect,
    selPanel: null as Rect | null,
    selButtons: [] as { rect: Rect; label: string; key: string }[],
    over: null as Rect | null,
  };
  /** command panel: sidebar on the right (landscape) or bar along the bottom (portrait) */
  dock: 'right' | 'bottom' = 'right';
  get viewRect(): Rect {
    return this.L.view;
  }
  private hoverCell: EntityType | null = null;
  private hoverPower = false;
  private lastTap = -10;
  private blink = 0;
  private dispMandate = 0;

  constructor(private g: Game) {}

  private buildMinimap() {
    const g = this.g;
    const n = g.map.cells;
    const px = new Uint8Array(n * n * 4);
    const t = g.terrain;
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const f = g.map.flags[cz * n + cx];
      const vi = (cz * t.res + 1) * t.vx + cx * t.res + 1;
      const hgt = t.heights[vi];
      let c: [number, number, number];
      if (f & CELL.WATER) c = [46, 110, 128];
      else if (f & CELL.OBSTACLE) c = [34, 70, 38];
      else if (f & CELL.CLIFF) c = [104, 98, 86];
      else {
        const dirt = t.splat[vi * 4 + 1] / 255, rock = t.splat[vi * 4 + 2] / 255, jade = t.splat[vi * 4 + 3] / 255;
        const shade = clamp(0.85 + hgt * 0.03, 0.6, 1.25);
        c = [(78 + dirt * 60 + rock * 40) * shade, (118 - dirt * 10) * shade, (56 + rock * 40 + jade * 30) * shade];
      }
      const i = (cz * n + cx) * 4;
      px[i] = clamp(c[0], 0, 255);
      px[i + 1] = clamp(c[1], 0, 255);
      px[i + 2] = clamp(c[2], 0, 255);
      px[i + 3] = 255;
    }
    this.minimapTex = g.renderer.device.createTexture({ width: n, height: n, format: 'rgba8unorm', data: px, label: 'minimap' });
  }

  /** Compute layout, handle HUD clicks. Returns true when the pointer is over the HUD. */
  layout(s: number): boolean {
    const g = this.g;
    const d = g.renderer.device;
    const W = d.backbufferWidth, H = d.backbufferHeight;
    const input = g.platform.input;
    const p = input.pointer;
    const L = this.L;
    const items = this.itemsFor(this.tab);
    const buttons = (x0: number, by: number, inner: number) => {
      // Sell · Pause · Home · music (cycles the tracks, then off)
      const aw = 44 * s, bw = (inner - aw - 4 * s) / 3;
      return [
        { rect: [x0, by, bw - 4 * s, 32 * s] as Rect, label: 'Sell', key: 'sell', on: g.mode.kind === 'sell' },
        { rect: [x0 + bw, by, bw - 4 * s, 32 * s] as Rect, label: g.paused ? 'Resume' : 'Pause', key: 'pause', on: g.paused },
        { rect: [x0 + bw * 2, by, bw - 4 * s, 32 * s] as Rect, label: 'Home', key: 'home' },
        { rect: [x0 + bw * 3, by, aw, 32 * s] as Rect, label: audioPrefs.muted ? '×' : audioPrefs.track < 0 ? '♪×' : `♪${audioPrefs.track + 1}`, key: 'audio', on: audioPrefs.muted || audioPrefs.track < 0 },
      ];
    };
    this.dock = W < H ? 'bottom' : 'right';
    if (this.dock === 'right') {
      // landscape: the C&C sidebar on the right
      const sw = Math.round(264 * s);
      L.side = [W - sw, 0, sw, H];
      L.view = [0, 0, W - sw, H];
      const pad = 16 * s;
      const x0 = W - sw + pad;
      const inner = sw - pad * 2;
      const mini = Math.round(inner - 32 * s);
      L.mini = [x0, 44 * s, mini, mini];
      L.qi = [x0 + mini + 8 * s, 44 * s, 24 * s, mini];
      let y = 44 * s + mini + 12 * s;
      L.jade = [x0, y, inner, 34 * s];
      y += 42 * s;
      L.mandate = [x0, y, inner, 62 * s];
      L.power = [x0 + inner - 98 * s, y + 6 * s, 98 * s, 50 * s];
      y += 70 * s;
      L.tabs = TABS.map((_, i) => [x0 + (i * inner) / 4, y, inner / 4 - 3 * s, 40 * s] as Rect);
      y += 48 * s;
      const cw = (inner - 8 * s) / 2, ch = Math.round(cw * 0.72);
      L.cells = items.map((type, i) => ({ rect: [x0 + (i % 2) * (cw + 8 * s), y + Math.floor(i / 2) * (ch + 8 * s), cw, ch] as Rect, type }));
      L.buttons = buttons(x0, H - 44 * s, inner);
    } else {
      // portrait: a command bar along the bottom — radar, resources and Heaven's Wrath in a left
      // column, tabs and the build grid on the right — so the map keeps the full width
      const pad = 10 * s, gap = 8 * s;
      const mini = Math.round(Math.min(W * 0.3, 150 * s));
      const leftW = mini + 26 * s;
      const rx = pad + leftW + 12 * s, rw = W - rx - pad;
      // as many columns as fit cells at least as wide as the sidebar's (names and costs must fit)
      const cols = clamp(Math.floor((rw + gap) / (118 * s + gap)), 2, 4);
      const cw = (rw - (cols - 1) * gap) / cols, ch = Math.round(Math.min(cw * 0.72, 80 * s));
      const rows = Math.max(3, Math.ceil(items.length / cols));
      const rightH = 40 * s + gap + rows * (ch + gap);
      const leftH = mini + 8 * s + 34 * s + 6 * s + 56 * s + 4 * s + 50 * s + 8 * s + 32 * s;
      const ph = Math.round(Math.max(leftH, rightH) + pad * 2);
      const y0 = H - ph;
      L.side = [0, y0, W, ph];
      L.view = [0, 0, W, y0];
      L.mini = [pad, y0 + pad, mini, mini];
      L.qi = [pad + mini + 8 * s, y0 + pad, 18 * s, mini];
      let y = y0 + pad + mini + 8 * s;
      L.jade = [pad, y, leftW, 34 * s];
      y += 40 * s;
      L.mandate = [pad, y, leftW, 56 * s];
      y += 60 * s;
      L.power = [pad, y, leftW, 50 * s];
      y += 58 * s;
      L.buttons = buttons(pad, y, leftW);
      L.tabs = TABS.map((_, i) => [rx + (i * rw) / 4, y0 + pad, rw / 4 - 3 * s, 40 * s] as Rect);
      const gy = y0 + pad + 40 * s + gap;
      L.cells = items.map((type, i) => ({ rect: [rx + (i % cols) * (cw + gap), gy + Math.floor(i / cols) * (ch + gap), cw, ch] as Rect, type }));
    }
    // selection panel (bottom-left)
    const sel = [...g.selection].map((id) => g.world.get(id)).filter(Boolean);
    L.selPanel = null;
    L.selButtons = [];
    if (sel.length && !g.demo) {
      const pw = Math.min(330 * s, L.view[2] - 24 * s), ph = 92 * s;
      const vb = L.view[1] + L.view[3];
      L.selPanel = [12 * s, vb - ph - 12 * s, pw, ph];
      const units = g.selectedUnits();
      const bx = 12 * s + 150 * s;
      const btn = (i: number, label: string, key: string) => L.selButtons.push({ rect: [bx + i * 58 * s, vb - 12 * s - 38 * s, 54 * s, 28 * s], label, key });
      if (units.length) {
        let i = 0;
        if (units.some((u) => g.world.utype(u).deploysInto)) btn(i++, 'Deploy', 'deploy');
        btn(i++, 'Stop', 'stop');
        if (units.some((u) => g.world.utype(u).weapon)) btn(i++, 'Attack', 'amove');
        if (units.some((u) => g.world.utype(u).spell)) btn(i++, 'Cast Q', 'cast');
      }
      // touch: no Escape key or empty-ground click to clear the selection
      if (input.pointer.touch) L.selButtons.push({ rect: [12 * s + pw - 34 * s, vb - ph - 12 * s + 6 * s, 28 * s, 26 * s], label: '×', key: 'deselect' });
    }
    // a single production building: make it the primary (units of its kind walk out of it)
    const fac = this.selectedFactory();
    if (L.selPanel && fac && !g.world.isPrimary(fac)) L.selButtons.push({ rect: [L.selPanel[0] + 122 * s, L.selPanel[1] + L.selPanel[3] - 32 * s, 110 * s, 26 * s], label: 'Set primary', key: 'primary' });

    // --- hover + clicks
    this.hoverCell = null;
    this.hoverPower = inside(L.power, p.x, p.y);
    const overSide = inside(L.side, p.x, p.y);
    const overSel = L.selPanel ? inside(L.selPanel, p.x, p.y) : false;
    const over = overSide || overSel || (g.over !== null);
    const clickL = !!(input.clicked & 1), clickR = !!(input.clicked & 2);
    if (p.touch && (clickL || clickR)) this.lastTap = g.time;
    const hoverOk = !p.touch || (p.touches ?? 0) > 0 || g.time - this.lastTap < 2;
    if (hoverOk) for (const c of L.cells) if (inside(c.rect, p.x, p.y)) this.hoverCell = c.type;
    if (!hoverOk) this.hoverPower = false;
    if (g.over) {
      if (clickL && this.gameOverButton && inside(this.gameOverButton, p.x, p.y)) this.onRestart?.();
      return true;
    }
    if (!overSide && !overSel) {
      // minimap is inside the sidebar; nothing else to do
      return false;
    }
    if (inside(L.mini, p.x, p.y) && (p.buttons & 1 || clickR)) {
      const u = (p.x - L.mini[0]) / L.mini[2], v = (p.y - L.mini[1]) / L.mini[3];
      const wx = g.terrain.originX + u * g.map.cells * 3, wz = g.terrain.originZ + v * g.map.cells * 3;
      if (clickR && g.selectedUnits().length) {
        g.issue({ t: 'move', ids: g.selectedUnits().map((e) => e.id), x: g.lx(wx), z: g.lz(wz) });
      } else if (p.buttons & 1) g.cam.target = [wx, 0, wz - 4];
    }
    if (clickL || clickR) {
      L.tabs.forEach((r, i) => {
        if (clickL && inside(r, p.x, p.y)) this.tab = TABS[i].tab;
      });
      for (const c of L.cells) if (inside(c.rect, p.x, p.y)) this.clickCell(c.type, clickR);
      if (clickL && this.hoverPower) this.clickPower();
      if (clickL) for (const b of L.buttons) if (inside(b.rect, p.x, p.y)) this.clickButton(b.key);
      if (clickL) for (const b of L.selButtons) if (inside(b.rect, p.x, p.y)) this.clickButton(b.key);
    }
    return over;
  }
  onRestart?: () => void;
  private gameOverButton: Rect | null = null;

  private itemsFor(tab: Tab): EntityType[] {
    const g = this.g;
    return g.content.all().filter((t) => t.tab === tab && g.cameos.has(t.id) && !(t.kind === 'structure' && t.role === 'construction_yard'));
  }

  /** A single selected, finished building of mine that trains units. */
  private selectedFactory(): Entity | null {
    const g = this.g;
    if (g.selection.size !== 1) return null;
    const e = g.world.get([...g.selection][0]);
    return e && e.kind === 'structure' && e.owner === g.me && e.built && g.world.isFactory(e.typeId) ? e : null;
  }

  private clickCell(t: EntityType, right: boolean) {
    const g = this.g;
    if (g.demo) return;
    const q = g.player().queues[t.tab];
    if (right) {
      g.issue({ t: 'cancel', typeId: t.id });
      if (g.mode.kind === 'place' && g.mode.typeId === t.id) g.mode = { kind: 'normal' };
      return;
    }
    if (t.kind === 'structure') {
      if (q.ready === t.id) {
        g.mode = { kind: 'place', typeId: t.id };
        return;
      }
      if (q.ready || q.items.length) {
        g.say('Already building — one structure at a time per tab', 'warn');
        return;
      }
    }
    if (!g.world.canBuild(g.me, t.id)) {
      g.say(`Requires ${this.missing(t).join(', ')}`, 'warn');
      return;
    }
    g.issue({ t: 'queue', typeId: t.id });
  }
  private missing(t: EntityType): string[] {
    const g = this.g;
    const miss = t.prereqs.filter((p) => g.world.ownedCount(g.me, p) === 0).map((p) => g.content.get(p)?.name ?? p);
    if (t.kind === 'unit' && !t.producedAt.some((f) => g.world.ownedCount(g.me, f) > 0)) miss.push(...t.producedAt.map((f) => g.content.get(f)?.name ?? f));
    if (t.kind === 'structure' && g.world.ownedCount(g.me, 'azure_command_hall') === 0) miss.push('Governor’s Yamen (deploy the Caravan)');
    return [...new Set(miss)];
  }
  private clickPower() {
    const g = this.g;
    const pw = g.content.rules.powers[0];
    const p = g.player();
    if (p.powerCharge[pw.id] > 0) g.say(`${pw.name} is still charging`, 'warn');
    else if (g.world.mandate(g.me) < pw.mandateCost) g.say(`${pw.name} needs ${pw.mandateCost} Mandate`, 'warn');
    else g.mode = { kind: 'power', power: pw.id };
  }
  private clickButton(key: string) {
    const g = this.g;
    if (key === 'sell') g.mode = g.mode.kind === 'sell' ? { kind: 'normal' } : { kind: 'sell' };
    if (key === 'pause') g.paused = !g.paused;
    if (key === 'home') g.jumpHome();
    if (key === 'deploy') for (const u of g.selectedUnits()) if (g.world.utype(u).deploysInto) g.issue({ t: 'deploy', id: u.id });
    if (key === 'stop') g.issue({ t: 'stop', ids: g.selectedUnits().map((u) => u.id) });
    if (key === 'cast') g.beginCast();
    if (key === 'amove') g.mode = { kind: 'amove' };
    if (key === 'primary') {
      for (const id of g.selection) g.issue({ t: 'primary', id });
      g.say('Primary building set — new units leave here', 'good');
    }
    if (key === 'audio') g.say(nextTrack(g.platform.audio));
    if (key === 'deselect') {
      g.selection.clear();
      g.mode = { kind: 'normal' };
    }
  }

  // ------------------------------------------------------------------ drawing
  draw(s: number) {
    const g = this.g;
    const ui = g.ui;
    const d = g.renderer.device;
    const W = d.backbufferWidth, H = d.backbufferHeight;
    const L = this.L;
    this.blink += 1 / 60;
    if (!this.minimapTex) this.buildMinimap();

    this.drawWorldBars(s);
    // drag box
    const db = g.dragBox;
    if (db) {
      const x0 = Math.min(db.x0, db.x1), y0 = Math.min(db.y0, db.y1);
      ui.rect(x0, y0, Math.abs(db.x1 - db.x0), Math.abs(db.y1 - db.y0), 0x9fe8b0, 0.08);
      ui.outline(x0, y0, Math.abs(db.x1 - db.x0), Math.abs(db.y1 - db.y0), Math.max(1, s), 0xbff5cc, 0.9);
    }

    // ---- sidebar frame (lacquered wood + gold trim)
    const [sx, sy, sw, sh] = L.side;
    ui.gradient(sx, sy, sw, sh, LACQUER2, LACQUER, 1, 1);
    for (let yy = sy; yy < sy + sh; yy += 7 * s) ui.rect(sx, yy, sw, 1, 0x000000, 0.08 + 0.05 * Math.sin(yy * 0.05));
    if (this.dock === 'right') {
      ui.rect(sx, 0, 2 * s, H, GOLD, 0.9);
      ui.rect(sx + 3 * s, 0, 1 * s, H, 0x000000, 0.6);
      // header
      ui.text('AZURE DYNASTY', sx + 16 * s, 11 * s, 'disp16', GOLD);
      ui.text('苍朝', sx + sw - 16 * s, 8 * s, 'cjk20', INK, 1, { align: 'right' });
    } else {
      ui.rect(0, sy, W, 2 * s, GOLD, 0.9);
      ui.rect(0, sy + 3 * s, W, 1 * s, 0x000000, 0.6);
    }

    // ---- radar
    const [mx, my, mw, mh] = L.mini;
    ui.rect(mx - 3 * s, my - 3 * s, mw + 6 * s, mh + 6 * s, 0x000000, 1);
    if (this.minimapTex) ui.image({ texture: this.minimapTex }, mx, my, mw, mh);
    this.drawMinimapContents(s);
    ui.outline(mx - 3 * s, my - 3 * s, mw + 6 * s, mh + 6 * s, 2 * s, GOLD, 1);

    // ---- Qi bar
    const P = g.player();
    const [qx, qy, qw, qh] = L.qi;
    ui.rect(qx, qy, qw, qh, 0x120b09, 1);
    const maxQi = Math.max(200, Math.ceil(Math.max(P.qiProduced, P.qiUsed) / 100) * 100 + 100);
    const segs = 20;
    for (let i = 0; i < segs; i++) {
      const v = ((i + 1) / segs) * maxQi;
      const yy = qy + qh - 3 * s - ((i + 1) * (qh - 6 * s)) / segs;
      const on = v <= P.qiProduced;
      const col = P.lowPower ? (on ? RED : 0x2a1a18) : on ? (v <= P.qiUsed ? 0xbfeaff : QI) : 0x22303a;
      ui.rect(qx + 4 * s, yy + 1.5 * s, qw - 8 * s, (qh - 6 * s) / segs - 2.5 * s, col, P.lowPower && on ? 0.6 + 0.4 * Math.sin(this.blink * 8) : 1);
    }
    const ly = qy + qh - 3 * s - (Math.min(P.qiUsed, maxQi) / maxQi) * (qh - 6 * s);
    ui.poly([qx - 7 * s, ly - 5 * s, qx - 1 * s, ly, qx - 7 * s, ly + 5 * s], GOLD, 1);
    ui.outline(qx - 1 * s, qy - 2 * s, qw + 2 * s, qh + 4 * s, 2 * s, GOLD_DIM, 1);

    // ---- jade counter
    const [jx, jy, jw, jh] = L.jade;
    ui.rect(jx, jy, jw, jh, 0x120b09, 0.95);
    ui.outline(jx, jy, jw, jh, 1.5 * s, GOLD_DIM, 1);
    ui.text('灵玉', jx + 10 * s, jy + 4 * s, 'cjk20', JADE);
    ui.text(Math.floor(P.jade).toLocaleString('en-US'), jx + 62 * s, jy + 5 * s, 'disp22', INK);
    if (jw > 200 * s) ui.text(`Qi ${P.qiProduced}/${P.qiUsed}`, jx + jw - 10 * s, jy + 10 * s, 'ui14', P.lowPower ? RED : MUTED, 1, { align: 'right' });

    // ---- Mandate gauge + Heaven's Wrath
    const [ax, ay, , ah] = L.mandate;
    const mand = g.world.mandate(g.me);
    this.dispMandate += (mand - this.dispMandate) * 0.1;
    const cx = ax + 24 * s, cy = ay + ah / 2, r = 23 * s;
    ui.arc(cx, cy, r, 7 * s, 0, Math.PI * 2, 0x120b09, 1);
    const tierGoal = 150;
    ui.arc(cx, cy, r, 7 * s, 0, Math.PI * 2 * clamp(this.dispMandate / tierGoal, 0, 1), GOLD, 1);
    ui.text('天命', cx, cy - 10 * s, 'cjk14', INK, 1, { align: 'center' });
    ui.text(`${mand}`, ax + 54 * s, ay + 4 * s, 'disp22', INK);
    ui.text('Mandate', ax + 54 * s, ay + 30 * s, 'ui12', MUTED);
    ui.text(`Harmony ${P.harmony}%`, ax + 54 * s, ay + 44 * s, 'ui12', P.harmony >= 100 ? JADE : RED);
    const pw = g.content.rules.powers[0];
    const [px, py, ppw, pph] = L.power;
    const charge = P.powerCharge[pw.id] / pw.chargeTicks;
    const affordable = mand >= pw.mandateCost;
    const ready = charge <= 0 && affordable;
    ui.gradient(px, py, ppw, pph, ready ? 0x3a4a7a : 0x2a2230, ready ? 0x1a2240 : 0x181218, 1);
    if (charge > 0) ui.wipe(px, py, ppw, pph, Math.PI * 2 * (1 - charge), Math.PI * 2, 0x000000, 0.6);
    ui.text('天罚', px + 6 * s, py + 6 * s, 'cjk20', ready ? 0xcfe0ff : MUTED);
    ui.text("Heaven's", px + 48 * s, py + 7 * s, 'ui12', ready ? INK : MUTED);
    ui.text('Wrath', px + 48 * s, py + 21 * s, 'ui12', ready ? INK : MUTED);
    ui.text(`${pw.mandateCost} Mandate`, px + 8 * s, py + 35 * s, 'ui12', affordable ? GOLD : MUTED);
    ui.outline(px, py, ppw, pph, (ready ? 2 : 1.5) * s, ready ? (Math.sin(this.blink * 5) > 0 ? 0x9fb4ff : GOLD) : GOLD_DIM, 1);

    // ---- tabs
    L.tabs.forEach((rct, i) => {
      const t = TABS[i];
      const on = this.tab === t.tab;
      const q = P.queues[t.tab];
      const hasReady = !!q.ready;
      ui.gradient(rct[0], rct[1], rct[2], rct[3], on ? 0xc0382a : 0x4a2c22, on ? 0x7d1f14 : 0x2e1a14, 1);
      ui.outline(rct[0], rct[1], rct[2], rct[3], 1.5 * s, on ? GOLD : GOLD_DIM, 1);
      ui.text(t.hz, rct[0] + rct[2] / 2, rct[1] + 3 * s, 'cjk20', on ? 0xfff2d8 : INK, 1, { align: 'center' });
      ui.text(t.name, rct[0] + rct[2] / 2, rct[1] + 26 * s, 'ui11', on ? 0xfff2d8 : MUTED, 1, { align: 'center' });
      const busy = q.items.length > 0;
      if (hasReady || busy) ui.rect(rct[0] + 4 * s, rct[1] + 4 * s, 6 * s, 6 * s, hasReady ? (Math.sin(this.blink * 6) > 0 ? GOLD : JADE) : JADE, 1);
    });

    // ---- cameo grid
    for (const c of L.cells) this.drawCell(c.rect, c.type, s);

    // ---- bottom buttons
    for (const b of L.buttons) this.button(b.rect, b.label, s, !!b.on);

    // ---- selection panel
    if (L.selPanel) this.drawSelection(s);

    // ---- messages (EVA-style)
    let my2 = 14 * s;
    for (const m of g.messages) {
      const age = g.time - m.t;
      if (age > 7) continue;
      const a = age < 6 ? 1 : 1 - (age - 6);
      const col = m.tone === 'warn' ? 0xffb09a : m.tone === 'good' ? 0xb8f0c8 : INK;
      // wrapped to the map view (narrow on a portrait phone)
      my2 += ui.paragraph(m.text, 16 * s, my2, L.view[2] - 32 * s, 'ui16', col, a) + 4 * s;
    }
    // mode hint near cursor
    const p = g.platform.input.pointer;
    const rc = p.touch ? 'long-press' : 'right-click';
    const hint = g.mode.kind === 'place' ? `Place ${g.content.get(g.mode.typeId)?.name} · ${rc} to cancel` : g.mode.kind === 'power' ? `Choose where Heaven's Wrath strikes · ${rc} to cancel` : g.mode.kind === 'sell' ? 'Sell: click one of your structures (50% refund)' : g.mode.kind === 'amove' ? 'Attack-move: click a destination' : g.mode.kind === 'cast' ? `Choose where to cast · ${rc} to cancel` : '';
    if (hint && !inside(L.side, p.x, p.y)) ui.text(hint, p.x + 18 * s, p.y + 16 * s, 'ui14', 0xfff2d8);
    if (g.paused && !g.over) {
      const [vx, vy, vw, vh] = L.view;
      ui.rect(vx, vy + vh / 2 - 34 * s, vw, 68 * s, 0x000000, 0.45);
      ui.text('Paused  暂停', vx + vw / 2, vy + vh / 2 - 18 * s, 'disp22', GOLD, 1, { align: 'center' });
    }
    // tooltip
    if (this.hoverCell) this.tooltip(this.hoverCell, s);
    else if (this.hoverPower) this.powerTooltip(s);
    // game over
    this.gameOverButton = null;
    if (g.over) this.drawGameOver(s);
  }

  private button(r: Rect, label: string, s: number, on: boolean) {
    const ui = this.g.ui;
    const hov = inside(r, this.g.platform.input.pointer.x, this.g.platform.input.pointer.y);
    ui.gradient(r[0], r[1], r[2], r[3], on ? 0xc0382a : hov ? 0x5a3a2c : 0x3e271e, on ? 0x7d1f14 : 0x261712, 1);
    ui.outline(r[0], r[1], r[2], r[3], 1.5 * s, on || hov ? GOLD : GOLD_DIM, 1);
    ui.text(label, r[0] + r[2] / 2, r[1] + r[3] / 2 - 8 * s, 'ui14', INK, 1, { align: 'center' });
  }

  private drawCell(r: Rect, t: EntityType, s: number) {
    const g = this.g;
    const ui = g.ui;
    const P = g.player();
    const q = P.queues[t.tab];
    const tex = g.cameos.get(t.id);
    const can = g.world.canBuild(g.me, t.id);
    const [x, y, w, h] = r;
    ui.rect(x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s, 0x000000, 1);
    if (tex) ui.image({ texture: tex, flipY: !g.renderer.device.caps.uvOriginTop }, x, y, w, h, can ? 0xffffff : 0x6a6a6a, 1);
    const queued = q.items.filter((i) => i.typeId === t.id);
    const head = q.items[0];
    if (head && head.typeId === t.id) {
      const frac = head.progress / (t.buildTicks * 100);
      // clock-wipe: remaining portion darkened
      ui.wipe(x, y, w, h, Math.PI * 2 * frac, Math.PI * 2, 0x000000, 0.55);
      ui.text(`${Math.floor(frac * 100)}%`, x + 6 * s, y + 4 * s, 'ui14', INK);
    } else if (queued.length) ui.rect(x, y, w, h, 0x000000, 0.35);
    if (t.kind === 'unit' && queued.length) {
      // how many are queued in total: a badge on the right edge, clear of the hanzi and the caption
      const bw = Math.max(26 * s, ui.measure(`${queued.length}`, 'ui16') + 12 * s), bh = 22 * s;
      const bx = x + w - bw - 4 * s, by = y + h - 20 * s - bh - 4 * s;
      ui.rect(bx, by, bw, bh, 0x140c0a, 0.9);
      ui.outline(bx, by, bw, bh, 1.5 * s, GOLD, 1);
      ui.text(`${queued.length}`, bx + bw / 2, by + 2 * s, 'ui16', 0xfff2d8, 1, { align: 'center' });
    }
    if (q.ready === t.id) {
      ui.rect(x, y + h / 2 - 14 * s, w, 28 * s, 0x000000, 0.8);
      ui.text('READY', x + w / 2, y + h / 2 - 11 * s, 'disp16', Math.sin(this.blink * 6) > -0.3 ? GOLD : INK, 1, { align: 'center' });
    }
    if (!can) {
      ui.text('Locked', x + w / 2, y + h / 2 - 22 * s, 'ui12', MUTED, 1, { align: 'center' });
    }
    // caption strip
    ui.rect(x, y + h - 20 * s, w, 20 * s, 0x000000, 0.72);
    const costW = ui.measure(`${t.cost}`, 'ui12') + 10 * s;
    let label = t.name.replace('Governor’s ', '').replace('Artificer ', '');
    while (label.length > 3 && ui.measure(label, 'ui12') > w - costW - 8 * s) label = label.slice(0, -2) + '…';
    ui.text(label, x + 5 * s, y + h - 18 * s, 'ui12', INK);
    ui.text(`${t.cost}`, x + w - 5 * s, y + h - 18 * s, 'ui12', P.jade >= t.cost ? JADE : RED, 1, { align: 'right' });
    ui.text(t.hanzi.slice(0, 1), x + w - 6 * s, y + 3 * s, 'cjk14', GOLD, 0.9, { align: 'right' });
    const hov = this.hoverCell === t;
    ui.outline(x - 3 * s, y - 3 * s, w + 6 * s, h + 6 * s, (hov ? 2.5 : 2) * s, hov ? 0xffe6a0 : q.ready === t.id ? GOLD : GOLD_DIM, 1);
  }

  private tooltip(t: EntityType, s: number) {
    const g = this.g;
    const ui = g.ui;
    const w = Math.min(300 * s, this.L.view[2] - 16 * s);
    const bottom = this.dock === 'bottom';
    const x = bottom ? clamp(g.platform.input.pointer.x - w / 2, 8 * s, this.L.view[2] - w - 8 * s) : this.L.side[0] - w - 12 * s;
    let y = Math.min(g.platform.input.pointer.y - 20 * s, g.renderer.device.backbufferHeight - 220 * s);
    const lines: [string, number][] = [];
    lines.push([`Cost ${t.cost} jade · ${Math.round(t.buildTicks / TICK_HZ)} s`, INK]);
    if (t.kind === 'structure') {
      if (t.qi) lines.push([t.qi > 0 ? `Produces ${t.qi} Qi` : `Uses ${-t.qi} Qi`, t.qi > 0 ? QI : MUTED]);
      lines.push([`Footprint ${t.footprint[0]}×${t.footprint[1]} · Mandate +${t.mandatePerMin}/min`, MUTED]);
      if (t.harmony) lines.push([`Harmony: beside ${t.harmony.adjacentTo.map((a) => (a === 'water' ? 'water' : g.content.get(a)?.name ?? a)).join(' or ')}`, 0xffd060]);
    } else {
      lines.push([`${t.hp} HP · ${t.armor} armour${t.weapon ? ` · ${t.weapon.damage} dmg, range ${(t.weapon.range / LEPTONS).toFixed(1)}` : ''}`, MUTED]);
    }
    const miss = g.world.canBuild(g.me, t.id) ? [] : this.missing(t);
    const bodyH = 60 * s + lines.length * 18 * s + (miss.length ? 20 * s : 0) + 70 * s;
    y = bottom ? this.L.side[1] - bodyH - 8 * s : Math.max(8 * s, y);
    ui.rect(x, y, w, bodyH, 0x140c0a, 0.95);
    ui.outline(x, y, w, bodyH, 1.5 * s, GOLD, 1);
    ui.text(t.name, x + 12 * s, y + 10 * s, 'disp16', GOLD);
    ui.text(t.hanzi, x + w - 12 * s, y + 7 * s, 'cjk20', INK, 1, { align: 'right' });
    let yy = y + 38 * s;
    for (const [l, c] of lines) {
      ui.text(l, x + 12 * s, yy, 'ui14', c);
      yy += 18 * s;
    }
    if (miss.length) {
      ui.text(`Requires: ${miss.join(', ')}`, x + 12 * s, yy, 'ui14', RED);
      yy += 20 * s;
    }
    ui.paragraph(t.description.replace(/\s*\(Model: next asset batch\.\)/, ''), x + 12 * s, yy + 4 * s, w - 24 * s, 'ui13', 0xd8ccb0);
  }
  private powerTooltip(s: number) {
    const g = this.g;
    const ui = g.ui;
    const pw = g.content.rules.powers[0];
    const w = Math.min(300 * s, this.L.view[2] - 16 * s);
    const x = this.dock === 'bottom' ? 8 * s : this.L.side[0] - w - 12 * s;
    const y = this.dock === 'bottom' ? this.L.side[1] - 158 * s : this.L.power[1] - 10 * s;
    ui.rect(x, y, w, 150 * s, 0x140c0a, 0.95);
    ui.outline(x, y, w, 150 * s, 1.5 * s, 0x9fb4ff, 1);
    ui.text(pw.name, x + 12 * s, y + 10 * s, 'disp16', 0xcfe0ff);
    ui.text(pw.hanzi, x + w - 12 * s, y + 7 * s, 'cjk20', INK, 1, { align: 'right' });
    ui.text(`Costs ${pw.mandateCost} Mandate · recharges ${Math.round(pw.chargeTicks / TICK_HZ)} s`, x + 12 * s, y + 38 * s, 'ui14', GOLD);
    ui.paragraph(pw.description, x + 12 * s, y + 60 * s, w - 24 * s, 'ui13', 0xd8ccb0);
  }

  private drawSelection(s: number) {
    const g = this.g;
    const ui = g.ui;
    const [x, y, w, h] = this.L.selPanel!;
    // re-read the selection: the layout pass ran before this frame's sim ticks, and a selected
    // unit may have died (or a structure been sold) in between
    const sel = [...g.selection].map((id) => g.world.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
    const first = sel[0];
    if (!first) return;
    const t = g.world.type(first);
    ui.rect(x, y, w, h, 0x140c0a, 0.9);
    ui.outline(x, y, w, h, 1.5 * s, GOLD_DIM, 1);
    const tex = g.cameos.get(first.typeId);
    if (tex) ui.image({ texture: tex, flipY: !g.renderer.device.caps.uvOriginTop }, x + 8 * s, y + 8 * s, 104 * s, h - 16 * s);
    ui.outline(x + 8 * s, y + 8 * s, 104 * s, h - 16 * s, 1.5 * s, GOLD_DIM, 1);
    const title = sel.length > 1 ? `${sel.length} selected` : t.name;
    ui.text(title, x + 122 * s, y + 8 * s, 'disp16', GOLD);
    if (sel.length === 1) {
      const frac = first.hp / first.maxHp;
      const extra = first.kind === 'unit' && g.world.utype(first).harvester ? ` · cargo ${first.cargo}` : '';
      const hpText = `${Math.max(0, first.hp)}/${first.maxHp}${extra}`;
      const barW = Math.max(40 * s, w - 122 * s - ui.measure(hpText, 'ui12') - 18 * s);
      ui.rect(x + 122 * s, y + 32 * s, barW, 7 * s, 0x000000, 1);
      ui.rect(x + 122 * s, y + 32 * s, barW * frac, 7 * s, frac > 0.5 ? 0x5ee07a : frac > 0.25 ? 0xf0c040 : RED, 1);
      ui.text(hpText, x + w - 8 * s, y + 27 * s, 'ui12', MUTED, 1, { align: 'right' });
    }
    // signature spell of the selected casters: name + readiness
    const casters = sel.filter((e) => e.kind === 'unit' && g.world.utype(e).spell);
    if (casters.length) {
      const sp = g.world.utype(casters[0]).spell!;
      const cd = Math.min(...casters.map((e) => e.spellCd)) / 15;
      ui.text(`${sp.hanzi} ${sp.name}`, x + 122 * s, y + 42 * s, 'ui12', GOLD);
      ui.text(cd > 0 ? `${Math.ceil(cd)} s` : 'ready', x + 280 * s, y + 42 * s, 'ui12', cd > 0 ? MUTED : JADE);
    }
    // production building: primary status and the speed bonus from owning several
    const fac = this.selectedFactory();
    if (fac) {
      const n = g.world.ownedCount(g.me, fac.typeId);
      const speed = n > 1 ? `${n} built · training ×${(1 + (n - 1) * 0.5).toFixed(1)}` : '';
      if (g.world.isPrimary(fac)) {
        ui.text('主 Primary — new units leave here', x + 122 * s, y + 44 * s, 'ui12', GOLD);
        if (speed) ui.text(speed, x + 122 * s, y + 62 * s, 'ui12', MUTED);
      } else ui.text(`Not primary${speed ? ' · ' + speed : ''}`, x + 122 * s, y + 44 * s, 'ui12', MUTED);
    }
    for (const b of this.L.selButtons) this.button(b.rect, b.label, s, g.mode.kind === 'cast' && b.key === 'cast');
  }

  private drawWorldBars(s: number) {
    const g = this.g;
    const ui = g.ui;
    for (const e of g.world.entities) {
      if (!e.alive || (e.kind !== 'unit' && e.kind !== 'structure')) continue;
      // the primary of several production buildings of a kind wears a gold 主 tag
      if (e.kind === 'structure' && e.owner === g.me && e.built && g.world.isFactory(e.typeId) && g.world.ownedCount(g.me, e.typeId) > 1 && g.world.isPrimary(e)) {
        const top = g.lib.manifest.get(g.world.stype(e).model)?.bounds.max[1] ?? 6;
        const wx = g.wx(e.x), wz = g.wz(e.z);
        const pp = g.project([wx, g.h(wx, wz) + top, wz]);
        if (pp[2] > 0) {
          ui.rect(pp[0] - 12 * s, pp[1] - 36 * s, 24 * s, 24 * s, 0x140c0a, 0.85);
          ui.outline(pp[0] - 12 * s, pp[1] - 36 * s, 24 * s, 24 * s, 1.5 * s, GOLD, 1);
          ui.text('主', pp[0], pp[1] - 35 * s, 'cjk20', GOLD, 1, { align: 'center' });
        }
      }
      const sel = g.selection.has(e.id);
      if (!sel && e.hp >= e.maxHp && g.hoverId !== e.id) continue;
      let wx: number, wz: number, top: number;
      if (e.kind === 'unit') {
        [wx, wz] = g.pos(e);
        top = g.world.utype(e).category === 'vehicle' ? 3.4 : 2.3;
      } else {
        wx = g.wx(e.x);
        wz = g.wz(e.z);
        top = g.lib.manifest.get(g.world.stype(e).model)?.bounds.max[1] ?? 6;
      }
      const p = g.project([wx, g.h(wx, wz) + top, wz]);
      if (p[2] <= 0) continue;
      const frac = clamp(e.hp / e.maxHp, 0, 1);
      const bw = (e.kind === 'structure' ? 64 : e.kind === 'unit' && g.world.utype(e).category === 'vehicle' ? 36 : 22) * s;
      const pips = e.kind === 'structure' ? 16 : 6;
      const x0 = p[0] - bw / 2, y0 = p[1] - 6 * s;
      ui.rect(x0 - 1 * s, y0 - 1 * s, bw + 2 * s, 5 * s, 0x000000, 0.8);
      const col = frac > 0.5 ? 0x5ee07a : frac > 0.25 ? 0xf0c040 : RED;
      const pw = bw / pips;
      for (let i = 0; i < pips; i++) if ((i + 0.5) / pips <= frac + 0.001) ui.rect(x0 + i * pw + 0.5 * s, y0, pw - 1 * s, 3 * s, col, 1);
      if (e.kind === 'unit' && e.owner === g.me && g.world.utype(e).harvester && sel) {
        const cf = e.cargo / g.world.utype(e).harvester!.capacity;
        ui.rect(x0, y0 + 5 * s, bw * cf, 2 * s, JADE, 1);
      }
    }
  }

  private drawMinimapContents(s: number) {
    const g = this.g;
    const ui = g.ui;
    const [mx, my, mw, mh] = this.L.mini;
    const k = mw / (g.map.cells * LEPTONS);
    for (const e of g.world.entities) {
      if (!e.alive) continue;
      if (e.kind === 'jade') {
        if (e.amount > 0) ui.rect(mx + e.x * k - 1 * s, my + e.z * k - 1 * s, 2 * s, 2 * s, JADE, 0.9);
      } else if (e.kind === 'structure') {
        ui.rect(mx + e.cx * LEPTONS * k, my + e.cz * LEPTONS * k, e.w * LEPTONS * k, e.h * LEPTONS * k, TEAM_PALETTE[e.owner] ?? 0xffffff, 1);
      } else if (e.kind === 'unit') {
        const sz = 2.5 * s;
        ui.rect(mx + e.x * k - sz / 2, my + e.z * k - sz / 2, sz, sz, g.selection.has(e.id) ? 0xffffff : TEAM_PALETTE[e.owner] ?? 0xffffff, 1);
      }
    }
    // camera footprint
    const d = g.renderer.device;
    void d;
    const [vx, vy, vw, vh] = this.L.view;
    const corners: V3[] = [g.groundAt(vx, vy), g.groundAt(vx + vw, vy), g.groundAt(vx + vw, vy + vh), g.groundAt(vx, vy + vh)];
    const toM = (p: V3) => [mx + clamp((p[0] - g.terrain.originX) / (g.map.cells * 3), 0, 1) * mw, my + clamp((p[2] - g.terrain.originZ) / (g.map.cells * 3), 0, 1) * mh];
    for (let i = 0; i < 4; i++) {
      const a = toM(corners[i]), b = toM(corners[(i + 1) % 4]);
      ui.line(a[0], a[1], b[0], b[1], 1.5 * s, 0xffffff, 0.85);
    }
  }

  private drawGameOver(s: number) {
    const g = this.g;
    const ui = g.ui;
    const d = g.renderer.device;
    const W = d.backbufferWidth, H = d.backbufferHeight;
    const a = clamp((g.time - g.over!.t) / 0.8, 0, 1);
    ui.rect(0, 0, W, H, 0x000000, 0.55 * a);
    const won = g.over!.won;
    const cx = W / 2, cy = H / 2;
    ui.text(won ? '胜' : '败', cx, cy - 170 * s, 'cjk80', won ? GOLD : 0xd04a38, a, { align: 'center' });
    ui.text(won ? 'Victory — the Mandate is yours' : 'Defeat — the Mandate has passed', cx, cy - 58 * s, 'disp28', INK, a, { align: 'center' });
    const P = g.player();
    const E = g.world.players.find((p) => p.id !== g.me)!;
    const rows: [string, string, string][] = [
      ['', 'You', E.name],
      ['Structures built', `${P.stats.built}`, `${E.stats.built}`],
      ['Units trained', `${P.stats.trained}`, `${E.stats.trained}`],
      ['Enemies destroyed', `${P.stats.kills}`, `${E.stats.kills}`],
      ['Jade harvested', `${P.stats.harvested}`, `${E.stats.harvested}`],
    ];
    rows.forEach((r, i) => {
      const yy = cy - 12 * s + i * 22 * s;
      ui.text(r[0], cx - 170 * s, yy, 'ui14', MUTED, a);
      ui.text(r[1], cx + 40 * s, yy, 'ui14', i ? INK : GOLD, a, { align: 'center' });
      ui.text(r[2], cx + 150 * s, yy, 'ui14', i ? INK : GOLD, a, { align: 'center' });
    });
    const br: Rect = [cx - 90 * s, cy + 110 * s, 180 * s, 40 * s];
    this.gameOverButton = br;
    this.button(br, 'Play again', s, false);
    ui.text(`Game time ${Math.floor(g.world.tick / TICK_HZ / 60)}:${String(Math.floor(g.world.tick / TICK_HZ) % 60).padStart(2, '0')}`, cx, cy + 162 * s, 'ui13', MUTED, a, { align: 'center' });
  }
}

export const HUD_COLORS = { LACQUER, GOLD, INK, VERM };
