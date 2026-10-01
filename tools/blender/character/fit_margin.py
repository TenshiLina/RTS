"""Lay the lid margins along the concept's traced ones (lib/face.REF_EYE_UPPER / REF_EYE_LOWER): solve
lib/ict.margin_warp's profile — the margins' heights across the eye — so the rendered opening
(lib/face.opening: the skin's rim against the eyeball) lands on the trace, column by column; then
store it in the params ('face_model': {'margin': {'x', 'up', 'lo'}}). Run after character/fit_face.py
(the fit shapes the lids with a few broad parameters; this lays the margin itself, last).

ARGS: [params.json] [--iters N]   (default: character/woman.json, 8 iterations; writes it back)"""
import os
import sys
import json
import numpy as np
BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, BASE)
from character import woman
from lib import face, ict

path = next((a for a in sys.argv[1:] if a.endswith('.json')), os.path.join(BASE, 'character', 'woman.json'))
iters = int(sys.argv[sys.argv.index('--iters') + 1]) if '--iters' in sys.argv else 8
woman.PARAMS = path
p = woman.params()
p['face_model'].pop('margin', None)
V0 = woman.rest_vertices(p)
el, er = face.eye_centre(V0, 'l'), face.eye_centre(V0, 'r')
s, zp, cx = face._front_scale((el[0] - er[0]) * 100)       # (cm per sheet px, the pupils' row, the midline's x)
UP, LO = np.array(face.REF_EYE_UPPER), np.array(face.REF_EYE_LOWER)
cols = np.arange(UP[0, 0] - 2.5, UP[-1, 0] + 2.51, 0.25)   # (sheet px, past both corners)
ex = (cx - cols) * s
tu = np.interp(cols, UP[:, 0], UP[:, 1], left=np.nan, right=np.nan)
tl = np.interp(cols, LO[:, 0], LO[:, 1], left=np.nan, right=np.nan)
# the profile's control points: every px, every half px within 4 px of the corners (where the margins
# converge steeply), from 3 px past each corner
c0, c1 = UP[0, 0], UP[-1, 0]
ctrl = np.unique(np.r_[np.arange(c0 - 3, c0 + 4, 0.5), np.arange(c0 + 4, c1 - 4, 1.0), np.arange(c1 - 4, c1 + 3.01, 0.5)])
xs = (cx - ctrl) * s / 100
du, dl = np.zeros(len(ctrl)), np.zeros(len(ctrl))
sig = np.interp(ctrl, [c0 - 1, c0 + 3.5, c0 + 5.5, c1 - 5.5, c1 - 3.5, c1 + 1], [0.5, 0.5, 1.2, 1.2, 0.5, 0.5])[:, None]


def smooth_at(r):
    """The residual (sheet px) at the control points: Gaussian-weighted, finer toward the corners."""
    ok = np.isfinite(r)
    w = np.exp(-0.5 * ((ctrl[:, None] - cols[None, ok]) / sig) ** 2)
    return (w * r[ok]).sum(1) / np.maximum(w.sum(1), 1e-9) * (w.sum(1) > 0.3)


best = None
for it in range(iters + 1):
    V = ict.margin_warp(V0, {'x': list(xs), 'up': list(du), 'lo': list(dl)}) if it else V0
    ot, ob = face.opening(V, ex)
    yu, yl = zp - ot / s, zp - ob / s                      # (ours, sheet rows)
    ru, rl = yu - tu, yl - tl                              # (+: ours lower on the sheet)
    past = np.isfinite(yu) & ~np.isfinite(tu)              # (past the trace's corners, ours still open: close it)
    mid = (yu + yl) / 2
    ru, rl = np.where(past, yu - mid, ru), np.where(past, yl - mid, rl)
    err = np.sqrt(np.nanmean(np.r_[ru, rl] ** 2))
    print(f'iter {it}: upper rms {np.sqrt(np.nanmean(ru ** 2)):.3f} px, lower {np.sqrt(np.nanmean(rl ** 2)):.3f} px')
    if best is None or err < best[0]:
        best = (err, du.copy(), dl.copy())
    if it == iters:
        break
    du += 0.8 * smooth_at(ru) * s / 100                    # (ours lower on the sheet moves up: + rows, + z)
    dl += 0.8 * smooth_at(rl) * s / 100
_, du, dl = best
j = json.load(open(path))
j['face_model']['margin'] = {'x': [round(float(v), 6) for v in xs], 'up': [round(float(v), 6) for v in du],
                             'lo': [round(float(v), 6) for v in dl]}
json.dump(j, open(path, 'w'), indent=1)
print(f'margin profile written to {path} (best rms {best[0]:.3f} px)')
