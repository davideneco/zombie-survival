# The 8 playable characters (v0.31.0): original designs, see godot/assets/characters/LICENSE.txt.
# Each function returns a Design (charlib/design.py) whose trees are meshed, rigged and textured by tools/build-characters.py.
import numpy as np
from .sdf import (Sphere, Ellipsoid, RoundCone, RBox, Torus, Cyl, Revolve, Union, Sub, Inter, Offset, Shell, Displace, Label, Plane, Func,
                  rot_to, rot_euler, V)
from .design import Design
from . import cloth, tex, hair, body as bodymod

def tube(path, r, mat, reg, r1=None):
    """Union of round cones along a polyline (cables, straps, handles)."""
    rr = np.linspace(r, r if r1 is None else r1, len(path))
    return Union([RoundCone(path[i], path[i + 1], rr[i], rr[i + 1], mat=mat, reg=reg) for i in range(len(path) - 1)])

def vneck(top, zv, slope=1.4, y_front=-0.02):
    """Removes a V-neck from a top: above the lines z = zv + slope |x|, in front."""
    k = np.sqrt(1 + slope * slope)
    def f(P):
        a = ((zv + slope * np.abs(P[:, 0])) - P[:, 2]) / k
        return np.maximum(a, P[:, 1] - y_front)
    return Sub(top, Func(f, np.array([-0.4, -0.5, zv - 0.05]), np.array([0.4, 0.0, zv + 0.5])), k=0.003)

def front_open(tree, z0, z1, w0, w1, y_front=-0.03):
    """Opening at the front of a coat: |x| < w(z) (w0 at z0 .. w1 at z1), in front."""
    def f(P):
        t = np.clip((P[:, 2] - z0) / (z1 - z0), 0, 1)
        w = w0 + (w1 - w0) * t
        a = np.abs(P[:, 0]) - w
        b = np.maximum(z0 - 0.02 - P[:, 2], P[:, 2] - z1)
        return np.maximum(np.maximum(a, b), P[:, 1] - y_front)
    return Sub(tree, Func(f, np.array([-0.4, -0.5, z0 - 0.1]), np.array([0.4, 0.0, z1 + 0.1])), k=0.002)

def limb_ring(d, base, bone, frac, width, h, mat, R=0.12):
    sk = d.sk
    a, b = sk.head(bone), sk.tail(bone)
    ax = (b - a) / np.linalg.norm(b - a)
    c = a + (b - a) * frac
    return cloth.ring_band(base, c, ax, -width / 2, width / 2, h, mat, reg=bone, R=R)

def toward(d, T, slide=1.0):
    """Hair field: along the scalp towards T."""
    c = d.sk.head_c
    def f(p, i):
        v = T - p
        n = p - c; n /= np.linalg.norm(n)
        v = v - n * np.dot(v, n) * slide
        return v / max(np.linalg.norm(v), 1e-9)
    return f

def fall(d, out_k=0.6, down=1.0, back=0.15, part_x=None, fwd=0.0):
    """Hair field: outwards from the head and down (loose hair), away from a parting at x = part_x."""
    c = d.sk.head_c
    def f(p, i):
        n = p - c; n[2] = max(n[2], 0) * 0.5; n /= max(np.linalg.norm(n), 1e-9)
        v = n * out_k * max(0.0, 1 - i * 0.08) + np.array([0, back, -down])
        if part_x is not None and i < 6:
            v = v + np.array([np.sign(p[0] - part_x - 1e-6) * 0.8, 0, 0])
        v = v + np.array([0, -fwd, 0])
        return v / np.linalg.norm(v)
    return f

def _arm_axis(d, s):
    sk = d.sk
    return sk.head('UpperArm.' + s), sk.head('LowerArm.' + s), sk.head('Hand.' + s)

# ====================================================================== MARC : soldier
def marc():
    d = Design('marc', sw=1.04, sh=1.02, body_p={'muscle': 1.06}, face_p={'jaw': 1.06, 'brow': 1.1, 'nose': 1.02})
    sk, P = d.sk, d.P
    d.iris = 0x4a6a80
    d.outfit = {'glove': '1c1c1e', 'sleeve': '4a5530', 'cuff': '3a4228'}
    d.fp = {'glove': 'glove', 'sleeve': 'camo', 'cuff': 'glove_cuff'}
    S = sk.S
    # combat shirt (camouflage), sleeves down, folds at the elbows
    shirt = d.loose_top('camo', t=0.006, hem=0.95, sleeve=0.93, collar=1.445, neck_front=0.5)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        shirt = cloth.folds(shirt, sho, wr, amp=0.0028, freq=70, width=0.07, centre=0.52, seed=1.3 if s == 'L' else 4.1)
        shirt = cloth.folds(shirt, sho, wr, amp=0.002, freq=55, width=0.05, centre=0.9, seed=2.0)
    shirt = cloth.folds(shirt, S(0, 0, 0.95), S(0, 0, 1.45), amp=0.0022, freq=40, width=0.07, centre=0.2, seed=0.7)
    # collar
    collar = Label(cloth.cut(cloth.cut(Offset(P['torso'], 0.016), (0, 0, 1.415), (0, 0, -1)), (0, 0, 1.47), (0, 0.45, 1)), mat='camo')
    # trousers (camouflage), cargo pockets, knee folds
    pants = d.loose_pants('camo', t=0.006, waist=1.03, cuff=0.17)
    for s in ('L', 'R'):
        hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
        pants = cloth.folds(pants, hip, an, amp=0.0026, freq=60, width=0.06, centre=0.5, seed=0.4 if s == 'L' else 2.9)
        pants = cloth.folds(pants, kn, an, amp=0.003, freq=75, width=0.04, centre=0.85, seed=1.1)
    pockets = []
    base_p = d.loose_pants('camo', t=0.006, waist=1.03, cuff=0.17)
    for s, sx in (('L', 1), ('R', -1)):
        pk, p, n, R = cloth.patch(base_p, S(sx * 0.3, -0.06, 0.64), (-sx, 0.5, 0), (0.15, 0.16), 0.022, 'camo', reg='UpperLeg.' + s, r=0.012)
        flap, *_ = cloth.patch(base_p, S(sx * 0.3, -0.06, 0.715), (-sx, 0.5, 0), (0.16, 0.045), 0.03, 'camo', reg='UpperLeg.' + s, r=0.008)
        d.seams.append(tex.box_seam(p + n * 0.011, R, (0.075, 0.011, 0.08), mats=['camo']))
        pockets += [pk, flap]
        # knee pads
        kn = sk.head('LowerLeg.' + s)
        pad, *_ = cloth.patch(base_p, kn + [0, -0.2, 0.0], (0, 1, 0), (0.11, 0.13), 0.022, 'pad', reg='LowerLeg.' + s, r=0.03)
        pockets.append(pad)
        strap = cloth.ring_band(base_p, kn, (0, 0, 1), 0.035, 0.05, 0.006, 'strap', reg='UpperLeg.' + s, R=0.12)
        strap2 = cloth.ring_band(base_p, kn, (0, 0, 1), -0.06, -0.045, 0.006, 'strap', reg='LowerLeg.' + s, R=0.12)
        pockets += [strap, strap2]
    # belt with buckle and pouches
    belt = cloth.ring_band(pants, S(0, 0, 1.0), (0, 0, 1), -0.022, 0.022, 0.006, 'strap', reg='Hips', R=0.3)
    buckle, *_ = cloth.patch(pants, S(0, -0.3, 1.0), (0, 1, 0), (0.06, 0.045), 0.016, 'metal_dark', reg='Hips', r=0.004)
    pouch_l, *_ = cloth.patch(pants, S(0.17, -0.06, 0.99), (-1, 0.3, 0), (0.08, 0.1), 0.05, 'vest', reg='Hips', r=0.012)
    # plate carrier: front and back plates over the shirt, shoulder straps, cummerbund; magazine pouches, radio, admin pouch
    torso_s = Offset(d.torso_cut(0.95, 1.5, 0.0), 0.013)
    plate_f = Inter(Offset(torso_s, 0.03), RBox(S(0, -0.12, 1.24), (0.135, 0.12, 0.17), 0.04), k=0.01)
    plate_b = Inter(Offset(torso_s, 0.03), RBox(S(0, 0.12, 1.25), (0.14, 0.12, 0.18), 0.04), k=0.01)
    cummer = cloth.ring_band(torso_s, S(0, 0, 1.15), (0, 0, 1), -0.08, 0.06, 0.018, 'vest', reg='Torso', R=0.35)
    straps = []
    for sx in (1, -1):
        straps.append(cloth.band(torso_s, [S(sx * 0.1, -0.13, 1.38), S(sx * 0.115, -0.07, 1.455), S(sx * 0.12, 0.04, 1.46), S(sx * 0.105, 0.13, 1.39)],
                                 0.03, 0.016, 'vest', reg='Torso'))
    vest = Label(Union([plate_f, plate_b, cummer] + straps, k=0.006), mat='vest', reg='Torso')
    pouches = []
    for i, x in enumerate((-0.085, 0.0, 0.085)):
        pz, p, n, R = cloth.patch(vest, S(x, -0.3, 1.15), (0, 1, 0), (0.075, 0.12), 0.042, 'vest', reg='Torso', r=0.01)
        fl, *_ = cloth.patch(vest, S(x, -0.3, 1.2), (0, 1, 0), (0.08, 0.035), 0.048, 'webbing', reg='Torso', r=0.006)
        pouches += [pz, fl]
    adm, *_ = cloth.patch(vest, S(-0.07, -0.3, 1.32), (0, 1, 0), (0.1, 0.07), 0.025, 'vest', reg='Torso', r=0.01)
    radio, *_ = cloth.patch(vest, S(0.08, -0.3, 1.31), (0, 1, 0), (0.05, 0.08), 0.045, 'plastic', reg='Torso', r=0.008)
    ant = RoundCone(S(0.095, -0.12, 1.34), S(0.1, -0.11, 1.44), 0.004, 0.003, mat='plastic', reg='Torso')
    pouches += [adm, radio, ant]
    # backpack with a rolled sleeping mat on top
    bp_c = S(0, 0.2, 1.23)
    pack = Union([RBox(bp_c, (0.14, 0.075, 0.17), 0.05, mat='pack', reg='Torso'),
                  RBox(bp_c + [0, 0.07, -0.05], (0.1, 0.035, 0.09), 0.03, mat='pack', reg='Torso'),
                  RBox(bp_c + [0, 0.0, 0.15], (0.145, 0.08, 0.04), 0.03, mat='webbing', reg='Torso')], k=0.01)
    for sx in (1, -1):
        pack = Union([pack, RBox(bp_c + [sx * 0.15, 0.0, -0.03], (0.03, 0.05, 0.08), 0.02, mat='pack', reg='Torso')], k=0.008)
    roll = Cyl(S(0, 0.2, 1.47), 0.055, 0.17, 0.02, mat='roll', reg='Torso', R=rot_to((1, 0, 0)))
    roll_straps = [Torus(S(sx * 0.1, 0.2, 1.47), 0.058, 0.005, mat='strap', reg='Torso', R=rot_to((1, 0, 0))) for sx in (1, -1)]
    # boots
    boots = [d.shoe(s, 'boot', 'sole', shaft=0.135, width=1.06) for s in ('L', 'R')]
    d.garments = [shirt, collar, pants, belt, buckle, pouch_l, vest] + pockets + pouches + [pack, roll] + roll_straps + boots
    # helmet: shell with a camo cover, band, rim; night-vision mount at the front; chin strap
    hk = sk.head_k
    hc = sk.head_c
    dome = Ellipsoid(d.H(0, 0.012, 0.035), np.array([0.096, 0.112, 0.106]) * hk)
    helm = Inter(dome, Plane(d.H(0, 0.0, 0.026), np.array([0, -0.32, -1.0])), k=0.006)
    helm = Sub(helm, Ellipsoid(d.H(0, 0.012, 0.03), np.array([0.083, 0.099, 0.094]) * hk), k=0.003)
    helm = Label(helm, mat='helmet', reg='Head')
    band_h = Label(Inter(Inter(Offset(dome, 0.003), RBox(d.H(0, 0.012, 0.075), np.array([0.2, 0.2, 0.009]) * hk, 0.003)), Plane(d.H(0, 0.0, 0.03), np.array([0, -0.32, -1.0]))), mat='strap', reg='Head')
    mount = Union([RBox(d.H(0, -0.104, 0.082), np.array([0.022, 0.012, 0.018]) * hk, 0.004, mat='metal_dark', reg='Head'),
                   RBox(d.H(0, -0.118, 0.096), np.array([0.012, 0.012, 0.012]) * hk, 0.003, mat='metal_dark', reg='Head')], k=0.004)
    rails = [RBox(d.H(sx * 0.093, 0.0, 0.045), np.array([0.006, 0.045, 0.008]) * hk, 0.003, mat='metal_dark', reg='Head', R=rot_euler(0, sx * -0.25, 0)) for sx in (1, -1)]
    chin = []
    for sx in (1, -1):
        chin.append(RoundCone(d.H(sx * 0.085, -0.012, 0.03), d.H(sx * 0.052, -0.04, -0.095), 0.0035, 0.0035, mat='strap', reg='Head'))
        chin.append(RoundCone(d.H(sx * 0.052, -0.04, -0.095), d.H(0, -0.05, -0.128), 0.0035, 0.0035, mat='strap', reg='Jaw'))
    d.head_gear = [helm, band_h, mount] + rails + chin + [d.hair_cap('hair', t=0.0025, front=0.058, temple=0.034, side=0.02, nape=-0.05)]
    # tactical gloves with knuckle pads
    d.hand_gear = d.glove('glove', t=0.0018, cuff_len=0.055, cuff_t=0.0035, cuff_mat='glove_cuff')
    d.palette = {
        'skin': dict(kind='skin', color=0xc48c6a, stubble=0.6, lips=0x9a5e52),
        'hair': dict(kind='hair', color=0x2b1d12),
        'camo': dict(kind='camo', colors=[0x5f6444, 0x3e4a2a, 0x4a3b2a, 0x1c1f17], rough=0.88, scale=0.06),
        'vest': dict(kind='cordura', color=0x2a2b25, rough=0.8, molle=True),
        'webbing': dict(kind='webbing', color=0x23241f, rough=0.85),
        'strap': dict(kind='webbing', color=0x1d1e1a, rough=0.8),
        'pad': dict(kind='rubber', color=0x1e1f1c, rough=0.6),
        'helmet': dict(kind='camo', colors=[0x5c6142, 0x3e4a2a, 0x4a3b2a, 0x1c1f17], rough=0.85, scale=0.045),
        'metal_dark': dict(kind='metal', color=0x2d2f30, rough=0.45, metal=0.8),
        'plastic': dict(kind='plastic', color=0x1a1b1c, rough=0.5),
        'pack': dict(kind='cordura', color=0x4d5236, rough=0.85),
        'roll': dict(kind='foam', color=0x5a5a46, rough=0.9),
        'boot': dict(kind='leather', color=0x2a2219, rough=0.6),
        'sole': dict(kind='rubber', color=0x111111, rough=0.85),
        'glove': dict(kind='synthetic', color=0x1c1c1e, rough=0.7),
        'glove_cuff': dict(kind='synthetic', color=0x2a2b25, rough=0.8),
    }
    d.hair = None
    return d


# ====================================================================== LEA : nurse
def lea():
    d = Design('lea', sw=0.94, sh=0.97, fem=True, arm_out=0.03, body_p={'bust': 0.92, 'thin': 0.97}, face_p={'eye_w': 1.04, 'lips': 1.15, 'nose': 0.88, 'chin': 0.85})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x3a7a98
    d.outfit = {'glove': '4aa8e0', 'sleeve': 'e8ecf0', 'cuff': '2c6a90'}
    d.fp = {'glove': 'nitrile', 'sleeve': 'coat', 'cuff': 'scrubs'}
    # scrubs: V-neck top with short sleeves, loose trousers
    top = d.loose_top('scrubs', t=0.004, hem=0.93, sleeve=-0.5, collar=1.44, neck_front=0.3)
    top = vneck(top, S(0, 0, 1.33)[2], 1.3)
    pants = d.loose_pants('scrubs', t=0.007, waist=1.02, cuff=0.08)
    for s in ('L', 'R'):
        hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
        pants = cloth.folds(pants, kn, an, amp=0.0025, freq=60, width=0.05, centre=0.85, seed=1.7)
    # white lab coat, open in front, to mid-thigh, sleeves to the wrist; lapels, pockets, pens, badge
    coat = d.loose_top('coat', t=0.009, hem=0.94, sleeve=0.95, collar=1.47, neck_front=0.35)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        coat = cloth.folds(coat, sho, wr, amp=0.0025, freq=60, width=0.07, centre=0.5, seed=0.9 if s == 'L' else 3.3)
    coat = front_open(coat, 0.9, 1.47, 0.07, 0.085)
    skirt = d.skirt('coat', 1.0, 0.56, 0.185, 0.215, sy=0.78, front_open=0.075, back_slit=0.14, folds=0.0025, seed=1.0)
    lapels = []
    for sx in (1, -1):
        lapels.append(cloth.band(coat, [S(sx * 0.095, -0.07, 1.44), S(sx * 0.1, -0.13, 1.3), S(sx * 0.085, -0.15, 1.18)], 0.024, 0.004, 'coat', reg='Torso'))
    extra = []
    for sx in (1, -1):
        pk, p, n, R = cloth.patch(skirt, S(sx * 0.13, -0.4, 0.84), (0, 1, 0), (0.12, 0.13), 0.01, 'coat', reg='Skirt', r=0.008)
        extra.append(pk)
        d.seams.append(tex.box_seam(p + n * 0.005, R, (0.06, 0.005, 0.065), mats=['coat']))
    cp, p, n, R = cloth.patch(coat, S(-0.1, -0.4, 1.27), (0, 1, 0), (0.08, 0.09), 0.008, 'coat', reg='Torso', r=0.006)
    extra.append(cp)
    for i, x in enumerate((-0.085, -0.1, -0.113)):
        extra.append(Cyl(S(x, -0.155, 1.31), 0.0045, 0.035, 0.002, mat=['pen_blue', 'pen_black', 'pen_blue'][i], reg='Torso'))
    badge, *_ = cloth.patch(coat, S(0.11, -0.4, 1.27), (0, 1, 0), (0.055, 0.075), 0.004, 'badge', reg='Torso', r=0.004)
    extra.append(badge)
    # stethoscope: tubing around the neck, chest piece, ear pieces
    st = tube([S(-0.06, -0.15, 1.2), S(-0.075, -0.125, 1.33), S(-0.08, -0.06, 1.445), S(-0.03, 0.06, 1.475), S(0.03, 0.06, 1.475),
               S(0.08, -0.06, 1.445), S(0.07, -0.12, 1.35), S(0.055, -0.14, 1.25)], 0.0045, 'rubber', 'Torso')
    chest = Cyl(S(-0.06, -0.152, 1.19), 0.017, 0.006, 0.003, mat='steel', reg='Torso', R=rot_to((0, -1, 0)))
    ears = Union([tube([S(0.055, -0.14, 1.25), S(0.04, -0.15, 1.2)], 0.003, 'steel', 'Torso'), Sphere(S(0.04, -0.152, 1.195), 0.006, mat='rubber', reg='Torso')])
    extra += [st, chest, ears]
    # medical bag across the body (strap from the right shoulder to the left hip), white cross
    strap = cloth.band(Offset(coat, 0.002), [S(-0.1, -0.14, 1.42), S(-0.13, -0.05, 1.45), S(-0.12, 0.12, 1.37), S(0.04, 0.15, 1.15), S(0.19, 0.05, 0.98)], 0.022, 0.005, 'bag_strap', reg='Torso')
    strap_f = cloth.band(Offset(coat, 0.002), [S(-0.1, -0.14, 1.42), S(0.0, -0.17, 1.2), S(0.2, -0.08, 1.0)], 0.022, 0.005, 'bag_strap', reg='Torso')
    bag = RBox(S(0.225, -0.01, 0.92), (0.035, 0.13, 0.09), 0.025, mat='bag', reg='Hips')
    flap = RBox(S(0.25, -0.01, 0.96), (0.02, 0.132, 0.055), 0.015, mat='bag', reg='Hips')
    crossv = RBox(S(0.264, -0.01, 0.94), (0.006, 0.012, 0.035), 0.002, mat='cross_white', reg='Hips')
    crossh = RBox(S(0.264, -0.01, 0.94), (0.006, 0.035, 0.012), 0.002, mat='cross_white', reg='Hips')
    extra += [strap, strap_f, bag, flap, crossv, crossh]
    # red-cross armband on the right sleeve
    arm_b = limb_ring(d, coat, 'UpperArm.R', 0.42, 0.06, 0.003, 'armband', R=0.09)
    sho = sk.head('UpperArm.R'); el = sk.head('LowerArm.R')
    mid = sho + (el - sho) * 0.42
    cx = mid + np.array([-0.072, 0.0, 0.0])
    extra += [arm_b, RBox(cx, (0.006, 0.008, 0.022), 0.002, mat='cross_red', reg='UpperArm.R'), RBox(cx, (0.006, 0.022, 0.008), 0.002, mat='cross_red', reg='UpperArm.R')]
    shoes = [d.shoe(s, 'sneaker', 'sole_white', shaft=0.0, width=0.95, sole_h=0.022) for s in ('L', 'R')]
    d.garments = [top, pants, coat, skirt] + lapels + extra + shoes
    # head: hair cap, red headband, ponytail cards
    cap = d.hair_cap('hair', t=0.006, front=0.06, temple=0.034, side=0.018, nape=-0.05, volume=0.02, whorl=d.H(0, 0.09, 0.045))
    nb = np.array([0, 0.94, 0.33]); nb /= np.linalg.norm(nb)
    band = Label(Inter(Offset(d.skull(), 0.0115), Func(lambda P, c=sk.head_c, hk=sk.head_k: np.abs(((P - c) / hk - np.array([0, -0.035, 0.0])) @ nb) * hk - 0.009,
                                                    sk.head_c - 0.2, sk.head_c + 0.2)), mat='band', reg='Head')
    d.head_gear = [cap, band]
    d.hand_gear = d.glove('nitrile', t=0.0009, cuff_len=0.075, cuff_t=0.0012)
    hl = d.hairline
    T = d.H(0, 0.09, 0.045)
    roots = hair.scalp_roots(d, 260, lambda q: hl(q) - 0.004, seed=2)
    L = np.linalg.norm(roots - T, axis=1) * 1.05
    top_locks = hair.grow(d, roots, toward(d, T, 0.9), L, step=0.016, lift=0.002)
    tie_r = [T + np.array([np.cos(a) * 0.014, 0.004, np.sin(a) * 0.014]) for a in np.linspace(0, 6.28, 60, endpoint=False)]
    pony = hair.grow(d, np.array(tie_r), lambda p, i: np.array([0, 0.5 - i * 0.02, -1.0]) / np.hypot(0.5, 1), [0.24, 0.28, 0.3], step=0.02,
                     gravity=0.6, lift=0.0, collide=d.B.nude(with_hands=False), curl=0.25, seed=4)
    d.hair = {'color': 0x7a2e12, 'groups': [{'locks': pony, 'width': 0.034, 'layers': 3, 'taper': 0.6}],
              'rough': 0.5}
    d.head_gear.append(Label(Torus(T + np.array([0, 0.004, 0]) * 1, 0.013, 0.006, R=rot_to((0, 1, -0.3))), mat='band', reg='Head'))
    d.palette = {
        'skin': dict(kind='skin', color=0xe2b392, lips=0xb45e66, brow=0x6a2c14, blush=0xd0706a),
        'hair': dict(kind='hair', color=0x7a2e12),
        'scrubs': dict(kind='cotton', color=0x3f86b8, rough=0.85),
        'coat': dict(kind='cotton', color=0xeef1f3, rough=0.75, vary=0.04),
        'pen_blue': dict(kind='plastic', color=0x2a4aa0, rough=0.35), 'pen_black': dict(kind='plastic', color=0x18181a, rough=0.35),
        'badge': dict(kind='plastic', color=0xd8e6f0, rough=0.3),
        'rubber': dict(kind='rubber', color=0x1c1c20, rough=0.45), 'steel': dict(kind='metal', color=0xc8ccd0, rough=0.25, metal=0.95),
        'bag_strap': dict(kind='webbing', color=0x2a5a40, rough=0.8), 'bag': dict(kind='cordura', color=0x3a7a52, rough=0.8),
        'cross_white': dict(kind='plastic', color=0xf2f2f0, rough=0.6), 'cross_red': dict(kind='cotton', color=0xc8202c, rough=0.7),
        'armband': dict(kind='cotton', color=0xf4f4f2, rough=0.8),
        'sneaker': dict(kind='synthetic', color=0xf2f2f2, rough=0.6), 'sole_white': dict(kind='rubber', color=0xd8d8dc, rough=0.7),
        'nitrile': dict(kind='synthetic', color=0x4aa0d8, rough=0.35), 'band': dict(kind='knit', color=0xc22a3a, rough=0.85),
        '_dirt': 0.12,
    }
    d.budget = {'body': 14000, 'head': 6500, 'hands': 2400, 'props': 1200}
    return d

# ====================================================================== KARIM : firefighter
def karim():
    d = Design('karim', sw=1.1, sh=1.04, body_p={'muscle': 1.08, 'belly': 0.02}, face_p={'jaw': 1.1, 'nose': 1.08, 'nose_w': 1.15, 'lips': 1.15, 'brow': 1.1})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x3a2a1c
    d.outfit = {'glove': '2a2622', 'sleeve': 'c86a1e', 'cuff': '2a2a2e'}
    d.fp = {'glove': 'glove_leather', 'sleeve': 'turnout', 'cuff': 'turnout_dark'}
    jacket = d.loose_top('turnout', t=0.02, hem=0.98, sleeve=0.97, collar=1.5, neck_front=0.15)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        jacket = cloth.folds(jacket, sho, wr, amp=0.004, freq=50, width=0.07, centre=0.52, seed=0.3 if s == 'L' else 2.2)
    jacket = cloth.folds(jacket, S(0, 0, 0.82), S(0, 0, 1.45), amp=0.003, freq=35, width=0.08, centre=0.35, seed=1.5)
    jskirt = d.skirt('turnout', 1.04, 0.76, 0.2, 0.215, sy=0.82, front_open=0.0, back_slit=0.0, folds=0.003, seed=0.5, thick=0.006)
    pants = d.loose_pants('turnout_p', t=0.016, waist=1.02, cuff=0.2)
    for s in ('L', 'R'):
        hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
        pants = cloth.folds(pants, kn, an, amp=0.004, freq=55, width=0.05, centre=0.7, seed=0.8)
    bands = []
    bands.append(cloth.ring_band(jacket, S(0, 0, 1.2), (0, 0, 1), -0.025, 0.025, 0.003, 'refl', reg='Torso', R=0.4))
    bands.append(cloth.ring_band(jskirt, S(0, 0, 0.82), (0, 0, 1), -0.025, 0.025, 0.003, 'refl', reg='Skirt', R=0.4))
    for s in ('L', 'R'):
        bands.append(limb_ring(d, jacket, 'UpperArm.' + s, 0.75, 0.05, 0.003, 'refl', R=0.1))
        bands.append(limb_ring(d, jacket, 'LowerArm.' + s, 0.6, 0.05, 0.003, 'refl', R=0.1))
        bands.append(limb_ring(d, pants, 'LowerLeg.' + s, 0.35, 0.05, 0.003, 'refl', R=0.12))
        bands.append(limb_ring(d, pants, 'LowerLeg.' + s, 0.55, 0.05, 0.003, 'refl', R=0.12))
    flap = cloth.band(Union([jacket, jskirt]), [S(0.0, -0.25, 1.48), S(0.0, -0.25, 0.78)], 0.03, 0.005, 'turnout', reg='Torso')
    hooks = [RBox(S(0.0, -0.165, z), (0.012, 0.006, 0.006), 0.002, mat='steel', reg='Torso') for z in (1.36, 1.26, 1.06, 0.96)]
    collar = Label(cloth.cut(cloth.cut(Offset(P['torso'], 0.03), (0, 0, 1.43), (0, 0, -1)), (0, 0, 1.53), (0, 0.25, 1)), mat='turnout_dark')
    pk = []
    for sx in (1, -1):
        pp, p, n, R = cloth.patch(jskirt, S(sx * 0.13, -0.4, 0.87), (0, 1, 0), (0.13, 0.13), 0.03, 'turnout', reg='Skirt', r=0.012)
        pk.append(pp)
        fl, *_ = cloth.patch(jskirt, S(sx * 0.13, -0.4, 0.94), (0, 1, 0), (0.14, 0.04), 0.036, 'turnout_dark', reg='Skirt', r=0.01)
        pk.append(fl)
    radio, *_ = cloth.patch(jacket, S(-0.1, -0.4, 1.33), (0, 1, 0), (0.05, 0.1), 0.03, 'plastic', reg='Torso', r=0.008)
    pk.append(radio)
    # breathing apparatus: harness, back plate, cylinder, valve, hose; axe on the back
    harness = []
    torso_c = Offset(d.G.parts['torso'], 0.02)
    for sx in (1, -1):
        harness.append(cloth.band(torso_c, [S(sx * 0.11, -0.16, 1.15), S(sx * 0.12, -0.12, 1.38), S(sx * 0.12, -0.02, 1.47), S(sx * 0.11, 0.12, 1.4)], 0.028, 0.008, 'harness', reg='Torso'))
    belt_h = cloth.ring_band(jacket, S(0, 0, 1.0), (0, 0, 1), -0.03, 0.03, 0.009, 'harness', reg='Hips', R=0.35)
    plate = RBox(S(0, 0.17, 1.2), (0.13, 0.015, 0.21), 0.02, mat='plastic', reg='Torso')
    cyl = Union([Cyl(S(0, 0.25, 1.21), 0.078, 0.24, 0.05, mat='tank', reg='Torso'),
                 Cyl(S(0, 0.25, 0.94), 0.025, 0.03, 0.006, mat='steel', reg='Torso')], k=0.01)
    valve = Cyl(S(0, 0.25, 0.9), 0.018, 0.012, 0.004, mat='steel', reg='Torso', R=rot_to((1, 0, 0)))
    hose = tube([S(0, 0.24, 0.9), S(0.1, 0.2, 0.95), S(0.16, 0.08, 1.15), S(0.13, -0.08, 1.3), S(0.07, -0.16, 1.35)], 0.008, 'rubber', 'Torso')
    strap_t = [Torus(S(0, 0.25, z), 0.08, 0.006, mat='harness', reg='Torso') for z in (1.08, 1.34)]
    axe = Union([tube([S(-0.2, 0.17, 0.92), S(0.16, 0.2, 1.5)], 0.016, 'wood', 'Torso', r1=0.014),
                 RBox(S(0.2, 0.205, 1.52), (0.075, 0.012, 0.035), 0.006, mat='axe_head', reg='Torso', R=rot_euler(0, -0.99, 0)),
                 RBox(S(0.24, 0.205, 1.6), (0.02, 0.01, 0.06), 0.004, mat='axe_head', reg='Torso', R=rot_euler(0, -0.99, 0))], k=0.004)
    boots = [d.shoe(s, 'boot_rubber', 'sole', shaft=0.2, width=1.1) for s in ('L', 'R')]
    boot_bands = [cloth.ring_band(boots[i], sk.head('Foot.' + s) + [0, 0, 0.17], (0, 0, 1), -0.012, 0.012, 0.002, 'refl', reg='LowerLeg.' + s, R=0.1) for i, s in enumerate('LR')]
    d.garments = [jacket, jskirt, pants, collar, flap] + hooks + bands + pk + harness + [belt_h, plate, cyl, valve, hose] + strap_t + [axe] + boots + boot_bands
    # helmet: dome with crest, visor, neck flap; buzz cut and a short beard
    hk = sk.head_k
    dome = Ellipsoid(d.H(0, 0.008, 0.04), np.array([0.1, 0.118, 0.11]) * hk)
    helm = Inter(dome, Plane(d.H(0, 0.0, 0.02), np.array([0, -0.25, -1.0])), k=0.006)
    helm = Sub(helm, Ellipsoid(d.H(0, 0.008, 0.035), np.array([0.087, 0.105, 0.098]) * hk), k=0.003)
    crest = Inter(Offset(dome, 0.006), RBox(d.H(0, 0.02, 0.13), np.array([0.012, 0.13, 0.06]) * hk, 0.006))
    brim = Inter(Revolve(d.H(0, 0.008, 0.0), [(0.0, -0.004), (0.123, -0.004), (0.127, 0.0), (0.0, 0.004)], sxy=(1.0, 1.12)),
                 Plane(d.H(0, 0.0, 0.0), np.array([0, 0.4, -1.0])))
    visor = Inter(Shell(Ellipsoid(d.H(0, 0.006, 0.04), np.array([0.109, 0.127, 0.118]) * hk), 0.002), RBox(d.H(0, -0.1, 0.105), np.array([0.085, 0.06, 0.026]) * hk, 0.01))
    flap_n = Inter(Shell(Ellipsoid(d.H(0, 0.02, -0.01), np.array([0.105, 0.115, 0.1]) * hk), 0.003),
                   Inter(Plane(d.H(0, 0.03, 0.0), np.array([0, -1.0, 0.0])), Plane(d.H(0, 0, 0.02), np.array([0, 0, 1.0]))))
    flap_n = Inter(flap_n, Plane(d.H(0, 0, -0.085), np.array([0, 0, -1.0])))
    rim = Inter(Inter(Offset(dome, 0.004), Plane(d.H(0, 0.0, 0.034), np.array([0, -0.25, -1.0]))), Plane(d.H(0, 0.0, 0.046), np.array([0, 0.25, 1.0])))
    d.head_gear = [Label(helm, mat='helmet', reg='Head'), Label(crest, mat='helmet', reg='Head'), Label(rim, mat='helmet', reg='Head'),
                   Label(visor, mat='visor', reg='Head'), Label(flap_n, mat='turnout_dark', reg='Head'),
                   d.hair_cap('hair', t=0.002, front=0.06, temple=0.034, side=0.02, nape=-0.05)]
    for sx in (1, -1):
        d.head_gear.append(Label(cloth.band(dome, [d.H(sx * 0.096, 0.0, 0.0), d.H(sx * 0.08, -0.02, -0.06)], 0.0055, 0.002, 'harness'), reg='Head'))
    # beard: a shell over the lower face (texture: hair)
    def beard_zone(Pp, c=sk.head_c, hk=hk):
        q = (Pp - c) / hk
        top = q[:, 2] + 0.047 + 0.25 * np.clip(q[:, 1] + 0.06, 0, 1)       # under the nose at the front, along the jaw at the sides
        back = q[:, 1] - 0.012                                              # in front of the ears
        under = -(q[:, 2] + 0.135)                                          # stops under the chin
        return np.maximum(np.maximum(top, back), under) * hk
    beard = Inter(Offset(d.face, 0.0022), Func(beard_zone, sk.head_c - 0.2, sk.head_c + 0.2), k=0.004)
    beard = Sub(beard, Ellipsoid(d.H(0, -0.095, -0.0725), np.array([0.026, 0.03, 0.0115]) * hk), k=0.004)
    d.head_gear.append(Label(beard, mat='beard', reg='Jaw'))
    d.hand_gear = d.glove('glove_leather', t=0.003, cuff_len=0.08, cuff_t=0.006, cuff_mat='turnout_dark')
    d.palette = {
        'skin': dict(kind='skin', color=0x8a5638, lips=0x6e3a32, brow=0x141010, blush=0x7a3a2a, stubble=0.3),
        'hair': dict(kind='hair', color=0x121010), 'beard': dict(kind='hair', color=0x3a2c22),
        'turnout': dict(kind='canvas', color=0xc8661c, rough=0.85, vary=0.1), 'turnout_p': dict(kind='canvas', color=0x23293a, rough=0.85),
        'turnout_dark': dict(kind='canvas', color=0x2a2a2e, rough=0.85),
        'refl': dict(kind='reflective', color=0xd8dc30, rough=0.3, metal=0.2, glow=0.08),
        'steel': dict(kind='metal', color=0xb0b4b8, rough=0.35, metal=0.9), 'plastic': dict(kind='plastic', color=0x18181a, rough=0.45),
        'harness': dict(kind='webbing', color=0x1a1a1c, rough=0.8), 'tank': dict(kind='metal', color=0xc0c4c8, rough=0.3, metal=0.85),
        'rubber': dict(kind='rubber', color=0x141416, rough=0.55), 'wood': dict(kind='leather', color=0x6a4426, rough=0.6),
        'axe_head': dict(kind='metal', color=0x9a1a18, rough=0.4, metal=0.5),
        'boot_rubber': dict(kind='rubber', color=0x121214, rough=0.4), 'sole': dict(kind='rubber', color=0x0c0c0c, rough=0.85, tread=True),
        'helmet': dict(kind='plastic', color=0xe8c020, rough=0.3), 'visor': dict(kind='glass', color=0x403a18, rough=0.05),
        'glove_leather': dict(kind='leather', color=0x2a2622, rough=0.65),
        '_dirt': 0.35,
    }
    d.budget = {'body': 15500, 'head': 7500, 'hands': 2600, 'props': 1200}
    return d

# ====================================================================== CHLOE : student
def chloe():
    d = Design('chloe', sw=0.96, sh=0.99, fem=True, body_p={'bust': 0.9, 'thin': 0.95}, face_p={'eye_w': 1.05, 'nose': 0.86, 'lips': 1.12, 'chin': 0.82, 'round': 1.02})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x4a3020
    d.outfit = {'glove': 'e6dcc8', 'sleeve': 'b8283c', 'cuff': '8a1c2c'}
    d.fp = {'glove': 'knit_glove', 'sleeve': 'parka', 'cuff': 'parka'}
    # quilted red parka (horizontal channels), zip, pockets, hood folded at the back
    parka = d.loose_top('parka', t=0.026, hem=0.86, sleeve=0.96, collar=1.47, neck_front=0.25, k=0.05)
    def quilt(Pp):
        return -0.0035 * np.abs(np.sin(Pp[:, 2] * np.pi / 0.075))
    parka = Displace(parka, quilt, 0.0035)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        parka = cloth.folds(parka, sho, wr, amp=0.003, freq=50, width=0.07, centre=0.55, seed=1.1 if s == 'L' else 3.7)
    zipb = cloth.band(parka, [S(0.0, -0.25, 1.46), S(0.0, -0.25, 0.86)], 0.007, 0.003, 'zip', reg='Torso')
    hood = Union([Ellipsoid(S(0, 0.13, 1.42), (0.13, 0.06, 0.07), mat='parka', reg='Torso', R=rot_euler(0.35, 0, 0)),
                  Torus(S(0, 0.095, 1.45), 0.1, 0.022, mat='parka', reg='Torso', R=rot_euler(0.5, 0, 0), sz=(1.1, 0.85))], k=0.02)
    pk = []
    for sx in (1, -1):
        pp, p, n, R = cloth.patch(parka, S(sx * 0.13, -0.4, 0.95), (0, 1, 0), (0.12, 0.1), 0.012, 'parka', reg='Hips', r=0.01)
        pk.append(pp)
    jeans = d.loose_pants('denim', t=0.003, waist=1.0, cuff=0.08)
    for s in ('L', 'R'):
        hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
        jeans = cloth.folds(jeans, kn, an, amp=0.002, freq=70, width=0.04, centre=0.9, seed=2.2)
        jeans = cloth.folds(jeans, hip, kn, amp=0.0016, freq=60, width=0.05, centre=0.95, seed=0.6)
    for s, sx in (('L', 1), ('R', -1)):
        d.seams.append(tex.plane_seam(S(sx * 0.17, 0, 0), (1, 0, 0), mats=['denim']))
    # chunky knitted scarf, headphones round the neck
    scarf = Union([Torus(S(0, -0.005, 1.455), 0.078, 0.028, mat='scarf', reg='Neck', R=rot_euler(0.15, 0, 0), sz=(1.0, 1.05)),
                   Torus(S(0, -0.01, 1.42), 0.09, 0.025, mat='scarf', reg='Torso', R=rot_euler(0.2, 0, 0), sz=(1.05, 1.0)),
                   tube([S(0.05, -0.1, 1.42), S(0.06, -0.15, 1.33), S(0.065, -0.16, 1.22)], 0.028, 'scarf', 'Torso', r1=0.022)], k=0.012)
    phones = Union([Torus(S(0, 0.0, 1.5), 0.085, 0.007, mat='plastic', reg='Neck', R=rot_euler(0.25, 0, 0)),
                    Cyl(S(0.088, -0.015, 1.485), 0.032, 0.014, 0.008, mat='plastic', reg='Neck', R=rot_to((1, 0, 0))),
                    Cyl(S(-0.088, -0.015, 1.485), 0.032, 0.014, 0.008, mat='plastic', reg='Neck', R=rot_to((1, 0, 0)))], k=0.004)
    # light-blue backpack with straps and a front pocket
    bp = Union([RBox(S(0, 0.22, 1.2), (0.13, 0.065, 0.17), 0.06, mat='pack', reg='Torso'),
                RBox(S(0, 0.29, 1.13), (0.1, 0.03, 0.08), 0.03, mat='pack2', reg='Torso')], k=0.008)
    straps = []
    for sx in (1, -1):
        straps.append(cloth.band(Offset(parka, 0.003), [S(sx * 0.09, 0.15, 1.38), S(sx * 0.1, 0.0, 1.49), S(sx * 0.1, -0.15, 1.37), S(sx * 0.12, -0.12, 1.05)],
                                 0.022, 0.012, 'pack2', reg='Torso'))
    keyring = Sphere(S(0.11, 0.33, 1.08), 0.012, mat='charm', reg='Torso')
    shoes = [d.shoe(s, 'sneaker', 'sole_white', shaft=0.0, width=0.95, sole_h=0.026) for s in ('L', 'R')]
    d.garments = [parka, zipb, hood] + pk + [jeans, scarf, phones, bp] + straps + [keyring] + shoes
    cap = d.hair_cap('hair', t=0.006, front=0.06, temple=0.034, side=0.016, nape=-0.06, volume=0.03, whorl=d.H(0.018, -0.02, 0.12))
    hk = sk.head_k
    fringe = Inter(Offset(d.skull(), 0.009), Func(lambda Pp, c=sk.head_c, hk=hk: np.maximum(np.maximum(0.033 - (Pp[:, 2] - c[2]) / hk, (Pp[:, 1] - c[1]) / hk + 0.04),
                                                                                       np.abs((Pp[:, 0] - c[0]) / hk) - 0.062) * hk, sk.head_c - 0.2, sk.head_c + 0.2), k=0.004)
    def fringe_g(Pp, c=sk.head_c):
        return -0.0008 * (0.5 + 0.5 * np.sin((Pp[:, 0] - c[0]) * 1300.0 + 2.0 * np.sin(Pp[:, 2] * 300.0)))
    d.head_gear = [cap, Label(Displace(fringe, fringe_g, 0.0008), mat='hair', reg='Head')]
    d.hand_gear = d.glove('knit_glove', t=0.003, cuff_len=0.08, cuff_t=0.004)
    # long hair, side parting, bangs
    hl = d.hairline
    body_col = Union([d.B.nude(with_hands=False), Offset(d.G.parts['torso'], 0.03), scarf, hood])
    roots = hair.scalp_roots(d, 230, lambda q: hl(q) - 0.004, seed=5)
    front = roots[(roots[:, 1] - sk.head_c[1]) / sk.head_k < -0.045]
    rest = roots[(roots[:, 1] - sk.head_c[1]) / sk.head_k >= -0.045]
    locks = hair.grow(d, rest, fall(d, out_k=0.5, down=0.9, back=0.25, part_x=sk.head_c[0] + 0.018), [0.36, 0.4, 0.44], step=0.022,
                      gravity=0.8, lift=0.004, collide=body_col, seed=6, curl=0.08)
    bangs = hair.grow(d, front[::3], lambda p, i: np.array([0.15, -0.6, -0.8]) / np.linalg.norm([0.15, -0.6, -0.8]), [0.05, 0.06], step=0.008,
                      gravity=0.6, lift=0.008, seed=7)
    d.hair = {'color': 0x2a2026, 'groups': [{'locks': locks, 'width': 0.04, 'taper': 0.45}, {'locks': bangs, 'width': 0.022, 'layers': 2, 'taper': 0.5}], 'rough': 0.45}
    d.palette = {
        'skin': dict(kind='skin', color=0xc7956f, lips=0xa4545c, brow=0x1c1414, blush=0xc06058),
        'hair': dict(kind='hair', color=0x2a2026),
        'parka': dict(kind='nylon', color=0xb02236, rough=0.45, vary=0.06), 'zip': dict(kind='metal', color=0x2a2a2c, rough=0.4, metal=0.7),
        'denim': dict(kind='denim', color=0x3a5c96, rough=0.85, vary=0.12),
        'scarf': dict(kind='knit', color=0xe8dcc0, rough=0.9), 'plastic': dict(kind='plastic', color=0x1a1a1e, rough=0.35),
        'pack': dict(kind='cordura', color=0x7ab4d6, rough=0.75), 'pack2': dict(kind='cordura', color=0x5a96b8, rough=0.75),
        'charm': dict(kind='plastic', color=0xffd24a, rough=0.3),
        'sneaker': dict(kind='synthetic', color=0xf0f0f0, rough=0.6), 'sole_white': dict(kind='rubber', color=0xdcdcdc, rough=0.7),
        'knit_glove': dict(kind='knit', color=0xe6dcc8, rough=0.9),
        '_dirt': 0.12,
    }
    d.budget = {'body': 13000, 'head': 6000, 'hands': 2400, 'props': 1200}
    return d

# ====================================================================== LUCIAN : "the Purifier"
def lucian():
    d = Design('lucian', sw=1.03, sh=1.05, arm_out=0.03, body_p={'muscle': 1.03}, face_p={'jaw': 1.05, 'brow': 1.2, 'nose': 1.05})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x2a1a10
    d.outfit = {'glove': '1e1e22', 'sleeve': '18181c', 'cuff': 'e8e8ee'}
    d.fp = {'glove': 'glove', 'sleeve': 'coat', 'cuff': 'trim'}
    coat = d.loose_top('coat', t=0.016, hem=0.95, sleeve=0.96, collar=1.5, neck_front=0.1)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        coat = cloth.folds(coat, sho, wr, amp=0.003, freq=48, width=0.07, centre=0.52, seed=0.4 if s == 'L' else 2.6)
    skirt = d.skirt('coat', 1.0, 0.3, 0.2, 0.27, sy=0.8, front_open=0.03, back_slit=0.3, folds=0.006, seed=2.0)
    collar = Label(cloth.cut(cloth.cut(Offset(P['torso'], 0.032), (0, 0, 1.42), (0, 0, -1)), (0, 0, 1.56), (0, 0.15, 1)), mat='coat')
    trims = [cloth.band(Offset(coat, 0.002), [S(0.03, -0.2, 1.46), S(0.03, -0.2, 0.96)], 0.01, 0.003, 'trim', reg='Torso'),
             cloth.band(Offset(skirt, 0.002), [S(0.03, -0.3, 0.98), S(0.03, -0.3, 0.3)], 0.01, 0.003, 'trim', reg='Skirt'),
             cloth.ring_band(skirt, S(0, 0, 0.3), (0, 0, 1), 0.0, 0.02, 0.003, 'trim', reg='Skirt', R=0.5)]
    buttons = []
    for z in (1.38, 1.28, 1.18, 1.08):
        for sx in (-0.07, 0.07):
            p, n = cloth.surf(coat, S(sx, -0.4, z), (0, 1, 0))
            buttons.append(Cyl(p + n * 0.002, 0.009, 0.003, 0.002, mat='gold', reg='Torso', R=rot_to(n)))
    belt = cloth.ring_band(coat, S(0, 0, 1.03), (0, 0, 1), -0.022, 0.022, 0.006, 'leather', reg='Hips', R=0.4)
    buckle, *_ = cloth.patch(belt, S(0, -0.4, 1.03), (0, 1, 0), (0.06, 0.05), 0.01, 'gold', reg='Hips', r=0.006)
    epaul = []
    for s, sx in (('L', 1), ('R', -1)):
        sho = sk.head('UpperArm.' + s)
        epaul.append(RBox(sho + [sx * -0.03, 0.0, 0.07], (0.065, 0.055, 0.012), 0.01, mat='gold', reg='Torso', R=rot_euler(0, sx * 0.3, 0)))
        for k in range(5):
            epaul.append(RoundCone(sho + [sx * 0.03, -0.04 + k * 0.02, 0.06], sho + [sx * 0.045, -0.04 + k * 0.02, 0.02], 0.004, 0.003, mat='gold', reg='UpperArm.' + s))
    relic = Union([Torus(S(0, -0.175, 1.3), 0.022, 0.005, mat='gold', reg='Torso', R=rot_to((0, -1, 0))), Sphere(S(0, -0.17, 1.3), 0.016, mat='glow', reg='Torso')])
    chain = tube([S(-0.07, -0.08, 1.46), S(-0.03, -0.16, 1.36), S(0, -0.172, 1.325)], 0.0025, 'gold', 'Torso')
    chain2 = tube([S(0.07, -0.08, 1.46), S(0.03, -0.16, 1.36), S(0, -0.172, 1.325)], 0.0025, 'gold', 'Torso')
    pants = d.loose_pants('pants', t=0.006, waist=1.02, cuff=0.25)
    boots = [d.shoe(s, 'boot', 'sole', shaft=0.27, width=1.02) for s in ('L', 'R')]
    d.garments = [coat, skirt, collar] + trims + buttons + [belt, buckle] + epaul + [relic, chain, chain2, pants] + boots
    # hood, respirator with two filters and a valve, round goggles
    hk = sk.head_k
    hood_out = Union([Ellipsoid(d.H(0, 0.018, 0.035), np.array([0.098, 0.118, 0.115]) * hk), Ellipsoid(d.H(0, 0.04, -0.07), np.array([0.09, 0.1, 0.09]) * hk)], k=0.04)
    hood = Sub(hood_out, Union([Ellipsoid(d.H(0, 0.012, 0.03), np.array([0.084, 0.104, 0.1]) * hk), Ellipsoid(d.H(0, 0.03, -0.07), np.array([0.075, 0.088, 0.08]) * hk)], k=0.04), k=0.004)
    opening = Ellipsoid(d.H(0, -0.11, -0.03), np.array([0.062, 0.07, 0.092]) * hk)
    hood = Sub(hood, opening, k=0.006)
    hood = Inter(hood, Plane(d.H(0, 0, -0.17), np.array([0, 0, -1.0])))
    hood = cloth.folds(hood, d.H(0, 0.02, 0.12), d.H(0, 0.06, -0.15), amp=0.0025, freq=60, width=0.08, centre=0.5, seed=1.0)
    mask = Inter(Offset(d.face, 0.012), Ellipsoid(d.H(0, -0.09, -0.06), np.array([0.058, 0.05, 0.062]) * hk), k=0.006)
    mask = Union([mask, Ellipsoid(d.H(0, -0.1, -0.067), np.array([0.034, 0.03, 0.045]) * hk)], k=0.01)
    filt = []
    for sx in (1, -1):
        filt.append(Cyl(d.H(sx * 0.047, -0.098, -0.078), 0.024 * hk, 0.016 * hk, 0.005, mat='filter', reg='Head', R=rot_to((sx * 0.75, -0.6, -0.25))))
        filt.append(Torus(d.H(sx * 0.052, -0.105, -0.081), 0.022 * hk, 0.0022, mat='steel', reg='Head', R=rot_to((sx * 0.75, -0.6, -0.25))))
    valve = Cyl(d.H(0, -0.13, -0.083), 0.014 * hk, 0.009 * hk, 0.004, mat='rubber', reg='Head', R=rot_to((0, -0.85, -0.5)))
    straps = [Label(cloth.band(hood_out, [d.H(sx * 0.07, -0.07, -0.05), d.H(sx * 0.098, 0.02, -0.02), d.H(sx * 0.06, 0.11, 0.0)], 0.006, 0.002, 'rubber'), reg='Head') for sx in (1, -1)]
    gog = []
    for sx in (1, -1):
        e = d.H(sx * 0.0315, -0.071, 0.0)
        gog.append(Cyl(e + np.array([0, -0.023, 0.002]) * hk, 0.019 * hk, 0.009 * hk, 0.004, mat='rubber', reg='Head', R=rot_to((0, -1, 0))))
        gog.append(Cyl(e + np.array([0, -0.032, 0.002]) * hk, 0.016 * hk, 0.0015, 0.001, mat='lens', reg='Head', R=rot_to((0, -1, 0))))
        gog.append(Torus(e + np.array([0, -0.032, 0.002]) * hk, 0.017 * hk, 0.0028, mat='steel', reg='Head', R=rot_to((0, -1, 0))))
    gog.append(RoundCone(d.H(-0.012, -0.098, 0.004), d.H(0.012, -0.098, 0.004), 0.004, mat='rubber', reg='Head'))
    gstrap = Label(Inter(Offset(hood_out, 0.003), RBox(d.H(0, 0.02, 0.005), np.array([0.2, 0.2, 0.008]) * hk, 0.003)), mat='rubber', reg='Head')
    d.head_gear = [Label(hood, mat='hood', reg='Head'), Label(mask, mat='rubber', reg='Head'), valve, gstrap] + filt + straps + gog
    d.hand_gear = d.glove('glove', t=0.0022, cuff_len=0.07, cuff_t=0.004, cuff_mat='trim')
    d.palette = {
        'skin': dict(kind='skin', color=0x6e4630, lips=0x50302a, brow=0x141010, blush=0x6a3424, stubble=0.4),
        'hair': dict(kind='hair', color=0x15110e),
        'coat': dict(kind='leather', color=0x1a1a1e, rough=0.5), 'hood': dict(kind='wool', color=0x1c1c22, rough=0.9),
        'trim': dict(kind='leather', color=0xe2e2e8, rough=0.45), 'gold': dict(kind='metal', color=0xc8a040, rough=0.3, metal=0.9),
        'leather': dict(kind='leather', color=0x2a1e16, rough=0.55), 'glow': dict(kind='glow', color=0xdfe8ff, emit=0x8fa8ff, glow=2.2, rough=0.2),
        'pants': dict(kind='wool', color=0x1e1e24, rough=0.85), 'boot': dict(kind='leather', color=0x0e0e10, rough=0.4),
        'sole': dict(kind='rubber', color=0x080808, rough=0.85),
        'rubber': dict(kind='rubber', color=0x16161a, rough=0.55), 'filter': dict(kind='metal', color=0x3a3e44, rough=0.45, metal=0.6),
        'steel': dict(kind='metal', color=0xa8acb0, rough=0.3, metal=0.9), 'lens': dict(kind='glass', color=0x2a3a34, rough=0.04),
        'glove': dict(kind='leather', color=0x1e1e22, rough=0.5),
        '_dirt': 0.2,
    }
    d.budget = {'body': 15000, 'head': 8000, 'hands': 2400, 'props': 1200}
    return d

# ====================================================================== PICSOU : billionaire (original design: a stout elderly tycoon)
def picsou():
    d = Design('picsou', sw=1.1, sh=0.86, head_k=1.08, arm_out=0.035, body_p={'belly': 0.09, 'muscle': 0.95},
               face_p={'age': 1.0, 'nose': 1.12, 'nose_w': 1.15, 'cheek': 1.15, 'round': 1.06, 'jaw': 1.04, 'brow': 1.1, 'ear': 1.08})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x2a4a6a
    d.outfit = {'glove': 'f4f2ec', 'sleeve': 'a81c1c', 'cuff': 'f4f2ec'}
    d.fp = {'glove': 'glove', 'sleeve': 'coat', 'cuff': 'lapel'}
    shirt = d.loose_top('shirt', t=0.004, hem=0.95, sleeve=0.98, collar=1.47, neck_front=0.2)
    vest = d.loose_top('waistcoat', t=0.011, hem=0.93, sleeve=None, collar=1.42, neck_front=1.0)
    vest = vneck(vest, S(0, 0, 1.25)[2], 1.6)
    coat = d.loose_top('coat', t=0.017, hem=0.97, sleeve=0.94, collar=1.48, neck_front=0.3)
    coat = front_open(coat, 0.95, 1.48, 0.13, 0.07)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        coat = cloth.folds(coat, sho, wr, amp=0.0028, freq=55, width=0.06, centre=0.55, seed=0.2 if s == 'L' else 1.9)
    tails = d.skirt('coat', 1.0, 0.52, 0.235, 0.265, sy=0.9, front_open=0.2, back_slit=0.22, folds=0.002, seed=3.0)
    lapels = []
    for sx in (1, -1):
        lapels.append(cloth.band(coat, [S(sx * 0.08, -0.06, 1.45), S(sx * 0.12, -0.15, 1.32), S(sx * 0.13, -0.19, 1.15)], 0.026, 0.004, 'lapel', reg='Torso'))
    cuffs = [limb_ring(d, coat, 'LowerArm.' + s, 0.85, 0.05, 0.004, 'lapel', R=0.09) for s in 'LR']
    buttons = []
    for z in (1.24, 1.16, 1.08, 1.0):
        p, n = cloth.surf(vest, S(0, -0.5, z), (0, 1, 0))
        buttons.append(Sphere(p + n * 0.002, 0.0065, mat='gold', reg='Torso' if z > 1.12 else 'Abdomen'))
    cravat = Union([Ellipsoid(S(0, -0.105, 1.41), (0.03, 0.02, 0.025), mat='cravat', reg='Torso'),
                    Ellipsoid(S(0, -0.12, 1.36), (0.025, 0.018, 0.045), mat='cravat', reg='Torso'),
                    Sphere(S(0, -0.135, 1.385), 0.006, mat='gold', reg='Torso')], k=0.01)
    collar = Label(cloth.cut(cloth.cut(Offset(P['torso'], 0.012), (0, 0, 1.43), (0, 0, -1)), (0, 0, 1.49), (0, 0.4, 1)), mat='shirt')
    watch = tube([S(-0.06, -0.19, 1.12), S(0.0, -0.205, 1.08), S(0.07, -0.19, 1.11)], 0.003, 'gold', 'Abdomen')
    pants = d.loose_pants('pants', t=0.008, waist=1.02, cuff=0.07)
    spats = [cloth.ring_band(d.shoe(s, 'shoe', 'sole', shaft=0.0), sk.head('Foot.' + s) + [0, 0, 0.0], (0, 0, 1), -0.03, 0.06, 0.006, 'spats', reg='LowerLeg.' + s, R=0.1) for s in 'LR']
    shoes = [d.shoe(s, 'shoe', 'sole', shaft=0.0, width=1.05) for s in ('L', 'R')]
    d.garments = [shirt, vest, coat, tails] + lapels + cuffs + buttons + [cravat, collar, watch, pants] + spats + shoes
    # top hat, white side hair, moustache, bushy eyebrows, monocle
    hk = sk.head_k
    hat = Revolve(d.H(0, 0.012, 0.075), [(0.0, 0.0), (0.135, 0.0), (0.14, 0.006), (0.125, 0.012), (0.085, 0.014), (0.088, 0.16), (0.0, 0.165)],
                  sxy=(1.0, 1.12), round_r=0.002)
    hat = Inter(hat, Plane(d.H(0, 0.0, 0.08), np.array([0, 0, -1.0])))
    hband = Inter(Offset(Revolve(d.H(0, 0.012, 0.075), [(0.0, 0.0), (0.086, 0.0), (0.086, 0.165), (0.0, 0.165)], sxy=(1.0, 1.12)), 0.002),
                  RBox(d.H(0, 0.012, 0.11), np.array([0.2, 0.2, 0.018]) * hk, 0.002))
    cap = d.hair_cap('hair', t=0.003, front=0.07, temple=0.03, side=0.02, nape=-0.05)
    must = []
    for sx in (1, -1):
        must.append(Union([Ellipsoid(d.H(sx * 0.016, -0.096, -0.062), np.array([0.019, 0.012, 0.009]) * hk, R=rot_euler(0, sx * 0.25, 0)),
                           Ellipsoid(d.H(sx * 0.038, -0.083, -0.07), np.array([0.018, 0.011, 0.008]) * hk, R=rot_euler(0, sx * 0.6, sx * 0.4)),
                           Ellipsoid(d.H(sx * 0.052, -0.07, -0.063), np.array([0.012, 0.008, 0.006]) * hk, R=rot_euler(0, -sx * 0.5, 0))], k=0.008))
    brows = [Ellipsoid(d.H(sx * 0.033, -0.083, 0.026), np.array([0.019, 0.007, 0.006]) * hk, R=rot_euler(0, -sx * 0.15, 0)) for sx in (1, -1)]
    tufts = [Ellipsoid(d.H(sx * 0.07, 0.03, 0.01), np.array([0.018, 0.04, 0.035]) * hk) for sx in (1, -1)] + [Ellipsoid(d.H(0, 0.085, -0.005), np.array([0.06, 0.03, 0.04]) * hk)]
    mono_c = d.H(-0.0315, -0.088, 0.0)
    monocle = Union([Torus(mono_c, 0.0155 * hk, 0.0018, mat='gold', reg='Head', R=rot_to((0, -1, 0))),
                     Cyl(mono_c, 0.0145 * hk, 0.0006, 0.0003, mat='lens', reg='Head', R=rot_to((0, -1, 0)))])
    mchain = tube([d.H(-0.046, -0.088, -0.006), d.H(-0.07, -0.06, -0.06), d.H(-0.075, -0.03, -0.12), d.H(-0.07, -0.02, -0.17)], 0.0011, 'gold', 'Head')
    d.head_gear = [Label(hat, mat='hat', reg='Head'), Label(hband, mat='hatband', reg='Head'), cap, monocle, mchain] + \
        [Label(m, mat='white_hair', reg='Jaw') for m in must] + [Label(b, mat='white_hair', reg='Head') for b in brows] + \
        [Label(t, mat='white_hair', reg='Head') for t in tufts]
    d.hand_gear = d.glove('glove', t=0.0025, cuff_len=0.07, cuff_t=0.003)
    # gold cane in the right hand
    wr, fdir, palm_n, fwd = sk.hand_R
    grip = wr + fdir * 0.05 + palm_n * 0.025
    d.props['Cane'] = Union([Cyl(grip + np.array([0, 0, -0.42]), 0.009, 0.42, 0.004, mat='gold', reg='Hand.R'),
                             Sphere(grip + np.array([0, 0, 0.03]), 0.026, mat='gold', reg='Hand.R'),
                             Cyl(grip + np.array([0, 0, -0.835]), 0.011, 0.012, 0.005, mat='hat', reg='Hand.R')], k=0.01)
    # fluffy white hair at the sides and the back (cards)
    hl = d.hairline
    roots = hair.scalp_roots(d, 70, lambda q: hl(q) - 0.002, region=lambda q: q[2] < 0.05, seed=9)
    locks = hair.grow(d, roots, fall(d, out_k=0.9, down=0.5, back=0.3), [0.045, 0.06], step=0.006, gravity=0.3, lift=0.003, curl=0.5, seed=10)
    d.hair = {'color': 0xeeece6, 'groups': [{'locks': locks, 'width': 0.02, 'layers': 2, 'taper': 0.5}], 'rough': 0.55}
    d.palette = {
        'skin': dict(kind='skin', color=0xe2b494, lips=0xa4645a, brow=0xeeece6, blush=0xd06a5a),
        'hair': dict(kind='hair', color=0xe6e4de), 'white_hair': dict(kind='hair', color=0xf0eee8),
        'shirt': dict(kind='cotton', color=0xf6f4ee, rough=0.7), 'waistcoat': dict(kind='silk', color=0xd8a838, rough=0.45),
        'coat': dict(kind='wool', color=0xa81c1c, rough=0.8), 'lapel': dict(kind='velvet', color=0x2a0e0e, rough=0.7),
        'gold': dict(kind='metal', color=0xd4a640, rough=0.25, metal=0.95), 'cravat': dict(kind='silk', color=0xf4f2ec, rough=0.4),
        'pants': dict(kind='wool', color=0x34343c, rough=0.85), 'spats': dict(kind='cotton', color=0xf2f0ea, rough=0.8),
        'shoe': dict(kind='leather', color=0x121214, rough=0.25), 'sole': dict(kind='rubber', color=0x0e0e0e, rough=0.8),
        'hat': dict(kind='silk', color=0x141418, rough=0.35), 'hatband': dict(kind='silk', color=0xa81c1c, rough=0.5),
        'lens': dict(kind='glass', color=0x9aa4a8, rough=0.03), 'glove': dict(kind='cotton', color=0xf4f2ec, rough=0.8),
        '_dirt': 0.06,
    }
    d.budget = {'body': 13500, 'head': 8000, 'hands': 2400, 'props': 900}
    return d

# ====================================================================== KLUKAI : tactical doll
def klukai():
    d = Design('klukai', sw=0.93, sh=0.98, fem=True, body_p={'bust': 0.9, 'thin': 0.93}, face_p={'eye_w': 1.1, 'eye_h': 1.08, 'nose': 0.84, 'nose_w': 0.86, 'lips': 1.1, 'chin': 0.78, 'jaw': 0.86})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x2aa070
    d.outfit = {'glove': '141418', 'sleeve': '5e3490', 'cuff': '3ac8ff'}
    d.fp = {'glove': 'glove', 'sleeve': 'jacket', 'cuff': 'cyan'}
    suit = d.loose_top('suit', t=0.002, hem=0.92, sleeve=0.97, collar=1.5, neck_front=0.0, cover=0.003)
    legs = d.loose_pants('suit', t=0.002, waist=1.0, cuff=0.15, cover=0.003)
    jacket = d.loose_top('jacket', t=0.013, hem=1.16, sleeve=0.86, collar=1.5, neck_front=0.2)
    jacket = front_open(jacket, 1.12, 1.5, 0.05, 0.06)
    for s in ('L', 'R'):
        sho, el, wr = _arm_axis(d, s)
        jacket = cloth.folds(jacket, sho, wr, amp=0.0025, freq=55, width=0.06, centre=0.55, seed=1.4 if s == 'L' else 0.3)
    piping = [cloth.band(Offset(jacket, 0.001), [S(sx * 0.055, -0.15, 1.5), S(sx * 0.055, -0.16, 1.15)], 0.005, 0.003, 'cyan', reg='Torso') for sx in (1, -1)]
    piping += [limb_ring(d, jacket, 'LowerArm.' + s, 0.42, 0.012, 0.003, 'cyan', R=0.1) for s in 'LR']
    harness = []
    torso_c = Offset(d.G.parts['torso'], 0.006)
    for sx in (1, -1):
        harness.append(cloth.band(torso_c, [S(sx * 0.08, -0.15, 1.02), S(sx * 0.1, -0.14, 1.2), S(sx * 0.11, -0.08, 1.42), S(sx * 0.1, 0.06, 1.44), S(sx * 0.06, 0.13, 1.2)], 0.012, 0.004, 'strap', reg='Torso'))
    belt = cloth.ring_band(legs, S(0, 0, 0.99), (0, 0, 1), -0.018, 0.018, 0.006, 'strap', reg='Hips', R=0.35)
    buckle, *_ = cloth.patch(belt, S(0, -0.4, 0.99), (0, 1, 0), (0.04, 0.035), 0.008, 'steel', reg='Hips', r=0.004)
    pouch, *_ = cloth.patch(legs, S(-0.14, -0.1, 0.96), (1, 0.4, 0), (0.06, 0.08), 0.03, 'strap', reg='Hips', r=0.01)
    holster = []
    hip_r = sk.head('UpperLeg.R')
    for z in (0.78, 0.68):
        holster.append(cloth.ring_band(legs, hip_r + [0, 0, z - hip_r[2]], (0, 0, 1), -0.01, 0.01, 0.004, 'strap', reg='UpperLeg.R', R=0.13))
    hb, *_ = cloth.patch(legs, S(-0.22, 0.0, 0.7), (1, 0, 0), (0.07, 0.17), 0.035, 'holster', reg='UpperLeg.R', r=0.012)
    holster.append(hb)
    knees = []
    for s, sx in (('L', 1), ('R', -1)):
        kn = sk.head('LowerLeg.' + s)
        kp, *_ = cloth.patch(legs, kn + [0, -0.2, 0.0], (0, 1, 0), (0.07, 0.08), 0.012, 'porcelain', reg='LowerLeg.' + s, r=0.03)
        knees.append(kp)
        d.seams.append(tex.plane_seam(kn + [0, 0, 0.065], (0, 0, 1), width=0.0012, mats=['suit']))
        d.seams.append(tex.plane_seam(sk.head('LowerArm.' + s), sk.tail('UpperArm.' + s) - sk.head('UpperArm.' + s), width=0.0012, mats=['suit']))
    choker = cloth.ring_band(P['torso'], S(0, 0, 1.49), (0, 0.15, 1), -0.008, 0.008, 0.004, 'strap', reg='Neck', R=0.1)
    gem = Sphere(S(0, -0.055, 1.485), 0.006, mat='cyan_glow', reg='Neck')
    boots = [d.shoe(s, 'boot', 'sole', shaft=0.36, width=0.95, heel=0.02) for s in ('L', 'R')]
    btrim = [cloth.ring_band(boots[i], sk.head('Foot.' + s) + [0, 0, 0.44], (0, 0.2, 1), -0.006, 0.006, 0.002, 'cyan', reg='LowerLeg.' + s, R=0.1) for i, s in enumerate('LR')]
    d.garments = [suit, legs, jacket] + piping + harness + [belt, buckle, pouch] + holster + knees + [choker, gem] + boots + btrim
    cap = d.hair_cap('hair', t=0.006, front=0.058, temple=0.032, side=0.016, nape=-0.055, volume=0.02, whorl=d.H(0, 0.065, 0.095))
    hk = sk.head_k
    clip = Union([RBox(d.H(0.062, -0.045, 0.045), np.array([0.004, 0.012, 0.004]) * hk, 0.002, mat='cyan_glow', reg='Head', R=rot_euler(0, 0.4, 0.4)),
                  RBox(d.H(0.066, -0.035, 0.033), np.array([0.004, 0.012, 0.004]) * hk, 0.002, mat='cyan_glow', reg='Head', R=rot_euler(0, 0.4, 0.4))])
    # side-swept fringe (a volume over the forehead, thicker on her left), strands as grooves
    fringe = Inter(Offset(d.skull(), 0.01), Func(lambda Pp, c=sk.head_c, hk=hk: np.maximum(np.maximum(
        0.028 + 0.03 * np.clip(((Pp[:, 0] - c[0]) / hk + 0.06) / 0.12, 0, 1) - (Pp[:, 2] - c[2]) / hk, (Pp[:, 1] - c[1]) / hk + 0.035),
        np.abs((Pp[:, 0] - c[0]) / hk) - 0.066) * hk, sk.head_c - 0.2, sk.head_c + 0.2), k=0.004)
    def fringe_g(Pp, c=sk.head_c):
        q = Pp - c
        return -0.0008 * (0.5 + 0.5 * np.sin((q[:, 0] * 0.55 - q[:, 2]) * 1500.0))
    d.head_gear = [cap, clip, Label(Displace(fringe, fringe_g, 0.0008), mat='hair', reg='Head')]
    d.hand_gear = d.glove('glove', t=0.0015, cuff_len=0.06, cuff_t=0.003, cuff_mat='cyan')
    # high ponytail, side-swept fringe (towards her left), thin locks in front of the ears
    hl = d.hairline
    T = d.H(0, 0.065, 0.095)
    roots = hair.scalp_roots(d, 260, lambda q: hl(q) - 0.004, seed=11)
    qy = (roots[:, 1] - sk.head_c[1]) / hk
    front = roots[qy < -0.05]
    rest = roots[qy >= -0.05]
    up_locks = hair.grow(d, rest, toward(d, T, 0.85), np.linalg.norm(rest - T, axis=1) * 1.05, step=0.016, lift=0.002, seed=12)
    tie_r = [T + np.array([np.cos(a) * 0.012, 0.006, np.sin(a) * 0.01]) for a in np.linspace(0, 6.28, 40, endpoint=False)]
    body_col = Union([d.B.nude(with_hands=False), Offset(d.G.parts['torso'], 0.016)])
    pony = hair.grow(d, np.array(tie_r), lambda p, i: np.array([0, 0.9 - i * 0.03, -0.6]) / np.hypot(0.9, 0.6), [0.42, 0.48, 0.52], step=0.022,
                     gravity=0.8, lift=0.0, collide=body_col, curl=0.15, seed=13)
    fringe = hair.grow(d, front, lambda p, i: np.array([0.85, -0.35, -0.3]) / np.linalg.norm([0.85, -0.35, -0.3]), [0.07, 0.09], step=0.007, gravity=0.35, lift=0.004, seed=14)
    side_r = np.array([d.H(sx * 0.06, -0.03, 0.03) for sx in (1, -1) for _ in range(3)])
    side_r = hair.project_out(d.hair_surface(), side_r + np.random.default_rng(3).normal(0, 0.004, side_r.shape))
    sides = hair.grow(d, side_r, lambda p, i: np.array([0, -0.15, -1.0]) / np.hypot(0.15, 1), [0.15, 0.17], step=0.01, gravity=0.6, lift=0.004, collide=body_col, seed=15)
    d.hair = {'color': 0xb4d8ee, 'groups': [{'locks': pony, 'width': 0.034, 'layers': 3, 'taper': 0.65},
                                            {'locks': sides, 'width': 0.016, 'layers': 2, 'taper': 0.6}], 'rough': 0.4}
    d.palette = {
        'skin': dict(kind='skin', color=0xe6c3ad, lips=0xb86e78, brow=0x7a98b4, blush=0xd88078),
        'hair': dict(kind='hair', color=0xb4d8ee),
        'suit': dict(kind='synthetic', color=0x16161c, rough=0.5), 'jacket': dict(kind='nylon', color=0x5e3490, rough=0.55),
        'cyan': dict(kind='plastic', color=0x3ac8ff, rough=0.3), 'cyan_glow': dict(kind='glow', color=0x3ac8ff, emit=0x3ac8ff, glow=1.5, rough=0.2),
        'strap': dict(kind='webbing', color=0x101014, rough=0.7), 'steel': dict(kind='metal', color=0xb0b4bc, rough=0.3, metal=0.9),
        'holster': dict(kind='plastic', color=0x1a1a20, rough=0.5), 'porcelain': dict(kind='plastic', color=0xf2ece6, rough=0.2),
        'boot': dict(kind='leather', color=0x101014, rough=0.35), 'sole': dict(kind='rubber', color=0x060606, rough=0.8),
        'glove': dict(kind='synthetic', color=0x141418, rough=0.55),
        '_dirt': 0.1,
    }
    d.budget = {'body': 13500, 'head': 6000, 'hands': 2400, 'props': 1200}
    return d

# ====================================================================== HARRY : sorcerer (original design)
def harry():
    d = Design('harry', sw=0.95, sh=0.97, arm_out=0.04, body_p={'thin': 0.95}, face_p={'nose': 0.98, 'jaw': 0.95, 'chin': 0.95})
    sk, P, S = d.sk, d.P, d.sk.S
    d.iris = 0x2f8a3a
    d.outfit = {'glove': 'e8c2a4', 'sleeve': '1b1f33', 'cuff': 'e0b040'}
    d.fp = {'glove': 'skin', 'sleeve': 'robe', 'cuff': 'shirt'}
    shirt = d.loose_top('shirt', t=0.004, hem=0.95, sleeve=0.98, collar=1.47, neck_front=0.4)
    robe = d.loose_top('robe', t=0.016, hem=0.95, sleeve=0.45, collar=1.47, neck_front=0.6, k=0.05)
    robe = front_open(robe, 1.25, 1.47, 0.01, 0.06)
    bells = []
    for s in ('L', 'R'):
        el, wr = sk.head('LowerArm.' + s), sk.head('Hand.' + s)
        fa = (wr - el) / np.linalg.norm(wr - el)
        cone = RoundCone(el - fa * 0.02, wr + fa * 0.035, 0.05, 0.075, reg='LowerArm.' + s)
        bell = cloth.cut(Shell(cone, 0.0035), wr + fa * 0.03, fa)
        bells.append(Label(cloth.folds(bell, el, wr + fa * 0.04, amp=0.003, freq=45, width=0.08, centre=0.6, seed=2.0), mat='robe'))
        sho = sk.head('UpperArm.' + s)
        robe = cloth.folds(robe, sho, el, amp=0.0025, freq=50, width=0.06, centre=0.8, seed=1.0)
    skirt = d.skirt('robe', 1.0, 0.07, 0.2, 0.29, sy=0.85, front_open=0.0, back_slit=0.0, folds=0.008, seed=4.0)
    hood = Union([Ellipsoid(S(0, 0.14, 1.38), (0.12, 0.05, 0.1), mat='robe', reg='Torso', R=rot_euler(0.3, 0, 0)),
                  Torus(S(0, 0.07, 1.45), 0.11, 0.018, mat='robe', reg='Torso', R=rot_euler(0.4, 0, 0), sz=(1.05, 0.9))], k=0.025)
    sash = cloth.ring_band(Offset(d.G.parts['torso'], 0.02), S(0, 0, 1.03), (0, 0, 1), -0.025, 0.025, 0.006, 'gold_cloth', reg='Hips', R=0.4)
    knot = Union([Ellipsoid(S(0.07, -0.16, 1.03), (0.025, 0.018, 0.022), mat='gold_cloth', reg='Hips'),
                  tube([S(0.07, -0.16, 1.02), S(0.08, -0.18, 0.9), S(0.075, -0.19, 0.8)], 0.012, 'gold_cloth', 'Skirt', r1=0.008)], k=0.008)
    scarf = Union([Torus(S(0, -0.005, 1.45), 0.075, 0.025, mat='scarf', reg='Neck', R=rot_euler(0.15, 0, 0)),
                   tube([S(-0.05, -0.1, 1.43), S(-0.07, -0.16, 1.3), S(-0.08, -0.17, 1.12)], 0.022, 'scarf', 'Torso', r1=0.02),
                   tube([S(0.04, 0.08, 1.43), S(0.07, 0.15, 1.3), S(0.08, 0.17, 1.15)], 0.022, 'scarf', 'Torso', r1=0.02)], k=0.012)
    clasp = Union([Cyl(S(0, -0.13, 1.44), 0.012, 0.003, 0.002, mat='gold', reg='Torso', R=rot_to((0, -1, 0)))])
    pants = d.loose_pants('pants', t=0.006, waist=1.02, cuff=0.12)
    boots = [d.shoe(s, 'boot', 'sole', shaft=0.1, width=1.0) for s in ('L', 'R')]
    d.garments = [shirt, robe] + bells + [skirt, hood, sash, knot, scarf, clasp, pants] + boots
    # floppy pointed hat with a gold band, round glasses
    hk = sk.head_k
    brim = Revolve(d.H(0, 0.012, 0.06), [(0.0, -0.003), (0.17, -0.012), (0.175, -0.008), (0.0, 0.01)], sxy=(1.0, 1.05), round_r=0.002)
    pts = [d.H(0, 0.012, 0.06), d.H(0, 0.02, 0.15), d.H(0, 0.04, 0.22), d.H(0, 0.08, 0.27), d.H(0.0, 0.13, 0.27)]
    rads = [0.106, 0.072, 0.045, 0.025, 0.012]
    cone = Union([RoundCone(pts[i], pts[i + 1], rads[i] * hk, rads[i + 1] * hk) for i in range(len(pts) - 1)], k=0.02)
    cone = cloth.folds(cone, pts[0], pts[2], amp=0.003, freq=55, width=0.05, centre=0.6, seed=1.0)
    cone = Inter(cone, Plane(d.H(0, 0, 0.058), np.array([0, 0, -1.0])))
    hband = Inter(Offset(cone, 0.003), RBox(d.H(0, 0.012, 0.078), np.array([0.2, 0.2, 0.014]) * hk, 0.003))
    hk_ = hk
    glasses = []
    for sx in (1, -1):
        e = d.H(sx * 0.0315, -0.071, 0.0)
        glasses.append(Torus(e + np.array([0, -0.024, 0.0]) * hk_, 0.0175 * hk_, 0.0012, mat='frame', reg='Head', R=rot_to((0, -1, 0))))
        glasses.append(tube([d.H(sx * 0.049, -0.093, 0.004), d.H(sx * 0.068, -0.06, 0.006), d.H(sx * 0.072, 0.0, 0.004), d.H(sx * 0.07, 0.018, -0.012)], 0.0011, 'frame', 'Head'))
    glasses.append(tube([d.H(-0.014, -0.096, 0.004), d.H(0, -0.099, 0.008), d.H(0.014, -0.096, 0.004)], 0.0011, 'frame', 'Head'))
    cap = d.hair_cap('hair', t=0.008, front=0.055, temple=0.03, side=0.012, nape=-0.06, volume=0.05)
    d.head_gear = [Label(brim, mat='hat', reg='Head'), Label(cone, mat='hat', reg='Head'), Label(hband, mat='gold_cloth', reg='Head'), cap] + glasses
    d.hand_gear = None
    # wand in the right hand
    wr, fdir, palm_n, fwd = sk.hand_R
    g0 = wr + fdir * 0.045 + palm_n * 0.022
    tip = g0 + fwd * 0.3 + fdir * 0.05
    d.props['Wand'] = Union([RoundCone(g0 - fwd * 0.06, g0 + fwd * 0.03, 0.0085, 0.0075, mat='wand_dark', reg='Hand.R'),
                             RoundCone(g0 + fwd * 0.03, tip, 0.006, 0.003, mat='wand', reg='Hand.R'),
                             Torus(g0 + fwd * 0.03, 0.0075, 0.0018, mat='gold', reg='Hand.R', R=rot_to(fwd)),
                             Sphere(tip, 0.0035, mat='wand_glow', reg='Hand.R')], k=0.003)
    # messy hair sticking out under the hat
    hl = d.hairline
    roots = hair.scalp_roots(d, 130, lambda q: hl(q) - 0.002, seed=21, jitter=0.05, region=lambda q: q[2] < 0.04)
    def messy(p, i, c=sk.head_c):
        n = p - c; n /= np.linalg.norm(n)
        v = n * 0.9 + np.array([0, 0.1, -0.7]) + 0.4 * np.sin(p * 300 + i)
        return v / np.linalg.norm(v)
    locks = hair.grow(d, roots, messy, [0.035, 0.05, 0.06], step=0.007, gravity=0.3, lift=0.003, curl=0.3, seed=22)
    d.hair = {'color': 0x241a12, 'groups': [{'locks': locks, 'width': 0.024, 'layers': 2, 'taper': 0.5}], 'rough': 0.5}
    d.palette = {
        'skin': dict(kind='skin', color=0xe8c2a4, lips=0xb06a62, brow=0x18120e, blush=0xd07868, stubble=0.15),
        'hair': dict(kind='hair', color=0x18120e),
        'shirt': dict(kind='cotton', color=0xe8e4dc, rough=0.75), 'robe': dict(kind='wool', color=0x1b1f33, rough=0.85),
        'gold_cloth': dict(kind='silk', color=0xd8a838, rough=0.45), 'gold': dict(kind='metal', color=0xd4a640, rough=0.3, metal=0.9),
        'scarf': dict(kind='knit', color=0x2a6a6a, rough=0.9, pattern='stripes', color2=0xc89a30, pitch=0.045, duty=0.75),
        'pants': dict(kind='wool', color=0x4a4a50, rough=0.85), 'boot': dict(kind='leather', color=0x3a2414, rough=0.55),
        'sole': dict(kind='rubber', color=0x0e0c0a, rough=0.85), 'hat': dict(kind='wool', color=0x1b1f33, rough=0.9),
        'frame': dict(kind='metal', color=0x2a2a30, rough=0.3, metal=0.8),
        'wand': dict(kind='leather', color=0x5a3a1e, rough=0.55), 'wand_dark': dict(kind='leather', color=0x2e1c10, rough=0.5),
        'wand_glow': dict(kind='glow', color=0xfff0b0, emit=0xffd060, glow=1.8, rough=0.2),
        '_dirt': 0.15,
    }
    d.budget = {'body': 14500, 'head': 7000, 'hands': 2400, 'props': 600}
    return d

CHARS = {k: (lambda f: (lambda: f().finish()))(f) for k, f in
         (('marc', marc), ('lea', lea), ('karim', karim), ('chloe', chloe), ('lucian', lucian), ('picsou', picsou), ('klukai', klukai), ('harry', harry))}
