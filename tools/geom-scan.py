#!/usr/bin/env python3
"""Faces manquantes / bâtiments ouverts (v0.23.0), sur la géométrie cuite (godot/data/world/tiles, doors) :
  1. arêtes OUVERTES : arête (sommets quantifiés à 2 cm) portée par un seul triangle, hors du sol (y > 0,1) ; regroupées en grappes, triées par longueur ;
  2. triangles ENVERS : sens d'enroulement contraire aux normales stockées, par matériau (un matériau à une seule face les rend invisibles, un matériau
     à deux faces les éclaire à l'envers : noir) ;
  3. avec --dark : liste les emplacements de plus de N m² de triangles envers sur matériau à deux faces.
  python3 tools/geom-scan.py [--out=rapport.json] [--top=40] [--min-len=1.0]"""
import collections, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom_lib as g

args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
TOP = int(args.get('top', 40)); MINLEN = float(args.get('min-len', 1.0))
mats = g.jload('materials.json')
zones = g.Zones()


def surfaces(path, magic):
    head, b, base = g.open_pack(path, magic)
    for s in g.surfaces_of(head):
        pos, idx = g.surf_arrays(s, b, base)
        nor = np.frombuffer(b, '<f4', s['nv'] * 3, base + s['nor']).reshape(-1, 3).astype(float)
        yield s['mat'], pos, idx, nor


def open_edges(tris_pos):
    """tris_pos (N,3,3) -> arêtes à un seul triangle ((M,2,3))."""
    q = np.round(tris_pos / 0.02).astype(np.int64)
    e = np.concatenate([q[:, [0, 1]], q[:, [1, 2]], q[:, [2, 0]]])
    orig = np.concatenate([tris_pos[:, [0, 1]], tris_pos[:, [1, 2]], tris_pos[:, [2, 0]]])
    a = e[:, 0, :]; b = e[:, 1, :]
    swap = (a[:, 0] > b[:, 0]) | ((a[:, 0] == b[:, 0]) & ((a[:, 1] > b[:, 1]) | ((a[:, 1] == b[:, 1]) & (a[:, 2] > b[:, 2]))))
    lo = np.where(swap[:, None], b, a); hi = np.where(swap[:, None], a, b)
    key = np.concatenate([lo, hi], axis=1)
    k = np.ascontiguousarray(key).view(np.dtype((np.void, key.dtype.itemsize * 6))).ravel()
    _, inv, cnt = np.unique(k, return_inverse=True, return_counts=True)
    single = cnt[inv] == 1
    degenerate = (lo == hi).all(1)
    m = single & ~degenerate
    return orig[m]


def main():
    inverted = collections.defaultdict(lambda: [0, 0, 0.0])
    inv_pts = []
    edges_all = []
    for t in g.jload('tiles.json')['tiles']:
        parts = []
        for mat, pos, idx, nor in surfaces(os.path.join(g.W, 'tiles', 't%s.bin' % t['key']), b'ZMP1'):
            P = pos[idx]
            wn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); area = np.linalg.norm(wn, axis=1) / 2
            wn /= np.linalg.norm(wn, axis=1)[:, None] + 1e-18
            d = (wn * nor[idx].mean(1)).sum(1)
            bad = (d < -0.2) & (area > 1e-6)
            c = inverted[mat]; c[0] += len(idx); c[1] += int(bad.sum()); c[2] += float(area[bad].sum())
            if mats[mat]['side'] != 2 and bad.any():
                for p in P[bad]:
                    inv_pts.append((mat, p.mean(0)))
            if mats[mat]['tr'] or mats[mat]['op'] < 1 or mats[mat]['at'] > 0:
                continue   # vitres, feuillage : pas des coques
            parts.append(P[area > 1e-8])
        P = np.concatenate(parts)
        E = open_edges(P)
        E = E[(E[:, :, 1].max(1) > 0.1)]   # hors arêtes de base (le sol)
        edges_all.append(E)
    E = np.concatenate(edges_all)
    L = np.linalg.norm(E[:, 1] - E[:, 0], axis=1)
    print('arêtes ouvertes (hors sol) : %d, longueur totale %.0f m' % (len(E), L.sum()))
    print('triangles envers par matériau (tuiles) :')
    for m, (n, bad, a) in sorted(inverted.items(), key=lambda kv: -kv[1][2]):
        if bad:
            print('  mat %3d  side %d  map %3d  %6d / %6d  aire %9.0f m2' % (m, mats[m]['side'], mats[m]['map'], bad, n, a))
    # grappes d'arêtes ouvertes (cases de 3 m)
    cl = {}
    mid = (E[:, 0] + E[:, 1]) / 2
    for i in range(len(E)):
        k = (int(mid[i, 0] // 3), int(mid[i, 2] // 3), int(mid[i, 1] // 4))
        c = cl.setdefault(k, [0, 0.0, mid[i].copy()])
        c[0] += 1; c[1] += L[i]
    items = [dict(x=round(float(c[2][0]), 1), y=round(float(c[2][1]), 1), z=round(float(c[2][2]), 1), n=c[0], len=round(c[1], 1), zone=zones.name(c[2][0], c[2][2])) for c in cl.values() if c[1] >= MINLEN]
    items.sort(key=lambda o: -o['len'])
    print('grappes d\'arêtes ouvertes >= %.1f m : %d ; les plus longues :' % (MINLEN, len(items)))
    for o in items[:TOP]:
        print('  %7.1f m  %3d arêtes  (%7.1f, %5.1f, %7.1f)  %s' % (o['len'], o['n'], o['x'], o['y'], o['z'], o['zone']))
    print('triangles envers sur matériau à UNE face (invisibles de leur bon côté) :', len(inv_pts))
    byz = collections.Counter(zones.name(p[0], p[2]) for _, p in inv_pts)
    print('  par quartier :', dict(byz.most_common(8)))
    if 'out' in args:
        json.dump(dict(open_edge_clusters=items, inverted_single_side=[dict(mat=int(m), x=round(float(p[0]), 2), y=round(float(p[1]), 2), z=round(float(p[2]), 2)) for m, p in inv_pts]), open(args['out'], 'w'))


main()
