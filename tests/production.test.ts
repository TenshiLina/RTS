import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import rules from '../content/rules.json';
import { Content } from '../src/sim/content';
import { World, SimEvent, Entity } from '../src/sim/world';
import { generateSkirmishMap } from '../src/world/skirmishMap';
import { LEPTONS } from '../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);

/** Two built Garrison Camps well apart on open ground, a Qi Shrine, and plenty of jade. */
function base() {
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
  const shrine = spawn('azure_qi_shrine', spots[2]);
  const a = spawn('azure_barracks', spots[0]);
  const b = spawn('azure_barracks', spots[1]);
  w.players[0].jade = 10000;
  const events: SimEvent[] = [];
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      w.step();
      events.push(...w.events);
    }
  };
  return { w, a, b, shrine, events, run };
}
const trained = (ev: SimEvent[]) => ev.filter((e) => e.e === 'trained') as Extract<SimEvent, { e: 'trained' }>[];

describe('production: one queue per building', () => {
  it('spreads orders over both camps, trains in parallel, and each unit leaves its own camp', () => {
    const s = base();
    for (let i = 0; i < 4; i++) s.w.issue(0, { t: 'queue', typeId: 'azure_halberdier' });
    s.run(1);
    expect(s.a.prod.length).toBe(2);
    expect(s.b.prod.length).toBe(2);
    // one halberdier takes 5 s; two camps finish the first pair together
    const t1 = 5 * 15 * 1.6; // generous: low Qi slows production
    s.run(t1);
    const first = trained(s.events);
    expect(first.length).toBeGreaterThanOrEqual(2);
    const near = (u: Entity, f: Entity) => Math.hypot(u.x - f.x, u.z - f.z) < 8 * LEPTONS;
    const units = trained(s.events).map((e) => s.w.get(e.id)!);
    expect(units.some((u) => near(u, s.a))).toBe(true);
    expect(units.some((u) => near(u, s.b))).toBe(true);
    s.run(t1);
    expect(trained(s.events).length).toBe(4);
  });

  it('queues at a chosen camp, and cancelling refunds the most recent order', () => {
    const s = base();
    for (let i = 0; i < 3; i++) s.w.issue(0, { t: 'queue', typeId: 'azure_archer', at: s.b.id });
    s.run(30);
    expect(s.a.prod.length).toBe(0);
    expect(s.b.prod.length).toBe(3);
    const before = s.w.players[0].jade;
    const paidHead = s.b.prod[0].paid;
    expect(paidHead).toBeGreaterThan(0);
    s.w.issue(0, { t: 'cancel', typeId: 'azure_archer' });
    s.run(1);
    // the last order (nothing paid yet) goes; the one in production keeps going
    expect(s.b.prod.length).toBe(2);
    expect(s.b.prod[0].paid).toBeGreaterThan(paidHead - 1);
    expect(s.w.players[0].jade).toBeLessThanOrEqual(before);
    // cancel a specific item: the one in production, refunding what it cost so far
    const head = s.b.prod[0];
    const jade = s.w.players[0].jade;
    s.w.issue(0, { t: 'cancel', typeId: 'azure_archer', at: s.b.id, seq: head.seq });
    s.run(1);
    expect(s.b.prod.includes(head)).toBe(false);
    expect(s.w.players[0].jade).toBeGreaterThanOrEqual(jade + head.paid - 5);
  });

  it('refunds a camp’s queue when the camp is destroyed', () => {
    const s = base();
    for (let i = 0; i < 2; i++) s.w.issue(0, { t: 'queue', typeId: 'azure_halberdier', at: s.a.id });
    s.run(40);
    const paid = s.a.prod.reduce((n, it) => n + it.paid, 0);
    expect(paid).toBeGreaterThan(0);
    const jade = s.w.players[0].jade;
    s.w.issue(0, { t: 'sell', id: s.a.id });
    s.run(1);
    expect(s.w.get(s.a.id)).toBeFalsy();
    // sale refund + production refund
    expect(s.w.players[0].jade).toBeGreaterThanOrEqual(jade + paid);
    expect(s.w.queueView(0, 'infantry').items.length).toBe(0);
  });
});
