# Common parts of a character design (v0.31.0): skeleton, body, face, garments over the body, hair cap, shoes and gloves.
# A design fills: body (SDF of everything below the collar except the hands), head (neck, head, hair cap, headgear), hands (bare or gloved),
# props {name: SDF} (separate objects the game can hide, e.g. Prop_Cane), palette {material: spec} (charlib/tex.py), hair cards (charlib/hair.py),
# outfit (first-person glove / sleeve / cuff colours) and an iris colour.
import numpy as np
from .sdf import (Sphere, Ellipsoid, RoundCone, RBox, Torus, Cyl, Revolve, Union, Sub, Inter, Offset, Shell, Displace, Label, Plane, Func,
                  rot_to, rot_euler, V, reset_labels)
from . import skel, body, face, cloth

class Design:
    def __init__(self, cid, sw=1.0, sh=1.0, fem=False, head_k=1.0, body_p=None, face_p=None, **kw):
        reset_labels()
        kw.setdefault('arm_out', 0.02)      # arms a little away from the body (no sleeve or hand merged with the hips in the rest pose)
        self.cid = cid
        self.sk = skel.Skel(sw=sw, sh=sh, fem=fem, head_k=head_k, **kw)
        bp = dict(body_p or {}); bp.setdefault('fem', fem)
        fp = dict(face_p or {}); fp.setdefault('fem', fem)
        self.B = body.Body(self.sk, bp)
        gp = dict(bp); gp['simple'] = True
        self.G = body.Body(self.sk, gp)      # fuller shapes for loose garments
        self.face_p = fp
        self.face = face.head(self.sk, fp)
        self.props = {}
        self.palette = {}
        self.hair = None            # hair card spec (charlib/hair.py)
        self.iris = 0x4a6a80
        self.outfit = {}
        self.garments = []          # body-grid garments
        self.head_gear = []         # head-grid gear (helmets, hats, hair cap)
        self.hand_gear = None       # glove builder result (replaces bare hands)
        self.seams = []             # texture seams (charlib/tex.py)
        self.decals = []
        self.collar_z = 1.36 * sh   # bottom of the head grid (hidden under the collar)
        self.budget = {'body': 13500, 'head': 7000, 'hands': 2600, 'props': 1200}
        self.emissive = {}
        self.skin_mats = ('skin',)
        self.palette_defaults = {'eye': dict(kind='eye')}

    # ------------------------------------------------------------------ shortcuts
    @property
    def P(self):
        return self.B.parts

    def H(self, x, y, z):
        """Point in the head frame (head centre, scaled by the head size)."""
        return self.sk.head_c + np.array([x, y, z]) * self.sk.head_k

    def nude_inner(self):
        """Body under the clothes, a little shrunk (it only shows where nothing covers it; the head and hand meshes cover the neck and wrists)."""
        return Offset(self.B.nude(with_hands=False), -0.0025, mat="skin")

    def arm_cut(self, s, frac):
        """Arm part cut at a fraction of the forearm (1 = wrist), keeping the shoulder side."""
        sk = self.sk
        el, wr = sk.head('LowerArm.' + s), sk.head('Hand.' + s)
        fa = (wr - el) / np.linalg.norm(wr - el)
        p = el + (wr - el) * frac
        return cloth.cut(self.P['arm.' + s], p, fa)

    def arm_upper_cut(self, s, frac):
        sk = self.sk
        sho, el = sk.head('UpperArm.' + s), sk.head('LowerArm.' + s)
        ua = (el - sho) / np.linalg.norm(el - sho)
        return cloth.cut(self.P['arm.' + s], sho + (el - sho) * frac, ua)

    def torso_cut(self, z0, z1, neck_front=0.0):
        """Torso between two heights; the top is tilted (lower in front by neck_front) for collars."""
        t = cloth.cut(self.P['torso'], (0, 0, z0), (0, 0, -1))
        n = np.array([0, -neck_front, 1.0]); n /= np.linalg.norm(n)
        return cloth.cut(t, (0, 0, z1), n)

    def leg_cut(self, s, z0, z1):
        l = cloth.cut(self.P['leg.' + s], (0, 0, z0), (0, 0, -1))
        return cloth.cut(l, (0, 0, z1), (0, 0, 1))

    def top(self, mat, t=0.012, hem=0.98, sleeve=1.0, collar=1.44, neck_front=0.4, k=0.035, loose=0.0):
        """Shirt / jacket: torso from the hem to the collar line, sleeves to `sleeve` (fraction of the forearm; <0: short sleeves at that fraction of the upper arm)."""
        parts = [self.torso_cut(hem, collar, neck_front)]
        for s in ('L', 'R'):
            if sleeve is None:
                continue
            parts.append(self.arm_cut(s, sleeve) if sleeve >= 0 else self.arm_upper_cut(s, -sleeve))
        u = self.B.assemble(parts, k)
        if loose:
            u = Offset(u, loose)
        return Offset(u, t, mat=mat)

    def _gcut_arm(self, B, s, frac):
        sk = self.sk
        el, wr = sk.head('LowerArm.' + s), sk.head('Hand.' + s)
        if frac >= 0:
            fa = (wr - el) / np.linalg.norm(wr - el)
            return cloth.cut(B.parts['arm.' + s], el + (wr - el) * frac, fa)
        sho = sk.head('UpperArm.' + s)
        ua = (el - sho) / np.linalg.norm(el - sho)
        return cloth.cut(B.parts['arm.' + s], sho + (el - sho) * (-frac), ua)

    def loose_top(self, mat, t=0.008, hem=0.95, sleeve=0.93, collar=1.44, neck_front=0.45, k=0.04, cover=None):
        """Loose shirt / jacket over the garment body (fuller shapes), never thinner than the real body + cover."""
        out = []
        cover = 0.005 + t * 0.6 if cover is None else cover       # outer layers also cover more of the real body (no inner layer shows through)
        for B, tt in ((self.G, t), (self.B, cover)):
            parts = [cloth.cut(cloth.cut(B.parts['torso'], (0, 0, hem), (0, 0, -1)), (0, 0, collar), np.array([0, -neck_front, 1.0]) / np.hypot(neck_front, 1))]
            for s in ('L', 'R'):
                if sleeve is not None:
                    parts.append(self._gcut_arm(B, s, sleeve))
            out.append(Offset(B.assemble(parts, k), tt))
        return Label(Union(out, k=0.01), mat=mat)

    def loose_pants(self, mat, t=0.008, waist=1.03, cuff=0.12, k=0.05, cover=None, crotch=0.0):
        out = []
        cover = 0.005 + t * 0.6 if cover is None else cover
        for B, tt in ((self.G, t), (self.B, cover)):
            parts = [cloth.cut(B.parts['torso'], (0, 0, waist), (0, 0, 1))]
            for s in ('L', 'R'):
                parts.append(cloth.cut(B.parts['leg.' + s], (0, 0, cuff), (0, 0, -1)))
            out.append(Offset(B.assemble(parts, k), tt))
        return Label(Union(out, k=0.01), mat=mat)

    def skirt(self, mat, top_z, hem_z, r_top, r_hem, sy=0.8, thick=0.0075, front_open=0.0, back_slit=0.0, flare=1.0, y0=0.0, folds=0.0, seed=0.0):
        """Long coat / robe / lab-coat skirt: a hollow elliptic cone around both legs (region Skirt: hips at the top, thighs below),
        front_open: half width of the opening at the hem (m), back_slit: height of a vent at the back."""
        S = self.sk.S
        zt, zh = top_z * self.sk.sh, hem_z * self.sk.sh
        prof = [(0.0, 0.0), (r_hem, 0.0), (r_hem * (0.5 + 0.5 * flare) + r_top * (0.5 - 0.5 * flare), (zt - zh) * 0.5), (r_top, zt - zh + 0.02), (0.0, zt - zh + 0.02)]
        cone = Revolve(np.array([0, y0, zh]), prof, sxy=(1.0, sy), round_r=0.0)
        if folds:
            cone = cloth.drape(cone, (0, y0, zh), amp=folds, freq=14, z0=zh, z1=zt, seed=seed)
        sh = Shell(cone, thick)
        sh = cloth.cut(cloth.cut(sh, (0, 0, zh + thick + 0.001), (0, 0, -1)), (0, 0, zt), (0, 0, 1))
        if front_open > 0:
            w = front_open
            def wedge(P, zh=zh, zt=zt, w=w):
                t = np.clip((P[:, 2] - zh) / (zt - zh), 0, 1)
                half = w * (1 - t) + 0.004
                return np.maximum(np.abs(P[:, 0]) - half, P[:, 1])
            sh = Sub(sh, Func(wedge, np.array([-0.5, -0.5, zh - 0.05]), np.array([0.5, 0.0, zt + 0.05])), k=0.002)
        if back_slit > 0:
            sh = Sub(sh, RBox(np.array([0, 0.25, zh]), (0.006, 0.2, back_slit), 0.002))
        return Label(sh, mat=mat, reg='Skirt')

    def pants(self, mat, t=0.01, waist=1.02, cuff=0.1, k=0.035):
        parts = [cloth.cut(self.P['torso'], (0, 0, waist), (0, 0, 1))]
        for s in ('L', 'R'):
            parts.append(cloth.cut(self.P['leg.' + s], (0, 0, cuff), (0, 0, -1)))
        u = self.B.assemble(parts, k)
        return Offset(u, t, mat=mat)

    def shoe(self, s, mat, sole_mat, shaft=0.0, toe_r=1.0, heel=0.0, width=1.0, shaft_mat=None, sole_h=0.014):
        """Shoe or boot on one foot (shaft: height of the boot top above the ankle, 0 = shoe)."""
        sk = self.sk
        an, ball, toe = sk.head('Foot.' + s), sk.head('Toe.' + s), sk.tail('Toe.' + s)
        x = an[0]
        w = width
        reg_f, reg_t, reg_l = 'Foot.' + s, 'Toe.' + s, 'LowerLeg.' + s
        z0 = sole_h + heel * 0.6
        up = []
        up.append(Ellipsoid((x, 0.056, z0 + 0.045), (0.038 * w, 0.042, 0.052), mat=mat, reg=reg_f))                      # heel
        up.append(RoundCone((x, 0.02, z0 + 0.05), (x, -0.105, z0 + 0.026), 0.044 * w, 0.037 * w, mat=mat, reg=reg_f))   # instep
        up.append(Ellipsoid((x + (0.003 if s == 'L' else -0.003), -0.142, z0 + 0.024), (0.043 * w, 0.05 * toe_r, 0.028), mat=mat, reg=reg_t))  # toe box
        up.append(RoundCone((x, 0.018, z0 + 0.05), (x, 0.012, z0 + 0.1 + shaft), 0.046, 0.044 if shaft > 0 else 0.04,
                            mat=shaft_mat or mat, reg=reg_l))                                                              # ankle / shaft
        u = Union(up, k=0.02)
        topz = z0 + 0.1 + shaft
        u = cloth.cut(u, (0, 0, topz), (0, 0.18, 1))
        # sole: the outline of the upper, a little wider, flat underneath (heel block for heeled shoes)
        foot = Union([Ellipsoid((x, 0.056, 0.05), (0.038 * w, 0.042, 0.06)), RoundCone((x, 0.03, 0.04), (x, -0.105, 0.03), 0.044 * w, 0.038 * w),
                      Ellipsoid((x + (0.003 if s == 'L' else -0.003), -0.142, 0.03), (0.043 * w, 0.05 * toe_r, 0.04))], k=0.02)
        sole = Inter(Offset(foot, 0.004), RBox((x, -0.04, (sole_h + heel) / 2), (0.1, 0.2, (sole_h + heel) / 2), 0.0))
        if heel > 0:
            sole = Union([Inter(sole, Plane((x, 0.0, sole_h), (0, -1, 0.0))), Inter(Offset(foot, 0.004), RBox((x, -0.06, sole_h / 2), (0.1, 0.2, sole_h / 2), 0.0))])
        sole = Label(sole, mat=sole_mat, reg=reg_f)
        return Union([u, sole], k=0.003)

    def glove(self, mat, t=0.0018, cuff_len=0.05, cuff_t=0.004, cuff_mat=None, knuckles=None):
        """Gloves over both hands (with a cuff over the wrist)."""
        out = []
        for s in ('L', 'R'):
            sk = self.sk
            wr = sk.head('Hand.' + s)
            el = sk.head('LowerArm.' + s)
            fa = (wr - el) / np.linalg.norm(wr - el)
            wrist = cloth.cut(self.P['arm.' + s], wr - fa * cuff_len, -fa)
            hand = Union([self.P['hand.' + s], wrist], kfun=body.near(wr, 0.015, 0.04, 0.012))
            g = Offset(hand, t, mat=mat)
            cuff = cloth.cut(cloth.cut(Offset(wrist, t + cuff_t), wr - fa * cuff_len, -fa), wr + fa * 0.012, fa)
            out.append(Union([g, Label(cuff, mat=cuff_mat or mat)], k=0.004))
        return out

    def bare_hands(self, sleeve_len=0.07):
        out = []
        for s in ('L', 'R'):
            sk = self.sk
            wr = sk.head('Hand.' + s)
            el = sk.head('LowerArm.' + s)
            fa = (wr - el) / np.linalg.norm(wr - el)
            wrist = cloth.cut(self.P['arm.' + s], wr - fa * sleeve_len, -fa)
            out.append(Label(Union([self.P['hand.' + s], wrist], kfun=body.near(wr, 0.015, 0.04, 0.012)), mat='skin'))
        return out

    def head_skin(self):
        """Neck and head (skin) for the head grid, cut under the collar line."""
        neck = cloth.cut(self.P['torso'], (0, 0, self.collar_z), (0, 0, -1))
        u = Union([Label(self.face, mat='skin'), Label(neck, mat='skin')], kfun=body.near(self.sk.head('Head') + [0, 0.01, -0.01], 0.03, 0.07, 0.016))
        return u

    def skull(self, grow=0.0):
        sk = self.sk
        hk, c = sk.head_k, sk.head_c
        return Union([Ellipsoid(c + np.array([0, 0.018, 0.03]) * hk, np.array([0.0735, 0.093, 0.092]) * hk + grow),
                      Ellipsoid(c + np.array([0, 0.03, -0.03]) * hk, np.array([0.062, 0.068, 0.06]) * hk + grow),
                      Ellipsoid(c + np.array([0, -0.03, 0.045]) * hk, np.array([0.06, 0.055, 0.058]) * hk + grow)], k=0.024 * hk)

    def hairline_fn(self, front=0.062, temple=0.036, side=0.018, nape=-0.055, sideburn=-0.012):
        ys = np.array([-0.13, -0.07, -0.045, -0.02, 0.0, 0.025, 0.045, 0.07, 0.14])
        zs = np.array([front, front - 0.004, temple, side + 0.008, side, side, nape * 0.3, nape, nape - 0.01])
        def f(q):
            q = np.atleast_2d(q)
            zl = np.interp(q[:, 1], ys, zs)
            sb = (np.abs(q[:, 1] + 0.005) < 0.009) & (np.abs(q[:, 0]) > 0.055)
            zl = np.where(sb, np.minimum(zl, sideburn), zl)
            r = q[:, 2] - zl
            return r if len(r) > 1 else r[0]
        return f

    def hair_cap(self, mat='hair', t=0.005, front=0.062, temple=0.036, side=0.018, nape=-0.055, sideburn=-0.012, volume=0.0, whorl=None, grooves=0.0007):
        """Hair as a shell over the skull, above a hairline described by heights (head frame) at the front, temples, over the ears and at the nape."""
        sk = self.sk
        hk, c = sk.head_k, sk.head_c
        self.hairline = self.hairline_fn(front, temple, side, nape, sideburn)
        hl = self.hairline
        line = Func(lambda P: -hl((P - c) / hk) * hk, c - 0.2, c + 0.2)
        skull = self.skull()
        if volume:
            skull = Union([skull, Ellipsoid(c + np.array([0, 0.012, 0.045]) * hk, np.array([0.072, 0.092, 0.082]) * hk * (1 + volume))], k=0.03)
        self._hair_t = t
        self._hair_skull = skull
        cap = Inter(Offset(skull, t), line, k=0.004)
        if grooves > 0:
            # strands: fine ridges along the combing direction (meridians around the axis head centre -> whorl, e.g. the ponytail tie)
            W = np.asarray(whorl if whorl is not None else c + np.array([0, 0.06, 0.1]) * hk, float)
            ax = (W - c) / np.linalg.norm(W - c)
            r1 = np.cross(ax, [1.0, 0, 0]); r1 /= np.linalg.norm(r1)
            r2 = np.cross(ax, r1)
            def gr(P, ax=ax, r1=r1, r2=r2, c=c):
                q = P - c
                phi = np.arctan2(q @ r2, q @ r1)
                wob = 0.25 * np.sin(q @ ax * 90.0 + phi * 3.0)
                return -grooves * (0.5 + 0.5 * np.sin(phi * 150.0 + wob * 6.0)) * (0.6 + 0.4 * np.sin(phi * 37.0 + 1.3))
            cap = Displace(cap, gr, grooves)
        return Label(cap, mat=mat, reg='Head')

    def hair_surface(self):
        """Surface the hair cards grow from (the cap)."""
        sk = getattr(self, '_hair_skull', None) or self.skull()
        return Offset(sk, getattr(self, '_hair_t', 0.004))

    # ------------------------------------------------------------------ texture context (charlib/tex.py)
    def finish(self):
        for k, v in self.palette_defaults.items():
            self.palette.setdefault(k, v)
        return self

    def tex_extra(self):
        from . import tex
        sk = self.sk
        hk = sk.head_k
        eyes, re = face.eye_centres(sk)
        iris = tex.hexrgb(self.iris)
        sp = self.palette.get('skin', {})
        nails = []
        for s in ('L', 'R'):
            _, fdir, palm_n, fwd = sk.__dict__['hand_' + s]
            for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
                n = '%s3.%s' % (f, s)
                a, b = sk.head(n), sk.tail(n)
                back = -palm_n if f != 'Thumb' else -(sk.by[n][4])
                nails.append((a, b, back / np.linalg.norm(back), 0.0095))
        hp = self.palette.get('hair', {})
        c = sk.head_c
        def flow(P):
            q = (P - c) / hk
            f = np.stack([q[:, 0] * 0.4, np.ones(len(P)) * 0.8, -np.clip(q[:, 2] + 0.02, -1, 1) * 2.0 - 0.3], 1)
            return f / np.linalg.norm(f, axis=1, keepdims=True)
        x = {'head_frame': (c, hk), 'eye': [(e, np.array([0, -1.0, 0]), re, iris) for e in eyes], 'nails': nails if 'skin' in self.palette else None,
             'mouth_z': -0.0715 * self.face_p.get('face_len', 0.94 if self.sk.fem else 1.0), 'brow_color': sp.get('brow', hp.get('color', 0x2b1d12)),
             'stubble': sp.get('stubble', 0.0), 'lip_color': sp.get('lips', 0xb06a64 if not self.sk.fem else 0xb85a62), 'blush': sp.get('blush', 0xc0605a),
             'brow': sp.get('brow_k', 1.0), 'hair_flow': flow, 'dirt': self.palette.get('_dirt', 0.25)}
        return x

    # ------------------------------------------------------------------ assembled trees
    def trees(self):
        body_t = Union([self.nude_inner()] + self.garments, k=0.0)
        head_t = Union([self.head_skin()] + self.head_gear, k=0.0)
        hands = self.hand_gear if self.hand_gear is not None else self.bare_hands()
        return {'body': body_t, 'head': head_t, 'hands': Union(hands)}
