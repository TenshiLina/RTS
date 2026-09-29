"""Measurements of the rest mesh (numpy, no rendering): horizontal cross-sections and per-row
silhouette edges, and the concept sheet's edges in the same world frame.

World frame as in mh: Z-up metres, the figure faces -Y, its left is +X.
"""
import json, os
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REF = json.load(open(os.path.join(ROOT, 'tools/assetgen/ref/human-female.json')))
S = REF['scale']
COLS = {'front': (0, 368), 'side': (383, 541), 'back': (558, 900), 'q34': (900, 1190)}  # sheet columns per view


def mesh_edges(F):
    E = set()
    for f in F:
        for a, b in zip(f, f[1:] + f[:1]):
            E.add((a, b) if a < b else (b, a))
    return np.array(sorted(E), dtype=np.int64)


def sections(V, E, zs, keep=None):
    """Points where mesh edges cross each plane z (list of (k,2) arrays of x,y). keep: vertex mask;
    an edge counts only if both its ends are kept."""
    if keep is not None:
        E = E[keep[E[:, 0]] & keep[E[:, 1]]]
    za, zb = V[E[:, 0], 2], V[E[:, 1], 2]
    lo, hi = np.minimum(za, zb), np.maximum(za, zb)
    out = []
    for z in zs:
        m = (lo <= z) & (hi > z)
        a, b = V[E[m, 0]], V[E[m, 1]]
        t = ((z - a[:, 2]) / (b[:, 2] - a[:, 2]))[:, None]
        out.append((a + t * (b - a))[:, :2])
    return out


def sheet_edges(mask, view, rows):
    """Per sheet row: (left, right) mask extents of the run nearest the view's centre (front/back)
    or of the whole row (side), in metres from the view's centre line; NaN where empty."""
    cx = REF['views'][view]['cx']
    c0, c1 = COLS[view]
    out = np.full((len(rows), 2), np.nan)
    for i, r in enumerate(rows):
        xs = np.where(mask[r, c0:c1])[0] + c0
        if not len(xs):
            continue
        if view == 'side':
            out[i] = (xs[0] - cx) * S, (xs[-1] + 1 - cx) * S
            continue
        cuts = np.where(np.diff(xs) > 1)[0]
        runs = np.split(xs, cuts + 1)
        run = min(runs, key=lambda q: 0 if q[0] <= cx <= q[-1] else min(abs(q[0] - cx), abs(q[-1] - cx)))
        out[i] = (run[0] - cx) * S, (run[-1] + 1 - cx) * S
    return out


def row_z(view, rows):
    return (REF['views'][view]['sole'] - np.asarray(rows) - 0.5) * S
