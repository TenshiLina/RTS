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
        gfaces = {}
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
                    if g != 'body':
                        gfaces.setdefault(g, []).append(idx)
                    if g == 'body':
                        F.append(idx)
                        fuv.append([int(t.split('/')[1]) - 1 if '/' in t and t.split('/')[1] else -1 for t in toks])
        _base = {'V': np.array(V, dtype=np.float64), 'F': F, 'groups': groups, 'uv': np.array(uv), 'fuv': fuv,
                 'gfaces': gfaces}
    return _base


_targets = {}


def read_target(path):
    """(vertex indices, offsets) of a .target file (cached)."""
    if path in _targets:
        return _targets[path]
    idx, d = [], []
    with open(path) as fh:
        for l in fh:
            if not l.strip() or l.startswith('#'):
                continue
            p = l.split()
            idx.append(int(p[0]))
            d.append([float(p[1]), float(p[2]), float(p[3])])
    _targets[path] = (np.array(idx, dtype=np.int64), np.array(d))
    return _targets[path]


def morphed(targets, regional=None):
    """Base vertices with targets applied: {'group/name': weight} (paths under data/targets).
    regional: [(targets, per-vertex weights)] applied only where the weights are (a head-only
    macro blend, say)."""
    V = load_base()['V'].copy()
    for name, w in targets.items():
        if not w:
            continue
        i, d = read_target(os.path.join(MH, 'targets', name + '.target'))
        V[i] += w * d
    for tg, wv in regional or []:
        # the region's shape only: each target's displacement less its mean over the region's
        # fade-out band (the upper neck, for the head), so the region is reshaped in place — a
        # race macro also changes the body's height, which would lift the whole head
        band = np.where((wv > 0.2) & (wv < 0.8))[0]
        for name, w in tg.items():
            if not w:
                continue
            i, d = read_target(os.path.join(MH, 'targets', name + '.target'))
            D = np.zeros_like(V)
            D[i] = d
            D -= D[band].mean(0)
            m = wv > 0
            V[m] += (w * wv[m])[:, None] * D[m]
    return V


_region = {}


def region_weights(root='head'):
    """Per-vertex weight (all vertices) of the skeleton's subtree at `root`: the sum of the skin
    weights of its bones, so the region fades out as the skinning does (the neck, for the head);
    the helpers of the head (eyes, lashes, teeth, tongue) are fully in."""
    if root not in _region:
        sk = json.load(open(os.path.join(MH, 'default.mhskel')))['bones']
        sub, todo = set(), [root]
        while todo:
            b = todo.pop()
            sub.add(b)
            todo += [n for n, v in sk.items() if v['parent'] == b]
        W = json.load(open(os.path.join(MH, 'default_weights.mhw')))['weights']
        base = load_base()
        w = np.zeros(len(base['V']))
        for b in sub:
            for i, x in W.get(b, []):
                w[i] += x
        if root == 'head':
            for g, idx in base['groups'].items():
                if any(k in g for k in ('-eye', 'eyelashes', 'teeth', 'tongue')):
                    w[list(idx)] = 1.0
        _region[root] = np.clip(w, 0, 1)
    return _region[root]


def modifier_targets(values):
    """Map modifier values (e.g. {'hip/hip-scale-horiz': -0.3}) to target weights: a modifier
    'group/name' with value v uses 'group/name-{min}' for v<0 and 'group/name-{max}' for v>0; the
    min/max words come from modeling_modifiers.json. Modifiers with l-/r- twins are applied to both
    sides when given without the prefix ('armslegs/upperarm-scale-horiz'). Modifiers that share a
    name across axes are given as 'group/name-lo|hi' ('nose/nose-trans-down|up')."""
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
        if '|' in name:  # 'name-lo|hi': modifiers sharing a name across axes (nose-trans-down|up)
            lohi, hi = name.split('|')
            base, lo = lohi.rsplit('-', 1)
            out[f'{g}/{base}-{lo if v < 0 else hi}'] = abs(v)
            continue
        if os.path.exists(os.path.join(MH, 'targets', g, name + '.target')):  # one-sided (head-oval)
            if v > 0:
                out[f'{g}/{name}'] = v
            continue
        names = [name] if os.path.exists(os.path.join(MH, 'targets', g, name + '-incr.target')) or (g + '/' + name) in ends else ['l-' + name, 'r-' + name]
        for n in names:
            # (a few target pairs exist without an entry in the modifier list: decr/incr)
            lo, hi = ends.get(g + '/' + n, ('decr', 'incr'))
            out[f'{g}/{n}-{lo if v < 0 else hi}'] = abs(v)
    return out


def breast_targets(size=0.5, firmness=0.5, macro='female-young-averagemuscle-averageweight'):
    """MakeHuman's BreastSize/BreastFirmness macro modifiers (0..1, 0.5 = the macro's own breast):
    weights of the cup × firmness targets, each axis blending min–average–max linearly."""
    def axis(v):
        return {'min': max(0.0, 1 - 2 * v), 'max': max(0.0, 2 * v - 1), 'average': 1 - abs(2 * v - 1)}
    out = {}
    for c, wc in axis(size).items():
        for f, wf in axis(firmness).items():
            if wc * wf > 1e-6 and not (c == f == 'average'):
                out[f'breast/{macro}-{c}cup-{f}firmness'] = wc * wf
    return out


def to_blender(V, height, ref=None):
    """MakeHuman frame (Y-up, decimetres, facing +Z) → Blender (Z-up, metres, facing -Y), scaled
    so the body is `height` tall with its soles on z = 0 — or, with ref = (group name, z), so that
    group's mean sits at z (a body landmark: the head's shape then leaves the body's scale alone)."""
    B = np.stack([V[:, 0], -V[:, 2], V[:, 1]], axis=1)
    body = B[:BODY_VERTS]
    zmin, zmax = body[:, 2].min(), body[:, 2].max()
    if ref:
        zr = B[sorted(load_base()['groups'][ref[0]]), 2].mean()
        s = ref[1] / (zr - zmin)
    else:
        s = height / (zmax - zmin)
    B = B * s
    B[:, 2] -= zmin * s
    to_blender.scale = s
    return B


def delta_to_blender(d, s):
    """A target's offsets in the Blender frame at scale s."""
    return np.stack([d[:, 0], -d[:, 2], d[:, 1]], axis=1) * s


def add_modifier_keys(ob, names):
    """Shape keys '<modifier>:-' and '<modifier>:+' for fitting modifiers interactively (their
    values are the modifier's negative/positive weights)."""
    s = ob['mh_scale']
    if not ob.data.shape_keys:
        ob.shape_key_add(name='Basis')
    n = len(ob.data.vertices)
    for key in names:
        for sign, v in (('-', -1), ('+', 1)):
            k = ob.shape_key_add(name=f'{key}:{sign}', from_mix=False)
            co = np.empty(n * 3)
            k.data.foreach_get('co', co)
            co = co.reshape(-1, 3)
            for tname, w in modifier_targets({key: v}).items():
                i, d = read_target(os.path.join(MH, 'targets', tname + '.target'))
                m = i < n
                co[i[m]] += delta_to_blender(d[m], s) * w
            k.data.foreach_set('co', co.ravel())
            k.value = 0.0


def set_modifier_keys(ob, values):
    for key, v in values.items():
        ob.data.shape_keys.key_blocks[f'{key}:-'].value = max(0.0, -v)
        ob.data.shape_keys.key_blocks[f'{key}:+'].value = max(0.0, v)


def build_human(targets=None, modifiers=None, height=1.68, name='human', rig=True, shape=None, regional=None, ref=None,
                morph=None):
    """shape: optional V -> V applied to the morphed body (Blender frame) before the mesh and the
    rig are built (sculpt layers); morph: the same for all vertices (body and helpers: the rig's
    joints follow), applied first."""
    base = load_base()
    tw = dict(targets or {})
    tw.update(modifier_targets(modifiers or {}))
    V = to_blender(morphed(tw, regional), height, ref)
    if morph:
        V = morph(V)
    if shape:
        V = V.copy()
        V[:BODY_VERTS] = shape(V[:BODY_VERTS])
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
    ob['mh_scale'] = to_blender.scale
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


def skin_weights(body, arm):
    """Dense (vertices × bones) weight matrix from the body's vertex groups, rows normalised as
    Blender's armature deform does; bone order = arm.pose.bones."""
    names = [pb.name for pb in arm.pose.bones]
    col = {n: j for j, n in enumerate(names)}
    gi = {g.index: col.get(g.name) for g in body.vertex_groups}
    W = np.zeros((len(body.data.vertices), len(names)))
    for v in body.data.vertices:
        for g in v.groups:
            j = gi.get(g.group)
            if j is not None:
                W[v.index, j] += g.weight
    s = W.sum(1, keepdims=True)
    return np.divide(W, s, out=np.zeros_like(W), where=s > 0)


def skin_matrices(arm):
    """Per bone (arm.pose.bones order): the world-space deform matrix posed @ rest⁻¹."""
    bpy.context.view_layer.update()
    mw = arm.matrix_world
    return np.array([np.array(mw @ pb.matrix @ pb.bone.matrix_local.inverted() @ mw.inverted()) for pb in arm.pose.bones])


def lbs(V, W, M):
    """Linear blend skinning of rest vertices V (n×3) with weights W (n×B) and matrices M (B×4×4)."""
    Vh = np.c_[V, np.ones(len(V))]
    P = np.einsum('bij,nj->nbi', M[:, :3, :], Vh)  # n × B × 3
    return np.einsum('nb,nbi->ni', W, P)


def bake_pose(body, arm, V=None):
    """Make the current pose the rest pose: the mesh takes its posed shape (or V, a reshaped posed
    shape), the armature's pose becomes its rest, and the body is re-bound."""
    dg = bpy.context.evaluated_depsgraph_get()
    if V is None:
        ev = body.evaluated_get(dg)
        m = ev.to_mesh()
        V = np.array([ev.matrix_world @ v.co for v in m.vertices])
        ev.to_mesh_clear()
    for mod in [m for m in body.modifiers if m.type == 'ARMATURE']:
        body.modifiers.remove(mod)
    inv = np.array(body.matrix_world.inverted())
    Vl = (np.c_[V, np.ones(len(V))] @ inv.T)[:, :3]
    body.data.vertices.foreach_set('co', Vl.astype(np.float32).ravel())
    body.data.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    mod = body.modifiers.new('armature', 'ARMATURE')
    mod.object = arm
    bpy.context.view_layer.update()
