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


def eye_system(V, prm):
    """The eye as one system: each globe resized to 'r' (m) — the model's eyeball shell is ~16 mm,
    anatomical globes ~11.5-12.5 mm: a globe that large fills the socket and pushes the lids out onto
    its front — its front kept at the pupil and set back by 'back' (m); the lids and the skin around
    them settle onto the new globe in depth only: each keeps its offset from the globe's surface and
    its place in the front view (the aperture's traced outline stays), so the lids wrap the smaller
    globe and its corners go back — the lateral canthus toward the concept's, 2 cm behind the upper
    lid's front. Beyond the globe's outline (where the canthi are) the surface continues along its
    tangent, 'wrap' steepening it. The skin within 2 mm of the old globe goes all the way, none
    from 8 mm above the pupil (the orbital rim and the brow stay) or 12 mm below it, nor lateral of
    2.4 cm from the eye's axis; the lashes follow their roots, the lid joints the skin."""
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
        c1 = c0 + np.array([0.0, (r1 - r0) + back, 0.0])      # (the front at the pupil, set back by 'back')

        def dy(P):
            rel = P - c0
            d0 = np.maximum(np.linalg.norm(rel, axis=1) - r0, -0.004)
            rho = np.hypot(rel[:, 0], rel[:, 2])
            below = np.clip(-rel[:, 2] / 0.004, 0, 1)
            t = np.clip((d0 - 0.002) / (0.006 + 0.004 * below), 0, 1)
            w = 1 - t * t * (3 - 2 * t)
            t = np.clip((rho - 0.018) / 0.006, 0, 1)
            w *= 1 - t * t * (3 - 2 * t)
            w *= rel[:, 1] < 0.004                               # (in front of the globe's centre)
            return w * (front_depth(rho, r1 + d0, c1[1]) - front_depth(rho, r0 + d0, c0[1]))
        B = V[:mh.BODY_VERTS]
        near = np.where(np.linalg.norm(B - c0, axis=1) < r0 + 0.02)[0]
        V[near, 1] += dy(B[near])
        for k in (1, 2):
            gi = np.array(sorted(g[f'helper-{sd}-eyelashes-{k}']))
            d = np.linalg.norm(V[gi] - c0, axis=1)
            root = gi[d < d.min() + 0.33 * (d.max() - d.min())]
            _, jj = cKDTree(V[root]).query(V[gi])
            V[gi, 1] += dy(V[root])[jj]
        for grp in (f'joint-{sd}-upperlid', f'joint-{sd}-lowerlid'):
            gi = np.array(sorted(g.get(grp, [])), int)
            if len(gi):
                _, jj = cKDTree(B[near]).query(V[gi])
                V[gi, 1] += dy(B[near][jj])
        V[e] = c1 + (V[e] - c0) * (r1 / r0)
        j = np.array(sorted(g[f'joint-{sd}-eye']))
        V[j] += c1 - c0
    return V


def lid_warp(V, prm):
    """The eyes' openings resized: the lids and the skin around them scaled about each eyeball's
    centre in the front view ('w' across, 'h' up and down) and turned ('tilt', degrees: the outer
    corner up +), fully within 1.2 cm of the centre and
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
