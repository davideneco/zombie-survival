extends RefCounted
## v0.33.1 : place le mobilier urbain ajouté (sim/street_furniture.gd) et écrit godot/data/street_furniture.json (versionné : les emplacements ne
## changent pas d'une partie à l'autre et se relisent à l'œil). Outil, pas un test (absent de la liste des suites) :
##   godot --headless --path godot res://tests/runner.tscn -- --suite=place_furniture
## Règles (toutes vérifiées ensuite par la suite j30) :
##   - CONTRE LES FAÇADES (bancs dos au mur, barrières, corbeilles, bornes par trois, lampadaires) : case libre du réseau de navigation dont
##     l'anneau à 1,5 m touche un mur droit d'un seul côté ; le mur est retrouvé par trois rayons de collision (à 1 m de haut) parallèles et
##     de même longueur à 5 cm près (mur droit sur la longueur de l'objet) ; l'objet est collé au mur (5 cm) ; la rue en face reste
##     libre sur `width` m au moins (rayon de collision à 1 m de haut) ; bornes et lampadaires à 1,1 m du mur (bord du trottoir) ;
##   - AU MILIEU DES PLACES (kiosques, colonnes d'affichage, lampadaires, corbeilles) : seulement des objets ronds (les zombies glissent autour),
##     sur une case dont tout le disque de `clear` m est libre ;
##   - jamais : dans la cathédrale et sur son parvis (étages, finale), à moins de 5 m d'une porte payante, 3,5 m d'une fenêtre d'apparition,
##     4 m d'une machine, arme murale, borne de munitions, station de vélos, parking, place de véhicule, pompe, sous-station, 4,5 m des voies du
##     tram, 5 m d'un escalier, 8 m du départ, ni des portes de sortie, départs et machines ajoutés du mode Zone unique (27 zones) ;
##   - aucune collision existante dans l'emprise (Collision.resolve), aucun trou d'escalier ;
##   - aucun passage coupé : dans une fenêtre de 15 m autour de l'objet, les cases libres qui étaient reliées le restent quand on bloque les
##     cases à moins de 0,5 m de l'objet (la marge des murs de la grille de navigation : le rayon des zombies et du joueur, 0,4 m, plus 10 cm).

const OUT := "res://data/street_furniture.json"
const EXCLUDE_ZONES := [7, 8]   ## Cathédrale (parvis), Intérieur de la Cathédrale
const MARGIN := 0.5             ## NavGrid.margin : cases bloquées autour d'un obstacle
const WIN := 10                 ## demi-fenêtre (cases) du contrôle local de passage

## Sortes posées contre une façade : [sorte, nombre max, espacement entre deux objets de la sorte (m), largeur de rue libre en face (m), groupe, pas du groupe (m)]
const WALL_KINDS := [
	["bench", 90, 16.0, 6.0, 1, 0.0],
	["bin", 80, 18.0, 4.5, 1, 0.0],
	["lamp", 70, 20.0, 5.5, 1, 0.0],
	["bollard", 40, 28.0, 5.0, 3, 1.5],
	["barrier", 20, 40.0, 6.5, 2, 2.15],
]
## Sortes posées au milieu des places : [sorte, nombre max, espacement (m), rayon libre (m)]
const PLAZA_KINDS := [
	["kiosk", 8, 80.0, 6.5],
	["column", 12, 50.0, 4.5],
	["lamp", 40, 18.0, 3.5],
	["bin", 20, 30.0, 3.0],
]

var w: World
var nav: NavGrid
var col: Collision
var avoid: Array = []     ## [Vector2, rayon]
var placed: Array = []    ## objets posés
var rng := RandomNumberGenerator.new()
var rejects := {}

func _rej(why: String) -> void:
	rejects[why] = int(rejects.get(why, 0)) + 1

func run(tr: Node) -> void:
	StreetFurniture.enabled = false
	StreetFurniture.reload()
	rng.seed = 33
	w = World.load_world()
	var game: Node = Game
	game.mode = GameMode.CLASSIC
	game.new_game(1, "strasbourg", [], w)
	nav = w.nav
	col = w.collision
	_build_avoid(game)
	var reach := _reachable()
	var t0 := Time.get_ticks_msec()
	var wall_cands := _wall_candidates(reach)
	var plaza_cands := _plaza_candidates(reach)
	print("place-furniture : %d emplacements contre les façades, %d sur les places (%d ms)" % [wall_cands.size(), plaza_cands.size(), Time.get_ticks_msec() - t0])
	_place_wall(wall_cands)
	_place_plaza(plaza_cands)
	var counts := {}
	for it: Dictionary in placed:
		counts[it["kind"]] = int(counts.get(it["kind"], 0)) + 1
	print("place-furniture : %d objets %s ; rejets %s" % [placed.size(), counts, rejects])
	var out: Array = []
	for it: Dictionary in placed:
		out.append({"kind": it["kind"], "x": snappedf(float(it["x"]), 0.001), "z": snappedf(float(it["z"]), 0.001), "yaw": snappedf(float(it["yaw"]), 0.0001), "zone": int(it["zone"])})
	var f := FileAccess.open(OUT, FileAccess.WRITE)
	f.store_string(JSON.stringify({"note": "v0.33.1 : mobilier urbain ajouté, écrit par tests/test_place_furniture.gd (voir sim/street_furniture.gd)", "items": out}, "\t") + "\n")
	f.close()
	StreetFurniture.enabled = true
	StreetFurniture.reload()
	print("place-furniture : %d objets écrits dans %s" % [out.size(), OUT])
	tr.check(out.size() > 200, "place-furniture : %d objets placés" % out.size())

# ------------------------------------------------------------------ zones à éviter
func _add(p: Vector2, r: float) -> void:
	avoid.append([p, r])

func _build_avoid(game: Node) -> void:
	var o: Dictionary = w.objects
	for d: Dictionary in w.doors:
		for pt: Array in d["points"]:
			_add(Vector2(float(pt[0]), float(pt[1])), 5.0)
	for i in w.window_count():
		var wo := w.window_outside(i)
		var wi := w.window_inside(i)
		_add(Vector2(wo.x, wo.z), 3.5)
		_add(Vector2(wi.x, wi.z), 3.5)
	for m: Dictionary in o["machines"]:
		_add(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])), 4.0)
	for ww: Dictionary in o["wallWeapons"]:
		_add(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])), 4.0)
	for s: Dictionary in o["stations"]:
		_add(Vector2(float(s["x"]), float(s["z"])), 4.0)
	for b: Dictionary in o["bikeStations"]:
		_add(Vector2(float(b["x"]), float(b["z"])), 5.0)
	for pk: Dictionary in o["parkings"]:
		for pt: Dictionary in pk.get("points", []):
			_add(Vector2(float(pt["x"]), float(pt["z"])), 5.0)
	for v: Dictionary in o["vehicleSpawns"]:
		_add(Vector2(float(v["x"]), float(v["z"])), 6.0)
	_add(Vector2(w.start_pos.x, w.start_pos.z), 8.0)
	var rides: Rides = game.rides
	if rides != null:
		for pk: Dictionary in rides.parkings:
			if pk.get("pump") != null:
				_add(Vector2(float(pk["pump"]["x"]), float(pk["pump"]["z"])), 4.0)
			if pk.get("sign") != null:
				_add(Vector2(float(pk["sign"]["x"]), float(pk["sign"]["z"])), 2.5)
		if not rides.substation.is_empty():
			_add(Vector2(float(rides.substation["x"]), float(rides.substation["z"])), 5.0)
		var tmp := {}
		for t: TramTrack in rides.net.get("tracks", []):
			var s := 0.0
			while s <= t.L:
				t.at(s, tmp)
				_add(Vector2(float(tmp["x"]), float(tmp["z"])), 4.5)
				s += 1.5
	for l: Dictionary in w.levels.links:
		for p: Array in l["path"]:
			_add(Vector2(float(p[0]), float(p[2])), 5.0)
	# mode Zone unique : porte de sortie, départ, machines ajoutées des 27 zones (calculés sur un autre monde : setup le modifie)
	var w2 := World.load_world()
	for zi in w2.zone_names.size():
		var gm := GameMode.new(GameMode.ZONE, zi)
		if not gm.setup(w2):
			continue
		_add(Vector2(float(gm.exit["pos"]["x"]), float(gm.exit["pos"]["z"])), 7.0)
		_add(Vector2(gm.start.x, gm.start.z), 3.0)
		for m: Dictionary in gm.extra + gm.added_walls:
			_add(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])), 4.0)
	_avoid_grid()
	print("place-furniture : %d points à éviter" % avoid.size())

var _agrid := {}
func _avoid_grid() -> void:
	for i in avoid.size():
		var p: Vector2 = avoid[i][0]
		var r: float = avoid[i][1]
		for ix in range(int(floor((p.x - r - 2.0) / 8.0)), int(floor((p.x + r + 2.0) / 8.0)) + 1):   # + 2 m : rayon des objets (requête)
			for iz in range(int(floor((p.y - r - 2.0) / 8.0)), int(floor((p.y + r + 2.0) / 8.0)) + 1):
				var k := ix * 4096 + iz
				if not _agrid.has(k):
					_agrid[k] = []
				_agrid[k].append(i)

func _avoided(p: Vector2, extra: float) -> bool:
	for i: int in _agrid.get(int(floor(p.x / 8.0)) * 4096 + int(floor(p.y / 8.0)), []):
		if p.distance_to(avoid[i][0]) < float(avoid[i][1]) + extra:
			return true
	return false

# ------------------------------------------------------------------ cases atteignables (portes ouvertes) depuis le départ
func _reachable() -> PackedByteArray:
	var w3 := World.load_world()
	w3.open_all_doors()
	var n3 := w3.nav
	var lab: PackedInt32Array = n3.components()["labels"]
	var s := n3.idx(n3.cx(w3.start_pos.x), n3.cz(w3.start_pos.z))
	var si := n3.nearest_free(w3.start_pos.x, w3.start_pos.z)
	var l0 := lab[si if si >= 0 else s]
	var out := PackedByteArray()
	out.resize(lab.size())
	var n := 0
	for i in lab.size():
		if lab[i] == l0:
			out[i] = 1
			n += 1
	print("place-furniture : %d cases atteignables (portes ouvertes)" % n)
	return out

# ------------------------------------------------------------------ emplacements
func _zone_ok(x: float, z: float) -> bool:
	var zi := w.zone_of(x, z)
	return zi >= 0 and zi not in EXCLUDE_ZONES and not w.levels.in_hole(x, z)

func _ray(p: Vector2, d: Vector2, max_t: float) -> float:
	return col.ray_hit(p.x, 1.0, p.y, d.x, 0.0, d.y, max_t)

## Façades : { p (case), wall (point du mur), n (normale vers la rue), t (tangente), free (rue libre en face, m), zone }.
func _wall_candidates(reach: PackedByteArray) -> Array:
	var out: Array = []
	for iz in range(2, nav.nz - 2, 2):
		for ix in range(2, nav.nx - 2, 2):
			var i := iz * nav.nx + ix
			if reach[i] == 0 or nav.blocked[i] != 0:
				continue
			var push := Vector2.ZERO
			var nb := 0
			for dz in range(-2, 3):
				for dx in range(-2, 3):
					if maxi(absi(dx), absi(dz)) != 2:
						continue
					if nav.blocked[(iz + dz) * nav.nx + ix + dx] != 0:
						push -= Vector2(dx, dz)
						nb += 1
			if nb < 4 or nb > 7 or push.length() < 3.0:
				continue
			var p := Vector2(nav.world_x(ix), nav.world_z(iz))
			if not _zone_ok(p.x, p.y):
				continue
			var n0 := push.normalized()
			var t0 := _ray(p, -n0, 3.0)
			if t0 >= 3.0:
				continue
			var tg := n0.orthogonal()
			var t1 := _ray(p + tg * 1.1, -n0, 3.5)
			var t2 := _ray(p - tg * 1.1, -n0, 3.5)
			if t1 >= 3.5 or t2 >= 3.5:
				continue
			var a := p + tg * 1.1 - n0 * t1
			var b := p - tg * 1.1 - n0 * t2
			var tt := (a - b).normalized()
			var nn := tt.orthogonal()
			if nn.dot(n0) < 0.0:
				nn = -nn
			if nn.dot(n0) < 0.94:   # le mur doit faire face à la case (à 20° près)
				continue
			var wall := p - n0 * t0
			# le point du milieu est sur la droite des deux autres (mur droit, pas un renfoncement ni une colonne)
			if absf((wall - b).dot(nn)) > 0.05:
				continue
			var free := _ray(wall + nn * 0.05, nn, 14.0)
			out.append({"p": p, "wall": wall, "n": nn, "t": tt, "free": free, "zone": w.zone_of(p.x, p.y)})
	return out

## Places : { p, r (rayon libre en m, par pas de 0,75), zone }.
func _plaza_candidates(reach: PackedByteArray) -> Array:
	var out: Array = []
	for iz in range(12, nav.nz - 12, 3):
		for ix in range(12, nav.nx - 12, 3):
			var i := iz * nav.nx + ix
			if reach[i] == 0 or nav.blocked[i] != 0:
				continue
			var p := Vector2(nav.world_x(ix), nav.world_z(iz))
			if not _zone_ok(p.x, p.y):
				continue
			var r := 0
			for rr in range(2, 11):
				if not _ring_free(ix, iz, rr):
					break
				r = rr
			if r >= 4:
				out.append({"p": p, "r": r * nav.cell, "zone": w.zone_of(p.x, p.y)})
	return out

func _ring_free(ix: int, iz: int, r: int) -> bool:
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			if maxi(absi(dx), absi(dz)) != r or dx * dx + dz * dz > r * r + r:
				continue
			if nav.blocked[(iz + dz) * nav.nx + ix + dx] != 0:
				return false
	return true

# ------------------------------------------------------------------ contrôles d'un objet
## L'emprise ne touche aucune collision existante (ni objet déjà posé).
func _fits(it: Dictionary) -> bool:
	var kind := String(it["kind"])
	var K: Dictionary = StreetFurniture.KINDS[kind]
	var x := float(it["x"])
	var z := float(it["z"])
	var probes: Array = []
	if K.has("r"):
		probes.append([Vector2(x, z), float(K["r"]) + 0.03])
	else:
		var hw := float(K["w"]) * 0.5
		var hd := float(K["d"]) * 0.5
		var yaw := float(it["yaw"])
		var ax := Vector2(cos(yaw), -sin(yaw))
		var s := -hw + hd
		while s <= hw - hd + 1e-3:
			probes.append([Vector2(x, z) + ax * s, hd + 0.03])
			s += 0.2
	for pr: Array in probes:
		var q: Vector2 = pr[0]
		var r: float = pr[1]
		var res := col.resolve(Vector3(q.x, 0.2, q.y), r)
		if Vector2(res.x - q.x, res.z - q.y).length() > 1e-3:
			return false
	for o: Dictionary in _near_placed(Vector2(x, z), 6.0):
		var d := Vector2(float(o["x"]) - x, float(o["z"]) - z).length()
		if d < StreetFurniture.radius(kind) + StreetFurniture.radius(String(o["kind"])) + 0.6:
			return false
	return true

## Contrôle local de passage : dans la fenêtre autour de l'objet, les cases libres reliées avant le restent après (cases à moins de MARGIN
## de l'objet ou des objets déjà posés bloquées).
func _keeps_paths(it: Dictionary) -> bool:
	var cx := nav.cx(float(it["x"]))
	var cz := nav.cz(float(it["z"]))
	var x0 := cx - WIN
	var z0 := cz - WIN
	var n := 2 * WIN + 1
	var before := PackedByteArray()
	var after := PackedByteArray()
	before.resize(n * n)
	after.resize(n * n)
	var near: Array = [it]
	for o: Dictionary in _near_placed(Vector2(float(it["x"]), float(it["z"])), WIN * nav.cell + 4.0):
		if Vector2(float(o["x"]) - float(it["x"]), float(o["z"]) - float(it["z"])).length() < WIN * nav.cell + 4.0:
			near.append(o)
	for dz in n:
		for dx in n:
			var gx := x0 + dx
			var gz := z0 + dz
			var free := nav.inside(gx, gz) and nav.blocked[nav.idx(gx, gz)] == 0
			var wx := nav.world_x(gx)
			var wz := nav.world_z(gz)
			var under := false
			if free:
				for o: Dictionary in near:
					if StreetFurniture.dist_to(o, wx, wz) < MARGIN:
						under = true
						break
			var under_old := false
			if free:
				for o: Dictionary in near:
					if o != it and StreetFurniture.dist_to(o, wx, wz) < MARGIN:
						under_old = true
						break
			before[dz * n + dx] = 1 if free and not under_old else 0
			after[dz * n + dx] = 1 if free and not under else 0
	var lb := _labels(before, n)
	var la := _labels(after, n)
	var map := {}
	for i in n * n:
		if after[i] == 0:
			continue
		var b := lb[i]
		if map.has(b):
			if map[b] != la[i]:
				return false
		else:
			map[b] = la[i]
	return true

static func _labels(m: PackedByteArray, n: int) -> PackedInt32Array:
	var lab := PackedInt32Array()
	lab.resize(n * n)
	var next := 1
	var stack := PackedInt32Array()
	for s in n * n:
		if m[s] == 0 or lab[s] != 0:
			continue
		lab[s] = next
		stack.append(s)
		while not stack.is_empty():
			var i := stack[stack.size() - 1]
			stack.remove_at(stack.size() - 1)
			var x := i % n
			var z := i / n
			for d in [[1, 0], [-1, 0], [0, 1], [0, -1]]:
				var jx: int = x + int(d[0])
				var jz: int = z + int(d[1])
				if jx < 0 or jz < 0 or jx >= n or jz >= n:
					continue
				var j := jz * n + jx
				if m[j] != 0 and lab[j] == 0:
					lab[j] = next
					stack.append(j)
		next += 1
	return lab

const PG := 20.0   ## case de la grille des objets posés (m)
var _pgrid := {}     ## case -> objets posés

func _near_placed(p: Vector2, r: float) -> Array:
	var out: Array = []
	for ix in range(int(floor((p.x - r) / PG)), int(floor((p.x + r) / PG)) + 1):
		for iz in range(int(floor((p.y - r) / PG)), int(floor((p.y + r) / PG)) + 1):
			out.append_array(_pgrid.get(ix * 4096 + iz, []))
	return out

func _put(it: Dictionary) -> void:
	placed.append(it)
	var k := int(floor(float(it["x"]) / PG)) * 4096 + int(floor(float(it["z"]) / PG))
	if not _pgrid.has(k):
		_pgrid[k] = []
	_pgrid[k].append(it)

func _spaced(kind: String, p: Vector2, gap: float) -> bool:
	for o: Dictionary in _near_placed(p, gap):
		if String(o["kind"]) == kind and Vector2(float(o["x"]), float(o["z"])).distance_to(p) < gap:
			return false
	return true

## Essaie de poser `items` (un groupe) : tout ou rien.
func _try(items: Array) -> bool:
	for it: Dictionary in items:
		var p := Vector2(float(it["x"]), float(it["z"]))
		if _avoided(p, StreetFurniture.radius(String(it["kind"]))):
			_rej("à éviter")
			return false
		if not _zone_ok(p.x, p.y):
			_rej("zone")
			return false
		if not _fits(it):
			_rej("collision")
			return false
	var done: Array = []
	for it: Dictionary in items:
		if not _keeps_paths(it):
			_rej("passage")
			for d: Dictionary in done:   # tout ou rien : on retire les objets du groupe déjà posés
				placed.erase(d)
				var k := int(floor(float(d["x"]) / PG)) * 4096 + int(floor(float(d["z"]) / PG))
				_pgrid[k].erase(d)
			return false
		_put(it)
		done.append(it)
	return true

# ------------------------------------------------------------------ pose
func _shuffle(arr: Array) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var t: Variant = arr[i]
		arr[i] = arr[j]
		arr[j] = t

func _place_wall(cands: Array) -> void:
	_shuffle(cands)
	var counts := {}
	var k := 0
	for c: Dictionary in cands:
		var wall: Vector2 = c["wall"]
		var nn: Vector2 = c["n"]
		var tt: Vector2 = c["t"]
		for j in WALL_KINDS.size():   # sortes en rotation : on commence par une autre à chaque emplacement
			var spec: Array = WALL_KINDS[(k + j) % WALL_KINDS.size()]
			var kind: String = spec[0]
			if int(counts.get(kind, 0)) >= int(spec[1]) or float(c["free"]) < float(spec[3]):
				continue
			if not _spaced(kind, wall, float(spec[2])):
				continue
			var K: Dictionary = StreetFurniture.KINDS[kind]
			var depth := float(K["d"]) if K.has("d") else 2.0 * float(K["r"])
			# collés au mur (5 cm : pas de fente où un joueur serait pincé entre l'objet et le mur) ; bornes et lampadaires en bord de trottoir,
			# à 1,1 m du mur (le joueur, 0,8 m de large, passe derrière sans être coincé)
			var gap := 1.1 if kind in ["lamp", "bollard"] else 0.05
			var center := wall + nn * (gap + depth * 0.5)
			var yaw := atan2(nn.x, nn.y)   # +z local (avant) vers la rue
			var group: Array = []
			var nmax := int(spec[4])
			for gi in nmax:
				var off := (float(gi) - float(nmax - 1) * 0.5) * float(spec[5])
				var q := center + tt * off
				group.append({"kind": kind, "x": q.x, "z": q.y, "yaw": yaw, "zone": int(c["zone"])})
			# mur droit sur toute la longueur du groupe : rayons depuis les extrémités
			var half := (float(K["w"]) * 0.5 if K.has("w") else float(K["r"])) + float(spec[5]) * float(nmax - 1) * 0.5
			var ok := true
			for sgn in [-1.0, 1.0]:
				var from: Vector2 = wall + nn * 1.2 + tt * half * sgn
				var t := _ray(from, -nn, 2.0)
				if absf(t - 1.2) > 0.12:
					ok = false
			if not ok:
				_rej("mur courbe")
				continue
			if _try(group):
				counts[kind] = int(counts.get(kind, 0)) + 1
				k += 1
				break

func _place_plaza(cands: Array) -> void:
	_shuffle(cands)
	var counts := {}
	for spec: Array in PLAZA_KINDS:   # les grands objets d'abord (ils ont besoin des places les plus dégagées)
		var kind: String = spec[0]
		for c: Dictionary in cands:
			if int(counts.get(kind, 0)) >= int(spec[1]):
				break
			if float(c["r"]) < float(spec[3]):
				continue
			var p: Vector2 = c["p"]
			if not _spaced(kind, p, float(spec[2])):
				continue
			var yaw := rng.randf() * TAU if kind != "kiosk" else snappedf(rng.randf() * TAU, PI / 4.0)
			if _try([{"kind": kind, "x": p.x, "z": p.y, "yaw": yaw, "zone": int(c["zone"])}]):
				counts[kind] = int(counts.get(kind, 0)) + 1
