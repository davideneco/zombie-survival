class_name FinaleSim
extends BossCtx
## « L'Heure du Jugement » et l'Acte V « L'Aube » (port de src/finale.js, partie jouée par l'hôte, et de la partie logique de src/summit.js) :
##   intro -> 3 vagues (crypte, galeries, portes) -> le Bourreau dans la nef (phases I, II) -> il fuit : ascension de la tour sud ->
##   combat final sur la plateforme à 67,5 m (phases III, IV) -> victoire -> Acte V : faisceau, gargouilles, l'Ange du Jugement, la rampe (rafales,
##   gargouilles qui montent), le Fanal (maintenir la touche d'interaction), l'Aube (ciel, cendres, Bénédiction, vue orbitale), puis la Nuit éternelle.
## Pur : aucun nœud. Tout ce qui se voit ou s'entend sort par les signaux de Game (boss_event, finale_sfx, announced, victory_screen, liberated_screen).
## Le Maître Tanneur (mini-boss des manches 15, 20, 25…) vit ici aussi : sa mort donne Max Munitions et des points.

var g: Node
var f: Dictionary = {}            ## machine à états de la fin de partie ; vide : aucune en cours
var R: Dictionary = {}            ## régions utiles : crypt, R2, R3, W2, PL, TOP, RAMP, TIP
var gusts: Array = []             ## rafales de la rampe : { dx, dz, tel, dur, t, done }
var mark_t := 0.0                 ## marque (couronne) du joueur local : secondes restantes
var mark_text := ""
var fan_near := false             ## le joueur local est assez près du Fanal pour le tenir
var fan_hold := false             ## ... et maintient la touche d'interaction
var dawn_on := false
var dawn_t0 := 0.0
var sky_phase := "night"          ## nuit -> aube (dawn.sky s) -> jour (eternal.day s) -> crépuscule (eternal.dusk s) -> nuit
var sky_t := 0.0
var sky_k := 0.0
var orbit_on := false
var orbit_t := 0.0
var orbit_a0 := 0.0
var cam_lock := false
var mini_bar: Dictionary = {}
var log: Array = []               ## journal des évènements (tests et outils)
var rand_fn: Callable             ## tirage imposé (tests) ; invalide : Game.rng

func _init(g_: Node) -> void:
	g = g_
	var lv: Levels = g.world.levels if g.world != null else null
	if lv == null:
		return
	for r: Dictionary in lv.regions:
		match String(r["name"]):
			"Crypte romane": R["crypt"] = int(r["id"])
			"Triforium": R["R2"] = int(r["id"])
			"Galerie haute": R["R3"] = int(r["id"])
			"Salle des cloches": R["W2"] = int(r["id"])
			"Plateforme": R["PL"] = int(r["id"])
			"Terrasse de la flèche": R["TOP"] = int(r["id"])
			"Rampe de la flèche": R["RAMP"] = int(r["id"])
			"Pointe de la flèche": R["TIP"] = int(r["id"])

static func F() -> Dictionary:
	return Config.at("finale")

static func S() -> Dictionary:
	return Config.at("summit")

func _rand() -> float:
	if rand_fn.is_valid():
		return float(rand_fn.call())
	return g.rng.randf()

func lv() -> Levels:
	return g.world.levels

func standing() -> Array[PlayerSim]:
	var out: Array[PlayerSim] = []
	var p: PlayerSim = g.player
	if not p.dead and not p.downed:
		out.append(p)
	return out

func active() -> bool:
	return not f.is_empty()

func state() -> String:
	return String(f.get("state", ""))

func summit_state() -> String:
	var s := state()
	return s if s.begins_with("summit_") else ""

# ------------------------------------------------------------------ BossCtx : ce que les boss demandent à la partie
func event(name: String, data: Dictionary) -> void:
	var d := data.duplicate()
	d["name"] = name
	d["time"] = g.time
	log.append(d)
	_show_event(name, data)

func _show_event(name: String, d: Dictionary) -> void:
	match name:
		"boss_roar":
			if d.get("text", "") != "":
				g.announce("LE BOURREAU", String(d["text"]))
		"boss_rise":
			g.announce("LE BOURREAU", "Il surgit !")
		"boss_mark":
			_set_crown(d.get("pid", null), float(d.get("dur", 0.0)), String(d.get("text", "")))
		"boss_shock":
			g.shake = maxf(g.shake, 0.5 * _near_k(d))
		"angel_death", "angel_judge", "boss_stun":
			pass
	g.boss_event.emit(name, d)

func _near_k(d: Dictionary) -> float:
	var near := Vector2(float(d.get("x", 0.0)) - g.player.pos.x, float(d.get("z", 0.0)) - g.player.pos.z).length()
	return maxf(0.15, 1.0 - near / 60.0)

func hurt_player(p: PlayerSim, dmg: float, kx: float, kz: float, src: String) -> void:
	g.hurt_player_by(p, dmg, kx, kz, src)

func pid_of(_p: PlayerSim) -> int:
	return -1

func dust(x: float, y: float, z: float, n: int = 6) -> void:
	g.boss_event.emit("dust", {"x": x, "y": y, "z": z, "n": n})

func summon_pest(boss: BossSim) -> void:   # le Maître Tanneur appelle 3 pestiférés
	var n := int(Config.at("tanner.summon.count"))
	for i in n:
		var a := float(i) / n * TAU + _rand() * 0.5
		spawn_at("bloat", boss.region, boss.pos.x + cos(a) * 3.5, boss.pos.z + sin(a) * 3.5)
	event("boss_roar", {"x": boss.pos.x, "y": boss.pos.y, "z": boss.pos.z})

func glas_adds(boss: BossSim) -> void:     # le Glas (70 %) : 2 chevaliers de fer et 4 zombies (+2 par joueur de plus) surgissent autour du Bourreau
	var G: Dictionary = F()["boss"]["glas"]
	var np := maxi(1, standing().size())
	var n := int(G["knights"]) + int(G["zombies"]) + int(G["perPlayer"]) * (np - 1)
	for i in n:
		var a := float(i) / n * TAU + _rand() * 0.4
		var x := boss.pos.x + cos(a) * 7.0
		var z := boss.pos.z + sin(a) * 7.0
		spawn_at("armored" if i < int(G["knights"]) else ("normal" if _rand() < 0.7 else "runner"), boss.region, x, z)

func summon(boss: BossSim) -> void:
	var np := maxi(1, standing().size())
	var n := 4 + 2 * np
	for i in n:
		var a := float(i) / n * TAU + _rand() * 0.4
		spawn_at("normal" if _rand() < 0.7 else "runner", boss.region, boss.pos.x + cos(a) * 6.0, boss.pos.z + sin(a) * 6.0)

func on_leap(_boss: BossSim) -> void:
	if f.is_empty():
		return
	f["state"] = "ascent"
	f["t"] = 0.0
	f["plT"] = 0.0
	g.announce("ACTE III — L'ASCENSION", "Il fuit vers la plateforme : suivez-le par l'escalier de la tour sud (330 marches) !")

# ------------------------------------------------------------------ marque (couronne)
func _set_crown(pid: Variant, t: float, text: String) -> void:
	if pid == null or t <= 0.0:
		mark_t = 0.0
		mark_text = ""
		return
	mark_t = t
	mark_text = "JUGEMENT" if text != "" else "CONDAMNÉ"
	if text != "":
		g.announce("LE JUGEMENT", text)
	else:
		g.announce("LA SENTENCE", "Le Bourreau vous a marqué : il ne vous lâchera pas !")

func mark_label() -> String:
	return "%s · %d s" % [mark_text, ceili(mark_t)] if mark_t > 0.0 else ""

# ------------------------------------------------------------------ apparition des zombies de la fin de partie
func free_at(region: int, x: float, z: float) -> bool:
	var nav: NavGrid = lv().nav_of(region) if region != 0 else g.world.nav
	return nav == null or not nav.is_blocked_at(x, z)

func spawn_at(kind: String, region: int, x: float, z: float, y_override: float = INF) -> ZombieSim:
	var y: float = y_override if y_override != INF else (float(lv().regions[region]["y"]) if region != 0 else 0.0)
	var base: float = g.director.zombie_health * float((F()["kindHealth"] as Dictionary).get(kind, 1.0))
	var spd: float = g.director.zombie_speed * (0.9 + _rand() * 0.3)
	if kind == "runner":
		spd *= 1.55
	if kind == "gargoyle":
		spd *= float(S()["gargoyles"]["speed"])
	var zb := ZombieSim.new()
	zb.id = g.next_zombie_id()
	zb.rng = g.rng
	zb.health = base
	zb.max_health = base
	zb.speed = spd
	zb.init_traits(g.rng)
	if kind == "crawler":
		zb.make_crawler()
	if kind == "armored" or kind == "bloat" or kind == "gargoyle":
		zb.make_kind(kind)
	if kind == "runner" or kind == "gargoyle":
		zb.runner = true
	zb.region = region
	zb.pos = Vector3(x, y, z)
	g.add_zombie(zb)
	g.boss_event.emit("dust", {"x": x, "y": y + 0.4, "z": z, "n": 10})
	return zb

func _pick(kinds: Dictionary) -> String:
	var r := _rand()
	var last := "normal"
	for k: String in kinds:
		last = k
		r -= float(kinds[k])
		if r <= 0.0:
			return k
	return last

func spawn_point(where: String) -> Dictionary:
	var L := lv()
	if where == "crypt":
		var l: Array = L.regions[R["crypt"]]["spawns"]
		var p: Array = l[int(floor(_rand() * l.size()))]
		return {"region": R["crypt"], "x": p[0] + (_rand() - 0.5) * 2.0, "z": p[1] + (_rand() - 0.5) * 2.0}
	if where == "galleries":
		var regs := [R["R2"], R["R3"], R["W2"]]
		for _k in 6:
			var r: int = regs[int(floor(_rand() * regs.size()))]
			var l2: Array = L.regions[r]["spawns"]
			var p2: Array = l2[int(floor(_rand() * l2.size()))]
			var x: float = p2[0] + (_rand() - 0.5) * 2.0
			var z: float = p2[1] + (_rand() - 0.5) * 2.0
			if free_at(r, x, z):
				return {"region": r, "x": x, "z": z}
		var l3: Array = L.regions[R["R3"]]["spawns"]
		return {"region": R["R3"], "x": l3[0][0], "z": l3[0][1]}
	# portes : à l'extérieur, devant le grand portail ouest (au sol) ; ils se ruent à l'intérieur
	for _k in 8:
		var q := Cathedral.P(-62.0 - _rand() * 14.0, (_rand() - 0.5) * 18.0)
		if free_at(0, q.x, q.y):
			return {"region": 0, "x": q.x, "z": q.y}
	var q2 := Cathedral.P(-62.0, 0.0)
	return {"region": 0, "x": q2.x, "z": q2.y}

func alive_count() -> int:
	var n := 0
	for z in g.zombies:
		if not z.dead and not z.is_boss:
			n += 1
	return n

func garg_alive() -> int:
	var n := 0
	for z in g.zombies:
		if not z.dead and z.kind == "gargoyle":
			n += 1
	return n

## Barre de vie de la fin de partie : { hp, max, phase, name, inv, thresholds } ; {} : aucune.
func boss_bar() -> Dictionary:
	var b := f.get("boss", null) as BossSim
	if b == null or b.dead:
		return {}
	if b.is_angel:
		return {"hp": maxf(0.0, roundf(b.health)), "max": b.max_health, "phase": 1, "inv": false, "name": "L'ANGE DU JUGEMENT", "thresholds": []}
	var names: Array = F()["boss"]["names"]
	return {"hp": maxf(0.0, roundf(b.health)), "max": b.max_health, "phase": b.phase, "inv": b.is_invulnerable(), "name": names[clampi(b.phase - 1, 0, 3)], "thresholds": F()["boss"]["thresholds"]}

# ------------------------------------------------------------------ ouverture de la finale
func open_zones() -> int:
	var n := 0
	for i in g.world.zone_names.size():
		if g.world.is_zone_open(i):
			n += 1
	return n

func is_ready() -> bool:
	var Fc := F()
	return g.round_number >= int(Fc["minRound"]) and open_zones() >= int(Fc.get("minZones", 0))

func prompt() -> String:
	var Fc := F()
	if g.finale_done:
		return "L'horloge s'est tue. Strasbourg tient encore…"
	if active():
		return "L'Heure du Jugement a sonné : tenez bon !"
	if not is_ready():
		var need: Array = []
		if g.round_number < int(Fc["minRound"]):
			need.append("manche %d requise" % int(Fc["minRound"]))
		if open_zones() < int(Fc.get("minZones", 0)):
			need.append("%d/%d quartiers ouverts" % [open_zones(), int(Fc["minZones"])])
		return "L'horloge astronomique… (%s pour l'Heure du Jugement)" % " · ".join(PackedStringArray(need))
	return "E Faire sonner l'Heure du Jugement : le Bourreau vous attend%s" % ((" (%d pts)" % int(Fc["price"])) if int(Fc["price"]) > 0 else "")

## Touche d'interaction sur l'horloge : lance la finale si elle est prête et payée.
func use_clock() -> bool:
	if active() or g.finale_done or not is_ready() or g.points < int(F()["price"]):
		g.finale_sfx.emit("deny", 1.0)
		return false
	g.points -= int(F()["price"])
	start()
	return true

func start() -> void:
	if active():
		return
	var np := maxi(1, standing().size())
	f = {"state": "intro", "t": 0.0, "wave": -1, "queue": [], "spawnT": 0.0, "np": np, "banner": "L'HEURE DU JUGEMENT", "boss": null, "addT": 0.0, "plT": 0.0}
	g.finale_sfx.emit("bell_x6", 1.0)
	g.announce("L'HEURE DU JUGEMENT", "ACTE I — Les cloches sonnent… la cathédrale s'éveille")

func start_wave(n: int) -> void:
	var W: Dictionary = (F()["waves"] as Array)[n]
	f["wave"] = n
	f["state"] = "wave"
	f["t"] = 0.0
	var np := maxi(1, standing().size())
	var total := roundi(float(W["count"]) + float(W["perPlayer"]) * (np - 1))
	var q: Array = []
	for _i in total:
		q.append(_pick(W["kinds"]))
	f["queue"] = q
	f["total"] = total
	f["spawnT"] = 1.5
	g.announce("VAGUE %d / %d" % [n + 1, (F()["waves"] as Array).size()], String(W["name"]).to_upper())
	g.finale_sfx.emit("round_start", 1.0)

# ------------------------------------------------------------------ pas de simulation
func step(dt: float) -> void:
	_update_gusts(dt)
	if mark_t > 0.0:
		mark_t -= dt
	_update_fanal()
	_sky_step(dt)
	_orbit_step(dt)
	_update_mini_bar()
	if f.is_empty():
		return
	f["t"] = float(f["t"]) + dt
	var Fc := F()
	match String(f["state"]):
		"intro":
			f["banner"] = "L'HEURE DU JUGEMENT"
			if float(f["t"]) > 6.0:
				start_wave(0)
		"wave":
			var W: Dictionary = (Fc["waves"] as Array)[int(f["wave"])]
			f["spawnT"] = float(f["spawnT"]) - dt
			var q: Array = f["queue"]
			if not q.is_empty() and float(f["spawnT"]) <= 0.0 and alive_count() < int(Fc["maxAlive"]):
				f["spawnT"] = 0.55
				var kind: String = q.pop_back()
				var sp := spawn_point(String(W["where"]))
				spawn_at(kind, int(sp["region"]), float(sp["x"]), float(sp["z"]))
			var left := q.size() + alive_count()
			f["banner"] = "ACTE I — VAGUE %d/%d · %s · %d restants" % [int(f["wave"]) + 1, (Fc["waves"] as Array).size(), String(W["name"]).to_upper(), left]
			if q.is_empty() and alive_count() <= 1:
				f["state"] = "breather"
				f["t"] = 0.0
				g.announce("VAGUE TERMINÉE", "Reprenez votre souffle…" if int(f["wave"]) + 1 < (Fc["waves"] as Array).size() else "Le Bourreau approche…")
				g.finale_sfx.emit("round_end", 1.0)
		"breather":
			var more: bool = int(f["wave"]) + 1 < (Fc["waves"] as Array).size()
			f["banner"] = ("Vague suivante dans %d s" % maxi(0, ceili(float(Fc["breather"]) - float(f["t"])))) if more else "Le sol tremble…"
			if float(f["t"]) > float(Fc["breather"]):
				if more:
					start_wave(int(f["wave"]) + 1)
				else:
					start_boss1()
		"boss1":
			var b := f["boss"] as BossSim
			f["banner"] = "ACTE II — LE BOURREAU"
			if b != null and f.get("bossAt", null) != null and float(f["t"]) > 2.0:
				var at: Vector2 = f["bossAt"]
				b.arrive(0, at.x, at.y, 0.0)
				f["bossAt"] = null
			if b != null and not b.dead and b.state == "chase":   # renforts épisodiques pendant le combat
				f["addT"] = float(f["addT"]) - dt
				if float(f["addT"]) <= 0.0 and alive_count() < 6:
					f["addT"] = 9.0
					var sp2 := spawn_point("crypt")
					spawn_at("normal", int(sp2["region"]), float(sp2["x"]), float(sp2["z"]))
		"ascent":
			f["banner"] = "ACTE III — L'ASCENSION · rejoignez la plateforme (tour sud)"
			f["addT"] = float(f["addT"]) - dt   # renforts le long de l'escalade : autour des étages où se trouvent les joueurs
			if float(f["addT"]) <= 0.0 and alive_count() < 12:
				f["addT"] = 2.4
				var ps := standing()
				if not ps.is_empty():
					var p: PlayerSim = ps[int(floor(_rand() * ps.size()))]
					var reg := p.tregion
					var sl: Variant = lv().regions[reg].get("spawns", null) if reg != 0 else null
					if sl != null and not (sl as Array).is_empty():
						var l: Array = sl
						var qq: Array = l[int(floor(_rand() * l.size()))]
						if Vector2(qq[0] - p.pos.x, qq[1] - p.pos.z).length() > 12.0:
							var kk := "armored" if _rand() < 0.3 else ("runner" if _rand() < 0.5 else "normal")
							spawn_at(kk, reg, qq[0], qq[1])
					elif reg == 0:
						var sp3 := spawn_point("portal")
						spawn_at("normal", 0, float(sp3["x"]), float(sp3["z"]))
			var on_plat := false   # un joueur debout sur la plateforme depuis 3 s : le Bourreau les attend
			for p2 in standing():
				if p2.tregion == int(R["PL"]):
					on_plat = true
			f["plT"] = float(f["plT"]) + dt if on_plat else 0.0
			if float(f["plT"]) > 3.0:
				start_boss2()
		"boss2":
			f["banner"] = "ACTE IV — SUR LE TOIT DE STRASBOURG"
			var b2 := f["boss"] as BossSim
			if b2 != null and not b2.dead and b2.state == "chase":
				f["addT"] = float(f["addT"]) - dt
				if float(f["addT"]) <= 0.0 and alive_count() < 8:
					f["addT"] = 8.0
					var l2: Array = lv().regions[R["PL"]]["spawns"]
					var q3: Array = l2[int(floor(_rand() * l2.size()))]
					var all_near := true
					for p3 in standing():
						if Vector2(q3[0] - p3.pos.x, q3[1] - p3.pos.z).length() >= 10.0:
							all_near = false
					if not all_near:
						spawn_at("armored" if _rand() < 0.4 else "normal", int(R["PL"]), q3[0], q3[1])
		"victory":
			f["banner"] = "LE BOURREAU EST TOMBÉ"
			if float(f["t"]) > 4.0:
				win()
		_:
			if String(f["state"]).begins_with("summit_"):
				_summit_step(dt)
	if f.has("boss") and f["boss"] != null:
		(f["boss"] as BossSim).ctx = self

# ------------------------------------------------------------------ le Bourreau
func start_boss1() -> void:   # il surgit au centre de la croisée (sol)
	var np := maxi(1, standing().size())
	f["state"] = "boss1"
	f["t"] = 0.0
	var hp := float(F()["bossHealth"]) * (1.0 + 0.7 * (np - 1))
	var at := Cathedral.P(37.0, 0.0)
	var b := BossSim.new(hp, self)
	b.id = g.next_zombie_id()
	b.rng = g.rng
	b.pos = Vector3(at.x, 0.0, at.y)
	b.state = "hidden"   # invisible jusqu'à ce qu'il surgisse
	b.bs = 9
	b.hidden_flag = true
	g.add_zombie(b)
	f["boss"] = b
	f["bossAt"] = at
	g.announce("ACTE II — LE BOURREAU", "Le sol de la croisée se fend…")

func start_boss2() -> void:   # il attend les joueurs sur la plateforme
	var b := f["boss"] as BossSim
	if b == null or b.dead:
		return
	f["state"] = "boss2"
	f["t"] = 0.0
	f["addT"] = 6.0
	var at := Cathedral.P(-33.0, 0.0)
	b.arrive(int(R["PL"]), at.x, at.y, float(lv().regions[R["PL"]]["y"]))
	g.announce("ACTE IV — SUR LE TOIT", "Le Bourreau vous attend au sommet de la tour…")

## Un zombie vient de mourir (hôte) : variantes et boss (finale.js onFinaleKill).
func on_kill(z: ZombieSim) -> void:
	if z.is_angel:   # 5000 points ; la rampe s'ouvre au bout de quelques secondes
		var A: Dictionary = S()["angel"]
		event("angel_death", {"x": z.pos.x, "y": z.pos.y, "z": z.pos.z})
		event("boss_mark", {"pid": null, "dur": 0})
		g.add_bonus_points(int(A["reward"]))
		g.announce("L'ANGE DU JUGEMENT", "Il retombe en poussière d'or : +%d points chacun" % int(A["reward"]))
		for o in g.zombies:
			if not o.dead and o != z and o.kind == "gargoyle":
				o.damage(1.0e9, false)
		if active() and state() == "summit_angel":
			f["state"] = "summit_angel_dead"
			f["t"] = 0.0
			f["boss"] = z
		return
	if z.mini:   # Maître Tanneur : explosion (le PHD Flopper protège), points, Max Munitions (Powerups.on_kill)
		var T: Dictionary = Config.at("tanner")
		event("burst", {"x": z.pos.x, "y": z.pos.y, "z": z.pos.z})
		event("boss_shock", {"x": z.pos.x, "y": z.pos.y, "z": z.pos.z})
		for p in standing():
			var d := Vector2(p.pos.x - z.pos.x, p.pos.z - z.pos.z).length()
			if d < float(T["explosion"]["radius"]) and absf(p.pos.y - z.pos.y) < 2.5:
				g.hurt_player_by(p, float(T["explosion"]["damage"]), 0.0, 0.0, "blast")
		g.add_bonus_points(int(T["reward"]["points"]))
		g.announce("MAÎTRE TANNEUR", "Terrassé : +%d points chacun · Max Munitions" % int(T["reward"]["points"]))
		return
	if z.is_boss:
		if active():
			f["state"] = "victory"
			f["t"] = 0.0
			f["boss"] = z
		for o in g.zombies:
			if not o.dead and o != z:
				o.damage(1.0e9, false)
		event("boss_shock", {"x": z.pos.x, "y": z.pos.y, "z": z.pos.z})
		g.announce("LE BOURREAU EST TOMBÉ", "La cathédrale se tait…")
		g.finale_sfx.emit("powerup", 1.0)

# ------------------------------------------------------------------ victoire, puis Acte V
func win() -> void:
	g.finale_done = true
	f = {"state": "summit_beam", "t": 0.0, "np": maxi(1, standing().size()), "banner": "La flèche s'illumine : montez allumer le Fanal d'Erwin", "boss": null, "fan": 0.0, "fh": 0, "fs": 0, "upT": 0.0, "said": false}
	for z in g.zombies:
		if not z.dead:
			z.damage(1.0e9, false)
	var p: PlayerSim = g.player
	if p.downed or p.dead:
		p.revive(g.time)
	g.to_spawn_zero()
	g.finale_sfx.emit("powerup", 1.0)
	g.add_bonus_points(int(F()["boss"]["reward"]["points"]))
	for w: WeaponState in g.arms.inventory:
		w.refill()
	g.arms.has_axe = true   # la Hache du Bourreau remplace le couteau (dégâts x3, touche deux zombies)
	g.victory_screen.emit("VICTOIRE !", "Le Bourreau est vaincu : vous avez sauvé la cathédrale.\nManche %d  ·  %d zombies tués  ·  +%d points  ·  munitions pleines\nVous ramassez la Hache du Bourreau : elle remplace votre couteau (dégâts x%d, touche deux zombies).\nLa flèche de la cathédrale s'illumine : montez allumer le Fanal d'Erwin." % [g.round_number, g.kills, int(F()["boss"]["reward"]["points"]), int(Config.at("knife.axe.dmgMult"))])
	g.boss_event.emit("summit_show", {})

# ------------------------------------------------------------------ Acte V
func region_of(p: PlayerSim) -> int:
	return p.region

func on_tower(p: PlayerSim) -> bool:
	var r := region_of(p)
	return r == int(R["TOP"]) or r == int(R["RAMP"]) or r == int(R["TIP"])

func spawn_terrace_gargoyle(ps: Array[PlayerSim]) -> ZombieSim:
	var G: Dictionary = S()["gargoyles"]
	for _k in 14:
		var q := Cathedral.tower_pt(8.55, _rand() * 360.0)
		if not lv().in_region(int(R["TOP"]), q.x, q.y) or not free_at(int(R["TOP"]), q.x, q.y):
			continue
		var near := false
		for p in ps:
			if region_of(p) == int(R["TOP"]) and Vector2(p.pos.x - q.x, p.pos.z - q.y).length() < float(G["minDist"]):
				near = true
		if near:
			continue
		var zb := spawn_at("gargoyle", int(R["TOP"]), q.x, q.y)
		g.finale_sfx.emit("rumble", 0.3)
		return zb
	return null

func spawn_ramp_gargoyle(ps: Array[PlayerSim]) -> ZombieSim:
	var rr: Dictionary = lv().regions[R["RAMP"]]
	if rr.get("link", null) == null:
		return null
	var link: Dictionary = lv().links[int(rr["link"])]
	var W: Dictionary = S()["ramp"]["gargoyles"]
	var smax := -1.0
	for p in ps:
		if region_of(p) == int(R["RAMP"]):
			smax = maxf(smax, lv().project(link, p.pos.x, p.pos.z, p.pos.y))
		elif region_of(p) == int(R["TIP"]):
			smax = maxf(smax, float(link["length"]))
	if smax < 0.0:
		return null
	var s0 := maxf(0.5, minf(float(link["length"]) - 3.0, smax - float(W["behind"]) - _rand() * 5.0))
	var o := {}
	lv().point_on(link, s0, o)
	var zb := spawn_at("gargoyle", int(R["TOP"]), o["x"], o["z"], o["y"])
	zb.link = {"link": link, "dir": 1, "s": s0}
	return zb

func fanal_pos() -> Vector3:
	var q := Cathedral.fanal_pos()
	return Vector3(q.x, Cathedral.TOWER_TIP, q.y)

func near_fanal(p: PlayerSim, extra := 0.0) -> bool:
	var fp := fanal_pos()
	return region_of(p) == int(R["TIP"]) and Vector2(p.pos.x - fp.x, p.pos.z - fp.z).length() < float(S()["fanal"]["range"]) + extra and absf(p.pos.y - fp.y) < 3.0

func spawn_angel() -> AngelSim:   # l'Ange arrive du ciel et se met à tourner autour de la flèche
	var A: Dictionary = S()["angel"]
	var np := maxi(1, standing().size())
	var hp := roundf(float(A["health"]) * (1.0 + float(A["perPlayer"]) * (np - 1)))
	var axis := Cathedral.tower_axis()
	var az := deg_to_rad(200.0)
	var r := float(A["radius"]) + 10.0
	var a := AngelSim.new(hp, self)
	a.id = g.next_zombie_id()
	a.rng = g.rng
	a.center = axis
	a.region = int(R["TOP"])
	a.az = 200.0
	a.pos = Vector3(axis.x + cos(az) * r, float(A["height"]) + 22.0, axis.y + sin(az) * r)
	a._set_state("arrive")
	g.add_zombie(a)
	f["boss"] = a
	g.finale_sfx.emit("bell", 1.0)
	return a

func _summit_step(dt: float) -> void:
	var Sc := S()
	var ps := standing()
	f["fh"] = 0
	f["fs"] = ps.size()
	match String(f["state"]):
		"summit_beam":
			f["banner"] = "La flèche s'illumine : montez allumer le Fanal d'Erwin"
			if not f.get("said", false) and float(f["t"]) > 1.5 and g.playing:
				f["said"] = true
				g.announce("ACTE V — L'AUBE", "La flèche s'illumine : montez allumer le Fanal d'Erwin")
			var up := false
			for p in ps:
				if on_tower(p):
					up = true
			f["upT"] = float(f.get("upT", 0.0)) + dt if up else 0.0
			if float(f["upT"]) > 1.2:
				var np := maxi(1, ps.size())
				var G: Dictionary = Sc["gargoyles"]
				f["state"] = "summit_garg"
				f["t"] = 0.0
				f["gQueue"] = roundi(float(G["count"]) + float(G["perPlayer"]) * (np - 1))
				f["gTotal"] = f["gQueue"]
				f["gT"] = 1.0
				g.announce("LES GARGOUILLES", "La pierre s'éveille sur les parapets !")
				g.finale_sfx.emit("round_start", 1.0)
		"summit_garg":
			var G2: Dictionary = Sc["gargoyles"]
			f["gT"] = float(f["gT"]) - dt
			if int(f["gQueue"]) > 0 and float(f["gT"]) <= 0.0 and garg_alive() < int(G2["maxAlive"]):
				f["gT"] = G2["interval"]
				if spawn_terrace_gargoyle(ps) != null:
					f["gQueue"] = int(f["gQueue"]) - 1
			var n := int(f["gQueue"]) + garg_alive()
			f["banner"] = "ACTE V — LES GARGOUILLES · %d restante%s" % [n, "s" if n > 1 else ""]
			if int(f["gQueue"]) == 0 and garg_alive() == 0:
				f["state"] = "summit_angel"
				f["t"] = 0.0
				g.announce("L'ANGE DU JUGEMENT", "Un chant s'élève autour de la flèche… visez la trompette !")
				spawn_angel()
		"summit_angel":
			f["banner"] = "ACTE V — SUR LA FLÈCHE"
		"summit_angel_dead":
			f["banner"] = "L'Ange est tombé"
			if float(f["t"]) > 3.2:
				f["state"] = "summit_ramp"
				f["t"] = 0.0
				f["gustT"] = 2.5
				f["rT"] = 3.0
				f["boss"] = null
				g.announce("LA RAMPE", "Des rafales balaient la flèche : accrochez-vous et grimpez jusqu'à la pointe !")
		"summit_ramp", "summit_fanal":
			var ramp: bool = f["state"] == "summit_ramp"
			f["banner"] = "ACTE V — LA RAMPE · gagnez la pointe de la flèche" if ramp else "ACTE V — LE FANAL · %d %%" % roundi(float(f.get("fan", 0.0)) * 100.0)
			f["gustT"] = float(f.get("gustT", Sc["ramp"]["interval"])) - dt   # rafales : toutes les `interval` s tant qu'un joueur est sur la rampe
			if float(f["gustT"]) <= 0.0:
				var on_ramp := false
				for p in ps:
					if region_of(p) == int(R["RAMP"]):
						on_ramp = true
				if on_ramp:
					f["gustT"] = Sc["ramp"]["interval"]
					var a := _rand() * TAU
					var gd := {"dx": floorf(cos(a) * 100.0 + 0.5) / 100.0, "dz": floorf(sin(a) * 100.0 + 0.5) / 100.0, "tel": 0.8, "dur": Sc["ramp"]["duration"]}
					event("summit_gust", gd)
					gusts.append({"dx": gd["dx"], "dz": gd["dz"], "tel": gd["tel"], "dur": gd["dur"], "t": 0.0, "done": false})
				else:
					f["gustT"] = 0.5
			f["rT"] = float(f.get("rT", Sc["ramp"]["gargoyles"]["every"])) - dt   # gargouilles qui montent
			if float(f["rT"]) <= 0.0:
				f["rT"] = Sc["ramp"]["gargoyles"]["every"]
				var up2 := false
				for p in ps:
					if region_of(p) == int(R["RAMP"]) or region_of(p) == int(R["TIP"]):
						up2 = true
				if up2:
					var i := 0
					while i < int(Sc["ramp"]["gargoyles"]["count"]) and garg_alive() < int(Sc["ramp"]["gargoyles"]["maxAlive"]):
						spawn_ramp_gargoyle(ps)
						i += 1
			if ramp:
				for p in ps:
					if region_of(p) == int(R["TIP"]):
						f["state"] = "summit_fanal"
						f["t"] = 0.0
						f["fan"] = 0.0
						g.announce("LE FANAL D'ERWIN", "Tous ensemble : maintenez la touche d'interaction près du Fanal !")
						break
			else:
				var Fn: Dictionary = Sc["fanal"]
				var hold := 0
				for p in ps:
					if p == g.player and fan_hold:
						hold += 1
				f["fh"] = hold
				var rate := (float(hold) / maxf(1.0, ps.size())) / float(Fn["hold"]) if hold > 0 else -float(Fn["decay"]) / float(Fn["hold"])
				f["fan"] = clampf(float(f.get("fan", 0.0)) + rate * dt, 0.0, 1.0)
				if float(f["fan"]) >= 1.0:
					dawn_begin(0.0)
		"summit_dawn":
			f["banner"] = "L'AUBE"
			if float(f["t"]) > float(Sc["dawn"]["orbit"]) + 2.0:
				end_summit()

## Rafales : l'annonce, puis le joueur local sur la rampe est poussé `dur` s (la collision le retient).
func _update_gusts(dt: float) -> void:
	for i in range(gusts.size() - 1, -1, -1):
		var gu: Dictionary = gusts[i]
		var p: PlayerSim = g.player
		gu["t"] = float(gu["t"]) + dt
		if float(gu["t"]) < float(gu["tel"]):
			continue
		if not gu["done"]:
			gu["done"] = true
			if region_of(p) == int(R["RAMP"]) and not p.downed and not p.dead and not p.attached:
				var ax := Cathedral.tower_axis()
				var ox := p.pos.x - ax.x
				var oz := p.pos.z - ax.y
				var ol := sqrt(ox * ox + oz * oz)
				if ol == 0.0:
					ol = 1.0
				ox /= ol
				oz /= ol
				var W: Dictionary = S()["ramp"]
				var k := float(W["outward"])
				var vx := float(gu["dx"]) * (1.0 - k) + ox * k
				var vz := float(gu["dz"]) * (1.0 - k) + oz * k
				var vl := sqrt(vx * vx + vz * vz)
				if vl == 0.0:
					vl = 1.0
				p.gust_by(vx / vl * float(W["push"]), vz / vl * float(W["push"]), float(W["duration"]))
				g.shake = maxf(g.shake, 0.25)
		if float(gu["t"]) > float(gu["tel"]) + float(gu["dur"]):
			gusts.remove_at(i)

func _update_fanal() -> void:
	var p: PlayerSim = g.player
	var can: bool = summit_state() == "summit_fanal" and g.playing and not p.downed and not p.dead and not p.attached and not cam_lock and near_fanal(p)
	fan_near = can
	fan_hold = can and g.fanal_input

func fanal_prompt() -> String:
	if not fan_near:
		return ""
	return "E Maintenir : allumer le Fanal d'Erwin%s" % ((" (%d/%d tiennent le Fanal)" % [int(f.get("fh", 0)), int(f.get("fs", 0))]) if int(f.get("fs", 0)) > 1 else "")

## Jauge du Fanal pour le HUD : -1 hors de l'étape du Fanal.
func fanal_frac() -> float:
	return float(f.get("fan", 0.0)) if summit_state() == "summit_fanal" else -1.0

func fanal_label() -> String:
	return "LE FANAL D'ERWIN · %d/%d joueur%s" % [int(f.get("fh", 0)), int(f.get("fs", 0)), "s" if int(f.get("fs", 0)) > 1 else ""]

# ------------------------------------------------------------------ L'Aube
## Le ciel passe au jour en `dawn.sky` s, les zombies tombent en cendres, la Bénédiction de l'Aube donne les sept atouts (gardés à terre) et rend les
## portes gratuites, vue orbitale de `dawn.orbit` s, puis l'écran « STRASBOURG LIBÉRÉE » (finale.js dawnBegin / dawnRun).
func dawn_begin(k: float) -> void:
	if dawn_on:
		return
	if not f.is_empty():
		f["state"] = "summit_dawn"
		f["t"] = 0.0
		f["fan"] = 1.0
		f["boss"] = null
	dawn_run(k)

func dawn_run(k: float) -> void:
	if dawn_on:
		return
	dawn_on = true
	dawn_t0 = g.time - k
	g.eternal = true   # Nuit éternelle dès la manche suivante ; Bénédiction ; portes gratuites
	g.blessed = true
	g.free_doors = true
	var p: PlayerSim = g.player
	for z in g.zombies:
		if not z.dead:
			z.become_ash()
	if p.downed or p.dead:
		p.revive(g.time)
	for id: String in Config.at("perks"):
		if not g.arms.perks.get(id, false):
			g.add_perk(id)
	p.health = maxf(p.health, p.max_health * 0.6)
	g.finale_sfx.emit("powerup", 1.0)
	g.finale_sfx.emit("bell_x4", 1.0)
	g.announce("L'AUBE", "Le Fanal d'Erwin est allumé : les ténèbres reculent…%s" % ("" if k > 0.0 else " (Échap : passer la vue)"))
	g.boss_event.emit("dawn", {"k": k})
	sky_phase = "dawn"
	sky_t = k
	if k <= 0.0:
		start_orbit()

func start_orbit() -> void:
	var p: PlayerSim = g.player
	var ax := Cathedral.tower_axis()
	orbit_on = true
	orbit_t = 0.0
	orbit_a0 = atan2(p.pos.z - ax.y, p.pos.x - ax.x) + PI * 0.35
	cam_lock = true

func end_orbit() -> void:
	if not orbit_on:
		return
	orbit_on = false
	cam_lock = false
	show_liberated()

## Position et visée de la caméra pendant la vue orbitale : { pos, look } (summit.js cameraStep).
func orbit_pose() -> Dictionary:
	var D: Dictionary = S()["dawn"]
	var u := minf(1.0, orbit_t / float(D["orbit"]))
	var e := u * u * (3.0 - 2.0 * u)
	var a := orbit_a0 + e * PI * 1.5
	var rr: Array = D["orbitRadius"]
	var hh: Array = D["orbitHeight"]
	var r: float = rr[0] + (rr[1] - rr[0]) * e
	var y: float = hh[0] + (hh[1] - hh[0]) * e
	var ax := Cathedral.tower_axis()
	return {"pos": Vector3(ax.x + cos(a) * r, y, ax.y + sin(a) * r), "look": Vector3(ax.x, Cathedral.TOWER_TIP + 6.0 - 4.0 * e, ax.y)}

func _orbit_step(dt: float) -> void:
	if not orbit_on:
		return
	orbit_t += dt
	if orbit_t >= float(S()["dawn"]["orbit"]):
		end_orbit()

## Ciel : nuit (k = 0) -> aube (k de 0 à 1 en dawn.sky s) -> jour (eternal.day s) -> crépuscule (eternal.dusk s) -> nuit.
func _sky_step(dt: float) -> void:
	if sky_phase == "night" and sky_k == 0.0:
		return
	var D: Dictionary = S()["dawn"]
	var E: Dictionary = S()["eternal"]
	sky_t += dt
	match sky_phase:
		"dawn":
			sky_k = minf(1.0, sky_t / float(D["sky"]))
			if sky_t >= float(D["sky"]):
				sky_phase = "day"
				sky_t = 0.0
		"day":
			sky_k = 1.0
			if sky_t >= float(E["day"]):
				sky_phase = "dusk"
				sky_t = 0.0
				g.announce("LA NUIT RETOMBE", "Nuit éternelle : les zombies ont 30 % de vie en plus")
		"dusk":
			sky_k = maxf(0.0, 1.0 - sky_t / float(E["dusk"]))
			if sky_t >= float(E["dusk"]):
				sky_phase = "night"
				sky_k = 0.0

## Fin de l'Acte V : plus de machine à états, les manches reprennent en Nuit éternelle.
func end_summit() -> void:
	f = {}
	g.to_spawn_zero()
	g.director.intermission = 10.0
	g.announce("NUIT ÉTERNELLE", "La nuit retombera… et les zombies seront plus coriaces dès la manche suivante")

func show_liberated() -> void:
	var t := roundi(g.time)
	var trophies := FinaleRules.record_trophy(g.trophy_path, {"round": g.round_number, "kills": g.kills, "time": t, "players": 1})
	g.trophy = trophies
	g.liberated_screen.emit("STRASBOURG LIBÉRÉE", "Le Fanal d'Erwin brûle au sommet de la cathédrale : l'aube se lève sur la ville.\nManche %d  ·  %d zombies tués  ·  %d points  ·  %d quartiers ouverts  ·  1 joueur  ·  %d min %02d s\nBénédiction de l'Aube : tous les atouts (%d), même à terre, sans limite  ·  toutes les portes sont gratuites.%s\nLa nuit reviendra : la Nuit éternelle commence, les zombies auront 30 %% de vie en plus." % [g.round_number, g.kills, g.points, open_zones(), t / 60, t % 60, (Config.at("perks") as Dictionary).size(), ("\nTrophée « Strasbourg libérée » n° %d enregistré sur cet appareil." % trophies) if trophies > 0 else ""])

# ------------------------------------------------------------------ Maître Tanneur (manches 15, 20, 25…)
func maybe_spawn_tanner() -> bool:
	var T: Dictionary = Config.at("tanner")
	var r: int = g.round_number
	if T.is_empty() or r < int(T["fromRound"]) or (r - int(T["fromRound"])) % int(T["every"]) != 0 or active():
		return false
	for z in g.zombies:
		if z.mini and not z.dead:
			return false
	var open: Array[int] = []
	for n: String in T["zones"]:
		var i: int = g.world.zone_names.find(n)
		if i >= 0 and g.world.is_zone_open(i):
			open.append(i)
	if open.is_empty():
		return false
	var zi: int = open[int(floor(_rand() * open.size()))]
	var zc: Dictionary = g.world.objects["zones"][zi]["center"]
	var gp := Vector3.INF
	for k in 6:
		if gp != Vector3.INF:
			break
		gp = g.world.pick_ground(float(zc["x"]), float(zc["z"]), 0.0, 25.0 + k * 10.0, g.rng)
	var x: float = gp.x if gp != Vector3.INF else float(zc["x"])
	var zz: float = gp.z if gp != Vector3.INF else float(zc["z"])
	var hp := roundf(float(T["healthMult"]) * g.zombie_health_at(r))
	var tn := TannerSim.new(hp, self)
	tn.id = g.next_zombie_id()
	tn.rng = g.rng
	tn.pos = Vector3(x, 0.0, zz)
	g.add_zombie(tn)
	g.announce("MAÎTRE TANNEUR", "Il rôde dans %s…" % g.world.zone_names[zi])
	return true

func _update_mini_bar() -> void:
	mini_bar = {}
	for z in g.zombies:
		if z.mini and not z.dead and not z.is_angel:
			mini_bar = {"hp": maxf(0.0, roundf(z.health)), "max": z.max_health, "phase": 1, "inv": false, "name": (z as BossSim).boss_name, "thresholds": []}
			return
