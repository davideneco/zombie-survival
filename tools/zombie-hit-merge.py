#!/usr/bin/env python3
"""Fusionne la ligne HITJSON de tools/measure-zombie-hit.gd dans godot/data/zombie_models.json (clé "hit" de chaque modèle).
Usage : godot --headless --path godot -s ../tools/measure-zombie-hit.gd > mesure.txt ; python3 tools/zombie-hit-merge.py mesure.txt"""
import json, re, sys

PATH = "godot/data/zombie_models.json"
line = next(l for l in open(sys.argv[1], encoding="utf-8", errors="replace") if l.startswith("HITJSON "))
hit = json.loads(line[len("HITJSON "):])
data = json.load(open(PATH, encoding="utf-8"))
for model, anims in hit.items():
    e = data["models"][model]
    e.pop("head_center", None)
    e.pop("head_radius", None)
    e["hit"] = anims
text = json.dumps(data, indent=2, ensure_ascii=False)
text = re.sub(r"\[\s+([-0-9.e]+(?:,\s+[-0-9.e]+)*)\s+\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]", text)
open(PATH, "w", encoding="utf-8").write(text + "\n")
print("ok :", {m: len(a) for m, a in hit.items()})
