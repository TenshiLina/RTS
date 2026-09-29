"""MakeHuman (CC0) base human for Blender scripts.

Builds the body from the MakeHuman 1.x base mesh with morph targets baked in (numpy), an armature
from the default skeleton (joints are means of mesh vertices, so the rig follows the morphed body;
bone roll from MakeHuman's rotation planes) and the default skin weights as vertex groups.

    from lib import mh
    body, arm = mh.build_human(targets={'macrodetails/asian-female-young': 1, ...}, height=1.68)

Frame: Blender Z-up, metres, the figure faces -Y (its left is +X), feet on z = 0.
"""
import json, os
import numpy as np
import bpy
from mathutils import Vector

TOOLS = os.environ.get('RTS_TOOLS', os.path.expanduser('~/.cache/rts-tools'))
MH = os.path.join(TOOLS, 'makehuman')
BODY_VERTS = 13380  # the body is the first block of base.obj; helpers (eyes, lashes, teeth…) follow

_base = None


def load_base():
    """Vertices (all, MakeHuman frame), body faces, helper vertex groups."""
    global _base
    if _base is None:
        V, F, groups, g = [], [], {}, ''
        uv, fuv = [], []
        with open(os.path.join(MH, 'base.obj')) as fh:
            for l in fh:
                if l.startswith('v '):
                    V.append([float(x) for x in l.split()[1:4]])
                elif l.startswith('vt '):
                    uv.append([float(x) for x in l.split()[1:3]])
                elif l.startswith('g '):
                    g = l[2:].strip()
                elif l.startswith('f '):
                    toks = l.split()[1:]
                    idx = [int(t.split('/')[0]) - 1 for t in toks]
                    groups.setdefault(g, set()).update(idx)
                    if g == 'body':
                        F.append(idx)
                        fuv.append([int(t.split('/')[1]) - 1 if '/' in t and t.split('/')[1] else -1 for t in toks])
        _base = {'V': np.array(V, dtype=np.float64), 'F': F, 'groups': groups, 'uv': np.array(uv), 'fuv': fuv}
    return _base


def read_target(path):
    idx, d = [], []
    with open(path) as fh:
        for l in fh:
            if not l.strip() or l.startswith('#'):
                continue
            p = l.split()
            idx.append(int(p[0]))
            d.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, dtype=np.int64), np.array(d)


def morphed(targets):
    """Base vertices with targets applied: {'group/name': weight} (paths under data/targets)."""
    V = load_base()['V'].copy()
    for name, w in targets.items():
        if not w:
            continue
        i, d = read_target(os.path.join(MH, 'targets', name + '.target'))
        V[i] += w * d
    return V


def modifier_targets(values):
    """Map modifier values (e.g. {'hip/hip-scale-horiz': -0.3}) to target weights: a modifier
    'group/name' with value v uses 'group/name-{min}' for v<0 and 'group/name-{max}' for v>0; the
    min/max words come from modeling_modifiers.json. Modifiers with l-/r- twins are applied to both
    sides when given without the prefix ('armslegs/upperarm-scale-horiz')."""
    mods = json.load(open(os.path.join(MH, 'modeling_modifiers.json')))
    ends = {}
    for g in mods:
        for m in g['modifiers']:
            if 'target' in m and 'min' in m:
                ends[g['group'] + '/' + m['target']] = (m['min'], m['max'])
    out = {}
    for key, v in values.items():
        if not v:
            continue
        g, name = key.split('/', 1)
        names = [name] if os.path.exists(os.path.join(MH, 'targets', g, name + '-incr.target')) or (g + '/' + name) in ends else ['l-' + name, 'r-' + name]
        for n in names:
            # (a few target pairs exist without an entry in the modifier list: decr/incr)
            lo, hi = ends.get(g + '/' + n, ('decr', 'incr'))
            out[f'{g}/{n}-{lo if v < 0 else hi}'] = abs(v)
    return out


def to_blender(V, height):
    """MakeHuman frame (Y-up, decimetres, facing +Z) → Blender (Z-up, metres, facing -Y), scaled
    so the body is `height` tall with its soles on z = 0."""
    B = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
    body = B[:BODY_VERTS]
    zmin, zmax = body[:, 2].min(), body[:, 2].max()
    s = height / (zmax - zmin)
    B = B * s
    B[:, 2] -= zmin * s
    return B


def build_human(targets=None, modifiers=None, height=1.68, name='human', rig=True):
    base = load_base()
    tw = dict(targets or {})
    tw.update(modifier_targets(modifiers or {}))
    V = to_blender(morphed(tw), height)
    # ---- body mesh (with the MakeHuman UVs)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in V[:BODY_VERTS]], [], base['F'])
    uvl = me.uv_layers.new(name='UVMap')
    k = 0
    for poly, fu in zip(me.polygons, base['fuv']):
        for li, ui in zip(poly.loop_indices, fu):
            if ui >= 0:
                uvl.data[li].uv = base['uv'][ui]
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob['mh_targets'] = json.dumps(tw)
    if not rig:
        return ob, None
    arm = build_armature(V, name + '_rig')
    # ---- skin weights
    W = json.load(open(os.path.join(MH, 'default_weights.mhw')))['weights']
    for bone, lst in W.items():
        vg = ob.vertex_groups.new(name=bone)
        by_w = {}
        for i, w in lst:
            if i < BODY_VERTS:
                by_w.setdefault(round(w, 4), []).append(i)
        for w, ids in by_w.items():
            vg.add(ids, w, 'REPLACE')
    mod = ob.modifiers.new('armature', 'ARMATURE')
    mod.object = arm
    ob.parent = arm
    return ob, arm


def joint_positions(V):
    sk = json.load(open(os.path.join(MH, 'default.mhskel')))
    return sk, {j: V[idx].mean(axis=0) for j, idx in sk['joints'].items()}


def build_armature(V, name):
    """Armature from default.mhskel with joints evaluated on the (already transformed) vertices."""
    sk, J = joint_positions(V)
    ad = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    bones = sk['bones']
    eb = {}
    for bn, b in bones.items():
        e = ad.edit_bones.new(bn)
        e.head = Vector(J[b['head']])
        e.tail = Vector(J[b['tail']])
        if (e.tail - e.head).length < 1e-5:
            e.tail = e.head + Vector((0, 0, 0.01))
        eb[bn] = e
    for bn, b in bones.items():
        if b['parent']:
            eb[bn].parent = eb[b['parent']]
    # roll: the bone's Z axis along the normal of its MakeHuman rotation plane
    for bn, b in bones.items():
        pl = sk['planes'].get(b['rotation_plane'])
        if not pl:
            continue
        a, c, d = (Vector(J[p]) for p in pl)
        n = (c - a).cross(d - c)
        if n.length > 1e-8:
            eb[bn].align_roll(n.normalized())
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def aim_bone(arm, bone, direction):
    """Pose `bone` so it points along `direction` (world), keeping its twist as far as possible."""
    pb = arm.pose.bones[bone]
    bpy.context.view_layer.update()
    cur = (pb.tail - pb.head).normalized()
    want = Vector(direction).normalized()
    q = cur.rotation_difference(want)
    M = pb.matrix.copy()
    head = M.translation.copy()
    R = q.to_matrix().to_4x4()
    M.translation = (0, 0, 0)
    M = R @ M
    M.translation = head
    pb.matrix = M
    bpy.context.view_layer.update()


def rotate_bone(arm, bone, axis, degrees):
    """Rotate a posed bone about a world axis through its head."""
    from mathutils import Matrix
    import math
    pb = arm.pose.bones[bone]
    bpy.context.view_layer.update()
    M = pb.matrix.copy()
    head = M.translation.copy()
    M.translation = (0, 0, 0)
    M = Matrix.Rotation(math.radians(degrees), 4, Vector(axis)) @ M
    M.translation = head
    pb.matrix = M
    bpy.context.view_layer.update()
