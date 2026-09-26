// Peach Garden Valley environment set + jade resource deposits.

import { MeshBuilder } from '../kit/mesh';
import { PAL } from '../kit/palette';
import type { Recipe } from '../recipe';
import { V3, rng, fbm3, normalize, add, scale, cross } from '../../../src/core/math';
import { crystal } from './props';

/** Gnarled trunk as a tube along a noisy path; returns the path. */
function trunk(mb: MeshBuilder, seed: number, h: number, r0: number, lean: V3, twist = 0.5): V3[] {
  const R = rng(seed);
  const pts: V3[] = [];
  let p: V3 = [0, -0.2, 0];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([...p] as V3);
    const wob: V3 = [(R.next() - 0.5) * twist, 0, (R.next() - 0.5) * twist];
    p = add(p, add(scale(lean, (h / n) * t * 1.4), add([0, h / n, 0], scale(wob, h / n))));
  }
  mb.tube(pts, (t) => r0 * (1 - t * 0.72) * (t < 0.08 ? 1.35 - t * 4 : 1), 8, { capStart: false });
  return pts;
}

function branch(mb: MeshBuilder, from: V3, dir: V3, len: number, r: number, droop = 0.15, segs = 4) {
  const pts: V3[] = [];
  const d = normalize(dir);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push([from[0] + d[0] * len * t, from[1] + d[1] * len * t - droop * len * t * t, from[2] + d[2] * len * t]);
  }
  mb.tube(pts, (t) => r * (1 - t * 0.7), 6);
  return pts[pts.length - 1];
}

// 黄山松 Huangshan pine — twisted trunk, flat cloud-like needle pads.
export const pine: Recipe = {
  id: 'env_pine',
  name: 'Mountain Pine',
  hanzi: '松',
  category: 'environment',
  build() {
    const mb = new MeshBuilder('env_pine');
    const R = rng(11);
    let tips: V3[] = [];
    mb.with(null, () => {
      const path = trunk(mb, 5, 7.2, 0.32, [0.08, 0, 0.03], 0.7);
      // branches in tiers
      for (let i = 0; i < 7; i++) {
        const k = 3 + i;
        const base = path[Math.min(path.length - 1, k)];
        const a = i * 2.4 + R.next();
        const dir: V3 = [Math.cos(a), 0.15 + R.next() * 0.2, Math.sin(a)];
        const len = (1 - i / 9) * 2.6 + 0.6;
        tips.push(branch(mb, base, dir, len, 0.1 * (1 - i / 10), 0.12));
      }
      tips.push(path[path.length - 1]);
    }, { mat: PAL.barkPine });
    // cloud-like needle pads: each pad is a cluster of flattened, faceted tufts
    mb.with(null, () => {
      tips.forEach((tp, i) => {
        const s = i === tips.length - 1 ? 1.2 : 0.95 + R.next() * 0.3;
        const tufts = 7;
        for (let k = 0; k < tufts; k++) {
          const a = (k / tufts) * Math.PI * 2 + i;
          const rr = k === 0 ? 0 : 0.55 * s;
          mb.at(tp[0] + Math.cos(a) * rr, tp[1] + 0.1 + (k === 0 ? 0.12 : (R.next() - 0.5) * 0.14), tp[2] + Math.sin(a) * rr, () => {
            mb.blob((k === 0 ? 0.75 : 0.5) * s, 1, {
              squash: [1.25, 0.42, 1.15],
              smooth: false,
              displace: (d) => (fbm3(d[0] * 3 + i + k, d[1] * 3, d[2] * 3, 2, 3) - 0.5) * 0.7 - Math.max(0, -d[1]) * 0.35,
            });
          });
        }
      });
    }, { mat: PAL.pineNeedles });
    return { mesh: mb, ao: { maxDist: 2.5, rays: 40 } };
  },
};

// 竹 bamboo clump
export const bamboo: Recipe = {
  id: 'env_bamboo',
  name: 'Bamboo Grove',
  hanzi: '竹',
  category: 'environment',
  build() {
    const mb = new MeshBuilder('env_bamboo');
    const R = rng(21);
    const n = 11;
    const tops: { p: V3; d: V3 }[] = [];
    for (let i = 0; i < n; i++) {
      const a = R.next() * Math.PI * 2, rr = Math.sqrt(R.next()) * 0.9;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = 6 + R.next() * 3.5;
      const lean: V3 = [x * 0.12 + (R.next() - 0.5) * 0.12, 1, z * 0.12 + (R.next() - 0.5) * 0.12];
      const pts: V3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push([x + lean[0] * h * t * t, h * t, z + lean[2] * h * t * t]);
      }
      const r0 = 0.055 + R.next() * 0.03;
      mb.with(null, () => mb.tube(pts, (t) => r0 * (1 - t * 0.45), 6, { capStart: false }), { mat: PAL.bambooStalk, sway: 0 });
      // node rings
      mb.with(null, () => {
        for (let k = 1; k < 8; k++) {
          const p = pts[k];
          mb.at(p[0], p[1], p[2], () => mb.cylinder({ r: r0 * (1 - (k / 8) * 0.45) * 1.18, h: 0.04, y0: -0.02, sides: 6 }));
        }
      }, { mat: { ...PAL.bambooStalk, name: 'bamboo_node', color: 0x6f9440 } });
      tops.push({ p: pts[8], d: normalize([lean[0], 0.3, lean[2]]) });
      // leaf sprays along the upper third
      for (let k = 5; k <= 8; k++) tops.push({ p: pts[k], d: normalize([Math.cos(a + k), -0.2, Math.sin(a + k)]) });
    }
    mb.with(null, () => {
      for (const [i, t] of tops.entries()) {
        const leaves = 6;
        for (let l = 0; l < leaves; l++) {
          const a = (l / leaves) * Math.PI * 2 + i;
          const dir: V3 = normalize([Math.cos(a) + t.d[0], -0.35 + (l % 2) * 0.25, Math.sin(a) + t.d[2]]);
          const side = normalize(cross(dir, [0, 1, 0]));
          const len = 0.55 + ((i * 7 + l) % 5) * 0.06, w = 0.07;
          const p0 = t.p;
          const p1 = add(p0, add(scale(dir, len * 0.5), scale(side, w)));
          const p2 = add(p0, add(scale(dir, len), [0, -0.12, 0]));
          const p3 = add(p0, add(scale(dir, len * 0.5), scale(side, -w)));
          mb.tri(p0, p1, p2, undefined, undefined, [0.3, 0.8, 1]);
          mb.tri(p0, p2, p3, undefined, undefined, [0.3, 1, 0.8]);
        }
      }
    }, { mat: PAL.bambooLeaf });
    return { mesh: mb, ao: { maxDist: 1.5, rays: 32 } };
  },
};

// 桃 peach tree in blossom (the Peach Garden Oath)
export const peachTree: Recipe = {
  id: 'env_peach_tree',
  name: 'Peach Blossom Tree',
  hanzi: '桃',
  category: 'environment',
  build() {
    const mb = new MeshBuilder('env_peach_tree');
    const R = rng(31);
    const tips: V3[] = [];
    mb.with(null, () => {
      const path = trunk(mb, 7, 2.6, 0.26, [0.1, 0, -0.05], 0.9);
      const top = path[path.length - 1];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + R.next();
        const e = branch(mb, path[6 + (i % 4)] ?? top, [Math.cos(a), 0.7 + R.next() * 0.4, Math.sin(a)], 1.6 + R.next() * 0.8, 0.11, -0.05);
        tips.push(e);
        tips.push(branch(mb, e, [Math.cos(a + 0.8), 0.5, Math.sin(a + 0.8)], 0.9, 0.05, 0.05));
      }
    }, { mat: PAL.bark });
    // blossom clusters: many small faceted clumps in two pinks, a few leaf clumps underneath
    const pink2 = { ...PAL.peachBlossom, name: 'peach_blossom_deep', color: 0xd8739a };
    for (const [i, t] of tips.entries()) {
      for (let k = 0; k < 6; k++) {
        const a = k * 2.1 + i, rr = k === 0 ? 0 : 0.45 + R.next() * 0.25;
        const mat = (i + k) % 3 === 0 ? pink2 : PAL.peachBlossom;
        mb.with(null, () => mb.at(t[0] + Math.cos(a) * rr, t[1] + 0.15 + (R.next() - 0.3) * 0.35, t[2] + Math.sin(a) * rr, () =>
          mb.blob(0.42 + R.next() * 0.22, 1, { squash: [1.1, 0.8, 1.1], smooth: false, displace: (d) => (fbm3(d[0] * 3 + i * 3 + k, d[1] * 3, d[2] * 3, 2, 7) - 0.5) * 0.8 })), { mat });
      }
      mb.with(null, () => mb.at(t[0], t[1] - 0.2, t[2], () => mb.blob(0.35, 1, { squash: [1.3, 0.5, 1.3], smooth: false, displace: (d) => (fbm3(d[0] * 3, d[1] * 3 + i, d[2] * 3, 2, 8) - 0.5) * 0.7 })), { mat: PAL.leafGreen });
    }
    // a few fallen petals ring
    mb.with(null, () => {
      for (let i = 0; i < 40; i++) {
        const a = R.next() * Math.PI * 2, r = 0.6 + R.next() * 2.4;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        mb.tri([x, 0.03, z], [x + 0.08, 0.03, z + 0.02], [x + 0.03, 0.03, z - 0.07]);
      }
    }, { mat: { ...PAL.peachBlossom, name: 'petals', sway: 0 } });
    return { mesh: mb, ao: { maxDist: 2.2, rays: 40 } };
  },
};

export const rock: Recipe = {
  id: 'env_rock',
  name: 'Boulder',
  hanzi: '石',
  category: 'environment',
  build() {
    const mb = new MeshBuilder('env_rock');
    mb.with(null, () => {
      mb.at(0, 0.3, 0, () => mb.blob(1.3, 2, { squash: [1.3, 0.7, 1], smooth: false, displace: (d) => (fbm3(d[0] * 1.8, d[1] * 1.8, d[2] * 1.8, 3, 1) - 0.5) * 0.8 }));
      mb.at(1.2, 0.15, 0.6, () => mb.blob(0.6, 1, { squash: [1.2, 0.8, 1], smooth: false, displace: (d) => (fbm3(d[0] * 2, d[1] * 2, d[2] * 2, 2, 2) - 0.5) * 0.7 }));
      mb.at(-0.9, 0.05, -0.8, () => mb.blob(0.45, 1, { squash: [1, 0.7, 1.2], smooth: false, displace: (d) => (fbm3(d[0] * 2, d[1] * 2, d[2] * 2, 2, 3) - 0.5) * 0.7 }));
    }, { mat: PAL.rockMossy });
    return { mesh: mb, ao: { maxDist: 1.2 } };
  },
};

// 太湖石 scholar's rock — tall, eroded, pierced.
export const scholarRock: Recipe = {
  id: 'env_scholar_rock',
  name: 'Scholar’s Rock',
  hanzi: '太湖石',
  category: 'environment',
  build() {
    const mb = new MeshBuilder('env_scholar_rock');
    mb.with(null, () => {
      mb.at(0, 1.6, 0, () => mb.blob(0.9, 3, {
        squash: [0.75, 2.0, 0.6],
        smooth: true,
        displace: (d) => {
          const n = fbm3(d[0] * 2.2, d[1] * 3.2, d[2] * 2.2, 4, 9);
          const holes = Math.max(0, fbm3(d[0] * 3.5 + 5, d[1] * 4, d[2] * 3.5, 2, 12) - 0.58) * 2.8;
          return (n - 0.5) * 0.9 - holes + Math.sin(d[1] * 5) * 0.12;
        },
      }));
    }, { mat: { ...PAL.rock, name: 'taihu_stone', color: 0xa7a59c } });
    mb.with(null, () => mb.lathe([[0.9, 0], [0.95, 0.12], [0.8, 0.28], [0.6, 0.3]], 8, { smooth: false }), { mat: PAL.stoneDark });
    return { mesh: mb, ao: { maxDist: 1.4 } };
  },
};

function jadeCluster(mb: MeshBuilder, seed: number, n: number, spread: number, size: number) {
  const R = rng(seed);
  mb.with(null, () => mb.at(0, 0.05, 0, () => mb.blob(spread * 0.9, 1, { squash: [1.2, 0.35, 1], smooth: false, displace: (d) => (fbm3(d[0] * 2, d[1], d[2] * 2, 2, seed) - 0.5) * 0.6 })), { mat: PAL.rock });
  for (let i = 0; i < n; i++) {
    const a = R.next() * Math.PI * 2, r = Math.sqrt(R.next()) * spread * 0.7;
    const h = size * (0.6 + R.next() * 0.9) * (1 - r / spread * 0.5);
    mb.at(Math.cos(a) * r, 0.05, Math.sin(a) * r, () => crystal(mb, h * 0.28, h), [Math.cos(a) * 25 * (r / spread), R.next() * 60, Math.sin(a) * 25 * (r / spread)]);
  }
}

export const jadeSmall: Recipe = {
  id: 'res_jade_small',
  name: 'Spirit Jade (small)',
  hanzi: '灵玉',
  category: 'resource',
  build() {
    const mb = new MeshBuilder('res_jade_small');
    jadeCluster(mb, 3, 6, 0.7, 0.8);
    return { mesh: mb, ao: { maxDist: 0.6 } };
  },
};
export const jadeLarge: Recipe = {
  id: 'res_jade_large',
  name: 'Spirit Jade (vein)',
  hanzi: '玉脉',
  category: 'resource',
  build() {
    const mb = new MeshBuilder('res_jade_large');
    jadeCluster(mb, 8, 14, 1.3, 1.5);
    return { mesh: mb, ao: { maxDist: 0.9 } };
  },
};
