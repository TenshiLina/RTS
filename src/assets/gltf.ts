// glTF 2.0 (.glb) loader → backend-agnostic CPU model data.
// Materials are flattened into per-vertex attributes (see core/materialModel.ts) so a model is a
// single vertex/index buffer pair and draws in one (instanced) call on every backend.

import { V3, Quat, M4, m4FromTRS } from '../core/math';

export const MESH_VERTEX_STRIDE = 52;
// layout: pos f32x3 @0, normal f32x3 @12, uv f32x2 @24, color u8x4 @32, mat u8x4 @36, extra u8x4 @40,
// joints u8x4 @44, weights unorm8x4 @48 (linear-blend skinning, up to four joints per vertex)

export interface JointData {
  name: string;
  parent: number;
  t: V3;
  r: Quat;
  s: V3;
  inverseBind: M4;
}
export interface AnimChannel {
  joint: number;
  path: 'rotation' | 'translation' | 'scale';
  times: Float32Array;
  values: Float32Array;
}
export interface AnimationData {
  name: string;
  duration: number;
  channels: AnimChannel[];
}
export interface SocketData {
  name: string;
  joint: number; // -1 = model root
  t: V3;
}
export interface ModelData {
  name: string;
  vertices: ArrayBuffer;
  vertexCount: number;
  indices: Uint16Array | Uint32Array;
  bounds: { min: V3; max: V3 };
  joints: JointData[];
  animations: AnimationData[];
  sockets: SocketData[];
  extras: Record<string, any>;
  /** embedded images (encoded) */
  images: { mime: string; bytes: Uint8Array }[];
  /** baked character atlas: image indices (see tools/assetgen/tex/bake.ts for the channel layout) */
  atlas: { albedo: number; surface: number } | null;
}

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_N: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function parseGLB(buf: ArrayBuffer, name = 'model'): ModelData {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${name}: not a GLB`);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOff = 20 + jsonLen + 8;
  const bin = new Uint8Array(buf, binOff, dv.getUint32(20 + jsonLen, true));

  const readAccessor = (idx: number): { data: Float32Array | Uint32Array; n: number; count: number } => {
    const a = json.accessors[idx];
    const bv = json.bufferViews[a.bufferView];
    const n = TYPE_N[a.type];
    const cs = COMP_SIZE[a.componentType];
    const stride = bv.byteStride ?? n * cs;
    const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const view = new DataView(bin.buffer, bin.byteOffset + base, bv.byteLength - (a.byteOffset ?? 0));
    const isInt = !a.normalized && a.componentType !== 5126;
    const out = isInt ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < n; k++) {
        const o = i * stride + k * cs;
        let v: number;
        switch (a.componentType) {
          case 5126: v = view.getFloat32(o, true); break;
          case 5121: v = view.getUint8(o); if (a.normalized) v /= 255; break;
          case 5123: v = view.getUint16(o, true); if (a.normalized) v /= 65535; break;
          case 5125: v = view.getUint32(o, true); break;
          case 5120: v = view.getInt8(o); if (a.normalized) v = Math.max(v / 127, -1); break;
          case 5122: v = view.getInt16(o, true); if (a.normalized) v = Math.max(v / 32767, -1); break;
          default: throw new Error('bad componentType');
        }
        out[i * n + k] = v;
      }
    }
    return { data: out, n, count: a.count };
  };

  const materials = (json.materials ?? []).map((m: any) => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const c = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const ex = m.extras ?? {};
    return {
      color: [c[0], c[1], c[2]] as V3,
      rough: pbr.roughnessFactor ?? 1,
      metal: pbr.metallicFactor ?? 1,
      pattern: ex.pattern ?? 0,
      team: ex.team ?? 0,
      sway: ex.sway ?? 0,
      emissive: ex.emissive ?? (m.emissiveFactor ? Math.max(...m.emissiveFactor) : 0),
      // painted materials take colour / roughness / metalness / team from the atlas
      painted: (ex.painted ?? 0) as number,
    };
  });
  const defaultMat = { color: [0.8, 0.8, 0.8] as V3, rough: 0.8, metal: 0, pattern: 0, team: 0, sway: 0, emissive: 0, painted: 0 };

  // find the mesh node (first node with a mesh)
  const meshNodeIdx = json.nodes.findIndex((n: any) => n.mesh !== undefined);
  const meshNode = json.nodes[meshNodeIdx];
  const mesh = json.meshes[meshNode.mesh];

  // group primitives that share vertex attribute accessors
  const groups = new Map<string, any[]>();
  for (const p of mesh.primitives) {
    const key = JSON.stringify(p.attributes);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const vertParts: { count: number; write: (dst: DataView, base: number) => void }[] = [];
  const idxAll: number[] = [];
  let vbase = 0;
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const prims of groups.values()) {
    const at = prims[0].attributes;
    const P = readAccessor(at.POSITION);
    const N = at.NORMAL !== undefined ? readAccessor(at.NORMAL) : null;
    const UV = at.TEXCOORD_0 !== undefined ? readAccessor(at.TEXCOORD_0) : null;
    const C = at.COLOR_0 !== undefined ? readAccessor(at.COLOR_0) : null;
    const J = at.JOINTS_0 !== undefined ? readAccessor(at.JOINTS_0) : null;
    const Wt = at.WEIGHTS_0 !== undefined ? readAccessor(at.WEIGHTS_0) : null;
    const S = at._SWAY !== undefined ? readAccessor(at._SWAY) : null;
    const count = P.count;
    const matOf = new Int32Array(count).fill(-1);
    for (const p of prims) {
      const ids = p.indices !== undefined ? readAccessor(p.indices).data : Uint32Array.from({ length: count }, (_, i) => i);
      for (let i = 0; i < ids.length; i++) {
        matOf[ids[i]] = p.material ?? -1;
        idxAll.push(ids[i] + vbase);
      }
    }
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], P.data[i * 3 + k]);
      max[k] = Math.max(max[k], P.data[i * 3 + k]);
    }
    const b = vbase;
    vertParts.push({
      count,
      write(dst) {
        for (let i = 0; i < count; i++) {
          const o = (b + i) * MESH_VERTEX_STRIDE;
          const m = matOf[i] >= 0 ? materials[matOf[i]] : defaultMat;
          dst.setFloat32(o, P.data[i * 3], true);
          dst.setFloat32(o + 4, P.data[i * 3 + 1], true);
          dst.setFloat32(o + 8, P.data[i * 3 + 2], true);
          dst.setFloat32(o + 12, N ? N.data[i * 3] : 0, true);
          dst.setFloat32(o + 16, N ? N.data[i * 3 + 1] : 1, true);
          dst.setFloat32(o + 20, N ? N.data[i * 3 + 2] : 0, true);
          dst.setFloat32(o + 24, UV ? UV.data[i * 2] : 0, true);
          dst.setFloat32(o + 28, UV ? UV.data[i * 2 + 1] : 0, true);
          // COLOR_0 = tint * ao (rgb), ao (a)
          let ao = 1, tint: V3 = [1, 1, 1];
          if (C) {
            const cn = C.n;
            ao = cn === 4 ? C.data[i * 4 + 3] : 1;
            const inv = 1 / Math.max(ao, 1 / 255);
            tint = [C.data[i * cn] * inv, C.data[i * cn + 1] * inv, C.data[i * cn + 2] * inv];
          }
          const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
          // base colour is linear; store sqrt-encoded for precision in darks, decoded in the loader side-by-side
          dst.setUint8(o + 32, u8(Math.sqrt(m.color[0] * Math.min(tint[0], 1))));
          dst.setUint8(o + 33, u8(Math.sqrt(m.color[1] * Math.min(tint[1], 1))));
          dst.setUint8(o + 34, u8(Math.sqrt(m.color[2] * Math.min(tint[2], 1))));
          dst.setUint8(o + 35, m.painted ? 0 : u8(m.team));
          dst.setUint8(o + 36, u8(m.rough));
          dst.setUint8(o + 37, u8(m.metal));
          dst.setUint8(o + 38, m.painted || m.pattern);
          dst.setUint8(o + 39, u8(Math.min(m.emissive / 8, 1)));
          dst.setUint8(o + 40, u8(ao));
          dst.setUint8(o + 41, u8(Math.min(1, (S ? S.data[i] : 0) + m.sway)));
          dst.setUint8(o + 42, 0);
          dst.setUint8(o + 43, 0);
          // weights quantised to bytes that still sum to 255 (the largest takes the rounding)
          const w = Wt ? [Wt.data[i * 4], Wt.data[i * 4 + 1], Wt.data[i * 4 + 2], Wt.data[i * 4 + 3]] : [1, 0, 0, 0];
          const wb = w.map((x) => Math.round(Math.max(0, x) * 255));
          const big = wb.indexOf(Math.max(...wb));
          wb[big] += 255 - wb.reduce((a, b2) => a + b2, 0);
          for (let k = 0; k < 4; k++) {
            dst.setUint8(o + 44 + k, J && wb[k] > 0 ? J.data[i * 4 + k] : 0);
            dst.setUint8(o + 48 + k, Math.max(0, wb[k]));
          }
        }
      },
    });
    vbase += count;
  }
  const vertices = new ArrayBuffer(vbase * MESH_VERTEX_STRIDE);
  const vdv = new DataView(vertices);
  for (const p of vertParts) p.write(vdv, 0);
  const indices = vbase > 65535 ? new Uint32Array(idxAll) : new Uint16Array(idxAll);

  // skeleton
  const joints: JointData[] = [];
  const nodeToJoint = new Map<number, number>();
  if (meshNode.skin !== undefined) {
    const skin = json.skins[meshNode.skin];
    const ibm = skin.inverseBindMatrices !== undefined ? readAccessor(skin.inverseBindMatrices).data : null;
    skin.joints.forEach((ni: number, j: number) => nodeToJoint.set(ni, j));
    const parentOf = new Map<number, number>();
    json.nodes.forEach((n: any, i: number) => (n.children ?? []).forEach((c: number) => parentOf.set(c, i)));
    skin.joints.forEach((ni: number, j: number) => {
      const n = json.nodes[ni];
      const p = parentOf.get(ni);
      joints.push({
        name: n.name ?? `joint${j}`,
        parent: p !== undefined && nodeToJoint.has(p) ? nodeToJoint.get(p)! : -1,
        t: (n.translation ?? [0, 0, 0]) as V3,
        r: (n.rotation ?? [0, 0, 0, 1]) as Quat,
        s: (n.scale ?? [1, 1, 1]) as V3,
        inverseBind: ibm ? new Float32Array(ibm.slice(j * 16, j * 16 + 16)) : m4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
      });
    });
  }
  const animations: AnimationData[] = (json.animations ?? []).map((a: any) => {
    let duration = 0;
    const channels: AnimChannel[] = [];
    for (const ch of a.channels) {
      const j = nodeToJoint.get(ch.target.node);
      if (j === undefined) continue;
      const s = a.samplers[ch.sampler];
      const times = readAccessor(s.input).data as Float32Array;
      const values = readAccessor(s.output).data as Float32Array;
      duration = Math.max(duration, times[times.length - 1]);
      channels.push({ joint: j, path: ch.target.path, times, values });
    }
    return { name: a.name ?? 'anim', duration, channels };
  });
  const sockets: SocketData[] = [];
  json.nodes.forEach((n: any, i: number) => {
    if (!(n.name ?? '').startsWith('socket_')) return;
    let parentJoint = -1;
    json.nodes.forEach((pn: any, pi: number) => {
      if ((pn.children ?? []).includes(i) && nodeToJoint.has(pi)) parentJoint = nodeToJoint.get(pi)!;
    });
    sockets.push({ name: n.name.slice(7), joint: parentJoint, t: (n.translation ?? [0, 0, 0]) as V3 });
  });

  const images = (json.images ?? []).map((im: any) => {
    const bv = json.bufferViews[im.bufferView];
    return { mime: im.mimeType as string, bytes: new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength).slice() };
  });
  const sceneExtras = json.scenes?.[json.scene ?? 0]?.extras ?? {};
  return {
    name,
    images,
    atlas: sceneExtras.atlas ?? null,
    vertices,
    vertexCount: vbase,
    indices,
    bounds: { min, max },
    joints,
    animations,
    sockets,
    extras: json.scenes?.[json.scene ?? 0]?.extras ?? {},
  };
}
