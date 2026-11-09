#!/usr/bin/env python3
"""Sculpt the samurai and write assets/samurai/runner.json + runner.bin.

The sixth runner, sculpted the same way as the others (build.py: every
garment one signed-distance field of volumes blended smoothly into each
other, polygonised, skinned by which volume owns each point, linework drawn
by the game's character shader), to his reference sheet
(tools/characters/samurai-sheet.jpg): Birch, a tall, heavily muscled white
tiger with a cheetah's long build - about 1.9 m to his crown, his round ears
nearer 2 m - broad through the shoulders, thick in the forearm and the calf.
Ivory fur, charcoal stripes (the shader paints them), a broad feline head:
a wide, flat brow overhanging stern golden eyes, full cheeks fringed with a
ruff of tufts, a broad muzzle on two whisker pads, a dusty-rose nose; short
rounded ears. A loose, nearly black training kimono, crossed left over right
in a deep V over his chest, its wide sleeves ending past the elbow; a
reddish-brown obi wound round his waist and knotted at the front, its two
long ends hanging; loose charcoal hakama gathered round his lower shins; his
forearms bound in reddish-brown wraps; barefoot on big paws, dark claws;
a long, thick tail. A katana in a black lacquered scabbard rides through the
obi at his left hip, its hilt forward and up: the scabbard is skinned to a
bone of its own off his hips, and the sword to another (under `sim`, as the
elder's stick is) that the game poses - in the scabbard, in his hand, or
anywhere between as he draws it.

Run from the repository root:

    pip install numpy scipy scikit-image fast-simplification
    python3 tools/runner/samurai.py

Coordinates are the game's: meters, y up, the runner facing -z.
"""

import math
import os
import sys
import time

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
import build as B  # noqa: E402
from build import V, smin, smax, smooth, clamp, ellipsoid, round_cone, stroke, round_box, Prim, rot_x, rot_y, rot_z, Garment, rigid, by_y, by_axis, along  # noqa: E402
from elder import torus_axis, union  # noqa: E402
from skater import MeshGarment  # noqa: E402  (and its meshing of them, patched into build)

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'samurai')
SIDES = [(-1, 'L'), (1, 'R')]
FW = V(0, 0, -1)

# --------------------------------------------------------------------------------
# rig: the game's skeleton, proportioned to his sheet - long in the leg,
# broad in the shoulder, about seven and a half heads to the crown
# --------------------------------------------------------------------------------

HIP_Y = 1.02
HIP_JOINT = (0.105, 0.985)
THIGH = 0.44
SHIN = 0.43
TOE = (0.075, 0.15)  # foot bone -> ball of the paw (down, forward)
CHEST_Y = 1.38
SHOULDER = (0.205, 1.585)
UPPER_ARM = 0.315
FOREARM = 0.29
ARM_REST = 0.24
NECK_Y = 1.6
HEAD_Y = 1.7
KNEE_Y = HIP_JOINT[1] - THIGH
ANKLE_Y = KNEE_Y - SHIN
FOOT_X = 0.112

# the head: cranium (centre, radii)
CRAN = ((0, 1.83, 0.018), (0.103, 0.079, 0.106))

bone = B.bone
BONES, IDX = B.BONES, B.IDX


def unit(*a):
    v = V(*a) if len(a) > 1 else np.asarray(a[0], float)
    return v / np.linalg.norm(v)


def lst(v, k=5):
    return [round(float(x), k) for x in v]


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


def soft_union(ps, p, k):
    d = ps[0](p)
    for q in ps[1:]:
        d = smin(d, q(p), k)
    return d


def strip(pts, half_w, half_t, across, r=0.003):
    """A flat band of cloth through points: a chain of thin rounded boxes, each
    lying along its stretch, its width along `across` (a function of the
    stretch's direction, or a fixed vector)."""
    parts = []
    for i in range(len(pts) - 1):
        a, b = V(*pts[i]), V(*pts[i + 1])
        u = unit(b - a)
        acr = across(u) if callable(across) else V(*across)
        x = unit(acr - u * (acr @ u))
        z = np.cross(x, u)
        R = np.stack([x, u, z], 1)
        hw = half_w[i] if hasattr(half_w, '__len__') else half_w
        L = np.linalg.norm(b - a)
        parts.append(round_box((a + b) / 2, (hw, L / 2 + 0.006, half_t), r, R))
    return parts


# --------------------------------------------------------------------------------
# the katana and its scabbard: the scabbard rides through the obi at his left
# hip, its mouth forward at the obi and the rest of it angled back and down
# past his hip, worn edge up
# --------------------------------------------------------------------------------

_el, _yaw = math.radians(31), math.radians(13)
SAYA = dict(
    mouth=V(-0.208, 1.222, -0.105),
    dir=unit(-math.sin(_yaw) * math.cos(_el), -math.sin(_el), math.cos(_yaw) * math.cos(_el)),
    length=0.75,
    half=(0.0135, 0.021),  # across, edge-to-spine (its oval section)
)
# its frame: +y into it, +z its edge side (up, as it's worn)
SAYA['R'] = basis(SAYA['dir'], V(0, 1, 0))
# the sword (its own frame, the right fist's grip at the origin, the blade up
# +y and its edge toward +z): the hilt from POMMEL to the guard, the blade from
# the guard to its tip
KATANA = dict(pommel=-0.255, guard=0.04, blade0=0.05, tip=0.77, grip2=-0.15, sori=0.022, width=0.031, thick=0.0034, tsuka=(0.0125, 0.0165), tsuba=0.041)
# (sheathed, the guard sits just clear of the scabbard's mouth)
SHEATHED = KATANA['guard'] + 0.006


def katana_centre(y):
    """The blade's gentle curve (sori): its spine bowed back toward -z."""
    L = KATANA['tip'] - KATANA['blade0']
    t = np.clip((y - KATANA['blade0']) / L, 0, 1)
    return -KATANA['sori'] * t ** 2


def katana_local():
    """The katana in its own frame: a long oval hilt wrapped in dark braid
    over pale same-skin (the shader), its pommel cap and collar in gold, a
    round guard, a gold collar on the blade, and the blade itself - a
    wedge, thick along its spine and fining to its edge, curving gently,
    its point swept up into a curved tip."""
    K = KATANA
    rt, rz = K['tsuka']

    def fn(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        # the hilt: an oval, waisted a little along its length
        yy = clamp(y, K['pommel'] + 0.006, K['guard'] - 0.004)
        waist = 1 - 0.07 * np.sin(np.pi * (yy - K['pommel']) / (K['guard'] - K['pommel']))
        q = np.sqrt((x / (rt * waist)) ** 2 + (z / (rz * waist)) ** 2) * rt
        hilt = np.sqrt(np.maximum(q - rt, 0) ** 2 + (y - yy) ** 2) + np.minimum(q - rt, 0)
        hilt = hilt + 0.0011 * np.abs(np.sin((y - K['pommel']) * 95)) * (np.abs(y - yy) < 1e-6)
        # pommel cap and collar, a touch proud
        cap = np.sqrt((x / (rt + 0.0016)) ** 2 + (z / (rz + 0.0016)) ** 2) * rt - rt
        cap = smax(cap, np.maximum(K['pommel'] - 0.004 - y, y - (K['pommel'] + 0.016)), 0.002)
        fuchi = np.sqrt((x / (rt + 0.0014)) ** 2 + (z / (rz + 0.0014)) ** 2) * rt - rt
        fuchi = smax(fuchi, np.maximum(K['guard'] - 0.016 - y, y - K['guard']), 0.0015)
        # the guard: a thick round plate, a little oval
        tsuba = np.sqrt((x / 0.85) ** 2 + z ** 2) - K['tsuba']
        tsuba = smax(tsuba, np.abs(y - (K['guard'] + 0.0035)) - 0.0035, 0.0018)
        # the blade collar
        hab = round_box((0, K['blade0'] + 0.012, 0.0), (0.0055, 0.014, K['width'] * 0.56), 0.002).fn(p)
        d = np.minimum(hilt, cap)
        d = np.minimum(d, fuchi)
        d = np.minimum(d, tsuba)
        return np.minimum(d, hab)

    return Prim(fn, V(-0.05, K['pommel'] - 0.02, -0.06), V(0.05, K['blade0'] + 0.04, 0.06))


def blade_edge(t, w):
    """Where the edge runs (across the blade from its centre line, toward +z)
    at t (0 the collar .. 1 the point): straight, then sweeping up in a
    curve to meet the spine at the point."""
    k = clamp((t - 0.88) / 0.12, 0.0, 1.0)
    return -0.5 * w + w * math.sqrt(max(0.0, 1 - k * k))


def blade_mesh():
    """The blade, meshed directly in the sword's own frame: from the collar to
    the point, a ridged section - a peaked spine, its faces swelling out to
    the ridge line a third of the way across, then fining to the edge - the
    whole of it curving gently back, the edge sweeping up into the point."""
    K = KATANA
    y0 = K['blade0'] + 0.022
    us = np.concatenate([np.linspace(0, 0.86, 34), np.linspace(0.875, 1.0, 10)[:-1]])
    rings = []
    for u in us:
        y = y0 + (K['tip'] - y0) * u
        t = (y - K['blade0']) / (K['tip'] - K['blade0'])
        c = float(katana_centre(np.array([y]))[0])
        w = K['width'] * (1 - 0.22 * t)
        sp = -0.5 * w
        e = blade_edge(t, w)
        we = e - sp
        th = K['thick'] * (1 - 0.35 * t) * min(1.0, we / (0.6 * w))
        rings.append([(0.0, y, c + sp - 0.0006), (0.6 * th, y, c + sp + 0.0012), (th, y, c + sp + 0.32 * we), (0.0, y, c + e), (-th, y, c + sp + 0.32 * we), (-0.6 * th, y, c + sp + 0.0012)])
    v = [q for r in rings for q in r]
    f = []
    n6 = 6
    for i in range(len(rings) - 1):
        for j in range(n6):
            a0, a1 = i * n6 + j, i * n6 + (j + 1) % n6
            b0, b1 = a0 + n6, a1 + n6
            f += [(a0, a1, b1), (a0, b1, b0)]
    # the point
    tip = len(v)
    cT = float(katana_centre(np.array([K['tip']]))[0])
    v.append((0.0, K['tip'], cT - 0.5 * K['width'] * 0.78))
    last = (len(rings) - 1) * n6
    for j in range(n6):
        f.append((last + j, last + (j + 1) % n6, tip))
    # the end in the collar: closed
    base = len(v)
    v.append((0.0, y0 - 0.002, float(katana_centre(np.array([y0]))[0])))
    for j in range(n6):
        f.append(((j + 1) % n6, j, base))
    v = np.array(v, float)
    f = np.array(f, np.int64)
    # (outward winding, checked against the centre line; smooth normals)
    cen = np.stack([np.zeros(len(v)), v[:, 1], katana_centre(v[:, 1])], 1)
    a, b, cq = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    fn = np.cross(b - a, cq - a)
    out = (a + b + cq) / 3 - (cen[f[:, 0]] + cen[f[:, 1]] + cen[f[:, 2]]) / 3
    if ((fn * out).sum(1)).mean() < 0:
        f = f[:, ::-1]
        fn = -fn
    n = np.zeros_like(v)
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    return v, n, f


def katana_part(p):
    """Which part of the sword a point (sword-local) is: 0 hilt, 1 gold
    (pommel cap, collar, guard, blade collar), 2 blade."""
    K = KATANA
    y = p[:, 1]
    gold = (y < K['pommel'] + 0.017) | ((y > K['guard'] - 0.017) & (y < K['blade0'] + 0.027))
    blade = y >= K['blade0'] + 0.027
    return np.where(blade, 2, np.where(gold, 1, 0))


def sword_bind():
    """The sword as bound: in the scabbard, its frame (local -> body) and its
    grip's position."""
    R = SAYA['R']
    grip = SAYA['mouth'] - SHEATHED * SAYA['dir']
    return R, grip


def saya_local():
    """The scabbard in its own frame (its mouth at the origin, running up +y,
    its edge side +z): a long oval of black lacquer following the blade's
    curve, a horn collar round its mouth and a cap on its end, and the knob on
    its side the cord is tied through."""
    L = SAYA['length']
    ha, he = SAYA['half']

    def fn(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        yy = clamp(y, 0.0, L)
        c = katana_centre(yy + SHEATHED)
        t = yy / L
        a, e = ha * (1 - 0.08 * t), he * (1 - 0.12 * t)
        q = np.sqrt((x / a) ** 2 + ((z - c) / e) ** 2) * a - a
        d = np.sqrt(np.maximum(q, 0) ** 2 + (y - yy) ** 2) + np.minimum(q, 0)
        # (rounded off at its end)
        d = smax(d, y - L, 0.008)
        # the collar at the mouth, the cap at the end: a little proud
        col = np.sqrt((x / (a + 0.0016)) ** 2 + ((z - c) / (e + 0.0016)) ** 2) * a - a
        col = smax(col, np.maximum(-y, y - 0.022), 0.0015)
        cap = np.sqrt((x / (a + 0.0014)) ** 2 + ((z - c) / (e + 0.0014)) ** 2) * a - a
        cap = smax(smax(cap, L - 0.03 - y, 0.0015), y - L, 0.007)
        d = np.minimum(d, np.minimum(col, cap))
        # the knob for the cord, on its outer side near the mouth
        knob = ellipsoid((ha + 0.004, 0.085, 0.004), (0.006, 0.012, 0.008)).fn(p)
        return smin(d, knob, 0.004)

    return Prim(fn, V(-0.04, -0.01, -0.05), V(0.04, L + 0.01, 0.05))


# --------------------------------------------------------------------------------
# head: a broad feline head - a wide, flat brow overhanging the eyes, full
# cheeks fringed with ruff, a broad muzzle on two whisker pads, a strong jaw
# --------------------------------------------------------------------------------

NOSE = dict(c=(0, 1.774, -0.172), r=(0.023, 0.0105, 0.012))


def head_prims():
    cran = ellipsoid(*CRAN)
    brow = ellipsoid((0, 1.83, -0.05), (0.09, 0.056, 0.062))
    ridges = [ellipsoid((s * 0.043, 1.826, -0.093), (0.037, 0.015, 0.022), rot_z(s * 0.18)) for s, _ in SIDES]
    cheeks = [ellipsoid((s * 0.073, 1.773, -0.036), (0.064, 0.052, 0.06)) for s, _ in SIDES]
    pads = [ellipsoid((s * 0.031, 1.746, -0.13), (0.042, 0.032, 0.04)) for s, _ in SIDES]
    bridge = round_cone((0, 1.822, -0.094), (0, 1.777, -0.158), 0.03, 0.023)
    chin = ellipsoid((0, 1.71, -0.104), (0.036, 0.02, 0.036))
    jaw = ellipsoid((0, 1.736, -0.036), (0.088, 0.05, 0.082))
    return cran, brow, ridges, cheeks, pads, bridge, chin, jaw


def skull(p):
    cran, brow, ridges, cheeks, pads, bridge, chin, jaw = head_prims()
    d = smin(cran(p), brow(p), 0.05)
    for q in ridges:
        d = smin(d, q(p), 0.022)
    for q in cheeks:
        d = smin(d, q(p), 0.035)
    d = smin(d, jaw(p), 0.04)
    d = smin(d, bridge(p), 0.025)
    for q in pads:
        d = smin(d, q(p), 0.016)
    return smin(d, chin(p), 0.02)


def g_head():
    cran, brow, ridges, cheeks, pads, bridge, chin, jaw = head_prims()
    # the nose: broad across its top, narrowing to its bottom in a rounded
    # triangle
    nose_top = ellipsoid(NOSE['c'], NOSE['r'], rot_x(-0.3))
    nose_low = ellipsoid(V(*NOSE['c']) + V(0, -0.0085, 0.002), (0.011, 0.009, 0.0105), rot_x(-0.3))
    nose = Prim(lambda p: smin(nose_top.fn(p), nose_low.fn(p), 0.006), nose_top.lo - 0.02, nose_top.hi + 0.02)
    # the ruff: tufts of fur standing out from his cheeks and jaw, sweeping
    # back and down; a few short ones up on his crown (seeded: the same every
    # build)
    rnd = np.random.default_rng(23)
    tufts = []
    for s, _ in SIDES:
        for k, (y, z, out, dn) in enumerate([(1.8, -0.02, 0.03, 0.004), (1.778, -0.012, 0.042, -0.006), (1.755, -0.004, 0.046, -0.014), (1.732, 0.004, 0.04, -0.022), (1.71, 0.006, 0.028, -0.026)]):
            a = V(s * (0.122 - 0.006 * abs(k - 2)), y, z)
            o = unit(s * 1.0, 0, 0.32 + 0.08 * k)
            b = a + o * out * 0.55 + V(0, dn * 0.45 + rnd.uniform(-0.003, 0.003), 0.004)
            c = a + o * out + V(0, dn, 0.012)
            tufts.append(stroke([a - 0.016 * o, b, c], [0.017, 0.011, 0.0035]))
        # under the jaw, a fringe hanging down toward the throat
        for k in range(2):
            a = V(s * (0.04 + 0.03 * k), 1.705, -0.04 + 0.02 * k)
            tufts.append(stroke([a + V(0, 0.012, 0), a, a + V(s * 0.006, -0.028, 0.004)], [0.016, 0.011, 0.003]))
    for x0, dz in [(-0.03, 0.0), (0.0, -0.01), (0.032, 0.004)]:
        a = V(x0, 1.918, 0.02 + dz)
        tufts.append(stroke([a - V(0, 0.012, 0), a, a + V(x0 * 0.3, 0.014, 0.02)], [0.012, 0.008, 0.0025]))
    # a thick, muscular neck rising out of the kimono's collar
    neck = round_cone((0, 1.5, 0.014), (0, 1.75, 0.004), 0.087, 0.076)
    nape = ellipsoid((0, 1.66, 0.04), (0.085, 0.07, 0.06))

    def field(p):
        d = skull(p)
        # (the eye sockets: shallow, under the brow - just enough to catch a
        # shadow; the shader draws the eyes)
        for s, _ in SIDES:
            d = smax(d, -ellipsoid((s * 0.045, 1.8, -0.118), (0.026, 0.012, 0.02), rot_z(-s * 0.22))(p), 0.012)
        d = smin(d, nose(p), 0.01)
        for q in tufts:
            d = smin(d, q(p), 0.008)
        d = smin(d, smin(neck(p), nape(p), 0.04), 0.035)
        return d

    head = rigid('head')
    owners = [(cran, head), (brow, head), (chin, head), (jaw, head), (nose, head), (bridge, head)] + [(c, head) for c in ridges + cheeks + pads] + [(q, head) for q in tufts]
    neck_w = by_y([(1.6, 'chest'), (1.66, 'neck'), (1.74, 'head')])
    owners += [(neck, neck_w), (nape, neck_w)]
    n_tuft = len(tufts)

    def details(p, n, own):
        # xyz: where on the head (rest), w: on a tuft
        return np.concatenate([p, own[:, -2 - n_tuft:-2].sum(1)[:, None]], 1)

    def mats(p, n, own):
        return np.where(own[:, 4] > 0.5, MAT['nose'], MAT['face'])

    return Garment('head', MAT['face'], 0.0021, (-0.2, 1.4, -0.19), (0.2, 1.96, 0.15), field, owners, 5800, tau=0.006, details=details, mats=mats)


# --------------------------------------------------------------------------------
# the ears: short and rounded, set wide on top of his head, a dish in front
# --------------------------------------------------------------------------------

EARS = dict(c=V(0.078, 1.912, 0.022), r=(0.036, 0.04, 0.012), tilt=0.42, turn=0.28)


def ear_frame(s):
    R = rot_y(-s * EARS['turn']) @ rot_z(-s * EARS['tilt'])
    c = V(s * EARS['c'][0], EARS['c'][1], EARS['c'][2])
    return R, c


def g_ears():
    parts, bowls, owners = [], [], []
    for s, L in SIDES:
        R, c = ear_frame(s)
        up, fw = R @ V(0, 1, 0), R @ V(0, 0, -1)
        ear = ellipsoid(c, EARS['r'], R)
        base = ellipsoid(c - 0.022 * up + 0.004 * fw, (0.04, 0.026, 0.022), R)
        bowl = ellipsoid(c + 0.006 * up - 0.011 * fw, (0.026, 0.03, 0.009), R)
        parts.append((ear, base, bowl))
        w = along(lambda p, c=c, up=up: (p - c) @ up, [(-0.03, 'head'), (-0.01, 'ear' + L)])
        owners += [(ear, w), (base, w)]

    def field(p):
        out = np.full(len(p), 1.0)
        for ear, base, bowl in parts:
            d = smin(ear(p), base(p), 0.012)
            out = np.minimum(out, smax(d, -bowl(p), 0.004))
        return out

    def details(p, n, own):
        # x: how far into the dish (0 the back .. 1 inside), y: up the ear
        # (0 its root .. 1 its tip), z: across it
        out = np.zeros((len(p), 4))
        for s, L in SIDES:
            R, c = ear_frame(s)
            q = (p - c) @ R
            side = (p[:, 0] * s) > 0
            inside = smooth(0.1, 0.6, -(n @ (R @ V(0, 0, 1)))) * smooth(-0.03, -0.012, q[:, 1])
            out[side, 0] = inside[side]
            out[side, 1] = np.clip((q[side, 1] + 0.03) / 0.07, 0, 1)
            out[side, 2] = q[side, 0] / EARS['r'][0]
        return out

    return Garment('ears', MAT['ear'], 0.0016, (-0.15, 1.84, -0.04), (0.15, 1.97, 0.07), field, owners, 1600, tau=0.008, outline=0.7, details=details)


# --------------------------------------------------------------------------------
# the body under the kimono, and the kimono: loose, nearly black, crossed left
# over right in a deep V over his chest, a broad collar band round its
# neckline, wide sleeves ending past the elbow, and its skirt below the obi
# hanging over the top of the hakama
# --------------------------------------------------------------------------------

TORSO = dict(
    chest=((0, 1.455, 0.0), (0.185, 0.155, 0.128)),
    pecs=((0.074, 1.475, -0.078), (0.083, 0.06, 0.054)),
    yoke=((0, 1.565, 0.012), (0.2, 0.058, 0.108)),
    belly=((0, 1.3, -0.004), (0.158, 0.13, 0.118)),
    cap=0.084,
)
KIMONO = dict(loose=0.016, hem=0.94, sleeve=0.4, sleeveR=(0.084, 0.104), shell=0.011)
SKIRT = dict(top=1.24, c=(0, 1.08, 0.004), r0=0.208, r1=0.262, zs=0.82)
OBI = dict(y=1.236, half=0.043, lift=0.011, t=0.0085, knot=V(0.022, 1.232, -0.188))
# the V of his chest showing between the kimono's crossed edges: the left
# panel's edge from the left of his neck down across to his right hip, the
# right panel's under it (visible only above where they cross)
VNECK = dict(top=1.648, x0=0.078, slope=0.37, band=0.034)


def v_edges(y):
    """x of the left (top) panel's edge and the right (under) panel's."""
    k = (VNECK['top'] - y) * VNECK['slope']
    return -VNECK['x0'] + k, VNECK['x0'] - k


V_CROSS = VNECK['top'] - VNECK['x0'] / VNECK['slope']


def v_open(p):
    """< 0 inside the V of bare chest (m, across)."""
    xl, xr = v_edges(p[:, 1])
    d = np.maximum(xl - p[:, 0], p[:, 0] - xr)
    # (on the front only, and not above the collar)
    return np.maximum(d, np.maximum(p[:, 2] + 0.02, p[:, 1] - VNECK['top'] - 0.03))


def collar_band(p):
    """How far onto the collar band (0..1 across it, < 0 / > 1 off it) - the
    band runs down the left panel's edge to the obi, down the right panel's
    to where it goes under, and round the back of his neck."""
    xl, xr = v_edges(p[:, 1])
    a = (xl - p[:, 0]) / VNECK['band']
    b = np.where(p[:, 1] > V_CROSS - 0.02, (p[:, 0] - xr) / VNECK['band'], -1)
    return a, b


def torso_prims():
    T = TORSO
    chest = ellipsoid(*T['chest'])
    pecs = [ellipsoid((s * T['pecs'][0][0], T['pecs'][0][1], T['pecs'][0][2]), T['pecs'][1]) for s, _ in SIDES]
    yoke = ellipsoid(*T['yoke'])
    belly = ellipsoid(*T['belly'])
    caps = []
    for S, E, W, d, out in [arm_frame(s) for s, _ in SIDES]:
        caps.append(ellipsoid(S + 0.02 * d - 0.006 * out, (T['cap'], T['cap'] * 1.05, T['cap'] * 0.95)))
    return chest, pecs, yoke, belly, caps


def torso_body(p, prims):
    chest, pecs, yoke, belly, caps = prims
    t = smin(chest(p), yoke(p), 0.06)
    for q in pecs:
        t = smin(t, q(p), 0.04)
    t = smin(t, belly(p), 0.09)
    for q in caps:
        t = smin(t, q(p), 0.07)
    return t


def skirt_fn(p):
    """The kimono's skirt below the obi: an oval flaring a little to its hem."""
    S = SKIRT
    y = p[:, 1]
    u = clamp((S['top'] - y) / (S['top'] - KIMONO['hem']), 0, 1)
    r = S['r0'] + (S['r1'] - S['r0']) * u ** 1.4
    rho = np.sqrt(p[:, 0] ** 2 + ((p[:, 2] - S['c'][2]) / S['zs']) ** 2)
    return rho - r


def kimono_body(p, prims):
    """The kimono's outside, before its sleeves: loose over the torso, then
    hanging straight from his chest to the obi, and the skirt below."""
    t = torso_body(p, prims) - KIMONO['loose']
    y = p[:, 1]
    # (from under the chest it hangs straight down rather than following his
    # waist in)
    drape = skirt_fn(p + V(0, 0, 0)) - 0.0
    t = smin(t, smax(drape, y - 1.42, 0.06), 0.05)
    return t


def kimono_smooth(p):
    """The kimono, sleeves and all (what the obi and colliders lie on)."""
    prims = torso_prims()
    t = kimono_body(p, prims)
    for sl in sleeve_prims():
        t = smin(t, sl['tube'](p), 0.06)
    return t


def sleeve_prims():
    out = []
    for S, E, W, d, o in [arm_frame(s) for s, _ in SIDES]:
        r0, r1 = KIMONO['sleeveR']
        end = S + KIMONO['sleeve'] * d
        out.append(dict(S=S, d=d, out=o, end=end, tube=round_cone(S + 0.03 * d, end + 0.01 * d, r0, r1)))
    return out


def g_kimono():
    prims = torso_prims()
    sleeves = sleeve_prims()
    neckhole = round_cone((0, 1.56, 0.02), (0, 1.8, 0.01), 0.083, 0.083)
    # the collar round the back of the neck
    collar = torus_axis((0, 1.655, 0.028), (0, 1, 0.32), 0.094, 0.016)

    def field(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        t = kimono_body(p, prims)
        az = np.arctan2(x, z)
        # loose cloth: long soft folds hanging down it, heavier lower down
        t = t + 0.0035 * np.sin(az * 7 + y * 5) * smooth(1.5, 1.3, y)
        t = t + 0.003 * np.sin(az * 11 - y * 9) * smooth(1.18, 1.0, y)
        # the V of bare chest: recessed to the chest itself
        vo = v_open(p)
        body = torso_body(p, prims) + 0.002
        k = smooth(-0.004, 0.006, vo)
        t = body * (1 - k) + t * k
        # the collar band: proud of the panels
        a, b = collar_band(p)
        band = np.maximum(smooth(-0.15, 0.1, a) * smooth(1.15, 0.9, a), smooth(-0.15, 0.1, b) * smooth(1.15, 0.9, b))
        band = band * smooth(1.22, 1.3, y) * smooth(0.03, 0.0, z) * smooth(VNECK['top'] + 0.02, VNECK['top'] - 0.01, y)
        t = t - 0.0055 * band
        # the right panel lies under the left: a step down past its edge
        xl, _ = v_edges(y)
        t = t + 0.003 * smooth(xl - 0.004, xl + 0.004, x) * smooth(V_CROSS + 0.01, V_CROSS - 0.03, y) * (z < 0)
        t = smax(t, KIMONO['hem'] - y, 0.008)
        t = smin(t, collar(p), 0.014)
        t = smax(t, -neckhole(p), 0.012)
        for sl in sleeves:
            u = (p - sl['S']) @ sl['d']
            tube = sl['tube'](p)
            shell = smax(tube, -(tube + KIMONO['shell']), 0.004)
            shell = smax(shell, u - KIMONO['sleeve'], 0.006)
            # creases round the elbow, the open end rolled a little
            shell = shell + 0.003 * np.sin(u * 48 + np.arctan2(p[:, 2], (p - sl['S']) @ sl['out']) * 2) * smooth(0.18, 0.28, u)
            shell = smin(shell, torus_axis(sl['end'] - 0.008 * sl['d'], sl['d'], KIMONO['sleeveR'][1] - 0.002, 0.0075)(p), 0.005)
            t = smin(t, shell, 0.05)
        return t

    torso_w = by_y([(1.22, 'hips'), (1.3, 'spine'), (1.4, 'spine'), (1.5, 'chest')])
    chest, pecs, yoke, belly, caps = prims
    owners = [(chest, torso_w), (yoke, torso_w), (belly, torso_w)] + [(q, torso_w) for q in pecs]
    owners.append((collar, by_y([(1.6, 'chest'), (1.7, 'neck')])))
    n_torso = len(owners)
    skirt = Prim(skirt_fn, (-0.3, KIMONO['hem'] - 0.02, -0.25), (0.3, SKIRT['top'] + 0.02, 0.25))
    owners.append((skirt, skirt_weights))
    for sl, cap, (s, L) in zip(sleeves, caps, SIDES):
        w = by_axis(sl['S'], sl['d'], [(-0.03, 'clav' + L), (0.08, 'arm' + L), (0.27, 'arm' + L), (0.36, 'fore' + L)])
        owners += [(cap, w), (sl['tube'], w)]
    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        torso = own[:, :n_torso + 1].sum(1)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        a, b = collar_band(p)
        band = np.where((a > -0.1) & (a < 1.1), a, np.where((b > -0.1) & (b < 1.1), b, -1.0))
        band = np.where((p[:, 1] > 1.22) & (p[:, 2] < 0.04), band, -1.0)
        tubes = np.stack([sl['tube'](p) for sl in sleeves], 1).min(1)
        inside = (tubes < -KIMONO['shell'] * 0.5).astype(float) * (1 - torso)
        # x: on the body (not a sleeve), y: down the arm, z: across the collar
        # band (0..1 on it, else -1), w: inside a sleeve
        return np.stack([torso, u, band, inside], 1)

    def mats(p, n, own):
        return np.where((v_open(p) < -0.001) & (own[:, :n_torso].sum(1) > 0.5), MAT['fur'], MAT['kimono'])

    return Garment('kimono', MAT['kimono'], 0.0042, (-0.54, KIMONO['hem'] - 0.02, -0.26), (0.54, 1.72, 0.25), field, owners, 6800, tau=0.014, details=details, mats=mats)


def skirt_weights(p):
    """The skirt below the obi: held by the hips at the top, swung toward each
    thigh lower down, on its own side (the middle front and back stay with
    the hips, between the legs)."""
    y = p[:, 1]
    k = smooth(1.14, 0.95, y) * 0.55 * smooth(0.02, 0.1, np.abs(p[:, 0]))
    left = (p[:, 0] < 0).astype(float)
    return [(IDX['hips'], 1 - k), (IDX['thighL'], k * left), (IDX['thighR'], k * (1 - left))]


# --------------------------------------------------------------------------------
# the obi: a broad reddish-brown band wound round his waist over the kimono,
# knotted at the front, its two long ends hanging
# --------------------------------------------------------------------------------

OBI_TAILS = [
    # (points down from the knot, half-width) - the long end and the short one
    dict(pts=[V(0.022, 1.214, -0.19), V(0.03, 1.08, -0.192), V(0.036, 0.94, -0.21), V(0.04, 0.8, -0.2)], hw=0.03, name='obiA'),
    dict(pts=[V(0.0, 1.214, -0.188), V(-0.022, 1.1, -0.19), V(-0.034, 0.98, -0.206), V(-0.04, 0.88, -0.2)], hw=0.027, name='obiB'),
]


def g_obi():
    O = OBI
    prims = torso_prims()

    def band_fn(p):
        ds = kimono_body(p, prims)
        d = np.abs(ds - O['lift']) - O['t']
        return smax(d, np.abs(p[:, 1] - O['y']) - O['half'], 0.003)

    band = Prim(band_fn, (-0.28, O['y'] - 0.06, -0.24), (0.28, O['y'] + 0.06, 0.24))
    knot = ellipsoid(O['knot'], (0.036, 0.03, 0.022), rot_z(0.3))
    loop = ellipsoid(O['knot'] + V(-0.03, 0.008, 0.008), (0.03, 0.019, 0.016), rot_z(-0.25))
    tails = []
    for T in OBI_TAILS:
        tails.append(strip(T['pts'], T['hw'], 0.0045, lambda u: V(1, 0, 0), 0.003))

    def field(p):
        d = smin(band(p), knot(p), 0.008)
        d = smin(d, loop(p), 0.006)
        for parts in tails:
            d = smin(d, soft_union(parts, p, 0.01), 0.008)
        return d

    owners = [(band, rigid('hips')), (knot, rigid('hips')), (loop, rigid('hips'))]
    for T, parts in zip(OBI_TAILS, tails):
        P0 = T['pts'][0]
        d1, d2 = P0[1] - T['pts'][1][1], P0[1] - T['pts'][2][1]
        w = along(lambda p, P0=P0: P0[1] - p[:, 1], [(0.0, 'hips'), (0.03, T['name'] + '0'), (d1 - 0.03, T['name'] + '0'), (d1 + 0.03, T['name'] + '1'), (d2 - 0.03, T['name'] + '1'), (d2 + 0.03, T['name'] + '2')])
        owners += [(q, w) for q in parts]

    def details(p, n, own):
        # x: on a hanging end, y: down it (m), z: across the band (-1..1)
        tail = own[:, 3:].sum(1)
        down = OBI_TAILS[0]['pts'][0][1] - p[:, 1]
        return np.stack([tail, down, (p[:, 1] - O['y']) / O['half'], np.zeros(len(p))], 1)

    return Garment('obi', MAT['obi'], 0.0024, (-0.28, 0.76, -0.25), (0.28, 1.3, 0.24), field, owners, 3600, tau=0.008, details=details)


# --------------------------------------------------------------------------------
# the hakama: loose charcoal trousers, very wide in the leg, pleated down the
# front, gathered and tied round his lower shins
# --------------------------------------------------------------------------------

HAKAMA = dict(
    waist=((0, 1.17, -0.002), (0.165, 0.08, 0.13)),
    hips=((0, 1.0, 0.012), (0.19, 0.14, 0.152)),
    leg=(0.116, 0.86, 0.142, 0.138, 0.5, 0.168),  # x, top, r top, x knee, y knee, r knee
    gather=(0.118, 0.33, 0.088),  # x, y, r: drawn in round the shin
    cuff=(0.115, 0.29, 0.318, 0.071),  # x, bottom, top, r
    top=1.24,
)


def hakama_prims():
    H = HAKAMA
    waist, hips = ellipsoid(*H['waist']), ellipsoid(*H['hips'])
    legs = []
    x0, y0, r0, xk, yk, rk = H['leg']
    gx, gy, gr = H['gather']
    cx, c0, c1, cr = H['cuff']
    for s, L in SIDES:
        upper = round_cone((s * x0, y0, 0.006), (s * xk, yk, 0.004), r0, rk)
        lower = round_cone((s * xk, yk, 0.004), (s * gx, gy + 0.02, 0.008), rk, gr)
        cuff = round_cone((s * cx, c0, 0.01), (s * cx, c1, 0.01), cr, cr)
        legs.append((upper, lower, cuff, s))
    return waist, hips, legs


def hakama_field(p, prims, ripple=True):
    waist, hips, legs = prims
    H = HAKAMA
    y = p[:, 1]
    sides = []
    for upper, lower, cuff, s in legs:
        d = smin(upper(p), lower(p), 0.08)
        if ripple:
            a = np.arctan2(p[:, 0] - s * H['leg'][3], p[:, 2])
            # puckers fanning up out of the gather, soft folds down the leg
            d = d + 0.005 * np.sin(a * 9) * smooth(0.3, 0.33, y) * smooth(0.46, 0.34, y)
            d = d + 0.0035 * np.sin(a * 5 + y * 8) * smooth(0.36, 0.5, y) * smooth(0.95, 0.75, y)
        d = smin(d, cuff(p), 0.016)
        sides.append(d)
    t = smin(waist(p), hips(p), 0.06)
    t = smin(t, np.minimum(sides[0], sides[1]), 0.07)
    if ripple:
        # the pleats: knife-pressed folds down the front of each leg
        az = np.arctan2(np.abs(p[:, 0]) - H['leg'][0] * 0.6, -p[:, 2])
        t = t + 0.0028 * np.sin(az * 7) * smooth(0.3, 0.6, np.cos(az)) * smooth(0.36, 0.6, y) * smooth(1.2, 1.0, y)
    # (the legs part below the seat)
    t = t + 0.005 * np.exp(-(p[:, 0] / 0.008) ** 2) * smooth(0.86, 0.8, y)
    t = smax(t, H['cuff'][1] - y, 0.004)
    return smax(t, y - H['top'], 0.008)


def g_hakama():
    prims = hakama_prims()
    waist, hips, legs = prims

    def field(p):
        return hakama_field(p, prims)

    owners = [(waist, by_y([(1.1, 'hips'), (1.2, 'spine')])), (hips, rigid('hips'))]
    for upper, lower, cuff, s in legs:
        L = 'L' if s < 0 else 'R'
        owners += [(upper, by_y([(0.5, 'shin' + L), (0.62, 'thigh' + L), (0.86, 'thigh' + L), (0.98, 'hips')])), (lower, by_y([(0.47, 'shin' + L), (0.58, 'thigh' + L)])), (cuff, rigid('shin' + L))]

    def details(p, n, own):
        # x: on a leg's cuff tie, y: angle round the leg (for the pleats)
        cuff = own[:, 4] + own[:, 7]
        return np.stack([cuff, np.arctan2(np.abs(p[:, 0]) - HAKAMA['leg'][0] * 0.6, -p[:, 2]), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('hakama', MAT['hakama'], 0.0036, (-0.36, 0.26, -0.25), (0.36, 1.26, 0.25), field, owners, 5600, tau=0.016, details=details)


# --------------------------------------------------------------------------------
# fur: his forearms out of the sleeves (bound in wraps), his lower legs below
# the hakama
# --------------------------------------------------------------------------------

WRAP = dict(u0=0.425, u1=0.59, lift=0.0055)


def arm_prims(s, L):
    S, E, W, d, out = arm_frame(s)
    upper = round_cone(S + 0.05 * d, E, 0.066, 0.056)
    fore = round_cone(E, W - 0.004 * d, 0.058, 0.043)
    # a heavy forearm: the muscle swelling below the elbow on the outside
    belly = ellipsoid(E + 0.085 * d + 0.012 * out - 0.004 * FW, (0.054, 0.085, 0.05), np.stack([out, d, np.cross(out, d)], 1))
    return S, d, upper, fore, belly


def forearm_field(p, s, L):
    S, d, upper, fore, belly = arm_prims(s, L)
    return smin(smin(upper(p), fore(p), 0.03), belly(p), 0.03)


def g_arms():
    parts, owners = [], []
    for s, L in SIDES:
        S, d, upper, fore, belly = arm_prims(s, L)
        parts.append((upper, fore, belly))
        owners += [(upper, by_axis(S, d, [(0.1, 'arm' + L)])), (fore, by_axis(S, d, [(UPPER_ARM - 0.03, 'arm' + L), (UPPER_ARM + 0.03, 'fore' + L), (UPPER_ARM + FOREARM - 0.02, 'fore' + L), (UPPER_ARM + FOREARM + 0.01, 'hand' + L)])), (belly, by_axis(S, d, [(UPPER_ARM - 0.03, 'arm' + L), (UPPER_ARM + 0.03, 'fore' + L)]))]
        # (the lower legs too: out of the hakama's gather to the ankle,
        # a strong calf behind)
        shin = round_cone((s * FOOT_X, 0.34, 0.006), (s * FOOT_X, ANKLE_Y + 0.012, 0.008), 0.058, 0.044)
        calf = ellipsoid((s * FOOT_X, 0.31, 0.024), (0.054, 0.075, 0.052))
        parts.append((shin, calf))
        owners += [(shin, by_y([(ANKLE_Y + 0.01, 'foot' + L), (ANKLE_Y + 0.05, 'shin' + L)])), (calf, rigid('shin' + L))]

    def field(p):
        out = np.full(len(p), 1.0)
        for ps in parts:
            out = np.minimum(out, soft_union(ps, p, 0.03))
        return out

    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        # x: down the arm (m from the shoulder; -1 on a leg)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        u = ((p - S) * d).sum(1)
        leg = p[:, 1] < 0.6
        return np.stack([np.where(leg, -1.0, u), np.zeros(len(p)), np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('arms', MAT['fur'], 0.0026, (-0.48, 0.06, -0.12), (0.48, 1.68, 0.12), field, owners, 3600, tau=0.012, details=details)


def g_wraps():
    """Reddish-brown cloth wound round each forearm from the wrist most of the
    way to the elbow, its turns a little proud (the shader draws them)."""
    W_ = WRAP
    parts, owners = [], []
    for s, L in SIDES:
        S, d, upper, fore, belly = arm_prims(s, L)

        def fn(p, s=s, L=L, S=S, d=d):
            u = (p - S) @ d
            f = forearm_field(p, s, L)
            # (each turn of the cloth a little ridge, spiralling round)
            S_, E_, W_a, d_, out = arm_frame(s)
            a = np.arctan2((p - S) @ np.cross(d_, out), (p - S) @ out)
            ridge = 0.0012 * np.cos((u * 70 + a / (2 * math.pi)) * 2 * math.pi)
            lift = W_['lift'] + 0.0025 * smooth(W_['u1'] - 0.03, W_['u1'], u) + ridge
            dd = f - lift
            return smax(dd, np.maximum(W_['u0'] - u, u - W_['u1']), 0.003)

        S_, E_, W_a, d_, out = arm_frame(s)
        prim = Prim(fn, np.minimum(S_ + W_['u0'] * d_, S_ + W_['u1'] * d_) - 0.09, np.maximum(S_ + W_['u0'] * d_, S_ + W_['u1'] * d_) + 0.09)
        parts.append(prim)
        owners.append((prim, by_axis(S, d, [(UPPER_ARM + 0.02, 'fore' + L), (UPPER_ARM + FOREARM - 0.02, 'fore' + L), (UPPER_ARM + FOREARM + 0.01, 'hand' + L)])))

    def field(p):
        return np.minimum(parts[0](p), parts[1](p))

    arms = [arm_frame(s) for s, _ in SIDES]

    def details(p, n, own):
        # x: down the arm, y: round it (rad)
        S = np.where(p[:, :1] < 0, arms[0][0], arms[1][0])
        d = np.where(p[:, :1] < 0, arms[0][3], arms[1][3])
        o = np.where(p[:, :1] < 0, arms[0][4], arms[1][4])
        q = p - S
        u = (q * d).sum(1)
        a = np.arctan2((q * np.cross(d, o)).sum(1), (q * o).sum(1))
        return np.stack([u, a, np.zeros(len(p)), np.zeros(len(p))], 1)

    return Garment('wraps', MAT['wrap'], 0.0016, (-0.46, 0.94, -0.09), (0.46, 1.22, 0.09), field, owners, 2800, tau=0.006, outline=0.6, details=details)


# --------------------------------------------------------------------------------
# hands and feet: big, furred, padded, dark-clawed
# --------------------------------------------------------------------------------


def grip_frame(s):
    """Where a handle runs through each fist, and which way (toward the thumb,
    which points forward with the arm hanging)."""
    S, E, W, dn, out = arm_frame(s)
    return W + 0.07 * dn - 0.034 * out, FW


def hand_parts(s, L):
    S, E, W, dn, out = arm_frame(s)
    R = np.stack([out, dn, FW], 1)
    A, up = grip_frame(s)
    inward = -out
    palm = round_box(W + 0.045 * dn - 0.004 * out, (0.022, 0.036, 0.044), 0.016, R)
    # the fingers curled round the grip: four of them, a knuckle each, their
    # tips tucked under toward the palm
    fingers, claws = [], []
    for k in range(4):
        z = (k - 1.5) * 0.0205
        k0 = A + 0.036 * out + 0.008 * dn - z * up
        k1 = A + 0.014 * out + 0.033 * dn - z * up
        k2 = A - 0.027 * out + 0.024 * dn - z * up
        k3 = A - 0.035 * out - 0.006 * dn - z * up
        r = 0.0128 - 0.0012 * abs(k - 1.5)
        fingers.append(stroke([k0, k1, k2, k3], [r, r * 0.98, r * 0.95, r * 0.88]))
        # (a dark claw at each fingertip, curving in toward the palm)
        tip = k3 - 0.004 * out
        claws.append(stroke([tip + 0.006 * dn, tip - 0.006 * out - 0.004 * dn, tip - 0.006 * out - 0.014 * dn], [0.0042, 0.003, 0.0008]))
    thumb = stroke([W + 0.03 * dn - 0.022 * out + 0.032 * up, A - 0.03 * out + 0.036 * up, A - 0.006 * out + 0.038 * up + 0.026 * dn], [0.015, 0.013, 0.011])
    tt = A - 0.006 * out + 0.038 * up + 0.026 * dn
    claws.append(stroke([tt, tt + 0.008 * dn + 0.004 * out, tt + 0.014 * dn + 0.002 * out], [0.0042, 0.003, 0.0008]))
    wrist = round_cone(W - 0.018 * dn, W + 0.016 * dn, 0.044, 0.04)
    return wrist, palm, fingers, thumb, claws


def g_hands():
    parts, owners = [], []
    for s, L in SIDES:
        wrist, palm, fingers, thumb, claws = hand_parts(s, L)
        S, E, W, dn, out = arm_frame(s)
        ps = [wrist, palm, thumb] + fingers
        parts.append(ps)
        owners += [(wrist, by_axis(W, dn, [(-0.012, 'fore' + L), (0.01, 'hand' + L)]))] + [(q, rigid('hand' + L)) for q in ps[1:]]

    def field(p):
        out = np.full(len(p), 1.0)
        for ps in parts:
            d = smin(ps[0](p), ps[1](p), 0.018)
            d = smin(d, ps[2](p), 0.012)
            for q in ps[3:]:
                d = smin(d, q(p), 0.007)
            out = np.minimum(out, d)
        # (a handle's way through each fist)
        for s, _ in SIDES:
            A, up = grip_frame(s)
            out = smax(out, -round_cone(A - 0.09 * up, A + 0.09 * up, 0.0158, 0.0158)(p), 0.003)
        return out

    return Garment('hands', MAT['hand'], 0.0016, (-0.5, 0.82, -0.1), (0.5, 1.06, 0.1), field, owners, 3400, tau=0.006)


def foot_parts(s, L):
    bx = s * FOOT_X
    ankle = ellipsoid((bx, 0.105, 0.012), (0.046, 0.05, 0.05))
    heel = ellipsoid((bx, 0.045, 0.05), (0.046, 0.045, 0.05))
    mid = ellipsoid((bx, 0.046, -0.055), (0.058, 0.043, 0.09))
    toes, claws = [], []
    for k in range(4):
        x = bx + (k - 1.5) * 0.026 + s * 0.004
        z = -0.152 - 0.012 * (1 - abs(k - 1.5) / 1.5)
        toes.append(ellipsoid((x, 0.028, z), (0.0165, 0.026, 0.03)))
        claws.append(stroke([V(x, 0.03, z - 0.022), V(x, 0.022, z - 0.034), V(x, 0.008, z - 0.04)], [0.0055, 0.0035, 0.001]))
    dew = ellipsoid((bx - s * 0.048, 0.06, -0.035), (0.012, 0.016, 0.016))
    return ankle, heel, mid, toes, claws, dew


def g_feet():
    """Big bare paws, long and broad: a heavy heel, a broad pad under the ball
    of the foot, four thick toes in front, the striped fur of his shins
    running down onto them."""
    parts, owners = [], []
    for s, L in SIDES:
        ankle, heel, mid, toes, claws, dew = foot_parts(s, L)
        bx = s * FOOT_X

        def fn(p, ankle=ankle, heel=heel, mid=mid, toes=toes, dew=dew):
            d = smin(heel(p), mid(p), 0.04)
            d = smin(d, ankle(p), 0.035)
            for q in toes:
                d = smin(d, q(p), 0.012)
            d = smin(d, dew(p), 0.01)
            # flat underneath
            return smax(d, -p[:, 1], 0.008)

        foot = Prim(fn, (bx - 0.09, -0.02, -0.22), (bx + 0.09, 0.17, 0.12))
        parts.append(foot)
        owners.append((foot, along(lambda p: p[:, 2], [(-0.125, 'toe' + L), (-0.095, 'foot' + L)])))

    def field(p):
        return np.minimum(parts[0](p), parts[1](p))

    def details(p, n, own):
        # x: the pads underneath, y: across the toes, z: on the toes
        x = p[:, 0] - np.sign(p[:, 0]) * FOOT_X
        pad = smooth(0.012, 0.004, p[:, 1])
        return np.stack([pad, x / 0.026, smooth(-0.125, -0.14, p[:, 2]), np.zeros(len(p))], 1)

    return Garment('feet', MAT['foot'], 0.002, (-0.25, -0.01, -0.23), (0.25, 0.17, 0.13), field, owners, 3600, tau=0.01, details=details)


def g_claws():
    """Dark claws: one small garment for each hand and each foot (one box
    round them all would be most of him, at a claw's fine grain)."""
    out = []
    for s, L in SIDES:
        for kind, bone_, parts in (('hand', 'hand' + L, hand_parts(s, L)[4]), ('foot', 'toe' + L, foot_parts(s, L)[4])):
            U = union(parts)
            out.append(Garment('claws' + kind[0] + L, MAT['claw'], 0.0009, U.lo - 0.006, U.hi + 0.006, U, [(q, rigid(bone_)) for q in parts], 320, tau=0.003, outline=0.55))
    return out


# --------------------------------------------------------------------------------
# the tail: long and thick, out from under the back of the kimono's skirt,
# hanging in a long curve to the road and curling up at its end (the game
# swings it on a chain of bones)
# --------------------------------------------------------------------------------

TAIL_PTS = [V(0, 0.985, 0.13), V(0, 0.93, 0.27), V(0.0, 0.8, 0.385), V(-0.006, 0.62, 0.45), V(-0.016, 0.43, 0.47), V(-0.03, 0.26, 0.45), V(-0.05, 0.13, 0.4), V(-0.08, 0.075, 0.31), V(-0.1, 0.09, 0.22)]
TAIL_BONES = 9
TAIL_R = (0.052, 0.04)


def catmull(pts, step):
    """A smooth curve through points, sampled every `step` m: points, arc lengths."""
    P = [pts[0] * 2 - pts[1]] + list(pts) + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        n = max(2, int(np.linalg.norm(p2 - p1) / (step * 0.25)))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    out = np.array(out)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(out, axis=0), axis=1))])
    ss = np.arange(0, s[-1], step)
    ss = np.append(ss, s[-1])
    c = np.stack([np.interp(ss, s, out[:, k]) for k in range(3)], 1)
    return c, ss


TAIL_C, TAIL_S = catmull(TAIL_PTS, 0.004)
TAIL_L = float(TAIL_S[-1])
# the joints: evenly down its length (the first at its root)
TAIL_J = [float(x) for x in np.linspace(0, TAIL_L * 0.94, TAIL_BONES)]


def tail_point(s):
    return np.array([np.interp(s, TAIL_S, TAIL_C[:, k]) for k in range(3)])


TAIL_TREE = cKDTree(TAIL_C)


def tail_near(p):
    """Each point's distance to the tail's centreline, and the arc length
    of the nearest point on it (sampled every few mm: near enough exact)."""
    d, i = TAIL_TREE.query(p)
    return d, TAIL_S[i]


def tail_param(p):
    return tail_near(p)[1]


def tail_radius(s):
    t = s / TAIL_L
    # full at its root, a little thinner down its length, a tuft swelling at
    # the end before it rounds off
    return TAIL_R[0] + (TAIL_R[1] - TAIL_R[0]) * t + 0.006 * smooth(0.8, 0.93, t) * (1 - smooth(0.96, 1.0, t))


def g_tail():
    def body_fn(p):
        d, s = tail_near(p)
        return d - tail_radius(s)

    body = Prim(body_fn, TAIL_C.min(0) - 0.07, TAIL_C.max(0) + 0.07)
    rnd = np.random.default_rng(31)
    # the tip's fur in a few soft tufts
    tufts = []
    e = TAIL_C[-1]
    dtip = unit(TAIL_C[-1] - TAIL_C[-12])
    for k in range(5):
        a = 2 * math.pi * k / 5 + rnd.uniform(-0.3, 0.3)
        side = unit(np.cross(dtip, V(math.cos(a), math.sin(a), 0.3)))
        tufts.append(stroke([e - 0.03 * dtip, e + 0.006 * dtip + 0.016 * side, e + 0.02 * dtip + 0.03 * side], [0.016, 0.01, 0.003]))

    def field(p):
        dc, s = tail_near(p)
        d = dc - tail_radius(s)
        # (fur: soft grooves running down it)
        d = d + 0.0016 * np.sin(np.arctan2(p[:, 0], p[:, 2] - 0.3) * 9 + s * 40)
        for q in tufts:
            d = smin(d, q(p), 0.01)
        return d

    names = [f'tail{k}' for k in range(TAIL_BONES)]

    def weights(p):
        s = tail_param(p)
        W = []
        J = TAIL_J
        for k, b in enumerate(names):
            a0 = J[k]
            a1 = J[k + 1] if k + 1 < len(J) else 1e9
            seg = (J[1] - J[0])
            h = 0.3 * seg
            up = smooth(a0 - h, a0 + h, s) if k > 0 else np.ones(len(p))
            down = 1 - smooth(a1 - h, a1 + h, s) if k + 1 < len(J) else np.ones(len(p))
            W.append((IDX[b], up * down))
        # (its root is held by the hips)
        root = 1 - smooth(0.0, 0.05, s)
        W = [(i, w * (1 - root)) for i, w in W]
        W.append((IDX['hips'], root))
        return W

    owners = [(body, weights)] + [(q, rigid(names[-1])) for q in tufts]

    def details(p, n, own):
        # x: arc length down it (m), y: 0..1 down it, z: angle round it
        s = tail_param(p)
        return np.stack([s, s / TAIL_L, np.arctan2(p[:, 0], p[:, 2] - 0.3), np.zeros(len(p))], 1)

    lo = TAIL_C.min(0) - 0.08
    hi = TAIL_C.max(0) + 0.08
    return Garment('tail', MAT['tail'], 0.0026, lo, hi, field, owners, 3600, tau=0.01, details=details)


# --------------------------------------------------------------------------------
# the katana and its scabbard
# --------------------------------------------------------------------------------


def g_saya():
    R = SAYA['R']
    loc = saya_local()
    sa = placed(loc, R, SAYA['mouth'])

    def details(p, n, own):
        # its own coordinates (across, along, edge-wards)
        q = (p - SAYA['mouth']) @ R
        return np.concatenate([q, np.zeros((len(p), 1))], 1)

    def mats(p, n, own):
        q = (p - SAYA['mouth']) @ R
        gold = (q[:, 1] < 0.022) | (q[:, 1] > SAYA['length'] - 0.03)
        return np.where(gold, MAT['gold'], MAT['saya'])

    return Garment('saya', MAT['saya'], 0.0018, sa.lo - 0.02, sa.hi + 0.02, sa, [(sa, rigid('saya'))], 2200, tau=0.004, outline=0.75, details=details, mats=mats)


def g_cord():
    """The scabbard's cord: from the knob on its side, up and tucked over
    the obi."""
    R = SAYA['R']
    kn = SAYA['mouth'] + R @ V(SAYA['half'][0] + 0.004, 0.085, 0.004)
    cord = stroke([kn, kn + V(0.008, 0.05, -0.028), V(-0.2, 1.262, -0.13), V(-0.178, 1.214, -0.158)], [0.0042, 0.0042, 0.0042, 0.0042])
    return Garment('cord', MAT['obi'], 0.0014, cord.lo - 0.01, cord.hi + 0.01, cord, [(cord, rigid('saya'))], 500, tau=0.004, outline=0.6)


def g_katana():
    R, grip = sword_bind()
    loc = katana_local()
    kt = placed(loc, R, grip)

    def details(p, n, own):
        # the sword's own coordinates (x its flat, y along it, z toward its
        # edge), and which part (0 hilt, 1 gold, 2 blade)
        q = (p - grip) @ R
        return np.concatenate([q, katana_part(q)[:, None].astype(float)], 1)

    def mats(p, n, own):
        q = (p - grip) @ R
        k = katana_part(q)
        return np.where(k == 2, MAT['blade'], np.where(k == 1, MAT['gold'], MAT['hilt']))

    return Garment('katana', MAT['hilt'], 0.0012, kt.lo - 0.01, kt.hi + 0.01, kt, [(kt, rigid('sword'))], 3400, tau=0.004, outline=0.6, details=details, mats=mats)


def g_blade():
    R, grip = sword_bind()
    v, n, f = blade_mesh()
    W = np.zeros((len(v), len(BONES)))
    W[:, IDX['sword']] = 1
    det = np.concatenate([v, np.full((len(v), 1), 2.0)], 1)
    g = MeshGarment('blade', MAT['blade'], v @ R.T + grip, n @ R.T, f, W, det, outline=0.45)
    return g


# --------------------------------------------------------------------------------
# skeleton, colliders, export
# --------------------------------------------------------------------------------

# (neighbours within one garment take consecutive ids: the shader interpolates
# the id across a triangle, so a jump between them would pass through others)
MAT = dict(face=1, nose=2, ear=3, kimono=4, fur=5, hakama=6, obi=7, wrap=8, hand=9, foot=10, tail=11, claw=12, saya=13, gold=14, hilt=15, blade=16)

# springy bits on the head, as the game's shared runner swings them (see
# hairSim in src/game/player.js): [bone, unit direction, stiffness Hz,
# damping, push, limit] - the samurai's own code twitches them now and then
HAIR_BONES = [
    ('earL', V(-0.35, 1, 0.1), dict(f=4.2, z=0.2, k=0.7, lim=0.25)),
    ('earR', V(0.35, 1, 0.1), dict(f=4.4, z=0.2, k=0.7, lim=0.25)),
]


def build_rig():
    bone('body', None, (0, 0, 0))
    bone('hips', 'body', (0, HIP_Y, 0))
    bone('spine', 'hips', (0, 0.12, 0))
    bone('chest', 'spine', (0, CHEST_Y - HIP_Y - 0.12, 0))
    bone('neck', 'chest', (0, NECK_Y - CHEST_Y, 0))
    bone('head', 'neck', (0, HEAD_Y - NECK_Y, 0))
    hy = V(0, HEAD_Y, 0)
    for s, L in SIDES:
        R, c = ear_frame(s)
        bone('ear' + L, 'head', c - 0.03 * (R @ V(0, 1, 0)) - hy)
    for s, L in SIDES:
        bone('clav' + L, 'chest', (s * 0.055, SHOULDER[1] - CHEST_Y, 0))
        bone('arm' + L, 'clav' + L, (s * (SHOULDER[0] - 0.055), 0, 0), (0, 0, 1), s * ARM_REST)
        bone('fore' + L, 'arm' + L, (0, -UPPER_ARM, 0))
        bone('hand' + L, 'fore' + L, (0, -FOREARM, 0))
        bone('thigh' + L, 'hips', (s * HIP_JOINT[0], HIP_JOINT[1] - HIP_Y, 0))
        bone('shin' + L, 'thigh' + L, (0, -THIGH, 0))
        bone('foot' + L, 'shin' + L, (0, -SHIN, 0))
        bone('toe' + L, 'foot' + L, (0, -TOE[0], -TOE[1]))
    # the tail: a chain down it from its root
    prev = 'hips'
    prevP = V(0, HIP_Y, 0)
    for k, sj in enumerate(TAIL_J):
        P = tail_point(sj)
        bone(f'tail{k}', prev, P - prevP)
        prev, prevP = f'tail{k}', P
    # the obi's two hanging ends: three joints down each
    for T in OBI_TAILS:
        prev, prevP = 'hips', V(0, HIP_Y, 0)
        for k in range(3):
            P = T['pts'][k]
            bone(T['name'] + str(k), prev, P - prevP)
            prev, prevP = T['name'] + str(k), P
    # the scabbard, through the obi
    bone_frame('saya', 'hips', SAYA['mouth'], SAYA['R'])
    bone('sim', None, (0, 0, 0))
    R, grip = sword_bind()
    bone_frame('sword', 'sim', grip, R)


def cap(bone_, a, b, ra, rb):
    """A capsule collider (bind space) on a bone."""
    return dict(kind='cap', bone=bone_, a=lst(a), b=lst(b), ra=ra, rb=rb)


def colliders():
    """What the tail and the obi's ends are kept off: his legs in the hakama,
    his seat, his back, his lower legs; and the scabbard."""
    out = []
    H = HAKAMA
    for s, L in SIDES:
        out.append(cap('thigh' + L, (s * 0.12, 0.9, 0.0), (s * 0.135, 0.55, 0.0), 0.15, 0.16))
        out.append(cap('shin' + L, (s * 0.135, 0.53, 0.0), (s * 0.118, 0.33, 0.005), 0.15, 0.085))
        out.append(cap('shin' + L, (s * FOOT_X, 0.32, 0.01), (s * FOOT_X, 0.12, 0.01), 0.06, 0.048))
    out.append(dict(kind='ell', bone='hips', c=lst(H['hips'][0]), r=lst(V(*H['hips'][1]) + 0.012)))
    out.append(dict(kind='ell', bone='spine', c=[0, 1.3, 0.0], r=[0.2, 0.16, 0.15]))
    out.append(dict(kind='ell', bone='chest', c=[0, 1.47, 0.0], r=[0.22, 0.17, 0.15]))
    out.append(cap('saya', SAYA['mouth'], SAYA['mouth'] + SAYA['length'] * SAYA['dir'], 0.025, 0.022))
    return out


def build():
    t0 = time.time()
    build_rig()
    garments = [g_head(), g_ears(), g_kimono(), g_obi(), g_hakama(), g_arms(), g_wraps(), g_hands(), g_feet(), *g_claws(), g_tail(), g_saya(), g_cord(), g_katana(), g_blade()]
    only = os.environ.get('ONLY')
    if only:
        garments = [g for g in garments if g.name in only.split(',')]
    gripL, _ = grip_frame(-1)
    gripR, _ = grip_frame(1)
    Rs, gs = sword_bind()
    rig = dict(
        hipY=HIP_Y, hipJoint=list(HIP_JOINT), thigh=THIGH, shin=SHIN, toe=list(TOE), chestY=CHEST_Y, headY=HEAD_Y,
        shoulder=list(SHOULDER), upperArm=UPPER_ARM, forearm=FOREARM, armRest=ARM_REST, kneeY=KNEE_Y,
        hair=[dict(name=n, dir=lst(unit(d)), **k) for n, d, k in HAIR_BONES],
        cran=[list(CRAN[0]), list(CRAN[1])], nose=list(NOSE['c']), footX=FOOT_X,
        # each fist's grip (bind space: where a handle runs through it; its
        # axis is -z, toward the thumb)
        grip=dict(L=lst(gripL), R=lst(gripR)),
        # the scabbard: its mouth, which way it runs in, its length; the
        # sword: where its grip sits sheathed, how far the guard is from the
        # grip, where the second hand holds it, how long it is to the tip
        saya=dict(mouth=lst(SAYA['mouth']), dir=lst(SAYA['dir']), up=lst(SAYA['R'][:, 2]), length=SAYA['length']),
        katana=dict(grip=lst(gs), guard=KATANA['guard'], grip2=KATANA['grip2'], tip=KATANA['tip'], pommel=KATANA['pommel'], sheathed=SHEATHED),
        tail=dict(bones=[f'tail{k}' for k in range(TAIL_BONES)], pts=[lst(tail_point(s)) for s in TAIL_J] + [lst(TAIL_C[-1])], r=list(TAIL_R)),
        obi=[dict(bones=[T['name'] + str(k) for k in range(3)], pts=[lst(q) for q in T['pts']]) for T in OBI_TAILS],
        colliders=colliders(),
        wrap=[WRAP['u0'], WRAP['u1']], hem=KIMONO['hem'], sleeve=KIMONO['sleeve'], obiY=OBI['y'], cuff=list(HAKAMA['cuff']),
    )
    B.export(garments, OUT, MAT, rig, 'samurai', 'samurai.py')
    print(f'samurai: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    build()
