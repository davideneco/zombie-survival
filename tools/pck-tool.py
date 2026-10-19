#!/usr/bin/env python3
"""Outil .pck Godot 4 (format 2 à 4, non chiffré), sans dépendance.
  python3 -I tools/pck-tool.py list <fichier.pck>                         : taille<TAB>chemin de chaque entrée
  python3 -I tools/pck-tool.py stage <fichier.pck> <dossier> <manifeste>   : extrait le pack dans <dossier> (neuf) et écrit le manifeste
                                                                             « chemin dans le pack<TAB>fichier extrait » (entrée de tools/pck-pack.gd)
  python3 -I tools/pck-tool.py add <dossier_projet> <manifeste> <rel>...  : ajoute au manifeste les fichiers des dossiers <rel> (relatifs au projet)
                                                                             absents du pack : ceux que Godot n'exporte pas (dossiers .gdignore)
Le pack peut venir d'une source non fiable : les chemins absolus ou avec « .. » sont refusés."""
import os
import struct
import sys

def entries(path):
    with open(path, "rb") as f:
        if f.read(4) != b"GDPC":
            raise SystemExit("pas un .pck Godot (magic GDPC absent)")
        fmt, _maj, _min, _pat, flags = struct.unpack("<5I", f.read(20))
        base = 0
        if fmt >= 2:
            base = struct.unpack("<Q", f.read(8))[0]
            if fmt >= 3:
                dir_off = struct.unpack("<Q", f.read(8))[0]
                f.seek(dir_off)
            else:
                f.read(64)
        else:
            f.read(64)
        n = struct.unpack("<I", f.read(4))[0]
        out = []
        for _ in range(n):
            ln = struct.unpack("<I", f.read(4))[0]
            name = f.read(ln).rstrip(b"\0").decode("utf-8")
            off, size = struct.unpack("<QQ", f.read(16))
            f.read(16)
            fl = struct.unpack("<I", f.read(4))[0]
            if fl & 1:
                raise SystemExit("pack chiffré : non pris en charge")
            out.append((name.removeprefix("res://"), (base if flags & 2 else 0) + off, size))
        return out

def safe(name):
    if name.startswith("/") or ".." in name.split("/") or "\\" in name or ":" in name:
        raise SystemExit("chemin refusé dans le pack : " + name)
    return name

def main(argv):
    if len(argv) >= 3 and argv[1] == "list":
        for name, _off, size in entries(argv[2]):
            print(f"{size}\t{name}")
    elif len(argv) == 5 and argv[1] == "stage":
        pck, dest, manifest = argv[2:5]
        os.makedirs(dest, exist_ok=False)
        with open(pck, "rb") as f, open(manifest, "w", encoding="utf-8") as m:
            for name, off, size in entries(pck):
                target = os.path.join(dest, safe(name))
                os.makedirs(os.path.dirname(target), exist_ok=True)
                f.seek(off)
                with open(target, "wb") as o:
                    o.write(f.read(size))
                m.write(f"{name}\t{os.path.abspath(target)}\n")
    elif len(argv) >= 5 and argv[1] == "add":
        proj, manifest, rels = argv[2], argv[3], argv[4:]
        have = set()
        with open(manifest, encoding="utf-8") as m:
            have = {line.split("\t")[0] for line in m}
        added = 0
        with open(manifest, "a", encoding="utf-8") as m:
            for rel in rels:
                for root, _dirs, files in os.walk(os.path.join(proj, rel)):
                    for fn in sorted(files):
                        if fn == ".gdignore" or fn.endswith(".import"):
                            continue
                        full = os.path.join(root, fn)
                        name = os.path.relpath(full, proj).replace(os.sep, "/")
                        if name not in have:
                            m.write(f"{name}\t{os.path.abspath(full)}\n")
                            added += 1
        print(f"{added} fichiers ajoutés au manifeste")
    else:
        raise SystemExit(__doc__)

if __name__ == "__main__":
    main(sys.argv)
