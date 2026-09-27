import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import rules from '../content/rules.json';
import { Content } from '../src/sim/content';
import { World } from '../src/sim/world';
import { createSkirmishAI } from '../src/sim/ai';
import { generateSkirmishMap } from '../src/world/skirmishMap';
import { TICK_HZ, LEPTONS } from '../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);

describe('harvesting', () => {
  it('a crowd of oxen on one refinery keeps delivering (no jams in the dock lane)', () => {
    const w = new World(content, map, [{ name: 'N', team: 0, ai: true }, { name: 'S', team: 1, ai: true }], 1);
    w.controllers[0] = createSkirmishAI('easy');
    w.controllers[1] = undefined as never;
    const last = new Map<number, number>();
    const trips = new Map<number, number>();
    let worstIdle = 0;
    let spawned = false;
    for (let i = 0; i < 8 * 60 * TICK_HZ; i++) {
      w.step();
      if (!spawned && w.tick > 150 * TICK_HZ && w.ownedCount(0, 'azure_jade_refinery') > 0) {
        spawned = true;
        const ref = w.entities.find((e) => e.alive && e.owner === 0 && e.typeId === 'azure_jade_refinery')!;
        for (let k = 0; k < 5; k++) w.spawnUnit('azure_wooden_ox', 0, ref.x + ((k % 3) - 1) * 2 * LEPTONS, ref.z + (3 + Math.floor(k / 3) * 2) * LEPTONS);
      }
      for (const e of w.events) if (e.e === 'unload') {
        if (w.tick - (last.get(e.id) ?? -999) > 30) trips.set(e.id, (trips.get(e.id) ?? 0) + 1);
        last.set(e.id, w.tick);
      }
      for (const u of w.entities) {
        if (!u.alive || u.kind !== 'unit' || u.owner !== 0 || !w.utype(u).harvester) continue;
        if (!last.has(u.id)) last.set(u.id, w.tick);
        worstIdle = Math.max(worstIdle, (w.tick - last.get(u.id)!) / TICK_HZ);
      }
    }
    expect(spawned).toBe(true);
    expect(trips.size).toBeGreaterThanOrEqual(6);
    expect(Math.min(...trips.values())).toBeGreaterThanOrEqual(3);
    // a full round trip takes about a minute; two minutes without delivering means a jam
    expect(worstIdle).toBeLessThan(120);
  }, 120000);
});
