// Grid A* (8-connected, no corner cutting) with deterministic tie-breaking, plus helpers.
// Costs are integers (10 straight / 14 diagonal) so results are identical everywhere.

export class Pathfinder {
  private g: Int32Array;
  private f: Int32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private cur = 1;
  private heap: Int32Array;
  private heapSize = 0;

  constructor(public w: number, public h: number) {
    const n = w * h;
    this.g = new Int32Array(n);
    this.f = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 8);
  }

  private less(a: number, b: number) {
    const fa = this.f[a], fb = this.f[b];
    if (fa !== fb) return fa < fb;
    const ga = this.g[a], gb = this.g[b];
    if (ga !== gb) return ga > gb; // prefer deeper nodes → fewer expansions
    return a < b;
  }
  private push(i: number) {
    let k = this.heapSize++;
    this.heap[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(this.heap[k], this.heap[p])) break;
      [this.heap[k], this.heap[p]] = [this.heap[p], this.heap[k]];
      k = p;
    }
  }
  private pop(): number {
    const top = this.heap[0];
    this.heap[0] = this.heap[--this.heapSize];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < this.heapSize && this.less(this.heap[l], this.heap[m])) m = l;
      if (r < this.heapSize && this.less(this.heap[r], this.heap[m])) m = r;
      if (m === k) break;
      [this.heap[k], this.heap[m]] = [this.heap[m], this.heap[k]];
      k = m;
    }
    return top;
  }

  /**
   * Returns cell indices from start (exclusive) to goal (inclusive), or null.
   * If the goal is unreachable, returns the path to the explored cell closest to it
   * (units walk as near as they can, like C&C).
   */
  find(start: number, goal: number, passable: (i: number) => boolean, maxNodes = 6000): number[] | null {
    const w = this.w, h = this.h;
    this.cur++;
    const heur = (i: number) => {
      const dx = Math.abs((i % w) - (goal % w)), dz = Math.abs(((i / w) | 0) - ((goal / w) | 0));
      return 10 * (dx + dz) - 6 * Math.min(dx, dz);
    };
    this.heapSize = 0;
    this.g[start] = 0;
    this.f[start] = heur(start);
    this.parent[start] = -1;
    this.stamp[start] = this.cur;
    this.push(start);
    let best = start, bestH = heur(start);
    let expanded = 0;
    while (this.heapSize) {
      const c = this.pop();
      if (this.closed[c] === this.cur) continue;
      this.closed[c] = this.cur;
      if (c === goal) {
        best = c;
        break;
      }
      const hc = heur(c);
      if (hc < bestH) {
        bestH = hc;
        best = c;
      }
      if (++expanded > maxNodes) break;
      const cx = c % w, cz = (c / w) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
          const n = nz * w + nx;
          if (this.closed[n] === this.cur) continue;
          if (n !== goal && !passable(n)) continue;
          if (n === goal && !passable(n)) continue;
          if (dx && dz && (!passable(cz * w + nx) || !passable(nz * w + cx))) continue; // no corner cutting
          const ng = this.g[c] + (dx && dz ? 14 : 10);
          if (this.stamp[n] === this.cur && ng >= this.g[n]) continue;
          this.stamp[n] = this.cur;
          this.g[n] = ng;
          this.f[n] = ng + heur(n);
          this.parent[n] = c;
          this.push(n);
        }
      }
    }
    if (best === start) return start === goal ? [] : null;
    const out: number[] = [];
    for (let c = best; c !== start && c !== -1; c = this.parent[c]) out.push(c);
    out.reverse();
    return out;
  }

  /** Breadth-first search for the nearest cell satisfying `ok`, within `maxR` rings. */
  nearest(from: number, ok: (i: number) => boolean, maxR = 12): number {
    const w = this.w, h = this.h;
    if (ok(from)) return from;
    const fx = from % w, fz = (from / w) | 0;
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = fx + dx, z = fz + dz;
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const i = z * w + x;
        if (!ok(i)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Walkable straight line between two cells (supercover), used for path smoothing. */
  lineClear(a: number, b: number, passable: (i: number) => boolean): boolean {
    const w = this.w;
    let x0 = a % w, z0 = (a / w) | 0;
    const x1 = b % w, z1 = (b / w) | 0;
    const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    for (;;) {
      if (!passable(z0 * w + x0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = 2 * err;
      if (e2 > -dz && e2 < dx) {
        // diagonal step: both orthogonal neighbours must be free (no squeezing past corners)
        if (!passable(z0 * w + x0 + sx) || !passable((z0 + sz) * w + x0)) return false;
      }
      if (e2 > -dz) {
        err -= dz;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        z0 += sz;
      }
    }
  }
}
