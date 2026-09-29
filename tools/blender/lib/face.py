"""Facial landmarks: ours from the MakeHuman mesh, the concept's from its close-ups.

Ours are fixed vertices (the topology never changes, so a vertex is the same anatomical point
under every modifier) — found as the vertices MakeHuman's own feature targets move most (the
mouth corner is what mouth-scale-horiz moves, the alar wing what nostrils-width moves, ...) —
plus the eyeball helper's centre (the pupil) and extrema of the midline profile.

Coordinates: centimetres relative to the left pupil's height and the midline, x = lateral
(front view), y = forward-negative depth (profile), z = up. The concept's are measured on the
sheet's close-ups (front: pupils 1274/1344 at row 282.5; profile: eye 1227.5/715) and scaled so
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
             'eye_outer': (1251.3, 284.5), 'eye_inner': (1290, 288.75),
             # lid margins: the drawn aperture less the liner and lashes (~1.5 px each)
             'lid_upper': (1274, 277.75), 'lid_lower': (1274, 289.75),
             'brow_low': (1274, 261.25), 'alar': (1291.25, 331.25), 'nose_tip': (1310, 322.5),
             'subnasale': (1310, 336.25), 'mouth_corner': (1286.25, 359.5), 'lip_top': (1310, 350),
             'stomion': (1310, 358), 'lip_bottom': (1310, 372.5), 'chin_side': (1293, 397),
             'menton': (1310, 402.5), 'gonion': (1250, 367),
             # face outline half-widths (px from the midline) by row
             'outline': [(300, 69), (320, 67), (340, 63.5), (350, 60.5), (360, 56), (367, 53.5)]}
REF_PROFILE = {'eye': (1227.5, 715), 'nose_tip': (1192, 750), 'subnasale': (1203.75, 758.75),
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


def all_vertices(targets):
    """Every vertex (body and helpers) in the Blender frame, as the body is built."""
    return mh.to_blender(mh.morphed(targets), 1.68)


def ours(V, pick=None):
    """Our landmarks (cm) from all vertices V (body + helpers): front {name: (x, z)}, profile
    {name: (y, z)}, relative to the left pupil (eyeball helper centre). The profile points and lid
    margins are found as extrema; pass pick = ours(V0)[2] (their vertex indices on a reference
    shape) to evaluate them at fixed vertices instead — smooth in the shape, for fitting."""
    g = mh.load_base()['groups']
    eye = V[sorted(g['helper-l-eye'])].mean(0)
    eye_r = V[sorted(g['helper-r-eye'])].mean(0)
    rel = lambda q: (q - [0, eye[1], eye[2]]) * 100
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
    y, z = (B[mi, 1] - eye[1]) * 100, (B[mi, 2] - eye[2]) * 100
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
            pr[k] = ((B[vi, 1] - eye[1]) * 100, (B[vi, 2] - eye[2]) * 100)
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
            dist = np.linalg.norm(V[gi] - eye, axis=1)
            root = gi[dist < np.percentile(dist, 40)]
            picked[grp] = root[np.argsort(np.abs(V[root, 0] - eye[0]))[:3]]
            q = V[picked[grp]]
        lids.append((q[:, 0].mean() * 100, (q[:, 2].mean() - eye[2]) * 100))
    lids.sort(key=lambda q: -q[1])
    fr['lid_upper'], fr['lid_lower'] = lids
    return fr, pr, picked
