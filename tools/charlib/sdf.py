# Signed distance fields in numpy for the playable characters (tools/build-characters.py, v0.31.0).
# A character is one tree of nodes: primitives (sphere, ellipsoid, round cone, rounded box, torus, revolved profile) combined by hard or smooth
# union, subtraction and intersection, with offsets (clothing shells), displacements (folds) and two labels carried along the winning branch:
#   mat : material id (skin, cloth, leather, metal...), used by the texture synthesis (charlib/tex.py);
#   reg : body region id (a bone name or a special region), used by the skin weights (charlib/rig.py).
# Every node has a bounding box (already widened by MARGIN): a brick of points outside it gets BIG without evaluating anything below, which keeps
# the narrow-band evaluation of ~10 M points (2 mm voxels) to a few seconds. Distances are in metres, Blender axes (Z up, front = -Y, left = +X).
import numpy as np

BIG = 1.0
MARGIN = 0.05

MATS = {}      # name -> id
REGS = {}      # name -> id

def mat_id(name):
    if name is None:
        return -1
    if name not in MATS:
        MATS[name] = len(MATS)
    return MATS[name]

def reg_id(name):
    if name is None:
        return -1
    if name not in REGS:
        REGS[name] = len(REGS)
    return REGS[name]

def reset_labels():
    MATS.clear(); REGS.clear()

def V(*a):
    if len(a) == 1:
        return np.asarray(a[0], dtype=np.float64)
    return np.asarray(a, dtype=np.float64)

def rot_euler(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix (local -> world) from XYZ Euler angles (radians), same convention as Blender's 'XYZ'."""
    cx, sx, cy, sy, cz, sz = np.cos(rx), np.sin(rx), np.cos(ry), np.sin(ry), np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx

def rot_to(z_dir, x_hint=(1, 0, 0)):
    """Rotation whose local Z axis is z_dir (and local X as close as possible to x_hint)."""
    z = V(z_dir); z = z / np.linalg.norm(z)
    x = V(x_hint) - z * np.dot(V(x_hint), z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(z, [0, 1, 0]) if abs(z[1]) < 0.9 else np.cross(z, [1, 0, 0])
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1)

def _len(a):
    return np.sqrt(np.einsum('ij,ij->i', a, a))

class Node:
    mat = -1
    reg = -1
    lo = None
    hi = None

    def ev(self, P, blo, bhi):
        """(d, mat, reg) for points P (N, 3) inside the brick [blo, bhi]."""
        if (bhi < self.lo).any() or (blo > self.hi).any():
            n = len(P)
            return np.full(n, BIG), np.full(n, -1, np.int16), np.full(n, -1, np.int16)
        return self._ev(P, blo, bhi)

    def labels(self, n, d):
        return np.full(n, self.mat, np.int16), np.full(n, self.reg, np.int16)

# ------------------------------------------------------------------ primitives
class Prim(Node):
    def __init__(self, mat, reg, lo, hi):
        self.mat = mat_id(mat) if isinstance(mat, str) or mat is None else mat
        self.reg = reg_id(reg) if isinstance(reg, str) or reg is None else reg
        self.lo = V(lo) - MARGIN
        self.hi = V(hi) + MARGIN

    def _ev(self, P, blo, bhi):
        d = self.dist(P)
        m, r = self.labels(len(P), d)
        return d, m, r

class Sphere(Prim):
    def __init__(self, c, r, mat=None, reg=None):
        self.c, self.r = V(c), float(r)
        super().__init__(mat, reg, self.c - r, self.c + r)
    def dist(self, P):
        return _len(P - self.c) - self.r

class Ellipsoid(Prim):
    def __init__(self, c, radii, mat=None, reg=None, R=None):
        self.c, self.rad = V(c), V(radii)
        self.R = np.eye(3) if R is None else V(R)
        ext = np.abs(self.R) @ self.rad
        super().__init__(mat, reg, self.c - ext, self.c + ext)
    def dist(self, P):
        q = (P - self.c) @ self.R
        k0 = _len(q / self.rad)
        k1 = _len(q / (self.rad * self.rad))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

class RoundCone(Prim):
    """Capsule from a (radius ra) to b (radius rb), exact distance (Inigo Quilez)."""
    def __init__(self, a, b, ra, rb=None, mat=None, reg=None):
        self.a, self.b = V(a), V(b)
        self.ra, self.rb = float(ra), float(ra if rb is None else rb)
        m = max(self.ra, self.rb)
        super().__init__(mat, reg, np.minimum(self.a, self.b) - m, np.maximum(self.a, self.b) + m)
    def dist(self, P):
        ba = self.b - self.a
        l2 = float(ba @ ba)
        rr = self.ra - self.rb
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        pa = P - self.a
        y = pa @ ba
        z = y - l2
        w = pa * l2 - np.outer(y, ba)
        x2 = np.einsum('ij,ij->i', w, w)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - self.ra
        d1 = np.sqrt(x2 + z2) * il2 - self.rb
        d2 = np.sqrt(x2 + y2) * il2 - self.ra
        return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))

class RBox(Prim):
    """Box of half sizes h (local axes), corners rounded by r."""
    def __init__(self, c, h, r=0.0, mat=None, reg=None, R=None):
        self.c, self.h, self.r = V(c), V(h), float(r)
        self.R = np.eye(3) if R is None else V(R)
        ext = np.abs(self.R) @ self.h
        super().__init__(mat, reg, self.c - ext, self.c + ext)
    def dist(self, P):
        q = np.abs((P - self.c) @ self.R) - self.h + self.r
        return _len(np.maximum(q, 0)) + np.minimum(q.max(axis=1), 0) - self.r

class Torus(Prim):
    """Torus around the local Z axis (major radius R0, tube radius r)."""
    def __init__(self, c, R0, r, mat=None, reg=None, R=None, sz=(1.0, 1.0)):
        self.c, self.R0, self.r = V(c), float(R0), float(r)
        self.R = np.eye(3) if R is None else V(R)
        self.sz = sz
        e = (R0 + r) * max(sz)
        super().__init__(mat, reg, self.c - e, self.c + e)
    def dist(self, P):
        q = (P - self.c) @ self.R
        rho = np.sqrt((q[:, 0] / self.sz[0]) ** 2 + (q[:, 1] / self.sz[1]) ** 2)
        return np.sqrt((rho - self.R0) ** 2 + q[:, 2] ** 2) - self.r

class Cyl(Prim):
    """Capped cylinder along local Z (half height hh, radius r), edges rounded by rr."""
    def __init__(self, c, r, hh, rr=0.0, mat=None, reg=None, R=None):
        self.c, self.r, self.hh, self.rr = V(c), float(r), float(hh), float(rr)
        self.R = np.eye(3) if R is None else V(R)
        e = np.abs(self.R) @ V(r, r, hh)
        super().__init__(mat, reg, self.c - e, self.c + e)
    def dist(self, P):
        q = (P - self.c) @ self.R
        dx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - self.r + self.rr
        dy = np.abs(q[:, 2]) - self.hh + self.rr
        return np.minimum(np.maximum(dx, dy), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) - self.rr

def _poly2d(px, py, pts):
    """Signed distance to a closed polygon (negative inside), vectorised over points (Inigo Quilez's sdPolygon)."""
    v = np.asarray(pts, dtype=np.float64)
    n = len(v)
    d = (px - v[0, 0]) ** 2 + (py - v[0, 1]) ** 2
    s = np.ones_like(px)
    for i in range(n):
        j = i - 1
        ex, ey = v[j, 0] - v[i, 0], v[j, 1] - v[i, 1]
        wx, wy = px - v[i, 0], py - v[i, 1]
        t = np.clip((wx * ex + wy * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        bx, by = wx - ex * t, wy - ey * t
        d = np.minimum(d, bx * bx + by * by)
        c1 = py >= v[i, 1]
        c2 = py < v[j, 1]
        c3 = ex * wy > ey * wx
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)

class Revolve(Prim):
    """Solid of revolution around the local Z axis: closed profile [(rho, z)] (rho >= 0). sxy scales the section (oval hats)."""
    def __init__(self, c, prof, mat=None, reg=None, R=None, sxy=(1.0, 1.0), round_r=0.0):
        self.c, self.prof = V(c), [tuple(p) for p in prof]
        self.R = np.eye(3) if R is None else V(R)
        self.sxy = sxy
        self.rr = round_r
        rmax = max(p[0] for p in prof) * max(sxy)
        zs = [p[1] for p in prof]
        e = np.abs(self.R) @ V(rmax, rmax, max(abs(min(zs)), abs(max(zs))))
        super().__init__(mat, reg, self.c - e, self.c + e)
    def dist(self, P):
        q = (P - self.c) @ self.R
        rho = np.sqrt((q[:, 0] / self.sxy[0]) ** 2 + (q[:, 1] / self.sxy[1]) ** 2)
        return _poly2d(rho, q[:, 2], self.prof) * min(self.sxy) - self.rr

class Func(Prim):
    """Any distance function f(P) with a given box (for one-off shapes)."""
    def __init__(self, f, lo, hi, mat=None, reg=None):
        self.f = f
        super().__init__(mat, reg, lo, hi)
    def dist(self, P):
        return self.f(P)

# ------------------------------------------------------------------ operators
def smin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25

class Union(Node):
    """Union of the kids; k > 0 blends them (smooth minimum). kfun(P) -> k per point (blend only near some joints, e.g. arm and torso at the shoulder)."""
    def __init__(self, kids, k=0.0, mat=None, reg=None, kfun=None):
        self.kids = [c for c in kids if c is not None]
        self.k = float(k)
        self.kfun = kfun
        self.lo = np.min([c.lo for c in self.kids], axis=0)
        self.hi = np.max([c.hi for c in self.kids], axis=0)
        self.mat = mat_id(mat) if mat is not None else -1
        self.reg = reg_id(reg) if reg is not None else -1
    def _ev(self, P, blo, bhi):
        d = m = r = None
        kk = None
        for c in self.kids:
            if (bhi < c.lo).any() or (blo > c.hi).any():
                continue
            d2, m2, r2 = c._ev(P, blo, bhi)
            if d is None:
                d, m, r = d2, m2, r2
                continue
            win = d2 < d
            m = np.where(win, m2, m)
            r = np.where(win, r2, r)
            if self.kfun is not None:
                if kk is None:
                    kk = np.maximum(self.kfun(P), 1e-6)
                d = smin(d, d2, kk)
            else:
                d = smin(d, d2, self.k) if self.k > 0 else np.minimum(d, d2)
        n = len(P)
        if d is None:
            return np.full(n, BIG), np.full(n, -1, np.int16), np.full(n, -1, np.int16)
        if self.mat >= 0: m = np.full(n, self.mat, np.int16)
        if self.reg >= 0: r = np.full(n, self.reg, np.int16)
        return d, m, r

class Sub(Node):
    """a minus b (b's surface keeps a's labels unless b has its own material: then the cut surface takes it)."""
    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi
    def _ev(self, P, blo, bhi):
        da, ma, ra = self.a.ev(P, blo, bhi)
        db, mb, rb = self.b.ev(P, blo, bhi)
        nb = -db
        win = nb > da
        if self.k > 0:
            d = -smin(-da, db, self.k)
        else:
            d = np.maximum(da, nb)
        m = np.where(win & (mb >= 0), mb, ma)
        return d, m, ra

class Inter(Node):
    def __init__(self, a, b, k=0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = np.maximum(a.lo, b.lo), np.minimum(a.hi, b.hi)
    def _ev(self, P, blo, bhi):
        da, ma, ra = self.a.ev(P, blo, bhi)
        db, mb, rb = self.b.ev(P, blo, bhi)
        d = -smin(-da, -db, self.k) if self.k > 0 else np.maximum(da, db)
        return d, ma, ra

class Offset(Node):
    """Grows (r > 0) or shrinks a shape; mat / reg replace the labels when given (clothing shell over a body part keeps the body regions)."""
    def __init__(self, a, r, mat=None, reg=None):
        self.a, self.r = a, float(r)
        self.lo, self.hi = a.lo - max(r, 0), a.hi + max(r, 0)
        self.mat = mat_id(mat) if mat is not None else -1
        self.reg = reg_id(reg) if reg is not None else -1
    def _ev(self, P, blo, bhi):
        d, m, r = self.a.ev(P, blo, bhi)
        if self.mat >= 0: m = np.full(len(P), self.mat, np.int16)
        if self.reg >= 0: r = np.full(len(P), self.reg, np.int16)
        return d - self.r, m, r

class Shell(Node):
    """Hollow version of a shape: |d| - t (brims, rims, open coats)."""
    def __init__(self, a, t, mat=None):
        self.a, self.t = a, float(t)
        self.lo, self.hi = a.lo - t, a.hi + t
        self.mat = mat_id(mat) if mat is not None else -1
    def _ev(self, P, blo, bhi):
        d, m, r = self.a.ev(P, blo, bhi)
        if self.mat >= 0: m = np.full(len(P), self.mat, np.int16)
        return np.abs(d) - self.t, m, r

class Displace(Node):
    """d + f(P) (folds, quilting). amp bounds |f| (widens the box)."""
    def __init__(self, a, f, amp):
        self.a, self.f = a, f
        self.lo, self.hi = a.lo - amp, a.hi + amp
    def _ev(self, P, blo, bhi):
        d, m, r = self.a.ev(P, blo, bhi)
        near = d < 0.03
        if near.any():
            d = d.copy()
            d[near] += self.f(P[near])
        return d, m, r

class Label(Node):
    """Relabel a subtree (material and / or region)."""
    def __init__(self, a, mat=None, reg=None):
        self.a = a
        self.lo, self.hi = a.lo, a.hi
        self.mat = mat_id(mat) if mat is not None else -1
        self.reg = reg_id(reg) if reg is not None else -1
    def _ev(self, P, blo, bhi):
        d, m, r = self.a.ev(P, blo, bhi)
        if self.mat >= 0: m = np.full(len(P), self.mat, np.int16)
        if self.reg >= 0: r = np.full(len(P), self.reg, np.int16)
        return d, m, r

class Plane(Prim):
    """Half-space n.(p - c) > 0 is outside (use in Inter to cut a shape)."""
    def __init__(self, c, n, lo=(-3, -3, -3), hi=(3, 3, 3)):
        self.c, self.n = V(c), V(n) / np.linalg.norm(n)
        super().__init__(None, None, lo, hi)
    def dist(self, P):
        return (P - self.c) @ self.n

# ------------------------------------------------------------------ evaluation in bricks
def evaluate(root, P, brick=0.064, want_labels=True):
    """Evaluates the tree at arbitrary points (N, 3), bucketed into cubic bricks for culling. Returns d, mat, reg."""
    P = np.asarray(P, dtype=np.float64)
    n = len(P)
    d = np.full(n, BIG)
    m = np.full(n, -1, np.int16)
    r = np.full(n, -1, np.int16)
    if n == 0:
        return d, m, r
    key = np.floor(P / brick).astype(np.int64)
    k = (key[:, 0] + 4096) * 16777216 + (key[:, 1] + 4096) * 4096 + (key[:, 2] + 4096)
    order = np.argsort(k, kind='stable')
    ks = k[order]
    cut = np.flatnonzero(np.diff(ks)) + 1
    starts = np.concatenate([[0], cut])
    ends = np.concatenate([cut, [n]])
    for s, e in zip(starts, ends):
        idx = order[s:e]
        Q = P[idx]
        blo = Q.min(axis=0)
        bhi = Q.max(axis=0)
        dd, mm, rr = root.ev(Q, blo, bhi)
        d[idx], m[idx], r[idx] = dd, mm, rr
    return d, m, r

def gradient(root, P, eps=0.0005):
    """Normalised gradient (outward normal) by central differences."""
    g = np.zeros_like(P)
    for ax in range(3):
        o = np.zeros(3); o[ax] = eps
        g[:, ax] = evaluate(root, P + o)[0] - evaluate(root, P - o)[0]
    n = np.linalg.norm(g, axis=1, keepdims=True)
    return g / np.maximum(n, 1e-12)
