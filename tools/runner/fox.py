#!/usr/bin/env python3
"""Sculpt Sorrel, the red fox who runs with you, and write assets/fox/runner.json
+ runner.bin.

Sculpted the way the runners are (build.py: every surface one signed-distance
field of volumes blended smoothly into each other, polygonised, skinned by
which volume owns each point, the markings drawn by the game's character
shader) and with the same kit - this script borrows build.py's primitives,
meshing, skinning and export - after the reference paintings: a slender,
long-legged red fox, the deep chest and tucked-up waist of a runner, a fine
pointed muzzle, big pointed ears cupped forward, cheek ruffs that flare back
into points, a ruff of fur down the throat, and a great brush of a tail.

The fur is in the shape, not only painted on: the cheeks and the throat end in
pointed tufts, the backs of the thighs and elbows are feathered, and the tail
is clumped all over into shingles of fur, each lying toward the tip and ending
in a point, so the outline is ragged the way fur is. The game paints the rest
(src/game/fox.js, FOX in the character shader): the coat brushed in strokes
along the lie of the fur, the white of the muzzle, cheeks, throat and tail tip
torn into points where it meets the red, the dark stockings, the black backs
of the ears, the face; and grows a short pile of fur over all of it.

Each vertex carries (detail): x how far inside the white it lies (m, > 0
inside), y how dark it runs (the stockings and the backs of the ears, 0..1),
z how far along the tail it is (0..1; -1 off the tail), w how long its fur
grows (m).

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/fox.py

Coordinates are the game's: meters, y up, the fox facing -z, standing over
the origin.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, Prim, rot_x, rot_y, rot_z, Garment, rigid, along, by_axis, by_y, bone, norm, dot  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'fox')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# the skeleton (bind pose: standing square, looking ahead, the tail held out
# behind a little below level). Every bone is bound unrotated; the game aims
# each one where it should point.
# --------------------------------------------------------------------------------

HIPS = V(0, 0.4, 0.19)
SPINE = V(0, 0.41, 0.0)
CHEST = V(0, 0.39, -0.17)
NECK = V(0, 0.44, -0.27)
HEAD = V(0, 0.575, -0.39)  # the head turns about the top of the neck
JAW = V(0, 0.556, -0.432)  # the jaw's hinge
EAR = (0.043, 0.648, -0.414)  # where each ear springs from the skull
EAR_TIP = (0.071, 0.772, -0.394)

# front legs: the shoulder joint, elbow, wrist, and the paw's toes on the road
FRONT = dict(shoulder=(0.064, 0.352, -0.205), elbow=(0.06, 0.226, -0.162), wrist=(0.056, 0.068, -0.178), toe=(0.056, 0.012, -0.226))
# hind legs: the hip joint, stifle (the knee, forward), hock (the heel, back)
# and the foot where the toes begin. The cannon below the hock lies near
# parallel to the thigh, as in every running dog: the game keeps it so, which
# makes the three-bone leg a two-bone solve.
HIND = dict(hip=(0.07, 0.385, 0.21), stifle=(0.074, 0.252, 0.143), hock=(0.068, 0.128, 0.268), foot=(0.064, 0.03, 0.243), toe=(0.064, 0.012, 0.2))

NOSE = (0, 0.577, -0.566)
# the cheek ruff's points (right side; x, y, z) and how thick each starts,
# from the top of the fan, up by the ear, round to under the jaw
RUFF = [
    ((0.114, 0.614, -0.37), 0.022),
    ((0.136, 0.58, -0.36), 0.028),
    ((0.138, 0.543, -0.364), 0.03),
    ((0.12, 0.508, -0.38), 0.027),
    ((0.092, 0.484, -0.4), 0.023),
    ((0.056, 0.476, -0.424), 0.018),
]

TAIL_ROOT = V(0, 0.425, 0.3)
TAIL_DIR = V(0, -0.24, 1.0) / np.linalg.norm(V(0, -0.24, 1.0))
TAIL_LEN = 0.66
TAIL_BONES = 8
# the brush's radius along its length (t: 0 at the root, 1 the tip)
TAIL_R = [(0.0, 0.03), (0.07, 0.042), (0.22, 0.068), (0.45, 0.086), (0.66, 0.084), (0.82, 0.066), (0.93, 0.04), (1.0, 0.006)]


def tail_r(t):
    ts, rs = zip(*TAIL_R)
    return np.interp(t, ts, rs)


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', HIPS)
    bone('spine', 'hips', SPINE - HIPS)
    bone('chest', 'spine', CHEST - SPINE)
    bone('neck', 'chest', NECK - CHEST)
    bone('head', 'neck', HEAD - NECK)
    bone('jaw', 'head', JAW - HEAD)
    for s, L in SIDES:
        bone('ear' + L, 'head', V(s * EAR[0], EAR[1], EAR[2]) - HEAD)
    prev, at = 'hips', HIPS
    seg = TAIL_LEN / TAIL_BONES
    for i in range(TAIL_BONES):
        p = TAIL_ROOT + TAIL_DIR * seg * i
        bone('tail%d' % i, prev, p - at)
        prev, at = 'tail%d' % i, p
    F, H = FRONT, HIND
    for s, L in SIDES:
        f = {k: V(s * v[0], v[1], v[2]) for k, v in F.items()}
        h = {k: V(s * v[0], v[1], v[2]) for k, v in H.items()}
        bone('arm' + L, 'chest', f['shoulder'] - CHEST)
        bone('fore' + L, 'arm' + L, f['elbow'] - f['shoulder'])
        bone('paw' + L, 'fore' + L, f['wrist'] - f['elbow'])
        bone('thigh' + L, 'hips', h['hip'] - HIPS)
        bone('shin' + L, 'thigh' + L, h['stifle'] - h['hip'])
        bone('meta' + L, 'shin' + L, h['hock'] - h['stifle'])
        bone('foot' + L, 'meta' + L, h['foot'] - h['hock'])


MAT = dict(coat=1, tail=2, ears=3, jaw=4, mouth=5)

# --------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------


def unit(v):
    v = V(*v)
    return v / np.linalg.norm(v)


def frame(a, b, up=(0, 1, 0)):
    """An orthonormal frame along a->b: (axis, side, other)."""
    d = V(*b) - V(*a)
    d /= np.linalg.norm(d)
    u = V(*up) - d * (V(*up) @ d)
    if np.linalg.norm(u) < 1e-6:
        u = V(1, 0, 0) - d * d[0]
    u /= np.linalg.norm(u)
    return d, u, np.cross(d, u)


def tuft(a, b, r0, r1=0.0015):
    """A pointed tuft of fur from a to b."""
    return round_cone(a, b, r0, r1)


def shingles(s, ang, spacing, cols, amp, seed=0.0):
    """Clumps of fur lying along a surface: rows every `spacing` along s
    (toward where the fur lies), staggered in `cols` columns round ang. Each
    clump swells slowly and breaks off in a point, so an outline through
    them is ragged, every point toward the lie of the fur."""
    ca = ang * cols / (2 * math.pi)
    col = np.floor(ca)
    h = np.sin(col * 12.9898 + seed * 78.233) * 43758.5453
    h = h - np.floor(h)
    f = (s / spacing + h * 0.9 + col * 0.37) % 1.0
    rise = np.where(f < 0.82, (f / 0.82) ** 1.5, 1.0 - (f - 0.82) / 0.18)
    across = np.sin(np.pi * (ca - col)) ** 0.7
    k = 0.65 + 0.7 * ((h * 7.31) % 1.0)
    return amp * rise * across * k


# --------------------------------------------------------------------------------
# the coat: body, neck, head and legs as one surface
# --------------------------------------------------------------------------------


def head_prims():
    # a round head and a high, full brow (the kit's look, for all she's
    # grown), the muzzle not too long
    skull = ellipsoid((0, 0.61, -0.423), (0.071, 0.066, 0.075))
    brow = ellipsoid((0, 0.624, -0.457), (0.054, 0.04, 0.043))
    # the muzzle: fine, a touch flat on top, its tip a button of a nose
    muzzle = stroke([(0, 0.590, -0.455), (0, 0.582, -0.512), (0, 0.575, -0.561)], [0.038, 0.026, 0.0142])
    nose = ellipsoid(NOSE, (0.0172, 0.0132, 0.0135))
    cheeks = [ellipsoid((s * 0.05, 0.574, -0.44), (0.043, 0.037, 0.049)) for s, _ in SIDES]
    # the ruff: a fan of pointed tufts flaring out and back off each cheek,
    # from up by the ear (red) round to under the jaw (white), each a
    # triangle of fur; and a cowlick standing up between the ears
    ruff = []
    for s, _ in SIDES:
        for tip, r in RUFF:
            ruff.append(tuft((s * 0.052, 0.565 + (tip[1] - 0.55) * 0.25, -0.438), (s * tip[0], tip[1], tip[2]), r))
    crown = [
        tuft((0, 0.66, -0.43), (0.004, 0.712, -0.452), 0.017),
        tuft((0, 0.66, -0.415), (-0.012, 0.703, -0.402), 0.014),
    ]
    return skull, brow, muzzle, nose, cheeks, ruff + crown


def neck_prims():
    neck = round_cone((0, 0.43, -0.25), (0, 0.565, -0.385), 0.088, 0.062)
    # the ruff down the throat, ending in points on the chest
    bib = ellipsoid((0, 0.445, -0.335), (0.074, 0.105, 0.064), rot_x(0.5))
    # a full, fluffy ruff, ending in points on the chest
    points = [tuft((x, 0.41, -0.36), (x * 1.3, 0.3 + abs(x) * 0.5, -0.34 + abs(x) * 0.2), 0.03 - abs(x) * 0.1) for x in (-0.05, -0.025, 0.0, 0.025, 0.05)]
    points += [tuft((s * 0.058, 0.475, -0.325), (s * 0.094, 0.395, -0.29), 0.026) for s, _ in SIDES]
    return neck, bib, points


def torso_prims():
    chest = ellipsoid((0, 0.375, -0.165), (0.088, 0.115, 0.15))
    keel = ellipsoid((0, 0.315, -0.17), (0.06, 0.07, 0.11))
    waist = ellipsoid((0, 0.395, 0.03), (0.07, 0.075, 0.13))
    hips = ellipsoid((0, 0.4, 0.19), (0.078, 0.088, 0.115))
    rump = ellipsoid((0, 0.415, 0.27), (0.06, 0.06, 0.05))
    return chest, keel, waist, hips, rump


def front_leg(s):
    F = {k: V(s * v[0], v[1], v[2]) for k, v in FRONT.items()}
    sh, el, wr, to = F['shoulder'], F['elbow'], F['wrist'], F['toe']
    upper = round_cone(sh + V(0, 0.03, -0.005), el, 0.05, 0.031)
    elbow = ellipsoid(el + V(0, 0.004, 0.01), (0.026, 0.03, 0.026))
    fore = round_cone(el, wr, 0.028, 0.0175)
    # feathering down the back of the forearm
    feather = tuft(el + V(0, -0.01, 0.022), el + V(s * 0.004, -0.09, 0.045), 0.016)
    paw = ellipsoid((s * 0.056, 0.024, -0.205), (0.023, 0.02, 0.033))
    toes = ellipsoid((s * 0.056, 0.016, -0.226), (0.021, 0.014, 0.018))
    return upper, elbow, fore, feather, paw, toes, F


def hind_leg(s):
    H = {k: V(s * v[0], v[1], v[2]) for k, v in HIND.items()}
    hp, st, hk, ft = H['hip'], H['stifle'], H['hock'], H['foot']
    haunch = ellipsoid(hp + V(0, -0.035, -0.005), (0.055, 0.085, 0.085), rot_x(-0.45))
    thigh = round_cone(hp, st, 0.05, 0.034)
    # the breeches: fur feathered off the back of the thigh
    breech = tuft(hp + V(s * 0.01, -0.06, 0.06), hp + V(s * 0.016, -0.15, 0.11), 0.028)
    shin = round_cone(st, hk, 0.03, 0.019)
    hock = ellipsoid(hk + V(0, 0.004, 0.006), (0.017, 0.022, 0.018))
    cannon = round_cone(hk, ft + V(0, 0.01, 0), 0.0175, 0.016)
    paw = ellipsoid((s * 0.064, 0.024, 0.222), (0.023, 0.02, 0.034))
    toes = ellipsoid((s * 0.064, 0.016, 0.2), (0.021, 0.014, 0.018))
    return haunch, thigh, breech, shin, hock, cannon, paw, toes, H


def g_coat():
    skull, brow, muzzle, nose, cheeks, ruff = head_prims()
    neck, bib, points = neck_prims()
    chest, keel, waist, hips, rump = torso_prims()
    fronts = [front_leg(s) for s, _ in SIDES]
    hinds = [hind_leg(s) for s, _ in SIDES]

    def head_field(p):
        d = smin(skull(p), brow(p), 0.03)
        d = smin(d, muzzle(p), 0.035)
        for c in cheeks:
            d = smin(d, c(p), 0.03)
        d = smin(d, nose(p), 0.006)
        for r in ruff:
            d = smin(d, r(p), 0.014)
        return d

    def field(p):
        d = smin(smin(chest(p), keel(p), 0.05), waist(p), 0.08)
        d = smin(d, hips(p), 0.07)
        d = smin(d, rump(p), 0.04)
        d = smin(d, neck(p), 0.06)
        d = smin(d, bib(p), 0.04)
        for q in points:
            d = smin(d, q(p), 0.016)
        d = smin(d, head_field(p), 0.035)
        for upper, elbow, fore, feather, paw, toes, _ in fronts:
            leg = smin(smin(upper(p), elbow(p), 0.02), fore(p), 0.02)
            leg = smin(leg, feather(p), 0.012)
            leg = smin(leg, smin(paw(p), toes(p), 0.012), 0.022)
            d = smin(d, leg, 0.045)
        for haunch, thigh, breech, shin, hock, cannon, paw, toes, _ in hinds:
            leg = smin(haunch(p), thigh(p), 0.04)
            leg = smin(leg, breech(p), 0.02)
            low = smin(smin(shin(p), hock(p), 0.012), cannon(p), 0.014)
            low = smin(low, smin(paw(p), toes(p), 0.012), 0.022)
            leg = smin(leg, low, 0.03)
            d = smin(d, leg, 0.06)
        return d

    head = rigid('head')
    neckW = by_axis(NECK, unit(HEAD - NECK), [(0.0, 'chest'), (0.04, 'neck'), (0.12, 'neck'), (0.17, 'head')])
    body = along(lambda p: p[:, 2], [(-0.2, 'chest'), (-0.06, 'spine'), (0.08, 'spine'), (0.17, 'hips')])
    owners = [(chest, body), (keel, body), (waist, body), (hips, body), (rump, rigid('hips')), (neck, neckW), (bib, neckW)]
    owners += [(q, neckW) for q in points]
    owners += [(q, head) for q in (skull, brow, muzzle, nose)] + [(c, head) for c in cheeks] + [(r, head) for r in ruff]
    region = []  # owner index ranges: legs (for the stockings)
    for (upper, elbow, fore, feather, paw, toes, F), (s, L) in zip(fronts, SIDES):
        sh, el, wr = F['shoulder'], F['elbow'], F['wrist']
        wu = by_axis(sh, unit(el - sh), [(-0.03, 'chest'), (0.02, 'arm' + L), (0.1, 'arm' + L), (0.14, 'fore' + L)])
        wf = by_axis(el, unit(wr - el), [(-0.01, 'arm' + L), (0.025, 'fore' + L), (0.14, 'fore' + L), (0.168, 'paw' + L)])
        i0 = len(owners)
        owners += [(upper, wu), (elbow, wu), (fore, wf), (feather, wf), (paw, rigid('paw' + L)), (toes, rigid('paw' + L))]
        region.append(('front', s, i0, len(owners)))
    for (haunch, thigh, breech, shin, hock, cannon, paw, toes, H), (s, L) in zip(hinds, SIDES):
        hp, st, hk = H['hip'], H['stifle'], H['hock']
        wt = by_axis(hp, unit(st - hp), [(-0.03, 'hips'), (0.025, 'thigh' + L), (0.11, 'thigh' + L), (0.16, 'shin' + L)])
        ws = by_axis(st, unit(hk - st), [(-0.01, 'thigh' + L), (0.025, 'shin' + L), (0.15, 'shin' + L), (0.18, 'meta' + L)])
        wc = by_axis(hk, unit(V(0, -1, -0.25)), [(-0.005, 'shin' + L), (0.012, 'meta' + L), (0.08, 'meta' + L), (0.1, 'foot' + L)])
        haunchW = by_y([(0.28, 'thigh' + L), (0.37, 'hips')])
        i0 = len(owners)
        owners += [(haunch, haunchW), (thigh, wt), (breech, wt), (shin, ws), (hock, wc), (cannon, wc), (paw, rigid('foot' + L)), (toes, rigid('foot' + L))]
        region.append(('hind', s, i0, len(owners)))

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0] = white_coat(p, n)
        # the stockings: dark from the elbow and the hock down, darkest at
        # the paws; the front of the hind shin too
        dark = np.zeros(len(p))
        for kind, s, i0, i1 in region:
            w = own[:, i0:i1].sum(1)
            if kind == 'front':
                k = smooth(0.25, 0.1, p[:, 1])
            else:
                k = np.maximum(smooth(0.2, 0.1, p[:, 1]), smooth(0.24, 0.17, p[:, 1]) * smooth(0.21, 0.17, p[:, 2]) * 0.6)
            dark = np.maximum(dark, w * k)
        out[:, 1] = dark
        out[:, 2] = -1.0
        out[:, 3] = fur_coat(p, n, dark)
        return out

    def mats(p, n, own):
        # the roof of the mouth: hidden by the jaw until it opens
        m = np.full(len(p), MAT['coat'])
        m[jaw_field(p) < 0.0015] = MAT['mouth']
        return m

    return Garment('coat', MAT['coat'], 0.0042, (-0.15, 0.0, -0.62), (0.15, 0.7, 0.36), field, owners, 9000, tau=0.01, details=details, mats=mats)


def white_coat(p, n):
    """Signed: how far inside the white a point lies (m). The white runs from
    the lips and cheeks (below a line from beside the nose back under the eye
    to the ruff) down the throat to the chest between the forelegs, and lies
    pale along the belly."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    # below the line along the side of the face
    line = np.interp(z, [-0.6, -0.56, -0.5, -0.45, -0.4, -0.36], [0.566, 0.57, 0.579, 0.581, 0.571, 0.545])
    face = (line - y) * np.where(z < -0.355, 1.0, 0.0) - np.maximum(0, z + 0.355) * 4
    # the throat and the bib, in front of a sloping line down the neck
    q = (p - V(0, 0.46, -0.38)) @ rot_x(0.5)
    bib = -(np.sqrt((q[:, 0] / 0.06) ** 2 + (q[:, 1] / 0.16) ** 2 + (q[:, 2] / 0.11) ** 2) - 1.0) * 0.06
    # the belly, pale underneath
    belly = np.minimum((0.29 - y) * np.where(np.abs(z + 0.02) < 0.2, 1.0, 0.0) - np.maximum(0, np.abs(z + 0.02) - 0.2), 0.045 - np.abs(x))
    # not the nose
    nose = np.sqrt((x / 1.0) ** 2 + (y - NOSE[1]) ** 2 + (z - NOSE[2]) ** 2) - 0.022
    return np.minimum(np.maximum(np.maximum(face, bib), belly * 0.5), nose)


def fur_coat(p, n, dark):
    """How long the fur grows: short on the face and the stockings, longer on
    the back, longest in the ruffs; none round the eyes and the nose."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    f = np.full(len(p), 0.011)
    head = smooth(-0.37, -0.42, z) * smooth(0.5, 0.54, y)
    f = f * (1 - head) + 0.005 * head
    muzzle = smooth(-0.47, -0.52, z) * head
    f = f * (1 - muzzle) + 0.002 * muzzle
    # the ruffs: cheeks and throat
    cheek = smooth(0.045, 0.08, np.abs(x)) * smooth(-0.46, -0.41, z) * smooth(-0.33, -0.37, z) * smooth(0.46, 0.5, y)
    throat = smooth(-0.26, -0.32, z) * smooth(0.5, 0.4, y) * smooth(0.28, 0.33, y)
    f = np.maximum(f, 0.022 * cheek + 0.0)
    # the cowlick
    crown = smooth(0.66, 0.69, y) * smooth(0.03, 0.01, np.abs(x)) * smooth(-0.47, -0.45, z)
    f = np.maximum(f, 0.012 * crown)
    f = np.maximum(f, 0.019 * throat)
    # breeches on the backs of the thighs
    f = np.maximum(f, 0.016 * smooth(0.2, 0.26, z) * smooth(0.18, 0.26, y) * smooth(0.42, 0.36, y))
    f = f * (1 - 0.75 * np.clip(dark, 0, 1))
    # bare round the eyes and on the nose
    for s in (-1, 1):
        e = np.sqrt((x - s * 0.035) ** 2 + (y - 0.613) ** 2 + (z + 0.47) ** 2)
        f *= smooth(0.012, 0.028, e)
    nose = np.sqrt(x ** 2 + (y - NOSE[1]) ** 2 + (z - NOSE[2]) ** 2)
    f *= smooth(0.018, 0.03, nose)
    return f


# --------------------------------------------------------------------------------
# the jaw, the ears, the tail
# --------------------------------------------------------------------------------


def jaw_prims():
    # slim, and tucked up under the muzzle: only its underside shows
    jaw = stroke([(0, 0.543, -0.448), (0, 0.548, -0.5), (0, 0.556, -0.537)], [0.024, 0.0148, 0.0072])
    chin = ellipsoid((0, 0.543, -0.463), (0.016, 0.012, 0.028))
    return jaw, chin


def jaw_field(p):
    jaw, chin = jaw_prims()
    return smin(jaw(p), chin(p), 0.015)


def g_jaw():
    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0] = 0.02  # white all over
        out[:, 2] = -1.0
        out[:, 3] = 0.004 * smooth(-0.52, -0.47, p[:, 2]) * smooth(0.0, -0.4, n[:, 1])
        return out

    def mats(p, n, own):
        # its top, inside the mouth: hidden in the muzzle until it opens
        skull, brow, muzzle, nose, cheeks, ruff = head_prims()
        m = np.full(len(p), MAT['jaw'])
        m[(muzzle(p) < 0.0005) & (n[:, 1] > 0.2)] = MAT['mouth']
        return m

    jaw, chin = jaw_prims()
    return Garment('jaw', MAT['jaw'], 0.0022, (-0.05, 0.5, -0.58), (0.05, 0.585, -0.4), jaw_field, [(jaw, rigid('jaw')), (chin, rigid('jaw'))], 700, details=details, mats=mats, outline=0.04)


def tri_iso(px, py, qx, qy):
    """Signed distance to an isosceles triangle, apex at the origin and its
    base at y = qy (half-width qx) (Inigo Quilez)."""
    px = np.abs(px)
    t = clamp((px * qx + py * qy) / (qx * qx + qy * qy), 0.0, 1.0)
    ax, ay = px - qx * t, py - qy * t
    u = clamp(px / qx, 0.0, 1.0)
    bx, by = px - qx * u, py - qy
    s = -np.sign(qy)
    d0 = np.minimum(ax * ax + ay * ay, bx * bx + by * by)
    d1 = np.minimum(s * (px * qy - py * qx), s * (py - qy))
    return -np.sqrt(d0) * np.sign(d1)


def ear_frame(s):
    base = V(s * EAR[0], EAR[1], EAR[2])
    tip = V(s * EAR_TIP[0], EAR_TIP[1], EAR_TIP[2])
    up = tip - base
    L = np.linalg.norm(up)
    up /= L
    front = V(s * 0.42, 0.1, -1.0)
    front -= up * (front @ up)
    front /= np.linalg.norm(front)
    across = np.cross(up, front)
    return base, up, front, across, L


# the white tufts in each ear: from how far up the hollow (m), to how far up,
# how far across toward the inner edge, how far out in front, and how thick
EAR_TUFTS = [
    (0.012, 0.072, -0.016, 0.018, 0.0085),
    (0.016, 0.06, 0.004, 0.02, 0.009),
    (0.01, 0.048, 0.02, 0.016, 0.0075),
]


def ear_field(s):
    base, up, front, across, L = ear_frame(s)
    half = 0.039
    tufts = [tuft(base + up * u0 + front * 0.002, base + up * u1 + across * (v1 * s) + front * w1, r) for u0, u1, v1, w1, r in EAR_TUFTS]

    def fn(p):
        q = p - base
        u, v, w = q @ up, q @ across, q @ front
        # cupped: the ear curves round toward the front
        w = w - 0.11 * v * v / half
        t = clamp(u / L, 0.0, 1.0)
        thick = 0.0058 - 0.0035 * t
        tip_r = 0.005
        d2 = tri_iso(v, (L - tip_r * 1.6) - u, half - tip_r, L - tip_r * 1.6 + 0.04) - tip_r
        outer = np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(np.abs(w) - thick, 0) ** 2) + np.minimum(np.maximum(d2, np.abs(w) - thick), 0)
        # the hollow in front, a rim left round it
        d3 = tri_iso(v, (L * 0.86) - u, half * 0.66, L * 0.86 + 0.02)
        hollow = np.maximum(d3, -(w - 0.0016))
        d = smax(outer, -hollow, 0.003)
        # tufts of white fur standing out of the hollow, fanned up and out
        for t in tufts:
            d = smin(d, t.fn(p), 0.004)
        return d

    lo = base - 0.15
    hi = base + 0.15
    return Prim(fn, lo, hi)


def g_ears():
    ears = [(ear_field(s), s, L) for s, L in SIDES]

    def field(p):
        return np.minimum(ears[0][0](p), ears[1][0](p))

    owners = [(e, rigid('ear' + L)) for e, s, L in ears]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        inner = np.zeros(len(p))
        dark = np.zeros(len(p))
        for i, (e, s, L) in enumerate(ears):
            base, up, front, across, Ln = ear_frame(s)
            q = p - base
            u, v = q @ up, q @ across
            # the inside is cream, its rim and the back black
            facing = n @ front
            d3 = -tri_iso(v, (Ln * 0.9) - u, 0.039 * 0.72, Ln * 0.9 + 0.025)
            # (out in front of the hollow: the tufts, white all round)
            tufts = (q @ front) - 0.006
            inner += own[:, i] * np.maximum(np.where(facing > -0.1, d3, -0.01), np.where(u < Ln * 0.8, tufts, -0.01))
            dark += own[:, i] * (smooth(0.1, -0.35, facing) * 0.95 + smooth(0.6, 0.92, u / Ln) * 0.6)
        out[:, 0] = inner
        out[:, 1] = np.clip(dark, 0, 1)
        out[:, 2] = -1.0
        out[:, 3] = np.where(inner > 0, 0.012 * smooth(0.0, 0.006, inner), 0.003)
        return out

    lo = (-0.13, 0.56, -0.48)
    hi = (0.13, 0.82, -0.33)
    return Garment('ears', MAT['ears'], 0.0018, lo, hi, field, owners, 1600, tau=0.004, details=details, outline=0.8)


def tail_coords(p):
    q = p - TAIL_ROOT
    s = q @ TAIL_DIR
    r = q - np.outer(s, TAIL_DIR)
    side = np.cross(TAIL_DIR, V(0, 1, 0))
    side /= np.linalg.norm(side)
    upv = np.cross(side, TAIL_DIR)
    ang = np.arctan2(r @ side, r @ upv)
    return s, np.sqrt(dot(r, r)), ang


def g_tail():
    n = 14
    pts = [TAIL_ROOT + TAIL_DIR * (TAIL_LEN * i / n) for i in range(n + 1)]
    radii = [float(tail_r(i / n)) for i in range(n + 1)]
    core = stroke(pts, radii)
    root = ellipsoid(TAIL_ROOT + TAIL_DIR * 0.01, (0.034, 0.036, 0.04))

    def fn(p):
        d = smin(core.fn(p), root.fn(p), 0.02)
        s, rho, ang = tail_coords(p)
        t = clamp(s / TAIL_LEN, 0, 1)
        # clumped all over in shingles lying toward the tip; deeper where the
        # brush is fullest, and the very tip drawn out into points
        amp = 0.016 * tail_r(t) / 0.086 * smooth(0.02, 0.12, t)
        sh = shingles(s, ang, 0.042, 9, amp, 1.0) + shingles(s + 0.021, ang + 0.35, 0.042, 9, amp * 0.6, 2.0)
        return d - sh

    lo = TAIL_ROOT + V(-0.15, -0.3, -0.06)
    hi = TAIL_ROOT + V(0.15, 0.12, 0.72)
    tail = Prim(fn, lo, hi)
    seg = TAIL_LEN / TAIL_BONES
    ctrl = [(seg * i + seg * 0.5, 'tail%d' % i) for i in range(TAIL_BONES)]
    ctrl = [(-0.02, 'hips'), (0.012, 'tail0')] + ctrl[1:]
    w = by_axis(TAIL_ROOT, TAIL_DIR, ctrl)

    def details(p, n_, own):
        s, rho, ang = tail_coords(p)
        out = np.zeros((len(p), 4))
        t = clamp(s / TAIL_LEN, 0, 1)
        out[:, 0] = (t - 0.84) * 0.6  # the white tip
        out[:, 1] = 0.0
        out[:, 2] = t
        out[:, 3] = 0.012 + 0.03 * smooth(0.0, 0.35, t) * (1 - 0.4 * smooth(0.85, 1.0, t))
        return out

    return Garment('tail', MAT['tail'], 0.0042, lo, hi, tail, [(tail, w)], 4200, tau=0.01, details=details)


# --------------------------------------------------------------------------------


def build():
    t0 = time.time()
    build_rig()
    garments = [g_coat(), g_jaw(), g_ears(), g_tail()]
    J = {b['name']: [round(float(x), 5) for x in b['world'][:3, 3]] for b in B.BONES}
    r5 = lambda v: [round(float(x), 5) for x in v]
    rig = dict(
        joints=J,
        front=dict((k, r5(v)) for k, v in FRONT.items()),
        hind=dict((k, r5(v)) for k, v in HIND.items()),
        tail=dict(root=r5(TAIL_ROOT), dir=r5(TAIL_DIR), length=TAIL_LEN, bones=TAIL_BONES, radius=[[a, b] for a, b in TAIL_R]),
        ear=dict(base=list(EAR), tip=list(EAR_TIP)),
        jaw=r5(JAW),
        # the face, for the shader: each eye's centre (right side), the nose
        eye=[0.035, 0.613, -0.47],
        nose=list(NOSE),
    )
    B.export(garments, OUT, MAT, rig, 'fox', 'fox.py')
    print(f'fox: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
