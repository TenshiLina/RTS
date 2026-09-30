"""The reference-fitting pass's measure: the concept's landmarks in three views — the front close-up,
the profile close-up and the full-body sheet's 3/4 view — and ours, projected the same way, as a
table (mm) and overlays on the concept.

Frames (cm): front — x from the midline (the concept's image-left side, our +x), z from the left
pupil (lib/face.eye_centre), scaled by the eyes' spacing (as lib/face); profile — depth behind the
upper lid's front (lib/face.lid_front), height from the pupil, scaled eye-to-chin (as lib/face);
3/4 — the sheet's 3/4 view (yaw 36 degrees, the figure's left toward the viewer, the sheet's own
scale), across and up from the pupils' midpoint.

The eye is measured as one system: the iris (its size and where it sits between the lids), the
aperture (canthi, lid margins, canthal tilt), the lids' wrap (how far back the lateral canthus is,
the lower lid behind the upper) and the globe (its radius, its front against the lids)."""
import json
import os
import numpy as np
from . import face, mh

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
SHEET = os.path.join(ROOT, 'docs/art/factions/human/human-female-turnaround.webp')
YAW_Q34 = 36.0

# ---- the concept, traced (sheet px)
# front close-up: the irises (centre, radius) — both 12 px across (0.17 of the eyes' spacing),
# touching the upper lid's margin and the lower's at the pupil: no sclera shows above or below
FRONT_EYE = {'iris_l': (1272.5, 283.75, 6.0), 'iris_r': (1344.5, 283.75, 6.0)}
# profile close-up: the lateral canthus (where the lids meet: the white's end, the upper lash line runs
# on) and the lower lid's front
PROFILE_EYE = {'canthus_lat': (1236.5, 716.0), 'lid_lower': (1222.5, 720.0)}
# the full-body 3/4 view (~1.8 mm/px; the near eye is the figure's left, ours +x)
Q34 = {'pupil_near': (1031.0, 120.5), 'pupil_far': (1000.0, 123.5),
       'canthus_in_near': (1022.5, 121.5), 'canthus_out_near': (1037.5, 119.0),
       'nose_tip': (1008.5, 142.0), 'subnasale': (1012.5, 149.0), 'alar_near': (1017.0, 146.5),
       'mouth_near': (1025.5, 157.5), 'mouth_far': (1007.0, 157.0), 'menton': (1017.0, 176.0)}
_edges = None
IRIS_COS = 0.84    # the eye material's iris edge: the cosine of its angle from the gaze (character/woman.eye_material)


def _scales(ipd_cm):
    f, p = face.REF_FRONT, face.REF_PROFILE
    s = ipd_cm / (f['pupil_r'][0] - f['pupil_l'][0])                      # cm per front px
    sp = ((f['menton'][1] - f['pupil_l'][1]) * s) / (p['menton'][1] - p['eye'][1])   # cm per profile px
    return s, sp


def _sheet_scale():
    return json.load(open(os.path.join(ROOT, 'tools/assetgen/ref/human-female.json')))['scale'] * 100   # cm per sheet px


def concept(ipd_cm):
    """The concept's landmarks: {'front': {name: (x, z)}, 'profile': {name: (depth, height)},
    'q34': {name: (u, v)}} in cm (frames as the module doc), plus the eye system's scalars."""
    fr, pr = face.ref_landmarks(ipd_cm)
    s, sp = _scales(ipd_cm)
    f, p = face.REF_FRONT, face.REF_PROFILE
    zp, cx = f['pupil_l'][1], f['mid_x']
    front = {k: v for k, v in fr.items() if k in ('eye_outer', 'eye_inner', 'lid_upper', 'lid_lower', 'brow_low',
                                                   'alar', 'nose_tip', 'subnasale', 'mouth_corner', 'lip_top',
                                                   'stomion', 'lip_bottom', 'chin_side', 'menton', 'gonion')}
    ix, iz, ir = FRONT_EYE['iris_l']
    front['iris'] = ((cx - ix) * s, (zp - iz) * s)
    prof = dict(pr)
    for k, (x, y) in PROFILE_EYE.items():
        prof[k] = ((x - p['eye'][0]) * sp, (p['eye'][1] - y) * sp)
    S = _sheet_scale()
    mu, mv = (np.array(Q34['pupil_near']) + Q34['pupil_far']) / 2
    q34 = {k: ((x - mu) * S, (mv - y) * S) for k, (x, y) in Q34.items()}
    o, i = front['eye_outer'], front['eye_inner']
    sc = {'iris_d': 2 * ir * s, 'aperture_w': o[0] - i[0], 'aperture_h': front['lid_upper'][1] - front['lid_lower'][1],
          'canthal_tilt': np.degrees(np.arctan2(o[1] - i[1], o[0] - i[0])),
          'iris_cover_top': (front['iris'][1] + ir * s) - front['lid_upper'][1],
          'sclera_below': front['iris'][1] - ir * s - front['lid_lower'][1],
          'canthus_depth': prof['canthus_lat'][0], 'lower_lid_depth': prof['lid_lower'][0]}
    return {'front': front, 'profile': prof, 'q34': q34, 'scalars': sc}


def eyes(V, gaze=None):
    """Our eyeballs from their helpers: {side: (centre, radius, gaze)} — gaze {side: unit vector}
    (the face model's, character/woman.add_eyes), default straight ahead."""
    g = mh.load_base()['groups']
    out = {}
    for sd in ('l', 'r'):
        E = V[sorted(g[f'helper-{sd}-eye'])]
        c = E.mean(0)
        gz = np.asarray((gaze or {}).get(sd, (0.0, -1.0, 0.0)), float)
        out[sd] = (c, float(np.linalg.norm(E - c, axis=1).mean()), gz / np.linalg.norm(gz))
    return out


def lower_lid(V):
    """The lower lid's front at the pupil (its skin: the body within 1.5 mm of the lower lash roots
    near the pupil's column, the three frontmost): (depth behind the upper lid's front, height from
    the pupil), cm."""
    from scipy.spatial import cKDTree
    eye, lf = face.lid_front(V)
    c = V[sorted(mh.load_base()['groups']['helper-l-eye'])].mean(0)
    B = V[:mh.BODY_VERTS]
    lo = face.lash_roots(V)[1]
    lo_near = V[lo][np.abs(V[lo][:, 0] - eye[0]) < 0.004]
    dd, _ = cKDTree(lo_near).query(B)
    sk = B[(dd < 0.0015) & (B[:, 1] < c[1])]
    k = np.argsort(sk[:, 1])[:3]
    return float((sk[k, 1].mean() - lf) * 100), float((sk[k, 2].mean() - eye[2]) * 100)


def profile_landmarks(V, ipd_cm):
    """Our profile landmarks from the midline's silhouette (the mid-sagittal section's frontmost
    point per 0.5 mm of height), as the concept's were traced: the nose tip, upper lip, lower lip,
    pogonion and glabella its frontmost points, the subnasale, stomion, labiomental fold and nasion
    its deepest — each within 7 mm of the concept's height for it (the lips: 4 mm; ipd_cm: the
    concept's scale) —
    and the menton, the chin's lowest point.
    {name: (depth behind the upper lid's front, height from the pupil)}, cm."""
    from . import measure
    eye, lf = face.lid_front(V)
    B = V[:mh.BODY_VERTS]
    global _edges
    if _edges is None:
        _edges = measure.mesh_edges(mh.load_base()['F'])
    a, b = B[_edges[:, 0]], B[_edges[:, 1]]
    k = (a[:, 0] * b[:, 0] < 0) | (a[:, 0] == 0)            # (the mid-sagittal section: edges crossing x = 0)
    t = np.where(b[k, 0] != a[k, 0], -a[k, 0] / np.where(b[k, 0] != a[k, 0], b[k, 0] - a[k, 0], 1), 0)
    P = a[k] + t[:, None] * (b[k] - a[k])
    P = P[P[:, 1] < eye[1] + 0.02]
    y, z = (P[:, 1] - lf) * 100, (P[:, 2] - eye[2]) * 100
    zs = np.arange(-12.0, 4.0, 0.05)
    front = np.full(len(zs), np.nan)
    for i, zz in enumerate(zs):
        k = np.abs(z - zz) < 0.05
        if k.any():
            front[i] = y[k].min()
    ok = ~np.isnan(front)
    front = np.interp(zs, zs[ok], front[ok])
    # (bands where the section misses the skin and meets the nostrils or the mouth inside: spikes back)
    for _ in range(3):
        nb = np.minimum(np.r_[front[1:], front[-1]], np.r_[front[0], front[:-1]])
        front = np.where(front - nb > 0.15, nb, front)
    ker = np.exp(-0.5 * (np.arange(-4, 5) * 0.05 / 0.08) ** 2); ker /= ker.sum()
    sm = np.convolve(np.pad(front, 4, mode='edge'), ker, mode='valid')
    at = lambda i: (float(front[i]), float(zs[i]))
    ref = concept(ipd_cm)['profile']
    out = {}
    for name, back in (('nose_tip', False), ('subnasale', True), ('lip_top', False), ('stomion', True),
                       ('lip_bottom', False), ('labiomental', True), ('pogonion', False), ('nasion', True),
                       ('glabella', False)):
        zc = ref[name][1]
        band = np.abs(zs - zc) < (0.4 if name in ('lip_top', 'stomion', 'lip_bottom') else 0.7)
        idx = np.where(band)[0]
        out[name] = at(idx[np.argmax(sm[band])] if back else idx[np.argmin(sm[band])])
    # the menton: the chin's lowest point (in front of the neck)
    zc = (B[:, 2] - eye[2]) * 100
    ch = (zc < out['pogonion'][1]) & (zc > out['pogonion'][1] - 3.0)
    ch &= ((B[:, 1] - lf) * 100 < out['pogonion'][0] + 1.5) & (np.abs(B[:, 0]) < 0.01)
    k = np.argmin(B[ch, 2])
    out['menton'] = (float((B[ch][k, 1] - lf) * 100), float((B[ch][k, 2] - eye[2]) * 100))
    return out


def ours(V, H=None, gaze=None, iris_cos=IRIS_COS, iris_d=None):
    """Our landmarks, frames as concept(): V all rest vertices; H the head's pose (rest → world, 4×4,
    for the 3/4 view: the posture places the head on the body); gaze as eyes(); the iris' diameter
    iris_d (m; the eye system's) or its edge's angle from the gaze (iris_cos)."""
    fr, pr, _ = face.ours(V)
    eye, lf = face.lid_front(V)
    ey = eyes(V, gaze)
    c, r, gz = ey['l']
    B = V[:mh.BODY_VERTS]
    rel = lambda q: (q[0] * 100, (q[2] - eye[2]) * 100)   # (x from the midline, z from the pupil)
    front = {k: v for k, v in fr.items() if k in ('eye_outer', 'eye_inner', 'lid_upper', 'lid_lower', 'alar',
                                                   'nose_tip', 'subnasale', 'mouth_corner', 'lip_top', 'stomion',
                                                   'lip_bottom', 'chin_side', 'menton', 'cheekbone')}
    front['eye_outer'] = rel(V[face.V_EYE_OUTER]); front['eye_inner'] = rel(V[face.V_EYE_INNER])
    apex = c + r * gz
    front['iris'] = rel(apex)
    ri = iris_d / 2 if iris_d else r * np.sqrt(1 - iris_cos ** 2)
    prof = profile_landmarks(V, fr['ipd'])
    for k in ('nose_tip', 'subnasale', 'stomion', 'menton'):
        front[k] = (0.0, prof[k][1])
    up, lo = face.lash_roots(V)
    prof['lid_lower'] = lower_lid(V)
    prof['canthus_lat'] = ((V[face.V_EYE_OUTER][1] - lf) * 100, (V[face.V_EYE_OUTER][2] - eye[2]) * 100)
    prof['globe_front'] = ((apex[1] - lf) * 100, (apex[2] - eye[2]) * 100)
    # the 3/4 view: posed, projected across (yaw 36°) and up, from the pupils' midpoint
    Hm = np.eye(4) if H is None else np.asarray(H)
    pose = lambda q: Hm[:3, :3] @ q + Hm[:3, 3]
    a = np.radians(YAW_Q34)
    proj = lambda q: np.array([pose(q) @ [np.cos(a), np.sin(a), 0.0], pose(q)[2]]) * 100
    cr, rr, gr = ey['r']
    pn, pf = proj(apex), proj(cr + rr * gr)
    mid = (pn + pf) / 2
    mirror = lambda i: V[i] * [-1, 1, 1]
    pts = {'pupil_near': pn, 'pupil_far': pf, 'canthus_in_near': proj(V[face.V_EYE_INNER]),
           'canthus_out_near': proj(V[face.V_EYE_OUTER]), 'alar_near': proj(V[face.V_ALAR]),
           'mouth_near': proj(V[face.V_MOUTH_CORNER]), 'mouth_far': proj(mirror(face.V_MOUTH_CORNER))}
    # the nose tip in 3/4: the midline's frontmost point along the view's 'across' (its leftmost in
    # the image); the subnasale and menton as in profile
    mids = B[(np.abs(B[:, 0]) < 0.004) & (B[:, 2] > eye[2] - 0.13) & (B[:, 2] < eye[2] - 0.01) & (B[:, 1] < eye[1])]
    uu = np.array([proj(q)[0] for q in mids])
    pts['nose_tip'] = proj(mids[np.argmin(uu)])
    for k in ('subnasale', 'menton'):
        pts[k] = proj(np.array([0.0, lf + prof[k][0] / 100, eye[2] + prof[k][1] / 100]))
    q34 = {k: tuple(v - mid) for k, v in pts.items()}
    # (the 3D points, posed, for fit_q34: the concept's 3/4 face isn't the same head at 36 degrees)
    P3 = {'pupil_near': pose(apex), 'pupil_far': pose(cr + rr * gr), 'canthus_in_near': pose(V[face.V_EYE_INNER]),
          'canthus_out_near': pose(V[face.V_EYE_OUTER]), 'alar_near': pose(V[face.V_ALAR]),
          'mouth_near': pose(V[face.V_MOUTH_CORNER]), 'mouth_far': pose(mirror(face.V_MOUTH_CORNER)),
          'nose_tip': pose(mids[np.argmin(uu)])}
    for k in ('subnasale', 'menton'):
        P3[k] = pose(np.array([0.0, lf + prof[k][0] / 100, eye[2] + prof[k][1] / 100]))
    o, i = front['eye_outer'], front['eye_inner']
    sc = {'iris_d': 2 * ri * 100, 'aperture_w': o[0] - i[0], 'aperture_h': front['lid_upper'][1] - front['lid_lower'][1],
          'canthal_tilt': np.degrees(np.arctan2(o[1] - i[1], o[0] - i[0])),
          'iris_cover_top': (front['iris'][1] + ri * 100) - front['lid_upper'][1],
          'sclera_below': front['iris'][1] - ri * 100 - front['lid_lower'][1],
          'canthus_depth': prof['canthus_lat'][0], 'lower_lid_depth': prof['lid_lower'][0],
          'globe_r': r * 100, 'globe_front_depth': prof['globe_front'][0], 'ipd': fr['ipd']}
    return {'front': front, 'profile': prof, 'q34': q34, 'scalars': sc, '_q34_3d': P3,
            '_lids': {k: np.array([rel(q) for q in V[idx][np.argsort(V[idx][:, 0])]]) for k, idx in (('upper', up), ('lower', lo))},
            '_iris_r': ri * 100}


def fit_q34(ref, our):
    """The 3/4 view compared as shapes: the concept's 3/4 face is not the same head seen at 36 degrees
    (its eyes project 5.6 cm apart, which at 36 degrees needs a 6.9 cm spacing; the front says 5.7), so
    fit the view's yaw (15-55 degrees) and scale and an offset to it (least squares over the shared
    landmarks), then compare. Returns (yaw, scale, {name: (u, v)} ours in the concept's frame)."""
    keys = [k for k in ref['q34'] if k in our['_q34_3d']]
    R = np.array([ref['q34'][k] for k in keys])
    P = np.array([our['_q34_3d'][k] for k in keys]) * 100
    best = None
    for yaw in np.arange(15.0, 55.1, 0.5):
        a = np.radians(yaw)
        Q = np.c_[P @ [np.cos(a), np.sin(a), 0.0], P[:, 2]]
        Qc, Rc = Q - Q.mean(0), R - R.mean(0)
        sc = (Qc * Rc).sum() / (Qc * Qc).sum()
        err = ((sc * Qc - Rc) ** 2).sum()
        if best is None or err < best[0]:
            best = (err, yaw, sc, {k: tuple(sc * q + R.mean(0)) for k, q in zip(keys, Qc)})
    return best[1], best[2], best[3]


EYE_SCALARS = [('iris_d', 'iris diameter'), ('aperture_w', 'aperture width (canthus to canthus)'),
               ('aperture_h', 'aperture height at the pupil'), ('canthal_tilt', 'canthal tilt (deg, outer up +)'),
               ('iris_cover_top', 'upper lid over the iris top (+ covers)'),
               ('sclera_below', 'sclera shown below the iris (+ shows)'),
               ('canthus_depth', 'lateral canthus behind the upper lid front'),
               ('lower_lid_depth', 'lower lid front behind the upper')]


def table(ref, our):
    """Rows (group, name, concept, ours, ours - concept): the eye system's scalars (mm; degrees for
    the tilt), then every shared landmark per view (mm, both axes)."""
    rows = []
    for k, label in EYE_SCALARS:
        f = 1 if k == 'canthal_tilt' else 10
        rows.append(('eye', label, ref['scalars'][k] * f, our['scalars'][k] * f, (our['scalars'][k] - ref['scalars'][k]) * f))
    yaw, scale, q34 = fit_q34(ref, our)
    rows.append(('q34', f'(fitted view: yaw {yaw:.1f} deg, scale {scale:.3f})', 0.0, 0.0, 0.0))
    for view in ('front', 'profile', 'q34'):
        mine = q34 if view == 'q34' else our[view]
        for k, v in ref[view].items():
            if k in mine:
                o = mine[k]
                rows.append((view, k, tuple(np.round(np.array(v) * 10, 1)), tuple(np.round(np.array(o) * 10, 1)),
                             tuple(np.round((np.array(o) - v) * 10, 1))))
    return rows


def print_table(rows):
    for g, k, a, b, d in rows:
        if isinstance(a, tuple):
            print(f'  {g:7s} {k:18s} concept ({a[0]:6.1f},{a[1]:6.1f})  ours ({b[0]:6.1f},{b[1]:6.1f})  d ({d[0]:+5.1f},{d[1]:+5.1f})  |d| {np.hypot(*d):5.1f} mm')
        else:
            print(f'  {g:7s} {k:44s} concept {a:7.2f}  ours {b:7.2f}  d {d:+7.2f}')


def overlays(ref, our, out, renders=None):
    """The concept's close-ups and 3/4 face with both landmark sets (concept green, ours red, a line
    between each pair), our lid margins and iris (front); renders: {view: png} of ours in the same
    framing (lib/review.faces, lib/review.region) are shown beside and blended. Writes out (png)."""
    from PIL import Image, ImageDraw
    sheet = Image.open(SHEET).convert('RGB')
    ipd = our['scalars']['ipd']
    s, sp = _scales(ipd)
    S = _sheet_scale()
    f, p = face.REF_FRONT, face.REF_PROFILE
    zp, cx = f['pupil_l'][1], f['mid_x']
    mu, mv = (np.array(Q34['pupil_near']) + Q34['pupil_far']) / 2
    views = [('front', face.FRONT_BOX, 3, lambda q: (cx - q[0] / s, zp - q[1] / s)),
             ('profile', face.PROFILE_BOX, 3, lambda q: (p['eye'][0] + q[0] / sp, p['eye'][1] - q[1] / sp)),
             ('q34', (985, 95, 1085, 185), 8, lambda q: (mu + q[0] / S, mv - q[1] / S))]
    ours_by_view = {'front': our['front'], 'profile': our['profile'], 'q34': fit_q34(ref, our)[2]}
    tiles = []
    for name, box, k, to_px in views:
        img = sheet.crop(box).resize(((box[2] - box[0]) * k, (box[3] - box[1]) * k), Image.LANCZOS)
        d = ImageDraw.Draw(img)
        P = lambda q: ((to_px(q)[0] - box[0]) * k, (to_px(q)[1] - box[1]) * k)
        if name == 'front':
            for lid in our['_lids'].values():
                d.line([P(q) for q in lid], fill=(255, 80, 80), width=2)
            for side in ('upper', 'lower'):
                pts = face.REF_EYE_UPPER if side == 'upper' else face.REF_EYE_LOWER
                d.line([((x - box[0]) * k, (y - box[1]) * k) for x, y in pts], fill=(80, 255, 80), width=2)
            for q, rr, col in ((ref['front']['iris'], ref['scalars']['iris_d'] / 2, (80, 255, 80)),
                               (our['front']['iris'], our['_iris_r'], (255, 80, 80))):
                u, v = P(q); R = rr / s * k
                d.ellipse([u - R, v - R, u + R, v + R], outline=col, width=2)
        for key, a in ref[name].items():
            if key not in ours_by_view[name]:
                continue
            b = ours_by_view[name][key]
            ua, va = P(a); ub, vb = P(b)
            d.line([(ua, va), (ub, vb)], fill=(255, 255, 0), width=1)
            d.ellipse([ua - 4, va - 4, ua + 4, va + 4], outline=(80, 255, 80), width=2)
            d.line([(ub - 5, vb - 5), (ub + 5, vb + 5)], fill=(255, 80, 80), width=2)
            d.line([(ub - 5, vb + 5), (ub + 5, vb - 5)], fill=(255, 80, 80), width=2)
        row = [img]
        if renders and renders.get(name):
            o = Image.open(renders[name]).convert('RGB').resize(img.size, Image.LANCZOS)
            row += [o, Image.blend(sheet.crop(box).resize(img.size, Image.LANCZOS), o, 0.5)]
        tiles.append((name, row))
    W = max(sum(i.width + 6 for i in row) for _, row in tiles)
    canvas = Image.new('RGB', (W, sum(row[0].height + 22 for _, row in tiles)), (25, 25, 25))
    d = ImageDraw.Draw(canvas)
    y = 0
    for name, row in tiles:
        d.text((4, y + 4), f'{name}: concept (green) vs ours (red)' + (' | our render | blend' if len(row) > 1 else ''), fill=(255, 230, 150))
        x = 0
        for im in row:
            canvas.paste(im, (x, y + 22)); x += im.width + 6
        y += row[0].height + 22
    canvas.save(out)
