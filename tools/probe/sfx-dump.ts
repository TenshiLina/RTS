// Dump named sounds from the procedural library to WAV (listening tests, spectrograms).
//   npx tsx tools/probe/sfx-dump.ts <outDir> name…
import { writeFileSync } from 'node:fs';
import { buildSoundLibrary, SAMPLE_RATE } from '../../src/audio/synth';
const [dir, ...names] = process.argv.slice(2);
const lib = buildSoundLibrary();
for (const n of names) {
  const x = lib.get(n)!;
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(`${dir}/${n}.wav`, buf);
}
