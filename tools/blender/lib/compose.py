"""Compose review sheets (PIL/numpy): reference | clay | outlines per view, with silhouette IoU."""
import json, os
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SHEET = os.path.join(ROOT, 'docs/art/factions/human/human-female-turnaround.webp')
GAP = [372, 376, 380, 548, 552, 556]


def _sheet():
    im = Image.open(SHEET).convert('RGB')
    a = np.asarray(im).astype(float)
    bg = np.median(a[:, GAP, :], axis=1)
    d = np.sqrt(((a - bg[:, None, :]) ** 2).sum(2))
    ch = a.max(2) - a.min(2)
    bgc = bg.max(1) - bg.min(1)
    return im, (d > 14) | (np.abs(ch - bgc[:, None]) > 6)


def _edge(m):
    e = np.zeros_like(m)
    e[1:-1, 1:-1] = m[1:-1, 1:-1] & ~(m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:])
    return e


def sheet(parts, out, head_row=None):
    """head_row: ignore rows above this sheet row in the IoU (the sheet's head is hair)."""
    meta = json.load(open(f'{parts}/meta.json'))
    im, refm = _sheet()
    cols, scores = [], []
    for m in meta:
        w, x0 = m['w'], m['x0']
        clay = np.asarray(Image.open(f'{parts}/{m["name"]}_clay.png').convert('RGB'))
        mk = np.asarray(Image.open(f'{parts}/{m["name"]}_mask.png').convert('RGBA'))[:, :, 3] > 127
        ref = np.zeros((1000, w, 3), np.uint8)
        ref[: im.height] = np.asarray(im)[:1000, x0 : x0 + w]
        rm = np.zeros((1000, w), bool)
        rm[: im.height] = refm[:1000, x0 : x0 + w]
        rm[m['sole'] + 2 :] = False
        a, b = rm.copy(), mk.copy()
        if head_row is not None:
            a[:head_row], b[:head_row] = False, False
        scores.append((m['name'], (a & b).sum() / max(1, (a | b).sum())))
        ov = (ref * 0.55 + 55).astype(np.uint8)
        ov[_edge(rm)] = [0, 230, 255]
        ov[_edge(mk)] = [255, 40, 40]
        cols += [ref, clay, ov, np.full((1000, 6, 3), 30, np.uint8)]
    row = np.concatenate(cols, 1)
    canvas = np.full((1030, row.shape[1], 3), 30, np.uint8)
    canvas[30:] = row
    img = Image.fromarray(canvas)
    d = ImageDraw.Draw(img)
    x = 0
    for (n, s), m in zip(scores, meta):
        d.text((x + 4, 8), f'{n}: concept | ours | outlines (cyan concept, red ours)  IoU {s:.3f}', fill=(255, 230, 150))
        x += m['w'] * 3 + 6
    img.save(out)
    return scores


def faces(parts, out):
    """Per close-up: concept | ours | the concept with our silhouette (red)."""
    meta = json.load(open(f'{parts}/faces.json'))
    im = Image.open(SHEET).convert('RGB')
    tiles = []
    for m in meta:
        ref = im.crop(tuple(m['box'])).resize((m['w'], m['h']), Image.LANCZOS)
        ours = Image.open(f'{parts}/{m["name"]}.png').convert('RGB')
        tiles += [ref, ours]
        mp = f'{parts}/{m["name"]}_mask.png'
        if os.path.exists(mp):
            mk = np.asarray(Image.open(mp).convert('RGBA'))[:, :, 3] > 127
            e = _edge(mk)
            e = e | np.roll(e, 1, 0) | np.roll(e, 1, 1)
            ov = (np.asarray(ref).astype(float) * 0.75 + 30).astype(np.uint8)
            ov[e] = [255, 40, 40]
            tiles.append(Image.fromarray(ov))
    Hh = max(t.height for t in tiles)
    out_im = Image.new('RGB', (sum(t.width for t in tiles) + 6 * len(tiles), Hh), (30, 30, 30))
    x = 0
    for t in tiles:
        out_im.paste(t, (x, 0))
        x += t.width + 6
    out_im.save(out)
