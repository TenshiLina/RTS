"""Facial landmarks: ours from the MakeHuman mesh, the concept's from its close-ups.

Ours are fixed vertices (the topology never changes, so a vertex is the same anatomical point
under every modifier) — found as the vertices MakeHuman's own feature targets move most (the
mouth corner is what mouth-scale-horiz moves, the alar wing what nostrils-width moves, ...) —
plus the eyeball helper's centre (the pupil) and extrema of the midline profile.

Coordinates: centimetres relative to the left pupil's height and the midline, x = lateral
(front view), y = forward-negative depth (profile), z = up. The concept's are measured on the
sheet's close-ups (front: the pupils — the irises' centres, circles fitted to their edges; the
painted catchlights, 1274/1344 at 282.5, are off them — 1272.55/1344.4 at row 283; profile: the eye's front 1217.5 — the
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
V_ALAR = 11685            # the alare: the ala's most lateral point, its side wall facing out (7099, lower on the
                          # alar base, read our nose 5 mm narrower than it renders)
V_EYE_OUTER = 6809         # l-eye-corner1
V_EYE_INNER = 6856         # l-eye-corner2
V_CHIN_SIDE = 11778        # chin-width
V_CHEEKBONE = 11788        # l-cheek-bones
V_LIP_TOP = 362            # mouth-upperlip-height: the upper lip's vermilion border (midline)
V_LIP_BOTTOM = 7241        # mouth-lowerlip-height: the lower lip's vermilion border

# the concept, front close-up (sheet px) and profile close-up (sheet px)
REF_FRONT = {'pupil_l': (1272.55, 283.0), 'pupil_r': (1344.4, 283.0), 'mid_x': 1308.5,
             'eye_outer': (1256.6, 285.5), 'eye_inner': (1288.5, 289.5),
             # lid margins over the iris (REF_EYE_UPPER/LOWER)
             'lid_upper': (1274, 278.85), 'lid_lower': (1274, 290.3),
             'brow_low': (1274, 261.25), 'alar': (1291.25, 331.25), 'nose_tip': (1310, 322.5),
             'subnasale': (1310, 336.25), 'mouth_corner': (1285.2, 359.5), 'lip_top': (1310, 350.5),
             'stomion': (1310, 358), 'lip_bottom': (1310, 371.5), 'chin_side': (1293, 397),
             'menton': (1310, 402.5), 'gonion': (1250, 367),
             # face outline half-widths (px from the midline) by row
             'outline': [(300, 69), (320, 67), (340, 63.5), (350, 60.5), (360, 56), (367, 53.5)]}
REF_PROFILE = {'eye': (1217.5, 715), 'nose_tip': (1192, 750), 'subnasale': (1206, 764.5),
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
        if not m.any():     # (a window between sparse midline vertices: widen it)
            m = (z <= z0 + 0.5) & (z >= z1 - 0.5)
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
            x = int(round(cx)) + sg * 30         # (from beyond the mouth's corners: the lips aren't skin-coloured)
            gap, last = 0, x
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


# The nose's underside in the profile close-up, tip to subnasale (sheet px): per column, where the
# shaded underside meets the background — the midpoint of its luminance step (the skin mask's last
# row runs ~0.5 px lower; under the nostril, 1202-1205, the step below it). The columella rises ~30
# degrees from the lip to the tip; the subnasale is the corner at (1206, 764.5), where the lip's
# front turns down (an earlier landmark put it 3.5 px lower, on the lip). The profile's per-row
# silhouette (ref_silhouettes) barely weighs this near-level edge: fitted as its own outline.
REF_NOSE_UNDER = [(1193, 755.6), (1194, 756.2), (1195, 757.6), (1196, 758.6), (1197, 759.2), (1198, 759.9),
                  (1199, 760.5), (1200, 761.1), (1201, 761.4), (1202, 761.9), (1203, 762.2), (1204, 762.6),
                  (1205, 762.9)]


def ref_nose_under(ipd_cm):
    """The concept's nose underside in cm: (depth from the eye's front, height from the eye row) —
    the profile's frame, scaled as ref_silhouettes."""
    f, p = REF_FRONT, REF_PROFILE
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])
    sp = ((f['menton'][1] - f['pupil_l'][1]) * s) / (p['menton'][1] - p['eye'][1])
    ex, ey = p['eye']
    return [((x - ex) * sp, (ey - r) * sp) for x, r in REF_NOSE_UNDER]


def our_nose_under(V, depths, E=None):
    """Our nose's underside: at each depth (cm from the upper lid's front, as our_silhouettes), the
    lowest point of the nose on the midline (within 4 mm of it; above the upper lip: 25-52 mm under
    the pupils), cm from the pupil (NaN where the plane misses the nose)."""
    from . import measure
    eye, iris_y = lid_front(V)
    B = V[:mh.BODY_VERTS]
    if E is None:
        E = measure.mesh_edges(mh.load_base()['F'])
    Bs = B[:, [0, 2, 1]]
    out = []
    for q in measure.sections(Bs, E, iris_y + np.asarray(depths) / 100):
        q = q[(np.abs(q[:, 0]) < 0.004) & (q[:, 1] < eye[2] - 0.025) & (q[:, 1] > eye[2] - 0.052)]
        out.append((q[:, 1].min() - eye[2]) * 100 if len(q) else np.nan)
    return np.array(out)


# The nose base's features, traced (sheet px) to review and design the alae and nostrils against (not
# fitted). Creases are the valleys of the local contrast (luminance less its 2-4 px blur), not edges:
# a groove is the darkest line whichever side the light comes from.
# Front close-up (the figure's right half, seen on the left; its mirror about the midline agrees
# within ~0.5 px — ~0.9 under the ala, the half in shade: averaged):
# - 'alar_crease': the groove round the ala — over its top (faint: a quarter of the lower part's
#   depth), down its outer side (the alar-facial groove) and under it to the alar base, fading out
#   under the nostril at 1300. (The ala's shadow on the lip lies under its lower part: the base may
#   sit ~0.5 px higher.)
# - 'tip_edge': the faint crease on the ala's inner side, between it and the tip lobule, down to the
#   nostril's top (both halves: x 1298.0 +- 0.3 from row 315 to 326; above, they part).
# - 'nostril': the visible opening, half-way between its core and the skin round it (4.4 x 2.1 px,
#   its inner end lower).
# - 'columella_base': the shadow line from the nostril's inner end down to the subnasale (337.2 on
#   the midline).
REF_NOSE_FRONT = {
    'alar_crease': [(1297.0, 316.9), (1295.0, 318.1), (1294.0, 319.0), (1293.2, 321.0), (1292.4, 323.0),
                    (1291.75, 325.0), (1291.65, 327.0), (1292.0, 329.0), (1292.4, 330.5), (1292.7, 332.0),
                    (1293.2, 333.0), (1294.0, 334.0), (1295.0, 334.6), (1296.0, 335.1), (1297.0, 335.4),
                    (1298.0, 335.75), (1299.0, 336.1), (1300.0, 336.35)],
    'tip_edge': [(1298.2, 315.0), (1298.1, 317.0), (1297.95, 319.0), (1297.85, 321.0), (1297.9, 323.0),
                 (1297.95, 325.0), (1298.1, 326.0), (1298.8, 327.3)],
    'nostril': [(1297.8, 332.0), (1298.3, 331.4), (1299.0, 330.6), (1300.0, 330.5), (1301.0, 330.65),
                (1302.0, 331.5), (1302.5, 332.2), (1302.0, 332.5), (1301.0, 332.6), (1300.0, 332.7),
                (1299.0, 332.75), (1298.3, 332.5), (1297.8, 332.0)],
    'columella_base': [(1304.0, 334.0), (1305.0, 335.2), (1306.0, 335.95), (1307.0, 336.5), (1308.0, 337.1),
                       (1308.5, 337.2)]}
# Profile close-up:
# - 'alar_crease': the groove behind and under the ala (the alar-facial groove), from the ala's top
#   to where its rim meets the lip: valleys along rays from the ala's centre. Over the ala's top the
#   concept paints no crease (a dip of 2-4 against ~8-20 behind and under it): the ala's top is the
#   upper edge of its highlight, row ~751.8 across 1208-1214.
# - 'nostril': the visible crescent between the alar rim (its top) and the columella (its bottom),
#   half-way between its core and the skin; the columella's lower edge is REF_NOSE_UNDER (it shows
#   ~4 mm below the alar rim).
REF_NOSE_PROFILE = {
    'alar_crease': [(1216.0, 746.6), (1216.45, 746.9), (1217.8, 747.9), (1218.1, 749.6), (1219.0, 750.9),
                    (1219.9, 752.35), (1220.0, 754.0), (1219.1, 755.5), (1218.3, 756.8), (1217.4, 758.0),
                    (1217.0, 759.5), (1216.0, 760.5), (1214.5, 760.9), (1213.1, 761.05), (1211.7, 760.9)],
    'nostril': [(1202.45, 758.4), (1203.0, 757.46), (1204.0, 757.14), (1205.0, 757.09), (1206.0, 757.28),
                (1207.0, 757.47), (1208.0, 757.77), (1209.0, 758.29), (1210.0, 758.72), (1211.0, 759.6),
                (1211.3, 760.1), (1211.0, 760.17), (1210.0, 760.13), (1209.0, 759.73), (1208.0, 759.46),
                (1207.0, 759.0), (1206.0, 758.86), (1205.0, 758.88), (1204.0, 759.0), (1203.0, 759.25),
                (1202.45, 758.4)]}


# ---- feature outlines (front close-up): the lips' vermilion and the eyes' opening
# The concept's eye opening (sheet px; the figure's right eye, seen on the left — mirrored to ours by
# symmetry): the lid margins, the anatomy under her dark eye makeup (the look paints its own). Both eyes
# measured, aligned on their irises' centres (the mirrored one sits ~1.1 px further out) and averaged —
# the frame of REF_FRONT's pupil. Traced, then corrected by an adversarial review (trace F).
# - upper: the liner's band is a smooth arch; its darkest line (the lash line) runs ~1 px above where
#   the band gives way to the eyeball, over the white and the iris alike. The margin is that line plus
#   1.0 px (a robust fit to both eyes' band cores: rms 0.29 px, no kink), clearing the catchlights'
#   tops (280.4) over the iris. A trace through the liner's soft gradient (a quarter of the way up from
#   its darkest, then raised over the iris) cut across the band, which bent the lid on the outside.
# - lower: the iris is whole — its lower limbus (290.8-291.0) meets the lid's lit rim, whose top runs at
#   290.8 under the iris and the medial white; the darker, skin-tinted band 1-2 px above the rim beside
#   the iris is tinted white and under-eye shading, not lid (it is absent below the iris, where an opaque
#   lid shelf could not vanish). Laterally, where the sclera meets the lower lash line.
# - outer corner (1256.4, 284.18): on the band's line, where the lids meet — the lid runs straight into
#   it along the lash line (a corner below the line, as before, hooked the lid down off the lash line).
#   Its x is uncertain under the wing (the review's 1254.3-1256.0); just inside that, the eyeball's
#   white reaches it (a 13 mm eyeball's edge, 1256.8 — further out left a dark gap), 13.1 mm from the
#   pupil. The wing beyond is makeup.
# - inner corner (1289.0, 290.2): where the band ends against the caruncle and the rim.
REF_EYE_UPPER = [(1256.4, 284.18), (1257, 284), (1258, 283.5), (1259, 282.95), (1260, 282.4), (1261, 281.96),
                 (1262, 281.55), (1263, 281.18), (1264, 280.84), (1265, 280.55), (1266, 280.31),
                 (1267, 280.12), (1268, 279.98), (1269, 279.9), (1270, 279.87), (1271, 279.9), (1272, 279.99),
                 (1273, 280.13), (1274, 280.33), (1275, 280.59), (1276, 280.9), (1277, 281.27), (1278, 281.7),
                 (1279, 282.11), (1280, 282.59), (1281, 283.16), (1282, 283.89), (1283, 284.77),
                 (1284, 285.69), (1285, 286.62), (1286, 287.55), (1287, 288.43), (1288, 289.32), (1289, 290.2)]
REF_EYE_LOWER = [(1256.4, 284.18), (1257, 284.99), (1258, 286.29), (1259, 287.45), (1260, 288.39), (1261, 289),
                 (1262, 289.4), (1263, 289.7), (1264, 289.95), (1265, 290.15), (1266, 290.35), (1267, 290.5),
                 (1268, 290.6), (1269, 290.68), (1270, 290.75), (1271, 290.8), (1272, 290.83), (1274, 290.85),
                 (1276, 290.85), (1278, 290.85), (1280, 290.85), (1282, 290.8), (1284, 290.78), (1286, 290.78),
                 (1287, 290.72), (1288, 290.55), (1289, 290.2)]
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


_open_faces = {}


def _inside2(P, poly):
    """Which of the 2D points P are inside the polygon poly (even-odd rule)."""
    x, y = P[:, 0], P[:, 1]
    inside = np.zeros(len(P), bool)
    for (x1, y1), (x2, y2) in zip(poly, np.roll(poly, -1, axis=0)):
        cross = (y1 > y) != (y2 > y)
        xi = x1 + (y - y1) * (x2 - x1) / np.where(y2 != y1, y2 - y1, 1e-12)
        inside ^= cross & (x < xi)
    return inside


def opening(V, eye_x, side='l', dz=0.00005, eye_depth=0.0):
    """The eye's visible opening in the front view, as rendered: at each x (cm from the midline, the
    frames of ref_features), the top and the bottom (cm from the pupil) of the run of the column
    where the eyeball (as character/woman.add_eyes builds it: the helper's mean, its mean radius) or
    the tissue inside the lid margins (the conjunctiva, as character/look._conjunctiva) is in front
    of the skin — the skin's rim, not the lash line (NaN where the column is closed). Skin faces
    within 2.5 cm of the eye (MakeHuman's quads, triangulated), cut by each column."""
    b = mh.load_base()
    g = b['groups']
    if side not in _open_faces:
        B0 = b['V']
        E0 = B0[sorted(g[f'helper-{side}-eye'])]
        e0 = E0.mean(0)
        r0 = np.linalg.norm(E0 - e0, axis=1).mean()          # (MakeHuman's units: 2.5 cm ~ 2.1 radii)
        F = [f for f in b['F'] if np.linalg.norm(B0[f] - e0, axis=1).max() < 2.1 * r0]
        tri = [(t, f) for f in F for t in ([f[0], f[1], f[2]], [f[0], f[2], f[3]])[:len(f) - 2]]
        fv = np.full((len(tri), 4), -1)
        for i, (_, f) in enumerate(tri):
            fv[i, :len(f)] = f
        _open_faces[side] = (np.array([t for t, _ in tri]), fv)
    tri, fv = _open_faces[side]
    E = V[sorted(g[f'helper-{side}-eye'])]
    c = E.mean(0) + np.array([0.0, eye_depth, 0.0])
    r = float(np.linalg.norm(E - c, axis=1).mean())
    pupil = eye_centre(V, side)
    sg = 1.0 if side == 'l' else -1.0
    X = sg * np.asarray(eye_x, float) / 100
    # the conjunctiva: inside the opening's loop (front view: aperture_ring) and behind the lash roots' frontmost
    up, lo = lash_roots(V, side)
    ring = aperture_ring(V, side)
    T = V[tri]                                                # (n, 3 corners, xyz)
    Q = V[np.maximum(fv, 0)]                                  # (the triangles' quads: all their corners)
    nq = _inside2(Q.reshape(-1, 3)[:, [0, 2]], ring).reshape(fv.shape) & (Q[:, :, 1] > min(V[up, 1].min(), V[lo, 1].min()) - 0.0005)
    conj = (nq | (fv < 0)).all(1)
    zs = np.arange(-0.012, 0.012, dz) + pupil[2]
    top, bot = np.full(len(X), np.nan), np.full(len(X), np.nan)
    for i, x0 in enumerate(X):
        # each triangle's cut by the vertical plane x = x0: a segment (z, y) to (z, y)
        a, bq = T, np.roll(T, -1, axis=1)
        da, db = a[:, :, 0] - x0, bq[:, :, 0] - x0
        cr = (da * db < 0) | ((da == 0) & (db != 0))
        k = cr.sum(1) == 2
        if not k.any():
            continue
        t = np.clip(da / np.where(da - db != 0, da - db, 1e-12), 0, 1)
        P = a + (bq - a) * t[:, :, None]
        P, crk, ck = P[k], cr[k], conj[k]
        o = np.argsort(~crk, axis=1, kind='stable')[:, :2]
        p0 = np.take_along_axis(P, o[:, :1, None], 1)[:, 0]
        p1 = np.take_along_axis(P, o[:, 1:2, None], 1)[:, 0]
        z0, z1 = np.minimum(p0[:, 2], p1[:, 2]), np.maximum(p0[:, 2], p1[:, 2])
        y0 = np.where(p0[:, 2] <= p1[:, 2], p0[:, 1], p1[:, 1]); y1 = np.where(p0[:, 2] <= p1[:, 2], p1[:, 1], p0[:, 1])
        w = np.clip((zs[:, None] - z0) / np.maximum(z1 - z0, 1e-12), 0, 1)
        yz = y0 + (y1 - y0) * w
        cov = (zs[:, None] >= z0) & (zs[:, None] <= z1)
        skin = np.where(cov & ~ck, yz, np.inf).min(1)
        tissue = np.where(cov & ck, yz, np.inf).min(1)
        rho2 = (x0 - c[0]) ** 2 + (zs - c[2]) ** 2
        ye = np.where(rho2 < r * r, c[1] - np.sqrt(np.maximum(r * r - rho2, 0)), np.inf)
        front = np.minimum(ye, tissue)
        m = np.where(np.isfinite(front), np.minimum(skin, 1.0) - front, -1.0)   # (> 0: open)
        op = m > 0
        if not op.any():
            continue
        j0 = int(np.argmin(np.abs(zs - pupil[2])))
        idx = np.where(op)[0]
        runs = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        run = min(runs, key=lambda q: 0 if q[0] <= j0 <= q[-1] else min(abs(q[0] - j0), abs(q[-1] - j0)))
        lo_i, hi_i = run[0], run[-1]
        def edge(i_in, i_out):
            if not 0 <= i_out < len(zs):
                return zs[i_in]
            mi, mo = m[i_in], m[i_out]
            f = mi / (mi - mo) if np.isfinite(mo) and mi - mo > 0 else 0.5
            return zs[i_in] + (zs[i_out] - zs[i_in]) * min(max(f, 0.0), 1.0)
        bot[i], top[i] = edge(lo_i, lo_i - 1), edge(hi_i, hi_i + 1)
    return (top - pupil[2]) * 100, (bot - pupil[2]) * 100


def canthi(side='l'):
    """The eye's corner vertices on the skin (outer, inner) for either side."""
    if side == 'l':
        return V_EYE_OUTER, V_EYE_INNER
    m = mh.mirror_map()
    return int(m[V_EYE_OUTER]), int(m[V_EYE_INNER])


def aperture_ring(V, side='l'):
    """The eye's opening as a loop in the front view (x, z): the lid margins (the lash strips' roots,
    which stop short of the corners) closed through the corners' skin vertices."""
    up, lo = lash_roots(V, side)
    co = V[list(canthi(side))]
    hi_end, lo_end = (co[0], co[1]) if co[0, 0] > co[1, 0] else (co[1], co[0])
    return np.r_[V[up][:, [0, 2]], hi_end[None, [0, 2]], V[lo][::-1][:, [0, 2]], lo_end[None, [0, 2]]]


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
