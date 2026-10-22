# Anatomical base body of the playable characters (v0.31.0), as SDF sub-trees built on the shared skeleton (charlib/skel.py).
# The parts are blended where they join (smooth minimum with a blend radius that fades away from the joints: no webbing between arm and torso or
# between the legs), and each primitive carries its bone as region label (skin weights, charlib/rig.py). Clothes are built over these parts
# (offsets, charlib/cloth.py), so a sleeve keeps the regions of the arm it covers.
import numpy as np
from .sdf import (Sphere, Ellipsoid, RoundCone, RBox, Union, Sub, Inter, Offset, Label, Plane, rot_to, rot_euler, V)

def _norm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)

def near(c, r0, r1, k):
    """kfun : k inside radius r0 of c, fading to ~0 at r1."""
    c = V(c)
    def f(P):
        d = np.sqrt(((P - c) ** 2).sum(1))
        t = np.clip((r1 - d) / (r1 - r0), 0, 1)
        return k * t * t * (3 - 2 * t)
    return f

def near_any(fs):
    def f(P):
        return np.max([g(P) for g in fs], axis=0)
    return f

class Body:
    """Builds the parts; p : dict of shape parameters (fem, belly, muscle, thin, bust)."""
    def __init__(self, sk, p=None):
        self.sk = sk
        self.p = p = dict(p or {})
        self.fem = p.get('fem', sk.fem)
        self.parts = {}
        self.simple = p.get('simple', False)
        if self.simple:
            self._simple()
            return
        self._torso()
        for s in ('L', 'R'):
            self._arm(s)
            self._hand(s)
            self._leg(s)

    # ------------------------------------------------------------------ garment body: fuller, smoother shapes (clothes hang over the anatomy)
    def _simple(self):
        sk, p, fem = self.sk, self.p, self.fem
        S = sk.S
        th = p.get('thin', 1.0)
        mus = p.get('muscle', 1.0)
        belly = p.get('belly', 0.0)
        bust = p.get('bust', 1.0) if fem else 0.0
        L = []
        L.append(Ellipsoid(S(0, 0.008, 1.27), ((0.15 if not fem else 0.135) * th * mus, 0.108 * th, 0.17), reg='Torso'))
        L.append(Ellipsoid(S(0, 0.01, 1.36), ((0.17 if not fem else 0.152) * th * mus, 0.092 * th, 0.065), reg='Torso'))
        for sx in (1, -1):
            L.append(RoundCone(S(0, 0.03, 1.455), S(sx * 0.155, 0.015, 1.415), 0.04 * th, 0.035 * th, reg='Torso'))
            if fem:
                L.append(Ellipsoid(S(sx * 0.062, -0.06, 1.272), (0.06 * bust, 0.05 * bust, 0.056 * bust), reg='Torso'))
        L.append(Ellipsoid(S(0, -0.002, 1.1), ((0.125 if not fem else 0.118) * th, 0.092 * th, 0.12), reg='Abdomen'))
        if belly > 0:
            L.append(Ellipsoid(S(0, -0.035 - belly * 0.25, 1.085), (0.13 + belly * 0.45, 0.08 + belly * 0.55, 0.125 + belly * 0.3), reg='Abdomen'))
        hw = 1.08 if fem else 1.0
        L.append(Ellipsoid(S(0, 0.012, 0.95), (0.158 * hw, 0.11, 0.1), reg='Hips'))
        self.parts['torso'] = Union(L, k=0.07)
        for s in ('L', 'R'):
            sho, el, wr = sk.head('UpperArm.' + s), sk.head('LowerArm.' + s), sk.head('Hand.' + s)
            ua = _norm(el - sho)
            m2 = mus * th * (0.88 if fem else 1.0)
            A = [Ellipsoid(sho + [0, 0.0, -0.015], (0.064 * m2, 0.066 * m2, 0.075), reg='UpperArm.' + s, R=rot_to(ua)),
                 RoundCone(sho, el, 0.058 * m2, 0.047 * m2, reg='UpperArm.' + s),
                 RoundCone(el, wr, 0.047 * m2, 0.034, reg='LowerArm.' + s)]
            self.parts['arm.' + s] = Union(A, k=0.04)
            hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
            sx = 1 if s == 'L' else -1
            Lg = [RoundCone(hip + [sx * 0.01, 0.01, -0.02], kn, (0.098 if fem else 0.094) * mus * th, 0.062, reg='UpperLeg.' + s),
                  RoundCone(kn, an + [0, 0, 0.02], 0.06 * mus, 0.046, reg='LowerLeg.' + s)]
            self.parts['leg.' + s] = Union(Lg, k=0.05)

    # ------------------------------------------------------------------ torso, pelvis, neck
    def _torso(self):
        sk, p, fem = self.sk, self.p, self.fem
        S = sk.S
        mus = p.get('muscle', 1.0)
        belly = p.get('belly', 0.0)
        th = p.get('thin', 1.0)
        n0, n1 = sk.head('Neck'), sk.tail('Neck')
        nr = (0.047 if fem else 0.056) * th
        L = []
        L.append(Label(RoundCone(n0 + [0, 0.022, -0.03], n1 + [0, 0.02, -0.004], nr, nr * 0.86), reg='Neck'))
        L.append(Label(Ellipsoid(S(0, -0.032, 1.47), (0.016 * th, 0.014, 0.022)), reg='Neck'))   # larynx
        # neck muscles (sternocleidomastoid) towards the collarbones
        for sx in (1, -1):
            L.append(Label(RoundCone(n1 + [sx * 0.03, -0.012, -0.0], S(sx * 0.03, -0.055, 1.40), 0.015 * th, 0.013 * th), reg='Neck'))
            L.append(Label(RoundCone(S(0, 0.035, 1.47), S(sx * 0.15, 0.018, 1.425), 0.036 * mus * th, 0.03 * th), reg='Torso'))   # trapezius
        if fem:
            rib = Ellipsoid(S(0, 0.012, 1.27), (0.122 * th, 0.088 * th, 0.15), reg='Torso')
            girdle = Ellipsoid(S(0, 0.01, 1.365), (0.148 * th, 0.075 * th, 0.055), reg='Torso')
        else:
            rib = Ellipsoid(S(0, 0.012, 1.275), (0.136 * th * mus, 0.097 * th, 0.162), reg='Torso')
            girdle = Ellipsoid(S(0, 0.012, 1.368), (0.165 * th * mus, 0.083 * th, 0.058), reg='Torso')
        L += [rib, girdle]
        for sx in (1, -1):
            if fem:
                bust = p.get('bust', 1.0)
                L.append(Ellipsoid(S(sx * 0.062, -0.062, 1.272), (0.056 * bust, 0.045 * bust, 0.05 * bust), reg='Torso'))
            else:
                L.append(Ellipsoid(S(sx * 0.058, -0.07, 1.318), (0.066 * mus, 0.03 * mus, 0.054), reg='Torso', R=rot_euler(0, 0, sx * 0.15)))
            L.append(Ellipsoid(S(sx * 0.07, 0.052, 1.27), (0.07 * mus * th, 0.045, 0.125), reg='Torso'))          # lats / shoulder blades
        L.append(Ellipsoid(S(0, -0.004, 1.105), ((0.112 if fem else 0.122) * th, 0.083 * th, 0.11), reg='Abdomen'))
        if belly > 0:
            L.append(Ellipsoid(S(0, -0.035 - belly * 0.25, 1.085), (0.125 + belly * 0.45, 0.075 + belly * 0.55, 0.12 + belly * 0.3), reg='Abdomen'))
        hw = 1.08 if fem else 1.0
        L.append(Ellipsoid(S(0, 0.006, 0.955), (0.15 * hw, 0.098, 0.092), reg='Hips'))
        for sx in (1, -1):
            L.append(Ellipsoid(S(sx * 0.066 * hw, 0.052, 0.895), (0.074 * hw, 0.062, 0.082), reg='Hips'))           # glutes
        self.parts['torso'] = Union(L, k=0.045)

    # ------------------------------------------------------------------ arms
    def _arm(self, s):
        sk, p = self.sk, self.p
        mus = p.get('muscle', 1.0) * p.get('thin', 1.0) * (0.86 if self.fem else 1.0)
        sx = 1 if s == 'L' else -1
        sho, el = sk.head('UpperArm.' + s), sk.head('LowerArm.' + s)
        wr = sk.head('Hand.' + s)
        ua = _norm(el - sho)
        fa = _norm(wr - el)
        wr_, fdir, palm_n, fwd = sk.__dict__['hand_' + s]
        L = []
        L.append(Ellipsoid(sho + [sx * 0.012, 0.0, -0.012], (0.052 * mus, 0.058 * mus, 0.072), reg='UpperArm.' + s, R=rot_to(ua)))   # deltoid
        L.append(RoundCone(sho, el, 0.044 * mus, 0.035 * mus, reg='UpperArm.' + s))
        L.append(Ellipsoid(sho + ua * 0.15 + [0, -0.013, 0], (0.032 * mus, 0.03 * mus, 0.075), reg='UpperArm.' + s, R=rot_to(ua)))   # biceps
        L.append(Ellipsoid(sho + ua * 0.12 + [0, 0.016, 0], (0.033 * mus, 0.032 * mus, 0.085), reg='UpperArm.' + s, R=rot_to(ua)))   # triceps
        L.append(RoundCone(el, wr - fa * 0.01, 0.036 * mus, 0.024, reg='LowerArm.' + s))
        L.append(Ellipsoid(el + fa * 0.07 + fwd * 0.004, (0.036 * mus, 0.035 * mus, 0.075), reg='LowerArm.' + s, R=rot_to(fa, fwd)))  # forearm muscles
        L.append(Ellipsoid(wr - fa * 0.012, (0.016, 0.026, 0.02), reg='LowerArm.' + s, R=np.stack([palm_n, fwd, fa], axis=1)))    # flat wrist
        self.parts['arm.' + s] = Union(L, k=0.03)

    def _hand(self, s):
        sk, p = self.sk, self.p
        g = p.get('hand', 1.0) * (0.92 if self.fem else 1.0)
        wr, fdir, palm_n, fwd = sk.__dict__['hand_' + s]
        Rp = np.stack([palm_n, fwd, fdir], axis=1)
        palm = []
        palm.append(RBox(wr + fdir * 0.047 + palm_n * 0.001, (0.0125 * g, 0.039 * g, 0.042), 0.011, reg='Hand.' + s, R=Rp))
        palm.append(Ellipsoid(wr + fdir * 0.028 + fwd * 0.024 + palm_n * 0.008, (0.014 * g, 0.019 * g, 0.03), reg='Hand.' + s, R=Rp))   # thenar
        palm.append(Ellipsoid(wr + fdir * 0.04 - fwd * 0.026 + palm_n * 0.006, (0.012 * g, 0.014 * g, 0.034), reg='Hand.' + s, R=Rp))  # hypothenar
        palm.append(Ellipsoid(wr + fdir * 0.006, (0.017 * g, 0.03 * g, 0.018), reg='Hand.' + s, R=Rp))                                   # wrist
        rad = {'Index': 0.0088, 'Middle': 0.0091, 'Ring': 0.0085, 'Pinky': 0.0075, 'Thumb': 0.0108}
        fingers = []
        for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
            r = rad[f] * g
            segs = []
            for i in (1, 2, 3):
                n = '%s%d.%s' % (f, i, s)
                a, b = sk.head(n), sk.tail(n)
                r0 = r * (1.0 - 0.08 * (i - 1))
                r1 = r0 * 0.93
                if i == 3:
                    b = b - (b - a) * (r1 / np.linalg.norm(b - a))    # the tip is the end of the capsule
                if f == 'Thumb' and i == 1:
                    r0 *= 1.25
                segs.append(RoundCone(a, b, r0, r1, reg=n))
                # knuckle pads
            fingers.append(Union(segs, k=0.004))
        pal = Union(palm, k=0.012)
        # fingers join the palm with a small blend; between fingers: hard union (they stay separate)
        self.parts['hand.' + s] = Union([pal, Union(fingers[1:]), fingers[0]], k=0.007)

    # ------------------------------------------------------------------ legs
    def _leg(self, s):
        sk, p = self.sk, self.p
        mus = p.get('muscle', 1.0) * p.get('thin', 1.0)
        sx = 1 if s == 'L' else -1
        hip, kn, an = sk.head('UpperLeg.' + s), sk.head('LowerLeg.' + s), sk.head('Foot.' + s)
        th = _norm(kn - hip)
        cf = _norm(an - kn)
        fem = self.fem
        L = []
        L.append(RoundCone(hip + [sx * 0.012, 0.0, -0.01], kn, (0.088 if fem else 0.084) * mus, 0.05, reg='UpperLeg.' + s))
        L.append(Ellipsoid(hip + th * 0.18 + [sx * 0.008, -0.022, 0], (0.06 * mus, 0.055 * mus, 0.14), reg='UpperLeg.' + s, R=rot_to(th)))  # quadriceps
        L.append(Ellipsoid(hip + th * 0.17 + [0, 0.03, 0], (0.058 * mus, 0.05 * mus, 0.13), reg='UpperLeg.' + s, R=rot_to(th)))           # hamstrings
        L.append(Ellipsoid(kn + [0, -0.012, 0.012], (0.045, 0.042, 0.05), reg='UpperLeg.' + s))                                             # knee
        L.append(RoundCone(kn, an + [0, 0, 0.02], 0.047 * mus, 0.03, reg='LowerLeg.' + s))
        L.append(Ellipsoid(kn + cf * 0.13 + [sx * 0.004, 0.03, 0], (0.045 * mus, 0.042 * mus, 0.1), reg='LowerLeg.' + s, R=rot_to(cf)))    # calf
        L.append(Ellipsoid(an + [0, 0.012, 0.0], (0.032, 0.04, 0.035), reg='LowerLeg.' + s))                                                # ankle
        self.parts['leg.' + s] = Union(L, k=0.035)

    # ------------------------------------------------------------------ assembly
    def joint_k(self, k=0.035):
        """Blend radius near the shoulders and the hips (and nowhere else)."""
        sk = self.sk
        fs = []
        for s in ('L', 'R'):
            fs.append(near(sk.head('UpperArm.' + s) + [0, 0, -0.01], 0.045, 0.11, k))
            fs.append(near(sk.head('UpperLeg.' + s) + [0, 0, 0.0], 0.09, 0.17, k))
        return near_any(fs)

    def assemble(self, parts, k=0.035):
        return Union(parts, kfun=self.joint_k(k))

    def nude(self, with_hands=True):
        P = [self.parts['torso']] + [self.parts['arm.' + s] for s in 'LR'] + [self.parts['leg.' + s] for s in 'LR']
        u = self.assemble(P)
        if with_hands:
            return Union([u] + [self.parts['hand.' + s] for s in 'LR'], k=0.0)
        return u
