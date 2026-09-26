// Ground-effects map: what magic leaves on the land. A CPU grid covering the terrain rect with
// four channels, uploaded to an RGBA8 texture that the terrain, mesh and water shaders read:
//   r = scorch (charcoal)   g = frost (crystals / ice sheet on water)
//   b = wet (dark, glossy, puddles)   a = heat (embers glowing in the cracks)
// Channels decay on their own and feed each other: frost melts into wet ground, heat leaves
// scorch behind, heat dries wet ground. Purely cosmetic.

import type { Device, Texture } from './rhi/types';
import { noise3 } from '../core/math';

export const SCORCH = 0, FROST = 1, WET = 2, HEAT = 3;

/** per-second decay of each channel */
const DECAY = [1 / 110, 1 / 15, 1 / 24, 1 / 3.5];

export class GroundFx {
  readonly res: number;
  readonly tex: Texture;
  private data: Float32Array;
  private bytes: Uint8Array;
  // bounding box of texels that are non-zero (processed + uploaded)
  private x0 = 1e9;
  private z0 = 1e9;
  private x1 = -1;
  private z1 = -1;
  private acc = 0;

  /** rect = terrain rect: origin xz, 1/size (world) */
  constructor(private device: Device, private rect: [number, number, number, number], res = 256) {
    this.res = res;
    this.data = new Float32Array(res * res * 4);
    this.bytes = new Uint8Array(res * res * 4);
    this.tex = device.createTexture({ width: res, height: res, format: 'rgba8unorm', data: this.bytes, label: 'ground-fx' });
  }
  /** metres per texel */
  get texel() {
    return 1 / (this.rect[2] * this.res);
  }
  private toTexel(x: number, z: number): [number, number] {
    return [(x - this.rect[0]) * this.rect[2] * this.res - 0.5, (z - this.rect[1]) * this.rect[3] * this.res - 0.5];
  }
  sample(ch: number, x: number, z: number) {
    const [tx, tz] = this.toTexel(x, z);
    const ix = Math.round(tx), iz = Math.round(tz);
    if (ix < 0 || iz < 0 || ix >= this.res || iz >= this.res) return 0;
    return this.data[(iz * this.res + ix) * 4 + ch];
  }

  /**
   * Paint a soft disc. `edge` = fraction of the radius used for the falloff, `rough` = how much
   * noise breaks up the rim (0 = perfect circle). mode 'max' keeps the stronger value.
   */
  stamp(ch: number, x: number, z: number, r: number, amount: number, opts: { edge?: number; rough?: number; mode?: 'max' | 'add'; seed?: number } = {}) {
    const edge = opts.edge ?? 0.4, rough = opts.rough ?? 0.35, seed = opts.seed ?? 7;
    const [cx, cz] = this.toTexel(x, z);
    const rt = r / this.texel;
    const ix0 = Math.max(0, Math.floor(cx - rt - 1)), ix1 = Math.min(this.res - 1, Math.ceil(cx + rt + 1));
    const iz0 = Math.max(0, Math.floor(cz - rt - 1)), iz1 = Math.min(this.res - 1, Math.ceil(cz + rt + 1));
    if (ix0 > ix1 || iz0 > iz1) return;
    const D = this.data;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = ix - cx, dz = iz - cz;
        let d = Math.hypot(dx, dz) / rt;
        if (rough > 0) d += (noise3(ix * 0.23, iz * 0.23, seed, 3) - 0.5) * rough;
        if (d >= 1) continue;
        const f = d <= 1 - edge ? 1 : (1 - d) / edge;
        const v = amount * f * f * (3 - 2 * f);
        const k = (iz * this.res + ix) * 4 + ch;
        D[k] = opts.mode === 'add' ? Math.min(1, D[k] + v) : Math.max(D[k], v);
      }
    }
    this.grow(ix0, iz0, ix1, iz1);
  }
  /** Paint along a segment (spike lines, wave tracks). */
  stampLine(ch: number, xa: number, za: number, xb: number, zb: number, r: number, amount: number, opts: { edge?: number; rough?: number; mode?: 'max' | 'add' } = {}) {
    const len = Math.hypot(xb - xa, zb - za);
    const n = Math.max(1, Math.ceil(len / (r * 0.5)));
    for (let i = 0; i <= n; i++) this.stamp(ch, xa + ((xb - xa) * i) / n, za + ((zb - za) * i) / n, r, amount, { ...opts, seed: 7 + i });
  }
  /** Remove a channel in a disc (water puts out heat, fire melts frost). */
  clear(ch: number, x: number, z: number, r: number, amount = 1) {
    const [cx, cz] = this.toTexel(x, z);
    const rt = r / this.texel;
    const D = this.data;
    for (let iz = Math.max(0, Math.floor(cz - rt)); iz <= Math.min(this.res - 1, Math.ceil(cz + rt)); iz++)
      for (let ix = Math.max(0, Math.floor(cx - rt)); ix <= Math.min(this.res - 1, Math.ceil(cx + rt)); ix++) {
        const d = Math.hypot(ix - cx, iz - cz) / rt;
        if (d >= 1) continue;
        const k = (iz * this.res + ix) * 4 + ch;
        D[k] = Math.max(0, D[k] - amount * (1 - d));
      }
  }
  private grow(ax: number, az: number, bx: number, bz: number) {
    this.x0 = Math.min(this.x0, ax);
    this.z0 = Math.min(this.z0, az);
    this.x1 = Math.max(this.x1, bx);
    this.z1 = Math.max(this.z1, bz);
  }

  /** Decay + channel interactions; uploads the active region at ~20 Hz. */
  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.05 || this.x1 < 0) return;
    const step = this.acc;
    this.acc = 0;
    const D = this.data, B = this.bytes, res = this.res;
    let nx0 = 1e9, nz0 = 1e9, nx1 = -1, nz1 = -1;
    for (let iz = this.z0; iz <= this.z1; iz++) {
      for (let ix = this.x0; ix <= this.x1; ix++) {
        const k = (iz * res + ix) * 4;
        let s = D[k], f = D[k + 1], w = D[k + 2], h = D[k + 3];
        if (s + f + w + h === 0) {
          B[k] = B[k + 1] = B[k + 2] = B[k + 3] = 0;
          continue;
        }
        const melt = Math.min(f, DECAY[FROST] * step);
        f -= melt;
        w = Math.min(1, w + melt * 0.8 - (DECAY[WET] + h * 0.5) * step);
        s = Math.max(s - DECAY[SCORCH] * step, h * 0.95);
        h -= DECAY[HEAT] * step;
        D[k] = s > 0.002 ? s : 0;
        D[k + 1] = f > 0.002 ? f : 0;
        D[k + 2] = w > 0.002 ? w : 0;
        D[k + 3] = h > 0.002 ? h : 0;
        B[k] = D[k] * 255;
        B[k + 1] = D[k + 1] * 255;
        B[k + 2] = D[k + 2] * 255;
        B[k + 3] = D[k + 3] * 255;
        if (D[k] + D[k + 1] + D[k + 2] + D[k + 3] > 0) {
          if (ix < nx0) nx0 = ix;
          if (ix > nx1) nx1 = ix;
          if (iz < nz0) nz0 = iz;
          if (iz > nz1) nz1 = iz;
        }
      }
    }
    // upload the whole old box (so cleared texels reach the GPU), then shrink it
    const w = this.x1 - this.x0 + 1, h = this.z1 - this.z0 + 1;
    const sub = new Uint8Array(w * h * 4);
    for (let r = 0; r < h; r++) sub.set(B.subarray(((this.z0 + r) * res + this.x0) * 4, ((this.z0 + r) * res + this.x0 + w) * 4), r * w * 4);
    this.device.writeTexture(this.tex, sub, { x: this.x0, y: this.z0, w, h });
    this.x0 = nx0;
    this.z0 = nz0;
    this.x1 = nx1;
    this.z1 = nz1;
  }
}
