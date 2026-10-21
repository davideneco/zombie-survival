class_name ZoneLayout
extends RefCounted
## v0.26.0 : géométrie d'UNE zone de la carte, tirée de la grille de navigation (code pur, sans nœud). Sert au mode « Zone unique »
## (départ, porte de sortie au milieu de la zone, points d'apparition, emplacements des machines ajoutées) et à l'outil qui place les
## distributeurs des nouveaux atouts (tools/place-perks.gd, v0.27.0).
##
## La zone jouable est la plus grande composante connexe de cases LIBRES (blocked == 0) de la zone : les portes fermées sont des cases
## bloquées, la recherche ne sort donc jamais de la zone. Les graines de la recherche sont le centre de la zone, ses machines, ses armes
## murales et l'intérieur de ses fenêtres (une cour isolée ne peut pas être prise pour la zone).

var zone := -1
var cells := PackedInt32Array()     ## cases de la composante principale (indices de la grille)
var centroid := Vector2.ZERO        ## moyenne des cases (m)
var center := Vector2.ZERO          ## case de la composante la plus proche du centroïde (le « milieu » de la zone)
var area := 0.0                     ## m2 de la composante
var windows := PackedInt32Array()   ## fenêtres d'apparition de la zone
var ground := PackedVector2Array()  ## points d'apparition au sol (cases à 3 x 3 cases libres), échantillonnés
var _in := {}                       ## indice de case -> true (appartenance rapide)

## Calcule la disposition de la zone zi du monde w. Renvoie null si la zone n'a aucune case libre.
static func build(w: World, zi: int) -> ZoneLayout:
	var L := ZoneLayout.new()
	L.zone = zi
	var nav := w.nav
	var seeds: Array[Vector2] = []
	var z: Dictionary = w.objects["zones"][zi]
	var c: Variant = z.get("center")
	if c != null:
		seeds.append(Vector2(float(c["x"]), float(c["z"])))
	for m: Dictionary in w.objects["machines"]:
		if int(m.get("zone", -1)) == zi:
			seeds.append(Vector2(float(m["pos"]["x"]), float(m["pos"]["z"])))
	for ww: Dictionary in w.objects.get("wallWeapons", []):
		if int(ww.get("zone", -1)) == zi:
			seeds.append(Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"])))
	for i in w.window_count():
		if int(w.windows[i * World.WIN_STRIDE + 8]) == zi:
			L.windows.append(i)
	var stride := maxi(1, L.windows.size() / 24)
	for k in range(0, L.windows.size(), stride):
		var p := w.window_inside(L.windows[k])
		seeds.append(Vector2(p.x, p.z))
	var seen := {}
	var best := PackedInt32Array()
	for s in seeds:
		var start := _seed_cell(nav, s, zi)
		if start < 0 or seen.has(start):
			continue
		var comp := _flood(nav, start, zi, seen)
		if comp.size() > best.size():
			best = comp
	if best.is_empty():
		return null
	L.cells = best
	var sx := 0.0
	var sz := 0.0
	for i in best:
		L._in[i] = true
		sx += nav.world_x(i % nav.nx)
		sz += nav.world_z(i / nav.nx)
	L.centroid = Vector2(sx, sz) / float(best.size())
	L.area = best.size() * nav.cell * nav.cell
	L.center = L.nearest(nav, L.centroid, 3)
	if L.center == Vector2.INF:
		L.center = L.nearest(nav, L.centroid, 1)
	if L.center == Vector2.INF:
		L.center = L.nearest(nav, L.centroid, 0)
	var step := maxi(1, best.size() / 900)   # au plus ~900 points d'apparition au sol
	for k in range(0, best.size(), step):
		var i := best[k]
		if w.clearance(i % nav.nx, i / nav.nx, Rules.GROUND_CLEARANCE):
			L.ground.append(Vector2(nav.world_x(i % nav.nx), nav.world_z(i / nav.nx)))
	return L

## Case libre de la zone la plus proche du point (spirale de 16 cases), -1 si aucune.
static func _seed_cell(nav: NavGrid, p: Vector2, zi: int) -> int:
	var ix := nav.cx(p.x)
	var iz := nav.cz(p.y)
	for r in 17:
		for dz in range(-r, r + 1):
			for dx in range(-r, r + 1):
				if maxi(absi(dx), absi(dz)) != r:
					continue
				var jx := ix + dx
				var jz := iz + dz
				if not nav.inside(jx, jz):
					continue
				var i := nav.idx(jx, jz)
				if nav.blocked[i] == 0 and nav.zone[i] == zi:
					return i
	return -1

## Composante de cases libres de la zone zi (4-voisinage) qui contient `start` ; marque les cases dans `seen`.
static func _flood(nav: NavGrid, start: int, zi: int, seen: Dictionary) -> PackedInt32Array:
	var out := PackedInt32Array()
	var q := PackedInt32Array([start])
	seen[start] = true
	var head := 0
	var nx := nav.nx
	while head < q.size():
		var i := q[head]
		head += 1
		out.append(i)
		for j in [i - 1, i + 1, i - nx, i + nx]:
			if j < 0 or j >= nav.blocked.size() or seen.has(j):
				continue
			if nav.blocked[j] != 0 or nav.zone[j] != zi:
				continue
			seen[j] = true
			q.append(j)
	return out

func has_cell(i: int) -> bool:
	return _in.has(i)

## Le point est-il dans la zone jouable (case de la composante) ?
func contains(nav: NavGrid, x: float, z: float) -> bool:
	var ix := nav.cx(x)
	var iz := nav.cz(z)
	return nav.inside(ix, iz) and _in.has(nav.idx(ix, iz))

## Case de la composante, avec (2 r + 1)^2 cases libres autour, la plus proche du point p ; Vector2.INF si aucune.
func nearest(nav: NavGrid, p: Vector2, r: int, avoid: Array = [], min_d := 0.0) -> Vector2:
	var best := Vector2.INF
	var bd := INF
	for i in cells:
		var q := Vector2(nav.world_x(i % nav.nx), nav.world_z(i / nav.nx))
		var d := q.distance_squared_to(p)
		if d >= bd or not _far_from(q, avoid, min_d):
			continue
		if r > 0 and not _clear(nav, i, r):
			continue
		bd = d
		best = q
	return best

func _clear(nav: NavGrid, i: int, r: int) -> bool:
	var ix := i % nav.nx
	var iz := i / nav.nx
	for dz in range(-r, r + 1):
		for dx in range(-r, r + 1):
			var jx := ix + dx
			var jz := iz + dz
			if not nav.inside(jx, jz) or nav.blocked[nav.idx(jx, jz)] != 0:
				return false
	return true

static func _far_from(q: Vector2, avoid: Array, min_d: float) -> bool:
	for a: Vector2 in avoid:
		if q.distance_to(a) < min_d:
			return false
	return true

## Emplacement contre un mur pour une machine : case à 3 x 3 cases libres, dont l'anneau à 2 cases touche au moins `min_wall` cases
## bloquées d'un même côté (un mur, pas un poteau). Le plus proche de `near`, à au moins min_d m des points `avoid`. Renvoie
## { x, z, yaw } (la machine regarde à l'opposé du mur, convention three.js : +Z à yaw = 0) ou {} si rien.
## avoid2 / min_d2 : une seconde liste de points à tenir à une autre distance (porte de sortie, départ).
func wall_spot(nav: NavGrid, near: Vector2, avoid: Array, min_d: float, min_wall := 4, avoid2: Array = [], min_d2 := 0.0) -> Dictionary:
	var best := {}
	var bd := INF
	for i in cells:
		var q := Vector2(nav.world_x(i % nav.nx), nav.world_z(i / nav.nx))
		var d := q.distance_squared_to(near)
		if d >= bd or not _far_from(q, avoid, min_d) or not _far_from(q, avoid2, min_d2) or not _clear(nav, i, 1):
			continue
		var ix := i % nav.nx
		var iz := i / nav.nx
		var push := Vector2.ZERO
		var nb := 0
		for dz in range(-2, 3):
			for dx in range(-2, 3):
				if maxi(absi(dx), absi(dz)) != 2:
					continue
				var jx := ix + dx
				var jz := iz + dz
				if not nav.inside(jx, jz) or nav.blocked[nav.idx(jx, jz)] != 0:
					push -= Vector2(dx, dz)
					nb += 1
		if nb < min_wall or nb > 9 or push.length() < 3.0:   # 9 et plus : un recoin (fond d'impasse), on préfère un mur droit
			continue
		var dir := push.normalized()
		bd = d
		best = {"x": q.x, "z": q.y, "yaw": atan2(dir.x, dir.y)}
	return best
