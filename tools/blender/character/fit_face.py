"""Least-squares fit of the base woman's face to the concept's close-ups.

Targets (lib/face.py), relative to the pupil, the concept scaled to our interpupillary distance:
  * landmarks (front): eye corners and lid margins, alar wings, mouth corners, the chin's corners,
    and the midline heights (nose tip, subnasale, lips, menton)
  * silhouettes against the backdrop — no shading involved: the front view's half-width below the
    ears (the jaw's edge, then the neck's), the profile's front edge from the brow to the neck
    (depths from the iris), and the jaw's underside in profile from the chin to the neck
  * the head's placement: the pupils' height on the sheet
Variables: MakeHuman's face and neck modifiers, and the eyes' depth in their sockets (a
flat-topped stroke that sets the eyelids and eyeballs back under the brow). Gauss-Newton with
numerical derivatives, modifiers within their bounds and mildly pulled to 0. Updates the face
modifiers, the eye depth and the socket stroke in woman.json.

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_face.py [--dry]
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from lib import mh, face, sculpt, measure
from character import woman

FIT = [
    'eyes/l-eye-scale', 'eyes/l-eye-trans-in|out', 'eyes/l-eye-height1', 'eyes/l-eye-height2',
    'eyes/l-eye-height3', 'eyes/l-eye-corner1', 'eyes/l-eye-corner2',
    'nose/nose-scale-vert', 'nose/nose-scale-horiz', 'nose/nose-trans-down|up', 'nose/nose-trans-backward|forward',
    'nose/nose-nostrils-width', 'nose/nose-hump', 'nose/nose-scale-depth',
    'mouth/mouth-scale-horiz', 'mouth/mouth-trans-backward|forward', 'mouth/mouth-trans-down|up',
    'mouth/mouth-upperlip-volume', 'mouth/mouth-lowerlip-volume', 'mouth/mouth-scale-depth', 'mouth/mouth-cupidsbow',
    'chin/chin-prominent', 'chin/chin-width', 'chin/chin-height', 'chin/chin-bones', 'chin/chin-prognathism',
    'chin/chin-jaw-drop',
    'cheek/l-cheek-bones', 'cheek/l-cheek-volume', 'cheek/l-cheek-inner',
    'head/head-scale-vert', 'head/head-invertedtriangular', 'forehead/forehead-trans-backward|forward',
    'forehead/forehead-scale-vert',
    'eyebrows/eyebrows-trans-backward|forward',
    'neck/neck-scale-vert', 'neck/neck-double', 'neck/neck-scale-horiz', 'neck/neck-scale-depth',
    'eye_depth',
]
# gentle bounds: modifiers stacked at their limits fought each other and distorted the face (a
# brow shelf, gaunt cheeks) while the numbers matched. eye-scale moves only the lids (not the
# eyeball): opened past MakeHuman's range to the concept's wide almond eyes.
BOUNDS = {'cheek/l-cheek-volume': (0.0, 0.6), 'neck/neck-scale-vert': (-0.6, 0.0),
          'eyes/l-eye-scale': (0.0, 1.4), 'neck/neck-double': (-1.0, 0.0),
          'eye_depth': (0.0, 0.8)}   # cm
BOUND = 0.6
REG = 0.5        # cm of residual per unit of modifier
EYE_Z = 1.560    # m, the pupils' height on the sheet (front and side views agree); the vertex 1.68
W_SIL = 0.6      # silhouettes are dense (many rows): weighted so the landmarks still count
SOCKET = {'r': [0.02, 0.02, 0.016], 'p': 4}   # the eye socket stroke's reach (m), flat-topped

P = woman.params()
PICK = None
G = mh.load_base()['groups']
EYE_L, EYE_R = sorted(G['helper-l-eye']), sorted(G['helper-r-eye'])
E = measure.mesh_edges(mh.load_base()['F'])


def expand(vals):
    """Fit names → modifier values: 'group/l-name' drives both sides (symmetric face)."""
    out = {}
    for k, v in vals.items():
        if k == 'eye_depth':
            continue
        g, n = k.split('/')
        if n.startswith('l-'):
            for side in ('l-', 'r-'):
                out[f'{g}/{side}{n[2:]}'] = v
        else:
            out[f'{g}/{n}'] = v
    return out


def shaped(vals):
    """All vertices (body + helpers, rest frame) with the modifiers and the eye sockets applied."""
    mods = dict(P['modifiers'])
    mods.update(expand(vals))
    V = woman.rest_vertices(dict(P, modifiers=mods))   # (as the build: the head's blend, the neck-anchored scale)
    m = vals.get('eye_depth', 0.0) / 100
    if m:
        c = V[EYE_L].mean(0)
        V[:mh.BODY_VERTS] = sculpt.grab(V[:mh.BODY_VERTS], [dict(SOCKET, c=c.tolist(), d=[0, m, 0])])
        V[EYE_L] += [0, m, 0]
        V[EYE_R] += [0, m, 0]
    return V


# fixed-vertex landmarks only (the midline's extrema — nose tip, subnasale, stomion, menton —
# jump between features as the shape changes; the profile silhouette carries those heights)
FRONT = ['eye_outer', 'eye_inner', 'lid_upper', 'lid_lower', 'alar', 'mouth_corner', 'lip_top', 'lip_bottom',
         'chin_side']
MID = ('lip_top', 'lip_bottom')
WEIGHT = {'eye_outer': 2.0, 'eye_inner': 2.0, 'chin_side': 0.5}   # (the chin's corners: read off shading)
SIL = None


def residual(x, detail=False):
    V = shaped(dict(zip(FIT, x)))
    fo, po, _ = face.ours(V, PICK)
    fr, _ = face.ref_landmarks(fo['ipd'])
    r, names = [], []
    for k in FRONT:
        for j, ax in ((0, 'x'), (1, 'z')):
            if k in MID and ax == 'x':
                continue
            r.append((fo[k][j] - fr[k][j]) * WEIGHT.get(k, 1.0)); names.append(f'front {k}.{ax}')
    sf, sp, su = SIL
    a, b, c = face.our_silhouettes(V, [q[0] for q in sf], [q[0] for q in sp], [q[0] for q in su], E)
    r += list((a - [q[1] for q in sf]) * W_SIL); names += [f'front edge z{q[0]:.1f}' for q in sf]
    r += list((b - [q[1] for q in sp]) * W_SIL); names += [f'profile edge z{q[0]:.1f}' for q in sp]
    r += list((c - [q[1] for q in su]) * W_SIL); names += [f'under-jaw y{q[0]:.1f}' for q in su]
    r.append((fo['eye_z_abs'] - EYE_Z) * 100); names.append('eye height')
    r.append((V[:mh.BODY_VERTS, 2].max() - 1.68) * 100); names.append('vertex height')
    r = np.nan_to_num(np.array(r))
    if detail:
        return r, names
    return np.r_[r, REG * x]


x = np.array([0.0] * len(FIT))
for i, k in enumerate(FIT):  # start from the saved values
    x[i] = P.get('eye_depth', 0.0) * 100 if k == 'eye_depth' else P['modifiers'].get(list(expand({k: 1}).keys())[0], 0.0)
V0 = shaped(dict(zip(FIT, x)))
fo0, _, PICK = face.ours(V0)          # the lid/profile vertices, fixed from here on
fr0, pr0, un0 = face.ref_silhouettes(fo0['ipd'])
SIL = (fr0[::2], pr0[::2], un0[::2])
LO = np.array([BOUNDS.get(k, (-BOUND, BOUND))[0] for k in FIT])
HI = np.array([BOUNDS.get(k, (-BOUND, BOUND))[1] for k in FIT])
x = np.clip(x, LO, HI)
nreg = len(FIT)


def rms(rr):
    return np.sqrt(np.mean(rr[:-nreg] ** 2))


print(f'start rms {rms(residual(x)):.3f} cm', flush=True)
for it in range(10):
    r = residual(x)
    J = np.empty((len(r), len(x)))
    for j in range(len(x)):
        xp = x.copy(); xp[j] += 0.2
        J[:, j] = (residual(xp) - r) / 0.2
    dx = np.linalg.lstsq(J, -r, rcond=None)[0]
    step = 1.0
    while step > 0.05:
        xn = np.clip(x + step * dx, LO, HI)
        if np.sum(residual(xn) ** 2) < np.sum(r ** 2):
            break
        step /= 2
    else:
        break
    x = xn
    print(f'iter {it + 1}: rms {rms(residual(x)):.3f} cm', flush=True)
    if np.abs(step * dx).max() < 0.01:
        break
r, names = residual(x, detail=True)
groups = {}
for n, v in zip(names, r):
    groups.setdefault(n.split(' z')[0].split(' y')[0], []).append(v)
print('  ' + '  '.join(f'{g}: {np.sqrt(np.mean(np.square(v))):.2f}' for g, v in groups.items() if len(v) > 3))
for n, v in sorted(zip(names, r), key=lambda q: -abs(q[1]))[:14]:
    print(f'  {n:24s} {v:+.2f} cm')
vals = {k: round(float(v), 3) for k, v in zip(FIT, x)}
print(json.dumps(vals, indent=1))
if '--dry' not in sys.argv:
    saved = json.load(open(woman.PARAMS))
    saved['modifiers'].update(expand(vals))
    m = vals['eye_depth'] / 100
    saved['eye_depth'] = m
    # the socket stroke, in the build's frame: the rest head plus the grounding of the posed body
    skin = woman.posed_skin(P)
    rest = woman.body_vertices(dict(P, modifiers={**P['modifiers'], **expand(vals)}))
    dz = -mh.lbs(rest, *skin)[:, 2].min()
    c = shaped({k: v for k, v in vals.items() if k != 'eye_depth'})[EYE_L].mean(0) + [0, 0, dz]
    saved['sculpt'] = [s for s in saved.get('sculpt', []) if not s['name'].startswith('eye sockets')]
    if m:
        saved['sculpt'].append(dict(SOCKET, name='eye sockets: the eyes set back under the brow (fit_face)',
                                    c=[round(float(q), 4) for q in c], d=[0, round(m, 4), 0]))
    json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
    print('wrote', woman.PARAMS)
