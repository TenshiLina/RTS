"""ICT-FaceKit's face model (ICT Face Model Light, MIT licence) on the MakeHuman head.

The model: a neutral head (26719 vertices: face, head and neck, mouth and eye sockets, teeth,
eyeballs, lashes) and 100 identity shapes — principal components of light-stage scans of real
faces registered to one topology, each scaled to its standard deviation. A face from it (the
neutral plus coefficients × shapes) is a plausible real face, and fitting the coefficients to the
concept with a prior that pulls them to 0 keeps it one: the anatomy (how the nose joins the lip,
the eye sockets, the ears) comes from real people, not from stacked sliders.

On the MakeHuman head: the head's vertices are registered once to the neutral surface — a
landmark-driven thin-plate warp of the MakeHuman head onto it (lid margins, the lips' border and
their meeting line, the profile's points, the ears, the eyeballs), refined by closest points —
so each MakeHuman vertex gets a point on the model's surface (barycentric in one of its
triangles). Any face of the model then gives the MakeHuman head: the model's surface at those
points, placed on the body by a similarity transform and blended into the MakeHuman neck. The
MakeHuman topology, UVs, rig and helpers (eyeballs, lashes, teeth) are kept.

Frame: Blender (Z-up, metres, facing -Y); the model is converted from its own (Y-up, cm, facing +Z).
"""
import os
import numpy as np
from . import mh

ICT = os.path.join(mh.TOOLS, 'ict')
N_MODES = 100
# the Multi-PIE 68 landmarks' vertices (the model's README)
LANDMARKS = [1225, 1888, 1052, 367, 1719, 1722, 2199, 1447, 966, 3661, 4390, 3927, 3924, 2608, 3272, 4088, 3443,
             268, 493, 1914, 2044, 1401, 3615, 4240, 4114, 2734, 2509, 978, 4527, 4942, 4857, 1140, 2075, 1147,
             4269, 3360, 1507, 1542, 1537, 1528, 1518, 1511, 3742, 3751, 3756, 3721, 3725, 3732, 5708, 5695,
             2081, 0, 4275, 6200, 6213, 6346, 6461, 5518, 5957, 5841, 5702, 5711, 5533, 6216, 6207, 6470, 5517, 5966]
SCLERA = {'l': (21451, 22221), 'r': (23021, 23791)}
IRIS = {'l': (22221, 23021), 'r': (23791, 24591)}
LASHES = {'l': (25351, 26035), 'r': (26035, 26719)}
SKIN = ('M_Face', 'M_BackHead')   # the face, the head and neck, the mouth and eye sockets
ICT_LID = (3751, 4130)            # an edge of the left lid margin's loop (through landmarks 43-47)
MH_LID = (13352, 13353)           # MakeHuman's left lid margin loop (where the lashes root)
MH_LIP_UPPER, MH_LIP_LOWER = 520, 523   # MakeHuman's lips' meeting line at the midline

_model = None


def convert(src, out):
    """The model's OBJs (generic_neutral_mesh.obj, identity000..099.obj in src) → a compact npz."""
    def verts(fn):
        return np.array([l.split()[1:4] for l in open(fn) if l.startswith('v ')], np.float32)
    V0 = verts(os.path.join(src, 'generic_neutral_mesh.obj'))
    F, mat, cur = [], [], None
    for l in open(os.path.join(src, 'generic_neutral_mesh.obj')):
        if l.startswith('usemtl'):
            cur = l.split()[1]
        elif l.startswith('f '):
            f = [int(t.split('/')[0]) - 1 for t in l.split()[1:]]
            F.append(f if len(f) == 4 else f + [f[-1]]); mat.append(cur)
    D = np.stack([verts(os.path.join(src, f'identity{i:03d}.obj')) - V0 for i in range(N_MODES)])
    np.savez_compressed(out, V0=V0, D=D, Fq=np.array(F), mat=np.array(mat))


def load():
    """{'V0': neutral (n×3), 'D': identity shapes (k×n×3), 'F': faces (lists), 'T': triangles,
    'skin': triangle mask of the skin} in the Blender frame, metres."""
    global _model
    if _model is None:
        d = np.load(os.path.join(ICT, 'ict.npz'))
        conv = lambda A: np.stack([A[..., 0], -A[..., 2], A[..., 1]], axis=-1).astype(np.float64) * 0.01
        Fq, mat = d['Fq'], d['mat']
        F = [list(dict.fromkeys(int(v) for v in f)) for f in Fq]
        T, skin = [], []
        for f, m in zip(F, mat):
            for k in range(1, len(f) - 1):
                T.append((f[0], f[k], f[k + 1])); skin.append(m in SKIN)
        _model = {'V0': conv(d['V0']), 'D': conv(d['D']), 'F': F, 'T': np.array(T), 'skin': np.array(skin)}
    return _model


def shape(coeffs):
    """The model's vertices for identity coefficients (a sequence; missing ones are 0)."""
    m = load()
    c = np.zeros(N_MODES)
    c[:len(coeffs)] = coeffs
    return m['V0'] + np.tensordot(c, m['D'], axes=1)


# ---- geometry helpers

def tps_fit(src, dst, lam):
    """Thin-plate (3D biharmonic, φ(r) = r) warp taking src to dst; lam: per-point smoothing (m)."""
    n = len(src)
    K = np.linalg.norm(src[:, None] - src[None], axis=2)
    K[np.diag_indices(n)] += np.broadcast_to(lam, (n,))
    Pm = np.c_[np.ones(n), src]
    A = np.zeros((n + 4, n + 4))
    A[:n, :n], A[:n, n:], A[n:, :n] = K, Pm, Pm.T
    b = np.zeros((n + 4, 3))
    b[:n] = dst
    return src, np.linalg.solve(A, b)


def tps_apply(model, X):
    src, sol = model
    out = np.empty_like(X)
    for i in range(0, len(X), 4000):
        x = X[i:i + 4000]
        out[i:i + 4000] = np.linalg.norm(x[:, None] - src[None], axis=2) @ sol[:len(src)] + np.c_[np.ones(len(x)), x] @ sol[len(src):]
    return out


def closest_on_triangles(Q, N, V, T, tri_ok, k=16, min_dot=0.3, max_dist=0.01):
    """Closest points of the triangles T (vertices V) to the points Q, among the triangles
    around the k nearest vertices whose normals agree with the points' normals N (dot > min_dot):
    (triangle index, barycentric (3), distance); index -1 where none is within max_dist."""
    from scipy.spatial import cKDTree
    used = np.unique(T[tri_ok])
    tree = cKDTree(V[used])
    _, nn = tree.query(Q, k=k)
    nn = used[nn]
    vt = [[] for _ in range(len(V))]
    for ti in np.where(tri_ok)[0]:
        for v in T[ti]:
            vt[v].append(ti)
    tn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    tn /= np.maximum(np.linalg.norm(tn, axis=1, keepdims=True), 1e-15)
    out_t = np.full(len(Q), -1)
    out_b = np.zeros((len(Q), 3))
    out_d = np.full(len(Q), np.inf)
    for i in range(len(Q)):
        cand = np.array(sorted(set(t for v in nn[i] for t in vt[v])))
        if not len(cand):
            continue
        cand = cand[tn[cand] @ N[i] > min_dot]
        if not len(cand):
            continue
        p, b = _closest_point_tri(Q[i], V[T[cand, 0]], V[T[cand, 1]], V[T[cand, 2]])
        dd = np.linalg.norm(p - Q[i], axis=1)
        j = np.argmin(dd)
        if dd[j] < max_dist:
            out_t[i], out_b[i], out_d[i] = cand[j], b[j], dd[j]
    return out_t, out_b, out_d


def _closest_point_tri(p, a, b, c):
    """Closest points on triangles (a, b, c: m×3) to the point p, with barycentrics (Ericson)."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - b
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - c
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) < 1e-30, 1e-30, va + vb + vc)
    v, w = vb / den, vc / den
    bary = np.stack([1 - v - w, v, w], 1)
    # regions outside the face: vertex and edge cases
    m = (d1 <= 0) & (d2 <= 0); bary[m] = [1, 0, 0]
    m = (d3 >= 0) & (d4 <= d3); bary[m] = [0, 1, 0]
    m = (d6 >= 0) & (d5 <= d6); bary[m] = [0, 0, 1]
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0) & ~((d1 <= 0) & (d2 <= 0)) & ~((d3 >= 0) & (d4 <= d3))
    t = np.clip(d1 / np.where(d1 - d3 == 0, 1e-30, d1 - d3), 0, 1)
    bary[m] = np.stack([1 - t, t, 0 * t], 1)[m]
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0) & ~((d1 <= 0) & (d2 <= 0)) & ~((d6 >= 0) & (d5 <= d6))
    t = np.clip(d2 / np.where(d2 - d6 == 0, 1e-30, d2 - d6), 0, 1)
    bary[m] = np.stack([1 - t, 0 * t, t], 1)[m]
    m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0) & ~((d3 >= 0) & (d4 <= d3)) & ~((d6 >= 0) & (d5 <= d6))
    t = np.clip((d4 - d3) / np.where((d4 - d3) + (d5 - d6) == 0, 1e-30, (d4 - d3) + (d5 - d6)), 0, 1)
    bary[m] = np.stack([0 * t, 1 - t, t], 1)[m]
    pts = bary[:, :1] * a + bary[:, 1:2] * b + bary[:, 2:] * c
    return pts, bary


def similarity(src, dst, w=None):
    """Least-squares similarity (s, R, t) with dst ≈ s R src + t (Umeyama), optional weights."""
    w = np.ones(len(src)) if w is None else np.asarray(w, float)
    w = w / w.sum()
    ms, md = w @ src, w @ dst
    A, B = src - ms, dst - md
    C = (B * w[:, None]).T @ A
    U, S, Vt = np.linalg.svd(C)
    d = np.sign(np.linalg.det(U @ Vt))
    D = np.diag([1, 1, d])
    R = U @ D @ Vt
    s = (S * [1, 1, d]).sum() / (w @ (A ** 2).sum(1))
    return s, R, md - s * R @ ms


def _polyline_sample(P, n):
    """n points evenly spaced by arc length along the polyline P (ends included)."""
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.r_[0, np.cumsum(seg)]
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, P[:, j]) for j in range(3)], 1)


def _split_closed(P, centre):
    """A closed curve around `centre` → its (upper, lower) halves from the medial end (smaller
    |x|) to the lateral one, split at its extreme points along x."""
    q = P - centre
    ang = np.arctan2(q[:, 2], q[:, 0] * np.sign(centre[0] or 1))
    P = P[np.argsort(ang)]
    q = P - centre
    lat = q[:, 0] * np.sign(centre[0] or 1)
    i_med, i_lat = np.argmin(lat), np.argmax(lat)
    n = len(P)
    walk = lambda a, b: P[[(a + k) % n for k in range(((b - a) % n) + 1)]]
    h1, h2 = walk(i_lat, i_med), walk(i_med, i_lat)
    up, lo = (h1, h2[::-1]) if h1[:, 2].mean() > h2[:, 2].mean() else (h2[::-1], h1)
    if np.abs(up[0, 0]) > np.abs(up[-1, 0]):
        up = up[::-1]
    if np.abs(lo[0, 0]) > np.abs(lo[-1, 0]):
        lo = lo[::-1]
    return up, lo


def _edge_loop(v0, v1, F):
    from . import face
    return face._edge_loop(v0, v1, F)


def _profile(V, idx, eye_z):
    """Midline profile points of vertices idx (their frontmost per 1 mm of height): nose tip,
    subnasale, nasion, pogonion, menton (as lib/face.py: extrema in height bands)."""
    top = idx[np.argmax(V[idx, 2])]
    front_y = V[idx, 1].min()
    idx = idx[(V[idx, 1] < front_y + 0.09) & (V[idx, 2] > eye_z - 0.14) & (V[idx, 2] < eye_z + 0.05)]
    Q = V[idx]
    zb = np.round((Q[:, 2] - eye_z) * 1000).astype(int)
    o = np.lexsort((Q[:, 1], zb))
    first = np.r_[True, np.diff(zb[o]) != 0]
    mi = idx[o][first]
    mi = mi[np.argsort(-V[mi, 2])]
    y, z = V[mi, 1], (V[mi, 2] - eye_z) * 100

    def ext(z0, z1, fn):
        m = (z <= z0) & (z >= z1)
        return np.where(m)[0][fn(y[m])]
    out = {}
    tip = ext(-2.0, -5.5, np.argmin); out['nose_tip'] = mi[tip]
    sn = ext(z[tip] - 0.3, z[tip] - 2.2, np.argmax); out['subnasale'] = mi[sn]
    ls = ext(z[sn] - 0.3, z[sn] - 2.4, np.argmin)
    st = ext(z[ls] - 0.2, z[ls] - 1.6, np.argmax)
    li = ext(z[st] - 0.2, z[st] - 1.6, np.argmin)
    lm = ext(z[li] - 0.3, z[li] - 2.4, np.argmax)
    pg = ext(z[lm] - 0.3, z[lm] - 2.8, np.argmin); out['pogonion'] = mi[pg]
    below = (z < z[pg]) & (y < y[pg] + 0.015)
    out['menton'] = mi[np.where(below)[0][np.argmin(z[below])]]
    out['nasion'] = mi[ext(1.5, -1.0, np.argmax)]
    out['vertex'] = top
    return out


def ear_region(V, idx, eye, F, side, stand=0.003):
    """An ear's vertices: what stands out more than `stand` (m) from the head's side (a quadric
    x = f(y, z) fitted to the side around it), the connected piece holding the most lateral point."""
    sg = 1 if side == 'l' else -1
    box = idx[(sg * V[idx, 0] > 0.045) & (V[idx, 2] > eye[2] - 0.09) & (V[idx, 2] < eye[2] + 0.05) &
              (V[idx, 1] > eye[1] + 0.03)]
    lat = box[np.argmax(sg * V[box, 0])]
    dd = np.linalg.norm(V[box] - V[lat], axis=1)
    q = lambda k: np.c_[np.ones(len(k)), V[k, 1], V[k, 2], V[k, 1] ** 2, V[k, 1] * V[k, 2], V[k, 2] ** 2]
    out = box[dd > 0.045]
    coef = np.linalg.lstsq(q(out), sg * V[out, 0], rcond=None)[0]
    ins = box[dd <= 0.045]
    cand = set(ins[sg * V[ins, 0] - q(ins) @ coef > stand].tolist())
    ear, todo = {int(lat)}, [int(lat)]
    nb = _neighbours(F)
    while todo:
        v = todo.pop()
        for w in nb.get(v, ()):
            if w in cand and w not in ear:
                ear.add(w); todo.append(w)
    return np.array(sorted(ear))


def _ear_points(V, idx, eye, F, side):
    """An ear's top, bottom, back, front and most lateral points (ear_region)."""
    e = ear_region(V, idx, eye, F, side)
    sg = 1 if side == 'l' else -1
    return {'ear_top': e[np.argmax(V[e, 2])], 'ear_bottom': e[np.argmin(V[e, 2])],
            'ear_back': e[np.argmax(V[e, 1])], 'ear_front': e[np.argmin(V[e, 1])],
            'ear_lateral': e[np.argmax(sg * V[e, 0])]}


_mh_ears = {}


def mh_ears(side='l', reg=None, stand=0.0015):
    """MakeHuman's ear vertices on the model's face: those registered inside the model's ear
    (ear_region on the neutral: standing out 1.5 mm from the head, so the lobe and the helix's
    root are in), the ear itself without the head around it."""
    if (side, stand) not in _mh_ears:
        reg = reg or registration()
        m = load()
        I = m['V0']
        skin = np.unique(m['T'][m['skin']])
        eye = sphere(I[slice(*SCLERA[side])])[0]
        e = np.zeros(len(I), bool)
        e[ear_region(I, skin, eye, m['F'], side, stand)] = True
        tri = reg['tri']
        ok = tri >= 0
        inside = np.zeros(len(tri), bool)
        inside[ok] = e[m['T'][tri[ok]]].all(1)
        _mh_ears[side, stand] = reg['idx'][inside]
    return _mh_ears[side, stand]


_nb = {}


def _neighbours(F):
    key = id(F)
    if key not in _nb:
        nb = {}
        for f in F:
            for a, b in zip(f, f[1:] + f[:1]):
                nb.setdefault(a, set()).add(b); nb.setdefault(b, set()).add(a)
        _nb[key] = nb
    return _nb[key]


def _mirror_index(V, idx, pool):
    """The vertices of `pool` nearest the mirror images (x → -x) of the vertices idx."""
    from scipy.spatial import cKDTree
    tree = cKDTree(V[pool])
    _, j = tree.query(V[idx] * [-1, 1, 1])
    return pool[j]


# ---- the correspondences

def ict_features(I):
    """Named feature points of the model (neutral, Blender frame), left and right."""
    m = load()
    F = m['F']
    feats = {}
    loop = _edge_loop(*ICT_LID, F)
    for side, sg in (('l', 1), ('r', -1)):
        c = I[slice(*SCLERA[side])].mean(0)
        feats[f'eye_{side}'] = c
        lid = loop if sg > 0 else _mirror_index(I, np.array(loop), np.arange(9409))
        corner = LANDMARKS[42] if sg > 0 else LANDMARKS[39]
        P = np.r_[I[lid], I[[corner]]]
        up, lo = _split_closed(P, c)
        feats[f'lid_up_{side}'] = _polyline_sample(up, 11)
        feats[f'lid_lo_{side}'] = _polyline_sample(lo, 11)[1:-1]
    lips = I[LANDMARKS[48:60]]
    mid = lips.mean(0) * [0, 1, 1]
    up, lo = _split_closed_lips(lips, mid)
    feats['lips_up'] = _polyline_sample(up, 17)
    feats['lips_lo'] = _polyline_sample(lo, 17)[1:-1]
    feats['stomion_up'], feats['stomion_lo'] = I[LANDMARKS[62]], I[LANDMARKS[66]]
    skin = np.unique(m['T'][m['skin']])
    midl = skin[np.abs(I[skin, 0]) < 2e-4]
    prof = _profile(I, midl, feats['eye_l'][2])
    for k, v in prof.items():
        feats[k] = I[v]
    for side in ('l', 'r'):
        for k, v in _ear_points(I, skin, feats[f'eye_{side}'], F, side).items():
            feats[f'{k}_{side}'] = I[v]
    return feats


def _split_closed_lips(P, mid):
    """The lips' border (a closed polyline, both halves) → upper and lower halves from corner to corner (-x to +x)."""
    i0, i1 = np.argmin(P[:, 0]), np.argmax(P[:, 0])
    n = len(P)
    walk = lambda a, b: P[[(a + k) % n for k in range(((b - a) % n) + 1)]]
    h1, h2 = walk(i0, i1), walk(i1, i0)[::-1]
    return (h1, h2) if h1[:, 2].mean() > h2[:, 2].mean() else (h2, h1)


def mh_features(V):
    """The same feature points on MakeHuman vertices V (all vertices, Blender frame)."""
    from . import face
    base = mh.load_base()
    F, g = base['F'], base['groups']
    B = V[:mh.BODY_VERTS]
    feats = {}
    loop = np.array(_edge_loop(*MH_LID, F))
    for side, sg in (('l', 1), ('r', -1)):
        c = V[sorted(g[f'helper-{side}-eye'])].mean(0)
        feats[f'eye_{side}'] = c
        lid = loop if sg > 0 else _mirror_index(B, loop, np.arange(mh.BODY_VERTS))
        up, lo = _split_closed(B[lid], c)
        feats[f'lid_up_{side}'] = _polyline_sample(up, 11)
        feats[f'lid_lo_{side}'] = _polyline_sample(lo, 11)[1:-1]
    L = face.mouth_border()
    P = B[L]
    up, lo = _split_closed_lips(P, P.mean(0))
    feats['lips_up'] = _polyline_sample(up, 17)
    feats['lips_lo'] = _polyline_sample(lo, 17)[1:-1]
    feats['stomion_up'], feats['stomion_lo'] = B[MH_LIP_UPPER], B[MH_LIP_LOWER]
    midl = np.where(np.abs(B[:, 0]) < 1e-4)[0]
    midl = midl[B[midl, 2] > feats['eye_l'][2] - 0.25]
    prof = _profile(B, midl, feats['eye_l'][2])
    for k, v in prof.items():
        feats[k] = B[v]
    for side in ('l', 'r'):
        for k, v in _ear_points(B, np.arange(mh.BODY_VERTS), feats[f'eye_{side}'], F, side).items():
            feats[f'{k}_{side}'] = B[v]
    return feats


def _stack(feats, keys):
    return np.concatenate([np.atleast_2d(feats[k]) for k in keys])


# ---- registration

REG_VERSION = 'r2'


def head_vertices(V):
    """The MakeHuman body vertices the model covers: the head and the neck above the shoulders."""
    B = V[:mh.BODY_VERTS]
    eye_z = V[sorted(mh.load_base()['groups']['helper-l-eye'])].mean(0)[2]
    return np.where(B[:, 2] > eye_z - 0.20)[0]


def register(V, verbose=False):
    """Register MakeHuman vertices V (all, Blender frame; the base female) onto the model's
    neutral surface. Returns {'idx': head vertex indices, 'tri': triangle per vertex (-1: none),
    'bary': barycentrics, 'dist': final distances (m), 's', 'R', 't': the similarity placing
    the model on V (V ≈ s R model + t)}."""
    m = load()
    I = m['V0']
    fi, fm = ict_features(I), mh_features(V)
    keys = sorted(fi)
    Pi, Pm = _stack(fi, keys), _stack(fm, keys)
    # rigid+scale alignment of the model onto MakeHuman (all features)
    s, R, t = similarity(Pi, Pm)
    to_ict = lambda X: ((X - t) @ R) / s
    head = head_vertices(V)
    X = to_ict(V[:mh.BODY_VERTS])   # the MakeHuman body in the model's frame
    Pm_i = to_ict(Pm)
    # stage 1: the landmark warp
    warp = tps_fit(Pm_i, Pi, 1e-5)
    F = mh.load_base()['F']
    from . import sculpt
    lam_feat = 2e-6
    for it in range(4):
        Xw = X.copy()
        Xw[head] = tps_apply(warp, X[head])
        N = sculpt.vertex_normals(Xw, F)
        tri, bary, dist = closest_on_triangles(Xw[head], N[head], I, m['T'], m['skin'],
                                               min_dot=0.5 if it < 3 else 0.2, max_dist=0.02 if it < 3 else 0.01)
        ok = tri >= 0
        proj = np.einsum('nj,njk->nk', bary[ok], I[m['T'][tri[ok]]])
        if verbose:
            print(f'  reg {it}: {ok.mean() * 100:.1f}% projected, dist mean {dist[ok].mean() * 1000:.2f} mm, '
                  f'p95 {np.percentile(dist[ok], 95) * 1000:.2f} mm', flush=True)
        if it == 3:
            break
        # stage 2: refit the warp to the closest points (subsampled) plus the features (stiff)
        sub = np.where(ok)[0][::4]
        src = np.r_[X[head][sub], Pm_i]
        dst = np.r_[proj[np.searchsorted(np.where(ok)[0], sub)], Pi]
        lam = np.r_[np.full(len(sub), [3e-4, 1e-4, 5e-5][it]), np.full(len(Pi), lam_feat)]
        warp = tps_fit(src, dst, lam)
    s2, R2, t2 = similarity(proj, V[head][ok])   # the model placed on the MakeHuman head
    return {'idx': head, 'tri': tri, 'bary': bary, 'dist': dist, 's': s2, 'R': R2, 't': t2,
            'anchor': anchor(V), 'features': keys}


def anchor(V):
    """Where the head sits on the neck: MakeHuman's head joint (the skull's base, which the neck's
    length and pose carry)."""
    return V[sorted(mh.load_base()['groups']['joint-head'])].mean(0)


def registration(V=None):
    """The cached registration of the base female (see register), computed on first use."""
    path = os.path.join(ICT, f'register-{REG_VERSION}.npz')
    if os.path.exists(path):
        d = np.load(path)
        return {k: d[k] for k in d.files}
    if V is None:
        from character import woman
        V = mh.to_blender(mh.morphed(woman.TARGETS), 1.68, woman.SCALE_REF)
    r = register(V, verbose=True)
    np.savez(path, **{k: v for k, v in r.items() if k != 'features'})
    return r


def surface(reg, I):
    """The model's surface (vertices I) at the registered points: (n_head×3), NaN where none."""
    m = load()
    tri = reg['tri']
    out = np.full((len(tri), 3), np.nan)
    ok = tri >= 0
    out[ok] = np.einsum('nj,njk->nk', reg['bary'][ok], I[m['T'][tri[ok]]])
    return out


# ---- the model's face on MakeHuman vertices

RAMP = (0.07, 0.01)   # m below the menton: the blend into the MakeHuman neck (0 → 1)


def apply(V, coeffs, reg=None, anatomy=1.0, scale=1.0, dz=0.0):
    """MakeHuman vertices V (all: body + helpers, Blender frame, rest) with the head replaced by
    the model's face for the identity coefficients: the body's head vertices move to the model's
    surface (placed by the registration's similarity, carried by the head joint's displacement
    from the registered head's, blended into the neck below the chin), the eyeballs move and scale to the model's, the other helpers (lashes, teeth, tongue, joints)
    follow the body vertices nearest them. anatomy < 1 keeps that fraction of MakeHuman's own
    shape (1: the model's). scale, dz: the face's size (about the eyes' midpoint) and height on
    the body, beyond the registration's."""
    from scipy.spatial import cKDTree
    reg = reg or registration()
    base = mh.load_base()
    g = base['groups']
    idx, tri = reg['idx'], reg['tri']
    I = shape(coeffs)
    s, R, t = float(reg['s']), reg['R'], reg['t'] + (anchor(V) - reg['anchor'])   # (riding on the neck)
    em = (sphere(I[slice(*SCLERA['l'])])[0] + sphere(I[slice(*SCLERA['r'])])[0]) / 2
    em = s * em @ R.T + t
    s0 = s
    to_mh = lambda X: em + scale * (s0 * X @ R.T + t - em) + [0, 0, dz]
    s = s0 * scale                      # (the eyeballs' radius below)
    P = to_mh(surface(reg, I))
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    # the unregistered few: their displacement from the neighbours' (harmonic fill)
    disp = P - B[idx]
    known = tri >= 0
    pos = {v: i for i, v in enumerate(idx)}
    nb = _neighbours(base['F'])
    unk = np.where(~known)[0]
    disp[unk] = 0
    for _ in range(200):
        for i in unk:
            ns = [pos[w] for w in nb[idx[i]] if w in pos]
            disp[i] = disp[ns].mean(0)
    # the blend into the neck (by height below the menton), and the anatomy fraction
    z = B[idx, 2]
    mz = B[_menton(B)][2]
    w = np.clip((z - (mz - RAMP[0])) / (RAMP[0] - RAMP[1]), 0, 1)
    w = w * w * (3 - 2 * w)
    if anatomy < 1.0:
        P0 = to_mh(surface(reg, load()['V0']))
        disp = disp - (1 - anatomy) * np.nan_to_num(P0 - B[idx])   # keep MakeHuman's own offset from the neutral
    dB = np.zeros_like(B)
    dB[idx] = w[:, None] * disp
    newB = B + dB
    # the eyeballs: to the model's, scaled to its radius
    helper = np.arange(mh.BODY_VERTS, len(V))
    moved = np.zeros(len(V), bool)
    eye0 = {sd: V[sorted(g[f'helper-{sd}-eye'])].mean(0) for sd in ('l', 'r')}
    for side in ('l', 'r'):
        e = np.array(sorted(g[f'helper-{side}-eye']))
        c0, r0 = sphere(V[e])
        ci, ri = sphere(I[slice(*SCLERA[side])])
        c1 = to_mh(ci[None])[0]
        r1 = s * ri
        V[e] = c1 + (V[e] - c0) * (r1 / r0)
        moved[e] = True
        j = np.array(sorted(g[f'joint-{side}-eye']))
        V[j] += c1 - c0
        moved[j] = True
    tree = cKDTree(B)

    def follow(P):
        """The body's displacement at the points P (its 4 nearest vertices, inverse distance)."""
        dd, nn = tree.query(P, k=4)
        wt = 1 / np.maximum(dd, 1e-5)
        wt /= wt.sum(1, keepdims=True)
        return np.einsum('nk,nkj->nj', wt, dB[nn])
    # the lashes: each strip carried by its roots on the lid margin (the skin nearest its tips is the
    # brow's or the cheek's, which move otherwise)
    for sd in ('l', 'r'):
        for k in (1, 2):
            gi = np.array(sorted(g[f'helper-{sd}-eyelashes-{k}']))
            d = np.linalg.norm(V[gi] - eye0[sd], axis=1)
            root = gi[d < d.min() + 0.33 * (d.max() - d.min())]
            _, j = cKDTree(V[root]).query(V[gi])
            V[gi] += follow(V[root])[j]
            moved[gi] = True
    # the other helpers: the displacement of the body vertices nearest them
    rest = helper[~moved[helper]]
    V[rest] += follow(V[rest])
    V[:mh.BODY_VERTS] = newB
    return V


def brow_warp(V, prm):
    """The brow ridge beside the eyes flattened ('flat', 0..1): per vertical slice over each eye's
    outer part, the skin that bulges in front of the straight line from the upper lid's fold
    (0.5 cm above the eyeball's centre: the ridge's base over the lid is included) to the forehead
    (3.5 cm) is moved back by that fraction of
    its bulge — the ridge softens toward the line and never goes behind it (no dent). The model's
    modes tie the outer brow to the glabella, which the concept's profile wants forward; its brow
    is soft, the fit's otherwise projects over the eye."""
    a = (prm or {}).get('flat', 0.0)
    if not a:
        return V
    V = V.copy()
    g = mh.load_base()['groups']
    B = V[:mh.BODY_VERTS]
    Z0, Z1 = 0.005, 0.035
    for sd, sg in (('l', 1), ('r', -1)):
        c, _ = sphere(V[sorted(g[f'helper-{sd}-eye'])])
        rel = B - c
        lat = sg * rel[:, 0]                                     # + toward the temple
        front = rel[:, 1] < 0.004
        # the surface's front at the line's two ends, per 2.5 mm column
        bins = np.arange(-0.012, 0.032, 0.0025)
        yl, yh = [], []
        for x0 in bins:
            col = front & (np.abs(lat - x0) < 0.0015)
            lo = col & (np.abs(rel[:, 2] - Z0) < 0.0015)
            hi = col & (np.abs(rel[:, 2] - Z1) < 0.0015)
            yl.append(rel[lo, 1].min() if lo.any() else np.nan)
            yh.append(rel[hi, 1].min() if hi.any() else np.nan)
        yl, yh = np.array(yl), np.array(yh)
        ok = np.isfinite(yl) & np.isfinite(yh)
        if ok.sum() < 3:
            continue
        sel = front & (rel[:, 2] > Z0) & (rel[:, 2] < Z1) & (lat > bins[ok][0]) & (lat < bins[ok][-1])
        t = (rel[sel, 2] - Z0) / (Z1 - Z0)
        chord = np.interp(lat[sel], bins[ok], yl[ok]) * (1 - t) + np.interp(lat[sel], bins[ok], yh[ok]) * t
        bulge = np.maximum(chord - rel[sel, 1], 0)             # in front of the line (forward is -y)
        bulge *= rel[sel, 1] < chord + 0.012                    # (the surface, not the orbit behind it)
        u = np.clip((lat[sel] + 0.008) / 0.008, 0, 1) * np.clip((0.028 - lat[sel]) / 0.006, 0, 1)
        w = u * u * (3 - 2 * u)                                 # the outer brow, fading at both ends
        idx = np.where(sel)[0]
        B[idx, 1] += a * w * bulge
    V[:mh.BODY_VERTS] = B
    return V


def eye_warp(V, prm):
    """The eyes in their sockets: brought forward ('fwd', metres) — each eyeball with its lids and
    lashes as one within 1.8 cm of its centre, the socket's surroundings (brow, cheek, the nose's
    side) following less, out to 3.2 cm: the fit otherwise sets the eyes too deep (the concept's eye
    front is ~1 cm behind the nasion)."""
    d = (prm or {}).get('fwd', 0.0)
    if not d:
        return V
    V = V.copy()
    g = mh.load_base()['groups']
    for sd in ('l', 'r'):
        c, _ = sphere(V[sorted(g[f'helper-{sd}-eye'])])
        idx = np.r_[np.arange(mh.BODY_VERTS), sorted(g[f'helper-{sd}-eye']), sorted(g[f'joint-{sd}-eye']),
                    sorted(g[f'helper-{sd}-eyelashes-1']), sorted(g[f'helper-{sd}-eyelashes-2']),
                    sorted(g.get(f'joint-{sd}-upperlid', [])), sorted(g.get(f'joint-{sd}-lowerlid', []))].astype(int)
        r = np.linalg.norm(V[idx] - c, axis=1)
        t = np.clip((r - 0.018) / 0.014, 0, 1)
        w = 1 - t * t * (3 - 2 * t)
        V[idx] -= np.outer(w, [0, d, 0])
    return V


def _inside(P, poly):
    """Which of the 2D points P are inside the polygon poly (even-odd rule)."""
    x, y = P[:, 0], P[:, 1]
    inside = np.zeros(len(P), bool)
    for (x1, y1), (x2, y2) in zip(poly, np.roll(poly, -1, axis=0)):
        cross = (y1 > y) != (y2 > y)
        xi = x1 + (y - y1) * (x2 - x1) / np.where(y2 != y1, y2 - y1, 1e-12)
        inside ^= cross & (x < xi)
    return inside


def lid_drape(V, prm):
    """The lids draped over the eyeball, the eyeball theirs: the lids and the skin around them set in
    depth on a sphere of radius 'r' (m) centred under the pupil, its front at the pupil set back by
    'back' (m) — each keeps its offset from the model's eyeball shell and its place in the front view
    (the opening's outline, fitted in front, stays) — and beyond the sphere's outline (the canthi)
    continuing along its tangent, 'wrap' steepening it. The eyeball is then that sphere: sized to the
    lids, not the lids to it (or 'globe': a larger one set back by 'seat' behind the lids). The lid
    margins and the socket inside the opening drape; the skin around
    follows its nearest margin, fading out 2-12 mm from it (the brow, the orbital rim and the cheek
    stay); the lashes follow their roots, the lid joints the skin."""
    if not prm or not prm.get('r'):
        return V
    from scipy.spatial import cKDTree
    V = V.copy()
    g = mh.load_base()['groups']
    r1, back, wrap = prm['r'], prm.get('back', 0.0), prm.get('wrap', 0.0)

    def front_depth(rho, R, cy):
        """A sphere's front surface (y) at rho from its axis; along its tangent beyond 0.92 R."""
        rho0 = 0.92 * R
        h0 = np.sqrt(np.maximum(R ** 2 - rho0 ** 2, 1e-12))
        inside = cy - np.sqrt(np.maximum(R ** 2 - rho ** 2, 0))
        outside = cy - h0 + rho0 / h0 * (1 + wrap) * (rho - rho0)
        return np.where(rho < rho0, inside, outside)
    for sd in ('l', 'r'):
        e = np.array(sorted(g[f'helper-{sd}-eye']))
        c0, r0 = sphere(V[e])
        c1 = c0 + np.array([0.0, (r1 - r0) + back, 0.0])      # (its front at the pupil, set back by 'back')

        kc = float(prm.get('corner', 1.0))

        def dy(P):
            """The drape itself: on the new sphere, each point's offset from the shell kept; past the shell's
            outline (the corners) by 'corner' (0..1) of the difference there — followed fully, the outer
            corner went 4.4 mm back and the skin around it after it: a bowl round the corner, the orbital
            rim standing out of it."""
            rel = P - c0
            d0 = np.maximum(np.linalg.norm(rel, axis=1) - r0, -0.004)
            rho = np.hypot(rel[:, 0], rel[:, 2])
            full = front_depth(rho, r1 + d0, c1[1]) - front_depth(rho, r0 + d0, c0[1])
            if kc != 1.0:
                re = np.minimum(rho, 0.92 * (min(r0, r1) + d0))   # (the smaller sphere's outline)
                edge = front_depth(re, r1 + d0, c1[1]) - front_depth(re, r0 + d0, c0[1])
                full = edge + kc * (full - edge)
            return (rel[:, 1] < 0.004) * full
        B = V[:mh.BODY_VERTS]
        near = np.where(np.linalg.norm(B - c0, axis=1) < r0 + 0.02)[0]
        # the lid margins (the lash strips' roots) and the socket inside the opening drape on the sphere;
        # the skin around follows its nearest margin, fading out 2-12 mm from it (the sphere's continuation
        # would sink the cheek and the temple around the eye)
        from . import face
        up, lo = face.lash_roots(V, sd)
        M = V[np.r_[up, lo]]
        dM = dy(M)
        dist, nn = cKDTree(M).query(B[near])
        ring = np.r_[V[up][:, [0, 2]], V[lo][::-1][:, [0, 2]]]
        inner = _inside(B[near][:, [0, 2]], ring) & (B[near][:, 1] > M[:, 1].min() - 0.0005)
        t = np.clip((dist - 0.002) / 0.010, 0, 1)
        D = np.where(inner, dy(B[near]), (1 - t * t * (3 - 2 * t)) * dM[nn])
        joints = [np.array(sorted(g.get(grp, [])), int) for grp in (f'joint-{sd}-upperlid', f'joint-{sd}-lowerlid')]
        jj = [cKDTree(B[near]).query(V[gi])[1] if len(gi) else None for gi in joints]
        V[near, 1] += D
        for k in (1, 2):
            gi = np.array(sorted(g[f'helper-{sd}-eyelashes-{k}']))
            d = np.linalg.norm(V[gi] - c0, axis=1)
            root = gi[d < d.min() + 0.33 * (d.max() - d.min())]
            _, jj = cKDTree(V[root]).query(V[gi])
            V[gi, 1] += dy(V[root])[jj]
        for gi, k in zip(joints, jj):
            if len(gi):
                V[gi, 1] += D[k]
        # the eyeball: the sphere the lids are draped on, or ('globe', m) a larger one set back ('seat', m,
        # its front behind the sphere's) so it stays behind the lids — fuller in the corners
        rg = prm.get('globe') or r1
        cg = c1 + np.array([0.0, (rg - r1) + prm.get('seat', 0.0), 0.0])
        V[e] = cg + (V[e] - c0) * (rg / r0)
        j = np.array(sorted(g[f'joint-{sd}-eye']))
        V[j] += cg - c0
    return V



def margin_warp(V, prm):
    """The lid margins set onto the traced ones in the front view: each lid's margin (its lash strip's
    roots) moved up or down by a smooth profile across the eye — prm 'x' (m from the midline, outer
    corner last), 'up' and 'lo' (m, + up) — the tissue inside the opening between them in proportion,
    the skin around following its nearest margin and fading out 2-9 mm from it (the crease, the brow
    and the cheek stay), the lashes with their roots, the lid joints with the skin; on the eyeball, the
    lids slide over it (their distance from its centre kept). The fitted warps shape the lids with a
    few broad parameters, which bent the margin where their falloffs overlapped; this lays it along
    the trace; 'relax': the outer corner's skin smoothed (steps); 'reach': (full, none) distances (m) of
    the skin's following (the pretarsal strip only, so the fold above stays its own), 'reach_lo' the
    lower lid's (default 'reach'). Both sides,
    mirrored. 'canthus_in': the inner corner's skin point raised (m) to where the lids meet."""
    if not prm or not prm.get('x'):
        return V
    from scipy.spatial import cKDTree
    from . import face
    V = V.copy()
    g = mh.load_base()['groups']
    xs = np.asarray(prm['x'], float)
    o = np.argsort(xs)
    xs, du, dl = xs[o], np.asarray(prm['up'], float)[o], np.asarray(prm['lo'], float)[o]
    for sd in ('l', 'r'):
        sg = 1.0 if sd == 'l' else -1.0
        c, rad = sphere(V[sorted(g[f'helper-{sd}-eye'])])
        up, lo = face.lash_roots(V, sd)
        ex = sg * V[np.r_[up, lo], 0]                        # (beyond the margins' ends, their ends' values:
        ex0, ex1 = ex.min(), ex.max()                        # the corners' skin follows them, not the profile's
        prof = lambda P, d: np.interp(np.clip(sg * P[:, 0], ex0, ex1), xs, d, left=0.0, right=0.0)   # tails)
        Mu, Ml = V[up], V[lo]
        dMu, dMl = prof(Mu, du), prof(Ml, dl)
        B = V[:mh.BODY_VERTS]
        near = np.where(np.linalg.norm(B - c, axis=1) < rad + 0.02)[0]
        P = B[near]
        M = np.r_[Mu, Ml]
        dM = np.r_[dMu, dMl]
        dist, nn = cKDTree(M[:, [0, 2]]).query(P[:, [0, 2]])
        ring = np.r_[Mu[:, [0, 2]], Ml[::-1][:, [0, 2]]]
        inner = _inside(P[:, [0, 2]], ring) & (P[:, 1] > M[:, 1].min() - 0.0005)
        # inside: between the margins, by height (each margin's height at the vertex's x)
        xo = np.argsort(Mu[:, 0]); zu = np.interp(P[:, 0], Mu[xo, 0], Mu[xo, 2])
        xo = np.argsort(Ml[:, 0]); zl = np.interp(P[:, 0], Ml[xo, 0], Ml[xo, 2])
        t = np.clip((P[:, 2] - zl) / np.maximum(zu - zl, 1e-6), 0, 1)
        d_in = prof(P, dl) + t * (prof(P, du) - prof(P, dl))
        r0, r1 = prm.get('reach', (0.002, 0.009))           # (full within r0 of a margin, none from r1)
        l0, l1 = prm.get('reach_lo', (r0, r1))              # (the lower lid's: no fold below it to keep —
        lo_ = nn >= len(Mu)                                  # its skin follows into the cheek)
        r0, r1 = np.where(lo_, l0, r0), np.where(lo_, l1, r1)
        f = np.clip((dist - r0) / (r1 - r0), 0, 1)
        D = np.where(inner, d_in, (1 - f * f * (3 - 2 * f)) * dM[nn])
        D *= (P[:, 1] - c[1]) < 0.012                     # (not the socket's back)
        q = P - c
        r0 = np.linalg.norm(q, axis=1)
        q[:, 2] += D
        on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * (np.abs(D) > 0) * (q[:, 1] < 0)
        y2 = -np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
        q[:, 1] += on * (y2 - q[:, 1])
        newP = c + q
        joints = [np.array(sorted(g.get(grp, [])), int) for grp in (f'joint-{sd}-upperlid', f'joint-{sd}-lowerlid')]
        jj = [cKDTree(P).query(V[gi])[1] if len(gi) else None for gi in joints]
        # the lashes: each strip moved as its nearest root (before the skin moves)
        for k in (1, 2):
            gi = np.array(sorted(g[f'helper-{sd}-eyelashes-{k}']))
            d = np.linalg.norm(V[gi] - c, axis=1)
            root = gi[d < d.min() + 0.33 * (d.max() - d.min())]
            _, kk = cKDTree(V[root]).query(V[gi])
            Rq = V[root] - c
            rr = np.linalg.norm(Rq, axis=1)
            Dr = prof(V[root], du if np.isin(root, up).any() else dl)
            Rn = Rq.copy(); Rn[:, 2] += Dr
            onr = np.clip((rad + 0.005 - rr) / 0.003, 0, 1) * (Rn[:, 1] < 0)
            Rn[:, 1] += onr * (-np.sqrt(np.maximum(rr ** 2 - Rn[:, 0] ** 2 - Rn[:, 2] ** 2, 0)) - Rn[:, 1])
            V[gi] += (Rn - Rq)[kk]
        for gi, k in zip(joints, jj):
            if len(gi):
                V[gi] += (newP - P)[k]
        V[near] = newP
        # the outer corner relaxed ('relax' steps): its skin was folded in the model's registration, and
        # laying the corner along the lash line folded it into a pit beside the canthus — the skin within
        # 2 mm of the corner (the margins' lateral ends, front view) smoothed, fading out by 4 mm, kept in
        # front of the eyeball
        cin = prm.get('canthus_in', 0.0)
        if cin:   # (the inner corner's skin point set at the lids' meeting point: full there, none from 2.5 mm)
            k = V[face.canthi(sd)[1]]
            Bn = V[:mh.BODY_VERTS]
            t = np.clip(np.hypot(Bn[:, 0] - k[0], Bn[:, 2] - k[2]) / prm.get('canthus_r', 0.0025), 0, 1)
            V[:mh.BODY_VERTS, 2] += cin * (1 - t * t * (3 - 2 * t)) * ((Bn[:, 1] - c[1]) < 0.012)
        n = int(prm.get('relax', 0))
        if n:
            k0 = (V[up][np.argmax(sg * V[up][:, 0])] + V[lo][np.argmax(sg * V[lo][:, 0])]) / 2
            _relax(V, k0, c, rad, n)
    return V


def _relax(V, k0, c, rad, n, r0=0.002, r1=0.004):
    """Laplacian smoothing (in place) of the body's skin around the point k0 (front-view distance:
    full within r0, none from r1, and not the socket's back), n steps, kept in front of the eyeball
    (centre c, radius rad)."""
    global _edges
    if _edges is None:
        e = set()
        for f in mh.load_base()['F']:
            for a, b in zip(f, f[1:] + f[:1]):
                e.add((a, b) if a < b else (b, a))
        _edges = np.array(sorted(e), dtype=np.int64)
    B = V[:mh.BODY_VERTS]
    d = np.hypot(B[:, 0] - k0[0], B[:, 2] - k0[2])
    t = np.clip((d - r0) / (r1 - r0), 0, 1)
    w = (1 - t * t * (3 - 2 * t)) * ((B[:, 1] - c[1]) < 0.012)
    sel = w > 0
    E = _edges[sel[_edges[:, 0]] | sel[_edges[:, 1]]]
    X = B.copy()
    for _ in range(n):
        acc = np.zeros_like(X); cnt = np.zeros(len(X))
        np.add.at(acc, E[:, 0], X[E[:, 1]]); np.add.at(acc, E[:, 1], X[E[:, 0]])
        np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
        avg = np.where(cnt[:, None] > 0, acc / np.maximum(cnt, 1)[:, None], X)
        X = X + 0.5 * w[:, None] * (avg - X)
        q = X[sel] - c                                     # (in front of the eyeball, 0.3 mm clear)
        r = np.linalg.norm(q, axis=1)
        ins = (r < rad + 0.0003) & (q[:, 1] < 0)
        q[ins] *= ((rad + 0.0003) / np.maximum(r[ins], 1e-9))[:, None]
        X[sel] = c + q
    V[:mh.BODY_VERTS] = X

_edges = None


def undereye(V, prm):
    """The skin under the lower lid: 'mode' 'chord' (_undereye_chord), else relaxed (_undereye_relax)."""
    if prm and prm.get('mode') == 'chord':
        return _undereye_chord(V, prm)
    return _undereye_relax(V, prm)


_tris = None


def _ray_grid(B, pc, x0=-0.035, x1=0.035, z0=-0.040, z1=0.040, step=0.0005, cut=0.008):
    """The skin's visible front surface around an eye (centre pc) sampled on a grid over (x, z): rays cast
    from in front; hits behind the eye's centre less 'cut' (m; inside the opening: the socket) left NaN
    (None: all kept). Returns the grid's x and z and the depths (y), (len(gx), len(gz))."""
    global _tris
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    if _tris is None:
        t = []
        for f in mh.load_base()['F']:
            if len(f) == 4:
                t.append([f[0], f[1], f[2]]); t.append([f[0], f[2], f[3]])
            else:
                t.append(list(f[:3]))
        _tris = t
    bvh = BVHTree.FromPolygons([Vector(v) for v in B.tolist()], _tris, all_triangles=True)
    gx = pc[0] + np.arange(x0, x1 + step / 2, step); gz = pc[2] + np.arange(z0, z1 + step / 2, step)
    D = np.full((len(gx), len(gz)), np.nan)
    y0 = pc[1] - 0.08
    for i, x in enumerate(gx):
        for j, z in enumerate(gz):
            hit = bvh.ray_cast(Vector((x, y0, z)), Vector((0, 1, 0)), 0.2)
            if hit[0] is not None and (cut is None or hit[0].y < pc[1] - cut):
                D[i, j] = hit[0].y
    return gx, gz, D


def _front_surface(B, pc, x0=-0.035, x1=0.035, z0=-0.040, z1=0.040, step=0.0005):
    """The skin's visible front surface around an eye (centre pc) as a depth field over (x, z): rays cast
    from in front on a 0.5 mm grid — the lids' inner faces and the socket never enter it, as they did a
    point cloud's interpolation (near the margin it read the rim's inner faces: 1-2.5 mm behind the skin,
    varying 1.3 mm column to column); inside the opening (hits behind the eye's centre less 8 mm)
    filled from the nearest sample. Returns f(points[:, (x, z)]) -> y."""
    from scipy.interpolate import RegularGridInterpolator
    from scipy.ndimage import distance_transform_edt
    gx, gz, D = _ray_grid(B, pc, x0, x1, z0, z1, step)
    if np.isnan(D).any():
        _, idx = distance_transform_edt(np.isnan(D), return_indices=True)
        D = D[idx[0], idx[1]]
    f = RegularGridInterpolator((gx, gz), D, bounds_error=False, fill_value=np.nan)
    return lambda P: f(np.asarray(P, float))


def _biharmonic(D, U, S=None, T=None, lam=None):
    """The grid D's values in the mask U replaced by the biharmonic interpolation of the rest (the
    smoothest surface through its surroundings, matching their values and slopes: no edge where it
    meets them): the least squares of the Laplacian over the cells S (default all) — where S stops short
    of U's border, only the values are matched there, not the slopes; with a target T and weights lam (per
    cell), plus lam (u - T)^2 — the fill drawn toward T (features of T wider than ~2 pi / lam^(1/4) cells
    kept). U must keep 2 cells from the grid's border."""
    import scipy.sparse as sp
    from scipy.sparse.linalg import spsolve
    nx, nz = D.shape
    n = nx * nz
    idx = np.arange(n).reshape(nx, nz)
    rows, cols, vals = [], [], []
    inner = idx[1:-1, 1:-1].ravel()
    for di, dj, w in ((0, 0, -4.0), (1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0)):
        rows.append(inner); cols.append(idx[1 + di:nx - 1 + di, 1 + dj:nz - 1 + dj].ravel()); vals.append(np.full(len(inner), w))
    Lp = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))
    if S is not None:
        Lp = sp.diags(S.ravel().astype(float)) @ Lp
    A = (Lp.T @ Lp).tocsr()
    u = U.ravel()
    ui, ki = np.where(u)[0], np.where(~u)[0]
    d = D.ravel().copy()
    Auu, rhs = A[ui][:, ui], -A[ui][:, ki] @ d[ki]
    if T is not None:
        lw = lam.ravel()[ui]
        Auu = Auu + sp.diags(lw)
        rhs = rhs + lw * T.ravel()[ui]
    x = spsolve(Auu.tocsc(), rhs)
    d[ui] = x
    return d.reshape(nx, nz)


def lid_fill(V, prm):
    """The skin around each eye made smooth in depth (the front view stays): the band between the lids'
    rims and the orbit's edge — from 'rim' (m) out of the opening (the lash roots' loop, closed through
    the corners) to 'up' above the upper margin (the brow's underside), 'down' below the lower margin (the
    cheek), 'medial' toward the nose from the inner corner ('medial_low' from 'medial_dz' below it) and
    'lateral' out from the outer corner —
    replaced by the biharmonic interpolation of the skin around it ('facing': the least forward component of
    its normal; a depth-only fill is ill-posed on skin facing sideways): the smoothest surface matching its
    surroundings' depths and slopes. The face model (a real face's scan) brought an under-eye bag's groove
    and a line out from the outer corner, which the lid fits sharpened and the concept's make-up seemed to
    confirm; flattening toward chords left an edge where each one ended (a ridge over the upper lid, an
    arc under the lower). The lids' own shape (a crease) is added after (lid_crease). By 'amount' (0..1);
    'medial_ramp' (m) ramps it in from the band's medial edge, 'medial_keep' keeps part of the face's own
    tear trough toward the nose; visible skin only, kept 0.6 mm in front of the eyeball."""
    if not prm or not prm.get('amount'):
        return V
    from scipy.interpolate import RegularGridInterpolator
    from scipy.ndimage import distance_transform_edt
    from . import face
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    g = mh.load_base()['groups']
    amt = float(prm['amount'])
    rim = float(prm.get('rim', 0.001))
    up_, down = float(prm.get('up', 0.013)), float(prm.get('down', 0.016))
    med, lat = float(prm.get('medial', 0.0015)), float(prm.get('lateral', 0.006))
    step = float(prm.get('step', 0.00025))
    for sd in ('l', 'r'):
        sg = 1.0 if sd == 'l' else -1.0
        pc = face.eye_centre(V, sd)
        upr, lor = face.lash_roots(V, sd)
        ring = face.aperture_ring(V, sd)
        ko, ki = V[list(face.canthi(sd))]
        gx, gz, D = _ray_grid(B, pc, -0.040, 0.040, -0.040, 0.035, step, cut=None)   # (the opening's own
        # samples never reach the band: 'rim' is wider than the fill's 2-cell reach)
        X, Z = np.meshgrid(gx, gz, indexing='ij')
        lx = sg * (X - pc[0])                                  # (lateral +)
        # the margins' heights across, held level past the corners
        Mu, Ml = V[upr], V[lor]
        ou, ol = np.argsort(sg * Mu[:, 0]), np.argsort(sg * Ml[:, 0])
        zu = np.interp(lx, sg * (Mu[ou, 0] - pc[0]), Mu[ou, 2])
        zl = np.interp(lx, sg * (Ml[ol, 0] - pc[0]), Ml[ol, 2])
        xin, xout = sg * (ki[0] - pc[0]), sg * (ko[0] - pc[0])
        # out of the opening by 'rim' (front view): outside the loop and 'rim' from it; facing forward
        # (a depth-only fill is ill-posed where the skin faces sideways: the nose's side, the temple)
        inside = _inside(np.c_[X.ravel(), Z.ravel()], ring).reshape(X.shape)
        dist = distance_transform_edt(~inside) * step
        # (the opening's samples dropped: inside the loop, and near it any 3 mm behind the lash roots — by
        # the corners the loop, through the roots' ends, misses some of the opening, and rays there hit the
        # socket ~10 mm back; filled from the skin beside them)
        R = np.r_[Mu, Ml]; orr = np.argsort(R[:, 0])
        yr = np.interp(X, R[orr, 0], R[orr, 1])
        D = np.where(inside | ((dist < 0.003) & (D > yr + 0.003)), np.nan, D)
        Dk = D.copy()
        if np.isnan(Dk).any():
            _, ix = distance_transform_edt(np.isnan(Dk), return_indices=True)
            Dk = Dk[ix[0], ix[1]]
        gxz = np.gradient(Dk, step)
        fwd = 1 / np.sqrt(1 + gxz[0] ** 2 + gxz[1] ** 2) > float(prm.get('facing', 0.4))
        # (toward the nose: 'medial' at the corner's height, 'medial_low' from 'medial_dz' below it — the
        # skin under the inner corner (a dimple there), not the hollow beside the nose)
        mlo, mdz = float(prm.get('medial_low', med)), float(prm.get('medial_dz', 0.002))
        tl = np.clip((ki[2] - Z) / mdz, 0, 1)
        ul = float(prm.get('up_lateral', lat))              # (the upper band's lateral end, m past the outer corner)
        xmed = xin - (med + (mlo - med) * tl * tl * (3 - 2 * tl))   # (the band's medial edge, per row)
        band = (~inside) & (dist >= rim) & (Z <= zu + up_) & (Z >= zl - down) & \
            (lx >= xmed) & (lx <= xout + lat) & \
            ((Z <= zl + 0.5 * (zu - zl)) | (lx <= xout + ul))
        band &= fwd & ~np.isnan(D)
        band[:2] = band[-2:] = False; band[:, :2] = band[:, -2:] = False
        # the slopes matched at the band's outer edge only: at the rims' (the lids' roll-over) the values
        S = band | (~band & (dist >= rim + 2 * step))
        T = lam = None
        ch = prm.get('chord')
        if ch:   # (under the lower lid, the fill drawn toward the straight line from the lid's skin 'anchor'
            #  below its margin to the cheek 'span' below (the concept's profile: one plane from the lid into
            #  the cheek; filled freely, the skin sagged into a bowl toward the groove's lower wall) — toward
            #  the nose fading out 'medial' (m from the eye's centre: full, none), out past the outer corner by
            #  'lateral' (m: full, none)
            from scipy.interpolate import RegularGridInterpolator as RGI
            an, sp_ = float(ch.get('anchor', 0.0007)), float(ch.get('span', down))
            srf0 = RGI((gx, gz), Dk, bounds_error=False, fill_value=np.nan)
            Xc = X[:, 0]
            ya = srf0(np.c_[Xc, zl[:, 0] - an]); yc = srf0(np.c_[Xc, zl[:, 0] - sp_])
            d = zl - Z
            chord = ya[:, None] + (yc - ya)[:, None] * np.clip((d - an) / (sp_ - an), 0, 1)
            m0, m1 = ch.get('medial', (0.010, 0.016)); l0, l1 = ch.get('lateral', (xout, xout + lat))
            sm = lambda t: t * t * (3 - 2 * t)
            wx = (1 - sm(np.clip((-lx - m0) / (m1 - m0), 0, 1))) * (1 - sm(np.clip((lx - l0) / (l1 - l0), 0, 1)))
            wz = sm(np.clip((d - an) / 0.001, 0, 1)) * (d <= sp_)
            w = np.nan_to_num(wx * wz) * np.isfinite(chord)
            T = np.where(w > 0, Dk + w * (np.nan_to_num(chord) - Dk), Dk)
            roll_lo = float(ch.get('roll', 0.0))             # (a pretarsal roll: 'roll' m forward at 'roll_at'
            if roll_lo:                                        # below the margin — the concept's lit band)
                ra, rw = float(ch.get('roll_at', 0.002)), float(ch.get('roll_w', 0.0015))
                T = T - w * roll_lo * np.exp(-((d - ra) / rw) ** 2)
            k = 2 * np.pi / (float(ch.get('width', 0.0025)) / step)
            lam = w * k ** 4
            ml = float(ch.get('medial_lift', 0.0))           # (under the inner corner, toward the nose, the skin held
            if ml:                                             # at its own depth lifted 'medial_lift': past the chord's
                a0, a1, b0, b1 = ch.get('medial_lift_x', (0.008, 0.011, 0.015, 0.019))   # fade the free fill sagged
                wl = sm(np.clip((-lx - a0) / (a1 - a0), 0, 1)) * (1 - sm(np.clip((-lx - b0) / (b1 - b0), 0, 1)))
                wl = wl * sm(np.clip((d - an) / 0.001, 0, 1)) * (1 - sm(np.clip((d - 0.006) / 0.004, 0, 1)))
                wl = np.nan_to_num(wl)                         # (into the nasojugal hollow: a notch; m medial of the
                T = np.where(wl > 0, Dk - ml * wl, T)          # pupil: in, full, full, out)
                lam = np.maximum(lam, wl * k ** 4)
        chu = prm.get('chord_up')
        if chu:   # (the upper lid drawn toward a full lid: the line from the skin 'anchor' above the margin to the
            #  band's top ('span'), a preseptal fullness 'full' (m, forward) at 'full_at' above the margin (Gaussian
            #  'full_w'), a pretarsal roll 'roll' at 'roll_at' ('roll_w'); fading toward the nose ('medial') and
            #  past the outer corner ('lateral') as the lower term; 'width' sets its weight)
            from scipy.interpolate import RegularGridInterpolator as RGI
            an_u, top = float(chu.get('anchor', 0.0007)), float(chu.get('span', up_))
            srf0 = RGI((gx, gz), Dk, bounds_error=False, fill_value=np.nan)
            Xc = X[:, 0]
            ya = srf0(np.c_[Xc, zu[:, 0] + an_u]); yb = srf0(np.c_[Xc, zu[:, 0] + top])
            h = Z - zu
            line = ya[:, None] + (yb - ya)[:, None] * np.clip((h - an_u) / (top - an_u), 0, 1)
            full, fa, fw = float(chu.get('full', 0.0005)), float(chu.get('full_at', 0.0065)), float(chu.get('full_w', 0.0025))
            roll, ra, rw = float(chu.get('roll', 0.0)), float(chu.get('roll_at', 0.002)), float(chu.get('roll_w', 0.0012))
            tgt = line - full * np.exp(-((h - fa) / fw) ** 2) - roll * np.exp(-((h - ra) / rw) ** 2)
            m0, m1 = chu.get('medial', (0.010, 0.016)); l0, l1 = chu.get('lateral', (xout, xout + lat))
            sm = lambda t: t * t * (3 - 2 * t)
            wx = (1 - sm(np.clip((-lx - m0) / (m1 - m0), 0, 1))) * (1 - sm(np.clip((lx - l0) / (l1 - l0), 0, 1)))
            wz = sm(np.clip((h - an_u) / 0.001, 0, 1)) * (h <= top)
            w2 = np.nan_to_num(wx * wz) * np.isfinite(tgt)
            T2 = np.where(w2 > 0, Dk + w2 * (np.nan_to_num(tgt) - Dk), Dk)
            lam2 = w2 * (2 * np.pi / (float(chu.get('width', 0.003)) / step)) ** 4
            if T is None:
                T, lam = T2, lam2
            else:
                T = np.where(w2 > 0, T2, T); lam = np.maximum(lam, lam2)
        Df = _biharmonic(Dk, band, S, T, lam)
        dD = np.where(band, Df - Dk, 0.0)
        mr = float(prm.get('medial_ramp', 0.0))   # (the fill's amount ramped in from the band's medial edge over
        if mr:                                     #  'medial_ramp' m: cut off there, it left an edge in profile)
            tr = np.clip((lx - xmed) / mr, 0, 1); dD = dD * tr * tr * (3 - 2 * tr)
        dlt = RegularGridInterpolator((gx, gz), dD, bounds_error=False, fill_value=0.0)
        srf = RegularGridInterpolator((gx, gz), Dk, bounds_error=False, fill_value=np.nan)
        near = np.where((np.abs(B[:, 0] - pc[0]) < 0.040) & (B[:, 2] > pc[2] - 0.040) & (B[:, 2] < pc[2] + 0.035))[0]
        P = B[near][:, [0, 2]]
        vis = np.abs(B[near, 1] - srf(P)) < 0.0007                 # (on the visible skin)
        dy = amt * dlt(P) * vis
        kp = prm.get('medial_keep')   # (toward the nose the face's own tear trough kept by 'amount' (0..1):
        if kp:                        #  all of it medial of 'x'[0] (m from the eye's centre, lateral +), none
            k0, k1 = kp.get('x', (-0.012, -0.004))   # lateral of 'x'[1] — filled flush, the under-eye's medial
            t = np.clip((sg * (P[:, 0] - pc[0]) - k0) / (k1 - k0), 0, 1)   # edge stood out against the
            dy = dy * (1 - float(kp.get('amount', 0.5)) * (1 - t * t * (3 - 2 * t)))   # nose's side in profile)
        y = B[near, 1] + dy
        Eh = V[sorted(g[f'helper-{sd}-eye'])]; c = Eh.mean(0); r = np.linalg.norm(Eh - c, axis=1).mean()
        rho2 = (B[near, 0] - c[0]) ** 2 + (B[near, 2] - c[2]) ** 2
        lim = c[1] - np.sqrt(np.maximum(r * r - rho2, 0)) - 0.0006    # (0.6 mm in front of the eyeball)
        y = np.where((rho2 < r * r) & (dy != 0), np.minimum(y, np.maximum(lim, B[near, 1])), y)
        B[near, 1] = y
    V[:mh.BODY_VERTS] = B
    return V


def corner_relax(V, prm):
    """The skin at each eye's corners smoothed after the fill (_relax: Laplacian, full within 'r0' of the
    corner in the front view, none from 'r1', 'n' steps, kept in front of the eyeball): the fill leaves a
    'rim' collar of the model's own skin around the opening, creased at the outer corner. prm: {'n', 'r0',
    'r1', 'outer': 1, 'inner': 0}."""
    if not prm or not prm.get('n'):
        return V
    from . import face
    V = V.copy()
    g = mh.load_base()['groups']
    for sd in ('l', 'r'):
        c, rad = sphere(V[sorted(g[f'helper-{sd}-eye'])])
        ko, ki = face.canthi(sd)
        for flag, k in (('outer', ko), ('inner', ki)):
            if prm.get(flag, flag == 'outer'):
                _relax(V, V[k], c, rad, int(prm['n']), float(prm.get('r0', 0.002)), float(prm.get('r1', 0.0045)))
        lo = prm.get('below_inner')   # (the skin 'dz' below the inner corner and 'dx' toward the nose: the
        if lo:                        #  filled under-eye's turn into the nose's side, an edge in profile)
            sg = 1.0 if sd == 'l' else -1.0
            k0 = V[ki] + np.array([-sg * float(lo.get('dx', 0.0)), 0.0, -float(lo.get('dz', 0.008))])
            _relax(V, k0, c, rad, int(lo.get('n', 10)), float(lo.get('r0', 0.003)), float(lo.get('r1', 0.007)))
    return V


_nbr = None


def _vertex_neighbours():
    global _nbr
    if _nbr is None:
        nb = [set() for _ in range(mh.BODY_VERTS)]
        for f in mh.load_base()['F']:
            for a, b in zip(f, f[1:] + f[:1]):
                if a < mh.BODY_VERTS and b < mh.BODY_VERTS:
                    nb[a].add(b); nb[b].add(a)
        _nbr = [np.array(sorted(n), int) for n in nb]
    return _nbr


def _crease_curve(prm):
    """The crease's trace (sheet px) and its weight along it, with 'level_from' and 'tail' applied."""
    from . import face
    T = np.array(face.REF_EYE_CREASE, float)
    Wt = np.array(face.REF_EYE_CREASE_WEIGHT, float)
    lv, tail = prm.get('level_from'), float(prm.get('tail', 0.0))
    if lv:
        zl = np.interp(lv, T[:, 0], T[:, 1])
        T = T.copy(); T[:, 1] = np.where(T[:, 0] < lv, np.minimum(T[:, 1], zl), T[:, 1])
    if tail:
        T = np.r_[[[T[0, 0] - tail, T[0, 1]]], T]
        w0 = np.interp(T[1, 0], Wt[:, 0], Wt[:, 1])
        Wt = np.r_[[[T[0, 0], 0.0], [T[1, 0], max(w0, 0.8)]], Wt[Wt[:, 0] > T[1, 0]]]
    return T, Wt


def _crease_loop(V, prm):
    """The crease as the eyelid's own fold (lid_crease 'mode' 'loop'): a thin invagination where the pretarsal
    platform meets the passive preseptal skin, which overhangs it — not a groove. The mesh's edge path
    nearest the traced crease (lib/face.REF_EYE_CREASE) is laid onto it in the front view and set back
    'depth' (m); the row above it (the fold's lip) brought forward 'overhang' (m), the row below set back
    'below_k' of the depth (the pretarsal skin turning into the crease); by REF_EYE_CREASE_WEIGHT along it.
    A softer crease is a smaller one, not a wider one: its width stays one row of the mesh. Visible skin
    only, kept 0.6 mm in front of the eyeball; returns V (and leaves the path in _crease_loop.paths)."""
    from . import face
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    g = mh.load_base()['groups']
    dep, ov, bk = float(prm['depth']), float(prm.get('overhang', 0.0)), float(prm.get('below_k', 0.0))
    nb = _vertex_neighbours()
    el, er = face.eye_centre(V, 'l'), face.eye_centre(V, 'r')
    s, zp, cx = face._front_scale((el[0] - er[0]) * 100)
    T, Wt = _crease_curve(prm)
    _crease_loop.paths = {}
    for sd, pc in (('l', el), ('r', er)):
        sg = 1.0 if sd == 'l' else -1.0
        tx = (cx - T[:, 0]) * s / 100; tz = pc[2] + (zp - T[:, 1]) * s / 100     # (m from the midline)
        o = np.argsort(tx); tx, tz, tc = tx[o], tz[o], T[o, 0]
        zc = lambda x: np.interp(sg * x, tx, tz)
        wc = lambda x: np.interp(cx - sg * x * 100 / s, Wt[:, 0], Wt[:, 1], left=0.0, right=0.0)
        cand = np.zeros(mh.BODY_VERTS, bool)
        sx = sg * B[:, 0]
        cand[(sx > tx.min() - 0.0015) & (sx < tx.max() + 0.0015) & (np.abs(B[:, 2] - zc(B[:, 0])) < 0.0016) &
             (B[:, 1] < pc[1] - 0.004)] = True
        ci = np.where(cand)[0]
        xm = pc[0]
        s0 = ci[np.argmin(np.abs(B[ci, 2] - zc(B[ci, 0])) + 0.15 * np.abs(B[ci, 0] - xm))]
        path = [s0]
        for direc in (1.0, -1.0):
            cur, seen, side = s0, {s0}, []
            while True:
                n = [k for k in nb[cur] if cand[k] and k not in seen and direc * sg * (B[k, 0] - B[cur, 0]) > 0.0002]
                if not n:
                    break
                n = np.array(n)
                cost = np.abs(B[n, 2] - zc(B[n, 0])) - 0.15 * direc * sg * (B[n, 0] - B[cur, 0])
                cur = int(n[np.argmin(cost)]); seen.add(cur); side.append(cur)
            path = (path + side) if direc > 0 else (side[::-1] + path)
        path = np.array(path)
        _crease_loop.paths[sd] = path
        on = set(path.tolist())
        w = wc(B[path, 0])
        dy = np.zeros(mh.BODY_VERTS); dz = np.zeros(mh.BODY_VERTS)
        dz[path] = (zc(B[path, 0]) - B[path, 2]) * np.clip(w * 3, 0, 1)
        dy[path] = dep * w
        for v, wv in zip(path, w):
            for k in nb[v]:
                if k in on or not cand[k] and abs(B[k, 2] - zc(B[k, 0])) > 0.003:
                    continue
                if B[k, 2] > B[v, 2]:
                    dy[k] = min(dy[k], -ov * wv)
                elif bk:
                    dy[k] = max(dy[k], bk * dep * wv)
        B[:, 1] += dy; B[:, 2] += dz
        Eh = V[sorted(g[f'helper-{sd}-eye'])]; c = Eh.mean(0); r = np.linalg.norm(Eh - c, axis=1).mean()
        mv = np.where(dy != 0)[0]
        rho2 = (B[mv, 0] - c[0]) ** 2 + (B[mv, 2] - c[2]) ** 2
        lim = c[1] - np.sqrt(np.maximum(r * r - rho2, 0)) - 0.0006
        B[mv, 1] = np.where(rho2 < r * r, np.minimum(B[mv, 1], lim), B[mv, 1])
    V[:mh.BODY_VERTS] = B
    return V


def lid_crease(V, prm):
    """The upper lid's crease (a double eyelid), along the concept's (lib/face.REF_EYE_CREASE, front view):
    the skin set back 'depth' (m) at the crease, over 'below' (m, the pretarsal skin's side: a soft slope
    into it) and 'above' (m: the fold's edge, sharper), and the fold above it brought forward 'fold' (m),
    'fold_at' above the crease over 'fold_w'; along x by lib/face.REF_EYE_CREASE_WEIGHT (full mid-lateral,
    fading into both canthi), and out to the outer corner by 'fade' (sheet px: none, full). Subtle by design — the concept's reads stronger for its make-up (shadow in the crease, its lash
    tips' dashes), which the look adds. Visible skin only, kept 0.6 mm in front of the eyeball."""
    if not prm or not prm.get('depth'):
        return V
    if prm.get('mode') == 'loop':
        return _crease_loop(V, prm)
    if prm.get('mode') == 'detail':      # (on the subdivided surface: character/woman.subdivide)
        return V
    from . import face
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    g = mh.load_base()['groups']
    A, wb, wa = float(prm['depth']), float(prm.get('below', 0.0014)), float(prm.get('above', 0.0008))
    F, fa, fw = float(prm.get('fold', 0.0)), float(prm.get('fold_at', 0.0015)), float(prm.get('fold_w', 0.0012))
    el, er = face.eye_centre(V, 'l'), face.eye_centre(V, 'r')
    s, zp, cx = face._front_scale((el[0] - er[0]) * 100)
    T = np.array(face.REF_EYE_CREASE, float)
    Wt = np.array(face.REF_EYE_CREASE_WEIGHT, float)
    fade = prm.get('fade')
    lv, tail = prm.get('level_from'), float(prm.get('tail', 0.0))
    if lv:   # (lateral of column 'level_from' the fold runs level, not down the lid onto the outer corner — a
        #  natural crease's tail sweeps out toward the orbit's rim; followed down, it hooded the corner)
        zl = np.interp(lv, T[:, 0], T[:, 1])
        T = T.copy(); T[:, 1] = np.where(T[:, 0] < lv, np.minimum(T[:, 1], zl), T[:, 1])
    if tail:   # (and carried 'tail' sheet px past the trace's lateral end, fading)
        T = np.r_[[[T[0, 0] - tail, T[0, 1]]], T]
        w0 = np.interp(T[1, 0], Wt[:, 0], Wt[:, 1])
        Wt = np.r_[[[T[0, 0], 0.0], [T[1, 0], max(w0, 0.8)]], Wt[Wt[:, 0] > T[1, 0]]]
    for sd, pc in (('l', el), ('r', er)):
        sg = 1.0 if sd == 'l' else -1.0
        tx = (cx - T[:, 0]) * s / 100                         # (m from the midline: compared with sg * x)
        tz = pc[2] + (zp - T[:, 1]) * s / 100
        o = np.argsort(tx); tx, tz = tx[o], tz[o]
        near = np.where((sg * B[:, 0] > tx.min() - 0.003) & (sg * B[:, 0] < tx.max() + 0.003) &
                        (np.abs(B[:, 2] - pc[2] - 0.004) < 0.012) & (B[:, 1] < pc[1] - 0.004))[0]
        bx = sg * B[near, 0]
        zc = np.interp(bx, tx, tz)                             # (held level past the trace's ends)
        col = cx - sg * B[near, 0] * 100 / s                   # (the sheet column)
        we = np.interp(col, Wt[:, 0], Wt[:, 1], left=0.0, right=0.0)
        if fade:   # (toward the outer corner the fold fades out: carried down the lid to the corner, it hooded it)
            tf = np.clip((col - fade[0]) / (fade[1] - fade[0]), 0, 1)
            we = we * tf * tf * (3 - 2 * tf)
        t = B[near, 2] - zc
        prof = A * np.where(t < 0, np.exp(-(t / wb) ** 2), np.exp(-(t / wa) ** 2)) - F * np.exp(-((t - fa) / fw) ** 2)
        y = B[near, 1] + we * prof
        Eh = V[sorted(g[f'helper-{sd}-eye'])]; c = Eh.mean(0); r = np.linalg.norm(Eh - c, axis=1).mean()
        rho2 = (B[near, 0] - c[0]) ** 2 + (B[near, 2] - c[2]) ** 2
        lim = c[1] - np.sqrt(np.maximum(r * r - rho2, 0)) - 0.0006
        y = np.where(rho2 < r * r, np.minimum(y, np.maximum(lim, B[near, 1])), y)
        B[near, 1] = y
    V[:mh.BODY_VERTS] = B
    return V


def _undereye_chord(V, prm):
    """The skin under the lower lid set in depth (the front view stays) toward the straight line, in
    each vertical column, from the lower lid's margin (its lash roots; or the skin 'anchor' m below them)
    to the cheek 'span' (m) below it,
    by 'flat' (0..1): the lid's roll flattened and the groove under it filled — one plane from the lid
    into the cheek, as the concept's profile runs. Fully from 1.5 to 10 mm below the margin, none within
    0.5 mm of it ('ramp': those two) or from 13 mm; within 1.4 cm out from the pupil, none from 2 cm, and toward the nose within
    'medial' (m: full, none; default 5 and 9 mm — the cheek below the inner corner is the tear trough's,
    deeper: the line to it hollowed the skin under the corner); the front surface only,
    kept 0.6 mm in front of the eyeball. (Relaxing the skin instead — averaging toward its neighbours
    with the margin held — pulled the roll back under a rim that stayed: a ledge over a trench.)
    The cheek's depth is read off the front surface interpolated smoothly (not single vertices)."""
    from scipy.interpolate import LinearNDInterpolator
    from . import face
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    flat, span = float(prm['flat']), float(prm.get('span', 0.014))
    g = mh.load_base()['groups']
    sm = lambda t: t * t * (3 - 2 * t)
    for sd in ('l', 'r'):
        pc = face.eye_centre(V, sd)
        _, lo = face.lash_roots(V, sd)
        M = V[lo]; o = np.argsort(M[:, 0])
        zm = np.interp(B[:, 0], M[o, 0], M[o, 2]); ym = np.interp(B[:, 0], M[o, 0], M[o, 1])
        d = zm - B[:, 2]                                   # (m below the margin)
        rel = B - pc
        d0, d1 = prm.get('ramp', (0.0005, 0.0015))           # (the weight's ramp below the margin)
        t1 = np.clip((d - d0) / (d1 - d0), 0, 1); t2 = np.clip((d - 0.010) / 0.003, 0, 1)
        t3 = np.clip((np.abs(rel[:, 0]) - 0.014) / 0.006, 0, 1)
        m0, m1 = prm.get('medial', (0.005, 0.009))
        f0, f1 = prm.get('medial_fill', (m0, m1))           # (filling forward reaches further toward the nose
        sg = 1.0 if sd == 'l' else -1.0                     # than digging back: below the inner corner the
        t4 = np.clip((-sg * rel[:, 0] - m0) / (m1 - m0), 0, 1)          # line runs to the tear trough)
        t4f = np.clip((-sg * rel[:, 0] - f0) / (f1 - f0), 0, 1)
        front = rel[:, 1] < -0.008
        w0 = sm(t1) * (1 - sm(t2)) * (1 - sm(t3)) * front * (np.abs(rel[:, 0]) < 0.03)
        w, wf = w0 * (1 - sm(t4)), w0 * (1 - sm(t4f))
        sel = np.where(np.maximum(w, wf) > 0)[0]
        if not len(sel):
            continue
        # the front surface around and below the eye, as a smooth depth field over (x, z)
        box = front & (np.abs(rel[:, 0]) < 0.035) & (rel[:, 2] > -0.04) & (rel[:, 2] < 0.004)
        surf = _front_surface(B, pc) if prm.get('surface') == 'ray' else             LinearNDInterpolator(B[box][:, [0, 2]], B[box, 1])   # ('ray': the visible skin, ray-cast)
        yc = surf(np.c_[B[sel, 0], zm[sel] - span])
        rim = float(prm.get('anchor', 0.0))                   # (the chord from the skin 'anchor' m below the
        if rim:                                               # margin: the lash roots sit behind the skin's rim,
            ya, da = surf(np.c_[B[sel, 0], zm[sel] - rim]), d[sel] - rim   # 0.7 mm at the pupil, 1.8 mm 9 mm
        else:                                                 # out — a chord from them pulled the band below
            ya, da = ym[sel], d[sel]                          # back under the rim: a crease)
        ok = np.isfinite(yc) & np.isfinite(ya)
        sel, yc, ya, da = sel[ok], yc[ok], ya[ok], da[ok]
        chord = ya + (yc - ya) * np.clip(da, 0, None) / (span - rim)
        dy = chord - B[sel, 1]                                # (+: back, -: forward)
        y = B[sel, 1] + flat * np.where(dy < 0, wf[sel], w[sel]) * dy
        Eh = V[sorted(g[f'helper-{sd}-eye'])]; c = Eh.mean(0); r = np.linalg.norm(Eh - c, axis=1).mean()
        rho2 = (B[sel, 0] - c[0]) ** 2 + (B[sel, 2] - c[2]) ** 2
        inside = rho2 < r * r
        lim = c[1] - np.sqrt(np.maximum(r * r - rho2, 0)) - 0.0006    # (0.6 mm in front of the eyeball)
        y = np.where(inside, np.minimum(y, np.maximum(lim, B[sel, 1])), y)
        B[sel, 1] = y
    V[:mh.BODY_VERTS] = B
    return V


def _undereye_relax(V, prm):
    """The skin between the lower lid and the cheek smoothed in depth only (the front view stays):
    the lid's roll and the groove under it — the model's lower lids are fuller than the concept's,
    which run flat into the cheek — relaxed 'n' times ('flat': 0..1 of each step), fully from 2 mm
    below the lower lid's margin to 9 mm, none within 1 mm of it or from 15 mm (the cheek), within
    1.4 cm across the pupil, none from 2 cm."""
    global _edges
    if not prm or not prm.get('flat'):
        return V
    from . import face
    if _edges is None:
        F = mh.load_base()['F']
        e = set()
        for f in F:
            for a, b in zip(f, f[1:] + f[:1]):
                e.add((a, b) if a < b else (b, a))
        _edges = np.array(sorted(e), dtype=np.int64)
    E = _edges
    V = V.copy()
    n, flat = int(prm.get('n', 20)), float(prm['flat'])
    B = V[:mh.BODY_VERTS]
    w = np.zeros(mh.BODY_VERTS)
    for sd in ('l', 'r'):
        pc = face.eye_centre(V, sd)
        _, lo = face.lash_roots(V, sd)
        M = V[lo]
        rel = B - pc
        # below the margin: the height under the lower lid's margin at each vertex's x
        o = np.argsort(M[:, 0])
        zm = np.interp(B[:, 0], M[o, 0], M[o, 2])
        d = zm - B[:, 2]
        t1 = np.clip((d - 0.001) / 0.001, 0, 1)
        t2 = np.clip((d - 0.009) / 0.006, 0, 1)
        t3 = np.clip((np.abs(rel[:, 0]) - 0.014) / 0.006, 0, 1)
        ww = (t1 * t1 * (3 - 2 * t1)) * (1 - t2 * t2 * (3 - 2 * t2)) * (1 - t3 * t3 * (3 - 2 * t3))
        ww *= (rel[:, 1] < 0.004) & (np.abs(rel[:, 0]) < 0.03)
        w = np.maximum(w, ww)
    sel = w > 0
    Es = E[sel[E[:, 0]] | sel[E[:, 1]]]
    y = B[:, 1].copy()
    # (the lids stay on the eyeball: no nearer than 0.6 mm in front of it, as the eye is built —
    # character/woman.add_eyes: the helper's mean, its mean radius)
    g = mh.load_base()['groups']
    cap = np.full(mh.BODY_VERTS, np.inf)
    for sd in ('l', 'r'):
        Eh = V[sorted(g[f'helper-{sd}-eye'])]
        c = Eh.mean(0)
        r = np.linalg.norm(Eh - c, axis=1).mean()
        rho2 = (B[:, 0] - c[0]) ** 2 + (B[:, 2] - c[2]) ** 2
        inside = (rho2 < r * r) & sel
        cap[inside] = np.minimum(cap[inside], c[1] - np.sqrt(r * r - rho2[inside]) - 0.0006)
    cap = np.maximum(cap, np.where(np.isfinite(cap), B[:, 1], np.inf))    # (skin already nearer stays)
    for _ in range(n):
        acc = np.zeros(mh.BODY_VERTS); cnt = np.zeros(mh.BODY_VERTS)
        np.add.at(acc, Es[:, 0], y[Es[:, 1]]); np.add.at(acc, Es[:, 1], y[Es[:, 0]])
        np.add.at(cnt, Es[:, 0], 1); np.add.at(cnt, Es[:, 1], 1)
        avg = np.where(cnt > 0, acc / np.maximum(cnt, 1), y)
        y = np.minimum(y + flat * w * (avg - y), cap)
    V[:mh.BODY_VERTS, 1] = y
    return V


def uplid(V, prm):
    """The upper lid's pretarsal roll flattened, as the lower lid's (_undereye_chord): the skin from 'ramp'
    above the upper margin (its lash roots) to 10 mm, fading by 13 mm, set in depth toward the straight
    line, per vertical column, from the skin 'anchor' m above the margin to the skin 'span' m above it, by
    'flat' (0..1); a recess 'sulcus' (m, back) at 'hs' above the margin, 3 mm wide, if any — the concept's
    lid recedes from the lashes to its sulcus, where the model's rolled forward 1.7 mm over them; within
    1.4 cm out from the pupil, none from 2 cm; the front surface only ('surface' 'ray': the visible skin,
    ray-cast; else the vertices interpolated); kept 0.6 mm in front of the eyeball."""
    if not prm or not prm.get('flat'):
        return V
    from scipy.interpolate import LinearNDInterpolator
    from . import face
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    flat, span = float(prm['flat']), float(prm.get('span', 0.014))
    anchor = float(prm.get('anchor', 0.0007)); h0, h1 = prm.get('ramp', (0.0007, 0.0025))
    sulcus, hs = float(prm.get('sulcus', 0.0)), float(prm.get('hs', 0.006))
    g = mh.load_base()['groups']
    sm = lambda t: t * t * (3 - 2 * t)
    for sd in ('l', 'r'):
        pc = face.eye_centre(V, sd)
        up, _ = face.lash_roots(V, sd)
        M = V[up]; o = np.argsort(M[:, 0])
        zm = np.interp(B[:, 0], M[o, 0], M[o, 2])
        h = B[:, 2] - zm                                   # (m above the margin)
        rel = B - pc
        t1 = np.clip((h - h0) / (h1 - h0), 0, 1); t2 = np.clip((h - 0.010) / 0.003, 0, 1)
        t3 = np.clip((np.abs(rel[:, 0]) - 0.014) / 0.006, 0, 1)
        front = rel[:, 1] < -0.008
        w = sm(t1) * (1 - sm(t2)) * (1 - sm(t3)) * front * (np.abs(rel[:, 0]) < 0.03)
        sel = np.where(w > 0)[0]
        if not len(sel):
            continue
        box = front & (np.abs(rel[:, 0]) < 0.035) & (rel[:, 2] > -0.01) & (rel[:, 2] < 0.04)
        surf = _front_surface(B, pc) if prm.get('surface') == 'ray' else             LinearNDInterpolator(B[box][:, [0, 2]], B[box, 1])
        ya = surf(np.c_[B[sel, 0], zm[sel] + anchor]); yb = surf(np.c_[B[sel, 0], zm[sel] + span])
        ok = np.isfinite(ya) & np.isfinite(yb)
        sel, ya, yb = sel[ok], ya[ok], yb[ok]
        hh = h[sel]
        target = ya + (yb - ya) * np.clip(hh - anchor, 0, None) / (span - anchor)
        if sulcus:
            target = target + sulcus * np.exp(-((hh - hs) / 0.003) ** 2)
        y = B[sel, 1] + flat * w[sel] * (target - B[sel, 1])
        Eh = V[sorted(g[f'helper-{sd}-eye'])]; c = Eh.mean(0); r = np.linalg.norm(Eh - c, axis=1).mean()
        rho2 = (B[sel, 0] - c[0]) ** 2 + (B[sel, 2] - c[2]) ** 2
        inside = rho2 < r * r
        lim = c[1] - np.sqrt(np.maximum(r * r - rho2, 0)) - 0.0006
        y = np.where(inside, np.minimum(y, np.maximum(lim, B[sel, 1])), y)
        B[sel, 1] = y
    V[:mh.BODY_VERTS] = B
    return V


def lid_warp(V, prm):
    """The eyes' openings resized: the lids and the skin around them scaled about each eyeball's
    centre in the front view ('w' across, 'h' up and down) and turned ('tilt', degrees: the outer
    corner up +), and shortened from the outer corner ('len': the fraction lateral of the pupil
    drawn in; the inner corner stays; 'inner': the inner corner drawn toward the nose, m), fully within
    1.2 cm of the centre and
    fading out by 2.2 cm, the lids sliding over the eyeball (they keep their distance from its
    centre, so they stay on it); the lashes and the lid joints go with them. The model's real
    faces have smaller openings than the concept's large eyes."""
    if not prm:
        return V
    V = V.copy()
    g = mh.load_base()['groups']
    sw, sh = prm.get('w', 1.0), prm.get('h', 1.0)
    ta = np.radians(prm.get('tilt', 0.0))
    for sd in ('l', 'r'):
        c, rad = sphere(V[sorted(g[f'helper-{sd}-eye'])])
        idx = np.r_[np.arange(mh.BODY_VERTS), sorted(g[f'helper-{sd}-eyelashes-1']),
                    sorted(g[f'helper-{sd}-eyelashes-2']), sorted(g.get(f'joint-{sd}-upperlid', [])),
                    sorted(g.get(f'joint-{sd}-lowerlid', []))].astype(int)
        rel = V[idx] - c
        dxz = np.hypot(rel[:, 0], rel[:, 2])
        sel = (dxz < 0.022) & (rel[:, 1] < 0.012)
        t = np.clip((dxz[sel] - 0.012) / 0.010, 0, 1)
        w = 1 - t * t * (3 - 2 * t)
        q = rel[sel].copy()
        r0 = np.linalg.norm(q, axis=1)
        q[:, 0] *= 1 + w * (sw - 1)
        q[:, 2] *= 1 + w * (sh - 1)
        if ta:     # (the canthal tilt: the opening turned in the front view, the outer corner up +)
            a = w * ta * (1 if sd == 'l' else -1)
            x, z = q[:, 0].copy(), q[:, 2].copy()
            q[:, 0], q[:, 2] = x * np.cos(a) - z * np.sin(a), x * np.sin(a) + z * np.cos(a)
        on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * w      # on the eyeball (the lids): slide over it
        y2 = np.sign(q[:, 1]) * np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
        q[:, 1] += on * (y2 - q[:, 1])
        V[idx[sel]] = c + q
        ln = prm.get('len', 0.0)
        if ln:   # (the opening shortened from its outer corner: lateral of the pupil, the lids and the
            #  skin around them drawn toward it — full to 2 cm out, none from 3.2 cm; within 6 mm up and
            #  down, none from 14 mm: the inner corner, the brow and the cheek stay)
            rel = V[idx] - c
            sg = 1 if sd == 'l' else -1
            xl = sg * rel[:, 0]
            t = np.clip((xl - 0.020) / 0.012, 0, 1)
            wl = 1 - t * t * (3 - 2 * t)
            t = np.clip((np.abs(rel[:, 2]) - 0.006) / 0.008, 0, 1)
            wv = 1 - t * t * (3 - 2 * t)
            wv *= rel[:, 1] < 0.006
            q = rel.copy()
            q[:, 0] -= sg * ln * np.maximum(xl, 0) * wl * wv
            # (on the eyeball, the lids slide over it as they're drawn in: their distance from its
            # centre kept — drawn straight in, the tissue at its side would sink into it)
            r0 = np.linalg.norm(rel, axis=1)
            on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * (np.abs(q[:, 0] - rel[:, 0]) > 0)
            y2 = np.sign(q[:, 1]) * np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
            q[:, 1] += on * (y2 - q[:, 1])
            V[idx] = c + q
        inn = prm.get('inner', 0.0)
        if inn:   # (the inner corner drawn toward the nose, m: the model's lash roots end 2.4 mm short of the
            #  concept's corner, its opening with them — the skin, the roots and the lashes within 1.5 mm of
            #  the medial roots' end (front view), none from 7 mm, sliding over the eyeball)
            from . import face
            upr, lor = face.lash_roots(V, sd)
            sg = 1 if sd == 'l' else -1
            e = (V[upr][np.argmin(sg * V[upr][:, 0])] + V[lor][np.argmin(sg * V[lor][:, 0])]) / 2
            rel = V[idx] - c
            t = np.clip((np.hypot(V[idx][:, 0] - e[0], V[idx][:, 2] - e[2]) - 0.0015) / 0.0055, 0, 1)
            wi = (1 - t * t * (3 - 2 * t)) * (rel[:, 1] < 0.006)
            q = rel.copy()
            q[:, 0] -= sg * inn * wi
            r0 = np.linalg.norm(rel, axis=1)
            on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * (wi > 0)
            y2 = np.sign(q[:, 1]) * np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
            q[:, 1] += on * (y2 - q[:, 1])
            # (off the eyeball, the skin slides along its own surface — the front skin's depth over the
            # front view, sampled before and after: drawn straight across, it piled up beside the corner)
            from scipy.interpolate import LinearNDInterpolator
            sk = (idx < mh.BODY_VERTS) & (rel[:, 1] < 0.006) & (r0 > rad + 0.0015) & \
                 (np.hypot(rel[:, 0] - (e - c)[0], rel[:, 2] - (e - c)[2]) < 0.012)
            surf = LinearNDInterpolator(rel[sk][:, [0, 2]], rel[sk, 1])
            mv = (wi > 0) & (idx < mh.BODY_VERTS) & (on < 1)
            dy = surf(q[mv][:, [0, 2]]) - surf(rel[mv][:, [0, 2]])
            q[mv, 1] += (1 - on[mv]) * np.nan_to_num(dy)
            V[idx] = c + q
        up = prm.get('up', 0.0)
        if up:   # (the upper lid lowered, m: above the eyeball's centre — full from 3 to 7 mm up, none at
            #  its height or from 13 mm up (the brow); within 6 mm across, none from 14 mm — sliding
            #  over the eyeball)
            rel = V[idx] - c
            zu = rel[:, 2]
            wz = np.clip(zu / 0.003, 0, 1) * (1 - np.clip((zu - 0.007) / 0.006, 0, 1))
            t = np.clip((np.abs(rel[:, 0]) - 0.006) / 0.008, 0, 1)
            wz = wz * wz * (3 - 2 * wz) * (1 - t * t * (3 - 2 * t)) * (rel[:, 1] < 0.006)
            q = rel.copy()
            q[:, 2] -= up * wz
            r0 = np.linalg.norm(rel, axis=1)
            on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * (wz > 0)
            y2 = np.sign(q[:, 1]) * np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
            q[:, 1] += on * (y2 - q[:, 1])
            V[idx] = c + q
        lo = prm.get('lo', 0.0)
        if lo:   # (the lower lid raised, m: below the eyeball's centre — full from 4 to 8 mm down, none at
            #  its height or from 16 mm down (the cheek); within 5 mm across, none from 14 mm (the
            #  canthi stay) — sliding over the eyeball)
            rel = V[idx] - c
            zd = -rel[:, 2]
            wz = np.clip(zd / 0.004, 0, 1) * (1 - np.clip((zd - 0.008) / 0.008, 0, 1))
            t = np.clip((np.abs(rel[:, 0]) - 0.005) / 0.009, 0, 1)
            wz = wz * wz * (3 - 2 * wz) * (1 - t * t * (3 - 2 * t)) * (rel[:, 1] < 0.006)
            q = rel.copy()
            q[:, 2] += lo * wz
            r0 = np.linalg.norm(rel, axis=1)
            on = np.clip((rad + 0.005 - r0) / 0.003, 0, 1) * (wz > 0)
            y2 = np.sign(q[:, 1]) * np.sqrt(np.maximum(r0 ** 2 - q[:, 0] ** 2 - q[:, 2] ** 2, 0))
            q[:, 1] += on * (y2 - q[:, 1])
            V[idx] = c + q
    return V


def gaze(coeffs, side, reg=None):
    """The model's gaze for an eye (a unit vector, the MakeHuman frame): from its eyeball's centre
    through its iris, as the scans hold it — the lids were shaped around this eyeball pose (the
    neutral eyes look ~6 degrees outward), so our eyeballs take it rather than straight ahead."""
    reg = reg or registration()
    I = shape(coeffs)
    c, _ = sphere(I[slice(*SCLERA[side])])
    d = reg['R'] @ (I[slice(*IRIS[side])].mean(0) - c)
    return d / np.linalg.norm(d)


def ear_warp(V, prm, reg=None):
    """The ears resized and placed as a whole (their shape stays the model's): per ear, about its
    root (the front quarter of the ear), scale (uniform, 'scale'; extra vertically, 'vert'),
    tilt ('rot', degrees, top back +), swing out from the head ('wing', degrees, + out) and move
    ('dy' back +, 'dz' up +, metres); the head around the ear follows over 1.2 cm.
    prm: {'scale', 'vert', 'rot', 'wing', 'dy', 'dz'} (both ears, mirrored)."""
    if not prm:
        return V
    from scipy.spatial import cKDTree
    V = V.copy()
    B = V[:mh.BODY_VERTS]
    sc, vert = prm.get('scale', 1.0), prm.get('vert', 1.0)
    a = np.radians(prm.get('rot', 0.0))
    Rx = np.array([[1, 0, 0], [0, np.cos(a), np.sin(a)], [0, -np.sin(a), np.cos(a)]])   # (a > 0: the top goes back, +y)
    b = np.radians(prm.get('wing', 0.0))
    d = np.array([0.0, prm.get('dy', 0.0), prm.get('dz', 0.0)])
    for side in ('l', 'r'):
        sg = 1 if side == 'l' else -1       # the wing: about the vertical at the root (b > 0: the back out)
        Rz = np.array([[np.cos(b), sg * np.sin(b), 0], [-sg * np.sin(b), np.cos(b), 0], [0, 0, 1]])
        e = mh_ears(side, reg)
        y = B[e, 1]
        pivot = B[e[y <= np.percentile(y, 25)]].mean(0)
        near = np.where(np.linalg.norm(B - pivot, axis=1) < 0.08)[0]
        dist, _ = cKDTree(B[e]).query(B[near])
        w = np.clip(1 - dist / 0.012, 0, 1)
        w = w * w * (3 - 2 * w)
        q = (B[near] - pivot) * [sc, sc, sc * vert]
        T = pivot + q @ Rx.T @ Rz.T + d
        B[near] += w[:, None] * (T - B[near])
    V[:mh.BODY_VERTS] = B
    return V


def sphere(P):
    """Least-squares sphere through the points P: (centre, radius). (The model's sclera is not
    centred on its mean: the cornea's bulge and the denser front put the mean ~4.5 mm forward.)"""
    A = np.c_[2 * P, np.ones(len(P))]
    x = np.linalg.lstsq(A, (P ** 2).sum(1), rcond=None)[0]
    return x[:3], float(np.sqrt(x[3] + x[:3] @ x[:3]))


def _menton(B):
    """The menton's vertex on the MakeHuman body B (the midline profile's)."""
    midl = np.where(np.abs(B[:, 0]) < 1e-4)[0]
    top = B[:, 2].max()
    midl = midl[B[midl, 2] > top - 0.35]
    ez = top - 0.11    # the eyes are ~11 cm below the vertex
    return _profile(B, midl, ez)['menton']
