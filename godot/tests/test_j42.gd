extends RefCounted
## v0.34.10 : measuring zombies that get stuck and how zombies appear (port-only, no JS golden), with ZombieWatch (sim/zombie_watch.gd):
## tours of both maps (doors bought one by one, the player walks into each new zone, waits and shoots the nearest zombie he sees), and the
## diagnostic log (--zombie-stuck-log). This version measures and prints (stuck episodes, lost zombies, teleports, appearances in view,
## walking distance at spawn, appearances right after a door); it only checks the tool itself. `--j42-diag` prints details.

const DT := 1.0 / 60.0
const WALK := 3.6        ## m/s: the scripted player walks (a little faster than a starting zombie)

var _diag := false

func run(t: Node) -> void:
	_diag = OS.get_cmdline_user_args().has("--j42-diag")
	_log(t)
	for m: Array in [["alpine", 5, 7, 20.0], ["strasbourg", 5, 5, 20.0]]:
		_tour(t, m[0], m[1], m[2], m[3])
	Game.mode = GameMode.CLASSIC

# ------------------------------------------------------------------ helpers
func _new(map: String, seed_value: int, mode := GameMode.CLASSIC, all_doors := false) -> void:
	Game.mode = mode
	Game.new_game(seed_value, map, Config.at("startWeapons", []))
	Game.player.max_health = 1.0e9
	Game.player.health = 1.0e9
	if all_doors:
		Game.world.open_all_doors()
		Game.env.nav.invalidate()

## The whole flow field around the player, at once (as the game's range).
func _full_field() -> NavGrid:
	var nav := Game.env.nav
	var F: Dictionary = Config.at("zombie.flow")
	var rng_m := float(F["range"])
	nav.job_active = false
	while nav.update_field(Game.field_targets(0), 1 << 30, roundi(rng_m / nav.cell * 10.0)):
		pass
	Game.flow_cool = 1.0e9   # the game keeps this field (the player does not move)
	return nav

func _zombie(p: Vector3, spd: float) -> ZombieSim:
	var z := Game.debug_spawn(p, spd)
	z.limp = false
	z.health = 1.0e9
	z.max_health = 1.0e9
	return z

func _free_point(nav: NavGrid, x: float, z: float, r := 3) -> Vector3:
	var c := nav.nearest_free(x, z, r)
	if c < 0:
		return Vector3.INF
	return Vector3(nav.world_x(c % nav.nx), 0.0, nav.world_z(c / nav.nx))

## --zombie-stuck-log: one JSON object per line (log header, game, spawns, summaries).
func _log(t: Node) -> void:
	var path := "user://test_j42_stuck_log.jsonl"
	var old := Game.watch
	var w := ZombieWatch.new()
	w.setup(PackedStringArray(["--zombie-stuck-log=" + path]), "")
	Game.watch = w
	_new("alpine", 121)
	for _f in int(40.0 / DT):
		Game.step(DT, {})
	w.close_log()
	Game.watch = old
	var txt := FileAccess.get_file_as_string(path)
	var kinds := {}
	var bad := 0
	for line in txt.split("\n", false):
		var d: Variant = JSON.parse_string(line)
		if typeof(d) != TYPE_DICTIONARY:
			bad += 1
			continue
		kinds[String(d.get("ev", "?"))] = true
	t.check(bad == 0 and kinds.has("log") and kinds.has("game") and kinds.has("spawn") and kinds.has("summary"), "--zombie-stuck-log: JSON lines (%s, %d unreadable)" % [kinds.keys(), bad])
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))

# ------------------------------------------------------------------ tours
## Door order from the open zones (each door opens a new zone), as test_j39 does.
func _door_order() -> Array:
	var w := Game.world
	var open := {}
	for zi in w.zone_names.size():
		if w.is_zone_open(zi):
			open[zi] = true
	var order: Array = []
	var used := {}
	var progress := true
	while progress:
		progress = false
		for d: Dictionary in w.doors:
			if used.has(int(d["id"])):
				continue
			var a := int(d["a"])
			var b := int(d["b"])
			if open.has(a) and not open.has(b):
				pass
			elif open.has(b) and not open.has(a):
				var tmp := a
				a = b
				b = tmp
			else:
				continue
			used[int(d["id"])] = true
			order.append([int(d["id"]), a, b])
			open[b] = true
			progress = true
	return order

## Points on each side of a door barrier: [side in zone a, side in zone b].
func _door_sides(d: Dictionary, za: int) -> Array:
	var p: Array = d["points"]
	var a := Vector2(p[0][0], p[0][1])
	var b := Vector2(p[p.size() - 1][0], p[p.size() - 1][1])
	var m := (a + b) / 2.0
	var tg := (b - a).normalized()
	var n := Vector2(-tg.y, tg.x)
	var s1 := m + n * 2.2
	var s2 := m - n * 2.2
	if Game.world.zone_of(s1.x, s1.y) != za:
		var tmp := s1
		s1 = s2
		s2 = tmp
	return [s1, s2]

## Grid path (world points) from the player to `to`, empty if none.
func _path(to: Vector2) -> Array[Vector2]:
	var nav := Game.world.nav
	var from := nav.nearest_free(Game.player.pos.x, Game.player.pos.z, 6)
	var goal := nav.nearest_free(to.x, to.y, 6)
	var out: Array[Vector2] = []
	if from < 0 or goal < 0:
		return out
	var cells := nav.bfs(from, goal)
	for c in cells:
		out.append(Vector2(nav.world_x(c % nav.nx), nav.world_z(c / nav.nx)))
	return out

var _kills := 0
var _shots := 0
var _shoot_t := 0.0
var _trace_id := -1
var _trace_t0 := 0.0
var _trace_t1 := 0.0
var _pi := 0

## One step: the player follows `path`, zombies that reach him are killed (he shoots them), the game steps.
func _step(path: Array[Vector2]) -> void:
	var p := Game.player
	if _pi < path.size():
		var left := WALK * DT
		while left > 0.0 and _pi < path.size():
			var q := path[_pi]
			var v := Vector2(q.x - p.pos.x, q.y - p.pos.z)
			var l := v.length()
			if l <= left:
				p.pos = Vector3(q.x, 0.0, q.y)
				left -= l
				_pi += 1
			else:
				p.pos += Vector3(v.x / l * left, 0.0, v.y / l * left)
				p.yaw = atan2(-v.x, -v.y)
				left = 0.0
	else:
		p.yaw += DT * 0.8   # he looks around while waiting
	p.vel = Vector3.ZERO
	p.health = p.max_health
	Game.step(DT, {"mx": 0.0, "mz": 0.0})
	if _trace_id >= 0 and Game.time >= _trace_t0 and Game.time <= _trace_t1 and fmod(Game.time, 0.25) < DT:
		for z in Game.zombies:
			if z.id == _trace_id:
				var nav := Game.env.nav
				var ok := nav.steer(z.pos.x, z.pos.z)
				print("trace t=%.2f (%.2f ; %.2f) y %.2f yaw %.2f spd %.2f moving %s att %s np %.2f stuck %.2f side %.2f lost %.2f spawn %s %.2f walk %.1f steer %s (%.2f ; %.2f) los %s blocked %s player (%.1f ; %.1f)" % [Game.time, z.pos.x, z.pos.z, z.pos.y, z.yaw, z.speed, z.moving, z.attacking, z.no_progress, z.stuck_t, z.sidestep_t, z.lost_t, z.spawn_type, z.spawn_t, nav.walk_distance(z.pos.x, z.pos.z), ok, nav.steer_x, nav.steer_z, nav.los(z.pos.x, z.pos.z, p.pos.x, p.pos.z), nav.is_blocked_at(z.pos.x, z.pos.z), p.pos.x, p.pos.z])
	for z in Game.zombies:
		if not z.dead and z.spawn_t <= 0.0 and Vector2(z.pos.x - p.pos.x, z.pos.z - p.pos.z).length() < 2.0:
			Game.hit_zombie(z, true, 1.0e9, 1.0)
			_kills += 1
	_shoot_t -= DT
	if _shoot_t <= 0.0:   # he shoots the nearest zombie he can see within 30 m, every 1.5 s (the rounds go on)
		_shoot_t = 1.5
		var best: ZombieSim = null
		var bd := 30.0
		for z in Game.zombies:
			if z.dead or not z.targetable():
				continue
			var d := Vector2(z.pos.x - p.pos.x, z.pos.z - p.pos.z).length()
			if d < bd and ZombieWatch.seen_by(p, Game.collision, z.pos + Vector3(0, 1.0, 0), 30.0, -1.0):
				bd = d
				best = z
		if best != null:
			Game.hit_zombie(best, true, 1.0e9, 1.0)
			_shots += 1

func _walk_to(to: Vector2, max_secs := 120.0) -> bool:
	var path := _path(to)
	_pi = 0
	var n := 0
	while _pi < path.size() and n < int(max_secs / DT):
		_step(path)
		n += 1
	return not path.is_empty() and _pi >= path.size()

func _wait(secs: float) -> void:
	var empty: Array[Vector2] = []
	_pi = 0
	for _i in int(secs / DT):
		_step(empty)

## A tour of the map: doors bought one by one, the player walks into each new zone and waits there; zombies spawn by the round director.
func _tour(t: Node, map: String, seed_value: int, n_doors: int, wait_s: float) -> void:
	_new(map, seed_value)
	Game.director.round_number = 5   # runners and crawlers, many zombies per round
	_kills = 0
	_shots = 0
	var t0 := Time.get_ticks_msec()
	var us0 := 0
	_wait(wait_s)
	var order := _door_order()
	var done := 0
	var door_times: Array[float] = []
	for e: Array in order.slice(0, n_doors):
		var d: Dictionary = Game.world.doors[int(e[0])]
		if d["open"]:
			continue
		var sides := _door_sides(d, int(e[1]))
		var ok := _walk_to(sides[0])
		Game.points = 1000000
		var bought := Game.use_door()
		if bought != int(e[0]) and not d["open"]:   # path cut or another door nearer: stand at the barrier and buy again
			var pt: Array = d["points"][(d["points"] as Array).size() / 2]
			var q := _free_point(Game.world.nav, float(pt[0]) + (sides[0].x - float(pt[0])) * 0.5, float(pt[1]) + (sides[0].y - float(pt[1])) * 0.5, 4)
			if q != Vector3.INF:
				Game.player.pos = q
			bought = Game.use_door()
		if _diag:
			print("j42 %s : porte %d (%s -> %s) %s, achat %d, t=%.0f s, %s" % [map, int(e[0]), Game.world.zone_names[int(e[1])], Game.world.zone_names[int(e[2])], "atteinte" if ok else "NON ATTEINTE", bought, Game.time, Game.watch.summary()])
		if bought < 0:
			continue
		done += 1
		door_times.append(Game.time)
		var zc: Dictionary = Game.world.objects["zones"][int(e[2])]["center"]
		_walk_to(Vector2(float(zc["x"]), float(zc["z"])))
		_wait(wait_s)
	var w := Game.watch
	print("j42 %s : %d portes, %.0f s de jeu (%.1f s réelles), %d tués au contact, %d abattus, manche %d ; %s" % [map, done, Game.time, (Time.get_ticks_msec() - t0) / 1000.0, _kills, _shots, Game.director.round_number, w.summary()])
	var walks: Array = []
	for s: Dictionary in w.spawn_list:
		walks.append(float(s["walk"]))
	walks.sort()
	if _diag:
		var by := {}
		for s: Dictionary in w.spawn_list:
			var k := "%s %s" % [s["type"], "vu" if s["seen"] else "caché"]
			by[k] = int(by.get(k, 0)) + 1
		print("  apparitions : %s" % [by])
		if not walks.is_empty():
			print("  marche à l'apparition : médiane %.0f m, 90 %% %.0f m, max %.0f m" % [walks[walks.size() / 2], walks[int(walks.size() * 0.9)], walks[-1]])
	t.check(done >= mini(n_doors, order.size()) - 1, "%s tour: doors bought (%d)" % [map, done])
	t.check(w.spawns > 30 and w.spawns_no_anim == 0, "%s tour: %d appearances measured, all by a window or from the ground" % [map, w.spawns])
	# measured (fixed in v0.34.11): stuck, lost, teleported zombies, appearances in view, far by walking, right after a door, in bulk
	var times: Array[float] = []
	for s: Dictionary in w.spawn_list:
		times.append(float(s["t"]))
	var after_door := 0
	for x in times:
		for dt0 in door_times:
			if x >= dt0 and x < dt0 + 2.0:
				after_door += 1
	print("j42 %s : mesures : %d immobiles avec chemin, %d perdus (pire %.0f s), %d téléportés (%d en vue), %d apparitions en vue sur %d, marche max %.0f m, %d apparitions dans les 2 s après une porte" % [
		map, w.still_path_events, w.lost_events, w.worst_lost, w.pops, w.pops_seen, w.spawns_seen, w.spawns, w.spawn_walk_max, after_door])
