import type { AudioOutput, Platform, InputState, Surface, PointerState, GlyphFaceRequest, GlyphAtlasData, GlyphFace } from '../platform';

class WebInput implements InputState {
  pointer: PointerState = { x: 0, y: 0, buttons: 0, wheel: 0, dx: 0, dy: 0, inside: false };
  keys = new Set<string>();
  pressed = new Set<string>();
  clicked = 0;
  released = 0;
  constructor(el: HTMLElement, dpr: () => number) {
    const pos = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()];
    };
    el.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      this.pointer.dx += x - this.pointer.x;
      this.pointer.dy += y - this.pointer.y;
      this.pointer.x = x;
      this.pointer.y = y;
      this.pointer.inside = true;
    });
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const bit = e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
      this.pointer.buttons |= bit;
      this.clicked |= bit;
    });
    el.addEventListener('pointerup', (e) => {
      const bit = e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
      this.pointer.buttons &= ~bit;
      this.released |= bit;
    });
    el.addEventListener('pointerleave', () => (this.pointer.inside = false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.pointer.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY) / 100, 3);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }
  endFrame() {
    this.pointer.wheel = 0;
    this.pointer.dx = 0;
    this.pointer.dy = 0;
    this.pressed.clear();
    this.clicked = 0;
    this.released = 0;
  }
}

/** WebAudio backend: buffers are created lazily once the context exists (after a gesture). */
class WebAudio implements AudioOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private pcm = new Map<string, { data: Float32Array; rate: number }>();
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  volume = 0.8;
  constructor() {
    const unlock = () => {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext ?? (window as any).webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.volume;
          // gentle limiter so stacked explosions don't clip
          const comp = this.ctx.createDynamicsCompressor();
          comp.threshold.value = -14;
          comp.ratio.value = 6;
          this.master.connect(comp).connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') void this.ctx.resume();
      } catch {
        /* no audio available: stay silent */
      }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true });
  }
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }
  register(name: string, pcm: Float32Array, sampleRate: number) {
    this.pcm.set(name, { data: pcm, rate: sampleRate });
  }
  private buffer(name: string) {
    let b = this.buffers.get(name);
    if (b || !this.ctx) return b;
    const src = this.pcm.get(name);
    if (!src) return undefined;
    b = this.ctx.createBuffer(1, src.data.length, src.rate);
    b.getChannelData(0).set(src.data);
    this.buffers.set(name, b);
    return b;
  }
  play(name: string, opts: { volume?: number; pan?: number; rate?: number } = {}) {
    if (!this.ready || this.voices > 40) return;
    const ctx = this.ctx!;
    const b = this.buffer(name);
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    src.connect(g).connect(pan).connect(this.master!);
    this.voices++;
    src.onended = () => this.voices--;
    src.start();
  }
  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
}

export class WebPlatform implements Platform {
  readonly audio: AudioOutput = new WebAudio();
  readonly name = 'web';
  readonly input: InputState;
  readonly surface: Surface;
  private resizeCbs: ((w: number, h: number) => void)[] = [];

  constructor(public canvas: HTMLCanvasElement, private base = './') {
    const self = this;
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    this.surface = {
      width: 1,
      height: 1,
      dpr: dpr(),
      onResize(cb) {
        self.resizeCbs.push(cb);
      },
    };
    const resize = () => {
      const d = dpr();
      const w = Math.max(1, Math.round(canvas.clientWidth * d));
      const h = Math.max(1, Math.round(canvas.clientHeight * d));
      if (w === canvas.width && h === canvas.height && this.surface.dpr === d) return;
      canvas.width = w;
      canvas.height = h;
      this.surface.width = w;
      this.surface.height = h;
      this.surface.dpr = d;
      for (const cb of this.resizeCbs) cb(w, h);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
    this.input = new WebInput(canvas, dpr);
  }
  now() {
    return performance.now() / 1000;
  }
  requestFrame(cb: (t: number) => void) {
    requestAnimationFrame((t) => cb(t / 1000));
  }
  async loadBinary(path: string) {
    const r = await fetch(this.base + path);
    if (!r.ok) throw new Error(`load ${path}: ${r.status}`);
    // Hosts that only serve text types get base64 bundles (`*.b64.txt`) — see tools/pack-hosted.py
    if (path.endsWith('.b64.txt')) {
      const bin = atob((await r.text()).trim());
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    return r.arrayBuffer();
  }
  async loadText(path: string) {
    const r = await fetch(this.base + path);
    if (!r.ok) throw new Error(`load ${path}: ${r.status}`);
    return r.text();
  }
  async rasterizeGlyphs(faces: GlyphFaceRequest[]): Promise<GlyphAtlasData> {
    const fontSet = (document as any).fonts;
    if (fontSet?.load) {
      await Promise.all(faces.map((f) => fontSet.load(`${f.weight} ${f.size}px "${f.family}"`, f.chars).catch(() => null)));
    }
    const W = 1024;
    let H = 256;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    // first pass: measure + shelf-pack
    type Job = { face: string; ch: string; font: string; w: number; h: number; asc: number; left: number; adv: number; x: number; y: number };
    const jobs: Job[] = [];
    const out: Record<string, GlyphFace> = {};
    let x = 1, y = 1, shelf = 0;
    for (const f of faces) {
      const font = `${f.weight} ${f.size}px "${f.family}", "Noto Serif SC", Georgia, serif`;
      ctx.font = font;
      const m = ctx.measureText('Hg国');
      const asc = Math.ceil(m.fontBoundingBoxAscent ?? f.size * 0.8);
      const desc = Math.ceil(m.fontBoundingBoxDescent ?? f.size * 0.25);
      out[f.name] = { size: f.size, lineHeight: Math.ceil((asc + desc) * 1.12), ascent: asc, glyphs: {} };
      for (const ch of new Set([...f.chars])) {
        const gm = ctx.measureText(ch);
        const left = Math.ceil(gm.actualBoundingBoxLeft ?? 0) + 1;
        const w = Math.ceil((gm.actualBoundingBoxRight ?? gm.width) + left) + 2;
        const h = asc + desc + 2;
        if (x + w + 1 > W) {
          x = 1;
          y += shelf + 1;
          shelf = 0;
        }
        jobs.push({ face: f.name, ch, font, w, h, asc, left, adv: gm.width, x, y });
        x += w + 1;
        shelf = Math.max(shelf, h);
      }
    }
    H = 1;
    while (H < y + shelf + 2) H *= 2;
    cv.width = W;
    cv.height = H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    for (const j of jobs) {
      ctx.font = j.font;
      ctx.fillText(j.ch, j.x + j.left, j.y + j.asc + 1);
      out[j.face].glyphs[j.ch] = { x: j.x, y: j.y, w: j.w, h: j.h, xoff: -j.left, yoff: 0, adv: j.adv };
    }
    const img = ctx.getImageData(0, 0, W, H).data;
    const pixels = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      pixels[i * 4] = 255;
      pixels[i * 4 + 1] = 255;
      pixels[i * 4 + 2] = 255;
      pixels[i * 4 + 3] = img[i * 4 + 3];
    }
    return { width: W, height: H, pixels, faces: out };
  }
  private cursor = '';
  setCursor(kind: 'default' | 'select' | 'attack' | 'move' | 'place' | 'power' | 'sell' | 'harvest') {
    const css = { default: 'default', select: 'pointer', attack: 'crosshair', move: 'default', place: 'copy', power: 'crosshair', sell: 'not-allowed', harvest: 'cell' }[kind];
    if (css !== this.cursor) {
      this.cursor = css;
      this.canvas.style.cursor = css;
    }
  }
  storageGet(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  storageSet(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  }
}
