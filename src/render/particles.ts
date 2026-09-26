// Cosmetic particle system (not part of the deterministic sim). CPU-simulated, drawn as
// camera-facing / velocity-stretched / ground-flat quads plus lightning ribbons, in two
// pipelines: alpha (smoke, dust) and additive (fire, magic, sparks, lightning).

import type { Device, Pipeline, Buffer, RenderPass, BindGroup, Texture, Sampler } from './rhi/types';
import { SHADERS } from './shaders';
import type { Renderer } from './renderer';
import { V3, M4, hash2, fbm3 } from '../core/math';

export const FX = {
  glow: 0, spark: 1, smoke: 2, ring: 3, star: 4, talisman: 5, beam: 6, fire: 7, petal: 8, debris: 9, shock: 10, arrow: 11, rune: 12,
} as const;
export type FxCell = (typeof FX)[keyof typeof FX];

export interface ParticleSpec {
  pos: V3;
  vel?: V3;
  life: number;
  size: [number, number];
  color: [number, number, number, number];
  color1?: [number, number, number, number];
  intensity?: [number, number];
  cell: FxCell;
  additive?: boolean;
  gravity?: number;
  drag?: number;
  rot?: number;
  vrot?: number;
  /** stretch along velocity (screen-space streaks) */
  stretch?: number;
  /** lie flat on the ground (rings, scorch marks) */
  flat?: boolean;
  delay?: number;
}

interface Particle extends Required<Omit<ParticleSpec, 'color1' | 'delay'>> {
  color1: [number, number, number, number];
  age: number;
  vel: V3;
}

interface Ribbon {
  pts: V3[];
  width: number;
  color: [number, number, number];
  intensity: number;
  age: number;
  life: number;
  additive: boolean;
}

const STRIDE = 28; // pos 3f, uv 2f, color 4u8, intensity 1f
const CELLS = 4;

function buildAtlas(size = 512): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const cs = size / CELLS;
  const put = (cell: number, fn: (u: number, v: number) => [number, number, number, number]) => {
    const ox = (cell % CELLS) * cs, oy = Math.floor(cell / CELLS) * cs;
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const u = (x + 0.5) / cs * 2 - 1, v = (y + 0.5) / cs * 2 - 1;
      const [r, g, b, a] = fn(u, v);
      const i = ((oy + y) * size + ox + x) * 4;
      px[i] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      px[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      px[i + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      px[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  };
  const edge = (u: number, v: number) => Math.max(0, 1 - Math.max(Math.abs(u), Math.abs(v)) * 1.02) > 0 ? 1 : 0;
  put(FX.glow, (u, v) => { const d = Math.hypot(u, v); const a = Math.exp(-d * d * 4.5) * (d < 1 ? 1 : 0); return [1, 1, 1, a]; });
  put(FX.spark, (u, v) => { const a = Math.exp(-u * u * 30) * Math.max(0, 1 - Math.abs(v)) ** 1.5; return [1, 1, 1, a]; });
  put(FX.smoke, (u, v) => {
    const d = Math.hypot(u, v);
    const n = fbm3(u * 2.2 + 3, v * 2.2, 0.5, 4, 2);
    const a = Math.max(0, 1 - d * (1.05 - n * 0.5)) ** 1.6 * (0.55 + n * 0.6);
    return [0.9 + n * 0.1, 0.9 + n * 0.1, 0.9 + n * 0.1, a * edge(u, v)];
  });
  put(FX.ring, (u, v) => { const d = Math.hypot(u, v); const a = Math.exp(-((d - 0.82) ** 2) * 400); return [1, 1, 1, a]; });
  put(FX.star, (u, v) => {
    const d = Math.hypot(u, v);
    const cross = Math.exp(-Math.abs(u) * 18) * Math.max(0, 1 - Math.abs(v)) + Math.exp(-Math.abs(v) * 18) * Math.max(0, 1 - Math.abs(u));
    return [1, 1, 1, Math.min(1, cross * 0.9 + Math.exp(-d * d * 12))];
  });
  put(FX.talisman, (u, v) => {
    const inside = Math.abs(u) < 0.42 && Math.abs(v) < 0.92;
    if (!inside) return [0, 0, 0, 0];
    const border = Math.abs(u) > 0.34 || Math.abs(v) > 0.84;
    // red "glyph" strokes
    const stroke = (Math.abs(u) < 0.06 && Math.abs(v) < 0.6) || (Math.abs(v + 0.3) < 0.05 && Math.abs(u) < 0.25) || (Math.abs(v - 0.2) < 0.05 && Math.abs(u) < 0.2) || Math.abs(Math.hypot(u, v - 0.55) - 0.14) < 0.035;
    if (stroke) return [0.85, 0.12, 0.08, 1];
    return border ? [0.95, 0.72, 0.2, 1] : [1, 0.9, 0.45, 1];
  });
  put(FX.beam, (u) => { const a = Math.exp(-u * u * 10) + Math.exp(-u * u * 90) * 0.8; return [1, 1, 1, Math.min(1, a)]; });
  put(FX.fire, (u, v) => {
    const n = fbm3(u * 3, v * 3 + 7, 1.3, 4, 5);
    const d = Math.hypot(u, v * 0.85 + 0.15);
    const a = Math.max(0, 1 - d * (1.2 - n * 0.7)) ** 1.3;
    return [1, 0.75 + n * 0.25, 0.4 + n * 0.3, a];
  });
  put(FX.petal, (u, v) => { const d = Math.hypot(u * 1.8, v); return [1, 0.72, 0.82, d < 0.8 ? 1 - d * 0.3 : 0]; });
  put(FX.debris, (u, v) => { const r = hash2(Math.floor((u + 1) * 3), Math.floor((v + 1) * 3), 4); return [0.35 + r * 0.2, 0.28 + r * 0.15, 0.2, Math.hypot(u, v) < 0.7 ? 1 : 0]; });
  put(FX.shock, (u, v) => { const d = Math.hypot(u, v); const a = Math.exp(-((d - 0.75) ** 2) * 60) * (d < 1 ? 1 : 0); return [1, 1, 1, a]; });
  put(FX.arrow, (u, v) => {
    const shaft = Math.abs(u) < 0.05 && v > -0.9 && v < 0.6;
    const head = v >= 0.6 && v < 0.95 && Math.abs(u) < (0.95 - v) * 0.5;
    const flet = v < -0.6 && v > -0.95 && Math.abs(u) < 0.18;
    if (head) return [0.8, 0.82, 0.85, 1];
    if (flet) return [0.95, 0.95, 0.9, 1];
    return shaft ? [0.5, 0.36, 0.22, 1] : [0, 0, 0, 0];
  });
  put(FX.rune, (u, v) => {
    const d = Math.hypot(u, v);
    const ang = Math.atan2(v, u);
    const ring = Math.exp(-((d - 0.85) ** 2) * 500) + Math.exp(-((d - 0.62) ** 2) * 700);
    const spokes = d > 0.62 && d < 0.85 ? Math.exp(-((Math.sin(ang * 4) ** 2)) * 60) * 0.9 : 0;
    const tri = Math.abs(Math.cos(ang * 1.5) * d * 1.6 - 0.45) < 0.03 && d < 0.62 ? 1 : 0;
    return [1, 1, 1, Math.min(1, ring + spokes + tri)];
  });
  return px;
}

export class ParticleSystem {
  particles: Particle[] = [];
  ribbons: Ribbon[] = [];
  private pending: (ParticleSpec & { delay: number })[] = [];
  private atlas: Texture;
  private sampler: Sampler;
  private pAlpha: Pipeline;
  private pAdd: Pipeline;
  private buf: Buffer;
  private cap = 8192 * 6;
  private data = new ArrayBuffer(this.cap * STRIDE);
  private f32 = new Float32Array(this.data);
  private u8 = new Uint8Array(this.data);
  private nAlpha = 0;
  private nAdd = 0;
  maxParticles = 6000;

  constructor(private device: Device, renderer: Renderer) {
    this.atlas = device.createTexture({ width: 512, height: 512, format: 'rgba8unorm', data: buildAtlas(512), mipmaps: true, label: 'fx-atlas' });
    this.sampler = device.createSampler({ filter: 'linear', mipmaps: true, wrap: 'clamp' });
    const desc = (additive: boolean) => ({
      label: additive ? 'particles-add' : 'particles-alpha',
      shader: { label: 'particles', vertex: SHADERS.particleVert, fragment: SHADERS.particleFrag, defines: { ADDITIVE: additive } as Record<string, boolean> },
      vertexBuffers: [{
        arrayStride: STRIDE,
        attributes: [
          { location: 0, format: 'float32x3' as const, offset: 0 },
          { location: 1, format: 'float32x2' as const, offset: 12 },
          { location: 2, format: 'unorm8x4' as const, offset: 20 },
          { location: 3, format: 'float32' as const, offset: 24 },
        ],
      }],
      bindGroups: [{ entries: [{ binding: 0, kind: 'uniform' as const, name: 'FrameUniforms' }] }, { entries: [{ binding: 0, kind: 'texture' as const, name: 'uAtlas' }] }],
      colorFormats: [renderer.hdrColorFormat],
      depthFormat: 'depth24' as const,
      sampleCount: renderer.sampleCount,
      blend: 'premultiplied' as const,
      depthWrite: false,
      depthCompare: 'lequal' as const,
      cullMode: 'none' as const,
    });
    this.pAlpha = device.createPipeline(desc(false));
    this.pAdd = device.createPipeline(desc(true));
    this.buf = device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'particles' });
  }

  spawn(s: ParticleSpec) {
    if (s.delay && s.delay > 0) {
      this.pending.push({ ...s, delay: s.delay });
      return;
    }
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push({
      pos: [...s.pos] as V3,
      vel: s.vel ? ([...s.vel] as V3) : [0, 0, 0],
      life: s.life,
      size: s.size,
      color: s.color,
      color1: s.color1 ?? [s.color[0], s.color[1], s.color[2], 0],
      intensity: s.intensity ?? [1, 1],
      cell: s.cell,
      additive: s.additive ?? false,
      gravity: s.gravity ?? 0,
      drag: s.drag ?? 0,
      rot: s.rot ?? 0,
      vrot: s.vrot ?? 0,
      stretch: s.stretch ?? 0,
      flat: s.flat ?? false,
      age: 0,
    });
  }
  ribbon(pts: V3[], width: number, color: [number, number, number], intensity: number, life: number, additive = true) {
    this.ribbons.push({ pts, width, color, intensity, age: 0, life, additive });
  }
  get count() {
    return this.particles.length;
  }

  update(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this.pending.splice(i, 1);
        this.spawn({ ...p, delay: 0 });
      }
    }
    const ps = this.particles;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vel[0] *= damp;
      p.vel[1] = p.vel[1] * damp - p.gravity * dt;
      p.vel[2] *= damp;
      p.pos[0] += p.vel[0] * dt;
      p.pos[1] += p.vel[1] * dt;
      p.pos[2] += p.vel[2] * dt;
      p.rot += p.vrot * dt;
      ps[w++] = p;
    }
    ps.length = w;
    this.ribbons = this.ribbons.filter((r) => (r.age += dt) < r.life);
  }

  /** Build vertex data for this frame from the camera's view matrix. */
  build(view: M4) {
    const rx = view[0], ry = view[4], rz = view[8];
    const ux = view[1], uy = view[5], uz = view[9];
    const fx = -view[2], fy = -view[6], fz = -view[10];
    const alpha: Particle[] = [], add: Particle[] = [];
    for (const p of this.particles) (p.additive ? add : alpha).push(p);
    let n = 0;
    const need = (this.particles.length + this.ribbons.length * 24) * 6;
    if (need > this.cap) this.grow(need);
    const emitQuad = (corners: V3[], uv: number[], col: [number, number, number, number], inten: number) => {
      const order = [0, 1, 2, 0, 2, 3];
      for (const k of order) {
        const o = n * 7;
        const c = corners[k];
        this.f32[o] = c[0];
        this.f32[o + 1] = c[1];
        this.f32[o + 2] = c[2];
        this.f32[o + 3] = uv[k * 2];
        this.f32[o + 4] = uv[k * 2 + 1];
        const b = n * STRIDE + 20;
        this.u8[b] = Math.round(Math.min(1, col[0]) * 255);
        this.u8[b + 1] = Math.round(Math.min(1, col[1]) * 255);
        this.u8[b + 2] = Math.round(Math.min(1, col[2]) * 255);
        this.u8[b + 3] = Math.round(Math.max(0, Math.min(1, col[3])) * 255);
        this.f32[o + 6] = inten;
        n++;
      }
    };
    const cellUV = (cell: number) => {
      const s = 1 / CELLS, u0 = (cell % CELLS) * s, v0 = Math.floor(cell / CELLS) * s, pad = 0.5 / 512;
      return [u0 + pad, v0 + pad, u0 + s - pad, v0 + s - pad];
    };
    const emitParticle = (p: Particle) => {
      const t = p.age / p.life;
      const size = p.size[0] + (p.size[1] - p.size[0]) * t;
      const c0 = p.color, c1 = p.color1;
      const col: [number, number, number, number] = [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, c0[3] + (c1[3] - c0[3]) * t];
      // soft fade-in over the first 8% of life
      col[3] *= Math.min(1, t / 0.08 + (p.additive ? 0.6 : 0));
      const inten = p.intensity[0] + (p.intensity[1] - p.intensity[0]) * t;
      const [u0, v0, u1, v1] = cellUV(p.cell);
      const uv = [u0, v1, u1, v1, u1, v0, u0, v0];
      const P = p.pos;
      let ax: V3, ay: V3;
      if (p.flat) {
        const c = Math.cos(p.rot), s = Math.sin(p.rot);
        ax = [c * size, 0, s * size];
        ay = [-s * size, 0, c * size];
      } else if (p.stretch > 0) {
        // axis = velocity projected onto the view plane
        const v = p.vel;
        const vd = v[0] * fx + v[1] * fy + v[2] * fz;
        let sx = v[0] - fx * vd, sy = v[1] - fy * vd, sz = v[2] - fz * vd;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const speed = Math.hypot(v[0], v[1], v[2]);
        sx /= sl; sy /= sl; sz /= sl;
        const len = size * (1 + speed * p.stretch);
        // side = axis × forward
        const wx = sy * fz - sz * fy, wy = sz * fx - sx * fz, wz = sx * fy - sy * fx;
        ay = [sx * len, sy * len, sz * len];
        ax = [wx * size * 0.35, wy * size * 0.35, wz * size * 0.35];
      } else {
        const c = Math.cos(p.rot) * size, s = Math.sin(p.rot) * size;
        ax = [rx * c + ux * s, ry * c + uy * s, rz * c + uz * s];
        ay = [-rx * s + ux * c, -ry * s + uy * c, -rz * s + uz * c];
      }
      emitQuad([
        [P[0] - ax[0] - ay[0], P[1] - ax[1] - ay[1], P[2] - ax[2] - ay[2]],
        [P[0] + ax[0] - ay[0], P[1] + ax[1] - ay[1], P[2] + ax[2] - ay[2]],
        [P[0] + ax[0] + ay[0], P[1] + ax[1] + ay[1], P[2] + ax[2] + ay[2]],
        [P[0] - ax[0] + ay[0], P[1] - ax[1] + ay[1], P[2] - ax[2] + ay[2]],
      ], uv, col, inten);
    };
    const emitRibbon = (r: Ribbon) => {
      const fade = 1 - r.age / r.life;
      const [u0, v0, u1, v1] = cellUV(FX.beam);
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        // side vector perpendicular to the segment and the view direction
        let sx = dy * fz - dz * fy, sy = dz * fx - dx * fz, sz = dx * fy - dy * fx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const w = r.width * 0.5;
        sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
        emitQuad([
          [a[0] - sx, a[1] - sy, a[2] - sz], [a[0] + sx, a[1] + sy, a[2] + sz],
          [b[0] + sx, b[1] + sy, b[2] + sz], [b[0] - sx, b[1] - sy, b[2] - sz],
        ], [u0, v0, u1, v0, u1, v1, u0, v1], [r.color[0], r.color[1], r.color[2], fade], r.intensity);
      }
    };
    for (const p of alpha) emitParticle(p);
    for (const r of this.ribbons) if (!r.additive) emitRibbon(r);
    this.nAlpha = n;
    for (const p of add) emitParticle(p);
    for (const r of this.ribbons) if (r.additive) emitRibbon(r);
    this.nAdd = n - this.nAlpha;
  }
  private grow(need: number) {
    while (this.cap < need) this.cap *= 2;
    this.data = new ArrayBuffer(this.cap * STRIDE);
    this.f32 = new Float32Array(this.data);
    this.u8 = new Uint8Array(this.data);
    this.buf.destroy();
    this.buf = this.device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'particles' });
  }

  draw(pass: RenderPass, frameGroup: BindGroup) {
    const total = this.nAlpha + this.nAdd;
    if (!total) return;
    this.device.writeBuffer(this.buf, 0, new Uint8Array(this.data, 0, total * STRIDE));
    pass.setVertexBuffer(0, this.buf);
    const tex = (p: Pipeline) => this.device.createBindGroup(p, 1, [{ binding: 0, texture: this.atlas, sampler: this.sampler }]);
    if (this.nAlpha) {
      pass.setPipeline(this.pAlpha);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, tex(this.pAlpha));
      pass.draw(this.nAlpha, 1, 0);
    }
    if (this.nAdd) {
      pass.setPipeline(this.pAdd);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, tex(this.pAdd));
      pass.draw(this.nAdd, 1, this.nAlpha);
    }
  }
}
