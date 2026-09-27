// Probe: a crowded economy — one AI base plus extra oxen on the same refinery — report stalls.
import faction from '../../content/factions/azure_dynasty.json';
import rules from '../../content/rules.json';
import { Content } from '../../src/sim/content';
import { World } from '../../src/sim/world';
import { createSkirmishAI } from '../../src/sim/ai';
import { generateSkirmishMap } from '../../src/world/skirmishMap';
import { TICK_HZ, LEPTONS } from '../../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);
const extra = parseInt(process.argv[2] ?? '5');
let total = 0;
for (const seed of [1, 2, 3]) {
  const w = new World(content, map, [{ name: 'N', team: 0, ai: true }, { name: 'S', team: 1, ai: true }], seed);
  w.controllers[0] = createSkirmishAI('easy');
  w.controllers[1] = undefined as never; // passive opponent
  const last = new Map<number, number>();
  const hist = new Map<number, string[]>();
  const reports: string[] = [];
  let spawned = false;
  const trips = new Map<number, number>();
  for (let i = 0; i < 12 * 60 * TICK_HZ; i++) {
    w.step();
    if (!spawned && w.ownedCount(0, 'azure_jade_refinery') > 0 && w.tick > 150 * TICK_HZ) {
      spawned = true;
      const ref = w.entities.find((e) => e.alive && e.owner === 0 && e.typeId === 'azure_jade_refinery')!;
      for (let k = 0; k < extra; k++) w.spawnUnit('azure_wooden_ox', 0, ref.x + ((k % 3) - 1) * 2 * LEPTONS, ref.z + (3 + Math.floor(k / 3) * 2) * LEPTONS);
    }
    for (const e of w.events) if (e.e === 'unload') {
      if (w.tick - (last.get(e.id) ?? -999) > 30) trips.set(e.id, (trips.get(e.id) ?? 0) + 1);
      last.set(e.id, w.tick);
    }
    for (const u of w.entities) {
      if (!u.alive || u.kind !== 'unit' || u.owner !== 0 || !w.utype(u).harvester) continue;
      if (!last.has(u.id)) last.set(u.id, w.tick);
      if (w.tick % 15 === 0) {
        const h = hist.get(u.id) ?? [];
        h.push(`${(w.tick / TICK_HZ).toFixed(0)}s ${u.hState} (${(u.x / LEPTONS).toFixed(1)},${(u.z / LEPTONS).toFixed(1)}) c${u.cargo} p${u.path.length / 2} st${u.stuck}`);
        if (h.length > 10) h.shift();
        hist.set(u.id, h);
      }
      const idle = (w.tick - last.get(u.id)!) / TICK_HZ;
      if (idle > 120 && !reports.length && process.env.DUMP) {
        const ref = w.entities.find((e) => e.alive && e.owner === 0 && e.typeId === 'azure_jade_refinery')!;
        const [dx, dz] = w.dockPoint(ref);
        console.log(`DUMP t=${(w.tick / TICK_HZ).toFixed(0)} refinery cells ${ref.cx},${ref.cz} ${ref.w}x${ref.h} dock ${(dx / LEPTONS).toFixed(2)},${(dz / LEPTONS).toFixed(2)}`);
        for (const o of w.entities) if (o.alive && o.kind === 'unit' && o.owner === 0 && w.utype(o).harvester) console.log(`  #${o.id} ${o.hState} at ${(o.x / LEPTONS).toFixed(2)},${(o.z / LEPTONS).toFixed(2)} f${o.facing} moving=${o.moving} path=${o.path.map((v) => (v / LEPTONS).toFixed(1)).join(',')} pi=${o.pathI} st${o.stuck} dock=${o.dockId}`);
        for (let z = ref.cz - 3; z < ref.cz + ref.h + 6; z++) {
          let row = '';
          for (let x = ref.cx - 4; x < ref.cx + ref.w + 4; x++) row += !w.inBounds(x, z) ? '#' : w.passable(w.cellIndex(x, z)) ? '.' : 'X';
          console.log('   ' + z.toString().padStart(3) + ' ' + row);
        }
      }
      if (idle > 120 && !reports.some((r) => r.startsWith(`#${u.id} `))) reports.push(`#${u.id} no delivery for ${idle.toFixed(0)}s at t=${(w.tick / TICK_HZ).toFixed(0)}s\n    ` + hist.get(u.id)!.join('\n    '));
    }
  }
  const oxen = w.entities.filter((u) => u.alive && u.kind === 'unit' && u.owner === 0 && w.utype(u).harvester).length;
  console.log(`seed ${seed}: ${oxen} oxen, ${reports.length} stalled, harvested ${w.players[0].stats.harvested}, trips per ox ${[...trips.values()].join(' ')}`);
  for (const r of reports.slice(0, 4)) console.log('  ' + r);
  total += reports.length;
}
console.log('total stalled', total);
