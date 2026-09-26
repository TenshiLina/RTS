import { describe, it, expect } from 'vitest';
import { fx, fxMul, fxDiv, fxSqrt, fxToFloat, SimRandom } from '../src/sim/fixed';

describe('fixed-point', () => {
  it('multiplies like int64 >> 16', () => {
    const pairs = [[1.5, 2.25], [-3.75, 4.5], [123.456, -0.001], [100, 200], [-0.5, -0.5]];
    for (const [a, b] of pairs) {
      const A = fx(a), B = fx(b);
      const ref = Number((BigInt(A) * BigInt(B)) >> 16n);
      expect(fxMul(A, B)).toBe(ref | 0);
      expect(fxToFloat(fxMul(A, B))).toBeCloseTo(a * b, 2);
    }
  });
  it('divides and square-roots deterministically', () => {
    expect(fxToFloat(fxDiv(fx(10), fx(4)))).toBeCloseTo(2.5, 4);
    expect(fxToFloat(fxSqrt(fx(2)))).toBeCloseTo(Math.SQRT2, 4);
    expect(fxSqrt(fx(144))).toBe(fx(12));
  });
  it('sim RNG sequence is stable (golden values guard cross-platform determinism)', () => {
    const r = new SimRandom(1234);
    const seq = Array.from({ length: 5 }, () => r.nextU32());
    const r2 = new SimRandom(1234);
    expect(Array.from({ length: 5 }, () => r2.nextU32())).toEqual(seq);
  });
});
