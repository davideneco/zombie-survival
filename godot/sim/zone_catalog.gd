class_name ZoneCatalog
extends RefCounted
## v0.26.0 : les 27 zones de la carte vues depuis le MENU (le monde n'est pas chargé) : noms, surfaces, contenu (atouts, boîte, Pack-a-Punch,
## armes murales, portes) lus dans data/world/objects.json, et l'image des zones (une valeur par pixel : indice de zone, 255 hors zone) tirée
## de la grille de navigation cuite pour la miniature de la carte du menu « Mode de jeu ». Code pur, sans nœud.

const OBJECTS := "res://data/world/objects.json"
const NAV_DIR := "res://data/world/nav/"
const IMAGE_STEP := 3            ## un pixel de la miniature = 3 x 3 cases de 0,75 m (2,25 m)

static var _zones: Array = []
static var _meta: Dictionary = {}

## Zones : [{ i, name, area, center {x, z}, perks [ids], box, pap, walls, doors }] (vide si la carte n'est pas cuite).
static func zones() -> Array:
	if not _zones.is_empty() or not FileAccess.file_exists(OBJECTS):
		return _zones
	var o: Variant = JSON.parse_string(FileAccess.get_file_as_string(OBJECTS))
	if typeof(o) != TYPE_DICTIONARY:
		return _zones
	for z: Dictionary in o["zones"]:
		_zones.append({"i": int(z["i"]), "name": String(z["name"]), "area": float(z.get("area", 0.0)), "center": z.get("center", {}),
			"perks": [], "box": false, "pap": false, "walls": 0, "doors": 0})
	for m: Dictionary in o["machines"]:
		var zi := int(m.get("zone", -1))
		if zi < 0 or zi >= _zones.size():
			continue
		match String(m["type"]):
			"perk":
				_zones[zi]["perks"].append(String(m["id"]))
			"box":
				_zones[zi]["box"] = true
			"pap":
				_zones[zi]["pap"] = true
	for pm: Dictionary in PerkPlaces.list():   # v0.27.0 : distributeurs des nouveaux atouts
		var pz := int(pm["zone"])
		if pz >= 0 and pz < _zones.size():
			_zones[pz]["perks"].append(String(pm["id"]))
	for ww: Dictionary in o.get("wallWeapons", []):
		var zi := int(ww.get("zone", -1))
		if zi >= 0 and zi < _zones.size():
			_zones[zi]["walls"] = int(_zones[zi]["walls"]) + 1
	for d: Dictionary in o["doors"]:
		for k in ["a", "b"]:
			var zi := int(d[k])
			if zi >= 0 and zi < _zones.size():
				_zones[zi]["doors"] = int(_zones[zi]["doors"]) + 1
	_meta = {"mapCrop": o.get("mapCrop", {}), "half": float(o.get("half", 820.0))}
	return _zones

static func count() -> int:
	return zones().size()

static func name_of(i: int) -> String:
	var zs := zones()
	return String(zs[i]["name"]) if i >= 0 and i < zs.size() else "?"

## Indice d'une zone d'après son nom (casse et accents ignorés grossièrement : comparaison en minuscules), -1 si inconnue.
static func index_of(n: String) -> int:
	var want := n.to_lower().replace("_", " ").replace("-", " ")
	for z: Dictionary in zones():
		if String(z["name"]).to_lower().replace("-", " ").replace("'", " ") == want.replace("'", " "):
			return int(z["i"])
	return -1

static func map_crop() -> Dictionary:
	zones()
	return _meta.get("mapCrop", {})

## Texte d'une ligne de la liste : « Place Kléber · 11 757 m² · M ? »
static func machines_text(i: int) -> String:
	var z: Dictionary = zones()[i]
	var parts: Array[String] = []
	for pid: String in z["perks"]:
		parts.append(String(Config.at("perks.%s.name" % pid, pid)).capitalize())
	if z["box"]:
		parts.append("Boîte mystère")
	if z["pap"]:
		parts.append("Pack-a-Punch")
	parts.append("%d arme%s murale%s" % [int(z["walls"]), "s" if int(z["walls"]) > 1 else "", "s" if int(z["walls"]) > 1 else ""])
	return " · ".join(parts)

## Ce que le mode Zone unique AJOUTE à la zone (GameMode.CONFIG.baseSet) : texte pour le menu, vide si rien.
static func added_text(i: int) -> String:
	var z: Dictionary = zones()[i]
	var add: Array[String] = []
	if not z["box"]:
		add.append("Boîte mystère")
	if (z["perks"] as Array).is_empty():
		for item: String in GameMode.CONFIG["baseSet"]:
			if item.begins_with("perk:"):
				add.append(String(Config.at("perks.%s.name" % item.substr(5), item)).capitalize())
	return ", ".join(add)

## Image des zones (FORMAT_R8 : indice de zone, 255 hors zone, 254 case bloquée d'une zone) : toute la grille de navigation, un pixel pour
## IMAGE_STEP x IMAGE_STEP cases. ~150 ms : à construire sur un fil de travail.
static func build_zone_image() -> Image:
	var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(NAV_DIR + "meta.json"))
	if typeof(meta) != TYPE_DICTIONARY:
		return null
	var nx := int(meta["nx"])
	var nz := int(meta["nz"])
	var zone := NavGrid._gz(NAV_DIR + "zone.i8.gz", nx * nz)
	var blocked := NavGrid._gz(NAV_DIR + "blocked.u8.gz", nx * nz)
	if zone.size() != nx * nz or blocked.size() != nx * nz:
		return null
	var w := nx / IMAGE_STEP
	var h := nz / IMAGE_STEP
	var data := PackedByteArray()
	data.resize(w * h)
	var c := IMAGE_STEP / 2
	for py in h:
		var row := (py * IMAGE_STEP + c) * nx
		for px in w:
			var i := row + px * IMAGE_STEP + c
			var v := zone[i]
			data[py * w + px] = v if (v == 255 or blocked[i] == 0) else 254
	return Image.create_from_data(w, h, false, Image.FORMAT_R8, data)
