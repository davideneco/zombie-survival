#!/usr/bin/env python3
"""Murs invisibles et murs à sens unique (v0.23.0) : compare la collision cuite (godot/data/world/collision) à la géométrie visible
(tuiles, portes, instances de godot/data/world) et écrit un rapport.

  python3 tools/collision-scan.py [--tol=0.3] [--out=rapport.json] [--top=60] [--step=0.4] [--high] [--patches=f.json] [--with-patches]

Test 1, MUR INVISIBLE : un segment / cercle de collision est testé en des points espacés de 0,4 m, à deux hauteurs du corps (0,6 et 1,5 m, bornées par sa
bande) ; un point est « vu » si une face (de n'importe quel sens) est à moins de TOL en 3D. Plus de 60 % de points non vus = INVISIBLE. Sont écartés : portes
(rendues à part), segments désactivés (off), et tout ce qui est dessiné hors tuiles par le jeu (machines, boîtes mystère, armes murales, vélos, parkings,
bornes : à moins de 3 m d'un point de objects.json).
Test 2, MUR VU D'UN SEUL CÔTÉ : pour un mur (h infini, étage inclus) vu, on regarde chaque côté LIBRE (cases libres de la navigation à 1,2 m) : une face à
moins de TOL doit être tournée vers ce côté (matériau à deux faces : toujours bon ; une seule face : normale d'enroulement vers le côté). Sinon, le mur est
supprimé par le rendu à face arrière coupée vu de ce côté (trou).
Sortie : grappes triées par longueur, avec coordonnées, hauteur, quartier ; --out écrit tous les éléments (indices dans segs.f64 / circles.f64) pour
`--show-collision=rapport.json` (magenta = invisible, jaune = à sens unique)."""
import json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geom_lib as g

args = dict(a.lstrip('-').split('=', 1) if '=' in a else (a.lstrip('-'), '1') for a in sys.argv[1:])
TOL = float(args.get('tol', 0.3)); TOP = int(args.get('top', 60)); STEP = float(args.get('step', 0.4)); CELL = 4.0
HIGH = 'high' in args; SIDE_OFF = 1.2; RUN_MIN = float(args.get('run', 1.5))   # un mur est aussi signalé si une portion continue d'au moins RUN_MIN m n'a aucune face


def build_bins(T, extra):
    A, B, C = T['A'], T['B'], T['C']
    lo = np.minimum(np.minimum(A, B), C) - extra; hi = np.maximum(np.maximum(A, B), C) + extra
    ix0 = np.floor(lo[:, 0] / CELL).astype(int); ix1 = np.floor(hi[:, 0] / CELL).astype(int)
    iz0 = np.floor(lo[:, 2] / CELL).astype(int); iz1 = np.floor(hi[:, 2] / CELL).astype(int)
    bins = {}
    for t in range(len(A)):
        for ix in range(ix0[t], ix1[t] + 1):
            for iz in range(iz0[t], iz1[t] + 1):
                bins.setdefault((ix, iz), []).append(t)
    return bins, lo, hi


def dynamic_points():
    """Objets dessinés par des vues (machines_view, rides_view…) et non par les tuiles : leur collision n'a pas de surface cuite."""
    o = g.jload('objects.json'); pts = []
    for key in ('machines', 'wallWeapons'):
        pts += [(m['pos']['x'], m['pos']['z']) for m in o[key]]
    pts += [(s['x'], s['z']) for s in o['stations']]
    pts += [(s['x'], s['z']) for s in o['bikeStations']]
    for p in o['parkings']:
        pts += [(q['x'], q['z']) for q in p['points']]
    pts += [(s['x'], s['z']) for s in o['vehicleSpawns']]
    return np.array(pts)


def sample_points(segs, circles, dyn):
    pts, owner, nrm, tix = [], [], [], []
    def near_dyn(x, z):
        return len(dyn) and (((dyn[:, 0] - x) ** 2 + (dyn[:, 1] - z) ** 2) < 9.0).any()
    for i, s in enumerate(segs):
        ax, az, bx, bz, h, y0, prop, vid, door, off = s
        if off or door >= 0:
            continue
        L = np.hypot(bx - ax, bz - az)
        if L < 1e-6 or near_dyn((ax + bx) / 2, (az + bz) / 2):
            continue
        n = max(2, int(np.ceil(L / STEP)) + 1)
        ts = (np.arange(n) + 0.5) / n
        ys = [y0 + 1.0, y0 + 1.6] if y0 > -1e20 else [0.6, 1.5]
        top = h if h < 1e20 else 99.0
        ys = sorted(set(round(min(y, top - 0.1), 3) for y in ys))
        nx, nz = -(bz - az) / L, (bx - ax) / L
        for ti, t in enumerate(ts):
            for y in ys:
                pts.append((ax + (bx - ax) * t, y, az + (bz - az) * t)); owner.append(('s', i)); nrm.append((nx, nz)); tix.append(ti)
    if HIGH:   # --high : façades sur toute la hauteur (collision à hauteur infinie : la hauteur vient de la géométrie) ; un point tous les 1,2 m, une hauteur tous les 3 m
        for i, s in enumerate(segs):
            ax, az, bx, bz, h, y0, prop, vid, door, off = s
            if off or door >= 0 or prop or h < 1e20 or y0 > -1e20:
                continue
            L = np.hypot(bx - ax, bz - az)
            if L < 1e-6 or near_dyn((ax + bx) / 2, (az + bz) / 2):
                continue
            n = max(1, int(np.ceil(L / 1.2)))
            for ti in range(n):
                t = (ti + 0.5) / n
                for y in np.arange(3.0, 42.0, 3.0):
                    pts.append((ax + (bx - ax) * t, y, az + (bz - az) * t)); owner.append(('h', i)); nrm.append((0.0, 0.0)); tix.append(ti)
    for i, c in enumerate(circles):
        x, z, r, h, y0, prop, vid, off = c
        if off or near_dyn(x, z):
            continue
        ys = [0.6, 1.5] if y0 < -1e20 else [y0 + 1.0, y0 + 1.6]
        ys = sorted(set(round(min(y, (h if h < 1e20 else 99.0) - 0.1), 3) for y in ys))
        for a in np.linspace(0, 2 * np.pi, 8, endpoint=False):
            for y in ys:
                pts.append((x + r * np.cos(a), y, z + r * np.sin(a))); owner.append(('c', i)); nrm.append((0.0, 0.0)); tix.append(0)
    return np.array(pts), owner, np.array(nrm), np.array(tix)


def cluster(items, gap=0.6):
    par = list(range(len(items)))
    def f(i):
        while par[i] != i:
            par[i] = par[par[i]]; i = par[i]
        return i
    grid = {}
    for k, o in enumerate(items):
        for p in (o['a'], o.get('b')):
            if p:
                grid.setdefault((int(p[0] // 2), int(p[1] // 2)), []).append((p, k))
    for (gx, gz), L in grid.items():
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for p, k in L:
                    for q, m in grid.get((gx + dx, gz + dz), []):
                        if k != m and (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < gap * gap:
                            par[f(k)] = f(m)
    cl = {}
    for k, o in enumerate(items):
        cl.setdefault(f(k), []).append(o)
    res = []
    for L in cl.values():
        res.append(dict(n=len(L), len=round(sum(o['len'] for o in L), 1), x=round(sum(o['a'][0] for o in L) / len(L), 1), z=round(sum(o['a'][1] for o in L) / len(L), 1),
                        zone=L[0]['zone'], prop=all(o['prop'] for o in L), h=L[0]['h'], y0=L[0]['y0'], far=max(o['far'] for o in L)))
    res.sort(key=lambda c: -c['len'])
    return res


def dist_only(T, bins, lo, hi, P):
    """Distance de chaque point de P à la face visible la plus proche (sans orientation)."""
    A, B, C = T['A'], T['B'], T['C']
    dist = np.full(len(P), np.inf)
    cx = np.floor(P[:, 0] / CELL).astype(int); cz = np.floor(P[:, 2] / CELL).astype(int)
    keys = {}
    for k in range(len(P)):
        keys.setdefault((cx[k], cz[k]), []).append(k)
    for key, ids in keys.items():
        cand = bins.get(key)
        if not cand:
            continue
        cand = np.array(cand); ids = np.array(ids); Q = P[ids]
        cand = cand[(hi[cand, 1] >= Q[:, 1].min()) & (lo[cand, 1] <= Q[:, 1].max())]
        for s0 in range(0, len(cand), 400):
            cs = cand[s0:s0 + 400]
            pp = np.repeat(Q, len(cs), axis=0); tt = np.tile(cs, len(Q))
            d = g.point_tri_dist(pp, A[tt], B[tt], C[tt]).reshape(len(Q), len(cs)).min(1)
            dist[ids] = np.minimum(dist[ids], d)
    return dist


def make_patches(items, T, bins, lo, hi, far_min):
    """Bouchons visibles des collisions sans face (ne touchent pas à la collision) :
    - mur de sol (far >= far_min) : panneau de 0 jusqu'à la plus basse face visible au-dessus (partie flottante : portique de l'Opéra), bornée à 2,5-4,5 m, 3 m sans face ;
    - mur d'étage (cathédrale : escalier de la flèche) à plus de 1 m de toute face : parapet de 1,1 m ;
    - cercle d'étage (colonne de la plateforme) à plus de 1 m de toute face : colonne de y0 à min(h, y0 + 10)."""
    out = []
    ys = np.arange(1.8, 24.0, 0.3)
    for o in items:
        if o['kind'] == 'circle':
            if o['y0'] is None or o['far'] < 1.0:
                continue
            out.append(dict(c=o['a'], r=o['r'], y0=o['y0'], y1=round(min(o['h'] or 99.0, o['y0'] + 10.0), 2), zone=o['zone'], circle=o['i']))
            continue
        if o['prop']:
            continue
        if o['y0'] is not None:
            if o['far'] >= 1.0:
                out.append(dict(a=o['a'], b=o['b'], y0=o['y0'], y1=round(o['y0'] + 1.1, 2), zone=o['zone'], seg=o['i']))
            continue
        if o['far'] < far_min:
            continue
        (ax, az), (bx, bz) = o['a'], o['b']
        ts = np.linspace(0.15, 0.85, 5)
        P = np.array([(ax + (bx - ax) * t, y, az + (bz - az) * t) for t in ts for y in ys])
        d = dist_only(T, bins, lo, hi, P).reshape(len(ts), len(ys))
        tops = []
        for row in d:
            ok = np.where(row <= TOL)[0]
            tops.append(ys[ok[0]] if len(ok) else 3.0)
        top = float(np.clip(np.median(tops), 2.5, 4.5))
        out.append(dict(a=[ax, az], b=[bx, bz], y0=0.0, y1=round(top, 2), zone=o['zone'], seg=o['i']))
    return out


def main():
    t0 = time.time()
    T = g.load_world_tris()
    if 'with-patches' in args:   # compte les bouchons (world_patches.json) comme géométrie visible : état « après »
        T = g.add_patch_tris(T)
    mats = g.jload('materials.json')
    A, B, C = T['A'], T['B'], T['C']
    wn = np.cross(B - A, C - A); wn /= np.linalg.norm(wn, axis=1)[:, None] + 1e-18
    two_sided = np.array([m['side'] == 2 for m in mats + [dict(side=2)]])[T['mat']]   # (matériau -1 : les bouchons, deux faces)
    segs, circles = g.load_collision()
    nav = g.Nav(); zones = g.Zones()
    P, owner, nrm, tix = sample_points(segs, circles, dynamic_points())
    print('triangles %d, segments %d, cercles %d, points %d' % (len(A), len(segs), len(circles), len(P)), flush=True)
    bins, lo, hi = build_bins(T, TOL)
    dist = np.full(len(P), np.inf); dpos = np.full(len(P), np.inf); dneg = np.full(len(P), np.inf)
    cx = np.floor(P[:, 0] / CELL).astype(int); cz = np.floor(P[:, 2] / CELL).astype(int)
    keys = {}
    for k in range(len(P)):
        keys.setdefault((cx[k], cz[k]), []).append(k)
    for key, ids in keys.items():
        cand = bins.get(key)
        if not cand:
            continue
        cand = np.array(cand); ids = np.array(ids); Q = P[ids]; N = nrm[ids]
        cand = cand[(hi[cand, 1] >= Q[:, 1].min()) & (lo[cand, 1] <= Q[:, 1].max())]
        for s0 in range(0, len(cand), 400):
            cs = cand[s0:s0 + 400]
            pp = np.repeat(Q, len(cs), axis=0); tt = np.tile(cs, len(Q))
            d = g.point_tri_dist(pp, A[tt], B[tt], C[tt]).reshape(len(Q), len(cs))
            dist[ids] = np.minimum(dist[ids], d.min(1))
            dots = (wn[cs][None, :, 0] * N[:, 0:1] + wn[cs][None, :, 2] * N[:, 1:2])   # (P, T) : normale d'enroulement . normale du segment
            two = two_sided[cs][None, :]
            dpos[ids] = np.minimum(dpos[ids], np.where(two | (dots > 0.2), d, np.inf).min(1))
            dneg[ids] = np.minimum(dneg[ids], np.where(two | (dots < -0.2), d, np.inf).min(1))
    print('distances (%.1f s)' % (time.time() - t0), flush=True)
    # côtés libres
    fpos = nav.free(P[:, 0] + nrm[:, 0] * SIDE_OFF, P[:, 2] + nrm[:, 1] * SIDE_OFF)
    fneg = nav.free(P[:, 0] - nrm[:, 0] * SIDE_OFF, P[:, 2] - nrm[:, 1] * SIDE_OFF)
    holes = {}
    if HIGH:
        col = {}
        for k, key in enumerate(owner):
            if key[0] == 'h':
                col.setdefault((key[1], int(tix[k])), []).append((P[k, 1], dist[k] <= TOL))
        for (i, ti), L in col.items():
            L.sort(); seen = [ok for _, ok in L]
            # trou : une hauteur sans face entre deux hauteurs avec face (au-dessus ET en dessous : le rez-de-chaussée compte, à 0,6 m, vu par les autres points)
            # trou : une hauteur sans face, avec une face en dessous (3 m plus bas) et deux faces au-dessus (3 et 6 m plus haut) : l'inclinaison d'un toit ne s'y trompe pas
            miss = [L[j][0] for j in range(1, len(L) - 2) if not seen[j] and seen[j - 1] and seen[j + 1] and seen[j + 2]]
            if miss:
                holes.setdefault(i, []).append((ti, miss))
    owner_t = [(k, key) for k, key in enumerate(owner) if key[0] != 'h']
    res = {}
    unseen_t = {}   # (seg, t) -> au moins une hauteur sans face
    for k, key in owner_t:
        if key[0] == 's' and dist[k] > TOL:
            unseen_t[(key[1], int(tix[k]))] = True
        r = res.setdefault(key, dict(n=0, bad=0, far=0.0, os_bad=0, os_n=0, side=0, run=0))
        r['n'] += 1; r['bad'] += int(dist[k] > TOL); r['far'] = max(r['far'], float(dist[k]) if np.isfinite(dist[k]) else 99.0)
        if dist[k] <= TOL and key[0] == 's':
            if fpos[k]:
                r['os_n'] += 1; r['os_bad'] += int(dpos[k] > TOL); r['side'] |= 1 if dpos[k] > TOL else 0
            if fneg[k]:
                r['os_n'] += 1; r['os_bad'] += int(dneg[k] > TOL); r['side'] |= 2 if dneg[k] > TOL else 0
    # plus longue portion continue sans face (en mètres) : un mur dont seule une partie est dessinée
    for (kind, i), r in res.items():
        if kind != 's':
            continue
        L = float(np.hypot(segs[i][2] - segs[i][0], segs[i][3] - segs[i][1])); n = r['n'] and max(2, int(np.ceil(L / STEP)) + 1)
        best = cur = 0
        for ti in range(n):
            cur = cur + 1 if unseen_t.get((i, ti)) else 0
            best = max(best, cur)
        r['run'] = best * L / max(n, 1)
    tot_os = sum(r['os_n'] for r in res.values()); tot_bad = sum(r['os_bad'] for r in res.values())
    print('côtés libres testés : %d, face arrière coupée sur %d (%.2f %%)' % (tot_os, tot_bad, 100 * tot_bad / max(tot_os, 1)))
    inv, one = [], []
    for (kind, i), r in res.items():
        if kind == 's':
            ax, az, bx, bz, h, y0, prop, vid, door, off = segs[i]
            L = float(np.hypot(bx - ax, bz - az)); mx, mz = (ax + bx) / 2, (az + bz) / 2
            d = dict(kind='seg', i=i, prop=bool(prop), len=round(L, 2), a=[round(float(ax), 2), round(float(az), 2)], b=[round(float(bx), 2), round(float(bz), 2)],
                     h=None if h > 1e20 else round(float(h), 2), y0=None if y0 < -1e20 else round(float(y0), 2), zone=zones.name(mx, mz), far=round(r['far'], 2), bad=r['bad'], n=r['n'])
        else:
            x, z, rad, h, y0, prop, vid, off = circles[i]
            d = dict(kind='circle', i=i, prop=bool(prop), len=round(float(2 * np.pi * rad), 2), a=[round(float(x), 2), round(float(z), 2)], r=round(float(rad), 2),
                     h=None if h > 1e20 else round(float(h), 2), y0=None if y0 < -1e20 else round(float(y0), 2), zone=zones.name(x, z), far=round(r['far'], 2), bad=r['bad'], n=r['n'])
        d['run'] = round(r['run'], 2)
        if r['bad'] / r['n'] > 0.6 or (kind == 's' and r['run'] >= RUN_MIN and not prop):
            inv.append(d)
        elif kind == 's' and r['os_n'] and r['os_bad'] >= 4 and r['os_bad'] / r['os_n'] > 0.25 and not prop:
            d['side'] = r['side']; one.append(d)
    inv.sort(key=lambda o: -o['len']); one.sort(key=lambda o: -o['len'])
    ci, co = cluster(inv), cluster(one)
    if 'patches' in args:
        pl = make_patches(inv, T, bins, lo, hi, float(args.get('patch-far', 0.5)))
        json.dump(dict(comment='Bouchons visibles des murs invisibles (tools/collision-scan.py --patches) : panneau de (a) à (b), de y0 à y1, dessiné par scenes/world/patch_view.gd ; la collision ne change pas.', walls=pl), open(args['patches'], 'w'), indent=0)
        print('bouchons écrits : %d panneaux dans %s' % (len(pl), args['patches']))
    if 'out' in args:
        json.dump(dict(tol=TOL, invisible=len(inv), one_sided=len(one), items=inv + [dict(o, kind=o['kind']) for o in one], invisible_items=inv, one_sided_items=one, clusters=ci, one_sided_clusters=co), open(args['out'], 'w'))
    walls = [c for c in ci if not c['prop']]
    print('MURS INVISIBLES (aucune face à moins de %.2f m) : %d éléments (%d murs, %d mobilier), %d grappes de mur' % (TOL, len(inv), sum(not o['prop'] for o in inv), sum(o['prop'] for o in inv), len(walls)))
    for c in walls[:TOP]:
        print('  %-3d el. %7.1f m  centre (%7.1f, %7.1f)  h=%s y0=%s  %s  face la plus proche jusqu\'à %.2f m' % (c['n'], c['len'], c['x'], c['z'], c['h'], c['y0'], c['zone'], c['far']))
    print('MURS VUS D\'UN SEUL CÔTÉ LIBRE (face arrière coupée) : %d segments, %d grappes' % (len(one), len(co)))
    for c in co[:TOP]:
        print('  %-3d el. %7.1f m  centre (%7.1f, %7.1f)  h=%s y0=%s  %s' % (c['n'], c['len'], c['x'], c['z'], c['h'], c['y0'], c['zone']))
    if HIGH:
        hi = []
        for i, L in holes.items():
            ax, az, bx, bz = segs[i][:4]; n = max(1, int(np.ceil(np.hypot(bx - ax, bz - az) / 1.2)))
            cols = len(L); ys = sorted(set(round(float(y), 1) for _, m in L for y in m))
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            hi.append(dict(kind='seg', i=i, prop=False, len=round(cols * np.hypot(bx - ax, bz - az) / n, 1), a=[round(float(ax), 2), round(float(az), 2)], b=[round(float(bx), 2), round(float(bz), 2)],
                           h=None, y0=None, zone=zones.name(mx, mz), far=0.0, heights=ys, cols=cols, of=n))
        hi.sort(key=lambda o: -o['len'])
        ch = cluster(hi)
        print('TROUS EN HAUTEUR DE FAÇADE (une hauteur sans face entre deux hauteurs avec face) : %d murs, %d grappes' % (len(hi), len(ch)))
        for c in ch[:TOP]:
            print('  %-3d murs %7.1f m  centre (%7.1f, %7.1f)  %s' % (c['n'], c['len'], c['x'], c['z'], c['zone']))
        if 'out' in args:
            d = json.load(open(args['out'])); d['holes'] = hi; d['hole_clusters'] = ch; json.dump(d, open(args['out'], 'w'))
    print('(%.0f s)' % (time.time() - t0))


main()
