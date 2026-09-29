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


def shape_layers(p, skin):
    """Sculpt layers, applied to the posed body (skin: its weights and pose matrices): the chest
    wall, the grab strokes, the profile warp, the bust."""
    global _armw
    if _armw is None:
        _armw = sculpt.arm_mask(mh)
    F = mh.load_base()['F']
    region, wb = breast_region()
    donor = body_vertices(p, skin, male=True)

    def layers(V):
        # MakeHuman's own breast (even its smallest is a cone with a nipple and a fold) is replaced
        # by the male macro's chest wall (pectorals over the ribcage), in depth only, blended by
        # the breast bones' skin weights and aligned where the blend ends: the parametric bust is
        # then the only form there (a clothed base: no nipples)
        edge = (wb > 0.02) & (wb < 0.15)
        dy = donor[:, 1] - V[:, 1]
        dy -= np.median(dy[edge])
        V = V.copy()
        V[:, 1] += np.clip(wb * 1.5, 0, 1) * dy
        V = sculpt.smooth(V, F, region, iters=8)
        V = sculpt.profile_warp(sculpt.grab(V, p.get('sculpt')), p.get('warp'), _armw)
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
    return body, arm
