class_name PerkPlaces
extends RefCounted
## v0.27.0 : distributeurs des nouveaux atouts (sim/perk_fx.gd), placés une fois pour toutes par tools/place-perks.gd dans
## data/perk_machines.json (versionné). World._load les ajoute aux machines de la carte (objects.json « machines », avec "proc": true :
## modèle construit par code, scenes/world/perk_machine_model.gd) et leur donne une collision (boîte de 1,2 x 0,9 m, ajoutée APRÈS les
## segments du JS comme les autres ajouts : World.set_extras les coupe pour les golden J2).

const PATH := "res://data/perk_machines.json"
const SIZE := Vector2(1.2, 0.9)   ## emprise du distributeur (largeur x profondeur, m)
const HEIGHT := 2.4

static var _raw: Array = []

static func _load() -> Array:
	if _raw.is_empty() and FileAccess.file_exists(PATH):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if typeof(d) == TYPE_DICTIONARY and typeof(d.get("machines")) == TYPE_ARRAY:
			_raw = d["machines"]
	return _raw

## Machines (copies) au format de objects.json : { type "perk", id, name, price, color, letter, zone, pos {x, y, z}, yaw, proc }.
static func list() -> Array:
	var out: Array = []
	for m: Dictionary in _load():
		var P: Dictionary = Config.at("perks.%s" % String(m["id"]), {})
		if P.is_empty():
			continue
		var c: Dictionary = m.duplicate(true)
		c["name"] = P["name"]
		c["price"] = int(P["price"])
		c["color"] = P["color"]
		c["letter"] = P["letter"]
		c["proc"] = true
		out.append(c)
	return out

## Les 4 segments de collision d'un distributeur : [[ax, az, bx, bz], ...] (repère : façade vers +Z local, rotation.y = yaw).
static func segments(m: Dictionary) -> Array:
	var x := float(m["pos"]["x"])
	var z := float(m["pos"]["z"])
	var rot := -float(m["yaw"])
	var c := cos(rot)
	var s := sin(rot)
	var pts: Array = []
	for p in [[-SIZE.x / 2.0, -SIZE.y / 2.0], [SIZE.x / 2.0, -SIZE.y / 2.0], [SIZE.x / 2.0, SIZE.y / 2.0], [-SIZE.x / 2.0, SIZE.y / 2.0]]:
		pts.append([x + p[0] * c - p[1] * s, z + p[0] * s + p[1] * c])
	var out: Array = []
	for i in 4:
		out.append([pts[i][0], pts[i][1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1]])
	return out
