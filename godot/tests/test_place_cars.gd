extends RefCounted
## v0.36.0 : cherche les emplacements des voitures conduisibles (CarSim.SPOTS) sur la carte de Strasbourg et les imprime (à recopier dans
## sim/car_sim.gd ; la suite j43 revérifie chaque emplacement). Outil, pas un test : absent de la liste des suites.
## Usage : godot --headless --path godot res://tests/runner.tscn -- --suite=place_cars
## Règle : dans la zone voulue, à moins de RADIUS m de son milieu ; caisse élargie de 0,6 m sans obstacle ni case de navigation bloquée, au sol
## de la rue (pas de marche) ; à 6 m au moins des voies du tram, 5 m des machines, armes murales, bornes, stations de vélos, parkings et
## motos, 6 m des portes ; 25 m dégagés devant (trois rayons : milieu et flancs), 6 m derrière. Score : dégagement devant (plafonné à 60 m),
## moins 0,3 x la distance au milieu de la zone.

const PLAN := [5, 16, 19, 0]   ## Place Kléber, Quai Schoepflin, Ancienne Douane (quai), Marché-Neuf (départ)
const RADIUS := 45.0

func run(tr: Node) -> void:
	var w := World.load_world()
	Game.mode = GameMode.CLASSIC
	Game.new_game(1, "strasbourg", [], w)
	var o: Dictionary = w.objects
	var keep: Array = []
	for m: Dictionary in o["machines"]:
		keep.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for ww: Dictionary in o["wallWeapons"]:
		keep.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
	for s: Dictionary in o["stations"]:
		keep.append(Vector2(float(s["x"]), float(s["z"])))
	for b: Dictionary in o["bikeStations"]:
		keep.append(Vector2(float(b["x"]), float(b["z"])))
	for pk: Dictionary in o["parkings"]:
		keep.append(Vector2(float(pk["x"]), float(pk["z"])))
	for v in Game.rides.vehicles:
		if not (v is CarSim):
			keep.append(Vector2(v.x, v.z))
	var doors: Array = []
	for d: Dictionary in w.doors:
		for p: Variant in d.get("points", []):
			if p is Dictionary:
				doors.append(Vector2(float(p["x"]), float(p["z"])))
			elif p is Array:
				doors.append(Vector2(float(p[0]), float(p[1])))
	var tracks: Array = Game.rides.net.get("tracks", [])
	var probe := CarSim.new(99, {"x": 0.0, "z": 0.0, "yaw": 0.0})
	probe.def = probe.def.duplicate(true)
	probe.def["width"] = float(probe.def["width"]) + 1.2
	probe.def["length"] = float(probe.def["length"]) + 1.2
	var found: Array = []
	for zi: int in PLAN:
		var L := ZoneLayout.build(w, zi)
		var c: Vector2 = L.centroid
		var best := {}
		var best_score := -INF
		var x := c.x - RADIUS
		while x <= c.x + RADIUS:
			var z := c.y - RADIUS
			while z <= c.y + RADIUS:
				if Vector2(x, z).distance_to(c) <= RADIUS and w.zone_of(x, z) == zi and not w.nav.is_blocked_at(x, z):
					var ok := true
					for k: Vector2 in keep:
						if k.distance_to(Vector2(x, z)) < 5.0:
							ok = false
							break
					for d: Vector2 in doors:
						if ok and d.distance_to(Vector2(x, z)) < 6.0:
							ok = false
					for t: TramTrack in tracks:
						if ok and float(t.project(x, z, 12.0, {})["d"]) < 6.0:
							ok = false
					if ok:
						for i in 48:
							var yw := TAU * i / 48.0
							var sc := _score(w, probe, x, z, yw, c)
							if sc > best_score:
								best_score = sc
								best = {"x": x, "z": z, "yaw": yw, "zone": zi}
				z += 1.0
			x += 1.0
		if best.is_empty():
			print("place-cars : zone %d (%s) : aucun emplacement" % [zi, w.zone_names[zi]])
			continue
		found.append(best)
		keep.append(Vector2(best["x"], best["z"]))
		print("place-cars : %s -> {\"x\": %.1f, \"z\": %.1f, \"yaw\": %.4f} score %.1f, %.0f m du milieu" % [w.zone_names[zi], best["x"], best["z"], best["yaw"], best_score, Vector2(best["x"], best["z"]).distance_to(c)])
	tr.check(found.size() >= 2, "place-cars : %d emplacements" % found.size())

func _score(w: World, probe: CarSim, x: float, z: float, yw: float, c: Vector2) -> float:
	probe.x = x
	probe.z = z
	probe.yaw = yw
	var hw := probe.half_w()
	var hl := probe.half_l()
	var R := hl + 1.0
	var items: Array = []
	w.collision.items_in(x - R, z - R, x + R, z + R, items)
	for it: Dictionary in items:
		if not w.collision.blocks(it, 0.1):
			continue
		var m: Vector3 = probe.mtv_circle(float(it["x"]), float(it["z"]), float(it["r"])) if it.has("r") else probe.mtv_segment(float(it["ax"]), float(it["az"]), float(it["bx"]), float(it["bz"]), x, z)
		if m.z > 0.0:
			return -INF
	var fx := -sin(yw)
	var fz := -cos(yw)
	var rx := cos(yw)
	var rz := -sin(yw)
	var fl := {"y": 0.0, "region": 0}
	var a := -hw
	while a <= hw + 1e-6:
		var b := -hl
		while b <= hl + 1e-6:
			var px := x + rx * a + fx * b
			var pz := z + rz * a + fz * b
			if w.nav.is_blocked_at(px, pz):
				return -INF
			w.floor_at(px, pz, 0.1, fl)
			if int(fl["region"]) != 0 or absf(float(fl["y"])) > 0.25:
				return -INF
			b += 0.5
		a += 0.5
	var ahead := 400.0
	var behind := 400.0
	for off in [-0.9, 0.0, 0.9]:
		ahead = minf(ahead, w.collision.ray_hit(x + rx * off, 0.5, z + rz * off, fx, 0.0, fz, 400.0))
		behind = minf(behind, w.collision.ray_hit(x + rx * off, 0.5, z + rz * off, -fx, 0.0, -fz, 400.0))
	if ahead < 25.0 or behind < 6.0:
		return -INF
	return minf(ahead, 60.0) - 0.3 * Vector2(x, z).distance_to(c)
