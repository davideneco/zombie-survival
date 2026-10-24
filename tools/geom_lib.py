"""Chargement des données cuites du monde Godot (godot/data/world) pour les outils de diagnostic de géométrie (v0.23.0).
Triangles des tuiles, portes et instances (monde, sens trigonométrique de Three.js), matériaux, collision, quartiers."""
import gzip, json, os, struct
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
W = os.environ.get('ZS_WORLD_DIR') or os.path.join(ROOT, 'godot', 'data', 'world')   # v0.34.0 : ZS_WORLD_DIR : export de la station alpine (--export-geom)


def jload(name):
    with open(os.path.join(W, name)) as f:
        return json.load(f)


def open_pack(path, magic):
    b = open(path, 'rb').read()
    assert b[:4] == magic, path
    n = struct.unpack('<I', b[4:8])[0]
    return json.loads(b[8:8 + n]), b, 8 + n


def surf_arrays(s, b, base):
    nv, ni = s['nv'], s['ni']
    pos = np.frombuffer(b, '<f4', nv * 3, base + s['pos']).reshape(nv, 3).astype(np.float64)
    idx = np.frombuffer(b, '<i4', ni, base + s['idx']).reshape(-1, 3)
    return pos, idx


def load_pack_tris(path, tag):
    """Renvoie (A, B, C, mat, tag) : sommets des triangles (N,3) et indice de matériau (N)."""
    head, b, base = open_pack(path, b'ZMP1')
    As, Bs, Cs, Ms = [], [], [], []
    for s in head['surfaces']:
        pos, idx = surf_arrays(s, b, base)
        As.append(pos[idx[:, 0]]); Bs.append(pos[idx[:, 1]]); Cs.append(pos[idx[:, 2]])
        Ms.append(np.full(len(idx), s['mat'], np.int32))
    return [np.concatenate(x) for x in (As, Bs, Cs, Ms)]


def load_world_tris(with_instances=True, with_doors=True):
    """Toutes les surfaces visibles. Renvoie dict A,B,C (N,3), mat (N), src (N) : 0 tuile, 1 porte, 2 instance (avec 'src_id')."""
    tiles = jload('tiles.json')
    parts = []
    for t in tiles['tiles']:
        A, B, C, M = load_pack_tris(os.path.join(W, 'tiles', 't%s.bin' % t['key']), t['key'])
        parts.append((A, B, C, M, np.zeros(len(M), np.int32), np.full(len(M), -1, np.int32)))
    if with_doors:
        for d in jload('objects.json')['doors']:
            p = os.path.join(W, 'doors', 'd%d.bin' % d['id'])
            if os.path.exists(p):
                A, B, C, M = load_pack_tris(p, 'door')
                parts.append((A, B, C, M, np.ones(len(M), np.int32), np.full(len(M), d['id'], np.int32)))
    if with_instances and os.path.exists(os.path.join(W, 'instances.bin')):
        head, b, base = open_pack(os.path.join(W, 'instances.bin'), b'ZMI1')
        for mi, m in enumerate(head['meshes']):
            n = m['count']
            if n <= 0:
                continue
            xf = np.frombuffer(b, '<f4', n * 12, base + m['xf']).reshape(n, 3, 4).astype(np.float64)
            for s in m['surfaces']:
                pos, idx = surf_arrays(s, b, base)
                P = np.einsum('nij,vj->nvi', xf[:, :, :3], pos) + xf[:, None, :, 3]   # (n, nv, 3)
                for k in range(3):
                    pass
                A = P[:, idx[:, 0], :].reshape(-1, 3); B = P[:, idx[:, 1], :].reshape(-1, 3); C = P[:, idx[:, 2], :].reshape(-1, 3)
                M = np.full(len(A), s['mat'], np.int32)
                parts.append((A, B, C, M, np.full(len(M), 2, np.int32), np.full(len(M), mi, np.int32)))
    out = {k: np.concatenate([p[i] for p in parts]) for i, k in enumerate(('A', 'B', 'C', 'mat', 'src', 'src_id'))}
    return out


def load_collision():
    s = np.fromfile(os.path.join(W, 'collision', 'segs.f64'), '<f8').reshape(-1, 10)
    c = np.fromfile(os.path.join(W, 'collision', 'circles.f64'), '<f8').reshape(-1, 8)
    return s, c   # segs: ax az bx bz h y0 prop vid door off ; circles: x z r h y0 prop vid off


class Zones:
    def __init__(self):
        meta = jload('nav/meta.json')
        z = np.frombuffer(gzip.open(os.path.join(W, 'nav', 'zone.i8.gz')).read(), np.int8).reshape(meta['nz'], meta['nx'])
        self.z, self.m = z, meta
        self.names = {zz['i']: zz['name'] for zz in jload('objects.json')['zones']}

    def name(self, x, zz):
        m = self.m
        ix = int((x - m['ox']) / m['cell']); iz = int((zz - m['oz']) / m['cell'])
        if 0 <= ix < m['nx'] and 0 <= iz < m['nz']:
            return self.names.get(int(self.z[iz, ix]), '?')
        return '?'


def point_tri_dist(P, A, B, C):
    """Distance de P (m,3) à des triangles (m,3) un à un (Ericson, Real-Time Collision Detection 5.1.5), vectorisé."""
    ab = B - A; ac = C - A; ap = P - A
    d1 = (ab * ap).sum(-1); d2 = (ac * ap).sum(-1)
    bp = P - B; d3 = (ab * bp).sum(-1); d4 = (ac * bp).sum(-1)
    cp = P - C; d5 = (ab * cp).sum(-1); d6 = (ac * cp).sum(-1)
    vc = d1 * d4 - d3 * d2; vb = d5 * d2 - d1 * d6; va = d3 * d6 - d5 * d4
    with np.errstate(all='ignore'):
        den = va + vb + vc
        v = np.where(den != 0, vb / den, 0.0); w = np.where(den != 0, vc / den, 0.0)
        Q = A + ab * v[:, None] + ac * w[:, None]
        # régions de sommets / arêtes
        def seg(P0, P1, Pp):
            d = P1 - P0; t = np.clip(((Pp - P0) * d).sum(-1) / np.maximum((d * d).sum(-1), 1e-18), 0, 1)
            return P0 + d * t[:, None]
        inside = (va >= 0) & (vb >= 0) & (vc >= 0)
        Qe = seg(A, B, P); Qf = seg(B, C, P); Qg = seg(C, A, P)
    best = np.where(inside[:, None], Q, Qe)
    dd = ((P - best) ** 2).sum(-1)
    for q in (Qf, Qg):
        d2_ = ((P - q) ** 2).sum(-1)
        m = d2_ < dd
        best = np.where(m[:, None], q, best); dd = np.where(m, d2_, dd)
    return np.sqrt(dd)


def surfaces_of(head):
    """Surfaces d'un en-tête de paquet (tuile / porte : head['surfaces'] ; instances : head['meshes'][*]['surfaces'])."""
    if 'surfaces' in head:
        return head['surfaces']
    return [s for m in head['meshes'] if m['count'] > 0 for s in m['surfaces']]


class Nav:
    """Grille de navigation cuite (cases de 0,75 m) : free(x, z) -> bool (hors carte : faux)."""
    def __init__(self):
        self.m = jload('nav/meta.json')
        self.blocked = np.frombuffer(bytearray(gzip.open(os.path.join(W, 'nav', 'blocked.u8.gz')).read()), np.uint8).reshape(self.m['nz'], self.m['nx'])

    def free(self, x, z):
        m = self.m
        ix = np.floor((np.asarray(x) - m['ox']) / m['cell']).astype(int); iz = np.floor((np.asarray(z) - m['oz']) / m['cell']).astype(int)
        ok = (ix >= 0) & (ix < m['nx']) & (iz >= 0) & (iz < m['nz'])
        out = np.zeros(ix.shape, bool)
        out[ok] = self.blocked[iz[ok], ix[ok]] == 0
        return out


    def open_doors(self):
        """Débloque les cases des portes (le jeu complet : toutes portes ouvertes)."""
        flat = self.blocked.reshape(-1)
        for d in jload('objects.json')['doors']:
            flat[np.array(d['cells'], dtype=np.int64)] = 0

    def main_component(self, start_x, start_z):
        """Masque (nz, nx) des cases libres reliées à la case de départ (remplissage 4-voisins, itératif par balayages numpy)."""
        free = self.blocked == 0
        m = self.m
        ix = int((start_x - m['ox']) / m['cell']); iz = int((start_z - m['oz']) / m['cell'])
        reach = np.zeros_like(free); reach[iz, ix] = True
        while True:
            new = reach.copy()
            new[1:, :] |= reach[:-1, :]; new[:-1, :] |= reach[1:, :]; new[:, 1:] |= reach[:, :-1]; new[:, :-1] |= reach[:, 1:]
            new &= free
            if (new == reach).all():
                return reach
            reach = new

    def in_mask(self, mask, x, z):
        m = self.m
        ix = np.floor((np.asarray(x) - m['ox']) / m['cell']).astype(int); iz = np.floor((np.asarray(z) - m['oz']) / m['cell']).astype(int)
        ok = (ix >= 0) & (ix < m['nx']) & (iz >= 0) & (iz < m['nz'])
        out = np.zeros(ix.shape, bool); out[ok] = mask[iz[ok], ix[ok]]
        return out


def ray_tris(T, O, D, maxd=400.0):
    """Premier triangle touché par le rayon O + t D (Möller-Trumbore, double face). Renvoie (t, indice) ou (None, None)."""
    A, B, C = T['A'], T['B'], T['C']
    e1 = B - A; e2 = C - A
    p = np.cross(D, e2); det = (e1 * p).sum(1)
    with np.errstate(all='ignore'):
        inv = 1.0 / det; tv = O - A
        u = (tv * p).sum(1) * inv
        q = np.cross(tv, e1); v = (D * q).sum(1) * inv
        t = (e2 * q).sum(1) * inv
    ok = (np.abs(det) > 1e-12) & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.05) & (t < maxd)
    if not ok.any():
        return None, None
    idx = np.where(ok)[0]; j = idx[np.argmin(t[idx])]
    return float(t[j]), int(j)


def add_patch_tris(T, path=None):
    """Ajoute à T les bouchons de godot/data/world_patches.json (panneaux et colonnes à 12 pans) comme triangles à deux faces (matériau 0 : côté 0, on force deux faces)."""
    path = path or os.path.join(ROOT, 'godot', 'data', 'world_patches.json')
    d = json.load(open(path))
    A, B, C = [], [], []
    def quad(a, b, y0, y1):
        p0 = (a[0], y0, a[1]); p1 = (b[0], y0, b[1]); p2 = (b[0], y1, b[1]); p3 = (a[0], y1, a[1])
        A.extend([p0, p0]); B.extend([p1, p2]); C.extend([p2, p3])
    for w in d['walls']:
        if 'c' in w:
            for k in range(12):
                a0 = 2 * np.pi * k / 12; a1 = 2 * np.pi * (k + 1) / 12
                quad((w['c'][0] + w['r'] * np.cos(a0), w['c'][1] + w['r'] * np.sin(a0)), (w['c'][0] + w['r'] * np.cos(a1), w['c'][1] + w['r'] * np.sin(a1)), w['y0'], w['y1'])
        else:
            quad(w['a'], w['b'], w['y0'], w['y1'])
    n = len(A)
    T = dict(T)
    T['A'] = np.concatenate([T['A'], np.array(A)]); T['B'] = np.concatenate([T['B'], np.array(B)]); T['C'] = np.concatenate([T['C'], np.array(C)])
    T['mat'] = np.concatenate([T['mat'], np.full(n, -1, np.int32)])
    T['src'] = np.concatenate([T['src'], np.full(n, 3, np.int32)]); T['src_id'] = np.concatenate([T['src_id'], np.full(n, -1, np.int32)])
    return T
