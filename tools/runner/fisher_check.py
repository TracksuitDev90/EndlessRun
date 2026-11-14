#!/usr/bin/env python3
"""Where one of the fisherman's garments pokes out through the one over it.

Samples the surface of each inner garment (its field's zero set, on a grid)
and reports the points that lie outside the cloth of the garment that
should cover them there - the jacket over the tee, the bib and the
trousers; the trousers over the boots' shafts. Run from the repository
root: python3 tools/runner/fisher_check.py
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import fisher as F  # noqa: E402


def surface_points(g, h=0.006):
    axes = [np.arange(g.lo[k], g.hi[k] + h, h) for k in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing='ij'), -1).reshape(-1, 3)
    d = F.B.sample(g.field, grid)
    return grid[np.abs(d) < h * 0.5]


def main():
    F.build_rig()
    jacket = F.jacket_outer()
    T = F.JACKET['shell']
    outer = lambda p: F.jacket_smooth(p, jacket)
    covered = lambda p: (p[:, 1] > F.JACKET['hem'] + 0.01) & (F.open_gap(p) > 0.01) & (p[:, 1] < 1.33)
    tr = F.g_trousers()
    for name, g in [('inner', F.g_inner()), ('trousers', tr)]:
        p = surface_points(g)
        p = p[covered(p)]
        bad = p[outer(p) > -T]
        print(f'{name} through the jacket: {len(bad)} of {len(p)}', np.round(bad[:6], 3).tolist())

if __name__ == '__main__':
    main()
