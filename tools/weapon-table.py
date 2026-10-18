#!/usr/bin/env python3
"""J15 : complète godot/data/weapon_models.json pour les modèles ajoutés par tools/build-weapons.py et recalcule, pour TOUTES les armes,
le centrage latéral (offset[0]) et la hauteur de mire (sight, m) lus dans les OBJ ; hip / ads viennent de HIP_ADS ci-dessous.
Usage : python3 tools/weapon-table.py"""
import json, os, statistics
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'godot')
TAB = os.path.join(ROOT, 'data', 'weapon_models.json')
DIR = os.path.join(ROOT, 'assets', 'weapons')

# nouveaux modèles : fichier, longueur (m), position de la poignée depuis l'arrière (m)
NEW = {
    'm1911':    ('Tabasco_M1911.obj', 0.24, 0.048),
    'ak47':     ('Tabasco_AK47.obj', 0.595, 0.268),
    'rifle':    ('Tabasco_M4.obj', 0.561, 0.252),
    'svd':      ('Tabasco_Dragunov.obj', 0.782, 0.352),
    'raygun':   ('Kenney_Raygun.obj', 0.30, 0.07),
    'barrett':  ('Barrett.obj', 1.00, 0.25),
    'm79':      ('M79.obj', 0.56, 0.36),
    'crossbow': ('Crossbow.obj', 0.56, 0.22),
}
# position de la vue par défaut (caméra) ; ADS : x = 0, y = -hauteur de mire, z choisi par arme
HIP_DEFAULT = (0.22, -0.2, -0.45)
ADS_REAR = 0.20   # en visée, l'arrière du modèle est à 0,20 m de la caméra (ni crosse dans le nez, ni arme trop loin)
# réglages à la main (id -> {hip, ads_dy, ads_z}) après relecture des captures
TWEAK = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weapon-tweaks.json'))) if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'weapon-tweaks.json')) else {}

def verts(f):
    return [tuple(map(float, l.split()[1:4])) for l in open(os.path.join(DIR, f)) if l.startswith('v ')]

def measure(f):
    v = verts(f)
    xs = [p[0] for p in v]; mx, mn = max(xs), min(xs); L = mx - mn
    front = [p[1] for p in v if p[0] > mx - 0.06 * L]
    return {'L': L, 'muzzle_y': statistics.median(front), 'top': max(p[1] for p in v), 'zc': (min(p[2] for p in v) + max(p[2] for p in v)) / 2}

data = json.load(open(TAB))
cfg = json.load(open(os.path.join(ROOT, 'data', 'config.json')))['CONFIG']['weapons']
for wid, (f, length, grip) in NEW.items():
    m = measure(f)
    old = data['models'].get(wid, {})
    data['models'][wid] = {'file': f, 'length': length, 'muzzle_y': round(m['muzzle_y'], 3), 'offset': [0, 0, 0], 'accessories': [], 'grip': grip}
for wid, e in data['models'].items():
    m = measure(e['file'])
    s = e['length'] / m['L']
    e['offset'] = [round(-m['zc'] * s, 4), 0, 0]
    e['sight'] = round((m['top'] - e['muzzle_y']) * s, 4)
    cat = cfg[wid]['cat']
    tw = TWEAK.get(wid, {})
    e['hip'] = tw.get('hip', list(HIP_DEFAULT))
    e['ads'] = [0.0, round(-e['sight'] + tw.get('ads_dy', 0.0), 4), tw.get('ads_z', round(-(e['grip'] + ADS_REAR), 3))]
json.dump(data, open(TAB, 'w'), indent=1, ensure_ascii=False)
print('ok', len(data['models']), 'armes')
