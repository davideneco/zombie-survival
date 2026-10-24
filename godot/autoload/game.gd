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
signal perk_event(name: String, data: Dictionary)            ## v0.27.0 : nouveaux atouts : "cherry", "web", "wish", "crit", "vulture_drop", "vulture_pick", "tomb", "tomb_pick", "tomb_gone"
signal mode_event(name: String, data: Dictionary)            ## v0.33.0 : Contre la montre / Arsenal aléatoire : "time_bonus" {seconds, head, round}, "time_up", "arsenal_weapon" {id, name, round}
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
var foot_cam := RideCam.new()   ## v0.25.1 : caméra de la vue à la troisième personne à pied dans l'arène (sur la carte de Strasbourg : rides.cam)
var shake := 0.0           ## J5 : secousse de la caméra (chocs, explosions), décroît d'elle-même
var vehicles: Array[VehicleSim]:   ## les motos et vélos (pour les chocs entre machines)
	get: return rides.vehicles if rides != null else []
var zombies: Array[ZombieSim] = []
var env: ZombieEnv         ## ce que voient les zombies (joueurs, collision, champ de flux, étages)
var flow_cool := 0.0       ## délai avant de relancer le champ de flux de la carte
var region_field_t := 0.0
var relocate_t := 0.0
var relocated := 0         ## zombies relancés (réapparus par une fenêtre ou depuis le sol, v0.34.11) depuis le début de la partie (suivi des tests)
var spawn_calm_until := 0.0   ## v0.34.11 : pas d'apparition avant ce temps de jeu (achat d'une porte : Rules.DOOR_CALM)
var _spawn_wait_since := -1.0 ## v0.34.11 : temps de jeu de la première apparition remise faute de place cachée (-1 : aucune)
var spawns_postponed := 0     ## apparitions remises (suivi des tests)
var spawns_relaxed := 0       ## apparitions de repli, peut-être en vue (toujours animées) après SPAWN_RELAX_AFTER s sans place cachée
var flow_threaded := false ## champ de flux de la carte calculé sur un fil de travail (jeu) ; faux dans les tests (échange des tampons reproductible)
var flow_us := 0           ## microsecondes passées dans le champ de flux au dernier pas (banc d'essai)
var rng := RandomNumberGenerator.new()
var _next_id := 1
var finale: FinaleSim      ## J10 : fin de partie, Acte V, Maître Tanneur (null dans l'arène)
var daynight := DayNight.new()   ## v0.25.0 : heure du jeu, ciel, lampadaires (sim/day_night.gd) ; en tests : la nuit d'avant, rien ne change
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
var difficulty := "normal"   ## v0.14.0 : "easy" | "normal" | "hard" (Difficulty) ; lue par RoundDirector.start_round, posée avant new_game
var stats: GameStats       ## v0.14.0 : statistiques de parties (user://stats.json, ou --stats=chemin)
var mode := GameMode.CLASSIC   ## v0.26.0 : mode de jeu (GameMode) ; posé avant new_game, comme la difficulté
var zone_pick := 0             ## v0.26.0 : zone choisie pour le mode Zone unique (indice des zones de la carte)
var gm: GameMode           ## mode de la partie en cours : null en Classique (et dans l'arène)
var escaped := false       ## Zone unique : la porte de sortie a été achetée (fin de partie en victoire)
var timed: TimedMode       ## v0.33.0 : mode Contre la montre (chrono) ; null sinon
var arsenal: ArsenalMode   ## v0.33.0 : mode Arsenal aléatoire (arme imposée par manche) ; null sinon
var time_up := false       ## Contre la montre : le chrono est arrivé à 0 (fin de partie « TEMPS ÉCOULÉ »)
var pfx := PerkFx.new()    ## v0.27.0 : nouveaux atouts (sim/perk_fx.gd) : recharges, gouttes, tombe, Bastion
var points_earned := 0     ## v0.26.0 : total des points gagnés (somme des points_gained), dépenses non déduites : score du mode Zone unique
var settings: Settings     ## J7 : réglages du joueur et touches (user://settings.cfg, ou --settings=chemin)
var watch := ZombieWatch.new()   ## v0.34.10 : zombies immobiles, téléportations, apparitions (sim/zombie_watch.gd ; journal : --zombie-stuck-log[=chemin])

func _init() -> void:
	StartupLog.mark("autoload Game: start")
	var path := Settings.DEFAULT_PATH
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--settings="):
			path = a.substr(11)
	settings = Settings.new(path)
	if OS.has_feature("windows") and not FileAccess.file_exists(path):
		# Port Windows : premier lancement sur une puce graphique intégrée (ou un rendu logiciel) -> qualité « Rapide ». Pas de sauvegarde ici :
		# le joueur garde la main dans Options, et le réglage n'est écrit qu'à sa première modification.
		var gpu := RenderingServer.get_video_adapter_type()
		if gpu == RenderingDevice.DEVICE_TYPE_INTEGRATED_GPU or gpu == RenderingDevice.DEVICE_TYPE_CPU:
			settings.values["quality"] = 0
			settings.apply_scale_preset(0, false)
	var stats_path := GameStats.DEFAULT_PATH
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--stats="):
			stats_path = a.substr(8)
	stats = GameStats.new(stats_path)
	points_gained.connect(func(n: int, _c: String) -> void: points_earned += n)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--trophy="):
			trophy_path = a.substr(9)
	StartupLog.mark("autoload Game: settings and stats read")
	watch.setup(OS.get_cmdline_user_args(), "")
	for a in OS.get_cmdline_user_args():   # J9 : surcharges de captures et de mesures, jamais sauvegardées
		if a.begins_with("--quality="):
			settings.autosave = false
			settings.values["quality"] = clampi(int(a.substr(10)), 0, 2)
			settings.apply_scale_preset(int(settings.values["quality"]), false)
		elif a.begins_with("--upscaler="):   # v0.19.1 : 0 natif, 1 FSR 1.0, 2 FSR 2.2 (captures, mesures)
			settings.autosave = false
			settings.values["upscaler"] = clampi(int(a.substr(11)), 0, 2)
		elif a.begins_with("--res-scale="):   # indice 0..4 dans Settings.RES_SCALES
			settings.autosave = false
			settings.values["res_scale"] = clampi(int(a.substr(12)), 0, 4)
		elif a.begins_with("--sharp="):
			settings.autosave = false
			settings.values["sharp"] = clampf(float(a.substr(8)), 0.0, 1.0)
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
func new_game(seed_value: int = -1, map: String = "", weapons: Array = [], preloaded: Object = null) -> void:
	_stop_flow_thread()
	if seed_value >= 0:
		rng.seed = seed_value
		rng_loot.seed = seed_value + Rules.LOOT_SEED_OFFSET
	else:
		rng.randomize()
		rng_loot.randomize()
	map_name = map if map != "" else String(Config.at("map", "strasbourg"))
	if map_name == "arena":
		arena = preloaded if preloaded is Arena else Arena.load_arena()
		world = null
		collision = arena.collision
	else:
		if map_name == "alpine":   # v0.34.0 : Station des Aiguilles (sim/alpine_map.gd)
			world = preloaded if preloaded is World and (preloaded as World).map_id == "alpine" else AlpineMap.load_map()
		else:
			world = preloaded if preloaded is World else World.load_world()   # preloaded : chargé sur un fil de travail pendant l'écran de chargement
		arena = null
		collision = world.collision
	gm = null
	if world != null and world.map_id == "strasbourg" and GameMode.valid(mode) == GameMode.ZONE:   # v0.26.0 : Zone unique (portes murées, sortie, machines de base)
		gm = GameMode.new(GameMode.ZONE, zone_pick)
		if not gm.setup(world):
			push_warning("Zone unique : zone %d invalide, partie classique" % zone_pick)
			gm = null
	player = PlayerSim.new()
	foot_cam = RideCam.new()
	player.reset(arena.start_pos if arena != null else (gm.start if gm != null else world.start_pos))
	if gm != null:
		player.yaw = gm.start_yaw
	arms = WeaponArms.new(weapons if not weapons.is_empty() else [Rules.J1_WEAPON])
	powerups = Powerups.new()
	pfx = PerkFx.new(seed_value if seed_value >= 0 else rng.seed)
	timed = null
	arsenal = null
	time_up = false
	if world != null and gm == null:   # v0.33.0 : Contre la montre, Arsenal aléatoire : toute la carte, sans finale
		match GameMode.valid(mode):
			GameMode.TIMED:
				timed = TimedMode.new()
			GameMode.ARSENAL:
				arsenal = ArsenalMode.new(seed_value if seed_value >= 0 else int(rng.seed))
	if gm != null:
		machines = Machines.new(self, gm.filter_machines(world.objects["machines"]), gm.zone)
		machines.box.stay_alone = true
		for e: Dictionary in gm.collision_boxes():
			collision.set_dynamic(e["key"], [e["box"]])
	elif timed != null or arsenal != null:
		machines = Machines.new(self, GameMode.without_finale(world.objects["machines"]))
	else:
		machines = Machines.new(self, world.objects["machines"]) if world != null else null
	if arsenal != null:   # l'arme de la manche 1 remplace les armes de départ
		arsenal.roll(arms, 1)
	director = RoundDirector.new()
	director.reset()
	zombies.clear()
	shake = 0.0
	rides = (Rides.new(self, AlpineMap.rides_data()) if world.map_id == "alpine" else Rides.new(self)) if world != null else null
	if rides != null and world.map_id == "alpine":
		AlpineMap.dress_vehicles(rides)
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
	if world != null:
		world.nav.warm_components()   # composantes connexes (« se débloquer ») calculées en arrière-plan, pas au premier contrôle de poche
	env.levels = world.levels if world != null and not world.levels.links.is_empty() else null
	env.rng = rng
	env.rides = rides
	finale = (AlpineFinale.new(self) if world.map_id == "alpine" else FinaleSim.new(self)) if world != null else null
	finale_done = false
	eternal = false
	daynight = DayNight.new()
	blessed = false
	free_doors = false
	fanal_input = false
	flow_cool = 0.0
	region_field_t = 0.0
	relocate_t = 0.0
	relocated = 0
	spawn_calm_until = 0.0
	_spawn_wait_since = -1.0
	spawns_postponed = 0
	spawns_relaxed = 0
	points = int(Config.at("player.startPoints"))
	points_earned = 0
	escaped = false
	kills = 0
	time = 0.0
	over = false
	playing = true
	_next_id = 1
	watch.reset(map_name)
	watch.write({"ev": "game", "map": map_name, "mode": mode_id(), "difficulty": difficulty, "seed": rng.seed})

## Libère la partie (retour au menu principal) : plus de monde, de joueur ni de zombies en mémoire ; l'état est celui d'avant la première partie.
func unload() -> void:
	_stop_flow_thread()
	zombies.clear()
	arena = null
	world = null
	collision = null
	player = null
	arms = null
	powerups = null
	machines = null
	director = null
	rides = null
	unstick = null
	env = null
	finale = null
	gm = null
	escaped = false
	timed = null
	arsenal = null
	time_up = false
	pfx.reset()
	playing = false
	over = false
	debug_open = false
	points = 0
	kills = 0
	time = 0.0

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

## Ciel de la finale quand elle le dessine (Acte V en cours, aube, jour, crépuscule : sky_k), sinon -1 : le cycle jour / nuit reprend la main.
func finale_sky() -> float:
	if finale != null and (finale.active() or finale.sky_phase != "night" or finale.sky_k > 0.0):
		return finale.sky_k
	return -1.0

## La caméra à la troisième personne : celle des machines (rides.cam) sur la carte de Strasbourg, `foot_cam` dans l'arène.
func view_cam() -> RideCam:
	return rides.cam if rides != null else foot_cam

## Réglage « Vue » = 3e personne, hors rame (on y reste à la première personne).
func foot_third_wanted() -> bool:
	return settings != null and int(settings.get_value("view")) == 1 and not (rides != null and rides.on_tram != null)

## Un pas de simulation. input : { mx, mz, sprint, jump, fire (maintenu), reload (appui) } ; yaw et pitch sont lus sur player
## (posés par la visée, hors du pas fixe).
func step(dt: float, input: Dictionary) -> void:
	if not playing or over:
		return
	time += dt
	shake = maxf(0.0, shake - shake * dt * 3.0)
	var arms_input := input
	var foot_tp := foot_third_wanted()
	if rides != null:
		rides.cam.foot_third = foot_tp
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
	else:   # arène : pas de machines, la caméra à pied est la nôtre
		foot_cam.foot_third = foot_tp
		foot_cam.update(dt, null, player.pos + Vector3(0, float(Config.at("player.eye")), 0), player, bool(input.get("aim", false)), self)
		player.eye_override = foot_cam.cam_pos if foot_cam.placed else Vector3.INF
	var vc := view_cam()
	player.eye_ext = vc.dist if vc.external() else 0.0
	if finale != null:
		finale.step(dt)
		if finale.cam_lock:   # vue orbitale de l'Aube : le joueur est immobile
			input = {}
		fanal_input = bool(input.get("interact", false))
	daynight.update(dt, finale_sky(), eternal)
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
	pfx.step(self, dt)
	if machines != null:
		machines.step(dt)
	# manches
	var round_ev := director.step(dt, alive_count()) if (finale == null or not finale.active()) else RoundDirector.NONE
	match round_ev:
		RoundDirector.SPAWN:
			_spawn_zombie()
		RoundDirector.ROUND_START:
			arms.on_round_start()
			if arsenal != null:   # v0.33.0 : nouvelle arme imposée
				_arsenal_roll()
			if rides != null:
				rides.on_round_start()
			round_started.emit(director.round_number)
			if finale != null:
				finale.maybe_spawn_tanner()
		RoundDirector.ROUND_END:
			round_ended.emit()
			if timed != null:   # v0.33.0 : manche finie : secondes rendues au chrono
				var sec := timed.on_round_end()
				if sec > 0.0:
					mode_event.emit("time_bonus", {"seconds": sec, "head": false, "round": true})
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
				var dmg := pfx.filter_damage(self, z.strike_damage) if z.strike_target == player else z.strike_damage   # v0.27.0 : Bastion, Ultime Volonté
				if dmg > 0.0:
					player_hurt.emit(dmg)
					if z.strike_target.hurt(dmg, time):
						_end_game()
				if z.strike_target == player:
					pfx.on_struck(self)   # Veuve noire
			if rides != null:
				rides.on_zombie_strike()   # le véhicule de la victime perd des PV
		if z.dead and z.death_t > Rules.CORPSE_TIME:
			zombies.remove_at(i)
	_relocate(dt)
	watch.step(self, dt)
	_player_events()
	if arsenal != null and arsenal.pending:   # arme rendue par le Pack-a-Punch : le changement d'arme en attente s'applique
		_arsenal_roll()
	if timed != null and not over and timed.step(dt):   # v0.33.0 : chrono à 0 : fin de partie
		time_up = true
		mode_event.emit("time_up", {})
		_end_game()

## v0.33.0 : Arsenal aléatoire : tirage et équipement de l'arme de la manche (en attente si l'arme est dans le Pack-a-Punch).
func _arsenal_roll() -> void:
	var id := arsenal.roll(arms, maxi(1, round_number)) if not arsenal.pending else arsenal.poll(arms, maxi(1, round_number))
	if id == "":
		return
	var nm := arsenal.weapon_name()
	announce("ARSENAL : %s" % nm, "Arme imposée pour la manche %d" % maxi(1, round_number))
	mode_event.emit("arsenal_weapon", {"id": id, "name": nm, "round": maxi(1, round_number)})

## Évènements du joueur posés par PlayerSim : à terre (les atouts sont perdus), relevé, onde du PHD Flopper, mort à terre.
func _player_events() -> void:
	if player.down_event:
		player.down_event = false
		if not blessed:   # à terre : on perd tous ses atouts (sauf sous la Bénédiction de l'Aube)
			pfx.on_down(self)   # v0.27.0 : Pierre tombale (avant l'effacement)
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

## v0.27.0 : début d'un rechargement (WeaponArms) : Cerise-foudre.
func on_reload_start(w: WeaponState) -> void:
	pfx.on_reload(self, w)

## PHD Flopper : onde explosive aux pieds du joueur à l'atterrissage (main.js flop) ; dégâts aux zombies seulement.
func flop(pos: Vector3) -> void:
	var F: Dictionary = Config.at("phd")
	arms.blast.splash(self, pos, float(F["radius"]), float(F["base"]) + float(F["perRound"]) * maxi(1, round_number), int(F["color"]))
	shake = maxf(shake, Rules.FLOP_SHAKE)

## Cible de type Bourreau / Ange (J10) : insensible à la Mort instantanée et à la Bombe.
func is_boss(z: ZombieSim) -> bool:
	return z.is_boss

## Un zombie vient de mourir sous un coup ou une explosion (bonus, essence).
func on_zombie_killed(z: ZombieSim, head := false) -> void:
	if timed != null and not over:   # v0.33.0 : Contre la montre : secondes rendues par mort
		var sec := timed.on_kill(head)
		if sec > 0.0:
			mode_event.emit("time_bonus", {"seconds": sec, "head": head, "round": false})
	if finale != null:
		finale.on_kill(z)
	powerups.on_kill(self, z)
	pfx.on_kill(self, z)   # v0.27.0 : Vautour

func _end_game() -> void:
	over = true
	game_over.emit()

## v0.26.0 : porte de sortie achetée (mode Zone unique) : fin de partie en victoire. Le signal game_over part comme pour une mort ;
## `escaped` dit à l'écran de fin et aux statistiques que c'est une évasion.
func escape_zone() -> void:
	if over:
		return
	escaped = true
	_end_game()

## Mode de la partie en cours : "classic", "zone", "timed" ou "arsenal".
func mode_id() -> String:
	if gm != null:
		return gm.id
	if timed != null:
		return GameMode.TIMED
	if arsenal != null:
		return GameMode.ARSENAL
	return GameMode.CLASSIC

# ---------------------------------------------------------------- tir : voir sim/weapon_arms.gd

## Dégâts sur un zombie + points (équivalent de game.hitZombie côté hôte).
## mel : coup de couteau (pas de bonus de tête, armure ignorée, points de CONFIG.knife.points).
func hit_zombie(z: ZombieSim, head: bool, dmg: float, head_mult: float, mel: bool = false, extra: Dictionary = {}) -> bool:
	var armor: Variant = z.get("armor")
	if not mel:   # v0.27.0 : Sixième sens : coups critiques des armes à feu (aucun tirage sans l'atout)
		var cm := pfx.crit_mult(self)
		if cm > 1.0:
			dmg *= cm
			perk_event.emit("crit", {"pos": z.pos})
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
	if mel and not killed:
		pfx.on_knife(self, z)   # v0.27.0 : Veuve noire : couteau collant
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
		on_zombie_killed(z, head)
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
	amount = pfx.filter_damage(self, amount)   # v0.27.0 : Bastion, Ultime Volonté
	if amount <= 0.0:
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
	watch.on_spawn(self, z, "finale")

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
	var tr := env.levels.end_region(player.region, player.pos.x, player.pos.z, player.pos.y)
	if tr != player.tregion:
		PerfLog.event("joueur change d'étage : %d -> %d" % [player.tregion, tr])
	player.tregion = tr

## Sources du champ de flux d'un étage : les joueurs qui y sont, et le pied de l'escalier qui mène aux autres (main.js fieldTargets).
func field_targets(region: int) -> Array:
	var out: Array = []
	var lv := env.levels
	for pl in env.players:
		if pl.dead:
			continue
		if lv == null or pl.tregion == region:
			out.append(_anchor(pl.pos) if region == 0 else pl.pos)
			continue
		var hop := lv.next_hop(region, pl.tregion)
		if hop.is_empty():
			continue
		var path: Array = hop["link"]["path"]
		var e: Array = path[0] if int(hop["dir"]) > 0 else path[path.size() - 1]
		out.append(Vector3(e[0], 0.0, e[2]))
	return out

## v0.34.11 : case de départ du champ pour un joueur collé à un mur (sa case est dans la marge, donc bloquée) : la case libre la plus proche
## SANS mur entre lui et elle (rayon de collision). NavGrid.nearest_free seule pouvait choisir une case de l'autre côté d'une palissade mince :
## les zombies de ce côté-là croyaient être arrivés et restaient contre le mur.
func _anchor(p: Vector3) -> Vector3:
	var nav := env.nav
	if nav == null:
		return p
	var ix := nav.cx(p.x)
	var iz := nav.cz(p.z)
	if not nav.inside(ix, iz) or nav.blocked[nav.idx(ix, iz)] == 0:
		return p
	var best := p
	var bd := INF
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			var jx := ix + dx
			var jz := iz + dz
			if not nav.inside(jx, jz) or nav.blocked[nav.idx(jx, jz)] != 0:
				continue
			var wx := nav.world_x(jx)
			var wz := nav.world_z(jz)
			var d := Vector2(wx - p.x, wz - p.z).length()
			if d >= bd or d < 1e-4:
				continue
			if collision.ray_hit(p.x, p.y + 1.0, p.z, (wx - p.x) / d, 0.0, (wz - p.z) / d, d) < d - 0.05:
				continue
			bd = d
			best = Vector3(wx, p.y, wz)
	return best

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
		var max_cost := roundi((world.flow_range if world != null and world.flow_range > 0.0 else float(F["range"])) / nv.cell * 10.0)
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

## Zombies coincés dans le décor, perdus ou partis trop loin (main.js relocateZombies, revu en v0.34.11) : au lieu d'être téléportés près du
## joueur (une apparition sans animation, parfois sous ses yeux), ils s'enfoncent dans le sol s'ils sont en vue, puis réapparaissent par une
## fenêtre ou depuis le sol, hors de la vue du joueur et à distance de marche bornée (_pick_spawn). Au plus RESCUE_PER_PASS par passe.
## Relancé : coincé (no_progress > RESCUE_STUCK s à plus de RESCUE_NEAR m), perdu (lost_t > RESCUE_LOST s : aucune direction), au fond
## d'un obstacle (RESCUE_INSIDE s), trop loin (plus de RELOCATE_FAR m pendant RELOCATE_FAR_COUNT s). Le Bourreau n'est jamais relancé (JS).
## force : menu debug (U), sans attendre et avec des seuils plus bas ; renvoie le nombre de zombies relancés.
func _relocate(dt: float, force := false) -> int:
	if world == null:
		return 0
	if not force:
		relocate_t -= dt
		if relocate_t > 0.0:
			return 0
		relocate_t = Rules.RESCUE_INTERVAL
	if player.dead or player.tregion != 0:
		return 0
	var nav := world.nav
	var budget := 1000 if force else (0 if time < spawn_calm_until else Rules.RESCUE_PER_PASS)
	var moved := 0
	var step_t := 0.0 if force else Rules.RESCUE_INTERVAL
	for z in zombies:
		if z.dead:
			continue
		if z.burrowed():   # sous terre : il revient dès qu'une place cachée est libre
			if budget > 0 and _respawn(z, {"why": "burrowed"}):
				budget -= 1
				moved += 1
			continue
		if z.spawn_t > 0.0 or z.appear > 0.0 or z.region != 0 or not z.link.is_empty() or not z.vault.is_empty() or (z.is_boss and not z.mini):
			continue
		var near := Vector2(player.pos.x - z.pos.x, player.pos.z - z.pos.z).length()
		z.far_t = z.far_t + step_t if near > Rules.RELOCATE_FAR else 0.0
		var deep := nav.is_blocked_at(z.pos.x, z.pos.z) and nav.nearest_free(z.pos.x, z.pos.z, 2) < 0
		z.inside_t = z.inside_t + step_t if deep else 0.0
		var why := ""
		if z.no_progress > (1.5 if force else Rules.RESCUE_STUCK) and near > (2.0 if force else Rules.RESCUE_NEAR):
			why = "stuck"
		elif z.lost_t > (0.5 if force else Rules.RESCUE_LOST):
			why = "lost"
		elif deep and (force or z.inside_t >= Rules.RESCUE_INSIDE):
			why = "inside"
		elif z.far_t >= float(Rules.RELOCATE_FAR_COUNT) or (force and near > 70.0):
			why = "far"
		if why == "" or budget <= 0:
			continue
		budget -= 1
		moved += 1
		var info := {"why": why, "x": snappedf(z.pos.x, 0.01), "z": snappedf(z.pos.z, 0.01), "near": snappedf(near, 0.1), "np": snappedf(z.no_progress, 0.1),
			"lost": snappedf(z.lost_t, 0.1)}
		if _seen(z.pos + Vector3(0, 1.0, 0)) or not _respawn(z, info):
			info["burrow"] = true
			z.start_burrow()   # en vue (ou aucune place libre) : il s'enfonce d'abord dans le sol
			watch.on_rescue(self, z, "burrow", info)
	return moved

## Fait réapparaître un zombie (relancé) par une fenêtre ou depuis le sol, à une place cachée (_pick_spawn strict). false : aucune place.
func _respawn(z: ZombieSim, info: Dictionary = {}) -> bool:
	var sp := _pick_spawn(true)
	if sp.is_empty():
		return false
	z.reset_for_respawn()
	if String(sp["type"]) == "window":
		var wi := int(sp["index"])
		var n := world.window_normal(wi)
		z.start_window_spawn(world.window_inside(wi), world.window_outside(wi), world.window_center(wi), n, atan2(n.x, n.y), wi)
	else:
		z.start_ground_spawn(sp["pos"], rng.randf() * TAU)
	relocated += 1
	var d := info.duplicate()
	d["type"] = z.spawn_type
	var at := z.spawn_outside if z.spawn_type == "window" else z.spawn_pos
	d["to"] = [snappedf(at.x, 0.01), snappedf(at.z, 0.01)]
	d["d"] = snappedf(Vector2(at.x - player.pos.x, at.z - player.pos.z).length(), 0.1)
	watch.on_rescue(self, z, "respawn", d)
	return true

## Le point est-il vu par le joueur (cône de vision, distance, sans mur entre les deux) ?
func _seen(at: Vector3) -> bool:
	return ZombieWatch.seen_by(player, collision, at, Rules.SPAWN_VIEW_DIST, Rules.SPAWN_VIEW_DOT)

## Distance de marche (m) du champ de flux jusqu'au point (case libre voisine si le point est dans la marge d'un mur) ; INF : pas de chemin connu.
func _walk_at(x: float, z: float) -> float:
	var nav := env.nav if env != null else null
	if nav == null:
		return 0.0
	var w := nav.walk_distance(x, z)
	if w == INF and nav.is_blocked_at(x, z):
		var c := nav.nearest_free(x, z, 1)
		if c >= 0:
			var d := nav.dist[c]
			w = INF if d >= NavGrid.INF_D else (d / 10.0) * nav.cell
	return w

## Le champ de flux de la carte est-il prêt (au moins un calcul fini) ? Sinon les apparitions s'en tiennent aux distances à vol d'oiseau.
func _field_ready() -> bool:
	return env != null and env.nav != null and env.nav.field_swaps > 0

## Une place d'apparition au sol convient : à moins de walk_max m de marche et, si hidden, hors de la vue du joueur.
func _ground_ok(x: float, z: float, walk_max: float, hidden := true) -> bool:
	if _field_ready() and _walk_at(x, z) > walk_max:
		return false
	return not hidden or not _seen(Vector3(x, 1.0, z))

## Fenêtre libre à [min_d, max_d] m du point, à moins de walk_max m de marche, cachée du joueur (ni la fenêtre ni l'arrivée en vue) ; -1 si aucune.
func _pick_window_hidden(pp: Vector3, min_d: float, max_d: float, walk_max: float) -> int:
	var cand := world.windows_near(pp.x, pp.z, min_d, max_d, time)
	var n := cand.size()
	if n == 0:
		return -1
	var start := rng.randi() % n
	for k in n:
		var wi := cand[(start + k) % n]
		var o := world.window_outside(wi)
		if world.furniture_on and not world.furniture.is_empty() and StreetFurniture.blocks_spawn(o.x, o.z):
			continue
		if _field_ready() and _walk_at(o.x, o.z) > walk_max:
			continue
		if _seen(world.window_center(wi)) or _seen(o + Vector3(0, 1.0, 0)):
			continue
		return wi
	return -1

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

## Où apparaît le prochain zombie (main.js pickSpawn, revu en v0.34.11) : { type: "window", index } ou { type: "ground", pos }, ou {} s'il n'y a
## aucune place convenable (l'apparition est remise). Toujours dans une zone ouverte, par une fenêtre (escalade) ou depuis le sol (sortie de
## terre), HORS DE LA VUE du joueur et à moins de SPAWN_WALK_MAX m de MARCHE (champ de flux) : une fenêtre à 11-60 m, sinon le sol à 18-50 m,
## sinon une fenêtre à 6-80 m, sinon le sol à 8-60 m (SPAWN_WALK_MAX2). strict : rien d'autre ; sinon, après SPAWN_RELAX_AFTER s d'apparitions
## remises, une sortie de terre visible (animée) près du joueur. Le dernier repli du JS (15 m à l'est, sans contrôle) n'existe plus.
func _pick_spawn(strict := false) -> Dictionary:
	if gm != null:   # v0.26.0 : Zone unique : fenêtres et sol de la zone, hors du champ de vision
		return gm.pick_spawn(self, not strict and _spawn_wait_since >= 0.0 and time - _spawn_wait_since >= Rules.SPAWN_RELAX_AFTER)
	if world != null:
		var alive: Array[PlayerSim] = []
		for pl in env.players:
			if not pl.dead:
				alive.append(pl)
		var pool: Array[PlayerSim] = alive if not alive.is_empty() else env.players
		var pp := spawn_target(pool).pos
		if rng.randf() < Rules.WINDOW_CHANCE:
			var wi := _pick_window_hidden(pp, Rules.WORLD_SPAWN_MIN, Rules.WORLD_SPAWN_MAX, Rules.SPAWN_WALK_MAX)
			if wi >= 0:
				world.window_busy[wi] = time + Rules.WINDOW_BUSY
				return {"type": "window", "index": wi}
		var g := world.pick_ground(pp.x, pp.z, Rules.GROUND_MIN, Rules.GROUND_MAX, rng, _ground_ok.bind(Rules.SPAWN_WALK_MAX))
		if g != Vector3.INF:
			return {"type": "ground", "pos": g}
		var wi2 := _pick_window_hidden(pp, Rules.WORLD_SPAWN_MIN2, Rules.WORLD_SPAWN_MAX2, Rules.SPAWN_WALK_MAX2)
		if wi2 >= 0:
			world.window_busy[wi2] = time + Rules.WINDOW_BUSY
			return {"type": "window", "index": wi2}
		var g2 := world.pick_ground(pp.x, pp.z, 8.0, 60.0, rng, _ground_ok.bind(Rules.SPAWN_WALK_MAX2), Rules.GROUND_TRIES * 2)
		if g2 != Vector3.INF:
			return {"type": "ground", "pos": g2}
		if strict or _spawn_wait_since < 0.0 or time - _spawn_wait_since < Rules.SPAWN_RELAX_AFTER:
			return {}
		var g3 := world.pick_ground(pp.x, pp.z, 8.0, 40.0, rng, _ground_ok.bind(Rules.SPAWN_WALK_MAX2, false), Rules.GROUND_TRIES * 2)
		if g3 != Vector3.INF:
			spawns_relaxed += 1
			return {"type": "ground", "pos": g3}
		return {}
	var best: Vector3 = arena.spawn_points[0]
	var best_d := -1.0
	for _i in 3:
		var sp: Vector3 = arena.spawn_points[rng.randi() % arena.spawn_points.size()]
		var d := sp.distance_to(player.pos)
		if d > best_d:
			best_d = d
			best = sp
	return {"type": "arena", "pos": best + Vector3((rng.randf() - 0.5) * Rules.SPAWN_JITTER, 0, (rng.randf() - 0.5) * Rules.SPAWN_JITTER)}

## v0.34.11 : l'apparition de la manche est remise de SPAWN_RETRY s (aucune place cachée, ou porte tout juste achetée).
func _postpone_spawn() -> void:
	director.to_spawn += 1
	director.spawn_timer = maxf(director.spawn_timer, Rules.SPAWN_RETRY)
	spawns_postponed += 1

func _count_kind(k: String) -> int:
	var n := 0
	for q in zombies:
		if q.kind == k and not q.dead:
			n += 1
	return n

func _spawn_zombie() -> void:
	if world != null and time < spawn_calm_until:
		_postpone_spawn()
		return
	var sp := _pick_spawn()
	if sp.is_empty():
		if _spawn_wait_since < 0.0:
			_spawn_wait_since = time
		_postpone_spawn()
		return
	_spawn_wait_since = -1.0
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
		var kz := String(world.objects.get("knightZone", IK["zone"]))   # v0.34.0 : zones propres à la carte alpine
		var pz: Array = world.objects.get("pestZones", Z["pestilent"]["zones"])
		knight = r >= int(IK["fromRound"]) and zname == kz and _count_kind("armored") < int(IK["maxAlive"]) and rng.randf() < float(IK["chance"])
		var PE: Dictionary = Z["pestilent"]
		pest = not knight and r >= int(PE["fromRound"]) and pz.has(zname) and _count_kind("bloat") < int(PE["maxAlive"]) and rng.randf() < float(PE["chance"])
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
	hp *= daynight.zombie_health_mult()   # v0.25.0 : +10 % la nuit en cycle Auto (sim/day_night.gd)
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
	watch.on_spawn(self, z, String(sp["type"]))

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
	spawn_calm_until = time + Rules.DOOR_CALM   # v0.34.11 : pas de vague d'apparitions derrière la porte qu'on vient d'ouvrir
	watch.write({"ev": "door", "t": snappedf(time, 0.01), "id": id, "zones": world.doors[id]["opened"], "px": snappedf(player.pos.x, 0.01), "pz": snappedf(player.pos.z, 0.01)})
	door_opened.emit(id)
	powerups.opening_bonus(self, world.doors[id])
	return id
