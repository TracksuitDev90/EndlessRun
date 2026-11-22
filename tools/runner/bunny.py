#!/usr/bin/env python3
"""Sculpt the bunny and write assets/bunny/runner.json + runner.bin.

The fourth runner, sculpted the same way as the others (build.py: every
garment one signed-distance field of volumes blended smoothly into each
other, polygonised, skinned by which volume owns each point, linework drawn
by the game's character shader), to his reference sheet
(tools/characters/bunny-sheet.jpg): a short, bipedal rabbit - the smallest of
the runners by far, about 1.1 m to the crown of his hat - compact and a
little rounded, his head big for his body. Warm brown fur, a faded cream
muzzle, cheeks and chin, full cheeks with tufts of fur sticking out of them,
a small pink nose, two buck teeth; oversized round dark glasses; big ears,
pink inside - his right one standing straight up, his left one bent over
part way up and flopping down to the side - poking up through a bright
yellow bucket hat worn tipped back, its brim drooping; a cream short-sleeved
shirt with a pointed collar, dark brown suspenders on brass clips, billowy
rust-orange trousers gathered at the ankles; big rabbit feet; a fluffy cream
tail; and an olive-green satchel slung across him from his right shoulder to
his left hip, its flap fastened with a brass buckle (what he pulls out of it
to float down on is modelled in the game: src/game/props.js).

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/bunny.py

Coordinates are the game's: meters, y up, the runner facing -z.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, round_box, Prim, rot_x, rot_y, Garment, rigid, by_y, by_axis, along  # noqa: E402
from elder import torus_axis, union, r5  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'bunny')
SIDES = [(-1, 'L'), (1, 'R')]
FW = V(0, 0, -1)

# --------------------------------------------------------------------------------
# rig: the game's skeleton, proportioned to his sheet: about five heads to the
# crown of his hat, short legs on big feet, short arms.
# --------------------------------------------------------------------------------

HIP_Y = 0.43
HIP_JOINT = (0.068, 0.405)
THIGH = 0.168
SHIN = 0.165
TOE = (0.048, 0.112)
CHEST_Y = 0.6
SHOULDER = (0.11, 0.716)
UPPER_ARM = 0.13
FOREARM = 0.115
ARM_REST = 0.3
NECK_Y = 0.76
HEAD_Y = 0.8
KNEE_Y = HIP_JOINT[1] - THIGH
ANKLE_Y = KNEE_Y - SHIN

# the head: cranium (centre, radii)
CRAN = ((0, 0.925, 0.005), (0.112, 0.1, 0.108))

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def unit(*a):
    v = V(*a) if len(a) > 1 else np.asarray(a[0], float)
    return v / np.linalg.norm(v)


def arm_frame(s):
    d = V(s * math.sin(ARM_REST), -math.cos(ARM_REST), 0)
    S = V(s * SHOULDER[0], SHOULDER[1], 0)
    E = S + UPPER_ARM * d
    W = E + FOREARM * d
    out = V(s * math.cos(ARM_REST), math.sin(ARM_REST), 0)
    return S, E, W, d, out


def rotate(v, axis, a):
    """Rodrigues: v turned by a about the unit axis."""
    k = unit(axis)
    return v * math.cos(a) + np.cross(k, v) * math.sin(a) + k * (k @ v) * (1 - math.cos(a))


# --------------------------------------------------------------------------------
# the ears: big, pink inside. His right stands up, bending back a little
# toward its tip; his left rises, then droops softly over partway up - not
# folded at a hinge but curving through a long, easy arc, as a soft ear does
# under its own weight - and hangs out and down to the side, its tip curling
# under a little. Each is lofted along its own curve: a flattened leaf of a
# cross-section, as wide and as thick hanging as it is rising, running
# smoothly from root to tip, with a dish hollowed out of its front.
# --------------------------------------------------------------------------------


def frame(u, w_hint):
    u = unit(u)
    v = unit(np.cross(u, w_hint))
    w = np.cross(v, u)
    return u, v, w


def smoother(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def ell2(x, z, rx, rz):
    """Approximate signed distance to the ellipse of half-widths rx, rz."""
    ex, ez = x / rx, z / rz
    k0 = np.sqrt(ex * ex + ez * ez)
    k1 = np.sqrt((ex / rx) ** 2 + (ez / rz) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


class Ear:
    """An ear lofted along a curve from its root: its frame (u along it, v
    across it, w out of its pink front) at every arc length s - turned about
    u by twist(s) -> (v, w), then bent over about `axis` by bend(s) radians,
    then rolled about itself by roll(s) - and its half-width and half-thickness there, from prof [(s / L, half-width,
    half-thickness), ...]."""

    DISH = 0.0068  # how far toward the front the dish is centred

    def __init__(self, root, u, w_hint, L, prof, axis=None, bend=None, twist=None, roll=None, step=0.0015):
        from scipy.spatial import cKDTree
        self.L = L
        n = int(round(L / step)) + 1
        self.S = np.linspace(0.0, L, n)
        self.ds = self.S[1] - self.S[0]
        u0, v0, w0 = frame(u, w_hint)
        U, Vv, W, C = [], [], [], []
        c = V(*root)
        for i, s in enumerate(self.S):
            v, w = twist(s) if twist is not None else (v0, w0)
            uu = u0
            a = bend(s) if bend is not None else 0.0
            if a:
                uu, v, w = rotate(uu, axis, a), rotate(v, axis, a), rotate(w, axis, a)
            # (and rolled about itself as it goes, as a hanging ear turns)
            r = roll(s) if roll is not None else 0.0
            if r:
                v, w = rotate(v, uu, r), rotate(w, uu, r)
            if i:
                c = c + self.ds * 0.5 * (uu + U[-1])
            U.append(uu), Vv.append(v), W.append(w), C.append(c.copy())
        self.U, self.V, self.W, self.C = (np.array(a) for a in (U, Vv, W, C))
        t = self.S / L
        self.RA = np.interp(t, [q[0] for q in prof], [q[1] for q in prof])
        self.RT = np.interp(t, [q[0] for q in prof], [q[2] for q in prof])
        # (the dish: in from the root and the tip, sliding out of the ear
        # where it's not, so it fades rather than ending in a step)
        win = smooth(0.05, 0.2, t) * smooth(0.93, 0.8, t)
        self.ZC = self.DISH + (1 - win) * 0.03
        self.tree = cKDTree(self.C)
        m = self.RA.max() + 0.02
        self.lo, self.hi = self.C.min(0) - m, self.C.max(0) + m

    def at(self, p):
        """Where points lie by the ear: arc length s, across (x), out of its
        front (z), how far past its tip or root (beyond), and its frame, half-
        width and half-thickness there."""
        _, j = self.tree.query(p)
        along = ((p - self.C[j]) * self.U[j]).sum(1)
        n = len(self.S)
        f = np.clip(j + along / self.ds, 0, n - 1)
        i0 = np.minimum(np.floor(f).astype(int), n - 2)
        k = (f - i0)[:, None]
        lerp = lambda A: A[i0] * (1 - k) + A[i0 + 1] * k  # noqa: E731
        c, u, v, w = lerp(self.C), lerp(self.U), lerp(self.V), lerp(self.W)
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        w /= np.linalg.norm(w, axis=1, keepdims=True)
        q = p - c
        k = k[:, 0]
        ra = self.RA[i0] * (1 - k) + self.RA[i0 + 1] * k
        rt = self.RT[i0] * (1 - k) + self.RT[i0 + 1] * k
        zc = self.ZC[i0] * (1 - k) + self.ZC[i0 + 1] * k
        s = self.S[i0] * (1 - k) + self.S[i0 + 1] * k
        beyond = np.where(j == n - 1, np.maximum(along, 0), 0) + np.where(j == 0, np.maximum(-along, 0), 0)
        return dict(s=s, x=(q * v).sum(1), z=(q * w).sum(1), beyond=beyond, w=w, ra=ra, rt=rt, zc=zc)

    def field(self, p):
        e = self.at(p)
        d = ell2(e['x'], e['z'], e['ra'], e['rt'])
        # (past the tip: rounded off over its last, small cross-section)
        d = np.where(e['beyond'] > 0, np.sqrt(np.maximum(d, 0) ** 2 + e['beyond'] ** 2), d)
        dish = ell2(e['x'], e['z'] - e['zc'], e['ra'] * 0.72, e['rt'] * 0.62)
        return smax(d, -dish, 0.004)

    def prim(self):
        return Prim(self.field, self.lo, self.hi)

    def point(self, s):
        return self.C[int(round(s / self.ds))].copy()

    def dir(self, s):
        return self.U[int(round(s / self.ds))].copy()


# his right ear: up, leaning a touch out and back, the tip bending back
_uR, _vR, _wR = frame(unit(0.13, 1, 0.12), unit(0.3, 0, -1))
EAR_R_PROF = [(0.0, 0.026, 0.0135), (0.06, 0.03, 0.0135), (0.24, 0.045, 0.013), (0.46, 0.053, 0.0123), (0.68, 0.051, 0.0112), (0.86, 0.04, 0.0098), (0.95, 0.025, 0.0084), (1.0, 0.008, 0.006)]
EAR_R_LEN = 0.385
_earR = Ear(V(0.044, 0.995, 0.0), _uR, unit(0.3, 0, -1), EAR_R_LEN, EAR_R_PROF, axis=_vR, bend=lambda s: -0.22 * float(smoother((s - 0.17) / 0.2)))
EAR_R = dict(root=V(0.044, 0.995, 0.0), u=_uR, L=EAR_R_LEN, mid=0.2)

# his left ear: up and out, turning as it rises from facing forward at its
# root to facing half out to his left, then drooping over about its width,
# out and a little forward - the curve gathering, easing and running on into
# a little curl at its tip - so that, as in his sheet, the hanging part shows
# its broad back to you from the front (and its pink from behind), never
# just its edge
_u1, _v1, _w1 = frame(unit(-0.32, 1, 0.05), unit(-0.8, 0, -0.6))
_wroot = frame(_u1, unit(-0.3, 0, -1))[2]
EAR_L_LEN = 0.42
EAR_L_BEND = (0.14, 0.29)  # where along it the droop runs (m)
_FOLD, _CURL = 2.1, 0.3


def twist_l(s):
    w = unit(_wroot + (_w1 - _wroot) * float(smooth(0.005, EAR_L_BEND[0], s)))
    return unit(np.cross(_u1, w)), w


# (which way about its width it bends over: out to his side, not across him)
_SG = 1 if rotate(_u1, _v1, _FOLD)[0] < rotate(_u1, _v1, -_FOLD)[0] else -1
# (spreading a little as it hangs, as a soft ear does)
EAR_L_PROF = [(0.0, 0.026, 0.013), (0.06, 0.03, 0.013), (0.2, 0.043, 0.0128), (0.4, 0.052, 0.0124), (0.6, 0.056, 0.0121), (0.78, 0.055, 0.0116), (0.9, 0.046, 0.0107), (0.96, 0.032, 0.0094), (1.0, 0.009, 0.006)]
# (the hanging part rolls a little about itself, turning its breadth across
# your view - its brown back to the front, its pink inside to behind)
_ROLL = 0.55
_earL = Ear(V(-0.044, 0.995, 0.0), _u1, unit(-1, 0, -0.2), EAR_L_LEN, EAR_L_PROF, axis=_v1, twist=twist_l,
            bend=lambda s: _SG * (_FOLD * float(smoother((s - EAR_L_BEND[0]) / (EAR_L_BEND[1] - EAR_L_BEND[0]))) + _CURL * float(smoother((s - EAR_L_BEND[1]) / (EAR_L_LEN - EAR_L_BEND[1])))),
            roll=lambda s: _ROLL * float(smoother((s - EAR_L_BEND[0]) / (EAR_L_LEN - EAR_L_BEND[0]))))
# (the tip's bone pivots where the droop begins; u2: the way the hanging
# part runs, from there to the tip)
EAR_L = dict(root=V(-0.044, 0.995, 0.0), u1=_u1, v1=_v1, w1=_w1, L=EAR_L_LEN,
             bend=_earL.point(EAR_L_BEND[0] + 0.02), u2=unit(_earL.point(EAR_L_LEN) - _earL.point(EAR_L_BEND[0] + 0.02)))


def g_ears():
    pR, pL = _earR.prim(), _earL.prim()
    # the roots sink into the head under the hat
    rootR = round_cone(EAR_R['root'] - 0.03 * EAR_R['u'], EAR_R['root'] + 0.03 * EAR_R['u'], 0.017, 0.016)
    rootL = round_cone(EAR_L['root'] - 0.03 * EAR_L['u1'], EAR_L['root'] + 0.03 * EAR_L['u1'], 0.017, 0.016)

    def field(p):
        return np.minimum(smin(pR(p), rootR(p), 0.012), smin(pL(p), rootL(p), 0.012))

    # (skinned by how far along each it is: the right's tip from halfway up;
    # the left's tip bone taking over through the droop, so when it flops it
    # bends all along that curve, not at a crease)
    wR = along(lambda p: _earR.at(p)['s'], [(0.015, 'head'), (0.055, 'earR'), (0.16, 'earR'), (0.25, 'earRtip')])
    b0 = EAR_L_BEND[0]
    wL = along(lambda p: _earL.at(p)['s'], [(0.015, 'head'), (0.05, 'earL'), (b0 - 0.01, 'earL'), (b0 + 0.11, 'earLtip')])
    owners = [(pR, wR), (rootR, wR), (pL, wL), (rootL, wL)]

    def details(p, n, own):
        # x: how far inside the pink of the ear (0 on the fur, 1 well inside);
        # y: how far along it (0 the root .. 1 the tip); z: across it (-1..1)
        right = own[:, :2].sum(1) > 0.5
        eR, eL = _earR.at(p), _earL.at(p)
        al = np.where(right, eR['s'] / _earR.L, eL['s'] / _earL.L)
        ac = np.where(right, eR['x'] / np.maximum(eR['ra'], 1e-3), eL['x'] / np.maximum(eL['ra'], 1e-3))
        fn = np.where(right, (n * eR['w']).sum(1), (n * eL['w']).sum(1))
        out = np.zeros((len(p), 4))
        out[:, 0] = smooth(0.15, 0.55, fn) * smooth(0.92, 0.62, np.abs(ac)) * smooth(0.06, 0.16, al) * smooth(0.99, 0.9, al)
        out[:, 1] = al
        out[:, 2] = np.clip(ac, -1, 1)
        return out

    lo = np.minimum(_earR.lo, _earL.lo) - 0.01
    hi = np.maximum(_earR.hi, _earL.hi) + 0.01
    lo[1] = min(lo[1], 0.93)
    return Garment('ears', MAT['ear'], 0.0015, lo, hi, field, owners, 3600, tau=0.008, outline=0.6, details=details)


# --------------------------------------------------------------------------------
# head: a big round head, full cheeks with tufts of fur sticking out of them, a
# puffy split muzzle, a small pink nose, two buck teeth
# --------------------------------------------------------------------------------


def head_prims():
    cran = ellipsoid(*CRAN)
    face = ellipsoid((0, 0.904, -0.03), (0.104, 0.086, 0.082))
    cheeks = [ellipsoid((s * 0.078, 0.872, -0.032), (0.064, 0.054, 0.062)) for s, _ in SIDES]
    muzzle = [ellipsoid((s * 0.021, 0.868, -0.096), (0.03, 0.026, 0.029)) for s, _ in SIDES]
    chin = ellipsoid((0, 0.835, -0.073), (0.034, 0.022, 0.03))
    jaw = ellipsoid((0, 0.85, -0.02), (0.09, 0.05, 0.07))
    return cran, face, cheeks, muzzle, chin, jaw


def skull(p):
    cran, face, cheeks, muzzle, chin, jaw = head_prims()
    d = smin(cran(p), face(p), 0.05)
    for c in cheeks:
        d = smin(d, c(p), 0.03)
    d = smin(d, jaw(p), 0.04)
    for m in muzzle:
        d = smin(d, m(p), 0.014)
    return smin(d, chin(p), 0.018)


NOSE = dict(c=(0, 0.893, -0.121), r=(0.0152, 0.0102, 0.0105))


def g_head():
    cran, face, cheeks, muzzle, chin, jaw = head_prims()
    nose = ellipsoid(NOSE['c'], NOSE['r'], rot_x(-0.25))
    # tufts of fur sticking out of his cheeks, and a little forelock under
    # the hat's brim (seeded, so the same every build)
    rnd = np.random.default_rng(7)
    tufts = []
    for s, _ in SIDES:
        for k, (y, out, dn) in enumerate([(0.893, 0.02, 0.002), (0.872, 0.025, -0.006), (0.852, 0.022, -0.012), (0.835, 0.015, -0.013)]):
            th = 1.45 + 0.08 * k
            a = V(s * 0.128 * math.sin(th) * (1 - 0.05 * k), y, -0.032 - 0.03 * math.cos(th))
            o = V(s * math.sin(th), 0, -math.cos(th) * 0.4)
            b = a + o * out * 0.6 + V(0, dn * 0.4 + rnd.uniform(-0.003, 0.003), 0.004)
            c = a + o * out + V(0, dn, 0.008)
            tufts.append(stroke([a - 0.012 * o, b, c], [0.0125, 0.0085, 0.003]))
    for x0, dx in [(-0.012, -0.012), (0.006, 0.01), (0.022, 0.024)]:
        a = V(x0, 0.99, -0.085)
        tufts.append(stroke([a + V(0, 0.006, 0.012), a, a + V(dx, -0.026, -0.016)], [0.011, 0.008, 0.0025]))
    neck = round_cone((0, 0.74, 0.008), (0, 0.85, 0.0), 0.038, 0.042)

    def field(p):
        d = skull(p)
        d = smin(d, nose(p), 0.008)
        for q in tufts:
            d = smin(d, q(p), 0.006)
        return smin(d, neck(p), 0.03)

    head = rigid('head')
    owners = [(cran, head), (face, head), (chin, head), (jaw, head), (nose, head)] + [(c, head) for c in cheeks] + [(m, head) for m in muzzle] + [(q, head) for q in tufts]
    owners.append((neck, by_y([(0.765, 'chest'), (0.8, 'neck'), (0.845, 'head')])))
    n_tuft = len(tufts)

    def details(p, n, own):
        # xyz: where on the head (rest), w: on a tuft
        return np.concatenate([p, own[:, -1 - n_tuft:-1].sum(1)[:, None]], 1)

    def mats(p, n, own):
        return np.where(own[:, 4] > 0.5, MAT['nose'], MAT['face'])

    return Garment('head', MAT['face'], 0.0016, (-0.19, 0.68, -0.17), (0.19, 1.05, 0.14), field, owners, 4200, tau=0.005, details=details, mats=mats)


def g_teeth():
    """Two buck teeth under his top lip, a little gap between them."""
    parts = [round_box((s * 0.0066, 0.8475, -0.1135), (0.0059, 0.0108, 0.0034), 0.0026, rot_x(0.18)) for s, _ in SIDES]
    U = union(parts)
    return Garment('teeth', MAT['teeth'], 0.0007, U.lo - 0.006, U.hi + 0.006, U, [(q, rigid('head')) for q in parts], 400, tau=0.003, outline=0.5)


GLASSES = dict(x=0.056, y=0.943, z=-0.123, R=0.0425, r=0.0036, turn=0.16)


def g_glasses():
    """Big round glasses with thin dark rims, a bridge arched over the top of
    his nose, the arms running back along the sides of his head."""
    G = GLASSES
    parts = []
    for s, _ in SIDES:
        c = V(s * G['x'], G['y'], G['z'])
        ax = unit(s * G['turn'], 0.05, -1)
        parts.append(torus_axis(c, ax, G['R'], G['r']))
        a = c + V(s * (G['R'] - 0.002), 0.006, 0.004)
        parts.append(stroke([a, V(s * 0.112, G['y'] + 0.006, -0.09), V(s * 0.124, G['y'] + 0.004, -0.045), V(s * 0.118, G['y'] - 0.004, -0.008)], [0.003, 0.0028, 0.0028, 0.0028]))
    parts.append(stroke([V(-G['x'] + G['R'] - 0.002, G['y'] + 0.004, G['z'] - 0.002), V(0, G['y'] + 0.011, G['z'] - 0.006), V(G['x'] - G['R'] + 0.002, G['y'] + 0.004, G['z'] - 0.002)], [0.0028, 0.0028, 0.0028]))
    U = union(parts)
    return Garment('glasses', MAT['glasses'], 0.0011, U.lo - 0.008, U.hi + 0.008, U, [(q, rigid('head')) for q in parts], 1300, tau=0.004, outline=0.6)


# --------------------------------------------------------------------------------
# the hat: a bright yellow bucket hat, worn tipped back, its brim drooping at
# the sides and back
# --------------------------------------------------------------------------------

HAT = dict(o=V(0, 0.963, 0.03), tilt=0.34, rc=0.118, top=0.13, k=0.042, rho0=0.112, t=0.0042)
HAT_R = rot_x(HAT['tilt'])


def hat_local(p):
    return (p - HAT['o']) @ HAT_R


def brim_geom(q):
    """For hat-local points: (rho, theta from the front, the brim's height
    there, how far out it reaches)."""
    rho = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    th = np.arctan2(q[:, 0], -q[:, 2])
    fr = np.maximum(np.cos(th), 0)
    width = 0.088 - 0.036 * fr ** 2
    droop = 0.92 - 0.66 * fr ** 1.5
    x = np.maximum(rho - HAT['rho0'], 0)
    h = -0.004 - droop * x - 1.1 * x * x + 0.004 * np.sin(3 * th + 0.6) * smooth(0, 0.07, x)
    return rho, th, h, HAT['rho0'] + width


def crown_fn(q):
    rho = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    y = q[:, 1]
    rc = HAT['rc'] - 0.012 * smooth(0.02, HAT['top'], y)
    k = HAT['k']
    ym, hh = (HAT['top'] - 0.01) / 2, (HAT['top'] + 0.01) / 2
    dr = rho - rc + k
    dy = np.abs(y - ym) - hh + k
    return np.sqrt(np.maximum(dr, 0) ** 2 + np.maximum(dy, 0) ** 2) + np.minimum(np.maximum(dr, dy), 0) - k


def brim_fn(q):
    rho, th, h, r1 = brim_geom(q)
    # (a thin sheet over that height field, its thickness measured square to it)
    sheet = np.abs(q[:, 1] - h) / math.sqrt(1.36) - HAT['t']
    return smax(smax(sheet, rho - r1, 0.004), HAT['rho0'] - 0.012 - rho, 0.004)


def g_hat():
    crown = Prim(lambda p: crown_fn(hat_local(p)), HAT['o'] - 0.16, HAT['o'] + 0.2)
    brim = Prim(lambda p: brim_fn(hat_local(p)), HAT['o'] - V(0.25, 0.2, 0.25), HAT['o'] + V(0.25, 0.08, 0.25))

    def field(p):
        q = hat_local(p)
        c = crown_fn(q)
        # (the crown's panels: shallow seams down from the top)
        th = np.arctan2(q[:, 0], -q[:, 2])
        c = c + 0.0012 * np.exp(-((np.abs(((th / (2 * math.pi)) * 6 + 0.5) % 1 - 0.5)) / 0.04) ** 2) * smooth(0.01, 0.05, q[:, 1])
        return smin(c, brim_fn(q), 0.014)

    owners = [(crown, rigid('head')), (brim, along(lambda p: np.sqrt(hat_local(p)[:, 0] ** 2 + hat_local(p)[:, 2] ** 2), [(0.118, 'head'), (0.16, 'brim')]))]

    def details(p, n, own):
        q = hat_local(p)
        # xyz: hat-local (y up its crown), w: on the brim
        return np.concatenate([q, own[:, 1:2]], 1)

    return Garment('hat', MAT['hat'], 0.0019, (-0.26, 0.74, -0.24), (0.26, 1.13, 0.3), field, owners, 2800, tau=0.008, details=details)


# --------------------------------------------------------------------------------
# the shirt, suspenders, trousers
# --------------------------------------------------------------------------------

SHIRT = dict(
    chest=((0, 0.661, 0.004), (0.097, 0.096, 0.07)),
    belly=((0, 0.587, -0.008), (0.1, 0.07, 0.078)),
    yoke=((0, 0.711, 0.004), (0.112, 0.037, 0.063)),
    cap=0.044,
    sleeve=0.074,  # how far down the arm the short sleeves reach
)


def plate(tri, t, r):
    """A flat rounded triangle (a collar point): its corners, half its
    thickness and how round its edges are."""
    a, b, c = tri
    e1, e2 = b - a, c - a
    nrm = unit(np.cross(e1, e2))
    ex = unit(e1)
    ey = np.cross(nrm, ex)
    P2 = [np.array([(q - a) @ ex, (q - a) @ ey]) for q in (a, b, c)]

    def fn(p):
        q = p - a
        x, y, z = q @ ex, q @ ey, q @ nrm
        # (Inigo Quilez's exact 2D triangle distance)
        pt = np.stack([x, y], 1)
        p0, p1, p2 = P2
        es = [p1 - p0, p2 - p1, p0 - p2]
        vs = [pt - p0, pt - p1, pt - p2]
        dmin = None
        for e, v in zip(es, vs):
            h = np.clip((v @ e) / (e @ e), 0, 1)
            w = v - h[:, None] * e
            dd = (w * w).sum(1)
            dmin = dd if dmin is None else np.minimum(dmin, dd)
        sgn = np.sign(es[0][0] * es[2][1] - es[0][1] * es[2][0])
        cs = [sgn * (v[:, 0] * e[1] - v[:, 1] * e[0]) for e, v in zip(es, vs)]
        inside = (cs[0] < 0) & (cs[1] < 0) & (cs[2] < 0)
        d2 = np.sqrt(dmin) * np.where(inside, -1, 1) + r
        dz = np.abs(z) - t
        return np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dz, 0) ** 2) + np.minimum(np.maximum(d2, dz), 0) - r

    lo = np.min([a, b, c], 0) - 0.01
    hi = np.max([a, b, c], 0) + 0.01
    return Prim(fn, lo, hi)


def shirt_prims():
    S_ = SHIRT
    chest, belly, yoke = ellipsoid(*S_['chest']), ellipsoid(*S_['belly']), ellipsoid(*S_['yoke'])
    sleeves = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        sleeves.append(dict(S=S, d=d, out=out, cap=ellipsoid(S + 0.012 * d, (S_['cap'], S_['cap'], S_['cap'] * 0.9)), upper=round_cone(S + 0.01 * d, S + S_['sleeve'] * d, 0.043, 0.038)))
    return chest, belly, yoke, sleeves


def shirt_body(p, prims):
    chest, belly, yoke, sleeves = prims
    t = smin(chest(p), yoke(p), 0.04)
    t = smin(t, belly(p), 0.06)
    for sl in sleeves:
        t = smin(t, sl['cap'](p), 0.04)
    return t


def g_shirt():
    prims = shirt_prims()
    chest, belly, yoke, sleeves = prims
    collar = torus_axis((0, 0.771, 0.008), (0, 1, 0.18), 0.042, 0.0088)
    # the pointed collar's two flaps, lying open on his chest
    flaps = [plate([V(s * 0.006, 0.776, -0.044), V(s * 0.047, 0.782, -0.027), V(s * 0.031, 0.729, -0.07)], 0.0022, 0.0035) for s, _ in SIDES]
    neckhole = round_cone((0, 0.735, 0.01), (0, 0.86, 0.005), 0.034, 0.034)

    def field(p):
        y = p[:, 1]
        t = shirt_body(p, prims)
        t = t + 0.0018 * np.sin(np.arctan2(p[:, 0], p[:, 2]) * 9 + y * 30) * smooth(0.62, 0.55, y)
        t = smax(t, 0.522 - y, 0.006)
        t = smin(t, collar(p), 0.01)
        for f in flaps:
            t = smin(t, f(p), 0.004)
        t = smax(t, -neckhole(p), 0.006)
        for sl in sleeves:
            u = (p - sl['S']) @ sl['d']
            s_ = smax(sl['upper'](p), u - SHIRT['sleeve'], 0.004)
            # a turned-up hem
            s_ = smin(s_, torus_axis(sl['S'] + (SHIRT['sleeve'] - 0.006) * sl['d'], sl['d'], 0.036, 0.0055)(p), 0.004)
            t = smin(t, s_, 0.03)
        return t

    torso_w = by_y([(0.56, 'spine'), (0.62, 'spine'), (0.67, 'chest')])
    owners = [(chest, torso_w), (belly, torso_w), (yoke, by_y([(0.67, 'chest')])), (collar, by_y([(0.77, 'chest'), (0.81, 'neck')]))] + [(f, rigid('chest')) for f in flaps]
    n_torso = len(owners)
    for sl, (s, L) in zip(sleeves, SIDES):
        w = by_axis(sl['S'], sl['d'], [(-0.015, 'clav' + L), (0.03, 'arm' + L)])
        owners += [(sl['cap'], w), (sl['upper'], w)]
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        torso = own[:, :n_torso].sum(1)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        flap = own[:, 4:6].sum(1) + own[:, 3]
        return np.stack([torso, u, flap, np.zeros(len(p))], 1)

    return Garment('shirt', MAT['shirt'], 0.0022, (-0.25, 0.49, -0.11), (0.25, 0.8, 0.1), field, owners, 2600, tau=0.01, details=details)


TROUSERS = dict(
    waist=((0, 0.545, -0.004), (0.108, 0.032, 0.086)),
    hips=((0, 0.452, 0.01), (0.15, 0.104, 0.12)),
    ball=(0.1, 0.298, 0.0, 0.1, 0.128, 0.1),  # each leg's balloon: x, y, z, radii
    cuff=(0.079, 0.113, 0.152, 0.043),  # x, bottom, top, radius
    top=0.562,
)


def trouser_prims():
    T = TROUSERS
    waist, hips = ellipsoid(*T['waist']), ellipsoid(*T['hips'])
    legs = []
    bx, by, bz, rx, ry, rz = T['ball']
    cx, c0, c1, cr = T['cuff']
    for s, L in SIDES:
        ball = ellipsoid((s * bx, by, bz), (rx, ry, rz))
        taper = round_cone((s * 0.094, 0.255, 0.0), (s * cx, c1 + 0.012, 0.002), 0.08, cr - 0.002)
        cuff = round_cone((s * cx, c0 + 0.004, 0.002), (s * cx, c1, 0.002), cr, cr)
        legs.append((ball, taper, cuff, s))
    return waist, hips, legs


def trousers_field(p, prims, ripple=True):
    waist, hips, legs = prims
    T = TROUSERS
    y = p[:, 1]
    sides = []
    for ball, taper, cuff, s in legs:
        d = smin(ball(p), taper(p), 0.05)
        if ripple:
            # gathered into the cuff: puckers fanning up out of it
            a = np.arctan2(p[:, 0] - s * T['cuff'][0], p[:, 2])
            d = d + 0.0035 * np.sin(a * 9) * smooth(0.15, 0.17, y) * smooth(0.26, 0.18, y)
            # soft folds down the balloon
            d = d + 0.0025 * np.sin(a * 5 + y * 18) * smooth(0.18, 0.26, y) * smooth(0.46, 0.36, y)
        d = smin(d, cuff(p), 0.012)
        sides.append(d)
    legsd = np.minimum(sides[0], sides[1])
    t = smin(waist(p), hips(p), 0.05)
    t = smin(t, legsd, 0.05)
    # (the legs part below the seat: a crease up the middle)
    t = t + 0.004 * np.exp(-(p[:, 0] / 0.006) ** 2) * smooth(0.37, 0.33, y)
    return smax(t, y - T['top'], 0.006)


def g_trousers():
    prims = trouser_prims()
    waist, hips, legs = prims
    T = TROUSERS

    def field(p):
        t = trousers_field(p, prims)
        # the waistband: a little proud of the rest
        t = t - 0.002 * smooth(0.522, 0.528, p[:, 1])
        return t

    owners = [(waist, by_y([(0.5, 'hips'), (0.55, 'spine')])), (hips, rigid('hips'))]
    for ball, taper, cuff, s in legs:
        L = 'L' if s < 0 else 'R'
        owners += [(ball, by_y([(0.2, 'shin' + L), (0.27, 'thigh' + L), (0.35, 'thigh' + L), (0.42, 'hips')])), (taper, by_y([(0.19, 'shin' + L), (0.26, 'thigh' + L)])), (cuff, rigid('shin' + L))]

    def details(p, n, own):
        # x: on the waistband, y: on a cuff
        band = smooth(0.524, 0.53, p[:, 1])
        cuff = own[:, 4] + own[:, 7]
        return np.stack([band, cuff, np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('trousers', MAT['trousers'], 0.0026, (-0.24, 0.08, -0.16), (0.24, 0.6, 0.17), field, owners, 3400, tau=0.012, details=details)


SUSP = dict(x0=0.047, x1=0.063, half=0.0085, lift=0.0036, t=0.0026, bottom=0.546)


def carrier(p, sprims, tprims):
    """The surface the straps lie on: the shirt and the trousers' waistband."""
    return np.minimum(shirt_body(p, sprims), trousers_field(p, tprims, ripple=False))


def g_suspenders():
    """Dark brown suspenders, two straight straps over the shoulders, clipped
    to the trousers' waistband front and back with little brass clips."""
    sprims, tprims = shirt_prims(), trouser_prims()
    S = SUSP

    def strap(p, s):
        x0 = s * (S['x0'] + (S['x1'] - S['x0']) * smooth(0.6, 0.72, p[:, 1]))
        ds = carrier(p, sprims, tprims)
        d = np.abs(ds - S['lift']) - S['t']
        d = smax(d, np.abs(p[:, 0] - x0) - S['half'], 0.0015)
        return smax(d, S['bottom'] - p[:, 1], 0.002)

    straps = [Prim(lambda p, s=s: strap(p, s), (s * 0.062 - 0.03, 0.52, -0.12), (s * 0.062 + 0.03, 0.775, 0.12)) for s, _ in SIDES]

    def field(p):
        return np.minimum(straps[0](p), straps[1](p))

    w = by_y([(0.6, 'spine'), (0.67, 'chest')])
    owners = [(q, w) for q in straps]

    def details(p, n, own):
        x0 = np.sign(p[:, 0]) * (S['x0'] + (S['x1'] - S['x0']) * smooth(0.6, 0.72, p[:, 1]))
        return np.stack([(p[:, 0] - x0) / S['half'], np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('suspenders', MAT['susp'], 0.0013, (-0.11, 0.53, -0.12), (0.11, 0.78, 0.12), field, owners, 1400, tau=0.006, details=details)


def surface_point(field, p0, d):
    """March from p0 along d to the zero of field (for placing things on it)."""
    p = V(*p0)
    d = unit(d)
    for _ in range(400):
        f = field(p[None])[0]
        if abs(f) < 1e-5:
            break
        p = p + d * float(np.clip(f * 0.8, -0.004, 0.004))
    return p


def g_brass():
    """The suspenders' clips, front and back, and the satchel's buckle."""
    sprims, tprims = shirt_prims(), trouser_prims()
    car = lambda p: carrier(p, sprims, tprims)
    parts = []
    for s, _ in SIDES:
        for zs in (-1, 1):
            c = surface_point(car, (s * SUSP['x0'], 0.553, zs * 0.2), (0, 0, -zs))
            nrm = unit(V(0, 0, zs))
            R = np.stack([V(1, 0, 0), V(0, 1, 0), nrm], 1)
            parts.append(round_box(c + 0.005 * nrm, (0.0105, 0.0085, 0.003), 0.0028, R))
    # the satchel's buckle: a little ring on the front of its flap
    Bg = BAG
    ring = torus_axis(Bg['c'] + (Bg['half'][2] + 0.0085) * Bg['f'] - 0.012 * Bg['up'], Bg['f'], 0.0105, 0.0026)
    parts.append(ring)
    owners = [(q, by_y([(0.5, 'hips'), (0.55, 'spine')])) for q in parts[:4]] + [(ring, rigid('flap'))]
    U = union(parts)
    return Garment('brass', MAT['brass'], 0.0009, U.lo - 0.006, U.hi + 0.006, U, owners, 800, tau=0.003, outline=0.6)


# --------------------------------------------------------------------------------
# the satchel: olive green, on his left hip, its strap across him from his
# right shoulder; a flap over its top and front, fastened with a brass buckle
# --------------------------------------------------------------------------------

_bf = unit(-1, 0, -0.62)
BAG = dict(c=V(-0.192, 0.455, -0.035), f=_bf, up=V(0, 1, 0), side=unit(np.cross(V(0, 1, 0), _bf)), half=(0.058, 0.062, 0.025), r=0.018)
BAG['R'] = np.stack([BAG['side'], BAG['up'], BAG['f']], 1)
BAG['mouth'] = BAG['c'] + BAG['half'][1] * BAG['up']
BAG['hinge'] = BAG['c'] + BAG['half'][1] * BAG['up'] - BAG['half'][2] * BAG['f']
STRAP = dict(a=(-0.118, 0.548), b=(0.074, 0.757), half=0.0115, lift=0.0075, t=0.0026)


def bag_local(p):
    return (p - BAG['c']) @ BAG['R']


def g_bag():
    Bg = BAG
    hs, hu, hf = Bg['half']
    body = round_box(Bg['c'], Bg['half'], Bg['r'], Bg['R'])

    def flap_fn(p):
        q = bag_local(p)
        d = np.abs(body.fn(p) - 0.0042) - 0.0026
        # over the top and down the front, its lower edge rounded
        edge = -0.012 - 0.016 * np.cos(np.clip(q[:, 0] / hs, -1, 1) * math.pi / 2)
        d = smax(d, -hf * 0.2 - q[:, 2], 0.003)
        return smax(d, edge - q[:, 1], 0.003)

    flap = Prim(flap_fn, Bg['c'] - 0.1, Bg['c'] + 0.1)
    # a little leather tab down to the buckle
    tab = round_box(Bg['c'] + (hf + 0.0065) * Bg['f'] - 0.016 * Bg['up'], (0.008, 0.016, 0.0022), 0.0018, Bg['R'])
    # the strap: across his chest and back from his right shoulder, then down
    # off his left side to the satchel's top corners
    sprims, tprims = shirt_prims(), trouser_prims()
    S = STRAP
    A, Bp = V(*S['a']), V(*S['b'])
    dxy = unit(Bp - A)
    nxy = V(-dxy[1], dxy[0])
    Lb = np.linalg.norm(Bp - A)

    def band(p):
        xy = p[:, :2] - A
        across = xy @ nxy
        al = xy @ dxy
        ds = carrier(p, sprims, tprims)
        d = np.abs(ds - S['lift']) - S['t']
        d = smax(d, np.abs(across) - S['half'], 0.0015)
        return smax(d, np.maximum(-0.02 - al, al - Lb - 0.05), 0.003)

    bandP = Prim(band, (-0.14, 0.5, -0.12), (0.13, 0.8, 0.12))
    top = Bg['c'] + hu * Bg['up']
    ends = []
    for k in (-1, 1):
        corner = top + k * (hs - 0.012) * Bg['side']
        z = -0.072 if k < 0 else 0.07
        sp = surface_point(lambda p: carrier(p, sprims, tprims), (-0.2, 0.565, z), (1, 0, 0))
        mid = (corner + sp) / 2 + V(-0.014, 0.012, 0)
        ends.append(stroke([corner - 0.004 * Bg['up'], mid, sp + V(-0.004, 0.004, 0)], [0.0072, 0.0072, 0.0072]))

    def field(p):
        d = body(p)
        d = smin(d, flap(p), 0.003)
        d = smin(d, tab(p), 0.002)
        d = np.minimum(d, bandP(p))
        for e in ends:
            d = smin(d, e(p), 0.006)
        return d

    strap_w = along(lambda p: p[:, 0], [(-0.1, 'spine'), (0.02, 'chest')])
    owners = [(body, rigid('bag')), (flap, rigid('flap')), (tab, rigid('flap')), (bandP, strap_w)]
    owners += [(e, along(lambda p: p[:, 1], [(0.52, 'bag'), (0.56, 'spine')])) for e in ends]

    def details(p, n, own):
        q = bag_local(p)
        # xyz: the bag's own coordinates (across, up, out); w: 0 the body,
        # 1 the flap, 2 the strap
        kind = own[:, 1] + own[:, 2] + 2 * (own[:, 3] + own[:, 4] + own[:, 5])
        # (along the strap's band: across it, for its stitching)
        xy = p[:, :2] - A
        q = np.where((kind > 1.5)[:, None], np.stack([xy @ nxy / S['half'], xy @ dxy, np.zeros(len(p))], 1), q)
        return np.concatenate([q, kind[:, None]], 1)

    return Garment('bag', MAT['bag'], 0.0015, (-0.25, 0.37, -0.13), (0.14, 0.8, 0.13), field, owners, 2600, tau=0.004, details=details)


# --------------------------------------------------------------------------------
# fur: arms, shins; hands, feet, tail
# --------------------------------------------------------------------------------

FOOT_X = 0.079


def g_fur():
    """Brown fur where his clothes leave him bare: his arms out of the short
    sleeves and his skinny shins between the trousers' cuffs and his feet."""
    parts, owners = [], []
    for s, L in SIDES:
        S, E, W, d, out = arm_frame(s)
        up = round_cone(S + 0.04 * d, E, 0.027, 0.023)
        fore = round_cone(E, W - 0.006 * d, 0.023, 0.019)
        shin = round_cone((s * FOOT_X, 0.165, 0.002), (s * FOOT_X, ANKLE_Y + 0.006, 0.006), 0.023, 0.019)
        parts += [up, fore, shin]
        owners += [(up, by_axis(S, d, [(0.04, 'arm' + L)])), (fore, by_axis(S, d, [(UPPER_ARM - 0.02, 'arm' + L), (UPPER_ARM + 0.02, 'fore' + L)])), (shin, by_y([(ANKLE_Y + 0.01, 'foot' + L), (ANKLE_Y + 0.04, 'shin' + L)]))]

    def field(p):
        out = np.full(len(p), 1.0)
        for k in range(0, len(parts), 3):
            out = np.minimum(out, smin(parts[k](p), parts[k + 1](p), 0.012))
            out = np.minimum(out, parts[k + 2](p))
        return out

    return Garment('fur', MAT['fur'], 0.0019, (-0.28, 0.03, -0.06), (0.28, 0.7, 0.06), field, owners, 1300, tau=0.008)


def g_hands():
    """Little furry paws: round palms, three stubby fingers, a thumb."""
    parts, owners = [], []
    for s, L in SIDES:
        S, E, W, dn, out = arm_frame(s)
        R = np.stack([out, dn, FW], 1)
        palm = round_box(W + 0.028 * dn, (0.015, 0.024, 0.02), 0.013, R)
        fingers = [ellipsoid(W + 0.054 * dn + (k - 1) * 0.0125 * FW - 0.002 * out, (0.0085, 0.013, 0.0075), R) for k in range(3)]
        thumb = ellipsoid(W + 0.03 * dn - 0.006 * out + 0.024 * FW, (0.0085, 0.014, 0.008), R @ rot_x(0.5))
        wrist = round_cone(W - 0.012 * dn, W + 0.012 * dn, 0.019, 0.018)
        ps = [wrist, palm] + fingers + [thumb]
        parts.append(ps)
        owners += [(wrist, by_axis(W, dn, [(-0.01, 'fore' + L), (0.006, 'hand' + L)]))] + [(q, rigid('hand' + L)) for q in ps[1:]]

    def field(p):
        out = np.full(len(p), 1.0)
        for ps in parts:
            d = smin(ps[0](p), ps[1](p), 0.01)
            for q in ps[2:]:
                d = smin(d, q(p), 0.007)
            out = np.minimum(out, d)
        return out

    return Garment('hands', MAT['hand'], 0.0012, (-0.31, 0.32, -0.07), (0.31, 0.52, 0.07), field, owners, 1300, tau=0.005)


def g_feet():
    """Big rabbit feet, long and flat: a round heel, a long sole widening to
    three plump toes, the shin's fur running down into them."""
    parts, owners = [], []
    for s, L in SIDES:
        bx = s * FOOT_X
        heel = ellipsoid((bx, 0.04, 0.024), (0.036, 0.04, 0.042))
        ankle = ellipsoid((bx, 0.066, 0.006), (0.024, 0.03, 0.026))
        mid = ellipsoid((bx, 0.032, -0.06), (0.041, 0.032, 0.075))
        toes = ellipsoid((bx + s * 0.003, 0.026, -0.142), (0.047, 0.026, 0.054))

        def fn(p, heel=heel, ankle=ankle, mid=mid, toes=toes, bx=bx):
            d = smin(heel(p), mid(p), 0.03)
            d = smin(d, toes(p), 0.03)
            d = smin(d, ankle(p), 0.02)
            # three toes: grooves between them down the front
            x = p[:, 0] - bx
            g = np.exp(-((np.abs(x) - 0.0148) / 0.0035) ** 2) * smooth(-0.125, -0.165, p[:, 2])
            d = d + 0.0042 * g
            # flat underneath
            return smax(d, -p[:, 1], 0.006)

        foot = Prim(fn, (bx - 0.065, -0.02, -0.215), (bx + 0.065, 0.11, 0.08))
        parts.append(foot)
        owners.append((foot, along(lambda p: p[:, 2], [(-0.1, 'toe' + L), (-0.07, 'foot' + L)])))

    def field(p):
        return np.minimum(parts[0](p), parts[1](p))

    def details(p, n, own):
        # x: the pad underneath (and round the toes), y: across the toes
        pad = smooth(0.012, 0.004, p[:, 1]) + smooth(-0.145, -0.185, p[:, 2]) * smooth(0.035, 0.015, p[:, 1])
        x = p[:, 0] - np.sign(p[:, 0]) * FOOT_X
        return np.stack([np.clip(pad, 0, 1), x / 0.0148, np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('feet', MAT['foot'], 0.0018, (-0.17, -0.01, -0.225), (0.17, 0.12, 0.09), field, owners, 1800, tau=0.01, details=details)


TAIL = dict(c=V(0, 0.45, 0.136), r=0.039, pivot=V(0, 0.45, 0.1))


def g_tail():
    """A small fluffy cream tail on his lower back: a pom-pom of tufts."""
    c = TAIL['c']
    rnd = np.random.default_rng(11)
    parts = [ellipsoid(c, (TAIL['r'], TAIL['r'] * 0.95, TAIL['r'] * 0.85))]
    for k in range(11):
        a = rnd.uniform(0, 2 * math.pi)
        e = rnd.uniform(-0.9, 1.0)
        dvec = V(math.cos(a) * math.cos(e), math.sin(e), 0.4 + 0.6 * abs(math.sin(a) * math.cos(e)))
        dvec = unit(dvec)
        r = rnd.uniform(0.014, 0.02)
        parts.append(stroke([c + dvec * 0.02, c + dvec * (0.041 + rnd.uniform(0, 0.008))], [r, r * 0.35]))

    def field(p):
        d = parts[0](p)
        for q in parts[1:]:
            d = smin(d, q(p), 0.01)
        return d

    return Garment('tail', MAT['tail'], 0.0012, c - 0.085, c + 0.085, field, [(q, rigid('tail')) for q in parts], 1000, tau=0.006)


# --------------------------------------------------------------------------------
# skeleton, export
# --------------------------------------------------------------------------------

MAT = dict(face=1, ear=2, shirt=3, trousers=4, susp=5, fur=6, foot=7, hand=8, bag=9, hat=10, tail=11, glasses=12, teeth=13, brass=14, nose=15)

# springy bits on the head, as the game's shared runner swings them (see
# hairSim in src/game/player.js): [bone, unit direction, stiffness Hz,
# damping, push, limit] - the bunny's own code adds their flops on top
HAIR_BONES = [
    ('earR', EAR_R['u'], dict(f=2.2, z=0.16, k=2.6, lim=0.7)),
    ('earRtip', EAR_R['u'], dict(f=2.8, z=0.12, k=2.2, lim=0.55)),
    ('earL', EAR_L['u1'], dict(f=2.0, z=0.15, k=2.6, lim=0.7)),
    ('earLtip', EAR_L['u2'], dict(f=2.3, z=0.1, k=3.2, lim=0.8)),
    ('brim', V(0, 1, 0), dict(f=3.2, z=0.14, k=0.9, lim=0.18)),
]


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.1, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.1, 0))
    bone('neck', 'chest', (0, NECK_Y - CHEST_Y, 0))
    bone('head', 'neck', (0, HEAD_Y - NECK_Y, 0))
    hy = V(0, HEAD_Y, 0)
    bone('earR', 'head', EAR_R['root'] - hy)
    bone('earRtip', 'earR', EAR_R['mid'] * EAR_R['u'])
    bone('earL', 'head', EAR_L['root'] - hy)
    bone('earLtip', 'earL', EAR_L['bend'] - EAR_L['root'])
    bone('brim', 'head', HAT['o'] - hy)
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.045, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.045), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))
    bone('tail', 'hips', TAIL['pivot'] - V(0, HIP_Y, 0))
    bone('bag', 'hips', BAG['mouth'] - V(0, HIP_Y, 0))
    bone('flap', 'bag', BAG['hinge'] - BAG['mouth'])
    bone('sim', None, (0, 0, 0))


def lst(v):
    return [round(float(x), 5) for x in v]


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_teeth(), g_ears(), g_glasses(), g_hat(), g_shirt(), g_suspenders(), g_brass(), g_trousers(), g_bag(), g_fur(), g_hands(), g_feet(), g_tail()]
    only = os.environ.get('ONLY')
    if only:
        garments = [g for g in garments if g.name in only.split(',')]
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST, kneeY=KNEE_Y,
        hair=[dict(name=n, dir=lst(unit(d)), **k) for n, d, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])],
        # the satchel: its centre, its axes (out, up, across), half extents,
        # where its mouth is and its flap's hinge
        bag=dict(c=lst(BAG['c']), f=lst(BAG['f']), up=lst(BAG['up']), side=lst(BAG['side']), half=list(BAG['half']), mouth=lst(BAG['mouth']), hinge=lst(BAG['hinge'])),
        tail=dict(c=lst(TAIL['c']), pivot=lst(TAIL['pivot'])),
        ears=dict(R=dict(root=lst(EAR_R['root']), u=lst(EAR_R['u']), L=EAR_R['L']), L=dict(root=lst(EAR_L['root']), u1=lst(EAR_L['u1']), u2=lst(EAR_L['u2']), bend=lst(EAR_L['bend']))),
        hat=dict(o=lst(HAT['o']), tilt=HAT['tilt']),
        glasses=dict(x=GLASSES['x'], y=GLASSES['y'], z=GLASSES['z'], R=GLASSES['R']),
        footX=FOOT_X, cuff=list(TROUSERS['cuff']), waist=TROUSERS['top'], nose=list(NOSE['c']),
    )
    B.export(garments, OUT, MAT, rig, 'bunny', 'bunny.py')
    print(f'bunny: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
