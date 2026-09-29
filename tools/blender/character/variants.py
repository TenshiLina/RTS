"""Compare parameter variants of the base woman over a height band, beside the concept.

    $RTS_TOOLS/blender/bin/python tools/blender/character/variants.py SPEC.json OUT.png

SPEC: {"region": [z0, z1], "views": ["front", "side", "q34"], "k": 3,
       "variants": {"label": {"modifiers": {...}, "breast": {...}, "pose": {...}}, ...}}
Each variant's overrides are merged over woman.json. One row per view: concept | variants...
"""
import copy, json, os, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import bpy
from PIL import Image, ImageDraw
from lib import review
from character import woman

spec = json.load(open(sys.argv[-2]))
out = sys.argv[-1]
z0, z1 = spec['region']
views = spec.get('views', ['front', 'side', 'q34'])
k = spec.get('k', 3)
tmp = tempfile.mkdtemp()
cols = {}
for label, over in spec['variants'].items():
    p = woman.params()
    for sect, vals in over.items():
        p.setdefault(sect, {}).update(copy.deepcopy(vals))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, arm = woman.build(p)
    body.data.materials.append(review.studio())
    sub = body.modifiers.new('subsurf', 'SUBSURF')
    sub.levels = sub.render_levels = 1
    cols[label] = review.region(os.path.join(tmp, label.replace('/', '_')), z0, z1, views, k, offset=p.get('sheet_offset', (0, 0)))

sheet = Image.open(review.SHEET).convert('RGB')
labels = ['concept'] + list(cols)
rows = []
for vi, vname in enumerate(views):
    tiles = []
    box = cols[labels[1]][vi][2]
    ref = sheet.crop(box)
    tiles.append(ref.resize((ref.width * k, ref.height * k), Image.LANCZOS))
    for label in labels[1:]:
        tiles.append(Image.open(cols[label][vi][1]).convert('RGB'))
    rows.append(tiles)
tw, th = rows[0][0].width, rows[0][0].height
W = len(labels) * (tw + 4)
H = sum(r[0].height + 4 for r in rows) + 18
img = Image.new('RGB', (W, H), (30, 30, 30))
d = ImageDraw.Draw(img)
for i, l in enumerate(labels):
    d.text((i * (tw + 4) + 4, 3), l, fill=(255, 230, 150))
y = 18
for r in rows:
    for i, t in enumerate(r):
        img.paste(t, (i * (tw + 4), y))
    y += r[0].height + 4
img.save(out)
print('wrote', out)
