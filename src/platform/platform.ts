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
}

export interface InputState {
  pointer: PointerState;
  keys: Set<string>;
  /** keys pressed this frame */
  pressed: Set<string>;
  /** pointer buttons pressed / released this frame */
  clicked: number;
  released: number;
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

export interface Platform {
  readonly name: string;
  readonly surface: Surface;
  readonly input: InputState;
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
