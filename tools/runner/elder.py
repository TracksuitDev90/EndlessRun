#!/usr/bin/env python3
"""Sculpt the elder and write assets/elder/runner.json + runner.bin.

The third runner, sculpted the same way as the wayfarer and the explorer
(build.py: every garment one signed-distance field of volumes blended smoothly
into each other, polygonised, skinned by which volume owns each point,
linework drawn by the game's character shader), to his reference sheet
(tools/characters/elder-sheet.jpg): an incredibly old man, the tallest of the
runners - about two metres stood up straight, though he never is: he goes
bent at the waist. Rail thin but for a round pot belly; a long, weathered,
sun-tanned face with a long hooked nose and big ears that stand out from his
head; short, wispy white hair round the back and sides of a bald crown, flying
up in wisps; bushy white brows; large orange glasses; a drooping moustache
running into an incredibly long white beard (all but its roots is simulated in
the game - src/game/elder.js - so that it streams and swings round him); a
flowing teal robe, open down the front over a sea-green under-robe, its hood
down on his back, wide bell sleeves, a brown sash knotted under his belly (the
robe's skirt is simulated too); brown leggings and old soft boots with turned
cuffs; and his long, twisted walking stick, gripped in his right hand.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/elder.py

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

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'elder')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# rig: the game's skeleton (the bones the game drives are named as the other
# runners'), proportioned to his sheet: about two metres to the crown stood
# up straight, eight heads tall, long in the leg (the hip joints just over
# half his height) and long in the arm. He is sculpted upright; the game
# bends him at the waist.
# --------------------------------------------------------------------------------

HIP_Y = 1.04
HIP_JOINT = (0.074, 1.01)
THIGH = 0.47
SHIN = 0.462
TOE = (0.06, 0.13)
CHEST_Y = 1.36
SHOULDER = (0.158, 1.6)
UPPER_ARM = 0.325
FOREARM = 0.3
ARM_REST = 0.3
NECK_Y = 1.6
HEAD_Y = 1.74
KNEE_Y = HIP_JOINT[1] - THIGH

# the head: cranium (centre, radii)
CRAN = ((0, 1.888, 0.012), (0.096, 0.108, 0.108))
# the robe's skirt is simulated from just under the sash; the sculpted robe
# stops there
SASH_Y = 1.03
SKIRT_TOP = 1.005
# the walking stick, in its own frame (the tip on the ground at the origin,
# the shaft up +y): how long it is and where he grips it
STAFF = dict(length=1.15, grip=1.01, r0=0.016, r1=0.021)

# springy bits on the head: [bone, pivot (body space), and how they swing in
# the game (stiffness Hz, damping, push, limit)]
HAIR_BONES = [
    ('wispT', (0.0, 1.97, 0.02), dict(f=2.2, z=0.12, k=1.8, lim=0.6)),
    ('wispL', (-0.085, 1.9, 0.045), dict(f=2.6, z=0.14, k=1.5, lim=0.5)),
    ('wispR', (0.085, 1.9, 0.045), dict(f=2.6, z=0.14, k=1.5, lim=0.5)),
    ('browL', (-0.03, 1.893, -0.088), dict(f=3.4, z=0.18, k=0.8, lim=0.3)),
    ('browR', (0.03, 1.893, -0.088), dict(f=3.4, z=0.18, k=0.8, lim=0.3)),
]

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


FW = V(0, 0, -1)


def grip_frame():
    """The right fist round the stick: where the shaft passes through it and
    which way (the knob end toward the thumb, which points forward with the
    arm hanging)."""
    S, E, W, dn, out = arm_frame(1)
    A = W + 0.058 * dn + 0.004 * out
    return A, FW


def staff_bind():
    """The stick as bound: its frame (rotation local -> body, the tip's
    position). Bound through the fist, it lies along it, the knob forward."""
    A, up = grip_frame()
    R = rot_x(-math.pi / 2)  # local +y -> body -z
    tip = A - STAFF['grip'] * up
    return R, tip


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.1, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.1, 0))
    bone('neck', 'chest', (0, NECK_Y - CHEST_Y, 0))
    bone('head', 'neck', (0, HEAD_Y - NECK_Y, 0))
    for name, piv, _ in HAIR_BONES:
        bone(name, 'head', V(*piv) - V(0, HEAD_Y, 0))
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.05, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.05), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        # the bell of the sleeve hangs from here, swinging on a spring
        bone('cuff' + L, 'fore' + L, (0, -0.1, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))
    bone('sim', None, (0, 0, 0))
    R, tip = staff_bind()
    bone('staff', 'sim', tip, (1, 0, 0), -math.pi / 2)


MAT = dict(face=1, hair=2, robe=3, under=4, legs=5, sash=6, boot=7, hand=8, hood=9, skirt=10, staff=11, glasses=12, beard=13)


def placed(prim, R, t):
    """A volume sculpted in its own frame, placed by rotation R (local ->
    body) and translation t."""
    t = V(*t)

    def fn(p):
        return prim.fn((p - t) @ R)

    corners = np.array([[x, y, z] for x in (prim.lo[0], prim.hi[0]) for y in (prim.lo[1], prim.hi[1]) for z in (prim.lo[2], prim.hi[2])])
    w = corners @ R.T + t
    return Prim(fn, w.min(0), w.max(0))


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


def union(prims):
    lo = np.min([q.lo for q in prims], axis=0)
    hi = np.max([q.hi for q in prims], axis=0)

    def fn(p):
        return np.min([q.fn(p) for q in prims], axis=0)

    return Prim(fn, lo, hi)


# --------------------------------------------------------------------------------
# head, hair, beard and glasses
# --------------------------------------------------------------------------------


def head_prims():
    # long and lean: a high domed cranium over a long face, the cheeks hollow
    # under bony cheekbones, a heavy brow, a long jaw (the beard hides most
    # of it)
    cran = ellipsoid(*CRAN)
    face = ellipsoid((0, 1.832, -0.026), (0.079, 0.088, 0.08))
    cheeks = [ellipsoid((s * 0.057, 1.84, -0.05), (0.034, 0.026, 0.034)) for s, _ in SIDES]
    brow = ellipsoid((0, 1.884, -0.07), (0.076, 0.02, 0.034))
    jaw = ellipsoid((0, 1.782, -0.018), (0.068, 0.048, 0.07))
    chin = ellipsoid((0, 1.758, -0.058), (0.032, 0.028, 0.03))
    return cran, face, cheeks, brow, jaw, chin


def skull(p):
    cran, face, cheeks, brow, jaw, chin = head_prims()
    d = smin(cran(p), face(p), 0.05)
    for c in cheeks:
        d = smin(d, c(p), 0.025)
    d = smin(d, brow(p), 0.03)
    d = smin(d, jaw(p), 0.04)
    return smin(d, chin(p), 0.03)


def ear_prims(s):
    R = rot_y(s * 0.82) @ rot_z(-s * 0.16)
    c = V(s * 0.112, 1.862, 0.022)
    shell = ellipsoid(c, (0.013, 0.058, 0.038), R)
    lobe = ellipsoid(c + V(s * 0.006, -0.05, -0.006), (0.011, 0.022, 0.021), R)
    # the bowl of the ear, hollowed out of its front
    n = R @ V(0, 0, -1)
    bowl = ellipsoid(c + 0.011 * n + V(s * 0.004, 0.004, 0), (0.008, 0.04, 0.024), R)
    return shell, lobe, bowl


def g_head():
    cran, face, cheeks, brow, jaw, chin = head_prims()
    # the nose: long and hooked - a hump on the bridge, a heavy drooping tip
    # hooking down over the moustache, flared wings
    nose = stroke([V(0, 1.876, -0.096), V(0, 1.852, -0.132), V(0, 1.82, -0.16), V(0, 1.8, -0.155)], [0.011, 0.0145, 0.019, 0.013])
    wings = [ellipsoid((s * 0.017, 1.807, -0.132), (0.016, 0.013, 0.017)) for s, _ in SIDES]
    ears = [ear_prims(s) for s, _ in SIDES]
    # a long, thin neck rising out of the robe's collar
    neck = round_cone((0, 1.56, 0.022), (0, 1.79, 0.008), 0.041, 0.039)

    def field(p):
        d = skull(p)
        d = smin(d, nose(p), 0.014)
        for w in wings:
            d = smin(d, w(p), 0.01)
        for shell, lobe, bowl in ears:
            e = smin(shell(p), lobe(p), 0.01)
            e = smax(e, -bowl(p), 0.004)
            d = smin(d, e, 0.009)
        return smin(d, neck(p), 0.03)

    head = rigid('head')
    owners = [(cran, head), (face, head), (brow, head), (jaw, head), (chin, head), (nose, head)] + [(c, head) for c in cheeks] + [(w, head) for w in wings]
    owners += [(q, head) for e in ears for q in e[:2]]
    owners.append((neck, by_y([(1.62, 'chest'), (1.68, 'neck'), (1.76, 'head')])))

    def details(p, n, own):
        # w: on an ear
        ear = own[:, 10:14].sum(1)
        return np.concatenate([p, ear[:, None]], 1)

    return Garment('head', MAT['face'], 0.0022, (-0.17, 1.48, -0.19), (0.17, 2.03, 0.16), field, owners, 2900, details=details)


def on_cran(theta, elev, lift=0.0):
    """A point on the cranium at azimuth theta (0 = front, + toward his
    right) and elevation elev, lifted off it along its normal."""
    c, r = V(*CRAN[0]), V(*CRAN[1])
    u = V(math.sin(theta) * math.cos(elev), math.sin(elev), -math.cos(theta) * math.cos(elev))
    p0 = c + r * u
    n = u / r ** 2
    n /= np.linalg.norm(n)
    return p0 + n * lift, n


def wisp(pts, r0):
    k = len(pts)
    radii = [r0 * (1.0 - 0.8 * i / (k - 1)) for i in range(k)]
    radii[-1] = r0 * 0.1
    return stroke([V(*q) for q in pts], radii)


def g_hair():
    """Short, wispy white hair: a thin fringe of it round the back and sides
    of a bald crown, from over the ears to the nape, combed back and flying
    up and out in wisps; a few strands across the top; bushy white brows
    springing up and out over his glasses; the moustache."""

    def cap(p):
        return skull(p) - 0.006

    # where it grows: round the back and sides, from the temples above the
    # ears; none on the crown or the face
    def grows(p):
        th = np.abs(np.arctan2(p[:, 0], -(p[:, 2] - 0.012)))
        top = np.interp(th, [0, 1.1, 1.35, 1.6, 2.2, math.pi], [1.8, 1.8, 1.905, 1.93, 1.94, 1.935])
        bot = np.interp(th, [0, 1.15, 1.3, 1.5, 2.2, math.pi], [9, 9, 1.88, 1.87, 1.8, 1.79])
        return np.maximum(p[:, 1] - top, bot - p[:, 1])

    base = Prim(lambda p: smax(cap(p), grows(p), 0.008), (-0.13, 1.74, -0.06), (0.13, 1.97, 0.14))
    rnd = np.random.default_rng(23)
    side, top, brows = [], [], []
    # locks round the sides and back: rooted above and behind the ears and
    # round the back of the head, combed back and down over the skull and
    # falling past it to the nape, their ends wisping out and away (none
    # over the ears: they stand out clear of it)
    for row, (el, ln, th0) in enumerate([(0.42, 0.11, 1.32), (0.16, 0.09, 1.95)]):
        for th in np.linspace(th0, math.pi, 6 - row):
            for s in (-1, 1):
                if th > 3.1 and s > 0:
                    continue
                t = s * (th + rnd.uniform(-0.06, 0.06))
                e = el + rnd.uniform(-0.04, 0.04)
                L = ln + rnd.uniform(-0.015, 0.015)
                # (combed back: the further forward it grows, the more it sweeps round)
                sweep = s * 0.5 * smooth(2.3, 1.4, th)
                a, n = on_cran(t, e, 0.003)
                b, n1 = on_cran(t + sweep, e - 0.3 - 0.15 * smooth(1.9, 2.5, th), 0.01)
                out = V(math.sin(t + sweep), 0, -math.cos(t + sweep))
                c = b + V(0, -L * 0.4 * smooth(1.6, 2.3, th), 0) + out * 0.01 + n1 * 0.005
                tip = c + V(0, -L * 0.22, 0.01) + out * (0.022 + rnd.uniform(0, 0.016)) + V(0, rnd.uniform(-0.006, 0.012), 0)
                side.append(wisp([a, b, c, tip], 0.0135 + rnd.uniform(0, 0.003)))
    # a couple of flyaway wisps standing out over the ears
    for t, el in [(-1.75, 0.5), (1.8, 0.47)]:
        a, n = on_cran(t, el, 0.002)
        out = V(math.sin(t), 0, -math.cos(t))
        b = a + n * 0.02 + V(0, 0.004, 0.006)
        c = b + out * 0.03 + V(0, 0.006, 0.014)
        side.append(wisp([a, b, c], 0.0065))
    # a few long strands across the bald top, lifting at their ends
    for x0, z0, ln in [(-0.022, 0.035, 0.07), (0.014, 0.015, 0.06), (0.002, 0.065, 0.08)]:
        a = V(x0, 1.988, z0)
        b = a + V(x0 * 0.4, 0.008, -0.025)
        c = b + V(x0 * 0.6 + 0.008, 0.012, -ln * 0.45)
        top.append(wisp([a, b, c], 0.005))
    # brows: bushy, sprouting from over the inner corner of the eye and
    # springing up and out past the frames, in a few tufts
    for s, L in SIDES:
        tufts = []
        for k, (x0, y0, x1, y1) in enumerate([(0.018, 1.888, 0.06, 1.9), (0.032, 1.892, 0.083, 1.912), (0.046, 1.889, 0.098, 1.906)]):
            a = V(s * x0, y0, -0.094 + 0.012 * k)
            b = V(s * (x0 + x1) / 2, (y0 + y1) / 2 + 0.006, -0.1 + 0.014 * k)
            c = V(s * x1, y1 + 0.004 * k, -0.088 + 0.016 * k)
            tufts.append(wisp([a, b, c], 0.0105 - 0.001 * k))
        brows.append(tufts)

    def field(p):
        d = base(p)
        for q in side + top:
            d = smin(d, q(p), 0.006)
        for tufts in brows:
            for q in tufts:
                d = smin(d, q(p), 0.004)
        return d

    head = rigid('head')
    owners = [(base, head)]
    owners += [(q, along(lambda p: p[:, 0], [(-0.07, 'wispL'), (-0.03, 'head'), (0.03, 'head'), (0.07, 'wispR')])) for q in side]
    owners += [(q, rigid('wispT')) for q in top]
    for tufts, (s, L) in zip(brows, SIDES):
        owners += [(q, rigid('brow' + L)) for q in tufts]

    def details(p, n, own):
        # x: on a lock (strands are drawn along them); y: on a brow
        nb = len(brows[0]) + len(brows[1])
        return np.stack([1 - own[:, 0], own[:, -nb:].sum(1), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('hair', MAT['hair'], 0.0022, (-0.2, 1.7, -0.16), (0.2, 2.1, 0.2), field, owners, 3000, tau=0.006, details=details)


# The beard: sculpted, only what sits still on the face - the hair over the
# jaw and cheeks, up to the sideburns, and the drooping moustache; the long
# beard hangs from under it (simulated: src/game/elder.js), its roots pinned
# along this line under the jaw (head space, by angle round from the chin).
BEARD = dict(c=(0.0, 1.792, -0.024), rx=0.088, rz=0.05, y0=1.742, y1=1.8, reach=1.36, cols=11)


def beard_root(u):
    """Where the long beard's column u (-1 at his right jaw .. 1 at his left,
    0 under the chin) is rooted, inside the sculpted beard."""
    th = u * BEARD['reach']
    c = V(*BEARD['c'])
    y = BEARD['y0'] + (BEARD['y1'] - BEARD['y0']) * abs(u) ** 1.6
    return V(c[0] + math.sin(th) * BEARD['rx'], y, c[2] - math.cos(th) * BEARD['rz'])


def g_beard():
    """The hair of the beard where it grows on his face, big and bushy: over
    the jaw and the chin and well out from them, up the cheeks under the
    cheekbones to the sideburns, full jowls of it either side, its surface
    broken into tufts; and the moustache drooping from under his nose over his
    mouth and down into it."""

    def growth(p):
        th = np.abs(np.arctan2(p[:, 0], -(p[:, 2] + 0.01)))
        top = np.interp(th, [0, 0.25, 0.55, 0.95, 1.25, 1.42, 1.6], [1.787, 1.792, 1.815, 1.834, 1.866, 1.89, 1.89])
        return np.maximum(p[:, 1] - top, (th - 1.5) * 0.1)

    # (thicker the lower it grows: it stands well out from the jaw and chin)
    thick = lambda p: 0.011 + 0.04 * smooth(1.84, 1.74, p[:, 1])
    mass = Prim(lambda p: smax(skull(p) - thick(p), growth(p), 0.012), (-0.15, 1.64, -0.17), (0.15, 1.92, 0.1))
    # it fills right out under the chin, where the long beard hangs from, and
    # in jowls either side
    chinful = ellipsoid((0, 1.742, -0.056), (0.096, 0.062, 0.072))
    jowls = [ellipsoid((s * 0.064, 1.775, -0.045), (0.052, 0.058, 0.056)) for s, _ in SIDES]
    # tufts breaking up its surface (seeded, so the same every build)
    rnd = np.random.default_rng(31)
    tufts = []
    for th in np.linspace(-1.35, 1.35, 9):
        for row, y in enumerate((1.79, 1.755, 1.72)):
            if row == 2 and abs(th) > 1.0:
                continue
            r = 0.105 - 0.012 * row + rnd.uniform(-0.006, 0.006)
            c = V(math.sin(th) * r * 0.85, y + rnd.uniform(-0.008, 0.008), -0.03 - math.cos(th) * r * 0.62)
            tufts.append(stroke([c + V(0, 0.018, 0.008), c, c + V(math.sin(th) * 0.008, -0.028, -math.cos(th) * 0.006)], [0.02, 0.019, 0.008]))
    stache = []
    for s, _ in SIDES:
        stache.append(stroke([V(s * 0.004, 1.798, -0.146), V(s * 0.034, 1.791, -0.14), V(s * 0.062, 1.764, -0.12), V(s * 0.072, 1.722, -0.104)], [0.015, 0.019, 0.016, 0.006]))

    def field(p):
        d = smin(mass(p), chinful(p), 0.025)
        for q in jowls:
            d = smin(d, q(p), 0.025)
        for q in tufts:
            d = smin(d, q(p), 0.012)
        for q in stache:
            d = smin(d, q(p), 0.008)
        return d

    head = rigid('head')
    owners = [(mass, head), (chinful, head)] + [(q, head) for q in jowls] + [(q, head) for q in tufts] + [(q, head) for q in stache]
    ns = len(stache)

    def details(p, n, own):
        # x: 1 (strands everywhere), y: on the moustache
        return np.stack([np.ones(len(p)), own[:, -ns:].sum(1), np.zeros(len(p)), np.zeros(len(p))], 1)

    def mats(p, n, own):
        return np.full(len(p), MAT['hair'])

    return Garment('beard', MAT['hair'], 0.002, (-0.16, 1.62, -0.19), (0.16, 1.93, 0.11), field, owners, 2300, tau=0.006, details=details, mats=mats)


GLASSES = dict(y=1.86, z=-0.122, half=(0.029, 0.022), r=0.0048, gap=0.017, tilt=0.12)


def g_glasses():
    """Large (but not comical) orange spectacles, perched on the bridge of
    his nose: thick rectangular rims with rounded corners, a bridge arched
    over the nose and the arms running back over his big ears."""
    G = GLASSES
    hx, hy = G['half']
    parts = []
    for s, _ in SIDES:
        cx = s * (G['gap'] + hx)
        c = V(cx, G['y'], G['z'])
        R = rot_x(-G['tilt']) @ rot_y(s * 0.08)

        def rim_fn(p, c=c, R=R):
            q = (p - c) @ R
            # a rounded rectangle in the lens plane, swept by a round tube
            k = 0.009
            dx = np.abs(q[:, 0]) - (hx - k)
            dy = np.abs(q[:, 1]) - (hy - k)
            ring = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) + np.minimum(np.maximum(dx, dy), 0) - k
            return np.sqrt(ring ** 2 + (q[:, 2] / 0.8) ** 2) - G['r']

        parts.append(Prim(rim_fn, c - V(hx + 0.01, hy + 0.01, 0.02), c + V(hx + 0.01, hy + 0.01, 0.02)))
        # the arm, from the rim's outer corner back over the ear
        a = c + V(s * (hx - 0.002), 0.012, 0.004)
        parts.append(stroke([a, a + V(s * 0.03, 0.0, 0.03), V(s * 0.103, G['y'] + 0.006, -0.005), V(s * 0.11, G['y'] - 0.008, 0.035)], [0.0035, 0.003, 0.003, 0.003]))
    bridge = stroke([V(-G['gap'] - 0.002, G['y'] + 0.008, G['z'] + 0.002), V(0, G['y'] + 0.014, G['z'] + 0.004), V(G['gap'] + 0.002, G['y'] + 0.008, G['z'] + 0.002)], [0.0035, 0.0035, 0.0035])
    parts.append(bridge)
    U = union(parts)
    owners = [(q, rigid('head')) for q in parts]
    return Garment('glasses', MAT['glasses'], 0.0013, U.lo - 0.01, U.hi + 0.01, U, owners, 1400, tau=0.004, outline=0.7)


# --------------------------------------------------------------------------------
# the robe: its top sculpted (the skirt is simulated), sleeves, hood, sash
# --------------------------------------------------------------------------------

ROBE = dict(
    chest=((0, 1.42, 0.022), (0.132, 0.16, 0.094)),
    yoke=((0, 1.553, 0.016), (0.148, 0.062, 0.086)),
    belly=((0, 1.16, -0.05), (0.142, 0.15, 0.158)),  # a round pot belly, out in front
    waist=((0, 1.05, -0.004), (0.138, 0.08, 0.112)),
    cap=0.058,
)
BELL = dict(r0=0.054, r1=0.108, end=0.33, point=0.055, shell=0.01)  # the bell sleeves (flare radii, how far down the arm they end)


def robe_prims():
    R_ = ROBE
    chest = ellipsoid(*R_['chest'])
    yoke = ellipsoid(*R_['yoke'])
    belly = ellipsoid(*R_['belly'])
    waist = ellipsoid(*R_['waist'])
    sleeves = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        end = S + (UPPER_ARM + BELL['end']) * d
        sleeves.append(dict(
            S=S, E=E, W=W, d=d, out=out, end=end,
            cap=ellipsoid(S + 0.02 * d - 0.008 * out, (R_['cap'], R_['cap'], R_['cap'] * 0.92)),
            upper=round_cone(S + 0.01 * d, E, 0.056, 0.054),
            bell=round_cone(E - 0.02 * d, end + BELL['point'] * d, BELL['r0'], BELL['r1']),
        ))
    return chest, yoke, belly, waist, sleeves


def robe_body(p, prims):
    chest, yoke, belly, waist, sleeves = prims
    t = smin(chest(p), yoke(p), 0.05)
    t = smin(t, belly(p), 0.09)
    t = smin(t, waist(p), 0.06)
    for sl in sleeves:
        t = smin(t, sl['cap'](p), 0.06)
    return t


def bell_end(p, sl):
    """> 0 past the bell sleeve's open end: cut on a slant, so that it hangs
    in a long point behind (as the arm hangs; under it when the arm is
    raised)."""
    u = (p - sl['S']) @ sl['d']
    back = clamp((p[:, 2] - 0.0) / BELL['r1'], -1, 1)
    return u - (UPPER_ARM + BELL['end'] + BELL['point'] * 0.5 * (1 + back) ** 1.5)


def robe_smooth(p, prims):
    t = robe_body(p, prims)
    for sl in prims[4]:
        t = smin(t, smin(sl['upper'](p), sl['bell'](p), 0.03), 0.05)
    return t


def vneck(p):
    """> 0 outside the V of the under-robe showing down his front (m)."""
    x, y = np.abs(p[:, 0]), p[:, 1]
    half = 0.012 + 0.07 * smooth(1.3, 1.6, y)
    return np.maximum(x - half, p[:, 2] + 0.02)


def g_robe():
    prims = robe_prims()
    chest, yoke, belly, waist, sleeves = prims
    collar = torus_axis((0, 1.598, 0.01), (0, 1, 0.1), 0.06, 0.013)
    neckhole = round_cone((0, 1.55, 0.016), (0, 1.75, 0.01), 0.05, 0.05)

    def field(p):
        y = p[:, 1]
        t = robe_body(p, prims)
        # loose cloth: soft long folds hanging down the front and back
        t = t + 0.003 * np.sin(np.arctan2(p[:, 0], p[:, 2]) * 7 + y * 4) * smooth(1.45, 1.25, y)
        # the under-robe lies a touch below the outer robe's open edges
        t = t + 0.005 * smooth(0.004, -0.004, vneck(p))
        t = smax(t, SKIRT_TOP - y, 0.01)
        t = smin(t, collar(p), 0.012)
        t = smax(t, -neckhole(p), 0.008)
        for sl in sleeves:
            u = (p - sl['S']) @ sl['d']
            up = sl['upper'](p)
            bell = sl['bell'](p)
            # the bell is a shell, open at its end
            shell = smax(bell, -(bell + BELL['shell']), 0.004)
            shell = smax(shell, bell_end(p, sl), 0.006)
            s = smin(up, shell, 0.03)
            # creases where the sleeve gathers at the elbow
            s = s + 0.003 * np.sin(u * 60) * smooth(0.2, 0.3, u) * smooth(0.42, 0.34, u)
            t = smin(t, s, 0.045)
        return t

    torso_w = by_y([(1.06, 'hips'), (1.16, 'spine'), (1.3, 'spine'), (1.4, 'chest')])
    owners = [(chest, torso_w), (yoke, torso_w), (belly, torso_w), (waist, torso_w), (collar, by_y([(1.6, 'chest'), (1.66, 'neck')]))]
    n_torso = len(owners)
    for sl, (s, L) in zip(sleeves, SIDES):
        w = by_axis(sl['S'], sl['d'], [(-0.02, 'clav' + L), (0.1, 'arm' + L), (0.29, 'arm' + L), (0.35, 'fore' + L)])
        bw = by_axis(sl['S'], sl['d'], [(0.29, 'arm' + L), (0.35, 'fore' + L), (0.43, 'fore' + L), (0.5, 'cuff' + L)])
        owners += [(sl['cap'], w), (sl['upper'], w), (sl['bell'], bw)]
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        torso = own[:, :n_torso].sum(1)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        # x: on the body (not a sleeve), y: down the arm, z: across the V's
        # edge (m, < 0 inside it), w: on the inside of a bell sleeve
        bell = np.stack([sl['bell'](p) for sl in sleeves], 1).min(1)
        inside = (bell < -BELL['shell'] * 0.5).astype(float) * (1 - torso)
        return np.stack([torso, u, vneck(p), inside], 1)

    def mats(p, n, own):
        return np.where((vneck(p) < 0) & (own[:, :4].sum(1) > 0.5), MAT['under'], MAT['robe'])

    return Garment('robe', MAT['robe'], 0.0042, (-0.52, 0.8, -0.25), (0.52, 1.68, 0.17), field, owners, 5800, tau=0.014, details=details, mats=mats)


HOOD = dict(top=1.665, mid=1.6, tip=1.38, half=0.13, puff=0.036, inner=0.014)


def g_hood():
    """The robe's hood, down: lying in soft bunched folds on his upper back,
    drawn to a point between the shoulder blades."""
    H = HOOD
    prims = robe_prims()

    def parts(p):
        x, y = p[:, 0], p[:, 1]
        J = robe_smooth(p, prims)
        t = clamp((H['mid'] - y) / (H['mid'] - H['tip']), 0, 1)
        tt = clamp((y - H['mid']) / (H['top'] - H['mid']), 0, 1)
        hw = (H['half'] * (1 - t ** 1.6) ** 0.8 + 0.003) * (1 - 0.3 * tt ** 2)
        a = clamp(np.abs(x) / hw, 0, 1)
        body = smooth(H['tip'] - 0.004, H['tip'] + 0.06, y) * (1 - 0.4 * smooth(H['mid'], H['top'] + 0.01, y))
        crease = 0.01 * np.exp(-(x / 0.018) ** 2) * smooth(H['tip'], H['tip'] + 0.08, y) * smooth(H['top'], H['mid'] - 0.02, y)
        puff = H['puff'] * (1 - a ** 2) ** 0.6 * body - crease
        return J, hw, puff

    def hood_fn(p):
        y, z = p[:, 1], p[:, 2]
        J, hw, puff = parts(p)
        d = np.maximum(J - (H['inner'] + 0.004 + puff), H['inner'] - J)
        d = smax(d, np.abs(p[:, 0]) - hw, 0.008)
        d = smax(d, H['tip'] - y, 0.008)
        d = smax(d, y - (H['top'] + 0.02), 0.008)
        return smax(d, 0.02 - z, 0.01)

    hood = Prim(hood_fn, (-0.16, H['tip'] - 0.01, -0.02), (0.16, H['top'] + 0.04, 0.2))
    owners = [(hood, by_y([(1.62, 'chest'), (1.7, 'neck')]))]

    def details(p, n, own):
        J, hw, puff = parts(p)
        lining = smooth(H['top'] - 0.03, H['top'] - 0.012, p[:, 1]) * (p[:, 2] > 0.03)
        edge = np.minimum(hw - np.abs(p[:, 0]), (p[:, 1] - H['tip']) * 0.8)
        return np.stack([p[:, 0] / np.maximum(hw, 1e-3), edge, np.ones(len(p)), lining], 1)

    return Garment('hood', MAT['hood'], 0.0028, (-0.17, H['tip'] - 0.02, -0.04), (0.17, H['top'] + 0.05, 0.21), hood, owners, 1800, tau=0.008, details=details)


def g_sash():
    """A brown sash wound round his middle under the pot belly (lower in
    front, where the belly overhangs it), knotted at his left hip, its two
    ends hanging."""
    # the band: a squashed ring, tipped down at the front
    c = V(0, SASH_Y, -0.018)
    Rm = rot_x(-0.22)

    def band_fn(p):
        q = (p - c) @ Rm
        rho = np.sqrt((q[:, 0] / 0.145) ** 2 + (q[:, 2] / 0.13) ** 2) * 0.13
        d = np.sqrt((rho - 0.13) ** 2 + (q[:, 1] / 1.9) ** 2) - 0.012
        return d

    band = Prim(band_fn, c - V(0.17, 0.08, 0.15), c + V(0.17, 0.08, 0.15))
    knot_c = V(-0.1, SASH_Y - 0.012, -0.088)
    knot = ellipsoid(knot_c, (0.024, 0.022, 0.02))
    tails = [
        stroke([knot_c + V(0.0, -0.01, -0.012), knot_c + V(-0.008, -0.09, -0.02), knot_c + V(-0.004, -0.19, -0.016)], [0.016, 0.015, 0.013]),
        stroke([knot_c + V(0.012, -0.012, -0.01), knot_c + V(0.022, -0.07, -0.022), knot_c + V(0.028, -0.14, -0.018)], [0.015, 0.014, 0.012]),
    ]

    def field(p):
        d = smin(band(p), knot(p), 0.008)
        for q in tails:
            # flattened: a band of cloth, not a rope
            d = smin(d, q(p), 0.006)
        return d

    owners = [(band, rigid('hips')), (knot, rigid('hips'))] + [(q, rigid('hips')) for q in tails]

    def details(p, n, own):
        return np.stack([own[:, 2:].sum(1), np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('sash', MAT['sash'], 0.0028, (-0.18, 0.78, -0.16), (0.18, 1.12, 0.15), field, owners, 1600, tau=0.008, details=details)


# --------------------------------------------------------------------------------
# legs, boots, hands
# --------------------------------------------------------------------------------

BOOT_X = 0.082
BOOT_CUFF = 0.17  # where the turned-down cuff sits
SOLE_H = 0.03


def g_legs():
    """Thin legs in brown leggings (the robe hides all but the shins)."""
    prims, owners = [], []
    kn = KNEE_Y
    pelvis = ellipsoid((0, 1.0, 0.005), (0.12, 0.09, 0.095))
    for s, L in SIDES:
        x = s * HIP_JOINT[0]
        w = by_y([(0.14, 'foot' + L), (0.19, 'shin' + L), (kn - 0.03, 'shin' + L), (kn + 0.025, 'thigh' + L)])
        thigh = round_cone((x, 0.99, 0.004), (x + s * 0.004, kn, 0.0), 0.05, 0.034)
        knee = ellipsoid((x + s * 0.004, kn + 0.004, -0.012), (0.026, 0.028, 0.017))
        shin = round_cone((x + s * 0.004, kn - 0.004, 0.004), (x + s * 0.008, 0.12, 0.004), 0.031, 0.025)
        prims.append((thigh, knee, shin))
        owners += [(q, w) for q in (thigh, knee, shin)]
    owners.append((pelvis, rigid('hips')))

    def field(p):
        out = pelvis(p)
        for thigh, knee, shin in prims:
            d = smin(smin(thigh(p), shin(p), 0.04), knee(p), 0.018)
            out = smin(out, d, 0.03)
        return out

    return Garment('legs', MAT['legs'], 0.0036, (-0.16, 0.08, -0.12), (0.16, 1.1, 0.12), field, owners, 1500, tau=0.012)


def g_boots():
    """Old soft leather boots: a long rounded toe turned up a touch, a thin
    worn sole and low heel, the shaft rising to the ankle and its top turned
    down in a loose cuff; a strap over the instep."""
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * BOOT_X

        def sole_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1], p[:, 2]
            px, py = np.abs(x), 0.06 - z
            r1, r2, h = 0.044, 0.05, 0.215
            b = (r1 - r2) / h
            a = math.sqrt(1 - b * b)
            k = -b * px + a * py
            d2 = np.where(k < 0, np.sqrt(px ** 2 + py ** 2) - r1, np.where(k > a * h, np.sqrt(px ** 2 + (py - h) ** 2) - r2, a * px + b * py - r1))
            yy = y - 0.035 * smooth(-0.1, -0.2, z) ** 2
            r = 0.008
            wx, wy = d2 + r, np.abs(yy - SOLE_H / 2) - SOLE_H / 2 + r
            return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r

        sole = Prim(sole_fn, (bx - 0.065, -0.01, -0.22), (bx + 0.065, 0.08, 0.12))
        foot = round_cone((bx, 0.07, 0.03), (bx, 0.058, -0.12), 0.047, 0.04)
        toebox = ellipsoid((bx, 0.058, -0.15), (0.046, 0.034, 0.058), rot_x(0.12))
        instep = round_cone((bx, 0.065, -0.09), (bx, 0.11, -0.02), 0.04, 0.042)
        heel = ellipsoid((bx, 0.07, 0.04), (0.044, 0.05, 0.034))
        shaft = round_cone((bx, 0.07, 0.006), (bx, BOOT_CUFF, 0.006), 0.046, 0.041)
        # the turned-down cuff: a loose roll, a little lower at the front
        cuff = torus_axis((bx, BOOT_CUFF - 0.008, 0.008), (0, 1, 0.25), 0.044, 0.016)
        hole = round_cone((bx, 0.1, 0.006), (bx, 0.3, 0.006), 0.032, 0.032)
        strap = torus_axis((bx, 0.082, -0.045), (0, 0.8, -0.6), 0.04, 0.006)
        parts.append((sole, foot, toebox, instep, heel, shaft, cuff, hole, strap))
        low = along(lambda p: p[:, 2], [(-0.12, 'toe' + L), (-0.075, 'foot' + L)])
        up = by_y([(0.12, 'foot' + L), (0.17, 'shin' + L)])
        owners += [(sole, low), (foot, low), (toebox, low), (instep, low), (heel, rigid('foot' + L)), (shaft, up), (cuff, up), (strap, rigid('foot' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for sole, foot, toebox, instep, heel, shaft, cuff, hole, strap in parts:
            d = smin(sole(p), foot(p), 0.016)
            d = smin(d, toebox(p), 0.024)
            d = smin(d, instep(p), 0.03)
            d = smin(d, heel(p), 0.02)
            d = smin(d, shaft(p), 0.03)
            d = smin(d, cuff(p), 0.01)
            d = smin(d, strap(p), 0.004)
            d = smax(d, -hole(p), 0.006)
            out = np.minimum(out, d)
        return out

    def details(p, n, own):
        # x: on the cuff, y: on the strap
        return np.stack([own[:, 6] + own[:, 14], own[:, 7] + own[:, 15], np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('boots', MAT['boot'], 0.0032, (-0.16, -0.012, -0.24), (0.16, 0.22, 0.13), field, owners, 2400, tau=0.012, details=details)


def g_hands():
    """Long, bony old hands out of the bell sleeves: thin wrists, big
    knuckles. The left hangs open and loose; the right is a fist round the
    stick (the stick passes through it: grip_frame)."""
    parts, owners = [], []
    for s, L in SIDES:
        S, E, W, dn, out = arm_frame(s)
        R = np.stack([out, dn, FW], 1)
        fore = round_cone(E + 0.12 * dn, W, 0.027, 0.02)
        hand = rigid('hand' + L)
        if s < 0:
            palm = round_box(W + 0.05 * dn, (0.014, 0.042, 0.037), 0.012, R)
            # long fingers, gently curled
            fingers = stroke([W + 0.088 * dn, W + 0.13 * dn - 0.008 * out, W + 0.152 * dn - 0.024 * out], [0.019, 0.016, 0.012])
            thumb = stroke([W + 0.03 * dn - 0.012 * out - 0.03 * FW, W + 0.07 * dn - 0.02 * out - 0.034 * FW, W + 0.095 * dn - 0.026 * out - 0.03 * FW], [0.012, 0.01, 0.008])
            knuckles = ellipsoid(W + 0.088 * dn, (0.016, 0.012, 0.036), R)
            ps = (fore, palm, fingers, thumb, knuckles)
        else:
            A, up = grip_frame()
            # the fist: fingers wrapped round the shaft, the thumb over them
            grip = round_cone(A - 0.034 * up, A + 0.03 * up, 0.031, 0.029)
            palm = round_box(W + 0.035 * dn - 0.006 * out, (0.016, 0.03, 0.036), 0.012, R)
            knuckles = round_cone(A + 0.022 * out - 0.03 * up + 0.012 * dn, A + 0.022 * out + 0.028 * up + 0.012 * dn, 0.014, 0.014)
            thumb = stroke([W + 0.03 * dn - 0.016 * out + 0.03 * up, A - 0.016 * out + 0.034 * up, A + 0.01 * out + 0.038 * up], [0.012, 0.011, 0.009])
            ps = (fore, palm, grip, thumb, knuckles)
        parts.append(ps)
        owners += [(ps[0], by_axis(W, dn, [(-0.03, 'fore' + L), (0.01, 'hand' + L)]))] + [(q, hand) for q in ps[1:]]

    def field(p):
        out = np.full(len(p), 1.0)
        for ps in parts:
            d = smin(ps[0](p), ps[1](p), 0.014)
            for q in ps[2:]:
                d = smin(d, q(p), 0.01)
            out = np.minimum(out, d)
        A, up = grip_frame()
        # (the stick's way through the fist)
        hole = round_cone(A - 0.08 * up, A + 0.08 * up, STAFF['r1'] + 0.001, STAFF['r1'] + 0.001)
        return smax(out, -hole(p), 0.003)

    return Garment('hands', MAT['hand'], 0.0022, (-0.5, 0.75, -0.16), (0.5, 1.3, 0.1), field, owners, 1900, tau=0.008)


# --------------------------------------------------------------------------------
# the walking stick
# --------------------------------------------------------------------------------


def staff_local():
    """The stick in its own frame (tip at the origin, up +y): a long, gnarled,
    twisted shaft of old wood, kinking a little this way and that along its
    length, thickening toward a knotted knob at the top."""
    L, r0, r1 = STAFF['length'], STAFF['r0'], STAFF['r1']
    rnd = np.random.default_rng(5)
    n = 11
    pts, radii = [], []
    for k in range(n + 1):
        y = (L - 0.07) * k / n
        kink = 0.0 if k in (0, n) else (1 if k % 2 else -1) * rnd.uniform(0.004, 0.009)
        pts.append(V(kink, y, rnd.uniform(-0.004, 0.004) * (0 < k < n)))
        radii.append(r0 + (r1 - r0) * (k / n) ** 1.3 + (0.002 if k % 3 == 1 else 0))
    shaft = stroke(pts, radii)
    top = pts[-1]
    knob = ellipsoid(top + V(0.003, 0.035, 0.0), (0.03, 0.042, 0.028), rot_z(0.25))
    burl = ellipsoid(top + V(-0.016, 0.012, 0.01), (0.017, 0.02, 0.016))
    burl2 = ellipsoid(V(0.012, 0.52, -0.01), (0.014, 0.022, 0.014))

    def fn(p):
        d = shaft.fn(p)
        # twisted: shallow grooves spiralling round the shaft
        a = np.arctan2(p[:, 2], p[:, 0])
        d = d + 0.0018 * np.sin(a * 3 + p[:, 1] * 22) * smooth(0.02, 0.06, p[:, 1])
        d = smin(d, knob.fn(p), 0.02)
        d = smin(d, burl.fn(p), 0.01)
        d = smin(d, burl2.fn(p), 0.008)
        return d

    return Prim(fn, V(-0.05, -0.02, -0.05), V(0.05, L + 0.05, 0.05))


def g_staff():
    R, tip = staff_bind()
    loc = staff_local()
    st = placed(loc, R, tip)

    def details(p, n, own):
        # the stick's own coordinates (for its grain and knots)
        q = (p - tip) @ R
        return np.concatenate([q, np.zeros((len(p), 1))], 1)

    return Garment('staff', MAT['staff'], 0.0026, st.lo - 0.02, st.hi + 0.02, st, [(st, rigid('staff'))], 1700, tau=0.004, details=details)


# --------------------------------------------------------------------------------
# the volumes the simulated beard and skirt are kept off (bind space, each
# with its bone)
# --------------------------------------------------------------------------------


def r5(c):
    return {k: (round(float(v), 5) if isinstance(v, float) else [round(float(x), 5) for x in v] if isinstance(v, (list, tuple, np.ndarray)) else v) for k, v in c.items()}


def leg_colliders():
    out = []
    for s, L in SIDES:
        x = s * HIP_JOINT[0]
        out.append(dict(bone='thigh' + L, kind='cap', a=[x, 0.99, 0.004], b=[x + s * 0.004, KNEE_Y, 0.0], ra=0.054, rb=0.038))
        out.append(dict(bone='shin' + L, kind='cap', a=[x + s * 0.004, KNEE_Y, 0.004], b=[x + s * 0.008, 0.16, 0.004], ra=0.034, rb=0.048))
        out.append(dict(bone='foot' + L, kind='cap', a=[s * BOOT_X, 0.12, 0.01], b=[s * BOOT_X, 0.05, -0.08], ra=0.05, rb=0.045))
    return out


def arm_colliders(fat=0.0):
    out = []
    R_ = ROBE
    for s, L in SIDES:
        S, E, W, d, o = arm_frame(s)
        out.append(dict(bone='clav' + L, kind='cap', a=list(S - 0.01 * d), b=list(S + 0.03 * d), ra=R_['cap'] + 0.004, rb=R_['cap']))
        out.append(dict(bone='arm' + L, kind='cap', a=list(S + 0.01 * d), b=list(E), ra=0.056 + fat, rb=0.054 + fat))
        out.append(dict(bone='fore' + L, kind='cap', a=list(E), b=list(W), ra=0.05 + fat, rb=0.045 + fat))
    return out


def beard_colliders():
    """The beard hangs off his chin over his chest and belly: kept off his
    arms and legs, his neck and face, and his body."""
    R_ = ROBE
    ell = lambda b, cr, k=0.0: dict(bone=b, kind='ell', c=list(cr[0]), r=[r + k for r in cr[1]])
    out = arm_colliders() + leg_colliders()
    out.append(dict(bone='neck', kind='cap', a=[0, 1.58, 0.02], b=[0, 1.74, 0.01], ra=0.045, rb=0.045))
    out.append(ell('head', ((0, 1.84, -0.035), (0.082, 0.09, 0.085))))
    out.append(ell('head', ((0, 1.765, -0.04), (0.062, 0.03, 0.06))))
    out.append(ell('chest', R_['chest'], 0.004))
    out.append(ell('chest', R_['yoke'], 0.004))
    out.append(ell('spine', R_['belly'], 0.004))
    out.append(ell('hips', R_['waist'], 0.004))
    return [r5(c) for c in out]


def skirt_colliders():
    """The skirt hangs from his waist round his legs: kept off them, his
    boots, his seat and his belly."""
    R_ = ROBE
    out = leg_colliders()
    out.append(dict(bone='hips', kind='ell', c=[0, 0.98, 0.012], r=[0.13, 0.1, 0.108]))
    out.append(dict(bone='spine', kind='ell', c=list(R_['belly'][0]), r=[r + 0.004 for r in R_['belly'][1]]))
    out.append(dict(bone='hips', kind='ell', c=list(R_['waist'][0]), r=[r + 0.006 for r in R_['waist'][1]]))
    return [r5(c) for c in out]


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_hair(), g_beard(), g_glasses(), g_robe(), g_hood(), g_sash(), g_legs(), g_boots(), g_hands(), g_staff()]
    S, E, W, dn, out = arm_frame(1)
    A, up = grip_frame()
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST, kneeY=KNEE_Y,
        hair=[dict(name=n, dir=list((V(*piv) - V(*CRAN[0])) / np.linalg.norm(V(*piv) - V(*CRAN[0]))), **k) for n, piv, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])],
        # the long beard: its roots (head-space points under the jaw, by
        # column), and what it is kept off
        beardRoots=[[round(float(x), 5) for x in beard_root(u)] for u in np.linspace(-1, 1, BEARD['cols'])],
        beard=beard_colliders(),
        # the skirt: hung from round his waist, under the sash
        skirt=dict(y=SKIRT_TOP, w=0.142, back=0.118, front=0.15, z=-0.01, colliders=skirt_colliders()),
        staff=dict(STAFF, gripAt=[round(float(x), 5) for x in A]),
        bootX=BOOT_X, bootCuff=BOOT_CUFF, soleH=SOLE_H, sashY=SASH_Y, glasses=dict(GLASSES, half=list(GLASSES['half'])),
    )
    B.export(garments, OUT, MAT, rig, 'elder', 'elder.py')
    print(f'elder: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
