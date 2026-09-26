import type { Platform, InputState, Surface, PointerState } from '../platform';

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

export class WebPlatform implements Platform {
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
