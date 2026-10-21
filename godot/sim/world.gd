class_name World
extends RefCounted
## La carte de Strasbourg (Grande Île), chargée depuis le monde « cuit » data/world/ (tools/bake-world.mjs exécute le vrai buildRealWorld
## dans Chrome et exporte le résultat : D2). Contient tout ce que la simulation lit : collision (50 937 segments, 1 277 cercles, 30 dalles),
## étages (Levels), grille de navigation, zones, portes payantes, fenêtres d'apparition et emplacements des objets. Code pur : aucun nœud ;
## le rendu (scenes/world/world_view.gd) lit la géométrie cuite à part. L'état des portes et des zones ouvertes vit ici.

const DIR := "res://data/world/"
const WIN_CELL := 40.0           ## realworld.js : WIN_CELL (grille des fenêtres)
const DOOR_REACH := 3.4          ## main.js nearDoor : portée (m) jusqu'à un point de la barrière
const SEG_STRIDE := 10           ## segs.f64 : ax, az, bx, bz, h, y0, prop (0/1), vid, porte (-1), désactivé
const CIRCLE_STRIDE := 8         ## circles.f64 : x, z, r, h, y0, prop, vid, désactivé
const WIN_STRIDE := 9            ## windows.f64 : ox, oz, ix, iz, cx, cz, nx, nz, zone

var collision: Collision
var levels: Levels
var nav: NavGrid
var objects: Dictionary = {}
var doors: Array = []            ## { id, price, a, b, toZone, name, points, segs (indices), cells, open, opened, opens }
var zone_names: PackedStringArray = []
var zone_open: PackedByteArray = []
var sealed := false              ## v0.26.0 : mode Zone unique : toutes les portes sont murées (ni invite, ni achat, ni ouverture)
var start_pos := Vector3.ZERO
var start_zone := 0
var half_x := 820.0
var half_z := 560.0
var extra_first := 0                      ## indice du premier segment ajouté (data/world_collision_extra.json)
var seg_list: Array[Dictionary] = []     ## segments de collision dans l'ordre du fichier (les portes les désignent par indice)
var windows := PackedFloat64Array()
var window_busy := PackedFloat64Array()  ## busyUntil de chaque fenêtre
var _win_grid: Dictionary = {}
var load_ms := 0

static func _json(path: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(path))

static func load_world() -> World:
	var t0 := Time.get_ticks_msec()
	var w := World.new()
	w._load()
	w.load_ms = Time.get_ticks_msec() - t0
	return w

func _load() -> void:
	var cmeta: Dictionary = _json(DIR + "collision/meta.json")
	half_x = float(cmeta["halfX"])
	half_z = float(cmeta["halfZ"])
	collision = Collision.new(half_x, half_z, float(cmeta["cell"]))
	var sd := FileAccess.get_file_as_bytes(DIR + "collision/segs.f64").to_float64_array()
	var n_segs := sd.size() / SEG_STRIDE
	for i in n_segs:
		var o := i * SEG_STRIDE
		var s := collision.add_segment(sd[o], sd[o + 1], sd[o + 2], sd[o + 3], sd[o + 4], sd[o + 5], "prop" if sd[o + 6] > 0.5 else "wall", int(sd[o + 7]))
		s["off"] = sd[o + 9] > 0.5
		seg_list.append(s)
	var cd := FileAccess.get_file_as_bytes(DIR + "collision/circles.f64").to_float64_array()
	var circ_list: Array[Dictionary] = []
	for i in cd.size() / CIRCLE_STRIDE:
		var o := i * CIRCLE_STRIDE
		var c := {"x": cd[o], "z": cd[o + 1], "r": cd[o + 2], "h": cd[o + 3], "y0": cd[o + 4], "kind": "prop" if cd[o + 5] > 0.5 else "wall", "vid": int(cd[o + 6]), "off": cd[o + 7] > 0.5, "stamp": 0}
		collision.circles.append(c)
		circ_list.append(c)
	for v: Dictionary in _json(DIR + "collision/vaults.json"):
		if v.has("circle"):
			collision.vaults.append({"id": int(v["id"]), "h": float(v["h"]), "circle": circ_list[int(v["circle"])]})
		else:
			var ss: Array = []
			for k: float in v["segs"]:
				ss.append(seg_list[int(k)])
			collision.vaults.append({"id": int(v["id"]), "h": float(v["h"]), "segs": ss})
	# v0.24.0 : murs ajoutés (écart voulu avec le JS) pour que les murs visibles de la cathédrale bloquent ; ajoutés APRÈS les segments du JS (indices des portes inchangés)
	var extra: Dictionary = _json("res://data/world_collision_extra.json")
	extra_first = seg_list.size()
	for e: Array in extra["segs"]:
		var es := collision.add_segment(e[0], e[1], e[2], e[3], float(extra["h"]), float(extra["y0"]), "wall", 0)
		es["off"] = false
		seg_list.append(es)
	for e: Array in Cathedral.facade_segments():   # v0.24.2 : peau de la façade ouest
		var es := collision.add_segment(e[0], e[1], e[2], e[3], float(extra["h"]), float(extra["y0"]), "wall", 0)
		es["off"] = false
		seg_list.append(es)
	var perk_places := PerkPlaces.list()   # v0.27.0 : distributeurs des nouveaux atouts (data/perk_machines.json) : collision ajoutée après le JS
	for m: Dictionary in perk_places:
		for e: Array in PerkPlaces.segments(m):
			var es := collision.add_segment(e[0], e[1], e[2], e[3], PerkPlaces.HEIGHT, -INF, "prop", 0)
			es["off"] = false
			seg_list.append(es)
	for f: Dictionary in _json(DIR + "collision/floors.json"):
		collision.add_floor(float(f["y"]), f["tris"])
	collision.build()
	levels = Levels.new()
	levels.load_json(_json(DIR + "levels.json"))
	nav = NavGrid.new()
	nav.load_dir(DIR, _json(DIR + "nav/meta.json"))
	levels.nav_collision = collision   # champ de flux des étages (cathédrale) : grilles locales construites à la demande, comme levels.buildNavs du JS
	objects = _json(DIR + "objects.json")
	objects["machines"].append_array(perk_places)
	start_pos = Vector3(objects["start"]["x"], objects["start"]["y"], objects["start"]["z"])
	start_zone = int(objects["startZone"])
	for z: Dictionary in objects["zones"]:
		zone_names.append(z["name"])
	zone_open.resize(zone_names.size())
	zone_open.fill(0)
	zone_open[start_zone] = 1
	for d: Dictionary in objects["doors"]:
		d["open"] = false
		d["opened"] = []
		d["opens"] = -1
		var cells: Array = d["cells"]
		var arr := PackedInt32Array()
		for c: float in cells:
			arr.append(int(c))
		d["cells"] = arr
		doors.append(d)
	# les cases bloquées « par une porte » restent bloquées dans le fichier (portes fermées) ; on retrouve l'indice de porte des segments
	windows = FileAccess.get_file_as_bytes(DIR + "windows.f64").to_float64_array()
	window_busy.resize(windows.size() / WIN_STRIDE)
	window_busy.fill(0.0)
	for i in windows.size() / WIN_STRIDE:
		var k := _win_key(int(floor(windows[i * WIN_STRIDE] / WIN_CELL)), int(floor(windows[i * WIN_STRIDE + 1] / WIN_CELL)))
		if not _win_grid.has(k):
			_win_grid[k] = PackedInt32Array()
		_win_grid[k].append(i)

static func _win_key(cx: int, cz: int) -> int:
	return cx * 4096 + cz

# ------------------------------------------------------------------ requêtes
func zone_of(x: float, z: float) -> int:
	return nav.zone_of(x, z)

func is_zone_open(i: int) -> bool:
	return i >= 0 and i < zone_open.size() and zone_open[i] != 0

func floor_at(x: float, z: float, y: float, out: Dictionary) -> Dictionary:
	return levels.floor_at(x, z, y, out)

func ray_hit(ox: float, oy: float, oz: float, dx: float, dy: float, dz: float, max_t: float) -> float:
	return collision.ray_hit(ox, oy, oz, dx, dy, dz, max_t)

func window_count() -> int:
	return windows.size() / WIN_STRIDE

## Fenêtre libre à distance [min_d, max_d] du point, dans une zone ouverte (realworld.js pickWindow). Renvoie son indice, -1 si aucune.
func pick_window(px: float, pz: float, min_d: float, max_d: float, now: float, rng: RandomNumberGenerator) -> int:
	var ok := PackedInt32Array()
	for cx in range(int(floor((px - max_d) / WIN_CELL)), int(floor((px + max_d) / WIN_CELL)) + 1):
		for cz in range(int(floor((pz - max_d) / WIN_CELL)), int(floor((pz + max_d) / WIN_CELL)) + 1):
			var arr: Variant = _win_grid.get(_win_key(cx, cz))
			if arr == null:
				continue
			for i: int in arr:
				var o := i * WIN_STRIDE
				if not is_zone_open(int(windows[o + 8])) or window_busy[i] > now:
					continue
				var d := Vector2(windows[o] - px, windows[o + 1] - pz).length()
				if d >= min_d and d <= max_d:
					ok.append(i)
	return -1 if ok.is_empty() else ok[rng.randi() % ok.size()]

## Point extérieur de la fenêtre i (devant la façade) et sa normale.
func window_outside(i: int) -> Vector3:
	return Vector3(windows[i * WIN_STRIDE], 0.0, windows[i * WIN_STRIDE + 1])

func window_inside(i: int) -> Vector3:
	return Vector3(windows[i * WIN_STRIDE + 2], 0.0, windows[i * WIN_STRIDE + 3])

func window_center(i: int) -> Vector3:
	return Vector3(windows[i * WIN_STRIDE + 4], 1.5, windows[i * WIN_STRIDE + 5])

func window_normal(i: int) -> Vector2:
	return Vector2(windows[i * WIN_STRIDE + 6], windows[i * WIN_STRIDE + 7])

## Point d'apparition au sol : case accessible, dans une zone ouverte, avec 3 x 3 cases libres autour (realworld.js pickGround).
## Renvoie Vector3.INF si rien n'est trouvé en GROUND_TRIES essais. (« accessible » = case de zone : seules les cases atteignables depuis le départ en ont une.)
func pick_ground(px: float, pz: float, min_d: float, max_d: float, rng: RandomNumberGenerator) -> Vector3:
	for _t in Rules.GROUND_TRIES:
		var a := rng.randf() * TAU
		var d := min_d + rng.randf() * (max_d - min_d)
		var x := px + cos(a) * d
		var z := pz + sin(a) * d
		var ix := nav.cx(x)
		var iz := nav.cz(z)
		if not nav.inside(ix, iz) or not is_zone_open(nav.zone_of(x, z)):
			continue
		if not clearance(ix, iz, Rules.GROUND_CLEARANCE):
			continue
		return Vector3(x, 0.0, z)
	return Vector3.INF

func clearance(ix: int, iz: int, r: int) -> bool:
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var jx := ix + dx
			var jz := iz + dz
			if not nav.inside(jx, jz) or nav.blocked[jz * nav.nx + jx] != 0:
				return false
	return true

# ------------------------------------------------------------------ portes
## Porte payante à portée (n'importe quel point de la barrière) : indice, -1 si aucune (main.js nearDoor).
func near_door(p: Vector3) -> int:
	if sealed:
		return -1
	return _nearest_door(p)

## v0.26.0 : porte murée à portée (mode Zone unique), -1 si aucune : invite « Passage muré ».
func near_sealed(p: Vector3) -> int:
	return _nearest_door(p) if sealed else -1

func _nearest_door(p: Vector3) -> int:
	var best := -1
	var best_d := DOOR_REACH
	for d: Dictionary in doors:
		if d["open"]:
			continue
		for pt: Array in d["points"]:
			var dist := Vector2(p.x - pt[0], p.z - pt[1]).length()
			if dist < best_d:
				best_d = dist
				best = int(d["id"])
	return best

## Ouvre la porte : retire ses barrières de la collision, libère ses cases de navigation, ouvre les zones reliées (realworld.js openDoor).
func open_door(id: int) -> bool:
	if sealed or id < 0 or id >= doors.size():
		return false
	var d: Dictionary = doors[id]
	if d["open"]:
		return false
	d["open"] = true
	var opened: Array = []
	for z: int in [int(d["a"]), int(d["b"])]:
		if zone_open[z] == 0:
			opened.append(z)
	d["opened"] = opened
	d["opens"] = opened[0] if not opened.is_empty() else int(d["toZone"])
	d["name"] = zone_names[int(d["opens"])]
	for k: float in d["segs"]:
		seg_list[int(k)]["off"] = true
	nav.free_cells(d["cells"])   # libère les cases et met les composantes à jour localement (pas de recalcul complet)
	zone_open[int(d["a"])] = 1
	zone_open[int(d["b"])] = 1
	return true

## v0.24.0 : active / désactive les murs ajoutés au JS (data/world_collision_extra.json) ; les tests golden J2 comparent la collision du JS : ils les coupent.
func set_extras(on: bool) -> void:
	for i in range(extra_first, seg_list.size()):
		seg_list[i]["off"] = not on

func open_all_doors() -> void:
	for d: Dictionary in doors:
		open_door(int(d["id"]))
