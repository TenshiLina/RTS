// Generative, adaptive background music. A small engine schedules notes a fraction of a second
// ahead on the audio clock; each track is an arrangement that decides, sixteenth by sixteenth,
// what plays. All tracks share the Mandate theme (a D-minor pentatonic hook) so the remixes
// are recognisably one score, and all follow the fighting through three levels:
//   0 calm (building) · 1 tension (a skirmish) · 2 battle — changed on two-bar lines only.
// Tracks:
//   Iron Mandate   industrial rock in the C&C tradition: drum machine, synth bass riff,
//                  palm-muted power chords, orchestra hits, a steampunk anvil
//   Jade Arcade    chiptune: pulse-wave lead with echo, 4-bit triangle bass, LFSR noise drums
//   Neon Dynasty   synthwave: supersaw pads, plucked arpeggios, gated-reverb snare, guzheng hook
//   Five Elements  the original guzheng / dizi / erhu / taiko score
// Platform-neutral: it only needs AudioOutput.play with a start time.

import type { AudioOutput } from '../platform/platform';

const LOOKAHEAD = 0.4;
const TONIC = 62; // D4
const SCALE = [0, 3, 5, 7, 10]; // yu mode (D F G A C)
/** scale degree (any integer) → MIDI note */
const deg = (d: number) => TONIC + 12 * Math.floor(d / 5) + SCALE[((d % 5) + 5) % 5];

/** The Mandate theme: two bars of call, two of answer, in sixteenths — [step, length, MIDI]. */
const HOOK: [number, number, number][] = [
  [0, 2, 74], [2, 2, 77], [4, 2, 79], [6, 4, 81], [10, 2, 79], [12, 2, 77], [14, 2, 79],
  [16, 4, 81], [20, 2, 84], [22, 2, 81], [24, 4, 79], [28, 2, 77], [30, 2, 74],
  [32, 2, 74], [34, 2, 72], [36, 4, 74], [40, 4, 77], [44, 4, 79],
  [48, 6, 81], [54, 2, 79], [56, 4, 77], [60, 4, 74],
];
const hookAt = (step: number) => HOOK.find(([st]) => st === step % 64);

/** sampled instruments: [sample, the MIDI note it was recorded at] (transposed by rate) */
const INST: Record<string, [string, number][]> = {
  gz: [['m_gz_a3', 57], ['m_gz_a4', 69]],
  pipa: [['m_pipa_a3', 57], ['m_pipa_a4', 69]],
  dizi: [['m_dizi_a4', 69], ['m_dizi_a5', 81]],
  erhu: [['m_erhu_a3', 57], ['m_erhu_a4', 69]],
  drone: [['m_drone_a2', 45]],
  bell: [['m_bell_a5', 81]],
  ind_bass: [['ind_bass', 33]],
  ind_chug: [['ind_chug', 40]],
  ind_power: [['ind_power', 40]],
  ind_hit: [['ind_hit', 62]],
  ind_lead: [['ind_lead', 69]],
  chip_sq: [['chip_sq', 69]],
  chip_p25: [['chip_p25', 69]],
  chip_p12: [['chip_p12', 69]],
  chip_tri: [['chip_tri', 45]],
  neon_pad: [['neon_pad', 57]],
  neon_pluck: [['neon_pluck', 69]],
  neon_bass: [['neon_bass', 33]],
  neon_lead: [['neon_lead', 69]],
  neon_tom: [['neon_tom', 50]],
};

export interface Ctx {
  level: number;
  /** seconds per sixteenth */
  step: number;
  r: () => number;
  play(inst: string, midi: number, at: number, vol: number, pan?: number, dur?: number): void;
  hit(name: string, at: number, vol: number, pan?: number): void;
}
export interface Track {
  name: string;
  bpm: number;
  /** loudness match between tracks (measured offline: calm ≈ -29, battle ≈ -23 dBFS RMS) */
  gain: number;
  schedule(c: Ctx, step: number, t: number): void;
  /** a level change on this bar line (fills, hits) */
  onLevel?(c: Ctx, from: number, to: number, t: number): void;
}

// ------------------------------------------------------------------ Iron Mandate
class IronMandate implements Track {
  name = 'Iron Mandate';
  bpm = 128;
  gain = 0.5;
  // Dm · B♭ · C · Dm, two bars each
  private roots = [38, 34, 36, 38];
  private riff = [0, 0, 12, 0, 0, 7, 0, 10, 0, 0, 12, 0, 7, 0, 10, 12];
  schedule(c: Ctx, step: number, t: number) {
    const s = step % 16, bar = Math.floor(step / 16), pbar = bar % 8, L = c.level;
    const root = this.roots[Math.floor(pbar / 2)];
    const h = hookAt(step);
    if (L === 0) {
      // base building: a slow machine pulse under the theme
      if (s === 0) c.hit('ind_kick', t, 0.36);
      if (s % 4 === 2) c.hit('ind_hat', t, 0.1, 0.3);
      if (s % 4 === 0) c.play('ind_bass', root, t, 0.3, 0, c.step * 3);
      if (s === 0 && pbar % 2 === 0) c.play('drone', root + 12, t, 0.08, 0, c.step * 32 + 0.9);
      if ([0, 6, 10].includes(s)) c.play('gz', root + 24 + [0, 7, 12][[0, 6, 10].indexOf(s)], t, 0.22, -0.35);
      if (bar % 2 === 1 && s === 14) c.hit('ind_anvil', t, 0.1, 0.4);
      if (h && Math.floor(bar / 4) % 2 === 1) c.play('ind_lead', h[2] - 12, t, 0.16, 0.15, h[1] * c.step * 0.9);
      return;
    }
    // drums
    const kicks = L === 1 ? [0, 8, 10] : [0, 3, 6, 8, 10, 14];
    if (kicks.includes(s)) c.hit('ind_kick', t, s === 0 ? 0.6 : 0.5);
    if (s === 4 || s === 12) c.hit('ind_snare', t, 0.46);
    if (L === 2 && (s === 7 || s === 15)) c.hit('ind_snare', t, 0.1, 0.2);
    if (L === 2 && s % 4 === 2) c.hit('ind_ohat', t, 0.14, 0.35);
    else if (s % 2 === 0) c.hit('ind_hat', t, s % 4 === 2 ? 0.16 : 0.11, 0.35);
    // the bass riff and the guitars
    c.play('ind_bass', root + this.riff[s], t, L === 2 ? 0.34 : 0.3, 0, c.step * 0.9);
    if (L === 2 && s === 0 && bar % 2 === 0) c.play('ind_power', root, t, 0.22, -0.25, c.step * 14);
    else if (s % 2 === 0 && !(L === 2 && s < 4 && bar % 2 === 0)) c.play('ind_chug', root, t, L === 2 ? 0.17 : 0.14, -0.25);
    // steampunk anvil on the backbeat, orchestra hits on the big downbeats
    if ((L === 1 && s === 12 && bar % 2 === 1) || (L === 2 && (s === 4 || s === 12))) c.hit('ind_anvil', t, 0.12, 0.4);
    if (L === 2 && s === 0 && (pbar === 0 || pbar === 4)) c.play('ind_hit', root + 24, t, pbar === 0 ? 0.42 : 0.3, 0);
    if (L === 2 && pbar === 6 && s === 0) c.hit('ind_riser', t, 0.18, 0);
    // the theme: erhu under tension, lead synth doubling it in battle
    if (h) {
      c.play('erhu', h[2] - 12, t, L === 2 ? 0.2 : 0.26, 0.15, h[1] * c.step * 0.95);
      if (L === 2) c.play('ind_lead', h[2], t, 0.16, 0.25, h[1] * c.step * 0.9);
    }
  }
  onLevel(c: Ctx, from: number, to: number, t: number) {
    if (to === 2) {
      c.play('ind_hit', 62, t, 0.45);
      for (let i = 0; i < 4; i++) c.hit('ind_snare', t + i * c.step * 0.5, 0.16 + i * 0.06, 0.2);
    }
  }
}

// ------------------------------------------------------------------ Jade Arcade
class JadeArcade implements Track {
  name = 'Jade Arcade';
  bpm = 150;
  gain = 0.75;
  // Dm · B♭ · F · C
  private roots = [38, 34, 41, 36];
  private minor = [true, false, false, false];
  schedule(c: Ctx, step: number, t: number) {
    const s = step % 16, bar = Math.floor(step / 16), pbar = bar % 8, L = c.level;
    const ci = Math.floor(pbar / 2), root = this.roots[ci];
    const third = this.minor[ci] ? 3 : 4;
    const tones = [0, third, 7, 12];
    // arpeggio: eighths when calm, sixteenths once things heat up
    if (L >= 1 || s % 2 === 0) c.play('chip_p12', root + 36 + tones[(L >= 1 ? s : s / 2) % 4] - 12, t, L === 0 ? 0.13 : 0.1, (s % 4) - 1.5 > 0 ? 0.3 : -0.3);
    // bass: 4-bit triangle, octave bounce
    if (L === 0 ? s % 4 === 0 : s % 2 === 0) c.play('chip_tri', root + (s % 4 === 2 ? 12 : 0), t, 0.34, 0, c.step * 1.8);
    // noise drums
    if (L >= 1) {
      const kicks = L === 1 ? [0, 8] : [0, 6, 8, 11];
      if (kicks.includes(s)) c.hit('chip_kick', t, 0.5);
      if (s === 4 || s === 12) c.hit('chip_snare', t, 0.34);
      if (L === 2 && pbar === 7 && s >= 8) c.hit('chip_snare', t, 0.14 + (s - 8) * 0.025);
      if (L === 2 ? true : s % 2 === 0) c.hit('chip_hat', t, s % 2 ? 0.06 : 0.1, 0.3);
    }
    // the theme on the square channel, with a delayed echo in battle
    const h = hookAt(step);
    if (h && (L >= 1 || Math.floor(bar / 4) % 2 === 1)) {
      const inst = L === 0 ? 'chip_p25' : 'chip_sq';
      c.play(inst, h[2], t, L === 0 ? 0.16 : 0.2, -0.1, h[1] * c.step * 0.85);
      if (L === 2) c.play('chip_p25', h[2], t + c.step * 3, 0.08, 0.5, h[1] * c.step * 0.7);
    }
  }
  onLevel(c: Ctx, from: number, to: number, t: number) {
    if (to > from) for (let i = 0; i < 6; i++) c.play('chip_sq', 62 + i * 3, t + i * c.step * 0.5, 0.1, 0, c.step * 0.45);
  }
}

// ------------------------------------------------------------------ Neon Dynasty
class NeonDynasty implements Track {
  name = 'Neon Dynasty';
  bpm = 100;
  gain = 0.9;
  // Dm · B♭ · Gm · A
  private roots = [50, 46, 43, 45];
  private minor = [true, false, true, false];
  schedule(c: Ctx, step: number, t: number) {
    const s = step % 16, bar = Math.floor(step / 16), pbar = bar % 8, L = c.level;
    const ci = Math.floor(pbar / 2), root = this.roots[ci];
    const third = this.minor[ci] ? 3 : 4;
    // supersaw pad chord for each two bars
    if (s === 0 && pbar % 2 === 0) for (const k of [0, third, 7]) c.play('neon_pad', root + 12 + k, t, L === 0 ? 0.13 : 0.09, k === third ? 0.3 : -0.2, c.step * 32 + 0.6);
    // plucked arpeggio, ping-ponging
    const arp = [0, 7, 12, third + 12, 7, 12, 19, third + 12];
    if (L >= 1 || s % 2 === 0) c.play('neon_pluck', root + 12 + arp[(L >= 1 ? s : s / 2) % 8], t, L === 0 ? 0.17 : 0.1, s % 4 < 2 ? -0.45 : 0.45);
    // bass pulse
    if (L >= 1 && s % 2 === 0) c.play('neon_bass', root - 12 + (L === 2 && s % 4 === 2 ? 12 : 0), t, 0.22, 0, c.step * 1.7);
    // drums
    if (L === 0 && s === 0) c.hit('neon_kick', t, 0.3);
    if (L >= 1) {
      if (s % 4 === 0) c.hit('neon_kick', t, 0.4);
      if (s === 4 || s === 12) c.hit('neon_snare', t, 0.4);
      if (s % 4 === 2 || (L === 2 && s % 2 === 1)) c.hit('neon_hat', t, s % 4 === 2 ? 0.13 : 0.06, 0.3);
    }
    if (L === 2 && pbar === 0 && s === 0) c.hit('neon_crash', t, 0.22, -0.2);
    if (L === 2 && pbar === 7 && s >= 8 && s % 2 === 0) c.play('neon_tom', 57 - (s - 8), t, 0.3, (s - 11) / 5);
    // the theme: guzheng when calm, saw lead (with the erhu in battle) when it isn't
    const h = hookAt(step);
    if (h) {
      if (L === 0) c.play('gz', h[2] - 12, t, 0.38, 0.15);
      else {
        c.play('neon_lead', h[2], t, L === 2 ? 0.17 : 0.15, 0.1, h[1] * c.step * 0.95);
        if (L === 2) c.play('erhu', h[2] - 12, t, 0.16, -0.15, h[1] * c.step * 0.95);
      }
    }
  }
}

// ------------------------------------------------------------------ Five Elements (the original)
const PROGRESSIONS = [
  [0, 4, 2, 3],
  [2, 0, 4, 3],
  [0, 3, 4, 2],
];
/** rhythms for a two-bar motif: [start step, length in steps] (32 steps) */
const RHYTHMS: [number, number][][] = [
  [[0, 4], [4, 2], [6, 2], [8, 8], [16, 4], [20, 4], [24, 8]],
  [[0, 6], [6, 2], [8, 4], [12, 4], [16, 12], [28, 4]],
  [[0, 2], [2, 2], [4, 4], [8, 4], [12, 2], [14, 2], [16, 16]],
  [[0, 8], [8, 3], [11, 1], [12, 4], [16, 6], [22, 2], [24, 8]],
];
interface Motif {
  rhythm: [number, number][];
  degrees: number[];
}
class FiveElements implements Track {
  name = 'Five Elements';
  bpm = 84;
  gain = 1;
  private prog = PROGRESSIONS[0];
  private motifs: Motif[] = [];
  private rest = false;
  /** a two-bar motif: a walk over the scale that lands on a chord tone */
  private makeMotif(c: Ctx, root: number): Motif {
    const rhythm = RHYTHMS[Math.floor(c.r() * RHYTHMS.length)];
    const degrees: number[] = [];
    let d = root + 5 + Math.floor(c.r() * 3);
    for (let i = 0; i < rhythm.length; i++) {
      degrees.push(d);
      d += [-2, -1, -1, 1, 1, 2, 0][Math.floor(c.r() * 7)];
      d = Math.max(root + 3, Math.min(root + 10, d));
    }
    degrees[degrees.length - 1] = root + 5 + (c.r() < 0.5 ? 0 : 2);
    return { rhythm, degrees };
  }
  schedule(c: Ctx, step: number, t: number) {
    const s = step % 16, bar = Math.floor(step / 16), pbar = bar % 8, L = c.level;
    const chordIdx = Math.floor(pbar / 2);
    if (s === 0 && pbar === 0) {
      this.prog = PROGRESSIONS[Math.floor(c.r() * PROGRESSIONS.length)];
      const A = this.makeMotif(c, this.prog[0]);
      const B = this.makeMotif(c, this.prog[2]);
      const shift = (m: Motif, by: number, end?: number): Motif => ({ rhythm: m.rhythm, degrees: m.degrees.map((d, i) => (i === m.degrees.length - 1 && end !== undefined ? end : d + by)) });
      this.motifs = [A, shift(A, this.prog[1] - this.prog[0]), B, shift(A, 0, this.prog[0] + 5)];
      // the calm score breathes: the melody sits out some phrases (never the first ones)
      this.rest = L === 0 && bar >= 16 && c.r() < 0.3;
    }
    const root = this.prog[chordIdx];
    const low = (d: number) => deg(d) - 12;
    if (s === 0 && pbar % 2 === 0) c.play('drone', deg(root) - 24, t, L === 0 ? 0.1 : 0.13, 0, c.step * 32 + 0.9);
    const arp = L === 0 ? [0, 6, 10] : L === 1 ? [0, 3, 6, 8, 11, 14] : [0, 4, 8, 12];
    const ai = arp.indexOf(s);
    if (ai >= 0 && !(L === 2 && pbar % 2 === 1)) c.play('gz', low(root + [0, 2, 3, 5, 7, 8][(ai + bar) % 6]), t, L === 0 ? 0.5 : 0.4, -0.35);
    if (pbar === 7 && s >= 10) for (let k = 0; k < 2; k++) c.play('gz', low(root + (s - 10) * 2 + k + 3), t + (k * c.step) / 2, 0.32, -0.2);
    if (!this.rest && this.motifs.length) {
      const m = this.motifs[Math.floor(pbar / 2)];
      const n = m.rhythm.findIndex(([st]) => st === (pbar % 2) * 16 + s);
      if (n >= 0) {
        const [, len] = m.rhythm[n];
        const midi = deg(m.degrees[n]);
        const lead = L === 2 ? 'erhu' : 'dizi';
        c.play(lead, lead === 'erhu' ? midi - 12 : midi, t, lead === 'erhu' ? 0.3 : 0.24, 0.15, Math.max(c.step * 2, len * c.step * 0.95));
        if (L === 2 && len >= 8 && c.r() < 0.5) c.play('dizi', midi + 12, t + c.step * 2, 0.12, 0.4, len * c.step * 0.7);
      }
    }
    if (L === 1 && (s === 2 || s === 10)) c.play('pipa', deg(root + 2), t, 0.18, 0.35);
    if (L === 2 && s % 2 === 0 && (s < 4 || (s >= 8 && s < 12))) c.play('pipa', deg(root + (s < 8 ? 0 : 2)), t, 0.14 + (s % 4 === 0 ? 0.06 : 0), 0.35);
    if (L === 0) {
      if (bar % 2 === 1 && s === 8) c.hit('m_block', t, 0.18, 0.25);
      if (pbar === 0 && s === 0) c.play('bell', deg(root + 10), t, 0.22, -0.2);
    } else if (L === 1) {
      if (s === 0 || s === 8) c.hit('m_taiko_mid', t, s === 0 ? 0.32 : 0.22, -0.1);
      if (s === 12) c.hit('m_rim', t, 0.12, 0.2);
      c.hit('m_tick', t, s % 4 === 0 ? 0.06 : 0.035, 0.45);
    } else {
      if (s === 0 || s === 6 || s === 10) c.hit('m_taiko', t, s === 0 ? 0.5 : 0.36, 0);
      if (s === 4 || s === 12 || s === 14) c.hit('m_taiko_mid', t, 0.3, s === 14 ? 0.3 : -0.2);
      if (s % 2 === 1) c.hit('m_rim', t, 0.06, 0.3);
      if (pbar === 0 && s === 0) c.hit('m_gong', t, 0.3);
      c.hit('m_tick', t, 0.03, 0.5);
    }
  }
  onLevel(c: Ctx, from: number, to: number, t: number) {
    if (to === 2) {
      for (let i = 0; i < 4; i++) c.hit('m_taiko_mid', t + (i * c.step) / 2, 0.25 + i * 0.06, i % 2 ? 0.3 : -0.3);
      c.hit('m_gong', t + c.step * 2, 0.4);
    }
  }
}

export const TRACK_NAMES = ['Iron Mandate', 'Jade Arcade', 'Neon Dynasty', 'Five Elements'];

export class Music {
  /** 0 calm … 1 full battle, smoothed by the caller */
  intensity = 0;
  enabled = true;
  private tracks: Track[] = [new IronMandate(), new JadeArcade(), new NeonDynasty(), new FiveElements()];
  private current = 0;
  private level = 0;
  private stepN = 0;
  private next: number | null = null;
  private ctx: Ctx;

  constructor(private audio: AudioOutput) {
    const self = this;
    this.ctx = {
      level: 0,
      step: 0.1,
      r: Math.random,
      play(inst, midi, at, vol, pan = 0, dur) {
        const bases = INST[inst];
        let best = bases[0];
        for (const b of bases) if (Math.abs(b[1] - midi) < Math.abs(best[1] - midi)) best = b;
        self.audio.play(best[0], { at, rate: Math.pow(2, (midi - best[1]) / 12), volume: vol * self.gain, pan, bus: 'music', duration: dur });
      },
      hit(name, at, vol, pan = 0) {
        self.audio.play(name, { at, volume: vol * self.gain, pan, bus: 'music' });
      },
    };
  }

  private get gain() {
    return this.tracks[this.current].gain;
  }
  get track() {
    return this.current;
  }
  get trackName() {
    return this.tracks[this.current].name;
  }
  /** switch arrangement: the new one starts on its first bar right away */
  setTrack(i: number) {
    this.current = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    this.next = null;
    this.stepN = 0;
  }

  update() {
    const a = this.audio;
    if (!a.ready || !this.enabled) {
      this.next = null;
      return;
    }
    const tr = this.tracks[this.current];
    const STEP = 60 / tr.bpm / 4;
    this.ctx.step = STEP;
    const now = a.time;
    // (re)start, or resync after the tab was hidden
    if (this.next === null || this.next < now - 0.25) this.next = now + 0.1;
    while (this.next < now + LOOKAHEAD) {
      const step = this.stepN, t = this.next;
      // intensity → level, only on two-bar lines, with hysteresis
      if (step % 32 === 0) {
        const up = this.level === 0 ? 0.3 : 0.7, down = this.level === 2 ? 0.45 : 0.15;
        const prev = this.level;
        if (this.intensity > up && this.level < 2) this.level++;
        else if (this.intensity < down && this.level > 0) this.level--;
        this.ctx.level = this.level;
        if (prev !== this.level) tr.onLevel?.(this.ctx, prev, this.level, t);
      }
      tr.schedule(this.ctx, step, t);
      this.stepN++;
      this.next += STEP;
    }
  }
}
