// Game client: owns a deterministic World and presents it — interpolation, animation choice,
// VFX, selection and commands. Input arrives through the Platform abstraction; the HUD is
// engine-drawn (see hud.ts), so nothing here depends on the browser.

import type { Platform } from '../platform/platform';
import type { Renderer, RenderInstance, GpuModel, Camera } from '../render/renderer';
import { DEFAULT_LIGHTING } from '../render/renderer';
import { OverlayBatch } from '../render/overlay';
import { ParticleSystem } from '../render/particles';
import { FxMeshRenderer } from '../render/fxMeshes';
import { GroundFx } from '../render/groundFx';
import { UIRenderer } from '../render/ui';
import { OrbitCamera, screenRay } from '../render/camera';
import { buildTerrainGpu, destroyTerrainGpu, TerrainGpu } from '../render/terrainRenderer';
import { Content } from '../sim/content';
import { World, Entity, SimEvent, PlayerState, TAB_ORDER } from '../sim/world';
import { createSkirmishAI, Difficulty } from '../sim/ai';
import { LEPTONS, TICK_HZ } from '../sim/intmath';
import { generateSkirmishMap, SkirmishMap } from '../world/skirmishMap';
import { heightAt, flattenRect, computeTerrainAO, TerrainData } from '../world/terrain';
import { DEG, V3, m4FromTRS, quatAxisAngle, quatMul, clamp, m4Mul, M4 } from '../core/math';
import { TEAM_COLORS } from '../core/materialModel';
import { ModelLibrary, renderCameo } from './assets';
import { VFX } from './vfx';
import { MagicFx } from './magicFx';
import { Sfx } from './sfx';
import { MagicGallery } from './gallery';
import { Hud } from './hud';
import { audioPrefs, setAudioMode } from './audioPrefs';
import type { Texture } from '../render/rhi/types';
import factionJson from '../../content/factions/azure_dynasty.json';
import rulesJson from '../../content/rules.json';

export type Mode = { kind: 'normal' } | { kind: 'place'; typeId: string; dragFrom?: [number, number] } | { kind: 'power'; power: string } | { kind: 'sell' } | { kind: 'amove' } | { kind: 'cast' };

export interface Message {
  text: string;
  tone: 'info' | 'warn' | 'good';
  t: number;
}

interface Corpse {
  typeId: string;
  kind: 'unit' | 'structure';
  x: number;
  z: number;
  yaw: number;
  owner: number;
  t0: number;
}
interface ProjVisual {
  kind: string;
  sx: number;
  sz: number;
  sy: number;
  tx: number;
  tz: number;
  dist: number;
  last: V3;
}

/** Where in each attack clip the blow lands, minus the sim wind-up, so the shot lines up with the swing. */
const ATTACK_ANIM: Record<string, { duration: number; offset: number }> = {
  azure_halberdier: { duration: 1.1, offset: 0.12 },
  azure_archer: { duration: 1.3, offset: 0.62 },
  azure_daoist: { duration: 1.2, offset: 0.32 },
  // adepts: the gesture's release lines up with the sim's windup (0.25 s)
  azure_fire_adept: { duration: 1.1, offset: 0.25 },
  azure_ice_adept: { duration: 1.1, offset: 0.2 },
  azure_water_adept: { duration: 1.1, offset: 0.2 },
  azure_air_adept: { duration: 1.1, offset: 0.15 },
};

export const TEAM_PALETTE = [TEAM_COLORS.azure, TEAM_COLORS.crimson, TEAM_COLORS.jade, TEAM_COLORS.gold];

export class Game {
  content = new Content(factionJson, rulesJson);
  map: SkirmishMap;
  world: World;
  terrain: TerrainData;
  terrainGpu: TerrainGpu;
  overlay: OverlayBatch;
  particles: ParticleSystem;
  fxMeshes: FxMeshRenderer;
  groundFx: GroundFx;
  vfx: VFX;
  magic: MagicFx;
  sound: Sfx;
  ui: UIRenderer;
  hud: Hud;
  cam = new OrbitCamera();
  me = 0;
  selection = new Set<number>();
  groups = new Map<number, number[]>();
  mode: Mode = { kind: 'normal' };
  messages: Message[] = [];
  time = 0; // presentation clock (s)
  paused = false;
  speed = 1;
  over: { won: boolean; t: number } | null = null;
  cameos = new Map<string, Texture>();
  lastAlert: [number, number] | null = null;
  hoverId = 0;
  ground: V3 = [0, 0, 0];
  camera!: Camera;
  private acc = 0;
  private prev = new Map<number, [number, number, number]>();
  private corpses: Corpse[] = [];
  private projs = new Map<number, ProjVisual>();
  private drag: { x0: number; y0: number; x1: number; y1: number; active: boolean } | null = null;
  /** ground point held by a grab-pan, and the touch count it started with */
  private grab: V3 | null = null;
  private grabTouches = 0;
  private orderMarkers: { x: number; z: number; t: number; attack: boolean }[] = [];
  private smokeTimer = 0;
  private lastClick = { t: -10, id: 0 };
  private terrainDirty = false;
  demo: boolean;
  gallery: MagicGallery | null = null;
  /** debug/screenshot hook: hold VFX still */
  freezeFx = false;

  constructor(public platform: Platform, public renderer: Renderer, public lib: ModelLibrary, opts: { difficulty: Difficulty; seed?: number; demo?: boolean; gallery?: boolean }) {
    this.demo = !!opts.demo || !!opts.gallery;
    this.map = generateSkirmishMap(11);
    this.terrain = this.map.terrain;
    const players = this.demo
      ? [{ name: 'Azure Court', team: 0, ai: true }, { name: 'Crimson Warlord', team: 1, ai: true }]
      : [{ name: 'You', team: 0, ai: false }, { name: 'Crimson Warlord', team: 1, ai: true }];
    this.world = new World(this.content, this.map, players, opts.seed ?? 7);
    if (this.demo) this.world.controllers[0] = createSkirmishAI('normal');
    this.world.controllers[1] = createSkirmishAI(opts.difficulty);
    this.terrainGpu = buildTerrainGpu(renderer.device, this.terrain);
    this.overlay = new OverlayBatch(renderer.device, renderer);
    this.particles = new ParticleSystem(renderer.device, renderer);
    this.particles.heightAt = (x, z) => this.h(x, z);
    this.fxMeshes = new FxMeshRenderer(renderer.device, renderer);
    this.groundFx = new GroundFx(renderer.device, this.terrainGpu.rect);
    this.vfx = new VFX(this.particles, this.fxMeshes, this.groundFx);
    this.magic = new MagicFx(this);
    const game = this;
    this.sound = new Sfx(platform.audio, {
      project: (p) => game.project(p),
      get screenWidth() { return game.renderer.device.backbufferWidth; },
      get screenHeight() { return game.renderer.device.backbufferHeight; },
      get focus() { return game.cam.target; },
    });
    this.onSfx = (name, p, v) => this.sound.play(name, p, v);
    this.ui = new UIRenderer(renderer.device);
    this.hud = new Hud(this);
    // camera over our caravan
    const st = this.map.starts[this.me];
    this.cam.yaw = 0;
    this.cam.pitch = 52 * DEG;
    this.cam.fov = 30 * DEG;
    this.cam.distance = 82;
    this.cam.minDist = 30;
    this.cam.maxDist = 125;
    this.cam.target = [this.wx(st.cx * LEPTONS + 128), 0, this.wz(st.cz * LEPTONS + 128) - 4];
    this.snapshot();
    if (opts.gallery) {
      this.gallery = new MagicGallery(this);
      this.cam.target = [this.gallery.focus[0], 0, this.gallery.focus[1] - 4];
    }
    if (!this.demo) {
      this.say('Select the Imperial Caravan and press D (or click it again) to found your Yamen', 'good');
      this.say('Then build a Qi Shrine, a Garrison Camp and a Jade Refinery from the sidebar');
    }
  }

  // ------------------------------------------------------------------ coordinates
  wx(l: number) {
    return this.terrain.originX + (l * 3) / LEPTONS;
  }
  wz(l: number) {
    return this.terrain.originZ + (l * 3) / LEPTONS;
  }
  lx(x: number) {
    return Math.round(((x - this.terrain.originX) * LEPTONS) / 3);
  }
  lz(z: number) {
    return Math.round(((z - this.terrain.originZ) * LEPTONS) / 3);
  }
  h = (x: number, z: number) => heightAt(this.terrain, x, z);
  player(): PlayerState {
    return this.world.players[this.me];
  }
  teamOf(owner: number) {
    return owner < 0 ? 5 : owner;
  }

  /** Render cameo portraits for everything that can appear on the sidebar. */
  buildCameos(scale: number) {
    const w = Math.round(116 * scale * 1.5), h = Math.round(84 * scale * 1.5);
    for (const t of this.content.all()) {
      if (!this.lib.models.has(t.model) || this.cameos.has(t.id)) continue;
      this.cameos.set(t.id, renderCameo(this.renderer, this.lib, t.model, w, h, this.me, TEAM_PALETTE));
    }
  }

  // ------------------------------------------------------------------ messages
  say(text: string, tone: Message['tone'] = 'info') {
    if (this.messages.length && this.messages[this.messages.length - 1].text === text && this.time - this.messages[this.messages.length - 1].t < 3) return;
    this.messages.push({ text, tone, t: this.time });
    if (this.messages.length > 6) this.messages.shift();
  }

  // ------------------------------------------------------------------ simulation
  private snapshot() {
    this.prev.clear();
    for (const e of this.world.entities) if (e.alive && (e.kind === 'unit' || e.kind === 'projectile')) this.prev.set(e.id, [e.x, e.z, e.facing]);
  }
  issue(cmd: Parameters<World['issue']>[1]) {
    if (!this.demo) this.world.issue(this.me, cmd);
  }

  update(dt: number) {
    this.time += dt;
    this.sound.tick(dt);
    this.heat *= Math.exp(-dt / 10);
    if (!this.paused && !this.over) {
      this.acc += dt * this.speed;
      const step = 1 / TICK_HZ;
      let n = 0;
      while (this.acc >= step && n < 5) {
        this.snapshot();
        this.world.step();
        this.handleEvents(this.world.events);
        this.acc -= step;
        n++;
      }
      if (n === 5) this.acc = 0;
    }
    if (this.terrainDirty) {
      this.terrainDirty = false;
      computeTerrainAO(this.terrain);
      destroyTerrainGpu(this.terrainGpu);
      this.terrainGpu = buildTerrainGpu(this.renderer.device, this.terrain);
    }
    if (!this.freezeFx) {
      this.vfx.update(dt);
      this.magic.update(dt);
      this.ambientFx(dt);
    }
    // drop dead selections
    for (const id of this.selection) if (!this.world.get(id)) this.selection.delete(id);
  }

  isWater(x: number, z: number) {
    return this.h(x, z) < this.terrain.waterLevel - 0.25;
  }
  /** Sound hook (see game/sfx.ts once audio is attached). */
  /** p = null for interface sounds (no position) */
  sfx(name: string, p: V3 | null, volume = 1) {
    this.onSfx?.(name, p, volume);
  }
  onSfx?: (name: string, p: V3 | null, volume: number) => void;

  alpha() {
    return clamp(this.acc * TICK_HZ, 0, 1);
  }
  /** Interpolated world position (metres) of a unit/projectile. */
  pos(e: Entity): [number, number, number] {
    const p = this.prev.get(e.id);
    const a = this.alpha();
    let lx = e.x, lz = e.z, f = e.facing;
    if (p) {
      lx = p[0] + (e.x - p[0]) * a;
      lz = p[1] + (e.z - p[1]) * a;
      let d = ((e.facing - p[2] + 128) & 255) - 128;
      f = p[2] + d * a;
    }
    return [this.wx(lx), this.wz(lz), f];
  }

  /** Combat heat for the music: fighting involving my forces or on screen; decays over ~10 s. */
  private heat = 0;
  musicIntensity(): number {
    if (this.demo) return 0.05;
    if (this.gallery) return 0.35;
    if (this.over) return 0;
    return clamp(this.heat, 0, 1);
  }
  private heatFrom(ev: SimEvent) {
    const near = (x: number, z: number) => Math.hypot(this.wx(x) - this.cam.target[0], this.wz(z) - this.cam.target[2]) < 45;
    if (ev.e === 'damage') {
      const e = this.world.get(ev.id);
      if (e && (e.owner === this.me || near(e.x, e.z))) this.heat += Math.min(0.08, ev.amount / 400);
    } else if (ev.e === 'death' && ev.kind !== 'projectile' && (ev.owner === this.me || near(ev.x, ev.z))) this.heat += 0.12;
    else if (ev.e === 'powerStrike') this.heat += 0.8;
  }

  handleEvents(events: SimEvent[]) {
    const W = this.world;
    for (const ev of events) {
      this.heatFrom(ev);
      // elemental magic has its own effects module; projectile tracking below still applies
      if (this.magic.onEvent(ev) && ev.e !== 'fire') continue;
      switch (ev.e) {
        case 'fire': {
          const src = W.get(ev.id);
          const sx = this.wx(ev.x), sz = this.wz(ev.z);
          const srcH = src && src.kind === 'structure' ? (src.typeId === 'azure_arrow_tower' ? 5.1 : 2.2) : 1.35;
          const tx = this.wx(ev.tx), tz = this.wz(ev.tz);
          this.projs.set(ev.proj, { kind: ev.kind, sx, sz, sy: this.h(sx, sz) + srcH, tx, tz, dist: Math.hypot(tx - sx, tz - sz), last: [sx, this.h(sx, sz) + srcH, sz] });
          if (ev.kind === 'talisman') {
            this.vfx.talismanCast([sx, this.h(sx, sz) + 1.4, sz]);
            this.sfx('talisman_cast', [sx, this.h(sx, sz), sz], 0.6);
          } else if (ev.kind === 'arrow') this.sfx('arrow', [sx, this.h(sx, sz), sz], 0.35);
          break;
        }
        case 'impact': {
          const x = this.wx(ev.x), z = this.wz(ev.z);
          const p: V3 = [x, this.h(x, z) + 0.6, z];
          if (ev.kind === 'talisman') {
            this.vfx.talismanBurst([x, this.h(x, z), z], (ev.splash / LEPTONS) * 3 * 0.5);
            this.sfx('talisman_hit', p, 0.7);
          } else {
            this.vfx.arrowHit(p);
            this.sfx('arrow_hit', p, 0.3);
          }
          break;
        }
        case 'melee': {
          const x = this.wx(ev.x), z = this.wz(ev.z);
          this.vfx.meleeHit([x, this.h(x, z), z]);
          this.sfx('melee', [x, this.h(x, z), z], 0.35);
          break;
        }
        case 'death': {
          const x = this.wx(ev.x), z = this.wz(ev.z);
          const t = this.content.get(ev.typeId);
          if (ev.kind === 'unit') {
            const e = W.byId.get(ev.id);
            this.corpses.push({ typeId: ev.typeId, kind: 'unit', x, z, yaw: e ? (e.facing / 256) * Math.PI * 2 : 0, owner: ev.owner, t0: this.time });
            this.vfx.unitDeath([x, this.h(x, z), z], t?.kind === 'unit' && t.category === 'vehicle');
            if (ev.owner === this.me) this.say('Unit lost', 'warn');
          } else if (ev.kind === 'structure') {
            this.corpses.push({ typeId: ev.typeId, kind: 'structure', x, z, yaw: 0, owner: ev.owner, t0: this.time });
            const fp = t && t.kind === 'structure' ? t.footprint : [2, 2];
            this.vfx.structureExplosion([x, this.h(x, z), z], Math.max(0.6, (fp[0] + fp[1]) / 5));
            this.sfx('explosion', [x, this.h(x, z), z], 1);
            if (ev.owner === this.me) this.say('Structure lost', 'warn');
          }
          this.selection.delete(ev.id);
          break;
        }
        case 'placed': {
          const s = W.byId.get(ev.id)!;
          const x0 = this.wx(s.cx * LEPTONS), z0 = this.wz(s.cz * LEPTONS), x1 = this.wx((s.cx + s.w) * LEPTONS), z1 = this.wz((s.cz + s.h) * LEPTONS);
          flattenRect(this.terrain, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 + 0.6, z1 - z0 + 0.6, 2.5);
          this.terrainDirty = true;
          this.vfx.constructionDust(x0, z0, x1, z1, this.h((x0 + x1) / 2, (z0 + z1) / 2));
          if (ev.player === this.me) this.say('Building…');
          break;
        }
        case 'built': {
          const s = W.byId.get(ev.id);
          if (s) this.vfx.buildComplete([this.wx(s.x), this.h(this.wx(s.x), this.wz(s.z)), this.wz(s.z)], (s.w * 3) / 2);
          if (s && ev.player === this.me) this.sfx('gong', null, 0.5);
          if (ev.player === this.me) this.say('Construction complete', 'good');
          break;
        }
        case 'ready':
          if (ev.player === this.me) this.say(`${this.content.get(ev.typeId)?.name} ready — click it to place`, 'good');
          break;
        case 'trained':
          if (ev.player === this.me) {
            this.say('Unit ready', 'good');
            this.sfx('chime', null, 0.35);
          }
          break;
        case 'deployed': {
          if (ev.player === this.me) this.say('Governor’s Yamen established', 'good');
          const s = W.byId.get(ev.id);
          if (s) this.sfx('deploy', [this.wx(s.x), this.h(this.wx(s.x), this.wz(s.z)), this.wz(s.z)], 1);
          break;
        }
        case 'harvest': {
          const u = W.get(ev.id);
          if (u && R() < 0.5) {
            const [x, z, f] = this.pos(u);
            const a = (f / 256) * Math.PI * 2;
            this.vfx.harvestGlint([x + Math.sin(a) * 1.6, this.h(x, z), z + Math.cos(a) * 1.6]);
          }
          break;
        }
        case 'unload': {
          const u = W.get(ev.id);
          if (u) {
            const [x, z] = this.pos(u);
            this.vfx.unloadGlint([x, this.h(x, z) + 1.5, z - 1.5]);
          }
          break;
        }
        case 'message':
          if (ev.player === this.me) this.say(ev.text, ev.tone);
          break;
        case 'underAttack':
          if (ev.player === this.me) {
            this.say('Our base is under attack!', 'warn');
            this.lastAlert = [this.wx(ev.x), this.wz(ev.z)];
          }
          break;
        case 'powerCast': {
          const x = this.wx(ev.x), z = this.wz(ev.z);
          const pw = this.content.rules.powers.find((p) => p.id === ev.power)!;
          this.vfx.wrathGather([x, this.h(x, z), z], (pw.radius / LEPTONS) * 3, ev.delay / TICK_HZ);
          this.sfx('wrath_gather', [x, this.h(x, z), z], 1);
          if (ev.player !== this.me) this.say('Warning: the enemy calls down Heaven’s Wrath!', 'warn');
          break;
        }
        case 'powerStrike': {
          const x = this.wx(ev.x), z = this.wz(ev.z);
          this.vfx.wrathStrike([x, this.h(x, z), z], (ev.radius / LEPTONS) * 3);
          this.sfx('thunder', null, 1);
          break;
        }
        case 'defeat':
          if (ev.player === this.me && !this.demo) this.over = { won: false, t: this.time };
          break;
        case 'victory':
          if (!this.demo && !this.over) this.over = { won: ev.team === this.player().team, t: this.time };
          break;
      }
    }
  }

  private ambientFx(dt: number) {
    this.smokeTimer += dt;
    if (this.smokeTimer < 0.25) return;
    this.smokeTimer = 0;
    for (const e of this.world.entities) {
      if (!e.alive) continue;
      if (e.kind === 'structure' && e.built) {
        const x = this.wx(e.x), z = this.wz(e.z), y = this.h(x, z);
        if (e.typeId === 'azure_jade_refinery') this.vfx.chimneySmoke([x + 3.6, y + 6.4, z - 2.2]);
        else if (e.typeId === 'azure_workshop') this.vfx.chimneySmoke([x + 5.1, y + 7.6, z - 3.6], true);
        else if (e.typeId === 'azure_qi_shrine' && R() < 0.8) this.vfx.qiMote([x, y + 6.6, z]);
        if (e.hp < e.maxHp * 0.5 && R() < 0.6) this.vfx.chimneySmoke([x + (R() - 0.5) * e.w * 2, y + 2, z + (R() - 0.5) * e.h * 2], true);
      } else if (e.kind === 'unit' && e.typeId === 'azure_caravan' && R() < 0.6) {
        const [x, z, f] = this.pos(e);
        const a = (f / 256) * Math.PI * 2;
        this.vfx.chimneySmoke([x - Math.sin(a) * 3, this.h(x, z) + 4.5, z - Math.cos(a) * 3]);
      } else if (e.kind === 'jade' && e.amount > 0 && R() < 0.03) {
        const x = this.wx(e.x), z = this.wz(e.z);
        this.vfx.jadeGlint([x, this.h(x, z), z]);
      }
    }
  }

  // ------------------------------------------------------------------ scene
  private inst(id: string, x: number, z: number, yaw: number, team: number, extra: Partial<RenderInstance> = {}, y?: number, scale = 1): RenderInstance | null {
    const m = this.lib.models.get(id);
    if (!m) return null;
    return { model: m, matrix: m4FromTRS([x, y ?? this.h(x, z), z], quatAxisAngle([0, 1, 0], yaw), [scale, scale, scale]), team, ...extra };
  }

  buildScene(): RenderInstance[] {
    const out: RenderInstance[] = [];
    const W = this.world;
    const push = (i: RenderInstance | null) => i && out.push(i);
    // map objects
    for (const o of this.map.objects) {
      const x = this.terrain.originX + (o.cx + 0.5) * 3 + o.ox, z = this.terrain.originZ + (o.cz + 0.5) * 3 + o.oz;
      push(this.inst(o.kind, x, z, o.rot, 5, { animTime: this.time + o.cx }, undefined, o.scale));
    }
    const buildupTicks = this.content.rules.buildupTicks;
    for (const e of W.entities) {
      if (!e.alive) continue;
      const sel = this.selection.has(e.id) ? 0.55 : this.hoverId === e.id ? 0.3 : 0;
      if (e.kind === 'jade') {
        const r = e.amount / e.maxAmount;
        const x = this.wx(e.x), z = this.wz(e.z);
        push(this.inst(e.large ? 'res_jade_large' : 'res_jade_small', x, z, (e.id * 1.7) % 6.28, 5, {}, undefined, 0.3 + 0.7 * Math.sqrt(r)));
      } else if (e.kind === 'structure') {
        const t = W.stype(e);
        const x = this.wx(e.x), z = this.wz(e.z);
        const a = this.lib.manifest.get(t.model);
        let clip = 1e6;
        if (e.buildup > 0 && a) {
          const frac = 1 - (e.buildup - this.alpha()) / buildupTicks;
          clip = a.bounds.min[1] + (a.bounds.max[1] - a.bounds.min[1] + 0.3) * clamp(frac, 0, 1);
        }
        push(this.inst(t.model, x, z, 0, this.teamOf(e.owner), { highlight: sel, buildClip: clip, animTime: this.time + e.id }));
      } else if (e.kind === 'unit') {
        const t = W.utype(e);
        const [x, z, f] = this.pos(e);
        let anim = 'idle', animTime = this.time + e.id * 0.37;
        const since = (W.tick - e.attackTick) / TICK_HZ + this.alpha() / TICK_HZ;
        const aa = ATTACK_ANIM[e.typeId];
        const mv = this.magic.unitVisual(e);
        if (e.deployTimer > 0) {
          anim = 'deploy';
          animTime = 1.6 - (e.deployTimer - this.alpha()) / TICK_HZ;
        } else if (mv.animFreeze !== undefined) {
          // frozen solid mid-motion
          animTime = mv.animFreeze + e.id * 0.37;
          anim = e.moving ? 'walk' : 'idle';
        } else if (e.castTicks > 0 && t.spell) {
          anim = 'cast';
          animTime = (t.spell.castTicks - e.castTicks + this.alpha()) / TICK_HZ;
        } else if (aa && since >= 0 && since + aa.offset < aa.duration) {
          anim = 'attack';
          animTime = since + aa.offset;
        } else if (e.moving) anim = 'walk';
        else if (t.harvester && e.hState === 'harvest') anim = 'harvest';
        const m = this.lib.models.get(t.model);
        if (m) {
          const yaw = (f / 256) * Math.PI * 2 + mv.spin;
          const q = mv.tilt ? quatMul(quatAxisAngle([0, 1, 0], yaw), quatAxisAngle([1, 0, 0], mv.tilt)) : quatAxisAngle([0, 1, 0], yaw);
          out.push({ model: m, matrix: m4FromTRS([x, this.h(x, z) + mv.lift, z], q, [1, 1, 1]), team: this.teamOf(e.owner), anim, animTime, highlight: sel, status: mv.status });
        }
      }
    }
    // corpses: units topple and sink; structures collapse into the ground
    this.corpses = this.corpses.filter((c) => this.time - c.t0 < (c.kind === 'unit' ? 2.5 : 1.8));
    for (const c of this.corpses) {
      const t = this.content.get(c.typeId);
      if (!t) continue;
      const age = this.time - c.t0;
      if (c.kind === 'unit') {
        const m = this.lib.models.get(t.model);
        if (!m) continue;
        const fall = clamp(age / 0.45, 0, 1);
        const sink = clamp((age - 1.2) / 1.3, 0, 1) * 1.6;
        const vehicle = t.kind === 'unit' && t.category === 'vehicle';
        const q = quatMul(quatAxisAngle([0, 1, 0], c.yaw), quatAxisAngle([1, 0, 0], (vehicle ? -0.25 : -1.45) * fall * fall));
        out.push({ model: m, matrix: m4FromTRS([c.x, this.h(c.x, c.z) - sink, c.z], q, [1, 1, 1]), team: this.teamOf(c.owner), anim: 'idle', animTime: 0 });
      } else {
        const a = this.lib.manifest.get(t.model);
        const top = a ? a.bounds.max[1] : 8;
        push(this.inst(t.model, c.x, c.z, 0, this.teamOf(c.owner), { buildClip: top * (1 - clamp(age / 1.6, 0, 1)), highlight: -1 }, this.h(c.x, c.z) - age * 0.8));
      }
    }
    // placement ghost
    if (this.mode.kind === 'place' && !this.demo) {
      const t = this.content.structures.get(this.mode.typeId)!;
      const [cx, cz] = this.placementCell(t.footprint);
      const ok = W.canPlace(this.me, t.id, cx, cz);
      const x = this.wx((cx + t.footprint[0] / 2) * LEPTONS), z = this.wz((cz + t.footprint[1] / 2) * LEPTONS);
      push(this.inst(t.model, x, z, 0, this.me, { highlight: ok ? 2 : 3, animTime: this.time }));
    }
    return out;
  }

  placementCell(fp: [number, number]): [number, number] {
    const cx = Math.floor(this.lx(this.ground[0]) / LEPTONS - fp[0] / 2 + 0.5);
    const cz = Math.floor(this.lz(this.ground[2]) / LEPTONS - fp[1] / 2 + 0.5);
    return [cx, cz];
  }

  buildOverlay() {
    const o = this.overlay;
    const W = this.world;
    o.begin();
    const teamCol = (owner: number) => TEAM_PALETTE[owner] ?? 0xcccccc;
    // selection rings / brackets
    for (const id of this.selection) {
      const e = W.get(id);
      if (!e) continue;
      if (e.kind === 'unit') {
        const [x, z] = this.pos(e);
        const r = (W.utype(e).radius / LEPTONS) * 3 + 0.35;
        o.ring(x, z, r, 0.08, this.h, teamCol(e.owner), 0.65, { seg: 28 });
      } else if (e.kind === 'structure') {
        const x0 = this.wx(e.cx * LEPTONS), z0 = this.wz(e.cz * LEPTONS), x1 = this.wx((e.cx + e.w) * LEPTONS), z1 = this.wz((e.cz + e.h) * LEPTONS);
        o.rectOutline(x0, z0, x1, z1, this.h, 0.18, teamCol(e.owner), 0.8);
        if (e.owner === this.me && e.rallyX >= 0) {
          const rx = this.wx(e.rallyX), rz = this.wz(e.rallyZ);
          o.line(this.wx(e.x), this.wz(e.z), rx, rz, 0.15, this.h, 0xe8d8a0, 0.6, 1);
          o.ring(rx, rz, 0.6, 0.12, this.h, 0xe8d8a0, 0.8);
        }
        // tower range
        const t = W.stype(e);
        if (t.weapon && e.owner === this.me) o.ring(this.wx(e.x), this.wz(e.z), (t.weapon.range / LEPTONS) * 3 + t.footprint[0] * 1.5, 0.1, this.h, 0xffffff, 0.25, { dash: 24, phase: this.time * 0.1 });
      }
    }
    // order markers
    this.orderMarkers = this.orderMarkers.filter((m) => this.time - m.t < 0.8);
    for (const m of this.orderMarkers) {
      const k = (this.time - m.t) / 0.8;
      o.ring(m.x, m.z, 1.4 * (1 - k * 0.6), 0.14, this.h, m.attack ? 0xff5040 : 0x70ff90, 1 - k, { seg: 24 });
    }
    // placement footprint + build radius hint
    if (this.mode.kind === 'place' && !this.demo) {
      const t = this.content.structures.get(this.mode.typeId)!;
      const [cx, cz] = this.placementCell(t.footprint);
      const inRange = W.inBuildRange(this.me, t.id, cx, cz);
      for (const c of W.placementCells(t.id, cx, cz)) {
        const x0 = this.wx(c.cx * LEPTONS), z0 = this.wz(c.cz * LEPTONS);
        const ok = c.ok && inRange;
        o.rect(x0 + 0.08, z0 + 0.08, x0 + 2.92, z0 + 2.92, this.h, ok ? 0x40ff70 : 0xff3a2a, 0.32, 0.1, 1);
      }
      // harmony preview: highlight friendly structures this building would be adjacent to
      if (t.harmony) {
        for (const s of W.structuresOf(this.me)) {
          if (!t.harmony.adjacentTo.includes(s.typeId)) continue;
          const gap = Math.max(0, Math.max(s.cx - (cx + t.footprint[0]), cx - (s.cx + s.w)), Math.max(s.cz - (cz + t.footprint[1]), cz - (s.cz + s.h)));
          if (gap <= 1) o.rectOutline(this.wx(s.cx * LEPTONS), this.wz(s.cz * LEPTONS), this.wx((s.cx + s.w) * LEPTONS), this.wz((s.cz + s.h) * LEPTONS), this.h, 0.2, 0xffd060, 0.8);
        }
      }
    }
    // power targeting
    if (this.mode.kind === 'power') {
      const pw = this.content.rules.powers.find((p) => p.id === (this.mode as any).power)!;
      const r = (pw.radius / LEPTONS) * 3;
      o.disc(this.ground[0], this.ground[2], r, this.h, 0x6080ff, 0.18);
      o.ring(this.ground[0], this.ground[2], r, 0.2, this.h, 0x9fb4ff, 0.9, { dash: 16, phase: this.time });
    }
    // signature-spell targeting: ring for area spells, lane for line spells
    if (this.mode.kind === 'cast') {
      const casters = this.readyCasters();
      const sp = casters[0] ? W.utype(casters[0]).spell : undefined;
      if (sp) {
        const [gx, gz] = [this.ground[0], this.ground[2]];
        const col = { wildfire: 0xff7a30, glacier: 0x9fdcff, surge: 0x40c8d0, whirlwind: 0xe8f0ff }[sp.kind];
        if (sp.kind === 'glacier' || sp.kind === 'surge') {
          const [cx, cz] = this.pos(casters[0]);
          const d = Math.hypot(gx - cx, gz - cz) || 1;
          const L = (sp.length / LEPTONS) * 3;
          o.line(cx, cz, cx + ((gx - cx) / d) * L, cz + ((gz - cz) / d) * L, sp.kind === 'surge' ? (sp.width / LEPTONS) * 3 : 2, this.h, col, 0.25);
        } else {
          const r = (sp.radius / LEPTONS) * 3;
          o.disc(gx, gz, r, this.h, col, 0.16);
          o.ring(gx, gz, r, 0.18, this.h, col, 0.9, { dash: 14, phase: this.time });
        }
      }
    }
    // drag box drawn in the HUD; attack-move cursor ring
    if (this.mode.kind === 'amove') o.ring(this.ground[0], this.ground[2], 1.0, 0.14, this.h, 0xff5040, 0.8, { dash: 8, phase: this.time * 2 });
    // in-flight projectiles (trail particles are skipped while effects are frozen)
    if (!this.freezeFx) this.drawProjectiles();
  }

  private drawProjectiles() {
    const W = this.world;
    for (const [id, pv] of this.projs) {
      const e = W.byId.get(id);
      if (!e || !e.alive) {
        this.projs.delete(id);
        continue;
      }
      const [x, z] = this.pos(e);
      const traveled = Math.hypot(x - pv.sx, z - pv.sz);
      const t = pv.dist > 0.1 ? clamp(traveled / pv.dist, 0, 1) : 1;
      const groundY = this.h(x, z) + 1.0;
      const arc = pv.kind === 'arrow' ? pv.dist * 0.12 : pv.kind === 'talisman' || pv.kind === 'fire' ? pv.dist * 0.07 : pv.kind === 'frost' ? pv.dist * 0.02 : 0;
      const y = pv.sy + (groundY - pv.sy) * t + Math.sin(t * Math.PI) * arc;
      const p: V3 = [x, y, z];
      const vel: V3 = [p[0] - pv.last[0], p[1] - pv.last[1], p[2] - pv.last[2]];
      pv.last = p;
      if (pv.kind === 'talisman') this.vfx.talismanTrail(p, vel);
      else if (pv.kind !== 'arrow') this.magic.projectile(id, p, vel, t);
      else {
        const l = Math.hypot(vel[0], vel[1], vel[2]) || 1;
        this.particles.spawn({ pos: p, vel: [(vel[0] / l) * 20, (vel[1] / l) * 20, (vel[2] / l) * 20], life: 0.03, size: [0.5, 0.5], color: [1, 1, 1, 1], cell: 11, stretch: 0, rot: 0, intensity: [1.4, 1.4] });
        this.particles.spawn({ pos: p, vel: [(vel[0] / l) * 20, (vel[1] / l) * 20, (vel[2] / l) * 20], life: 0.03, size: [0.1, 0.1], color: [1, 0.95, 0.85, 0.5], cell: 1, additive: true, stretch: 0.06, intensity: [1.5, 1.5] });
      }
    }
  }

  // ------------------------------------------------------------------ picking & commands
  project(p: V3): [number, number, number] {
    const vp = m4Mul(this.camera.proj, this.camera.view);
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    const dw = this.renderer.device.backbufferWidth, dh = this.renderer.device.backbufferHeight;
    return [((x / w) * 0.5 + 0.5) * dw, (1 - ((y / w) * 0.5 + 0.5)) * dh, w];
  }
  /** Where the pointer ray meets the horizontal plane at height y, for the camera as it is now. */
  private planeHit(px: number, py: number, y: number): V3 | null {
    const d = this.renderer.device;
    const cam = this.cam.build(d.backbufferWidth / d.backbufferHeight, d.caps.clip);
    const r = screenRay(cam, px, py, d.backbufferWidth, d.backbufferHeight);
    if (Math.abs(r.d[1]) < 1e-4) return null;
    const t = (y - r.o[1]) / r.d[1];
    return t > 0 ? [r.o[0] + r.d[0] * t, y, r.o[2] + r.d[2] * t] : null;
  }
  groundAt(px: number, py: number): V3 {
    const d = this.renderer.device;
    const ray = screenRay(this.camera, px, py, d.backbufferWidth, d.backbufferHeight);
    let y = 0, t = 0;
    for (let i = 0; i < 5; i++) {
      t = (y - ray.o[1]) / ray.d[1];
      const x = ray.o[0] + ray.d[0] * t, z = ray.o[2] + ray.d[2] * t;
      y = this.h(x, z);
    }
    return [ray.o[0] + ray.d[0] * t, y, ray.o[2] + ray.d[2] * t];
  }
  /** Entity under the cursor (units by screen distance, structures by footprint). */
  pick(px: number, py: number, scale: number): Entity | undefined {
    const W = this.world;
    let best: Entity | undefined, bd = Infinity;
    for (const e of W.entities) {
      if (!e.alive || e.kind !== 'unit') continue;
      const [x, z] = this.pos(e);
      const r = W.utype(e).category === 'vehicle' ? 30 : 18;
      const s = this.project([x, this.h(x, z) + 0.9, z]);
      const d = Math.hypot(s[0] - px, s[1] - py);
      if (d < r * scale && d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) return best;
    const g = this.groundAt(px, py);
    const gx = this.lx(g[0]), gz = this.lz(g[2]);
    for (const e of W.entities) {
      if (!e.alive) continue;
      if (e.kind === 'structure' && gx >= e.cx * LEPTONS && gx < (e.cx + e.w) * LEPTONS && gz >= e.cz * LEPTONS && gz < (e.cz + e.h) * LEPTONS) return e;
      if (e.kind === 'jade' && Math.abs(gx - e.x) < 160 && Math.abs(gz - e.z) < 160) return e;
    }
    return undefined;
  }

  /** Selected spell-casters whose signature spell is off cooldown. */
  readyCasters(): Entity[] {
    return this.selectedUnits().filter((u) => this.world.utype(u).spell && u.spellCd === 0 && u.frozenTicks === 0 && u.liftTicks === 0);
  }
  beginCast() {
    const casters = this.selectedUnits().filter((u) => this.world.utype(u).spell);
    if (!casters.length) return;
    if (!this.readyCasters().length) {
      const cd = Math.min(...casters.map((u) => u.spellCd)) / TICK_HZ;
      this.say(`Not ready — ${Math.ceil(cd)} s`, 'warn');
      return;
    }
    this.mode = { kind: 'cast' };
  }
  /** One ready caster per school casts at the point (a second click casts the next one). */
  castAt(x: number, z: number) {
    const bySchool = new Map<string, Entity>();
    for (const u of this.readyCasters()) {
      const k = this.world.utype(u).spell!.kind;
      const cur = bySchool.get(k);
      const [ux, uz] = this.pos(u);
      if (!cur || Math.hypot(ux - x, uz - z) < Math.hypot(this.pos(cur)[0] - x, this.pos(cur)[1] - z)) bySchool.set(k, u);
    }
    const ids = [...bySchool.values()].map((u) => u.id);
    if (ids.length) {
      this.issue({ t: 'cast', ids, x: this.lx(x), z: this.lz(z) });
      this.orderMarkers.push({ x, z, t: this.time, attack: true });
    }
  }
  selectedUnits(): Entity[] {
    return [...this.selection].map((id) => this.world.get(id)).filter((e): e is Entity => !!e && e.kind === 'unit' && e.owner === this.me);
  }

  /** Right-click / context command at a screen point. */
  command(px: number, py: number, scale: number, forceAttackMove = false) {
    if (this.demo) return;
    const W = this.world;
    const g = this.groundAt(px, py);
    const target = this.pick(px, py, scale);
    const units = this.selectedUnits();
    const sel = [...this.selection].map((id) => W.get(id)).filter((e): e is Entity => !!e);
    // factory selected → rally point
    if (!units.length && sel.length === 1 && sel[0].kind === 'structure' && sel[0].owner === this.me) {
      this.issue({ t: 'rally', id: sel[0].id, x: this.lx(g[0]), z: this.lz(g[2]) });
      this.orderMarkers.push({ x: g[0], z: g[2], t: this.time, attack: false });
      return;
    }
    if (!units.length) return;
    const ids = units.map((u) => u.id);
    if (target && (target.kind === 'unit' || target.kind === 'structure') && W.isEnemy(this.me, target.owner)) {
      this.issue({ t: 'attack', ids, target: target.id });
      this.orderMarkers.push({ x: this.wx(target.x), z: this.wz(target.z), t: this.time, attack: true });
      return;
    }
    if (target && target.kind === 'jade') {
      const hv = units.filter((u) => W.utype(u).harvester).map((u) => u.id);
      if (hv.length) {
        this.issue({ t: 'harvest', ids: hv, node: target.id });
        this.orderMarkers.push({ x: this.wx(target.x), z: this.wz(target.z), t: this.time, attack: false });
        const rest = ids.filter((id) => !hv.includes(id));
        if (!rest.length) return;
        this.issue({ t: 'move', ids: rest, x: this.lx(g[0]), z: this.lz(g[2]) });
        return;
      }
    }
    this.issue({ t: 'move', ids, x: this.lx(g[0]), z: this.lz(g[2]), attackMove: forceAttackMove });
    this.orderMarkers.push({ x: g[0], z: g[2], t: this.time, attack: forceAttackMove });
  }

  // ------------------------------------------------------------------ input
  handleInput(dt: number, overUI: boolean, scale: number) {
    const input = this.platform.input;
    const p = input.pointer;
    const d = this.renderer.device;
    const W = this.world;
    this.ground = this.groundAt(p.x, p.y);

    // camera: keys, edge scroll, middle-drag, wheel
    const sp = this.cam.distance * 1.1 * dt;
    const k = input.keys;
    let mx = 0, mz = 0;
    if (k.has('ArrowLeft')) mx -= 1;
    if (k.has('ArrowRight')) mx += 1;
    if (k.has('ArrowUp')) mz += 1;
    if (k.has('ArrowDown')) mz -= 1;
    const edge = 6 * scale;
    if (p.inside && !this.drag?.active && !this.grab && !p.touch) {
      if (p.x < edge) mx -= 1;
      if (p.x > d.backbufferWidth - edge) mx += 1;
      if (p.y < edge) mz += 1;
      if (p.y > d.backbufferHeight - edge) mz -= 1;
    }
    if (mx || mz) this.cam.pan(mx * sp, mz * sp);
    // grab-pan (middle drag; one-finger drag on touch): the ground point under the pointer when
    // the drag began stays under the pointer, so the map follows it on both axes
    if (p.buttons & 4 && (p.touches ?? 0) === this.grabTouches) {
      // (a finger only starts panning after a small slop, so grab where it went down)
      if (!this.grab) this.grab = this.groundAt(p.downX ?? p.x, p.downY ?? p.y);
      const hit = this.planeHit(p.x, p.y, this.grab[1]);
      if (hit) this.cam.target = [this.cam.target[0] + this.grab[0] - hit[0], 0, this.cam.target[2] + this.grab[2] - hit[2]];
    } else this.grab = null;
    this.grabTouches = p.touches ?? 0;
    if (p.wheel && !overUI) this.cam.zoom(p.wheel);
    const half = (this.map.cells * 3) / 2 - 6;
    this.cam.target = [clamp(this.cam.target[0], -half, half), 0, clamp(this.cam.target[2], -half + 10, half + 14)];

    // hotkeys
    const pr = input.pressed;
    if (pr.has('Escape')) {
      if (this.mode.kind !== 'normal') this.mode = { kind: 'normal' };
      else this.selection.clear();
    }
    if (pr.has('KeyP')) this.paused = !this.paused;
    if (pr.has('KeyM')) this.say(setAudioMode(this.platform.audio, audioPrefs.mode === 2 ? 0 : 2));
    if (pr.has('KeyN')) this.say(setAudioMode(this.platform.audio, audioPrefs.mode === 0 ? 1 : 0));
    if (pr.has('KeyS') && !this.demo) this.issue({ t: 'stop', ids: this.selectedUnits().map((u) => u.id) });
    if (pr.has('KeyD') && !this.demo) for (const u of this.selectedUnits()) if (W.utype(u).deploysInto) this.issue({ t: 'deploy', id: u.id });
    if (pr.has('KeyA') && this.selectedUnits().length) this.mode = { kind: 'amove' };
    if (pr.has('KeyQ') && !this.demo) this.beginCast();
    if (pr.has('KeyH') || pr.has('Space')) this.jumpHome(pr.has('Space'));
    if (pr.has('KeyX')) this.mode = this.mode.kind === 'sell' ? { kind: 'normal' } : { kind: 'sell' };
    for (let n = 1; n <= 9; n++) {
      if (!pr.has(`Digit${n}`)) continue;
      if (k.has('ControlLeft') || k.has('ControlRight') || k.has('MetaLeft')) {
        this.groups.set(n, this.selectedUnits().map((u) => u.id));
        this.say(`Group ${n} assigned`);
      } else if (this.groups.has(n)) {
        this.selection = new Set(this.groups.get(n)!.filter((id) => W.get(id)));
      }
    }

    // hover + contextual cursor
    this.hoverId = 0;
    let cursor: Parameters<Platform['setCursor']>[0] = 'default';
    if (!overUI && p.inside) {
      const h = this.pick(p.x, p.y, scale);
      if (h && (h.kind === 'unit' || h.kind === 'structure')) this.hoverId = h.id;
      const units = this.selectedUnits();
      if (this.mode.kind === 'place') cursor = 'place';
      else if (this.mode.kind === 'power' || this.mode.kind === 'amove' || this.mode.kind === 'cast') cursor = 'power';
      else if (this.mode.kind === 'sell') cursor = 'sell';
      else if (h && (h.kind === 'unit' || h.kind === 'structure') && units.length && W.isEnemy(this.me, h.owner)) cursor = 'attack';
      else if (h && h.kind === 'jade' && units.some((u) => W.utype(u).harvester)) cursor = 'harvest';
      else if (h && (h.kind === 'unit' || h.kind === 'structure') && h.owner === this.me) cursor = 'select';
      else if (units.length) cursor = 'move';
    }
    this.platform.setCursor(cursor);

    // pointer
    if (overUI) {
      if (input.released & 1) this.drag = null;
      return;
    }
    if (input.clicked & 1) {
      if (this.mode.kind === 'place') {
        const t = this.content.structures.get(this.mode.typeId)!;
        const [cx, cz] = this.placementCell(t.footprint);
        if (W.canPlace(this.me, t.id, cx, cz)) {
          this.issue({ t: 'place', typeId: t.id, cx, cz });
          this.mode = { kind: 'normal' };
        } else this.say('Cannot build there — stay close to your base, on clear ground', 'warn');
        return;
      }
      if (this.mode.kind === 'power') {
        this.issue({ t: 'power', power: this.mode.power, x: this.lx(this.ground[0]), z: this.lz(this.ground[2]) });
        this.mode = { kind: 'normal' };
        return;
      }
      if (this.mode.kind === 'amove') {
        this.command(p.x, p.y, scale, true);
        this.mode = { kind: 'normal' };
        return;
      }
      if (this.mode.kind === 'cast') {
        this.castAt(this.ground[0], this.ground[2]);
        this.mode = { kind: 'normal' };
        return;
      }
      if (this.mode.kind === 'sell') {
        const t = this.pick(p.x, p.y, scale);
        if (t && t.kind === 'structure' && t.owner === this.me) this.issue({ t: 'sell', id: t.id });
        return;
      }
      this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, active: false };
    }
    if (this.drag && p.buttons & 1) {
      this.drag.x1 = p.x;
      this.drag.y1 = p.y;
      if (Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) > 6 * scale) this.drag.active = true;
    }
    if (input.released & 1 && this.drag) {
      const shift = k.has('ShiftLeft') || k.has('ShiftRight');
      if (this.drag.active) {
        const x0 = Math.min(this.drag.x0, this.drag.x1), x1 = Math.max(this.drag.x0, this.drag.x1);
        const y0 = Math.min(this.drag.y0, this.drag.y1), y1 = Math.max(this.drag.y0, this.drag.y1);
        if (!shift) this.selection.clear();
        for (const e of W.entities) {
          if (!e.alive || e.kind !== 'unit' || e.owner !== this.me) continue;
          const [x, z] = this.pos(e);
          const s = this.project([x, this.h(x, z) + 0.8, z]);
          if (s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1) this.selection.add(e.id);
        }
      } else {
        const t = this.pick(p.x, p.y, scale);
        const mineTapped = !!t && (t.kind === 'unit' || t.kind === 'structure') && t.owner === this.me;
        if (p.touch && !shift && this.selectedUnits().length && !mineTapped) {
          // touch has no right button: tapping ground, jade or an enemy commands the selection
          this.command(p.x, p.y, scale, false);
        } else if (t && (t.kind === 'unit' || t.kind === 'structure')) {
          // double-click: all of that type on screen
          if (this.lastClick.id === t.id && this.time - this.lastClick.t < 0.35 && t.owner === this.me) {
            for (const e of W.entities) {
              if (!e.alive || e.typeId !== t.typeId || e.owner !== this.me || e.kind !== 'unit') continue;
              const [x, z] = this.pos(e);
              const s = this.project([x, this.h(x, z), z]);
              if (s[0] > 0 && s[0] < d.backbufferWidth && s[1] > 0 && s[1] < d.backbufferHeight) this.selection.add(e.id);
            }
          } else {
            if (!shift) this.selection.clear();
            if (shift && this.selection.has(t.id)) this.selection.delete(t.id);
            else this.selection.add(t.id);
            // clicking a selected caravan again deploys it (C&C)
            if (!shift && t.owner === this.me && t.kind === 'unit' && W.utype(t).deploysInto && this.lastClick.id === t.id && this.time - this.lastClick.t < 1.5) {
              this.issue({ t: 'deploy', id: t.id });
            }
          }
          this.lastClick = { t: this.time, id: t.id };
        } else if (!shift) {
          this.selection.clear();
        }
      }
      this.drag = null;
    }
    if (input.clicked & 2) {
      if (this.mode.kind !== 'normal') this.mode = { kind: 'normal' };
      else this.command(p.x, p.y, scale, false);
    }
  }
  get dragBox() {
    return this.drag?.active ? this.drag : null;
  }

  jumpHome(toAlert = false) {
    if (toAlert && this.lastAlert) {
      this.cam.target = [this.lastAlert[0], 0, this.lastAlert[1] - 4];
      return;
    }
    const y = this.world.structuresOf(this.me).find((s) => s.typeId === 'azure_command_hall') ?? this.world.unitsOf(this.me)[0];
    if (y) this.cam.target = [this.wx(y.x), 0, this.wz(y.z) - 4];
  }

  // ------------------------------------------------------------------ frame
  private updateCamera() {
    const d = this.renderer.device;
    this.camera = this.cam.build(d.backbufferWidth / d.backbufferHeight, d.caps.clip, clamp(this.cam.distance * 0.9, 30, 90));
  }

  render(scale: number) {
    const d = this.renderer.device;
    this.updateCamera();
    this.buildOverlay();
    const instances = this.buildScene();
    this.particles.build(this.camera.view);
    this.fxMeshes.instances = this.vfx.meshInstances();
    this.renderer.render({
      camera: this.camera,
      instances,
      time: this.time,
      terrain: this.terrainGpu,
      lighting: DEFAULT_LIGHTING,
      teamColors: [...TEAM_PALETTE, 0xd9d2c0, TEAM_COLORS.ivory, 0x30b0c0, 0xe06a2e],
      overlay: this.overlay,
      particles: this.particles,
      fxMeshes: this.fxMeshes,
      groundFx: this.groundFx.tex,
      lights: this.vfx.sceneLights(this.time),
      gusts: this.vfx.sceneGusts(),
      flash: this.vfx.flash * this.vfx.flash * 0.28,
      grid: this.mode.kind === 'place' ? { cell: 3, opacity: 0.09 } : undefined,
    });
    this.ui.begin(d.backbufferWidth, d.backbufferHeight);
    if (!this.demo) this.hud.draw(scale);
    this.drawOverlay?.(this.ui, scale);
    this.ui.flush();
  }
  /** extra UI drawn on top (title screen, loading) */
  drawOverlay?: (ui: UIRenderer, scale: number) => void;

  /** One frame: input → sim → present. */
  frame(dt: number, scale: number) {
    if (this.gallery) {
      // magic gallery: glide to the current stage at the normal RTS zoom (wheel zooms)
      this.gallery.update(dt);
      const f = this.gallery.focus, k = 1 - Math.exp(-dt * 2.5);
      this.cam.target = [this.cam.target[0] + (f[0] - this.cam.target[0]) * k, 0, this.cam.target[2] + (f[1] - 4 - this.cam.target[2]) * k];
      const wheel = this.platform.input.pointer.wheel;
      if (wheel) this.cam.zoom(wheel);
      this.update(dt);
      this.render(scale);
      return;
    }
    if (this.demo) {
      // attract mode: drift across the battlefield
      // glide back and forth along the diagonal between the two bases
      const t = 0.5 + 0.42 * Math.sin(this.time * 0.045);
      const a = this.map.starts[0], b = this.map.starts[1];
      this.cam.target = [this.wx((a.cx + (b.cx - a.cx) * t) * LEPTONS), 0, this.wz((a.cz + (b.cz - a.cz) * t) * LEPTONS) - 6];
      this.cam.distance = 64;
      this.cam.pitch = 50 * DEG;
      this.update(dt);
      this.render(scale);
      return;
    }
    this.updateCamera();
    const overUI = this.hud.layout(scale);
    this.handleInput(dt, overUI, scale);
    this.update(dt);
    // drop dead / sold entities from the selection and control groups before anything draws
    for (const id of this.selection) if (!this.world.get(id)) this.selection.delete(id);
    this.render(scale);
  }
}

const R = Math.random;
export type { M4, GpuModel };
void TAB_ORDER;
