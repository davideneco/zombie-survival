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
			len.append(len[i - 1] + Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).length())
		l["len"] = len
		l["length"] = len[len.size() - 1]
		links.append(l)
	hole_polys = d["holePolys"]
	holes.clear()
	for poly: Array in hole_polys:
		_add_hole(poly)
	build()

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
