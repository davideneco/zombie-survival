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
signal explosion(pos: Vector3, radius: float, color: int)   ## J4 : effet d'une explosion (présentation)
signal weapon_acquired(id: String)                           ## J4 : arme achetée au mur
signal purchase_denied(price: int)                           ## J4 : pas assez de points
signal announced(title: String, sub: String)                 ## J5 : annonce à l'écran (véhicules, tram)
signal powerup_spawned(pu: Dictionary)                       ## J6 : un bonus apparaît au sol (présentation)
signal powerup_removed(pu: Dictionary)                       ## J6 : ramassé ou expiré
signal powerup_collected(type: String)                       ## J6 : "max_ammo", "insta_kill", "nuke", "double_points", "fuel"
signal perk_acquired(id: String)                             ## J6 : atout acheté
signal box_event(name: String, data: Dictionary)             ## J6 : boîte mystère : "roll", "teddy", "offer", "taken", "leaving", "arrived"
signal pap_event(name: String, data: Dictionary)             ## J6 : Pack-a-Punch : "start", "taken"
signal player_downed                                         ## J6 : à terre (Réanimation rapide)
signal player_revived
signal points_gained(amount: int, cls: String)               ## J7 : points gagnés (popup « +60 ») ; cls : "", "head", "bonus"
signal impact(pos: Vector3, flesh: bool, big: bool)             ## J9 : un tir touche une cible (flesh : zombie) ou un mur ; big : coup mortel au corps (sang abondant)
signal hit_confirmed(kill: bool)                             ## J7 : un tir du joueur touche un zombie (marqueur de touche)
signal weapon_event(name: String, data: Dictionary)           ## J8 : "reload" {id, cat, time}, "knife_swing", "knife_hit" {metal}, "empty" (clic à vide) : sons
signal boss_event(name: String, data: Dictionary)           ## J10 : évènement visible de la fin de partie (secousse, trait de charge, chaînes, couronne, trompette, aube…)
signal finale_sfx(name: String, vol: float)                  ## J10 : son de la fin de partie (cloche, grondement, bonus…)
signal victory_screen(title: String, text: String)           ## J10 : le Bourreau est tombé
signal liberated_screen(title: String, text: String)         ## J10 : « STRASBOURG LIBÉRÉE » (fin de la vue orbitale de l'Aube)
signal vaulted                                               ## J11 : le joueur enjambe un obstacle (son)
signal unstuck(from: Vector2, to: Vector2, distance: float, center: bool)   ## J11 : le joueur s'est débloqué
signal ride_event(name: String, data: Dictionary)            ## J5 : "mount", "dismount", "crash", "burn", "break", "respawn", "gong", "chime", "service", "knock", "cough", "beep", "dry"

var round_number: int:
	get: return director.round_number if director != null else 0
var points := 0
var kills := 0
var last_hit_head := false  ## J8 : le dernier coup porté par hit_zombie visait la tête (lu par les sons à réception de hit_confirmed)
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
var powerups: Powerups     ## J6 : bonus au sol et bonus actifs (Mort instantanée, Points doubles)
var machines: Machines     ## J6 : atouts, boîte mystère, Pack-a-Punch (null dans l'arène)
var rng_loot := RandomNumberGenerator.new()   ## J6 : tirages des bonus et de la boîte (séparé de `rng` : les apparitions restent reproductibles)
var rides: Rides           ## J5 : motos, vélos, tram (null dans l'arène)
var shake := 0.0           ## J5 : secousse de la caméra (chocs, explosions), décroît d'elle-même
var vehicles: Array[VehicleSim]:   ## les motos et vélos (pour les chocs entre machines)
	get: return rides.vehicles if rides != null else []
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
var finale: FinaleSim      ## J10 : fin de partie, Acte V, Maître Tanneur (null dans l'arène)
var finale_done := false   ## le Bourreau a été vaincu
var eternal := false       ## Nuit éternelle (après l'Aube) : +30 % de vie aux zombies dès la manche suivante
var blessed := false       ## Bénédiction de l'Aube : atouts gardés à terre
var free_doors := false    ## portes gratuites (Bénédiction)
var trophy := 0
var trophy_path := FinaleRules.TROPHY_PATH
var fanal_input := false   ## touche d'interaction maintenue (le Fanal)
var debug_open := false   ## J11 : le menu debug (F9) est ouvert (Échap le ferme avant d'ouvrir la pause)
var unstick: Unstick       ## J11 : « Se débloquer » (null dans l'arène)
var view_aspect := 16.0 / 9.0   ## J11 : rapport largeur / hauteur de la fenêtre (étalement des tirs en coordonnées d'écran), posé par main.gd
var settings: Settings     ## J7 : réglages du joueur et touches (user://settings.cfg, ou --settings=chemin)

func _init() -> void:
	var path := Settings.DEFAULT_PATH
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--settings="):
			path = a.substr(11)
	settings = Settings.new(path)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--trophy="):
			trophy_path = a.substr(9)
	for a in OS.get_cmdline_user_args():   # J9 : surcharges de captures et de mesures, jamais sauvegardées
		if a.begins_with("--quality="):
			settings.autosave = false
			settings.values["quality"] = clampi(int(a.substr(10)), 0, 2)
		elif a == "--no-cinema":
			settings.autosave = false
			settings.values["cinema"] = false
		elif a == "--no-halo":
			settings.autosave = false
			settings.values["halo"] = false

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
	_stop_flow_thread()
	if seed_value >= 0:
		rng.seed = seed_value
		rng_loot.seed = seed_value + Rules.LOOT_SEED_OFFSET
	else:
		rng.randomize()
		rng_loot.randomize()
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
	powerups = Powerups.new()
	machines = Machines.new(self, world.objects["machines"]) if world != null else null
	director = RoundDirector.new()
	director.reset()
	zombies.clear()
	shake = 0.0
	rides = Rides.new(self) if world != null else null
	unstick = Unstick.new() if world != null else null
	if unstick != null:
		unstick.done.connect(func(a: Vector2, b: Vector2, d: float, c: bool) -> void:
			announce("DÉBLOQUÉ", "Replacé dans l'allée de la rame" if rides != null and rides.on_tram != null else "Déplacé de %d m" % roundi(d))
			unstuck.emit(a, b, d, c))
	env = ZombieEnv.new()
	env.players = [player]
	env.zombies = zombies
	env.collision = collision
	env.nav = world.nav if world != null else null
	env.levels = world.levels if world != null and not world.levels.links.is_empty() else null
	env.rng = rng
	env.rides = rides
	finale = FinaleSim.new(self) if world != null else null
	finale_done = false
	eternal = false
	blessed = false
	free_doors = false
	fanal_input = false
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
	shake = maxf(0.0, shake - shake * dt * 3.0)
	var arms_input := input
	if rides != null:
		rides.step(dt, input)   # motos et rame d'abord, puis le joueur (il suit la selle, ou marche dans la rame)
		if rides.attached():
			arms_input = input.duplicate()
			arms_input["knife"] = false   # pas de couteau assis ou dans la rame ; le conducteur ne tire ni ne recharge
			if rides.driving():
				arms_input["fire"] = false
				arms_input["reload"] = false
				arms_input["aim"] = false
				arms_input["grenade"] = false
				arms_input["gl"] = false
	if finale != null:
		finale.step(dt)
		if finale.cam_lock:   # vue orbitale de l'Aube : le joueur est immobile
			input = {}
		fanal_input = bool(input.get("interact", false))
	player.locked = arms.locked
	player.step(dt, time, input, collision, world.levels if world != null else null, world)
	if player.vault_event:
		player.vault_event = false
		vaulted.emit()
	if not player.vault.is_empty():   # enjambement : ni tir, ni couteau, ni lance-grenades, plus de visée (player.js : startVault)
		arms_input = arms_input.duplicate()
		for k in ["fire", "knife", "gl", "aim"]:
			arms_input[k] = false
	arms.step(self, dt, arms_input)
	if unstick != null:
		unstick.step(self, dt, input)
	powerups.step(self, dt)
	if machines != null:
		machines.step(dt)
	# manches
	var round_ev := director.step(dt, alive_count()) if (finale == null or not finale.active()) else RoundDirector.NONE
	match round_ev:
		RoundDirector.SPAWN:
			_spawn_zombie()
		RoundDirector.ROUND_START:
			arms.on_round_start()
			if rides != null:
				rides.on_round_start()
			round_started.emit(director.round_number)
			if finale != null:
				finale.maybe_spawn_tanner()
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
			var shielded := rides != null and rides.tram_shield(z)   # une rame : la caisse encaisse (sauf devant une porte ouverte)
			if not shielded:
				player_hurt.emit(z.strike_damage)
				if z.strike_target.hurt(z.strike_damage, time):
					_end_game()
			if rides != null:
				rides.on_zombie_strike()   # le véhicule de la victime perd des PV
		if z.dead and z.death_t > Rules.CORPSE_TIME:
			zombies.remove_at(i)
	_relocate(dt)
	_player_events()

## Évènements du joueur posés par PlayerSim : à terre (les atouts sont perdus), relevé, onde du PHD Flopper, mort à terre.
func _player_events() -> void:
	if player.down_event:
		player.down_event = false
		if not blessed:   # à terre : on perd tous ses atouts (sauf sous la Bénédiction de l'Aube)
			arms.clear_perks()
			player.quick_revive = false
			player.stamin = false
			player.phd = false
			player.max_health = float(Config.at("player.maxHealth"))
			player.health = minf(player.health, player.max_health)
		announce("À TERRE !", "Réanimation rapide : vous vous relevez…")
		player_downed.emit()
	if player.revive_event:
		player.revive_event = false
		announce("RÉANIMÉ !", "Reprenez le combat !")
		player_revived.emit()
	if player.flop_request:
		player.flop_request = false
		flop(player.pos)
	if player.dead and not over:
		_end_game()

## Achat d'un atout : effet sur les armes (WeaponArms.perks) et sur le joueur (PlayerSim).
func add_perk(id: String) -> void:
	arms.add_perk(id)
	match id:
		"juggernog":
			player.max_health = Rules.PERK_JUGGERNOG_HEALTH
			player.health = player.max_health
		"quickrevive":
			player.quick_revive = true
		"staminup":
			player.stamin = true
		"phdflopper":
			player.phd = true
	perk_acquired.emit(id)

## PHD Flopper : onde explosive aux pieds du joueur à l'atterrissage (main.js flop) ; dégâts aux zombies seulement.
func flop(pos: Vector3) -> void:
	var F: Dictionary = Config.at("phd")
	arms.blast.splash(self, pos, float(F["radius"]), float(F["base"]) + float(F["perRound"]) * maxi(1, round_number), int(F["color"]))
	shake = maxf(shake, Rules.FLOP_SHAKE)

## Cible de type Bourreau / Ange (J10) : insensible à la Mort instantanée et à la Bombe.
func is_boss(z: ZombieSim) -> bool:
	return z.is_boss

## Un zombie vient de mourir sous un coup ou une explosion (bonus, essence).
func on_zombie_killed(z: ZombieSim) -> void:
	if finale != null:
		finale.on_kill(z)
	powerups.on_kill(self, z)

func _end_game() -> void:
	over = true
	game_over.emit()

# ---------------------------------------------------------------- tir : voir sim/weapon_arms.gd

## Dégâts sur un zombie + points (équivalent de game.hitZombie côté hôte).
## mel : coup de couteau (pas de bonus de tête, armure ignorée, points de CONFIG.knife.points).
func hit_zombie(z: ZombieSim, head: bool, dmg: float, head_mult: float, mel: bool = false, extra: Dictionary = {}) -> bool:
	var armor: Variant = z.get("armor")
	if powerups.insta_kill > 0.0 and not is_boss(z):
		dmg = 999999.0   # Mort instantanée
	var amount: float = dmg / (float(armor) if armor != null and float(armor) > 0.0 else 1.0) if mel else dmg * (head_mult if head else 1.0)
	if z.weak_mult > 0.0 and not mel:   # trompette de l'Ange : dégâts x weak quelle que soit l'arme (pas le bonus de tête de l'arme)
		amount = dmg * (z.weak_mult if head else 1.0)
	# Bourreau : face / dos / zone selon le coup (BossSim.damage) ; le Maître Tanneur et l'Ange prennent les dégâts d'un zombie
	var hit := {}
	if z.is_boss and not z.mini:
		hit = {"x": float(extra.get("ax", player.pos.x)), "z": float(extra.get("az", player.pos.z)), "ray": bool(extra.get("ray", false)), "mel": mel, "pid": -1}
		if extra.has("back"):
			hit["back"] = extra["back"]
		if extra.has("px"):
			hit["x"] = extra["px"]
			hit["z"] = extra["pz"]
	var killed := z.damage(amount, head, hit)
	var K: Dictionary = Config.at("knife.points")
	var mult := powerups.points_mult()   # Points doubles
	last_hit_head = head
	hit_confirmed.emit(killed)
	if killed:
		kills += 1
		var award := (int(K["kill"]) if mel else (Rules.POINTS_HEADSHOT if head else Rules.POINTS_KILL)) * mult
		points += award
		points_gained.emit(award, "head" if head else "")
		zombie_killed.emit(z, head)
		if z.explodes:
			_bloat_burst(z)
		on_zombie_killed(z)
	else:
		var award_hit := (int(K["hit"]) if mel else Rules.POINTS_HIT) * mult
		points += award_hit
		points_gained.emit(award_hit, "")
	return killed

## Dégâts reçus par le joueur hors coup de zombie (explosions). PHD Flopper : immunité aux explosions.
func hurt_player(amount: float, src: String = "") -> void:
	if over or player.dead or player.downed:
		return
	if (src == "blast" or src == "crash") and arms.perks.get("phdflopper", false):
		return
	player_hurt.emit(amount)
	if player.hurt(amount, time):
		_end_game()
	_player_events()

func next_zombie_id() -> int:
	var i := _next_id
	_next_id += 1
	return i

func add_zombie(z: ZombieSim) -> void:
	zombies.append(z)
	zombie_spawned.emit(z)

## Points pour tous les joueurs (récompenses de boss) : popup « bonus ».
func add_bonus_points(n: int) -> void:
	points += n
	points_gained.emit(n, "bonus")

func to_spawn_zero() -> void:
	director.to_spawn = 0

## Dégâts d'un boss, d'une explosion ou d'un projectile : src "blast" (le PHD Flopper l'ignore, projection), "chain" (attire de (kx, kz)),
## "fire", "toxic", "holy", "axe" (pas de projection), "" (coup du Bourreau : projection) — finale.js hurtPlayer.
func hurt_player_by(p: PlayerSim, dmg: float, kx: float, kz: float, src: String) -> void:
	if p != player:
		return
	var protected: bool = src == "blast" and bool(arms.perks.get("phdflopper", false))
	hurt_player(dmg, src)
	if over or player.dead or player.downed:
		return
	if src == "chain":
		player.pull_by(kx, kz)
	elif src != "fire" and src != "toxic" and src != "holy" and src != "axe" and not protected:
		player.vel.x += kx
		player.vel.z += kz
		player.vy = maxf(player.vy, 3.2)

## Touche d'interaction : borne ou arme murale d'abord (main.js : interact, 2 et 4), puis porte payante.
func interact() -> void:
	if over or not playing or player.downed:
		return
	if rides != null and rides.interact_leave():   # assis : E descend (main.js interact, 0)
		return
	if WeaponShop.interact(self):
		return
	if rides != null and rides.interact_use():   # borne du parking, sous-station, monter (4b, 4c, 5)
		return
	use_door()

## Annonce à l'écran (HUD).
func announce(title: String, sub := "") -> void:
	announced.emit(title, sub)

func damage_vehicle(v: Object, amt: float, src := "") -> void:
	if rides != null:
		rides.damage_vehicle(v, amt, src)

func hurt_occupants(v: Object, dmg: float) -> void:
	if rides != null:
		rides.hurt_occupants(v, dmg)

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

## Sources du champ de la carte : les joueurs, plus le gong du tram s'il sonne (main.js : world.lure).
func _targets_with_lure() -> Array:
	var t := field_targets(0)
	if rides != null and not rides.lure.is_empty():
		t.append(Vector3(rides.lure["x"], 0.0, rides.lure["z"]))
	return t

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
			nv.update_field_threaded(_targets_with_lure(), max_cost)
		else:
			nv.update_field(_targets_with_lure(), mini(int(F["budget"]), Rules.FLOW_BUDGET_MAX), max_cost)
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
		hurt_player(Rules.BLOAT_BLAST_DAMAGE * (1.0 - d / Rules.BLOAT_BLAST_FALLOFF), "blast")   # le PHD Flopper protège

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
	var price := 0 if free_doors else int(world.doors[id]["price"])
	if points < price:
		door_denied.emit(id)
		return -1
	points -= price
	world.open_door(id)
	door_opened.emit(id)
	powerups.opening_bonus(self, world.doors[id])
	return id
