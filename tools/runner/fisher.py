#!/usr/bin/env python3
"""Sculpt the fisherman and write assets/fisher/runner.json + runner.bin.

The seventh runner, Reed, sculpted the way the others are (build.py: every
garment one signed-distance field of volumes blended smoothly into each
other, polygonised, skinned by which volume owns each point, linework drawn
by the game's character shader) to his reference sheet
(tools/characters/fisher-sheet.jpg): a sturdy boy of about thirteen, about
six and three-quarter heads tall (1.64 m to the top of his hair), a round
face with full cheeks, a button nose, freckles and a smudge or two of dirt
(the shader draws those), short messy blonde hair in tousled locks; an open
yellow rain jacket, its hood down and bunched on his back, its sleeves
turned back at the wrist, flap pockets at the hips; a teal tee; orange
waterproof bib trousers, their bib and braces showing between the jacket's
open fronts and their baggy legs bunched over black rubber boots.

On his back, a little aquarium for a backpack: a clear cylinder between a
charcoal cap and base, restrained cyan light strips on them, on charcoal
straps. Only the caps and the straps are sculpted; the glass and the water
are drawn by the game (src/game/fisher.js), and the goldfish swimming in it
is sculpted here on bones of its own, which the game swims round the tank.

Over his right shoulder, his rod, gripped by the handle in his right fist:
a cork grip, a spinning reel with a teal spool, the blank tapering away up
and back behind him, teal thread wraps under its guides - meshed directly,
on a bone of its own under 'sim' (the game sets it on his shoulder and
solves his arm to grip it). From its tip the line, and on it a giant
purple alien fish hooked through the lip and hanging head up behind him to
his right: a lavender belly, a big open mouth with crooked teeth, barbels,
amber eyes, flowing fins - on a bone of its own at the rod's tip (the game
swings it as a damped pendulum) with its tail and fins on bones of theirs.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/fisher.py

Coordinates are the game's: meters, y up, the runner facing -z (his right
is +x).
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, round_box, torus_y, Prim, rot_x, rot_y, rot_z, Garment, rigid, by_y, by_axis, along  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'fisher')
SIDES = [(-1, 'L'), (1, 'R')]
FW = V(0, 0, -1)

# --------------------------------------------------------------------------------
# rig: the game's skeleton, proportioned to his sheet - a sturdy boy, about
# six and three-quarter heads to the top of his hair (1.64 m), the knee at
# 0.45 m, the ankle lifted on his boots' soles. The arms are bound a little
# out so the jacket's sleeves are modelled clear of its body.
# --------------------------------------------------------------------------------

HIP_Y = 0.9
HIP_JOINT = (0.088, 0.83)
THIGH = 0.36
SHIN = 0.38
TOE = (0.055, 0.13)
CHEST_Y = 1.15
SHOULDER = (0.158, 1.285)
UPPER_ARM = 0.275
FOREARM = 0.235
ARM_REST = 0.3
NECK_Y = 1.34
HEAD_Y = 1.41
KNEE_Y = HIP_JOINT[1] - THIGH
ANKLE_Y = KNEE_Y - SHIN

# the head (cranium centre, radii): round, a boy's
CRAN = ((0, 1.522, 0.012), (0.095, 0.1, 0.1))

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def unit(*a):
    v = V(*a) if len(a) > 1 else np.asarray(a[0], float)
    return v / np.linalg.norm(v)


def lst(v, k=5):
    return [round(float(x), k) for x in np.ravel(v)]


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


def basis(y, z_hint):
    """A right-handed frame with +y along y and +z as near z_hint as it can."""
    y = unit(y)
    x = unit(np.cross(y, z_hint))
    z = np.cross(x, y)
    return np.stack([x, y, z], 1)


def mat_quat(R):
    """Rotation matrix -> quaternion (x, y, z, w)."""
    m = R
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    if m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    if m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]


def bone_frame(name, parent, p_world, R_world):
    """A bone whose bind frame is R_world (local -> body) at p_world."""
    Pw = BONES[IDX[parent]]['world'] if parent else np.eye(4)
    M = np.eye(4)
    M[:3, :3] = R_world
    M[:3, 3] = p_world
    L = np.linalg.inv(Pw) @ M
    IDX[name] = len(BONES)
    BONES.append(dict(name=name, parent=parent, p=list(map(float, L[:3, 3])), q=[float(x) for x in mat_quat(L[:3, :3])], world=M))
    return name


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
    a = unit(axis)

    def fn(p):
        q = p - c
        h = q @ a
        rho = np.sqrt(np.maximum((q * q).sum(-1) - h * h, 0))
        return np.sqrt((rho - R) ** 2 + h * h) - r

    m = R + r
    return Prim(fn, c - m, c + m)


def cyl(c, axis, r, half, edge=0.004):
    """A rounded cylinder round an axis through c: radius r, half-length half."""
    c = V(*c)
    a = unit(axis)

    def fn(p):
        q = p - c
        h = q @ a
        rho = np.sqrt(np.maximum((q * q).sum(-1) - h * h, 0))
        wx, wy = rho - r + edge, np.abs(h) - half + edge
        return np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2) + np.minimum(np.maximum(wx, wy), 0) - edge

    m = math.hypot(r, half)
    return Prim(fn, c - m, c + m)


# --------------------------------------------------------------------------------
# lofts: a form given by its cross-sections. The primitive blobs build.py's
# figures are made of (ellipsoids, round cones) can't hold the contours of a
# real figure or garment - a shoulder sloping into the arm, a jacket flaring
# to its hem, a boot narrowing at the ankle - so his are lofted: at a series
# of stations (heights, or distances along an axis) each form has its own
# cross-section (an ellipse's half-widths and its centre), interpolated
# smoothly (monotone cubic: no overshoot) in between. The field is a first-
# order distance to that ellipse, so the surface is exact and the normals
# (taken from the field's gradient) are right.
# --------------------------------------------------------------------------------


def curve(xs, ys):
    from scipy.interpolate import PchipInterpolator
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    if xs[0] > xs[-1]:
        xs, ys = xs[::-1], ys[::-1]
    f = PchipInterpolator(xs, ys)
    lo, hi = xs[0], xs[-1]
    return lambda t: f(np.clip(t, lo, hi))


def ell_d(qx, qz, rx, rz):
    """Approximate signed distance to an ellipse of half-widths rx, rz."""
    ex, ez = qx / rx, qz / rz
    k0 = np.sqrt(ex * ex + ez * ez)
    k1 = np.sqrt((ex / rx) ** 2 + (ez / rz) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def yloft(y, rx, rz, cx=None, cz=None, bottom=0.01, top=0.01):
    """A form lofted up y through elliptical cross-sections (half-widths rx,
    rz centred at cx, cz at each station y). bottom / top: how round its end
    caps are (None: left open, to be blended into something else)."""
    y = np.asarray(y, float)
    z0 = np.zeros_like(y)
    cx = z0 if cx is None else np.asarray(cx, float)
    cz = z0 if cz is None else np.asarray(cz, float)
    RX, RZ, CX, CZ = curve(y, rx), curve(y, rz), curve(y, cx), curve(y, cz)
    y0, y1 = y[0], y[-1]

    def fn(p):
        yy = p[:, 1]
        d = ell_d(p[:, 0] - CX(yy), p[:, 2] - CZ(yy), RX(yy), RZ(yy))
        if bottom is not None:
            d = smax(d, y0 - yy, bottom)
        if top is not None:
            d = smax(d, yy - y1, top)
        return d

    m = max(np.max(rx), np.max(rz))
    lo = V(np.min(cx) - m, y0, np.min(cz) - m) - 0.02
    hi = V(np.max(cx) + m, y1, np.max(cz) + m) + 0.02
    pr = Prim(fn, lo, hi)
    pr.R = (RX, RZ, CX, CZ)
    return pr


def aloft(A, d, us, r, k=1.0, side=None, start=0.01, end=0.01):
    """A form lofted along the axis from A in direction d, circular (or
    flattened by k across side) cross-sections of radius r at stations us."""
    A, d = V(*A), unit(d)
    side = unit(np.cross(d, V(0, 0, 1)) if side is None else side)
    fw = np.cross(side, d)
    R = curve(us, r)
    u0, u1 = us[0], us[-1]

    def fn(p):
        q = p - A
        u = q @ d
        rr = R(u)
        dd = ell_d(q @ side, (q @ fw), rr, rr * k)
        if start is not None:
            dd = smax(dd, u0 - u, start)
        if end is not None:
            dd = smax(dd, u - u1, end)
        return dd

    m = max(r) + 0.02
    pts = np.array([A + d * u0, A + d * u1])
    return Prim(fn, pts.min(0) - m, pts.max(0) + m)


# --------------------------------------------------------------------------------
# meshes made directly (the rod, its line, the reel's bail)
# --------------------------------------------------------------------------------


class MeshGarment:
    """A garment meshed directly: vertices, normals, faces, its own skin
    weights and detail coordinates."""

    def __init__(self, name, mat, verts, normals, faces, weights, details, mats=None, outline=1.0):
        self.name, self.mat, self.outline = name, mat, outline
        self.v, self.n, self.f = verts, normals, faces
        self.w, self.det = weights, details
        self.details = lambda p, n, own: self.det
        self.mats = (lambda p, n, own: mats) if mats is not None else None

    def mesh(self):
        return self.v, self.n, self.f


def quantise(W):
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


def tube(c, radius, sides, n, caps=True):
    """A tube round centreline c (resampled to n rings), its radius
    radius(u) (u: 0..1 along it), closed at both ends. Returns vertices,
    normals, faces and each vertex's u."""
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    ss = np.linspace(0, L, n)
    cc = np.stack([np.interp(ss, s, c[:, k]) for k in range(3)], 1)
    T, N, Bn = frames(cc)
    verts, norms, U = [], [], []
    for i in range(n):
        r = radius(ss[i] / L)
        for j in range(sides):
            a = 2 * math.pi * j / sides
            d = math.cos(a) * N[i] + math.sin(a) * Bn[i]
            verts.append(cc[i] + r * d)
            norms.append(d)
            U.append(ss[i] / L)
    faces = []
    for i in range(n - 1):
        for j in range(sides):
            a0, a1 = i * sides + j, i * sides + (j + 1) % sides
            b0, b1 = a0 + sides, a1 + sides
            faces += [(a0, b0, a1), (a1, b0, b1)]
    if caps:
        for end, sgn in ((n - 1, 1), (0, -1)):
            ci = len(verts)
            verts.append(cc[end] + sgn * T[end] * radius(end / (n - 1)) * 0.6)
            norms.append(sgn * T[end])
            U.append(float(end / (n - 1)))
            for j in range(sides):
                a, b = end * sides + j, end * sides + (j + 1) % sides
                faces.append((a, ci, b) if sgn > 0 else (b, ci, a))
    v, nn, f = np.array(verts), np.array(norms), np.array(faces, dtype=np.int64)
    a, b, cq = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    if ((np.cross(b - a, cq - a) * (nn[f[:, 0]] + nn[f[:, 1]] + nn[f[:, 2]])).sum(1)).mean() < 0:
        f = f[:, ::-1]
    return v, nn, f, np.array(U)


# --------------------------------------------------------------------------------
# what he carries: the aquarium on his back, the rod on his shoulder, the
# fish on its line
# --------------------------------------------------------------------------------

# The tank: a clear cylinder between a cap and a base (centre, the glass's
# radius and half its height); the caps' radius and depth; on a bone at its
# centre (the game bounces it on his back).
TANK = dict(c=V(0.0, 1.055, 0.228), r=0.083, half=0.094, capR=0.094, capH=0.044)
TANK_TOP = TANK['c'][1] + TANK['half']
TANK_BOT = TANK['c'][1] - TANK['half']

# The rod, as he carries it (body space): his right fist round the grip in
# front of his right shoulder, the rod running up and back over the top of
# the shoulder; along its own y from where the fist holds it (the butt
# behind, the tip ahead), the blank bowing a little under the fish's weight.
ROD = dict(
    grip=V(0.18, 1.18, -0.13),
    over=V(0.21, 1.325, 0.005),  # where it passes over his shoulder
    butt=-0.215, cork=(-0.2, 0.04), seat=(0.04, 0.125), fore=(0.125, 0.175), tip=0.8,
    bend=0.07,  # how far the tip bows down under the fish (m)
    reel=0.084,  # where the reel's foot is along it
)
ROD_DIR = unit(ROD['over'] - ROD['grip'])
# (its frame: +y up the rod, +z the side the reel hangs from - out and
# forward, clear of his shoulder, where you see it in his sheet)
ROD_R = basis(ROD_DIR, unit(V(0.55, -0.25, -0.8)))
# (and the way the blank bows: straight down, as near as the rod's slope
# allows, in the rod's own space)
_down = V(0, -1, 0) - ROD_DIR * (V(0, -1, 0) @ ROD_DIR)
BEND = ROD_R.T @ unit(_down)
LINE = 0.135  # from the rod's tip to the fish's lip


def rod_point(y):
    """A point on the rod's centreline (rod space), the blank bowing down
    toward its tip."""
    t = max(0.0, (y - ROD['fore'][1]) / (ROD['tip'] - ROD['fore'][1]))
    return V(0.0, y, 0.0) + BEND * ROD['bend'] * t * t


def to_body(q):
    return ROD['grip'] + ROD_R @ q


ROD_TIP = to_body(rod_point(ROD['tip']))
HOOK = ROD_TIP - V(0, LINE, 0)

# The alien fish, sculpted in its own frame - hanging by its lip at the
# origin, its snout up (+y), its back toward +x (away from him), its flanks
# toward +-z - and placed at the hook. Its tail swings from CATCH_TAIL, its
# pectoral fins from CATCH_FIN.
FISH_LEN = 0.56
CATCH_TAIL = V(0.0, -0.3, 0.0)
CATCH_FIN = [V(-0.018, -0.128, s * 0.062) for s, _ in SIDES]

# The goldfish in the tank, in its own frame: swimming toward -z, its back
# up; its tail swings from GOLD_TAIL. (Bound at the tank's middle.)
GOLD = dict(len=0.074, tail=V(0, 0, 0.017))


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.1, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.1, 0))
    bone('neck', 'chest', (0, NECK_Y - CHEST_Y, 0))
    bone('head', 'neck', (0, HEAD_Y - NECK_Y, 0))
    # tufts of hair on springs
    for name, piv, _ in HAIR_BONES:
        bone(name, 'head', V(*piv) - V(0, HEAD_Y, 0))
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.05, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.05), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))
    # the tank on his back (the game bounces it there)
    bone('tank', 'chest', TANK['c'] - V(0, CHEST_Y, 0))
    bone('sim', None, (0, 0, 0))
    # the rod, the fish on its line (and its tail and fins), the goldfish
    bone_frame('rod', 'sim', ROD['grip'], ROD_R)
    bone('catch', 'sim', ROD_TIP)
    bone('catchTail', 'catch', HOOK + CATCH_TAIL - ROD_TIP)
    for (s, L), f in zip(SIDES, CATCH_FIN):
        bone('catchFin' + L, 'catch', HOOK + f - ROD_TIP)
    bone('goldfish', 'sim', TANK['c'])
    bone('goldTail', 'goldfish', GOLD['tail'])


# springy tufts of hair: [bone, pivot (body space), how they swing]
HAIR_BONES = [
    ('tuftF', (0.0, 1.59, -0.075), dict(f=3.4, z=0.2, k=0.7, lim=0.25)),
    ('tuftT', (0.01, 1.63, 0.02), dict(f=2.9, z=0.16, k=1.0, lim=0.3)),
    ('tuftB', (-0.01, 1.56, 0.09), dict(f=3.1, z=0.18, k=0.9, lim=0.3)),
]

MAT = dict(face=1, hair=2, tee=3, jacket=4, trousers=5, boot=6, hand=7, strap=8, tank=9, rod=10, reel=11, cork=12, fish=13, fin=14, gold=15, line=16)

# --------------------------------------------------------------------------------
# the body under his clothes: a mannequin lofted to his proportions (a boy of
# thirteen, 1.64 m to the top of his hair: shoulders 0.33 m across, the
# chest 0.2 deep, legs 0.83 to the hip). Nothing of it is drawn but his
# neck and hands; every garment is shaped round it with its own ease, so
# they sit on one coherent figure rather than each being sized on its own.
# --------------------------------------------------------------------------------

BODY = dict(
    y=[0.7, 0.76, 0.84, 0.92, 0.99, 1.06, 1.13, 1.2, 1.25, 1.29, 1.32, 1.345, 1.362],
    rx=[0.11, 0.142, 0.152, 0.145, 0.13, 0.128, 0.134, 0.141, 0.145, 0.142, 0.126, 0.092, 0.058],
    rz=[0.085, 0.1, 0.104, 0.097, 0.088, 0.087, 0.092, 0.097, 0.095, 0.087, 0.075, 0.061, 0.05],
    cz=[0.02, 0.02, 0.018, 0.012, 0.006, 0.002, 0.0, 0.0, 0.004, 0.008, 0.012, 0.012, 0.012],
)
ARM_R = ([0.0, 0.08, 0.2, UPPER_ARM, 0.38, UPPER_ARM + FOREARM], [0.042, 0.043, 0.038, 0.035, 0.033, 0.026])
LEG = dict(y=[0.09, 0.14, 0.24, 0.36, 0.47, 0.6, 0.72, 0.84], r=[0.032, 0.035, 0.046, 0.05, 0.046, 0.062, 0.072, 0.078],
           cx=[0.1, 0.1, 0.099, 0.097, 0.095, 0.093, 0.091, 0.088])


def body_torso(k=0.0, dz=0.0):
    """The torso, k m out from his skin."""
    B_ = BODY
    return yloft(B_['y'], np.array(B_['rx']) + k, np.array(B_['rz']) + k, cz=np.array(B_['cz']) + dz, bottom=0.04, top=0.02)


def body_parts():
    torso = body_torso()
    arms = []
    for s, _ in SIDES:
        S, E, W, d, out = arm_frame(s)
        arms.append(aloft(S, d, *ARM_R, side=out, start=0.03))
    legs = [yloft(LEG['y'], LEG['r'], LEG['r'], cx=s * np.array(LEG['cx']), bottom=0.01, top=None) for s, _ in SIDES]
    return torso, arms, legs


def g_body():
    """The mannequin itself (only built to look at: BODY=1)."""
    torso, arms, legs = body_parts()

    def field(p):
        d = torso(p)
        for a in arms:
            d = smin(d, a(p), 0.03)
        for l in legs:
            d = smin(d, l(p), 0.03)
        return d

    owners = [(torso, by_y([(0.86, 'hips'), (0.98, 'spine'), (1.08, 'spine'), (1.17, 'chest')]))]
    for a, (s, L) in zip(arms, SIDES):
        S, E, W, d, out = arm_frame(s)
        owners.append((a, by_axis(S, d, [(0.0, 'clav' + L), (0.06, 'arm' + L), (UPPER_ARM - 0.03, 'arm' + L), (UPPER_ARM + 0.03, 'fore' + L), (UPPER_ARM + FOREARM - 0.01, 'fore' + L), (UPPER_ARM + FOREARM + 0.01, 'hand' + L)])))
    for l, (s, L) in zip(legs, SIDES):
        owners.append((l, by_y([(0.12, 'foot' + L), (0.16, 'shin' + L), (KNEE_Y - 0.03, 'shin' + L), (KNEE_Y + 0.03, 'thigh' + L), (0.76, 'thigh' + L), (0.86, 'hips')])))
    return Garment('body', MAT['face'], 0.004, (-0.42, 0.06, -0.14), (0.42, 1.38, 0.14), field, owners, 9000, tau=0.012, outline=0.6)


# --------------------------------------------------------------------------------
# head, neck and hair
# --------------------------------------------------------------------------------

NOSE = (0.0, 1.462, -0.101)
EYE = (0.037, 1.489)  # (x, y) of each eye's centre, drawn on by the shader
MOUTH = (1.424, -0.088)  # (y, z)


def head_prims():
    # a round boy's face, its eyes at the middle of his head: full cheeks
    # low and forward, a soft jaw running back to under the ears, a small
    # rounded chin; a big round cranium over it
    cran = ellipsoid(*CRAN)
    face = ellipsoid((0, 1.467, -0.03), (0.084, 0.08, 0.076))
    cheeks = [ellipsoid((s * 0.049, 1.443, -0.047), (0.043, 0.037, 0.038)) for s, _ in SIDES]
    jaws = [round_cone((s * 0.058, 1.46, 0.002), (s * 0.024, 1.41, -0.046), 0.031, 0.025) for s, _ in SIDES]
    chin = ellipsoid((0, 1.4, -0.05), (0.029, 0.02, 0.021))
    return cran, face, cheeks, jaws, chin


def skull(p):
    cran, face, cheeks, jaws, chin = head_prims()
    d = smin(cran(p), face(p), 0.05)
    for c in cheeks:
        d = smin(d, c(p), 0.035)
    for j in jaws:
        d = smin(d, j(p), 0.04)
    return smin(d, chin(p), 0.03)


def g_head():
    cran, face, cheeks, jaws, chin = head_prims()
    bridge = round_cone((0, 1.494, -0.093), (0, 1.467, -0.099), 0.007, 0.01)
    tip = ellipsoid(NOSE, (0.0135, 0.0115, 0.0115))
    wings = [ellipsoid((s * 0.0118, 1.457, -0.092), (0.0085, 0.0075, 0.0078)) for s, _ in SIDES]
    brows = [ellipsoid((s * 0.036, 1.516, -0.083), (0.03, 0.01, 0.012)) for s, _ in SIDES]
    ears = [ellipsoid((s * 0.095, 1.478, 0.01), (0.013, 0.027, 0.02), rot_y(s * 0.3)) for s, _ in SIDES]
    # the neck: short and sturdy, flowing up into the jaw and the back of the
    # skull and out into the slope of his shoulders (under the collar)
    neck = yloft([1.26, 1.32, 1.37, 1.41, 1.45], [0.068, 0.054, 0.049, 0.05, 0.06], [0.06, 0.05, 0.047, 0.05, 0.062],
                 cz=[0.012, 0.012, 0.014, 0.018, 0.02], bottom=0.01, top=0.02)

    def field(p):
        d = skull(p)
        for b in brows:
            d = smin(d, b(p), 0.022)
        d = smin(d, bridge(p), 0.014)
        d = smin(d, tip(p), 0.01)
        for w in wings:
            d = smin(d, w(p), 0.008)
        for e in ears:
            d = smin(d, e(p), 0.007)
        return smin(d, neck(p), 0.035)

    head = rigid('head')
    owners = [(cran, head), (face, head), (chin, head), (bridge, head), (tip, head)]
    owners += [(c, head) for c in cheeks + jaws + wings + brows]
    n_ear = len(owners)
    owners += [(e, head) for e in ears]
    owners += [(neck, by_y([(1.3, 'chest'), (1.355, 'neck'), (1.43, 'head')]))]

    def details(p, n, own):
        # x: on the ears
        ear = own[:, n_ear] + own[:, n_ear + 1]
        return np.stack([ear, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('head', MAT['face'], 0.0019, (-0.12, 1.24, -0.13), (0.12, 1.64, 0.13), field, owners, 4600, details=details, outline=0.55)


def on_cran(theta, elev, lift=0.0):
    """A point on the cranium at azimuth theta (0 = front, + toward his
    right) and elevation elev, lifted off it along its normal; and the normal."""
    c, r = V(*CRAN[0]), V(*CRAN[1])
    u = V(math.sin(theta) * math.cos(elev), math.sin(elev), -math.cos(theta) * math.cos(elev))
    p0 = c + r * u
    n = u / r ** 2
    n /= np.linalg.norm(n)
    return p0 + n * lift, n


def cran_project(p, lift):
    """A point taken onto the cranium (along the ray from its centre), lifted
    off it by lift; and the normal there."""
    c, r = V(*CRAN[0]), V(*CRAN[1])
    q = (p - c) / r
    u = q / np.linalg.norm(q)
    p0 = c + r * u
    n = u / r
    n /= np.linalg.norm(n)
    return p0 + n * lift, n


def hairline(p):
    # by angle round the head (0 = front, pi/2 = over the ear, pi = the
    # nape): high across the forehead (the fringe falls over it), down in
    # front of the ear to a short sideburn, up round the ear, down to the nape
    th = np.abs(np.arctan2(p[:, 0], -(p[:, 2] - 0.012)))
    return np.interp(th, [0, 0.5, 0.9, 1.12, 1.26, 1.42, 1.62, 1.9, 2.3, 2.7, math.pi], [1.566, 1.56, 1.535, 1.495, 1.488, 1.515, 1.522, 1.48, 1.43, 1.405, 1.4])


HAIR_T = 0.008  # how thick the fitted mass of his hair is (more on top: see g_hair)


class Lock:
    """A lock of hair: a ribbon swept along a path over his head - broad and
    flat at its root, where it grows out of the mass, narrowing to a point;
    lying close over the head and lifting off it toward its tip."""

    def __init__(self, theta, elev, length, width, sweep=0.0, turn=0.0, lift=0.004, curl=0.01, thick=0.011, fwd=0.0):
        D = math.pi / 180
        p, n = on_cran(theta * D, elev * D, 0.0)
        # its way: down over the head, swept round by sweep (deg), turning
        # as it goes (turn, deg over its length)
        down = V(0, -1, 0) + V(0, 0, -fwd)
        t = down - n * (down @ n)
        t /= np.linalg.norm(t)
        t = self.rot(t, n, sweep * D)
        K = 12
        pts, nrm = [], []
        q = p
        for k in range(K + 1):
            s = k / K
            off = HAIR_T + 0.003 + lift * math.sin(0.5 * math.pi * min(1, s * 1.6)) + curl * s ** 2.5
            on, nn = cran_project(q, off)
            pts.append(on)
            nrm.append(nn)
            t = t - nn * (t @ nn)
            t = self.rot(t / np.linalg.norm(t), nn, turn * D / K)
            q = on + t * (length / K)
        self.p = np.array(pts)
        self.n = np.array(nrm)
        self.s = np.linspace(0, 1, K + 1)
        self.w = width * (1 - 0.82 * self.s ** 1.25) + 0.0015
        self.h = thick * (1 - 0.55 * self.s) + 0.001
        m = width + 0.01
        self.lo, self.hi = self.p.min(0) - m, self.p.max(0) + m

    @staticmethod
    def rot(v, axis, a):
        axis = axis / np.linalg.norm(axis)
        return v * math.cos(a) + np.cross(axis, v) * math.sin(a) + axis * (axis @ v) * (1 - math.cos(a))

    def fn(self, p):
        out = np.full(len(p), 1.0)
        for k in range(len(self.p) - 1):
            a, b = self.p[k], self.p[k + 1]
            ab = b - a
            L2 = ab @ ab
            u = np.clip(((p - a) @ ab) / L2, 0, 1)
            q = p - (a + u[:, None] * ab)
            nn = self.n[k] + (self.n[k + 1] - self.n[k]) * u[:, None]
            nn /= np.linalg.norm(nn, axis=1, keepdims=True)
            t = ab / math.sqrt(L2)
            bb = np.cross(t, nn)
            w = self.w[k] + (self.w[k + 1] - self.w[k]) * u
            h = self.h[k] + (self.h[k + 1] - self.h[k]) * u
            qb = (q * bb).sum(1)
            qn = (q * nn).sum(1)
            qt = q @ t
            e = np.sqrt((qb / w) ** 2 + (qn / h) ** 2 + (qt / h) ** 2)
            out = np.minimum(out, (e - 1) * h)
        return out

    def prim(self):
        return Prim(self.fn, self.lo, self.hi)


def hair_locks():
    """The locks of his hair, laid by hand: from a whorl at the back of his
    crown they sweep forward over the top and down into a fringe falling
    over his forehead to just above his brows - parted a little off centre,
    swept toward his right, its points of different lengths, curling up at
    their ends; down over his temples and the tops of his ears, their tips
    flicking out; short down the back to his nape, a couple turning up. Each
    its own length and width, overlapping the next; a shorter layer over
    the first breaks up the crown so its outline is uneven."""
    L = []
    # the fringe: over the top from the crown and down over the forehead
    for th, el, ln, w, sw, tu, cu in [(-42, 60, 0.105, 0.032, 22, 26, 0.024), (-22, 64, 0.128, 0.036, 14, 18, 0.012), (-2, 66, 0.122, 0.034, 6, 20, 0.02),
                                      (16, 63, 0.118, 0.034, -4, 16, 0.01), (34, 58, 0.102, 0.031, -14, 12, 0.022), (52, 52, 0.09, 0.029, -24, 4, 0.028)]:
        L.append(('F', Lock(th, el, ln, w, sweep=sw, turn=tu, lift=0.02, curl=cu * 0.75, thick=0.014, fwd=0.9)))
    # over the top, from the whorl forward and to the sides: its volume
    for th, el, ln, w, sw, tu, cu in [(165, 74, 0.11, 0.042, 178, -22, 0.02), (-150, 72, 0.1, 0.04, -168, 26, 0.026), (125, 68, 0.1, 0.038, 150, -20, 0.03),
                                      (-115, 66, 0.095, 0.036, -148, 22, 0.032), (80, 70, 0.085, 0.036, 120, -16, 0.026), (-70, 72, 0.085, 0.036, -125, 18, 0.03)]:
        L.append(('T', Lock(th, el, ln, w, sweep=sw, turn=tu, lift=0.024, curl=cu * 0.55, thick=0.015)))
    # a shorter layer on top, lifting more, tips springing up
    for th, el, ln, w, sw, tu in [(150, 80, 0.07, 0.03, 170, -30), (-30, 78, 0.075, 0.03, 20, 25), (40, 76, 0.07, 0.028, -30, -20), (-120, 76, 0.065, 0.028, -150, 30), (95, 78, 0.06, 0.026, 140, 20)]:
        L.append(('T', Lock(th, el, ln, w, sweep=sw, turn=tu, lift=0.024, curl=0.012, thick=0.012)))
    # the sides: down over the temples and the tops of the ears, flicking out
    for s in (-1, 1):
        for th, el, ln, w, sw, tu, cu in [(74, 48, 0.088, 0.033, 34, 16, 0.034), (98, 42, 0.084, 0.032, 22, -10, 0.04), (122, 36, 0.078, 0.03, 10, -18, 0.034)]:
            L.append(('T', Lock(s * th, el, ln, w, sweep=-s * sw, turn=-s * tu, lift=0.016, curl=cu * 0.6, thick=0.012)))
    # the back: short, down to the nape, a couple turning out
    for th, el, ln, w, sw, tu, cu in [(150, 40, 0.085, 0.034, -12, 8, 0.026), (176, 42, 0.09, 0.036, 6, -12, 0.016), (-154, 38, 0.082, 0.034, 14, -8, 0.03),
                                      (138, 20, 0.062, 0.028, -18, 0, 0.03), (-140, 18, 0.06, 0.028, 20, 0, 0.034), (180, 16, 0.056, 0.03, 0, 8, 0.02)]:
        L.append(('B', Lock(th, el, ln, w, sweep=sw, turn=tu, lift=0.014, curl=cu * 0.65, thick=0.011)))
    return L


def g_hair():
    """Short, tousled blonde hair: a mass fitted close over the skull (fuller
    on top), out to his hairline, and over it a limited number of locks,
    each broad at its root and growing out of the mass, narrowing to a
    point - sweeping forward and to the side, overlapping each other - so
    the outline breaks into uneven points at the fringe, over the ears and
    at the nape, with only a little volume above the scalp."""

    def cap(p):
        y = p[:, 1]
        thick = HAIR_T + 0.006 * smooth(1.56, 1.62, y)
        return skull(p) - thick

    base = Prim(cap, (-0.13, 1.36, -0.14), (0.13, 1.66, 0.14))
    locks = hair_locks()
    prims = [(g, l.prim()) for g, l in locks]

    def field(p):
        d = smax(base(p), hairline(p) - p[:, 1], 0.008)
        for g, q in prims:
            d = smin(d, q(p), 0.005)
        return d

    bones = {'F': 'tuftF', 'T': 'tuftT', 'B': 'tuftB'}
    owners = [(base, rigid('head'))]
    for g, q in prims:
        b = bones[g]
        # (rooted in the head, the tips on the tuft's spring)
        owners.append((q, by_y([(1.5, b), (1.58, 'head')]) if g != 'T' else by_y([(1.56, b), (1.6, 'head')])))

    def details(p, n, own):
        # x: on a lock (strands are drawn along them), y: up the head
        return np.stack([1 - own[:, 0], p[:, 1], np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('hair', MAT['hair'], 0.0018, (-0.15, 1.36, -0.16), (0.15, 1.69, 0.16), field, owners, 6000, tau=0.006, details=details, outline=0.6)


# --------------------------------------------------------------------------------
# the tee and the bib of his waterproofs, over his chest
# --------------------------------------------------------------------------------

BIB = dict(top=1.19, half=0.072, bottom=0.92)


def g_inner():
    """What shows between the jacket's open fronts: the teal tee, close over
    his chest, its crew collar round the base of his neck; and over it the
    bib of his waterproofs - a panel up his chest to below the collar, its
    braces from its corners up over his shoulders, a dark buckle at each."""
    tee = body_torso(0.004)
    bibBody = body_torso(0.0105)
    collar = torus_y((0, 1.338, 0.012), 0.05, 0.007, 0.98)
    neckhole = yloft([1.3, 1.45], [0.047, 0.05], [0.045, 0.048], cz=[0.012, 0.014], bottom=None, top=None)

    def bib_fn(p):
        x, y = p[:, 0], p[:, 1]
        q = np.maximum(np.abs(x) - BIB['half'], np.maximum(y - BIB['top'], BIB['bottom'] - y))
        return smax(bibBody(p), smax(q, p[:, 2] - 0.0, 0.006), 0.004)

    bibP = Prim(bib_fn, (-0.11, 0.86, -0.15), (0.11, 1.22, 0.02))
    braces, buckles = [], []
    for s, _ in SIDES:
        pts = [V(s * 0.058, BIB['top'] - 0.01, -0.12), V(s * 0.062, 1.25, -0.1), V(s * 0.066, 1.3, -0.07), V(s * 0.074, 1.335, -0.03), V(s * 0.08, 1.345, 0.02)]
        lay = [cran_free_onto(bibBody, q, 0.002) for q in pts]
        braces.append(stroke(lay, [0.009] * len(lay)))
        c = cran_free_onto(bibBody, V(s * 0.06, BIB['top'] + 0.004, -0.12), 0.004)
        buckles.append(round_box(c, (0.013, 0.009, 0.004), 0.003, rot_x(-0.25)))

    def field(p):
        t = smax(tee(p), 0.9 - p[:, 1], 0.01)
        t = smin(t, collar(p), 0.006)
        t = smin(t, bibP(p), 0.002)
        for b in braces:
            t = smin(t, b(p), 0.003)
        for b in buckles:
            t = smin(t, b(p), 0.002)
        return smax(t, -neckhole(p), 0.004)

    torso_w = by_y([(0.88, 'spine'), (1.0, 'spine'), (1.09, 'chest')])
    owners = [(tee, torso_w), (collar, by_y([(1.32, 'chest'), (1.36, 'neck')])), (bibP, torso_w)]
    owners += [(b, rigid('chest')) for b in braces]
    owners += [(b, rigid('chest')) for b in buckles]

    def mats(p, n, own):
        bib = own[:, 2] + own[:, 3:5].sum(1)
        m = np.where(bib > 0.5, MAT['trousers'], MAT['tee'])
        return np.where(own[:, 5:7].sum(1) > 0.5, MAT['strap'], m)

    def details(p, n, own):
        # x: on the tee's collar, y: on the bib's panel (its stitched edge)
        return np.stack([own[:, 1], own[:, 2], np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('inner', MAT['tee'], 0.0026, (-0.18, 0.88, -0.14), (0.18, 1.37, 0.13), field, owners, 4000, tau=0.006, details=details, mats=mats, outline=0.5)


def cran_free_onto(prim, p, lift, steps=8):
    """A point pulled onto the surface of a volume, lifted off it by lift."""
    q = np.array([p], float)
    for _ in range(steps):
        g = B.gradient(prim, q)
        q = q - (prim(q) - lift)[:, None] * g
    return q[0]


# --------------------------------------------------------------------------------
# the rain jacket: a shell of waterproof cloth over all of that, hanging
# open at the front from his shoulders, flaring a little to its hem at his
# upper thighs; a collar round his neck and the hood down behind it; the
# sleeves following his arms with a little room, turned back at the wrist
# --------------------------------------------------------------------------------

JACKET = dict(
    y=[0.745, 0.8, 0.88, 0.96, 1.04, 1.12, 1.2, 1.26, 1.3, 1.325, 1.348, 1.366, 1.38],
    rx=[0.183, 0.18, 0.172, 0.162, 0.154, 0.152, 0.156, 0.16, 0.156, 0.144, 0.115, 0.084, 0.064],
    rz=[0.136, 0.133, 0.127, 0.12, 0.115, 0.113, 0.114, 0.111, 0.102, 0.091, 0.075, 0.063, 0.057],
    cz=[0.008, 0.008, 0.008, 0.007, 0.006, 0.005, 0.005, 0.008, 0.011, 0.012, 0.012, 0.012, 0.012],
    hem=0.745,
    shell=0.0065,
)
# the sleeve's radius down the arm (it starts small up at the shoulder so
# it runs on down the slope of it rather than bulging over it)
SLEEVE = ([0.025, 0.06, 0.12, 0.2, UPPER_ARM, 0.38, UPPER_ARM + FOREARM - 0.035], [0.04, 0.049, 0.0505, 0.0495, 0.048, 0.0455, 0.0445])
CUFF_U = UPPER_ARM + FOREARM - 0.045  # the turned-back cuff, down the arm
# how wide the fronts hang open (half the gap, by height)
OPEN = ([0.74, 0.9, 1.1, 1.2, 1.28, 1.33, 1.4], [0.082, 0.08, 0.078, 0.076, 0.066, 0.052, 0.046])


def open_gap(p):
    """> 0 where the jacket is, < 0 in the gap between its open fronts."""
    g = np.interp(p[:, 1], *OPEN)
    return np.maximum(np.abs(p[:, 0]) - g, p[:, 2] - 0.0)


def jacket_outer():
    J = JACKET
    torso = yloft(J['y'], J['rx'], J['rz'], cz=J['cz'], bottom=None, top=0.012)
    sleeves = []
    for s, _ in SIDES:
        S, E, W, d, out = arm_frame(s)
        sleeves.append(dict(S=S, d=d, out=out, tube=aloft(S, d, *SLEEVE, side=out, k=1.0, start=0.02, end=None)))
    # the collar: a soft band round the base of his neck; the hood, down,
    # bunched behind it on his shoulders and upper back
    collar = torus_y((0, 1.374, 0.014), 0.064, 0.016, 0.98)
    hood = [
        # its rim, rolled round behind the neck from shoulder to shoulder
        Prim(lambda p, t=torus_y((0, 1.35, 0.028), 0.08, 0.027, 0.92): smax(t.fn(p), 0.0 - p[:, 2], 0.03), (-0.14, 1.3, -0.1), (0.14, 1.41, 0.16)),
        # and the hood itself, slumped in a soft pouch below it on his back
        ellipsoid((0, 1.292, 0.1), (0.108, 0.07, 0.05)),
        ellipsoid((0, 1.236, 0.108), (0.076, 0.04, 0.036)),
    ]
    return torso, sleeves, collar, hood


def jacket_smooth(p, parts=None):
    """The jacket's outside, without its fold and pockets: what the straps
    and the tank lie on."""
    torso, sleeves, collar, hood = parts or jacket_outer()
    t = torso(p)
    for sl in sleeves:
        u = (p - sl['S']) @ sl['d']
        tube = sl['tube'](p)
        t = smin(t, tube, 0.03) * (1 - smooth(0.06, 0.14, u)) + np.minimum(t, tube) * smooth(0.06, 0.14, u)
    return t


POCKET_X = 0.118


def pocket(s):
    """A flap pocket on the front at his hip: where its flap sits on the
    jacket and which way it faces."""
    J = JACKET
    y = 0.88
    rx = float(curve(J['y'], J['rx'])(y))
    rz = float(curve(J['y'], J['rz'])(y))
    cz = float(curve(J['y'], J['cz'])(y))
    x = s * POCKET_X
    z = cz - rz * math.sqrt(max(0.0, 1 - (x / rx) ** 2))
    n = unit(x / rx ** 2, 0.0, (z - cz) / rz ** 2)
    return V(x, y, z), n


def g_jacket():
    J = JACKET
    parts = jacket_outer()
    torso, sleeves, collar, hood = parts
    T = J['shell']
    flaps = []
    for s, _ in SIDES:
        c, n = pocket(s)
        R = basis(unit(V(0, 1, 0) - n * n[1]), n)
        flaps.append(round_box(c + 0.004 * n, (0.04, 0.019, 0.004), 0.004, R))

    def outer(p):
        y = p[:, 1]
        t = torso(p)
        # waterproof cloth hanging: a few long soft folds down the skirt,
        # a drag line from each armpit
        az = np.arctan2(p[:, 0], -p[:, 2])
        t = t + 0.0028 * np.sin(az * 5 + 1.6 * np.sin(y * 7)) * smooth(1.02, 0.82, y)
        for sl in sleeves:
            u = (p - sl['S']) @ sl['d']
            tube = sl['tube'](p)
            # (soft creases in the crook of the elbow and over the forearm)
            tube = tube + 0.0025 * np.sin(u * 62 + p[:, 2] * 24) * smooth(0.2, 0.26, u) * smooth(0.36, 0.3, u)
            # (blended into the body only round the shoulder and armpit:
            # below that the sleeve hangs beside the body, a crease between)
            t = smin(t, tube, 0.03) * (1 - smooth(0.06, 0.14, u)) + np.minimum(t, tube) * smooth(0.06, 0.14, u)
        t = smin(t, collar(p), 0.012)
        for h in hood:
            t = smin(t, h(p), 0.028)
        return t

    def field(p):
        o = outer(p)
        # a shell of cloth: hollow inside (his tee and waterproofs are in
        # there), open at the front, at the hem, at the cuffs and round
        # his neck
        d = smax(o, -(o + T), 0.002)
        d = smax(d, -open_gap(p), 0.004)
        d = smax(d, J['hem'] - p[:, 1], 0.004)
        for sl in sleeves:
            u = (p - sl['S']) @ sl['d']
            d = smax(d, u - (SLEEVE[0][-1]), 0.003)
        d = smax(d, -yloft([1.33, 1.5], [0.05, 0.06], [0.048, 0.058], cz=[0.014, 0.016], bottom=None, top=None)(p), 0.004)
        # the cuffs turned back: a roll round each wrist
        for sl in sleeves:
            d = smin(d, torus_axis(sl['S'] + (CUFF_U + 0.008) * sl['d'], sl['d'], SLEEVE[1][-1] + 0.001, 0.0072)(p), 0.006)
        for f in flaps:
            d = smin(d, f(p), 0.002)
        return d

    torso_w = by_y([(0.84, 'hips'), (0.94, 'spine'), (1.03, 'spine'), (1.12, 'chest')])

    def skirt_w(p):
        # (below his hips the skirt is carried partly by his thighs, so a
        # knee driven up lifts it rather than going through it)
        out = torso_w(p)
        y, x, z = p[:, 1], p[:, 0], p[:, 2]
        k = smooth(0.86, 0.76, y) * (0.5 * smooth(0.03, -0.08, z) + 0.15)
        out = [(b, w * (1 - k)) for b, w in out]
        out.append((IDX['thighL'], k * (x < 0)))
        out.append((IDX['thighR'], k * (x >= 0)))
        return out

    owners = [(torso, skirt_w), (collar, by_y([(1.34, 'chest'), (1.39, 'neck')]))]
    owners += [(h, rigid('chest')) for h in hood]
    n_flap = len(owners)
    owners += [(f, skirt_w) for f in flaps]
    n_torso = len(owners)
    for sl, (s, L) in zip(sleeves, SIDES):
        w = by_axis(sl['S'], sl['d'], [(0.0, 'clav' + L), (0.07, 'arm' + L), (UPPER_ARM - 0.035, 'arm' + L), (UPPER_ARM + 0.03, 'fore' + L)])
        owners.append((sl['tube'], w))
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        # x: on the hood, y: on a pocket's flap, z: on the body (not a
        # sleeve), w: down the sleeve (m); the inside of the shell (its
        # lining) is marked by a negative w
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        inside = outer(p) < -T * 0.5
        return np.stack([own[:, 2:2 + len(hood)].sum(1), own[:, n_flap:n_torso].sum(1), own[:, :n_torso].sum(1), np.where(inside, -1.0, u)], 1)

    return Garment('jacket', MAT['jacket'], 0.0024, (-0.42, 0.73, -0.2), (0.42, 1.42, 0.2), field, owners, 14000, tau=0.012, details=details, outline=0.8)


# --------------------------------------------------------------------------------
# waterproof trousers, rubber boots, hands
# --------------------------------------------------------------------------------

TROUSERS = dict(hem=0.283, waist=1.02)
BOOT_X = 0.096
BOOT_TOP = 0.31
SOLE_H = 0.032
# A leg of his waterproofs, up from its hem: gathered in over the boot's top,
# ballooning out over it where the stiff cloth stacks up (the widest of the
# leg), easing in a little to the knee - bagged out forward there - and up
# the thigh, which tapers into the seat. Loose on him, but a boy's leg, not
# a barrel.
TLEG = dict(y=[0.283, 0.3, 0.325, 0.355, 0.4, 0.45, 0.5, 0.57, 0.65, 0.73, 0.8, 0.88],
            r=[0.07, 0.076, 0.085, 0.088, 0.086, 0.083, 0.083, 0.082, 0.081, 0.079, 0.075, 0.07],
            cx=[0.096, 0.096, 0.096, 0.096, 0.096, 0.095, 0.095, 0.094, 0.092, 0.088, 0.083, 0.077],
            cz=[0.01, 0.01, 0.01, 0.012, 0.01, 0.002, -0.006, -0.004, 0.002, 0.008, 0.012, 0.014])
PELVIS = dict(y=[0.705, 0.74, 0.8, 0.88, 0.96, 1.02], rx=[0.108, 0.138, 0.151, 0.149, 0.142, 0.138], rz=[0.084, 0.1, 0.108, 0.106, 0.1, 0.097], cz=[0.02, 0.02, 0.018, 0.015, 0.011, 0.009])


def crumple(az, y, s):
    """How the stiff waterproof cloth of a leg lies (m, + out from the leg):
    not rings, and not smooth - it buckles into long slanting folds, each a
    narrow raised ridge with broad flat cloth between, two sets of them
    winding opposite ways round the leg and crossing in diamonds (each
    wandering, so no two diamonds match), strongest where the cloth is
    pushed together: stacked over the boot, behind and across the knee.
    az: the angle round the leg (0 out to his side, + toward his back),
    y: height."""
    ph = 1.7 * s
    # how much there is to crumple, by height: most just over the boot, a
    # lot round the knee, less up the thigh (it hangs from his braces)
    amt = 0.42 + 0.6 * np.exp(-(((y - 0.47) / 0.11) ** 2)) + 0.7 * np.exp(-(((y - 0.355) / 0.055) ** 2))
    amt = amt * smooth(0.88, 0.7, y)
    wob = 0.7 * np.sin(az * 3 + y * 13 + ph) + 0.45 * np.sin(y * 27 - az + 2 * ph)
    a1 = az * 2 + y * 43 + wob + ph
    a2 = az * 3 - y * 35 + 0.9 * np.sin(az * 2 - y * 11 + ph) + 2.2
    ridge = lambda a: (0.5 + 0.5 * np.sin(a)) ** 3 - 0.31
    # (each set comes and goes round the leg, so a fold starts and dies away
    # rather than running all the way round)
    k1 = 0.55 + 0.45 * np.sin(az * 1 + y * 9 + ph * 2)
    k2 = 0.55 + 0.45 * np.sin(az * 2 - y * 7 - ph)
    f = 0.0105 * k1 * ridge(a1) + 0.008 * k2 * ridge(a2)
    # (and a slow unevenness under them: one side of a leg fuller than the
    # other)
    f = f + 0.0035 * np.sin(az + y * 6.5 + ph * 2)
    return f * amt


def g_trousers():
    """Orange waterproof bib trousers, as a fishing boy's bibs are: stiff,
    coated cloth cut loose, hanging from his braces - a seat lofted round
    his hips, the crotch rounded under it, and two distinct legs. Each
    buckles in long slanting folds crossing each other (crumple), bags out
    forward over the knee with tight creases behind it, and stacks up over
    the boot: ballooning out above the boot's top and gathered in under
    that to its hem, which sits just over the boot's rim, a couple of
    uneven rolls where it's pushed down on itself. (The bib goes up his
    front: see g_inner.)"""
    pelvis = yloft(PELVIS['y'], PELVIS['rx'], PELVIS['rz'], cz=PELVIS['cz'], bottom=0.045, top=0.01)
    legs = [yloft(TLEG['y'], TLEG['r'], np.array(TLEG['r']) * 1.04, cx=s * np.array(TLEG['cx']), cz=TLEG['cz'], bottom=0.007, top=0.04) for s, _ in SIDES]
    holes = [yloft([0.2, 0.29, 0.33], [0.061, 0.063, 0.064], [0.066, 0.068, 0.069], cx=[s * BOOT_X] * 3, cz=[0.008] * 3, bottom=None, top=0.016) for s, _ in SIDES]

    def inseam(p):
        x, y = p[:, 0], p[:, 1]
        return np.maximum(np.abs(x) - (0.003 + np.maximum(0, 0.72 - y) * 0.2), y - 0.72)

    def leg_folds(p, s):
        x, y, z = p[:, 0] - s * 0.095, p[:, 1], p[:, 2] - 0.004
        az = np.arctan2(z, x * s)
        f = -crumple(az, y, s)
        # stacked over the boot: two rolls pushed down on each other, each
        # its own height round the leg and broken where a slanting fold
        # runs through it
        for y0, a, ph in [(0.318, 0.006, 0.3 + s), (0.352, 0.0048, 2.1 - s)]:
            yk = y0 + 0.011 * np.sin(az * 2 + ph) + 0.006 * np.sin(az * 3 - ph)
            brk = 0.55 + 0.45 * np.sin(az * 2.0 + ph * 3 + 1.0)
            f = f + a * brk * np.exp(-(((y - yk - 0.019) / 0.008) ** 2)) - 0.4 * a * np.exp(-(((y - yk) / 0.012) ** 2))
        # tight creases across the back of the knee, fanning out from its
        # corners; the knee itself bagged out a little in front
        back = smooth(0.1, 0.8, np.sin(az))
        for y0 in (0.445, 0.472, 0.5):
            f = f + 0.0036 * np.exp(-(((y - y0 - 0.022 * np.cos(az)) / 0.0065) ** 2)) * back
        f = f - 0.006 * np.exp(-(((y - 0.47) / 0.06) ** 2)) * smooth(-0.2, -0.9, np.sin(az))
        return f

    def field(p):
        d = pelvis(p)
        for (s, _), q in zip(SIDES, legs):
            d = smin(d, q(p) + leg_folds(p, s), 0.03)
        d = smax(d, -inseam(p), 0.01)
        for q in holes:
            d = smax(d, -q(p), 0.005)
        return smax(d, p[:, 1] - TROUSERS['waist'], 0.01)

    kn = KNEE_Y
    owners = [(pelvis, rigid('hips'))]
    for q, (s, L) in zip(legs, SIDES):
        owners.append((q, by_y([(0.33, 'shin' + L), (kn - 0.05, 'shin' + L), (kn + 0.05, 'thigh' + L), (0.72, 'thigh' + L), (0.85, 'hips')])))

    def details(p, n, own):
        # x: on a leg (not the seat), y: stacked over the boot, z: how a
        # fold there faces the light from above (-1 the top of a fold,
        # catching it .. 1 its underside, in its own shadow)
        rolls = smooth(0.4, 0.33, p[:, 1])
        s = np.where(p[:, 0] < 0, -1.0, 1.0)
        e = V(0, 0.003, 0)
        shade = np.zeros(len(p))
        for sd in (-1, 1):
            # (the cloth's height out from the leg, and how it changes going up)
            dh = -(leg_folds(p + e, sd) - leg_folds(p - e, sd)) / 0.006
            shade = np.where(s == sd, np.clip(dh / 0.3, -1, 1), shade)
        onleg = own[:, 1] + own[:, 2]
        return np.stack([onleg, rolls, shade * onleg, np.zeros(len(p))], 1)

    return Garment('trousers', MAT['trousers'], 0.0026, (-0.22, 0.26, -0.15), (0.22, 1.04, 0.17), field, owners, 15000, tau=0.016, details=details, outline=0.75)


# The boot, from heel to toe (z, m from the ankle): its half-width, and how
# high its upper rises over the road - the heel counter up into the shaft,
# the instep sloping down into a modest rounded toe.
BOOT_PLAN = dict(z=[0.074, 0.06, 0.03, -0.02, -0.07, -0.11, -0.15, -0.18, -0.198, -0.207],
                 w=[0.028, 0.042, 0.047, 0.048, 0.053, 0.055, 0.052, 0.044, 0.031, 0.018],
                 top=[0.095, 0.12, 0.15, 0.152, 0.124, 0.1, 0.082, 0.07, 0.058, 0.045])
BOOT_SHAFT = dict(y=[0.08, 0.12, 0.17, 0.22, 0.27, BOOT_TOP], rx=[0.048, 0.046, 0.048, 0.052, 0.056, 0.058], rz=[0.062, 0.054, 0.058, 0.062, 0.065, 0.066], cz=[0.016, 0.012, 0.01, 0.009, 0.008, 0.008])


def toe_lift(z):
    return 0.012 * smooth(-0.14, -0.21, z) ** 2


def g_boots():
    """Black rubber rain boots, lofted: a foot shaped like one - a rounded
    heel, the widest across the ball, a modest rounded toe, the upper
    sloping down the instep from the shaft - on a sole that follows it, a
    little proud of it all round; and a calf-high shaft, narrowest at the
    ankle and widening to its open top, which sits under the trousers'
    bunched hems."""
    BP = BOOT_PLAN
    W, TOP = curve(BP['z'], BP['w']), curve(BP['z'], BP['top'])
    z0, z1 = BP['z'][-1], BP['z'][0]  # toe, heel
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * BOOT_X

        def foot_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1] - toe_lift(p[:, 2]), p[:, 2]
            w, top = W(z), TOP(z)
            below = 0.03
            hh = (top + below) / 2
            d = ell_d(x, y - (top - hh), w, hh)
            d = smax(d, -y + 0.0, 0.006)
            d = smax(d, z - z1, 0.03)
            return smax(d, z0 - z, 0.03)

        def sole_fn(p, bx=bx):
            x, y, z = p[:, 0] - bx, p[:, 1] - toe_lift(p[:, 2]), p[:, 2]
            w = W(z) + 0.005
            plan = np.abs(x) - w
            plan = smax(plan, z - (z1 + 0.004), 0.03)
            plan = smax(plan, (z0 - 0.004) - z, 0.035)
            return smax(plan, np.abs(y - SOLE_H / 2) - SOLE_H / 2, 0.006)

        foot = Prim(foot_fn, (bx - 0.08, -0.01, z0 - 0.02), (bx + 0.08, 0.17, z1 + 0.02))
        sole = Prim(sole_fn, (bx - 0.08, -0.01, z0 - 0.02), (bx + 0.08, 0.06, z1 + 0.02))
        S_ = BOOT_SHAFT
        shaft = yloft(S_['y'], S_['rx'], S_['rz'], cx=[bx] * len(S_['y']), cz=S_['cz'], bottom=None, top=0.004)
        inside = yloft([0.16, 0.24, BOOT_TOP + 0.05], [0.04, 0.047, 0.051], [0.047, 0.055, 0.059], cx=[bx] * 3, cz=[0.008] * 3, bottom=0.02, top=None)
        rim = torus_y((bx, BOOT_TOP - 0.003, 0.008), 0.0548, 0.0042, 1.14)
        parts.append((foot, sole, shaft, inside, rim))
        low = along(lambda p: p[:, 2], [(-0.14, 'toe' + L), (-0.09, 'foot' + L)])
        high = by_y([(0.16, 'foot' + L), (0.23, 'shin' + L)])
        owners += [(foot, low), (sole, low), (shaft, high), (rim, high)]

    def field(p):
        out = np.full(len(p), 1.0)
        for foot, sole, shaft, inside, rim in parts:
            d = smin(foot(p), shaft(p), 0.04)
            d = smin(d, sole(p), 0.003)
            d = smax(d, -inside(p), 0.004)
            d = smin(d, rim(p), 0.004)
            out = np.minimum(out, d)
        return out

    def details(p, n, own):
        # x: on the sole
        return np.stack([own[:, 1] + own[:, 5], np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('boots', MAT['boot'], 0.0026, (-0.2, -0.012, -0.24), (0.2, BOOT_TOP + 0.02, 0.13), field, owners, 6000, tau=0.01, details=details, outline=0.7)


def grip_frame(s):
    """Where a handle runs through each fist, and which way (toward the
    thumb: forward, with the arm hanging)."""
    S, E, W, dn, out = arm_frame(s)
    return W + 0.064 * dn - 0.028 * out, FW


def hand_parts(s):
    S, E, W, dn, out = arm_frame(s)
    R = np.stack([out, dn, FW], 1)
    A, up = grip_frame(s)
    palm = round_box(W + 0.042 * dn - 0.003 * out, (0.018, 0.033, 0.037), 0.014, R)
    fingers = []
    for k in range(4):
        z = (k - 1.5) * 0.0178
        k0 = A + 0.03 * out + 0.006 * dn - z * up
        k1 = A + 0.012 * out + 0.029 * dn - z * up
        k2 = A - 0.023 * out + 0.021 * dn - z * up
        k3 = A - 0.03 * out - 0.005 * dn - z * up
        r = 0.0108 - 0.001 * abs(k - 1.5)
        fingers.append(stroke([k0, k1, k2, k3], [r, r * 0.98, r * 0.95, r * 0.9]))
    thumb = stroke([W + 0.026 * dn - 0.019 * out + 0.028 * up, A - 0.026 * out + 0.031 * up, A - 0.005 * out + 0.033 * up + 0.022 * dn], [0.0125, 0.011, 0.0095])
    # the wrist and the forearm, up into the sleeve
    wrist = round_cone(W - 0.09 * dn, W + 0.014 * dn, 0.031, 0.029)
    return wrist, palm, fingers, thumb


def g_hands():
    parts, owners = [], []
    for s, L in SIDES:
        wrist, palm, fingers, thumb = hand_parts(s)
        S, E, W, dn, out = arm_frame(s)
        ps = [wrist, palm, thumb] + fingers
        parts.append(ps)
        owners += [(wrist, by_axis(W, dn, [(-0.015, 'fore' + L), (0.01, 'hand' + L)]))] + [(q, rigid('hand' + L)) for q in ps[1:]]

    def field(p):
        out = np.full(len(p), 1.0)
        for ps in parts:
            d = smin(ps[0](p), ps[1](p), 0.016)
            d = smin(d, ps[2](p), 0.01)
            for q in ps[3:]:
                d = smin(d, q(p), 0.006)
            out = np.minimum(out, d)
        for s, _ in SIDES:
            A, up = grip_frame(s)
            out = smax(out, -round_cone(A - 0.08 * up, A + 0.08 * up, 0.0135, 0.0135)(p), 0.003)
        return out

    def details(p, n, own):
        fing = own[:, 3:7].sum(1) + own[:, 10:14].sum(1)
        return np.stack([fing, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('hands', MAT['hand'], 0.0017, (-0.42, 0.56, -0.1), (0.42, 0.95, 0.1), field, owners, 3400, tau=0.006, details=details, outline=0.65)


# --------------------------------------------------------------------------------
# the aquarium on his back: its cap and base, the plate against his back,
# its straps
# --------------------------------------------------------------------------------


def g_tank():
    """The aquarium's hardware, built as a made thing: a stepped cap (a
    collar the glass seats in, a shallower lid over it, a carry handle, a
    filler cap off to one side), a base to match on a foot ring with four
    rubber feet, a slim guard rail down each side from cap to base with the
    straps' brackets on them, the plate against his back, a little pump box
    on the base behind."""
    T = TANK
    c = T['c']
    up = V(0, 1, 0)
    R, H = T['capR'], T['capH']
    # each cap: a collar next the glass, a narrower step beyond it
    col_h = H * 0.56
    top_c = V(c[0], TANK_TOP + col_h / 2 - 0.006, c[2])
    bot_c = V(c[0], TANK_BOT - col_h / 2 + 0.006, c[2])
    top = cyl(top_c, up, R, col_h / 2, 0.006)
    base = cyl(bot_c, up, R, col_h / 2, 0.006)
    lid_y = top_c[1] + col_h / 2
    lid = cyl(V(c[0], lid_y + 0.007, c[2]), up, R * 0.86, 0.011, 0.009)
    dome = ellipsoid((c[0], lid_y + 0.014, c[2]), (R * 0.6, 0.012, R * 0.6))
    foot_y = bot_c[1] - col_h / 2
    foot = cyl(V(c[0], foot_y - 0.006, c[2]), up, R * 0.9, 0.009, 0.006)
    feet = [cyl(V(c[0] + R * 0.62 * math.cos(a), foot_y - 0.017, c[2] + R * 0.62 * math.sin(a)), up, 0.013, 0.006, 0.004) for a in (0.79, 2.36, 3.93, 5.5)]
    # the lips the glass sits in
    lips = [torus_y((c[0], TANK_TOP + 0.001, c[2]), T['r'] + 0.002, 0.0052), torus_y((c[0], TANK_BOT - 0.001, c[2]), T['r'] + 0.002, 0.0052)]
    # a carry handle on the lid (its two posts, the bar between), a filler cap
    hy = lid_y + 0.016
    handle = torus_axis(V(c[0], hy, c[2]), (1, 0, 0), 0.026, 0.0058)
    filler = cyl(V(c[0] + R * 0.5, lid_y + 0.021, c[2] + R * 0.28), up, 0.0125, 0.006, 0.003)
    # the guard rails, the brackets the straps are riveted to
    rails, brackets = [], []
    for sx in (-1, 1):
        rx_, rz_ = c[0] + sx * (R - 0.0035), c[2] - 0.012
        rails.append(round_cone((rx_, TANK_BOT - 0.004, rz_), (rx_, TANK_TOP + 0.004, rz_), 0.0048, 0.0048))
        for yy in (TANK_TOP - 0.022, TANK_BOT + 0.022):
            brackets.append(round_box(V(rx_ + sx * 0.003, yy, rz_ - 0.004), (0.006, 0.012, 0.012), 0.003))
    plate = round_box(V(c[0], c[1], c[2] - T['r'] - 0.006), (0.03, T['half'] + 0.018, 0.007), 0.005)
    # the pump: a little box on the base at the back, a vent tube up from it
    pump = round_box(V(c[0], bot_c[1] - 0.002, c[2] + R + 0.004), (0.022, 0.014, 0.008), 0.004)

    def field(p):
        d = smin(top(p), lid(p), 0.004)
        d = smin(d, dome(p), 0.006)
        d = np.minimum(d, smin(base(p), foot(p), 0.004))
        for q in feet:
            d = smin(d, q(p), 0.002)
        for q in lips:
            d = smin(d, q(p), 0.003)
        d = smin(d, smax(handle(p), lid_y + 0.004 - p[:, 1], 0.003), 0.004)
        d = smin(d, filler(p), 0.002)
        for q in rails:
            d = smin(d, q(p), 0.003)
        for q in brackets:
            d = smin(d, q(p), 0.002)
        d = smin(d, pump(p), 0.003)
        return smin(d, plate(p), 0.005)

    tk = rigid('tank')
    names = [top, base] + lips + [lid, dome, foot] + feet + [handle, filler] + rails + brackets + [pump, plate]
    owners = [(q, tk) for q in names]
    i_top = [0, 4, 5]
    i_bot = [1, 6]
    i_metal = list(range(7 + len(feet), 7 + len(feet) + 2)) + list(range(9 + len(feet), 9 + len(feet) + len(rails) + len(brackets)))

    def details(p, n, own):
        # x: round the tank (rad, 0 straight back from him), y: up from its
        # middle (m), z: on a cap (1 the top, -1 the base; 0 its fittings),
        # w: on a lip (1) / bare metal fittings - the handle, the filler
        # cap, the rails and their brackets (-1)
        q = p - c
        a = np.arctan2(q[:, 0], q[:, 2])
        cap = own[:, i_top].sum(1) - own[:, i_bot].sum(1)
        w = (own[:, 2] + own[:, 3]) - own[:, i_metal].sum(1)
        return np.stack([a, q[:, 1], cap, w], 1)

    lo = c - V(R + 0.03, T['half'] + H + 0.03, R + 0.03)
    hi = c + V(R + 0.03, T['half'] + H + 0.06, R + 0.03)
    return Garment('tank', MAT['tank'], 0.002, lo, hi, field, owners, 5200, tau=0.004, details=details, outline=0.9)


def onto(field, p, lift, steps=6):
    """A point pulled onto a surface (and lifted off it along its normal)."""
    q = np.array([p], float)
    for _ in range(steps):
        g = B.gradient(field, q)
        q = q - (field(q) - lift)[:, None] * g
    return q[0], B.gradient(field, q)[0]


def strap_path(s):
    """A strap: from the top of the plate, over his shoulder, down his front,
    under his arm and back round to the base."""
    c = TANK['c']
    return [
        V(s * 0.028, TANK_TOP - 0.01, c[2] - TANK['r'] - 0.016),
        V(s * 0.065, 1.26, 0.11),
        V(s * 0.098, 1.33, 0.05),
        V(s * 0.112, 1.348, -0.01),
        V(s * 0.12, 1.3, -0.075),
        V(s * 0.127, 1.2, -0.095),
        V(s * 0.138, 1.1, -0.085),
        V(s * 0.152, 1.03, -0.055),
        V(s * 0.165, 0.99, 0.0),
        V(s * 0.155, 0.975, 0.07),
        V(s * 0.1, 0.97, 0.12),
        V(s * 0.03, TANK_BOT + 0.01, c[2] - TANK['r'] - 0.016),
    ]


def g_straps():
    """Charcoal webbing on his jacket, flat, a buckle on each where it's
    adjusted."""
    parts_ = jacket_outer()
    hood_ = parts_[3]

    def surf(q):
        # (the jacket's outside and the hood slumped on it: what they lie on)
        d = jacket_smooth(q, parts_)
        for h in hood_:
            d = smin(d, h(q), 0.028)
        return d

    parts, owners = [], []
    for s, L in SIDES:
        pts = strap_path(s)
        lay = []
        for k, q in enumerate(pts):
            if 0 < k < len(pts) - 1:
                q, nn = onto(surf, q, 0.007)
            else:
                nn = V(0, 0, -1)
            lay.append((q, nn))
        for k in range(len(lay) - 1):
            (a, na), (b, nb) = lay[k], lay[k + 1]
            u = unit(b - a)
            nrm = unit((na + nb) / 2)
            x = unit(np.cross(nrm, u))
            R = np.stack([x, u, unit(np.cross(x, u))], 1)
            L_ = np.linalg.norm(b - a)
            box = round_box((a + b) / 2, (0.0135, L_ / 2 + 0.006, 0.0032), 0.0025, R)
            parts.append(box)
            # (the back of it, and down under his arm, rides with the tank)
            w = rigid('tank') if (k == 0 or k >= len(lay) - 3) else rigid('chest')
            owners.append((box, w))
        # a buckle on his front
        q, nn = onto(surf, V(s * 0.13, 1.16, -0.09), 0.011)
        R = basis(unit(V(0, 1, 0) - nn * nn[1]), nn)
        bk = round_box(q, (0.018, 0.012, 0.004), 0.003, R)
        parts.append(bk)
        owners.append((bk, rigid('chest')))

    def field(p):
        out = np.full(len(p), 1.0)
        for q in parts:
            out = np.minimum(out, q(p))
        return out

    nb = len(parts) // 2

    def details(p, n, own):
        bk = own[:, nb - 1] + own[:, 2 * nb - 1]
        return np.stack([bk, np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('straps', MAT['strap'], 0.0024, (-0.22, 0.82, -0.14), (0.22, 1.36, 0.17), field, owners, 2600, tau=0.004, details=details, outline=0.7)


# --------------------------------------------------------------------------------
# the rod: its cork grip, the reel, the blank and its guides
# --------------------------------------------------------------------------------


def rod_local_prims():
    """The rod's handle and reel, sculpted in the rod's own frame (+y up the
    rod from where his fist holds it, +z the reel's side): a rubber butt
    cap, a cork grip turned to a shape - swelling where the heel of the
    hand sits, waisted, flared again at its top - the reel seat with its
    two hoods and a knurled locking nut, a short cork fore grip tapering
    into a metal winding check where the blank begins. The reel hangs from
    the seat on its stem: the gear housing, the rotor cup turning round a
    deep spool with a lip at each end, the drag knob on the spool's front,
    the bail's wire hoop with its line roller, the crank cranked out to an
    arm and a paddle knob."""
    R0 = ROD
    Y = V(0, 1, 0)
    c0, c1 = R0['cork']
    butt = cyl((0, R0['butt'] + 0.006, 0), Y, 0.0158, 0.009, 0.006)
    cork = aloft((0, 0, 0), Y, [c0, c0 + 0.03, c0 + 0.085, c0 + 0.15, c0 + 0.2, c1 - 0.012, c1], [0.0138, 0.0152, 0.0132, 0.0126, 0.0134, 0.014, 0.0128], start=0.004, end=0.004)
    s0, s1 = R0['seat']
    seat = round_cone((0, s0, 0), (0, s1, 0), 0.0098, 0.0095)
    hoods = [cyl((0, s0 + 0.008, 0), Y, 0.0122, 0.007, 0.003), cyl((0, s1 - 0.02, 0), Y, 0.012, 0.006, 0.003)]
    nut = cyl((0, s1 - 0.007, 0), Y, 0.0132, 0.0055, 0.002)
    f0, f1 = R0['fore']
    fore = aloft((0, 0, 0), Y, [f0, f0 + 0.012, f1 - 0.012, f1], [0.0118, 0.013, 0.0112, 0.0092], start=0.003, end=0.004)
    check = cyl((0, f1 + 0.005, 0), Y, 0.0098, 0.0045, 0.002)
    # the reel
    ry = R0['reel']
    zc = 0.064  # how far the spool's axis hangs below the rod
    foot = round_box((0, ry, 0.0115), (0.0062, 0.03, 0.003), 0.002)
    stem = round_cone((0, ry, 0.013), (0, ry - 0.006, zc - 0.016), 0.005, 0.0064)
    body = ellipsoid((0, ry - 0.012, zc), (0.0185, 0.023, 0.021))
    side = cyl((-0.016, ry - 0.012, zc), (1, 0, 0), 0.0135, 0.004, 0.003)
    rotor = cyl((0, ry + 0.011, zc), Y, 0.0245, 0.0075, 0.004)
    spool = cyl((0, ry + 0.034, zc), Y, 0.0182, 0.015, 0.002)
    lips = [cyl((0, ry + 0.02, zc), Y, 0.0232, 0.0022, 0.0015), cyl((0, ry + 0.049, zc), Y, 0.0238, 0.0026, 0.0018)]
    drag = cyl((0, ry + 0.0565, zc), Y, 0.0115, 0.005, 0.003)
    crank = stroke([V(-0.02, ry - 0.012, zc), V(-0.034, ry - 0.012, zc), V(-0.05, ry - 0.022, zc + 0.012)], [0.0042, 0.0038, 0.0034])
    knob = round_box((-0.053, ry - 0.024, zc + 0.022), (0.0052, 0.0052, 0.0105), 0.0045)
    # the bail: a wire hoop round the front of the spool, its roller
    bail = torus_axis((0, ry + 0.036, zc), unit(0.35, 1, 0), 0.0275, 0.0019)
    roller = ellipsoid((0.026, ry + 0.027, zc), (0.0052, 0.0052, 0.0052))
    return dict(butt=butt, cork=cork, seat=seat, fore=fore, foot=foot, stem=stem, body=body, spool=spool, skirt=rotor, crank=crank, knob=knob, bail=bail,
                hood0=hoods[0], hood1=hoods[1], nut=nut, check=check, side=side, lip0=lips[0], lip1=lips[1], drag=drag, roller=roller)


def g_reel():
    P = rod_local_prims()
    order = ['butt', 'cork', 'seat', 'fore', 'foot', 'stem', 'body', 'spool', 'skirt', 'crank', 'knob', 'bail', 'hood0', 'hood1', 'nut', 'check', 'side', 'lip0', 'lip1', 'drag', 'roller']
    pr = {k: placed(P[k], ROD_R, ROD['grip']) for k in order}
    zc = 0.064

    def field(p):
        d = smin(pr['butt'](p), pr['cork'](p), 0.0015)
        d = smin(d, pr['seat'](p), 0.002)
        for k in ('hood0', 'hood1', 'nut'):
            d = smin(d, pr[k](p), 0.0015)
        d = smin(d, pr['fore'](p), 0.002)
        d = smin(d, pr['check'](p), 0.0015)
        d = smin(d, pr['foot'](p), 0.003)
        d = smin(d, pr['stem'](p), 0.004)
        d = smin(d, pr['body'](p), 0.005)
        d = smin(d, pr['side'](p), 0.003)
        d = smin(d, pr['skirt'](p), 0.003)
        d = smin(d, pr['spool'](p), 0.0015)
        for k in ('lip0', 'lip1', 'drag'):
            d = smin(d, pr[k](p), 0.0012)
        d = smin(d, pr['crank'](p), 0.003)
        d = smin(d, pr['knob'](p), 0.002)
        # (the bail: only the half of its hoop that swings out over the
        # spool's front)
        hoop = smax(pr['bail'](p), -((p - to_body(V(0, ROD['reel'] + 0.036, zc))) @ (ROD_R @ V(0, 0, 1))) - 0.006, 0.002)
        d = np.minimum(d, smin(hoop, pr['roller'](p), 0.002))
        return d

    owners = [(pr[k], rigid('rod')) for k in order]
    ix = {k: i for i, k in enumerate(order)}

    def mats(p, n, own):
        cork = own[:, ix['cork']] + own[:, ix['fore']]
        return np.where(cork > 0.5, MAT['cork'], MAT['reel'])

    def details(p, n, own):
        # x: along the rod (m), y: on the spool (the line wound on it: 1) /
        # the seat's barrel (its thread: -1), z: on the crank's knob, w: the
        # butt cap (1) / bright metal - the spool's lips, the drag knob, the
        # seat's hoods and nut, the winding check, the bail (-1)
        q = (p - ROD['grip']) @ ROD_R
        bright = own[:, [ix['lip0'], ix['lip1'], ix['drag'], ix['hood0'], ix['hood1'], ix['nut'], ix['check'], ix['bail'], ix['roller']]].sum(1)
        y = own[:, ix['spool']] - own[:, ix['seat']]
        w = own[:, ix['butt']] - bright
        return np.stack([q[:, 1], y, own[:, ix['knob']], w], 1)

    lo = np.min([q.lo for q in pr.values()], 0) - 0.01
    hi = np.max([q.hi for q in pr.values()], 0) + 0.01
    return Garment('reel', MAT['reel'], 0.0011, lo, hi, field, owners, 5600, tau=0.0025, details=details, mats=mats, outline=0.6)


# The guides (where along the rod, the ring's radius): a big stripper guide
# nearest the reel, each smaller than the last; and the tip-top at the tip.
GUIDES = [(0.29, 0.0115), (0.41, 0.009), (0.52, 0.0072), (0.615, 0.0058), (0.695, 0.0047), (0.755, 0.0039)]
TIP_TOP = 0.0032
FERRULE = 0.47  # where the rod's two pieces join


def blank_r(y):
    """The blank's radius at y along the rod: a true taper - stout over the
    fore grip, fine at the tip - a metal ferrule where its two pieces join,
    and the thread whipped over each guide's feet standing a little proud."""
    u = (y - ROD['fore'][1]) / (ROD['tip'] - ROD['fore'][1])
    r = 0.0086 * (1 - u) ** 1.25 + 0.0019
    r += 0.0013 * math.exp(-(((y - FERRULE) / 0.011) ** 4))
    for gy, gr in GUIDES:
        r += 0.0009 * math.exp(-(((y - gy) / (0.013 + gr)) ** 4))
    return r


def wrap_at(y):
    """How much thread is whipped round the blank at y (0 / 1): over each
    guide's feet, a band above the winding check, a trim band at the tip."""
    w = 0.0
    for gy, gr in GUIDES:
        w = max(w, 1.0 if abs(y - gy) < 0.011 + gr else 0.0)
    w = max(w, 1.0 if y < ROD['fore'][1] + 0.03 else 0.0)
    w = max(w, 1.0 if y > ROD['tip'] - 0.014 else 0.0)
    return w


def torus_mesh(c, axis, R, r, seg=16, sides=5):
    axis = unit(axis)
    ref = V(1, 0, 0) if abs(axis[0]) < 0.9 else V(0, 1, 0)
    u = unit(np.cross(axis, ref))
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


def g_blank():
    """The blank, meshed directly: from the winding check to the tip, a
    true taper bowing a little under the fish, a ferrule where its pieces
    join; its guides - each a ring stood off it on the reel's side on a
    frame of two legs, one foot ahead of the ring and one behind, whipped
    to the blank - smaller toward the tip, and a tip-top at the very end."""
    y0, y1 = ROD['fore'][1] - 0.004, ROD['tip']
    N = 128
    cl = np.array([rod_point(y) for y in np.linspace(y0, y1, N)])
    v, n, f, U = tube(cl, lambda u: blank_r(y0 + (y1 - y0) * u), 10, N)
    ys = y0 + (y1 - y0) * U
    wr = np.array([wrap_at(y) for y in ys])
    fer = (np.abs(ys - FERRULE) < 0.012).astype(float)
    # (x: along the rod (m), y: -, z: whipped with thread, w: the ferrule
    # (1) / a guide's wire (-1))
    V_, N_, F_, D_ = [v], [n], [f], [np.stack([ys, np.zeros(len(v)), wr, fer], 1)]
    base = len(v)
    n_blank = len(v)

    def add(tv, tn, tf, gy):
        nonlocal base
        V_.append(tv), N_.append(tn), F_.append(tf + base)
        D_.append(np.stack([np.full(len(tv), gy), np.zeros(len(tv)), np.zeros(len(tv)), -np.ones(len(tv))], 1))
        base += len(tv)

    Z = V(0, 0, 1)
    for gy, gr in GUIDES:
        rb = blank_r(gy)
        wire = 0.0011 + 0.035 * gr
        c = rod_point(gy) + Z * (rb + gr + 0.0035 + 0.25 * gr)
        add(*torus_mesh(c, (0, 1, 0), gr, wire * 1.25, 16, 5), gy)
        # (its frame: a leg from the ring's shoulder down to a foot on the
        # blank ahead of it, and one behind)
        for sg in (-1, 1):
            fy = gy + sg * (0.007 + 0.75 * gr)
            ft = rod_point(fy) + Z * (blank_r(fy) * 0.7)
            for sx in (-1, 1):
                st = np.array([ft, c - Z * (gr * 0.55) + V(sx * gr * 0.8, 0, 0)])
                sv, sn, sf, _ = tube(st, lambda u: wire, 4, 2)
                add(sv, sn, sf, gy)
    # the tip-top: a small ring at the very tip, its tube sleeved over the blank
    tip = rod_point(y1)
    add(*torus_mesh(tip + Z * (TIP_TOP + 0.002) + V(0, 0.002, 0), (0, 1, 0), TIP_TOP, 0.0011, 12, 4), y1)
    st = np.array([rod_point(y1 - 0.016), tip + V(0, 0.002, 0)])
    sv, sn, sf, _ = tube(st, lambda u: 0.0034, 6, 2)
    add(sv, sn, sf, y1)
    v, n, f, D = np.concatenate(V_), np.concatenate(N_), np.concatenate(F_), np.concatenate(D_)
    vb = ROD['grip'] + v @ ROD_R.T
    nb = n @ ROD_R.T
    W = np.zeros((len(vb), len(BONES)))
    W[:, IDX['rod']] = 1
    mats = np.where(np.arange(len(v)) >= n_blank, MAT['reel'], MAT['rod']).astype(np.uint8)
    return MeshGarment('blank', MAT['rod'], vb, nb, f, W, D, mats=mats, outline=0.55)


def g_line():
    """The line, from the rod's tip down to the fish's lip (on the fish's
    bone: it swings with it), and the hook's eye through the lip."""
    cl = np.array([ROD_TIP, HOOK + V(0, -0.004, 0)])
    v, n, f, U = tube(cl, lambda u: 0.0011, 5, 8)
    W = np.zeros((len(v), len(BONES)))
    W[:, IDX['catch']] = 1
    D = np.stack([U, np.zeros(len(v)), np.zeros(len(v)), np.zeros(len(v))], 1)
    return MeshGarment('line', MAT['line'], v, n, f, W, D, outline=0.45)

# --------------------------------------------------------------------------------
# the alien fish, hanging by its lip (sculpted in its own frame, at the hook)
# --------------------------------------------------------------------------------


def shifted(prim, t):
    """A volume sculpted about the origin, moved to t."""
    t = V(*t)
    return Prim(lambda p: prim.fn(p - t), prim.lo + t, prim.hi + t)


def fish_prims():
    """Its body in its own frame: snout up, back toward +x, flanks +-z; the
    mouth gaping up at the top, the lower jaw jutting, crooked teeth; big
    eyes high on its flanks; barbels hanging from its chin."""
    body = [
        ellipsoid((-0.006, -0.072, 0), (0.086, 0.084, 0.068)),  # the head
        ellipsoid((0.0, -0.158, 0), (0.1, 0.1, 0.071)),
        ellipsoid((-0.034, -0.17, 0), (0.078, 0.11, 0.064)),  # the belly
        ellipsoid((0.006, -0.245, 0), (0.078, 0.085, 0.056)),
        ellipsoid((0.006, -0.315, 0), (0.047, 0.062, 0.038)),
        ellipsoid((0.006, -0.37, 0), (0.026, 0.04, 0.022)),  # the root of the tail
    ]
    jaw = ellipsoid((-0.058, -0.03, 0), (0.042, 0.05, 0.052))
    gape = ellipsoid((-0.03, 0.004, 0), (0.04, 0.038, 0.04))
    lip_c, lip_ax = V(-0.032, -0.004, 0), unit(-0.38, 1, 0)
    lips = torus_axis(lip_c, lip_ax, 0.04, 0.0135)
    # teeth: crooked fangs up from the lower lip, two down from the upper
    teeth = []
    u = unit(np.cross(lip_ax, V(0, 0, 1)))
    w = V(0, 0, 1)
    rnd = np.random.default_rng(5)
    for k, a in enumerate([2.35, 2.75, 3.14, 3.55, 3.95, 0.5, -0.45]):
        root = lip_c + 0.037 * (math.cos(a) * u + math.sin(a) * w) + 0.004 * lip_ax
        lower = math.cos(a) < 0
        L = (0.02 if k == 2 else 0.015) + rnd.uniform(-0.003, 0.004)
        tipd = unit(lip_ax * (1 if lower else -0.6) + 0.35 * (lip_c - root) / 0.037 + V(0, 0, rnd.uniform(-0.25, 0.25)))
        teeth.append(round_cone(root, root + tipd * L, 0.0052, 0.0011))
    eyes = [ellipsoid((0.026, -0.058, s * 0.057), (0.026, 0.026, 0.019)) for s, _ in SIDES]
    brows = [ellipsoid((0.044, -0.045, s * 0.05), (0.028, 0.016, 0.016)) for s, _ in SIDES]
    barbels = []
    for s, _ in SIDES:
        pts = [V(-0.082, -0.036, s * 0.03), V(-0.104, -0.08, s * 0.048), V(-0.114, -0.14, s * 0.058), V(-0.108, -0.2, s * 0.064), V(-0.094, -0.245, s * 0.062)]
        barbels.append(stroke(pts, [0.0062, 0.0048, 0.0036, 0.0026, 0.0012]))
    return body, jaw, gape, lips, teeth, eyes, brows, barbels


def fish_field_local(p):
    body, jaw, gape, lips, teeth, eyes, brows, barbels = fish_prims()
    d = body[0](p)
    for q in body[1:]:
        d = smin(d, q(p), 0.04)
    d = smin(d, jaw(p), 0.03)
    for e in brows:
        d = smin(d, e(p), 0.02)
    d = smax(d, -gape(p), 0.01)
    d = smin(d, lips(p), 0.008)
    for e in eyes:
        d = smin(d, e(p), 0.012)
    for t in teeth:
        d = smin(d, t(p), 0.0025)
    for b in barbels:
        d = smin(d, b(p), 0.006)
    return d


def g_fish():
    body, jaw, gape, lips, teeth, eyes, brows, barbels = fish_prims()
    H = HOOK
    to = lambda q: shifted(q, H)
    field = lambda p: fish_field_local(p - H)
    tail_w = by_y([(H[1] + CATCH_TAIL[1] - 0.03, 'catchTail'), (H[1] + CATCH_TAIL[1] + 0.03, 'catch')])
    catch = rigid('catch')
    owners = [(to(q), tail_w) for q in body] + [(to(jaw), catch), (to(lips), catch)]
    n_teeth = len(owners)
    owners += [(to(t), catch) for t in teeth]
    n_eye = len(owners)
    owners += [(to(e), catch) for e in eyes]
    owners += [(to(e), catch) for e in brows]
    n_barb = len(owners)
    owners += [(to(b), catch) for b in barbels]

    def details(p, n, own):
        # xyz: where it is on the fish (its own frame), w: which part - 0
        # its body, 1 its lips, 2 a tooth, 3 an eye, 4 a barbel, 5 inside
        # its mouth
        q = p - H
        part = np.zeros(len(p))
        part = np.where(own[:, 7] > 0.5, 1, part)
        part = np.where(own[:, n_teeth:n_eye].sum(1) > 0.5, 2, part)
        part = np.where(own[:, n_eye:n_eye + 2].sum(1) > 0.5, 3, part)
        part = np.where(own[:, n_barb:].sum(1) > 0.5, 4, part)
        inside = (gape.fn(q) < 0.006) & (part != 2)
        part = np.where(inside, 5, part)
        return np.stack([q[:, 0], q[:, 1], q[:, 2], part], 1)

    return Garment('fish', MAT['fish'], 0.0022, H + V(-0.14, -0.42, -0.1), H + V(0.13, 0.04, 0.1), field, owners, 7000, tau=0.006, details=details, outline=0.85)


def sheet(plane_u, plane_v, shape, half_t=0.0032):
    """A fin: a thin sheet in the plane spanned by unit vectors u, v through
    the origin, its outline shape(a, b) (< 0 inside; a, b its coordinates
    along u and v), rounded off a little through its thickness."""
    u, v = unit(plane_u), unit(plane_v)
    nrm = unit(np.cross(u, v))

    def fn(p):
        a, b, c = p @ u, p @ v, p @ nrm
        s = shape(a, b)
        # (full at its root, fining toward its edge)
        t = np.abs(c) - half_t * (0.45 + 0.55 * np.clip(-s / 0.025, 0, 1))
        return smax(s, t, 0.002)

    return fn


def fan(R_of, a0, a1, scallop=0.0, freq=0.0):
    """A fan's outline about its root: radius R_of(angle) between angles a0
    and a1 (radians from +u toward +v), its edge scalloped."""

    def shape(a, b):
        r = np.sqrt(a * a + b * b)
        ang = np.arctan2(b, a)
        R = R_of(ang) * (1 + scallop * np.sin(ang * freq))
        edge = r - R
        side = np.maximum(a0 - ang, ang - a1) * np.maximum(r, 0.01)
        return np.maximum(edge, side)

    return shape


def ell2(ca, cb, ra, rb, scallop=0.0, freq=0.0):
    def shape(a, b):
        da, db = (a - ca) / ra, (b - cb) / rb
        th = np.arctan2(db, da)
        k = np.sqrt(da * da + db * db) - (1 + scallop * np.sin(th * freq))
        return k * min(ra, rb)

    return shape


def fin_prims():
    """Its fins, flowing: a long dorsal fin down its back, a little one
    under it toward the tail, a big tail fanning out in two lobes, and
    broad pectoral fins on its flanks (they flap on bones of their own)."""
    out = {}
    # dorsal: along its back (+x), from behind its head nearly to its tail
    dsh = ell2(-0.2, 0.072, 0.135, 0.06, 0.12, 9.0)
    out['dorsal'] = Prim(sheet((0, 1, 0), (1, 0, 0), lambda a, b: np.maximum(dsh(a, b), 0.03 - b)), (0.02, -0.36, -0.01), (0.15, -0.05, 0.01))
    # anal: under it, toward the tail (-x)
    ash = ell2(-0.3, -0.062, 0.055, 0.045, 0.1, 7.0)
    out['anal'] = Prim(sheet((0, 1, 0), (1, 0, 0), lambda a, b: np.maximum(ash(a, b), b + 0.025)), (-0.12, -0.37, -0.01), (-0.01, -0.22, 0.01))
    # the tail: two long lobes fanning down from the root of the tail, a
    # shallow fork between them, frilled at its edge
    root = V(0.006, -0.372, 0)
    A = 1.05
    tsh = fan(lambda g: 0.125 + 0.07 * (np.abs(g + math.pi / 2) / A) ** 1.6, -math.pi / 2 - A, -math.pi / 2 + A, 0.035, 22.0)
    out['tail'] = Prim(lambda p: sheet((1, 0, 0), (0, 1, 0), tsh)(p - root), root + V(-0.2, -0.22, -0.01), root + V(0.2, 0.02, 0.01))
    # pectorals: broad fans on its flanks, sweeping back (down) and out
    for (s, L), f in zip(SIDES, CATCH_FIN):
        f = V(*f)
        u = V(0, 0, s)  # out from its flank
        v = V(0, -1, 0.0)  # down, toward its tail
        psh = fan(lambda g: 0.072 + 0.03 * np.clip(g / 1.4, 0, 1), -0.25, 1.55, 0.06, 18.0)
        fn = sheet(u, v + V(-0.25, 0, 0), psh, 0.0028)
        out['pec' + L] = Prim(lambda p, fn=fn, f=f: fn(p - f), f + V(-0.04, -0.13, -0.12), f + V(0.04, 0.03, 0.12))
    return out


def g_fins():
    F = fin_prims()
    H = HOOK
    to = lambda q: shifted(q, H)
    names = ['dorsal', 'anal', 'tail', 'pecL', 'pecR']

    def field(p):
        q = p - H
        d = np.full(len(p), 1.0)
        for k in names:
            d = np.minimum(d, F[k](q))
        return d

    yT = H[1] + CATCH_TAIL[1]
    owners = [
        (to(F['dorsal']), by_y([(yT - 0.04, 'catchTail'), (yT + 0.1, 'catch')])),
        (to(F['anal']), rigid('catchTail')),
        (to(F['tail']), rigid('catchTail')),
        (to(F['pecL']), rigid('catchFinL')),
        (to(F['pecR']), rigid('catchFinR')),
    ]

    def details(p, n, own):
        # xyz: on the fish (its frame), w: which fin (0 dorsal, 1 anal, 2
        # tail, 3 a pectoral)
        q = p - H
        which = own[:, 1] + 2 * own[:, 2] + 3 * (own[:, 3] + own[:, 4])
        return np.stack([q[:, 0], q[:, 1], q[:, 2], which], 1)

    return Garment('fins', MAT['fin'], 0.0016, H + V(-0.22, -0.62, -0.16), H + V(0.22, -0.02, 0.16), field, owners, 5200, tau=0.004, details=details, outline=0.5)


# --------------------------------------------------------------------------------
# the goldfish in the tank (in its own frame: swimming toward -z, its back up)
# --------------------------------------------------------------------------------


def g_goldfish():
    c = TANK['c']
    body = ellipsoid((0, 0, 0.002), (0.0108, 0.0152, 0.0235))
    head = ellipsoid((0, 0.0005, -0.0135), (0.0102, 0.0128, 0.0125))
    tail_root = V(0, 0, 0.022)
    tsh = fan(lambda g: 0.025 + 0.008 * (np.abs(g - math.pi / 2) / 0.95) ** 1.5, math.pi / 2 - 0.95, math.pi / 2 + 0.95, 0.06, 16.0)
    tailF = Prim(lambda p: sheet((0, 1, 0), (0, 0, 1), tsh, 0.0011)(p - tail_root), tail_root + V(-0.005, -0.035, -0.005), tail_root + V(0.005, 0.035, 0.04))
    dsh = ell2(0.0, 0.016, 0.012, 0.008, 0.1, 9.0)
    dorsal = Prim(sheet((0, 0, 1), (0, 1, 0), lambda a, b: np.maximum(dsh(a, b), 0.008 - b), 0.001), (-0.004, 0.0, -0.02), (0.004, 0.03, 0.02))
    pecs = []
    for s, _ in SIDES:
        r = V(s * 0.009, -0.006, -0.008)
        sh = fan(lambda g: 0.009, -0.2, 1.3)
        fn = sheet(V(s, -0.3, 0), V(0, -0.2, 1), sh, 0.0009)
        pecs.append(Prim(lambda p, fn=fn, r=r: fn(p - r), r - 0.015, r + 0.015))
    parts = [body, head, tailF, dorsal] + pecs
    loc = lambda p: p - c

    def field(p):
        q = loc(p)
        d = smin(body(q), head(q), 0.008)
        d = smin(d, dorsal(q), 0.002)
        for pc in pecs:
            d = smin(d, pc(q), 0.0015)
        return smin(d, tailF(q), 0.003)

    to = lambda q: shifted(q, c)
    tail_w = along(lambda p: p[:, 2] - c[2], [(0.008, 'goldfish'), (0.02, 'goldTail')])
    owners = [(to(body), tail_w), (to(head), rigid('goldfish')), (to(tailF), rigid('goldTail')), (to(dorsal), tail_w)] + [(to(pc), rigid('goldfish')) for pc in pecs]

    def details(p, n, own):
        # xyz: on the fish (its frame), w: on a fin
        q = loc(p)
        return np.stack([q[:, 0], q[:, 1], q[:, 2], own[:, 2:].sum(1)], 1)

    return Garment('goldfish', MAT['gold'], 0.0008, c + V(-0.03, -0.045, -0.035), c + V(0.03, 0.045, 0.075), field, owners, 1800, tau=0.002, details=details, outline=0.4)


# --------------------------------------------------------------------------------
# what the fish is kept off as it swings (bind space, each with its bone)
# --------------------------------------------------------------------------------


def cap(bone_, a, b, ra, rb):
    return dict(kind='cap', bone=bone_, a=lst(a), b=lst(b), ra=ra, rb=rb)


def ell(bone_, c, r):
    return dict(kind='ell', bone=bone_, c=lst(c), r=lst(r))


def colliders():
    J = JACKET
    S, E, W, d, o = arm_frame(1)
    T = TANK
    return [
        ell('head', CRAN[0], V(*CRAN[1]) + 0.035),
        ell('chest', (0, 1.15, 0.008), (0.175, 0.2, 0.135)),
        ell('chest', (0, 1.3, 0.012), (0.175, 0.08, 0.115)),
        ell('spine', (0, 0.92, 0.02), (0.195, 0.18, 0.15)),
        cap('tank', T['c'] - V(0, T['half'] + T['capH'], 0), T['c'] + V(0, T['half'] + T['capH'], 0), T['capR'] + 0.01, T['capR'] + 0.01),
        cap('armR', S, E, 0.066, 0.064),
    ]


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_hair(), g_inner(), g_jacket(), g_trousers(), g_boots(), g_hands(), g_tank(), g_straps(), g_reel(), g_blank(), g_line(), g_fish(), g_fins(), g_goldfish()]
    out = OUT
    if os.environ.get('BODY'):
        # (the mannequin under his clothes, to look at on its own:
        # assets/fisher-body/, not used by the game)
        garments = [g_body(), g_head(), g_hands()]
        out = OUT + '-body'
    only = os.environ.get('ONLY')
    if only:
        out = OUT + '-dbg'
        # (just these, to look at on their own: assets/fisher-dbg/)
        garments = [g for g in garments if g.name in only.split(',')]
    gripL, _ = grip_frame(-1)
    gripR, _ = grip_frame(1)
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST, kneeY=KNEE_Y,
        hair=[dict(name=n, dir=lst(unit(V(*piv) - V(*CRAN[0]))), **k) for n, piv, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])], nose=list(NOSE), eye=list(EYE), mouth=list(MOUTH),
        # each fist's grip (bind space: where a handle runs through it; its
        # axis -z, toward the thumb)
        grip=dict(L=lst(gripL), R=lst(gripR)),
        # the rod: where the fist holds it, its tip (rod space), the line's
        # length to the fish's lip; the fish: how long it is, where its tail
        # and fins pivot (from the lip, in its frame)
        rod=dict(grip=lst(ROD['grip']), tip=lst(rod_point(ROD['tip'])), butt=ROD['butt'], line=LINE),
        catch=dict(len=FISH_LEN, tail=lst(CATCH_TAIL), fins=[lst(f) for f in CATCH_FIN], hook=lst(HOOK)),
        tank=dict(c=lst(TANK['c']), r=TANK['r'], half=TANK['half'], capR=TANK['capR'], capH=TANK['capH']),
        gold=dict(len=GOLD['len'], tail=lst(GOLD['tail'])),
        colliders=colliders(),
        jacket=dict(hem=JACKET['hem'], cuff=CUFF_U, open=[list(OPEN[0]), list(OPEN[1])]),
        bib=dict(top=BIB['top'], half=BIB['half'], bottom=BIB['bottom']),
        trousers=dict(hem=TROUSERS['hem']), bootX=BOOT_X, bootTop=BOOT_TOP, soleH=SOLE_H,
    )
    B.export(garments, out, MAT, rig, 'fisher', 'fisher.py')
    print(f'fisher: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
