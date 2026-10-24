extends RefCounted
## J3 : zombies et IA. Golden du champ de flux (distances, steer, lignes de vue, composantes, grilles d'étage, liens d'escalier : JS exécuté sur les
## données cuites, tools/export-golden-j3.mjs), puis scénarios sur la carte de Strasbourg (poursuite autour des immeubles, enjambement, escalier,
## apparition par fenêtre et depuis le sol, variantes, relocalisation), bots de marche (stuck-scan), et banc d'essai de la boucle de simulation.

const DT := 1.0 / 60.0
const GOLDEN := "res://data/golden/j3.json"

var _rng := RandomNumberGenerator.new()

func run(t: Node) -> void:
	if not FileAccess.file_exists(GOLDEN):
		t.check(false, "golden j3 absent : lancer  node tools/export-golden-j3.mjs")
		return
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(GOLDEN))
	_rng.seed = 20260613
	var w := World.load_world()
	w.set_extras(false)        # v0.34.11 : la grille du JS, sans le mobilier ajouté (World.stamp_furniture)
	_regions(t, w, g)          # avant d'ouvrir les portes : le golden est calculé portes fermées
	_hops(t, w, g)
	_balance(t, g)
	_fields(t, w, g, false)
	_components(t, w, g, 0)
	w.open_all_doors()
	_fields(t, w, g, true)
	_components(t, w, g, 1)
	_nearest(t, w, g)
	_variants(t)
	_spawn(t)
	_chase(t)
	_vault(t)
	_stairs(t)
	_relocate(t)
	_walkers(t)
	_threaded(t)
	_bench(t, false)
	_bench(t, true)

# ------------------------------------------------------------------ champ de flux (carte)
func _fields(t: Node, w: World, g: Dictionary, open: bool) -> void:
	var nav := w.nav
	var max_cost := int(g["meta"]["maxCost"])
	var n_cases := 0
	var n_steer := 0
	var n_null := 0
	var us := 0
	var cases := 0
	for f: Dictionary in g["fields"]:
		if bool(f["open"]) != open:
			continue
		var targets: Array = []
		for p: Array in f["targets"]:
			targets.append(Vector3(p[0], 0.0, p[1]))
		nav.job_active = false
		var t0 := Time.get_ticks_usec()
		var steps := 0
		while nav.update_field(targets, 7000, max_cost):
			steps += 1
		us += Time.get_ticks_usec() - t0
		cases += 1
		var label := "champ %s #%d" % ["ouvert" if open else "fermé", cases]
		# cases atteintes et somme des distances, dans la fenêtre du champ (le reste est à INF)
		var reached := 0
		var sum := 0
		var tx := nav.cx(targets[0].x)
		var tz := nav.cz(targets[0].z)
		var rr := int(f["reached"])
		var x0 := maxi(0, tx - 260)
		var x1 := mini(nav.nx - 1, tx + 260)
		var z0 := maxi(0, tz - 260)
		var z1 := mini(nav.nz - 1, tz + 260)
		if targets.size() > 1:   # deux cibles : fenêtre autour des deux
			x0 = 0
			x1 = nav.nx - 1
			z0 = 0
			z1 = nav.nz - 1
		for iz in range(z0, z1 + 1):
			var row := iz * nav.nx
			for ix in range(x0, x1 + 1):
				var d := nav.dist[row + ix]
				if d < NavGrid.INF_D:
					reached += 1
					sum = (sum + d) % 2147483647
		t.check(reached == rr, "%s : %d cases atteintes (JS %d)" % [label, reached, rr])
		t.check(sum == int(f["sum"]), "%s : somme des distances %d (JS %d)" % [label, sum, f["sum"]])
		for c: Array in f["cells"]:
			n_cases += 1
			var want: int = NavGrid.INF_D if c[1] == null else int(c[1])
			t.check(nav.dist[int(c[0])] == want, "%s : distance de la case %d = %d (JS %d)" % [label, c[0], nav.dist[int(c[0])], want])
		for s: Array in f["steer"]:
			n_steer += 1
			var ok := nav.steer(s[0], s[1])
			if s[2] == null:
				n_null += 1
				t.check(not ok, "%s : steer (%.2f, %.2f) sans chemin" % [label, s[0], s[1]])
			else:
				t.check(ok, "%s : steer (%.2f, %.2f) a un chemin" % [label, s[0], s[1]])
				if ok:
					t.near(nav.steer_x, s[2], "%s : steer x" % label, 1e-9)
					t.near(nav.steer_z, s[3], "%s : steer z" % label, 1e-9)
		for q: Array in f["walk"]:
			var wd := nav.walk_distance(q[0], q[1])
			if q[2] == null:
				t.check(wd == INF, "%s : walkDistance sans chemin" % label)
			else:
				t.near(wd, q[2], "%s : walkDistance" % label, 1e-9)
		for q: Array in f["los"]:
			t.check(nav.los(q[0], q[1], q[2], q[3]) == bool(q[4]), "%s : los %s" % [label, q])
		for q: Array in f["clear"]:
			t.check(nav.clear(q[0], q[1], q[2], q[3]) == bool(q[4]), "%s : clear %s" % [label, q])
	print("golden j3 champ de flux (portes %s) : %d champs, %d distances, %d steer (%d sans chemin), calcul moyen %.1f ms" % ["ouvertes" if open else "fermées", cases, n_cases, n_steer, n_null, us / 1000.0 / maxf(cases, 1)])

func _nearest(t: Node, w: World, g: Dictionary) -> void:
	var n := 0
	for blk: Dictionary in g["nearest"]:
		if not bool(blk["open"]):
			continue   # le monde est maintenant ouvert : seul le jeu de cas « ouvert » est comparable
		for c: Array in blk["cases"]:
			var r := w.nav.nearest_free(c[0], c[1], int(c[2]))
			var want: int = -1 if c[3] == null else int(c[3])
			t.check(r == want, "nearestFree (%.2f, %.2f, %d) = %d (JS %d)" % [c[0], c[1], c[2], r, want])
			n += 1
	print("golden j3 nearestFree : %d cas" % n)

func _components(t: Node, w: World, g: Dictionary, which: int) -> void:
	var want: Dictionary = g["components"][which]
	var t0 := Time.get_ticks_msec()
	w.nav.invalidate()
	var c := w.nav.components()
	var ms := Time.get_ticks_msec() - t0
	var sizes: Array = c["sizes"].slice(1)
	var sorted := sizes.duplicate()
	sorted.sort()
	sorted.reverse()
	t.check(sizes.size() == int(want["count"]), "composantes (portes %s) : %d (JS %d)" % ["ouvertes" if which else "fermées", sizes.size(), want["count"]])
	for i in 8:
		t.check(sorted[i] == int(want["top"][i]), "composante n°%d : %d cases (JS %d)" % [i, sorted[i], want["top"][i]])
	var tiny := 0
	for s: int in sizes:
		if s < 20:
			tiny += 1
	t.check(tiny == int(want["tiny"]), "petites composantes : %d (JS %d)" % [tiny, want["tiny"]])
	var labels: PackedInt32Array = c["labels"]
	var sig := 0
	var csz: Array = c["sizes"]
	for i in labels.size():
		var l := labels[i]
		if l != 0:
			sig = (sig + (i % 251 + 1) * (csz[l] % 1009)) % 2147483647
	t.check(sig == int(want["sig"]), "signature des composantes %d (JS %d)" % [sig, want["sig"]])
	print("golden j3 composantes (portes %s) : %d composantes, la plus grande %d cases, %d ms" % ["ouvertes" if which else "fermées", sizes.size(), sorted[0], ms])

# ------------------------------------------------------------------ étages
func _regions(t: Node, w: World, g: Dictionary) -> void:
	var lv := w.levels
	var t0 := Time.get_ticks_msec()
	lv.build_navs(w.collision)
	var ms := Time.get_ticks_msec() - t0
	var n := 0
	for e: Dictionary in g["regions"]:
		var nav: NavGrid = lv.nav_of(int(e["region"]))
		t.check(nav != null, "grille de l'étage %d construite" % e["region"])
		if nav == null:
			continue
		n += 1
		t.check(nav.nx == int(e["nx"]) and nav.nz == int(e["nz"]), "étage %d : taille %dx%d (JS %dx%d)" % [e["region"], nav.nx, nav.nz, e["nx"], e["nz"]])
		t.near(nav.ox, e["ox"], "étage %d : origine x" % e["region"], 1e-9)
		t.near(nav.oz, e["oz"], "étage %d : origine z" % e["region"], 1e-9)
		var cnt := [0, 0, 0]
		var h := 0
		for i in nav.blocked.size():
			var b := nav.blocked[i]
			cnt[b] += 1
			h = (h + b * (1 + (i % 251))) % 2147483647
		for k in 3:
			t.check(cnt[k] == int(e["counts"][k]), "étage %d : %d cases de valeur %d (JS %d)" % [e["region"], cnt[k], k, e["counts"][k]])
		t.check(h == int(e["hash"]), "étage %d : empreinte de la grille %d (JS %d)" % [e["region"], h, e["hash"]])
		if e["field"] != null:
			var f: Dictionary = e["field"]
			var tg: Array = []
			for p: Array in f["targets"]:
				tg.append(Vector3(p[0], 0, p[1]))
			t.check(nav.compute_field(tg), "étage %d : champ calculé" % e["region"])
			var reached := 0
			var sum := 0
			for d in nav.dist:
				if d < NavGrid.INF_D:
					reached += 1
					sum = (sum + d) % 2147483647
			t.check(reached == int(f["reached"]) and sum == int(f["sum"]), "étage %d : champ %d cases, somme %d (JS %d, %d)" % [e["region"], reached, sum, f["reached"], f["sum"]])
			for c: Array in f["cells"]:
				var want: int = NavGrid.INF_D if c[1] == null else int(c[1])
				t.check(nav.dist[int(c[0])] == want, "étage %d : distance case %d" % [e["region"], c[0]])
			for s: Array in f["steer"]:
				var ok := nav.steer(s[0], s[1])
				t.check(ok == (s[2] != null), "étage %d : steer a un chemin" % e["region"])
				if ok and s[2] != null:
					t.near(nav.steer_x, s[2], "étage %d : steer x" % e["region"], 1e-9)
					t.near(nav.steer_z, s[3], "étage %d : steer z" % e["region"], 1e-9)
	t.check(n == g["regions"].size() and n >= 5, "grilles d'étage : %d" % n)
	print("golden j3 étages : %d grilles (cathédrale) construites en %d ms, champs complets égaux au JS" % [n, ms])

func _hops(t: Node, w: World, g: Dictionary) -> void:
	var lv := w.levels
	for c: Array in g["hops"]["next"]:
		var h := lv.next_hop(int(c[0]), int(c[1]))
		if c[2] == null:
			t.check(h.is_empty(), "nextHop %d->%d : aucun" % [c[0], c[1]])
		else:
			# deux escaliers de même longueur à 1 ulp près (tours jumelles) : le JSON lu par Godot peut arrondir un chiffre autrement, on accepte l'un ou l'autre
			var tie := not h.is_empty() and absf(float(h["link"]["length"]) - float(lv.links[int(c[2])]["length"])) < 1e-9
			t.check(not h.is_empty() and (int(h["link"]["id"]) == int(c[2]) or tie) and int(h["dir"]) == int(c[3]) and int(h["next"]) == int(c[4]), "nextHop %d->%d" % [c[0], c[1]])
	for c: Array in g["hops"]["dist"]:
		var d := lv.hop_distance(int(c[0]), int(c[1]))
		if c[2] == null:
			t.check(d == INF, "hopDistance %d->%d infinie" % [c[0], c[1]])
		else:
			t.near(d, c[2], "hopDistance %d->%d" % [c[0], c[1]], 1e-9)
	for c: Dictionary in g["links"]:
		var L: Dictionary = lv.links[int(c["link"])]
		t.near(lv.project(L, c["x"], c["z"], c["y"]), c["project"], "project lien %d" % c["link"], 1e-9)
		var er := lv.end_region(int(c["regionArg"]), c["x"], c["z"], c["y"])
		t.check(er == int(c["end"]), "endRegion lien %d région %d : %d (JS %d, s=%.4f, moitié %.4f)" % [c["link"], c["regionArg"], er, c["end"], c["project"], float(L["length"]) / 2.0])
	var o := {}
	for c: Array in g["pointOn"]:
		lv.point_on(lv.links[int(c[0])], c[1], o)
		t.near(o["x"], c[2], "pointOn x", 1e-9)
		t.near(o["y"], c[3], "pointOn y", 1e-9)
		t.near(o["z"], c[4], "pointOn z", 1e-9)
		t.near(o["yaw"], c[5], "pointOn yaw", 1e-9)
	print("golden j3 escaliers : %d nextHop, %d hopDistance, %d project, %d pointOn" % [g["hops"]["next"].size(), g["hops"]["dist"].size(), g["links"].size(), g["pointOn"].size()])

func _balance(t: Node, g: Dictionary) -> void:
	Game.new_game(1, "arena")
	var n := 0
	for c: Dictionary in g["balance"]:
		t.near(float(Config.at("zombie.spawnBalance.radius")), c["radius"], "rayon d'équilibrage", 1e-12)
		var pool: Array[PlayerSim] = []
		for p: Array in c["players"]:
			var ps := PlayerSim.new()
			ps.pos = Vector3(p[0], 0, p[1])
			pool.append(ps)
		Game.zombies.clear()
		for zp: Array in c["zombies"]:
			var z := ZombieSim.new()
			z.pos = Vector3(zp[0], 0, zp[1])
			Game.zombies.append(z)
		var wts := Game.spawn_weights(pool)
		for i in wts.size():
			t.near(wts[i], c["weights"][i], "poids d'apparition", 1e-6)
			n += 1
	Game.zombies.clear()
	# tirage : un joueur sans zombie proche est tiré bien plus souvent qu'un joueur entouré
	var a := PlayerSim.new()
	a.pos = Vector3(0, 0, 0)
	var b := PlayerSim.new()
	b.pos = Vector3(500, 0, 0)
	for i in 10:
		var z := ZombieSim.new()
		z.pos = Vector3(i, 0, 0)
		Game.zombies.append(z)
	var pool2: Array[PlayerSim] = [a, b]
	var hits_b := 0
	for i in 1000:
		if Game.spawn_target(pool2) == b:
			hits_b += 1
	t.check(hits_b > 850, "spawnBalance : le joueur isolé reçoit la plupart des zombies (%d / 1000, attendu ~917)" % hits_b)
	Game.zombies.clear()
	print("golden j3 spawnBalance : %d poids, tirage du joueur isolé %d / 1000" % [n, hits_b])

# ------------------------------------------------------------------ scénarios
## Partie de Strasbourg sans manches (les zombies sont posés à la main), portes ouvertes, joueur invulnérable.
func _scenario(seed_value: int, at: Vector3 = Vector3.INF) -> void:
	Game.new_game(seed_value, "strasbourg")
	Game.world.open_all_doors()
	Game.director.intermission = 1.0e9
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	if at != Vector3.INF:
		Game.player.pos = at
	Game.env.nav.invalidate()

func _make_zombie(p: Vector3, spd: float) -> ZombieSim:
	var z := ZombieSim.new()
	z.id = Game._next_id
	Game._next_id += 1
	z.rng = Game.rng
	z.pos = p
	z.speed = spd
	z.health = 1.0e9
	z.max_health = 1.0e9
	z.limp = false
	Game.zombies.append(z)
	return z

## Calcule d'un coup le champ autour du joueur (pour choisir des positions de départ).
func _full_field() -> NavGrid:
	var nav := Game.env.nav
	nav.job_active = false
	var F: Dictionary = Config.at("zombie.flow")
	while nav.update_field(Game.field_targets(0), 1 << 30, roundi(float(F["range"]) / nav.cell * 10.0)):
		pass
	return nav

func _chase(t: Node) -> void:
	_scenario(31)
	var nav := _full_field()
	var p := Game.player.pos
	var cands: Array[Vector3] = []
	var tx := nav.cx(p.x)
	var tz := nav.cz(p.z)
	for _try in 400000:
		var ix := tx + _rng.randi_range(-200, 200)
		var iz := tz + _rng.randi_range(-200, 200)
		if not nav.inside(ix, iz):
			continue
		var d := nav.dist[nav.idx(ix, iz)]
		if d >= NavGrid.INF_D or nav.blocked[nav.idx(ix, iz)] != 0:
			continue
		var walk := d / 10.0 * nav.cell
		var x := nav.world_x(ix)
		var z := nav.world_z(iz)
		var eu := Vector2(x - p.x, z - p.z).length()
		if walk < 60.0 or walk > 140.0 or eu > 0.75 * walk:
			continue
		var q := Game.collision.resolve(Vector3(x, 0, z), 0.4)
		if Vector2(q.x - x, q.z - z).length() > 0.05:
			continue
		var far_enough := true
		for c in cands:
			if Vector2(c.x - x, c.z - z).length() < 12.0:
				far_enough = false
		if far_enough:
			cands.append(Vector3(x, 0, z))
		if cands.size() >= 12:
			break
	t.check(cands.size() >= 8, "poursuite : %d départs derrière des immeubles" % cands.size())
	var zs: Array[ZombieSim] = []
	var walks: Array[float] = []
	for c in cands:
		zs.append(_make_zombie(c, 2.4))
		walks.append(nav.walk_distance(c.x, c.z))
	var arrive: Array[float] = []
	arrive.resize(zs.size())
	arrive.fill(-1.0)
	var vaulted := 0
	var seen_vault := {}
	var worst_stall := 0.0
	var limit := 240.0
	var frames := 0
	while frames < int(limit * 60.0):
		Game.step(DT, {})
		frames += 1
		var all := true
		for i in zs.size():
			var z := zs[i]
			if not z.vault.is_empty() and not seen_vault.has(z.id):
				seen_vault[z.id] = true
				vaulted += 1
			worst_stall = maxf(worst_stall, z.no_progress)
			if arrive[i] < 0.0:
				if Vector2(z.pos.x - p.x, z.pos.z - p.z).length() < 1.6:
					arrive[i] = frames * DT
				else:
					all = false
		if all:
			break
	var maxratio := 0.0
	var sumratio := 0.0
	var n_arrived := 0
	for i in zs.size():
		var tt := arrive[i]
		t.check(tt > 0.0, "poursuite #%d : le zombie à %.0f m de marche (%.0f m à vol d'oiseau) atteint le joueur" % [i, walks[i], Vector2(cands[i].x - p.x, cands[i].z - p.z).length()])
		if tt > 0.0:
			n_arrived += 1
			var ratio := tt * 2.4 / walks[i]   # 1 = chemin parfait
			maxratio = maxf(maxratio, ratio)
			sumratio += ratio
			t.check(ratio < 1.8, "poursuite #%d : détour raisonnable (temps x vitesse / marche = %.2f)" % [i, ratio])
	print("poursuite autour des immeubles : %d / %d arrivés, détour moyen x%.2f (pire x%.2f), %d enjambements, pire no_progress %.1f s, %.0f s simulées" % [n_arrived, zs.size(), sumratio / maxf(n_arrived, 1), maxratio, vaulted, worst_stall, frames * DT])

func _vault(t: Node) -> void:
	# cherche un obstacle enjambable que le champ de flux traverse (les chemins plus longs que 40 sont coupés par-dessus) et y envoie un zombie
	_scenario(32)
	var nav := Game.env.nav
	var found := 0
	var tested := 0
	var succeeded := 0
	var vault_events := 0
	var vcells: Array[int] = []
	for i in nav.blocked.size():
		if nav.blocked[i] == 2:
			vcells.append(i)
	t.check(vcells.size() > 1000, "des cases enjambables dans la grille (%d)" % vcells.size())
	var N := 5
	for _try in 20000:
		if succeeded >= 3 or tested >= 12:
			break
		var v := vcells[_rng.randi_range(0, vcells.size() - 1)]
		var vx := v % nav.nx
		var vz := v / nav.nx
		# deux cases libres de part et d'autre (axe x ou z) ; entre les deux, seulement du libre ou de l'enjambable
		var axis := _rng.randi_range(0, 1)
		var dx := 1 if axis == 0 else 0
		var dz := 1 - dx
		if not nav.inside(vx - N * dx, vz - N * dz) or not nav.inside(vx + N * dx, vz + N * dz):
			continue
		var line_cost := 0
		var ok := true
		for k in range(-N, N + 1):
			var b := nav.blocked[nav.idx(vx + k * dx, vz + k * dz)]
			if (absi(k) == N and b != 0) or b == 1:
				ok = false
				break
			line_cost += 40 if b == 2 else 10
		if not ok:
			continue
		line_cost -= 10   # la case du zombie n'est pas payée
		if not Game.world.is_zone_open(nav.zone_of(nav.world_x(vx), nav.world_z(vz))):
			continue
		var pa := Vector3(nav.world_x(vx - N * dx), 0, nav.world_z(vz - N * dz))
		var pb := Vector3(nav.world_x(vx + N * dx), 0, nav.world_z(vz + N * dz))
		var qa := Game.collision.resolve(pa, 0.4)
		var qb := Game.collision.resolve(pb, 0.4)
		if Vector2(qa.x - pa.x, qa.z - pa.z).length() > 0.05 or Vector2(qb.x - pb.x, qb.z - pb.z).length() > 0.05:
			continue
		var ud := (pb - pa).normalized()
		var hv := Game.collision.find_vault(pa.x, pa.z, ud.x, ud.z, 8.0)
		if hv.is_empty() or float(hv["tOut"]) - float(hv["tIn"]) > Rules.VAULT_MAX_PASS or float(hv["tOut"]) > pa.distance_to(pb) - 0.5:
			continue   # la ligne ne rencontre pas vraiment l'obstacle (seulement sa marge)
		# le joueur est en b, le zombie en a : le champ doit passer par-dessus l'obstacle
		Game.zombies.clear()
		Game.player.pos = pb
		Game.player.vel = Vector3.ZERO
		nav.job_active = false
		nav.update_field([pb], 1 << 30, 800)
		if not _path_crosses_vault(nav, nav.idx(vx - N * dx, vz - N * dz)):
			continue   # un détour est moins cher : il contourne
		found += 1
		tested += 1
		var z := _make_zombie(pa, 2.0)
		z.yaw = atan2(pb.x - pa.x, pb.z - pa.z)
		var vaulted := false
		var reached := false
		for f in 60 * 12:
			Game.step(DT, {})
			if not z.vault.is_empty():
				vaulted = true
			if Vector2(z.pos.x - pb.x, z.pos.z - pb.z).length() < 1.6:
				reached = true
				break
		if vaulted:
			vault_events += 1
		if reached:
			succeeded += 1
	t.check(found >= 3, "enjambement : %d obstacles franchissables trouvés" % found)
	t.check(succeeded >= 2, "enjambement : %d zombies sur %d atteignent le joueur de l'autre côté (%d ont sauté)" % [succeeded, tested, vault_events])
	t.check(vault_events >= 1, "enjambement : au moins un saut observé (%d)" % vault_events)
	print("enjambement : %d obstacles essayés, %d franchis, %d sauts observés" % [tested, succeeded, vault_events])

## La plus forte pente du champ depuis la case `from` traverse-t-elle une case enjambable ?
func _path_crosses_vault(nav: NavGrid, from: int) -> bool:
	var cur := from
	for _i in 200:
		var d := nav.dist[cur]
		if d == 0 or d >= NavGrid.INF_D:
			return false
		var best := d
		var nxt := -1
		for o in [-1, 1, -nav.nx, nav.nx, -nav.nx - 1, -nav.nx + 1, nav.nx - 1, nav.nx + 1]:
			var j: int = cur + o
			if j >= 0 and j < nav.dist.size() and nav.dist[j] < best:
				best = nav.dist[j]
				nxt = j
		if nxt < 0:
			return false
		if nav.blocked[nxt] == 2:
			return true
		cur = nxt
	return false

func _stairs(t: Node) -> void:
	# le joueur monte au Triforium (région 1) : le zombie du sol prend l'escalier pour l'y rejoindre
	_scenario(33)
	var lv := Game.world.levels
	var link: Dictionary = lv.links[0]
	t.check(int(link["a"]) == 0 and int(link["b"]) == 1, "lien 0 : sol -> étage 1")
	var spawn: Array = lv.regions[1]["spawns"][0]
	var path: Array = link["path"]
	var foot: Array = path[0]
	Game.player.pos = Vector3(spawn[0], float(lv.regions[1]["y"]), spawn[1])
	Game.player.vel = Vector3.ZERO
	var z := _make_zombie(Vector3(foot[0] + 3.0, 0, foot[2]), 2.4)
	var used_link := false
	var reached := false
	var reg_seen := {}
	var t_reach := 0.0
	for f in 60 * 90:
		Game.step(DT, {})
		if not z.link.is_empty():
			used_link = true
		reg_seen[z.region] = true
		if f == 5:
			t.check(Game.player.region == 1 and Game.player.tregion == 1, "le joueur est à l'étage 1 (région %d, utile %d)" % [Game.player.region, Game.player.tregion])
		if z.region == 1 and Vector3(z.pos.x - Game.player.pos.x, 0, z.pos.z - Game.player.pos.z).length() < 1.8 and absf(z.pos.y - Game.player.pos.y) < 1.0:
			reached = true
			t_reach = f * DT
			break
	t.check(used_link, "escalier : le zombie emprunte le lien")
	t.check(z.region == 1 or reached, "escalier : le zombie arrive à l'étage 1 (région %d)" % z.region)
	t.check(reached, "escalier : le zombie rejoint le joueur à l'étage (%.1f s, y = %.1f)" % [t_reach, z.pos.y])
	print("escalier : le zombie monte au Triforium et atteint le joueur en %.1f s (régions vues %s)" % [t_reach, reg_seen.keys()])
	# et il redescend si le joueur est redescendu
	Game.player.pos = Vector3(foot[0] + 12.0, 0, foot[2])
	Game.player.vel = Vector3.ZERO
	var back := false
	for f in 60 * 90:
		Game.step(DT, {})
		if z.region == 0 and z.link.is_empty() and Vector2(z.pos.x - Game.player.pos.x, z.pos.z - Game.player.pos.z).length() < 1.8:
			back = true
			break
	t.check(back, "escalier : le zombie redescend rejoindre le joueur au sol")

func _spawn(t: Node) -> void:
	Game.new_game(41, "strasbourg")
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	var events := {}
	Game.zombie_event.connect(func(_z, n): events[n] = int(events.get(n, 0)) + 1)
	var win := 0
	var gnd := 0
	var spawned: Array[ZombieSim] = []
	Game.zombie_spawned.connect(func(z): spawned.append(z))
	for f in 60 * 40:
		Game.step(DT, {})
		if Game.director.round_number >= 1 and spawned.size() >= 6:
			break
	for z in spawned:
		if z.spawn_type == "window":
			win += 1
		elif z.spawn_type == "ground":
			gnd += 1
	t.check(spawned.size() >= 4, "apparitions : %d zombies" % spawned.size())
	t.check(win > 0, "apparitions : au moins une par une fenêtre (%d fenêtres, %d sol)" % [win, gnd])
	t.check(int(events.get("knock", 0)) > 0 and int(events.get("glass", 0)) > 0, "apparitions : ça cogne puis la vitre casse (%s)" % events)
	# chronologie d'une apparition par fenêtre et d'une depuis le sol, rejouées à la main
	var env := Game.env
	var zw := ZombieSim.new()
	zw.id = 500
	zw.start_window_spawn(Vector3(10, 0, 10), Vector3(10, 0, 12), Vector3(10, 1.5, 11), Vector2(0, 1), 0.0, 3)
	t.check(not zw.targetable(), "fenêtre : pas touchable au départ")
	var t_target := -1.0
	var elapsed := 0.0
	var evs: PackedStringArray = PackedStringArray()
	while zw.spawn_t > 0.0 and elapsed < 10.0:
		zw.step(DT, env)
		evs.append_array(zw.events)
		zw.events.clear()
		elapsed += DT
		if t_target < 0.0 and zw.targetable():
			t_target = elapsed
	t.near(elapsed, Rules.WIN_WARN + Rules.WIN_CLIMB, "fenêtre : apparition en %.2f s" % elapsed, 0.02)
	t.near(t_target, Rules.WIN_WARN + Rules.WIN_CLIMB * Rules.WIN_HIT_AT, "fenêtre : touchable à %.2f s" % t_target, 0.02)
	t.check(evs.count("glass") == 1 and evs.count("knock") >= 3, "fenêtre : %d coups, 1 vitre (%s)" % [evs.count("knock"), evs])
	t.check(zw.pos.is_equal_approx(Vector3(10, 0, 12)), "fenêtre : il finit devant la façade (%s)" % zw.pos)
	var zg := ZombieSim.new()
	zg.id = 501
	zg.start_ground_spawn(Vector3(30, 0, 30), 1.0)
	elapsed = 0.0
	evs = PackedStringArray()
	var min_y := 0.0
	while zg.spawn_t > 0.0 and elapsed < 10.0:
		zg.step(DT, env)
		evs.append_array(zg.events)
		zg.events.clear()
		elapsed += DT
		min_y = minf(min_y, zg.pos.y)
	t.near(elapsed, Rules.GND_DELAY + Rules.GND_RISE, "sol : apparition en %.2f s" % elapsed, 0.02)
	t.check(evs.count("rumble") == 1 and evs.count("emerge") == 1, "sol : la terre tremble puis il sort (%s)" % evs)
	t.check(min_y < -1.0 and absf(zg.pos.y) < 1e-6, "sol : il remonte de %.2f m à 0" % min_y)
	print("apparitions : %d zombies (%d fenêtres, %d sol), évènements %s" % [spawned.size(), win, gnd, events])

func _variants(t: Node) -> void:
	var z := ZombieSim.new()
	z.id = 7
	z.speed = 2.0
	z.make_crawler()
	t.near(z.speed, 2.0 * Rules.CRAWLER_SPEED, "rampant : vitesse x 0,45", 1e-9)
	var k := ZombieSim.new()
	k.id = 8
	k.speed = 2.0
	k.health = 100.0
	k.make_kind("armored")
	t.near(k.speed, 1.6, "chevalier : vitesse x 0,8", 1e-9)
	k.damage(40.0, false)
	t.near(k.health, 80.0, "chevalier : dégâts x 0,5", 1e-9)
	var b := ZombieSim.new()
	b.id = 9
	b.speed = 2.0
	b.make_kind("bloat")
	t.check(b.explodes and absf(b.speed - 1.4) < 1e-9, "pestiféré : explose, vitesse x 0,7")
	# explosion : 38 x (1 - d / 5) à moins de 4,2 m
	_scenario(34)
	var pb := Game.player.pos + Vector3(2.0, 0, 0)
	var zb := _make_zombie(pb, 1.0)
	zb.make_kind("bloat")
	zb.health = 10.0
	Game.player.max_health = 100.0
	Game.player.health = 100.0
	Game.hit_zombie(zb, false, 50.0, 1.0)
	t.check(zb.dead, "pestiféré tué")
	t.near(Game.player.health, 100.0 - 38.0 * (1.0 - 2.0 / 5.0), "explosion à 2 m : 38 x (1 - 2/5) dégâts", 1e-6)
	var zf := _make_zombie(Game.player.pos + Vector3(6.0, 0, 0), 1.0)
	zf.make_kind("bloat")
	zf.health = 10.0
	var hp := Game.player.health
	Game.hit_zombie(zf, false, 50.0, 1.0)
	t.near(Game.player.health, hp, "explosion à 6 m : sans effet", 1e-9)
	# tir sur un rampant : la boîte de touche est basse (un tir à 1,5 m de haut passe au-dessus)
	var zc := ZombieSim.new()
	zc.id = 10
	zc.pos = Vector3(0, 0, 5)
	zc.make_crawler()
	zc.yaw = 0.0
	t.check(Hitscan.ray_zombie(Vector3(0, 1.5, 0), Vector3(0, 0, 1), 20.0, zc).is_empty(), "rampant : un tir à 1,5 m passe au-dessus")
	t.check(not Hitscan.ray_zombie(Vector3(0, 0.3, 0), Vector3(0, 0, 1), 20.0, zc).is_empty(), "rampant : un tir à 0,3 m touche")
	# apparition des variantes dans une partie : chevalier à partir de la manche 8 dans la zone de l'Homme de Fer, pestiféré à partir de 10
	Game.new_game(42, "strasbourg")
	Game.world.open_all_doors()
	var zi := Game.world.zone_names.find("Homme de Fer")
	t.check(zi >= 0, "la zone « Homme de Fer » existe")
	var cz: Dictionary = Game.world.objects["zones"][zi]["center"]
	Game.player.pos = Vector3(cz["x"], 0, cz["z"])
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	Game.director.round_number = 9
	Game.director.start_round()   # manche 10
	Game.director.to_spawn = 400
	Game.director.spawn_timer = 0.0
	var kinds := {"": 0, "armored": 0, "bloat": 0}
	var crawlers := 0
	var runners := 0
	for i in 400:
		Game._spawn_zombie()
	for zz in Game.zombies:
		kinds[zz.kind] = int(kinds.get(zz.kind, 0)) + 1
		if zz.crawler:
			crawlers += 1
		if zz.runner:
			runners += 1
	# les chevaliers ne dépassent jamais maxAlive (3) ; les rampants et coureurs existent dans les proportions de CONFIG
	t.check(int(kinds["armored"]) <= int(Config.at("zombie.ironKnight.maxAlive")), "chevaliers : au plus %d (%d)" % [Config.at("zombie.ironKnight.maxAlive"), kinds["armored"]])
	t.check(crawlers > 400 * 0.05 and crawlers < 400 * 0.2, "rampants : ~12 %% (%d / 400)" % crawlers)
	t.check(runners > 400 * 0.1 and runners < 400 * 0.4, "coureurs : ~25 %% (%d / 400)" % runners)
	t.check(int(kinds["armored"]) >= 1, "chevaliers de fer : il en apparaît dans la zone de l'Homme de Fer (%d)" % kinds["armored"])
	# pestiférés : Petite France, à partir de la manche 10, trois au plus en vie
	Game.new_game(43, "strasbourg")
	Game.world.open_all_doors()
	var zp := Game.world.zone_names.find("Petite France")
	var cp: Dictionary = Game.world.objects["zones"][zp]["center"]
	Game.player.pos = Vector3(cp["x"], 0, cp["z"])
	Game.director.round_number = 9
	Game.director.start_round()
	for i in 300:
		Game._spawn_zombie()
	var bloats := 0
	for zz in Game.zombies:
		if zz.kind == "bloat":
			bloats += 1
	t.check(bloats >= 1 and bloats <= int(Config.at("zombie.pestilent.maxAlive")), "pestiférés : 1 à %d en Petite France (%d)" % [Config.at("zombie.pestilent.maxAlive"), bloats])
	print("variantes : %s, %d rampants, %d coureurs sur 400 apparitions (manche 10)" % [kinds, crawlers, runners])

func _relocate(t: Node) -> void:
	_scenario(35)
	var p := Game.player.pos
	# v0.34.11 (écart voulu avec main.js relocateZombies) : un zombie coincé (no_progress élevé) n'est plus téléporté : hors de la vue du joueur
	# (il est à 30 m sur le côté), il réapparaît aussitôt par une fenêtre ou depuis le sol, à une place cachée et à distance de marche bornée
	var z := _make_zombie(p + Vector3(30, 0, 0), 2.0)
	z.no_progress = 10.0
	Game.relocate_t = 0.0
	Game.step(DT, {})
	var at := z.spawn_outside if z.spawn_type == "window" else z.spawn_pos
	var d := Vector2(at.x - p.x, at.z - p.z).length()
	t.check(z.spawn_t > 0.0 and (z.spawn_type == "window" or z.spawn_type == "ground") and d >= 6.0 and d <= 80.0,
		"zombie coincé relancé par une apparition animée (%s à %.1f m du joueur)" % [z.spawn_type, d])
	t.check(Game.relocated >= 1 and z.no_progress == 0.0, "relance comptée, no_progress remis à zéro")
	# un zombie trop loin (hors du champ de flux) : relancé après RELOCATE_FAR_COUNT s à plus de RELOCATE_FAR m
	var fc := Game.env.nav.nearest_free(p.x + 300.0, p.z, 12)   # sur une case libre (au fond d'un immeuble, il serait relancé plus tôt : « inside »)
	var far := _make_zombie(Vector3(Game.env.nav.world_x(fc % Game.env.nav.nx), 0, Game.env.nav.world_z(fc / Game.env.nav.nx)) if fc >= 0 else p + Vector3(300, 0, 0), 2.0)
	var moved_at := -1.0
	for f in 60 * 8:
		Game.step(DT, {})
		if far.spawn_t > 0.0 and Vector2(far.pos.x - p.x, far.pos.z - p.z).length() < 100.0:
			moved_at = f * DT
			break
	t.check(moved_at > 2.0 and moved_at < 6.5 and far.spawn_type != "", "zombie lointain relancé près du joueur après %.1f s, par une apparition animée (%s)" % [moved_at, far.spawn_type])

# ------------------------------------------------------------------ bots de marche (tools/stuck-scan.mjs, étape bots)
func _walkers(t: Node) -> void:
	Game.new_game(36, "strasbourg")
	Game.world.open_all_doors()
	var w := Game.world
	var nav := w.nav
	var col := Game.collision
	var main_id := 0
	var comp := nav.components()
	main_id = comp["labels"][nav.idx(nav.cx(w.start_pos.x), nav.cz(w.start_pos.z))]
	var labels: PackedInt32Array = comp["labels"]
	var s := 1 * 2654435761 & 0xFFFFFFFF
	var bots: Array[Dictionary] = []
	var n_bots := 200
	var seconds := 60.0
	var dt := 0.05
	for _tries in 200000:
		if bots.size() >= n_bots:
			break
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var ix := int(float(s) / 4294967296.0 * nav.nx)
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var iz := int(float(s) / 4294967296.0 * nav.nz)
		if labels[nav.idx(ix, iz)] != main_id:
			continue
		var x := nav.world_x(ix)
		var z := nav.world_z(iz)
		var zi := w.zone_of(x, z)
		if zi < 0 or not w.is_zone_open(zi):
			continue
		var q := col.resolve(Vector3(x, 0, z), 0.4)
		if Vector2(q.x - x, q.z - z).length() > 0.05:
			continue
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var head := float(s) / 4294967296.0 * 6.283
		s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
		var turn := 1.0 + float(s) / 4294967296.0 * 2.0
		bots.append({"x": x, "z": z, "y": 0.0, "head": head, "turn": turn, "stuck": 0.0, "bump": 0.0, "flag": "", "win": [], "bad_y": 0.0})
	var fl := {}
	var flagged: Array[String] = []
	var t0 := Time.get_ticks_msec()
	for _k in int(round(seconds / dt)):
		for b in bots:
			b["turn"] -= dt
			if b["turn"] <= 0.0:
				s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
				b["head"] += (float(s) / 4294967296.0 - 0.5) * 2.0 * 2.4
				s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
				b["turn"] = 0.8 + float(s) / 4294967296.0 * 2.2
			var px: float = b["x"]
			var pz: float = b["z"]
			var q := col.resolve(Vector3(px + cos(b["head"]) * 5.0 * dt, b["y"], pz + sin(b["head"]) * 5.0 * dt), 0.4)
			w.floor_at(q.x, q.z, b["y"], fl)
			if absf(fl["y"] - b["y"]) > 0.62 and fl["y"] > b["y"]:
				q = Vector3(px, q.y, pz)
				w.floor_at(px, pz, b["y"], fl)
			var adv := Vector2(q.x - px, q.z - pz).length()
			if adv < 0.3 * 5.0 * dt:
				b["bump"] += dt
				if b["bump"] >= 0.2:
					s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
					var r1 := float(s) / 4294967296.0
					s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
					var r2 := float(s) / 4294967296.0
					s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
					var r3 := float(s) / 4294967296.0
					b["head"] += PI * (0.5 + r1) * (-1.0 if r2 < 0.5 else 1.0)
					b["bump"] = 0.0
					b["turn"] = 0.5 + r3
			else:
				b["bump"] = 0.0
			b["x"] = q.x
			b["z"] = q.z
			b["y"] = fl["y"]
			if int(fl["region"]) == 0 and (b["y"] < -1.0 or b["y"] > 0.5):
				b["bad_y"] += dt
			else:
				b["bad_y"] = 0.0
			if b["flag"] == "":
				if b["y"] < -1.0 and int(fl["region"]) == 0:
					b["flag"] = "sous la carte"
				elif b["bad_y"] > 1.0:
					b["flag"] = "étage incohérent"
			var win: Array = b["win"]
			win.append(Vector2(q.x, q.z))
			if win.size() > 60:
				win.pop_front()
			if win.size() == 60 and b["flag"] == "":
				if Vector2(q.x - win[0].x, q.z - win[0].y).length() < 0.5:
					b["stuck"] += dt
					if b["stuck"] > 2.0:
						b["flag"] = "bloqué"
				else:
					b["stuck"] = 0.0
			if b["flag"] != "" and not flagged.has("%s (%.1f, %.1f)" % [b["flag"], b["x"], b["z"]]):
				flagged.append("%s (%.1f, %.1f)" % [b["flag"], b["x"], b["z"]])
	var n_flag := 0
	for b in bots:
		if b["flag"] != "":
			n_flag += 1
	print("bots de marche (stuck-scan) : %d bots, %.0f s simulées en %d ms, %d signalés %s" % [bots.size(), seconds, Time.get_ticks_msec() - t0, n_flag, flagged.slice(0, 6)])
	t.check(bots.size() == n_bots, "stuck-scan : %d bots placés" % bots.size())
	t.check(n_flag == 0, "stuck-scan : aucun bot bloqué plus de 2 s, sous la carte ou à un étage incohérent (%d : %s)" % [n_flag, flagged.slice(0, 6)])

# ------------------------------------------------------------------ champ sur fil de travail : même résultat que le calcul par tranches
func _threaded(t: Node) -> void:
	_scenario(38)
	var nav := Game.env.nav
	var F: Dictionary = Config.at("zombie.flow")
	var max_cost := roundi(float(F["range"]) / nav.cell * 10.0)
	var tg: Array = [Game.player.pos + Vector3(1, 0, 1)]
	nav.job_active = false
	while nav.update_field(tg, 5000, max_cost):
		pass
	var ref := nav.dist.duplicate()
	var t0 := Time.get_ticks_usec()
	var calls := 0
	nav.dist_b.fill(7)   # l'ancien champ est remplacé en entier
	while nav.update_field_threaded(tg, max_cost):
		calls += 1
		OS.delay_usec(500)
	var ms := (Time.get_ticks_usec() - t0) / 1000.0
	t.check(nav.dist == ref, "champ sur fil de travail égal au champ par tranches")
	t.check(not nav.job_active, "champ sur fil de travail terminé")
	print("champ sur fil de travail : identique au calcul par tranches, %.1f ms (%d interrogations)" % [ms, calls])

# ------------------------------------------------------------------ banc d'essai
func _bench(t: Node, threaded: bool) -> void:
	# 22 zombies (CONFIG.zombie.maxAlive) + champ de flux sur la grande carte : temps de Game.step (= le travail de _physics_process)
	var pos := Vector3(-60.0, 0, 70.0)   # place Kléber, ouverte : le plus gros champ
	_scenario(37)
	Game.flow_threaded = threaded
	var Z: Dictionary = Config.at("zombie")
	var zi := Game.world.zone_names.find("Place Kléber")
	if zi >= 0:
		var c: Dictionary = Game.world.objects["zones"][zi]["center"]
		pos = Vector3(c["x"], 0, c["z"])
	Game.player.pos = pos
	Game.player.vel = Vector3.ZERO
	var nav := Game.env.nav
	var n := int(Z["maxAlive"])
	# 22 zombies tirés à 20-150 m autour du joueur dans le champ (cases atteignables)
	nav.job_active = false
	var F: Dictionary = Z["flow"]
	var max_cost := roundi(float(F["range"]) / nav.cell * 10.0)
	var t0 := Time.get_ticks_usec()
	var guard := 0
	while nav.update_field([pos], 1 << 30, max_cost):
		guard += 1
	var full_us := Time.get_ticks_usec() - t0
	var reached := 0
	var tx := nav.cx(pos.x)
	var tz := nav.cz(pos.z)
	for iz in range(maxi(0, tz - 230), mini(nav.nz, tz + 230)):
		for ix in range(maxi(0, tx - 230), mini(nav.nx, tx + 230)):
			if nav.dist[iz * nav.nx + ix] < NavGrid.INF_D:
				reached += 1
	var placed := 0
	for _try in 100000:
		if placed >= n:
			break
		var ix := tx + _rng.randi_range(-200, 200)
		var iz := tz + _rng.randi_range(-200, 200)
		if not nav.inside(ix, iz) or nav.blocked[nav.idx(ix, iz)] != 0:
			continue
		var d := nav.dist[nav.idx(ix, iz)]
		if d >= NavGrid.INF_D or d < 300:
			continue
		var x := nav.world_x(ix)
		var z := nav.world_z(iz)
		var q := Game.collision.resolve(Vector3(x, 0, z), 0.4)
		if Vector2(q.x - x, q.z - z).length() > 0.05:
			continue
		_make_zombie(Vector3(x, 0, z), 2.2 + 0.1 * (placed % 5))
		placed += 1
	t.check(placed == n, "banc d'essai : %d zombies placés" % placed)
	# le joueur marche en rond (le champ doit suivre) pendant 40 s
	var times: Array[float] = []
	var flow_times: Array[float] = []
	var frames := 60 * 40
	for f in frames:
		var a := f * DT * 0.35
		Game.player.yaw = a
		var t1 := Time.get_ticks_usec()
		Game.step(DT, {"mx": 0.0, "mz": 1.0, "sprint": false})
		times.append((Time.get_ticks_usec() - t1) / 1000.0)
		flow_times.append(Game.flow_us / 1000.0)
	var alive := Game.alive_count()
	times.sort()
	var sum := 0.0
	for x in times:
		sum += x
	var avg := sum / times.size()
	var p99 := times[int(times.size() * 0.99)]
	var p50 := times[times.size() / 2]
	var worst := times[-1]
	var fsum := 0.0
	var fmax := 0.0
	for x in flow_times:
		fsum += x
		fmax = maxf(fmax, x)
	var mode := "fil de travail" if threaded else "tranches de %d cases" % Rules.FLOW_BUDGET_MAX
	print("banc d'essai (%s) : %d zombies, %d images (40 s) sur Strasbourg : Game.step moyenne %.2f ms, médiane %.2f, 99e centile %.2f, pire %.2f ; champ de flux : moyenne %.2f ms, pire %.2f ; champ complet (un seul bloc, %d cases) %.1f ms ; %d vivants" % [mode, n, frames, avg, p50, p99, worst, fsum / flow_times.size(), fmax, reached, full_us / 1000.0, alive])
	t.check(avg < 4.0, "banc d'essai (%s) : moyenne de Game.step < 4 ms (%.2f ms)" % [mode, avg])
	t.check(p99 < 8.0, "banc d'essai (%s) : 99e centile de Game.step < 8 ms (%.2f ms)" % [mode, p99])
	Game.zombies.clear()
	Game.flow_threaded = false
	Game._stop_flow_thread()
