"""Least-squares fit of the base woman's body modifiers to the concept sheet's silhouette edges.

Edges are measured on cross-sections of the body in the sheet's stance (posed by linear blend
skinning in numpy, exactly as Blender poses it; sub-millimetre, no rendering) and
compared per sheet row with the concept's edges:
  * front view: torso half-width (hips to below the armpits; neck and trapezius), shoulder
    width with the arms, the left leg's width
  * side view: front and back edges from the gluteal fold to the neck (with a free fore-aft offset,
    since the sheet's side view is not centred on our origin)
The concept is clothed: its edges are pulled in by a fabric allowance where the tank top and
shorts cover the body, the side view's front edge is skipped over the bust and the fabric that
bridges below it (the bust has its own fit), and the waist has an anthropometric floor so the
concept's stylised waist is approached, not copied. Gauss-Newton with numerical derivatives,
mild pull towards MakeHuman's defaults, values clipped to [-1, 1]. Updates woman.json.

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_shape.py [--dry]
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from lib import mh, measure, compose, sculpt
from character import woman

# (not fitted: the neck modifiers, which also move the head; buttocks-volume, whose shape is not
# the concept's — the warp does that; the belly, which the top hides: kept flat)
FIT = ['torso/torso-scale-horiz', 'torso/torso-scale-depth', 'torso/torso-vshape',
       'hip/hip-scale-horiz', 'hip/hip-scale-depth', 'hip/hip-waist',
       'armslegs/upperleg-scale-horiz', 'armslegs/upperleg-scale-depth',
       'armslegs/lowerleg-scale-horiz', 'armslegs/lowerleg-scale-depth',
       'armslegs/upperarm-scale-horiz', 'armslegs/lowerarm-scale-horiz']
BOUND = 0.8
WARP_Z = np.round(np.arange(0.05, 1.50, 0.005), 3)
FABRIC = 0.003          # m, pulled off the concept's edges where clothed
TOP, SHORTS = (1.00, 1.40), (0.76, 1.02)
WAIST_FLOOR = (1.04, 1.17, 0.100)   # z range and minimum half-width (m)
REG = 5.0               # residual (mm) per unit of modifier
STEP = 2                # sheet rows between samples

P = woman.params()
base = mh.load_base()
E = measure.mesh_edges(base['F'])
W = json.load(open(os.path.join(mh.MH, 'default_weights.mhw')))['weights']
arm = np.zeros(mh.BODY_VERTS, bool)
for b, lst in W.items():
    if any(k in b for k in ('upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal', 'shoulder')):
        for i, w in lst:
            if i < mh.BODY_VERTS and w > 0.3:
                arm[i] = True
keep = ~arm

# ---- the concept's edges
_, refm = compose._sheet()


def ref_rows(view, z0, z1):
    sole = measure.REF['views'][view]['sole']
    return np.arange(int(sole - z1 / measure.S), int(sole - z0 / measure.S), STEP)


def clothed(z):
    return (TOP[0] <= z <= TOP[1]) or (SHORTS[0] <= z <= SHORTS[1])


meas = []  # (kind, z, target): fhw torso half-width, shw full half-width incl. arms (shoulders),
#            lw left leg width, aw left arm width, sf/sb side view front/back edge
rows = np.r_[ref_rows('front', 0.88, 1.17), ref_rows('front', 1.40, 1.46)]
for z, (l, r) in zip(measure.row_z('front', rows), measure.sheet_edges(refm, 'front', rows)):
    hw = (r - l) / 2 - (FABRIC if clothed(z) and z < 1.39 else 0)
    if WAIST_FLOOR[0] <= z <= WAIST_FLOOR[1]:
        hw = max(hw, WAIST_FLOOR[2])
    meas.append(('fhw', z, hw))
rows = ref_rows('front', 1.27, 1.37)
for z, (l, r) in zip(measure.row_z('front', rows), measure.sheet_edges(refm, 'front', rows)):
    meas.append(('shw', z, (r - l) / 2))
rows = ref_rows('front', 0.12, 0.70)  # (below the shorts' hem and the thigh's bulge under it)
cx = measure.REF['views']['front']['cx']
for z, r in zip(measure.row_z('front', rows), rows):
    xs = np.where(refm[r, :measure.COLS['front'][1]])[0]
    runs = np.split(xs, np.where(np.diff(xs) > 1)[0] + 1)
    runs = [q for q in runs if q.mean() > cx and len(q) > 8]
    if not runs:
        continue
    q = min(runs, key=lambda q: q.mean())
    # (leg width, not edge positions: those are the leg pose's)
    meas.append(('lw', z, (q[-1] + 1 - q[0]) * measure.S))
rows = ref_rows('front', 0.92, 1.20)  # the left arm's width (upper arm and forearm, above the wrist)
for z, r in zip(measure.row_z('front', rows), rows):
    xs = np.where(refm[r, :measure.COLS['front'][1]])[0]
    runs = np.split(xs, np.where(np.diff(xs) > 1)[0] + 1)
    runs = [q for q in runs if q.mean() > cx + 0.14 / measure.S and len(q) > 5]
    if runs and 0.97 <= z or runs and z <= 0.95:  # (skip the elbow, where the forearm turns)
        q = min(runs, key=lambda q: q.mean())
        meas.append(('aw', z, (q[-1] + 1 - q[0]) * measure.S))
rows = ref_rows('side', 0.80, 1.43)  # above the shorts' hem, below the hair at the nape
for z, (f, b) in zip(measure.row_z('side', rows), measure.sheet_edges(refm, 'side', rows)):
    a = FABRIC if clothed(z) else 0
    if z >= 1.33:  # (below: the bust, the top hanging straight down from it, the shorts over the groin)
        meas.append(('sf', z, f + a))
    if z <= 1.42:
        meas.append(('sb', z, b - a))
kinds = np.array([m[0] for m in meas])
zs = np.array([m[1] for m in meas])
target = np.array([m[2] for m in meas])
uz = np.unique(zs)


SKIN = woman.posed_skin(P)  # the sheet's stance, by skinning (as the build poses the body)


def measure_body(vals, warp=None):
    p = dict(P, modifiers={**P['modifiers'], **vals}, warp=warp)
    V = woman.shape_layers(p, SKIN)(woman.body_vertices(p, SKIN))
    secs = dict(zip(uz, measure.sections(V, E, uz, keep)))
    full = dict(zip(uz, measure.sections(V, E, uz)))
    arms = dict(zip(uz, measure.sections(V, E, uz, ~keep)))
    out = np.full(len(meas), np.nan)
    for i, (k, z, _) in enumerate(meas):
        p = arms[z] if k == 'aw' else full[z] if (k == 'shw' or z > 1.39) else secs[z]
        if not len(p):
            continue
        if k in ('fhw', 'shw'):
            p = p[np.abs(p[:, 0]) < 0.3]
            out[i] = (p[:, 0].max() - p[:, 0].min()) / 2
        elif k in ('lw', 'aw'):
            p = p[(p[:, 0] > 0.01) & (p[:, 0] < 0.4)]
            out[i] = p[:, 0].max() - p[:, 0].min() if len(p) else np.nan
        elif k == 'sf':
            out[i] = p[:, 1].min()
        else:
            out[i] = p[:, 1].max()
    return out


def residual(x, warp=None):
    vals = dict(zip(FIT, x[:-1]))
    m = measure_body(vals, warp)
    m = np.where(np.isin(kinds, ('sf', 'sb')), m - x[-1], m)  # the side view's fore-aft offset
    r = (m - target) * 1000  # mm
    return np.r_[np.nan_to_num(r), REG * x[:-1]]


def report(x, label, warp=None):
    r = residual(x, warp)[:len(meas)]
    parts = ' '.join(f'{k}={np.sqrt(np.mean(r[kinds == k] ** 2)):.1f}' for k in ('fhw', 'shw', 'lw', 'aw', 'sf', 'sb'))
    print(f'{label}: rms {np.sqrt(np.mean(r ** 2)):.2f} mm  [{parts}]  offset {x[-1] * 1000:+.1f} mm', flush=True)


x = np.r_[[P['modifiers'].get(k, 0.0) for k in FIT], 0.0]
# start the offset at the mean side residual
r0 = residual(x)[:len(meas)]
x[-1] = np.mean(r0[np.isin(kinds, ('sf', 'sb'))]) / 1000
report(x, 'start')
for it in range(6):
    r = residual(x)
    J = np.empty((len(r), len(x)))
    for j in range(len(x)):
        h = 0.15 if j < len(x) - 1 else 0.002
        xp = x.copy()
        xp[j] += h
        J[:, j] = (residual(xp) - r) / h
    dx = np.linalg.lstsq(J, -r, rcond=None)[0]
    x_new = x + dx
    x_new[:-1] = np.clip(x_new[:-1], -BOUND, BOUND)
    if np.sum(residual(x_new) ** 2) > np.sum(r ** 2):
        x_new = x + 0.5 * dx
        x_new[:-1] = np.clip(x_new[:-1], -BOUND, BOUND)
    x = x_new
    report(x, f'iter {it + 1}')
    if np.abs(dx[:-1]).max() < 0.01:
        break

print(json.dumps({k: round(float(v), 3) for k, v in zip(FIT, x[:-1])}, indent=1))

# ---- the warp: two passes on the smoothed residuals
warp = {'z': WARP_Z.tolist(), 'front': [0.0] * len(WARP_Z), 'back': [0.0] * len(WARP_Z),
        'width': [1.0] * len(WARP_Z), 'leg': [1.0] * len(WARP_Z)}
for it in range(3):
    vals = dict(zip(FIT, x[:-1]))
    m = measure_body(vals, warp)
    m = np.where(np.isin(kinds, ('sf', 'sb')), m - x[-1], m)
    r = m - target
    for key, kind, sigma in (('front', 'sf', 0.012), ('back', 'sb', 0.012)):
        sel = (kinds == kind) & np.isfinite(r)
        c = sculpt.smooth_curve(WARP_Z, zs[sel], -r[sel], sigma, 0.05)
        warp[key] = (np.array(warp[key]) + c).round(5).tolist()
    for key, kind in (('width', 'fhw'), ('leg', 'lw')):
        sel = (kinds == kind) & np.isfinite(r)
        c = sculpt.smooth_curve(WARP_Z, zs[sel], -r[sel] / m[sel], 0.012, 0.05)
        warp[key] = (np.array(warp[key]) * (1 + c)).round(5).tolist()
    report(x, f'warp {it + 1}', warp)

# per-row residuals worth a look
r = residual(x, warp)[:len(meas)]
for k in ('fhw', 'shw', 'lw', 'aw', 'sf', 'sb'):
    sel = kinds == k
    worst = np.argsort(-np.abs(r * sel))[:4]
    print(k, ' '.join(f'z{zs[i]:.2f}:{r[i]:+.1f}' for i in worst if sel[i]))
if '--profile' in sys.argv:
    for k in ('fhw', 'shw', 'lw', 'aw', 'sf', 'sb'):
        sel = np.where(kinds == k)[0]
        print(k, ' '.join(f'{zs[i]:.2f}:{r[i]:+.0f}' for i in sel[::3]))
if '--dry' not in sys.argv:
    saved = json.load(open(woman.PARAMS)) if os.path.exists(woman.PARAMS) else {}
    saved.setdefault('modifiers', {}).update({k: round(float(v), 3) for k, v in zip(FIT, x[:-1])})
    saved['warp'] = warp
    saved['sheet_offset'] = [0.0, round(float(x[-1]), 4)]  # where the sheet's views are centred on us (review only)
    json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
    print('wrote', woman.PARAMS)
