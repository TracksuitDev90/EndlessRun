#!/usr/bin/env python3
"""Sculpt the runner and write assets/runner/runner.json + runner.bin.

The character is modelled the way a sculptor blocks out a figure rather than
assembled from parts: every garment is one signed-distance field made of
volumes blended smoothly into each other (shoulders flow into sleeves, limbs
taper, the shorts wrap the hips), polygonised with marching cubes, simplified,
and given exact smooth normals taken from the field. Skin weights come from
which volume "owns" each point of the surface, so the mesh bends where the
shapes blend. Fine linework (quilting seams, laces, the face, trims) is not
modelled at all: each vertex carries a few smooth coordinates and the game's
character shader draws those lines crisply at any distance.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/build.py

Coordinates are the game's: meters, y up, the runner facing -z.
"""

import json
import math
import os
import struct
import sys
import time

import numpy as np
from skimage.measure import marching_cubes
import fast_simplification

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'runner')

# --------------------------------------------------------------------------------
# field helpers (p is an (N, 3) array)
# --------------------------------------------------------------------------------


def V(*a):
    return np.array(a, dtype=np.float64)


def dot(a, b):
    return (a * b).sum(-1)


def norm(a):
    return np.sqrt(dot(a, a))


def clamp(x, a, b):
    return np.minimum(np.maximum(x, a), b)


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rot_x(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


class Prim:
    """A volume: a field function and the box it lives in (outside the box,
    plus a margin, it reports 'far' without being evaluated)."""

    def __init__(self, fn, lo, hi):
        self.fn = fn
        self.lo = np.asarray(lo, float)
        self.hi = np.asarray(hi, float)

    def __call__(self, p, margin=0.06):
        inside = np.all((p > self.lo - margin) & (p < self.hi + margin), axis=1)
        out = np.full(len(p), 1.0)
        if inside.any():
            out[inside] = self.fn(p[inside])
        return out


def ellipsoid(c, r, R=None):
    c, r = V(*c), V(*r)

    def fn(p):
        q = p - c
        if R is not None:
            q = q @ R
        k0 = norm(q / r)
        k1 = norm(q / (r * r))
        return k0 * (k0 - 1) / np.maximum(k1, 1e-12)

    m = r.max()
    return Prim(fn, c - m, c + m)


def round_cone(a, b, r1, r2):
    """Inigo Quilez's exact round cone: a capsule whose radius runs r1 -> r2."""
    a, b = V(*a), V(*b)
    ba = b - a
    l2 = ba @ ba
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def fn(p):
        pa = p - a
        y = pa @ ba
        z = y - l2
        xv = pa * l2 - np.outer(y, ba)
        x2 = dot(xv, xv)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

    m = max(r1, r2)
    return Prim(fn, np.minimum(a, b) - m, np.maximum(a, b) + m)


def stroke(pts, radii):
    """A tapering tube through points (a brush stroke): a chain of round cones."""
    parts = [round_cone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
    lo = np.min([q.lo for q in parts], axis=0)
    hi = np.max([q.hi for q in parts], axis=0)

    def fn(p):
        return np.min([q.fn(p) for q in parts], axis=0)

    return Prim(fn, lo, hi)


def round_box(c, half, r, R=None):
    c, half = V(*c), V(*half)

    def fn(p):
        q = p - c
        if R is not None:
            q = q @ R
        q = np.abs(q) - (half - r)
        return norm(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - r

    m = norm(half[None])[0]
    return Prim(fn, c - m, c + m)


def tilted_torus(c, R, r, sz, slope):
    """torus_y tipped about x so that its plane rises by slope per metre of +z."""
    c = V(*c)
    Rm = rot_x(-math.atan(slope))

    def fn(p):
        q = (p - c) @ Rm
        rho = np.sqrt(q[:, 0] ** 2 + (q[:, 2] / sz) ** 2)
        return np.sqrt((rho - R) ** 2 + q[:, 1] ** 2) - r

    m = R + r
    return Prim(fn, c - V(m, m, m), c + V(m, m, m))


def torus_y(c, R, r, sz=1.0):
    """A ring around the vertical axis through c (z squashed by sz)."""
    c = V(*c)

    def fn(p):
        q = p - c
        rho = np.sqrt(q[:, 0] ** 2 + (q[:, 2] / sz) ** 2)
        return np.sqrt((rho - R) ** 2 + q[:, 1] ** 2) - r

    m = R + r
    return Prim(fn, c - V(m, r, m), c + V(m, r, m))


# --------------------------------------------------------------------------------
# rig: the game's skeleton, re-proportioned to the reference (about 5.5 heads
# tall, 1.58 m to the top of the hair). The arms are bound abducted so the
# puffy sleeves are modelled clear of the jacket; the game's poses set absolute
# rotations, so the bind angle never shows in motion.
# --------------------------------------------------------------------------------

HIP_Y = 0.74
HIP_JOINT = (0.085, 0.705)
THIGH = 0.23
SHIN = 0.36
TOE = (0.07, 0.11)  # foot bone -> ball of the foot (down, forward)
CHEST_Y = 1.0
SHOULDER = (0.165, 1.165)
UPPER_ARM = 0.21
FOREARM = 0.19
ARM_REST = 0.5
# The head and hair are sculpted in their own space and placed scaled on a
# longer neck: the reference is about six and a half heads tall, not a toy.
HEAD_S = 0.8
HEAD_PIV = V(0, 1.3, 0)  # sculpt space
HEAD_AT = V(0, 1.36, 0)  # where that point sits on the body


def to_head(p):
    return (p - HEAD_AT) / HEAD_S + HEAD_PIV


def from_head(q):
    return (q - HEAD_PIV) * HEAD_S + HEAD_AT


HEAD_Y = float(from_head(V(0, 1.295, 0))[1])
SIDES = [(-1, 'L'), (1, 'R')]

# The cape is simulated in the game (src/game/outfit.js); all that is sculpted
# of it here is what sits still at the neck: a soft gathered roll round the
# base of the neck that the cloth hangs from (closed at the throat by a little
# brass toggle) and the hood, lying bunched on the upper back over the cloth.
# The roll is a ring tipped up toward the back (rise per metre of +z).
COLLAR = dict(c=(0.0, 1.228, 0.006), R=0.074, r=0.019, sz=0.95, slope=0.22, gathers=7)
HOOD = dict(top=1.238, mid=1.19, tip=1.1, half=0.112, puff=0.03, inner=0.02)


POUCH = (-0.19, 0.745, 0.03)
POUCH_LID = (-0.036, -0.03, 0.0)

# clumps of hair on springs (pivots inside the skull)
HAIR_C = from_head(V(0, 1.44, 0.01))
HAIR_BONES = {'hairF': V(0, 0.55, -0.83), 'hairT': V(0, 1, 0.1), 'hairB': V(0, 0.2, 0.98)}

BONES = []  # dicts: name, parent, p (local), q (local quaternion xyzw), world matrix
IDX = {}


def quat_axis(axis, angle):
    s = math.sin(angle / 2)
    return [axis[0] * s, axis[1] * s, axis[2] * s, math.cos(angle / 2)]


def bone(name, parent, p, axis=(0, 0, 1), angle=0.0):
    R = {(1, 0, 0): rot_x, (0, 1, 0): rot_y, (0, 0, 1): rot_z}[tuple(axis)](angle)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = p
    W = BONES[IDX[parent]]['world'] @ M if parent else M
    IDX[name] = len(BONES)
    BONES.append(dict(name=name, parent=parent, p=list(map(float, p)), q=quat_axis(axis, angle), world=W))
    return name


def world_pos(name):
    return BONES[IDX[name]]['world'][:3, 3].copy()


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.08, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.08, 0))
    bone('neck', 'chest', (0, 0.235, 0))
    bone('head', 'neck', (0, HEAD_Y - CHEST_Y - 0.235, 0))
    for name, d in HAIR_BONES.items():
        piv = HAIR_C + d / np.linalg.norm(d) * 0.07 * HEAD_S
        bone(name, 'head', piv - V(0, HEAD_Y, 0))
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.05, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.05), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))  # the ball of the boot
    bone('sim', None, (0, 0, 0))
    bone('pouch', 'sim', POUCH)
    bone('pouchLid', 'pouch', POUCH_LID)


# --------------------------------------------------------------------------------
# skin weights: each volume says which bones move it; a vertex takes its
# weights from the volumes that own it (by how close each surface is)
# --------------------------------------------------------------------------------


def rigid(b):
    return lambda p: [(IDX[b], np.ones(len(p)))]


def along(coord, ctrl):
    """Blend through bones by a coordinate: ctrl = [(t, bone), ...] ascending."""

    def fn(p):
        t = coord(p)
        out = []
        n = len(ctrl)
        w = [np.zeros(len(p)) for _ in ctrl]
        w[0] = np.where(t <= ctrl[0][0], 1.0, 0.0)
        w[-1] = w[-1] + np.where(t > ctrl[-1][0], 1.0, 0.0)
        for i in range(n - 1):
            t0, t1 = ctrl[i][0], ctrl[i + 1][0]
            inside = (t > t0) & (t <= t1)
            u = smooth(t0, t1, t) if t1 > t0 else np.ones(len(p))
            w[i] = w[i] + np.where(inside, 1 - u, 0.0)
            w[i + 1] = w[i + 1] + np.where(inside, u, 0.0)
        for (t, b), wi in zip(ctrl, w):
            out.append((IDX[b], wi))
        return out

    return fn


def by_y(ctrl):
    return along(lambda p: p[:, 1], ctrl)


def by_axis(a, d, ctrl):
    a, d = V(*a), V(*d)
    return along(lambda p: (p - a) @ d, ctrl)


# --------------------------------------------------------------------------------
# garments
# --------------------------------------------------------------------------------

MAT = dict(face=1, hair=2, jacket=3, tee=4, shorts=5, leg=6, boot=7, hand=8, hood=9, cape=10, pouch=11, brass=12)


class Garment:
    """One continuous surface: a field, the volumes that own (and weight) it,
    the box and voxel size it is sampled at, and a triangle budget."""

    def __init__(self, name, mat, h, lo, hi, field, owners, target, tau=0.012, outline=1.0, details=None, mats=None):
        self.name, self.mat, self.h = name, mat, h
        self.lo, self.hi = np.asarray(lo, float), np.asarray(hi, float)
        self.field, self.owners, self.target = field, owners, target
        self.tau, self.outline, self.details, self.mats = tau, outline, details, mats


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


def seams(c, first, pitch, count, depth=0.0055, w=0.0065):
    """Quilting: shallow rounded grooves at first + i * pitch."""
    k = np.clip(np.round((c - first) / pitch), 0, count - 1)
    return depth * np.exp(-(((c - (first + k * pitch)) / w) ** 2))


def in_head(prim):
    """A volume sculpted in head space, placed on the body."""
    return Prim(lambda p: HEAD_S * prim.fn(to_head(p)), from_head(prim.lo), from_head(prim.hi))


def head_garment(g):
    """Place a garment sculpted in head space: its field, owners and box move
    with the head; its detail coordinates stay in head space (the face is
    drawn there)."""
    f = g.field
    g.field = lambda p: HEAD_S * f(to_head(p))
    g.owners = [(in_head(q), w) for q, w in g.owners]
    g.lo, g.hi = from_head(g.lo), from_head(g.hi)
    g.details = lambda p, n, own: np.concatenate([to_head(p), np.zeros((len(p), 1))], 1)
    return g


def head_prims():
    cran = ellipsoid((0, 1.44, 0.01), (0.104, 0.113, 0.106))
    face = ellipsoid((0, 1.372, -0.026), (0.088, 0.085, 0.082))
    cheeks = [ellipsoid((s * 0.048, 1.357, -0.057), (0.038, 0.032, 0.032)) for s, _ in SIDES]
    chin = ellipsoid((0, 1.305, -0.05), (0.032, 0.022, 0.026))
    return cran, face, cheeks, chin


def skull(p):
    """The head without ears, nose and neck: what the hair is laid over."""
    cran, face, cheeks, chin = head_prims()
    d = smin(cran(p), face(p), 0.045)
    for c in cheeks:
        d = smin(d, c(p), 0.03)
    return smin(d, chin(p), 0.025)


def g_head():
    cran, face, cheeks, chin = head_prims()
    nose = ellipsoid((0, 1.383, -0.11), (0.012, 0.016, 0.012))
    ears = [ellipsoid((s * 0.107, 1.402, 0.012), (0.015, 0.03, 0.024), rot_y(s * 0.35)) for s, _ in SIDES]
    neck = round_cone(to_head(V(0, 1.18, 0.012)), (0, 1.33, 0.0), 0.043 / HEAD_S, 0.041 / HEAD_S)

    def field(p):
        d = skull(p)
        d = smin(d, nose(p), 0.012)
        for e in ears:
            d = smin(d, e(p), 0.008)
        return smin(d, neck(p), 0.035)

    head = rigid('head')
    owners = [(cran, head), (face, head), (chin, head), (nose, head)] + [(c, head) for c in cheeks] + [(e, head) for e in ears]
    owners.append((neck, by_y([(1.225, 'chest'), (1.275, 'neck'), (1.345, 'head')])))
    return head_garment(Garment('head', MAT['face'], 0.0025, (-0.135, 1.0, -0.145), (0.135, 1.585, 0.14), field, owners, 2600))


def hair_angle(p):
    return np.abs(np.arctan2(p[:, 0], -(p[:, 2] - 0.01)))


def hairline(p):
    # by angle around the head (0 = front, pi/2 = above the ear, pi = nape):
    # forehead, temples, a short sideburn in front of the ear, over the ear, nape
    th = hair_angle(p)
    return np.interp(th, [0, 0.5, 0.9, 1.08, 1.22, 1.36, 1.5, 1.8, 2.1, 2.6, math.pi],
                     [1.478, 1.47, 1.452, 1.425, 1.385, 1.392, 1.44, 1.415, 1.36, 1.33, 1.318])


def g_hair():
    # one mass laid over the skull: thin and close at the sides and nape, full
    # on top, then a few large curls that break the outline into soft scallops
    def mass(p):
        y, z = p[:, 1], p[:, 2]
        thick = 0.011 + 0.024 * smooth(1.42, 1.53, y) + 0.008 * smooth(0.0, -0.1, z) * smooth(1.46, 1.54, y)
        return skull(p) - thick

    base = Prim(mass, (-0.13, 1.3, -0.15), (0.13, 1.62, 0.14))
    clumps = [ellipsoid(c, r, rot_x(a)) for c, r, a in [
        ((-0.064, 1.552, -0.05), (0.054, 0.036, 0.056), -0.5),
        ((0.008, 1.566, -0.066), (0.056, 0.036, 0.054), -0.55),
        ((0.074, 1.542, -0.036), (0.05, 0.036, 0.054), -0.4),
        ((-0.054, 1.57, 0.03), (0.058, 0.034, 0.06), 0.1),
        ((0.048, 1.57, 0.03), (0.056, 0.034, 0.06), 0.1),
        ((0.0, 1.54, 0.088), (0.07, 0.042, 0.044), 0.5),
        ((-0.1, 1.5, 0.0), (0.034, 0.042, 0.064), 0.0),
        ((0.1, 1.5, 0.0), (0.034, 0.042, 0.064), 0.0),
    ]]
    curls = [
        stroke([(-0.03, 1.555, -0.088), (-0.064, 1.52, -0.12), (-0.074, 1.486, -0.118), (-0.058, 1.47, -0.102)], [0.032, 0.023, 0.014, 0.008]),
        stroke([(0.02, 1.56, -0.092), (0.032, 1.52, -0.126), (0.047, 1.489, -0.122), (0.064, 1.484, -0.102)], [0.031, 0.022, 0.013, 0.007]),
    ] + [stroke([(s * 0.088, 1.535, -0.05), (s * 0.11, 1.497, -0.068), (s * 0.112, 1.46, -0.066)], [0.03, 0.02, 0.01]) for s, _ in SIDES]

    def field(p):
        d = smax(base(p), hairline(p) - p[:, 1], 0.01)
        for q in clumps:
            d = smin(d, q(p), 0.011)
        for q in curls:
            d = smin(d, q(p), 0.012)
        return d

    owners = [(base, rigid('head'))]
    owners += [(q, rigid('hairF' if i < 3 else 'hairT' if i < 5 else 'hairB' if i < 6 else 'head')) for i, q in enumerate(clumps)]
    owners += [(q, rigid('hairF')) for q in curls]
    return head_garment(Garment('hair', MAT['hair'], 0.0025, (-0.16, 1.3, -0.17), (0.16, 1.68, 0.17), field, owners, 2400, tau=0.01))


def g_tee():
    # only its crew neck shows, between the zipped puffer and the cape's collar
    tee = round_cone((0, 1.15, 0.01), (0, 1.235, 0.006), 0.056, 0.05)
    return Garment('tee', MAT['tee'], 0.004, (-0.1, 1.08, -0.08), (0.1, 1.3, 0.09), tee, [(tee, rigid('chest'))], 400, outline=0.0)


TORSO_SEAMS = (0.795, 0.072, 5)
SLEEVE_SEAMS = (0.105, 0.09, 3)
CUFF_U = 0.352


# The puffer's volumes (centre, radii): the yoke slopes from the collar into
# a rounded cap over each shoulder joint, so the sleeves grow out of the
# shoulders instead of hanging under a shelf.
JACKET = dict(
    belly=((0, 0.8, 0.006), (0.19, 0.15, 0.15)),
    chest=((0, 1.045, 0.012), (0.153, 0.16, 0.128)),
    shoulders=((0, 1.138, 0.012), (0.155, 0.08, 0.11)),
    cap=0.084,  # shoulder caps, centred a little down each arm
    blend=0.06,  # how softly the sleeves join the body
)


def jacket_prims():
    """The puffer's volumes: belly, chest, the shoulders' yoke, the hollow cut
    under its hem, and per side the shoulder cap, upper sleeve, forearm and
    cuff."""
    J = JACKET
    belly = ellipsoid(*J['belly'])
    chest = ellipsoid(*J['chest'])
    shoulders = ellipsoid(*J['shoulders'])
    hollow = ellipsoid((0, 0.715, 0.006), (0.165, 0.05, 0.127))
    sleeves = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        sleeves.append((
            round_cone(S + 0.02 * d, E, 0.077, 0.072),
            round_cone(E, W - 0.03 * d, 0.072, 0.063),
            round_cone(W - 0.045 * d, W + 0.012 * d, 0.05, 0.047),
            S, d,
            ellipsoid(S + 0.03 * d - 0.012 * out, (J['cap'], J['cap'], J['cap'] * 0.95)),
        ))
    return belly, chest, shoulders, hollow, sleeves


def jacket_body(p, prims):
    belly, chest, shoulders, hollow, sleeves = prims
    t = smin(belly(p), chest(p), 0.09)
    t = smin(t, shoulders(p), 0.05)
    for up, lo, cuff, S, d, cap in sleeves:
        t = smin(t, cap(p), 0.05)
    return t


def jacket_smooth(p, prims):
    """The jacket without its quilting: the surface the cape and hood lie on."""
    t = jacket_body(p, prims)
    for up, lo, cuff, S, d, cap in prims[4]:
        t = smin(t, smin(up(p), lo(p), 0.02), JACKET['blend'])
    return t


def g_jacket():
    prims = jacket_prims()
    belly, chest, shoulders, hollow, sleeves = prims
    arms = [arm_frame(s) for s, _ in SIDES]

    def torso_y(p):
        return p[:, 1] + 0.01 * clamp(-p[:, 2] / 0.15, 0, 1)

    def field(p):
        y = p[:, 1]
        t = jacket_body(p, prims)
        t = smax(t, 0.728 - y, 0.022)
        t = smax(t, -hollow(p), 0.008)
        t = t + seams(torso_y(p), *TORSO_SEAMS) * smooth(1.13, 1.09, y)
        for up, lo, cuff, S, d, cap in sleeves:
            u = (p - S) @ d
            sl = smin(up(p), lo(p), 0.02) + seams(u, *SLEEVE_SEAMS) * smooth(0.04, 0.08, u)
            sl = smin(sl, cuff(p), 0.008)
            t = smin(t, sl, JACKET['blend'])
        return t

    torso_w = by_y([(0.79, 'hips'), (0.9, 'spine'), (1.0, 'spine'), (1.08, 'chest')])
    owners = [(belly, torso_w), (chest, torso_w), (shoulders, torso_w)]
    n_torso = len(owners)
    for (up, lo, cuff, S, d, cap), (s, L) in zip(sleeves, SIDES):
        # (the padded cap blends over a long stretch, so a swinging arm bends
        # the shoulder rather than hinging at a seam; the cap itself rides
        # half on the collarbone, half on the arm)
        w = by_axis(S, d, [(-0.02, 'clav' + L), (0.1, 'arm' + L), (0.185, 'arm' + L), (0.235, 'fore' + L)])
        owners += [(up, w), (lo, w), (cuff, rigid('fore' + L)), (cap, w)]

    def details(p, n, own):
        torso = own[:, :n_torso].sum(1)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        return np.stack([(torso_y(p) - TORSO_SEAMS[0]) / TORSO_SEAMS[1], (u - SLEEVE_SEAMS[0]) / SLEEVE_SEAMS[1], torso, u], 1)

    return Garment('jacket', MAT['jacket'], 0.005, (-0.47, 0.68, -0.21), (0.47, 1.3, 0.21), field, owners, 5200, tau=0.015, details=details)


SHORTS_HEM = 0.6


def g_shorts():
    pelvis = ellipsoid((0, 0.775, 0.008), (0.148, 0.125, 0.12))
    legs = [round_cone((s * 0.085, 0.7, 0.006), (s * 0.098, 0.6, 0.01), 0.083, 0.074) for s, _ in SIDES]
    holes = [round_cone((s * 0.094, 0.665, 0.009), (s * 0.098, 0.55, 0.01), 0.056, 0.056) for s, _ in SIDES]

    def inseam(p):
        x, y = p[:, 0], p[:, 1]
        return np.maximum(np.abs(x) - (0.004 + np.maximum(0, 0.665 - y) * 0.25), y - 0.665)

    def field(p):
        d = pelvis(p)
        for q in legs:
            d = smin(d, q(p), 0.04)
        d = smax(d, -inseam(p), 0.012)
        d = smax(d, SHORTS_HEM - p[:, 1], 0.01)
        for q in holes:
            d = smax(d, -q(p), 0.008)
        return d

    owners = [(pelvis, rigid('hips'))] + [(q, by_y([(0.66, 'thigh' + L), (0.72, 'hips')])) for q, (s, L) in zip(legs, SIDES)]
    return Garment('shorts', MAT['shorts'], 0.0035, (-0.2, 0.56, -0.15), (0.2, 0.92, 0.16), field, owners, 2000, tau=0.02)


SOCK_Y = 0.36


def g_legs():
    prims, owners = [], []
    for s, L in SIDES:
        kn = HIP_JOINT[1] - THIGH
        w = by_y([(0.13, 'foot' + L), (0.17, 'shin' + L), (kn - 0.03, 'shin' + L), (kn + 0.025, 'thigh' + L)])
        thigh = round_cone((s * 0.085, 0.69, 0.004), (s * 0.088, kn, 0.0), 0.067, 0.045)
        calf = round_cone((s * 0.088, kn - 0.005, 0.002), (s * 0.09, 0.39, 0.014), 0.044, 0.049)
        shin = round_cone((s * 0.09, 0.39, 0.012), (s * 0.09, 0.13, 0.002), 0.047, 0.031)
        knee = ellipsoid((s * 0.088, kn + 0.006, -0.028), (0.026, 0.03, 0.017))
        cuff = torus_y((s * 0.09, SOCK_Y, 0.008), 0.047, 0.0045)
        prims.append((thigh, calf, shin, knee, cuff))
        owners += [(q, w) for q in (thigh, calf, shin, knee, cuff)]

    def field(p):
        out = np.full(len(p), 1.0)
        for thigh, calf, shin, knee, cuff in prims:
            d = smin(smin(thigh(p), calf(p), 0.03), shin(p), 0.05)
            d = smin(d, knee(p), 0.02)
            d = smin(d, cuff(p), 0.006)
            out = np.minimum(out, d)
        return out

    return Garment('legs', MAT['leg'], 0.004, (-0.17, 0.08, -0.08), (0.17, 0.78, 0.08), field, owners, 1800, tau=0.015)


BOOT_X = 0.09


BOOT_COLLAR = (0.214, 0.3)
SOLE_H = 0.05  # outsole and midsole  # collar height over the ankle, rise per metre toward the heel


def collar_y(z):
    return BOOT_COLLAR[0] + BOOT_COLLAR[1] * (z - 0.004)


def toe_lift(z):
    return 0.028 * smooth(-0.08, -0.205, z) ** 2


def g_boots():
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * BOOT_X

        def sole_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1], p[:, 2]
            # footprint: an uneven capsule from heel (r 0.046) to toe (r 0.052)
            px, py = np.abs(x), 0.045 - z
            r1, r2, h = 0.05, 0.058, 0.195
            b = (r1 - r2) / h
            a = math.sqrt(1 - b * b)
            k = -b * px + a * py
            d2 = np.where(k < 0, np.sqrt(px ** 2 + py ** 2) - r1,
                          np.where(k > a * h, np.sqrt(px ** 2 + (py - h) ** 2) - r2, a * px + b * py - r1))
            yy = y - toe_lift(z)
            r = 0.007
            wx, wy = d2 + r, np.abs(yy - SOLE_H / 2) - SOLE_H / 2 + r
            return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - r

        sole = Prim(sole_fn, (bx - 0.065, -0.01, -0.24), (bx + 0.065, 0.07, 0.11))
        foot = round_cone((bx, 0.084, 0.035), (bx, 0.07, -0.13), 0.054, 0.046)
        toebox = ellipsoid((bx, 0.066, -0.152), (0.053, 0.037, 0.058))
        instep = round_cone((bx, 0.072, -0.1), (bx, 0.135, -0.035), 0.046, 0.049)
        heel = ellipsoid((bx, 0.07, 0.06), (0.05, 0.045, 0.03))
        shaft_c = round_cone((bx, 0.09, 0.008), (bx, 0.25, 0.004), 0.054, 0.05)
        shaft = Prim(lambda p, s_=shaft_c: smax(s_.fn(p), p[:, 1] - collar_y(p[:, 2]), 0.008), shaft_c.lo, shaft_c.hi)
        collar = tilted_torus((bx, collar_y(0.004) + 0.006, 0.004), 0.047, 0.015, 1.06, BOOT_COLLAR[1])
        tongue = round_box((bx, 0.195, -0.052), (0.023, 0.045, 0.01), 0.01, rot_x(-0.32))
        hole = round_cone((bx, 0.15, 0.004), (bx, 0.32, 0.004), 0.04, 0.042)
        parts.append((sole, foot, toebox, instep, heel, shaft, collar, tongue, hole))
        low = along(lambda p: p[:, 2], [(-0.125, 'toe' + L), (-0.08, 'foot' + L)])
        high = by_y([(0.18, 'foot' + L), (0.23, 'shin' + L)])
        owners += [(sole, low), (foot, low), (toebox, low), (instep, low), (heel, rigid('foot' + L)), (shaft, high), (collar, high), (tongue, high)]

    def field(p):
        out = np.full(len(p), 1.0)
        for sole, foot, toebox, instep, heel, shaft, collar, tongue, hole in parts:
            d = smin(sole(p), foot(p), 0.015)
            d = smin(d, toebox(p), 0.02)
            d = smin(d, instep(p), 0.03)
            d = smin(d, heel(p), 0.02)
            d = smin(d, shaft(p), 0.035)
            d = smin(d, collar(p), 0.012)
            d = smin(d, tongue(p), 0.01)
            d = smax(d, -hole(p), 0.006)
            out = np.minimum(out, d)
        return out

    return Garment('boots', MAT['boot'], 0.0035, (-0.16, -0.012, -0.235), (0.16, 0.26, 0.13), field, owners, 2800, tau=0.012)


def g_hands():
    parts, owners = [], []
    fw = V(0, 0, -1)
    for s, L in SIDES:
        S, E, W, dn, out = arm_frame(s)
        R = np.stack([out, dn, fw], 1)  # columns: local axes in world
        palm = round_box(W + 0.046 * dn, (0.021, 0.045, 0.04), 0.015, R)
        c = W + 0.092 * dn - 0.009 * out
        fingers = round_cone(c - 0.029 * fw, c + 0.029 * fw, 0.021, 0.02)
        thumb = round_cone(W + 0.038 * dn - 0.011 * out + 0.034 * fw, W + 0.084 * dn - 0.025 * out + 0.025 * fw, 0.015, 0.0115)
        wrist = round_cone(W - 0.03 * dn, W + 0.02 * dn, 0.03, 0.028)
        parts.append((palm, fingers, thumb, wrist))
        hand = rigid('hand' + L)
        owners += [(palm, hand), (fingers, hand), (thumb, hand), (wrist, by_axis(W, dn, [(-0.01, 'fore' + L), (0.015, 'hand' + L)]))]

    def field(p):
        out = np.full(len(p), 1.0)
        for palm, fingers, thumb, wrist in parts:
            d = smin(palm(p), fingers(p), 0.012)
            d = smin(d, thumb(p), 0.01)
            d = smin(d, wrist(p), 0.015)
            out = np.minimum(out, d)
        return out

    return Garment('hands', MAT['hand'], 0.0025, (-0.5, 0.64, -0.08), (0.5, 0.9, 0.08), field, owners, 1200)


def g_hood():
    """What sits still of the cape: the gathered roll round the base of the
    neck, the toggle that closes it at the throat, and the hood lying bunched
    on the upper back (over the simulated cloth, which hangs from under the
    roll)."""
    C, H = COLLAR, HOOD
    prims = jacket_prims()
    c = V(*C['c'])
    Rm = rot_x(-math.atan(C['slope']))

    def roll_parts(p):
        q = (p - c) @ Rm
        th = np.arctan2(q[:, 0], q[:, 2])
        rho = np.sqrt(q[:, 0] ** 2 + (q[:, 2] / C['sz']) ** 2)
        # soft gathers, fuller at the back where the hood is drawn in, and
        # smoothing out toward the toggle at the throat
        g = 1 + 0.13 * np.sin(th * C['gathers']) * smooth(2.75, 2.2, np.abs(th))
        r = C['r'] * g * (1 + 0.22 * smooth(1.3, 0.2, np.abs(th)))
        return np.sqrt((rho - C['R']) ** 2 + q[:, 1] ** 2) - r, th

    roll = Prim(lambda p: roll_parts(p)[0], c - V(0.11, 0.06, 0.11), c + V(0.11, 0.06, 0.11))
    front = c + V(0, -C['slope'] * C['R'] * C['sz'], -C['R'] * C['sz'])
    toggle = round_cone(front + V(-0.013, -0.006, -0.016), front + V(0.013, -0.004, -0.016), 0.0065, 0.0065)

    def hood_parts(p):
        x, y = p[:, 0], p[:, 1]
        J = jacket_smooth(p, prims)
        t = clamp((H['mid'] - y) / (H['mid'] - H['tip']), 0, 1)
        tt = clamp((y - H['mid']) / (H['top'] - H['mid']), 0, 1)
        hw = (H['half'] * (1 - t ** 2) ** 0.7 + 0.003) * (1 - 0.3 * tt ** 2)
        a = clamp(np.abs(x) / hw, 0, 1)
        body = smooth(H['tip'] - 0.004, H['tip'] + 0.055, y) * (1 - 0.45 * smooth(H['mid'], H['top'] + 0.01, y))
        # the seam down the middle of the hood sinks into a soft crease
        crease = 0.009 * np.exp(-(x / 0.017) ** 2) * smooth(H['tip'], H['tip'] + 0.07, y) * smooth(H['top'], H['mid'] - 0.02, y)
        puff = H['puff'] * (1 - a ** 2) ** 0.6 * body - crease
        return J, hw, puff

    def hood_fn(p):
        y, z = p[:, 1], p[:, 2]
        J, hw, puff = hood_parts(p)
        d = np.maximum(J - (H['inner'] + 0.004 + puff), H['inner'] - J)
        d = smax(d, np.abs(p[:, 0]) - hw, 0.008)
        d = smax(d, H['tip'] - y, 0.008)
        d = smax(d, y - (H['top'] + 0.02), 0.008)
        return smax(d, 0.015 - z, 0.01)

    hood = Prim(hood_fn, (-0.15, H['tip'] - 0.01, -0.02), (0.15, H['top'] + 0.04, 0.22))

    def field(p):
        d = smin(roll(p), hood(p), 0.014)
        return smin(d, toggle(p), 0.004)

    roll_w = by_y([(1.235, 'chest'), (1.29, 'neck')])
    owners = [(roll, roll_w), (hood, rigid('chest')), (toggle, rigid('chest'))]

    def details(p, n, own):
        # x: across the hood (0 on its seam), y: in from its edge (m), z: on
        # the hood rather than the roll, w: the lining showing in its opening
        J, hw, puff = hood_parts(p)
        on_hood = own[:, 1]
        lining = on_hood * smooth(H['top'] - 0.03, H['top'] - 0.012, p[:, 1]) * (p[:, 2] > 0.02)
        edge = np.minimum(hw - np.abs(p[:, 0]), (p[:, 1] - H['tip']) * 0.8)
        edge = np.where(on_hood > 0.5, edge, 1.0)
        return np.stack([p[:, 0] / np.maximum(hw, 1e-3), edge, on_hood, lining], 1)

    def mats(p, n, own):
        return np.where(own[:, 2] > 0.5, MAT['brass'], MAT['hood'])

    return Garment('hood', MAT['hood'], 0.0028, (-0.16, 1.02, -0.12), (0.16, 1.3, 0.23), field, owners, 2600, tau=0.008, details=details, mats=mats)


def g_pouch():
    P = V(*POUCH)
    lid = P + V(*POUCH_LID)
    strap = round_box(P + V(0, -0.005, 0), (0.008, 0.03, 0.014), 0.004)
    body = round_box(P + V(-0.012, -0.068, 0), (0.022, 0.036, 0.038), 0.012)
    flap = round_box(lid + V(-0.002, -0.018, 0), (0.006, 0.022, 0.039), 0.005)
    snap = ellipsoid(lid + V(-0.008, -0.034, 0), (0.005, 0.007, 0.007))

    def field(p):
        d = smin(strap(p), body(p), 0.008)
        d = smin(d, flap(p), 0.004)
        return smin(d, snap(p), 0.002)

    owners = [(strap, rigid('pouch')), (body, rigid('pouch')), (flap, rigid('pouchLid')), (snap, rigid('pouchLid'))]

    def details(p, n, own):
        return np.stack([own[:, 2], np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    def mats(p, n, own):
        return np.where(own[:, 3] > 0.5, MAT['brass'], MAT['pouch'])

    return Garment('pouch', MAT['pouch'], 0.0025, P + V(-0.06, -0.12, -0.06), P + V(0.03, 0.04, 0.06), field, owners, 700, tau=0.006, details=details, mats=mats)


def cloth_colliders():
    """The volumes the cape's cloth is kept out of, in bind space, each with
    the bone that carries it: the jacket's own (ellipsoids and round cones,
    exactly as sculpted) and the shorts' seat."""
    J = JACKET
    ell = lambda bone, cr: dict(bone=bone, kind='ell', c=list(cr[0]), r=list(cr[1]))
    out = [
        ell('chest', J['chest']),
        ell('chest', J['shoulders']),
        ell('spine', J['belly']),
        dict(bone='hips', kind='ell', c=[0, 0.775, 0.008], r=[0.15, 0.127, 0.122]),
    ]
    for (s, L) in SIDES:
        S, E, W, d, o = arm_frame(s)
        cap = S + 0.03 * d - 0.012 * o
        # (the cap's top rides mostly on the collarbone, as it is weighted)
        out.append(dict(bone='clav' + L, kind='cap', a=list(cap - 0.012 * d), b=list(cap + 0.02 * d), ra=J['cap'] + 0.004, rb=J['cap']))
        out.append(dict(bone='arm' + L, kind='cap', a=list(S + 0.02 * d), b=list(E), ra=0.077, rb=0.072))
        out.append(dict(bone='fore' + L, kind='cap', a=list(E), b=list(W - 0.03 * d), ra=0.072, rb=0.063))
    return [{k: (round(float(v), 5) if isinstance(v, float) else [round(float(x), 5) for x in v] if isinstance(v, list) else v) for k, v in c.items()} for c in out]


# --------------------------------------------------------------------------------
# meshing, weights, export
# --------------------------------------------------------------------------------


def sample(field, pts, chunk=400000):
    return np.concatenate([field(pts[i:i + chunk]) for i in range(0, len(pts), chunk)])


def gradient(field, p, e=5e-4):
    g = np.zeros_like(p)
    for k in range(3):
        o = np.zeros(3)
        o[k] = e
        g[:, k] = (field(p + o) - field(p - o)) / (2 * e)
    return g / np.maximum(norm(g), 1e-9)[:, None]


def polygonise(g):
    h = g.h
    axes = [np.arange(g.lo[k], g.hi[k] + h, h) for k in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing='ij'), -1).reshape(-1, 3)
    vol = sample(g.field, grid).reshape(len(axes[0]), len(axes[1]), len(axes[2]))
    edge = np.concatenate([vol[0].ravel(), vol[-1].ravel(), vol[:, 0].ravel(), vol[:, -1].ravel(), vol[:, :, 0].ravel(), vol[:, :, -1].ravel()])
    if (edge <= 0).any():
        print(f'  warning: {g.name} touches its box', file=sys.stderr)
    verts, faces, _, _ = marching_cubes(vol, 0.0, spacing=(h, h, h))
    verts += g.lo
    if g.target and len(faces) > g.target:
        verts, faces = fast_simplification.simplify(verts, faces.astype(np.int32), target_count=g.target, agg=5)
    # back onto the exact surface, with normals from the field itself
    for _ in range(2):
        n = gradient(g.field, verts)
        d = g.field(verts)
        verts = verts - np.clip(d, -h, h)[:, None] * n
    n = gradient(g.field, verts)
    a, b, c = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    fn = np.cross(b - a, c - a)
    if dot(fn, n[faces[:, 0]] + n[faces[:, 1]] + n[faces[:, 2]]).mean() < 0:
        faces = faces[:, ::-1]
    return verts, n, faces


def skin_weights(g, p):
    ds = np.stack([o(p) for o, _ in g.owners], 1)
    own = np.exp(-(ds - ds.min(1, keepdims=True)) / g.tau)
    own /= own.sum(1, keepdims=True)
    W = np.zeros((len(p), len(BONES)))
    rows = np.arange(len(p))
    for i, (_, fn) in enumerate(g.owners):
        for b, w in fn(p):
            np.add.at(W, (rows, b), own[:, i] * w) if np.ndim(b) else np.add.at(W[:, b], rows, own[:, i] * w)
    top = np.argsort(-W, 1)[:, :4]
    tw = np.take_along_axis(W, top, 1)
    tw /= np.maximum(tw.sum(1, keepdims=True), 1e-9)
    # quantise to bytes summing to exactly 255
    q = np.floor(tw * 255).astype(int)
    q[:, 0] += 255 - q.sum(1)
    return top.astype(np.uint8), q.astype(np.uint8), own


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_hair(), g_tee(), g_jacket(), g_shorts(), g_legs(), g_boots(), g_hands(), g_hood(), g_pouch()]
    P, N, F, M, D, SI, SW, parts = [], [], [], [], [], [], [], []
    base = 0
    for g in garments:
        t1 = time.time()
        v, n, f = polygonise(g)
        si, sw, own = skin_weights(g, v)
        det = g.details(v, n, own) if g.details else np.zeros((len(v), 4))
        mat = g.mats(v, n, own) if g.mats else np.full(len(v), g.mat)
        P.append(v), N.append(n), F.append(f + base), M.append(mat), D.append(det), SI.append(si), SW.append(sw)
        parts.append(dict(name=g.name, start=int(base), count=int(len(v)), outline=g.outline))
        base += len(v)
        print(f'  {g.name:7s} {len(v):6d} verts {len(f):6d} tris  {time.time() - t1:5.1f}s')
    P, N, F = np.concatenate(P), np.concatenate(N), np.concatenate(F)
    M, D, SI, SW = np.concatenate(M), np.concatenate(D), np.concatenate(SI), np.concatenate(SW)
    nv, nt = len(P), len(F)
    index_type = 'u16' if nv < 65536 else 'u32'
    blobs = [
        ('position', P.astype('<f4')),
        ('normal', np.clip(np.round(N * 32767), -32767, 32767).astype('<i2')),
        ('detail', D.astype('<f4')),
        ('material', M.astype(np.uint8)),
        ('skinIndex', SI),
        ('skinWeight', SW),
        ('index', F.astype('<u2' if index_type == 'u16' else '<u4')),
    ]
    layout, buf = {}, bytearray()
    for name, arr in blobs:
        while len(buf) % 4:
            buf.append(0)
        layout[name] = dict(offset=len(buf), length=int(arr.size))
        buf += arr.tobytes()
    meta = dict(
        note='Generated by tools/runner/build.py - do not edit by hand.',
        vertices=nv, triangles=nt, indexType=index_type, layout=layout, parts=parts, materials=MAT,
        bones=[dict(name=b['name'], parent=b['parent'], p=[round(x, 6) for x in b['p']], q=[round(x, 7) for x in b['q']]) for b in BONES],
        rig=dict(
            hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
            shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST,
            collar=COLLAR, hood=HOOD, cloth=cloth_colliders(), pouch=list(POUCH), pouchLid=list(POUCH_LID),
            hair=[dict(name=k, dir=list(v / np.linalg.norm(v))) for k, v in HAIR_BONES.items()],
            sockY=SOCK_Y, shortsHem=SHORTS_HEM, bootX=BOOT_X, bootCollar=list(BOOT_COLLAR), soleH=SOLE_H, torsoSeams=list(TORSO_SEAMS), sleeveSeams=list(SLEEVE_SEAMS), cuffU=CUFF_U,
        ),
    )
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'runner.bin'), 'wb') as fh:
        fh.write(buf)
    with open(os.path.join(OUT, 'runner.json'), 'w') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    print(f'runner: {nv} vertices, {nt} triangles, {len(buf) / 1024:.0f} KB, {len(BONES)} bones, {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
