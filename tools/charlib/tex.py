# Procedural PBR textures of the playable characters (v0.31.0), computed per texel from the rest-pose position of the texel (baked by Cycles from the
# low mesh), its object-space normal, its material label (the SDF material of the part it belongs to) and the ambient occlusion baked from the dense mesh.
# Output: albedo (sRGB), roughness, metallic, a detail height (fabric grain, stitches, pores, leather grain: turned into normals in UV space and
# combined with the normals baked from the dense mesh), emission and a skin mask.
# Everything is generated here (value noise, fbm, cellular noise): no image is read.
import numpy as np

def srgb_to_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)

def hexrgb(h):
    """sRGB hex -> linear RGB."""
    return srgb_to_lin(np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255]) / 255.0)

# ------------------------------------------------------------------ noise
def _hash(ix, iy, iz, seed):
    n = ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 53.3
    return np.modf(np.sin(n) * 43758.5453)[0] % 1.0

def vnoise(P, scale=1.0, seed=0.0):
    """Value noise in [0, 1] (smooth), at points P (N, 3)."""
    X = P * scale
    i = np.floor(X)
    f = X - i
    u = f * f * (3 - 2 * f)
    ix, iy, iz = i[:, 0], i[:, 1], i[:, 2]
    def h(a, b, c):
        return _hash(ix + a, iy + b, iz + c, seed)
    x00 = h(0, 0, 0) * (1 - u[:, 0]) + h(1, 0, 0) * u[:, 0]
    x10 = h(0, 1, 0) * (1 - u[:, 0]) + h(1, 1, 0) * u[:, 0]
    x01 = h(0, 0, 1) * (1 - u[:, 0]) + h(1, 0, 1) * u[:, 0]
    x11 = h(0, 1, 1) * (1 - u[:, 0]) + h(1, 1, 1) * u[:, 0]
    y0 = x00 * (1 - u[:, 1]) + x10 * u[:, 1]
    y1 = x01 * (1 - u[:, 1]) + x11 * u[:, 1]
    return y0 * (1 - u[:, 2]) + y1 * u[:, 2]

def fbm(P, scale=1.0, oct=4, seed=0.0, gain=0.5):
    s, a, tot, amp = scale, 0.0, 0.0, 1.0
    for o in range(oct):
        a = a + vnoise(P, s, seed + o * 17.0) * amp
        tot += amp
        s *= 2.03
        amp *= gain
    return a / tot

def cells(P, scale=1.0, seed=0.0):
    """Distance to the nearest feature point of a jittered grid (cellular noise, ~0..1)."""
    X = P * scale
    i = np.floor(X)
    best = np.full(len(P), 9.0)
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            for c in (-1, 0, 1):
                j = i + np.array([a, b, c])
                o = np.stack([_hash(j[:, 0], j[:, 1], j[:, 2], seed + k * 3.1) for k in range(3)], axis=1)
                d = np.sqrt(((j + o - X) ** 2).sum(1))
                best = np.minimum(best, d)
    return best

def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

# ------------------------------------------------------------------ materials
class Out:
    def __init__(self, n):
        self.col = np.zeros((n, 3))
        self.rough = np.full(n, 0.8)
        self.metal = np.zeros(n)
        self.height = np.zeros(n)        # metres (detail only)
        self.emit = np.zeros((n, 3))
        self.skin = np.zeros(n)

def weave(P, N, pitch=0.0012, amp=0.00012):
    """Plain weave relief: two sets of crossing ridges in the plane of the surface (3D, so it does not depend on the UVs)."""
    a = P[:, 0] + P[:, 1] * 0.31 + P[:, 2] * 0.17
    b = P[:, 2] - P[:, 0] * 0.21 + P[:, 1] * 0.37
    s1 = np.sin(a * np.pi * 2 / pitch)
    s2 = np.sin(b * np.pi * 2 / pitch)
    return amp * (s1 * (s2 > 0) + s2 * (s1 <= 0)) * 0.5

def twill(P, pitch=0.0016, amp=0.00012):
    a = P[:, 2] * 0.9 + P[:, 0] * 0.6 + P[:, 1] * 0.45
    return amp * np.sin(a * np.pi * 2 / pitch)

def shade(kind, spec, P, N, AO, rng_seed, extra):
    """Returns (col lin RGB (n, 3), rough, metal, height, emit, skin) for the texels of one material."""
    n = len(P)
    o = Out(n)
    seed = float(rng_seed)
    base = hexrgb(spec.get('color', 0x808080)) if 'color' in spec else None
    rough = spec.get('rough', 0.8)
    vary = spec.get('vary', 0.08)
    if kind == 'camo':
        cols = [hexrgb(c) for c in spec['colors']]
        sc = 1.0 / spec.get('scale', 0.09)
        wp = P + 0.35 / sc * (np.stack([fbm(P, sc * 2.2, 3, seed + k) for k in (31, 37, 41)], 1) - 0.5)
        n1 = fbm(wp, sc, 4, seed + 1)
        n2 = fbm(wp, sc * 1.3, 4, seed + 7)
        n3 = fbm(wp, sc * 1.7, 3, seed + 13)
        c = np.tile(cols[0], (n, 1))
        c = np.where((n1 > 0.53)[:, None], cols[1], c)
        c = np.where((n2 > 0.58)[:, None], cols[2], c)
        c = np.where((n3 > 0.62)[:, None], cols[3], c)
        o.col = c * (0.92 + 0.16 * fbm(P, 180, 3, seed + 3))[:, None]
        o.height = weave(P, N, 0.0011, 0.00009) + 0.0002 * (fbm(P, 90, 3, seed + 5) - 0.5)
        o.rough = rough + 0.08 * (vnoise(P, 60, seed) - 0.5)
    elif kind in ('cloth', 'cotton', 'cordura', 'webbing', 'synthetic', 'knit', 'wool', 'denim', 'velvet', 'silk', 'foam', 'canvas', 'nylon'):
        nz = fbm(P, 45, 4, seed + 2)
        o.col = base * (1 - vary + 2 * vary * nz)[:, None]
        o.rough = rough + 0.06 * (nz - 0.5)
        if kind in ('cloth', 'cotton', 'canvas'):
            o.height = weave(P, N, 0.0011, 0.00008)
        elif kind == 'cordura':
            o.height = weave(P, N, 0.0016, 0.00013)
        elif kind == 'denim':
            o.height = twill(P, 0.0018, 0.00013)
            o.col = o.col * (0.9 + 0.2 * (0.5 + 0.5 * np.sin((P[:, 2] * 0.9 + P[:, 0] * 0.6) * np.pi * 2 / 0.0018)))[:, None]
        elif kind == 'webbing':
            o.height = 0.00015 * np.sin(P[:, 2] * np.pi * 2 / 0.0014 + P[:, 0] * 900)
        elif kind == 'knit':
            k = np.sin(P[:, 2] * np.pi * 2 / 0.004) * np.sin((P[:, 0] + P[:, 1]) * np.pi * 2 / 0.003)
            o.height = 0.0004 * k
            o.col = o.col * (0.9 + 0.1 * k)[:, None]
        elif kind == 'wool':
            o.height = 0.0003 * (fbm(P, 400, 2, seed) - 0.5)
        elif kind == 'velvet':
            o.col = o.col * (0.8 + 0.4 * np.abs(N[:, 1]))[:, None]
        elif kind == 'silk':
            o.height = 0.00005 * np.sin(P[:, 2] * 4000)
        elif kind == 'foam':
            o.height = 0.0008 * (cells(P, 260, seed) - 0.4)
        elif kind in ('synthetic', 'nylon'):
            o.height = 0.00008 * (fbm(P, 500, 2, seed) - 0.5)
        if spec.get('molle'):
            # rows of webbing loops (2.5 cm pitch), stitched
            z = (P[:, 2] / 0.025) % 1.0
            band = ss(0.05, 0.1, z) * (1 - ss(0.45, 0.5, z))
            o.height = o.height + band * 0.0012
            o.col = o.col * (1 - 0.15 * band)[:, None]
        if spec.get('pattern') == 'stripes':
            c2 = hexrgb(spec['color2'])
            st = (np.sin(P[:, 2] * np.pi * 2 / spec.get('pitch', 0.03)) > spec.get('duty', 0.0))
            o.col = np.where(st[:, None], o.col, c2 * (o.col / np.maximum(base, 1e-4)))
    elif kind == 'leather':
        g = cells(P, 700, seed)
        nz = fbm(P, 30, 4, seed + 4)
        o.col = base * (0.85 + 0.25 * nz)[:, None] * (0.95 + 0.08 * g)[:, None]
        o.height = 0.00012 * g + 0.0004 * (fbm(P, 120, 3, seed + 9) - 0.5)
        o.rough = rough + 0.15 * (nz - 0.5) - 0.1 * (AO - 0.6)
    elif kind == 'rubber':
        nz = fbm(P, 60, 3, seed + 5)
        o.col = base * (0.85 + 0.3 * nz)[:, None]
        o.rough = rough + 0.1 * (nz - 0.5)
        o.height = 0.0002 * (fbm(P, 300, 2, seed) - 0.5)
        if spec.get('tread'):
            down = ss(-0.6, -0.9, N[:, 2])
            t = np.sin(P[:, 1] * np.pi * 2 / 0.012) * np.sin(P[:, 0] * np.pi * 2 / 0.016)
            o.height = o.height + down * 0.0018 * (t > 0)
    elif kind == 'metal':
        nz = fbm(P, 80, 3, seed + 6)
        o.col = base * (0.85 + 0.3 * nz)[:, None]
        o.metal[:] = spec.get('metal', 0.9)
        o.rough = rough + 0.15 * (nz - 0.5)
        o.height = 0.00004 * np.sin(P[:, 2] * 9000 + 30 * nz)
        # edges and raised parts: worn (lighter, smoother); hollows: grime
        wear = ss(0.85, 1.0, AO) * ss(0.55, 0.75, fbm(P, 200, 2, seed + 1))
        o.col = o.col * (1 + 0.4 * wear)[:, None]
    elif kind == 'plastic':
        nz = fbm(P, 90, 3, seed + 8)
        o.col = base * (0.92 + 0.16 * nz)[:, None]
        o.rough = rough + 0.1 * (nz - 0.5)
        o.height = 0.00006 * (fbm(P, 700, 2, seed) - 0.5)
    elif kind == 'reflective':
        o.col = np.tile(base, (n, 1)) * (0.95 + 0.1 * fbm(P, 100, 2, seed))[:, None]
        o.rough[:] = rough
        o.metal[:] = spec.get('metal', 0.3)
        o.height = 0.00006 * np.sin(P[:, 0] * 6000) * np.sin(P[:, 2] * 6000)
        o.emit = np.tile(base, (n, 1)) * spec.get('glow', 0.12)
    elif kind == 'glow':
        o.col = np.tile(base, (n, 1))
        o.rough[:] = rough
        o.emit = np.tile(hexrgb(spec.get('emit', spec['color'])), (n, 1)) * spec.get('glow', 2.0)
    elif kind == 'glass':
        o.col = np.tile(base, (n, 1))
        o.rough[:] = 0.05
        o.metal[:] = 0.0
    elif kind == 'hair':
        flow = extra.get('hair_flow')
        Q = P.copy()
        if flow is not None:
            f = flow(P)
            Q = P - f * (P * f).sum(1, keepdims=True) * 0.96   # noise stretched along the strands
        s = fbm(Q, 1400, 2, seed + 3)
        s2 = fbm(Q, 320, 3, seed + 5)
        s3 = vnoise(Q, 4200, seed + 8)
        st = np.clip((s - 0.35) * 2.2, 0, 1) * 0.6 + 0.4 * s3
        o.col = base * (0.42 + 0.75 * st * (0.75 + 0.5 * s2))[:, None]
        o.height = 0.00035 * (st - 0.5)
        o.rough = 0.45 + 0.2 * s2
    elif kind == 'eye':
        e = extra['eye']        # (centre, forward, radius, iris lin RGB) per side
        col = np.tile(hexrgb(0xece7df), (n, 1))
        rough_e = np.full(n, 0.06)
        h = np.zeros(n)
        for (c, fwd, r, iris) in e:
            q = P - c
            dist = np.linalg.norm(q, axis=1)
            m = dist < r * 1.6
            if not m.any():
                continue
            qq = q[m] / np.maximum(dist[m], 1e-9)[:, None]
            cosang = qq @ fwd
            ang = np.arccos(np.clip(cosang, -1, 1))
            # radial angle around the axis, for the iris fibres
            side = np.cross(fwd, [0, 0, 1]); side /= np.linalg.norm(side)
            up = np.cross(side, fwd)
            phi = np.arctan2(qq @ up, qq @ side)
            iris_a, pupil_a = 0.50, 0.19
            fib = 0.5 + 0.5 * np.sin(phi * 37 + 3 * np.sin(phi * 7)) * np.sin(phi * 23 + 1.3)
            rr = ang / iris_a
            ic = iris[None, :] * (0.55 + 0.75 * fib[:, None] * (0.6 + 0.5 * rr[:, None]))
            ic = ic * (1 - 0.55 * ss(0.8, 1.0, rr))[:, None]                     # limbal ring
            ic = ic + iris[None, :] * 0.5 * ss(0.45, 0.25, rr)[:, None] * 0.6   # lighter collarette
            c_e = col[m]
            # sclera: slightly pink / darker towards the corners, fine veins
            veins = ss(0.62, 0.66, vnoise(P[m], 900, 3.0)) * ss(0.9, 1.4, ang)
            c_e = c_e * (1 - 0.18 * ss(0.9, 1.6, ang))[:, None]
            c_e = c_e * (1 - veins * 0.3)[:, None] + np.array([0.25, 0.02, 0.02]) * veins[:, None] * 0.3
            c_e = np.where((rr < 1.0)[:, None], ic, c_e)
            c_e = np.where((ang < pupil_a)[:, None], np.array([0.006, 0.005, 0.005]), c_e)
            col[m] = c_e
            h[m] = np.where(rr < 1.0, -0.0002 * (1 - rr), 0)
        o.col = col
        o.rough = rough_e
        o.height = h
    elif kind == 'skin':
        o.skin[:] = 1.0
        base = hexrgb(spec['color'])
        nz = fbm(P, 25, 4, seed + 1)
        blotch = fbm(P, 90, 3, seed + 2)
        col = base * (0.92 + 0.12 * nz)[:, None] * (0.97 + 0.06 * blotch)[:, None]
        red = np.zeros(n)
        hf = extra.get('head_frame')
        if hf is not None:
            c, k = hf
            q = (P - c) / k
            # cheeks, nose, ears, lips: a warmer, redder skin
            for (x, y, z, r, a) in ((0.04, -0.07, -0.03, 0.022, 0.55), (-0.04, -0.07, -0.03, 0.022, 0.55), (0, -0.1, -0.035, 0.016, 0.45),
                                    (0.07, 0.015, -0.01, 0.03, 0.4), (-0.07, 0.015, -0.01, 0.03, 0.4), (0, -0.088, 0.035, 0.03, 0.15)):
                dd = np.sqrt((q[:, 0] - x) ** 2 + (q[:, 1] - y) ** 2 + (q[:, 2] - z) ** 2)
                red += a * ss(r, 0.0, dd)
            # lips (vermilion): in the mouth area, in front
            zl = extra.get('mouth_z', -0.0715)
            lx = np.abs(q[:, 0]) / 0.025
            up_l = (q[:, 2] - zl)
            lipm = (lx < 1.0) & (q[:, 1] < -0.078)
            prof_u = 0.0072 * (1 - lx ** 2.2) + 0.0012 * np.cos(lx * np.pi * 1.0)
            prof_d = 0.0105 * (1 - lx ** 2.0)
            inside = lipm & (up_l < prof_u) & (up_l > -prof_d)
            lipk = np.where(inside, ss(0.0, 0.25, np.minimum(prof_u - up_l, up_l + prof_d) / 0.004), 0.0)
            lipc = hexrgb(extra.get('lip_color', 0xb5686a))
            col = col * (1 - lipk[:, None]) + lipc[None, :] * (0.9 + 0.2 * nz)[:, None] * lipk[:, None]
            o.rough = 0.55 - 0.2 * lipk
            # eyebrows: strands along an arch above each eye
            bc = hexrgb(extra.get('brow_color', 0x2b1d12))
            bw = extra.get('brow', 1.0)
            for sx in (1, -1):
                xx = q[:, 0] * sx
                zc = 0.0215 + 0.006 * np.sin(np.clip((xx - 0.012) / 0.04, 0, 1) * np.pi * 0.85) - 0.004 * ss(0.035, 0.055, xx)
                th = (0.0042 - 0.0022 * ss(0.012, 0.052, xx)) * bw
                bm = (xx > 0.011) & (xx < 0.056) & (q[:, 1] < -0.05)
                dz = np.abs(q[:, 2] - zc)
                strand = 0.5 + 0.5 * np.sin((q[:, 2] * 0.6 + xx * 0.8) * 5200 + 6 * vnoise(P, 400, 9))
                bk = np.where(bm, ss(th, th * 0.45, dz) * (0.55 + 0.45 * strand) * ss(0.009, 0.016, xx), 0)
                bk = bk * (1 - ss(0.050, 0.057, xx))
                col = col * (1 - bk[:, None] * 0.92) + bc[None, :] * bk[:, None] * 0.92
                o.height = o.height + bk * 0.00025
            # stubble / beard shadow
            st = extra.get('stubble', 0.0)
            if st > 0:
                zone = ss(-0.035, -0.06, q[:, 2]) * ss(-0.02, -0.06, q[:, 1]) * (1 - ss(0.0, 0.01, -(q[:, 2] + 0.13)))
                zone = np.maximum(zone, ss(-0.052, -0.062, q[:, 2]) * ss(-0.075, -0.09, q[:, 1]) * ss(0.03, 0.015, np.abs(q[:, 0])))
                zone = zone * (1 - lipk)
                dots = ss(0.55, 0.75, vnoise(P, 2600, 4))
                sc_ = hexrgb(extra.get('brow_color', 0x2b1d12))
                k2 = zone * st * (0.45 + 0.55 * dots)
                col = col * (1 - k2[:, None] * 0.55) + sc_[None, :] * k2[:, None] * 0.55
            # eyelid margins and lash line (dark, under the brow)
            ll = extra.get('lash', 0x1a1210)
            for sx in (1, -1):
                ec = np.array([sx * 0.0315, -0.071, 0.0])
                dd = np.linalg.norm(q - ec, axis=1)
                lm = (dd < 0.0152) & (q[:, 1] < -0.074)
                zz = q[:, 2] + 0.0009
                lash = np.where(lm, ss(0.0045, 0.0062, zz) * (1 - ss(0.0072, 0.0085, zz)), 0) * ss(0.0158, 0.0145, dd)
                col = col * (1 - lash[:, None] * 0.85) + hexrgb(ll)[None, :] * lash[:, None] * 0.85
            red = red * (1 - lipk)
        warm = hexrgb(extra.get('blush', 0xc0605a))
        col = col * (1 - 0.18 * red[:, None]) + warm[None, :] * 0.18 * red[:, None]
        o.col = col
        o.height = o.height + 0.00006 * (fbm(P, 900, 2, seed + 3) - 0.5) - 0.00005 * ss(0.6, 0.7, vnoise(P, 1500, 5))
        o.rough = np.minimum(o.rough, 0.55 + 0.1 * (nz - 0.5))
        # fingernails
        nails = extra.get('nails')
        if nails is not None:
            for (a, b, back, r) in nails:
                ab = b - a
                L = np.linalg.norm(ab)
                t = (P - a) @ ab / (L * L)
                rad = P - a - np.outer(t, ab)
                dist = np.linalg.norm(rad, axis=1)
                dorsal = (rad @ back) / np.maximum(dist, 1e-9)
                nm = (t > 0.25) & (t < 1.25) & (dorsal > 0.45) & (dist < r * 1.6)
                k3 = np.where(nm, ss(0.45, 0.6, dorsal) * ss(0.25, 0.4, t), 0)
                col = col * (1 - k3[:, None] * 0.5) + hexrgb(0xe8c0b0)[None, :] * k3[:, None] * 0.5
                o.height = o.height + k3 * 0.0003
                o.rough = np.where(k3 > 0.5, 0.3, o.rough)
        o.col = col
    else:
        o.col = np.tile(base if base is not None else hexrgb(0xff00ff), (n, 1))
    if base is not None and kind not in ('skin',):
        pass
    o.rough = np.clip(o.rough, 0.03, 1.0)
    # dirt: lower parts of clothes, shoes; grime in the hollows
    dirt = spec.get('dirt', extra.get('dirt', 0.0))
    if dirt > 0 and kind not in ('skin', 'eye', 'hair', 'glass', 'glow'):
        low = ss(0.45, 0.05, P[:, 2]) * dirt
        g = fbm(P, 14, 3, seed + 21)
        dk = np.clip(low * (0.4 + 0.9 * g) + (1 - AO) * 0.35 * dirt, 0, 1)
        dc = hexrgb(0x4a3c2c)
        o.col = o.col * (1 - dk[:, None] * 0.6) + dc[None, :] * dk[:, None] * 0.6 * 0.8
        o.rough = np.clip(o.rough + dk * 0.15, 0, 1)
    return o

def stitches(P, seams):
    """Seams: list of callables P -> (stitch mask 0..1, groove 0..1)."""
    st = np.zeros(len(P)); gr = np.zeros(len(P))
    for f in seams:
        a, b = f(P)
        st = np.maximum(st, a); gr = np.maximum(gr, b)
    return st, gr

def plane_seam(p, n, width=0.0028, dash=0.0045, mats=None, lim=None):
    """Stitching along the line where the plane (p, n) crosses the surface: a shallow groove and two rows of dashes."""
    p, n = np.asarray(p, float), np.asarray(n, float) / np.linalg.norm(n)
    def f(P):
        d = (P - p) @ n
        t = P @ np.cross(n, [0.3, 0.4, 0.86])
        groove = ss(0.0012, 0.0, np.abs(d))
        rows = ss(0.00045, 0.0001, np.abs(np.abs(d) - width))
        dashes = (np.sin(t * np.pi * 2 / dash) > -0.2)
        m = rows * dashes
        if lim is not None:
            k = lim(P)
            m = m * k; groove = groove * k
        return m, groove
    f.mats = mats
    return f

def box_seam(c, R, half, inset=0.004, dash=0.004, mats=None):
    """Stitching around the front face of a patch (RBox: centre c, rotation R, half sizes): inset from its outline."""
    c, R, half = np.asarray(c, float), np.asarray(R, float), np.asarray(half, float)
    def f(P):
        q = (P - c) @ R
        dx = half[0] - np.abs(q[:, 0])
        dz = half[2] - np.abs(q[:, 2])
        e = np.minimum(dx, dz)
        front = q[:, 1] < 0
        inside = (dx > -0.001) & (dz > -0.001) & front & (np.abs(q[:, 1]) < half[1] + 0.006)
        rows = ss(0.0005, 0.0001, np.abs(e - inset))
        along = np.where(dx < dz, q[:, 2], q[:, 0])
        dashes = (np.sin(along * np.pi * 2 / dash) > -0.2)
        return rows * dashes * inside, ss(0.0012, 0.0, np.abs(e)) * inside * 0.5
    f.mats = mats
    return f
