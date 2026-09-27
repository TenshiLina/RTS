// Procedural sound library. Every sound is synthesised at start-up from noise, oscillators,
// filters and envelopes — no sample files, deterministic (seeded), platform-neutral PCM that any
// backend can play. Sound design follows the school grammar (docs/VFX.md):
//   Fire  low roar + crackle (broadband, low-mid), whooshes
//   Ice   crystalline chimes (inharmonic partials), sharp cracks, glass tinkle
//   Water liquid gurgles (resonant sweeps, bubble chirps), splashes, washes
//   Air   band-passed whooshes, howls, whistles
//   Heaven thunder; Qi paper flutter and pops

export const SAMPLE_RATE = 22050;
const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ primitives
class Rng {
  constructor(private s: number) {}
  next() {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) | 0;
    return ((this.s >>> 8) & 0xffffff) / 0x1000000;
  }
  bi() {
    return this.next() * 2 - 1;
  }
}
const buf = (sec: number) => new Float32Array(Math.max(1, Math.round(sec * SR)));
const len = (b: Float32Array) => b.length / SR;

function noise(sec: number, seed: number): Float32Array {
  const r = new Rng(seed), b = buf(sec);
  for (let i = 0; i < b.length; i++) b[i] = r.bi();
  return b;
}
/** brown-ish noise (integrated white) for rumbles */
function brown(sec: number, seed: number): Float32Array {
  const r = new Rng(seed), b = buf(sec);
  let v = 0;
  for (let i = 0; i < b.length; i++) {
    v = (v + r.bi() * 0.06) * 0.996;
    b[i] = v * 3;
  }
  return b;
}

type Curve = (t: number) => number; // t = seconds
/** RBJ biquad with a time-varying frequency (coefficients refreshed every 32 samples). */
function biquad(x: Float32Array, type: 'lp' | 'hp' | 'bp', freq: Curve | number, q: Curve | number = 0.707): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) {
      const t = i / SR;
      const f = Math.min(SR * 0.45, Math.max(20, typeof freq === 'number' ? freq : freq(t)));
      const Q = typeof q === 'number' ? q : q(t);
      const w = (TAU * f) / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
      const a0 = 1 + al;
      if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
      else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
      else { b0 = al; b1 = 0; b2 = -al; }
      a1 = -2 * c;
      a2 = 1 - al;
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    }
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}
const lp = (x: Float32Array, f: Curve | number, q?: Curve | number) => biquad(x, 'lp', f, q);
const hp = (x: Float32Array, f: Curve | number, q?: Curve | number) => biquad(x, 'hp', f, q);
const bp = (x: Float32Array, f: Curve | number, q: Curve | number = 2) => biquad(x, 'bp', f, q);

function shape(x: Float32Array, env: Curve): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= env(i / SR);
  return x;
}
/** attack-then-exponential-decay envelope */
const ad = (a: number, tau: number): Curve => (t) => (t < a ? t / a : Math.exp(-(t - a) / tau));
/** swell up then fade */
const swell = (peak: number, total: number): Curve => (t) => (t < peak ? Math.pow(t / peak, 1.5) : Math.max(0, 1 - (t - peak) / (total - peak)) ** 1.6);
const sweep = (a: number, b: number, dur: number, pow = 1): Curve => (t) => a + (b - a) * Math.pow(Math.min(1, t / dur), pow);

function osc(sec: number, freq: Curve | number, type: 'sine' | 'saw' | 'tri' = 'sine', phase0 = 0): Float32Array {
  const b = buf(sec);
  let ph = phase0;
  for (let i = 0; i < b.length; i++) {
    const f = typeof freq === 'number' ? freq : freq(i / SR);
    ph += f / SR;
    const p = ph - Math.floor(ph);
    b[i] = type === 'sine' ? Math.sin(p * TAU) : type === 'saw' ? p * 2 - 1 : 1 - 4 * Math.abs(p - 0.5);
  }
  return b;
}
/** Sum into `into` at time offset (s) with gain. */
function mixIn(into: Float32Array, x: Float32Array, at = 0, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < x.length && o + i < into.length; i++) if (o + i >= 0) into[o + i] += x[i] * gain;
  return into;
}
function sum(sec: number, ...parts: [Float32Array, number, number?][]) {
  const out = buf(sec);
  for (const [x, g, at] of parts) mixIn(out, x, at ?? 0, g);
  return out;
}
function soft(x: Float32Array, drive = 1.5) {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / Math.tanh(drive);
  return x;
}
function normalize(x: Float32Array, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  // 4 ms fade-out so no sound ends in a click
  const f = Math.min(x.length, Math.round(0.004 * SR));
  for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f;
  return x;
}
/** small Schroeder reverb for space and tails */
function reverb(x: Float32Array, tail: number, wet = 0.3): Float32Array {
  const out = new Float32Array(x.length + Math.round(tail * SR));
  out.set(x);
  const dry = out.slice();
  const combs = [1116, 1188, 1277, 1356].map((d) => Math.round((d * SR) / 44100));
  const fb = Math.pow(0.001, (combs[0] / SR) / tail);
  const acc = new Float32Array(out.length);
  for (const d of combs) {
    const line = new Float32Array(d);
    let k = 0, lpS = 0;
    for (let i = 0; i < out.length; i++) {
      const y = line[k];
      lpS = y * 0.7 + lpS * 0.3;
      line[k] = dry[i] + lpS * fb;
      acc[i] += y;
      k = (k + 1) % d;
    }
  }
  for (const d of [556, 441].map((q) => Math.round((q * SR) / 44100))) {
    const line = new Float32Array(d);
    let k = 0;
    for (let i = 0; i < acc.length; i++) {
      const y = line[k];
      const v = acc[i] + y * 0.5;
      line[k] = v;
      acc[i] = y - v * 0.5;
      k = (k + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = dry[i] * (1 - wet) + acc[i] * wet * 0.25;
  return out;
}

// ------------------------------------------------------------------ building blocks
/** fire crackle: sparse sharp clicks with random pitch, density over time */
function crackle(sec: number, seed: number, density: Curve | number, bright = 3000): Float32Array {
  const r = new Rng(seed), b = buf(sec);
  for (let i = 0; i < b.length; i++) {
    const d = typeof density === 'number' ? density : density(i / SR);
    if (r.next() < d / SR) {
      const amp = 0.3 + r.next() * 0.7;
      const L = 20 + Math.floor(r.next() * 120);
      for (let k = 0; k < L && i + k < b.length; k++) b[i + k] += r.bi() * amp * Math.exp(-k / (L * 0.25));
    }
  }
  return hp(b, bright * 0.3);
}
/** glassy ping: inharmonic partials of a small bar/bell */
function ping(sec: number, f0: number, decay: number, seed: number): Float32Array {
  const ratios = [1, 2.76, 5.4, 8.93];
  const r = new Rng(seed);
  const out = buf(sec);
  ratios.forEach((k, i) => {
    const x = osc(sec, f0 * k * (1 + r.bi() * 0.01), 'sine', r.next());
    mixIn(out, shape(x, ad(0.001, decay / (1 + i * 0.8))), 0, 1 / (1 + i));
  });
  return out;
}
/** many glass pings scattered over time (tinkles, shatters, frost forming) */
function tinkles(sec: number, n: number, seed: number, fLo: number, fHi: number, spread: Curve = (x) => x) {
  const r = new Rng(seed), out = buf(sec);
  for (let i = 0; i < n; i++) {
    const at = spread(r.next()) * sec * 0.85;
    mixIn(out, ping(0.35, fLo + (fHi - fLo) * r.next(), 0.05 + r.next() * 0.12, seed + i * 7), at, 0.3 + r.next() * 0.7);
  }
  return out;
}
/** water bubble: short upward sine chirp */
function bubbles(sec: number, n: number, seed: number, fLo = 350, fHi = 1100) {
  const r = new Rng(seed), out = buf(sec);
  for (let i = 0; i < n; i++) {
    const f = fLo + (fHi - fLo) * r.next();
    const d = 0.02 + r.next() * 0.05;
    const x = shape(osc(d, (t) => f * (1 + (t / d) * 1.6)), (t) => Math.sin((Math.PI * t) / d));
    mixIn(out, x, r.next() * sec * 0.9, 0.3 + r.next() * 0.7);
  }
  return out;
}
/** thump: pitched-down sine for impacts */
const thump = (sec: number, f0: number, f1: number, tau: number) => shape(osc(sec, sweep(f0, f1, sec * 0.6, 0.5)), ad(0.002, tau));
/** whoosh: band-passed noise sweeping in frequency with a swell */
const whoosh = (sec: number, seed: number, f0: number, f1: number, q = 1.4, peak = 0.4) => shape(bp(noise(sec, seed), sweep(f0, f1, sec), q), swell(sec * peak, sec));

// ------------------------------------------------------------------ the library
export function buildSoundLibrary(): Map<string, Float32Array> {
  const L = new Map<string, Float32Array>();
  const put = (name: string, x: Float32Array, peak = 0.9) => L.set(name, normalize(x, peak));

  // ---- FIRE
  put('fire_cast', sum(0.9,
    [whoosh(0.9, 11, 250, 1600, 1.2, 0.8), 0.8],
    [shape(lp(noise(0.9, 12), 220), swell(0.7, 0.9)), 1.1],
    [crackle(0.9, 13, sweep(20, 120, 0.9)), 0.5]));
  put('fire_bolt', sum(0.5,
    [whoosh(0.5, 21, 1400, 350, 1.2, 0.15), 0.9],
    [shape(lp(noise(0.5, 22), 400), ad(0.02, 0.15)), 0.6],
    [crackle(0.5, 23, 60), 0.35]), 0.75);
  put('fire_hit', reverb(sum(0.8,
    [thump(0.3, 110, 40, 0.1), 1],
    [shape(lp(noise(0.8, 31), sweep(3000, 500, 0.5)), ad(0.003, 0.12)), 0.9],
    [crackle(0.8, 32, (t) => 90 * Math.exp(-t * 3)), 0.6]), 0.6, 0.2), 0.85);
  put('fire_rumble', shape(lp(brown(0.8, 41), 180), swell(0.75, 0.8)), 0.7);
  put('fire_erupt', reverb(sum(1.8,
    [thump(0.5, 80, 30, 0.25), 1.2],
    [shape(lp(noise(1.8, 51), sweep(2500, 400, 1.6)), ad(0.01, 0.45)), 1],
    [shape(lp(brown(1.8, 52), 250), ad(0.05, 0.6)), 1.1],
    [crackle(1.8, 53, (t) => 160 * Math.exp(-t * 1.2)), 0.7]), 1.2, 0.25), 0.95);
  put('fire_end', shape(sum(1.2, [crackle(1.2, 61, (t) => 40 * (1 - t / 1.2)), 0.8], [lp(noise(1.2, 62), 300), 0.3]), (t) => 1 - t / 1.2), 0.45);

  // ---- ICE
  put('ice_cast', reverb(sum(1,
    [tinkles(1, 14, 71, 1800, 4200, (u) => u * u), 0.9],
    [shape(hp(noise(1, 72), sweep(3000, 7000, 1)), swell(0.9, 1)), 0.25],
    [shape(osc(1, sweep(1200, 1900, 1), 'sine'), swell(0.8, 1)), 0.15]), 0.9, 0.35), 0.75);
  put('ice_bolt', sum(0.45,
    [shape(osc(0.45, (t) => 2100 - t * 1400 + Math.sin(t * 90) * 40), ad(0.01, 0.12)), 0.35],
    [whoosh(0.45, 81, 5000, 1800, 1.8, 0.2), 0.7]), 0.7);
  put('ice_hit', reverb(sum(0.7,
    [shape(hp(noise(0.7, 91), 2200), ad(0.0005, 0.018)), 1.3],
    [tinkles(0.7, 12, 92, 2400, 6000, (u) => Math.pow(u, 0.6)), 0.8],
    [thump(0.2, 180, 90, 0.05), 0.4]), 0.5, 0.2), 0.85);
  put('ice_spike', reverb(sum(0.6,
    [shape(hp(noise(0.6, 101), 1500), ad(0.0005, 0.02)), 1.2],
    [thump(0.35, 140, 50, 0.1), 0.9],
    [shape(bp(noise(0.6, 102), sweep(500, 1400, 0.25), 3), ad(0.01, 0.1)), 0.7],
    [tinkles(0.6, 5, 103, 2000, 4500), 0.4]), 0.5, 0.2), 0.8);
  put('ice_shatter', reverb(sum(1.2,
    [tinkles(1.2, 42, 111, 1800, 7000, (u) => Math.pow(u, 1.8)), 1],
    [shape(hp(noise(1.2, 112), 900), ad(0.001, 0.08)), 0.9],
    [shape(bp(noise(1.2, 113), 700, 1.2), ad(0.005, 0.15)), 0.5]), 0.8, 0.3), 0.85);
  put('freeze', sum(0.6,
    [crackle(0.6, 121, sweep(40, 400, 0.5), 6000), 0.8],
    [shape(bp(noise(0.6, 122), sweep(900, 3000, 0.6), 4), swell(0.5, 0.6)), 0.4]), 0.7);

  // ---- WATER
  put('water_cast', reverb(sum(1,
    [bubbles(1, 36, 131), 0.8],
    [shape(bp(noise(1, 132), (t) => 500 + 300 * Math.sin(t * 23) + 200 * Math.sin(t * 37), 4), swell(0.8, 1)), 0.7],
    [shape(lp(noise(1, 133), 900), swell(0.7, 1)), 0.4]), 0.6, 0.25), 0.75);
  put('water_whip', sum(0.45,
    [shape(bp(noise(0.45, 141), sweep(600, 2400, 0.2), 3), swell(0.12, 0.45)), 1],
    [bubbles(0.45, 8, 142, 500, 1400), 0.5]), 0.75);
  put('splash', reverb(sum(0.8,
    [shape(lp(noise(0.8, 151), sweep(5000, 1200, 0.4)), ad(0.004, 0.1)), 1],
    [bubbles(0.8, 20, 152, 400, 1500), 0.6],
    [thump(0.15, 140, 70, 0.04), 0.4]), 0.4, 0.2), 0.8);
  put('wave', reverb(sum(2,
    [shape(lp(noise(2, 161), (t) => 400 + 3000 * swell(0.9, 2)(t)), swell(0.9, 2)), 1.1],
    [shape(lp(brown(2, 162), 300), swell(1, 2)), 0.8],
    [bubbles(2, 50, 163, 300, 1200), 0.35]), 0.8, 0.25), 0.9);
  put('steam', shape(hp(noise(1.4, 171), sweep(2500, 5000, 1.4)), (t) => (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.45))), 0.6);

  // ---- AIR
  put('wind_cast', whoosh(0.9, 181, 200, 900, 1.3, 0.6), 0.75);
  put('gale', sum(0.4,
    [whoosh(0.4, 191, 2400, 600, 1.8, 0.2), 1],
    [shape(osc(0.4, sweep(1800, 900, 0.4)), ad(0.02, 0.08)), 0.15]), 0.7);
  put('gust_hit', sum(0.35, [whoosh(0.35, 201, 900, 250, 1, 0.1), 1], [thump(0.12, 120, 60, 0.03), 0.4]), 0.7);
  put('whirl', shape(sum(4.6,
    [bp(noise(4.6, 211), (t) => 380 + 220 * Math.sin(t * 5.1) + 120 * Math.sin(t * 13.7), 3), 1],
    [bp(noise(4.6, 212), (t) => 900 + 400 * Math.sin(t * 3.3 + 1), 5), 0.35],
    [lp(brown(4.6, 213), 160), 0.5]), (t) => Math.min(1, t / 0.4) * Math.min(1, (4.6 - t) / 0.8)), 0.8);
  put('wind_end', whoosh(0.9, 221, 700, 180, 1, 0.1), 0.5);
  put('thud', sum(0.3, [thump(0.25, 90, 45, 0.06), 1], [shape(lp(noise(0.3, 231), 700), ad(0.002, 0.04)), 0.5]), 0.7);

  // ---- HEAVEN / QI
  put('thunder', reverb(sum(3,
    [shape(noise(3, 241), ad(0.001, 0.05)), 1.2],
    [shape(lp(noise(3, 242), sweep(4000, 300, 0.6)), ad(0.002, 0.3)), 1],
    [shape(lp(brown(3, 243), 120), (t) => (t < 0.1 ? t / 0.1 : Math.exp(-(t - 0.1) / 0.9)) * (0.75 + 0.25 * Math.sin(t * 17))), 1.4]), 1.5, 0.3), 1);
  put('wrath_gather', sum(1.7,
    [shape(lp(brown(1.7, 251), sweep(90, 220, 1.7)), swell(1.6, 1.7)), 1],
    [crackle(1.7, 252, sweep(5, 50, 1.7), 5000), 0.3]), 0.75);
  put('talisman_cast', shape(bp(noise(0.3, 261), 1800, 1.5), (t) => (0.5 + 0.5 * Math.sin(t * 190)) * ad(0.01, 0.08)(t)), 0.5);
  put('talisman_hit', reverb(sum(0.5, [thump(0.15, 300, 90, 0.04), 0.8], [shape(hp(noise(0.5, 271), 1200), ad(0.002, 0.12)), 0.7], [crackle(0.5, 272, 80), 0.3]), 0.4, 0.2), 0.75);

  // ---- COMBAT / UI
  {
    // a bow shot, unpitched (a plucked-string model read as an instrument): the limbs' dull
    // thud, the string's slap on the bracer, and the fletching hissing away
    const thud = shape(lp(noise(0.12, 283), sweep(900, 250, 0.05)), ad(0.001, 0.018));
    const slap = shape(bp(noise(0.06, 284), 1400, 0.9), ad(0.0005, 0.007));
    const hiss = shape(bp(noise(0.3, 282), sweep(3200, 1100, 0.22, 0.7), 2.2), (t) => (t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.07)));
    put('arrow', sum(0.32, [thump(0.1, 150, 80, 0.02), 0.7], [thud, 0.9], [slap, 0.6], [hiss, 0.55, 0.01]), 0.5);
  }
  put('arrow_hit', sum(0.2, [thump(0.12, 220, 120, 0.02), 0.8], [shape(bp(noise(0.2, 291), 900, 2), ad(0.001, 0.03)), 0.6]), 0.45);
  put('melee', reverb(sum(0.4, [ping(0.4, 520, 0.12, 301), 0.6], [shape(hp(noise(0.4, 302), 2000), ad(0.001, 0.02)), 0.9]), 0.3, 0.15), 0.4);
  put('explosion', reverb(soft(sum(1.6,
    [thump(0.6, 70, 28, 0.3), 1.2],
    [shape(lp(noise(1.6, 311), sweep(3000, 250, 1)), ad(0.003, 0.35)), 1],
    [crackle(1.6, 312, (t) => 100 * Math.exp(-t * 2)), 0.5]), 1.6), 1, 0.3), 0.95);
  put('gong', reverb(sum(2.2, [ping(2.2, 180, 1.3, 321), 1], [shape(lp(noise(2.2, 322), 600), ad(0.002, 0.05)), 0.3]), 1, 0.3), 0.6);
  put('chime', reverb(ping(0.9, 880, 0.35, 331), 0.6, 0.3), 0.45);
  put('click', shape(hp(noise(0.03, 341), 2500), ad(0.0005, 0.006)), 0.35);
  put('deploy', reverb(sum(1.2, [shape(bp(noise(1.2, 351), sweep(200, 700, 1), 2), swell(0.8, 1.2)), 1], [thump(0.4, 90, 40, 0.15), 0.8, 0.8]), 0.8, 0.25), 0.7);
  return L;
}

export { len, Rng, buf, noise, brown, lp, hp, bp, shape, ad, swell, sweep, osc, mixIn, sum, soft, normalize, reverb, ping, thump };
export type { Curve };
