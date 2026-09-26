// Integer math for the simulation. Everything the sim stores is an integer so results are
// identical on every JS engine and in a future C++/Rust port.
//   * positions in leptons: 256 per cell (C&C convention), cell = 3 m
//   * facings in 1/256 turns (0 = +Z, increasing toward +X)
//   * trig via a 256-entry table scaled by 4096 (generated once; its checksum is tested)

export const LEPTONS = 256;
export const TICK_HZ = 15;
export const TRIG_ONE = 4096;

/** floor(sqrt(n)) for n >= 0, exact for n < 2^52. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return isqrt(dx * dx + dz * dz);
}
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** SIN[f] = round(sin(f/256 · 2π) · 4096). Rounded to integers, so tiny libm differences vanish. */
export const SIN = new Int32Array(256);
for (let i = 0; i < 256; i++) SIN[i] = Math.round(Math.sin((i / 256) * Math.PI * 2) * TRIG_ONE);
export const sinF = (f: number) => SIN[f & 255];
export const cosF = (f: number) => SIN[(f + 64) & 255];

/** Facing (0..255) of the vector (dx, dz): 0 = +Z, 64 = +X. Integer-only octant search. */
export function facingOf(dx: number, dz: number): number {
  if (dx === 0 && dz === 0) return 0;
  // find angle in the first octant via ratio compare against tan table, then unfold
  const ax = Math.abs(dx), az = Math.abs(dz);
  const swap = ax > az;
  const num = swap ? az : ax, den = swap ? ax : az; // ratio in [0,1]
  // binary search f in [0,32] with tan(f) = sin/cos from table
  let lo = 0, hi = 32;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // tan(mid) <= num/den  <=>  SIN[mid]*den <= COS[mid]*num
    if (SIN[mid] * den <= SIN[(mid + 64) & 255] * num) lo = mid;
    else hi = mid - 1;
  }
  // round to nearest of lo / lo+1
  if (lo < 32) {
    const a = Math.abs(SIN[lo] * den - SIN[lo + 64] * num);
    const b = Math.abs(SIN[lo + 1] * den - SIN[lo + 65] * num);
    if (b < a) lo++;
  }
  let f = swap ? 64 - lo : lo; // angle from +Z toward +X in quadrant 1
  if (dx >= 0 && dz >= 0) return f & 255;
  if (dx >= 0 && dz < 0) return (128 - f) & 255;
  if (dx < 0 && dz < 0) return (128 + f) & 255;
  return (256 - f) & 255;
}

/** Signed shortest difference b - a in facing units (-128..127). */
export function facingDelta(a: number, b: number): number {
  return (((b - a + 128) & 255) - 128);
}

/** Rotate facing a toward b by at most `rate`. */
export function turnToward(a: number, b: number, rate: number): number {
  const d = facingDelta(a, b);
  if (Math.abs(d) <= rate) return b & 255;
  return (a + (d > 0 ? rate : -rate)) & 255;
}

/** Deterministic PRNG (xorshift32). */
export class SimRng {
  constructor(public state: number) {
    if (!this.state) this.state = 0x9e3779b9;
  }
  next(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return x >>> 0;
  }
  int(n: number): number {
    return this.next() % n;
  }
}
