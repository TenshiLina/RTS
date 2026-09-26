// Shared props used across structures.

import { MeshBuilder, T } from '../kit/mesh';
import { PAL } from '../kit/palette';
import { V2, V3 } from '../../../src/core/math';
import { MaterialPattern } from '../../../src/core/materialModel';

const taijiLight = { name: 'taiji_light', color: 0xe8e2d2, roughness: 0.5, pattern: MaterialPattern.Stone };
const taijiDark = { name: 'taiji_dark', color: 0x2a2a2e, roughness: 0.45, pattern: MaterialPattern.Stone };

/** 鼎 bronze ritual cauldron, `s` = belly radius. */
export function ding(mb: MeshBuilder, s: number) {
  mb.with(null, () => {
    // three legs
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const x = Math.sin(a) * s * 0.62, z = Math.cos(a) * s * 0.62;
      mb.tube([[x * 1.12, 0, z * 1.12], [x, s * 0.45, z], [x * 0.95, s * 0.8, z * 0.95]], (t) => s * (0.13 - 0.03 * t), 6);
    }
    // belly
    mb.at(0, s * 0.62, 0, () => {
      mb.lathe([[0.001, 0], [s * 0.7, s * 0.05], [s * 0.98, s * 0.35], [s * 1.0, s * 0.7], [s * 0.92, s * 0.95], [s * 1.02, s * 1.0], [s * 1.0, s * 1.08], [s * 0.85, s * 1.06], [s * 0.8, s * 0.85]], 16, { smooth: true });
      // taotie band
      mb.with(null, () => mb.lathe([[s * 1.01, s * 0.5], [s * 1.035, s * 0.55], [s * 1.035, s * 0.75], [s * 1.0, s * 0.8]], 16), { mat: PAL.gold });
      // upright loop handles
      for (const sx of [-1, 1]) {
        const pts: V3[] = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI;
          pts.push([sx * s * 0.82, s * 1.05 + Math.sin(a) * s * 0.45, Math.cos(a) * s * 0.28]);
        }
        mb.tube(pts, s * 0.06, 5);
      }
      // glowing embers inside
      mb.with(null, () => mb.cylinder({ r: s * 0.8, h: 0.02, y0: s * 0.9, sides: 14 }), { mat: PAL.qi });
    });
  }, { mat: PAL.bronze });
}

/** 太极 floor inlay of radius r in the XZ plane. */
export function taiji(mb: MeshBuilder, r: number) {
  const rings = 20, sectors = 56;
  const cls = (x: number, y: number) => {
    const d1 = Math.hypot(x, y - r / 2), d2 = Math.hypot(x, y + r / 2);
    if (d1 < r / 7) return 0;
    if (d2 < r / 7) return 1;
    if (d1 < r / 2) return 1;
    if (d2 < r / 2) return 0;
    return x > 0 ? 1 : 0;
  };
  const pt = (i: number, j: number): V3 => {
    const rr = (r * i) / rings, a = (Math.PI * 2 * j) / sectors;
    return [Math.cos(a) * rr, 0, Math.sin(a) * rr];
  };
  const emit = (a: V3, b: V3, c: V3) => {
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const up = (c[0] - a[0]) * (b[2] - a[2]) - (c[2] - a[2]) * (b[0] - a[0]);
    // choose winding so the face normal points +Y
    mb.with(null, () => (up > 0 ? mb.tri(a, b, c) : mb.tri(a, c, b)), { mat: cls(cx, -cz) ? taijiLight : taijiDark });
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < sectors; j++) {
    const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
    if (i === 0) emit(a, c, d);
    else {
      emit(a, b, c);
      emit(a, c, d);
    }
  }
  // bronze rim
  mb.with(null, () => mb.lathe([[r, 0], [r + 0.08, 0.015], [r + 0.16, 0]], sectors, { smooth: false }), { mat: PAL.bronze });
}

/** Yellow paper talisman (符) hanging from its top. */
export function talismanStrip(mb: MeshBuilder, w: number, h: number) {
  mb.with(T(-w / 2, 0, 0), () => mb.banner(w, h, { nu: 1, nv: 4 }), { mat: PAL.talisman });
}

/** 石灯笼 stone lantern. */
export function stoneLantern(mb: MeshBuilder, h: number) {
  const s = h / 1.6;
  mb.with(null, () => {
    mb.box([0.5 * s, 0.15 * s, 0.5 * s], [0, 0.075 * s, 0], 0.03);
    mb.cylinder({ r: 0.1 * s, rTop: 0.09 * s, h: 0.65 * s, y0: 0.15 * s, sides: 8 });
    mb.box([0.42 * s, 0.08 * s, 0.42 * s], [0, 0.84 * s, 0], 0.02);
    // lamp box corners
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) mb.box([0.07 * s, 0.34 * s, 0.07 * s], [x * 0.15 * s, 1.05 * s, z * 0.15 * s]);
    // cap
    mb.lathe([[0.36 * s, 1.22 * s], [0.34 * s, 1.27 * s], [0.08 * s, 1.45 * s], [0.001, 1.5 * s]], 4, { smooth: false, capBottom: true, phase: Math.PI / 4 });
    mb.sphere(0.06 * s, 6, 4);
  }, { mat: PAL.stone });
  mb.with(null, () => mb.box([0.24 * s, 0.26 * s, 0.24 * s], [0, 1.05 * s, 0]), { mat: { ...PAL.paperWindow, name: 'lamp_glow', emissive: 1.8, color: 0xffcf7a } });
}

/** Weapon rack with a few polearms. */
export function weaponRack(mb: MeshBuilder, w = 1.6) {
  mb.with(null, () => {
    mb.box([0.08, 1.3, 0.08], [-w / 2, 0.65, 0]);
    mb.box([0.08, 1.3, 0.08], [w / 2, 0.65, 0]);
    mb.box([w + 0.1, 0.07, 0.1], [0, 1.2, 0]);
    mb.box([w + 0.1, 0.07, 0.3], [0, 0.2, 0]);
  }, { mat: PAL.timberDark });
  const n = Math.round(w / 0.3);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.2 + (i * (w - 0.4)) / (n - 1);
    mb.with(T(x, 0.2, 0.05, [-8, 0, 0]), () => {
      mb.with(null, () => mb.cylinder({ r: 0.02, h: 1.9, sides: 5 }), { mat: PAL.timber });
      mb.with(null, () => mb.cone(0.05, 0.28, 4, 1.9, false), { mat: PAL.steel });
      mb.with(null, () => mb.cylinder({ r: 0.045, rTop: 0.01, h: 0.12, y0: 1.8, sides: 5 }), { mat: PAL.clothRed });
    });
  }
}

/** Straw archery target on a stand. */
export function archeryTarget(mb: MeshBuilder) {
  mb.with(null, () => {
    mb.tube([[-0.45, 0, -0.2], [-0.35, 1.3, 0]], 0.04, 5);
    mb.tube([[0.45, 0, -0.2], [0.35, 1.3, 0]], 0.04, 5);
    mb.tube([[0, 0, -0.6], [0, 1.2, -0.05]], 0.04, 5);
  }, { mat: PAL.timberDark });
  mb.with(T(0, 1.05, 0.05, [90, 0, 0]), () => {
    mb.with(null, () => mb.cylinder({ r: 0.5, h: 0.18, sides: 14, y0: -0.09 }), { mat: PAL.straw });
    mb.with(null, () => mb.cylinder({ r: 0.3, h: 0.02, sides: 14, y0: -0.1 }), { mat: PAL.clothRed });
    mb.with(null, () => mb.cylinder({ r: 0.1, h: 0.02, sides: 10, y0: -0.11 }), { mat: PAL.clothGold });
  });
}

/** Wooden training dummy (木人桩). */
export function trainingDummy(mb: MeshBuilder) {
  mb.with(null, () => {
    mb.cylinder({ r: 0.16, rTop: 0.15, h: 1.6, sides: 8 });
    mb.sphere(0.16, 8, 5, { squash: [1, 0.6, 1] });
    for (const [y, rot] of [[1.25, 25], [1.0, -30], [0.6, 10]]) {
      mb.with(T(0, y, 0, [0, rot, 0]), () => mb.cylinder({ r: 0.035, h: 0.45, sides: 5 }), {});
      mb.with(T(0, y, 0.02, [90, rot, 0]), () => mb.cylinder({ r: 0.035, h: 0.4, sides: 5 }));
    }
  }, { mat: PAL.timber });
  mb.with(null, () => mb.cylinder({ r: 0.22, h: 0.08, sides: 8 }), { mat: PAL.stone });
}

/** Crate / barrel clutter. */
export function crate(mb: MeshBuilder, s = 0.6) {
  mb.with(null, () => mb.box([s, s, s], [0, s / 2, 0], 0.03), { mat: PAL.timber });
  mb.with(null, () => {
    mb.box([s + 0.02, 0.06, s + 0.02], [0, s * 0.15, 0]);
    mb.box([s + 0.02, 0.06, s + 0.02], [0, s * 0.85, 0]);
  }, { mat: PAL.timberDark });
}
export function barrel(mb: MeshBuilder, h = 0.8) {
  const r = h * 0.36;
  mb.with(null, () => mb.lathe([[r * 0.85, 0], [r, h * 0.5], [r * 0.85, h]], 10, { capTop: true, capBottom: true }), { mat: PAL.timber });
  mb.with(null, () => {
    mb.lathe([[r * 0.9, h * 0.15], [r * 0.93, h * 0.2]], 10);
    mb.lathe([[r * 0.93, h * 0.8], [r * 0.9, h * 0.85]], 10);
  }, { mat: PAL.iron });
}

/** Sack pile / jade ore pile. */
export function orePile(mb: MeshBuilder, r = 0.8, seed = 1) {
  mb.with(null, () => mb.blob(r, 1, { squash: [1, 0.45, 1], smooth: false, displace: (d) => Math.sin(d[0] * 9 + seed) * 0.08 + Math.cos(d[2] * 7 + seed) * 0.08 }), { mat: PAL.jadeDeep });
  for (let i = 0; i < 5; i++) {
    const a = i * 2.3 + seed;
    mb.at(Math.cos(a) * r * 0.45, r * 0.3, Math.sin(a) * r * 0.45, () => crystal(mb, 0.12 + (i % 3) * 0.05, 0.4 + (i % 2) * 0.2), [10 * Math.sin(a), a * 50, 12 * Math.cos(a)]);
  }
}

/** Hexagonal jade crystal. */
export function crystal(mb: MeshBuilder, r: number, h: number) {
  mb.with(null, () => {
    mb.lathe([[r * 0.8, 0], [r, h * 0.15], [r, h * 0.75], [0.001, h]], 6, { smooth: false, capBottom: true });
  }, { mat: PAL.jade });
}

export type { V2 };
