#!/usr/bin/env python3
"""Emballe les textures PBR de godot/assets/pbr_src/<nom>/ (tools/download-textures.mjs --godot) pour les shaders du port :
  <nom>/a.png : albedo RGB (normalisé : la luminance moyenne est ramenée à 0,5 pour servir de DÉTAIL multiplicatif sur la couleur dessinée)
  <nom>/m.png : R = normale x, G = normale y (convention OpenGL, z reconstruit dans le shader), B = rugosité, A = occlusion ambiante
Les .png sont importés par Godot (compression VRAM BPTC, mipmaps) : voir les .import versionnés.   python3 tools/pack-pbr.py
"""
import os, sys, numpy as np
from PIL import Image
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'godot', 'assets', 'pbr_src')
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'godot', 'assets', 'pbr')
for name in sorted(os.listdir(SRC)):
    d = os.path.join(SRC, name)
    out_dir = os.path.join(ROOT, name); os.makedirs(out_dir, exist_ok=True)
    if not os.path.isdir(d) or not os.path.exists(os.path.join(d, 'diff.jpg')):
        continue
    ld = lambda f, mode='RGB': Image.open(os.path.join(d, f)).convert(mode) if os.path.exists(os.path.join(d, f)) else None
    diff = ld('diff.jpg'); nor = ld('nor.jpg'); rough = ld('rough.jpg', 'L'); ao = ld('ao.jpg', 'L')
    size = diff.size
    a = np.asarray(diff, np.float32) / 255.0
    desat = {'wood_beam': 1.0, 'wood_door': 1.0, 'roof_clay': 0.6}.get(name, 0.0)   # bois et tuiles : peu de teinte utile (la couleur dessinée domine), la variation de luminance seule
    if desat > 0:
        g = (a * [0.299, 0.587, 0.114]).sum(2, keepdims=True)
        a = a * (1 - desat) + g * desat
    # moyenne LINÉAIRE de chaque canal ramenée à 0,5 (le shader lit l'image en sRGB -> linéaire puis multiplie par 2) : ne reste que la variation (teintes, taches),
    # la couleur dessinée garde sa dominante et sa luminosité
    lin = lambda x: np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    k = np.ones(3, np.float32)
    for c in range(3):
        lo, hi = 0.05, 20.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if lin(np.clip(a[..., c] * mid, 0, 1)).mean() < 0.5: lo = mid
            else: hi = mid
        k[c] = (lo + hi) / 2
    lum = float((a.reshape(-1, 3).mean(0) * [0.299, 0.587, 0.114]).sum())
    out = Image.fromarray((np.clip(a * k, 0, 1) * 255 + 0.5).astype(np.uint8))
    out.save(os.path.join(out_dir, 'a.png'))
    n = np.asarray(nor.resize(size), np.uint8) if nor else np.full((size[1], size[0], 3), (128, 128, 255), np.uint8)
    r = np.asarray(rough.resize(size), np.uint8) if rough else np.full((size[1], size[0]), 200, np.uint8)
    o = np.asarray(ao.resize(size), np.uint8) if ao else np.full((size[1], size[0]), 255, np.uint8)
    m = np.dstack([n[..., 0], n[..., 1], r, o])
    Image.fromarray(m, 'RGBA').save(os.path.join(out_dir, 'm.png'))
    print('%s : %dx%d, luminance moyenne %.3f, gain par canal %s' % (name, size[0], size[1], lum, np.round(k, 2)))
