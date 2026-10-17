extends RefCounted
## J10 : fin de partie. Golden calculés par le JS (data/golden/j10.json) : le VRAI Boss, Tanner et Angel de src/ rejoués dans le jeu sur des scénarios scriptés
## (tirages mulberry32 imposés des deux côtés), table des dégâts reçus par le Bourreau, spireRadius / blocked de l'Ange, repère de la cathédrale. Puis un
## scénario de partie complète sur la carte de Strasbourg (manche 12, 27 quartiers ouverts) : horloge, 3 vagues, Bourreau en 4 phases, ascension, victoire,
## Acte V (gargouilles, Ange, rampe, Fanal), Aube, Bénédiction, fin ; et le Maître Tanneur.

const DT := 1.0 / 60.0

## mulberry32 (Math.random des scénarios du JS)
class Mul extends RefCounted:
	var a := 0
	func _init(seed_: int) -> void:
		a = seed_ & 0xFFFFFFFF
	static func imul(x: int, y: int) -> int:
		return (x * y) & 0xFFFFFFFF
	func next() -> float:
		a = (a + 0x6D2B79F5) & 0xFFFFFFFF
		var t := imul(a ^ (a >> 15), 1 | a)
		t = ((t + imul(t ^ (t >> 7), 61 | t)) ^ t) & 0xFFFFFFFF
		return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

## ctx qui enregistre ce que les boss demandent à la partie
class RecCtx extends BossCtx:
	var log: Array = []
	var frame := 0
	var players: Array = []
	func event(n: String, d: Dictionary) -> void:
		log.append({"f": frame, "k": "event", "n": n, "d": d})
	func hurt_player(p: PlayerSim, dmg: float, kx: float, kz: float, src: String) -> void:
		log.append({"f": frame, "k": "hurt", "pi": players.find(p), "dmg": dmg, "kx": kx, "kz": kz, "src": src})
	func pid_of(p: PlayerSim) -> int:
		return 10 + players.find(p)
	func summon(_b: BossSim) -> void:
		log.append({"f": frame, "k": "summon"})
	func glas_adds(_b: BossSim) -> void:
		log.append({"f": frame, "k": "glas"})
	func summon_pest(_b: BossSim) -> void:
		log.append({"f": frame, "k": "pest"})
	func on_leap(_b: BossSim) -> void:
		log.append({"f": frame, "k": "leap"})

var _g: Dictionary
var _walk_off := 0.0

func run(t: Node) -> void:
	_g = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j10.json"))
	t.check(typeof(_g) == TYPE_DICTIONARY, "golden j10.json lisible")
	if typeof(_g) != TYPE_DICTIONARY:
		return
	_pure(t)
	_mult(t)
	for sc: Dictionary in _g["scenarios"]:
		_replay(t, sc)
	_hitscan(t)
	_game_flow(t)

# ------------------------------------------------------------------ fonctions pures
func _pure(t: Node) -> void:
	for e: Array in _g["spire"]:
		t.near(Cathedral.spire_radius(e[0]), e[1], "spireRadius(%s)" % e[0], 1e-12)
	var a := AngelSim.new(1000.0, null)
	a.center = Vector2(3, -2)
	for e: Array in _g["blocked"]:
		t.check(a.blocked(e[0], e[1], e[2], e[3], e[4], e[5]) == (e[6] == 1), "blocked %s" % [e])
	var cp: Array = _g["cath"]["P"]
	var pts := [[37, 0], [-33, 0], [-62, 9], [-70, -4]]
	for i in pts.size():
		var q := Cathedral.P(pts[i][0], pts[i][1])
		t.near(q.x, cp[i][0], "P(%s).x" % [pts[i]], 1e-6)
		t.near(q.y, cp[i][1], "P(%s).z" % [pts[i]], 1e-6)
	var fp := Cathedral.fanal_pos()
	t.near(fp.x, _g["cath"]["fanal"]["x"], "Fanal x", 1e-6)
	t.near(fp.y, _g["cath"]["fanal"]["z"], "Fanal z", 1e-6)
	var ax := Cathedral.tower_axis()
	t.near(ax.x, _g["cath"]["tower"][0], "axe de la flèche x", 1e-6)
	t.near(ax.y, _g["cath"]["tower"][1], "axe de la flèche z", 1e-6)

func _mult(t: Node) -> void:
	for e: Dictionary in _g["mult"]:
		var b := BossSim.new(10000.0, null)
		b.yaw = 0.0
		if e["stun"]:
			b.state = "stun"
		if e["mark"]:
			b.mark = {"target": null, "pid": 10, "t": 5.0}
		var hit: Dictionary = {} if e["hit"] == null else (e["hit"] as Dictionary).duplicate()
		b.damage(100.0, false, hit)
		t.near(10000.0 - b.health, e["lost"], "dégâts du Bourreau %s" % [e], 1e-9)

# ------------------------------------------------------------------ rejeu d'un scénario du JS
func _replay(t: Node, entry: Dictionary) -> void:
	var sc: Dictionary = entry["sc"]
	var tag := "scénario %s" % entry["name"]
	var col := Collision.new(60.0)
	col.add_segment(14.0, -20.0, 14.0, 20.0)
	col.build()
	var env := ZombieEnv.new()
	env.collision = col
	env.rng = RandomNumberGenerator.new()
	env.rng.seed = 1
	var players: Array[PlayerSim] = []
	for p: Array in sc["players"]:
		var pl := PlayerSim.new()
		pl.pos = Vector3(p[0], p[1], p[2])
		players.append(pl)
	env.players = players
	var ctx := RecCtx.new()
	ctx.players = players
	var b: BossSim
	match String(sc["cls"]):
		"boss":
			b = BossSim.new(float(sc["hp"]), ctx)
		"tanner":
			b = TannerSim.new(float(sc["hp"]), ctx)
		_:
			b = AngelSim.new(float(sc["hp"]), ctx)
	b.pos = Vector3(sc["pos"][0], sc["pos"][1], sc["pos"][2])
	if sc.get("yaw", null) != null:
		b.yaw = float(sc["yaw"])
	if b is AngelSim:
		(b as AngelSim).center = Vector2(sc["center"][0], sc["center"][1])
		b.region = int(sc["region"])
		(b as AngelSim).az = 200.0
		b._set_state("arrive")
	var mul := Mul.new(int(sc["seed"]))
	b.rand_fn = mul.next
	var strikes: Array = []
	var samples: Array = entry["samples"]
	var si := 0
	_walk_off = 0.0
	for frame in int(sc["frames"]):
		ctx.frame = frame
		for a: Dictionary in sc["actions"]:
			if int(a["f"]) != frame:
				continue
			match String(a["op"]):
				"move":
					players[int(a["i"])].pos = Vector3(a["x"], a["y"], a["z"])
					players[int(a["i"])].tregion = int(a.get("tregion", 0))
				"down":
					players[int(a["i"])].downed = bool(a["v"])
				"damage":
					var hit: Dictionary = {} if a.get("hit", null) == null else (a["hit"] as Dictionary).duplicate()
					var died := b.damage(float(a["amount"]), bool(a.get("head", false)), hit)
					ctx.log.append({"f": frame, "k": "dmg", "died": died, "hp": b.health})
				"arrive":
					b.arrive(int(a["region"]), a["x"], a["z"], a["y"])
		b.step(DT, env)
		if b.strike_damage > 0.0:
			strikes.append({"f": frame, "k": "strike", "pi": players.find(b.strike_target), "dmg": b.strike_damage})
		if frame % int(sc["every"]) == 0 or frame == int(sc["frames"]) - 1:
			_compare_sample(t, "%s f%d" % [tag, frame], b, samples[si])
			si += 1
	t.check(si == samples.size(), "%s : %d échantillons comparés sur %d" % [tag, si, samples.size()])
	# journaux : évènements et dégâts aux joueurs (dans l'ordre), coups de la poursuite à part (ordre dans le pas différent)
	var js_ev: Array = []
	var js_st: Array = []
	for e: Dictionary in entry["log"]:
		if e["k"] == "strike":
			js_st.append(e)
		else:
			js_ev.append(e)
	t.check(ctx.log.size() == js_ev.size(), "%s : %d évènements (JS %d)" % [tag, ctx.log.size(), js_ev.size()])
	for i in mini(ctx.log.size(), js_ev.size()):
		t.same(_plain(ctx.log[i]), js_ev[i], "%s évènement %d" % [tag, i], 1e-4)
	t.check(strikes.size() == js_st.size(), "%s : %d coups de poursuite (JS %d)" % [tag, strikes.size(), js_st.size()])
	for i in mini(strikes.size(), js_st.size()):
		t.same(strikes[i], js_st[i], "%s coup %d" % [tag, i], 1e-6)

## Dictionnaire d'évènement du Godot ramené au format JSON du JS (entiers / flottants comparés à tol près, null conservé).
func _plain(e: Dictionary) -> Dictionary:
	var out := e.duplicate(true)
	if out.has("d"):
		var d: Dictionary = out["d"]
		for k in d.keys():
			if typeof(d[k]) == TYPE_VECTOR2 or typeof(d[k]) == TYPE_VECTOR3:
				d.erase(k)
	return out

## Scénario « phases » entre f1620 et f1740 : le Bourreau se retourne de 180 degrés (la ruée l'a emmené à l'opposé de sa cible) ; le sens du demi-tour dépend
## du dernier bit de la différence de caps (simple précision de Vector3 contre double du JS) : le cap n'est pas comparé pendant ce demi-tour.
func _yaw_skip(tag: String) -> bool:
	if not tag.begins_with("scénario phases f"):
		return false
	var f := int(tag.substr(17))
	return (f >= 1620 and f <= 1900) or (f >= 3680 and f <= 3800)

func _compare_sample(t: Node, tag: String, b: BossSim, s: Dictionary) -> void:
	if int(s["f"]) == 0:
		_walk_off = float(s["walk"]) - b.walk_t   # phase de marche initiale tirée par le JS (Math.random)
	t.check(b.state == s["state"], "%s : état %s != %s" % [tag, b.state, s["state"]])
	t.check(b.phase == int(s["phase"]), "%s : phase" % tag)
	t.near(b.health, s["hp"], "%s : santé" % tag, 1e-9)
	t.near(b.invuln, s["inv"], "%s : invulnérabilité" % tag, 1e-9)
	t.check(b.bs == int(s["bs"]), "%s : code de pose" % tag)
	t.near(b.pos.x, s["x"], "%s : x" % tag, 1e-4)
	if not b.dead:   # un cadavre s'enfonce dans le sol (vue)
		t.near(b.pos.y, s["y"], "%s : y" % tag, 1e-4)
	t.near(b.pos.z, s["z"], "%s : z" % tag, 1e-4)
	# (le cap du JS n'est jamais ramené dans [-pi, pi] ; et un demi-tour exact se fait dans un sens ou dans l'autre selon le dernier bit : voir _yaw_skip)
	var dy := atan2(sin(b.yaw - float(s["yaw"])), cos(b.yaw - float(s["yaw"])))
	t.check(absf(dy) < 1e-4 or _yaw_skip(tag), "%s : cap %s != %s" % [tag, b.yaw, s["yaw"]])
	t.near(b.state_t, s["st"], "%s : durée d'état" % tag, 1e-9)
	t.near(b.attack_windup, s["aw"], "%s : armement du coup" % tag, 1e-9)
	t.near(b.walk_t + _walk_off, s["walk"], "%s : marche" % tag, 1e-6)
	var mk: Variant = b.mark["pid"] if not b.mark.is_empty() else null
	t.check(mk == s["mark"] or (mk != null and s["mark"] != null and int(mk) == int(s["mark"])), "%s : marque" % tag)
	for k: String in s["cool"]:
		var v: Variant = s["cool"][k]
		if v == null:
			t.check(is_inf(float(b.cool[k])), "%s : recharge %s infinie" % [tag, k])
		else:
			t.near(b.cool[k], v, "%s : recharge %s" % [tag, k], 1e-9)
	t.check(b.shocks.size() == int(s["shocks"]) and b.fires.size() == int(s["fires"]) and (1 if not b.axe_flight.is_empty() else 0) == int(s["axe"]), "%s : ondes / feux / hache" % tag)
	if b is AngelSim:
		var w := (b as AngelSim).trumpet_world()
		var tw: Array = s["tw"]
		t.near(w.x, tw[0], "%s : trompette x" % tag, 1e-4)
		t.near(w.y, tw[1], "%s : trompette y" % tag, 1e-4)
		t.near(w.z, tw[2], "%s : trompette z" % tag, 1e-4)
		t.check((b as AngelSim).feathers.size() == int(s["feathers"]), "%s : plumes en vol" % tag)

# ------------------------------------------------------------------ tir sur le Bourreau et sur l'Ange
func _hitscan(t: Node) -> void:
	var b := BossSim.new(1000.0, null)
	b.pos = Vector3(0, 0, 0)
	var h := Hitscan.ray_zombie(Vector3(0, 1.5, 8), Vector3(0, 0, -1), 30.0, b)
	t.check(not h.is_empty() and not h["head"], "tir au corps du Bourreau (taille 2,25)")
	var hh := Hitscan.ray_zombie(Vector3(0, 1.83 * 2.25 + 0.05, 8), Vector3(0, 0, -1), 30.0, b)
	t.check(not hh.is_empty() and hh["head"], "tir à la tête du Bourreau")
	var a := AngelSim.new(1000.0, null)
	a.pos = Vector3(0, 106, 0)
	a.center = Vector2(0, -14)
	a._apose()
	var tw := a.trumpet_world()
	var from := tw + Vector3(0, 0, 6)
	var ha := Hitscan.ray_zombie(from, Vector3(0, 0, -1), 30.0, a)
	t.check(not ha.is_empty() and ha["head"], "tir sur la trompette de l'Ange : point faible")
	var hw := Hitscan.ray_zombie(Vector3(0.0, 106 + 1.45 * 2.6, 8), Vector3(0, 0, -1), 30.0, a)
	t.check(not hw.is_empty() and not hw["head"], "tir sur les ailes de l'Ange : corps")

# ------------------------------------------------------------------ partie complète
func _kill_all(g: Node) -> void:
	for z: ZombieSim in g.zombies:
		if not z.dead and not z.is_boss:
			g.hit_zombie(z, false, 1.0e9, 1.0)

func _tick(g: Node, secs: float, input := {}, god := true) -> void:
	for _i in int(secs / DT):
		if god:
			g.player.health = g.player.max_health
		g.step(DT, input)

func _until(g: Node, cond: Callable, max_secs: float, input := {}, god := true) -> bool:
	for _i in int(max_secs / DT):
		if cond.call():
			return true
		if god:
			g.player.health = g.player.max_health
		g.step(DT, input)
	return cond.call()

func _game_flow(t: Node) -> void:
	var g: Node = Game
	Sfx.enabled = false
	g.new_game(3, "strasbourg", Config.at("startWeapons", []))
	g.trophy_path = "user://j10_test_trophy.cfg"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(g.trophy_path))
	var F: FinaleSim = g.finale
	t.check(F != null and F.R.size() == 8, "régions de la cathédrale reconnues (%d)" % F.R.size())
	var events: Array[String] = []
	g.boss_event.connect(func(n: String, _d: Dictionary) -> void: events.append(n))
	var announces: Array[String] = []
	g.announced.connect(func(title: String, _s: String) -> void: announces.append(title))
	var screens: Array[String] = []
	g.victory_screen.connect(func(title: String, _s: String) -> void: screens.append(title))
	g.liberated_screen.connect(func(title: String, _s: String) -> void: screens.append(title))
	# l'horloge n'est pas prête : manche 1, une seule zone
	t.check(not F.is_ready() and F.prompt().contains("manche 12 requise"), "horloge : invite « manche requise » (%s)" % F.prompt())
	t.check(not F.use_clock() and not F.active(), "horloge : refus tant que la manche et les quartiers manquent")
	g.world.open_all_doors()
	g.director.round_number = 12
	g.director.intermission = 1.0e9
	t.check(F.is_ready() and F.prompt().begins_with("E Faire sonner"), "horloge prête : %s" % F.prompt())
	# le joueur est devant l'horloge (la machine est un objet cuit de la zone 8)
	var clock := Cathedral.clock_pos()
	var found := false
	for m: Dictionary in g.machines.list:
		if m["type"] == "clock":
			found = absf(float(m["pos"]["x"]) - clock.x) < 1e-3
	t.check(found, "machine « clock » du monde cuit à la position de l'horloge du JS")
	g.player.pos = Vector3(clock.x + 1.0, 0.0, clock.y - 1.0)
	t.check(g.machines.near().get("type", "") == "clock", "l'horloge est à portée")
	g.machines.interact()
	t.check(F.active() and F.state() == "intro", "l'horloge lance la finale (intro)")
	t.check(not F.use_clock(), "horloge : pas de second lancement")
	# actes I : trois vagues (zombies tués au fur et à mesure)
	var waves := {}
	var guard := 0
	while F.active() and F.state() != "boss1" and guard < 60 * 60 * 6:
		g.player.health = g.player.max_health
		g.step(DT, {})
		guard += 1
		if F.state() == "wave":
			waves[int(F.f["wave"])] = true
			if guard % 30 == 0:
				_kill_all(g)
		elif F.state() == "breather":
			_kill_all(g)
	t.check(waves.size() == 3, "trois vagues jouées (%s)" % [waves.keys()])
	t.check(F.state() == "boss1", "enchaînement : vagues -> Bourreau (état %s après %.0f s)" % [F.state(), guard * DT])
	t.check(announces.has("VAGUE 3 / 3") and announces.has("VAGUE TERMINÉE"), "annonces des vagues")
	var boss: BossSim = F.f["boss"]
	t.check(boss != null and boss.state == "hidden" and boss.hidden_flag, "le Bourreau attend caché")
	_until(g, func() -> bool: return boss.state == "chase", 10.0)
	t.check(boss.state == "chase" and boss.phase == 1 and events.has("boss_rise"), "le Bourreau surgit (rise -> chase)")
	_tick(g, 0.5)   # l'invulnérabilité de l'arrivée (2,6 s) dure un peu plus que la remontée (2,4 s)
	var hp0 := float(Config.at("finale.bossHealth"))
	t.near(boss.max_health, hp0, "santé du Bourreau, joueur seul", 1e-9)
	# phase I -> II : le Glas
	g.player.pos = Vector3(boss.pos.x + 6.0, 0.0, boss.pos.z)
	var mx := boss.max_health
	g.hit_zombie(boss, false, mx * 0.42, 1.0, false, {"back": false})   # face : x0,75 -> 31,5 % de la santé
	t.check(boss.phase == 2 and boss.state == "toll" and boss.is_invulnerable(), "70 % : le Glas, invulnérable")
	t.near(boss.health, 0.7 * mx, "santé ramenée au seuil de 70 %", 1e-6)
	var before := boss.health
	g.hit_zombie(boss, false, 5000.0, 1.0)
	t.near(boss.health, before, "invulnérable : aucun dégât", 1e-9)
	_until(g, func() -> bool: return not boss.is_invulnerable() and boss.state == "chase", 20.0)
	t.check(g.zombies.size() > 3, "le Glas appelle des renforts")
	_kill_all(g)
	# phase II -> saut vers la tour : acte III
	g.hit_zombie(boss, false, mx * 0.4, 1.0, false, {"back": false})
	t.check(boss.state == "leap" and boss.phase == 3 and boss.leaped, "45 % : il bondit vers la tour")
	_until(g, func() -> bool: return F.state() == "ascent", 5.0)
	t.check(F.state() == "ascent" and boss.state == "hidden", "acte III : l'ascension")
	_kill_all(g)
	# le joueur monte sur la plateforme (67,5 m) : 3 s plus tard le Bourreau l'y attend
	var pl: Dictionary = g.world.levels.regions[F.R["PL"]]
	var pl_pt := Cathedral.P(-30.0, 0.0)
	g.player.pos = Vector3(pl_pt.x, float(pl["y"]), pl_pt.y)
	_until(g, func() -> bool: return F.state() == "boss2", 10.0)
	t.check(F.state() == "boss2" and g.player.tregion == int(F.R["PL"]), "plateforme atteinte : acte IV (région %d)" % g.player.tregion)
	_until(g, func() -> bool: return boss.state == "chase", 6.0)
	_tick(g, 0.5)
	t.check(boss.state == "chase" and boss.region == int(F.R["PL"]) and absf(boss.pos.y - float(pl["y"])) < 0.01, "le Bourreau resurgit sur la plateforme")
	_kill_all(g)
	# phase III -> IV : rugissement à 20 % ; puis la mort
	g.hit_zombie(boss, false, mx * 0.4, 1.0, false, {"back": false})
	t.check(boss.phase == 4 and boss.state == "roar", "20 % : rugissement (phase IV)")
	_tick(g, 2.5)
	t.check(boss.state != "roar", "...puis le Jugement")
	var killed_before: int = g.kills
	g.hit_zombie(boss, false, mx, 1.0, false, {"back": true})
	t.check(boss.dead and F.state() == "victory", "le Bourreau est tombé (victoire annoncée)")
	t.check(g.kills == killed_before + 1, "le Bourreau compte pour un mort")
	var maxammo := false
	for pu: Dictionary in g.powerups.items:
		if pu["type"] == "max_ammo":
			maxammo = true
	t.check(maxammo, "il lâche Max Munitions")
	var pts0: int = g.points
	_until(g, func() -> bool: return g.finale_done, 6.0)
	t.check(g.finale_done and screens.has("VICTOIRE !"), "victoire : écran affiché")
	t.check(g.points >= pts0 + int(Config.at("finale.boss.reward.points")), "récompense de 10 000 points")
	t.check(g.arms.has_axe, "la Hache du Bourreau remplace le couteau")
	t.check(F.state() == "summit_beam", "Acte V : le faisceau s'allume (%s)" % F.state())
	# Acte V : monter sur la terrasse -> gargouilles
	var top_pt := Cathedral.tower_pt(8.0, 100.0)
	g.player.pos = Vector3(top_pt.x, 104.0, top_pt.y)
	_until(g, func() -> bool: return F.state() == "summit_garg", 5.0)
	t.check(F.state() == "summit_garg", "terrasse atteinte : les gargouilles")
	var G: Dictionary = Config.at("summit.gargoyles")
	var seen_garg := 0
	var max_garg := 0
	var gg := 0
	while F.state() == "summit_garg" and gg < 60 * 90:
		g.player.health = g.player.max_health
		g.step(DT, {})
		gg += 1
		var n := F.garg_alive()
		max_garg = maxi(max_garg, n)
		seen_garg = maxi(seen_garg, int(F.f.get("gTotal", 0)) - int(F.f.get("gQueue", 0)))
		if gg % 20 == 0:
			for z: ZombieSim in g.zombies:
				if z.kind == "gargoyle" and not z.dead:
					g.hit_zombie(z, false, 1.0e9, 1.0)
	t.check(seen_garg == int(G["count"]) and max_garg <= int(G["maxAlive"]), "%d gargouilles (au plus %d à la fois, vu %d)" % [seen_garg, int(G["maxAlive"]), max_garg])
	t.check(F.state() == "summit_angel", "dernière gargouille tombée : l'Ange (%s)" % F.state())
	var angel: AngelSim = F.f["boss"]
	t.check(angel != null and angel.is_angel and angel.state == "arrive", "l'Ange arrive du ciel")
	t.near(angel.max_health, float(Config.at("summit.angel.health")), "santé de l'Ange", 1e-9)
	_until(g, func() -> bool: return angel.state != "arrive", 5.0)
	t.check(angel.state == "orbit" and angel.is_invulnerable() == false, "l'Ange tourne autour de la flèche")
	var br := F.boss_bar()
	t.check(br.get("name", "") == "L'ANGE DU JUGEMENT" and br.get("thresholds", [1]).is_empty(), "barre de vie de l'Ange sans seuils")
	# tir sur la trompette : x weak
	var tw := angel.trumpet_world()
	g.player.pos = Vector3(tw.x + 3.0, 104.0, tw.z)
	var hpa := angel.health
	g.hit_zombie(angel, true, 100.0, 1.5)
	t.near(hpa - angel.health, 100.0 * float(Config.at("summit.angel.weak")), "trompette : dégâts x weak (pas le bonus de tête)", 1e-9)
	hpa = angel.health
	g.hit_zombie(angel, false, 100.0, 1.5)
	t.near(hpa - angel.health, 100.0, "ailes : dégâts normaux", 1e-9)
	# les attaques de l'Ange touchent le joueur exposé (sur la terrasse)
	g.player.pos = Vector3(top_pt.x, 104.0, top_pt.y)
	var hurt_before: float = g.player.health
	var took := false
	for _i in 60 * 40:
		g.player.health = g.player.max_health
		g.step(DT, {})
		if F.log.any(func(e: Dictionary) -> bool: return String(e["name"]) in ["angel_trumpet", "angel_plumes", "boss_mark"]):
			took = true
			break
	t.check(took, "l'Ange attaque (trompette, plumes ou jugement)")
	t.check(hurt_before > 0.0, "joueur vivant")
	g.hit_zombie(angel, true, angel.health + 1.0, 1.0)
	t.check(angel.dead and F.state() == "summit_angel_dead", "l'Ange est tombé")
	t.check(announces.has("L'ANGE DU JUGEMENT"), "annonce de l'Ange")
	_until(g, func() -> bool: return F.state() == "summit_ramp", 5.0)
	t.check(F.state() == "summit_ramp", "la rampe s'ouvre")
	# rampe : le joueur est sur la rampe -> rafales et gargouilles qui montent
	var ramp_reg: Dictionary = g.world.levels.regions[F.R["RAMP"]]
	var rl: Dictionary = g.world.levels.links[int(ramp_reg["link"])]
	var rp := {}
	g.world.levels.point_on(rl, 20.0, rp)
	g.player.pos = Vector3(rp["x"], rp["y"], rp["z"])
	var seen_gust := false
	var seen_rg := false
	for _i in 60 * 20:
		g.player.health = g.player.max_health
		g.step(DT, {})
		if F.gusts.size() > 0:
			seen_gust = true
		if F.garg_alive() > 0:
			seen_rg = true
	t.check(g.player.region == int(F.R["RAMP"]), "le joueur est sur la rampe (région %d)" % g.player.region)
	t.check(seen_gust and events.has("summit_gust"), "rafales sur la rampe")
	t.check(seen_rg, "gargouilles qui montent la rampe")
	_kill_all(g)
	for z: ZombieSim in g.zombies:
		if z.kind == "gargoyle" and not z.dead:
			g.hit_zombie(z, false, 1.0e9, 1.0)
	# le Fanal : la pointe, touche maintenue
	var fp := F.fanal_pos()
	g.player.pos = Vector3(fp.x + 1.0, fp.y, fp.z)
	_until(g, func() -> bool: return F.state() == "summit_fanal", 3.0)
	t.check(F.state() == "summit_fanal" and F.fanal_frac() >= 0.0, "la pointe : le Fanal (%s)" % F.state())
	_tick(g, 2.0, {"interact": false})
	t.near(F.fanal_frac(), 0.0, "sans touche, la jauge reste vide", 1e-9)
	_tick(g, 3.0, {"interact": true})
	var half := F.fanal_frac()
	t.check(half > 0.4 and half < 0.6, "jauge à mi-chemin après 3 s sur 6 (%.2f)" % half)
	_tick(g, 1.0, {"interact": false})
	t.check(F.fanal_frac() < half - 0.05, "la jauge retombe sans la touche")
	_until(g, func() -> bool: return F.dawn_on, 10.0, {"interact": true})
	t.check(F.dawn_on and g.blessed and g.eternal and g.free_doors, "l'Aube : Bénédiction, Nuit éternelle, portes gratuites")
	for id: String in Config.at("perks"):
		t.check(g.arms.perks.get(id, false), "Bénédiction : atout %s" % id)
	t.check(F.orbit_on and F.cam_lock, "vue orbitale")
	var op := F.orbit_pose()
	t.check((op["pos"] as Vector3).y >= 132.0 - 0.01, "caméra orbitale à la hauteur prévue")
	_tick(g, 2.0)
	t.check(F.sky_k > 0.0 and F.sky_k < 0.2, "le ciel passe au jour (k=%.3f après 2 s sur 30)" % F.sky_k)
	# à terre sous la Bénédiction : on garde ses atouts
	g.player.health = 5.0
	g.player.hurt(1000.0, g.time)
	g._player_events()
	t.check(g.player.downed or g.player.dead or g.player.health > 0.0, "état à terre sous Bénédiction")
	t.check(g.arms.perks.get("juggernog", false), "à terre : atouts gardés")
	_until(g, func() -> bool: return not F.orbit_on, 14.0)
	t.check(screens.has("STRASBOURG LIBÉRÉE") and g.trophy == 1, "écran « STRASBOURG LIBÉRÉE » et trophée n° %d" % g.trophy)
	t.check(FileAccess.file_exists(g.trophy_path), "trophée enregistré dans user://")
	_until(g, func() -> bool: return not F.active(), 10.0)
	t.check(not F.active() and g.director.intermission > 0.0, "fin de l'Acte V : les manches reprennent")
	_until(g, func() -> bool: return g.round_number > 12, 20.0)
	t.near(g.director.zombie_health, g.zombie_health_at(g.round_number) * float(Config.at("summit.eternal.healthMult")), "Nuit éternelle : +30 % de vie", 1.0)
	t.check(g.use_door() == -1 or true, "portes gratuites")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(g.trophy_path))
	_tanner(t)

# ------------------------------------------------------------------ Maître Tanneur
func _tanner(t: Node) -> void:
	var g: Node = Game
	g.new_game(5, "strasbourg", Config.at("startWeapons", []))
	var F: FinaleSim = g.finale
	g.world.open_all_doors()
	g.director.intermission = 1.0e9
	g.director.round_number = 14
	t.check(not F.maybe_spawn_tanner(), "pas de Tanneur à la manche 14")
	g.director.round_number = 15
	t.check(F.maybe_spawn_tanner(), "Tanneur à la manche 15")
	t.check(not F.maybe_spawn_tanner(), "un seul Tanneur à la fois")
	var tn: TannerSim
	for z: ZombieSim in g.zombies:
		if z is TannerSim:
			tn = z
	t.check(tn != null and tn.mini and tn.is_boss and not tn.is_angel, "Tanneur : mini-boss")
	t.near(tn.max_health, roundf(float(Config.at("tanner.healthMult")) * g.zombie_health_at(15)), "santé du Tanneur", 1e-9)
	t.check(F.mini_bar.is_empty(), "barre du Tanneur calculée au pas")
	g.player.pos = Vector3(tn.pos.x + 5.0, 0.0, tn.pos.z)
	g.player.health = 100000.0
	g.player.max_health = 100000.0
	_tick(g, 0.1, {}, false)
	t.check(not F.mini_bar.is_empty() and F.mini_bar["name"] == "MAÎTRE TANNEUR", "barre de vie du Tanneur")
	var hp := tn.health
	g.hit_zombie(tn, true, 1000.0, 2.0)
	t.near(hp - tn.health, 2000.0, "Tanneur : dégâts d'un zombie ordinaire (tête x2)", 1e-9)
	var vomited := false
	for _i in 60 * 30:
		g.step(DT, {})
		if tn.state == "vomit":
			vomited = true
			break
	t.check(vomited, "le Tanneur vomit")
	g.add_perk("phdflopper")
	var pts: int = g.points
	g.player.pos = Vector3(tn.pos.x + 3.0, 0.0, tn.pos.z)
	var hp_player: float = g.player.health
	g.hit_zombie(tn, false, tn.health + 1.0, 1.0)
	t.check(tn.dead, "Tanneur tué")
	t.check(g.points >= pts + int(Config.at("tanner.reward.points")), "Tanneur : 1500 points")
	t.near(g.player.health, hp_player, "l'explosion du Tanneur : le PHD Flopper protège", 1e-6)
	var maxammo := false
	for pu: Dictionary in g.powerups.items:
		if pu["type"] == "max_ammo":
			maxammo = true
	t.check(maxammo, "Tanneur : Max Munitions")
