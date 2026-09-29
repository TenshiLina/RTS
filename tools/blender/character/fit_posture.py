"""Fit the base woman's profile posture (pelvic tilt, lumbar/thoracic curve, neck, trunk lean, thigh
and shin angles) to the concept sheet's side view: the back line from heel to neck and the front
line except over the bust and the fabric that bridges below it. Edges are compared after removing
their mean offset, so the fit is of the curve, not of where the sheet happens to centre the view.
Updates the pose in woman.json.

    $RTS_TOOLS/blender/bin/python tools/blender/character/fit_posture.py [--leg_fwd --shin_fwd ...]
"""
import json, math, os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
import bpy
from PIL import Image
from mathutils import Vector
from lib import review, compose
from character import woman

KEYS = [a[2:] for a in sys.argv[1:] if a.startswith('--')] or ['pelvis_tilt', 'lumbar', 'thoracic', 'neck', 'lean', 'leg_fwd', 'shin_fwd']
BACK = (0.18, 1.45)   # z range of the back line (above the heel: the feet are not fitted here)
FRONT = [(0.18, 1.08), (1.34, 1.45)]  # the front, less the bust and the fabric below it

P = woman.params()
bpy.ops.wm.read_factory_settings(use_empty=True)
body, arm = woman.build(P, bake=False)
pose = dict(P['pose'])

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light, sc.display.shading.color_type, sc.display.shading.single_color = 'FLAT', 'SINGLE', (1, 1, 1)
sc.render.film_transparent = True
cam = review._camera()
cam.data.type = 'ORTHO'
cam.data.ortho_scale = review.H * review.S
name, yaw, x0, x1, dx = [v for v in review.VIEWS if v[0] == 'side'][0]
v = review.REF['views'][name]
w = x1 - x0
im, refm = compose._sheet()
ref = np.zeros((1000, w), bool)
ref[: im.height] = refm[:1000, x0:x1]
a = math.radians(yaw)
right = Vector((math.cos(a), math.sin(a), 0))
target = right * ((w / 2 - (v['cx'] + dx - x0)) * review.S) + Vector((0, 0, (v['sole'] - review.H / 2) * review.S))
sc.render.resolution_x, sc.render.resolution_y = w, 1000
cam.location = target + Vector((math.sin(a), -math.cos(a), 0)) * 5
cam.rotation_euler = (math.radians(90), 0, a)
tmp = tempfile.mkdtemp()
rows_back = np.arange(int(v['sole'] - BACK[1] / review.S), int(v['sole'] - BACK[0] / review.S))
rows_neck = np.concatenate([np.arange(int(v['sole'] - b / review.S), int(v['sole'] - a / review.S)) for a, b in FRONT])


def edges(m, rows, back):
    out = []
    for r in rows:
        xs = np.where(m[r])[0]
        out.append((xs[-1] if back else xs[0]) if len(xs) else np.nan)
    return np.array(out, float)


eref = np.r_[edges(ref, rows_back, True), edges(ref, rows_neck, False)]


def score(p):
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    arm.location = (0, 0, 0)
    bpy.context.view_layer.update()
    woman.pose(arm, p)
    woman.ground(body, arm)
    sc.render.filepath = f'{tmp}/m.png'
    bpy.ops.render.render(write_still=True)
    m = np.asarray(Image.open(f'{tmp}/m.png').convert('RGBA'))[:, :, 3] > 127
    e = np.r_[edges(m, rows_back, True), edges(m, rows_neck, False)]
    d = e - eref
    d = d[np.isfinite(d)]
    d -= d.mean()
    return float(np.sqrt((d ** 2).mean())) * review.S * 100  # cm


best = score(pose)
print(f'start {best:.3f} cm', {k: pose[k] for k in KEYS}, flush=True)
for step in (3.0, 1.5, 0.75):
    improved = True
    while improved:
        improved = False
        for k in KEYS:
            for sgn in (1, -1):
                trial = dict(pose)
                trial[k] = pose[k] + sgn * step
                s = score(trial)
                if s < best - 1e-3:
                    best, pose, improved = s, trial, True
    print(f'step {step}: {best:.3f} cm', {k: pose[k] for k in KEYS}, flush=True)

saved = json.load(open(woman.PARAMS)) if os.path.exists(woman.PARAMS) else {}
saved.setdefault('pose', {}).update({k: pose[k] for k in KEYS})
json.dump(saved, open(woman.PARAMS, 'w'), indent=1)
print('wrote', woman.PARAMS)
