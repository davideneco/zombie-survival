class_name SoakBot
extends RefCounted
## Pilote de longue partie (J11, `--soak=N` de main.gd) : un joueur qui se promène, vise et tire sur les zombies visibles, saute, enjambe, se débloque
## avec la touche K quand l'invite apparaît, achète tout, et reste en vie (santé rendue sous 35 PV, comme un joueur qui se soigne à l'abri) pour que
## la partie dure jusqu'à la manche demandée. Il sert à chercher les erreurs de script, les fuites, les blocages et les chutes de performance sur 15 manches et plus.
## Rapporte à chaque manche : mémoire, objets, noeuds, coût du pas de jeu.

const AIM_HEIGHT := 1.4
const SHOOT_RANGE := 45.0
const STUCK_SECONDS := 1.5     ## sans avancer d'un mètre en 1,5 s : on change de cap pour 2 s
const TURN_SECONDS := 2.0
const MAX_AMMO_PERIOD := 20.0  ## Munitions max toutes les 20 s

var rng := RandomNumberGenerator.new()
var heading := 0.0             ## cap de marche (yaw)
var goal := Vector2.ZERO
var _ref := Vector2.ZERO
var _ref_t := 0.0
var _turn_t := 0.0
var _jump_t := 0.0
var _ammo_t := 0.0
var _unstick_hold := false
var verbose := false
var perks: Array = ["juggernog", "staminup", "doubletap", "speedcola", "quickrevive", "phdflopper"]   ## atouts donnés au départ (v0.27.0 : --bot-perks=a,b,c)
## v0.19.0 (`--perf-soak`) : mode « perf », un joueur qui provoque les premières fois (portes fermées au départ, puis achats de portes, d'atouts, d'armes, de la boîte et
## du Pack-a-Punch, visites d'étages, moto et tram) : une course toutes les ERRAND_PERIOD s de jeu ; les points sont donnés à l'arrivée (un joueur qui a économisé).
var perf := false
var start_round := 4        ## --perf-round=N : manche de départ du mode perf
const ERRAND_PERIOD := 28.0
const ERRAND_TIMEOUT := 40.0
const ERRAND_ORDER := ["door", "perk", "wall", "level", "door", "box", "ride", "pap", "knight", "door", "tram", "level", "perk", "pest", "door", "wall"]
var errand := ""
var errand_goal := Vector2.ZERO
var errand_t := 0.0
var errand_next := 12.0
var errand_i := 0
var errand_hold := 0.0
var errand_log: Array[String] = []
var _back := Vector3.INF
var _round_t0 := 0.0
var _stall_samples := 0
var heals := 0
var unstuck_holds := 0
var stuck_events := 0
var vaults := 0
var steps := 0
var step_us := 0
var step_us_max := 0
var worst: Array[int] = []      ## 50 pires pas (µs)
var rows: Array[Dictionary] = []
var _round_seen := 0
var _kills0 := 0
var _us_round := 0
var _steps_round := 0
var _us_max_round := 0

func _init(seed_value: int = 1) -> void:
	rng.seed = seed_value

## Loadout et état de départ.
func setup(g: Node) -> void:
	if perf:
		g.director.round_number = start_round - 1   # la manche 4 (coureurs, rampants) vient vite ; les chevaliers (8) et pestiférés (10) par les séjours en zone
	else:
		g.world.open_all_doors()
	g.points = 1000000
	for id in ["m249", "ak47"]:
		g.arms.give_weapon(id)
	for id in perks:
		if g.has_method("add_perk"):
			g.add_perk(id)
	_pick_goal(g)
	g.vaulted.connect(func() -> void: vaults += 1)

func _pick_goal(g: Node) -> void:
	if g.gm != null and g.gm.layout != null and not g.gm.layout.ground.is_empty():   # v0.26.0 : Zone unique : on reste dans la zone
		goal = g.gm.layout.ground[rng.randi() % g.gm.layout.ground.size()]
		return
	var zones: Array = g.world.objects["zones"]
	var z: Dictionary = zones[rng.randi() % zones.size()]
	var c: Variant = z.get("center")
	if c == null:
		goal = Vector2(g.player.pos.x + rng.randf_range(-60, 60), g.player.pos.z + rng.randf_range(-60, 60))
	else:
		goal = Vector2(float(c["x"]), float(c["z"]))

## Course en cours : cap vers l'objectif, achat à l'arrivée, téléportation si la course s'éternise (note dans errand_log).
func _errands(g: Node) -> void:
	var p: PlayerSim = g.player
	var dt := 1.0 / 60.0
	if errand == "":
		if g.time >= errand_next and not p.downed and not p.dead and (g.rides == null or not g.rides.attached()):
			_start_errand(g)
		return
	errand_t += dt
	if errand_hold > 0.0:   # visite d'un étage ou trajet à moto : on y reste un moment
		errand_hold -= dt
		if errand_hold <= 0.0:
			_end_errand(g)
		return
	goal = errand_goal
	var here := Vector2(p.pos.x, p.pos.z)
	if here.distance_to(errand_goal) < 2.0:
		g.points = maxi(g.points, 30000)
		g.interact()
		_log(g, "arrivé, achat")
		_end_errand(g)
	elif errand_t > ERRAND_TIMEOUT:
		var dir := (here - errand_goal).normalized()
		p.pos = Vector3(errand_goal.x + dir.x * 1.2, p.pos.y, errand_goal.y + dir.y * 1.2)
		_log(g, "téléporté (course trop longue)")
		errand_t = ERRAND_TIMEOUT - 3.0

func _log(g: Node, what: String) -> void:
	errand_log.append("t=%.0f %s : %s" % [g.time, errand, what])
	PerfLog.event("bot %s : %s" % [errand, what])

func _end_errand(g: Node) -> void:
	errand = ""
	errand_next = g.time + ERRAND_PERIOD
	_pick_goal(g)

func _nearest(g: Node, pts: Array) -> Vector2:
	var best := Vector2.INF
	var bd := INF
	for v: Vector2 in pts:
		var d := v.distance_to(Vector2(g.player.pos.x, g.player.pos.z))
		if d < bd and d > 1.0:
			bd = d
			best = v
	return best

func _start_errand(g: Node) -> void:
	var kind: String = ERRAND_ORDER[errand_i % ERRAND_ORDER.size()]
	errand_i += 1
	if g.gm != null and kind in ["door", "level", "ride", "tram", "knight", "pest"]:   # v0.26.0 : Zone unique : rien hors de la zone
		errand = kind
		_log(g, "rien à faire (zone unique)")
		_end_errand(g)
		return
	var pts: Array = []
	match kind:
		"door":
			for d: Dictionary in g.world.doors:
				if not d["open"]:
					pts.append(Vector2(d["points"][0][0], d["points"][0][1]))
		"perk", "box", "pap":
			for m: Dictionary in g.machines.list:
				if m["type"] == kind and (kind != "box" or m == g.machines.box.active_box()):
					if kind == "perk" and g.arms.perks.get(m["id"], false):
						continue
					pts.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
		"wall":
			for ww: Dictionary in g.world.objects.get("wallWeapons", []):
				pts.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
		"level":
			var seen := {}
			for t in g.world.levels.tris:
				var r: int = t["region"]
				if r > 0 and not seen.has(r) and g.world.levels.regions[r]["kind"] == "floor":
					seen[r] = true
					pts.append(Vector3((t["x0"] + t["x1"] + t["x2"]) / 3.0, (t["y0"] + t["y1"] + t["y2"]) / 3.0, (t["z0"] + t["z1"] + t["z2"]) / 3.0))
		"ride", "knight", "pest":
			pts.append(Vector2.ZERO)
		"tram":
			pts.append(Vector2.ZERO)
	errand = kind
	errand_t = 0.0
	errand_hold = 0.0
	if pts.is_empty():
		_log(g, "rien à faire")
		_end_errand(g)
		return
	var p: PlayerSim = g.player
	if kind == "knight" or kind == "pest":
		var zn := "Homme de Fer" if kind == "knight" else "Petite France"
		for z: Dictionary in g.world.objects["zones"]:
			if String(z.get("name", "")) == zn and z.get("center") != null:
				_back = p.pos
				p.pos = Vector3(float(z["center"]["x"]), 0.0, float(z["center"]["z"]))
				errand_hold = 40.0
				_log(g, "séjour en zone %s" % zn)
				return
		_log(g, "zone %s introuvable" % zn)
		_end_errand(g)
		return
	if kind == "level":
		var c: Vector3 = pts[rng.randi() % pts.size()]
		_back = p.pos
		p.pos = c + Vector3(0, 0.05, 0)
		var rid: int = g.world.levels.region_at(c.x, c.z, c.y)
		for k in 2:   # des zombies déjà montés avec lui : le champ de l'étage est demandé (grille de navigation)
			var zz: ZombieSim = g.debug_spawn(Vector3(c.x + 2.0 + k, c.y, c.z), 1.8)
			zz.region = rid
		errand_hold = 22.0
		_log(g, "visite de l'étage à (%.0f ; %.0f ; %.0f)" % [c.x, c.y, c.z])
		return
	if kind == "ride":
		var v2: Variant = null
		for v in g.rides.vehicles:
			if (v.type == "moto" or v.type == "grosseMoto") and v.usable():
				v2 = v
				break
		if v2 == null:
			_log(g, "aucune moto utilisable")
			_end_errand(g)
			return
		_back = p.pos
		p.pos = Vector3(v2.x + 1.0, 0.0, v2.z + 0.5)
		g.rides.try_mount(v2, 0)
		errand_hold = 16.0
		_log(g, "monte à moto")
		return
	if kind == "tram":
		if g.rides.trams.is_empty():
			_end_errand(g)
			return
		var tr: TramSim = g.rides.trams[0]
		g.rides.set_power(true, true)
		var nose: Dictionary = tr.mods[tr.n - 1]
		_back = p.pos
		p.pos = Vector3(nose["x"] + nose["tx"] * (tr.M / 2.0 + 1.0), 0.0, nose["z"] + nose["tz"] * (tr.M / 2.0 + 1.0))
		g.rides.try_mount(tr, 0)
		errand_hold = 14.0
		_log(g, "monte dans la rame")
		return
	errand_goal = _nearest(g, pts)
	if errand_goal == Vector2.INF:
		_end_errand(g)
		return
	_log(g, "part vers (%.0f ; %.0f)" % [errand_goal.x, errand_goal.y])

func think(g: Node) -> Dictionary:
	var p: PlayerSim = g.player
	var input := {}
	if perf:
		_errands(g)
		var riding: bool = g.rides != null and g.rides.attached()
		if riding and errand != "" and errand_hold > 0.0:
			input["mz"] = 1.0
			input["mx"] = sin(float(errand_i) + g.time * 0.3) * 0.6
			input["sprint"] = true
			return input
		elif riding and errand == "":
			g.interact()   # descend de la machine
			if g.rides.attached():
				g.rides.leave_vehicle(true)
		if errand == "" and _back != Vector3.INF and not riding:   # retour de l'étage ou de la machine
			p.pos = _back
			_back = Vector3.INF
	# aide : un joueur qui se soigne (hors fin de partie) et reçoit des munitions
	if p.health < 35.0 and not p.downed and not p.dead:
		p.health = p.max_health
		heals += 1
	if p.downed:
		p.revive(g.time)
		heals += 1
	_ammo_t -= 1.0 / 60.0
	if _ammo_t <= 0.0:
		_ammo_t = MAX_AMMO_PERIOD
		g.arms.max_ammo()
	# cap : vers le but, ou cap aléatoire quand on est bloqué
	var here := Vector2(p.pos.x, p.pos.z)
	_ref_t += 1.0 / 60.0
	if here.distance_to(_ref) > 1.0:
		_ref = here
		_ref_t = 0.0
	elif _ref_t > STUCK_SECONDS and _turn_t <= 0.0:
		_turn_t = TURN_SECONDS
		heading = rng.randf() * TAU
		stuck_events += 1
		_ref_t = 0.0
	if _turn_t > 0.0:
		_turn_t -= 1.0 / 60.0
	else:
		# peu de zombies restants depuis un moment (ceux qui n'ont aucun chemin tournent autour d'un mur, dans le JS aussi) : un joueur va les chercher
		if g.time - _round_t0 > 60.0 and g.alive_count() <= 4 and g.alive_count() > 0:
			for z: ZombieSim in g.zombies:
				if not z.dead:
					goal = Vector2(z.pos.x, z.pos.z)
					break
		var d := goal - here
		if d.length() < (1.5 if errand != "" else 8.0):
			if errand == "":
				_pick_goal(g)
		else:
			heading = atan2(-d.x, -d.y)
	# cible : le zombie visible le plus proche
	var eye := p.eye()
	var best: ZombieSim = null
	var best_d := INF
	for z: ZombieSim in g.zombies:
		if z.dead:
			continue
		var to := z.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		var l := to.length()
		if l > SHOOT_RANGE or l >= best_d:
			continue
		var dn := to / l
		if g.collision.ray_hit(eye.x, eye.y, eye.z, dn.x, dn.y, dn.z, l) < l - 0.01:
			continue
		best = z
		best_d = l
	if best != null:
		var d := best.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		p.yaw = atan2(-d.x, -d.z)
		p.pitch = atan2(d.y, sqrt(d.x * d.x + d.z * d.z))
		input["fire"] = fmod(g.time, 0.1) < 0.05
		# on marche à reculons ou de côté pour garder ses distances : le cap de marche relatif à la visée
		var rel := heading - p.yaw
		input["mx"] = -sin(rel)
		input["mz"] = cos(rel)
	else:
		p.yaw = lerp_angle(p.yaw, heading, 0.15)
		p.pitch = lerpf(p.pitch, 0.0, 0.2)
		input["mx"] = 0.0
		input["mz"] = 1.0
		input["sprint"] = true
	if g.weapon.ammo == 0 and g.weapon.reserve > 0:
		input["reload"] = true
	# saut et enjambement quand on est bloqué ou devant un obstacle bas
	_jump_t -= 1.0 / 60.0
	if p.vault_ready or (_ref_t > 0.5 and _jump_t <= 0.0):
		input["jump"] = true
		_jump_t = 0.8
	# déblocage : on maintient K quand l'invite est là
	if g.unstick != null and g.unstick.stuck and g.unstick.cool <= 0.0:
		input["unstick"] = true
		_unstick_hold = true
	elif _unstick_hold:
		_unstick_hold = false
		unstuck_holds += 1
	if rng.randf() < 0.002:
		input["grenade"] = true
	if rng.randf() < 0.0015:
		input["knife"] = true
	if rng.randf() < 0.004 and not g.arms.inventory.is_empty():
		input["weapon"] = rng.randi() % g.arms.inventory.size()
	return input

## Après chaque pas de jeu : coût du pas et rapport de manche.
func after_step(g: Node, us: int) -> void:
	steps += 1
	step_us += us
	step_us_max = maxi(step_us_max, us)
	_us_round += us
	_steps_round += 1
	_us_max_round = maxi(_us_max_round, us)
	if verbose and steps % 1800 == 0:   # toutes les 30 s de jeu : où sont les zombies restants
		var parts: PackedStringArray = []
		for z: ZombieSim in g.zombies:
			if not z.dead:
				parts.append("%.0fm%s%s[%s%s%s%s np%.1f far%.0f sp%.1f st%.1f stk%.1f side%.1f]" % [Vector2(z.pos.x - g.player.pos.x, z.pos.z - g.player.pos.z).length(), "r%d" % z.region if z.region != 0 else "", "!" if z.no_progress > 1.0 else "", z.kind, "R" if z.runner else "", "C" if z.crawler else "", "V" if not z.vault.is_empty() else "", z.no_progress, z.far_t, z.speed, z.spawn_t, z.stuck_t, z.sidestep_t])
		print("  t=%.0f joueur (%.0f ; %.0f) PV %.0f, %d zombies : %s" % [g.time, g.player.pos.x, g.player.pos.z, g.player.health, parts.size(), " ".join(parts)])
	var r: int = g.round_number
	if r != _round_seen:
		if perf and r in [5, 7, 9]:
			g.director.round_number = r + 2   # saute des manches : plus de zombies, les types rares
			r += 2
		_report(g, r)
		_round_seen = r
		_round_t0 = g.time
		_stall_samples = 0
	# manche qui s'éternise (> 200 s) : on suit les zombies restants pendant 12 s (position, case du champ de flux, direction)
	if g.time - _round_t0 > 200.0 and steps % 60 == 0 and _stall_samples < 12:
		_stall_samples += 1
		var nav: NavGrid = g.env.nav
		for z: ZombieSim in g.zombies:
			if z.dead:
				continue
			var ix := nav.cx(z.pos.x)
			var iz := nav.cz(z.pos.z)
			var dv := nav.dist[nav.idx(ix, iz)] if nav.inside(ix, iz) else -1
			var st := nav.steer(z.pos.x, z.pos.z)
			var dx: float = g.player.pos.x - z.pos.x
			var dz: float = g.player.pos.z - z.pos.z
			print("  STALL t=%.0f zombie %d (%.1f ; %.1f) joueur (%.1f ; %.1f) d=%.1f champ=%d steer=%s (%.2f ; %.2f) los=%s bloquee=%s np=%.1f stuck=%.1f side=%.1f vault=%s cd=%.1f" % [g.time, z.id, z.pos.x, z.pos.z, g.player.pos.x, g.player.pos.z, sqrt(dx * dx + dz * dz), dv, st, nav.steer_x, nav.steer_z, nav.los(z.pos.x, z.pos.z, g.player.pos.x, g.player.pos.z), nav.is_blocked_at(z.pos.x, z.pos.z), z.no_progress, z.stuck_t, z.sidestep_t, not z.vault.is_empty(), z.vault_cd])

func _report(g: Node, r: int) -> void:
	var row := {
		"round": r, "t": g.time, "kills": g.kills, "zombies": g.zombies.size(),
		"mem_mb": Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		"objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		"nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"orphans": int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
		"resources": int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		"step_avg_ms": (_us_round / float(maxi(1, _steps_round))) / 1000.0, "step_max_ms": _us_max_round / 1000.0,
		"heals": heals, "stuck": stuck_events, "unstuck": g.unstick.unstuck_count if g.unstick != null else 0, "vaults": vaults,
		"points": g.points, "earned": g.points_earned, "sfx_voices": Sfx.voice_count(),
	}
	rows.append(row)
	_us_round = 0
	_steps_round = 0
	_us_max_round = 0
	print("SOAK manche %2d t=%6.1f s : %3d tués, %6d points gagnés, %2d en vie, mém %.1f Mo, objets %d, noeuds %d (orphelins %d), ressources %d, pas %.2f ms (max %.1f), %d soins, %d blocages, %d déblocages, %d enjambements, relogés %d" % [
		r, g.time, g.kills, g.points_earned, g.zombies.size(), row["mem_mb"], row["objects"], row["nodes"], row["orphans"], row["resources"], row["step_avg_ms"], row["step_max_ms"],
		heals, stuck_events, row["unstuck"], vaults, g.relocated])
