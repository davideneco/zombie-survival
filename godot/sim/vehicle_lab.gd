class_name VehicleLab
extends RefCounted
## v0.37.0 : carte de test des véhicules (« Banc d'essai ») : plan des épreuves, relief et adhérence du sol (World.terrain : lus par VehicleSim,
## CarSim et PlayerSim), plots renversables, télémétrie de la machine conduite (vitesse, accélérations en g, angle de dérapage, PV, essence),
## chrono de tour (meilleur temps), 0-50 / 0-100 km/h, distance de freinage, chocs, sauts, journal --vehicle-log[=chemin] (JSON par ligne),
## actions des touches (réparer, réinitialiser, hangar, sortir / ranger, jour / nuit). Code pur : aucun nœud. `g` : l'hôte (autoload Game).
## Repère : x vers l'est, z vers le sud ; toutes les épreuves se prennent vers l'est (+x).

const HALF := 130.0
const EDGE := 126.0
const HANGAR := Rect2(-24.0, -12.0, 48.0, 24.0)   ## x0, z0, largeur (x), profondeur (z)
const HANGAR_H := 7.0
const HANGAR_DOORS := [[-18.0, 18.0], [-10.0, 10.0]]   ## ouvertures des façades sud (z = +12) et nord (z = -12)
const RING := {"hx": 95.0, "hz": 62.0, "r": 28.0, "w": 12.0}   ## anneau : rectangle arrondi (axe), largeur de chaussée
const CPS := [Vector2(0, 62), Vector2(95, 0), Vector2(0, -62), Vector2(-95, 0)]   ## points de passage (0 : ligne de départ et d'arrivée)
const CP_R := 9.0
const DRAG := {"z": 104.0, "x0": -116.0, "x1": 108.0, "w": 10.0}   ## ligne droite d'accélération et de freinage (vers l'est)
const CRASH := {"x": 112.0, "z": 104.0, "len": 14.0, "t": 1.2, "h": 2.2}   ## mur de crash au bout de la ligne droite
const RAIL := {"z": -104.0, "x0": -110.0, "x1": 110.0}   ## tronçon de voie du tram (au nord)
## Relief (axes alignés, montée vers +x) : rampes (x0 début, len, z centre, w largeur, h hauteur au bord), bosses (x centre, len, z, w, h),
## colline (x0, montée, plateau, descente, z, w, h).
const RAMPS := [{"x0": 38.0, "len": 12.0, "z": -42.0, "w": 6.0, "h": 1.8, "name": "TREMPLIN 1,8 m"},
	{"x0": 40.0, "len": 6.0, "z": -28.0, "w": 5.0, "h": 0.7, "name": "TREMPLIN 0,7 m"}]
const BUMPS := [{"x": 40.0, "len": 4.0, "h": 0.1}, {"x": 49.0, "len": 4.0, "h": 0.1}, {"x": 58.0, "len": 4.0, "h": 0.1},
	{"x": 68.0, "len": 5.0, "h": 0.35}, {"x": 78.0, "len": 5.0, "h": 0.35}]
const BUMP_LANE := {"z": 0.0, "w": 8.0}
const HILL := {"x0": -88.0, "up": 20.0, "flat": 14.0, "down": 20.0, "z": 0.0, "w": 10.0, "h": 4.0}
const MUD := Rect2(-101.0, -22.0, 12.0, 44.0)    ## boue : sur l'anneau, côté ouest
const ICE := Rect2(30.0, 24.0, 44.0, 24.0)       ## patinoire (dérapages)
const MUD_GRIP := 0.45
const ICE_GRIP := 0.16
const SLALOM := {"x0": -78.0, "step": 7.0, "n": 8, "z": 40.0}
const TARGET := Vector2(-58.0, -38.0)   ## pointe de la pyramide de 10 plots (on arrive de l'est)
const CONE_R := 0.25
const CONE_FRICTION := 5.0
## Garage : machines du hangar (x, z ; cap PI = nez vers le sud, vers la grande porte). model : vue propre (motoneige).
const PARK := [{"type": "moto", "x": -15.0}, {"type": "grosseMoto", "x": -11.0}, {"type": "velo", "x": -7.5},
	{"type": "grosseMoto", "x": -3.5, "model": "motoneige"}, {"type": "voiture", "x": 1.5, "paint": 0}, {"type": "voiture", "x": 8.0, "paint": 1}]
const PARK_Z := 2.0
const START := Vector3(0.0, 0.0, 9.0)   ## arrivée du joueur : devant les machines, dans le hangar
const SAMPLE_DT := 0.25                 ## s : une ligne de mesure au journal pendant la conduite
const KMH := 3.6

var cones: Array = []          ## { x, z, x0, z0, vx, vz, down, kind ("slalom" | "target"), spin, tilt }
var knocked := {"slalom": 0, "target": 0}
# télémétrie de la machine conduite
var veh: Object = null
var speed := 0.0               ## m/s (au sol, glisse comprise)
var long_g := 0.0
var lat_g := 0.0
var slip_deg := 0.0
var max_kmh := 0.0
var surface := "asphalte"
var _prev := Vector3.INF
var _vel := Vector2.ZERO
var _acc := Vector2.ZERO
# chronos et mesures
var lap_t := -1.0              ## < 0 : pas de tour en cours
var lap_seen := [false, false, false, false]
var last_lap := -1.0
var best_lap := -1.0
var laps := 0
var acc_t := -1.0              ## 0-50 / 0-100 en cours (s)
var acc_ready := false
var acc_peak := 0.0
var t50 := -1.0
var t100 := -1.0
var last_accel := {}           ## { t50, t100, max_kmh }
var brake := {}                ## freinage en cours : { v0, d, t, surface }
var last_brake := {}
var last_crash := {}           ## { kmh, hp, where }
var air_t := 0.0
var _air_from := Vector2.ZERO
var last_jump := {}            ## { d, t, land }
var _hp_prev := -1.0
var log_path := ""
var _log: FileAccess
var _sample_t := 0.0
var log_lines := 0
var spawn_idx := -1
var now := 0.0                 ## temps de jeu (journal)

func _init() -> void:
	reset_cones()
	for a in OS.get_cmdline_user_args():
		if a == "--vehicle-log":
			log_path = "user://vehicle_log.jsonl"
		elif a.begins_with("--vehicle-log="):
			log_path = a.substr(14)

# ------------------------------------------------------------------ relief et adhérence (World.terrain)
func height(x: float, z: float) -> float:
	var h := 0.0
	for r: Dictionary in RAMPS:
		var u := x - float(r["x0"])
		if u >= 0.0 and u <= float(r["len"]) and absf(z - float(r["z"])) <= float(r["w"]) / 2.0:
			h = maxf(h, float(r["h"]) * u / float(r["len"]))
	if absf(z - float(BUMP_LANE["z"])) <= float(BUMP_LANE["w"]) / 2.0:
		for b: Dictionary in BUMPS:
			var d := x - float(b["x"])
			if absf(d) <= float(b["len"]) / 2.0:
				h = maxf(h, float(b["h"]) * 0.5 * (1.0 + cos(TAU * d / float(b["len"]))))
	if absf(z - float(HILL["z"])) <= float(HILL["w"]) / 2.0:
		var u := x - float(HILL["x0"])
		var up := float(HILL["up"])
		var fl := float(HILL["flat"])
		var hh := float(HILL["h"])
		if u >= 0.0 and u <= up:
			h = maxf(h, hh * u / up)
		elif u > up and u <= up + fl:
			h = maxf(h, hh)
		elif u > up + fl and u <= up + fl + float(HILL["down"]):
			h = maxf(h, hh * (1.0 - (u - up - fl) / float(HILL["down"])))
	return h

func grip(x: float, z: float) -> float:
	if MUD.has_point(Vector2(x, z)):
		return MUD_GRIP
	if ICE.has_point(Vector2(x, z)):
		return ICE_GRIP
	return 1.0

func surface_at(x: float, z: float) -> String:
	if MUD.has_point(Vector2(x, z)):
		return "boue"
	if ICE.has_point(Vector2(x, z)):
		return "glace"
	return "asphalte"

## Flancs du relief : segments de collision (x0, z0, x1, z1, hauteur) : côtés et bord des rampes, côtés de la colline.
static func relief_walls() -> Array:
	var out: Array = []
	for r: Dictionary in RAMPS:
		var x0 := float(r["x0"])
		var x1 := x0 + float(r["len"])
		var hw := float(r["w"]) / 2.0
		var zc := float(r["z"])
		out.append([x0 + float(r["len"]) * 0.35, zc - hw, x1, zc - hw, float(r["h"])])   # (le début de la rampe, bas, se franchit)
		out.append([x0 + float(r["len"]) * 0.35, zc + hw, x1, zc + hw, float(r["h"])])
		out.append([x1, zc - hw, x1, zc + hw, float(r["h"])])
	var a := float(HILL["x0"]) + float(HILL["up"]) * 0.2
	var b := float(HILL["x0"]) + float(HILL["up"]) + float(HILL["flat"]) + float(HILL["down"]) * 0.8
	for s in [-1.0, 1.0]:
		out.append([a, float(HILL["z"]) + s * float(HILL["w"]) / 2.0, b, float(HILL["z"]) + s * float(HILL["w"]) / 2.0, float(HILL["h"])])
	return out

## Axe de l'anneau (rectangle arrondi), sens horaire vu du ciel ; n points par virage.
static func ring_path(n := 12) -> PackedVector2Array:
	var hx := float(RING["hx"])
	var hz := float(RING["hz"])
	var r := float(RING["r"])
	var pts := PackedVector2Array()
	var corners := [[hx - r, hz - r, 0.0], [-(hx - r), hz - r, PI / 2.0], [-(hx - r), -(hz - r), PI], [hx - r, -(hz - r), PI * 1.5]]
	for c: Array in corners:
		for i in n + 1:
			var a: float = c[2] + PI / 2.0 * i / n
			pts.append(Vector2(c[0] + cos(a) * r, c[1] + sin(a) * r))
	return pts

# ------------------------------------------------------------------ plots
func reset_cones() -> void:
	cones.clear()
	for i in int(SLALOM["n"]):
		_cone(float(SLALOM["x0"]) + float(SLALOM["step"]) * i, float(SLALOM["z"]), "slalom")
	for k in 4:
		for j in k + 1:
			_cone(TARGET.x - 1.1 * k, TARGET.y + (j - k / 2.0) * 0.9, "target")
	knocked = {"slalom": 0, "target": 0}

func _cone(x: float, z: float, kind: String) -> void:
	cones.append({"x": x, "z": z, "x0": x, "z0": z, "vx": 0.0, "vz": 0.0, "down": false, "kind": kind, "spin": 0.0, "tilt": 0.0})

func _step_cones(dt: float, g: Object) -> void:
	var movers: Array = []   # [x, z, vx, vz, (machine | null)]
	for v: VehicleSim in g.rides.vehicles:
		if v.state == "ok" and absf(v.speed) > 0.3:
			var s: float = (v as CarSim).ground_speed() if v is CarSim else v.speed
			movers.append([v.x, v.z, -sin(v.yaw) * s, -cos(v.yaw) * s, v])
	var p: PlayerSim = g.player
	if not p.attached and Vector2(p.vel.x, p.vel.z).length() > 0.5:
		movers.append([p.pos.x, p.pos.z, p.vel.x, p.vel.z, null])
	for c: Dictionary in cones:
		for m: Array in movers:
			var dx := float(c["x"]) - float(m[0])
			var dz := float(c["z"]) - float(m[1])
			if absf(dx) > 4.0 or absf(dz) > 4.0:
				continue
			var hit := false
			var v: Object = m[4]
			if v == null:
				hit = dx * dx + dz * dz < (0.4 + CONE_R) * (0.4 + CONE_R)
			elif v is CarSim:
				hit = (v as CarSim).contains(float(c["x"]), float(c["z"]), CONE_R)
			else:
				var bc: Array = (v as VehicleSim).bike_circles()
				for i in [0, 2]:
					var ex: float = float(c["x"]) - bc[i]
					var ez: float = float(c["z"]) - bc[i + 1]
					hit = hit or ex * ex + ez * ez < (float(bc[4]) * 0.6 + CONE_R) * (float(bc[4]) * 0.6 + CONE_R)
			if not hit:
				continue
			var l := maxf(0.05, sqrt(dx * dx + dz * dz))
			c["vx"] = float(m[2]) * 1.1 + dx / l * 1.5
			c["vz"] = float(m[3]) * 1.1 + dz / l * 1.5
			c["spin"] = signf(dx * float(m[3]) - dz * float(m[2]) + 0.01) * 8.0
			if not bool(c["down"]):
				c["down"] = true
				knocked[c["kind"]] += 1
				g.ride_event.emit("cone", {"kind": c["kind"]})
				_write({"ev": "cone", "kind": c["kind"], "slalom": knocked["slalom"], "target": knocked["target"]})
	for c: Dictionary in cones:
		var vx := float(c["vx"])
		var vz := float(c["vz"])
		var sp := sqrt(vx * vx + vz * vz)
		if bool(c["down"]):
			c["tilt"] = move_toward(float(c["tilt"]), PI / 2.0, dt * 9.0)
		if sp < 1e-3:
			continue
		var ns := maxf(0.0, sp - CONE_FRICTION * dt)
		c["vx"] = vx * ns / sp
		c["vz"] = vz * ns / sp
		c["x"] = clampf(float(c["x"]) + vx * dt, -EDGE, EDGE)
		c["z"] = clampf(float(c["z"]) + vz * dt, -EDGE, EDGE)
		c["spin"] = float(c["spin"]) * (1.0 - minf(1.0, dt * 1.5))

# ------------------------------------------------------------------ pas de simulation (après Rides.step)
func step(dt: float, g: Object, input: Dictionary) -> void:
	now = float(g.time)
	_step_cones(dt, g)
	var r: Rides = g.rides
	var v: Object = r.ride["v"] if r.ride != null and r.driving() else null
	if v != veh:
		veh = v
		_prev = Vector3.INF
		_hp_prev = -1.0
		acc_t = -1.0
		acc_ready = false
		brake = {}
		lap_t = -1.0
	if v == null:
		speed = 0.0
		long_g = 0.0
		lat_g = 0.0
		slip_deg = 0.0
		return
	var pos: Vector3 = v.pos
	var yaw: float = v.yaw
	surface = surface_at(pos.x, pos.z)
	if _prev == Vector3.INF:
		_prev = pos
		_vel = Vector2.ZERO
		_acc = Vector2.ZERO
		_hp_prev = v.hp
		return
	var nv := Vector2(pos.x - _prev.x, pos.z - _prev.z) / dt
	_prev = pos
	if nv.length() > 80.0:   # téléportation (touches P, X, C) : pas de mesure sur ce pas
		_vel = Vector2.ZERO
		return
	var k := 1.0 - exp(-dt * 10.0)
	_acc = _acc.lerp((nv - _vel) / dt, k)
	var prev_speed := _vel.length()
	_vel = nv
	speed = nv.length()
	var fwd := Vector2(-sin(yaw), -cos(yaw))
	var right := Vector2(cos(yaw), -sin(yaw))
	long_g = _acc.dot(fwd) / VehicleSim.GRAVITY
	lat_g = _acc.dot(right) / VehicleSim.GRAVITY
	var moving_dir := fwd * (signf(fwd.dot(nv)) if fwd.dot(nv) != 0.0 else 1.0)
	slip_deg = rad_to_deg(atan2(nv.dot(right) * signf(moving_dir.dot(fwd)), absf(nv.dot(fwd)))) if speed > 1.5 else 0.0
	max_kmh = maxf(max_kmh, speed * KMH)
	_laps(dt, Vector2(pos.x, pos.z))
	_accel(dt)
	_brake(dt, input, prev_speed)
	_crash(prev_speed, v, Vector2(pos.x, pos.z))
	_jump(dt, v, Vector2(pos.x, pos.z))
	_hp_prev = v.hp
	if _log != null or log_path != "":
		_sample_t -= dt
		if _sample_t <= 0.0:
			_sample_t = SAMPLE_DT
			_write({"ev": "sample", "veh": _name(v), "x": snappedf(pos.x, 0.01), "y": snappedf(pos.y, 0.01), "z": snappedf(pos.z, 0.01),
				"kmh": snappedf(speed * KMH, 0.1), "long_g": snappedf(long_g, 0.01), "lat_g": snappedf(lat_g, 0.01), "slip": snappedf(slip_deg, 0.1),
				"hp": snappedf(v.hp_frac() * 100.0, 0.1), "fuel": snappedf(v.fuel_frac() * 100.0 if not v.is_tram() and v.has_tank() else 100.0, 0.1),
				"air": v.get("air") == true, "surface": surface})

func _laps(dt: float, p: Vector2) -> void:
	if lap_t >= 0.0:
		lap_t += dt
	for i in CPS.size():
		if p.distance_to(CPS[i]) > CP_R:
			continue
		if i != 0:
			if lap_t >= 0.0:
				lap_seen[i] = true
			continue
		if lap_t >= 0.0 and lap_seen[1] and lap_seen[2] and lap_seen[3]:
			last_lap = lap_t
			laps += 1
			var best := best_lap < 0.0 or lap_t < best_lap
			if best:
				best_lap = lap_t
			_write({"ev": "lap", "veh": _name(veh), "t": snappedf(lap_t, 0.001), "best": best})
			lap_t = 0.0
			lap_seen = [true, false, false, false]
		elif lap_t < 0.0 or lap_t > 3.0 and not (lap_seen[1] or lap_seen[2] or lap_seen[3]):
			lap_t = 0.0   # départ (ou nouveau départ si l'on repasse la ligne sans avoir fait le tour)
			lap_seen = [true, false, false, false]

func _accel(dt: float) -> void:
	var kmh := speed * KMH
	if kmh < 1.0:
		if acc_t > 0.0:
			_end_accel()
		acc_ready = true
		acc_t = -1.0
		acc_peak = 0.0
		return
	if acc_ready and acc_t < 0.0:
		acc_ready = false
		acc_t = 0.0
		t50 = -1.0
		t100 = -1.0
	if acc_t < 0.0:
		return
	acc_t += dt
	acc_peak = maxf(acc_peak, kmh)
	if t50 < 0.0 and kmh >= 50.0:
		t50 = acc_t
	if t100 < 0.0 and kmh >= 100.0:
		t100 = acc_t
		_end_accel()
	elif kmh < acc_peak - 6.0:   # on lève le pied : la mesure s'arrête
		_end_accel()

func _end_accel() -> void:
	last_accel = {"t50": t50, "t100": t100, "max_kmh": acc_peak}
	_write({"ev": "accel", "veh": _name(veh), "t50": snappedf(t50, 0.01), "t100": snappedf(t100, 0.01), "max_kmh": snappedf(acc_peak, 0.1)})
	acc_t = -1.0

func _brake(dt: float, input: Dictionary, prev_speed: float) -> void:
	var pressing := float(input.get("mz", 0.0)) < 0.0 or bool(input.get("jump", false))
	if brake.is_empty():
		if pressing and prev_speed >= 30.0 / KMH:
			brake = {"v0": prev_speed * KMH, "d": 0.0, "t": 0.0, "surface": surface}
		return
	if not pressing:
		brake = {}
		return
	brake["d"] = float(brake["d"]) + speed * dt
	brake["t"] = float(brake["t"]) + dt
	if speed < 0.3:
		last_brake = brake
		_write({"ev": "brake", "veh": _name(veh), "v0": snappedf(float(brake["v0"]), 0.1), "d": snappedf(float(brake["d"]), 0.01), "t": snappedf(float(brake["t"]), 0.01), "surface": brake["surface"]})
		brake = {}

## Choc : décélération de plus de 30 m/s² (3 g) ; les PV perdus se comptent pendant CRASH_WINDOW s (les dégâts tombent sur plusieurs pas).
const CRASH_WINDOW := 0.6

func _crash(prev_speed: float, v: Object, p: Vector2) -> void:
	if not last_crash.is_empty() and now - float(last_crash["t"]) < CRASH_WINDOW:
		var lost := maxf(0.0, float(last_crash["hp0"]) - v.hp)
		if lost != float(last_crash["hp"]):
			last_crash["hp"] = lost
			_write({"ev": "crash_hp", "veh": _name(v), "hp_lost": snappedf(lost, 0.1)})
		return
	if prev_speed < 4.0 or (prev_speed - speed) * 60.0 < 30.0:
		return
	var where := "mur de crash" if absf(p.x - float(CRASH["x"])) < 8.0 and absf(p.y - float(CRASH["z"])) < float(CRASH["len"]) else "obstacle"
	var hp0 := _hp_prev if _hp_prev >= 0.0 else float(v.hp)
	last_crash = {"kmh": prev_speed * KMH, "hp": maxf(0.0, hp0 - v.hp), "hp0": hp0, "t": now, "where": where}
	_write({"ev": "crash", "veh": _name(v), "kmh": snappedf(prev_speed * KMH, 0.1), "hp_lost": snappedf(float(last_crash["hp"]), 0.1), "where": where})

func _jump(dt: float, v: Object, p: Vector2) -> void:
	var up: bool = v.get("air") == true
	if up:
		if air_t == 0.0:
			_air_from = p
		air_t += dt
	elif air_t > 0.0:
		last_jump = {"d": p.distance_to(_air_from), "t": air_t, "land": float(v.get("land_speed"))}
		_write({"ev": "jump", "veh": _name(v), "d": snappedf(float(last_jump["d"]), 0.01), "t": snappedf(air_t, 0.01), "land": snappedf(float(last_jump["land"]), 0.01)})
		air_t = 0.0

# ------------------------------------------------------------------ journal (--vehicle-log)
func _write(d: Dictionary) -> void:
	if log_path == "":
		return
	if _log == null:
		_log = FileAccess.open(log_path, FileAccess.WRITE)
		if _log == null:
			push_warning("VehicleLab : journal %s impossible à écrire" % log_path)
			log_path = ""
			return
	d["time"] = snappedf(now, 0.001)
	_log.store_line(JSON.stringify(d))
	_log.flush()
	log_lines += 1

static func _name(v: Object) -> String:
	return "" if v == null else String(v.def.get("hudName", v.def["name"]))

# ------------------------------------------------------------------ touches
## R : réparer et faire le plein (la machine conduite, sinon la plus proche à 8 m) ; une épave revient neuve à sa place.
func service(g: Object) -> bool:
	var v: Object = _target(g)
	if v == null:
		g.announce("BANC D'ESSAI", "Aucun véhicule à moins de 8 m")
		return false
	if v.is_tram():
		v.hp = v.max_hp()
		v.state = "ok"
	elif v.state != "ok":
		g.rides.respawn_vehicle(v)
	v.hp = v.max_hp()
	if v.has_tank() and not v.is_tram():
		v.fuel = float(v.def["tank"])
	g.announce(_name(v), "Réparé, plein fait")
	g.ride_event.emit("service", {"v": v})
	_write({"ev": "service", "veh": _name(v)})
	return true

## X : réinitialiser : la machine conduite s'arrête net, d'aplomb au sol, réparée et pleine ; plots relevés, mesures effacées.
func reset_vehicle(g: Object) -> void:
	var v: Object = _target(g)
	if v != null and not v.is_tram():
		if v.state != "ok":
			g.rides.respawn_vehicle(v)
		_stop(v)
		v.y = height(v.x, v.z)
		v.hp = v.max_hp()
		if v.has_tank():
			v.fuel = float(v.def["tank"])
	elif v != null:
		v.v = 0.0
		v.hp = v.max_hp()
	reset_cones()
	clear_measures()
	g.announce("RÉINITIALISÉ", "Véhicule d'aplomb, réparé et plein ; plots relevés, mesures effacées")

func clear_measures() -> void:
	lap_t = -1.0
	last_lap = -1.0
	best_lap = -1.0
	laps = 0
	last_accel = {}
	last_brake = {}
	last_crash = {}
	last_jump = {}
	max_kmh = 0.0
	acc_t = -1.0
	brake = {}
	_prev = Vector3.INF

static func _stop(v: Object) -> void:
	v.speed = 0.0
	v.steer = 0.0
	v.lean = 0.0
	v.dyaw = 0.0
	v.vy = 0.0
	v.air = false
	v.grade = 0.0
	if v is CarSim:
		v.slip = 0.0
		v.spin = 0.0

## P : retour au hangar : la machine conduite revient à sa place de garage (le joueur dessus), sinon le joueur à l'entrée du hangar.
func to_hangar(g: Object) -> void:
	var r: Rides = g.rides
	var v: Object = r.ride["v"] if r.ride != null else null
	if v != null and v.is_tram():
		v.s = v.start_s
		v.v = 0.0
		v.apply(g, true)
	elif v != null:
		_stop(v)
		v.x = float(v.spawn["x"])
		v.z = float(v.spawn["z"])
		v.yaw = float(v.spawn["yaw"])
		v.y = 0.0
	else:
		r.tram_walk_off()
		g.player.pos = START
		g.player.vel = Vector3.ZERO
		g.player.yaw = 0.0
	_prev = Vector3.INF
	g.announce("HANGAR", "Retour au hangar")

## C : à pied : sort la machine suivante du garage, devant le joueur ; en selle (ou au volant) : la range à sa place.
func spawn_or_stow(g: Object) -> void:
	var r: Rides = g.rides
	var p: PlayerSim = g.player
	if r.ride != null:
		var v: Object = r.ride["v"]
		if v.is_tram():
			return
		r.leave_vehicle(true)
		_stop(v)
		v.x = float(v.spawn["x"])
		v.z = float(v.spawn["z"])
		v.yaw = float(v.spawn["yaw"])
		v.y = 0.0
		g.announce(_name(v), "Rangé au hangar")
		return
	var list: Array = r.vehicles.filter(func(q: VehicleSim) -> bool: return q.seats[0] == null)
	if list.is_empty():
		return
	spawn_idx = (spawn_idx + 1) % list.size()
	var v: VehicleSim = list[spawn_idx]
	if v.state != "ok":
		r.respawn_vehicle(v)
	_stop(v)
	var fwd := Vector3(-sin(p.yaw), 0.0, -cos(p.yaw))
	var at: Vector3 = g.collision.resolve(p.pos + fwd * (4.5 if v is CarSim else 3.0) + Vector3(0, 0.1, 0), 1.0)
	v.x = at.x
	v.z = at.z
	v.yaw = p.yaw
	v.y = height(at.x, at.z)
	g.announce(_name(v), "Prêt devant vous (E pour monter)")

## N : jour / nuit (le cycle existant, mode fixe ; le réglage du joueur n'est pas touché).
func toggle_daynight(g: Object) -> void:
	var dn: DayNight = g.daynight
	dn.configure(DayNight.MODE_DAY if dn.is_night() else DayNight.MODE_NIGHT, dn.day_minutes)
	g.announce("BANC D'ESSAI", "Jour" if dn.mode == DayNight.MODE_DAY else "Nuit")

func _target(g: Object) -> Object:
	var r: Rides = g.rides
	if r.ride != null:
		return r.ride["v"]
	var p: PlayerSim = g.player
	var best: Object = null
	var bd := 8.0
	for v in r.vehicles:
		var d := Vector2(v.x - p.pos.x, v.z - p.pos.z).length()
		if d < bd:
			bd = d
			best = v
	return best

# ------------------------------------------------------------------ HUD
static func _f(v: float, d := 1) -> String:
	return (("%." + str(d) + "f") % v).replace(".", ",")

static func _clock(t: float) -> String:
	return "%d:%s" % [int(t) / 60, ("0" if fmod(t, 60.0) < 10.0 else "") + _f(fmod(t, 60.0), 2)]

func hud_text() -> String:
	var L: PackedStringArray = []
	if veh == null:
		L.append("BANC D'ESSAI — à pied")
		L.append("Plots : slalom %d / %d  ·  cible %d / 10" % [knocked["slalom"], int(SLALOM["n"]), knocked["target"]])
		if best_lap >= 0.0:
			L.append("Meilleur tour : %s" % _clock(best_lap))
		return "\n".join(L)
	var v := veh
	L.append("TÉLÉMÉTRIE — %s" % _name(v))
	L.append("Vitesse  %d km/h   (max %d)" % [roundi(speed * KMH), roundi(max_kmh)])
	L.append("Accél. %s g   Latéral %s g" % [("+" if long_g >= 0.0 else "") + _f(long_g, 2), _f(absf(lat_g), 2)])
	L.append("Dérapage %d°   %s" % [roundi(absf(slip_deg)), ("EN L'AIR %s s" % _f(air_t, 1)) if v.get("air") == true else "au sol"])
	var fuel := "secteur"
	if not v.is_tram():
		fuel = "—" if not v.has_tank() else (("%d L" % roundi(v.fuel)) if v is CarSim else "%d %%" % roundi(v.fuel_frac() * 100.0))
	L.append("PV %d %%   Essence %s   Sol : %s" % [roundi(v.hp_frac() * 100.0), fuel, surface])
	L.append("Tour %s   ·   meilleur %s" % [_clock(lap_t) if lap_t >= 0.0 else "—", _clock(best_lap) if best_lap >= 0.0 else "—"])
	var a := {"t50": t50, "t100": t100, "max_kmh": acc_peak} if acc_t >= 0.0 else last_accel
	if not a.is_empty():
		L.append("0-50 : %s   0-100 : %s" % [(_f(float(a["t50"]), 2) + " s") if float(a["t50"]) >= 0.0 else "—",
			(_f(float(a["t100"]), 2) + " s") if float(a["t100"]) >= 0.0 else "— (max %d km/h)" % roundi(float(a["max_kmh"]))])
	if not brake.is_empty():
		L.append("Freinage depuis %d km/h : %s m…" % [roundi(float(brake["v0"])), _f(float(brake["d"]), 1)])
	elif not last_brake.is_empty():
		L.append("Freinage %d→0 km/h : %s m en %s s (%s)" % [roundi(float(last_brake["v0"])), _f(float(last_brake["d"]), 1), _f(float(last_brake["t"]), 2), last_brake["surface"]])
	if not last_crash.is_empty():
		L.append("Choc %d km/h : -%d PV (%s)" % [roundi(float(last_crash["kmh"])), roundi(float(last_crash["hp"])), last_crash["where"]])
	if not last_jump.is_empty():
		L.append("Saut %s m, %s s en l'air (impact %s m/s)" % [_f(float(last_jump["d"]), 1), _f(float(last_jump["t"]), 2), _f(float(last_jump["land"]), 1)])
	L.append("Plots : slalom %d / %d  ·  cible %d / 10" % [knocked["slalom"], int(SLALOM["n"]), knocked["target"]])
	return "\n".join(L)

const KEYS_HELP := "R réparer + plein · X réinitialiser · P hangar · C sortir / ranger un véhicule · N jour / nuit · T vue à pied · V vue en véhicule · E monter"
