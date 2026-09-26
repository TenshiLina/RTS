// WebGL2 implementation of the RHI.

import type {
  Device, DeviceCaps, Buffer, BufferDesc, Texture, TextureDesc, Sampler, SamplerDesc, Pipeline, PipelineDesc,
  BindGroup, BindGroupEntry, RenderPass, RenderPassDesc, TextureFormat, VertexFormat, CompareFunc,
} from '../types';
import { translateToES300 } from '../shaderTranslate';

type GL = WebGL2RenderingContext;

class GLBuffer implements Buffer {
  constructor(public gl: GL, public handle: WebGLBuffer, public size: number, public usage: Buffer['usage']) {}
  destroy() {
    this.gl.deleteBuffer(this.handle);
  }
}

class GLTexture implements Texture {
  framebuffer: WebGLFramebuffer | null = null;
  constructor(
    public gl: GL,
    public handle: WebGLTexture | null,
    public renderbuffer: WebGLRenderbuffer | null,
    public width: number,
    public height: number,
    public format: TextureFormat,
    public sampleCount: number,
    public mipmaps: boolean,
  ) {}
  destroy() {
    if (this.handle) this.gl.deleteTexture(this.handle);
    if (this.renderbuffer) this.gl.deleteRenderbuffer(this.renderbuffer);
  }
}

class GLSampler implements Sampler {
  readonly _sampler = true as const;
  constructor(public handle: WebGLSampler) {}
}

interface AttribInfo {
  slot: number;
  location: number;
  size: number;
  type: number;
  normalized: boolean;
  integer: boolean;
  offset: number;
  stride: number;
  divisor: number;
}

class GLPipeline implements Pipeline {
  constructor(
    public label: string,
    public program: WebGLProgram,
    public desc: PipelineDesc,
    public attribs: AttribInfo[],
    public samplerSlots: Map<number, number>, // slot -> unit
  ) {}
}

class GLBindGroup implements BindGroup {
  readonly _bindGroup = true as const;
  constructor(public index: number, public entries: BindGroupEntry[]) {}
}

const FORMAT: Record<TextureFormat, { internal: number; format: number; type: number; depth?: boolean }> = {
  rgba8unorm: { internal: 0x8058, format: 0x1908, type: 0x1401 },
  rgba16float: { internal: 0x881a, format: 0x1908, type: 0x140b },
  rgba32float: { internal: 0x8814, format: 0x1908, type: 0x1406 },
  r16float: { internal: 0x822d, format: 0x1903, type: 0x140b },
  r32float: { internal: 0x822e, format: 0x1903, type: 0x1406 },
  rg16float: { internal: 0x822f, format: 0x8227, type: 0x140b },
  depth24: { internal: 0x81a6, format: 0x1902, type: 0x1405, depth: true },
  depth32float: { internal: 0x8cac, format: 0x1902, type: 0x1406, depth: true },
};

const VFMT: Record<VertexFormat, { size: number; type: number; normalized: boolean; integer: boolean }> = {
  float32: { size: 1, type: 0x1406, normalized: false, integer: false },
  float32x2: { size: 2, type: 0x1406, normalized: false, integer: false },
  float32x3: { size: 3, type: 0x1406, normalized: false, integer: false },
  float32x4: { size: 4, type: 0x1406, normalized: false, integer: false },
  unorm8x4: { size: 4, type: 0x1401, normalized: true, integer: false },
  snorm8x4: { size: 4, type: 0x1400, normalized: true, integer: false },
  uint8x4: { size: 4, type: 0x1401, normalized: false, integer: true },
};

const CMP: Record<CompareFunc, number> = {
  never: 0x0200, less: 0x0201, equal: 0x0202, lequal: 0x0203, greater: 0x0204, gequal: 0x0206, always: 0x0207,
};

export class WebGL2Device implements Device {
  gl: GL;
  caps: DeviceCaps;
  backbufferWidth = 1;
  backbufferHeight = 1;
  private currentPipeline: GLPipeline | null = null;
  private vao: WebGLVertexArrayObject;
  private pendingVB: { buffer: GLBuffer; offset: number }[] = [];
  private enabledAttribs = new Set<number>();

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserveDrawingBuffer?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
    }) as GL | null;
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const floatRT = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    gl.getExtension('EXT_color_buffer_half_float');
    this.caps = {
      backend: 'webgl2',
      clip: { depthZeroToOne: false, flipY: false },
      uvOriginTop: false,
      maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number,
      floatRenderTargets: floatRT,
      uniformAlign: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.resize(canvas.width, canvas.height);
  }

  resize(w: number, h: number) {
    this.backbufferWidth = Math.max(1, w | 0);
    this.backbufferHeight = Math.max(1, h | 0);
  }

  // ------------------------------------------------------------------ resources
  createBuffer(desc: BufferDesc): Buffer {
    const gl = this.gl;
    const h = gl.createBuffer()!;
    const target = desc.usage === 'index' ? gl.ELEMENT_ARRAY_BUFFER : desc.usage === 'uniform' ? gl.UNIFORM_BUFFER : gl.ARRAY_BUFFER;
    if (target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(null);
    gl.bindBuffer(target, h);
    const usage = desc.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    if (desc.data) gl.bufferData(target, desc.data, usage);
    else gl.bufferData(target, desc.size, usage);
    gl.bindBuffer(target, null);
    if (target === gl.ELEMENT_ARRAY_BUFFER) gl.bindVertexArray(this.vao);
    return new GLBuffer(gl, h, desc.size, desc.usage);
  }

  writeBuffer(buffer: Buffer, offset: number, data: ArrayBufferView) {
    const gl = this.gl;
    const b = buffer as GLBuffer;
    const target = b.usage === 'uniform' ? gl.UNIFORM_BUFFER : gl.ARRAY_BUFFER;
    // index buffers are written through ARRAY_BUFFER binding too (WebGL2 allows rebinding targets? no) —
    if (b.usage === 'index') {
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.handle);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, offset, data);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindVertexArray(this.vao);
      return;
    }
    gl.bindBuffer(target, b.handle);
    gl.bufferSubData(target, offset, data);
    gl.bindBuffer(target, null);
  }

  createTexture(desc: TextureDesc): Texture {
    const gl = this.gl;
    const f = FORMAT[desc.format];
    const samples = desc.sampleCount ?? 1;
    if (samples > 1) {
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, Math.min(samples, this.caps.maxSamples), f.internal, desc.width, desc.height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      return new GLTexture(gl, null, rb, desc.width, desc.height, desc.format, samples, false);
    }
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = desc.mipmaps ? Math.floor(Math.log2(Math.max(desc.width, desc.height))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, f.internal, desc.width, desc.height);
    if (desc.data) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, desc.width, desc.height, f.format, f.type, desc.data);
      if (desc.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    }
    // sane default sampling state (samplers objects override)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (desc.depthCompare) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return new GLTexture(gl, t, null, desc.width, desc.height, desc.format, 1, !!desc.mipmaps);
  }

  writeTexture(texture: Texture, data: ArrayBufferView, region?: { x: number; y: number; w: number; h: number }) {
    const gl = this.gl;
    const t = texture as GLTexture;
    const f = FORMAT[t.format];
    const r = region ?? { x: 0, y: 0, w: t.width, h: t.height };
    gl.bindTexture(gl.TEXTURE_2D, t.handle);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, f.format, f.type, data);
    if (t.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  createSampler(desc: SamplerDesc): Sampler {
    const gl = this.gl;
    const s = gl.createSampler()!;
    const lin = (desc.filter ?? 'linear') === 'linear';
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, desc.mipmaps ? (lin ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST_MIPMAP_NEAREST) : lin ? gl.LINEAR : gl.NEAREST);
    const wrap = desc.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
    if (desc.compare) {
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, desc.compare === 'less' ? gl.LESS : gl.LEQUAL);
    }
    if (desc.anisotropy && desc.anisotropy > 1) {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.samplerParameterf(s, ext.TEXTURE_MAX_ANISOTROPY_EXT, desc.anisotropy);
    }
    return new GLSampler(s);
  }

  createPipeline(desc: PipelineDesc): Pipeline {
    const gl = this.gl;
    const defs = desc.shader.defines ?? {};
    const vs = translateToES300(desc.shader.vertex, 'vertex', defs);
    const fs = translateToES300(desc.shader.fragment, 'fragment', defs);
    const compile = (type: number, code: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, code);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        const numbered = code.split('\n').map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join('\n');
        throw new Error(`[${desc.label}] ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'} compile failed:\n${log}\n${numbered}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs.code));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs.code));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`[${desc.label}] link failed: ${gl.getProgramInfoLog(prog)}`);
    const blocks = [...vs.refl.blocks, ...fs.refl.blocks];
    for (const b of blocks) {
      const idx = gl.getUniformBlockIndex(prog, b.name);
      if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(prog, idx, b.slot);
    }
    const samplerSlots = new Map<number, number>();
    gl.useProgram(prog);
    for (const s of [...vs.refl.samplers, ...fs.refl.samplers]) {
      const loc = gl.getUniformLocation(prog, s.name);
      if (loc) {
        gl.uniform1i(loc, s.slot);
        samplerSlots.set(s.slot, s.slot);
      }
    }
    gl.useProgram(null);
    const attribs: AttribInfo[] = [];
    desc.vertexBuffers.forEach((vb, slot) => {
      for (const a of vb.attributes) {
        const f = VFMT[a.format];
        attribs.push({ slot, location: a.location, size: f.size, type: f.type, normalized: f.normalized, integer: f.integer, offset: a.offset, stride: vb.arrayStride, divisor: vb.stepMode === 'instance' ? 1 : 0 });
      }
    });
    return new GLPipeline(desc.label, prog, desc, attribs, samplerSlots);
  }

  createBindGroup(_pipeline: Pipeline, index: number, entries: BindGroupEntry[]): BindGroup {
    return new GLBindGroup(index, entries);
  }

  // ------------------------------------------------------------------ passes
  private fbCache = new Map<string, WebGLFramebuffer>();
  private framebufferFor(color: (GLTexture | null)[], depth: GLTexture | null): WebGLFramebuffer | null {
    if (color.length === 1 && color[0] === null && !depth) return null;
    if (color.every((c) => c === null) && !depth) return null;
    const key = color.map((c) => (c ? (c as any).__id ?? ((c as any).__id = Math.random()) : 'bb')).join(',') + '|' + (depth ? (depth as any).__id ?? ((depth as any).__id = Math.random()) : '-');
    let fb = this.fbCache.get(key);
    if (fb) return fb;
    const gl = this.gl;
    fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    color.forEach((c, i) => {
      if (!c) return;
      if (c.renderbuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, c.renderbuffer);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, c.handle, 0);
    });
    if (depth) {
      if (depth.renderbuffer) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth.renderbuffer);
      else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.handle, 0);
    }
    const n = color.filter(Boolean).length;
    gl.drawBuffers(n ? color.map((c, i) => (c ? gl.COLOR_ATTACHMENT0 + i : gl.NONE)) : [gl.NONE]);
    if (!n) gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
    this.fbCache.set(key, fb);
    return fb;
  }
  /** Drop cached framebuffers (call after destroying render targets on resize). */
  invalidateFramebuffers() {
    for (const fb of this.fbCache.values()) this.gl.deleteFramebuffer(fb);
    this.fbCache.clear();
  }

  beginRenderPass(desc: RenderPassDesc): RenderPass {
    const gl = this.gl;
    const colors = desc.color.map((c) => c.texture as GLTexture | null);
    const depthTex = (desc.depth?.texture as GLTexture) ?? null;
    const isBackbuffer = colors.length > 0 && colors[0] === null;
    const fb = isBackbuffer ? null : this.framebufferFor(colors, depthTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const w = isBackbuffer ? this.backbufferWidth : (colors[0] ?? depthTex)!.width;
    const h = isBackbuffer ? this.backbufferHeight : (colors[0] ?? depthTex)!.height;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    // clears
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    desc.color.forEach((c, i) => {
      if (c.load === 'clear') {
        const cc = c.clearColor ?? [0, 0, 0, 1];
        if (isBackbuffer) {
          gl.clearColor(cc[0], cc[1], cc[2], cc[3]);
          gl.clear(gl.COLOR_BUFFER_BIT);
        } else gl.clearBufferfv(gl.COLOR, i, cc);
      }
    });
    if (desc.depth && desc.depth.load === 'clear') gl.clearBufferfv(gl.DEPTH, 0, [desc.depth.clearDepth ?? 1]);
    else if (isBackbuffer) {
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }
    const dev = this;
    let indexType: number = gl.UNSIGNED_SHORT;
    let indexSize = 2;
    const pass: RenderPass = {
      setPipeline(p) {
        dev.applyPipeline(p as GLPipeline);
      },
      setVertexBuffer(slot, buffer, offset = 0) {
        dev.pendingVB[slot] = { buffer: buffer as GLBuffer, offset };
      },
      setIndexBuffer(buffer, format) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, (buffer as GLBuffer).handle);
        indexType = format === 'uint32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        indexSize = format === 'uint32' ? 4 : 2;
      },
      setBindGroup(index, group, dyn) {
        const g = group as GLBindGroup;
        let d = 0;
        for (const e of g.entries) {
          const slot = index * 4 + e.binding;
          if (e.buffer) {
            const off = (e.offset ?? 0) + (dyn && dyn[d] !== undefined ? dyn[d] : 0);
            d++;
            gl.bindBufferRange(gl.UNIFORM_BUFFER, slot, (e.buffer as GLBuffer).handle, off, e.size ?? e.buffer.size - off);
          } else if (e.texture) {
            gl.activeTexture(gl.TEXTURE0 + slot);
            gl.bindTexture(gl.TEXTURE_2D, (e.texture as GLTexture).handle);
            gl.bindSampler(slot, e.sampler ? (e.sampler as GLSampler).handle : null);
          }
        }
      },
      setViewport(x, y, vw, vh) {
        gl.viewport(x, y, vw, vh);
      },
      draw(count, instances = 1, first = 0) {
        dev.flushVertexState();
        if (instances > 1 || dev.hasInstanced()) gl.drawArraysInstanced(dev.topology(), first, count, instances);
        else gl.drawArrays(dev.topology(), first, count);
      },
      drawIndexed(count, instances = 1, first = 0) {
        dev.flushVertexState();
        gl.drawElementsInstanced(dev.topology(), count, indexType, first * indexSize, instances);
      },
      end() {
        // MSAA resolve
        desc.color.forEach((c, i) => {
          if (!c.resolveTarget) return;
          const src = fb;
          const dst = dev.framebufferFor([c.resolveTarget as GLTexture], null);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
          gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
          gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        });
        // tell the driver we don't need MSAA/depth contents after the pass (tile GPUs, like Metal's storeAction=dontCare)
        if (fb) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          const discard: number[] = [];
          if (depthTex && depthTex.renderbuffer) discard.push(gl.DEPTH_ATTACHMENT);
          desc.color.forEach((c, i) => {
            if (c.resolveTarget) discard.push(gl.COLOR_ATTACHMENT0 + i);
          });
          if (discard.length) gl.invalidateFramebuffer(gl.FRAMEBUFFER, discard);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
    };
    return pass;
  }

  private topology() {
    return this.currentPipeline?.desc.topology === 'line-list' ? this.gl.LINES : this.gl.TRIANGLES;
  }
  private hasInstanced() {
    return !!this.currentPipeline?.attribs.some((a) => a.divisor > 0);
  }

  private applyPipeline(p: GLPipeline) {
    const gl = this.gl;
    this.currentPipeline = p;
    const d = p.desc;
    gl.useProgram(p.program);
    if (d.cullMode && d.cullMode !== 'none') {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(d.cullMode === 'back' ? gl.BACK : gl.FRONT);
    } else gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    if (d.depthTest ?? true) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(CMP[d.depthCompare ?? 'lequal']);
    } else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(d.depthWrite ?? true);
    if (d.depthBias) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(d.depthBias.slope, d.depthBias.constant);
    } else gl.disable(gl.POLYGON_OFFSET_FILL);
    const cw = d.colorWrite ?? true;
    gl.colorMask(cw, cw, cw, cw);
    switch (d.blend ?? 'opaque') {
      case 'opaque':
        gl.disable(gl.BLEND);
        break;
      case 'alpha':
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'premultiplied':
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'additive':
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        break;
    }
  }

  private flushVertexState() {
    const gl = this.gl;
    const p = this.currentPipeline!;
    const used = new Set<number>();
    let bound: WebGLBuffer | null = null;
    for (const a of p.attribs) {
      const vb = this.pendingVB[a.slot];
      if (!vb) continue;
      if (bound !== vb.buffer.handle) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vb.buffer.handle);
        bound = vb.buffer.handle;
      }
      if (!this.enabledAttribs.has(a.location)) gl.enableVertexAttribArray(a.location);
      used.add(a.location);
      if (a.integer) gl.vertexAttribIPointer(a.location, a.size, a.type, a.stride, vb.offset + a.offset);
      else gl.vertexAttribPointer(a.location, a.size, a.type, a.normalized, a.stride, vb.offset + a.offset);
      gl.vertexAttribDivisor(a.location, a.divisor);
    }
    for (const loc of this.enabledAttribs) if (!used.has(loc)) gl.disableVertexAttribArray(loc);
    this.enabledAttribs = used;
  }

  readPixels(x: number, y: number, w: number, h: number) {
    const out = new Uint8Array(w * h * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.readPixels(x, y, w, h, this.gl.RGBA, this.gl.UNSIGNED_BYTE, out);
    return out;
  }
}
