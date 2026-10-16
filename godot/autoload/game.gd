extends Node
## Etat de partie : l'« hôte » du jeu (équivalent de l'objet game de src/main.js). En solo la machine locale est l'hôte d'une partie
## sans client : toute mutation autoritaire (apparition, dégâts, points, manches) passe par une méthode d'ici, futur point d'émission
## réseau (docs/GODOT_PORT.md § 1.3). La simulation avance par step(dt, input), sans nœud ni rendu : les scènes ne font que la lire
## (et les tests headless l'appellent directement). Les signaux servent à la présentation (sons, effets, HUD).

signal round_started(number: int)
signal round_ended
signal zombie_spawned(z: ZombieSim)
signal zombie_killed(z: ZombieSim, head: bool)
signal shot_fired(origin: Vector3, end: Vector3)
signal player_hurt(amount: float)
signal game_over

var round_number: int:
	get: return director.round_number if director != null else 0
var points := 0
var kills := 0
var time := 0.0
var playing := false
var over := false

var arena: Arena
var player: PlayerSim
var weapon: WeaponSim
var director: RoundDirector
var zombies: Array[ZombieSim] = []
var rng := RandomNumberGenerator.new()
var _next_id := 1
var _trigger := false      ## clic maintenu / verrou « un tir par clic » des armes semi-automatiques
var _fire_prev := false

func version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0.0.0"))

## Santé d'un zombie ordinaire à la manche r (courbe de CONFIG.zombie.health ; équivalent de game.zombieHealthAt).
func zombie_health_at(r: int) -> int:
	var h: Dictionary = Config.at("zombie.health")
	if r < int(h["softRound"]):
		return int(h["base"] + r * h["perRound"])
	return int(floor(h["hardBase"] * pow(h["hardGrowth"], r - h["softRound"] + 1) + 0.5))

## Nouvelle partie dans l'arène (graine fixe pour les tests reproductibles ; -1 : aléatoire).
func new_game(seed_value: int = -1) -> void:
	if seed_value >= 0:
		rng.seed = seed_value
	else:
		rng.randomize()
	arena = Arena.load_arena()
	player = PlayerSim.new()
	player.reset(arena.start_pos)
	weapon = WeaponSim.new(Rules.J1_WEAPON)
	director = RoundDirector.new()
	director.reset()
	zombies.clear()
	points = int(Config.at("player.startPoints"))
	kills = 0
	time = 0.0
	over = false
	playing = true
	_next_id = 1
	_trigger = false
	_fire_prev = false

func alive_count() -> int:
	var n := 0
	for z in zombies:
		if not z.dead:
			n += 1
	return n

## Un pas de simulation. input : { mx, mz, sprint, jump, fire (maintenu), reload (appui) } ; yaw et pitch sont lus sur player
## (posés par la visée, hors du pas fixe).
func step(dt: float, input: Dictionary) -> void:
	if not playing or over:
		return
	time += dt
	player.step(dt, time, input, arena.collision)
	_update_weapon(dt, input)
	# manches
	match director.step(dt, alive_count()):
		RoundDirector.SPAWN:
			_spawn_zombie()
		RoundDirector.ROUND_START:
			round_started.emit(director.round_number)
		RoundDirector.ROUND_END:
			round_ended.emit()
	# zombies
	for i in range(zombies.size() - 1, -1, -1):
		var z := zombies[i]
		var dealt := z.step(dt, player.pos, zombies, arena.collision)
		if dealt > 0.0:
			player_hurt.emit(dealt)
			if player.hurt(dealt, time):
				_end_game()
		if z.dead and z.death_t > Rules.CORPSE_TIME:
			zombies.remove_at(i)

func _end_game() -> void:
	over = true
	game_over.emit()

# ---------------------------------------------------------------- tir
func _update_weapon(dt: float, input: Dictionary) -> void:
	weapon.update(dt)
	var held := bool(input.get("fire", false))
	if held and not _fire_prev:
		_trigger = true
	if not held:
		_trigger = false
	_fire_prev = held
	if bool(input.get("reload", false)):
		weapon.start_reload()
	if not _trigger or weapon.reloading:
		return
	if weapon.ammo <= 0:
		weapon.start_reload()   # chargeur vide : recharge si la réserve le permet
		return
	if weapon.can_fire(time):
		_shoot()
		if String(weapon.cfg["type"]) == "semi":
			_trigger = false      # une balle par clic

func _shoot() -> void:
	var cfg := weapon.cfg
	weapon.consume(time)
	var mul := Rules.MOVING_SPREAD_MULT if player.moving else 1.0
	var spread := float(cfg["spread"]) * mul
	var tan_half := tan(deg_to_rad(Rules.FOV_DEG) / 2.0)
	var sx := (rng.randf() - 0.5) * 2.0 * spread * tan_half
	var sy := (rng.randf() - 0.5) * 2.0 * spread * tan_half
	var fwd := player.forward()
	var right := Vector3(cos(player.yaw), 0, -sin(player.yaw))
	var up := right.cross(fwd)
	var dir := (fwd + right * sx + up * sy).normalized()
	var origin := player.eye()
	var res := Hitscan.cast(origin, dir, float(cfg["range"]), zombies, arena.collision, int(cfg.get("pierce", 1)))
	var end: Vector3 = origin + dir * float(res["wall_t"])
	for h: Dictionary in res["hits"]:
		var dmg := float(cfg["damage"]) * Pap.falloff_mult(cfg, float(h["t"]))
		hit_zombie(h["z"], bool(h["head"]), dmg, float(cfg["headMult"]))
		end = origin + dir * float(h["t"])
	shot_fired.emit(origin, end)

## Dégâts sur un zombie + points (équivalent de game.hitZombie côté hôte).
func hit_zombie(z: ZombieSim, head: bool, dmg: float, head_mult: float) -> void:
	var killed := z.damage(dmg * (head_mult if head else 1.0), head)
	if killed:
		kills += 1
		points += Rules.POINTS_HEADSHOT if head else Rules.POINTS_KILL
		zombie_killed.emit(z, head)
	else:
		points += Rules.POINTS_HIT

# ---------------------------------------------------------------- apparitions
func _spawn_zombie() -> void:
	var best: Vector3 = arena.spawn_points[0]
	var best_d := -1.0
	for _i in 3:
		var sp: Vector3 = arena.spawn_points[rng.randi() % arena.spawn_points.size()]
		var d := sp.distance_to(player.pos)
		if d > best_d:
			best_d = d
			best = sp
	var Z: Dictionary = Config.at("zombie")
	var z := ZombieSim.new()
	z.id = _next_id
	z.rng = rng
	_next_id += 1
	z.pos = best + Vector3((rng.randf() - 0.5) * Rules.SPAWN_JITTER, 0, (rng.randf() - 0.5) * Rules.SPAWN_JITTER)
	z.health = director.zombie_health
	z.max_health = director.zombie_health
	var jitter: Array = Rules.SPAWN_SPEED_JITTER
	z.speed = director.zombie_speed * (float(jitter[0]) + rng.randf() * float(jitter[1]))
	if director.round_number >= int(Z["runnerRound"]) and rng.randf() < float(Z["runnerChance"]):
		z.speed *= float(Z["runnerMult"])
		z.runner = true
	z.yaw = atan2(player.pos.x - z.pos.x, player.pos.z - z.pos.z)
	zombies.append(z)
	zombie_spawned.emit(z)
