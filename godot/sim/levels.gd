class_name Levels
extends RefCounted
## Port de src/levels.js : étages praticables (balcons, escaliers, flèche de la cathédrale…). Triangles 3D rangés par région, grille de 4 m,
## floor_at(x, z, y) donne la hauteur du sol sous un point (le plus haut triangle situé sous y + marche). Le sol de la ville (y = 0) est
## implicite : région 0. Les liens (escaliers) sont chargés mais leur parcours par les zombies est du J3. Code pur.

const STEP := 0.6    ## hauteur maximale qu'on monte sans sauter (levels.js : STEP)
const CELL := 4.0

var tris: Array[Dictionary] = []
var holes: Array[Dictionary] = []   ## trous dans le sol de la ville (cages d'escalier descendantes)
var hole_polys: Array = []
var regions: Array[Dictionary] = []
var links: Array[Dictionary] = []
var grid: Dictionary = {}
var built := false
var navs: Dictionary = {}           ## région -> NavGrid (étages plats), voir nav_of / build_navs
var nav_collision: Collision        ## collision utilisée pour construire ces grilles
var _hop: Dictionary = {}           ## from * 1024 + to -> { link, dir, next } (BFS depuis chaque région)
var _hop_dist: Dictionary = {}      ## from * 1024 + to -> longueur du chemin d'escaliers
var _hops_built := false

static func _key(ix: int, iz: int) -> int:
	return ix * 8192 + iz

## Charge data/world/levels.json (cuit par tools/bake-world.mjs).
func load_json(d: Dictionary) -> void:
	tris.clear()
	for r: Array in d["tris"]:
		_add_tri(int(r[0]), r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9])
	regions.clear()
	for r: Dictionary in d["regions"]:
		regions.append(r)
	links.clear()
	for l: Dictionary in d["links"]:
		var len: Array[float] = [0.0]
		var path: Array = l["path"]
		for i in range(1, path.size()):
			var a: Array = path[i - 1]
			var b: Array = path[i]
			var ex: float = b[0] - a[0]
			var ey: float = b[1] - a[1]
			var ez: float = b[2] - a[2]
			len.append(len[i - 1] + _hypot3(ex, ey, ez))   # en doubles (Vector3 est en simple précision)
		l["len"] = len
		l["length"] = len[len.size() - 1]
		links.append(l)
	hole_polys = d["holePolys"]
	holes.clear()
	for poly: Array in hole_polys:
		_add_hole(poly)
	build()

## Math.hypot de V8 (mise à l'échelle par le plus grand terme, somme compensée) : les liens de même longueur se départagent comme dans le JS.
static func _hypot3(x: float, y: float, z: float) -> float:
	var m := maxf(absf(x), maxf(absf(y), absf(z)))
	if m == 0.0:
		return 0.0
	var sum := 0.0
	var comp := 0.0
	for v in [x, y, z]:
		var n: float = absf(v) / m
		var summand := n * n - comp
		var prelim := sum + summand
		comp = (prelim - sum) - summand
		sum = prelim
	return sqrt(sum) * m

## (en flottants et non en Vector3 : Vector3 est en simple précision, ce qui décalerait les hauteurs de ~1e-6)
func _add_tri(region: int, ax: float, ay: float, az: float, bx: float, by: float, bz: float, cx: float, cy: float, cz: float) -> void:
	var det := (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
	if absf(det) < 1e-9:
		return
	tris.append({
		"region": region, "x0": ax, "y0": ay, "z0": az, "x1": bx, "y1": by, "z1": bz, "x2": cx, "y2": cy, "z2": cz, "det": det,
		"minX": minf(ax, minf(bx, cx)), "maxX": maxf(ax, maxf(bx, cx)), "minZ": minf(az, minf(bz, cz)), "maxZ": maxf(az, maxf(bz, cz)),
	})

func _add_hole(poly: Array) -> void:
	var pts := PackedVector2Array()
	for p: Array in poly:
		pts.append(Vector2(p[0], p[1]))
	var idx := Geometry2D.triangulate_polygon(pts)
	for i in range(0, idx.size(), 3):
		var a := pts[idx[i]]
		var b := pts[idx[i + 1]]
		var c := pts[idx[i + 2]]
		holes.append({"x0": a.x, "z0": a.y, "x1": b.x, "z1": b.y, "x2": c.x, "z2": c.y})

func in_hole(x: float, z: float) -> bool:
	for t in holes:
		var d: float = (t["z1"] - t["z2"]) * (t["x0"] - t["x2"]) + (t["x2"] - t["x1"]) * (t["z0"] - t["z2"])
		if absf(d) < 1e-9:
			continue
		var l0: float = ((t["z1"] - t["z2"]) * (x - t["x2"]) + (t["x2"] - t["x1"]) * (z - t["z2"])) / d
		var l1: float = ((t["z2"] - t["z0"]) * (x - t["x2"]) + (t["x0"] - t["x2"]) * (z - t["z2"])) / d
		if l0 >= 0.0 and l1 >= 0.0 and l0 + l1 <= 1.0:
			return true
	return false

func build() -> void:
	grid.clear()
	for t in tris:
		for ix in range(int(floor(t["minX"] / CELL)), int(floor(t["maxX"] / CELL)) + 1):
			for iz in range(int(floor(t["minZ"] / CELL)), int(floor(t["maxZ"] / CELL)) + 1):
				var k := _key(ix, iz)
				if not grid.has(k):
					grid[k] = []
				grid[k].append(t)
	built = true

## Sol sous (x, z) pour un corps dont les pieds sont à la hauteur y. Remplit out = { y, region } ; renvoie out.
func floor_at(x: float, z: float, y: float, out: Dictionary) -> Dictionary:
	var best := -INF
	var reg := 0
	if y + STEP >= 0.0 and not (not holes.is_empty() and in_hole(x, z)):
		best = 0.0
	var arr: Variant = grid.get(_key(int(floor(x / CELL)), int(floor(z / CELL))))
	if arr != null:
		for t: Dictionary in arr:
			if x < t["minX"] or x > t["maxX"] or z < t["minZ"] or z > t["maxZ"]:
				continue
			var det: float = t["det"]
			var l0: float = ((t["z1"] - t["z2"]) * (x - t["x2"]) + (t["x2"] - t["x1"]) * (z - t["z2"])) / det
			var l1: float = ((t["z2"] - t["z0"]) * (x - t["x2"]) + (t["x0"] - t["x2"]) * (z - t["z2"])) / det
			var l2 := 1.0 - l0 - l1
			if l0 < -1e-6 or l1 < -1e-6 or l2 < -1e-6:
				continue
			var h: float = l0 * t["y0"] + l1 * t["y1"] + l2 * t["y2"]
			if h <= y + STEP and h > best:
				best = h
				reg = t["region"]
	if best == -INF:
		best = y
	out["y"] = best
	out["region"] = reg
	return out

func region_at(x: float, z: float, y: float) -> int:
	var o := {}
	floor_at(x, z, y, o)
	return o["region"]

## Le point (x, z) est-il sur un plancher de cette région ?
func in_region(region_id: int, x: float, z: float) -> bool:
	var arr: Variant = grid.get(_key(int(floor(x / CELL)), int(floor(z / CELL))))
	if arr == null:
		return false
	for t: Dictionary in arr:
		if t["region"] != region_id or x < t["minX"] or x > t["maxX"] or z < t["minZ"] or z > t["maxZ"]:
			continue
		var det: float = t["det"]
		var l0: float = ((t["z1"] - t["z2"]) * (x - t["x2"]) + (t["x2"] - t["x1"]) * (z - t["z2"])) / det
		var l1: float = ((t["z2"] - t["z0"]) * (x - t["x2"]) + (t["x0"] - t["x2"]) * (z - t["z2"])) / det
		if l0 >= -1e-6 and l1 >= -1e-6 and 1.0 - l0 - l1 >= -1e-6:
			return true
	return false

## Grille de navigation d'un étage plat, construite à la demande (levels.js : buildNavs, cases de 50 cm, marge 40 cm) ; null si la région n'en a pas.
func nav_of(region: int) -> NavGrid:
	if navs.has(region):
		return navs[region]
	if nav_collision == null or region <= 0 or region >= regions.size():
		return null
	var r: Dictionary = regions[region]
	if r["kind"] != "floor" or not _region_has_tris(region):
		return null
	var pt := PerfLog.t()
	navs[region] = NavGrid.build_region(self, region, nav_collision)
	PerfLog.note_load("grille d'étage", str(region), pt)
	return navs[region]

## v0.34.6 : grilles des étages calculées sur un fil de travail pendant le chargement (avant : une par image pendant le préchauffage, ~0,9 s) ; les grilles
## ne lisent que la collision et les régions (rien n'est modifié pendant le chargement). `finish_warm_navs` attend la fin et range les grilles absentes.
var _navs_task := -1
var _navs_built: Dictionary = {}

func start_warm_navs() -> void:
	if _navs_task >= 0 or nav_collision == null:
		return
	var todo: Array[int] = []
	for r in regions.size():
		if r > 0 and not navs.has(r) and regions[r]["kind"] == "floor" and _region_has_tris(r):
			todo.append(r)
	_navs_built = {}
	_navs_task = WorkerThreadPool.add_task(func() -> void:
		var out := {}
		for r in todo:
			out[r] = NavGrid.build_region(self, r, nav_collision)
		_navs_built = out, false, "floor nav grids")

func warm_navs_done() -> bool:
	return _navs_task < 0 or WorkerThreadPool.is_task_completed(_navs_task)

func finish_warm_navs() -> void:
	if _navs_task < 0:
		return
	WorkerThreadPool.wait_for_task_completion(_navs_task)
	_navs_task = -1
	for r: int in _navs_built:
		if not navs.has(r):
			navs[r] = _navs_built[r]
	_navs_built = {}

## Grille de navigation de chaque étage plat, d'un coup (outils et tests).
func build_navs(col: Collision, cell := 0.5, margin := 0.4) -> void:
	navs.clear()
	for r: Dictionary in regions:
		if r["kind"] != "floor" or not _region_has_tris(int(r["id"])):
			continue
		navs[int(r["id"])] = NavGrid.build_region(self, int(r["id"]), col, cell, margin)

func _region_has_tris(id: int) -> bool:
	for t in tris:
		if t["region"] == id:
			return true
	return false

# ------------------------------------------------------------------ liens (escaliers)
## Position (x, y, z) et cap à l'abscisse s le long du lien : { x, y, z, yaw }.
func point_on(link: Dictionary, s: float, out: Dictionary) -> Dictionary:
	var path: Array = link["path"]
	var len: Array = link["len"]
	s = maxf(0.0, minf(float(link["length"]), s))
	var i := 1
	while i < len.size() - 1 and len[i] < s:
		i += 1
	var seg: float = len[i] - len[i - 1]
	if seg == 0.0:
		seg = 1.0
	var f: float = (s - len[i - 1]) / seg
	var a: Array = path[i - 1]
	var b: Array = path[i]
	out["x"] = a[0] + (b[0] - a[0]) * f
	out["y"] = a[1] + (b[1] - a[1]) * f
	out["z"] = a[2] + (b[2] - a[2]) * f
	out["yaw"] = atan2(b[0] - a[0], b[2] - a[2])
	return out

## Abscisse du point du lien le plus proche de (x, y, z).
func project(link: Dictionary, x: float, z: float, y: float) -> float:
	var best := INF
	var bs := 0.0
	var path: Array = link["path"]
	var len: Array = link["len"]
	for i in range(1, path.size()):
		var a: Array = path[i - 1]
		var b: Array = path[i]
		var abx: float = b[0] - a[0]
		var abz: float = b[2] - a[2]
		var l2 := abx * abx + abz * abz
		var t: float = ((x - a[0]) * abx + (z - a[2]) * abz) / l2 if l2 > 0.0 else 0.0
		t = maxf(0.0, minf(1.0, t))
		var py: float = a[1] + (b[1] - a[1]) * t
		var dx: float = x - a[0] - abx * t
		var dz: float = z - a[2] - abz * t
		var d := sqrt(dx * dx + dz * dz) + absf(y - py) * 1.5
		if d < best:
			best = d
			bs = len[i - 1] + (len[i] - len[i - 1]) * t
	return bs

## Région « utile » d'un point sur un escalier : l'extrémité la plus proche (pour savoir où est le joueur).
func end_region(region_id: int, x: float, z: float, y: float) -> int:
	var R: Dictionary = regions[region_id]
	if R.get("link") == null:
		return region_id
	var L: Dictionary = links[int(R["link"])]
	var s := project(L, x, z, y)
	return int(L["a"]) if s < float(L["length"]) / 2.0 else int(L["b"])

## Prochain lien à emprunter depuis la région `from` pour rejoindre `to` : { link, dir (+1 : de a vers b), next }, {} si aucun.
func next_hop(from: int, to: int) -> Dictionary:
	if from == to:
		return {}
	if not _hops_built:
		_build_hops()
	return _hop.get(from * 1024 + to, {})

func _build_hops() -> void:
	var n := regions.size()
	var adj: Array = []
	for _i in n:
		adj.append([])
	for l in links:
		adj[int(l["a"])].append({"to": int(l["b"]), "link": l, "dir": 1})
		adj[int(l["b"])].append({"to": int(l["a"]), "link": l, "dir": -1})
	_hop.clear()
	_hop_dist.clear()
	for target in n:
		var dist: Array = []
		dist.resize(n)
		dist.fill(INF)
		dist[target] = 0.0
		var q: Array = [target]
		var h := 0
		while h < q.size():
			var u: int = q[h]
			h += 1
			for e: Dictionary in adj[u]:
				var to: int = e["to"]
				var nd: float = dist[u] + float(e["link"]["length"])
				if dist[to] > nd:
					dist[to] = nd
					_hop[to * 1024 + target] = {"link": e["link"], "dir": -int(e["dir"]), "next": u}
					q.append(to)
		for i in n:
			_hop_dist[i * 1024 + target] = dist[i]
	_hops_built = true

## Longueur du chemin d'escaliers entre deux régions (INF si non reliées).
func hop_distance(from: int, to: int) -> float:
	if from == to:
		return 0.0
	if not _hops_built:
		_build_hops()
	return _hop_dist.get(from * 1024 + to, INF)
