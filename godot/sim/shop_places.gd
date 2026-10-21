class_name ShopPlaces
extends RefCounted
## v0.28.0 : where the wall weapon panels and the ammo stations of the Strasbourg map stand, for the views (scenes/world/shop_view.gd). Pure (no nodes).
## objects.json only keeps the interaction point of a wall weapon (0.6 m in front of its board, realworld.js addWallBuy) and the centre of a station,
## not their orientation. Both are recovered here from the world data, the same way the JS placed them:
##   - wall weapon : the board hangs on the nearest wall behind the interaction point. Rays at 1.5 m from that point (every 5 degrees) find the closest
##     wall; three parallel rays then give its exact direction. Board origin = point - 0.6 m along the outward normal. A board on two posts (no wall
##     within reach in the JS) has its own 1.6 x 0.2 m collision box: the hit is then nearer (0.5 m instead of 0.66 m) and `posts` is true;
##   - station : it faces the centre of its zone (realworld.js addStation: atan2(faceX - x, faceZ - z)).
## Local frame of the result (yaw = rotation.y): the face looks along +Z = (sin yaw, cos yaw).

const BOARD_BACK := 0.6          ## m : interaction point -> board origin (realworld.js: fx = x + sin(rot) * 0.6)
const RAY_Y := 1.5
const RAY_MAX := 1.4
const POSTS_BELOW := 0.58        ## m : a hit nearer than this is the post box (0.5 m), a wall is at 0.66 m

static func walls(world: World) -> Array:
	var out: Array = []
	if world == null:
		return out
	for ww: Dictionary in world.objects.get("wallWeapons", []):
		var p := Vector2(float(ww["pos"]["x"]), float(ww["pos"]["z"]))
		var best := RAY_MAX
		var best_a := -1.0
		for k in 72:
			var a := TAU * float(k) / 72.0
			var d := world.collision.ray_hit(p.x, RAY_Y, p.y, cos(a), 0.0, sin(a), RAY_MAX)
			if d < best - 1e-4:
				best = d
				best_a = a
		var e := {"id": String(ww["id"]), "name": String(ww["name"]), "price": int(ww["price"]), "ammoPrice": int(ww["ammoPrice"]),
			"zone": int(ww.get("zone", -1)), "front": Vector3(p.x, 0.0, p.y), "posts": false, "found": best_a >= 0.0}
		var n := Vector2(0.0, 1.0)
		if best_a >= 0.0:
			var dir := Vector2(cos(best_a), sin(best_a))
			var side := Vector2(-dir.y, dir.x)
			var h1 := world.collision.ray_hit(p.x - side.x * 0.35, RAY_Y, p.y - side.y * 0.35, dir.x, 0.0, dir.y, RAY_MAX + 0.6)
			var h2 := world.collision.ray_hit(p.x + side.x * 0.35, RAY_Y, p.y + side.y * 0.35, dir.x, 0.0, dir.y, RAY_MAX + 0.6)
			if h1 < RAY_MAX + 0.5 and h2 < RAY_MAX + 0.5 and absf(h1 - h2) < 0.3:   # flat wall: its tangent from the two hits
				var q1 := p - side * 0.35 + dir * h1
				var q2 := p + side * 0.35 + dir * h2
				var t := (q2 - q1).normalized()
				n = Vector2(-t.y, t.x)
				if n.dot(dir) > 0.0:
					n = -n
			else:
				n = -dir
			e["posts"] = best < POSTS_BELOW
			e["wall_d"] = best
		var o := p - n * BOARD_BACK
		e["pos"] = Vector3(o.x, 0.0, o.y)
		e["yaw"] = atan2(n.x, n.y)
		out.append(e)
	return out

static func stations(world: World) -> Array:
	var out: Array = []
	if world == null:
		return out
	var zones: Array = world.objects.get("zones", [])
	for s: Dictionary in world.objects.get("stations", []):
		var x := float(s["x"])
		var z := float(s["z"])
		var zi := int(s.get("zone", -1))
		var yaw := 0.0
		if zi >= 0 and zi < zones.size() and (zones[zi] as Dictionary).has("center"):
			var c: Dictionary = zones[zi]["center"]
			yaw = atan2(float(c["x"]) - x, float(c["z"]) - z)
		out.append({"pos": Vector3(x, 0.0, z), "yaw": yaw, "zone": zi})
	return out
