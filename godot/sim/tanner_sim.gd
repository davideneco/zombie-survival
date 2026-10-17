class_name TannerSim
extends BossSim
## Le Maître Tanneur (port de src/tanner.js) : mini-boss des quartiers de Petite France et de Saint-Pierre-le-Vieux (manches 15, 20, 25…, CONFIG.tanner).
## Sous-classe du Bourreau, mais une seule vraie attaque : le cône de vomi (annoncé `tel` s, `initial` dégâts puis `dps` par seconde pendant `duration` s ;
## le PHD Flopper ne protège pas) et l'appel de `summon.count` pestiférés. À sa mort : explosion (le PHD Flopper protège), Max Munitions, points (FinaleSim).
## Codes bs : 0 poursuite, 7 appel, 15 vomi (annonce), 16 vomi.

const TBS := {"chase": 0, "summon": 7, "vomit_tel": 15, "vomit": 16}

var vomit_dir := Vector3(0, 0, 1)
var _v_tick := 0.0
var _v_hit: Dictionary = {}

func _init(health_: float = 1.0, ctx_: BossCtx = null) -> void:
	super._init(health_, ctx_)
	var T: Dictionary = Config.at("tanner")
	boss_name = "MAÎTRE TANNEUR"
	speed = float(T["speed"])
	attack_damage = float(T["damage"])
	scale_override = 2.0
	mini = true
	state = "chase"
	cool = {"vomit": 3.0, "summon": 9.0}
	phase = 1

func _enter_phase(_n: int) -> void:   # le Tanneur n'a pas de phases (tanner.js : _enterPhase)
	if cool.is_empty():
		cool = {}
	speed = float(Config.at("tanner.speed"))

func is_invulnerable() -> bool:
	return false

## Un mini-boss prend les dégâts comme un zombie ordinaire (pas de sensibilités du Bourreau).
func damage(amount: float, head: bool, _hit: Dictionary = {}) -> bool:
	return _zdamage(amount, head)

func _set_state(s: String) -> void:
	state = s
	state_t = 0.0
	bs = int(TBS.get(s, 0))

func step(dt: float, env: ZombieEnv) -> void:
	if dead or spawn_t > 0.0:
		_zstep(dt, env)
		return
	strike_target = null
	strike_damage = 0.0
	var T: Dictionary = Config.at("tanner")
	state_t += dt
	for k: String in cool:
		cool[k] = float(cool[k]) - dt
	var cand: Array[PlayerSim] = []
	for t in env.players:
		if t != null and not t.dead and not t.downed and t.tregion == region:
			cand.append(t)
	var nr := _nearest(cand)
	var nearest: PlayerSim = nr[0]
	var nd: float = nr[1]
	match state:
		"chase":
			if nearest == null:
				walk_t += dt * 1.2
				_bpose()
				return
			_chase(dt, env, cand)
			bs = 0
			if attack_windup >= 0.0:
				return
			if float(cool["vomit"]) <= 0.0 and nd < float(T["vomit"]["range"]) - 1.5:
				vomit_dir = Vector3(nearest.pos.x - pos.x, 0.0, nearest.pos.z - pos.z).normalized()
				_set_state("vomit_tel")
				ctx.event("tanner_vomit", {"x": pos.x, "y": pos.y, "z": pos.z, "dx": vomit_dir.x, "dz": vomit_dir.z, "range": T["vomit"]["range"], "ang": T["vomit"]["angle"], "tel": T["vomit"]["tel"], "dur": T["vomit"]["duration"]})
			elif float(cool["summon"]) <= 0.0:
				_set_state("summon")
		"vomit_tel":
			_face(vomit_dir.x, vomit_dir.z, 10.0, dt)
			walk_t += dt * 2.0
			if state_t >= float(T["vomit"]["tel"]):
				_set_state("vomit")
				_v_tick = 0.0
				_v_hit = {}
				for p in _in_cone(cand, T):
					_v_hit[p] = true
					ctx.hurt_player(p, float(T["vomit"]["initial"]), 0.0, 0.0, "toxic")
		"vomit":
			_face(vomit_dir.x, vomit_dir.z, 1.5, dt)
			_v_tick -= dt
			if _v_tick <= 0.0:
				_v_tick = float(T["vomit"]["tick"])
				for p in _in_cone(cand, T):
					ctx.hurt_player(p, float(T["vomit"]["dps"]) * float(T["vomit"]["tick"]), 0.0, 0.0, "toxic")
			if state_t >= float(T["vomit"]["duration"]):
				cool["vomit"] = float(T["vomit"]["cooldown"])
				_set_state("chase")
		"summon":
			walk_t += dt * 1.5
			if state_t > 0.8 and not _summoned:
				_summoned = true
				ctx.summon_pest(self)
			if state_t >= 1.6:
				_summoned = false
				cool["summon"] = float(T["summon"]["cooldown"])
				_set_state("chase")
		_:
			_set_state("chase")
	if state != "chase":
		_bpose()

## Joueurs dans le cône de vomi (portée, demi-angle, étage).
func _in_cone(list: Array[PlayerSim], T: Dictionary) -> Array[PlayerSim]:
	var out: Array[PlayerSim] = []
	var cs := cos(deg_to_rad(float(T["vomit"]["angle"])))
	for p in list:
		var dx := p.pos.x - pos.x
		var dz := p.pos.z - pos.z
		var d := sqrt(dx * dx + dz * dz)
		if d > float(T["vomit"]["range"]) or absf(p.pos.y - pos.y) > 2.4:
			continue
		if d > 0.8 and (dx * vomit_dir.x + dz * vomit_dir.z) / d < cs:
			continue
		out.append(p)
	return out

func pose_overrides() -> Dictionary:
	var t := state_t
	match bs:
		15:   # il prend sa respiration : tête en arrière, ventre en avant
			return {"spine_x": -0.4, "head_x": -0.8, "sh0_x": -0.3, "sh1_x": -0.3, "head_z": sin(t * 20.0) * 0.08}
		16:   # il vomit : penché en avant, la tête balaie le cône
			return {"spine_x": 0.55, "head_x": 0.7 + sin(t * 9.0) * 0.1, "head_y": sin(t * 3.0) * 0.25, "sh0_x": -0.9, "sh1_x": -0.9}
		7:    # appel
			return {"spine_x": -0.15, "head_x": -0.6, "sh0_z": -1.5, "sh1_z": 1.5, "sh0_x": -1.2, "sh1_x": -1.2}
	return {}

func _bpose() -> void:
	if bs == 0:
		_pose(1.0, 1.1, 0.3, 0.2)
	else:
		_pose(0.15, 0.5, 0.2, 0.1)
