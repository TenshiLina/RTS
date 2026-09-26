import { describe, it, expect } from 'vitest';
import faction from '../content/factions/azure_dynasty.json';
import { RECIPES } from '../tools/assetgen/recipes';

describe('content: azure dynasty tier 1', () => {
  const ids = new Set([...faction.structures, ...faction.units].map((e) => e.id));
  const recipeIds = new Set(RECIPES.map((r) => r.id));
  it('prerequisites and production buildings exist', () => {
    for (const e of [...faction.structures, ...faction.units] as any[]) {
      for (const p of e.prereqs ?? []) expect(ids.has(p), `${e.id} prereq ${p}`).toBe(true);
      for (const p of e.producedAt ?? []) expect(ids.has(p), `${e.id} producedAt ${p}`).toBe(true);
    }
  });
  it('every entry either has a model or is flagged for the next asset batch', () => {
    for (const e of [...faction.structures, ...faction.units] as any[]) {
      const pending = /next asset batch/.test(e.description);
      expect(recipeIds.has(e.model) || pending, `${e.id} model ${e.model}`).toBe(true);
    }
  });
  it('structure footprints match their recipes', () => {
    for (const s of faction.structures as any[]) {
      const r = RECIPES.find((x) => x.id === s.model);
      if (r) expect(r.footprint, s.id).toEqual(s.footprint);
    }
  });
  it('the tier-1 base is power-positive with one shrine per two consumers', () => {
    const qi = (id: string) => (faction.structures as any[]).find((s) => s.id === id)!.qi;
    const core = qi('azure_command_hall') + 2 * qi('azure_qi_shrine') + qi('azure_barracks') + qi('azure_jade_refinery') + qi('azure_workshop') + 2 * qi('azure_arrow_tower');
    expect(core).toBeGreaterThan(0);
  });
});
