"""Review renders against the concept sheet, from Blender.

sheet(objs, out): the sheet's four full-body views (orthographic, at the sheet's own pixel scale,
feet and centre lines aligned) rendered in clay with Cycles, plus silhouette masks (Workbench),
composed as reference | clay | outlines (cyan = sheet, red = ours) per view, with each view's
silhouette overlap. faces(objs, out): the sheet's front and profile close-ups beside ours.
"""
import json, math, os, time
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SHEET = os.path.join(ROOT, 'docs/art/factions/human/human-female-turnaround.webp')
REF = json.load(open(os.path.join(ROOT, 'tools/assetgen/ref/human-female.json')))
S = REF['scale']  # metres per sheet pixel
VIEWS = [  # name, yaw (deg; 0 = front, 90 = from the figure's left), sheet columns, centre shift (px)
    ('front', 0, 0, 368, 0),
    ('side', 90, 383, 541, 0),
    ('back', 180, 558, 900, 0),
    ('q34', 36, 900, 1190, 18),
]
H = 1000
POWER = float(os.environ.get('LIGHT_POWER', 260))


def studio(clay=(0.33, 0.19, 0.125)):
    """Neutral studio: grey world, clay material (linear colour ≈ sRGB 0.62/0.48/0.39), standard
    view transform so the clay's value reads as authored."""
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new('studio')
    sc.world.use_nodes = True
    sc.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.30, 0.31, 0.33, 1)
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    mat = bpy.data.materials.get('clay') or bpy.data.materials.new('clay')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*clay, 1)
    b.inputs['Roughness'].default_value = 0.55
    mat.diffuse_color = (*clay, 1)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    return mat


def _rig_lights(target, dist=3.0):
    """Key high on the camera's left, fill low on its right, rim from behind — parented to the
    camera rig so every view is lit the same way (a turnaround is lit per view)."""
    lights = []
    for name, (az, el, e, size) in {'key': (-40, 35, 1.0, 1.4), 'fill': (45, 5, 0.35, 2.0), 'rim': (160, 30, 0.6, 1.0)}.items():
        l = bpy.data.objects.get(name) or bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
        if l.name not in bpy.context.scene.collection.objects:
            bpy.context.scene.collection.objects.link(l)
        l.data.size = size
        lights.append((l, az, el, e))
    return lights


def _place(cam, lights, yaw, target, dist, power):
    a = math.radians(yaw)
    back = Vector((math.sin(a), -math.cos(a), 0))
    cam.location = target + back * dist
    cam.rotation_euler = (math.radians(90), 0, a)
    for l, az, el, e in lights:
        b = math.radians(yaw + az)
        d = Vector((math.sin(b) * math.cos(math.radians(el)), -math.cos(b) * math.cos(math.radians(el)), math.sin(math.radians(el))))
        l.location = target + d * 3.0
        l.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
        l.data.energy = power * e


def _camera():
    cam = bpy.data.objects.get('review_cam')
    if not cam:
        cam = bpy.data.objects.new('review_cam', bpy.data.cameras.new('review_cam'))
        bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def _mask_render(path):
    """Silhouette: Workbench, flat white objects on black."""
    sc = bpy.context.scene
    eng = sc.render.engine
    sh = sc.display.shading
    saved = (sh.light, sh.color_type, tuple(sh.single_color), sc.render.film_transparent)
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh.light, sh.color_type, sh.single_color = 'FLAT', 'SINGLE', (1, 1, 1)
    sc.render.film_transparent = True
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sh.light, sh.color_type, sh.single_color, sc.render.film_transparent = saved[0], saved[1], saved[2], saved[3]
    sc.render.engine = eng


def sheet(out, samples=48, offset=(0.0, 0.0)):
    """offset: world (x, y) of the point the sheet's views are centred on (the side view's
    centre line is not our origin)."""
    sc = bpy.context.scene
    cam = _camera()
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = H * S
    lights = _rig_lights(None)
    sc.cycles.samples = samples
    tmp = out + '.parts'
    os.makedirs(tmp, exist_ok=True)
    meta = []
    for name, yaw, x0, x1, dx in VIEWS:
        v = REF['views'][name]
        w = x1 - x0
        a = math.radians(yaw)
        right = Vector((math.cos(a), math.sin(a), 0))
        off = (w / 2 - (v['cx'] + dx - x0)) * S
        target = right * off + Vector((0, 0, (v['sole'] - H / 2) * S)) + Vector((*offset, 0))
        sc.render.resolution_x, sc.render.resolution_y = w, H
        _place(cam, lights, yaw, target, 5.0, POWER)
        t = time.time()
        sc.render.filepath = f'{tmp}/{name}_clay.png'
        bpy.ops.render.render(write_still=True)
        _mask_render(f'{tmp}/{name}_mask.png')
        print(f'  view {name}: {time.time() - t:.1f}s')
        meta.append({'name': name, 'x0': x0, 'w': w, 'sole': v['sole']})
    json.dump(meta, open(f'{tmp}/meta.json', 'w'))
    return tmp


def region(out, z0, z1, views=('front', 'side', 'q34'), k=4, samples=48, offset=(0.0, 0.0)):
    """Close-up of a height band (z0..z1 m) in the sheet's views, at k× the sheet's pixel scale,
    framed exactly like the sheet's crop of that band (so the two can be laid side by side).
    Returns [(view, png path, sheet box)]."""
    sc = bpy.context.scene
    cam = _camera()
    cam.data.type = 'ORTHO'
    lights = _rig_lights(None)
    sc.cycles.samples = samples
    shots = []
    for name, yaw, x0, x1, dx in VIEWS:
        if name not in views:
            continue
        v = REF['views'][name]
        w = x1 - x0
        r0, r1 = int(round(v['sole'] - z1 / S)), int(round(v['sole'] - z0 / S))
        a = math.radians(yaw)
        right = Vector((math.cos(a), math.sin(a), 0))
        off = (w / 2 - (v['cx'] + dx - x0)) * S
        target = right * off + Vector((0, 0, (v['sole'] - (r0 + r1) / 2) * S)) + Vector((*offset, 0))
        cam.data.ortho_scale = max(w, r1 - r0) * S
        sc.render.resolution_x, sc.render.resolution_y = w * k, (r1 - r0) * k
        _place(cam, lights, yaw, target, 5.0, POWER)
        sc.render.filepath = f'{out}_{name}.png'
        bpy.ops.render.render(write_still=True)
        shots.append((name, f'{out}_{name}.png', (x0, r0, x1, r1)))
    return shots


def faces(out, eye_l, eye_r, chin_z, samples=96, iris_forward=0.0):
    """Front and profile close-ups at the close-ups' scale: the front aligned on the pupils
    (sheet: 1274/1344, row 282), the profile on the eye line and scaled by eye-to-chin (sheet: eye
    row 712, chin row 820). iris_forward: how far the eye's front (the upper lid's) is in front of the
    eyeball centres (the profile is aligned on it: the concept's eye front is column 1217.5)."""
    sc = bpy.context.scene
    cam = _camera()
    cam.data.type = 'ORTHO'
    lights = _rig_lights(None)
    sc.cycles.samples = samples
    tmp = out + '.parts'
    os.makedirs(tmp, exist_ok=True)
    mid = (Vector(eye_l) + Vector(eye_r)) / 2
    ipd = (Vector(eye_l) - Vector(eye_r)).length
    shots = []
    # front: crop (1175..1448, 190..470) at ipd / 70 px
    s = ipd / 70.0
    box = (1175, 190, 1448, 470)
    W, Hh = (box[2] - box[0]) * 2, (box[3] - box[1]) * 2
    cx = ((box[0] + box[2]) / 2 - 1309) * s
    cz = -((box[1] + box[3]) / 2 - 282) * s
    shots.append(('face_front', 0, mid + Vector((cx, 0, cz)), (box[3] - box[1]) * s, W, Hh, box))
    # profile: crop (1180..1380, 620..860), eye row 715, chin row 818.75 (as lib/face.py)
    sp = (mid.z - chin_z) / 103.75
    box2 = (1180, 620, 1380, 860)
    W2, H2 = (box2[2] - box2[0]) * 2, (box2[3] - box2[1]) * 2
    # horizontal: the sheet's eye front (the upper lid) is column 1217.5; ours is our upper lid's front
    cy = ((box2[0] + box2[2]) / 2 - 1217.5) * sp
    cz2 = -((box2[1] + box2[3]) / 2 - 715) * sp
    shots.append(('face_side', 90, Vector((0, mid.y - iris_forward + cy, mid.z + cz2)), (box2[3] - box2[1]) * sp, W2, H2, box2))
    meta = []
    for name, yaw, target, height, W_, H_, bx in shots:
        cam.data.ortho_scale = max(height, height * W_ / H_)
        sc.render.resolution_x, sc.render.resolution_y = W_, H_
        _place(cam, lights, yaw, target, 3.0, POWER)
        sc.render.filepath = f'{tmp}/{name}.png'
        bpy.ops.render.render(write_still=True)
        _mask_render(f'{tmp}/{name}_mask.png')
        meta.append({'name': name, 'box': bx, 'w': W_, 'h': H_})
    json.dump(meta, open(f'{tmp}/faces.json', 'w'))
    return tmp
