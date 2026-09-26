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
}
