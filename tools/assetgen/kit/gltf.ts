// Minimal glTF 2.0 binary (.glb) writer. Output opens in Blender / any glTF viewer, and is what
// every engine backend (WebGL2 today; Metal / Vulkan / D3D11 later) loads.

import { V3, Quat, m4Translate, sub } from '../../../src/core/math';
import { hexToLinear, MaterialDef } from '../../../src/core/materialModel';
import type { MeshBuilder } from './mesh';

export interface JointDef {
  name: string;
  parent: number; // -1 for root
  pos: V3; // bind-pose position in model space
}
export interface AnimTrackSample {
  r?: Quat;
  t?: V3; // offset added to the rest translation
}
export interface AnimDef {
  name: string;
  duration: number; // seconds
  fps?: number;
  /** each track receives normalised phase 0..1 */
  tracks: Record<string, (phase: number) => AnimTrackSample>;
}
export interface SocketDef {
  name: string;
  pos: V3; // model-space
  joint?: string;
}
export interface ExportOptions {
  ao?: Float32Array;
  /** baked texture atlas (encoded images) for painted materials */
  atlas?: { albedo: Uint8Array; surface: Uint8Array; mime: string };
  skeleton?: JointDef[];
  animations?: AnimDef[];
  sockets?: SocketDef[];
  extras?: Record<string, unknown>;
}

class BinWriter {
  chunks: Uint8Array[] = [];
  length = 0;
  views: any[] = [];
  accessors: any[] = [];
  add(data: ArrayBufferView, target?: number, byteStride?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.length += pad;
    }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const view: any = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) view.target = target;
    if (byteStride) view.byteStride = byteStride;
    this.chunks.push(bytes.slice());
    this.length += bytes.byteLength;
    this.views.push(view);
    return this.views.length - 1;
  }
  accessor(a: any): number {
    this.accessors.push(a);
    return this.accessors.length - 1;
  }
  concat(): Uint8Array {
    const pad = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + pad);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126, UBYTE = 5121, USHORT = 5123, UINT = 5125;

export function exportGLB(mb: MeshBuilder, opts: ExportOptions = {}): Uint8Array {
  const { ao, skeleton, animations = [], sockets = [], extras = {}, atlas } = opts;
  const skinned = !!skeleton && skeleton.length > 0;
  const hasSway = mb.tris.some((t) => t.sway.some((s) => s > 0));

  // ---- double-sided materials: emit the reverse face so meshes can render with back-face culling
  const srcTris = mb.tris;
  const tris = [...srcTris];
  const aoSrc = ao;
  let aoAll = ao;
  const dsMats = new Set(mb.materials.map((m, i) => (m.doubleSided ? i : -1)).filter((i) => i >= 0));
  if (dsMats.size) {
    const extra: number[] = [];
    srcTris.forEach((t, ti) => {
      if (!dsMats.has(t.mat)) return;
      tris.push({ ...t, p: [t.p[0], t.p[2], t.p[1]], n: [t.n[0], t.n[2], t.n[1]].map((n) => [-n[0], -n[1], -n[2]]) as any, uv: [t.uv[0], t.uv[2], t.uv[1]], sway: [t.sway[0], t.sway[2], t.sway[1]] });
      if (aoSrc) extra.push(aoSrc[ti * 3], aoSrc[ti * 3 + 2], aoSrc[ti * 3 + 1]);
    });
    if (aoSrc) {
      aoAll = new Float32Array(aoSrc.length + extra.length);
      aoAll.set(aoSrc);
      aoAll.set(extra, aoSrc.length);
    }
  }

  // ---- deduplicate vertices
  const vmap = new Map<string, number>();
  const P: number[] = [], N: number[] = [], UV: number[] = [], C: number[] = [], J: number[] = [], W: number[] = [], S: number[] = [];
  const perMat: number[][] = mb.materials.map(() => []);
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const p = t.p[k], n = t.n[k], uv = t.uv[k];
      const a = aoAll ? aoAll[ti * 3 + k] : 1;
      const sk = t.skin?.[k];
      const skinKey = sk ? sk.j.join(',') + ':' + sk.w.map((w) => w.toFixed(3)).join(',') : '';
      const key = [p[0].toFixed(4), p[1].toFixed(4), p[2].toFixed(4), n[0].toFixed(3), n[1].toFixed(3), n[2].toFixed(3), uv[0].toFixed(5), uv[1].toFixed(5), t.mat, t.joint, skinKey, t.sway[k].toFixed(2), a.toFixed(2), t.tint.join(',')].join('|');
      let idx = vmap.get(key);
      if (idx === undefined) {
        idx = P.length / 3;
        vmap.set(key, idx);
        P.push(p[0], p[1], p[2]);
        N.push(n[0], n[1], n[2]);
        UV.push(uv[0], uv[1]);
        C.push(
          Math.round(Math.min(1, t.tint[0] * a) * 255),
          Math.round(Math.min(1, t.tint[1] * a) * 255),
          Math.round(Math.min(1, t.tint[2] * a) * 255),
          Math.round(a * 255),
        );
        if (sk) {
          J.push(...sk.j);
          W.push(...sk.w);
        } else {
          J.push(t.joint, 0, 0, 0);
          W.push(1, 0, 0, 0);
        }
        S.push(t.sway[k]);
      }
      perMat[t.mat].push(idx);
    }
  });
  const vcount = P.length / 3;

  const bin = new BinWriter();
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], P[i + k]);
    max[k] = Math.max(max[k], P[i + k]);
  }
  const attr: Record<string, number> = {};
  attr.POSITION = bin.accessor({ bufferView: bin.add(new Float32Array(P), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type: 'VEC3', min, max });
  attr.NORMAL = bin.accessor({ bufferView: bin.add(new Float32Array(N), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type: 'VEC3' });
  attr.TEXCOORD_0 = bin.accessor({ bufferView: bin.add(new Float32Array(UV), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type: 'VEC2' });
  attr.COLOR_0 = bin.accessor({ bufferView: bin.add(new Uint8Array(C), ARRAY_BUFFER), componentType: UBYTE, normalized: true, count: vcount, type: 'VEC4' });
  if (hasSway) attr._SWAY = bin.accessor({ bufferView: bin.add(new Float32Array(S), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type: 'SCALAR' });
  if (skinned) {
    attr.JOINTS_0 = bin.accessor({ bufferView: bin.add(new Uint8Array(J), ARRAY_BUFFER), componentType: UBYTE, count: vcount, type: 'VEC4' });
    attr.WEIGHTS_0 = bin.accessor({ bufferView: bin.add(new Float32Array(W), ARRAY_BUFFER), componentType: FLOAT, count: vcount, type: 'VEC4' });
  }

  const big = vcount > 65535;
  const primitives: any[] = [];
  perMat.forEach((idx, m) => {
    if (!idx.length) return;
    const arr = big ? new Uint32Array(idx) : new Uint16Array(idx);
    const acc = bin.accessor({ bufferView: bin.add(arr, ELEMENT_ARRAY_BUFFER), componentType: big ? UINT : USHORT, count: idx.length, type: 'SCALAR' });
    primitives.push({ attributes: attr, indices: acc, material: m, mode: 4 });
  });

  // images (embedded, glTF-style) for the baked atlas
  let images: any[] | undefined, textures: any[] | undefined, samplers: any[] | undefined;
  if (atlas) {
    images = [
      { name: 'albedo_team', mimeType: atlas.mime, bufferView: bin.add(atlas.albedo) },
      { name: 'rough_normalY_metal_normalX', mimeType: atlas.mime, bufferView: bin.add(atlas.surface) },
    ];
    samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    textures = [{ sampler: 0, source: 0 }, { sampler: 0, source: 1 }];
  }
  const materials = mb.materials.map((m: MaterialDef) => {
    const c = hexToLinear(m.color);
    const e = m.emissive ?? 0;
    const paint = atlas ? (m.paint as { shading?: number } | undefined) : undefined;
    const out: any = {
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: m.metallic ?? 0, roughnessFactor: m.roughness ?? 0.8 },
      extras: { pattern: m.pattern ?? 0, team: m.team ?? 0, sway: m.sway ?? 0, emissive: e },
    };
    if (paint) {
      // colour, roughness and metalness come from the atlas
      out.pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: 1 };
      out.extras.painted = paint.shading ?? 18;
    }
    if (e > 0) out.emissiveFactor = [Math.min(1, c[0] * e), Math.min(1, c[1] * e), Math.min(1, c[2] * e)];
    if (m.doubleSided) out.doubleSided = true;
    return out;
  });

  // ---- nodes
  const nodes: any[] = [];
  const sceneRoots: number[] = [];
  const meshNode: any = { name: mb.name, mesh: 0 };
  let jointNodeIdx: number[] = [];
  if (skinned) {
    jointNodeIdx = skeleton!.map((j, i) => {
      const parentPos = j.parent >= 0 ? skeleton![j.parent].pos : [0, 0, 0] as V3;
      nodes.push({ name: j.name, translation: sub(j.pos, parentPos), children: [] as number[] });
      return i;
    });
    skeleton!.forEach((j, i) => {
      if (j.parent >= 0) nodes[j.parent].children.push(i);
      else sceneRoots.push(i);
    });
    const ibm = new Float32Array(skeleton!.length * 16);
    skeleton!.forEach((j, i) => ibm.set(m4Translate([-j.pos[0], -j.pos[1], -j.pos[2]]), i * 16));
    const ibmAcc = bin.accessor({ bufferView: bin.add(ibm), componentType: FLOAT, count: skeleton!.length, type: 'MAT4' });
    meshNode.skin = 0;
    (meshNode as any)._skin = { inverseBindMatrices: ibmAcc, joints: jointNodeIdx, skeleton: sceneRoots[0] };
  }
  nodes.push(meshNode);
  const meshNodeIdx = nodes.length - 1;
  sceneRoots.push(meshNodeIdx);
  const skins = skinned ? [(meshNode as any)._skin] : undefined;
  delete (meshNode as any)._skin;

  for (const s of sockets) {
    const ji = s.joint && skinned ? skeleton!.findIndex((j) => j.name === s.joint) : -1;
    const base = ji >= 0 ? skeleton![ji].pos : ([0, 0, 0] as V3);
    nodes.push({ name: `socket_${s.name}`, translation: sub(s.pos, base) });
    const idx = nodes.length - 1;
    if (ji >= 0) nodes[ji].children.push(idx);
    else sceneRoots.push(idx);
  }
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;

  // ---- animations
  const anims: any[] = [];
  if (skinned) {
    for (const a of animations) {
      const fps = a.fps ?? 30;
      const frames = Math.max(2, Math.round(a.duration * fps) + 1);
      const times = new Float32Array(frames);
      for (let f = 0; f < frames; f++) times[f] = (f / (frames - 1)) * a.duration;
      const timeAcc = bin.accessor({ bufferView: bin.add(times), componentType: FLOAT, count: frames, type: 'SCALAR', min: [0], max: [a.duration] });
      const samplers: any[] = [], channels: any[] = [];
      for (const [jname, fn] of Object.entries(a.tracks)) {
        const ji = skeleton!.findIndex((j) => j.name === jname);
        if (ji < 0) throw new Error(`anim ${a.name}: unknown joint ${jname}`);
        const probe = fn(0);
        if (probe.r) {
          const out = new Float32Array(frames * 4);
          for (let f = 0; f < frames; f++) out.set(fn(f / (frames - 1)).r!, f * 4);
          const acc = bin.accessor({ bufferView: bin.add(out), componentType: FLOAT, count: frames, type: 'VEC4' });
          samplers.push({ input: timeAcc, output: acc, interpolation: 'LINEAR' });
          channels.push({ sampler: samplers.length - 1, target: { node: ji, path: 'rotation' } });
        }
        if (probe.t) {
          const rest = nodes[ji].translation as V3;
          const out = new Float32Array(frames * 3);
          for (let f = 0; f < frames; f++) {
            const t = fn(f / (frames - 1)).t!;
            out.set([rest[0] + t[0], rest[1] + t[1], rest[2] + t[2]], f * 3);
          }
          const acc = bin.accessor({ bufferView: bin.add(out), componentType: FLOAT, count: frames, type: 'VEC3' });
          samplers.push({ input: timeAcc, output: acc, interpolation: 'LINEAR' });
          channels.push({ sampler: samplers.length - 1, target: { node: ji, path: 'translation' } });
        }
      }
      anims.push({ name: a.name, samplers, channels });
    }
  }

  const binData = bin.concat();
  const json: any = {
    asset: { version: '2.0', generator: 'mandate-assetgen' },
    scene: 0,
    scenes: [{ nodes: sceneRoots, extras }],
    nodes,
    meshes: [{ name: mb.name, primitives }],
    materials,
    accessors: bin.accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: binData.byteLength }],
  };
  if (skins) json.skins = skins;
  if (images) {
    json.images = images;
    json.samplers = samplers;
    json.textures = textures;
    json.scenes[0].extras = { ...json.scenes[0].extras, atlas: { albedo: 0, surface: 1 } };
  }
  if (anims.length) json.animations = anims;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunk = new Uint8Array(jsonBytes.byteLength + jsonPad);
  jsonChunk.set(jsonBytes);
  jsonChunk.fill(0x20, jsonBytes.byteLength);
  const total = 12 + 8 + jsonChunk.byteLength + 8 + binData.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  const o = 20 + jsonChunk.byteLength;
  dv.setUint32(o, binData.byteLength, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  out.set(binData, o + 8);
  return out;
}
