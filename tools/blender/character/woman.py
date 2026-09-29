"""The base woman: MakeHuman CC0 base, shaped and posed to the faction's concept sheet.

Build order: MakeHuman macro + modifiers → rig → pose to the sheet's stance → sculpt layers on
the posed body (grab strokes, profile warp, bust) → that shape and pose become the rest pose.
Parameters live in woman.json, written by the fitters (fit_shape, fit_posture, fit_bust) and
by hand where the silhouettes cannot decide."""
import json, math, os
import numpy as np
import bpy
from mathutils import Vector
from lib import mh, sculpt

HERE = os.path.dirname(__file__)
PARAMS = os.path.join(HERE, 'woman.json')

# race/sex/age macro and ideal proportions (fixed); everything else lives in woman.json
TARGETS = {
    'macrodetails/asian-female-young': 1.0,
    'macrodetails/proportions/female-young-averagemuscle-averageweight-idealproportions': 1.0,
}
DEFAULT = {
    'modifiers': {
        'torso/torso-scale-horiz': -0.5, 'torso/torso-vshape': -0.1,
        'hip/hip-waist': 0.4, 'hip/hip-scale-depth': 0.3,
        'buttocks/buttocks-volume': -0.6,
        'neck/neck-scale-horiz': -0.4,
        'armslegs/upperarm-scale-horiz': 0.6, 'armslegs/upperarm-scale-vert': -0.2, 'armslegs/lowerarm-scale-horiz': 0.6,
        'armslegs/upperleg-scale-horiz': -0.2, 'armslegs/upperleg-scale-depth': 0.6,
        'armslegs/lowerleg-scale-horiz': 0.6, 'armslegs/lowerleg-scale-depth': 0.6, 'armslegs/lowerleg-scale-vert': 0.3,
    },
    # MakeHuman's breast macros, 0..1 (0.5 = the macro's own)
    'breast': {'size': 0.5, 'firmness': 0.5},
    # angles in degrees: out from vertical in the frontal plane, forward in profile; posture
    # (pelvis_tilt … head) as in posture()
    'pose': {'upperarm_out': 17.7, 'upperarm_fwd': -1.2, 'lowerarm_out': 24.7, 'lowerarm_fwd': 10.8,
             'leg_out': 2.4, 'leg_fwd': 0.0, 'shin_fwd': 0.0, 'twist': 0.0, 'curl': [12, 18, 12], 'clavicle': 0.0,
             'pelvis_tilt': 0.0, 'lumbar': 0.0, 'thoracic': 0.0, 'neck': 0.0, 'lean': 0.0, 'head': 0.0},
}


def params():
    p = json.loads(json.dumps(DEFAULT))
    if os.path.exists(PARAMS):
        saved = json.load(open(PARAMS))
        p['modifiers'].update(saved.get('modifiers', {}))
        p['pose'].update(saved.get('pose', {}))
        p['breast'].update(saved.get('breast', {}))
        p['warp'] = saved.get('warp')
        p['sculpt'] = saved.get('sculpt', [])
        p['sheet_offset'] = saved.get('sheet_offset', [0.0, 0.0])
        p['bust'] = saved.get('bust')
    return p


MALE = {
    'macrodetails/asian-male-young': 1.0,
    'macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions': 1.0,
}


def body_vertices(p, skin=None, male=False):
    """The body's vertices (Blender frame) before the shape layers: modifiers, then — given
    skin = (W, M) from posed_skin() — the pose, by linear blend skinning as Blender does.
    male: the same with MakeHuman's male macro (the donor of the chest wall under the bust)."""
    t = dict(MALE) if male else {**TARGETS, **mh.breast_targets(p['breast']['size'], p['breast']['firmness'])}
    t.update(mh.modifier_targets(p['modifiers']))
    V = mh.to_blender(mh.morphed(t), 1.68)[:mh.BODY_VERTS]
    if skin:
        V = mh.lbs(V, *skin)
        V[:, 2] -= V[:, 2].min()  # grounded, as build() does
    return V


def posed_skin(p):
    """Skin weights and pose matrices for body_vertices(), from a Blender build of p (the pose
    matrices hold for nearby modifier values, whose joints barely move)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, arm = mh.build_human(targets={**TARGETS, **mh.breast_targets(p['breast']['size'], p['breast']['firmness'])},
                               modifiers=p['modifiers'], height=1.68, name='woman')
    pose(arm, p['pose'])
    return mh.skin_weights(body, arm), mh.skin_matrices(arm)


_armw = None


def shape_layers(p, skin=None):
    """Sculpt layers, applied to the posed body: the grab strokes, the profile warp, the chest
    wall, the bust. (skin: unused, kept for the fitters' calls.)"""
    global _armw
    if _armw is None:
        _armw = sculpt.arm_mask(mh)
    F = mh.load_base()['F']
    region, wb = breast_region()

    def layers(V):
        # MakeHuman's own breast (even its smallest is a cone with a nipple and a fold) is replaced
        # by the ribcage's continuation: the parametric bust is the only form there (a clothed
        # base: no nipples)
        V = sculpt.profile_warp(sculpt.grab(V, p.get('sculpt')), p.get('warp'), _armw)
        V = sculpt.chest_wall(V, F, wb, _armw)   # (last before the bust: nothing may fold it again)
        return sculpt.bust(V, F, p.get('bust'), _armw)
    return layers


_flat = None


def breast_region():
    """MakeHuman's breast mound: the vertices skinned to its breast bones (and the nipples,
    whatever their weights), and the per-vertex breast weight (0..1)."""
    global _flat
    if _flat is None:
        W = json.load(open(os.path.join(mh.MH, 'default_weights.mhw')))['weights']
        wb = np.zeros(mh.BODY_VERTS)
        for b in ('breast.L', 'breast.R'):
            for i, w in W.get(b, []):
                if i < mh.BODY_VERTS:
                    wb[i] += w
        idx = set(np.where(wb > 0.15)[0].tolist())
        for t in ('nipple-point-incr', 'nipple-size-incr'):
            i, _ = mh.read_target(os.path.join(mh.MH, 'targets', 'breast', t + '.target'))
            idx.update(int(k) for k in i if k < mh.BODY_VERTS)
        _flat = (sculpt.grow(mh.load_base()['F'], sorted(idx), 1), np.clip(wb, 0, 1))
    return _flat


def direction(out_deg, fwd_deg, sign):
    """Unit vector pointing down, tilted out (±X) and forward (−Y)."""
    o, f = math.radians(out_deg), math.radians(fwd_deg)
    return (math.tan(o) * sign, -math.tan(f), -1.0)


def posture(arm, P):
    """Spine curve in profile, as local bends that each leave the parts above them oriented as
    before (so the parameters are independent): pelvic tilt (the pelvis tips forward, the lumbar
    spine straightens the trunk back up), lumbar lordosis, thoracic kyphosis, neck flexion, plus a
    whole-trunk lean; the head is then levelled and tilted by 'head'. Degrees, + = forward."""
    pt, L, T, N, lean = (P.get(k, 0.0) for k in ('pelvis_tilt', 'lumbar', 'thoracic', 'neck', 'lean'))
    chain = [('root', pt), ('spine05', -pt / 3 + lean), ('spine04', -pt / 3 - L), ('spine03', -pt / 3),
             ('spine02', L + T / 2), ('spine01', T / 2), ('neck01', -T + N / 3), ('neck02', N / 3), ('neck03', N / 3)]
    acc = 0.0
    for b, a in chain:
        if a:
            mh.rotate_bone(arm, b, (1, 0, 0), a)
        acc += a
    mh.rotate_bone(arm, 'head', (1, 0, 0), P.get('head', 0.0) - acc)


def pose(arm, P):
    if any(P.get(k) for k in ('pelvis_tilt', 'lumbar', 'thoracic', 'neck', 'lean', 'head')):
        posture(arm, P)
    for side, sg in (('L', 1), ('R', -1)):
        if P.get('clavicle'):  # depression (MakeHuman's rest pose has the shoulders raised)
            mh.rotate_bone(arm, f'clavicle.{side}', (0, 1, 0), P['clavicle'] * sg)
        ua = direction(P['upperarm_out'], P['upperarm_fwd'], sg)
        la = direction(P['lowerarm_out'], P['lowerarm_fwd'], sg)
        lg = direction(P['leg_out'], P.get('leg_fwd', 0.0), sg)
        sh = direction(P['leg_out'], P.get('shin_fwd', 0.0), sg)
        for b in ('upperarm01', 'upperarm02'):
            mh.aim_bone(arm, f'{b}.{side}', ua)
        for b in ('lowerarm01', 'lowerarm02', 'wrist'):
            mh.aim_bone(arm, f'{b}.{side}', la)
        for b in ('upperleg01', 'upperleg02'):
            mh.aim_bone(arm, f'{b}.{side}', lg)
        for b in ('lowerleg01', 'lowerleg02'):
            mh.aim_bone(arm, f'{b}.{side}', sh)
        if P.get('twist'):
            fa = arm.pose.bones[f'lowerarm02.{side}']
            mh.rotate_bone(arm, f'lowerarm02.{side}', (fa.tail - fa.head).normalized(), -P['twist'] * sg)
        for f in range(2, 6):
            for k in range(1, 4):
                bn = f'finger{f}-{k}.{side}'
                if bn in arm.pose.bones:
                    pb = arm.pose.bones[bn]
                    mh.rotate_bone(arm, bn, (pb.matrix.to_3x3() @ Vector((1, 0, 0))).normalized(), P['curl'][k - 1])
    bpy.context.view_layer.update()


def ground(body, arm):
    ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    zmin = min((ev.matrix_world @ v.co).z for v in m.vertices)
    ev.to_mesh_clear()
    arm.location.z -= zmin
    bpy.context.view_layer.update()


def build(p=None, bake=True):
    """Build, pose to the sheet's stance, apply the shape layers to the posed body and make that
    the rest pose (the game's bind pose). bake=False: posed, without the shape layers (for
    fitting the pose)."""
    p = p or params()
    targets = {**TARGETS, **mh.breast_targets(p['breast']['size'], p['breast']['firmness'])}
    body, arm = mh.build_human(targets=targets, modifiers=p['modifiers'], height=1.68, name='woman')
    pose(arm, p['pose'])
    ground(body, arm)
    if not bake:
        return body, arm
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    V = np.array([ev.matrix_world @ v.co for v in m.vertices])
    ev.to_mesh_clear()
    skin = (mh.skin_weights(body, arm), mh.skin_matrices(arm))
    mh.bake_pose(body, arm, shape_layers(p, skin)(V))
    add_eyes(arm, targets, p)
    return body, arm


def eye_material():
    """Sclera, limbal ring, iris, pupil by the angle from the eyeball's forward axis (local -Y):
    the iris ~1.4 cm across (the concept's, large), the pupil ~0.45 cm; glossy (wet)."""
    mat = bpy.data.materials.get('eye') or bpy.data.materials.new('eye')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.12
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    norm = nt.nodes.new('ShaderNodeVectorMath'); norm.operation = 'NORMALIZE'
    neg = nt.nodes.new('ShaderNodeMath'); neg.operation = 'MULTIPLY'; neg.inputs[1].default_value = -1.0
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Object'], norm.inputs[0])
    nt.links.new(norm.outputs['Vector'], sep.inputs[0])
    nt.links.new(sep.outputs['Y'], neg.inputs[0])
    nt.links.new(neg.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    cr = ramp.color_ramp
    stops = [(0.0, (0.72, 0.68, 0.64)), (0.86, (0.70, 0.66, 0.62)), (0.872, (0.05, 0.03, 0.02)),
             (0.885, (0.12, 0.06, 0.03)), (0.95, (0.26, 0.14, 0.06)), (0.982, (0.10, 0.05, 0.02)),
             (0.986, (0.01, 0.01, 0.01)), (1.0, (0.0, 0.0, 0.0))]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*col, 1)
    return mat


def add_eyes(arm, targets, p):
    """Eyeballs where MakeHuman's eye helpers are (the head is not posed, so the rest positions
    hold), parented to the head bone."""
    V = mh.to_blender(mh.morphed({**targets, **mh.modifier_targets(p['modifiers'])}), 1.68)
    g = mh.load_base()['groups']
    mat = eye_material()
    for side in ('l', 'r'):
        E = V[sorted(g[f'helper-{side}-eye'])]
        c = E.mean(0)
        r = float(np.linalg.norm(E - c, axis=1).mean())
        me = bpy.data.meshes.new(f'eye.{side}')
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=r)
        bm.to_mesh(me); bm.free()
        for poly in me.polygons:
            poly.use_smooth = True
        ob = bpy.data.objects.new(f'eye.{side}', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(mat)
        ob.location = Vector(c) + Vector((0, 0, arm.location.z))
        bpy.context.view_layer.update()
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = 'BONE'
        ob.parent_bone = 'head'
        bpy.context.view_layer.update()
        ob.matrix_world = mw
