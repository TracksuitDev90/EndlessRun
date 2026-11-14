#!/usr/bin/env python3
"""Cut the character-select cards out of the reference sheets.

Each sheet (front, left, back, right on paper) gives its front view: the paper
round it - and any paper enclosed by the figure, like the gap between the
legs - is cut away with a soft, un-haloed edge, and the result is written to
assets/characters/<id>.webp. The select screen frames them (css/style.css).

Run from the repository root:

    pip install numpy scipy pillow
    python3 tools/characters/cards.py          # every card
    python3 tools/characters/cards.py bunny    # just these
"""

import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', 'assets', 'characters')

# id, sheet, crop box of the front view (left, top, right, bottom), and the
# paper's colour (if not the usual)
JOBS = [
    ('explorer', 'explorer-sheet.jpg', (60, 0, 400, 945), None),
    ('wayfarer', 'wayfarer-sheet.jpg', (30, 60, 410, 915), None),
    ('elder', 'elder-sheet.jpg', (8, 56, 380, 975), (242, 237, 234)),
    ('bunny', 'bunny-sheet.jpg', (0, 0, 428, 1000), (248, 242, 236)),
    ('skater', 'skater-sheet.jpg', (40, 0, 420, 1000), (251, 248, 243)),
    ('samurai', 'samurai-sheet.jpg', (0, 8, 470, 1016), (248, 245, 240)),
    ('fisher', 'fisher-sheet.jpg', (6, 30, 392, 900), (250, 243, 239)),
]
# patches painted out of a sheet before it's cut (sheet pixels: left, top,
# right, bottom), filled down each column from the colours above and below:
# the little brand mark on the skater's shorts (her sculpt has none)
PATCH = {'skater': [(301, 560, 331, 580)]}
PAPER = np.array([250, 245, 239.0])


def cut(sheet, box, paper=None, patches=()):
    PAPER = np.array(paper, float) if paper else globals()['PAPER']
    full = np.asarray(Image.open(os.path.join(HERE, sheet)).convert('RGB')).astype(float).copy()
    for x0, y0, x1, y1 in patches:
        top, bot = full[y0 - 1, x0:x1], full[y1, x0:x1]
        for y in range(y0, y1):
            k = (y - y0 + 1) / (y1 - y0 + 1)
            full[y, x0:x1] = top * (1 - k) + bot * k
    a = full[box[1]:box[3], box[0]:box[2]]
    d = np.sqrt(((a - PAPER) ** 2).sum(-1))
    # light pixels touching the border are paper (and the soft floor shadow);
    # so is any big enclosed patch of near-paper (cream shoes are further off)
    lab, n = ndimage.label(d < 70)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    holes = [i for i in range(1, n + 1) if i not in border and (lab == i).sum() > 300 and d[lab == i].mean() < 15]
    paper = np.isin(lab, list(border) + holes)
    alpha = np.where(paper, np.clip((d - 58) / 34, 0, 1), 1.0)
    # drop specks, then let the edge breathe by a couple of pixels
    keep = alpha > 0.5
    lab2, n2 = ndimage.label(keep)
    sizes = ndimage.sum(keep, lab2, range(1, n2 + 1))
    big = np.isin(lab2, [i + 1 for i, s in enumerate(sizes) if s > 400])
    alpha = alpha * ndimage.binary_dilation(big, iterations=2)
    # take the paper back out of the soft edge so it doesn't halo
    k = np.clip(alpha, 1e-3, 1)[..., None]
    rgb = np.clip((a - PAPER * (1 - k)) / k, 0, 255)
    rgb = np.where(alpha[..., None] > 0.02, rgb, 0)
    img = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    bb = img.getbbox()
    return img.crop((bb[0] - 4, bb[1] - 4, bb[2] + 4, bb[3] + 4))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    for name, sheet, box, paper in JOBS:
        if only and name not in only:
            continue
        img = cut(sheet, box, paper, PATCH.get(name, ()))
        img.save(os.path.join(OUT, name + '.webp'), 'WEBP', quality=90, method=6)
        print(f'{name}: {img.size[0]}x{img.size[1]}')
