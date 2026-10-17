class_name TramSim
extends RefCounted
## Rame de tram conduisible (port de src/tram.js : classe Tram, sans modèle, son ni réseau). UNE rame de 5 modules (23,5 m) sur la voie B / C / F,
## position 1D `s` (m depuis le début de la ligne, centre de la rame) et vitesse signée `v` (m/s, positive vers `s` croissant). Les modules sont
## articulés : chacun suit la voie à son propre centre. Elle se comporte comme une moto pour le reste du jeu (mêmes champs que VehicleSim : pos, yaw,
## speed, def, seats, hp, state, hip_world, eye_world…). Places : 0 conducteur avant, 1 conducteur arrière, 2 à 15 passagers assis.
## Collisions : une boîte orientée par module, obstacles DYNAMIQUES de Collision (set_dynamic) : joueurs et zombies sont repoussés.
## Le contexte `g` est l'hôte (Game ou doublure) : collision, zombies, time, rides (portes de zone, courant), announce, hit_zombie, hurt_player.

const ID0 := 100

var index := 0
var id := ID0
var type := "tram"
var track: TramTrack
var line0: TramTrack
var reg: Dictionary = {}       ## voies par identifiant : lignes et itinéraires des aiguillages
var jn: Dictionary = {}        ## aiguillages (TramTrack.build_junction), {} s'il n'y en a pas
var sw := 0                    ## aiguillage : 0 tout droit, 1 dévié
var start_s := 0.0
var def: Dictionary
var n := 5
var M := 4.7
var L := 23.5
var seats: Array = []
var model_seats: Array = []    ## [{ hip: [x, y, z], eye: [x, y, z], ry, module, driver }] (doubles) : 0 et 1 conducteurs, puis passagers
var interior: Dictionary = {}
var door_starts: Array = []
var body_len := 4.4            ## HDF.tram.body
var width := 2.4               ## HDF.tram.width
var height := 3.4
var pos := Vector3.ZERO
var yaw := 0.0
var dyaw := 0.0
var lean := 0.0
var throttle := 0.0
var s := 0.0
var v := 0.0
var speed := 0.0
var hp := 0.0
var state := "ok"
var respawn_round := 0
var respawn_pending := false
var respawn_retry := 0.0
var door_open := false
var door_f := 0.0
var gong_cd := 0.0
var limit_msg := 0.0
var warn_t := 0.0
var alarm_t := 0.0
var squeal := 0.0
var hint_dir := 1.0
var hit_cd: Dictionary = {}
var mods: Array = []           ## [{ x, z, yaw, tx, tz, dyaw }] par module
var events: PackedStringArray = PackedStringArray()
var spawn := {"x": 0.0, "z": 0.0, "yaw": 0.0}
var _o := {}
var _o2 := {}
var _wf := {}
var _wp := {}

func _init(index_: int, tracks: Dictionary, line: TramTrack, start_s_: float, data: Dictionary) -> void:
	var T: Dictionary = Config.at("tram")
	var C: Dictionary = T["car"]
	var D: Dictionary = T["drive"]
	index = index_
	id = ID0 + index_
	reg = tracks["by_id"]
	jn = tracks.get("junction", {})
	track = line
	line0 = line
	start_s = start_s_
	def = {"name": "TRAM", "seats": 16, "camArm": C["camArm"], "maxSpeed": D["maxSpeed"], "hp": T["hp"], "zombieHit": T["zombieHit"], "roadkill": {"vmin": T["hit"]["zombieSpeed"]}, "tank": 1}
	n = int(C["modules"])
	M = float(C["module"])
	L = n * M
	seats.resize(16)
	var ht: Dictionary = data["hdfTram"]
	body_len = float(ht["body"])
	width = float(ht["width"])
	height = float(ht["height"])
	for st: Dictionary in data["carSeats"]:
		model_seats.append({"hip": st["hip"], "eye": st["eye"], "ry": float(st["ry"]), "module": int(st["module"]), "driver": bool(st["driver"])})
	door_starts = data["doorStarts"]
	interior = TramInterior.interior_of(L, M, model_seats, door_starts)
	for _i in n:
		mods.append({"x": 0.0, "z": 0.0, "yaw": 0.0, "tx": 1.0, "tz": 0.0, "dyaw": 0.0})
	reset(null)

static func _v3(a: Array) -> Vector3:
	return Vector3(a[0], a[1], a[2])

func reset(g: Object) -> void:
	track = line0
	sw = 0
	s = start_s
	v = 0.0
	speed = 0.0
	hp = float(def["hp"])
	state = "ok"
	respawn_round = 0
	respawn_pending = false
	respawn_retry = 0.0
	seats.fill(null)
	hit_cd.clear()
	limit_msg = 0.0
	warn_t = 0.0
	door_open = false
	door_f = 0.0
	gong_cd = 0.0
	apply(g, true)

func max_hp() -> float:
	return float(def["hp"])
func hp_frac() -> float:
	return hp / float(def["hp"])
func usable() -> bool:
	return state == "ok"
func has_tank() -> bool:
	return false
func is_tram() -> bool:
	return true
func has_driver() -> bool:
	return seats[0] != null or seats[1] != null
func is_driver(seat: int) -> bool:
	return seat <= 1
func free_seat() -> int:
	return seats.find(null)
func seat_module(seat: int) -> Dictionary:
	return mods[model_seats[seat]["module"]]
func seat_yaw(seat: int) -> float:
	return seat_module(seat)["yaw"]
func seat_dyaw(seat: int) -> float:
	return seat_module(seat)["dyaw"]
## sens de marche de la cabine de `seat` dans l'axe de la voie : +1 (cabine avant) ou -1 (cabine arrière)
func cab_dir(seat: int) -> float:
	return 1.0 if seat == 0 else -1.0

# ---- repère de la rame : un point (u, w) est celui de la voie à l'abscisse s + u décalé de w vers la droite (continu d'un module à l'autre)
func frame(u: float, out: Dictionary) -> Dictionary:
	return track.at(clampf(s + u, 0.0, track.L), out)
func walk_to_world(u: float, w: float, y: float) -> Vector3:
	frame(u, _wf)
	return Vector3(_wf["x"] - _wf["tz"] * w, y, _wf["z"] + _wf["tx"] * w)
func world_to_walk(x: float, z: float, out: Dictionary) -> Dictionary:
	track.project(x, z, 10.0, _wp)
	out["u"] = _wp["s"] - s
	out["w"] = 99.0 if _wp["d"] == INF else _wp["side"] * _wp["d"]
	return out
## les portes laissent passer : ouvertes (à plus de walk.doorOpen) et rame (presque) arrêtée
func walk_open() -> bool:
	return door_f >= float(Config.at("tram.walk.doorOpen")) and absf(v) <= float(Config.at("tram.drive.boardSpeed"))
func module_at(u: float) -> int:
	return clampi(int(floor((u + L / 2.0) / M)), 0, n - 1)
func module_u(i: int) -> float:
	return -L / 2.0 + M / 2.0 + i * M

## point local d'un module (x droite, y haut, z arrière) -> monde
func local_to_world(mod_idx: int, p: Array) -> Vector3:
	var q: Dictionary = mods[mod_idx]
	var c := cos(q["yaw"])
	var sn := sin(q["yaw"])
	return Vector3(q["x"] + c * p[0] + sn * p[2], p[1], q["z"] - sn * p[0] + c * p[2])
func hip_world(seat: int) -> Vector3:
	return local_to_world(model_seats[seat]["module"], model_seats[seat]["hip"])
func eye_world(seat: int) -> Vector3:
	return local_to_world(model_seats[seat]["module"], model_seats[seat]["eye"])

# ------------------------------------------------------------------ pose des modules
func apply(g: Object, force := false) -> void:
	var o := _o
	var o2 := _o2
	track.at(s, o)
	dyaw = 0.0 if force else Vehicle_ang_diff(o["yaw"], yaw)
	pos = Vector3(o["x"], 0.0, o["z"])
	yaw = o["yaw"]
	for i in n:
		var si := s + (-L / 2.0 + M / 2.0 + i * M)
		track.at(clampf(si, 0.0, track.L), o2)
		var m: Dictionary = mods[i]
		m["dyaw"] = 0.0 if force else Vehicle_ang_diff(o2["yaw"], m["yaw"])
		m["x"] = o2["x"]
		m["z"] = o2["z"]
		m["yaw"] = o2["yaw"]
		m["tx"] = o2["tx"]
		m["tz"] = o2["tz"]
	if g != null and g.collision != null and state != "gone":
		var boxes: Array = []
		for m: Dictionary in mods:
			boxes.append({"x": m["x"], "z": m["z"], "w": body_len, "d": width, "rot": atan2(m["tz"], m["tx"]), "h": height})
		g.collision.set_dynamic("tram%d" % id, boxes)

func Vehicle_ang_diff(a: float, b: float) -> float:
	return atan2(sin(a - b), cos(a - b))

# ------------------------------------------------------------------ boucle
## Un pas. inp : { fwd, back, emg }. seat : place de conducteur occupée par le joueur local (0, 1) ou -1.
func update(dt: float, g: Object, inp: Dictionary, seat: int) -> void:
	var local := state == "ok" and seat >= 0
	if local:
		drive(dt, g, inp, seat)
	elif not has_driver():   # personne aux commandes : la rame freine
		freewheel(dt, g)
	var target := 1.0 if door_open else 0.0
	var rate := dt / float(Config.at("tram.drive.doorTime"))
	if door_f < target:
		door_f = minf(target, door_f + rate)
	elif door_f > target:
		door_f = maxf(target, door_f - rate)
	speed = v
	apply(g)
	if limit_msg > 0.0:
		limit_msg -= dt
	if gong_cd > 0.0:
		gong_cd -= dt

# ------------------------------------------------------------------ aiguillages (voir tram_track.gd : build_junction)
## Passer d'une voie à l'autre ne change rien à ce qu'on voit, pourvu que la rame soit ENTIÈREMENT sur une partie commune.
func adopt_track(tid: String) -> bool:
	if not reg.has(tid):
		return false
	var to: TramTrack = reg[tid]
	if to == track:
		return false
	var o := {}
	var nn := {}
	track.at(s, o)
	var p := to.project(o["x"], o["z"], 3.0, {})
	if p["d"] > 0.3:
		return false
	to.at(p["s"], nn)
	if o["tx"] * nn["tx"] + o["tz"] * nn["tz"] < 0.5:
		return false   # l'autre voie va dans un autre sens : on ne change pas
	track = to
	s = p["s"]
	return true

func set_switch(on: int) -> void:
	sw = 1 if on != 0 else 0

## Réglage `sw` (0 tout droit, 1 dévié) : une rame entièrement sur la partie commune d'un bras (nez à plus de lockGap m du point de divergence) est sur
## la ligne (tout droit) ou sur l'itinéraire du virage (dévié) ; sinon elle garde sa voie jusqu'à ce qu'elle soit entièrement dégagée.
func junction_step() -> void:
	if jn.is_empty():
		return
	var lock := float(Config.at("tram.junction.lockGap"))
	var h := L / 2.0
	var X := track
	var want := ""
	if not X.meta.is_empty():   # sur un itinéraire : tout droit = retour sur la ligne dès que la rame est entièrement sur un bras
		var m: Dictionary = X.meta
		if sw == 0:
			if s + h < float(m["a0"]) - lock:
				want = m["aLine"]
			elif s - h > float(m["a1"]) + lock:
				want = m["bLine"]
	elif sw != 0:
		for r: Dictionary in jn["routes"]:
			var m: Dictionary = r["meta"]
			if m["aLine"] == X.id and (s + h < float(m["sa"]) - lock if float(m["da"]) > 0.0 else s - h > float(m["sa"]) + lock):
				want = r["id"]
			elif m["bLine"] == X.id and (s - h > float(m["sb"]) + lock if float(m["db"]) > 0.0 else s + h < float(m["sb"]) - lock):
				want = r["id"]
	if want != "" and want != X.id:
		adopt_track(want)

## Prochain nœud devant le nez : { arm, exit, name, dist, locked } ; {} s'il est franchi.
func approach() -> Dictionary:
	if jn.is_empty():
		return {}
	var J: Dictionary = Config.at("tram.junction")
	var h := L / 2.0
	var X := track
	var dir := signf(v) if absf(v) > 0.3 else hint_dir
	var arm := ""
	var dn := 0.0
	var turn: Dictionary = {}
	if not X.meta.is_empty():
		var m: Dictionary = X.meta
		for r: Dictionary in jn["routes"]:
			if r["id"] == X.id:
				turn = r
		if dir > 0.0:
			arm = m["from"]
			dn = float(m["a0"]) - (s + h)
		else:
			arm = m["to"]
			dn = (s - h) - float(m["a1"])
	else:
		arm = TramTrack.arm_of(jn, X.id, dir)
		if arm != "":
			for r: Dictionary in jn["routes"]:
				if r["from"] == arm or r["to"] == arm:
					turn = r
					break
		if arm == "" or turn.is_empty():
			return {}
		var sd: float = float(turn["meta"]["sa"]) if turn["from"] == arm else float(turn["meta"]["sb"])
		dn = (sd - (s + dir * h)) * dir
	if not (dn > 0.0):
		return {}
	var ex := ""
	if sw != 0:
		ex = turn["to"] if turn["from"] == arm else turn["from"]
	else:
		ex = TramTrack.opposite(jn, arm)
	return {"arm": arm, "exit": ex, "name": String(J["arms"][ex]["name"]) if J["arms"].has(ex) else ex, "dist": dn, "locked": dn < float(J["lockGap"])}

## Touche d'aiguillage (conducteur) : bascule tout droit / dévié ; refusé quand le nez a dépassé le verrou. Renvoie true si changé.
func toggle_switch(g: Object) -> bool:
	if jn.is_empty() or state != "ok":
		return false
	var a := approach()
	if not a.is_empty() and bool(a["locked"]):
		g.announce("AIGUILLAGE VERROUILLÉ", "Trop tard : le nez de la rame est sur l'aiguille")
		return false
	set_switch(1 - sw)
	junction_step()
	var x := approach()
	g.announce("AIGUILLAGE", ("Direction : %s" % x["name"]) if not x.is_empty() else ("Réglé sur la voie déviée" if sw != 0 else "Réglé tout droit"))
	return true

## Sans conducteur : frein d'urgence jusqu'à l'arrêt.
func freewheel(dt: float, g: Object) -> void:
	var D: Dictionary = Config.at("tram.drive")
	if absf(v) < 0.02:
		v = 0.0
		return
	var dv := (float(D["emergency"]) if state == "ok" else float(D["brake"])) * dt
	v = 0.0 if absf(v) <= dv else v - signf(v) * dv
	integrate(dt, g)
	junction_step()

# ------------------------------------------------------------------ limites : portes de zone, extrémités, virages
## Premier obstacle devant, dans le sens dir : { d (distance libre du nez, m), kind } ("end", "gate", "obstacle").
func ahead(dir: float, g: Object) -> Dictionary:
	var T: Dictionary = Config.at("tram")
	var nose := s + dir * L / 2.0
	var gap := float(T["gate"]["stopGap"])
	var end_d := (track.L - 1.2 - nose) if dir > 0.0 else (nose - 1.2)   # le nez s'arrête à 1,2 m du heurtoir
	var best := {"d": end_d, "kind": "end"}
	for gt: Dictionary in g.rides.tram_gates(track.id):
		if g.rides.gate_open(gt):
			continue
		var d: float = (float(gt["s"]) - gap - nose) if dir > 0.0 else (nose - (float(gt["s"]) + gap))
		if d > -1.0 and d < float(best["d"]):
			best = {"d": d, "kind": "obstacle" if bool(gt.get("decor", false)) else "gate"}   # (rame de décor : butée comme une porte fermée)
	return best

## Plafond de vitesse (m/s, positif) dans le sens dir : virages (sqrt(grip R) pour tout le tronçon sous la rame, puis en regardant devant) et obstacles.
func limit(dir: float, g: Object) -> Dictionary:
	var D: Dictionary = Config.at("tram.drive")
	var tr := track
	var lim := INF
	var why := ""
	var grip := float(D["grip"])
	var q := -L / 2.0
	while q <= L / 2.0:
		var c := _cap_at(s + q, tr, grip)
		if c < lim:
			lim = c
			why = "curve"
		q += 2.0
	var nose := s + dir * L / 2.0
	var look := float(D["lookAhead"])
	var auto_brake := float(D["autoBrake"])
	var d := 2.0
	while d <= look:
		var c := _cap_at(nose + dir * d, tr, grip)
		if c != INF:
			var allowed := sqrt(c * c + 2.0 * auto_brake * 0.85 * d)   # marge : on freine un peu plus tôt que nécessaire
			if allowed < lim:
				lim = allowed
				why = "curve"
		d += 2.0
	var a := ahead(dir, g)
	var allowed2 := sqrt(2.0 * float(D["emergency"]) * 0.9 * maxf(0.0, a["d"]))
	if allowed2 < lim:
		lim = allowed2
		why = a["kind"]
	return {"v": lim, "why": why, "d": a["d"], "kind": a["kind"]}

static func _cap_at(sv: float, tr: TramTrack, grip: float) -> float:
	var i := clampi(roundi(sv), 0, tr.n - 1)
	var r := tr.R[i]
	return INF if r == INF else sqrt(grip * r)

func integrate(dt: float, g: Object) -> void:
	var tr := track
	var T: Dictionary = Config.at("tram")
	var half := L / 2.0
	var sn := s + v * dt
	var lo := half + 1.2
	var hi := tr.L - half - 1.2
	for gt: Dictionary in g.rides.tram_gates(tr.id):
		if g.rides.gate_open(gt):
			continue
		if s <= float(gt["s"]):
			hi = minf(hi, float(gt["s"]) - float(T["gate"]["stopGap"]) - half)
		else:
			lo = maxf(lo, float(gt["s"]) + float(T["gate"]["stopGap"]) + half)
	if sn > hi:
		sn = hi
		if v > 0.0:
			v = 0.0
	if sn < lo:
		sn = lo
		if v < 0.0:
			v = 0.0
	s = sn

# ------------------------------------------------------------------ conduite
func drive(dt: float, g: Object, inp: Dictionary, d_seat: int) -> void:
	var T: Dictionary = Config.at("tram")
	var D: Dictionary = T["drive"]
	var dir := cab_dir(d_seat)
	var powered: bool = g.rides.tram_powered
	var can := state == "ok" and powered and door_f == 0.0 and not door_open
	var fwd: bool = can and bool(inp.get("fwd", false))
	var back: bool = bool(inp.get("back", false))
	var emg: bool = bool(inp.get("emg", false))
	if not can and bool(inp.get("fwd", false)) and state == "ok":   # pourquoi la rame ne démarre pas
		warn_t -= dt
		if warn_t <= 0.0:
			warn_t = 3.5
			if not powered:
				g.announce("HORS TENSION", "Sous-station de l'Homme de Fer : %d pts, une seule fois pour l'équipe" % int(T["power"]["price"]))
			else:
				g.announce("PORTES OUVERTES", "Fermez les portes avant de démarrer")
	hint_dir = dir
	var vf := v * dir   # vitesse dans le sens de la cabine
	throttle = 0.0
	if emg:
		var dv := float(D["emergency"]) * dt
		vf = 0.0 if absf(vf) <= dv else vf - signf(vf) * dv
		if absf(vf) > 1.0:
			squeal = 0.3
	elif fwd and not back:
		throttle = 1.0
		if vf < 0.0:
			vf += float(D["brake"]) * 1.5 * dt
		else:
			vf += float(D["accel"]) * maxf(0.05, 1.0 - pow(vf / float(D["maxSpeed"]), 2.0)) * dt
	elif back and not fwd:
		throttle = -1.0
		if vf > 0.15:
			vf = maxf(0.0, vf - float(D["brake"]) * dt)
			squeal = maxf(squeal, 0.2 if vf > 2.0 else 0.0)
		elif can:
			vf = maxf(-float(D["reverse"]), vf - float(D["accel"]) * 0.8 * dt)
		else:
			vf = 0.0
	else:   # roue libre : la résistance et un léger frein à l'arrêt
		var dv2 := float(D["drag"]) * dt
		vf = 0.0 if absf(vf) <= dv2 else vf - signf(vf) * dv2
	vf = clampf(vf, -float(D["reverse"]), float(D["maxSpeed"]))
	# portes ouvertes ou rame hors tension : pas de traction (la rame peut seulement ralentir)
	if not can and vf * v >= 0.0:
		vf = signf(vf) * maxf(0.0, absf(vf) - float(D["drag"]) * 2.0 * dt)
	# limites : virage, feu rouge, heurtoir
	var vv := vf * dir
	var sgn := signf(vv)
	if sgn == 0.0:
		sgn = dir
	var lim := limit(sgn, g)
	var av := absf(vv)
	if av > float(lim["v"]):
		var br: float = float(D["autoBrake"]) if lim["why"] == "curve" else float(D["emergency"])
		# le frein automatique part de la vitesse de l'image précédente : la traction de cette image ne le contrarie pas
		av = maxf(float(lim["v"]), minf(av, absf(v)) - br * dt * (1.5 if av > float(lim["v"]) + 1.5 else 1.0))
		if lim["why"] == "curve" and av > float(lim["v"]) - 0.01:
			_alarm(dt, g, "VIRAGE", "Vitesse limitée : %d km/h" % roundi(float(lim["v"]) * 3.6))
		elif lim["kind"] == "gate":
			_alarm(dt, g, "FEU ROUGE", "Freinage automatique : porte de zone fermée")
		elif lim["kind"] == "obstacle":
			_alarm(dt, g, "OBSTACLE", "Rame à l'arrêt devant : freinage automatique")
		elif lim["kind"] == "end":
			_alarm(dt, g, "HEURTOIR", "Fin de ligne : freinage automatique")
		vv = sgn * av
	v = vv
	# zombies : au-dessus du seuil on les fauche, en dessous ils bloquent la rame
	var s_old := s
	integrate(dt, g)
	if hit_zombies(dt, g):
		s = s_old
		v = 0.0
	junction_step()
	hit_player(dt, g)
	if door_open and absf(v) > float(D["doorSpeed"]):
		set_doors(false)

func _alarm(dt: float, g: Object, title: String, sub: String) -> void:
	alarm_t -= dt
	if alarm_t > 0.0:
		return
	alarm_t = 0.7
	events.append("alarm")
	if limit_msg <= 0.0:
		g.announce(title, sub)
		limit_msg = 3.0

func set_doors(open: bool) -> void:
	if door_open == open:
		return
	door_open = open
	events.append("chime_open" if open else "chime_close")

## Portes de la rame (touche des portes) : à l'arrêt seulement.
func toggle_doors(g: Object) -> void:
	if state != "ok":
		return
	if absf(v) > float(Config.at("tram.drive.doorSpeed")):
		g.announce("PORTES", "Arrêtez la rame pour ouvrir les portes")
		return
	set_doors(not door_open)

## Zombies devant le nez : au-dessus de zombieSpeed on les fauche, sinon ils bloquent. Renvoie true si un zombie lent bloque la rame.
func hit_zombies(_dt: float, g: Object) -> bool:
	var H: Dictionary = Config.at("tram.hit")
	if absf(v) < 0.05:
		return false
	var dir := signf(v)
	var lead: Dictionary = mods[n - 1 if dir > 0.0 else 0]
	var fx: float = lead["tx"] * dir
	var fz: float = lead["tz"] * dir
	var rx: float = -lead["tz"]
	var rz: float = lead["tx"]
	var nose_d := M / 2.0 - 0.15
	var blocked := false
	for z: ZombieSim in g.zombies:
		if not z.targetable():
			continue
		var dx: float = z.pos.x - lead["x"]
		var dz: float = z.pos.z - lead["z"]
		var ah := dx * fx + dz * fz
		var lat := dx * rx + dz * rz
		if ah < nose_d - 1.2 or ah > nose_d + 1.1 or absf(lat) > width / 2.0 + 0.5:
			continue
		if absf(v) >= float(H["zombieSpeed"]):
			var until: float = float(hit_cd.get(z.id, 0.0))
			if until > g.time:
				continue
			hit_cd[z.id] = g.time + float(H["zombieCooldown"])
			g.hit_zombie(z, false, float(H["zombieK"]) * absf(v), 1.0)
			g.shake = maxf(float(g.shake), 0.15)
		else:
			blocked = true
	return blocked

## Joueur local à pied touché par une rame rapide (jamais mortel).
func hit_player(_dt: float, g: Object) -> void:
	var H: Dictionary = Config.at("tram.hit")
	var p: PlayerSim = g.player
	if g.rides.ride_of_player() != null or p.dead:
		return   # (assis ou debout dans la rame : solidaire d'elle, jamais heurté)
	if absf(v) < float(H["playerSpeed"]):
		return
	for m: Dictionary in mods:
		var dx: float = p.pos.x - m["x"]
		var dz: float = p.pos.z - m["z"]
		if dx * dx + dz * dz > 16.0:
			continue
		var lx: float = dx * m["tx"] + dz * m["tz"]
		var lz: float = -dx * m["tz"] + dz * m["tx"]
		if absf(lx) < body_len / 2.0 + 0.7 and absf(lz) < width / 2.0 + 0.7 and float(hit_cd.get("p", 0.0)) <= g.time:
			hit_cd["p"] = g.time + 1.2
			var d := minf(float(H["playerDamage"]), p.health - 1.0)
			if d > 0.0:
				g.hurt_player(d, "crash")
			g.shake = maxf(float(g.shake), 0.4)
			return

## Informations pour le HUD du conducteur.
func hud_info() -> Dictionary:
	var a := approach()
	var show := not a.is_empty() and float(a["dist"]) < 160.0
	return {"speed": v, "vmax": float(Config.at("tram.drive.maxSpeed")), "vmin": float(Config.at("tram.hit.zombieSpeed")), "hp": hp, "hp_max": max_hp(),
		"name": "TRAM", "sw": ({"name": a["name"], "diverge": sw != 0, "locked": a["locked"], "dist": roundi(float(a["dist"]))} if show else {})}
