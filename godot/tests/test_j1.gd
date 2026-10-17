extends RefCounted
## J1 : golden de Collision (resolve, rayHit, findVault), arène égale à resolveCollisions de world.js, puis scénarios de simulation
## (bot immobile tué, bot qui tire tue la manche 1, mort du joueur, points, manches).

const TOL := 1e-6
const MM := 1e-3     ## contrat du plan : égaux à 1 mm près

func _num(v: Variant, dflt: float) -> float:
	return dflt if v == null else float(v)

func _build_scene(s: Dictionary) -> Collision:
	var col := Collision.new(float(s["halfX"]), float(s["halfZ"]), float(s["cell"]))
	for q in s["segs"]:
		col.add_segment(q["ax"], q["az"], q["bx"], q["bz"], _num(q["h"], INF), _num(q["y0"], -INF), q["kind"])
	for c in s["circles"]:
		col.add_circle(c["x"], c["z"], c["r"], _num(c["h"], INF), -INF, c["kind"], c["vault"])
	for b in s["boxes"]:
		col.add_box(b["x"], b["z"], b["w"], b["d"], b["rot"], _num(b["h"], INF), -INF, b["kind"], b["vault"])
	for f in s["floors"]:
		col.add_floor(f["y"], f["tris"])
	col.build()
	for d in s["dyn"]:
		col.set_dynamic(d["key"], d["boxes"], d["kind"])
	return col

func run(t: Node) -> void:
	_golden(t)
	_sim(t)

func _golden(t: Node) -> void:
	var g: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/golden/j1.json"))
	t.check(typeof(g) == TYPE_DICTIONARY, "golden j1.json lisible")
	if typeof(g) != TYPE_DICTIONARY:
		return
	var col := _build_scene(g["scene"])
	var n_push := 0
	for i in g["resolve"].size():
		var c: Dictionary = g["resolve"][i]
		var out := {}
		var p: Dictionary = c["p"]
		var res := col.resolve(Vector3(p["x"], p["y"], p["z"]), c["r"], out, "tram" if c["ignore"] else null, true)
		t.near(res.x, c["x"], "resolve #%d x" % i, MM)
		t.near(res.z, c["z"], "resolve #%d z" % i, MM)
		t.near(res.y, p["y"], "resolve #%d y inchangé" % i, 1e-6 * 10)
		t.check(out["kind"] == c["kind"], "resolve #%d kind %s != %s" % [i, out["kind"], c["kind"]])
		t.near(out["push"], c["push"], "resolve #%d push" % i, MM)
		if c["push"] > 0.0:
			n_push += 1
			t.near(out["nx"], c["nx"], "resolve #%d nx" % i, MM)
			t.near(out["nz"], c["nz"], "resolve #%d nz" % i, MM)
	t.check(n_push > 250, "golden resolve : assez de cas avec poussée (%d)" % n_push)
	var n_hit := 0
	for i in g["ray"].size():
		var c: Dictionary = g["ray"][i]
		var o: Dictionary = c["o"]
		var d: Dictionary = c["d"]
		var tt := col.ray_hit(o["x"], o["y"], o["z"], d["x"], d["y"], d["z"], c["maxT"])
		t.near(tt, c["t"], "rayHit #%d" % i, MM)
		if c["t"] < c["maxT"]:
			n_hit += 1
	t.check(n_hit > 400, "golden rayHit : assez de rayons qui touchent (%d)" % n_hit)
	var n_found := 0
	for i in g["vault"].size():
		var c: Dictionary = g["vault"][i]
		var r := col.find_vault(c["o"]["x"], c["o"]["z"], c["ux"], c["uz"], c["reach"])
		if c["res"] == null:
			t.check(r.is_empty(), "findVault #%d : rien attendu" % i)
		else:
			n_found += 1
			t.check(not r.is_empty(), "findVault #%d : obstacle attendu" % i)
			if not r.is_empty():
				t.near(r["tIn"], c["res"]["tIn"], "findVault #%d tIn" % i, MM)
				t.near(r["tOut"], c["res"]["tOut"], "findVault #%d tOut" % i, MM)
				t.near(r["nx"], c["res"]["nx"], "findVault #%d nx" % i, MM)
				t.near(r["nz"], c["res"]["nz"], "findVault #%d nz" % i, MM)
				t.near(r["v"]["h"], c["res"]["h"], "findVault #%d h" % i, MM)
	t.check(n_found > 15, "golden findVault : assez d'obstacles trouvés (%d)" % n_found)
	# l'arène de sim/arena.gd pousse comme les rectangles de world.js
	var arena := Arena.load_arena()
	t.near(arena.half, Config.at("arenaHalf"), "arène : demi-largeur de Config")
	for i in g["arenaCases"].size():
		var c: Dictionary = g["arenaCases"][i]
		var res := arena.collision.resolve(Vector3(c["p"]["x"], 0, c["p"]["z"]), c["r"])
		t.near(res.x, c["x"], "arène #%d x" % i, MM)
		t.near(res.z, c["z"], "arène #%d z" % i, MM)
	print("golden j1 : %d resolve (%d poussés), %d rayHit (%d touchent), %d findVault (%d trouvés), %d cas d'arène" % [g["resolve"].size(), n_push, g["ray"].size(), n_hit, g["vault"].size(), n_found, g["arenaCases"].size()])

# ------------------------------------------------------------------ scénarios de simulation
const DT := 1.0 / 60.0

## Vise le centre du zombie (corps ou tête) depuis l'oeil du joueur.
func _aim_at(p: PlayerSim, target: Vector3) -> void:
	var d := target - p.eye()
	p.yaw = atan2(-d.x, -d.z)
	p.pitch = atan2(d.y, sqrt(d.x * d.x + d.z * d.z))

func _sim(t: Node) -> void:
	# --- règles de base : manches, santé, points
	Game.new_game(1, "arena")
	t.check(Game.points == int(Config.at("player.startPoints")), "points de départ")
	t.check(Game.round_number == 0, "manche 0 avant le départ")
	t.near(Game.player.health, 100.0, "santé de départ")
	var steps := 0
	while Game.round_number == 0 and steps < 600:
		Game.step(DT, {})
		steps += 1
	t.check(Game.round_number == 1, "la manche 1 démarre après la pause initiale")
	t.near(steps * DT, Rules.INTERMISSION_FIRST, "pause initiale", 0.02)
	t.check(Game.director.to_spawn == 7, "manche 1 : 7 zombies")
	t.near(Game.director.zombie_health, Game.zombie_health_at(1), "santé de manche 1")
	t.near(Game.director.zombie_speed, 1.72, "vitesse de manche 1")
	# apparitions
	for _i in 600:
		Game.step(DT, {})
	t.check(Game.zombies.size() > 0, "des zombies apparaissent")
	for z in Game.zombies:
		t.check(absf(z.pos.x) <= Game.arena.half and absf(z.pos.z) <= Game.arena.half, "le zombie apparaît dans l'arène")

	# --- collision : le joueur ne traverse ni l'obstacle central ni le mur
	Game.new_game(2, "arena")
	Game.player.pos = Vector3(0, 0, 4)
	Game.player.yaw = 0.0   # regarde vers -Z, l'obstacle central (0,0) 2,5 m de côté
	for _i in 240:
		Game.step(DT, {"mz": 1.0})
	t.check(Game.player.pos.z > 1.25 + float(Config.at("player.radius")) - 0.02, "le joueur est arrêté par la caisse centrale (z=%.3f)" % Game.player.pos.z)
	Game.player.pos = Vector3(0, 0, 20)
	Game.player.yaw = PI    # regarde vers +Z
	for _i in 600:
		Game.step(DT, {"mz": 1.0})
	t.check(Game.player.pos.z <= Game.arena.half - float(Config.at("player.radius")) + 1e-6, "le joueur est arrêté par le mur")
	# saut : vitesse et retour au sol
	Game.new_game(3, "arena")
	Game.step(DT, {"jump": true})
	t.check(Game.player.pos.y > 0.0, "le saut décolle")
	var peak := 0.0
	for _i in 120:
		Game.step(DT, {})
		peak = maxf(peak, Game.player.pos.y)
	t.near(peak, pow(float(Config.at("player.jumpSpeed")), 2) / (2.0 * float(Config.at("player.gravity"))), "hauteur de saut v²/2g (pas discret)", 0.06)
	t.near(Game.player.pos.y, 0.0, "retour au sol")
	# sprint vs marche
	Game.new_game(4, "arena")
	Game.player.pos = Vector3(0, 0, 25)
	for _i in 60:
		Game.step(DT, {"mz": 1.0})
	var v_walk := Vector2(Game.player.vel.x, Game.player.vel.z).length()
	t.near(v_walk, float(Config.at("player.walkSpeed")), "vitesse de marche", 0.01)
	Game.new_game(4, "arena")
	Game.player.pos = Vector3(0, 0, 25)
	for _i in 60:
		Game.step(DT, {"mz": 1.0, "sprint": true})
	t.near(Vector2(Game.player.vel.x, Game.player.vel.z).length(), float(Config.at("player.sprintSpeed")), "vitesse de sprint", 0.01)

	# --- tir : une balle par clic, recharge, points
	Game.new_game(5, "arena")
	var w := Game.weapon
	t.check(w.ammo == 7 and w.reserve == 42, "M1911 : 7 + 42")
	Game.step(DT, {"fire": true})
	t.check(w.ammo == 6, "un tir consomme une balle")
	for _i in 30:
		Game.step(DT, {"fire": true})   # bouton maintenu : semi, pas de rafale
	t.check(w.ammo == 6, "semi-automatique : une balle par clic")
	Game.step(DT, {})
	Game.time += 1.0
	Game.step(DT, {"fire": true})
	t.check(w.ammo == 5, "nouveau clic, nouveau tir")
	Game.step(DT, {"reload": true})
	t.check(w.reloading, "rechargement lancé")
	for _i in int(float(w.cfg["reloadTime"]) / DT) + 3:
		Game.step(DT, {})
	t.check(not w.reloading and w.ammo == 7 and w.reserve == 40, "rechargement terminé : 7 + 40 (%d + %d)" % [w.ammo, w.reserve])

	# --- scénario : un bot immobile est tué en N secondes à la manche 1
	var sc := _run_bot(1, false)
	t.check(sc["dead"], "bot immobile : tué par la manche 1")
	print("bot immobile (manche 1) : mort en %.1f s" % sc["time"])
	t.check(sc["time"] > 8.0 and sc["time"] < 60.0, "bot immobile : durée plausible (%.1f s)" % sc["time"])
	# --- scénario : un bot qui tire tue la manche 1 et survit
	var sh := _run_bot(2, true)
	t.check(sh["round_cleared"], "bot tireur : manche 1 nettoyée (%d tués, %.1f pts)" % [sh["kills"], sh["points"]])
	t.check(sh["kills"] == 7, "bot tireur : 7 zombies tués (%d)" % sh["kills"])
	t.check(sh["points"] > int(Config.at("player.startPoints")) + 7 * Rules.POINTS_KILL, "bot tireur : points gagnés (%d)" % sh["points"])
	t.check(sh["health"] > 0.0, "bot tireur : survivant")
	print("bot tireur (manche 1) : %d tués en %.1f s, %d points, %d PV, %d tirs" % [sh["kills"], sh["time"], sh["points"], sh["health"], sh["shots"]])
	# tir à la tête = 100 points, au corps = 60
	Game.new_game(7, "arena")
	var z := ZombieSim.new()
	z.pos = Vector3(-3, 0, -8)
	z.health = 10.0
	Game.zombies.append(z)
	var p0 := Game.points
	Game.player.pos = Vector3(-3, 0, 4)
	_aim_at(Game.player, z.pos + Vector3(0, 1.83, 0.07))
	Game.weapon.cfg = Game.weapon.cfg.duplicate()
	Game.weapon.cfg["spread"] = 0.0
	Game.step(DT, {"fire": true})
	t.check(z.dead and z.headless, "balle à la tête : mort, tête touchée")
	t.check(Game.points == p0 + Rules.POINTS_HEADSHOT, "100 points pour une mort à la tête (%d)" % (Game.points - p0))
	Game.zombies.clear()
	var z2 := ZombieSim.new()
	z2.pos = Vector3(-3, 0, -8)
	z2.health = 10.0
	Game.zombies.append(z2)
	Game.step(DT, {})
	Game.time += 1.0
	p0 = Game.points
	_aim_at(Game.player, z2.pos + Vector3(0, 0.8, 0))
	Game.step(DT, {"fire": true})
	t.check(z2.dead and not z2.headless and Game.points == p0 + Rules.POINTS_KILL, "60 points pour une mort au corps (%d)" % (Game.points - p0))
	var z3 := ZombieSim.new()
	z3.pos = Vector3(-3, 0, -8)
	z3.health = 1000.0
	Game.zombies.append(z3)
	Game.step(DT, {})
	Game.time += 1.0
	p0 = Game.points
	Game.step(DT, {"fire": true})
	t.check(not z3.dead and Game.points == p0 + Rules.POINTS_HIT and z3.health < 1000.0, "10 points pour un tir qui ne tue pas")
	# un mur arrête la balle : zombie derrière la caisse centrale (0,0) h=3,5
	Game.new_game(8, "arena")
	Game.weapon.cfg = Game.weapon.cfg.duplicate()
	Game.weapon.cfg["spread"] = 0.0
	Game.player.pos = Vector3(0, 0, 6)
	var zb := ZombieSim.new()
	zb.pos = Vector3(0, 0, -4)
	zb.health = 1000.0
	Game.zombies.append(zb)
	_aim_at(Game.player, zb.pos + Vector3(0, 0.8, 0))
	Game.step(DT, {"fire": true})
	t.check(zb.health == 1000.0, "la caisse arrête la balle")
	# --- mort du joueur et écran de fin
	Game.new_game(9, "arena")
	var over_seen := [false]
	var cb := func(): over_seen[0] = true
	Game.game_over.connect(cb)
	Game.player.pos = Vector3(0, 0, 6)
	var zk := ZombieSim.new()
	zk.pos = Vector3(0, 0, 5.0)
	Game.zombies.append(zk)
	var guard := 0
	while not Game.over and guard < 60 * 30:
		Game.step(DT, {})
		guard += 1
	Game.game_over.disconnect(cb)
	t.check(Game.over and Game.player.dead and over_seen[0], "le joueur meurt et game_over est émis")
	var hits_to_kill := ceilf(100.0 / float(Config.at("zombie.damage")))
	var expected := Rules.ZOMBIE_FIRST_ATTACK_CD + Rules.ZOMBIE_ATTACK_WINDUP + (hits_to_kill - 1.0) * (float(Config.at("zombie.attackCooldown")) + Rules.ZOMBIE_ATTACK_WINDUP)
	t.near(Game.time, expected, "durée avant la mort : cadence d'attaque du zombie", 0.15)
	var tm := Game.time
	Game.step(DT, {})
	t.near(Game.time, tm, "la simulation s'arrête après la mort", 0.0)

## Joue un bot jusqu'à la fin de la manche 1 (ou la mort / 120 s). aim : le bot vise et tire sur le zombie le plus proche.
func _run_bot(seed_value: int, aim: bool) -> Dictionary:
	Game.new_game(seed_value, "arena")
	var shots := [0]
	var cb := func(_o, _e): shots[0] += 1
	Game.shot_fired.connect(cb)
	var cleared := false
	var t_clear := 0.0
	var steps := 0
	while steps < 60 * 120 and not Game.over:
		var input := Bot.think(Game) if aim else {}
		Game.step(DT, input)
		steps += 1
		if Game.round_number == 1 and Game.director.to_spawn == 0 and Game.alive_count() == 0 and Game.kills > 0:
			cleared = true
			t_clear = Game.time
			break
	Game.shot_fired.disconnect(cb)
	return {"dead": Game.over, "round_cleared": cleared, "kills": Game.kills, "time": t_clear if cleared else Game.time, "points": Game.points, "health": Game.player.health, "shots": shots[0]}
