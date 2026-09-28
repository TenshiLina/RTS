// RHI — Render Hardware Interface.
//
// The renderer talks ONLY to these interfaces. They are deliberately shaped after the explicit
// APIs (Metal / Vulkan / D3D12 / WebGPU) rather than after OpenGL:
//   * immutable pipeline state objects (shader + vertex layout + blend/depth/raster state)
//   * resources bound in groups ("sets") with explicit binding indices; uniforms only via
//     uniform/constant buffers (std140) — no loose GL uniforms
//   * render passes with explicit load/clear ops and MSAA resolve targets
//   * the backend reports its clip-space convention; projection math adapts (see core/math.ts)
//
// Backends: webgl2 (now). Planned: webgpu, and native metal / vulkan / d3d11 via a C++ or Rust
// host that implements this same surface (see docs/ARCHITECTURE.md). D3D11 maps cleanly because
// we never rely on bindless resources or descriptor indexing.

import type { ClipConvention } from '../../core/math';

export type BackendKind = 'webgl2' | 'webgpu' | 'metal' | 'vulkan' | 'd3d11';

export interface DeviceCaps {
  backend: BackendKind;
  clip: ClipConvention;
  /** true when render-target texture coordinates start at the top-left (Metal/Vulkan/D3D) */
  uvOriginTop: boolean;
  maxSamples: number;
  floatRenderTargets: boolean;
  /** required alignment of dynamic uniform buffer offsets */
  uniformAlign: number;
  maxTextureSize: number;
}

export type TextureFormat =
  | 'rgba8unorm'
  /** 8-bit colour stored sRGB-encoded; sampling returns linear values */
  | 'rgba8unorm-srgb'
  | 'rgba16float'
  | 'rgba32float'
  | 'r16float'
  | 'r32float'
  | 'rg16float'
  | 'depth24'
  | 'depth32float';

export type VertexFormat =
  | 'float32'
  | 'float32x2'
  | 'float32x3'
  | 'float32x4'
  | 'unorm8x4'
  | 'snorm8x4'
  | 'uint8x4';

export interface Buffer {
  readonly size: number;
  readonly usage: BufferUsage;
  destroy(): void;
}
export type BufferUsage = 'vertex' | 'index' | 'uniform';

export interface Texture {
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly sampleCount: number;
  destroy(): void;
}

export interface Sampler {
  readonly _sampler: true;
}

export interface Pipeline {
  readonly label: string;
}

export interface BindGroup {
  readonly _bindGroup: true;
}

export interface BufferDesc {
  size: number;
  usage: BufferUsage;
  data?: ArrayBufferView;
  dynamic?: boolean;
  label?: string;
}

export interface TextureDesc {
  width: number;
  height: number;
  format: TextureFormat;
  sampleCount?: number;
  mipmaps?: boolean;
  renderTarget?: boolean;
  /** sampled via a comparison sampler (shadow maps) */
  depthCompare?: boolean;
  data?: ArrayBufferView;
  /** decoded platform image (see Platform.decodeImage) to upload instead of `data` */
  source?: unknown;
  label?: string;
}

export interface SamplerDesc {
  filter?: 'linear' | 'nearest';
  mipmaps?: boolean;
  wrap?: 'repeat' | 'clamp';
  compare?: 'less' | 'lequal';
  anisotropy?: number;
}

export interface VertexAttributeDesc {
  location: number;
  format: VertexFormat;
  offset: number;
}
export interface VertexBufferLayout {
  arrayStride: number;
  stepMode?: 'vertex' | 'instance';
  attributes: VertexAttributeDesc[];
}

export type BindingKind = 'uniform' | 'texture';
export interface BindGroupLayout {
  entries: { binding: number; kind: BindingKind; name: string }[];
}

/** Shaders are authored once in GLSL 4.50 (Vulkan dialect). Backends translate:
 *  webgl2 → GLSL ES 3.00 at runtime; native → SPIR-V (glslang) → MSL / HLSL (SPIRV-Cross). */
export interface ShaderSource {
  label: string;
  vertex: string;
  fragment: string;
  defines?: Record<string, string | number | boolean>;
}

export type BlendMode = 'opaque' | 'alpha' | 'additive' | 'premultiplied';
export type CompareFunc = 'never' | 'less' | 'lequal' | 'equal' | 'greater' | 'gequal' | 'always';

export interface PipelineDesc {
  label: string;
  shader: ShaderSource;
  vertexBuffers: VertexBufferLayout[];
  /** index = set number */
  bindGroups: BindGroupLayout[];
  topology?: 'triangle-list' | 'line-list';
  cullMode?: 'none' | 'back' | 'front';
  depthTest?: boolean;
  depthWrite?: boolean;
  depthCompare?: CompareFunc;
  depthBias?: { constant: number; slope: number };
  blend?: BlendMode;
  colorFormats: TextureFormat[];
  depthFormat?: TextureFormat;
  sampleCount?: number;
  colorWrite?: boolean;
}

export interface BindGroupEntry {
  binding: number;
  buffer?: Buffer;
  offset?: number;
  size?: number;
  texture?: Texture;
  sampler?: Sampler;
}

export interface ColorAttachment {
  /** null = the swapchain / canvas backbuffer */
  texture: Texture | null;
  resolveTarget?: Texture;
  load: 'clear' | 'load';
  clearColor?: [number, number, number, number];
}
export interface RenderPassDesc {
  label?: string;
  color: ColorAttachment[];
  depth?: { texture: Texture; load: 'clear' | 'load'; clearDepth?: number };
}

export interface RenderPass {
  setPipeline(p: Pipeline): void;
  setVertexBuffer(slot: number, buffer: Buffer, offset?: number): void;
  setIndexBuffer(buffer: Buffer, format: 'uint16' | 'uint32'): void;
  setBindGroup(index: number, group: BindGroup, dynamicOffsets?: number[]): void;
  setViewport(x: number, y: number, w: number, h: number): void;
  draw(vertexCount: number, instanceCount?: number, firstVertex?: number): void;
  drawIndexed(indexCount: number, instanceCount?: number, firstIndex?: number): void;
  end(): void;
}

export interface Device {
  readonly caps: DeviceCaps;
  readonly backbufferWidth: number;
  readonly backbufferHeight: number;
  resize(width: number, height: number): void;
  createBuffer(desc: BufferDesc): Buffer;
  writeBuffer(buffer: Buffer, offset: number, data: ArrayBufferView): void;
  createTexture(desc: TextureDesc): Texture;
  writeTexture(texture: Texture, data: ArrayBufferView, region?: { x: number; y: number; w: number; h: number }): void;
  createSampler(desc: SamplerDesc): Sampler;
  createPipeline(desc: PipelineDesc): Pipeline;
  createBindGroup(pipeline: Pipeline, index: number, entries: BindGroupEntry[]): BindGroup;
  beginRenderPass(desc: RenderPassDesc): RenderPass;
  /** Read back the backbuffer (debug/screenshots). */
  readPixels?(x: number, y: number, w: number, h: number): Uint8Array;
}
