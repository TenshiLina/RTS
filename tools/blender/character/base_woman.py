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

from character import woman

bpy.ops.wm.read_factory_settings(use_empty=True)
body, arm = woman.build()

mat = review.studio()
body.data.materials.append(mat)
sub = body.modifiers.new('subsurf', 'SUBSURF')
sub.levels = sub.render_levels = 1
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'base_woman.blend'))

if os.environ.get('HANDS_ONLY'):
    cam = review._camera(); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 0.32
    lights = review._rig_lights(None)
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 360, 360
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    hand = arm.matrix_world @ arm.pose.bones['wrist.L'].tail
    for n, yaw in (('front', 0), ('side', 90), ('q34', 36)):
        review._place(cam, lights, yaw, hand + Vector((0, 0, -0.03)), 3.0, review.POWER)
        bpy.context.scene.render.filepath = os.path.join(OUT, f'hand_{n}.png')
        bpy.ops.render.render(write_still=True)
    sys.exit(0)
parts = review.sheet(os.path.join(OUT, 'sheet'), offset=woman.params().get('sheet_offset', (0, 0)))
neck_row = int(round(review.REF['views']['front']['sole'] - 1.45 / review.S))
scores = compose.sheet(parts, os.path.join(OUT, 'sheet.png'), head_row=neck_row)
print('IoU (below the neck):', ' '.join(f'{n}={s:.3f}' for n, s in scores))

# face close-ups: eyes from the eyeballs, chin from the mesh
bpy.context.view_layer.update()
eye_l, eye_r = woman.eye_points(arm, woman.params())   # (the eyes' centres behind the pupils, lib/face.eye_centre)
ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
m = ev.to_mesh()
mid = (eye_l + eye_r) / 2
chin = min((ev.matrix_world @ v.co).z for v in m.vertices if abs((ev.matrix_world @ v.co).x) < 0.004 and (ev.matrix_world @ v.co).y < mid.y + 0.02 and mid.z - 0.16 < (ev.matrix_world @ v.co).z < mid.z - 0.05)
ev.to_mesh_clear()
parts = review.faces(os.path.join(OUT, 'faces'), eye_l, eye_r, chin, iris_forward=woman.iris_forward())
compose.faces(parts, os.path.join(OUT, 'faces.png'))
print('done', OUT)
