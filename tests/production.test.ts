import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import rules from '../content/rules.json';
import { Content } from '../src/sim/content';
import { World, SimEvent, Entity } from '../src/sim/world';
import { generateSkirmishMap } from '../src/world/skirmishMap';
import { LEPTONS } from '../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);

/** A Qi Shrine and `camps` built Garrison Camps well apart on open ground, plenty of jade. */
function base(camps: number) {
  const w = new World(content, map, [{ name: 'A', team: 0, ai: false }, { name: 'B', team: 1, ai: false }], 3);
  const open = (cx: number, cz: number, fw: number, fh: number) => {
    for (let z = cz; z < cz + fh; z++) for (let x = cx; x < cx + fw; x++) if (!w.inBounds(x, z) || !w.passable(w.cellIndex(x, z))) return false;
    return true;
  };
  const spots: [number, number][] = [];
  for (let r = 0; r < 20 && spots.length < 3; r++) for (let dz = -r; dz <= r && spots.length < 3; dz++) for (let dx = -r; dx <= r && spots.length < 3; dx++) {
    const cx = 20 + dx * 5, cz = 34 + dz * 5;
    if (open(cx - 1, cz - 1, 5, 7) && !spots.some(([x, z]) => Math.abs(x - cx) < 8 && Math.abs(z - cz) < 8)) spots.push([cx, cz]);
  }
  const spawn = (id: string, [cx, cz]: [number, number]) => (w as unknown as { spawnStructure(t: string, o: number, x: number, z: number, b: boolean): Entity }).spawnStructure(id, 0, cx, cz, false);
  spawn('azure_qi_shrine', spots[2]);
  const f: Entity[] = [];
  for (let i = 0; i < camps; i++) f.push(spawn('azure_barracks', spots[i]));
  w.players[0].jade = 10000;
  const events: SimEvent[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      w.step();
      events.push(...w.events);
    }
  };
  const trained = () => events.filter((e) => e.e === 'trained') as Extract<SimEvent, { e: 'trained' }>[];
  return { w, f, events, run, trained };
}
const ticksFor = (camps: number, n: number) => {
  const s = base(camps);
  for (let i = 0; i < n; i++) s.w.issue(0, { t: 'queue', typeId: 'azure_halberdier' });
  let t = 0;
  while (s.trained().length < n && t < 5000) {
    s.run(1);
    t++;
  }
  return t;
};

describe('production: shared queue, primary building', () => {
  it('a second camp speeds up the infantry queue by half', () => {
    const one = ticksFor(1, 4), two = ticksFor(2, 4);
    expect(two / one).toBeGreaterThan(0.6);
    expect(two / one).toBeLessThan(0.72);
  });

  it('units leave the primary camp: the oldest by default, then the one you choose', () => {
    const s = base(2);
    const [A, B] = s.f;
    const near = (id: number, f: Entity) => {
      const u = s.w.get(id)!;
      return Math.hypot(u.x - f.x, u.z - f.z) < 8 * LEPTONS;
    };
    s.w.issue(0, { t: 'queue', typeId: 'azure_halberdier' });
    while (s.trained().length < 1) s.run(1);
    expect(near(s.trained()[0].id, A)).toBe(true);
    expect(s.w.isPrimary(A)).toBe(true);
    s.w.issue(0, { t: 'primary', id: B.id });
    s.w.issue(0, { t: 'queue', typeId: 'azure_archer' });
    s.run(1);
    expect(s.w.isPrimary(B)).toBe(true);
    expect(s.w.isPrimary(A)).toBe(false);
    while (s.trained().length < 2) s.run(1);
    expect(near(s.trained()[1].id, B)).toBe(true);
    // the primary is lost: back to the remaining camp
    s.w.issue(0, { t: 'sell', id: B.id });
    s.w.issue(0, { t: 'queue', typeId: 'azure_halberdier' });
    while (s.trained().length < 3) s.run(1);
    expect(near(s.trained()[2].id, A)).toBe(true);
  });

  it('cancelling refunds what was paid', () => {
    const s = base(1);
    s.w.issue(0, { t: 'queue', typeId: 'azure_archer' });
    s.run(30);
    const paid = s.w.players[0].queues.infantry.items[0].paid;
    expect(paid).toBeGreaterThan(0);
    const jade = s.w.players[0].jade;
    s.w.issue(0, { t: 'cancel', typeId: 'azure_archer' });
    s.run(1);
    expect(s.w.players[0].queues.infantry.items.length).toBe(0);
    expect(s.w.players[0].jade).toBe(jade + paid);
  });
});
