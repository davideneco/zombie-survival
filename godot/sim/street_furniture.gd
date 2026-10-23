class_name StreetFurniture
extends RefCounted
## v0.33.1 : mobilier urbain AJOUTÉ par le port (bancs, lampadaires, corbeilles, bornes, barrières, kiosques, colonnes d'affichage), avec
## collision. Placé une fois pour toutes hors des passages par tests/test_place_furniture.gd (outil) dans data/street_furniture.json
## (versionné). World._load ajoute sa collision APRÈS les segments du JS (comme les distributeurs d'atouts : World.set_extras la coupe pour
## les golden J2) ; scenes/world/furniture_view.gd le dessine. La grille de navigation cuite ne change pas : le mobilier est contre les
## façades (dans la marge des murs) ou au milieu des places (les zombies le contournent par la collision) ; les apparitions au sol l'évitent
## (blocks_spawn). Repère d'un objet : largeur le long de x local, profondeur le long de z local, face avant vers +z, rotation.y = yaw
## (collision : rot = -yaw, comme PerkPlaces).

const PATH := "res://data/street_furniture.json"
## Encombrement de collision par sorte : boîte (w x d) ou cercle (r) ; h : hauteur (Collision : un objet de moins de 0,3 m ne bloque pas).
const KINDS := {
	"bench":   {"name": "banc", "w": 1.8, "d": 0.62, "h": 0.9},
	"bin":     {"name": "corbeille", "r": 0.3, "h": 1.05},
	"bollard": {"name": "borne", "r": 0.13, "h": 0.95},
	"lamp":    {"name": "lampadaire", "r": 0.16, "h": 4.8},
	"barrier": {"name": "barrière", "w": 2.0, "d": 0.56, "h": 1.1},
	"kiosk":   {"name": "kiosque", "r": 1.3, "h": 3.2},
	"column":  {"name": "colonne d'affichage", "r": 0.62, "h": 3.4},
}

static var enabled := true      ## faux : World._load ne charge pas le mobilier (outil de placement)
static var _raw: Array = []
static var _grid: Dictionary = {}   ## case de 4 m -> indices dans _raw (blocks_spawn)

static func _load() -> Array:
	if _raw.is_empty() and FileAccess.file_exists(PATH):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if typeof(d) == TYPE_DICTIONARY and typeof(d.get("items")) == TYPE_ARRAY:
			_raw = d["items"]
			_grid.clear()
			for i in _raw.size():
				var it: Dictionary = _raw[i]
				var k := _key(float(it["x"]), float(it["z"]))
				if not _grid.has(k):
					_grid[k] = []
				_grid[k].append(i)
	return _raw

## Les objets : [{ kind, x, z, yaw, zone }]. Vide si le mobilier est coupé (outil de placement) ou le fichier absent.
static func list() -> Array:
	return _load() if enabled else []

static func reload() -> void:
	_raw = []
	_grid.clear()

static func _key(x: float, z: float) -> int:
	return int(floor(x / 4.0)) * 4096 + int(floor(z / 4.0))

static func is_box(kind: String) -> bool:
	return KINDS[kind].has("w")

## Rayon englobant de l'emprise au sol (m).
static func radius(kind: String) -> float:
	var K: Dictionary = KINDS[kind]
	return float(K["r"]) if K.has("r") else 0.5 * Vector2(float(K["w"]), float(K["d"])).length()

## Distance (m) du point à l'emprise de l'objet (0 dedans).
static func dist_to(it: Dictionary, x: float, z: float) -> float:
	var K: Dictionary = KINDS[String(it["kind"])]
	var dx := x - float(it["x"])
	var dz := z - float(it["z"])
	if K.has("r"):
		return maxf(0.0, Vector2(dx, dz).length() - float(K["r"]))
	var yaw := float(it["yaw"])
	# repère local : x local = (cos yaw, -sin yaw), z local = (sin yaw, cos yaw) (rotation.y = yaw)
	var lx := dx * cos(yaw) - dz * sin(yaw)
	var lz := dx * sin(yaw) + dz * cos(yaw)
	var qx := maxf(0.0, absf(lx) - float(K["w"]) * 0.5)
	var qz := maxf(0.0, absf(lz) - float(K["d"]) * 0.5)
	return Vector2(qx, qz).length()

## Un point d'apparition au sol à moins de `margin` m d'un objet ? (World.pick_ground, GameMode : un zombie n'apparaît pas dans un banc).
static func blocks_spawn(x: float, z: float, margin := 0.8) -> bool:
	if not enabled or _load().is_empty():
		return false
	var cx := int(floor(x / 4.0))
	var cz := int(floor(z / 4.0))
	for ix in range(cx - 1, cx + 2):
		for iz in range(cz - 1, cz + 2):
			for i: int in _grid.get(ix * 4096 + iz, []):
				if dist_to(_raw[i], x, z) < margin:
					return true
	return false

## Ajoute la collision des objets (avant Collision.build) ; renvoie les éléments créés (segments et cercles) pour World.set_extras.
static func add_collision(col: Collision, items: Array) -> Array:
	var out: Array = []
	for it: Dictionary in items:
		var kind := String(it["kind"])
		var K: Dictionary = KINDS[kind]
		var x := float(it["x"])
		var z := float(it["z"])
		if K.has("r"):
			out.append(col.add_circle(x, z, float(K["r"]), float(K["h"]), -INF, "prop"))
			continue
		var n0 := col.segs.size()
		col.add_box(x, z, float(K["w"]), float(K["d"]), -float(it["yaw"]), float(K["h"]), -INF, "prop")
		for k in range(n0, col.segs.size()):
			out.append(col.segs[k])
	return out

## Les 4 coins de l'emprise d'une boîte, ou un polygone à 12 côtés pour un cercle (contrôles, outils).
static func outline(it: Dictionary) -> PackedVector2Array:
	var K: Dictionary = KINDS[String(it["kind"])]
	var x := float(it["x"])
	var z := float(it["z"])
	var out := PackedVector2Array()
	if K.has("r"):
		for i in 12:
			var a := TAU * i / 12.0
			out.append(Vector2(x + cos(a) * float(K["r"]), z + sin(a) * float(K["r"])))
		return out
	var yaw := float(it["yaw"])
	var c := cos(yaw)
	var s := sin(yaw)
	for p in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		var lx: float = float(p[0]) * float(K["w"]) * 0.5
		var lz: float = float(p[1]) * float(K["d"]) * 0.5
		out.append(Vector2(x + lx * c + lz * s, z - lx * s + lz * c))
	return out
