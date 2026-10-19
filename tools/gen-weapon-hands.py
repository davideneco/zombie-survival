#!/usr/bin/env python3
"""Calcule la position des mains (bras en vue première personne) de chaque arme et l'écrit dans godot/data/weapon_models.json (clé "hands").
Mesure le maillage de l'arme (OBJ) dans le repère de l'arme de la vue : origine à la poignée, canon vers -Z, ligne de canon à y = 0, x à droite
(même transformation que scenes/weapon_models.gd build()). Usage : python3 tools/gen-weapon-hands.py   (depuis la racine du dépôt ; idempotent).

Pour chaque arme :
  style : "pistol" (une main sur la poignée, l'autre en soutien dessous) ou "rifle" (main arrière sur la poignée, main avant sur le garde-main) ;
  rear  : { pos } point de la poignée tenu par la main droite (centre de la poignée) ;
  front : { pos, r } point de l'axe du garde-main (ou du dessous de la poignée pour un pistolet) tenu par la main gauche, r = demi-épaisseur ;
  mag   : où la main gauche va chercher le chargeur au rechargement.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "godot" / "data" / "weapon_models.json"
DIR = ROOT / "godot" / "assets" / "weapons"
CONFIG = ROOT / "src" / "config.js"

FRONT_FRAC = {"ar": 0.55, "smg": 0.5, "mg": 0.5, "sniper": 0.5, "shotgun": 0.55, "special": 0.5}
PISTOLS = {"pistol"}
PISTOL_IDS = {"raygun"}   # cat « special » mais tenu comme un pistolet


def cats():
    text = CONFIG.read_text(encoding="utf-8")
    return {m.group(1): m.group(2) for m in re.finditer(r"id: '(\w+)', cat: '(\w+)'", text)}


def vertices(path: Path) -> np.ndarray:
    vs = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("v "):
            vs.append([float(x) for x in line.split()[1:4]])
    return np.array(vs)


def weapon_frame(e: dict, v: np.ndarray) -> np.ndarray:
    """Sommets du modèle principal dans le repère de l'arme (m) : w = TURN * ((v - pivot) * s) + offset, TURN : +X -> -Z, +Z -> +X."""
    s = float(e["length"]) / (v[:, 0].max() - v[:, 0].min())
    pivot = np.array([v[:, 0].min() + float(e["grip"]) / s, float(e["muzzle_y"]), 0.0])
    o = e["offset"]
    a = (v - pivot) * s
    return np.stack([a[:, 2] + o[0], a[:, 1] + o[1], -a[:, 0] + o[2]], axis=1)


def zslice(w: np.ndarray, z0: float, win: float) -> np.ndarray:
    """Sommets à moins de `win` de z0 ; la fenêtre s'élargit tant qu'il y en a moins de 8 (maillage grossier)."""
    sl = w[np.abs(w[:, 2] - z0) < win]
    while len(sl) < 8:
        win *= 1.5
        sl = w[np.abs(w[:, 2] - z0) < win]
    return sl


def r3(x):
    return [round(float(c), 4) for c in x]


def hands(wid: str, e: dict, cat: str) -> dict:
    w = weapon_frame(e, vertices(DIR / e["file"]))
    front_len = float(e["length"]) - float(e["grip"])   # origine -> bouche
    style = "pistol" if (cat in PISTOLS or wid in PISTOL_IDS) else "rifle"
    # main arrière : tranche autour de la poignée (z ~ 0)
    sl = zslice(w, 0.0, 0.02)
    ymin = float(sl[:, 1].min())
    xc = float(sl[:, 0].mean())
    ry = float(np.clip(ymin + 0.045, ymin + 0.03, -0.02))
    ry = float(np.clip(ry, -0.11, -0.035))   # la poignée est sous le canon : jamais au chargeur d'une mitrailleuse (boîte sous le boîtier)
    rear = {"pos": r3([xc, ry, 0.0])}
    # chargeur : point le plus bas entre la bouche * 0.45 et l'arrière
    zone = w[(w[:, 2] > -0.45 * front_len) & (w[:, 2] < 0.1)]
    low = zone[zone[:, 1] < zone[:, 1].min() + 0.012]
    mag = r3([float(low[:, 0].mean()), float(zone[:, 1].min()) - 0.02, float(low[:, 2].mean())])
    if style == "pistol":
        # main de soutien : dessous de la poignée, un peu en avant
        front = {"pos": r3([xc, ymin + 0.012, -0.012]), "r": 0.014}
    else:
        frac = FRONT_FRAC.get(cat, 0.5)
        zf = -frac * front_len
        s2 = zslice(w, zf, 0.03)
        lo = float(np.percentile(s2[:, 1], 4))
        hi = float(np.percentile(s2[:, 1], 96))
        front = {"pos": r3([float(s2[:, 0].mean()), (lo + hi) / 2.0, zf]), "r": round(max(0.012, min(0.03, (hi - lo) / 2.0)), 4)}
    return {"style": style, "rear": rear, "front": front, "mag": mag}


def main() -> None:
    data = json.loads(TABLE.read_text(encoding="utf-8"))
    c = cats()
    for wid, e in data["models"].items():
        e["hands"] = hands(wid, e, c.get(wid, "special"))
        h = e["hands"]
        print("%-9s %-6s rear %s front %s r=%s mag %s" % (wid, h["style"], h["rear"]["pos"], h["front"]["pos"], h["front"]["r"], h["mag"]))
    TABLE.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print("ok :", len(data["models"]), "armes")


if __name__ == "__main__":
    sys.exit(main())
