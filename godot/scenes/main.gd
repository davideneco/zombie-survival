extends Node3D
## Scène principale de J1 : arène, caméra à la première personne, zombies, HUD. Lit les entrées, appelle Game.step dans
## _physics_process (60 Hz, indépendant du rendu), et ne fait que du rendu dans _process. La souris tourne hors du pas fixe.
##
## Arguments (après --) : --bot (pilote automatique), --demo (un zombie lent devant le joueur), --seed=N, --shot=chemin.png --at=S (capture à S secondes de jeu, puis quitte),
## --quit-at=S (quitte à S secondes de jeu : pour --write-movie), --horde=N (N zombies variés autour du joueur, sans manches), --sync-flow (champ de flux par tranches, sans fil de travail).
## J7 : sans aucun argument, le jeu s'ouvre sur l'écran titre ; avec un argument, la partie démarre tout de suite (outils, captures). --menu force le titre,
## --ui=title|menu|options|keys|capture|conflict|pause|map|over|victory|mode|escape|timeup ouvre un écran (captures), --hud-demo montre les éléments de la finale (barre de boss, bandeau, Fanal),
## --settings=chemin utilise un autre fichier de réglages (Game.settings).
## v0.14.0 : le menu principal ne charge RIEN de la partie (ni monde, ni zombies, ni vues de jeu : Game.world est nul). NOUVELLE PARTIE (ou tout argument de jeu)
## lance `_start_session` : chargement par étapes avec barre de progression (données de la carte sur un fil de travail, construction de la ville répartie sur
## plusieurs images), puis la partie. Retour au menu : tout est libéré (`_unload_session`, Game.unload). Options : --difficulty=easy|normal|hard, --stats=chemin
## (statistiques), --click=TEXTE[,TEXTE] (appuie sur des boutons du menu, captures), --load-shot=chemin,fraction (capture de l'écran de chargement), --probe-title
## (imprime l'état de la mémoire au titre puis quitte : tests).

const ZombieView := preload("res://scenes/zombie_view.gd")
const ZombieModelView := preload("res://scenes/zombie_model_view.gd")
const ARENA := preload("res://scenes/world/arena.tscn")
const WORLD := preload("res://scenes/world/world.tscn")
const AlpineView := preload("res://scenes/world/alpine_view.gd")   # v0.34.0 : Station des Aiguilles
const HUD := preload("res://scenes/ui/hud.tscn")
const Menus := preload("res://scenes/ui/menus.gd")
const WeaponView := preload("res://scenes/weapon_view.gd")
const RidesView := preload("res://scenes/world/rides_view.gd")
const MachinesView := preload("res://scenes/world/machines_view.gd")
const ZoneModeView := preload("res://scenes/world/zone_mode_view.gd")
const PerkFxView := preload("res://scenes/perk_fx_view.gd")
const FurnitureView := preload("res://scenes/world/furniture_view.gd")
const GraphicsView := preload("res://scenes/graphics_view.gd")
const FxView := preload("res://scenes/fx_view.gd")
const FinaleView := preload("res://scenes/finale_view.gd")   # J10
const AngelView := preload("res://scenes/angel_view.gd")
const PERF_ARGS := ["--perf-log="]   ## v0.19.0 : n'ouvre pas la partie (le menu s'affiche quand c'est le seul argument)
const TRACER_COLOR := Color("ffd27a")
const TRACER_TIME := 0.06
const TRACER_WIDTH := 0.012

var _arena_node: Node3D
var _camera: Camera3D
var _flow := SessionFlow.new()       ## v0.14.0 : menu / chargement / partie
var _session_live := false           ## la partie est construite et peut tourner (vues, monde)
var _difficulty_arg := ""
var _mode_arg := ""                  ## v0.26.0 : --mode=classic|zone (sans toucher aux réglages enregistrés)
var _zone_arg := -1                  ## v0.26.0 : --zone=N ou --zone=Nom (mode Zone unique)
var _click: PackedStringArray = []   ## --click=
var _click_t := 0.0
var _probe := false                  ## --probe-title
var _load_shot := ""                 ## --load-shot=chemin,fraction
var _load_shot_at := 2.0
var _record_ok := false              ## les statistiques ne comptent que les parties lancées depuis le menu (pas les bots ni les captures)
var _t_boot_ms := 0
var _first_draw := false
var _load_max_dt := 0.0               ## pire durée d'image pendant le chargement (l'interface reste-t-elle vivante ?)
var _load_frames := 0
var _load_last_us := 0
var _load_slow := 0                   ## v0.34.6 : images du chargement de plus de 100 ms
var _hud: CanvasLayer
var _menus: CanvasLayer
var _menu := false                ## s'ouvre sur l'écran titre (aucun argument, ou --menu)
var _ui := ""                     ## --ui= : écran à ouvrir au lancement
var _hud_demo := false
var _real_t := 0.0
var _views: Dictionary = {}     # id de ZombieSim -> ZombieView
var _prev_player := Vector3.ZERO
var _acts: Array = []             # --act=ACTION@S : appuie sur ACTION (reload, knife, grenade, gl) à S secondes de jeu, une fois (captures des mains)
var _hold_sprint := false         # --hold-sprint : le sprint reste enfoncé (captures de la pose de sprint des mains)
var _hold_aim := false            # --hold-aim : visée maintenue (captures des armes en ADS)
var _melee_pose := -1.0
var _axe_arg := false
var _hold_fx := false             # --hold-fx : éclair de bouche et dernier traçant restent affichés (captures)
var _hold_fire := false           # --hold-fire : détente maintenue (capture de l'éclair de bouche)
var _hold_unstick := false        # --hold-unstick : touche « se débloquer » maintenue (capture)
var _hold_jump := false           # --hold-jump : Espace maintenu (capture de l'enjambement)
var _bot := false
var _soak: SoakBot = null         # --soak=N : partie d'un pilote qui se promène jusqu'à la manche N (J11)
var _soak_rounds := 0
var _no_warmup := false           # --no-warmup : sans le préchauffage du chargement (mesures avant / après, v0.19.0)
var _warm: Warmup = null
var _perf_soak_min := 0.0         # --perf-soak=N : durée de jeu en minutes (SoakBot en mode « perf » : portes fermées, achats, changements de zone)
var _shot_path := ""
var _shot_at := 0.0
var _seed := -1
var _quit_at := 0.0
var _shot_done := false
var _demo := false
var _map := ""
var _hour_arg := -1.0            ## --hour=H : heure de jeu de départ (cycle Auto) ; --hold-hour : l'heure ne bouge plus (captures, v0.25.0) ; --daynight=0|1|2 : mode sans toucher aux réglages
var _hold_hour := false
var _sky_arg := -1.0             ## --sky=K (0 nuit, 0,33 aube, 1 jour) : ciel de la finale sans la finale (captures, v0.22.0)
var _at_pos := Vector3.INF      ## --pos=x,z[,yaw_deg] : téléporte le joueur (captures de lieux repères)
var _at_yaw := 0.0
var _at_pitch := 0.0            ## --pitch=deg : inclinaison de la caméra au départ (captures)
var _fps_secs := 0.0            ## --fps=S : mesure les images par seconde pendant S secondes (après 3 s d'échauffement), imprime un résumé puis quitte ; --spin : la caméra tourne
var _spin := false
var _fps_overlay: FpsOverlay      ## v0.20.5 compteur de FPS (F3 / option)
var _spin_rate := 0.0           ## --spin-rate=DEG : la caméra tourne de DEG degrés par seconde dès le début de la partie (captures en rotation ; v0.20.4)
var _fps_t := 0.0
var _fps_frames: PackedFloat32Array = []
var _fps_gpu := 0.0
var _fps_calls := 0.0
var _fps_calls_max := 0
var _fps_prims := 0.0
var _fps_proc := 0.0             ## --fps : somme du temps de _process par image (moniteur TIME_PROCESS : toutes les vues, dont les zombies)
var _fps_phys := 0.0
var _fps_step_us := 0
var _fps_steps := 0
var _fps_n := 0
var _no_weapon := false         ## --no-weapon : la caméra ne dessine pas la couche de la vue d'arme (captures du décor)
var _no_hud := false            ## --no-hud : sans HUD ni menus (comparaisons de rendu avec le JS)
var _open_all := false
var _show_collision := false     ## --show-collision[=rapport.json] : collision en surimpression (scenes/world/collision_view.gd)
var _collision_report := ""
var _eye_y := -1.0e9             ## --eye-y=Y : hauteur de la caméra (vue aérienne)
var _collision_floor := -1.0e9   ## --collision-floor=Y : un seul étage
var _horde := 0
var _zoo := 0.0                  ## --zoo=D : une rangée de chaque type de zombie (normal, coureur, boiteux, rampant, chevalier, pestiféré) à D m devant le joueur (captures)
var _zoo_state := ""             ## --zoo-state=death|headless|hit|window|ground : état imposé aux zombies du zoo (à --zoo-at=S secondes de jeu pour death / headless / hit ; dès le départ pour window / ground)
var _zoo_at := 0.5
var _zoo_done := false
var _horde_only := ""            ## --horde-only=normal|run|limp|crawl|armored|bloat : tous les zombies de --horde sont de ce type (captures)
var _horde_near := false          ## --horde-near : les zombies de --horde sont à 3-5 m (gros plans)
var _sync_flow := false
var _tracers: Array = []         # [mesh, temps restant]
var _shot_queue: Array = []       # tirs de l'image, [origine, fin] : traçants créés après la mise à jour de la caméra
var _pending: Dictionary = {}    # J4 : appuis (couteau, grenade, obus sous canon, arme, molette) lus au prochain pas de simulation
var _weapon_view: Node3D
var _avatar: PlayerAvatar          # v0.25.1 : le joueur vu de l'extérieur (vue à la 3e personne à pied)
var _tp_orbit := 0.0
var _tp_arm := 0.0
var _avatar_pose := ""             # --avatar-pose=Idle|Walk|Run|Jump : animation figée (captures)
var _rides_view: Node3D
var _prev_eye := Vector3.ZERO    # J5 : œil (caméra) au pas précédent, pour l'interpolation sur un véhicule
var _mount := ""                  # --mount=moto|grosseMoto|velo|tram : monte sur la machine la plus proche de l'arrivée
var _auto_fwd := false            # --auto-fwd : accélérateur maintenu (captures et vidéos)
var _power := false               # --power : sous-station remise (tram alimenté)
var _tram_door := false           # --tram-doors : portes de la rame ouvertes au départ
var _tram_at := PackedFloat32Array()  # --tram-at=u,w,cap : debout dans la rame à (u le long, w à droite), regard cap degrés à partir de l'avant (captures)
var _seat := -1                   # --seat=N : monte la place N de la rame (2 à 15 : passagers assis)
var _tram_in := false             # --tram-in : joueur debout dans la rame
var _cam_arm := 0.0               # --cam-arm=M : bras de caméra imposé sur la machine montée (captures)
var _look_yaw := 0.0              # --look-yaw=deg : décalage du regard une fois monté (captures)
var _first_person := false        # --first-person : vue à la première personne sur les véhicules
var _machines_view: Node3D
var _zone_view: Node3D            # v0.26.0 : murs des portes en Zone unique
var _perk_view: Node3D            # v0.27.0 : effets des nouveaux atouts
var _shop_view: Node3D            # v0.28.0 : wall weapon panels and ammo stations
var _furniture_view: Node3D       # v0.33.1 : mobilier urbain ajouté (StreetFurniture)
var _graphics: Node               # J9 : environnement, ciel, ombres, qualité (graphics_view.gd)
var _fx: Node3D                   # J9 : particules et taches de sang (fx_view.gd)
var _finale_view: Node3D          # J10 : effets des boss, faisceau, Fanal (finale_view.gd)
var _intro: BossIntro             # v0.20.1 : intro animée de la première apparition de chaque boss (pause bornée de la simulation) ; --no-boss-intro la coupe
var _finale_delay := 0.0          # --finale-delay=S : le boss de --finale=boss1|tanner|angel n'apparaît que S secondes de jeu après le saut (laisse finir le chargement du monde)
var _late: Array[Callable] = []   # démarrages de boss différés (--finale-delay)
var _late_at := -1.0
var _shot_intro_t := -1.0         # --shot-intro=T : capture T secondes après le début de l'intro de boss
var _finale_at := -1.0            # --finale-at=S : le saut --finale=ETAT se fait à S secondes de jeu (et non avant la première image) : mesures du premier affichage d'un boss
var _finale_arg := ""             # --finale=ETAT : saute dans la fin de partie (captures) : voir _debug_finale
var _hud_last := {"banner": "", "bar": {}, "mark": "", "fanal": -2.0, "fanal_text": ""}
var _god := false                 # --god : (v0.31.0, mesures de performance) les PV du joueur restent pleins
var _do: PackedStringArray = []   # --do=a,b : actions de démonstration au lancement (perks, powerup:TYPE, weapon:ID[:PAP], box, pap, all-doors, money, down)
var _door_probe := false          # --door-probe : achète une porte à 2 s et imprime les temps d'image qui suivent (v0.17.2)
var _probe_log: Array[float] = []
var _probe_state := 0
var _probe_last := 0
var _ruin := ""                   # --ruin=smoke|burn|wreck : abîme les motos (fumée, incendie, épave) pour les captures

func _ready() -> void:
	StartupLog.mark("main scene: _ready (main.gd and its preloads compiled)")
	UiTheme.apply_ui_scale(get_window())   # v0.34.7 : menus et HUD à l'échelle de l'écran (avant la construction des menus)
	StartupLog.attach(get_tree())
	var user_args := OS.get_cmdline_user_args()
	var game_args := Array(user_args).filter(func(a: String) -> bool: return not PERF_ARGS.any(func(p: String) -> bool: return a.begins_with(p)))
	_menu = game_args.is_empty() or "--menu" in user_args
	if PerfLog.setup_from_args(user_args, get_tree()):
		PerfLog.info_cb = _perf_info
	for a in user_args:
		if a == "--ui=":
			continue
		if a.begins_with("--ui="):
			_ui = a.substr(5)
		elif a == "--hud-demo":
			_hud_demo = true
		elif a == "--god":
			_god = true
		elif a == "--bot":
			_bot = true
		elif a.begins_with("--soak="):
			_soak_rounds = int(a.substr(7))
			_bot = true
		elif a == "--no-boss-intro":
			BossIntro.enabled = false
		elif a == "--no-warmup":
			_no_warmup = true
		elif a.begins_with("--perf-soak="):   # v0.19.0 : N minutes de jeu d'un pilote qui achète, tire et change de zone (provoque les pics, voir PerfLog)
			_perf_soak_min = float(a.substr(12))
			_soak_rounds = 1000
			_bot = true
		elif a == "--demo":
			_demo = true
		elif a.begins_with("--map="):
			_map = a.substr(6)
		elif a.begins_with("--char="):   # v0.21.1 : survivant imposé (id ou rang) sans toucher aux réglages enregistrés (captures)
			var ci := CharacterModel.IDS.find(a.substr(7))
			Game.settings.autosave = false
			Game.settings.set_value("char", ci if ci >= 0 else int(a.substr(7)))
		elif a == "--open-all":
			_open_all = true
		elif a.begins_with("--sky="):
			_sky_arg = float(a.substr(6))
		elif a.begins_with("--view="):   # v0.25.1 : 1 : première personne, 3 : troisième personne à pied (sans toucher aux réglages enregistrés)
			Game.settings.autosave = false
			Game.settings.values["view"] = 1 if int(a.substr(7)) == 3 else 0
		elif a.begins_with("--tp-orbit="):   # v0.25.1 : la caméra de la 3e personne tourne autour du joueur de N degrés (captures)
			_tp_orbit = deg_to_rad(float(a.substr(11)))
		elif a.begins_with("--tp-arm="):
			_tp_arm = float(a.substr(9))
		elif a.begins_with("--avatar-pose="):
			_avatar_pose = a.substr(14)
		elif a.begins_with("--hour="):
			_hour_arg = fposmod(float(a.substr(7)), 24.0)
		elif a == "--hold-hour":
			_hold_hour = true
		elif a.begins_with("--daynight="):
			Game.settings.autosave = false
			Game.settings.values["daynight"] = clampi(int(a.substr(11)), 0, 2)
		elif a.begins_with("--day-minutes="):
			Game.settings.autosave = false
			Game.settings.values["day_minutes"] = clampi(int(a.substr(14)), 2, 120)
		elif a == "--no-furniture":   # v0.33.1 : sans le mobilier urbain ajouté (collision et dessin : comparaisons)
			StreetFurniture.enabled = false
		elif a.begins_with("--pos="):
			var f := a.substr(6).split(",")
			_at_pos = Vector3(float(f[0]), 0.0, float(f[1]))
			_at_yaw = deg_to_rad(float(f[2])) if f.size() > 2 else 0.0
		elif a.begins_with("--pitch="):
			_at_pitch = deg_to_rad(float(a.substr(8)))
		elif a.begins_with("--cam-arm="):   # v0.21.2 : longueur du bras de la caméra de la machine montée (m), pour voir un siège de la rame de l'intérieur (captures)
			_cam_arm = float(a.substr(10))
		elif a.begins_with("--look-yaw="):   # v0.21.2 : une fois monté, la caméra tourne de N degrés autour de la machine (vue de côté ; capturer avant le recentrage de 1,5 s)
			_look_yaw = deg_to_rad(float(a.substr(11)))
		elif a.begins_with("--fps="):
			_fps_secs = float(a.substr(6))
		elif a == "--fps-counter":   # v0.20.5 : compteur de FPS affiché (captures ; non sauvegardé)
			Game.settings.autosave = false
			Game.settings.values["fps"] = true
		elif a.begins_with("--melee-pose="):   # v0.20.7 : fige le coup de couteau (ou de hache avec --axe) à T secondes du coup (captures)
			_melee_pose = float(a.substr(13))
		elif a == "--axe":
			_axe_arg = true
		elif a == "--spin":
			_spin = true
		elif a.begins_with("--spin-rate="):
			_spin_rate = deg_to_rad(float(a.substr(12)))
		elif a == "--no-hud":
			_no_hud = true
		elif a == "--no-weapon":   # v0.32.0 : captures du décor sans l'arme ni les mains (couche de la vue d'arme masquée)
			_no_weapon = true
		elif a.begins_with("--horde="):
			_horde = int(a.substr(8))
		elif a == "--horde-near":
			_horde_near = true
		elif a.begins_with("--horde-only="):
			_horde_only = a.substr(13)
		elif a.begins_with("--zoo="):
			_zoo = float(a.substr(6))
		elif a.begins_with("--zoo-state="):
			_zoo_state = a.substr(12)
		elif a.begins_with("--zoo-at="):
			_zoo_at = float(a.substr(9))
		elif a == "--show-collision" or a.begins_with("--show-collision="):   # v0.23.0 : segments et cercles de la collision en surimpression (a : rapport de collision-scan.py)
			_show_collision = true
			_collision_report = a.substr(17) if a.length() > 17 else ""
		elif a.begins_with("--eye-y="):   # v0.23.0 : caméra placée à Y m au-dessus du sol au point de --pos (vues aériennes de diagnostic)
			_eye_y = float(a.substr(8))
		elif a.begins_with("--collision-floor="):
			_collision_floor = float(a.substr(18))
		elif a == "--show-boxes":
			ZombieModels.show_boxes = true
		elif a == "--old-zombies":
			ZombieModels.use_old = true
		elif a == "--sync-flow":
			_sync_flow = true
		elif a.begins_with("--mount="):
			_mount = a.substr(8)
		elif a.begins_with("--act="):
			var f3 := a.substr(6).split("@")
			_acts.append([f3[0], float(f3[1]) if f3.size() > 1 else 0.3])
		elif a == "--hold-sprint":
			_hold_sprint = true
		elif a == "--hold-aim":
			_hold_aim = true
		elif a == "--hold-fx":
			_hold_fx = true
		elif a == "--hold-fire":
			_hold_fire = true
		elif a == "--hold-unstick":
			_hold_unstick = true
		elif a == "--hold-jump":
			_hold_jump = true
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
		elif a == "--door-probe":
			_door_probe = true
		elif a.begins_with("--tram-at="):
			_tram_at = PackedFloat32Array(Array(a.substr(10).split(",")).map(func(x): return float(x)))
			_tram_in = true
		elif a.begins_with("--seat="):
			_seat = int(a.substr(7))
			_mount = "tram"
		elif a == "--tram-in":
			_tram_in = true
		elif a == "--first-person":
			_first_person = true
		elif a.begins_with("--shot-intro="):
			_shot_intro_t = float(a.substr(13))
		elif a.begins_with("--finale-delay="):
			_finale_delay = float(a.substr(15))
		elif a.begins_with("--finale-at="):
			_finale_at = float(a.substr(12))
		elif a.begins_with("--finale="):
			_finale_arg = a.substr(9)
		elif a.begins_with("--seed="):
			_seed = int(a.substr(7))
		elif a.begins_with("--shot="):
			_shot_path = a.substr(7)
		elif a.begins_with("--quit-at="):
			_quit_at = float(a.substr(10))
		elif a.begins_with("--at="):
			_shot_at = float(a.substr(5))
		elif a.begins_with("--difficulty="):
			_difficulty_arg = a.substr(13)
		elif a.begins_with("--mode="):
			_mode_arg = a.substr(7)
		elif a.begins_with("--zone="):
			_zone_arg = int(a.substr(7)) if a.substr(7).is_valid_int() else ZoneCatalog.index_of(a.substr(7))
			if _mode_arg == "":
				_mode_arg = GameMode.ZONE
		elif a.begins_with("--click="):
			_click = a.substr(8).split(",")
		elif a == "--probe-title":
			_probe = true
			_menu = true
		elif a.begins_with("--load-shot="):
			var f2 := a.substr(12).split(",")
			_load_shot = f2[0]
			_load_shot_at = float(f2[1]) if f2.size() > 1 else 0.5
	_t_boot_ms = Time.get_ticks_msec()
	_record_ok = _menu and not _bot and _soak_rounds == 0
	var t_menus := StartupLog.t()
	_menus = Menus.new()
	add_child(_menus)
	StartupLog.span("menus built", t_menus)
	add_child(DebugOverlay.new())
	_fps_overlay = FpsOverlay.new()
	add_child(_fps_overlay)
	_menus.start_requested.connect(func() -> void: _start_session())
	_menus.resume_requested.connect(_apply_layers)
	_menus.restart_requested.connect(func() -> void:
		_record_stats()
		_start_session())
	_menus.title_requested.connect(_back_to_menu)
	_menus.quit_requested.connect(func() -> void: get_tree().quit())
	_menus.layers_changed.connect(_apply_layers)
	Game.settings.changed.connect(_on_setting)
	_connect_game_signals()
	_apply_audio()
	if "--no-music" not in user_args:
		var t_music := StartupLog.t()
		Sfx.start_music()
		StartupLog.span("music started", t_music)
	if _menu:
		_menus.open_title()
		_open_ui(_ui)
	else:
		await _start_session()
		_open_ui(_ui)
	print("MENU : prêt %d ms après le lancement du moteur (_ready : %d ms)" % [Time.get_ticks_msec(), Time.get_ticks_msec() - _t_boot_ms])
	StartupLog.mark("main: _ready done", "window %s, UI %s, mode %d, quality %d, vsync %d, character %d" % [get_window().size, get_viewport().get_visible_rect().size, DisplayServer.window_get_mode(), int(Game.settings.get_value("quality")),
		DisplayServer.window_get_vsync_mode(), int(Game.settings.get_value("char"))])

## Signaux de la simulation : branchés UNE fois (les vues de jeu, elles, sont recréées à chaque partie : on teste leur présence).
func _connect_game_signals() -> void:
	Game.weapon_acquired.connect(func(id): if _hud != null: _hud.announce("%s : ARME ACQUISE" % String(Config.weapon(id)["name"])))
	Game.purchase_denied.connect(func(price): if _hud != null: _hud.announce("%d POINTS REQUIS" % price))
	Game.round_started.connect(func(n): if _hud != null: _hud.announce("MANCHE %d" % n))
	Game.round_ended.connect(func(): if _hud != null: _hud.announce("MANCHE TERMINÉE"))
	Game.zombie_spawned.connect(_on_zombie_spawned)
	Game.shot_fired.connect(_on_shot)
	Game.door_opened.connect(func(id): if _hud != null: _hud.announce("PORTE OUVERTE : %s" % Game.world.doors[id]["name"]))
	Game.door_denied.connect(func(id): if _hud != null: _hud.announce("%d POINTS REQUIS" % int(Game.world.doors[id]["price"])))
	Game.game_over.connect(_on_game_over)
	Game.announced.connect(func(title: String, sub: String): if _hud != null: _hud.announce(title, sub))
	if PerfLog.on:
		_connect_perf_events()
	Game.victory_screen.connect(func(title: String, text: String) -> void: _menus.show_victory(title, text))   # J10 : le Bourreau est tombé
	Game.liberated_screen.connect(func(title: String, text: String) -> void: _menus.show_victory(title, text))   # J10 : STRASBOURG LIBÉRÉE

## v0.19.0 : contexte joint aux lignes du journal de performance (--perf-log).
func _perf_info() -> Dictionary:
	if Game.player == null:
		return {}
	var alive := Game.alive_count()
	return {"manche": Game.round_number, "zombies": "%d/%d" % [alive, Game.zombies.size()], "vues": _views.size(), "pv": int(Game.player.health), "arme": Game.weapon.id if Game.arms != null else "",
		"x": int(Game.player.pos.x), "z": int(Game.player.pos.z), "étage": Game.player.tregion, "qualité": int(Game.settings.get_value("quality"))}

## Évènements de la simulation joints aux lignes lentes (premiers tirs de chaque arme, apparitions, morts, explosions, portes, bonus…).
func _connect_perf_events() -> void:
	var shot_seen := {}
	Game.shot_fired.connect(func(_o: Vector3, _e: Vector3) -> void:
		var id: String = Game.weapon.id if Game.arms != null else "?"
		if not shot_seen.has(id):
			shot_seen[id] = true
			PerfLog.event("PREMIER tir %s" % id))
	var kinds_seen := {}
	Game.zombie_spawned.connect(func(z: ZombieSim) -> void:
		var k: String = ZombieModels.variant_key(z) if not (z is BossSim) else "boss"
		var tag := "PREMIER " if not kinds_seen.has(k) else ""
		kinds_seen[k] = true
		PerfLog.event("%sapparition %s (%s)" % [tag, k, z.spawn_type]))
	Game.zombie_killed.connect(func(z: ZombieSim, head: bool) -> void: PerfLog.event("mort %s%s" % [z.kind, " (tête)" if head else ""]))
	Game.explosion.connect(func(_p: Vector3, r: float, _c: int) -> void: PerfLog.event("explosion r=%.1f" % r))
	Game.bloat_burst.connect(func(_p: Vector3) -> void: PerfLog.event("pestiféré éclate"))
	Game.door_opened.connect(func(id: int) -> void: PerfLog.event("porte %d ouverte" % id))
	Game.round_started.connect(func(n: int) -> void: PerfLog.event("manche %d commence" % n))
	Game.round_ended.connect(func() -> void: PerfLog.event("manche terminée"))
	Game.powerup_spawned.connect(func(pu: Dictionary) -> void: PerfLog.event("bonus %s apparaît" % str(pu.get("type", "?"))))
	Game.powerup_collected.connect(func(t: String) -> void: PerfLog.event("bonus %s ramassé" % t))
	Game.perk_acquired.connect(func(id: String) -> void: PerfLog.event("atout %s" % id))
	Game.weapon_acquired.connect(func(id: String) -> void: PerfLog.event("arme %s acquise" % id))
	Game.box_event.connect(func(n: String, _d: Dictionary) -> void: PerfLog.event("boîte : %s" % n))
	Game.pap_event.connect(func(n: String, _d: Dictionary) -> void: PerfLog.event("Pack-a-Punch : %s" % n))
	Game.ride_event.connect(func(n: String, _d: Dictionary) -> void: PerfLog.event("véhicule : %s" % n))
	Game.zombie_event.connect(func(_z: ZombieSim, n: String) -> void: PerfLog.event("zombie : %s" % n))
	Game.weapon_event.connect(func(n: String, _d: Dictionary) -> void: PerfLog.event("arme : %s" % n))
	Game.player_downed.connect(func() -> void: PerfLog.event("joueur à terre"))
	Game.boss_event.connect(func(n: String, _d: Dictionary) -> void: PerfLog.event("boss : %s" % n))
	Game.unstuck.connect(func(_a: Vector2, _b: Vector2, d: float, _c: bool) -> void: PerfLog.event("déblocage %.0f m" % d))

# ---------------------------------------------------------------- v0.14.0 : session (chargement par étapes, retour au menu)
func _map_choice() -> String:
	if _map != "":
		return _map
	var m := String(Game.settings.get_value("map"))
	if _mode_choice() == GameMode.ZONE:   # v0.26.0 : Zone unique : toujours sur la carte de Strasbourg
		return "strasbourg"
	if _mode_choice() != GameMode.CLASSIC and m == "arena":   # v0.33.0 / v0.34.0 : Contre la montre, Arsenal : Strasbourg ou la station alpine
		return "strasbourg"
	return m

func _mode_choice() -> String:
	return GameMode.valid(_mode_arg if _mode_arg != "" else String(Game.settings.get_value("mode")))

func _progress(text: String, frac: float) -> void:
	_menus.show_loading(text, _flow.progress(frac))
	if _load_shot != "" and _flow.progress(frac) >= _load_shot_at:
		var path := _load_shot
		_load_shot = ""
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(path)
		print("capture du chargement : %s (%.0f %%)" % [path, _flow.progress(frac) * 100.0])

## Passe à l'étape suivante du chargement et laisse l'interface se redessiner.
func _step(frac_done := 0.0) -> void:
	await _progress(_flow.step_text(), frac_done)
	await get_tree().process_frame

func _start_session() -> void:
	if not _flow.start_loading():
		return
	var t0 := Time.get_ticks_msec()
	StartupLog.mark("game loading: start")
	_menus.trim_characters()   # v0.34.4 : seuls les modèles du survivant choisi restent (ceux lus au menu sont libérés)
	PerfLog.phase = PerfLog.PHASE_LOADING
	_unload_session()
	_load_max_dt = 0.0
	_load_frames = 0
	_load_last_us = 0
	_load_slow = 0
	_report_memory("avant chargement")
	Game.difficulty = Difficulty.valid(_difficulty_arg if _difficulty_arg != "" else String(Game.settings.get_value("difficulty")))
	Game.mode = _mode_choice()
	Game.zone_pick = clampi(_zone_arg if _zone_arg >= 0 else int(Game.settings.get_value("zone")), 0, Settings.ZONE_COUNT - 1)
	var map := _map_choice()
	await _step(0.0)
	# 1. données de la carte sur un fil de travail (l'interface continue d'animer fond et barre)
	var th := Thread.new()
	th.start(func() -> Object: return Arena.load_arena() if map == "arena" else (AlpineMap.load_map() if map == "alpine" else World.load_world()))
	var tw := Time.get_ticks_msec()
	while th.is_alive():
		await _progress(_flow.step_text(), 1.0 - exp(-(Time.get_ticks_msec() - tw) / 700.0))
		await get_tree().process_frame
	var data: Object = th.wait_to_finish()
	var t_pf := StartupLog.t()
	LoadPrefetch.start(map)   # v0.34.6 : modèles, shaders et textures du jeu lus par les fils du chargeur pendant la construction des vues et de la ville
	StartupLog.span("game loading: %d resources requested from loader threads" % LoadPrefetch.requested, t_pf)
	var t_data := Time.get_ticks_msec() - t0
	StartupLog.mark("game loading: map data read (thread)")
	# 2. état de la partie (rapide : les données sont déjà là)
	_flow.next_step()
	await _step(0.0)
	var t_state := StartupLog.t()
	_new_game_state(data, map)
	StartupLog.span("game state (Game.new_game)", t_state)
	# 3. vues de jeu
	_flow.next_step()
	await _step(0.0)
	_build_scene_nodes(map)
	var t_scene := Time.get_ticks_msec() - t0
	StartupLog.mark("game loading: game state and views built")
	# 4. la ville (tuiles, textures, décor) répartie sur plusieurs images
	_flow.next_step()
	if _arena_node != null and _arena_node.has_method("build"):
		_arena_node.progress.connect(func(f: float) -> void: _progress(_flow.step_text(), f))
		await _arena_node.build()
	await _step(1.0)
	var t_city := Time.get_ticks_msec() - t0
	StartupLog.mark("game loading: city built")
	for a in OS.get_cmdline_user_args():   # v0.34.0 : --export-geom=DIR (station alpine) : géométrie pour les scans, puis quitte
		if a.begins_with("--export-geom=") and _arena_node != null and _arena_node.has_method("export_geometry"):
			_arena_node.export_geometry(a.substr(14))
			get_tree().quit(0)
			return
	# 5. préchauffage sous le voile du chargement (pipelines, sons, pools : v0.19.0), puis derniers réglages
	_flow.next_step()
	await _step(0.0)
	await _finish_scene(map)
	var t_warm := Time.get_ticks_msec()
	if not _no_warmup:
		await _warmup()
	var t_warm_ms := Time.get_ticks_msec() - t_warm
	StartupLog.mark("game loading: warm-up done", "%d ms" % t_warm_ms)
	LoadPrefetch.finish()
	_flow.next_step()
	await _step(0.0)
	_session_live = true
	PerfLog.phase = PerfLog.PHASE_GAME
	PerfLog.event("partie prête")
	_flow.finish_loading()
	_menus.begin_game()
	StartupLog.mark("game loading: game ready", "%d ms in total, %d frames, worst frame %.0f ms, %d frames over 100 ms, map %s" % [Time.get_ticks_msec() - t0, _load_frames, _load_max_dt * 1000.0, _load_slow, map])
	StartupLog.session(true)
	print("CHARGEMENT : partie prête en %d ms (données %d ms, vues %d ms, ville %d ms, préchauffage %d ms, fin %d ms) ; %d images, pire image %.0f ms, %d de plus de 100 ms ; carte %s, difficulté %s" % [
		Time.get_ticks_msec() - t0, t_data, t_scene - t_data, t_city - t_scene, t_warm_ms, Time.get_ticks_msec() - t0 - t_city - t_warm_ms, _load_frames, _load_max_dt * 1000.0, _load_slow, map, Game.difficulty])
	_report_memory("partie lancée")

## v0.19.0 : préchauffage (voir warmup.gd), tourne sous l'écran de chargement.
func _warmup() -> void:
	_warm = Warmup.new()
	await _warm.run(self, _camera, _fx, _weapon_view, _machines_view, _hud, _make_warm_view, func(text: String, frac: float) -> void:
		await _progress(text, frac))
	_hud_last = {"banner": "", "bar": {}, "mark": "", "fanal": -2.0, "fanal_text": ""}

func _make_warm_view(z: ZombieSim) -> Node3D:
	var v := Node3D.new()
	v.set_script(ZombieModelView if _uses_model_view(z) else ZombieView)
	add_child(v)
	v.setup(z)
	return v

## Libère la partie en cours : vues, ville, zombies, simulation (retour au menu, rejouer).
func _unload_session() -> void:
	_session_live = false
	LoadPrefetch.finish()
	StartupLog.session(false)
	PerfLog.phase = PerfLog.PHASE_MENU
	for v in _views.values():
		_drop(v)
	_views.clear()
	ZombieModels.clear_pool()
	for t in _tracers:
		_drop(t[0])
	_tracers.clear()
	_shot_queue.clear()
	for n in [_arena_node, _rides_view, _machines_view, _zone_view, _perk_view, _shop_view, _furniture_view, _weapon_view, _finale_view, _fx, _graphics, _hud, _intro, _camera]:
		_drop(n)
	_zone_view = null
	_perk_view = null
	_shop_view = null
	_furniture_view = null
	_intro = null
	_arena_node = null
	_rides_view = null
	_machines_view = null
	_weapon_view = null
	_finale_view = null
	_fx = null
	_graphics = null
	_hud = null
	_camera = null
	_pending.clear()
	_menus.map_view.release()
	Game.unload()
	Sfx.reset()

func _drop(n: Node) -> void:
	if n != null and is_instance_valid(n):
		if n.get_parent() != null:
			n.get_parent().remove_child(n)
		n.queue_free()

func _back_to_menu() -> void:
	_record_stats()
	_unload_session()
	_flow.to_menu()
	_menus.open_title()
	await get_tree().process_frame
	await get_tree().process_frame
	_report_memory("après retour au menu")

## Fin de partie (mort, victoire puis retour au menu, ou fermeture) : met à jour les statistiques, une seule fois par partie.
func _record_stats() -> void:
	if not _flow.needs_record():
		return
	_flow.mark_recorded()
	if not _record_ok or Game.player == null or Game.map_name == "arena":
		return
	if Game.gm != null:   # v0.26.0 : Zone unique : meilleurs scores par zone, à part
		var zb := Game.stats.record_zone(Game.gm.zone_name, Game.difficulty, Game.round_number, Game.kills, Game.points_earned, Game.time, Game.escaped)
		print("statistiques Zone unique (%s) : manche %d, %d tués, %d points gagnés, %.0f s, évasion %s ; records battus : %s" % [Game.gm.zone_name, Game.round_number, Game.kills, Game.points_earned, Game.time, Game.escaped, zb])
		return
	if Game.timed == null and Game.arsenal == null and Game.world != null and Game.world.map_id == "alpine":   # v0.34.0 : Classique de la station alpine : à part
		var ab := Game.stats.record_mode("alpine", Game.difficulty, Game.round_number, Game.kills, Game.points_earned, Game.time)
		print("statistiques Station des Aiguilles : manche %d, %d tués, %d points gagnés, %.0f s ; records battus : %s" % [Game.round_number, Game.kills, Game.points_earned, Game.time, ab])
		return
	if Game.timed != null or Game.arsenal != null:   # v0.33.0 : Contre la montre, Arsenal aléatoire : à part
		var mb := Game.stats.record_mode(Game.mode_id(), Game.difficulty, Game.round_number, Game.kills, Game.points_earned, Game.time)
		print("statistiques %s : manche %d, %d tués, %d points gagnés, %.0f s ; records battus : %s" % [GameMode.name_of(Game.mode_id()), Game.round_number, Game.kills, Game.points_earned, Game.time, mb])
		return
	var broken := Game.stats.record(Game.difficulty, Game.round_number, Game.kills, Game.points, Game.time, Game.finale_done)
	print("statistiques : manche %d, %d tués, %d points, %.0f s, victoire %s ; records battus : %s" % [Game.round_number, Game.kills, Game.points, Game.time, Game.finale_done, broken])


func _soak_end() -> void:
	var r := _soak.rows
	print("SOAK fin : manche %d, %.0f s de jeu, %d tués, partie %s ; pas moyen %.2f ms, pire %.1f ms ; mémoire %.1f -> %.1f Mo, objets %d -> %d, noeuds %d -> %d" % [
		Game.round_number, Game.time, Game.kills, "terminée" if Game.over else "en cours", _soak.step_us / float(maxi(1, _soak.steps)) / 1000.0, _soak.step_us_max / 1000.0,
		r[0]["mem_mb"], r[-1]["mem_mb"], r[0]["objects"], r[-1]["objects"], r[0]["nodes"], r[-1]["nodes"]])
	for l in _soak.errand_log:
		print("  bot : ", l)
	print("SOAK atouts : %s ; effets des nouveaux atouts : %s ; points gagnés %d" % [Game.arms.perks.keys(), Game.pfx.stats, Game.points_earned])
	if Game.timed != null:   # v0.33.0
		print("SOAK contre la montre : %.0f s restantes, %.0f s rendues (%.0f perdues au plafond), temps écoulé : %s" % [Game.timed.left, Game.timed.gained, Game.timed.lost, Game.time_up])
	if Game.arsenal != null:
		print("SOAK arsenal : armes %s" % [Game.arsenal.history])
	get_tree().quit()

## État de la partie (Game.new_game avec les données déjà chargées) et réglages de démonstration des arguments.
func _new_game_state(data: Object, map: String) -> void:
	Game.new_game(_seed, map, Config.at("startWeapons", []), data)
	_apply_daynight(true)
	Sfx.reset()
	if _at_pos != Vector3.INF:
		Game.player.pos = _at_pos
		Game.player.yaw = _at_yaw
		Game.player.pitch = _at_pitch
	if _open_all and Game.world != null:
		Game.world.open_all_doors()
	Game.flow_threaded = not _sync_flow and Game.world != null
	if Game.world != null and Game.world.levels != null and not _no_warmup:
		Game.world.levels.start_warm_navs()   # v0.34.6 : grilles des étages sur un fil de travail pendant la construction de la ville
	if _horde > 0:
		_spawn_horde(_horde)
	if _zoo > 0.0:
		_spawn_zoo(_zoo)

## Caméra, ciel, effets, HUD, arme et nœud de la carte (la ville se construit ensuite : `build()`).
func _build_scene_nodes(map: String) -> void:
	var ts := StartupLog.t()
	_camera = Camera3D.new()
	_camera.fov = float(Game.settings.get_value("fov"))
	_camera.near = 0.05
	_camera.far = 180.0               # le JS s'arrête à 170 m : au-delà le brouillard cache tout
	if _no_weapon:
		_camera.cull_mask &= ~(1 << 19)   # WeaponModels.VIEW_LAYER
	add_child(_camera)
	_graphics = GraphicsView.new()
	add_child(_graphics)
	_graphics.alpine = map == "alpine"   # v0.34.0 : neige, brouillard de montagne, vent
	_graphics.setup(_camera, map == "arena")
	if map == "alpine":
		_camera.far = 900.0   # les montagnes autour de la station (le brouillard de montagne est plus léger que celui de la ville)
	if _sky_arg >= 0.0:
		_graphics.dbg_sky = _sky_arg
		_graphics.set_sky_k(_sky_arg)
	StartupLog.span("views: camera and sky", ts)
	ts = StartupLog.t()
	_fx = FxView.new()
	add_child(_fx)
	_fx.setup(_camera)
	_finale_view = FinaleView.new()
	add_child(_finale_view)
	_finale_view.setup(_camera, _fx)
	StartupLog.span("views: effects and finale", ts)
	ts = StartupLog.t()
	_hud = HUD.instantiate()
	add_child(_hud)
	_graphics.torch_toggled.connect(func(on: bool) -> void: _hud.toast("Lampe torche allumée" if on else "Lampe torche éteinte", 1.5))
	StartupLog.span("views: HUD", ts)
	ts = StartupLog.t()
	_weapon_view = Node3D.new()
	_weapon_view.set_script(WeaponView)
	add_child(_weapon_view)
	_weapon_view.setup(_camera)
	_weapon_view.hold_fx = _hold_fx
	_weapon_view.dbg_melee_t = _melee_pose
	if _axe_arg:
		Game.arms.has_axe = true
	_weapon_view.posed.connect(_flush_shots)
	Game.view_cam().dbg_orbit = _tp_orbit
	Game.view_cam().dbg_arm = _tp_arm
	StartupLog.span("views: weapon", ts)
	ts = StartupLog.t()
	_avatar = PlayerAvatar.new()
	_avatar.dbg_pose = _avatar_pose
	add_child(_avatar)
	_avatar.setup(_camera)
	_weapon_view.avatar = _avatar
	_intro = BossIntro.new()
	add_child(_intro)
	_intro.setup(_camera, _hud, _finale_view, _create_view)
	StartupLog.span("views: avatar and boss intro", ts)
	ts = StartupLog.t()
	if not ZombieModels.use_old:
		ZombieModels.warm()   # J16 : instances de zombies prêtes à l'avance (pas d'à-coup à la première apparition)
	_hud_last = {"banner": "", "bar": {}, "mark": "", "fanal": -2.0, "fanal_text": ""}
	if Game.world != null and Game.world.map_id == "alpine":
		_arena_node = AlpineView.new()
	else:
		_arena_node = (WORLD if Game.world != null else ARENA).instantiate()
	add_child(_arena_node)
	StartupLog.span("views: zombie models and map node", ts)

## v0.34.6 : une image de l'écran de chargement entre deux constructions (la barre et le fond restent animés).
func _load_frame() -> void:
	await get_tree().process_frame

func _finish_scene(_map_name: String) -> void:
	var ts := StartupLog.t()
	if Game.rides != null:
		_rides_view = Node3D.new()
		_rides_view.set_script(RidesView)
		add_child(_rides_view)
		await _rides_view.setup(_camera)
		_start_mounted()
		await _load_frame()
	if Game.machines != null:
		_machines_view = Node3D.new()
		_machines_view.set_script(MachinesView)
		add_child(_machines_view)
		_machines_view.setup()
		await _load_frame()
	StartupLog.span("finish: vehicles and machines", ts)
	ts = StartupLog.t()
	_shop_view = ShopView.new()   # v0.28.0 : wall weapon panels and ammo stations (the JS ones are dropped from the baked tiles)
	add_child(_shop_view)
	_shop_view.setup()
	await _load_frame()
	if Game.world != null and not Game.world.furniture.is_empty() and "--dbg-nofurniture" not in OS.get_cmdline_user_args():
		_furniture_view = FurnitureView.new()   # v0.33.1 : bancs, lampadaires, corbeilles, bornes, barrières, kiosques, colonnes
		add_child(_furniture_view)
		_furniture_view.setup(Game.world.furniture)
		print("mobilier urbain : %s (triangles par modèle %s)" % [_furniture_view.counts, _furniture_view.triangles])
	StartupLog.span("finish: wall weapons and street furniture", ts)
	ts = StartupLog.t()
	_perk_view = Node3D.new()   # v0.27.0 : gouttes, tombe, décharges, toiles
	_perk_view.set_script(PerkFxView)
	add_child(_perk_view)
	_perk_view.setup()
	_perk_view.hold = "--hold-perkfx" in OS.get_cmdline_user_args()
	if Game.gm != null:   # v0.26.0 : Zone unique : portes murées
		_zone_view = Node3D.new()
		_zone_view.set_script(ZoneModeView)
		add_child(_zone_view)
		_zone_view.setup(_arena_node)
		print("ZONE UNIQUE : %s (zone %d), %d portes murées (%d pans), départ (%.1f ; %.1f), sortie (%.1f ; %.1f), %d machines ajoutées, %d fenêtres, %d points au sol, %.0f m2" % [
			Game.gm.zone_name, Game.gm.zone, _zone_view.doors_sealed.size(), _zone_view.walls, Game.gm.start.x, Game.gm.start.z, float(Game.gm.exit["pos"]["x"]), float(Game.gm.exit["pos"]["z"]),
			Game.gm.extra.size(), Game.gm.layout.windows.size(), Game.gm.layout.ground.size(), Game.gm.layout.area])
	if _show_collision and Game.world != null:
		var cv := Node3D.new()
		cv.set_script(preload("res://scenes/world/collision_view.gd"))
		add_child(cv)
		cv.setup(_collision_report, _collision_floor)
	_debug_do()
	if _finale_at < 0.0:
		_debug_finale()
	if _soak_rounds > 0 and Game.world != null:
		_soak = SoakBot.new(_seed if _seed >= 0 else 1)
		_soak.verbose = "--soak-verbose" in OS.get_cmdline_user_args()
		_soak.perf = _perf_soak_min > 0.0
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--bot-perks="):   # v0.27.0 : atouts du bot (nouveaux atouts : équilibrage, performance)
				_soak.perks = Array(a.substr(12).split(","))
		for a in OS.get_cmdline_user_args():
			if a.begins_with("--perf-round="):
				_soak.start_round = int(a.substr(13))
		_soak.setup(Game)
	_prev_player = Game.player.pos
	_apply_brightness()
	StartupLog.span("finish: perks, zone, debug options", ts)
	ts = StartupLog.t()
	_map_prepare()
	StartupLog.span("finish: map prepare", ts)
	_pending.clear()
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
		var k: String = kinds[i % kinds.size()] if _horde_only == "" else _horde_only
		var spd := 1.8 + 0.15 * (i % 5)
		if k == "run":
			spd *= 1.5
		var zz := Game.debug_spawn(p, spd, k == "crawl", k if k in ["armored", "bloat"] else "")
		if k == "limp":
			zz.limp = true
		elif k in ["normal", "run"]:
			zz.limp = false
			zz.runner = k == "run"

## --zoo=D : les six types de zombies en arc à D m devant le joueur (identifiants fixes : mêmes zombies à chaque capture).
func _spawn_zoo(d: float) -> void:
	if _zoo_state == "window" and Game.world != null:
		_zoo_windows(d)
		return
	print("zoo : joueur en ", Game.player.pos, " cap ", Game.player.yaw)
	Game.director.intermission = 1.0e9
	var kinds := ["normal", "run", "limp", "crawl", "armored", "bloat"]
	var fwd := Vector3(-sin(Game.player.yaw), 0, -cos(Game.player.yaw))
	var right := Vector3(cos(Game.player.yaw), 0, -sin(Game.player.yaw))
	for i in kinds.size():
		var p := Game.player.pos + fwd * d + right * (float(i) - 2.5) * d * 0.33
		var k: String = kinds[i]
		var zz := Game.debug_spawn(p, 3.4 if k == "run" else 1.5, k == "crawl", k if k in ["armored", "bloat"] else "")
		zz.limp = k == "limp"
		zz.runner = k == "run"
		zz.walk_t = 0.0
		if _zoo_state == "ground":
			zz.start_ground_spawn(p, zz.yaw)
		elif _zoo_state == "window" and Game.world != null:
			var best := -1
			var bd := INF
			for wi in Game.world.window_count():
				var used := false
				for q in Game.zombies:
					if q.spawn_window == wi:
						used = true
				var dd := Game.world.window_outside(wi).distance_to(Game.player.pos)
				var wd := Game.world.window_outside(wi) - Game.player.pos
				wd.y = 0.0
				if not used and dd < bd and dd > 4.0 and wd.normalized().dot(fwd) > 0.8:
					bd = dd
					best = wi
			if best >= 0:
				var n := Game.world.window_normal(best)
				zz.start_window_spawn(Game.world.window_inside(best), Game.world.window_outside(best), Game.world.window_center(best), n, atan2(n.x, n.y), best)

## --zoo-state=window : le joueur se place à d m de la fenêtre la plus proche (face à elle) ; trois zombies (normal, coureur, armuré) sortent par la fenêtre et ses voisines.
func _zoo_windows(d: float) -> void:
	var near: Array = []
	for wi in Game.world.window_count():
		near.append([Game.world.window_outside(wi).distance_to(Game.player.pos), wi])
	near.sort()
	var first: int = near[0][1]
	var o := Game.world.window_outside(first)
	var n := Game.world.window_normal(first)
	Game.player.pos = Vector3(o.x + n.x * d, 0.0, o.z + n.y * d)
	Game.player.yaw = atan2(n.x, n.y)
	Game.director.intermission = 1.0e9
	var kinds := ["normal", "run", "armored"]
	var k_i := 0
	var cands: Array = []
	for wi in Game.world.window_count():
		cands.append([Game.world.window_outside(wi).distance_to(o), wi])
	cands.sort()
	for c in cands.slice(0, 3):
		var wi: int = c[1]
		var k: String = kinds[k_i]
		k_i += 1
		var zz := Game.debug_spawn(Game.world.window_inside(wi), 3.4 if k == "run" else 1.5, false, k if k == "armored" else "")
		zz.runner = k == "run"
		zz.limp = false
		var wn := Game.world.window_normal(wi)
		zz.start_window_spawn(Game.world.window_inside(wi), Game.world.window_outside(wi), Game.world.window_center(wi), wn, atan2(wn.x, wn.y), wi)

## --zoo-state : death, headless, hit appliqués une fois, à --zoo-at secondes de jeu.
func _zoo_apply() -> void:
	if _zoo_state == "" or _zoo_done or Game.time < _zoo_at or _zoo_state in ["ground", "window"]:
		return
	_zoo_done = true
	for z in Game.zombies:
		match _zoo_state:
			"death":
				z.damage(1.0e9, false)
			"headless":
				z.damage(1.0e9, true)
			"hit":
				z.damage(1.0, false)

## --do= : actions de démonstration (captures, vidéos). perks : tous les atouts ; powerup:TYPE : un bonus devant le joueur ; money ; box / pap : achète
## à la machine la plus proche de la position ; to-box / to-pap / to-perk:ID : se place devant la machine ; down : à terre.
func _debug_do() -> void:
	for cmd in _do:
		var c := cmd.split(":")
		match c[0]:
			"money":
				Game.points = 100000
			"weapon":   # weapon:ID[:NIVEAU_PAP] : donne l'arme (captures des modèles d'armes)
				Game.arms.give_weapon(c[1])
				if c.size() > 2:
					Game.arms.current.pap = int(c[2])
					Game.arms.current.refresh(Game.arms.perks)
			"reload":   # un rechargement au lancement (captures)
				_pending["reload"] = true
			"ammo":   # ammo:N : chargeur de l'arme en main à N cartouches (captures du rechargement)
				Game.arms.current.ammo = int(c[1])
			"knife":   # un coup de couteau au lancement (captures des mains)
				_pending["knife"] = true
			"grenade":   # une grenade lancée au lancement (captures des mains)
				_pending["grenade"] = true
			"perks":
				for id: String in Config.at("perks"):
					Game.add_perk(id)
			"powerup":
				var f := Vector3(-sin(Game.player.yaw), 0, -cos(Game.player.yaw)) * 2.5
				Game.powerups.spawn(Game, Game.player.pos + f, c[1] if c.size() > 1 else "")
			"collect":   # ramasse tout de suite un bonus (HUD des bonus actifs, Bombe)
				Game.powerups.collect(Game, {"type": c[1]})
			"perkfx":   # v0.27.0 : effets des nouveaux atouts devant le joueur (captures ; avec --hold-perkfx)
				var f := Game.player.forward()
				var at := Game.player.pos + Vector3(f.x, 0, f.z).normalized() * 5.0
				Game.pfx.drops = [{"id": 900, "pos": at + Vector3(-1.6, 0, 0), "type": "ammo", "life": 60.0}, {"id": 901, "pos": at + Vector3(1.6, 0, 0), "type": "points", "life": 60.0}]
				Game.pfx.tomb = {"pos": at + Vector3(0, 0, 0) + Vector3(f.x, 0, f.z).normalized() * 3.0, "perks": ["juggernog"], "life": 60.0, "arm": 60.0}
				Game.perk_event.emit("cherry", {"pos": at + Vector3(-3.5, 0, 2), "radius": 4.0, "power": 1.0, "hit": 0})
				Game.perk_event.emit("web", {"pos": at + Vector3(3.5, 0, 2), "radius": 5.0, "count": 0})
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
			"back":   # back:N : v0.29.0, the player steps N m backward (captures of the mystery box after buying a draw)
				var fw: Vector3 = Game.player.forward()
				Game.player.pos -= Vector3(fw.x, 0, fw.z).normalized() * float(c[1])
			"tram-front", "tram-rear", "tram-side":   # v0.30.0 : tram-front:D[:S] : the player stands D m before the front nose (S m aside), facing it (captures)
				var tr: TramSim = Game.rides.trams[0]
				var nose: Dictionary = tr.mods[tr.n - 1] if c[0] != "tram-rear" else tr.mods[0]
				var sg := 1.0 if c[0] != "tram-rear" else -1.0
				var tv := Vector3(float(nose["tx"]), 0, float(nose["tz"])) * sg
				var d := float(c[1]) if c.size() > 1 else 6.0
				var side := float(c[2]) if c.size() > 2 else 0.0
				var at := Vector3(float(nose["x"]), 0, float(nose["z"])) + tv * (tr.M / 2.0 + d) + Vector3(tv.z, 0, -tv.x) * side
				if c[0] == "tram-side":
					at = Vector3(float(tr.mods[2]["x"]), 0, float(tr.mods[2]["z"])) + Vector3(tv.z, 0, -tv.x) * d
					tv = Vector3(tv.z, 0, -tv.x)
				Game.player.pos = at
				var look := (Vector3(float(nose["x"]), 0, float(nose["z"])) if c[0] != "tram-side" else Vector3(float(tr.mods[2]["x"]), 0, float(tr.mods[2]["z"]))) - at
				Game.player.yaw = atan2(-look.x, -look.z)
			"teddy":   # le prochain tirage de la boîte est le nounours
				Game.machines.box.limit = Game.machines.box.uses + 1
			"open-doors":
				Game.world.open_all_doors()
			"switch":   # aiguillage de la rame réglé « dévié » (capture des signaux)
				Game.rides.trams[0].set_switch(1)
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
		if _tram_at.size() >= 2:
			r.place_in_tram(r.trams[0], _tram_at[0], _tram_at[1])
			if _tram_at.size() >= 3:
				Game.player.yaw = r.on_tram["fy"] + deg_to_rad(_tram_at[2])
		else:
			r.place_in_tram(r.trams[0], 0.0, 0.0)
	if _mount == "":
		return
	if _mount == "tram":
		var tr: TramSim = r.trams[0]
		var nose: Dictionary = tr.mods[tr.n - 1]
		Game.player.pos = Vector3(nose["x"] + nose["tx"] * (tr.M / 2.0 + 1.0), 0.0, nose["z"] + nose["tz"] * (tr.M / 2.0 + 1.0))
		if _seat > 1:
			r.try_mount(tr, _seat)
		else:
			r.try_mount(tr, 0)
		return
	for v in r.vehicles:
		if v.type == _mount:
			Game.player.pos = Vector3(v.x + 1.0, 0.0, v.z + 0.5)
			r.try_mount(v, 0)
			Game.player.yaw = v.yaw
			return

func _exit_tree() -> void:
	PerfLog.finish()
	ZombieModels.clear_pool()   # J16 : les instances de zombies du pool ne sont dans aucun arbre

## Perte de focus de la fenêtre en pleine partie : pause (le JS passe en pause quand le navigateur libère le pointeur ; la souris capturée de Godot est
## relâchée de la même façon). Ni pendant un menu, ni pour un pilote automatique.
func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT and not _bot and _menus != null:
		_menus.focus_lost()
	elif what == NOTIFICATION_WM_CLOSE_REQUEST:
		PerfLog.finish()
		_record_stats()   # fermeture de la fenêtre en pleine partie : la partie compte quand même

func _unhandled_input(event: InputEvent) -> void:
	if not _session_live:
		return
	var live: bool = Game.playing and not Game.over and _menus.in_game and not (_intro != null and _intro.active)
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and live:
		var m := event as InputEventMouseMotion
		var sens := Rules.MOUSE_SENS * float(Game.settings.get_value("sens")) * Game.arms.sens_zoom()   # visée : souris plus lente (player.js : zoom)
		Game.player.last_mouse = Game.time
		# v0.34.7 : déplacement en pixels de l'écran (screen_relative) : `relative` est divisé par l'échelle de l'interface (x 2 en 2560 x 1440) ; la
		# sensibilité reste celle d'avant, quelle que soit la résolution
		Game.player.yaw -= m.screen_relative.x * sens
		Game.player.pitch = clampf(Game.player.pitch - m.screen_relative.y * sens, -Rules.PITCH_LIMIT, Rules.PITCH_LIMIT)
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
		elif event.is_action_pressed("foot_view") and not riding:
			var third := int(Game.settings.get_value("view")) == 0   # touche T : bascule la vue à pied (réglage « Vue », mémorisé)
			Game.settings.set_value("view", 1 if third else 0)
			_hud.toast("Vue : 3e personne" if third else "Vue : 1re personne", 1.5)
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
	if not _session_live:
		return
	if _god:
		Game.player.health = Game.player.max_health
	_prev_player = Game.player.pos
	_prev_eye = _eye_now()
	for v in _views.values():
		v.remember()
	if _rides_view != null:
		_rides_view.remember()
	if _intro != null and _intro.active:
		return   # intro de boss : la simulation est en pause (aucun pas : joueur protégé, zombies figés), bornée par BossIntro.HARD_CAP
	var input: Dictionary
	if _soak != null:
		input = _soak.think(Game)
	elif _bot:
		input = Bot.think(Game)
	else:
		input = {
			"mx": Input.get_axis("move_left", "move_right"),
			"mz": Input.get_axis("move_back", "move_forward"),
			"sprint": Input.is_action_pressed("sprint"),
			"jump": Input.is_action_pressed("jump"),
			"unstick": Input.is_action_pressed("unstick"),   # J11 : se débloquer (maintenu)
			"interact": Input.is_action_pressed("use"),   # J10 : le Fanal d'Erwin se tient
			"fire": Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED,
			"reload": Input.is_action_just_pressed("reload"),
			"aim": Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED,
		}
		if _auto_fwd:
			input["mz"] = 1.0
		if _hold_jump:
			input["jump"] = true
		if _hold_unstick:
			input["unstick"] = true
		if _hold_aim:
			input["aim"] = true
		if _hold_sprint:
			input["sprint"] = true
		if _hold_fire:
			input["fire"] = true
		input.merge(_pending, true)
		for act: Array in _acts:
			if Game.time >= float(act[1]):
				input[String(act[0])] = true
				_acts.erase(act)
				break
	_pending.clear()
	if _finale_at >= 0.0 and Game.time >= _finale_at:
		_finale_at = -1.0
		_debug_finale()
	if _late_at >= 0.0 and Game.time >= _late_at:
		_late_at = -1.0
		for c in _late:
			c.call()
		_late.clear()
	var t0 := Time.get_ticks_usec()
	Game.step(dt, input)
	PerfLog.add(&"step", t0)
	_fps_step_us += Time.get_ticks_usec() - t0
	_fps_steps += 1
	if _soak != null:
		_soak.after_step(Game, Time.get_ticks_usec() - t0)
		if Game.round_number > _soak_rounds or Game.over or (_perf_soak_min > 0.0 and Game.time >= _perf_soak_min * 60.0):
			_soak_end()

## Position de l'œil au pas courant : œil du joueur, ou celui qu'impose le véhicule (caméra externe ou œil de la selle).
func _eye_now() -> Vector3:
	var p := Game.player
	if p.eye_override != Vector3.INF:
		return p.eye_override
	return p.pos + Vector3(0, float(Config.at("player.eye")), 0)

func _process(dt: float) -> void:
	if _cam_arm > 0.0 and Game.rides != null and Game.rides.ride != null:
		Game.rides.ride["v"].def["camArm"] = _cam_arm
	if _look_yaw != 0.0 and Game.rides != null and Game.rides.ride != null:
		Game.player.yaw += _look_yaw
		_look_yaw = 0.0
	if not _first_draw:
		_first_draw = true
		if DisplayServer.get_name() != "headless":
			await RenderingServer.frame_post_draw
		print("MENU : premier affichage à %d ms après le lancement du moteur" % Time.get_ticks_msec())
		StartupLog.mark("first frame presented")
		if _probe:
			print("PROBE title : world=%s arena=%s player=%s director=%s zombies=%d flow=%d" % [Game.world != null, Game.arena != null, Game.player != null, Game.director != null, Game.zombies.size(), _flow.state])
			get_tree().quit(0 if Game.world == null and Game.arena == null and Game.player == null and Game.director == null and Game.zombies.is_empty() and _flow.is_menu() else 1)
			return
	_real_t += dt
	_fps_overlay.live = _session_live and _flow.state == SessionFlow.PLAYING and _menus.in_game   # pas pendant le chargement
	if not _session_live:
		_menu_tick(dt)
		return
	var pt := PerfLog.t()
	PerfLog.game_time = Game.time
	_session_process(dt)
	PerfLog.add(&"main", pt)

## Menu sans partie : boutons à presser (--click), musique du menu, capture d'écran de menu.
func _menu_tick(dt: float) -> void:
	if _flow.state == SessionFlow.LOADING:   # v0.34.6 : durée réelle entre deux images (le dt du moteur est borné), images de plus de 100 ms
		var now := Time.get_ticks_usec()
		var real_dt := (now - _load_last_us) / 1.0e6 if _load_last_us > 0 else dt
		_load_last_us = now
		_load_max_dt = maxf(_load_max_dt, real_dt)
		if real_dt > 0.1:
			_load_slow += 1
			StartupLog.mark("game loading: slow frame", "%.0f ms, %s" % [real_dt * 1000.0, _flow.step_text()])
		_load_frames += 1
	Sfx.set_mood(AudioRules.mood_intensity(false, false, 0), true)
	_click_t += dt
	if not _click.is_empty() and _click_t > 0.6 and _flow.state != SessionFlow.LOADING:
		_click_t = 0.0
		_press(_click[0])
		_click.remove_at(0)
	if _shot_path != "" and _real_t >= 1.5 + _shot_at and not _shot_done and _click.is_empty() and _flow.state != SessionFlow.LOADING:
		_shot_done = true
		# v0.33.0 : frame_post_draw n'arrive plus après la première image du menu sur le poste de dev (Wayland, Intel) : deux images de traitement suffisent
		await get_tree().process_frame
		await get_tree().process_frame
		get_viewport().get_texture().get_image().save_png(_shot_path)
		print("capture : %s (menu)" % _shot_path)
		get_tree().quit()

## --click : texte d'un bouton visible à presser, @ESC (touche Échap) ou @DIE (mort du joueur).
func _press(want: String) -> void:
	if want == "@ESC":
		_menus.escape()
		return
	if want == "@DIE" and Game.player != null:   # mort du joueur (vérifie fin de partie, statistiques, écran de fin)
		Game.zombies.clear()
		Game.points = 1234
		Game.kills = 17
		Game.player.hurt(10000.0, Game.time)
		Game._end_game()
		return
	var b := _find_button(_menus, want)
	if b != null:
		StartupLog.input_seen()
		b.pressed.emit()
		b.button_up.emit()   # as a real click: --startup-log times the handler up to button_up
	else:
		printerr("--click : bouton « %s » introuvable" % want)

func _report_memory(label: String) -> void:
	print("MÉMOIRE %s : monde %s, arène %s, joueur %s, zombies %d ; %d objets, %d noeuds, %.0f Mo" % [label, Game.world != null, Game.arena != null, Game.player != null,
		Game.zombies.size(), int(Performance.get_monitor(Performance.OBJECT_COUNT)), int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)), Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0])

func _find_button(n: Node, text: String) -> BaseButton:
	for c in n.get_children():
		if c is BaseButton and (c as BaseButton).text == text and c.is_visible_in_tree():
			return c
		var r := _find_button(c, text)
		if r != null:
			return r
	return null

func _session_process(dt: float) -> void:
	if _door_probe:
		_door_probe_tick(dt)
	var f := Engine.get_physics_interpolation_fraction()
	var p := Game.player
	if _spin_rate != 0.0 and Game.playing:
		p.yaw += _spin_rate * dt
	if p.eye_override != Vector3.INF or _prev_eye != Vector3.ZERO and Game.view_cam().placed:
		_camera.position = _prev_eye.lerp(_eye_now(), f)
	else:
		_camera.position = _prev_player.lerp(p.pos, f) + Vector3(0, p.eye_height() + p.bob(), 0)
	if _eye_y > -1.0e8:
		_camera.position.y = _eye_y
	var roll := 0.0
	if Game.rides != null and Game.rides.ride != null and not Game.rides.cam.placed and not Game.rides.ride["v"].is_tram():
		roll = Game.rides.ride["v"].lean * 0.5   # la vue penche avec la moto
	if Game.shake > 0.0:
		_camera.position += Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * Game.shake * 0.25
	_camera.rotation = Vector3(p.pitch, p.yaw + Game.view_cam().dbg_orbit, roll)   # ordre YXZ : lacet puis tangage
	if _finale_arg == "angel":   # mise au point des captures : la visée suit l'Ange
		for z in Game.zombies:
			if z is AngelSim:
				var d: Vector3 = (z as AngelSim).trumpet_world() - p.eye()
				p.yaw = atan2(-d.x, -d.z)
				p.pitch = atan2(d.y, Vector2(d.x, d.z).length())
	var orbiting: bool = Game.finale != null and Game.finale.orbit_on
	if orbiting:   # vue orbitale de l'Aube (summit.js cameraStep) : prend la caméra après le joueur
		var op: Dictionary = Game.finale.orbit_pose()
		_camera.position = op["pos"]
		_camera.look_at(op["look"], Vector3.UP)
	var vcam := Game.view_cam()
	_weapon_view.hide_gun = (Game.rides != null and Game.rides.driving()) or vcam.external()   # arme de la vue cachée en conduisant et en vue externe (machine, ou 3e personne à pied)
	Game.view_aspect = get_viewport().get_visible_rect().size.aspect()
	_camera.fov = 68.0 if orbiting else GraphicsRules.fov_for_aspect(Game.arms.fov(float(Game.settings.get_value("fov"))), Game.view_aspect)
	_weapon_view.hide_gun = _weapon_view.hide_gun or orbiting
	if _intro != null and _intro.active:
		_intro.tick(dt, p.yaw, p.pitch)   # caméra tournée vers le boss, overlay, une tâche de préchauffage
		_weapon_view.hide_gun = true
	else:
		_hud.set_cinema(orbiting)
	_hud_finale()
	# zombies retirés par la simulation
	for id: int in _views.keys():
		if not _views[id].sim in Game.zombies:
			_views[id].queue_free()
			_views.erase(id)
	_zoo_apply()
	_quit_check()
	_fps_step(dt)
	# musique : intensité selon la manche (0,3 + 0,05 x manche), étouffée dans les menus et en pause (main.js updateMusicMood)
	var in_game: bool = _menus.in_game and not Game.over
	Sfx.set_mood(AudioRules.mood_intensity(in_game, Game.finale != null and Game.finale.active(), Game.round_number), not in_game or not Game.playing)
	for i in range(_tracers.size() - 1, -1, -1):
		_tracers[i][1] -= dt
		if _tracers[i][1] <= 0.0:
			_tracers[i][0].queue_free()
			_tracers.remove_at(i)
	if not _click.is_empty():
		_click_t += dt
		if _click_t > 0.6:
			_click_t = 0.0
			_press(_click[0])
			_click.remove_at(0)
	var shot_ready: bool = Game.time >= _shot_at if Game.playing else _real_t >= 3.0 + _shot_at
	if _shot_intro_t >= 0.0:
		shot_ready = _intro != null and _intro.active and _intro.t >= _shot_intro_t   # un écran de menu n'avance pas le temps de jeu
	if _shot_path != "" and shot_ready and not _shot_done:
		_shot_done = true
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(_shot_path)
		print("capture : %s (manche %d, %d tués, %d points, %d PV)" % [_shot_path, Game.round_number, Game.kills, Game.points, Game.player.health])
		print("capture pose : %.2f,%.2f,%.3f" % [Game.player.pos.x, Game.player.pos.z, rad_to_deg(Game.player.yaw)])
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
	if _fps_n == 0:
		ZombieModels.view_us = 0   # remis à zéro au début de la mesure
	_fps_proc += Performance.get_monitor(Performance.TIME_PROCESS)
	_fps_phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
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
		print("FPS+ : Game.step %.2f ms par pas (%d pas) ; TIME_PROCESS %.2f ms par image ; TIME_PHYSICS_PROCESS %.2f ms par image ; vues de zombies (_process) %.3f ms par image ; %d zombies" % [
			_fps_step_us / float(maxi(1, _fps_steps)) / 1000.0, _fps_steps, _fps_proc / _fps_n * 1000.0, _fps_phys / _fps_n * 1000.0, ZombieModels.view_us / float(_fps_n) / 1000.0, Game.zombies.size()])
		get_tree().quit()

func _quit_check() -> void:
	if _quit_at > 0.0 and Game.time >= _quit_at:
		print("audio : %d sons lus, %d ignorés, %d voix reprises, %d voix créées ; musique niveau %d ; lus : %s" % [Sfx.stats["played"], Sfx.stats["skipped"], Sfx.stats["stolen"], Sfx.voice_count(), Sfx.music_level, Sfx.counts])
		get_tree().quit()

## J16 : les zombies ordinaires ont le modèle animé (Quaternius) ; boss, gargouilles et Ange gardent l'ancienne vue en primitives, ainsi que tous les zombies avec --old-zombies.
func _uses_model_view(z: ZombieSim) -> bool:
	return not ZombieModels.use_old and not (z is BossSim) and z.kind != "gargoyle"

func _on_zombie_spawned(z: ZombieSim) -> void:
	if _intro != null and not _bot and BossIntro.wants(z):
		_intro.begin(z)   # première apparition de ce boss : l'intro crée sa vue (et préchauffe) pendant la pause de la simulation
		return
	_create_view(z, null)

## Vue d'un zombie. parent null : vue de jeu (enfant de main, enregistrée) ; sinon vue jetable de préchauffage de l'intro (enfant de `parent`, non enregistrée).
func _create_view(z: ZombieSim, parent: Node3D) -> Node3D:
	var pt := PerfLog.t()
	var v := Node3D.new()
	v.set_script(AngelView if z is AngelSim else (ZombieModelView if _uses_model_view(z) else ZombieView))
	(parent if parent != null else self).add_child(v)
	v.setup(z)
	if parent == null:
		_views[z.id] = v
	PerfLog.add(&"apparition", pt)
	return v

## Un tir : le traçant est créé après la mise à jour de la caméra et de l'arme de l'image (_flush_shots), pour partir de la VRAIE bouche du modèle.
func _on_shot(origin: Vector3, end: Vector3) -> void:
	_shot_queue.append([origin, end])

func _flush_shots() -> void:
	for sh: Array in _shot_queue:
		_spawn_tracer(sh[0], sh[1])
	_shot_queue.clear()

## Traçant : de la bouche du modèle (même transformation que lui : pose de visée, recul, interpolation de la caméra) jusqu'au point touché ; l'éclair de bouche
## est enfant du même modèle. Arme cachée (vue externe d'un véhicule) : point avancé de la caméra, comme avant.
func _spawn_tracer(origin: Vector3, end: Vector3) -> void:
	var len := origin.distance_to(end)
	if len < 0.5:
		return
	var start := origin + (end - origin).normalized() * 0.8 + Vector3(0.12, -0.12, 0).rotated(Vector3.UP, Game.player.yaw)
	if _weapon_view != null:
		start = _weapon_view.tracer_start(start)
	if start.distance_to(end) < 0.3:
		return
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = Vector3(TRACER_WIDTH, TRACER_WIDTH, start.distance_to(end))
	m.mesh = b
	var mat := StandardMaterial3D.new()
	mat.albedo_color = TRACER_COLOR
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.material_override = mat
	add_child(m)
	m.global_position = (start + end) / 2.0
	m.look_at(end, Vector3.UP)
	if _hold_fx:
		for old in _tracers:
			old[0].queue_free()
		_tracers.clear()
	_tracers.append([m, 1.0e9 if _hold_fx else TRACER_TIME])

func _on_game_over() -> void:
	_record_stats()
	_flow.end_game()
	if Game.escaped:   # v0.26.0 : Zone unique, porte de sortie achetée
		_menus.show_escape(Game.gm.zone_name if Game.gm != null else "", Game.time, Game.round_number, Game.kills, Game.points_earned, Game.stats.zone_entry(Game.gm.zone_name) if Game.gm != null else {})
		return
	if Game.timed != null or Game.arsenal != null:   # v0.33.0 : écran de fin des modes (points gagnés, record du mode)
		_menus.show_mode_over(Game.mode_id(), Game.time_up, Game.time, Game.round_number, Game.kills, Game.points_earned, Game.stats.mode_entry(Game.mode_id()),
			Game.arsenal.history if Game.arsenal != null else [])
		return
	_menus.show_over("Vous avez survécu jusqu'à la [color=#ffffff][b]manche %d[/b][/color]\n%d zombies tués  ·  %d points" % [Game.round_number, Game.kills, Game.points])

# ---------------------------------------------------------------- J7 : menus, réglages, démonstrations
## Les couches d'interface ouvertes décident si le jeu tourne et si la souris est capturée.
func _apply_layers() -> void:
	var blocked: bool = _menus.stack.blocks_game()
	Game.playing = _menus.in_game and not blocked
	_pending.clear()
	if DisplayServer.get_name() == "headless" or _bot:
		return
	var mm := Input.MOUSE_MODE_CAPTURED if (Game.playing and not Game.over) else Input.MOUSE_MODE_VISIBLE
	if Input.mouse_mode != mm:   # v0.34.4 : chaque clic du menu passe ici ; on ne touche pas au système quand rien ne change
		Input.mouse_mode = mm

## v0.25.0 : cycle jour / nuit : réglages du joueur (Options) vers Game.daynight ; au début de la partie, heure de départ du mode (ou --hour).
func _apply_daynight(start: bool) -> void:
	var dn := Game.daynight
	var mode := int(Game.settings.get_value("daynight"))
	var mins := float(Game.settings.get_value("day_minutes"))
	if start:
		dn.reset(mode, mins)
		if _hour_arg >= 0.0:
			dn.mode = DayNight.MODE_AUTO if int(Game.settings.get_value("daynight")) == DayNight.MODE_AUTO else dn.mode
			dn.hour = _hour_arg
			dn.sky_k = DayNight.sky_k_at(_hour_arg)
		dn.frozen = _hold_hour
	else:
		dn.configure(mode, mins)

func _on_setting(key: String) -> void:
	match key:
		"daynight", "day_minutes":
			if _session_live and Game.daynight != null:
				_apply_daynight(false)
		"brightness":
			_apply_brightness()
		"volume", "music":
			_apply_audio()
		"fov":
			if _camera != null:
				_camera.fov = float(Game.settings.get_value("fov"))

## J10 : bandeau, barre de boss, marque et jauge du Fanal du HUD (mis à jour seulement quand ils changent).
func _hud_finale() -> void:
	var F: FinaleSim = Game.finale
	if F == null:
		return
	var banner: String = String(F.f.get("banner", "")) if F.active() else ""
	if banner != _hud_last["banner"]:
		_hud_last["banner"] = banner
		_hud.set_banner(banner)
	var bar: Dictionary = F.boss_bar() if F.active() else {}
	if bar.is_empty():
		bar = F.mini_bar
	if bar != _hud_last["bar"]:
		_hud_last["bar"] = bar
		_hud.set_boss_bar(bar)
	var mark := F.mark_label()
	if mark != _hud_last["mark"]:
		_hud_last["mark"] = mark
		_hud.set_mark(mark)
	var fan := F.fanal_frac()
	var ft := F.fanal_label()
	if not is_equal_approx(fan, float(_hud_last["fanal"])) or ft != _hud_last["fanal_text"]:
		_hud_last["fanal"] = fan
		_hud_last["fanal_text"] = ft
		_hud.set_fanal(fan, ft)

func _defer(c: Callable) -> void:
	_late.append(c)
	_late_at = Game.time + _finale_delay

## --finale=ETAT : prépare une partie dans la fin de partie pour les captures : manche 12, quartiers ouverts, tous les atouts, puis
## clock (devant l'horloge), boss1 (le Bourreau), boss2 (sur la plateforme), tanner, summit (sur la terrasse), angel, ramp, fanal, dawn.
func _debug_finale() -> void:
	if _finale_arg == "" or Game.finale == null:
		return
	var F: FinaleSim = Game.finale
	Game.world.open_all_doors()
	Game.director.round_number = 12
	Game.director.intermission = 1.0e9
	Game.points = 100000
	for id: String in Config.at("perks"):
		Game.add_perk(id)
	var lv: Levels = Game.world.levels
	if Game.world.map_id == "alpine":   # v0.34.0 : station alpine : --finale=boss1 (le Bourreau des neiges devant le joueur placé par --pos)
		if _finale_arg == "boss1":
			F.start()
			F.start_boss1()
			F.f["t"] = 2.5
		return
	match _finale_arg:
		"clock":
			var c := Cathedral.clock_pos()
			var m := Cathedral.P(0.0, 0.0)
			var away := Vector2(m.x - c.x, m.y - c.y).normalized() * 3.0
			Game.player.pos = Vector3(c.x + away.x, 0.0, c.y + away.y)
			Game.player.yaw = atan2(-(c.x - Game.player.pos.x), -(c.y - Game.player.pos.z))
		"boss1", "boss2":
			var at := Cathedral.P(37.0, 0.0)
			F.start()
			if _finale_arg == "boss1" and _finale_delay > 0.0:
				_defer(func() -> void:
					F.start_boss1()
					F.f["t"] = 2.5)
			else:
				F.start_boss1()
				F.f["t"] = 2.5
			Game.player.pos = Vector3(at.x - 14.0, 0.0, at.y)
			Game.player.yaw = atan2(-(at.x - Game.player.pos.x), -(at.y - Game.player.pos.z))
			if _finale_arg == "boss2":
				var pt := Cathedral.P(-30.0, 0.0)
				Game.player.pos = Vector3(pt.x, float(lv.regions[F.R["PL"]]["y"]), pt.y)
				F.f["state"] = "ascent"
				F.f["plT"] = 3.1
				(F.f["boss"] as BossSim).phase = 3
				(F.f["boss"] as BossSim)._enter_phase(3)
		"tanner":
			Game.director.round_number = 15
			var go_tanner := func() -> void:
				F.maybe_spawn_tanner()
				for z in Game.zombies:
					if z is TannerSim:
						Game.player.pos = Vector3(z.pos.x + 7.0, 0.0, z.pos.z)
						Game.player.yaw = atan2(-(z.pos.x - Game.player.pos.x), -(z.pos.z - Game.player.pos.z))
			if _finale_delay > 0.0:
				_defer(go_tanner)
			else:
				go_tanner.call()
		"summit", "angel", "ramp", "fanal", "dawn":
			F.f = {"state": "summit_beam", "t": 0.0, "np": 1, "banner": "", "boss": null, "fan": 0.0, "fh": 0, "fs": 0, "upT": 0.0, "said": true}
			Game.finale_done = true
			Game.arms.has_axe = true
			var tp := Cathedral.tower_pt(8.0, 235.0 if _finale_arg == "angel" else 100.0)
			var ax := Cathedral.tower_axis()
			var outw := Vector2(tp.x - ax.x, tp.y - ax.y).normalized()
			Game.player.pos = Vector3(tp.x, 104.0, tp.y)
			Game.player.yaw = atan2(-outw.x, -outw.y)   # face au large (la flèche dans le dos)
			Game.player.pitch = 0.25
			_finale_view.show_summit()
			if _finale_arg == "angel":
				F.f["state"] = "summit_angel"
				if _finale_delay > 0.0:
					_defer(F.spawn_angel)
				else:
					F.spawn_angel()
				Game.player.pitch = 0.5
			elif _finale_arg in ["ramp", "fanal"]:
				var rr: Dictionary = lv.regions[F.R["RAMP"]]
				var rl: Dictionary = lv.links[int(rr["link"])]
				var rp := {}
				lv.point_on(rl, 60.0 if _finale_arg == "ramp" else float(rl["length"]) - 2.0, rp)
				Game.player.pos = Vector3(rp["x"], rp["y"], rp["z"])
				F.f["state"] = "summit_ramp" if _finale_arg == "ramp" else "summit_fanal"
				F.f["gustT"] = 1.0
				if _finale_arg == "fanal":
					var fp := F.fanal_pos()
					var fo := Vector2(fp.x - ax.x, fp.z - ax.y).normalized()
					Game.player.pos = Vector3(fp.x + fo.x * 1.4, fp.y, fp.z + fo.y * 1.4)
					Game.player.yaw = atan2(fo.x, fo.y)   # face au Fanal
					Game.player.pitch = -0.05
					F.f["fan"] = 0.5
			elif _finale_arg == "dawn":
				F.dawn_begin(0.0)
				F.sky_t = 10.0
				F.sky_k = 10.0 / 30.0

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
		"mapdiff":
			_menus.open_title()
			_menus.open_mapdiff()
		"stats":
			_menus.open_title()
			_menus.open_stats()
		"confirm":
			_menus.open_title()
			_menus.open_stats()
			_menus.stack.push(UiStack.CONFIRM)
			_menus._sync()
		"credits":
			_menus.open_title()
			_menus.open_credits()
		"loading":
			_menus.show_loading("Construction de la ville", 0.45)
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
		"escape":   # v0.26.0 : écran « ÉVASION RÉUSSIE » (Zone unique)
			Game.points = 1000000
			Game.escape_zone()
		"timeup":   # v0.33.0 : écran « TEMPS ÉCOULÉ » (Contre la montre) : le chrono passe à 0 au pas suivant
			if Game.timed != null:
				Game.timed.left = 0.001
		"mode":
			_menus.open_title()
			_menus.open_mode()
		"perks":
			_menus.open_title()
			_menus.open_perks()
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

## --door-probe : à 2 s de jeu, se place devant la porte la plus proche du départ, achète (Game.use_door) et imprime les temps des images suivantes.
func _door_probe_tick(dt: float) -> void:
	if _probe_state == 0 and _real_t > 2.0:
		var best := -1
		var bd := INF
		for d: Dictionary in Game.world.doors:
			var pt: Array = d["points"][0]
			var dist := Vector2(pt[0] - Game.world.start_pos.x, pt[1] - Game.world.start_pos.z).length()
			if dist < bd:
				bd = dist
				best = int(d["id"])
		var pt2: Array = Game.world.doors[best]["points"][0]
		Game.player.pos = Vector3(pt2[0], 0.0, pt2[1])
		Game.points = 100000
		var t0 := Time.get_ticks_usec()
		var got := Game.use_door()
		print("PORTE %d : use_door %.2f ms (resultat %d)" % [best, (Time.get_ticks_usec() - t0) / 1000.0, got])
		_probe_state = 1
		_probe_last = Time.get_ticks_usec()
		_probe_log.clear()
	elif _probe_state == 1:
		_probe_log.append((Time.get_ticks_usec() - _probe_last) / 1000.0)
		_probe_last = Time.get_ticks_usec()
		if _probe_log.size() >= 240:
			var mx := 0.0
			var sum := 0.0
			for v in _probe_log:
				mx = maxf(mx, v)
				sum += v
			print("PORTE : %d images apres l'achat, moyenne %.2f ms, pire %.2f ms, 5 premieres %s" % [_probe_log.size(), sum / _probe_log.size(), mx, _probe_log.slice(0, 5)])
			get_tree().quit()
