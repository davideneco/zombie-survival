# Shared humanoid skeleton of the playable characters (v0.31.0). Reference: adult of 1.75 m, Blender axes (Z up, front = -Y, character's left = +X).
# The 18 bones of v0.21 keep their names, parents and roles (scenes/avatar_pose.gd, CharacterModel, rides_view.gd); v0.31.0 adds:
#   Hand.L/R, five fingers x three phalanges per hand (Thumb1-3, Index1-3, Middle1-3, Ring1-3, Pinky1-3 .L/.R), Toe.L/R,
#   Jaw, Eye.L/R and Lid.L/R (upper eyelids, for the blink of scenes/face_rig.gd).
# Each bone is (name, parent, head, tail, z_axis): z_axis is the direction the bone's local Z should point to (roll). For fingers it is the palm side, so a
# positive rotation about the bone's local X axis always flexes (curls) a finger, on both hands.
import numpy as np

FINGERS = ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky')

class Skel:
    def __init__(self, sw=1.0, sh=1.0, fem=False, head_k=1.0, arm_out=0.0, shoulder_w=1.0, hip_w=1.0, neck_len=1.0):
        """sw / sh : width and height scales (the scales of the browser game); head_k : head size; shoulder_w, hip_w : extra width factors."""
        self.sw, self.sh, self.fem, self.head_k = sw, sh, fem, head_k
        S = lambda x, y, z: np.array([x * sw, y * sw, z * sh], dtype=np.float64)
        self.S = S
        B = []
        def add(n, p, h, t, z=(0, -1, 0)):
            B.append((n, p, np.asarray(h, float), np.asarray(t, float), np.asarray(z, float)))
        sw_k = shoulder_w * (0.93 if fem else 1.0)
        hw = hip_w * (1.06 if fem else 1.0)
        add('Root', None, S(0, 0, 0), S(0, 0, 0.1))
        add('Hips', 'Root', S(0, 0, 0.92), S(0, 0, 1.0))
        add('Abdomen', 'Hips', S(0, 0, 1.0), S(0, 0, 1.12))
        add('Torso', 'Abdomen', S(0, 0, 1.12), S(0, 0.0, 1.42))
        neck_top = 1.42 + 0.125 * neck_len
        add('Neck', 'Torso', S(0, 0.0, 1.42), S(0, -0.005, neck_top))
        # head: pivot at the top of the neck; the head shape is built around the head centre (between the ears, at eye level)
        hk = head_k
        self.head_c = S(0, 0, 0) + np.array([0, -0.006 * sw, neck_top * sh + 0.10 * hk])
        hc = self.head_c
        add('Head', 'Neck', S(0, -0.005, neck_top), np.array([0, -0.005 * sw, hc[2] + 0.15 * hk]))
        add('Jaw', 'Head', hc + np.array([0, 0.012, -0.055]) * hk, hc + np.array([0, -0.072, -0.11]) * hk, (0, 0, -1))
        for s, sx in (('L', 1), ('R', -1)):
            e = hc + np.array([sx * 0.0315, -0.071, 0.0]) * hk
            self.__dict__['eye_' + s] = e
            add('Eye.' + s, 'Head', e, e + np.array([0, -0.025, 0]) * hk, (0, 0, 1))
            add('Lid.' + s, 'Head', e, e + np.array([0, -0.022, 0.006]) * hk, (0, 0, 1))
            xs = 0.175 * sw_k
            sho = S(sx * xs, 0.008, 1.405)
            add('Shoulder.' + s, 'Torso', S(sx * 0.02, 0.0, 1.395), sho)
            el = S(sx * (xs + 0.042 + arm_out), 0.018, 1.125)
            add('UpperArm.' + s, 'Shoulder.' + s, sho, el)
            wr = S(sx * (xs + 0.072 + arm_out * 1.6), -0.012, 0.866)
            add('LowerArm.' + s, 'UpperArm.' + s, el, wr)
            # hand: hanging, palm towards the thigh (palm normal = -sx X), thumb forward (-Y)
            fdir = (wr - el) / np.linalg.norm(wr - el)
            palm_n = np.array([-sx, 0.0, 0.0])
            palm_n = palm_n - fdir * palm_n.dot(fdir); palm_n /= np.linalg.norm(palm_n)
            fwd = np.cross(fdir, palm_n) * sx      # towards the thumb side (front)
            fwd /= np.linalg.norm(fwd)
            if fwd[1] > 0: fwd = -fwd
            hl = 0.085 * sh                        # wrist -> knuckles
            kn = wr + fdir * hl
            add('Hand.' + s, 'LowerArm.' + s, wr, kn, palm_n)
            self.__dict__['hand_' + s] = (wr, fdir, palm_n, fwd)
            # fingers: knuckles across the palm (index at the front), three phalanges each, slightly spread
            lens = {'Index': (0.040, 0.025, 0.020), 'Middle': (0.045, 0.028, 0.021), 'Ring': (0.041, 0.027, 0.020), 'Pinky': (0.031, 0.020, 0.018)}
            offs = {'Index': 0.027, 'Middle': 0.008, 'Ring': -0.011, 'Pinky': -0.028}
            back = {'Index': 0.0, 'Middle': 0.004, 'Ring': 0.001, 'Pinky': -0.008}
            spread = {'Index': 0.07, 'Middle': 0.0, 'Ring': -0.07, 'Pinky': -0.15}
            for f in ('Index', 'Middle', 'Ring', 'Pinky'):
                base = kn + fwd * offs[f] * sw + fdir * back[f] * sh - palm_n * 0.002
                d = fdir * np.cos(spread[f]) + fwd * np.sin(spread[f])
                d /= np.linalg.norm(d)
                p = base
                par = 'Hand.' + s
                for i, L in enumerate(lens[f]):
                    q = p + d * L * sh
                    add('%s%d.%s' % (f, i + 1, s), par, p, q, palm_n)
                    par = '%s%d.%s' % (f, i + 1, s)
                    p = q
            # thumb: from the base of the palm (front side), going forward and down, curling across the palm
            tb = wr + fdir * 0.022 * sh + fwd * 0.018 * sw + palm_n * 0.010
            tdir = fdir * 0.55 + fwd * 0.75 + palm_n * 0.36
            tdir /= np.linalg.norm(tdir)
            tz = -fwd * 0.75 + palm_n * 0.6
            tz = tz - tdir * tz.dot(tdir); tz /= np.linalg.norm(tz)
            p = tb
            par = 'Hand.' + s
            for i, L in enumerate((0.040, 0.032, 0.026)):
                d = tdir
                if i > 0:
                    d = tdir * 0.94 + fdir * 0.34
                    d /= np.linalg.norm(d)
                q = p + d * L * sh
                add('Thumb%d.%s' % (i + 1, s), par, p, q, tz)
                par = 'Thumb%d.%s' % (i + 1, s)
                p = q
            xl = 0.092 * hw
            hip = S(sx * xl, 0.0, 0.92)
            kne = S(sx * (xl + 0.004), -0.004, 0.50)
            ank = S(sx * (xl + 0.008), 0.022, 0.085)
            ball = S(sx * (xl + 0.012), -0.108, 0.026)
            toe = S(sx * (xl + 0.014), -0.172, 0.022)
            add('UpperLeg.' + s, 'Hips', hip, kne)
            add('LowerLeg.' + s, 'UpperLeg.' + s, kne, ank)
            add('Foot.' + s, 'LowerLeg.' + s, ank, ball, (0, 0, 1))
            add('Toe.' + s, 'Foot.' + s, ball, toe, (0, 0, 1))
        self.bones = B
        self.by = {b[0]: b for b in B}
        self.names = [b[0] for b in B]

    def head(self, n): return self.by[n][2]
    def tail(self, n): return self.by[n][3]
    def parent(self, n): return self.by[n][1]
    def children(self, n): return [b[0] for b in self.bones if b[1] == n]

# The 18 bones of v0.21 (kept), then the v0.31 additions (tests: tests/test_j29.gd).
LEGACY = ['Root', 'Hips', 'Abdomen', 'Torso', 'Neck', 'Head', 'Shoulder.L', 'UpperArm.L', 'LowerArm.L', 'Shoulder.R', 'UpperArm.R', 'LowerArm.R',
          'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R']
