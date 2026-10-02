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
RELAX = 8    # (the outer corner's skin smoothed: lib/ict.margin_warp 'relax')
REACH = (0.002, 0.005)   # (the skin follows its margin fully within 2 mm, not from 5: the pretarsal strip —
                         # at 9 mm it dragged the lid's fold with every margin change)
REACH_LO = (0.002, 0.009)   # (the lower lid's: no fold below it to keep — its skin follows into the
                            # cheek, the margin's moves spread wider)
CANTHUS_R = float(os.environ.get('FM_CANTHUS_R', 0.005))   # (the inner corner's skin point's falloff, m: at
                                                             # 2.5 mm its ~3 mm lift raised a knob under the corner)
TIE = 2.5    # sheet px: within this of the outer end the two margins may close but never open (free, the
             # residuals pried them apart into a hook; tied outright, they couldn't close onto the trace's
             # point: a blunt corner)
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
# our margins' ends (sheet px): the lash strips' roots' extent, the two margins' mean, each corner
ru_, rl_ = (cx - V0[q, 0] * 100 / s for q in face.lash_roots(V0, 'l'))
e_out, e_in = (ru_.min() + rl_.min()) / 2, (ru_.max() + rl_.max()) / 2
sm = lambda t: t * t * (3 - 2 * t)
# the outer end: tied (the corner moves or closes, it never opens)
tie = sm(np.clip((e_out + TIE - ctrl) / TIE, 0, 1))
# the inner end: ours ends short of the trace's corner (the concept's caruncle wedge lies beyond its white,
# where ours ends), so the trace's corner is brought to our end — both margins closing on its height over
# the last TIE px, a point (left open there, the residuals pried the margins apart: a rounded end and
# the corner's skin dragged down into a pit)
if UP[-1, 0] > e_in + 0.5:                                 # (lids.inner draws ours out to it)
    zc = UP[-1, 1]                                         # (the corner's row)
    b = sm(np.clip((cols - (e_in - TIE)) / TIE, 0, 1))
    tu, tl = tu + b * (zc - tu), tl + b * (zc - tl)
    tu[cols > e_in + 0.25], tl[cols > e_in + 0.25] = np.nan, np.nan
print(f'margins end at sheet x {e_out:.1f} (outer) and {e_in:.1f} (inner); trace corner {UP[0, 0]:.1f} / {UP[-1, 0]:.1f}')
sig = np.interp(ctrl, [c0 - 1, c0 + 3.5, c0 + 5.5, c1 - 5.5, c1 - 3.5, c1 + 1], [0.5, 0.5, 1.2, 1.2, 0.5, 0.5])[:, None]


def smooth_at(r):
    """The residual (sheet px) at the control points: Gaussian-weighted, finer toward the corners."""
    ok = np.isfinite(r)
    w = np.exp(-0.5 * ((ctrl[:, None] - cols[None, ok]) / sig) ** 2)
    return (w * r[ok]).sum(1) / np.maximum(w.sum(1), 1e-9) * (w.sum(1) > 0.3)


best = None
cin = 0.0     # (the inner corner's skin point raised to the trace's corner: it followed the lower lid down
              # below the corner, a dimple there — aimed at the margins' meeting point instead, it chased the
              # lower margin, which the solver pushed down as the lift raised the rim: a loop, a 3 mm lift)
kin = face.canthi('l')[1]
end = ctrl > e_in - 2.0
zcorner = el[2] + (zp - UP[-1, 1]) * s / 100            # (the trace's corner row, m)
for it in range(iters + 1):
    V = ict.margin_warp(V0, {'x': list(xs), 'up': list(du), 'lo': list(dl), 'relax': RELAX, 'reach': REACH,
                             'reach_lo': REACH_LO, 'canthus_in': cin,
                             'canthus_r': CANTHUS_R}) if it else V0
    cin += 0.8 * (zcorner - V[kin, 2]) if it else 0.0
    ot, ob = face.opening(V, ex)
    yu, yl = zp - ot / s, zp - ob / s                      # (ours, sheet rows)
    ru, rl = yu - tu, yl - tl                              # (+: ours lower on the sheet)
    past = np.isfinite(yu) & ~np.isfinite(tu)              # (past the trace's corners, ours still open: close it)
    mid = (yu + yl) / 2
    ru, rl = np.where(past, yu - mid, ru), np.where(past, yl - mid, rl)
    err = np.sqrt(np.nanmean(np.r_[ru, rl] ** 2))
    print(f'iter {it}: upper rms {np.sqrt(np.nanmean(ru ** 2)):.3f} px, lower {np.sqrt(np.nanmean(rl ** 2)):.3f} px')
    if best is None or err < best[0]:
        best = (err, du.copy(), dl.copy(), cin)
    if it == iters:
        break
    gain = 0.8 if it < 4 else 0.5                          # (damped late: the last steps overshot)
    du += gain * smooth_at(ru) * s / 100                   # (ours lower on the sheet moves up: + rows, + z)
    dl += gain * smooth_at(rl) * s / 100
    m, gap = (du + dl) / 2, du - dl                        # (at the ends the margins may close, never open)
    gap = np.where(gap > 0, (1 - tie) * gap, gap)
    du, dl = m + gap / 2, m - gap / 2
    ref = np.interp(e_in - 2.5, ctrl, dl)                  # (the lower margin's last 2 px no more than 0.5 mm
    dl[end] = np.maximum(dl[end], ref - 0.0005)            # below its height 2.5 px in: it spiked 3 mm down)
_, du, dl, cin = best
j = json.load(open(path))
j['face_model']['margin'] = {'x': [round(float(v), 6) for v in xs], 'up': [round(float(v), 6) for v in du],
                             'lo': [round(float(v), 6) for v in dl], 'relax': RELAX, 'reach': list(REACH),
                             'reach_lo': list(REACH_LO), 'canthus_in': round(float(cin), 6),
                             'canthus_r': CANTHUS_R}
json.dump(j, open(path, 'w'), indent=1)
print(f'margin profile written to {path} (best rms {best[0]:.3f} px)')
