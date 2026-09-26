// Deterministic fixed-point math for the lockstep simulation (multiplayer + replays).
// Q16.16 in 32-bit integers. JS numbers are exact for integers < 2^53, and every op here is
// re-truncated to int32, so results are bit-identical across browsers and the native C++/Rust
// port (which uses int32 with the same rounding).  Rendering stays in floats.

export type Fx = number; // int32 holding Q16.16

export const FX_SHIFT = 16;
export const FX_ONE: Fx = 1 << FX_SHIFT;
export const FX_HALF: Fx = FX_ONE >> 1;

export const fx = (n: number): Fx => Math.round(n * FX_ONE) | 0;
export const fxToFloat = (a: Fx) => a / FX_ONE;
export const fxAdd = (a: Fx, b: Fx): Fx => (a + b) | 0;
export const fxSub = (a: Fx, b: Fx): Fx => (a - b) | 0;
/** (a*b) >> 16 without losing the high bits: split into 16-bit halves. */
export function fxMul(a: Fx, b: Fx): Fx {
  const ah = a >> 16, al = a & 0xffff;
  const bh = b >> 16, bl = b & 0xffff;
  // floor semantics identical to ((int64)a*b) >> 16
  return ((ah * bh) << 16) + ah * bl + al * bh + ((al * bl) >>> 16) | 0;
}
export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) return a >= 0 ? 0x7fffffff : -0x80000000;
  // a * 65536 fits in 2^47 < 2^53 → exact in doubles; truncate toward zero like C
  return Math.trunc((a * FX_ONE) / b) | 0;
}
/** Integer square root on Q16.16 (Newton, deterministic). */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  // sqrt(a/2^16)*2^16 = sqrt(a*2^16)
  let n = a * FX_ONE; // < 2^48, exact
  let x = Math.floor(Math.sqrt(n)); // seed; corrected below so result never depends on libm
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x | 0;
}

/** Deterministic xorshift128+-style PRNG on 32-bit state (sim-only; never Math.random). */
export class SimRandom {
  private s0: number;
  private s1: number;
  constructor(seed: number) {
    this.s0 = (seed ^ 0x9e3779b9) | 0 || 1;
    this.s1 = (Math.imul(seed, 0x85ebca6b) ^ 0xc2b2ae35) | 0 || 2;
  }
  nextU32(): number {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >>> 17;
    s1 ^= s0 ^ (s0 >>> 26);
    this.s1 = s1 | 0;
    return (this.s0 + this.s1) >>> 0;
  }
  /** integer in [0, n) */
  int(n: number): number {
    return this.nextU32() % n;
  }
}
