class_name ZombieWatch
extends RefCounted
## v0.34.10 : zombie watch (port-only diagnostics, no JS counterpart). Watches every zombie of the game, step by step:
##   - "still": an active zombie (out of its spawn animation, chasing someone, not attacking, not on stairs, not vaulting) more than NEAR m
##     from its target that has not moved STILL_MOVE m for STILL_TIME s while its target stayed within TARGET_MOVE m. Counted as a stuck
##     episode (with or without a known path);
##   - "pop": a zombie that jumps more than POP_DIST m in one step outside of any animation (teleport);
##   - "spawn": where each zombie appears (window, ground, finale), straight-line and walking distance to the player, seen by the player
##     or not, animated or not;
##   - "rescue": recoveries reported by Game (on_rescue: none in this version; Game._relocate still teleports, seen here as "pop");
##   - "blocked" (no_progress past BLOCKED_NP), "inside" (deep inside an obstacle), "lost" (no direction: ZombieSim.lost_t).
## Counters are always kept (tests and the soak bot read them); a text log (one JSON object per line) is written only with
## `--zombie-stuck-log[=path]` (default user://zombie-stuck-log.jsonl) so that a player can send the data. Pure: no node.

const DEFAULT_PATH := "user://zombie-stuck-log.jsonl"
const STILL_TIME := 4.0       ## s without moving STILL_MOVE m: still (stuck episode)
const STILL_MOVE := 2.0       ## m (a zombie that slides back and forth along a wall stays within it)
const TARGET_MOVE := 3.0      ## m: its target moved more than that since the start of the window: no stuck episode counted (window restarted)
const NEAR := 3.0             ## m: closer than that to its target, a zombie may legitimately stand still (it hits, or waits behind others)
const POP_DIST := 3.0         ## m in one step
const BLOCKED_NP := 3.0       ## s of ZombieSim.no_progress (less than a quarter of its step for that long): "blocked" event
const INSIDE_CELLS := 2        ## cells: no free cell that close -> "inside" an obstacle
const HEAVY_PERIOD := 0.25
const SUMMARY_PERIOD := 30.0
const LOG_MAX := 20000        ## lines kept in memory (the file gets everything)

var log_on := false
var log_path := ""
var lines: PackedStringArray = []
var map_id := ""
# counters
var still_events := 0          ## stuck episodes (each zombie counted once per episode)
var still_path_events := 0     ## ... of which a walking path to the target existed (flow field reached the zombie)
var still_seconds := 0.0       ## zombie-seconds spent still beyond STILL_TIME
var worst_still := 0.0         ## longest still episode (s)
var blocked_events := 0        ## zombies whose no_progress went past BLOCKED_NP (pushing against a wall or furniture)
var inside_events := 0         ## zombies found deep inside an obstacle
var lost_events := 0           ## zombies with no direction to their target (ZombieSim.lost_t > 0: target out of sight, no flow field)
var lost_seconds := 0.0
var worst_lost := 0.0          ## longest ZombieSim.lost_t seen (s)
var pops := 0                  ## teleports outside of an animation
var pops_seen := 0             ## ... visible from the player
var spawns := 0
var spawns_no_anim := 0        ## spawn without window or ground animation
var spawns_seen := 0           ## spawn point in the player's view at the moment of the spawn
var spawn_euclid_max := 0.0
var spawn_walk_max := 0.0      ## largest finite walking distance at spawn (flow field)
var spawn_walk_unknown := 0    ## spawns where the field did not reach the point (no walking distance)
var spawn_list: Array[Dictionary] = []   ## { t, type, d, walk, seen, anim, zone } (tests)
var rescues := 0
var respawned := 0
var respawn_times: PackedFloat64Array = []   ## game time of each respawn (tests: never in bulk, never right after a door)
var _acc := 0.0
var _sum_t := 0.0
var _st: Dictionary = {}       ## zombie id -> { x, z, rx, rz, still, ev }
var _file: FileAccess

## Reads `--zombie-stuck-log[=path]` from the command line (Game._init) and opens the log (the file is rewritten at each launch).
func setup(args: PackedStringArray, map: String) -> void:
	map_id = map
	for a in args:
		if a == "--zombie-stuck-log" or a.begins_with("--zombie-stuck-log="):
			start_log(a.substr(19) if a.length() > 19 else DEFAULT_PATH)

func start_log(path: String) -> void:
	close_log()
	log_on = true
	log_path = path
	_file = FileAccess.open(log_path, FileAccess.WRITE)
	if _file == null and log_path != DEFAULT_PATH:
		printerr("--zombie-stuck-log : cannot write %s, using %s" % [log_path, DEFAULT_PATH])
		log_path = DEFAULT_PATH
		_file = FileAccess.open(log_path, FileAccess.WRITE)
	if _file == null:
		printerr("--zombie-stuck-log : cannot write %s" % log_path)
		return
	print("--zombie-stuck-log : %s" % (ProjectSettings.globalize_path(log_path) if log_path.begins_with("user://") else log_path))
	write({"ev": "log", "version": str(ProjectSettings.get_setting("application/config/version", "?")), "godot": Engine.get_version_info()["string"],
		"os": OS.get_name(), "date": Time.get_datetime_string_from_system()})

func close_log() -> void:
	if _file != null:
		_file.flush()
		_file = null
	log_on = false

func reset(map: String) -> void:
	map_id = map
	still_events = 0
	still_path_events = 0
	still_seconds = 0.0
	worst_still = 0.0
	blocked_events = 0
	inside_events = 0
	lost_events = 0
	lost_seconds = 0.0
	worst_lost = 0.0
	pops = 0
	pops_seen = 0
	spawns = 0
	spawns_no_anim = 0
	spawns_seen = 0
	spawn_euclid_max = 0.0
	spawn_walk_max = 0.0
	spawn_walk_unknown = 0
	spawn_list.clear()
	rescues = 0
	respawned = 0
	respawn_times.clear()
	_st.clear()
	_acc = 0.0
	_sum_t = 0.0
	lines.clear()
	write({"ev": "start", "map": map})

func write(d: Dictionary) -> void:
	if not log_on:
		return
	var s := JSON.stringify(d)
	lines.append(s)
	if lines.size() > LOG_MAX:
		lines.remove_at(0)
	if _file != null:
		_file.store_line(s)
		_file.flush()

## Is the point seen by the player: within `view` m, in front of him (cone) and with no wall in between (eye ray).
static func seen_by(p: PlayerSim, col: Collision, at: Vector3, view := 90.0, dot := 0.3) -> bool:
	if p == null:
		return false
	var eye := p.pos + Vector3(0, 1.6, 0)
	var to := at - eye
	var flat := Vector2(to.x, to.z)
	var d := flat.length()
	if d > view:
		return false
	if d < 1.0:
		return true
	var fwd := Vector2(-sin(p.yaw), -cos(p.yaw))
	if flat.normalized().dot(fwd) < dot:
		return false
	var len := to.length()
	var hit: float = col.ray_hit(eye.x, eye.y, eye.z, to.x / len, to.y / len, to.z / len, len)
	return hit >= len - 0.3

## A zombie appeared (Game._spawn_zombie, FinaleSim.spawn_at): straight-line and walking distance, seen or not, animated or not.
func on_spawn(g: Node, z: ZombieSim, kind: String) -> void:
	spawns += 1
	var at := z.spawn_outside if z.spawn_type == "window" else (z.spawn_pos if z.spawn_type == "ground" else z.pos)
	var p: PlayerSim = g.player
	var d := Vector2(at.x - p.pos.x, at.z - p.pos.z).length()
	var walk := INF
	var nav: NavGrid = g.env.nav if g.env != null else null
	if nav != null and z.region == 0:
		walk = nav.walk_distance(at.x, at.z)
	var anim := z.spawn_type != "" or z.appear > 0.0
	var look := (z.spawn_center if z.spawn_type == "window" else at) + Vector3(0, 1.0, 0)
	var seen := seen_by(p, g.collision, look, 90.0, 0.3) if g.collision != null else false
	if not anim:
		spawns_no_anim += 1
	if seen:
		spawns_seen += 1
	spawn_euclid_max = maxf(spawn_euclid_max, d)
	if walk < INF:
		spawn_walk_max = maxf(spawn_walk_max, walk)
	else:
		spawn_walk_unknown += 1
	var zone := -1
	if g.world != null:
		zone = g.world.zone_of(at.x, at.z)
	var e := {"t": snappedf(g.time, 0.01), "type": z.spawn_type if z.spawn_type != "" else kind, "d": snappedf(d, 0.1), "walk": snappedf(walk, 0.1) if walk < INF else -1.0,
		"seen": seen, "anim": anim, "zone": zone}
	spawn_list.append(e)
	var line := e.duplicate()
	line["ev"] = "spawn"
	line["id"] = z.id
	line["x"] = snappedf(at.x, 0.01)
	line["z"] = snappedf(at.z, 0.01)
	line["px"] = snappedf(p.pos.x, 0.01)
	line["pz"] = snappedf(p.pos.z, 0.01)
	write(line)
	_st[z.id] = {"x": z.pos.x, "z": z.pos.z, "rx": z.pos.x, "rz": z.pos.z, "still": 0.0, "ev": false}

## Recovery done by Game (kind: "burrow": it sinks into the ground in view; "respawn": it comes back by a window or from the ground): counted and logged.
func on_rescue(g: Node, z: ZombieSim, kind: String, info: Dictionary = {}) -> void:
	rescues += 1
	if kind == "respawn":
		respawned += 1
		respawn_times.append(g.time)
	var d := info.duplicate()
	d["ev"] = "rescue"
	d["kind"] = kind
	d["t"] = snappedf(g.time, 0.01)
	d["id"] = z.id
	write(d)
	var s: Dictionary = _st.get(z.id, {})
	if not s.is_empty():   # the move is a recovery, not a pop
		s["x"] = z.pos.x
		s["z"] = z.pos.z
		s["rx"] = z.pos.x
		s["rz"] = z.pos.z
		s["still"] = 0.0
		s["ev"] = false

## Active: out of its spawn animation, chasing, walking (not hitting, not on stairs, not vaulting).
static func active(z: ZombieSim) -> bool:
	return not z.dead and z.spawn_t <= 0.0 and z.appear <= 0.0 and z.target != null and z.link.is_empty() and z.vault.is_empty() and not z.attacking

## Once per simulation step, after the zombies moved.
func step(g: Node, dt: float) -> void:
	var p: PlayerSim = g.player
	if p == null:
		return
	_sum_t += dt
	if log_on and _sum_t >= SUMMARY_PERIOD:   # counters every SUMMARY_PERIOD s (context for the events)
		_sum_t = 0.0
		var n := 0
		for z: ZombieSim in g.zombies:
			n += 0 if z.dead else 1
		write({"ev": "summary", "t": snappedf(g.time, 0.01), "alive": n, "round": g.round_number, "pzone": g.world.zone_of(p.pos.x, p.pos.z) if g.world != null else -1,
			"px": snappedf(p.pos.x, 0.01), "pz": snappedf(p.pos.z, 0.01), "text": summary()})
	_acc += dt
	var heavy := _acc >= HEAVY_PERIOD   # the costlier checks (inside an obstacle) every HEAVY_PERIOD s
	if heavy:
		_acc = 0.0
	var nav: NavGrid = g.env.nav if g.env != null else null
	for z: ZombieSim in g.zombies:
		if z.dead:
			_st.erase(z.id)
			continue
		var s: Dictionary = _st.get(z.id, {})
		if s.is_empty():
			s = {"x": z.pos.x, "z": z.pos.z, "rx": z.pos.x, "rz": z.pos.z, "still": 0.0, "ev": false}
			_st[z.id] = s
		var jump := Vector2(z.pos.x - float(s["x"]), z.pos.z - float(s["z"])).length()
		if jump > POP_DIST and z.spawn_t <= 0.0 and z.link.is_empty() and z.vault.is_empty():
			pops += 1
			var vis := seen_by(p, g.collision, z.pos + Vector3(0, 1.0, 0), 90.0, 0.3) \
					or seen_by(p, g.collision, Vector3(float(s["x"]), 1.0, float(s["z"])), 90.0, 0.3)
			if vis:
				pops_seen += 1
			write({"ev": "pop", "t": snappedf(g.time, 0.01), "id": z.id, "from": [snappedf(float(s["x"]), 0.01), snappedf(float(s["z"]), 0.01)],
				"to": [snappedf(z.pos.x, 0.01), snappedf(z.pos.z, 0.01)], "seen": vis})
			s["rx"] = z.pos.x
			s["rz"] = z.pos.z
			s["still"] = 0.0
		s["x"] = z.pos.x
		s["z"] = z.pos.z
		if z.no_progress > BLOCKED_NP and not bool(s.get("np", false)):   # it pushes against something (zombie's own measure, see ZombieSim.no_progress)
			s["np"] = true
			blocked_events += 1
			write(describe(g, z, "blocked"))
		elif z.no_progress < 1.0:
			s["np"] = false
		# inside an obstacle: its grid cell is blocked and no free cell within INSIDE_CELLS (deep in a wall, a solid building or furniture)
		var deep := heavy and nav != null and z.region == 0 and z.spawn_t <= 0.0 and z.link.is_empty() and z.vault.is_empty() and nav.is_blocked_at(z.pos.x, z.pos.z) \
				and nav.nearest_free(z.pos.x, z.pos.z, INSIDE_CELLS) < 0
		if heavy:
			if deep and not bool(s.get("in", false)):
				inside_events += 1
				write(describe(g, z, "inside"))
			s["in"] = deep
		# lost: target out of sight and the flow field gives no direction (it walks straight at its target, into walls); checked every HEAVY_PERIOD s
		if heavy:
			var lost := nav != null and active(z) and z.region == 0 and z.target != null and z.target.tregion == 0 \
					and Vector2(z.target.pos.x - z.pos.x, z.target.pos.z - z.pos.z).length() >= 1.5 \
					and not nav.los(z.pos.x, z.pos.z, z.target.pos.x, z.target.pos.z) and not nav.steer(z.pos.x, z.pos.z)
			if lost:
				lost_seconds += HEAVY_PERIOD
				s["lt"] = float(s.get("lt", 0.0)) + HEAVY_PERIOD
				worst_lost = maxf(worst_lost, float(s["lt"]))
				if not bool(s.get("lost", false)):
					lost_events += 1
					write(describe(g, z, "lost"))
			else:
				s["lt"] = 0.0
			s["lost"] = lost
		var tgt := z.target
		var far := tgt != null and Vector2(tgt.pos.x - z.pos.x, tgt.pos.z - z.pos.z).length() > NEAR
		if not active(z) or not far:
			s["rx"] = z.pos.x
			s["rz"] = z.pos.z
			if tgt != null:
				s["tx"] = tgt.pos.x
				s["tz"] = tgt.pos.z
			s["still"] = 0.0
			s["ev"] = false
			continue
		# a target that moves far can make a slow zombie turn back (the shortest way flips): only a still target makes a stuck episode
		var tmoved := Vector2(tgt.pos.x - float(s.get("tx", tgt.pos.x)), tgt.pos.z - float(s.get("tz", tgt.pos.z))).length()
		if Vector2(z.pos.x - float(s["rx"]), z.pos.z - float(s["rz"])).length() >= STILL_MOVE or tmoved > TARGET_MOVE:
			s["rx"] = z.pos.x
			s["rz"] = z.pos.z
			s["tx"] = tgt.pos.x
			s["tz"] = tgt.pos.z
			s["still"] = 0.0
			s["ev"] = false
			continue
		s["still"] = float(s["still"]) + dt
		var st := float(s["still"])
		if st >= STILL_TIME:
			still_seconds += dt
			worst_still = maxf(worst_still, st)
			if not bool(s["ev"]):
				s["ev"] = true
				still_events += 1
				var walk := INF
				var nv: NavGrid = (g.env.levels.nav_of(z.region) if z.region != 0 and g.env.levels != null else nav)
				if nv != null:
					walk = nv.walk_distance(z.pos.x, z.pos.z)
				if walk < INF:
					still_path_events += 1
				write(describe(g, z, "still", {"walk": snappedf(walk, 0.1) if walk < INF else -1.0}))

## Snapshot of a zombie for the log: position, zones, target, field, steering, stuck counters.
func describe(g: Node, z: ZombieSim, ev: String, extra: Dictionary = {}) -> Dictionary:
	var p: PlayerSim = g.player
	var d := {"ev": ev, "t": snappedf(g.time, 0.01), "map": map_id, "id": z.id, "x": snappedf(z.pos.x, 0.01), "z": snappedf(z.pos.z, 0.01), "region": z.region,
		"px": snappedf(p.pos.x, 0.01), "pz": snappedf(p.pos.z, 0.01), "pregion": p.tregion, "np": snappedf(z.no_progress, 0.1), "side": snappedf(z.sidestep_t, 0.1),
		"speed": snappedf(z.speed, 0.01), "kind": z.kind}
	if g.world != null:
		d["zone"] = g.world.zone_of(z.pos.x, z.pos.z)
		d["pzone"] = g.world.zone_of(p.pos.x, p.pos.z)
	var nav: NavGrid = g.env.nav if g.env != null else null
	if nav != null and z.region == 0:
		d["blocked"] = nav.is_blocked_at(z.pos.x, z.pos.z)
		var ok := nav.steer(z.pos.x, z.pos.z)
		d["steer"] = [snappedf(nav.steer_x, 0.01), snappedf(nav.steer_z, 0.01)] if ok else null
		d["los"] = nav.los(z.pos.x, z.pos.z, p.pos.x, p.pos.z)
	for k in extra:
		d[k] = extra[k]
	return d

## Short summary (soak bot, tests, debug overlay).
func summary() -> String:
	return "still %d (%d with a path, worst %.1f s, %.0f zombie-s), blocked %d, inside %d, lost %d (%.0f zombie-s, worst %.1f s), pops %d (%d seen), spawns %d (no anim %d, seen %d, max %.0f m straight, max %.0f m walk, %d unknown), rescues %d (respawned %d)" % [
		still_events, still_path_events, worst_still, still_seconds, blocked_events, inside_events, lost_events, lost_seconds, worst_lost, pops, pops_seen, spawns, spawns_no_anim, spawns_seen, spawn_euclid_max, spawn_walk_max, spawn_walk_unknown, rescues, respawned]
