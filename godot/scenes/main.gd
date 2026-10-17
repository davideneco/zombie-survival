extends Node3D
## Scène principale de J1 : arène, caméra à la première personne, zombies, HUD. Lit les entrées, appelle Game.step dans
## _physics_process (60 Hz, indépendant du rendu), et ne fait que du rendu dans _process. La souris tourne hors du pas fixe.
##
## Arguments (après --) : --bot (pilote automatique), --demo (un zombie lent devant le joueur), --seed=N, --shot=chemin.png --at=S (capture à S secondes de jeu, puis quitte),
## --quit-at=S (quitte à S secondes de jeu : pour --write-movie), --horde=N (N zombies variés autour du joueur, sans manches), --sync-flow (champ de flux par tranches, sans fil de travail).

const ZombieView := preload("res://scenes/zombie_view.gd")
const ARENA := preload("res://scenes/world/arena.tscn")
const WORLD := preload("res://scenes/world/world.tscn")
const HUD := preload("res://scenes/ui/hud.tscn")
const WeaponView := preload("res://scenes/weapon_view.gd")
const RidesView := preload("res://scenes/world/rides_view.gd")
const MachinesView := preload("res://scenes/world/machines_view.gd")
const TRACER_COLOR := Color("ffd27a")
const TRACER_TIME := 0.06
const TRACER_WIDTH := 0.012

var _arena_node: Node3D
var _camera: Camera3D
var _hud: CanvasLayer
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
var _open_all := false
var _horde := 0
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
var _do: PackedStringArray = []   # --do=a,b : actions de démonstration au lancement (perks, powerup:TYPE, box, pap, all-doors, money, down)
var _ruin := ""                   # --ruin=smoke|burn|wreck : abîme les motos (fumée, incendie, épave) pour les captures

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a == "--bot":
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
		elif a.begins_with("--horde="):
			_horde = int(a.substr(8))
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
	_setup_inputs()
	_camera = Camera3D.new()
	_camera.fov = Rules.FOV_DEG
	_camera.near = 0.05
	_camera.far = 600.0
	add_child(_camera)
	_hud = HUD.instantiate()
	add_child(_hud)
	_hud.restart_requested.connect(_restart)
	_weapon_view = Node3D.new()
	_weapon_view.set_script(WeaponView)
	add_child(_weapon_view)
	_weapon_view.setup(_camera)
	Game.weapon_acquired.connect(func(id): _hud.announce("%s : ARME ACQUISE" % String(Config.weapon(id)["name"])))
	Game.purchase_denied.connect(func(price): _hud.announce("%d POINTS REQUIS" % price))
	Game.round_started.connect(func(n): _hud.announce("MANCHE %d" % n))
	Game.round_ended.connect(func(): _hud.announce("MANCHE TERMINÉE"))
	Game.zombie_spawned.connect(_on_zombie_spawned)
	Game.player_hurt.connect(func(_a): _hud.hurt_flash())
	Game.shot_fired.connect(_on_shot)
	Game.door_opened.connect(func(id): _hud.announce("PORTE OUVERTE : %s" % Game.world.doors[id]["name"]))
	Game.door_denied.connect(func(id): _hud.announce("%d POINTS REQUIS" % int(Game.world.doors[id]["price"])))
	Game.game_over.connect(_on_game_over)
	Game.announced.connect(func(title: String, sub: String): _hud.announce(title, sub))
	_restart()
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
	if _at_pos != Vector3.INF:
		Game.player.pos = _at_pos
		Game.player.yaw = _at_yaw
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
	_hud.hide_end()
	_prev_player = Game.player.pos
	if not _bot and DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

## N zombies variés (marcheurs, coureurs, rampants, chevaliers, pestiférés) autour du joueur, et plus de manches : pour les captures.
func _spawn_horde(n: int) -> void:
	Game.director.intermission = 1.0e9
	var kinds := ["", "", "", "armored", "bloat", "", "crawl", "run"]
	for i in n:
		var p := Vector3.INF
		if Game.world != null:
			p = Game.world.pick_ground(Game.player.pos.x, Game.player.pos.z, 7.0, 22.0, Game.rng)
		if p == Vector3.INF:
			var a := TAU * i / n
			p = Game.player.pos + Vector3(cos(a), 0, sin(a)) * 8.0
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
	if _first_person:
		r.cam.third_person = false
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

func _setup_inputs() -> void:
	var map := {
		"move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN], "move_left": [KEY_A, KEY_LEFT], "move_right": [KEY_D, KEY_RIGHT],
		"sprint": [KEY_SHIFT], "jump": [KEY_SPACE], "reload": [KEY_R], "use": [KEY_E],
		"knife": [KEY_V], "grenade": [KEY_G], "tram_gong": [KEY_H], "tram_doors": [KEY_O], "tram_switch": [KEY_B], "weapon_1": [KEY_1], "weapon_2": [KEY_2], "weapon_3": [KEY_3],
	}
	for action: String in map:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for k: int in map[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k as Key   # touche PHYSIQUE : ZQSD en AZERTY = WASD en QWERTY
			InputMap.action_add_event(action, ev)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and Game.playing and not Game.over:
		var m := event as InputEventMouseMotion
		Game.player.last_mouse = Game.time
		Game.player.yaw -= m.relative.x * Rules.MOUSE_SENS
		Game.player.pitch = clampf(Game.player.pitch - m.relative.y * Rules.MOUSE_SENS, -Rules.PITCH_LIMIT, Rules.PITCH_LIMIT)
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_ESCAPE:
			Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		elif event.physical_keycode == KEY_E and Game.playing and not Game.over:
			Game.interact()
		elif event.physical_keycode == KEY_R and Game.over:
			_restart()
	elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and not Game.over:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	if event is InputEventMouseButton and event.pressed:   # J4 : molette = changer d'arme, clic molette = obus sous canon
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_pending["wheel"] = 1
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_pending["wheel"] = -1
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			_pending["gl"] = true
	elif event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_V:
			if Game.rides != null and Game.rides.ride != null:
				Game.rides.toggle_view()   # assis : V change de vue
			else:
				_pending["knife"] = true
		elif Game.rides != null and event.physical_keycode == KEY_H:
			Game.rides.tram_gong()
		elif Game.rides != null and event.physical_keycode == KEY_O:
			Game.rides.tram_doors()
		elif Game.rides != null and event.physical_keycode == KEY_B:
			Game.rides.tram_switch()
		elif event.physical_keycode == KEY_G:
			_pending["grenade"] = true
		elif event.physical_keycode in [KEY_1, KEY_2, KEY_3]:
			_pending["weapon"] = int(event.physical_keycode) - int(KEY_1)

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
	_camera.fov = Game.arms.fov(Rules.FOV_DEG)
	# zombies retirés par la simulation
	for id: int in _views.keys():
		if not _views[id].sim in Game.zombies:
			_views[id].queue_free()
			_views.erase(id)
	_quit_check()
	for i in range(_tracers.size() - 1, -1, -1):
		_tracers[i][1] -= dt
		if _tracers[i][1] <= 0.0:
			_tracers[i][0].queue_free()
			_tracers.remove_at(i)
	if _shot_path != "" and Game.time >= _shot_at and not _shot_done:
		_shot_done = true
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot_path)
		print("capture : %s (manche %d, %d tués, %d points, %d PV)" % [_shot_path, Game.round_number, Game.kills, Game.points, Game.player.health])
		get_tree().quit()

func _quit_check() -> void:
	if _quit_at > 0.0 and Game.time >= _quit_at:
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
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_hud.show_end("Manche %d  ·  %d zombies tués  ·  %d points" % [Game.round_number, Game.kills, Game.points])
