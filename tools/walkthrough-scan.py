#!/usr/bin/env python3
"""Murs TRAVERSABLES (v0.23.0) : l'inverse de collision-scan.py. Pour chaque face verticale visible qui coupe le plan y = 1,0 m (hauteur du torse),
on échantillonne la coupe tous les 0,4 m et on cherche la collision (segment ou cercle, portes fermées comprises, désactivés exclus) à moins de TOL m
en plan. Les points sans collision forment des grappes : un joueur peut traverser ce mur visible.
  python3 tools/walkthrough-scan.py [--tol=0.8] [--out=rapport.json] [--top=40] [--inst]      (--inst : compte aussi les instances)
Seules comptent les coupes dont un côté (à 0,9 m) est atteignable depuis le départ, portes ouvertes, et l'autre libre.
Écartés : matériaux transparents (vitres, feuillage), faces de moins de 0,5 m de large, faces à plus de 3 m au-dessus de l'étage (étages : voir levels)."""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom_lib as g

args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
TOL = float(args.get('tol', 0.8)); TOP = int(args.get('top', 40)); Y = 1.0; STEP = 0.4


def main():
    t0 = time.time()
    T = g.load_world_tris(with_instances='inst' in args)
    mats = g.jload('materials.json')
    A, B, C = T['A'], T['B'], T['C']
    opaque = np.array([not (m['tr'] or m['op'] < 1 or m['at'] > 0) for m in mats])[T['mat']]
    n = np.cross(B - A, C - A); ln = np.linalg.norm(n, axis=1); n /= ln[:, None] + 1e-18
    ymin = np.minimum(np.minimum(A[:, 1], B[:, 1]), C[:, 1]); ymax = np.maximum(np.maximum(A[:, 1], B[:, 1]), C[:, 1])
    sel = opaque & (np.abs(n[:, 1]) < 0.3) & (ymin < Y) & (ymax > Y) & (ln > 0.01)
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
    segs, circles = g.load_collision()
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
    nav = g.Nav(); nav.open_doors(); reach = nav.main_component(-0.625, -30.875)
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
    print('MURS TRAVERSABLES : %.0f m de coupe sans collision à moins de %.1f m (sur %.0f m), %d grappes (%.0f s)' % (tot, TOL, len(pts) * STEP, len(items), time.time() - t0))
    for o in items[:TOP]:
        print('  %6.1f m  (%7.1f, %7.1f)  %s' % (o['len'], o['x'], o['z'], o['zone']))
    if 'out' in args:
        json.dump(dict(tol=TOL, total_m=float(tot), clusters=items), open(args['out'], 'w'))


main()
