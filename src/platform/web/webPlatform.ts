import type { AudioOutput, AudioBus, PlayOptions, Platform, InputState, Surface, PointerState, GlyphFaceRequest, GlyphAtlasData, GlyphFace } from '../platform';

class WebInput implements InputState {
  pointer: PointerState = { x: 0, y: 0, buttons: 0, wheel: 0, dx: 0, dy: 0, inside: false, touch: false, touches: 0 };
  keys = new Set<string>();
  pressed = new Set<string>();
  clicked = 0;
  released = 0;
  // touch gestures: a tap is a left click, a long press a right click, one finger drags the map
  // (reported as a middle-button drag), two fingers pan and pinch-zoom
  private fingers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private gesture: 'none' | 'pending' | 'pan' | 'pinch' | 'long' = 'none';
  private pinchDist = 0;
  private downAt = 0;
  private longArmed = false;
  constructor(el: HTMLElement, dpr: () => number) {
    const pos = (e: PointerEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return [(e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()];
    };
    const setPos = (x: number, y: number) => {
      this.pointer.dx += x - this.pointer.x;
      this.pointer.dy += y - this.pointer.y;
      this.pointer.x = x;
      this.pointer.y = y;
    };
    const mid = () => {
      let x = 0, y = 0;
      for (const f of this.fingers.values()) {
        x += f.x;
        y += f.y;
      }
      return [x / this.fingers.size, y / this.fingers.size];
    };
    const spread = () => {
      const [a, b] = [...this.fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const isTouch = (e: PointerEvent) => e.pointerType === 'touch';
    el.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (isTouch(e)) {
        const f = this.fingers.get(e.pointerId);
        if (!f) return;
        f.x = x;
        f.y = y;
        if (this.gesture === 'pending' && Math.hypot(x - f.sx, y - f.sy) > 12 * dpr()) {
          this.gesture = 'pan';
          this.pointer.buttons |= 4;
        }
        if (this.gesture === 'pinch' && this.fingers.size >= 2) {
          const d = spread();
          if (this.pinchDist > 0 && d > 0) this.pointer.wheel -= Math.log(d / this.pinchDist) / Math.log(1.12);
          this.pinchDist = d;
          const [mx, my] = mid();
          setPos(mx, my);
        } else if (this.gesture === 'pan' || this.gesture === 'pending') setPos(x, y);
        return;
      }
      setPos(x, y);
      this.pointer.inside = true;
    });
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      if (isTouch(e)) {
        this.pointer.touch = true;
        this.fingers.set(e.pointerId, { x, y, sx: x, sy: y });
        this.pointer.touches = this.fingers.size;
        this.pointer.inside = true;
        if (this.fingers.size === 1) {
          this.gesture = 'pending';
          this.downAt = performance.now();
          this.longArmed = false;
          this.pointer.x = this.pointer.downX = x;
          this.pointer.y = this.pointer.downY = y;
        } else {
          // a second finger: pan + pinch around the midpoint
          this.gesture = 'pinch';
          this.pinchDist = spread();
          const [mx, my] = mid();
          this.pointer.x = this.pointer.downX = mx;
          this.pointer.y = this.pointer.downY = my;
          this.pointer.buttons = 4;
        }
        return;
      }
      this.pointer.touch = false;
      this.pointer.touches = 0;
      this.pointer.downX = x;
      this.pointer.downY = y;
      const bit = e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
      this.pointer.buttons |= bit;
      this.clicked |= bit;
    });
    const up = (e: PointerEvent) => {
      if (isTouch(e)) {
        if (!this.fingers.delete(e.pointerId)) return;
        this.pointer.touches = this.fingers.size;
        if (this.gesture === 'pending' && e.type === 'pointerup') {
          // a tap: press and release in one frame at the finger's position
          this.clicked |= 1;
          this.released |= 1;
        }
        if (this.fingers.size === 0) {
          this.gesture = 'none';
          this.pointer.buttons = 0;
          this.pointer.inside = false;
        } else if (this.gesture === 'pinch') {
          // back to one finger: it keeps dragging the map
          const [f] = [...this.fingers.values()];
          this.gesture = 'pan';
          this.pointer.x = this.pointer.downX = f.x;
          this.pointer.y = this.pointer.downY = f.y;
          this.pointer.buttons = 4;
        }
        return;
      }
      const bit = e.button === 0 ? 1 : e.button === 2 ? 2 : 4;
      this.pointer.buttons &= ~bit;
      this.released |= bit;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => {
      if (!isTouch(e)) this.pointer.inside = false;
    });
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
  /** Long press = right click. Decided in the frame loop, not on a timer, and only once the
   *  finger has been still across two frame starts: moves queued behind a slow frame are
   *  delivered in between, so the start of a drag can't turn into a long press. */
  beginFrame() {
    if (this.gesture !== 'pending' || performance.now() - this.downAt < 450) return;
    if (!this.longArmed) {
      this.longArmed = true;
      return;
    }
    this.gesture = 'long';
    this.clicked |= 2;
    this.released |= 2;
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

/** WebAudio backend: buffers are created lazily once the context exists (after a gesture).
 *  Two buses: sound effects, and music with its own hall reverb. */
class WebAudio implements AudioOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<AudioBus, GainNode | null> = { sfx: null, music: null };
  private busVol: Record<AudioBus, number> = { sfx: 1, music: 0.55 };
  private pcm = new Map<string, { data: Float32Array; rate: number }>();
  private buffers = new Map<string, AudioBuffer>();
  private voices = { sfx: 0, music: 0 };
  volume = 0.8;
  constructor() {
    const unlock = () => {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext ?? (window as any).webkitAudioContext;
          if (!AC) return;
          const ctx: AudioContext = new AC();
          this.ctx = ctx;
          this.master = ctx.createGain();
          this.master.gain.value = this.volume;
          // gentle limiter so stacked explosions don't clip
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -14;
          comp.ratio.value = 6;
          this.master.connect(comp).connect(ctx.destination);
          for (const b of ['sfx', 'music'] as AudioBus[]) {
            const g = ctx.createGain();
            g.gain.value = this.busVol[b];
            g.connect(this.master);
            this.buses[b] = g;
          }
          // music: a hall reverb send (decaying stereo noise impulse)
          const len = Math.round(ctx.sampleRate * 2.4);
          const ir = ctx.createBuffer(2, len, ctx.sampleRate);
          for (let c = 0; c < 2; c++) {
            const d = ir.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * Math.exp(-i / (ctx.sampleRate * 0.5));
          }
          const conv = ctx.createConvolver();
          conv.buffer = ir;
          const send = ctx.createGain();
          send.gain.value = 0.3;
          this.buses.music!.connect(send).connect(conv).connect(this.master);
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
  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
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
  play(name: string, opts: PlayOptions = {}) {
    const bus = opts.bus ?? 'sfx';
    if (!this.ready || this.voices[bus] > (bus === 'music' ? 48 : 40)) return;
    const ctx = this.ctx!;
    const b = this.buffer(name);
    if (!b) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    const vol = opts.volume ?? 1;
    g.gain.value = vol;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    src.connect(g).connect(pan).connect(this.buses[bus]!);
    this.voices[bus]++;
    src.onended = () => this.voices[bus]--;
    const at = Math.max(ctx.currentTime, opts.at ?? 0);
    src.start(at);
    if (opts.duration !== undefined) {
      // release: a short fade instead of a click
      const end = at + opts.duration;
      g.gain.setValueAtTime(vol, end);
      g.gain.linearRampToValueAtTime(0, end + 0.15);
      src.stop(end + 0.16);
    }
  }
  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }
  setBusVolume(bus: AudioBus, v: number) {
    this.busVol[bus] = v;
    const g = this.buses[bus];
    if (g && this.ctx) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25);
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
