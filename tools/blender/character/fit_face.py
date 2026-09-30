"""Least-squares fit of the base woman's face to the concept's close-ups, in a face model's space.

The face is ICT-FaceKit's model on the MakeHuman head (lib/ict.py): the variables are its
identity coefficients (standard deviations of real faces), pulled to 0 by a prior, so the face
stays a plausible real one while it approaches the concept, plus the face's size and height on
the body. (Fitting MakeHuman's face modifiers instead matched the numbers with implausible
combinations: a harsh, masculine face.)

Targets (lib/face.py), relative to the pupil, the concept scaled to our interpupillary distance:
  * landmarks (front): eye corners, alar wings, mouth corners, the chin's corners
  * feature outlines (front): the eye opening along the lash lines (ours: the lash roots) and the
    lips' vermilion by colour (ours: the vermilion border's edge loop)
  * silhouettes against the backdrop — no shading involved: the front view's half-width below the
    ears (the jaw's edge, then the neck's), the profile's front edge from the brow to the neck
    (depths from the iris), and the jaw's underside in profile from the chin to the neck
  * the head's size and placement: the pupils', the chin's and (weakly: under the hair) the
    vertex's heights on the full-body sheet
Also fitted: MakeHuman's neck (length, width, depth) below the model's blend, which places the
head on the body. Heights are the posed figure's (the sheet's stance). Levenberg-Marquardt with numerical
derivatives. Writes 'face_model' and the neck's modifiers to woman.json (and clears the MakeHuman
face modifiers, the head's macro blend and the eye-socket stroke the model replaces).

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_face.py [--dry] [--modes N] [--prior W]
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from lib import mh, face, ict, measure, refviews
from character import woman

FACE_GROUPS = ('eyes', 'nose', 'mouth', 'chin', 'cheek', 'head', 'forehead', 'eyebrows', 'ears')


def arg(name, default):
    return type(default)(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


K = arg('--modes', 100)        # identity modes fitted (of 100)
PRIOR = arg('--prior', 0.15)   # cm of residual per standard deviation of a coefficient
EYE_Z = 1.560    # m, the pupils' height on the sheet (front and side views agree); the vertex 1.68
MENTON_Z = 1.463 # m, the chin's lowest point on the sheet (front 1.466, side 1.461): the concept's face
                 # is small for its body (eye to chin 9.7 cm; an average woman's is ~11)
W_SIL = 0.6      # silhouettes are dense (many rows): weighted so the landmarks still count
W_EYE, W_LIP = 1.5, 1.0   # the features' outlines: the eye opening (lash line), the lips (colour)
FRONT = ['eye_outer', 'eye_inner', 'alar', 'mouth_corner', 'chin_side']
# (the chin's corners: read off shading; the alar wing: a fixed vertex, which the face model's
# registration puts near but not exactly at the wing's widest point)
WEIGHT = {'eye_outer': 2.0, 'eye_inner': 2.0, 'chin_side': 0.5, 'alar': 0.5}
W_HEIGHT = 3.0   # the head's size and height on the body (the full-body sheet's eyes and chin): a few
W_VERTEX = 0.6   # numbers against hundreds of outline samples, weighted to count; the vertex is under the hair
W_FULL = 1.0     # the face's absolute width on the full-body sheet (its jaw, below the ears; 1.8 mm/px)
FULL_JAW = np.array(face.ref_full_jaw())
W_NOSE = 2.0     # the profile from the nose's tip to the upper lip: every row, weighted (the tip's
NOSE_Z = (-6.3, -2.4)   # rotation and the columella's line are a few mm of outline; cm from the pupil)
# the brow ridge's projection beside the midline is capped at MakeHuman's female head's (+1 mm): the
# concept's brow is soft, and the fit otherwise pushes the brows forward with the glabella
BROW_X = [2.6, 3.2, 3.8, 4.4]                # cm from the midline
BROW_MAX = [-0.75, -0.60, -0.45, -0.30]      # cm from the iris plane (forward is -): no further forward
W_BROW = 3.0     # (a projecting outer brow shades the eye and reads masculine: the concept's doesn't)
W_EAR = 1.0      # the ears: their traced top, lobe, back and front (lib/face.REF_EAR)
# variables: K coefficients, the face's scale and height (m) on the body, then the detail modifiers:
# the lids' size (MakeHuman's eye-scale opens the lids about the eyeball, which stays) — the
# concept's eyes are wider than the real faces' the model spans
DETAIL = []      # (MakeHuman's eye-scale opened the lids but folded the lower lid on the model's face)
LIDS = ['w', 'h', 'tilt']   # the eyes' openings (lib/ict.lid_warp), about the eyeballs, and their canthal tilt
BROW = ['flat']     # the brow ridge flattened toward the lid-to-forehead line (lib/ict.brow_warp)
EYES = ['fwd']      # the eyes brought forward in their sockets (lib/ict.eye_warp)
# the eye as one system (lib/ict.eye_system): the globe's radius (anatomical: 11-12.8 mm; the model's
# shell is ~16 mm and filled the socket), its set-back, and how far the lids wrap beyond its outline —
# the lids settle onto it in depth, so the aperture's outline (front) stays what the other targets make it
EYESYS = ['r', 'back', 'wrap']
W_CANTHUS = 1.0  # the lateral canthus' depth behind the upper lid's front (profile): the lids' wrap
W_LLID = 2.0     # the lower lid's front behind the upper's (profile): the eye's lean
W_GLOBE = 1.0    # the globe's front 0.7 mm behind the upper lid's front (its cornea, 0.7 mm proud, at the lid)
IRIS = 0.171     # the iris' diameter over the eyes' spacing (the concept's: 12 px at 70)
# and MakeHuman's neck (below the face model's blend): its length sets where the head sits on the
# body (the face's own height offset would squeeze the blend into the neck), its width and depth the
# neck's silhouettes
NECK = ['neck/neck-scale-vert', 'neck/neck-scale-horiz', 'neck/neck-scale-depth']
JN = K + 2 + len(DETAIL)                # (the first neck variable)
# and the ears' size and placement (lib/ict.ear_warp): the model's ears are small for the concept's
EARS = ['scale', 'vert', 'rot', 'wing', 'dy', 'dz']
JE = JN + len(NECK)
JL = JE + len(EARS)
JB = JL + len(LIDS)
JF = JB + len(BROW)
JS = JF + len(EYES)
LO = np.r_[np.full(K, -3.0), 0.8, -0.03, np.full(len(NECK), -1.0), 0.8, 0.8, -25, -30, -0.015, -0.015, 0.75, 0.75, -12.0, 0.0, 0.0, 0.0110, -0.002, -0.6]
HI = np.r_[np.full(K, 3.0), 1.1, 0.03, np.full(len(NECK), 1.0), 1.6, 1.3, 25, 30, 0.015, 0.015, 1.25, 1.25, 12.0, 1.0, 0.008, 0.0128, 0.003, 0.6]
REGW = np.r_[np.full(K, PRIOR), 0.1 / 0.1, 0.4 / 0.01, np.full(len(NECK), 0.3),
             0.5 / 0.3, 0.5 / 0.3, 0.5 / 30, 0.5 / 30, 0.5 / 0.01, 0.5 / 0.01, 0.3 / 0.1, 0.3 / 0.1, 0.3 / 5.0, 0.3 / 1.0, 0.3 / 0.005,
             0.3 / 0.001, 0.3 / 0.002, 0.3 / 0.5]   # (scale: weak; height: 1 cm per cm; lids, neck: 0.3 cm per unit; ears: mild; the globe: toward 11.8 mm)
X0 = np.r_[np.zeros(K), 1.0, 0.0, np.zeros(len(NECK)), 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0118, 0.0, 0.0]   # (the neck's: set to the saved values below)

P = woman.params()
P['modifiers'] = {k: (0.0 if k.split('/')[0] in FACE_GROUPS else v) for k, v in P['modifiers'].items()}
P['face'] = {}
P['face_model'] = None
REG = ict.registration()
EAR_L = ict.mh_ears('l', REG)
E = measure.mesh_edges(mh.load_base()['F'])
_base = {}


def base(neck):
    """MakeHuman without its head's shape (the model replaces it), for the neck's modifiers (cached)."""
    key = tuple(np.round(neck, 6))
    if key not in _base:
        mods = dict(P['modifiers'], **dict(zip(NECK, neck)))
        _base.clear()
        _base[key] = (woman.rest_vertices(dict(P, modifiers=mods)), mh.to_blender.scale)
    return _base[key]


def shaped(x):
    fm = {'coeffs': x[:K], 'scale': x[K], 'dz': x[K + 1], 'detail': dict(zip(DETAIL, x[K + 2:JN])),
          'ears': dict(zip(EARS, x[JE:JL])), 'lids': dict(zip(LIDS, x[JL:JB])), 'brow': dict(zip(BROW, x[JB:JF])),
          'eyes': dict(zip(EYES, x[JF:JS])), 'eye_system': dict(zip(EYESYS, x[JS:]))}
    V, mh.to_blender.scale = base(x[JN:JE])
    return woman.face_morph({'face_model': fm, 'neck_shift': P.get('neck_shift')})(V)


def posed_head(p):
    """The head's pose in the sheet's stance (rest → world, 4×4): the sheet's heights are the posed,
    grounded figure's (posing re-grounds the body, and the neck's pose moves the head)."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, arm = woman.build(p, bake=False)
    bpy.context.view_layer.update()
    pb = arm.pose.bones['head']
    return np.array(arm.matrix_world) @ np.array(pb.matrix) @ np.linalg.inv(np.array(pb.bone.matrix_local))


def residual(x, detail=False):
    V = shaped(x)
    fo, po, _ = face.ours(V, PICK)
    fr, _ = face.ref_landmarks(fo['ipd'])
    r, names = [], []
    for k in FRONT:
        for j, ax in ((0, 'x'), (1, 'z')):
            r.append((fo[k][j] - fr[k][j]) * WEIGHT.get(k, 1.0)); names.append(f'front {k}.{ax}')
    # the concept's outlines are in proportion to the eyes' spacing: scaled to ours as it changes
    kk = fo['ipd'] / IPD0
    sf, sp, su = (np.asarray(q, float) * kk for q in SIL)
    a, b, c = face.our_silhouettes(V, sf[:, 0], sp[:, 0], su[:, 0], E)
    r += list((a - sf[:, 1]) * W_SIL); names += [f'front edge z{q:.1f}' for q in sf[:, 0]]
    wp = np.where((sp[:, 0] > NOSE_Z[0] * kk) & (sp[:, 0] < NOSE_Z[1] * kk), W_NOSE, W_SIL)
    r += list((b - sp[:, 1]) * wp); names += [f'profile edge z{q:.1f}' for q in sp[:, 0]]
    r += list((c - su[:, 1]) * W_SIL); names += [f'under-jaw y{q:.1f}' for q in su[:, 0]]
    ex, lx = np.asarray(FEAT[0]) * kk, FEAT[2] * kk
    ez, lz = face.our_features(V, ex, lx)
    for k in ('upper', 'lower'):
        r += list((ez[k] - FEAT[1][k] * kk) * W_EYE); names += [f'eye {k} x{v:.1f}' for v in ex]
    for k in ('top', 'bottom'):
        r += list((lz[k] - FEAT[3][k] * kk) * W_LIP); names += [f'lips {k} x{v:.1f}' for v in lx]
    nz = NAPE[:, 0] * kk
    r += list((face.our_nape(V, nz, E) - NAPE[:, 1] * kk) * W_SIL); names += [f'nape z{q:.1f}' for q in nz]
    bd, _ = face.our_brow(V, np.asarray(BROW_X) * kk)
    r += list(np.minimum(0.0, bd - np.asarray(BROW_MAX) * kk) * W_BROW); names += [f'brow ridge x{v:.1f}' for v in BROW_X]
    er, eo = face.ref_ear(fo['ipd']), face.our_ear(V, EAR_L)
    for k in ('top', 'bottom', 'back', 'front'):
        for j, ax in ((0, 'depth'), (1, 'z')):
            if (k, ax) == ('front', 'z'):
                continue   # (our ear's frontmost point is its lobe's root, the concept's the tragus)
            r.append((eo[k][j] - er[k][j]) * W_EAR); names.append(f'ear {k}.{ax}')
    r.append((eo['out'] - er['out']) * W_EAR); names.append('ear out')
    # the eye as one system, in profile: the lateral canthus' depth (the lids' wrap), the lower lid's
    # front (the lean), the globe's front against the upper lid (its cornea at the lid)
    _, lf = face.lid_front(V)
    Eh = V[HELPER_L]; gc = Eh.mean(0); gr = np.linalg.norm(Eh - gc, axis=1).mean()
    r.append(((V[face.V_EYE_OUTER][1] - lf) * 100 - EYEREF['canthus_depth'] * kk) * W_CANTHUS); names.append('eye canthus depth')
    r.append((refviews.lower_lid(V)[0] - EYEREF['lower_lid_depth'] * kk) * W_LLID); names.append('eye lower lid depth')
    r.append(((gc[1] - gr - lf) * 100 - 0.07) * W_GLOBE); names.append('eye globe front')
    posed_z = lambda q: HEAD[2, :3] @ q + HEAD[2, 3]
    eye = fo['_ref'][0]
    ez_posed = posed_z(eye)
    fj = face.our_silhouettes(V, (FULL_JAW[:, 0] - ez_posed) * 100, [], [], E)[0]
    r += list((fj - FULL_JAW[:, 1] * 100) * W_FULL); names += [f'full-body jaw z{q:.3f}' for q in FULL_JAW[:, 0]]
    r.append((posed_z(eye) - EYE_Z) * 100 * W_HEIGHT); names.append('eye height')
    r.append((posed_z(eye + [0, 0, po['menton'][1] / 100]) - MENTON_Z) * 100 * W_HEIGHT); names.append('menton height')
    r.append(((V[:mh.BODY_VERTS] @ HEAD[2, :3]).max() + HEAD[2, 3] - 1.68) * 100 * W_VERTEX); names.append('vertex height')
    r = np.nan_to_num(np.array(r))
    if detail:
        return r, names
    return np.r_[r, REGW * (x - X0)]


saved = json.load(open(woman.PARAMS))
x = X0.copy()
if saved.get('face_model'):   # start from the saved fit
    fm = saved['face_model']
    c = fm['coeffs'][:K]
    x[:len(c)] = c
    x[K], x[K + 1] = fm.get('scale', 1.0), fm.get('dz', 0.0)
    for i, k in enumerate(DETAIL):
        x[K + 2 + i] = (fm.get('detail') or {}).get(k, 0.0)
for i, k in enumerate(NECK):
    x[JN + i] = X0[JN + i] = saved['modifiers'].get(k, 0.0)
for i, k in enumerate(EARS):
    x[JE + i] = ((saved.get('face_model') or {}).get('ears') or {}).get(k, X0[JE + i])
for i, k in enumerate(LIDS):
    x[JL + i] = ((saved.get('face_model') or {}).get('lids') or {}).get(k, X0[JL + i])
for i, k in enumerate(BROW):
    x[JB + i] = ((saved.get('face_model') or {}).get('brow') or {}).get(k, X0[JB + i])
for i, k in enumerate(EYES):
    x[JF + i] = ((saved.get('face_model') or {}).get('eyes') or {}).get(k, X0[JF + i])
for i, k in enumerate(EYESYS):
    x[JS + i] = ((saved.get('face_model') or {}).get('eye_system') or {}).get(k, X0[JS + i])
HELPER_L = sorted(mh.load_base()['groups']['helper-l-eye'])
HEAD = posed_head(dict(P, modifiers=dict(P['modifiers'], **dict(zip(NECK, x[JN:JE]))), face_model=saved.get('face_model')))
V0 = shaped(x)
fo0, _, PICK = face.ours(V0)          # the lid/profile vertices, fixed from here on
IPD0 = fo0['ipd']
EYEREF = refviews.concept(IPD0)['scalars']
fr0, pr0, un0 = face.ref_silhouettes(fo0['ipd'])
NAPE = np.array(face.ref_nape(fo0['ipd'])[::2])
_nose = lambda q: NOSE_Z[0] < q[0] < NOSE_Z[1]
SIL = (fr0[::2], [q for i, q in enumerate(pr0) if i % 2 == 0 or _nose(q)], un0[::2])
_eye, _lips = face.ref_features(fo0['ipd'])
_ex = [q[0] for q in _eye['upper']][1:-1]   # (the corners: the corner landmarks)
FEAT = (_ex, {k: np.array([q[1] for q in _eye[k]][1:-1]) for k in ('upper', 'lower')},
        np.array(_lips['x'][1:-1]), {k: np.array(_lips[k][1:-1]) for k in ('top', 'bottom')})
nreg = len(x)


def rms(rr):
    return np.sqrt(np.mean(rr[:-nreg] ** 2))


print(f'start rms {rms(residual(x)):.3f} cm', flush=True)
STEP = np.r_[np.full(K, 0.25), 0.01, 0.002, np.full(len(NECK), 0.1), 0.02, 0.02, 2.0, 2.0, 0.001, 0.001, 0.02, 0.02, 0.5, 0.05, 0.0005,
             0.0002, 0.0002, 0.05]
lam = 1e-3   # Levenberg-Marquardt: a few of the measures are piecewise (extrema, nearest points), so a
for it in range(15):   # plain Gauss-Newton step can fail; damping then shortens and turns it
    r = residual(x)
    J = np.empty((len(r), len(x)))
    for j in range(len(x)):
        xp = x.copy(); xp[j] += STEP[j]
        J[:, j] = (residual(xp) - r) / STEP[j]
    A, g = J.T @ J, J.T @ r
    D = np.diag(np.maximum(np.diag(A), 1e-9))
    c0 = np.sum(r ** 2)
    while lam < 1e4:
        dx = np.linalg.solve(A + lam * D, -g)
        xn = np.clip(x + dx, LO, HI)
        if np.sum(residual(xn) ** 2) < c0:
            lam = max(lam / 3, 1e-6)
            break
        lam *= 10
    else:
        break
    x = xn
    print(f'iter {it + 1}: rms {rms(residual(x)):.3f} cm, |coeffs| {np.linalg.norm(x[:K]):.2f} '
          f'(max {np.abs(x[:K]).max():.2f}), scale {x[K]:.3f}, dz {x[K + 1] * 100:.2f} cm, '
          f'detail {np.round(x[K + 2:JN], 2).tolist()}, neck {np.round(x[JN:JE], 2).tolist()}, '
          f'ears {np.round(x[JE:JL], 3).tolist()}, lids {np.round(x[JL:JB], 3).tolist()}, brow {np.round(x[JB:JF], 2).tolist()}, eyes fwd {x[JF] * 100:.2f} cm, globe r {x[JS] * 1000:.2f} mm back {x[JS + 1] * 1000:.2f} mm wrap {x[JS + 2]:.2f}', flush=True)
    if np.abs(dx).max() < 0.01 and c0 - np.sum(residual(x) ** 2) < 1e-3:
        break
r, names = residual(x, detail=True)
groups = {}
for n, v in zip(names, r):
    groups.setdefault(n.split(' z')[0].split(' y')[0].split(' x')[0], []).append(v)
print('  ' + '  '.join(f'{g}: {np.sqrt(np.nanmean(np.square(v))):.2f}' for g, v in groups.items() if len(v) > 3))
for n, v in sorted(zip(names, r), key=lambda q: -abs(q[1]))[:14]:
    print(f'  {n:24s} {v:+.2f} cm')
fm = {'coeffs': [round(float(v), 3) for v in x[:K]], 'scale': round(float(x[K]), 4), 'dz': round(float(x[K + 1]), 5),
      'detail': {k: round(float(v), 3) for k, v in zip(DETAIL, x[K + 2:JN])},
      'ears': {k: round(float(v), 4) for k, v in zip(EARS, x[JE:JL])},
      'lids': {k: round(float(v), 4) for k, v in zip(LIDS, x[JL:JB])},
      'brow': {k: round(float(v), 5) for k, v in zip(BROW, x[JB:JF])},
      'eyes': {k: round(float(v), 5) for k, v in zip(EYES, x[JF:JS])},
      'eye_system': dict({k: round(float(v), 5) for k, v in zip(EYESYS, x[JS:])},
                         iris=round(float(IRIS * face.ours(shaped(x))[0]['ipd'] / 100), 5))}
print(json.dumps(fm))
if '--dry' not in sys.argv:
    saved['face_model'] = fm
    saved['modifiers'] = {k: v for k, v in saved['modifiers'].items() if k.split('/')[0] not in FACE_GROUPS}
    saved['modifiers'].update({k: round(float(v), 3) for k, v in zip(NECK, x[JN:JE])})
    saved['face'] = {}
    saved['eye_depth'] = 0.0
    saved['sculpt'] = [s for s in saved.get('sculpt', []) if not s['name'].startswith('eye sockets')]
    json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
    print('wrote', woman.PARAMS)
