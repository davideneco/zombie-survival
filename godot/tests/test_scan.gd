extends RefCounted
## Balayage : un zombie posé à la sortie de chaque fenêtre (échantillon), un joueur immobile à 35-55 m ; le zombie arrive-t-il en 60 s ?
func run(t: Node) -> void:
	var n_total := 0
	var fails: Array[String] = []
	var trials: Array = []
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	var args := OS.get_cmdline_user_args()
	var count := 300
	for a in args:
		if a.begins_with("--n="):
			count = int(a.substr(4))
	Game.new_game(1, "strasbourg", Config.at("startWeapons", []))
	Game.world.open_all_doors()
	Game.director.intermission = 1.0e9
	var nw := Game.world.window_count()
	for k in count:
		var wi := rng.randi() % nw
		Game.zombies.clear()
		Game.player.reset(Game.world.start_pos)
		Game.player.dead = false
		var out := Game.world.window_outside(wi)
		var ing := Game.world.window_inside(wi)
		var g := Game.world.pick_ground(out.x, out.z, 35.0, 55.0, rng)
		if g == Vector3.INF:
			continue
		Game.player.pos = Vector3(g.x, 0, g.z)
		Game.player.health = 1.0e9
		Game.player.max_health = 1.0e9
		Game.time = 0.0
		Game.relocated = 0
		var z := ZombieSim.new()
		z.id = 500 + k
		z.rng = Game.rng
		z.speed = 2.0
		z.init_traits(Game.rng)
		z.limp = false
		var n := Game.world.window_normal(wi)
		z.start_window_spawn(ing, out, Game.world.window_center(wi), n, atan2(n.x, n.y), wi)
		Game.zombies.append(z)
		z.health = 1.0e9
		z.max_health = 1.0e9
		var nav := Game.world.nav
		var start_blocked := nav.is_blocked_at(out.x, out.z)
		var arrived := -1.0
		for i in 60 * 63:
			Game.step(1.0 / 60.0, {"mx": 0.0, "mz": 0.0})
			if Vector2(z.pos.x - Game.player.pos.x, z.pos.z - Game.player.pos.z).length() < 2.0:
				arrived = i / 60.0
				break
		n_total += 1
		trials.append({"wi": wi, "px": g.x, "pz": g.z, "arrived": arrived, "d": Vector2(z.pos.x - Game.player.pos.x, z.pos.z - Game.player.pos.z).length()})
		if arrived < 0.0:
			fails.append("fenetre %d dehors (%.1f ; %.1f) %s -> joueur (%.1f ; %.1f), fin d=%.1f relogé %d" % [wi, out.x, out.z, "BLOQUEE" if start_blocked else "libre", g.x, g.z, Vector2(z.pos.x - Game.player.pos.x, z.pos.z - Game.player.pos.z).length(), Game.relocated])
	for a in args:
		if a.begins_with("--out="):
			var f := FileAccess.open(a.substr(6), FileAccess.WRITE)
			f.store_string(JSON.stringify(trials))
	print("balayage fenetres : %d essais, %d échecs" % [n_total, fails.size()])
	for f in fails:
		print("  ", f)
