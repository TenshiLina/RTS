// Engine-drawn UI: batched textured quads in pixel space. The in-game interface (C&C sidebar,
// cameos, minimap, tooltips) is built from these primitives rather than HTML, so it ports to
// native backends unchanged. Glyphs come from a platform-rasterised atlas (Platform.rasterizeGlyphs).

import type { Device, Pipeline, Buffer, Texture, Sampler } from './rhi/types';
import { SHADERS } from './shaders';
import type { GlyphAtlasData, GlyphFace } from '../platform/platform';

const STRIDE = 20; // pos 2f, uv 2f, color u8x4

export interface UIImage {
  texture: Texture;
  /** render-target textures on bottom-left-origin backends are stored upside down */
  flipY?: boolean;
}

export type Align = 'left' | 'center' | 'right';

export class UIRenderer {
  private pipe: Pipeline;
  private buf: Buffer;
  private ubo: Buffer;
  private cap = 32768;
  private data = new ArrayBuffer(this.cap * STRIDE);
  private f32 = new Float32Array(this.data);
  private u8 = new Uint8Array(this.data);
  private n = 0;
  private batches: { tex: Texture; first: number; count: number }[] = [];
  private white: Texture;
  private sampler: Sampler;
  private glyphTex: Texture | null = null;
  private faces = new Map<string, GlyphFace>();
  width = 1;
  height = 1;

  constructor(private device: Device) {
    this.pipe = device.createPipeline({
      label: 'ui',
      shader: { label: 'ui', vertex: SHADERS.uiVert, fragment: SHADERS.uiFrag },
      vertexBuffers: [{ arrayStride: STRIDE, attributes: [{ location: 0, format: 'float32x2', offset: 0 }, { location: 1, format: 'float32x2', offset: 8 }, { location: 2, format: 'unorm8x4', offset: 16 }] }],
      bindGroups: [{ entries: [{ binding: 0, kind: 'uniform', name: 'UIUniforms' }] }, { entries: [{ binding: 0, kind: 'texture', name: 'uTex' }] }],
      colorFormats: ['rgba8unorm'],
      blend: 'premultiplied',
      depthTest: false,
      depthWrite: false,
      cullMode: 'none',
    });
    this.buf = device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'ui' });
    this.ubo = device.createBuffer({ size: 16, usage: 'uniform', dynamic: true, label: 'ui-ubo' });
    this.white = device.createTexture({ width: 1, height: 1, format: 'rgba8unorm', data: new Uint8Array([255, 255, 255, 255]) });
    this.sampler = device.createSampler({ filter: 'linear', wrap: 'clamp' });
  }

  setGlyphs(atlas: GlyphAtlasData) {
    this.glyphTex = this.device.createTexture({ width: atlas.width, height: atlas.height, format: 'rgba8unorm', data: atlas.pixels, label: 'glyphs' });
    this.faces = new Map(Object.entries(atlas.faces));
  }
  hasFace(name: string) {
    return this.faces.has(name);
  }

  begin(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.n = 0;
    this.batches = [];
  }

  private use(tex: Texture) {
    const last = this.batches[this.batches.length - 1];
    if (last && last.tex === tex) return;
    this.batches.push({ tex, first: this.n, count: 0 });
  }
  private vert(x: number, y: number, u: number, v: number, c: number, a: number) {
    if (this.n >= this.cap) this.grow();
    const o = this.n * 5;
    this.f32[o] = x;
    this.f32[o + 1] = y;
    this.f32[o + 2] = u;
    this.f32[o + 3] = v;
    const b = this.n * STRIDE + 16;
    this.u8[b] = (c >> 16) & 255;
    this.u8[b + 1] = (c >> 8) & 255;
    this.u8[b + 2] = c & 255;
    this.u8[b + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    this.n++;
    this.batches[this.batches.length - 1].count++;
  }
  private grow() {
    this.cap *= 2;
    const d = new ArrayBuffer(this.cap * STRIDE);
    new Uint8Array(d).set(this.u8);
    this.data = d;
    this.f32 = new Float32Array(d);
    this.u8 = new Uint8Array(d);
    this.buf.destroy();
    this.buf = this.device.createBuffer({ size: d.byteLength, usage: 'vertex', dynamic: true, label: 'ui' });
  }
  private quad(tex: Texture, x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number, cTop: number, aTop: number, cBot = cTop, aBot = aTop) {
    this.use(tex);
    this.vert(x0, y0, u0, v0, cTop, aTop);
    this.vert(x1, y0, u1, v0, cTop, aTop);
    this.vert(x1, y1, u1, v1, cBot, aBot);
    this.vert(x0, y0, u0, v0, cTop, aTop);
    this.vert(x1, y1, u1, v1, cBot, aBot);
    this.vert(x0, y1, u0, v1, cBot, aBot);
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 1) {
    this.quad(this.white, x, y, x + w, y + h, 0, 0, 1, 1, c, a);
  }
  gradient(x: number, y: number, w: number, h: number, cTop: number, cBot: number, aTop = 1, aBot = aTop) {
    this.quad(this.white, x, y, x + w, y + h, 0, 0, 1, 1, cTop, aTop, cBot, aBot);
  }
  outline(x: number, y: number, w: number, h: number, t: number, c: number, a = 1) {
    this.rect(x, y, w, t, c, a);
    this.rect(x, y + h - t, w, t, c, a);
    this.rect(x, y + t, t, h - 2 * t, c, a);
    this.rect(x + w - t, y + t, t, h - 2 * t, c, a);
  }
  image(img: UIImage, x: number, y: number, w: number, h: number, c = 0xffffff, a = 1, crop?: [number, number, number, number]) {
    let [u0, v0, u1, v1] = crop ?? [0, 0, 1, 1];
    if (img.flipY) [v0, v1] = [1 - v0, 1 - v1];
    this.quad(img.texture, x, y, x + w, y + h, u0, v0, u1, v1, c, a);
  }
  /** Convex polygon fan (x,y pairs). */
  poly(pts: number[], c: number, a = 1) {
    this.use(this.white);
    for (let i = 2; i + 3 < pts.length; i += 2) {
      this.vert(pts[0], pts[1], 0.5, 0.5, c, a);
      this.vert(pts[i], pts[i + 1], 0.5, 0.5, c, a);
      this.vert(pts[i + 2], pts[i + 3], 0.5, 0.5, c, a);
    }
  }
  /** Pie slice from angle a0 to a1 (radians, 0 = up, clockwise) — used for clock-wipes. */
  pie(cx: number, cy: number, r: number, a0: number, a1: number, c: number, a = 1) {
    const seg = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
    const pts = [cx, cy];
    for (let i = 0; i <= seg; i++) {
      const t = a0 + ((a1 - a0) * i) / seg;
      pts.push(cx + Math.sin(t) * r, cy - Math.cos(t) * r);
    }
    this.poly(pts, c, a);
  }
  /** Thick arc (rings, gauges). */
  arc(cx: number, cy: number, r: number, width: number, a0: number, a1: number, c: number, a = 1) {
    const seg = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (Math.PI * 2)) * 64));
    this.use(this.white);
    for (let i = 0; i < seg; i++) {
      const t0 = a0 + ((a1 - a0) * i) / seg, t1 = a0 + ((a1 - a0) * (i + 1)) / seg;
      const p = (t: number, rr: number) => [cx + Math.sin(t) * rr, cy - Math.cos(t) * rr];
      const A = p(t0, r - width), B = p(t1, r - width), C = p(t1, r), D = p(t0, r);
      this.vert(A[0], A[1], 0.5, 0.5, c, a);
      this.vert(B[0], B[1], 0.5, 0.5, c, a);
      this.vert(C[0], C[1], 0.5, 0.5, c, a);
      this.vert(A[0], A[1], 0.5, 0.5, c, a);
      this.vert(C[0], C[1], 0.5, 0.5, c, a);
      this.vert(D[0], D[1], 0.5, 0.5, c, a);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: number, a = 1) {
    const l = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / l) * w * 0.5, ny = ((x1 - x0) / l) * w * 0.5;
    this.poly([x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny], c, a);
  }

  // ------------------------------------------------------------------ text
  measure(str: string, face: string, scale = 1): number {
    const f = this.faces.get(face);
    if (!f) return str.length * 7 * scale;
    let w = 0;
    for (const ch of str) {
      const g = f.glyphs[ch] ?? f.glyphs['?'];
      if (g) w += g.adv * scale;
    }
    return w;
  }
  lineHeight(face: string, scale = 1) {
    return (this.faces.get(face)?.lineHeight ?? 16) * scale;
  }
  /** Draws text with its baseline-box top at y. Returns the advance width. */
  text(str: string, x: number, y: number, face: string, c = 0xffffff, a = 1, opts: { align?: Align; scale?: number; shadow?: boolean } = {}): number {
    const f = this.faces.get(face);
    const tex = this.glyphTex;
    if (!f || !tex) return 0;
    const scale = opts.scale ?? 1;
    const w = this.measure(str, face, scale);
    let px = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    px = Math.round(px);
    const py = Math.round(y);
    const iw = 1 / tex.width, ih = 1 / tex.height;
    const draw = (ox: number, oy: number, col: number, al: number) => {
      let cx = px + ox;
      for (const ch of str) {
        const g = f.glyphs[ch] ?? f.glyphs['?'];
        if (!g) continue;
        if (g.w > 0) {
          const x0 = cx + g.xoff * scale, y0 = py + oy + g.yoff * scale;
          this.quad(tex, x0, y0, x0 + g.w * scale, y0 + g.h * scale, g.x * iw, g.y * ih, (g.x + g.w) * iw, (g.y + g.h) * ih, col, al);
        }
        cx += g.adv * scale;
      }
    };
    if (opts.shadow !== false) draw(1, 1, 0x000000, a * 0.7);
    draw(0, 0, c, a);
    return w;
  }
  /** Word-wrapped paragraph; returns the height used. */
  paragraph(str: string, x: number, y: number, maxW: number, face: string, c: number, a = 1, scale = 1): number {
    const words = str.split(/\s+/);
    let line = '';
    let yy = y;
    const lh = this.lineHeight(face, scale);
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (this.measure(t, face, scale) > maxW && line) {
        this.text(line, x, yy, face, c, a, { scale });
        yy += lh;
        line = wd;
      } else line = t;
    }
    if (line) {
      this.text(line, x, yy, face, c, a, { scale });
      yy += lh;
    }
    return yy - y;
  }

  /** Submit into an already-begun backbuffer pass. */
  flush() {
    if (!this.n) return;
    const d = this.device;
    d.writeBuffer(this.buf, 0, new Uint8Array(this.data, 0, this.n * STRIDE));
    d.writeBuffer(this.ubo, 0, new Float32Array([this.width, this.height, 0, 0]));
    const pass = d.beginRenderPass({ label: 'ui', color: [{ texture: null, load: 'load' }] });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, d.createBindGroup(this.pipe, 0, [{ binding: 0, buffer: this.ubo }]));
    pass.setVertexBuffer(0, this.buf);
    for (const b of this.batches) {
      if (!b.count) continue;
      pass.setBindGroup(1, d.createBindGroup(this.pipe, 1, [{ binding: 0, texture: b.tex, sampler: this.sampler }]));
      pass.draw(b.count, 1, b.first);
    }
    pass.end();
  }
}
