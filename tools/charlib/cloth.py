# Clothing and equipment helpers over the SDF body (v0.31.0).
#   shell(parts, t, mat)           : a garment = the body parts grown by t (a loose shell keeps the regions of the body it covers);
#   cut(node, p, n)                : keeps the side of the plane through p opposite to n (hems, cuffs, collars);
#   band(base, path, w, h, mat)    : a strap, belt, stripe or seam tape: the base surface grown by h, restricted to a tube of radius w around a polyline;
#   folds(node, a, b, ...)         : wrinkles around a segment (elbows, knees, trouser stacks), as a displacement;
#   surf(base, p0, d)              : first point of the base surface along the ray p0 + t d, and its normal (to place pockets, buckles, badges).
import numpy as np
from .sdf import (Sphere, Ellipsoid, RoundCone, RBox, Torus, Cyl, Revolve, Union, Sub, Inter, Offset, Shell, Displace, Label, Plane, Func,
                  evaluate, gradient, rot_to, rot_euler, V, BIG)

def shell(parts, t, mat, k=0.0):
    u = parts if not isinstance(parts, (list, tuple)) else (parts[0] if len(parts) == 1 else Union(list(parts), k=k))
    return Offset(u, t, mat=mat)

def cut(node, p, n):
    """Keeps the half-space where (x - p).n <= 0."""
    return Inter(node, Plane(p, n))

def keep_box(node, lo, hi, r=0.0):
    lo, hi = V(lo), V(hi)
    return Inter(node, RBox((lo + hi) / 2, (hi - lo) / 2, r))

def band(base, path, w, h, mat, reg=None, k=0.0):
    """Raised band of half width w, height h over the base surface, following the polyline path."""
    segs = [RoundCone(path[i], path[i + 1], w, w) for i in range(len(path) - 1)]
    tube = segs[0] if len(segs) == 1 else Union(segs)
    return Label(Inter(Offset(base, h), tube, k=k), mat=mat, reg=reg)

def ring_band(base, c, axis, z0, z1, h, mat, reg=None, R=0.4):
    """Band around a limb or the waist: the base grown by h between two planes perpendicular to axis (through c + axis*z0 / z1)."""
    axis = V(axis) / np.linalg.norm(axis)
    c = V(c)
    slab = Inter(Plane(c + axis * z1, axis), Plane(c + axis * z0, -axis))
    lim = Sphere(c + axis * (z0 + z1) / 2, R)
    return Label(Inter(Inter(Offset(base, h), slab), lim), mat=mat, reg=reg)

def folds(node, a, b, amp=0.003, freq=55.0, width=0.06, centre=0.5, twist=2.0, seed=0.0):
    """Wrinkles around the segment a-b: rings along the axis that wobble around it, faded by a bell centred at `centre` (0..1 along the segment)."""
    a, b = V(a), V(b)
    ax = b - a
    L = np.linalg.norm(ax)
    ax = ax / L
    ref = np.cross(ax, [0, 0, 1]) if abs(ax[2]) < 0.9 else np.cross(ax, [1, 0, 0])
    ref /= np.linalg.norm(ref)
    ref2 = np.cross(ax, ref)
    def f(P):
        q = P - a
        t = q @ ax
        ang = np.arctan2(q @ ref2, q @ ref)
        u = (t / L - centre) * L / width
        bell = np.exp(-u * u)
        wob = twist * np.sin(ang * 2.0 + seed) + 0.7 * np.sin(ang * 3.0 + 1.7 * seed)
        return amp * bell * np.sin(freq * t + wob)
    return Displace(node, f, amp)

def drape(node, axis_pt, amp=0.004, freq=18.0, z0=0.0, z1=1.0, seed=0.0):
    """Vertical gravity folds (coat skirts, robes): ripples around a vertical axis, growing towards the hem (z0 = hem, z1 = top)."""
    c = V(axis_pt)
    def f(P):
        q = P - c
        ang = np.arctan2(q[:, 1], q[:, 0])
        g = np.clip((z1 - P[:, 2]) / max(z1 - z0, 1e-3), 0, 1)
        # irregular: the phase wanders around the axis and with the height, the depth varies from fold to fold
        ph = ang * freq + seed + 2.2 * np.sin(ang * 3.0 + seed * 1.7) + 1.5 * np.sin(P[:, 2] * 9.0 + ang * 2.0)
        depth = 0.55 + 0.45 * np.sin(ang * 5.0 + 2.0 * seed)
        return amp * g * depth * (np.sin(ph) * 0.75 + 0.25 * np.sin(ph * 2.1 + 1.3))
    return Displace(node, f, amp)

def surf(base, p0, d, tmax=0.5, step=0.002):
    """Surface point hit from p0 along d (sphere tracing), and the outward normal there."""
    p0, d = V(p0), V(d) / np.linalg.norm(d)
    t = 0.0
    for _ in range(400):
        p = p0 + d * t
        dist = evaluate(base, p[None])[0][0]
        if dist < 0.0003:
            break
        t += min(max(dist * 0.8, 0.0003), 0.01)
        if t > tmax:
            break
    p = p0 + d * t
    n = gradient(base, p[None])[0]
    return p, n

def frame(n, up=(0, 0, 1)):
    """Rotation whose local Y axis is -n (local -Y faces out of the surface, like the character's front) and local Z is as close to up as possible."""
    n = V(n) / np.linalg.norm(n)
    y = -n
    z = V(up) - y * np.dot(V(up), y)
    if np.linalg.norm(z) < 1e-6:
        z = np.array([0, 1.0, 0])
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z], axis=1)

def patch(base, p0, d, size, depth, mat, reg=None, r=0.004, up=(0, 0, 1), sink=0.3):
    """A box stuck on the surface (pocket, pouch, badge, buckle): size = (width, height) along the surface, depth = thickness out of it."""
    p, n = surf(base, p0, d)
    R = frame(n, up)
    c = p + n * depth * (0.5 - sink)
    return RBox(c, (size[0] / 2, depth / 2 + 0.002, size[1] / 2), r, mat=mat, reg=reg, R=R), p, n, R
