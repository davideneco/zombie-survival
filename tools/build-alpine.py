#!/usr/bin/env python3
"""v0.34.0 : plan de la carte « Station des Aiguilles » (station de ski alpine abandonnée en hiver) du port Godot.

  python3 tools/build-alpine.py            -> godot/data/alpine.json (versionné, ~60 Ko)

Carte entièrement scriptée, sans OpenStreetMap ni cuisson Chrome : ce script est la seule source du plan. Il pose à la main les bâtiments,
les murs de zones, les portes payantes, les machines, les armes murales, les bornes et les véhicules, puis sème (graine fixe : reproductible)
les sapins, les rochers et les fenêtres d'apparition en évitant tout ce qui gêne. Le jeu (sim/alpine_map.gd) en tire la collision, la
grille de navigation, les zones et les fenêtres ; la vue (scenes/world/alpine_view.gd) le décor. Aucune géométrie n'est cuite ici.

Repère du jeu : x vers l'est, z vers le sud (le nord est en -z), y vers le haut, mètres. Zone jouable : 296 x 296 m (falaises à +-148 m),
sol praticable plat à y = 0 (le plateau de la station) ; le relief (montagnes, pistes, ligne du télésiège) est autour, hors d'atteinte.

Six zones : 0 Place du Village (départ), 1 Hôtel du Grand Cerf, 2 Église Saint-Bernard, 3 Gare du Télésiège, 4 Parking du Col, 5 Lac Gelé.
Murs : palissades de rondins (2,6 m), murets de pierre (2,2 m), façades. Un mur de collision = un segment (axe du mur) de hauteur h ;
la vue dessine un pavé d'épaisseur t centré sur ce segment.
"""
import json, math, os, random

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'godot', 'data', 'alpine.json')
EDGE = 148.0          # falaises du pourtour (collision : segments à +-EDGE, hauteur infinie)
rng = random.Random(20341)

R = lambda v: round(v, 3)

walls = []      # {a, b, t, h, k}  k : palisade, stone, log, hotel, church, station, shed, int
solids = []     # bâtiments pleins (non visitables) : {x, z, w, d, h, k, eave, roof}
props = []      # boîtes de collision : {x, z, w, d, rot, h, k}
circles = []    # {x, z, r, h, k}
doors = []
machines = []
wall_weapons = []
stations = []
windows = []    # fenêtres d'apparition : [cx, cz, nx, nz]  (n : vers le côté où le zombie arrive)
lamps = []
trees = []      # [x, z, échelle]
rocks = []      # [x, z, r]
cars = []       # [x, z, yaw, couleur]
buildings = []  # bâtiments visitables (vue : sols, plafonds, étages, toits)
decor = []      # décor sans collision : {k, ...}


def wall(ax, az, bx, bz, t, h, k):
    walls.append({'a': [R(ax), R(az)], 'b': [R(bx), R(bz)], 't': t, 'h': h, 'k': k})


def wall_gaps(ax, az, bx, bz, t, h, k, gaps):
    """Mur rectiligne (horizontal ou vertical) de a à b, interrompu par des ouvertures [(centre, largeur)] le long de l'axe."""
    horiz = az == bz
    lo, hi = (min(ax, bx), max(ax, bx)) if horiz else (min(az, bz), max(az, bz))
    cuts = sorted((c - w / 2, c + w / 2) for c, w in gaps)
    cur = lo
    for c0, c1 in cuts:
        if c0 > cur:
            wall(cur, az, c0, az, t, h, k) if horiz else wall(ax, cur, ax, c0, t, h, k)
        cur = c1
    if hi > cur:
        wall(cur, az, hi, az, t, h, k) if horiz else wall(ax, cur, ax, hi, t, h, k)


def door(name, price, ax, az, bx, bz, k):
    doors.append({'id': len(doors), 'name': name, 'price': price, 'a': [R(ax), R(az)], 'b': [R(bx), R(bz)], 'k': k})


def solid(x, z, w, d, h, k='chalet', eave=None, roof='gable', ridge_x=None):
    """Chalet plein : emprise w (x) x d (z) centrée en (x, z), faîtage à h ; eave : hauteur de l'égout."""
    solids.append({'x': x, 'z': z, 'w': w, 'd': d, 'h': h, 'k': k, 'eave': eave or round(h * 0.55, 2), 'roof': roof,
                   'rx': ridge_x if ridge_x is not None else (w >= d)})


def prop(x, z, w, d, h, k, rot=0.0):
    props.append({'x': R(x), 'z': R(z), 'w': w, 'd': d, 'rot': R(rot), 'h': h, 'k': k})


def circle(x, z, r, h, k):
    circles.append({'x': R(x), 'z': R(z), 'r': r, 'h': h, 'k': k})


def machine(t, mid, x, z, yaw):
    machines.append({'type': t, 'id': mid, 'x': R(x), 'z': R(z), 'yaw': R(yaw)})


FACE_N, FACE_S, FACE_E, FACE_W = math.pi, 0.0, math.pi / 2, -math.pi / 2   # yaw d'une machine dont la face regarde vers le nord (-z), sud, est, ouest


def wall_weapon(wid, face_x, face_z, nx, nz):
    """Arme murale : point d'interaction à 0,66 m devant la face visible du mur (comme realworld.js), n : normale sortante de la face."""
    wall_weapons.append({'id': wid, 'x': R(face_x + nx * 0.66), 'z': R(face_z + nz * 0.66)})


# ------------------------------------------------------------------ murs de zones
PAL_T, PAL_H = 0.4, 2.6
STONE_T, STONE_H = 0.5, 2.2
# nord : muret de pierre z = -55 (portes vers la gare : depuis l'église x = -100, depuis l'hôtel x = 110)
wall_gaps(-EDGE, -55, EDGE, -55, STONE_T, STONE_H, 'stone', [(-100, 3.0), (110, 3.0)])
# sud : palissade z = 45 (portes : lac depuis l'église x = -95, parking depuis la place x = 15)
wall_gaps(-EDGE, 45, EDGE, 45, PAL_T, PAL_H, 'palisade', [(-95, 3.0), (15, 3.0)])
# place | église : palissade x = -40 (porte z = 10)
wall_gaps(-40, -55, -40, 45, PAL_T, PAL_H, 'palisade', [(10, 3.0)])
# place | hôtel : palissade x = 50 au nord et au sud de l'hôtel (sa façade ouest ferme le reste)
wall(50, -55, 50, -30, PAL_T, PAL_H, 'palisade')
wall(50, 2, 50, 45, PAL_T, PAL_H, 'palisade')
# parking | lac : palissade x = -30 (porte z = 100)
wall_gaps(-30, 45, -30, EDGE, PAL_T, PAL_H, 'palisade', [(100, 3.0)])

door('Église Saint-Bernard', 1000, -40, 8.5, -40, 11.5, 'gate')
door('Hôtel du Grand Cerf', 750, 50, -15.5, 50, -12.5, 'hotel')
door('Parking du Col', 1000, 13.5, 45, 16.5, 45, 'gate')
door('Lac Gelé', 1250, -30, 98.5, -30, 101.5, 'gate')
door('Lac Gelé', 1500, -96.5, 45, -93.5, 45, 'gate')
door('Gare du Télésiège', 1500, 108.5, -55, 111.5, -55, 'stone')
door('Gare du Télésiège', 1750, -101.5, -55, -98.5, -55, 'stone')
doors.sort(key=lambda d: d['price'])
for i, d in enumerate(doors):
    d['id'] = i

# ------------------------------------------------------------------ 1. Hôtel du Grand Cerf (visitable : rez-de-chaussée)
HX0, HX1, HZ0, HZ1, HT = 50.0, 86.0, -30.0, 2.0, 0.5
wall_gaps(HX0, HZ0, HX0, HZ1, HT, 16.0, 'hotel', [(-14, 3.0)])            # façade ouest (porte payante)
wall(HX0, HZ0, HX1, HZ0, HT, 16.0, 'hotel')                                  # nord
wall_gaps(HX0, HZ1, HX1, HZ1, HT, 16.0, 'hotel', [(63.5, 3.0)])           # sud (porte du jardin)
wall_gaps(HX1, HZ0, HX1, HZ1, HT, 16.0, 'hotel', [(-14, 3.0)])            # est (terrasse)
buildings.append({'k': 'hotel', 'x0': HX0, 'z0': HZ0, 'x1': HX1, 'z1': HZ1, 't': HT, 'floor': 3.8, 'top': 11.5, 'ridge': 16.0, 'name': 'HÔTEL DU GRAND CERF'})
prop(59, -24.5, 5.0, 1.2, 1.15, 'desk')                  # réception
prop(77, -4.0, 6.0, 1.0, 1.15, 'bar')                    # bar
prop(72, -29.15, 3.2, 1.2, 2.2, 'fireplace')             # cheminée contre le mur nord
prop(68.5, -24.0, 2.2, 0.9, 0.85, 'sofa')
prop(75.5, -24.0, 2.2, 0.9, 0.85, 'sofa')
for px in (62.0, 74.0):
    for pz in (-8.0, -20.0):
        circle(px, pz, 0.35, 3.8, 'pillar')
machine('perk', 'speedcola', 82.5, -27.6, FACE_S)
wall_weapon('mp5', 56.0, HZ0 + HT / 2, 0, 1)              # mur nord, côté intérieur
wall_weapon('ak47', HX1 + HT / 2, -24.0, 1, 0)            # façade est, côté terrasse
windows.extend([[62.0, HZ0, 0, 1], [66.5, HZ0, 0, 1], [56.0, HZ1, 0, -1], [78.0, HZ1, 0, -1]])   # ils entrent dans le hall

# terrasse et jardins de l'hôtel
decor.append({'k': 'pool', 'x': 116, 'z': -12, 'w': 14, 'd': 7})
for i in range(4):
    prop(108 + i * 4.2, -3.5, 0.8, 2.0, 0.45, 'lounger')   # (bas : 0,45 m, on les contourne)
machine('perk', 'juggernog', 104.0, 26.0, FACE_N)
machine('perk', 'tombstone', 62.0, 30.0, FACE_E)
machine('box', None, 132.0, -34.0, FACE_S)
stations.append([96.0, -44.0])
solid(126, 20, 10, 8, 8.5, 'chalet')
solid(138, -36, 8, 10, 7.5, 'chalet')

# ------------------------------------------------------------------ 0. Place du Village (départ)
START = [5.0, 14.0, math.pi]
circle(5, -4, 1.9, 1.2, 'fountain')                       # fontaine gelée
circle(5, 22, 0.6, 9.0, 'xmas_tree')                      # grand sapin décoré
solid(-24, -44, 12, 9, 9.0, 'chalet')
solid(-4, -45, 10, 9, 8.5, 'chalet')
solid(18, -44, 12, 9, 9.5, 'chalet')
solid(38, -42, 8, 10, 8.0, 'chalet', ridge_x=False)
solid(-30, -16, 9, 12, 8.5, 'chalet', ridge_x=False)
solid(-26, 33, 12, 8, 8.0, 'chalet')
solid(38, 33, 10, 8, 8.5, 'chalet')
solid(38, 14, 8, 9, 7.5, 'shop')                          # location de skis
machine('perk', 'quickrevive', -21.0, -38.3, FACE_S)
machine('box', None, 22.0, 26.0, FACE_N)
wall_weapon('m1911', -2.0, -40.5, 0, 1)                   # chalet nord (face sud z = -40,5)
wall_weapon('shotgun', 34.0, 14.0, -1, 0)                 # location de skis (face ouest x = 34)
stations.append([-10.0, 26.0])
for x in (-15.0, 25.0):
    for z in (-28.0, 4.0, 30.0):
        lamps.append([x, z])
for i in range(5):
    prop(42.6, 16.5 - i * 1.0, 0.5, 0.6, 1.4, 'skis')    # râteliers de skis contre la boutique : ils bloquent
decor.append({'k': 'plaza', 'x': 5, 'z': 0, 'r': 24})

# ------------------------------------------------------------------ 2. Église Saint-Bernard (visitable)
CX0, CX1, CZ0, CZ1, CT = -100.0, -74.0, -8.0, 8.0, 0.8
wall(CX0, CZ0, CX0, CZ1, CT, 14.0, 'church')                                   # chevet (ouest)
wall(CX0, CZ0, CX1, CZ0, CT, 14.0, 'church')                                   # nord
wall_gaps(CX0, CZ1, CX1, CZ1, CT, 14.0, 'church', [(-88.8, 2.4)])              # sud (porte latérale)
wall_gaps(CX1, CZ0, CX1, CZ1, CT, 14.0, 'church', [(0.0, 3.0)])                # façade est (portail)
buildings.append({'k': 'church', 'x0': CX0, 'z0': CZ0, 'x1': CX1, 'z1': CZ1, 't': CT, 'floor': 8.0, 'top': 8.0, 'ridge': 14.0, 'name': 'ÉGLISE SAINT-BERNARD'})
solid(-71.0, -11.0, 6.0, 6.0, 26.0, 'tower', eave=22.0, roof='spire')         # clocher (au nord-est de la nef)
for i in range(6):
    for side in (-1, 1):
        prop(-93.0 + i * 2.6, side * 3.8, 0.6, 3.6, 0.95, 'pew')
prop(-97.2, 0.0, 1.2, 2.6, 1.1, 'altar')
machine('clock', None, -96.6, -5.0, FACE_E)                                    # la cloche : lance la finale
windows.extend([[-92.0, CZ0 + CT / 2, 0, 1], [-82.0, CZ0 + CT / 2, 0, 1], [-95.0, CZ1 - CT / 2, 0, -1], [-80.0, CZ1 - CT / 2, 0, -1]])   # mur épais : centre sur la face intérieure
# cimetière (au sud de l'église)
for i in range(4):
    for j in range(4):
        x = -97.0 + i * 5.2 + rng.uniform(-0.4, 0.4)
        z = 17.0 + j * 4.6 + rng.uniform(-0.3, 0.3)
        prop(x, z, 0.8, 0.28, 1.05, 'grave', rot=rng.uniform(-0.1, 0.1))
decor.append({'k': 'cemetery', 'x0': -100, 'z0': 14, 'x1': -78, 'z1': 34})
solid(-126, -36, 12, 9, 9.0, 'chalet')                                         # presbytère
solid(-62, 30, 9, 8, 8.0, 'chalet')
solid(-130, 12, 9, 11, 8.0, 'chalet', ridge_x=False)
machine('perk', 'doubletap', -56.0, -44.0, FACE_S)
machine('perk', 'widowswine', -118.0, 33.0, FACE_N)
machine('box', None, -132.0, -12.0, FACE_E)
wall_weapon('rifle', -126.0, -31.5, 0, 1)                                      # presbytère, face sud
wall_weapon('famas', -66.5, 30.0, -1, 0)                                      # chalet, face ouest
stations.append([-60.0, -20.0])
lamps += [[-60.0, 4.0], [-66.0, -30.0], [-110.0, 40.0]]

# ------------------------------------------------------------------ 3. Gare du Télésiège (visitable)
SX0, SX1, SZ0, SZ1, ST = -12.0, 18.0, -112.0, -92.0, 0.5
wall_gaps(SX0, SZ1, SX1, SZ1, ST, 9.0, 'station', [(3.0, 10.0)])              # sud : grande baie
wall_gaps(SX0, SZ0, SX1, SZ0, ST, 9.0, 'station', [(3.0, 12.0)])              # nord : sortie du câble
wall_gaps(SX0, SZ0, SX0, SZ1, ST, 9.0, 'station', [(-102.0, 3.0)])            # ouest (porte)
wall(SX1, SZ0, SX1, SZ1, ST, 9.0, 'station')                                   # est
buildings.append({'k': 'station', 'x0': SX0, 'z0': SZ0, 'x1': SX1, 'z1': SZ1, 't': ST, 'floor': 7.0, 'top': 7.0, 'ridge': 9.0, 'name': 'GARE DU TÉLÉSIÈGE'})
prop(3.0, -104.5, 4.0, 4.0, 3.2, 'bullwheel')             # massif de la poulie motrice
prop(-7.5, -96.5, 2.6, 2.2, 2.6, 'booth')                 # guichet
machine('pap', None, 14.0, -106.0, FACE_W)
wall_weapon('m249', SX1 + ST / 2, -98.0, 1, 0)            # façade est, dehors
windows.extend([[-4.0, SZ1, 0, -1], [12.5, SZ1, 0, -1], [SX1, -97.0, -1, 0]])
for z in (-126.0, -141.0):                                # pylônes du télésiège (le reste monte la pente, hors carte)
    circle(3.0, z, 0.55, 12.0, 'pylon')
decor.append({'k': 'lift', 'x': 3.0, 'z0': -104.5, 'z1': -420.0})
prop(-52.0, -80.0, 2.8, 5.4, 2.9, 'snowcat', rot=0.35)    # dameuse garée
solid(62, -80, 9, 7, 7.5, 'chalet')                       # poste des pisteurs
solid(-70, -122, 10, 8, 8.0, 'chalet')
solid(110, -118, 12, 9, 8.5, 'chalet')
machine('perk', 'staminup', 44.0, -96.0, FACE_W)
machine('perk', 'phdflopper', -38.0, -128.0, FACE_E)
machine('perk', 'mulekick', 84.0, -70.0, FACE_S)
machine('box', None, 40.0, -130.0, FACE_N)
wall_weapon('barrett', 62.0, -76.5, 0, 1)                 # poste des pisteurs, face sud
stations.append([-24.0, -88.0])
lamps += [[-7.0, -86.0], [-30.0, -70.0], [40.0, -70.0], [110.0, -70.0], [-100.0, -70.0]]

# ------------------------------------------------------------------ 4. Parking du Col
decor.append({'k': 'lot', 'x0': 12, 'z0': 64, 'x1': 96, 'z1': 124})
decor.append({'k': 'road', 'pts': [[15, 45], [15, 64], [54, 128], [148, 130]], 'w': 7})
colors = ['#8a1f1f', '#1f3a6a', '#d8d8d4', '#2e2e30', '#5a6a3a', '#9a9aa0', '#6a2a5a', '#c4a040']
for row, z in enumerate((76.0, 96.0, 116.0)):
    for i in range(9):
        if rng.random() < 0.25:
            continue
        x = 22.0 + i * 3.4 + (8.0 if i >= 5 else 0.0)
        cars.append([R(x + rng.uniform(-0.2, 0.2)), R(z + rng.uniform(-0.3, 0.3)), R(math.pi / 2 + rng.uniform(-0.06, 0.06) + (math.pi if row == 1 else 0)), colors[rng.randrange(len(colors))]])
# remise des motoneiges : ouverte au sud
GX0, GX1, GZ0, GZ1 = 100.0, 116.0, 54.0, 63.0
wall(GX0, GZ0, GX1, GZ0, 0.3, 4.2, 'shed')
wall(GX0, GZ0, GX0, GZ1, 0.3, 4.2, 'shed')
wall(GX1, GZ0, GX1, GZ1, 0.3, 4.2, 'shed')
buildings.append({'k': 'shed', 'x0': GX0, 'z0': GZ0, 'x1': GX1, 'z1': GZ1, 't': 0.3, 'floor': 3.6, 'top': 3.6, 'ridge': 4.2, 'name': 'REMISE'})
vehicles = [{'type': 'grosseMoto', 'model': 'motoneige', 'x': 104.0, 'z': 59.0, 'yaw': 0.0}, {'type': 'grosseMoto', 'model': 'motoneige', 'x': 111.5, 'z': 59.0, 'yaw': 0.0}]
parking = {'name': 'Remise des motoneiges', 'x': 108.0, 'z': 66.0, 'yaw': 0.0, 'pump': {'x': 119.5, 'z': 62.0, 'yaw': None}, 'sign': {'x': 97.5, 'z': 64.5, 'yaw': None}, 'size': 2}
circle(140.0, 130.0, 5.5, 6.0, 'avalanche')               # coulée de neige : la route du col est coupée
solid(-12, 82, 10, 8, 8.0, 'cafe')                        # café du Col
solid(128, 96, 10, 9, 8.5, 'chalet')
solid(60, 140, 9, 7, 7.0, 'chalet')
prop(40.0, 51.85, 4.0, 0.3, 2.6, 'shelter')               # abribus (collision : la paroi du fond ; toit au-dessus des têtes)
machine('perk', 'deadshot', 80.0, 134.0, FACE_W)
machine('box', None, 120.0, 112.0, FACE_W)
wall_weapon('smg', GX0 - 0.15, 59.0, -1, 0)               # remise, face ouest
wall_weapon('m79', -7.0, 82.0, 1, 0)                      # café, face est
stations.append([60.0, 56.0])
lamps += [[30.0, 66.0], [70.0, 66.0], [30.0, 124.0], [80.0, 126.0], [118.0, 128.0]]

# ------------------------------------------------------------------ 5. Lac Gelé
decor.append({'k': 'lake', 'x': -95.0, 'z': 108.0, 'rx': 30.0, 'rz': 22.0})
RX0, RX1, RZ0, RZ1, RT = -60.0, -46.0, 56.0, 66.0, 0.4
wall_gaps(RX0, RZ0, RX1, RZ0, RT, 6.5, 'log', [(-53.0, 2.4)])                # nord (porte)
wall_gaps(RX0, RZ1, RX1, RZ1, RT, 6.5, 'log', [(-56.5, 2.4)])                # sud (vers le lac)
wall(RX0, RZ0, RX0, RZ1, RT, 6.5, 'log')
wall(RX1, RZ0, RX1, RZ1, RT, 6.5, 'log')
buildings.append({'k': 'refuge', 'x0': RX0, 'z0': RZ0, 'x1': RX1, 'z1': RZ1, 't': RT, 'floor': 3.0, 'top': 3.0, 'ridge': 6.5, 'name': 'REFUGE DU LAC'})
prop(-59.1, 61.0, 1.0, 2.4, 2.0, 'fireplace', rot=0.0)
prop(-52.0, 63.6, 2.2, 1.0, 0.8, 'table')
machine('perk', 'electriccherry', -48.0, 59.5, FACE_W)
wall_weapon('sniper', RX1 + RT / 2, 62.5, 1, 0)           # refuge, face est
windows.extend([[RX0, 58.5, 1, 0], [-50.0, RZ1, 0, -1]])
decor.append({'k': 'pier', 'x': -70.0, 'z': 92.0, 'w': 2.4, 'd': 12.0})
solid(-122, 62, 10, 8, 8.0, 'chalet')
solid(-136, 138, 9, 7, 7.0, 'chalet')
machine('box', None, -108.0, 60.0, FACE_S)
wall_weapon('crossbow', -122.0, 66.0, 0, 1)               # chalet, face sud
stations.append([-40.0, 132.0])
lamps += [[-70.0, 58.0], [-120.0, 80.0]]

# ------------------------------------------------------------------ fenêtres des chalets pleins (ils en sortent)
def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return math.hypot(px - ax - dx * t, pz - az - dz * t)


def box_pts(x, z, w, d, rot):
    c, s = math.cos(rot), math.sin(rot)
    return [(x + px * c - pz * s, z + px * s + pz * c) for px, pz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


def clear(px, pz, r, skip_solid=None):
    """Distance libre minimale du point aux obstacles connus (murs, pleins, boîtes, cercles, bord)."""
    if abs(px) > EDGE - r or abs(pz) > EDGE - r:
        return False
    for w in walls:
        if seg_dist(px, pz, *w['a'], *w['b']) < r + w['t'] / 2:
            return False
    for d in doors:
        if seg_dist(px, pz, *d['a'], *d['b']) < r:
            return False
    for i, s in enumerate(solids):
        if i == skip_solid:
            continue
        if abs(px - s['x']) < s['w'] / 2 + r and abs(pz - s['z']) < s['d'] / 2 + r:
            return False
    for p in props:
        pts = box_pts(p['x'], p['z'], p['w'], p['d'], p['rot'])
        if math.hypot(px - p['x'], pz - p['z']) < math.hypot(p['w'], p['d']) / 2 + r:
            for k in range(4):
                if seg_dist(px, pz, *pts[k], *pts[(k + 1) % 4]) < r:
                    return False
            # dedans ?
            c, s = math.cos(-p['rot']), math.sin(-p['rot'])
            lx = (px - p['x']) * c - (pz - p['z']) * s
            lz = (px - p['x']) * s + (pz - p['z']) * c
            if abs(lx) < p['w'] / 2 and abs(lz) < p['d'] / 2:
                return False
    for c in circles:
        if math.hypot(px - c['x'], pz - c['z']) < c['r'] + r:
            return False
    for c in cars:
        if math.hypot(px - c[0], pz - c[1]) < 2.4 + r:
            return False
    return True


for i, s in enumerate(solids):
    if s['k'] == 'tower':
        continue
    for nx, nz, length, along in ((0, 1, s['w'], 'x'), (0, -1, s['w'], 'x'), (1, 0, s['d'], 'z'), (-1, 0, s['d'], 'z')):
        fx = s['x'] + nx * s['w'] / 2
        fz = s['z'] + nz * s['d'] / 2
        for f in (-0.27, 0.27):
            cx = fx + (f * length if along == 'x' else 0)
            cz = fz + (f * length if along == 'z' else 0)
            ox, oz = cx + nx * 1.1, cz + nz * 1.1
            if clear(ox, oz, 0.95) and clear(cx + nx * 2.5, cz + nz * 2.5, 0.8):
                too_close = any(math.hypot(ww['x'] - cx, ww['z'] - cz) < 2.2 for ww in wall_weapons) or \
                    any(math.hypot(m['x'] - ox, m['z'] - oz) < 3.0 for m in machines)
                if not too_close:
                    windows.append([R(cx), R(cz), nx, nz])

# ------------------------------------------------------------------ sapins et rochers (semés, graine fixe)
reserved = []   # [x, z, r] : ni arbre ni rocher
reserved += [[m['x'], m['z'], 4.0] for m in machines] + [[w['x'], w['z'], 3.0] for w in wall_weapons] + [[s[0], s[1], 3.5] for s in stations]
reserved += [[(d['a'][0] + d['b'][0]) / 2, (d['a'][1] + d['b'][1]) / 2, 6.0] for d in doors]
reserved += [[w[0] + w[2] * 1.1, w[1] + w[3] * 1.1, 2.5] for w in windows]
reserved += [[START[0], START[1], 8.0], [5.0, 0.0, 26.0], [108.0, 62.0, 9.0], [3.0, -88.0, 10.0], [3.0, -126.0, 4.0], [3.0, -141.0, 4.0]]
reserved += [[l[0], l[1], 2.0] for l in lamps]


def in_rect(x, z, x0, z0, x1, z1, m=0.0):
    return x0 - m <= x <= x1 + m and z0 - m <= z <= z1 + m


def free_for_tree(x, z):
    for rx, rz, rr in reserved:
        if math.hypot(x - rx, z - rz) < rr:
            return False
    for b in buildings:
        if in_rect(x, z, b['x0'], b['z0'], b['x1'], b['z1'], 3.5):
            return False
    if in_rect(x, z, 10, 62, 98, 126, 2.0):                       # parking
        return False
    if ((x + 95.0) / 33.0) ** 2 + ((z - 108.0) / 25.0) ** 2 < 1.0:  # lac
        return False
    if in_rect(x, z, -102, 12, -76, 36):                          # cimetière
        return False
    if in_rect(x, z, 106, -20, 126, -2):                          # piscine, transats
        return False
    for a, b in ((( 15, 45), (15, 64)), ((15, 64), (54, 128)), ((54, 128), (148, 130))):   # route
        if seg_dist(x, z, *a, *b) < 6.0:
            return False
    if abs(x - 3.0) < 4.0 and z < -110:                           # sous le télésiège
        return False
    return clear(x, z, 2.2)


n_try = 0
while len(trees) < 170 and n_try < 20000:
    n_try += 1
    x = rng.uniform(-EDGE + 3, EDGE - 3)
    z = rng.uniform(-EDGE + 3, EDGE - 3)
    if in_rect(x, z, -40, -55, 50, 45) and rng.random() < 0.8:    # la place reste dégagée
        continue
    if any(math.hypot(x - t[0], z - t[1]) < 4.2 for t in trees):
        continue
    if free_for_tree(x, z):
        s = R(rng.uniform(0.75, 1.35))
        trees.append([R(x), R(z), s])
        circle(x, z, round(0.42 * s, 3), 9.0 * s, 'fir')
for _ in range(14):
    for _k in range(200):
        x = rng.uniform(-EDGE + 4, EDGE - 4)
        z = rng.uniform(-EDGE + 4, EDGE - 4)
        r = R(rng.uniform(0.9, 1.8))
        if free_for_tree(x, z) and clear(x, z, r + 2.0):
            rocks.append([R(x), R(z), r])
            circle(x, z, r, R(r * 0.9), 'rock')
            break

zones = [
    {'name': 'Place du Village', 'seed': [5.0, 12.0]},
    {'name': 'Hôtel du Grand Cerf', 'seed': [118.0, 8.0]},
    {'name': 'Église Saint-Bernard', 'seed': [-60.0, -10.0]},
    {'name': 'Gare du Télésiège', 'seed': [3.0, -80.0]},
    {'name': 'Parking du Col', 'seed': [50.0, 86.0]},
    {'name': 'Lac Gelé', 'seed': [-95.0, 108.0]},
]

out = {
    'version': 1,
    'title': 'STATION DES AIGUILLES — HIVER',
    'edge': EDGE, 'half': 150.0,
    'start': [R(v) for v in START], 'startZone': 0,
    'zones': zones,
    'walls': walls, 'solids': solids, 'props': props, 'circles': circles, 'doors': doors,
    'windows': windows, 'machines': machines, 'wallWeapons': wall_weapons, 'stations': stations,
    'vehicles': vehicles, 'parking': parking, 'lamps': lamps, 'trees': trees, 'rocks': rocks, 'cars': cars,
    'buildings': buildings, 'decor': decor,
    'knightZone': 'Gare du Télésiège', 'pestZones': ['Lac Gelé', 'Église Saint-Bernard'], 'tannerZones': ['Lac Gelé', 'Gare du Télésiège', 'Parking du Col'],
}
with open(OUT, 'w') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print('%s : %d murs, %d pleins, %d boîtes, %d cercles (%d sapins, %d rochers), %d portes, %d fenêtres, %d machines, %d armes murales, %d bornes, %d voitures, %d lampadaires, %.1f Ko' % (
    os.path.relpath(OUT, ROOT), len(walls), len(solids), len(props), len(circles), len(trees), len(rocks), len(doors), len(windows), len(machines), len(wall_weapons), len(stations), len(cars), len(lamps), os.path.getsize(OUT) / 1024))
