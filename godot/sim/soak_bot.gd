class_name SoakBot
extends RefCounted
## Pilote de longue partie (J11, `--soak=N` de main.gd) : un joueur qui se promène, vise et tire sur les zombies visibles, saute, enjambe, se débloque
## avec la touche K quand l'invite apparaît, achète tout, et reste en vie (santé rendue sous 35 PV, comme un joueur qui se soigne à l'abri) pour que
## la partie dure jusqu'à la manche demandée. Il sert à chercher les erreurs de script, les fuites, les blocages et les chutes de performance sur 15 manches et plus.
## Rapporte à chaque manche : mémoire, objets, noeuds, coût du pas de jeu.

const AIM_HEIGHT := 1.4
const SHOOT_RANGE := 45.0
const STUCK_SECONDS := 1.5     ## sans avancer d'un mètre en 1,5 s : on change de cap pour 2 s
const TURN_SECONDS := 2.0
const MAX_AMMO_PERIOD := 20.0  ## Munitions max toutes les 20 s

var rng := RandomNumberGenerator.new()
var heading := 0.0             ## cap de marche (yaw)
var goal := Vector2.ZERO
var _ref := Vector2.ZERO
var _ref_t := 0.0
var _turn_t := 0.0
var _jump_t := 0.0
var _ammo_t := 0.0
var _unstick_hold := false
var verbose := false
var _round_t0 := 0.0
var _stall_samples := 0
var heals := 0
var unstuck_holds := 0
var stuck_events := 0
var vaults := 0
var steps := 0
var step_us := 0
var step_us_max := 0
var worst: Array[int] = []      ## 50 pires pas (µs)
var rows: Array[Dictionary] = []
var _round_seen := 0
var _kills0 := 0
var _us_round := 0
var _steps_round := 0
var _us_max_round := 0

func _init(seed_value: int = 1) -> void:
	rng.seed = seed_value

## Loadout et état de départ.
func setup(g: Node) -> void:
	g.world.open_all_doors()
	g.points = 1000000
	for id in ["m249", "ak47"]:
		g.arms.give_weapon(id)
	for id in ["juggernog", "staminup", "doubletap", "speedcola", "quickrevive", "phdflopper"]:
		if g.has_method("add_perk"):
			g.add_perk(id)
	_pick_goal(g)
	g.vaulted.connect(func() -> void: vaults += 1)

func _pick_goal(g: Node) -> void:
	var zones: Array = g.world.objects["zones"]
	var z: Dictionary = zones[rng.randi() % zones.size()]
	var c: Variant = z.get("center")
	if c == null:
		goal = Vector2(g.player.pos.x + rng.randf_range(-60, 60), g.player.pos.z + rng.randf_range(-60, 60))
	else:
		goal = Vector2(float(c["x"]), float(c["z"]))

func think(g: Node) -> Dictionary:
	var p: PlayerSim = g.player
	var input := {}
	# aide : un joueur qui se soigne (hors fin de partie) et reçoit des munitions
	if p.health < 35.0 and not p.downed and not p.dead:
		p.health = p.max_health
		heals += 1
	if p.downed:
		p.revive(g.time)
		heals += 1
	_ammo_t -= 1.0 / 60.0
	if _ammo_t <= 0.0:
		_ammo_t = MAX_AMMO_PERIOD
		g.arms.max_ammo()
	# cap : vers le but, ou cap aléatoire quand on est bloqué
	var here := Vector2(p.pos.x, p.pos.z)
	_ref_t += 1.0 / 60.0
	if here.distance_to(_ref) > 1.0:
		_ref = here
		_ref_t = 0.0
	elif _ref_t > STUCK_SECONDS and _turn_t <= 0.0:
		_turn_t = TURN_SECONDS
		heading = rng.randf() * TAU
		stuck_events += 1
		_ref_t = 0.0
	if _turn_t > 0.0:
		_turn_t -= 1.0 / 60.0
	else:
		# peu de zombies restants depuis un moment (ceux qui n'ont aucun chemin tournent autour d'un mur, dans le JS aussi) : un joueur va les chercher
		if g.time - _round_t0 > 60.0 and g.alive_count() <= 4 and g.alive_count() > 0:
			for z: ZombieSim in g.zombies:
				if not z.dead:
					goal = Vector2(z.pos.x, z.pos.z)
					break
		var d := goal - here
		if d.length() < 8.0:
			_pick_goal(g)
		else:
			heading = atan2(-d.x, -d.y)
	# cible : le zombie visible le plus proche
	var eye := p.eye()
	var best: ZombieSim = null
	var best_d := INF
	for z: ZombieSim in g.zombies:
		if z.dead:
			continue
		var to := z.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		var l := to.length()
		if l > SHOOT_RANGE or l >= best_d:
			continue
		var dn := to / l
		if g.collision.ray_hit(eye.x, eye.y, eye.z, dn.x, dn.y, dn.z, l) < l - 0.01:
			continue
		best = z
		best_d = l
	if best != null:
		var d := best.pos + Vector3(0, AIM_HEIGHT, 0) - eye
		p.yaw = atan2(-d.x, -d.z)
		p.pitch = atan2(d.y, sqrt(d.x * d.x + d.z * d.z))
		input["fire"] = fmod(g.time, 0.1) < 0.05
		# on marche à reculons ou de côté pour garder ses distances : le cap de marche relatif à la visée
		var rel := heading - p.yaw
		input["mx"] = -sin(rel)
		input["mz"] = cos(rel)
	else:
		p.yaw = lerp_angle(p.yaw, heading, 0.15)
		p.pitch = lerpf(p.pitch, 0.0, 0.2)
		input["mx"] = 0.0
		input["mz"] = 1.0
		input["sprint"] = true
	if g.weapon.ammo == 0 and g.weapon.reserve > 0:
		input["reload"] = true
	# saut et enjambement quand on est bloqué ou devant un obstacle bas
	_jump_t -= 1.0 / 60.0
	if p.vault_ready or (_ref_t > 0.5 and _jump_t <= 0.0):
		input["jump"] = true
		_jump_t = 0.8
	# déblocage : on maintient K quand l'invite est là
	if g.unstick != null and g.unstick.stuck and g.unstick.cool <= 0.0:
		input["unstick"] = true
		_unstick_hold = true
	elif _unstick_hold:
		_unstick_hold = false
		unstuck_holds += 1
	if rng.randf() < 0.002:
		input["grenade"] = true
	if rng.randf() < 0.0015:
		input["knife"] = true
	if rng.randf() < 0.004 and not g.arms.inventory.is_empty():
		input["weapon"] = rng.randi() % g.arms.inventory.size()
	return input

## Après chaque pas de jeu : coût du pas et rapport de manche.
func after_step(g: Node, us: int) -> void:
	steps += 1
	step_us += us
	step_us_max = maxi(step_us_max, us)
	_us_round += us
	_steps_round += 1
	_us_max_round = maxi(_us_max_round, us)
	if verbose and steps % 1800 == 0:   # toutes les 30 s de jeu : où sont les zombies restants
		var parts: PackedStringArray = []
		for z: ZombieSim in g.zombies:
			if not z.dead:
				parts.append("%.0fm%s%s[%s%s%s%s np%.1f far%.0f sp%.1f st%.1f stk%.1f side%.1f]" % [Vector2(z.pos.x - g.player.pos.x, z.pos.z - g.player.pos.z).length(), "r%d" % z.region if z.region != 0 else "", "!" if z.no_progress > 1.0 else "", z.kind, "R" if z.runner else "", "C" if z.crawler else "", "V" if not z.vault.is_empty() else "", z.no_progress, z.far_t, z.speed, z.spawn_t, z.stuck_t, z.sidestep_t])
		print("  t=%.0f joueur (%.0f ; %.0f) PV %.0f, %d zombies : %s" % [g.time, g.player.pos.x, g.player.pos.z, g.player.health, parts.size(), " ".join(parts)])
	var r: int = g.round_number
	if r != _round_seen:
		_report(g, r)
		_round_seen = r
		_round_t0 = g.time
		_stall_samples = 0
	# manche qui s'éternise (> 200 s) : on suit les zombies restants pendant 12 s (position, case du champ de flux, direction)
	if g.time - _round_t0 > 200.0 and steps % 60 == 0 and _stall_samples < 12:
		_stall_samples += 1
		var nav: NavGrid = g.env.nav
		for z: ZombieSim in g.zombies:
			if z.dead:
				continue
			var ix := nav.cx(z.pos.x)
			var iz := nav.cz(z.pos.z)
			var dv := nav.dist[nav.idx(ix, iz)] if nav.inside(ix, iz) else -1
			var st := nav.steer(z.pos.x, z.pos.z)
			var dx: float = g.player.pos.x - z.pos.x
			var dz: float = g.player.pos.z - z.pos.z
			print("  STALL t=%.0f zombie %d (%.1f ; %.1f) joueur (%.1f ; %.1f) d=%.1f champ=%d steer=%s (%.2f ; %.2f) los=%s bloquee=%s np=%.1f stuck=%.1f side=%.1f vault=%s cd=%.1f" % [g.time, z.id, z.pos.x, z.pos.z, g.player.pos.x, g.player.pos.z, sqrt(dx * dx + dz * dz), dv, st, nav.steer_x, nav.steer_z, nav.los(z.pos.x, z.pos.z, g.player.pos.x, g.player.pos.z), nav.is_blocked_at(z.pos.x, z.pos.z), z.no_progress, z.stuck_t, z.sidestep_t, not z.vault.is_empty(), z.vault_cd])

func _report(g: Node, r: int) -> void:
	var row := {
		"round": r, "t": g.time, "kills": g.kills, "zombies": g.zombies.size(),
		"mem_mb": Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		"objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		"nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"orphans": int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
		"resources": int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		"step_avg_ms": (_us_round / float(maxi(1, _steps_round))) / 1000.0, "step_max_ms": _us_max_round / 1000.0,
		"heals": heals, "stuck": stuck_events, "unstuck": g.unstick.unstuck_count if g.unstick != null else 0, "vaults": vaults,
		"points": g.points, "sfx_voices": Sfx.voice_count(),
	}
	rows.append(row)
	_us_round = 0
	_steps_round = 0
	_us_max_round = 0
	print("SOAK manche %2d t=%6.1f s : %3d tués, %2d en vie, mém %.1f Mo, objets %d, noeuds %d (orphelins %d), ressources %d, pas %.2f ms (max %.1f), %d soins, %d blocages, %d déblocages, %d enjambements, relogés %d" % [
		r, g.time, g.kills, g.zombies.size(), row["mem_mb"], row["objects"], row["nodes"], row["orphans"], row["resources"], row["step_avg_ms"], row["step_max_ms"],
		heals, stuck_events, row["unstuck"], vaults, g.relocated])
