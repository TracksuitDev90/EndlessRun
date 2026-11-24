"""Real hands for the human runners: a palm with its pads, its knuckles and
the ridges of its bones; four fingers of three bones each and a thumb of
three, sculpted the way build.py sculpts everything (volumes blended into one
surface) in whatever shape the hand is bound in - hanging relaxed, or already
round whatever it holds - and skinned to a bone per phalanx, so the game can
curl, spread and grip them into any shape it likes (src/game/hands.js).

A hand is laid out in its own frame: W the wrist joint, a along the hand
(toward the fingertips), d out of its back (dorsal) and r toward the thumb
(radial). A left hand and a right hand are mirror images by construction:
each side passes its own frame. Lengths below are fractions of the hand's
length (the wrist joint to the tip of the middle finger, laid straight);
`size` makes them metres.

Every digit is a hinge chain: its first bone turns on two axes (spread,
across the palm; and flex, its knuckle bending), the next two on the flex
axis alone. The bind pose is given as angles (spread, knuckle, middle joint,
end joint; for the thumb: opposition, its base joint, knuckle, end joint),
and those angles, the axes and the bones go to the game with the rig, so a
shape there is the same four angles a digit and the game turns each bone by
how far that is from how it was bound.

Used by build.py (the wayfarer), explorer.py, elder.py and skater.py.
"""

import math

import numpy as np

import build as B
from build import V, smin, smax, smooth, ellipsoid, round_cone, round_box, Prim, rigid, by_axis, along

# The fingers: name, knuckle (u along the hand, w across it toward the
# thumb), the three phalanges' lengths, radius at the knuckle and at the
# tip, and how far each fans out when the hand is at rest (radians, +
# toward the thumb). The middle finger reaches to u = 1.
FINGERS = [
    dict(name='index', u=0.47, w=0.15, L=(0.205, 0.125, 0.105), r=(0.055, 0.042), splay=0.1),
    dict(name='middle', u=0.5, w=0.05, L=(0.228, 0.146, 0.112), r=(0.058, 0.044), splay=0.0),
    dict(name='ring', u=0.48, w=-0.048, L=(0.21, 0.136, 0.108), r=(0.054, 0.041), splay=-0.09),
    dict(name='pinky', u=0.43, w=-0.142, L=(0.162, 0.1, 0.094), r=(0.047, 0.036), splay=-0.21),
]
# The thumb: its base joint (u, v up out of the back, w), the three bones'
# lengths, its radii at the base, the knuckle, the end joint and the tip;
# the way it points at rest (a, d, r), and the way its pad faces (it curls
# that way).
THUMB = dict(cmc=(0.11, -0.03, 0.14), L=(0.21, 0.155, 0.135), r=(0.072, 0.062, 0.054, 0.044), dir=(0.7, -0.34, 0.6), pad=(0.15, -0.75, -0.55))

# Shapes as angles: a finger (spread, knuckle, middle joint, end joint); the
# thumb (opposition, base, knuckle, end). RELAXED is how a hand hangs.
RELAXED = dict(
    fingers=[(0.0, 0.26, 0.4, 0.2), (0.0, 0.31, 0.47, 0.24), (0.0, 0.37, 0.53, 0.27), (0.0, 0.44, 0.58, 0.3)],
    thumb=(0.32, 0.1, 0.18, 0.2),
)

NAMES = ['f0', 'f1', 'f2', 'f3', 'f4']  # index, middle, ring, pinky, thumb


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def rot(axis, ang):
    """Rotation matrix about a unit axis (world)."""
    x, y, z = unit(axis)
    c, s = math.cos(ang), math.sin(ang)
    C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


class Hand:
    """One hand: its frame, its size and the shape it's sculpted in.

    side: -1 left, 1 right; L: 'L' or 'R' (its bones are named for it)
    W, a, d, r: the wrist joint and the hand's frame (see above)
    size: its length (m)
    pose: the bind shape (see RELAXED); fingers may be left out
    slim: the fingers' thickness; knuckles: how big the knuckles stand
    palm: the palm's thickness
    """

    def __init__(self, side, L, W, a, d, r, size, pose=None, slim=1.0, knuckles=1.0, palm=1.0, wrist=1.0):
        self.side, self.L = side, L
        self.W = V(*W)
        self.a, self.d = unit(a), unit(d)
        # (r kept square to the other two)
        r = unit(r)
        r = unit(r - (r @ self.a) * self.a - (r @ self.d) * self.d)
        self.r = r
        self.k = size
        self.pose = pose or RELAXED
        self.slim, self.knuckles, self.palmK, self.wristK = slim, knuckles, palm, wrist
        self.lay()

    def at(self, u, v=0.0, w=0.0):
        """A point in the hand's frame (fractions of its length)."""
        k = self.k
        return self.W + k * (u * self.a + v * self.d + w * self.r)

    def lay(self):
        """Lay out every digit in the bind pose: its joints, its axes."""
        a, d, r = self.a, self.d, self.r
        # spreading turns a digit toward the thumb (about the palm's normal);
        # flexing turns it toward the palm
        m = unit(np.cross(a, r))
        h = unit(np.cross(a, -d))
        self.digits = []
        for i, F in enumerate(FINGERS):
            sp, mcp, pip, dip = self.pose['fingers'][i]
            R1 = rot(m, F['splay'] + sp) @ rot(h, mcp)
            R2 = R1 @ rot(h, pip)
            R3 = R2 @ rot(h, dip)
            P0 = self.at(F['u'], 0.0, F['w'])
            Ls = [x * self.k for x in F['L']]
            r0, r1 = F['r'][0] * self.k * self.slim, F['r'][1] * self.k * self.slim
            # (the tip's round end reaches out past its last joint)
            P1 = P0 + Ls[0] * (R1 @ a)
            P2 = P1 + Ls[1] * (R2 @ a)
            P3 = P2 + (Ls[2] - r1) * (R3 @ a)
            tot = Ls[0] + Ls[1] + Ls[2]
            rad = [r0, r0 + (r1 - r0) * Ls[0] / tot, r0 + (r1 - r0) * (Ls[0] + Ls[1]) / tot, r1]
            self.digits.append(dict(name=NAMES[i], pts=[P0, P1, P2, P3], rad=rad, spread=m, flex=R1 @ h, bind=[sp, mcp, pip, dip], dirs=[R1 @ a, R2 @ a, R3 @ a]))
        T = THUMB
        opp, cmc, mcp, ip = self.pose['thumb']
        t0 = unit(T['dir'][0] * a + T['dir'][1] * d + T['dir'][2] * r)
        pad = T['pad'][0] * a + T['pad'][1] * d + T['pad'][2] * r
        pad = unit(pad - (pad @ t0) * t0)
        ht = unit(np.cross(t0, pad))
        # (opposition swings it round in front of the palm: about the hand's
        # length, turning the thumb's side toward the palm)
        o = unit(np.cross(r, -d))
        R1 = rot(o, opp) @ rot(ht, cmc)
        R2 = R1 @ rot(ht, mcp)
        R3 = R2 @ rot(ht, ip)
        P0 = self.at(*T['cmc'])
        Ls = [x * self.k for x in T['L']]
        rad = [x * self.k * self.slim for x in T['r']]
        P1 = P0 + Ls[0] * (R1 @ t0)
        P2 = P1 + Ls[1] * (R2 @ t0)
        P3 = P2 + (Ls[2] - rad[3]) * (R3 @ t0)
        self.digits.append(dict(name=NAMES[4], pts=[P0, P1, P2, P3], rad=rad, spread=o, flex=R1 @ ht, bind=[opp, cmc, mcp, ip], dirs=[R1 @ t0, R2 @ t0, R3 @ t0], thumb=True))

    # --- bones ------------------------------------------------------------------
    def add_bones(self):
        """Register the fifteen bones under the hand's bone (after it exists:
        their positions are taken in its frame as it's bound)."""
        hand = 'hand' + self.L
        for D in self.digits:
            parent = hand
            for j in range(3):
                name = f"{D['name']}{'abc'[j]}{self.L}"
                Mp = B.BONES[B.IDX[parent]]['world']
                p = Mp[:3, :3].T @ (D['pts'][j] - Mp[:3, 3])
                B.bone(name, parent, p)
                parent = name

    def rig(self):
        """What the game needs to pose them: per digit its bones, its axes in
        the hand's own frame (as bound) and the angles it was bound at."""
        Rh = B.BONES[B.IDX['hand' + self.L]]['world'][:3, :3]
        out = []
        for D in self.digits:
            out.append(dict(
                bones=[f"{D['name']}{'abc'[j]}{self.L}" for j in range(3)],
                spread=[round(float(x), 5) for x in Rh.T @ D['spread']],
                flex=[round(float(x), 5) for x in Rh.T @ unit(D['flex'])],
                bind=[round(float(x), 4) for x in D['bind']],
            ))
        return dict(side=self.L, digits=out, size=round(self.k, 4))

    # --- the surface ------------------------------------------------------------
    def digit_prim(self, D):
        """A digit: three tapering bones, a little fuller at each joint."""
        P, rad = D['pts'], D['rad']
        bulge = 1 + 0.07 * self.knuckles
        segs = [round_cone(P[0], P[1], rad[0], rad[1] * bulge), round_cone(P[1], P[2], rad[1] * bulge, rad[2] * bulge), round_cone(P[2], P[3], rad[2] * bulge * 0.98, rad[3])]
        lo = np.min([q.lo for q in segs], axis=0)
        hi = np.max([q.hi for q in segs], axis=0)

        def fn(p):
            d = segs[0].fn(p)
            d = smin(d, segs[1].fn(p), rad[2] * 0.25)
            return smin(d, segs[2].fn(p), rad[3] * 0.25)

        return Prim(fn, lo, hi), segs

    def digit_weights(self, D, segs):
        """Skin weights along a digit: the hand's at its root, each bone's
        along its own length, blended across every joint."""
        P = D['pts']
        Ls = [np.linalg.norm(P[j + 1] - P[j]) for j in range(3)]
        cum = [0.0, Ls[0], Ls[0] + Ls[1]]
        names = [f"{D['name']}{'abc'[j]}{self.L}" for j in range(3)]
        hand = 'hand' + self.L

        def s_of(p):
            # how far along the digit: on whichever of its bones is nearest
            best = np.full(len(p), np.inf)
            s = np.zeros(len(p))
            for j in range(3):
                ab = P[j + 1] - P[j]
                t = np.clip(((p - P[j]) @ ab) / (ab @ ab), 0, 1)
                q = P[j] + t[:, None] * ab
                dist = np.linalg.norm(p - q, axis=1)
                use = dist < best
                best = np.where(use, dist, best)
                s = np.where(use, cum[j] + t * Ls[j], s)
            # (behind its root, back into the palm)
            ab = P[1] - P[0]
            back = ((p - P[0]) @ ab) / np.linalg.norm(ab)
            return np.where(back < 0, back, s)

        bw = [D['rad'][0] * 0.9, D['rad'][1] * 0.75, D['rad'][2] * 0.7]
        ctrl = [(-bw[0], hand), (bw[0] * 0.6, names[0]), (cum[1] - bw[1], names[0]), (cum[1] + bw[1] * 0.6, names[1]), (cum[2] - bw[2], names[1]), (cum[2] + bw[2] * 0.6, names[2])]
        return along(s_of, ctrl)

    def parts(self):
        """The volumes of the hand, each with the bones that move it:
        [(prim, weights)], and the field that blends them."""
        k = self.k
        a, d, r = self.a, self.d, self.r
        R = np.stack([a, d, r], 1)  # columns: the hand's axes in the world
        pk = self.palmK
        hand = rigid('hand' + self.L)
        out = []
        # the palm: a soft slab, wider at the knuckles than at the wrist, the
        # back of the hand ridged over its bones
        slab = round_box(self.at(0.27, -0.008, 0.0), (0.2 * k, 0.05 * k * pk, 0.165 * k), 0.048 * k * pk, R)
        heel = round_box(self.at(0.1, -0.004, 0.0), (0.1 * k, 0.055 * k * pk, 0.13 * k), 0.05 * k * pk, R)
        bones = []
        for F in FINGERS:
            P0 = self.at(F['u'] - 0.01, 0.006, F['w'])
            bones.append(round_cone(self.at(0.08, 0.012, F['w'] * 0.55), P0, 0.045 * k * pk, F['r'][0] * k * self.slim * (1.0 + 0.12 * self.knuckles)))
        # the pads: the ball of the thumb and the heel under the little finger
        thenar = ellipsoid(self.at(0.2, -0.045 * pk, 0.11), (0.16 * k, 0.07 * k * pk, 0.095 * k), R @ np.array([[math.cos(0.5), 0, -math.sin(0.5)], [0, 1, 0], [math.sin(0.5), 0, math.cos(0.5)]]))
        hypo = ellipsoid(self.at(0.25, -0.04 * pk, -0.12), (0.19 * k, 0.055 * k * pk, 0.07 * k), R)
        # the wrist, into the forearm
        wk = self.wristK
        wrist = round_box(self.at(-0.02, 0.0, 0.0), (0.09 * k, 0.07 * k * wk, 0.12 * k * wk), 0.065 * k * wk, R)
        self.palm_prims = [slab, heel] + bones + [thenar, hypo]
        self.wrist = wrist
        for q in [slab, heel] + bones + [hypo]:
            out.append((q, hand))
        out.append((wrist, by_axis(self.W, a, [(-0.04 * k, 'fore' + self.L), (0.06 * k, 'hand' + self.L)])))
        thumb = self.digits[4]
        # (the ball of the thumb goes with it as it swings across the palm)
        t1 = thumb['pts'][1] - thumb['pts'][0]
        out.append((thenar, by_axis(thumb['pts'][0], unit(t1), [(-0.02 * k, 'hand' + self.L), (np.linalg.norm(t1) * 0.85, f"f4a{self.L}")])))
        self.digit_prims = []
        for D in self.digits:
            prim, segs = self.digit_prim(D)
            self.digit_prims.append(prim)
            out.append((prim, self.digit_weights(D, segs)))
        return out

    def field(self, p):
        """The whole hand (call parts() first)."""
        k = self.k
        d = self.palm_prims[0](p)
        for q in self.palm_prims[1:]:
            d = smin(d, q(p), 0.02 * k)
        d = smin(d, self.wrist(p), 0.05 * k)
        for i, q in enumerate(self.digit_prims):
            # (the webs between the fingers; the thumb's web wider)
            d = smin(d, q(p), (0.045 if i == 4 else 0.028) * k)
        return d

    def box(self, pad=0.02):
        """A box round the whole hand (and its wrist)."""
        pts = [self.W - 0.15 * self.k * self.a] + [q for D in self.digits for q in D['pts']]
        pts += [self.at(0.3, 0.1, 0.2), self.at(0.3, -0.12, -0.2), self.at(0.0, 0.12, 0.18), self.at(0.0, -0.12, -0.18)]
        pts = np.array(pts)
        return pts.min(0) - pad, pts.max(0) + pad


def wrap(hand_args, centre, axis, radius, which=range(4), thumb=None, **look):
    """The bind angles that close each finger round a cylinder (centre, its
    axis, its radius) - for a hand sculpted holding something: each finger's
    knuckle, middle and end joints picked so its pad lies on the cylinder.
    hand_args: what Hand() takes, but the pose (look: its slim etc.).
    Returns a pose."""
    pose = {'fingers': [list(f) for f in RELAXED['fingers']], 'thumb': list(RELAXED['thumb'])}
    centre, axis = V(*centre), unit(axis)
    grid = np.linspace(0.0, 1.9, 39)
    for i in which:
        best, arg = np.inf, None
        for m in grid:
            for pp in np.linspace(0.2, 1.9, 35):
                for dd in (pp * 0.55, pp * 0.7):
                    pose['fingers'][i] = [0.0, m, pp, dd]
                    H = Hand(*hand_args, pose=pose, **look)
                    D = H.digits[i]
                    # every point along the pad should sit at the radius
                    err = 0.0
                    for j in range(3):
                        for t in (0.35, 0.7, 1.0):
                            q = D['pts'][j] + t * (D['pts'][j + 1] - D['pts'][j])
                            rr = D['rad'][j] + t * (D['rad'][j + 1] - D['rad'][j])
                            v = q - centre
                            v = v - (v @ axis) * axis
                            e = np.linalg.norm(v) - (radius + rr * 0.92)
                            err += e * e * (3.0 if e < 0 else 1.0)
                    if err < best:
                        best, arg = err, [0.0, m, pp, dd]
        pose['fingers'][i] = arg
    if thumb is not None:
        pose['thumb'] = list(thumb)
    return pose


def clasp(hand_args, pose, inside, target, grids=None, **look):
    """The thumb's bind angles that bring its tip to `target` (a point)
    without any of it passing through what's held - `inside(p)`: how far
    inside the held thing a point is (> 0 inside). For a hand sculpted
    holding something flat (the explorer's sketchbook): the thumb round its
    edge onto the far face. Returns the pose with its thumb set."""
    pose = {'fingers': [list(f) for f in pose['fingers']], 'thumb': list(pose['thumb'])}
    target = V(*target)
    g = grids or [np.linspace(-1.2, 1.2, 17), np.linspace(-0.6, 0.9, 11), np.linspace(-0.2, 1.6, 13), np.linspace(0.0, 1.3, 11)]
    best, arg = np.inf, None
    for o in g[0]:
        for c in g[1]:
            for m in g[2]:
                for i in g[3]:
                    pose['thumb'] = [o, c, m, i]
                    H = Hand(*hand_args, pose=pose, **look)
                    D = H.digits[4]
                    pts, rad = D['pts'], D['rad']
                    err = float(np.sum((pts[3] - target) ** 2)) * 1e4
                    for j in range(3):
                        for t in (0.0, 0.25, 0.5, 0.75, 1.0):
                            q = pts[j] + t * (pts[j + 1] - pts[j])
                            rr = rad[j] + t * (rad[j + 1] - rad[j])
                            pen = inside(q[None])[0] + rr * 0.85
                            if pen > 0:
                                err += pen * pen * 4e5
                    if err < best:
                        best, arg = err, [float(o), float(c), float(m), float(i)]
    pose['thumb'] = arg
    return pose
