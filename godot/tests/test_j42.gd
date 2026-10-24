extends RefCounted
## v0.34.10 (measures) and v0.34.11 (fixes) : zombies that get stuck, and how zombies appear (port-only rules, no JS golden). Uses ZombieWatch (sim/zombie_watch.gd).
##   - units: view_hidden (window, ground, burrow), spawn_serial, NavGrid.steer_local / escape, anti-tunnel (a crowd never pushes a zombie
##     through a wall; the same crowd without the check is measured), furniture stamped in the Strasbourg grid (and removed by set_extras(false)),
##     the alpine flow field covers the whole station;
##   - stuck: zombies on the other side of a palisade come around; a zombie chases across a square around a kiosk; tours of both maps
##     (doors bought one by one, the player walks into each new zone): no zombie still with a known path, no zombie lost for long, no teleport;
##   - spawns: always animated (window, ground, burrow then window or ground), hidden from the player, within walking distance, never right
##     after a door, never in bulk; every mode (classic, zone, timed, arsenal) and the finale (waves, Tanner);
##   - recovery: a stuck zombie in view sinks into the ground and comes back elsewhere, hidden; a lost one comes back too;
##   - diagnostic log (--zombie-stuck-log): one JSON object per line.
## `--j42-diag` prints details (spawn kinds, walking distances).

const DT := 1.0 / 60.0
const WALK := 3.6        ## m/s: the scripted player walks (a little faster than a starting zombie)

var _diag := false

func run(t: Node) -> void:
	_diag = OS.get_cmdline_user_args().has("--j42-diag")
	for a in OS.get_cmdline_user_args():   # --j42-only=tour-alpine | tour-strasbourg : one part only (diagnostics)
		if a.begins_with("--j42-trace="):   # --j42-trace=ID,T0,T1 : prints a zombie's state every 0.25 s
			var f := a.substr(12).split(",")
			_trace_id = int(f[0])
			_trace_t0 = float(f[1])
			_trace_t1 = float(f[2])
	for a in OS.get_cmdline_user_args():
		if a == "--j42-only=modes":
			_modes(t)
			_modes(t)
			return
		if a == "--j42-only=spawns":
			_tunnel(t)
			_spawn_rules(t, "alpine")
			_spawn_rules(t, "strasbourg")
			return
		if a.begins_with("--j42-only=tour-"):
			_diag = true
			_tour(t, a.substr(16), 5, 7, 20.0)
			return
	_view_units(t)
	_nav_units(t)
	_tunnel(t)
	_furniture_nav(t)
	_alpine_field(t)
	_fence(t)
	_kiosk(t)
	_spawn_rules(t, "alpine")
	_spawn_rules(t, "strasbourg")
	_door_calm(t)
	_rescue(t)
	_finale_spawns(t)
	_modes(t)
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
	var rng_m := Game.world.flow_range if Game.world.flow_range > 0.0 else float(F["range"])
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

# ------------------------------------------------------------------ units
func _view_units(t: Node) -> void:
	var z := ZombieSim.new()
	var env := ZombieEnv.new()
	z.start_window_spawn(Vector3(0, 0, 0), Vector3(0, 0, 2), Vector3(0, 1.5, 1), Vector2(0, 1), 0.0, 0)
	t.check(z.spawn_serial == 1 and z.view_hidden(), "window spawn: hidden while it knocks (serial %d)" % z.spawn_serial)
	for _i in int((Rules.WIN_WARN + 0.1) / DT):
		z.step(DT, env)
	t.check(not z.view_hidden() and z.spawn_t > 0.0, "window spawn: shown while it climbs")
	z.start_ground_spawn(Vector3(5, 3.0, 5), 0.0)
	t.check(z.spawn_serial == 2 and z.view_hidden() and is_equal_approx(z.pos.y, 1.0), "ground spawn: hidden under the floor of its level (y %.2f)" % z.pos.y)
	while z.spawn_t > 0.0:
		z.step(DT, env)
	t.check(is_equal_approx(z.pos.y, 3.0) and not z.view_hidden(), "ground spawn: it ends standing on its level (y %.2f)" % z.pos.y)
	z.start_burrow()
	var y0 := z.pos.y
	var shown_while_sinking := not z.view_hidden()
	var ev := PackedStringArray()
	for _i in int((Rules.BURROW_TIME * 0.5) / DT):
		z.step(DT, env)
		ev.append_array(z.events)
		z.events.clear()
	var half_y := z.pos.y
	for _i in int((Rules.BURROW_TIME * 0.5 + 0.1) / DT):
		z.step(DT, env)
	t.check(shown_while_sinking and half_y < y0 - 0.2 and half_y > y0 - 1.9 and ev.has("burrow"), "burrow: shown while it sinks (y %.2f at half time from %.2f), dirt event" % [half_y, y0])
	t.check(z.burrowed() and z.view_hidden() and not z.targetable() and z.pos.y < y0 - 1.9, "burrow: then hidden underground and out of reach (y %.2f)" % z.pos.y)
	for _i in int(40.0 / DT):   # nobody gives it a place for a long time: it keeps waiting underground
		z.step(DT, env)
	t.check(z.burrowed() and z.spawn_t > 0.0, "burrow: it waits underground as long as needed")

func _nav_units(t: Node) -> void:
	# 12 x 12 grid, a wall column at ix = 6 (iz 0..8), target at the right; a zombie on the left must go down around the wall's end
	var g := NavGrid.new()
	g.nx = 12
	g.nz = 12
	g.cell = 1.0
	g.blocked = PackedByteArray()
	g.blocked.resize(144)
	for i in 12:
		g.blocked[g.idx(i, 0)] = 1
		g.blocked[g.idx(i, 11)] = 1
		g.blocked[g.idx(0, i)] = 1
		g.blocked[g.idx(11, i)] = 1
	for iz in range(0, 9):
		g.blocked[g.idx(6, iz)] = 1
	g._alloc()
	t.check(g.compute_field([Vector3(9.5, 0, 3.5)]), "small grid: field computed")
	t.check(g.steer_local(3.5, 3.5) and g.steer_z > 0.5, "steer_local: from behind the wall, it goes towards the wall's end (%.2f ; %.2f)" % [g.steer_x, g.steer_z])
	t.check(g.steer_local(5.5, 9.5) and g.steer_x > 0.5, "steer_local: under the wall's end, it turns right (%.2f ; %.2f)" % [g.steer_x, g.steer_z])
	t.check(not g.escape(3.5, 3.5, 3), "escape: nothing to do on a free cell")
	t.check(g.escape(6.5, 4.5, 3) and absf(g.steer_x) > 0.9, "escape: inside the wall, it heads for the nearest free cell (%.2f ; %.2f)" % [g.steer_x, g.steer_z])

## A crowd pushes towards a player behind a wall (no flow field: they walk straight at him). The separation of a tight crowd can push a zombie
## more than its radius in one step: without the check it would end on the player's side of the wall.
func _tunnel(t: Node) -> void:
	var crossed := [0, 0]
	for k in 2:
		ZombieSim.tunnel_check = k == 1
		var col := Collision.new(40.0, 40.0, 4.0)
		col.add_segment(-12.0, 0.0, 12.0, 0.0, INF, -INF, "wall")
		col.build()
		var env := ZombieEnv.new()
		var p := PlayerSim.new()
		p.reset(Vector3(0, 0, -3.0))   # far enough that the front zombies keep walking (and are pushed) instead of hitting
		env.players = [p]
		env.collision = col
		env.rng = RandomNumberGenerator.new()
		env.rng.seed = 42
		var zs: Array[ZombieSim] = []
		for i in 48:
			var z := ZombieSim.new()
			z.id = 900 + i
			z.speed = 3.8
			z.pos = Vector3(env.rng.randf_range(-0.1, 0.1), 0.0, 0.42 + env.rng.randf() * 0.1)
			zs.append(z)
		env.zombies = zs
		for _f in 600:
			for z in zs:
				z.step(DT, env)
		for z in zs:
			if z.pos.z < 0.0:
				crossed[k] += 1
	ZombieSim.tunnel_check = true
	print("j42 : foule de 48 zombies contre un mur : %d traversent sans le contrôle, %d avec" % [crossed[0], crossed[1]])
	t.check(crossed[1] == 0, "a crowd never pushes a zombie through a wall (%d crossed; %d without the check)" % [crossed[1], crossed[0]])

## Strasbourg: the added furniture (v0.33.1) blocks the navigation grid; set_extras(false) gives the JS grid back exactly.
func _furniture_nav(t: Node) -> void:
	var w := World.load_world()
	if w.furniture.is_empty():
		t.check(true, "furniture absent, skipped")
		return
	var n := w.furniture_cells.size()
	var stamped := w.nav.blocked.duplicate()
	var all_one := true
	for c in w.furniture_cells:
		all_one = all_one and w.nav.blocked[c] == 1
	t.check(n > 1000 and all_one, "furniture marked in the navigation grid (%d cells)" % n)
	w.set_extras(false)
	var diff := 0
	for i in stamped.size():
		if stamped[i] != w.nav.blocked[i]:
			diff += 1
	t.check(w.furniture_cells.is_empty() and diff == n, "set_extras(false): the %d furniture cells get their JS value back (%d changed)" % [n, diff])
	w.set_extras(true)
	t.check(w.nav.blocked == stamped and w.furniture_cells.size() == n, "set_extras(true): furniture marked again")

## The station's flow field reaches every free cell of the open map (CONFIG.zombie.flow.range = 160 m left far zombies without a direction).
func _alpine_field(t: Node) -> void:
	_new("alpine", 3, GameMode.CLASSIC, true)
	var nav := _full_field()
	var main := nav.label_of(nav.nearest_free(Game.player.pos.x, Game.player.pos.z))
	var free := 0
	var unreached := 0
	for i in nav.blocked.size():
		if nav.blocked[i] != 0 or nav.label_of(i) != main:
			continue
		free += 1
		if nav.dist[i] >= NavGrid.INF_D:
			unreached += 1
	# the same with the city's range, for the record
	nav.job_active = false
	while nav.update_field(Game.field_targets(0), 1 << 30, roundi(160.0 / nav.cell * 10.0)):
		pass
	var old := 0
	for i in nav.blocked.size():
		if nav.blocked[i] == 0 and nav.label_of(i) == main and nav.dist[i] >= NavGrid.INF_D:
			old += 1
	print("j42 : station, champ de flux : %d cases libres, %d sans chemin (portée 160 m : %d)" % [free, unreached, old])
	t.check(free > 50000 and unreached == 0, "alpine: the flow field reaches the whole station (%d of %d cells unreached)" % [unreached, free])

## Run the game until every zombie of `zs` is within `near` m of the player (or `secs` s); returns the time, -1 if some never came.
func _until_arrived(zs: Array[ZombieSim], near: float, secs: float) -> float:
	var p := Game.player
	for f in int(secs / DT):
		Game.step(DT, {})
		var all := true
		for z in zs:
			if Vector2(z.pos.x - p.pos.x, z.pos.z - p.pos.z).length() > near:
				all = false
		if all:
			return f * DT
	return -1.0

## Alpine palisades (thin walls between zones): the player stands against one, zombies start 3 m behind it on the other side. They must
## go around (no pushing against the palisade, no attack through it).
func _fence(t: Node) -> void:
	var D := AlpineMap.data()
	var tried := 0
	for wl: Dictionary in D["walls"]:
		if tried >= 3:
			break
		var a := Vector2(wl["a"][0], wl["a"][1])
		var b := Vector2(wl["b"][0], wl["b"][1])
		if float(wl["t"]) > AlpineMap.THICK or a.distance_to(b) < 20.0 or float(wl["h"]) < 2.0:
			continue
		_new("alpine", 50 + tried, GameMode.CLASSIC, true)
		Game.director.intermission = 1.0e9
		var nav := Game.env.nav
		var m := a.lerp(b, 0.5)
		var n := (b - a).normalized().orthogonal()
		var pp := m + n * 0.75
		if Game.world.zone_of(pp.x, pp.y) < 0 or Game.collision.resolve(Vector3(pp.x, 0, pp.y), 0.4).distance_to(Vector3(pp.x, 0, pp.y)) > 0.05:
			continue
		Game.player.pos = Vector3(pp.x, 0, pp.y)
		var nv := _full_field()
		var zs: Array[ZombieSim] = []
		var walks: Array[float] = []
		for k in 4:
			var q := _free_point(nav, m.x - n.x * 3.0 + (k - 1.5) * 1.5 * (b - a).normalized().x, m.y - n.y * 3.0 + (k - 1.5) * 1.5 * (b - a).normalized().y, 2)
			if q == Vector3.INF or nv.walk_distance(q.x, q.z) == INF:
				continue
			walks.append(nv.walk_distance(q.x, q.z))
			zs.append(_zombie(q, 2.6))
		if zs.is_empty():
			continue
		tried += 1
		Game.flow_cool = 0.0
		var longest := 0.0
		for wk in walks:
			longest = maxf(longest, wk)
		var limit := longest / 2.6 * 2.0 + 15.0
		var tt := _until_arrived(zs, 2.0, limit)
		print("j42 : palissade (%.0f ; %.0f) : %d zombies à %.0f m de marche, arrivés en %.1f s (limite %.0f s), %s" % [m.x, m.y, zs.size(), longest, tt, limit, Game.watch.summary()])
		t.check(tt > 0.0, "palisade at (%.0f ; %.0f): the zombies behind it come around to the player (%.0f m walk)" % [m.x, m.y, longest])
		t.check(Game.watch.still_path_events == 0, "palisade at (%.0f ; %.0f): no zombie still against it" % [m.x, m.y])
	t.check(tried >= 2, "palisades tested (%d)" % tried)

## Strasbourg: a zombie and the player on both sides of a kiosk (furniture added in v0.33.1, now in the grid): it goes around, never blocked.
func _kiosk(t: Node) -> void:
	_new("strasbourg", 61, GameMode.CLASSIC, true)
	Game.director.intermission = 1.0e9
	var found := 0
	for it: Dictionary in Game.world.furniture:
		if found >= 3:
			break
		if String(it["kind"]) != "kiosk" and String(it["kind"]) != "column":
			continue
		var c := Vector2(float(it["x"]), float(it["z"]))
		for ang: float in [0.0, PI * 0.5, PI, PI * 1.5]:
			var u := Vector2(cos(ang), sin(ang))
			var pa := c + u * 4.0
			var pb := c - u * 4.0
			var col := Game.collision
			if col.resolve(Vector3(pa.x, 0, pa.y), 0.4).distance_to(Vector3(pa.x, 0, pa.y)) > 0.01 or col.resolve(Vector3(pb.x, 0, pb.y), 0.4).distance_to(Vector3(pb.x, 0, pb.y)) > 0.01:
				continue
			if Game.world.nav.is_blocked_at(pa.x, pa.y) or Game.world.nav.is_blocked_at(pb.x, pb.y):
				continue
			for z in Game.zombies:
				z.dead = true
			Game.zombies.clear()
			Game.watch.reset("strasbourg")
			Game.player.pos = Vector3(pa.x, 0, pa.y)
			_full_field()
			var zs: Array[ZombieSim] = [_zombie(Vector3(pb.x, 0, pb.y), 2.2)]
			var tt := _until_arrived(zs, 1.8, 20.0)
			t.check(tt > 0.0 and tt < 8.0, "%s at (%.0f ; %.0f): the zombie goes around it in %.1f s" % [it["kind"], c.x, c.y, tt])
			t.check(Game.watch.blocked_events == 0, "%s at (%.0f ; %.0f): never blocked against it (%s)" % [it["kind"], c.x, c.y, Game.watch.summary()])
			found += 1
			break
	t.check(found >= 2, "kiosks and columns tested (%d)" % found)

# ------------------------------------------------------------------ spawns
## Sampled spawn points: open zone, by a window or from the ground, hidden from the player, within walking distance.
func _spawn_rules(t: Node, map: String) -> void:
	_new(map, 71)
	_full_field()
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	var got := 0
	var none := 0
	var bad: Array[String] = []
	var walk_max := 0.0
	var us_sum := 0
	var us_max := 0
	for k in 120:
		Game.player.yaw = rng.randf() * TAU
		Game.time += 5.0   # windows free again
		var t0 := Time.get_ticks_usec()
		var sp: Dictionary = Game._pick_spawn(true)
		var us := Time.get_ticks_usec() - t0
		us_sum += us
		us_max = maxi(us_max, us)
		if sp.is_empty():
			none += 1
			continue
		got += 1
		var at: Vector3
		var look: Vector3
		if String(sp["type"]) == "window":
			at = Game.world.window_outside(int(sp["index"]))
			look = Game.world.window_center(int(sp["index"]))
		else:
			at = sp["pos"]
			look = at + Vector3(0, 1.0, 0)
		var zi := Game.world.zone_of(at.x, at.z)
		var walk := Game._walk_at(at.x, at.z)
		var d := Vector2(at.x - Game.player.pos.x, at.z - Game.player.pos.z).length()
		walk_max = maxf(walk_max, walk)
		if not Game.world.is_zone_open(zi):
			bad.append("zone %d closed" % zi)
		if Game._seen(look):
			bad.append("%s seen at %.0f m" % [sp["type"], d])
		if walk > Rules.SPAWN_WALK_MAX2 or d > Rules.WORLD_SPAWN_MAX2:
			bad.append("%s at %.0f m straight, %.0f m walk" % [sp["type"], d, walk])
	print("j42 : %s : choix d'une place d'apparition %.2f ms en moyenne, pire %.2f ms" % [map, us_sum / 120000.0, us_max / 1000.0])
	t.check(got >= 100 and bad.is_empty(), "%s: %d spawn points sampled (%d without a hidden place), all in an open zone, hidden and within %.0f m walk (max %.0f m)%s" % [
		map, got, none, Rules.SPAWN_WALK_MAX2, walk_max, (" : " + bad[0]) if not bad.is_empty() else ""])

## No appearance right after a door is bought.
func _door_calm(t: Node) -> void:
	_new("alpine", 81)
	var d: Dictionary = Game.world.doors[0]
	var pt: Array = d["points"][(d["points"] as Array).size() / 2]
	var nav := Game.world.nav
	var q := _free_point(nav, float(pt[0]), float(pt[1]), 4)
	Game.player.pos = q
	Game.points = 100000
	var id := Game.use_door()
	t.check(id >= 0 and Game.spawn_calm_until > Game.time, "door bought: calm until %.1f s" % Game.spawn_calm_until)
	var n0 := Game.zombies.size()
	var ts := Game.director.to_spawn
	Game._spawn_zombie()
	t.check(Game.zombies.size() == n0 and Game.director.to_spawn == ts + 1, "door bought: the round's next zombie waits (postponed)")

## A stuck zombie in view sinks into the ground, then comes back by a window or from the ground, hidden; a lost one comes back too.
func _rescue(t: Node) -> void:
	_new("alpine", 91, GameMode.CLASSIC, true)
	Game.director.intermission = 1.0e9
	_full_field()
	var p := Game.player
	var fwd := Vector3(-sin(p.yaw), 0, -cos(p.yaw))
	var at := Vector3.INF
	for dd: float in [10.0, 8.0, 12.0, 6.0]:
		var c := p.pos + fwd * dd
		var q := _free_point(Game.world.nav, c.x, c.z, 2)
		if q != Vector3.INF and Game._seen(q + Vector3(0, 1, 0)):
			at = q
			break
	if at == Vector3.INF:
		for a in 16:   # turn until a free spot in front is seen
			p.yaw = a * TAU / 16.0
			fwd = Vector3(-sin(p.yaw), 0, -cos(p.yaw))
			var q2 := _free_point(Game.world.nav, p.pos.x + fwd.x * 9.0, p.pos.z + fwd.z * 9.0, 2)
			if q2 != Vector3.INF and Game._seen(q2 + Vector3(0, 1, 0)):
				at = q2
				break
	t.check(at != Vector3.INF, "rescue: a spot in view")
	if at == Vector3.INF:
		return
	var z := _zombie(at, 2.0)
	z.speed = 0.0   # it does not move: really stuck
	z.no_progress = 10.0
	Game.relocate_t = 0.0
	Game.step(DT, {})
	t.check(z.spawn_type == "burrow" and z.spawn_t > 0.0 and not z.view_hidden(), "stuck in view: it sinks into the ground (shown)")
	var back := false
	for _f in int(4.0 / DT):
		Game.step(DT, {})
		if z.spawn_type == "window" or z.spawn_type == "ground":
			back = true
			break
	var spot := z.spawn_outside if z.spawn_type == "window" else z.spawn_pos
	var look := z.spawn_center if z.spawn_type == "window" else spot + Vector3(0, 1, 0)
	t.check(back and z.spawn_t > 0.0 and z.view_hidden(), "stuck in view: it comes back by %s, hidden at first" % z.spawn_type)
	t.check(back and not Game._seen(look) and Game._walk_at(spot.x, spot.z) <= Rules.SPAWN_WALK_MAX2, "stuck in view: its new place is hidden and within walking distance (%.0f m)" % Game._walk_at(spot.x, spot.z))
	t.check(Game.watch.pops == 0, "stuck in view: never teleported (%d pops)" % Game.watch.pops)
	# lost (no direction): behind the player, out of view: it comes back at once
	var behind := _free_point(Game.world.nav, p.pos.x - fwd.x * 12.0, p.pos.z - fwd.z * 12.0, 3)
	var zl := _zombie(behind, 2.0)
	zl.lost_t = Rules.RESCUE_LOST + 1.0   # set right before the rescue pass (a step of the zombie would clear it: it has a direction here)
	Game.relocate_t = 0.0
	Game._relocate(DT)
	t.check(zl.spawn_type == "window" or zl.spawn_type == "ground", "lost out of view: it comes back at once by %s" % zl.spawn_type)
	t.check(Game.watch.pops == 0 and Game.watch.respawned >= 2, "rescue: %d respawns, %d pops" % [Game.watch.respawned, Game.watch.pops])

## Finale: wave zombies rise from the ground (city and station), the Tanner too.
func _finale_spawns(t: Node) -> void:
	for map: String in ["strasbourg", "alpine"]:
		_new(map, 101, GameMode.CLASSIC, true)
		var p := Game.player.pos
		var zb: ZombieSim = Game.finale.spawn_at("normal", 0, p.x + 8.0, p.z)
		t.check(zb.spawn_type == "ground" and zb.spawn_t > 0.0 and zb.view_hidden(), "%s finale: a wave zombie rises from the ground" % map)
		Game.director.round_number = int(Config.at("tanner.fromRound"))
		var ok: bool = Game.finale.maybe_spawn_tanner()
		var tn: ZombieSim = Game.zombies[-1]
		t.check(ok and tn is TannerSim and tn.spawn_type == "ground" and tn.spawn_t > 0.0, "%s finale: the Tanner rises from the ground" % map)
		for _f in int((Rules.GND_DELAY + Rules.GND_RISE + 0.2) / DT):
			Game.step(DT, {})
		t.check(tn.spawn_t <= 0.0 and is_equal_approx(tn.pos.y, 0.0), "%s finale: the Tanner stands up (y %.2f)" % [map, tn.pos.y])
		t.check(Game.watch.spawns_no_anim == 0, "%s finale: no appearance without animation (%d)" % [map, Game.watch.spawns_no_anim])

## Every mode: appearances animated and hidden, no teleport.
func _modes(t: Node) -> void:
	for c: Array in [["strasbourg", GameMode.ZONE], ["strasbourg", GameMode.TIMED], ["strasbourg", GameMode.ARSENAL], ["alpine", GameMode.TIMED], ["alpine", GameMode.ARSENAL]]:
		_new(c[0], 111, c[1])
		Game.director.round_number = 4
		for f in int(70.0 / DT):
			Game.player.yaw += DT * 0.7
			Game.player.health = Game.player.max_health
			Game.step(DT, {})
			if Game.over:
				break
		var w := Game.watch
		t.check(w.spawns > 5 and w.spawns_no_anim == 0 and w.pops == 0, "%s %s: %d appearances, all animated, no teleport (%s)" % [c[0], c[1], w.spawns, w.summary()])
		var relaxed := Game.spawns_relaxed + (Game.gm.relaxed if Game.gm != null else 0)
		print("j42 : %s %s : %d apparitions, %d remises, %d de repli, %d vues" % [c[0], c[1], w.spawns, Game.spawns_postponed, relaxed, w.spawns_seen])
		t.check(w.spawns_seen <= relaxed, "%s %s: no appearance in the player's view except fallbacks after %.0f s without a hidden place (%d seen, %d fallbacks)" % [
			c[0], c[1], Rules.SPAWN_RELAX_AFTER, w.spawns_seen, relaxed])

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
	print("j42 %s : %d portes, %.0f s de jeu (%.1f s réelles), %d tués au contact, %d abattus, manche %d, %d apparitions remises ; %s" % [map, done, Game.time, (Time.get_ticks_msec() - t0) / 1000.0, _kills, _shots, Game.director.round_number, Game.spawns_postponed, w.summary()])
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
	t.check(w.still_path_events == 0, "%s tour: no zombie still for %.0f s with a path to the player (%d)" % [map, ZombieWatch.STILL_TIME, w.still_path_events])
	t.check(w.inside_events == 0, "%s tour: no zombie inside an obstacle (%d)" % [map, w.inside_events])
	t.check(w.worst_lost < Rules.RESCUE_LOST + 2.0 * Rules.RESCUE_INTERVAL + 1.0, "%s tour: a zombie without a direction comes back quickly (worst %.1f s)" % [map, w.worst_lost])
	t.check(w.pops == 0, "%s tour: no teleport (%d)" % [map, w.pops])
	t.check(w.spawns > 30 and w.spawns_no_anim == 0, "%s tour: %d appearances, all animated" % [map, w.spawns])
	t.check(w.spawns_seen == 0, "%s tour: no appearance in the player's view (%d)" % [map, w.spawns_seen])
	t.check(w.spawn_euclid_max <= Rules.WORLD_SPAWN_MAX2 and w.spawn_walk_max <= Rules.SPAWN_WALK_MAX2, "%s tour: appearances within %.0f m straight (max %.0f) and %.0f m walk (max %.0f)" % [
		map, Rules.WORLD_SPAWN_MAX2, w.spawn_euclid_max, Rules.SPAWN_WALK_MAX2, w.spawn_walk_max])
	# never right after a door, never in bulk
	var times: Array[float] = []
	for s: Dictionary in w.spawn_list:
		times.append(float(s["t"]))
	for x in w.respawn_times:
		times.append(x)
	times.sort()
	var after_door := 0
	for x in times:
		for dt0 in door_times:
			if x >= dt0 and x < dt0 + Rules.DOOR_CALM - 0.02:
				after_door += 1
	var bulk := 0
	for i in times.size():
		var n := 0
		for j in range(i, times.size()):
			if times[j] - times[i] < 1.0:
				n += 1
		bulk = maxi(bulk, n)
	t.check(after_door == 0, "%s tour: no appearance in the %.0f s after a door (%d)" % [map, Rules.DOOR_CALM, after_door])
	t.check(bulk <= 3, "%s tour: at most 3 appearances in any second (%d)" % [map, bulk])
