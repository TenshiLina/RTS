"""Facial landmarks: ours from the MakeHuman mesh, the concept's from its close-ups.

Ours are fixed vertices (the topology never changes, so a vertex is the same anatomical point
under every modifier) — found as the vertices MakeHuman's own feature targets move most (the
mouth corner is what mouth-scale-horiz moves, the alar wing what nostrils-width moves, ...) —
plus the eyeball helper's centre (the pupil) and extrema of the midline profile.

Coordinates: centimetres relative to the left pupil's height and the midline, x = lateral
(front view), y = forward-negative depth (profile), z = up. The concept's are measured on the
sheet's close-ups (front: pupils 1274/1344 at row 282.5; profile: the eye's front 1217.5 — the
upper lid's margin and lash line, the eye's visible front in profile — at the pupils' row 715) and scaled so
its interpupillary distance equals ours (the proportions are the design; the absolute size is
ours, which is anthropometric).
"""
import os
import numpy as np
from . import mh

_ears = None


def ear_vertices():
    """Vertices of the ears (those any MakeHuman ear target moves)."""
    global _ears
    if _ears is None:
        idx = set()
        d = os.path.join(mh.MH, 'targets', 'ears')
        for f in os.listdir(d):
            i, _ = mh.read_target(os.path.join(d, f))
            idx.update(int(k) for k in i if k < mh.BODY_VERTS)
        _ears = np.array(sorted(idx))
    return _ears

# vertex indices (left side; the right is the mirror)
V_MOUTH_CORNER = 7128      # mouth-scale-horiz
V_ALAR = 7099              # nose-nostrils-width
V_EYE_OUTER = 6809         # l-eye-corner1
V_EYE_INNER = 6856         # l-eye-corner2
V_CHIN_SIDE = 11778        # chin-width
V_CHEEKBONE = 11788        # l-cheek-bones
V_LIP_TOP = 362            # mouth-upperlip-height: the upper lip's vermilion border (midline)
V_LIP_BOTTOM = 7241        # mouth-lowerlip-height: the lower lip's vermilion border

# the concept, front close-up (sheet px) and profile close-up (sheet px)
REF_FRONT = {'pupil_l': (1274, 282.5), 'pupil_r': (1344, 282.5), 'mid_x': 1309,
             'eye_outer': (1260.0, 286.5), 'eye_inner': (1290, 288.75),
             # lid margins: the drawn aperture less the liner and lashes (~1.5 px each)
             'lid_upper': (1274, 277.75), 'lid_lower': (1274, 289.75),
             'brow_low': (1274, 261.25), 'alar': (1291.25, 331.25), 'nose_tip': (1310, 322.5),
             'subnasale': (1310, 336.25), 'mouth_corner': (1285.2, 359.5), 'lip_top': (1310, 350.5),
             'stomion': (1310, 358), 'lip_bottom': (1310, 372.5), 'chin_side': (1293, 397),
             'menton': (1310, 402.5), 'gonion': (1250, 367),
             # face outline half-widths (px from the midline) by row
             'outline': [(300, 69), (320, 67), (340, 63.5), (350, 60.5), (360, 56), (367, 53.5)]}
REF_PROFILE = {'eye': (1217.5, 715), 'nose_tip': (1192, 750), 'subnasale': (1207, 769),
               'lip_top': (1206.25, 775), 'stomion': (1211.25, 781.25), 'lip_bottom': (1210.5, 787.5),
               'labiomental': (1220, 797.5), 'pogonion': (1219.5, 810), 'menton': (1226, 818.75),
               'nasion': (1205, 710), 'glabella': (1203.5, 697), 'tragus': (1310, 730)}


def ref_landmarks(ipd_cm):
    """The concept's landmarks in cm (see module doc), scaled to an interpupillary distance."""
    f = REF_FRONT
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])          # cm per front px
    zp = f['pupil_l'][1]
    fr = {k: ((v[0] - f['mid_x']) * s * -1, (zp - v[1]) * s) for k, v in f.items()
          if isinstance(v, tuple) and k not in ('pupil_l', 'pupil_r')}   # left side: x > 0
    fr['outline'] = [((zp - r) * s, hw * s) for r, hw in f['outline']]
    p = REF_PROFILE
    eye_chin_front = (f['menton'][1] - zp) * s
    sp = eye_chin_front / (p['menton'][1] - p['eye'][1])      # cm per profile px (eye-chin matches)
    pr = {k: ((v[0] - p['eye'][0]) * sp, (p['eye'][1] - v[1]) * sp) for k, v in p.items() if k != 'eye'}
    return fr, pr


_caps = {}


def eye_cap(side='l'):
    """The eyeball helper's front cap (its 8 frontmost vertices, a ring on the eye's forward axis:
    the pupil)."""
    if side not in _caps:
        b = mh.load_base()
        idx = np.array(sorted(b['groups'][f'helper-{side}-eye']))
        z = b['V'][idx, 2]                     # (MakeHuman's frame faces +Z)
        _caps[side] = idx[z > z.max() - 0.003]
    return _caps[side]


def eye_centre(V, side='l'):
    """The eye's centre for the face's frames: where the eyeball's centre is with the eye looking
    straight ahead — behind the pupil (the helper's front cap) by the cap's distance from the
    eyeball's centre. The face's frames are the pupil's, as the concept's are (the eyeball may sit
    elsewhere behind it)."""
    g = mh.load_base()['groups']
    c = V[sorted(g[f'helper-{side}-eye'])].mean(0)
    cap = V[eye_cap(side)].mean(0)
    return cap + np.array([0.0, np.linalg.norm(cap - c), 0.0])


def lid_front(V):
    """(the left eye's centre (eye_centre), the depth of the upper lid's front): the profile's depth
    origin — the eye's visible front in profile, the upper lid's skin at the pupil (the three
    frontmost points within 4 mm of its column, from its height to 6 mm above), as the concept's
    profile shows it (the iris itself is hidden behind the lid and the lashes there). (The lash
    strips' roots, less 1 mm, gave the same within 0.3 mm, but depend on the eyeball's centre.)"""
    eye = eye_centre(V)
    c = V[sorted(mh.load_base()['groups']['helper-l-eye'])].mean(0)
    B = V[:mh.BODY_VERTS]
    m = (np.abs(B[:, 0] - eye[0]) < 0.004) & (B[:, 2] > eye[2]) & (B[:, 2] < eye[2] + 0.006) & (B[:, 1] < c[1])
    return eye, np.sort(B[m, 1])[:3].mean()


def all_vertices(targets):
    """Every vertex (body and helpers) in the Blender frame, normalised to 1.68 m (the characters
    build theirs with their own rest_vertices)."""
    return mh.to_blender(mh.morphed(targets), 1.68)


def ours(V, pick=None):
    """Our landmarks (cm) from all vertices V (body + helpers): front {name: (x, z)}, profile
    {name: (y, z)}, relative to the left pupil (eye_centre; profile depths from the
    upper lid's front, lid_front). The profile points and lid
    margins are found as extrema; pass pick = ours(V0)[2] (their vertex indices on a reference
    shape) to evaluate them at fixed vertices instead — smooth in the shape, for fitting."""
    g = mh.load_base()['groups']
    c = V[sorted(g['helper-l-eye'])].mean(0)   # (the eyeball's own centre: the lash roots are on it)
    eye = eye_centre(V)
    eye_r = eye_centre(V, 'r')
    rel = lambda q: (q - [0, eye[1], eye[2]]) * 100
    # profile depths are taken from the upper lid's front (what the concept's profile shows of the eye)
    iris_y = lid_front(V)[1]
    fr, pr = {}, {}
    for name, vi in (('mouth_corner', V_MOUTH_CORNER), ('alar', V_ALAR), ('eye_outer', V_EYE_OUTER),
                     ('eye_inner', V_EYE_INNER), ('chin_side', V_CHIN_SIDE), ('cheekbone', V_CHEEKBONE)):
        q = rel(V[vi])
        fr[name] = (q[0], q[2])
    # the profile silhouette near the midline: the frontmost point per 1 mm of height
    B = V[:mh.BODY_VERTS]
    nidx = np.where((np.abs(B[:, 0]) < 0.005) & (B[:, 1] < eye[1] + 0.03) & (B[:, 2] > eye[2] - 0.14) & (B[:, 2] < eye[2] + 0.05))[0]
    near = B[nidx]
    zb = np.round((near[:, 2] - eye[2]) * 1000).astype(int)
    order = np.lexsort((near[:, 1], zb))
    first = np.r_[True, np.diff(zb[order]) != 0]
    mi = nidx[order][first]
    mi = mi[np.argsort(-B[mi, 2])]
    y, z = (B[mi, 1] - iris_y) * 100, (B[mi, 2] - eye[2]) * 100
    picked = {}

    def ext(z0, z1, fn, name=None):
        m = (z <= z0) & (z >= z1)
        i = np.where(m)[0][fn(y[m])]
        return (y[i], z[i]), mi[i]
    PROFILE_KEYS = ('nose_tip', 'subnasale', 'lip_top', 'stomion', 'lip_bottom', 'labiomental', 'pogonion',
                    'menton', 'nasion', 'glabella')
    if pick is not None:  # at the reference shape's vertices (smooth in the shape, for fitting)
        for k in PROFILE_KEYS:
            vi = pick[k]
            pr[k] = ((B[vi, 1] - iris_y) * 100, (B[vi, 2] - eye[2]) * 100)
    else:
        def put(name, res):
            pr[name], picked[name] = res
        put('nose_tip', ext(-2.0, -5.0, np.argmin))
        put('subnasale', ext(pr['nose_tip'][1] - 0.3, pr['nose_tip'][1] - 2.0, np.argmax))
        put('lip_top', ext(pr['subnasale'][1] - 0.3, pr['subnasale'][1] - 2.2, np.argmin))
        put('stomion', ext(pr['lip_top'][1] - 0.2, pr['lip_top'][1] - 1.5, np.argmax))
        put('lip_bottom', ext(pr['stomion'][1] - 0.2, pr['stomion'][1] - 1.5, np.argmin))
        put('labiomental', ext(pr['lip_bottom'][1] - 0.3, pr['lip_bottom'][1] - 2.2, np.argmax))
        put('pogonion', ext(pr['labiomental'][1] - 0.3, pr['labiomental'][1] - 2.5, np.argmin))
        below = (z < pr['pogonion'][1]) & (y < pr['pogonion'][0] + 1.5)
        i = np.where(below)[0][np.argmin(z[below])]
        pr['menton'], picked['menton'] = (y[i], z[i]), mi[i]
        put('nasion', ext(1.5, -1.0, np.argmax))
        put('glabella', ext(3.0, pr['nasion'][1] + 0.3, np.argmin))
    # front: the vertical landmarks at the midline (the lips' vermilion borders, not their profile)
    for k in ('nose_tip', 'subnasale', 'stomion', 'menton'):
        fr[k] = (0.0, pr[k][1])
    fr['lip_top'] = (0.0, (B[V_LIP_TOP, 2] - eye[2]) * 100)
    fr['lip_bottom'] = (0.0, (B[V_LIP_BOTTOM, 2] - eye[2]) * 100)
    fr['eye_z_abs'] = eye[2]
    fr['_ref'] = (eye, iris_y)
    fr['ipd'] = (eye[0] - eye_r[0]) * 100
    # face outline: the front silhouette of the head without the ears, half-width by height
    keep = np.ones(mh.BODY_VERTS, bool)
    keep[ear_vertices()] = False
    face = B[keep & (B[:, 0] > 0) & (B[:, 2] > eye[2] - 0.12)]
    fz = (face[:, 2] - eye[2]) * 100
    fr['outline_fn'] = lambda zc: face[np.abs(fz - zc) < 0.25, 0].max() * 100 if np.any(np.abs(fz - zc) < 0.25) else np.nan
    # lid margins at the pupil: the eyelash strips' roots (the vertex nearest the pupil's x)
    lids = []
    for grp in ('helper-l-eyelashes-1', 'helper-l-eyelashes-2'):
        if pick is not None and grp in pick:
            q = V[pick[grp]]
        else:
            gi = np.array(sorted(g.get(grp, [])))
            dist = np.linalg.norm(V[gi] - c, axis=1)
            root = gi[dist < np.percentile(dist, 40)]
            picked[grp] = root[np.argsort(np.abs(V[root, 0] - eye[0]))[:3]]
            q = V[picked[grp]]
        lids.append((q[:, 0].mean() * 100, (q[:, 2].mean() - eye[2]) * 100))
    lids.sort(key=lambda q: -q[1])
    fr['lid_upper'], fr['lid_lower'] = lids
    return fr, pr, picked


# ---- silhouettes against the backdrop (skin vs the grey background: no shading involved)
FRONT_BOX, PROFILE_BOX = (1175, 190, 1448, 470), (1180, 620, 1380, 860)
_skin = None


def _skin_mask():
    global _skin
    if _skin is None:
        from PIL import Image
        im = np.asarray(Image.open(os.path.join(os.path.dirname(__file__), '..', '..', '..',
                                                'docs/art/factions/human/human-female-turnaround.webp')).convert('RGB')).astype(int)
        _skin = (im[..., 0] - im[..., 2] > 22) & (im[..., 0] > 110)
    return _skin


def ref_silhouettes(ipd_cm):
    """The concept's silhouettes in cm: front half-width by height below the ears (the jaw's edge,
    then the neck's), the profile's front edge by height (nasion to the neck), and the jaw's
    underside by depth (chin to the neck). Front: relative to the pupils and the midline; profile:
    to the iris; scaled as ref_landmarks."""
    m = _skin_mask()
    f = REF_FRONT
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])
    zp = f['pupil_l'][1]
    cx = f['mid_x']
    front = []
    for r in range(336, 421):   # (from below the earlobes, which touch the jaw at 333-335, down the neck)
        ext = []
        for sg in (-1, 1):
            x, gap, last = cx + sg * 30, 0, cx + sg * 30   # (from beyond the mouth's corners: the lips aren't skin-coloured)
            while abs(x - cx) < 130:
                x += sg
                if m[r, x]:
                    last, gap = x, 0
                else:
                    gap += 1
                    if gap > 5:
                        break
            ext.append(abs(last - cx) + 0.5)
        front.append(((zp - r) * s, max(ext) * s))
    p = REF_PROFILE
    sp = ((f['menton'][1] - zp) * s) / (p['menton'][1] - p['eye'][1])
    ex, ey = p['eye']
    prof = []
    for r in range(662, 850):   # (from the forehead, below the hairline's strands, to the neck)
        xs = np.where(m[r, 1185:1300])[0]
        if len(xs):
            prof.append(((ey - r) * sp, (xs[0] + 1185 - 0.5 - ex) * sp))
    # the jaw's underside: per column between the chin and the neck's front, the lowest skin row
    # of the head (scanning down from the chin's height to the first background pixel)
    neck_x = np.where(m[850, 1185:1300])[0][0] + 1185
    chin_r = p['menton'][1]
    under = []
    for x in range(int(p['pogonion'][0]) + 4, neck_x - 3):
        col = m[int(chin_r) - 25:860, x]
        rr = np.where(~col)[0]
        if len(rr):
            under.append(((x - ex) * sp, (ey - (rr[0] + int(chin_r) - 25 - 0.5)) * sp))
    return front, prof, under


def our_silhouettes(V, front_z, prof_z, under_y, E=None):
    """Our silhouettes at the given heights / depths (cm, frames as ours()): front half-width
    (without the ears), profile front edge, jaw underside (lowest point of the head per depth,
    in front of the neck)."""
    from . import measure
    eye, iris_y = lid_front(V)            # (the profile's depth origin: the upper lid's front)
    B = V[:mh.BODY_VERTS]
    if E is None:
        E = measure.mesh_edges(mh.load_base()['F'])
    keep = np.ones(len(B), bool)
    keep[ear_vertices()] = False
    zs = eye[2] + np.asarray(front_z) / 100
    fw = [np.abs(q[np.abs(q[:, 0]) < 0.08, 0]).max() * 100 if np.any(np.abs(q[:, 0]) < 0.08) else np.nan
          for q in measure.sections(B, E, zs, keep)]   # (the head and neck, not the shoulders)
    zs = eye[2] + np.asarray(prof_z) / 100
    pf = [(q[:, 1].min() - iris_y) * 100 if len(q) else np.nan for q in measure.sections(B, E, zs, keep)]
    # jaw underside: cut the head by planes y = const (swap axes), take the lowest point in the
    # jaw's height range
    Bs = B[:, [0, 2, 1]]
    ys = iris_y + np.asarray(under_y) / 100
    un = []
    for q in measure.sections(Bs, E, ys, keep):
        q = q[(q[:, 1] < eye[2] - 0.06) & (q[:, 1] > eye[2] - 0.16) & (np.abs(q[:, 0]) < 0.03)]
        un.append((q[:, 1].min() - eye[2]) * 100 if len(q) else np.nan)
    return np.array(fw), np.array(pf), np.array(un)


# ---- feature outlines (front close-up): the lips' vermilion and the eyes' opening
# The concept's eye opening, traced along its lash lines (sheet px; the figure's right eye, seen on
# the left — mirrored to ours by symmetry): the upper lid's margin is the lower edge of the dark
# lash/liner band, the lower lid's the edge of the lower lash line; the liner's wing past the outer
# corner is make-up, not the opening. Corners: outer (1260, 286.5) — where the white of the eye ends
# (1261-1262; the other eye's 13 px from its pupil, this one's 14.5), the lash lines run on to 1250 —
# inner (1290, 288).
REF_EYE_UPPER = [(1260, 286.5), (1262, 282.0), (1265, 279.0), (1270, 278.5), (1275, 278.5),
                 (1280, 279.4), (1284, 281.2), (1287, 283.8), (1290, 288.0)]
REF_EYE_LOWER = [(1260, 286.5), (1262, 289.0), (1265, 290.2), (1270, 290.8), (1275, 291.0),
                 (1280, 290.6), (1284, 289.9), (1288, 289.0), (1290, 288.0)]
# The concept's lips, traced (sheet px; u = px from the mouth's midline 1309.3, both halves folded:
# they agree within ~1 px): the vermilion border's top (upper lip) and bottom (lower lip) edges,
# corner to corner. The corners are the ends of the dark mouth line (1285.2 and 1333.4, row 359.5),
# which the lips' colour does not reach — the corners are in shadow — and the top at the midline
# is where the vermilion begins under the white roll (the philtrum above it is nearly as red).
LIP_MID = 1309.3
REF_LIP_UPPER = [(0, 350.5), (2, 350.2), (4, 349.4), (5.5, 348.7), (7, 348.6), (8.5, 349.0), (10, 349.9),
                 (11.5, 350.9), (13, 352.0), (15, 353.4), (17, 354.8), (19, 356.2), (21, 357.3), (23, 358.5),
                 (24.1, 359.5)]
REF_LIP_LOWER = [(0, 371.5), (3, 371.2), (6, 370.6), (9, 369.7), (11, 368.7), (13, 367.4), (15, 366.1),
                 (17, 364.8), (19, 363.5), (21, 362.1), (23, 360.5), (24.1, 359.5)]


def _front_scale(ipd_cm):
    f = REF_FRONT
    return ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0]), f['pupil_l'][1], f['mid_x']


def ref_features(ipd_cm):
    """The concept's feature outlines in cm (x from the midline, z from the pupils):
    eye {'upper': [(x, z)], 'lower': [...]}, lips {'x': [...], 'top': [...], 'bottom': [...]} —
    both traced by hand (REF_EYE_*, REF_LIP_*): outlines, not colour or shading."""
    s, zp, cx = _front_scale(ipd_cm)
    eye = {k: [((cx - x) * s, (zp - r) * s) for x, r in pts] for k, pts in (('upper', REF_EYE_UPPER), ('lower', REF_EYE_LOWER))}
    xs = np.arange(0.05, REF_LIP_UPPER[-1][0] * s - 0.05, 0.1)          # cm from the midline
    u = xs / s
    lips = {'x': list(xs),
            'top': list((zp - np.interp(u, *zip(*REF_LIP_UPPER))) * s),
            'bottom': list((zp - np.interp(u, *zip(*REF_LIP_LOWER))) * s)}
    return eye, lips


_loops = {}


def _edge_loop(v0, v1, F):
    """The edge loop through the edge (v0, v1) of a quad mesh (stops at a pole)."""
    key = id(F)
    if key not in _loops:
        nb, fo = {}, {}
        for fi, f in enumerate(F):
            for a, b in zip(f, f[1:] + f[:1]):
                nb.setdefault(a, set()).add(b); nb.setdefault(b, set()).add(a)
            for v in f:
                fo.setdefault(v, set()).add(fi)
        _loops[key] = (nb, fo)
    nb, fo = _loops[key]
    out = [v0, v1]
    while len(out) < 1000:
        u, v = out[-2], out[-1]
        shared = fo[u] & fo[v]
        c = [w for w in nb[v] if w != u and not (fo[w] & shared)]
        if len(nb[v]) != 4 or len(c) != 1 or c[0] == out[0]:
            break
        out.append(c[0])
    return out


_border = None


def mouth_border():
    """The lips' vermilion border on the MakeHuman mesh: the closed 38-vertex edge loop through
    the upper lip's midline border vertex (the loop that carries the cupid's bow)."""
    global _border
    if _border is None:
        F = mh.load_base()['F']
        best = None
        faces = [f for f in F if V_LIP_TOP in f]
        cand = set(v for f in faces for v in f if v != V_LIP_TOP)
        for w in cand:
            L = _edge_loop(V_LIP_TOP, w, F)
            if len(L) == 38:
                best = L
                break
        _border = np.array(best)
    return _border


_roots = {}


def lash_roots(V, side='l'):
    """The lid margins: the lash helpers' roots (the third of each lash strip nearest the eyeball,
    on MakeHuman's base mesh: fixed vertices, whatever the eyeball does), upper and lower, sorted
    by x."""
    if side not in _roots:
        b = mh.load_base()
        g, B0 = b['groups'], b['V']
        eye = B0[sorted(g[f'helper-{side}-eye'])].mean(0)
        out = []
        for grp in (f'helper-{side}-eyelashes-1', f'helper-{side}-eyelashes-2'):
            gi = np.array(sorted(g[grp]))
            d = np.linalg.norm(B0[gi] - eye, axis=1)
            out.append(gi[d < d.min() + 0.33 * (d.max() - d.min())])
        a, c = out
        _roots[side] = (a, c) if B0[a, 1].mean() > B0[c, 1].mean() else (c, a)   # (upper, lower: MakeHuman is Y-up)
    return tuple(r[np.argsort(V[r, 0])] for r in _roots[side])


def our_features(V, eye_x, lip_x):
    """Our feature outlines at the given x (cm, frames as ref_features): eye upper/lower lid
    margin heights, lips' border top/bottom heights (NaN outside the feature)."""
    eye = eye_centre(V)
    up, lo = lash_roots(V)
    ez = {}
    for name, idx in (('upper', up), ('lower', lo)):
        x, z = V[idx, 0] * 100, (V[idx, 2] - eye[2]) * 100
        o = np.argsort(x)
        ez[name] = np.interp(eye_x, x[o], z[o], left=np.nan, right=np.nan)
    L = mouth_border()
    P = V[L]
    x, z = np.abs(P[:, 0]) * 100, (P[:, 2] - eye[2]) * 100
    zc = z.mean()
    lz = {}
    for name, sel in (('top', z >= zc), ('bottom', z < zc)):
        o = np.argsort(x[sel])
        lz[name] = np.interp(lip_x, x[sel][o], z[sel][o], left=np.nan, right=np.nan)
    return ez, lz


# ---- the ears (profile close-up), traced: the helix against the hair (top, back), the lobe's
# bottom, and the ear's front root at the tragus (sheet px)
REF_EAR = {'top': (1326, 699), 'bottom': (1316, 756.5), 'back': (1340.5, 718), 'front': (1311, 728)}
# and in the front close-up, how far the ears stand out: the helix's outer edge, px from the midline
# (both sides: 92, 93; rows 285-310, between the hair strands)
REF_EAR_OUT = 92.5


def ref_ear(ipd_cm):
    """The concept's ear points in cm: (depth behind the eye's front, height from the pupil), scaled as
    ref_landmarks' profile."""
    f, p = REF_FRONT, REF_PROFILE
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])
    sp = ((f['menton'][1] - f['pupil_l'][1]) * s) / (p['menton'][1] - p['eye'][1])
    ex, ey = p['eye']
    out = {k: ((x - ex) * sp, (ey - y) * sp) for k, (x, y) in REF_EAR.items()}
    out['out'] = REF_EAR_OUT * s
    return out


def our_ear(V, ears):
    """Our ear's points (cm, frames as ours()): top, bottom, back, front of the ear's vertices,
    and 'out': how far it stands out from the midline (front view)."""
    eye, iris_y = lid_front(V)
    Q = V[ears]
    rel = lambda q: ((q[1] - iris_y) * 100, (q[2] - eye[2]) * 100)
    return {'top': rel(Q[np.argmax(Q[:, 2])]), 'bottom': rel(Q[np.argmin(Q[:, 2])]),
            'back': rel(Q[np.argmax(Q[:, 1])]), 'front': rel(Q[np.argmin(Q[:, 1])]),
            'out': np.abs(Q[:, 0]).max() * 100}


# the iris plane (3 mm inside the eyeball's front) behind the upper lid's front (fit18: 3.45 mm,
# fit15: 3.6 mm): the brow's projection is measured from it — from the lid, the profile's depth
# origin, so that it doesn't follow the eyeball
IRIS_BEHIND_LID = 0.0035


def our_brow(V, xs):
    """The brow ridge above the left eye at the given x (cm from the midline): per x, its
    projection (depth of the frontmost points, from the iris plane — IRIS_BEHIND_LID behind the
    upper lid's front, cm; forward is -) and
    height (from the pupil, cm) — soft extrema (the frontmost points' weighted mean), smooth in
    the shape."""
    eye, iris_y = lid_front(V)
    iris_y += IRIS_BEHIND_LID
    B = V[:mh.BODY_VERTS]
    band = np.where((B[:, 2] > eye[2] + 0.004) & (B[:, 2] < eye[2] + 0.035) & (B[:, 1] < eye[1]) &
                    (B[:, 0] > 0))[0]
    depth, height = [], []
    for xc in xs:
        m = band[np.abs(B[band, 0] - xc / 100) < 0.0025]
        y = B[m, 1]
        w = np.exp(-(y - y.min()) / 0.0012)
        depth.append(((w @ y) / w.sum() - iris_y) * 100)
        height.append(((w @ B[m, 2]) / w.sum() - eye[2]) * 100)
    return np.array(depth), np.array(height)


# ---- the nape (profile close-up): the back of the neck against the backdrop, below the hair
NAPE_ROWS = (800, 862)


def ref_nape(ipd_cm):
    """The concept's nape in cm: [(height from the pupil, depth behind the eye's front)] by row, scaled as
    ref_landmarks' profile."""
    m = _skin_mask()
    f, p = REF_FRONT, REF_PROFILE
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])
    sp = ((f['menton'][1] - f['pupil_l'][1]) * s) / (p['menton'][1] - p['eye'][1])
    ex, ey = p['eye']
    out = []
    for r in range(*NAPE_ROWS):
        xs = np.where(m[r, 1300:1480])[0]
        if len(xs):
            out.append(((ey - r) * sp, (xs[-1] + 1300 + 0.5 - ex) * sp))
    return out


def our_nape(V, zs, E=None):
    """Our nape: the neck's back edge in profile (cm behind the eye's front) at heights zs (cm from the
    pupil), the neck only (|x| < 5 cm)."""
    from . import measure
    eye, iris_y = lid_front(V)
    B = V[:mh.BODY_VERTS]
    if E is None:
        E = measure.mesh_edges(mh.load_base()['F'])
    out = []
    for q in measure.sections(B, E, eye[2] + np.asarray(zs) / 100):
        q = q[np.abs(q[:, 0]) < 0.05]
        out.append((q[:, 1].max() - iris_y) * 100 if len(q) else np.nan)
    return np.array(out)


# ---- the face's absolute size: the full-body sheet's front view, the jaw's half-width (skin against
# the backdrop) at heights below the ears, metres (lib/measure's sheet frame)
def ref_full_jaw():
    """[(z in m, half-width in m)] of the face in the sheet's full-body front view, from below the
    ears to the chin (rows 142-170)."""
    from . import measure
    m = _skin_mask()
    v = measure.REF['views']['front']
    S = measure.REF['scale']
    cx = v['cx']
    out = []
    for row in range(142, 171, 2):
        ext = []
        for sg in (-1, 1):
            x, gap, last = int(cx) + sg * 5, 0, int(cx) + sg * 5
            while abs(x - cx) < 45:
                x += sg
                if m[row, x]:
                    last, gap = x, 0
                else:
                    gap += 1
                    if gap > 2:
                        break
            ext.append(abs(last - cx) + 0.5)
        out.append(((v['sole'] - row) * S, float(np.mean(ext)) * S))
    return out
