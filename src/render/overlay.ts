// World-space decal geometry (footprints, selection rings, order markers, range circles),
// rebuilt every frame on the CPU and drawn translucent over the scene.

import type { Device, Pipeline, Buffer, RenderPass, BindGroup } from './rhi/types';
import { SHADERS } from './shaders';
import type { Renderer } from './renderer';

const STRIDE = 16; // pos f32x3 + color u8x4

export type HeightFn = (x: number, z: number) => number;

export class OverlayBatch {
  private pipe: Pipeline;
  private pipeNoDepth: Pipeline;
  private buf: Buffer;
  private cap = 16384;
  private data = new ArrayBuffer(this.cap * STRIDE);
  private f32 = new Float32Array(this.data);
  private u8 = new Uint8Array(this.data);
  private n = 0;
  private xrayStart = -1;

  constructor(private device: Device, renderer: Renderer) {
    const desc = (depthTest: boolean) => ({
      label: depthTest ? 'overlay' : 'overlay-xray',
      shader: { label: 'overlay', vertex: SHADERS.overlayVert, fragment: SHADERS.overlayFrag },
      vertexBuffers: [{ arrayStride: STRIDE, attributes: [{ location: 0, format: 'float32x3' as const, offset: 0 }, { location: 1, format: 'unorm8x4' as const, offset: 12 }] }],
      bindGroups: [{ entries: [{ binding: 0, kind: 'uniform' as const, name: 'FrameUniforms' }] }],
      colorFormats: [renderer.hdrColorFormat],
      depthFormat: 'depth24' as const,
      sampleCount: renderer.sampleCount,
      blend: 'premultiplied' as const,
      depthWrite: false,
      depthTest,
      depthCompare: 'lequal' as const,
      cullMode: 'none' as const,
    });
    this.pipe = device.createPipeline(desc(true));
    this.pipeNoDepth = device.createPipeline(desc(false));
    this.buf = device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'overlay' });
  }

  begin() {
    this.n = 0;
    this.xrayStart = -1;
  }
  /** Everything emitted after this call draws without depth test (visible through buildings). */
  beginXray() {
    this.xrayStart = this.n;
  }

  private v(x: number, y: number, z: number, c: number, a: number) {
    if (this.n >= this.cap) this.grow();
    const o = this.n * 4;
    this.f32[o] = x;
    this.f32[o + 1] = y;
    this.f32[o + 2] = z;
    const b = this.n * STRIDE + 12;
    this.u8[b] = (c >> 16) & 255;
    this.u8[b + 1] = (c >> 8) & 255;
    this.u8[b + 2] = c & 255;
    this.u8[b + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    this.n++;
  }
  private grow() {
    this.cap *= 2;
    const d = new ArrayBuffer(this.cap * STRIDE);
    new Uint8Array(d).set(this.u8);
    this.data = d;
    this.f32 = new Float32Array(d);
    this.u8 = new Uint8Array(d);
    this.buf.destroy();
    this.buf = this.device.createBuffer({ size: d.byteLength, usage: 'vertex', dynamic: true, label: 'overlay' });
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: number, a: number) {
    this.v(ax, ay, az, c, a);
    this.v(bx, by, bz, c, a);
    this.v(cx, cy, cz, c, a);
  }

  /** Axis-aligned rectangle draped on the terrain (subdivided so it follows slopes). */
  rect(x0: number, z0: number, x1: number, z1: number, h: HeightFn, c: number, a: number, lift = 0.06, div = 2) {
    for (let j = 0; j < div; j++) for (let i = 0; i < div; i++) {
      const ax = x0 + ((x1 - x0) * i) / div, bx = x0 + ((x1 - x0) * (i + 1)) / div;
      const az = z0 + ((z1 - z0) * j) / div, bz = z0 + ((z1 - z0) * (j + 1)) / div;
      const p00 = h(ax, az) + lift, p10 = h(bx, az) + lift, p01 = h(ax, bz) + lift, p11 = h(bx, bz) + lift;
      this.tri(ax, p00, az, bx, p10, az, bx, p11, bz, c, a);
      this.tri(ax, p00, az, bx, p11, bz, ax, p01, bz, c, a);
    }
  }

  /** Rectangle outline on the terrain. */
  rectOutline(x0: number, z0: number, x1: number, z1: number, h: HeightFn, width: number, c: number, a: number) {
    this.rect(x0, z0, x1, z0 + width, h, c, a, 0.07, 3);
    this.rect(x0, z1 - width, x1, z1, h, c, a, 0.07, 3);
    this.rect(x0, z0 + width, x0 + width, z1 - width, h, c, a, 0.07, 3);
    this.rect(x1 - width, z0 + width, x1, z1 - width, h, c, a, 0.07, 3);
  }

  /** Ring on the terrain; `dash` > 0 leaves gaps (C&C-style broken circle). */
  ring(cx: number, cz: number, r: number, width: number, h: HeightFn, c: number, a: number, opts: { seg?: number; dash?: number; phase?: number; lift?: number; inner?: number } = {}) {
    const seg = opts.seg ?? Math.max(16, Math.round(r * 10));
    const lift = opts.lift ?? 0.08;
    const r0 = Math.max(0, r - width), r1 = r;
    for (let i = 0; i < seg; i++) {
      if (opts.dash && Math.floor((i / seg) * opts.dash * 2) % 2 === 1) continue;
      const a0 = (i / seg) * Math.PI * 2 + (opts.phase ?? 0), a1 = ((i + 1) / seg) * Math.PI * 2 + (opts.phase ?? 0);
      const p = (ang: number, rr: number): [number, number, number] => {
        const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
        return [x, h(x, z) + lift, z];
      };
      const A = p(a0, r0), B = p(a1, r0), C = p(a1, r1), D = p(a0, r1);
      this.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], c, a * (opts.inner ?? 1));
      this.tri(A[0], A[1], A[2], C[0], C[1], C[2], D[0], D[1], D[2], c, a);
    }
  }

  /** Filled disc (area-of-effect previews). */
  disc(cx: number, cz: number, r: number, h: HeightFn, c: number, a: number, seg = 40) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      this.tri(cx, h(cx, cz) + 0.09, cz, x0, h(x0, z0) + 0.09, z0, x1, h(x1, z1) + 0.09, z1, c, a);
    }
  }

  /** Line along the ground (rally lines, waypoints). */
  line(x0: number, z0: number, x1: number, z1: number, width: number, h: HeightFn, c: number, a: number, dash = 0) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-3) return;
    const nx = (-(z1 - z0) / len) * width * 0.5, nz = ((x1 - x0) / len) * width * 0.5;
    const steps = Math.max(1, Math.ceil(len / 1.5));
    for (let i = 0; i < steps; i++) {
      if (dash && i % 2 === 1) continue;
      const t0 = i / steps, t1 = (i + 1) / steps;
      const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
      const ha = h(ax, az) + 0.1, hb = h(bx, bz) + 0.1;
      this.tri(ax + nx, ha, az + nz, bx + nx, hb, bz + nz, bx - nx, hb, bz - nz, c, a);
      this.tri(ax + nx, ha, az + nz, bx - nx, hb, bz - nz, ax - nx, ha, az - nz, c, a);
    }
  }

  draw(pass: RenderPass, frameGroup: BindGroup) {
    if (!this.n) return;
    this.device.writeBuffer(this.buf, 0, new Uint8Array(this.data, 0, this.n * STRIDE));
    const split = this.xrayStart >= 0 ? this.xrayStart : this.n;
    pass.setVertexBuffer(0, this.buf);
    if (split > 0) {
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, frameGroup);
      pass.draw(split, 1, 0);
    }
    if (split < this.n) {
      pass.setPipeline(this.pipeNoDepth);
      pass.setBindGroup(0, frameGroup);
      pass.draw(this.n - split, 1, split);
    }
  }
}
