// Skirmish AI. Runs inside World.step() and only issues Commands, exactly like a human player,
// so it is deterministic and replay/lockstep-safe.

import { World, PlayerState, Entity } from './world';
import { LEPTONS, TICK_HZ, dist2, sinF, cosF, isqrt, TRIG_ONE } from './intmath';

export type Difficulty = 'easy' | 'normal';

interface AIState {
  waveSize: number;
  firstWaveTick: number;
  nextWaveTick: number;
  attackers: Set<number>;
  infIdx: number;
  deployTries: number;
  lastPowerTick: number;
}

const BUILD_ORDER = [
  'azure_qi_shrine',
  'azure_barracks',
  'azure_jade_refinery',
  'azure_qi_shrine',
  'azure_workshop',
  'azure_arrow_tower',
  'azure_qi_shrine',
  'azure_jade_refinery',
  'azure_arrow_tower',
  'azure_qi_shrine',
  'azure_arrow_tower',
  'azure_barracks',
  'azure_qi_shrine',
  'azure_arrow_tower',
];
const INFANTRY_MIX = ['azure_halberdier', 'azure_halberdier', 'azure_archer', 'azure_halberdier', 'azure_archer', 'azure_daoist'];

export function createSkirmishAI(difficulty: Difficulty = 'easy') {
  const S: AIState = {
    waveSize: difficulty === 'easy' ? 6 : 8,
    firstWaveTick: (difficulty === 'easy' ? 270 : 170) * TICK_HZ,
    nextWaveTick: 0,
    attackers: new Set(),
    infIdx: 0,
    deployTries: 0,
    lastPowerTick: -100000,
  };
  const thinkEvery = difficulty === 'easy' ? TICK_HZ * 2 : TICK_HZ;

  return (w: World, p: PlayerState) => {
    if ((w.tick + p.id * 7) % thinkEvery !== 0) return;
    const yamen = w.structuresOf(p.id).find((s) => s.typeId === 'azure_command_hall');
    const units = w.unitsOf(p.id);

    // 1. deploy the caravan
    if (!yamen) {
      const car = units.find((u) => w.utype(u).deploysInto);
      if (car && car.deployTimer === 0) {
        const t = w.content.structures.get('azure_command_hall')!;
        const cx = Math.round(car.x / LEPTONS - t.footprint[0] / 2), cz = Math.round(car.z / LEPTONS - t.footprint[1] / 2);
        if (w.canPlace(p.id, t.id, cx, cz, true)) w.issue(p.id, { t: 'deploy', id: car.id });
        else if (!car.path.length) {
          // wander to find open ground
          S.deployTries++;
          const f = (S.deployTries * 71) & 255;
          const r = LEPTONS * (2 + (S.deployTries % 4));
          const x = car.x + Math.trunc((sinF(f) * r) / TRIG_ONE);
          const z = car.z + Math.trunc((cosF(f) * r) / TRIG_ONE);
          w.issue(p.id, { t: 'move', ids: [car.id], x, z });
        }
      }
      return;
    }
    const home: [number, number] = [yamen.x, yamen.z];
    const enemies = w.entities.filter((e) => e.alive && (e.kind === 'unit' || e.kind === 'structure') && w.isEnemy(p.id, e.owner));
    const enemyStructs = enemies.filter((e) => e.kind === 'structure' && !w.stype(e).isWall);
    const towardEnemy = enemyStructs.length ? [enemyStructs[0].x, enemyStructs[0].z] : [(w.map.cells * LEPTONS) / 2, (w.map.cells * LEPTONS) / 2];

    const underThreat = enemies.some((e) => e.kind === 'unit' && dist2(e.x, e.z, home[0], home[1]) < (18 * LEPTONS) ** 2);
    // 2. structures: follow the build order (Qi first if low)
    for (const tab of ['structures', 'defense'] as const) {
      const q = p.queues[tab];
      if (q.ready) {
        const spot = findPlacement(w, p.id, q.ready, home, towardEnemy as [number, number]);
        if (spot) w.issue(p.id, { t: 'place', typeId: q.ready, cx: spot[0], cz: spot[1] });
        continue;
      }
      if (q.items.length) continue;
      let next: string | undefined;
      if (tab === 'structures' && (p.lowPower || p.qiProduced - p.qiUsed < 15) && w.canBuild(p.id, 'azure_qi_shrine')) next = 'azure_qi_shrine';
      else next = nextInOrder(w, p, tab);
      // towers wait until the economy (refinery + workshop) is up, unless the base is threatened
      if (tab === 'defense' && next && !w.ownedCount(p.id, 'azure_workshop', false) && !underThreat) next = undefined;
      if (!next && tab === 'defense' && p.jade > 2500 && w.ownedCount(p.id, 'azure_arrow_tower', false) < 6 && w.canBuild(p.id, 'azure_arrow_tower')) next = 'azure_arrow_tower';
      const t = next ? w.content.get(next) : undefined;
      if (!t || t.tab !== tab) continue;
      if (p.jade < Math.min(t.cost, 600)) continue;
      w.issue(p.id, { t: 'queue', typeId: t.id });
    }

    // 3. economy: two oxen per refinery
    const refineries = w.ownedCount(p.id, 'azure_jade_refinery');
    const oxen = units.filter((u) => w.utype(u).harvester).length + p.queues.machines.items.filter((i) => i.typeId === 'azure_wooden_ox').length;
    if (refineries && oxen < refineries * 2 && w.canBuild(p.id, 'azure_wooden_ox') && p.queues.machines.items.length === 0 && p.jade > 900) {
      w.issue(p.id, { t: 'queue', typeId: 'azure_wooden_ox' });
    }

    // 4. infantry
    const reserve = refineries === 0 ? 1400 : !w.ownedCount(p.id, 'azure_workshop', false) ? 900 : 250;
    if (p.queues.infantry.items.length < 2 && p.jade > reserve) {
      const id = INFANTRY_MIX[S.infIdx % INFANTRY_MIX.length];
      if (w.canBuild(p.id, id)) {
        w.issue(p.id, { t: 'queue', typeId: id });
        S.infIdx++;
      } else if (w.canBuild(p.id, 'azure_halberdier')) w.issue(p.id, { t: 'queue', typeId: 'azure_halberdier' });
    }

    // 5. army: defend, then attack in growing waves
    const army = units.filter((u) => w.utype(u).weapon && !w.utype(u).harvester);
    for (const id of [...S.attackers]) if (!w.get(id)) S.attackers.delete(id);
    const defenders = army.filter((u) => !S.attackers.has(u.id));
    const threat = enemies.find((e) => e.kind === 'unit' && dist2(e.x, e.z, home[0], home[1]) < (16 * LEPTONS) ** 2);
    if (threat) {
      for (const u of defenders) if (u.order.type === 'idle' || (u.order.type === 'move' && !u.order.attackMove)) {
        w.issue(p.id, { t: 'move', ids: [u.id], x: threat.x, z: threat.z, attackMove: true });
      }
    } else if (w.tick >= S.firstWaveTick && w.tick >= S.nextWaveTick && defenders.length >= S.waveSize && enemies.length) {
      const target = nearestTo(enemyStructs.length ? enemyStructs : enemies, home);
      if (target) {
        const ids = defenders.map((u) => u.id);
        w.issue(p.id, { t: 'move', ids, x: target.x, z: target.z, attackMove: true });
        ids.forEach((id) => S.attackers.add(id));
        S.waveSize = Math.min(difficulty === 'easy' ? 14 : 20, S.waveSize + 2);
        S.nextWaveTick = w.tick + (difficulty === 'easy' ? 90 : 60) * TICK_HZ;
      }
    }
    // keep attackers pushing: when idle, move on to the next target
    for (const id of S.attackers) {
      const u = w.get(id);
      if (!u || u.order.type !== 'idle' || u.targetId) continue;
      const target = nearestTo(enemyStructs.length ? enemyStructs : enemies, [u.x, u.z]);
      if (target) w.issue(p.id, { t: 'move', ids: [u.id], x: target.x, z: target.z, attackMove: true });
    }

    // 6. Heaven's Wrath on the densest enemy group (or a key structure)
    const pw = w.content.rules.powers[0];
    if (pw && p.powerCharge[pw.id] === 0 && w.mandate(p.id) >= pw.mandateCost && w.tick - S.lastPowerTick > TICK_HZ * 40) {
      let best: Entity | undefined, bestScore = 0;
      for (const e of enemies) {
        if (e.kind !== 'unit' && !(e.kind === 'structure' && ['azure_jade_refinery', 'azure_workshop', 'azure_barracks'].includes(e.typeId))) continue;
        let score = e.kind === 'structure' ? 3 : 0;
        for (const o of enemies) if (o.kind === 'unit' && dist2(o.x, o.z, e.x, e.z) < pw.radius * pw.radius) score++;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (best && bestScore >= 3) {
        w.issue(p.id, { t: 'power', power: pw.id, x: best.x, z: best.z });
        S.lastPowerTick = w.tick;
      }
    }
  };
}

/** First structure in the build order this tab still lacks (stateless → rebuilds losses). */
function nextInOrder(w: World, p: PlayerState, tab: 'structures' | 'defense'): string | undefined {
  const need = new Map<string, number>();
  for (const id of BUILD_ORDER) {
    const n = (need.get(id) ?? 0) + 1;
    need.set(id, n);
    const t = w.content.get(id);
    if (!t) continue;
    const q = p.queues[t.tab];
    const have = w.ownedCount(p.id, id, false) + (q.ready === id ? 1 : 0) + q.items.filter((i) => i.typeId === id).length;
    if (have >= n) continue;
    if (t.tab !== tab) continue;
    return w.canBuild(p.id, id) ? id : undefined;
  }
  return undefined;
}

function nearestTo(list: Entity[], p: [number, number]) {
  let best: Entity | undefined, bd = Infinity;
  for (const e of list) {
    const d = dist2(e.x, e.z, p[0], p[1]);
    if (d < bd || (d === bd && best && e.id < best.id)) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/**
 * Spiral search around the base for a legal spot that leaves a one-cell walkway around the
 * footprint (so the AI never walls itself in). Refineries prefer jade, towers face the enemy.
 */
export function findPlacement(w: World, pid: number, typeId: string, home: [number, number], toward: [number, number]): [number, number] | null {
  const t = w.content.structures.get(typeId)!;
  const [fw, fh] = t.footprint;
  const hx = Math.floor(home[0] / LEPTONS), hz = Math.floor(home[1] / LEPTONS);
  let best: [number, number] | null = null, bestScore = Infinity;
  let jadeNode: Entity | undefined;
  if (t.dock) {
    let bd = Infinity;
    for (const e of w.entities) if (e.alive && e.kind === 'jade' && e.amount > 0) {
      const d = dist2(e.x, e.z, home[0], home[1]);
      if (d < bd) {
        bd = d;
        jadeNode = e;
      }
    }
  }
  const dirX = toward[0] - home[0], dirZ = toward[1] - home[1];
  const dirLen = Math.max(1, isqrt(dirX * dirX + dirZ * dirZ));
  for (let r = 2; r <= 12; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = hx + dx - Math.floor(fw / 2), cz = hz + dz - Math.floor(fh / 2);
      if (!w.canPlace(pid, typeId, cx, cz)) continue;
      // walkway: ring around the footprint must be free of other structures
      let blocked = false;
      for (let z = cz - 1; z <= cz + fh && !blocked; z++) for (let x = cx - 1; x <= cx + fw && !blocked; x++) {
        if (x >= cx && x < cx + fw && z >= cz && z < cz + fh) continue;
        if (!w.inBounds(x, z) || w.occupancy[w.cellIndex(x, z)]) blocked = true;
      }
      if (blocked) continue;
      const px = (cx + fw / 2) * LEPTONS, pz = (cz + fh / 2) * LEPTONS;
      let score = Math.trunc(dist2(px, pz, home[0], home[1]) / (LEPTONS * LEPTONS));
      if (jadeNode) score = Math.trunc((dist2(px, pz, jadeNode.x, jadeNode.z) * 3) / (2 * LEPTONS * LEPTONS)) + Math.trunc((score * 3) / 10);
      if (t.role === 'defense') {
        // prefer ~7 cells out along the enemy direction
        const along = Math.trunc(((px - home[0]) * dirX + (pz - home[1]) * dirZ) / dirLen / LEPTONS);
        score = Math.abs(along - 7) * 30 + Math.trunc(Math.abs(score - 49) / 10);
      }
      if (score < bestScore) {
        bestScore = score;
        best = [cx, cz];
      }
    }
    if (best && t.role !== 'defense' && !jadeNode && r > 4) break;
  }
  return best;
}
