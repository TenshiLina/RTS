"""Front-view jawline of the concept sheet's face close-up, as an explicit outline.

Below the cheeks the jaw is seen against the neck, not the background, so its outline is not a
silhouette; it is taken where the lit jaw gives way to the neck's shadow — per column, the strongest
bright-above / dark-below luminance edge between the mouth and the neck (below the lower lip near the
midline). Weak edges (hair strands crossing) are dropped, both sides are mirrored and averaged, and
the result is written in head-local metres (eye line y = 0), scaled by the pupils' spacing.

    python3 tools/assetgen/ref/face_front.py docs/art/factions/human/human-female-turnaround.webp \
        tools/assetgen/ref/human-female-face.json
"""
import json, sys
import numpy as np
from PIL import Image, ImageFilter

CLOSEUP = {'cx': 1309, 'eye_row': 282, 'm_per_px': 0.0634 / 70}


def main(src, dst):
    im = Image.open(src).convert('RGB')
    L = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    cx, ey, S = CLOSEUP['cx'], CLOSEUP['eye_row'], CLOSEUP['m_per_px']
    sides = {}
    for x in range(1242, 1377):
        ax = abs(x - cx) * S
        y0 = 372 if ax < 0.03 else 345
        g, yb = max((L[y - 2, x] - L[y + 2, x], y) for y in range(y0, 428))
        if g < 10:
            continue
        sides.setdefault(round(ax / 0.0025) * 0.0025, []).append(-(yb - ey) * S)
    xs = sorted(k for k in sides if k <= 0.0575)
    jaw = [[round(k, 4), round(float(np.median(sides[k])), 4)] for k in xs]
    # light smoothing along the outline
    ys = np.array([p[1] for p in jaw])
    sm = np.convolve(np.pad(ys, 2, mode='edge'), np.ones(5) / 5, mode='valid')
    jaw = [[p[0], round(float(v), 4)] for p, v in zip(jaw, sm)]
    json.dump({'jaw': jaw, 'note': 'head-local metres, eye line y=0; front-view jaw outline'}, open(dst, 'w'), indent=0)
    print(dst, len(jaw), 'points:', ' '.join(f'{x:.4f}:{y:.4f}' for x, y in jaw[::3]))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
