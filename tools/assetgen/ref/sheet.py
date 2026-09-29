"""Measure a character turnaround sheet: segment each view's silhouette from the flat grey
background and write, for every pixel row, the runs of figure pixels — in metres, in the
figure's own frame (feet at y = 0, x across the view from the figure's centre line).

    python3 tools/assetgen/ref/sheet.py docs/art/factions/human/human-female-turnaround.webp \
        tools/assetgen/ref/human-female.json

Calibration (pixel rows of the soles and of the top of the skull under the hair, the figure's
height) is set per sheet below; the figure builder fits its lofts to these runs.
"""
import json, sys
import numpy as np
from PIL import Image

SHEETS = {
    'human-female-turnaround.webp': {
        'height': 1.68,          # metres, soles to top of skull
        'skull_top': 52,         # pixel row (front view), under the hair
        'soles': {'front': 979, 'side': 977, 'back': 977, 'q34': 980},
        'views': {'front': (0, 368), 'side': (383, 541), 'back': (558, 900), 'q34': (900, 1190)},
        'gap_cols': [372, 376, 380, 548, 552, 556],
    },
}


def segment(im, gap_cols):
    bg = np.median(im[:, gap_cols, :], axis=1)
    d = np.sqrt(((im - bg[:, None, :]) ** 2).sum(2))
    chroma = im.max(2) - im.min(2)
    bgc = bg.max(1) - bg.min(1)
    return (d > 14) | (np.abs(chroma - bgc[:, None]) > 6)


def runs(row, x0):
    out, start = [], None
    for i, v in enumerate(row):
        if v and start is None:
            start = i
        if not v and start is not None:
            if i - start >= 2:
                out.append([x0 + start, x0 + i])
            start = None
    if start is not None:
        out.append([x0 + start, x0 + len(row)])
    return out


def main(src, dst):
    key = src.split('/')[-1]
    cfg = SHEETS[key]
    im = np.asarray(Image.open(src).convert('RGB')).astype(float)
    m = segment(im, cfg['gap_cols'])
    s = cfg['height'] / (cfg['soles']['front'] - cfg['skull_top'])
    out = {'scale': s, 'height': cfg['height'], 'views': {}}
    for name, (x0, x1) in cfg['views'].items():
        sole = cfg['soles'][name]
        rows = {}
        for y in range(0, sole + 1):
            r = runs(m[y, x0:x1], x0)
            if r:
                rows[y] = r
        # centre line: in profile, the midpoint of the pelvis's depth; in the other views the mean
        # centre of the torso's run between 1.00 and 1.10 m (arms and hands hang clear of it there)
        if name == 'side':
            pel = int(sole - 0.9 / s)
            ext = rows.get(pel, [[x0, x1]])
            cx = (ext[0][0] + ext[-1][1]) / 2
        else:
            mid = (x0 + x1) / 2
            cs = []
            for yy in range(int(sole - 1.10 / s), int(sole - 1.00 / s)):
                rr = rows.get(yy)
                if rr:
                    r = min(rr, key=lambda q: abs((q[0] + q[1]) / 2 - mid) if q[1] - q[0] > 40 else 1e9)
                    cs.append((r[0] + r[1]) / 2)
            cx = float(np.mean(cs))
        out['views'][name] = {
            'cx': cx, 'sole': sole,
            'rows': [{'y': round((sole - y) * s, 5), 'runs': [[round((a - cx) * s, 5), round((b - cx) * s, 5)] for a, b in r]} for y, r in sorted(rows.items())],
        }
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print(f'{dst}: scale {s * 1000:.3f} mm/px, views ' + ', '.join(f"{k} cx={v['cx']:.1f}" for k, v in out['views'].items()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
