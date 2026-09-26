import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import rules from '../content/rules.json';
import { Content } from '../src/sim/content';
import { World, SimEvent, Entity } from '../src/sim/world';
import { createSkirmishAI } from '../src/sim/ai';
import { generateSkirmishMap } from '../src/world/skirmishMap';
import { LEPTONS } from '../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);
const L = LEPTONS;

/** An open patch of ground away from both bases. */
function openSpot(w: World): [number, number] {
  for (let r = 0; r < 20; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const cx = 20 + dx, cz = 34 + dz;
    let ok = true;
    for (let z = cz - 5; z < cz + 5 && ok; z++) for (let x = cx - 8; x < cx + 8 && ok; x++) ok = w.inBounds(x, z) && w.passable(w.cellIndex(x, z));
    if (ok) return [cx, cz];
  }
  throw new Error('no open ground');
}

/** Staged skirmish: `casters` of one school vs a clump of halberdiers, no AI. */
function stage(casterId: string, casters = 1, foes = 6) {
  const w = new World(content, map, [{ name: 'A', team: 0, ai: false }, { name: 'B', team: 1, ai: false }], 9);
  const [cx, cz] = openSpot(w);
  const mine: Entity[] = [], theirs: Entity[] = [];
  for (let i = 0; i < casters; i++) mine.push(w.spawnUnit(casterId, 0, (cx - 5) * L, (cz + i) * L));
  for (let i = 0; i < foes; i++) theirs.push(w.spawnUnit('azure_halberdier', 1, (cx + 1 + (i % 3) * 0.5) * L, (cz - 1 + Math.floor(i / 3) * 0.6) * L));
  const events: SimEvent[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      w.step();
      events.push(...w.events);
    }
  };
  return { w, mine, theirs, events, run, cx, cz };
}
const count = (ev: SimEvent[], e: string) => ev.filter((x) => x.e === e).length;

describe('elemental schools', () => {
  it('Fire: serpents set targets alight; Wildfire burns an area over time', () => {
    const s = stage('azure_fire_adept', 2);
    s.run(15 * 12);
    expect(count(s.events, 'castStart')).toBeGreaterThan(0);
    expect(s.events.some((e) => e.e === 'spell' && e.spell === 'wildfire')).toBe(true);
    expect(s.theirs.some((u) => u.burnTicks > 0 || !u.alive)).toBe(true);
    expect(s.theirs.filter((u) => u.alive).length).toBeLessThan(6);
  });

  it('Ice: Glacier Spikes erupt in sequence and freeze enemies solid', () => {
    const s = stage('azure_ice_adept', 1);
    s.run(15 * 8);
    const spikes = s.events.filter((e) => e.e === 'spike') as Extract<SimEvent, { e: 'spike' }>[];
    expect(spikes.length).toBeGreaterThanOrEqual(5);
    // sequential: spike indices arrive in order
    expect(spikes.map((e) => e.i)).toEqual([...spikes.map((e) => e.i)].sort((a, b) => a - b));
    expect(count(s.events, 'freeze')).toBeGreaterThan(0);
  });

  it('Water: Tidal Surge knocks enemies back and soaks them', () => {
    const s = stage('azure_water_adept', 1);
    let before: number[] = [];
    for (let i = 0; i < 15 * 6 && !s.events.some((e) => e.e === 'spell' && e.spell === 'surge'); i++) {
      before = s.theirs.map((u) => u.x);
      s.run(1);
    }
    expect(s.events.some((e) => e.e === 'spell' && e.spell === 'surge')).toBe(true);
    s.run(20); // the wave front reaches them and shoves them away from the caster
    const pushed = s.theirs.filter((u, i) => u.alive && u.x > before[i] + L / 2).length;
    expect(pushed).toBeGreaterThan(0);
    expect(s.theirs.some((u) => u.alive && u.wetTicks > 0)).toBe(true);
  });

  it('Air: Whirlwind lifts infantry and drops them for damage', () => {
    const s = stage('azure_air_adept', 1);
    s.run(15 * 8);
    expect(count(s.events, 'lift')).toBeGreaterThan(0);
    expect(count(s.events, 'drop')).toBeGreaterThan(0);
  });

  it('reactions: wet + frost lance freezes; water douses fire; whirlwind through fire becomes a fire whirl', () => {
    // wet target hit by a frost lance freezes instead of chilling
    const a = stage('azure_ice_adept', 1, 1);
    const t = a.theirs[0];
    t.wetTicks = 150;
    a.w.magic.applyOnHit(t, content.units.get('azure_ice_adept')!.weapon!.onHit, 0, t.x - L, t.z);
    expect(t.frozenTicks).toBeGreaterThan(0);
    // fire thaws a frozen unit
    a.w.magic.burn(t, 5, 30, 0);
    expect(t.frozenTicks).toBe(0);

    // wildfire, then a surge through it → extinguish
    const b = stage('azure_fire_adept', 2);
    b.run(15 * 6);
    const fire = b.w.magic.zones.find((z) => z.kind === 'wildfire' && z.alive);
    expect(fire).toBeTruthy();
    const water = b.w.spawnUnit('azure_water_adept', 0, fire!.x - 3 * L, fire!.z);
    b.w.issue(0, { t: 'cast', ids: [water.id], x: fire!.x, z: fire!.z });
    b.run(15 * 4);
    expect(b.events.some((e) => e.e === 'extinguish')).toBe(true);

    // whirlwind through burning ground
    const c = stage('azure_fire_adept', 2);
    c.run(15 * 6);
    const f2 = c.w.magic.zones.find((z) => z.kind === 'wildfire' && z.alive)!;
    const air = c.w.spawnUnit('azure_air_adept', 0, f2.x - 3 * L, f2.z);
    c.w.issue(0, { t: 'cast', ids: [air.id], x: f2.x, z: f2.z });
    c.run(15 * 3);
    expect(c.events.some((e) => e.e === 'fireWhirl')).toBe(true);
  });

  it('reactions: Heaven’s Wrath deals bonus damage to wet units', () => {
    const s = stage('azure_water_adept', 1, 2);
    const [u1, u2] = s.theirs;
    u2.wetTicks = 300;
    u2.x = u1.x;
    u2.z = u1.z;
    u1.hp = u2.hp = 2000;
    const hp = [u1.hp, u2.hp];
    s.w.players[0].mandateMilli = 200000;
    s.w.players[0].powerCharge.heavens_wrath = 0;
    s.w.issue(0, { t: 'power', power: 'heavens_wrath', x: u1.x, z: u1.z });
    s.run(40);
    expect(s.events.some((e) => e.e === 'shock')).toBe(true);
    const d1 = hp[0] - (u1.alive ? u1.hp : 0), d2 = hp[1] - (u2.alive ? u2.hp : 0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('manual cast order walks into range, then casts', () => {
    const s = stage('azure_ice_adept', 1, 0);
    const u = s.mine[0];
    s.w.issue(0, { t: 'cast', ids: [u.id], x: u.x + 12 * L, z: u.z });
    s.run(15 * 5);
    expect(s.events.some((e) => e.e === 'spell' && e.spell === 'glacier')).toBe(true);
    expect(u.spellCd).toBeGreaterThan(0);
  });

  it('AI matches with the Academy stay deterministic and the AI casts spells', () => {
    const play = () => {
      const w = new World(content, map, [{ name: 'N', team: 0, ai: true }, { name: 'S', team: 1, ai: true }], 21);
      w.controllers[0] = createSkirmishAI('normal');
      w.controllers[1] = createSkirmishAI('normal');
      const hashes: number[] = [];
      let spells = 0, academies = 0;
      for (let i = 0; i < 15 * 60 * 16; i++) {
        w.step();
        for (const e of w.events) {
          if (e.e === 'spell') spells++;
          if (e.e === 'built' && e.typeId === 'azure_academy') academies++;
        }
        if (i % 600 === 0) hashes.push(w.hash());
      }
      return { hashes, spells, academies };
    };
    const a = play(), b = play();
    expect(a.hashes).toEqual(b.hashes);
    expect(a.academies).toBeGreaterThan(0);
    expect(a.spells).toBeGreaterThan(0);
  }, 120000);
});
