"""The base woman: MakeHuman CC0 base, shaped and posed to the faction's concept sheet.

    $RTS_TOOLS/blender/bin/python tools/blender/character/base_woman.py OUT_DIR

Writes OUT_DIR/base_woman.blend, OUT_DIR/sheet.png (the sheet's four views: concept | clay |
outlines) and OUT_DIR/faces.png (front and profile close-ups beside the concept's).
"""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import bpy
from mathutils import Vector
from lib import mh, review, compose

OUT = os.path.abspath(sys.argv[-1] if len(sys.argv) > 1 else 'out')
os.makedirs(OUT, exist_ok=True)

# ---- shape: race/sex/age macro, ideal proportions, then per-region modifiers (values −1..1)
TARGETS = {
    'macrodetails/asian-female-young': 1.0,
    'macrodetails/proportions/female-young-averagemuscle-averageweight-idealproportions': 1.0,
}
MODIFIERS = {
    'torso/torso-scale-horiz': -0.5, 'torso/torso-vshape': -0.1,
    'hip/hip-waist': 0.4, 'hip/hip-scale-depth': 0.3,
    'buttocks/buttocks-volume': -0.6,
    'neck/neck-scale-horiz': -0.4,
    'armslegs/upperarm-scale-horiz': 0.6, 'armslegs/upperarm-scale-vert': -0.2, 'armslegs/lowerarm-scale-horiz': 0.6,
    'armslegs/upperleg-scale-horiz': -0.2, 'armslegs/upperleg-scale-depth': 0.6,
    'armslegs/lowerleg-scale-horiz': 0.6, 'armslegs/lowerleg-scale-depth': 0.6, 'armslegs/lowerleg-scale-vert': 0.3,
}
if os.environ.get('MODS'):
    MODIFIERS.update(json.loads(os.environ['MODS']))

# ---- pose: the sheet's A-pose, measured on its front and side views (see tools/assetgen/ref)
POSE = {
    # direction of each segment, figure's left side (+X); z up, -Y = forward
    'upperarm': (0.32, 0.02, -1.0),
    'lowerarm': (0.46, -0.19, -1.0),
    'upperleg': (0.047, 0.0, -1.0),
    'lowerleg': (0.033, 0.0, -1.0),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
body, arm = mh.build_human(targets=TARGETS, modifiers=MODIFIERS, height=1.68, name='woman')
for side, sg in (('L', 1), ('R', -1)):
    mir = lambda d: (d[0] * sg, d[1], d[2])
    for b in ('upperarm01', 'upperarm02'):
        mh.aim_bone(arm, f'{b}.{side}', mir(POSE['upperarm']))
    for b in ('lowerarm01', 'lowerarm02', 'wrist'):
        mh.aim_bone(arm, f'{b}.{side}', mir(POSE['lowerarm']))
    for b in ('upperleg01', 'upperleg02'):
        mh.aim_bone(arm, f'{b}.{side}', mir(POSE['upperleg']))
    for b in ('lowerleg01', 'lowerleg02'):
        mh.aim_bone(arm, f'{b}.{side}', mir(POSE['lowerleg']))
bpy.context.view_layer.update()

# feet back on the ground after posing the legs
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
m = ev.to_mesh()
zmin = min((ev.matrix_world @ v.co).z for v in m.vertices)
ev.to_mesh_clear()
arm.location.z -= zmin

mat = review.studio()
body.data.materials.append(mat)
sub = body.modifiers.new('subsurf', 'SUBSURF')
sub.levels = sub.render_levels = 1
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'base_woman.blend'))

parts = review.sheet(os.path.join(OUT, 'sheet'))
neck_row = int(round(review.REF['views']['front']['sole'] - 1.45 / review.S))
scores = compose.sheet(parts, os.path.join(OUT, 'sheet.png'), head_row=neck_row)
print('IoU (below the neck):', ' '.join(f'{n}={s:.3f}' for n, s in scores))

# face close-ups: eyes from the skeleton, chin from the mesh
bpy.context.view_layer.update()
pl, pr = arm.pose.bones['eye.L'], arm.pose.bones['eye.R']
eye_l = arm.matrix_world @ pl.head
eye_r = arm.matrix_world @ pr.head
ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
m = ev.to_mesh()
mid = (eye_l + eye_r) / 2
chin = min((ev.matrix_world @ v.co).z for v in m.vertices if abs((ev.matrix_world @ v.co).x) < 0.004 and (ev.matrix_world @ v.co).y < mid.y + 0.02 and mid.z - 0.16 < (ev.matrix_world @ v.co).z < mid.z - 0.05)
ev.to_mesh_clear()
parts = review.faces(os.path.join(OUT, 'faces'), eye_l, eye_r, chin)
compose.faces(parts, os.path.join(OUT, 'faces.png'))
print('done', OUT)
