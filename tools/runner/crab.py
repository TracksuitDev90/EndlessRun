#!/usr/bin/env python3
"""Sculpt Shoal, the giant opal crab who runs with you, and write
assets/crab/runner.json + runner.bin.

Sculpted the way the thistle is (build.py's kit: every surface a
signed-distance field, polygonised, skinned by which volume owns each point;
the colours and the mineral drawn by the game's character shader, CRAB) after
his character sheet: a broad, softly rounded crab about knee-high to the
runner at his shell's crown, everything about him grown from translucent
opalescent minerals:

  * the carapace: a low dome laid over with three tiers of shell plates, each
    a thin lamina proud of the one beneath, its lower edge scalloped and
    flared out a little, the tiers overlapping like shingles; at the front the
    lowest tier lifts away over his face;
  * under it a pale, rounded body: the belly plates and, at the front, a soft
    face (the game draws his smile on it), two eyes on gently curved stalks
    standing up out of it in front of the shell's lip;
  * eight walking legs, four a side, each a chain of faceted crystal
    segments - hexagonal, drawn to points at their ends - between rounded
    mineral joints, the last segment a long pointed crystal;
  * a small claw on his left, held up, and on his right one very much larger,
    resting forward on the road: an iridescent casing round a window of clear
    crystal on both its faces (the game draws the window see-through; it is
    its own material), a hinged finger;
  * two branching coral clusters growing out of the shell's top plates,
    their roots crusted over with mineral beads where they meet the shell.

Each vertex carries (detail):
  shell plates: x how far round (-1..1, 0 the front), y down the plate (0 its
    root, 1 its edge), z how far in from the edge (m), w the tier (0..1);
  belly and face: z 1 on the face;
  legs and arms: x which limb (0..1), y along it (0 the hip, 1 the tip), w 1
    on a joint;
  claws: x how far out across the window (0 its middle, 1 its rim), y along
    the claw (0 the wrist, 1 the tip), z which face (+1 outer, -1 inner), w 1
    on the big claw;
  coral: x how far up its branch (0 the root .. 1 a tip), y the cluster, w 1
    on the crust.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/crab.py

Coordinates are the game's: metres, y up, facing -z (his right is +x),
standing over the origin.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smooth, clamp, ellipsoid, round_cone, stroke, Prim, Garment, rigid, along, bone  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'crab')
D2R = math.pi / 180

MAT = dict(shell=1, belly=2, leg=3, joint=4, claw=5, glass=6, eye=7, stalk=8, coral=9, crust=10)

# --------------------------------------------------------------------------------
# the carapace
# --------------------------------------------------------------------------------

C = V(0, 0.4, 0.03)  # its middle
SX, SY, SZ = 0.62, 0.34, 0.5  # its half-width, height, depth (at radius 1)
# the tiers, top first: (radius, normalised; how far down they reach, deg from
# the top; how far the front lifts away, deg; the scallops: count, depth deg)
TIERS = [
    (1.17, 54, 4, 4, 9.0),
    (1.08, 76, 14, 5, 8.0),
    (0.99, 100, 36, 6, 6.0),
]
TH = 0.012  # half a plate's thickness
FLARE = 0.19  # how far a plate's edge lifts out (normalised)


def shell_coords(p):
    q = p - C
    qn = q / V(SX, SY, SZ)
    r = np.sqrt((qn * qn).sum(1)) + 1e-9
    pol = np.arccos(clamp(qn[:, 1] / r, -1, 1))
    az = np.arctan2(qn[:, 0], -qn[:, 2])
    # |grad r|, to turn distances in r into metres
    g = qn / V(SX, SY, SZ) / r[:, None]
    gl = np.sqrt((g * g).sum(1)) + 1e-9
    return r, pol, az, gl


def tier_edge(k, az):
    R, reach, lift, n, depth = TIERS[k]
    e = reach + depth * np.cos(n * az + k * 1.3) + 0.5 * depth * np.cos((2 * n + 1) * az + k)
    return (e - lift * np.exp(-((az / 0.55) ** 2))) * D2R


def tier_field(k, p, sc=None):
    r, pol, az, gl = sc if sc is not None else shell_coords(p)
    R = TIERS[k][0]
    e = tier_edge(k, az)
    t = pol / e
    Rk = R + FLARE * smooth(0.5, 1.0, t) ** 2 * (0.75 + 0.25 * np.cos(TIERS[k][3] * 2 * az + k)) + 0.03 * np.sin(az * TIERS[k][3] * 2 + k * 2.1) * smooth(0.45, 1.0, t)
    d = np.abs(r - Rk) / gl - TH
    # (its edge: an arc length along the surface, roughly)
    edge = (pol - e) * (SX + SY) * 0.5
    return np.maximum(d, edge), t, e


def shell_y(x, z, R=1.17):
    """The height of a tier's surface over (x, z)."""
    u = 1 - ((x - C[0]) / (SX * R)) ** 2 - ((z - C[2]) / (SZ * R)) ** 2
    return C[1] + SY * R * math.sqrt(max(u, 0))


def g_shell():
    core = ellipsoid(C, (SX * 0.96, SY * 0.96, SZ * 0.96))

    def field(p):
        sc = shell_coords(p)
        d = core(p)
        for k in range(len(TIERS)):
            d = np.minimum(d, tier_field(k, p, sc)[0])
        return d

    lo = C - V(SX * 1.32, SY * 1.5, SZ * 1.32)
    hi = C + V(SX * 1.32, SY * 1.25, SZ * 1.32)

    tiers = [Prim(lambda p, k=k: tier_field(k, p)[0], lo, hi) for k in range(len(TIERS))]
    owners = [(core, rigid('shell'))] + [(t, rigid('shell')) for t in tiers]

    def details(p, n, own):
        r, pol, az, gl = shell_coords(p)
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        for i in range(len(TIERS)):
            m = k == i + 1
            if not m.any():
                continue
            e = tier_edge(i, az[m])
            out[m, 0] = az[m] / math.pi
            out[m, 1] = clamp(pol[m] / e, 0, 1)
            out[m, 2] = np.maximum(0, (e - pol[m]) * (SX + SY) * 0.5)
            out[m, 3] = i / (len(TIERS) - 1)
        m = k == 0
        out[m, 1] = 1
        out[m, 3] = 1
        return out

    return Garment('shell', MAT['shell'], 0.0065, lo, hi, field, owners, 24000, tau=0.004, details=details, outline=0.5)


# --------------------------------------------------------------------------------
# the body beneath: belly plates and the face
# --------------------------------------------------------------------------------

BELLY_C, BELLY_R = V(0, 0.3, 0.04), (0.46, 0.16, 0.38)
FACE_C, FACE_R = V(0, 0.33, -0.36), (0.23, 0.13, 0.1)


def g_belly():
    belly = ellipsoid(BELLY_C, BELLY_R)
    face = ellipsoid(FACE_C, FACE_R)
    # (his mouthparts: a soft rounded pad low on his face)
    chin = ellipsoid(FACE_C + V(0, -0.06, -0.02), (0.12, 0.06, 0.07))

    def field(p):
        d = smin(belly(p), face(p), 0.06)
        return smin(d, chin(p), 0.03)

    lo = BELLY_C - V(0.5, 0.22, 0.5)
    hi = BELLY_C + V(0.5, 0.22, 0.42)

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = smooth(-0.24, -0.33, p[:, 2]) * smooth(0.12, 0.05, np.abs(p[:, 0]) * 0.5)
        out[:, 2] = np.maximum(out[:, 2], clamp((own[:, 1] + own[:, 2]), 0, 1))
        return out

    owners = [(belly, rigid('shell')), (face, rigid('shell')), (chin, rigid('shell'))]
    return Garment('belly', MAT['belly'], 0.008, lo, hi, field, owners, 9000, tau=0.01, details=details, outline=0.5)


# --------------------------------------------------------------------------------
# crystal segments
# --------------------------------------------------------------------------------


def crystal(a, b, rmax, tip=False, rot=0.0, flat=1.0):
    """A hexagonal crystal from a to b, its ends drawn in (to a point at b if
    tip). flat squashes it across (its first axis)."""
    a, b = V(*a), V(*b)
    L = np.linalg.norm(b - a)
    u = (b - a) / L
    v = np.cross(u, V(0, 1, 0))
    if np.linalg.norm(v) < 1e-3:
        v = np.cross(u, V(1, 0, 0))
    v /= np.linalg.norm(v)
    w = np.cross(u, v)
    angs = [rot + k * math.pi / 3 for k in range(6)]

    def fn(p):
        q = p - a
        qu = q @ u
        qv = (q @ v) / flat
        qw = q @ w
        t = clamp(qu / L, 0, 1)
        if tip:
            r = rmax * np.minimum(1, 0.55 + t / 0.25) * (1 - t) ** 0.75
        else:
            r = rmax * np.minimum(1, np.minimum(0.6 + t / 0.35, 0.55 + (1 - t) / 0.35))
        d = np.full(len(p), -1e9)
        for an in angs:
            d = np.maximum(d, qv * math.cos(an) + qw * math.sin(an))
        d = d - r
        return np.maximum(d, np.maximum(-qu, qu - L))

    m = rmax * max(1, flat) + 0.01
    return Prim(fn, np.minimum(a, b) - m, np.maximum(a, b) + m)


# --------------------------------------------------------------------------------
# the legs
# --------------------------------------------------------------------------------

LEG_AZ = [68, 94, 120, 146]
LEGS = {}
for s, S in ((1, 'R'), (-1, 'L')):
    for i, az in enumerate(LEG_AZ):
        a = az * D2R
        d = V(s * math.sin(a), 0, -math.cos(a))
        hip = V(s * math.sin(a) * 0.4, 0.3, -math.cos(a) * 0.3 + 0.04)
        reach = 0.6 - 0.03 * abs(i - 1.5)
        knee = hip + d * 0.27 + V(0, 0.16, 0)
        ankle = hip + d * (reach - 0.1) + V(0, 0.2, 0)
        tip = hip + d * reach + V(0, -0.4, 0)
        tip[1] = 0.0
        LEGS[S + str(i)] = dict(s=s, i=i, az=az, hip=hip, knee=knee, ankle=ankle, tip=tip, d=d)
LEG_NAMES = list(LEGS.keys())


def g_legs():
    parts = []
    for j, L in enumerate(LEG_NAMES):
        g = LEGS[L]
        hip, knee, ankle, tip = g['hip'], g['knee'], g['ankle'], g['tip']
        rot = 0.3 * j
        femur = crystal(hip, knee, 0.075, rot=rot)
        tibia = crystal(knee, ankle, 0.068, rot=rot + 0.4)
        dact = crystal(ankle, tip, 0.064, tip=True, rot=rot + 0.2)
        jh = ellipsoid(hip, (0.07, 0.07, 0.07))
        jk = ellipsoid(knee, (0.062, 0.062, 0.062))
        ja = ellipsoid(ankle, (0.052, 0.052, 0.052))
        parts.append((L, j, femur, tibia, dact, jh, jk, ja))

    def field(p):
        d = np.full(len(p), 1.0)
        for L, j, femur, tibia, dact, jh, jk, ja in parts:
            for pr in (femur, tibia, dact):
                d = np.minimum(d, pr(p))
            for pr in (jh, jk, ja):
                d = smin(d, pr(p), 0.006)
        return np.maximum(d, -p[:, 1] + 0.0005)

    owners = []
    for L, j, femur, tibia, dact, jh, jk, ja in parts:
        owners += [(femur, rigid('leg' + L)), (tibia, rigid('knee' + L)), (dact, rigid('knee' + L)), (jh, rigid('leg' + L)), (jk, rigid('knee' + L)), (ja, rigid('knee' + L))]
    per = 6

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        leg = k // per
        part = k % per
        out[:, 0] = leg / (len(LEG_NAMES) - 1)
        out[:, 1] = np.choose(np.minimum(part, 5), [0.2, 0.55, 0.85, 0.0, 0.4, 0.7])
        out[:, 3] = (part >= 3).astype(float)
        # (along the leg more finely: by height and reach)
        for jj, L in enumerate(LEG_NAMES):
            m = leg == jj
            if not m.any():
                continue
            g = LEGS[L]
            q = p[m] - g['hip']
            out[m, 1] = clamp(np.sqrt((q[:, 0] ** 2 + q[:, 2] ** 2)) / np.linalg.norm((g['tip'] - g['hip'])[[0, 2]]), 0, 1)
        return out

    def mats(p, n, own):
        k = np.argmax(own, 1) % per
        return np.where(k >= 3, MAT['joint'], MAT['leg'])

    lo = (-1.2, 0.0, -0.8)
    hi = (1.2, 0.72, 0.8)
    return Garment('legs', MAT['leg'], 0.006, lo, hi, field, owners, 12000, tau=0.004, details=details, mats=mats, outline=0.6)


# --------------------------------------------------------------------------------
# the claws
# --------------------------------------------------------------------------------


def frame(fwd, out):
    """A claw's frame: e1 along it, e3 out of its outer face, e2 up its
    height."""
    e1 = fwd / np.linalg.norm(fwd)
    e3 = out - e1 * (out @ e1)
    e3 /= np.linalg.norm(e3)
    e2 = np.cross(e3, e1)
    return np.stack([e1, e2, e3], 1)  # columns


CLAWS = {
    # wrist, along, out of the outer face, size, shoulder, elbow
    'R': dict(wrist=V(0.6, 0.3, -0.56), fwd=V(-0.3, -0.04, -1), out=V(1, 0.3, 0.12), k=1.3, shoulder=V(0.26, 0.3, -0.3), elbow=V(0.52, 0.32, -0.44)),
    'L': dict(wrist=V(-0.5, 0.36, -0.56), fwd=V(0.35, 0.3, -1), out=V(-1, 0.35, 0), k=0.6, shoulder=V(-0.25, 0.3, -0.32), elbow=V(-0.46, 0.34, -0.44)),
}
for c in CLAWS.values():
    c['M'] = frame(c['fwd'], c['out'])
# (in the claw's frame, before its size: the palm, its window, the fingers)
PALM_C, PALM_R = V(0.2, 0.0, 0.0), (0.24, 0.17, 0.085)
WIN = (0.17, 0.125)  # the window's half-axes, round the palm's middle
HINGE = V(0.33, 0.1, 0.0)


def claw_local(c, p):
    return ((p - c['wrist']) @ c['M']) / c['k']


def to_world(c, q):
    return c['wrist'] + (c['M'] @ (q * c['k']))


def palm_field(c, p):
    q = claw_local(c, p)
    qn = (q - PALM_C) / V(*PALM_R)
    k0 = np.sqrt((qn * qn).sum(1))
    k1 = np.sqrt(((q - PALM_C) ** 2 / V(*PALM_R) ** 4).sum(1))
    d = k0 * (k0 - 1) / np.maximum(k1, 1e-9)
    # the window: a recess on each face, a raised rim round it
    rho = np.sqrt(((q[:, 0] - PALM_C[0]) / WIN[0]) ** 2 + ((q[:, 1] - PALM_C[1]) / WIN[1]) ** 2)
    d = d - 0.011 * np.exp(-(((rho - 1.0) / 0.14) ** 2)) + 0.006 * smooth(0.95, 0.75, rho)
    return d * c['k']


def finger_strokes(c, which):
    k = c['k']
    if which == 'fixed':
        pts = [V(0.3, -0.08, 0), V(0.45, -0.1, 0), V(0.58, -0.05, 0), V(0.64, 0.03, 0)]
        rr = [0.085, 0.072, 0.05, 0.016]
    else:
        pts = [HINGE, V(0.46, 0.1, 0), V(0.58, 0.07, 0), V(0.63, 0.02, 0)]
        rr = [0.075, 0.06, 0.042, 0.014]
    return [to_world(c, q) for q in pts], [r * k for r in rr]


def flat_stroke(c, pts, rr):
    """A finger: a stroke flattened across the claw's thickness."""
    s = stroke(pts, rr)
    e3 = c['M'][:, 2]

    def fn(p):
        # squash along e3 by pulling points out (a flatter finger)
        off = (p - c['wrist']) @ e3
        q = p + np.outer(off * 0.5, e3)
        return s.fn(q) * 0.85

    return Prim(fn, s.lo - 0.05, s.hi + 0.05)


def g_claws():
    parts = {}
    for S, c in CLAWS.items():
        k = c['k']
        palm = Prim(lambda p, c=c: palm_field(c, p), c['wrist'] - 0.5 * k - 0.05, c['wrist'] + 0.7 * k + 0.05)
        fixed = flat_stroke(c, *finger_strokes(c, 'fixed'))
        dact = flat_stroke(c, *finger_strokes(c, 'dact'))
        wr = ellipsoid(c['wrist'] - c['M'][:, 0] * 0.05 * k, (0.058 * k + 0.015,) * 3)
        r0 = 0.075 if S == 'R' else 0.055
        upper = crystal(c['shoulder'], c['elbow'], r0 * 1.1, rot=0.2)
        lower = crystal(c['elbow'], c['wrist'], r0, rot=0.5)
        sj = ellipsoid(c['shoulder'], (r0 * 1.15,) * 3)
        ej = ellipsoid(c['elbow'], (r0 * 1.05,) * 3)
        parts[S] = dict(palm=palm, fixed=fixed, dact=dact, wr=wr, upper=upper, lower=lower, sj=sj, ej=ej)

    def field(p):
        d = np.full(len(p), 1.0)
        for S, P in parts.items():
            body = smin(P['palm'](p), P['fixed'](p), 0.03 * CLAWS[S]['k'])
            body = np.minimum(body, P['dact'](p))
            d = np.minimum(d, body)
            for kk in ('wr', 'sj', 'ej'):
                d = smin(d, P[kk](p), 0.01)
            d = np.minimum(d, P['upper'](p))
            d = np.minimum(d, P['lower'](p))
        return np.maximum(d, -p[:, 1] + 0.0005)

    owners = []
    order = ['palm', 'fixed', 'dact', 'wr', 'upper', 'lower', 'sj', 'ej']
    for S, P in parts.items():
        bones = dict(palm='hand' + S, fixed='hand' + S, dact='finger' + S, wr='hand' + S, upper='arm' + S, lower='hand' + S, sj='arm' + S, ej='hand' + S)
        owners += [(P[kk], rigid(bones[kk])) for kk in order]
    per = len(order)
    names = list(parts.keys())

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        which = k // per
        part = k % per
        for j, S in enumerate(names):
            m = which == j
            if not m.any():
                continue
            c = CLAWS[S]
            q = claw_local(c, p[m])
            rho = np.sqrt(((q[:, 0] - PALM_C[0]) / WIN[0]) ** 2 + ((q[:, 1] - PALM_C[1]) / WIN[1]) ** 2)
            out[m, 0] = clamp(rho, 0, 2)
            out[m, 1] = clamp(q[:, 0] / 0.64, 0, 1)
            out[m, 2] = np.sign(q[:, 2])
            out[m, 3] = 1.0 if S == 'R' else 0.0
            # (the arm: along it)
            arm = part[m] >= 4
            out[np.where(m)[0][arm], 1] = 0
        return out

    def mats(p, n, own):
        k = np.argmax(own, 1)
        part = k % per
        m = np.where(part >= 3, np.where((part == 4) | (part == 5), MAT['leg'], MAT['joint']), MAT['claw'])
        # the big claw's window: both faces of the palm, inside the rim
        c = CLAWS['R']
        isR = (k // per) == names.index('R')
        q = claw_local(c, p)
        rho = np.sqrt(((q[:, 0] - PALM_C[0]) / WIN[0]) ** 2 + ((q[:, 1] - PALM_C[1]) / WIN[1]) ** 2)
        # (all of the palm: the shader cuts the window out of it by d.x, so its
        # edge is a smooth oval whatever the mesh)
        win = isR & (part == 0)
        m = np.where(win, MAT['glass'], m)
        return m

    lo = (-0.85, 0.0, -1.45)
    hi = (1.05, 0.85, 0.0)
    return Garment('claws', MAT['claw'], 0.0055, lo, hi, field, owners, 16000, tau=0.004, details=details, mats=mats, outline=0.6)


# --------------------------------------------------------------------------------
# the eyes on their stalks
# --------------------------------------------------------------------------------

STALKS = {}
for s, S in ((1, 'R'), (-1, 'L')):
    base = V(s * 0.1, 0.38, -0.42)
    mid = V(s * 0.13, 0.54, -0.5)
    eye = V(s * 0.155, 0.68, -0.51)
    STALKS[S] = dict(base=base, mid=mid, eye=eye)
EYE_R = 0.056


def g_eyes():
    parts = []
    for S, g in STALKS.items():
        st = stroke([g['base'], g['mid'], g['eye'] - V(0, 0.03, 0)], [0.03, 0.022, 0.02])
        cup = ellipsoid(g['eye'] - V(0, 0.022, 0.0), (0.04, 0.03, 0.04))
        ball = ellipsoid(g['eye'], (EYE_R * 0.92, EYE_R * 1.08, EYE_R * 0.92))
        parts.append((S, st, cup, ball))

    def field(p):
        d = np.full(len(p), 1.0)
        for S, st, cup, ball in parts:
            d = np.minimum(d, smin(st(p), cup(p), 0.02))
            d = np.minimum(d, ball(p))
        return d

    owners = []
    for S, st, cup, ball in parts:
        g = STALKS[S]
        sw = along(lambda p, g=g: p[:, 1], [(g['base'][1] + 0.02, 'shell'), (g['base'][1] + 0.05, 'stalk' + S), (g['eye'][1] - 0.1, 'stalk' + S), (g['eye'][1] - 0.04, 'eye' + S)])
        owners += [(st, sw), (cup, rigid('eye' + S)), (ball, rigid('eye' + S))]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 1] = clamp((p[:, 1] - 0.5) / 0.3, 0, 1)
        return out

    def mats(p, n, own):
        k = np.argmax(own, 1) % 3
        return np.where(k == 2, MAT['eye'], MAT['stalk'])

    lo = (-0.28, 0.3, -0.64)
    hi = (0.28, 0.8, -0.3)
    return Garment('eyes', MAT['eye'], 0.0035, lo, hi, field, owners, 4000, tau=0.004, details=details, mats=mats, outline=0.7)


# --------------------------------------------------------------------------------
# the coral
# --------------------------------------------------------------------------------

CORALS = {
    # where on the shell (x, z), which way it leans, how big, seed
    'A': dict(x=0.27, z=-0.08, lean=V(0.45, 1, -0.2), size=1.75, seed=7),
    'B': dict(x=-0.25, z=0.17, lean=V(-0.5, 1, 0.35), size=1.45, seed=21),
}


def coral_branches(c):
    rng = np.random.RandomState(c['seed'])
    base = V(c['x'], shell_y(c['x'], c['z']) - 0.03, c['z'])
    lean = c['lean'] / np.linalg.norm(c['lean'])
    out = []  # (pts, radii, level)
    sz = c['size']

    def grow(p0, d, L, r, level):
        n = 3
        pts = [p0]
        dd = d.copy()
        for _ in range(n):
            dd = dd + rng.normal(0, 0.18, 3)
            dd[1] = abs(dd[1]) + 0.2
            dd /= np.linalg.norm(dd)
            pts.append(pts[-1] + dd * L / n)
        rr = list(np.linspace(r, r * 0.78, len(pts)))
        out.append((pts, rr, level))
        if level >= 3:
            return
        kids = 2 if level < 2 else rng.randint(1, 3)
        for k in range(kids):
            side = np.cross(dd, V(0, 1, 0))
            if np.linalg.norm(side) < 1e-3:
                side = V(1, 0, 0)
            side /= np.linalg.norm(side)
            ang = rng.uniform(0, 2 * math.pi)
            other = np.cross(dd, side)
            spread = side * math.cos(ang) + other * math.sin(ang)
            nd = dd * 0.55 + spread * rng.uniform(0.7, 1.1)
            at = rng.uniform(0.55, 1.0)
            i = min(len(pts) - 1, max(1, int(round(at * n))))
            grow(pts[i], nd / np.linalg.norm(nd), L * rng.uniform(0.6, 0.8), rr[i] * 0.82, level + 1)

    grow(base, lean, 0.15 * sz, 0.028 * sz, 0)
    # a second trunk beside the first
    grow(base + V(0.04, 0, 0.03) * sz, (lean + V(rng.uniform(-0.6, 0.6), 0, rng.uniform(-0.6, 0.6))) / 1.4, 0.12 * sz, 0.022 * sz, 1)
    return base, out


def g_coral():
    clusters = []
    for name, c in CORALS.items():
        base, br = coral_branches(c)
        prims = [stroke(pts, rr) for pts, rr, lvl in br]
        tips = [ellipsoid(pts[-1], (rr[-1] * 1.25,) * 3) for pts, rr, lvl in br]
        rng = np.random.RandomState(c['seed'] + 1)
        beads = []
        for k in range(26):
            a = rng.uniform(0, 2 * math.pi)
            rad = rng.uniform(0.02, 0.11) * c['size']
            x, z = base[0] + math.cos(a) * rad, base[2] + math.sin(a) * rad
            r = rng.uniform(0.01, 0.024) * (1.25 - rad / (0.11 * c['size']) * 0.6)
            beads.append(ellipsoid(V(x, shell_y(x, z) + r * 0.2, z), (r, r * 0.8, r)))
        lo = np.min([q.lo for q in prims + beads], 0)
        hi = np.max([q.hi for q in prims + beads], 0)
        clusters.append((name, base, br, prims, tips, beads, lo, hi))

    def cluster_fields(cl, p):
        name, base, br, prims, tips, beads, lo, hi = cl
        dc = np.full(len(p), 1.0)
        for pr in prims + tips:
            dc = smin(dc, pr(p), 0.012)
        db = np.full(len(p), 1.0)
        for b in beads:
            db = np.minimum(db, b(p, 0.03))
        return dc, db

    def field(p):
        d = np.full(len(p), 1.0)
        for cl in clusters:
            dc, db = cluster_fields(cl, p)
            d = np.minimum(d, smin(dc, db, 0.01))
        # (and the shell's own surface clips their roots)
        return d

    owners = []
    for cl in clusters:
        name = cl[0]
        owners.append((Prim(lambda p, cl=cl: cluster_fields(cl, p)[0], cl[6], cl[7]), rigid('coral' + name)))
        owners.append((Prim(lambda p, cl=cl: cluster_fields(cl, p)[1], cl[6], cl[7]), rigid('shell')))

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        k = np.argmax(own, 1)
        for j, cl in enumerate(clusters):
            base = cl[1]
            m = (k // 2) == j
            out[m, 0] = clamp((p[m, 1] - base[1]) / (0.34 * CORALS[cl[0]]['size']), 0, 1)
            out[m, 1] = j
        out[:, 3] = (k % 2 == 1).astype(float)
        return out

    def mats(p, n, own):
        k = np.argmax(own, 1)
        return np.where(k % 2 == 1, MAT['crust'], MAT['coral'])

    lo = np.min([cl[6] for cl in clusters], 0) - 0.03
    hi = np.max([cl[7] for cl in clusters], 0) + 0.03
    return Garment('coral', MAT['coral'], 0.005, lo, hi, field, owners, 12000, tau=0.003, details=details, mats=mats, outline=0.6)


# --------------------------------------------------------------------------------
# the skeleton
# --------------------------------------------------------------------------------


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('shell', 'body', C)
    for S, g in STALKS.items():
        bone('stalk' + S, 'shell', g['base'] - C)
        bone('eye' + S, 'stalk' + S, g['eye'] - g['base'])
    for name, c in CORALS.items():
        bone('coral' + name, 'shell', V(c['x'], shell_y(c['x'], c['z']), c['z']) - C)
    for S, c in CLAWS.items():
        bone('arm' + S, 'shell', c['shoulder'] - C)
        bone('hand' + S, 'arm' + S, c['elbow'] - c['shoulder'])
        hinge = to_world(c, HINGE)
        bone('finger' + S, 'hand' + S, hinge - c['elbow'])
    for L in LEG_NAMES:
        g = LEGS[L]
        # (the legs hang off the body: the game sets each hip where the shell
        # is and aims them at their feet)
        bone('leg' + L, 'body', g['hip'])
        bone('knee' + L, 'leg' + L, g['knee'] - g['hip'])


def build():
    t0 = time.time()
    build_rig()
    garments = [g_shell(), g_belly(), g_legs(), g_claws(), g_eyes(), g_coral()]
    r5 = lambda v: [round(float(x), 5) for x in v]
    rig = dict(
        shell=dict(c=r5(C), r=[SX, SY, SZ]),
        eyes={S: dict(base=r5(g['base']), eye=r5(g['eye'])) for S, g in STALKS.items()},
        eyeR=EYE_R,
        face=dict(c=r5(FACE_C), r=list(FACE_R)),
        legs={L: dict(hip=r5(g['hip']), knee=r5(g['knee']), ankle=r5(g['ankle']), tip=r5(g['tip']), az=g['az'], s=g['s'], i=g['i']) for L, g in LEGS.items()},
        claws={S: dict(wrist=r5(c['wrist']), shoulder=r5(c['shoulder']), elbow=r5(c['elbow']), k=c['k'], M=[r5(c['M'][:, i]) for i in range(3)], hinge=r5(to_world(c, HINGE)), tip=r5(to_world(c, V(0.64, 0.0, 0))), palm=r5(to_world(c, PALM_C))) for S, c in CLAWS.items()},
        corals={n: dict(base=r5(V(c['x'], shell_y(c['x'], c['z']), c['z'])), size=c['size']) for n, c in CORALS.items()},
        win=list(WIN),
    )
    B.export(garments, OUT, MAT, rig, 'crab', 'crab.py')
    print(f'crab: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
