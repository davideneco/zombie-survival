class_name TramTrack
extends RefCounted
## Voie du tram : port de src/tramTrack.js (Track, buildTracks, crossingOf, buildJunction). Code pur, sans nœud. Une ligne de CONFIG.tram.lines est
## une polyligne [[x, z, r?], ...] (x vers l'est, z vers le sud) ; la voie est échantillonnée tous les `step` m : position, cap et rayon de courbure
## local en chaque abscisse curviligne s. Le tram est une position 1D sur cette voie.
## Les tableaux d'échantillons sont des PackedFloat32Array, comme les Float32Array du JS : les valeurs sont arrondies de la même façon (golden à 1e-6).

var def: Dictionary
var id := ""
var track_name := ""
var step := 1.0
var n := 0
var x: PackedFloat32Array = PackedFloat32Array()
var z: PackedFloat32Array = PackedFloat32Array()
var s: PackedFloat32Array = PackedFloat32Array()
var tx: PackedFloat32Array = PackedFloat32Array()
var tz: PackedFloat32Array = PackedFloat32Array()
var R: PackedFloat32Array = PackedFloat32Array()   ## rayon de courbure local (m) ; INF en ligne droite
var L := 0.0
var cell := 8.0
var grid: Dictionary = {}
var warnings: PackedStringArray = PackedStringArray()
var stops: Array = []       ## arrêts { name, at, len, line, s } (posés par TramNetwork.plan)
var meta: Dictionary = {}   ## itinéraire d'aiguillage : voir make_route

func _init(def_: Dictionary, step_ := 1.0, min_r := 25.0) -> void:
	def = def_
	id = String(def_["id"])
	track_name = String(def_.get("name", id))
	step = step_
	var xs: Array[float] = []
	var zs: Array[float] = []
	if def_.has("samples"):
		for v: float in def_["samples"]["x"]:
			xs.append(v)
		for v: float in def_["samples"]["z"]:
			zs.append(v)
	else:
		_polyline(def_["pts"], xs, zs, min_r)
	n = xs.size()
	x.resize(n)
	z.resize(n)
	s.resize(n)
	tx.resize(n)
	tz.resize(n)
	R.resize(n)
	for i in n:
		x[i] = xs[i]
		z[i] = zs[i]
	for i in range(1, n):
		s[i] = s[i - 1] + _hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1])
	L = s[n - 1]
	for i in n:
		var a := maxi(0, i - 1)
		var b := mini(n - 1, i + 1)
		var dx := xs[b] - xs[a]
		var dz := zs[b] - zs[a]
		var l := _hypot(dx, dz)
		if l == 0.0:
			l = 1.0
		tx[i] = dx / l
		tz[i] = dz / l
	R.fill(INF)
	var win := maxi(1, roundi(3.0 / step))
	for i in range(win, n - win):
		var dth := atan2(tx[i - win] * tz[i + win] - tz[i - win] * tx[i + win], tx[i - win] * tx[i + win] + tz[i - win] * tz[i + win])
		var ds := s[i + win] - s[i - win]
		if absf(dth) > 1e-3:
			R[i] = ds / absf(dth)
	# grille de projection
	for i in n - 1:
		var x0 := minf(xs[i], xs[i + 1])
		var x1 := maxf(xs[i], xs[i + 1])
		var z0 := minf(zs[i], zs[i + 1])
		var z1 := maxf(zs[i], zs[i + 1])
		for gx in range(int(floor(x0 / cell)), int(floor(x1 / cell)) + 1):
			for gz in range(int(floor(z0 / cell)), int(floor(z1 / cell)) + 1):
				var k := gx * 8192 + gz
				if grid.has(k):
					grid[k].append(i)
				else:
					grid[k] = [i]

static func _hypot(a: float, b: float) -> float:
	return sqrt(a * a + b * b)

func _polyline(P: Array, xs: Array[float], zs: Array[float], min_r: float) -> void:
	var cnt := P.size()
	var seg_len := func(i: int) -> float:
		return _hypot(float(P[i + 1][0]) - float(P[i][0]), float(P[i + 1][1]) - float(P[i][1]))
	var dir_of := func(i: int) -> Array:
		var l: float = seg_len.call(i)
		return [(float(P[i + 1][0]) - float(P[i][0])) / l, (float(P[i + 1][1]) - float(P[i][1])) / l]
	var arcs: Array = []   # arcs[i - 1] : arc au sommet i (null : aucun)
	for i in range(1, cnt - 1):
		var u1: Array = dir_of.call(i - 1)
		var u2: Array = dir_of.call(i)
		var cr: float = u1[0] * u2[1] - u1[1] * u2[0]
		var dt: float = u1[0] * u2[0] + u1[1] * u2[1]
		var th := atan2(absf(cr), dt)
		if th < 1e-3:
			arcs.append(null)
			continue
		var rr := maxf(float(P[i][2]) if P[i].size() > 2 and P[i][2] != null else 30.0, min_r)
		var T := rr * tan(th / 2.0)
		arcs.append({"i": i, "r": rr, "T": T, "th": th, "sgn": signf(cr), "u1": u1, "u2": u2})
	for i in cnt - 1:
		var a: Variant = arcs[i - 1] if i - 1 >= 0 and i - 1 < arcs.size() else null
		var b: Variant = arcs[i] if i < arcs.size() else null
		var tt: float = (float(a["T"]) if a != null else 0.0) + (float(b["T"]) if b != null else 0.0)
		if tt > float(seg_len.call(i)) + 1e-6:
			warnings.append("%s segment %d-%d : tangentes %.1f m > longueur %.1f m" % [id, i, i + 1, tt, float(seg_len.call(i))])
	for i in cnt - 1:
		var a: Variant = arcs[i - 1] if i - 1 >= 0 and i - 1 < arcs.size() else null
		var b: Variant = arcs[i] if i < arcs.size() else null
		var u: Array = dir_of.call(i)
		var start: Array
		var end: Array
		if a != null:
			start = [float(P[i][0]) + u[0] * float(a["T"]), float(P[i][1]) + u[1] * float(a["T"])]
		else:
			start = [float(P[i][0]), float(P[i][1])]
		if b != null:
			end = [float(P[i + 1][0]) - u[0] * float(b["T"]), float(P[i + 1][1]) - u[1] * float(b["T"])]
		else:
			end = [float(P[i + 1][0]), float(P[i + 1][1])]
		var ln := _hypot(end[0] - start[0], end[1] - start[1])
		var k := maxi(1, roundi(ln / step))
		for j in range(0 if i == 0 else 1, k + 1):
			xs.append(start[0] + ((end[0] - start[0]) * j) / k)
			zs.append(start[1] + ((end[1] - start[1]) * j) / k)
		if b != null:
			var u1: Array = b["u1"]
			var sg: float = b["sgn"]
			var nx := -float(u1[1]) * sg
			var nz := float(u1[0]) * sg
			var cx: float = end[0] + nx * float(b["r"])
			var cz: float = end[1] + nz * float(b["r"])
			var a0 := atan2(end[1] - cz, end[0] - cx)
			var arc_len: float = float(b["r"]) * float(b["th"])
			var m := maxi(2, roundi(arc_len / step))
			for j in range(1, m + 1):
				var a1 := a0 + sg * (float(b["th"]) * j) / m
				xs.append(cx + cos(a1) * float(b["r"]))
				zs.append(cz + sin(a1) * float(b["r"]))

func clamp_s(v: float) -> float:
	return 0.0 if v < 0.0 else (L if v > L else v)

## Point de la voie à l'abscisse sv : out = { x, z, tx, tz, yaw, R } (yaw : cap du tram, l'avant est (-sin yaw, -cos yaw)).
func at(sv: float, out: Dictionary = {}) -> Dictionary:
	sv = clamp_s(sv)
	var lo := 0
	var hi := n - 1
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if s[mid] <= sv:
			lo = mid
		else:
			hi = mid
	var d := s[hi] - s[lo]
	var f := (sv - s[lo]) / d if d > 1e-9 else 0.0
	out["x"] = x[lo] + (x[hi] - x[lo]) * f
	out["z"] = z[lo] + (z[hi] - z[lo]) * f
	var ttx: float = tx[lo] + (tx[hi] - tx[lo]) * f
	var ttz: float = tz[lo] + (tz[hi] - tz[lo]) * f
	var l := _hypot(ttx, ttz)
	if l == 0.0:
		l = 1.0
	ttx /= l
	ttz /= l
	out["tx"] = ttx
	out["tz"] = ttz
	out["yaw"] = atan2(-ttx, -ttz)
	out["R"] = minf(R[lo], R[hi])
	return out

## Rayon de courbure minimal sur [s0, s1].
func min_radius(s0: float, s1: float) -> float:
	var r := INF
	for i in n:
		if s[i] >= s0 and s[i] <= s1 and R[i] < r:
			r = R[i]
	return r

## Projection de (px, pz) : { s, d (distance à la voie, m), side (+1 à droite de l'avant) } ; d = INF au-delà de `max_d`.
func project(px: float, pz: float, max_d := 12.0, out: Dictionary = {}) -> Dictionary:
	var g0x := int(floor((px - max_d) / cell))
	var g1x := int(floor((px + max_d) / cell))
	var g0z := int(floor((pz - max_d) / cell))
	var g1z := int(floor((pz + max_d) / cell))
	var best := INF
	var bs := 0.0
	var bside := 1.0
	for gx in range(g0x, g1x + 1):
		for gz in range(g0z, g1z + 1):
			var arr: Variant = grid.get(gx * 8192 + gz)
			if arr == null:
				continue
			for i: int in arr:
				var ax: float = x[i]
				var az: float = z[i]
				var bx: float = x[i + 1]
				var bz: float = z[i + 1]
				var ex := bx - ax
				var ez := bz - az
				var l2 := ex * ex + ez * ez
				var t := ((px - ax) * ex + (pz - az) * ez) / l2 if l2 > 0.0 else 0.0
				t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
				var qx := ax + ex * t
				var qz := az + ez * t
				var dd := _hypot(px - qx, pz - qz)
				if dd < best:
					best = dd
					bs = s[i] + t * sqrt(l2)
					bside = 1.0 if (ex * (pz - az) - ez * (px - ax)) >= 0.0 else -1.0
	out["s"] = bs
	out["d"] = best if best <= max_d else INF
	out["side"] = bside
	return out

# ====================================================================== réseau et aiguillages
## Toutes les voies d'un réseau (buildTracks) : { tracks: Array[TramTrack], by_id }. cfg : CONFIG.tram.
static func build_tracks(cfg: Dictionary) -> Dictionary:
	var tracks: Array[TramTrack] = []
	var by_id := {}
	for d: Dictionary in cfg["lines"]:
		var t := TramTrack.new(d, float(cfg.get("step", 1.0)), float(cfg.get("minRadius", 25.0)))
		tracks.append(t)
		by_id[t.id] = t
	return {"tracks": tracks, "by_id": by_id}

static func _cross2(ax: float, az: float, bx: float, bz: float) -> float:
	return ax * bz - az * bx

## Point où les polylignes A et B se croisent : { sa, sb, x, z, gap } (crossingOf), ou {} si elles ne se croisent pas.
static func crossing_of(A: TramTrack, B: TramTrack) -> Dictionary:
	var oa := {}
	var ob := {}
	var best := INF
	var sa := 0.0
	var sb := 0.0
	var sv := 0.0
	while sv < A.L:
		A.at(sv, oa)
		var p := B.project(oa["x"], oa["z"], 30.0, ob)
		if p["d"] < best:
			best = p["d"]
			sa = sv
			sb = p["s"]
		sv += 0.5
	if best == INF:
		return {}
	for _it in 30:
		A.at(sa, oa)
		sb = B.project(oa["x"], oa["z"], 30.0, ob)["s"]
		B.at(sb, ob)
		sa = A.project(ob["x"], ob["z"], 30.0, {})["s"]
	A.at(sa, oa)
	B.at(sb, ob)
	return {"sa": sa, "sb": sb, "x": (oa["x"] + ob["x"]) / 2.0, "z": (oa["z"] + ob["z"]) / 2.0, "gap": _hypot(oa["x"] - ob["x"], oa["z"] - ob["z"])}

## Itinéraire du bras `from_arm` vers le bras `to_arm` (makeRoute) : { id, from, to, track, connector, meta }.
static func make_route(J: Dictionary, by_id: Dictionary, X: Dictionary, from_arm: String, to_arm: String, r: float, stp: float) -> Dictionary:
	var af: Dictionary = J["arms"][from_arm]
	var at_: Dictionary = J["arms"][to_arm]
	var A: TramTrack = by_id[af["line"]]
	var B: TramTrack = by_id[at_["line"]]
	var da := 1.0 if int(af["end"]) == 0 else -1.0
	var db := 1.0 if int(at_["end"]) == 1 else -1.0
	var sa: float = float(X["arm"][from_arm]) - da * r
	var sb: float = float(X["arm"][to_arm]) + db * r
	var pa := {}
	var pb := {}
	var ta: Array
	var tb: Array
	var theta := 0.0
	var T := r
	for _it in 12:
		A.at(sa, pa)
		B.at(sb, pb)
		ta = [pa["tx"] * da, pa["tz"] * da]
		tb = [pb["tx"] * db, pb["tz"] * db]
		theta = atan2(_cross2(ta[0], ta[1], tb[0], tb[1]), ta[0] * tb[0] + ta[1] * tb[1])
		T = r * tan(absf(theta) / 2.0)
		var den := _cross2(ta[0], ta[1], tb[0], tb[1])
		var dx: float = pb["x"] - pa["x"]
		var dz: float = pb["z"] - pa["z"]
		var lam := _cross2(dx, dz, tb[0], tb[1]) / den
		var mu := _cross2(dx, dz, ta[0], ta[1]) / den
		sa += da * (lam - T)
		sb -= db * (-mu - T)
	A.at(sa, pa)
	B.at(sb, pb)
	ta = [pa["tx"] * da, pa["tz"] * da]
	tb = [pb["tx"] * db, pb["tz"] * db]
	theta = atan2(_cross2(ta[0], ta[1], tb[0], tb[1]), ta[0] * tb[0] + ta[1] * tb[1])
	var sgn := signf(theta)
	var arc_len := r * absf(theta)
	var m := maxi(2, roundi(arc_len / stp))
	var cx: float = pa["x"] + -ta[1] * sgn * r
	var cz: float = pa["z"] + ta[0] * sgn * r
	var a0 := atan2(pa["z"] - cz, pa["x"] - cx)
	var arc: Array = []
	for j in m + 1:
		var a1 := a0 + sgn * (absf(theta) * j) / m
		arc.append([cx + cos(a1) * r, cz + sin(a1) * r])
	var gx: float = pb["x"] - arc[m][0]
	var gz: float = pb["z"] - arc[m][1]
	for j in m + 1:
		arc[j][0] += gx * j / m
		arc[j][1] += gz * j / m
	var xs: Array = []
	var zs: Array = []
	var o := {}
	var len_a := sa if da > 0.0 else A.L - sa
	var k := 0.0
	while k < len_a:
		A.at(k if da > 0.0 else A.L - k, o)
		xs.append(o["x"])
		zs.append(o["z"])
		k += stp
	var i_arc0 := xs.size()
	for p: Array in arc:
		xs.append(p[0])
		zs.append(p[1])
	var i_arc1 := xs.size() - 1
	var len_b := B.L - sb if db > 0.0 else sb
	k = stp
	while k < len_b:
		B.at(sb + k if db > 0.0 else sb - k, o)
		xs.append(o["x"])
		zs.append(o["z"])
		k += stp
	B.at(B.L if db > 0.0 else 0.0, o)
	xs.append(o["x"])
	zs.append(o["z"])
	var rid := "%s>%s" % [from_arm, to_arm]
	var track := TramTrack.new({"id": rid, "name": "%s > %s" % [from_arm, to_arm], "samples": {"x": xs, "z": zs}}, stp)
	var axs: Array = []
	var azs: Array = []
	for p: Array in arc:
		axs.append(p[0])
		azs.append(p[1])
	var connector := TramTrack.new({"id": "C:" + rid, "name": "raccord " + rid, "samples": {"x": axs, "z": azs}}, stp)
	track.meta = {"id": rid, "from": from_arm, "to": to_arm, "aLine": A.id, "da": da, "sa": sa, "bLine": B.id, "db": db, "sb": sb, "theta": theta, "r": r, "T": T, "a0": track.s[i_arc0], "a1": track.s[i_arc1]}
	return {"id": rid, "from": from_arm, "to": to_arm, "track": track, "connector": connector, "meta": track.meta}

## Aiguillages (buildJunction) : { name, x, z, sNode, arms, routes, connectors, by_id } ; {} si les deux lignes ne se croisent pas.
## Les méthodes de l'objet JS (armOf, opposite, exitsFrom, routeFor) sont ici des fonctions statiques de TramTrack.
static func build_junction(J: Dictionary, by_id: Dictionary, stp := 1.0) -> Dictionary:
	var A: TramTrack = by_id[J["a"]]
	var B: TramTrack = by_id[J["b"]]
	var c := crossing_of(A, B)
	if c.is_empty() or float(c["gap"]) > 1.0:
		return {}
	var s_node := {J["a"]: c["sa"], J["b"]: c["sb"]}
	var X := {"arm": {}}
	for aid: String in J["arms"]:
		X["arm"][aid] = s_node[J["arms"][aid]["line"]]
	var routes: Array = []
	var connectors: Array = []
	for t: Dictionary in J["turns"]:
		var rt := make_route(J, by_id, X, t["from"], t["to"], float(t["r"]), stp)
		routes.append(rt)
		connectors.append(rt["connector"])
	var rb := {}
	for rt: Dictionary in routes:
		rb[rt["id"]] = rt["track"]
	return {"name": J["name"], "x": c["x"], "z": c["z"], "sNode": s_node, "arms": J["arms"], "turns": J["turns"], "routes": routes, "connectors": connectors, "by_id": rb}

## Bras d'arrivée : extrémité de la ligne `line` côté `end`.
static func arm_of(jn: Dictionary, line: String, dir: float) -> String:
	var end_ := 0 if dir > 0.0 else 1
	for aid: String in jn["arms"]:
		if jn["arms"][aid]["line"] == line and int(jn["arms"][aid]["end"]) == end_:
			return aid
	return ""

static func opposite(jn: Dictionary, arm: String) -> String:
	var a: Dictionary = jn["arms"][arm]
	for aid: String in jn["arms"]:
		if jn["arms"][aid]["line"] == a["line"] and int(jn["arms"][aid]["end"]) != int(a["end"]):
			return aid
	return ""
