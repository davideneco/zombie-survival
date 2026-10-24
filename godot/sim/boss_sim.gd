class_name BossSim
extends ZombieSim
## Le Bourreau (port de src/boss.js) : boss de la fin de partie, colosse armé d'une hache géante, en quatre phases (CONFIG.finale.boss).
## L'IA est la machine à états de l'hôte ; la vue lit `state`, `bs` (code de pose) et `axe_hide_t`.
##   chase     poursuite et coups de hache (l'IA des zombies, ZombieSim.step, avec ses dégâts)
##   charge_tel / dash / stun / recover     charge : trait rouge au sol, ruée en ligne droite (étourdi s'il percute un mur)
##   slam_tel / slam     coup de hache au sol : onde de choc circulaire, on l'évite en sautant
##   chain_tel / chain   Chaînes : annoncées, elles attirent le joueur visé de quelques mètres
##   mark                la Sentence : un joueur est marqué, seul poursuivi, il reçoit plus de dégâts
##   axe_tel / axe       le Couperet : hache lancée aller-retour dans un couloir annoncé
##   fire                le Bûcher : cercles de feu annoncés
##   toll                le Glas : ondes de choc en série (transition invulnérable de la phase I à la II, puis régulier en phase IV)
##   summon / roar       renforts, rugissement
##   leap / hidden / rise     changements d'étage (scénarisés par la fin de partie)
## Phases : I (100 -> 70 %) nef, II (70 -> 45 %) la Sentence, III (45 -> 20 %) la plateforme, IV (20 -> 0 %) le Jugement.
## Codes bs : 0 poursuite, 2 charge (préparation), 3 ruée, 4 étourdi, 5 coup (préparation), 6 coup, 7 appel, 8 saut, 9 absent, 10 surgit,
##            11 chaînes, 12 hache lancée, 13 glas, 14 marque.
## Pur : aucun nœud. Les tirages passent par `_rand()` (Math.random du JS) pour que les tests puissent rejouer une suite imposée.

const BS := {"chase": 0, "charge_tel": 2, "dash": 3, "stun": 4, "slam_tel": 5, "slam": 6, "summon": 7, "leap": 8, "hidden": 9, "rise": 10, "recover": 0,
	"chain_tel": 11, "chain": 11, "axe_tel": 12, "axe": 12, "toll": 13, "mark": 14, "fire": 7, "roar": 7}
const POSE_NONE := {}

var boss_name := "LE BOURREAU"
var phase := 1
var state := "chase"
var state_t := 0.0
var invuln := 0.0
var bs := 0
var dash_dir := Vector3(0, 0, 1)
var hit_set: Dictionary = {}       ## joueurs déjà touchés par la ruée
var shocks: Array = []             ## ondes de choc en cours : { r, max, dmg, hit }
var leaped := false
var mark: Dictionary = {}          ## Sentence en cours : { target, pid, t } ; vide si aucune
var fires: Array = []              ## cercles du Bûcher : { x, z, t, dur, tick, y }
var axe_flight: Dictionary = {}    ## hache lancée : { dx, dz, x, z, t, hit: [{}, {}] }
var axe_hide_t := 0.0              ## la hache est lâchée : cachée dans la main
var fight_t := 0.0                 ## durée du combat (s) : au-delà de enrageAfter, tous ses coups sont renforcés
var cool: Dictionary = {}
var ctx: BossCtx
var rand_fn: Callable              ## tirage de test (équivalent de Math.random) ; invalide : rng du jeu
var _chain: Dictionary = {}
var _axe_aim: Dictionary = {}
var _pending_mark: PlayerSim
var _wall := 0
var _summoned := false
var _toll_adds := false
var _toll_t := 0.0
var _toll_waves := 0
var _toll_transition := false
var _toll_len := 0.0
var _rise_y := 0.0
var _has_rise_y := false

static func bc() -> Dictionary:
	return Config.at("finale.boss")

func _init(health_: float = 1.0, ctx_: BossCtx = null) -> void:
	is_boss = true
	var B := bc()
	max_health = health_
	health = health_
	speed = float((B["speed"] as Array)[0])
	attack_damage = float(Config.at("finale.bossDamage"))
	scale_override = 2.25
	runner = false
	limp = false
	ctx = ctx_
	_enter_phase(1)

func _rand() -> float:
	if rand_fn.is_valid():
		return float(rand_fn.call())
	return rng.randf() if rng != null else randf()

# ------------------------------------------------------------------ phases
## Recharges d'une phase (les attaques absentes de la phase : INF) ; la première attaque vient assez vite.
func _enter_phase(n: int) -> void:
	phase = n
	var cd: Dictionary = bc()["cd"]
	var k := n - 1
	cool = {"gap": 1.5, "charge": _first(cd["charge"], k, 0.7), "slam": _first(cd["slam"], k, 0.8), "chain": _first(cd["chain"], k, 0.5),
		"sentence": _first(cd["sentence"], k, 0.2), "summon": _first(cd["summon"], k, 0.7), "axe": _first(cd["axe"], k, 0.4),
		"fire": _first(cd["fire"], k, 0.3), "toll": _first(cd["toll"], k, 0.6)}
	speed = float((bc()["speed"] as Array)[k])

static func _first(arr: Array, k: int, f: float) -> float:
	return float(arr[k]) * f if float(arr[k]) > 0.0 else INF

func is_invulnerable() -> bool:
	return invuln > 0.0 or state == "hidden" or state == "leap"

func targetable() -> bool:
	return state != "hidden" and state != "leap" and super.targetable()

## Sommes-nous derrière le boss, vu depuis (x, z) ? (produit scalaire direction boss -> point, cap du boss < backCos)
func is_back(x: float, z: float) -> bool:
	var dx := x - pos.x
	var dz := z - pos.z
	var l := sqrt(dx * dx + dz * dz)
	if l == 0.0:
		l = 1.0
	return (dx * sin(yaw) + dz * cos(yaw)) / l < float(bc()["sens"]["backCos"])

# ------------------------------------------------------------------ dégâts
## hit : { x, z (point d'impact ; pour le couteau, la position de l'attaquant), zone, ray (tir direct du pistolet à rayons), mel, back, pid }.
## Face (tête comprise) x front ; dos x back (x backSentence si la Sentence vise un autre joueur) ; zone ; ray ; étourdi.
func damage(amount: float, _head: bool, hit: Dictionary = {}) -> bool:
	if dead or is_invulnerable():
		return false
	var S: Dictionary = bc()["sens"]
	var m: float
	if not hit.is_empty() and hit.get("zone", false):
		m = float(S["zone"])
	else:
		var back := false
		if not hit.is_empty():
			back = bool(hit["back"]) if hit.get("back", null) != null else is_back(float(hit["x"]), float(hit["z"]))
		m = float(S["front"])
		if back:
			m = float(S["backSentence"]) if (not mark.is_empty() and not hit.is_empty() and hit.get("pid", null) != mark["pid"]) else float(S["back"])
		if not hit.is_empty() and hit.get("ray", false):
			m = float(S["ray"]) * float(S["back"]) if back else float(S["ray"])
	if state == "stun":
		m *= float(S["stun"])
	var died := _zdamage(amount * m, false)
	if died or ctx == null:
		return died
	# seuils de phase : un coup n'en franchit qu'un à la fois (la santé est ramenée au seuil), la transition est invulnérable
	var T: Array = bc()["thresholds"]
	var mx := max_health
	if phase == 1 and health < float(T[0]) * mx:
		health = float(T[0]) * mx
		begin_toll(true)
	elif phase == 2 and health < float(T[1]) * mx:
		health = float(T[1]) * mx
		if ctx.want_leap:
			begin_leap()
		else:   # v0.34.0 : fin de partie sans tour (Station des Aiguilles) : la phase III se joue sur place
			_enter_phase(3)
	elif phase == 3 and health < float(T[2]) * mx:
		health = float(T[2]) * mx
		enrage()
	return false

## 20 % : rugissement invulnérable puis le Jugement (phase IV).
func enrage() -> void:
	_enter_phase(4)
	_clear_transient()
	cool["fire"] = 3.0
	cool["toll"] = 9.0
	invuln = float(bc()["rage"]["roar"])
	_set_state("roar")
	ctx.event("boss_roar", {"x": pos.x, "y": pos.y, "z": pos.z, "text": "LE JUGEMENT !"})

## 70 % : le Glas, 10 s d'invulnérabilité et des renforts ; en phase IV : le Glas ordinaire (sans invulnérabilité ni renforts).
func begin_toll(transition: bool) -> void:
	var G: Dictionary = bc()["glas"]
	_clear_transient()
	if transition:
		_enter_phase(2)
		invuln = float(G["invuln"])
		cool["sentence"] = float(G["invuln"]) + 3.0
		cool["summon"] = float(G["invuln"]) + 12.0
	_toll_t = 0.0
	_toll_waves = 0
	_toll_transition = transition
	_toll_len = float(G["invuln"]) if transition else float(G["waves"]) * float(G["interval"]) + 0.8
	if not transition:
		cool["toll"] = float((bc()["cd"]["toll"] as Array)[3])   # recharge comptée depuis le début : un Glas toutes les 25 s
	_set_state("toll")
	attack_windup = -1.0
	ctx.event("boss_roar", {"x": pos.x, "y": pos.y, "z": pos.z, "text": "LE GLAS SONNE !" if transition else "LE GLAS !"})

func begin_leap() -> void:
	leaped = true
	_enter_phase(3)
	_clear_transient()
	_set_state("leap")
	invuln = 99.0
	attack_windup = -1.0
	ctx.event("boss_roar", {"x": pos.x, "y": pos.y, "z": pos.z, "text": "Le Bourreau, blessé, bondit vers la tour !"})

## Le Bourreau (re)surgit dans un étage donné.
func arrive(region_: int, x: float, z: float, y: float) -> void:
	region = region_
	link = {}
	pos = Vector3(x, y - 3.0, z)
	hidden_flag = false
	_set_state("rise")
	invuln = 2.6
	var keep := phase
	_enter_phase(keep)
	cool["charge"] = minf(float(cool["charge"]), 3.0)
	cool["axe"] = minf(float(cool["axe"]), 4.0)
	cool["chain"] = minf(float(cool["chain"]), 6.0)
	ctx.event("boss_rise", {"x": x, "y": y, "z": z})
	_rise_y = y
	_has_rise_y = true

func _set_state(s: String) -> void:
	state = s
	state_t = 0.0
	bs = int(BS.get(s, 0))

func _clear_transient() -> void:
	if not mark.is_empty() or _pending_mark != null:
		ctx.event("boss_mark", {"pid": null, "dur": 0})   # la couronne disparaît chez tout le monde
	mark = {}
	_pending_mark = null
	shocks.clear()
	axe_flight = {}
	axe_hide_t = 0.0
	_chain = {}
	_axe_aim = {}

## Multiplicateur des dégâts infligés à p : Sentence, puis enragement après enrageAfter s de combat.
func deal_mult(p: PlayerSim) -> float:
	var B := bc()
	var m := float(B["enrageMult"]) if fight_t > float(B["enrageAfter"]) else 1.0
	if not mark.is_empty() and mark["target"] == p:
		m *= float(B["sentence"]["mult"])
	return m

func _hurt(p: PlayerSim, dmg: float, kx: float, kz: float, src: String = "") -> void:
	if ctx != null:
		ctx.hurt_player(p, dmg * deal_mult(p), kx, kz, src)

# ------------------------------------------------------------------ IA (hôte)
func step(dt: float, env: ZombieEnv) -> void:
	if dead or spawn_t > 0.0:
		_zstep(dt, env)
		return
	strike_target = null
	strike_damage = 0.0
	var B := bc()
	var lv := env.levels
	var base_y := float(lv.regions[region]["y"]) if (region != 0 and lv != null) else 0.0
	state_t += dt
	invuln = maxf(0.0, invuln - dt)
	axe_hide_t = maxf(0.0, axe_hide_t - dt)
	if state != "hidden" and state != "leap":
		fight_t += dt
	for k: String in cool:
		cool[k] = float(cool[k]) - dt
	var all: Array[PlayerSim] = []
	for t in env.players:
		if t != null and not t.dead and not t.downed and t.tregion == region:
			all.append(t)
	if not mark.is_empty() and (float(mark["t"]) <= 0.0 or not all.has(mark["target"])):
		_end_mark()
	var cand: Array[PlayerSim] = []
	if not mark.is_empty():
		cand.append(mark["target"])
	else:
		cand = all
	if state != "rise":
		pos.y = base_y
	attack_damage = float(Config.at("finale.bossDamage")) * (float(B["enrageMult"]) if fight_t > float(B["enrageAfter"]) else 1.0) * (float(B["sentence"]["mult"]) if not mark.is_empty() else 1.0)
	if not mark.is_empty():
		mark["t"] = float(mark["t"]) - dt
	_update_shocks(dt, all, base_y)
	_update_fires(dt, all)
	_update_axe(dt, all)

	match state:
		"rise":   # surgit du sol
			var k := minf(1.0, state_t / 2.4)
			pos.y = (_rise_y if _has_rise_y else base_y) - 3.0 * (1.0 - k * k * (3.0 - 2.0 * k))
			if _rand() < dt * 14.0 and ctx != null:
				ctx.dust(pos.x, base_y + 0.2, pos.z)
			if state_t >= 2.4:
				pos.y = _rise_y if _has_rise_y else base_y
				_set_state("chase")
		"chase":
			var nr := _nearest(cand)
			var tg: PlayerSim = nr[0]
			var d: float = nr[1]
			speed = float(B["sentence"]["speed"]) if not mark.is_empty() else float((B["speed"] as Array)[phase - 1])
			if tg == null:
				walk_t += dt * 1.2
				_bpose()
				return
			_chase(dt, env, cand)   # poursuite et coups de hache : IA des zombies
			bs = 0
			if attack_windup >= 0.0 or float(cool["gap"]) > 0.0:
				return
			var ph := phase
			var far: Variant = _farthest(all)
			var cd: Dictionary = B["chain"]
			if ph == 4 and float(cool["toll"]) <= 0.0:
				begin_toll(false)
			elif ph == 4 and float(cool["fire"]) <= 0.0 and not all.is_empty():
				_start_fire(all)
			elif ph >= 3 and float(cool["axe"]) <= 0.0 and d > 5.0 and d < 20.0:
				_start_axe(tg)
			elif float(cool["charge"]) <= 0.0 and d > 4.5 and d < 20.0:
				_start_charge(tg)
			elif float(cool["chain"]) <= 0.0 and far != null and float(far[1]) > float(cd["minDist"]) and float(far[1]) < float(cd["maxDist"]):
				_start_chain(tg if not mark.is_empty() else far[0])
			elif float(cool["slam"]) <= 0.0 and d < 7.5:
				_set_state("slam_tel")
			elif ph == 2 and float(cool["sentence"]) <= 0.0 and mark.is_empty() and not all.is_empty():
				_start_mark(all)
			elif ph == 2 and float(cool["summon"]) <= 0.0:
				_set_state("summon")
		"charge_tel":
			var tg2: PlayerSim = _nearest(cand)[0]
			if tg2 != null and state_t < 0.8:
				var v := Vector3(tg2.pos.x - pos.x, 0.0, tg2.pos.z - pos.z)
				dash_dir = v.normalized()
			_face(dash_dir.x, dash_dir.z, 12.0, dt)
			walk_t += dt * 14.0   # il piaffe
			if state_t >= 1.15:
				hit_set.clear()
				_set_state("dash")
				_wall = 0
		"dash":
			var sp := 15.0 + phase * 1.5
			var bx := pos.x
			var bz := pos.z
			pos.x += dash_dir.x * sp * dt
			pos.z += dash_dir.z * sp * dt
			pos = env.collision.resolve(pos, 0.9)
			var moved := Vector2(pos.x - bx, pos.z - bz).length()
			if moved < sp * dt * 0.55:
				_wall += 1
			else:
				_wall = 0
			_face(dash_dir.x, dash_dir.z, 20.0, dt)
			walk_t += dt * 18.0
			for t in all:
				if hit_set.has(t) or absf(t.pos.y - pos.y) > 2.2:
					continue
				if Vector2(t.pos.x - pos.x, t.pos.z - pos.z).length() < 2.0:
					hit_set[t] = true
					_hurt(t, float(Config.at("finale.chargeDamage")), dash_dir.x * 9.0, dash_dir.z * 9.0)
			if _wall >= 2:
				ctx.event("boss_stun", {"x": pos.x, "y": pos.y, "z": pos.z})
				ctx.dust(pos.x, base_y + 1.0, pos.z, 16)
				_set_state("stun")
			elif state_t > 1.4:
				_set_state("recover")
		"stun":
			walk_t += dt * 2.0
			if state_t >= 2.4:
				_back_to_chase("charge")
		"recover":
			walk_t += dt * 1.5
			if state_t >= 0.8:
				_back_to_chase("charge")
		"slam_tel":
			var tg3: PlayerSim = _nearest(cand)[0]
			if tg3 != null:
				_face(tg3.pos.x - pos.x, tg3.pos.z - pos.z, 6.0, dt)
			if state_t >= 1.0:
				_add_shock(float(Config.at("finale.slamDamage")), 13.0)
				ctx.event("boss_shock", {"x": pos.x, "y": base_y, "z": pos.z})
				_set_state("slam")
		"slam":
			if state_t >= 1.1:
				_back_to_chase("slam")
		"chain_tel":
			if _chain.is_empty():
				_back_to_chase("")
			else:
				var c := _chain
				var tg4: PlayerSim = c["target"] if all.has(c["target"]) else _nearest(all)[0]
				if tg4 != null and state_t < float(B["chain"]["tel"]) - 0.3:
					c["dx"] = tg4.pos.x - pos.x
					c["dz"] = tg4.pos.z - pos.z
					var l := sqrt(float(c["dx"]) * float(c["dx"]) + float(c["dz"]) * float(c["dz"]))
					if l == 0.0:
						l = 1.0
					c["dx"] = float(c["dx"]) / l
					c["dz"] = float(c["dz"]) / l
				_face(float(c["dx"]), float(c["dz"]), 10.0, dt)
				if state_t >= float(B["chain"]["tel"]):
					_fire_chain(all)
		"chain":
			if state_t >= 0.5:
				_back_to_chase("chain")
		"mark":
			var mk := _pending_mark
			if mk != null:
				_face(mk.pos.x - pos.x, mk.pos.z - pos.z, 8.0, dt)
			if state_t >= float(B["sentence"]["tel"]):
				if mk != null and all.has(mk):
					mark = {"target": mk, "pid": ctx.pid_of(mk) if ctx != null else -1, "t": float(B["sentence"]["duration"])}
				else:
					mark = {}
				_pending_mark = null
				if mark.is_empty():
					cool["sentence"] = 6.0
				_set_state("chase")
		"axe_tel":
			if _axe_aim.is_empty():
				_back_to_chase("")
			else:
				var a := _axe_aim
				var tg5: PlayerSim = a["target"] if all.has(a["target"]) else _nearest(all)[0]
				var Cp: Dictionary = B["couperet"]
				if tg5 != null and state_t < float(Cp["tel"]) - 0.4:
					a["dx"] = tg5.pos.x - pos.x
					a["dz"] = tg5.pos.z - pos.z
					var l2 := sqrt(float(a["dx"]) * float(a["dx"]) + float(a["dz"]) * float(a["dz"]))
					if l2 == 0.0:
						l2 = 1.0
					a["dx"] = float(a["dx"]) / l2
					a["dz"] = float(a["dz"]) / l2
				_face(float(a["dx"]), float(a["dz"]), 12.0, dt)
				if state_t >= float(Cp["tel"]):
					axe_flight = {"dx": a["dx"], "dz": a["dz"], "x": pos.x, "z": pos.z, "t": 0.0, "hit": [{}, {}]}
					axe_hide_t = float(Cp["flight"]) * 2.0 + 0.25
					_set_state("axe")
		"axe":
			if state_t >= float(B["couperet"]["flight"]) * 2.0 + 0.35:
				_back_to_chase("axe")
		"fire":
			if state_t >= 1.0:
				_back_to_chase("fire")
		"roar":
			walk_t += dt * 3.0
			if state_t >= float(B["rage"]["roar"]):
				_set_state("chase")
		"toll":
			var G: Dictionary = B["glas"]
			_toll_t += dt
			walk_t += dt * 2.0
			while _toll_waves < int(G["waves"]) and _toll_t >= float(G["interval"]) * (_toll_waves + 1):
				_toll_waves += 1
				_add_shock(float(G["damage"]), 13.0)
				ctx.event("boss_shock", {"x": pos.x, "y": base_y, "z": pos.z, "toll": 1})
			if _toll_transition and not _toll_adds and _toll_t > 0.8:
				_toll_adds = true
				ctx.glas_adds(self)
			if _toll_t >= _toll_len:
				_toll_adds = false
				_set_state("chase")
				cool["gap"] = 1.5
		"summon":
			if state_t > 0.9 and not _summoned:
				_summoned = true
				ctx.summon(self)
				ctx.event("boss_roar", {"x": pos.x, "y": pos.y, "z": pos.z})
			if state_t >= 1.9:
				_summoned = false
				_back_to_chase("summon")
		"leap":
			# un saut puissant : le Bourreau quitte l'étage (il resurgira là-haut)
			var k2 := state_t / 1.4
			pos.y = base_y + sin(minf(1.0, k2) * PI) * 5.0
			if state_t >= 1.4:
				hidden_flag = true
				state = "hidden"
				bs = 9
				ctx.on_leap(self)
		"hidden":
			pass
		_:
			pass
	if state != "chase":
		_bpose()

var hidden_flag := false   ## le modèle est caché (en attendant d'« arriver » ailleurs)

## Un pas de zombie ordinaire (ZombieSim.step) : mort, apparition, poursuite et coups.
func _zstep(dt: float, env: ZombieEnv) -> void:
	super.step(dt, env)

## Poursuite : l'IA des zombies avec pour seuls joueurs ceux de `cand`.
func _chase(dt: float, env: ZombieEnv, cand: Array[PlayerSim]) -> void:
	var saved := env.players
	env.players = cand
	super.step(dt, env)
	env.players = saved

func _nearest(list: Array[PlayerSim]) -> Array:
	var b: PlayerSim = null
	var bd := INF
	for t in list:
		var d := Vector2(t.pos.x - pos.x, t.pos.z - pos.z).length()
		if d < bd:
			bd = d
			b = t
	return [b, bd]

func _farthest(list: Array[PlayerSim]) -> Variant:
	var b: PlayerSim = null
	var bd := -1.0
	for t in list:
		var d := Vector2(t.pos.x - pos.x, t.pos.z - pos.z).length()
		if d > bd:
			bd = d
			b = t
	return [b, bd] if b != null else null

func _face(dx: float, dz: float, k: float, dt: float) -> void:
	var d := atan2(dx, dz) - yaw
	d = atan2(sin(d), cos(d))
	yaw += d * minf(1.0, dt * k)

func _back_to_chase(attack: String) -> void:
	var cd: Variant = bc()["cd"].get(attack, null) if attack != "" else null
	var k := phase - 1
	if attack != "" and cd != null and float((cd as Array)[k]) > 0.0:
		cool[attack] = float((cd as Array)[k])
	cool["gap"] = float(bc()["gap"])
	_set_state("chase")

# ------------------------------------------------------------------ onde de choc : anneau qui s'étend ; les joueurs au sol sur l'anneau sont touchés (on saute par-dessus)
func _add_shock(dmg: float, mx: float) -> void:
	shocks.append({"r": 0.5, "max": mx, "dmg": dmg, "hit": {}})

func _update_shocks(dt: float, all: Array[PlayerSim], base_y: float) -> void:
	for i in range(shocks.size() - 1, -1, -1):
		var s: Dictionary = shocks[i]
		s["r"] = float(s["r"]) + 15.0 * dt
		for t in all:
			if (s["hit"] as Dictionary).has(t):
				continue
			var dd := Vector2(t.pos.x - pos.x, t.pos.z - pos.z).length()
			if absf(dd - float(s["r"])) > 1.1 or absf(t.pos.y - pos.y) > 2.6:
				continue
			var airborne := t.pos.y > base_y + 0.45   # en l'air : l'onde passe dessous
			(s["hit"] as Dictionary)[t] = true
			if not airborne:
				var dv := dd if dd != 0.0 else 1.0
				_hurt(t, float(s["dmg"]), (t.pos.x - pos.x) / dv * 7.0, (t.pos.z - pos.z) / dv * 7.0)
		if float(s["r"]) > float(s["max"]):
			shocks.remove_at(i)

# ------------------------------------------------------------------ Chaînes : annoncées, tirées vers le joueur le plus loin ; elles touchent tout joueur dans le couloir et l'attirent de `pull` m
func _start_chain(target: PlayerSim) -> void:
	var C: Dictionary = bc()["chain"]
	var dx := target.pos.x - pos.x
	var dz := target.pos.z - pos.z
	var l := sqrt(dx * dx + dz * dz)
	if l == 0.0:
		l = 1.0
	_chain = {"target": target, "dx": dx / l, "dz": dz / l}
	_set_state("chain_tel")
	ctx.event("boss_chain", {"x": pos.x, "y": pos.y, "z": pos.z, "dx": dx / l, "dz": dz / l, "len": float(C["maxDist"]) + 2.0, "w": C["width"], "tel": C["tel"]})

func _fire_chain(all: Array[PlayerSim]) -> void:
	var C: Dictionary = bc()["chain"]
	var c := _chain
	for t in all:
		var rx := t.pos.x - pos.x
		var rz := t.pos.z - pos.z
		var along := rx * float(c["dx"]) + rz * float(c["dz"])
		var side := absf(-rx * float(c["dz"]) + rz * float(c["dx"]))
		if along < 0.5 or along > float(C["maxDist"]) + 2.0 or side > float(C["width"]) / 2.0 + 0.4 or absf(t.pos.y - pos.y) > 2.4:
			continue
		var pull := maxf(0.0, minf(float(C["pull"]), along - 2.4))   # on ne traverse pas le boss
		_hurt(t, float(C["damage"]), -float(c["dx"]) * pull, -float(c["dz"]) * pull, "chain")
	_chain = {}
	_set_state("chain")

# ------------------------------------------------------------------ Sentence : la couronne marque un joueur
func _start_mark(all: Array[PlayerSim]) -> void:
	var t: PlayerSim = all[int(floor(_rand() * all.size()))]
	_pending_mark = t
	_set_state("mark")
	var S: Dictionary = bc()["sentence"]
	ctx.event("boss_mark", {"pid": ctx.pid_of(t), "dur": S["duration"], "tel": S["tel"], "x": t.pos.x, "z": t.pos.z})

func _end_mark() -> void:
	mark = {}
	cool["sentence"] = float((bc()["cd"]["sentence"] as Array)[1])
	ctx.event("boss_mark", {"pid": null, "dur": 0})

# ------------------------------------------------------------------ Couperet : couloir annoncé, puis la hache part et revient
func _start_axe(target: PlayerSim) -> void:
	var C: Dictionary = bc()["couperet"]
	var dx := target.pos.x - pos.x
	var dz := target.pos.z - pos.z
	var l := sqrt(dx * dx + dz * dz)
	if l == 0.0:
		l = 1.0
	_axe_aim = {"target": target, "dx": dx / l, "dz": dz / l}
	_set_state("axe_tel")
	ctx.event("boss_axe", {"x": pos.x, "y": pos.y, "z": pos.z, "dx": dx / l, "dz": dz / l, "len": C["length"], "w": C["width"], "tel": C["tel"], "flight": C["flight"]})

func _update_axe(dt: float, all: Array[PlayerSim]) -> void:
	if axe_flight.is_empty():
		return
	var C: Dictionary = bc()["couperet"]
	var f := axe_flight
	f["t"] = float(f["t"]) + dt
	var total := float(C["flight"]) * 2.0
	if float(f["t"]) > total:
		axe_flight = {}
		return
	var leg := 0 if float(f["t"]) < float(C["flight"]) else 1
	var u := float(f["t"]) / float(C["flight"]) if leg == 0 else (total - float(f["t"])) / float(C["flight"])
	var s := maxf(0.0, minf(1.0, u)) * float(C["length"])   # distance de la hache au boss
	for t in all:
		if (f["hit"][leg] as Dictionary).has(t) or absf(t.pos.y - pos.y) > 2.4:
			continue
		var rx := t.pos.x - float(f["x"])
		var rz := t.pos.z - float(f["z"])
		var along := rx * float(f["dx"]) + rz * float(f["dz"])
		var side := absf(-rx * float(f["dz"]) + rz * float(f["dx"]))
		if side > float(C["width"]) / 2.0 + 0.3 or absf(along - s) > 1.6:
			continue
		(f["hit"][leg] as Dictionary)[t] = true
		_hurt(t, float(C["damage"]), float(f["dx"]) * 3.0, float(f["dz"]) * 3.0, "axe")

# ------------------------------------------------------------------ Bûcher : des cercles de feu sous (et autour de) chaque joueur, annoncés puis brûlants
func _start_fire(all: Array[PlayerSim]) -> void:
	var P: Dictionary = bc()["pyre"]
	var n := int(P["circles"]) + int(P["perPlayer"]) * maxi(0, all.size() - 1)
	var pts: Array = []
	for i in n:
		var t := all[i % all.size()]
		var a := _rand() * TAU
		var r := 0.0 if i < all.size() else 1.5 + _rand() * 3.0   # un cercle sur chaque joueur, les autres autour
		var x := t.pos.x + cos(a) * r
		var z := t.pos.z + sin(a) * r
		pts.append([floorf(x * 100.0 + 0.5) / 100.0, floorf(z * 100.0 + 0.5) / 100.0])   # Math.round
		fires.append({"x": x, "z": z, "y": t.pos.y, "t": -float(P["tel"]), "dur": P["duration"], "tick": 0.0})
	_set_state("fire")
	ctx.event("boss_fire", {"pts": pts, "y": pos.y, "r": P["radius"], "tel": P["tel"], "dur": P["duration"]})

func _update_fires(dt: float, all: Array[PlayerSim]) -> void:
	var P: Dictionary = bc()["pyre"]
	for i in range(fires.size() - 1, -1, -1):
		var f: Dictionary = fires[i]
		f["t"] = float(f["t"]) + dt
		if float(f["t"]) < 0.0:
			continue   # annonce
		if float(f["t"]) > float(f["dur"]):
			fires.remove_at(i)
			continue
		f["tick"] = float(f["tick"]) - dt
		if float(f["tick"]) > 0.0:
			continue
		f["tick"] = float(P["tick"])
		for t in all:
			if Vector2(t.pos.x - float(f["x"]), t.pos.z - float(f["z"])).length() < float(P["radius"]) and absf(t.pos.y - float(f["y"])) < 2.0:
				_hurt(t, float(P["dps"]) * float(P["tick"]), 0.0, 0.0, "fire")

func _start_charge(target: PlayerSim) -> void:
	dash_dir = Vector3(target.pos.x - pos.x, 0.0, target.pos.z - pos.z).normalized()
	_set_state("charge_tel")
	ctx.event("boss_tele", {"x": pos.x, "z": pos.z, "dx": dash_dir.x, "dz": dash_dir.z})

# ------------------------------------------------------------------ pose selon l'état (la vue en tire les angles : voir BossSim.pose_overrides)
## Pose du corps de zombie (ZombieSim._pose) selon le code d'état : jambes et bras de base ; les angles propres au code viennent de pose_overrides.
func _bpose() -> void:
	if bs == 0:
		_pose(1.0, 1.1, 0.3, 0.2)
	else:
		_pose(1.6 if bs == 3 else 0.4, 0.5, 0.2, 0.1)

## Angles (rad) imposés par le code d'état après la pose de base : spine_x, spine_z, head_x, head_y, head_z, sh0_x, sh1_x, sh0_z, sh1_z, el0_x, el1_x
## (absents : inchangés). Port de Boss._pose.
func pose_overrides() -> Dictionary:
	var code := bs
	var t := state_t
	var wob := sin(walk_t * 1.7)
	var o := {}
	match code:
		2:
			o = {"spine_x": 0.8, "head_x": 0.5, "sh0_x": -0.4, "sh1_x": -0.4}
		3:
			o = {"spine_x": 1.05, "head_x": 0.3, "sh0_x": 0.5, "sh1_x": -0.6}
		4:
			o = {"spine_x": 0.2 + wob * 0.15, "spine_z": wob * 0.25, "head_x": 0.6, "head_z": wob * 0.4, "sh0_x": 0.1, "sh1_x": 0.1}
		5:
			o = {"spine_x": -0.35, "head_x": -0.3, "sh0_x": -3.0, "sh1_x": -3.0, "el0_x": -0.2, "el1_x": -0.2}
		6:
			o = {"spine_x": 0.75, "head_x": 0.3, "sh0_x": -0.5, "sh1_x": -0.5}
		7:
			o = {"spine_x": -0.15, "head_x": -0.6, "sh0_z": -1.5, "sh1_z": 1.5, "sh0_x": -1.2, "sh1_x": -1.2}
		8:
			o = {"spine_x": 0.3, "sh0_x": -2.4, "sh1_x": -2.4}
		11:
			o = {"spine_x": 0.35, "head_x": 0.1, "sh0_x": -1.55 + sin(t * 22.0) * 0.12, "sh1_x": -1.55 + sin(t * 22.0) * 0.12, "sh0_z": -0.25, "sh1_z": 0.25}
		12:
			o = {"spine_x": -0.25, "head_x": -0.15, "sh1_x": -3.1 + sin(t * 10.0) * 0.08, "el1_x": -0.3, "sh0_x": -1.4}
		13:
			var hit := absf(sin(t * 2.6))
			o = {"spine_x": -0.2 + hit * 0.5, "head_x": -0.4 + hit * 0.6, "sh0_x": -2.9 + hit * 2.2, "sh1_x": -2.9 + hit * 2.2, "sh0_z": -0.2, "sh1_z": 0.2}
		14:
			o = {"spine_x": 0.15, "head_x": 0.2, "sh1_x": -1.6, "el1_x": -0.1, "sh0_x": -0.3}
	return o
