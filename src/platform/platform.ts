// Platform abstraction. Game and engine code depend on this interface only; each target
// (web today; iOS/macOS/Windows/Linux later) provides an implementation. Nothing outside
// src/platform/<target>/ may touch window/document/navigator.

export interface PointerState {
  x: number;
  y: number;
  buttons: number; // bitmask: 1 left, 2 right, 4 middle
  wheel: number; // accumulated since last frame
  dx: number;
  dy: number;
  inside: boolean;
  /** the pointer is a finger (touch screens): taps command, drags pan, pinches zoom */
  touch?: boolean;
  /** fingers currently down (0 for a mouse) */
  touches?: number;
  /** where the current press (or gesture) began */
  downX?: number;
  downY?: number;
}

export interface InputState {
  pointer: PointerState;
  keys: Set<string>;
  /** keys pressed this frame */
  pressed: Set<string>;
  /** pointer buttons pressed / released this frame */
  clicked: number;
  released: number;
  /** derive time-based gestures (long press); call at the start of every frame */
  beginFrame?(): void;
  /** clear per-frame deltas; call at the end of every frame */
  endFrame(): void;
}

export interface Surface {
  /** size in physical pixels */
  width: number;
  height: number;
  dpr: number;
  onResize(cb: (w: number, h: number) => void): void;
}

export interface GlyphFaceRequest {
  /** key used by the UI, e.g. "ui14" */
  name: string;
  family: string;
  weight: number;
  /** pixel size (already multiplied by the UI scale) */
  size: number;
  chars: string;
}
export interface GlyphInfo {
  x: number;
  y: number;
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  adv: number;
}
export interface GlyphFace {
  size: number;
  lineHeight: number;
  ascent: number;
  glyphs: Record<string, GlyphInfo>;
}
/** RGBA atlas: rgb = 255, a = coverage. */
export interface GlyphAtlasData {
  width: number;
  height: number;
  pixels: Uint8Array;
  faces: Record<string, GlyphFace>;
}

/** Sound output. PCM is synthesised by the game (src/audio) and handed over once; playback is
 *  fire-and-forget. Web: WebAudio (unlocked by the first user gesture). Native: CoreAudio /
 *  XAudio2 / miniaudio with the same buffers. */
export interface AudioOutput {
  /** false until the device may produce sound (browsers require a user gesture) */
  readonly ready: boolean;
  /** the audio clock (s): music is scheduled against it, not the frame clock */
  readonly time: number;
  register(name: string, pcm: Float32Array, sampleRate: number): void;
  play(name: string, opts?: PlayOptions): void;
  setVolume(v: number): void;
  /** per-bus volume (sound effects / music), 0..1 */
  setBusVolume(bus: AudioBus, v: number): void;
  readonly volume: number;
}
export type AudioBus = 'sfx' | 'music';
export interface PlayOptions {
  volume?: number;
  pan?: number;
  rate?: number;
  /** start time on the audio clock (default: now) */
  at?: number;
  bus?: AudioBus;
  /** stop after this many seconds (with a short fade) */
  duration?: number;
}

export interface Platform {
  readonly name: string;
  readonly surface: Surface;
  readonly input: InputState;
  readonly audio: AudioOutput;
  now(): number;
  requestFrame(cb: (timeSec: number) => void): void;
  loadBinary(path: string): Promise<ArrayBuffer>;
  loadText(path: string): Promise<string>;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  /** Contextual pointer: select / attack / move / place / power / sell. */
  setCursor(kind: 'default' | 'select' | 'attack' | 'move' | 'place' | 'power' | 'sell' | 'harvest'): void;
  /** Rasterise glyphs with the OS text stack (canvas / CoreText / DirectWrite / FreeType). */
  rasterizeGlyphs(faces: GlyphFaceRequest[]): Promise<GlyphAtlasData>;
}
