"""C&C-style sidebar mockup built from real cameo renders (tools/screenshot.ts with cameo=1).

    python3 tools/sidebar-mockup.py <cameoDir> <minimap.png> <out.png>

This is a *design mockup* for the build-frame UX; the in-game sidebar will be drawn by the
renderer (so it ports to native), using the same cameo renders as textures.
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

cameo_dir, minimap_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
CJK = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
f_title = ImageFont.truetype(SERIF, 20)
f_small = ImageFont.truetype(SANS, 13)
f_name = ImageFont.truetype(SERIF, 13)
f_num = ImageFont.truetype(SERIF, 22)
f_cjk = ImageFont.truetype(CJK, 22)
f_cjk_s = ImageFont.truetype(CJK, 15)
f_ready = ImageFont.truetype(SERIF, 18)

LACQUER = (34, 20, 16)
LACQUER2 = (58, 34, 26)
GOLD = (217, 173, 82)
GOLD_DIM = (141, 107, 47)
INK = (238, 226, 200)
VERMILION = (176, 48, 31)
JADE = (64, 190, 130)

W, H = 470, 1010
img = Image.new('RGB', (W, H), LACQUER)
d = ImageDraw.Draw(img)

# wood-grain lacquer panel
for y in range(H):
    t = 0.5 + 0.5 * math.sin(y * 0.09) * math.sin(y * 0.013 + 1.3)
    c = tuple(int(LACQUER[i] + (LACQUER2[i] - LACQUER[i]) * t * 0.35) for i in range(3))
    d.line([(0, y), (W, y)], fill=c)


def frame(box, width=3):
    x0, y0, x1, y1 = box
    d.rectangle(box, outline=(0, 0, 0), width=1)
    d.rectangle((x0 + 1, y0 + 1, x1 - 1, y1 - 1), outline=GOLD, width=width - 1)
    d.rectangle((x0 + width, y0 + width, x1 - width, y1 - width), outline=GOLD_DIM, width=1)


frame((0, 0, W - 1, H - 1), 5)

# --- header
d.text((22, 16), 'AZURE DYNASTY', font=f_title, fill=GOLD)
d.text((W - 72, 12), '苍朝', font=f_cjk, fill=INK)

# --- radar / minimap
mm = Image.open(minimap_path).convert('RGB')
side = min(mm.size)
mm = mm.crop(((mm.width - side) // 2, (mm.height - side) // 2, (mm.width + side) // 2, (mm.height + side) // 2)).resize((300, 300))
img.paste(mm, (22, 52))
frame((19, 49, 325, 355), 4)
# Qi bar (vertical, C&C power bar)
qx0, qy0, qx1, qy1 = 345, 52, 370, 352
d.rectangle((qx0, qy0, qx1, qy1), fill=(20, 12, 10))
seg = 22
load, supply = 150, 220
for i in range(seg):
    y1 = qy1 - 3 - i * ((qy1 - qy0 - 6) / seg)
    y0 = y1 - ((qy1 - qy0 - 6) / seg) + 3
    v = (i + 1) / seg * 300
    col = (90, 200, 255) if v <= supply else (40, 50, 60)
    if v <= load and v <= supply:
        col = (150, 230, 255)
    d.rectangle((qx0 + 4, y0, qx1 - 4, y1), fill=col)
ly = qy1 - (load / 300) * (qy1 - qy0)
d.polygon([(qx0 - 8, ly - 6), (qx0 - 1, ly), (qx0 - 8, ly + 6)], fill=GOLD)
frame((qx0 - 2, qy0 - 3, qx1 + 2, qy1 + 3), 3)
d.text((qx0 - 2, qy1 + 8), '气', font=f_cjk_s, fill=INK)
d.text((qx0 + 16, qy1 + 10), 'Qi', font=f_small, fill=GOLD)

# Mandate gauge (ring with tier pips)
cx, cy, r = 415, 118, 38
d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(20, 12, 10), width=10)
frac = 0.62
d.arc((cx - r, cy - r, cx + r, cy + r), start=-90, end=-90 + 360 * frac, fill=GOLD, width=10)
for i, t in enumerate([150 / 1200, 500 / 1200, 1.0]):
    a = math.radians(-90 + 360 * t)
    px, py = cx + math.cos(a) * (r + 10), cy + math.sin(a) * (r + 10)
    d.ellipse((px - 5, py - 5, px + 5, py + 5), fill=JADE if i == 0 else GOLD_DIM, outline=(0, 0, 0))
d.text((cx - 22, cy - 15), '天命', font=f_cjk, fill=INK)
d.text((cx - 32, cy + r + 18), 'Mandate', font=f_small, fill=GOLD)
d.text((cx - 22, cy + r + 34), '744', font=f_name, fill=INK)
d.text((cx - 38, cy + r + 50), 'Tier 2 ✓', font=f_small, fill=JADE)

# Jade counter
d.rectangle((22, 372, W - 22, 412), fill=(18, 11, 9))
frame((20, 370, W - 20, 414), 3)
d.text((34, 378), '灵玉', font=f_cjk, fill=JADE)
d.text((96, 380), '4,250', font=f_num, fill=INK)
d.text((W - 170, 386), '+312 / min', font=f_small, fill=(150, 200, 170))

# tabs
tabs = [('营', 'Structures'), ('防', 'Defence'), ('兵', 'Infantry'), ('机', 'Machines')]
tw = (W - 44) / 4
for i, (hz, name) in enumerate(tabs):
    x0 = 22 + i * tw
    on = i == 0
    d.rectangle((x0 + 2, 426, x0 + tw - 2, 470), fill=VERMILION if on else (60, 36, 28), outline=GOLD if on else GOLD_DIM)
    d.text((x0 + 10, 432), hz, font=f_cjk, fill=INK)
    d.text((x0 + 38, 440), name[:9], font=f_small, fill=INK if on else (190, 170, 140))
    if i == 2:
        d.ellipse((x0 + tw - 20, 422, x0 + tw - 4, 438), fill=GOLD)
        d.text((x0 + tw - 15, 423), '3', font=f_small, fill=(0, 0, 0))

# cameo grid (2 columns)
cells = [
    ('azure_qi_shrine', 'Qi Shrine', '风水坛', 600, 'ready'),
    ('azure_barracks', 'Garrison Camp', '兵营', 500, 0.62),
    ('azure_jade_refinery', 'Jade Refinery', '玉坊', 2000, None),
    ('azure_arrow_tower', 'Arrow Tower', '箭楼', 500, None),
    ('azure_wall', 'Rammed Wall', '城墙', 40, None),
    ('azure_workshop', 'Workshop', '工坊', 2000, 'locked'),
]
cw, ch = 205, 150
for i, (cid, name, hz, cost, state) in enumerate(cells):
    col, row = i % 2, i // 2
    x0, y0 = 22 + col * (cw + 16), 486 + row * (ch + 22)
    try:
        cam = Image.open(f'{cameo_dir}/{cid}.png').convert('RGB')
    except FileNotFoundError:
        cam = Image.new('RGB', (cw, ch), (40, 40, 40))
    sw, sh = cam.size
    scale = max(cw / sw, ch / sh)
    cam = cam.resize((int(sw * scale), int(sh * scale)))
    cam = cam.crop(((cam.width - cw) // 2, (cam.height - ch) // 2, (cam.width - cw) // 2 + cw, (cam.height - ch) // 2 + ch))
    if state == 'locked':
        cam = cam.convert('L').convert('RGB').point(lambda v: int(v * 0.45))
    img.paste(cam, (x0, y0))
    if isinstance(state, float):
        # radial clock-wipe (remaining portion darkened)
        ov = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        R = max(cw, ch)
        od.pieslice((cw / 2 - R, ch / 2 - R, cw / 2 + R, ch / 2 + R), start=-90 + 360 * state, end=270, fill=(0, 0, 0, 150))
        img.paste(ov, (x0, y0), ov)
        d.text((x0 + 8, y0 + 6), f'{int(state * 100)}%', font=f_name, fill=INK)
    if state == 'ready':
        d.rectangle((x0, y0 + ch // 2 - 16, x0 + cw, y0 + ch // 2 + 16), fill=(0, 0, 0))
        d.text((x0 + cw // 2 - 34, y0 + ch // 2 - 12), 'READY', font=f_ready, fill=GOLD)
    if state == 'locked':
        d.text((x0 + 12, y0 + ch // 2 - 20), 'Requires', font=f_small, fill=INK)
        d.text((x0 + 12, y0 + ch // 2), 'Jade Refinery', font=f_name, fill=GOLD)
    frame((x0 - 3, y0 - 3, x0 + cw + 3, y0 + ch + 3), 3)
    # caption strip
    d.rectangle((x0, y0 + ch - 24, x0 + cw, y0 + ch), fill=(0, 0, 0))
    d.text((x0 + 6, y0 + ch - 20), name, font=f_name, fill=INK)
    d.text((x0 + cw - 52, y0 + ch - 20), f'{cost}', font=f_name, fill=JADE)
    d.text((x0 + cw - 28, y0 + 4), hz[:1], font=f_cjk_s, fill=GOLD)

img.save(out_path)
print('wrote', out_path)
