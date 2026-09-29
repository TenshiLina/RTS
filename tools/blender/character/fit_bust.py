"""Fit the bust's shape parameters to the concept sheet: the side view's front edge over the bust
and the front view's half-width where the bust bulges past the ribcage, less the tank top's
thickness. The rows below the fullest point where the top hangs straight down (bridging the
fold under the bust) are one-sided: the body may be behind the fabric, not in front of it.

The apex spacing (xa), the medial reach (xm) and the footprint's lean are design choices the
silhouettes cannot decide — close-set under the top, per the review — and are not fitted.

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_bust.py
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from lib import mh, measure, compose, sculpt
from character import woman

FABRIC = 0.003
FIT = ['P', 'za', 'zt', 'zb', 'xl', 'e']
STEP = {'P': 0.002, 'za': 0.004, 'zt': 0.006, 'zb': 0.004, 'xl': 0.004, 'e': 0.05}
# anatomical ranges for this height: the base from about the 2nd rib (z 1.33-1.36) to the 6th
# (1.17-1.20), the apex near the 4th intercostal space (1.22-1.25)
BOUNDS = {'P': (0.02, 0.06), 'za': (1.22, 1.25), 'zt': (1.32, 1.36), 'zb': (1.17, 1.20), 'xl': (0.10, 0.14),
          'e': (0.6, 1.5)}

P = woman.params()
b = dict(P['bust'])
skin = woman.posed_skin(P)
armw = sculpt.arm_mask(mh)
F = mh.load_base()['F']
p0 = dict(P, bust=None)  # (the rest of the layers — grab strokes, warp, nipple smoothing — included)
V0 = woman.shape_layers(p0, skin)(woman.body_vertices(p0, skin))   # the body without the bust
N0 = sculpt.smooth_normals(V0, F)
E = measure.mesh_edges(F)
keep = armw < 0.3
_, refm = compose._sheet()
off = P['sheet_offset'][1]

meas = []  # (kind, z, target, one_sided)
vs = measure.REF['views']['side']
for r in range(int(vs['sole'] - 1.345 / measure.S), int(vs['sole'] - 1.185 / measure.S)):
    z = measure.row_z('side', [r])[0]
    f, _ = measure.sheet_edges(refm, 'side', [r])[0]
    meas.append(('sf', z, f + off + FABRIC, z < 1.215))
vf = measure.REF['views']['front']
for r in range(int(vf['sole'] - 1.212 / measure.S), int(vf['sole'] - 1.185 / measure.S)):  # (above: the arms touch)
    z = measure.row_z('front', [r])[0]
    l, rr = measure.sheet_edges(refm, 'front', [r])[0]
    meas.append(('fhw', z, (rr - l) / 2 - FABRIC, False))
zs = np.array([m[1] for m in meas])


def residual(bb):
    V = sculpt.bust(V0, F, bb, armw, N0)
    secs = measure.sections(V, E, zs, keep)
    r = []
    for (k, z, t, one), s in zip(meas, secs):
        if k == 'sf':
            s = s[np.abs(s[:, 0]) < 0.15]
            d = s[:, 1].min() - t          # + = ours behind the concept
            r.append(min(d, 0) if one else d)   # one-sided: behind the hanging fabric is fine
        else:
            s = s[np.abs(s[:, 0]) < 0.3]
            r.append((s[:, 0].max() - s[:, 0].min()) / 2 - t)
    return np.array(r) * 1000


def cost(bb):
    return float(np.mean(residual(bb) ** 2))


best = cost(b)
print(f'start rms {np.sqrt(best):.2f} mm', {k: b[k] for k in FIT}, flush=True)
for scale in (2.0, 1.0, 0.5):
    improved = True
    while improved:
        improved = False
        for k in FIT:
            for sg in (1, -1):
                t = dict(b)
                t[k] = float(np.clip(b[k] + sg * STEP[k] * scale, *BOUNDS[k]))
                c = cost(t)
                if c < best - 1e-3:
                    b, best, improved = t, c, True
    print(f'scale {scale}: rms {np.sqrt(best):.2f} mm', flush=True)
r = residual(b)
for (k, z, t, one), x in zip(meas, r):
    print(f'  {k} z{z:.3f} {x:+.1f}{" (one-sided)" if one else ""}')
b = {k: round(float(v), 4) for k, v in b.items()}
print(json.dumps(b))
saved = json.load(open(woman.PARAMS))
saved['bust'] = b
json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
print('wrote', woman.PARAMS)
