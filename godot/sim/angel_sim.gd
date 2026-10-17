class_name AngelSim
extends BossSim
## L'Ange du Jugement (port de src/angel.js) : boss secret de l'Acte V (CONFIG.summit.angel). Il ne marche pas : il tourne hors de la tour, sur un cercle
## de `radius` m autour de l'axe de la flèche, à `height` m (scripté). Sous-classe du Bourreau, avec la barre de vie d'un mini-boss. Son point faible est sa
## trompette (dégâts x weak, quelle que soit l'arme).
##   trumpet_tel / trumpet    Trompette : cône annoncé 1 s, 40 dégâts à qui s'y trouve (la flèche ne protège pas du cône : il faut en sortir)
##   plumes_tel / plumes      Plumes : éventail de 5 plumes (15 dégâts chacune), arrêtées par la flèche
##   judge_tel / judge        Jugement : un joueur est marqué 3 s, puis un rayon le frappe sauf s'il se cache derrière la flèche
## Il reste immobile pendant ses attaques : la zone annoncée est exactement celle qui frappe.
## Codes bs : 0 en orbite, 20 trompette (annonce), 21 trompette, 22 plumes, 23 jugement (annonce), 24 jugement, 25 arrivée.

const ABS := {"orbit": 0, "trumpet_tel": 20, "trumpet": 21, "plumes_tel": 22, "plumes": 22, "judge_tel": 23, "judge": 24, "arrive": 25}

var t_life := 0.0                    ## this.t : temps de vie (bascule, ailes)
var az := 200.0                      ## azimut sur le cercle (degrés)
var center := Vector2.ZERO           ## axe de la flèche (x, z)
var feathers: Array = []             ## plumes en vol : { x, y, z, dx, dy, dz, t }
var aim: Dictionary = {}
# pose (rad) calculée en fin de pas : lue par la vue et par trumpet_world()
var arm_r_x := -0.35
var arm_r_z := -0.25
var arm_l_x := -0.1
var arm_l_z := 0.3
var el_r_x := -0.45
var el_l_x := -0.35
var flap := 0.0
var spread := 0.0
var trumpet_glow := 0.0
var halo_k := 1.0
var rig_y := 0.0
var death_rise := 0.0

static func ac() -> Dictionary:
	return Config.at("summit.angel")

func _init(health_: float = 1.0, ctx_: BossCtx = null) -> void:
	super._init(health_, ctx_)
	var A := ac()
	boss_name = "L'ANGE DU JUGEMENT"
	speed = 0.0
	attack_damage = 0.0
	scale_override = float(A["scale"])
	mini = true
	is_angel = true
	weak_mult = float(A["weak"])
	state = "orbit"
	state_t = 0.0
	bs = 0
	region = 0
	phase = 1
	cool = {"gap": 0.0, "trumpet": 0.0, "plumes": 0.0, "judge": 0.0}

func _enter_phase(_n: int) -> void:
	if cool.is_empty():
		cool = {"gap": 0.0, "trumpet": 0.0, "plumes": 0.0, "judge": 0.0}
	speed = 0.0

func is_invulnerable() -> bool:
	return state == "arrive"

func targetable() -> bool:
	return not dead and state != "arrive"

## Arrivée : insensible ; sinon les dégâts comme un mini-boss (le multiplicateur de la trompette est dans Game.hit_zombie).
func damage(amount: float, _head: bool, _hit: Dictionary = {}) -> bool:
	if state == "arrive":
		return false
	return _zdamage(amount, false)

func _set_state(s: String) -> void:
	state = s
	state_t = 0.0
	bs = int(ABS.get(s, 0))

## Position (x, y, z) de la trompette dans le monde : origine des plumes, centre de la boîte de touche « point faible ».
func trumpet_world() -> Vector3:
	return pos + Basis(Vector3.UP, yaw) * (_trumpet_local() * scale_override)

## Centre de la boîte de touche de la trompette dans le repère du modèle (avant le cap et l'échelle) : chaîne rig -> épaule droite -> coude -> main ->
## trompette (angel.js _buildBody, _arm) ; angles d'Euler XYZ comme Three.js.
func _trumpet_local() -> Vector3:
	var sh := Transform3D(Basis.from_euler(Vector3(arm_r_x, 0.0, arm_r_z), EULER_ORDER_XYZ), Vector3(0.27, 1.55 + rig_y, 0.0))
	var el := Transform3D(Basis.from_euler(Vector3(el_r_x, 0.0, 0.0), EULER_ORDER_XYZ), Vector3(0.0, -0.3, 0.0))
	var hand := Transform3D(Basis.IDENTITY, Vector3(0.0, -0.31, 0.0))
	var tr := Transform3D(Basis.from_euler(Vector3(0.1, 0.0, 0.0), EULER_ORDER_XYZ), Vector3.ZERO)
	return (sh * el * hand * tr) * Vector3(0.0, -0.82, 0.0)

## L'axe de la flèche est entre (cx, cz) et le point (x, y, z) ? (la pagode et l'aiguille arrêtent plumes et rayon)
func blocked(ax: float, ay: float, az_: float, bx: float, by: float, bz: float) -> bool:
	for i in range(1, 40):
		var u := i / 40.0
		var x := ax + (bx - ax) * u
		var y := ay + (by - ay) * u
		var z := az_ + (bz - az_) * u
		if y < Cathedral.TOWER_TOP - 0.3:
			continue
		if Vector2(x - center.x, z - center.y).length() < Cathedral.spire_radius(y) - 0.15:
			return true
	return false

## Joueur sur la terrasse ou la rampe (pas à l'intérieur de l'escalier).
func exposed(p: PlayerSim) -> bool:
	return p.pos.y > Cathedral.TOWER_TOP - 1.2 and Vector2(p.pos.x - center.x, p.pos.z - center.y).length() < 10.4

# ------------------------------------------------------------------ IA
func step(dt: float, env: ZombieEnv) -> void:
	var T := ac()
	if dead:
		death_t += dt
		death_rise += dt
		return
	t_life += dt
	state_t += dt
	for k: String in cool:
		cool[k] = float(cool[k]) - dt
	var c := center
	var all: Array[PlayerSim] = []
	for p in env.players:
		if p != null and not p.dead and not p.downed and exposed(p):
			all.append(p)
	_update_feathers(dt, all)
	match state:
		"arrive":   # il descend du ciel en tournant
			var k := minf(1.0, state_t / 3.2)
			var e := 1.0 - pow(1.0 - k, 3.0)
			az += float(T["omega"]) * 3.0 * (1.0 - e) * dt
			var a := deg_to_rad(az)
			var r := float(T["radius"]) + 10.0 * (1.0 - e)
			pos.x = c.x + cos(a) * r
			pos.z = c.y + sin(a) * r
			pos.y = float(T["height"]) + 22.0 * (1.0 - e)
			yaw = atan2(c.x - pos.x, c.y - pos.z)
			if state_t >= 3.2:
				_set_state("orbit")
				cool["gap"] = float(T["first"])
		"orbit":
			_orbit(dt)
			if all.is_empty() or float(cool["gap"]) > 0.0:
				pass
			else:
				var frac := health / max_health
				var near: PlayerSim = null
				var nd := INF
				for p in all:
					var d := Vector2(p.pos.x - pos.x, p.pos.z - pos.z).length()
					if d < nd:
						nd = d
						near = p
				if frac < float(T["judgment"]["fromHealth"]) and float(cool["judge"]) <= 0.0 and mark.is_empty():
					_start_judge(all)
				elif float(cool["trumpet"]) <= 0.0 and nd < float(T["trumpet"]["range"]) + 2.5:
					_start_trumpet(near)
				elif float(cool["plumes"]) <= 0.0:
					_start_plumes(near)
				elif float(cool["trumpet"]) <= 0.0:
					_start_trumpet(near)
		"trumpet_tel":
			if state_t < float(T["trumpet"]["tel"]) - 0.35:
				var tg: PlayerSim = aim["target"] if all.has(aim["target"]) else (all[0] if not all.is_empty() else null)
				if tg != null:
					aim["dx"] = tg.pos.x - pos.x
					aim["dz"] = tg.pos.z - pos.z
					var l := sqrt(float(aim["dx"]) * float(aim["dx"]) + float(aim["dz"]) * float(aim["dz"]))
					if l == 0.0:
						l = 1.0
					aim["dx"] = float(aim["dx"]) / l
					aim["dz"] = float(aim["dz"]) / l
			_face_to(pos.x + float(aim["dx"]), pos.z + float(aim["dz"]), 8.0, dt)
			pos.y = float(T["height"]) + sin(t_life * 1.3) * float(T["bob"])
			if state_t >= float(T["trumpet"]["tel"]):
				_blast(all)
				_set_state("trumpet")
		"trumpet":
			if state_t >= float(T["trumpet"]["dur"]):
				_done("trumpet", float(T["trumpet"]["cooldown"]))
		"plumes_tel":
			var tg2: PlayerSim = aim["target"] if all.has(aim["target"]) else (all[0] if not all.is_empty() else null)
			if tg2 != null:
				_face_to(tg2.pos.x, tg2.pos.z, 8.0, dt)
			pos.y = float(T["height"]) + sin(t_life * 1.3) * float(T["bob"])
			if state_t >= float(T["plumes"]["tel"]):
				_fire_plumes(tg2)
				_set_state("plumes")
		"plumes":
			if state_t >= 0.6:
				_done("plumes", float(T["plumes"]["cooldown"]))
		"judge_tel":
			if not mark.is_empty():
				_face_to(mark["target"].pos.x, mark["target"].pos.z, 4.0, dt)
			pos.y = float(T["height"]) + 0.8 * minf(1.0, state_t) + sin(t_life * 1.3) * float(T["bob"])
			if state_t >= float(T["judgment"]["tel"]):
				_fire_judge(all)
		"judge":
			if state_t >= 0.8:
				_done("judge", float(T["judgment"]["cooldown"]))
		_:
			_set_state("orbit")
	_apose()

func _orbit(dt: float) -> void:   # le cercle : l'azimut avance, l'ange regarde l'axe de la flèche
	var T := ac()
	az += float(T["omega"]) * dt
	var a := deg_to_rad(az)
	pos.x = center.x + cos(a) * float(T["radius"])
	pos.z = center.y + sin(a) * float(T["radius"])
	pos.y = float(T["height"]) + sin(t_life * 1.3) * float(T["bob"])
	yaw = atan2(center.x - pos.x, center.y - pos.z)

func _face_to(x: float, z: float, k: float, dt: float) -> void:
	var d := atan2(x - pos.x, z - pos.z) - yaw
	d = atan2(sin(d), cos(d))
	yaw += d * minf(1.0, dt * k)

func _done(attack: String, cd: float) -> void:
	cool[attack] = cd
	cool["gap"] = float(ac()["gap"])
	_set_state("orbit")

# ------------------------------------------------------------------ Trompette : cône annoncé (portée, demi-angle) ; à la fin de l'annonce, qui s'y trouve est touché (une seule fois)
func _start_trumpet(target: PlayerSim) -> void:
	var T: Dictionary = ac()["trumpet"]
	var dx := target.pos.x - pos.x
	var dz := target.pos.z - pos.z
	var l := sqrt(dx * dx + dz * dz)
	if l == 0.0:
		l = 1.0
	aim = {"target": target, "dx": dx / l, "dz": dz / l}
	_set_state("trumpet_tel")
	ctx.event("angel_trumpet", {"x": pos.x, "y": pos.y, "z": pos.z, "fy": Cathedral.TOWER_TOP, "dx": dx / l, "dz": dz / l, "range": T["range"], "ang": T["angle"], "tel": T["tel"], "dur": T["dur"]})

func _blast(all: Array[PlayerSim]) -> void:
	var T: Dictionary = ac()["trumpet"]
	var cs := cos(deg_to_rad(float(T["angle"])))
	for p in all:
		var dx := p.pos.x - pos.x
		var dz := p.pos.z - pos.z
		var d := sqrt(dx * dx + dz * dz)
		if d > float(T["range"]) or absf(p.pos.y - Cathedral.TOWER_TOP) > 24.0:
			continue
		if d > 0.8 and (dx * float(aim["dx"]) + dz * float(aim["dz"])) / d < cs:
			continue
		if blocked(pos.x, pos.y + 3.0, pos.z, p.pos.x, p.pos.y + 1.0, p.pos.z):
			continue   # la flèche protège
		ctx.hurt_player(p, float(T["damage"]), 0.0, 0.0, "holy")

# ------------------------------------------------------------------ Plumes : l'ange ouvre les ailes, puis un éventail de plumes part vers le joueur
func _start_plumes(target: PlayerSim) -> void:
	aim = {"target": target}
	_set_state("plumes_tel")

func _fire_plumes(target: PlayerSim) -> void:
	var P: Dictionary = ac()["plumes"]
	var o := trumpet_world()
	var tx := target.pos.x if target != null else center.x
	var ty := target.pos.y + 1.1 if target != null else Cathedral.TOWER_TOP + 1.1
	var tz := target.pos.z if target != null else center.y
	var dx := tx - o.x
	var dy := ty - o.y
	var dz := tz - o.z
	var l := sqrt(dx * dx + dy * dy + dz * dz)
	if l == 0.0:
		l = 1.0
	dx /= l
	dy /= l
	dz /= l
	var base := atan2(dx, dz)
	var hz := sqrt(dx * dx + dz * dz)
	var dirs: Array = []
	var n := int(P["count"])
	for i in n:
		var a := base + deg_to_rad((i - (n - 1) / 2.0) * float(P["spread"]))
		var d := [floorf(sin(a) * hz * 1000.0 + 0.5) / 1000.0, floorf(dy * 1000.0 + 0.5) / 1000.0, floorf(cos(a) * hz * 1000.0 + 0.5) / 1000.0]
		dirs.append(d)
		feathers.append({"x": o.x, "y": o.y, "z": o.z, "dx": d[0], "dy": d[1], "dz": d[2], "t": 0.0})
	ctx.event("angel_plumes", {"x": o.x, "y": o.y, "z": o.z, "dirs": dirs, "speed": P["speed"], "life": P["life"]})

func _update_feathers(dt: float, all: Array[PlayerSim]) -> void:
	var P: Dictionary = ac()["plumes"]
	for i in range(feathers.size() - 1, -1, -1):
		var f: Dictionary = feathers[i]
		var bx := float(f["x"])
		var by := float(f["y"])
		var bz := float(f["z"])
		f["t"] = float(f["t"]) + dt
		f["x"] = float(f["x"]) + float(f["dx"]) * float(P["speed"]) * dt
		f["y"] = float(f["y"]) + float(f["dy"]) * float(P["speed"]) * dt
		f["z"] = float(f["z"]) + float(f["dz"]) * float(P["speed"]) * dt
		var gone: bool = float(f["t"]) > float(P["life"]) or blocked(bx, by, bz, float(f["x"]), float(f["y"]), float(f["z"]))
		if not gone:
			for p in all:
				if Vector2(p.pos.x - float(f["x"]), p.pos.z - float(f["z"])).length() > float(P["radius"]) or float(f["y"]) < p.pos.y - 0.1 or float(f["y"]) > p.pos.y + 1.9:
					continue
				ctx.hurt_player(p, float(P["damage"]), 0.0, 0.0, "holy")
				gone = true
				break
		if gone:
			feathers.remove_at(i)

# ------------------------------------------------------------------ Jugement : un joueur est marqué ; à la fin de l'annonce un rayon le frappe, sauf si la flèche est entre eux
func _start_judge(all: Array[PlayerSim]) -> void:
	var J: Dictionary = ac()["judgment"]
	var t: PlayerSim = all[int(floor(_rand() * all.size()))]
	mark = {"target": t, "pid": ctx.pid_of(t), "t": float(J["tel"])}
	_set_state("judge_tel")
	ctx.event("boss_mark", {"pid": mark["pid"], "dur": J["tel"], "tel": J["tel"], "text": "JUGEMENT · cachez-vous derrière la flèche", "x": t.pos.x, "z": t.pos.z})

func _fire_judge(all: Array[PlayerSim]) -> void:
	var J: Dictionary = ac()["judgment"]
	var t: PlayerSim = mark["target"] if not mark.is_empty() else null
	mark = {}
	ctx.event("boss_mark", {"pid": null, "dur": 0})
	var hit := false
	var o := trumpet_world()
	if t != null and not t.dead and not t.downed and all.has(t) and not blocked(o.x, o.y, o.z, t.pos.x, t.pos.y + 1.1, t.pos.z):
		ctx.hurt_player(t, float(J["damage"]), 0.0, 0.0, "holy")
		hit = true
	var tx := t.pos.x if t != null else center.x
	var ty := t.pos.y + 1.1 if t != null else Cathedral.TOWER_TOP + 1.1
	var tz := t.pos.z if t != null else center.y
	ctx.event("angel_judge", {"x": o.x, "y": o.y, "z": o.z, "tx": tx, "ty": ty, "tz": tz, "hit": 1 if hit else 0})
	_set_state("judge")

# ------------------------------------------------------------------ pose (angel.js _pose) : les angles que la vue pose sur le modèle
func _apose() -> void:
	var code := bs
	var t := t_life
	flap = sin(t * 1.8) * 0.28
	spread = 0.0
	arm_r_x = -0.35
	arm_r_z = -0.25
	arm_l_x = -0.1
	arm_l_z = 0.3
	trumpet_glow = 0.0
	halo_k = 1.0
	match code:
		20:
			flap = sin(t * 5.0) * 0.12 + 0.35
			arm_r_x = -2.0
			arm_r_z = -0.1
			trumpet_glow = 0.5 + 0.5 * absf(sin(t * 14.0))
		21:
			flap = 0.6
			spread = 0.3
			arm_r_x = -2.0
			arm_r_z = -0.1
			trumpet_glow = 1.0
		22:
			flap = 0.55 + sin(t * 9.0) * 0.1
			spread = 0.5
			arm_r_x = -1.3
			arm_l_x = -1.3
			arm_r_z = -1.0
			arm_l_z = 1.0
		23:
			flap = 0.2 + sin(t * 4.0) * 0.08
			spread = 0.4
			arm_r_x = -3.0
			arm_l_x = -3.0
			arm_r_z = -0.3
			arm_l_z = 0.3
			halo_k = 1.8 + sin(t * 10.0) * 0.2
		24:
			flap = 0.7
			spread = 0.5
			arm_r_x = -1.5
			arm_l_x = -1.5
			arm_r_z = -0.1
			arm_l_z = 0.1
			halo_k = 2.4
		25:
			flap = sin(t * 6.0) * 0.5
			spread = 0.2
	el_r_x = -0.15 if (code == 20 or code == 21) else -0.45
	el_l_x = -0.35
	rig_y = 0.15 * sin(t * 6.0) if code == 23 else 0.0
