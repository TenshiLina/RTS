// Chinese roof generator: 庑殿 hip, 歇山 hip-and-gable, 攒尖 pyramidal and 悬山 gable roofs,
// all with the concave 举折 profile and upturned 起翘 corners that define the silhouette.
//
// One parametric model covers every style:
//   gableT = 0      → hip roof (four slopes)
//   0 < gableT < 1  → hip-and-gable (gable wall above, hip below)
//   gableT = 1      → pure gable roof
//   ridge = 0       → pyramidal roof (square pavilions, towers)

import { V3, V2, sub, cross, dot, lerp } from '../../../src/core/math';
import { MeshBuilder, T } from './mesh';
import type { MaterialDef } from '../../../src/core/materialModel';
import { PAL } from './palette';

export interface RoofOpts {
  /** eave half-extent along X (incl. overhang) */
  w: number;
  /** eave half-extent along Z */
  d: number;
  /** rise from eave to ridge */
  h: number;
  /** ridge half-length along X (0 → pyramid) */
  ridge: number;
  /** eave height */
  y: number;
  gableT?: number;
  concave?: number;
  lift?: number;
  flare?: number;
  thickness?: number;
  /** start the slopes at this t (cuts the top off → lower skirt of a double-eave roof) */
  tStart?: number;
  ridgeSize?: number;
  ornaments?: boolean;
  finial?: boolean;
  segs?: [number, number];
  tileMat?: MaterialDef;
  underMat?: MaterialDef;
  ridgeMat?: MaterialDef;
  trimMat?: MaterialDef;
  gableMat?: MaterialDef;
}

export function roof(mb: MeshBuilder, o: RoofOpts) {
  const W = o.w, D = o.d, H = o.h, Y = o.y;
  const R = Math.min(o.ridge, W);
  const tg = o.gableT ?? 0;
  const a = o.concave ?? 0.5;
  const U = o.lift ?? H * 0.22;
  const F = o.flare ?? U * 0.5;
  const th = o.thickness ?? 0.18;
  const t0 = o.tStart ?? 0;
  const rs = o.ridgeSize ?? 0.22;
  const [nS, nT] = o.segs ?? [14, 8];
  const tile = o.tileMat ?? PAL.roofTeam;
  const under = o.underMat ?? PAL.roofUnder;
  const ridgeM = o.ridgeMat ?? PAL.ridge;
  const trim = o.trimMat ?? PAL.gold;
  const gableM = o.gableMat ?? PAL.lacquerDark;
  const m = 3;

  const f = (t: number) => (1 - a) * (1 - t) + a * (1 - t) * (1 - t);
  const extentFront = (t: number) => {
    if (tg >= 1) return R;
    if (t <= tg) return R;
    return R + ((W - R) * (t - tg)) / (1 - tg);
  };
  const L = Math.hypot(D, H);

  /** front slope (+Z); s ∈ [-1,1] along the eave, t ∈ [0,1] ridge → eave */
  const front = (s: number, t: number, dy = 0): V3 => {
    const k = Math.pow(Math.abs(s), m) * (tg >= 1 ? 0.15 : 1);
    const lift = U * k * t * t;
    const fl = F * k * t * t;
    return [s * extentFront(t) + Math.sign(s) * fl, Y + H * f(t) + lift + dy, D * t + fl];
  };
  /** right slope (+X); s ∈ [-1,1] along Z. t ∈ [max(tg,t0),1] */
  const right = (s: number, t: number, dy = 0): V3 => {
    const k = Math.pow(Math.abs(s), m);
    const lift = U * k * t * t;
    const fl = F * k * t * t;
    const x = tg > 0 ? R + ((W - R) * (t - tg)) / (1 - tg) : R + (W - R) * t;
    return [x + fl, Y + H * f(t) + lift + dy, s * D * t + Math.sign(s) * fl];
  };

  const center: V3 = [0, Y - 50, 0];
  const oriented = (fn: (u: number, v: number) => V3, nu: number, nv: number, outward: (p: V3) => V3, uvFn: (u: number, v: number) => V2, mat: MaterialDef) => {
    // pick winding so the surface normal faces `outward`
    const p0 = fn(0.5, 0.5), pu = fn(0.52, 0.5), pv = fn(0.5, 0.52);
    const n = cross(sub(pu, p0), sub(pv, p0));
    const flip = dot(n, outward(p0)) < 0;
    mb.with(null, () => mb.surface(fn, nu, nv, { uvFn, flip }), { mat });
  };

  const slopeTop = (side: 'front' | 'right') => {
    if (side === 'front') {
      oriented((u, v) => front(u * 2 - 1, lerp(t0, 1, v)), nS, nT, (p) => sub(p, center), (u, v) => [front(u * 2 - 1, lerp(t0, 1, v))[0], lerp(t0, 1, v) * L], tile);
      // underside (only the overhang shows)
      const tu = Math.max(t0, 0.5);
      oriented((u, v) => front(u * 2 - 1, lerp(tu, 1, v), -th), Math.ceil(nS / 2), 3, () => [0, -1, 0], (u, v) => [u * 2 * W, v * L], under);
      // fascia board
      oriented((u, v) => front(u * 2 - 1, 1, -th * v), nS, 1, (p) => [0, 0, p[2]], (u, v) => [u * 2 * W, v * th], under);
    } else {
      const ts = Math.max(tg, t0);
      if (ts >= 1 || W - R < 1e-3) return;
      oriented((u, v) => right(u * 2 - 1, lerp(ts, 1, v)), Math.max(4, Math.round(nS * D / W)), nT, (p) => sub(p, center), (u, v) => [right(u * 2 - 1, lerp(ts, 1, v))[2], lerp(ts, 1, v) * L], tile);
      const tu = Math.max(ts, 0.5);
      oriented((u, v) => right(u * 2 - 1, lerp(tu, 1, v), -th), 4, 3, () => [0, -1, 0], (u, v) => [u * 2 * D, v * L], under);
      oriented((u, v) => right(u * 2 - 1, 1, -th * v), Math.max(4, Math.round(nS * D / W)), 1, (p) => [p[0], 0, 0], (u, v) => [u * 2 * D, v * th], under);
    }
  };

  // four slopes via mirroring (winding handled by the builder)
  mb.mirrorZ(() => slopeTop('front'));
  mb.mirrorX(() => slopeTop('right'));

  // gable triangles (歇山 / 悬山)
  if (tg > 0 && t0 < tg && R > 0) {
    mb.mirrorX(() => {
      const n = 6;
      const pts: V3[] = [];
      for (let i = 0; i <= n; i++) pts.push(front(1, lerp(t0, tg, i / n)));
      const inset = 0.12;
      const P = pts.map((p) => [p[0] - inset, p[1] - 0.05, p[2]] as V3);
      const Pm = P.map((p) => [p[0], p[1], -p[2]] as V3);
      const base: V3 = [P[n][0], P[n][1], 0];
      mb.with(null, () => {
        for (let i = 0; i < n; i++) {
          mb.triOut(base, P[i], P[i + 1], [0, Y, 0]);
          mb.triOut(base, Pm[i + 1], Pm[i], [0, Y, 0]);
        }
      }, { mat: gableM });
      // gable fish/sunburst ornament (悬鱼)
      mb.with(null, () => mb.box([0.06, 0.5, 0.35], [P[0][0] + 0.03, P[0][1] - 0.35, 0], 0.02), { mat: trim });
    });
  }

  // ---- ridges
  mb.with(null, () => {
    const topY = Y + H;
    if (R > 0.01 && t0 <= 0) {
      // 正脊 main ridge
      mb.box([2 * R + rs, rs * 1.9, rs * 1.1], [0, topY + rs * 0.7, 0], rs * 0.2);
      mb.with(null, () => mb.box([2 * R + rs * 0.6, rs * 0.2, rs * 1.2], [0, topY + rs * 1.05, 0], 0.03), { mat: PAL.goldDull });
      if (o.ornaments !== false) {
        // 鸱吻 ridge-end dragons: stylised curling horns
        mb.mirrorX(() => {
          const x0 = R + rs * 0.3;
          const path: V3[] = [];
          for (let i = 0; i <= 8; i++) {
            const q = i / 8;
            const ang = q * Math.PI * 1.15;
            path.push([x0 - Math.sin(ang) * rs * 1.6 * q, topY + rs * 0.8 + (1 - Math.cos(ang)) * rs * 1.7 + q * rs * 1.2, 0]);
          }
          mb.tube(path, (t) => rs * (0.75 - 0.5 * t), 8, { squash: [1, 0.55] });
          mb.with(null, () => mb.box([rs * 0.9, rs * 2.2, rs * 1.0], [x0 - rs * 0.1, topY + rs * 1.3, 0], 0.03), { mat: ridgeM });
          mb.with(null, () => mb.sphere(rs * 0.28, 8, 6), { mat: trim });
        });
      }
    }
    // 垂脊 / 戗脊 hip & gable-edge ridges — follow the s=±1 edge of the front slope,
    // extending past the eave so the tip curls up.
    const hipPath: V3[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = lerp(t0, 1.1, i / steps);
      const p = front(1, t, rs * 0.45);
      if (t > 1) p[1] += (t - 1) * 3.5 * rs;
      hipPath.push(p);
    }
    mb.mirrorX(() => mb.mirrorZ(() => {
      mb.tube(hipPath, (t) => rs * (0.62 - 0.22 * t), 6, { squash: [1.25, 0.8] });
      if (o.ornaments !== false) {
        // little ridge beasts (脊兽) near the corner
        for (let i = 0; i < 3; i++) {
          const t = 0.8 + i * 0.06;
          const p = front(1, t, rs * 1.05);
          mb.with(T(p[0], p[1], p[2]), () => mb.sphere(rs * 0.32, 6, 4, { squash: [1, 1.3, 1] }), { mat: ridgeM });
        }
        const tip = hipPath[hipPath.length - 1];
        mb.with(T(tip[0], tip[1] + rs * 0.2, tip[2]), () => mb.sphere(rs * 0.3, 6, 4), { mat: trim });
      }
    }));
    if (R <= 0.01 && o.finial !== false && t0 <= 0) {
      // 宝顶 finial
      mb.with(T(0, topY, 0), () => {
        mb.lathe([[rs * 1.6, 0], [rs * 1.5, rs * 0.6], [rs * 0.7, rs * 0.9], [rs * 1.0, rs * 1.6], [rs * 0.35, rs * 2.4], [rs * 0.6, rs * 3.0], [0.001, rs * 3.9]], 10, { capBottom: true });
      }, { mat: trim });
    }
  }, { mat: ridgeM });

  return { front, right, eaveY: Y, topY: Y + H };
}

// ------------------------------------------------------------------ architectural helpers

/** Stone platform (台基) with optional front stairs. */
export function platform(mb: MeshBuilder, w: number, d: number, h: number, opts: { stairs?: boolean | 'front' | 'both'; stairW?: number; mat?: MaterialDef; trim?: MaterialDef } = {}) {
  const mat = opts.mat ?? PAL.stone;
  mb.with(null, () => {
    mb.box([w, h, d], [0, h / 2, 0], 0.06);
    // 须弥座-style lip
    mb.box([w + 0.16, 0.12, d + 0.16], [0, h - 0.06, 0], 0.03);
    mb.box([w + 0.12, 0.1, d + 0.12], [0, 0.05, 0], 0.03);
    const sw = opts.stairW ?? Math.min(2.4, w * 0.35);
    const stairs = (sign: number) => {
      const n = Math.max(2, Math.round(h / 0.18));
      for (let i = 0; i < n; i++) {
        const sh = h * (1 - i / n);
        const depth = 0.32 * (i + 1);
        mb.box([sw, sh, 0.34], [0, sh / 2, sign * (d / 2 + depth - 0.17)], 0.02);
      }
      // side balustrade stones
      for (const sx of [-1, 1]) mb.box([0.22, h + 0.08, 0.34 * n], [sx * (sw / 2 + 0.11), (h + 0.08) / 2, sign * (d / 2 + 0.17 * n)], 0.04);
    };
    if (opts.stairs === true || opts.stairs === 'front' || opts.stairs === 'both') stairs(1);
    if (opts.stairs === 'both') stairs(-1);
  }, { mat });
}

/** Ring of columns (柱) with plinths along a rectangle. */
export function colonnade(mb: MeshBuilder, w: number, d: number, y0: number, h: number, nx: number, nz: number, r = 0.2, opts: { mat?: MaterialDef; skipFront?: number[] } = {}) {
  const mat = opts.mat ?? PAL.vermilion;
  const pos: V2[] = [];
  for (let i = 0; i < nx; i++) {
    const x = -w / 2 + (w * i) / (nx - 1);
    pos.push([x, d / 2], [x, -d / 2]);
  }
  for (let j = 1; j < nz - 1; j++) {
    const z = -d / 2 + (d * j) / (nz - 1);
    pos.push([w / 2, z], [-w / 2, z]);
  }
  for (const [x, z] of pos) {
    mb.with(T(x, y0, z), () => {
      mb.with(null, () => mb.cylinder({ r: r * 1.45, rTop: r * 1.25, h: 0.14, sides: 10 }), { mat: PAL.stone });
      mb.with(null, () => mb.cylinder({ r, rTop: r * 0.92, h, sides: 10, y0: 0.14, capBottom: false }), { mat });
    });
  }
  return pos;
}

/** Painted bracket band (斗拱 + 彩画 frieze) under the eaves. */
export function bracketBand(mb: MeshBuilder, w: number, d: number, y: number, h = 0.5, count = 8) {
  // frieze beams
  mb.with(null, () => {
    mb.box([w + 0.1, h * 0.45, d + 0.1], [0, y + h * 0.22, 0], 0.03);
  }, { mat: PAL.paintTeal });
  mb.with(null, () => {
    mb.box([w + 0.14, h * 0.12, d + 0.14], [0, y + h * 0.5, 0], 0.02);
  }, { mat: PAL.paintBlue });
  mb.with(null, () => mb.box([w + 0.16, h * 0.06, d + 0.16], [0, y + h * 0.05, 0]), { mat: PAL.gold });
  // bracket blocks
  mb.with(null, () => {
    const place = (x: number, z: number, rot: number) => {
      mb.with(T(x, y + h * 0.56, z, [0, rot, 0]), () => {
        mb.box([0.3, h * 0.2, 0.3], [0, 0, 0.1], 0.02);
        mb.box([0.5, h * 0.16, 0.24], [0, h * 0.18, 0.22], 0.02);
        mb.box([0.24, h * 0.16, 0.5], [0, h * 0.18, 0.28], 0.02);
        mb.box([0.62, h * 0.14, 0.22], [0, h * 0.34, 0.38], 0.02);
      });
    };
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / count;
      place(x, d / 2, 0);
      place(x, -d / 2, 180);
    }
    const cz = Math.max(2, Math.round((count * d) / w));
    for (let i = 0; i < cz; i++) {
      const z = -d / 2 + (d * (i + 0.5)) / cz;
      place(w / 2, z, 90);
      place(-w / 2, z, -90);
    }
  }, { mat: PAL.paintGreen });
}

/** Lattice window / door panel (窗棂) facing +Z at the given centre. */
export function latticePanel(mb: MeshBuilder, w: number, h: number, c: V3, opts: { cols?: number; rows?: number; frame?: MaterialDef; paper?: MaterialDef } = {}) {
  const cols = opts.cols ?? Math.max(2, Math.round(w / 0.28));
  const rows = opts.rows ?? Math.max(2, Math.round(h / 0.28));
  const frame = opts.frame ?? PAL.lattice;
  mb.with(null, () => mb.box([w, h, 0.06], [c[0], c[1], c[2] - 0.02]), { mat: opts.paper ?? PAL.paperWindow });
  mb.with(null, () => {
    mb.box([w + 0.1, 0.1, 0.1], [c[0], c[1] + h / 2, c[2]]);
    mb.box([w + 0.1, 0.1, 0.1], [c[0], c[1] - h / 2, c[2]]);
    mb.box([0.1, h, 0.1], [c[0] - w / 2, c[1], c[2]]);
    mb.box([0.1, h, 0.1], [c[0] + w / 2, c[1], c[2]]);
    for (let i = 1; i < cols; i++) mb.box([0.035, h, 0.05], [c[0] - w / 2 + (w * i) / cols, c[1], c[2] + 0.01]);
    for (let j = 1; j < rows; j++) mb.box([w, 0.035, 0.05], [c[0], c[1] - h / 2 + (h * j) / rows, c[2] + 0.01]);
  }, { mat: frame });
}

/** Red paper lantern hanging at `c` (top attach point). */
export function lantern(mb: MeshBuilder, c: V3, r = 0.2) {
  mb.with(T(c[0], c[1], c[2]), () => {
    mb.with(null, () => mb.cylinder({ r: 0.012, h: 0.25, y0: -0.25, sides: 4 }), { mat: PAL.rope });
    mb.with(null, () => {
      mb.cylinder({ r: r * 0.45, h: 0.06, y0: -0.3, sides: 8 });
      mb.cylinder({ r: r * 0.45, h: 0.06, y0: -0.3 - r * 2.3, sides: 8 });
    }, { mat: PAL.gold });
    mb.with(T(0, -0.27 - r * 1.15, 0), () => mb.sphere(r, 10, 7, { squash: [1, 1.15, 1] }), { mat: PAL.lanternRed });
    mb.with(null, () => mb.cylinder({ r: 0.03, rTop: 0.01, h: 0.25, y0: -0.3 - r * 2.3 - 0.25, sides: 5 }), { mat: PAL.clothGold });
  });
}

/** Tall team-coloured war banner (旗) on a pole. */
export function bannerPole(mb: MeshBuilder, c: V3, h = 4.5, bw = 0.9, bh = 1.8, rot = 0) {
  mb.with(T(c[0], c[1], c[2], [0, rot, 0]), () => {
    mb.with(null, () => {
      mb.cylinder({ r: 0.1, rTop: 0.12, h: 0.3, sides: 8 });
      mb.cylinder({ r: 0.045, rTop: 0.035, h, sides: 6, y0: 0.3 });
    }, { mat: PAL.timberDark });
    mb.with(null, () => mb.cone(0.07, 0.3, 6, h + 0.3), { mat: PAL.gold });
    // cross bar + banner
    mb.with(null, () => mb.box([bw + 0.1, 0.05, 0.05], [bw / 2, h + 0.05, 0]), { mat: PAL.timberDark });
    mb.with(T(0.02, h + 0.02, 0), () => mb.banner(bw, bh, { tails: 3, nv: 6 }), { mat: PAL.clothTeam });
  });
}
