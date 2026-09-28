// On-disk cache for expensive build steps (SDF meshing, texture baking). Entries are keyed by a
// caller-supplied key plus the contents of the source files the result depends on, so editing a
// sculpt re-runs it and nothing else.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = join(root, 'tools', 'assetgen', '.cache');
const fileHashes = new Map<string, string>();

function hashFile(path: string) {
  let h = fileHashes.get(path);
  if (!h) {
    h = createHash('sha1').update(readFileSync(path)).digest('hex');
    fileHashes.set(path, h);
  }
  return h;
}

/** Source file path for an ES module URL (pass `import.meta.url`). */
export const srcOf = (url: string) => fileURLToPath(url);

type Arr = Float64Array | Float32Array | Uint32Array | Uint8Array;
const KINDS = { f64: Float64Array, f32: Float32Array, u32: Uint32Array, u8: Uint8Array } as const;

/** Cache a record of typed arrays. */
export function cachedArrays<T extends Record<string, Arr>>(key: string, deps: string[], compute: () => T): T {
  if (process.env.NO_CACHE) return compute();
  const h = createHash('sha1').update(key);
  for (const d of deps) h.update(hashFile(d));
  const file = join(dir, h.digest('hex') + '.bin');
  // layout: [8-byte aligned arrays…][header JSON][u32 header length]
  if (existsSync(file)) {
    const buf = readFileSync(file);
    const headLen = buf.readUInt32LE(buf.length - 4);
    const head: { name: string; kind: keyof typeof KINDS; offset: number; length: number }[] = JSON.parse(buf.subarray(buf.length - 4 - headLen, buf.length - 4).toString());
    const out: Record<string, Arr> = {};
    for (const e of head) {
      const Ctor = KINDS[e.kind];
      const bytes = buf.subarray(e.offset, e.offset + e.length * Ctor.BYTES_PER_ELEMENT);
      out[e.name] = new Ctor(new Uint8Array(bytes).buffer);
    }
    return out as T;
  }
  const res = compute();
  mkdirSync(dir, { recursive: true });
  const kindOf = (a: Arr): keyof typeof KINDS => (a instanceof Float64Array ? 'f64' : a instanceof Float32Array ? 'f32' : a instanceof Uint32Array ? 'u32' : 'u8');
  const head: { name: string; kind: string; offset: number; length: number }[] = [];
  const parts: Buffer[] = [];
  let off = 0;
  for (const [name, a] of Object.entries(res)) {
    head.push({ name, kind: kindOf(a), offset: off, length: a.length });
    const padded = Buffer.alloc(Math.ceil(a.byteLength / 8) * 8);
    Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(padded);
    parts.push(padded);
    off += padded.length;
  }
  const json = Buffer.from(JSON.stringify(head));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  writeFileSync(file, Buffer.concat([...parts, json, len]));
  return res;
}
