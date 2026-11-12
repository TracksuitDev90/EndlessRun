#!/usr/bin/env python3
"""Sculpt Nep, the pitcher plant who runs with you, and write
assets/pitcher/runner.json + runner.bin.

Sculpted the way the fox is (build.py's kit: every surface one signed-distance
field of volumes blended smoothly together, polygonised, skinned by which
volume owns each point; the markings drawn by the game's character shader)
after his reference paintings: a small, squat pitcher - a rounded pear of a
body in lime and yellow-green, its mouth tipped forward under a softly
scalloped coral-pink rim, and nothing but a dark hollow inside, where two warm
yellow eyes peer out (no face on his belly); an oversized, lopsided leaf
flopped over the mouth like a hat, on a stem that hooks up over his back; two
slender curling tendrils for arms, a sprig of little leaves out of one side,
and short, uneven root feet splayed into rootlets.

The pitcher is a real vessel: its wall is a shell round a hollow that runs
down into the bulb, and the water standing in it is a disc of its own
(skinned to the `water` bone, which the game tips as it sloshes). The game
paints the rest (src/game/pitcher.js, PITCHER in the character shader): the
growth lines and freckles, the rim's ridges, the hollow's dark and the eyes in
it, the leaf's veins and rusty edges, the bark of the roots.

Each vertex carries (detail): on the pitcher x how far up it (0 the bottom, 1
the rim), y how far round (0..1); on a leaf x across it (-1..1, + toward the
wide side), y along it (0 the stalk, 1 the tip), z how far in from its edge
(m), w which face (1 the top, 0 beneath); on the vines and roots y how far
along them (0..1).

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/pitcher.py

Coordinates are the game's: meters, y up, facing -z, standing over the origin.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, Prim, Garment, rigid, along, by_axis, bone, dot  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'pitcher')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# the shape
# --------------------------------------------------------------------------------

# the pear: a round bulb low down and a neck rising out of it
BULB_C, BULB_R = (0, 0.19, 0), (0.172, 0.128, 0.162)
NECK_A, NECK_B, NECK_RA, NECK_RB = (0, 0.24, 0), (0, 0.44, 0), 0.142, 0.106
WALL = 0.011
# the mouth: cut by a plane tipped forward (so you see into it from the
# front), a rolled, scalloped lip round it
MOUTH_C = V(0, 0.43, 0)
MOUTH_TILT = math.radians(22)
MOUTH_N = V(0, math.cos(MOUTH_TILT), -math.sin(MOUTH_TILT))
MOUTH_E1 = V(1, 0, 0)
MOUTH_E2 = np.cross(MOUTH_N, MOUTH_E1)  # toward the back, in the plane
SCALLOPS = 9
# the water standing in him (the top of it, flat at rest)
WATER_C = V(0, 0.315, 0.0)
WATER_R = 0.104
# his eyes, on the back wall of the hollow, looking out (right side)
EYE = (0.032, 0.444, 0.086)

# the stem: up out of the back of the rim, hooked over, into the leaf's stalk
STEM = [(0.05, 0.454, 0.088), (0.078, 0.515, 0.122), (0.088, 0.585, 0.122), (0.078, 0.636, 0.094), (0.062, 0.652, 0.066), (0.046, 0.634, 0.05)]
STEM_R = [0.0125, 0.0115, 0.0105, 0.0095, 0.009, 0.0085]
# the leaf: from its stalk (LB) out along LA (forward and down), across LE
LB = V(*STEM[-1])
LEAF_L = 0.345
LEAF_W = (0.158, 0.188)  # half-widths: the narrow side (-x), the wide side
LEAF_NOTCH = (0.47, 0.011)  # where along the wide edge, and how big
_la = V(-0.5, -0.3, -1.0)
LA = _la / np.linalg.norm(_la)
_le = np.cross(LA, V(0, 1, 0))
_le /= np.linalg.norm(_le)
# (rolled a little toward the wide side)
_roll = -0.06
LE = _le * math.cos(_roll) + np.cross(LA, _le) * math.sin(_roll)
LN = np.cross(LE, LA)
if LN[1] < 0:
    LN = -LN
    LE = -LE

# the arms: tendrils out of each side, out and down, then curling up at the
# end (out, up, forward: in the arm's own frame, out along +x on the right)
ARM_ROOT = (0.128, 0.285, 0.0)
ARM_PATH = [(0.0, 0.0, 0.0), (0.035, -0.022, -0.006), (0.075, -0.034, -0.012), (0.115, -0.022, -0.016), (0.142, 0.008, -0.016), (0.152, 0.042, -0.012), (0.14, 0.066, -0.008), (0.118, 0.07, -0.006), (0.106, 0.054, -0.006), (0.114, 0.04, -0.006), (0.126, 0.044, -0.006)]
ARM_RAD = [0.0125, 0.0108, 0.0096, 0.0086, 0.0078, 0.007, 0.0062, 0.0055, 0.0048, 0.0042, 0.0032]
ARM_BONES = (0.0, 0.055, 0.11)  # where each of its three bones starts, along x

# the sprig of little leaves out of his right side
SPRIG = V(0.118, 0.365, 0.03)
SPRIG_LEAVES = [  # direction (out, up, back), length, half-width
    ((0.75, 0.62, 0.2), 0.082, 0.032),
    ((0.95, 0.12, 0.3), 0.054, 0.022),
]

# the feet: a short stump of root (hip -> ankle), splayed into rootlets on
# the road; uneven, the left a little shorter and more knotted
HIP = (0.068, 0.088, 0.004)
ANKLE = (0.082, 0.03, 0.0)
# rootlets: angle round (0 forward, + outward), reach, droop, thickness;
# per side
ROOTLETS = {
    'R': [(-0.35, 0.088, 0.0, 0.0125), (0.35, 0.082, 0.0, 0.012), (1.25, 0.062, 0.0, 0.0105), (2.4, 0.056, 0.0, 0.0095), (3.3, 0.05, 0.0, 0.009)],
    'L': [(-0.25, 0.078, 0.0, 0.012), (0.5, 0.09, 0.0, 0.0125), (1.5, 0.054, 0.0, 0.0095), (2.6, 0.062, 0.0, 0.01)],
}

MAT = dict(pot=1, rim=2, hollow=3, leaf=4, vine=5, root=6, water=7)

# --------------------------------------------------------------------------------
# the skeleton
# --------------------------------------------------------------------------------

POT = V(0, 0.1, 0)  # he rocks on his base, from about here
WATER = WATER_C
STEM_J = V(*STEM[1])
TIP_U = 0.16  # where along the leaf it bends


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('pot', 'body', POT)
    bone('water', 'pot', WATER - POT)
    bone('stem', 'pot', STEM_J - POT)
    bone('lid', 'stem', LB - STEM_J)
    bone('lidTip', 'lid', LA * TIP_U)
    for s, L in SIDES:
        root = V(s * ARM_ROOT[0], ARM_ROOT[1], ARM_ROOT[2])
        prev, at = 'pot', POT
        for i, x in enumerate(ARM_BONES):
            p = root + V(s * x, np.interp(x, [q[0] for q in ARM_PATH], [q[1] for q in ARM_PATH]), np.interp(x, [q[0] for q in ARM_PATH], [q[2] for q in ARM_PATH]))
            bone('arm%s%d' % (L, i), prev, p - at)
            prev, at = 'arm%s%d' % (L, i), p
    bone('sprig', 'pot', SPRIG - POT)
    for s, L in SIDES:
        hip = V(s * HIP[0], HIP[1], HIP[2])
        ank = V(s * ANKLE[0], ANKLE[1], ANKLE[2])
        # (the legs hang off the body, not the pot: the game sets each hip
        # where the pot's base is, so they never squash with it)
        bone('leg' + L, 'body', hip)
        bone('foot' + L, 'leg' + L, ank - hip)


# --------------------------------------------------------------------------------
# the pitcher: its wall, its lip and the hollow inside
# --------------------------------------------------------------------------------


def mouth_coords(p):
    q = p - MOUTH_C
    h = q @ MOUTH_N
    u, v = q @ MOUTH_E1, q @ MOUTH_E2
    return h, np.sqrt(u * u + v * v), np.arctan2(u, -v)  # (0 at the front)


def growth(p):
    """Shallow grooves running up the body, curving a little as they rise."""
    ang = np.arctan2(p[:, 0], -p[:, 2])
    k = 11
    a = ang * k / (2 * math.pi) + 0.55 * np.sin(p[:, 1] * 14.0 + 0.6) * smooth(0.06, 0.2, p[:, 1])
    f = np.abs(a - np.round(a))
    return 0.0024 * np.exp(-((f / 0.09) ** 2)) * smooth(0.08, 0.16, p[:, 1]) * smooth(0.42, 0.36, p[:, 1])


def solid(p):
    bulb = ellipsoid(BULB_C, BULB_R)
    neck = round_cone(NECK_A, NECK_B, NECK_RA, NECK_RB)
    return smin(bulb.fn(p), neck.fn(p), 0.075) + growth(p)


def lip(p):
    h, rho, th = mouth_coords(p)
    # the neck's cut is an ellipse a little longer front to back
    R = NECK_RB * (1.0 + 0.08 * np.cos(th) ** 2) + 0.008
    sc = np.cos(th * SCALLOPS)
    # a full, rolled lip, flared out and ruffled up and down in scallops
    Rm = R + 0.011 + 0.008 * sc
    h0 = 0.005 + 0.008 * sc
    return np.sqrt(((rho - Rm) / 1.5) ** 2 + (h - h0) ** 2) - 0.0165


def shell(p):
    d = solid(p)
    wall = np.maximum(d, -(d + WALL))
    h = (p - MOUTH_C) @ MOUTH_N
    return smax(wall, h, 0.004)


def g_pot():
    def field(p):
        return smin(shell(p), lip(p), 0.012)

    lo = (-0.21, 0.03, -0.21)
    hi = (0.21, 0.52, 0.21)
    pot = Prim(field, lo, hi)

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0] = clamp((p[:, 1] - 0.062) / (0.43 - 0.062), 0, 1)
        out[:, 1] = (np.arctan2(p[:, 0], -p[:, 2]) / (2 * math.pi)) % 1.0
        out[:, 2] = -1.0
        return out

    def mats(p, n, own):
        m = np.full(len(p), MAT['pot'])
        d = solid(p)
        m[d < -WALL * 0.5] = MAT['hollow']
        m[lip(p) < shell(p) + 0.0015] = MAT['rim']
        return m

    return Garment('pot', MAT['pot'], 0.0028, lo, hi, field, [(pot, rigid('pot'))], 12000, tau=0.01, details=details, mats=mats)


def g_water():
    disc = ellipsoid(WATER_C - V(0, 0.006, 0), (WATER_R, 0.008, WATER_R))

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = -1.0
        return out

    return Garment('water', MAT['water'], 0.0025, WATER_C - 0.12, WATER_C + 0.12, disc.fn, [(disc, rigid('water'))], 400, details=details, outline=0.0)


# --------------------------------------------------------------------------------
# the leaf: an oversized, lopsided leaf flopped over his mouth
# --------------------------------------------------------------------------------


def leaf_halfwidth(t, side):
    W = np.where(side > 0, LEAF_W[1], LEAF_W[0])
    # broad near its base, drawn out to a point
    prof = np.sin(np.pi * np.clip(t, 0, 1) ** 0.72) ** 0.8
    # (and a slow wave along its edges)
    return W * prof * (1.0 + 0.04 * np.sin(t * 17.0 + side * 1.3))


def leaf_drape(u, v, t):
    """How far the leaf's surface lies below its plane at (u, v): drooping
    toward the tip, its sides cupped down over him, the wide side's edge
    turned up a little, the very tip curling up."""
    w = -0.8 * u * u - 3.4 * np.maximum(u - 0.19, 0) ** 2
    w -= 2.4 * v * v * (0.45 + 0.55 * t)
    w += 1.4 * np.maximum(v - 0.12, 0) ** 2 * smooth(0.3, 0.7, t)
    w += 2.6 * np.maximum(u - LEAF_L * 0.84, 0) ** 2 * (1.0 + 18 * np.maximum(u - LEAF_L * 0.84, 0))
    return w


def leaf_coords(p):
    q = p - LB
    return q @ LA, q @ LE, q @ LN


def leaf_field(p):
    u, v, w = leaf_coords(p)
    t = u / LEAF_L
    w0 = leaf_drape(u, v, t)
    # the slope of the drape, to keep the thickness true where it's steep
    gu = -1.6 * u - 6.8 * np.maximum(u - 0.19, 0) - 2.4 * v * v * 0.55 / LEAF_L
    gv = -4.8 * v * (0.45 + 0.55 * t) + 2.8 * np.maximum(v - 0.12, 0) * smooth(0.3, 0.7, t)
    g = np.sqrt(1 + gu * gu + gv * gv)
    side = np.sign(v + 1e-9)
    hw = leaf_halfwidth(t, side)
    # the outline: in from its edges, its stalk end and its tip
    edge = np.abs(v) - hw
    edge = np.maximum(edge, -u)
    edge = np.maximum(edge, u - LEAF_L)
    # a notch bitten out of the wide edge
    nt, nr = LEAF_NOTCH
    nu = nt * LEAF_L
    nv = float(leaf_halfwidth(np.array([nt]), np.array([1.0]))[0])
    notch = np.sqrt((u - nu) ** 2 + (v - nv) ** 2) - nr
    edge = np.maximum(edge, -notch)
    # thin, a little thicker down the midrib
    th = 0.0024 + 0.0024 * np.exp(-((v / 0.008) ** 2)) * (1 - 0.7 * np.clip(t, 0, 1))
    d = np.abs(w - w0) / g - th
    return np.maximum(d, edge), edge


def g_leaf():
    lo = LB + V(-0.24, -0.34, -0.4)
    hi = LB + V(0.24, 0.06, 0.04)
    leaf = Prim(lambda p: leaf_field(p)[0], lo, hi)
    w = by_axis(LB, LA, [(0.0, 'lid'), (TIP_U * 0.6, 'lid'), (TIP_U * 1.5, 'lidTip')])

    def details(p, n, own):
        u, v, w_ = leaf_coords(p)
        t = u / LEAF_L
        side = np.sign(v + 1e-9)
        hw = leaf_halfwidth(t, side)
        out = np.zeros((len(p), 4))
        out[:, 0] = v / np.maximum(hw, 0.01)
        out[:, 1] = clamp(t, 0, 1)
        out[:, 2] = -leaf_field(p)[1]
        # which face: the top faces up out of the drape
        w0 = leaf_drape(u, v, t)
        out[:, 3] = np.where(w_ > w0, 1.0, 0.0)
        return out

    return Garment('leaf', MAT['leaf'], 0.0017, lo, hi, leaf, [(leaf, w)], 5000, tau=0.006, details=details, outline=0.7)


def sprig_leaf(base, d, L, W):
    d = V(*d)
    d /= np.linalg.norm(d)
    across = np.cross(d, V(0, 0, 1))
    if np.linalg.norm(across) < 1e-3:
        across = V(0, 1, 0)
    across /= np.linalg.norm(across)
    nrm = np.cross(across, d)

    def coords(p):
        q = p - base
        return q @ d, q @ across, q @ nrm

    def fn(p):
        u, v, w = coords(p)
        t = u / L
        hw = W * np.sin(np.pi * np.clip(t, 0, 1) ** 0.7) ** 0.85
        w0 = -0.9 * v * v / W * 0.6 + 1.2 * u * u * 0.3
        edge = np.maximum(np.maximum(np.abs(v) - hw, -u), u - L)
        return np.maximum(np.abs(w - w0) - 0.0018, edge)

    return Prim(fn, base - L - 0.02, base + L + 0.02), coords, L, W


def g_sprig():
    leaves = [sprig_leaf(SPRIG + V(*d) * 0.012, d, L, W) for d, L, W in SPRIG_LEAVES]
    stalk = round_cone(SPRIG - V(0.01, 0, 0), SPRIG + V(0.012, 0.008, 0.002), 0.0055, 0.004)

    def field(p):
        d = stalk.fn(p)
        for lf, *_ in leaves:
            d = np.minimum(d, lf.fn(p))
        return d

    lo = SPRIG - 0.1
    hi = SPRIG + 0.1
    owners = [(stalk, rigid('sprig'))] + [(lf, rigid('sprig')) for lf, *_ in leaves]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = 0.01
        out[:, 3] = 1.0
        for i, (lf, coords, L, W) in enumerate(leaves):
            u, v, w = coords(p)
            k = own[:, i + 1]
            t = clamp(u / L, 0, 1)
            hw = W * np.sin(np.pi * t ** 0.7) ** 0.85
            out[:, 0] += k * v / np.maximum(hw, 0.004)
            out[:, 1] += k * t
            out[:, 2] = np.where(k > 0.5, (hw - np.abs(v)), out[:, 2])
        return out

    def mats(p, n, own):
        m = np.full(len(p), MAT['leaf'])
        m[own[:, 0] > 0.5] = MAT['vine']
        return m

    return Garment('sprig', MAT['leaf'], 0.0013, lo, hi, field, owners, 900, tau=0.003, details=details, mats=mats, outline=0.6)


# --------------------------------------------------------------------------------
# the vines: the leaf's stem and his tendril arms
# --------------------------------------------------------------------------------


def arm_points(s):
    root = V(s * ARM_ROOT[0], ARM_ROOT[1], ARM_ROOT[2])
    return [root + V(s * x, y, z) for x, y, z in ARM_PATH]


def g_vines():
    stem = stroke([V(*q) for q in STEM], STEM_R)
    # (its foot sunk into the back of the rim)
    stem_foot = ellipsoid(V(*STEM[0]) + V(0, -0.006, 0.004), (0.016, 0.013, 0.012))
    arms = [(stroke(arm_points(s), ARM_RAD), s, L) for s, L in SIDES]
    arm_feet = [ellipsoid(V(s * (ARM_ROOT[0] - 0.006), ARM_ROOT[1], ARM_ROOT[2]), (0.012, 0.016, 0.014)) for s, _ in SIDES]

    def field(p):
        d = smin(stem.fn(p), stem_foot.fn(p), 0.008)
        for (a, s, L), f in zip(arms, arm_feet):
            d = np.minimum(d, smin(a.fn(p), f.fn(p), 0.008))
        return d

    lo = (-0.32, 0.2, -0.08)
    hi = (0.32, 0.7, 0.2)
    stem_len = np.cumsum([0] + [np.linalg.norm(V(*STEM[i + 1]) - V(*STEM[i])) for i in range(len(STEM) - 1)])
    # the stem: rooted in the pot, bending from its first joint, the top of
    # its hook carried by the leaf
    sw = along(lambda p: np.argmin(np.stack([np.sum((p - V(*q)) ** 2, 1) for q in STEM], 1), 1).astype(float), [(0.0, 'pot'), (0.8, 'stem'), (3.6, 'stem'), (4.6, 'lid')])
    owners = [(stem, sw), (stem_foot, rigid('pot'))]
    for (a, s, L), f in zip(arms, arm_feet):
        x0 = s * ARM_ROOT[0]
        coord = lambda p, x0=x0, s=s: (p[:, 0] - x0) * s
        ctrl = [(-0.004, 'pot'), (0.008, 'arm%s0' % L), (ARM_BONES[1] - 0.012, 'arm%s0' % L), (ARM_BONES[1] + 0.008, 'arm%s1' % L), (ARM_BONES[2] - 0.012, 'arm%s1' % L), (ARM_BONES[2] + 0.006, 'arm%s2' % L)]
        owners += [(a, along(coord, ctrl)), (f, rigid('pot'))]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = -1.0
        # how far along each: the stem by its points, an arm by its reach
        st = np.argmin(np.stack([np.sum((p - V(*q)) ** 2, 1) for q in STEM], 1), 1) / (len(STEM) - 1)
        ar = clamp((np.abs(p[:, 0]) - ARM_ROOT[0]) / 0.15, 0, 1)
        # (the curl's end, coming back in, is the tip)
        curl = smooth(0.04, 0.07, p[:, 1] - ARM_ROOT[1]) * smooth(0.13, 0.11, np.abs(p[:, 0]) - ARM_ROOT[0])
        ar = np.maximum(ar, curl)
        stem_own = own[:, 0] + own[:, 1]
        out[:, 1] = stem_own * st * 0.3 + (1 - stem_own) * ar
        return out

    return Garment('vines', MAT['vine'], 0.0018, lo, hi, field, owners, 3600, tau=0.004, details=details, outline=0.8)


# --------------------------------------------------------------------------------
# the feet: stumps of root splayed into rootlets
# --------------------------------------------------------------------------------


def rootlet(ank, s, ang, reach, thick, seed):
    # out along the road from the ankle, dipping to touch it, the tip
    # curling up a little; a little side-shoot off it
    a = s * ang
    d = V(math.sin(a), 0, -math.cos(a))
    side = np.cross(d, V(0, 1, 0))
    wob = 0.012 * math.sin(seed * 3.1)
    pts = [ank + V(0, -0.004, 0), ank + d * reach * 0.38 + V(0, -0.016, 0) + side * wob, ank + d * reach * 0.75 + V(0, -0.024, 0) - side * wob * 0.6, ank + d * reach + V(0, -0.02, 0) + side * wob * 0.4]
    rad = [thick, thick * 0.8, thick * 0.55, thick * 0.28]
    main = stroke(pts, rad)
    sb = 1 if seed % 2 else -1
    b0 = pts[1] + d * 0.006
    b1 = b0 + (d * 0.6 + side * sb * 0.8) / np.linalg.norm(d * 0.6 + side * sb * 0.8) * reach * 0.42 + V(0, -0.004, 0)
    shoot = round_cone(b0, b1, thick * 0.5, thick * 0.2)
    return main, shoot


def g_roots():
    parts = []
    for s, L in SIDES:
        hip = V(s * HIP[0], HIP[1], HIP[2])
        ank = V(s * ANKLE[0], ANKLE[1], ANKLE[2])
        stump = round_cone(hip + V(0, 0.012, 0), ank, 0.034 if L == 'R' else 0.031, 0.024)
        knot = ellipsoid(ank + V(s * 0.004, 0.006, 0.003), (0.03, 0.019, 0.028))
        knob = ellipsoid((hip + ank) / 2 + V(s * 0.016, 0.0, -0.01 if L == 'L' else 0.012), (0.011, 0.012, 0.01))
        lets = []
        for i, (ang, reach, _, th) in enumerate(ROOTLETS[L]):
            m, sh = rootlet(ank, s, ang, reach, th, i + (7 if L == 'L' else 0))
            lets += [m, sh]
        parts.append((s, L, stump, knot, knob, lets, hip, ank))

    def field(p):
        d = np.full(len(p), 1.0)
        for s, L, stump, knot, knob, lets, hip, ank in parts:
            f = smin(stump.fn(p), knot.fn(p), 0.014)
            f = smin(f, knob.fn(p), 0.008)
            for q in lets:
                f = smin(f, q.fn(p), 0.008)
            d = np.minimum(d, f)
        return np.maximum(d, -p[:, 1])

    owners = []
    for s, L, stump, knot, knob, lets, hip, ank in parts:
        w = by_axis(hip, (ank - hip) / np.linalg.norm(ank - hip), [(0.0, 'pot'), (0.012, 'leg' + L), (0.035, 'leg' + L), (0.052, 'foot' + L)])
        owners += [(stump, w), (knob, w), (knot, rigid('foot' + L))] + [(q, rigid('foot' + L)) for q in lets]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = -1.0
        ax = np.abs(p[:, 0]) - ANKLE[0]
        r = np.sqrt(ax ** 2 + p[:, 2] ** 2)
        out[:, 1] = clamp(r / 0.075, 0, 1)
        out[:, 0] = clamp((p[:, 1] - 0.02) / 0.08, 0, 1)
        return out

    lo = (-0.22, 0.0, -0.14)
    hi = (0.22, 0.13, 0.14)
    return Garment('roots', MAT['root'], 0.0019, lo, hi, field, owners, 4200, tau=0.004, details=details, outline=0.8)


# --------------------------------------------------------------------------------


def build():
    t0 = time.time()
    build_rig()
    garments = [g_pot(), g_water(), g_leaf(), g_sprig(), g_vines(), g_roots()]
    J = {b['name']: [round(float(x), 5) for x in b['world'][:3, 3]] for b in B.BONES}
    r5 = lambda v: [round(float(x), 5) for x in v]
    rig = dict(
        joints=J,
        mouth=dict(c=r5(MOUTH_C), n=r5(MOUTH_N), r=NECK_RB + 0.02),
        water=dict(c=r5(WATER_C), r=WATER_R),
        leaf=dict(base=r5(LB), along=r5(LA), across=r5(LE), length=LEAF_L),
        hip=list(HIP),
        ankle=list(ANKLE),
        arm=dict(root=list(ARM_ROOT), bones=list(ARM_BONES)),
        # the face, for the shader: each eye's centre (right side)
        eye=list(EYE),
    )
    B.export(garments, OUT, MAT, rig, 'pitcher', 'pitcher.py')
    print(f'pitcher: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
