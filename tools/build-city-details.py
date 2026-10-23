#!/usr/bin/env python3
"""Détails 3D des façades et des toits de la ville (v0.32.2) : lit la géométrie cuite (godot/data/world : tuiles, matériaux, textures) et écrit
godot/data/city_details.bin, lu par godot/scenes/world/city_details_view.gd.

  python3 tools/build-city-details.py [--out=godot/data/city_details.bin] [--debug=rapport.json]

Les façades du JS sont des canevas peints (architecture.js : motif de 2 travées x 2 étages par matériau, carte de bosses à demi-résolution). On y lit,
par cellule du motif, la vitre (carte de bosses très sombre), les volets peints (couleur de la palette SHUTTERS à côté de la vitre, ou sur la vitre :
volets fermés), le balcon en fer forgé (barreaux sombres qui débordent de la baie) et la jardinière (fleurs rouges au pied de la baie). Puis, pour chaque
face verticale cuite de ce matériau, on inverse sa projection (u, v) -> (abscisse le long du mur, hauteur) et on pose chaque fenêtre du motif qui
tombe entièrement dans la face : position monde du milieu du bas de la baie, normale sortante, largeur, hauteur, drapeaux, couleur des volets.
Les toits (matériaux de toit) donnent les gouttières (arêtes basses horizontales des pans), les descentes (au bout des gouttières) et les cheminées
(sur les faîtages, un bâtiment sur deux environ, choix par hachage de la position : reproductible).

Format (petit-boutiste) : « ZCD1 », u32 longueur du JSON d'en-tête, JSON {"windows": n, "gutters": n, "pipes": n, "chimneys": n, "ridges": n, ...},
puis les tableaux float32 :
  windows  n x 10 : x, y, z, nx, nz, largeur, hauteur, drapeaux, couleur des volets, couleur de l'encadrement (0xRRGGBB en flottant)
               drapeaux : 1 volets ouverts, 2 volets fermés, 4 balcon, 8 jardinière, 16 colombage (pas d'encadrement de pierre), 32 moderne
  gutters  n x 7 : ax, y, az, bx, bz, nx, nz      (gouttière pendante le long de l'égout, nx/nz : vers l'extérieur du pan)
  pipes    n x 6 : x, z, y0, y1, nx, nz           (descente d'eau pluviale)
  chimneys n x 6 : x, z, y0, y1, angle, largeur
  ridges   n x 6 : ax, ay, az, bx, by, bz         (faîtage : tuiles faîtières)
"""
import json, os, struct, sys, math
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom_lib as g

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
GODOT = os.path.join(ROOT, 'godot')
args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
OUT = args.get('out', os.path.join(GODOT, 'data', 'city_details.bin'))

SHUTTERS = ['#3f5a45', '#7a3b2e', '#54616b', '#2f4a6b', '#6b5a2f', '#5a3a4a']


def res_path(p):
    return os.path.join(GODOT, p.replace('res://', ''))


def style_of(rank):
    r = int(math.floor(rank))
    if 1 <= r <= 4: return 'plaster'
    if 5 <= r <= 7: return 'timber'
    if 8 <= r <= 10: return 'sandstone'
    if r == 11: return 'modern'
    return None   # gothic / floodlit (monuments), boutiques, lucarnes : pas de fenêtres posées ici


def hexrgb(h):
    return np.array([int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)]) / 255.0


SH_RGB = np.array([hexrgb(h) for h in SHUTTERS])


def analyse_texture(mat, tex):
    """Fenêtres du motif d'un matériau de façade : liste de dict(u0, u1, v0, v1, flags, color) en coordonnées de texture (0..1, v vers le bas)."""
    st = style_of(mat['rank'])
    if st is None or mat['bmap'] < 0:
        return st, []
    A = np.asarray(Image.open(res_path(tex[mat['map']]['file'])).convert('RGB'), np.float64) / 255.0
    Bm = np.asarray(Image.open(res_path(tex[mat['bmap']]['file'])).convert('L'), np.float64) / 255.0
    H, W = Bm.shape
    AH, AW = A.shape[:2]
    kx, ky = AW / W, AH / H
    glass = Bm < 0.17
    out = []
    cw, ch = W // 2, H // 2
    rects = {}
    for r in range(2):
        for c in range(2):
            sub = glass[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
            ys, xs = np.nonzero(sub)
            if len(xs) > 0.02 * cw * ch:
                rects[(r, c)] = (c * cw + xs.min(), r * ch + ys.min(), c * cw + xs.max() + 1, r * ch + ys.max() + 1)
    if st == 'modern':
        # moderne : grandes baies vitrées, deux par cellule de largeur ; la rangée du haut est claire dans la carte de bosses (pas de vitre sombre) : on ne pose que les baies vues
        for (r, c), (x0, y0, x1, y1) in rects.items():
            out.append(dict(u0=x0 / W, u1=x1 / W, v0=y0 / H, v1=y1 / H, flags=32, color=0, frame=0x5a5a5a))
        return st, out
    for r in range(2):
        for c in range(2):
            rc = rects.get((r, c))
            closed = False
            if rc is None:
                # volets fermés (plâtre) : baie au même x que la cellule de la même colonne, au même y que la cellule de la même rangée
                col = rects.get((1 - r, c)); row = rects.get((r, 1 - c))
                if col is None or row is None:
                    continue
                rc = (col[0], row[1], col[2], row[3])
                closed = True
            x0, y0, x1, y1 = rc
            wall = np.median(A[int((r * ch + 4) * ky):int((r * ch + 14) * ky), int((c * cw + 4) * kx):int((c * cw + 20) * kx)].reshape(-1, 3), axis=0)
            flags, color = 0, 0
            if st == 'timber':
                flags |= 16

            def region(xa, ya, xb, yb):
                xa, xb = max(0, int(xa * kx)), min(AW, int(xb * kx)); ya, yb = max(0, int(ya * ky)), min(AH, int(yb * ky))
                if xb <= xa or yb <= ya:
                    return None
                return A[ya:yb, xa:xb].reshape(-1, 3)

            def shutter_color(px):
                if px is None or len(px) < 10:
                    return None
                m = np.median(px, axis=0)
                d = np.linalg.norm(SH_RGB - m, axis=1)
                k = int(np.argmin(d))
                if d[k] < 0.12 and np.linalg.norm(m - wall) > 0.12:
                    return SH_RGB[k]
                return None
            ww = x1 - x0
            if closed:
                sc = shutter_color(region(x0 + 2, y0 + 2, x1 - 2, y1 - 2))
                if sc is None:
                    continue
                flags |= 2; color = sc
            elif st == 'plaster':
                sc = shutter_color(region(x0 - ww * 0.45, y0 + (y1 - y0) * 0.2, x0 - 4, y1 - (y1 - y0) * 0.2))
                if sc is not None:
                    flags |= 1; color = sc
            # balcon : barreaux sombres qui débordent de la baie de part et d'autre, dans le tiers bas
            px = region(x0 - 10, y1 - 18, x0 - 2, y1 - 2)
            if px is not None and (px.mean(axis=1) < 0.2).mean() > 0.2:
                flags |= 4
            # jardinière : fleurs rouges / roses au pied de la baie
            px = region(x0, y1 - 10, x1, y1 + 2)
            if px is not None and ((px[:, 0] > 0.55) & (px[:, 1] < 0.35) & (px[:, 2] < 0.5)).mean() > 0.04:
                flags |= 8
            rgb = 0
            if not isinstance(color, int):
                rgb = (int(color[0] * 255) << 16) | (int(color[1] * 255) << 8) | int(color[2] * 255)
            # encadrement : bande juste à gauche de la vitre (entre la vitre et un volet ouvert), au milieu de la hauteur
            fr = region(x0 - 4, y0 + (y1 - y0) * 0.4, x0 - 1, y0 + (y1 - y0) * 0.6)
            frc = np.median(fr, axis=0) if fr is not None else wall
            frgb = (int(frc[0] * 255) << 16) | (int(frc[1] * 255) << 8) | int(frc[2] * 255)
            out.append(dict(u0=x0 / W, u1=x1 / W, v0=y0 / H, v1=y1 / H, flags=flags, color=rgb, frame=frgb))
    return st, out


def load_tiles_uv():
    """Triangles des tuiles avec UV et normales : dict mat -> (P (n,3,3), UV (n,3,2), N (n,3))."""
    tiles = g.jload('tiles.json')
    res = {}
    for t in tiles['tiles']:
        head, b, base = g.open_pack(os.path.join(g.W, 'tiles', 't%s.bin' % t['key']), b'ZMP1')
        for s in head['surfaces']:
            nv = s['nv']; ni = s['ni']
            pos = np.frombuffer(b, '<f4', nv * 3, base + s['pos']).reshape(nv, 3).astype(np.float64)
            nor = np.frombuffer(b, '<f4', nv * 3, base + s['nor']).reshape(nv, 3).astype(np.float64)
            idx = np.frombuffer(b, '<i4', ni, base + s['idx']).reshape(-1, 3)
            uv = np.frombuffer(b, '<f4', nv * 2, base + s['uv']).reshape(nv, 2).astype(np.float64) if 'uv' in s else None
            res.setdefault(s['mat'], []).append((pos[idx], None if uv is None else uv[idx], nor[idx].mean(axis=1)))
    return {m: (np.concatenate([x[0] for x in v]), None if v[0][1] is None else np.concatenate([x[1] for x in v]), np.concatenate([x[2] for x in v])) for m, v in res.items()}


def place_windows(P, UV, N, pattern, rank):
    """Fenêtres du motif posées sur les faces verticales d'un matériau."""
    n = len(P)
    nh = N.copy(); nh[:, 1] = 0
    ln = np.linalg.norm(nh, axis=1)
    ok = ln > 0.9
    groups = {}
    for i in np.where(ok)[0]:
        nn = nh[i] / ln[i]
        t = np.array([-nn[2], 0.0, nn[0]])
        a = P[i] @ t; y = P[i][:, 1]
        X = np.stack([a, y, np.ones(3)], 1)
        try:
            M = np.linalg.solve(X, UV[i])   # (3,2) : [u v] = [a y 1] M
        except np.linalg.LinAlgError:
            continue
        d = float(P[i][0] @ nn)
        key = (round(math.degrees(math.atan2(nn[2], nn[0])) / 0.5), round(d / 0.05), tuple(np.round(M.ravel(), 3)))
        groups.setdefault(key, []).append((i, nn, t, d, M, np.stack([a, y], 1)))
    wins = []
    for key, items in groups.items():
        nn, t, d, M = items[0][1], items[0][2], items[0][3], items[0][4]
        tris = np.array([it[5] for it in items])   # (k,3,2)
        A2 = M[:2, :].T   # [u v]^T = A2 [a y]^T + b
        b0 = M[2, :]
        if abs(np.linalg.det(A2)) < 1e-9:
            continue
        inv = np.linalg.inv(A2)
        uvs = UV[[it[0] for it in items]].reshape(-1, 2)
        umin, vmin = uvs.min(0); umax, vmax = uvs.max(0)

        def inside(pt):
            p0, p1, p2 = tris[:, 0], tris[:, 1], tris[:, 2]
            v0 = p1 - p0; v1 = p2 - p0; v2 = pt - p0
            den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
            with np.errstate(all='ignore'):
                w1 = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / den
                w2 = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / den
            return bool(((w1 >= -0.02) & (w2 >= -0.02) & (w1 + w2 <= 1.02)).any())

        for ku in range(int(math.floor(umin)) - 1, int(math.floor(umax)) + 1):
            for kv in range(int(math.floor(vmin)) - 1, int(math.floor(vmax)) + 1):
                for w in pattern:
                    corners = [(w['u0'] + ku, w['v0'] + kv), (w['u1'] + ku, w['v0'] + kv), (w['u1'] + ku, w['v1'] + kv), (w['u0'] + ku, w['v1'] + kv)]
                    ay = [inv @ (np.array(c) - b0) for c in corners]
                    if not all(inside(p) for p in ay):
                        continue
                    ay = np.array(ay)
                    a0, a1 = ay[:, 0].min(), ay[:, 0].max(); y0, y1 = ay[:, 1].min(), ay[:, 1].max()
                    if a1 - a0 < 0.4 or y1 - y0 < 0.5:
                        continue
                    ac = (a0 + a1) / 2
                    pos = t * ac + nn * d
                    wins.append([pos[0], y0, pos[2], nn[0], nn[2], a1 - a0, y1 - y0, w['flags'], w['color'], w['frame'], rank])
    return wins


def dedupe(wins):
    """Deux façades coplanaires de matériaux différents (emprises OSM qui se chevauchent) : on garde la fenêtre du rang le plus élevé (celui qui est dessiné)."""
    if not wins:
        return wins
    W = np.array(wins)
    order = np.argsort(-W[:, 10])
    keep = []
    cell = {}
    for i in order:
        k = (int(W[i, 0] // 1.0), int(W[i, 1] // 1.0), int(W[i, 2] // 1.0))
        dup = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in cell.get((k[0] + dx, k[1] + dy, k[2] + dz), []):
                        if abs(W[i, 0] - W[j, 0]) < 0.5 and abs(W[i, 1] - W[j, 1]) < 0.5 and abs(W[i, 2] - W[j, 2]) < 0.5:
                            dup = True
        if not dup:
            keep.append(i)
            cell.setdefault(k, []).append(i)
    return [wins[i] for i in sorted(keep)]


def roofs(tri_by_mat, mats):
    """Gouttières, descentes, cheminées et faîtages depuis les triangles de toit."""
    roof_ids = [i for i, m in enumerate(mats) if m['vc'] and m['map'] >= 0 and m['nmap'] >= 0 and m['rmap'] >= 0 and m['emap'] < 0 and m['side'] == 2 and m['bmap'] < 0]
    P = np.concatenate([tri_by_mat[i][0] for i in roof_ids if i in tri_by_mat])
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    ln = np.linalg.norm(n, axis=1)
    keep = ln > 1e-6
    P, n, ln = P[keep], n[keep], ln[keep]
    n = n / ln[:, None]
    n[n[:, 1] < 0] *= -1
    slope = (n[:, 1] > 0.35) & (n[:, 1] < 0.97)      # pans inclinés (pas les toits plats ni les « volets noirs »)
    # arêtes : clé = paire de sommets arrondis au cm
    def vkey(p):
        return (round(p[0] * 50), round(p[1] * 50), round(p[2] * 50))
    edges = {}
    for i in np.where(slope)[0]:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            ka, kb = vkey(P[i, a]), vkey(P[i, b])
            k = (ka, kb) if ka < kb else (kb, ka)
            edges.setdefault(k, []).append((i, a, b))
    gutters, ridges = [], []
    for k, lst in edges.items():
        i, a, b = lst[0]
        pa, pb = P[i, a], P[i, b]
        L = np.linalg.norm(pb - pa)
        if L < 1.2 or abs(pa[1] - pb[1]) > 0.05:
            continue
        c = P[i, 3 - a - b]   # sommet opposé
        if len(lst) == 1 and c[1] > pa[1] + 0.3:
            # bord libre horizontal, le pan monte depuis lui : égout
            nh = np.array([n[i, 0], 0.0, n[i, 2]]); nl = np.linalg.norm(nh)
            if nl < 0.1:
                continue
            nh /= nl
            gutters.append([pa[0], pa[1], pa[2], pb[0], pb[2], nh[0], nh[2]])
        elif len(lst) >= 2 and c[1] < pa[1] - 0.3:
            j, a2, b2 = lst[1]
            c2 = P[j, 3 - a2 - b2]
            if c2[1] < pa[1] - 0.3:
                ridges.append([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]])
    # fusion des segments colinéaires contigus (les pans sont triangulés en plusieurs morceaux)
    def merge(segs, is_gutter):
        segs = [list(s) for s in segs]
        out = []
        used = [False] * len(segs)
        byend = {}
        def key2(x, y, z):
            return (round(x * 20), round(y * 20), round(z * 20))
        for idx, s in enumerate(segs):
            if is_gutter:
                a = key2(s[0], s[1], s[2]); b = key2(s[3], s[1], s[4])
            else:
                a = key2(s[0], s[1], s[2]); b = key2(s[3], s[4], s[5])
            byend.setdefault(a, []).append(idx); byend.setdefault(b, []).append(idx)
        for idx, s in enumerate(segs):
            if used[idx]:
                continue
            used[idx] = True
            if is_gutter:
                A = np.array([s[0], s[1], s[2]]); B = np.array([s[3], s[1], s[4]])
            else:
                A = np.array(s[0:3]); B = np.array(s[3:6])
            d = (B - A) / max(1e-9, np.linalg.norm(B - A))
            grown = True
            while grown:
                grown = False
                for end in (0, 1):
                    P0 = A if end == 0 else B
                    for j in byend.get(key2(*P0), []):
                        if used[j]:
                            continue
                        t = segs[j]
                        if is_gutter:
                            QA = np.array([t[0], t[1], t[2]]); QB = np.array([t[3], t[1], t[4]])
                        else:
                            QA = np.array(t[0:3]); QB = np.array(t[3:6])
                        dj = (QB - QA) / max(1e-9, np.linalg.norm(QB - QA))
                        if abs(abs(dj @ d) - 1) > 0.002:
                            continue
                        other = QB if np.linalg.norm(QA - P0) < 0.1 else QA
                        if end == 0:
                            A = other
                        else:
                            B = other
                        used[j] = True
                        grown = True
            if is_gutter:
                out.append([A[0], A[1], A[2], B[0], B[2], s[5], s[6]])
            else:
                out.append([A[0], A[1], A[2], B[0], B[1], B[2]])
        return out
    gutters = merge(gutters, True)
    ridges = merge(ridges, False)
    gutters = [s for s in gutters if math.hypot(s[3] - s[0], s[4] - s[2]) >= 2.0 and s[1] > 2.5]
    ridges = [s for s in ridges if math.hypot(s[3] - s[0], s[5] - s[2]) >= 2.0]
    pipes, chim = [], []

    def h2(x, z):
        v = math.sin(x * 12.9898 + z * 78.233) * 43758.5453
        return v - math.floor(v)
    for s in gutters:
        ax, y, az, bx, bz, nx, nz = s
        # une descente au bout « bas » du hachage, posée contre le mur sous l'égout (0,25 m en retrait de l'égout)
        e = (ax, az) if h2(ax, az) < h2(bx, bz) else (bx, bz)
        dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz)
        ux, uz = dx / L, dz / L
        sgn = 1 if e == (ax, az) else -1
        px = e[0] + ux * 0.35 * sgn + nx * 0.09   # contre le mur, sous l'égout (les toits cuits n'ont pas de débord : l'égout est à l'aplomb du mur)
        pz = e[1] + uz * 0.35 * sgn + nz * 0.09
        if h2(px, pz) < 0.75:
            pipes.append([px, pz, 0.15, y - 0.12, nx, nz])
    for s in ridges:
        ax, ay, az, bx, by, bz = s
        L = math.hypot(bx - ax, bz - az)
        if L < 5.0 or h2(ax * 0.7, az * 1.3) > 0.62:
            continue
        f = 0.22 + 0.56 * h2(az, ax)
        cx, cz = ax + (bx - ax) * f, az + (bz - az) * f
        cy = ay + (by - ay) * f
        w = 0.55 + 0.35 * h2(cx, cz)
        chim.append([cx, cz, cy - 1.2, cy + 0.9 + 0.8 * h2(cz, cx), math.atan2(bz - az, bx - ax), w])
    return gutters, pipes, chim, ridges


CATH = json.load(open(os.path.join(GODOT, 'data', 'cathedral.json')))
CATH_RECTS = [[-54.0, -27.6, -26.0, 27.6], [-27.0, -31.6, 9.0, 31.6], [9.0, -37.0, 28.0, 39.6], [28.0, -39.0, 47.6, 39.6], [46.0, -30.6, 58.45, 30.6]]   # scenes/world/cathedral_zone.gd


def in_cathedral(x, z):
    """La cathédrale a son propre extérieur (scenes/world/cathedral_*.gd) : aucun détail générique dans son emprise."""
    dx, dz = x - CATH['o'][0], z - CATH['o'][1]
    s = dx * CATH['u'][0] + dz * CATH['u'][1]; t = dx * CATH['v'][0] + dz * CATH['v'][1]
    return any(r[0] <= s <= r[2] and r[1] <= t <= r[3] for r in CATH_RECTS)


_SEG = None


def near_wall(x, z, tol=0.45):
    """Une descente doit longer un mur du sol (segment de collision de plus de 2 m de haut) : sinon l'égout est au-dessus d'un passage ou d'un porche."""
    global _SEG
    if _SEG is None:
        segs, _c = g.load_collision()
        k = (segs[:, 5] < 0.6) & (segs[:, 4] > 2.0) & (segs[:, 6] == 0)
        S = segs[k]
        _SEG = {}
        for a in S:
            for cx in range(int((min(a[0], a[2]) - 1) // 4), int((max(a[0], a[2]) + 1) // 4) + 1):
                for cz in range(int((min(a[1], a[3]) - 1) // 4), int((max(a[1], a[3]) + 1) // 4) + 1):
                    _SEG.setdefault((cx, cz), []).append(a[:4])
    for a in _SEG.get((int(x // 4), int(z // 4)), []):
        ax, az, bx, bz = a
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L2))
        if math.hypot(x - ax - dx * t, z - az - dz * t) < tol:
            return True
    return False


def main():
    mats = g.jload('materials.json')
    tex = g.jload('textures.json')
    tri = load_tiles_uv()
    all_wins = []
    report = {}
    for mi, m in enumerate(mats):
        if not (m['vc'] and m['map'] >= 0 and m['emap'] >= 0):
            continue
        st, pattern = analyse_texture(m, tex)
        if not pattern or mi not in tri or tri[mi][1] is None:
            continue
        P, UV, N = tri[mi]
        w = place_windows(P, UV, N, pattern, m['rank'])
        report[mi] = dict(style=st, pattern=pattern, placed=len(w))
        all_wins += w
        print('matériau %d (%s, rang %g) : %d fenêtres du motif, %d posées' % (mi, st, m['rank'], len(pattern), len(w)))
    wins = [w for w in dedupe(all_wins) if not in_cathedral(w[0], w[2])]
    gutters, pipes, chim, ridges = roofs(tri, mats)
    gutters = [s for s in gutters if not in_cathedral(s[0], s[2])]
    pipes = [s for s in pipes if not in_cathedral(s[0], s[1]) and near_wall(s[0], s[1])]
    chim = [s for s in chim if not in_cathedral(s[0], s[1])]
    ridges = [s for s in ridges if not in_cathedral(s[0], s[2])]
    print('fenêtres : %d (%d avant dédoublonnage) ; gouttières %d ; descentes %d ; cheminées %d ; faîtages %d' % (len(wins), len(all_wins), len(gutters), len(pipes), len(chim), len(ridges)))
    flags = np.array([w[7] for w in wins])
    print('  volets ouverts %d, fermés %d, balcons %d, jardinières %d' % ((flags.astype(int) & 1 > 0).sum(), (flags.astype(int) & 2 > 0).sum(), (flags.astype(int) & 4 > 0).sum(), (flags.astype(int) & 8 > 0).sum()))
    head = dict(windows=len(wins), gutters=len(gutters), pipes=len(pipes), chimneys=len(chim), ridges=len(ridges), version=1)
    hj = json.dumps(head).encode()
    with open(OUT, 'wb') as f:
        f.write(b'ZCD1'); f.write(struct.pack('<I', len(hj))); f.write(hj)
        for arr, w in ((wins, 10), (gutters, 7), (pipes, 6), (chim, 6), (ridges, 6)):
            a = np.array([x[:w] for x in arr], np.float32).reshape(-1, w) if arr else np.zeros((0, w), np.float32)
            f.write(a.astype('<f4').tobytes())
    print('écrit %s (%d octets)' % (OUT, os.path.getsize(OUT)))
    if 'debug' in args:
        json.dump(report, open(args['debug'], 'w'), indent=1)


if __name__ == '__main__':
    main()
