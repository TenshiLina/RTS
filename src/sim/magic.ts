// Elemental magic in the deterministic sim: status effects, spell casting (auto + ordered), spell
// zones and the reactions between schools. Integer maths only; runs inside World.step().
//
//   statuses   burning (damage over time), chilled (slow), frozen (can't act), wet (conducts
//              lightning, freezes solid), knockback (pushed over a few ticks), lifted (carried
//              by a whirlwind, dropped for damage)
//   zones      wildfire (burning ground) · glacier (a line of spikes erupting in sequence)
//              surge (a wave front rolling forward) · whirlwind (a wandering funnel)
//   reactions  wet + ice → longer freezes · wet + lightning → bonus damage (see World)
//              water or ice on burning ground → extinguished · whirlwind through fire → fire whirl
//              fire on a frozen unit → thaw

import type { World, Entity } from './world';
import type { OnHit, SpellType, SpellKind, UnitType } from './content';
import { LEPTONS, TICK_HZ, isqrt, dist2, facingOf, sinF, cosF, TRIG_ONE } from './intmath';

export interface Zone {
  id: number;
  kind: SpellKind;
  owner: number;
  caster: number;
  spell: SpellType;
  /** current centre (wildfire / whirlwind) or origin (glacier / surge), leptons */
  x: number;
  z: number;
  /** unit direction × 1024 for line spells, heading for whirlwinds */
  dx: number;
  dz: number;
  /** whirlwind destination */
  tx: number;
  tz: number;
  age: number;
  life: number;
  /** wave front distance (surge) */
  front: number;
  hit: number[];
  fire: boolean;
  alive: boolean;
}

const BURN_TICKS_FROM_ZONE = 2 * TICK_HZ;
const DIR_ONE = 1024;

export class Magic {
  zones: Zone[] = [];
  private nextZone = 1;
  constructor(private w: World) {}

  // ------------------------------------------------------------------ statuses
  applyOnHit(t: Entity, h: OnHit | undefined, owner: number, fromX: number, fromZ: number) {
    if (!h || !t.alive || t.kind !== 'unit') return;
    if (h.burnTicks) this.burn(t, h.burnDps, h.burnTicks, owner);
    if (h.wetTicks) this.soak(t, h.wetTicks);
    if (h.chillTicks) {
      if (t.wetTicks > 0 && h.freezeIfWetTicks) this.freeze(t, h.freezeIfWetTicks);
      else {
        t.chillTicks = Math.max(t.chillTicks, h.chillTicks);
        t.chillPct = Math.max(t.chillPct, h.chillPct);
      }
    }
    if (h.knockback) this.knock(t, t.x - fromX, t.z - fromZ, h.knockback, 4);
  }
  burn(t: Entity, dps: number, ticks: number, owner: number) {
    if (t.kind !== 'unit') return;
    if (t.frozenTicks > 0) {
      // fire thaws ice (and steams it off)
      t.frozenTicks = 0;
      this.w.events.push({ e: 'thaw', id: t.id });
    }
    if (t.wetTicks > 0) {
      // water resists: halves the burn and dries the unit
      t.wetTicks = Math.max(0, t.wetTicks - ticks);
      ticks >>= 1;
    }
    t.chillTicks = 0;
    t.burnTicks = Math.max(t.burnTicks, ticks);
    t.burnDps = Math.max(t.burnDps, dps);
    t.burnOwner = owner;
  }
  soak(t: Entity, ticks: number) {
    t.wetTicks = Math.max(t.wetTicks, ticks);
    if (t.burnTicks > 0) {
      t.burnTicks = 0;
      this.w.events.push({ e: 'douse', id: t.id });
    }
  }
  freeze(t: Entity, ticks: number) {
    if (t.kind !== 'unit' || this.w.utype(t).category === 'vehicle') return;
    if (t.wetTicks > 0) ticks += Math.floor((ticks * this.w.content.rules.reactions.wetFreezeBonusPct) / 100);
    if (t.frozenTicks === 0) this.w.events.push({ e: 'freeze', id: t.id });
    t.frozenTicks = Math.max(t.frozenTicks, ticks);
    t.burnTicks = 0;
    t.windup = 0;
    t.castTicks = 0;
    t.path = [];
  }
  /** push along (dx, dz) by `dist` leptons over `ticks` ticks */
  knock(t: Entity, dx: number, dz: number, dist: number, ticks: number) {
    if (t.kind !== 'unit' || t.liftTicks > 0) return;
    const vehicle = this.w.utype(t).category === 'vehicle';
    if (vehicle) dist >>= 2;
    const d = Math.max(1, isqrt(dx * dx + dz * dz));
    t.kbX = Math.trunc((dx * dist) / d / ticks);
    t.kbZ = Math.trunc((dz * dist) / d / ticks);
    t.kbTicks = ticks;
  }

  /** Per-unit status upkeep. Returns true when the unit cannot act this tick. */
  unitStatus(u: Entity): boolean {
    const w = this.w;
    if (u.burnTicks > 0) {
      u.burnTicks--;
      if ((w.tick + u.id) % 5 === 0) w.damage(u, Math.max(1, Math.floor(u.burnDps / 3)), {}, u.burnOwner, 0);
    }
    if (u.wetTicks > 0) u.wetTicks--;
    if (u.chillTicks > 0 && --u.chillTicks === 0) u.chillPct = 0;
    if (u.kbTicks > 0) {
      u.kbTicks--;
      const nx = u.x + u.kbX, nz = u.z + u.kbZ;
      const cx = Math.floor(nx / LEPTONS), cz = Math.floor(nz / LEPTONS);
      if (w.inBounds(cx, cz) && w.passable(w.cellIndex(cx, cz))) {
        u.x = nx;
        u.z = nz;
      } else u.kbTicks = 0;
      if (u.kbTicks === 0 && u.order.type === 'move') w.pathTo(u, u.goalX, u.goalZ);
      else u.path = [];
    }
    if (!u.alive) return true;
    if (u.frozenTicks > 0) {
      if (--u.frozenTicks === 0) w.events.push({ e: 'unfreeze', id: u.id });
      return true;
    }
    if (u.liftTicks > 0) return true;
    if (u.kbTicks > 0) return true;
    if (u.castTicks > 0) {
      this.channel(u);
      return true;
    }
    if (u.spellCd > 0) u.spellCd--;
    return false;
  }

  // ------------------------------------------------------------------ casting
  /** Try to start a spell: an explicit cast order, or auto-cast on a good target. */
  think(u: Entity, t: UnitType) {
    const sp = t.spell;
    if (!sp || u.spellCd > 0) return;
    const w = this.w;
    const ord = u.order;
    if (ord.type === 'cast') {
      const d2 = dist2(u.x, u.z, ord.x, ord.z);
      if (d2 <= sp.range * sp.range) {
        u.path = [];
        this.begin(u, sp, ord.x, ord.z);
        u.order = { type: 'idle' };
        u.guardX = u.x;
        u.guardZ = u.z;
      } else if (w.tick >= u.repathTick) {
        u.repathTick = w.tick + 12;
        w.pathTo(u, ord.x, ord.z);
      }
      return;
    }
    if (ord.type === 'move' && !ord.attackMove) return;
    if ((w.tick + u.id) % 5 !== 0) return;
    const pick = this.bestTarget(u, sp);
    if (pick) this.begin(u, sp, pick[0], pick[1]);
  }

  private bestTarget(u: Entity, sp: SpellType): [number, number] | null {
    const w = this.w;
    const reach = sp.range + (sp.radius || LEPTONS);
    const foes = w.entities.filter((e) => e.alive && (e.kind === 'unit' || (e.kind === 'structure' && !w.stype(e).isWall)) && w.isEnemy(u.owner, e.owner) && dist2(u.x, u.z, e.x, e.z) <= reach * reach);
    if (!foes.length) return null;
    const units = foes.filter((e) => e.kind === 'unit' && e.liftTicks === 0);
    let best: [number, number] | null = null, bestScore = 0;
    const line = sp.kind === 'glacier' || sp.kind === 'surge';
    for (const c of units) {
      let score = 0;
      if (line) {
        const dx = c.x - u.x, dz = c.z - u.z;
        const d = Math.max(1, isqrt(dx * dx + dz * dz));
        const half = (sp.kind === 'surge' ? sp.width : sp.width) >> 1;
        for (const o of units) {
          const ox = o.x - u.x, oz = o.z - u.z;
          const along = Math.trunc((ox * dx + oz * dz) / d);
          const lat = Math.abs(Math.trunc((ox * dz - oz * dx) / d));
          if (along > 0 && along <= sp.length && lat <= half + LEPTONS / 3) score++;
        }
      } else {
        const r2 = sp.radius * sp.radius;
        for (const o of foes) if (dist2(c.x, c.z, o.x, o.z) <= r2) score += o.kind === 'unit' ? 2 : 1;
        score >>= 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = [c.x, c.z];
      }
    }
    return bestScore >= sp.minTargets ? best : null;
  }

  begin(u: Entity, sp: SpellType, x: number, z: number) {
    u.castTicks = sp.castTicks;
    u.castX = x;
    u.castZ = z;
    u.windup = 0;
    u.facing = facingOf(x - u.x, z - u.z);
    u.attackTick = this.w.tick;
    this.w.events.push({ e: 'castStart', id: u.id, spell: sp.kind, x, z, ticks: sp.castTicks });
  }

  private channel(u: Entity) {
    if (--u.castTicks > 0) return;
    const t = this.w.utype(u);
    const sp = t.spell!;
    u.spellCd = sp.cooldown;
    u.cooldown = Math.max(u.cooldown, 8);
    this.release(u, sp, u.castX, u.castZ);
  }

  private release(u: Entity, sp: SpellType, x: number, z: number) {
    const w = this.w;
    let dx = x - u.x, dz = z - u.z;
    const d = Math.max(1, isqrt(dx * dx + dz * dz));
    dx = Math.trunc((dx * DIR_ONE) / d);
    dz = Math.trunc((dz * DIR_ONE) / d);
    const z0: Zone = {
      id: this.nextZone++, kind: sp.kind, owner: u.owner, caster: u.id, spell: sp,
      x, z, dx, dz, tx: x, tz: z, age: 0, life: 0, front: 0, hit: [], fire: false, alive: true,
    };
    switch (sp.kind) {
      case 'wildfire':
        z0.life = sp.durationTicks + 9; // 0.6 s spreading, then burning
        break;
      case 'glacier':
        // the line starts just in front of the caster
        z0.x = u.x + Math.trunc((dx * (LEPTONS * 0.8)) / DIR_ONE);
        z0.z = u.z + Math.trunc((dz * (LEPTONS * 0.8)) / DIR_ONE);
        z0.life = sp.count * sp.intervalTicks + sp.lingerTicks;
        break;
      case 'surge':
        z0.x = u.x + Math.trunc((dx * (LEPTONS * 0.6)) / DIR_ONE);
        z0.z = u.z + Math.trunc((dz * (LEPTONS * 0.6)) / DIR_ONE);
        z0.life = Math.ceil(sp.length / sp.speed) + TICK_HZ;
        break;
      case 'whirlwind':
        // born beside the caster, then travels to the target and wanders
        z0.x = u.x + Math.trunc((dx * LEPTONS) / DIR_ONE);
        z0.z = u.z + Math.trunc((dz * LEPTONS) / DIR_ONE);
        z0.life = sp.durationTicks;
        break;
    }
    this.zones.push(z0);
    w.events.push({ e: 'spell', id: u.id, spell: sp.kind, zone: z0.id, x: z0.x, z: z0.z, tx: x, tz: z });
  }

  // ------------------------------------------------------------------ zones
  tick() {
    for (const z of this.zones) {
      if (!z.alive) continue;
      z.age++;
      switch (z.kind) {
        case 'wildfire': this.tickWildfire(z); break;
        case 'glacier': this.tickGlacier(z); break;
        case 'surge': this.tickSurge(z); break;
        case 'whirlwind': this.tickWhirlwind(z); break;
      }
      if (z.age >= z.life) this.end(z);
    }
    if (this.w.tick % 30 === 0) this.zones = this.zones.filter((z) => z.alive);
  }
  private end(z: Zone) {
    if (!z.alive) return;
    z.alive = false;
    if (z.kind === 'whirlwind') for (const u of this.w.entities) if (u.alive && u.liftTicks > 0 && u.liftZone === z.id) this.drop(u, z);
    this.w.events.push({ e: 'zoneEnd', zone: z.id });
  }
  private enemiesNear(z: Zone, x: number, zz: number, r: number, unitsOnly = true): Entity[] {
    const w = this.w;
    const out: Entity[] = [];
    const r2 = r * r;
    for (const e of w.entities) {
      if (!e.alive || !w.isEnemy(z.owner, e.owner)) continue;
      if (e.kind === 'unit' || (!unitsOnly && e.kind === 'structure' && !w.stype(e).isWall)) {
        if (w.distTo2(x, zz, e) <= r2) out.push(e);
      }
    }
    return out;
  }

  private tickWildfire(z: Zone) {
    const sp = z.spell;
    if (z.age === 9) {
      // the ring of fire erupts
      for (const e of this.enemiesNear(z, z.x, z.z, sp.radius, false)) {
        this.w.damage(e, sp.damage, sp.vs, z.owner, z.caster);
        if (e.kind === 'unit') this.burn(e, sp.dps, BURN_TICKS_FROM_ZONE, z.owner);
      }
    } else if (z.age > 9 && (z.age - 9) % TICK_HZ === 0) {
      for (const e of this.enemiesNear(z, z.x, z.z, sp.radius, false)) {
        this.w.damage(e, sp.dps, sp.vs, z.owner, z.caster);
        if (e.kind === 'unit') this.burn(e, sp.dps >> 1, BURN_TICKS_FROM_ZONE, z.owner);
      }
    }
  }
  /** spike i position (glacier) */
  spikePos(z: Zone, i: number): [number, number] {
    const step = Math.trunc(z.spell.length / Math.max(1, z.spell.count));
    const along = step * i + (step >> 1);
    return [z.x + Math.trunc((z.dx * along) / DIR_ONE), z.z + Math.trunc((z.dz * along) / DIR_ONE)];
  }
  private tickGlacier(z: Zone) {
    const sp = z.spell;
    const i = Math.floor((z.age - 1) / sp.intervalTicks);
    if ((z.age - 1) % sp.intervalTicks !== 0 || i >= sp.count) return;
    const [x, zz] = this.spikePos(z, i);
    const cx = Math.floor(x / LEPTONS), cz = Math.floor(zz / LEPTONS);
    if (!this.w.inBounds(cx, cz)) return;
    this.w.events.push({ e: 'spike', zone: z.id, i, x, z: zz });
    for (const e of this.enemiesNear(z, x, zz, (sp.width >> 1) + (LEPTONS >> 2))) {
      if (z.hit.includes(e.id)) continue;
      z.hit.push(e.id);
      this.w.damage(e, sp.damage, sp.vs, z.owner, z.caster);
      if (e.alive) this.freeze(e, sp.freezeTicks);
    }
    this.douseAt(x, zz, sp.width);
  }
  private tickSurge(z: Zone) {
    const sp = z.spell;
    if (z.front >= sp.length) return;
    const prev = z.front;
    z.front = Math.min(sp.length, z.front + sp.speed);
    // the wave widens as it travels
    const half = (sp.width >> 1) * (3 + Math.trunc((z.front * 2) / Math.max(1, sp.length))) / 5;
    const w = this.w;
    for (const e of w.entities) {
      if (!e.alive || e.kind !== 'unit' || !w.isEnemy(z.owner, e.owner) || z.hit.includes(e.id)) continue;
      const ox = e.x - z.x, oz = e.z - z.z;
      const along = Math.trunc((ox * z.dx + oz * z.dz) / DIR_ONE);
      const lat = Math.abs(Math.trunc((ox * z.dz - oz * z.dx) / DIR_ONE));
      if (along < prev - LEPTONS / 2 || along > z.front || lat > half) continue;
      z.hit.push(e.id);
      w.damage(e, sp.damage, sp.vs, z.owner, z.caster);
      if (!e.alive) continue;
      this.soak(e, sp.wetTicks);
      this.knock(e, z.dx, z.dz, sp.knockback, 6);
    }
    const fx = z.x + Math.trunc((z.dx * z.front) / DIR_ONE), fz = z.z + Math.trunc((z.dz * z.front) / DIR_ONE);
    this.douseAt(fx, fz, half * 2);
  }
  private tickWhirlwind(z: Zone) {
    const sp = z.spell;
    const w = this.w;
    // travel to the target, then wander
    let hx = z.tx - z.x, hz = z.tz - z.z;
    let d = isqrt(hx * hx + hz * hz);
    if (d <= sp.speed * 2) {
      // pick a new nearby wander point (deterministic)
      const f = w.rng.int(256);
      const r = LEPTONS + w.rng.int(LEPTONS * 2);
      const nx = z.x + Math.trunc((sinF(f) * r) / TRIG_ONE), nz = z.z + Math.trunc((cosF(f) * r) / TRIG_ONE);
      const cx = Math.floor(nx / LEPTONS), cz = Math.floor(nz / LEPTONS);
      if (w.inBounds(cx, cz) && w.passable(w.cellIndex(cx, cz))) {
        z.tx = nx;
        z.tz = nz;
      }
      hx = z.tx - z.x;
      hz = z.tz - z.z;
      d = isqrt(hx * hx + hz * hz);
    }
    if (d > 0) {
      const nx = z.x + Math.trunc((hx * sp.speed) / d), nz = z.z + Math.trunc((hz * sp.speed) / d);
      const cx = Math.floor(nx / LEPTONS), cz = Math.floor(nz / LEPTONS);
      if (w.inBounds(cx, cz) && w.passable(w.cellIndex(cx, cz))) {
        z.x = nx;
        z.z = nz;
      } else {
        z.tx = z.x;
        z.tz = z.z;
      }
    }
    // passing through burning ground turns it into a fire whirl
    if (!z.fire) {
      for (const o of this.zones) {
        if (o.alive && o.kind === 'wildfire' && o.age > 9 && dist2(o.x, o.z, z.x, z.z) <= (o.spell.radius + sp.radius) ** 2) {
          z.fire = true;
          w.events.push({ e: 'fireWhirl', zone: z.id });
          break;
        }
      }
    }
    // lift infantry caught in the funnel
    for (const e of this.enemiesNear(z, z.x, z.z, sp.radius)) {
      if (e.liftTicks > 0 || e.frozenTicks > 0 || w.utype(e).category === 'vehicle' || z.hit.includes(e.id)) continue;
      z.hit.push(e.id);
      e.liftTicks = sp.liftTicks;
      e.liftZone = z.id;
      e.kbTicks = 0;
      e.castTicks = 0;
      e.windup = 0;
      e.path = [];
      w.events.push({ e: 'lift', id: e.id, zone: z.id });
    }
    // carry the lifted around the funnel
    for (const e of w.entities) {
      if (!e.alive || e.liftTicks <= 0 || e.liftZone !== z.id) continue;
      const f = (w.tick * 22 + e.id * 53) & 255;
      const r = sp.radius >> 1;
      e.x = z.x + Math.trunc((sinF(f) * r) / TRIG_ONE);
      e.z = z.z + Math.trunc((cosF(f) * r) / TRIG_ONE);
      if (z.fire) this.burn(e, w.content.rules.reactions.fireWhirlDps, BURN_TICKS_FROM_ZONE, z.owner);
      if (--e.liftTicks === 0) this.drop(e, z);
    }
    if (z.age % TICK_HZ === 0) for (const s of this.enemiesNear(z, z.x, z.z, sp.radius, false)) if (s.kind === 'structure') w.damage(s, sp.dps, sp.vs, z.owner, z.caster);
  }
  private drop(e: Entity, z: Zone) {
    e.liftTicks = 0;
    e.liftZone = 0;
    // land on the nearest open cell
    const w = this.w;
    const ci = w.cellIndex(Math.floor(e.x / LEPTONS), Math.floor(e.z / LEPTONS));
    if (!w.passable(ci)) {
      const n = w.pf.nearest(ci, w.passable, 4);
      if (n >= 0) {
        e.x = (n % w.map.cells) * LEPTONS + (LEPTONS >> 1);
        e.z = Math.floor(n / w.map.cells) * LEPTONS + (LEPTONS >> 1);
      }
    }
    w.events.push({ e: 'drop', id: e.id });
    w.damage(e, z.spell.damage, z.spell.vs, z.owner, z.caster);
  }
  /** water / ice put out burning ground they touch */
  private douseAt(x: number, z: number, r: number) {
    for (const o of this.zones) {
      if (!o.alive || o.kind !== 'wildfire') continue;
      if (dist2(o.x, o.z, x, z) <= (o.spell.radius + r) ** 2) {
        o.alive = false;
        this.w.events.push({ e: 'extinguish', zone: o.id, x: o.x, z: o.z, r: o.spell.radius });
      }
    }
  }

  hashInto(mix: (v: number) => void) {
    for (const z of this.zones) {
      if (!z.alive) continue;
      mix(z.id); mix(z.x); mix(z.z); mix(z.age); mix(z.front); mix(z.hit.length); mix(z.fire ? 1 : 0);
    }
  }
}
