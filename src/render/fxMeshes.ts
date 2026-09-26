// Procedural 3D effect meshes: the shapes particles cannot sell at RTS zoom — faceted ice (lances,
// spikes, blocks that encase units), the rolling wave, the whirlwind funnel, flame columns,
// domes. Generated once at start-up; drawn instanced with effect materials (fxmesh.frag).

import type { Device, Pipeline, Buffer, RenderPass, BindGroup } from './rhi/types';
import { SHADERS } from './shaders';
import type { Renderer, FxEnv, FxLayer } from './renderer';
import type { M4 } from '../core/math';

export const MESH = { shard: 0, spike: 1, block: 2, wave: 3, funnel: 4, column: 5, dome: 6, chunk: 7 } as const;
export const MAT = { ice: 0, water: 1, wind: 2, dust: 3, fire: 4, energy: 5 } as const;

export interface FxMeshInstance {
  mesh: number;
  mat: number;
  matrix: M4;
  color: [number, number, number, number];
  /** seconds since the effect started (drives animation) */
  age: number;
  /** 0..1 overall opacity (dissolve / fade) */
  fade: number;
  seed: number;
}

interface GeoData {
  pos: number[];
  nrm: number[];
  uv: number[];
  idx: number[];
}

let rngState = 12345;
const rnd = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
};

function flat(tris: [number, number, number][], verts: number[][]): GeoData {
  // unshared vertices + face normals (faceted look)
  const g: GeoData = { pos: [], nrm: [], uv: [], idx: [] };
  for (const [a, b, c] of tris) {
    const A = verts[a], B = verts[b], C = verts[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const P of [A, B, C]) {
      g.idx.push(g.pos.length / 3);
      g.pos.push(P[0], P[1], P[2]);
      g.nrm.push(nx, ny, nz);
      g.uv.push(P[0] * 0.5 + 0.5, P[1]);
    }
  }
  return g;
}

/** Faceted crystal: ring of `sides` at mid height, pointed at both ends (y from 0 to 1). */
function crystal(sides: number, midY: number, radius: number, jitter: number, tipLow = true): GeoData {
  const verts: number[][] = [];
  const tris: [number, number, number][] = [];
  const top = verts.push([(rnd() - 0.5) * jitter * 0.4, 1, (rnd() - 0.5) * jitter * 0.4]) - 1;
  const bot = verts.push([0, tipLow ? 0 : 0, 0]) - 1;
  const ring: number[] = [];
  const ring2: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    const r = radius * (1 - jitter * 0.5 + rnd() * jitter);
    ring.push(verts.push([Math.cos(a) * r, midY + (rnd() - 0.5) * jitter * 0.1, Math.sin(a) * r]) - 1);
    const r2 = r * (tipLow ? 0.55 : 0.98);
    ring2.push(verts.push([Math.cos(a) * r2, tipLow ? midY * 0.35 : 0.02, Math.sin(a) * r2]) - 1);
  }
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tris.push([ring[i], top, ring[j]]);
    tris.push([ring2[i], ring[i], ring[j]]);
    tris.push([ring2[i], ring[j], ring2[j]]);
    tris.push([ring2[j], bot, ring2[i]]);
  }
  return flat(tris, verts);
}

/** Irregular chamfered block (y 0..1, x/z −0.5..0.5) for units frozen solid. */
function block(): GeoData {
  const verts: number[][] = [];
  const tris: [number, number, number][] = [];
  const rows = [0, 0.3, 0.72, 1];
  const sides = 8;
  const idx: number[][] = [];
  for (const [ri, y] of rows.entries()) {
    const row: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
      const r = (ri === 0 || ri === rows.length - 1 ? 0.5 : 0.62) * (0.85 + rnd() * 0.3);
      row.push(verts.push([Math.cos(a) * r, y + (ri > 0 && ri < rows.length - 1 ? (rnd() - 0.5) * 0.12 : 0), Math.sin(a) * r]) - 1);
    }
    idx.push(row);
  }
  const cTop = verts.push([0, 1.04, 0]) - 1;
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tris.push([idx[r][i], idx[r + 1][i], idx[r + 1][j]]);
      tris.push([idx[r][i], idx[r + 1][j], idx[r][j]]);
    }
  }
  for (let i = 0; i < sides; i++) tris.push([idx[rows.length - 1][i], cTop, idx[rows.length - 1][(i + 1) % sides]]);
  return flat(tris, verts);
}

/** Smooth grid surface from a parametric function (u across, v along). */
function sheet(nu: number, nv: number, f: (u: number, v: number) => [number, number, number]): GeoData {
  const g: GeoData = { pos: [], nrm: [], uv: [], idx: [] };
  const P: [number, number, number][] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) P.push(f(i / nu, j / nv));
  const at = (i: number, j: number) => P[Math.min(nv, Math.max(0, j)) * (nu + 1) + Math.min(nu, Math.max(0, i))];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = at(i, j);
      const du = [at(i + 1, j)[0] - at(i - 1, j)[0], at(i + 1, j)[1] - at(i - 1, j)[1], at(i + 1, j)[2] - at(i - 1, j)[2]];
      const dv = [at(i, j + 1)[0] - at(i, j - 1)[0], at(i, j + 1)[1] - at(i, j - 1)[1], at(i, j + 1)[2] - at(i, j - 1)[2]];
      let nx = du[1] * dv[2] - du[2] * dv[1], ny = du[2] * dv[0] - du[0] * dv[2], nz = du[0] * dv[1] - du[1] * dv[0];
      const l = Math.hypot(nx, ny, nz) || 1;
      g.pos.push(p[0], p[1], p[2]);
      g.nrm.push(nx / l, ny / l, nz / l);
      g.uv.push(i / nu, j / nv);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      g.idx.push(a, c, b, b, c, d);
    }
  }
  return g;
}

function catmull(pts: [number, number][], t: number): [number, number] {
  const n = pts.length - 1;
  const x = Math.min(n - 1e-6, Math.max(0, t * n));
  const i = Math.floor(x), f = x - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n, i + 1)], p3 = pts[Math.min(n, i + 2)];
  const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * f + (2 * a - 5 * b + 4 * c2 - d) * f * f + (-a + 3 * b - 3 * c2 + d) * f * f * f);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

function buildGeometry(): GeoData[] {
  rngState = 12345;
  const geos: GeoData[] = [];
  geos[MESH.shard] = crystal(6, 0.62, 0.5, 0.35); // lance / shard, y 0..1
  geos[MESH.spike] = crystal(7, 0.12, 1, 0.45, false); // ground spike, base at y = 0
  geos[MESH.block] = block();
  // wave: profile in (z forward, y up): long back slope → crest → curling lip
  const prof: [number, number][] = [[-1.3, 0], [-0.75, 0.22], [-0.3, 0.62], [0.02, 0.95], [0.26, 1.02], [0.44, 0.86], [0.5, 0.58], [0.44, 0.36]];
  geos[MESH.wave] = sheet(28, 22, (u, v) => {
    const x = u - 0.5;
    const [z, y] = catmull(prof, v);
    const taper = 1 - Math.pow(Math.abs(x) * 2, 3);
    return [x, y * (0.25 + 0.75 * taper), z * (0.6 + 0.4 * taper)];
  });
  // funnel: narrow at the ground, flaring toward the sky (y 0..1, radius 1 at the top)
  geos[MESH.funnel] = sheet(28, 18, (u, v) => {
    const a = u * Math.PI * 2;
    const r = 0.1 + 0.9 * Math.pow(v, 1.7);
    return [Math.cos(a) * r, v, Math.sin(a) * r];
  });
  geos[MESH.column] = sheet(24, 8, (u, v) => {
    const a = u * Math.PI * 2;
    return [Math.cos(a), v, Math.sin(a)];
  });
  geos[MESH.dome] = sheet(24, 10, (u, v) => {
    const a = u * Math.PI * 2, e = v * Math.PI * 0.5;
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  });
  geos[MESH.chunk] = crystal(4, 0.5, 0.6, 0.6);
  return geos;
}

const INST_FLOATS = 24;

export class FxMeshRenderer implements FxLayer {
  instances: FxMeshInstance[] = [];
  private meshes: { vb: Buffer; ib: Buffer; count: number }[] = [];
  private pSolid: Pipeline;
  private pAlpha: Pipeline;
  private pAdd: Pipeline;
  private inst: Buffer;
  private cap = 512;
  private data = new Float32Array(512 * INST_FLOATS);

  constructor(private device: Device, renderer: Renderer) {
    for (const g of buildGeometry()) {
      const n = g.pos.length / 3;
      const v = new Float32Array(n * 8);
      for (let i = 0; i < n; i++) {
        v.set([g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2], g.nrm[i * 3], g.nrm[i * 3 + 1], g.nrm[i * 3 + 2], g.uv[i * 2], g.uv[i * 2 + 1]], i * 8);
      }
      this.meshes.push({
        vb: device.createBuffer({ size: v.byteLength, usage: 'vertex', data: v, label: 'fx-mesh' }),
        ib: device.createBuffer({ size: g.idx.length * 2, usage: 'index', data: new Uint16Array(g.idx), label: 'fx-mesh-idx' }),
        count: g.idx.length,
      });
    }
    const base = (label: string, blend: 'alpha' | 'additive', depthWrite: boolean) => device.createPipeline({
      label,
      shader: { label: 'fxmesh', vertex: SHADERS.fxMeshVert, fragment: SHADERS.fxMeshFrag, defines: { ADDITIVE: blend === 'additive' } as Record<string, boolean> },
      vertexBuffers: [
        { arrayStride: 32, attributes: [{ location: 0, format: 'float32x3', offset: 0 }, { location: 1, format: 'float32x3', offset: 12 }, { location: 2, format: 'float32x2', offset: 24 }] },
        {
          arrayStride: INST_FLOATS * 4,
          stepMode: 'instance',
          attributes: [0, 1, 2, 3, 4, 5].map((i) => ({ location: 4 + i, format: 'float32x4' as const, offset: i * 16 })),
        },
      ],
      bindGroups: [{ entries: [{ binding: 0, kind: 'uniform', name: 'FrameUniforms' }] }, { entries: [{ binding: 0, kind: 'texture', name: 'uFxMap' }] }],
      colorFormats: [renderer.hdrColorFormat],
      depthFormat: 'depth24',
      sampleCount: renderer.sampleCount,
      blend: blend === 'additive' ? 'additive' : 'alpha',
      depthWrite,
      depthCompare: 'lequal',
      cullMode: 'none',
    });
    this.pSolid = base('fx-solid', 'alpha', true);
    this.pAlpha = base('fx-alpha', 'alpha', false);
    this.pAdd = base('fx-add', 'additive', false);
    this.inst = device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'fx-mesh-inst' });
  }

  private pipeFor(mat: number) {
    return mat === MAT.ice ? 0 : mat === MAT.water || mat === MAT.dust ? 1 : 2;
  }

  draw(pass: RenderPass, frameGroup: BindGroup, env: FxEnv) {
    const list = this.instances;
    if (!list.length) return;
    // sort by pipeline then mesh so each run is one instanced draw
    const sorted = [...list].sort((a, b) => this.pipeFor(a.mat) - this.pipeFor(b.mat) || a.mesh - b.mesh);
    if (sorted.length > this.cap) {
      while (this.cap < sorted.length) this.cap *= 2;
      this.data = new Float32Array(this.cap * INST_FLOATS);
      this.inst.destroy();
      this.inst = this.device.createBuffer({ size: this.data.byteLength, usage: 'vertex', dynamic: true, label: 'fx-mesh-inst' });
    }
    sorted.forEach((it, i) => {
      const o = i * INST_FLOATS;
      this.data.set(it.matrix, o);
      this.data.set(it.color, o + 16);
      this.data[o + 20] = it.mat;
      this.data[o + 21] = it.age;
      this.data[o + 22] = it.fade;
      this.data[o + 23] = it.seed;
    });
    this.device.writeBuffer(this.inst, 0, this.data.subarray(0, sorted.length * INST_FLOATS));
    const pipes = [this.pSolid, this.pAlpha, this.pAdd];
    let i = 0;
    while (i < sorted.length) {
      const pi = this.pipeFor(sorted[i].mat), mesh = sorted[i].mesh;
      let j = i;
      while (j < sorted.length && this.pipeFor(sorted[j].mat) === pi && sorted[j].mesh === mesh) j++;
      const p = pipes[pi];
      pass.setPipeline(p);
      pass.setBindGroup(0, frameGroup);
      pass.setBindGroup(1, this.device.createBindGroup(p, 1, [{ binding: 0, texture: env.groundFx, sampler: this.sampler() }]));
      const m = this.meshes[mesh];
      pass.setVertexBuffer(0, m.vb);
      pass.setVertexBuffer(1, this.inst, i * INST_FLOATS * 4);
      pass.setIndexBuffer(m.ib, 'uint16');
      pass.drawIndexed(m.count, j - i);
      i = j;
    }
  }
  private _sampler?: ReturnType<Device['createSampler']>;
  private sampler() {
    return (this._sampler ??= this.device.createSampler({ filter: 'linear', wrap: 'clamp' }));
  }
}
