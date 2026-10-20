# Construit les 8 personnages jouables du port Godot (v0.21.0). Usage (Blender 5.x, sans scripts auto-exécutés) :
#   blender -b --disable-autoexec --python tools/build-characters.py -- <dossier de sortie> [id ...]
# Aucun asset externe : tout est modélisé ici, de zéro (ellipsoïdes, tubes, boîtes arrondies, tours de révolution), en low-poly « cartoon » proche des zombies
# (assets/zombies). Un squelette humanoïde commun (mêmes noms d'os pour les 8 : Root, Hips, Abdomen, Torso, Neck, Head, Shoulder/UpperArm/LowerArm .L/.R,
# UpperLeg/LowerLeg/Foot .L/.R), proportions propres à chaque personnage, 7 animations rédigées à la main (rotations d'os seulement) :
#   Idle, Walk, Run, Sit_Moto, Sit_Bike, Sit_Tram, Sit_Tram_Drive, Death.
# Repère Blender : Z haut, l'avant est -Y, la gauche du personnage est +X (os « .L ») ; à l'export glTF l'avant devient +Z (comme les zombies).
# Les pièces sont rigides (un os par pièce) ; les manteaux et robes longs sont pondérés entre le bassin et les cuisses (ils suivent les jambes).
# Un objet « Prop_* » (canne, baguette) est une pièce séparée que le jeu cache quand le personnage est assis.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix, Euler, Quaternion

args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
ONLY = set(args[1:])
os.makedirs(OUT, exist_ok=True)

def hexc(h):
    r, g, b = ((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

# ------------------------------------------------------------------ constructeur de maillage
class Builder:
    def __init__(self, mats):
        self.mats = mats                  # nom -> (couleur hex, rugosité, métal, émission hex ou None)
        self.matnames = list(mats.keys())
        self.objs = {}                    # nom d'objet -> bmesh
        self.parts = []                   # indice de pièce -> os (str) ou fonction poids(co) -> {os: poids}

    def _bm(self, obj):
        if obj not in self.objs:
            bm = bmesh.new()
            bm.faces.layers.int.new('part')
            self.objs[obj] = bm
        return self.objs[obj]

    def _emit(self, obj, vs, fs, mat, bone, smooth=True, flat_faces=None):
        """vs : sommets (Vector, repère de référence) ; fs : listes d'indices ; une pièce = un os."""
        bm = self._bm(obj)
        layer = bm.faces.layers.int['part']
        pid = len(self.parts)
        self.parts.append(bone)
        mi = self.matnames.index(mat)
        bv = [bm.verts.new(v) for v in vs]
        c = sum(vs, Vector()) / len(vs)
        made = []
        votes = 0
        for f in fs:
            try:
                face = bm.faces.new([bv[i] for i in f])
            except ValueError:
                continue
            made.append(face)
        bm.faces.ensure_lookup_table()
        for face in made:
            face.normal_update()
            fc = face.calc_center_median()
            votes += 1 if face.normal.dot(fc - c) >= 0 else -1
        flip = votes < 0
        for k, face in enumerate(made):
            if flip:
                face.normal_flip()
            face.material_index = mi
            face.smooth = smooth
            face[layer] = pid
        return pid

    @staticmethod
    def _xf(pts, pos, rot, scale):
        m = Matrix.Translation(pos) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
        return [m @ Vector(p) for p in pts]

    def lathe(self, prof, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), segs=12, mat='skin', bone='Torso', obj='Body',
              cap0=True, cap1=True, smooth=True, a0=0.0, a1=2 * math.pi):
        """Surface de révolution autour de l'axe local Z ; prof = [(rayon, hauteur)] du bas vers le haut."""
        if callable(bone) and len(prof) < 8:   # vêtement pondéré : profil plus fin pour que la flexion reste lisse
            fine = []
            for k in range(len(prof) - 1):
                for q in range(4):
                    t = q / 4.0
                    fine.append((prof[k][0] + (prof[k + 1][0] - prof[k][0]) * t, prof[k][1] + (prof[k + 1][1] - prof[k][1]) * t))
            fine.append(prof[-1])
            prof = fine
        vs, fs, rings = [], [], []
        full = abs((a1 - a0) - 2 * math.pi) < 1e-6
        nseg = segs if full else segs + 1
        for (r, h) in prof:
            if r < 1e-6:
                vs.append((0, 0, h)); rings.append([len(vs) - 1] * nseg)
            else:
                ids = []
                for s in range(nseg):
                    a = a0 + (a1 - a0) * (s / segs)
                    vs.append((r * math.cos(a), r * math.sin(a), h)); ids.append(len(vs) - 1)
                rings.append(ids)
        ns = segs if full else segs
        for i in range(len(prof) - 1):
            for s in range(ns):
                s2 = (s + 1) % nseg
                a, b, c, d = rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]
                if a == b: fs.append([a, c, d] if c != d else [])
                elif c == d: fs.append([a, b, c])
                else: fs.append([a, b, c, d])
        fs = [f for f in fs if len(f) >= 3]
        def cap(ring_r, ring_h, up):
            if ring_r < 1e-6: return
            base = len(vs)
            vs.append((0, 0, ring_h))
            ids = []
            for s in range(nseg):
                a = a0 + (a1 - a0) * (s / segs)
                vs.append((ring_r * math.cos(a), ring_r * math.sin(a), ring_h)); ids.append(len(vs) - 1)
            for s in range(ns):
                s2 = (s + 1) % nseg
                fs.append([base, ids[s], ids[s2]])
        if cap0: cap(prof[0][0], prof[0][1], False)
        if cap1: cap(prof[-1][0], prof[-1][1], True)
        # le plat des bouchons est lisse seulement si la pièce l'est : on garde un seul drapeau de lissage
        return self._emit(obj, self._xf(vs, Vector(pos), rot, scale), fs, mat, bone, smooth)

    def ell(self, pos, radii, mat, bone, rot=(0, 0, 0), segs=10, rings=6, obj='Body', top=0.0, bot=0.0):
        """Ellipsoïde (rayons x, y, z) ; top/bot : fraction coupée aux pôles (0 = entier)."""
        prof = []
        for i in range(rings + 1):
            t = math.pi * i / rings
            prof.append((math.sin(t), -math.cos(t)))
        return self.lathe(prof, pos, rot, radii, segs, mat, bone, obj, True, True, True)

    def tube(self, p0, p1, r0, r1, mat, bone, segs=8, obj='Body', smooth=True, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        e = q.to_euler('XYZ')
        return self.lathe([(r0, 0.0), (r1, d.length)], p0, tuple(e), (1, 1, 1), segs, mat, bone, obj, caps, caps, smooth)

    def rbox(self, pos, size, mat, bone, r=0.02, rot=(0, 0, 0), n=3, obj='Body', weights=None):
        """Boîte aux arêtes arrondies (rayon r), maillage soudé, ombrage lisse."""
        if callable(bone): n = max(n, 10)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        r = min(r, hx * 0.95, hy * 0.95, hz * 0.95)
        keymap, vs, fs = {}, [], []
        def vid(p):
            k = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
            if k not in keymap:
                keymap[k] = len(vs); vs.append(p)
            return keymap[k]
        def proj(p):
            ix, iy, iz = (max(-(hx - r), min(hx - r, p[0])), max(-(hy - r), min(hy - r, p[1])), max(-(hz - r), min(hz - r, p[2])))
            d = Vector((p[0] - ix, p[1] - iy, p[2] - iz))
            if d.length < 1e-9: return (p[0], p[1], p[2])
            d.normalize()
            return (ix + d.x * r, iy + d.y * r, iz + d.z * r)
        hs = (hx, hy, hz)
        for ax in range(3):
            for sgn in (-1, 1):
                u, v = [i for i in range(3) if i != ax]
                grid = []
                for a in range(n + 1):
                    row = []
                    for b in range(n + 1):
                        p = [0, 0, 0]
                        p[ax] = sgn * hs[ax]
                        p[u] = -hs[u] + 2 * hs[u] * a / n
                        p[v] = -hs[v] + 2 * hs[v] * b / n
                        row.append(vid(proj(p)))
                    grid.append(row)
                for a in range(n):
                    for b in range(n):
                        fs.append([grid[a][b], grid[a + 1][b], grid[a + 1][b + 1], grid[a][b + 1]])
        return self._emit(obj, self._xf(vs, Vector(pos), rot, (1, 1, 1)), fs, mat, bone, True)

    def box(self, pos, size, mat, bone, rot=(0, 0, 0), obj='Body'):
        return self.rbox(pos, size, mat, bone, r=0.003, rot=rot, n=1, obj=obj)

    def torus(self, pos, R, r, mat, bone, rot=(0, 0, 0), segs=14, tsegs=6, obj='Body', scale=(1, 1, 1)):
        vs, fs = [], []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            for j in range(tsegs):
                b = 2 * math.pi * j / tsegs
                vs.append(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
        for i in range(segs):
            for j in range(tsegs):
                i2, j2 = (i + 1) % segs, (j + 1) % tsegs
                fs.append([i * tsegs + j, i2 * tsegs + j, i2 * tsegs + j2, i * tsegs + j2])
        return self._emit(obj, self._xf(vs, Vector(pos), rot, scale), fs, mat, bone, True)

    def poly(self, vs, fs, mat, bone, obj='Body', smooth=False):
        return self._emit(obj, [Vector(v) for v in vs], fs, mat, bone, smooth)

# ------------------------------------------------------------------ squelette (repère de référence, taille 1,75 m)
HIP_Z = 0.92
HEAD_K = 1.12
def skirt_w(co):
    """Pondération d'un vêtement long : bassin en haut, cuisse du côté du sommet en bas."""
    t = max(0.0, min(1.0, (HIP_Z - 0.02 - co[2]) / 0.32))
    wl = max(0.0, min(1.0, 0.5 + co[0] / 0.07))
    return {'Hips': 1.0 - t, 'UpperLeg.L': t * wl, 'UpperLeg.R': t * (1.0 - wl)}

def bones_def(x_leg=0.095, x_sh=0.235):
    B = []
    def add(name, parent, head, tail): B.append((name, parent, Vector(head), Vector(tail)))
    add('Root', None, (0, 0, 0), (0, 0, 0.1))
    add('Hips', 'Root', (0, 0, 0.92), (0, 0, 1.0))
    add('Abdomen', 'Hips', (0, 0, 1.0), (0, 0, 1.12))
    add('Torso', 'Abdomen', (0, 0, 1.12), (0, 0, 1.40))
    add('Neck', 'Torso', (0, 0, 1.40), (0, 0, 1.50))
    add('Head', 'Neck', (0, 0, 1.50), (0, 0, 1.50 + 0.25 * HEAD_K))
    for s, sx in (('L', 1), ('R', -1)):
        add('Shoulder.' + s, 'Torso', (sx * 0.04, 0, 1.38), (sx * x_sh, 0, 1.38))
        add('UpperArm.' + s, 'Shoulder.' + s, (sx * x_sh, 0, 1.38), (sx * (x_sh + 0.01), 0, 1.10))
        add('LowerArm.' + s, 'UpperArm.' + s, (sx * (x_sh + 0.01), 0, 1.10), (sx * (x_sh + 0.01), 0, 0.84))
        add('UpperLeg.' + s, 'Hips', (sx * x_leg, 0, 0.92), (sx * x_leg, 0, 0.50))
        add('LowerLeg.' + s, 'UpperLeg.' + s, (sx * x_leg, 0, 0.50), (sx * x_leg, 0, 0.09))
        add('Foot.' + s, 'LowerLeg.' + s, (sx * x_leg, 0, 0.09), (sx * x_leg, -0.14, 0.04))
    return B

# ------------------------------------------------------------------ corps de base commun
def humanoid(b, c):
    """c : dict de style. Construit jambes, bassin, buste, cou, tête, visage, bras, mains."""
    sk = 'skin'
    fem = c.get('fem', False)
    belly = c.get('belly', 0.0)
    for s, sx in (('L', 1), ('R', -1)):
        x = sx * 0.095
        # jambes : cuisse, genou, mollet, chaussure
        b.tube((x, 0, 0.93), (x, 0, 0.52), 0.098, 0.074, 'pants', 'UpperLeg.' + s, 10)
        b.ell((x, 0, 0.50), (0.077, 0.077, 0.077), c.get('knee_mat', 'pants'), 'UpperLeg.' + s if c.get('knee_mat') is None else 'LowerLeg.' + s, segs=8, rings=5)
        b.tube((x, 0, 0.50), (x, 0, 0.13), 0.074, 0.055, 'pants_low', 'LowerLeg.' + s, 10)
        b.tube((x, 0, 0.20), (x, 0, 0.06), 0.060, 0.062, 'boots', 'LowerLeg.' + s, 10)   # tige de la chaussure
        b.rbox((x, -0.04, 0.05), (0.105, 0.215, 0.09), 'boots', 'Foot.' + s, r=0.04)
        b.rbox((x, -0.04, 0.013), (0.11, 0.225, 0.028), 'sole', 'Foot.' + s, r=0.013)
    # bassin et buste
    b.ell((0, 0, 0.99), (0.165 * (1.06 if fem else 1.0), 0.115, 0.115), 'pants', 'Hips', segs=12, rings=6)
    b.rbox((0, 0, 1.065), (0.30 + belly, 0.20 + belly * 0.8, 0.16), 'top', 'Abdomen', r=0.07)
    chest_w = 0.40 if not fem else 0.36
    b.rbox((0, 0, 1.25), (chest_w, 0.235, 0.32), 'top', 'Torso', r=0.09)
    b.tube((0, 0, 1.38), (0, 0, 1.50), 0.052, 0.046, sk, 'Neck', 8)
    if not c.get('no_belt'):
        b.tube((0, 0, 1.03), (0, 0, 1.075), 0.168 + belly * 0.4, 0.168 + belly * 0.4, 'belt', 'Abdomen', 14)
    # tête
    hc = (0, 0, 1.625)
    b.ell(hc, (0.108, 0.118, 0.133), sk, 'Head', segs=14, rings=9)
    b.ell((0, -0.04, 1.555), (0.085, 0.085, 0.07), sk, 'Head', segs=10, rings=5)             # mâchoire / menton
    if not c.get('no_face'):
        for sx in (-1, 1):
            b.ell((sx * 0.045, -0.101, 1.64), (0.017, 0.010, 0.021), c.get('eye_white', 'eye'), 'Head', segs=8, rings=4)
            b.ell((sx * 0.045, -0.109, 1.64), (0.0105, 0.006, 0.0135), c.get('iris', 'iris'), 'Head', segs=8, rings=4)
            b.box((sx * 0.047, -0.103, 1.678), (0.045, 0.012, 0.011 if not fem else 0.008), 'hair', 'Head', rot=(0, 0, sx * -0.18))
        b.ell((0, -0.117, 1.60), (0.017, 0.02, 0.018), sk, 'Head', segs=8, rings=4)               # nez
        if not c.get('mask'):
            b.box((0, -0.108, 1.563), (0.05, 0.01, 0.007), 'mouth', 'Head')
    for sx in (-1, 1):
        b.ell((sx * 0.109, 0.0, 1.625), (0.018, 0.028, 0.034), sk, 'Head', segs=8, rings=4)   # oreilles
    # bras
    for s, sx in (('L', 1), ('R', -1)):
        x0, x1 = sx * 0.235, sx * 0.245
        b.ell((x0, 0, 1.375), (0.08, 0.08, 0.075), 'sleeve', 'UpperArm.' + s, segs=10, rings=6)    # épaule
        b.tube((x0, 0, 1.37), (x1, 0, 1.11), 0.064, 0.053, 'sleeve', 'UpperArm.' + s, 9)
        elbow_mat = c.get('elbow_mat')
        b.ell((x1, 0, 1.10), (0.058, 0.058, 0.058), elbow_mat or 'forearm', 'LowerArm.' + s, segs=8, rings=5)
        b.tube((x1, 0, 1.10), (x1, 0, 0.88), 0.053, 0.041, 'forearm', 'LowerArm.' + s, 9)
        b.tube((x1, 0, 0.90), (x1, 0, 0.86), 0.042, 0.042, 'cuff', 'LowerArm.' + s, 9)
        b.ell((x1, 0, 0.79), (0.040, 0.05, 0.062), 'glove', 'LowerArm.' + s, segs=8, rings=5)           # main (moufle)
        b.ell((x1 - sx * 0.036, -0.026, 0.82), (0.017, 0.017, 0.034), 'glove', 'LowerArm.' + s, segs=6, rings=4, rot=(0.3, 0, 0))   # pouce

# ------------------------------------------------------------------ coiffures et pièces de tête
def dome(b, mat, cz=1.655, rx=0.121, ry=0.130, rz=0.140, tilt=-0.42, cut=0.45, y=0.008, bone='Head'):
    """Calotte de cheveux ou de casque : ellipsoïde ouvert par le bas (cut : angle polaire max / pi)."""
    prof = []
    n = 8
    for i in range(n + 1):
        t = math.pi * cut * i / n
        prof.append((math.sin(t), math.cos(t)))
    prof = prof[::-1]
    return b.lathe(prof, (0, y, cz), (tilt, 0, 0), (rx, ry, rz), 14, mat, bone, cap0=False, cap1=False)

def hair(b, c):
    st = c.get('hair_style', 'short')
    if st == 'short':
        dome(b, 'hair', cut=0.6)
    elif st == 'buzz':
        dome(b, 'hair', rx=0.114, ry=0.123, rz=0.137, cut=0.5)
    elif st == 'ponytail':
        dome(b, 'hair', cut=0.58)
        b.tube((0, 0.115, 1.69), (0, 0.19, 1.50), 0.04, 0.026, 'hair', 'Head', 8)
        b.ell((0, 0.19, 1.47), (0.03, 0.03, 0.06), 'hair', 'Head', segs=8, rings=5)
        b.torus((0, 0.113, 1.685), 0.035, 0.009, 'accessory', 'Head', rot=(0.9, 0, 0))
    elif st == 'long':
        dome(b, 'hair', cut=0.6)
        b.ell((0, 0.05, 1.52), (0.125, 0.085, 0.17), 'hair', 'Head', segs=12, rings=7)
        for sx in (-1, 1):
            b.tube((sx * 0.1, -0.02, 1.62), (sx * 0.115, 0.0, 1.43), 0.03, 0.026, 'hair', 'Head', 8)
    elif st == 'messy':
        dome(b, 'hair', cut=0.58, rz=0.145)
        for k in range(9):
            a = math.tau * k / 9
            b.ell((math.cos(a) * 0.085, math.sin(a) * 0.09 + 0.0, 1.745 + (k % 3) * 0.008), (0.04, 0.04, 0.035), 'hair', 'Head', segs=6, rings=4)
        b.ell((0.03, -0.1, 1.725), (0.05, 0.02, 0.025), 'hair', 'Head', segs=6, rings=4)
    elif st == 'longtail':
        dome(b, 'hair', rx=0.114, ry=0.126, rz=0.139, cut=0.5, tilt=-0.5)
        b.tube((0, 0.115, 1.69), (0, 0.17, 1.30), 0.048, 0.022, 'hair', 'Head', 8)
        b.ell((0, 0.17, 1.26), (0.03, 0.03, 0.08), 'hair', 'Head', segs=8, rings=5)
        for sx in (-1, 1):
            b.tube((sx * 0.105, 0.035, 1.64), (sx * 0.11, 0.07, 1.50), 0.022, 0.016, 'hair', 'Head', 8)
        b.torus((0, 0.115, 1.67), 0.04, 0.01, 'accessory', 'Head', rot=(1.0, 0, 0))
    if c.get('beard'):
        b.lathe([(0.0, -0.04), (0.092, -0.01), (0.10, 0.035), (0.092, 0.07)], (0, -0.012, 1.545), (0, 0, 0), (1, 1.02, 1), 12, 'hair', 'Head', cap0=False, cap1=False, a0=0, a1=2 * math.pi)
        b.box((0, -0.112, 1.575), (0.07, 0.014, 0.014), 'hair', 'Head')

# ------------------------------------------------------------------ les 8 personnages
def mk_marc(b):
    c = dict(hair_style='short')
    humanoid(b, c)
    # cheveux courts sous le casque : calotte basse
    # casque : coque, couvre-casque, jugulaire, lunettes de vision nocturne relevées
    dome(b, 'helmet', cz=1.665, rx=0.138, ry=0.148, rz=0.150, cut=0.56, y=0.004)
    b.tube((0, 0, 1.665), (0, 0, 1.667), 0.147, 0.147, 'helmet', 'Head', 14)
    b.torus((0, 0.004, 1.652), 0.135, 0.012, 'helmet_d', 'Head', rot=(0, 0, 0), segs=16)
    b.box((0, -0.14, 1.77), (0.05, 0.05, 0.05), 'vest', 'Head')
    for sx in (-1, 1):
        b.tube((sx * 0.02, -0.13, 1.82), (sx * 0.02, -0.18, 1.82), 0.017, 0.017, 'vest', 'Head', 8)
        b.tube((sx * 0.12, -0.02, 1.58), (sx * 0.08, -0.08, 1.5), 0.006, 0.006, 'vest', 'Head', 4)  # jugulaire
    # gilet tactique + poches + radio
    b.rbox((0, -0.015, 1.25), (0.43, 0.27, 0.33), 'vest', 'Torso', r=0.05)
    for x in (-0.12, 0.0, 0.12):
        b.rbox((x, -0.145, 1.17), (0.095, 0.05, 0.11), 'olive', 'Torso', r=0.015)
    b.rbox((-0.11, -0.14, 1.33), (0.10, 0.04, 0.08), 'olive', 'Torso', r=0.012)
    b.rbox((0.13, -0.14, 1.33), (0.05, 0.04, 0.06), 'gold', 'Torso', r=0.01)
    for sx in (-1, 1):
        b.rbox((sx * 0.14, 0, 1.43), (0.13, 0.20, 0.045), 'vest', 'Torso', r=0.02)
    b.tube((0.21, 0.02, 1.36), (0.21, 0.02, 1.47), 0.014, 0.011, 'helmet_d', 'Torso', 6)      # radio d'épaule
    # sac à dos + couchage roulé
    b.rbox((0, 0.19, 1.25), (0.30, 0.17, 0.36), 'olive', 'Torso', r=0.04)
    b.rbox((0, 0.285, 1.18), (0.22, 0.04, 0.16), 'helmet_d', 'Torso', r=0.015)
    b.tube((-0.15, 0.2, 1.48), (0.15, 0.2, 1.48), 0.058, 0.058, 'roll', 'Torso', 10)
    for s in ('L', 'R'):
        sx = 1 if s == 'L' else -1
        b.rbox((sx * 0.095, -0.058, 0.51), (0.12, 0.05, 0.12), 'vest', 'LowerLeg.' + s, r=0.02)  # genouillères
    b.rbox((0, -0.05, 0.98), (0.12, 0.04, 0.10), 'olive', 'Hips', r=0.015)

def mk_lea(b):
    c = dict(fem=True, hair_style='ponytail')
    humanoid(b, c)
    hair(b, c)
    # blouse blanche ouverte sur le haut bleu, brassard rouge sur le bandeau, stéthoscope, sac de soins vert
    b.rbox((0, 0, 1.26), (0.385, 0.255, 0.33), 'coat', 'Torso', r=0.09)
    b.rbox((0, -0.13, 1.25), (0.05, 0.02, 0.3), 'top', 'Torso', r=0.008)                           # ouverture
    b.lathe([(0.17, 0.0), (0.22, -0.2)], (0, 0, 1.06), (0, 0, 0), (1, 0.76, 1), 14, 'coat', 'Hips', cap0=False, cap1=False, smooth=True)   # pans de blouse
    b.torus((0, 0, 1.745), 0.12, 0.016, 'cross', 'Head', rot=(0, 0, 0), segs=16, scale=(0.95, 1.05, 1))   # bandeau rouge
    b.torus((0, -0.02, 1.43), 0.07, 0.011, 'dark', 'Torso', rot=(0.5, 0, 0), segs=14)
    b.ell((0, -0.12, 1.30), (0.024, 0.014, 0.024), 'metal', 'Torso', segs=8, rings=4)
    b.tube((0.0, -0.1, 1.39), (0.0, -0.13, 1.30), 0.006, 0.006, 'dark', 'Torso', 5)
    b.rbox((-0.255, 0, 1.30), (0.075, 0.075, 0.075), 'coat', 'UpperArm.R', r=0.02)
    b.box((-0.255, -0.002, 1.30), (0.083, 0.082, 0.014), 'cross', 'UpperArm.R'); b.box((-0.255, -0.002, 1.30), (0.014, 0.082, 0.083), 'cross', 'UpperArm.R')
    b.rbox((0, 0.185, 1.25), (0.28, 0.15, 0.30), 'bag', 'Torso', r=0.045)
    b.box((0, 0.262, 1.27), (0.10, 0.012, 0.03), 'coat', 'Torso'); b.box((0, 0.262, 1.27), (0.03, 0.012, 0.10), 'cross', 'Torso')
    b.rbox((0, 0.185, 1.43), (0.30, 0.16, 0.06), 'bag_d', 'Torso', r=0.025)
    for sx in (-1, 1):
        b.rbox((sx * 0.09, -0.115, 1.27), (0.035, 0.015, 0.3), 'bag_d', 'Torso', r=0.007)

def mk_karim(b):
    c = dict(hair_style='buzz', beard=True)
    humanoid(b, c)
    hair(b, c)
    # veste de pompier : bandes réfléchissantes, casque jaune à bavolet, bouteilles d'air, hache
    b.rbox((0, 0, 1.25), (0.43, 0.27, 0.33), 'top', 'Torso', r=0.09)
    b.rbox((0, 0, 1.07), (0.34, 0.225, 0.17), 'top', 'Abdomen', r=0.07)
    for z, bone in ((1.19, 'Torso'), (1.075, 'Abdomen')):
        b.tube((0, 0, z - 0.015), (0, 0, z + 0.015), 0.178, 0.178, 'refl', bone, 14, smooth=True, caps=False)
    for sx in (-1, 1):
        b.rbox((sx * 0.07, -0.13, 1.28), (0.045, 0.015, 0.28), 'refl', 'Torso', r=0.006)
    for s, sx in (('L', 1), ('R', -1)):
        b.tube((sx * 0.245, 0, 0.99), (sx * 0.245, 0, 1.0), 0.054, 0.054, 'refl', 'UpperArm.' + s, 9, caps=False)
        b.tube((sx * 0.095, 0, 0.62), (sx * 0.095, 0, 0.66), 0.091, 0.089, 'refl', 'UpperLeg.' + s, 10, caps=False)
    dome(b, 'helmet', cz=1.67, rx=0.138, ry=0.15, rz=0.152, cut=0.57, y=0.004)
    b.rbox((0, 0.0, 1.835), (0.03, 0.27, 0.025), 'helmet', 'Head', r=0.01)                                # crête
    b.rbox((0, -0.15, 1.69), (0.23, 0.09, 0.016), 'helmet', 'Head', r=0.008, rot=(0.12, 0, 0))             # visière
    b.rbox((0, 0.115, 1.60), (0.27, 0.07, 0.09), 'helmet', 'Head', r=0.02, rot=(-0.35, 0, 0))              # bavolet
    b.torus((0, -0.15, 1.725), 0.0, 0.0, 'refl', 'Head') if False else None
    b.tube((-0.075, 0.2, 1.44), (-0.075, 0.2, 1.20), 0.062, 0.062, 'metal', 'Torso', 12)
    b.tube((0.075, 0.2, 1.44), (0.075, 0.2, 1.20), 0.062, 0.062, 'metal', 'Torso', 12)
    b.tube((0, 0.2, 1.46), (0, 0.2, 1.50), 0.02, 0.02, 'dark', 'Torso', 8)
    b.rbox((0, 0.14, 1.32), (0.30, 0.04, 0.05), 'dark', 'Torso', r=0.012)
    b.tube((0.17, 0.25, 1.05), (0.19, 0.25, 1.50), 0.014, 0.014, 'wood', 'Torso', 6)                      # manche de hache
    b.rbox((0.215, 0.25, 1.51), (0.12, 0.025, 0.08), 'axe', 'Torso', r=0.01)

def mk_chloe(b):
    c = dict(fem=True, hair_style='long')
    humanoid(b, c)
    hair(b, c)
    b.rbox((0, 0, 1.26), (0.395, 0.255, 0.32), 'top', 'Torso', r=0.09)
    b.lathe([(0.17, 0.0), (0.2, -0.13)], (0, 0, 1.06), (0, 0, 0), (1, 0.78, 1), 14, 'top', 'Hips', cap0=False, cap1=False)   # bas de parka
    b.rbox((0, -0.125, 1.25), (0.035, 0.02, 0.30), 'dark', 'Torso', r=0.007)
    b.ell((0, 0.115, 1.43), (0.12, 0.07, 0.07), 'top', 'Torso', segs=10, rings=6, rot=(0.4, 0, 0))        # capuche rabattue
    b.torus((0, -0.005, 1.46), 0.085, 0.036, 'cream', 'Neck', rot=(0.15, 0, 0), segs=14)                    # écharpe
    b.rbox((0.05, -0.1, 1.33), (0.075, 0.03, 0.2), 'cream', 'Torso', r=0.012, rot=(0.0, 0, 0.08))
    b.torus((0, 0.01, 1.43), 0.098, 0.014, 'dark', 'Neck', rot=(0.2, 0, 0), segs=14)                         # casque audio
    for sx in (-1, 1):
        b.ell((sx * 0.1, -0.04, 1.40), (0.025, 0.04, 0.04), 'dark', 'Neck', segs=8, rings=4)
    b.rbox((0, 0.185, 1.27), (0.27, 0.15, 0.31), 'bag', 'Torso', r=0.05)
    b.rbox((0, 0.265, 1.2), (0.20, 0.03, 0.12), 'bag_d', 'Torso', r=0.012)
    for sx in (-1, 1):
        b.rbox((sx * 0.09, -0.115, 1.28), (0.035, 0.015, 0.3), 'bag', 'Torso', r=0.007)
    b.ell((0.12, 0.27, 1.17), (0.02, 0.02, 0.02), 'gold', 'Torso', segs=6, rings=4)

def mk_lucian(b):
    c = dict(hair_style='buzz', mask=True, no_face=True)
    humanoid(b, c)
    hair(b, c)
    # long manteau noir (pondéré sur les cuisses), liserés blancs, col montant, épaulettes dorées, relique lumineuse
    b.rbox((0, 0, 1.26), (0.43, 0.275, 0.33), 'coat', 'Torso', r=0.09)
    b.lathe([(0.18, 0.0), (0.205, -0.25), (0.255, -0.58)], (0, 0, 1.06), (0, 0, 0), (1, 0.82, 1), 16, 'coat', skirt_w, cap0=False, cap1=False)
    b.rbox((0, -0.14, 0.78), (0.24, 0.02, 0.62), 'trim', skirt_w, r=0.005)      # revers
    for sx in (-1, 1):
        b.rbox((sx * 0.075, -0.137, 1.22), (0.03, 0.02, 0.4), 'trim', 'Torso', r=0.005)
        b.rbox((sx * 0.235, 0, 1.43), (0.14, 0.17, 0.035), 'gold', 'UpperArm.' + ('L' if sx > 0 else 'R'), r=0.012)
    b.tube((0, 0, 1.40), (0, 0, 1.52), 0.098, 0.088, 'coat', 'Neck', 12, caps=False)                    # col montant
    b.ell((0, -0.13, 1.28), (0.026, 0.02, 0.026), 'glow', 'Torso', segs=8, rings=4)                       # relique
    b.tube((0, 0, 1.03), (0, 0, 1.08), 0.205, 0.205, 'gold', 'Abdomen', 16, smooth=True, caps=False)      # ceinture dorée
    # masque du Purificateur : coque blanche couvrant tout le visage, deux fentes noires, filtre lumineux au menton
    prof = [(math.sin(math.pi * k / 10), -math.cos(math.pi * k / 10)) for k in range(11)]
    b.lathe(prof, (0, -0.035, 1.625), (0, 0, 0), (0.118, 0.105, 0.14), 14, 'mask', 'Head', cap0=False, cap1=False, a0=math.pi * 1.2, a1=math.pi * 1.8)
    for sx in (-1, 1):
        b.rbox((sx * 0.047, -0.133, 1.645), (0.05, 0.02, 0.014), 'dark', 'Head', r=0.005, rot=(0, 0, sx * -0.2))
    b.rbox((0, -0.145, 1.60), (0.012, 0.02, 0.06), 'trim', 'Head', r=0.004)
    b.ell((0, -0.14, 1.552), (0.03, 0.02, 0.026), 'glow', 'Head', segs=8, rings=4)

def mk_picsou(b):
    c = dict(hair_style='none', belly=0.1, no_belt=True)
    humanoid(b, c)
    # cheveux blancs sur les côtés, grosses moustaches, sourcils blancs, monocle ; redingote rouge, haut-de-forme, guêtres blanches, canne dorée
    for sx in (-1, 1):
        b.ell((sx * 0.1, 0.02, 1.63), (0.03, 0.06, 0.06), 'hair', 'Head', segs=8, rings=5)
        b.ell((sx * 0.035, -0.11, 1.575), (0.045, 0.02, 0.022), 'hair', 'Head', segs=8, rings=4, rot=(0, 0, sx * -0.35))
    b.ell((0, 0.04, 1.69), (0.108, 0.1, 0.07), 'hair', 'Head', segs=10, rings=5)
    b.torus((-0.046, -0.12, 1.64), 0.026, 0.004, 'gold', 'Head', rot=(math.pi / 2, 0, 0), segs=12)          # monocle
    b.tube((-0.07, -0.118, 1.625), (-0.09, -0.08, 1.44), 0.002, 0.002, 'gold', 'Head', 3)
    # redingote : buste, basques longues (pondérées sur les cuisses), revers sombres, col
    b.rbox((0, 0, 1.27), (0.43, 0.29, 0.34), 'coat', 'Torso', r=0.1)
    b.ell((0, -0.04, 1.08), (0.23, 0.17, 0.14), 'coat', 'Abdomen', segs=12, rings=6)                       # bedaine
    b.lathe([(0.19, 0.0), (0.24, -0.22), (0.27, -0.42)], (0, 0, 1.04), (0, 0, 0), (1, 0.85, 1), 16, 'coat', skirt_w, cap0=False, cap1=False)
    b.rbox((0, -0.135, 1.285), (0.09, 0.016, 0.24), 'shirt', 'Torso', r=0.006)
    for sx in (-1, 1):
        b.rbox((sx * 0.095, -0.145, 1.28), (0.075, 0.025, 0.26), 'dark', 'Torso', r=0.01, rot=(0, 0, sx * 0.14))
    b.rbox((0, 0, 1.455), (0.17, 0.15, 0.04), 'dark', 'Neck', r=0.015)
    b.tube((0, -0.2, 1.3), (0.0, -0.205, 1.12), 0.01, 0.01, 'gold', 'Torso', 4)                              # chaîne de montre
    for s, sx in (('L', 1), ('R', -1)):
        b.tube((sx * 0.095, 0, 0.17), (sx * 0.095, 0, 0.10), 0.07, 0.07, 'shirt', 'LowerLeg.' + s, 10)       # guêtres
    # haut-de-forme
    b.tube((0, 0.0, 1.745), (0, 0, 1.775), 0.19, 0.19, 'hat', 'Head', 16)
    b.lathe([(0.118, 0.0), (0.112, 0.2)], (0, 0, 1.77), (0, 0, 0), (1, 1.05, 1), 16, 'hat', 'Head', cap0=False, cap1=True)
    b.tube((0, 0, 1.775), (0, 0, 1.815), 0.12, 0.12, 'cross', 'Head', 16, caps=False)
    # canne
    b.tube((-0.256, -0.02, 0.84), (-0.256, -0.02, -0.0), 0.012, 0.012, 'gold', 'LowerArm.R', 6, obj='Prop_Cane')
    b.ell((-0.256, -0.02, 0.86), (0.03, 0.03, 0.03), 'gold', 'LowerArm.R', segs=8, rings=5, obj='Prop_Cane')

def mk_klukai(b):
    c = dict(fem=True, hair_style='longtail', iris='iris_g', knee_mat='skin', elbow_mat='skin')
    humanoid(b, c)
    hair(b, c)
    # casquette noire, masque autour du cou, veste violette courte, sangles cyan, sac tactique, genoux articulés de poupée
    dome(b, 'dark', cz=1.675, rx=0.125, ry=0.135, rz=0.14, cut=0.52)
    b.rbox((0, -0.13, 1.715), (0.2, 0.13, 0.014), 'dark', 'Head', r=0.006, rot=(0.1, 0, 0))
    b.box((0, -0.009, 1.735), (0.04, 0.2, 0.02), 'accessory', 'Head') if False else None
    b.torus((0, 0, 1.455), 0.07, 0.026, 'dark', 'Neck', rot=(0.1, 0, 0), segs=14)
    b.rbox((0, 0, 1.275), (0.40, 0.255, 0.27), 'jacket', 'Torso', r=0.09)
    b.rbox((0, 0, 1.08), (0.30, 0.205, 0.10), 'dark', 'Abdomen', r=0.05)
    for sx in (-1, 1):
        b.rbox((sx * 0.07, -0.13, 1.28), (0.02, 0.014, 0.24), 'accessory', 'Torso', r=0.005)
    b.rbox((0, 0.175, 1.26), (0.24, 0.13, 0.27), 'dark', 'Torso', r=0.04)
    b.rbox((0, 0.245, 1.22), (0.16, 0.025, 0.04), 'accessory', 'Torso', r=0.008)
    for s, sx in (('L', 1), ('R', -1)):
        b.rbox((sx * 0.095, 0, 0.74), (0.19, 0.17, 0.045), 'accessory', 'UpperLeg.' + s, r=0.01)
        b.ell((sx * 0.245, 0, 1.31), (0.06, 0.06, 0.05), 'jacket', 'UpperArm.' + s, segs=8, rings=5)

def mk_harry(b):
    c = dict(hair_style='messy', iris='iris_g')
    humanoid(b, c)
    hair(b, c)
    # robe sombre (pondérée sur les cuisses), écharpe et ceinture dorées, chapeau pointu mou, lunettes rondes, baguette
    b.rbox((0, 0, 1.26), (0.42, 0.27, 0.34), 'robe', 'Torso', r=0.09)
    b.lathe([(0.17, 0.0), (0.21, -0.2), (0.28, -0.52)], (0, 0, 1.05), (0, 0, 0), (1, 0.86, 1), 16, 'robe', skirt_w, cap0=False, cap1=False)
    b.rbox((0, -0.145, 0.8), (0.07, 0.01, 0.5), 'gold', skirt_w, r=0.004)
    b.tube((0, 0, 1.025), (0, 0, 1.085), 0.19, 0.19, 'gold', 'Abdomen', 16, caps=False)
    b.torus((0, 0, 1.455), 0.083, 0.032, 'scarf', 'Neck', rot=(0.1, 0, 0), segs=14)
    b.rbox((0.06, -0.1, 1.33), (0.07, 0.03, 0.2), 'scarf', 'Torso', r=0.01)
    b.ell((0, 0.12, 1.34), (0.17, 0.08, 0.14), 'robe', 'Torso', segs=10, rings=5)                             # capuchon sur le dos
    for s, sx in (('L', 1), ('R', -1)):
        b.lathe([(0.052, 0.0), (0.075, -0.2)], (sx * 0.245, 0, 1.06), (0, 0, 0), (1, 1, 1), 10, 'robe', 'LowerArm.' + s, cap0=False, cap1=False)   # manche évasée
    for sx in (-1, 1):
        b.torus((sx * 0.045, -0.112, 1.64), 0.026, 0.0035, 'frame', 'Head', rot=(math.pi / 2, 0, 0), segs=12)
    b.box((0, -0.112, 1.645), (0.02, 0.006, 0.005), 'frame', 'Head')
    # chapeau : large bord, cône mou plié
    b.tube((0, 0.0, 1.725), (0, 0, 1.738), 0.20, 0.2, 'hat', 'Head', 16)
    b.lathe([(0.125, 0.0), (0.095, 0.1), (0.06, 0.2), (0.03, 0.29), (0.0, 0.34)], (0, 0.005, 1.735), (-0.22, 0, 0), (1, 1, 1), 14, 'hat', 'Head')
    b.tube((0, 0.0, 1.745), (0, 0, 1.775), 0.126, 0.122, 'gold', 'Head', 14, caps=False)
    b.tube((-0.256, -0.07, 0.8), (-0.256, -0.2, 0.9), 0.009, 0.006, 'wood', 'LowerArm.R', 5, obj='Prop_Wand')
    b.ell((-0.256, -0.2, 0.9), (0.008, 0.008, 0.008), 'glow', 'LowerArm.R', segs=6, rings=4, obj='Prop_Wand')

# nom -> (constructeur, matériaux, échelle (largeur, hauteur))
def M(*a): return a
CHARS = {
 'marc': (mk_marc, dict(skin=(0xe0b48f, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x4a6a80, .4, 0), mouth=(0x7a3b2e, .6, 0), hair=(0x2b1d12, .9, 0),
    top=(0x4a5530, .9, 0), sleeve=(0x4a5530, .9, 0), forearm=(0x4a5530, .9, 0), cuff=(0x3a4228, .9, 0), pants=(0x424b2b, .9, 0), pants_low=(0x424b2b, .9, 0),
    boots=(0x1b1710, .85, 0), sole=(0x0c0c0c, .9, 0), belt=(0x2a2418, .6, 0), glove=(0x1c1c1e, .7, 0), helmet=(0x56603f, .6, .15), helmet_d=(0x2f3524, .7, .1),
    vest=(0x1d1f1c, .75, 0), olive=(0x3a4228, .85, 0), gold=(0xb89a30, .5, .6), roll=(0x5a5a46, .9, 0)), (1.04, 1.02)),
 'lea': (mk_lea, dict(skin=(0xf1d0b0, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x3a7a98, .4, 0), mouth=(0xb0505a, .6, 0), hair=(0x8a3a18, .9, 0), accessory=(0xc22a3a, .6, 0),
    top=(0x3a8ab8, .8, 0), coat=(0xf0f3f6, .7, 0), sleeve=(0xdfe6ee, .8, 0), forearm=(0x3a8ab8, .8, 0), cuff=(0x2c6a90, .8, 0), pants=(0x3a8ab8, .8, 0), pants_low=(0x3a8ab8, .8, 0),
    boots=(0xf0f0f0, .6, 0), sole=(0x9a9aa4, .7, 0), belt=(0x1c3a52, .7, 0), glove=(0x4aa8e0, .6, 0), cross=(0xc8202c, .5, 0), dark=(0x222226, .5, .6), metal=(0xc0c0c8, .3, .9),
    bag=(0x3a7a52, .8, 0), bag_d=(0x2d6042, .8, 0)), (0.94, 0.97)),
 'karim': (mk_karim, dict(skin=(0x8d5a3b, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x3a2a1c, .4, 0), mouth=(0x5a2a22, .6, 0), hair=(0x111111, .9, 0),
    top=(0xd8541a, .75, 0), sleeve=(0xd8541a, .75, 0), forearm=(0xd8541a, .75, 0), cuff=(0x2a2a2e, .7, 0), pants=(0x1d2536, .85, 0), pants_low=(0x1d2536, .85, 0),
    boots=(0x141414, .7, 0), sole=(0x0a0a0a, .9, 0), belt=(0x111111, .6, 0), glove=(0x2a2a2e, .7, 0), refl=(0xdfe600, .4, .2), helmet=(0xe8c020, .5, .1),
    metal=(0x9a9aa2, .4, .8), dark=(0x141414, .7, 0), wood=(0x6a4a2a, .8, 0), axe=(0xa02020, .5, .6)), (1.10, 1.04)),
 'chloe': (mk_chloe, dict(skin=(0xc9a07a, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x3a2a1c, .4, 0), mouth=(0xa0505a, .6, 0), hair=(0x1c1a24, .9, 0),
    top=(0xb8283c, .85, 0), sleeve=(0xb8283c, .85, 0), forearm=(0xb8283c, .85, 0), cuff=(0x8a1c2c, .85, 0), pants=(0x3f5f9a, .9, 0), pants_low=(0x3f5f9a, .9, 0),
    boots=(0xf2f2f2, .65, 0), sole=(0xc8c8d0, .8, 0), belt=(0x3a2a22, .7, 0), glove=(0xe0d0b8, .9, 0), cream=(0xece0c8, .95, 0), dark=(0x1a1a1e, .7, 0),
    bag=(0x7ab8d8, .8, 0), bag_d=(0x5a98b8, .8, 0), gold=(0xffd24a, .5, 0), patch=(0x2f4a7a, .9, 0)), (0.96, 0.99)),
 'lucian': (mk_lucian, dict(skin=(0x6b4630, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x2a1a10, .4, 0), mouth=(0x3a1a14, .6, 0), hair=(0x15110e, .9, 0),
    top=(0x16161c, .65, 0), coat=(0x16161c, .65, 0), sleeve=(0x16161c, .65, 0), forearm=(0x16161c, .65, 0), cuff=(0xe8e8ee, .5, 0), pants=(0x1e1e24, .8, 0), pants_low=(0x1e1e24, .8, 0),
    boots=(0x0e0e10, .6, 0), sole=(0x060606, .9, 0), belt=(0xc8a040, .35, .8), glove=(0x24242a, .6, 0), trim=(0xe8e8ee, .5, 0), gold=(0xc8a040, .35, .8),
    mask=(0xe6e6ec, .35, .05), dark=(0x101014, .6, 0), glow=(0xdfe8ff, .3, 0, 0x8fa8ff)), (1.03, 1.05)),
 'picsou': (mk_picsou, dict(skin=(0xecc9a8, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x2a4a6a, .4, 0), mouth=(0x8a4a3a, .6, 0), hair=(0xf2f0ea, .9, 0),
    top=(0xf2f0ea, .8, 0), coat=(0xb02020, .75, 0), sleeve=(0xb02020, .75, 0), forearm=(0xb02020, .75, 0), cuff=(0xf6f4ee, .9, 0), pants=(0x3a3a44, .8, 0), pants_low=(0x3a3a44, .8, 0),
    boots=(0x15151a, .5, .1), sole=(0x15151a, .8, 0), belt=(0x2a1a14, .6, 0), glove=(0xf6f4ee, .9, 0), shirt=(0xf6f4ee, .85, 0), dark=(0x2a0e0e, .7, 0),
    gold=(0xd4a640, .3, .8), hat=(0x15151a, .55, .05), cross=(0xb02020, .6, 0)), (1.14, 0.86)),
 'klukai': (mk_klukai, dict(skin=(0xf3dccb, .55, 0), eye=(0xf2efe8, .4, 0), iris=(0x2a2a30, .4, 0), iris_g=(0x3aa060, .35, 0), mouth=(0xb0606a, .6, 0), hair=(0x9fd0ee, .8, 0), accessory=(0x3ac8ff, .3, .3, 0x1a6a90),
    top=(0x141418, .6, 0), jacket=(0x6a3a9a, .7, 0), sleeve=(0x6a3a9a, .7, 0), forearm=(0x141418, .6, 0), cuff=(0x3ac8ff, .3, .3), pants=(0x22222a, .7, 0), pants_low=(0x0c0c10, .5, 0),
    boots=(0x101014, .5, 0), sole=(0x050505, .9, 0), belt=(0x3ac8ff, .3, .3), glove=(0x141418, .6, 0), dark=(0x141418, .6, 0)), (0.93, 0.98)),
 'harry': (mk_harry, dict(skin=(0xf0cfb4, .75, 0), eye=(0xf2efe8, .4, 0), iris=(0x2f8a3a, .4, 0), iris_g=(0x2f8a3a, .4, 0), mouth=(0xb0605a, .6, 0), hair=(0x16110d, .9, 0),
    top=(0x1b1f33, .85, 0), robe=(0x1b1f33, .85, 0), sleeve=(0x1b1f33, .85, 0), forearm=(0x1b1f33, .85, 0), cuff=(0xe0b040, .5, .3), pants=(0x4a4a50, .85, 0), pants_low=(0x4a4a50, .85, 0),
    boots=(0x3a2414, .6, 0), sole=(0x0a0a0a, .9, 0), belt=(0xe0b040, .5, .3), glove=(0xf0cfb4, .75, 0), gold=(0xe0b040, .5, .3), scarf=(0x2a6a6a, .85, 0),
    hat=(0x1b1f33, .85, 0), frame=(0x2a2a30, .3, .7), wood=(0x5a3a1e, .8, 0), glow=(0xfff0b0, .3, 0, 0xffd060)), (0.95, 0.97)),
}
# reste de la table de matériaux communs
for _, (_, mats, _) in CHARS.items():
    mats.setdefault('eye', (0xf2efe8, .4, 0)); mats.setdefault('iris', (0x3a2a1c, .4, 0)); mats.setdefault('mouth', (0x7a3b2e, .6, 0))

# ------------------------------------------------------------------ animations
def R(axis, deg):
    return Matrix.Rotation(math.radians(deg), 3, axis)

def pose_set(arm, name, rotx=0.0, roty=0.0, rotz=0.0, loc=None):
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    D = R('Z', rotz) @ R('Y', roty) @ R('X', rotx)
    basis = rest.inverted() @ D @ rest
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = basis.to_quaternion()
    pb.location = (rest.inverted() @ Vector(loc)) if loc else (0, 0, 0)

def A(n, fwd=True):
    return n

def walk_pose(ph, A_, K, Bsw, elbow, lean, twist):
    s = math.sin(ph); c = math.cos(ph)
    P = {}
    for side, sg in (('L', 1), ('R', -1)):
        sp = math.sin(ph + (0 if sg == 1 else math.pi)); cp = math.cos(ph + (0 if sg == 1 else math.pi))
        P['UpperLeg.' + side] = dict(rotx=-A_ * sp)
        P['LowerLeg.' + side] = dict(rotx=K * max(0.0, cp) + 4)
        P['Foot.' + side] = dict(rotx=A_ * sp * 0.5 - K * max(0.0, cp) * 0.3)
        P['UpperArm.' + side] = dict(rotx=Bsw * sp, roty=(-4 if sg == 1 else 4))
        P['LowerArm.' + side] = dict(rotx=-elbow - 8 * max(0.0, -sp))
    P['Abdomen'] = dict(rotx=lean * 0.5, rotz=twist * s)
    P['Torso'] = dict(rotx=lean * 0.5, rotz=twist * s * 0.6)
    P['Head'] = dict(rotx=-lean * 0.7, rotz=-twist * s * 0.6)
    P['Hips'] = dict(rotz=-twist * s * 0.6)
    return P

def anim_pose(name, t):
    ph = math.tau * t
    s = math.sin(ph)
    if name == 'Idle':
        return {'Torso': dict(rotx=1.4 * s), 'Abdomen': dict(rotx=0.6 * s), 'Head': dict(rotx=-1.2 * s, rotz=1.5 * math.sin(ph * 0.5)),
                'UpperArm.L': dict(rotx=2 * s, roty=-5), 'UpperArm.R': dict(rotx=2 * s, roty=5),
                'LowerArm.L': dict(rotx=-10 - 2 * s), 'LowerArm.R': dict(rotx=-10 - 2 * s),
                'UpperLeg.L': dict(roty=-1.5), 'UpperLeg.R': dict(roty=1.5), 'Hips': dict(rotz=1.0 * math.sin(ph * 0.5))}
    if name == 'Walk':
        return walk_pose(ph, 28, 44, 24, 18, 4, 5)
    if name == 'Run':
        return walk_pose(ph, 52, 88, 48, 82, 14, 8)
    if name in ('Sit_Moto', 'Sit_Bike'):
        moto = name == 'Sit_Moto'
        th = -62 if moto else -52
        kn = 78 if moto else 70
        return {'Abdomen': dict(rotx=11 + 0.5 * s), 'Torso': dict(rotx=(20 if moto else 24) + 0.5 * s), 'Head': dict(rotx=-26 - 0.4 * s),
                'UpperLeg.L': dict(rotx=th, roty=-6), 'UpperLeg.R': dict(rotx=th, roty=6),
                'LowerLeg.L': dict(rotx=kn), 'LowerLeg.R': dict(rotx=kn),
                'Foot.L': dict(rotx=-(th + kn) * 0.8), 'Foot.R': dict(rotx=-(th + kn) * 0.8),
                'UpperArm.L': dict(rotx=-70 if moto else -66, roty=-14), 'UpperArm.R': dict(rotx=-70 if moto else -66, roty=14),
                'LowerArm.L': dict(rotx=-22), 'LowerArm.R': dict(rotx=-22)}
    if name in ('Sit_Tram', 'Sit_Tram_Drive'):
        drive = name == 'Sit_Tram_Drive'
        return {'Abdomen': dict(rotx=2 + 0.4 * s), 'Torso': dict(rotx=3 + 0.4 * s), 'Head': dict(rotx=-3 - 0.3 * s),
                'UpperLeg.L': dict(rotx=-90, roty=-5), 'UpperLeg.R': dict(rotx=-90, roty=5),
                'LowerLeg.L': dict(rotx=88), 'LowerLeg.R': dict(rotx=88),
                'Foot.L': dict(rotx=-2), 'Foot.R': dict(rotx=-2),
                'UpperArm.L': dict(rotx=-48 if drive else -28, roty=-8), 'UpperArm.R': dict(rotx=-48 if drive else -28, roty=8),
                'LowerArm.L': dict(rotx=-58 if drive else -68), 'LowerArm.R': dict(rotx=-58 if drive else -68)}
    if name == 'Death':
        u = min(1.0, t / 0.8)
        e = u * u * (3 - 2 * u)
        P = {'Root': dict(rotx=-92 * e, loc=(0, 0, 0.12 * e)),
             'Head': dict(rotx=-8 * e), 'UpperArm.L': dict(roty=-52 * e, rotx=-10 * e), 'UpperArm.R': dict(roty=52 * e, rotx=-10 * e),
             'LowerArm.L': dict(rotx=-12 * e), 'LowerArm.R': dict(rotx=-12 * e),
             'UpperLeg.L': dict(roty=-9 * e), 'UpperLeg.R': dict(roty=9 * e)}
        return P
    return {}

ANIMS = {  # nom -> (images, fps, bouclée)
    'Idle': (48, 24), 'Walk': (28, 24), 'Run': (18, 24), 'Sit_Moto': (48, 24), 'Sit_Bike': (48, 24), 'Sit_Tram': (48, 24), 'Sit_Tram_Drive': (48, 24), 'Death': (24, 24),
}

def make_actions(arm):
    arm.animation_data_create()
    for name, (n, fps) in ANIMS.items():
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        loop = name != 'Death'
        step = 2
        frames = list(range(0, n + 1, step)) if loop else [0, 4, 8, 12, 16, 20, 23]
        for f in frames:
            t = (f % n) / n if loop else f / (n - 1)
            P = anim_pose(name, t)
            for pb in arm.pose.bones:
                kw = P.get(pb.name, {})
                pose_set(arm, pb.name, kw.get('rotx', 0.0), kw.get('roty', 0.0), kw.get('rotz', 0.0), kw.get('loc'))
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
                if 'loc' in kw or pb.name == 'Root':
                    pb.keyframe_insert('location', frame=f + 1)
        act.use_frame_range = True
        act.frame_start = 1
        act.frame_end = n + 1 if loop else 24
        act.use_cyclic = loop
    # on laisse une pose neutre
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    arm.animation_data.action = None

# ------------------------------------------------------------------ assemblage d'un personnage
def build(cid):
    fn, mats, (sw, sh) = CHARS[cid]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    b = Builder(mats)
    fn(b)
    # matériaux Blender
    # matériaux Blender : ceux de même valeur sont fusionnés (moins de surfaces, donc moins d'appels de dessin dans Godot)
    bmats, remap, seen = [], {}, {}
    for i, (nm, spec) in enumerate(mats.items()):
        key = tuple(spec) if len(spec) > 3 else tuple(spec) + (None,)
        if key in seen:
            remap[i] = seen[key]
            continue
        col, rough, metal = spec[0], spec[1], spec[2]
        m = bpy.data.materials.new(f'{cid}_{nm}')
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = hexc(col)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if len(spec) > 3 and spec[3] is not None:
            bsdf.inputs['Emission Color'].default_value = hexc(spec[3])
            bsdf.inputs['Emission Strength'].default_value = 1.2
        seen[key] = len(bmats)
        remap[i] = len(bmats)
        bmats.append(m)
    # armature (mise à l'échelle de référence -> taille du personnage)
    S = Vector((sw, sw, sh))
    sc = lambda v: Vector((v.x * S.x, v.y * S.y, v.z * S.z))
    adata = bpy.data.armatures.new('CharacterArmature')
    arm = bpy.data.objects.new('CharacterArmature', adata)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, parent, head, tail in bones_def():
        e = adata.edit_bones.new(name)
        e.head, e.tail = sc(head), sc(tail)
        if parent: e.parent = eb[parent]
        eb[name] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    # objets maillage
    tri = 0
    for oname, bm in b.objs.items():
        layer = bm.faces.layers.int['part']
        dl = bm.verts.layers.deform.verify()
        names = [x.name for x in bpy.data.armatures['CharacterArmature'].bones]
        mesh = bpy.data.meshes.new(cid + '_' + oname)
        obj = bpy.data.objects.new(oname, mesh)
        bpy.context.scene.collection.objects.link(obj)
        for v in bm.verts:
            part = v.link_faces[0][layer] if v.link_faces else 0
            spec = b.parts[part]
            w = spec(v.co) if callable(spec) else {spec: 1.0}
            for bone, wt in w.items():
                if wt > 1e-4:
                    vg = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                    v[dl][vg.index] = wt
        for v in bm.verts:
            part = v.link_faces[0][layer] if v.link_faces else 0
            if b.parts[part] == 'Head':
                v.co = Vector((0, 0, 1.50)) + (v.co - Vector((0, 0, 1.50))) * HEAD_K
            v.co = sc(v.co)
        for f in bm.faces:
            f.material_index = remap[f.material_index]
        bm.normal_update()
        bm.to_mesh(mesh)
        for m in bmats: mesh.materials.append(m)
        bm.free()
        mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
        obj.parent = arm
        tri += sum(len(p.vertices) - 2 for p in mesh.polygons)
        # normales : lissage par face déjà posé ; recalcule les normales extérieures
    make_actions(arm)
    path = os.path.join(OUT, cid + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=False, export_animations=True, export_animation_mode='ACTIONS',
        export_skins=True, export_def_bones=False, export_yup=True, export_materials='EXPORT', export_image_format='NONE',
        export_cameras=False, export_lights=False, export_extras=False, export_force_sampling=True, export_optimize_animation_size=False)
    print('BUILT', cid, 'tris', tri, 'size', os.path.getsize(path))

for cid in CHARS:
    if not ONLY or cid in ONLY:
        build(cid)
