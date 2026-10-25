class_name Rides
extends RefCounted
## Motos, vélos et tram : la partie « hôte » de src/vehicles.js (installVehicles), src/tram.js (installTram) et src/tramInterior.js (installTramWalk), en solo.
## Les véhicules (VehicleSim) et la rame (TramSim) sont des objets purs ; ici : places, monter / descendre, points de vie, feu, explosion, épave et
## retour au parking, borne de service, sous-station, gong, portes de zone sur la voie, marche dans la rame, caméra externe.
## Les données du monde viennent de data/world/vehicles.json (tools/bake-vehicles.mjs) ; les voies se recalculent depuis CONFIG.tram.
## `g` est l'hôte (autoload Game ou doublure de test) : player, collision, world, zombies, time, points, rng, shake, round_number, announce(), explosion…

const DATA := "res://data/world/vehicles.json"

static var _data_cache: Dictionary = {}

var g: Object
var data: Dictionary
var vehicles: Array[VehicleSim] = []
var trams: Array[TramSim] = []
var parkings: Array = []        ## [{ name, x, z, pump: {x, z, yaw}, sign: {x, z} }]
var bike_stations: Array = []   ## [{ x, z, yaw, size, zone, name }]
var signals: Array = []         ## têtes de signal de l'aiguillage ({ arm, side, x, z, tx, tz }, cuites par tools/bake-vehicles.mjs) : le port redessine leurs feux
var net: Dictionary = {}        ## { tracks, by_id (lignes et itinéraires), junction }
var gates_by: Dictionary = {}   ## voie -> [{ line, s, door (indice de porte de zone), decor }]
var substation: Dictionary = {}
var tram_powered := false
var lure: Dictionary = {}       ## gong du tram : { x, z, t, range } ; {} sans gong
var ride: Variant = null        ## { v, seat } quand le joueur est assis (moto, vélo ou place de la rame), sinon null
var on_tram: Variant = null     ## { v, u, w, y, fy } quand le joueur est debout dans la rame
var cam := RideCam.new()
var tram_warn_until := 0.0
var forced_open: Dictionary = {}   ## tests : indices de portes de zone tenues ouvertes (sans monde)
var _vel_in := {}

static func load_data() -> Dictionary:
	if _data_cache.is_empty():
		var f := FileAccess.open(DATA, FileAccess.READ)
		if f == null:
			push_error("Rides : %s illisible (tools/bake-vehicles.mjs)" % DATA)
			return {}
		_data_cache = JSON.parse_string(f.get_as_text())
	return _data_cache

func _init(g_: Object, data_: Dictionary = {}) -> void:
	g = g_
	data = data_ if not data_.is_empty() else load_data()
	var models: Dictionary = data["models"]
	for sp: Dictionary in data["vehicles"]:
		var v := VehicleSim.new(int(sp["id"]), String(sp["type"]), sp)
		var m: Dictionary = models[v.type]
		v.wheel_radius = float(m["wheelRadius"])
		for st: Dictionary in m["seats"]:
			v.model_seats.append({"hip": st["hip"], "eye": st["eye"], "ry": float(st["ry"])})
		vehicles.append(v)
	# v0.36.0 : voitures conduisibles (Strasbourg : CarSim.SPOTS ; une doublure de test peut en donner dans data.cars)
	var spots: Array = data.get("cars", CarSim.SPOTS if data_.is_empty() else [])
	var next_id := 0
	for v in vehicles:
		next_id = maxi(next_id, v.id + 1)
	for sp: Dictionary in spots:
		vehicles.append(CarSim.new(next_id, sp))
		next_id += 1
	sync_car_boxes()
	for pk: Dictionary in data["parkingsFull"]:
		parkings.append(pk)
	bike_stations = data["bikeStations"]
	_build_tram()

func _build_tram() -> void:
	var T: Dictionary = Config.at("tram")
	var td: Variant = data.get("tram")
	if td == null:
		return
	net = TramTrack.build_tracks(T)
	var by_id: Dictionary = net["by_id"]
	var jn := TramTrack.build_junction(T["junction"], by_id, float(T.get("step", 1.0))) if T.has("junction") else {}
	net["junction"] = jn
	if not jn.is_empty():
		for rt: Dictionary in jn["routes"]:
			by_id[rt["id"]] = rt["track"]
	for t: TramTrack in net["tracks"]:
		var list: Array = []
		for st: Dictionary in t.def.get("stops", []):
			var e: Dictionary = st.duplicate()
			e["line"] = t.id
			e["s"] = t.project(st["at"][0], st["at"][1], 80.0, {})["s"]
			list.append(e)
		list.sort_custom(func(a, b): return a["s"] < b["s"])
		t.stops = list
	var line: TramTrack = by_id[T["car"]["start"]["line"]]
	var stop: Dictionary = line.stops[0]
	for st: Dictionary in line.stops:
		if st["name"] == T["car"]["start"]["stop"]:
			stop = st
	var t0 := TramSim.new(0, net, line, float(stop["s"]), td)
	t0.reset(null)
	t0.spawn = {"x": t0.pos.x, "z": t0.pos.z, "yaw": t0.yaw}
	trams.append(t0)
	for gt: Dictionary in td["gates"]:
		if not gates_by.has(gt["line"]):
			gates_by[gt["line"]] = []
		gates_by[gt["line"]].append(gt)
	for rid: String in td.get("routeGates", {}):
		gates_by[rid] = (td["routeGates"][rid] as Array).duplicate()
	# rames de décor de l'Homme de Fer : des obstacles fixes (comme des portes fermées, un de chaque bout) sur la voie de la rame, lignes et itinéraires
	var o := {}
	var ps := {}
	for d: Dictionary in td.get("decor", []):
		for tid: String in by_id:
			var trk: TramTrack = by_id[tid]
			var on_line: bool = trk.id == d["line"]
			for s_end: float in [d["lo"], d["hi"]]:
				var sv := -1.0
				if on_line:
					sv = s_end
				else:
					(by_id[d["line"]] as TramTrack).at(s_end, o)
					var p := trk.project(o["x"], o["z"], 3.0, ps)
					if p["d"] < 1.0:
						sv = p["s"]
				if sv >= 0.0:
					if not gates_by.has(trk.id):
						gates_by[trk.id] = []
					gates_by[trk.id].append({"line": trk.id, "s": sv, "door": -1, "decor": true})
	substation = td["substation"] if td["substation"] != null else {}
	signals = td.get("signals", [])

# ------------------------------------------------------------------ accès
func all_rides() -> Array:
	var out: Array = []
	out.append_array(vehicles)
	out.append_array(trams)
	return out

func tram_gates(track_id: String) -> Array:
	return gates_by.get(track_id, [])

func gate_open(gt: Dictionary) -> bool:
	if bool(gt.get("decor", false)):
		return false
	if forced_open.has(int(gt["door"])):
		return true
	if g.world == null:
		return false
	return bool(g.world.doors[int(gt["door"])]["open"])

## La rame (ou null) où le joueur est assis ou debout.
func tram_of_player() -> TramSim:
	if ride != null and ride["v"].is_tram():
		return ride["v"]
	if on_tram != null:
		return on_tram["v"]
	return null

## Ce à quoi le joueur est solidaire (véhicule assis ou rame debout), ou null.
func ride_of_player() -> Object:
	if ride != null:
		return ride["v"]
	if on_tram != null:
		return on_tram["v"]
	return null

func attached() -> bool:
	return ride != null or on_tram != null

## Aux commandes d'une moto ou d'une rame : pas de tir, pas de rechargement.
func driving() -> bool:
	return ride != null and ride["v"].is_driver(ride["seat"])

# ------------------------------------------------------------------ pas de simulation
## Entrées : { mx, mz, sprint, jump, fire, reload, knife… } comme Game.step. Appelé AVANT le pas du joueur.
func step(dt: float, input: Dictionary) -> void:
	var p: PlayerSim = g.player
	if p.dead and attached():
		if ride != null:
			leave_vehicle(true)
		else:
			tram_walk_off()
	_vel_in = {"fwd": float(input.get("mz", 0.0)) > 0.0, "back": float(input.get("mz", 0.0)) < 0.0, "hb": bool(input.get("jump", false)),
		"steer": float(input.get("mx", 0.0)), "emg": bool(input.get("jump", false))}
	for v in vehicles:
		var driven: bool = v.state != "wreck" and v.seats[0] != null
		v.update(dt, g, _vel_in if driven else {}, driven)
		_drain_events(v)
	sync_car_boxes()
	for t in trams:
		var seat := -1
		if ride != null and ride["v"] == t and int(ride["seat"]) <= 1:
			seat = int(ride["seat"])
		t.update(dt, g, _vel_in, seat)
		_drain_events(t)
	if not lure.is_empty():
		lure["t"] -= dt
		var src: Object = lure.get("v", trams[0] if not trams.is_empty() else null)   # v0.36.0 : le klaxon suit sa voiture, le gong la rame
		if src != null:
			lure["x"] = src.pos.x
			lure["z"] = src.pos.z
		if lure["t"] <= 0.0:
			lure = {}
	for r in all_rides():
		_host_tick(r, dt)
	# le joueur : sur la selle, ou debout dans la rame
	if ride != null:
		var v: Object = ride["v"]
		var hip: Vector3 = v.hip_world(int(ride["seat"]))
		p.pos = Vector3(hip.x, v.pos.y, hip.z)
		p.vel = Vector3.ZERO
		p.vy = 0.0
		p.moving = false
		p.sprinting = false
		p.yaw += v.seat_dyaw(int(ride["seat"]))
		cam.steer(dt, ride, g.time - p.last_mouse, p)
	elif on_tram != null:
		_tram_walk_input(dt, input)
		tram_walk_step(dt)
	update_tram_boarding()
	# caméra
	var foot := p.pos + Vector3(0, float(Config.at("player.eye")), 0)
	cam.update(dt, ride, foot, p, bool(input.get("aim", false)), g)
	if ride != null:
		p.eye_override = cam.cam_pos if cam.placed else (ride["v"] as Object).eye_world(int(ride["seat"]))
	else:
		p.eye_override = cam.cam_pos if cam.placed else Vector3.INF

## Vitesse du joueur debout dans la rame : mêmes formules que PlayerSim.step.
func _tram_walk_input(dt: float, input: Dictionary) -> void:
	var p: PlayerSim = g.player
	var mx: float = input.get("mx", 0.0)
	var mz: float = input.get("mz", 0.0)
	p.moving = mx != 0.0 or mz != 0.0
	p.sprinting = bool(input.get("sprint", false)) and mz > 0.0
	var speed: float = float(Config.at("player.sprintSpeed")) if p.sprinting else float(Config.at("player.walkSpeed"))
	if p.moving:
		var l := sqrt(mx * mx + mz * mz)
		mx /= l
		mz /= l
	var sn := sin(p.yaw)
	var cs := cos(p.yaw)
	var k := minf(1.0, dt * Rules.MOVE_ACCEL)
	p.vel.x += ((cs * mx - sn * mz) * speed - p.vel.x) * k
	p.vel.z += ((-sn * mx - cs * mz) * speed - p.vel.z) * k

func _drain_events(r: Object) -> void:
	if r.events.is_empty():
		return
	for e in r.events:
		match e:
			"cough":
				g.ride_event.emit("cough", {"v": r})
			"beep":
				g.ride_event.emit("beep", {"v": r})
			"dry":
				g.announce("PANNE SÈCHE", "Plus d'essence : %s %s n'avance plus qu'au pas" % [String(r.def.get("det", "la")), String(r.def["name"]).to_lower()])
				g.ride_event.emit("dry", {"v": r})
			_:
				if String(e).begins_with("crash:"):
					g.ride_event.emit("crash", {"v": r, "level": float(String(e).substr(6))})
				else:
					g.ride_event.emit(String(e), {"v": r})
	r.events.clear()

# ------------------------------------------------------------------ points de vie, feu, épave (hôte)
## amt : dégâts (PV) ; src : "crash" | "roadkill" | "zombie" | "blast" (informatif).
func damage_vehicle(v: Object, amt: float, _src := "") -> void:
	if not (amt > 0.0) or v == null or v.state != "ok":
		return
	v.hp = maxf(0.0, v.hp - amt)
	if v.hp <= 0.0:
		ignite(v)

## Explosions : les motos subissent explosion x les dégâts infligés aux zombies, avec la même atténuation.
func damage_in_radius(pos: Vector3, radius: float, damage: float) -> void:
	var k := float(Config.at("vehicles.damage.explosion"))
	for v in vehicles:
		if v.state != "ok":
			continue
		var d := Vector2(v.pos.x - pos.x, v.pos.z - pos.z).length()
		if d < radius:
			damage_vehicle(v, damage * k * pow(1.0 - d / radius, 0.6), "blast")

## Un zombie vient de frapper le joueur : le véhicule qu'il occupe perd zombieHit PV (une rame : 2 PV par coup, même debout dedans).
func on_zombie_strike() -> void:
	var v: Object = ride_of_player()
	if v == null:
		return
	var hit: Variant = v.def.get("zombieHit")
	damage_vehicle(v, float(hit) if hit != null else float(Config.at("vehicles.damage.zombieHit")), "zombie")

func ignite(v: Object) -> void:
	if v.is_tram():
		host_break_tram(v)
		return
	if v.state != "ok":
		return
	if v.def.has("blast") and v.def["blast"] == null:   # un vélo n'explose pas : il est cassé (blast: null ; les motos ont un blast)
		on_vehicle_break(v)
		return
	start_burn(v)

func start_burn(v: VehicleSim) -> void:
	if v.state != "ok":
		return
	v.hp = 0.0
	v.state = "burning"
	v.burn_t = float(Config.at("vehicles.damage.burnTime"))
	if ride != null and ride["v"] == v:
		g.announce("SAUTEZ !", "E : %s %s va exploser" % [String(v.def.get("det", "la")), String(v.def["name"]).to_lower()])
	g.ride_event.emit("burn", {"v": v})

## Vélo cassé : épave (matériau noir), le cycliste chute ; retour à sa station à la manche suivante.
func on_vehicle_break(v: VehicleSim) -> void:
	if v.state != "ok" and v.state != "burning":
		return
	var mine: bool = ride != null and ride["v"] == v
	v.state = "wreck"
	v.wreck_t = float(v.def.get("wreckTime", Config.at("vehicles.damage.wreckTime")))
	v.hp = 0.0
	v.speed = 0.0
	v.respawn_round = g.round_number + int(v.def.get("respawnRounds", Config.at("vehicles.damage.respawnRounds")))
	if mine:
		eject_from_vehicle(v, 2.0)
		g.announce("VÉLO CASSÉ", "Il revient à sa station à la manche suivante")
	v.seats.fill(null)
	g.ride_event.emit("break", {"v": v})

func _host_tick(r: Object, dt: float) -> void:
	if r.state == "burning":
		r.burn_t -= dt
		if r.burn_t <= 0.0:
			host_explode_vehicle(r)
	if r.respawn_pending:
		r.respawn_retry -= dt
		if r.respawn_retry <= 0.0:
			host_try_respawn(r)

## Explosion : effets, éjection du joueur, ses propres dégâts (jamais mortels), épave.
func host_explode_vehicle(v: VehicleSim) -> void:
	var B: Dictionary = Config.at("vehicles.damage.blast")
	var p: PlayerSim = g.player
	v.respawn_round = g.round_number + int(Config.at("vehicles.damage.respawnRounds"))
	v.state = "wreck"
	v.wreck_t = float(Config.at("vehicles.damage.wreckTime"))
	v.hp = 0.0
	v.speed = 0.0
	if ride != null and ride["v"] == v:
		eject_from_vehicle(v)
	v.seats.fill(null)
	var d := Vector2(p.pos.x - v.pos.x, p.pos.z - v.pos.z).length()
	if d < float(B["radius"]) and not p.dead:
		var dmg := minf(float(B["players"]) * (1.0 - d / float(B["radius"])), p.health - 1.0)
		if dmg > 0.0:
			g.hurt_player(dmg, "blast")
	g.shake = maxf(g.shake, 0.6 * maxf(0.0, 1.0 - d / 40.0))
	# l'épave a déjà quitté l'état « ok » : elle ne se blesse pas elle-même ; les autres motos proches, si
	g.arms.blast.explode(g, Vector3(v.pos.x, 0.6, v.pos.z), float(B["radius"]), float(B["zombies"]), int(B["color"]), 0.0)

## Descente forcée (explosion) : le joueur est projeté loin de la moto. push : vitesse de projection (m/s).
func eject_from_vehicle(v: Object, push := 5.0) -> void:
	var p: PlayerSim = g.player
	leave_vehicle()
	var dx: float = p.pos.x - v.pos.x
	var dz: float = p.pos.z - v.pos.z
	var l := sqrt(dx * dx + dz * dz)
	if l == 0.0:
		l = 1.0
	p.vel = Vector3(dx / l * push, 0.0, dz / l * push)
	p.vy = 4.0 if push > 3.0 else 2.0

## Début de manche : les motos détruites dont la manche de retour est arrivée reviennent (si personne n'est sur l'emplacement).
func on_round_start() -> void:
	var rn: int = g.round_number
	for r in all_rides():
		if (r.state == "wreck" or r.state == "gone" or r.state == "burning") and r.respawn_round > 0 and rn >= r.respawn_round:
			r.respawn_pending = true
			r.respawn_retry = 0.0

func host_try_respawn(r: Object) -> void:
	var clear := float(Config.at("vehicles.damage.respawnClear"))
	var p: PlayerSim = g.player
	var sp: Dictionary = r.spawn
	var busy: bool = not p.dead and Vector2(p.pos.x - float(sp["x"]), p.pos.z - float(sp["z"])).length() < clear
	if busy:
		r.respawn_retry = float(Config.at("vehicles.damage.respawnRetry"))
		return
	respawn_vehicle(r)

func respawn_vehicle(r: Object) -> void:
	if r.is_tram():
		r.reset(g)
	else:
		r.reset()
		r.fuel = float(r.def["tank"]) * float(Config.at("vehicles.fuel.respawn"))   # revient avec 40 % d'essence (un vélo : sans réservoir)
	if ride != null and ride["v"] == r:
		ride = null
		g.player.attached = false
	if on_tram != null and on_tram["v"] == r:
		tram_walk_off()
	g.ride_event.emit("respawn", {"v": r})

func host_break_tram(t: TramSim) -> void:
	if t.state != "ok":
		return
	t.respawn_round = g.round_number + int(Config.at("tram.power.respawnRounds"))
	t.state = "wreck"
	t.hp = 0.0
	t.set_doors(true)
	g.announce("TRAM HORS SERVICE", "Retour au dépôt dans %d manches" % int(Config.at("tram.power.respawnRounds")))

func hurt_occupants(v: Object, dmg: float) -> void:
	var p: PlayerSim = g.player
	if ride == null or ride["v"] != v:
		return
	var d := minf(dmg, p.health - 1.0)
	if d > 0.0:
		g.hurt_player(d, "crash")

# ------------------------------------------------------------------ monter / descendre
func near_vehicle() -> Dictionary:
	var p: PlayerSim = g.player
	if ride != null or p.dead:
		return {}
	var best: Dictionary = {}
	var bd := float(Config.at("vehicles.mountRange"))
	for v in vehicles:
		if not v.usable():
			continue
		var seat := v.free_seat()
		if seat < 0:
			continue
		var d := Vector2(p.pos.x - v.pos.x, p.pos.z - v.pos.z).length()
		if d < bd:
			bd = d
			best = {"v": v, "seat": seat}
	if not best.is_empty():
		return best
	return near_tram()

func vehicle_prompt(nv: Dictionary) -> String:
	if nv["v"].is_tram():
		return tram_prompt(nv)
	var v: VehicleSim = nv["v"]
	var role := ""
	if int(v.def["seats"]) > 1:
		role = " — conducteur" if int(nv["seat"]) == 0 else " — passager"
	var fuel := " · essence %d %%" % roundi(v.fuel_frac() * 100.0) if v.has_tank() else ""
	return "E Monter %s %s %s%s (PV %d %%%s)" % ["dans" if v is CarSim else "sur", String(v.def.get("det", "la")), String(v.def["name"]).to_lower(), role, roundi(v.hp_frac() * 100.0), fuel]

func try_mount(v: Object, seat: int) -> void:
	if v.seats[seat] != null or not v.usable():
		return
	v.seats[seat] = 0
	enter_vehicle(v, seat)

func enter_vehicle(v: Object, seat: int) -> void:
	var p: PlayerSim = g.player
	if ride != null:
		return
	tram_walk_off()
	ride = {"v": v, "seat": seat}
	p.attached = true
	p.yaw = v.seat_yaw(seat) + float(v.model_seats[seat].get("ry", 0.0))
	p.pitch = 0.0
	if v.is_tram():
		var tt := tram_enter_text(v, seat)
		g.announce(tt[0], tt[1])
		g.ride_event.emit("chime", {"v": v, "open": true})
	elif v is CarSim:   # v0.36.0
		var dn: Variant = g.get("daynight")
		if seat == 0 and dn != null and dn.is_night():
			v.lights = true   # la nuit, les phares s'allument en montant
		g.announce(String(v.def["name"]), "Z/Q/S/D : conduire · Espace : frein à main · F : phares · H : klaxon · V : vue · E : descendre" if seat == 0 else "Vous êtes passager : tirez ! · E : descendre")
		g.ride_event.emit("mount", {"v": v})
	else:
		g.announce(String(v.def["name"]), ("Z/Q/S/D : conduire · Espace : %s · E : descendre" % ("frein à main" if v.has_tank() else "frein")) if seat == 0 else "Vous êtes passager : tirez ! · E : descendre")
		g.ride_event.emit("mount", {"v": v})

func leave_vehicle(force := false) -> void:
	var p: PlayerSim = g.player
	if ride == null:
		return
	var v: Object = ride["v"]
	var seat: int = ride["seat"]
	if v.is_tram():
		stand_in_tram(v, seat)
		v.seats[seat] = null
		return
	# on descend sur le côté (gauche pour le conducteur, droite pour le passager), sinon de l'autre côté
	var c := cos(v.yaw)
	var s := sin(v.yaw)
	var pt: Vector3 = v.hip_world(seat)
	var ex := pt.x
	var ez := pt.z
	var first := -1.0 if seat == 0 else 1.0
	if v is CarSim:   # v0.36.0 : on sort par la portière de sa place (gauche ou droite), sinon par l'autre côté
		first = -1.0 if float(v.model_seats[seat]["hip"][0]) < 0.0 else 1.0
	var out_d := 1.15 if v is CarSim else 1.0
	for side in [first, -first]:
		var q: Vector3 = g.collision.resolve(Vector3(pt.x + c * side * out_d, 0.1, pt.z - s * side * out_d), 0.4)
		ex = q.x
		ez = q.z
		if Vector2(q.x - (pt.x + c * side * out_d), q.z - (pt.z - s * side * out_d)).length() < 0.3:
			break
	var sp: float = v.speed
	var fl := {"y": 0.0, "region": 0}
	var gy := 0.0
	if g.world != null:
		g.world.floor_at(ex, ez, 0.1, fl)
		gy = float(fl["y"])
	p.pos = Vector3(ex, gy, ez)
	p.vel = Vector3(clampf(-s * sp * 0.3, -6.0, 6.0), 0.0, clampf(-c * sp * 0.3, -6.0, 6.0))
	p.vy = 0.0
	ride = null
	p.attached = false
	if seat == 0:   # le conducteur descend : la moto s'arrête là
		v.speed = 0.0
		v.steer = 0.0
		v.lean = 0.0
		v.throttle = 0.0
		if v is CarSim:
			v.slip = 0.0
	v.seats[seat] = null
	g.ride_event.emit("dismount", {"v": v})

# ------------------------------------------------------------------ borne du parking : plein + réparation (2 pts / PV)
## La borne agit sur la moto la plus proche de la borne (à moins de pumpReach m) ; il faut être descendu. {} hors de portée de toute borne.
func near_pump() -> Dictionary:
	var p: PlayerSim = g.player
	if ride != null or p.dead:
		return {}
	var found := {}
	for pk: Dictionary in parkings:
		if Vector2(p.pos.x - float(pk["pump"]["x"]), p.pos.z - float(pk["pump"]["z"])).length() <= float(Config.at("vehicles.pumpRange")):
			found = pk
			break
	if found.is_empty():
		return {}
	var best: VehicleSim = null
	var bd := float(Config.at("vehicles.pumpReach"))
	for v in vehicles:
		if not v.usable() or not v.has_tank():
			continue
		var d := Vector2(v.pos.x - float(found["pump"]["x"]), v.pos.z - float(found["pump"]["z"])).length()
		if d <= bd:
			bd = d
			best = v
	return {"v": best}

## Ce que la borne ferait pour la moto : { cost (pts), missing (PV), liters }.
func service_of(v: VehicleSim) -> Dictionary:
	var missing := maxf(0.0, v.max_hp() - v.hp)
	var liters := maxf(0.0, float(v.def["tank"]) - v.fuel) if v.has_tank() else 0.0
	return {"missing": missing, "liters": liters, "cost": int(ceil(missing * float(Config.at("vehicles.damage.repairPrice")) + liters * float(Config.at("vehicles.fuel.pricePerL")) - 1e-6))}

func pump_prompt(np: Dictionary) -> String:
	if np["v"] == null:
		return "Borne du parking : aucune moto à portée (8 m)"
	var sv := service_of(np["v"])
	var name := String(np["v"].def["name"])
	if int(sv["cost"]) <= 0:
		return "%s : plein fait, en parfait état" % name
	return "E Plein + réparation %s : %d pts (essence %d %% · PV %d %%)" % [name, int(sv["cost"]), roundi(np["v"].fuel_frac() * 100.0), roundi(np["v"].hp_frac() * 100.0)]

func use_pump(np: Dictionary) -> void:
	var v: VehicleSim = np["v"]
	if v == null:
		g.purchase_denied.emit(0)
		return
	var sv := service_of(v)
	if int(sv["cost"]) <= 0:
		return
	if g.points < int(sv["cost"]):
		g.purchase_denied.emit(int(sv["cost"]))
		return
	g.points -= int(sv["cost"])
	g.announce(String(v.def["name"]), "Plein + réparation : -%d pts" % int(sv["cost"]))
	v.hp = v.max_hp()
	v.fuel = float(v.def["tank"])
	g.ride_event.emit("service", {"v": v})

# ------------------------------------------------------------------ sous-station du tram (2000 pts, une fois pour l'équipe)
func near_substation() -> bool:
	var p: PlayerSim = g.player
	if substation.is_empty() or ride != null or p.dead:
		return false
	return Vector2(p.pos.x - float(substation["x"]), p.pos.z - float(substation["z"])).length() <= float(Config.at("tram.power.range"))

func substation_prompt() -> String:
	if tram_powered:
		return "Sous-station : le tram est alimenté"
	return "E Remettre le courant du tram (%d pts, une fois pour toute l'équipe)" % int(Config.at("tram.power.price"))

func use_substation() -> void:
	if tram_powered:
		return
	var price := int(Config.at("tram.power.price"))
	if g.points < price:
		g.purchase_denied.emit(price)
		return
	g.points -= price
	set_power(true)

func set_power(on: bool, silent := false) -> void:
	if tram_powered == on:
		return
	tram_powered = on
	if on and not silent:
		g.announce("SOUS-STATION", "Le tram est alimenté : conduite gratuite")
		g.ride_event.emit("chime", {"v": trams[0] if not trams.is_empty() else null, "open": true})

# ------------------------------------------------------------------ touches de la rame : gong, portes, aiguillage, vue
func tram_gong() -> void:
	if car_horn():
		return
	var t := tram_of_player()
	if t == null or t.gong_cd > 0.0:
		return
	t.gong_cd = float(Config.at("tram.gong.cooldown"))
	g.ride_event.emit("gong", {"v": t})
	set_lure(t)

func set_lure(t: TramSim) -> void:
	lure = {"x": t.pos.x, "z": t.pos.z, "t": float(Config.at("tram.gong.duration")), "range": float(Config.at("tram.gong.range"))}

## Touche des portes : le conducteur (assis) ; sinon, quand personne ne conduit, n'importe quel occupant (assis ou debout).
func tram_doors() -> void:
	var t := tram_of_player()
	if t == null:
		return
	if ride != null and ride["v"].is_driver(ride["seat"]):
		t.toggle_doors(g)
		return
	if t.has_driver():
		g.announce("PORTES", "Le conducteur commande les portes")
		return
	t.toggle_doors(g)

func tram_switch() -> void:
	if ride == null or not ride["v"].is_tram() or not ride["v"].is_driver(ride["seat"]):
		return
	ride["v"].toggle_switch(g)

func toggle_view() -> void:
	cam.third_person = not cam.third_person
	g.announce("VUE : 3E PERSONNE" if cam.third_person else "VUE : 1RE PERSONNE", "")

# ------------------------------------------------------------------ monter dans la rame, y marcher
func near_tram() -> Dictionary:
	var p: PlayerSim = g.player
	var T: Dictionary = Config.at("tram")
	if ride != null or p.dead:
		return {}
	if on_tram != null:
		return near_seat_inside()
	var door := near_open_door()
	if not door.is_empty():
		return door
	var best: Dictionary = {}
	for t in trams:
		if not t.usable() or absf(t.v) > float(T["drive"]["boardSpeed"]):
			continue
		var d_body := INF
		for m: Dictionary in t.mods:
			var dx: float = p.pos.x - m["x"]
			var dz: float = p.pos.z - m["z"]
			var lx: float = dx * m["tx"] + dz * m["tz"]
			var lz: float = -dx * m["tz"] + dz * m["tx"]
			d_body = minf(d_body, Vector2(maxf(0.0, absf(lx) - t.body_len / 2.0), maxf(0.0, absf(lz) - t.width / 2.0)).length())
		if d_body > 2.2:
			continue
		# portes fermées : directement à une place. Bouts : à moins de 4 m du nez, la cabine (si libre) ; sinon la place de passager libre la plus proche
		var seat := -1
		var bd := INF
		for cab_mi in [[0, t.n - 1], [1, 0]]:
			var cab: int = cab_mi[0]
			var mi: int = cab_mi[1]
			if t.seats[cab] != null:
				continue
			var q: Dictionary = t.mods[mi]
			var sgn := 1.0 if cab == 0 else -1.0
			var ex: float = q["x"] + q["tx"] * sgn * (t.M / 2.0)
			var ez: float = q["z"] + q["tz"] * sgn * (t.M / 2.0)
			var d := Vector2(p.pos.x - ex, p.pos.z - ez).length()
			if d < 4.0 and d < bd:
				bd = d
				seat = cab
		if seat < 0:
			bd = INF
			for i in range(2, t.seats.size()):
				if t.seats[i] != null:
					continue
				var hp_: Vector3 = t.hip_world(i)
				var d2 := Vector2(p.pos.x - hp_.x, p.pos.z - hp_.z).length()
				if d2 < bd:
					bd = d2
					seat = i
		if seat < 0:
			continue
		if best.is_empty() or d_body < float(best["d"]):
			best = {"v": t, "seat": seat, "d": d_body}
	return best

func tram_prompt(nv: Dictionary) -> String:
	var t: TramSim = nv["v"]
	var seat: int = nv["seat"]
	if nv.get("foot", false):
		return "E Monter dans le tram (porte ouverte, PV %d %%)" % roundi(t.hp_frac() * 100.0)
	var role := (" — conducteur (cabine %s)" % ("avant" if seat == 0 else "arrière")) if t.is_driver(seat) else " — passager"
	var power := "" if tram_powered else " · hors tension"
	if nv.get("sit", false):
		return "E S'asseoir%s%s" % [role, power]
	return "E Monter dans le tram%s (PV %d %%%s)" % [role, roundi(t.hp_frac() * 100.0), power]

func tram_enter_text(t: TramSim, seat: int) -> Array:
	if t.is_driver(seat):
		var pw := "" if tram_powered else " · HORS TENSION : sous-station de l'Homme de Fer"
		return ["TRAM — conducteur" + pw, "Z/Q/S/D : conduire · Espace : frein d'urgence · O : portes · B : aiguillage · H : gong · V : vue · E : se lever"]
	return ["TRAM — passager", "Vous êtes assis : tirez ! · H : gong · V : vue · E : se lever"]

## Un siège libre à portée du joueur debout dans la rame : { v, seat, sit: true }, ou {}.
func near_seat_inside() -> Dictionary:
	var p: PlayerSim = g.player
	if on_tram == null or p.dead:
		return {}
	var t: TramSim = on_tram["v"]
	if not t.usable():
		return {}
	var best: Dictionary = {}
	var bd := float(Config.at("tram.walk.seatReach"))
	var spots: Array = t.interior["seat_spots"]
	for i in spots.size():
		if t.seats[i] != null:
			continue
		var d := Vector2(float(spots[i]["u"]) - float(on_tram["u"]), float(spots[i]["w"]) - float(on_tram["w"])).length()
		if d < bd:
			bd = d
			best = {"v": t, "seat": i, "sit": true}
	return best

## Porte ouverte à portée du joueur à pied, rame arrêtée : { v, seat: -1, foot: true, door, side }, ou {}.
func near_open_door() -> Dictionary:
	var p: PlayerSim = g.player
	if ride != null or on_tram != null or p.dead:
		return {}
	var best: Dictionary = {}
	var bd := float(Config.at("tram.walk.boardReach"))
	var wall := float(Config.at("tram.walk.wall"))
	var loc := {}
	for t in trams:
		if not t.usable() or not t.walk_open():
			continue
		if absf(p.pos.x - t.pos.x) > 20.0 or absf(p.pos.z - t.pos.z) > 20.0:
			continue
		t.world_to_walk(p.pos.x, p.pos.z, loc)
		if absf(loc["w"]) > 4.0:
			continue
		var spans: Array = t.interior["spans"]
		for i in spans.size():
			var du := maxf(0.0, absf(loc["u"] - (spans[i][0] + spans[i][1]) / 2.0) - 0.4)
			var dw := absf(absf(loc["w"]) - wall)
			var d := sqrt(du * du + dw * dw)
			if d < bd:
				bd = d
				best = {"v": t, "seat": -1, "foot": true, "door": i, "side": signf(loc["w"]) if loc["w"] != 0.0 else 1.0}
	return best

## Monter en poussant contre une porte ouverte (chaque pas, joueur à pied).
func update_tram_boarding() -> void:
	var p: PlayerSim = g.player
	if ride != null or on_tram != null or p.dead or not g.playing:
		return
	var W: Dictionary = Config.at("tram.walk")
	var loc := {}
	var f2 := {}
	for t in trams:
		if not t.usable() or not t.walk_open():
			continue
		if absf(p.pos.x - t.pos.x) > 20.0 or absf(p.pos.z - t.pos.z) > 20.0:
			continue
		t.world_to_walk(p.pos.x, p.pos.z, loc)
		var aw := absf(loc["w"])
		if aw > float(W["boardW"]) or aw < float(W["wall"]) - 0.1 or p.pos.y > 0.4:
			continue
		var di := TramInterior.door_index_at(t.interior, loc["u"], -0.2)
		if di < 0:
			continue
		t.frame(loc["u"], f2)
		var vw: float = -p.vel.x * f2["tz"] + p.vel.z * f2["tx"]   # composante vers la droite de la rame
		if -signf(loc["w"]) * vw < float(W["boardPush"]):
			continue
		board_on_foot({"v": t, "door": di, "side": signf(loc["w"])})
		return

func board_on_foot(nv: Dictionary) -> void:
	var p: PlayerSim = g.player
	var t: TramSim = nv["v"]
	var span: Array = t.interior["spans"][nv["door"]]
	if ride != null or on_tram != null:
		return
	var f1 := {}
	t.frame((span[0] + span[1]) / 2.0, f1)
	on_tram = {"v": t, "u": (span[0] + span[1]) / 2.0, "w": float(nv["side"]) * (float(Config.at("tram.walk.wall")) - 0.05), "y": minf(p.pos.y, float(Config.at("tram.car.floor")) - 0.05), "fy": f1["yaw"]}
	p.vel = Vector3.ZERO
	p.vy = 0.0
	p.attached = true
	g.ride_event.emit("knock", {"v": t})

## Se lever d'un siège : debout dans la rame, côté allée.
func stand_in_tram(t: TramSim, seat: int) -> void:
	var p: PlayerSim = g.player
	var W: Dictionary = Config.at("tram.walk")
	var sp: Dictionary = t.interior["seat_spots"][seat]
	var f1 := {}
	t.frame(sp["u"], f1)
	var w: float = float(W["stand"]) + 0.25 if sp["driver"] else float(sp["side"]) * float(W["stand"])
	var pt := {"u": sp["u"], "w": w}
	TramInterior.push_out([t.interior["boxes"], t.interior["walls_closed"]], pt, float(W["radius"]))
	on_tram = {"v": t, "u": pt["u"], "w": pt["w"], "y": float(Config.at("tram.car.floor")), "fy": f1["yaw"]}
	ride = null
	p.attached = true
	p.vel = Vector3.ZERO
	p.vy = 0.0
	p.pos = t.walk_to_world(pt["u"], pt["w"], float(Config.at("tram.car.floor")))
	g.ride_event.emit("knock", {"v": t})

## Pose le joueur debout dans la rame t à (u, w), à la case libre la plus proche (tests, captures).
func place_in_tram(t: TramSim, u: float, w: float) -> void:
	var p: PlayerSim = g.player
	var I: Dictionary = t.interior
	var pt := {"u": clampf(u, -float(I["u_end"]), float(I["u_end"])), "w": w}
	TramInterior.push_out([I["boxes"], I["walls_closed"]], pt, float(Config.at("tram.walk.radius")))
	var f1 := {}
	t.frame(pt["u"], f1)
	on_tram = {"v": t, "u": pt["u"], "w": pt["w"], "y": float(Config.at("tram.car.floor")), "fy": f1["yaw"]}
	ride = null
	p.attached = true
	p.vel = Vector3.ZERO
	p.vy = 0.0
	p.pos = t.walk_to_world(pt["u"], pt["w"], float(Config.at("tram.car.floor")))

## Sort silencieusement du repère de la rame (téléportation, réapparition, mort).
func tram_walk_off() -> void:
	if on_tram == null:
		return
	on_tram = null
	g.player.vy = 0.0
	if ride == null:
		g.player.attached = false

## Un pas du joueur debout dans la rame : déplacement, collisions et position monde viennent du repère local de la rame.
func tram_walk_step(dt: float) -> void:
	var p: PlayerSim = g.player
	var W: Dictionary = Config.at("tram.walk")
	var D: Dictionary = Config.at("tram.drive")
	var O: Dictionary = on_tram
	var t: TramSim = O["v"]
	if t.state == "gone":
		tram_walk_off()
		return
	var I: Dictionary = t.interior
	var f1 := {}
	t.frame(O["u"], f1)
	p.yaw += VehicleSim.ang_diff(f1["yaw"], O["fy"])   # la vue tourne avec la rame (virages)
	O["fy"] = f1["yaw"]
	var pt := {"u": O["u"] + (p.vel.x * f1["tx"] + p.vel.z * f1["tz"]) * dt, "w": O["w"] + (-p.vel.x * f1["tz"] + p.vel.z * f1["tx"]) * dt}
	var pass_ := t.walk_open()
	TramInterior.push_out([I["boxes"], I["walls_open"] if pass_ else I["walls_closed"]], pt, float(W["radius"]))
	var out := absf(pt["w"]) > float(W["exitW"])
	if out and pass_ and TramInterior.door_index_at(I, pt["u"], -float(W["radius"]) * 0.5) >= 0:   # dans l'ouverture : on descend
		O["u"] = pt["u"]
		O["w"] = pt["w"]
		tram_step_out(t, false)
		return
	if absf(pt["w"]) > float(W["exitW"]) + 0.12:   # hors de la caisse sans porte (portes refermées sur le joueur) : éjecté
		O["u"] = pt["u"]
		O["w"] = pt["w"]
		tram_step_out(t, true)
		return
	if not pass_ and t.door_f >= float(W["doorOpen"]) and absf(t.v) > float(D["boardSpeed"]) and absf(pt["w"]) > float(W["wall"]) - 0.5 and TramInterior.door_index_at(I, pt["u"], 0.1) >= 0:
		if g.time >= tram_warn_until:
			tram_warn_until = g.time + 2.0
			g.announce("TRAM EN MARCHE", "Impossible de descendre : attendez l'arrêt")
	O["u"] = pt["u"]
	O["w"] = pt["w"]
	var floor_y := float(Config.at("tram.car.floor"))
	O["y"] += (floor_y - O["y"]) * minf(1.0, dt * float(W["enterEase"]))
	if absf(floor_y - O["y"]) < 0.002:
		O["y"] = floor_y
	p.pos = t.walk_to_world(O["u"], O["w"], O["y"])

## Descente à pied : le joueur est repris par le monde à côté de la rame.
func tram_step_out(t: TramSim, _forced: bool) -> void:
	var p: PlayerSim = g.player
	var O: Dictionary = on_tram
	var w: Vector3 = t.walk_to_world(O["u"], O["w"], 0.0)
	p.pos = Vector3(w.x, maxf(0.0, O["y"] - 0.01), w.z)
	on_tram = null
	p.vy = 0.0
	p.attached = false
	p.pos = g.collision.resolve(p.pos, float(Config.at("player.radius")))
	g.ride_event.emit("knock", {"v": t})

# ------------------------------------------------------------------ zombies et rame
## Cible dans une rame aux portes ouvertes : le zombie va se tenir devant la porte ouverte la plus proche de son côté (puis frappe à 1,3 m). {} sinon.
func tram_goal(z: ZombieSim) -> Dictionary:
	var t := tram_of_player()
	if t == null or t.door_f < 0.4 or t.state == "gone":
		return {}
	if absf(z.pos.x - t.pos.x) > 45.0 or absf(z.pos.z - t.pos.z) > 45.0:
		return {}
	var W: Dictionary = Config.at("tram.walk")
	var loc := {}
	var loc2 := {}
	t.world_to_walk(g.player.pos.x, g.player.pos.z, loc2)
	t.world_to_walk(z.pos.x, z.pos.z, loc)
	var side := 1.0 if loc["w"] >= 0.0 else -1.0
	var best: Dictionary = {}
	var bd := INF
	var dz := INF
	for sp: Array in t.interior["spans"]:
		var u: float = (sp[0] + sp[1]) / 2.0
		var q := t.walk_to_world(u, side * (t.width / 2.0 + float(W["doorSpot"])), 0.0)
		var d := Vector2(q.x - z.pos.x, q.z - z.pos.z).length()
		var cost: float = d + 2.0 * absf(u - float(loc2["u"]))   # la porte la plus proche du zombie ET de sa cible
		if cost < bd:
			bd = cost
			dz = d
			best = {"x": q.x, "z": q.z}
	return best if (not best.is_empty() and dz > 1.0) else {}

## La caisse encaisse le coup d'un zombie (true), sauf devant une porte ouverte (le joueur à moins de 1,3 m de la porte est touché).
func tram_shield(z: ZombieSim) -> bool:
	var t := tram_of_player()
	if t == null:
		return false
	if t.door_f > 0.4:
		var loc := {}
		t.world_to_walk(z.pos.x, z.pos.z, loc)
		if TramInterior.door_index_at(t.interior, loc["u"], 0.55) >= 0 and absf(loc["w"]) < t.width / 2.0 + float(Config.at("tram.walk.doorSpot")) + 0.6:
			return false
	return true

# ------------------------------------------------------------------ interactions (touche E)
## E assis : descend. Renvoie true si l'appui est consommé.
func interact_leave() -> bool:
	if ride == null:
		return false
	leave_vehicle()
	return true

## E à pied, après les armes : borne du parking, sous-station, puis monter. Renvoie true si l'appui est consommé.
func interact_use() -> bool:
	if g.player.dead:
		return false
	var np := near_pump()
	if not np.is_empty():
		use_pump(np)
		return true
	if near_substation():
		use_substation()
		return true
	var nv := near_vehicle()
	if not nv.is_empty():
		if nv.get("foot", false):
			board_on_foot(nv)
		else:
			try_mount(nv["v"], int(nv["seat"]))
		return true
	return false

## Invite à l'écran (un seul texte) : borne, sous-station, monter ; vide s'il n'y a rien. Debout ou assis dans la rame : l'aide de la rame.
func prompt() -> String:
	if ride != null:
		var v: Object = ride["v"]
		if v.is_tram():
			return tram_ride_hint(v, int(ride["seat"]))
		if v is CarSim and int(ride["seat"]) == 0:
			return "E Descendre · V vue · F phares (%s) · H klaxon" % ("allumés" if v.lights else "éteints")
		return "E Descendre" if int(ride["seat"]) != 0 else "E Descendre · V vue"
	if on_tram != null:
		return tram_walk_hint(on_tram["v"])
	var np := near_pump()
	if not np.is_empty():
		return pump_prompt(np)
	if near_substation():
		return substation_prompt()
	var nv := near_vehicle()
	if not nv.is_empty():
		return vehicle_prompt(nv)
	return ""

func tram_ride_hint(t: TramSim, seat: int) -> String:
	if t.state != "ok":
		return "E Se lever (rame hors service)"
	if t.is_driver(seat):
		var a := t.approach()
		return "E Se lever · O portes %s · H gong · Espace frein d'urgence%s" % ["(ouvertes)" if t.door_open else "(fermées)", " · B aiguillage" if (not a.is_empty() and float(a["dist"]) < 160.0) else ""]
	return "E Se lever · clic gauche : tirer · H gong"

func tram_walk_hint(t: TramSim) -> String:
	var near := near_seat_inside()
	var kmh := roundi(absf(t.v) * 3.6)
	var state := "portes ouvertes : marchez vers une porte pour descendre" if t.walk_open() else ("rame en marche (%d km/h)" % kmh if kmh > 2 else "O : portes")
	if not near.is_empty():
		return "E S'asseoir%s · %s" % [(" — conducteur (cabine %s)" % ("avant" if int(near["seat"]) == 0 else "arrière")) if int(near["seat"]) <= 1 else "", state]
	return "Z/Q/S/D : marcher · %s · H gong" % state

## Données du tableau de bord (vitesse, essence, PV, nom) du véhicule occupé, ou {}.
func gauge() -> Dictionary:
	if ride == null:
		return {}
	var v: Object = ride["v"]
	if v.is_tram():
		var h: Dictionary = v.hud_info()
		h["fuel"] = 1.0 if tram_powered else 0.0
		h["fuel_label"] = "ÉNERGIE"
		h["tram"] = true
		return h
	var gg := {"speed": v.speed, "vmax": float(v.def["maxSpeed"]), "vmin": float(v.def["roadkill"]["vmin"]), "hp": v.hp, "hp_max": v.max_hp(), "name": String(v.def["name"]),
		"fuel": v.fuel_frac(), "fuel_label": "ESSENCE", "has_tank": v.has_tank(), "tram": false, "sw": {}}
	if v is CarSim:   # v0.36.0 : vitesse au sol (dérapage compris), phares, litres
		gg["speed"] = v.ground_speed() * signf(v.speed if v.speed != 0.0 else 1.0)
		gg["car"] = true
		gg["lights"] = v.lights
		gg["liters"] = v.fuel
	return gg

# ------------------------------------------------------------------ v0.36.0 : voiture
## Boîtes dynamiques des voitures dans la collision du monde : le joueur à pied, les zombies et les motos ne les traversent pas ; une voiture
## disparue (après l'épave) n'en a plus.
const DYN_RANGE := 90.0
func sync_car_boxes() -> void:
	if g == null or g.collision == null:
		return
	var p: Variant = g.get("player")
	for v in vehicles:
		if not (v is CarSim):
			continue
		# loin du joueur (plus de DYN_RANGE m, personne à bord), une voiture garée n'est pas dans la collision : chaque collision de zombie
		# ou de joueur parcourt les boîtes dynamiques, autant ne garder que celles qui comptent (banc d'essai de j3)
		var near: bool = p == null or v.has_driver() or absf(v.x - p.pos.x) < DYN_RANGE and absf(v.z - p.pos.z) < DYN_RANGE
		if v.state == "gone" or not near:
			g.collision.clear_dynamic(v.key)
		else:
			g.collision.set_dynamic(v.key, [v.dyn_box()], "car")

## La voiture où le joueur est assis (ou null).
func car_of_player() -> CarSim:
	if ride != null and ride["v"] is CarSim:
		return ride["v"]
	return null

## Cible d'un zombie quand le joueur est en voiture : le point de la caisse le plus proche (il vient frapper la carrosserie, qui encaisse).
func car_goal(z: ZombieSim) -> Dictionary:
	var c := car_of_player()
	if c == null or c.state == "wreck" or c.state == "gone":
		return {}
	if absf(z.pos.x - c.x) > 45.0 or absf(z.pos.z - c.z) > 45.0:
		return {}
	var q := c.closest_point(z.pos.x, z.pos.z)
	return {"x": q.x, "z": q.y}

## Part des coups de zombie qui atteint le joueur (la caisse encaisse le reste) : def.cabin en voiture, 1 sinon.
func cabin_factor() -> float:
	var c := car_of_player()
	return float(c.def["cabin"]) if c != null and c.state == "ok" else 1.0

## Klaxon (touche du gong, conducteur d'une voiture) : attire les zombies comme le gong (appât qui suit la voiture). true si l'on est en voiture.
func car_horn() -> bool:
	var c := car_of_player()
	if c == null:
		return false
	if not c.is_driver(int(ride["seat"])):
		return true
	if c.honk():
		var H: Dictionary = c.def["horn"]
		lure = {"x": c.x, "z": c.z, "t": float(H["duration"]), "range": float(H["range"]), "v": c}
		g.ride_event.emit("horn", {"v": c})
	return true

## Phares (touche de la lampe torche, conducteur d'une voiture). true si l'appui est consommé.
func toggle_car_lights() -> bool:
	var c := car_of_player()
	if c == null or not c.is_driver(int(ride["seat"])):
		return false
	c.lights = not c.lights
	g.ride_event.emit("lights", {"v": c, "on": c.lights})
	return true
