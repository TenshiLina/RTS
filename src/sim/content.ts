// Content → simulation types. Designers author seconds / cells / per-second rates in JSON;
// this converts them once into integer ticks / leptons so the sim never touches floats.

import { LEPTONS, TICK_HZ } from './intmath';

export type ArmorClass = 'light' | 'medium' | 'heavy' | 'fortified' | 'structure' | 'air' | 'spirit' | 'cavalry';
export type Tab = 'structures' | 'defense' | 'infantry' | 'machines';
export type ProjectileKind = 'none' | 'arrow' | 'talisman';

export interface WeaponType {
  damage: number;
  cooldown: number; // ticks
  range: number; // leptons
  projectile: ProjectileKind;
  projSpeed: number; // leptons / tick
  splash: number; // leptons (0 = single target)
  vs: Record<string, number>; // percent
  windup: number; // ticks between starting the attack and the shot
}

interface Common {
  id: string;
  name: string;
  hanzi: string;
  model: string;
  cost: number;
  buildTicks: number;
  hp: number;
  armor: ArmorClass;
  prereqs: string[];
  tab: Tab;
  description: string;
  weapon?: WeaponType;
  sight: number; // leptons
}

export interface UnitType extends Common {
  kind: 'unit';
  category: 'infantry' | 'vehicle';
  speed: number; // leptons / tick
  turnRate: number; // facing units / tick
  radius: number; // leptons
  producedAt: string[];
  harvester?: { capacity: number; harvestPerSec: number; unloadPerSec: number };
  deploysInto?: string;
  abilities: string[];
}

export interface StructureType extends Common {
  kind: 'structure';
  role: string;
  footprint: [number, number];
  qi: number;
  buildRadius: number; // cells
  mandatePerMin: number;
  harmony?: { adjacentTo: string[]; bonus: Record<string, number> };
  freeUnit?: string;
  exit?: [number, number]; // leptons relative to footprint centre
  dock?: [number, number];
  dragPlace: boolean;
  isWall: boolean;
}

export type EntityType = UnitType | StructureType;

export interface PowerType {
  id: string;
  name: string;
  hanzi: string;
  mandateCost: number; // whole mandate points
  chargeTicks: number;
  delayTicks: number;
  damage: number;
  radius: number; // leptons
  vs: Record<string, number>;
  description: string;
}

export interface Rules {
  startJade: number;
  startUnits: string[];
  jadeSmall: number;
  jadeLarge: number;
  jadeRegrowPerMin: number;
  selfRepairPerSec: number;
  selfRepairDelayTicks: number;
  sellRefundPct: number;
  lowPowerSpeedPct: number;
  harmonyMinPct: number;
  harmonyMaxPct: number;
  maxProductionBonusPct: number;
  buildupTicks: number;
  powers: PowerType[];
}

const sec = (s: number) => Math.max(1, Math.round(s * TICK_HZ));
const cells = (c: number) => Math.round(c * LEPTONS);
/** metres → leptons (cell = 3 m) */
const metres = (m: number) => Math.round((m / 3) * LEPTONS);
const PROJ_SPEED: Record<ProjectileKind, number> = { none: 0, arrow: cells(22) / TICK_HZ, talisman: cells(9) / TICK_HZ };

function weapon(w: any, projectileDefault: ProjectileKind = 'none'): WeaponType {
  const projectile: ProjectileKind = w.projectile ?? projectileDefault;
  const vs: Record<string, number> = {};
  for (const [k, v] of Object.entries(w.vs ?? {})) vs[k] = Math.round((v as number) * 100);
  return {
    damage: Math.round(w.damage),
    cooldown: sec(w.rof ?? 1),
    range: cells(w.range ?? 1),
    projectile,
    projSpeed: Math.round(PROJ_SPEED[projectile]),
    splash: cells(w.splash ?? 0),
    vs,
    windup: projectile === 'none' ? sec(0.35) : sec(0.25),
  };
}

export class Content {
  units = new Map<string, UnitType>();
  structures = new Map<string, StructureType>();
  rules: Rules;
  constructor(faction: any, rules: any) {
    for (const s of faction.structures) {
      if (s.enabled === false) continue; // defined in data, not in the prototype yet
      const t: StructureType = {
        kind: 'structure',
        id: s.id,
        name: s.name,
        hanzi: s.hanzi ?? '',
        model: s.model,
        cost: s.cost,
        buildTicks: sec(s.buildTime || 0.5),
        hp: s.hp,
        armor: s.armor,
        prereqs: s.prereqs ?? [],
        tab: s.sidebarTab,
        description: s.description ?? '',
        weapon: s.weapon ? weapon(s.weapon, 'arrow') : undefined,
        sight: cells(s.sight ?? (s.weapon ? s.weapon.range + 1 : 5)),
        role: s.role,
        footprint: s.footprint,
        qi: s.qi ?? 0,
        buildRadius: s.buildRadius ?? 3,
        mandatePerMin: s.mandatePerMin ?? 0,
        harmony: s.harmony,
        freeUnit: s.freeUnit,
        exit: s.exit ? [metres(s.exit[0]), metres(s.exit[1])] : undefined,
        dock: s.dock ? [metres(s.dock[0]), metres(s.dock[1])] : undefined,
        dragPlace: !!s.dragPlace,
        isWall: s.role === 'wall',
      };
      this.structures.set(t.id, t);
    }
    for (const u of faction.units) {
      if (u.enabled === false) continue;
      const vehicle = u.category === 'vehicle';
      const t: UnitType = {
        kind: 'unit',
        id: u.id,
        name: u.name,
        hanzi: u.hanzi ?? '',
        model: u.model,
        cost: u.cost,
        buildTicks: sec(u.buildTime),
        hp: u.hp,
        armor: u.armor,
        prereqs: u.prereqs ?? [],
        tab: u.sidebarTab,
        description: u.description ?? '',
        weapon: u.weapon ? weapon(u.weapon) : undefined,
        sight: cells(u.sight ?? 5),
        category: u.category,
        speed: Math.max(1, Math.round(cells(u.speed) / TICK_HZ)),
        turnRate: vehicle ? 10 : 32,
        radius: metres(u.radius ?? (vehicle ? 1.6 : 0.55)),
        producedAt: u.producedAt ?? [],
        harvester: u.harvester ? { capacity: u.harvester.capacity, harvestPerSec: u.harvester.harvestRate, unloadPerSec: u.harvester.unloadRate } : undefined,
        deploysInto: (u.abilities ?? []).includes('deploy_to_command_hall') ? 'azure_command_hall' : undefined,
        abilities: u.abilities ?? [],
      };
      this.units.set(t.id, t);
    }
    const r = rules;
    this.rules = {
      startJade: r.start?.jade ?? 5000,
      startUnits: r.start?.units ?? [],
      jadeSmall: r.resources.jade.smallAmount ?? 700,
      jadeLarge: r.resources.jade.largeAmount ?? 1600,
      jadeRegrowPerMin: r.resources.jade.regrowPerMin ?? 30,
      selfRepairPerSec: r.structureDefaults.selfRepairPerSec,
      selfRepairDelayTicks: sec(r.structureDefaults.selfRepairDelay),
      sellRefundPct: Math.round(r.structureDefaults.sellRefund * 100),
      lowPowerSpeedPct: Math.round(r.resources.qi.lowPower.productionSpeed * 100),
      harmonyMinPct: Math.round(r.resources.mandate.harmonyMultiplier.min * 100),
      harmonyMaxPct: Math.round(r.resources.mandate.harmonyMultiplier.max * 100),
      maxProductionBonusPct: Math.round(r.harmony.maxProductionBonus * 100),
      buildupTicks: sec(r.structureDefaults.buildupSeconds ?? 2.4),
      powers: (r.powers ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        hanzi: p.hanzi,
        mandateCost: p.mandateCost,
        chargeTicks: sec(p.chargeSeconds),
        delayTicks: sec(p.delaySeconds),
        damage: p.damage,
        radius: cells(p.radius),
        vs: Object.fromEntries(Object.entries(p.vs ?? {}).map(([k, v]) => [k, Math.round((v as number) * 100)])),
        description: p.description,
      })),
    };
  }
  get(id: string): EntityType | undefined {
    return this.units.get(id) ?? this.structures.get(id);
  }
  all(): EntityType[] {
    return [...this.structures.values(), ...this.units.values()];
  }
}
