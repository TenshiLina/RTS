// Probe: run AI matches and report harvesters that stop delivering (stuck detection).
import faction from '../../content/factions/azure_dynasty.json';
import rules from '../../content/rules.json';
import { Content } from '../../src/sim/content';
import { World } from '../../src/sim/world';
import { createSkirmishAI } from '../../src/sim/ai';
import { generateSkirmishMap } from '../../src/world/skirmishMap';
import { TICK_HZ, LEPTONS } from '../../src/sim/intmath';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);
const minutes = parseFloat(process.argv[2] ?? '12');
const seeds = (process.argv[3] ?? '1,2,3,4,5').split(',').map(Number);
let worst = 0;
for (const seed of seeds) {
  const w = new World(content, map, [{ name: 'N', team: 0, ai: true }, { name: 'S', team: 1, ai: true }], seed);
  w.controllers[0] = createSkirmishAI('normal');
  w.controllers[1] = createSkirmishAI('normal');
  const last = new Map<number, number>();
  const hist = new Map<number, string[]>();
  const reports: string[] = [];
  for (let i = 0; i < minutes * 60 * TICK_HZ; i++) {
    w.step();
    for (const e of w.events) if (e.e === 'unload') last.set(e.id, w.tick);
    for (const u of w.entities) {
      if (!u.alive || u.kind !== 'unit' || !w.utype(u).harvester) continue;
      if (!last.has(u.id)) last.set(u.id, w.tick);
      if (w.tick % 15 === 0) {
        const h = hist.get(u.id) ?? [];
        h.push(`${(w.tick / TICK_HZ).toFixed(0)}s ${u.hState} (${(u.x / LEPTONS).toFixed(1)},${(u.z / LEPTONS).toFixed(1)}) c${u.cargo} p${u.path.length / 2} st${u.stuck}`);
        if (h.length > 12) h.shift();
        hist.set(u.id, h);
      }
      const idle = (w.tick - last.get(u.id)!) / TICK_HZ;
      if (idle > 75 && !reports.some((r) => r.startsWith(`#${u.id} `))) {
        reports.push(`#${u.id} p${u.owner} no delivery for ${idle.toFixed(0)}s at t=${(w.tick / TICK_HZ).toFixed(0)}s\n    ` + hist.get(u.id)!.join('\n    '));
      }
    }
  }
  const harv = w.entities.filter((u) => u.alive && u.kind === 'unit' && w.utype(u).harvester).length;
  console.log(`seed ${seed}: ${harv} harvesters alive, ${reports.length} stalled, harvested N=${w.players[0].stats.harvested} S=${w.players[1].stats.harvested}`);
  for (const r of reports.slice(0, 3)) console.log('  ' + r);
  worst += reports.length;
}
console.log('total stalled', worst);
