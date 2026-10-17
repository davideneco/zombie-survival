extends Node3D
## Scène principale de J1 : arène, caméra à la première personne, zombies, HUD. Lit les entrées, appelle Game.step dans
## _physics_process (60 Hz, indépendant du rendu), et ne fait que du rendu dans _process. La souris tourne hors du pas fixe.
##
## Arguments (après --) : --bot (pilote automatique), --demo (un zombie lent devant le joueur), --seed=N, --shot=chemin.png --at=S (capture à S secondes de jeu, puis quitte),
## --quit-at=S (quitte à S secondes de jeu : pour --write-movie), --horde=N (N zombies variés autour du joueur, sans manches), --sync-flow (champ de flux par tranches, sans fil de travail).
## J7 : sans aucun argument, le jeu s'ouvre sur l'écran titre ; avec un argument, la partie démarre tout de suite (outils, captures). --menu force le titre,
## --ui=title|menu|options|keys|capture|conflict|pause|map|over|victory ouvre un écran (captures), --hud-demo montre les éléments de la finale (barre de boss, bandeau, Fanal),
## --settings=chemin utilise un autre fichier de réglages (Game.settings).

const ZombieView := preload("res://scenes/zombie_view.gd")
const ARENA := preload("res://scenes/world/arena.tscn")
const WORLD := preload("res://scenes/world/world.tscn")
const HUD := preload("res://scenes/ui/hud.tscn")
const Menus := preload("res://scenes/ui/menus.gd")
const WeaponView := preload("res://scenes/weapon_view.gd")
const RidesView := preload("res://scenes/world/rides_view.gd")
const MachinesView := preload("res://scenes/world/machines_view.gd")
const GraphicsView := preload("res://scenes/graphics_view.gd")
const FxView := preload("res://scenes/fx_view.gd")
const TRACER_COLOR := Color("ffd27a")
const TRACER_TIME := 0.06
const TRACER_WIDTH := 0.012

var _arena_node: Node3D
var _camera: Camera3D
var _hud: CanvasLayer
var _menus: CanvasLayer
var _menu := false                ## s'ouvre sur l'écran titre (aucun argument, ou --menu)
var _ui := ""                     ## --ui= : écran à ouvrir au lancement
var _hud_demo := false
var _real_t := 0.0
var _views: Dictionary = {}     # id de ZombieSim -> ZombieView
var _prev_player := Vector3.ZERO
var _bot := false
var _shot_path := ""
var _shot_at := 0.0
var _seed := -1
var _quit_at := 0.0
var _shot_done := false
var _demo := false
var _map := ""
var _at_pos := Vector3.INF      ## --pos=x,z[,yaw_deg] : téléporte le joueur (captures de lieux repères)
var _at_yaw := 0.0
var _at_pitch := 0.0            ## --pitch=deg : inclinaison de la caméra au départ (captures)
var _fps_secs := 0.0            ## --fps=S : mesure les images par seconde pendant S secondes (après 3 s d'échauffement), imprime un résumé puis quitte ; --spin : la caméra tourne
var _spin := false
var _fps_t := 0.0
var _fps_frames: PackedFloat32Array = []
var _fps_gpu := 0.0
var _fps_calls := 0.0
var _fps_calls_max := 0
var _fps_prims := 0.0
var _fps_n := 0
var _no_hud := false            ## --no-hud : sans HUD ni menus (comparaisons de rendu avec le JS)
var _open_all := false
var _horde := 0
var _horde_near := false          ## --horde-near : les zombies de --horde sont à 3-5 m (gros plans)
var _sync_flow := false
var _tracers: Array = []         # [mesh, temps restant]
var _pending: Dictionary = {}    # J4 : appuis (couteau, grenade, obus sous canon, arme, molette) lus au prochain pas de simulation
var _weapon_view: Node3D
var _rides_view: Node3D
var _prev_eye := Vector3.ZERO    # J5 : œil (caméra) au pas précédent, pour l'interpolation sur un véhicule
var _mount := ""                  # --mount=moto|grosseMoto|velo|tram : monte sur la machine la plus proche de l'arrivée
var _auto_fwd := false            # --auto-fwd : accélérateur maintenu (captures et vidéos)
var _power := false               # --power : sous-station remise (tram alimenté)
var _tram_door := false           # --tram-doors : portes de la rame ouvertes au départ
var _tram_in := false             # --tram-in : joueur debout dans la rame
var _first_person := false        # --first-person : vue à la première personne sur les véhicules
var _machines_view: Node3D
var _graphics: Node               # J9 : environnement, ciel, ombres, qualité (graphics_view.gd)
var _fx: Node3D                   # J9 : particules et taches de sang (fx_view.gd)
var _do: PackedStringArray = []   # --do=a,b : actions de démonstration au lancement (perks, powerup:TYPE, box, pap, all-doors, money, down)
var _ruin := ""                   # --ruin=smoke|burn|wreck : abîme les motos (fumée, incendie, épave) pour les captures

func _ready() -> void:
	var user_args := OS.get_cmdline_user_args()
	_menu = user_args.is_empty() or "--menu" in user_args
	for a in user_args:
		if a == "--ui=":
			continue
		if a.begins_with("--ui="):
			_ui = a.substr(5)
		elif a == "--hud-demo":
			_hud_demo = true
		elif a == "--bot":
			_bot = true
		elif a == "--demo":
			_demo = true
		elif a.begins_with("--map="):
			_map = a.substr(6)
		elif a == "--open-all":
			_open_all = true
		elif a.begins_with("--pos="):
			var f := a.substr(6).split(",")
			_at_pos = Vector3(float(f[0]), 0.0, float(f[1]))
			_at_yaw = deg_to_rad(float(f[2])) if f.size() > 2 else 0.0
		elif a.begins_with("--pitch="):
			_at_pitch = deg_to_rad(float(a.substr(8)))
		elif a.begins_with("--fps="):
			_fps_secs = float(a.substr(6))
		elif a == "--spin":
			_spin = true
		elif a == "--no-hud":
			_no_hud = true
		elif a.begins_with("--horde="):
			_horde = int(a.substr(8))
		elif a == "--horde-near":
			_horde_near = true
		elif a == "--sync-flow":
			_sync_flow = true
		elif a.begins_with("--mount="):
			_mount = a.substr(8)
		elif a == "--auto-fwd":
			_auto_fwd = true
		elif a == "--power":
			_power = true
		elif a == "--tram-doors":
			_tram_door = true
		elif a.begins_with("--do="):
			_do = a.substr(5).split(",")
		elif a.begins_with("--ruin="):
			_ruin = a.substr(7)
		elif a == "--tram-in":
			_tram_in = true
		elif a == "--first-person":
			_first_person = true
		elif a.begins_with("--seed="):
			_seed = int(a.substr(7))
		elif a.begins_with("--shot="):
			_shot_path = a.substr(7)
		elif a.begins_with("--quit-at="):
			_quit_at = float(a.substr(10))
		elif a.begins_with("--at="):
			_shot_at = float(a.substr(5))
	_camera = Camera3D.new()
	_camera.fov = float(Game.settings.get_value("fov"))
	_camera.near = 0.05
	_camera.far = 180.0               # le JS s'arrête à 170 m : au-delà le brouillard cache tout
	add_child(_camera)
	_graphics = GraphicsView.new()
	add_child(_graphics)
	_graphics.setup(_camera, _map == "arena")
	_fx = FxView.new()
	add_child(_fx)
	_fx.setup(_camera)
	_hud = HUD.instantiate()
	add_child(_hud)
	_menus = Menus.new()
	add_child(_menus)
	_menus.start_requested.connect(_start_game)
	_menus.resume_requested.connect(_apply_layers)
	_menus.restart_requested.connect(func() -> void:
		_restart()
		_menus.begin_game())
	_menus.title_requested.connect(func() -> void:
		_restart()
		_menus.open_title())
	_menus.quit_requested.connect(func() -> void: get_tree().quit())
	_menus.layers_changed.connect(_apply_layers)
	Game.settings.changed.connect(_on_setting)
	_weapon_view = Node3D.new()
	_weapon_view.set_script(WeaponView)
	add_child(_weapon_view)
	_weapon_view.setup(_camera)
	Game.weapon_acquired.connect(func(id): _hud.announce("%s : ARME ACQUISE" % String(Config.weapon(id)["name"])))
	Game.purchase_denied.connect(func(price): _hud.announce("%d POINTS REQUIS" % price))
	Game.round_started.connect(func(n): _hud.announce("MANCHE %d" % n))
	Game.round_ended.connect(func(): _hud.announce("MANCHE TERMINÉE"))
	Game.zombie_spawned.connect(_on_zombie_spawned)
	Game.shot_fired.connect(_on_shot)
	Game.door_opened.connect(func(id): _hud.announce("PORTE OUVERTE : %s" % Game.world.doors[id]["name"]))
	Game.door_denied.connect(func(id): _hud.announce("%d POINTS REQUIS" % int(Game.world.doors[id]["price"])))
	Game.game_over.connect(_on_game_over)
	Game.announced.connect(func(title: String, sub: String): _hud.announce(title, sub))
	_restart()
	_apply_audio()
	if "--no-music" not in user_args:
		Sfx.start_music()
	if _menu:
		_menus.open_title()
	else:
		_menus.begin_game()
	_open_ui(_ui)
	if _no_hud:
		_hud.visible = false
		_menus.visible = false
	if _hud_demo:
		_demo_hud()
	if _demo:   # un zombie à 5 m devant le joueur, pour les captures
		var z := ZombieSim.new()
		z.id = 999
		z.pos = Vector3(2.0, 0, 2.5)
		z.speed = 0.5
		z.health = 1000.0
		z.rng = Game.rng
		Game.zombies.append(z)
		Game.zombie_spawned.emit(z)

func _restart() -> void:
	for v in _views.values():
		v.queue_free()
	_views.clear()
	if _arena_node != null:
		_arena_node.queue_free()
	Game.new_game(_seed, _map, Config.at("startWeapons", []))
	Sfx.reset()
	if _fx != null:
		_fx.clear()
	if _at_pos != Vector3.INF:
		Game.player.pos = _at_pos
		Game.player.yaw = _at_yaw
		Game.player.pitch = _at_pitch
	if _open_all and Game.world != null:
		Game.world.open_all_doors()
	Game.flow_threaded = not _sync_flow and Game.world != null
	if _horde > 0:
		_spawn_horde(_horde)
	_arena_node = (WORLD if Game.world != null else ARENA).instantiate()
	add_child(_arena_node)
	if _rides_view != null:
		_rides_view.queue_free()
		_rides_view = null
	if Game.rides != null:
		_rides_view = Node3D.new()
		_rides_view.set_script(RidesView)
		add_child(_rides_view)
		_rides_view.setup(_camera)
		_start_mounted()
	if _machines_view != null:
		_machines_view.queue_free()
		_machines_view = null
	if Game.machines != null:
		_machines_view = Node3D.new()
		_machines_view.set_script(MachinesView)
		add_child(_machines_view)
		_machines_view.setup()
	_debug_do()
	_prev_player = Game.player.pos
	_apply_brightness()
	_map_prepare()
	_pending.clear()

## N zombies variés (marcheurs, coureurs, rampants, chevaliers, pestiférés) autour du joueur, et plus de manches : pour les captures.
func _spawn_horde(n: int) -> void:
	Game.director.intermission = 1.0e9
	var kinds := ["", "", "", "armored", "bloat", "", "crawl", "run"]
	for i in n:
		var p := Vector3.INF
		if Game.world != null:
			p = Game.world.pick_ground(Game.player.pos.x, Game.player.pos.z, 3.0 if _horde_near else 7.0, 5.0 if _horde_near else 22.0, Game.rng)
		if p == Vector3.INF:
			var a := TAU * i / n
			p = Game.player.pos + Vector3(cos(a), 0, sin(a)) * (4.0 if _horde_near else 8.0)
		var k: String = kinds[i % kinds.size()]
		var spd := 1.8 + 0.15 * (i % 5)
		if k == "run":
			spd *= 1.5
		Game.debug_spawn(p, spd, k == "crawl", k if k in ["armored", "bloat"] else "")

## --do= : actions de démonstration (captures, vidéos). perks : tous les atouts ; powerup:TYPE : un bonus devant le joueur ; money ; box / pap : achète
## à la machine la plus proche de la position ; to-box / to-pap / to-perk:ID : se place devant la machine ; down : à terre.
func _debug_do() -> void:
	for cmd in _do:
		var c := cmd.split(":")
		match c[0]:
			"money":
				Game.points = 100000
			"perks":
				for id: String in Config.at("perks"):
					Game.add_perk(id)
			"powerup":
				var f := Vector3(-sin(Game.player.yaw), 0, -cos(Game.player.yaw)) * 2.5
				Game.powerups.spawn(Game, Game.player.pos + f, c[1] if c.size() > 1 else "")
			"collect":   # ramasse tout de suite un bonus (HUD des bonus actifs, Bombe)
				Game.powerups.collect(Game, {"type": c[1]})
			"to-box", "to-pap", "to-perk":
				var type := "box" if c[0] == "to-box" else ("pap" if c[0] == "to-pap" else "perk")
				for m: Dictionary in Game.machines.list:
					if m["type"] == type and (c.size() < 2 or m["id"] == c[1]) and (type != "box" or m == Game.machines.box.active_box()):
						var yaw := float(m["yaw"])
						Game.player.pos = Vector3(float(m["pos"]["x"]) + sin(yaw) * 2.2, 0, float(m["pos"]["z"]) + cos(yaw) * 2.2)
						Game.player.yaw = yaw   # face à la machine (le regard part vers -sin, -cos)
						break
			"box", "pap":
				Game.points = maxi(Game.points, 100000)
				Game.interact()
			"teddy":   # le prochain tirage de la boîte est le nounours
				Game.machines.box.limit = Game.machines.box.uses + 1
			"open-doors":
				Game.world.open_all_doors()
			"down":
				Game.add_perk("quickrevive")
				Game.player.hurt(1000.0, Game.time)

## --mount= : place le joueur près de la machine demandée et monte dessus (pour les captures et les vidéos). tram : près du nez, courant remis.
func _start_mounted() -> void:
	var r: Rides = Game.rides
	if _power or _mount == "tram":
		r.set_power(true, true)
	r.cam.third_person = bool(Game.settings.get_value("tp_vehicle")) and not _first_person
	if _ruin != "":
		for v in r.vehicles:
			if v.type == "moto" or v.type == "grosseMoto":
				match _ruin:
					"smoke":
						v.hp = v.max_hp() * (0.4 if v.type == "moto" else 0.2)
					"burn":
						r.damage_vehicle(v, 1.0e9)
						v.burn_t = 1.0e9
					"wreck":
						r.damage_vehicle(v, 1.0e9)
						v.state = "wreck"
						v.wreck_t = 1.0e9
	if _tram_door and not r.trams.is_empty():
		r.trams[0].door_open = true
		r.trams[0].door_f = 1.0
	if _tram_in and not r.trams.is_empty():
		r.place_in_tram(r.trams[0], 0.0, 0.0)
	if _mount == "":
		return
	if _mount == "tram":
		var tr: TramSim = r.trams[0]
		var nose: Dictionary = tr.mods[tr.n - 1]
		Game.player.pos = Vector3(nose["x"] + nose["tx"] * (tr.M / 2.0 + 1.0), 0.0, nose["z"] + nose["tz"] * (tr.M / 2.0 + 1.0))
		r.try_mount(tr, 0)
		return
	for v in r.vehicles:
		if v.type == _mount:
			Game.player.pos = Vector3(v.x + 1.0, 0.0, v.z + 0.5)
			r.try_mount(v, 0)
			Game.player.yaw = v.yaw
			return

func _unhandled_input(event: InputEvent) -> void:
	var live: bool = Game.playing and not Game.over and _menus.in_game
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and live:
		var m := event as InputEventMouseMotion
		var sens := Rules.MOUSE_SENS * float(Game.settings.get_value("sens"))
		Game.player.last_mouse = Game.time
		Game.player.yaw -= m.relative.x * sens
		Game.player.pitch = clampf(Game.player.pitch - m.relative.y * sens, -Rules.PITCH_LIMIT, Rules.PITCH_LIMIT)
	elif event is InputEventMouseButton and event.pressed and live and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not _bot:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if not live:
		return
	if event is InputEventMouseButton and event.pressed:   # J4 : molette = changer d'arme, clic molette = obus sous canon
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_pending["wheel"] = 1
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_pending["wheel"] = -1
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_pending["gl"] = true
	elif event is InputEventKey and event.pressed and not event.echo:
		# les touches viennent de l'InputMap (Options > Touches) : lettre tapée ou touche physique selon la liaison
		var riding: bool = Game.rides != null and Game.rides.ride != null
		if event.is_action_pressed("use"):
			Game.interact()
		elif event.is_action_pressed("vehicle_view") and riding:
			Game.rides.toggle_view()   # assis : la touche de vue change de vue
			Game.settings.set_value("tp_vehicle", Game.rides.cam.third_person)
		elif event.is_action_pressed("knife") and not riding:
			_pending["knife"] = true
		elif Game.rides != null and event.is_action_pressed("tram_gong"):
			Game.rides.tram_gong()
		elif Game.rides != null and event.is_action_pressed("tram_doors"):
			Game.rides.tram_doors()
		elif Game.rides != null and event.is_action_pressed("tram_switch"):
			Game.rides.tram_switch()
		elif event.is_action_pressed("grenade"):
			_pending["grenade"] = true
		else:
			for i in 3:
				if event.is_action_pressed("weapon_%d" % (i + 1)):
					_pending["weapon"] = i

func _physics_process(dt: float) -> void:
	_prev_player = Game.player.pos
	_prev_eye = _eye_now()
	for v in _views.values():
		v.remember()
	if _rides_view != null:
		_rides_view.remember()
	var input: Dictionary
	if _bot:
		input = Bot.think(Game)
	else:
		input = {
			"mx": Input.get_axis("move_left", "move_right"),
			"mz": Input.get_axis("move_back", "move_forward"),
			"sprint": Input.is_action_pressed("sprint"),
			"jump": Input.is_action_pressed("jump"),
			"fire": Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED,
			"reload": Input.is_action_just_pressed("reload"),
			"aim": Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED,
		}
		if _auto_fwd:
			input["mz"] = 1.0
		input.merge(_pending, true)
	_pending.clear()
	Game.step(dt, input)

## Position de l'œil au pas courant : œil du joueur, ou celui qu'impose le véhicule (caméra externe ou œil de la selle).
func _eye_now() -> Vector3:
	var p := Game.player
	if p.eye_override != Vector3.INF:
		return p.eye_override
	return p.pos + Vector3(0, float(Config.at("player.eye")), 0)

func _process(dt: float) -> void:
	var f := Engine.get_physics_interpolation_fraction()
	var p := Game.player
	if p.eye_override != Vector3.INF or _prev_eye != Vector3.ZERO and Game.rides != null and Game.rides.cam.placed:
		_camera.position = _prev_eye.lerp(_eye_now(), f)
	else:
		_camera.position = _prev_player.lerp(p.pos, f) + Vector3(0, float(Config.at("player.eye")), 0)
	var roll := 0.0
	if Game.rides != null and Game.rides.ride != null and not Game.rides.cam.placed and not Game.rides.ride["v"].is_tram():
		roll = Game.rides.ride["v"].lean * 0.5   # la vue penche avec la moto
	if Game.shake > 0.0:
		_camera.position += Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * Game.shake * 0.25
	_camera.rotation = Vector3(p.pitch, p.yaw, roll)   # ordre YXZ : lacet puis tangage
	if Game.rides != null:   # arme de la vue cachée en conduisant et en vue externe
		_weapon_view.hide_gun = Game.rides.driving() or Game.rides.cam.external()
	_camera.fov = Game.arms.fov(float(Game.settings.get_value("fov")))
	# zombies retirés par la simulation
	for id: int in _views.keys():
		if not _views[id].sim in Game.zombies:
			_views[id].queue_free()
			_views.erase(id)
	_quit_check()
	_fps_step(dt)
	# musique : intensité selon la manche (0,3 + 0,05 x manche), étouffée dans les menus et en pause (main.js updateMusicMood)
	var in_game: bool = _menus.in_game and not Game.over
	Sfx.set_mood(AudioRules.mood_intensity(in_game, false, Game.round_number), not in_game or not Game.playing)
	for i in range(_tracers.size() - 1, -1, -1):
		_tracers[i][1] -= dt
		if _tracers[i][1] <= 0.0:
			_tracers[i][0].queue_free()
			_tracers.remove_at(i)
	_real_t += dt
	var shot_ready: bool = Game.time >= _shot_at if Game.playing else _real_t >= 3.0 + _shot_at   # un écran de menu n'avance pas le temps de jeu
	if _shot_path != "" and shot_ready and not _shot_done:
		_shot_done = true
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot_path)
		print("capture : %s (manche %d, %d tués, %d points, %d PV)" % [_shot_path, Game.round_number, Game.kills, Game.points, Game.player.health])
		get_tree().quit()

## --fps : durée de chaque image (temps réel), appels de rendu, primitives, temps GPU mesuré par le moteur. Imprime le résumé sur une ligne « FPS ... » puis quitte.
func _fps_step(dt: float) -> void:
	if _fps_secs <= 0.0:
		return
	_fps_t += dt
	var vp := get_viewport().get_viewport_rid()
	if _fps_t < 3.0:
		RenderingServer.viewport_set_measure_render_time(vp, true)
		return
	if _spin:
		Game.player.yaw += deg_to_rad(30.0) * dt
	_fps_frames.append(dt)
	_fps_gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp)
	var calls := int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	_fps_calls += calls
	_fps_calls_max = maxi(_fps_calls_max, calls)
	_fps_prims += Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)
	_fps_n += 1
	if _fps_t >= 3.0 + _fps_secs:
		var sorted := _fps_frames.duplicate()
		sorted.sort()
		var total := 0.0
		for f in sorted:
			total += f
		var p99 := sorted[mini(sorted.size() - 1, int(sorted.size() * 0.99))]
		print("FPS q=%d %dx%d : moyenne %.1f, 1%% bas %.1f, pire %.1f ; image moyenne %.2f ms, GPU moyen %.2f ms ; appels %.0f (max %d), triangles %.0f k ; %d images" % [
			int(Game.settings.get_value("quality")), get_viewport().get_visible_rect().size.x, get_viewport().get_visible_rect().size.y,
			1.0 / (total / sorted.size()), 1.0 / p99, 1.0 / sorted[sorted.size() - 1], total / sorted.size() * 1000.0, _fps_gpu / _fps_n,
			_fps_calls / _fps_n, _fps_calls_max, _fps_prims / _fps_n / 1000.0, _fps_n])
		get_tree().quit()

func _quit_check() -> void:
	if _quit_at > 0.0 and Game.time >= _quit_at:
		print("audio : %d sons lus, %d ignorés, %d voix reprises, %d voix créées ; musique niveau %d ; lus : %s" % [Sfx.stats["played"], Sfx.stats["skipped"], Sfx.stats["stolen"], Sfx.voice_count(), Sfx.music_level, Sfx.counts])
		get_tree().quit()

func _on_zombie_spawned(z: ZombieSim) -> void:
	var v := Node3D.new()
	v.set_script(ZombieView)
	add_child(v)
	v.setup(z)
	_views[z.id] = v

func _on_shot(origin: Vector3, end: Vector3) -> void:
	var len := origin.distance_to(end)
	if len < 0.5:
		return
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(TRACER_WIDTH, TRACER_WIDTH, len)
	m.mesh = b
	var mat := StandardMaterial3D.new()
	mat.albedo_color = TRACER_COLOR
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.material_override = mat
	add_child(m)
	var start := origin + (end - origin).normalized() * 0.8 + Vector3(0.12, -0.12, 0).rotated(Vector3.UP, Game.player.yaw)   # part de la bouche de l'arme
	m.global_position = (start + end) / 2.0
	m.look_at(end, Vector3.UP)
	_tracers.append([m, TRACER_TIME])

func _on_game_over() -> void:
	_menus.show_over("Vous avez survécu jusqu'à la [color=#ffffff][b]manche %d[/b][/color]\n%d zombies tués  ·  %d points" % [Game.round_number, Game.kills, Game.points])

# ---------------------------------------------------------------- J7 : menus, réglages, démonstrations
func _start_game() -> void:
	_menus.begin_game()

## Les couches d'interface ouvertes décident si le jeu tourne et si la souris est capturée.
func _apply_layers() -> void:
	var blocked: bool = _menus.stack.blocks_game()
	Game.playing = _menus.in_game and not blocked
	_pending.clear()
	if DisplayServer.get_name() == "headless" or _bot:
		return
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if (Game.playing and not Game.over) else Input.MOUSE_MODE_VISIBLE

func _on_setting(key: String) -> void:
	match key:
		"brightness":
			_apply_brightness()
		"volume", "music":
			_apply_audio()
		"fov":
			_camera.fov = float(Game.settings.get_value("fov"))

## Luminosité (Options) : exposition et ambiance, réglées par GraphicsView (graphics_view.gd).
func _apply_brightness() -> void:
	pass

## Volume général (bus Master) et volume de la musique (bus Music) : voir l'autoload Sfx.
func _apply_audio() -> void:
	Sfx.apply_settings()

func _map_prepare() -> void:
	if _menus != null and _menus.map_view != null:
		_menus.map_view.player_color = CharacterDefs.accent(int(Game.settings.get_value("char")))
		_menus.map_view.prepare()
	if _hud != null:
		_hud.radar.player_color = CharacterDefs.accent(int(Game.settings.get_value("char")))

## --ui= : ouvre un écran pour les captures.
func _open_ui(name: String) -> void:
	match name:
		"title":
			_menus.open_title()
		"menu":
			_menus.open_title()
			_menus.open_menu()
		"options":
			_menus.open_title()
			_menus.open_options(UiStack.TITLE)
		"keys", "capture", "conflict":
			_menus.open_title()
			_menus.open_options(UiStack.TITLE)
			_menus.open_keys()
			if name != "keys":
				_menus._start_capture("reload")
			if name == "conflict":
				_menus._apply_binding("reload", "key:g", {}, false)
		"pause":
			_menus.escape()
		"map":
			_menus.toggle_map()
		"over":
			Game.player.hurt(10000.0, Game.time)
			Game._end_game()
		"victory":
			_menus.show_victory("VICTOIRE !", "Le Bourreau est vaincu : vous avez sauvé la cathédrale.\nManche 12  ·  240 zombies tués")

## --hud-demo : les éléments du HUD que la finale pilotera (J10) : bandeau, barre de boss, marque, Fanal, popups.
func _demo_hud() -> void:
	_hud.set_banner("L'HEURE DU JUGEMENT · 3 MINUTES")
	_hud.set_boss_bar({"hp": 640.0, "max": 1000.0, "phase": 2, "name": "LE BOURREAU", "inv": false, "thresholds": [0.7, 0.45, 0.2]})
	_hud.set_mark("CONDAMNÉ · 5 s")
	_hud.set_fanal(0.4, "LE FANAL D'ERWIN · 1/1 joueur")
	_hud.toast("Vous avez rejoint la partie")
	_hud.popup("+60")
	_hud.popup("+100", "head")
	_hud.popup("MUNITIONS MAX", "bonus")
	_hud.show_hit(true)
