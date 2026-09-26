// Scene renderer. Talks only to the RHI (render/rhi/types.ts) — never to WebGL directly — so the
// same code drives every backend.
//
// Frame:  shadow depth → main HDR (MSAA) [sky, terrain, meshes, water] → resolve → bloom → composite

import type { Device, Pipeline, Buffer, Texture, Sampler, VertexBufferLayout, BindGroupLayout, PipelineDesc } from './rhi/types';
import { SHADERS } from './shaders';
import { MESH_VERTEX_STRIDE, ModelData } from '../assets/gltf';
import { poseJoints, MAX_JOINTS, JOINT_TEXELS } from './animation';
import {
  M4, V3, m4, m4Mul, m4Invert, m4LookAt, m4Ortho, add, scale, normalize, sub, dot, cross,
} from '../core/math';
import { hexToLinear } from '../core/materialModel';
import type { TerrainGpu } from './terrainRenderer';

export interface GpuModel {
  name: string;
  data: ModelData;
  vb: Buffer;
  ib: Buffer;
  indexCount: number;
  indexFormat: 'uint16' | 'uint32';
  skinned: boolean;
  animIndex: Map<string, number>;
}

export interface RenderInstance {
  model: GpuModel;
  matrix: M4;
  team: number;
  anim?: string;
  animTime?: number;
  highlight?: number;
  /** object-space Y above which geometry is clipped (construction animation). Infinity = built. */
  buildClip?: number;
}

export interface Lighting {
  sunDir: V3;
  sunColor: number;
  sunIntensity: number;
  skyColor: number;
  groundColor: number;
  ambient: number;
  rim: number;
  fogColor: number;
  fogDensity: number;
  fogStart: number;
  shadowStrength: number;
  exposure: number;
  saturation: number;
  contrast: number;
  bloom: number;
  warmth: [number, number, number];
  vignette: number;
}

export const DEFAULT_LIGHTING: Lighting = {
  sunDir: normalize([-0.55, 0.78, 0.42]),
  sunColor: 0xfff1d6,
  sunIntensity: 2.3,
  skyColor: 0x8fb6e8,
  groundColor: 0x6b6a4a,
  ambient: 0.46,
  rim: 0.35,
  fogColor: 0xc4d4e4,
  fogDensity: 0.0035,
  fogStart: 60,
  shadowStrength: 0.82,
  exposure: 0.92,
  saturation: 1.04,
  contrast: 1.06,
  bloom: 0.55,
  warmth: [1.03, 1.0, 0.96],
  vignette: 0.35,
};

export interface Camera {
  view: M4;
  proj: M4;
  pos: V3;
  /** point the camera orbits / looks at; shadows are fitted around it */
  target: V3;
  /** radius around target to cover with the shadow map */
  shadowRadius: number;
}

export interface SceneView {
  camera: Camera;
  instances: RenderInstance[];
  time: number;
  terrain?: TerrainGpu | null;
  lighting?: Lighting;
  teamColors?: number[];
  grid?: { cell: number; opacity: number };
  sky?: boolean;
  clearColor?: [number, number, number];
}

const INSTANCE_FLOATS = 20;
const FRAME_UBO_SIZE = 4 * 16 * 4 + 16 * (11 + 8);

export const MESH_VERTEX_LAYOUT: VertexBufferLayout = {
  arrayStride: MESH_VERTEX_STRIDE,
  attributes: [
    { location: 0, format: 'float32x3', offset: 0 },
    { location: 1, format: 'float32x3', offset: 12 },
    { location: 2, format: 'float32x2', offset: 24 },
    { location: 3, format: 'unorm8x4', offset: 32 },
    { location: 4, format: 'unorm8x4', offset: 36 },
    { location: 5, format: 'unorm8x4', offset: 40 },
    { location: 6, format: 'uint8x4', offset: 44 },
  ],
};
const INSTANCE_LAYOUT: VertexBufferLayout = {
  arrayStride: INSTANCE_FLOATS * 4,
  stepMode: 'instance',
  attributes: [
    { location: 8, format: 'float32x4', offset: 0 },
    { location: 9, format: 'float32x4', offset: 16 },
    { location: 10, format: 'float32x4', offset: 32 },
    { location: 11, format: 'float32x4', offset: 48 },
    { location: 12, format: 'float32x4', offset: 64 },
  ],
};
const FRAME_GROUP: BindGroupLayout = { entries: [{ binding: 0, kind: 'uniform', name: 'FrameUniforms' }] };
const MESH_GROUP: BindGroupLayout = {
  entries: [
    { binding: 0, kind: 'texture', name: 'uJoints' },
    { binding: 1, kind: 'texture', name: 'uShadow' },
  ],
};

export class UniformArena {
  buffer: Buffer;
  private offset = 0;
  constructor(private device: Device, public size = 64 * 1024) {
    this.buffer = device.createBuffer({ size, usage: 'uniform', dynamic: true, label: 'uniform-arena' });
  }
  reset() {
    this.offset = 0;
  }
  push(data: Float32Array): { offset: number; size: number } {
    const align = this.device.caps.uniformAlign;
    const size = Math.ceil(data.byteLength / 16) * 16;
    if (this.offset + size > this.size) this.offset = 0;
    const off = this.offset;
    this.device.writeBuffer(this.buffer, off, data);
    this.offset = Math.ceil((off + size) / align) * align;
    return { offset: off, size };
  }
}

export class Renderer {
  private pipes!: {
    mesh: Pipeline; meshShadow: Pipeline; terrain: Pipeline; terrainShadow: Pipeline; water: Pipeline; sky: Pipeline;
    bloomDown: Pipeline; bloomUp: Pipeline; composite: Pipeline;
  };
  private frameUBO: Buffer;
  private frameData = new Float32Array(FRAME_UBO_SIZE / 4);
  private arena: UniformArena;
  private jointTex: Texture;
  private jointData: Float32Array;
  private jointRows = 256;
  private instBuf: Buffer;
  private instCap = 4096;
  private instData = new Float32Array(4096 * INSTANCE_FLOATS);
  private shadowMap: Texture;
  private shadowSize = 2048;
  private shadowSampler: Sampler;
  private linearClamp: Sampler;
  private nearestClamp: Sampler;
  private targets: { w: number; h: number; msaaColor: Texture; msaaDepth: Texture; hdr: Texture; bloom: Texture[] } | null = null;
  private hdrFormat: 'rgba16float' | 'rgba8unorm';
  private samples: number;
  stats = { drawCalls: 0, triangles: 0, instances: 0 };

  constructor(public device: Device, opts: { samples?: number; shadowSize?: number } = {}) {
    const caps = device.caps;
    this.hdrFormat = caps.floatRenderTargets ? 'rgba16float' : 'rgba8unorm';
    this.samples = Math.min(opts.samples ?? 4, caps.maxSamples);
    this.shadowSize = opts.shadowSize ?? 2048;
    this.frameUBO = device.createBuffer({ size: FRAME_UBO_SIZE, usage: 'uniform', dynamic: true, label: 'frame' });
    this.arena = new UniformArena(device);
    this.jointData = new Float32Array(MAX_JOINTS * JOINT_TEXELS * 4 * this.jointRows);
    this.jointTex = device.createTexture({ width: MAX_JOINTS * JOINT_TEXELS, height: this.jointRows, format: 'rgba32float', label: 'joints' });
    this.instBuf = device.createBuffer({ size: this.instData.byteLength, usage: 'vertex', dynamic: true, label: 'instances' });
    this.shadowMap = device.createTexture({ width: this.shadowSize, height: this.shadowSize, format: 'depth32float', renderTarget: true, depthCompare: true, label: 'shadow' });
    this.shadowSampler = device.createSampler({ filter: 'linear', compare: 'lequal', wrap: 'clamp' });
    this.linearClamp = device.createSampler({ filter: 'linear', wrap: 'clamp' });
    this.nearestClamp = device.createSampler({ filter: 'nearest', wrap: 'clamp' });
    this.createPipelines();
  }

  private createPipelines() {
    const d = this.device;
    const hdr = this.hdrFormat;
    const ms = this.samples;
    const base = (o: Partial<PipelineDesc> & Pick<PipelineDesc, 'label' | 'shader'>): PipelineDesc => ({
      vertexBuffers: [],
      bindGroups: [FRAME_GROUP],
      colorFormats: [hdr],
      depthFormat: 'depth24',
      sampleCount: ms,
      cullMode: 'back',
      ...o,
    });
    const meshShader = { label: 'mesh', vertex: SHADERS.meshVert, fragment: SHADERS.meshFrag };
    const terrainLayout: VertexBufferLayout = {
      arrayStride: 32,
      attributes: [
        { location: 0, format: 'float32x3', offset: 0 },
        { location: 1, format: 'float32x3', offset: 12 },
        { location: 2, format: 'unorm8x4', offset: 24 },
        { location: 3, format: 'unorm8x4', offset: 28 },
      ],
    };
    this.pipes = {
      mesh: d.createPipeline(base({ label: 'mesh', shader: meshShader, vertexBuffers: [MESH_VERTEX_LAYOUT, INSTANCE_LAYOUT], bindGroups: [FRAME_GROUP, MESH_GROUP], cullMode: 'back' })),
      meshShadow: d.createPipeline({
        label: 'mesh-shadow',
        shader: { label: 'mesh-shadow', vertex: SHADERS.meshVert, fragment: SHADERS.depthFrag, defines: { SHADOW_PASS: 1 } },
        vertexBuffers: [MESH_VERTEX_LAYOUT, INSTANCE_LAYOUT],
        bindGroups: [FRAME_GROUP, MESH_GROUP],
        colorFormats: [],
        depthFormat: 'depth32float',
        cullMode: 'none',
        depthBias: { constant: 2, slope: 2.5 },
      }),
      terrain: d.createPipeline(base({ label: 'terrain', shader: { label: 'terrain', vertex: SHADERS.terrainVert, fragment: SHADERS.terrainFrag }, vertexBuffers: [terrainLayout], bindGroups: [FRAME_GROUP, MESH_GROUP] })),
      terrainShadow: d.createPipeline({
        label: 'terrain-shadow',
        shader: { label: 'terrain-shadow', vertex: SHADERS.terrainVert, fragment: SHADERS.depthSimpleFrag, defines: { SHADOW_PASS: 1 } },
        vertexBuffers: [terrainLayout],
        bindGroups: [FRAME_GROUP],
        colorFormats: [],
        depthFormat: 'depth32float',
        cullMode: 'none',
        depthBias: { constant: 2, slope: 2.5 },
      }),
      water: d.createPipeline(base({
        label: 'water',
        shader: { label: 'water', vertex: SHADERS.waterVert, fragment: SHADERS.waterFrag },
        vertexBuffers: [{ arrayStride: 12, attributes: [{ location: 0, format: 'float32x3', offset: 0 }] }],
        bindGroups: [FRAME_GROUP, { entries: [{ binding: 0, kind: 'uniform', name: 'WaterUniforms' }, { binding: 1, kind: 'texture', name: 'uShadow' }, { binding: 2, kind: 'texture', name: 'uHeight' }] }],
        blend: 'alpha',
        depthWrite: false,
        cullMode: 'none',
      })),
      sky: d.createPipeline(base({ label: 'sky', shader: { label: 'sky', vertex: SHADERS.skyVert, fragment: SHADERS.skyFrag }, depthWrite: false, depthCompare: 'lequal', cullMode: 'none' })),
      bloomDown: d.createPipeline({
        label: 'bloom-down',
        shader: { label: 'bloom', vertex: SHADERS.fullscreenVert, fragment: SHADERS.bloomFrag },
        vertexBuffers: [],
        bindGroups: [{ entries: [{ binding: 0, kind: 'uniform', name: 'PostUniforms' }, { binding: 1, kind: 'texture', name: 'uSrc' }] }],
        colorFormats: [hdr],
        depthTest: false,
        depthWrite: false,
        cullMode: 'none',
      }),
      bloomUp: d.createPipeline({
        label: 'bloom-up',
        shader: { label: 'bloom', vertex: SHADERS.fullscreenVert, fragment: SHADERS.bloomFrag },
        vertexBuffers: [],
        bindGroups: [{ entries: [{ binding: 0, kind: 'uniform', name: 'PostUniforms' }, { binding: 1, kind: 'texture', name: 'uSrc' }] }],
        colorFormats: [hdr],
        depthTest: false,
        depthWrite: false,
        cullMode: 'none',
        blend: 'additive',
      }),
      composite: d.createPipeline({
        label: 'composite',
        shader: { label: 'composite', vertex: SHADERS.fullscreenVert, fragment: SHADERS.compositeFrag },
        vertexBuffers: [],
        bindGroups: [{ entries: [{ binding: 0, kind: 'uniform', name: 'CompositeUniforms' }, { binding: 1, kind: 'texture', name: 'uHDR' }, { binding: 2, kind: 'texture', name: 'uBloom' }] }],
        colorFormats: ['rgba8unorm'],
        depthTest: false,
        depthWrite: false,
        cullMode: 'none',
      }),
    };
  }

  createModel(data: ModelData): GpuModel {
    const d = this.device;
    const vb = d.createBuffer({ size: data.vertices.byteLength, usage: 'vertex', data: new Uint8Array(data.vertices), label: data.name });
    const ib = d.createBuffer({ size: data.indices.byteLength, usage: 'index', data: data.indices, label: data.name + '-idx' });
    const animIndex = new Map<string, number>();
    data.animations.forEach((a, i) => animIndex.set(a.name, i));
    return { name: data.name, data, vb, ib, indexCount: data.indices.length, indexFormat: data.indices instanceof Uint32Array ? 'uint32' : 'uint16', skinned: data.joints.length > 0, animIndex };
  }

  private ensureTargets() {
    const d = this.device;
    const w = d.backbufferWidth, h = d.backbufferHeight;
    if (this.targets && this.targets.w === w && this.targets.h === h) return this.targets;
    if (this.targets) {
      const t = this.targets;
      [t.msaaColor, t.msaaDepth, t.hdr, ...t.bloom].forEach((x) => x.destroy());
      (d as any).invalidateFramebuffers?.();
    }
    const bloom: Texture[] = [];
    let bw = w, bh = h;
    for (let i = 0; i < 5; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      bloom.push(d.createTexture({ width: bw, height: bh, format: this.hdrFormat, renderTarget: true, label: `bloom${i}` }));
    }
    this.targets = {
      w, h,
      msaaColor: d.createTexture({ width: w, height: h, format: this.hdrFormat, sampleCount: this.samples, renderTarget: true, label: 'msaa-color' }),
      msaaDepth: d.createTexture({ width: w, height: h, format: 'depth24', sampleCount: this.samples, renderTarget: true, label: 'msaa-depth' }),
      hdr: d.createTexture({ width: w, height: h, format: this.hdrFormat, renderTarget: true, label: 'hdr' }),
      bloom,
    };
    return this.targets;
  }

  private writeFrame(view: SceneView, lightVP: M4, shadowMatrix: M4) {
    const L = view.lighting ?? DEFAULT_LIGHTING;
    const f = this.frameData;
    const vp = m4Mul(view.camera.proj, view.camera.view);
    f.set(vp, 0);
    f.set(m4Invert(vp), 16);
    f.set(shadowMatrix, 32);
    f.set(lightVP, 48);
    let o = 64;
    const v4 = (a: number, b: number, c: number, d: number) => {
      f[o++] = a; f[o++] = b; f[o++] = c; f[o++] = d;
    };
    const col = (hex: number, w: number) => {
      const c = hexToLinear(hex);
      v4(c[0], c[1], c[2], w);
    };
    const cp = view.camera.pos;
    v4(cp[0], cp[1], cp[2], view.time);
    v4(L.sunDir[0], L.sunDir[1], L.sunDir[2], L.sunIntensity);
    col(L.sunColor, L.shadowStrength);
    col(L.skyColor, L.ambient);
    col(L.groundColor, L.rim);
    col(L.fogColor, L.fogDensity);
    v4(L.fogStart, 0.02, 0, 0);
    v4(0.8, 0.6, 0.06, 1.3);
    v4(1 / this.shadowSize, 0.06, 0.0006, 1);
    const d = this.device;
    v4(d.backbufferWidth, d.backbufferHeight, 1 / d.backbufferWidth, 1 / d.backbufferHeight);
    v4(view.grid?.cell ?? 3, view.grid?.opacity ?? 0, 0, 0);
    const teams = view.teamColors ?? [0x2f6fd0, 0xc8322b, 0x2e9e5b, 0xe0a82e, 0x7a4bc2, 0xd9d2c0, 0x30b0c0, 0xe06a2e];
    for (let i = 0; i < 8; i++) col(teams[i % teams.length], 1);
    d.writeBuffer(this.frameUBO, 0, f);
  }

  private computeShadow(view: SceneView): { lightVP: M4; shadowMatrix: M4 } {
    const L = view.lighting ?? DEFAULT_LIGHTING;
    const cc = this.device.caps.clip;
    const r = view.camera.shadowRadius;
    const sun = normalize(L.sunDir);
    // light basis
    const up: V3 = Math.abs(sun[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0];
    const right = normalize(cross(up, sun));
    const lup = cross(sun, right);
    // stabilise: snap the target to shadow texels in light space
    const texel = (2 * r) / this.shadowSize;
    const t = view.camera.target;
    const tx = Math.round(dot(t, right) / texel) * texel;
    const ty = Math.round(dot(t, lup) / texel) * texel;
    const tz = dot(t, sun);
    const center = add(add(scale(right, tx), scale(lup, ty)), scale(sun, tz));
    const eye = add(center, scale(sun, r * 3));
    const lv = m4LookAt(eye, center, lup);
    const lp = m4Ortho(-r, r, -r, r, 0.1, r * 6, cc);
    const lightVP = m4Mul(lp, lv);
    // clip → texture space [0,1]
    const bias = m4();
    bias[0] = 0.5; bias[12] = 0.5;
    bias[5] = this.device.caps.uvOriginTop ? -0.5 : 0.5; bias[13] = 0.5;
    if (cc.depthZeroToOne) { bias[10] = 1; bias[14] = 0; } else { bias[10] = 0.5; bias[14] = 0.5; }
    return { lightVP, shadowMatrix: m4Mul(bias, lightVP) };
  }

  render(view: SceneView) {
    const d = this.device;
    const tg = this.ensureTargets();
    this.arena.reset();
    this.stats = { drawCalls: 0, triangles: 0, instances: 0 };
    const { lightVP, shadowMatrix } = this.computeShadow(view);
    this.writeFrame(view, lightVP, shadowMatrix);
    const L = view.lighting ?? DEFAULT_LIGHTING;

    // ---- build instance + joint data, grouped by model
    const groups = new Map<GpuModel, RenderInstance[]>();
    for (const inst of view.instances) {
      let g = groups.get(inst.model);
      if (!g) groups.set(inst.model, (g = []));
      g.push(inst);
    }
    let n = 0, jointRow = 0;
    const draws: { model: GpuModel; first: number; count: number }[] = [];
    if (view.instances.length > this.instCap) {
      this.instCap = Math.ceil(view.instances.length * 1.5);
      this.instData = new Float32Array(this.instCap * INSTANCE_FLOATS);
      this.instBuf.destroy();
      this.instBuf = d.createBuffer({ size: this.instData.byteLength, usage: 'vertex', dynamic: true, label: 'instances' });
    }
    const rowFloats = MAX_JOINTS * JOINT_TEXELS * 4;
    for (const [model, list] of groups) {
      const first = n;
      for (const inst of list) {
        const o = n * INSTANCE_FLOATS;
        this.instData.set(inst.matrix, o);
        let row = -1;
        if (model.skinned && jointRow < this.jointRows) {
          row = jointRow++;
          const ai = inst.anim !== undefined ? model.animIndex.get(inst.anim) : model.data.animations.length ? 0 : undefined;
          const anim = ai !== undefined ? model.data.animations[ai] : null;
          poseJoints(model.data, anim, inst.animTime ?? view.time, this.jointData, row * rowFloats);
        }
        this.instData[o + 16] = inst.team;
        this.instData[o + 17] = row;
        this.instData[o + 18] = inst.highlight ?? 0;
        this.instData[o + 19] = inst.buildClip ?? 1e6;
        n++;
      }
      draws.push({ model, first, count: n - first });
    }
    if (n) d.writeBuffer(this.instBuf, 0, this.instData.subarray(0, n * INSTANCE_FLOATS));
    if (jointRow) d.writeTexture(this.jointTex, this.jointData.subarray(0, jointRow * rowFloats), { x: 0, y: 0, w: MAX_JOINTS * JOINT_TEXELS, h: jointRow });
    this.stats.instances = n;

    const frameGroupFor = (p: Pipeline) => d.createBindGroup(p, 0, [{ binding: 0, buffer: this.frameUBO }]);

    // ---- shadow pass
    {
      const pass = d.beginRenderPass({ label: 'shadow', color: [], depth: { texture: this.shadowMap, load: 'clear', clearDepth: 1 } });
      if (view.terrain) {
        pass.setPipeline(this.pipes.terrainShadow);
        pass.setBindGroup(0, frameGroupFor(this.pipes.terrainShadow));
        pass.setVertexBuffer(0, view.terrain.vb);
        pass.setIndexBuffer(view.terrain.ib, view.terrain.indexFormat);
        pass.drawIndexed(view.terrain.indexCount);
      }
      pass.setPipeline(this.pipes.meshShadow);
      pass.setBindGroup(0, frameGroupFor(this.pipes.meshShadow));
      pass.setBindGroup(1, d.createBindGroup(this.pipes.meshShadow, 1, [{ binding: 0, texture: this.jointTex, sampler: this.nearestClamp }]));
      for (const dr of draws) {
        pass.setVertexBuffer(0, dr.model.vb);
        pass.setVertexBuffer(1, this.instBuf, dr.first * INSTANCE_FLOATS * 4);
        pass.setIndexBuffer(dr.model.ib, dr.model.indexFormat);
        pass.drawIndexed(dr.model.indexCount, dr.count);
      }
      pass.end();
    }

    // ---- main pass
    {
      const cc = view.clearColor ?? [0.5, 0.6, 0.7];
      const pass = d.beginRenderPass({
        label: 'main',
        color: [{ texture: tg.msaaColor, resolveTarget: tg.hdr, load: 'clear', clearColor: [cc[0], cc[1], cc[2], 1] }],
        depth: { texture: tg.msaaDepth, load: 'clear', clearDepth: 1 },
      });
      const meshGroup = (p: Pipeline) => d.createBindGroup(p, 1, [
        { binding: 0, texture: this.jointTex, sampler: this.nearestClamp },
        { binding: 1, texture: this.shadowMap, sampler: this.shadowSampler },
      ]);
      if (view.terrain) {
        pass.setPipeline(this.pipes.terrain);
        pass.setBindGroup(0, frameGroupFor(this.pipes.terrain));
        pass.setBindGroup(1, meshGroup(this.pipes.terrain));
        pass.setVertexBuffer(0, view.terrain.vb);
        pass.setIndexBuffer(view.terrain.ib, view.terrain.indexFormat);
        pass.drawIndexed(view.terrain.indexCount);
        this.stats.drawCalls++;
        this.stats.triangles += view.terrain.indexCount / 3;
      }
      pass.setPipeline(this.pipes.mesh);
      pass.setBindGroup(0, frameGroupFor(this.pipes.mesh));
      pass.setBindGroup(1, meshGroup(this.pipes.mesh));
      for (const dr of draws) {
        pass.setVertexBuffer(0, dr.model.vb);
        pass.setVertexBuffer(1, this.instBuf, dr.first * INSTANCE_FLOATS * 4);
        pass.setIndexBuffer(dr.model.ib, dr.model.indexFormat);
        pass.drawIndexed(dr.model.indexCount, dr.count);
        this.stats.drawCalls++;
        this.stats.triangles += (dr.model.indexCount / 3) * dr.count;
      }
      if (view.sky !== false) {
        pass.setPipeline(this.pipes.sky);
        pass.setBindGroup(0, frameGroupFor(this.pipes.sky));
        pass.draw(3);
      }
      if (view.terrain && view.terrain.water) {
        const w = view.terrain.water;
        pass.setPipeline(this.pipes.water);
        pass.setBindGroup(0, frameGroupFor(this.pipes.water));
        const u = this.arena.push(w.uniforms);
        pass.setBindGroup(1, d.createBindGroup(this.pipes.water, 1, [
          { binding: 0, buffer: this.arena.buffer, offset: u.offset, size: u.size },
          { binding: 1, texture: this.shadowMap, sampler: this.shadowSampler },
          { binding: 2, texture: w.heightTex, sampler: this.linearClamp },
        ]));
        pass.setVertexBuffer(0, w.vb);
        pass.draw(w.vertexCount);
      }
      pass.end();
    }

    // ---- bloom
    const post = (pipe: Pipeline, src: Texture, dst: Texture, params: number[], load: 'clear' | 'load') => {
      const pass = d.beginRenderPass({ label: 'bloom', color: [{ texture: dst, load, clearColor: [0, 0, 0, 1] }] });
      pass.setPipeline(pipe);
      const u = this.arena.push(new Float32Array(params));
      pass.setBindGroup(0, d.createBindGroup(pipe, 0, [
        { binding: 0, buffer: this.arena.buffer, offset: u.offset, size: u.size },
        { binding: 1, texture: src, sampler: this.linearClamp },
      ]));
      pass.draw(3);
      pass.end();
    };
    const B = tg.bloom;
    post(this.pipes.bloomDown, tg.hdr, B[0], [1 / tg.w, 1 / tg.h, 0, 1.2, 0.6, 1, 1, 0], 'clear');
    for (let i = 1; i < B.length; i++) post(this.pipes.bloomDown, B[i - 1], B[i], [1 / B[i - 1].width, 1 / B[i - 1].height, 1, 0, 0.5, 1, 1, 0], 'clear');
    for (let i = B.length - 1; i > 0; i--) post(this.pipes.bloomUp, B[i], B[i - 1], [1 / B[i].width, 1 / B[i].height, 2, 0, 0.5, 1, 0.9, 0], 'load');

    // ---- composite to backbuffer
    {
      const pass = d.beginRenderPass({ label: 'composite', color: [{ texture: null, load: 'clear', clearColor: [0, 0, 0, 1] }] });
      pass.setPipeline(this.pipes.composite);
      const u = this.arena.push(new Float32Array([L.exposure, L.saturation, L.contrast, L.bloom, L.warmth[0], L.warmth[1], L.warmth[2], L.vignette, view.time, 1, 0, 0]));
      pass.setBindGroup(0, d.createBindGroup(this.pipes.composite, 0, [
        { binding: 0, buffer: this.arena.buffer, offset: u.offset, size: u.size },
        { binding: 1, texture: tg.hdr, sampler: this.linearClamp },
        { binding: 2, texture: B[0], sampler: this.linearClamp },
      ]));
      pass.draw(3);
      pass.end();
    }
  }
}

export { sub };
