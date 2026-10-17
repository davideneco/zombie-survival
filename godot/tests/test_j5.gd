extends RefCounted
## J5 : véhicules et tram. Golden calculés par le JS (data/golden/j5.json : voies du tram et aiguillages, intérieur de la rame, physique des motos et vélos
## par Vehicle.drive, physique de la rame par Tram.drive, limites de vitesse), puis scénarios de partie sur la carte de Strasbourg (monter, conduire,
## écraser, essence, feu et épave, borne du parking, sous-station, portes de la rame, gong, rame comme cible).

const DT := 1.0 / 60.0
const TOL := 1e-6

var _g: Dictionary
var _scene_col: Collision

func run(t: Node) -> void:
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j5.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j5.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	var stub := J5Stub.new()
	stub.collision = Collision.new(10.0)
	var rides := Rides.new(stub)
	stub.rides = rides
	_golden_tracks(t, rides)
	_golden_interior(t)
	_scene_col = _build_scene(_g["vehicleScene"])
	_golden_roadkill(t)
	for sc: Dictionary in _g["vehicleScenarios"]:
		_golden_vehicle(t, sc)
	_golden_limits(t, rides)
	for sc: Dictionary in _g["tramScenarios"]:
		_golden_tram(t, sc)
	_game_vehicles(t)
	_game_damage(t)
	_game_pump(t)
	_game_tram(t)

static func _num(v: Variant, d: float) -> float:
	return d if v == null else float(v)

# ------------------------------------------------------------------ voies
func _golden_tracks(t: Node, rides: Rides) -> void:
	var by_id: Dictionary = rides.net["by_id"]
	for gt: Dictionary in _g["tracks"]:
		var id := String(gt["id"])
		t.check(by_id.has(id), "voie %s présente" % id)
		if not by_id.has(id):
			continue
		var tr: TramTrack = by_id[id]
		t.check(tr.n == int(gt["n"]), "voie %s : %d échantillons (JS %d)" % [id, tr.n, gt["n"]])
		t.near(tr.L, gt["L"], "voie %s : longueur" % id, TOL)
		t.near(_num(tr.min_radius(0, tr.L) if tr.min_radius(0, tr.L) != INF else null, -1.0), _num(gt["minR"], -1.0), "voie %s : rayon minimal" % id, TOL)
		var o := {}
		for s: Dictionary in gt["samples"]:
			tr.at(s["s"], o)
			var tag := "voie %s s=%.2f" % [id, s["s"]]
			t.near(o["x"], s["x"], tag + " x", TOL)
			t.near(o["z"], s["z"], tag + " z", TOL)
			t.near(o["tx"], s["tx"], tag + " tx", TOL)
			t.near(o["tz"], s["tz"], tag + " tz", TOL)
			t.near(o["yaw"], s["yaw"], tag + " yaw", TOL)
			if s["R"] == null:
				t.check(o["R"] == INF, tag + " R infini")
			else:
				t.near(o["R"], s["R"], tag + " R", 1e-5)
		var pr := {}
		for q: Dictionary in gt["proj"]:
			tr.project(q["x"], q["z"], q["max"], pr)
			var tag2 := "voie %s project(%.1f, %.1f)" % [id, q["x"], q["z"]]
			t.near(pr["s"], q["s"], tag2 + " s", TOL)
			if q["d"] == null:
				t.check(pr["d"] == INF, tag2 + " hors portée")
			else:
				t.near(pr["d"], q["d"], tag2 + " d", TOL)
				t.check(pr["side"] == q["side"], tag2 + " côté")
		if by_id[id].stops.size() > 0 or not gt["stops"].is_empty():
			t.check(tr.stops.size() == gt["stops"].size(), "voie %s : %d arrêts" % [id, gt["stops"].size()])
			for i in mini(tr.stops.size(), gt["stops"].size()):
				t.near(tr.stops[i]["s"], gt["stops"][i]["s"], "voie %s : arrêt %s" % [id, gt["stops"][i]["name"]], TOL)
	# aiguillage
	var J: Dictionary = _g["junction"]
	var jn: Dictionary = rides.net["junction"]
	t.near(jn["x"], J["x"], "aiguillage x", TOL)
	t.near(jn["z"], J["z"], "aiguillage z", TOL)
	for k: String in J["sNode"]:
		t.near(jn["sNode"][k], J["sNode"][k], "aiguillage sNode " + k, TOL)
	t.check(jn["routes"].size() == J["routes"].size(), "aiguillage : nombre d'itinéraires")
	for i in jn["routes"].size():
		var r: Dictionary = jn["routes"][i]
		var gr: Dictionary = J["routes"][i]
		t.check(r["id"] == gr["id"], "itinéraire %s" % gr["id"])
		t.near(r["track"].L, gr["L"], "itinéraire %s : longueur" % gr["id"], TOL)
		t.check(r["track"].n == int(gr["n"]), "itinéraire %s : échantillons" % gr["id"])
		t.near(r["connector"].L, gr["connectorL"], "itinéraire %s : raccord" % gr["id"], TOL)
		for k: String in ["sa", "sb", "da", "db", "theta", "r", "T", "a0", "a1"]:
			t.near(r["meta"][k], gr["meta"][k], "itinéraire %s : meta.%s" % [gr["id"], k], 1e-5)
		t.check(r["meta"]["aLine"] == gr["meta"]["aLine"] and r["meta"]["bLine"] == gr["meta"]["bLine"], "itinéraire %s : lignes" % gr["id"])

# ------------------------------------------------------------------ intérieur de la rame
func _golden_interior(t: Node) -> void:
	var I: Dictionary = _g["interior"]
	var vd := Rides.load_data()
	var seats: Array = []
	for st: Dictionary in vd["tram"]["carSeats"]:
		seats.append({"hip": st["hip"], "module": int(st["module"]), "driver": bool(st["driver"])})
	var K := TramInterior.interior_of(I["L"], I["M"], seats, vd["tram"]["doorStarts"])
	t.near(K["u_end"], I["uEnd"], "intérieur : uEnd", TOL)
	t.same(K["spans"], I["spans"], "intérieur : portes", TOL)
	t.same(K["boxes"], I["boxes"], "intérieur : boîtes", TOL)
	t.same(K["walls_closed"], I["wallsClosed"], "intérieur : parois fermées", TOL)
	t.same(K["walls_open"], I["wallsOpen"], "intérieur : parois ouvertes", TOL)
	t.same(K["seat_spots"], I["seatSpots"], "intérieur : sièges", TOL)
	var lists := [[K["boxes"], K["walls_closed"]], [K["boxes"], K["walls_open"]]]
	var W: Dictionary = Config.at("tram.walk")
	for p: Dictionary in I["pushes"]:
		var q := {"u": p["u"], "w": p["w"]}
		var best := TramInterior.push_out(lists[int(p["list"])], q, float(W["radius"]))
		t.near(q["u"], p["ru"], "pushOut u (%.2f, %.2f)" % [p["u"], p["w"]], TOL)
		t.near(q["w"], p["rw"], "pushOut w (%.2f, %.2f)" % [p["u"], p["w"]], TOL)
		t.near(best, p["best"], "pushOut poussée (%.2f, %.2f)" % [p["u"], p["w"]], TOL)
	for d: Dictionary in I["doors"]:
		t.check(TramInterior.door_index_at(K, d["u"], d["m"]) == int(d["i"]), "doorIndexAt(%.2f, %.2f)" % [d["u"], d["m"]])

# ------------------------------------------------------------------ motos et vélos
func _build_scene(sd: Dictionary) -> Collision:
	var col := Collision.new(float(sd["halfX"]), float(sd["halfZ"]), float(sd["cell"]))
	for s: Dictionary in sd["segs"]:
		col.add_segment(s["ax"], s["az"], s["bx"], s["bz"], _num(s["h"], INF), -INF, s["kind"])
	for c: Dictionary in sd["circles"]:
		col.add_circle(c["x"], c["z"], c["r"], _num(c["h"], INF), -INF, c["kind"])
	col.build()
	return col

func _golden_roadkill(t: Node) -> void:
	for e: Dictionary in _g["roadkill"]:
		var v := VehicleSim.new(0, e["type"], {"x": 0.0, "z": 0.0, "yaw": 0.0})
		t.near(v.roadkill_damage(e["sp"]), e["dmg"], "roadkillDamage %s %.1f" % [e["type"], e["sp"]], TOL)

func _golden_vehicle(t: Node, sc: Dictionary) -> void:
	var stub := J5Stub.new()
	stub.collision = _scene_col
	var models: Dictionary = Rides.load_data()["models"]
	var bikes: Array[VehicleSim] = []
	for i in sc["bikes"].size():
		var b: Dictionary = sc["bikes"][i]
		var v := VehicleSim.new(i, b["type"], {"x": b["x"], "z": b["z"], "yaw": b["yaw"]})
		v.wheel_radius = float(models[b["type"]]["wheelRadius"])
		v.seats[0] = 0
		if b.has("fuel"):
			v.fuel = b["fuel"]
		if b.has("driven"):
			v.seats[0] = 7 if b["driven"] else null
		bikes.append(v)
		stub.vehicles.append(v)
	for z: Dictionary in sc["zombies"]:
		var q := ZombieSim.new()
		q.id = int(z["id"])
		q.pos = Vector3(z["x"], 0.0, z["z"])
		q.health = z["health"]
		q.armor = _num(z.get("armor"), 1.0)
		stub.zombies.append(q)
	var me := bikes[0]
	var steps := roundi(float(sc["T"]) * 60.0)
	var si := 0
	var script: Array = sc["script"]
	var ti := 0
	var tag := "véhicule %s" % sc["name"]
	for k in steps:
		var tt := k * DT
		while si + 1 < script.size() and script[si + 1][0] <= tt + 1e-9:
			si += 1
		stub.time = (k + 1) * DT
		var inp: Dictionary = (script[si][1] as Dictionary).duplicate()
		inp["steer"] = signf(inp["steer"])   # le JS lit des touches : gauche / droite, sans demi-mesure
		me.update(DT, stub, inp, true)
		if k % 6 == 5:
			var row: Array = sc["trace"][ti]
			ti += 1
			var got := [stub.time, me.pos.x, me.pos.z, me.yaw, me.speed, me.lean, me.steer_angle, me.fuel, me.hp, me.wheel_rot, me.dyaw]
			if bikes.size() > 1:
				got.append(bikes[1].pos.x)
				got.append(bikes[1].pos.z)
			else:
				got.append(0.0)
				got.append(0.0)
			for j in row.size():
				t.near(got[j], row[j], "%s t=%.2f col %d" % [tag, stub.time, j], 1e-5)
	# journal : mêmes évènements dans le même ordre (dégâts, blessures, zombies touchés)
	var gl: Array = sc["log"]
	t.check(stub.log.size() == gl.size(), "%s : %d évènements (JS %d)" % [tag, stub.log.size(), gl.size()])
	for i in mini(stub.log.size(), gl.size()):
		var a: Array = stub.log[i]
		var b: Array = gl[i]
		t.check(String(a[0]) == String(b[0]), "%s : évènement %d type" % [tag, i])
		for j in range(1, mini(a.size(), b.size())):
			if typeof(b[j]) == TYPE_STRING or typeof(b[j]) == TYPE_BOOL:
				t.check(a[j] == b[j], "%s : évènement %d champ %d" % [tag, i, j])
			else:
				t.near(a[j], b[j], "%s : évènement %d champ %d" % [tag, i, j], 1e-5)
	t.near(me.pos.x, sc["final"]["x"], tag + " x final", 1e-5)
	t.near(me.pos.z, sc["final"]["z"], tag + " z final", 1e-5)
	for i in sc["final"]["zhealth"].size():
		t.near(stub.zombies[i].health, sc["final"]["zhealth"][i], tag + " santé du zombie %d" % i, 1e-5)

# ------------------------------------------------------------------ rame
func _golden_limits(t: Node, rides: Rides) -> void:
	var stub := J5Stub.new()
	stub.rides = rides
	rides.g = stub
	rides.forced_open.clear()
	var tr: TramSim = rides.trams[0]
	for e: Dictionary in _g["tramLimits"]:
		tr.track = rides.net["by_id"][e["line"]]
		tr.sw = 0
		tr.s = e["s"]
		var l := tr.limit(float(e["dir"]), stub)
		var tag := "limite %s s=%.1f dir %d" % [e["line"], e["s"], e["dir"]]
		if e["v"] == null:
			t.check(l["v"] == INF, tag + " illimitée")
		else:
			t.near(l["v"], e["v"], tag + " v", 1e-5)
		t.check(String(l["why"]) == (String(e["why"]) if e["why"] != null else ""), tag + " cause (%s / %s)" % [l["why"], e["why"]])
		t.near(l["d"], e["d"] if e["d"] != null else INF, tag + " d", 1e-5) if e["d"] != null else t.check(l["d"] == INF, tag + " d infinie")
		t.check(String(l["kind"]) == (String(e["kind"]) if e["kind"] != null else ""), tag + " nature")

func _golden_tram(t: Node, sc: Dictionary) -> void:
	var stub := J5Stub.new()
	stub.collision = _scene_col
	var rides := Rides.new(stub)
	stub.rides = rides
	rides.tram_powered = bool(sc["powered"])
	for d in sc["open"]:
		rides.forced_open[int(d)] = true
	var tr: TramSim = rides.trams[0]
	if sc["s0"] != null:
		tr.s = sc["s0"]
		tr.apply(null, true)
	tr.v = sc["v0"]
	tr.sw = int(sc["sw"])
	tr.door_open = bool(sc["doors0"])
	tr.door_f = 1.0 if tr.door_open else 0.0
	var seat := int(sc["seat"])
	if seat >= 0:
		tr.seats[seat] = 0
	for z: Dictionary in sc["zombies"]:
		var q := ZombieSim.new()
		q.id = int(z["id"])
		q.pos = Vector3(z["x"], 0.0, z["z"])
		q.health = z["health"]
		stub.zombies.append(q)
	var steps := roundi(float(sc["T"]) * 60.0)
	var script: Array = sc["script"]
	var si := 0
	var ti := 0
	var tag := "rame %s" % sc["name"]
	for k in steps:
		var tt := k * DT
		while si + 1 < script.size() and script[si + 1][0] <= tt + 1e-9:
			si += 1
		stub.time = (k + 1) * DT
		tr.update(DT, stub, script[si][1], seat)
		if k % 12 == 11:
			var row: Array = sc["trace"][ti]
			var got := [stub.time, tr.s, tr.v, tr.track.id, tr.sw, tr.door_f, tr.mods[0]["x"], tr.mods[0]["z"], tr.mods[4]["yaw"], tr.pos.x, tr.pos.z, tr.yaw]
			for j in row.size():
				if typeof(row[j]) == TYPE_STRING:
					t.check(got[j] == row[j], "%s t=%.2f voie %s / %s" % [tag, stub.time, got[j], row[j]])
				else:
					t.near(got[j], row[j], "%s t=%.2f col %d" % [tag, stub.time, j], 1e-5)
			var a := tr.approach()
			var ga: Variant = sc["approach"][ti]
			if ga == null:
				t.check(a.is_empty(), "%s t=%.2f : pas de nœud devant" % [tag, stub.time])
			elif a.is_empty():
				t.check(false, "%s t=%.2f : nœud attendu" % [tag, stub.time])
			else:
				t.check(a["arm"] == ga[0] and a["exit"] == ga[1] and a["locked"] == ga[3], "%s t=%.2f : bras %s / %s" % [tag, stub.time, a["arm"], ga[0]])
				t.near(a["dist"], ga[2], "%s t=%.2f : distance au nœud" % [tag, stub.time], 1e-5)
			ti += 1
	var announces: Array = []
	for e: Array in stub.log:
		if e[0] == "announce":
			announces.append(e)
	var gannounces: Array = []
	for e: Array in sc["log"]:
		if e[0] == "announce":
			gannounces.append(e)
	t.check(announces.size() == gannounces.size(), "%s : %d annonces (JS %d)" % [tag, announces.size(), gannounces.size()])
	var zl: Array = []
	for e: Array in stub.log:
		if e[0] == "zhit":
			zl.append(e)
	var gzl: Array = []
	for e: Array in sc["log"]:
		if e[0] == "zhit":
			gzl.append(e)
	t.check(zl.size() == gzl.size(), "%s : %d zombies fauchés (JS %d)" % [tag, zl.size(), gzl.size()])
	t.near(tr.s, sc["final"]["s"], tag + " s final", 1e-5)
	t.near(tr.v, sc["final"]["v"], tag + " v final", 1e-5)
	t.check(tr.track.id == sc["final"]["track"], tag + " voie finale")

# ------------------------------------------------------------------ parties sur la carte de Strasbourg
const FWD := {"mx": 0.0, "mz": 1.0}
const IDLE := {"mx": 0.0, "mz": 0.0}

func _new_game(seed_value := 7) -> Rides:
	Game.new_game(seed_value, "strasbourg", Config.at("startWeapons", []))
	Game.director.intermission = 1.0e9   # pas de zombies de manche : on place les nôtres
	return Game.rides

func _steps(n: int, input: Dictionary) -> void:
	for _i in n:
		Game.step(DT, input)

func _first(r: Rides, type: String) -> VehicleSim:
	for v in r.vehicles:
		if v.type == type:
			return v
	return null

## Cap de la machine vers le plus grand dégagement (rayon de collision), pour les essais de conduite en ligne droite.
func _open_heading(v: VehicleSim) -> float:
	var best := 0.0
	var best_yaw := 0.0
	for i in 72:
		var yw := TAU * i / 72.0
		var d := 400.0
		for off in [-0.9, 0.0, 0.9]:   # couloir de 1,8 m : la machine fait 1,1 m de large
			d = minf(d, Game.collision.ray_hit(v.x + cos(yw) * off, 0.5, v.z - sin(yw) * off, -sin(yw), 0.0, -cos(yw), 400.0))
		if d > best:
			best = d
			best_yaw = yw
	v.yaw = best_yaw
	return best

## Un vélo loin d'une borne de munitions et d'une arme murale (elles passent avant « monter »).
func _free_bike(r: Rides) -> VehicleSim:
	for v in r.vehicles:
		if v.type != "velo":
			continue
		_near(v)
		if not WeaponShop.near_station(Game) and WeaponShop.near_wall_weapon(Game).is_empty():
			return v
	return null

func _near(v: VehicleSim, dx := 1.2, dz := 0.6) -> void:
	Game.player.pos = Vector3(v.x + dx, 0.0, v.z + dz)
	Game.player.vel = Vector3.ZERO

func _game_vehicles(t: Node) -> void:
	var r := _new_game()
	var vd := Rides.load_data()
	t.check(r.vehicles.size() == vd["vehicles"].size() and r.vehicles.size() == 26, "26 véhicules posés (3 motos, 23 vélos) : %d" % r.vehicles.size())
	t.check(r.trams.size() == 1, "une rame")
	t.near(r.trams[0].pos.x, vd["tram"]["start"]["x"], "rame : position de départ x", 1e-4)
	t.near(r.trams[0].pos.z, vd["tram"]["start"]["z"], "rame : position de départ z", 1e-4)
	t.near(r.trams[0].yaw, vd["tram"]["start"]["yaw"], "rame : cap de départ", 1e-4)
	t.near(r.trams[0].s, vd["tram"]["start"]["s"], "rame : abscisse de départ", 1e-4)
	t.check(r.gates_by.get("BCF", []).size() > 4 and r.gates_by.has("BW>AS"), "portes de zone sur les voies, aiguillages compris")
	# --- moto : monter, rouler, descendre
	var m := _first(r, "moto")
	t.check(_open_heading(m) > 40.0, "(essai) dégagement de 40 m devant la moto")
	_near(m)
	t.check(r.prompt().contains("Monter sur la moto"), "invite : monter sur la moto (« %s »)" % r.prompt())
	Game.interact()
	t.check(r.ride != null and r.ride["v"] == m and int(r.ride["seat"]) == 0, "E près de la moto : conducteur")
	t.check(m.seats[0] != null and Game.player.attached, "la place est prise, le joueur est attaché")
	var fuel0 := m.fuel
	_steps(150, FWD)
	t.check(m.speed > 11.0 and m.speed <= float(m.def["maxSpeed"]) + 1e-6, "moto en accélération (%.1f m/s après 2,5 s)" % m.speed)
	t.check(m.fuel < fuel0, "l'essence baisse (%.3f -> %.3f)" % [fuel0, m.fuel])
	var hip := m.hip_world(0)
	t.near(Game.player.pos.x, hip.x, "le joueur suit la selle (x)", 1e-3)
	t.near(Game.player.pos.z, hip.z, "le joueur suit la selle (z)", 1e-3)
	t.check(Game.rides.driving(), "conducteur : aux commandes")
	var ammo := Game.weapon.ammo
	_steps(30, {"mx": 0.0, "mz": 1.0, "fire": true})
	t.check(Game.weapon.ammo == ammo, "le conducteur ne tire pas")
	var before := m.pos
	Game.interact()
	t.check(r.ride == null and m.seats[0] == null and not Game.player.attached, "E assis : on descend")
	t.check(m.speed == 0.0, "la moto s'arrête quand le conducteur descend")
	t.check(Vector2(Game.player.pos.x - before.x, Game.player.pos.z - before.z).length() < 3.0, "on descend à côté de la moto")
	_steps(60, IDLE)
	t.near(m.x, before.x, "moto garée : immobile (x)", 1e-5)
	# --- panne sèche : poussée au pas
	m.reset()
	_open_heading(m)
	m.fuel = 0.0
	_near(m)
	Game.interact()
	t.check(r.ride != null, "(panne sèche) monté")
	_steps(240, FWD)
	t.check(m.speed <= float(Config.at("vehicles.fuel.pushSpeed")) + 1e-6 and m.speed > 1.0, "panne sèche : poussée à %.1f m/s" % m.speed)
	Game.interact()
	# --- vélo : gratuit, sans réservoir
	var b := _free_bike(r)
	t.check(b != null, "(essai) un vélo accessible")
	t.check(_open_heading(b) > 40.0, "(essai) dégagement de 40 m devant le vélo")
	_near(b)
	t.check(r.ride == null, "(vélo) personne en selle avant")
	t.check(r.prompt().contains("vélo"), "invite : monter sur le vélo (« %s »)" % r.prompt())
	Game.interact()
	t.check(r.ride != null and r.ride["v"].type == "velo", "monter sur le vélo")
	b = r.ride["v"]   # (deux vélos par station : le plus proche part)
	_steps(240, FWD)
	t.check(b.speed > 7.0 and b.speed <= 12.0 + 1e-6, "vélo : %.1f m/s (max 12)" % b.speed)
	t.check(b.fuel == 0.0 and b.fuel_frac() == 1.0, "vélo : pas de réservoir")
	Game.interact()
	# --- grosse moto : passager
	var gm := _first(r, "grosseMoto")
	gm.seats.fill(null)
	Game.player.pos = Vector3(gm.x + 1.0, 0.0, gm.z)
	r.try_mount(gm, 1)
	t.check(r.ride != null and int(r.ride["seat"]) == 1 and not r.driving(), "grosse moto : passager (ne conduit pas)")
	var ammo2 := Game.weapon.ammo
	_steps(5, {"mx": 0.0, "mz": 0.0, "fire": true})
	t.check(Game.weapon.ammo < ammo2, "le passager peut tirer (%d -> %d)" % [ammo2, Game.weapon.ammo])
	Game.interact()
	# --- écraser un zombie
	m = _first(r, "moto")
	m.reset()
	_open_heading(m)
	Game.player.pos = Vector3(m.x + 1.0, 0.0, m.z)
	Game.interact()
	var z := Game.debug_spawn(Vector3(m.x - sin(m.yaw) * 30.0, 0.0, m.z - cos(m.yaw) * 30.0), 0.01)
	z.health = 70.0
	z.max_health = 70.0
	var pts := Game.points
	var kills := Game.kills
	_steps(240, FWD)
	t.check(z.dead, "zombie écrasé à %.1f m/s" % m.speed)
	t.check(Game.kills == kills + 1 and Game.points > pts, "écrasement : mort et points (%d -> %d)" % [pts, Game.points])
	t.check(m.hp < m.max_hp() and m.hp >= m.max_hp() - 6.0, "la moto perd %d PV" % int(m.max_hp() - m.hp))
	# --- zombie lent : la moto est arrêtée
	var z2 := Game.debug_spawn(Vector3(m.x - sin(m.yaw) * 12.0, 0.0, m.z - cos(m.yaw) * 12.0), 0.01)
	z2.health = 1.0e6
	z2.max_health = 1.0e6
	m.speed = 3.0
	_steps(180, FWD)
	t.check(not z2.dead and m.speed < 2.0, "zombie trop lent à écraser : la moto est freinée (%.2f m/s)" % m.speed)
	Game.interact()
	Game.zombies.clear()

func _game_damage(t: Node) -> void:
	var r := _new_game(11)
	var m := _first(r, "moto")
	_near(m)
	Game.interact()
	var pv := Game.player.health
	t.check(r.ride != null, "(feu) monté")
	Game.damage_vehicle(m, 100.0, "test")
	t.check(m.state == "ok" and absf(m.hp - 200.0) < 1e-9, "dégâts : PV 300 -> 200")
	Game.damage_vehicle(m, 500.0, "test")
	t.check(m.state == "burning" and m.hp == 0.0, "0 PV : en feu")
	_steps(10, FWD)
	t.check(m.throttle == 0.0, "en feu : moteur coupé")
	_steps(130, IDLE)
	t.check(m.state == "wreck", "après burnTime : épave (%s)" % m.state)
	t.check(r.ride == null and not Game.player.attached, "le joueur est éjecté")
	t.check(Game.player.health >= 1.0 and Game.player.health < Game.player.max_health + 1.0, "l'explosion ne tue jamais (PV %.0f)" % Game.player.health)
	t.check(m.respawn_round == Game.round_number + int(Config.at("vehicles.damage.respawnRounds")), "retour dans 2 manches (manche %d)" % m.respawn_round)
	t.check(r.prompt() == "" or not r.prompt().contains("Monter sur la moto"), "on ne monte pas sur une épave")
	# retour au parking
	_steps(60 * 21, IDLE)
	t.check(m.state == "gone", "épave disparue après wreckTime (%s)" % m.state)
	Game.director.round_number = m.respawn_round
	Game.player.pos = Vector3(m.spawn["x"] + 30.0, 0.0, m.spawn["z"])
	r.on_round_start()
	_steps(5, IDLE)
	t.check(m.state == "ok" and m.hp == m.max_hp(), "la manche de retour : la moto revient")
	t.near(m.x, m.spawn["x"], "revient à son emplacement", 1e-9)
	t.near(m.fuel, float(m.def["tank"]) * float(Config.at("vehicles.fuel.respawn")), "revient avec 40 % d'essence", 1e-9)
	# vélo : cassé, pas d'incendie
	var b := _free_bike(r)
	_near(b)
	Game.interact()
	t.check(r.ride != null and r.ride["v"].type == "velo", "(vélo cassé) monté")
	b = r.ride["v"]
	Game.damage_vehicle(b, 1000.0, "test")
	t.check(b.state == "wreck" and r.ride == null, "vélo : cassé tout de suite, le cycliste chute")
	t.check(b.respawn_round == Game.round_number + 1, "vélo : retour à la manche suivante")
	# explosion d'une autre machine : 10 % des dégâts aux motos proches
	var m2 := _first(r, "grosseMoto")
	var hp0 := m2.hp
	r.damage_in_radius(m2.pos + Vector3(2, 0, 0), 5.0, 1000.0)
	t.check(m2.hp < hp0 and hp0 - m2.hp <= 100.0 * 0.9, "explosion proche : la moto perd %.1f PV" % (hp0 - m2.hp))

func _game_pump(t: Node) -> void:
	var r := _new_game(13)
	var pk: Dictionary = r.parkings[0]
	var m := _first(r, "moto")
	m.hp = 100.0
	m.fuel = 3.0
	Game.player.pos = Vector3(pk["pump"]["x"] + 1.0, 0.0, pk["pump"]["z"])
	var np := r.near_pump()
	t.check(not np.is_empty() and np["v"] != null, "borne : une moto à portée")
	t.check(r.prompt().contains("Plein"), "invite de la borne (« %s »)" % r.prompt())
	var sv := r.service_of(m)
	var cost := int(ceil(200.0 * 2.0 + 3.0 * 50.0 - 1e-6))
	t.check(int(sv["cost"]) == cost, "coût du plein + réparation : %d pts (attendu %d)" % [sv["cost"], cost])
	Game.points = cost - 1
	Game.interact()
	t.check(m.hp == 100.0 and Game.points == cost - 1, "pas assez de points : rien ne change")
	Game.points = 1000
	Game.interact()
	t.check(m.hp == m.max_hp() and m.fuel == float(m.def["tank"]) and Game.points == 1000 - cost, "plein + réparation payés")
	Game.interact()
	t.check(Game.points == 1000 - cost, "déjà en parfait état : gratuit et sans effet")

func _game_tram(t: Node) -> void:
	var r := _new_game(17)
	var tr: TramSim = r.trams[0]
	var ss: Dictionary = r.substation
	t.check(not ss.is_empty(), "sous-station posée")
	Game.player.pos = Vector3(ss["x"] + 1.5, 0.0, ss["z"] + 1.0)
	t.check(r.near_substation() and r.prompt().contains("courant"), "invite de la sous-station (« %s »)" % r.prompt())
	Game.points = 1500
	Game.interact()
	t.check(not r.tram_powered and Game.points == 1500, "1500 pts < 2000 : refusé")
	Game.points = 2500
	Game.interact()
	t.check(r.tram_powered and Game.points == 500, "sous-station payée une fois (2000 pts)")
	Game.interact()
	t.check(Game.points == 500, "pas de second paiement")
	# monter dans la cabine avant : à moins de 4 m du nez
	var nose: Dictionary = tr.mods[tr.n - 1]
	Game.player.pos = Vector3(nose["x"] + nose["tx"] * (tr.M / 2.0 + 1.0), 0.0, nose["z"] + nose["tz"] * (tr.M / 2.0 + 1.0))
	var nv := r.near_vehicle()
	t.check(not nv.is_empty() and nv["v"] == tr and int(nv["seat"]) == 0, "près du nez : cabine avant")
	Game.interact()
	t.check(r.ride != null and r.ride["v"] == tr and r.driving(), "conducteur de la rame")
	# portes fermées au départ : elle roule, freine devant la porte de zone fermée
	_steps(60 * 3, FWD)
	t.check(tr.v > 1.0, "la rame accélère (%.2f m/s)" % tr.v)
	_steps(60 * 60, FWD)
	var gate: Dictionary = r.tram_gates("BCF")[0]
	var first_closed := INF
	for gt in r.tram_gates("BCF"):
		if float(gt["s"]) > tr.s - 1.0 and not r.gate_open(gt) and float(gt["s"]) < first_closed:
			first_closed = float(gt["s"])
	t.check(tr.s <= first_closed - 2.5 - tr.L / 2.0 + 0.05, "la rame s'arrête avant la porte de zone fermée (s %.1f, porte %.1f)" % [tr.s, first_closed])
	t.check(absf(tr.v) < 0.1, "arrêtée (%.2f m/s)" % tr.v)
	# ouvrir la porte de zone : le passage est libre
	var door := int(gate["door"])
	for gt in r.tram_gates("BCF"):
		if absf(float(gt["s"]) - first_closed) < 1e-6:
			door = int(gt["door"])
	Game.world.open_door(door)
	var s_before := tr.s
	_steps(60 * 8, FWD)
	t.check(tr.s > s_before + 20.0, "porte de zone ouverte : la rame repart (%.1f -> %.1f)" % [s_before, tr.s])
	# gong
	t.check(r.lure.is_empty(), "pas de gong avant")
	r.tram_gong()
	t.check(not r.lure.is_empty() and tr.gong_cd > 0.0, "gong : appât posé")
	var lure_t := float(r.lure["t"])
	_steps(60, IDLE)
	t.check(float(r.lure["t"]) < lure_t - 0.9 and absf(float(r.lure["x"]) - tr.pos.x) < 1e-9, "l'appât suit la rame")
	r.tram_gong()
	t.check(is_equal_approx(float(r.lure["t"]), lure_t - 1.0) or float(r.lure["t"]) < lure_t, "recharge : pas de second gong tout de suite")
	_steps(60 * 9, IDLE)
	t.check(r.lure.is_empty(), "l'appât expire après 8 s")
	# l'appât attire un zombie qui poursuivait le joueur, même loin de la rame
	Game.zombies.clear()
	var z := Game.debug_spawn(Vector3(Game.player.pos.x, 0.0, Game.player.pos.z + 20.0), 1.5)
	r.lure = {"x": z.pos.x + 30.0, "z": z.pos.z, "t": 8.0, "range": 50.0}
	var d0 := Vector2(z.pos.x - float(r.lure["x"]), z.pos.z - float(r.lure["z"])).length()
	_steps(60, IDLE)
	var d1 := Vector2(z.pos.x - float(r.lure["x"]), z.pos.z - float(r.lure["z"])).length()
	t.check(d1 < d0 - 0.5, "le gong attire le zombie (%.1f m -> %.1f m)" % [d0, d1])
	r.lure = {}
	Game.zombies.clear()
	# aiguillage : la rame est arrêtée sur la ligne ; touche B
	tr.v = 0.0
	tr.hint_dir = 1.0
	var a := tr.approach()
	if not a.is_empty() and not bool(a["locked"]):
		var sw0 := tr.sw
		r.tram_switch()
		t.check(tr.sw != sw0, "touche B : l'aiguillage bascule (%d -> %d)" % [sw0, tr.sw])
		r.tram_switch()
	# se lever, portes, marcher dans la rame, s'asseoir
	tr.v = 0.0
	Game.interact()
	t.check(r.ride == null and r.on_tram != null, "E assis dans la rame : on se lève, debout dedans")
	t.check(Game.player.attached, "(debout) le joueur reste attaché à la rame")
	r.tram_doors()
	t.check(tr.door_open, "touche O : portes ouvertes (rame arrêtée, personne aux commandes)")
	_steps(120, IDLE)
	t.check(tr.door_f >= 1.0 - 1e-9 and tr.walk_open(), "portes entièrement ouvertes")
	# marcher vers la porte et descendre : poussée latérale
	var I := tr.interior
	var spans: Array = I["spans"]
	var u_mid: float = (spans[0][0] + spans[0][1]) / 2.0
	r.place_in_tram(tr, u_mid, 0.3)
	var f := {}
	tr.frame(u_mid, f)
	var right := Vector3(-f["tz"], 0.0, f["tx"])
	var yaw_right := atan2(-right.x, -right.z)   # regarde vers la droite de la rame
	Game.player.yaw = yaw_right
	_steps(90, FWD)
	t.check(r.on_tram == null and not Game.player.attached, "marcher dans l'ouverture : on descend à pied")
	var lw := {}
	tr.world_to_walk(Game.player.pos.x, Game.player.pos.z, lw)
	t.check(absf(lw["w"]) > float(Config.at("tram.walk.exitW")) - 0.3, "descendu hors de la caisse (w = %.2f)" % lw["w"])
	# monter à pied en poussant contre la porte ouverte
	var side := signf(lw["w"])
	tr.world_to_walk(Game.player.pos.x, Game.player.pos.z, lw)
	var spot := tr.walk_to_world(u_mid, side * 2.0, 0.0)
	Game.player.pos = spot
	var to_rail := tr.walk_to_world(u_mid, 0.0, 0.0)
	Game.player.yaw = atan2(-(to_rail.x - spot.x), -(to_rail.z - spot.z))
	var nd := r.near_open_door()
	t.check(not nd.is_empty() and nd.get("foot", false), "porte ouverte à portée : invite de monter à pied")
	Game.interact()
	t.check(r.on_tram != null and r.ride == null, "E : on monte à pied par la porte ouverte")
	_steps(40, IDLE)
	# s'asseoir : un siège à portée
	var sp0: Dictionary = I["seat_spots"][2]
	r.place_in_tram(tr, sp0["u"], float(sp0["side"]) * 0.3)
	var ns := r.near_seat_inside()
	t.check(not ns.is_empty() and r.prompt().contains("S'asseoir"), "siège libre à portée (« %s »)" % r.prompt())
	Game.interact()
	t.check(r.ride != null and int(r.ride["seat"]) >= 2 and not r.driving(), "assis comme passager (place %d)" % int(r.ride["seat"]))
	var pos_seat := Game.player.pos
	var hipw := tr.hip_world(int(r.ride["seat"]))
	t.near(pos_seat.x, hipw.x, "passager : sur son siège (x)", 1e-3)
	# la rame comme cible : portes ouvertes, un zombie va à la porte ; fermées, la caisse encaisse
	Game.interact()   # on se lève
	t.check(r.on_tram != null, "(cible) debout dans la rame")
	r.place_in_tram(tr, 0.0, 0.0)
	var zp := tr.walk_to_world(u_mid + 6.0, 4.0, 0.0)
	var zt := Game.debug_spawn(zp, 1.5)
	var goal := r.tram_goal(zt)
	t.check(not goal.is_empty(), "portes ouvertes : le zombie vise une porte")
	if not goal.is_empty():
		var gw := {}
		tr.world_to_walk(goal["x"], goal["z"], gw)
		t.near(absf(gw["w"]), tr.width / 2.0 + float(Config.at("tram.walk.doorSpot")), "…à doorSpot m de la caisse", 1e-2)
		t.check(gw["w"] > 0.0 == (tr.world_to_walk(zp.x, zp.z, lw)["w"] > 0.0), "…du même côté que lui")
	zt.pos = tr.walk_to_world((spans[1][0] + spans[1][1]) / 2.0, 1.75, 0.0)
	t.check(not r.tram_shield(zt), "devant une porte ouverte : le joueur est touché")
	zt.pos = tr.walk_to_world((spans[1][1] + spans[2][0]) / 2.0, 1.75, 0.0)
	t.check(r.tram_shield(zt), "entre deux portes : la caisse encaisse")
	tr.door_open = false
	_steps(120, IDLE)
	t.check(tr.door_f == 0.0 and r.tram_goal(zt).is_empty() and r.tram_shield(zt), "portes fermées : pas de porte visée, la caisse encaisse")
	# coups de zombie sur la caisse : le joueur ne perd rien, la rame perd 2 PV par coup
	r.place_in_tram(tr, 0.0, 0.8)
	Game.zombies.clear()
	var zs := Game.debug_spawn(tr.walk_to_world(0.0, 3.0, 0.0), 1.5)
	zs.health = 1.0e6
	zs.max_health = 1.0e6
	var hp0 := Game.player.health
	var tram_hp0 := tr.hp
	_steps(60 * 5, IDLE)
	t.check(Game.player.health == hp0, "coups sur la caisse : le joueur n'est pas touché (PV %.0f)" % Game.player.health)
	t.check(tr.hp < tram_hp0 and fmod(tram_hp0 - tr.hp, 2.0) == 0.0, "la rame perd 2 PV par coup (%.0f -> %.0f)" % [tram_hp0, tr.hp])
	Game.zombies.clear()
	# hors service à 0 PV
	Game.damage_vehicle(tr, 1.0e6, "test")
	t.check(tr.state == "wreck" and tr.respawn_round == Game.round_number + 2, "0 PV : la rame est hors service jusqu'au dépôt")
	Game.director.round_number = tr.respawn_round
	r.on_round_start()
	Game.player.pos = Vector3(0, 0, 0)
	r.tram_walk_off()
	_steps(5, IDLE)
	t.check(tr.state == "ok" and tr.hp == tr.max_hp() and absf(tr.s - tr.start_s) < 1e-9, "retour au dépôt : PV pleins, abscisse de départ")
