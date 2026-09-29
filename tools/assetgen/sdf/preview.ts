// Quick sculpt previews: sphere-traces an SDF straight to an image (neutral studio light, clay
// material, eyeballs shaded analytically), so a form can be judged in seconds without meshing,
// baking and a browser. Used by the face/figure review scripts in tools/assetgen/dev.

import type { V3 } from '../../../src/core/math';
import type { SDF } from './sdf';

export interface Shot {
  /** degrees; 0 = from the front (+Z), 90 = from the character's left (+X) */
  yaw: number;
  pitch: number;
  dist: number;
  target: V3;
  /** vertical field of view in degrees; 0 = orthographic with `dist` as the half-height */
  fov: number;
  w: number;
  h: number;
}

export interface PreviewEye {
  c: V3;
  R: number;
  /** look direction */
  look: V3;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const srgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)));

/** Render `f` (plus eyeballs) inside the box [lo, hi]; returns RGBA8. */
export function renderSDF(f: SDF, lo: V3, hi: V3, shot: Shot, eyes: PreviewEye[] = [], clay: V3 = [0.58, 0.4, 0.3], albedoAt?: (p: V3) => V3): Uint8Array {
  const { w, h } = shot;
  const yaw = (shot.yaw * Math.PI) / 180, pitch = (shot.pitch * Math.PI) / 180;
  const back: V3 = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  const fwd: V3 = [-back[0], -back[1], -back[2]];
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const eye: V3 = [shot.target[0] + back[0] * shot.dist, shot.target[1] + back[1] * shot.dist, shot.target[2] + back[2] * shot.dist];
  const ortho = shot.fov <= 0;
  const th = ortho ? shot.dist : Math.tan((shot.fov * Math.PI) / 360);
  // lights follow the camera, as in sdf/raster.ts
  const cam = (v: V3): V3 => norm([right[0] * v[0] + up[0] * v[1] + back[0] * v[2], right[1] * v[0] + up[1] * v[1] + back[1] * v[2], right[2] * v[0] + up[2] * v[1] + back[2] * v[2]]);
  const key = cam([-0.35, 0.45, 0.82]), fill = cam([0.7, 0.15, 0.4]);
  const out = new Uint8Array(w * h * 4);
  const scene = (x: number, y: number, z: number) => {
    let d = f(x, y, z);
    for (const e of eyes) d = Math.min(d, Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) - e.R);
    return d;
  };
  const bg: V3 = [0.53, 0.54, 0.56];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = ((i + 0.5) / w * 2 - 1) * th * (w / h), sy = (1 - (j + 0.5) / h * 2) * th;
      let o: V3, dir: V3;
      if (ortho) {
        o = [shot.target[0] + back[0] * 1 + right[0] * sx + up[0] * sy, shot.target[1] + back[1] * 1 + right[1] * sx + up[1] * sy, shot.target[2] + back[2] * 1 + right[2] * sx + up[2] * sy];
        dir = fwd;
      } else {
        o = eye;
        dir = norm([fwd[0] + right[0] * sx + up[0] * sy, fwd[1] + right[1] * sx + up[1] * sy, fwd[2] + right[2] * sx + up[2] * sy]);
      }
      // clip the ray to the box
      let t0 = 0, t1 = 1e9;
      for (let k = 0; k < 3; k++) {
        const inv = 1 / (dir[k] || 1e-12);
        let a = (lo[k] - o[k]) * inv, b = (hi[k] - o[k]) * inv;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      let col: V3 = bg;
      if (t0 < t1) {
        let t = t0, hit = false;
        for (let s = 0; s < 400 && t < t1; s++) {
          const d = scene(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t);
          if (d < 0.00015) {
            hit = true;
            break;
          }
          t += Math.max(d * 0.8, 0.0001);
        }
        if (hit) {
          const p: V3 = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
          // which surface: an eyeball or the sculpt
          let eyeHit: PreviewEye | null = null;
          for (const e of eyes) if (Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]) - e.R) < 0.0004 && f(p[0], p[1], p[2]) > 0) eyeHit = e;
          const e2 = 0.0002;
          const g = eyeHit ? null : [f(p[0] + e2, p[1], p[2]) - f(p[0] - e2, p[1], p[2]), f(p[0], p[1] + e2, p[2]) - f(p[0], p[1] - e2, p[2]), f(p[0], p[1], p[2] + e2) - f(p[0], p[1], p[2] - e2)] as V3;
          const n = eyeHit ? norm([p[0] - eyeHit.c[0], p[1] - eyeHit.c[1], p[2] - eyeHit.c[2]]) : norm(g!);
          let alb: V3 = albedoAt ? albedoAt(p) : clay, spec = 0.04, shin = 12;
          if (eyeHit) {
            const L = norm(eyeHit.look);
            const ang = Math.acos(Math.max(-1, Math.min(1, dot(n, L))));
            alb = [0.82, 0.78, 0.74];
            if (ang < 0.53) alb = ang < 0.17 ? [0.01, 0.01, 0.01] : ang > 0.47 ? [0.03, 0.02, 0.015] : [0.2, 0.1, 0.045];
            spec = 0.5;
            shin = 80;
          }
          // soft occlusion along the normal
          let occ = 0;
          for (let k = 1; k <= 4; k++) {
            const r = 0.0025 * k;
            occ += Math.max(0, r - scene(p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r)) / r / k;
          }
          const ao = 1 - Math.min(1, occ * 0.5) * 0.6;
          const wrap = (l: V3) => Math.max(0, (dot(n, l) + 0.25) / 1.25);
          const hemi = 0.5 + 0.5 * n[1];
          const vdir: V3 = [-dir[0], -dir[1], -dir[2]];
          const hv = norm([key[0] + vdir[0], key[1] + vdir[1], key[2] + vdir[2]]);
          const sp = spec * Math.pow(Math.max(0, dot(n, hv)), shin);
          const light = wrap(key) * 1.0 + wrap(fill) * 0.28 + (0.3 + 0.12 * hemi) * ao;
          col = [alb[0] * light + sp, alb[1] * light + sp, alb[2] * light + sp];
        }
      }
      const q = (j * w + i) * 4;
      out[q] = srgb(col[0]);
      out[q + 1] = srgb(col[1]);
      out[q + 2] = srgb(col[2]);
      out[q + 3] = 255;
    }
  }
  return out;
}
