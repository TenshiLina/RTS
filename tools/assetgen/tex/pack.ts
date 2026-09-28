// Atlas packing: charts are turned to their principal axes, laid out with a skyline packer and
// scaled so the whole set fills one square texture at the highest texel density that fits.

import type { Chart } from './unwrap';

export interface PackResult {
  /** atlas UV (0..1, v down) per chart, 6 per triangle */
  uvs: Float32Array[];
  /** texels per metre at density 1 */
  density: number;
}

interface Rect {
  w: number; // chart extent (m, after rotation)
  h: number;
  minU: number;
  minV: number;
  cos: number;
  sin: number;
  k: number; // density
}

function orient(c: Chart): Rect {
  const n = c.uv.length / 2;
  let mu = 0, mv = 0;
  for (let i = 0; i < n; i++) {
    mu += c.uv[i * 2];
    mv += c.uv[i * 2 + 1];
  }
  mu /= n;
  mv /= n;
  let cuu = 0, cvv = 0, cuv = 0;
  for (let i = 0; i < n; i++) {
    const du = c.uv[i * 2] - mu, dv = c.uv[i * 2 + 1] - mv;
    cuu += du * du;
    cvv += dv * dv;
    cuv += du * dv;
  }
  let a = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
  let cos = Math.cos(-a), sin = Math.sin(-a);
  const bounds = (co: number, si: number) => {
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let i = 0; i < n; i++) {
      const u = c.uv[i * 2] * co - c.uv[i * 2 + 1] * si, v = c.uv[i * 2] * si + c.uv[i * 2 + 1] * co;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    return { minU, minV, w: maxU - minU, h: maxV - minV };
  };
  let b = bounds(cos, sin);
  // keep whichever of PCA / unrotated has the smaller box; lie long side horizontal
  const b0 = bounds(1, 0);
  if (b0.w * b0.h <= b.w * b.h * 1.02) {
    cos = 1;
    sin = 0;
    b = b0;
  }
  if (b.h > b.w) {
    // rotate a further 90°
    const c2 = -sin, s2 = cos;
    cos = c2;
    sin = s2;
    b = bounds(cos, sin);
  }
  void a;
  return { w: b.w, h: b.h, minU: b.minU, minV: b.minV, cos, sin, k: c.density };
}

/** Skyline bottom-left packing of integer rectangles; returns positions or null if they don't fit. */
function skyline(sizes: { w: number; h: number }[], S: number): { x: number; y: number }[] | null {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  const sky: { x: number; y: number; w: number }[] = [{ x: 0, y: 0, w: S }];
  const pos: { x: number; y: number }[] = new Array(sizes.length);
  for (const i of order) {
    const { w, h } = sizes[i];
    if (w > S || h > S) return null;
    let best = -1, bestY = Infinity, bestX = 0;
    for (let s = 0; s < sky.length; s++) {
      const x = sky[s].x;
      if (x + w > S) break;
      let y = 0, rem = w, k = s;
      while (rem > 0 && k < sky.length) {
        y = Math.max(y, sky[k].y);
        rem -= sky[k].w - (k === s ? 0 : 0);
        k++;
      }
      if (y + h <= S && (y < bestY || (y === bestY && x < bestX))) {
        best = s;
        bestY = y;
        bestX = x;
      }
    }
    if (best < 0) return null;
    pos[i] = { x: bestX, y: bestY };
    // update skyline: insert the new segment, trim those it covers
    const seg = { x: bestX, y: bestY + h, w };
    const next: typeof sky = [];
    for (const s of sky) {
      const s0 = s.x, s1 = s.x + s.w, n0 = seg.x, n1 = seg.x + seg.w;
      if (s1 <= n0 || s0 >= n1) {
        next.push(s);
        continue;
      }
      if (s0 < n0) next.push({ x: s0, y: s.y, w: n0 - s0 });
      if (s1 > n1) next.push({ x: n1, y: s.y, w: s1 - n1 });
    }
    next.push(seg);
    next.sort((a, b) => a.x - b.x);
    // merge equal neighbours
    sky.length = 0;
    for (const s of next) {
      const last = sky[sky.length - 1];
      if (last && last.y === s.y && last.x + last.w === s.x) last.w += s.w;
      else sky.push({ ...s });
    }
  }
  return pos;
}

export function pack(charts: Chart[], S: number, pad = 4): PackResult {
  const rects = charts.map(orient);
  const sizeAt = (d: number) => rects.map((r) => ({ w: Math.ceil(r.w * d * r.k) + pad * 2, h: Math.ceil(r.h * d * r.k) + pad * 2 }));
  let lo = 1, hi = 20000, best: { x: number; y: number }[] | null = null, bestD = lo;
  for (let it = 0; it < 22; it++) {
    const d = Math.sqrt(lo * hi);
    const p = skyline(sizeAt(d), S);
    if (p) {
      lo = d;
      best = p;
      bestD = d;
    } else hi = d;
  }
  if (!best) throw new Error('atlas: charts do not fit');
  const uvs = charts.map((c, i) => {
    const r = rects[i];
    const out = new Float32Array(c.uv.length);
    const k = bestD * r.k;
    for (let v = 0; v < c.uv.length / 2; v++) {
      const u0 = c.uv[v * 2], v0 = c.uv[v * 2 + 1];
      const u = u0 * r.cos - v0 * r.sin - r.minU, vv = u0 * r.sin + v0 * r.cos - r.minV;
      out[v * 2] = (best![i].x + pad + u * k) / S;
      out[v * 2 + 1] = (best![i].y + pad + vv * k) / S;
    }
    return out;
  });
  return { uvs, density: bestD };
}
