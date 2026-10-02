"""The base woman: MakeHuman CC0 base, shaped and posed to the faction's concept sheet.

Build order: MakeHuman macro + modifiers → rig → pose to the sheet's stance → sculpt layers on
the posed body (grab strokes, profile warp) → that shape and pose become the rest pose.
Parameters live in woman.json, written by the fitters (fit_shape, fit_posture, fit_face) and
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
        p['eye_depth'] = saved.get('eye_depth', 0.0)
        p['face'] = saved.get('face', {})
        p['face_model'] = saved.get('face_model')
        p['neck_shift'] = saved.get('neck_shift')
    return p


# the body's scale is set by the neck's base (MakeHuman's neck joint) at the height it has in the
# fitted 1.68 m figure, not by the vertex: the head's shape (fitted to the concept's face) then
# leaves the body's fit alone, and the vertex lands where the face fit puts it (~1.68)
SCALE_REF = ('joint-neck', 1.4226)

def face_regional(p):
    """The head's own macro blend (p['face']: race fractions and a child fraction for youth),
    as a head-only delta from the body's macro."""
    f = p.get('face') or {}
    cau, kid = f.get('caucasian', 0.0), f.get('child', 0.0)
    if not (cau or kid):
        return None
    t = {}
    for race, rw in (('asian', 1 - cau), ('caucasian', cau)):
        t[f'macrodetails/{race}-female-young'] = t.get(f'macrodetails/{race}-female-young', 0) + rw * (1 - kid)
        t[f'macrodetails/{race}-female-child'] = rw * kid
    t['macrodetails/asian-female-young'] -= 1.0   # (the body's)
    return [(t, mh.region_weights('head'))]


def face_morph(p):
    """The head from the face model (lib/ict.py: p['face_model'] = {'coeffs', 'scale', 'dz',
    'ears', 'detail'}), as a function of all the vertices — or None (MakeHuman's own head).
    'ears', 'lids', 'brow', 'eyes', 'drape': the ears' size and placement, the eyes' openings, the
    brow ridge's flattening, the eyes' depth, the lids draped over the eyeball that is theirs (ict.
    ear_warp, lid_warp, brow_warp, eye_warp, lid_drape); 'margin': the lid margins laid along the
    trace (ict.margin_warp, solved by character/fit_margin.py); 'undereye', 'uplid': the skin under the lower
    lids and over the upper ones set flat from the margins (ict.undereye, ict.uplid; superseded by 'fill');
    'fill', 'corner_relax', 'crease': the skin around the lids made smooth (the lower lid toward a chord to the
    cheek), the outer corners' collar relaxed, the upper lid's crease along the concept's, last (ict.lid_fill,
    ict.corner_relax, ict.lid_crease); 'globe': {'iris': m}, the built eye's iris
    (add_eyes); 'symmetric': the model's face mirrored from its left side. 'detail': a
    few MakeHuman feature modifiers applied on the model's face (the lids' size, where the concept
    is beyond the real faces the model spans), {'group/l-name': value} for both sides; 'eyefold_weight': the
    eyefold targets weighted along the lid (_eyefold_weight: their groove tapered toward the nose, the flare
    past the outer corner eased)."""
    fm = p.get('face_model')
    if not fm:
        return None
    from lib import ict
    detail = {}
    for k, v in (fm.get('detail') or {}).items():
        g, n = k.split('/')
        for side in (('l-', 'r-') if n.startswith('l-') else ('',)):
            detail[f'{g}/{side}{n[2:]}' if side else k] = v
    tw = mh.modifier_targets(detail)

    def morph(V):
        s = mh.to_blender.scale            # (the scale of the to_blender call that made V)
        V = ict.apply(V, fm['coeffs'], scale=fm.get('scale', 1.0), dz=fm.get('dz', 0.0))
        if fm.get('symmetric'):     # (the model's faces are real, asymmetric ones; the concept's is not)
            V = mh.symmetrized(V)
        V = ict.ear_warp(V, fm.get('ears'))
        V = ict.lid_warp(V, fm.get('lids'))
        V = ict.brow_warp(V, fm.get('brow'))
        V = ict.eye_warp(V, fm.get('eyes'))
        V = ict.lid_drape(V, fm.get('drape'))
        for name, w in tw.items():
            if w:
                i, d = mh.read_target(os.path.join(mh.MH, 'targets', name + '.target'))
                dV = w * mh.delta_to_blender(d, s)
                if 'eyefold' in name and fm.get('eyefold_weight'):
                    dV = dV * _eyefold_weight(V[i], name, V, fm['eyefold_weight'])[:, None]
                V[i] += dV
        V = ict.margin_warp(V, fm.get('margin'))      # (the margins laid along the trace)
        V = ict.undereye(V, fm.get('undereye'))       # (then the lids' skin set from them: from the margins as
        V = ict.uplid(V, fm.get('uplid'))             # laid, the chords' anchors where they end up)
        V = ict.lid_fill(V, fm.get('fill'))           # (the skin around the lids made smooth, its collar at
        V = ict.corner_relax(V, fm.get('corner_relax'))   # the outer corners relaxed,
        V = ict.lid_crease(V, fm.get('crease'))       # then the upper lid's crease)
        return neck_shift(V, p.get('neck_shift'))
    return morph


def _eyefold_weight(P, name, V, prm):
    """Per-vertex weights for a MakeHuman eyefold target ('eyes/l-…' or 'eyes/r-…') along its lid, by the
    distance across from the pupil (m, lateral +): its groove runs level while the concept's crease follows
    the margin down toward the nose, and it flares past the outer corner. prm: {'medial': (a, b, w) — 1
    lateral of a, w medial of b; 'lateral': (a, b, w) — 1 medial of a, w lateral of b}."""
    from lib import face
    sd = 'r' if '/r-' in name else 'l'
    sg = 1.0 if sd == 'l' else -1.0
    lx = sg * (P[:, 0] - face.eye_centre(V, sd)[0])
    sm = lambda t: t * t * (3 - 2 * t)
    w = np.ones(len(P))
    if prm.get('medial'):
        a, b, wm = prm['medial']
        w *= 1 - (1 - wm) * sm(np.clip((a - lx) / (a - b), 0, 1))
    if prm.get('lateral'):
        a, b, wl = prm['lateral']
        w *= 1 - (1 - wl) * sm(np.clip((lx - a) / (b - a), 0, 1))
    return w


def neck_shift(V, prm):
    """The head and the upper neck moved back over the torso ('back', metres), the neck between
    sheared smoothly — from 'lo' to 'hi' (metres below the pupil), and as far as a vertex is the
    neck's and the head's (their skinning: the shoulders stay). The concept's side view has the
    neck as a straight column under the head; ours leaned forward partway up (the head fitted to
    the close-up profile, the neck's base to the full-body side view). Everything above 'hi' moves
    as one: the head keeps its angle and its height."""
    if not prm or not prm.get('back'):
        return V
    from lib import face
    zp = face.eye_centre(V)[2]
    lo, hi = zp - prm['lo'], zp - prm['hi']
    t = np.clip((V[:, 2] - lo) / (hi - lo), 0, 1)
    reg = np.maximum(mh.region_weights('neck01'), mh.region_weights('head'))
    w = t * t * (3 - 2 * t) * np.clip(2 * reg, 0, 1)   # (at least half the neck's: all the way)
    V = V.copy()
    V[:, 1] += prm['back'] * w
    return V


def rest_vertices(p, face=True):
    """All vertices (body + helpers), rest pose, Blender frame: the macro, the head's own macro
    blend, the modifiers, the face model (face=False: without it)."""
    t = {**TARGETS, **mh.breast_targets(p['breast']['size'], p['breast']['firmness'])}
    t.update(mh.modifier_targets(p['modifiers']))
    V = mh.to_blender(mh.morphed(t, face_regional(p)), 1.68, SCALE_REF)
    fn = face_morph(p) if face else None
    return fn(V) if fn else V


def body_vertices(p, skin=None):
    """The body's vertices (Blender frame) before the shape layers: modifiers, then — given
    skin = (W, M) from posed_skin() — the pose, by linear blend skinning as Blender does."""
    V = rest_vertices(p)[:mh.BODY_VERTS]
    if skin:
        V = mh.lbs(V, *skin)
        V[:, 2] -= V[:, 2].min()  # grounded, as build() does
    return V


def posed_skin(p):
    """Skin weights and pose matrices for body_vertices(), from a Blender build of p (the pose
    matrices hold for nearby modifier values, whose joints barely move)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, arm = mh.build_human(targets={**TARGETS, **mh.breast_targets(p['breast']['size'], p['breast']['firmness'])},
                               modifiers=p['modifiers'], height=1.68, name='woman', regional=face_regional(p),
                               ref=SCALE_REF, morph=face_morph(p))
    pose(arm, p['pose'])
    return mh.skin_weights(body, arm), mh.skin_matrices(arm)


_armw = None


def shape_layers(p, skin=None):
    """Sculpt layers, applied to the posed body: the grab strokes, then the profile warp.
    (skin: unused, kept for the fitters' calls.)"""
    global _armw
    if _armw is None:
        _armw = sculpt.arm_mask(mh)
    return lambda V: sculpt.profile_warp(sculpt.grab(V, p.get('sculpt')), p.get('warp'), _armw)


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
    body, arm = mh.build_human(targets=targets, modifiers=p['modifiers'], height=1.68, name='woman',
                               regional=face_regional(p), ref=SCALE_REF, morph=face_morph(p))
    pose(arm, p['pose'])
    ground(body, arm)
    if not bake:
        return body, arm
    # the head's pose (rest → world), for the parts placed from rest positions: the eyes, the lashes
    bpy.context.view_layer.update()
    pb = arm.pose.bones['head']
    arm['head_pose'] = [v for row in (arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()) for v in row]
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    V = np.array([ev.matrix_world @ v.co for v in m.vertices])
    ev.to_mesh_clear()
    skin = (mh.skin_weights(body, arm), mh.skin_matrices(arm))
    mh.bake_pose(body, arm, shape_layers(p, skin)(V))
    add_eyes(arm, targets, p)
    return body, arm


def eye_material_painted():
    """The eye without an eye system (face_model.eye_system): sclera, limbal ring, iris, pupil
    painted on the globe by the angle from its forward axis (local -Y); glossy (wet)."""
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
    stops = [(0.0, (0.34, 0.30, 0.28)), (0.7, (0.46, 0.42, 0.39)), (0.828, (0.52, 0.48, 0.45)), (0.84, (0.05, 0.03, 0.02)),
             (0.855, (0.12, 0.06, 0.03)), (0.95, (0.26, 0.14, 0.06)), (0.982, (0.10, 0.05, 0.02)),
             (0.986, (0.01, 0.01, 0.01)), (1.0, (0.0, 0.0, 0.0))]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = cr.elements.new(pos)
        e.color = (*col, 1)
    return mat


# the eye's parts, as fractions of the iris' radius (the limbus): the pupil, the limbal ring
PUPIL, LIMBAL = 0.36, 0.92


def eye_material(iris_r):
    """The eyeball's surface: the iris by the distance from the eyeball's forward axis (local -Y)
    over its radius iris_r (m) — pupil, iris, limbal ring (IRIS_RAMP; look.py recolours the iris
    band) — and outside it the sclera, by the angle from the axis (darker toward the sides); the
    sclera wet (glossy), the iris matte and without a gloss of its own under the cornea (a rough
    specular layer on it reads as a grey sheen: the pupil goes grey)."""
    mat = bpy.data.materials.get('eye') or bpy.data.materials.new('eye')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in [n for n in nt.nodes if n.type != 'OUTPUT_MATERIAL']:
        nt.nodes.remove(n)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0].inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])

    def math(op, a, b=None, clamp=False):
        m = nt.nodes.new('ShaderNodeMath'); m.operation = op; m.use_clamp = clamp
        for k, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[k].default_value = v
            else:
                nt.links.new(v, m.inputs[k])
        return m.outputs[0]
    rho = math('SQRT', math('ADD', math('MULTIPLY', sep.outputs['X'], sep.outputs['X']),
                            math('MULTIPLY', sep.outputs['Z'], sep.outputs['Z'])))
    fac = math('DIVIDE', rho, iris_r)
    iris = nt.nodes.new('ShaderNodeValToRGB'); iris.name = 'IRIS_RAMP'
    nt.links.new(fac, iris.inputs['Fac'])
    stops = [(0.0, (0.0, 0.0, 0.0)), (PUPIL - 0.02, (0.01, 0.01, 0.01)), (PUPIL, (0.10, 0.05, 0.02)),
             (0.6, (0.26, 0.14, 0.06)), (LIMBAL - 0.03, (0.12, 0.06, 0.03)), (LIMBAL, (0.05, 0.03, 0.02)),
             (1.0, (0.10, 0.08, 0.07))]
    cr = iris.color_ramp
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        cr.elements.new(pos).color = (*col, 1)
    norm = nt.nodes.new('ShaderNodeVectorMath'); norm.operation = 'NORMALIZE'
    nt.links.new(tc.outputs['Object'], norm.inputs[0])
    sepn = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(norm.outputs['Vector'], sepn.inputs[0])
    sclera = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(math('MULTIPLY', sepn.outputs['Y'], -1.0), sclera.inputs['Fac'])
    cs = sclera.color_ramp
    cs.elements[0].position, cs.elements[0].color = 0.0, (0.34, 0.30, 0.28, 1)
    cs.elements[1].position, cs.elements[1].color = 1.0, (0.52, 0.48, 0.45, 1)
    cs.elements.new(0.7).color = (0.46, 0.42, 0.39, 1)
    # the iris where fac < 1 on the front half (a soft edge: the limbus blends into the sclera)
    edge = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(fac, edge.inputs['Value'])
    edge.inputs['From Min'].default_value, edge.inputs['From Max'].default_value = 1.0, 1.08
    edge.inputs['To Min'].default_value, edge.inputs['To Max'].default_value = 1.0, 0.0
    front = math('LESS_THAN', sep.outputs['Y'], 0.0)
    m = math('MULTIPLY', edge.outputs['Result'], front)
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    nt.links.new(m, mix.inputs['Factor'])
    nt.links.new(sclera.outputs['Color'], mix.inputs[6]); nt.links.new(iris.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    rough = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(m, rough.inputs['Value'])
    rough.inputs['To Min'].default_value, rough.inputs['To Max'].default_value = 0.12, 0.55
    nt.links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    spec = nt.nodes.new('ShaderNodeMapRange')          # (the iris has no gloss of its own: the cornea's)
    nt.links.new(m, spec.inputs['Value'])
    spec.inputs['To Min'].default_value, spec.inputs['To Max'].default_value = 0.5, 0.0
    nt.links.new(spec.outputs['Result'], bsdf.inputs['Specular IOR Level'])
    return mat


def cornea_material():
    mat = bpy.data.materials.get('cornea') or bpy.data.materials.new('cornea')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 0.0
    b.inputs['IOR'].default_value = 1.376
    b.inputs['Transmission Weight'].default_value = 1.0
    return mat


def subdivide(body, arm, p, levels=2):
    """The body subdivided for a close look ('levels'), and the detail the cage is too coarse to carry
    added on the subdivided surface (the upper lid's crease, face_model 'crease' {'mode': 'detail'}: its
    lines are a few tenths of a millimetre wide, the cage's rows there 1-4 mm apart; in the game's asset it
    is the normal map's). Returns the subdivision modifier."""
    s_ = body.modifiers.new('s', 'SUBSURF'); s_.levels = s_.render_levels = levels
    cd = (p.get('face_model') or {}).get('crease')
    if cd and cd.get('mode') == 'detail':
        _crease_detail(body, arm, p, cd)
    return s_


def _crease_detail(body, arm, p, prm):
    """The upper lid's crease as the eyelid's own fold, on the subdivided surface: a thin invagination
    along lib/face.REF_EYE_CREASE where the pretarsal platform meets the passive preseptal skin, and that
    skin's lip overhanging it just above (the fold) — 'depth' (m) at the crease over 'below' / 'above'
    (m: Gaussian half-widths; the fold's side the steeper), the lip 'overhang' (m, out) at 'lip_at' above
    it over 'lip_w'; weighted along it by REF_EYE_CREASE_WEIGHT ('level_from', 'tail': lib/ict). A Displace
    modifier along the normals, from a front-projected map in the head's rest frame; the front skin of
    the upper lids only (a vertex group)."""
    from lib import ict, face
    from mathutils import Matrix
    V = rest_vertices(p)
    el, er = face.eye_centre(V, 'l'), face.eye_centre(V, 'r')
    s, zp, cx = face._front_scale((el[0] - er[0]) * 100)
    T, Wt = ict._crease_curve(prm)
    dep, wb, wa = float(prm['depth']), float(prm.get('below', 0.0003)), float(prm.get('above', 0.00018))
    ov, la, lw = float(prm.get('overhang', 0.0)), float(prm.get('lip_at', 0.0005)), float(prm.get('lip_w', 0.0004))
    st = 0.0001
    x0, x1 = -0.055, 0.055
    z0, z1 = el[2] - 0.010, el[2] + 0.020
    gx = np.arange(x0, x1 + st / 2, st); gz = np.arange(z0, z1 + st / 2, st)
    X, Z = np.meshgrid(gx, gz)                                   # (rows z, columns x)
    tx = (cx - T[:, 0]) * s / 100; tz = el[2] + (zp - T[:, 1]) * s / 100
    o = np.argsort(tx)
    zc = np.interp(np.abs(X), tx[o], tz[o])
    col = cx - np.abs(X) * 100 / s
    w = np.interp(col, Wt[:, 0], Wt[:, 1], left=0.0, right=0.0)
    fd = prm.get('fade')
    if fd:   # (fading out toward the outer corner over these sheet columns: none, full)
        tf = np.clip((col - fd[0]) / (fd[1] - fd[0]), 0, 1); w = w * tf * tf * (3 - 2 * tf)
    t = Z - zc
    d = -dep * np.where(t < 0, np.exp(-(t / wb) ** 2), np.exp(-(t / wa) ** 2)) + ov * np.exp(-((t - la) / lw) ** 2)
    d *= w
    scale = 0.002
    img = bpy.data.images.new('crease_detail', len(gx), len(gz), float_buffer=True)
    px = np.zeros((len(gz), len(gx), 4), np.float32)
    px[..., :3] = (0.5 + d / scale)[..., None]; px[..., 3] = 1
    img.pixels.foreach_set(px.ravel())
    tex = bpy.data.textures.new('crease_detail', 'IMAGE'); tex.image = img; tex.extension = 'EXTEND'   # (its border neutral)
    # the map's frame: local (u, v) in [-1, 1] over the grid's rest (x, z), carried by the head's pose
    H = head_pose(arm)
    hx, hz = (x1 - x0) / 2, (z1 - z0) / 2
    M = np.array([[hx, 0, 0, (x0 + x1) / 2], [0, 0, 1, 0], [0, hz, 0, (z0 + z1) / 2], [0, 0, 0, 1]])
    emp = bpy.data.objects.new('crease_frame', None); bpy.context.scene.collection.objects.link(emp)
    emp.matrix_world = Matrix((H @ M).tolist())
    # (the front skin of the upper lids: in front of the eyes, within the map)
    vg = body.vertex_groups.new(name='crease_detail')
    Vw = np.array([v.co for v in body.data.vertices])
    Vr = (Vw - H[:3, 3]) @ np.linalg.inv(H[:3, :3]).T
    near = np.where((np.abs(np.abs(Vr[:, 0]) - abs(el[0])) < 0.025) & (Vr[:, 2] > z0) & (Vr[:, 2] < z1) &
                    (Vr[:, 1] < el[1] - 0.004))[0]
    vg.add(near.tolist(), 1.0, 'REPLACE')
    m = body.modifiers.new('crease_detail', 'DISPLACE')
    m.texture = tex; m.texture_coords = 'OBJECT'; m.texture_coords_object = emp
    m.direction = 'NORMAL'; m.mid_level = 0.5; m.strength = scale; m.vertex_group = 'crease_detail'


def head_pose(arm):
    """The head's pose at the build (rest → world, a 4×4 numpy matrix): build() stores it before
    the pose is baked."""
    return np.array(arm['head_pose']).reshape(4, 4)


def add_eyes(arm, targets, p):
    """Eyeballs where MakeHuman's eye helpers are (sized and placed by the face model's eye system),
    carried by the head's pose, parented to the head bone; looking along the face model's gaze
    (lib/ict.gaze) when there is one. With the eyeballs sized to the lids (face_model.globe), each
    as an eye is built: the globe with the iris a flat disc just behind the limbus (its diameter:
    globe.iris, m), under a clear cornea — a steeper cap (0.65 of the globe's radius) from the
    limbus, bulging ~0.7 mm past the globe; the iris seen through it sits back from the lids, as in
    the concept's profile. Without it, the iris painted on the globe (eye_material_painted)."""
    from mathutils import Matrix
    import bmesh
    H = Matrix(head_pose(arm).tolist())
    V = rest_vertices(p)
    g = mh.load_base()['groups']
    fm = p.get('face_model') or {}
    built = bool((fm.get('globe') or {}).get('iris'))    # (else the painted eye, as before the eye system)
    if built:
        iris_r = fm['globe']['iris'] / 2
        mat, cmat = eye_material(iris_r), cornea_material()
    else:
        mat = eye_material_painted()
    for side in ('l', 'r'):
        E = V[sorted(g[f'helper-{side}-eye'])]
        c = E.mean(0) + np.array([0.0, p.get('eye_depth', 0.0), 0.0])  # set back with the socket stroke
        r = float(np.linalg.norm(E - c, axis=1).mean())
        me = bpy.data.meshes.new(f'eye.{side}')
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=64 if built else 48, v_segments=48 if built else 32, radius=r)
        if built:
            yl = -np.sqrt(max(r ** 2 - iris_r ** 2, 1e-12))            # (the limbus' plane, local)
            for v in bm.verts:     # (the iris: flat, 0.4 mm behind the limbus' plane)
                if v.co.y < 0 and np.hypot(v.co.x, v.co.z) < iris_r:
                    v.co.y = yl + 0.0004
        bm.to_mesh(me); bm.free()
        for poly in me.polygons:
            poly.use_smooth = True
        ob = bpy.data.objects.new(f'eye.{side}', me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(mat)
        co = None
        if built:
            rc = 0.65 * r
            ycc = yl + np.sqrt(max(rc ** 2 - iris_r ** 2, 1e-12))
            cm = bpy.data.meshes.new(f'cornea.{side}')
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=48, radius=rc)
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0.0, ycc, 0.0))
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > yl + 0.0001], context='VERTS')
            bm.to_mesh(cm); bm.free()
            for poly in cm.polygons:
                poly.use_smooth = True
            co = bpy.data.objects.new(f'cornea.{side}', cm)
            bpy.context.scene.collection.objects.link(co)
            co.data.materials.append(cmat)
            co.visible_shadow = False            # (light reaches the iris through it)
        R = Matrix.Identity(4)
        if fm:   # (the face model's gaze: its lids were shaped around it)
            from lib import ict
            gz = Vector(ict.gaze(fm['coeffs'], side).tolist())
            if (fm.get('gaze') or {}).get('straight'):   # (straight ahead: the concept's irises are centred)
                gz = Vector((0.0, -1.0, 0.0))
            out = (fm.get('gaze') or {}).get('out', 0.0)          # (degrees further outward)
            if out:
                gz = Matrix.Rotation(np.radians(out) * (1 if side == 'l' else -1), 3, 'Z') @ gz
            down = (fm.get('gaze') or {}).get('down', 0.0)        # (degrees downward: the concept's irises sit
            if down:                                              #  ~1 px below its pupils' frame)
                gz = Matrix.Rotation(np.radians(down), 3, 'X') @ gz
            R = Vector((0, -1, 0)).rotation_difference(gz).to_matrix().to_4x4()
        ob.matrix_world = H @ Matrix.Translation(Vector(c)) @ R
        if co:
            co.parent = ob
        bpy.context.view_layer.update()
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = 'BONE'
        ob.parent_bone = 'head'
        bpy.context.view_layer.update()
        ob.matrix_world = mw


def eye_points(arm, p):
    """The eyes' centres for the face's frames (lib/face.eye_centre: behind the pupils, where the
    eyeballs' centres are with the eyes looking straight ahead), posed with the head (world, m):
    (left, right) mathutils Vectors."""
    from mathutils import Vector
    from lib import face
    V = rest_vertices(p)
    H = head_pose(arm)
    return tuple(Vector((H[:3, :3] @ face.eye_centre(V, sd) + H[:3, 3]).tolist()) for sd in ('l', 'r'))


def iris_forward(p=None):
    """How far the eye's front (the upper lid's, lib/face.lid_front) is in front of the eyeball's
    centre (m), for the review's profile alignment."""
    from lib import face
    eye, y = face.lid_front(rest_vertices(p or params()))
    return float(eye[1] - y)