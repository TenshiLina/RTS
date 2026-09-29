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


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bust_height(x, z, b):
    """The bust's height field over the frontal plane (x ≥ 0 side; metres): a smooth (C1) dome
    f = (1 - ρ²)^e over an egg-shaped footprint — apex (xa, za), reach medial xm / lateral xl /
    top zt / bottom zb — whose top narrows (superellipse q_up < 2) and leans towards the armpit
    (tail), so the upper pole is long and tapering and the lower pole short and round (teardrop);
    projection P. Every switch between the poles and sides is blended over centimetres, not
    millimetres: a hard switch shows as a ledge."""
    u, v = x - b['xa'], z - b['za']
    up = _smoothstep(-0.02, 0.02, v)
    vpos = 0.5 * (v + np.sqrt(v * v + 0.01 ** 2))          # soft max(v, 0)
    u = u - b.get('tail', 0.0) * vpos                      # the upper pole leans towards the armpit
    Rx = (b['xa'] - b['xm']) + ((b['xl'] - b['xa']) - (b['xa'] - b['xm'])) * _smoothstep(-0.02, 0.02, u)
    Rz = (b['za'] - b['zb']) + ((b['zt'] - b['za']) - (b['za'] - b['zb'])) * up
    q = 2.0 + (b.get('q_up', 2.0) - 2.0) * up             # footprint superellipse: < 2 narrows the top
    rho = ((np.abs(u) / Rx) ** q + (np.abs(v) / Rz) ** q) ** (1 / q)
    f = np.clip(1 - np.minimum(rho, 1) ** 2, 0, 1) ** b.get('e', 1.0)
    return b['P'] * f


def smooth_normals(V, F, iters=20):
    """Normals of a smoothed copy of the surface: the directions of broad forms, free of the
    noise of small features (a large displacement along noisy normals folds the surface)."""
    return vertex_normals(smooth(V, F, np.arange(len(V)), iters), F)


def bust(V, F, b, armw, N=None):
    """Add the bust (symmetric) to the posed body, along the chest's smoothed normals (N:
    precomputed for V), front half only."""
    if not b:
        return V
    n = len(armw)
    N = smooth_normals(V[:n], F) if N is None else N
    h = bust_height(np.abs(V[:n, 0]), V[:n, 2], b)
    h = h * _smoothstep(0.02, -0.02, V[:n, 1]) * (1 - armw)
    h = smooth(h[:, None], F, np.where(h > 0)[0], iters=int(b.get('blur', 10)))[:, 0]  # low-pass the displacement
    V = V.copy()
    V[:n] += h[:, None] * N
    return V


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


def smooth(V, F, idx, iters=10, lam=0.5, normal_only=False):
    """Laplacian (umbrella) smoothing of the vertices idx, neighbours from the polygons F.
    normal_only: move along the (smoothed) surface normal only — bumps flatten while the vertices
    keep their spacing (umbrella steps drag dense rings sideways, pinching the surface)."""
    E = neighbours(F)
    N = smooth_normals(V, F) if normal_only else None
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
        d = acc[m] / cnt[m, None] - V[m]
        if N is not None:
            d = (d * N[m]).sum(1, keepdims=True) * N[m]
        V[m] += lam * d
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


def fair(V, F, idx):
    """Biharmonic (thin-plate) fill: the vertices idx are replaced by the smoothest surface that
    continues the surrounding two rings in position and slope (so a convex ribcage stays convex,
    unlike a Laplacian membrane, which goes flat). Uniform Laplacian; dense solve (small regions)."""
    E = neighbours(F)
    R = np.unique(idx)
    inR = np.zeros(len(V), bool)
    inR[R] = True
    ring1 = np.unique(E[inR[E[:, 0]] & ~inR[E[:, 1]], 1])
    in1 = np.zeros(len(V), bool)
    in1[ring1] = True
    ring2 = np.unique(E[in1[E[:, 0]] & ~inR[E[:, 1]] & ~in1[E[:, 1]], 1])
    S = np.r_[R, ring1, ring2]
    loc = -np.ones(len(V), int)
    loc[S] = np.arange(len(S))
    rows = np.r_[R, ring1]
    L = np.zeros((len(rows), len(S)))
    for k, i in enumerate(rows):
        nb = E[E[:, 0] == i, 1]
        nb = nb[loc[nb] >= 0]
        L[k, loc[i]] = -1.0
        L[k, loc[nb]] += 1.0 / len(nb)
    # (L²) restricted to the interior rows: L[R rows] @ L[rows over S] — rows' columns are within S
    LR = L[:len(R)]                  # interior rows, columns over S
    Lrows = np.zeros((len(S), len(S)))
    Lrows[:len(rows)] = L            # Laplacian rows for R ∪ ring1 (ring2 rows unused)
    A = LR @ Lrows                   # |R| × |S|
    Ai, Ab = A[:, :len(R)], A[:, len(R):]
    X = np.linalg.solve(Ai, -Ab @ V[S[len(R):]])
    V = V.copy()
    V[R] = X
    return V


def chest_wall(V, F, wb, armw):  # (wb: MakeHuman's breast weights, kept for callers)
    """Replace MakeHuman's breast mound with the ribcage's continuation: a smooth surface
    y = f(x², z) (symmetric; polynomial, least squares) fitted to the front of the chest around
    the mound, the mound's vertices set onto it in depth only (x, z kept, so the mesh's spacing
    is untouched), blended by the breast weight and faded towards the sides and the back."""
    n = len(wb)
    N = smooth_normals(V[:n], F)
    x, y, z = V[:n, 0], V[:n, 1], V[:n, 2]
    front = (N[:, 1] < -0.35) & (np.abs(x) < 0.16) & (z > 1.10) & (z < 1.42) & (armw < 0.2)
    zc = (z - 1.26) / 0.1
    xx = (x / 0.1) ** 2

    def feats(xx, zc):
        return np.stack([np.ones_like(xx), xx, xx ** 2, zc, zc ** 2, zc ** 3, xx * zc, xx * zc ** 2, xx ** 2 * zc], 1)
    # the replaced region: a smooth plateau over the mound and its fold (not the skin weights,
    # which end within one ring — right at the fold — and leave a crease); faded towards the back
    plate = np.exp(-((np.abs(x) - 0.085) / 0.06) ** 4 - ((z - 1.225) / 0.075) ** 4)
    w = plate * _smoothstep(-0.02, -0.06, y) * (1 - armw)
    fit = front & (plate < 0.05)
    coef = np.linalg.lstsq(feats(xx[fit], zc[fit]), y[fit], rcond=None)[0]
    V = V.copy()
    V[:n, 1] += w * (feats(xx, zc) @ coef - y)
    # relax the replaced vertices within the new surface (x, z; then back onto it): the mound's
    # nipple sides collapse onto one spot and its fold's rows are bunched — both show as seams
    E = neighbours(F)
    core = np.where(w > 0.2)[0]
    sel = np.zeros(len(V), bool)
    sel[core] = True
    Es = E[sel[E[:, 0]]]
    cnt = np.bincount(Es[:, 0], minlength=len(V))
    m = cnt > 0
    for _ in range(30):
        acc = np.zeros_like(V)
        np.add.at(acc, Es[:, 0], V[Es[:, 1]])
        d = acc[m] / cnt[m, None] - V[m]
        V[m, 0] += 0.5 * w[m] * d[:, 0]
        V[m, 2] += 0.5 * w[m] * d[:, 2]
        xm, zm = (V[m, 0] / 0.1) ** 2, (V[m, 2] - 1.26) / 0.1
        V[m, 1] += w[m] * (feats(xm, zm) @ coef - V[m, 1])
    return V
