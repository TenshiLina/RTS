// Offline render of the generative score (calm → tension → battle → calm) to a WAV file, with
// an AudioOutput stand-in that mixes the scheduled notes. For listening tests and spectrograms.
//   npx tsx tools/render-music.ts out.wav [seconds]
import { writeFileSync } from 'node:fs';
import { buildMusicLibrary } from '../src/audio/instruments';
import { SAMPLE_RATE } from '../src/audio/synth';
import { Music } from '../src/audio/music';
import type { AudioOutput, PlayOptions } from '../src/platform/platform';

const out = process.argv[2] ?? 'music.wav';
// reproducible renders: seed the composer's dice
let seed = parseInt(process.env.SEED ?? '7');
Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 8) / 0x1000000;
const secs = parseFloat(process.argv[3] ?? '96');
const SR = 44100;
const t0 = performance.now();
const lib = buildMusicLibrary();
console.log(`instruments synthesised in ${(performance.now() - t0).toFixed(0)} ms, ${[...lib.values()].reduce((n, b) => n + b.length, 0) / SAMPLE_RATE} s of samples`);
const L = new Float32Array(Math.ceil(secs * SR) + SR * 6), R = new Float32Array(L.length);
let now = 0;
let notes = 0;
const audio: AudioOutput = {
  ready: true,
  get time() { return now; },
  volume: 1,
  register() {},
  setVolume() {},
  setBusVolume() {},
  play(name: string, o: PlayOptions = {}) {
    const pcm = lib.get(name);
    if (!pcm) throw new Error('no sample ' + name);
    notes++;
    const rate = (o.rate ?? 1) * (SAMPLE_RATE / SR);
    const vol = (o.volume ?? 1) * 0.55;
    const pan = o.pan ?? 0;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4), gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const start = Math.round((o.at ?? now) * SR);
    const endT = o.duration !== undefined ? o.duration + 0.15 : Infinity;
    for (let i = 0; ; i++) {
      const src = i * rate;
      const k = Math.floor(src);
      if (k + 1 >= pcm.length || start + i >= L.length) break;
      const t = i / SR;
      if (t > endT) break;
      const rel = o.duration !== undefined && t > o.duration ? 1 - (t - o.duration) / 0.15 : 1;
      const v = (pcm[k] + (pcm[k + 1] - pcm[k]) * (src - k)) * vol * rel;
      L[start + i] += v * gl;
      R[start + i] += v * gr;
    }
  },
};
const m = new Music(audio);
// the story of a match: peace, a skirmish, a battle, aftermath
const curve = (t: number) => (t < 30 ? 0 : t < 50 ? 0.45 : t < 78 ? 1 : 0.1);
for (let t = 0; t < secs; t += 1 / 60) {
  now = t;
  m.intensity += (curve(t) - m.intensity) * Math.min(1, (1 / 60) * (curve(t) > m.intensity ? 1.5 : 0.25));
  m.update();
}
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = peak > 0.95 ? 0.95 / peak : 1;
const n = Math.ceil(secs * SR);
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  const fade = i > n - SR * 3 ? (n - i) / (SR * 3) : 1;
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g * fade)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g * fade)) * 32767), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`${notes} notes, peak ${peak.toFixed(2)} → ${out}`);
