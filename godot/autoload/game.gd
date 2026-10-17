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
signal zombie_event(z: ZombieSim, name: String)   ## "knock", "glass", "rumble", "emerge" (apparition)
signal bloat_burst(pos: Vector3)

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
var weapon: WeaponSim
var director: RoundDirector
var zombies: Array[ZombieSim] = []
var env: ZombieEnv         ## ce que voient les zombies (joueurs, collision, champ de flux, étages)
var flow_cool := 0.0       ## délai avant de relancer le champ de flux de la carte
var region_field_t := 0.0
var relocate_t := 0.0
var relocated := 0         ## zombies téléportés près des joueurs depuis le début de la partie (suivi des tests)
var flow_threaded := false ## champ de flux de la carte calculé sur un fil de travail (jeu) ; faux dans les tests (échange des tampons reproductible)
var flow_us := 0           ## microsecondes passées dans le champ de flux au dernier pas (banc d'essai)
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

## Nouvelle partie (graine fixe pour les tests reproductibles ; -1 : aléatoire). map : "strasbourg" (monde cuit), "arena" (arène de test de J1) ;
## "" prend CONFIG.map. Le monde cuit est relu à chaque partie (il porte l'état des portes) : compter ~1 s.
func new_game(seed_value: int = -1, map: String = "") -> void:
	_stop_flow_thread()
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
	weapon = WeaponSim.new(Rules.J1_WEAPON)
	director = RoundDirector.new()
	director.reset()
	zombies.clear()
	env = ZombieEnv.new()
	env.players = [player]
	env.zombies = zombies
	env.collision = collision
	env.nav = world.nav if world != null else null
	env.levels = world.levels if world != null and not world.levels.links.is_empty() else null
	env.rng = rng
	flow_cool = 0.0
	region_field_t = 0.0
	relocate_t = 0.0
	relocated = 0
	points = int(Config.at("player.startPoints"))
	kills = 0
	time = 0.0
	over = false
	playing = true
	_next_id = 1
	_trigger = false
	_fire_prev = false

func _stop_flow_thread() -> void:
	if env != null and env.nav != null:
		env.nav.finish_threaded()

func _exit_tree() -> void:
	_stop_flow_thread()

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
	_update_weapon(dt, input)
	# manches
	match director.step(dt, alive_count()):
		RoundDirector.SPAWN:
			_spawn_zombie()
		RoundDirector.ROUND_START:
			round_started.emit(director.round_number)
		RoundDirector.ROUND_END:
			round_ended.emit()
	# champ de flux, puis zombies
	env.time = time
	_update_levels()
	_update_fields(dt)
	for i in range(zombies.size() - 1, -1, -1):
		var z := zombies[i]
		z.step(dt, env)
		if not z.events.is_empty():
			for e in z.events:
				zombie_event.emit(z, e)
			z.events.clear()
		if z.strike_damage > 0.0:
			player_hurt.emit(z.strike_damage)
			if z.strike_target.hurt(z.strike_damage, time):
				_end_game()
		if z.dead and z.death_t > Rules.CORPSE_TIME:
			zombies.remove_at(i)
	_relocate(dt)

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
	var res := Hitscan.cast(origin, dir, float(cfg["range"]), zombies, collision, int(cfg.get("pierce", 1)))
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
		if z.explodes:
			_bloat_burst(z)
	else:
		points += Rules.POINTS_HIT

# ---------------------------------------------------------------- champ de flux et étages
## Étage « utile » du joueur (main.js updateLevels).
func _update_levels() -> void:
	if env.levels == null:
		return
	player.tregion = env.levels.end_region(player.region, player.pos.x, player.pos.z, player.pos.y)

## Sources du champ de flux d'un étage : les joueurs qui y sont, et le pied de l'escalier qui mène aux autres (main.js fieldTargets).
func field_targets(region: int) -> Array:
	var out: Array = []
	var lv := env.levels
	for pl in env.players:
		if pl.dead:
			continue
		if lv == null or pl.tregion == region:
			out.append(pl.pos)
			continue
		var hop := lv.next_hop(region, pl.tregion)
		if hop.is_empty():
			continue
		var path: Array = hop["link"]["path"]
		var e: Array = path[0] if int(hop["dir"]) > 0 else path[path.size() - 1]
		out.append(Vector3(e[0], 0.0, e[2]))
	return out

## Champ de la carte (incrémental, borné autour des joueurs : CONFIG.zombie.flow) et champs des étages où se trouvent des zombies.
func _update_fields(dt: float) -> void:
	if env.nav == null or player.dead:
		return
	var t0 := Time.get_ticks_usec()
	var F: Dictionary = Config.at("zombie.flow")
	var nv := env.nav
	flow_cool -= dt
	if nv.job_active or flow_cool <= 0.0:
		var max_cost := roundi(float(F["range"]) / nv.cell * 10.0)
		if flow_threaded:
			nv.update_field_threaded(field_targets(0), max_cost)
		else:
			nv.update_field(field_targets(0), mini(int(F["budget"]), Rules.FLOW_BUDGET_MAX), max_cost)
		if not nv.job_active:
			flow_cool = float(F["interval"])
	if env.levels != null:
		region_field_t -= dt
		if region_field_t <= 0.0:
			region_field_t = Rules.REGION_FIELD_PERIOD
			var used := {}
			for z in zombies:
				if not z.dead and z.region != 0:
					used[z.region] = true
			for r: int in used:
				var rn: NavGrid = env.levels.nav_of(r)
				if rn == null:
					continue
				var t := field_targets(r)
				if not t.is_empty():
					rn.compute_field(t)
	flow_us = Time.get_ticks_usec() - t0

## Zombies coincés dans le décor ou partis trop loin : ils réapparaissent près du joueur (main.js relocateZombies).
## force : menu debug (U), sans attendre et avec des seuils plus bas ; renvoie le nombre de zombies déplacés.
func _relocate(dt: float, force := false) -> int:
	if world == null:
		return 0
	if not force:
		relocate_t -= dt
		if relocate_t > 0.0:
			return 0
		relocate_t = Rules.RELOCATE_INTERVAL
	if player.dead or player.tregion != 0:
		return 0
	var moved := 0
	for z in zombies:
		if z.dead or z.spawn_t > 0.0 or z.region != 0 or not z.link.is_empty():
			continue
		var near := Vector2(player.pos.x - z.pos.x, player.pos.z - z.pos.z).length()
		if not force:
			z.far_t = z.far_t + 1.0 if near > Rules.RELOCATE_FAR else 0.0
		var stuck := z.no_progress > (1.5 if force else Rules.RELOCATE_STUCK) and near > (5.0 if force else Rules.RELOCATE_STUCK_NEAR)
		if not stuck and not (force and near > 70.0) and (force or z.far_t < Rules.RELOCATE_FAR_COUNT):
			continue
		var g := world.pick_ground(player.pos.x, player.pos.z, Rules.RELOCATE_MIN, Rules.RELOCATE_MAX, rng)
		if g == Vector3.INF:
			continue
		z.pos = Vector3(g.x, 0.0, g.z)
		z.no_progress = 0.0
		z.far_t = 0.0
		moved += 1
	relocated += moved
	return moved

## Le pestiféré explose à sa mort (finale.js onFinaleKill) : 38 x (1 - d / 5) à moins de 4,2 m du joueur (et 2,5 m de hauteur).
func _bloat_burst(z: ZombieSim) -> void:
	bloat_burst.emit(z.pos)
	if player.dead:
		return
	var d := Vector2(player.pos.x - z.pos.x, player.pos.z - z.pos.z).length()
	if d < Rules.BLOAT_BLAST_RADIUS and absf(player.pos.y - z.pos.y) < Rules.BLOAT_BLAST_HEIGHT:
		player_hurt.emit(Rules.BLOAT_BLAST_DAMAGE * (1.0 - d / Rules.BLOAT_BLAST_FALLOFF))
		if player.hurt(Rules.BLOAT_BLAST_DAMAGE * (1.0 - d / Rules.BLOAT_BLAST_FALLOFF), time):
			_end_game()

# ---------------------------------------------------------------- apparitions
## Joueur autour duquel apparaît le prochain zombie : poids 1 / (1 + n), n = zombies vivants à moins de spawnBalance.radius m de lui
## (main.js spawnTarget ; utile dès qu'il y a plusieurs joueurs).
func spawn_target(pool: Array[PlayerSim]) -> PlayerSim:
	if pool.size() < 2:
		return pool[0]
	var wts := spawn_weights(pool)
	var total := 0.0
	for w in wts:
		total += w
	var t := rng.randf() * total
	for i in pool.size():
		t -= wts[i]
		if t <= 0.0:
			return pool[i]
	return pool[-1]

## Poids de tirage de chaque joueur : 1 / (1 + n), n = zombies vivants à moins de spawnBalance.radius m de lui.
func spawn_weights(pool: Array[PlayerSim]) -> Array[float]:
	var R := float(Config.at("zombie.spawnBalance.radius"))
	var wts: Array[float] = []
	for pl in pool:
		var n := 0
		for z in zombies:
			if not z.dead and Vector2(z.pos.x - pl.pos.x, z.pos.z - pl.pos.z).length() < R:
				n += 1
		wts.append(1.0 / (1.0 + n))
	return wts

## Où apparaît le prochain zombie (main.js pickSpawn) : { type: "window", index } ou { type: "ground", pos }.
func _pick_spawn() -> Dictionary:
	if world != null:
		var alive: Array[PlayerSim] = []
		for pl in env.players:
			if not pl.dead:
				alive.append(pl)
		var pool: Array[PlayerSim] = alive if not alive.is_empty() else env.players
		var pp := spawn_target(pool).pos
		if rng.randf() < Rules.WINDOW_CHANCE:
			var wi := world.pick_window(pp.x, pp.z, Rules.WORLD_SPAWN_MIN, Rules.WORLD_SPAWN_MAX, time, rng)
			if wi >= 0:
				world.window_busy[wi] = time + Rules.WINDOW_BUSY
				return {"type": "window", "index": wi}
		var g := world.pick_ground(pp.x, pp.z, Rules.GROUND_MIN, Rules.GROUND_MAX, rng)
		if g != Vector3.INF:
			return {"type": "ground", "pos": g}
		var wi2 := world.pick_window(pp.x, pp.z, Rules.WORLD_SPAWN_MIN2, Rules.WORLD_SPAWN_MAX2, time, rng)
		if wi2 >= 0:
			world.window_busy[wi2] = time + Rules.WINDOW_BUSY
			return {"type": "window", "index": wi2}
		return {"type": "ground", "pos": Vector3(pp.x + Rules.WORLD_SPAWN_FALLBACK, 0.0, pp.z)}
	var best: Vector3 = arena.spawn_points[0]
	var best_d := -1.0
	for _i in 3:
		var sp: Vector3 = arena.spawn_points[rng.randi() % arena.spawn_points.size()]
		var d := sp.distance_to(player.pos)
		if d > best_d:
			best_d = d
			best = sp
	return {"type": "arena", "pos": best + Vector3((rng.randf() - 0.5) * Rules.SPAWN_JITTER, 0, (rng.randf() - 0.5) * Rules.SPAWN_JITTER)}

func _count_kind(k: String) -> int:
	var n := 0
	for q in zombies:
		if q.kind == k and not q.dead:
			n += 1
	return n

func _spawn_zombie() -> void:
	var sp := _pick_spawn()
	var Z: Dictionary = Config.at("zombie")
	var z := ZombieSim.new()
	z.id = _next_id
	z.rng = rng
	_next_id += 1
	var sx := 0.0
	var sz := 0.0
	if sp["type"] == "window":
		var o := world.window_outside(int(sp["index"]))
		sx = o.x
		sz = o.z
	else:
		sx = sp["pos"].x
		sz = sp["pos"].z
	var r := director.round_number
	# chevalier de fer (zone de l'Homme de Fer) et pestiféré (zones listées) : tirés ici, l'hôte décide
	var knight := false
	var pest := false
	if world != null:
		var zname := ""
		var zi := world.zone_of(sx, sz)
		if zi >= 0:
			zname = world.zone_names[zi]
		var IK: Dictionary = Z["ironKnight"]
		knight = r >= int(IK["fromRound"]) and zname == String(IK["zone"]) and _count_kind("armored") < int(IK["maxAlive"]) and rng.randf() < float(IK["chance"])
		var PE: Dictionary = Z["pestilent"]
		pest = not knight and r >= int(PE["fromRound"]) and (PE["zones"] as Array).has(zname) and _count_kind("bloat") < int(PE["maxAlive"]) and rng.randf() < float(PE["chance"])
	var jitter: Array = Rules.SPAWN_SPEED_JITTER
	var spd := director.zombie_speed * (float(jitter[0]) + rng.randf() * float(jitter[1]))
	if not knight and not pest and r >= int(Z["runnerRound"]) and rng.randf() < float(Z["runnerChance"]):
		spd *= float(Z["runnerMult"])
	var crawl := not knight and not pest and r >= int(Z["crawlerRound"]) and rng.randf() < float(Z["crawlerChance"])
	var hp := director.zombie_health
	if knight:
		hp = float(Pap.js_round(director.zombie_health * float(Z["ironKnight"]["healthMult"])))
	elif pest:
		hp = float(Pap.js_round(director.zombie_health * float(Z["pestilent"]["healthMult"])))
	z.health = hp
	z.max_health = hp
	z.speed = spd
	z.init_traits(rng)
	if crawl:
		z.make_crawler()
	if knight:
		z.make_kind("armored")
	elif pest:
		z.make_kind("bloat")
	match String(sp["type"]):
		"window":
			var wi := int(sp["index"])
			var o := world.window_outside(wi)
			var n := world.window_normal(wi)
			var ins := world.window_inside(wi)
			z.start_window_spawn(ins, o, world.window_center(wi), n, atan2(n.x, n.y), wi)
		"ground":
			z.start_ground_spawn(sp["pos"], rng.randf() * TAU)
		_:   # arène de J1 : sortie instantanée
			z.pos = sp["pos"]
			z.yaw = atan2(player.pos.x - z.pos.x, player.pos.z - z.pos.z)
	zombies.append(z)
	zombie_spawned.emit(z)

## Pose un zombie à la main (démonstration, captures, tests) : sorti, à la vitesse donnée ; kind "", "armored" ou "bloat".
func debug_spawn(p: Vector3, spd: float, crawl := false, kind := "") -> ZombieSim:
	var z := ZombieSim.new()
	z.id = _next_id
	_next_id += 1
	z.rng = rng
	z.pos = p
	z.speed = spd
	z.health = maxf(director.zombie_health, 70.0)
	z.max_health = z.health
	z.init_traits(rng)
	if crawl:
		z.make_crawler()
	if kind != "":
		z.make_kind(kind)
	z.yaw = atan2(player.pos.x - p.x, player.pos.z - p.z)
	zombies.append(z)
	zombie_spawned.emit(z)
	return z

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
