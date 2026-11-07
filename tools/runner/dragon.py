#!/usr/bin/env python3
"""Sculpt Iris, the wind dragon who flies with you, and write
assets/dragon/runner.json + runner.bin.

Sculpted the way the runners and Sorrel are (build.py: every surface one
signed-distance field of volumes blended smoothly into each other,
polygonised, skinned by which volume owns each point, the markings drawn by
the game's character shader) and with the same kit, after the reference
sheet (tools/characters/dragon-sheet.jpg): a long, slender, serpentine
dragon - a short rounded head with big eyes and a smile, a little upturned
nose, deer's antlers, fans of feathered frills behind the cheeks and long
whiskers trailing from the snout; a slim neck, a narrow chest and a tucked
waist, and a tail as long again as all the rest of her, ending in a plume of
feathers; a crest of feathery mane from between the antlers all the way down
her back to the plume; slim arms with three-fingered hands, long digitigrade
legs, and a dark, razor-sharp claw on every finger and toe.

She is laid out straight - nose to -z, tail to +z, the spine level at
height Y0 - with her legs hanging under her, as if she stood on all fours.
The game never shows her like this: it bends her spine along a curve
(src/game/dragon.js) - streaming out behind her as she flies, upright as
she stands - so her spine is a chain of bones bound straight along z, each
moved and turned on its own, and her limbs, head, frills and whiskers hang
off them. Because she is straight here, the shader can tell where on her a
point lies from its rest position alone (how far along her, how far round).

Each vertex carries (detail): on her body x, y the fish-scale grid (round
her, along her: one scale each), z how far inside the gold of her belly it
lies (m, > 0 inside), w how pale it runs (the forearms, hands, shins and
feet); on her mane x, y the strands' grid and w how long the fur grows (m);
on a feather or frill x across its vane (-1..1), y along it (0 root .. 1
tip); on the antlers, claws and whiskers y along them.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/dragon.py

Coordinates are the game's: meters, y up, facing -z.
"""

import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, Prim, Garment, rigid, along, by_axis, by_y, bone, norm, dot  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'dragon')
SIDES = [(-1, 'L'), (1, 'R')]

# --------------------------------------------------------------------------------
# the spine: s (m) runs from the top of the neck (the head's pivot, s = 0, at
# z = 0) back to the tip of the tail; at rest z = s, y = Y0.
# --------------------------------------------------------------------------------

Y0 = 0.5
SPINE_LEN = 2.15
SPINE_N = 30  # bones along it
SHOULDER_S = 0.3
HIP_S = 0.8
# the body's radius along the spine (s, r): the neck, the chest, a tucked
# waist, the haunches, and the tail drawn out to a point under the plume
TRUNK_R = [
    (-0.02, 0.056), (0.06, 0.058), (0.16, 0.064), (0.25, 0.078), (0.34, 0.093), (0.44, 0.095), (0.56, 0.086),
    (0.66, 0.08), (0.76, 0.086), (0.84, 0.085), (0.96, 0.072), (1.12, 0.059), (1.32, 0.046), (1.52, 0.035),
    (1.72, 0.026), (1.88, 0.019), (2.02, 0.013), (2.15, 0.007),
]
# the head is sculpted at this scale about its pivot (0, Y0, 0)
HEAD_S = 1.42
# (her antlers a little smaller than her head would make them)
ANTLER_S = 0.86
# deeper than wide
SQUASH = (0.95, 1.07)
# scales round her body
SCALES_AROUND = 22


def trunk_r(s):
    ss, rs = zip(*TRUNK_R)
    return np.interp(s, ss, rs)


def spine_s(i):
    return SPINE_LEN * i / (SPINE_N - 1)


def spine_bone(s):
    """The spine bone nearest arc length s."""
    return 'sp%d' % int(round(clamp(s / SPINE_LEN, 0, 1) * (SPINE_N - 1)))




def hd(x, y, z):
    """A point on the head, given in head units (y above the pivot)."""
    return V(x * HEAD_S, Y0 + y * HEAD_S, z * HEAD_S)


def hr(r):
    return r * HEAD_S


# the head (pivot (0, Y0, 0), facing -z; in head units)
JAW = hd(0, -0.006, -0.05)  # the jaw's hinge
NOSE = hd(0, 0.012, -0.214)
FRILL = tuple(hd(0.05, 0.025, -0.035))  # where each fan of frills springs from
WHISKER = tuple(hd(0.026, 0.002, -0.192))  # each whisker's root, beside the nose
WHISKER_LEN = 0.62
WHISKER_N = 8  # bones along each

# front legs (arms): the shoulder joint, elbow, wrist, the knuckles and the
# claws' tips, standing square on all fours
FRONT = dict(shoulder=(0.074, Y0 - 0.035, SHOULDER_S), elbow=(0.08, Y0 - 0.215, SHOULDER_S + 0.04), wrist=(0.074, 0.082, SHOULDER_S + 0.005), knuckle=(0.074, 0.024, SHOULDER_S - 0.032), toe=(0.074, 0.006, SHOULDER_S - 0.072))
# hind legs: hip, stifle (the knee, forward), hock (back), the ball of the
# foot and the claws' tips; the cannon below the hock lies near parallel to
# the thigh (the game keeps it so: a two-bone solve)
HIND = dict(hip=(0.082, Y0 - 0.02, HIP_S), stifle=(0.09, 0.31, HIP_S - 0.08), hock=(0.082, 0.15, HIP_S + 0.08), foot=(0.08, 0.032, HIP_S + 0.036), toe=(0.08, 0.007, HIP_S - 0.034))

# the plume at the end of the tail: each feather's root (s), direction and
# length; a vane wide and thin, its tip curling up
def _fan():
    """A fountain of long feathers off the end of the tail, spraying back
    and up and out round it (none straight down), the longest along it."""
    out = []
    rng = np.random.default_rng(3)
    k = 0
    for ring, (elev, n, L0, s0) in enumerate([(0.16, 3, 0.4, 1.9), (0.5, 7, 0.35, 1.93), (0.85, 8, 0.27, 1.97)]):
        for i in range(n):
            phi = (i / max(1, n - 1) - 0.5) * (2.5 if ring else 1.6) + rng.uniform(-0.12, 0.12) + 0.5 * (ring == 2) * (i % 2 - 0.5)
            # phi 0 straight up, round to +-; elev off the tail's axis
            e = elev * (1.0 + 0.25 * abs(phi) / 1.6)
            d = (math.sin(phi) * math.sin(e), math.cos(phi) * math.sin(e) * (1 if abs(phi) < 2.3 else -0.4), math.cos(e))
            L = L0 * (1.0 - 0.18 * abs(phi) / 1.6) * rng.uniform(0.9, 1.08)
            out.append((s0 + 0.02 * rng.uniform() + 0.012 * k % 3, d, L))
            k += 1
    return out


FAN = _fan()

# the frills behind each cheek (right side): direction (out, up, back) and
# length, from up by the antlers round to under the jaw
FRILLS = [
    ((0.38, 0.6, 0.7), 0.13),
    ((0.52, 0.32, 0.79), 0.165),
    ((0.6, 0.06, 0.8), 0.175),
    ((0.56, -0.2, 0.8), 0.155),
    ((0.44, -0.44, 0.78), 0.12),
]

# the antlers (right side): the beam from the skull up, out and back, and its
# tines (from how far up the beam, toward)
# (head units)
ANTLER = [(0.032, 0.078, -0.064), (0.05, 0.14, -0.05), (0.072, 0.2, -0.018), (0.09, 0.248, 0.03), (0.092, 0.272, 0.078)]
ANTLER_R = [0.0118, 0.0104, 0.0088, 0.0066, 0.003]
TINES = [
    (1, 0.4, (0.058, 0.2, -0.1), 0.0074, 0.0026),
    (2, 0.45, (0.128, 0.245, -0.035), 0.0066, 0.0024),
    (3, 0.35, (0.078, 0.31, 0.0), 0.0054, 0.002),
    (0, 0.75, (0.048, 0.115, -0.105), 0.0062, 0.0022),
]

MAT = dict(body=1, mane=2, antler=3, jaw=4, mouth=5, claw=6, frill=7, whisker=8, fan=9)


def build_rig():
    bone('body', None, (0, 0, 0))
    for i in range(SPINE_N):
        bone('sp%d' % i, 'body', (0, Y0, spine_s(i)))
    bone('head', 'body', (0, Y0, 0))
    bone('jaw', 'head', JAW - V(0, Y0, 0))
    for s, L in SIDES:
        bone('frill' + L, 'head', V(s * FRILL[0], FRILL[1], FRILL[2]) - V(0, Y0, 0))
    for s, L in SIDES:
        root = V(s * WHISKER[0], WHISKER[1], WHISKER[2])
        for i in range(WHISKER_N):
            bone('wh%s%d' % (L, i), 'body', root + V(0, 0, WHISKER_LEN * i / WHISKER_N))
    sh, hp = spine_bone(SHOULDER_S), spine_bone(HIP_S)
    for s, L in SIDES:
        f = {k: V(s * v[0], v[1], v[2]) for k, v in FRONT.items()}
        h = {k: V(s * v[0], v[1], v[2]) for k, v in HIND.items()}
        at = B.world_pos(sh)
        bone('arm' + L, sh, f['shoulder'] - at)
        bone('fore' + L, 'arm' + L, f['elbow'] - f['shoulder'])
        bone('hand' + L, 'fore' + L, f['wrist'] - f['elbow'])
        at = B.world_pos(hp)
        bone('thigh' + L, hp, h['hip'] - at)
        bone('shin' + L, 'thigh' + L, h['stifle'] - h['hip'])
        bone('meta' + L, 'shin' + L, h['hock'] - h['stifle'])
        bone('foot' + L, 'meta' + L, h['foot'] - h['hock'])


# --------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------


def unit(v):
    v = V(*v)
    return v / np.linalg.norm(v)


def tuft(a, b, r0, r1=0.0015):
    return round_cone(a, b, r0, r1)


def spine_w():
    """Skin weights along the spine by z (= s at rest)."""
    return along(lambda p: p[:, 2], [(spine_s(i), 'sp%d' % i) for i in range(SPINE_N)])


def blade(a, d, n, L, w, t, curl=0.0, base=0.25):
    """A feather's vane (or a frill): from a along d, L long; w its half
    width at the widest (base: how narrow its root, as a share of w), t its
    half thickness; n the normal to its plane; its tip curling toward n by
    curl (m)."""
    a, d, n = V(*a), unit(d), unit(n)
    n = n - d * (n @ d)
    n /= np.linalg.norm(n)
    e = np.cross(d, n)

    def width(k):
        prof = np.sin(np.pi * np.minimum(k * 0.82 + 0.06, 1.0)) ** 0.7 * (base + (1 - base) * smooth(0.0, 0.3, k))
        return w * prof * (1 - smooth(0.82, 1.0, k) * 0.9)

    def fn(p):
        q = p - a
        u = q @ d
        k = clamp(u / L, 0, 1)
        v = q @ e
        h = q @ n - curl * k * k
        W = width(k)
        d2 = np.maximum(np.abs(v) - W, np.maximum(-u, u - L))
        T = t * (1 - 0.6 * k)
        dh = np.abs(h) - T
        return np.sqrt(np.maximum(d2, 0) ** 2 + np.maximum(dh, 0) ** 2) + np.minimum(np.maximum(d2, dh), 0)

    b = a + d * L
    m = w + abs(curl) + t + 0.01
    return Prim(fn, np.minimum(a, b) - m, np.maximum(a, b) + m), (a, d, e, n, L, width)


# --------------------------------------------------------------------------------
# the body: head, neck, trunk, tail and legs as one surface
# --------------------------------------------------------------------------------


def head_prims():
    S = hr
    cranium = ellipsoid(hd(0, 0.038, -0.07), (S(0.06), S(0.056), S(0.066)))
    brow = ellipsoid(hd(0, 0.052, -0.112), (S(0.05), S(0.03), S(0.038)))
    # a short snout, rounded, the nose a little upturned
    snout = stroke([hd(0, 0.024, -0.1), hd(0, 0.014, -0.156), hd(0, 0.011, -0.196)], [S(0.044), S(0.034), S(0.026)])
    nose = ellipsoid(NOSE, (S(0.027), S(0.021), S(0.017)))
    cheeks = [ellipsoid(hd(s * 0.04, 0.002, -0.088), (S(0.041), S(0.038), S(0.05))) for s, _ in SIDES]
    # spiky fur on the cheeks, below the frills
    burns = []
    for s, _ in SIDES:
        burns.append(tuft(hd(s * 0.06, -0.004, -0.07), hd(s * 0.094, -0.036, -0.026), S(0.012)))
        burns.append(tuft(hd(s * 0.058, -0.016, -0.085), hd(s * 0.086, -0.054, -0.052), S(0.01)))
    return cranium, brow, snout, nose, cheeks, burns


def trunk_prim():
    """A tube along the spine, its radius trunk_r, deeper than wide, capped
    round at both ends (fast: one look-up per point)."""
    z0, z1 = TRUNK_R[0][0], TRUNK_R[-1][0]
    sx, sy = SQUASH
    k = min(sx, sy)
    ss = np.linspace(z0, z1, 400)
    slope = np.gradient(trunk_r(ss), ss)

    def fn(p):
        rho = np.sqrt((p[:, 0] / sx) ** 2 + ((p[:, 1] - Y0) / sy) ** 2)
        z = p[:, 2]
        zc = clamp(z, z0, z1)
        r = trunk_r(zc)
        inside = (rho - r) * np.cos(np.arctan(np.interp(zc, ss, slope)))
        cap = np.sqrt(rho * rho + (z - zc) ** 2) - r
        return np.where((z < z0) | (z > z1), cap, inside) * k

    m = 0.1
    return Prim(fn, (-m, Y0 - m, z0 - m), (m, Y0 + m, z1 + m))


def body_prims():
    chest = ellipsoid((0, Y0 - 0.026, SHOULDER_S + 0.08), (0.074, 0.098, 0.14))
    shoulders = [ellipsoid((s * 0.05, Y0 - 0.006, SHOULDER_S + 0.01), (0.046, 0.07, 0.07)) for s, _ in SIDES]
    haunches = [ellipsoid((s * 0.06, Y0 - 0.04, HIP_S + 0.0), (0.064, 0.112, 0.108), B.rot_x(-0.4)) for s, _ in SIDES]
    return chest, shoulders, haunches


def front_leg(s):
    F = {k: V(s * v[0], v[1], v[2]) for k, v in FRONT.items()}
    sh, el, wr, kn = F['shoulder'], F['elbow'], F['wrist'], F['knuckle']
    upper = round_cone(sh + V(0, 0.025, 0), el, 0.046, 0.028)
    fore = round_cone(el, wr, 0.027, 0.017)
    # feathered fur off the back of the forearm
    feather = tuft(el + V(0, -0.005, 0.02), el + V(s * 0.014, -0.09, 0.06), 0.016)
    palm = round_cone(wr, kn, 0.018, 0.0145)
    fingers = [round_cone(kn, kn + V(s * dx, -0.013, -0.036), 0.0092, 0.0074) for dx in (-0.017, 0.0, 0.017)]
    return upper, fore, feather, palm, fingers, F


def hind_leg(s):
    H = {k: V(s * v[0], v[1], v[2]) for k, v in HIND.items()}
    hp, st, hk, ft = H['hip'], H['stifle'], H['hock'], H['foot']
    thigh = round_cone(hp, st, 0.06, 0.036)
    # feathered fur off the side of the thigh
    feather = tuft(hp + V(s * 0.05, -0.07, 0.03), hp + V(s * 0.082, -0.18, 0.1), 0.022)
    shin = round_cone(st, hk, 0.031, 0.019)
    cannon = round_cone(hk, ft + V(0, 0.008, 0), 0.0175, 0.015)
    toes = [round_cone(ft, ft + V(s * dx, -0.018, -0.054), 0.0112, 0.0082) for dx in (-0.02, 0.0, 0.02)]
    return thigh, feather, shin, cannon, toes, H


def g_body():
    cranium, brow, snout, nose, cheeks, burns = head_prims()
    trunk = trunk_prim()
    chest, shoulders, haunches = body_prims()
    fronts = [front_leg(s) for s, _ in SIDES]
    hinds = [hind_leg(s) for s, _ in SIDES]

    def head_field(p):
        d = smin(cranium(p), brow(p), 0.03)
        d = smin(d, snout(p), 0.03)
        for c in cheeks:
            d = smin(d, c(p), 0.025)
        d = smin(d, nose(p), 0.012)
        for b in burns:
            d = smin(d, b(p), 0.01)
        return d

    def field(p):
        d = smin(trunk(p), chest(p), 0.05)
        for q in shoulders + haunches:
            d = smin(d, q(p), 0.04)
        d = smin(d, head_field(p), 0.04)
        for upper, fore, feather, palm, fingers, _ in fronts:
            leg = smin(upper(p), fore(p), 0.018)
            leg = smin(leg, feather(p), 0.01)
            hand = palm(p)
            for f in fingers:
                hand = smin(hand, f(p), 0.008)
            leg = smin(leg, hand, 0.012)
            d = smin(d, leg, 0.035)
        for thigh, feather, shin, cannon, toes, _ in hinds:
            leg = smin(thigh(p), feather(p), 0.015)
            low = smin(shin(p), cannon(p), 0.012)
            foot = toes[0](p)
            for t in toes[1:]:
                foot = smin(foot, t(p), 0.008)
            low = smin(low, foot, 0.012)
            leg = smin(leg, low, 0.02)
            d = smin(d, leg, 0.045)
        return d

    head = rigid('head')
    sw = spine_w()
    owners = [(trunk, sw), (chest, sw)] + [(q, sw) for q in shoulders + haunches]
    owners += [(q, head) for q in (cranium, brow, snout, nose)] + [(c, head) for c in cheeks] + [(b, head) for b in burns]
    region = []  # owner index ranges: legs (for how pale they run)
    sh, hp = spine_bone(SHOULDER_S), spine_bone(HIP_S)
    for (upper, fore, feather, palm, fingers, F), (s, L) in zip(fronts, SIDES):
        so, el, wr = F['shoulder'], F['elbow'], F['wrist']
        wu = by_axis(so, unit(el - so), [(-0.03, sh), (0.025, 'arm' + L), (0.13, 'arm' + L), (0.18, 'fore' + L)])
        wf = by_axis(el, unit(wr - el), [(-0.01, 'arm' + L), (0.03, 'fore' + L), (0.18, 'fore' + L), (0.21, 'hand' + L)])
        i0 = len(owners)
        owners += [(upper, wu), (fore, wf), (feather, wf), (palm, rigid('hand' + L))] + [(f, rigid('hand' + L)) for f in fingers]
        region.append(('front', s, i0, len(owners), F))
    for (thigh, feather, shin, cannon, toes, H), (s, L) in zip(hinds, SIDES):
        h0, st, hk = H['hip'], H['stifle'], H['hock']
        wt = by_axis(h0, unit(st - h0), [(-0.03, hp), (0.03, 'thigh' + L), (0.15, 'thigh' + L), (0.19, 'shin' + L)])
        ws = by_axis(st, unit(hk - st), [(-0.01, 'thigh' + L), (0.03, 'shin' + L), (0.19, 'shin' + L), (0.225, 'meta' + L)])
        wc = by_axis(hk, unit(V(0, -1, -0.38)), [(-0.005, 'shin' + L), (0.014, 'meta' + L), (0.095, 'meta' + L), (0.12, 'foot' + L)])
        i0 = len(owners)
        owners += [(thigh, wt), (feather, wt), (shin, ws), (cannon, wc)] + [(t, rigid('foot' + L)) for t in toes]
        region.append(('hind', s, i0, len(owners), H))

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0], out[:, 1] = scale_grid(p)
        # (not down the legs)
        legs = sum(own[:, i0:i1].sum(1) for _, _, i0, i1, _ in region)
        out[:, 2] = np.where(legs > 0.35, np.minimum(belly(p), -0.012), belly(p))
        # pale from the elbows and the knees down, palest at the hands and
        # feet
        pale = np.zeros(len(p))
        for kind, s, i0, i1, J in region:
            w = own[:, i0:i1].sum(1)
            if kind == 'front':
                k = smooth(0.31, 0.18, p[:, 1])
            else:
                k = np.maximum(smooth(0.23, 0.14, p[:, 1]), smooth(0.31, 0.25, p[:, 1]) * smooth(HIP_S - 0.02, HIP_S + 0.05, p[:, 2]) * 0.5)
            pale = np.maximum(pale, w * k)
        out[:, 3] = pale
        return out

    return Garment('body', MAT['body'], 0.0044, (-0.2, -0.01, -0.36), (0.2, Y0 + 0.17, SPINE_LEN + 0.04), field, owners, 14000, tau=0.01, details=details)


def scale_grid(p):
    """The fish scales' grid: (round her, along her), one scale each, the
    scales sized to how thick she is there (as many round her tail as round
    her chest)."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    rho = np.sqrt(x * x + (y - Y0) ** 2)
    th = np.arctan2(x, y - Y0)  # 0 along her back, +-pi along her belly
    s = clamp(z, -0.3, SPINE_LEN + 0.3)
    r = trunk_r(s)
    width = 2 * np.pi * r / SCALES_AROUND
    u = th * rho / width
    # along: each scale a little shorter than it's wide
    ss = np.linspace(-0.3, SPINE_LEN + 0.3, 2000)
    rate = 1.0 / (2 * np.pi * trunk_r(ss) / SCALES_AROUND * 0.78)
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (rate[1:] + rate[:-1]) * np.diff(ss))])
    v = np.interp(s, ss, cum) - np.interp(0.0, ss, cum)
    return u, v


def belly(p):
    """Signed: how far inside the gold of her belly a point lies (m). It runs
    from her chin down her throat, chest and belly and under her tail almost to
    the plume, a broad band narrowing toward the tail; between the legs it
    gives way to her scales."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    s = clamp(z, -0.3, SPINE_LEN)
    r = trunk_r(s)
    th = np.arctan2(np.abs(x), -(y - Y0))  # 0 straight down
    half = np.interp(s, [-0.2, 0.0, 0.3, 0.6, 0.9, 1.5, 2.0], [0.75, 0.82, 0.8, 0.76, 0.64, 0.55, 0.4])
    band = (half - th) * r
    # the throat and under the jaw, on the head
    chin = smooth(-0.04, 0.02, z)
    band = band * chin + (1 - chin) * ((Y0 - hr(0.018)) - y) * 1.5
    return np.where(z > SPINE_LEN - 0.12, np.minimum(band, (SPINE_LEN - 0.12 - z)), band)


# --------------------------------------------------------------------------------
# the mane: a crest of feathery fur from between the antlers down her neck and
# back to the plume, each tuft lying back toward her tail
# --------------------------------------------------------------------------------


def mane_h(s):
    # how long the crest's locks grow (m) along her
    return np.interp(s, [-0.12, 0.0, 0.12, 0.3, 0.45, 0.7, 1.0, 1.4, 1.8, 1.95], [0.07, 0.1, 0.11, 0.095, 0.07, 0.058, 0.05, 0.04, 0.03, 0.0])


def mane_tufts():
    """Locks of feathery fur lying back along her, overlapping like
    shingles: on the neck a full mane falling to both sides, down her back
    and tail a crest narrowing to a ridge; each lock lies back toward her tail
    and breaks off in a point."""
    tufts = []
    rng = np.random.default_rng(7)
    s = -0.02
    while s < 1.9:
        r = float(trunk_r(max(s, -0.02))) * SQUASH[1]
        h = float(mane_h(s))
        step = 0.024 + 0.014 * min(1.0, max(0.0, s) / 1.5)
        # how far round her sides the mane falls (radians from her back)
        fall = float(np.interp(s, [-0.12, 0.0, 0.25, 0.45, 0.8, 1.9], [0.5, 0.95, 0.85, 0.5, 0.3, 0.12]))
        n = max(1, int(round(fall / 0.22)) * 2 + 1)
        for c in range(n):
            a = (c / (n - 1) - 0.5) * 2 * fall if n > 1 else 0.0
            a += rng.uniform(-0.06, 0.06)
            out = V(math.sin(a), math.cos(a), 0)
            base = V(0, Y0, s) + out * (r * 0.86)
            # lying back and down along her, a little out from her sides
            lie = V(math.sin(a) * 0.35, math.cos(a) * 0.3 * (1 - abs(a)) - 0.12 * abs(a), 1.0)
            lie /= np.linalg.norm(lie)
            L = h * (1.0 - 0.3 * abs(a) / max(fall, 0.3)) * rng.uniform(0.85, 1.15)
            tip = base + lie * L * 1.25 + out * L * 0.35
            tufts.append((tuft(base, tip, max(0.01, L * 0.3)), s))
        s += step
    # the forelock between the antlers: dark spikes standing up and swept
    # forward
    for a, b, r in [((0, 0.075, -0.075), (0.004, 0.142, -0.108), 0.016), ((0.016, 0.07, -0.06), (0.032, 0.128, -0.088), 0.013), ((-0.016, 0.07, -0.06), (-0.032, 0.125, -0.084), 0.013), ((0, 0.078, -0.04), (0.0, 0.14, -0.028), 0.015)]:
        tufts.append((tuft(hd(*a), hd(*b), hr(r)), -0.2))
    # and locks over the back of her skull, lying back onto her neck
    for x, z in [(0.0, -0.035), (0.022, -0.03), (-0.022, -0.03), (0.0, -0.012), (0.03, -0.01), (-0.03, -0.01)]:
        a = hd(x, 0.086 - abs(x) * 0.6, z)
        b = hd(x * 1.6, 0.075 - abs(x), z + 0.07)
        tufts.append((tuft(a, b, hr(0.016)), -0.2))
    return tufts
    return tufts


def g_mane():
    tufts = mane_tufts()
    head_w = rigid('head')
    sw = spine_w()

    def field(p):
        d = np.full(len(p), 1.0)
        for t, _ in tufts:
            d = smin(d, t(p), 0.012)
        return d

    owners = [(t, head_w if s < -0.15 else sw) for t, s in tufts]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0], out[:, 1] = scale_grid(p)
        out[:, 2] = -1.0
        # longer fur toward the tips of the crest, longest on the neck
        rho = np.sqrt(p[:, 0] ** 2 + (p[:, 1] - Y0) ** 2)
        top = rho - trunk_r(clamp(p[:, 2], -0.02, SPINE_LEN)) * SQUASH[1]
        out[:, 3] = (0.006 + 0.016 * smooth(0.0, 0.05, top)) * np.interp(p[:, 2], [-0.2, 0.0, 0.4, 1.0, 2.0], [0.7, 1.1, 1.0, 0.8, 0.6])
        return out

    lo = (-0.17, Y0 - 0.05, -0.2)
    hi = (0.17, Y0 + 0.25, 2.1)
    return Garment('mane', MAT['mane'], 0.0036, lo, hi, field, owners, 6000, tau=0.01, details=details)


# --------------------------------------------------------------------------------
# the jaw, the antlers, the frills, the whiskers, the claws, the plume
# --------------------------------------------------------------------------------


def jaw_prims():
    jaw = stroke([hd(0, -0.016, -0.058), hd(0, -0.02, -0.13), hd(0, -0.012, -0.19)], [hr(0.03), hr(0.022), hr(0.0145)])
    chin = ellipsoid(hd(0, -0.02, -0.17), (hr(0.02), hr(0.014), hr(0.03)))
    return jaw, chin


def jaw_field(p):
    jaw, chin = jaw_prims()
    return smin(jaw(p), chin(p), 0.015)


def g_jaw():
    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 0], out[:, 1] = scale_grid(p)
        out[:, 2] = 0.02  # gold underneath
        return out

    def mats(p, n, own):
        # its top, inside the mouth: hidden in the snout until it opens
        cranium, brow, snout, nose, cheeks, burns = head_prims()
        m = np.full(len(p), MAT['jaw'])
        inside = np.minimum(snout(p), np.minimum(cheeks[0](p), cheeks[1](p)))
        m[(inside < 0.0008) & (n[:, 1] > 0.15)] = MAT['mouth']
        return m

    jaw, chin = jaw_prims()
    return Garment('jaw', MAT['jaw'], 0.0024, (-0.07, Y0 - 0.09, -0.33), (0.07, Y0 + 0.03, -0.03), jaw_field, [(jaw, rigid('jaw')), (chin, rigid('jaw'))], 800, details=details, mats=mats, outline=0.05)


def antler_prims():
    out = []
    for s, _ in SIDES:
        A = lambda x, y, z: hd(x, 0.078 + (y - 0.078) * ANTLER_S, -0.064 + (z + 0.064) * ANTLER_S)
        pts = [A(s * a[0], a[1], a[2]) for a in ANTLER]
        beam = stroke(pts, [hr(r) for r in ANTLER_R])
        tines = []
        for seg, k, tip, r0, r1 in TINES:
            a = pts[seg] + (pts[seg + 1] - pts[seg]) * k
            tines.append(round_cone(a, A(s * tip[0], tip[1], tip[2]), hr(r0), hr(r1)))
        # the burr at the base
        burr = ellipsoid(pts[0] + V(0, hr(0.006), 0), (hr(0.017), hr(0.008), hr(0.017)))
        out.append((beam, tines, burr, pts))
    return out


def g_antlers():
    parts = antler_prims()

    def field(p):
        d = np.full(len(p), 1.0)
        for beam, tines, burr, _ in parts:
            a = smin(beam(p), burr(p), 0.006)
            for t in tines:
                a = smin(a, t(p), 0.005)
            d = np.minimum(d, a)
        return d

    owners = []
    for beam, tines, burr, _ in parts:
        owners += [(beam, rigid('head')), (burr, rigid('head'))] + [(t, rigid('head')) for t in tines]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 1] = clamp((p[:, 1] - (Y0 + hr(0.075))) / hr(0.25), 0, 1)
        out[:, 2] = -1.0
        return out

    return Garment('antlers', MAT['antler'], 0.0021, (-0.2, Y0 + 0.07, -0.17), (0.2, Y0 + 0.44, 0.13), field, owners, 2000, tau=0.004, details=details, outline=0.32)


def frill_blades():
    out = []
    for s, L in SIDES:
        root = V(s * FRILL[0], FRILL[1], FRILL[2])
        for i, (d, l) in enumerate(FRILLS):
            dd = V(s * d[0], d[1], d[2])
            # each lies in the plane of the fan, which faces out and forward
            n = V(s * 0.85, 0.0, -0.53)
            prim, frame = blade(root + dd * 0.01, dd, n, l, 0.0165 + 0.004 * (i in (1, 2)), 0.0032, curl=-0.012, base=0.35)
            out.append((prim, frame, L))
    return out


def g_frills():
    blades = frill_blades()

    def field(p):
        d = np.full(len(p), 1.0)
        for prim, _, _ in blades:
            d = smin(d, prim(p), 0.006)
        return d

    owners = [(prim, by_axis(frame[0], frame[1], [(0.0, 'head'), (0.03, 'frill' + L)])) for prim, frame, L in blades]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        across = np.zeros(len(p))
        along_ = np.zeros(len(p))
        for i, (prim, (a, d, e, nn, L, W), _) in enumerate(blades):
            q = p - a
            k = clamp((q @ d) / L, 0, 1)
            across += own[:, i] * clamp((q @ e) / np.maximum(W(k), 1e-4), -1.2, 1.2)
            along_ += own[:, i] * k
        out[:, 0], out[:, 1] = across, along_
        out[:, 2] = -1.0
        return out

    return Garment('frills', MAT['frill'], 0.0018, (-0.24, Y0 - 0.12, -0.07), (0.24, Y0 + 0.17, 0.2), field, owners, 2000, tau=0.004, details=details, outline=0.35)


def g_whiskers():
    prims = []
    for s, L in SIDES:
        root = V(s * WHISKER[0], WHISKER[1], WHISKER[2])
        tip = root + V(0, 0, WHISKER_LEN)
        prims.append((round_cone(root - V(0, 0, 0.004), tip, 0.0036, 0.0014), L, root))

    def field(p):
        return np.minimum(prims[0][0](p), prims[1][0](p))

    seg = WHISKER_LEN / WHISKER_N
    owners = []
    for prim, L, root in prims:
        ctrl = [(-0.01, 'head'), (0.004, 'wh%s0' % L)] + [(seg * i, 'wh%s%d' % (L, i)) for i in range(1, WHISKER_N)]
        owners.append((prim, by_axis(root, V(0, 0, 1), ctrl)))

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 1] = clamp((p[:, 2] - WHISKER[2]) / WHISKER_LEN, 0, 1)
        out[:, 2] = -1.0
        return out

    lo = (-0.05, Y0 - 0.01, WHISKER[2] - 0.01)
    hi = (0.05, Y0 + 0.016, WHISKER[2] + WHISKER_LEN + 0.01)
    return Garment('whiskers', MAT['whisker'], 0.002, lo, hi, field, owners, 900, tau=0.004, details=details, outline=0.12)


def claw(a, d, L, r):
    """A hooked claw from a along d, curving down to a needle point."""
    a, d = V(*a), unit(d)
    m = a + d * L * 0.55 + V(0, -L * 0.12, 0)
    b = a + d * L + V(0, -L * 0.45, 0)
    return stroke([a, m, b], [r, r * 0.62, 0.0007])


def g_claws():
    prims = []
    for s, L in SIDES:
        f = {k: V(s * v[0], v[1], v[2]) for k, v in FRONT.items()}
        kn = f['knuckle']
        for dx in (-0.017, 0.0, 0.017):
            tip = kn + V(s * dx, -0.013, -0.036)
            prims.append((claw(tip + V(0, 0.002, 0.002), V(s * dx * 0.5, 0.15, -1), 0.032, 0.0066), 'hand' + L))
        h = {k: V(s * v[0], v[1], v[2]) for k, v in HIND.items()}
        ft = h['foot']
        for dx in (-0.02, 0.0, 0.02):
            tip = ft + V(s * dx, -0.018, -0.054)
            prims.append((claw(tip + V(0, 0.003, 0.002), V(s * dx * 0.5, 0.2, -1), 0.036, 0.0074), 'foot' + L))

    def field(p):
        d = np.full(len(p), 1.0)
        for c, _ in prims:
            d = np.minimum(d, c(p))
        return d

    owners = [(c, rigid(b)) for c, b in prims]

    def details(p, n, own):
        out = np.zeros((len(p), 4))
        out[:, 2] = -1.0
        return out

    lo = (-0.12, -0.012, SHOULDER_S - 0.14)
    hi = (0.12, 0.05, HIP_S + 0.0)
    return Garment('claws', MAT['claw'], 0.0014, lo, hi, field, owners, 1600, tau=0.003, details=details, outline=0.5)


def fan_blades():
    out = []
    for s0, d, L in FAN:
        r = float(trunk_r(s0))
        dd = unit(d)
        a = V(0, Y0, s0) + V(dd[0], dd[1], 0) * r * 0.6
        # each vane faces out from the tail's axis, turned a little about its
        # own shaft (as a shuttlecock's are), so from any side some show
        # their faces
        rad = V(dd[0], dd[1], 0)
        rad = rad / np.linalg.norm(rad) if np.linalg.norm(rad) > 1e-3 else V(1, 0, 0)
        tan = np.cross(V(0, 0, 1), rad)
        n = rad * math.cos(0.8) + tan * math.sin(0.8)
        prim, frame = blade(a, dd, n, L, 0.03 * (L / 0.3) ** 0.5, 0.0042, curl=0.05 * L / 0.3, base=0.2)
        out.append((prim, frame, s0))
    return out


def g_fan():
    blades = fan_blades()

    def field(p):
        d = np.full(len(p), 1.0)
        for prim, _, _ in blades:
            d = smin(d, prim(p), 0.008)
        return d

    last = 'sp%d' % (SPINE_N - 1)
    owners = []
    for prim, (a, dd, e, n, L, W), s0 in blades:
        owners.append((prim, by_axis(a, dd, [(0.0, spine_bone(s0)), (0.06, spine_bone(min(SPINE_LEN, s0 + 0.12))), (0.14, last)])))

    def details(p, n_, own):
        out = np.zeros((len(p), 4))
        across = np.zeros(len(p))
        along_ = np.zeros(len(p))
        for i, (prim, (a, d, e, nn, L, W), _) in enumerate(blades):
            q = p - a
            k = clamp((q @ d) / L, 0, 1)
            across += own[:, i] * clamp((q @ e) / np.maximum(W(k), 1e-4), -1.2, 1.2)
            along_ += own[:, i] * k
        out[:, 0], out[:, 1] = across, along_
        out[:, 2] = -1.0
        return out

    lo = (-0.3, Y0 - 0.2, 1.86)
    hi = (0.3, Y0 + 0.36, SPINE_LEN + 0.32)
    return Garment('fan', MAT['fan'], 0.0026, lo, hi, field, owners, 3400, tau=0.006, details=details, outline=0.7)


# --------------------------------------------------------------------------------


def eye_point():
    """The eye's centre on the surface of her head (right side), and the
    direction it looks."""
    cranium, brow, snout, nose, cheeks, burns = head_prims()

    def head(p):
        d = smin(cranium(p), brow(p), 0.03)
        d = smin(d, snout(p), 0.03)
        for c in cheeks:
            d = smin(d, c(p), 0.025)
        return d

    o = hd(0.0, 0.04, -0.09)
    dirn = unit((0.62, 0.22, -0.75))
    t = 0.0
    for _ in range(200):
        p = (o + dirn * t)[None]
        d = head(p)[0]
        if d > 0:
            break
        t += 0.0005
    return o + dirn * t, dirn


def build():
    t0 = time.time()
    build_rig()
    garments = [g_body(), g_mane(), g_jaw(), g_antlers(), g_frills(), g_whiskers(), g_claws(), g_fan()]
    r5 = lambda v: [round(float(x), 5) for x in v]
    eye, look = eye_point()
    rig = dict(
        y0=Y0,
        headScale=HEAD_S,
        spine=dict(length=SPINE_LEN, bones=SPINE_N, radius=[[a, b] for a, b in TRUNK_R], shoulder=SHOULDER_S, hip=HIP_S),
        front=dict((k, r5(v)) for k, v in FRONT.items()),
        hind=dict((k, r5(v)) for k, v in HIND.items()),
        whisker=dict(root=r5(WHISKER), length=WHISKER_LEN, bones=WHISKER_N),
        frill=r5(FRILL),
        jaw=r5(JAW),
        nose=r5(NOSE),
        eye=r5(eye),
        eyeDir=r5(look),
        fan=[[s0, r5(unit(d)), L] for s0, d, L in FAN],
    )
    print(f'  eye at {r5(eye)}')
    B.export(garments, OUT, MAT, rig, 'dragon', 'dragon.py')
    print(f'dragon: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
