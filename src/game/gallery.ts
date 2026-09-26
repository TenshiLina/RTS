// Magic Gallery: a staged showcase of the four schools and their reactions, reachable from the
// title screen. Each scene spawns adepts and passive target dummies at its own spot on the map,
// runs the basic attack, then casts the signature spell, while the camera glides between scenes
// at the normal RTS zoom. Client-side staging only (not a multiplayer mode).

import type { Game } from './game';
import type { Entity } from '../sim/world';
import { LEPTONS } from '../sim/intmath';

interface Scene {
  title: string;
  sub: string;
  duration: number;
  setup(a: Arena): void;
  /** timed actions: [time (s), action] */
  cues: [number, (a: Arena) => void][];
}
interface Arena {
  cx: number;
  cz: number;
  casters: Entity[];
  dummies: Entity[];
}

const L = LEPTONS;

export class MagicGallery {
  caption = '';
  sub = '';
  focus: [number, number] = [0, 0];
  private scene = -1;
  private t = 0;
  private fired = 0;
  private arena: Arena | null = null;
  private spots: [number, number][] = [];
  private scenes: Scene[];

  constructor(private g: Game) {
    const W = g.world;
    W.controllers[0] = undefined as never;
    W.controllers[1] = undefined as never;
    // clear the skirmish start forces: the gallery is a stage
    for (const e of W.entities) if (e.kind === 'unit') e.alive = false;
    this.spots = [[20, 34], [34, 22], [40, 40], [26, 46], [44, 30]].map(([x, z]) => this.openSpot(x, z));
    const cast = (i: number) => (a: Arena) => {
      const c = a.casters[i];
      if (!c?.alive) return;
      const [x, z] = this.center(a.dummies);
      W.issue(0, { t: 'cast', ids: [c.id], x, z });
    };
    const attack = (a: Arena) => {
      for (const c of a.casters) {
        const d = a.dummies.find((u) => u.alive);
        if (d && c.alive) W.issue(0, { t: 'attack', ids: [c.id], target: d.id });
      }
    };
    this.scenes = [
      {
        title: '火  FIRE — Fire Serpent · Wildfire 燎原',
        sub: 'Upward tongues and flicker, a white-hot core, black smoke. Scorches the ground and lights up everything around it.',
        duration: 12,
        setup: (a) => this.stage(a, 'azure_fire_adept', 2),
        cues: [[0.5, attack], [3.5, cast(0)]],
      },
      {
        title: '冰  ICE — Frost Lance · Glacier Spikes 冰封',
        sub: 'Straight lines and facets, sudden then still. Frost creeps in crystals, water freezes, enemies are frozen solid, then it shatters.',
        duration: 11,
        setup: (a) => this.stage(a, 'azure_ice_adept', 2),
        cues: [[0.5, attack], [3.2, cast(0)]],
      },
      {
        title: '水  WATER — Water Whip · Tidal Surge 怒涛',
        sub: 'Arcs and ribbons with gravity and follow-through. Soaks the ground, knocks enemies back, puts out fire.',
        duration: 10,
        setup: (a) => this.stage(a, 'azure_water_adept', 2),
        cues: [[0.5, attack], [3.2, cast(0)]],
      },
      {
        title: '风  AIR — Gale Blade · Whirlwind 旋风',
        sub: 'Spirals and streaks — nearly colourless, shown by what it carries and distorts. Bends the trees, lifts whole squads.',
        duration: 11,
        setup: (a) => this.stage(a, 'azure_air_adept', 2),
        cues: [[0.5, attack], [3.2, cast(0)]],
      },
      {
        title: '五行  REACTIONS',
        sub: 'Whirlwind through fire → fire whirl · a wave over burning ground → steam · Heaven’s Wrath on soaked enemies → arcs.',
        duration: 17,
        setup: (a) => {
          this.stage(a, 'azure_fire_adept', 1);
          this.addCaster(a, 'azure_air_adept', 1.4);
          this.addCaster(a, 'azure_water_adept', -1.4);
        },
        cues: [
          [0.8, cast(0)],
          [3.4, cast(1)],
          [7.8, cast(2)],
          [10.5, (a) => {
            const w = a.casters[2];
            if (w?.alive) W.issue(0, { t: 'attack', ids: [w.id], target: a.dummies[0].id });
            for (const d of a.dummies) d.wetTicks = Math.max(d.wetTicks, 150);
          }],
          [12, (a) => {
            const P = W.players[0];
            P.mandateMilli = 200000;
            P.powerCharge.heavens_wrath = 0;
            const [x, z] = this.center(a.dummies);
            W.issue(0, { t: 'power', power: 'heavens_wrath', x, z });
          }],
        ],
      },
    ];
    this.next();
  }

  private openSpot(cx0: number, cz0: number): [number, number] {
    const W = this.g.world;
    for (let r = 0; r < 18; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      let ok = true;
      for (let z = cz - 4; z < cz + 4 && ok; z++) for (let x = cx - 7; x < cx + 5 && ok; x++) ok = W.inBounds(x, z) && W.passable(W.cellIndex(x, z));
      if (ok) return [cx, cz];
    }
    return [cx0, cz0];
  }
  private center(us: Entity[]): [number, number] {
    const alive = us.filter((u) => u.alive);
    const list = alive.length ? alive : us;
    return [Math.round(list.reduce((s, u) => s + u.x, 0) / list.length), Math.round(list.reduce((s, u) => s + u.z, 0) / list.length)];
  }
  private stage(a: Arena, caster: string, n: number) {
    const W = this.g.world;
    for (let i = 0; i < n; i++) a.casters.push(W.spawnUnit(caster, 0, (a.cx - 6) * L, Math.round((a.cz - 0.6 + i * 1.3) * L)));
    for (let i = 0; i < 9; i++) {
      const d = W.spawnUnit('azure_halberdier', 1, Math.round((a.cx + 0.2 + (i % 3) * 0.8) * L), Math.round((a.cz - 1 + Math.floor(i / 3) * 0.8) * L));
      d.hp = d.maxHp = 1500;
      d.facing = 192;
      a.dummies.push(d);
    }
  }
  private addCaster(a: Arena, type: string, dz: number) {
    a.casters.push(this.g.world.spawnUnit(type, 0, (a.cx - 6) * L, Math.round((a.cz + dz) * L)));
  }
  private clear() {
    if (!this.arena) return;
    for (const u of [...this.arena.casters, ...this.arena.dummies]) u.alive = false;
  }
  private next() {
    this.clear();
    this.scene = (this.scene + 1) % this.scenes.length;
    const sc = this.scenes[this.scene];
    const [cx, cz] = this.spots[this.scene % this.spots.length];
    this.arena = { cx, cz, casters: [], dummies: [] };
    sc.setup(this.arena);
    this.caption = sc.title;
    this.sub = sc.sub;
    this.focus = [this.g.wx((cx - 2) * L), this.g.wz(cz * L)];
    this.t = 0;
    this.fired = 0;
  }

  update(dt: number) {
    const sc = this.scenes[this.scene];
    this.t += dt;
    while (this.fired < sc.cues.length && this.t >= sc.cues[this.fired][0]) sc.cues[this.fired++][1](this.arena!);
    // dummies stand still and take it
    for (const d of this.arena!.dummies) {
      if (!d.alive) continue;
      d.targetId = 0;
      d.windup = 0;
      if (d.kbTicks === 0 && d.liftTicks === 0) d.path = [];
      d.order = { type: 'idle' };
    }
    if (this.t >= sc.duration) this.next();
  }
}
