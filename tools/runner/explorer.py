#!/usr/bin/env python3
"""Sculpt the explorer and write assets/explorer/runner.json + runner.bin.

The second runner, sculpted the same way as the wayfarer (build.py: every
garment one signed-distance field of volumes blended smoothly into each other,
polygonised, skinned by which volume owns each point, linework drawn by the
game's character shader) and with the same kit - this script borrows build.py's
primitives, meshing, skinning and export - to her own reference sheet
(tools/characters/explorer-sheet.jpg): a slight girl about five heads tall,
the head big and round with huge green eyes; long vermilion hair, half of it
up in a messy bun on the crown and the rest falling to the shoulder blades
(that part is simulated in the game - src/game/explorer.js - so only the bun,
the fringe, the locks framing the face and a close cap are sculpted here); an
oversized rose sweater with a peach band across the chest and its sleeves
shoved up past the elbows over a peach tee; charcoal shorts; long thin legs, a
plaster on her right knee; pink socks slouched over chunky cream-and-grey
trainers; a small grey backpack, its straps over the shoulders and a bottle
pocket on the side; and her green sketchbook in her right hand.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/explorer.py

Coordinates are the game's: meters, y up, the runner facing -z.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, round_box, torus_y, Prim, rot_x, rot_y, rot_z, Garment, rigid, by_y, by_axis, along  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'explorer')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# rig: the game's skeleton (the bones the game drives are named as the
# wayfarer's), proportioned to her sheet: about five heads to the crown
# (1.5 m; the bun rises over it), the knee at 0.43 m, the hips high on long
# legs. The arms are bound a little out so the sleeves are modelled clear of
# the sweater.
# --------------------------------------------------------------------------------

HIP_Y = 0.725
HIP_JOINT = (0.066, 0.69)
THIGH = 0.255
SHIN = 0.32
TOE = (0.066, 0.108)
CHEST_Y = 0.955
SHOULDER = (0.122, 1.06)
UPPER_ARM = 0.2
FOREARM = 0.168
ARM_REST = 0.4
NECK_Y = 1.085
HEAD_Y = 1.2
KNEE_Y = HIP_JOINT[1] - THIGH

# the head (cranium centre, radii); the hair cap lies over it
CRAN = ((0, 1.372, 0.014), (0.118, 0.124, 0.118))
HAIR_THICK = 0.016  # the cap's average depth: the simulated hair lies on it

# the backpack: body centre, half extents; the lid on top hinges at its back
PACK = dict(c=(0.0, 0.925, 0.158), half=(0.1, 0.122, 0.052), r=0.04)
PACK_PIVOT = (0.0, 1.05, 0.118)  # where the straps meet the pack: it bounces about here
LID_PIVOT = (0.0, 1.03, 0.205)  # the lid's hinge, at the top of the pack's back

# springy hair: [bone, pivot (body space), parent] and how it swings in the
# game (stiffness Hz, damping, push, limit)
HAIR_BONES = [
    ('bun', (0.0, 1.488, 0.04), dict(f=2.3, z=0.13, k=1.7, lim=0.55)),
    ('fringe', (0.0, 1.44, -0.07), dict(f=3.8, z=0.22, k=0.55, lim=0.22)),
    ('lockL', (-0.105, 1.38, -0.035), dict(f=2.7, z=0.16, k=1.35, lim=0.5)),
    ('lockR', (0.105, 1.38, -0.035), dict(f=2.7, z=0.16, k=1.35, lim=0.5)),
]

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.08, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.08, 0))
    bone('neck', 'chest', (0, NECK_Y - CHEST_Y, 0))
    bone('head', 'neck', (0, HEAD_Y - NECK_Y, 0))
    for name, piv, _ in HAIR_BONES:
        bone(name, 'head', V(*piv) - V(0, HEAD_Y, 0))
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.045, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.045), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))
    bone('pack', 'chest', V(*PACK_PIVOT) - V(0, CHEST_Y, 0))
    bone('packLid', 'pack', V(*LID_PIVOT) - V(*PACK_PIVOT))
    bone('sim', None, (0, 0, 0))


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


MAT = dict(face=1, hair=2, sweater=3, tee=4, shorts=5, leg=6, shoe=7, hand=8, pack=9, hairSheet=10, book=11, strap=12)

# --------------------------------------------------------------------------------
# head and hair
# --------------------------------------------------------------------------------


def head_prims():
    # big and round: a high, full cranium over a small, soft-jawed face with
    # round cheeks and a little pointed chin; the eyes sit low (a child's)
    cran = ellipsoid(*CRAN)
    face = ellipsoid((0, 1.29, -0.03), (0.098, 0.094, 0.086))
    cheeks = [ellipsoid((s * 0.057, 1.247, -0.052), (0.048, 0.042, 0.042)) for s, _ in SIDES]
    jaw = ellipsoid((0, 1.232, -0.022), (0.078, 0.05, 0.068))
    chin = ellipsoid((0, 1.192, -0.056), (0.032, 0.022, 0.026))
    return cran, face, cheeks, jaw, chin


def skull(p):
    cran, face, cheeks, jaw, chin = head_prims()
    d = smin(cran(p), face(p), 0.05)
    for c in cheeks:
        d = smin(d, c(p), 0.035)
    d = smin(d, jaw(p), 0.04)
    return smin(d, chin(p), 0.03)


def g_head():
    cran, face, cheeks, jaw, chin = head_prims()
    nose = ellipsoid((0, 1.262, -0.118), (0.0095, 0.012, 0.009))
    ears = [ellipsoid((s * 0.114, 1.29, 0.014), (0.013, 0.025, 0.019), rot_y(s * 0.35)) for s, _ in SIDES]
    neck = round_cone((0, 1.04, 0.012), (0.0, 1.235, 0.006), 0.033, 0.031)

    def field(p):
        d = skull(p)
        d = smin(d, nose(p), 0.01)
        for e in ears:
            d = smin(d, e(p), 0.007)
        return smin(d, neck(p), 0.03)

    head = rigid('head')
    owners = [(cran, head), (face, head), (jaw, head), (chin, head), (nose, head)] + [(c, head) for c in cheeks] + [(e, head) for e in ears]
    owners.append((neck, by_y([(1.1, 'chest'), (1.14, 'neck'), (1.2, 'head')])))

    def details(p, n, own):
        return np.concatenate([p, np.zeros((len(p), 1))], 1)

    return Garment('head', MAT['face'], 0.0024, (-0.15, 0.98, -0.14), (0.15, 1.51, 0.15), field, owners, 2500, details=details)


def on_cran(theta, elev, lift=0.0):
    """A point on the cranium at azimuth theta (0 = front, + toward her
    right) and elevation elev, lifted off it along its normal."""
    c, r = V(*CRAN[0]), V(*CRAN[1])
    u = V(math.sin(theta) * math.cos(elev), math.sin(elev), -math.cos(theta) * math.cos(elev))
    p0 = c + r * u
    n = u / r ** 2
    n /= np.linalg.norm(n)
    return p0 + n * lift, n


def lock(pts, r0, r1=None, taper=(1.0, 0.9, 0.7, 0.45, 0.18)):
    """A lock of hair through points, tapering to a point."""
    k = len(pts)
    r1 = r0 if r1 is None else r1
    radii = [r0 * taper[min(i, len(taper) - 1)] if i < k - 1 else r0 * 0.12 for i in range(k)]
    return stroke([V(*q) for q in pts], radii)


def g_hair():
    """The sculpted part of her hair: a close cap over the skull (the long
    hair, simulated in the game, lies on it and grows out from under the
    bun), the long fringe falling to her brows in points, a lock on either side
    framing the face, and the messy bun on the crown with wisps escaping."""

    def cap(p):
        y = p[:, 1]
        thick = 0.007 + 0.016 * smooth(1.36, 1.49, y)
        return skull(p) - thick

    # the hairline: high at the forehead (the fringe covers it), down over the
    # temples in front of the ears, the nape low behind
    def hairline(p):
        th = np.abs(np.arctan2(p[:, 0], -(p[:, 2] - 0.014)))
        return np.interp(th, [0, 0.6, 1.0, 1.25, 1.45, 1.75, 2.2, 2.7, math.pi], [1.405, 1.39, 1.35, 1.31, 1.33, 1.3, 1.22, 1.18, 1.17])

    base = Prim(cap, (-0.15, 1.15, -0.15), (0.15, 1.53, 0.16))
    rnd = np.random.default_rng(11)
    fringe, lockL, lockR, bun, top = [], [], [], [], []

    # the fringe: fine locks from the crown's front, swept a little to her
    # left, falling over the forehead to the brows in uneven points with the
    # forehead showing between them, one short one straying between the eyes
    for th, tip, sweep, r0 in [
        (-0.64, 1.335, 0.004, 0.013), (-0.42, 1.31, 0.01, 0.014), (-0.2, 1.298, 0.014, 0.012),
        (0.12, 1.316, 0.008, 0.014), (0.34, 1.326, 0.0, 0.013), (0.58, 1.34, -0.008, 0.012),
    ]:
        a, _ = on_cran(th, 1.0, 0.006)
        b, _ = on_cran(th * 0.95 + sweep * 2, 0.62, 0.013)
        c, _ = on_cran(th * 0.9 + sweep * 4, 0.36, 0.017)
        d = V(c[0] * 0.97 + sweep + rnd.uniform(-0.004, 0.004), tip + rnd.uniform(-0.004, 0.004), c[2] - 0.004)
        fringe.append(lock([a, b, c, d], r0, taper=(1.0, 0.95, 0.75, 0.12)))
    a, _ = on_cran(0.02, 0.9, 0.008)
    b, _ = on_cran(0.06, 0.42, 0.018)
    fringe.append(lock([a, b, V(b[0] + 0.004, 1.286, b[2] - 0.004)], 0.009, taper=(1.0, 0.8, 0.12)))

    # locks framing the face: from the temples down past the cheeks to the
    # jaw, curving out a little at the ends
    for s, out in [(-1, lockL), (1, lockR)]:
        for k, (th, tip, r0) in enumerate([(1.0, 1.2, 0.022), (1.18, 1.165, 0.025), (1.36, 1.19, 0.021)]):
            a, _ = on_cran(s * th, 0.62, 0.008)
            b, _ = on_cran(s * (th + 0.06), 0.1, 0.02 + 0.003 * k)
            c = V(b[0] + s * 0.004, 1.25, b[2] - 0.006)
            d = V(b[0] + s * (0.012 + 0.005 * k), tip, b[2] + 0.004 * k)
            out.append(lock([a, b, c, d], r0, taper=(1.0, 0.95, 0.8, 0.14)))

    # the bun: a knot of twisted locks on the crown, a little back, with
    # wisps escaping it
    bc = V(0.0, 1.538, 0.042)
    knot = ellipsoid(bc, (0.05, 0.042, 0.048))
    bun.append(knot)
    for k in range(5):
        a0 = k * 2 * math.pi / 5 + 0.3
        pts = []
        for j in range(5):
            a = a0 + j * 0.9
            rr = 0.046 - 0.004 * j
            pts.append(bc + V(math.cos(a) * rr, -0.02 + 0.014 * j + 0.004 * math.sin(a * 2), math.sin(a) * rr * 0.95))
        bun.append(stroke(pts, [0.02, 0.021, 0.019, 0.016, 0.009]))
    # wisps: thin strands springing out of the knot
    for a, el, ln in [(0.4, 1.1, 0.07), (1.9, 0.8, 0.06), (2.9, 1.25, 0.075), (4.3, 0.7, 0.055), (5.4, 1.0, 0.065)]:
        d = V(math.cos(a) * math.cos(el), math.sin(el), math.sin(a) * math.cos(el))
        p0 = bc + d * 0.03
        p1 = p0 + d * ln * 0.55 + V(0, 0.01, 0)
        p2 = p0 + d * ln + V(math.cos(a + 1) * 0.012, 0.004, math.sin(a + 1) * 0.012)
        bun.append(stroke([p0, p1, p2], [0.008, 0.005, 0.0012]))
    # the hair drawn up from the nape and the sides into the knot
    for th in [-2.4, -1.6, -0.9, 0.9, 1.6, 2.4, math.pi]:
        a, _ = on_cran(th, 0.58, 0.004)
        b, _ = on_cran(th * 0.6, 1.12, 0.012)
        top.append(stroke([a, b, bc + V(math.sin(th) * 0.02, -0.025, -math.cos(th) * 0.02)], [0.024, 0.02, 0.014]))

    def field(p):
        d = smax(base(p), hairline(p) - p[:, 1], 0.012)
        for q in top:
            d = smin(d, q(p), 0.012)
        for q in bun:
            d = smin(d, q(p), 0.008)
        for q in fringe + lockL + lockR:
            d = smin(d, q(p), 0.006)
        return d

    head = rigid('head')
    owners = [(base, head)] + [(q, head) for q in top]
    owners += [(q, by_y([(1.5, 'head'), (1.515, 'bun')])) for q in bun]
    owners += [(q, by_y([(1.31, 'fringe'), (1.42, 'head')])) for q in fringe]
    owners += [(q, by_y([(1.25, 'lockL'), (1.36, 'head')])) for q in lockL]
    owners += [(q, by_y([(1.25, 'lockR'), (1.36, 'head')])) for q in lockR]

    def details(p, n, own):
        # x: on a lock or the bun's wisps (strands are drawn along them)
        return np.stack([1 - own[:, 0], np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('hair', MAT['hair'], 0.0024, (-0.19, 1.07, -0.17), (0.19, 1.65, 0.17), field, owners, 3600, tau=0.008, details=details)


# --------------------------------------------------------------------------------
# the sweater, tee and shorts
# --------------------------------------------------------------------------------

SWEATER = dict(
    chest=((0, 0.968, 0.008), (0.122, 0.13, 0.084)),
    yoke=((0, 1.038, 0.008), (0.128, 0.052, 0.074)),
    belly=((0, 0.86, 0.006), (0.128, 0.1, 0.088)),
    hem=0.79,
    cap=0.056,
)
BUNCH_U = 0.27  # how far down the arm the shoved-up sleeves bunch (past the elbow)
STRIPE = (0.915, 0.958)  # the peach band across the chest (rest heights)


def sweater_prims():
    S_ = SWEATER
    chest = ellipsoid(*S_['chest'])
    yoke = ellipsoid(*S_['yoke'])
    belly = ellipsoid(*S_['belly'])
    sleeves = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        B0 = S + BUNCH_U * d
        sleeves.append(dict(
            S=S, d=d, out=out,
            cap=ellipsoid(S + 0.015 * d - 0.006 * out, (S_['cap'], S_['cap'], S_['cap'] * 0.9)),
            upper=round_cone(S + 0.01 * d, E, 0.05, 0.047),
            lower=round_cone(E, B0 - 0.02 * d, 0.047, 0.05),
            # the bunched cuff: rolls of knit round the forearm
            rolls=[torus_axis(B0 - 0.012 * d, d, 0.04, 0.014), torus_axis(B0 + 0.008 * d, d, 0.037, 0.013)],
        ))
    return chest, yoke, belly, sleeves


def torus_axis(c, axis, R, r):
    """A ring of radius R (tube r) round an axis through c."""
    c = V(*c)
    a = V(*axis) / np.linalg.norm(axis)

    def fn(p):
        q = p - c
        h = q @ a
        rho = np.sqrt(np.maximum((q * q).sum(-1) - h * h, 0))
        return np.sqrt((rho - R) ** 2 + h * h) - r

    m = R + r
    return Prim(fn, c - m, c + m)


def sweater_body(p, prims):
    chest, yoke, belly, sleeves = prims
    t = smin(belly(p), chest(p), 0.08)
    t = smin(t, yoke(p), 0.05)
    for sl in sleeves:
        t = smin(t, sl['cap'](p), 0.045)
    return t


def sweater_smooth(p, prims):
    t = sweater_body(p, prims)
    for sl in prims[3]:
        t = smin(t, smin(sl['upper'](p), sl['lower'](p), 0.02), 0.05)
    return t


def g_sweater():
    prims = sweater_prims()
    chest, yoke, belly, sleeves = prims
    collar = torus_axis((0, NECK_Y + 0.004, 0.01), (0, 1, 0.12), 0.046, 0.011)
    neckhole = round_cone((0, 1.05, 0.012), (0, 1.2, 0.01), 0.038, 0.038)
    hemband = torus_y((0, SWEATER['hem'] + 0.012, 0.006), 0.122, 0.015, 0.7)

    def field(p):
        y = p[:, 1]
        t = sweater_body(p, prims)
        # a loose, slouchy knit: soft ripples where it gathers over the belly
        t = t + 0.0025 * np.sin(p[:, 0] * 60 + y * 9) * smooth(0.95, 0.83, y)
        t = smin(t, hemband(p), 0.02)
        t = smax(t, SWEATER['hem'] - y, 0.012)
        t = smin(t, collar(p), 0.014)
        t = smax(t, -neckhole(p), 0.008)
        for sl in sleeves:
            s = smin(sl['upper'](p), sl['lower'](p), 0.02)
            # soft folds where the sleeve is shoved up
            u = (p - sl['S']) @ sl['d']
            s = s + 0.004 * np.sin(u * 70) * smooth(0.14, 0.24, u)
            for r in sl['rolls']:
                s = smin(s, r(p), 0.012)
            t = smin(t, s, 0.045)
        return t

    torso_w = by_y([(0.8, 'hips'), (0.88, 'spine'), (0.95, 'spine'), (1.02, 'chest')])
    owners = [(belly, torso_w), (chest, torso_w), (yoke, torso_w), (hemband, torso_w), (collar, by_y([(1.09, 'chest'), (1.12, 'neck')]))]
    n_torso = len(owners)
    for sl, (s, L) in zip(sleeves, SIDES):
        w = by_axis(sl['S'], sl['d'], [(-0.02, 'clav' + L), (0.08, 'arm' + L), (0.17, 'arm' + L), (0.215, 'fore' + L)])
        owners += [(sl['cap'], w), (sl['upper'], w), (sl['lower'], w)] + [(r, rigid('fore' + L)) for r in sl['rolls']]
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        torso = own[:, :n_torso].sum(1)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        rib = own[:, 3] + own[:, 4]  # the hem band and the collar
        return np.stack([rib, np.zeros(len(p)), torso, u], 1)

    return Garment('sweater', MAT['sweater'], 0.004, (-0.36, 0.75, -0.13), (0.36, 1.13, 0.13), field, owners, 5000, tau=0.014, details=details)


def g_tee():
    # only the tee's hem shows, under the sweater's
    hem = Prim(lambda p: smax(smax(ellipsoid((0, 0.8, 0.006), (0.122, 0.06, 0.084)).fn(p), 0.765 - p[:, 1], 0.006), p[:, 1] - 0.83, 0.006),
               (-0.13, 0.75, -0.1), (0.13, 0.84, 0.1))
    owners = [(hem, by_y([(0.78, 'hips'), (0.82, 'spine')]))]
    return Garment('tee', MAT['tee'], 0.0035, (-0.14, 0.74, -0.11), (0.14, 0.86, 0.11), hem, owners, 700, tau=0.01, outline=0.6)


SHORTS_HEM = 0.622


def g_shorts():
    pelvis = ellipsoid((0, 0.745, 0.008), (0.12, 0.1, 0.092))
    legs = [round_cone((s * 0.066, 0.7, 0.004), (s * 0.076, SHORTS_HEM, 0.008), 0.07, 0.064) for s, _ in SIDES]
    holes = [round_cone((s * 0.072, 0.67, 0.006), (s * 0.077, 0.55, 0.008), 0.047, 0.047) for s, _ in SIDES]

    def inseam(p):
        x, y = p[:, 0], p[:, 1]
        return np.maximum(np.abs(x) - (0.003 + np.maximum(0, 0.67 - y) * 0.3), y - 0.67)

    def field(p):
        d = pelvis(p)
        for q in legs:
            d = smin(d, q(p), 0.035)
        d = smax(d, -inseam(p), 0.01)
        d = smax(d, SHORTS_HEM - p[:, 1], 0.008)
        for q in holes:
            d = smax(d, -q(p), 0.007)
        return d

    owners = [(pelvis, rigid('hips'))] + [(q, by_y([(0.64, 'thigh' + L), (0.71, 'hips')])) for q, (s, L) in zip(legs, SIDES)]
    return Garment('shorts', MAT['shorts'], 0.0032, (-0.17, 0.59, -0.12), (0.17, 0.86, 0.13), field, owners, 2200, tau=0.016)


# --------------------------------------------------------------------------------
# legs, socks, shoes, hands
# --------------------------------------------------------------------------------

SOCK_TOP = 0.205
SHOE_X = 0.072
SHOE_COLLAR = (0.132, 0.1)  # collar height over the ground at the ankle, rise toward the heel
SOLE_H = 0.05


def g_legs():
    prims, owners = [], []
    kn = KNEE_Y
    for s, L in SIDES:
        x = s * HIP_JOINT[0]
        w = by_y([(0.11, 'foot' + L), (0.15, 'shin' + L), (kn - 0.03, 'shin' + L), (kn + 0.025, 'thigh' + L)])
        thigh = round_cone((x, 0.68, 0.004), (x + s * 0.003, kn, 0.0), 0.046, 0.032)
        knee = ellipsoid((x + s * 0.003, kn + 0.004, -0.016), (0.022, 0.025, 0.014))
        calf = round_cone((x + s * 0.003, kn - 0.004, 0.003), (x + s * 0.005, 0.31, 0.01), 0.031, 0.032)
        shin = round_cone((x + s * 0.005, 0.31, 0.009), (x + s * 0.006, 0.13, 0.002), 0.031, 0.023)
        # the slouched sock: a looser tube round the ankle, scrunched in rolls
        sock = round_cone((x + s * 0.006, 0.1, 0.004), (x + s * 0.006, SOCK_TOP - 0.012, 0.006), 0.034, 0.031)
        rolls = [torus_y((x + s * 0.006, y, 0.005 + 0.001 * k), 0.031 - 0.001 * k, 0.0065) for k, y in enumerate([0.142, 0.168, 0.192])]
        prims.append((thigh, knee, calf, shin, sock, rolls))
        owners += [(q, w) for q in (thigh, knee, calf, shin, sock)] + [(r, w) for r in rolls]

    def field(p):
        out = np.full(len(p), 1.0)
        for thigh, knee, calf, shin, sock, rolls in prims:
            d = smin(smin(thigh(p), calf(p), 0.03), shin(p), 0.05)
            d = smin(d, knee(p), 0.018)
            d = smin(d, sock(p), 0.012)
            for r in rolls:
                d = smin(d, r(p), 0.006)
            out = np.minimum(out, d)
        return out

    return Garment('legs', MAT['leg'], 0.0034, (-0.14, 0.06, -0.07), (0.14, 0.76, 0.07), field, owners, 2000, tau=0.012)


def g_shoes():
    """Chunky trainers: a thick cream sole with a lifted toe, a bulbous toe
    box, the upper climbing to a padded collar round the ankle (the slouched
    sock spills over it), the tongue standing up at the front."""
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * SHOE_X

        def sole_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1], p[:, 2]
            px, py = np.abs(x), 0.064 - z
            r1, r2, h = 0.049, 0.055, 0.19
            b = (r1 - r2) / h
            a = math.sqrt(1 - b * b)
            k = -b * px + a * py
            d2 = np.where(k < 0, np.sqrt(px ** 2 + py ** 2) - r1, np.where(k > a * h, np.sqrt(px ** 2 + (py - h) ** 2) - r2, a * px + b * py - r1))
            yy = y - 0.026 * smooth(-0.07, -0.18, z) ** 2
            r = 0.013
            wx, wy = d2 + r, np.abs(yy - SOLE_H / 2) - SOLE_H / 2 + r
            return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r

        sole = Prim(sole_fn, (bx - 0.065, -0.01, -0.2), (bx + 0.065, 0.08, 0.13))
        foot = round_cone((bx, 0.088, 0.03), (bx, 0.08, -0.1), 0.05, 0.048)
        toebox = ellipsoid((bx, 0.078, -0.128), (0.05, 0.04, 0.05))
        instep = round_cone((bx, 0.09, -0.075), (bx, 0.13, -0.025), 0.042, 0.041)
        heel = ellipsoid((bx, 0.092, 0.042), (0.047, 0.058, 0.034))
        ankle = round_cone((bx, 0.085, 0.01), (bx, 0.128, 0.01), 0.049, 0.045)
        collar = torus_y((bx, 0.137, 0.012), 0.039, 0.013, 1.1)
        tongue = round_box((bx, 0.148, -0.032), (0.02, 0.026, 0.008), 0.008, rot_x(-0.38))
        hole = round_cone((bx, 0.11, 0.008), (bx, 0.22, 0.006), 0.031, 0.031)
        parts.append((sole, foot, toebox, instep, heel, ankle, collar, tongue, hole))
        low = along(lambda p: p[:, 2], [(-0.11, 'toe' + L), (-0.065, 'foot' + L)])
        owners += [(sole, low), (foot, low), (toebox, low), (instep, low), (heel, rigid('foot' + L)), (ankle, rigid('foot' + L)), (collar, rigid('foot' + L)), (tongue, rigid('foot' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for sole, foot, toebox, instep, heel, ankle, collar, tongue, hole in parts:
            d = smin(sole(p), foot(p), 0.016)
            d = smin(d, toebox(p), 0.022)
            d = smin(d, instep(p), 0.03)
            d = smin(d, heel(p), 0.022)
            d = smin(d, ankle(p), 0.03)
            d = smin(d, collar(p), 0.012)
            d = smin(d, tongue(p), 0.01)
            d = smax(d, -hole(p), 0.006)
            out = np.minimum(out, d)
        return out

    return Garment('shoes', MAT['shoe'], 0.0032, (-0.15, -0.012, -0.21), (0.15, 0.19, 0.13), field, owners, 2600, tau=0.012)


def g_hands():
    """Bare forearms out of the bunched sleeves, and small hands."""
    parts, owners = [], []
    fw = V(0, 0, -1)
    for s, L in SIDES:
        S, E, W, dn, out = arm_frame(s)
        R = np.stack([out, dn, fw], 1)
        B0 = S + BUNCH_U * dn
        fore = round_cone(B0 - 0.01 * dn, W, 0.024, 0.018)
        palm = round_box(W + 0.04 * dn, (0.017, 0.037, 0.032), 0.013, R)
        c = W + 0.078 * dn - 0.008 * out
        fingers = round_cone(c - 0.024 * fw, c + 0.024 * fw, 0.017, 0.016)
        thumb = round_cone(W + 0.032 * dn - 0.01 * out + 0.028 * fw, W + 0.07 * dn - 0.02 * out + 0.02 * fw, 0.012, 0.0095)
        parts.append((fore, palm, fingers, thumb))
        owners += [(fore, by_axis(W, dn, [(-0.03, 'fore' + L), (0.01, 'hand' + L)])), (palm, rigid('hand' + L)), (fingers, rigid('hand' + L)), (thumb, rigid('hand' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for fore, palm, fingers, thumb in parts:
            d = smin(fore(p), palm(p), 0.014)
            d = smin(d, fingers(p), 0.01)
            d = smin(d, thumb(p), 0.009)
            out = np.minimum(out, d)
        return out

    return Garment('hands', MAT['hand'], 0.0024, (-0.38, 0.5, -0.07), (0.38, 0.98, 0.07), field, owners, 1400)


# --------------------------------------------------------------------------------
# backpack, straps, sketchbook
# --------------------------------------------------------------------------------


def pack_prims():
    P = PACK
    c = V(*P['c'])
    body = round_box(c, P['half'], P['r'])
    # the top is rounded over into the lid
    lid = ellipsoid(c + V(0, P['half'][1] - 0.012, 0.0), (P['half'][0] - 0.004, 0.042, P['half'][2] + 0.002))
    pocket = round_box(c + V(0, -0.055, P['half'][2] + 0.012), (0.075, 0.058, 0.018), 0.016)
    bottle = round_cone(c + V(-P['half'][0] - 0.012, -0.11, 0.0), c + V(-P['half'][0] - 0.012, -0.02, 0.0), 0.03, 0.03)
    handle = torus_axis(c + V(0, P['half'][1] + 0.03, -0.03), (0, 0, 1), 0.018, 0.0055)
    return body, lid, pocket, bottle, handle


def g_pack():
    body, lid, pocket, bottle, handle = pack_prims()
    top = PACK['c'][1] + PACK['half'][1] - 0.02

    def body_fn(p):
        # (cut level under the lid, so the opening shows when it lifts)
        return smax(body(p), p[:, 1] - top, 0.01)

    bodyP = Prim(body_fn, body.lo, body.hi)

    def field(p):
        d = smin(bodyP(p), pocket(p), 0.012)
        d = smin(d, bottle(p), 0.014)
        d = smin(d, lid(p), 0.01)
        return smin(d, handle(p), 0.006)

    owners = [(bodyP, rigid('pack')), (pocket, rigid('pack')), (bottle, rigid('pack')), (lid, rigid('packLid')), (handle, rigid('packLid'))]

    def details(p, n, own):
        # x: on the lid, y: on the front pocket, z: on the bottle pocket,
        # w: on the body's top (the dark opening the lid covers)
        open_ = own[:, 0] * smooth(top - 0.012, top - 0.002, p[:, 1])
        return np.stack([own[:, 3] + own[:, 4], own[:, 1], own[:, 2], open_], 1)

    lo = V(*PACK['c']) - V(0.16, 0.16, 0.08)
    hi = V(*PACK['c']) + V(0.13, 0.19, 0.1)
    return Garment('pack', MAT['pack'], 0.003, lo, hi, field, owners, 2600, tau=0.008, details=details)


def strap_path(s):
    """A shoulder strap: from the pack's top, over the shoulder, down the
    front of the chest, under the arm and back to the pack's lower corner."""
    return [
        V(s * 0.055, 1.045, 0.118),
        V(s * 0.072, 1.088, 0.062),
        V(s * 0.08, 1.098, 0.0),
        V(s * 0.078, 1.065, -0.07),
        V(s * 0.076, 0.99, -0.096),
        V(s * 0.082, 0.92, -0.094),
        V(s * 0.105, 0.86, -0.07),
        V(s * 0.124, 0.835, 0.0),
        V(s * 0.108, 0.83, 0.1),
    ]


def g_straps():
    parts, owners = [], []
    for s, L in SIDES:
        pts = strap_path(s)
        st = stroke(pts, [0.0105] * len(pts))
        # flatten the tube against the body: it is a webbing strap
        parts.append(st)
        owners.append((st, along(lambda p: p[:, 2], [(0.05, 'chest'), (0.1, 'pack')])))
        # a buckle where the strap is adjusted, on the chest
        bk = round_box(V(s * 0.077, 0.955, -0.104), (0.016, 0.012, 0.006), 0.004, rot_x(0.08))
        parts.append(bk)
        owners.append((bk, rigid('chest')))

    def field(p):
        out = np.full(len(p), 1.0)
        for q in parts:
            out = np.minimum(out, q(p))
        return out

    def details(p, n, own):
        bk = own[:, 1] + own[:, 3]
        return np.stack([bk, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('straps', MAT['strap'], 0.003, (-0.15, 0.8, -0.12), (0.15, 1.12, 0.14), field, owners, 1400, tau=0.006, details=details)


def book_frame():
    """The sketchbook in her right hand: gripped at its top outer corner, the
    cover facing forward, hanging down and in across her thigh."""
    S, E, W, dn, out = arm_frame(1)
    fw = V(0, 0, -1)
    # the book's own axes: across (toward the body), down, and out of its cover
    ax = -out
    ay = dn
    az = fw
    c = W + 0.072 * dn - 0.052 * out + 0.006 * fw
    return c, np.stack([ax, ay, az], 1)


BOOK = dict(half=(0.068, 0.092, 0.0085))


def g_book():
    c, R = book_frame()
    h = BOOK['half']
    cover = round_box(c, h, 0.004, R)
    # the spiral along its top edge
    spiral = []
    for k in range(9):
        u = -h[0] + 0.012 + k * (2 * h[0] - 0.024) / 8
        q = c + R @ V(u, -h[1] + 0.001, 0)
        spiral.append(torus_axis(q, R @ V(1, 0, 0), 0.0075, 0.0018))

    def field(p):
        d = cover(p)
        for q in spiral:
            d = smin(d, q(p), 0.001)
        return d

    owners = [(cover, rigid('handR'))] + [(q, rigid('handR')) for q in spiral]

    def details(p, n, own):
        # the book's own coordinates: across, down (from its top edge), out of
        # the cover (+ front, - back); w: on the spiral
        q = (p - c) @ R
        return np.stack([q[:, 0] / h[0], (q[:, 1] + h[1]) / (2 * h[1]), q[:, 2] / h[2], own[:, 1:].sum(1)], 1)

    def mats(p, n, own):
        return np.where(own[:, 1:].sum(1) > 0.5, MAT['strap'], MAT['book'])

    lo = c - 0.14
    hi = c + 0.14
    return Garment('book', MAT['book'], 0.0026, lo, hi, field, owners, 1100, tau=0.004, details=details, mats=mats, outline=0.8)


# --------------------------------------------------------------------------------
# the volumes the simulated hair is kept off (bind space, each with its bone)
# --------------------------------------------------------------------------------


def hair_colliders():
    S_ = SWEATER
    ell = lambda b, cr: dict(bone=b, kind='ell', c=list(cr[0]), r=list(cr[1]))
    out = []
    for s, L in SIDES:
        S, E, W, d, o = arm_frame(s)
        out.append(dict(bone='clav' + L, kind='cap', a=list(S - 0.01 * d), b=list(S + 0.03 * d), ra=S_['cap'] + 0.004, rb=S_['cap']))
        out.append(dict(bone='arm' + L, kind='cap', a=list(S + 0.01 * d), b=list(E), ra=0.05, rb=0.047))
    out.append(dict(bone='neck', kind='cap', a=[0, 1.05, 0.012], b=[0, 1.2, 0.008], ra=0.035, rb=0.034))
    # the body last: the head under the cap, the pack and the sweater
    cran = (CRAN[0], tuple(r + HAIR_THICK for r in CRAN[1]))
    out.append(ell('head', cran))
    out.append(ell('head', ((0, 1.255, -0.02), (0.095, 0.085, 0.085))))
    out.append(ell('pack', (PACK['c'], tuple(h + 0.01 for h in PACK['half']))))
    out.append(ell('chest', S_['chest']))
    out.append(ell('chest', S_['yoke']))
    out.append(ell('spine', S_['belly']))
    return [{k: (round(float(v), 5) if isinstance(v, float) else [round(float(x), 5) for x in v] if isinstance(v, (list, tuple)) else v) for k, v in c.items()} for c in out]


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_hair(), g_tee(), g_sweater(), g_shorts(), g_legs(), g_shoes(), g_hands(), g_pack(), g_straps(), g_book()]
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST,
        hair=[dict(name=n, dir=list((V(*piv) - V(*CRAN[0])) / np.linalg.norm(V(*piv) - V(*CRAN[0]))), **k) for n, piv, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])], hairThick=HAIR_THICK,
        cloth=hair_colliders(),
        pack=dict(c=list(PACK['c']), half=list(PACK['half']), pivot=list(PACK_PIVOT), lid=list(LID_PIVOT)),
        sockTop=SOCK_TOP, shortsHem=SHORTS_HEM, shoeX=SHOE_X, shoeCollar=list(SHOE_COLLAR), soleH=SOLE_H,
        stripe=list(STRIPE), bunchU=BUNCH_U, kneeY=KNEE_Y, hem=SWEATER['hem'], book=BOOK['half'],
    )
    B.export(garments, OUT, MAT, rig, 'explorer', 'explorer.py')
    print(f'explorer: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
