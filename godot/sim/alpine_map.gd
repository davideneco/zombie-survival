class_name AlpineMap
extends RefCounted
## v0.34.0 : la carte « Station des Aiguilles » (station de ski alpine abandonnée en hiver), construite au chargement depuis le plan versionné
## data/alpine.json (écrit par tools/build-alpine.py ; aucune cuisson). Rend un World ordinaire (map_id "alpine") : collision (murs, chalets,
## mobilier, sapins), grille de navigation (cases de 75 cm, marge 50 cm, comme la carte de Strasbourg), zones (remplissage depuis le germe de
## chaque zone, portes fermées, puis élargies de 6 cases comme realworld.js), portes payantes (segments, cases, zones reliées), fenêtres
## d'apparition, machines, armes murales, bornes, véhicules. Toute la logique de partie (portes, zones, apparitions, flux, boîte, atouts) est
## celle de la carte de Strasbourg. Le sol jouable est plat (y = 0) : le relief de la montagne est hors de la zone jouable. Code pur.

const PATH := "res://data/alpine.json"
const NAV_CELL := 0.75
const NAV_MARGIN := 0.5
const ZONE_WIDEN := 6            ## realworld.js widen : cases bloquées voisines rattachées à la zone (joueur collé à un mur)
const DOOR_H := 2.8              ## hauteur de collision d'une porte fermée (barricade)
const DOOR_SIDE := 2.5           ## m : points de part et d'autre d'une porte pour trouver ses deux zones
## Emprise de collision des machines : largeur (x local), profondeur (z local, la face regarde +z), hauteur.
const MACHINE_BOX := {"perk": Vector3(1.2, 2.4, 0.9), "box": Vector3(1.7, 1.0, 0.85), "pap": Vector3(1.6, 2.3, 1.25), "clock": Vector3(1.1, 1.7, 0.8)}
const STATION_R := 0.65          ## borne de munitions : cercle (son orientation suit la zone)
const STATION_H := 1.9
const CAR_BOX := Vector3(4.2, 1.5, 1.75)   ## voiture garée (comme la boîte du JS) : longueur (x local), hauteur, largeur
const MACHINE_INFO := {
	"box": {"name": "BOÎTE MYSTÈRE", "price": 950, "color": "#5fb8ff"},
	"pap": {"name": "PACK-A-PUNCH", "price": 5000, "color": "#b24bff"},
	"clock": {"name": "CLOCHE DE SAINT-BERNARD", "price": 0, "color": "#d4a640"},
}
const WIN_STRIDE := 9

static var _raw: Dictionary = {}

## Le plan (lu une fois).
static func data() -> Dictionary:
	if _raw.is_empty():
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if typeof(d) != TYPE_DICTIONARY:
			push_error("AlpineMap : %s illisible (tools/build-alpine.py)" % PATH)
			return {}
		_raw = d
	return _raw

static func _h(v: float) -> float:
	return INF if v < 0.0 else v

static func load_map() -> World:
	var t0 := Time.get_ticks_msec()
	var D := data()
	var w := World.new()
	w.map_id = "alpine"
	w.furniture_on = false
	var half := float(D["half"])
	w.half_x = half
	w.half_z = half
	var col := Collision.new(half, half, 4.0)
	w.collision = col
	var e := float(D["edge"])
	for s: Array in [[-e, -e, e, -e], [e, -e, e, e], [e, e, -e, e], [-e, e, -e, -e]]:   # falaises du pourtour
		_seg(w, s[0], s[1], s[2], s[3], INF, "wall")
	for wl: Dictionary in D["walls"]:
		_seg(w, wl["a"][0], wl["a"][1], wl["b"][0], wl["b"][1], _h(float(wl["h"])), "wall")
	for so: Dictionary in D["solids"]:
		var x0 := float(so["x"]) - float(so["w"]) / 2.0
		var x1 := float(so["x"]) + float(so["w"]) / 2.0
		var z0 := float(so["z"]) - float(so["d"]) / 2.0
		var z1 := float(so["z"]) + float(so["d"]) / 2.0
		var h := float(so["h"])
		_seg(w, x0, z0, x1, z0, h, "wall")
		_seg(w, x1, z0, x1, z1, h, "wall")
		_seg(w, x1, z1, x0, z1, h, "wall")
		_seg(w, x0, z1, x0, z0, h, "wall")
	for p: Dictionary in D["props"]:
		_box(w, float(p["x"]), float(p["z"]), float(p["w"]), float(p["d"]), float(p["rot"]), float(p["h"]))
	for c: Dictionary in D["circles"]:
		col.add_circle(float(c["x"]), float(c["z"]), float(c["r"]), float(c["h"]), -INF, "prop")
	for c: Array in D["cars"]:   # longueur le long du cap (rotation.y = yaw : x local -> (cos yaw, -sin yaw))
		_box(w, float(c[0]), float(c[1]), CAR_BOX.x, CAR_BOX.z, -float(c[2]), CAR_BOX.y)
	for m: Dictionary in D["machines"]:
		var b: Vector3 = MACHINE_BOX[String(m["type"])]
		_box(w, float(m["x"]), float(m["z"]), b.x, b.z, -float(m["yaw"]), b.y)
	for s: Array in D["stations"]:
		col.add_circle(float(s[0]), float(s[1]), STATION_R, STATION_H, -INF, "prop")
	var first_door := w.seg_list.size()
	for d: Dictionary in D["doors"]:
		var si := w.seg_list.size()
		_seg(w, d["a"][0], d["a"][1], d["b"][0], d["b"][1], DOOR_H, "wall")
		d["_seg"] = si
	w.extra_first = w.seg_list.size()   # rien d'ajouté après (set_extras ne coupe rien)
	col.build()
	w.levels = Levels.new()
	w.levels.load_json({"tris": [], "regions": [{"id": 0, "name": "Sol", "kind": "ground", "y": 0.0}], "links": [], "holePolys": []})
	w.levels.nav_collision = col
	_build_nav(w, first_door, D)
	_build_objects(w, D)
	w.load_ms = Time.get_ticks_msec() - t0
	return w

static func _seg(w: World, ax: float, az: float, bx: float, bz: float, h: float, kind: String) -> Dictionary:
	var s := w.collision.add_segment(ax, az, bx, bz, h, -INF, kind, 0)
	w.seg_list.append(s)
	return s

## Boîte (rot : convention de Collision.add_box, l'opposé de rotation.y) : 4 segments « prop ».
static func _box(w: World, x: float, z: float, bw: float, bd: float, rot: float, h: float) -> void:
	var n0 := w.collision.segs.size()
	w.collision.add_box(x, z, bw, bd, rot, h, -INF, "prop")
	for i in range(n0, w.collision.segs.size()):
		w.seg_list.append(w.collision.segs[i])

# ------------------------------------------------------------------ navigation et zones
static func _build_nav(w: World, first_door: int, D: Dictionary) -> void:
	var solids: Array = D["solids"]
	var nav := NavGrid.new()
	var half := w.half_x
	nav.cell = NAV_CELL
	nav.margin = NAV_MARGIN
	nav.ox = -half
	nav.oz = -half
	nav.nx = int(round(2.0 * half / NAV_CELL))
	nav.nz = nav.nx
	nav.blocked = PackedByteArray()
	nav.blocked.resize(nav.nx * nav.nz)
	nav._alloc()
	var col := w.collision
	for i in first_door:
		var s: Dictionary = w.seg_list[i]
		if col._blocks(s, 0.0):
			nav._mark(s["ax"], s["az"], s["bx"], s["bz"], NAV_MARGIN)
	for c: Dictionary in col.circles:
		if col._blocks(c, 0.0):
			nav._mark(c["x"], c["z"], c["x"], c["z"], float(c["r"]) + NAV_MARGIN)
	for so: Dictionary in solids:   # l'intérieur des bâtiments pleins : bloqué (sinon des poches libres mais inaccessibles)
		var hw := float(so["w"]) / 2.0
		var hd := float(so["d"]) / 2.0
		for iz in range(maxi(0, nav.cz(float(so["z"]) - hd)), mini(nav.nz, nav.cz(float(so["z"]) + hd) + 1)):
			for ix in range(maxi(0, nav.cx(float(so["x"]) - hw)), mini(nav.nx, nav.cx(float(so["x"]) + hw) + 1)):
				nav.blocked[iz * nav.nx + ix] = 1
	var boxes: Array = []   # dessous des boîtes (voitures, dameuse, comptoirs) : bloqué aussi
	for p: Dictionary in D["props"]:
		boxes.append([float(p["x"]), float(p["z"]), float(p["w"]), float(p["d"]), float(p["rot"])])
	for c: Array in D["cars"]:
		boxes.append([float(c[0]), float(c[1]), CAR_BOX.x, CAR_BOX.z, -float(c[2])])
	for bx: Array in boxes:
		var r := Vector2(bx[2], bx[3]).length() / 2.0
		var cs := cos(-float(bx[4]))
		var sn := sin(-float(bx[4]))
		for iz in range(maxi(0, nav.cz(bx[1] - r)), mini(nav.nz, nav.cz(bx[1] + r) + 1)):
			for ix in range(maxi(0, nav.cx(bx[0] - r)), mini(nav.nx, nav.cx(bx[0] + r) + 1)):
				var dx: float = nav.world_x(ix) - bx[0]
				var dz: float = nav.world_z(iz) - bx[1]
				if absf(dx * cs - dz * sn) <= bx[2] / 2.0 and absf(dx * sn + dz * cs) <= bx[3] / 2.0:
					nav.blocked[iz * nav.nx + ix] = 1
	var edge := float(D["edge"])   # au-delà des falaises : bloqué
	for iz in nav.nz:
		for ix in nav.nx:
			if absf(nav.world_x(ix)) > edge or absf(nav.world_z(iz)) > edge:
				nav.blocked[iz * nav.nx + ix] = 1
	var m := ceili(NAV_MARGIN / NAV_CELL)
	for i in nav.nx:
		for k in m:
			nav.blocked[nav.idx(i, k)] = 1
			nav.blocked[nav.idx(i, nav.nz - 1 - k)] = 1
	for i in nav.nz:
		for k in m:
			nav.blocked[nav.idx(k, i)] = 1
			nav.blocked[nav.idx(nav.nx - 1 - k, i)] = 1
	# portes fermées : leurs cases (celles qu'elles seules bloquent) sont libérées à l'ouverture (World.open_door -> free_cells)
	var door_cells: Array = []
	for i in range(first_door, w.seg_list.size()):
		var before := nav.blocked.duplicate()
		var s: Dictionary = w.seg_list[i]
		nav._mark(s["ax"], s["az"], s["bx"], s["bz"], NAV_MARGIN)
		var cells := PackedInt32Array()
		for k in nav.blocked.size():
			if nav.blocked[k] != before[k]:
				cells.append(k)
		door_cells.append(cells)
	w.nav = nav
	w.set_meta("door_cells", door_cells)

## Zones : remplissage (4 voisins) des cases libres depuis le germe de chaque zone, portes fermées ; puis élargissement aux cases bloquées voisines.
static func label_zones(nav: NavGrid, seeds: Array) -> PackedByteArray:
	var n := nav.nx * nav.nz
	var z := PackedByteArray()
	z.resize(n)
	z.fill(255)
	var stack := PackedInt32Array()
	for zi in seeds.size():
		var sd: Vector2 = seeds[zi]
		var s0 := nav.nearest_free(sd.x, sd.y, 8)
		if s0 < 0 or z[s0] != 255:
			continue
		z[s0] = zi
		stack.resize(0)
		stack.append(s0)
		while not stack.is_empty():
			var i := stack[stack.size() - 1]
			stack.resize(stack.size() - 1)
			var ix := i % nav.nx
			var iz := i / nav.nx
			for k in 4:
				var jx := ix + (1 if k == 0 else (-1 if k == 1 else 0))
				var jz := iz + (1 if k == 2 else (-1 if k == 3 else 0))
				if jx < 0 or jz < 0 or jx >= nav.nx or jz >= nav.nz:
					continue
				var j := jz * nav.nx + jx
				if nav.blocked[j] != 0 or z[j] != 255:
					continue
				z[j] = zi
				stack.append(j)
	var front := PackedInt32Array()
	for i in n:
		if z[i] != 255:
			front.append(i)
	for _step in ZONE_WIDEN:
		var nxt := PackedInt32Array()
		for i in front:
			var ix := i % nav.nx
			var iz := i / nav.nx
			for k in 4:
				var jx := ix + (1 if k == 0 else (-1 if k == 1 else 0))
				var jz := iz + (1 if k == 2 else (-1 if k == 3 else 0))
				if jx < 0 or jz < 0 or jx >= nav.nx or jz >= nav.nz:
					continue
				var j := jz * nav.nx + jx
				if z[j] != 255 or nav.blocked[j] == 0:
					continue
				z[j] = z[i]
				nxt.append(j)
		front = nxt
	return z

# ------------------------------------------------------------------ objets (format de objects.json)
static func _pos(x: float, z: float) -> Dictionary:
	return {"x": x, "y": 0.0, "z": z}

static func _build_objects(w: World, D: Dictionary) -> void:
	var nav := w.nav
	var seeds: Array = []
	for zd: Dictionary in D["zones"]:
		seeds.append(Vector2(float(zd["seed"][0]), float(zd["seed"][1])))
		w.zone_names.append(String(zd["name"]))
	nav.zone = label_zones(nav, seeds)
	nav.zone1 = nav.zone.duplicate()
	var area: Array = []
	area.resize(seeds.size())
	area.fill(0)
	for i in nav.nx * nav.nz:
		if nav.blocked[i] == 0 and nav.zone[i] != 255:
			area[nav.zone[i]] += 1
	var zones: Array = []
	for i in seeds.size():
		zones.append({"i": i, "name": w.zone_names[i], "area": float(area[i]) * NAV_CELL * NAV_CELL, "center": {"name": w.zone_names[i], "x": seeds[i].x, "z": seeds[i].y}})
	var st: Array = D["start"]
	w.start_pos = Vector3(float(st[0]), 0.0, float(st[1]))
	w.start_zone = int(D["startZone"])
	w.zone_open.resize(seeds.size())
	w.zone_open.fill(0)
	w.zone_open[w.start_zone] = 1
	# portes : deux zones de part et d'autre ; `a` est la plus proche du départ (en nombre de portes), `toZone` celle qu'on ouvre
	var door_cells: Array = w.get_meta("door_cells")
	var raw_doors: Array = []
	for d: Dictionary in D["doors"]:
		var a := Vector2(float(d["a"][0]), float(d["a"][1]))
		var b := Vector2(float(d["b"][0]), float(d["b"][1]))
		var mid := (a + b) / 2.0
		var t := (b - a).normalized()
		var nrm := Vector2(-t.y, t.x)
		var p1 := mid + nrm * DOOR_SIDE
		var p2 := mid - nrm * DOOR_SIDE
		raw_doors.append([d, w.zone_of(p1.x, p1.y), w.zone_of(p2.x, p2.y), a, b])
	var depth := _door_depth(raw_doors, w.start_zone, seeds.size())
	for i in raw_doors.size():
		var rd: Array = raw_doors[i]
		var d: Dictionary = rd[0]
		var za: int = rd[1]
		var zb: int = rd[2]
		if za >= 0 and zb >= 0 and int(depth[zb]) < int(depth[za]):
			var tmp := za
			za = zb
			zb = tmp
		var a: Vector2 = rd[3]
		var b: Vector2 = rd[4]
		var pts: Array = []
		var n_pts := maxi(2, ceili(a.distance_to(b)))
		for k in n_pts + 1:
			var q := a.lerp(b, float(k) / n_pts)
			pts.append([q.x, q.y])
		w.doors.append({"id": i, "price": int(d["price"]), "a": maxi(za, 0), "b": maxi(zb, 0), "toZone": maxi(zb, 0), "name": w.zone_names[maxi(zb, 0)],
			"points": pts, "segs": [float(d["_seg"])], "cells": door_cells[i], "open": false, "opened": [], "opens": -1, "kind": String(d.get("k", "gate")),
			"zones_ok": za >= 0 and zb >= 0 and za != zb})
	# machines (atouts : nom, prix, couleur, lettre de Config ; modèles construits par code : "proc")
	var machines: Array = []
	for m: Dictionary in D["machines"]:
		var t := String(m["type"])
		var e := {"type": t, "id": m["id"], "zone": w.zone_of(float(m["x"]), float(m["z"])), "pos": _pos(float(m["x"]), float(m["z"])), "yaw": float(m["yaw"])}
		if t == "perk":
			var P: Dictionary = Config.at("perks.%s" % String(m["id"]), {})
			e["name"] = P.get("name", String(m["id"]).to_upper())
			e["price"] = int(P.get("price", 0))
			e["color"] = P.get("color", "#888888")
			e["letter"] = P.get("letter", "?")
			e["proc"] = true
		else:
			var I: Dictionary = MACHINE_INFO[t]
			e["name"] = I["name"]
			e["price"] = int(I["price"])
			e["color"] = I["color"]
			e["letter"] = null
		machines.append(e)
	var walls: Array = []
	for ww: Dictionary in D["wallWeapons"]:
		var W: Dictionary = Config.weapon(String(ww["id"]))
		walls.append({"id": String(ww["id"]), "name": String(W["name"]), "price": int(W["price"]), "ammoPrice": int(W["ammoPrice"]),
			"zone": w.zone_of(float(ww["x"]), float(ww["z"])), "pos": _pos(float(ww["x"]), float(ww["z"])), "yaw": 0})
	var stations: Array = []
	for s: Array in D["stations"]:
		stations.append({"x": float(s[0]), "y": 0.0, "z": float(s[1]), "zone": w.zone_of(float(s[0]), float(s[1]))})
	var spawns: Array = []
	for v: Dictionary in D["vehicles"]:
		spawns.append({"type": v["type"], "x": v["x"], "z": v["z"], "yaw": v["yaw"], "model": v.get("model", "")})
	var pk: Dictionary = D["parking"]
	var pts2: Array = [{"x": pk["x"], "z": pk["z"]}, {"x": pk["pump"]["x"], "z": pk["pump"]["z"]}, {"x": pk["sign"]["x"], "z": pk["sign"]["z"]}]
	var parkings: Array = [{"zone": w.zone_of(float(pk["x"]), float(pk["z"])), "name": pk["name"], "x": pk["x"], "z": pk["z"], "yaw": pk["yaw"], "size": pk["size"], "points": pts2}]
	var half := w.half_x
	w.objects = {"start": _pos(w.start_pos.x, w.start_pos.z), "startZone": w.start_zone, "half": half, "zones": zones, "doors": w.doors,
		"machines": machines, "wallWeapons": walls, "stations": stations, "vehicleSpawns": spawns, "parkings": parkings, "bikeStations": [],
		"mapCrop": {"x0": -half, "x1": half, "z0": -half, "z1": half}, "mapView": {"halfX": half, "halfZ": half, "scale": 3.0},
		"mapTitle": String(D["title"]), "knightZone": D.get("knightZone", ""), "pestZones": D.get("pestZones", []), "tannerZones": D.get("tannerZones", [])}
	# fenêtres d'apparition : point d'arrivée 1,1 m devant le centre, départ 1 m derrière (comme le monde cuit)
	var wins := PackedFloat64Array()
	var dropped := 0
	for wd: Array in D["windows"]:
		var c := Vector2(float(wd[0]), float(wd[1]))
		var n := Vector2(float(wd[2]), float(wd[3]))
		var o := c + n * 1.1
		var ins := c - n * 1.0
		var zi := w.zone_of(o.x, o.y)
		if zi < 0 or nav.is_blocked_at(o.x, o.y):
			dropped += 1
			continue
		wins.append_array(PackedFloat64Array([o.x, o.y, ins.x, ins.y, c.x, c.y, n.x, n.y, float(zi)]))
	w.windows = wins
	w.objects["windowCount"] = wins.size() / WIN_STRIDE
	w.objects["windowsDropped"] = dropped
	w.index_windows()

## Profondeur de chaque zone depuis le départ en nombre de portes (largeur d'abord) ; 99 : non reliée.
static func _door_depth(raw: Array, start: int, n: int) -> Array:
	var depth: Array = []
	depth.resize(n)
	depth.fill(99)
	depth[start] = 0
	var changed := true
	while changed:
		changed = false
		for rd: Array in raw:
			var a: int = rd[1]
			var b: int = rd[2]
			if a < 0 or b < 0:
				continue
			if int(depth[a]) + 1 < int(depth[b]):
				depth[b] = int(depth[a]) + 1
				changed = true
			if int(depth[b]) + 1 < int(depth[a]):
				depth[a] = int(depth[b]) + 1
				changed = true
	return depth

## Véhicules de la carte pour Rides (format de data/world/vehicles.json, sans tram ni vélos) : les motoneiges de la remise. Physique de la grosse
## moto (deux places), sièges de la motoneige ; parking = la remise (borne d'essence et de réparation).
const SNOWMOBILE_SEATS := [{"hip": [0, 0.8, 0.05], "eye": [0, 1.44, -0.05], "ry": 0}, {"hip": [0, 0.86, 0.68], "eye": [0, 1.5, 0.6], "ry": 0}]

static func rides_data() -> Dictionary:
	var D := data()
	var vehicles: Array = []
	for i in (D["vehicles"] as Array).size():
		var v: Dictionary = D["vehicles"][i]
		vehicles.append({"id": i, "type": v["type"], "x": v["x"], "z": v["z"], "yaw": v["yaw"], "variant": 0, "station": -1, "model": v.get("model", "")})
	var pk: Dictionary = D["parking"]
	var full := {"zone": 4, "name": pk["name"], "x": pk["x"], "z": pk["z"], "yaw": pk["yaw"], "pump": pk["pump"], "sign": pk["sign"], "size": pk["size"]}
	var model := {"seats": SNOWMOBILE_SEATS, "wheelRadius": 0.36, "length": 3.0}
	return {"vehicles": vehicles, "models": {"grosseMoto": model, "moto": model, "velo": model}, "parkingsFull": [full], "bikeStations": [], "tram": null}

## Les motoneiges : nom et modèle propres (copie de la définition : Config reste intact).
static func dress_vehicles(r: Rides) -> void:
	var D := data()
	for v: VehicleSim in r.vehicles:
		var src: Dictionary = D["vehicles"][v.id] if v.id < (D["vehicles"] as Array).size() else {}
		if String(src.get("model", "")) == "motoneige":
			v.def = v.def.duplicate(true)
			v.def["name"] = "MOTONEIGE"
			v.def["det"] = "la"
			v.def["model"] = "motoneige"

## Données de la vue (bâtiments, décor) : le plan brut.
static func layout() -> Dictionary:
	return data()
