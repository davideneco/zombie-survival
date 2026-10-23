extends RefCounted
## J2 : la carte de Strasbourg cuite. Comptes égaux au JS, golden floorAt / rayHit / zoneOf (portes fermées puis toutes ouvertes), empreintes des
## fichiers, achat de porte, joueur sur un étage, bot qui traverse la carte du Marché-Neuf à la place Kléber une fois les portes ouvertes.
## Les golden viennent de tools/bake-world.page.js (le vrai monde du jeu JS) ; sans monde cuit (data/world/), la suite échoue franchement.

const MM := 1e-3
const DT := 1.0 / 60.0
const DIR := "res://data/world/"

func run(t: Node) -> void:
	if not FileAccess.file_exists(DIR + "golden_j2.json"):
		t.check(false, "monde cuit absent : lancer  node tools/bake-world.mjs  (npm run dev actif)")
		return
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(DIR + "golden_j2.json"))
	_manifest(t)
	var w := World.load_world()
	print("monde chargé en %d ms : %d segments, %d cercles, %d dalles, %d triangles d'étage, case %dx%d" % [w.load_ms, w.collision.segs.size(), w.collision.circles.size(), w.collision.floors.size(), w.levels.tris.size(), w.nav.nx, w.nav.nz])
	t.check(w.load_ms < 15000, "chargement du monde en moins de 15 s (%d ms)" % w.load_ms)
	# v0.24.0 : la collision du JS est comparée SANS les murs ajoutés (écart voulu, voir test_j30) ; le reste du test les garde
	t.check(w.seg_list.size() > w.extra_first, "murs ajoutés présents (%d)" % (w.seg_list.size() - w.extra_first))
	w.set_extras(false)
	_counts(t, w, g, w.extra_first)
	_golden_closed(t, w, g)
	_golden_open(t, w, g)
	w.set_extras(true)
	_game(t)
	_stairs(t)
	_crossing(t)

# ------------------------------------------------------------------ empreintes
func _manifest(t: Node) -> void:
	var m: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(DIR + "manifest.json"))
	var checked := 0
	var absent := 0
	for rel: String in m:
		var path := "res://" + rel
		if not FileAccess.file_exists(path):
			absent += 1   # géométrie et textures : non versionnées (voir .gitignore), régénérées par tools/bake-world.mjs
			continue
		checked += 1
		if not rel.begins_with("data/"):
			continue      # textures PNG : empreinte contrôlée par la cuisson elle-même
		t.check(FileAccess.get_sha256(path).substr(0, 16) == m[rel], "empreinte %s" % rel)
	print("manifeste : %d fichiers présents, %d absents (géométrie non versionnée)" % [checked, absent])
	t.check(checked > 10, "manifeste : des fichiers de données présents")

# ------------------------------------------------------------------ comptes
func _counts(t: Node, w: World, g: Dictionary, n_js: int) -> void:
	var c: Dictionary = g["counts"]
	t.check(n_js == int(c["segs"]), "segments du JS %d != %d" % [n_js, c["segs"]])
	t.check(w.js_circles == int(c["circles"]), "cercles du JS %d != %d" % [w.js_circles, c["circles"]])   # v0.33.1 : les cercles du mobilier ajouté viennent après
	var n_furn := 0
	for e: Dictionary in w.furniture_col:
		n_furn += 1 if e.has("r") else 0
	t.check(w.collision.circles.size() == w.js_circles + n_furn, "cercles : JS + mobilier ajouté (%d)" % n_furn)
	t.check(w.collision.vaults.size() == int(c["vaults"]), "obstacles enjambables")
	t.check(w.collision.floors.size() == int(c["floors"]), "dalles")
	t.check(w.levels.tris.size() == int(c["levelTris"]), "triangles d'étage %d != %d" % [w.levels.tris.size(), c["levelTris"]])
	t.check(w.levels.regions.size() == int(c["regions"]), "régions")
	t.check(w.levels.links.size() == int(c["links"]), "liens d'escalier")
	t.check(w.zone_names.size() == int(c["zones"]) and w.zone_names.size() == 27, "27 zones")
	t.check(w.doors.size() == int(c["doors"]), "portes %d != %d" % [w.doors.size(), c["doors"]])
	t.check(w.window_count() == int(c["windows"]), "fenêtres d'apparition %d != %d" % [w.window_count(), c["windows"]])
	t.check(w.objects["machines"].size() == int(c["machines"]) + PerkPlaces.list().size(), "machines (cuites + %d distributeurs des nouveaux atouts, v0.27.0)" % PerkPlaces.list().size())
	t.check(w.objects["wallWeapons"].size() == int(c["wallWeapons"]), "armes murales")
	t.check(w.objects["stations"].size() == int(c["stations"]), "bornes de munitions")
	t.check(w.objects["vehicleSpawns"].size() == int(c["vehicleSpawns"]), "motos")
	t.check(w.objects["parkings"].size() == int(c["parkings"]), "parkings")
	t.check(w.objects["bikeStations"].size() == int(c["bikeStations"]), "stations de vélos")
	t.check(w.nav.nx * w.nav.nz == int(c["navCells"]), "cases de navigation")
	var blocked := 0
	for b in w.nav.blocked:
		blocked += b
	t.check(blocked == int(g["cellsClosed"]), "cases bloquées, portes fermées : %d != %d" % [blocked, g["cellsClosed"]])
	var boxes := 0
	for m: Dictionary in w.objects["machines"]:
		if m["type"] == "box":
			boxes += 1
	t.check(boxes == 19, "19 emplacements de la boîte mystère")
	t.check(w.start_pos.is_equal_approx(Vector3(-0.625, 0, -30.875)), "point de départ du Marché-Neuf")
	t.check(w.is_zone_open(w.start_zone) and not w.is_zone_open(5), "seule la zone de départ est ouverte")
	# chaque barrière de porte est bien dans la collision et marquée
	var door_segs := 0
	for d: Dictionary in w.doors:
		door_segs += d["segs"].size()
	t.check(door_segs > 100, "barrières de portes présentes (%d)" % door_segs)

# ------------------------------------------------------------------ golden, portes fermées
func _golden_closed(t: Node, w: World, g: Dictionary) -> void:
	var out := {}
	for i in g["floorCases"].size():
		var c: Array = g["floorCases"][i]
		w.floor_at(c[0], c[1], c[2], out)
		t.near(out["y"], c[3], "floorAt #%d y" % i, 1e-6)
		t.check(out["region"] == int(c[4]), "floorAt #%d région %d != %d" % [i, out["region"], c[4]])
	var hits := 0
	for i in g["rays"].size():
		var r: Array = g["rays"][i]
		var tt := w.ray_hit(r[0], r[1], r[2], r[3], r[4], r[5], r[6])
		t.near(tt, r[7], "rayHit #%d" % i, MM)
		if r[7] < r[6]:
			hits += 1
	t.check(hits > 800, "golden rayHit : assez de rayons qui touchent (%d)" % hits)
	var zones := 0
	for i in g["zoneCases"].size():
		var c: Array = g["zoneCases"][i]
		t.check(w.zone_of(c[0], c[1]) == int(c[2]), "zoneOf #%d" % i)
		t.check(w.nav.zone1_of(c[0], c[1]) == int(c[3]), "zoneOf1 #%d" % i)
		if int(c[2]) >= 0:
			zones += 1
	t.check(zones == g["zoneCases"].size(), "tous les points tirés sont dans une zone")
	for i in g["doorRays"].size():
		var r: Array = g["doorRays"][i]
		t.near(w.ray_hit(r[0], r[1], r[2], r[3], r[4], r[5], r[6]), r[7], "porte %d fermée : rayon" % i, MM)
		t.check(r[7] < r[6], "porte %d fermée arrête le rayon" % i)
	print("golden j2 (portes fermées) : %d floorAt, %d rayHit (%d touchent), %d zoneOf, %d rayons de portes" % [g["floorCases"].size(), g["rays"].size(), hits, g["zoneCases"].size(), g["doorRays"].size()])

# ------------------------------------------------------------------ golden, toutes les portes ouvertes
func _golden_open(t: Node, w: World, g: Dictionary) -> void:
	w.open_all_doors()
	var blocked := 0
	for b in w.nav.blocked:
		blocked += b
	t.check(blocked == int(g["cellsOpen"]), "cases bloquées, portes ouvertes : %d != %d" % [blocked, g["cellsOpen"]])
	var changed := 0
	for i in g["rays"].size():
		var r: Array = g["rays"][i]
		var tt := w.ray_hit(r[0], r[1], r[2], r[3], r[4], r[5], r[6])
		t.near(tt, g["raysOpen"][i], "rayHit (portes ouvertes) #%d" % i, MM)
		if absf(g["raysOpen"][i] - r[7]) > 0.01:
			changed += 1
	var door_changed := 0
	for i in g["doorRays"].size():
		var r: Array = g["doorRays"][i]
		t.near(w.ray_hit(r[0], r[1], r[2], r[3], r[4], r[5], r[6]), g["doorRaysOpen"][i], "porte %d ouverte : rayon" % i, MM)
		if g["doorRaysOpen"][i] > r[7] + 0.5:
			door_changed += 1
	t.check(changed > 0, "ouvrir les portes change au moins un rayon (%d)" % changed)
	t.check(door_changed >= 40, "ouvrir une porte laisse passer un rayon perpendiculaire (%d portes sur %d)" % [door_changed, g["doorRays"].size()])
	for z in w.zone_open:
		t.check(z == 1, "toutes les zones sont ouvertes")
	t.check(not w.open_door(0), "une porte déjà ouverte ne s'ouvre pas deux fois")
	print("golden j2 (portes ouvertes) : %d cases libérées, %d rayons modifiés" % [int(g["cellsClosed"]) - int(g["cellsOpen"]), changed])

# ------------------------------------------------------------------ partie : achat d'une porte
func _stand_at_door(d: Dictionary) -> Vector3:
	var p: Array = d["points"][0]
	return Vector3(p[0], 0, p[1])

func _door_between(w: World, a: int, b: int) -> Array:
	var out: Array = []
	for d: Dictionary in w.doors:
		if (int(d["a"]) == a and int(d["b"]) == b) or (int(d["a"]) == b and int(d["b"]) == a):
			out.append(int(d["id"]))
	return out

func _game(t: Node) -> void:
	Game.new_game(21, "strasbourg")
	var w := Game.world
	t.check(Game.arena == null and w != null and Game.collision == w.collision, "partie sur la carte de Strasbourg")
	t.check(Game.player.pos.is_equal_approx(w.start_pos), "le joueur démarre au Marché-Neuf")
	var ids := _door_between(w, 0, 1)
	t.check(not ids.is_empty(), "une porte relie le Marché-Neuf et le Temple-Neuf")
	var d: Dictionary = w.doors[ids[0]]
	t.check(int(d["price"]) == 750, "prix de la porte Marché-Neuf / Temple-Neuf : %s" % d["price"])
	Game.player.pos = _stand_at_door(d)
	Game.points = 100
	var denied := [false]
	Game.door_denied.connect(func(_i): denied[0] = true, CONNECT_ONE_SHOT)
	t.check(Game.use_door() == -1 and denied[0] and not d["open"] and Game.points == 100, "points insuffisants : la porte reste fermée")
	Game.points = 1000
	var cells_before := 0
	for c in d["cells"]:
		cells_before += w.nav.blocked[c]
	t.check(cells_before == d["cells"].size() and cells_before > 0, "cases de navigation de la porte bloquées avant l'achat")
	var opened := [-1]
	Game.door_opened.connect(func(i): opened[0] = i, CONNECT_ONE_SHOT)
	var got := Game.use_door()
	t.check(got >= 0 and opened[0] == got, "achat de la porte")
	d = w.doors[got]
	t.check(Game.points == 1000 - int(d["price"]), "points débités du prix de la porte")
	t.check(w.is_zone_open(int(d["a"])) and w.is_zone_open(int(d["b"])), "les zones reliées sont ouvertes")
	var cells_after := 0
	for c in d["cells"]:
		cells_after += w.nav.blocked[c]
	t.check(cells_after == 0, "cases de navigation libérées")
	for k: float in d["segs"]:
		t.check(bool(w.seg_list[int(k)]["off"]), "barrière désactivée")
	# la porte laisse passer le joueur
	var dp: Array = d["points"][0]
	var seg: Dictionary = w.seg_list[int(d["segs"][0])]
	var mid := Vector3((seg["ax"] + seg["bx"]) / 2.0, 0, (seg["az"] + seg["bz"]) / 2.0)
	var ex: float = seg["bx"] - seg["ax"]
	var ez: float = seg["bz"] - seg["az"]
	var l := sqrt(ex * ex + ez * ez)
	Game.player.pos = mid + Vector3(-ez / l, 0, ex / l) * 1.5
	for _i in 120:
		Game.step(DT, {"mx": 0.0, "mz": 0.0})
	var before := Game.player.pos
	# marche à travers la barrière (perpendiculairement), yaw dans la direction -normale
	var dir := Vector3(ez / l, 0, -ex / l)
	Game.player.yaw = atan2(-dir.x, -dir.z)
	for _i in 120:
		Game.step(DT, {"mx": 0.0, "mz": 1.0})
	var moved := Game.player.pos.distance_to(before)
	t.check(moved > 3.0, "le joueur traverse la porte ouverte (%.1f m)" % moved)
	# zombies : apparition par les fenêtres d'une zone ouverte
	Game.new_game(22, "strasbourg")
	for _i in 60 * 6:
		Game.step(DT, {})
	t.check(Game.zombies.size() > 0, "des zombies apparaissent (%d)" % Game.zombies.size())
	for z in Game.zombies:
		t.check(Game.world.zone_of(z.pos.x, z.pos.z) == 0, "le zombie apparaît dans la zone ouverte (zone %d)" % Game.world.zone_of(z.pos.x, z.pos.z))
		t.check(z.pos.distance_to(Game.player.pos) > 5.0, "le zombie apparaît à distance du joueur")

# ------------------------------------------------------------------ joueur sur un étage
func _stairs(t: Node) -> void:
	Game.new_game(23, "strasbourg")
	var w := Game.world
	var lv := w.levels
	# un plancher de la cathédrale (région d'étage haute) : le joueur y reste debout
	var best: Dictionary = {}
	for tri: Dictionary in lv.tris:
		if tri["region"] != 0 and float(tri["y0"]) > 8.0 and lv.regions[tri["region"]]["kind"] == "floor":
			best = tri
			break
	t.check(not best.is_empty(), "un plancher d'étage au-dessus de 8 m existe")
	var cx: float = (best["x0"] + best["x1"] + best["x2"]) / 3.0
	var cz: float = (best["z0"] + best["z1"] + best["z2"]) / 3.0
	var fy: float = (best["y0"] + best["y1"] + best["y2"]) / 3.0
	Game.player.pos = Vector3(cx, fy, cz)
	for _i in 90:
		Game.step(DT, {})
	t.near(Game.player.pos.y, fy, "le joueur reste sur le plancher d'étage (y)", 0.02)
	t.check(Game.player.region == best["region"], "région sous les pieds : %d (attendu %d)" % [Game.player.region, best["region"]])
	# un escalier : on suit son chemin du bas vers le haut, les pieds restent sur le sol de l'escalier
	var link: Dictionary = lv.links[0]
	var path: Array = link["path"]
	var ok := true
	var out := {}
	var worst := 0.0
	for p: Array in path:
		lv.floor_at(p[0], p[2], p[1] + 0.1, out)
		worst = maxf(worst, absf(out["y"] - p[1]))
	t.check(worst < 0.35, "le chemin de l'escalier « %s » suit le sol (écart max %.2f m)" % [link["name"], worst])
	# marche réelle le long du chemin, par entrées de déplacement
	var start: Array = path[0]
	Game.player.pos = Vector3(start[0], start[1], start[2])
	Game.player.vel = Vector3.ZERO
	var k := 1
	var frames := 0
	var top: Array = path[path.size() - 1]
	var stuck := 0
	while k < path.size() and frames < 60 * 90:
		var tgt: Array = path[k]
		var p := Game.player.pos
		var dx: float = tgt[0] - p.x
		var dz: float = tgt[2] - p.z
		if sqrt(dx * dx + dz * dz) < 0.5:
			k += 1
			continue
		Game.player.yaw = atan2(-dx, -dz)
		Game.step(DT, {"mx": 0.0, "mz": 1.0})
		frames += 1
	var fin := Game.player.pos
	var dist_top := Vector3(top[0] - fin.x, 0, top[2] - fin.z).length()
	t.check(k >= path.size() and dist_top < 1.0 and absf(fin.y - float(top[1])) < 0.6, "montée de l'escalier « %s » en %.1f s : (%.1f, %.1f) vs haut (%.1f, %.1f)" % [link["name"], frames * DT, dist_top, fin.y, 0.0, top[1]])

# ------------------------------------------------------------------ traversée de la carte
## Chemin le plus court sur la grille de navigation (8 voisins, sans couper les coins). Renvoie la liste des indices de cases, [] si inaccessible.
func _bfs(nav: NavGrid, from: Vector3, to: Vector3) -> PackedInt32Array:
	var nx := nav.nx
	var start := nav.idx(nav.cx(from.x), nav.cz(from.z))
	var goal := nav.idx(nav.cx(to.x), nav.cz(to.z))
	var prev := PackedInt32Array()
	prev.resize(nx * nav.nz)
	prev.fill(-1)
	prev[start] = start
	var queue := PackedInt32Array([start])
	var head := 0
	var blocked := nav.blocked
	var found := false
	while head < queue.size():
		var c := queue[head]
		head += 1
		if c == goal:
			found = true
			break
		var cx := c % nx
		var cz := c / nx
		for dz in [-1, 0, 1]:
			for dx in [-1, 0, 1]:
				if dx == 0 and dz == 0:
					continue
				var jx: int = cx + dx
				var jz: int = cz + dz
				if jx < 0 or jz < 0 or jx >= nx or jz >= nav.nz:
					continue
				var j := jz * nx + jx
				if prev[j] >= 0 or blocked[j] != 0:
					continue
				if dx != 0 and dz != 0 and (blocked[cz * nx + jx] != 0 or blocked[jz * nx + cx] != 0):
					continue
				prev[j] = c
				queue.append(j)
	var path := PackedInt32Array()
	if not found:
		return path
	var c := goal
	while c != start:
		path.append(c)
		c = prev[c]
	path.append(start)
	path.reverse()
	return path

func _crossing(t: Node) -> void:
	Game.new_game(24, "strasbourg")
	var w := Game.world
	var goal_zone := 5   # Place Kléber
	var gc: Dictionary = w.objects["zones"][goal_zone]["center"]
	var goal := Vector3(gc["x"], 0, gc["z"])
	t.check(w.zone_names[goal_zone] == "Place Kléber", "zone 5 = Place Kléber")
	# portes fermées : la place Kléber est inaccessible depuis le Marché-Neuf
	var t0 := Time.get_ticks_msec()
	var closed := _bfs(w.nav, w.start_pos, goal)
	t.check(closed.is_empty(), "portes fermées : la place Kléber est inaccessible")
	# le trajet des zones : Marché-Neuf -> Temple-Neuf -> Place Kléber ; on achète les portes à la main
	Game.points = 100000
	var bought := 0
	for pair in [[0, 1], [1, 5]]:
		for id in _door_between(w, pair[0], pair[1]):
			Game.player.pos = _stand_at_door(w.doors[id])
			var got := Game.use_door()
			if got >= 0:
				bought += 1
	t.check(bought >= 2, "portes achetées sur le trajet (%d)" % bought)
	var path := _bfs(w.nav, w.start_pos, goal)
	var bfs_ms := Time.get_ticks_msec() - t0
	t.check(not path.is_empty(), "portes ouvertes : la place Kléber est accessible")
	if path.is_empty():
		return
	var len := 0.0
	for i in range(1, path.size()):
		len += w.nav.cell * (1.414 if (absi(path[i] % w.nav.nx - path[i - 1] % w.nav.nx) + absi(path[i] / w.nav.nx - path[i - 1] / w.nav.nx)) == 2 else 1.0)
	# le joueur suit le chemin (cases de 75 cm, rayon 0.4 m) avec la vraie collision : arrive-t-il, et en combien de temps ?
	Game.player.pos = w.start_pos
	Game.player.vel = Vector3.ZERO
	Game.player.max_health = 1.0e9   # les zombies de la manche 1 (en ligne droite avant J3) ne doivent pas tuer le marcheur
	Game.player.health = 1.0e9
	var k := 0
	var frames := 0
	var look := 2
	var stalled := 0
	var last := Game.player.pos
	var worst_stall := 0
	var max_frames := int(len / float(Config.at("player.walkSpeed")) * 60.0 * 2.0)
	while frames < max_frames:
		var p := Game.player.pos
		# case courante : la plus avancée du chemin (parmi les 12 suivantes) à moins de 1,5 m
		for j in range(k, mini(k + 12, path.size())):
			if Vector2(w.nav.world_x(path[j] % w.nav.nx) - p.x, w.nav.world_z(path[j] / w.nav.nx) - p.z).length() < 1.5:
				k = j
		var tk := mini(k + look, path.size() - 1)
		var tx := w.nav.world_x(path[tk] % w.nav.nx)
		var tz := w.nav.world_z(path[tk] / w.nav.nx)
		var dx := tx - p.x
		var dz := tz - p.z
		if Vector2(goal.x - p.x, goal.z - p.z).length() < 2.0:
			break
		Game.player.yaw = atan2(-dx, -dz)
		Game.step(DT, {"mx": 0.0, "mz": 1.0})
		frames += 1
		if frames % 300 == 0 and OS.has_environment("J2_DEBUG"):
			print("  t=%.0f pos=%s k=%d/%d target=(%.1f,%.1f)" % [frames * DT, Game.player.pos, k, path.size(), tx, tz])
		if Game.player.pos.distance_to(last) < 0.01:
			stalled += 1
			worst_stall = maxi(worst_stall, stalled)
		else:
			stalled = 0
		last = Game.player.pos
	var d_end := Vector2(goal.x - Game.player.pos.x, goal.z - Game.player.pos.z).length()
	t.check(d_end < 2.0, "le joueur atteint la place Kléber (%.1f m du but après %.1f s)" % [d_end, frames * DT])
	t.check(worst_stall < 60, "jamais coincé plus d'une seconde (%d images)" % worst_stall)
	t.check(Game.world.zone_of(Game.player.pos.x, Game.player.pos.z) == goal_zone, "le joueur est dans la zone Place Kléber")
	print("traversée Marché-Neuf -> Place Kléber : chemin de %.0f m (%d cases, BFS %d ms), %.1f s de marche, plus long arrêt %d images" % [len, path.size(), bfs_ms, frames * DT, worst_stall])
