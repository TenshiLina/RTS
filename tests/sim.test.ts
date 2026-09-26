import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import rules from '../content/rules.json';
import { Content } from '../src/sim/content';
import { World } from '../src/sim/world';
import { createSkirmishAI } from '../src/sim/ai';
import { generateSkirmishMap, BLOCKS_MOVE } from '../src/world/skirmishMap';
import { facingOf, SIN } from '../src/sim/intmath';
import { Pathfinder } from '../src/sim/pathfind';

const map = generateSkirmishMap(11);
const content = new Content(faction, rules);

function aiMatch(ticks: number, seed = 5) {
  const w = new World(content, map, [
    { name: 'North', team: 0, ai: true },
    { name: 'South', team: 1, ai: true },
  ], seed);
  w.controllers[0] = createSkirmishAI('normal');
  w.controllers[1] = createSkirmishAI('normal');
  const hashes: number[] = [];
  const counts = { fire: 0, death: 0, built: 0, unload: 0, power: 0 };
  for (let i = 0; i < ticks; i++) {
    w.step();
    for (const e of w.events) {
      if (e.e === 'fire' || e.e === 'melee') counts.fire++;
      if (e.e === 'death') counts.death++;
      if (e.e === 'built') counts.built++;
      if (e.e === 'unload') counts.unload++;
      if (e.e === 'powerStrike') counts.power++;
    }
    if (i % 300 === 0) hashes.push(w.hash());
  }
  return { w, hashes, counts };
}

describe('integer math', () => {
  it('facing table + atan are consistent', () => {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += SIN[i] * (i + 1);
    expect(sum).toBe(-42720768);
    expect(facingOf(0, 100)).toBe(0);
    expect(facingOf(100, 0)).toBe(64);
    expect(facingOf(0, -100)).toBe(128);
    expect(facingOf(-100, 0)).toBe(192);
    expect(facingOf(100, 100)).toBe(32);
  });
});

describe('skirmish map', () => {
  it('bases are connected by land', () => {
    const pf = new Pathfinder(map.cells, map.cells);
    const s0 = map.starts[0], s1 = map.starts[1];
    const path = pf.find(s0.cz * map.cells + s0.cx, s1.cz * map.cells + s1.cx, (i) => (map.flags[i] & BLOCKS_MOVE) === 0, 100000);
    expect(path).not.toBeNull();
    const last = path![path!.length - 1];
    expect(last).toBe(s1.cz * map.cells + s1.cx);
  });
  it('is point-symmetric', () => {
    const n = map.cells;
    let mismatch = 0;
    for (let i = 0; i < n * n; i++) {
      const j = n * n - 1 - i;
      if ((map.flags[i] & 12) !== (map.flags[j] & 12)) mismatch++; // obstacles + jade
    }
    expect(mismatch).toBe(0);
    expect(map.jade.length).toBeGreaterThan(20);
  });
});

describe('AI vs AI skirmish', () => {
  const ticks = 15 * 60 * 9; // nine minutes
  const a = aiMatch(ticks);
  it('both sides deploy, build a base and harvest', () => {
    for (const p of a.w.players) {
      const structs = a.w.structuresOf(p.id).map((s) => s.typeId);
      expect(structs).toContain('azure_command_hall');
      expect(structs).toContain('azure_jade_refinery');
      expect(structs).toContain('azure_barracks');
      expect(p.stats.harvested).toBeGreaterThan(2000);
      expect(p.mandateMilli).toBeGreaterThan(0);
    }
    expect(a.counts.built).toBeGreaterThan(10);
  });
  it('armies fight', () => {
    expect(a.counts.fire).toBeGreaterThan(50);
    expect(a.counts.death).toBeGreaterThan(5);
  });
  it('is deterministic', () => {
    const b = aiMatch(ticks);
    expect(b.hashes).toEqual(a.hashes);
  });
});
