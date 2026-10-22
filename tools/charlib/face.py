# Head and face of the playable characters (v0.31.0), as an SDF built around the head centre of the skeleton (charlib/skel.py: between the eyes, at
# eye level). Cranium, forehead and brow ridge, temples, cheekbones, jaw and chin, nose (bridge, tip, wings, nostrils), lips (Cupid's bow, mouth line,
# corners, philtrum), ears (rim, hollow, lobe), eye sockets and eyelids: the lids are a shell around the eyeball with an almond-shaped opening; the
# eyeballs are separate meshes turned by the Eye bones; the upper lids follow the Lid bones (blink, scenes/face_rig.gd).
# Landmarks follow average adult measurements (front = -Y): nose tip 11 cm in front of the head centre, chin 12 cm under the eyes, eyes 63 mm apart.
# Parameters (dict, all optional, 1.0 = average adult): fem, jaw, chin, cheek, nose, nose_w, bridge, lips, brow, ear, eye_w, eye_h, face_len, round, age.
import numpy as np
from .sdf import (Sphere, Ellipsoid, RoundCone, RBox, Torus, Union, Sub, Inter, Offset, Label, Func, rot_euler, rot_to, V)

R_EYE = 0.0118
EYE_X = 0.0315
EYE_Y = -0.071

def head(sk, p=None, parts=False):
    p = dict(p or {})
    fem = p.get('fem', sk.fem)
    hk = sk.head_k
    c = sk.head_c
    def H(x, y, z):
        return c + np.array([x, y, z]) * hk
    def R3(a, b, cc):
        return np.array([a, b, cc]) * hk
    jaw = p.get('jaw', 0.88 if fem else 1.0)
    chin = p.get('chin', 0.85 if fem else 1.0)
    cheek = p.get('cheek', 1.12 if fem else 1.0)
    nose = p.get('nose', 0.92 if fem else 1.0)
    nose_w = p.get('nose_w', 0.92 if fem else 1.0)
    bridge = p.get('bridge', 0.85 if fem else 1.0)
    brow = p.get('brow', 0.5 if fem else 1.0)
    lips = p.get('lips', 1.2 if fem else 1.0)
    ear = p.get('ear', 0.94 if fem else 1.0)
    fl = p.get('face_len', 0.94 if fem else 1.0)
    rnd = p.get('round', 1.05 if fem else 1.0)
    age = p.get('age', 0.0)
    reg = 'Head'
    L = []
    M = []      # cheeks and jaw: blended more softly together (no crease between cheek, masseter and jaw)
    # ---- skull
    L.append(Ellipsoid(H(0, 0.018, 0.03), R3(0.0735 * rnd, 0.093, 0.092), reg=reg))
    L.append(Ellipsoid(H(0, -0.03, 0.045), R3(0.06, 0.055, 0.058), reg=reg))                               # forehead
    L.append(Ellipsoid(H(0, 0.03, -0.03), R3(0.062 * rnd, 0.068, 0.06), reg=reg))                           # occiput above the neck
    for sx in (1, -1):
        L.append(RoundCone(H(sx * 0.012, -0.079, 0.021), H(sx * 0.047, -0.068, 0.023), (0.0085 * (0.6 + 0.4 * brow)) * hk,
                           0.007 * hk, reg=reg))                                                               # brow ridge
        L.append(Ellipsoid(H(sx * 0.058, -0.03, 0.022), R3(0.016, 0.03, 0.03), reg=reg))                      # temple
        M.append(RoundCone(H(sx * 0.05, -0.052, -0.01), H(sx * 0.064, -0.006, -0.016), 0.011 * hk, 0.010 * hk, reg=reg))   # zygomatic arch
        M.append(Ellipsoid(H(sx * 0.045, -0.06, -0.016), R3(0.021 * cheek, 0.016, 0.016), reg=reg))           # cheekbone
        M.append(Ellipsoid(H(sx * 0.037, -0.058, -0.05 * fl), R3(0.024 * cheek * rnd, 0.02, 0.026), reg=reg))  # cheek
        gon = H(sx * 0.049 * jaw * (0.9 if fem else 1.0), 0.002 + (0.006 if fem else 0.0), -0.078 * fl)
        M.append(RoundCone(gon, H(sx * 0.017 * jaw, -0.067, -0.108 * fl), 0.0125 * hk, 0.0125 * hk, reg='Jaw'))   # mandible
        M.append(RoundCone(gon, H(sx * 0.058, 0.004, -0.025), 0.011 * hk, 0.011 * hk, reg=reg))                  # ramus
        if age > 0:
            M.append(Ellipsoid(H(sx * 0.04, -0.045, -0.088 * fl), R3(0.02, 0.022, 0.02) * (1 + 0.4 * age), reg='Jaw'))   # jowls
        M.append(Ellipsoid(H(sx * 0.046 * jaw, -0.022, -0.052 * fl), R3(0.019 * (0.75 if fem else 1.0), 0.034, 0.034), reg='Jaw'))      # masseter
        if fem:
            M.append(Ellipsoid(H(sx * 0.036, -0.064, -0.045 * fl), R3(0.027, 0.022, 0.03), reg=reg))           # soft cheek
    M.append(Ellipsoid(H(0, -0.012, -0.03 * fl), R3(0.064 * rnd, 0.064, 0.058), reg=reg))                     # sides of the face
    L.append(Ellipsoid(H(0, -0.079, 0.022), R3(0.017, 0.006 + 0.004 * brow, 0.011), reg=reg))                # glabella
    L.append(Ellipsoid(H(0, -0.056, -0.034 * fl), R3(0.046, 0.032, 0.036), reg=reg))                         # maxilla
    L.append(Ellipsoid(H(0, -0.061, -0.07 * fl), R3(0.033, 0.029, 0.029), reg=reg))                          # dental arch
    L.append(Ellipsoid(H(0, -0.071, -0.108 * fl), R3(0.023 * chin * jaw, 0.016 * chin, 0.0155), reg='Jaw'))   # chin
    L.append(Ellipsoid(H(0, -0.062, -0.093 * fl), R3(0.029 * jaw, 0.02, 0.018), reg='Jaw'))
    skull = Union(L + M, k=0.026 * hk)
    # soft hollows in front of the eyes (the lids are added below)
    for sx in (1, -1):
        skull = Sub(skull, Ellipsoid(H(sx * 0.033, -0.089, 0.0), R3(0.019, 0.011, 0.012)), k=0.009 * hk)
    # ---- nose
    nb = []
    nb.append(RoundCone(H(0, -0.073 - 0.002 * bridge, 0.008), H(0, -0.0985 * nose - 0.003 * bridge, -0.027 * nose), 0.0062 * hk * bridge, 0.0082 * hk * nose_w, reg=reg))
    nb.append(Sphere(H(0, -0.1015 * nose, -0.036 * nose), 0.0105 * hk * nose_w * (1 + age * 0.15), reg=reg))
    nb.append(RoundCone(H(0, -0.101 * nose, -0.04 * nose), H(0, -0.092, -0.05), 0.0045 * hk, 0.004 * hk, reg=reg))     # columella
    for sx in (1, -1):
        nb.append(Ellipsoid(H(sx * 0.0122 * nose_w, -0.0905 * nose, -0.0435 * nose), R3(0.0082 * nose_w, 0.0098, 0.0074), reg=reg))
    face = Union([skull, Union(nb, k=0.007 * hk)], k=0.01 * hk)
    for sx in (1, -1):
        face = Sub(face, Ellipsoid(H(sx * 0.0068 * nose_w, -0.095 * nose, -0.0505 * nose), R3(0.0036, 0.0052, 0.0028)), k=0.0018)  # nostrils
    # ---- lips
    lp = []
    zl = -0.0715 * fl
    for sx in (1, -1):
        lp.append(Ellipsoid(H(sx * 0.0075, -0.0905, zl + 0.0065), R3(0.0115, 0.0072, 0.0055 * lips), reg=reg))          # upper lip lobes
        lp.append(Ellipsoid(H(sx * 0.0165, -0.0855, zl + 0.0035), R3(0.0095, 0.0068, 0.0036 * lips), reg=reg))
        lp.append(Ellipsoid(H(sx * 0.0115, -0.0855, zl - 0.0055), R3(0.0095, 0.0078, 0.0046 * lips), reg='Jaw'))
    lp.append(Ellipsoid(H(0, -0.0918, zl + 0.0045), R3(0.004, 0.0048, 0.0036 * lips), reg=reg))                      # tubercle
    lp.append(Ellipsoid(H(0, -0.0885, zl - 0.0072), R3(0.0155, 0.0085, 0.0064 * lips), reg='Jaw'))                    # lower lip
    face = Union([face, Union(lp, k=0.0035)], k=0.006 * hk)
    face = Sub(face, Ellipsoid(H(0, -0.074, zl), R3(0.025, 0.0225, 0.0006)), k=0.0012)                                 # mouth line
    for sx in (1, -1):
        face = Sub(face, Sphere(H(sx * 0.0242, -0.0815, zl), 0.0022 * hk), k=0.003)                                     # corners
    face = Sub(face, Ellipsoid(H(0, -0.0968, zl + 0.0145), R3(0.0032, 0.0018, 0.0068)), k=0.0035)                       # philtrum
    face = Sub(face, Ellipsoid(H(0, -0.0905, -0.0905 * fl), R3(0.015, 0.0035, 0.004)), k=0.006)                         # mentolabial fold
    # ---- ears
    ears = []
    for sx in (1, -1):
        ec = H(sx * 0.0675, 0.016, -0.009)
        Re = rot_euler(0, 0, -sx * 0.32) @ rot_euler(-0.24, 0, 0)
        def ax(v, ec=ec, Re=Re):
            v = np.array(v, float); v[0] *= sx
            return ec + Re @ (v * hk * ear)
        e1 = Ellipsoid(ax((0.004, 0.003, 0.0)), np.array([0.0058, 0.0168, 0.0285]) * hk * ear, reg=reg, R=Re)
        rim = Torus(ax((0.0068, 0.0035, 0.0015)), 0.0168 * hk * ear, 0.0027 * hk * ear, reg=reg, R=Re @ rot_euler(0, np.pi / 2, 0), sz=(1.62, 1.0))
        lobe = Ellipsoid(ax((0.005, 0.004, -0.024)), np.array([0.0045, 0.0085, 0.0085]) * hk * ear, reg=reg, R=Re)
        tragus = Ellipsoid(ax((0.004, -0.012, -0.007)), np.array([0.004, 0.004, 0.006]) * hk * ear, reg=reg, R=Re)
        e = Union([e1, rim, lobe, tragus], k=0.003)
        e = Sub(e, Ellipsoid(ax((0.0095, 0.0, -0.006)), np.array([0.0045, 0.0085, 0.0105]) * hk * ear, R=Re), k=0.0025)     # concha
        e = Sub(e, Ellipsoid(ax((0.0092, 0.0035, 0.0125)), np.array([0.0028, 0.0085, 0.0072]) * hk * ear, R=Re), k=0.002)   # upper hollow
        ears.append(e)
    face = Union([face] + ears, k=0.005 * hk)
    # ---- eyelids: shell around each eyeball, opened by an almond-shaped cut; then room for the eyeball
    eye_w = p.get('eye_w', 1.0)
    eye_h = p.get('eye_h', 1.0)
    lids = []
    cutters = []
    for sx in (1, -1):
        e = H(sx * EYE_X, EYE_Y, 0)
        r = R_EYE * hk
        a = 0.0145 * hk * eye_w
        b = 0.0053 * hk * eye_h
        tilt = sx * 0.08
        oc = e + np.array([sx * 0.0012, 0, -0.0006]) * hk
        def opening(P, oc=oc, a=a, b=b, tilt=tilt, sx=sx):
            q = P - oc
            ct, st = np.cos(tilt), np.sin(tilt)
            x = q[:, 0] * ct + q[:, 2] * st
            z = -q[:, 0] * st + q[:, 2] * ct
            bb = np.where(z > 0, b, b * 0.72)
            # inner corner slightly pointed (towards the nose)
            xx = np.where(x * sx < 0, x * 1.06, x)
            return (np.sqrt((xx / a) ** 2 + (z / bb) ** 2) - 1.0) * min(a, b)
        cyl = Func(opening, e - 0.03, e + 0.03)
        shell = Inter(Sphere(e, r + 0.0027 * hk, reg='Lid.' + ('L' if sx > 0 else 'R')),
                      Ellipsoid(e + np.array([0, -0.011, 0]) * hk, R3(0.026, 0.017, 0.022)))
        lids.append(Sub(shell, cyl, k=0.0015))
        cutters.append(Sphere(e, r + 0.0004 * hk))
    face = Union([face] + lids, k=0.0055 * hk)
    for cu in cutters:
        face = Sub(face, cu)
    return face

def eye_centres(sk):
    hk = sk.head_k
    return [sk.head_c + np.array([sx * EYE_X, EYE_Y, 0]) * hk for sx in (1, -1)], R_EYE * hk
