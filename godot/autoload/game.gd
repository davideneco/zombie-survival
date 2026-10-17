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
signal door_opened(id: int)
signal door_denied(id: int)
signal explosion(pos: Vector3, radius: float, color: int)   ## J4 : effet d'une explosion (présentation)
signal weapon_acquired(id: String)                           ## J4 : arme achetée au mur
signal purchase_denied(price: int)                           ## J4 : pas assez de points

var round_number: int:
	get: return director.round_number if director != null else 0
var points := 0
var kills := 0
var time := 0.0
var playing := false
var over := false

var arena: Arena           ## arène de test (map "arena") ; null sur la carte de Strasbourg
var world: World           ## carte de Strasbourg (map "strasbourg") ; null dans l'arène
var collision: Collision   ## collision de la carte courante
var map_name := ""
var player: PlayerSim
var arms: WeaponArms       ## J4 : inventaire, tir, couteau, grenades (voir sim/weapon_arms.gd)
var weapon: WeaponSim:     ## arme en main (compatibilité J1)
	get: return arms.current
var director: RoundDirector
var zombies: Array[ZombieSim] = []
var rng := RandomNumberGenerator.new()
var _next_id := 1

func version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0.0.0"))

## Santé d'un zombie ordinaire à la manche r (courbe de CONFIG.zombie.health ; équivalent de game.zombieHealthAt).
func zombie_health_at(r: int) -> int:
	var h: Dictionary = Config.at("zombie.health")
	if r < int(h["softRound"]):
		return int(h["base"] + r * h["perRound"])
	return int(floor(h["hardBase"] * pow(h["hardGrowth"], r - h["softRound"] + 1) + 0.5))

## Nouvelle partie (graine fixe pour les tests reproductibles ; -1 : aléatoire). map : "strasbourg" (monde cuit), "arena" (arène de test de J1) ;
## "" prend CONFIG.map. Le monde cuit est relu à chaque partie (il porte l'état des portes) : compter ~1 s.
## weapons : armes de départ (vide : le M1911 de J1 ; la scène principale passe CONFIG.startWeapons).
func new_game(seed_value: int = -1, map: String = "", weapons: Array = []) -> void:
	if seed_value >= 0:
		rng.seed = seed_value
	else:
		rng.randomize()
	map_name = map if map != "" else String(Config.at("map", "strasbourg"))
	if map_name == "arena":
		arena = Arena.load_arena()
		world = null
		collision = arena.collision
	else:
		world = World.load_world()
		arena = null
		collision = world.collision
	player = PlayerSim.new()
	player.reset(arena.start_pos if arena != null else world.start_pos)
	arms = WeaponArms.new(weapons if not weapons.is_empty() else [Rules.J1_WEAPON])
	director = RoundDirector.new()
	director.reset()
	zombies.clear()
	points = int(Config.at("player.startPoints"))
	kills = 0
	time = 0.0
	over = false
	playing = true
	_next_id = 1

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
	player.step(dt, time, input, collision, world.levels if world != null else null)
	arms.step(self, dt, input)
	# manches
	match director.step(dt, alive_count()):
		RoundDirector.SPAWN:
			_spawn_zombie()
		RoundDirector.ROUND_START:
			arms.on_round_start()
			round_started.emit(director.round_number)
		RoundDirector.ROUND_END:
			round_ended.emit()
	# zombies
	for i in range(zombies.size() - 1, -1, -1):
		var z := zombies[i]
		var dealt := z.step(dt, player.pos, zombies, collision)
		if dealt > 0.0:
			player_hurt.emit(dealt)
			if player.hurt(dealt, time):
				_end_game()
		if z.dead and z.death_t > Rules.CORPSE_TIME:
			zombies.remove_at(i)

func _end_game() -> void:
	over = true
	game_over.emit()

# ---------------------------------------------------------------- tir : voir sim/weapon_arms.gd

## Dégâts sur un zombie + points (équivalent de game.hitZombie côté hôte).
## mel : coup de couteau (pas de bonus de tête, armure ignorée, points de CONFIG.knife.points).
func hit_zombie(z: ZombieSim, head: bool, dmg: float, head_mult: float, mel: bool = false) -> void:
	var armor: Variant = z.get("armor")
	var amount: float = dmg / (float(armor) if armor != null and float(armor) > 0.0 else 1.0) if mel else dmg * (head_mult if head else 1.0)
	var killed := z.damage(amount, head)
	var K: Dictionary = Config.at("knife.points")
	if killed:
		kills += 1
		points += int(K["kill"]) if mel else (Rules.POINTS_HEADSHOT if head else Rules.POINTS_KILL)
		zombie_killed.emit(z, head)
	else:
		points += int(K["hit"]) if mel else Rules.POINTS_HIT

## Dégâts reçus par le joueur hors coup de zombie (explosions). PHD Flopper : immunité aux explosions.
func hurt_player(amount: float, src: String = "") -> void:
	if over or player.dead:
		return
	if (src == "blast" or src == "crash") and arms.perks.get("phdflopper", false):
		return
	player_hurt.emit(amount)
	if player.hurt(amount, time):
		_end_game()

## Touche d'interaction : borne ou arme murale d'abord (main.js : interact, 2 et 4), puis porte payante.
func interact() -> void:
	if over or not playing:
		return
	if WeaponShop.interact(self):
		return
	use_door()

# ---------------------------------------------------------------- apparitions
func _spawn_point() -> Vector3:
	if world != null:
		# fenêtre libre d'une zone ouverte (J3 apportera l'apparition au sol et le champ de flux)
		for r: Array in [[Rules.WORLD_SPAWN_MIN, Rules.WORLD_SPAWN_MAX], [Rules.WORLD_SPAWN_MIN2, Rules.WORLD_SPAWN_MAX2]]:
			var wi := world.pick_window(player.pos.x, player.pos.z, r[0], r[1], time, rng)
			if wi >= 0:
				world.window_busy[wi] = time + Rules.WINDOW_BUSY
				return world.window_outside(wi)
		return player.pos + Vector3(Rules.WORLD_SPAWN_FALLBACK, 0, 0)
	var best: Vector3 = arena.spawn_points[0]
	var best_d := -1.0
	for _i in 3:
		var sp: Vector3 = arena.spawn_points[rng.randi() % arena.spawn_points.size()]
		var d := sp.distance_to(player.pos)
		if d > best_d:
			best_d = d
			best = sp
	return best

func _spawn_zombie() -> void:
	var best := _spawn_point()
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

# ---------------------------------------------------------------- portes payantes (carte de Strasbourg)
## Touche d'interaction : achète la porte à portée si les points suffisent (main.js : interact, 6) ; renvoie l'indice ouvert, -1 sinon.
func use_door() -> int:
	if world == null or over:
		return -1
	var id := world.near_door(player.pos)
	if id < 0:
		return -1
	var price := int(world.doors[id]["price"])
	if points < price:
		door_denied.emit(id)
		return -1
	points -= price
	world.open_door(id)
	door_opened.emit(id)
	return id
