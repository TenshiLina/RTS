// The deterministic simulation. Integer state only; advanced in fixed 15 Hz ticks.
// Player input arrives as Commands (queued, applied at the start of the next tick) — the same
// stream a lockstep network layer or a replay file carries. The client reads state + SimEvents.

import type { Content, UnitType, StructureType, Tab, WeaponType, EntityType, PowerType } from './content';
import { LEPTONS, TICK_HZ, isqrt, dist2, facingOf, turnToward, SimRng, facingDelta } from './intmath';
import { Pathfinder } from './pathfind';
import { Magic } from './magic';
import { CELL, BLOCKS_MOVE } from '../world/skirmishMap';

export interface MapInput {
  cells: number;
  flags: Uint8Array;
  starts: { cx: number; cz: number }[];
  jade: { cx: number; cz: number; large: boolean }[];
}

export type Order =
  | { type: 'idle' }
  | { type: 'move'; x: number; z: number; attackMove: boolean }
  | { type: 'attack'; target: number }
  | { type: 'harvest'; node: number }
  | { type: 'deploy' }
  | { type: 'cast'; x: number; z: number };

export type EntityKind = 'unit' | 'structure' | 'jade' | 'projectile';
export type HarvestState = 'seek' | 'toNode' | 'harvest' | 'toDock' | 'unload' | 'wait';

export class Entity {
  alive = true;
  x = 0;
  z = 0;
  facing = 0;
  hp = 0;
  maxHp = 0;
  // --- units
  order: Order = { type: 'idle' };
  path: number[] = []; // packed x,z leptons
  pathI = 0;
  goalX = 0;
  goalZ = 0;
  moving = false;
  guardX = 0;
  guardZ = 0;
  targetId = 0;
  cooldown = 0;
  windup = 0;
  /** client-facing: tick the last attack started (drives attack animation) */
  attackTick = -1000;
  stuck = 0;
  stuckCheckX = 0;
  stuckCheckZ = 0;
  repathTick = 0;
  deployTimer = 0;
  // elemental status + casting (see magic.ts)
  burnTicks = 0;
  burnDps = 0;
  burnOwner = -1;
  chillTicks = 0;
  chillPct = 0;
  frozenTicks = 0;
  wetTicks = 0;
  liftTicks = 0;
  liftZone = 0;
  kbX = 0;
  kbZ = 0;
  kbTicks = 0;
  spellCd = 0;
  castTicks = 0;
  castX = 0;
  castZ = 0;
  // harvester
  cargo = 0;
  hState: HarvestState = 'seek';
  nodeId = 0;
  dockId = 0;
  // --- structures
  cx = 0;
  cz = 0;
  w = 0;
  h = 0;
  buildup = 0;
  lastDamageTick = -10000;
  rallyX = -1;
  rallyZ = -1;
  // --- jade
  amount = 0;
  maxAmount = 0;
  large = false;
  // --- projectile
  srcId = 0;
  tgtX = 0;
  tgtZ = 0;
  weapon: WeaponType | null = null;
  constructor(public id: number, public kind: EntityKind, public owner: number, public typeId: string) {}
  get built() {
    return this.buildup <= 0;
  }
}

export interface QueueItem {
  typeId: string;
  progress: number; // 0 .. buildTicks*100
  paid: number;
}
export interface Queue {
  items: QueueItem[];
  /** structure finished and waiting to be placed */
  ready: string | null;
}

export interface PlayerState {
  id: number;
  team: number;
  name: string;
  ai: boolean;
  jade: number;
  mandateMilli: number;
  mandateAcc: number;
  harmony: number; // percent
  qiProduced: number;
  qiUsed: number;
  lowPower: boolean;
  queues: Record<Tab, Queue>;
  powerCharge: Record<string, number>;
  defeated: boolean;
  lastAlertTick: number;
  startCx: number;
  startCz: number;
  stats: { built: number; trained: number; lost: number; kills: number; harvested: number };
}

export type Command =
  | { t: 'move'; ids: number[]; x: number; z: number; attackMove?: boolean }
  | { t: 'attack'; ids: number[]; target: number }
  | { t: 'stop'; ids: number[] }
  | { t: 'deploy'; id: number }
  | { t: 'harvest'; ids: number[]; node: number }
  | { t: 'queue'; typeId: string }
  | { t: 'cancel'; typeId: string }
  | { t: 'place'; typeId: string; cx: number; cz: number }
  | { t: 'sell'; id: number }
  | { t: 'power'; power: string; x: number; z: number }
  | { t: 'rally'; id: number; x: number; z: number }
  | { t: 'cast'; ids: number[]; x: number; z: number };

export type SimEvent =
  | { e: 'spawn'; id: number }
  | { e: 'placed'; id: number; player: number }
  | { e: 'built'; id: number; player: number; typeId: string }
  | { e: 'ready'; player: number; typeId: string }
  | { e: 'trained'; player: number; id: number; typeId: string }
  | { e: 'attack'; id: number; target: number }
  | { e: 'fire'; id: number; proj: number; kind: string; x: number; z: number; tx: number; tz: number }
  | { e: 'melee'; id: number; target: number; x: number; z: number }
  | { e: 'impact'; kind: string; x: number; z: number; splash: number; owner: number; proj: number; target: number }
  | { e: 'damage'; id: number; amount: number }
  | { e: 'death'; id: number; typeId: string; kind: EntityKind; x: number; z: number; owner: number; killer: number }
  | { e: 'deploying'; id: number }
  | { e: 'deployed'; id: number; player: number }
  | { e: 'harvest'; id: number; node: number }
  | { e: 'unload'; id: number; amount: number }
  | { e: 'message'; player: number; text: string; tone: 'info' | 'warn' | 'good' }
  | { e: 'underAttack'; player: number; x: number; z: number }
  | { e: 'powerCast'; player: number; power: string; x: number; z: number; delay: number }
  | { e: 'powerStrike'; player: number; power: string; x: number; z: number; radius: number }
  | { e: 'sold'; id: number; player: number }
  | { e: 'defeat'; player: number }
  | { e: 'victory'; team: number }
  // elemental magic
  | { e: 'castStart'; id: number; spell: string; x: number; z: number; ticks: number }
  | { e: 'spell'; id: number; spell: string; zone: number; x: number; z: number; tx: number; tz: number }
  | { e: 'spike'; zone: number; i: number; x: number; z: number }
  | { e: 'freeze'; id: number }
  | { e: 'unfreeze'; id: number }
  | { e: 'thaw'; id: number }
  | { e: 'douse'; id: number }
  | { e: 'lift'; id: number; zone: number }
  | { e: 'drop'; id: number }
  | { e: 'extinguish'; zone: number; x: number; z: number; r: number }
  | { e: 'fireWhirl'; zone: number }
  | { e: 'zoneEnd'; zone: number }
  | { e: 'shock'; id: number; x: number; z: number };

export const TAB_ORDER: Tab[] = ['structures', 'defense', 'infantry', 'machines'];
const cellOf = (l: number) => Math.floor(l / LEPTONS);
const center = (c: number) => c * LEPTONS + (LEPTONS >> 1);

export interface PlayerSetup {
  name: string;
  team: number;
  ai: boolean;
}

export class World {
  tick = 0;
  entities: Entity[] = [];
  byId = new Map<number, Entity>();
  nextId = 1;
  players: PlayerState[] = [];
  events: SimEvent[] = [];
  occupancy: Int32Array;
  pf: Pathfinder;
  rng: SimRng;
  winner = -1;
  private commands: { player: number; cmd: Command }[] = [];
  private strikes: { player: number; power: PowerType; x: number; z: number; at: number }[] = [];
  /** optional per-player controllers (skirmish AI) — run inside the tick, deterministic */
  controllers: ((w: World, p: PlayerState) => void)[] = [];
  magic = new Magic(this);

  constructor(public content: Content, public map: MapInput, setups: PlayerSetup[], seed = 1) {
    const n = map.cells * map.cells;
    this.occupancy = new Int32Array(n);
    this.pf = new Pathfinder(map.cells, map.cells);
    this.rng = new SimRng(seed);
    for (const j of map.jade) {
      const e = this.spawnRaw('jade', -1, j.large ? 'res_jade_large' : 'res_jade_small', center(j.cx), center(j.cz));
      e.large = j.large;
      e.maxAmount = e.amount = j.large ? content.rules.jadeLarge : content.rules.jadeSmall;
      e.cx = j.cx;
      e.cz = j.cz;
    }
    setups.forEach((s, i) => {
      const st = map.starts[i % map.starts.length];
      const p: PlayerState = {
        id: i, team: s.team, name: s.name, ai: s.ai,
        jade: content.rules.startJade, mandateMilli: 0, mandateAcc: 0, harmony: 100,
        qiProduced: 0, qiUsed: 0, lowPower: false,
        queues: { structures: { items: [], ready: null }, defense: { items: [], ready: null }, infantry: { items: [], ready: null }, machines: { items: [], ready: null } },
        powerCharge: Object.fromEntries(content.rules.powers.map((pw) => [pw.id, pw.chargeTicks])),
        defeated: false, lastAlertTick: -10000, startCx: st.cx, startCz: st.cz,
        stats: { built: 0, trained: 0, lost: 0, kills: 0, harvested: 0 },
      };
      this.players.push(p);
      // starting force around the start cell
      content.rules.startUnits.forEach((uid, k) => {
        const off = k === 0 ? [0, 0] : [((k % 3) - 1) * 2 + 0.5, 2.5 + Math.floor((k - 1) / 3) * 1.2];
        const flip = st.cz > map.cells / 2 ? -1 : 1; // escort stands between the caravan and the map centre
        const ux = st.cx * LEPTONS + LEPTONS / 2 + Math.round(off[0] * LEPTONS) * flip;
        const uz = st.cz * LEPTONS + LEPTONS / 2 + Math.round(off[1] * LEPTONS) * flip;
        const u = this.spawnUnit(uid, i, ux, uz);
        u.facing = flip > 0 ? 0 : 128;
      });
    });
  }

  // ------------------------------------------------------------------ queries
  get(id: number) {
    const e = this.byId.get(id);
    return e && e.alive ? e : undefined;
  }
  type(e: Entity): EntityType {
    return this.content.get(e.typeId)!;
  }
  utype(e: Entity) {
    return this.content.units.get(e.typeId)!;
  }
  stype(e: Entity) {
    return this.content.structures.get(e.typeId)!;
  }
  isEnemy(a: number, b: number) {
    return a >= 0 && b >= 0 && this.players[a].team !== this.players[b].team;
  }
  cellIndex(cx: number, cz: number) {
    return cz * this.map.cells + cx;
  }
  inBounds(cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < this.map.cells && cz < this.map.cells;
  }
  passable = (i: number) => (this.map.flags[i] & BLOCKS_MOVE) === 0 && this.occupancy[i] === 0;
  ownedCount(player: number, typeId: string, builtOnly = true) {
    let n = 0;
    for (const e of this.entities) if (e.alive && e.owner === player && e.typeId === typeId && (!builtOnly || e.built)) n++;
    return n;
  }
  structuresOf(player: number) {
    return this.entities.filter((e) => e.alive && e.kind === 'structure' && e.owner === player);
  }
  unitsOf(player: number) {
    return this.entities.filter((e) => e.alive && e.kind === 'unit' && e.owner === player);
  }
  prereqsMet(player: number, t: EntityType) {
    return t.prereqs.every((p) => this.ownedCount(player, p) > 0);
  }
  /** Can the player start building this right now (prereqs + a producer)? */
  canBuild(player: number, typeId: string) {
    const t = this.content.get(typeId);
    if (!t || !this.prereqsMet(player, t)) return false;
    if (t.kind === 'structure') return t.role !== 'construction_yard' && this.ownedCount(player, 'azure_command_hall') > 0;
    return t.producedAt.some((f) => this.ownedCount(player, f) > 0);
  }
  mandate(player: number) {
    return Math.floor(this.players[player].mandateMilli / 1000);
  }
  structureCenter(s: Entity): [number, number] {
    return [s.cx * LEPTONS + (s.w * LEPTONS) / 2, s.cz * LEPTONS + (s.h * LEPTONS) / 2];
  }
  /** Squared distance from a point to an entity's body (footprint for structures). */
  distTo2(x: number, z: number, t: Entity) {
    if (t.kind === 'structure') {
      const x0 = t.cx * LEPTONS, z0 = t.cz * LEPTONS, x1 = x0 + t.w * LEPTONS, z1 = z0 + t.h * LEPTONS;
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const dz = z < z0 ? z0 - z : z > z1 ? z - z1 : 0;
      return dx * dx + dz * dz;
    }
    const r = t.kind === 'unit' ? this.utype(t).radius : 0;
    const d = isqrt(dist2(x, z, t.x, t.z));
    const e = Math.max(0, d - r);
    return e * e;
  }

  // ------------------------------------------------------------------ spawning
  private spawnRaw(kind: EntityKind, owner: number, typeId: string, x: number, z: number): Entity {
    const e = new Entity(this.nextId++, kind, owner, typeId);
    e.x = x;
    e.z = z;
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }
  spawnUnit(typeId: string, owner: number, x: number, z: number): Entity {
    const t = this.content.units.get(typeId)!;
    const e = this.spawnRaw('unit', owner, typeId, x, z);
    e.hp = e.maxHp = t.hp;
    e.guardX = x;
    e.guardZ = z;
    if (t.harvester) e.order = { type: 'harvest', node: 0 };
    this.events.push({ e: 'spawn', id: e.id });
    return e;
  }
  private spawnStructure(typeId: string, owner: number, cx: number, cz: number, buildup = true): Entity {
    const t = this.content.structures.get(typeId)!;
    const e = this.spawnRaw('structure', owner, typeId, 0, 0);
    e.cx = cx;
    e.cz = cz;
    e.w = t.footprint[0];
    e.h = t.footprint[1];
    [e.x, e.z] = this.structureCenter(e);
    e.hp = e.maxHp = t.hp;
    e.buildup = buildup ? this.content.rules.buildupTicks : 0;
    for (let z = cz; z < cz + e.h; z++) for (let x = cx; x < cx + e.w; x++) this.occupancy[this.cellIndex(x, z)] = e.id;
    // push units out of the new footprint
    for (const u of this.entities) {
      if (!u.alive || u.kind !== 'unit') continue;
      const ucx = cellOf(u.x), ucz = cellOf(u.z);
      if (ucx >= cx && ucx < cx + e.w && ucz >= cz && ucz < cz + e.h) this.evict(u);
    }
    this.events.push({ e: 'placed', id: e.id, player: owner });
    return e;
  }
  private evict(u: Entity) {
    const c = this.pf.nearest(this.cellIndex(cellOf(u.x), cellOf(u.z)), this.passable, 10);
    if (c >= 0) {
      u.x = center(c % this.map.cells);
      u.z = center((c / this.map.cells) | 0);
      u.path = [];
    }
  }

  // ------------------------------------------------------------------ placement
  placementCells(typeId: string, cx: number, cz: number) {
    const t = this.content.structures.get(typeId)!;
    const out: { cx: number; cz: number; ok: boolean }[] = [];
    for (let z = cz; z < cz + t.footprint[1]; z++) for (let x = cx; x < cx + t.footprint[0]; x++) out.push({ cx: x, cz: z, ok: this.cellBuildable(x, z) });
    return out;
  }
  /** `ignoreUnits`: deploying caravans evict whoever stands in the footprint instead of being blocked. */
  cellBuildable(cx: number, cz: number, ignoreUnits = false) {
    if (!this.inBounds(cx, cz)) return false;
    const i = this.cellIndex(cx, cz);
    if (this.map.flags[i] & (BLOCKS_MOVE | CELL.NOBUILD)) return false;
    if (this.occupancy[i]) return false;
    if (ignoreUnits) return true;
    for (const u of this.entities) {
      if (!u.alive || u.kind !== 'unit') continue;
      if (cellOf(u.x) === cx && cellOf(u.z) === cz) return false;
    }
    return true;
  }
  /** Within the build radius of an owned structure (C&C adjacency rule). */
  inBuildRange(player: number, typeId: string, cx: number, cz: number) {
    const t = this.content.structures.get(typeId)!;
    const x1 = cx + t.footprint[0] - 1, z1 = cz + t.footprint[1] - 1;
    for (const s of this.entities) {
      if (!s.alive || s.kind !== 'structure' || s.owner !== player) continue;
      const r = this.stype(s).buildRadius;
      const gapX = Math.max(0, s.cx - x1 - 1, cx - (s.cx + s.w - 1) - 1);
      const gapZ = Math.max(0, s.cz - z1 - 1, cz - (s.cz + s.h - 1) - 1);
      if (Math.max(gapX, gapZ) <= r) return true;
    }
    return false;
  }
  canPlace(player: number, typeId: string, cx: number, cz: number, deploying = false) {
    const t = this.content.structures.get(typeId);
    if (!t) return false;
    for (let z = cz; z < cz + t.footprint[1]; z++) for (let x = cx; x < cx + t.footprint[0]; x++) if (!this.cellBuildable(x, z, deploying)) return false;
    return deploying ? true : this.inBuildRange(player, typeId, cx, cz);
  }

  // ------------------------------------------------------------------ commands
  issue(player: number, cmd: Command) {
    this.commands.push({ player, cmd });
  }

  private applyCommand(pid: number, c: Command) {
    const p = this.players[pid];
    if (p.defeated) return;
    const mine = (ids: number[]) => ids.map((id) => this.get(id)).filter((e): e is Entity => !!e && e.owner === pid && e.kind === 'unit');
    switch (c.t) {
      case 'move': {
        const us = mine(c.ids).filter((u) => u.deployTimer === 0);
        const slots = this.formation(c.x, c.z, us.length);
        // nearest unit to the target takes the centre slot
        const sorted = [...us].sort((a, b) => dist2(a.x, a.z, c.x, c.z) - dist2(b.x, b.z, c.x, c.z) || a.id - b.id);
        sorted.forEach((u, i) => {
          const [sx, sz] = slots[i];
          u.order = { type: 'move', x: sx, z: sz, attackMove: !!c.attackMove };
          u.targetId = 0;
          if (this.utype(u).harvester) u.hState = 'seek';
          this.pathTo(u, sx, sz);
        });
        break;
      }
      case 'attack': {
        const t = this.get(c.target);
        if (!t || (t.kind !== 'unit' && t.kind !== 'structure')) break;
        for (const u of mine(c.ids)) {
          if (!this.utype(u).weapon) continue;
          u.order = { type: 'attack', target: t.id };
          u.targetId = t.id;
          u.repathTick = 0;
        }
        break;
      }
      case 'stop':
        for (const u of mine(c.ids)) {
          u.order = this.utype(u).harvester ? { type: 'harvest', node: 0 } : { type: 'idle' };
          u.path = [];
          u.targetId = 0;
          u.guardX = u.x;
          u.guardZ = u.z;
        }
        break;
      case 'harvest':
        for (const u of mine(c.ids)) {
          if (!this.utype(u).harvester) continue;
          u.order = { type: 'harvest', node: c.node };
          u.nodeId = c.node;
          u.hState = u.cargo >= this.utype(u).harvester!.capacity ? 'toDock' : 'toNode';
          const n = this.get(c.node);
          if (n && u.hState === 'toNode') this.pathToAdjacent(u, n.cx, n.cz);
        }
        break;
      case 'deploy': {
        const u = this.get(c.id);
        if (!u || u.owner !== pid || !this.utype(u).deploysInto || u.deployTimer > 0) break;
        const t = this.content.structures.get(this.utype(u).deploysInto!)!;
        const cx = Math.round(u.x / LEPTONS - t.footprint[0] / 2), cz = Math.round(u.z / LEPTONS - t.footprint[1] / 2);
        if (!this.canPlace(pid, t.id, cx, cz, true)) {
          this.events.push({ e: 'message', player: pid, text: 'Cannot deploy here', tone: 'warn' });
          break;
        }
        u.deployTimer = Math.round(1.6 * TICK_HZ);
        u.path = [];
        u.order = { type: 'deploy' };
        u.cx = cx;
        u.cz = cz;
        this.events.push({ e: 'deploying', id: u.id });
        break;
      }
      case 'queue': {
        const t = this.content.get(c.typeId);
        if (!t || !this.canBuild(pid, t.id)) break;
        const q = p.queues[t.tab];
        if (t.kind === 'structure') {
          if (q.ready || q.items.length) break; // one structure per tab at a time
          q.items.push({ typeId: t.id, progress: 0, paid: 0 });
        } else {
          if (q.items.filter((i) => i.typeId === t.id).length >= 5 || q.items.length >= 12) break;
          q.items.push({ typeId: t.id, progress: 0, paid: 0 });
        }
        break;
      }
      case 'cancel': {
        const t = this.content.get(c.typeId);
        if (!t) break;
        const q = p.queues[t.tab];
        if (q.ready === t.id) {
          q.ready = null;
          p.jade += t.cost;
          break;
        }
        for (let i = q.items.length - 1; i >= 0; i--) {
          if (q.items[i].typeId === t.id) {
            p.jade += q.items[i].paid;
            q.items.splice(i, 1);
            break;
          }
        }
        break;
      }
      case 'place': {
        const t = this.content.structures.get(c.typeId);
        if (!t) break;
        const q = p.queues[t.tab];
        if (q.ready !== t.id) break;
        if (!this.canPlace(pid, t.id, c.cx, c.cz)) {
          this.events.push({ e: 'message', player: pid, text: 'Cannot build there', tone: 'warn' });
          break;
        }
        q.ready = null;
        this.spawnStructure(t.id, pid, c.cx, c.cz);
        p.stats.built++;
        break;
      }
      case 'sell': {
        const s = this.get(c.id);
        if (!s || s.owner !== pid || s.kind !== 'structure') break;
        const t = this.stype(s);
        p.jade += Math.floor((t.cost * this.content.rules.sellRefundPct) / 100);
        this.events.push({ e: 'sold', id: s.id, player: pid });
        this.remove(s, -1, true);
        break;
      }
      case 'power': {
        const pw = this.content.rules.powers.find((x) => x.id === c.power);
        if (!pw) break;
        if (p.powerCharge[pw.id] > 0 || p.mandateMilli < pw.mandateCost * 1000) break;
        p.mandateMilli -= pw.mandateCost * 1000;
        p.powerCharge[pw.id] = pw.chargeTicks;
        this.strikes.push({ player: pid, power: pw, x: c.x, z: c.z, at: this.tick + pw.delayTicks });
        this.events.push({ e: 'powerCast', player: pid, power: pw.id, x: c.x, z: c.z, delay: pw.delayTicks });
        break;
      }
      case 'cast': {
        for (const u of mine(c.ids)) {
          const sp = this.utype(u).spell;
          if (!sp || u.spellCd > 0 || u.frozenTicks > 0 || u.liftTicks > 0) continue;
          u.order = { type: 'cast', x: c.x, z: c.z };
          u.targetId = 0;
          u.repathTick = 0;
        }
        break;
      }
      case 'rally': {
        const s = this.get(c.id);
        if (s && s.owner === pid && s.kind === 'structure') {
          s.rallyX = c.x;
          s.rallyZ = c.z;
        }
        break;
      }
    }
  }

  /** Formation slots around a target point: spiral of free cell centres (infantry share cells). */
  formation(x: number, z: number, n: number): [number, number][] {
    const out: [number, number][] = [];
    const gx = cellOf(x), gz = cellOf(z);
    for (let r = 0; out.length < n && r < 12; r++) {
      for (let dz = -r; dz <= r && out.length < n; dz++) for (let dx = -r; dx <= r && out.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = gx + dx, cz = gz + dz;
        if (!this.inBounds(cx, cz) || !this.passable(this.cellIndex(cx, cz))) continue;
        out.push(r === 0 ? [x, z] : [center(cx), center(cz)]);
      }
    }
    while (out.length < n) out.push([x, z]);
    return out;
  }

  // ------------------------------------------------------------------ movement
  pathTo(u: Entity, x: number, z: number) {
    const w = this.map.cells;
    const sx = cellOf(u.x), sz = cellOf(u.z);
    const gx = Math.max(0, Math.min(w - 1, cellOf(x))), gz = Math.max(0, Math.min(w - 1, cellOf(z)));
    let start = sz * w + sx;
    if (!this.passable(start)) {
      const s2 = this.pf.nearest(start, this.passable, 4);
      if (s2 >= 0) start = s2;
    }
    let goal = gz * w + gx;
    let exact = true;
    if (!this.passable(goal)) {
      const g2 = this.pf.nearest(goal, this.passable, 6);
      if (g2 >= 0) goal = g2;
      exact = false;
    }
    u.goalX = x;
    u.goalZ = z;
    u.stuck = 0;
    const cells = this.pf.find(start, goal, this.passable);
    if (!cells) {
      u.path = [];
      return false;
    }
    // smooth: keep only turning points that break line of sight
    const pts: number[] = [];
    let anchor = start;
    for (let i = 0; i < cells.length; i++) {
      const next = i + 1 < cells.length ? cells[i + 1] : -1;
      if (next < 0 || !this.pf.lineClear(anchor, next, this.passable)) {
        pts.push(center(cells[i] % w), center((cells[i] / w) | 0));
        anchor = cells[i];
      }
    }
    if (exact && pts.length >= 2 && cells.length && cells[cells.length - 1] === goal) {
      pts[pts.length - 2] = x;
      pts[pts.length - 1] = z;
    } else if (exact && !cells.length) {
      pts.push(x, z);
    }
    u.path = pts;
    u.pathI = 0;
    u.stuckCheckX = u.x;
    u.stuckCheckZ = u.z;
    return true;
  }
  private pathToAdjacent(u: Entity, cx: number, cz: number) {
    // stand on the free neighbour cell nearest to the unit
    let best = -1, bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const x = cx + dx, z = cz + dz;
      if (!this.inBounds(x, z) || !this.passable(this.cellIndex(x, z))) continue;
      const d = dist2(center(x), center(z), u.x, u.z);
      if (d < bd) {
        bd = d;
        best = this.cellIndex(x, z);
      }
    }
    if (best < 0) return false;
    return this.pathTo(u, center(best % this.map.cells), center((best / this.map.cells) | 0));
  }

  private stepMovement(u: Entity, t: UnitType) {
    u.moving = false;
    if (u.pathI * 2 >= u.path.length) {
      if (u.path.length) u.path = [];
      return;
    }
    const wx = u.path[u.pathI * 2], wz = u.path[u.pathI * 2 + 1];
    const dx = wx - u.x, dz = wz - u.z;
    const d = isqrt(dx * dx + dz * dz);
    const want = facingOf(dx, dz);
    u.facing = turnToward(u.facing, want, t.turnRate);
    if (t.category === 'vehicle' && Math.abs(facingDelta(u.facing, want)) > 28) return; // turn in place first
    const step = u.chillTicks > 0 ? Math.max(1, Math.floor((t.speed * (100 - u.chillPct)) / 100)) : t.speed;
    if (d <= step) {
      u.x = wx;
      u.z = wz;
      u.pathI++;
      if (u.pathI * 2 >= u.path.length) {
        u.path = [];
        this.arrived(u);
      }
    } else {
      u.x += Math.trunc((dx * step) / d);
      u.z += Math.trunc((dz * step) / d);
    }
    u.moving = true;
    // stuck detection every second
    if ((this.tick + u.id) % TICK_HZ === 0) {
      const moved = isqrt(dist2(u.x, u.z, u.stuckCheckX, u.stuckCheckZ));
      if (moved < step * 3) {
        u.stuck++;
        if (u.stuck >= 5) {
          u.path = [];
          this.arrived(u);
        } else if (u.stuck % 2 === 0) {
          const s = u.stuck;
          this.pathTo(u, u.goalX, u.goalZ);
          u.stuck = s;
        }
      } else u.stuck = 0;
      u.stuckCheckX = u.x;
      u.stuckCheckZ = u.z;
    }
  }
  private arrived(u: Entity) {
    if (u.order.type === 'move') {
      u.guardX = u.x;
      u.guardZ = u.z;
      u.order = this.utype(u).harvester ? { type: 'harvest', node: 0 } : { type: 'idle' };
    }
  }

  private separation() {
    const units = this.entities.filter((e) => e.alive && e.kind === 'unit');
    const w = this.map.cells;
    const buckets = new Map<number, Entity[]>();
    for (const u of units) {
      const k = cellOf(u.z) * w + cellOf(u.x);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(u);
    }
    const push = new Map<number, [number, number]>();
    const add = (u: Entity, x: number, z: number) => {
      const p = push.get(u.id);
      if (p) {
        p[0] += x;
        p[1] += z;
      } else push.set(u.id, [x, z]);
    };
    for (const a of units) {
      const ta = this.utype(a);
      const acx = cellOf(a.x), acz = cellOf(a.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const b = buckets.get((acz + dz) * w + acx + dx);
        if (!b) continue;
        for (const o of b) {
          if (o.id <= a.id) continue;
          const tb = this.utype(o);
          const rr = ta.radius + tb.radius;
          let ddx = o.x - a.x, ddz = o.z - a.z;
          let d2 = ddx * ddx + ddz * ddz;
          if (d2 >= rr * rr) continue;
          if (d2 === 0) {
            ddx = ((a.id * 37 + o.id * 11) % 7) - 3 || 1;
            ddz = ((a.id * 13 + o.id * 29) % 7) - 3;
            d2 = ddx * ddx + ddz * ddz;
          }
          const d = Math.max(1, isqrt(d2));
          const overlap = rr - d;
          // mass: vehicles barely move for infantry; stationary units yield to moving ones
          const heavyA = ta.category === 'vehicle' ? 3 : 1, heavyB = tb.category === 'vehicle' ? 3 : 1;
          let wa = heavyB * (a.moving ? 1 : 2), wb = heavyA * (o.moving ? 1 : 2);
          if (a.deployTimer > 0 || a.hState === 'unload') wa = 0;
          if (o.deployTimer > 0 || o.hState === 'unload') wb = 0;
          const sum = wa + wb || 1;
          const px = Math.trunc((ddx * overlap) / d), pz = Math.trunc((ddz * overlap) / d);
          add(a, -Math.trunc((px * wa) / sum), -Math.trunc((pz * wa) / sum));
          add(o, Math.trunc((px * wb) / sum), Math.trunc((pz * wb) / sum));
        }
      }
    }
    for (const u of units) {
      const p = push.get(u.id);
      if (!p) continue;
      const lim = 48;
      const px = Math.max(-lim, Math.min(lim, p[0])), pz = Math.max(-lim, Math.min(lim, p[1]));
      const nx = u.x + px, nz = u.z + pz;
      const w2 = this.map.cells;
      if (cellOf(nx) >= 0 && cellOf(nx) < w2 && this.passable(this.cellIndex(cellOf(nx), cellOf(u.z)))) u.x = nx;
      if (cellOf(nz) >= 0 && cellOf(nz) < w2 && this.passable(this.cellIndex(cellOf(u.x), cellOf(nz)))) u.z = nz;
    }
  }

  // ------------------------------------------------------------------ combat
  private acquire(u: Entity, range: number, includeStructures = true): Entity | undefined {
    let best: Entity | undefined, bd = Infinity, bestIsUnit = false;
    const r2 = range * range;
    for (const e of this.entities) {
      if (!e.alive || (e.kind !== 'unit' && e.kind !== 'structure') || !this.isEnemy(u.owner, e.owner)) continue;
      if (e.kind === 'structure' && (!includeStructures || this.stype(e).isWall)) continue;
      const d = this.distTo2(u.x, u.z, e);
      if (d > r2) continue;
      const isUnit = e.kind === 'unit';
      // prefer armed units, then any unit, then structures
      if ((isUnit && !bestIsUnit) || (isUnit === bestIsUnit && d < bd)) {
        best = e;
        bd = d;
        bestIsUnit = isUnit;
      }
    }
    return best;
  }

  private fire(u: Entity, w: WeaponType, target: Entity) {
    if (w.projectile === 'none') {
      this.events.push({ e: 'melee', id: u.id, target: target.id, x: target.x, z: target.z });
      this.damage(target, w.damage, w.vs, u.owner, u.id);
      return;
    }
    const p = this.spawnRaw('projectile', u.owner, w.projectile, u.x, u.z);
    p.srcId = u.id;
    p.targetId = target.id;
    p.tgtX = target.x;
    p.tgtZ = target.z;
    p.weapon = w;
    p.facing = facingOf(target.x - u.x, target.z - u.z);
    this.events.push({ e: 'fire', id: u.id, proj: p.id, kind: w.projectile, x: u.x, z: u.z, tx: target.x, tz: target.z });
  }

  damage(t: Entity, base: number, vs: Record<string, number>, attackerOwner: number, attackerId: number) {
    if (!t.alive || (t.kind !== 'unit' && t.kind !== 'structure')) return;
    const armor = this.type(t).armor;
    const pct = vs[armor] ?? 100;
    const dmg = Math.max(1, Math.floor((base * pct) / 100));
    t.hp -= dmg;
    t.lastDamageTick = this.tick;
    this.events.push({ e: 'damage', id: t.id, amount: dmg });
    const owner = this.players[t.owner];
    if (owner && attackerOwner !== t.owner && this.tick - owner.lastAlertTick > TICK_HZ * 12) {
      owner.lastAlertTick = this.tick;
      this.events.push({ e: 'underAttack', player: t.owner, x: t.x, z: t.z });
    }
    // units under fire with no orders fight back
    if (t.kind === 'unit' && t.order.type === 'idle' && !t.targetId && this.utype(t).weapon) {
      const a = this.get(attackerId);
      if (a && (a.kind === 'unit' || a.kind === 'structure')) t.targetId = a.id;
    }
    if (t.hp <= 0) {
      if (attackerOwner >= 0 && attackerOwner !== t.owner) this.players[attackerOwner].stats.kills++;
      this.remove(t, attackerOwner, false);
    }
  }

  private remove(e: Entity, killer: number, sold: boolean) {
    e.alive = false;
    if (e.kind === 'structure') {
      for (let z = e.cz; z < e.cz + e.h; z++) for (let x = e.cx; x < e.cx + e.w; x++) {
        const i = this.cellIndex(x, z);
        if (this.occupancy[i] === e.id) this.occupancy[i] = 0;
      }
      const p = this.players[e.owner];
      if (p && !sold) {
        p.mandateMilli = Math.max(0, p.mandateMilli - this.stype(e).mandatePerMin * 3000);
        p.stats.lost++;
      }
    } else if (e.kind === 'unit' && this.players[e.owner]) this.players[e.owner].stats.lost++;
    if (!sold) this.events.push({ e: 'death', id: e.id, typeId: e.typeId, kind: e.kind, x: e.x, z: e.z, owner: e.owner, killer });
  }

  private updateCombat(u: Entity, t: UnitType) {
    const w = t.weapon!;
    if (u.cooldown > 0) u.cooldown--;
    let target = u.targetId ? this.get(u.targetId) : undefined;
    if (target && (target.kind === 'unit' || target.kind === 'structure') && !this.isEnemy(u.owner, target.owner)) target = undefined;
    const ord = u.order;
    if (ord.type === 'attack') {
      target = this.get(ord.target);
      if (!target) {
        u.order = { type: 'idle' };
        u.guardX = u.x;
        u.guardZ = u.z;
        u.path = [];
      }
    } else if (ord.type === 'move' && !ord.attackMove) {
      u.targetId = 0;
      u.windup = 0;
      return;
    } else if (!target && (this.tick + u.id) % 5 === 0 && (ord.type === 'idle' || (ord.type === 'move' && ord.attackMove))) {
      target = this.acquire(u, t.sight);
    }
    // guard leash: don't chase too far from the guard point
    if (target && ord.type === 'idle') {
      const leash = t.sight + 3 * LEPTONS;
      if (dist2(u.x, u.z, u.guardX, u.guardZ) > leash * leash) {
        target = undefined;
        this.pathTo(u, u.guardX, u.guardZ);
      }
    }
    u.targetId = target ? target.id : 0;
    if (!target) {
      u.windup = 0;
      return;
    }
    const reach = w.range + (target.kind === 'unit' ? 0 : 48);
    const inRange = this.distTo2(u.x, u.z, target) <= reach * reach;
    if (inRange) {
      if (ord.type !== 'move' || ord.attackMove) u.path = [];
      u.facing = turnToward(u.facing, facingOf(target.x - u.x, target.z - u.z), t.turnRate);
      if (u.windup > 0) {
        if (--u.windup === 0) {
          this.fire(u, w, target);
          u.cooldown = w.cooldown;
        }
      } else if (u.cooldown === 0) {
        u.windup = w.windup;
        u.attackTick = this.tick;
        this.events.push({ e: 'attack', id: u.id, target: target.id });
      }
    } else {
      u.windup = 0;
      // chase
      if (this.tick >= u.repathTick) {
        u.repathTick = this.tick + 12;
        const tx = target.kind === 'structure' ? this.closestPointOn(target, u.x, u.z) : [target.x, target.z];
        this.pathTo(u, tx[0], tx[1]);
      }
    }
  }
  private closestPointOn(s: Entity, x: number, z: number): [number, number] {
    const x0 = s.cx * LEPTONS - 64, z0 = s.cz * LEPTONS - 64, x1 = (s.cx + s.w) * LEPTONS + 64, z1 = (s.cz + s.h) * LEPTONS + 64;
    return [Math.max(x0, Math.min(x1, x)), Math.max(z0, Math.min(z1, z))];
  }

  private updateStructureWeapon(s: Entity, t: StructureType) {
    const w = t.weapon!;
    const p = this.players[s.owner];
    if (!s.built || (p.lowPower && t.role === 'defense')) return;
    if (s.cooldown > 0) s.cooldown--;
    let target = s.targetId ? this.get(s.targetId) : undefined;
    if (target && this.distTo2(s.x, s.z, target) > (w.range + t.footprint[0] * 128) ** 2) target = undefined;
    if (!target && (this.tick + s.id) % 6 === 0) target = this.acquire(s, w.range + t.footprint[0] * 128, false);
    s.targetId = target ? target.id : 0;
    if (target && s.cooldown === 0) {
      this.fire(s, w, target);
      s.cooldown = w.cooldown;
      s.attackTick = this.tick;
    }
  }

  private updateProjectile(p: Entity) {
    const w = p.weapon!;
    const t = this.get(p.targetId);
    if (t) {
      p.tgtX = t.x;
      p.tgtZ = t.z;
    }
    const dx = p.tgtX - p.x, dz = p.tgtZ - p.z;
    const d = isqrt(dx * dx + dz * dz);
    if (d <= w.projSpeed) {
      p.x = p.tgtX;
      p.z = p.tgtZ;
      p.alive = false;
      this.events.push({ e: 'impact', kind: p.typeId, x: p.x, z: p.z, splash: w.splash, owner: p.owner, proj: p.id, target: p.targetId });
      if (w.splash > 0) {
        const r2 = w.splash * w.splash;
        for (const e of this.entities) {
          if (!e.alive || (e.kind !== 'unit' && e.kind !== 'structure') || !this.isEnemy(p.owner, e.owner)) continue;
          const d2 = this.distTo2(p.x, p.z, e);
          if (d2 > r2) continue;
          const falloff = e.id === p.targetId ? 100 : 100 - Math.floor((isqrt(d2) * 50) / w.splash);
          this.damage(e, Math.floor((w.damage * falloff) / 100), w.vs, p.owner, p.srcId);
          if (e.alive && (e.id === p.targetId || falloff >= 70)) this.magic.applyOnHit(e, w.onHit, p.owner, p.x - dx, p.z - dz);
        }
      } else if (t) {
        this.damage(t, w.damage, w.vs, p.owner, p.srcId);
        if (t.alive) this.magic.applyOnHit(t, w.onHit, p.owner, p.x - dx, p.z - dz);
      }
      return;
    }
    p.x += Math.trunc((dx * w.projSpeed) / d);
    p.z += Math.trunc((dz * w.projSpeed) / d);
    p.facing = facingOf(dx, dz);
  }

  // ------------------------------------------------------------------ harvesting
  private nearestNode(u: Entity, from?: Entity, maxCells = 64, minAmount = 150): Entity | undefined {
    let best: Entity | undefined, bd = Infinity;
    const ox = from ? from.x : u.x, oz = from ? from.z : u.z;
    const lim = maxCells * LEPTONS;
    for (const e of this.entities) {
      // skip nearly-empty nodes (regrowth trickle) — they'd make harvesters thrash between fields
      if (!e.alive || e.kind !== 'jade' || e.amount < Math.min(minAmount, e.maxAmount)) continue;
      const d = dist2(ox, oz, e.x, e.z);
      if (d > lim * lim) continue;
      // spread harvesters over nodes: penalise nodes already being worked
      let crowd = 0;
      for (const o of this.entities) if (o.alive && o.kind === 'unit' && o.id !== u.id && o.nodeId === e.id && (o.hState === 'harvest' || o.hState === 'toNode')) crowd++;
      const score = d + crowd * (4 * LEPTONS) * (4 * LEPTONS);
      if (score < bd) {
        bd = score;
        best = e;
      }
    }
    if (!best && minAmount > 1) return this.nearestNode(u, from, maxCells, 1);
    return best;
  }
  private nearestRefinery(u: Entity): Entity | undefined {
    let best: Entity | undefined, bd = Infinity;
    for (const e of this.entities) {
      if (!e.alive || e.kind !== 'structure' || e.owner !== u.owner || !e.built || !this.stype(e).dock) continue;
      const d = dist2(u.x, u.z, e.x, e.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  dockPoint(s: Entity): [number, number] {
    const t = this.stype(s);
    return [s.x + t.dock![0], s.z + t.dock![1]];
  }

  private updateHarvester(u: Entity, t: UnitType) {
    const hv = t.harvester!;
    if (u.order.type === 'move') return; // player override; resumes on arrival
    const perTick = (rate: number) => Math.floor((rate * ((this.tick % TICK_HZ) + 1)) / TICK_HZ) - Math.floor((rate * (this.tick % TICK_HZ)) / TICK_HZ);
    switch (u.hState) {
      case 'seek':
      case 'wait': {
        if (u.hState === 'wait' && (this.tick + u.id) % (TICK_HZ * 3) !== 0) return;
        if (u.cargo >= hv.capacity) {
          u.hState = 'toDock';
          return;
        }
        const n = (u.order.type === 'harvest' && u.order.node && this.get(u.order.node)?.amount) ? this.get(u.order.node) : this.nearestNode(u);
        if (!n) {
          u.hState = u.cargo > 0 ? 'toDock' : 'wait';
          return;
        }
        u.nodeId = n.id;
        u.hState = 'toNode';
        if (!this.pathToAdjacent(u, n.cx, n.cz)) u.hState = 'wait';
        return;
      }
      case 'toNode': {
        const n = this.get(u.nodeId);
        if (!n || n.amount <= 0) {
          u.hState = 'seek';
          return;
        }
        const near = this.distTo2(u.x, u.z, n) <= (LEPTONS * 3) / 2 * ((LEPTONS * 3) / 2);
        if (near && (u.path.length === 0 || this.distTo2(u.x, u.z, n) <= LEPTONS * LEPTONS)) {
          u.path = [];
          u.hState = 'harvest';
        } else if (!u.path.length) {
          if (!this.pathToAdjacent(u, n.cx, n.cz)) u.hState = 'seek';
        }
        return;
      }
      case 'harvest': {
        const n = this.get(u.nodeId);
        if (!n || n.amount <= 0) {
          // try another node close by, else head home
          const next = this.nearestNode(u, u, 6);
          if (next && u.cargo < hv.capacity) {
            u.nodeId = next.id;
            u.hState = 'toNode';
            this.pathToAdjacent(u, next.cx, next.cz);
          } else u.hState = u.cargo > 0 ? 'toDock' : 'seek';
          return;
        }
        u.facing = turnToward(u.facing, facingOf(n.x - u.x, n.z - u.z), t.turnRate);
        const take = Math.min(perTick(hv.harvestPerSec), n.amount, hv.capacity - u.cargo);
        n.amount -= take;
        u.cargo += take;
        if ((this.tick + u.id) % 8 === 0) this.events.push({ e: 'harvest', id: u.id, node: n.id });
        if (u.cargo >= hv.capacity) u.hState = 'toDock';
        return;
      }
      case 'toDock': {
        const r = u.dockId ? this.get(u.dockId) : undefined;
        const ref = r && r.built ? r : this.nearestRefinery(u);
        if (!ref) {
          u.hState = 'wait';
          return;
        }
        u.dockId = ref.id;
        const [dx, dz] = this.dockPoint(ref);
        if (dist2(u.x, u.z, dx, dz) <= (LEPTONS / 2) * (LEPTONS / 2) || (!u.path.length && dist2(u.x, u.z, dx, dz) <= LEPTONS * LEPTONS * 2)) {
          u.path = [];
          u.hState = 'unload';
          u.facing = turnToward(u.facing, 128, 16);
        } else if (!u.path.length) {
          if (!this.pathTo(u, dx, dz)) u.hState = 'wait';
        }
        return;
      }
      case 'unload': {
        const ref = this.get(u.dockId);
        if (!ref) {
          u.hState = 'toDock';
          return;
        }
        const give = Math.min(perTick(hv.unloadPerSec), u.cargo);
        u.cargo -= give;
        const p = this.players[u.owner];
        p.jade += give;
        p.stats.harvested += give;
        if (give && (this.tick + u.id) % 10 === 0) this.events.push({ e: 'unload', id: u.id, amount: give });
        if (u.cargo <= 0) {
          u.cargo = 0;
          u.hState = 'seek';
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------------ production & economy
  private updatePlayer(p: PlayerState) {
    if (p.defeated) return;
    const structs = this.structuresOf(p.id);
    // Qi
    let prod = 0, used = 0, mandateRate = 0;
    for (const s of structs) {
      if (!s.built) continue;
      const t = this.stype(s);
      if (t.qi > 0) prod += t.qi;
      else used -= t.qi;
      mandateRate += t.mandatePerMin;
    }
    const wasLow = p.lowPower;
    p.qiProduced = prod;
    p.qiUsed = used;
    p.lowPower = used > prod;
    if (p.lowPower && !wasLow) this.events.push({ e: 'message', player: p.id, text: 'Qi is low — build a Qi Shrine', tone: 'warn' });
    // Harmony (every 2 s)
    if ((this.tick + p.id) % 30 === 0) p.harmony = this.computeHarmony(p.id, structs);
    // Mandate: rate × harmony, integer carry
    p.mandateAcc += mandateRate * p.harmony * 1000;
    const perMilli = 100 * 60 * TICK_HZ;
    p.mandateMilli += Math.floor(p.mandateAcc / perMilli);
    p.mandateAcc %= perMilli;
    for (const k of Object.keys(p.powerCharge)) if (p.powerCharge[k] > 0) p.powerCharge[k]--;

    // production queues
    const bonus = Math.max(0, Math.min(this.content.rules.maxProductionBonusPct, p.harmony - 100));
    const speed = (p.lowPower ? this.content.rules.lowPowerSpeedPct : 100) + bonus;
    for (const tab of TAB_ORDER) {
      const q = p.queues[tab];
      if (q.ready || !q.items.length) continue;
      const item = q.items[0];
      const t = this.content.get(item.typeId)!;
      if (!this.canBuild(p.id, t.id)) continue; // producer lost: pause
      const total = t.buildTicks * 100;
      let factories = 1;
      if (t.kind === 'unit') factories = Math.max(1, t.producedAt.reduce((n, f) => n + this.ownedCount(p.id, f), 0));
      const step = Math.floor((speed * (100 + (factories - 1) * 50)) / 100);
      const nextProgress = Math.min(total, item.progress + step);
      const nextPaid = Math.floor((t.cost * nextProgress) / total);
      const due = nextPaid - item.paid;
      if (due > p.jade) {
        if ((this.tick + p.id) % (TICK_HZ * 8) === 0) this.events.push({ e: 'message', player: p.id, text: 'Insufficient jade', tone: 'warn' });
        continue;
      }
      p.jade -= due;
      item.paid = nextPaid;
      item.progress = nextProgress;
      if (item.progress >= total) {
        q.items.shift();
        if (t.kind === 'structure') {
          q.ready = t.id;
          this.events.push({ e: 'ready', player: p.id, typeId: t.id });
        } else {
          this.deliverUnit(p, t);
        }
      }
    }
  }

  private deliverUnit(p: PlayerState, t: UnitType) {
    // pick the factory with the fewest units standing at its exit
    const facs = this.entities.filter((e) => e.alive && e.kind === 'structure' && e.owner === p.id && e.built && t.producedAt.includes(e.typeId));
    const f = facs[0];
    if (!f) return;
    const ft = this.stype(f);
    const ex = f.x + (ft.exit ? ft.exit[0] : 0), ez = f.z + (ft.exit ? ft.exit[1] : (f.h * LEPTONS) / 2 + LEPTONS);
    let x = ex, z = ez;
    const c = this.cellIndex(Math.max(0, Math.min(this.map.cells - 1, cellOf(ex))), Math.max(0, Math.min(this.map.cells - 1, cellOf(ez))));
    if (!this.passable(c)) {
      const n = this.pf.nearest(c, this.passable, 6);
      if (n >= 0) {
        x = center(n % this.map.cells);
        z = center((n / this.map.cells) | 0);
      }
    }
    const u = this.spawnUnit(t.id, p.id, x, z);
    u.facing = 0;
    p.stats.trained++;
    this.events.push({ e: 'trained', player: p.id, id: u.id, typeId: t.id });
    if (!t.harvester) {
      const rx = f.rallyX >= 0 ? f.rallyX : ex, rz = f.rallyZ >= 0 ? f.rallyZ : ez + LEPTONS * 2;
      const slot = this.formation(rx, rz, 1 + (p.stats.trained % 6))[p.stats.trained % 6] ?? [rx, rz];
      u.order = { type: 'move', x: slot[0], z: slot[1], attackMove: false };
      this.pathTo(u, slot[0], slot[1]);
    }
  }

  computeHarmony(pid: number, structs = this.structuresOf(pid)): number {
    let h = 100;
    const built = structs.filter((s) => s.built && !this.stype(s).isWall);
    const gap = (a: Entity, b: Entity) => Math.max(0, Math.max(b.cx - (a.cx + a.w), a.cx - (b.cx + b.w)), Math.max(b.cz - (a.cz + a.h), a.cz - (b.cz + b.h)));
    for (const s of built) {
      const t = this.stype(s);
      if (t.harmony) {
        const ok = t.harmony.adjacentTo.some((id) => {
          if (id === 'water') {
            for (let z = s.cz - 2; z < s.cz + s.h + 2; z++) for (let x = s.cx - 2; x < s.cx + s.w + 2; x++) {
              if (this.inBounds(x, z) && this.map.flags[this.cellIndex(x, z)] & CELL.WATER) return true;
            }
            return false;
          }
          return built.some((o) => o !== s && o.typeId === id && gap(s, o) <= 1);
        });
        if (ok) h += 5;
      }
      // sprawl penalty only once a base exists (a lone Yamen isn't "isolated")
      if (built.length >= 3 && !built.some((o) => o !== s && gap(s, o) <= 2)) h -= 4;
    }
    return Math.max(this.content.rules.harmonyMinPct, Math.min(this.content.rules.harmonyMaxPct, h));
  }

  // ------------------------------------------------------------------ tick
  step() {
    this.events = [];
    const cmds = this.commands;
    this.commands = [];
    for (const c of cmds) this.applyCommand(c.player, c.cmd);
    if (this.winner < 0) for (const p of this.players) if (p.ai && !p.defeated && this.controllers[p.id]) this.controllers[p.id](this, p);

    for (const p of this.players) this.updatePlayer(p);

    const list = this.entities;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (!e.alive) continue;
      if (e.kind === 'structure') {
        const t = this.stype(e);
        if (e.buildup > 0 && --e.buildup === 0) {
          this.events.push({ e: 'built', id: e.id, player: e.owner, typeId: e.typeId });
          if (t.freeUnit && t.dock) {
            const [dx, dz] = this.dockPoint(e);
            this.spawnUnit(t.freeUnit, e.owner, dx, dz);
          }
        }
        if (t.weapon) this.updateStructureWeapon(e, t);
        // self repair
        if (e.built && e.hp < e.maxHp && this.tick - e.lastDamageTick > this.content.rules.selfRepairDelayTicks && this.tick % TICK_HZ === 0) {
          e.hp = Math.min(e.maxHp, e.hp + this.content.rules.selfRepairPerSec);
        }
      } else if (e.kind === 'unit') {
        const t = this.utype(e);
        if (e.deployTimer > 0) {
          if (--e.deployTimer === 0) {
            const into = t.deploysInto!;
            e.alive = false; // becomes the structure
            const s = this.spawnStructure(into, e.owner, e.cx, e.cz);
            s.hp = s.maxHp;
            this.events.push({ e: 'deployed', id: s.id, player: e.owner });
          }
          continue;
        }
        if (this.magic.unitStatus(e)) continue; // frozen, lifted, knocked back or casting
        if (t.harvester) this.updateHarvester(e, t);
        if (t.spell) this.magic.think(e, t);
        if (e.castTicks > 0) continue;
        if (t.weapon && e.order.type !== 'cast') this.updateCombat(e, t);
        this.stepMovement(e, t);
      } else if (e.kind === 'projectile') {
        this.updateProjectile(e);
      } else if (e.kind === 'jade') {
        if (this.tick % 30 === e.id % 30 && e.amount < e.maxAmount) e.amount = Math.min(e.maxAmount, e.amount + Math.max(1, Math.floor(this.content.rules.jadeRegrowPerMin / 30)));
      }
    }
    this.magic.tick();
    this.separation();

    // mandate powers
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      if (this.tick < s.at) continue;
      this.strikes.splice(i, 1);
      this.events.push({ e: 'powerStrike', player: s.player, power: s.power.id, x: s.x, z: s.z, radius: s.power.radius });
      const r2 = s.power.radius * s.power.radius;
      for (const e of this.entities) {
        if (!e.alive || (e.kind !== 'unit' && e.kind !== 'structure')) continue;
        const d2 = this.distTo2(s.x, s.z, e);
        if (d2 > r2) continue;
        let fall = 100 - Math.floor((isqrt(d2) * 50) / s.power.radius);
        // lightning through wet targets: bonus damage (and arcs, client side)
        if (e.kind === 'unit' && e.wetTicks > 0) {
          fall += Math.floor((fall * this.content.rules.reactions.wetLightningBonusPct) / 100);
          this.events.push({ e: 'shock', id: e.id, x: e.x, z: e.z });
        }
        this.damage(e, Math.floor((s.power.damage * fall) / 100), s.power.vs, s.player, 0);
      }
    }

    // compact dead entities occasionally
    if (this.tick % 60 === 0) {
      this.entities = this.entities.filter((e) => e.alive);
      for (const [id, e] of this.byId) if (!e.alive) this.byId.delete(id);
    }
    // defeat / victory
    if (this.tick % 15 === 0 && this.winner < 0) {
      for (const p of this.players) {
        if (p.defeated) continue;
        const alive = this.entities.some((e) => e.alive && e.owner === p.id && ((e.kind === 'structure' && !this.stype(e).isWall) || e.kind === 'unit'));
        if (!alive) {
          p.defeated = true;
          this.events.push({ e: 'defeat', player: p.id });
        }
      }
      const teams = new Set(this.players.filter((p) => !p.defeated).map((p) => p.team));
      if (teams.size === 1) {
        this.winner = [...teams][0];
        this.events.push({ e: 'victory', team: this.winner });
      }
    }
    this.tick++;
  }

  /** Stable hash of the whole sim state (lockstep desync detection / tests). */
  hash(): number {
    let h = 2166136261 >>> 0;
    const mix = (v: number) => {
      h ^= v & 0xffffffff;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(this.tick);
    for (const e of this.entities) {
      if (!e.alive) continue;
      mix(e.id); mix(e.x); mix(e.z); mix(e.hp); mix(e.facing); mix(e.cargo); mix(e.amount);
      if (e.kind === 'unit') { mix(e.burnTicks); mix(e.chillTicks); mix(e.frozenTicks); mix(e.wetTicks); mix(e.liftTicks); mix(e.spellCd); mix(e.castTicks); }
    }
    this.magic.hashInto(mix);
    for (const p of this.players) {
      mix(p.jade); mix(p.mandateMilli); mix(p.harmony);
      for (const t of TAB_ORDER) for (const it of p.queues[t].items) mix(it.progress);
    }
    return h >>> 0;
  }
}
