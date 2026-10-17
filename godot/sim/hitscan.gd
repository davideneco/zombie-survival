class_name Hitscan
extends RefCounted
## Tir instantané : rayon contre les zombies (sphère de tête + boîte de corps, orientées par le cap) et contre les murs
## (Collision.ray_hit). Remplace le Raycaster de Three.js de player.js.

## Distance d'entrée d'un rayon (o, d unitaire) dans une sphère, ou -1.
static func ray_sphere(o: Vector3, d: Vector3, c: Vector3, r: float) -> float:
	var f := o - c
	var b := f.dot(d)
	var disc := b * b - (f.dot(f) - r * r)
	if disc < 0.0:
		return -1.0
	var t := -b - sqrt(disc)
	if t < 0.0:
		t = -b + sqrt(disc)   # origine dans la sphère
	return t if t >= 0.0 else -1.0

## Distance d'entrée dans une boîte alignée sur les axes (centre c, demi-tailles h), ou -1.
static func ray_box(o: Vector3, d: Vector3, c: Vector3, h: Vector3) -> float:
	var tmin := 0.0
	var tmax := INF
	for i in 3:
		var oi := o[i] - c[i]
		if absf(d[i]) < 1e-12:
			if absf(oi) > h[i]:
				return -1.0
			continue
		var t1 := (-h[i] - oi) / d[i]
		var t2 := (h[i] - oi) / d[i]
		if t1 > t2:
			var tmp := t1
			t1 = t2
			t2 = tmp
		tmin = maxf(tmin, t1)
		tmax = minf(tmax, t2)
		if tmin > tmax:
			return -1.0
	return tmin

## Rayon contre un zombie : { t, head } ou {} (le plus proche de la tête et du corps).
static func ray_zombie(o: Vector3, d: Vector3, max_t: float, z: ZombieSim) -> Dictionary:
	var cy := cos(z.yaw)
	var sy := sin(z.yaw)
	# monde -> repère du zombie : l = R(-yaw) (p - pos)
	var po := o - z.pos
	var lo := Vector3(po.x * cy - po.z * sy, po.y, po.x * sy + po.z * cy)
	var ld := Vector3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy)
	var sc := z.body_scale()
	if z is AngelSim:   # trompette (point faible, « tête »), ailes et corps (jamais « tête ») : angel.js _buildBody
		return _ray_angel(lo, ld, max_t, z as AngelSim, sc)
	var body_c := Rules.CRAWLER_BODY_CENTER if z.crawler else Vector3(0, Rules.ZOMBIE_BODY_CENTER_Y, 0)
	var body_h := Rules.CRAWLER_BODY_HALF if z.crawler else Rules.ZOMBIE_BODY_HALF
	var head_c := Rules.CRAWLER_HEAD if z.crawler else Rules.ZOMBIE_HEAD_CENTER
	var tb := ray_box(lo, ld, body_c * sc, body_h * sc)
	var th := -1.0
	if not z.headless:
		th = ray_sphere(lo, ld, head_c * sc, Rules.ZOMBIE_HEAD_RADIUS * sc.y)
	if tb < 0.0 and th < 0.0:
		return {}
	var head := th >= 0.0 and (tb < 0.0 or th <= tb)
	var t := th if head else tb
	if t > max_t:
		return {}
	return {"t": t, "head": head}

## L'Ange : boîte du corps et sphère de la tête de zombie (non « tête »), boîte des ailes, sphère de la trompette (« tête »).
static func _ray_angel(lo: Vector3, ld: Vector3, max_t: float, a: AngelSim, sc: Vector3) -> Dictionary:
	var best := INF
	var head := false
	var tb := ray_box(lo, ld, Vector3(0, Rules.ZOMBIE_BODY_CENTER_Y, 0) * sc, Rules.ZOMBIE_BODY_HALF * sc)
	if tb >= 0.0:
		best = tb
	var th := ray_sphere(lo, ld, Rules.ZOMBIE_HEAD_CENTER * sc, Rules.ZOMBIE_HEAD_RADIUS * sc.y)
	if th >= 0.0 and th < best:
		best = th
	var tw := ray_box(lo, ld, Vector3(0.0, 1.45, -0.28) * sc, Vector3(1.65, 0.75, 0.175) * sc)
	if tw >= 0.0 and tw < best:
		best = tw
	var tt := ray_sphere(lo, ld, a._trumpet_local() * sc, 0.3 * sc.y)
	if tt >= 0.0 and tt <= best:
		best = tt
		head = true
	if best == INF or best > max_t:
		return {}
	return {"t": best, "head": head}

## Tire un rayon : renvoie { hits: [{z, t, head}], wall_t } trié par distance ; hits coupé à `pierce` zombies et au mur.
static func cast(o: Vector3, d: Vector3, max_t: float, zombies: Array, col: Collision, pierce: int = 1) -> Dictionary:
	var wall_t := col.ray_hit(o.x, o.y, o.z, d.x, d.y, d.z, max_t)
	var hits: Array = []
	for z: ZombieSim in zombies:
		if not z.targetable():
			continue
		var h := ray_zombie(o, d, wall_t, z)
		if not h.is_empty():
			hits.append({"z": z, "t": h["t"], "head": h["head"]})
	hits.sort_custom(func(a, b): return a["t"] < b["t"])
	if hits.size() > pierce:
		hits.resize(pierce)
	return {"hits": hits, "wall_t": wall_t}
