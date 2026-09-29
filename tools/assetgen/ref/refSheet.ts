// Reference-sheet measurements (written by ref/sheet.py): per view, the runs of figure pixels on
// every row, in metres in the figure's frame (feet at y = 0; x across the view from the figure's
// centre line — in the side view negative x is the figure's front). The figure builder samples
// profiles from these runs so its lofts follow the concept art directly.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Run = [number, number];
export interface RefRow {
  y: number;
  runs: Run[];
}
export interface RefView {
  cx: number;
  sole: number;
  rows: RefRow[];
}
export interface RefSheet {
  scale: number;
  height: number;
  views: Record<'front' | 'side' | 'back' | 'q34', RefView>;
}

export function loadRef(name: string): RefSheet {
  const url = new URL(`./${name}.json`, import.meta.url);
  const s = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as RefSheet;
  for (const v of Object.values(s.views)) v.rows.sort((a, b) => a.y - b.y);
  return s;
}
export const refPath = (name: string) => fileURLToPath(new URL(`./${name}.json`, import.meta.url));

/** Runs on the row nearest to height y. */
export function runsAt(v: RefView, y: number): Run[] {
  const r = v.rows;
  let lo = 0, hi = r.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (r[m].y < y) lo = m;
    else hi = m;
  }
  return Math.abs(r[lo].y - y) < Math.abs(r[hi].y - y) ? r[lo].runs : r[hi].runs;
}

export interface Sample {
  y: number;
  l: number;
  r: number;
}

/**
 * Sample one edge pair per height from y0 to y1: `pick` chooses the run (or returns null where
 * the view is ambiguous — those heights are filled by interpolation), then the edges are smoothed
 * with a Gaussian of σ = `smooth` samples (the sheet's pixel steps would otherwise show as ripples).
 */
export function sampleProfile(v: RefView, y0: number, y1: number, step: number, pick: (runs: Run[], y: number) => Run | null, smooth = 2): Sample[] {
  const raw: (Sample | null)[] = [];
  for (let y = y0; y <= y1 + 1e-9; y += step) {
    const run = pick(runsAt(v, y), y);
    raw.push(run ? { y, l: run[0], r: run[1] } : { y, l: NaN, r: NaN });
  }
  // fill gaps linearly
  const n = raw.length;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(raw[i]!.l)) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && Number.isNaN(raw[a]!.l)) a--;
    while (b < n && Number.isNaN(raw[b]!.l)) b++;
    const A = a >= 0 ? raw[a]! : raw[b]!, B = b < n ? raw[b]! : raw[a]!;
    const t = A === B ? 0 : (raw[i]!.y - A.y) / (B.y - A.y);
    raw[i] = { y: raw[i]!.y, l: A.l + (B.l - A.l) * t, r: A.r + (B.r - A.r) * t };
  }
  const out: Sample[] = [];
  const reach = Math.ceil(smooth * 2.5);
  for (let i = 0; i < n; i++) {
    let l = 0, r = 0, k = 0;
    for (let j = i - reach; j <= i + reach; j++) {
      const jj = Math.max(0, Math.min(n - 1, j));
      const wgt = smooth > 0 ? Math.exp(-((j - i) ** 2) / (2 * smooth * smooth)) : j === i ? 1 : 0;
      l += raw[jj]!.l * wgt;
      r += raw[jj]!.r * wgt;
      k += wgt;
    }
    out.push({ y: raw[i]!.y, l: l / k, r: r / k });
  }
  return out;
}

/** Reference silhouette of a view as a pixel mask (rows from the top, `w` columns from x0). */
export function refMask(v: RefView, scale: number, x0: number, w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const row of v.rows) {
    const r = Math.round(v.sole - row.y / scale);
    if (r < 0 || r >= h) continue;
    for (const [a, b] of row.runs) {
      const c0 = Math.round(v.cx + a / scale) - x0, c1 = Math.round(v.cx + b / scale) - x0;
      for (let c = Math.max(0, c0); c < Math.min(w, c1); c++) m[r * w + c] = 1;
    }
  }
  return m;
}

/** Catmull-Rom interpolation of evenly spaced samples (clamped at the ends). */
export function interp(samples: Sample[], key: 'l' | 'r', y: number): number {
  const n = samples.length;
  const y0 = samples[0].y, step = samples[1].y - y0;
  const f = Math.min(n - 1.000001, Math.max(0, (y - y0) / step));
  const i = Math.floor(f), t = f - i;
  const p = (k: number) => samples[Math.max(0, Math.min(n - 1, k))][key];
  const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** The run containing x (or the nearest one). */
export function runContaining(runs: Run[], x: number): Run | null {
  let best: Run | null = null, bd = Infinity;
  for (const r of runs) {
    const d = x < r[0] ? r[0] - x : x > r[1] ? x - r[1] : 0;
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}
