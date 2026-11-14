#!/usr/bin/env python3
"""Lay a runner's turnaround next to their reference sheet, view by view, at
matching heights: each pair the sheet's view (scaled so the figure stands as
tall as the sculpt does) and the render (tools/runner/fisher-sheet.html: 500
px to the metre, the road 25 px off its foot), their soles on one line, with
a faint line every 10 cm up them.

    python3 tools/characters/compare.py render.png out.png [height_m]
"""

import sys

from PIL import Image, ImageDraw

SHEET = 'tools/characters/fisher-sheet.jpg'
# the sheet: each view's column, where his soles are and the top of his hair
COLS = [(0, 384), (384, 768), (768, 1152), (1152, 1536)]
SOLE, TOP = 890, 99
PXM, VW, GROUND = 500, 500, 975


def main(render, out, height=1.64):
    sheet = Image.open(SHEET).convert('RGB')
    mine = Image.open(render).convert('RGB')
    k = height * PXM / (SOLE - TOP)
    H = 1000
    pairs = []
    for i, (x0, x1) in enumerate(COLS):
        ref = sheet.crop((x0, 0, x1, 1024))
        ref = ref.resize((round(ref.width * k), round(ref.height * k)))
        panel = Image.new('RGB', (ref.width, H), (249, 243, 239))
        panel.paste(ref, (0, GROUND - round(SOLE * k)))
        m = mine.crop((i * VW, 0, (i + 1) * VW, H))
        pairs += [panel, m]
    W = sum(p.width for p in pairs)
    img = Image.new('RGB', (W, H), (249, 243, 239))
    x = 0
    for p in pairs:
        img.paste(p, (x, 0))
        x += p.width
    d = ImageDraw.Draw(img)
    for cm in range(0, 200, 10):
        y = GROUND - cm * PXM / 100
        d.line([(0, y), (W, y)], fill=(255, 120, 120) if cm % 50 == 0 else (235, 205, 205), width=1)
        if cm % 50 == 0:
            d.text((2, y - 11), f'{cm / 100:.1f} m', fill=(200, 60, 60))
    img.save(out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], *(float(a) for a in sys.argv[3:4]))
