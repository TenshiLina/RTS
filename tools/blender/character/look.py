"""A review look for the base woman: skin, lip colour, brows, lashes, iris — so the face's
features can be judged against the concept (whose brows, lashes, liner and lip colour carry much
of its expression) rather than a bare clay head against a made-up face. Review only: the clay
renders stay the structural review.

Every piece comes from explicit data, not shading:
  * lips: the vermilion inside our lips' border loop (lib/face.mouth_border)
  * brows: the concept's brow hair (darker than the skin around it, in the brow bands of the
    front close-up), mirrored to be symmetric and projected from the front onto the head
  * lashes: individual hairs rooted along our lid margins
  * colours: sampled from the concept (skin, lips, iris)

    from character import look
    look.apply(body, arm, p)
"""
import os
import numpy as np
import bpy
from lib import mh, face, sculpt

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
# linear RGB, from the concept's sRGB samples (skin a little under its lit value)
SKIN = (0.60, 0.33, 0.24)   # (calibrated: the review render against the concept's cheek)
# the lips: a soft rose, deepest toward the mouth line and fading into the skin over ~1 mm at the
# vermilion border (a painted edge reads as make-up); the concept's lip centre is sRGB (0.72, 0.41,
# 0.37) under its light
LIPS = (0.44, 0.13, 0.10)        # (the concept's lip/skin ratio: R 0.74, G 0.39, B 0.41)
LIPS_EDGE = (0.51, 0.21, 0.16)
BROW = (0.085, 0.05, 0.038)     # brow hair; with the skin between the hairs the brow reads as the
BROW_DENSITY = 1.0               # concept's (linear 0.15, 0.09, 0.07: ~a fifth of the skin's value)
LASH = (0.012, 0.009, 0.008)
IRIS = [(0.0, (0.035, 0.020, 0.012)), (0.35, (0.10, 0.055, 0.028)), (0.8, (0.16, 0.09, 0.045)), (1.0, (0.05, 0.03, 0.02))]

# the brow mask: a grid in face space (cm; x from the midline, z from the pupils)
GRID = {'x0': -8.0, 'x1': 8.0, 'z0': -1.5, 'z1': 5.0, 'res': 0.02}


# The concept's brows (its image-left brow, sheet px; the other side is its mirror): the upper
# edge, measured where the brow meets the lighter forehead (a clean edge on both sides), and the
# brow's thickness, measured along its body and tail — toward the head the lower edge merges with
# the socket's shading, so the thickness there follows the brow's own taper. Density: lighter at
# the head, where brow hairs grow sparse and upright.
BROW_TOP = [(1250, 259.5), (1256, 258.0), (1262, 257.2), (1268, 257.8), (1274, 259.0), (1280, 260.2),
            (1286, 261.8), (1292, 263.2), (1297, 265.5)]
BROW_THICK = [(1250, 3.5), (1256, 6.0), (1262, 7.4), (1270, 8.0), (1280, 8.6), (1290, 8.8), (1297, 6.0)]
BROW_DENS = [(1250, 0.75), (1258, 0.95), (1280, 0.95), (1292, 0.7), (1297, 0.45)]
# eyeliner: a band over the upper lash line (REF_EYE_UPPER), thickening to a short wing past the
# outer corner (sheet px: its end and thickness)
LINER_WING = (1249.0, 283.2)


def brow_mask(ipd_cm):
    """Brow and liner densities (0..1) on GRID (face space, cm), from the concept's measured brow
    and traced lash line; symmetric."""
    s, zp, cx = face._front_scale(ipd_cm)
    xs = np.arange(GRID['x0'], GRID['x1'], GRID['res'])
    zs = np.arange(GRID['z0'], GRID['z1'], GRID['res'])
    XX, ZZ = np.meshgrid(xs, zs)
    px = cx - np.abs(XX) / s           # the image-left feature's column for |x|
    row = zp - ZZ / s                  # sheet row
    bx = [q[0] for q in BROW_TOP]
    top = np.interp(px, bx, [q[1] for q in BROW_TOP])
    thick = np.interp(px, [q[0] for q in BROW_THICK], [q[1] for q in BROW_THICK])
    dens = np.interp(px, [q[0] for q in BROW_DENS], [q[1] for q in BROW_DENS])
    soft = 1.3   # px: a feathered edge, not a painted one
    inside = np.clip((row - top) / soft + 0.5, 0, 1) * np.clip((top + thick - row) / soft + 0.5, 0, 1)
    ends = np.clip((px - bx[0]) / 2.5, 0, 1) * np.clip((bx[-1] + 1.5 - px) / 3.0, 0, 1)   # rounded ends
    brow = inside * ends * dens * BROW_DENSITY
    # liner: from the upper lash line up by ~1.3 px, widening to the wing
    ux = [q[0] for q in face.REF_EYE_UPPER]
    lash = np.interp(px, ux, [q[1] for q in face.REF_EYE_UPPER])
    wing_t = np.clip((ux[0] - px) / (ux[0] - LINER_WING[0]), 0, 1)       # 0 at the corner, 1 at the wing's end
    lash = np.where(px < ux[0], REF_CORNER_ROW + (LINER_WING[1] - REF_CORNER_ROW) * wing_t, lash)
    th = np.where(px < ux[0], 1.9 * (1 - wing_t) + 0.3, 1.7 + 0.5 * np.clip((1275 - px) / 20, 0, 1))
    liner = np.clip((lash - row + 0.3) / 0.6, 0, 1) * np.clip((row - (lash - th)) / 0.6, 0, 1)
    liner *= np.clip((px - LINER_WING[0]) / 1.0, 0, 1) * np.clip((ux[-1] - 4 - px) / 4.0, 0, 1)
    return brow, liner


REF_CORNER_ROW = 285.0


def lip_weights(V):
    """Per body vertex: (edge, core) 0..1 from the signed distance to the lips' border loop in the
    front projection (lib/face.mouth_border): edge rises from 0.5 mm outside the border to 0.8 mm
    inside it (a soft vermilion edge), core from the border to 2.5 mm inside (the colour deepening
    toward the mouth line); both fade at the corners of the mouth. Only on the lips' front (in
    front of the teeth)."""
    L = face.mouth_border()
    poly = V[L][:, [0, 2]]
    B = V[:mh.BODY_VERTS]
    near = np.where((np.abs(B[:, 0]) < 0.04) & (np.abs(B[:, 2] - poly[:, 1].mean()) < 0.03) &
                    (B[:, 1] < V[L][:, 1].max() + 0.004))[0]
    q = B[near][:, [0, 2]]
    a, b = poly, np.roll(poly, -1, axis=0)
    ab = b - a
    t = np.clip(((q[:, None] - a[None]) * ab[None]).sum(2) / (ab * ab).sum(1)[None], 0, 1)
    d = np.linalg.norm(q[:, None] - (a[None] + t[..., None] * ab[None]), axis=2).min(1)
    d = np.where(_inside(q, poly), d, -d) * 1000                     # mm, + inside
    xc = np.abs(poly[:, 0]).max()
    fade = np.clip((xc - np.abs(q[:, 0])) * 1000 / 4.0, 0, 1)        # the last 4 mm to the corners
    ss = lambda u: (lambda c: c * c * (3 - 2 * c))(np.clip(u, 0, 1))
    edge, core = np.zeros(len(B)), np.zeros(len(B))
    edge[near] = ss((d + 0.5) / 1.3) * (0.55 + 0.45 * fade)
    core[near] = ss(d / 2.5) * fade
    return edge, core


def _inside(pts, poly):
    """Even-odd rule point-in-polygon (numpy)."""
    x, y = pts[:, 0][:, None], pts[:, 1][:, None]
    x0, y0 = poly[:, 0][None, :], poly[:, 1][None, :]
    x1, y1 = np.roll(poly[:, 0], -1)[None, :], np.roll(poly[:, 1], -1)[None, :]
    cross = ((y0 > y) != (y1 > y)) & (x < (x1 - x0) * (y - y0) / np.where(y1 != y0, y1 - y0, 1e-12) + x0)
    return cross.sum(1) % 2 == 1


def _projection_material(name, grid_img, eye_z, lip_attr):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    bsdf.inputs['Subsurface Radius'].default_value = (0.012, 0.004, 0.0025)
    bsdf.inputs['Subsurface Scale'].default_value = 1.0
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    # u = (x*100 - x0)/(x1 - x0), v = ((z - eye_z)*100 - z0)/(z1 - z0)
    def lin(inp, a, b):
        m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY_ADD'
        nt.links.new(inp, m.inputs[0]); m.inputs[1].default_value = a; m.inputs[2].default_value = b
        return m.outputs[0]
    g = GRID
    u = lin(sep.outputs['X'], 100 / (g['x1'] - g['x0']), -g['x0'] / (g['x1'] - g['x0']))
    v = lin(sep.outputs['Z'], 100 / (g['z1'] - g['z0']), (-eye_z * 100 - g['z0']) / (g['z1'] - g['z0']))
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(u, comb.inputs[0]); nt.links.new(v, comb.inputs[1])
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = grid_img; tex.extension = 'CLIP'; tex.interpolation = 'Cubic'
    nt.links.new(comb.outputs[0], tex.inputs['Vector'])
    # only on surfaces facing forward (a front projection)
    sepn = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sepn.inputs[0])
    face_fwd = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(sepn.outputs['Y'], face_fwd.inputs['Value'])
    face_fwd.inputs['From Min'].default_value = -0.35; face_fwd.inputs['From Max'].default_value = -0.75
    sepc = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex.outputs['Color'], sepc.inputs[0])
    brow0 = nt.nodes.new('ShaderNodeMath'); brow0.operation = 'MULTIPLY'
    nt.links.new(sepc.outputs[0], brow0.inputs[0]); nt.links.new(face_fwd.outputs['Result'], brow0.inputs[1])
    # hairs: a fine noise stretched along the brow (x), 0.85..1.15 of the density
    hs = nt.nodes.new('ShaderNodeCombineXYZ')
    hx = nt.nodes.new('ShaderNodeMath'); hx.operation = 'MULTIPLY'; hx.inputs[1].default_value = 0.35
    nt.links.new(sep.outputs['X'], hx.inputs[0])
    nt.links.new(hx.outputs[0], hs.inputs[0]); nt.links.new(sep.outputs['Z'], hs.inputs[1])
    noise = nt.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 900.0
    noise.inputs['Detail'].default_value = 2.0
    nt.links.new(hs.outputs[0], noise.inputs['Vector'])
    hair = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(noise.outputs['Fac'], hair.inputs['Value'])
    hair.inputs['From Min'].default_value = 0.3; hair.inputs['From Max'].default_value = 0.7
    hair.inputs['To Min'].default_value = 0.85; hair.inputs['To Max'].default_value = 1.15
    brow = nt.nodes.new('ShaderNodeMath'); brow.operation = 'MULTIPLY'; brow.use_clamp = True
    nt.links.new(brow0.outputs[0], brow.inputs[0]); nt.links.new(hair.outputs['Result'], brow.inputs[1])
    liner_fwd = nt.nodes.new('ShaderNodeMapRange')   # (the lid margin turns down/in: a looser mask)
    nt.links.new(sepn.outputs['Y'], liner_fwd.inputs['Value'])
    liner_fwd.inputs['From Min'].default_value = 0.1; liner_fwd.inputs['From Max'].default_value = -0.35
    liner = nt.nodes.new('ShaderNodeMath'); liner.operation = 'MULTIPLY'
    nt.links.new(sepc.outputs[1], liner.inputs[0]); nt.links.new(liner_fwd.outputs['Result'], liner.inputs[1])
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = lip_attr
    sepl = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(attr.outputs['Color'], sepl.inputs[0])
    mix_c = nt.nodes.new('ShaderNodeMix'); mix_c.data_type = 'RGBA'   # the lip's own colour: edge → core
    mix_c.inputs['A'].default_value = (*LIPS_EDGE, 1); mix_c.inputs['B'].default_value = (*LIPS, 1)
    nt.links.new(sepl.outputs[1], mix_c.inputs['Factor'])
    mix_l = nt.nodes.new('ShaderNodeMix'); mix_l.data_type = 'RGBA'   # skin → lip at the border
    mix_l.inputs['A'].default_value = (*SKIN, 1)
    nt.links.new(mix_c.outputs['Result'], mix_l.inputs['B'])
    nt.links.new(sepl.outputs[0], mix_l.inputs['Factor'])
    mix_b = nt.nodes.new('ShaderNodeMix'); mix_b.data_type = 'RGBA'
    nt.links.new(mix_l.outputs['Result'], mix_b.inputs['A']); mix_b.inputs['B'].default_value = (*BROW, 1)
    nt.links.new(brow.outputs[0], mix_b.inputs['Factor'])
    mix_e = nt.nodes.new('ShaderNodeMix'); mix_e.data_type = 'RGBA'
    nt.links.new(mix_b.outputs['Result'], mix_e.inputs['A']); mix_e.inputs['B'].default_value = (*LASH, 1)
    nt.links.new(liner.outputs[0], mix_e.inputs['Factor'])
    nt.links.new(mix_e.outputs['Result'], bsdf.inputs['Base Color'])
    # lips: a little glossier
    rough = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(sepl.outputs[0], rough.inputs['Value'])
    rough.inputs['To Min'].default_value = 0.5; rough.inputs['To Max'].default_value = 0.34
    nt.links.new(rough.outputs['Result'], bsdf.inputs['Roughness'])
    return mat


def _lashes(p, arm):
    """Eyelashes as individual hairs rooted along our lid margins (the lash strips' roots, as the
    build places the head): thin tapered ribbons curving out and up (the lower ones out and down),
    longer toward the outer corner — MakeHuman's lash strips are flat cards meant for a hair
    texture, which read as grey sheets when shaded plainly."""
    from character import woman
    V = sculpt.grab(woman.rest_vertices(p), [q for q in p.get('sculpt', []) if q['name'].startswith('eye sockets')])
    H = woman.head_pose(arm)                      # (the lashes ride the head's pose)
    V = V @ H[:3, :3].T + H[:3, 3]
    fwd, up = -H[:3, 1], H[:3, 2]                 # the head's forward and up
    rng = np.random.default_rng(7)
    verts, faces = [], []
    for side in ('l', 'r'):
        c = face.eye_centre(V, side)                   # (the pupil's frame)
        # (upper, lower): count, length at the inner corner and the outer, the tip's curl (up +),
        # the base direction's forward / outward / up mix
        for lid, (n, L0, L1, curl, mix) in zip(face.lash_roots(V, side),
                                              ((140, 0.0022, 0.0075, 0.45, (0.82, 0.22, 0.02)),
                                               (36, 0.0010, 0.0026, -0.10, (0.62, 0.40, -0.25)))):
            P = V[lid]
            P = P[np.argsort(P[:, 0])]
            seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
            inner_first = abs(P[0, 0]) < abs(P[-1, 0])
            for k in range(n):
                t = (k + rng.uniform(0.1, 0.9)) / n                  # along the margin, inner → outer
                a = (t if inner_first else 1 - t) * seg[-1]
                m = np.array([np.interp(a, seg, P[:, j]) for j in range(3)])
                tang = np.array([np.interp(min(a + 1e-4, seg[-1]), seg, P[:, j]) - np.interp(max(a - 1e-4, 0), seg, P[:, j]) for j in range(3)])
                tang /= max(np.linalg.norm(tang), 1e-9)
                o = (m - c) - ((m - c) @ fwd) * fwd                     # out from the eye, in the face's plane
                o /= max(np.linalg.norm(o), 1e-9)
                m = m + 0.0009 * fwd + 0.0002 * o                      # (the lid margin's front edge)
                tt = t * t * (3 - 2 * t)
                L = (L0 + (L1 - L0) * tt) * rng.uniform(0.75, 1.1)
                d0 = mix[0] * fwd + mix[1] * o + mix[2] * up + rng.normal(0, 0.12) * tang   # (splayed a little)
                d0 /= np.linalg.norm(d0)
                bend = curl * rng.uniform(0.7, 1.2)
                base = len(verts)
                for i, sv in enumerate(np.linspace(0, 1, 6)):
                    q = m + L * (sv * d0 + sv * sv * bend * up + sv * sv * 0.1 * o)
                    w = 0.00008 * (1 - 0.8 * sv)
                    verts += [q - w * tang, q + w * tang]
                    if i:
                        b = base + 2 * i
                        faces.append((b - 2, b - 1, b + 1, b))
    me = bpy.data.meshes.new('lashes')
    me.from_pydata([tuple(v) for v in verts], [], faces)
    ob = bpy.data.objects.new('lashes', me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new('lash')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*LASH, 1)
    b.inputs['Roughness'].default_value = 0.55
    ob.data.materials.append(mat)
    return [ob]


def _iris(eye_mat):
    """The iris band (between the limbal ring and the pupil: character/woman.eye_material, or the
    painted eye's) in the concept's brown: IRIS from the limbus (0) to the pupil (1)."""
    from character import woman
    node = eye_mat.node_tree.nodes.get('IRIS_RAMP')
    if node is None:   # (the painted eye: the ramp by the angle, the iris band 0.85-0.975)
        ramp = [n for n in eye_mat.node_tree.nodes if n.type == 'VALTORGB'][0].color_ramp
        band, f_of = (0.85, 0.975), lambda pos: (pos - 0.85) / 0.125
    else:
        ramp = node.color_ramp
        band, f_of = (woman.PUPIL, woman.LIMBAL), lambda pos: (woman.LIMBAL - pos) / (woman.LIMBAL - woman.PUPIL)
    for e in ramp.elements:
        if band[0] <= e.position <= band[1]:
            e.color = (*(np.interp(f_of(e.position), [q[0] for q in IRIS], [q[1][k] for q in IRIS]) for k in range(3)), 1)


def apply(body, arm, p):
    V = np.array([v.co for v in body.data.vertices])
    mw = np.array(body.matrix_world)
    Vw = (np.c_[V, np.ones(len(V))] @ mw.T)[:, :3]
    from character import woman
    eye_l, eye_r = woman.eye_points(arm, p)   # (the pupils' frame, as the concept's)
    ipd = (eye_l - eye_r).length * 100
    m, liner = brow_mask(ipd)
    img = bpy.data.images.new('brow_mask', m.shape[1], m.shape[0], float_buffer=True)
    px = np.zeros((m.shape[0], m.shape[1], 4), np.float32)
    px[..., 0] = m
    px[..., 1] = liner
    px[..., 3] = 1
    img.pixels.foreach_set(px.ravel())
    # lips, as a vertex attribute (the body's rest mesh is the posed, sculpted shape)
    edge, core = lip_weights(np.r_[Vw, np.zeros((1, 3))])
    a = body.data.color_attributes.new('lips', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', np.c_[edge, core, np.zeros_like(edge), np.ones_like(edge)].astype(np.float32).ravel())
    mat = _projection_material('skin_look', img, eye_l.z, 'lips')
    body.data.materials.clear()
    body.data.materials.append(mat)
    _iris(bpy.data.materials['eye'])
    return _lashes(p, arm)
