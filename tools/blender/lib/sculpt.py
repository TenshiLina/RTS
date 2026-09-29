"""Shape layers applied to the rest mesh after MakeHuman's modifiers (numpy, Blender frame).

profile_warp: a smooth, low-frequency correction of the torso's silhouettes that the modifiers
cannot reach. Per height z it moves the section's front and back edges (profile) and scales its
width (front view); every vertex of the section follows by linear interpolation between the
edges, so the section keeps its own shape. Arms are excluded by their skin weights.
"""
import json, os
import numpy as np


def arm_mask(mh):
    W = json.load(open(os.path.join(mh.MH, 'default_weights.mhw')))['weights']
    w = np.zeros(mh.BODY_VERTS)
    for b, lst in W.items():
        if any(k in b for k in ('upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal', 'shoulder')):
            for i, x in lst:
                if i < mh.BODY_VERTS:
                    w[i] += x
    return np.clip(w, 0, 1)


def profile_warp(V, warp, armw):
    """warp: {'z': grid, 'front': dy of the front edge, 'back': dy of the back edge,
    'width': width factor} (metres; the figure faces -y). armw: per-vertex arm weight (0..1)."""
    if not warp:
        return V
    V = V.copy()
    n = len(armw)
    z = V[:n, 2]
    zg = np.asarray(warp['z'])
    dF = np.interp(z, zg, warp['front'], left=0, right=0)
    dB = np.interp(z, zg, warp['back'], left=0, right=0)
    kX = np.interp(z, zg, warp['width'], left=1, right=1)
    # the section's current front/back at each vertex's height (non-arm vertices, 5 mm bins)
    body = armw < 0.5
    bins = np.round(z / 0.005).astype(int)
    lo, hi = bins.min(), bins.max()
    front = np.full(hi - lo + 1, np.inf)
    back = np.full(hi - lo + 1, -np.inf)
    np.minimum.at(front, bins[body] - lo, V[:n, 1][body])
    np.maximum.at(back, bins[body] - lo, V[:n, 1][body])
    idx = np.arange(hi - lo + 1)
    ok = np.isfinite(front)
    front = np.interp(idx, idx[ok], front[ok])
    back = np.interp(idx, idx[ok], back[ok])
    f, b = front[bins - lo], back[bins - lo]
    t = np.clip((V[:n, 1] - f) / np.maximum(b - f, 1e-4), 0, 1)
    w = 1 - armw
    V[:n, 1] += w * (dF + (dB - dF) * t)
    V[:n, 0] *= 1 + w * (kX - 1)
    # legs (below the crotch): each leg's width scaled about its own centre line
    if 'leg' in warp:
        kL = np.interp(z, zg, warp['leg'], left=1, right=1)
        for sg in (1, -1):
            m = body & (z < warp.get('crotch', 0.84)) & (sg * V[:n, 0] > 0)
            xl, xr = np.full(hi - lo + 1, np.inf), np.full(hi - lo + 1, -np.inf)
            np.minimum.at(xl, bins[m] - lo, V[:n, 0][m])
            np.maximum.at(xr, bins[m] - lo, V[:n, 0][m])
            ok = np.isfinite(xl)
            if not ok.any():
                continue
            c = (np.interp(idx, idx[ok], xl[ok]) + np.interp(idx, idx[ok], xr[ok])) / 2
            mm = (z < warp.get('crotch', 0.84)) & (sg * V[:n, 0] > 0)
            cc = c[bins[mm] - lo]
            V[:n, 0][mm] = cc + (V[:n, 0][mm] - cc) * (1 + w[mm] * (kL[mm] - 1))
    return V


def smooth_curve(zg, zs, r, sigma, taper):
    """Residuals r at heights zs → a smooth curve on the grid zg: interpolated (linearly across
    heights without data), Gaussian-smoothed, tapered to 0 over `taper` metres at both ends of
    the data."""
    o = np.argsort(zs)
    zs, r = np.asarray(zs)[o], np.asarray(r)[o]
    c = np.interp(zg, zs, r)
    k = np.exp(-0.5 * ((zg[:, None] - zg[None, :]) / sigma) ** 2)
    c = (k @ c) / k.sum(1)
    lo, hi = zs.min(), zs.max()
    ramp = np.clip(np.minimum(zg - lo, hi - zg) / taper, 0, 1)
    ramp = ramp * ramp * (3 - 2 * ramp)
    return c * ramp


def grab(V, ops):
    """Grab-brush strokes: each op {'c': centre, 'r': radii (x, y, z), 'd': displacement,
    'mirror': bool (default True: also at x → -x with dx negated), 'p': falloff exponent (2
    Gaussian, default; 4 flat-topped)}; metres. Strokes are applied in
    order, each on the result of the previous."""
    V = V.copy()
    for op in ops or []:
        c, r, d = (np.asarray(op[k], float) for k in ('c', 'r', 'd'))
        cs = [(c, d)]
        if op.get('mirror', True) and abs(c[0]) > 1e-6:
            cs.append((c * [-1, 1, 1], d * [-1, 1, 1]))
        k = op.get('p', 2)  # falloff exponent: 2 Gaussian, 4 flat-topped
        for cc, dd in cs:
            w = np.exp(-0.5 * (((V - cc) / r) ** 2).sum(1) ** (k / 2))
            V += w[:, None] * dd
    return V


_tris = {}


def vertex_normals(V, F):
    """Area-weighted vertex normals (polygons fanned into triangles)."""
    key = id(F)
    if key not in _tris:
        _tris[key] = np.array([(f[0], f[k], f[k + 1]) for f in F for k in range(1, len(f) - 1)])
    T = _tris[key]
    n = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    N = np.zeros_like(V)
    for j in range(3):
        np.add.at(N, T[:, j], n)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)


_nbrs = {}


def neighbours(F):
    """Directed edges (i, j) of the polygons F, both directions, sorted by i (cached)."""
    key = id(F)
    if key not in _nbrs:
        E = set()
        for f in F:
            for a, b in zip(f, f[1:] + f[:1]):
                E.add((a, b)); E.add((b, a))
        _nbrs[key] = np.array(sorted(E))
    return _nbrs[key]


def smooth(V, F, idx, iters=10, lam=0.5):
    """Laplacian (umbrella) smoothing of the vertices idx, neighbours from the polygons F."""
    E = neighbours(F)
    V = V.copy()
    n = V.shape[0]
    sel = np.zeros(n, bool)
    sel[idx] = True
    Es = E[sel[E[:, 0]]]
    cnt = np.bincount(Es[:, 0], minlength=n)
    for _ in range(iters):
        acc = np.zeros_like(V)
        np.add.at(acc, Es[:, 0], V[Es[:, 1]])
        m = cnt > 0
        V[m] += lam * (acc[m] / cnt[m, None] - V[m])
    return V


def grow(F, idx, rings=1):
    """idx plus `rings` rings of polygon neighbours."""
    s = set(int(i) for i in idx)
    for _ in range(rings):
        add = set()
        for f in F:
            if s.intersection(f):
                add.update(f)
        s |= add
    return np.array(sorted(s))


