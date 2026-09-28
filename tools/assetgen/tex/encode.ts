// Image encoding for baked atlases. WebP (lossy colour, lossless alpha) keeps a 1024² character
// atlas in the low hundreds of KB; the build uses Pillow through python3 for it.

import { spawnSync } from 'node:child_process';

const SCRIPT = `
import sys, io
from PIL import Image
w, h, q = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
data = sys.stdin.buffer.read()
im = Image.frombytes('RGBA', (w, h), data)
out = io.BytesIO()
im.save(out, 'WEBP', quality=q, alpha_quality=100, method=6, exact=True)
sys.stdout.buffer.write(out.getvalue())
`;

/** Encode RGBA8 pixels as WebP. */
export function encodeWebP(rgba: Uint8Array, w: number, h: number, quality = 88): Uint8Array {
  const r = spawnSync('python3', ['-c', SCRIPT, String(w), String(h), String(quality)], { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`WebP encoding failed (python3 + Pillow required): ${r.stderr?.toString()}`);
  return new Uint8Array(r.stdout);
}

/** Save RGBA8 pixels as PNG (debug views of atlases). */
export function savePNG(path: string, rgba: Uint8Array, w: number, h: number) {
  const s = `
import sys
from PIL import Image
Image.frombytes('RGBA', (${w}, ${h}), sys.stdin.buffer.read()).save(sys.argv[1])`;
  spawnSync('python3', ['-c', s, path], { input: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), maxBuffer: 64 << 20 });
}
