extends RefCounted
## v0.34.0 : carte « Station des Aiguilles » (sim/alpine_map.gd, data/alpine.json écrit par tools/build-alpine.py). Propre au port (pas de golden JS) :
##   - plan : 6 zones, 7 portes payantes aux prix croissants, machines (atouts, boîtes, Pack-a-Punch, cloche), armes murales, bornes, véhicules ;
##   - navigation : chaque zone est une seule composante portes fermées, aucune composante ne mélange deux zones, tout est relié portes ouvertes,
##     poches inaccessibles négligeables, chaque porte relie deux zones différentes et le graphe des portes atteint toutes les zones ;
##   - collision : on ne traverse ni les palissades, ni les murets, ni les façades, ni une porte fermée ; une porte ouverte se franchit ;
##     les ouvertures des bâtiments visitables se franchissent ;
##   - apparitions : toutes les fenêtres sont valides (arrivée libre, dans une zone), assez de fenêtres par zone, apparitions au sol dans les zones
##     ouvertes ; une partie : des zombies apparaissent dans la zone de départ et viennent au joueur ;
##   - machines, armes murales, bornes, départ : dans une zone, avec une case libre de la même zone à portée d'interaction ;
##   - portes achetées une à une depuis le départ : toutes les zones s'ouvrent ; motoneiges (nom et modèle), pas de tram ;
##   - finale : la cloche (manche 10, toutes les zones), le Bourreau des neiges passe ses quatre phases au sol (sans saut vers une tour), victoire ;
##   - Contre la montre et Arsenal aléatoire sur la carte ; Strasbourg inchangée (réglage de carte, carte par défaut).

const DT := 1.0 / 60.0
const IDLE := {"mx": 0.0, "mz": 0.0}

func run(t: Node) -> void:
	var w := AlpineMap.load_map()
	print("j39 : carte alpine chargée en %d ms" % w.load_ms)
	_plan(t, w)
	_nav(t, w)
	_collision(t, w)
	_spawns(t, w)
	_reach(t, w)
	_settings(t)
	_game_doors(t)
	_game_spawns(t)
	_rides(t)
	_finale(t)
	_modes(t)
	Game.mode = GameMode.CLASSIC

# ------------------------------------------------------------------ plan
func _plan(t: Node, w: World) -> void:
	t.check(w.map_id == "alpine" and w.zone_names.size() == 6, "6 zones (%s)" % [w.zone_names])
	t.check(w.half_x == 150.0 and w.half_z == 150.0, "zone de jeu de 300 x 300 m")
	t.check(w.doors.size() == 7, "7 portes payantes")
	var prev := 0
	var ok := true
	for d: Dictionary in w.doors:
		ok = ok and int(d["price"]) >= prev and int(d["price"]) >= 750
		prev = int(d["price"])
		t.check(bool(d["zones_ok"]), "porte %d (%s) : deux zones différentes de part et d'autre (%d / %d)" % [int(d["id"]), d["name"], int(d["a"]), int(d["b"])])
		t.check((d["cells"] as PackedInt32Array).size() > 0, "porte %d : des cases de navigation à libérer" % int(d["id"]))
	t.check(ok, "prix des portes croissants")
	# le graphe des portes atteint toutes les zones depuis le départ
	var reach := {w.start_zone: true}
	var grow := true
	while grow:
		grow = false
		for d: Dictionary in w.doors:
			var a := int(d["a"])
			var b := int(d["b"])
			if reach.has(a) != reach.has(b):
				reach[a] = true
				reach[b] = true
				grow = true
	t.check(reach.size() == 6, "toutes les zones atteignables par les portes (%d)" % reach.size())
	var count := {}
	for m: Dictionary in w.objects["machines"]:
		count[m["type"]] = int(count.get(m["type"], 0)) + 1
	t.check(int(count.get("perk", 0)) >= 11, "atouts : %d distributeurs" % int(count.get("perk", 0)))
	t.check(int(count.get("box", 0)) >= 5 and int(count.get("pap", 0)) == 1 and int(count.get("clock", 0)) == 1, "boîtes (%d), un Pack-a-Punch, une cloche" % int(count.get("box", 0)))
	var perk_ids := {}
	for m: Dictionary in w.objects["machines"]:
		if m["type"] == "perk":
			t.check(not perk_ids.has(m["id"]), "atout %s : un seul distributeur" % m["id"])
			perk_ids[m["id"]] = true
			t.check(bool(m.get("proc", false)) and int(m["price"]) > 0 and String(m["name"]) != "", "atout %s : modèle par code, nom et prix" % m["id"])
	for id: String in ["juggernog", "quickrevive", "speedcola", "doubletap", "staminup", "phdflopper", "mulekick"]:
		t.check(perk_ids.has(id), "atout de base %s présent" % id)
	t.check(w.objects["wallWeapons"].size() >= 12 and w.objects["stations"].size() >= 6, "armes murales (%d) et bornes (%d)" % [w.objects["wallWeapons"].size(), w.objects["stations"].size()])
	var box_start := false
	for m: Dictionary in w.objects["machines"]:
		if m["type"] == "box" and int(m["zone"]) == w.start_zone:
			box_start = true
	t.check(box_start, "une boîte mystère dans la zone de départ")
	t.check(w.zone_of(w.start_pos.x, w.start_pos.z) == w.start_zone and not w.nav.is_blocked_at(w.start_pos.x, w.start_pos.z), "départ libre, dans la Place du Village")
	# reproductible : un second chargement donne la même grille
	var w2 := AlpineMap.load_map()
	t.check(w2.nav.blocked == w.nav.blocked and w2.nav.zone == w.nav.zone and w2.windows == w.windows and w2.collision.segs.size() == w.collision.segs.size(), "chargement reproductible")

# ------------------------------------------------------------------ navigation
func _nav(t: Node, w: World) -> void:
	var nav := w.nav
	var comp := nav.components()
	var labels: PackedInt32Array = comp["labels"]
	var zone_of_comp := {}
	var mixed := 0
	var free := 0
	var pocket := 0
	var per_zone_comps := {}
	for i in labels.size():
		if nav.blocked[i] != 0:
			continue
		free += 1
		var zi := int(nav.zone[i])
		if zi == 255:
			pocket += 1
			continue
		var l := labels[i]
		if zone_of_comp.has(l) and int(zone_of_comp[l]) != zi:
			mixed += 1
		zone_of_comp[l] = zi
		if not per_zone_comps.has(zi):
			per_zone_comps[zi] = {}
		per_zone_comps[zi][l] = true
	t.check(mixed == 0, "portes fermées : aucune composante ne mélange deux zones (%d cases)" % mixed)
	for zi in w.zone_names.size():
		t.check(per_zone_comps.has(zi) and (per_zone_comps[zi] as Dictionary).size() == 1, "zone %s : une seule composante portes fermées" % w.zone_names[zi])
		var area := float(w.objects["zones"][zi]["area"])
		t.check(area > 2500.0, "zone %s : %.0f m² praticables" % [w.zone_names[zi], area])
	print("j39 : %d cases libres, %d en poches inaccessibles, %d composantes" % [free, pocket, (comp["sizes"] as Array).size() - 1])
	t.check(pocket < free * 0.01, "poches inaccessibles : %d cases sur %d (< 1 %%)" % [pocket, free])
	# portes ouvertes : tout est relié
	var w2 := AlpineMap.load_map()
	w2.open_all_doors()
	var l0 := w2.nav.label_of(w2.nav.nearest_free(w2.start_pos.x, w2.start_pos.z))
	var apart := 0
	for i in w2.nav.blocked.size():
		if w2.nav.blocked[i] == 0 and w2.nav.zone[i] != 255 and w2.nav.label_of(i) != l0:
			apart += 1
	t.check(apart == 0, "portes ouvertes : toutes les cases des zones sont reliées au départ (%d à part)" % apart)
	for zi in w2.zone_names.size():
		t.check(w2.is_zone_open(zi), "portes ouvertes : zone %s ouverte" % w2.zone_names[zi])
	# champ de flux : depuis le fond de la carte (lac) jusqu'au départ, portes ouvertes
	w2.nav.compute_field([w2.start_pos])
	var far := w2.nav.nearest_free(-95.0, 108.0)
	t.check(far >= 0 and w2.nav.dist[far] < NavGrid.INF_D, "champ de flux : le lac gelé rejoint la place (coût %d)" % (w2.nav.dist[far] if far >= 0 else -1))

# ------------------------------------------------------------------ collision : on ne traverse pas
func _push(w: World, from: Vector2, to: Vector2) -> Vector2:
	var p := Vector3(from.x, 0.0, from.y)
	var dir := (to - from).normalized()
	for _i in int(from.distance_to(to) / 0.1) + 20:
		p.x += dir.x * 0.1
		p.z += dir.y * 0.1
		p = w.collision.resolve(p, 0.4)
	return Vector2(p.x, p.z)

func _crosses(w: World, a: Vector2, b: Vector2) -> bool:
	var e := _push(w, a, b)
	return e.distance_to(b) < e.distance_to(a)

func _collision(t: Node, w: World) -> void:
	var D := AlpineMap.data()
	var walls_tested := 0
	var crossed := 0
	for wl: Dictionary in D["walls"]:
		var a := Vector2(float(wl["a"][0]), float(wl["a"][1]))
		var b := Vector2(float(wl["b"][0]), float(wl["b"][1]))
		if a.distance_to(b) < 1.0:
			continue
		var tg := (b - a).normalized()
		var n := Vector2(-tg.y, tg.x)
		for f in [0.25, 0.5, 0.75]:
			var m := a.lerp(b, f)
			for s in [-1.0, 1.0]:
				var p0: Vector2 = m + n * s * 1.6
				var p1: Vector2 = m - n * s * 1.6
				if w.nav.is_blocked_at(p0.x, p0.y):
					continue
				walls_tested += 1
				if _crosses(w, p0, p1):
					crossed += 1
					if crossed < 6:
						t.check(false, "mur %s traversé en (%.1f ; %.1f)" % [wl["k"], m.x, m.y])
	print("j39 : %d essais de traversée des murs, %d réussis" % [walls_tested, crossed])
	t.check(walls_tested > 120 and crossed == 0, "murs : %d essais de traversée, %d réussis" % [walls_tested, crossed])
	var solids_crossed := 0
	for so: Dictionary in D["solids"]:
		var c := Vector2(float(so["x"]), float(so["z"]))
		for dir: Vector2 in [Vector2(1, 0), Vector2(0, 1)]:
			var ext := (float(so["w"]) if dir.x != 0.0 else float(so["d"])) / 2.0 + 1.5
			var p0 := c - dir * ext
			var p1 := c + dir * ext
			if not w.nav.is_blocked_at(p0.x, p0.y) and _push(w, p0, p1).distance_to(c) < 1.0:
				solids_crossed += 1
	t.check(solids_crossed == 0, "chalets : on ne rentre pas dans un bâtiment plein (%d)" % solids_crossed)
	# portes : fermées, on ne passe pas ; ouvertes, on passe
	var w2 := AlpineMap.load_map()
	for d: Dictionary in w2.doors:
		var p: Array = d["points"]
		var a := Vector2(p[0][0], p[0][1])
		var b := Vector2(p[p.size() - 1][0], p[p.size() - 1][1])
		var m := (a + b) / 2.0
		var tg := (b - a).normalized()
		var n := Vector2(-tg.y, tg.x)
		t.check(not _crosses(w2, m + n * 2.0, m - n * 2.0) and not _crosses(w2, m - n * 2.0, m + n * 2.0), "porte %d fermée : infranchissable" % int(d["id"]))
		w2.open_door(int(d["id"]))
		t.check(_crosses(w2, m + n * 2.0, m - n * 2.0) and _crosses(w2, m - n * 2.0, m + n * 2.0), "porte %d ouverte : on passe" % int(d["id"]))
	# bâtiments visitables : on entre par leurs ouvertures (hôtel : porte est ; église : portail ; gare : baie sud ; refuge : porte nord)
	for e: Array in [[Vector2(90.0, -14.0), Vector2(80.0, -14.0), "hôtel (porte de la terrasse)"], [Vector2(-70.0, 0.0), Vector2(-80.0, 0.0), "église (portail)"],
			[Vector2(3.0, -88.0), Vector2(3.0, -96.0), "gare (baie sud)"], [Vector2(-53.0, 52.0), Vector2(-53.0, 60.0), "refuge (porte nord)"]]:
		t.check(_crosses(w, e[0], e[1]), "on entre dans %s" % e[2])

# ------------------------------------------------------------------ apparitions
func _spawns(t: Node, w: World) -> void:
	t.check(int(w.objects["windowsDropped"]) == 0, "toutes les fenêtres du plan sont valides (%d écartées)" % int(w.objects["windowsDropped"]))
	var per := {}
	for i in w.window_count():
		var o := w.window_outside(i)
		var zi := w.zone_of(o.x, o.z)
		per[zi] = int(per.get(zi, 0)) + 1
		var c := w.window_center(i)
		var n := w.window_normal(i)
		var dist_wall := w.collision.ray_hit(o.x, 1.0, o.z, -n.x, 0.0, -n.y, 3.0)
		t.check(dist_wall > 0.5 and dist_wall < 1.3, "fenêtre %d : un mur juste derrière l'arrivée (%.2f m)" % [i, dist_wall])
		t.check(absf(Vector2(c.x - o.x, c.z - o.z).length() - 1.1) < 1e-3, "fenêtre %d : arrivée à 1,1 m" % i)
	print("j39 : fenêtres par zone %s" % [per])
	for zi in w.zone_names.size():
		t.check(int(per.get(zi, 0)) >= 4, "zone %s : %d fenêtres d'apparition" % [w.zone_names[zi], int(per.get(zi, 0))])
	var rng := RandomNumberGenerator.new()
	rng.seed = 39
	var got := 0
	var bad := 0
	for k in 200:
		var g := w.pick_ground(w.start_pos.x, w.start_pos.z, 8.0, 40.0, rng)
		if g == Vector3.INF:
			continue
		got += 1
		if w.zone_of(g.x, g.z) != w.start_zone or w.nav.is_blocked_at(g.x, g.z):
			bad += 1
	t.check(got > 150 and bad == 0, "apparitions au sol : %d trouvées, %d hors de la zone ouverte" % [got, bad])
	var wi := w.pick_window(w.start_pos.x, w.start_pos.z, 5.0, 60.0, 0.0, rng)
	t.check(wi >= 0 and w.zone_of(w.window_outside(wi).x, w.window_outside(wi).z) == w.start_zone, "fenêtre tirée dans la zone de départ")

# ------------------------------------------------------------------ accès aux machines
func _reachable(w: World, p: Vector2, zone: int, r := 2.2) -> bool:
	var nav := w.nav
	for dz in range(-4, 5):
		for dx in range(-4, 5):
			var x := p.x + dx * 0.5
			var z := p.y + dz * 0.5
			if Vector2(x, z).distance_to(p) > r:
				continue
			var ix := nav.cx(x)
			var iz := nav.cz(z)
			if nav.inside(ix, iz) and nav.blocked[nav.idx(ix, iz)] == 0 and int(nav.zone[nav.idx(ix, iz)]) == zone:
				return true
	return false

func _reach(t: Node, w: World) -> void:
	for m: Dictionary in w.objects["machines"]:
		var p := Vector2(float(m["pos"]["x"]), float(m["pos"]["z"]))
		var fwd := Vector2(sin(float(m["yaw"])), cos(float(m["yaw"])))
		var zi := int(m["zone"])
		t.check(zi >= 0, "machine %s %s : dans une zone" % [m["type"], m["id"]])
		t.check(_reachable(w, p + fwd * 1.3, zi, 1.2), "machine %s %s (%.0f ; %.0f) : on se tient devant (zone %d)" % [m["type"], m["id"], p.x, p.y, zi])
	for ww: Dictionary in w.objects["wallWeapons"]:
		var p := Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"]))
		t.check(int(ww["zone"]) >= 0 and _reachable(w, p, int(ww["zone"]), 1.0), "arme murale %s : point d'interaction atteignable" % ww["id"])
	var walls := ShopPlaces.walls(w)
	for e: Dictionary in walls:
		t.check(bool(e["found"]) and not bool(e["posts"]), "arme murale %s : accrochée à un mur (%.2f m)" % [e["id"], float(e.get("wall_d", -1.0))])
	for s: Dictionary in w.objects["stations"]:
		t.check(int(s["zone"]) >= 0 and _reachable(w, Vector2(float(s["x"]), float(s["z"])), int(s["zone"]), 1.8), "borne (%.0f ; %.0f) atteignable" % [float(s["x"]), float(s["z"])])

func _settings(t: Node) -> void:
	t.check(Settings.MAPS.has("alpine") and Settings.MAPS[0] == "strasbourg", "réglage de carte : Strasbourg, station alpine, arène")
	var st := Settings.new("user://test_j39_settings.cfg")
	st.autosave = false
	t.check(st.get_value("map") == "strasbourg", "carte par défaut : Strasbourg")
	st.set_value("map", "alpine")
	t.check(st.get_value("map") == "alpine", "réglage map = alpine")
	t.check(GameStats.MODES.has("alpine"), "records à part pour la station")

# ------------------------------------------------------------------ partie : portes, apparitions, véhicules, finale
func _new(seed_value: int, mode := GameMode.CLASSIC) -> void:
	Game.mode = mode
	Game.new_game(seed_value, "alpine", Config.at("startWeapons", []))
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9

func _game_doors(t: Node) -> void:
	_new(7)
	t.check(Game.world != null and Game.world.map_id == "alpine" and Game.map_name == "alpine", "partie sur la station")
	t.check(Game.finale is AlpineFinale and Game.rides != null and Game.machines != null, "finale alpine, véhicules, machines")
	t.check(Game.player.pos.distance_to(Game.world.start_pos) < 0.01, "départ sur la place")
	Game.points = 0
	var opened := 0
	var progress := true
	while progress:
		progress = false
		for d: Dictionary in Game.world.doors:
			if d["open"] or not Game.world.is_zone_open(int(d["a"])):
				continue
			var p: Array = d["points"]
			var a := Vector2(p[0][0], p[0][1])
			var b := Vector2(p[p.size() - 1][0], p[p.size() - 1][1])
			var m := (a + b) / 2.0
			var tg := (b - a).normalized()
			var n := Vector2(-tg.y, tg.x)
			var side := m + n * 1.2
			if Game.world.zone_of(side.x, side.y) != int(d["a"]):
				side = m - n * 1.2
			Game.player.pos = Vector3(side.x, 0.0, side.y)
			Game.points = int(d["price"]) - 1
			t.check(Game.use_door() == -1 and not d["open"], "porte %d : refusée à %d points" % [int(d["id"]), Game.points])
			Game.points = int(d["price"])
			t.check(Game.use_door() == int(d["id"]) and Game.points == 0, "porte %d : achetée %d points" % [int(d["id"]), int(d["price"])])
			opened += 1
			progress = true
	var all_open := true
	for zi in Game.world.zone_names.size():
		all_open = all_open and Game.world.is_zone_open(zi)
	t.check(opened == 7 and all_open, "les 7 portes achetées depuis le départ ouvrent les 6 zones")

func _game_spawns(t: Node) -> void:
	_new(11)
	var outside := 0
	var near := 0
	var spawned := 0
	for i in 60 * 45:
		Game.step(DT, IDLE)
		for z in Game.zombies:
			if z.dead:
				continue
			if z.spawn_elapsed < DT * 1.5 and z.spawn_t > 0.0:
				spawned += 1
			var zi := Game.world.zone_of(z.pos.x, z.pos.z)
			if z.spawn_t <= 0.0 and zi != Game.world.start_zone:
				outside += 1
			if Vector2(z.pos.x - Game.player.pos.x, z.pos.z - Game.player.pos.z).length() < 2.5:
				near += 1
	print("j39 : partie de 45 s : manche %d, %d zombies, %d pas au contact du joueur" % [Game.director.round_number, Game.zombies.size(), near])
	t.check(Game.director.round_number >= 1 and Game.zombies.size() > 0, "partie : des zombies apparaissent (%d)" % Game.zombies.size())
	t.check(outside == 0, "partie : les zombies restent dans la zone ouverte (%d pas hors zone)" % outside)
	t.check(near > 0, "partie : les zombies rejoignent le joueur sur la place")

func _rides(t: Node) -> void:
	_new(3)
	t.check(Game.rides.trams.is_empty() and Game.rides.bike_stations.is_empty(), "pas de tram ni de vélos sur la station")
	t.check(Game.rides.vehicles.size() == 2, "deux motoneiges")
	for v in Game.rides.vehicles:
		t.check(String(v.def["name"]) == "MOTONEIGE" and String(v.def.get("model", "")) == "motoneige", "véhicule %d : motoneige" % v.id)
		t.check(Game.world.zone_of(v.pos.x, v.pos.z) >= 0 and not Game.world.nav.is_blocked_at(v.pos.x, v.pos.z), "motoneige %d : garée sur une case libre" % v.id)
	t.check(String(Config.at("vehicles.types.grosseMoto.name")) == "GROSSE MOTO", "Config intacte (grosse moto de Strasbourg)")
	# on monte, on roule tout droit vers le sud (sortie de la remise), on descend
	var v: VehicleSim = Game.rides.vehicles[0]
	Game.world.open_all_doors()
	Game.player.pos = Vector3(v.pos.x + 1.0, 0.0, v.pos.z + 1.2)
	Game.interact()
	t.check(Game.rides.ride != null and Game.rides.ride["v"] == v, "on monte sur la motoneige")
	var p0 := v.pos
	for i in 120:
		Game.step(DT, {"mx": 0.0, "mz": -1.0})
	print("j39 : motoneige : %.1f m en 2 s" % v.pos.distance_to(p0))
	t.check(v.pos.distance_to(p0) > 3.0, "la motoneige avance (%.1f m)" % v.pos.distance_to(p0))

func _finale(t: Node) -> void:
	_new(5)
	var F: AlpineFinale = Game.finale
	t.check(not F.is_ready() and F.prompt().contains("manche 10"), "cloche : pas prête au départ (%s)" % F.prompt())
	t.check(not F.use_clock() and not F.active(), "cloche : refusée")
	Game.world.open_all_doors()
	Game.director.round_number = 10
	t.check(F.is_ready() and F.prompt().begins_with("E "), "cloche : prête (manche 10, 6 zones)")
	t.check(F.use_clock() and F.active() and F.state() == "intro", "la Nuit blanche commence")
	# vagues : on tue tout ce qui sort
	var n := 0
	while F.active() and F.state() != "boss1" and n < 60 * 240:
		Game.step(DT, IDLE)
		n += 1
		for z in Game.zombies:
			if not z.dead and not z.is_boss and z.spawn_t <= 0.0:
				Game.hit_zombie(z, true, 1.0e6, 1.0)
	t.check(F.state() == "boss1", "trois vagues jouées, le Bourreau des neiges arrive (%s)" % F.state())
	for i in 60 * 4:
		Game.step(DT, IDLE)
	var b := F.f["boss"] as BossSim
	t.check(b != null and not b.hidden_flag and b.region == 0, "le Bourreau surgit au sol")
	t.check(F.boss_bar().get("name", "") == "LE BOURREAU DES NEIGES", "barre de vie : LE BOURREAU DES NEIGES")
	var phases := {}
	var guard := 0
	while not b.dead and guard < 20000:
		guard += 1
		phases[b.phase] = true
		b.invuln = 0.0
		if b.state in ["toll", "roar", "rise", "hidden", "leap"]:
			b.state = "chase"
		Game.hit_zombie(b, false, b.max_health * 0.01, 1.0, false, {"back": true})
		Game.step(DT, IDLE)
	print("j39 : Bourreau des neiges : phases %s, %d pas" % [phases.keys(), guard])
	t.check(b.dead and phases.has(3) and phases.has(4) and not b.leaped, "le Bourreau passe les phases III et IV au sol, puis tombe (%s)" % [phases.keys()])
	for i in 60 * 6:
		Game.step(DT, IDLE)
	t.check(Game.finale_done and Game.blessed and Game.free_doors and Game.arms.has_axe, "victoire : Bénédiction de l'Aube, portes gratuites, la Hache")
	t.check(F.prompt().contains("tue"), "la cloche s'est tue")

func _modes(t: Node) -> void:
	_new(9, GameMode.TIMED)
	t.check(Game.timed != null and Game.world.map_id == "alpine", "Contre la montre sur la station")
	var clocks := 0
	for m: Dictionary in Game.machines.list:
		clocks += 1 if m["type"] == "clock" else 0
	t.check(clocks == 0, "Contre la montre : pas de cloche (pas de finale)")
	_new(9, GameMode.ARSENAL)
	t.check(Game.arsenal != null and Game.arms.inventory.size() == 1, "Arsenal aléatoire sur la station")
	_new(9, GameMode.ZONE)
	t.check(Game.gm == null and Game.world.map_id == "alpine", "Zone unique : réservée à Strasbourg (partie classique sur la station)")
