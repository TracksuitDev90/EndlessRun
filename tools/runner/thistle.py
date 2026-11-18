#!/usr/bin/env python3
"""Sculpt Teasel, the storm thistle who runs with you, and write
assets/thistle/runner.json + runner.bin.

Sculpted the way the pitcher plant is (build.py's kit: every surface a
signed-distance field, polygonised, skinned by which volume owns each point;
the markings drawn by the game's character shader, THISTLE) after its
reference: a living seedpod about the size of a grapefruit, a deep plum husk
built of overlapping papery leaves - fine veins, curled edges, pointed tips -
in three layers:

  * the husk: long leaves rising from the bottom of the pod and wrapping up
    round it, each a little proud of the one before so their edges overlap;
  * the hood: leaves hanging down from the top over the husk, shortest at the
    front, where they stop just above a dark slot in the husk - two small
    amber eyes peek out of it from under the hood's middle leaf - and
    longest round the sides and back, where their tips flare out in a ruff;
  * the tuft: a little crown of upright leaves round the top, where the
    plumes come out (the plumes aren't sculpted: the game draws them as
    feather-textured strips, see src/game/thistle.js);

and three root legs out of its underside - two at the front, one behind -
each bent at a knobbly knee and splayed into rootlet toes, with the pod held
high enough off the road to see every step.

Each leaf is a thin shell laid over the pod's sphere (the pod's own
coordinates: how far round, how far from the pole it grows from), its outline
a pointed oval, its edges rolled outward and its tip curled away.

Each vertex carries (detail): on a leaf x across it (-1..1), y along it (0
the base, 1 the tip), z how far in from its edge (m), w a seed for that leaf
(0..1); on the legs x which leg (0 left, 0.5 right, 1 behind), y how far down
it (0 the hip, 1 a toe's tip).

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/thistle.py

Coordinates are the game's: metres, y up, facing -z, standing over the origin.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smooth, clamp, ellipsoid, round_cone, stroke, Prim, Garment, rigid, along, bone  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'thistle')
D2R = math.pi / 180

# --------------------------------------------------------------------------------
# the pod
# --------------------------------------------------------------------------------

C = V(0, 0.17, 0)  # its middle
R0 = 0.098  # the husk's radius
SQY = 0.93  # a little squat, like an onion
TH = 0.0024  # half a leaf's thickness

# the eyes: how far round (deg, + toward its right), how far down from the
# top (deg), their radius
EYE_AZ, EYE_POL, EYE_R = 19.0, 84.0, 0.0148

# the husk's leaves, rising from the bottom: (round, deg; how far up they
# reach, deg from the bottom pole; half-width, deg at the equator; how far
# proud of the husk, m; tip flare)
HUSK = [
    (0, 90, 22, 0.0045, 0),
    (24, 88, 21, 0.0, 0),
    (-24, 88, 21, 0.0, 0),
    (50, 96, 24, 0.0045, 0),
    (-50, 96, 24, 0.0045, 0),
    (78, 116, 24, 0.0, 0),
    (-78, 116, 24, 0.0, 0),
    (108, 122, 24, 0.0045, 0),
    (-108, 122, 24, 0.0045, 0),
    (142, 120, 24, 0.0, 0),
    (-142, 120, 24, 0.0, 0),
    (180, 118, 22, 0.0045, 0),
]
# the hood's, hanging from the top: (round; how far down they reach, deg from
# the top; half-width; proud; flare: how far the tip juts out, m)
HOOD = [
    (0, 90, 14, 0.0115, 0.006),
    (32, 72, 20, 0.0085, 0.012),
    (-32, 72, 20, 0.0085, 0.012),
    (62, 93, 20, 0.0115, 0.03),
    (-62, 93, 20, 0.0115, 0.03),
    (92, 104, 20, 0.0085, 0.044),
    (-92, 104, 20, 0.0085, 0.044),
    (122, 106, 20, 0.0115, 0.04),
    (-122, 106, 20, 0.0115, 0.04),
    (152, 102, 20, 0.0085, 0.034),
    (-152, 102, 20, 0.0085, 0.034),
    (180, 98, 18, 0.0115, 0.028),
]
# the tuft round the top: (round, deg; how steep, deg up from level; length;
# half-width)
TUFT = [(0, 62, 0.058, 0.016), (60, 58, 0.052, 0.015), (120, 64, 0.06, 0.016), (180, 58, 0.05, 0.015), (240, 63, 0.056, 0.016), (300, 59, 0.054, 0.015), (30, 74, 0.04, 0.011), (200, 76, 0.042, 0.011)]
TOP = C + V(0, R0 * SQY, 0)
CROWN = TOP + V(0, 0.016, 0)  # where the plumes come out

# the legs: hip -> knee -> ankle, (round, deg; distance out from the middle;
# height) for each joint; front left, front right, behind
LEGS = {
    'L': dict(az=-52, hip=(0.05, 0.1), knee=(0.112, 0.084), ankle=(0.138, 0.016), r=(0.0145, 0.0115, 0.009)),
    'R': dict(az=52, hip=(0.05, 0.1), knee=(0.112, 0.084), ankle=(0.138, 0.016), r=(0.0145, 0.0115, 0.009)),
    'B': dict(az=180, hip=(0.05, 0.098), knee=(0.118, 0.09), ankle=(0.142, 0.016), r=(0.0155, 0.012, 0.0095)),
}
LEG_NAMES = ['L', 'R', 'B']

MAT = dict(husk=1, hood=2, core=3, eye=4, root=5, tuft=6)


def leg_point(L, which):
    g = LEGS[L]
    a = g['az'] * D2R
    r, y = g[which]
    return V(math.sin(a) * r, y, -math.cos(a) * r)


# --------------------------------------------------------------------------------
# the skeleton
# --------------------------------------------------------------------------------


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('pod', 'body', C)
    # (the hood's front leaves lift and drop from the top: to peek, to cower)
    bone('brow', 'pod', TOP - C)
    bone('crown', 'pod', CROWN - C)
    for L in LEG_NAMES:
        hip, knee, ankle = leg_point(L, 'hip'), leg_point(L, 'knee'), leg_point(L, 'ankle')
        # (the legs hang off the body, not the pod: the game sets each hip
        # where the pod's underside is and aims them at their feet)
        bone('hip' + L, 'body', hip)
        bone('knee' + L, 'hip' + L, knee - hip)
        bone('foot' + L, 'knee' + L, ankle - knee)


# --------------------------------------------------------------------------------
# the husk: leaves laid over a sphere
# --------------------------------------------------------------------------------


def pod_coords(p):
    """The pod's own coordinates: radius (squat undone), angle down from the
    top (rad), angle round (rad, 0 the front, + toward its right)."""
    q = p - C
    q = q * V(1, 1 / SQY, 1)
    r = np.sqrt((q * q).sum(1)) + 1e-9
    pol = np.arccos(clamp(q[:, 1] / r, -1, 1))
    az = np.arctan2(q[:, 0], -q[:, 2])
    return r, pol, az


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


class Leaf:
    """One leaf of the husk or the hood, growing from a pole of the pod.
    up: True grows from the bottom pole up (the husk), False from the top
    down (the hood)."""

    def __init__(self, az, reach, half, proud, flare, up, seed):
        self.az, self.reach, self.half = az * D2R, reach * D2R, half * D2R
        self.proud, self.flare, self.up, self.seed = proud, flare, up, seed

    def coords(self, r, pol, az):
        s = (math.pi - pol) if self.up else pol  # angle from its base pole
        t = s / self.reach
        da = wrap(az - self.az)
        # across: arc length round at this latitude (m)
        sp = np.sin(pol)
        v = da * sp * R0
        # its outline: a pointed oval, widest a little past halfway, drawn to
        # a fine point (a slow wave along its edges)
        tt = clamp(t, 0, 1)
        hw = self.half * R0 * np.sin(math.pi * tt ** (0.5 if self.up else 0.6)) ** (0.6 if self.up else 0.75) * (1 + 0.05 * np.sin(tt * 19 + self.seed * 7))
        # where its surface lies: proud of the husk, the edges rolled outward,
        # the tip curled away, a soft crease down the middle
        e = clamp(np.abs(v) / np.maximum(hw, 1e-4), 0, 1.4)
        R = R0 + self.proud + 0.0016 * (1 - e * e)
        R = R + 0.0085 * e ** 4 * smooth(0.12, 0.4, tt)
        R = R - 0.0012 * np.exp(-((v / 0.0025) ** 2))
        R = R + self.flare * smooth(0.5, 1.0, t) ** 2.2
        if self.up:
            R = R + 0.012 * smooth(0.82, 1.0, t) ** 2
        return t, v, hw, R

    def field(self, r, pol, az):
        t, v, hw, R = self.coords(r, pol, az)
        d = np.abs(r - R) - TH
        edge = np.abs(v) - hw
        edge = np.maximum(edge, (t - 1) * self.reach * R0)
        # (the hood's tips stand off the husk: let them through freely)
        return np.maximum(d, edge), edge

    def details(self, r, pol, az):
        t, v, hw, R = self.coords(r, pol, az)
        out = np.zeros((len(r), 4))
        out[:, 0] = clamp(v / np.maximum(hw, 1e-3), -1, 1)
        out[:, 1] = clamp(t, 0, 1)
        out[:, 2] = np.maximum(0, hw - np.abs(v))
        out[:, 3] = self.seed
        return out


HUSK_L = [Leaf(a, reach, half, proud, 0.0, True, (i * 0.37 + 0.1) % 1) for i, (a, reach, half, proud, flare) in enumerate(HUSK)]
HOOD_L = [Leaf(a, reach, half, proud, flare, False, (i * 0.53 + 0.31) % 1) for i, (a, reach, half, proud, flare) in enumerate(HOOD)]


def leaves_field(leaves, p):
    r, pol, az = pod_coords(p)
    d = np.full(len(p), 1.0)
    for lf in leaves:
        d = np.minimum(d, lf.field(r, pol, az)[0])
    return d


def eye_centres():
    out = []
    for s in (-1, 1):
        a, pl = s * EYE_AZ * D2R, EYE_POL * D2R
        rr = R0 - 0.0035
        q = V(math.sin(pl) * math.sin(a) * rr, math.cos(pl) * rr * SQY, -math.sin(pl) * math.cos(a) * rr)
        out.append(C + q)
    return out


EYES = eye_centres()


def core_fn(p):
    q = (p - C) * V(1, 1 / SQY, 1)
    return np.sqrt((q * q).sum(1)) - (R0 - 0.004)


def g_pod():
    eyes = [ellipsoid(e, (EYE_R, EYE_R * 1.08, EYE_R)) for e in EYES]
    core = Prim(core_fn, C - R0, C + R0)

    def field(p):
        d = core_fn(p)
        for e in eyes:
            d = np.minimum(d, e.fn(p))
        d = np.minimum(d, leaves_field(HUSK_L + HOOD_L, p))
        return d

    lo = C - V(0.2, 0.125, 0.2)
    hi = C + V(0.2, 0.115, 0.2)

    # the front three leaves of the hood lift on the brow: a little at their
    # roots, all of it at their tips
    def hood_w(lf):
        def fn(p):
            r, pol, az = pod_coords(p)
            t = clamp(pol / lf.reach, 0, 1)
            k = smooth(0.15, 0.7, t)
            return [(B.IDX['pod'], 1 - k), (B.IDX['brow'], k)]

        return fn

    leaf_prims = []
    for lf in HUSK_L + HOOD_L:
        leaf_prims.append(Prim(lambda p, lf=lf: lf.field(*pod_coords(p))[0], lo, hi))
    owners = [(core, rigid('pod'))] + [(e, rigid('pod')) for e in eyes]
    for lf, pr in zip(HUSK_L + HOOD_L, leaf_prims):
        front_hood = (not lf.up) and abs(lf.az) < 40 * D2R
        owners.append((pr, hood_w(lf) if front_hood else rigid('pod')))

    nl = len(HUSK_L) + len(HOOD_L)

    def details(p, n, own):
        r, pol, az = pod_coords(p)
        out = np.zeros((len(p), 4))
        k = np.argmax(own[:, 3:], 1)
        allleaves = HUSK_L + HOOD_L
        for i, lf in enumerate(allleaves):
            m = k == i
            if m.any():
                out[m] = lf.details(r[m], pol[m], az[m])
        # the core and the eyes: where they are on the eye (the eye's own
        # coordinates come from the rest position, in the shader)
        nonleaf = own[:, :3].sum(1) > 0.5
        out[nonleaf] = 0
        return out

    def mats(p, n, own):
        m = np.full(len(p), MAT['husk'])
        k = np.argmax(own, 1)
        m[k == 0] = MAT['core']
        m[(k == 1) | (k == 2)] = MAT['eye']
        m[k >= 3 + len(HUSK_L)] = MAT['hood']
        return m

    return Garment('pod', MAT['husk'], 0.0016, lo, hi, field, owners, 20000, tau=0.0012, details=details, mats=mats, outline=0.6)


# --------------------------------------------------------------------------------
# the tuft: little upright leaves round the top
# --------------------------------------------------------------------------------


def blade(base, d, L, W, seed):
    d = d / np.linalg.norm(d)
    across = np.cross(d, V(0, 1, 0))
    if np.linalg.norm(across) < 1e-3:
        across = V(1, 0, 0)
    across /= np.linalg.norm(across)
    nrm = np.cross(across, d)  # (outward and up)

    def coords(p):
        q = p - base
        return q @ d, q @ across, q @ nrm

    def surf(u, v):
        t = clamp(u / L, 0, 1.2)
        hw = W * np.sin(math.pi * np.minimum(t, 1) ** 0.6) ** 0.8
        # cupped round the plumes, the tip curled out and back
        w0 = 1.6 * v * v / W * 0.5 - 0.5 * L * smooth(0.55, 1.0, t) ** 2
        return t, hw, w0

    def fn(p):
        u, v, w = coords(p)
        t, hw, w0 = surf(u, v)
        edge = np.maximum(np.maximum(np.abs(v) - hw, -u), u - L)
        return np.maximum(np.abs(w - w0) - TH * 0.85, edge)

    def det(p):
        u, v, w = coords(p)
        t, hw, w0 = surf(u, v)
        out = np.zeros((len(p), 4))
        out[:, 0] = clamp(v / np.maximum(hw, 1e-3), -1, 1)
        out[:, 1] = clamp(t, 0, 1)
        out[:, 2] = np.maximum(0, hw - np.abs(v))
        out[:, 3] = seed
        return out

    return Prim(fn, base - L - 0.02, base + L + 0.02), det


def g_tuft():
    blades = []
    for i, (a, el, L, W) in enumerate(TUFT):
        a, el = a * D2R, el * D2R
        out = V(math.sin(a), 0, -math.cos(a))
        d = out * math.cos(el) + V(0, math.sin(el), 0)
        base = TOP + out * 0.012 - V(0, 0.012, 0)
        blades.append(blade(base, d, L, W, (i * 0.29 + 0.6) % 1))
    stalk = round_cone(TOP - V(0, 0.02, 0), CROWN + V(0, 0.006, 0), 0.016, 0.009)

    def field(p):
        d = stalk.fn(p)
        for b, _ in blades:
            d = np.minimum(d, b.fn(p))
        return d

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        for i, (b, det) in enumerate(blades):
            m = k == i + 1
            if m.any():
                out[m] = det(p[m])
        out[k == 0, 1] = 1.0
        return out

    lo = TOP - V(0.1, 0.04, 0.1)
    hi = TOP + V(0.1, 0.09, 0.1)
    owners = [(stalk, rigid('crown'))] + [(b, rigid('crown')) for b, _ in blades]
    return Garment('tuft', MAT['tuft'], 0.0012, lo, hi, field, owners, 3000, tau=0.002, details=details, outline=0.6)


# --------------------------------------------------------------------------------
# the legs: jointed roots splayed into rootlet toes
# --------------------------------------------------------------------------------


def g_legs():
    parts = []
    for i, L in enumerate(LEG_NAMES):
        g = LEGS[L]
        hip, knee, ankle = leg_point(L, 'hip'), leg_point(L, 'knee'), leg_point(L, 'ankle')
        ra, rk, rf = g['r']
        a = g['az'] * D2R
        out = V(math.sin(a), 0, -math.cos(a))
        side = np.cross(V(0, 1, 0), out)
        # (a gentle S through each segment, so they read as roots, not tubes)
        mid1 = (hip + knee) / 2 + V(0, 0.01, 0) + side * 0.004
        mid2 = (knee + ankle) / 2 + out * 0.008 - side * 0.003
        upper = stroke([hip + V(0, 0.022, 0), hip, mid1, knee], [ra * 1.1, ra, ra * 0.92, rk])
        lower = stroke([knee, mid2, ankle], [rk, rk * 0.9, rf])
        kn = ellipsoid(knee + V(0, 0.002, 0), (rk * 1.35, rk * 1.25, rk * 1.35))
        an = ellipsoid(ankle + V(0, 0.003, 0), (rf * 1.45, rf * 1.1, rf * 1.45))
        # toes: three rootlets splayed out along the road, one nub behind
        toes = []
        for k, (da, reach, th) in enumerate([(-0.75, 0.034, 0.0058), (0.0, 0.04, 0.0064), (0.75, 0.032, 0.0056), (math.pi, 0.016, 0.005)]):
            dd = out * math.cos(da) + side * math.sin(da)
            if L == 'B':
                dd = out * math.cos(da) + side * math.sin(da)
            p0 = ankle + V(0, -0.004, 0)
            p1 = p0 + dd * reach * 0.55 + V(0, -0.008, 0)
            p2 = p0 + dd * reach + V(0, -0.0085, 0) + np.cross(dd, V(0, 1, 0)) * 0.004 * (1 if k % 2 else -1)
            toes.append(stroke([p0, p1, p2], [th, th * 0.75, th * 0.35]))
        parts.append((L, i, hip, knee, ankle, upper, lower, kn, an, toes))

    def field(p):
        d = np.full(len(p), 1.0)
        for L, i, hip, knee, ankle, upper, lower, kn, an, toes in parts:
            f = smin(upper.fn(p), lower.fn(p), 0.004)
            f = smin(f, kn.fn(p), 0.004)
            f = smin(f, an.fn(p), 0.005)
            for t in toes:
                f = smin(f, t.fn(p), 0.004)
            d = np.minimum(d, f)
        return np.maximum(d, -p[:, 1] + 0.0005)

    owners = []
    for L, i, hip, knee, ankle, upper, lower, kn, an, toes in parts:
        dk = (knee - hip) / np.linalg.norm(knee - hip)
        dl = (ankle - knee) / np.linalg.norm(ankle - knee)
        # (the upper root bends into the knee's bone a little before the knee)
        uw = along(lambda p, hip=hip, dk=dk: (p - hip) @ dk, [(-1.0, 'hip' + L), (np.linalg.norm(knee - hip) - 0.01, 'hip' + L), (np.linalg.norm(knee - hip) + 0.004, 'knee' + L)])
        lw = along(lambda p, knee=knee, dl=dl: (p - knee) @ dl, [(-0.006, 'hip' + L), (0.006, 'knee' + L), (np.linalg.norm(ankle - knee) - 0.012, 'knee' + L), (np.linalg.norm(ankle - knee), 'foot' + L)])
        owners += [(upper, uw), (lower, lw), (kn, rigid('knee' + L)), (an, rigid('foot' + L))] + [(t, rigid('foot' + L)) for t in toes]

    per = len(owners) // 3

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        leg = k // per
        out[:, 0] = leg * 0.5
        for j, (L, i, hip, knee, ankle, *_r) in enumerate(parts):
            m = leg == j
            if not m.any():
                continue
            q = p[m]
            l1 = np.linalg.norm(knee - hip)
            l2 = np.linalg.norm(ankle - knee)
            # how far down the leg: by the nearest of its two segments
            t1 = clamp(((q - hip) @ (knee - hip)) / (l1 * l1), 0, 1) * l1
            t2 = l1 + clamp(((q - knee) @ (ankle - knee)) / (l2 * l2), 0, 1) * l2
            d1 = np.linalg.norm(q - (hip + np.outer(t1 / l1, knee - hip)), axis=1)
            d2 = np.linalg.norm(q - (knee + np.outer((t2 - l1) / l2, ankle - knee)), axis=1)
            t = np.where(d1 < d2, t1, t2) / (l1 + l2)
            toe = np.linalg.norm((q - ankle) * V(1, 0, 1), axis=1)
            t = np.where(q[:, 1] < ankle[1] - 0.002, 1 + toe / 0.04 * 0.25, t * 0.8 + 0.0)
            out[m, 1] = clamp(t, 0, 1.25)
        return out

    lo = (-0.22, 0.0, -0.22)
    hi = (0.22, 0.14, 0.22)
    return Garment('legs', MAT['root'], 0.0013, lo, hi, field, owners, 5200, tau=0.0025, details=details, outline=0.8)


# --------------------------------------------------------------------------------


def build():
    t0 = time.time()
    build_rig()
    garments = [g_pod(), g_tuft(), g_legs()]
    J = {b['name']: [round(float(x), 5) for x in b['world'][:3, 3]] for b in B.BONES}
    r5 = lambda v: [round(float(x), 5) for x in v]
    rig = dict(
        joints=J,
        pod=dict(c=r5(C), r=R0, sqy=SQY),
        crown=r5(CROWN),
        top=r5(TOP),
        eyes=[r5(e) for e in EYES],
        eyeR=EYE_R,
        legs={L: dict(hip=r5(leg_point(L, 'hip')), knee=r5(leg_point(L, 'knee')), ankle=r5(leg_point(L, 'ankle')), az=LEGS[L]['az']) for L in LEG_NAMES},
    )
    B.export(garments, OUT, MAT, rig, 'thistle', 'thistle.py')
    print(f'thistle: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
