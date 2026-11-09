#!/usr/bin/env python3
"""Sculpt the skater and write assets/skater/runner.json + runner.bin.

The fifth runner, Hazel, sculpted the way the others are (build.py: every
garment one signed-distance field of volumes blended smoothly into each
other, polygonised, skinned by which volume owns each point, linework drawn
by the game's character shader) to her reference sheet
(tools/characters/skater-sheet.jpg): a young Black woman, slim and athletic,
about seven heads tall, warm deep-brown skin, an oval face with a defined
jaw, full lips, a small nose and big almond-shaped dark eyes under thick
brows; long box braids gathered into a high ponytail that falls past her
waist, a few left down either side to frame her face; small gold hoops and a
few thin bracelets; an oversized neon-lime tee; baggy black skate shorts
piped in white; white crew socks; chunky white-and-grey skate shoes on thick
platform soles - and her skateboard.

Two things here aren't sculpted as fields:

  - the braids. Each is its own tube (box braids are cords, not a sheet),
    meshed directly round its centreline and skinned along its own chain of
    bones, which the game swings with a little simulation of its own
    (src/game/skater.js) - so they part and swing one by one. Only the cap
    of braids on her scalp, the parts between them and the cuff round the
    ponytail are sculpted;
  - the gold: the hoops and the bracelets are tori, meshed directly.

The board rides on a bone of its own (under 'sim', as the elder's stick does):
the game puts it under her feet, flips it, pops it.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/skater.py

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

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'skater')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# rig: the game's skeleton, proportioned to her sheet - about seven heads to
# the crown (1.66 m; the ponytail rises over it), the knee at 0.45 m, long
# legs, the ankle lifted on platform soles. The arms are bound a little out so
# the wide sleeves are modelled clear of the tee.
# --------------------------------------------------------------------------------

HIP_Y = 0.935
HIP_JOINT = (0.08, 0.865)
THIGH = 0.41
SHIN = 0.337
TOE = (0.066, 0.122)
CHEST_Y = 1.17
SHOULDER = (0.158, 1.272)
UPPER_ARM = 0.268
FOREARM = 0.232
ARM_REST = 0.3
NECK_Y = 1.345
HEAD_Y = 1.425
KNEE_Y = HIP_JOINT[1] - THIGH
ANKLE_Y = KNEE_Y - SHIN

# the head (cranium centre, radii); the cap of braids lies over it - round,
# a little wider than it's tall, as her sheet draws it
CRAN = ((0, 1.552, 0.022), (0.08, 0.094, 0.097))
CAP = 0.009  # the cap of braids' depth over the skull
# where the ponytail is gathered (on the crown, toward the back), and the way
# the braids leave it
TIE = V(0.0, 1.664, 0.068)
TIE_DIR = V(0.0, 0.62, 0.785)

# springy gold hoops: [bone, pivot (body space), how they swing in the game]
HOOP = dict(r=0.0125, t=0.0017)
EAR = dict(x=0.08, y=1.492, z=0.022)
LOBE = (EAR['x'] + 0.004, 1.467, EAR['z'] - 0.006)
HAIR_BONES = [
    ('hoopL', (-LOBE[0], LOBE[1], LOBE[2]), dict(f=2.6, z=0.12, k=2.2, lim=0.7)),
    ('hoopR', (LOBE[0], LOBE[1], LOBE[2]), dict(f=2.8, z=0.12, k=2.2, lim=0.7)),
]

# the tee's hem: four bones round the waist the lower tee swings from (front,
# back, her left, her right), and where they pivot
HEM = dict(y=0.95, bones=[('hemF', (0.0, 0.95, -0.06)), ('hemB', (0.0, 0.95, 0.07)), ('hemL', (-0.12, 0.95, 0.0)), ('hemR', (0.12, 0.95, 0.0))])

# the board: a 31 inch deck, 8.1 wide, on 54 mm wheels; its bone sits at the
# middle of the deck's top (the game stands her on it there)
BOARD = dict(
    y=0.098,  # the deck's top surface over the road, at its middle
    half_len=0.4,
    half_w=0.103,
    thick=0.012,
    kick=0.052,  # how far each kick rises at its tip (m)
    kick_from=0.235,  # where the kicks start bending up (from the middle)
    truck_z=0.18,  # the trucks' bolts from the middle
    wheel_r=0.027,
    wheel_w=0.032,
    axle=0.104,  # half the axle's width (to the middle of each wheel)
)

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def lst(v, k=5):
    return [round(float(x), k) for x in v]


def unit(v):
    v = V(*v)
    return v / np.linalg.norm(v)


# --------------------------------------------------------------------------------
# the braids: centrelines and their chains of bones
# --------------------------------------------------------------------------------


def catmull(pts, step):
    """A centripetal-ish Catmull-Rom through pts, resampled every `step` m of
    arc length: (points, arc lengths)."""
    P = [V(*p) for p in pts]
    P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    dense = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for t in np.linspace(0, 1, 40, endpoint=False):
            t2, t3 = t * t, t * t * t
            dense.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3))
    dense.append(P[-2])
    dense = np.array(dense)
    seg = np.linalg.norm(np.diff(dense, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    n = max(2, int(round(L / step)) + 1)
    ss = np.linspace(0, L, n)
    out = np.stack([np.interp(ss, s, dense[:, k]) for k in range(3)], 1)
    return out, ss


# The ponytail: twelve braids out of the cuff on her crown, arcing up and back
# over it and falling down her back to below her seat - a loose round bundle
# of them, not a flat fan (a fan of cords reads as one sheet): their slot is
# where each lies across the bundle (across, how far off her back) and a seed.
# The face-framing braids: two either side from the temples, down past her
# cheek and jaw and over the front of her shoulder onto her chest.
TAIL_SEEDS = [0.11, 0.73, 0.38, 0.91, 0.27, 0.62, 0.05, 0.84, 0.47, 0.19, 0.66, 0.98]
TAIL_SLOTS = [
    (0.05 * math.cos(2 * math.pi * (k + 0.5) / 12) * (0.85 + 0.3 * sd), 0.024 + 0.021 * math.sin(2 * math.pi * (k + 0.5) / 12) * (0.85 + 0.3 * sd), sd)
    for k, sd in enumerate(TAIL_SEEDS)
]
TAIL_JOINTS = [0.0, 0.045, 0.1, 0.18, 0.3, 0.44, 0.6, 0.76, 0.92, 1.07]
FRONT_JOINTS = [0.0, 0.07, 0.15, 0.24, 0.34, 0.45]
BRAID_R = 0.0066


def tail_path(k):
    """The rest centreline of tail braid k (body space)."""
    xo, zo, seed = TAIL_SLOTS[k]
    a = 2 * math.pi * (k + 0.5) / len(TAIL_SLOTS)
    # (where it leaves the cuff: round the bundle)
    side = V(1, 0, 0)
    up = np.cross(TIE_DIR, side)
    p0 = TIE + 0.012 * (math.cos(a) * side + math.sin(a) * up)
    fan = lambda f: V(xo * f, 0, 0)
    L = 1.0 + 0.08 * (seed - 0.5)
    pts = [
        p0,
        TIE + TIE_DIR * 0.045 + fan(0.25) + 0.01 * up * math.sin(a),
        TIE + V(0, 0.036, 0.095) + fan(0.45),
        TIE + V(0, -0.012, 0.142) + fan(0.65) + V(0, 0, zo * 0.5),
        V(0, 1.52, 0.176 + zo) + fan(0.85),
        V(0, 1.33, 0.175 + zo) + fan(1.0),
        V(0, 1.12, 0.17 + zo) + fan(1.05),
        V(0, 0.9, 0.172 + zo) + fan(1.06),
        V(0, 1.68 - L - 0.08, 0.18 + zo) + fan(1.08),
    ]
    return pts, seed


def front_path(s, k):
    """The rest centreline of face-framing braid k on side s."""
    if k == 0:
        pts = [(0.071, 1.556, -0.044), (0.083, 1.49, -0.052), (0.089, 1.415, -0.05), (0.094, 1.335, -0.072), (0.102, 1.255, -0.104), (0.104, 1.14, -0.124), (0.104, 1.06, -0.13)]
        seed = 0.31 if s < 0 else 0.57
    else:
        pts = [(0.078, 1.54, -0.022), (0.091, 1.47, -0.028), (0.099, 1.395, -0.03), (0.112, 1.31, -0.05), (0.128, 1.235, -0.083), (0.132, 1.13, -0.106), (0.133, 1.03, -0.113)]
        seed = 0.82 if s < 0 else 0.14
    return [V(s * x, y, z) for x, y, z in pts], seed


def braid_defs():
    """Every braid: its name, rest centreline (resampled), the arc lengths of
    its joints, and its seed."""
    out = []
    for k in range(len(TAIL_SLOTS)):
        pts, seed = tail_path(k)
        c, ss = catmull(pts, 0.004)
        out.append(dict(name=f't{k}', group='tail', side=0, c=c, s=ss, joints=TAIL_JOINTS, seed=seed, parent='head'))
    for s, L in SIDES:
        for k in range(2):
            pts, seed = front_path(s, k)
            c, ss = catmull(pts, 0.004)
            out.append(dict(name=f'f{L}{k}', group='front', side=s, c=c, s=ss, joints=FRONT_JOINTS, seed=seed, parent='head'))
    for b in out:
        # (the joints, clipped to its length; the last bone carries it to its tip)
        L = b['s'][-1]
        b['joints'] = [j for j in b['joints'] if j < L - 0.05]
        b['L'] = L
        b['jp'] = [np.array([np.interp(j, b['s'], b['c'][:, q]) for q in range(3)]) for j in b['joints']] + [b['c'][-1]]
    return out


BRAIDS = None


def braid_bones(b, k):
    return f"b{b['name']}_{k}"


# --------------------------------------------------------------------------------
# skeleton
# --------------------------------------------------------------------------------


def build_rig():
    global BRAIDS
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.1, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.1, 0))
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
    for name, piv in HEM['bones']:
        bone(name, 'hips', V(*piv) - V(0, HIP_Y, 0))
    # the braids: a chain of bones down each, from the head
    BRAIDS = braid_defs()
    head = B.world_pos('head')
    for b in BRAIDS:
        prev = None
        for k, P in enumerate(b['jp'][:-1]):
            parent = 'head' if k == 0 else braid_bones(b, k - 1)
            at = P - (head if k == 0 else b['jp'][k - 1])
            bone(braid_bones(b, k), parent, at)
    bone('sim', None, (0, 0, 0))
    bone('board', 'sim', (0, BOARD['y'], 0))


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


MAT = dict(face=1, hair=2, tee=3, shorts=4, leg=5, sock=6, shoe=7, hand=8, gold=9, deck=10, truck=11, wheel=12, braid=13)

# --------------------------------------------------------------------------------
# head
# --------------------------------------------------------------------------------


def head_prims():
    # a round, youthful face, about as wide across the cheekbones as it is
    # long from the hairline to the chin: full cheeks up high, the jaw soft
    # and tapering to a small rounded chin; the cranium behind and over it.
    # (No sockets cut for the eyes: the shader draws them, big, on a smooth
    # face - creases there catch the ink and read as lines down the cheeks.)
    cran = ellipsoid(*CRAN)
    face = ellipsoid((0, 1.5, -0.027), (0.069, 0.078, 0.073))
    cheeks = [ellipsoid((s * 0.039, 1.487, -0.049), (0.032, 0.03, 0.031)) for s, _ in SIDES]
    # the jaw: soft, from under the ears down to the chin
    jaws = [round_cone((s * 0.05, 1.47, 0.002), (s * 0.016, 1.427, -0.05), 0.02, 0.014) for s, _ in SIDES]
    chin = ellipsoid((0, 1.424, -0.054), (0.018, 0.016, 0.016))
    return cran, face, cheeks, jaws, chin


def skull(p):
    cran, face, cheeks, jaws, chin = head_prims()
    d = smin(cran(p), face(p), 0.05)
    for c in cheeks:
        d = smin(d, c(p), 0.04)
    for j in jaws:
        d = smin(d, j(p), 0.05)
    return smin(d, chin(p), 0.03)


NOSE = (0.0, 1.474, -0.098)
LIPS = dict(y=1.443, z=-0.084)


def g_head():
    cran, face, cheeks, jaws, chin = head_prims()
    # a small, soft nose: a low bridge, a rounded tip and its wings
    bridge = round_cone((0, 1.512, -0.09), (0, 1.48, -0.096), 0.006, 0.0085)
    tip = ellipsoid(NOSE, (0.0115, 0.0095, 0.0095))
    wings = [ellipsoid((s * 0.0112, 1.4685, -0.09), (0.0082, 0.0072, 0.0075)) for s, _ in SIDES]
    # full lips in low relief (the shader draws them): the upper with its
    # bow, the fuller lower one
    upper = ellipsoid((0, LIPS['y'] + 0.0058, LIPS['z'] - 0.0012), (0.021, 0.0058, 0.0085))
    lower = ellipsoid((0, LIPS['y'] - 0.0058, LIPS['z'] - 0.0004), (0.019, 0.0072, 0.009))
    # a soft brow ridge over each eye
    brows = [ellipsoid((s * 0.035, 1.536, -0.078), (0.03, 0.01, 0.012)) for s, _ in SIDES]
    ears = [ellipsoid((s * EAR['x'], EAR['y'], EAR['z']), (0.011, 0.025, 0.018), rot_y(s * 0.3)) for s, _ in SIDES]
    lobes = [ellipsoid((s * (EAR['x'] + 0.002), 1.471, EAR['z'] - 0.004), (0.007, 0.009, 0.008)) for s, _ in SIDES]
    # a slender neck
    neck = round_cone((0, 1.24, 0.014), (0, 1.47, 0.008), 0.035, 0.033)
    # (the throat runs up under the jaw)
    throat = round_cone((0, 1.3, -0.016), (0, 1.42, -0.028), 0.024, 0.022)

    def field(p):
        d = skull(p)
        for b in brows:
            d = smin(d, b(p), 0.022)
        d = smin(d, bridge(p), 0.014)
        d = smin(d, tip(p), 0.01)
        for w in wings:
            d = smin(d, w(p), 0.008)
        d = smin(d, upper(p), 0.012)
        d = smin(d, lower(p), 0.012)
        for e in ears:
            d = smin(d, e(p), 0.006)
        for e in lobes:
            d = smin(d, e(p), 0.004)
        d = smin(d, throat(p), 0.028)
        return smin(d, neck(p), 0.03)

    head = rigid('head')
    owners = [(cran, head), (face, head), (chin, head), (bridge, head), (tip, head), (upper, head), (lower, head)]
    owners += [(c, head) for c in cheeks + jaws + wings + brows + ears + lobes]
    neck_w = by_y([(1.28, 'chest'), (1.33, 'neck'), (1.41, 'head')])
    owners += [(neck, neck_w), (throat, neck_w)]

    def details(p, n, own):
        # x: on the lips (1 upper, 2 lower), y: on the ears
        lip = own[:, 5] + 2 * own[:, 6]
        ear = sum(own[:, 7 + 2 + 2 + 2 + 2 + k] for k in range(2)) + sum(own[:, 7 + 2 + 2 + 2 + 2 + 2 + k] for k in range(2))
        return np.stack([lip, ear, np.zeros(len(p)), np.zeros(len(p))], 1)

    # (a thinner ink line round the face than the rest of her: it's the
    # part of her you look at, and a fine line keeps it delicate)
    return Garment('head', MAT['face'], 0.0018, (-0.105, 1.2, -0.125), (0.105, 1.67, 0.13), field, owners, 4200, details=details, outline=0.6)


def on_cran(theta, elev, lift=0.0):
    """A point on the cranium at azimuth theta (0 = front, + toward her
    right) and elevation elev, lifted off it along its normal."""
    c, r = V(*CRAN[0]), V(*CRAN[1])
    u = V(math.sin(theta) * math.cos(elev), math.sin(elev), -math.cos(theta) * math.cos(elev))
    p0 = c + r * u
    n = u / r ** 2
    n /= np.linalg.norm(n)
    return p0 + n * lift, n


def hairline(p):
    # by angle round the head (0 = front, pi/2 = over the ear, pi = the
    # nape): the forehead's line, down to the temples, up round the ear,
    # down to the nape
    th = np.abs(np.arctan2(p[:, 0], -(p[:, 2] - 0.02)))
    return np.interp(th, [0, 0.4, 0.75, 1.0, 1.15, 1.32, 1.55, 1.85, 2.2, 2.6, math.pi], [1.574, 1.568, 1.55, 1.525, 1.535, 1.555, 1.56, 1.5, 1.44, 1.415, 1.41])


def scalp_paths():
    """The braids on her scalp: from the hairline all round, drawn up over
    the skull into the cuff (as box braids are, gathered up)."""
    paths = []
    for k in range(26):
        th = -math.pi + (k + 0.5) * 2 * math.pi / 26
        # (low at the nape, high at the forehead: where the hairline is)
        tha = abs(th)
        el0 = float(np.interp(tha, [0, 0.8, 1.2, 1.6, 2.2, math.pi], [0.12, 0.0, -0.18, -0.12, -0.75, -1.05]))
        pts = []
        for j, u in enumerate(np.linspace(0, 1, 6)):
            el = el0 + (1.32 - el0) * u
            q, n = on_cran(th, el, CAP * 0.55)
            pts.append(q)
        # into the cuff
        pts[-1] = TIE + 0.012 * unit(pts[-2] - TIE)
        paths.append(pts)
    return paths


def g_hair():
    """The cap of braids on her scalp: a close shell over the skull, the braids
    raised over it - drawn up from the hairline all round into the cuff - and
    the cuff that gathers them into the ponytail."""

    def cap(p):
        return skull(p) - CAP * 0.5

    base = Prim(cap, (-0.11, 1.38, -0.12), (0.11, 1.68, 0.14))
    lines = [stroke(pts, [0.0058] * len(pts)) for pts in scalp_paths()]
    # the cuff round the ponytail's root: a short band round the bundle
    cuff = round_cone(TIE - TIE_DIR * 0.008, TIE + TIE_DIR * 0.024, 0.021, 0.019)
    knot = ellipsoid(TIE - TIE_DIR * 0.004, (0.026, 0.022, 0.026))

    def field(p):
        hl = hairline(p) - p[:, 1]
        d = smax(base(p), hl, 0.006)
        for q in lines:
            d = smin(d, smax(q(p), hl - 0.003, 0.004), 0.003)
        d = smin(d, knot(p), 0.014)
        return smin(d, cuff(p), 0.006)

    head = rigid('head')
    owners = [(base, head), (knot, head), (cuff, head)] + [(q, head) for q in lines]

    def details(p, n, own):
        # x: on a braid (the parts between them show), y: how far from the
        # cuff (m: the plaits run toward it), z: on the cuff
        onb = own[:, 3:].sum(1)
        dist = np.linalg.norm(p - TIE, axis=1)
        return np.stack([onb, dist, own[:, 2], np.zeros(len(p))], 1)

    return Garment('hair', MAT['hair'], 0.002, (-0.112, 1.37, -0.115), (0.112, 1.72, 0.15), field, owners, 3800, tau=0.004, details=details)


# --------------------------------------------------------------------------------
# meshes made directly (the braids, the gold)
# --------------------------------------------------------------------------------


class MeshGarment:
    """A garment meshed directly: vertices, normals, faces, its own skin
    weights and detail coordinates (see polygonise / skin_weights below)."""

    def __init__(self, name, mat, verts, normals, faces, weights, details, outline=1.0):
        self.name, self.mat, self.outline = name, mat, outline
        self.v, self.n, self.f = verts, normals, faces
        self.w, self.det = weights, details
        self.details = lambda p, n, own: self.det
        self.mats = None

    def mesh(self):
        return self.v, self.n, self.f


def quantise(W):
    """Per-vertex bone weights (N x bones) -> the top four as bytes."""
    top = np.argsort(-W, 1)[:, :4]
    tw = np.take_along_axis(W, top, 1)
    tw /= np.maximum(tw.sum(1, keepdims=True), 1e-9)
    q = np.floor(tw * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)
    return top.astype(np.uint8), q.astype(np.uint8)


_polygonise = B.polygonise
_skin = B.skin_weights


def polygonise(g):
    return g.mesh() if isinstance(g, MeshGarment) else _polygonise(g)


def skin_weights(g, p):
    if isinstance(g, MeshGarment):
        si, sw = quantise(g.w)
        return si, sw, np.zeros((len(p), 1))
    return _skin(g, p)


B.polygonise = polygonise
B.skin_weights = skin_weights


def frames(c):
    """Parallel-transported frames along a polyline: tangents, normals, binormals."""
    T = np.gradient(c, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    N = np.zeros_like(T)
    ref = V(1, 0, 0) if abs(T[0][0]) < 0.9 else V(0, 1, 0)
    n = np.cross(T[0], ref)
    n /= np.linalg.norm(n)
    for i in range(len(T)):
        if i:
            n = n - T[i] * (n @ T[i])
            n /= np.linalg.norm(n)
        N[i] = n
    Bn = np.cross(T, N)
    return T, N, Bn


def tube(c, s, radius, sides, ring):
    """A tube round centreline c (arc lengths s), a ring every `ring` m, its
    radius radius(s) - closed in a rounded tip at the end. Returns vertices,
    normals, faces, and for each vertex its arc length and angle round."""
    L = s[-1]
    n = max(2, int(round(L / ring)) + 1)
    ss = np.linspace(0, L, n)
    cc = np.stack([np.interp(ss, s, c[:, k]) for k in range(3)], 1)
    T, N, Bn = frames(cc)
    verts, norms, S, A = [], [], [], []
    for i in range(n):
        r = radius(ss[i])
        for j in range(sides):
            a = 2 * math.pi * j / sides + (math.pi / sides) * (i % 2)
            d = math.cos(a) * N[i] + math.sin(a) * Bn[i]
            verts.append(cc[i] + r * d)
            norms.append(d)
            S.append(ss[i])
            A.append(a)
    faces = []
    for i in range(n - 1):
        for j in range(sides):
            a0 = i * sides + j
            a1 = i * sides + (j + 1) % sides
            b0 = (i + 1) * sides + j
            b1 = (i + 1) * sides + (j + 1) % sides
            # (rings alternate their half-step twist: keep the quads square)
            if i % 2 == 0:
                faces += [(a0, b0, a1), (a1, b0, b1)]
            else:
                faces += [(a0, b0, b1), (a0, b1, a1)]
    # the tip: a point just past the last ring
    tipi = len(verts)
    verts.append(cc[-1] + T[-1] * radius(L) * 0.9)
    norms.append(T[-1])
    S.append(L)
    A.append(0.0)
    base = (n - 1) * sides
    for j in range(sides):
        faces.append((base + j, tipi, base + (j + 1) % sides))
    # the root: closed flat (it's buried in the cuff or the scalp)
    rooti = len(verts)
    verts.append(cc[0] - T[0] * radius(0) * 0.5)
    norms.append(-T[0])
    S.append(0.0)
    A.append(0.0)
    for j in range(sides):
        faces.append((j, (j + 1) % sides, rooti))
    v = np.array(verts)
    nn = np.array(norms)
    f = np.array(faces, dtype=np.int64)
    # (outward winding)
    a, b, cq = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    fn = np.cross(b - a, cq - a)
    if ((fn * (nn[f[:, 0]] + nn[f[:, 1]] + nn[f[:, 2]])).sum(1)).mean() < 0:
        f = f[:, ::-1]
    return v, nn, f, np.array(S), np.array(A)


def chain_weights(s, joints, bones, blend=0.35):
    """Weights along a chain: a point at arc length s belongs to the bone of
    the segment it's in, blending with the one before across each joint."""
    W = np.zeros((len(s), len(BONES)))
    J = list(joints)
    for k, b in enumerate(bones):
        a0 = J[k]
        a1 = J[k + 1] if k + 1 < len(J) else 1e9
        seg_prev = (J[k] - J[k - 1]) if k > 0 else 1.0
        seg = (a1 - a0) if k + 1 < len(J) else seg_prev
        h0 = blend * min(seg_prev, seg) if k > 0 else 0.0
        h1 = blend * min(seg, (J[k + 2] - J[k + 1]) if k + 2 < len(J) else seg) if k + 1 < len(J) else 0.0
        # rises across the joint at a0, falls across the one at a1
        up = smooth(a0 - h0, a0 + h0, s) if h0 > 0 else (s >= a0 - 1e-9).astype(float)
        down = 1 - smooth(a1 - h1, a1 + h1, s) if h1 > 0 else (s < a1).astype(float)
        W[:, IDX[b]] += up * down
    return W


def g_braids():
    V_, N_, F_, W_, D_ = [], [], [], [], []
    base = 0
    for bi, b in enumerate(BRAIDS):
        seed = b['seed']
        L = b['L']
        r0 = BRAID_R * (1.0 + 0.1 * (seed - 0.5)) * (0.92 if b['group'] == 'front' else 1.0)
        # (the same thickness all down, a little finer at the very ends)
        rad = lambda x, L=L, r0=r0: r0 * (1 - 0.35 * smooth(L - 0.04, L, x))
        v, n, f, S, A = tube(b['c'], b['s'], rad, 6, 0.024 if b['group'] == 'tail' else 0.018)
        bones = [braid_bones(b, k) for k in range(len(b['joints']))]
        W = chain_weights(S, b['joints'], bones)
        # (at the root it's held by the head)
        root = 1 - smooth(0.0, 0.012, S)
        W = W * (1 - root)[:, None]
        W[:, IDX['head']] += root
        V_.append(v), N_.append(n), F_.append(f + base), W_.append(W)
        # detail: x arc length (m), y angle round, z its seed, w 1 (a braid)
        D_.append(np.stack([S, A, np.full(len(S), seed), np.ones(len(S))], 1))
        base += len(v)
    return MeshGarment('braids', MAT['braid'], np.concatenate(V_), np.concatenate(N_), np.concatenate(F_), np.concatenate(W_), np.concatenate(D_), outline=0.55)


def torus_mesh(c, axis, R, r, seg=20, sides=6):
    axis = unit(axis)
    ref = V(1, 0, 0) if abs(axis[0]) < 0.9 else V(0, 1, 0)
    u = np.cross(axis, ref)
    u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    verts, norms, faces = [], [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = math.cos(a) * u + math.sin(a) * w
        for j in range(sides):
            b = 2 * math.pi * j / sides
            nrm = math.cos(b) * d + math.sin(b) * axis
            verts.append(V(*c) + R * d + r * nrm)
            norms.append(nrm)
    for i in range(seg):
        for j in range(sides):
            a0 = i * sides + j
            a1 = i * sides + (j + 1) % sides
            b0 = ((i + 1) % seg) * sides + j
            b1 = ((i + 1) % seg) * sides + (j + 1) % sides
            faces += [(a0, a1, b0), (a1, b1, b0)]
    v, nn, f = np.array(verts), np.array(norms), np.array(faces, dtype=np.int64)
    a, b_, cq = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    if ((np.cross(b_ - a, cq - a) * nn[f[:, 0]]).sum(1)).mean() < 0:
        f = f[:, ::-1]
    return v, nn, f


def g_gold():
    """Small gold hoops through her lobes (each on its own spring), and a few
    thin bracelets on either wrist."""
    V_, N_, F_, W_, D_ = [], [], [], [], []
    base = 0

    def add(v, n, f, bone_w, kind):
        nonlocal base
        W = np.zeros((len(v), len(BONES)))
        for b, w in bone_w:
            W[:, IDX[b]] += w
        V_.append(v), N_.append(n), F_.append(f + base), W_.append(W)
        D_.append(np.stack([np.full(len(v), kind), np.zeros(len(v)), np.zeros(len(v)), np.zeros(len(v))], 1))
        base += len(v)

    for s, L in SIDES:
        # (hanging from the lobe, its plane turned along her jaw)
        c = V(s * LOBE[0], LOBE[1] - HOOP['r'] + 0.002, LOBE[2])
        v, n, f = torus_mesh(c, (1, 0, -0.35 * s), HOOP['r'], HOOP['t'], 18, 5)
        add(v, n, f, [('hoop' + L, 1.0)], 0)
        S, E, W, d, out = arm_frame(s)
        # bracelets: thin bands round the wrist, loose, one a little lower
        bands = [(0.012, 0.0018, 0.0), (0.028, 0.0014, 0.12), (0.042, 0.0019, -0.1)] if s < 0 else [(0.016, 0.0016, 0.08), (0.034, 0.0013, -0.06)]
        for back, tt, tilt in bands:
            cc = W - back * d
            ax = d + tilt * out
            v, n, f = torus_mesh(cc, ax, 0.0262, tt, 22, 5)
            add(v, n, f, [('fore' + L, 1.0)], 1)
    return MeshGarment('gold', MAT['gold'], np.concatenate(V_), np.concatenate(N_), np.concatenate(F_), np.concatenate(W_), np.concatenate(D_), outline=0.5)


# --------------------------------------------------------------------------------
# the tee
# --------------------------------------------------------------------------------

TEE = dict(
    chest=((0, 1.16, 0.012), (0.142, 0.13, 0.094)),
    yoke=((0, 1.252, 0.01), (0.15, 0.056, 0.08)),
    belly=((0, 0.965, 0.014), (0.146, 0.165, 0.1)),
    # (a little over her hips, as her sheet has it: oversized, not a dress)
    hem=0.77,
    drop=0.035,  # the shoulder seams drop this far down the arm
    sleeve=(0.07, 0.064),  # the sleeve's radius at the shoulder, at its end
    end=0.225,  # how far down the arm the sleeve reaches (just over the elbow)
)


def tee_prims():
    T = TEE
    chest = ellipsoid(*T['chest'])
    yoke = ellipsoid(*T['yoke'])
    belly = ellipsoid(*T['belly'])
    sleeves = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        a = S + T['drop'] * d - 0.03 * out + V(0, -0.012, 0)
        b = S + T['end'] * d + 0.008 * out
        sleeves.append(dict(S=S, d=d, out=out, tube=round_cone(a, b, T['sleeve'][0], T['sleeve'][1]),
                            # the opening at its end, so it reads as a sleeve round the arm
                            hole=round_cone(b - 0.03 * d, b + 0.06 * d, T['sleeve'][1] - 0.012, T['sleeve'][1] - 0.012), end=b))
    return chest, yoke, belly, sleeves


def tee_hem(p):
    # (the hem sits a touch lower at the back, and rises over the hips)
    x, z = p[:, 0], p[:, 2]
    return TEE['hem'] - 0.018 * np.clip(z / 0.11, -1, 1) + 0.012 * smooth(0.09, 0.16, np.abs(x))


def g_tee():
    chest, yoke, belly, sleeves = tee_prims()
    # the ribbed crew collar sits round the base of her neck, on the slope of
    # her shoulders rising into it (not a ring floating over them)
    collar = torus_y((0, NECK_Y - 0.03, 0.011), 0.042, 0.0075, 1.02)
    neckline = round_cone((0, NECK_Y - 0.1, 0.012), (0, NECK_Y - 0.036, 0.011), 0.072, 0.047)
    neckhole = round_cone((0, NECK_Y - 0.07, 0.012), (0, NECK_Y + 0.08, 0.011), 0.038, 0.038)

    def body(p):
        t = smin(belly(p), chest(p), 0.09)
        t = smin(t, yoke(p), 0.06)
        return smin(t, neckline(p), 0.04)

    def field(p):
        y = p[:, 1]
        t = body(p)
        # loose cotton: soft vertical folds hanging from the chest, a few
        # wrinkles where it gathers over the hips
        az = np.arctan2(p[:, 0], -p[:, 2])
        t = t + 0.0042 * np.sin(az * 9 + 0.6 * np.sin(y * 13)) * smooth(1.08, 0.84, y)
        t = t + 0.0022 * np.sin(y * 70 + az * 3) * smooth(0.9, 0.75, y) * smooth(0.06, 0.14, np.abs(p[:, 0]))
        t = smax(t, tee_hem(p) - y, 0.016)
        t = smin(t, collar(p), 0.012)
        t = smax(t, -neckhole(p), 0.008)
        for sl in sleeves:
            s = sl['tube'](p)
            u = (p - sl['S']) @ sl['d']
            s = s + 0.0035 * np.sin(u * 55 + p[:, 2] * 40) * smooth(0.08, 0.18, u)
            s = smax(s, -sl['hole'](p), 0.006)
            t = smin(t, s, 0.055)
        return t

    torso = by_y([(0.86, 'hips'), (0.98, 'spine'), (1.08, 'spine'), (1.17, 'chest')])
    hems = {n: IDX[n] for n, _ in HEM['bones']}

    def torso_w(p):
        base = torso(p)
        k = smooth(0.94, 0.74, p[:, 1])
        az = np.arctan2(p[:, 0], -p[:, 2])
        # (each hem bone takes its quarter, blended round)
        wF = np.maximum(0, np.cos(az)) ** 2
        wB = np.maximum(0, -np.cos(az)) ** 2
        wL = np.maximum(0, -np.sin(az)) ** 2
        wR = np.maximum(0, np.sin(az)) ** 2
        tot = wF + wB + wL + wR
        out = [(b, w * (1 - k)) for b, w in base]
        for name, w in (('hemF', wF), ('hemB', wB), ('hemL', wL), ('hemR', wR)):
            out.append((hems[name], k * w / tot))
        return out

    owners = [(belly, torso_w), (chest, torso_w), (yoke, by_y([(1.17, 'spine'), (1.22, 'chest')])), (collar, by_y([(1.28, 'chest'), (1.33, 'neck')])),
              (neckline, by_y([(1.24, 'chest'), (1.31, 'chest')]))]
    n_torso = len(owners)
    for sl, (s, L) in zip(sleeves, SIDES):
        w = by_axis(sl['S'], sl['d'], [(-0.04, 'clav' + L), (0.03, 'arm' + L)])
        owners.append((sl['tube'], w))
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        # x: how loose it hangs here (0 at the collar and shoulders, 1 at the
        # hem and the sleeves' ends: the wind ripples it there), y: on a
        # sleeve, z: on the collar's rib, w: down the sleeve (m)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        sleeve = own[:, n_torso:].sum(1)
        loose = (1 - sleeve) * smooth(1.1, 0.76, p[:, 1]) + sleeve * smooth(0.08, 0.2, u)
        return np.stack([loose, sleeve, own[:, 3], u], 1)

    return Garment('tee', MAT['tee'], 0.0032, (-0.36, 0.66, -0.15), (0.36, 1.36, 0.16), field, owners, 5600, tau=0.016, details=details)


# --------------------------------------------------------------------------------
# shorts
# --------------------------------------------------------------------------------

SHORTS_HEM = 0.6


def g_shorts():
    """Baggy black skate shorts, a long loose leg to just over the knee,
    wide at the hem; piping down the outside of each leg (the shader)."""
    pelvis = ellipsoid((0, 0.85, 0.012), (0.138, 0.125, 0.102))
    seat = ellipsoid((0, 0.8, 0.04), (0.13, 0.095, 0.085))
    legs = [round_cone((s * 0.07, 0.8, 0.008), (s * 0.088, SHORTS_HEM + 0.01, 0.012), 0.08, 0.078) for s, _ in SIDES]
    holes = [round_cone((s * 0.084, 0.7, 0.012), (s * 0.088, 0.52, 0.012), 0.06, 0.06) for s, _ in SIDES]

    def inseam(p):
        x, y = p[:, 0], p[:, 1]
        return np.maximum(np.abs(x) - (0.004 + np.maximum(0, 0.74 - y) * 0.25), y - 0.74)

    def hem(p):
        # (a little lower at the front, the side vents cut up)
        return SHORTS_HEM + 0.01 * np.clip(p[:, 2] / 0.09, -1, 1)

    def field(p):
        d = smin(pelvis(p), seat(p), 0.05)
        for q in legs:
            d = smin(d, q(p), 0.05)
        # loose: folds hanging down the legs
        az = np.arctan2(p[:, 2], np.abs(p[:, 0]) - 0.09)
        d = d + 0.0035 * np.sin(az * 5 + p[:, 1] * 22) * smooth(0.8, 0.66, p[:, 1])
        d = smax(d, -inseam(p), 0.012)
        d = smax(d, hem(p) - p[:, 1], 0.008)
        for q in holes:
            d = smax(d, -q(p), 0.008)
        return smax(d, p[:, 1] - 0.97, 0.01)

    owners = [(pelvis, rigid('hips')), (seat, rigid('hips'))]
    owners += [(q, by_y([(0.76, 'thigh' + L), (0.9, 'hips')])) for q, (s, L) in zip(legs, SIDES)]
    return Garment('shorts', MAT['shorts'], 0.0032, (-0.21, 0.57, -0.14), (0.21, 0.99, 0.17), field, owners, 3000, tau=0.016)


# --------------------------------------------------------------------------------
# legs, socks, shoes, arms and hands
# --------------------------------------------------------------------------------

SOCK_TOP = 0.285
SHOE_X = 0.084
SOLE_H = 0.045
SHOE_COLLAR = 0.158
# the shoe's heel and toe along it (z, from the ankle): chunky on its
# platform, but a shoe her size - the heel just behind the ankle, the toe
# well out in front
SHOE_HEEL = 0.068
SHOE_TOE = -0.205


def g_legs():
    prims, owners = [], []
    kn = KNEE_Y
    for s, L in SIDES:
        x = s * HIP_JOINT[0]
        w = by_y([(0.14, 'foot' + L), (0.19, 'shin' + L), (kn - 0.04, 'shin' + L), (kn + 0.03, 'thigh' + L)])
        thigh = round_cone((x, 0.84, 0.006), (x + s * 0.004, kn + 0.02, 0.0), 0.054, 0.039)
        knee = ellipsoid((x + s * 0.004, kn + 0.004, -0.019), (0.027, 0.03, 0.017))
        calf = round_cone((x + s * 0.004, kn - 0.01, 0.006), (x + s * 0.006, 0.3, 0.015), 0.038, 0.04)
        shin = round_cone((x + s * 0.006, 0.3, 0.011), (x + s * 0.007, 0.15, 0.004), 0.039, 0.028)
        # the crew sock, a touch fuller than the leg, ribbed at its top
        sock = round_cone((x + s * 0.007, 0.13, 0.006), (x + s * 0.007, SOCK_TOP - 0.006, 0.012), 0.033, 0.041)
        cuff = torus_y((x + s * 0.007, SOCK_TOP - 0.012, 0.012), 0.038, 0.006)
        prims.append((thigh, knee, calf, shin, sock, cuff))
        owners += [(q, w) for q in (thigh, knee, calf, shin, sock, cuff)]

    def field(p):
        out = np.full(len(p), 1.0)
        for thigh, knee, calf, shin, sock, cuff in prims:
            d = smin(smin(thigh(p), calf(p), 0.04), shin(p), 0.06)
            d = smin(d, knee(p), 0.02)
            sk = smin(sock(p), cuff(p), 0.008)
            d = smin(d, sk, 0.006)
            out = np.minimum(out, d)
        return out

    def details(p, n, own):
        # x: on the sock's cuff
        cuff = own[:, 5] + own[:, 11]
        return np.stack([cuff, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('legs', MAT['leg'], 0.003, (-0.17, 0.08, -0.08), (0.17, 0.92, 0.08), field, owners, 2800, tau=0.012, details=details)


def g_shoes():
    """Chunky skate shoes: a thick platform cupsole with a textured wall,
    a wide rounded toe box under a reinforced toe cap, a padded collar and
    tongue, laces up the front (the shader draws them, the panels, the
    sole's tread)."""
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * SHOE_X

        def sole_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1], p[:, 2]
            r1, r2 = 0.045, 0.049
            h = (SHOE_HEEL - r1) - (SHOE_TOE + r2)
            px, py = np.abs(x), (SHOE_HEEL - r1) - z
            b = (r1 - r2) / h
            a = math.sqrt(1 - b * b)
            k = -b * px + a * py
            d2 = np.where(k < 0, np.sqrt(px ** 2 + py ** 2) - r1, np.where(k > a * h, np.sqrt(px ** 2 + (py - h) ** 2) - r2, a * px + b * py - r1))
            yy = y - 0.02 * smooth(-0.1, -0.2, z) ** 2
            r = 0.012
            wx, wy = d2 + r, np.abs(yy - SOLE_H / 2) - SOLE_H / 2 + r
            return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r

        sole = Prim(sole_fn, (bx - 0.06, -0.01, SHOE_TOE - 0.01), (bx + 0.06, 0.065, SHOE_HEEL + 0.01))
        foot = round_cone((bx, 0.086, 0.014), (bx, 0.078, -0.11), 0.045, 0.043)
        toebox = ellipsoid((bx, 0.074, -0.148), (0.045, 0.032, 0.048))
        instep = round_cone((bx, 0.09, -0.09), (bx, 0.13, -0.028), 0.039, 0.037)
        heel = ellipsoid((bx, 0.094, 0.03), (0.043, 0.052, 0.03))
        ankle = round_cone((bx, 0.085, 0.01), (bx, 0.142, 0.01), 0.045, 0.042)
        collar = torus_y((bx, SHOE_COLLAR - 0.006, 0.012), 0.037, 0.012, 1.12)
        tongue = round_box((bx, 0.15, -0.034), (0.021, 0.026, 0.008), 0.008, rot_x(-0.35))
        hole = round_cone((bx, 0.115, 0.008), (bx, 0.26, 0.008), 0.03, 0.03)
        parts.append((sole, foot, toebox, instep, heel, ankle, collar, tongue, hole))
        low = along(lambda p: p[:, 2], [(-0.12, 'toe' + L), (-0.075, 'foot' + L)])
        owners += [(sole, low), (foot, low), (toebox, low), (instep, low), (heel, rigid('foot' + L)), (ankle, rigid('foot' + L)), (collar, rigid('foot' + L)), (tongue, rigid('foot' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for sole, foot, toebox, instep, heel, ankle, collar, tongue, hole in parts:
            d = smin(sole(p), foot(p), 0.018)
            d = smin(d, toebox(p), 0.024)
            d = smin(d, instep(p), 0.032)
            d = smin(d, heel(p), 0.024)
            d = smin(d, ankle(p), 0.032)
            d = smin(d, collar(p), 0.012)
            d = smin(d, tongue(p), 0.01)
            d = smax(d, -hole(p), 0.006)
            out = np.minimum(out, d)
        return out

    return Garment('shoes', MAT['shoe'], 0.0028, (-0.16, -0.012, -0.225), (0.16, 0.2, 0.1), field, owners, 3300, tau=0.012)


def g_arms():
    """Slim bare arms out of the sleeves, and her hands."""
    parts, owners = [], []
    fw = V(0, 0, -1)
    for s, L in SIDES:
        S, E, W, dn, out = arm_frame(s)
        R = np.stack([out, dn, fw], 1)
        upper = round_cone(S + 0.09 * dn, E, 0.038, 0.031)
        fore = round_cone(E, W, 0.031, 0.022)
        palm = round_box(W + 0.045 * dn, (0.015, 0.041, 0.035), 0.013, R)
        c = W + 0.094 * dn - 0.006 * out
        fingers = round_cone(c - 0.026 * fw, c + 0.026 * fw, 0.016, 0.015)
        thumb = round_cone(W + 0.03 * dn - 0.01 * out + 0.03 * fw, W + 0.072 * dn - 0.018 * out + 0.026 * fw, 0.011, 0.009)
        parts.append((upper, fore, palm, fingers, thumb))
        arm_w = by_axis(S, dn, [(0.0, 'arm' + L), (UPPER_ARM - 0.03, 'arm' + L), (UPPER_ARM + 0.025, 'fore' + L)])
        hand_w = by_axis(W, dn, [(-0.02, 'fore' + L), (0.012, 'hand' + L)])
        owners += [(upper, arm_w), (fore, arm_w), (palm, hand_w), (fingers, rigid('hand' + L)), (thumb, rigid('hand' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for upper, fore, palm, fingers, thumb in parts:
            d = smin(upper(p), fore(p), 0.03)
            d = smin(d, palm(p), 0.014)
            d = smin(d, fingers(p), 0.01)
            d = smin(d, thumb(p), 0.009)
            out = np.minimum(out, d)
        return out

    def details(p, n, own):
        # x: on the hand (knuckles and nails are drawn there)
        hand = own[:, 2::5].sum(1) + own[:, 3::5].sum(1) + own[:, 4::5].sum(1)
        return np.stack([hand, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('arms', MAT['hand'], 0.0026, (-0.48, 0.58, -0.08), (0.48, 1.24, 0.08), field, owners, 3000, details=details)


# --------------------------------------------------------------------------------
# the board
# --------------------------------------------------------------------------------


def deck_mid(z):
    """The middle of the deck's thickness along it (bone space: 0 at the
    middle of its top), kicked up at the nose and the tail."""
    D = BOARD
    t = np.maximum(0, np.abs(z) - D['kick_from'])
    return -D['thick'] / 2 + D['kick'] * (t / (D['half_len'] - D['kick_from'])) ** 2


def g_board():
    """A popsicle deck (kicked nose and tail, a little concave, black grip
    on top, a graphic underneath, maple plies round its edge) on two trucks
    and four cream wheels."""
    D = BOARD
    Y = D['y']

    def deck_fn(p):
        x, y, z = p[:, 0], p[:, 1] - Y, p[:, 2]
        # its outline: a long rounded shape, the ends a little narrower
        hw = D['half_w'] * (1 - 0.06 * smooth(0.25, D['half_len'], np.abs(z)))
        rr = 0.09
        qx = np.abs(x) - (hw - rr)
        qz = np.abs(z) - (D['half_len'] - rr)
        d2 = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qz, 0) ** 2) + np.minimum(np.maximum(qx, qz), 0) - rr
        # concave: the edges rise a little
        mid = deck_mid(z) + 0.004 * (x / D['half_w']) ** 2
        dy = np.abs(y - mid) - D['thick'] / 2
        r = 0.004
        wx, wy = d2 + r, dy + r
        return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r

    deck = Prim(deck_fn, (-D['half_w'] - 0.01, Y - 0.03, -D['half_len'] - 0.01), (D['half_w'] + 0.01, Y + 0.08, D['half_len'] + 0.01))
    under = Y - D['thick']
    axle_y = D['wheel_r']
    trucks, wheels = [], []
    for sz in (-1, 1):
        z = sz * D['truck_z']
        base = round_box((0, under - 0.006, z), (0.032, 0.006, 0.042), 0.003)
        # the hanger hangs off the baseplate, a little toward the middle
        hanger = round_box((0, axle_y + 0.012, z - sz * 0.006), (0.07, 0.012, 0.014), 0.009)
        neck_ = round_cone((0, under - 0.01, z + sz * 0.012), (0, axle_y + 0.016, z - sz * 0.004), 0.011, 0.012)
        axle = round_cone((-D['axle'] - 0.014, axle_y, z), (D['axle'] + 0.014, axle_y, z), 0.0045, 0.0045)
        bush = round_cone((0, under - 0.012, z - sz * 0.012), (0, axle_y + 0.02, z - sz * 0.012), 0.011, 0.011)
        trucks += [base, hanger, neck_, axle, bush]
        for sx in (-1, 1):
            c = V(sx * D['axle'], axle_y, z)
            hw = D['wheel_w'] / 2

            def wheel_fn(p, c=c, hw=hw):
                q = p - c
                rho = np.sqrt(q[:, 1] ** 2 + q[:, 2] ** 2)
                r = 0.007
                wx, wy = rho - D['wheel_r'] + r, np.abs(q[:, 0]) - hw + r
                d = np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r
                # (the hub dished in on its outer face)
                return d

            wheels.append(Prim(wheel_fn, c - V(hw + 0.005, D['wheel_r'] + 0.005, D['wheel_r'] + 0.005), c + V(hw + 0.005, D['wheel_r'] + 0.005, D['wheel_r'] + 0.005)))

    def field(p):
        d = deck(p)
        for q in trucks:
            d = np.minimum(d, q(p))
        for q in wheels:
            d = np.minimum(d, q(p))
        return d

    owners = [(deck, rigid('board'))] + [(q, rigid('board')) for q in trucks] + [(q, rigid('board')) for q in wheels]

    def mats(p, n, own):
        dk = own[:, 0]
        wh = own[:, 1 + len(trucks):].sum(1)
        return np.where(dk > 0.5, MAT['deck'], np.where(wh > 0.5, MAT['wheel'], MAT['truck']))

    def details(p, n, own):
        # x across the deck (-1..1), y along it (-1 nose .. 1 tail), z which
        # face (+1 the grip on top, -1 the graphic under, 0 the edge), w: on
        # a wheel, how far out on its face
        x = p[:, 0] / D['half_w']
        z = p[:, 2] / D['half_len']
        mid = deck_mid(p[:, 2]) + Y
        face = np.where(n[:, 1] > 0.55, 1.0, np.where(n[:, 1] < -0.55, -1.0, 0.0)) * np.where(np.abs(p[:, 1] - mid) > D['thick'] * 0.3, 1.0, 0.0)
        wheel = np.abs(np.abs(p[:, 0]) - D['axle']) / (D['wheel_w'] / 2)
        return np.stack([x, z, face, wheel], 1)

    return Garment('board', MAT['deck'], 0.0024, (-0.13, -0.004, -0.42), (0.13, Y + 0.07, 0.42), field, owners, 3400, tau=0.003, details=details, mats=mats)


# --------------------------------------------------------------------------------
# what the braids are kept off (bind space, each with its bone), for the game
# --------------------------------------------------------------------------------


def braid_colliders():
    ell = lambda b, c, r: dict(bone=b, kind='ell', c=lst(c), r=lst(r))
    cap = lambda b, a, c, ra, rb: dict(bone=b, kind='cap', a=lst(a), b=lst(c), ra=round(ra, 5), rb=round(rb, 5))
    out = []
    for s, L in SIDES:
        S, E, W, d, o = arm_frame(s)
        out.append(cap('arm' + L, S + 0.02 * d, S + TEE['end'] * d, TEE['sleeve'][0] - 0.004, TEE['sleeve'][1]))
        out.append(cap('fore' + L, E, W, 0.03, 0.024))
        out.append(cap('thigh' + L, (s * HIP_JOINT[0], 0.8, 0.0), (s * HIP_JOINT[0], KNEE_Y, 0.0), 0.078, 0.048))
    out.append(cap('neck', (0, 1.28, 0.014), (0, 1.44, 0.008), 0.035, 0.034))
    cran = (CRAN[0], tuple(r + CAP + 0.004 for r in CRAN[1]))
    out.append(ell('head', *cran))
    out.append(ell('head', (0, 1.48, -0.024), (0.068, 0.07, 0.072)))
    out.append(ell('chest', TEE['chest'][0], TEE['chest'][1]))
    out.append(ell('chest', TEE['yoke'][0], TEE['yoke'][1]))
    out.append(ell('spine', TEE['belly'][0], TEE['belly'][1]))
    out.append(ell('hips', (0, 0.8, 0.04), (0.14, 0.115, 0.11)))
    return out


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_hair(), g_braids(), g_gold(), g_tee(), g_shorts(), g_legs(), g_shoes(), g_arms(), g_board()]
    only = os.environ.get('ONLY')
    if only:
        garments = [g for g in garments if g.name in only.split(',')]
    head = B.world_pos('head')
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST, kneeY=KNEE_Y,
        hair=[dict(name=n, dir=lst(unit((0.25 * np.sign(piv[0]), -1, 0))), **k) for n, piv, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])],
        # the braids: each one's bones (root first), the rest positions of its
        # joints and its tip (body space), how long it is, which it is
        braids=[dict(name=b['name'], group=b['group'], side=b['side'], seed=round(b['seed'], 3), L=round(float(b['L']), 4),
                     bones=[braid_bones(b, k) for k in range(len(b['joints']))], pts=[lst(q) for q in b['jp']]) for b in BRAIDS],
        braidR=BRAID_R,
        colliders=braid_colliders(),
        hem=dict(bones=[n for n, _ in HEM['bones']], y=HEM['y']),
        tee=dict(hem=TEE['hem'], end=TEE['end']),
        board=dict(y=BOARD['y'], halfLen=BOARD['half_len'], halfW=BOARD['half_w'], thick=BOARD['thick'], kick=BOARD['kick'], kickFrom=BOARD['kick_from'], truckZ=BOARD['truck_z'], wheelR=BOARD['wheel_r'], axle=BOARD['axle']),
        sockTop=SOCK_TOP, shortsHem=SHORTS_HEM, shoeX=SHOE_X, soleH=SOLE_H, shoeCollar=SHOE_COLLAR, ankleY=ANKLE_Y,
        shoe=[SHOE_HEEL, SHOE_TOE],
        nose=list(NOSE), lips=[LIPS['y'], LIPS['z']], ear=[EAR['x'], EAR['y'], EAR['z']], tie=lst(TIE),
    )
    B.export(garments, OUT, MAT, rig, 'skater', 'skater.py')
    print(f'skater: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
