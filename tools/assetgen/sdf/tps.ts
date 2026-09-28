// Thin-plate spline interpolation in 2D: the smoothest surface (least bending energy) through
// a set of values at scattered points. Used to sculpt faces from anatomical landmarks — the
// surface passes through every landmark and cannot form creases or lumps between them.

export interface TpsPoint {
  x: number;
  y: number;
  v: number;
}

/** Fit a thin-plate spline; `lambda` > 0 relaxes exact interpolation (smoother). */
export function tps(points: TpsPoint[], lambda = 0): (x: number, y: number) => number {
  const n = points.length;
  const N = n + 3;
  const A = Array.from({ length: N }, () => new Float64Array(N));
  const b = new Float64Array(N);
  const phi = (r2: number) => (r2 < 1e-24 ? 0 : 0.5 * r2 * Math.log(r2));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
      A[i][j] = phi(dx * dx + dy * dy) + (i === j ? lambda : 0);
    }
    A[i][n] = 1; A[i][n + 1] = points[i].x; A[i][n + 2] = points[i].y;
    A[n][i] = 1; A[n + 1][i] = points[i].x; A[n + 2][i] = points[i].y;
    b[i] = points[i].v;
  }
  // Gaussian elimination with partial pivoting
  const M = A.map((r) => Float64Array.from(r));
  const x = Float64Array.from(b);
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [x[c], x[p]] = [x[p], x[c]];
    const d = M[c][c] || 1e-18;
    for (let r = c + 1; r < N; r++) {
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k < N; k++) M[r][k] -= f * M[c][k];
      x[r] -= f * x[c];
    }
  }
  for (let c = N - 1; c >= 0; c--) {
    let s = x[c];
    for (let k = c + 1; k < N; k++) s -= M[c][k] * x[k];
    x[c] = s / (M[c][c] || 1e-18);
  }
  const w = x.slice(0, n), a0 = x[n], ax = x[n + 1], ay = x[n + 2];
  const px = points.map((p) => p.x), py = points.map((p) => p.y);
  return (qx: number, qy: number) => {
    let s = a0 + ax * qx + ay * qy;
    for (let i = 0; i < n; i++) {
      const dx = qx - px[i], dy = qy - py[i];
      s += w[i] * phi(dx * dx + dy * dy);
    }
    return s;
  };
}

/** Sample a function on a grid once and read it back with bicubic (Catmull-Rom) filtering. */
export function gridded(f: (x: number, y: number) => number, x0: number, x1: number, y0: number, y1: number, h: number) {
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1;
  const g = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = f(x0 + i * h, y0 + j * h);
  const at = (i: number, j: number) => g[Math.max(0, Math.min(ny - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  return (x: number, y: number) => {
    const fx = (x - x0) / h, fy = (y - y0) / h;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return f(x, y);
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const row = (jj: number) => cr(at(i - 1, jj), at(i, jj), at(i + 1, jj), at(i + 2, jj), tx);
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), ty);
  };
}
