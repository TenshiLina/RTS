// Elemental magic, as the player sees and hears it. Each school has its own visual grammar
// (docs/VFX.md) expressed through the same beats: anticipation at the caster → release →
// travel → impact → linger → dissipate, plus unit statuses and the reactions between schools.
//
//   FIRE   upward tongues, flicker, emissive core → black smoke; scorches and lights the world
//   ICE    straight lines and facets, sudden then still, glints; frosts ground, freezes water
//   WATER  arcs and ribbons, gravity and follow-through, foam; soaks the ground, douses fire
//   AIR    spirals and streaks, colourless — shown by distortion and what it carries; bends trees
//
// Purely cosmetic: reads sim state/events, never writes to the sim. Uses Math.random freely.

import { FX, MODE, TRAIL, Trail, RGBA, Particle } from '../render/particles';
import { MESH, MAT } from '../render/fxMeshes';
import { SCORCH, FROST, WET, HEAT } from '../render/groundFx';
import type { VFX, MeshFx } from './vfx';
import { V3, M4, m4FromTRS, quatAxisAngle, quatMul, Quat } from '../core/math';
import type { World, Entity, SimEvent } from '../sim/world';
import type { Zone } from '../sim/magic';
import { LEPTONS, TICK_HZ } from '../sim/intmath';

export interface MagicHost {
  world: World;
  vfx: VFX;
  time: number;
  h(x: number, z: number): number;
  wx(l: number): number;
  wz(l: number): number;
  /** interpolated position of a unit (metres) + facing (0..256) */
  pos(e: Entity): [number, number, number];
  /** sub-tick interpolation factor 0..1 */
  alpha(): number;
  isWater(x: number, z: number): boolean;
  sfx(name: string, p: V3 | null, volume?: number): void;
}

type School = 'fire' | 'ice' | 'water' | 'air';
const SCHOOL: Record<string, School> = { wildfire: 'fire', glacier: 'ice', surge: 'water', whirlwind: 'air' };

const R = Math.random;
const rr = (a: number, b: number) => a + (b - a) * R();
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOutBack = (t: number) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// school colours (linear-ish; HDR via intensity)
const C = {
  ember: [1, 0.42, 0.1, 1] as RGBA,
  fireLight: [1, 0.48, 0.14] as [number, number, number],
  smoke: [0.14, 0.12, 0.11, 0.62] as RGBA,
  iceLight: [0.45, 0.72, 1] as [number, number, number],
  ice: [0.75, 0.9, 1, 1] as RGBA,
  frostMist: [0.78, 0.88, 1, 0.34] as RGBA,
  water: [0.16, 0.56, 0.66, 1] as RGBA,
  spray: [0.82, 0.93, 0.98, 0.85] as RGBA,
  wind: [0.88, 0.94, 1, 1] as RGBA,
  dust: [0.6, 0.5, 0.37, 0.55] as RGBA,
  leaf: [0.42, 0.62, 0.26, 1] as RGBA,
  steam: [0.92, 0.94, 0.96, 0.5] as RGBA,
};

const Y: V3 = [0, 1, 0];
function quatFromTo(a: V3, b: V3): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.9999) return [0, 0, 0, 1];
  if (d < -0.9999) return quatAxisAngle([1, 0, 0], Math.PI);
  const ax: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const l = Math.hypot(ax[0], ax[1], ax[2]);
  return quatAxisAngle([ax[0] / l, ax[1] / l, ax[2] / l], Math.acos(d));
}
const yawQ = (yaw: number) => quatAxisAngle([0, 1, 0], yaw);
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface ProjFx {
  kind: string;
  hist: V3[];
  trail?: Trail;
  head: V3;
  light?: boolean;
  mesh?: MeshFx;
  phase: number;
  done: boolean;
  src: V3;
}
interface ZoneFx {
  zone: Zone;
  school: School;
  t0: number;
  x: number;
  z: number;
  px: number;
  pz: number;
  tick: number;
  meshes: MeshFx[];
  spikes: { mesh: MeshFx; x: number; z: number; h: number }[];
  doused: boolean;
  ended: boolean;
  fire: boolean;
  lastStamp: number;
  front: number;
  lastSpike?: [number, number];
}
interface UnitFx {
  block?: MeshFx;
  liftT0?: number;
  dropT0?: number;
  dropH?: number;
  frozenAnim?: number;
}

export class MagicFx {
  private projs = new Map<number, ProjFx>();
  private zones = new Map<number, ZoneFx>();
  private units = new Map<number, UnitFx>();
  constructor(private g: MagicHost) {}

  private get v() {
    return this.g.vfx;
  }
  private get ps() {
    return this.g.vfx.ps;
  }
  private get ground() {
    return this.g.vfx.ground;
  }
  private at(lx: number, lz: number, up = 0): V3 {
    const x = this.g.wx(lx), z = this.g.wz(lz);
    return [x, this.g.h(x, z) + up, z];
  }
  private unitAt(e: Entity, up = 0): V3 {
    const [x, z] = this.g.pos(e);
    return [x, this.g.h(x, z) + up, z];
  }

  // ================================================================ events
  /** Returns true when the event was a magic one (the caller skips its generic handling). */
  onEvent(ev: SimEvent): boolean {
    const W = this.g.world;
    switch (ev.e) {
      case 'fire': {
        if (!['fire', 'frost', 'water', 'gale'].includes(ev.kind)) return false;
        const src = W.get(ev.id);
        const base = this.at(ev.x, ev.z);
        const sp: V3 = [base[0], base[1] + (src && src.kind === 'unit' ? 1.35 : 2.2), base[2]];
        this.projs.set(ev.proj, { kind: ev.kind, hist: [], head: sp, phase: R() * 6, done: false, src: sp });
        this.release(ev.kind, sp, this.at(ev.tx, ev.tz, 1));
        return true;
      }
      case 'impact': {
        if (!['fire', 'frost', 'water', 'gale'].includes(ev.kind)) return false;
        const p = this.at(ev.x, ev.z, 0);
        const pf = this.projs.get(ev.proj);
        this.impact(ev.kind, p, pf);
        return true;
      }
      case 'castStart': {
        const u = W.get(ev.id);
        if (u) this.anticipate(SCHOOL[ev.spell], u, ev.ticks / TICK_HZ, this.at(ev.x, ev.z));
        return true;
      }
      case 'spell': {
        const z = W.magic.zones.find((q) => q.id === ev.zone);
        if (z) this.startZone(z);
        return true;
      }
      case 'spike': {
        const zf = this.zones.get(ev.zone);
        if (zf) this.spike(zf, this.at(ev.x, ev.z), ev.i);
        return true;
      }
      case 'zoneEnd': {
        const zf = this.zones.get(ev.zone);
        if (zf) this.endZone(zf);
        return true;
      }
      case 'extinguish': {
        const zf = this.zones.get(ev.zone);
        const p = this.at(ev.x, ev.z);
        this.steamBurst(p, (ev.r / LEPTONS) * 3);
        if (zf) {
          zf.doused = true;
          this.endZone(zf);
        }
        this.ground.clear(HEAT, p[0], p[2], (ev.r / LEPTONS) * 3 + 1.5, 1);
        this.ground.stamp(WET, p[0], p[2], (ev.r / LEPTONS) * 3, 0.7);
        return true;
      }
      case 'fireWhirl': {
        const zf = this.zones.get(ev.zone);
        if (zf) this.igniteWhirl(zf);
        return true;
      }
      case 'freeze': {
        const u = W.get(ev.id);
        if (u) this.freezeUnit(u);
        return true;
      }
      case 'unfreeze':
      case 'thaw': {
        const u = W.byId.get(ev.id);
        if (u) this.releaseUnit(u, ev.e === 'thaw');
        return true;
      }
      case 'douse': {
        const u = W.get(ev.id);
        if (u) this.steamPuff(this.unitAt(u, 1), 0.6);
        return true;
      }
      case 'lift': {
        const st = this.unit(ev.id);
        st.liftT0 = this.g.time;
        st.dropT0 = undefined;
        const u = W.get(ev.id);
        if (u) this.dustPuff(this.unitAt(u, 0.2), 1, 5);
        return true;
      }
      case 'drop': {
        const st = this.unit(ev.id);
        st.dropH = this.liftHeight(st);
        st.liftT0 = undefined;
        st.dropT0 = this.g.time;
        return true;
      }
      case 'shock': {
        const u = W.get(ev.id);
        if (u) this.electrify(this.unitAt(u, 0.9), 0.9, 0.7);
        return true;
      }
    }
    return false;
  }

  private unit(id: number): UnitFx {
    let s = this.units.get(id);
    if (!s) this.units.set(id, (s = {}));
    return s;
  }

  // ================================================================ anticipation (casting)
  private anticipate(school: School, u: Entity, dur: number, target: V3) {
    const p = this.unitAt(u);
    const anchor = { pos: [p[0], p[1], p[2]] as V3 };
    const v = this.v, ps = this.ps;
    switch (school) {
      case 'fire': {
        // hands ignite, flame spirals up the body, heat ring at the feet, the world warms up
        v.light([p[0], p[1] + 1.4, p[2]], C.fireLight, 6, 5, dur + 0.25, { flicker: 0.8, attack: dur });
        this.ground.stamp(HEAT, p[0], p[2], 1.1, 0.45);
        this.ground.stamp(SCORCH, p[0], p[2], 1.3, 0.3);
        v.run(dur, (k) => {
          for (let i = 0; i < 2; i++) {
            ps.spawn({ pos: p, orbit: { anchor, r: 0.85 - k * 0.45, a: R() * 6.28, w: 8, h: rr(0, 0.4), lift: rr(2, 3.2) }, life: 0.45, size: [0.5, 0.16], aspect: 0.5, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.7, 1] });
          }
          if (R() < 0.5) ps.spawn({ pos: [p[0] + rr(-0.5, 0.5), p[1] + 0.3, p[2] + rr(-0.5, 0.5)], vel: [0, rr(1.5, 3), 0], life: rr(0.5, 0.9), size: [0.06, 0.02], color: C.ember, cell: FX.ember, additive: true, intensity: [4, 2] });
          if (R() < 0.4) ps.spawn({ pos: [p[0], p[1] + 1.5, p[2]], vel: [0, 1.5, 0], life: 0.8, size: [0.8, 1.5], color: [1, 1, 1, 0.5], cell: FX.flame, mode: 1, distort: true, distortKind: 1 });
        });
        ps.spawn({ pos: [p[0], p[1] + 0.06, p[2]], life: dur + 0.2, size: [0.6, 1.3], color: [1, 0.4, 0.1, 0.7], cell: FX.glow, additive: true, flat: true, intensity: [0.8, 1.3] });
        this.g.sfx('fire_cast', p);
        break;
      }
      case 'ice': {
        // frost mist creeps in, crystals condense around the raised staff, snow spirals up
        v.light([p[0], p[1] + 2.2, p[2]], C.iceLight, 2.5, 4, dur + 0.2, { attack: dur });
        this.ground.stamp(FROST, p[0], p[2], 1.4, 0.7);
        v.run(dur, (k) => {
          if (R() < 0.7) {
            const a = R() * 6.28, r = rr(1.6, 2.4);
            ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.25, p[2] + Math.sin(a) * r], vel: [-Math.cos(a) * 2, 0.05, -Math.sin(a) * 2], life: 0.9, size: [0.45, 0.8], color: [0.7, 0.82, 0.98, 0.22], cell: FX.steam, drag: 1.5, rot: R() * 6 });
          }
          if (R() < 0.6) ps.spawn({ pos: p, orbit: { anchor: { pos: [p[0] + 0.25, p[1] + 2.1, p[2]] }, r: 1.1 * (1 - k) + 0.1, a: R() * 6.28, w: 4, h: rr(-0.3, 0.3) }, life: 0.35, size: [0.16, 0.09], color: [0.6, 0.85, 1, 1], cell: FX.crystal, additive: true, mode: MODE.twinkle, intensity: [1.5, 2], rot: R() * 6 });
          if (R() < 0.5) ps.spawn({ pos: p, orbit: { anchor, r: 0.9, a: R() * 6.28, w: 3, h: 0.1, lift: 1.8 }, life: 1, size: [0.12, 0.1], color: [1, 1, 1, 1], cell: FX.snowflake, additive: true, intensity: [1.6, 1], vrot: 2 });
        });
        this.g.sfx('ice_cast', p);
        break;
      }
      case 'water': {
        // threads of water rise from the ground and coil around the caster
        for (let n = 0; n < 3; n++) {
          const ph = (n / 3) * Math.PI * 2;
          const pts: V3[] = [];
          for (let i = 0; i < 14; i++) pts.push([...p] as V3);
          const t0 = this.g.time;
          ps.trail({
            pts, width: [0.22, 0.1], color: C.water, color1: [C.water[0], C.water[1], C.water[2], 0.7], intensity: 1, life: dur + 0.15, additive: false, material: TRAIL.water, scroll: 3,
            update: (tr) => {
              const k = clamp((this.g.time - t0) / dur);
              for (let i = 0; i < tr.pts.length; i++) {
                const f = i / (tr.pts.length - 1);
                const hgt = (1 - f) * 2.4 * easeOut(k);
                const a = ph + this.g.time * 5 + f * 5;
                const r = 0.75 - (1 - f) * 0.25;
                tr.pts[i] = [p[0] + Math.cos(a) * r, p[1] + hgt, p[2] + Math.sin(a) * r];
              }
            },
          });
        }
        v.run(dur, () => {
          if (R() < 0.6) ps.spawn({ pos: [p[0] + rr(-0.7, 0.7), p[1] + rr(1, 2.2), p[2] + rr(-0.7, 0.7)], vel: [0, -1, 0], life: 1.2, size: [0.07, 0.07], color: C.spray, cell: FX.droplet, gravity: 9, stretch: 0.05, ground: 'die', onGround: (q) => this.ripple(q.pos, 0.5) });
        });
        this.ripple([p[0], p[1], p[2]], 1.6);
        v.later(dur * 0.5, () => this.ripple([p[0], p[1], p[2]], 2.2));
        this.ground.stamp(WET, p[0], p[2], 1.4, 0.8);
        // draw water up from a nearby pond, if there is one
        const w = this.nearWater(p, 16);
        if (w) this.waterArc(w, [p[0], p[1] + 2.2, p[2]], dur);
        this.g.sfx('water_cast', p);
        break;
      }
      case 'air': {
        // leaves and dust begin to circle, a pale swirl on the ground, nearby trees lean in
        v.gust(p[0], p[2], 7, -0.8, dur + 0.4);
        v.run(dur, () => {
          if (R() < 0.6) ps.spawn({ pos: p, orbit: { anchor, r: rr(1, 1.6), a: R() * 6.28, w: rr(4, 6), h: 0.2, lift: 0.4, dr: -0.3 }, life: 0.9, size: [0.5, 1.2], color: C.dust, cell: FX.dust, rot: R() * 6, vrot: 2 });
          if (R() < 0.5) ps.spawn({ pos: p, orbit: { anchor, r: rr(0.7, 1.5), a: R() * 6.28, w: rr(5, 8), h: rr(0.2, 0.8), lift: 1.6 }, life: 1.1, size: [0.12, 0.12], color: R() < 0.7 ? C.leaf : [1, 0.72, 0.82, 1], cell: R() < 0.7 ? FX.leaf : FX.petal, rot: R() * 6, vrot: 9 });
        });
        ps.spawn({ pos: [p[0], p[1] + 0.07, p[2]], life: dur + 0.3, size: [0.6, 1.9], color: [0.95, 0.97, 1, 0.3], cell: FX.swirl, flat: true, vrot: -6 });
        ps.spawn({ pos: [p[0], p[1] + 1.2, p[2]], life: dur + 0.2, size: [1.2, 1.6], color: [1, 1, 1, 1], cell: FX.swirl, distort: true, vrot: -5, intensity: [1.2, 1.2] });
        this.g.sfx('wind_cast', p);
        break;
      }
    }
    void target;
  }

  // ================================================================ basic attacks
  private release(kind: string, p: V3, target: V3) {
    const ps = this.ps;
    switch (kind) {
      case 'fire':
        ps.spawn({ pos: p, life: 0.18, size: [0.4, 1], color: [1, 0.6, 0.2, 1], cell: FX.glow, additive: true, intensity: [3, 0] });
        this.g.sfx('fire_bolt', p);
        break;
      case 'frost':
        for (let i = 0; i < 6; i++) ps.spawn({ pos: p, vel: [rr(-1, 1), rr(0, 1.5), rr(-1, 1)], life: 0.4, size: [0.1, 0.05], color: C.ice, cell: FX.crystal, additive: true, mode: MODE.twinkle, intensity: [3, 2], rot: R() * 6 });
        this.g.sfx('ice_bolt', p);
        break;
      case 'water':
        this.g.sfx('water_whip', p);
        break;
      case 'gale':
        ps.spawn({ pos: p, life: 0.25, size: [0.4, 1.3], color: [1, 1, 1, 1], cell: FX.shock, distort: true, intensity: [2, 0] });
        this.g.sfx('gale', p);
        break;
    }
    void target;
  }

  /** Called every frame for in-flight magic projectiles. */
  projectile(id: number, p: V3, vel: V3, t: number) {
    const pf = this.projs.get(id);
    if (!pf || pf.done) return;
    const ps = this.ps, v = this.v;
    const dir = norm(vel);
    const side: V3 = norm([dir[2], 0, -dir[0]]);
    switch (pf.kind) {
      case 'fire': {
        // the serpent: an undulating head with a long flickering tail
        const wig = Math.sin(t * Math.PI * 3.2 + pf.phase) * 0.55 * Math.sin(t * Math.PI);
        const head: V3 = [p[0] + side[0] * wig, p[1] + Math.sin(t * Math.PI * 2.2 + pf.phase) * 0.18, p[2] + side[2] * wig];
        pf.head = head;
        this.pushHist(pf, head, 0.22, 16);
        if (!pf.trail) {
          pf.trail = ps.trail({ pts: pf.hist, width: [1.1, 0.12], color: [1, 0.85, 0.7, 1], color1: [1, 0.5, 0.3, 0.35], intensity: 1.35, life: 5, material: TRAIL.flame, scroll: 6, additive: true });
          v.light(head, C.fireLight, 5, 6, 5, { flicker: 0.6, follow: () => (pf.done ? null : pf.head) });
        }
        ps.spawn({ pos: head, life: 0.06, size: [0.55, 0.5], color: [1, 0.6, 0.25, 1], cell: FX.fire, additive: true, intensity: [1.8, 1.4], rot: R() * 6 });
        ps.spawn({ pos: head, vel: [0, 1.2, 0], life: 0.25, size: [0.7, 0.25], aspect: 0.6, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.7, 1.1] });
        ps.spawn({ pos: head, life: 0.05, size: [1.1, 1.1], color: [1, 0.4, 0.1, 0.5], cell: FX.glow, additive: true, intensity: [0.9, 0.9] });
        if (R() < 0.8) ps.spawn({ pos: head, vel: [rr(-0.6, 0.6), rr(0.5, 2), rr(-0.6, 0.6)], life: rr(0.4, 0.8), size: [0.06, 0.02], color: C.ember, cell: FX.ember, additive: true, intensity: [4, 1.5] });
        if (R() < 0.25) ps.spawn({ pos: head, vel: [0, 0.8, 0], life: 1.2, size: [0.3, 0.9], color: C.smoke, cell: FX.smoke, mode: MODE.dissolve, drag: 1, rot: R() * 6 });
        break;
      }
      case 'frost': {
        // a crystal lance, dead straight, shedding glitter and cold mist
        pf.head = p;
        this.pushHist(pf, p, 0.3, 10);
        if (!pf.mesh) {
          pf.mesh = v.mesh(MESH.shard, MAT.ice, [1, 1, 1, 1], 5, (m) => {
            if (pf.done) {
              m.life = 0;
              return;
            }
            const q = quatFromTo(Y, pf.hist.length > 1 ? norm([pf.hist[0][0] - pf.hist[1][0], pf.hist[0][1] - pf.hist[1][1], pf.hist[0][2] - pf.hist[1][2]]) : [0, 0, 1]);
            const d = pf.hist.length > 1 ? norm([pf.hist[0][0] - pf.hist[1][0], pf.hist[0][1] - pf.hist[1][1], pf.hist[0][2] - pf.hist[1][2]]) : ([0, 0, 1] as V3);
            m4FromTRS([pf.head[0] - d[0] * 0.7, pf.head[1] - d[1] * 0.7, pf.head[2] - d[2] * 0.7], quatMul(q, yawQ(this.g.time * 9)), [0.3, 1.35, 0.3], m.matrix);
          });
          pf.trail = ps.trail({ pts: pf.hist, width: [0.55, 0.1], color: C.frostMist, color1: [C.frostMist[0], C.frostMist[1], C.frostMist[2], 0], intensity: 1, life: 5, material: TRAIL.frost, additive: false });
          v.light(p, C.iceLight, 5, 4.5, 5, { follow: () => (pf.done ? null : pf.head) });
        }
        if (R() < 0.9) ps.spawn({ pos: [p[0] + rr(-0.15, 0.15), p[1] + rr(-0.15, 0.15), p[2] + rr(-0.15, 0.15)], vel: [0, -0.3, 0], life: rr(0.3, 0.6), size: [0.1, 0.03], color: C.ice, cell: FX.crystal, additive: true, mode: MODE.twinkle, intensity: [3, 2], rot: R() * 6 });
        if (R() < 0.3) ps.spawn({ pos: p, vel: [0, -0.4, 0], life: 0.8, size: [0.1, 0.08], color: [1, 1, 1, 1], cell: FX.snowflake, additive: true, intensity: [1.5, 0.8], vrot: 3, gravity: 0.5 });
        break;
      }
      case 'water': {
        // a whip: a sinuous tendril from the caster's hand to the tip
        pf.head = p;
        if (!pf.trail) {
          const pts: V3[] = [];
          for (let i = 0; i < 12; i++) pts.push([...pf.src] as V3);
          pf.trail = ps.trail({ pts, width: [0.3, 0.55], color: C.water, color1: [C.water[0] * 0.9, C.water[1], C.water[2], 0.95], intensity: 1, life: 5, material: TRAIL.water, additive: false, scroll: -8 });
        }
        this.layWhip(pf, pf.src, p, this.g.time);
        if (R() < 0.8) ps.spawn({ pos: p, vel: [rr(-1, 1), rr(0, 1.5), rr(-1, 1)], life: 1, size: [0.06, 0.06], color: C.spray, cell: FX.droplet, gravity: 10, stretch: 0.05, ground: 'die' });
        break;
      }
      case 'gale': {
        // a spinning crescent of compressed air: a warp with bright edges, leaves in its wake
        pf.head = p;
        this.pushHist(pf, p, 0.35, 9);
        if (!pf.trail) pf.trail = ps.trail({ pts: pf.hist, width: [1.1, 0.25], color: C.wind, color1: [C.wind[0], C.wind[1], C.wind[2], 0], intensity: 1.3, life: 5, material: TRAIL.wind, additive: true, scroll: 10 });
        const spin = this.g.time * 26;
        ps.spawn({ pos: p, life: 0.04, size: [0.75, 0.75], color: [0.95, 0.98, 1, 0.9], cell: FX.crescent, additive: true, rot: spin, intensity: [1.8, 1.8], soft: false });
        ps.spawn({ pos: p, life: 0.04, size: [1.1, 1.1], color: [1, 1, 1, 1], cell: FX.crescent, distort: true, rot: spin, intensity: [2.5, 2.5] });
        if (R() < 0.35) ps.spawn({ pos: p, vel: [vel[0] * 0.5 + rr(-2, 2), rr(0, 2), vel[2] * 0.5 + rr(-2, 2)], life: rr(0.8, 1.4), size: [0.13, 0.13], color: C.leaf, cell: FX.leaf, drag: 2, gravity: 1.5, rot: R() * 6, vrot: rr(-12, 12) });
        break;
      }
    }
  }
  private pushHist(pf: ProjFx, p: V3, spacing: number, max: number) {
    const h = pf.hist;
    if (!h.length || Math.hypot(p[0] - h[0][0], p[1] - h[0][1], p[2] - h[0][2]) >= spacing) h.unshift([...p] as V3);
    else h[0] = [...p] as V3;
    if (h.length > max) h.length = max;
  }
  /** Lay the whip from `a` (hand) to `b` (tip) with a travelling S-wave. */
  private layWhip(pf: ProjFx, a: V3, b: V3, t: number) {
    const tr = pf.trail!;
    const n = tr.pts.length;
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const side = norm([d[2], 0, -d[0]]);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1); // 0 = tip (head first), 1 = hand
      const s = 1 - f;
      const amp = Math.sin(s * Math.PI) * 0.45;
      const wave = Math.sin(s * 9 - t * 26 + pf.phase) * amp;
      tr.pts[i] = [a[0] + d[0] * s + side[0] * wave, a[1] + d[1] * s + Math.sin(s * Math.PI) * 0.5, a[2] + d[2] * s + side[2] * wave];
    }
  }

  private impact(kind: string, p: V3, pf?: ProjFx) {
    const ps = this.ps, v = this.v;
    if (pf) {
      pf.done = true;
      this.projs.forEach((q, id) => q === pf && this.projs.delete(id));
    }
    switch (kind) {
      case 'fire': {
        const c: V3 = [p[0], p[1] + 0.7, p[2]];
        if (pf?.trail) pf.trail.life = pf.trail.age + 0.25;
        v.light([c[0], c[1] + 0.6, c[2]], C.fireLight, 10, 8, 0.5, { flicker: 0.4, attack: 0.01 });
        ps.spawn({ pos: c, life: 0.2, size: [1, 2.2], color: [1, 0.5, 0.15, 1], cell: FX.glow, additive: true, intensity: [1.4, 0] });
        for (let i = 0; i < 11; i++) {
          const a = R() * 6.28, s = rr(2, 5);
          ps.spawn({ pos: c, vel: [Math.cos(a) * s, rr(1.5, 4), Math.sin(a) * s], life: rr(0.35, 0.55), size: [rr(0.6, 0.9), 0.2], aspect: 0.55, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, drag: 4, intensity: [1.7, 0.9] });
        }
        for (let i = 0; i < 18; i++) {
          const a = R() * 6.28, s = rr(3, 8);
          ps.spawn({ pos: c, vel: [Math.cos(a) * s, rr(2, 7), Math.sin(a) * s], life: rr(0.5, 1.1), size: [0.07, 0.03], color: C.ember, cell: FX.spark, additive: true, stretch: 0.05, gravity: 9, drag: 1, intensity: [4, 1.5] });
        }
        for (let i = 0; i < 4; i++) ps.spawn({ pos: [c[0] + rr(-0.4, 0.4), c[1] + 0.5, c[2] + rr(-0.4, 0.4)], vel: [rr(-0.4, 0.4), rr(1, 2), rr(-0.4, 0.4)], life: rr(1.4, 2.2), size: [0.6, 1.8], color: C.smoke, cell: FX.smoke, mode: MODE.dissolve, drag: 0.8, rot: R() * 6, vrot: rr(-0.5, 0.5), delay: 0.1 });
        ps.spawn({ pos: [p[0], p[1] + 0.1, p[2]], life: 0.35, size: [0.3, 1.7], color: [1, 0.55, 0.2, 1], cell: FX.shock, additive: true, flat: true, intensity: [2.2, 0.2] });
        ps.spawn({ pos: c, life: 0.6, size: [0.8, 1.6], color: [1, 1, 1, 0.7], cell: FX.flame, mode: 1, distort: true, distortKind: 1 });
        this.ground.stamp(SCORCH, p[0], p[2], 1.1, 0.55);
        this.ground.stamp(HEAT, p[0], p[2], 0.9, 0.75);
        this.g.sfx('fire_hit', p);
        break;
      }
      case 'frost': {
        const c: V3 = [p[0], p[1] + 1, p[2]];
        if (pf?.trail) pf.trail.life = pf.trail.age + 0.4;
        this.shatter(c, 9, 0.22, 4.5);
        ps.spawn({ pos: [p[0], p[1] + 0.09, p[2]], life: 1.6, size: [1.5, 1.6], color: [0.75, 0.88, 1, 0.55], color1: [0.75, 0.88, 1, 0], cell: FX.frostburst, flat: true, rot: R() * 6, fadeIn: 0.02 });
        for (let i = 0; i < 2; i++) ps.spawn({ pos: [c[0] + rr(-0.3, 0.3), c[1] - 0.4, c[2] + rr(-0.3, 0.3)], vel: [rr(-1, 1), rr(0.2, 1), rr(-1, 1)], life: rr(0.8, 1.2), size: [0.4, 1], color: [0.85, 0.92, 1, 0.3], cell: FX.steam, drag: 2, rot: R() * 6 });
        for (let i = 0; i < 8; i++) ps.spawn({ pos: c, vel: [rr(-2, 2), rr(0, 2.5), rr(-2, 2)], life: rr(0.5, 0.9), size: [0.12, 0.05], color: C.ice, cell: FX.crystal, additive: true, mode: MODE.twinkle, drag: 2, gravity: 3, intensity: [3, 2], rot: R() * 6 });
        v.light(c, C.iceLight, 3.5, 4, 0.3, { attack: 0.01 });
        this.ground.stamp(FROST, p[0], p[2], 1.2, 0.8);
        this.g.sfx('ice_hit', p);
        break;
      }
      case 'water': {
        const c: V3 = [p[0], p[1] + 0.05, p[2]];
        if (pf?.trail) {
          // the whip snaps back to the hand
          const tr = pf.trail, t0 = this.g.time, tip: V3 = [p[0], p[1] + 1, p[2]];
          tr.life = tr.age + 0.28;
          tr.update = () => {
            const k = clamp((this.g.time - t0) / 0.25);
            const cur: V3 = [tip[0] + (pf.src[0] - tip[0]) * easeOut(k), tip[1] + (pf.src[1] - tip[1]) * easeOut(k), tip[2] + (pf.src[2] - tip[2]) * easeOut(k)];
            this.layWhip(pf, pf.src, cur, this.g.time);
          };
        }
        this.splash(c, 1.2);
        this.ground.stamp(WET, p[0], p[2], 1.2, 0.9);
        this.g.sfx('splash', p, 0.7);
        break;
      }
      case 'gale': {
        const c: V3 = [p[0], p[1] + 1, p[2]];
        if (pf?.trail) pf.trail.life = pf.trail.age + 0.2;
        for (const rot of [0.75, -0.6]) ps.spawn({ pos: c, life: 0.2, size: [1.4, 1.4], aspect: 1, color: [1, 1, 1, 1], cell: FX.streak, additive: true, rot, intensity: [3, 0.5], soft: false });
        ps.spawn({ pos: c, life: 0.3, size: [0.4, 2], color: [1, 1, 1, 1], cell: FX.shock, distort: true, intensity: [2.5, 0] });
        this.dustRing([p[0], p[1] + 0.2, p[2]], 1.4, 12);
        for (let i = 0; i < 5; i++) ps.spawn({ pos: c, vel: [rr(-3, 3), rr(1, 3), rr(-3, 3)], life: rr(1, 1.6), size: [0.13, 0.13], color: C.leaf, cell: FX.leaf, drag: 2, gravity: 1.8, rot: R() * 6, vrot: rr(-12, 12) });
        this.v.gust(p[0], p[2], 4.5, 0.7, 0.5);
        this.g.sfx('gust_hit', p);
        break;
      }
    }
  }

  // ================================================================ spells (zones)
  private startZone(z: Zone) {
    const school = SCHOOL[z.kind];
    const x = this.g.wx(z.x), zz = this.g.wz(z.z);
    const zf: ZoneFx = { zone: z, school, t0: this.g.time, x, z: zz, px: x, pz: zz, tick: this.g.world.tick, meshes: [], spikes: [], doused: false, ended: false, fire: false, lastStamp: 0, front: 0 };
    this.zones.set(z.id, zf);
    const p: V3 = [x, this.g.h(x, zz), zz];
    switch (school) {
      case 'fire': this.wildfireStart(zf, p); break;
      case 'water': this.surgeStart(zf); break;
      case 'air': this.whirlStart(zf, p); break;
      case 'ice': this.g.sfx('ice_cast', p, 0.6); break;
    }
  }
  private endZone(zf: ZoneFx) {
    if (zf.ended) return;
    zf.ended = true;
    const p: V3 = [zf.x, this.g.h(zf.x, zf.z), zf.z];
    if (zf.school === 'ice') {
      // the spikes crack and shatter
      for (const s of zf.spikes) {
        this.shatter([s.x, this.g.h(s.x, s.z) + s.h * 0.5, s.z], 5, 0.35, 3.5);
        s.mesh.life = 0;
      }
      this.snowBurst(p, zf.spikes.length);
      this.g.sfx('ice_shatter', p);
    } else if (zf.school === 'fire' && !zf.doused) {
      this.g.sfx('fire_end', p, 0.5);
    } else if (zf.school === 'air') {
      for (const m of zf.meshes) {
        const m0 = m.update;
        const t0 = this.g.time;
        m.life = m.age + 0.7;
        m.update = (mm, dt) => {
          m0(mm, dt);
          const k = clamp((this.g.time - t0) / 0.7);
          mm.fade = 1 - k;
          for (const i of [0, 1, 2, 8, 9, 10]) mm.matrix[i] *= 1 + k * 0.5;
        };
      }
      for (let i = 0; i < 18; i++) this.ps.spawn({ pos: [zf.x + rr(-2, 2), this.g.h(zf.x, zf.z) + rr(2, 7), zf.z + rr(-2, 2)], vel: [rr(-1, 1), rr(-0.5, 0.5), rr(-1, 1)], life: rr(2.5, 4), size: [0.14, 0.14], color: R() < 0.8 ? C.leaf : [1, 0.72, 0.82, 1], cell: R() < 0.8 ? FX.leaf : FX.petal, drag: 1.5, gravity: 1.2, rot: R() * 6, vrot: rr(-6, 6), ground: 'stick' });
      for (let i = 0; i < 10; i++) this.ps.spawn({ pos: [zf.x + rr(-2, 2), this.g.h(zf.x, zf.z) + rr(0.3, 3), zf.z + rr(-2, 2)], vel: [rr(-1.5, 1.5), rr(-0.5, 0.3), rr(-1.5, 1.5)], life: rr(2, 3), size: [1.2, 2.8], color: [C.dust[0], C.dust[1], C.dust[2], 0.4], cell: FX.dust, drag: 1.2, rot: R() * 6 });
      this.g.sfx('wind_end', p, 0.6);
    }
    this.zones.delete(zf.zone.id);
  }

  // ---------------------------------------------------------------- FIRE: Wildfire
  private wildfireStart(zf: ZoneFx, p: V3) {
    const R0 = (zf.zone.spell.radius / LEPTONS) * 3;
    const ps = this.ps, v = this.v;
    const fuses = 7;
    const angles = Array.from({ length: fuses }, (_, i) => (i / fuses) * Math.PI * 2 + rr(-0.3, 0.3));
    const spread = 0.6;
    // beat 1: fire snakes out of the ground along fuses
    this.g.sfx('fire_rumble', p);
    v.light([p[0], p[1] + 1, p[2]], C.fireLight, 7, R0 + 5, spread + 0.3, { flicker: 1, attack: spread });
    v.run(spread, (k) => {
      for (const a0 of angles) {
        const r = R0 * easeOut(k);
        const a = a0 + Math.sin(k * 7 + a0) * 0.2;
        const x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
        const y = this.g.h(x, z);
        ps.spawn({ pos: [x, y + 0.45, z], vel: [0, 1.5, 0], life: 0.45, size: [0.8, 0.25], aspect: 0.5, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.7, 0.9] });
        if (R() < 0.5) ps.spawn({ pos: [x, y + 0.2, z], vel: [rr(-1, 1), rr(2, 4), rr(-1, 1)], life: 0.6, size: [0.06, 0.03], color: C.ember, cell: FX.ember, additive: true, intensity: [4, 1] });
        this.ground.stamp(HEAT, x, z, 0.55, 1);
        this.ground.stamp(SCORCH, x, z, 0.7, 0.8);
      }
    });
    // beat 2: the ring erupts
    v.later(spread, () => {
      if (zf.doused) return;
      this.g.sfx('fire_erupt', p);
      v.light([p[0], p[1] + 2, p[2]], [1, 0.45, 0.15], 9, R0 * 2 + 4, 0.7, { attack: 0.02 });
      v.flash = Math.max(v.flash, 0.08);
      // a crown of tall, separate tongues at the rim (gaps between them keep the silhouette)
      const n = Math.round(R0 * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rr(-0.12, 0.12);
        const x = p[0] + Math.cos(a) * R0 * rr(0.92, 1.04), z = p[2] + Math.sin(a) * R0 * rr(0.92, 1.04);
        const y = this.g.h(x, z);
        const hgt = rr(1.8, 2.8);
        ps.spawn({ pos: [x, y + hgt * 0.8, z], vel: [Math.cos(a) * 0.6, rr(2.5, 4.5), Math.sin(a) * 0.6], life: rr(0.7, 1.1), size: [hgt, 0.8], aspect: 0.4, color: [1, 0.9, 0.8, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.5, 0.7] });
      }
      // a black mushroom of smoke punches up from the centre
      for (let i = 0; i < 10; i++) ps.spawn({ pos: [p[0] + rr(-1.5, 1.5), p[1] + rr(1, 3), p[2] + rr(-1.5, 1.5)], vel: [rr(-1, 1), rr(3, 6), rr(-1, 1)], life: rr(2.5, 3.5), size: [1.8, 5], color: [0.08, 0.07, 0.065, 0.75], cell: FX.smoke, mode: MODE.dissolve, drag: 1.2, rot: R() * 6, vrot: rr(-0.4, 0.4) });
      for (let i = 0; i < 45; i++) {
        const a = R() * 6.28, r = Math.sqrt(R()) * R0;
        ps.spawn({ pos: [p[0] + Math.cos(a) * r, p[1] + 0.5, p[2] + Math.sin(a) * r], vel: [rr(-2, 2), rr(5, 11), rr(-2, 2)], life: rr(0.8, 1.6), size: [0.08, 0.03], color: C.ember, cell: FX.spark, additive: true, stretch: 0.04, gravity: 6, drag: 0.6, intensity: [4, 1.5] });
      }
      ps.spawn({ pos: [p[0], p[1] + 0.12, p[2]], life: 0.5, size: [R0 * 0.9, R0 * 2.1], color: [1, 0.38, 0.1, 1], cell: FX.shock, additive: true, flat: true, intensity: [0.7, 0.05] });
      ps.spawn({ pos: [p[0], p[1] + 1, p[2]], life: 0.5, size: [R0, R0 * 2.6], color: [1, 1, 1, 1], cell: FX.shock, distort: true, intensity: [3, 0] });
      this.ground.stamp(HEAT, p[0], p[2], R0, 0.8, { rough: 0.5 });
      this.ground.stamp(SCORCH, p[0], p[2], R0 * 1.12, 0.95, { rough: 0.5 });
      // beat 3: it burns — a steady flickering light over the area
      v.light([p[0], p[1] + 2.5, p[2]], C.fireLight, 6, R0 * 1.8 + 4, zf.zone.life / TICK_HZ, { flicker: 1, follow: () => (zf.ended ? null : [p[0], p[1] + 2.5, p[2]]) });
    });
  }
  private wildfireTick(zf: ZoneFx) {
    const R0 = (zf.zone.spell.radius / LEPTONS) * 3;
    const age = this.g.time - zf.t0;
    if (age < 0.6 || zf.doused) return;
    const ps = this.ps;
    const p: V3 = [zf.x, this.g.h(zf.x, zf.z), zf.z];
    const area = R0 * R0;
    const n = Math.min(5, Math.round(area * 0.1));
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, r = R0 * Math.pow(R(), 0.4); // biased to the rim
      const x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
      const y = this.g.h(x, z);
      const hgt = (r > R0 * 0.7 ? rr(1, 1.9) : rr(0.6, 1.2));
      ps.spawn({ pos: [x, y + hgt * 0.75, z], vel: [0, rr(1.2, 2.2), 0], life: rr(0.45, 0.75), size: [hgt, 0.3], aspect: 0.42, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.6, 0.7] });
    }
    if (R() < 0.8) ps.spawn({ pos: [p[0] + rr(-R0, R0) * 0.7, p[1] + 0.5, p[2] + rr(-R0, R0) * 0.7], vel: [rr(-0.5, 0.5), rr(2, 5), rr(-0.5, 0.5)], life: rr(1, 2), size: [0.06, 0.02], color: C.ember, cell: FX.ember, additive: true, intensity: [4, 1] });
    // a column of black smoke — the dark half of fire's value structure, visible from afar
    // (it leans downwind, so from the RTS camera it trails away from the flames instead of hiding under them)
    if (R() < 0.7) ps.spawn({ pos: [p[0] + rr(-R0, R0) * 0.4 + R0 * 0.3, p[1] + rr(3, 4.5), p[2] + rr(-R0, R0) * 0.4 - R0 * 0.3], vel: [rr(1.5, 2.6), rr(2, 3), rr(-1.8, -0.8)], life: rr(4, 5.5), size: [2, 6], color: [0.07, 0.065, 0.06, 0.66], cell: FX.smoke, mode: MODE.dissolve, drag: 0.15, rot: R() * 6, vrot: rr(-0.3, 0.3) });
    if (R() < 0.5) ps.spawn({ pos: [p[0] + rr(-R0, R0) * 0.6, p[1] + 1.5, p[2] + rr(-R0, R0) * 0.6], vel: [0, 1.6, 0], life: 1, size: [1.4, 2.4], color: [1, 1, 1, 0.8], cell: FX.flame, mode: 1, distort: true, distortKind: 1 });
    if (this.g.time - zf.lastStamp > 0.3) {
      zf.lastStamp = this.g.time;
      this.ground.stamp(HEAT, p[0], p[2], R0, 0.7, { rough: 0.6, seed: (this.g.time * 10) | 0 });
    }
  }

  // ---------------------------------------------------------------- ICE: Glacier Spikes
  private spike(zf: ZoneFx, p: V3, i: number) {
    const v = this.v;
    const spikes: [number, number, number, number][] = [[0, 0, rr(3, 4), rr(0.5, 0.65)]];
    for (let k = 0; k < 2; k++) {
      const a = R() * 6.28, r = rr(0.6, 0.95);
      spikes.push([Math.cos(a) * r, Math.sin(a) * r, rr(1.4, 2.3), rr(0.3, 0.42)]);
    }
    for (const [ox, oz, hgt, rad] of spikes) {
      const x = p[0] + ox, z = p[2] + oz;
      const y = this.g.h(x, z) - 0.15;
      const tilt = quatMul(yawQ(R() * 6.28), quatAxisAngle([1, 0, 0], Math.hypot(ox, oz) * 0.35 + rr(0, 0.12)));
      const t0 = this.g.time;
      const mesh = v.mesh(MESH.spike, MAT.ice, [1, 1, 1, 1], 60, (m) => {
        const k = clamp((this.g.time - t0) / 0.13);
        const s = easeOutBack(k);
        m4FromTRS([x, y, z], tilt, [rad * (0.6 + 0.4 * s), hgt * s, rad * (0.6 + 0.4 * s)], m.matrix);
        m.color = [1, 1, 1, Math.max(0, 1 - (this.g.time - t0) * 3)];
      });
      zf.spikes.push({ mesh, x, z, h: hgt });
    }
    // the ground cracks white along the line, water beneath freezes
    this.ground.stamp(FROST, p[0], p[2], 1.4, 0.9, { rough: 0.6 });
    if (zf.lastSpike) this.ground.stampLine(FROST, zf.lastSpike[0], zf.lastSpike[1], p[0], p[2], 0.8, 0.9, { rough: 0.6 });
    zf.lastSpike = [p[0], p[2]];
    this.shatter([p[0], p[1] + 0.4, p[2]], 5, 0.18, 5, true);
    this.ps.spawn({ pos: [p[0] + rr(-0.6, 0.6), p[1] + 0.3, p[2] + rr(-0.6, 0.6)], vel: [rr(-1.5, 1.5), rr(0.5, 1.5), rr(-1.5, 1.5)], life: rr(0.8, 1.3), size: [0.5, 1.3], color: [0.85, 0.92, 1, 0.3], cell: FX.steam, drag: 2, rot: R() * 6 });
    v.light([p[0], p[1] + 1.5, p[2]], C.iceLight, 4, 5, 0.25, { attack: 0.01 });
    this.g.sfx('ice_spike', p, i === 0 ? 1 : 0.55);
  }
  private glacierTick(zf: ZoneFx) {
    if (!zf.spikes.length) return;
    const s = zf.spikes[(R() * zf.spikes.length) | 0];
    const y = this.g.h(s.x, s.z);
    if (R() < 0.35) this.ps.spawn({ pos: [s.x + rr(-0.8, 0.8), y + 0.2, s.z + rr(-0.8, 0.8)], vel: [rr(-0.3, 0.3), 0.05, rr(-0.3, 0.3)], life: rr(1.2, 2), size: [0.5, 1.2], color: [0.72, 0.84, 1, 0.2], cell: FX.steam, drag: 0.5, rot: R() * 6 });
    if (R() < 0.7) this.ps.spawn({ pos: [s.x + rr(-0.2, 0.2), y + rr(0.3, s.h * 0.9), s.z + rr(-0.2, 0.2)], life: 0.35, size: [0.2, 0.05], color: [1, 1, 1, 1], cell: FX.star, additive: true, intensity: [4, 2], rot: R() * 6 });
  }

  // ---------------------------------------------------------------- WATER: Tidal Surge
  private surgeStart(zf: ZoneFx) {
    const sp = zf.zone.spell;
    const dir: V3 = [zf.zone.dx / 1024, 0, zf.zone.dz / 1024];
    const len = (sp.length / LEPTONS) * 3;
    const speed = ((sp.speed * TICK_HZ) / LEPTONS) * 3; // m/s
    const W0 = (sp.width / LEPTONS) * 3;
    const yaw = Math.atan2(dir[0], dir[2]);
    const o: V3 = [zf.x, 0, zf.z];
    const travel = len / speed;
    this.g.sfx('wave', [o[0], this.g.h(o[0], o[2]), o[2]]);
    let prev = 0;
    const m = this.v.mesh(MESH.wave, MAT.water, [0.05, 0.34, 0.42, 1], travel + 0.7, (mm) => {
      const t = mm.age;
      const f = Math.min(len, speed * Math.max(0, t - 0.08));
      zf.front = f;
      const rise = easeOut(clamp(t / 0.3));
      const collapse = clamp((t - travel - 0.05) / 0.55);
      const x = o[0] + dir[0] * f, z = o[2] + dir[2] * f;
      const wdt = W0 * (0.65 + 0.55 * (f / len));
      const hgt = 2.8 * rise * (1 - collapse * 0.95);
      m4FromTRS([x, this.g.h(x, z) - 0.1, z], yawQ(yaw), [wdt, hgt, 3.2 + collapse * 1.5], mm.matrix);
      mm.fade = 1 - collapse * collapse;
      // soak the ground behind the front
      if (f > prev + 0.4) {
        this.ground.stampLine(WET, o[0] + dir[0] * prev, o[2] + dir[2] * prev, x, z, wdt * 0.5, 1, { rough: 0.4 });
        prev = f;
      }
      if (collapse > 0 && !zf.ended) return;
      // spray and foam off the crest, mist, splashes at the base
      const side: V3 = [dir[2], 0, -dir[0]];
      for (let i = 0; i < 6; i++) {
        const u = rr(-0.5, 0.5) * wdt * 0.9;
        const cx = x + side[0] * u + dir[0] * 0.3, cz = z + side[2] * u + dir[2] * 0.3;
        const cy = this.g.h(cx, cz) + hgt * rr(0.85, 1.05);
        this.ps.spawn({ pos: [cx, cy, cz], vel: [dir[0] * rr(3, 6), rr(1.5, 4), dir[2] * rr(3, 6)], life: rr(0.5, 0.9), size: [0.5, 1.2], color: [0.9, 0.96, 1, 0.8], cell: FX.foam, drag: 2, gravity: 4, rot: R() * 6 });
        this.ps.spawn({ pos: [cx, cy, cz], vel: [dir[0] * rr(4, 8) + rr(-1, 1), rr(2, 5), dir[2] * rr(4, 8) + rr(-1, 1)], life: 1.2, size: [0.07, 0.07], color: C.spray, cell: FX.droplet, gravity: 11, stretch: 0.05, ground: 'die' });
      }
      if (R() < 0.5) this.ps.spawn({ pos: [x + side[0] * rr(-0.5, 0.5) * wdt, this.g.h(x, z) + hgt * 0.8, z + side[2] * rr(-0.5, 0.5) * wdt], vel: [dir[0] * 2, 1, dir[2] * 2], life: 1.2, size: [1, 2.6], color: [0.85, 0.93, 0.96, 0.3], cell: FX.steam, drag: 1, rot: R() * 6 });
      if (R() < 0.35) this.splash([x + side[0] * rr(-0.5, 0.5) * wdt + dir[0] * 1.2, this.g.h(x, z), z + side[2] * rr(-0.5, 0.5) * wdt + dir[2] * 1.2], 1.4, true);
      // flecks of foam riding the sheet of water behind the wave
      if (R() < 0.7) {
        const u = rr(-0.5, 0.5) * wdt, back = rr(0.5, 2.5);
        const fx = x + side[0] * u - dir[0] * back, fz = z + side[2] * u - dir[2] * back;
        this.ps.spawn({ pos: [fx, this.g.h(fx, fz) + 0.1, fz], vel: [dir[0] * 2, 0, dir[2] * 2], life: rr(0.9, 1.4), size: [rr(0.5, 0.9), rr(0.8, 1.3)], color: [0.8, 0.92, 0.95, 0.4], color1: [0.8, 0.92, 0.95, 0], cell: FX.foam, flat: true, drag: 1.5, rot: R() * 6, vrot: rr(-0.5, 0.5) });
      }
    });
    zf.meshes.push(m);
    // a sheet of water flowing over the ground from the caster to the wave front
    const sheet: V3[] = [];
    for (let i = 0; i < 12; i++) sheet.push([o[0], this.g.h(o[0], o[2]) + 0.15, o[2]]);
    this.ps.trail({
      pts: sheet, width: [W0 * 0.8, W0 * 0.45], color: [0.1, 0.46, 0.55, 0.75], color1: [0.1, 0.46, 0.55, 0.2], intensity: 1, life: travel + 1.3, fadeOut: 0.45, additive: false, material: TRAIL.water, scroll: 6,
      update: (tr) => {
        const f = zf.front;
        for (let i = 0; i < tr.pts.length; i++) {
          const d = f * (1 - i / (tr.pts.length - 1)); // head (wave front) first
          const px = o[0] + dir[0] * d, pz = o[2] + dir[2] * d;
          tr.pts[i] = [px, this.g.h(px, pz) + 0.15, pz];
        }
      },
    });
    // the wave breaks at the end
    this.v.later(travel + 0.05, () => {
      const x = o[0] + dir[0] * len, z = o[2] + dir[2] * len;
      const y = this.g.h(x, z);
      const side: V3 = [dir[2], 0, -dir[0]];
      for (let i = 0; i < 5; i++) {
        const u = (i / 4 - 0.5) * W0 * 1.1;
        this.splash([x + side[0] * u, y, z + side[2] * u], 2.2);
      }
      for (let i = 0; i < 4; i++) this.v.later(i * 0.25, () => this.ripple([x + rr(-2, 2), y, z + rr(-2, 2)], 3));
      this.g.sfx('splash', [x, y, z], 1);
    });
  }

  // ---------------------------------------------------------------- AIR: Whirlwind
  private whirlStart(zf: ZoneFx, p: V3) {
    const v = this.v;
    // a tall, narrow dust devil (from the RTS camera a wide funnel would read as a fountain)
    const dust = v.mesh(MESH.funnel, MAT.dust, [0.52, 0.42, 0.3, 1], 60, (m) => {
      const k = clamp((this.g.time - zf.t0) / 0.5);
      m4FromTRS([zf.x, this.g.h(zf.x, zf.z) - 0.2, zf.z], yawQ(-this.g.time * 5), [2.1 * easeOut(k), 9.5 * easeOut(k), 2.1 * easeOut(k)], m.matrix);
    });
    const streak = v.mesh(MESH.funnel, MAT.wind, [0.92, 0.95, 1, 1], 60, (m) => {
      const k = clamp((this.g.time - zf.t0) / 0.5);
      m4FromTRS([zf.x, this.g.h(zf.x, zf.z) - 0.2, zf.z], yawQ(-this.g.time * 7), [2.5 * easeOut(k), 10.2 * easeOut(k), 2.5 * easeOut(k)], m.matrix);
    });
    zf.meshes.push(dust, streak);
    v.gust(zf.x, zf.z, 11, -1.5, zf.zone.life / TICK_HZ, () => (zf.ended ? null : [zf.x, zf.z]));
    this.g.sfx('whirl', p);
    void p;
  }
  private whirlTick(zf: ZoneFx) {
    const ps = this.ps;
    const y = this.g.h(zf.x, zf.z);
    const anchor = { pos: [zf.x, y, zf.z] as V3 };
    // share one anchor per frame (moving funnel) — particles follow the zone as it travels
    const a = this.whirlAnchor(zf, anchor);
    // dust skirt thrown out at the base
    for (let i = 0; i < 3; i++) ps.spawn({ pos: a.pos, orbit: { anchor: a, r: rr(1, 1.8), a: R() * 6.28, w: rr(3.5, 5), dr: rr(1, 2.2), h: rr(0, 0.3), lift: rr(0.1, 0.5) }, life: rr(0.9, 1.4), size: [0.9, 2.4], color: C.dust, cell: FX.dust, rot: R() * 6, vrot: 1.5 });
    // debris, leaves and petals climb the funnel
    for (let i = 0; i < 2; i++) {
      const cell = R() < 0.4 ? FX.leaf : R() < 0.5 ? FX.petal : FX.debris;
      ps.spawn({ pos: a.pos, orbit: { anchor: a, r: rr(0.5, 1), a: R() * 6.28, w: rr(6, 9), dr: 0.35, h: rr(0.2, 1), lift: rr(2.5, 4) }, life: rr(1.8, 2.6), size: [cell === FX.debris ? 0.18 : 0.15, 0.15], color: cell === FX.leaf ? C.leaf : [1, 1, 1, 1], cell, rot: R() * 6, vrot: rr(-10, 10) });
    }
    if (R() < 0.4) ps.spawn({ pos: [a.pos[0], a.pos[1] + 0.2, a.pos[2]], life: 0.5, size: [2.2, 3.2], color: [1, 1, 1, 1], cell: FX.swirl, distort: true, vrot: -8, rot: R() * 6, intensity: [1.4, 0.8] });
    if (R() < 0.25) ps.spawn({ pos: [a.pos[0], a.pos[1] + 0.06, a.pos[2]], life: 0.7, size: [1.8, 2.6], color: [0.9, 0.84, 0.72, 0.28], cell: FX.swirl, flat: true, vrot: -7, rot: R() * 6 });
    if (zf.fire) {
      if (R() < 0.8) ps.spawn({ pos: a.pos, orbit: { anchor: a, r: rr(0.6, 1.2), a: R() * 6.28, w: rr(6, 8), dr: 0.25, h: rr(0.2, 1), lift: rr(3, 5) }, life: rr(0.6, 1), size: [rr(0.9, 1.4), 0.3], aspect: 0.45, color: [1, 0.9, 0.8, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.6, 0.8] });
      if (R() < 0.8) ps.spawn({ pos: a.pos, orbit: { anchor: a, r: rr(0.3, 1.5), a: R() * 6.28, w: 7, dr: 0.6, h: 0.5, lift: rr(4, 7) }, life: 1.4, size: [0.07, 0.03], color: C.ember, cell: FX.ember, additive: true, intensity: [4, 1] });
    }
  }
  /** One shared, moving anchor per whirlwind per frame. */
  private anchors = new Map<number, { pos: V3 }>();
  private whirlAnchor(zf: ZoneFx, fresh: { pos: V3 }) {
    let a = this.anchors.get(zf.zone.id);
    if (!a) this.anchors.set(zf.zone.id, (a = fresh));
    a.pos[0] = zf.x;
    a.pos[1] = this.g.h(zf.x, zf.z);
    a.pos[2] = zf.z;
    return a;
  }
  private igniteWhirl(zf: ZoneFx) {
    if (zf.fire) return;
    zf.fire = true;
    // the dust funnel chars to smoke and the wind shell catches fire: a dark column wrapped in
    // spiralling orange tongues (not a glowing blob)
    const [dust, streak] = zf.meshes;
    if (dust) dust.color = [0.16, 0.12, 0.1, 1];
    if (streak) {
      streak.mat = MAT.fire;
      streak.color = [0.75, 0.5, 0.35, 1];
    }
    this.v.light([zf.x, this.g.h(zf.x, zf.z) + 3, zf.z], C.fireLight, 9, 12, zf.zone.life / TICK_HZ, { flicker: 1, follow: () => (zf.ended ? null : [zf.x, this.g.h(zf.x, zf.z) + 3, zf.z]) });
    this.g.sfx('fire_erupt', [zf.x, this.g.h(zf.x, zf.z), zf.z], 0.8);
  }

  // ================================================================ unit statuses
  private freezeUnit(u: Entity) {
    const st = this.unit(u.id);
    const t0 = this.g.time;
    st.frozenAnim = this.g.time;
    if (st.block) st.block.life = 0;
    const yaw = R() * 6.28;
    st.block = this.v.mesh(MESH.block, MAT.ice, [1, 1, 1, 1], 30, (m) => {
      const e = this.g.world.get(u.id);
      if (!e || e.frozenTicks <= 0) {
        m.life = 0;
        return;
      }
      const [x, z] = this.g.pos(e);
      const k = easeOutBack(clamp((this.g.time - t0) / 0.18));
      m4FromTRS([x, this.g.h(x, z) - 0.05, z], yawQ(yaw), [1.05, 2.15 * k, 1.05], m.matrix);
      m.color = [1, 1, 1, Math.max(0, 1 - (this.g.time - t0) * 4)];
    });
    const p = this.unitAt(u, 1);
    for (let i = 0; i < 8; i++) this.ps.spawn({ pos: p, vel: [rr(-2, 2), rr(0, 2), rr(-2, 2)], life: 0.5, size: [0.12, 0.05], color: C.ice, cell: FX.crystal, additive: true, mode: MODE.twinkle, drag: 3, intensity: [3, 2], rot: R() * 6 });
    this.ground.stamp(FROST, p[0], p[2], 1, 0.9);
    this.g.sfx('freeze', p, 0.6);
  }
  private releaseUnit(u: Entity, thaw: boolean) {
    const st = this.unit(u.id);
    if (st.block) st.block.life = 0;
    st.block = undefined;
    st.frozenAnim = undefined;
    const p = this.unitAt(u, 1);
    if (thaw) this.steamPuff(p, 1);
    else {
      this.shatter(p, 8, 0.25, 3.5);
      this.g.sfx('ice_shatter', p, 0.5);
    }
    for (let i = 0; i < 6; i++) this.ps.spawn({ pos: [p[0] + rr(-0.3, 0.3), p[1] + rr(-0.2, 0.6), p[2] + rr(-0.3, 0.3)], vel: [0, -0.5, 0], life: 1, size: [0.06, 0.06], color: C.spray, cell: FX.droplet, gravity: 9, stretch: 0.05, ground: 'die', delay: rr(0, 0.6) });
  }
  private liftHeight(st: UnitFx) {
    if (st.liftT0 === undefined) return 0;
    const t = this.g.time - st.liftT0;
    return 3.2 * easeOut(clamp(t / 0.45)) + 0.35 * Math.sin(t * 6);
  }

  /** Per-unit render state: status channels, extra height, spin, frozen animation time. */
  unitVisual(e: Entity): { status?: [number, number, number, number]; lift: number; spin: number; tilt: number; animFreeze?: number } {
    const st = this.units.get(e.id);
    let lift = 0, spin = 0, tilt = 0;
    if (st) {
      if (st.liftT0 !== undefined) {
        const t = this.g.time - st.liftT0;
        lift = this.liftHeight(st);
        spin = t * 13;
        tilt = 0.5 * clamp(t / 0.4);
      } else if (st.dropT0 !== undefined) {
        const t = this.g.time - st.dropT0;
        const k = clamp(t / 0.3);
        lift = (st.dropH ?? 0) * (1 - k * k);
        tilt = 0.5 * (1 - k);
        if (k >= 1) {
          st.dropT0 = undefined;
          const p = this.unitAt(e, 0.1);
          this.dustPuff(p, 1.2, 6);
          this.ps.spawn({ pos: [p[0], p[1] + 0.02, p[2]], life: 0.35, size: [0.2, 1.4], color: [0.9, 0.8, 0.6, 0.5], cell: FX.shock, flat: true });
          this.g.sfx('thud', p, 0.5);
        }
      }
    }
    const frozen = e.frozenTicks > 0;
    const status: [number, number, number, number] = [frozen ? 1 : e.chillTicks > 0 ? 0.55 : 0, e.wetTicks > 0 ? 1 : 0, e.burnTicks > 0 ? 1 : 0, e.burnTicks > 0 ? 0.25 : 0];
    const any = status[0] + status[1] + status[2] > 0;
    return { status: any ? status : undefined, lift, spin, tilt, animFreeze: frozen ? st?.frozenAnim : undefined };
  }

  // ================================================================ per frame
  update(dt: number) {
    const W = this.g.world;
    // follow zones (interpolated between sim ticks)
    const a = this.g.alpha();
    for (const zf of this.zones.values()) {
      if (W.tick !== zf.tick) {
        zf.tick = W.tick;
        zf.px = zf.x;
        zf.pz = zf.z;
      }
      const tx = this.g.wx(zf.zone.x), tz = this.g.wz(zf.zone.z);
      if (zf.school === 'air') {
        zf.x = zf.px + (tx - zf.px) * a;
        zf.z = zf.pz + (tz - zf.pz) * a;
      }
      if (!zf.zone.alive && !zf.ended) this.endZone(zf);
      if (zf.ended) continue;
      if (zf.school === 'fire') this.wildfireTick(zf);
      else if (zf.school === 'ice') this.glacierTick(zf);
      else if (zf.school === 'air') this.whirlTick(zf);
    }
    for (const id of this.anchors.keys()) if (!this.zones.has(id)) this.anchors.delete(id);
    // unit statuses: flames on the burning, frost breath on the chilled, drips on the wet
    const ps = this.ps;
    const p60 = Math.min(1, dt * 60);
    for (const e of W.entities) {
      if (!e.alive || e.kind !== 'unit') continue;
      if (e.burnTicks > 0 && R() < 0.55 * p60) {
        const p = this.unitAt(e);
        ps.spawn({ pos: [p[0] + rr(-0.25, 0.25), p[1] + rr(0.5, 1.4), p[2] + rr(-0.25, 0.25)], vel: [0, rr(1, 2), 0], life: rr(0.3, 0.5), size: [rr(0.4, 0.6), 0.12], aspect: 0.5, color: [1, 1, 1, 1], cell: FX.flame, mode: MODE.flame, additive: true, intensity: [1.6, 0.8] });
        if (R() < 0.2) ps.spawn({ pos: [p[0], p[1] + 1.8, p[2]], vel: [0, 1.2, 0], life: 1.3, size: [0.3, 1], color: C.smoke, cell: FX.smoke, mode: MODE.dissolve, drag: 0.8, rot: R() * 6 });
      }
      if (e.chillTicks > 0 && e.frozenTicks === 0 && R() < 0.12 * p60) {
        const p = this.unitAt(e);
        ps.spawn({ pos: [p[0] + rr(-0.3, 0.3), p[1] + 0.15, p[2] + rr(-0.3, 0.3)], vel: [rr(-0.2, 0.2), 0.1, rr(-0.2, 0.2)], life: 1, size: [0.3, 0.7], color: C.frostMist, cell: FX.steam, drag: 1, rot: R() * 6 });
        if (R() < 0.5) ps.spawn({ pos: [p[0] + rr(-0.3, 0.3), p[1] + rr(0.6, 1.6), p[2] + rr(-0.3, 0.3)], life: 0.4, size: [0.12, 0.04], color: C.ice, cell: FX.crystal, additive: true, mode: MODE.twinkle, intensity: [3, 2], rot: R() * 6 });
      }
      if (e.wetTicks > 0 && R() < 0.1 * p60) {
        const p = this.unitAt(e);
        ps.spawn({ pos: [p[0] + rr(-0.25, 0.25), p[1] + rr(0.8, 1.3), p[2] + rr(-0.25, 0.25)], vel: [0, -0.4, 0], life: 1, size: [0.05, 0.05], color: C.spray, cell: FX.droplet, gravity: 9, stretch: 0.05, ground: 'die' });
      }
    }
    for (const [id, st] of this.units) {
      if (!W.byId.get(id)?.alive) {
        if (st.block) st.block.life = 0;
        this.units.delete(id);
      }
    }
  }

  // ================================================================ shared pieces
  private shatter(c: V3, n: number, size: number, speed: number, up = false) {
    for (let i = 0; i < n; i++) {
      const vel: V3 = [rr(-1, 1) * speed, (up ? rr(0.8, 1.6) : rr(0.2, 1.2)) * speed, rr(-1, 1) * speed];
      const pos: V3 = [c[0], c[1], c[2]];
      const s = size * rr(0.6, 1.3);
      const spin: V3 = norm([rr(-1, 1), rr(-1, 1), rr(-1, 1)]);
      const w = rr(6, 14);
      let landed = false;
      const life = rr(0.9, 1.5);
      this.v.mesh(MESH.chunk, MAT.ice, [1, 1, 1, 0], life, (m, dt) => {
        if (!landed) {
          vel[1] -= 14 * dt;
          pos[0] += vel[0] * dt;
          pos[1] += vel[1] * dt;
          pos[2] += vel[2] * dt;
          const gy = this.g.h(pos[0], pos[2]) + s * 0.3;
          if (pos[1] < gy) {
            pos[1] = gy;
            if (-vel[1] > 2) {
              vel[1] = -vel[1] * 0.3;
              vel[0] *= 0.5;
              vel[2] *= 0.5;
            } else landed = true;
          }
        }
        const k = m.age / life;
        const sc = s * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
        m4FromTRS(pos, quatAxisAngle(spin, landed ? 1 : m.age * w), [sc, sc * 1.6, sc], m.matrix);
      });
    }
  }
  private snowBurst(p: V3, n: number) {
    for (let i = 0; i < Math.min(14, n); i++) this.ps.spawn({ pos: [p[0] + rr(-3, 3), p[1] + rr(0.3, 2), p[2] + rr(-3, 3)], vel: [rr(-1, 1), rr(0, 1), rr(-1, 1)], life: rr(1, 1.8), size: [0.7, 1.8], color: [0.88, 0.94, 1, 0.3], cell: FX.steam, drag: 1.5, rot: R() * 6 });
  }
  private splash(c: V3, s: number, small = false) {
    const ps = this.ps;
    ps.spawn({ pos: [c[0], c[1] + s * 0.55, c[2]], life: 0.45, size: [s * 0.55, s * 0.85], color: C.spray, cell: FX.splash, fadeIn: 0.02, soft: false });
    if (!small) this.ripple(c, s * 1.4);
    ps.spawn({ pos: [c[0], c[1] + 0.07, c[2]], life: 1.1, size: [s * 0.4, s * 0.8], color: [0.93, 0.97, 1, 0.7], color1: [0.93, 0.97, 1, 0], cell: FX.foam, flat: true, rot: R() * 6 });
    const n = small ? 5 : Math.round(8 + s * 4);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, sp = rr(1, 3.5) * s * 0.7;
      ps.spawn({ pos: [c[0], c[1] + 0.3, c[2]], vel: [Math.cos(a) * sp, rr(3, 6) * Math.min(1.4, s * 0.8), Math.sin(a) * sp], life: 1.4, size: [0.08, 0.08], color: C.spray, cell: FX.droplet, gravity: 12, stretch: 0.05, ground: 'die', onGround: (q: Particle) => R() < 0.3 && this.ripple(q.pos, 0.45) });
    }
  }
  private ripple(c: V3, s: number) {
    const y = this.g.h(c[0], c[2]);
    // soft, bluish and fading fast — never a crisp white circle (that would read as a selection ring)
    this.ps.spawn({ pos: [c[0], y + 0.06, c[2]], life: 0.7, size: [s * 0.25, s], color: [0.7, 0.86, 0.95, 0.32], color1: [0.7, 0.86, 0.95, 0], cell: FX.ripple, flat: true, fadeIn: 0.02 });
  }
  private steamBurst(c: V3, r: number) {
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.28, d = Math.sqrt(R()) * r;
      this.ps.spawn({ pos: [c[0] + Math.cos(a) * d, c[1] + 0.3, c[2] + Math.sin(a) * d], vel: [rr(-0.5, 0.5), rr(2, 4.5), rr(-0.5, 0.5)], life: rr(1.8, 3), size: [0.8, rr(3, 4.5)], color: C.steam, cell: FX.steam, drag: 0.8, rot: R() * 6, vrot: rr(-0.4, 0.4), delay: rr(0, 0.4) });
    }
    this.g.sfx('steam', c);
  }
  private steamPuff(c: V3, s: number) {
    for (let i = 0; i < 6; i++) this.ps.spawn({ pos: [c[0] + rr(-0.3, 0.3), c[1], c[2] + rr(-0.3, 0.3)], vel: [rr(-0.4, 0.4), rr(1, 2.2), rr(-0.4, 0.4)], life: rr(1, 1.6), size: [0.4 * s, 1.6 * s], color: C.steam, cell: FX.steam, drag: 1, rot: R() * 6 });
    this.g.sfx('steam', c, 0.4 * s);
  }
  private dustPuff(c: V3, s: number, n: number) {
    for (let i = 0; i < n; i++) this.ps.spawn({ pos: [c[0] + rr(-0.3, 0.3), c[1], c[2] + rr(-0.3, 0.3)], vel: [rr(-1.5, 1.5) * s, rr(0.3, 1), rr(-1.5, 1.5) * s], life: rr(0.8, 1.3), size: [0.4 * s, 1.4 * s], color: C.dust, cell: FX.dust, drag: 2, rot: R() * 6 });
  }
  private dustRing(c: V3, s: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28;
      this.ps.spawn({ pos: [c[0], c[1], c[2]], vel: [Math.cos(a) * 4 * s, rr(0.2, 0.8), Math.sin(a) * 4 * s], life: rr(0.6, 1), size: [0.4 * s, 1.2 * s], color: C.dust, cell: FX.dust, drag: 3, rot: R() * 6 });
    }
  }
  /** electric arcs crawling over a spot (lightning on wet ground / wet units) */
  electrify(c: V3, r: number, dur: number) {
    for (let i = 0; i < 7; i++) this.ps.spawn({ pos: [c[0] + rr(-r, r), c[1] + rr(-0.4, 0.5), c[2] + rr(-r, r)], life: rr(0.15, dur), size: [rr(0.35, 0.6), 0.3], color: [0.7, 0.85, 1, 1], cell: FX.arc, additive: true, mode: MODE.electric, rot: R() * 6, intensity: [4, 2], delay: rr(0, dur * 0.5) });
  }
  private nearWater(p: V3, maxR: number): V3 | null {
    let best: V3 | null = null, bd = Infinity;
    for (let r = 3; r <= maxR; r += 1.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p[0] + Math.cos(a) * r, z = p[2] + Math.sin(a) * r;
        if (this.g.isWater(x, z) && r < bd) {
          bd = r;
          best = [x, this.g.h(x, z), z];
        }
      }
      if (best) return best;
    }
    return best;
  }
  private waterArc(from: V3, to: V3, dur: number) {
    const t0 = this.g.time;
    const pts: V3[] = [];
    for (let i = 0; i < 16; i++) pts.push([...from] as V3);
    this.ps.trail({
      pts, width: [0.3, 0.2], color: C.water, color1: [C.water[0], C.water[1], C.water[2], 0.8], intensity: 1, life: dur + 0.2, additive: false, material: TRAIL.water, scroll: 10,
      update: (tr) => {
        const k = clamp((this.g.time - t0) / (dur * 0.6));
        for (let i = 0; i < tr.pts.length; i++) {
          const f = (i / (tr.pts.length - 1)) * k; // head first: the stream reaches out from the pond
          const s = k - f;
          tr.pts[i] = [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s + Math.sin(s * Math.PI) * 3, from[2] + (to[2] - from[2]) * s];
        }
      },
    });
    this.splash([from[0], from[1] + 0.2, from[2]], 1.2, true);
  }
}

export type { M4 };
