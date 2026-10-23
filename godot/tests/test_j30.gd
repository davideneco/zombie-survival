extends RefCounted
## v0.23.x : géométrie de la ville. (1) aucun triangle cuit dont l'enroulement contredit ses normales (toits noirs, faces coupées) ; (2) aucun mur de collision
## de sol sans mur visible (aucune portion continue de 1,5 m sans face verticale à moins de 0,5 m, une fois les bouchons de data/world_patches.json dessinés)
## et le détecteur voit bien les murs invisibles connus sans les bouchons (l'Opéra) ; (3) échantillon de bâtiments fermés (anneaux de murs de sol fermés :
## contour entièrement dessiné, toit au-dessus). Équivalent GDScript, en coupe à y = 1 m, de tools/collision-scan.py. La géométrie cuite n'est pas versionnée :
## sans elle (data/world/tiles/), la suite le dit et passe (les outils Python restent la référence complète).

const DIR := "res://data/world/"
const PatchView := preload("res://scenes/world/patch_view.gd")
const FurnitureCheck := preload("res://tests/furniture_check.gd")
const CarCheck := preload("res://tests/car_check.gd")
const TOL := 0.5          ## m : distance d'une face verticale à un échantillon de mur (les bouchons commencent à 0,5 m)
const RUN_MAX := 1.5      ## m : portion continue sans face tolérée
const STEP := 0.5
const CELL := 4.0

var _tiles: Array = []   ## [{ pos, nor, idx, mat }] par surface
var _cuts: Dictionary = {}     ## case -> Array de [ax, az, bx, bz] : coupe à y = 1 m des faces verticales
var _roofs: Dictionary = {}    ## case (8 m) -> Array de [ax, az, bx, bz, cx, cz] : faces de toit
var _cut_list: Array = []      ## coupes des tuiles seulement (longueur >= 0,8 m)
var _inverted := 0
var _tris := 0

static func _json(p: String) -> Variant:
	return JSON.parse_string(FileAccess.get_file_as_string(p))

func _add_cut(a: Vector2, b: Vector2) -> void:
	var x0 := floori((minf(a.x, b.x) - TOL) / CELL)
	var x1 := floori((maxf(a.x, b.x) + TOL) / CELL)
	var z0 := floori((minf(a.y, b.y) - TOL) / CELL)
	var z1 := floori((maxf(a.y, b.y) + TOL) / CELL)
	for ix in range(x0, x1 + 1):
		for iz in range(z0, z1 + 1):
			var k := ix * 4096 + iz
			if not _cuts.has(k):
				_cuts[k] = []
			_cuts[k].append([a.x, a.y, b.x, b.y])

## Charge les tuiles : compte les triangles à l'envers, coupe les faces verticales à y = 1 m, range les faces de toit.
func _load_tiles() -> bool:
	var list: Dictionary = _json(DIR + "tiles.json")
	for tt: Dictionary in list["tiles"]:
		var path: String = DIR + "tiles/t%s.bin" % tt["key"]
		if not FileAccess.file_exists(path):
			return false
		var bytes := FileAccess.get_file_as_bytes(path)
		var hlen := bytes.decode_u32(4)
		var head: Dictionary = JSON.parse_string(bytes.slice(8, 8 + hlen).get_string_from_utf8())
		var base := 8 + hlen
		for s: Dictionary in head["surfaces"]:
			var nv := int(s["nv"])
			var ni := int(s["ni"])
			var pos := bytes.slice(base + int(s["pos"]), base + int(s["pos"]) + nv * 12).to_float32_array()
			var nor := bytes.slice(base + int(s["nor"]), base + int(s["nor"]) + nv * 12).to_float32_array()
			var idx := bytes.slice(base + int(s["idx"]), base + int(s["idx"]) + ni * 4).to_int32_array()
			for i in range(0, ni, 3):
				var a := idx[i] * 3
				var b := idx[i + 1] * 3
				var c := idx[i + 2] * 3
				var e1 := Vector3(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2])
				var e2 := Vector3(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2])
				var n := e1.cross(e2)
				var ln := n.length()
				_tris += 1
				if ln < 1e-6:
					continue
				var sn := Vector3(nor[a] + nor[b] + nor[c], nor[a + 1] + nor[b + 1] + nor[c + 1], nor[a + 2] + nor[b + 2] + nor[c + 2])
				if n.dot(sn) < 0.0:
					_inverted += 1
				var ymin := minf(pos[a + 1], minf(pos[b + 1], pos[c + 1]))
				var ymax := maxf(pos[a + 1], maxf(pos[b + 1], pos[c + 1]))
				var ny := absf(n.y) / ln
				if ny < 0.5 and ymin < 1.0 and ymax > 1.0:
					var cut: Array[Vector2] = []
					var ps := [a, b, c]
					for k in 3:
						var p: int = ps[k]
						var q: int = ps[(k + 1) % 3]
						var ya: float = pos[p + 1] - 1.0
						var yb: float = pos[q + 1] - 1.0
						if ya * yb < 0.0:
							var f := ya / (ya - yb)
							cut.append(Vector2(pos[p] + (pos[q] - pos[p]) * f, pos[p + 2] + (pos[q + 2] - pos[p + 2]) * f))
					if cut.size() == 2:
						_add_cut(cut[0], cut[1])
						if cut[0].distance_to(cut[1]) >= 0.8 and ymax >= 2.0:   # sous 2 m : contremarches, bordures (on les monte)
							_cut_list.append([cut[0].x, cut[0].y, cut[1].x, cut[1].y])
				elif ny > 0.3 and ymin > 2.0:
					var tri := [pos[a], pos[a + 2], pos[b], pos[b + 2], pos[c], pos[c + 2]]
					var x0 := floori(minf(pos[a], minf(pos[b], pos[c])) / 8.0)
					var x1 := floori(maxf(pos[a], maxf(pos[b], pos[c])) / 8.0)
					var z0 := floori(minf(pos[a + 2], minf(pos[b + 2], pos[c + 2])) / 8.0)
					var z1 := floori(maxf(pos[a + 2], maxf(pos[b + 2], pos[c + 2])) / 8.0)
					for ix in range(x0, x1 + 1):
						for iz in range(z0, z1 + 1):
							var key := ix * 4096 + iz
							if not _roofs.has(key):
								_roofs[key] = []
							_roofs[key].append(tri)
	return true

func _dist_cut(p: Vector2) -> float:
	var best := 1.0e9
	var k0 := floori(p.x / CELL)
	var k1 := floori(p.y / CELL)
	var arr: Array = _cuts.get(k0 * 4096 + k1, [])
	for s: Array in arr:
		var ab := Vector2(s[2] - s[0], s[3] - s[1])
		var l2 := ab.length_squared()
		var f := 0.0 if l2 < 1e-12 else clampf((p - Vector2(s[0], s[1])).dot(ab) / l2, 0.0, 1.0)
		best = minf(best, p.distance_to(Vector2(s[0], s[1]) + ab * f))
		if best < TOL:
			return best
	return best

## Plus longue portion continue (m) du segment sans face à moins de TOL, échantillons tous les STEP m.
func _unseen_run(ax: float, az: float, bx: float, bz: float) -> float:
	var l := Vector2(bx - ax, bz - az).length()
	var n := maxi(2, ceili(l / STEP))
	var run := 0
	var best := 0
	for i in n:
		var t := (i + 0.5) / n
		if _dist_cut(Vector2(ax + (bx - ax) * t, az + (bz - az) * t)) > TOL:
			run += 1
			best = maxi(best, run)
		else:
			run = 0
	return best * l / n

func _roof_at(x: float, z: float) -> bool:
	for tri: Array in _roofs.get(floori(x / 8.0) * 4096 + floori(z / 8.0), []):
		var d: float = (tri[3] - tri[5]) * (tri[0] - tri[4]) + (tri[4] - tri[2]) * (tri[1] - tri[5])
		if absf(d) < 1e-12:
			continue
		var l1: float = ((tri[3] - tri[5]) * (x - tri[4]) + (tri[4] - tri[2]) * (z - tri[5])) / d
		var l2: float = ((tri[5] - tri[1]) * (x - tri[4]) + (tri[0] - tri[4]) * (z - tri[5])) / d
		if l1 >= -1e-6 and l2 >= -1e-6 and l1 + l2 <= 1.0 + 1e-6:
			return true
	return false

static func _in_poly(x: float, z: float, p: PackedVector2Array) -> bool:
	var c := false
	var j := p.size() - 1
	for i in p.size():
		if (p[i].y > z) != (p[j].y > z) and x < (p[j].x - p[i].x) * (z - p[i].y) / (p[j].y - p[i].y) + p[i].x:
			c = not c
		j = i
	return c

func run(t: Node) -> void:
	if FileAccess.file_exists(DIR + "objects.json"):
		FurnitureCheck.new().run(t)   # v0.33.1 : mobilier urbain ajouté (tests/furniture_check.gd)
	CarCheck.new().run(t)   # v0.33.2 : quatre silhouettes de voiture (tests/car_check.gd)
	if not FileAccess.file_exists(DIR + "tiles/t5_3.bin"):
		print("géométrie cuite absente (non versionnée) : suite j30 sautée (node tools/bake-world.mjs la régénère)")
		t.check(true, "géométrie cuite absente : sautée")
		return
	var t0 := Time.get_ticks_msec()
	t.check(_load_tiles(), "70 tuiles chargées")
	print("j30 : %d triangles lus, %d coupes à y = 1 m, %d ms" % [_tris, _cuts.size(), Time.get_ticks_msec() - t0])
	# (1) enroulement
	t.check(_tris > 400000, "tuiles complètes (%d triangles)" % _tris)
	t.check(_inverted == 0, "aucun triangle dont l'enroulement contredit les normales (%d sur %d : re-cuire avec tools/bake-world.mjs)" % [_inverted, _tris])
	# (2) murs de collision sans mur visible
	var w := World.load_world()
	var skip: Dictionary = {}   # segments de portes : dessinés à part
	for d: Dictionary in w.doors:
		for si: int in d["segs"]:
			skip[si] = true
	var dyn: Array = []   # objets dessinés par des vues (machines, boîtes mystère, armes murales, vélos, parkings, rames)
	var o: Dictionary = w.objects
	for key in ["machines", "wallWeapons"]:
		for m: Dictionary in o[key]:
			dyn.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for key in ["stations", "bikeStations", "vehicleSpawns"]:
		for m: Dictionary in o[key]:
			dyn.append(Vector2(float(m["x"]), float(m["z"])))
	for pk: Dictionary in o["parkings"]:
		for q: Dictionary in pk["points"]:
			dyn.append(Vector2(float(q["x"]), float(q["z"])))
	var ground: Array = []
	for i in w.seg_list.size():
		var s: Dictionary = w.seg_list[i]
		if s["off"] or skip.has(i) or s["kind"] != "wall" or s["h"] != INF or s["y0"] != -INF:
			continue
		var mid := Vector2((s["ax"] + s["bx"]) * 0.5, (s["az"] + s["bz"]) * 0.5)
		var near_dyn := false
		for dp: Vector2 in dyn:
			if dp.distance_squared_to(mid) < 9.0:
				near_dyn = true
				break
		if not near_dyn:
			ground.append(i)
	var bad_before: Array = []
	for i: int in ground:
		var s: Dictionary = w.seg_list[i]
		if _unseen_run(s["ax"], s["az"], s["bx"], s["bz"]) >= RUN_MAX:
			bad_before.append(i)
	t.check(ground.size() > 40000, "%d segments de mur de sol examinés" % ground.size())
	var patches := PatchView.walls()
	t.check(patches.size() > 0, "bouchons de data/world_patches.json présents (%d)" % patches.size())
	var stale := 0
	for p: Dictionary in patches:   # chaque bouchon désigne encore un segment / cercle de la collision cuite, aux mêmes coordonnées
		if p.has("circle"):
			var c: Dictionary = w.collision.circles[int(p["circle"])]
			stale += 0 if absf(c["x"] - float(p["c"][0])) < 0.011 and absf(c["z"] - float(p["c"][1])) < 0.011 and absf(c["r"] - float(p["r"])) < 0.011 else 1
		else:
			var sg: Dictionary = w.seg_list[int(p["seg"])]
			stale += 0 if absf(sg["ax"] - float(p["a"][0])) < 0.011 and absf(sg["az"] - float(p["a"][1])) < 0.011 and absf(sg["bx"] - float(p["b"][0])) < 0.011 and absf(sg["bz"] - float(p["b"][1])) < 0.011 else 1
	t.check(stale == 0, "les bouchons correspondent à la collision cuite (%d périmés : relancer tools/collision-scan.py --patches)" % stale)
	# le détecteur voit les murs invisibles connus : sans bouchons, l'Opéra (portique de 49 m autour de 249, -390) en a
	var opera := 0
	for i: int in bad_before:
		var s: Dictionary = w.seg_list[i]
		if absf(s["ax"] - 249.0) < 20.0 and absf(s["az"] + 390.0) < 20.0:
			opera += 1
	t.check(opera >= 6, "le détecteur trouve les murs invisibles de l'Opéra avant bouchons (%d segments)" % opera)
	t.check(bad_before.size() > 0, "des murs invisibles existent dans la collision du JS (%d) : écart connu, bouchés à l'affichage" % bad_before.size())
	for p: Dictionary in patches:
		if not p.has("a") or float(p["y0"]) > 0.0:
			continue   # colonnes et parapets d'étage : hors du test de sol
		_add_cut(Vector2(float(p["a"][0]), float(p["a"][1])), Vector2(float(p["b"][0]), float(p["b"][1])))
	var bad: Array = []
	var bad_len := 0.0
	for i: int in ground:
		var s: Dictionary = w.seg_list[i]
		var r := _unseen_run(s["ax"], s["az"], s["bx"], s["bz"])
		if r >= RUN_MAX:
			bad.append(i)
			bad_len += r
	var lines: PackedStringArray = []
	for i: int in bad.slice(0, 8):
		var s: Dictionary = w.seg_list[i]
		lines.append("(%.1f, %.1f)->(%.1f, %.1f)" % [s["ax"], s["az"], s["bx"], s["bz"]])
	t.check(bad.size() == 0, "aucun mur de collision de sol sans mur visible sur 1,5 m de suite à 0,5 m près (%d segments, %.0f m : %s)" % [bad.size(), bad_len, ", ".join(lines)])
	# (3) bâtiments fermés : anneaux fermés de murs de sol
	var adj: Dictionary = {}
	for i: int in ground:
		var s: Dictionary = w.seg_list[i]
		for e in [Vector2i(roundi(s["ax"] * 100.0), roundi(s["az"] * 100.0)), Vector2i(roundi(s["bx"] * 100.0), roundi(s["bz"] * 100.0))]:
			if not adj.has(e):
				adj[e] = []
			adj[e].append(i)
	var used: Dictionary = {}
	var rings := 0
	var open_rings: Array = []
	var roofless: Array = []
	for i0: int in ground:
		if used.has(i0):
			continue
		var s0: Dictionary = w.seg_list[i0]
		var start := Vector2i(roundi(s0["ax"] * 100.0), roundi(s0["az"] * 100.0))
		var end := Vector2i(roundi(s0["bx"] * 100.0), roundi(s0["bz"] * 100.0))
		var ring: Array = [i0]
		var pts := PackedVector2Array([Vector2(s0["ax"], s0["az"])])
		used[i0] = true
		var ok := true
		while end != start:
			var nxt := -1
			if (adj[end] as Array).size() == 2:
				for j: int in adj[end]:
					if not used.has(j):
						nxt = j
			if nxt < 0:
				ok = false
				break
			used[nxt] = true
			ring.append(nxt)
			var sj: Dictionary = w.seg_list[nxt]
			var a := Vector2i(roundi(sj["ax"] * 100.0), roundi(sj["az"] * 100.0))
			pts.append(Vector2(end.x / 100.0, end.y / 100.0))
			end = Vector2i(roundi(sj["bx"] * 100.0), roundi(sj["bz"] * 100.0)) if a == end else a
		if not ok or ring.size() < 3:
			continue
		var minp := Vector2(1.0e9, 1.0e9)
		var maxp := Vector2(-1.0e9, -1.0e9)
		var area := 0.0
		for k in pts.size():
			minp = Vector2(minf(minp.x, pts[k].x), minf(minp.y, pts[k].y))
			maxp = Vector2(maxf(maxp.x, pts[k].x), maxf(maxp.y, pts[k].y))
			area += pts[k].x * pts[(k + 1) % pts.size()].y - pts[(k + 1) % pts.size()].x * pts[k].y
		if absf(area) * 0.5 < 30.0:
			continue
		rings += 1
		var unseen := 0.0
		var total := 0.0
		for i: int in ring:
			var s: Dictionary = w.seg_list[i]
			var l := Vector2(s["bx"] - s["ax"], s["bz"] - s["az"]).length()
			total += l
			unseen += _unseen_run(s["ax"], s["az"], s["bx"], s["bz"]) if l > 0.0 else 0.0
		if unseen > 0.03 * total:
			open_rings.append("(%.0f, %.0f) %.1f/%.1f m" % [pts[0].x, pts[0].y, unseen, total])
		var step := maxf(1.0, (maxp.x - minp.x) / 6.0)
		var inside := 0
		var covered := 0
		var x := minp.x + step * 0.5
		while x < maxp.x and inside < 12:
			var z := minp.y + step * 0.5
			while z < maxp.y and inside < 12:
				if _in_poly(x, z, pts):
					inside += 1
					covered += 1 if _roof_at(x, z) else 0
				z += step
			x += step
		if inside > 0 and float(covered) / inside < 0.66:
			roofless.append("(%.0f, %.0f)" % [pts[0].x, pts[0].y])
	t.check(rings >= 100, "%d bâtiments fermés échantillonnés (anneaux de murs de sol de plus de 30 m2)" % rings)
	t.check(open_rings.size() == 0, "contour de chaque bâtiment fermé dessiné (moins de 3 %% du pourtour sans face) : %s" % ", ".join(open_rings.slice(0, 6)))
	t.check(roofless.size() == 0, "chaque bâtiment fermé a un toit au-dessus de ses points intérieurs : %s" % ", ".join(roofless.slice(0, 6)))
	_sweep(t, w)
	_stairs(t, w)
	_facade(t, w)
	_cathedral_v32(t, w)
	_city_details(t, w)
	print("j30 : %d anneaux fermés ; %d murs de sol, %d sans face avant bouchons, %d après ; %d ms" % [rings, ground.size(), bad_before.size(), bad.size(), Time.get_ticks_msec() - t0])

## Balayage « le joueur ne traverse pas les murs visibles » : un cercle de 0,4 m (le joueur) avance de 1,5 m en deçà à 1,5 m au-delà d'une face verticale visible
## (coupe à y = 1 m), avec la collision seule (Collision.resolve, portes ouvertes), depuis les cases atteignables du départ. Il ne doit pas la franchir ; les
## traversées admises sont des détails de l'intérieur de la cathédrale (colonnes, nervures : sans collision dans le JS) et des angles de passages sous immeubles.
func _sweep(t: Node, w: World) -> void:
	w.open_all_doors()
	var nav := w.nav
	var comps := nav.components()
	var main_label := nav.label_of(nav.idx(nav.cx(w.start_pos.x), nav.cz(w.start_pos.z)))
	var col: Collision = w.collision
	var stride := 1   # toutes les coupes (≈ 13 000, ~6 s)
	var tested := 0
	var passed: PackedStringArray = []
	var i := 0
	while i < _cut_list.size():
		var c: Array = _cut_list[i]
		i += stride
		var a := Vector2(c[0], c[1])
		var b := Vector2(c[2], c[3])
		var p := (a + b) * 0.5
		var d := (b - a).normalized()
		var n := Vector2(-d.y, d.x)
		for side in [1.0, -1.0]:
			var s: Vector2 = p + n * side * 1.5
			var e: Vector2 = p - n * side * 1.5
			if not nav.inside(nav.cx(s.x), nav.cz(s.y)) or nav.label_of(nav.idx(nav.cx(s.x), nav.cz(s.y))) != main_label:
				continue
			tested += 1
			var pos := Vector3(s.x, 0.0, s.y)
			var dir := Vector3(e.x - s.x, 0.0, e.y - s.y).normalized()
			for _k in 44:
				pos = col.resolve(pos + dir * 0.075, 0.4)
			if (Vector2(pos.x, pos.z) - p).dot(n * side) < -0.05:
				passed.append("(%.1f, %.1f)" % [p.x, p.y])
	print("j30 : balayage de %d traversées de murs visibles, %d franchies %s" % [tested, passed.size(), ", ".join(passed.slice(0, 12))])
	t.check(tested > 1000, "%d traversées simulées" % tested)
	t.check(passed.size() == 0, "le joueur ne franchit aucun mur visible (hauteur >= 2 m) : %d franchies sur %d : %s" % [passed.size(), tested, ", ".join(passed.slice(0, 10))])

## v0.24.0 : les murs ajoutés (data/world_collision_extra.json) ne gênent aucun escalier / lien d'étage : on marche le long de chaque lien (points du chemin tous les 0,4 m,
## à leur hauteur) avec Collision.resolve, un cercle de 0,4 m, portes ouvertes ; le déplacement imposé par la collision ne doit pas être plus grand avec les murs
## ajoutés que sans eux (le JS a déjà quelques points serrés).
func _stairs(t: Node, w: World) -> void:
	w.open_all_doors()
	var col: Collision = w.collision
	var extra: Array = []
	for i in range(w.extra_first, w.seg_list.size()):
		extra.append(w.seg_list[i])
	t.check(extra.size() > 100, "%d murs ajoutés chargés" % extra.size())
	var worse: PackedStringArray = []
	var samples := 0
	for li in w.levels.links.size():
		var L: Dictionary = w.levels.links[li]
		var path: Array = L["path"]
		var pts: Array = []
		for k in range(1, path.size()):
			var a: Array = path[k - 1]
			var b: Array = path[k]
			var n := maxi(1, ceili(Vector3(b[0] - a[0], 0.0, b[2] - a[2]).length() / 0.4))
			for j in n + 1:
				var f := float(j) / n
				pts.append(Vector3(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f))
		for p: Vector3 in pts:
			samples += 1
			for e: Dictionary in extra:
				e["off"] = true
			var d0 := col.resolve(p, 0.4).distance_to(p)
			for e: Dictionary in extra:
				e["off"] = false
			var d1 := col.resolve(p, 0.4).distance_to(p)
			if d1 > d0 + 0.05:
				worse.append("lien %d (%.1f, %.1f, %.1f) %.2f -> %.2f" % [li, p.x, p.y, p.z, d0, d1])
	print("j30 : %d points d'escaliers testés, %d gênés par les murs ajoutés %s" % [samples, worse.size(), ", ".join(worse.slice(0, 6))])
	t.check(samples > 200, "%d points d'escaliers" % samples)
	t.check(worse.size() == 0, "les murs ajoutés ne gênent aucun escalier : %d points : %s" % [worse.size(), ", ".join(worse.slice(0, 6))])

## v0.24.2 : la peau de la façade ouest bloque (contreforts, portails latéraux bouchés, mur) mais le grand portail reste ouvert : on marche du parvis vers l'intérieur
## (axe s, à différents t), en cercle de 0,4 m, portes ouvertes.
func _facade(t: Node, w: World) -> void:
	w.open_all_doors()
	var col: Collision = w.collision
	var results := {}
	for tt: float in [0.0, 1.5, -1.5, 14.75, -13.0, 8.4, -8.4, 20.8, 26.0, -10.0, 4.5]:
		var a := Cathedral.P(-62.0, tt)
		var b := Cathedral.P(-44.0, tt)
		var pos := Vector3(a.x, 0.0, a.y)
		var dir := Vector3(b.x - a.x, 0.0, b.y - a.y).normalized()
		for _k in 260:
			pos = col.resolve(pos + dir * 0.075, 0.4)
		var s := (Vector2(pos.x, pos.z) - Cathedral.P(0.0, 0.0)).dot(Cathedral.P(1.0, 0.0) - Cathedral.P(0.0, 0.0))
		results[tt] = s
	print("j30 : façade, abscisse atteinte : ", results)
	for tt: float in [0.0, 1.5, -1.5]:
		t.check(float(results[tt]) > -45.5, "le grand portail reste franchissable (t = %.1f : s = %.1f)" % [tt, results[tt]])
	for tt: float in [14.75, -13.0, 8.4, -8.4, 20.8, 26.0]:
		t.check(float(results[tt]) < -49.0, "la façade bloque à t = %.1f (s = %.1f)" % [tt, results[tt]])


## v0.32.0 : extérieur refait de la cathédrale (scenes/world/cathedral_nave.gd, cathedral_east.gd, cathedral_tower.gd, cathedral_zone.gd). Décor seul :
## (1) aucun point de la géométrie ajoutée à hauteur d'homme ne se trouve sur du sol praticable loin d'un mur (cercle de 0,25 m que la collision ne repousse pas) :
## au sol (y < 2 m) et sur la plateforme du massif (67,5 à 69,5 m) ; (2) sur la pagode, rien dans le couloir de la rampe ; (3) le contour cuit n'est retiré
## qu'au-dessus de 11 m (contreforts / arcs-boutants OSM) ou de 31 m (ancien comble) : rien ne disparaît à hauteur d'homme.
func _cathedral_v32(t: Node, w: World) -> void:
	w.open_all_doors()
	var nav := w.nav
	var main_label := nav.label_of(nav.idx(nav.cx(w.start_pos.x), nav.cz(w.start_pos.z)))
	var col: Collision = w.collision
	var xf: Transform3D = load("res://scenes/world/cathedral_nave.gd").frame()
	var builders: Array = []
	for path in ["res://scenes/world/cathedral_nave.gd", "res://scenes/world/cathedral_east.gd", "res://scenes/world/cathedral_tower.gd", "res://scenes/world/cathedral_interior.gd"]:
		var b: RefCounted = load(path).new()
		b.build()
		for g: String in ["stone", "glass", "roof"]:
			if g in b:
				builders.append(b.get(g))
	var pts := 0
	var bad_ground: PackedStringArray = []
	var bad_plat: PackedStringArray = []
	var bad_ramp: PackedStringArray = []
	var tower := load("res://scenes/world/cathedral_tower.gd")
	var axis := Cathedral.tower_axis()
	for gb: RefCounted in builders:
		var vs: PackedVector3Array = gb.verts
		var i := 0
		while i + 2 < vs.size():
			var cand := [vs[i], vs[i + 1], vs[i + 2], (vs[i] + vs[i + 1] + vs[i + 2]) / 3.0]
			i += 3
			for lp: Vector3 in cand:
				var p: Vector3 = xf * lp
				pts += 1
				var lvl := -1.0
				if p.y < 2.0:
					lvl = 0.0
				elif (p.y >= 14.6 and p.y < 16.4) or (p.y >= 22.6 and p.y < 24.4):
					var st2 := Cathedral.st_of(p.x, p.z)
					if st2.x > -37.0 and st2.x < 28.0 and absf(st2.y) > 5.9 and absf(st2.y) < 9.0:
						lvl = 14.5 if p.y < 20.0 else 22.5   # galeries du triforium et du clair-étage (src/cath/upper.js ring)
				elif p.y >= 67.6 and p.y < 69.5:
					var st := Cathedral.st_of(p.x, p.z)
					if st.x > -51.8 and st.x < -27.2 and absf(st.y) < 25.8 and Vector2(p.x, p.z).distance_to(Cathedral.tower_axis()) > Cathedral.TOWER_R + 0.2:
						lvl = 67.5   # dalle praticable de la plateforme (src/cath/upper.js stripST(-52, -26, -27, 26)), hors octogone
				if lvl >= 0.0:
					if lvl == 0.0 and (not nav.inside(nav.cx(p.x), nav.cz(p.z)) or nav.label_of(nav.idx(nav.cx(p.x), nav.cz(p.z))) != main_label):
						continue
					var q := Vector3(p.x, lvl, p.z)
					var r := col.resolve(q, 0.25)
					if Vector2(r.x - q.x, r.z - q.z).length() < 1e-4:
						var list := bad_ground if lvl < 60.0 else bad_plat
						if list.size() < 400:
							list.append("(%.1f, %.1f, %.1f)" % [p.x, p.y, p.z])
				if p.y > Cathedral.TOWER_TOP + 0.3 and p.y < Cathedral.TOWER_TIP:
					var rr := Vector2(p.x, p.z).distance_to(axis)
					var rbv: float = tower.rb(p.y)
					if rr > rbv + 0.12 and rr < rbv + 1.25:
						bad_ramp.append("(%.1f, %.1f, %.1f) r %.2f" % [p.x, p.y, p.z, rr])
	print("j30 : cathédrale v0.32.0 : %d points de décor testés ; au sol libre %d, sur la plateforme %d, dans la rampe %d" % [pts, bad_ground.size(), bad_plat.size(), bad_ramp.size()])
	t.check(pts > 100000, "géométrie de l'extérieur de la cathédrale construite (%d points)" % pts)
	t.check(bad_ground.is_empty(), "aucun décor ajouté sur le sol praticable (rez-de-chaussée, galeries de la nef) : %s" % ", ".join(bad_ground.slice(0, 8)))
	t.check(bad_plat.is_empty(), "aucun décor ajouté sur la plateforme à hauteur d'homme : %s" % ", ".join(bad_plat.slice(0, 8)))
	t.check(bad_ramp.is_empty(), "rien dans le couloir de la rampe de la flèche : %s" % ", ".join(bad_ramp.slice(0, 8)))
	# (3) retraits du contour cuit
	var Z := load("res://scenes/world/cathedral_zone.gd")
	var low_drop := 0
	var probes := 0
	for s in range(-26, 28, 2):
		for tt in [-22.0, -19.5, -15.0, -9.6, 9.6, 15.0, 19.5, 22.0]:
			for y in [0.5, 4.0, 8.0, 10.5]:
				var c := Cathedral.P(float(s), float(tt))
				var a := Vector3(c.x, y, c.y)
				for role in ["flood", "facade", "roof"]:
					probes += 1
					if Z.classify(role, a, a + Vector3(0.3, 0.0, 0.0), a + Vector3(0.0, 0.3, 0.0)) == Z.DROP:
						low_drop += 1
	t.check(low_drop == 0, "le contour cuit de la cathédrale n'est jamais retiré sous 11 m (%d retraits sur %d sondes)" % [low_drop, probes])


## v0.32.2 : détails 3D de la ville (data/city_details.bin, tools/build-city-details.py) : fichier lisible et complet, et rien de ce qui descend à hauteur
## d'homme (descentes d'eau pluviale ; volets, jardinières, balcons et encadrements des baies basses) n'est posé sur du sol praticable loin d'un mur.
func _city_details(t: Node, w: World) -> void:
	var path := "res://data/city_details.bin"
	if not FileAccess.file_exists(path):
		print("j30 : data/city_details.bin absent (python3 tools/build-city-details.py) : contrôles des détails sautés")
		t.check(true, "détails de la ville absents : sautés")
		return
	var bytes := FileAccess.get_file_as_bytes(path)
	t.check(bytes.slice(0, 4).get_string_from_ascii() == "ZCD1", "city_details.bin : en-tête ZCD1")
	var hlen := bytes.decode_u32(4)
	var head: Dictionary = JSON.parse_string(bytes.slice(8, 8 + hlen).get_string_from_utf8())
	var expect := 8 + hlen + 4 * (int(head["windows"]) * 10 + int(head["gutters"]) * 7 + int(head["pipes"]) * 6 + int(head["chimneys"]) * 6 + int(head["ridges"]) * 6)
	t.check(bytes.size() == expect, "city_details.bin : taille cohérente avec l'en-tête (%d / %d octets)" % [bytes.size(), expect])
	t.check(int(head["windows"]) > 50000 and int(head["chimneys"]) > 500 and int(head["gutters"]) > 2000, "détails : %d fenêtres, %d gouttières, %d descentes, %d cheminées" % [head["windows"], head["gutters"], head["pipes"], head["chimneys"]])
	w.open_all_doors()
	var nav := w.nav
	var main_label := nav.label_of(nav.idx(nav.cx(w.start_pos.x), nav.cz(w.start_pos.z)))
	var col: Collision = w.collision
	var off := 8 + hlen
	var W := bytes.slice(off, off + int(head["windows"]) * 40).to_float32_array()
	off += int(head["windows"]) * 40 + int(head["gutters"]) * 28
	var P := bytes.slice(off, off + int(head["pipes"]) * 24).to_float32_array()
	var bad: PackedStringArray = []
	var tested := [0]
	var probe := func(x: float, z: float) -> void:
		if not nav.inside(nav.cx(x), nav.cz(z)) or nav.label_of(nav.idx(nav.cx(x), nav.cz(z))) != main_label:
			return
		tested[0] += 1
		var q := Vector3(x, 0.0, z)
		var r := col.resolve(q, 0.35)
		if Vector2(r.x - q.x, r.z - q.z).length() < 1e-4 and bad.size() < 200:
			bad.append("(%.1f, %.1f)" % [x, z])
	for i in P.size() / 6:
		probe.call(P[i * 6], P[i * 6 + 1])
	for i in W.size() / 10:
		var o := i * 10
		if W[o + 1] < 2.0:
			probe.call(W[o] + W[o + 3] * 0.2, W[o + 2] + W[o + 4] * 0.2)
	print("j30 : détails de la ville : %d points bas sur sol praticable testés, %d loin d'un mur" % [tested[0], bad.size()])
	t.check(bad.is_empty(), "descentes d'eau et baies basses contre un mur (à moins de 0,35 m d'une collision) : %s" % ", ".join(bad.slice(0, 8)))
