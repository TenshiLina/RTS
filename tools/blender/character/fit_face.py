"""Least-squares fit of MakeHuman's face modifiers to the concept's facial landmarks.

Landmarks (lib/face.py): eye corners and lid margins, alar wings, mouth corners, the midline
heights (nose tip, subnasale, lips, menton), the chin's corners, the face outline's half-width by
height (cheekbones to the jaw angle), the profile points (nasion to menton), and the cranium's
the head's placement (the pupils' and the chin's heights on the sheet, which set the neck's
length and the cranium's height under the 1.68 m vertex). Relative to the pupil, the concept
scaled to our interpupillary distance. Gauss-Newton with numerical derivatives; modifiers within ±BOUND, mildly pulled to 0.
Updates the face modifiers in woman.json.

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_face.py [--dry]
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from lib import mh, face
from character import woman

FIT = [
    'eyes/l-eye-scale', 'eyes/l-eye-trans-in|out', 'eyes/l-eye-height1', 'eyes/l-eye-height2',
    'eyes/l-eye-height3', 'eyes/l-eye-corner1', 'eyes/l-eye-corner2',
    'nose/nose-scale-vert', 'nose/nose-scale-horiz', 'nose/nose-trans-down|up', 'nose/nose-trans-backward|forward',
    'nose/nose-nostrils-width', 'nose/nose-hump', 'nose/nose-scale-depth',
    'mouth/mouth-scale-horiz', 'mouth/mouth-trans-backward|forward', 'mouth/mouth-trans-down|up',
    'mouth/mouth-upperlip-volume', 'mouth/mouth-lowerlip-volume', 'mouth/mouth-scale-depth',
    'chin/chin-prominent', 'chin/chin-width', 'chin/chin-height', 'chin/chin-bones', 'chin/chin-prognathism',
    'cheek/l-cheek-bones', 'cheek/l-cheek-volume',
    'head/head-scale-vert', 'neck/neck-scale-vert', 'mouth/mouth-cupidsbow',
]
# bounds (default ±BOUND): full cheeks (the concept's are soft and full; the jaw tapers, not the cheek)
BOUNDS = {'cheek/l-cheek-volume': (0.0, 1.0), 'neck/neck-scale-vert': (-1.0, 0.0)}
BOUND = 1.0
REG = 0.3        # cm of residual per unit of modifier
EYE_Z = 1.560    # m, the pupils' height on the sheet (front and side views agree); the vertex is 1.68
OUTLINE_W = 0.7  # the outline is traced on the sheet less precisely than the point landmarks

P = woman.params()
PICK = None


def expand(vals):
    """Fit names → modifier values: 'group/l-name' drives both sides (symmetric face)."""
    out = {}
    for k, v in vals.items():
        g, n = k.split('/')
        if n.startswith('l-'):
            for side in ('l-', 'r-'):
                out[f'{g}/{side}{n[2:]}'] = v
        else:
            out[f'{g}/{n}'] = v
    return out


def landmarks(vals):
    mods = dict(P['modifiers'])
    mods.update(expand(vals))
    t = {**woman.TARGETS, **mh.breast_targets(P['breast']['size'], P['breast']['firmness'])}
    t.update(mh.modifier_targets(mods))
    V = face.all_vertices(t)
    return V, face.ours(V, PICK)


FRONT = ['eye_outer', 'eye_inner', 'lid_upper', 'lid_lower', 'alar', 'nose_tip', 'subnasale', 'mouth_corner',
         'lip_top', 'stomion', 'lip_bottom', 'chin_side', 'menton']
PROFILE = ['nose_tip', 'subnasale', 'lip_top', 'stomion', 'lip_bottom', 'labiomental', 'pogonion', 'menton',
           'nasion', 'glabella']


def residual(x, detail=False):
    V, (fo, po, _) = landmarks(dict(zip(FIT, x)))
    fr, pr = face.ref_landmarks(fo['ipd'])
    r, names = [], []
    for k in FRONT:
        for j, ax in ((0, 'x'), (1, 'z')):
            if k in ('nose_tip', 'subnasale', 'lip_top', 'stomion', 'lip_bottom', 'menton') and ax == 'x':
                continue
            r.append(fo[k][j] - fr[k][j]); names.append(f'front {k}.{ax}')
    for k in PROFILE:
        r.append(po[k][0] - pr[k][0]); names.append(f'profile {k}.y')
    for zc, hw in fr['outline']:
        r.append((fo['outline_fn'](zc) - hw) * OUTLINE_W); names.append(f'outline z{zc:.1f}')
    r.append((fo['eye_z_abs'] - EYE_Z) * 100); names.append('eye height')
    r = np.nan_to_num(np.array(r))
    if detail:
        return r, names
    return np.r_[r, REG * x]


x = np.array([0.0] * len(FIT))
for i, k in enumerate(FIT):  # start from the saved values
    x[i] = P['modifiers'].get(list(expand({k: 1}).keys())[0], 0.0)
PICK = landmarks(dict(zip(FIT, x)))[1][2]   # the profile/lid vertices, fixed from here on
LO = np.array([BOUNDS.get(k, (-BOUND, BOUND))[0] for k in FIT])
HI = np.array([BOUNDS.get(k, (-BOUND, BOUND))[1] for k in FIT])
x = np.clip(x, LO, HI)
r0 = residual(x)
print(f'start rms {np.sqrt(np.mean(r0[:-len(FIT)] ** 2)):.3f} cm', flush=True)
for it in range(8):
    r = residual(x)
    J = np.empty((len(r), len(x)))
    for j in range(len(x)):
        xp = x.copy(); xp[j] += 0.2
        J[:, j] = (residual(xp) - r) / 0.2
    dx = np.linalg.lstsq(J, -r, rcond=None)[0]
    step = 1.0
    while step > 0.1:
        xn = np.clip(x + step * dx, LO, HI)
        if np.sum(residual(xn) ** 2) < np.sum(r ** 2):
            break
        step /= 2
    x = xn
    rr = residual(x)
    print(f'iter {it + 1}: rms {np.sqrt(np.mean(rr[:-len(FIT)] ** 2)):.3f} cm', flush=True)
    if np.abs(step * dx).max() < 0.01:
        break
r, names = residual(x, detail=True)
for n, v in sorted(zip(names, r), key=lambda q: -abs(q[1]))[:12]:
    print(f'  {n:24s} {v:+.2f} cm')
vals = {k: round(float(v), 3) for k, v in zip(FIT, x)}
print(json.dumps(vals, indent=1))
if '--dry' not in sys.argv:
    saved = json.load(open(woman.PARAMS))
    saved['modifiers'].update(expand(vals))
    json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
    print('wrote', woman.PARAMS)
