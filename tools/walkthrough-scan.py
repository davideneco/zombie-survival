#!/usr/bin/env python3
"""Murs TRAVERSABLES (v0.23.0) : l'inverse de collision-scan.py. Pour chaque face verticale visible qui coupe le plan y = 1,0 m (hauteur du torse),
on échantillonne la coupe tous les 0,4 m et on cherche la collision (segment ou cercle, portes fermées comprises, désactivés exclus) à moins de TOL m
en plan. Les points sans collision forment des grappes : un joueur peut traverser ce mur visible.
  python3 tools/walkthrough-scan.py [--tol=0.8] [--out=rapport.json] [--top=40] [--inst] [--furniture] [--y=1.0]      (--inst : compte aussi les instances)
v0.33.1 : --furniture ajoute le mobilier urbain du port (godot/data/street_furniture.json, sim/street_furniture.gd) : sa collision (boîtes et cercles) et
les faces de son emprise (côtés des boîtes, prismes à 12 pans des cercles, jusqu'à sa hauteur) ; on vérifie qu'aucune n'est traversable et que le total
des autres murs traversables ne bouge pas. --y : hauteur de la coupe (0,6 m pour les bancs, qui ne montent qu'à 0,9 m).
Seules comptent les coupes dont un côté (à 0,9 m) est atteignable depuis le départ, portes ouvertes, et l'autre libre.
Écartés : matériaux transparents (vitres, feuillage), faces de moins de 0,5 m de large, faces à plus de 3 m au-dessus de l'étage (étages : voir levels)."""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom_lib as g

args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
TOL = float(args.get('tol', 0.8)); TOP = int(args.get('top', 40)); Y = float(args.get('y', 1.0)); STEP = 0.4

# v0.33.1 : mobilier urbain (mêmes encombrements que godot/sim/street_furniture.gd KINDS)
FURN = {'bench': dict(w=1.8, d=0.62, h=0.9), 'bin': dict(r=0.3, h=1.05), 'bollard': dict(r=0.13, h=0.95), 'lamp': dict(r=0.16, h=4.8),
        'barrier': dict(w=2.0, d=0.56, h=1.1), 'kiosk': dict(r=1.3, h=3.2), 'column': dict(r=0.62, h=3.4)}


def furniture(T, segs, circles):
    """Ajoute le mobilier : faces de l'emprise (src 4) dans T, collision (props) dans segs / circles. Renvoie T, segs, circles, nombre d'objets."""
    items = json.load(open(os.path.join(g.ROOT, 'godot', 'data', 'street_furniture.json')))['items']
    A, B, C, S, Ci = [], [], [], [], []
    def quad(a, b, h):
        p0 = (a[0], 0.0, a[1]); p1 = (b[0], 0.0, b[1]); p2 = (b[0], h, b[1]); p3 = (a[0], h, a[1])
        A.extend([p0, p0]); B.extend([p1, p2]); C.extend([p2, p3])
    for it in items:
        K = FURN[it['kind']]; x, z, yaw = it['x'], it['z'], it['yaw']
        if 'r' in K:
            r = K['r']
            pts = [(x + r * np.cos(2 * np.pi * k / 12), z + r * np.sin(2 * np.pi * k / 12)) for k in range(12)]
            Ci.append([x, z, r, K['h'], -1e300, 1, 0, 0])
        else:
            c, s_ = np.cos(yaw), np.sin(yaw)   # rotation.y = yaw : x local -> (c, -s), z local -> (s, c)
            pts = []
            for px, pz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                lx, lz = px * K['w'] / 2, pz * K['d'] / 2
                pts.append((x + lx * c + lz * s_, z - lx * s_ + lz * c))
            for k in range(4):
                a, b = pts[k], pts[(k + 1) % 4]
                S.append([a[0], a[1], b[0], b[1], K['h'], -1e300, 1, 0, -1, 0])
        for k in range(len(pts)):
            quad(pts[k], pts[(k + 1) % len(pts)], K['h'])
    n = len(A)
    T = dict(T)
    T['A'] = np.concatenate([T['A'], np.array(A)]); T['B'] = np.concatenate([T['B'], np.array(B)]); T['C'] = np.concatenate([T['C'], np.array(C)])
    T['mat'] = np.concatenate([T['mat'], np.zeros(n, np.int32)])
    T['src'] = np.concatenate([T['src'], np.full(n, 4, np.int32)]); T['src_id'] = np.concatenate([T['src_id'], np.full(n, -1, np.int32)])
    if S:
        segs = np.concatenate([segs, np.array(S)])
    if Ci:
        circles = np.concatenate([circles, np.array(Ci)])
    return T, segs, circles, len(items)


def main():
    t0 = time.time()
    T = g.load_world_tris(with_instances='inst' in args)
    mats = g.jload('materials.json')
    segs, circles = g.load_collision()
    if 'furniture' in args:
        T, segs, circles, nf = furniture(T, segs, circles)
        print('mobilier urbain : %d objets ajoutés (faces et collision)' % nf, flush=True)
    A, B, C = T['A'], T['B'], T['C']
    opaque = np.array([not (m['tr'] or m['op'] < 1 or m['at'] > 0) for m in mats])[T['mat']]
    opaque[T['src'] == 4] = True
    n = np.cross(B - A, C - A); ln = np.linalg.norm(n, axis=1); n /= ln[:, None] + 1e-18
    ymin = np.minimum(np.minimum(A[:, 1], B[:, 1]), C[:, 1]); ymax = np.maximum(np.maximum(A[:, 1], B[:, 1]), C[:, 1])
    sel = opaque & (np.abs(n[:, 1]) < 0.5) & (ymin < Y) & (ymax > Y) & (ln > 0.01)
    idx = np.where(sel)[0]
    print('faces verticales coupant y=%.1f : %d' % (Y, len(idx)), flush=True)
    # coupe par le plan : deux points parmi les arêtes
    pts = []; src = []
    for i in idx:
        P = (A[i], B[i], C[i]); cut = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            ya, yb = P[a][1], P[b][1]
            if (ya - Y) * (yb - Y) < 0:
                t = (Y - ya) / (yb - ya); cut.append(P[a] + (P[b] - P[a]) * t)
        if len(cut) != 2:
            continue
        L = float(np.hypot(cut[1][0] - cut[0][0], cut[1][2] - cut[0][2]))
        if L < 0.5:
            continue
        k = max(2, int(np.ceil(L / STEP)))
        for j in range(k):
            t = (j + 0.5) / k
            pts.append(cut[0] + (cut[1] - cut[0]) * t); src.append(i)
    pts = np.array(pts); src = np.array(src)
    print('points %d' % len(pts), flush=True)
    # grille de segments actifs (cases de 4 m)
    C4 = 4.0; grid = {}
    for k, s in enumerate(segs):
        if s[9]:
            continue
        for ix in range(int(np.floor((min(s[0], s[2]) - TOL) / C4)), int(np.floor((max(s[0], s[2]) + TOL) / C4)) + 1):
            for iz in range(int(np.floor((min(s[1], s[3]) - TOL) / C4)), int(np.floor((max(s[1], s[3]) + TOL) / C4)) + 1):
                grid.setdefault((ix, iz), []).append(k)
    cgrid = {}
    for k, c in enumerate(circles):
        if c[7]:
            continue
        for ix in range(int(np.floor((c[0] - c[2] - TOL) / C4)), int(np.floor((c[0] + c[2] + TOL) / C4)) + 1):
            for iz in range(int(np.floor((c[1] - c[2] - TOL) / C4)), int(np.floor((c[1] + c[2] + TOL) / C4)) + 1):
                cgrid.setdefault((ix, iz), []).append(k)
    nav = g.Nav(); nav.open_doors(); st = g.jload('objects.json')['start']; reach = nav.main_component(st['x'], st['z'])
    bad = np.zeros(len(pts), bool)
    cx = np.floor(pts[:, 0] / C4).astype(int); cz = np.floor(pts[:, 2] / C4).astype(int)
    cells = {}
    for k in range(len(pts)):
        cells.setdefault((cx[k], cz[k]), []).append(k)
    for key, ids in cells.items():
        ids = np.array(ids); Q = pts[ids][:, [0, 2]]
        best = np.full(len(ids), np.inf)
        for k in grid.get(key, []):
            s = segs[k]
            # bande de hauteur : le torse (y = 1,0) doit être bloqué
            if s[5] > -1e20 and not (s[5] <= Y + 0.1):
                continue
            ab = np.array([s[2] - s[0], s[3] - s[1]]); l2 = float(ab @ ab)
            t = np.clip(((Q - [s[0], s[1]]) @ ab) / max(l2, 1e-12), 0, 1)
            d = np.hypot(*(Q - ([s[0], s[1]] + t[:, None] * ab)).T)
            best = np.minimum(best, d)
        for k in cgrid.get(key, []):
            c = circles[k]
            best = np.minimum(best, np.maximum(np.hypot(Q[:, 0] - c[0], Q[:, 1] - c[1]) - c[2], 0))
        bad[ids] = best > TOL
    # seulement les murs dont un côté est atteignable depuis le départ (portes ouvertes) et l'autre côté libre : on peut réellement passer à travers
    nn = n[src]; off = 0.9
    pa = nav.in_mask(reach, pts[:, 0] + nn[:, 0] * off, pts[:, 2] + nn[:, 2] * off); pb = nav.in_mask(reach, pts[:, 0] - nn[:, 0] * off, pts[:, 2] - nn[:, 2] * off)
    fa = nav.free(pts[:, 0] + nn[:, 0] * off, pts[:, 2] + nn[:, 2] * off); fb = nav.free(pts[:, 0] - nn[:, 0] * off, pts[:, 2] - nn[:, 2] * off)
    if 'cathedral-all' in args:   # sans le filtre d'atteignabilité, dans l'emprise de la cathédrale (la carte de navigation voit parfois le pied de la tour comme plein)
        inbox = (pts[:, 0] > 100) & (pts[:, 0] < 235) & (pts[:, 2] > -25) & (pts[:, 2] < 100)
        bad &= ((pa & fb) | (pb & fa)) | inbox
    else:
        bad &= (pa & fb) | (pb & fa)
    zones = g.Zones()
    # grappes : par face source, puis cases de 6 m
    cl = {}
    for p, s_ in zip(pts[bad], src[bad]):
        k = (int(p[0] // 6), int(p[2] // 6))
        c = cl.setdefault(k, [0, p.copy(), 0.0]); c[0] += 1
    items = []
    for k, (n_, p, _) in cl.items():
        items.append(dict(x=round(float(p[0]), 1), z=round(float(p[2]), 1), len=round(n_ * STEP, 1), zone=zones.name(p[0], p[2])))
    items.sort(key=lambda o: -o['len'])
    tot = bad.sum() * STEP
    if 'furniture' in args:
        fb = bad & (T['src'][src] == 4)
        print('mobilier : %d points de coupe sur ses faces, %d traversables' % (int((T['src'][src] == 4).sum()), int(fb.sum())))
    print('MURS TRAVERSABLES : %.0f m de coupe sans collision à moins de %.1f m (sur %.0f m), %d grappes (%.0f s)' % (tot, TOL, len(pts) * STEP, len(items), time.time() - t0))
    for o in items[:TOP]:
        print('  %6.1f m  (%7.1f, %7.1f)  %s' % (o['len'], o['x'], o['z'], o['zone']))
    if 'out' in args:
        json.dump(dict(tol=TOL, total_m=float(tot), clusters=items), open(args['out'], 'w'))
    if 'extras' in args:
        # v0.24.0 : segments de collision AJOUTÉS (écart volontaire avec le JS) pour fermer les murs visibles traversables : un segment par suite
        # continue de points sans collision d'une même face, étage 0 seulement (y0 = -1 m : n'atteint pas la crypte ; h = 6 m : pas les galeries à 14,5 m)
        out = []; bi = np.where(bad)[0]; run = []
        def flush():
            if not run:
                return
            a, b = pts[run[0]], pts[run[-1]]
            d = np.array([b[0] - a[0], b[2] - a[2]]); L = float(np.hypot(*d))
            u = d / L if L > 1e-6 else np.array([1.0, 0.0])
            ext = STEP * 0.5 + 0.05
            out.append([round(float(a[0] - u[0] * ext), 2), round(float(a[2] - u[1] * ext), 2), round(float(b[0] + u[0] * ext), 2), round(float(b[2] + u[1] * ext), 2)])
        for k in bi:
            if ymax[src[k]] < 2.0:   # contremarches d'escaliers, bordures : on les monte, elles ne bloquent pas
                continue
            if run and (src[k] != src[run[-1]] or k != run[-1] + 1):
                flush(); run = []
            run.append(k)
        flush()
        json.dump(dict(y0=-1.0, h=6.0, segs=out), open(args['extras'], 'w'), separators=(',', ':'))
        print('extras : %d segments -> %s' % (len(out), args['extras']))


main()
