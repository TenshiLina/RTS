// Software rasteriser for sculpt reviews: draws an indexed mesh with the same neutral studio
// clay shading as the ray-marched previews (sdf/preview.ts), plus a coverage mask, so a whole
// figure can be meshed once and drawn from any number of views in milliseconds.

import type { V3 } from '../../../src/core/math';
import type { Shot } from './preview';

export interface RasterMesh {
  pos: ArrayLike<number>;
  idx: ArrayLike<number>;
  /** per-vertex normals (computed from the faces when omitted) */
  nrm?: ArrayLike<number>;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const srgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));

export function vertexNormals(pos: ArrayLike<number>, idx: ArrayLike<number>): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1: V3 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2: V3 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const f = cross(e1, e2);
    for (const v of [a, b, c]) {
      n[v] += f[0];
      n[v + 1] += f[1];
      n[v + 2] += f[2];
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}

/** Draw meshes (each with its own albedo) from `shot`; returns RGBA8 and a coverage mask. */
export function rasterize(parts: { mesh: RasterMesh; albedo?: V3 }[], shot: Shot, bg: V3 = [0.53, 0.54, 0.56]): { rgba: Uint8Array; mask: Uint8Array } {
  const { w, h } = shot;
  const yaw = (shot.yaw * Math.PI) / 180, pitch = (shot.pitch * Math.PI) / 180;
  const back: V3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const fwd: V3 = [-back[0], -back[1], -back[2]];
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const eye: V3 = [shot.target[0] + back[0] * shot.dist, shot.target[1] + back[1] * shot.dist, shot.target[2] + back[2] * shot.dist];
  const ortho = shot.fov <= 0;
  const th = ortho ? shot.dist : Math.tan((shot.fov * Math.PI) / 360);
  const aspect = w / h;
  // lights follow the camera (a turnaround is lit the same from every side): key high on the
  // camera's left, fill low on its right
  const cam = (v: V3): V3 => norm([right[0] * v[0] + up[0] * v[1] + back[0] * v[2], right[1] * v[0] + up[1] * v[1] + back[1] * v[2], right[2] * v[0] + up[2] * v[1] + back[2] * v[2]]);
  const key = cam([-0.35, 0.45, 0.82]), fill = cam([0.7, 0.15, 0.4]);
  const zbuf = new Float32Array(w * h).fill(Infinity);
  const col = new Float32Array(w * h * 3);
  const mask = new Uint8Array(w * h);
  // project a world point → [px, py, depth]
  const proj = (x: number, y: number, z: number): V3 => {
    const d: V3 = ortho ? [x - shot.target[0], y - shot.target[1], z - shot.target[2]] : [x - eye[0], y - eye[1], z - eye[2]];
    const cx = dot(d, right), cy = dot(d, up), cz = ortho ? dot([x - eye[0], y - eye[1], z - eye[2]], fwd) : dot(d, fwd);
    const sx = ortho ? cx / th : cx / (cz * th), sy = ortho ? cy / th : cy / (cz * th);
    return [((sx / aspect + 1) / 2) * w, ((1 - sy) / 2) * h, cz];
  };
  for (const { mesh, albedo = [0.58, 0.4, 0.3] } of parts) {
    const P = mesh.pos, I = mesh.idx;
    const N = mesh.nrm ?? vertexNormals(P, I);
    const nv = P.length / 3;
    const sp = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const q = proj(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      sp[v * 3] = q[0];
      sp[v * 3 + 1] = q[1];
      sp[v * 3 + 2] = q[2];
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = sp[a * 3], ay = sp[a * 3 + 1], az = sp[a * 3 + 2];
      const bx = sp[b * 3], by = sp[b * 3 + 1], bz = sp[b * 3 + 2];
      const cx = sp[c * 3], cy = sp[c * 3 + 1], cz = sp[c * 3 + 2];
      if (az <= 0 || bz <= 0 || cz <= 0) continue;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const qx = px + 0.5, qy = py + 0.5;
          const w0 = ((bx - qx) * (cy - qy) - (by - qy) * (cx - qx)) / area;
          const w1 = ((cx - qx) * (ay - qy) - (cy - qy) * (ax - qx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * az + w1 * bz + w2 * cz;
          const k = py * w + px;
          if (z >= zbuf[k]) continue;
          zbuf[k] = z;
          let n: V3 = [
            w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[c * 3],
            w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[c * 3 + 1],
            w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[c * 3 + 2],
          ];
          n = norm(n);
          if (dot(n, fwd) > 0) n = [-n[0], -n[1], -n[2]];
          const wrap = (l: V3) => Math.max(0, (dot(n, l) + 0.25) / 1.25);
          const hemi = 0.5 + 0.5 * n[1];
          const hv = norm([key[0] - fwd[0], key[1] - fwd[1], key[2] - fwd[2]]);
          const sp2 = 0.04 * Math.pow(Math.max(0, dot(n, hv)), 12);
          const light = wrap(key) + wrap(fill) * 0.28 + 0.3 + 0.12 * hemi;
          col[k * 3] = albedo[0] * light + sp2;
          col[k * 3 + 1] = albedo[1] * light + sp2;
          col[k * 3 + 2] = albedo[2] * light + sp2;
          mask[k] = 255;
        }
      }
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const c = mask[k] ? [col[k * 3], col[k * 3 + 1], col[k * 3 + 2]] : bg;
    rgba[k * 4] = srgb(c[0]);
    rgba[k * 4 + 1] = srgb(c[1]);
    rgba[k * 4 + 2] = srgb(c[2]);
    rgba[k * 4 + 3] = 255;
  }
  return { rgba, mask };
}
