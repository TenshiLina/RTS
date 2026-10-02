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
CONJUNCTIVA = (0.36, 0.19, 0.16, 1.0)   # the caruncle's and the lids' inner rims' pink (the inner corner: the
# concept's ~0.8 of the skin's value, a little redder; a paler one read as a white glint)
CARUNCLE = (0.44, 0.29, 0.25, 1.0)      # the caruncle's, lighter: the medial 2.5 mm of the opening (in the
# corner's slit the conjunctiva's read as a dark-red dot, where the concept's is a pink wedge)
RECESS = (0.20, 0.18, 0.17, 1.0)        # the outer corner's recess beyond the eyeball: dark and neutral, as the
# concept's — a real one sits in shadow; pink there, light bouncing in the narrow cavity reddened it to raw red
RECESS_SKIN = (0.24, 0.13, 0.10, 1.0)   # the skin's own toward it: shadowed skin (the neutral grey on the lit
# faces at the corner's apex read as a blue-grey smudge)
IRIS = [(0.0, (0.016, 0.010, 0.006)), (0.35, (0.046, 0.023, 0.010)), (0.8, (0.095, 0.046, 0.020)), (1.0, (0.05, 0.03, 0.02))]   # (its outer
# third dark, as the concept's ~0.35 of the skin: a lighter iris read small beside the white)
# the sclera, as the concept's: a warm, shaded off-white (its white reads pinkish grey beside the skin,
# ~0.65 of the cheek's brightness), darker toward the sides: (position from the side, colour)
SCLERA = [(0.0, (0.37, 0.32, 0.30)), (0.7, (0.48, 0.42, 0.39)), (1.0, (0.51, 0.45, 0.42))]   # (lit, about the
# skin's brightness beside it, as the concept's: a greyer sclera read as a small eyeball in a shaded socket,
# a whiter one as pasted on) — and shaded under the lids by occlusion (SCLERA_AO, _sclera)
SCLERA_AO = (0.003, 0.5)   # (the occlusion's reach, m, and its strength: the lid's shadow on the eyeball)
LID_SHADOW = (0.002, 0.4)   # the upper lid's contact shadow on the eyeball: (reach below the lid's edge, m;
# the value at the edge) — the concept's white is darkest in the ~2 px under the lid (0.15-0.4, then 0.4-0.7 of its
# middle; at 1 mm only the first row darkened)
MEDIAL = 1.8    # the white's lift at the inner corner (its albedo times this: the concept's medial white is ~0.95 of
# the skin's value, ours was ~0.66 in the corner's shade)

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
# eyeliner: the concept's dark upper lash band, measured (sheet px, both eyes): from the lid margin
# (lib/face.REF_EYE_UPPER: the band's lower edge) up by LINER_TH px — 3 over the outer third, ~2.9 over
# the iris, thinning to ~1.2 at the inner corner — and past the outer corner a short, nearly level wing,
# its lower edge from REF_CORNER_ROW at the corner to its tip (LINER_WING)
LINER_WING = (1252.3, 283.6)
LINER_TH = [(1256.5, 3.2), (1260, 3.2), (1262, 3.0), (1264, 2.5), (1268, 2.8), (1272, 2.9), (1276, 2.5),
            (1280, 2.4), (1284, 1.9), (1288.5, 1.2)]
# and a soft lower lash line just under the lower lid's margin, from the outer corner to the iris'
# centre (~45 % darker than the skin there), gone by 1277: the inner third has a bright rim instead
LOWER_LINE = 0.35   # its strength (of the liner's)
LOWER_LINE_X = (1256.5, 1272.0, 1277.0)
# and the shadow in the upper lid's crease (the concept's crease line reads ~0.7 of the skin's value, a
# little more saturated — shadow and eyeshadow; the geometry's crease is shallower by design): a soft line
# along lib/face.REF_EYE_CREASE and a fainter band over it
CREASE_SHADE = (1.05, 1.3, 0.25, 2.5)   # (the line's strength, its half-width px; the band's strength, height px)
CREASE_COLOUR = (0.22, 0.10, 0.07)
# the concept's eye makeup (the liner and the lower lash line) is off unless RTS_MAKEUP=1: reviews of the
# lids' shape judge the geometry, not paint (the textured look will carry its own makeup)
MAKEUP = os.environ.get('RTS_MAKEUP') == '1'


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
    # liner (LINER_TH, LINER_WING): from the lid margin up, into the wing; at the outer corner the band
    # stays at the wing's row where the margin itself turns down into the canthus
    from scipy.interpolate import CubicSpline
    ux = [q[0] for q in face.REF_EYE_UPPER]
    lash = CubicSpline(ux, [q[1] for q in face.REF_EYE_UPPER])(np.clip(px, ux[0], ux[-1]))   # (the trace, smooth)
    wing_t = np.clip((ux[0] - px) / (ux[0] - LINER_WING[0]), 0, 1)       # 0 at the corner, 1 at the wing's end
    lash = np.where(px < ux[0] + 4, np.minimum(lash, REF_CORNER_ROW), lash)
    lash = np.where(px < ux[0], REF_CORNER_ROW + (LINER_WING[1] - REF_CORNER_ROW) * wing_t, lash)
    th0 = LINER_TH[0][1]
    th = np.where(px < ux[0], th0 * (1 - wing_t) + 0.2, np.interp(px, *zip(*LINER_TH)))
    # (over the margin's rim by 0.5 px — no pale rim between band and eyeball; its top feathered:
    # lashes, not paint)
    liner = np.clip((lash - row + 0.5) / 0.6, 0, 1) * np.clip((row - (lash - th)) / 1.0 + 0.4, 0, 1)
    liner *= np.clip((px - LINER_WING[0]) / 1.0, 0, 1) * np.clip((ux[-1] - px) / 2.0, 0, 1)
    # and the soft lower lash line (LOWER_LINE): from 0.5 to 1.8 px under the lower lid's margin
    lx = [q[0] for q in face.REF_EYE_LOWER]
    low = np.interp(px, lx, [q[1] for q in face.REF_EYE_LOWER])
    band = np.clip((row - (low + 0.5)) / 0.5 + 0.5, 0, 1) * np.clip(((low + 1.8) - row) / 0.6 + 0.5, 0, 1)
    x0, x1, x2 = LOWER_LINE_X
    band *= np.clip((px - x0) / 1.5, 0, 1) * np.clip((x2 - px) / (x2 - x1), 0, 1)
    liner = np.maximum(liner, LOWER_LINE * band)
    if not MAKEUP:
        liner = np.zeros_like(liner)
    return brow, liner


def crease_mask(ipd_cm):
    """The crease's shadow (CREASE_SHADE: make-up, 0..1) on GRID, symmetric; none unless RTS_MAKEUP=1."""
    s, zp, cx = face._front_scale(ipd_cm)
    xs = np.arange(GRID['x0'], GRID['x1'], GRID['res'])
    zs = np.arange(GRID['z0'], GRID['z1'], GRID['res'])
    XX, ZZ = np.meshgrid(xs, zs)
    px, row = cx - np.abs(XX) / s, zp - ZZ / s
    if not MAKEUP:
        return np.zeros_like(px)
    T, W = np.array(face.REF_EYE_CREASE), np.array(face.REF_EYE_CREASE_WEIGHT)
    c = np.interp(px, T[:, 0], T[:, 1])
    w = np.interp(px, W[:, 0], W[:, 1], left=0.0, right=0.0)
    a, hw, b, bh = CREASE_SHADE
    line = a * np.exp(-((row - c) / hw) ** 2)
    band = b * np.clip((c - row) / 0.8, 0, 1) * np.clip(1 - (c - row) / bh, 0, 1)
    return np.maximum(line, band) * w


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


def _ring_dist(P, ring):
    """Distance of the 2D points P from the closed polyline ring."""
    A, B = ring, np.roll(ring, -1, axis=0)
    AB = B - A
    t = np.clip((((P[:, None] - A[None]) * AB[None]).sum(-1)) / np.maximum((AB ** 2).sum(-1), 1e-12)[None], 0, 1)
    return np.linalg.norm(P[:, None] - (A[None] + t[..., None] * AB[None]), axis=-1).min(1)


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
    # (the upper lid's margin turns down: a looser mask, facing forward or down — not sideways, where a
    # front projection stretches)
    down = nt.nodes.new('ShaderNodeMath'); down.operation = 'MULTIPLY'; down.inputs[1].default_value = -0.8
    nt.links.new(sepn.outputs['Z'], down.inputs[0])
    down_c = nt.nodes.new('ShaderNodeMath'); down_c.operation = 'MAXIMUM'; down_c.inputs[1].default_value = 0.0
    nt.links.new(down.outputs[0], down_c.inputs[0])
    fwd = nt.nodes.new('ShaderNodeMath'); fwd.operation = 'MULTIPLY'; fwd.inputs[1].default_value = -1.0
    nt.links.new(sepn.outputs['Y'], fwd.inputs[0])
    facing = nt.nodes.new('ShaderNodeMath'); facing.operation = 'ADD'
    nt.links.new(fwd.outputs[0], facing.inputs[0]); nt.links.new(down_c.outputs[0], facing.inputs[1])
    liner_fwd = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(facing.outputs[0], liner_fwd.inputs['Value'])
    liner_fwd.inputs['From Min'].default_value = -0.1; liner_fwd.inputs['From Max'].default_value = 0.35
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
    crs = nt.nodes.new('ShaderNodeMath'); crs.operation = 'MULTIPLY'   # (the crease's shadow: make-up)
    nt.links.new(sepc.outputs[2], crs.inputs[0]); nt.links.new(face_fwd.outputs['Result'], crs.inputs[1])
    mix_s = nt.nodes.new('ShaderNodeMix'); mix_s.data_type = 'RGBA'
    nt.links.new(mix_b.outputs['Result'], mix_s.inputs['A']); mix_s.inputs['B'].default_value = (*CREASE_COLOUR, 1)
    nt.links.new(crs.outputs[0], mix_s.inputs['Factor'])
    mix_e = nt.nodes.new('ShaderNodeMix'); mix_e.data_type = 'RGBA'
    nt.links.new(mix_s.outputs['Result'], mix_e.inputs['A']); mix_e.inputs['B'].default_value = (*LASH, 1)
    nt.links.new(liner.outputs[0], mix_e.inputs['Factor'])
    # the outer corners' recess (character/look._conjunctiva's weight): dark, and no scattering
    rc = nt.nodes.new('ShaderNodeAttribute'); rc.attribute_name = 'recess'
    mix_r = nt.nodes.new('ShaderNodeMix'); mix_r.data_type = 'RGBA'
    nt.links.new(mix_e.outputs['Result'], mix_r.inputs['A']); mix_r.inputs['B'].default_value = RECESS_SKIN
    nt.links.new(rc.outputs['Fac'], mix_r.inputs['Factor'])
    nt.links.new(mix_r.outputs['Result'], bsdf.inputs['Base Color'])
    sss = nt.nodes.new('ShaderNodeMapRange'); sss.clamp = True
    nt.links.new(rc.outputs['Fac'], sss.inputs['Value'])
    sss.inputs['To Min'].default_value = 0.15; sss.inputs['To Max'].default_value = 0.0
    nt.links.new(sss.outputs['Result'], bsdf.inputs['Subsurface Weight'])
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
        # the base direction's forward / outward / up mix, the sideways splay, the span of the margin
        # (inner, outer fraction), the outer end's taper (the lower lashes: a dense, short line, longest
        # across the outer third and tapering into the corner — sparse long ones there read as whiskers)
        for li, (lid, (n, L0, L1, curl, mix, splay, span, taper)) in enumerate(zip(face.lash_roots(V, side),
                                              ((140, 0.0022, 0.0075, 0.45, (0.82, 0.22, 0.02), 0.12, (0.0, 1.0), 0.0),
                                               (60, 0.0005, 0.0014, -0.10, (0.74, 0.20, -0.25), 0.06, (0.03, 0.94), 0.6)))):
            # (the lower lashes their own random stream; the upper ones' draws as before the lower line
            # was redone — 28 lashes' worth skipped — so the upper lashes stay as they were)
            r_ = rng if li == 0 else np.random.default_rng(100 + (side == 'r'))
            P = V[lid]
            P = P[np.argsort(P[:, 0])]
            seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
            inner_first = abs(P[0, 0]) < abs(P[-1, 0])
            for k in range(n):
                t = span[0] + (span[1] - span[0]) * (k + r_.uniform(0.1, 0.9)) / n   # along the margin, inner → outer
                a = (t if inner_first else 1 - t) * seg[-1]
                m = np.array([np.interp(a, seg, P[:, j]) for j in range(3)])
                tang = np.array([np.interp(min(a + 1e-4, seg[-1]), seg, P[:, j]) - np.interp(max(a - 1e-4, 0), seg, P[:, j]) for j in range(3)])
                tang /= max(np.linalg.norm(tang), 1e-9)
                o = (m - c) - ((m - c) @ fwd) * fwd                     # out from the eye, in the face's plane
                o /= max(np.linalg.norm(o), 1e-9)
                m = m + 0.0009 * fwd + 0.0002 * o                      # (the lid margin's front edge)
                tt = t * t * (3 - 2 * t)
                te = np.clip((t - 0.8) / 0.2, 0, 1)
                L = (L0 + (L1 - L0) * tt) * (1 - taper * te * te * (3 - 2 * te)) * r_.uniform(0.75, 1.1)
                d0 = mix[0] * fwd + mix[1] * o + mix[2] * up + r_.normal(0, splay) * tang   # (splayed a little)
                d0 /= np.linalg.norm(d0)
                bend = curl * r_.uniform(0.7, 1.2)
                base = len(verts)
                for i, sv in enumerate(np.linspace(0, 1, 6)):
                    q = m + L * (sv * d0 + sv * sv * bend * up + sv * sv * 0.1 * o)
                    w = 0.00008 * (1 - 0.8 * sv)
                    verts += [q - w * tang, q + w * tang]
                    if i:
                        b = base + 2 * i
                        faces.append((b - 2, b - 1, b + 1, b))
            if li == 1:
                for _ in range(28):
                    rng.uniform(); rng.uniform(); rng.normal(); rng.uniform()
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


def _conjunctiva(body, Vw, p, arm):
    """The tissue inside the lid margins — the caruncle at the inner corner, the lids' inner rims, the
    socket around the globe — moist and pink, not skin (shaded skin there reads as raw red flesh):
    the faces inside the opening in the front view (lib/face.aperture_ring: the lash strips' roots,
    closed through the corners) and behind the margins."""
    from character import woman
    mat = bpy.data.materials.get('conjunctiva') or bpy.data.materials.new('conjunctiva')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = CONJUNCTIVA
    b.inputs['Roughness'].default_value = 0.45   # (glossier, it glinted white at the inner corner)
    b.inputs['Subsurface Weight'].default_value = 0.0   # (scattering glowed red in the thin, shadowed corners)
    b.inputs['Subsurface Radius'].default_value = (0.004, 0.0015, 0.001)
    body.data.materials.append(mat)
    V = woman.rest_vertices(p)
    H = woman.head_pose(arm)
    # toward the outer corners (beyond 0.75-0.95 of the eyeball's radius out from its centre) the recess:
    # RECESS, blended in by position (a material of its own showed its faces' steps)
    g = mh.load_base()['groups']
    E = V[sorted(g['helper-l-eye'])] @ H[:3, :3].T + H[:3, 3]
    cx, r = abs(E.mean(0)[0]), np.linalg.norm(E - E.mean(0), axis=1).mean()
    nt = mat.node_tree
    if not nt.nodes.get('RECESS_MIX'):
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        sx = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(geo.outputs['Position'], sx.inputs[0])
        ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; nt.links.new(sx.outputs['X'], ab.inputs[0])
        fr = nt.nodes.new('ShaderNodeMapRange'); fr.clamp = True; nt.links.new(ab.outputs[0], fr.inputs['Value'])
        fr.inputs['From Min'].default_value, fr.inputs['From Max'].default_value = cx + 0.75 * r, cx + 0.95 * r
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.name = 'RECESS_MIX'
        nt.links.new(fr.outputs['Result'], mx.inputs['Factor'])
        mx.inputs[6].default_value, mx.inputs[7].default_value = CONJUNCTIVA, RECESS
        # toward the inner corners (within 0.80-0.92 of the eyeball's radius in from its centre: the
        # opening's medial 2.5 mm) the caruncle
        fc = nt.nodes.new('ShaderNodeMapRange'); fc.clamp = True; nt.links.new(ab.outputs[0], fc.inputs['Value'])
        fc.inputs['From Min'].default_value, fc.inputs['From Max'].default_value = cx - 0.92 * r, cx - 0.80 * r
        fc.inputs['To Min'].default_value, fc.inputs['To Max'].default_value = 1.0, 0.0
        mc = nt.nodes.new('ShaderNodeMix'); mc.data_type = 'RGBA'; mc.name = 'CARUNCLE_MIX'
        nt.links.new(fc.outputs['Result'], mc.inputs['Factor'])
        nt.links.new(mx.outputs[2], mc.inputs[6]); mc.inputs[7].default_value = CARUNCLE
        nt.links.new(mc.outputs[2], b.inputs['Base Color'])
    near = np.zeros(len(Vw), bool)
    for side in ('l', 'r'):
        up, lo = face.lash_roots(V, side)
        U, L = (V[q] @ H[:3, :3].T + H[:3, 3] for q in (up, lo))
        ring = face.aperture_ring(V @ H[:3, :3].T + H[:3, 3], side)
        inside = _inside(Vw[:, [0, 2]], ring)
        behind = Vw[:, 1] > min(U[:, 1].min(), L[:, 1].min()) - 0.0005
        near |= inside & behind
    idx = np.array([f.index for f in body.data.polygons if all(near[v] for v in f.vertices)], int)
    mi = np.zeros(len(body.data.polygons), int)
    mi[idx] = 1
    body.data.polygons.foreach_set('material_index', mi)
    # the skin around the outer corners' recess, as a weight per vertex for skin's material (smooth
    # across the faces — a face selection showed its steps): behind the local lid margin (0.5 to 2 mm
    # deeper than the nearest margin vertex in the front view), beyond the eyeball's side, inside the
    # opening (fading out over 0.3 mm: the lid skin beyond the corner wraps back as deep, and dark there
    # read as grey smudges); skin there scattered light into a red glow, where a real recess sits in shadow
    Va = V @ H[:3, :3].T + H[:3, 3]
    w = np.zeros(len(Vw))
    for side in ('l', 'r'):
        up, lo = face.lash_roots(V, side)
        M = Va[np.r_[up, lo, list(face.canthi(side))]]
        e = Va[sorted(g[f'helper-{side}-eye'])].mean(0)
        cand = np.flatnonzero(np.hypot(Vw[:, 0] - e[0], Vw[:, 2] - e[2]) < 2 * r)
        d2 = ((Vw[cand][:, None, [0, 2]] - M[None, :, [0, 2]]) ** 2).sum(-1)
        k = d2.argmin(1)
        depth = Vw[cand, 1] - M[k, 1]
        lat = (Vw[cand, 0] - e[0]) * np.sign(e[0]) / r
        ins = _inside(Vw[cand][:, [0, 2]], face.aperture_ring(Va, side))
        prox = np.where(ins, 1.0, np.clip(1 - _ring_dist(Vw[cand][:, [0, 2]], face.aperture_ring(Va, side)) / 0.0003, 0, 1))
        w[cand] = np.maximum(w[cand], np.clip((depth - 0.0005) / 0.0015, 0, 1) * np.clip((lat - 0.6) / 0.25, 0, 1) * prox)
    a = body.data.attributes.get('recess') or body.data.attributes.new('recess', 'FLOAT', 'POINT')
    a.data.foreach_set('value', w.astype(np.float32))


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
    px[..., 2] = crease_mask(ipd)
    px[..., 3] = 1
    img.pixels.foreach_set(px.ravel())
    # lips, as a vertex attribute (the body's rest mesh is the posed, sculpted shape)
    edge, core = lip_weights(np.r_[Vw, np.zeros((1, 3))])
    a = body.data.color_attributes.new('lips', 'FLOAT_COLOR', 'POINT')
    a.data.foreach_set('color', np.c_[edge, core, np.zeros_like(edge), np.ones_like(edge)].astype(np.float32).ravel())
    mat = _projection_material('skin_look', img, eye_l.z, 'lips')
    body.data.materials.clear()
    body.data.materials.append(mat)
    if bpy.data.objects.get('cornea.l'):   # (the eye system's eyes: see character/woman.add_eyes)
        _conjunctiva(body, Vw, p, arm)
    _iris(bpy.data.materials['eye'])
    _sclera(bpy.data.materials['eye'], p)
    return _lashes(p, arm)


def _sclera(eye_mat, p=None):
    """The sclera's ramp (character/woman.eye_material: by the angle from the axis) in SCLERA, and the
    eyeball's colour darkened by ambient occlusion within SCLERA_AO's reach: the lids' shadow on it
    (lit evenly, the white under the upper lid was its brightest — the concept's is in shadow); and,
    with the eye system's eyes, the upper lid's contact shadow (LID_SHADOW) under its rendered edge."""
    nt = eye_mat.node_tree
    ramps = [n for n in nt.nodes if n.type == 'VALTORGB' and n.name != 'IRIS_RAMP']
    if len(ramps) != 1 or len(ramps[0].color_ramp.elements) != len(SCLERA):
        return
    for e, (pos, col) in zip(sorted(ramps[0].color_ramp.elements, key=lambda e: e.position), SCLERA):
        e.position, e.color = pos, (*col, 1)
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    link = bsdf.inputs['Base Color'].links[0] if bsdf.inputs['Base Color'].links else None
    if link is None or nt.nodes.get('SCLERA_AO'):
        return
    # the upper band of the eyeball (its local z over its radius, from 0 to 0.3): the lid shades it — the
    # occlusion counted there only (in the inner corner's pocket it darkened the white the concept keeps
    # bright), and its gloss cut (the rig's broad lights lit the white under the lid brightest)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nrm = nt.nodes.new('ShaderNodeVectorMath'); nrm.operation = 'NORMALIZE'
    nt.links.new(tc.outputs['Object'], nrm.inputs[0])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(nrm.outputs['Vector'], sep.inputs[0])
    top = nt.nodes.new('ShaderNodeMapRange'); top.clamp = True
    nt.links.new(sep.outputs['Z'], top.inputs['Value'])
    top.inputs['From Min'].default_value, top.inputs['From Max'].default_value = 0.0, 0.3
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.name = 'SCLERA_AO'
    ao.inputs['Distance'].default_value = SCLERA_AO[0]

    def mathn(op, a, b):
        m = nt.nodes.new('ShaderNodeMath'); m.operation = op
        for k, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                m.inputs[k].default_value = v
            else:
                nt.links.new(v, m.inputs[k])
        return m.outputs[0]
    occ = mathn('MULTIPLY', mathn('SUBTRACT', 1.0, ao.outputs['AO']), top.outputs['Result'])
    shade = mathn('SUBTRACT', 1.0, mathn('MULTIPLY', occ, SCLERA_AO[1]))
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(link.from_socket, mul.inputs[6])
    nt.links.new(shade, mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
    sl = bsdf.inputs['Specular IOR Level'].links
    if sl:
        nt.links.new(mathn('MULTIPLY', sl[0].from_socket, mathn('SUBTRACT', 1.0, mathn('MULTIPLY', top.outputs['Result'], 0.7))),
                     bsdf.inputs['Specular IOR Level'])
    lid = _lid_edge(p) if p is not None and bpy.data.objects.get('cornea.l') else None
    if lid is None:
        return
    # the upper lid's contact shadow: by the height under the lid's rendered edge (lib/face.opening, in
    # the eyeball's own frame: a curve of the lateral offset — the eyes mirrored by their side), darkest
    # at the edge, gone LID_SHADOW[0] below it; on the iris too, and the gloss with it
    u_s, z_s, r = lid
    sx = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Object'], sx.inputs[0])
    ol = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(nt.nodes.new('ShaderNodeObjectInfo').outputs['Location'], ol.inputs[0])
    sgn = mathn('SIGN', ol.outputs['X'], 0.0)
    t = mathn('MULTIPLY_ADD', mathn('MULTIPLY', sx.outputs['X'], sgn), 0.5 / r)
    t.node.inputs[2].default_value = 0.5
    fc = nt.nodes.new('ShaderNodeFloatCurve'); fc.name = 'LID_EDGE'
    nt.links.new(t, fc.inputs['Value'])
    cv = fc.mapping.curves[0]
    pts = list(zip((u_s / r + 1) / 2, (z_s / r + 1) / 2))
    while len(cv.points) < len(pts):
        cv.points.new(0.0, 0.0)
    for q, (a, b) in zip(cv.points, pts):
        q.location = (float(a), float(b)); q.handle_type = 'VECTOR'
    fc.mapping.clip_min_y, fc.mapping.clip_max_y = -1.0, 2.0
    fc.mapping.update()
    zm = mathn('MULTIPLY_ADD', fc.outputs['Value'], 2 * r)
    zm.node.inputs[2].default_value = -r
    d = mathn('SUBTRACT', zm, sx.outputs['Z'])                     # (m below the lid's edge)
    band = nt.nodes.new('ShaderNodeMapRange'); band.interpolation_type = 'SMOOTHSTEP'; band.clamp = True
    nt.links.new(d, band.inputs['Value'])
    band.inputs['From Min'].default_value, band.inputs['From Max'].default_value = 0.0, LID_SHADOW[0]
    band.inputs['To Min'].default_value, band.inputs['To Max'].default_value = LID_SHADOW[1], 1.0
    # and the white toward the inner corner lifted (MEDIAL: from 0.5 to 0.8 of the radius in, beyond the iris):
    # the corner's pocket shades it, where the concept's white stays bright to the caruncle (the white
    # ending short of the corner read as an eyeball too small for its socket)
    med = nt.nodes.new('ShaderNodeMapRange'); med.clamp = True
    nt.links.new(mathn('MULTIPLY', mathn('MULTIPLY', sx.outputs['X'], sgn), -1.0 / r), med.inputs['Value'])
    med.inputs['From Min'].default_value, med.inputs['From Max'].default_value = 0.5, 0.8
    med.inputs['To Min'].default_value, med.inputs['To Max'].default_value = 1.0, MEDIAL
    lift = mathn('MULTIPLY', band.outputs['Result'], med.outputs['Result'])
    mul2 = nt.nodes.new('ShaderNodeMix'); mul2.data_type = 'RGBA'; mul2.blend_type = 'MULTIPLY'
    mul2.inputs['Factor'].default_value = 1.0
    nt.links.new(mul.outputs[2], mul2.inputs[6]); nt.links.new(lift, mul2.inputs[7])
    nt.links.new(mul2.outputs[2], bsdf.inputs['Base Color'])
    sl = bsdf.inputs['Specular IOR Level'].links
    if sl:
        nt.links.new(mathn('MULTIPLY', sl[0].from_socket, band.outputs['Result']), bsdf.inputs['Specular IOR Level'])


def _lid_edge(p):
    """The upper lid's rendered edge over the left eyeball (lib/face.opening), in the eyeball's frame
    (character/woman.add_eyes: the helper's mean, set back by eye_depth; looking straight ahead, or down):
    (lateral offsets, heights, the eyeball's radius) in m, across the eyeball's width — the ends held
    level beyond the corners. None where the face isn't symmetric or the eyes not straight ahead."""
    from character import woman
    fm = p.get('face_model') or {}
    gz = fm.get('gaze') or {}
    if not fm.get('symmetric') or not gz.get('straight') or gz.get('out'):
        return None
    V = woman.rest_vertices(p)
    g = mh.load_base()['groups']
    E = V[sorted(g['helper-l-eye'])]
    c = E.mean(0) + np.array([0.0, p.get('eye_depth', 0.0), 0.0])
    r = float(np.linalg.norm(E - c, axis=1).mean())
    u = np.linspace(-0.98 * r, 0.98 * r, 41)
    top, _ = face.opening(V, (c[0] + u) * 100, 'l', eye_depth=p.get('eye_depth', 0.0))
    z = face.eye_centre(V, 'l')[2] + np.asarray(top, float) / 100 - c[2]
    ok = np.isfinite(z)
    if ok.sum() < 4:
        return None
    z = np.interp(u, u[ok], z[ok])
    a = np.radians(gz.get('down', 0.0))
    if a:   # (an eye looking down: its frame turned about x — the edge's points on its front, in that frame)
        y = -np.sqrt(np.maximum(r * r - u * u - z * z, 0))
        z = z * np.cos(a) - y * np.sin(a)
    return u, z, r
