// Generative score. A small composer schedules notes a fraction of a second ahead on the audio
// clock, so it never loops the same way twice and costs almost nothing:
//   * D yu-mode pentatonic (D F G A C), 84 BPM, 8-bar phrases over a four-chord cycle
//   * a sheng drone and guzheng arpeggios carry the harmony; the dizi (calm) or the erhu
//     (battle) sings motifs that repeat with variation (A A' B A'')
//   * layers follow the game: calm → taiko and pipa join under tension → full drums, erhu lead
//     and gong in battle. Levels change on bar lines so the music never lurches.
// Platform-neutral: it only needs AudioOutput.play with a start time.

import type { AudioOutput } from '../platform/platform';

const BPM = 84;
const STEP = 60 / BPM / 4; // a sixteenth note (s)
const LOOKAHEAD = 0.4;
const TONIC = 62; // D4
const SCALE = [0, 3, 5, 7, 10]; // yu mode
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
const INST: Record<string, [string, number][]> = {
  gz: [['m_gz_a3', 57], ['m_gz_a4', 69]],
  pipa: [['m_pipa_a3', 57], ['m_pipa_a4', 69]],
  dizi: [['m_dizi_a4', 69], ['m_dizi_a5', 81]],
  erhu: [['m_erhu_a3', 57], ['m_erhu_a4', 69]],
  drone: [['m_drone_a2', 45]],
  bell: [['m_bell_a5', 81]],
};

/** scale degree (any integer) → MIDI note */
const deg = (d: number) => TONIC + 12 * Math.floor(d / 5) + SCALE[((d % 5) + 5) % 5];

interface Motif {
  rhythm: [number, number][];
  degrees: number[];
}

export class Music {
  /** 0 calm … 1 full battle, smoothed by the caller */
  intensity = 0;
  private level = 0;
  private step = 0;
  private next: number | null = null;
  private prog = PROGRESSIONS[0];
  private motifs: Motif[] = [];
  private lead: 'dizi' | 'erhu' = 'dizi';
  private rest = false;
  private r = Math.random;
  enabled = true;

  constructor(private audio: AudioOutput) {}

  update() {
    const a = this.audio;
    if (!a.ready || !this.enabled) {
      this.next = null;
      return;
    }
    const now = a.time;
    // (re)start, or resync after the tab was hidden
    if (this.next === null || this.next < now - 0.25) this.next = now + 0.1;
    while (this.next < now + LOOKAHEAD) {
      this.schedule(this.step, this.next);
      this.step++;
      this.next += STEP;
    }
  }

  private play(inst: string, midi: number, at: number, vol: number, pan = 0, dur?: number) {
    const bases = INST[inst];
    let best = bases[0];
    for (const b of bases) if (Math.abs(b[1] - midi) < Math.abs(best[1] - midi)) best = b;
    this.audio.play(best[0], { at, rate: Math.pow(2, (midi - best[1]) / 12), volume: vol, pan, bus: 'music', duration: dur });
  }
  private hit(name: string, at: number, vol: number, pan = 0) {
    this.audio.play(name, { at, volume: vol, pan, bus: 'music' });
  }

  /** a two-bar motif: a walk over the scale that lands on a chord tone */
  private makeMotif(root: number): Motif {
    const rhythm = RHYTHMS[Math.floor(this.r() * RHYTHMS.length)];
    const degrees: number[] = [];
    let d = root + 5 + Math.floor(this.r() * 3);
    for (let i = 0; i < rhythm.length; i++) {
      degrees.push(d);
      d += [-2, -1, -1, 1, 1, 2, 0][Math.floor(this.r() * 7)];
      d = Math.max(root + 3, Math.min(root + 10, d));
    }
    degrees[degrees.length - 1] = root + 5 + (this.r() < 0.5 ? 0 : 2);
    return { rhythm, degrees };
  }

  private schedule(step: number, t: number) {
    const s = step % 16; // sixteenth in the bar
    const bar = Math.floor(step / 16);
    const pbar = bar % 8; // bar in the phrase
    const chordIdx = Math.floor(pbar / 2);
    // phrase start: choose the harmony, the lead and the motifs
    if (s === 0 && pbar === 0) {
      this.prog = PROGRESSIONS[Math.floor(this.r() * PROGRESSIONS.length)];
      const A = this.makeMotif(this.prog[0]);
      const B = this.makeMotif(this.prog[2]);
      const shift = (m: Motif, by: number, end?: number): Motif => ({ rhythm: m.rhythm, degrees: m.degrees.map((d, i) => (i === m.degrees.length - 1 && end !== undefined ? end : d + by)) });
      this.motifs = [A, shift(A, this.prog[1] - this.prog[0]), B, shift(A, 0, this.prog[0] + 5)];
      // the calm score breathes: the melody sits out some phrases
      // (never in the first phrases, so the music is there from the start)
      this.rest = this.level === 0 && bar >= 16 && this.r() < 0.3;
    }
    // intensity → level, only on two-bar lines, with hysteresis
    if (s === 0 && bar % 2 === 0) {
      const up = this.level === 0 ? 0.3 : 0.7, down = this.level === 2 ? 0.45 : 0.15;
      const prev = this.level;
      if (this.intensity > up && this.level < 2) this.level++;
      else if (this.intensity < down && this.level > 0) this.level--;
      if (this.level === 2 && prev < 2) {
        // battle breaks in: a drum roll into a gong
        for (let i = 0; i < 4; i++) this.hit('m_taiko_mid', t + (i * STEP) / 2, 0.25 + i * 0.06, i % 2 ? 0.3 : -0.3);
        this.hit('m_gong', t + STEP * 2, 0.4);
      }
      this.lead = this.level === 2 ? 'erhu' : 'dizi';
    }
    const L = this.level;
    const root = this.prog[chordIdx];
    const low = (d: number) => deg(d) - 12;

    // ---- harmony bed
    if (s === 0 && pbar % 2 === 0) this.play('drone', deg(root) - 24, t, L === 0 ? 0.1 : 0.13, 0, STEP * 32 + 0.9);
    // guzheng: arpeggios (sparse when calm), a glissando into each new phrase
    const arp = L === 0 ? [0, 6, 10] : L === 1 ? [0, 3, 6, 8, 11, 14] : [0, 4, 8, 12];
    const ai = arp.indexOf(s);
    if (ai >= 0 && !(L === 2 && pbar % 2 === 1)) {
      const d = root + [0, 2, 3, 5, 7, 8][(ai + bar) % 6];
      this.play('gz', low(d), t, L === 0 ? 0.5 : 0.4, -0.35, undefined);
    }
    if (pbar === 7 && s >= 10) {
      for (let k = 0; k < 2; k++) this.play('gz', low(root + (s - 10) * 2 + k + 3), t + (k * STEP) / 2, 0.32, -0.2);
    }

    // ---- melody
    if (!this.rest && this.motifs.length) {
      const m = this.motifs[Math.floor(pbar / 2)];
      const local = (pbar % 2) * 16 + s;
      const n = m.rhythm.findIndex(([st]) => st === local);
      if (n >= 0) {
        const [, len] = m.rhythm[n];
        const midi = deg(m.degrees[n]);
        const lead = L === 2 ? 'erhu' : this.lead;
        this.play(lead, lead === 'erhu' ? midi - 12 : midi, t, lead === 'erhu' ? 0.3 : 0.24, 0.15, Math.max(STEP * 2, len * STEP * 0.95));
        // a dizi answers the erhu an octave up on the long notes
        if (L === 2 && len >= 8 && this.r() < 0.5) this.play('dizi', midi + 12, t + STEP * 2, 0.12, 0.4, len * STEP * 0.7);
      }
    }

    // ---- pipa: off-beat plucks under tension, tremolo in battle
    if (L >= 1) {
      if (L === 1 && (s === 2 || s === 10)) this.play('pipa', deg(root + 2), t, 0.18, 0.35);
      if (L === 2 && s % 2 === 0 && (s < 4 || (s >= 8 && s < 12))) this.play('pipa', deg(root + (s < 8 ? 0 : 2)), t, 0.14 + (s % 4 === 0 ? 0.06 : 0), 0.35);
    }

    // ---- percussion
    if (L === 0) {
      if (bar % 2 === 1 && s === 8) this.hit('m_block', t, 0.18, 0.25);
      if (pbar === 0 && s === 0) this.play('bell', deg(root + 10), t, 0.22, -0.2);
    } else if (L === 1) {
      if (s === 0 || s === 8) this.hit('m_taiko_mid', t, s === 0 ? 0.32 : 0.22, -0.1);
      if (s === 12) this.hit('m_rim', t, 0.12, 0.2);
      // the artificers' clockwork, ticking under the tension
      this.hit('m_tick', t, s % 4 === 0 ? 0.06 : 0.035, 0.45);
    } else {
      if (s === 0 || s === 6 || s === 10) this.hit('m_taiko', t, s === 0 ? 0.5 : 0.36, 0);
      if (s === 4 || s === 12 || s === 14) this.hit('m_taiko_mid', t, 0.3, s === 14 ? 0.3 : -0.2);
      if (s % 2 === 1) this.hit('m_rim', t, 0.06, 0.3);
      if (pbar === 0 && s === 0) this.hit('m_gong', t, 0.3);
      this.hit('m_tick', t, 0.03, 0.5);
    }
  }
}
