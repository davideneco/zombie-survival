class_name Collision
extends RefCounted
## Port de src/collision.js : cercles (joueur, zombies) contre segments et cercles, grille de 4 m, bandes de hauteur, boîtes dynamiques,
## enjambement et lancer de rayon. Code pur (aucun nœud, aucune physique Godot). Contrôlé par les golden de tests/test_j1.gd.
## Les obstacles sont des Dictionary partagés par référence (comme les objets JS) : "off" désactive, "stamp" évite les doublons de grille.
## Hauteurs infinies : INF / -INF (le JSON des golden les encode par null, voir tools/export-golden.mjs).

const WALK_OVER := 0.3      ## un obstacle au sol de cette hauteur ou moins (palette) ne bloque pas
const VAULT_MAX_H := 1.15   ## hauteur maximale d'un obstacle enjambable (m)

var half_x: float
var half_z: float
var cell: float
var segs: Array[Dictionary] = []
var circles: Array[Dictionary] = []
var floors: Array[Dictionary] = []
var vaults: Array[Dictionary] = []   ## { id, h, segs | circle }
var dyn: Dictionary = {}             ## clé -> { boxes, kind }
var grid: Dictionary = {}
var stamp := 0

func _init(hx: float = 30.0, hz: float = -1.0, c: float = 4.0) -> void:
	half_x = hx
	half_z = hx if hz < 0.0 else hz
	cell = c

func add_segment(ax: float, az: float, bx: float, bz: float, h: float = INF, y0: float = -INF, kind: String = "wall", vid: int = 0) -> Dictionary:
	var s := {"ax": ax, "az": az, "bx": bx, "bz": bz, "h": h, "y0": y0, "kind": kind, "vid": vid, "off": false, "stamp": 0}
	segs.append(s)
	return s

func add_circle(x: float, z: float, r: float, h: float = 4.0, y0: float = -INF, kind: String = "prop", vault: bool = false) -> Dictionary:
	var c := {"x": x, "z": z, "r": r, "h": h, "y0": y0, "kind": kind, "vid": 0, "off": false, "stamp": 0}
	if vault:
		c["vid"] = vaults.size() + 1
		vaults.append({"id": c["vid"], "h": h, "circle": c})
	circles.append(c)
	return c

func set_dynamic(key: Variant, boxes: Array, kind: String = "prop") -> void:
	var e: Dictionary
	if dyn.has(key):
		e = dyn[key]
	else:
		e = {"boxes": [], "kind": kind}
		dyn[key] = e
	e["boxes"] = []
	for b in boxes:
		var c := cos(float(b["rot"]))
		var s := sin(float(b["rot"]))
		var hx := float(b["w"]) / 2.0
		var hz := float(b["d"]) / 2.0
		var bh: float = b.get("h", 3.4)
		var rr := hx * hx + hz * hz
		var r2 := (sqrt(rr) + 1.2) * (sqrt(rr) + 1.2)
		e["boxes"].append({"x": b["x"], "z": b["z"], "hx": hx, "hz": hz, "c": c, "s": s, "h": bh, "r2": r2})

func clear_dynamic(key: Variant) -> void:
	dyn.erase(key)

## Dalles horizontales : tris = Array de [ax, az, bx, bz, cx, cz]
func add_floor(y: float, tris: Array) -> void:
	var min_x := INF
	var min_z := INF
	var max_x := -INF
	var max_z := -INF
	for t in tris:
		for i in range(0, 6, 2):
			min_x = minf(min_x, t[i])
			max_x = maxf(max_x, t[i])
			min_z = minf(min_z, t[i + 1])
			max_z = maxf(max_z, t[i + 1])
	floors.append({"y": y, "tris": tris, "minX": min_x, "maxX": max_x, "minZ": min_z, "maxZ": max_z})

func _blocks(it: Dictionary, y: float) -> bool:
	var y0: float = it["y0"]
	var h: float = it["h"]
	if y0 > -INF:
		return y + 1.7 > y0 and y < h - 0.3
	if h <= WALK_OVER:
		return false
	return h == INF or y < maxf(h - 0.35, 1.35)

func add_box(x: float, z: float, w: float, d: float, rot: float = 0.0, h: float = INF, y0: float = -INF, kind: String = "prop", vault: bool = false) -> void:
	var c := cos(rot)
	var s := sin(rot)
	var pts: Array = []
	for p in [[-w / 2.0, -d / 2.0], [w / 2.0, -d / 2.0], [w / 2.0, d / 2.0], [-w / 2.0, d / 2.0]]:
		pts.append([x + p[0] * c - p[1] * s, z + p[0] * s + p[1] * c])
	var vid := vaults.size() + 1 if vault else 0
	var bsegs: Array = []
	for i in 4:
		var a: Array = pts[i]
		var b: Array = pts[(i + 1) % 4]
		bsegs.append(add_segment(a[0], a[1], b[0], b[1], h, y0, kind, vid))
	if vault:
		vaults.append({"id": vid, "h": h, "segs": bsegs})

func _key(ix: int, iz: int) -> int:
	return ix * 4096 + iz

func _insert(item: Dictionary, min_x: float, min_z: float, max_x: float, max_z: float) -> void:
	var x0 := int(floor(min_x / cell))
	var x1 := int(floor(max_x / cell))
	var z0 := int(floor(min_z / cell))
	var z1 := int(floor(max_z / cell))
	for ix in range(x0, x1 + 1):
		for iz in range(z0, z1 + 1):
			var k := _key(ix, iz)
			if not grid.has(k):
				grid[k] = []
			grid[k].append(item)

## À appeler après tous les add_*()
func build() -> void:
	grid.clear()
	for s in segs:
		_insert(s, minf(s["ax"], s["bx"]), minf(s["az"], s["bz"]), maxf(s["ax"], s["bx"]), maxf(s["az"], s["bz"]))
	for c in circles:
		_insert(c, c["x"] - c["r"], c["z"] - c["r"], c["x"] + c["r"], c["z"] + c["r"])

## Enjambement (voir findVault) : renvoie { v, tIn, tOut, nx, nz } ou {} si rien.
func find_vault(ox: float, oz: float, ux: float, uz: float, reach: float) -> Dictionary:
	if vaults.is_empty():
		return {}
	var x0 := int(floor((ox - reach) / cell))
	var x1 := int(floor((ox + reach) / cell))
	var z0 := int(floor((oz - reach) / cell))
	var z1 := int(floor((oz + reach) / cell))
	var best: Dictionary = {}
	stamp += 1
	for ix in range(x0, x1 + 1):
		for iz in range(z0, z1 + 1):
			var arr: Variant = grid.get(_key(ix, iz))
			if arr == null:
				continue
			for it: Dictionary in arr:
				if int(it["vid"]) == 0 or it["stamp"] == stamp or it["off"]:
					continue
				it["stamp"] = stamp
				var v: Dictionary = vaults[int(it["vid"]) - 1]
				if float(v["h"]) > VAULT_MAX_H:
					continue
				var t_in := INF
				var t_out := -INF
				var nx := 0.0
				var nz := 0.0
				if v.has("circle"):
					var cc: Dictionary = v["circle"]
					var fx: float = cc["x"] - ox
					var fz: float = cc["z"] - oz
					var proj := fx * ux + fz * uz
					var d2 := fx * fx + fz * fz - proj * proj
					if d2 >= cc["r"] * cc["r"] or proj <= 0.0:
						continue
					var hw := sqrt(cc["r"] * cc["r"] - d2)
					t_in = proj - hw
					t_out = proj + hw
					var px: float = ox + ux * t_in - cc["x"]
					var pz: float = oz + uz * t_in - cc["z"]
					var l := sqrt(px * px + pz * pz)
					if l == 0.0:
						l = 1.0
					nx = px / l
					nz = pz / l
				else:
					for sg: Dictionary in v["segs"]:
						var ex: float = sg["bx"] - sg["ax"]
						var ez: float = sg["bz"] - sg["az"]
						var den := ux * ez - uz * ex
						if absf(den) < 1e-9:
							continue
						var ax: float = sg["ax"] - ox
						var az: float = sg["az"] - oz
						var tt := (ax * ez - az * ex) / den
						var uu := (ax * uz - az * ux) / den
						if uu < 0.0 or uu > 1.0 or tt < 0.0:
							continue
						if tt < t_in:
							t_in = tt
							var l2 := sqrt(ex * ex + ez * ez)
							if l2 == 0.0:
								l2 = 1.0
							nx = ez / l2
							nz = -ex / l2
							if nx * ux + nz * uz > 0.0:
								nx = -nx
								nz = -nz
						if tt > t_out:
							t_out = tt
					if t_in == INF:
						continue
					if t_out - t_in < 0.05:
						t_out = t_in + 0.05
				var best_in: float = best["tIn"] if not best.is_empty() else INF
				if t_in > reach or t_in >= best_in:
					continue
				best = {"v": v, "tIn": t_in, "tOut": t_out, "nx": nx, "nz": nz}
	return best

## Pousse pos (x, z) hors des obstacles et la garde dans la zone de jeu ; renvoie la nouvelle position (y inchangé).
## out (facultatif) : reçoit la poussée la plus forte { kind, push, nx, nz } (le bord de la zone compte comme un mur).
## ignore : clé d'un obstacle dynamique à ne pas compter.
func resolve(pos: Vector3, radius: float, out: Dictionary = {}, ignore: Variant = null, want_out: bool = false) -> Vector3:
	var px := pos.x
	var pz := pos.z
	var py := pos.y
	var best_push := 0.0
	var best_kind: Variant = null
	var bnx := 0.0
	var bnz := 0.0
	for _pass in 2:
		stamp += 1
		var x0 := int(floor((px - radius) / cell))
		var x1 := int(floor((px + radius) / cell))
		var z0 := int(floor((pz - radius) / cell))
		var z1 := int(floor((pz + radius) / cell))
		for ix in range(x0, x1 + 1):
			for iz in range(z0, z1 + 1):
				var arr: Variant = grid.get(_key(ix, iz))
				if arr == null:
					continue
				for it: Dictionary in arr:
					if it["stamp"] == stamp or it["off"]:
						continue
					it["stamp"] = stamp
					if not _blocks(it, py):
						continue
					var cx: float
					var cz: float
					var rr := radius
					if it.has("r"):
						cx = it["x"]
						cz = it["z"]
						rr += float(it["r"])
					else:
						var abx: float = it["bx"] - it["ax"]
						var abz: float = it["bz"] - it["az"]
						var len2 := abx * abx + abz * abz
						var t: float = ((px - it["ax"]) * abx + (pz - it["az"]) * abz) / len2 if len2 > 0.0 else 0.0
						t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
						cx = it["ax"] + abx * t
						cz = it["az"] + abz * t
					var dx := px - cx
					var dz := pz - cz
					var d2 := dx * dx + dz * dz
					if d2 < rr * rr and d2 > 1e-8:
						var d := sqrt(d2)
						var push := rr - d
						px += (dx / d) * push
						pz += (dz / d) * push
						if push > best_push:
							best_push = push
							best_kind = it["kind"]
							bnx = dx / d
							bnz = dz / d
	if not dyn.is_empty():
		for key in dyn:
			if ignore != null and key == ignore:
				continue
			var e: Dictionary = dyn[key]
			for b: Dictionary in e["boxes"]:
				if py >= float(b["h"]) - 0.3:
					continue
				var dx: float = px - b["x"]
				var dz: float = pz - b["z"]
				if dx * dx + dz * dz > float(b["r2"]) + radius * radius + 2.0 * radius:
					continue
				var lx: float = b["c"] * dx + b["s"] * dz
				var lz: float = -float(b["s"]) * dx + float(b["c"]) * dz
				var cx2 := maxf(-float(b["hx"]), minf(float(b["hx"]), lx))
				var cz2 := maxf(-float(b["hz"]), minf(float(b["hz"]), lz))
				var ex := lx - cx2
				var ez := lz - cz2
				var d2b := ex * ex + ez * ez
				if d2b >= radius * radius:
					continue
				var nx := 0.0
				var nz := 0.0
				var push2 := 0.0
				if d2b > 1e-8:
					var d := sqrt(d2b)
					push2 = radius - d
					nx = ex / d
					nz = ez / d
				elif float(b["hx"]) - absf(lx) < float(b["hz"]) - absf(lz):
					nx = -1.0 if lx < 0.0 else 1.0
					nz = 0.0
					push2 = float(b["hx"]) - absf(lx) + radius
				else:
					nx = 0.0
					nz = -1.0 if lz < 0.0 else 1.0
					push2 = float(b["hz"]) - absf(lz) + radius
				var wx: float = b["c"] * nx - b["s"] * nz
				var wz: float = b["s"] * nx + b["c"] * nz
				px += wx * push2
				pz += wz * push2
				if push2 > best_push:
					best_push = push2
					best_kind = e["kind"]
					bnx = wx
					bnz = wz
	var lim_x := half_x - radius
	var lim_z := half_z - radius
	var qx := maxf(-lim_x, minf(lim_x, px))
	var qz := maxf(-lim_z, minf(lim_z, pz))
	if want_out:
		var edge := sqrt((qx - px) * (qx - px) + (qz - pz) * (qz - pz))
		if edge > best_push:
			best_push = edge
			best_kind = "wall"
			bnx = (qx - px) / edge
			bnz = (qz - pz) / edge
		out["kind"] = best_kind
		out["push"] = best_push
		out["nx"] = bnx
		out["nz"] = bnz
	return Vector3(qx, py, qz)

## Lancer de rayon 3D contre les obstacles et le sol : distance t du premier obstacle, ou max_t.
func ray_hit(ox: float, oy: float, oz: float, dx: float, dy: float, dz: float, max_t: float) -> float:
	var best := max_t
	if dy < -1e-6 and oy > 0.0:
		best = minf(best, oy / -dy)
	for f: Dictionary in floors:
		if absf(dy) < 1e-6:
			break
		var t: float = (float(f["y"]) - oy) / dy
		if t <= 0.02 or t >= best:
			continue
		var px := ox + dx * t
		var pz := oz + dz * t
		if px < f["minX"] or px > f["maxX"] or pz < f["minZ"] or pz > f["maxZ"]:
			continue
		for tr: Array in f["tris"]:
			var d1: float = (px - tr[2]) * (tr[1] - tr[3]) - (tr[0] - tr[2]) * (pz - tr[3])
			var d2: float = (px - tr[4]) * (tr[3] - tr[5]) - (tr[2] - tr[4]) * (pz - tr[5])
			var d3: float = (px - tr[0]) * (tr[5] - tr[1]) - (tr[4] - tr[0]) * (pz - tr[1])
			if not ((d1 < 0.0 or d2 < 0.0 or d3 < 0.0) and (d1 > 0.0 or d2 > 0.0 or d3 > 0.0)):
				best = t
				break
	var h2 := sqrt(dx * dx + dz * dz)
	if h2 < 1e-9:
		return best
	var ux := dx / h2
	var uz := dz / h2
	var range2d := best * h2
	var ix := int(floor(ox / cell))
	var iz := int(floor(oz / cell))
	var sx := 1 if ux > 0.0 else -1
	var sz := 1 if uz > 0.0 else -1
	var tdx := absf(cell / ux) if absf(ux) > 1e-9 else INF
	var tdz := absf(cell / uz) if absf(uz) > 1e-9 else INF
	var tx := (((ix + 1) * cell - ox) if ux > 0.0 else (ox - ix * cell)) / absf(ux) if absf(ux) > 1e-9 else INF
	var tz := (((iz + 1) * cell - oz) if uz > 0.0 else (oz - iz * cell)) / absf(uz) if absf(uz) > 1e-9 else INF
	stamp += 1
	var best2d := range2d
	for _guard in 4000:
		var arr: Variant = grid.get(_key(ix, iz))
		if arr != null:
			for it: Dictionary in arr:
				if it["stamp"] == stamp or it["off"]:
					continue
				it["stamp"] = stamp
				var t := -1.0
				if it.has("r"):
					var fx: float = it["x"] - ox
					var fz: float = it["z"] - oz
					var proj := fx * ux + fz * uz
					var d2 := fx * fx + fz * fz - proj * proj
					if d2 < it["r"] * it["r"] and proj > 0.0:
						t = proj - sqrt(it["r"] * it["r"] - d2)
				else:
					var ex: float = it["bx"] - it["ax"]
					var ez: float = it["bz"] - it["az"]
					var den := ux * ez - uz * ex
					if absf(den) > 1e-9:
						var ax: float = it["ax"] - ox
						var az: float = it["az"] - oz
						var tt := (ax * ez - az * ex) / den
						var uu := (ax * uz - az * ux) / den
						if tt > 0.0 and uu >= 0.0 and uu <= 1.0:
							t = tt
				if t > 0.0 and t < best2d:
					var y := oy + dy * (t / h2)
					if y >= it["y0"] and y <= it["h"]:
						best2d = t
		var t_next := minf(tx, tz)
		if t_next > best2d:
			break
		if tx < tz:
			tx += tdx
			ix += sx
		else:
			tz += tdz
			iz += sz
	return best2d / h2
