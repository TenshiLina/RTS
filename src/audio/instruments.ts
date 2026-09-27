// Music instruments, synthesised at start-up like the sound effects (no sample files). Each
// instrument is one or two pitched samples that the composer transposes by playback rate:
//   guzheng / pipa   plucked strings (Karplus–Strong) — bright steel zither, short lute
//   dizi             bamboo flute: breathy partials, vibrato, the membrane's buzz
//   erhu             two-string fiddle: bowed sawtooth through body formants, slide-in, vibrato
//   sheng drone      reed-organ fifth for the harmony bed
//   taiko, rim, muyu woodblock, temple bell, wind gong, and a faint clockwork tick (the Azure
//   Dynasty's artificer workshops)

import { SAMPLE_RATE, Rng, buf, noise, lp, hp, bp, shape, ad, swell, sweep, osc, mixIn, sum, soft, normalize, reverb, ping, thump } from './synth';
import type { Curve } from './synth';

const SR = SAMPLE_RATE;
const TAU = Math.PI * 2;
const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Karplus–Strong string: a noise burst circulating in a delay line one period long. */
function ks(f0: number, sec: number, seed: number, t60: number, bright: number, pickPos = 0.18): Float32Array {
  const N = Math.max(2, Math.round(SR / f0));
  const r = new Rng(seed);
  const ex = new Float32Array(N);
  for (let i = 0; i < N; i++) ex[i] = r.bi();
  // pluck position: comb out the harmonics with a node there
  const p = Math.max(1, Math.round(N * pickPos));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = ex[i] - 0.85 * ex[(i - p + N) % N];
  const g = Math.pow(0.001, 1 / (f0 * t60));
  const out = buf(sec);
  let k = 0;
  for (let i = 0; i < out.length; i++) {
    const cur = line[k], nxt = line[(k + 1) % N];
    out[i] = cur;
    line[k] = (cur * bright + nxt * (1 - bright)) * g;
    k = (k + 1) % N;
  }
  return out;
}
/** fade the last `f` seconds to silence */
function tail(x: Float32Array, f: number) {
  const n = Math.min(x.length, Math.round(f * SR));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= Math.pow(i / n, 1.5);
  return x;
}

function guzheng(m: number, seed: number) {
  const f = midiHz(m), sec = 3.4;
  const s = ks(f, sec, seed, 4.2, 0.64, 0.12);
  const click = shape(hp(noise(0.02, seed + 1), 3000), ad(0.0005, 0.004));
  const body = bp(s, 480, 1.1);
  return normalize(reverb(tail(sum(sec, [s, 0.8], [body, 0.35], [click, 0.25]), 0.6), 0.9, 0.22), 0.8);
}
function pipa(m: number, seed: number) {
  const f = midiHz(m), sec = 1.5;
  const s = ks(f, sec, seed, 1.1, 0.72, 0.22);
  const pick = shape(bp(noise(0.03, seed + 1), 2600, 1.2), ad(0.0005, 0.008));
  return normalize(reverb(tail(sum(sec, [s, 0.8], [bp(s, 330, 1.3), 0.4], [pick, 0.45]), 0.4), 0.6, 0.18), 0.8);
}
function dizi(m: number, seed: number) {
  const f0 = midiHz(m), sec = 2.8;
  // a breath of flatness at the attack, then vibrato once the note settles
  const fc: Curve = (t) => f0 * (1 - 0.015 * Math.max(0, 1 - t / 0.07)) * (1 + (t > 0.3 ? 0.006 * Math.min(1, (t - 0.3) / 0.4) * Math.sin(TAU * 5.3 * t) : 0));
  const tone = sum(sec, [osc(sec, fc), 0.9], [osc(sec, (t) => fc(t) * 2), 0.32], [osc(sec, (t) => fc(t) * 3), 0.16], [osc(sec, (t) => fc(t) * 4), 0.06]);
  // the dimo membrane: a buzzy edge on the tone
  const buzz = bp(soft(tone.slice(), 3), f0 * 5, 1.5);
  const breath = sum(sec, [bp(noise(sec, seed), f0 * 2, 3), 0.1], [shape(hp(noise(sec, seed + 1), 3500), ad(0.01, 0.06)), 0.05]);
  const env: Curve = (t) => Math.min(1, t / 0.07) * (0.92 + 0.08 * Math.exp(-t * 2)) * (t > sec - 0.4 ? (sec - t) / 0.4 : 1);
  return normalize(reverb(shape(sum(sec, [tone, 1], [buzz, 0.25], [breath, 1]), env), 1.1, 0.25), 0.75);
}
function erhu(m: number, seed: number) {
  const f0 = midiHz(m), sec = 3;
  // slide up into the note, then a singing vibrato
  const fc: Curve = (t) => f0 * (1 - 0.035 * Math.max(0, 1 - t / 0.14) ** 2) * (1 + (t > 0.28 ? 0.011 * Math.min(1, (t - 0.28) / 0.5) * Math.sin(TAU * 6.1 * t) : 0));
  const saw = osc(sec, fc, 'saw');
  const body = sum(sec, [bp(saw, 720, 1.2), 0.9], [bp(saw, 1550, 2.4), 0.5], [lp(saw, 2400), 0.35]);
  const bow = bp(noise(sec, seed), 2200, 0.8);
  const env: Curve = (t) => Math.min(1, t / 0.16) ** 1.4 * (t > sec - 0.45 ? (sec - t) / 0.45 : 1);
  return normalize(reverb(shape(sum(sec, [lp(body, 4200), 1], [bow, 0.04]), env), 1.1, 0.25), 0.75);
}
function drone(m: number) {
  // long enough that consecutive drones overlap (no dip at each chord change)
  const f = midiHz(m), sec = 8;
  const trem: Curve = (t) => 0.85 + 0.15 * Math.sin(TAU * 0.35 * t);
  const reed = (hz: number) => lp(osc(sec, hz, 'saw'), 900);
  const x = sum(sec, [reed(f), 0.6], [reed(f * 1.5), 0.35], [reed(f * 2), 0.25], [osc(sec, f / 2), 0.3]);
  return normalize(reverb(shape(x, (t) => trem(t) * Math.min(1, t / 0.7) * (t > sec - 1.6 ? (sec - t) / 1.6 : 1)), 1.4, 0.3), 0.6);
}

// ------------------------------------------------------------------ remix kits
// Iron Mandate (industrial, C&C), Jade Arcade (chiptune), Neon Dynasty (synthwave)

/** naive (aliased on purpose) pulse / triangle oscillators for the chip kit */
function pulse(sec: number, f: Curve | number, duty: number) {
  const b = buf(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    ph += (typeof f === 'number' ? f : f(i / SR)) / SR;
    b[i] = ph - Math.floor(ph) < duty ? 1 : -1;
  }
  return b;
}
function stepTri(sec: number, f: number) {
  const x = osc(sec, f, 'tri');
  for (let i = 0; i < x.length; i++) x[i] = Math.round(x[i] * 7.5) / 7.5; // 4-bit steps
  return x;
}
/** detuned saw stack (supersaw-ish) */
function saws(sec: number, f: number, cents: number[], seed = 0) {
  const out = buf(sec);
  cents.forEach((c, i) => mixIn(out, osc(sec, f * Math.pow(2, c / 1200), 'saw', ((seed + i) * 0.37) % 1), 0, 1 / cents.length));
  return out;
}
/** sustained note with attack / release baked in (the player cuts it with `duration`) */
const hold = (sec: number, a: number, r: number): Curve => (t) => Math.min(1, t / a) * (t > sec - r ? Math.max(0, (sec - t) / r) : 1);

function industrialKit(L: Map<string, Float32Array>) {
  L.set('ind_kick', normalize(soft(sum(0.5, [thump(0.5, 170, 46, 0.26), 1.2], [shape(hp(noise(0.02, 601), 1500), ad(0.0005, 0.004)), 0.5]), 1.8), 0.95));
  L.set('ind_snare', normalize(reverb(soft(sum(0.4, [shape(bp(noise(0.4, 602), 1900, 0.8), ad(0.001, 0.12)), 1], [shape(osc(0.4, 188), ad(0.001, 0.06)), 0.6]), 1.6), 0.5, 0.2), 0.9));
  L.set('ind_hat', normalize(shape(hp(noise(0.08, 603), 7000), ad(0.0005, 0.022)), 0.6));
  L.set('ind_ohat', normalize(shape(hp(noise(0.4, 604), 6500), ad(0.001, 0.16)), 0.6));
  // steampunk anvil: an inharmonic clang
  L.set('ind_anvil', normalize(reverb(sum(0.9, [ping(0.9, 1240, 0.35, 605), 1], [ping(0.9, 1873, 0.22, 606), 0.6], [shape(hp(noise(0.9, 607), 3000), ad(0.0005, 0.01)), 0.5]), 0.6, 0.2), 0.7));
  // synth bass: saw + square sub through a closing filter (A1 base)
  const bf = midiHz(33);
  L.set('ind_bass', normalize(soft(shape(lp(sum(0.8, [osc(0.8, bf, 'saw'), 0.7], [pulse(0.8, bf / 2, 0.5), 0.35]), sweep(1800, 260, 0.14, 0.6), 1.3), hold(0.8, 0.004, 0.08)), 1.4), 0.85));
  // power chords (E2 base): root + fifth + octave through a hot overdrive
  const pc = (sec: number, tau: number) => {
    const f = midiHz(40);
    const x = sum(sec, [saws(sec, f, [-7, 6]), 1], [saws(sec, f * 1.498, [-5, 8], 2), 0.8], [saws(sec, f * 2, [3, -4], 4), 0.6]);
    return normalize(lp(soft(shape(x, (t) => Math.min(1, t / 0.004) * Math.exp(-t / tau)), 7), 2600), 0.8);
  };
  L.set('ind_chug', pc(0.35, 0.07));
  L.set('ind_power', normalize(reverb(pc(2.2, 1.1), 0.6, 0.15), 0.8));
  // orchestra hit (D4 base): brassy saw stack + noise burst, big room
  const oh = midiHz(62);
  L.set('ind_hit', normalize(reverb(shape(sum(1.2, [bp(saws(1.2, oh, [-10, 0, 9]), 900, 0.7), 1], [bp(saws(1.2, oh * 1.5, [-6, 7], 3), 1400, 0.8), 0.6], [saws(1.2, oh / 2, [0, 5], 5), 0.6], [shape(bp(noise(1.2, 608), 2500, 0.8), ad(0.001, 0.05)), 0.5]), ad(0.004, 0.22)), 1.2, 0.35), 0.9));
  // lead synth (A4 base): square + saw, vibrato
  const lf: Curve = (t) => midiHz(69) * (1 + (t > 0.18 ? 0.007 * Math.sin(TAU * 5.6 * t) : 0));
  L.set('ind_lead', normalize(reverb(shape(lp(sum(1.6, [pulse(1.6, lf, 0.5), 0.6], [osc(1.6, (t) => lf(t) * 1.004, 'saw'), 0.5]), 3200), hold(1.6, 0.01, 0.2)), 0.7, 0.2), 0.7));
  // riser (two bars at 128 BPM): noise sweeping up
  L.set('ind_riser', normalize(shape(bp(noise(3.75, 609), sweep(300, 7000, 3.75, 2), 1.8), (t) => Math.pow(t / 3.75, 1.8)), 0.6));
}

function chipKit(L: Map<string, Float32Array>) {
  const vib = (m: number): Curve => (t) => midiHz(m) * (1 + (t > 0.15 ? 0.008 * Math.sin(TAU * 6 * t) : 0));
  L.set('chip_sq', normalize(shape(pulse(1.2, vib(69), 0.5), hold(1.2, 0.002, 0.05)), 0.5));
  L.set('chip_p25', normalize(shape(pulse(1.2, vib(69), 0.25), hold(1.2, 0.002, 0.05)), 0.5));
  L.set('chip_p12', normalize(shape(pulse(0.3, midiHz(69), 0.125), (t) => Math.exp(-t / 0.12)), 0.45));
  L.set('chip_tri', normalize(shape(stepTri(0.6, midiHz(45)), hold(0.6, 0.002, 0.04)), 0.7));
  // noise channel: a 15-bit LFSR, like the consoles
  const lfsr = (sec: number, rate: number, short: boolean) => {
    const b = buf(sec);
    let r = 1, acc = 0, v = 1;
    for (let i = 0; i < b.length; i++) {
      acc += rate / SR;
      while (acc >= 1) {
        acc -= 1;
        const bit = (r ^ (r >> (short ? 6 : 1))) & 1;
        r = (r >> 1) | (bit << 14);
        v = r & 1 ? 1 : -1;
      }
      b[i] = v;
    }
    return b;
  };
  L.set('chip_kick', normalize(sum(0.2, [shape(pulse(0.2, sweep(180, 40, 0.08, 0.5), 0.5), ad(0.001, 0.06)), 0.9], [shape(lfsr(0.2, 9000, false), ad(0.001, 0.01)), 0.3]), 0.8));
  L.set('chip_snare', normalize(sum(0.25, [shape(lfsr(0.25, 14000, false), ad(0.001, 0.07)), 0.9], [shape(pulse(0.25, sweep(260, 160, 0.05), 0.5), ad(0.001, 0.03)), 0.4]), 0.7));
  L.set('chip_hat', normalize(shape(lfsr(0.08, 30000, true), ad(0.0005, 0.018)), 0.45));
}

function neonKit(L: Map<string, Float32Array>) {
  const a3 = midiHz(57);
  L.set('neon_pad', normalize(reverb(shape(lp(saws(4.5, a3, [-14, -5, 0, 6, 13]), 1700), hold(4.5, 0.35, 1.2)), 1.6, 0.35), 0.6));
  L.set('neon_pluck', normalize(reverb(shape(lp(saws(0.7, midiHz(69), [-6, 6]), sweep(5000, 500, 0.18, 0.5), 1.2), ad(0.002, 0.16)), 0.8, 0.3), 0.6));
  L.set('neon_bass', normalize(shape(sum(0.5, [lp(osc(0.5, midiHz(33), 'saw'), 650), 0.7], [osc(0.5, midiHz(33)), 0.6]), hold(0.5, 0.004, 0.06)), 0.85));
  L.set('neon_lead', normalize(reverb(shape(lp(saws(2, midiHz(69), [-8, 8]), 3600), (t) => hold(2, 0.02, 0.3)(t) * (1 + (t > 0.25 ? 0.05 * Math.sin(TAU * 5.4 * t) : 0))), 1.2, 0.3), 0.7));
  L.set('neon_kick', normalize(soft(thump(0.45, 120, 44, 0.3), 1.4), 0.95));
  // gated reverb snare, the '80s way: a big room cut off sharply
  const sn = reverb(sum(0.3, [shape(bp(noise(0.3, 611), 1600, 0.7), ad(0.001, 0.09)), 1], [shape(osc(0.3, 200), ad(0.001, 0.05)), 0.5]), 1.4, 0.6);
  L.set('neon_snare', normalize(shape(sn, (t) => (t < 0.32 ? 1 : Math.max(0, 1 - (t - 0.32) / 0.02))), 0.85));
  L.set('neon_hat', normalize(shape(hp(noise(0.06, 612), 8000), ad(0.0005, 0.02)), 0.5));
  L.set('neon_tom', normalize(reverb(sum(0.6, [thump(0.6, 190, 95, 0.22), 1], [shape(bp(noise(0.6, 613), 700, 1), ad(0.001, 0.04)), 0.4]), 0.8, 0.3), 0.85));
  L.set('neon_crash', normalize(shape(hp(noise(2.5, 614), 3500), ad(0.002, 0.9)), 0.55));
}

export function buildMusicLibrary(): Map<string, Float32Array> {
  const L = new Map<string, Float32Array>();
  L.set('m_gz_a3', guzheng(57, 501));
  L.set('m_gz_a4', guzheng(69, 502));
  L.set('m_pipa_a3', pipa(57, 511));
  L.set('m_pipa_a4', pipa(69, 512));
  L.set('m_dizi_a4', dizi(69, 521));
  L.set('m_dizi_a5', dizi(81, 522));
  L.set('m_erhu_a3', erhu(57, 531));
  L.set('m_erhu_a4', erhu(69, 532));
  L.set('m_drone_a2', drone(45));
  L.set('m_taiko', normalize(reverb(sum(1.4, [thump(1.4, 78, 42, 0.42), 1.2], [shape(lp(noise(1.4, 541), 420), ad(0.001, 0.07)), 0.5], [shape(bp(noise(1.4, 542), 170, 1), ad(0.002, 0.2)), 0.4]), 1.1, 0.22), 0.9));
  L.set('m_taiko_mid', normalize(reverb(sum(0.8, [thump(0.8, 160, 96, 0.17), 1], [shape(bp(noise(0.8, 551), 950, 1.5), ad(0.001, 0.025)), 0.45]), 0.8, 0.2), 0.85));
  L.set('m_rim', normalize(sum(0.16, [ping(0.16, 1900, 0.03, 561), 0.6], [shape(hp(noise(0.16, 562), 2500), ad(0.0005, 0.006)), 0.8]), 0.6));
  const block = (f: number) => sum(0.3, [shape(osc(0.3, f), ad(0.001, 0.05)), 1], [shape(osc(0.3, f * 2.42), ad(0.001, 0.025)), 0.4]);
  L.set('m_block', normalize(reverb(block(820), 0.5, 0.2), 0.7));
  L.set('m_bell_a5', normalize(reverb(ping(2.6, midiHz(81), 1.3, 571), 1.2, 0.3), 0.7));
  L.set('m_gong', normalize(reverb(sum(4.5, [ping(4.5, 128, 2.4, 581), 1], [shape(bp(noise(4.5, 582), sweep(380, 1500, 2.5), 3), swell(1.0, 4.5)), 0.22]), 1.5, 0.3), 0.8));
  L.set('m_tick', normalize(sum(0.06, [shape(hp(noise(0.06, 591), 5000), ad(0.0003, 0.003)), 1], [ping(0.06, 3400, 0.012, 592), 0.35]), 0.5));
  industrialKit(L);
  chipKit(L);
  neonKit(L);
  return L;
}
